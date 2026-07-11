import * as THREE from 'three/webgpu';
import {
	BlendMode,
	MeshPhysicalNodeMaterial,
	MeshStandardNodeMaterial,
	MeshBasicNodeMaterial,
	RenderPipeline,
	VolumeNodeMaterial,
	WebGPURenderer
} from 'three/webgpu';
// import * as TSLTextures from 'tsl-textures';

import {
	densityFogFactor,
	emissive,
	Fn,
	float,
	min,
	mix,
	mx_fractal_noise_float,
	mx_noise_float,
	mx_noise_vec3,
	abs,
	normalLocal,
	normalView,
	output,
	pass,
	positionLocal,
	positionViewDirection,
	pow,
	range,
	reflector,
	screenCoordinate,
	screenUV,
	texture,
	texture3D,
	time,
	triplanarTexture,
	uniform,
	uv,
	vec2,
	vec3,
	fract,
	length,
	smoothstep,
	vec4,
	mrt,
	sin,
	color
} from 'three/tsl';
import { SpriteNodeMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { bayer16 } from 'three/addons/tsl/math/Bayer.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { Inspector } from 'three/addons/inspector/Inspector.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { chromaticAberration } from '$lib/scene/postprocessing/CANode.js';
import { fluidDistortion } from '$lib/scene/postprocessing/FluidDistortionNode';
import { FluidMouseField } from '$lib/scene/particles/FluidMouseField';
import { detectMob } from '$lib/utils/isMobile';
import {
	VoidHeroGame,
	type GameCameraView,
	type PadLabel,
	type PopupTier
} from '../lib/voidhero/voidHero';
import { SceneEventBus } from '../lib/voidhero/events';

export type { PadLabel, PopupTier };
export { SceneEventBus } from '../lib/voidhero/events';

const LAYER_VOLUMETRIC_LIGHTING = 10;
const isMobile = detectMob();

const NOT_FOUND_SCENE_SETTINGS = {
	maxPixelRatio: 1.3,
	rendererAntialias: !isMobile,
	shadowMapType: THREE.PCFShadowMap,
	mainShadowMapSize: isMobile ? 512 : 1024,
	topShadowMapSize: isMobile ? 256 : 512,
	volumetricSteps: isMobile ? 4 : 8,
	noiseTextureSize: isMobile ? 32 : 64,
	volumetricSphereSegments: isMobile ? 16 : 20,
	volumetricPassResolutionScale: 0.44,
	fogScatterResolutionScale: 0.44,
	sparkleCount: 520,
	floorReflectorResolutionScale: isMobile ? 0 : 0.8
} as const;

function closeInspectorGroup(group: unknown): void {
	(group as { close?: () => void }).close?.();
}

function createVolumetricMaterial(
	noiseTexture3D: THREE.Data3DTexture,
	smokeAmount: any,
	fogSpeed: any,
	volumetricSteps: number
): VolumeNodeMaterial {
	const material = new VolumeNodeMaterial();
	material.steps = volumetricSteps;
	material.offsetNode = bayer16(screenCoordinate);

	material.scatteringNode = Fn(({ positionRay }: { positionRay: any }) => {
		// 1. Create a linear flow vector along Z axis (the corridor direction)
		// We multiply time by fogSpeed to control how fast the fog rushes past
		const flowOffset = vec3(0, 0, time.mul(fogSpeed));

		// 2. Keep the existing turbulence (roiling smoke effect)
		const turbulence = vec3(0);

		const sampleGrain = (scale: number, timeScale = 1) =>
			texture3D(
				noiseTexture3D,
				positionRay
					.add(flowOffset) // Apply the forward movement
					.add(turbulence.mul(timeScale)) // Apply internal smoke turbulence
					.mul(scale)
					.mod(1),
				0
			).r.add(0.5);

		let density = sampleGrain(0.1);
		density = density.mul(sampleGrain(0.05, 1));
		density = density.mul(sampleGrain(0.02, 2));

		return smokeAmount.mix(float(1), density);
	});

	return material;
}

interface PostProcessingConfig {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	volumetricMesh: THREE.Mesh | null;
	fogOpacity: ReturnType<typeof uniform>;
	volumetricLightingIntensity: ReturnType<typeof uniform>;
	denoiseStrength: ReturnType<typeof uniform>;
	fogDensity: ReturnType<typeof uniform>;
	fogScattering: ReturnType<typeof uniform>;
	chromaticStrength: ReturnType<typeof uniform>;
	chromaticScale: ReturnType<typeof uniform>;
	chromaticExclusionRadius: ReturnType<typeof uniform>;
	fluidEffect: FluidMouseField | null;
	fluidDistortionStrength: ReturnType<typeof uniform>;
	fluidActive: ReturnType<typeof uniform>;
	fluidDebug: ReturnType<typeof uniform>;
	volumetricPassResolutionScale: number;
	fogScatterResolutionScale: number;
}

interface NotFoundSketchOptions {
	events: SceneEventBus;
}

class NotFoundRenderer {
	renderer!: WebGPURenderer;
	bloomPass: ReturnType<typeof bloom> | null = null;
	private postProcessing!: RenderPipeline;
	private scenePass: any = null;
	private volumetricPass: any = null;

	async init(): Promise<void> {
		const q = NOT_FOUND_SCENE_SETTINGS;
		this.renderer = new WebGPURenderer({
			antialias: q.rendererAntialias
		});
		await this.renderer.init();

		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.6;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = q.shadowMapType;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		document.body.appendChild(this.renderer.domElement);
	}

	setupPostProcessing(config: PostProcessingConfig): void {
		this.postProcessing = new RenderPipeline(this.renderer);

		// Scene pass (renders default layers only)
		const scenePass = pass(config.scene, config.camera);
		this.scenePass = scenePass;

		// set up MRT with emissive (for proper emissive-only bloom)
		const scenePassMRT = mrt({
			output: output,
			emissive: vec4(emissive, output.a)
		});

		scenePassMRT.setBlendMode('emissive', new BlendMode(THREE.NormalBlending));
		scenePass.setMRT(scenePassMRT);

		// Keep emissive texture as default HalfFloatType so HDR bloom values
		// (portal emissive strength ~14) are preserved instead of being clamped to [0,1].

		const sceneLinearDepth = scenePass.getTextureNode('depth');

		// Feed scene depth to volumetric material for proper depth occlusion
		if (config.volumetricMesh) {
			const volumetricMaterial = config.volumetricMesh.material as VolumeNodeMaterial;
			volumetricMaterial.depthNode = sceneLinearDepth.sample(screenUV);
		}

		// Volumetric lighting pass (layer 10 only, reduced resolution)
		const volumetricLayer = new THREE.Layers();
		volumetricLayer.disableAll();
		volumetricLayer.enable(LAYER_VOLUMETRIC_LIGHTING);

		const volumetricPass = pass(config.scene, config.camera, { depthBuffer: false });
		this.volumetricPass = volumetricPass;
		volumetricPass.setLayers(volumetricLayer);
		volumetricPass.setResolutionScale(config.volumetricPassResolutionScale);

		const blurredVolumetricPass = gaussianBlur(volumetricPass, config.denoiseStrength);

		// Composite: scene + blurred volumetric
		const outputPass = scenePass.getTextureNode();
		const emissivePass = scenePass.getTextureNode('emissive');

		const volumetricContribution = blurredVolumetricPass.mul(
			config.volumetricLightingIntensity as any
		);
		const scenePassColor = mix(
			outputPass,
			outputPass.add(volumetricContribution),
			config.fogOpacity as any
		);

		// Fog scattering: blur distant objects based on depth fog factor
		const scenePassViewZ = scenePass.getViewZNode();
		const scatteredColor = gaussianBlur(scenePassColor, vec2(config.fogScattering), 4, {
			resolutionScale: config.fogScatterResolutionScale
		});
		const fogFactor = densityFogFactor(config.fogDensity).context({
			getViewZ: () => scenePassViewZ
		});
		const compositeWithScattering = mix(scenePassColor, scatteredColor, fogFactor);

		// Bloom pass (emissive-only)
		this.bloomPass = bloom(emissivePass, 1.2, 1.1, 1.2);

		// Combine scene (with fog scattering + volumetrics) and bloom
		const compositeBeforeCA = compositeWithScattering.add(this.bloomPass);

		// CANode returns only the fringe layer, so composite it back over the scene.
		// base 0.35 + splitMix 0.1 reproduce the look tuned under the previous
		// full-image CA signature (baseMix=0.35, splitMix=0.1).
		const applyChromaticAberration = chromaticAberration as any;
		const caFringe = applyChromaticAberration(
			compositeBeforeCA,
			config.chromaticStrength,
			vec2(0.5, 0.5),
			config.chromaticScale,
			0.1,
			config.chromaticExclusionRadius
		);
		let finalOutput = compositeBeforeCA.mul(0.35).add(caFringe);

		// Apply fluid distortion (desktop only)
		if (config.fluidEffect) {
			const velocityNode = config.fluidEffect.getVelocityNode();
			const sim = config.fluidEffect.getSimSize();
			const simSizeNode = uniform(vec2(sim.x, sim.y));
			finalOutput = fluidDistortion(
				finalOutput,
				velocityNode,
				simSizeNode,
				config.fluidDistortionStrength,
				config.fluidActive,
				config.fluidDebug
			);
		}

		this.postProcessing.outputNode = finalOutput as any;
	}

	render(): void {
		this.postProcessing.render();
	}

	async precompileAsync(scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
		const visibilityMap = new Map<THREE.Object3D, boolean>();
		scene.traverse((obj) => {
			visibilityMap.set(obj, obj.visible);
			obj.visible = true;
		});

		try {
			await this.renderer.compileAsync(scene, camera);
			await this.scenePass?.compileAsync?.(this.renderer);
			await this.volumetricPass?.compileAsync?.(this.renderer);

			const pipeline = this.postProcessing as any;
			pipeline._update?.();
			const quad = pipeline._quadMesh;
			if (quad?.camera) {
				await this.renderer.compileAsync(quad, quad.camera);
			}
		} finally {
			for (const [obj, wasVisible] of visibilityMap) {
				obj.visible = wasVisible;
			}
		}
	}

	dispose(): void {
		(this.postProcessing as any)?.dispose?.();
		if (this.renderer) {
			this.renderer.domElement.remove();
			this.renderer.dispose();
		}
	}
}

class NotFoundSketch {
	private nfRenderer!: NotFoundRenderer;
	private scene!: THREE.Scene;
	private camera!: THREE.PerspectiveCamera;
	private animationId: number | null = null;
	readonly ready: Promise<void>;
	private destroyed = false;
	private readonly debugEnabled =
		typeof window !== 'undefined' &&
		new URL(window.location.href).searchParams.get('debug') === 'true';
	private clock = new THREE.Clock();
	private game: VoidHeroGame | null = null;
	private pendingGameStart = false;
	private pendingGamePreview = false;

	// Model
	private gltfScene: THREE.Group | null = null;
	private mixer: THREE.AnimationMixer | null = null;
	private animationDuration = 0;
	private modelReady = false;

	// Named objects
	private floorMesh: THREE.Mesh | null = null;
	private floorMeshes: THREE.Mesh[] = [];
	private cubeObjects: THREE.Mesh[] = [];
	private portalMesh: THREE.Mesh | null = null;
	private secretButtonGroup: THREE.Group | null = null;
	private secretButtonRaycaster = new THREE.Raycaster();
	private secretButtonPointer = new THREE.Vector2();
	private secretButtonIntersections: THREE.Intersection[] = [];
	private secretButtonNormal = new THREE.Vector3();
	private secretButtonDirectionToCamera = new THREE.Vector3();
	private secretButtonForwardNormal = new THREE.Vector3(0, 0, 1);
	private secretButtonHovered = false;
	private secretButtonPulseTime = 0;
	private secretButtonPlateOpacity = uniform(0.01);
	private secretButtonRimOpacity = uniform(0.01);
	private secretButtonPlateGlow = uniform(0.35);
	private secretButtonRimGlow = uniform(0.65);
	private readonly secretButtonTargets = [
		new THREE.Vector2(0.74, 0.08),
		new THREE.Vector2(0.64, 0.16),
		new THREE.Vector2(0.84, 0),
		new THREE.Vector2(0.7, -0.16),
		new THREE.Vector2(0.24, 0.08),
		new THREE.Vector2(0.28, -0.22)
	];

	// Volumetric
	private volumetricMesh: THREE.Mesh | null = null;
	private noiseTexture3D: THREE.Data3DTexture | null = null;
	private smokeAmount = uniform(5);
	private fogSpeed = uniform(-5);
	private fogOpacity = uniform(0.65);

	// PBR textures for cubes
	private basecolorTexture: THREE.Texture | null = null;

	// Combo lightning VFX masks (grayscale TGA), injected into VoidHeroGame
	private comboBoltTexture: THREE.Texture | null = null;
	private comboBoltAltTexture: THREE.Texture | null = null;
	private comboImpactTexture: THREE.Texture | null = null;
	private cubeTextureBaseScale = 0.5;
	private cubeTextureScaleMul = uniform(10.0);
	private cubeTextureScale = uniform(2.0);
	private cubeNormalScale = uniform(0.25);
	private cubeMetalness = uniform(0.5);
	private cubeClearcoat = uniform(0.08);
	private cubeClearcoatRoughness = uniform(1);

	// Lights
	private portalLights: THREE.SpotLight[] = [];
	private lightHelpers: THREE.SpotLightHelper[] = [];

	// Reflection
	private floorReflector: ReturnType<typeof reflector> | null = null;
	private floorReflectionIntensity = uniform(0.35);
	private floorNoiseScale = uniform(0.003);
	private floorRoughnessLow = uniform(0.28);
	private floorRoughnessHigh = uniform(0.68);
	private floorDarkness = uniform(0.05);
	private floorVeinStrength = uniform(0.08);

	// Mouse interaction
	private mouse = new THREE.Vector2();
	private targetRotation = new THREE.Vector2();
	private currentRotation = new THREE.Vector2();
	private baseCameraQuaternion = new THREE.Quaternion();
	private baseCameraPosition = new THREE.Vector3();
	private idleCameraPosition = new THREE.Vector3();
	private idleCameraQuaternion = new THREE.Quaternion();
	private gameCameraView: GameCameraView = {
		position: new THREE.Vector3(),
		quaternion: new THREE.Quaternion(),
		fov: 50
	};

	// Transition state (button click → fast rush toward portal)
	private isTransitioning = false;
	private transitionProgress = 0;
	private transitionSpeed = 0;
	private cameraForwardDirection = new THREE.Vector3();

	// Camera shake — driven by VoidHeroGame onCameraShake callback. Decays each frame.
	private cameraShake = 0;
	private shakeAxisRight = new THREE.Vector3();
	private shakeAxisUp = new THREE.Vector3();
	private shakeQuat = new THREE.Quaternion();
	private cameraOffsetQuat = new THREE.Quaternion();
	private cameraOffsetEuler = new THREE.Euler(0, 0, 0, 'YXZ');

	// CTA hover state
	private ctaHovered = false;
	private baseFov = 50;
	private currentFov = 50;
	private hoverFov = 40;
	private fovLerpFactor = 0.1;

	// FOV reveal — runs once when the scene first becomes visible. Hides the
	// "show last warmup frame at full FOV" pop behind the loader overlay and
	// gives the page-open a deliberate iris-out feel.
	private revealActive = false;
	private revealProgress = 0;
	private readonly revealDuration = 1.4;
	private readonly minRevealFov = 1;

	// Post-processing refs
	private volumetricLightingIntensity = uniform(4.7);
	private denoiseStrength = uniform(2.5);

	// Fog scattering
	private fogDensity = uniform(0.009);
	private fogScattering = uniform(0.3);

	// Sparkle particles (instance count; default from NOT_FOUND_SCENE_SETTINGS)
	private sparklesMesh: THREE.Mesh | null = null;
	private sparkleOpacity = uniform(0.1);
	private sparkleCount = 900;
	private sparkleSpeedX = uniform(0.0);
	private sparkleSpeedY = uniform(0.0);
	private sparkleSpeedZ = uniform(1);
	private sparkleScale = uniform(0.45);

	// Portal light flicker
	private portalEmissive = uniform(16.0);
	private portalEmissiveColorUniform = uniform(new THREE.Color(0x8899aa));

	// Chromatic aberration
	private chromaticStrength = uniform(3.04);
	private chromaticScale = uniform(0.66);
	private chromaticExclusionRadius = uniform(0.3);

	// Fluid simulation
	private fluidEffect: FluidMouseField | null = null;
	private fluidActive = uniform(float(1));
	private fluidDistortionStrength = uniform(float(1));
	private fluidDebug = uniform(float(0));
	private prevMouseX: number | null = null;
	private prevMouseY: number | null = null;

	// Stored event handlers
	private onMouseMove: ((e: MouseEvent) => void) | null = null;
	private onPointerDown: ((e: PointerEvent) => void) | null = null;
	private onResize: (() => void) | null = null;
	private onMouseLeave: (() => void) | null = null;
	private onVisibilityChange: (() => void) | null = null;

	// Movement toggle (sparkles + fog + cubes animation)
	private movementEnabled = true;
	private savedFogSpeed = -5;
	private savedSparkleSpeedX = 0;
	private savedSparkleSpeedY = 0;
	private savedSparkleSpeedZ = 1;
	private savedMixerTimeScale = 1;

	// Inspector
	private inspector: InstanceType<typeof Inspector> | null = null;

	constructor(private readonly options: NotFoundSketchOptions) {
		this.ready = this.init();
	}

	private log(...args: unknown[]): void {
		if (this.debugEnabled) console.log(...args);
	}

	private warn(...args: unknown[]): void {
		if (this.debugEnabled) console.warn(...args);
	}

	private async init(): Promise<void> {
		this.nfRenderer = new NotFoundRenderer();
		await this.nfRenderer.init();
		if (this.destroyed) {
			this.nfRenderer.dispose();
			return;
		}

		this.scene = new THREE.Scene();
		this.scene.backgroundNode = color('#000');

		this.scene.fog = new THREE.FogExp2(new THREE.Color('#000'), 0.018);
		this.scene.background = new THREE.Color('#000');

		// Temporary camera (replaced by model camera)
		this.camera = new THREE.PerspectiveCamera(
			50,
			window.innerWidth / window.innerHeight,
			0.01,
			1000
		);

		// Grid plane - procedural circular dots
		const gridAspectRatio = uniform(window.innerWidth / window.innerHeight);

		// Uniforms for controlling the grid appearance
		const gridDensity = uniform(80); // Number of dots across the grid (higher = smaller dots)
		const dotRadius = uniform(0.04); // Radius of each dot (0-0.5, where 0.5 would touch neighbors)
		const dotSoftness = uniform(0.015); // Edge softness for anti-aliasing
		const dotColor = uniform(new THREE.Color(1, 1, 1));

		const gridOpacity = uniform(0.01);
		const gridMat = new MeshBasicNodeMaterial({
			transparent: true,
			depthTest: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.NormalBlending,
			visible: true
		});
		gridMat.opacityNode = gridOpacity;

		const gridPlane = new THREE.Mesh(
			new THREE.PlaneGeometry(2 * gridAspectRatio.value, 2),
			gridMat
		);
		gridPlane.name = 'GridPlane';
		gridPlane.castShadow = false;
		gridPlane.receiveShadow = false;

		// Procedural circular dot pattern shader
		gridMat.colorNode = Fn(() => {
			const baseUv = uv();
			// Scale UV by density to create grid cells
			const scaledUv = baseUv.mul(vec2(gridDensity.mul(gridAspectRatio), gridDensity));
			// Get position within each cell (0-1)
			const cellUv = fract(scaledUv);
			// Center the coordinate system (-0.5 to 0.5)
			const centered = cellUv.sub(vec2(0.5, 0.5));
			// Calculate distance from center of cell
			const dist = length(centered);
			// Create smooth circular dot with anti-aliased edges
			const dot = smoothstep(dotRadius.add(dotSoftness), dotRadius.sub(dotSoftness), dist);
			// Return white color multiplied by dot intensity
			return vec3(dot, dot, dot).mul(dotColor);
		})();

		this.scene.add(gridPlane);

		await this.loadModel();
		if (this.destroyed) return;
		this.modelReady = true;

		// Initialize fluid simulation (desktop only)
		if (!isMobile) {
			this.fluidEffect = new FluidMouseField(this.nfRenderer.renderer, {
				resolution: 128,
				splatRadius: 0.06,
				splatForce: 1000,
				curlStrength: 20,
				velocityDissipation: 0.96,
				pressureDissipation: 1.0,
				pressureIterations: 6
			});
			this.fluidEffect.uAspectRatio.value = window.innerWidth / window.innerHeight;
		}

		this.nfRenderer.setupPostProcessing({
			scene: this.scene,
			camera: this.camera,
			volumetricMesh: this.volumetricMesh,
			fogOpacity: this.fogOpacity,
			volumetricLightingIntensity: this.volumetricLightingIntensity,
			denoiseStrength: this.denoiseStrength,
			fogDensity: this.fogDensity,
			fogScattering: this.fogScattering,
			chromaticStrength: this.chromaticStrength,
			chromaticScale: this.chromaticScale,
			chromaticExclusionRadius: this.chromaticExclusionRadius,
			fluidEffect: this.fluidEffect,
			fluidDistortionStrength: this.fluidDistortionStrength,
			fluidActive: this.fluidActive,
			fluidDebug: this.fluidDebug,
			volumetricPassResolutionScale: NOT_FOUND_SCENE_SETTINGS.volumetricPassResolutionScale,
			fogScatterResolutionScale: NOT_FOUND_SCENE_SETTINGS.fogScatterResolutionScale
		});

		if (this.debugEnabled) {
			this.inspector = new Inspector();
			this.nfRenderer.renderer.inspector = this.inspector;
			document.body.appendChild(this.inspector.domElement);
			this.setupInspector();
		}
		const url = new URL(window.location.href);
		if (url.searchParams.get('fluidDebug') === '1') {
			this.fluidDebug.value = 1;
		}

		this.ensureGame();
		this.game?.prewarmForCompile();

		// Precompile + warm the post-processing pipelines and their render targets
		// BEFORE presenting. On this WebGPU pipeline, showing the scene before this
		// completes renders un-compiled shaders / un-initialized pass output as visible
		// artifacts, so this must stay ahead of the first presented frame.
		await this.warmupScene();
		if (this.destroyed) return;

		if (this.pendingGameStart) {
			this.startGame();
		} else if (this.pendingGamePreview) {
			this.previewGame();
		}

		this.startReveal();
		this.addEventListeners();
		this.animate();
		this.options.events.emit({ kind: 'ready' });
	}

	private startReveal(): void {
		this.revealProgress = 0;
		this.revealActive = true;
		this.currentFov = this.minRevealFov;
		this.camera.fov = this.minRevealFov;
		this.camera.updateProjectionMatrix();
	}

	private async loadModel(): Promise<void> {
		const dracoLoader = new DRACOLoader();
		dracoLoader.setDecoderPath('/draco/');

		const gltfLoader = new GLTFLoader();
		gltfLoader.setDRACOLoader(dracoLoader);

		// Kick off the heavy basecolor PNG (1.3MB) up front so its download overlaps the
		// GLB download/Draco decode instead of serializing after it. Consumed below.
		const basecolorPromise = new THREE.TextureLoader().loadAsync(
			'/textures/Concrete_basecolor.png'
		);
		// Don't let it surface as an unhandled rejection if the scene is destroyed first.
		basecolorPromise.catch(() => {});

		const gltf = await gltfLoader.loadAsync('/models/404.glb');
		if (this.destroyed) {
			dracoLoader.dispose();
			return;
		}

		this.gltfScene = gltf.scene;
		this.scene.add(gltf.scene);

		// Extract camera (prefer RS_Camera)
		this.extractCamera(gltf);

		// Identify objects
		this.identifyModelObjects(gltf.scene);

		// Setup animation mixer and play all animations on loop
		this.setupAnimations(gltf);

		// Setup lights (portal light from the far end)
		this.setupLights();

		// Setup volumetric fog
		this.setupVolumetricFog();

		// Setup sparkle particles that drift with the fog
		this.setupSparkles();

		// Setup floor with reflector + TSL noise
		await this.setupFloorReflection();
		if (this.destroyed) {
			dracoLoader.dispose();
			return;
		}

		// Load PBR textures for cubes (download started in parallel above)
		this.basecolorTexture = await basecolorPromise;
		if (this.destroyed) {
			dracoLoader.dispose();
			return;
		}
		this.basecolorTexture.colorSpace = THREE.SRGBColorSpace;
		this.basecolorTexture.wrapS = THREE.RepeatWrapping;
		this.basecolorTexture.wrapT = THREE.RepeatWrapping;

		// Combo lightning VFX masks — grayscale, sampled linearly (.r) as additive masks
		const tgaLoader = new TGALoader();
		const [comboBolt, comboBoltAlt, comboImpact] = await Promise.all([
			tgaLoader.loadAsync('/textures/vfx/Lightning_00_0136.tga'),
			tgaLoader.loadAsync('/textures/vfx/Lightning_00_0199.tga'),
			tgaLoader.loadAsync('/textures/vfx/Hit_00_0178.tga')
		]);
		if (this.destroyed) {
			for (const tex of [comboBolt, comboBoltAlt, comboImpact]) tex.dispose();
			dracoLoader.dispose();
			return;
		}
		for (const tex of [comboBolt, comboBoltAlt, comboImpact]) {
			tex.colorSpace = THREE.NoColorSpace;
			tex.wrapS = THREE.ClampToEdgeWrapping;
			tex.wrapT = THREE.ClampToEdgeWrapping;
		}
		this.comboBoltTexture = comboBolt;
		this.comboBoltAltTexture = comboBoltAlt;
		this.comboImpactTexture = comboImpact;

		// Apply materials to cubes and other meshes
		this.applyModelMaterials(gltf.scene);
		this.setupSecretButton();

		dracoLoader.dispose();
	}

	private extractCamera(gltf: any): void {
		// Find RS_Camera by name (the main camera in the scene)
		let rsCamera: THREE.PerspectiveCamera | null = null;

		if (gltf.cameras && gltf.cameras.length > 0) {
			for (const cam of gltf.cameras) {
				if (cam instanceof THREE.PerspectiveCamera) {
					// The RS_Camera node has name containing RS
					const camObj = this.findCameraObject(gltf.scene, cam);
					if (camObj && camObj.name.includes('RS')) {
						rsCamera = cam;
						break;
					}
				}
			}
			// Fallback to first camera
			if (!rsCamera) {
				rsCamera = gltf.cameras[0] as THREE.PerspectiveCamera;
			}
		}

		if (rsCamera) {
			this.camera.fov = rsCamera.fov;
			this.camera.aspect = window.innerWidth / window.innerHeight;
			this.camera.updateProjectionMatrix();

			const worldPos = new THREE.Vector3();
			const worldQuat = new THREE.Quaternion();
			rsCamera.getWorldPosition(worldPos);
			rsCamera.getWorldQuaternion(worldQuat);

			this.camera.position.copy(worldPos);
			this.camera.quaternion.copy(worldQuat);

			this.baseCameraPosition.copy(worldPos);
			this.baseCameraQuaternion.copy(worldQuat);
			this.baseFov = this.camera.fov;
			this.currentFov = this.camera.fov;

			// Forward direction from camera orientation
			this.cameraForwardDirection.set(0, 0, -1).applyQuaternion(worldQuat).normalize();

			this.log('[404] Using camera from model:', {
				fov: this.camera.fov,
				position: worldPos.toArray(),
				near: this.camera.near,
				far: this.camera.far
			});
		} else {
			this.camera.position.set(0, 0.5, -1.7);
			this.camera.lookAt(0, 0.5, -10);
			this.baseCameraPosition.copy(this.camera.position);
			this.baseCameraQuaternion.copy(this.camera.quaternion);
			this.baseFov = this.camera.fov;
			this.currentFov = this.camera.fov;
			this.cameraForwardDirection.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
			this.warn('[404] No camera found in model, using fallback');
		}
	}

	private findCameraObject(scene: THREE.Object3D, camera: THREE.Camera): THREE.Object3D | null {
		let found: THREE.Object3D | null = null;
		scene.traverse((child) => {
			if ((child as any).isCamera && child === camera) {
				found = child;
			}
			// Also check if the child contains the camera
			if (child.children.includes(camera)) {
				found = child;
			}
		});
		// Check parent of camera
		if (!found && camera.parent) {
			found = camera.parent;
		}
		return found;
	}

	private identifyModelObjects(scene: THREE.Group): void {
		scene.traverse((child) => {
			const name = child.name;

			if (child instanceof THREE.Mesh) {
				const wp = new THREE.Vector3();
				child.getWorldPosition(wp);

				if (name === 'Floor' || name === 'Floor_2') {
					this.floorMeshes.push(child);
					if (name === 'Floor') {
						this.floorMesh = child;
					}
					this.log(
						'[404] Found',
						name,
						'at world:',
						wp.toArray().map((v) => +v.toFixed(2))
					);
				} else if (name.startsWith('Cube')) {
					this.cubeObjects.push(child);
					this.log(
						'[404] Found cube:',
						name,
						'at world:',
						wp.toArray().map((v) => +v.toFixed(2))
					);
				} else if (name === 'Portal') {
					this.portalMesh = child;
					this.log(
						'[404] Found portal at world:',
						wp.toArray().map((v) => +v.toFixed(2))
					);
				}
			}
		});

		// Log scene bounding box for context
		const bb = new THREE.Box3().setFromObject(scene);
		const size = new THREE.Vector3();
		const center = new THREE.Vector3();
		bb.getSize(size);
		bb.getCenter(center);
		this.log(
			'[404] Scene bounds — size:',
			size.toArray().map((v) => +v.toFixed(2)),
			'center:',
			center.toArray().map((v) => +v.toFixed(2))
		);
	}

	private setupAnimations(gltf: any): void {
		if (!gltf.animations || gltf.animations.length === 0) {
			this.warn('[404] No animations in model');
			return;
		}

		this.mixer = new THREE.AnimationMixer(gltf.scene);

		for (const clip of gltf.animations) {
			const action = this.mixer.clipAction(clip);
			action.setLoop(THREE.LoopRepeat, Infinity);
			action.play();

			if (clip.duration > this.animationDuration) {
				this.animationDuration = clip.duration;
			}
		}

		this.log(
			'[404] Playing',
			gltf.animations.length,
			'animations, duration:',
			this.animationDuration.toFixed(2) + 's'
		);
	}

	private setupLights(): void {
		// Dynamically find portal and camera world positions to place lights correctly
		const portalPos = new THREE.Vector3();
		const camPos = new THREE.Vector3();
		camPos.copy(this.baseCameraPosition);

		if (this.portalMesh) {
			this.portalMesh.getWorldPosition(portalPos);
		} else {
			// Fallback: guess portal is far ahead of camera along its forward direction
			portalPos.copy(camPos).addScaledVector(this.cameraForwardDirection, 80);
		}

		this.log('[404] Light setup — camera:', camPos.toArray(), 'portal:', portalPos.toArray());

		// Main portal light — warm white cone from behind the portal
		const mainLight = new THREE.SpotLight(
			new THREE.Color('#fff'),
			20,
			60,
			Math.PI / 2.5,
			0.8,
			0.85
		);
		// Place slightly behind & above portal, pointing toward camera
		mainLight.position.copy(portalPos).add(
			this.cameraForwardDirection
				.clone()
				.multiplyScalar(-5)
				.add(new THREE.Vector3(0, 2, 0))
		);
		mainLight.target.position.copy(this.camera.position);
		mainLight.castShadow = true;
		mainLight.shadow.mapSize.setScalar(NOT_FOUND_SCENE_SETTINGS.mainShadowMapSize);
		mainLight.shadow.bias = -0.003;
		mainLight.shadow.normalBias = 0.15;
		mainLight.layers.enable(LAYER_VOLUMETRIC_LIGHTING);

		// Main light helper (hidden by default)
		const mainLightHelper = new THREE.SpotLightHelper(mainLight);
		mainLightHelper.visible = false;
		this.scene.add(mainLightHelper);
		this.lightHelpers.push(mainLightHelper);

		this.scene.add(mainLight);
		this.scene.add(mainLight.target);

		this.portalLights.push(mainLight);

		// Top-left ceiling SpotLight — focused cone creating diagonal highlight on left wall
		const topLeftTarget = new THREE.Vector3(0, 0, -15);
		topLeftTarget.y -= 2;
		const topLeftLight = new THREE.SpotLight(new THREE.Color('#fff'), 5.26, 100, 0.2, 1.0, 0.5);
		topLeftLight.position.copy(camPos).add(
			this.cameraForwardDirection
				.clone()
				.multiplyScalar(15)
				.add(new THREE.Vector3(-34.5, 15, -48))
		);
		topLeftLight.target.position.copy(topLeftTarget);
		topLeftLight.castShadow = true;
		topLeftLight.shadow.mapSize.setScalar(NOT_FOUND_SCENE_SETTINGS.topShadowMapSize);
		topLeftLight.shadow.bias = -0.0003;
		topLeftLight.shadow.normalBias = 0.15;
		topLeftLight.layers.enable(LAYER_VOLUMETRIC_LIGHTING);
		this.scene.add(topLeftLight);
		this.scene.add(topLeftLight.target);
		this.portalLights.push(topLeftLight);

		// Top-left light helper (hidden by default)
		const topLeftLightHelper = new THREE.SpotLightHelper(topLeftLight);
		topLeftLightHelper.visible = false;
		this.scene.add(topLeftLightHelper);
		this.lightHelpers.push(topLeftLightHelper);

		// Hemisphere fill light — simulates indirect bounce light in the corridor
		// const hemiLight = new THREE.HemisphereLight(0x8899aa, 0x222222, 0.1);
		// this.scene.add(hemiLight);
	}

	private createNoiseTexture3D(size: number): THREE.Data3DTexture {
		const data = new Uint8Array(size * size * size);
		const scale = 10;
		const perlin = new ImprovedNoise();
		const repeatFactor = 5.0;
		let i = 0;

		for (let z = 0; z < size; z++) {
			for (let y = 0; y < size; y++) {
				for (let x = 0; x < size; x++) {
					const nx = (x / size) * repeatFactor;
					const ny = (y / size) * repeatFactor;
					const nz = (z / size) * repeatFactor;
					const noiseValue = perlin.noise(nx * scale, ny * scale, nz * scale);
					data[i] = 128 + 128 * noiseValue;
					i++;
				}
			}
		}

		const tex = new THREE.Data3DTexture(data, size, size, size);
		tex.format = THREE.RedFormat;
		tex.minFilter = THREE.LinearFilter;
		tex.magFilter = THREE.LinearFilter;
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.RepeatWrapping;
		tex.unpackAlignment = 1;
		tex.needsUpdate = true;
		return tex;
	}

	private setupVolumetricFog(): void {
		const q = NOT_FOUND_SCENE_SETTINGS;
		this.noiseTexture3D = this.createNoiseTexture3D(q.noiseTextureSize);

		const volumetricMaterial = createVolumetricMaterial(
			this.noiseTexture3D,
			this.smokeAmount,
			this.fogSpeed,
			q.volumetricSteps
		);

		const segs = q.volumetricSphereSegments;
		this.volumetricMesh = new THREE.Mesh(
			new THREE.SphereGeometry(15, segs, segs),
			volumetricMaterial
		);
		this.volumetricMesh.position.copy(this.baseCameraPosition);
		this.volumetricMesh.receiveShadow = true;

		this.volumetricMesh.layers.disableAll();
		this.volumetricMesh.layers.enable(LAYER_VOLUMETRIC_LIGHTING);

		this.scene.add(this.volumetricMesh);
	}

	private setupSparkles(): void {
		const material = new SpriteNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			fog: false
		});

		// Per-instance randoms (stable per particle, generated once)
		const randLifetimeOffset = range(0.0, 1.0);
		const randSpawnX = range(-6.0, 6.0);
		const randSpawnY = range(-2.0, 3.0);
		const randSpawnZ = range(-10.0, 10.0);
		const randBrightness = range(0.4, 1.0);
		const randBaseScale = range(0.02, 0.06);
		const randDriftFactor = range(0.5, 1.2);

		// Lifecycle: staggered repeating cycle per particle (slower pace)
		const sparkleLifetime = float(8.0);
		const particleTime = time.add(randLifetimeOffset.mul(sparkleLifetime));
		const cycleProgress = particleTime.div(sparkleLifetime).fract();

		// Sparkle fade: soft in (0→0.15), hold, soft out (0.5→1.0) — gentle twinkle
		const fadeIn = smoothstep(0.0, 0.15, cycleProgress);
		const fadeOut = smoothstep(1.0, 0.5, cycleProgress);
		const lifetimeFade = fadeIn.mul(fadeOut);

		// Position: spawn offset + 3-axis drift controlled by speed uniforms
		const driftX = cycleProgress.mul(float(8.0)).mul(randDriftFactor).mul(this.sparkleSpeedX);
		const driftY = cycleProgress.mul(float(8.0)).mul(randDriftFactor).mul(this.sparkleSpeedY);
		const driftZ = cycleProgress.mul(float(8.0)).mul(randDriftFactor).mul(this.sparkleSpeedZ);
		material.positionNode = vec3(
			randSpawnX.add(driftX),
			randSpawnY.add(driftY),
			randSpawnZ.add(driftZ)
		);

		// Scale: visible sparkle size × global scale multiplier
		material.scaleNode = vec2(randBaseScale)
			.mul(this.sparkleScale)
			.mul(lifetimeFade.clamp(0.1, 1.0));

		// Rotation: slow random spin
		const randRotation = range(0.0, Math.PI * 2);
		material.rotationNode = randRotation.add(time.mul(0.15));

		// Color: white with slight warm/cool variation
		const warmCool = range(0.0, 1.0);
		const sparkleColor = mix(
			vec3(0.7, 0.8, 1.0), // cool blue-white
			vec3(1.0, 0.95, 0.85), // warm yellow-white
			warmCool
		);
		material.colorNode = sparkleColor.mul(randBrightness);

		// Radial edge softening for each billboard quad
		const centeredUv = uv().sub(vec2(0.5));
		const radialDist = centeredUv.length().mul(2.0);
		const edgeSoftness = smoothstep(1.0, 0.2, radialDist);

		// Opacity: lifecycle × brightness × global control × edge softness
		material.opacityNode = lifetimeFade
			.mul(randBrightness)
			.mul(this.sparkleOpacity)
			.mul(edgeSoftness);

		// Create mesh with instanced count
		const geometry = new THREE.PlaneGeometry(1, 1);
		this.sparklesMesh = new THREE.Mesh(geometry, material);
		this.sparklesMesh.count = this.sparkleCount;
		this.sparklesMesh.frustumCulled = false;
		this.sparklesMesh.name = 'SparkleParticles';
		this.sparklesMesh.position.copy(this.baseCameraPosition);
		this.sparklesMesh.scale.setScalar(1);

		this.scene.add(this.sparklesMesh);
	}

	private recreateSparkles(): void {
		if (this.sparklesMesh) {
			this.sparklesMesh.geometry.dispose();
			(this.sparklesMesh.material as THREE.Material).dispose();
			this.scene.remove(this.sparklesMesh);
			this.sparklesMesh = null;
		}
		this.setupSparkles();
	}

	private async setupFloorReflection(): Promise<void> {
		if (!this.floorMesh) {
			this.warn('[404] No floor mesh found, skipping reflection setup');
			return;
		}

		// Reflector for wet floor reflections
		const floorReflectorNode = reflector({
			resolutionScale: NOT_FOUND_SCENE_SETTINGS.floorReflectorResolutionScale
		});
		this.floorReflector = floorReflectorNode;
		floorReflectorNode.target.rotateX(-Math.PI / 2);
		const floorWorldPos = new THREE.Vector3();
		this.floorMesh.getWorldPosition(floorWorldPos);
		floorReflectorNode.target.position.copy(floorWorldPos);
		this.scene.add(floorReflectorNode.target);

		// Floor material: dark wet marble with procedural noise roughness
		const floorMaterial = new MeshStandardNodeMaterial();

		// positionLocal as vec3: moves with the mesh, both meshes share geometry
		// so local coords match at the junction = seamless. Full vec3 avoids
		// wrong-axis stretching regardless of mesh orientation.
		const floorPos = positionLocal.mul(this.floorNoiseScale);

		// Large-scale fractal noise for broad roughness variation (wet/dry patches)
		const largeNoise = mx_fractal_noise_float(floorPos, 4, 2.0, 0.5);
		// Medium-scale noise for marble-like veining (domain warp in 3D)
		const veinPos = floorPos.add(
			vec3(largeNoise.mul(0.8), largeNoise.mul(0.3), largeNoise.mul(0.6)).add(time.mul(0.01))
		);
		const veinNoise = mx_noise_float(veinPos.mul(2.5));
		// Sharp veining from absolute-value (turbulence technique)
		const veins = float(1.0).sub(abs(veinNoise).mul(2.0)).clamp(0.0, 1.0);
		const veinPattern = smoothstep(0.4, 0.9, veins);

		// Combine: low roughness = wet/glossy, high roughness = matte patches
		const roughnessNoise = largeNoise.mul(0.5).add(0.5); // remap -1..1 to 0..1
		const baseRoughness = mix(this.floorRoughnessLow, this.floorRoughnessHigh, roughnessNoise);
		// Veins get slightly lower roughness (they look wet/polished)
		floorMaterial.roughnessNode = baseRoughness.sub(veinPattern.mul(0.15)).clamp(0.02, 1.0);

		// Dark marble color with subtle vein highlights
		const baseColor = vec3(this.floorDarkness, this.floorDarkness, this.floorDarkness);
		const veinColor = vec3(
			this.floorVeinStrength,
			this.floorVeinStrength.mul(0.95),
			this.floorVeinStrength.mul(0.9)
		);
		floorMaterial.colorNode = mix(baseColor, veinColor, veinPattern);
		floorMaterial.metalnessNode = float(0.1);
		floorMaterial.emissiveNode = floorReflectorNode.mul(this.floorReflectionIntensity);

		this.floorMesh.material = floorMaterial;
		this.floorMesh.receiveShadow = false;

		// Apply same material to Floor_2
		this.gltfScene?.traverse((child) => {
			if (child instanceof THREE.Mesh && child.name === 'Floor_2') {
				child.material = floorMaterial;
				child.receiveShadow = false;
			}
		});
	}

	private applyModelMaterials(scene: THREE.Group): void {
		// Compute triplanar texture scale from Cube_1's bounding box
		// so all cubes get the same texel density regardless of size
		const refCube = this.cubeObjects.find((c) => c.name === 'Cube_1');
		if (refCube) {
			refCube.geometry.computeBoundingBox();
			const refSize = new THREE.Vector3();
			refCube.geometry.boundingBox!.getSize(refSize);
			const maxDim = Math.max(refSize.x, refSize.y, refSize.z);
			// 1 texture repeat per maxDim units of local space
			this.cubeTextureBaseScale = maxDim > 0.01 ? 1.0 / maxDim : 1.0;
			this.cubeTextureScale.value = this.cubeTextureBaseScale * this.cubeTextureScaleMul.value;
			this.log(
				'[404] Cube_1 ref size:',
				refSize.toArray().map((v) => +v.toFixed(4)),
				'triplanar scale:',
				this.cubeTextureScale.value.toFixed(6)
			);
		}

		// PBR physical material for cubes using triplanar texture projection
		// This ensures consistent texel density across cubes of different sizes
		const cubeMaterial = new MeshPhysicalNodeMaterial();
		if (this.basecolorTexture) {
			// Use triplanar projection for base color
			const basecolorNode = texture(this.basecolorTexture);
			const triplanarColor = triplanarTexture(
				basecolorNode,
				basecolorNode,
				basecolorNode,
				this.cubeTextureScale,
				positionLocal,
				normalLocal
			);
			cubeMaterial.colorNode = triplanarColor;
		}

		cubeMaterial.roughnessNode = float(1);
		cubeMaterial.metalnessNode = this.cubeMetalness;
		cubeMaterial.clearcoatNode = this.cubeClearcoat;
		cubeMaterial.clearcoatRoughnessNode = this.cubeClearcoatRoughness;

		// Fallback material for non-cube meshes
		const defaultMaterial = new MeshStandardNodeMaterial({
			color: 0x1a1a1e,
			roughness: 0.82,
			metalness: 0.02
		});

		// Portal material — bright emissive white (the light at the end)
		const portalMaterial = new MeshStandardNodeMaterial({
			color: 0xffffff,
			roughness: 0.0,
			metalness: 0.0,
			side: THREE.DoubleSide
		});
		portalMaterial.emissiveNode = vec3(this.portalEmissiveColorUniform).mul(this.portalEmissive);
		portalMaterial.fog = false;

		scene.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;

			// Skip floor meshes (already has reflection material)
			if (child.name === 'Floor' || child.name === 'Floor_2') return;

			// Disable frustum culling so animated objects stay visible in the
			// floor reflector pass even when their bounding sphere drifts outside
			// the mirrored camera frustum during animation.
			child.frustumCulled = false;

			const name = child.name;

			if (name.startsWith('Cube')) {
				child.material = cubeMaterial;
			} else if (name === 'Portal') {
				child.material = portalMaterial;
				child.frustumCulled = false;
				this.log(
					'[404] Portal material applied — pos:',
					child
						.getWorldPosition(new THREE.Vector3())
						.toArray()
						.map((v: number) => +v.toFixed(2)),
					'scale:',
					child.scale.toArray().map((v: number) => +v.toFixed(4))
				);
			} else {
				child.material = defaultMaterial;
			}

			child.castShadow = true;
			// Cubes don't receive shadows — avoids shadow acne stripes at
			// grazing spotlight angles while the corridor is already dark enough
			// that inter-cube shadows aren't visually needed.
			child.receiveShadow = !name.startsWith('Cube');
		});
	}

	private setupSecretButton(): void {
		const radius = isMobile ? 3 : 0.92;

		const group = new THREE.Group();
		group.name = 'VoidSecretButton';
		group.scale.setScalar(radius);
		group.userData.baseScale = radius;

		const plateMaterial = new MeshStandardNodeMaterial({
			color: 0xdff7ff,
			roughness: 0.28,
			metalness: 0.12,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			side: THREE.DoubleSide
		});
		plateMaterial.opacityNode = this.secretButtonPlateOpacity;
		plateMaterial.emissiveNode = vec3(0.78, 0.92, 1).mul(this.secretButtonPlateGlow);

		const rimMaterial = new MeshStandardNodeMaterial({
			color: 0xffffff,
			roughness: 0.2,
			metalness: 0,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			side: THREE.DoubleSide
		});
		rimMaterial.opacityNode = this.secretButtonRimOpacity;
		rimMaterial.emissiveNode = vec3(1, 1, 1).mul(this.secretButtonRimGlow);

		const hitMaterial = new MeshBasicNodeMaterial({
			transparent: true,
			opacity: 0,
			depthTest: false,
			depthWrite: false,
			side: THREE.DoubleSide
		});

		const plate = new THREE.Mesh(
			new THREE.CircleGeometry(0.54, 8).rotateZ(Math.PI / 8),
			plateMaterial
		);
		plate.name = 'VoidSecretButtonPlate';
		plate.renderOrder = 4;
		const rim = new THREE.Mesh(
			new THREE.RingGeometry(0.42, 0.54, 8).rotateZ(Math.PI / 8),
			rimMaterial
		);
		rim.name = 'VoidSecretButtonRim';
		rim.position.z = 0.01;
		rim.renderOrder = 5;
		const hitArea = new THREE.Mesh(new THREE.CircleGeometry(0.92, 24), hitMaterial);
		hitArea.name = 'VoidSecretButtonHitArea';
		hitArea.position.z = 0.02;
		hitArea.renderOrder = 6;

		group.add(plate, rim, hitArea);
		this.scene.add(group);
		this.secretButtonGroup = group;
		this.updateSecretButtonPlacement();
	}

	private secretButtonContains(clientX: number, clientY: number): boolean {
		if (
			!this.secretButtonGroup ||
			!this.secretButtonGroup.visible ||
			this.isTransitioning ||
			this.game?.active
		) {
			return false;
		}

		this.secretButtonPointer.set(
			(clientX / Math.max(1, window.innerWidth)) * 2 - 1,
			-(clientY / Math.max(1, window.innerHeight)) * 2 + 1
		);
		this.secretButtonRaycaster.setFromCamera(this.secretButtonPointer, this.camera);
		this.secretButtonIntersections.length = 0;
		this.secretButtonRaycaster.intersectObject(
			this.secretButtonGroup,
			true,
			this.secretButtonIntersections
		);
		const contains = this.secretButtonIntersections.length > 0;
		this.secretButtonIntersections.length = 0;
		return contains;
	}

	private updateSecretButtonPlacement(): void {
		if (
			!this.secretButtonGroup ||
			!this.secretButtonGroup.visible ||
			this.isTransitioning ||
			this.game?.active ||
			this.cubeObjects.length === 0
		) {
			return;
		}

		this.camera.updateMatrixWorld();
		for (const cube of this.cubeObjects) {
			cube.updateMatrixWorld();
		}

		for (const target of this.secretButtonTargets) {
			this.secretButtonRaycaster.setFromCamera(target, this.camera);
			this.secretButtonIntersections.length = 0;
			this.secretButtonRaycaster.intersectObjects(
				this.cubeObjects,
				false,
				this.secretButtonIntersections
			);
			const hit = this.secretButtonIntersections[0];
			if (!hit) continue;

			const normal = this.secretButtonNormal;
			if (hit.face) {
				normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
			} else {
				normal.copy(this.baseCameraPosition).sub(hit.point).normalize();
			}
			const directionToCamera = this.secretButtonDirectionToCamera
				.copy(this.camera.position)
				.sub(hit.point)
				.normalize();
			if (normal.dot(directionToCamera) < 0) normal.negate();

			this.secretButtonGroup.position.copy(hit.point).addScaledVector(normal, 0.035);
			this.secretButtonGroup.quaternion.setFromUnitVectors(this.secretButtonForwardNormal, normal);
			this.secretButtonIntersections.length = 0;
			return;
		}
	}

	private setSecretButtonHovered(hovered: boolean): void {
		if (this.secretButtonHovered === hovered) return;
		this.secretButtonHovered = hovered;
		if (!this.secretButtonGroup) return;

		this.secretButtonPlateOpacity.value = hovered ? 0.72 : 0.1;
		this.secretButtonRimOpacity.value = hovered ? 0.95 : 0.16;
		this.secretButtonPlateGlow.value = hovered ? 3.2 : 0.35;
		this.secretButtonRimGlow.value = hovered ? 6 : 0.65;
		const baseScale = this.secretButtonGroup.userData.baseScale ?? 1;
		this.secretButtonGroup.scale.setScalar(baseScale * (hovered ? 1.16 : 1));
	}

	private updateSecretButton(delta: number): void {
		if (!this.secretButtonGroup || !this.secretButtonGroup.visible || this.game?.active) return;

		this.updateSecretButtonPlacement();
		this.secretButtonPulseTime += delta;
		const baseScale = this.secretButtonGroup.userData.baseScale ?? 1;
		const hoverScale = this.secretButtonHovered ? 1.18 : 1;
		const pulseAmount = this.secretButtonHovered ? 0.055 : 0.014;
		const pulseScale = 1 + Math.sin(this.secretButtonPulseTime * 4.2) * pulseAmount;
		this.secretButtonGroup.scale.setScalar(baseScale * hoverScale * pulseScale);
	}

	private disposeSecretButton(): void {
		if (!this.secretButtonGroup) return;

		this.scene?.remove(this.secretButtonGroup);
		this.secretButtonGroup.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			child.geometry.dispose();
			if (Array.isArray(child.material)) {
				child.material.forEach((material) => material.dispose());
			} else {
				child.material.dispose();
			}
		});
		this.secretButtonGroup = null;
	}

	private setupInspector(): void {
		if (!this.inspector) return;

		// ── Movement Toggle (sparkles + fog + cubes) ────────
		const movementState = { enabled: this.movementEnabled };
		const genGui = this.inspector.createParameters('General');
		genGui
			.add(movementState, 'enabled')
			.name('Enable Movement')
			.onChange((v: boolean) => {
				this.movementEnabled = v;
				if (!v) {
					// Save current values
					this.savedFogSpeed = this.fogSpeed.value;
					this.savedSparkleSpeedX = this.sparkleSpeedX.value;
					this.savedSparkleSpeedY = this.sparkleSpeedY.value;
					this.savedSparkleSpeedZ = this.sparkleSpeedZ.value;
					if (this.mixer) this.savedMixerTimeScale = this.mixer.timeScale || 1;
					// Freeze everything
					this.fogSpeed.value = 0;
					this.sparkleSpeedX.value = 0;
					this.sparkleSpeedY.value = 0;
					this.sparkleSpeedZ.value = 0;
					if (this.mixer) this.mixer.timeScale = 0;
				} else {
					// Restore saved values
					this.fogSpeed.value = this.savedFogSpeed;
					this.sparkleSpeedX.value = this.savedSparkleSpeedX;
					this.sparkleSpeedY.value = this.savedSparkleSpeedY;
					this.sparkleSpeedZ.value = this.savedSparkleSpeedZ;
					if (this.mixer) this.mixer.timeScale = this.savedMixerTimeScale;
				}
			});

		// ── Fog ──────────────────────────────────────────────
		const fogGui = this.inspector.createParameters('Volumetric Fog');

		fogGui.add(this.smokeAmount, 'value', 0, 5).name('Smoke Amount');
		fogGui.add(this.volumetricLightingIntensity, 'value', 0, 5).name('Intensity');
		fogGui.add(this.fogOpacity, 'value', 0, 1, 0.01).name('Opacity');
		fogGui.add(this.denoiseStrength, 'value', 0, 2).name('Denoise');

		fogGui.add(this.fogSpeed, 'value', -10, 10, 0.1).name('Flow Speed');

		const scatteringFolder = fogGui.addFolder('Scattering');
		scatteringFolder
			.add(this.fogDensity, 'value', 0.001, 0.05)
			.step(0.001)
			.name('Density')
			.onChange((v: number) => {
				if (this.scene.fog instanceof THREE.FogExp2) {
					this.scene.fog.density = v;
				}
			});
		scatteringFolder.add(this.fogScattering, 'value', 0, 5).name('Blur');
		closeInspectorGroup(scatteringFolder);

		if (this.volumetricMesh) {
			const sphereFolder = fogGui.addFolder('Sphere Position');
			sphereFolder.add(this.volumetricMesh.position, 'x', -100, 100, 0.5).name('X');
			sphereFolder.add(this.volumetricMesh.position, 'y', -50, 100, 0.5).name('Y');
			sphereFolder.add(this.volumetricMesh.position, 'z', -200, 200, 0.5).name('Z');
			closeInspectorGroup(sphereFolder);
		}

		closeInspectorGroup(fogGui);

		// ── Cubes ───────────────────────────────────────────
		const cubesGui = this.inspector.createParameters('Cubes');
		cubesGui
			.add(this.cubeTextureScaleMul, 'value', 0.1, 10, 0.01)
			.name('Texture Scale')
			.onChange((v: number) => {
				this.cubeTextureScale.value = this.cubeTextureBaseScale * v;
			});
		cubesGui.add(this.cubeNormalScale, 'value', 0, 3, 0.01).name('Normal Scale');
		cubesGui.add(this.cubeMetalness, 'value', 0, 1, 0.01).name('Metalness');
		cubesGui.add(this.cubeClearcoat, 'value', 0, 1, 0.01).name('Clearcoat');
		cubesGui.add(this.cubeClearcoatRoughness, 'value', 0, 1, 0.01).name('Clearcoat Roughness');

		if (this.mixer) {
			const animFolder = cubesGui.addFolder('Animation');
			const animState = { paused: false, timeScale: this.mixer.timeScale };
			animFolder
				.add(animState, 'paused')
				.name('Paused')
				.onChange((paused: boolean) => {
					if (!this.mixer) return;
					if (paused) {
						animState.timeScale = this.mixer.timeScale || 1.0;
						this.mixer.timeScale = 0;
					} else {
						this.mixer.timeScale = animState.timeScale;
					}
				});
			animFolder
				.add(animState, 'timeScale', 0, 3, 0.01)
				.name('Time Scale')
				.onChange((v: number) => {
					if (!this.mixer) return;
					if (animState.paused) {
						// Store for when we unpause
						animState.timeScale = v;
					} else {
						this.mixer.timeScale = v;
					}
				});
			closeInspectorGroup(animFolder);
		}

		closeInspectorGroup(cubesGui);

		// ── Lighting ─────────────────────────────────────────
		const lightingGui = this.inspector.createParameters('Lighting');

		const updateHelpers = () => {
			for (const helper of this.lightHelpers) {
				if (helper.visible) helper.update();
			}
		};
		this.portalLights.forEach((light, i) => {
			const f = lightingGui.addFolder(`Light ${i}`);
			if (this.lightHelpers[i]) {
				f.add(this.lightHelpers[i], 'visible').name('Show Helper');
			}
			f.addColor(light, 'color').name('Color').onChange(updateHelpers);
			f.add(light, 'intensity', 0, 500).name('Intensity');
			f.add(light, 'angle', 0.01, Math.PI / 2, 0.01)
				.name('Angle')
				.onChange(updateHelpers);
			f.add(light, 'penumbra', 0, 1, 0.01).name('Penumbra');
			f.add(light, 'distance', 0, 1000).name('Distance').onChange(updateHelpers);
			f.add(light, 'decay', 0, 5, 0.1).name('Decay');
			f.add(light.position, 'x', -100, 100, 0.5).name('Pos X').onChange(updateHelpers);
			f.add(light.position, 'y', -50, 100, 0.5).name('Pos Y').onChange(updateHelpers);
			f.add(light.position, 'z', -200, 200, 0.5).name('Pos Z').onChange(updateHelpers);
			closeInspectorGroup(f);
		});

		closeInspectorGroup(lightingGui);

		// ── Floor ────────────────────────────────────────────
		const floorGui = this.inspector.createParameters('Floor');
		floorGui.add(this.floorReflectionIntensity, 'value', 0, 2, 0.01).name('Reflection Intensity');
		floorGui.add(this.floorNoiseScale, 'value', 0.0001, 1.0, 0.005).name('Noise Scale');
		floorGui.add(this.floorRoughnessLow, 'value', 0, 1, 0.01).name('Roughness Low');
		floorGui.add(this.floorRoughnessHigh, 'value', 0, 1, 0.01).name('Roughness High');
		floorGui.add(this.floorDarkness, 'value', 0, 0.2, 0.001).name('Base Darkness');
		floorGui.add(this.floorVeinStrength, 'value', 0, 0.3, 0.001).name('Vein Strength');
		closeInspectorGroup(floorGui);

		// ── Sparkles ─────────────────────────────────────────
		const sparkleGui = this.inspector.createParameters('Sparkles');
		sparkleGui.add(this.sparkleOpacity, 'value', 0, 2, 0.01).name('Opacity');
		sparkleGui.add(this.sparkleScale, 'value', 0.1, 5, 0.01).name('Particle Scale');

		const sparkleCountObj = { count: this.sparkleCount };
		sparkleGui
			.add(sparkleCountObj, 'count', 50, 2000, 1)
			.name('Count')
			.onChange((v: number) => {
				this.sparkleCount = v;
				this.recreateSparkles();
			});

		const sparkleSpeedFolder = sparkleGui.addFolder('Speed');
		sparkleSpeedFolder.add(this.sparkleSpeedX, 'value', -5, 5, 0.01).name('X');
		sparkleSpeedFolder.add(this.sparkleSpeedY, 'value', -5, 5, 0.01).name('Y');
		sparkleSpeedFolder.add(this.sparkleSpeedZ, 'value', -5, 5, 0.01).name('Z');

		closeInspectorGroup(sparkleGui);

		// ── Camera ───────────────────────────────────────────
		const cameraGui = this.inspector.createParameters('Camera');
		cameraGui.add(this.camera.position, 'x', -100, 100, 0.5).name('Pos X');
		cameraGui.add(this.camera.position, 'y', -50, 100, 0.5).name('Pos Y');
		cameraGui.add(this.camera.position, 'z', -200, 200, 0.5).name('Pos Z');
		const cameraDebug = { fov: this.baseFov };
		cameraGui
			.add(cameraDebug, 'fov', 10, 120)
			.name('FOV')
			.onChange((v: number) => {
				this.baseFov = v;
				this.currentFov = v;
			});
		closeInspectorGroup(cameraGui);

		// ── Bloom ────────────────────────────────────────────
		if (this.nfRenderer.bloomPass) {
			const bloomGui = this.inspector.createParameters('Bloom');
			const bloomDebug = { strength: 0.1, radius: 0.2, threshold: 0.85 };
			bloomGui
				.add(bloomDebug, 'strength', 0, 3, 0.01)
				.name('Strength')
				.onChange((v: number) => {
					this.nfRenderer.bloomPass!.strength.value = v;
				});
			bloomGui
				.add(bloomDebug, 'radius', 0, 1, 0.01)
				.name('Radius')
				.onChange((v: number) => {
					this.nfRenderer.bloomPass!.radius.value = v;
				});
			bloomGui
				.add(bloomDebug, 'threshold', 0, 1, 0.01)
				.name('Threshold')
				.onChange((v: number) => {
					this.nfRenderer.bloomPass!.threshold.value = v;
				});
			closeInspectorGroup(bloomGui);
		}

		// ── Chromatic Aberration ─────────────────────────────
		const caGui = this.inspector.createParameters('Chromatic Aberration');
		const caDebug = {
			strength: this.chromaticStrength.value,
			scale: this.chromaticScale.value,
			exclusionRadius: this.chromaticExclusionRadius.value
		};
		caGui
			.add(caDebug, 'strength', 0, 5, 0.01)
			.name('Strength')
			.onChange((v: number) => {
				this.chromaticStrength.value = v;
			});
		caGui
			.add(caDebug, 'scale', 0, 5, 0.01)
			.name('Scale')
			.onChange((v: number) => {
				this.chromaticScale.value = v;
			});
		caGui
			.add(caDebug, 'exclusionRadius', 0, 0.8, 0.01)
			.name('Exclusion Radius')
			.onChange((v: number) => {
				this.chromaticExclusionRadius.value = v;
			});
		closeInspectorGroup(caGui);

		// ── Fluid Distortion ────────────────────────────────
		if (this.fluidEffect) {
			const f = this.fluidEffect;
			const fluidGui = this.inspector.createParameters('Fluid Distortion');
			fluidGui.add(this.fluidActive, 'value', 0, 1, 1).name('Active');
			fluidGui.add(this.fluidDistortionStrength, 'value', 0, 4, 0.01).name('Distortion Strength');
			fluidGui.add(this.fluidDebug, 'value', 0, 1, 1).name('Debug: show velocity');

			fluidGui.add(f.uSplatRadius, 'value', 0.001, 0.5, 0.001).name('Splat Radius');
			fluidGui.add(f.uSplatForce, 'value', 1, 1000, 1).name('Splat Force');
			fluidGui.add(f.uCurlStrength, 'value', 0, 60, 0.5).name('Curl Strength');
			fluidGui.add(f.uVelocityDissipation, 'value', 0.9, 1, 0.001).name('Velocity Dissipation');
			fluidGui.add(f.uPressureDissipation, 'value', 0.5, 1, 0.001).name('Pressure Dissipation');
			fluidGui.add(f, 'pressureIterations', 1, 30, 1).name('Pressure Iterations');
			closeInspectorGroup(fluidGui);
		}

		// ── Renderer ─────────────────────────────────────────
		const rendererDebug = {
			backgroundColor: new THREE.Color('#17181A')
		};
		genGui.add(this.nfRenderer.renderer, 'toneMappingExposure', 0.1, 5).name('Exposure');
		genGui.addColor(rendererDebug, 'backgroundColor').onChange((c: THREE.Color) => {
			this.scene.backgroundNode = color(c);
		});
		const portalColorDebug = { color: new THREE.Color(1, 1, 1) };
		genGui
			.addColor(portalColorDebug, 'color')
			.name('Portal Emissive Color')
			.onChange((c: THREE.Color) => {
				this.portalEmissiveColorUniform.value.copy(c);
			});

		if (this.scene.fog) {
			const fogDebug = {
				color: (this.scene.fog as THREE.FogExp2).color.clone(),
				density: (this.scene.fog as THREE.FogExp2).density
			};

			genGui
				.addColor(fogDebug, 'color')
				.name('Fog Color')
				.onChange((c: THREE.Color) => {
					if (this.scene.fog instanceof THREE.FogExp2) {
						this.scene.fog.color.copy(c);
					}
				});
			genGui
				.add(fogDebug, 'density', 0, 0.05, 0.001)
				.name('Fog Density')
				.onChange((v: number) => {
					if (this.scene.fog instanceof THREE.FogExp2) {
						this.scene.fog.density = v;
					}
				});
			closeInspectorGroup(genGui);
		}
	}

	private ensureGame(): VoidHeroGame {
		if (!this.game) {
			this.game = new VoidHeroGame({
				scene: this.scene,
				camera: this.camera,
				floorMeshes: this.floorMeshes,
				cameraForwardDirection: this.cameraForwardDirection,
				baseCameraPosition: this.baseCameraPosition,
				events: this.options.events,
				onCameraShake: (intensity) => {
					if (this.isTransitioning) return;
					this.cameraShake = Math.max(this.cameraShake, intensity);
				},
				comboVfx:
					this.comboBoltTexture && this.comboBoltAltTexture && this.comboImpactTexture
						? {
								bolt: this.comboBoltTexture,
								boltAlt: this.comboBoltAltTexture,
								impact: this.comboImpactTexture
							}
						: undefined
			});
		}

		return this.game;
	}

	private async warmupScene(): Promise<void> {
		this.fluidEffect?.warmup();
		await this.nfRenderer.precompileAsync(this.scene, this.camera);

		// Render the warmup frames with the game scene visible so its chrome + FX
		// pipelines pay first-use cost here rather than on the first game-start frame.
		this.game?.setPrewarmVisible(true);
		try {
			const frameCount = isMobile ? 5 : 10;
			for (let i = 0; i < frameCount; i++) {
				if (this.destroyed) return;
				const delta = 1 / 60;
				this.mixer?.update(delta);
				this.fluidEffect?.step(delta);
				this.nfRenderer.render();
				await this.waitForNextFrame();
			}
		} finally {
			this.game?.setPrewarmVisible(false);
		}

		this.clock.getDelta();
	}

	private waitForNextFrame(): Promise<void> {
		return new Promise((resolve) => requestAnimationFrame(() => resolve()));
	}

	/** Called from the Svelte component when the user clicks "Go Home" */
	triggerTransition(): void {
		if (this.isTransitioning) return;
		this.isTransitioning = true;
		this.transitionProgress = 0;
		this.transitionSpeed = 0;
		if (this.secretButtonGroup) this.secretButtonGroup.visible = false;
	}

	/** Called from the Svelte component on CTA hover */
	setCtaHovered(hovered: boolean): void {
		this.ctaHovered = hovered;
	}

	/**
	 * Drive wall-button visibility from the Svelte side (gamePhase). The internal toggles in
	 * startGame/stopGame/triggerTransition still run as defensive backstops; this is the
	 * declarative source of truth for "idle === button visible, anything else === hidden."
	 */
	setSecretButtonVisible(visible: boolean): void {
		if (!this.secretButtonGroup) return;
		// A page-out transition takes precedence — never re-show during fade-to-home.
		if (visible && this.isTransitioning) return;
		if (this.secretButtonGroup.visible === visible) return;
		this.secretButtonGroup.visible = visible;
		if (!visible) this.setSecretButtonHovered(false);
	}

	/** Called from the Svelte component when the user starts Void Hero */
	startGame(): void {
		if (!this.scene || !this.camera || !this.modelReady) {
			this.pendingGameStart = true;
			this.pendingGamePreview = false;
			return;
		}

		this.pendingGameStart = false;
		this.pendingGamePreview = false;
		this.ctaHovered = false;
		if (this.secretButtonGroup) this.secretButtonGroup.visible = false;

		this.ensureGame().start();
		this.fogSpeed.value = -7.5;
		this.sparkleSpeedZ.value = 1.65;
		this.sparkleOpacity.value = Math.max(this.sparkleOpacity.value, 0.16);
		if (this.mixer) {
			this.mixer.timeScale = 1.18;
		}
	}

	/**
	 * Mobile 'ready' state: render the pads/scoreboard at 0 without running the
	 * game loop. A subsequent `startGame()` promotes the preview into a real run.
	 */
	previewGame(): void {
		if (this.pendingGameStart) return;
		if (!this.scene || !this.camera || !this.modelReady) {
			this.pendingGamePreview = true;
			return;
		}

		this.pendingGamePreview = false;
		this.ctaHovered = false;
		if (this.secretButtonGroup) this.secretButtonGroup.visible = false;

		this.ensureGame().preview();
	}

	/** Forward UI changes from the Svelte component down to the active game. */
	setMusicTrack(id: string): void {
		this.game?.setTrack(id);
	}

	setMusicVolume(volume: number): void {
		this.game?.setMusicVolume(volume);
	}

	toggleMusicMute(): void {
		this.game?.toggleMute();
	}

	/** Called from the Svelte component when the player exits Void Hero. */
	stopGame(): void {
		this.pendingGameStart = false;
		this.pendingGamePreview = false;
		this.ctaHovered = false;
		this.cameraShake = 0;
		this.setSecretButtonHovered(false);

		if (this.game) {
			this.game.stop();
		}

		if (this.secretButtonGroup && !this.isTransitioning) {
			this.secretButtonGroup.visible = true;
		}

		this.fogSpeed.value = -5;
		this.sparkleSpeedZ.value = 1;
		this.sparkleOpacity.value = 0.1;
		if (this.mixer) {
			this.mixer.timeScale = 1;
		}
	}

	private addEventListeners(): void {
		this.onMouseMove = (event: MouseEvent) => {
			this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
			this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

			if ((this.game?.transitionAmount ?? 0) > 0.001) {
				this.targetRotation.set(0, 0);
				this.setSecretButtonHovered(false);
			} else {
				this.setSecretButtonHovered(this.secretButtonContains(event.clientX, event.clientY));
				this.targetRotation.x = this.mouse.y * 0.09;
				this.targetRotation.y = this.mouse.x * -0.14;
			}

			// Feed mouse movement into fluid simulation. Match the VFX-JS reference's
			// shader input exactly: splatColor = (pixelDelta / resolution) * splatForce.
			if (this.fluidEffect) {
				const w = Math.max(1, window.innerWidth);
				const h = Math.max(1, window.innerHeight);
				const uvX = event.clientX / w;
				const uvY = 1 - event.clientY / h; // y-up for the GPU velocity field
				const prevX = this.prevMouseX ?? event.clientX;
				const prevY = this.prevMouseY ?? event.clientY;
				// Cap per-event delta to ~5% of viewport. Browsers fire one
				// mousemove on re-entry after the pointer was off-window, and
				// without a cap that single event becomes a teleport-splat
				// that the field takes seconds to dissipate.
				const maxDx = w * 0.05;
				const maxDy = h * 0.05;
				const dxPx = Math.max(-maxDx, Math.min(maxDx, event.clientX - prevX));
				const dyPx = Math.max(-maxDy, Math.min(maxDy, -(event.clientY - prevY)));
				this.prevMouseX = event.clientX;
				this.prevMouseY = event.clientY;
				const res = this.fluidEffect.resolution;
				this.fluidEffect.splat({ x: uvX, y: uvY }, dxPx / res, dyPx / res, 1.0);
			}
		};

		this.onResize = () => {
			// Defer resize to next frame so the current in-flight GPU command
			// buffer finishes before render-target textures are recreated.
			// This prevents the "Destroyed texture used in a submit" WebGPU error.
			requestAnimationFrame(() => {
				if (this.destroyed) return;
				this.camera.aspect = window.innerWidth / window.innerHeight;
				this.camera.updateProjectionMatrix();
				const r = this.nfRenderer.renderer;
				r.setPixelRatio(Math.min(window.devicePixelRatio, NOT_FOUND_SCENE_SETTINGS.maxPixelRatio));
				r.setSize(window.innerWidth, window.innerHeight);
				if (this.fluidEffect) {
					this.fluidEffect.uAspectRatio.value = window.innerWidth / window.innerHeight;
				}
			});
		};

		this.onPointerDown = (event: PointerEvent) => {
			if (event.pointerType === 'mouse' && event.button !== 0) return;
			if (!this.secretButtonContains(event.clientX, event.clientY)) return;

			event.preventDefault();
			event.stopPropagation();
			this.setSecretButtonHovered(false);
			this.options.events.emit({ kind: 'secretRequest' });
		};

		// When the pointer leaves the window, drop the cached previous position
		// so the next re-entry doesn't compute a giant cross-screen delta and
		// emit a teleport-splat into the fluid field.
		this.onMouseLeave = () => {
			this.prevMouseX = null;
			this.prevMouseY = null;
		};

		// When the tab is hidden, the rAF loop pauses. When it returns, the
		// next clock.getDelta() returns the entire blur duration. Reset clock
		// + reset cached pointer to keep the fluid step stable on resume.
		this.onVisibilityChange = () => {
			if (document.hidden) return;
			this.clock.getDelta();
			this.prevMouseX = null;
			this.prevMouseY = null;
		};

		window.addEventListener('mousemove', this.onMouseMove);
		window.addEventListener('pointerdown', this.onPointerDown, true);
		window.addEventListener('resize', this.onResize);
		document.addEventListener('mouseleave', this.onMouseLeave);
		document.addEventListener('visibilitychange', this.onVisibilityChange);
	}

	private animate = (): void => {
		if (this.destroyed) return;

		const delta = this.clock.getDelta();

		// Update fluid simulation
		if (this.fluidEffect) {
			this.fluidEffect.step(delta);
		}

		// Update animation mixer
		if (this.mixer) {
			this.mixer.update(delta);
		}

		const game = this.game;
		game?.update(delta);
		const gameTransition = game?.transitionAmount ?? 0;
		const useGameCamera = !!game && gameTransition > 0.001;
		if (useGameCamera) {
			game.getCameraView(this.camera.aspect, this.gameCameraView);
		}

		// Update sparkle movement
		if (this.sparklesMesh && this.movementEnabled) {
			this.sparklesMesh.position.addScaledVector(this.cameraForwardDirection, -delta * 0.15);
		}

		// --- Transition: fast camera rush toward portal ---
		if (this.isTransitioning) {
			this.transitionProgress += delta;
			this.transitionSpeed += 0.05 * delta * 60;
			const rushSpeed = this.transitionSpeed;

			// Move camera forward rapidly
			this.camera.position.addScaledVector(this.cameraForwardDirection, rushSpeed * delta);

			// Narrow FOV for speed tunnel effect
			const rushFovTarget = Math.max(20, this.baseFov - this.transitionProgress * 40);
			this.currentFov += (rushFovTarget - this.currentFov) * 0.08;

			// Increase exposure to white-out
			if (this.nfRenderer) {
				const exposureTarget = Math.min(8, 0.95 + this.transitionProgress * 12);
				this.nfRenderer.renderer.toneMappingExposure +=
					(exposureTarget - this.nfRenderer.renderer.toneMappingExposure) * 0.06;
			}

			// Ramp up chromatic aberration for cosmic wormhole feel (1.5x intensity)
			this.chromaticStrength.value = 3.04 + this.transitionProgress * 37.5;
			this.chromaticScale.value = 0.66 + this.transitionProgress * 3.75;
			this.chromaticExclusionRadius.value = Math.max(0.0, 0.3 - this.transitionProgress * 0.75);
		} else {
			// FOV hover lerp (CTA hover zooms in slightly)
			const gameFov = useGameCamera
				? THREE.MathUtils.lerp(this.baseFov, this.gameCameraView.fov, gameTransition)
				: this.baseFov;
			const targetFov = this.ctaHovered ? this.hoverFov : gameFov;
			this.currentFov += (targetFov - this.currentFov) * this.fovLerpFactor;

			// Chromatic aberration hover lerp — softened while Void Hero is active
			const caStrengthTarget = this.ctaHovered ? 6.0 : 3.04 - gameTransition * 1.8;
			const caScaleTarget = this.ctaHovered ? 1.0 : 0.66 - gameTransition * 0.3;
			const caExclTarget = this.ctaHovered ? 0.15 : 0.3 + gameTransition * 0.15;
			this.chromaticStrength.value += (caStrengthTarget - this.chromaticStrength.value) * 0.1;
			this.chromaticScale.value += (caScaleTarget - this.chromaticScale.value) * 0.1;
			this.chromaticExclusionRadius.value +=
				(caExclTarget - this.chromaticExclusionRadius.value) * 0.1;

			const exposureTarget = 1.6 + gameTransition * 0.32;
			this.nfRenderer.renderer.toneMappingExposure +=
				(exposureTarget - this.nfRenderer.renderer.toneMappingExposure) * 0.04;
			const volumetricTarget = 4.7 + gameTransition * 0.9;
			this.volumetricLightingIntensity.value +=
				(volumetricTarget - this.volumetricLightingIntensity.value) * 0.035;
		}

		// --- Cursor-based camera rotation ---
		const parallaxWeight = 1 - gameTransition;
		this.currentRotation.x +=
			(this.targetRotation.x * parallaxWeight - this.currentRotation.x) * 0.03;
		this.currentRotation.y +=
			(this.targetRotation.y * parallaxWeight - this.currentRotation.y) * 0.03;

		this.cameraOffsetEuler.set(this.currentRotation.x, this.currentRotation.y, 0, 'YXZ');
		this.cameraOffsetQuat.setFromEuler(this.cameraOffsetEuler);

		if (!this.isTransitioning) {
			this.idleCameraPosition.copy(this.baseCameraPosition);
			this.idleCameraQuaternion.copy(this.baseCameraQuaternion).multiply(this.cameraOffsetQuat);
			if (useGameCamera) {
				this.camera.position
					.copy(this.idleCameraPosition)
					.lerp(this.gameCameraView.position, gameTransition);
				this.camera.quaternion
					.copy(this.idleCameraQuaternion)
					.slerp(this.gameCameraView.quaternion, gameTransition);
			} else {
				this.camera.position.copy(this.idleCameraPosition);
				this.camera.quaternion.copy(this.idleCameraQuaternion);
			}

			// Camera shake — punchy positional + small rotational tilt that decays exponentially.
			if (this.cameraShake > 0.005) {
				this.cameraShake *= Math.pow(0.0015, delta);
				const s = this.cameraShake;
				this.shakeAxisRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
				this.shakeAxisUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
				this.camera.position.addScaledVector(
					this.shakeAxisRight,
					(Math.random() - 0.5) * 0.045 * s
				);
				this.camera.position.addScaledVector(this.shakeAxisUp, (Math.random() - 0.5) * 0.045 * s);
				this.shakeQuat.setFromAxisAngle(
					this.cameraForwardDirection,
					(Math.random() - 0.5) * 0.004 * s
				);
				this.camera.quaternion.multiply(this.shakeQuat);
			} else {
				this.cameraShake = 0;
			}
		}

		if (this.revealActive) {
			this.revealProgress = Math.min(1, this.revealProgress + delta / this.revealDuration);
			const eased = 1 - Math.pow(1 - this.revealProgress, 3);
			this.currentFov = Math.max(this.minRevealFov, this.baseFov * eased);
			if (this.revealProgress >= 1) this.revealActive = false;
		}

		this.camera.fov = this.currentFov;
		this.camera.updateProjectionMatrix();
		this.updateSecretButton(delta);

		this.nfRenderer.render();

		this.animationId = requestAnimationFrame(this.animate);
	};

	destroy(): void {
		this.destroyed = true;
		const scene = this.scene;

		if (this.animationId) {
			cancelAnimationFrame(this.animationId);
			this.animationId = null;
		}

		if (this.onMouseMove) window.removeEventListener('mousemove', this.onMouseMove);
		if (this.onPointerDown) window.removeEventListener('pointerdown', this.onPointerDown, true);
		if (this.onResize) window.removeEventListener('resize', this.onResize);
		if (this.onMouseLeave) document.removeEventListener('mouseleave', this.onMouseLeave);
		if (this.onVisibilityChange)
			document.removeEventListener('visibilitychange', this.onVisibilityChange);

		if (this.inspector) {
			this.inspector.domElement.remove();
			this.inspector = null;
		}

		if (this.game) {
			this.game.dispose();
			this.game = null;
		}

		this.disposeSecretButton();

		// Dispose mixer
		if (this.mixer) {
			this.mixer.stopAllAction();
			this.mixer = null;
		}

		// Dispose light helpers
		for (const helper of this.lightHelpers) {
			scene?.remove(helper);
			helper.dispose();
		}
		this.lightHelpers = [];

		// Dispose portal lights
		for (const light of this.portalLights) {
			scene?.remove(light.target);
			scene?.remove(light);
			light.dispose();
		}
		this.portalLights = [];

		// Dispose volumetric mesh
		if (this.volumetricMesh) {
			this.volumetricMesh.geometry.dispose();
			(this.volumetricMesh.material as THREE.Material).dispose();
			scene?.remove(this.volumetricMesh);
			this.volumetricMesh = null;
		}

		// Dispose sparkle particles
		if (this.sparklesMesh) {
			this.sparklesMesh.geometry.dispose();
			(this.sparklesMesh.material as THREE.Material).dispose();
			scene?.remove(this.sparklesMesh);
			this.sparklesMesh = null;
		}

		// Dispose all model meshes
		if (this.gltfScene) {
			this.gltfScene.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.geometry.dispose();
					if (Array.isArray(child.material)) {
						child.material.forEach((mat: THREE.Material) => mat.dispose());
					} else if (child.material) {
						child.material.dispose();
					}
				}
			});
			scene?.remove(this.gltfScene);
			this.gltfScene = null;
		}

		if (this.noiseTexture3D) {
			this.noiseTexture3D.dispose();
			this.noiseTexture3D = null;
		}

		if (this.basecolorTexture) {
			this.basecolorTexture.dispose();
			this.basecolorTexture = null;
		}

		for (const tex of [this.comboBoltTexture, this.comboBoltAltTexture, this.comboImpactTexture]) {
			tex?.dispose();
		}
		this.comboBoltTexture = null;
		this.comboBoltAltTexture = null;
		this.comboImpactTexture = null;

		// Dispose fluid simulation
		if (this.fluidEffect) {
			this.fluidEffect.dispose();
			this.fluidEffect = null;
		}

		if (this.nfRenderer) {
			this.nfRenderer.dispose();
		}
	}
}

export default NotFoundSketch;
