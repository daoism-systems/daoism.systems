import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { detectMob } from '$lib/utils/isMobile';
import { createDefaultGraphicsOptions, type GraphicsTier } from './GraphicsConfig';
import { getFluidResolutionForTier } from './bootstrap/sceneBootstrap';
import Renderer from './postprocessing/Renderer';
import Lights from './lighting/Lights';
import { FluidMouseField } from './particles/FluidMouseField';
import { OctagonController } from './particles/OctagonController';
import MouseInteractions from './interaction/MouseInteractions';
import { assignSceneLayer } from './stages/assignSceneLayer';
import { SCENE_LAYERS } from './sceneLayers';

/**
 * Isolated octagon environment for marketing / showreel capture.
 *
 * Strips MainScene down to just the octagon and its faithful interaction loop:
 * pointer → {@link FluidMouseField} splat → GPU particle advection
 * ({@link OctagonController}), plus the screen-warp fluid-distortion post-FX
 * ({@link MouseInteractions}). There is no scroll, Lenis, Theatre, GLB scene,
 * train slider or progress pipeline — the camera is a direct OrbitControls view.
 *
 * The full {@link Renderer} is reused on purpose so the tuned look (ACES tone
 * mapping, fluid distortion) matches MainScene. Bloom and chromatic aberration
 * are disabled for this showreel capture.
 * The renderer's 3-channel composite defaults to scene-1 weight 1, so the
 * octagon (placed on `SCENE_LAYERS.SCENE_1`, like Scene1Stage does) renders
 * without any Theatre/scroll driving.
 */
const OCTAGON_MODEL_URL = '/models/Octagon.glb';
// Mirrors MainScene's per-layer assemble stagger and particle-radius scale so
// the reveal and sprite sizing match the production octagon.
const INTRO_SECONDS = 1.6;
const OCTAGON_INTRO_LAYER_DELAY_SECONDS = 0.45;
const PARTICLE_RADIUS_SCALE = 0.6;

export class OctagonScene {
	private renderer!: Renderer;
	private scene!: THREE.Scene;
	private camera!: THREE.PerspectiveCamera;
	private lights: Lights | null = null;
	private controls: OrbitControls | null = null;

	private fluid: FluidMouseField | null = null;
	private octagon: OctagonController | null = null;
	private mouseInteractions: MouseInteractions | null = null;
	private octagonGroup: THREE.Object3D | null = null;

	private readonly gltfLoader: GLTFLoader;
	private readonly dracoLoader: DRACOLoader;
	private readonly ktx2Loader: KTX2Loader;

	private readonly isMobile = detectMob();
	private readonly tier: GraphicsTier = this.isMobile ? 'medium' : 'high';
	private readonly graphicsOptions = createDefaultGraphicsOptions();
	private readonly params: Record<string, unknown>;

	private frameNumber = 0;
	private lastTime = 0;
	private introElapsed = 0;
	private fluidActivated = false;
	private sceneReady = false;
	private disposed = false;

	private readonly _sphere = new THREE.Sphere();
	private fitDistance = 5;

	constructor() {
		this.dracoLoader = new DRACOLoader();
		this.dracoLoader.setDecoderPath('/draco/');
		this.ktx2Loader = new KTX2Loader();
		this.ktx2Loader.setTranscoderPath('/basis/');
		this.gltfLoader = new GLTFLoader();
		this.gltfLoader.setDRACOLoader(this.dracoLoader);

		// Showreel octagon ships without bloom or chromatic aberration — gating these
		// off skips both post passes (createBloomPass / setupChromaticAberration are
		// guarded by these flags in PostProcessingGraph).
		this.graphicsOptions.postProcessing.bloom = false;
		this.graphicsOptions.postProcessing.chromaticAberration = false;

		// Static look params (MainScene normally lets Theatre animate these; here
		// the authored bases stand in for the hero-scene values).
		this.params = {
			resolution: this.graphicsOptions.resolutionScale,
			denoise: this.graphicsOptions.denoise,
			bloomStrength: 1.25,
			bloomRadius: 0.42,
			bloomThreshold: 0.0,
			emissiveBloomIntensity: uniform(1.6),
			chromeCenterX: 0.5,
			chromeCenterY: 0.5,
			chromeScale: 0.45,
			chromeStrength: 0.35,
			chromeExclusionRadius: 0.2,
			trainSliderProgress: 0,
			vignetteIntensityAuthored: 0
		};
	}

	public async init(): Promise<void> {
		this.setupScene();

		this.lights = new Lights(this.scene);
		this.lights.setupLights();

		this.renderer = new Renderer(this.graphicsOptions);
		this.fluid = new FluidMouseField(this.renderer.webGPURenderer, {
			resolution: getFluidResolutionForTier(this.tier),
			splatRadius: 0.05,
			splatForce: 500,
			curlStrength: 22,
			velocityDissipation: 0.85,
			pressureDissipation: 0.919,
			pressureIterations: 8
		});
		this.fluid.uAspectRatio.value = window.innerWidth / Math.max(1, window.innerHeight);

		await this.renderer.init({
			scene: this.scene,
			camera: this.camera,
			params: this.params,
			fluidEffect: this.fluid,
			ktx2Loader: this.ktx2Loader,
			gltfLoader: this.gltfLoader
		});

		// Screen-warp fluid distortion (post-FX) reacts to pointer motion — this is
		// the same coupling MainScene wires. The octagon's own particle splatting is
		// owned internally by OctagonController's window listeners.
		this.mouseInteractions = new MouseInteractions({
			globalFluidEffect: this.fluid,
			domElement: this.renderer.domElement
		});
		window.addEventListener('mousemove', this.mouseInteractions.onMouseMove);
		window.addEventListener('touchstart', this.mouseInteractions.onTouchStart, { passive: true });
		window.addEventListener('touchmove', this.mouseInteractions.onTouchMove, { passive: true });

		await this.loadOctagon();

		window.addEventListener('resize', this.onResize);

		this.sceneReady = true;
		this.lastTime = 0;
		void this.renderer.webGPURenderer.setAnimationLoop(this.animate);
	}

	private setupScene(): void {
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color('#000000');
		// FogExp2 matches MainScene so the octagon particles' fog-absorption term
		// is fed the density it was authored against.
		this.scene.fog = new THREE.FogExp2('#000000', 0.18);

		this.camera = new THREE.PerspectiveCamera(
			45,
			window.innerWidth / window.innerHeight,
			0.1,
			1000
		);
	}

	private async loadOctagon(): Promise<void> {
		const gltf = await this.gltfLoader.loadAsync(OCTAGON_MODEL_URL);
		this.octagonGroup = gltf.scene;
		this.scene.add(gltf.scene);
		// World matrices must be valid before OctagonController.setupSystems snaps
		// particles to the source mesh's matrixWorld.
		gltf.scene.updateMatrixWorld(true);

		this.octagon = new OctagonController({
			isMobile: this.isMobile,
			hasComputeSupport: this.renderer.hasComputeSupport,
			enablePhysics: this.graphicsOptions.enableOctagonPhysics,
			globalFluidEffect: this.fluid,
			gpu: { renderer: this.renderer.webGPURenderer },
			camera: this.camera,
			domElement: this.renderer.domElement
		});

		// Octagon.glb exposes Circle_01/02/03 → resolveSplitTargets builds 3 layers.
		const meshes = this.octagon.setupSystems(gltf.scene, {
			particleRadius: (this.isMobile ? 0.015 : 0.007) * PARTICLE_RADIUS_SCALE,
			baseColors: [
				new THREE.Color(0.88, 0.88, 0.9),
				new THREE.Color(0.85, 0.85, 0.88),
				new THREE.Color(0.82, 0.82, 0.86)
			],
			emissiveIntensity: 0.8,
			fogAbsorption: 0.35,
			worldOffsetY: 0
		});

		meshes.forEach((mesh, index) => {
			this.scene.add(mesh);
			mesh.renderOrder = 20 + index;
			mesh.layers.enable(SCENE_LAYERS.CHROMATIC_1);
			// Without SCENE_1 the renderer's scene-1 pass (which renders that layer
			// exclusively) would skip the octagon entirely.
			assignSceneLayer(mesh, SCENE_LAYERS.SCENE_1);
		});

		// Start hidden; the animate loop fades the layers in, then activates fluid.
		this.applyIntroOpacity(0);

		this.frameOctagon();
		this.setupControls();
	}

	/** Auto-frame the octagon's bounding sphere face-on (the disc faces ±Z). */
	private frameOctagon(): void {
		if (!this.octagonGroup) return;
		new THREE.Box3().setFromObject(this.octagonGroup).getBoundingSphere(this._sphere);

		const r = this._sphere.radius * 1.35;
		const vFov = THREE.MathUtils.degToRad(this.camera.fov);
		const distV = r / Math.sin(vFov / 2);
		const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
		const distH = r / Math.sin(hFov / 2);
		this.fitDistance = Math.max(distV, distH);

		const c = this._sphere.center;
		this.camera.position.set(c.x, c.y, c.z + this.fitDistance);
		this.camera.lookAt(c);
		this.camera.updateProjectionMatrix();
	}

	private setupControls(): void {
		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.target.copy(this._sphere.center);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.minDistance = Math.max(0.01, this._sphere.radius * 1.05);
		this.controls.maxDistance = this.fitDistance * 4;
		this.controls.update();
	}

	/** Staggered per-layer fade-in, mirroring MainScene.applyIntroOctagonOpacity. */
	private applyIntroOpacity(elapsedSeconds: number): void {
		if (!this.octagon) return;
		const layerCount = this.octagon.getLayerCount();
		if (layerCount <= 0) return;

		const totalDelay = (layerCount - 1) * OCTAGON_INTRO_LAYER_DELAY_SECONDS;
		const fadeDuration = Math.max(0.001, INTRO_SECONDS - totalDelay);
		const opacities = Array.from({ length: layerCount }, (_, index) => {
			const delayed = elapsedSeconds - index * OCTAGON_INTRO_LAYER_DELAY_SECONDS;
			return Math.max(0, Math.min(1, delayed / fadeDuration));
		});
		this.octagon.setLayerOpacities(opacities);
	}

	private readonly animate = (time: number): void => {
		if (this.disposed || !this.sceneReady) return;
		try {
			const delta = this.lastTime ? Math.min(0.05, (time - this.lastTime) / 1000) : 1 / 60;
			this.lastTime = time;
			this.frameNumber += 1;

			if (this.introElapsed < INTRO_SECONDS) {
				this.introElapsed = Math.min(INTRO_SECONDS, this.introElapsed + delta);
				this.applyIntroOpacity(this.introElapsed);
				if (this.introElapsed >= INTRO_SECONDS && !this.fluidActivated) {
					this.fluidActivated = true;
					this.octagon?.activateFluidSim();
				}
			}

			this.controls?.update();

			// Steps unconditionally so the post-FX fluid distortion keeps flowing.
			this.fluid?.step(delta);

			this.octagon?.tickActivityDecay(delta);
			this.octagon?.tickTransforms();
			this.octagon?.tickCompute(this.frameNumber);

			this.renderer.renderAsync();
		} catch (error) {
			console.error('OctagonScene render frame failed:', error);
		}
	};

	private readonly onResize = (): void => {
		const width = window.innerWidth;
		const height = window.innerHeight;
		this.renderer.onResize(width, height);
		this.camera.aspect = width / Math.max(1, height);
		this.camera.updateProjectionMatrix();
		if (this.fluid) {
			this.fluid.uAspectRatio.value = width / Math.max(1, height);
		}
		// Intentionally not re-framing: that would yank an orbited camera back.
		this.controls?.update();
	};

	public dispose(): void {
		this.disposed = true;
		this.sceneReady = false;

		window.removeEventListener('resize', this.onResize);

		if (this.mouseInteractions) {
			window.removeEventListener('mousemove', this.mouseInteractions.onMouseMove);
			window.removeEventListener('touchstart', this.mouseInteractions.onTouchStart);
			window.removeEventListener('touchmove', this.mouseInteractions.onTouchMove);
			this.mouseInteractions.cleanup();
			this.mouseInteractions = null;
		}

		this.controls?.dispose();
		this.controls = null;

		if (this.octagon) {
			this.octagon.dispose();
			this.octagon = null;
		}

		if (this.fluid) {
			this.fluid.dispose();
			this.fluid = null;
		}

		if (this.renderer) {
			this.renderer.webGPURenderer.setAnimationLoop(null);
			const canvas = this.renderer.domElement;
			if (canvas.parentNode) {
				canvas.parentNode.removeChild(canvas);
			}
			this.renderer.dispose();
		}

		this.dracoLoader.dispose();
		this.ktx2Loader.dispose();

		this.lights = null;
		this.octagonGroup = null;
	}
}

export default OctagonScene;
