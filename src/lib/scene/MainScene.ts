import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { Inspector } from 'three/addons/inspector/Inspector.js';
import { SceneInspector } from './debug/Inspector';
import { detectMob, detectSafari } from '$lib/utils/isMobile';
import { SharedMaterials } from './materials/SharedMaterials';
import { TextureCache } from './materials/TextureCache';

import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import {
	loadingProgress,
	virtualScrollHeight,
	lenisInstance,
	warmupComplete,
	graphicsTier
} from '$lib/store.svelte';
import type Lenis from 'lenis';
import { SCROLL_TO_EASING } from '$lib/utils/lenis';
import { buildSectionTimelines } from '$lib/config/sectionTimeline';
import { SLIDES } from './ui/slideData';
import { Annotations } from './ui/Annotations';
import { type ScrollDriver } from './ui/TrainSlider';
import { TrainSliderHost } from './ui/TrainSliderHost';
import Lights from './lighting/Lights';
import Renderer from './postprocessing/Renderer';
import { createDefaultGraphicsOptions, type GraphicsTier } from './GraphicsConfig';
import {
	logSceneFeatureConfig,
	resolveSceneFeatureConfig,
	type SceneFeatureConfig,
	type SceneFeatureFlags
} from './SceneFeatures';
import { applyPerformanceTier, getFluidResolutionForTier } from './bootstrap/sceneBootstrap';
import MouseInteractions from './interaction/MouseInteractions';

import { FluidMouseField } from './particles/FluidMouseField';
import { OctagonController } from './particles/OctagonController';
import { ParticleOrchestrator } from './particles/ParticleOrchestrator';
import { AnimationController } from './animation/AnimationController';
import { GroundFog } from './fog/GroundFog';
import { DaoFog } from './fog/DaoFog';
import { GridPlane } from './grid/GridPlane';
import { ResponsiveLayout } from './layout/ResponsiveLayout';
import { ModelRotationController } from './rotation/ModelRotationController';
import {
	IntroTransition,
	INTRO_TRANSITION_SECONDS,
	type IntroTransitionTickResult
} from './transitions/IntroTransition';
import MouseParallaxShift from './interaction/MouseParallaxShift';
import { createSceneTimeline } from './animation/sceneTimeline';
import {
	CLOUD_TRANSITION_TIMING,
	VENTURES_SECTION_INDEX,
	applyCloudKeyframeState,
	resolveCloudActiveScene
} from './animation/sceneUiTiming';
import { ProgressPipeline } from './animation/ProgressPipeline';
import * as sceneManifest from './animation/sceneManifest';
import { sceneRangeState } from '$lib/config/sceneBoundaryStore.svelte';
import { getRangeProgress, mapProgressAcrossRanges } from './animation/sceneProgress';
import { LoadingProgressTracker, type LoadingStage } from './runtime/LoadingProgressTracker';
import { FramePacingGovernor } from './runtime/FramePacingGovernor';
import {
	DEFAULT_ANNOTATION_FALLBACK_POSITIONS,
	DEFAULT_ANNOTATION_MOBILE_POSITIONING,
	applyForestChromaticAberrationLayer,
	applyInitialModelCamera,
	applyModelMaterials,
	disableMeshShadows,
	resolveSceneModelObjects
} from './composition/modelAssembly';
import { StageDispatcher } from './stages/StageDispatcher';
import { Scene1Stage } from './stages/Scene1Stage';
import { Scene2Stage } from './stages/Scene2Stage';
import { Scene3Stage } from './stages/Scene3Stage';
import { SCENE_LAYERS } from './sceneLayers';
import { TheatreController } from './theatre/TheatreController';
import { Visuals } from './theatre/objects/Visuals';
import { FluidSimulation } from './theatre/objects/FluidSimulation';
import { Transition } from './theatre/objects/Transition';
import theatreStateDesktop from './theatre/features/desktop.json';
import theatreStateMobile from './theatre/features/mobile.json';
import type { Inspectable } from './debug/Inspectable';

export type ProgressData = { step: number; value: number; globalProgress: number };

/**
 * Shared post-processing parameter bag. MainScene authors it, sceneBootstrap
 * mutates it with tier multipliers, Renderer/PostProcessingGraph read it (and
 * write `emissivePostFogIntensity`/`bloomPass` back), Theatre's Visuals writes
 * the authored bases.
 */
export interface ScenePostParams {
	resolution: number;
	denoise: boolean;
	bloomStrength: number;
	bloomRadius: number;
	bloomThreshold: number;
	/** TSL uniform node (read by PostProcessingGraph). */
	emissiveBloomIntensity: { value: number };
	chromeCenterX: number;
	chromeCenterY: number;
	chromeScale: number;
	chromeStrength: number;
	chromeExclusionRadius: number;
	trainSliderProgress: number;
	vignetteIntensityAuthored: number;
	/** Written back by PostProcessingGraph once the graph is built. */
	emissivePostFogIntensity?: { value: number };
	bloomPass?: unknown;
	/** All per-channel BloomNodes — each owns private strength/radius/threshold
	 *  uniforms, so writers must fan out (see Visuals.applyConfig). */
	bloomPasses?: unknown[];
}

const OCTAGON_INTRO_LAYER_DELAY_SECONDS = 0.45;

/** Presets that enable the DaoFog overlay. */
const DAO_FOG_PRESETS: ReadonlySet<number> = new Set([0, 1, 4]);

/** Reused preloader-fade base color — avoids re-parsing '#000000' per progress tick. */
const PRELOADER_BLACK = new THREE.Color('#000000');

/** Module scope so static + instance field initializers can read it (they run
 * before the constructor assigns `this.isMobile`). This module is only ever
 * reached via `await import(...)` from the client, so the UA check is live. */
const IS_MOBILE = detectMob();

class MainScene {
	private readonly PARTICLE_RADIUS_SCALE = 0.6;
	private readonly loadingProgressTracker = new LoadingProgressTracker(
		// Desktop: `pyramidAssets` (source GLB + VAT bin, ~28 MB) is the dominant
		// network cost on a cold cache, so it gets the largest share. `objects`
		// (the 2.2 MB main GLB) was over-weighted at 40 — most of its time was
		// actually the untracked pyramid download that followed it, which froze
		// the bar mid-load on Vercel/incognito.
		// Mobile: the mobile bake is small and balanced (~1.3 MB GLB vs ~1.7 MB
		// pyramid assets), so the split is closer to even.
		IS_MOBILE
			? { benchmark: 5, objects: 30, pyramidAssets: 25, sceneSetup: 15, warmup: 25 }
			: { benchmark: 5, objects: 15, pyramidAssets: 40, sceneSetup: 15, warmup: 25 },
		(progress) => {
			loadingProgress.set(progress);
			const t = Math.min(1, progress / 100);
			this.applyPreloaderIntro(1 - (1 - t) ** 3);
		}
	);
	private isMobile: boolean;
	private isSafari: boolean;
	private _hasComputeSupport = true;
	private graphicsTier: GraphicsTier = 'high';
	private preset = 0;
	private _sceneReady = false;
	private readonly featureConfig: SceneFeatureConfig;
	private readonly features: SceneFeatureFlags;

	private get hasDaoFog(): boolean {
		return DAO_FOG_PRESETS.has(this.preset);
	}

	private renderer!: Renderer;
	private scene!: THREE.Scene;
	/**
	 * Dedicated overlay scene for train slider meshes. Rendered by a TSL pass
	 * in PostProcessingGraph and composited on top of DaoFog so slides sit
	 * above fog. `background = null` is load-bearing for the transparent clear.
	 */
	private slidesScene!: THREE.Scene;
	/** Rest-state scene background — color 1 of the invert lerp. */
	private readonly sceneBackgroundBase = new THREE.Color('#0A0A0A');
	/** Target background at full invert — color 2 of the invert lerp. */
	private readonly invertBackgroundColor = new THREE.Color('#fff');
	private camera!: THREE.PerspectiveCamera;
	private gridPlane: GridPlane | null = null;

	private trainSliderHost: TrainSliderHost | null = null;

	private globalFluidEffect: FluidMouseField | null = null;

	private params: ScenePostParams;
	private _graphicsOptions!: ReturnType<typeof createDefaultGraphicsOptions>;

	// Loaders
	private gltfLoader: GLTFLoader;
	private dracoLoader: DRACOLoader;
	private ktx2Loader: KTX2Loader;

	// Managers
	private lights!: Lights;
	private mouseInteractions: MouseInteractions | null = null;
	private mouseParallaxShift: MouseParallaxShift | null = null;

	private animation = new AnimationController();
	private groundFog?: GroundFog;
	private daoFog?: DaoFog;
	private scrollAnimationAction: THREE.AnimationAction | null = null;

	private octagonController: OctagonController | null = null;
	private particleOrchestrator!: ParticleOrchestrator;

	// Object groups for opacity control (entire mesh hierarchies)
	private cubesGroup: THREE.Object3D | null = null;
	private pyramidsGroup: THREE.Object3D | null = null;
	private forestGroup: THREE.Object3D | null = null;
	// Forest sub-groups for independent visibility (main tree / other trees / city).
	private forestMainTreeGroup: THREE.Object3D | null = null;
	private forestOtherTreeGroups: THREE.Object3D[] = [];
	private forestCityGroup: THREE.Object3D | null = null;
	/** Root of the loaded GLB — kept so cleanup can dispose its GPU resources. */
	private gltfSceneRoot: THREE.Object3D | null = null;
	private modelRotationController: ModelRotationController;

	// Sign objects for annotations (positioned at the last step of the timeline)
	private signObjects: THREE.Object3D[] = [];
	private annotations?: Annotations;
	private sceneInspector?: SceneInspector;
	private inspector?: Inspector;
	private responsiveLayout: ResponsiveLayout;
	private introTransition!: IntroTransition;
	private progressPipeline!: ProgressPipeline;
	private warmupFinished = false;
	private frameNumber = 0;
	// Idle half-rate (mobile): timestamp of the last touch/pointer input plus
	// the skipped-frame delta carry, so motion speed stays correct at half rate.
	private _lastInputAt = 0;
	private _pendingDelta = 0;
	private _idleSkipFrame = false;
	private framePacingGovernor: FramePacingGovernor | null = null;
	private readonly gpu = { renderer: null! as THREE.WebGPURenderer };
	private _disposed = false;
	private _lastFrameAt = 0;
	/** Last time a frame produced a real GPU draw call — see `Renderer.lastFrameDrawCalls`. */
	private _lastDrawAt = 0;
	private _renderErrors = 0;
	private _recovering = false;
	private _recoveryAttempts = 0;
	private _lastRecoveryAt = 0;
	private static readonly RECOVERY_TIMEOUT_MS = 10000;
	private static readonly RECOVERY_HEALTHY_WINDOW_MS = 30000;
	private static readonly MAX_RECOVERY_ATTEMPTS = 2;
	private static readonly RELOAD_STORAGE_KEY = 'gpu-recovery-reload-count';
	private static readonly MAX_AUTO_RELOADS = 2;
	private _loopGuardDispose: (() => void) | null = null;
	private introDebugOverlay: HTMLPreElement | null = null;
	private introDebugLastTick: IntroTransitionTickResult | null = null;
	private introCompositorHeartbeat: HTMLSpanElement | null = null;
	private introCompositorHeartbeatFrame = 0;

	private stageDispatcher: StageDispatcher | null = null;
	private theatreController: TheatreController | null = null;
	/** Theatre-authored camera FOV; once set it wins over the responsive breakpoint value. */
	private theatreCameraFov: number | null = null;

	private modelCamera: THREE.PerspectiveCamera | THREE.Object3D | null = null;
	private _lenis: Lenis | null = null;

	// Scratch objects for syncCameraFromModel — avoid per-call allocations.
	private readonly _syncWorldPos = new THREE.Vector3();
	private readonly _syncWorldQuat = new THREE.Quaternion();

	// Approximate transfer sizes of the two tracked pyramid downloads, used as a
	// stable denominator for the `pyramidAssets` stage. Content-Length is
	// unreliable here (absent or compressed), and the exact figure only affects
	// mid-download smoothness — the stage is snapped to 1 once both resolve. The
	// VAT now ships gzipped (~1.8 MB on the wire vs 22.9 MB raw); progress tracks
	// the compressed transfer, so this denominator follows the .gz size.
	private static readonly PYRAMID_ASSET_BYTES = IS_MOBILE
		? {
				source: 1.05 * 1024 * 1024,
				vat: 0.62 * 1024 * 1024
			}
		: {
				source: 6.0 * 1024 * 1024,
				vat: 1.85 * 1024 * 1024
			};

	/** Touch/pointer quiet period before idle half-rate rendering engages. */
	private static readonly IDLE_INPUT_MS = 2000;
	private readonly pyramidAssetLoaded = { source: 0, vat: 0 };

	constructor(featureConfig: SceneFeatureConfig = resolveSceneFeatureConfig()) {
		this.featureConfig = featureConfig;
		this.features = featureConfig.flags;
		this.dracoLoader = new DRACOLoader();
		this.dracoLoader.setDecoderPath('/draco/');
		this.ktx2Loader = new KTX2Loader();
		this.ktx2Loader.setTranscoderPath('/basis/');
		this.gltfLoader = new GLTFLoader();
		this.gltfLoader.setDRACOLoader(this.dracoLoader);
		this.modelRotationController = new ModelRotationController();

		this.isSafari = detectSafari();
		this.isMobile = IS_MOBILE;
		this.responsiveLayout = new ResponsiveLayout(this.isMobile);
		this.introTransition = new IntroTransition({
			enabled: this.features.introTransition,
			scrollAnimationAction: () => this.scrollAnimationAction,
			onStart: ({ immediate }) => {
				this.animation.tickTimer();
				if (immediate) {
					this.applyIntroOctagonOpacity(INTRO_TRANSITION_SECONDS);
					this.applyIntroDaoFogOpacity(INTRO_TRANSITION_SECONDS);
					if (this.features.octagonFluid) {
						this.octagonController?.activateFluidSim();
					}
				} else {
					this.resetToProgressZero();
				}
				this.renderer?.renderAsync();
			}
		});
		this.progressPipeline = new ProgressPipeline({ introTransition: this.introTransition });

		// Authored bases (`bloomStrength`, `vignetteIntensityAuthored`,
		// `chromeStrength`) are written by Theatre, which mirrors them onto the
		// live uniforms inside `Visuals.applyConfig` — no per-frame re-sync needed.
		// `resolution`/`denoise` are placeholders for the pre-init window only —
		// applyPerformanceTier writes the tier-derived values during init(),
		// before the renderer or any consumer reads them.
		this.params = {
			resolution: 1,
			denoise: true,
			bloomStrength: 1.25,
			bloomRadius: 0.42,
			// No mobile dimming — these only seed the pre-Theatre window; the
			// keyframed bloomThreshold/bloomEmissive tracks overwrite both at
			// registration, and platform differences belong in mobile.json.
			bloomThreshold: 0.0,
			emissiveBloomIntensity: uniform(1.6),
			chromeCenterX: 0.5,
			chromeCenterY: 0.5,
			chromeScale: 0.45,
			chromeStrength: 0.35,
			chromeExclusionRadius: 0,
			trainSliderProgress: 0,
			vignetteIntensityAuthored: 0
		};
	}

	public async init(preset = 0) {
		this.preset = preset;
		if (this.featureConfig.debug) {
			logSceneFeatureConfig(this.featureConfig);
		} else if (this.featureConfig.unknownTokens.length > 0) {
			console.warn('Unknown scene feature tokens:', this.featureConfig.unknownTokens);
		}

		this.resetLoadingProgress();

		await this.applyPerformanceSettings();
		this.setupScene();
		this.setupLights();
		await this.setupRenderer();
		this._hasComputeSupport = this.renderer.hasComputeSupport;
		if (!this._hasComputeSupport) {
			console.warn('WebGPU compute not available — running on WebGL2 fallback backend');
		}
		if (this.features.daoFog && this.hasDaoFog) {
			// Half-res prepass on mobile: all layers are additive, so the
			// composite is exact at ~1/4 the fragment cost.
			this.daoFog = new DaoFog(this.isMobile);
			await this.daoFog.loadTextures();
			// Hide the fog until the intro tween fades its gate in. masterOpacity
			// is left to Theatre; the intro gate is what controls visibility here.
			this.daoFog.setIntroOpacity(0);
			// DaoFog renders as a TSL composite layered on top of vignette via
			// the renderer's overlay-compositor hook. No scene meshes; the
			// closure holds direct uniform references so live edits propagate.
			const fog = this.daoFog;
			this.renderer.setOverlayCompositor(
				(background) => fog.buildCompositeNode(background),
				(width, height) => fog.resizeRenderTarget(width, height)
			);
		}

		this.setupManagers();
		if (this.features.mouseParallax) {
			this.mouseParallaxShift = new MouseParallaxShift();
			this.mouseParallaxShift.start();
		}
		if (this.features.trainSlider) {
			this.setupTrainSlider();
		}

		const debugEnabled = this.setupDebugFlags(new URLSearchParams(window.location.search));

		if (this.isMobile) {
			this.setupIntroCompositorHeartbeat();
		}

		// Theatre.js — `theatre/features/{desktop,mobile}.json` are the source of
		// truth; the platform pick is made once at init and is refresh-only.
		// Re-export from Studio overwrites the matching file.
		// Inspectables are registered later in `loadObjects` once assets exist.
		this.theatreController = new TheatreController();
		const theatreState = this.isMobile ? theatreStateMobile : theatreStateDesktop;
		// Read the authored cloud-transition keyframe span from the save-state so
		// the warmup pins + the threshold fallback track the authored timing and
		// value-driven mode is flagged. Tolerant of an unauthored/dropped track.
		applyCloudKeyframeState(theatreState);
		await this.theatreController.init(theatreState, debugEnabled, this.isMobile);

		if (this.features.mouseInteraction && this.mouseInteractions) {
			window.addEventListener('mousemove', this.mouseInteractions.onMouseMove);
			window.addEventListener('touchstart', this.mouseInteractions.onTouchStart, {
				passive: true
			});
			window.addEventListener('touchmove', this.mouseInteractions.onTouchMove, {
				passive: true
			});
		}
		if (this.isMobile) {
			// Dedicated idle-detector listeners — independent of MouseInteractions,
			// which can be disabled via ?sceneDisable=mouseInteraction.
			window.addEventListener('pointerdown', this.noteUserInput, { passive: true });
			window.addEventListener('pointermove', this.noteUserInput, { passive: true });
			window.addEventListener('touchstart', this.noteUserInput, { passive: true });

			// Mobile never benchmarks (pinned to 'medium'), so weak phones get a
			// runtime path down: sustained jank steps the render resolution.
			this.framePacingGovernor = new FramePacingGovernor((step) => this.applyQualityDemotion(step));
		}
		this.responsiveLayout.start(({ width, height, layoutHeight, isUrlBarToggle }) => {
			if (!isUrlBarToggle) {
				this.renderer.onResize(width, height);
				this.annotations?.resize(width, height);
			}

			this.camera.fov = this.theatreCameraFov ?? this.responsiveLayout.getCameraFov(width);
			this.camera.aspect = width / layoutHeight;
			this.camera.updateProjectionMatrix();

			if (!isUrlBarToggle) {
				this.trainSliderHost?.handleResize();
				this.gridPlane?.handleResize(width, layoutHeight);
			}

			this.octagonController?.setWorldOffsetY(this.responsiveLayout.getOctagonOffsetY(width));
			if (this.globalFluidEffect) {
				this.globalFluidEffect.uAspectRatio.value = width / Math.max(1, layoutHeight);
			}
		});
		this.introTransition.start();

		// Mobile loads its own GLB: same node names, same 12 clips, same 46.68 s
		// timeline as desktop, but built from the simpler mobile FBX. Pyramid
		// visuals come from the mobile VAT bake (pyramids_mobile_*, loaded by
		// ParticleOrchestrator), exactly like desktop uses pyramids_*.
		const modelUrl = this.isMobile ? '/models/DAO_mobile_scene.glb' : '/models/DAO_full_scene.glb';
		void this.loadObjects(modelUrl).catch((error) => {
			console.error('Failed to load scene objects:', error);
		});

		this._loopGuardDispose = this.renderer.bindLoopGuard({
			isActive: () => this._sceneReady,
			isDisposed: () => this._disposed,
			getLoop: () => this.animate,
			onVisible: () => this.animation.tickTimer(),
			onRecover: (reason) => void this.recoverGpu(reason),
			getLastFrameAt: () => this._lastFrameAt,
			setLastFrameAt: (time) => {
				this._lastFrameAt = time;
			},
			getLastDrawAt: () => this._lastDrawAt
		});
		void this.renderer.webGPURenderer.setAnimationLoop(this.animate);
	}

	private async setupRenderer(): Promise<void> {
		this.renderer = new Renderer(this._graphicsOptions);

		this.globalFluidEffect = this.createGlobalFluidField();
		if (this.globalFluidEffect) {
			this.globalFluidEffect.uAspectRatio.value = window.innerWidth / window.innerHeight;
		}

		await this.renderer.init({
			scene: this.scene,
			camera: this.camera,
			params: this.params,
			fluidEffect: this.globalFluidEffect,
			ktx2Loader: this.ktx2Loader,
			gltfLoader: this.gltfLoader
		});

		// Renderer.init calls ktx2Loader.detectSupport(renderer); now that the
		// transcoder target format is known, share the loader with TextureCache so
		// `.ktx2` URLs (e.g. slide textures) route through GPU-transcoded decode.
		TextureCache.setKTX2Loader(this.ktx2Loader);

		this.gpu.renderer = this.renderer.webGPURenderer;
	}

	private createGlobalFluidField(): FluidMouseField | null {
		// Both option gates already AND in globalFluid via the feature flags
		// (see applySceneFeaturesToGraphicsOptions + normalizeDependencies).
		if (
			!this._graphicsOptions.postProcessing.fluidDistortion &&
			!this._graphicsOptions.enableOctagonPhysics
		) {
			return null;
		}

		return new FluidMouseField(this.renderer.webGPURenderer, {
			resolution: getFluidResolutionForTier(this.graphicsTier),
			splatRadius: 0.1,
			splatForce: 500,
			curlStrength: 22,
			velocityDissipation: 0.85,
			pressureDissipation: 0.919,
			pressureIterations: 8
		});
	}

	/** Rejects with a timeout error if `promise` doesn't settle within `ms`. */
	private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
			promise.then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				(error) => {
					clearTimeout(timer);
					reject(error);
				}
			);
		});
	}

	/**
	 * Last-resort fallback when in-place GPU recovery can't get the scene
	 * moving again. Capped via sessionStorage so a deterministically-broken
	 * device/driver can't reload-loop the page forever.
	 */
	private reloadPage(reason: string): void {
		try {
			const count = Number(sessionStorage.getItem(MainScene.RELOAD_STORAGE_KEY) ?? '0');
			if (count >= MainScene.MAX_AUTO_RELOADS) {
				console.error(`GPU recovery failed (${reason}) — auto-reload limit reached, giving up`);
				return;
			}
			sessionStorage.setItem(MainScene.RELOAD_STORAGE_KEY, String(count + 1));
		} catch {
			// sessionStorage unavailable (e.g. private mode) — reload anyway, no loop guard possible.
		}
		console.error(`GPU recovery failed (${reason}) — reloading page`);
		window.location.reload();
	}

	private recoverGpu = async (reason: string): Promise<void> => {
		if (this._disposed || this._recovering) return;
		this._recovering = true;

		const now = performance.now();
		if (now - this._lastRecoveryAt > MainScene.RECOVERY_HEALTHY_WINDOW_MS) {
			this._recoveryAttempts = 0;
		}
		this._recoveryAttempts += 1;
		this._lastRecoveryAt = now;

		// Recreating the context keeps "succeeding" (no throw) but the freeze
		// keeps recurring shortly after — e.g. every recreated context hits the
		// same stuck-shader-compile condition on this device. Stop retrying an
		// approach that isn't working and reload instead.
		if (this._recoveryAttempts > MainScene.MAX_RECOVERY_ATTEMPTS) {
			this._recovering = false;
			this.reloadPage(
				`${reason} — repeated recovery within ${MainScene.RECOVERY_HEALTHY_WINDOW_MS}ms`
			);
			return;
		}

		try {
			console.warn(`Recovering GPU (${reason}), attempt ${this._recoveryAttempts}`);
			this.globalFluidEffect?.dispose();
			await this.withTimeout(
				this.renderer.recreateGpuContext({
					ktx2Loader: this.ktx2Loader,
					gltfLoader: this.gltfLoader
				}),
				MainScene.RECOVERY_TIMEOUT_MS,
				'recreateGpuContext'
			);
			this.gpu.renderer = this.renderer.webGPURenderer;
			// Re-bake the pyramid environment against the recreated renderer.
			SharedMaterials.initPyramidEnvironment(this.renderer.webGPURenderer);
			this.globalFluidEffect = this.createGlobalFluidField();
			this.renderer.fluidEffect = this.globalFluidEffect;
			if (this.globalFluidEffect) {
				this.globalFluidEffect.uAspectRatio.value =
					window.innerWidth / Math.max(1, window.innerHeight);
			}
			if (this.inspector) this.renderer.webGPURenderer.inspector = this.inspector;
			if (this._sceneReady) {
				const progress = this.progressPipeline.getLastProgress();
				if (progress >= 0) this.applyProgressNow(progress);
				this.renderer.renderAsync();
			}
			void this.renderer.webGPURenderer.setAnimationLoop(this.animate);
			this._lastFrameAt = performance.now();
			this._lastDrawAt = this._lastFrameAt;
			this._renderErrors = 0;
		} catch (error) {
			// The rebuild itself failed or hung — there's nothing lower-level
			// left to retry, so fall back to a full reload immediately.
			this.reloadPage(`${reason} — ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this._recovering = false;
		}
	};

	private async applyPerformanceSettings(): Promise<void> {
		const result = await applyPerformanceTier({
			params: this.params,
			features: this.features,
			isMobile: this.isMobile,
			onBenchmarkComplete: () => this.setLoadingStage('benchmark', 1)
		});
		this.graphicsTier = result.tier;
		graphicsTier.set(result.tier);
		this._graphicsOptions = result.options;
	}

	private setupScene(): void {
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color('#000000');
		this.scene.fog = new THREE.FogExp2('#000000', 0.18);

		this.slidesScene = new THREE.Scene();
		this.slidesScene.background = null;

		if (this.features.groundFog) {
			// Cheap single-octave noise on all mobile, not just Safari/iOS —
			// triNoise3D's 4-iteration loop is ~3x the cost on Android too.
			this.groundFog = new GroundFog(this.scene, this.isSafari || this.isMobile);
			this.groundFog.enable();
			if (this.isMobile) {
				this.groundFog.animSpeed.value = 0.6;
			}
		}

		this.camera = new THREE.PerspectiveCamera(
			this.responsiveLayout.getCameraFov(),
			window.innerWidth / window.innerHeight,
			0.1,
			1000
		);

		// Fluid field is constructed in setupRenderer() once the WebGPU renderer
		// instance exists. Splats are queued before its first step regardless.

		if (this.features.grid) {
			this.gridPlane = new GridPlane(this.scene, window.innerWidth, window.innerHeight);
		}
	}

	private applyPreloaderIntro(blend: number): void {
		const t = Math.max(0, Math.min(1, blend));
		if (this.scene) {
			if (!(this.scene.background instanceof THREE.Color)) {
				this.scene.background = PRELOADER_BLACK.clone();
			}
			(this.scene.background as THREE.Color)
				.copy(PRELOADER_BLACK)
				.lerp(this.sceneBackgroundBase, t);
			if (this.scene.fog instanceof THREE.FogExp2) {
				this.scene.fog.color.copy(PRELOADER_BLACK).lerp(this.sceneBackgroundBase, t);
			}
		}
		// DaoFog fades in via its own intro-opacity gate (applyIntroDaoFogOpacity)
		// during the intro tween; masterOpacity stays owned by Theatre. Nothing to
		// drive here.
	}

	private setupLights(): void {
		if (this.lights) {
			return;
		}
		this.lights = new Lights(this.scene, this.camera);
		this.lights.setupLights();
	}

	private setupMouseInteractions(): void {
		if (this.mouseInteractions) {
			return;
		}
		if (this.features.mouseInteraction) {
			this.mouseInteractions = new MouseInteractions({
				globalFluidEffect: this.globalFluidEffect,
				domElement: this.renderer.domElement
			});
		}
	}

	private setupManagers(): void {
		this.setupLights();
		this.setupMouseInteractions();
	}

	private setupTrainSlider(): void {
		this.trainSliderHost = new TrainSliderHost({
			slidesScene: this.slidesScene,
			camera: this.camera,
			webGPURenderer: this.renderer.webGPURenderer,
			globalFluidEffect: this.globalFluidEffect,
			graphicsTier: this.graphicsTier,
			isMobile: this.isMobile,
			buildScrollDriver: (lenis) => this.buildSliderScrollDriver(lenis)
		});
		this.trainSliderHost.setup();
		// Wires the slidesScene into the post-processing graph as a TSL pass on
		// SCENE_LAYERS.TRAIN_SLIDER, composited above the DaoFog overlay.
		this.renderer.setSlidesOverlay(this.slidesScene, SCENE_LAYERS.TRAIN_SLIDER);
		if (this._lenis) {
			this.trainSliderHost.setLenis(this._lenis);
		}
	}

	private updateMouseParallaxTargets(): void {
		if (!this.mouseParallaxShift) {
			return;
		}

		const targets: Array<{
			object: THREE.Object3D;
			horizontalRange: number;
			verticalRange: number;
		}> = [];

		if (this.cubesGroup) {
			targets.push({
				object: this.cubesGroup,
				horizontalRange: 0.22,
				verticalRange: 0.12
			});
		}

		if (this.pyramidsGroup) {
			targets.push({
				object: this.pyramidsGroup,
				horizontalRange: 0.16,
				verticalRange: 0.1
			});
		}

		this.mouseParallaxShift.setTargets(targets);
	}

	/**
	 * Re-syncs the cached pyramidsGroup (which the rotation controller wraps
	 * during particle setup) and refreshes mouse-parallax targets. Call after
	 * any orchestrator setup that might have re-parented pyramidsGroup.
	 */
	private refreshModelGroups(): void {
		this.cubesGroup = this.modelRotationController.getCubesVisibilityGroup() ?? this.cubesGroup;
		this.pyramidsGroup = this.modelRotationController.getPyramidsVisibilityGroup();
		this.updateMouseParallaxTargets();
	}

	private waitForNextFrame(): Promise<void> {
		return new Promise((resolve) => requestAnimationFrame(() => resolve()));
	}

	/** Section timelines are pure functions of the (static) slide count — build once. */
	private _sectionTimelines: ReturnType<typeof buildSectionTimelines> | null = null;

	private getSectionTimelines(): ReturnType<typeof buildSectionTimelines> {
		return (this._sectionTimelines ??= buildSectionTimelines(SLIDES.length));
	}

	private applyProgressNow(
		progress: number,
		contentProgress = this.progressPipeline.mapToContentTimelineProgress(progress)
	): void {
		if (this.features.modelAnimations) {
			this.animation.setScrollProgress(progress);
		}

		this.syncCameraFromModel();

		this.gridPlane?.faceCamera(this.camera);

		// Theatre.js sequence is driven by *content* progress (post-intro). Its
		// value-change callbacks fire here, writing renderer/lights/fog/particles
		// uniforms and mirroring the cloud-transition keyframes into
		// CLOUD_TRANSITION_FILL. Must run BEFORE the cross-fade + stage dispatcher
		// below so both read this frame's fill values, not last frame's.
		this.theatreController?.setProgress(contentProgress);

		if (this.features.animationPipeline) {
			this.animation.updateForProgress(progress);
		}

		this.annotations?.updateForProgress(progress);

		// VAT solid AND particle source must both ride the CAMERA clock (`progress`,
		// which carries the intro affine) — NOT `contentProgress`. The camera skips
		// the 3.5s intro (loading tween), so a `contentProgress` solid lags the camera
		// by that offset and the morph fires ~1s after the camera move instead of
		// frame-locked to it as in the FBX. Both lines stay on `progress`.
		const pyramidVAT = this.particleOrchestrator?.getPyramidVAT();
		if (pyramidVAT) {
			pyramidVAT.setProgress(progress);
		}

		this.modelRotationController.applyCurrentTransform(progress);

		this.trainSliderHost?.syncPageSection(
			this.progressPipeline.getActivePageSection(),
			this.warmupFinished
		);

		// Active scene (1/2/3) from the cloud-transition fill ramps, so the RT
		// layer swap retimes live with the keyframes (see resolveCloudActiveScene).
		this.stageDispatcher?.update(resolveCloudActiveScene(contentProgress), 0);
	}

	private async warmupScene(): Promise<void> {
		if (!this.features.warmup) {
			this.setLoadingStage('warmup', 1);
			return;
		}

		const previousSection = this.progressPipeline.getActivePageSection();
		const previousSectionProgress = this.progressPipeline.getActivePageSectionProgress();

		// Each warmup step renders a distinct timeline state, forcing the
		// post-processing graph's state-dependent pipelines (bloom/CA/vignette/
		// fog composite/transition/invert/particle visibility) to compile here,
		// behind the loading bar. Skipping this on mobile pushed every compile
		// past "Start experience" into a multi-second canvas freeze — worst in
		// incognito, which has no persisted GPU shader cache to amortize it.
		// The compile cost is fixed by the number of distinct pipelines (not the
		// step count), so mobile uses fewer steps: same coverage of the heavy
		// states, less per-frame overhead on weaker hardware.
		const STEP_COUNT = this.isMobile ? 16 : 40;
		const MAX_PROGRESS = 1.1;

		// Uniform steps can straddle the scene-transition windows entirely (the
		// 1→2 fillIn band is ~3% of content progress; mobile's 16 steps are ~7%
		// apart), so the transition-active state — both scene channels rendering
		// plus the smear/cloud-fill and feedback-decay paths — would first
		// compile on a live scroll into the band: a guaranteed mid-scroll stall.
		// Pin one step to the middle of each transition window so that state
		// always renders here, behind the loading bar. mapToContentTimelineProgress
		// is affine past the intro cutoff, so the inverse is exact.
		const timeline = this.progressPipeline.getSceneTimeline();
		const rawForContent = (content: number) =>
			timeline.introCutoffProgress + content * (1 - timeline.introCutoffProgress);
		const progressSteps: number[] = [];
		for (let i = 0; i <= STEP_COUNT; i++) {
			progressSteps.push((i / STEP_COUNT) * MAX_PROGRESS);
		}
		if (this.features.transition) {
			progressSteps.push(
				rawForContent(
					(CLOUD_TRANSITION_TIMING.fillInStart + CLOUD_TRANSITION_TIMING.fillInEnd) / 2
				),
				rawForContent(
					(CLOUD_TRANSITION_TIMING.fadeOutStart + CLOUD_TRANSITION_TIMING.fadeOutEnd) / 2
				)
			);
		}
		progressSteps.sort((a, b) => a - b);

		for (let i = 0; i < progressSteps.length; i++) {
			this.setLoadingStage('warmup', i / (progressSteps.length - 1));
			const progress = progressSteps[i];
			const contentProgress = this.progressPipeline.mapToContentTimelineProgress(progress);
			const { sectionIndex, sectionProgress } = getRangeProgress(
				contentProgress,
				sceneManifest.PAGE_SECTION_SCENE_RANGES
			);
			this.setActivePageSection(sectionIndex, sectionProgress);

			this.applyProgressNow(progress);

			this.trainSliderHost?.tickAnimation(1 / 60);

			this.renderer.renderAsync();
			await this.waitForNextFrame();
		}

		this.setActivePageSection(previousSection, previousSectionProgress);
		this.renderer.renderAsync();
		await this.waitForNextFrame();

		this.setLoadingStage('warmup', 1);
	}

	/**
	 * Applies all debug URL flags. Returns whether `?debug=true` is set (also
	 * forwarded to Theatre Studio init).
	 */
	private setupDebugFlags(url: URLSearchParams): boolean {
		const debugEnabled = url.get('debug') === 'true';
		if (debugEnabled) {
			this.setupInspector();
		}
		if (url.get('introDebug') === '1') {
			this.setupIntroDebugOverlay();
		}

		// `?fluidDebug=1` swaps the dispersion display for a raw velocity-magnitude
		// view so you can confirm the field is being splatted at all.
		if (url.get('fluidDebug') === '1') {
			const fluidDebug = this.renderer.getFluidDebug();
			if (fluidDebug) fluidDebug.value = 1;
		}

		return debugEnabled;
	}

	private setupInspector(): void {
		const inspector = new Inspector();
		this.inspector = inspector;
		this.renderer.webGPURenderer.inspector = inspector;
		inspector.domElement.setAttribute('data-lenis-prevent', '');
		document.body.appendChild(inspector.domElement);

		// Mobile browsers rarely expose GPU timestamp queries (WebGL's
		// EXT_disjoint_timer_query, WebGPU's timestamp-query feature), so the
		// upstream inspector's resolveFrame path never runs and #fps-counter
		// stays at "-". `inspector.fps` is still computed every frame in
		// RendererInspector.finish(), so mirror it to the DOM ourselves on the
		// same 0.25s cadence the upstream text cycle uses.
		const FPS_DOM_INTERVAL_MS = 250;
		let lastFpsDomUpdate = 0;
		const inspectorAny = inspector as any;
		const origFinish = inspectorAny.finish.bind(inspectorAny);
		inspectorAny.finish = function (this: any) {
			origFinish();
			const now = performance.now();
			if (now - lastFpsDomUpdate < FPS_DOM_INTERVAL_MS) return;
			lastFpsDomUpdate = now;
			const el = inspector.domElement.querySelector('#fps-counter');
			if (el && Number.isFinite(this.fps)) el.textContent = this.fps.toFixed();
		};

		this.sceneInspector = new SceneInspector(inspector, {
			camera: this.camera,
			scene: this.scene,
			lenisInstance: lenisInstance,
			virtualScrollHeight: virtualScrollHeight
		});

		this.sceneInspector.register('lighting', this.lights);
		this.sceneInspector.register('postProcessing', this.renderer);
		const trainSliderInstance = this.trainSliderHost?.getInstance();
		if (trainSliderInstance) this.sceneInspector.register('trainSlider', trainSliderInstance);
		if (this.groundFog) this.sceneInspector.register('groundFog', this.groundFog);
		if (this.daoFog) this.sceneInspector.register('daoFog', this.daoFog);

		this.sceneInspector.setup();
	}

	private setupIntroDebugOverlay(): void {
		if (this.introDebugOverlay) return;
		const el = document.createElement('pre');
		el.setAttribute('data-lenis-prevent', '');
		el.style.cssText = [
			'position:fixed',
			'left:8px',
			'top:8px',
			'z-index:2147483647',
			'max-width:calc(100vw - 16px)',
			'margin:0',
			'padding:8px',
			'background:rgba(0,0,0,0.78)',
			'color:#9cff9c',
			'font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
			'white-space:pre-wrap',
			'pointer-events:none'
		].join(';');
		el.textContent = 'intro debug initializing';
		document.body.appendChild(el);
		this.introDebugOverlay = el;
	}

	private updateIntroDebugOverlay(delta: number): void {
		const el = this.introDebugOverlay;
		if (!el) return;

		const state = this.introTransition.getDebugState();
		const action = this.scrollAnimationAction;
		const clip = action?.getClip();
		const lastProgress = this.progressPipeline.getLastProgress();
		const pendingProgress = this.progressPipeline.getPendingProgress();
		const tick = this.introDebugLastTick;

		el.textContent = [
			`frame=${this.frameNumber} ready=${this._sceneReady} mobile=${this.isMobile}`,
			`delta=${delta.toFixed(5)} errors=${this._renderErrors}`,
			`gates warmup=${state.warmupFinished} loading=${state.preloaderFinished} preloaderVisible=${state.preloaderVisible}`,
			`intro started=${state.started} active=${state.active} elapsed=${state.elapsedSeconds.toFixed(3)} end=${state.endProgress.toFixed(4)}`,
			`tick progress=${tick ? tick.progress.toFixed(4) : 'none'} complete=${tick?.complete ?? false}`,
			`pipeline last=${lastProgress.toFixed(4)} pending=${pendingProgress.toFixed(4)}`,
			`action=${clip?.name ?? 'none'} clipDuration=${clip ? clip.duration.toFixed(3) : 'none'} actionTime=${action ? action.time.toFixed(3) : 'none'}`
		].join('\n');
	}

	private setupIntroCompositorHeartbeat(): void {
		if (this.introCompositorHeartbeat) return;
		const el = document.createElement('span');
		el.setAttribute('aria-hidden', 'true');
		el.setAttribute('data-lenis-prevent', '');
		el.style.cssText = [
			'position:fixed',
			'left:0',
			'top:0',
			'z-index:2',
			'width:1px',
			'height:1px',
			'overflow:hidden',
			'pointer-events:none',
			'user-select:none',
			'opacity:0',
			'background:#000',
			'color:#000',
			'font:1px/1 ui-monospace,monospace',
			'contain:layout style paint',
			'will-change:transform,opacity',
			'transform:translate3d(0,0,0)'
		].join(';');
		document.body.appendChild(el);
		this.introCompositorHeartbeat = el;
	}

	private updateIntroCompositorHeartbeat(): void {
		const el = this.introCompositorHeartbeat;
		if (!el) return;

		if (!this.introTransition.isActive()) {
			if (el.style.opacity !== '0') {
				el.style.opacity = '0';
				el.textContent = '';
			}
			return;
		}

		this.introCompositorHeartbeatFrame = (this.introCompositorHeartbeatFrame + 1) % 100000;
		const bit = this.introCompositorHeartbeatFrame & 1;
		el.style.opacity = '0.001';
		el.style.transform = `translate3d(${bit}px,0,0)`;
		el.textContent = bit ? '1' : '0';
	}

	/** Rewinds the pipeline and all intro-gated visuals to progress 0. */
	private resetToProgressZero(): void {
		this.progressPipeline.setPendingProgress(0);
		this.progressPipeline.setLastProgress(0);
		this.applyProgressNow(0);
		this.applyIntroOctagonOpacity(0);
		this.applyIntroDaoFogOpacity(0);
	}

	public setCameraProgress(progress: number): void {
		if (!this.lights) return;
		this.progressPipeline.setScroll(progress);
	}

	public setActivePageSection(sectionIndex: number, sectionProgress: number): void {
		this.progressPipeline.setActivePageSection(sectionIndex, sectionProgress);
	}

	/**
	 * Per-frame intro tween dispatch. Reads the next progress from IntroTransition
	 * and fans out the post-tween fluid activation when the transition completes.
	 */
	private updateIntroTransition(delta: number): void {
		const tick = this.introTransition.tick(delta);
		this.introDebugLastTick = tick;
		if (!tick) return;
		this.progressPipeline.setPendingProgress(tick.progress);
		this.progressPipeline.setLastProgress(tick.progress);
		this.applyProgressNow(tick.progress);
		this.applyIntroOctagonOpacity(tick.elapsedSeconds);
		this.applyIntroDaoFogOpacity(tick.elapsedSeconds);
		if (tick.complete && this.features.octagonFluid) {
			this.octagonController?.activateFluidSim();
		}
	}

	/** Scratch buffer for per-layer intro opacities — avoids a per-frame allocation. */
	private readonly _introOctagonOpacities: number[] = [];

	private applyIntroOctagonOpacity(elapsedSeconds: number): void {
		const controller = this.octagonController;
		if (!controller) return;

		const layerCount = controller.getLayerCount();
		if (layerCount <= 0) return;

		const totalDelay = (layerCount - 1) * OCTAGON_INTRO_LAYER_DELAY_SECONDS;
		const fadeDuration = Math.max(0.001, INTRO_TRANSITION_SECONDS - totalDelay);
		const opacities = this._introOctagonOpacities;
		opacities.length = layerCount;
		for (let index = 0; index < layerCount; index++) {
			const delayedElapsed = elapsedSeconds - index * OCTAGON_INTRO_LAYER_DELAY_SECONDS;
			opacities[index] = Math.max(0, Math.min(1, delayedElapsed / fadeDuration));
		}
		controller.setLayerOpacities(opacities);
	}

	/**
	 * Intro fog fade. Ramps DaoFog's dedicated intro-opacity gate 0 → 1 across
	 * the intro tween so the fog blooms in alongside the octagon layers. This is
	 * a separate uniform from `masterOpacity` (which Theatre owns): Theatre
	 * flushes its value-change callbacks on its own ticker, so sharing the
	 * uniform would let a deferred Theatre write land after ours and flicker.
	 * The gate is multiplied into the layer alpha and never touched by Theatre.
	 */
	private applyIntroDaoFogOpacity(elapsedSeconds: number): void {
		if (!this.daoFog) return;
		const t = Math.max(0, Math.min(1, elapsedSeconds / INTRO_TRANSITION_SECONDS));
		this.daoFog.setIntroOpacity(t);
	}

	private configureAnimationPipeline(): void {
		this.animation.configurePipeline({
			postProcessingManager: this.renderer,
			timeline: this.progressPipeline.getSceneTimeline()
		});
	}

	public async loadObjects(url: string): Promise<void> {
		const gltf = await this.loadGltfModel(url);
		const assembled = this.assembleModelScene(gltf);
		if (!assembled) return;

		await this.setupParticleSystems(gltf, assembled.octagonGroup, assembled.cubes);
		this.setupAnimationsAndStages();
		this.registerTheatreObjects();

		// Bake the pyramid env now — after every pyramid material exists AND Theatre
		// has applied the authored gradient to the SharedMaterials fields. The bake
		// assigns the envMap with `needsUpdate`, which is what actually wires the
		// reflection into a node material (a construct-time envMap assignment does
		// not). Doing it earlier left the env attached to nothing / unwired, so it
		// only appeared after a manual Theatre nudge.
		SharedMaterials.initPyramidEnvironment(this.renderer.webGPURenderer);

		await this.finalizeSceneReady();
	}

	/** Phase 1 — network: fetch the main GLB with loading-bar progress. */
	private async loadGltfModel(url: string): Promise<GLTF> {
		let lastProgress = 0;

		return this.gltfLoader.loadAsync(url, (xhr) => {
			if (xhr.lengthComputable) {
				const progress = (xhr.loaded / xhr.total) * 100;

				if (progress > lastProgress) {
					lastProgress = progress;
					this.setLoadingStage('objects', Math.min(progress / 100, 0.95));
				}
			} else if (xhr.loaded > 0) {
				const estimatedTotal = 8 * 1024 * 1024;
				const progress = Math.min((xhr.loaded / estimatedTotal) * 100, 95);
				if (progress > lastProgress) {
					lastProgress = progress;
					this.setLoadingStage('objects', progress / 100);
				}
			}
		});
	}

	/**
	 * Phase 2 — scene assembly: shadows, animation clips, group resolution,
	 * camera, annotations, materials. Returns the objects later phases need,
	 * or null if the scene isn't initialized.
	 */
	private assembleModelScene(gltf: GLTF): {
		octagonGroup: ReturnType<typeof resolveSceneModelObjects>['octagonGroup'];
		cubes: ReturnType<typeof resolveSceneModelObjects>['cubesObject'];
	} | null {
		disableMeshShadows(gltf.scene);

		if (this.features.modelAnimations && gltf.animations && gltf.animations.length > 0) {
			this.animation.attachMixer(gltf.scene);
			this.animation.registerClips(gltf.animations);
		}

		const sceneObjects = resolveSceneModelObjects(gltf.scene);
		const octagonGroup = sceneObjects.octagonGroup;
		const cubes = sceneObjects.cubesObject;

		this.cubesGroup = sceneObjects.cubesGroup;
		this.forestGroup = sceneObjects.forestGroup;
		this.forestMainTreeGroup = sceneObjects.forestMainTreeGroup;
		this.forestOtherTreeGroups = sceneObjects.forestOtherTreeGroups;
		this.forestCityGroup = sceneObjects.forestCityGroup;

		this.updateMouseParallaxTargets();

		this.modelCamera = sceneObjects.modelCamera;
		applyInitialModelCamera(this.camera, this.modelCamera);

		if (!this.scene) {
			console.error('Scene not initialized when trying to add model!');
			return null;
		}

		this.scene.add(gltf.scene);
		this.gltfSceneRoot = gltf.scene;

		this.signObjects = sceneObjects.signObjects;

		// Annotations are desktop-only: on mobile they add per-frame DOM work
		// without meaningful screen presence.
		if (this.features.annotations && !this.isMobile) {
			this.annotations = new Annotations({
				scene: this.scene,
				camera: this.camera,
				rendererDomElement: this.renderer.domElement,
				signObjects: this.signObjects,
				fallbackPositions: [...DEFAULT_ANNOTATION_FALLBACK_POSITIONS],
				mobilePositioning: {
					...DEFAULT_ANNOTATION_MOBILE_POSITIONING,
					perAnnotationOffset: { ...DEFAULT_ANNOTATION_MOBILE_POSITIONING.perAnnotationOffset }
				}
			});
		}

		if (this.features.modelMaterials) {
			applyModelMaterials(gltf.scene);
		}
		this.setLoadingStage('objects', 1);
		this.setLoadingStage('sceneSetup', 0.2);
		if (this.features.chromaticAberration) {
			applyForestChromaticAberrationLayer(this.forestGroup, SCENE_LAYERS.CHROMATIC_3);
		}

		return { octagonGroup, cubes };
	}

	/** Phase 3 — particle systems: orchestrator, octagon, cubes, pyramid/VAT downloads. */
	private async setupParticleSystems(
		gltf: GLTF,
		octagonGroup: ReturnType<typeof resolveSceneModelObjects>['octagonGroup'],
		cubes: ReturnType<typeof resolveSceneModelObjects>['cubesObject']
	): Promise<void> {
		this.particleOrchestrator = new ParticleOrchestrator({
			scene: this.scene,
			isMobile: this.isMobile,
			particleRadiusScale: this.PARTICLE_RADIUS_SCALE,
			features: {
				cubesParticles: this.features.cubesParticles,
				pyramidParticles: this.features.pyramidParticles,
				forestParticles: this.features.forestParticles,
				fallbackPyramidParticles: this.features.fallbackPyramidParticles,
				pyramidVat: this.features.pyramidVat,
				chromaticAberration: this.features.chromaticAberration
			},
			modelRotationController: this.modelRotationController,
			gltfLoader: this.gltfLoader
		});

		if (this.features.octagonParticles) {
			this.setupOctagonParticles(octagonGroup);
		}
		this.particleOrchestrator.setupCubes(cubes);
		this.refreshModelGroups();

		this.particleOrchestrator.setupPyramidSolids(gltf.scene);
		this.particleOrchestrator.setupPyramidsAndForest(gltf.scene, !this.features.pyramidVat);
		this.refreshModelGroups();
		this.setLoadingStage('sceneSetup', 0.45);

		await Promise.all([
			this.particleOrchestrator.loadFallbackPyramids((loaded) =>
				this.reportPyramidAssetBytes('source', loaded)
			),
			this.particleOrchestrator.loadPyramidVAT((loaded) =>
				this.reportPyramidAssetBytes('vat', loaded)
			)
		]);
		// Both downloads resolved — snap the stage to full so any byte-accounting
		// drift (untracked merged GLB, size changes after a re-bake) can't leave
		// the bar short of 100%.
		this.setLoadingStage('pyramidAssets', 1);
		this.refreshModelGroups();

		// Drive the pyramid particles from the solid VAT (one source of truth): the
		// remesh particle source animates on a different schedule than the solid, so
		// mixer-driven dots drift mid-morph. This keeps the dot distribution but
		// carries each dot by its nearest solid object's VAT transform. Runs here,
		// after both loaded and before the mixer first poses the remesh (rest pose).
		this.particleOrchestrator.attachPyramidParticlesToVat();
		this.setLoadingStage('sceneSetup', 0.65);
	}

	/** Phase 4 — animation wiring and the per-section stage dispatcher. */
	private setupAnimationsAndStages(): void {
		if (this.features.modelAnimations) {
			this.setupScrollAnimations();
		}

		if (this.scrollAnimationAction && this.animation.hasMixer()) {
			this.scrollAnimationAction.time = 0.1;
			this.animation.flushMixer();
			this.syncCameraFromModel();
		}

		if (this.features.animationPipeline) {
			this.configureAnimationPipeline();
		}

		this.stageDispatcher = new StageDispatcher([
			new Scene1Stage(),
			new Scene2Stage(),
			new Scene3Stage()
		]);
		this.stageDispatcher.bindGltf({
			scene: this.scene,
			camera: this.camera,
			renderer: this.renderer,
			lights: this.lights,
			octagonPrimary: this.octagonController?.getPrimary() ?? null,
			octagonExtras: this.octagonController?.getExtras() ?? [],
			cubesGroup: this.cubesGroup,
			cubesParticles: this.particleOrchestrator.getCubes(),
			pyramidsGroup: this.pyramidsGroup,
			pyramidParticles: this.particleOrchestrator.getPyramidSystems(),
			pyramidVAT: this.particleOrchestrator.getPyramidVAT(),
			pyramidVATMesh: this.particleOrchestrator.getPyramidVATMesh(),
			forestGroup: this.forestGroup,
			forestParticles: this.particleOrchestrator.getForestSystems(),
			signTreeParticles: this.particleOrchestrator.getSignTreeSystems(),
			trainSlider: this.trainSliderHost?.getInstance() ?? undefined
		});
	}

	/** Phase 5 — Theatre.js object registration (authoritative authored values). */
	private registerTheatreObjects(): void {
		// Register Theatre.js objects. Once registered, Theatre is the sole
		// authoritative writer for vignette/bloom/fog/lights/particles/visibility/
		// canvas-invert authored bases.
		const visuals = new Visuals(this.renderer);
		const fluidSimulation = new FluidSimulation(this.globalFluidEffect, this.renderer);
		const transition = new Transition(this.renderer);
		if (this.sceneInspector) {
			this.sceneInspector.registerAndSetup('transition', transition);
			this.sceneInspector.registerAndSetup('materials', SharedMaterials);
		}

		if (this.theatreController?.isReady()) {
			const inspectables = new Map<string, Inspectable>();
			inspectables.set('PostProcessing', visuals);
			inspectables.set('FluidSimulation', fluidSimulation);
			inspectables.set('Transition', transition);
			inspectables.set('Lighting', this.lights);
			if (this.groundFog) inspectables.set('GroundFog', this.groundFog);
			if (this.daoFog) inspectables.set('DaoFog', this.daoFog);
			const trainSliderInst = this.trainSliderHost?.getInstance();
			if (trainSliderInst) inspectables.set('TrainSlider', trainSliderInst);
			for (const [name, insp] of SharedMaterials.getInspectables()) {
				inspectables.set(name, insp);
			}

			// Inverse of the page pipeline's mapGlobalProgressToSceneProgress, built
			// from the same section timelines the pipeline uses (default slide
			// count). Lets the debug Studio playhead → page-scroll path recover the
			// global scroll position from a scene-timeline position.
			const sectionProgressRanges = this.getSectionTimelines().map((t) => ({
				start: t.timelineStart,
				end: t.timelineEnd
			}));

			this.theatreController.registerObjects({
				inspectables,
				particleSystems: {
					octagon: this.octagonController?.getPrimary() ?? null,
					octagonExtras: this.octagonController?.getExtras() ?? [],
					cubes: this.particleOrchestrator.getCubes(),
					pyramids: this.particleOrchestrator.getPyramidSystems(),
					forest: this.particleOrchestrator.getForestSystems(),
					signTree: this.particleOrchestrator.getSignTreeSystems()
				},
				objectGroups: {
					cubes: this.cubesGroup,
					pyramids: this.pyramidsGroup,
					forestMainTree: this.forestMainTreeGroup,
					forestOtherTrees: this.forestOtherTreeGroups,
					forestCity: this.forestCityGroup
				},
				gridPlane: this.gridPlane ?? null,
				modelRotationController: this.modelRotationController,
				annotations: this.annotations,
				cameraFov: {
					initial: this.responsiveLayout.getCameraFov(),
					setFov: (fov) => {
						this.theatreCameraFov = fov;
						this.camera.fov = fov;
						this.camera.updateProjectionMatrix();
					}
				},
				sceneInvert: {
					isMobile: this.isMobile,
					sceneBackgroundBase: this.sceneBackgroundBase,
					invertBackgroundColor: this.invertBackgroundColor,
					setInverted: (amount: number) => {
						// Continuous invert amount (0..1). The renderer stores
						// this so the channel-1 pass's wrapped `updateBefore`
						// can lerp scene/material state around the render
						// (channels 2/3 are then reset to 0 so they stay
						// un-inverted).
						this.renderer.setSceneInvertAmount(amount);
					}
				},
				scroll: {
					lenisInstance,
					virtualScrollHeight,
					mapSceneProgressToGlobal: (sceneProgress) =>
						// Scene source read live so the playhead→scroll inverse follows
						// `Scene Boundaries` retiming, consistent with the forward map.
						mapProgressAcrossRanges(sceneProgress, sceneRangeState.ranges, sectionProgressRanges)
				}
			});

			// Channel-1 scene pass calls back into MainScene around its render
			// with the current invert amount (then 0) so particle/material/
			// background state lerps in for channel 1 and restores before
			// later passes (channels 2/3, post-FX).
			this.renderer.setSceneInvertCallback((amount) => this.setSceneInverted(amount));
		}
		this.setLoadingStage('sceneSetup', 0.85);
	}

	/** Phase 6 — precompile, warmup, and the ready/interaction handoff. */
	private async finalizeSceneReady(): Promise<void> {
		if (this.features.trainSlider && this.trainSliderHost) {
			await this.trainSliderHost.awaitReady();
		}
		this.setLoadingStage('sceneSetup', 0.92);

		if (this.features.rendererPrecompile) {
			await this.renderer.precompileAsync();
		}
		this.setLoadingStage('sceneSetup', 1);
		await this.warmupScene();

		this.resetToProgressZero();
		this.renderer.renderAsync();

		this.applyPreloaderIntro(1);
		this._sceneReady = true;
		this.frameNumber = 0;
		this.warmupFinished = true;
		this.trainSliderHost?.setInteractionEnabled(true);
		warmupComplete.set(true);
		this.introTransition.markWarmupFinished();
	}

	private resetLoadingProgress(): void {
		this.loadingProgressTracker.reset();
	}

	private setLoadingStage(stage: LoadingStage, value: number): void {
		this.loadingProgressTracker.advance(stage, value);
	}

	private reportPyramidAssetBytes(key: 'source' | 'vat', loaded: number): void {
		this.pyramidAssetLoaded[key] = loaded;
		const sizes = MainScene.PYRAMID_ASSET_BYTES;
		const loadedSum = this.pyramidAssetLoaded.source + this.pyramidAssetLoaded.vat;
		const totalSum = sizes.source + sizes.vat;
		// Cap below 1 mid-flight so the post-resolve snap owns the final tick.
		this.setLoadingStage('pyramidAssets', Math.min(0.99, loadedSum / totalSum));
	}

	private setupOctagonParticles(octagonObject: THREE.Object3D | undefined): void {
		if (!this._graphicsOptions.enableOctagonParticles) {
			return;
		}

		if (!octagonObject) {
			console.warn('Octagon object not found in model');
			return;
		}

		this.octagonController = new OctagonController({
			isMobile: this.isMobile,
			hasComputeSupport: this._hasComputeSupport,
			enablePhysics: this._graphicsOptions.enableOctagonPhysics,
			globalFluidEffect: this.globalFluidEffect,
			gpu: this.gpu,
			camera: this.camera,
			domElement: this.renderer.domElement
		});

		const meshes = this.octagonController.setupSystems(octagonObject, {
			particleRadius: (this.isMobile ? 0.015 : 0.007) * this.PARTICLE_RADIUS_SCALE,
			baseColors: [
				new THREE.Color(0.88, 0.88, 0.9),
				new THREE.Color(0.85, 0.85, 0.88),
				new THREE.Color(0.82, 0.82, 0.86)
			],
			emissiveIntensity: 0.8,
			fogAbsorption: 0.35,
			worldOffsetY: this.responsiveLayout.getOctagonOffsetY()
		});
		this.applyIntroOctagonOpacity(0);

		meshes.forEach((mesh, index) => {
			this.scene.add(mesh);
			mesh.renderOrder = 20 + index;
			// The octagon is the only CHROMATIC_1 object on screen during its own
			// section (pyramids stay hidden until the timeline's t=12.2, cubes fade in
			// at t=6.7), so dropping it from the layer leaves scene 1 with no CA at all.
			this.particleOrchestrator.enableChromaticLayer(mesh, SCENE_LAYERS.CHROMATIC_1);
		});
	}

	private setupScrollAnimations(): void {
		if (!this.features.modelAnimations) {
			return;
		}

		const animationNames = this.animation.getAnimationNames();

		if (animationNames.length === 0) {
			return;
		}

		this.animation.startScrollActions();

		const mainAnimationName =
			animationNames.find((name) => /camera/i.test(name)) ?? animationNames[0];
		const mainClipDuration = this.animation.getClipDuration(mainAnimationName);

		if (mainClipDuration != null && this.animation.hasMixer()) {
			this.scrollAnimationAction = this.animation.getScrollAction(mainAnimationName);
			// Build the scene timeline from the SCROLL clip's duration (the same
			// clip IntroTransition tweens). The pipeline's `introCutoffProgress`
			// (= INTRO_TRANSITION_SECONDS / fullDuration) must equal the intro
			// tween's `endProgress` (= INTRO_TRANSITION_SECONDS / scrollClipDuration)
			// so that, post-intro, mapToContentTimelineProgress cancels the intro
			// affine and sequence.position starts at 0 and sweeps to 1. Using the
			// longest of *all* clips (which can exceed the scroll clip) made
			// introCutoff < endProgress, so sequence.position started at a positive
			// offset — leaving the early timeline unreachable (playhead/scene boot
			// mid-timeline) until a real scroll. All clips are normalized to [0,1]
			// by progress in setScrollProgress, so this duration only drives the cutoff.
			this.progressPipeline.setSceneTimeline(
				createSceneTimeline(mainClipDuration, INTRO_TRANSITION_SECONDS)
			);
		}
	}

	private syncCameraFromModel(): void {
		if (this.modelCamera) {
			const worldPos = this.modelCamera.getWorldPosition(this._syncWorldPos);
			const worldQuat = this.modelCamera.getWorldQuaternion(this._syncWorldQuat);

			this.camera.position.copy(worldPos);
			this.camera.quaternion.copy(worldQuat);
		}
	}

	public setLenisInstance(lenis: Lenis): void {
		this._lenis = lenis;
		this.theatreController?.notifyLenisReady();
		this.trainSliderHost?.setLenis(lenis);
	}

	public clearLenisInstance(): void {
		this._lenis = null;
		this.trainSliderHost?.setLenis(null);
	}

	/**
	 * Drive the scene's material/background state toward the inverted palette
	 * by `amount` (0..1): background lerps `sceneBackgroundBase`→`invertBackgroundColor`,
	 * rim emissives lerp via the shared rim-inversion uniform.
	 *
	 * Particles and the octagon flip at the 0.5 threshold rather than lerping
	 * — their inversion swaps additive sprites to normal blending so
	 * non-additive black can render over the white bg, and that blend-mode
	 * change can't be tweened through a shader uniform. Lerping the colors
	 * without flipping the blend mode would leave additive sprites invisible
	 * over a near-white bg mid-transition, which looks worse than a snap.
	 */
	public setSceneInverted(amount: number): void {
		const a = Math.max(0, Math.min(1, amount));
		if (this.scene) {
			if (!(this.scene.background instanceof THREE.Color)) {
				this.scene.background = this.sceneBackgroundBase.clone();
			}
			(this.scene.background as THREE.Color)
				.copy(this.sceneBackgroundBase)
				.lerp(this.invertBackgroundColor, a);
			if (this.scene.fog instanceof THREE.FogExp2) {
				this.scene.fog.color.copy(this.sceneBackgroundBase).lerp(this.invertBackgroundColor, a);
			}
		}

		const inverted = a > 0.5;
		this.octagonController?.setColorInversion(inverted);
		this.particleOrchestrator.setColorInversion(inverted);

		SharedMaterials.setRimInversion(a);
	}

	/**
	 * Disposes GPU resources owned by the loaded GLB (geometries, materials and
	 * their textures). Texture/material `dispose()` is idempotent, so overlap
	 * with SharedMaterials/TextureCache disposal is safe.
	 */
	private disposeGltfSceneResources(): void {
		const root = this.gltfSceneRoot;
		if (!root) return;
		this.scene?.remove(root);
		root.traverse((object) => {
			const mesh = object as THREE.Mesh;
			if (mesh.geometry) mesh.geometry.dispose();
			const material = mesh.material;
			const materials = Array.isArray(material) ? material : material ? [material] : [];
			for (const mat of materials) {
				for (const value of Object.values(mat)) {
					if (value instanceof THREE.Texture) value.dispose();
				}
				mat.dispose();
			}
		});
		this.gltfSceneRoot = null;
	}

	private buildSliderScrollDriver(lenis: Lenis): ScrollDriver {
		const venturesRange = this.getSectionTimelines()[VENTURES_SECTION_INDEX];
		return {
			getScroll: () => lenis.animatedScroll,
			setScrollImmediate: (px) => {
				lenis.scrollTo(px, { immediate: true, force: true });
			},
			setScrollAnimated: (px, durationSec) => {
				lenis.scrollTo(px, {
					duration: durationSec,
					easing: SCROLL_TO_EASING,
					force: true
				});
			},
			cancelAnimatedScroll: () => {
				lenis.scrollTo(lenis.animatedScroll, { immediate: true, force: true });
			},
			getVenturesPixelRange: () => {
				const max = Math.max(1, lenis.dimensions.scrollHeight - lenis.dimensions.height);
				return {
					startPx: venturesRange.timelineStart * max,
					endPx: venturesRange.timelineEnd * max
				};
			},
			isDriverActive: () =>
				this.progressPipeline.getActivePageSection() === VENTURES_SECTION_INDEX &&
				this.warmupFinished
		};
	}

	private noteUserInput = (): void => {
		this._lastInputAt = performance.now();
	};

	/** Demotion step waiting for the current transition to finish — see applyQualityDemotion. */
	private pendingQualityDemotionStep: number | null = null;

	/**
	 * Governor demotion: step the render resolution down ~13% (floor 0.55).
	 * Reads the live scale — the benchmark may have started below the mobile
	 * default. The DaoFog prepass RT tracks the backing store via the
	 * renderer's resize path, so fog cost shrinks proportionally too.
	 *
	 * Demoting also clears the feedback trail for a frame — a visible pop if
	 * it happens mid-transition, which is also when demotion is most likely
	 * to fire. So we hold the step until the transition ends (flushed in the
	 * animate loop below) instead of applying it right away.
	 */
	private applyQualityDemotion(step: number): void {
		if (this.renderer.isTransitionActive()) {
			this.pendingQualityDemotionStep = step;
			return;
		}
		this.commitQualityDemotion(step);
	}

	private commitQualityDemotion(step: number): void {
		const options = this.renderer.graphicsOptions;
		const next = Math.max(0.55, options.resolutionScale * 0.87);
		if (next >= options.resolutionScale) return;
		options.resolutionScale = next;
		this.renderer.reapplyResolutionScale();
		console.info(
			`FramePacingGovernor: step ${step} — resolutionScale lowered to ${next.toFixed(2)}`
		);
	}

	/**
	 * True when nothing is moving the scene: post-intro, Lenis fully idle
	 * (`isScrolling` is `false | 'native' | 'smooth'` — `'native'` is iOS
	 * momentum and counts as active), no pending progress write this frame,
	 * and no recent touch/pointer input.
	 */
	private isIdleForHalfRate(now: number): boolean {
		return (
			this.warmupFinished &&
			!this.introTransition.isActive() &&
			this._lenis?.isScrolling === false &&
			!this.progressPipeline.isDirty() &&
			now - this._lastInputAt > MainScene.IDLE_INPUT_MS
		);
	}

	private animate = (time: number) => {
		try {
			if (this._lenis) {
				this._lenis.raf(time);
			}

			if (!this._sceneReady) {
				return;
			}

			if (this.renderer.isDeviceLost()) {
				void this.recoverGpu('device-lost');
				return;
			}

			const delta = this.animation.tickTimer(time);
			this.updateIntroTransition(delta);
			this.updateIntroCompositorHeartbeat();
			this.updateIntroDebugOverlay(delta);

			// Idle half-rate (mobile): render every 2nd frame while the user is
			// idle to halve sustained GPU load (thermal headroom). Skipped-frame
			// deltas carry into the next rendered frame so motion speed stays
			// correct. The check runs after lenis.raf, so a frame carrying a
			// fresh progress write is never skipped (isDirty() sees it).
			if (this.isMobile && this.isIdleForHalfRate(performance.now())) {
				this._idleSkipFrame = !this._idleSkipFrame;
				if (this._idleSkipFrame) {
					this._pendingDelta += delta;
					this._lastFrameAt = performance.now();
					return;
				}
			} else {
				this._idleSkipFrame = false;
			}

			this.frameNumber += 1;
			const effDelta = delta + this._pendingDelta;
			this._pendingDelta = 0;

			if (this.globalFluidEffect) {
				this.globalFluidEffect.step(effDelta);
			}

			this.trainSliderHost?.tickAnimation(effDelta);

			const pendingProgress = this.progressPipeline.consumeDirty();
			const progressDirty = pendingProgress !== null;

			// `setScroll` writes lastProgress and pendingProgress together, so when
			// dirty, `pendingProgress === lastProgress` — one mapping serves both
			// `applyProgressNow` and the rotation controller below.
			const lastProgress = this.progressPipeline.getLastProgress();
			const contentProgress = this.progressPipeline.mapToContentTimelineProgress(
				lastProgress >= 0 ? lastProgress : this.progressPipeline.getPendingProgress()
			);
			if (progressDirty) {
				this.applyProgressNow(pendingProgress, contentProgress);
			}

			const cubesParticleVisible = this.particleOrchestrator?.getCubes()?.isVisible() ?? false;

			// Freeze the auto-rotation angle while the scroll is actively driving the
			// scene. The scroll clip animates these same objects, and on a scroll-back
			// (Partners/Ventures) it plays in reverse — a forward auto-spin fights it
			// into a flicker. `isScrolling` is `false | 'native' | 'smooth'`, so any
			// truthy value (or a fresh progress write this frame) counts as active;
			// once settled the spin resumes from where it left off (no snap).
			const scrollActive = progressDirty || Boolean(this._lenis?.isScrolling);

			const { cubesDirty, pyramidsDirty } = this.modelRotationController.update(
				effDelta,
				cubesParticleVisible || Boolean(this.cubesGroup?.visible),
				Boolean(this.pyramidsGroup?.visible),
				!scrollActive
			);

			const mouseShiftDirty = this.mouseParallaxShift?.update(effDelta) ?? false;

			this.particleOrchestrator.tickTransforms({
				progressDirty,
				cubesDirty,
				pyramidsDirty,
				mouseShiftDirty
			});

			if (this.features.octagonFluid) {
				this.octagonController?.tickActivityDecay(effDelta);
			}

			this.octagonController?.tickTransforms();
			this.octagonController?.tickCompute(this.frameNumber);

			// Camera-tracked headlight follows the camera each frame (after
			// applyProgressNow has positioned it), before the render.
			this.lights?.updateLightPositions();

			this.renderer.renderAsync();
			this.annotations?.render();
			this._lastFrameAt = performance.now();
			// A pipeline stuck mid-compile makes three.js silently skip its draw
			// call every frame — animate() keeps running fine (that's why
			// _lastFrameAt above is no help), but lastFrameDrawCalls stays 0.
			// Only advance on a frame that actually drew something, so the loop
			// guard's getLastDrawAt() can catch that class of freeze.
			if (this.renderer.lastFrameDrawCalls !== 0) {
				this._lastDrawAt = this._lastFrameAt;
			}
			// Raw delta, not effDelta — the carried idle delta would read as
			// fake jank. Intro frames are excluded as unrepresentative.
			if (!this.introTransition.isActive()) {
				this.framePacingGovernor?.recordFrame(delta, this._lastFrameAt);
			}
			if (this.pendingQualityDemotionStep !== null && !this.renderer.isTransitionActive()) {
				const step = this.pendingQualityDemotionStep;
				this.pendingQualityDemotionStep = null;
				this.commitQualityDemotion(step);
			}
			this._renderErrors = 0;
		} catch (error) {
			if (++this._renderErrors >= 2) void this.recoverGpu('render-error');
			else console.error('MainScene render frame failed:', error);
		}
	};

	public cleanup(): void {
		this._disposed = true;
		this._loopGuardDispose?.();
		this._loopGuardDispose = null;

		this.responsiveLayout.stop();

		if (this.theatreController) {
			this.theatreController.dispose();
			this.theatreController = null;
		}

		this.introTransition.dispose();
		if (this.introDebugOverlay) {
			this.introDebugOverlay.remove();
			this.introDebugOverlay = null;
		}
		this.introDebugLastTick = null;
		if (this.introCompositorHeartbeat) {
			this.introCompositorHeartbeat.remove();
			this.introCompositorHeartbeat = null;
		}

		if (this.mouseParallaxShift) {
			this.mouseParallaxShift.stop();
			this.mouseParallaxShift = null;
		}

		this.mouseInteractions?.cleanup();

		if (this.groundFog) {
			this.groundFog.dispose();
			this.groundFog = undefined;
		}

		if (this.daoFog) {
			this.renderer.setOverlayCompositor(null);
			this.daoFog.dispose();
			this.daoFog = undefined;
		}

		if (this.trainSliderHost) {
			this.trainSliderHost.dispose();
			this.trainSliderHost = null;
		}
		this.slidesScene?.clear();

		if (this.globalFluidEffect) {
			this.globalFluidEffect.dispose();
			this.globalFluidEffect = null;
		}
		if (this.gridPlane) {
			this.gridPlane.dispose();
			this.gridPlane = null;
		}

		if (this.octagonController) {
			this.octagonController.dispose();
			this.octagonController = null;
		}

		this.particleOrchestrator?.dispose();

		if (this.stageDispatcher) {
			this.stageDispatcher.dispose();
			this.stageDispatcher = null;
		}

		this.animation.dispose();

		this.disposeGltfSceneResources();
		this.lights?.dispose();

		this.dracoLoader.dispose();
		this.ktx2Loader.dispose();

		SharedMaterials.dispose();
		TextureCache.dispose();

		if (this.sceneInspector) {
			this.sceneInspector.destroy();
			this.sceneInspector = undefined;
		}

		if (this.inspector) {
			if (this.inspector.domElement && this.inspector.domElement.parentNode) {
				this.inspector.domElement.parentNode.removeChild(this.inspector.domElement);
			}
			if (this.renderer) {
				(this.renderer.webGPURenderer as any).inspector = null;
			}
			this.inspector = undefined;
		}

		this.renderer.webGPURenderer.setAnimationLoop(null);

		if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentNode) {
			this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
		}

		if (this.renderer) {
			this.renderer.dispose();
		}
		this.annotations?.destroy();
		this.annotations = undefined;
		this.signObjects = [];
		this.modelRotationController.cleanup();

		if (this.mouseInteractions) {
			window.removeEventListener('mousemove', this.mouseInteractions.onMouseMove);
			window.removeEventListener('touchstart', this.mouseInteractions.onTouchStart);
			window.removeEventListener('touchmove', this.mouseInteractions.onTouchMove);
			this.mouseInteractions = null;
		}

		window.removeEventListener('pointerdown', this.noteUserInput);
		window.removeEventListener('pointermove', this.noteUserInput);
		window.removeEventListener('touchstart', this.noteUserInput);
	}
}

export { MainScene };
