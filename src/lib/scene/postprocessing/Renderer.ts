import * as THREE from 'three/webgpu';
import { float, uniform } from 'three/tsl';
import { HalfFloatType, LinearFilter, RenderTarget, WebGPURenderer } from 'three/webgpu';
import type { FluidMouseField } from '../particles/FluidMouseField';
import { detectAndroidChrome, detectMob } from '$lib/utils/isMobile';
import { getCappedDevicePixelRatio } from '$lib/utils/devicePixelRatio';
import { SharedMaterials } from '../materials/SharedMaterials';
import {
	type GraphicsOptions,
	createDefaultGraphicsOptions,
	clampResolution
} from '../GraphicsConfig';
import type { Inspectable } from '../debug/Inspectable';
import type { SceneIndex } from '../sceneLayers';
import PostProcessingGraph from './PostProcessingGraph';
import { setupRendererInspectorControls } from './RendererInspector';
import {
	type PostProcessingGraphHost,
	type RendererInitOptions,
	type TransitionLookParams,
	type TransitionPairId,
	FLUID_DISABLE_FILL_END,
	FLUID_DISABLE_FILL_START
} from './types';

export type { RendererInitOptions, TransitionLookParams, TransitionPairId } from './types';

export type LoopGuardOptions = {
	isActive: () => boolean;
	isDisposed: () => boolean;
	getLoop: () => ((time: number) => void) | null;
	onVisible?: () => void;
	onRecover: (reason: string) => void;
	getLastFrameAt: () => number;
	setLastFrameAt: (time: number) => void;
	/** Last time a frame produced at least one real GPU draw call (see `lastFrameDrawCalls`). */
	getLastDrawAt: () => number;
};

export class Renderer implements Inspectable, PostProcessingGraphHost {
	private _renderer: WebGPURenderer;
	private readonly postGraph: PostProcessingGraph;
	private readonly forceWebGLFallback: boolean;
	private viewportWidth = 0;
	private viewportHeight = 0;

	private feedbackReadRT: RenderTarget | null = null;
	private feedbackWriteRT: RenderTarget | null = null;
	private overlayCompositor: ((background: any) => any) | null = null;

	/** Notifies the overlay owner (DaoFog) when the physical surface size changes. */
	private overlaySurfaceResize: ((width: number, height: number) => void) | null = null;
	private slidesOverlayScene: THREE.Scene | null = null;
	private slidesOverlayLayer: number = 0;

	feedbackPrevTexture: any | null = null;
	scene!: THREE.Scene;
	camera!: THREE.PerspectiveCamera;
	params: any;
	fluidEffect: FluidMouseField | null = null;

	sceneInvertAmount = 0;
	sceneInvertCallback: ((amount: number) => void) | null = null;

	readonly isMobile: boolean;
	readonly graphicsOptions: GraphicsOptions;

	constructor(graphicsOptions?: GraphicsOptions) {
		this.graphicsOptions = graphicsOptions ?? createDefaultGraphicsOptions();
		this.isMobile = detectMob();
		this.forceWebGLFallback = detectAndroidChrome();

		if (this.forceWebGLFallback) {
			console.warn('Android Chrome detected: forcing WebGL backend for stability');
		}

		this._renderer = this.createWebGPURenderer();
		this.postGraph = new PostProcessingGraph(this);
		this.postGraph.fluidActive = uniform(float(1));
	}

	async init(options: RendererInitOptions): Promise<void> {
		this.scene = options.scene;
		this.camera = options.camera;
		this.params = options.params;
		this.fluidEffect = options.fluidEffect;

		await this._renderer.init();

		this.viewportWidth = window.innerWidth;
		this.viewportHeight = window.innerHeight;
		this.applyRenderSurfaceSize(this.viewportWidth, this.viewportHeight);

		this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this._renderer.toneMappingExposure = 1.2;

		if (this.graphicsOptions.shadowMapType !== null) {
			this._renderer.shadowMap.enabled = true;
			this._renderer.shadowMap.type = this.graphicsOptions.shadowMapType;
		} else {
			this._renderer.shadowMap.enabled = false;
		}
		this._renderer.domElement.classList.add('canvas');

		options.ktx2Loader.detectSupport(this._renderer);
		options.gltfLoader.setKTX2Loader(options.ktx2Loader);

		const container = document.querySelector('.canvas-container');
		if (container) {
			container.appendChild(this._renderer.domElement);
		} else {
			document.body.appendChild(this._renderer.domElement);
		}

		this.allocateFeedbackRTs();
		this.setupPostProcessing();
	}

	get domElement(): HTMLCanvasElement {
		return this._renderer.domElement;
	}

	get webGPURenderer(): WebGPURenderer {
		return this._renderer;
	}

	get hasComputeSupport(): boolean {
		const backend = (this._renderer as any).backend;
		return backend?.isWebGPUBackend === true;
	}

	isDeviceLost(): boolean {
		return Boolean((this._renderer as unknown as { _isDeviceLost?: boolean })._isDeviceLost);
	}

	/**
	 * Draw calls actually issued to the GPU during the frame just rendered
	 * (three.js resets this counter at the start of every animation-loop
	 * tick). Unlike a "did animate() run" timestamp, this stays 0 when a
	 * render object's pipeline is still compiling asynchronously — three.js
	 * silently skips the draw call in that case (no throw, no device-lost
	 * event) — so it's the only reliable signal that the canvas is actually
	 * still producing pixels, not just that JS is still executing.
	 */
	get lastFrameDrawCalls(): number {
		const info = (this._renderer as unknown as { info?: { render?: { drawCalls?: number } } }).info;
		return info?.render?.drawCalls ?? -1;
	}

	/**
	 * Rebuild the underlying WebGPU/WebGL context after device loss or a fatal
	 * GPU error. Reuses the existing canvas and post-processing graph host.
	 */
	bindLoopGuard(options: LoopGuardOptions): () => void {
		const STALL_MS = 4000;
		const COOLDOWN_MS = 8000;
		let lastRecoveryAt = 0;

		const scheduleRecover = (reason: string) => {
			if (options.isDisposed() || performance.now() - lastRecoveryAt < COOLDOWN_MS) return;
			lastRecoveryAt = performance.now();
			options.onRecover(reason);
		};

		const ensureLoop = () => {
			const loop = options.getLoop();
			if (loop && this._renderer.getAnimationLoop() !== loop) {
				void this._renderer.setAnimationLoop(loop);
			}
		};

		const prevOnDeviceLost = this._renderer.onDeviceLost?.bind(this._renderer);
		this._renderer.onDeviceLost = (info) => {
			prevOnDeviceLost?.(info);
			scheduleRecover('device-lost');
		};

		const onVisibility = () => {
			if (document.hidden) return;
			options.onVisible?.();
			ensureLoop();
			if (this.isDeviceLost()) scheduleRecover('visibility');
		};
		document.addEventListener('visibilitychange', onVisibility);

		const watchdog = setInterval(() => {
			if (options.isDisposed() || !options.isActive() || document.hidden) return;
			if (this.isDeviceLost()) return scheduleRecover('device-lost');

			const stalled = performance.now() - options.getLastFrameAt();
			if (options.getLastFrameAt() > 0 && stalled > STALL_MS) {
				ensureLoop();
				return scheduleRecover('stalled');
			}

			// animate() can keep ticking normally (JS/UI stays responsive) while
			// the GPU silently stops presenting new frames — e.g. a render
			// object's pipeline stuck mid-compile. getLastFrameAt() alone can't
			// see that; getLastDrawAt() only advances on a frame with real draw
			// calls, so it catches the freeze the JS-side check is blind to.
			const drawStalled = performance.now() - options.getLastDrawAt();
			if (options.getLastDrawAt() > 0 && drawStalled > STALL_MS) {
				scheduleRecover('no-draw-calls');
			}
		}, 2000);

		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			clearInterval(watchdog);
		};
	}

	async recreateGpuContext(
		loaders: Pick<RendererInitOptions, 'ktx2Loader' | 'gltfLoader'>
	): Promise<void> {
		const canvas = this._renderer.domElement;
		const parent = canvas.parentNode;
		const savedState = {
			toneMapping: this._renderer.toneMapping,
			toneMappingExposure: this._renderer.toneMappingExposure,
			outputColorSpace: this._renderer.outputColorSpace,
			shadowMapEnabled: this._renderer.shadowMap.enabled,
			shadowMapType: this._renderer.shadowMap.type
		};

		if (this.feedbackReadRT) this.feedbackReadRT.dispose();
		if (this.feedbackWriteRT) this.feedbackWriteRT.dispose();
		this.feedbackReadRT = null;
		this.feedbackWriteRT = null;
		this.feedbackPrevTexture = null;
		this.postGraph.dispose();
		this._renderer.dispose();

		this._renderer = this.createWebGPURenderer(canvas);
		await this._renderer.init();

		this._renderer.toneMapping = savedState.toneMapping;
		this._renderer.toneMappingExposure = savedState.toneMappingExposure;
		this._renderer.outputColorSpace = savedState.outputColorSpace;
		this._renderer.shadowMap.enabled = savedState.shadowMapEnabled;
		this._renderer.shadowMap.type = savedState.shadowMapType;
		this._renderer.domElement.classList.add('canvas');

		if (parent && canvas.parentNode !== parent) {
			parent.appendChild(canvas);
		}

		this.applyRenderSurfaceSize(this.viewportWidth, this.viewportHeight);
		this.allocateFeedbackRTs();
		this.setupPostProcessing();

		loaders.ktx2Loader.detectSupport(this._renderer);
		loaders.gltfLoader.setKTX2Loader(loaders.ktx2Loader);

		if (this.overlayCompositor) {
			this.notifyOverlaySurfaceResize();
			this.postGraph.rebuildOutputNode();
		}
	}

	get toneMappingExposure(): number {
		return this._renderer.toneMappingExposure;
	}

	set toneMappingExposure(v: number) {
		this._renderer.toneMappingExposure = v;
	}

	get toneMapping(): THREE.ToneMapping {
		return this._renderer.toneMapping;
	}

	set toneMapping(v: THREE.ToneMapping) {
		this._renderer.toneMapping = v;
	}

	get outputColorSpace(): string {
		return this._renderer.outputColorSpace;
	}

	set outputColorSpace(v: string) {
		this._renderer.outputColorSpace = v;
	}

	get shadowMap() {
		return this._renderer.shadowMap;
	}

	setPixelRatio(v: number): void {
		this._renderer.setPixelRatio(v);
	}

	setSize(w: number, h: number): void {
		this.applyRenderSurfaceSize(w, h);
	}

	async computeAsync(node: any): Promise<void> {
		await this._renderer.computeAsync(node);
	}

	async precompileAsync(): Promise<void> {
		const visibilityMap = new Map<THREE.Object3D, boolean>();
		this.scene.traverse((obj) => {
			visibilityMap.set(obj, obj.visible);
			obj.visible = true;
		});

		await this._renderer.compileAsync(this.scene, this.camera);

		for (const [obj, wasVisible] of visibilityMap) {
			obj.visible = wasVisible;
		}
	}

	get materials(): typeof SharedMaterials {
		return SharedMaterials;
	}

	getOverlayCompositor(): ((background: any) => any) | null {
		return this.overlayCompositor;
	}

	setOverlayCompositor(
		fn: ((background: any) => any) | null,
		onSurfaceResize?: ((width: number, height: number) => void) | null
	): void {
		this.overlayCompositor = fn;
		this.overlaySurfaceResize = onSurfaceResize ?? null;
		// Size the overlay's render targets before the compositor builds them.
		this.notifyOverlaySurfaceResize();
		this.postGraph.rebuildOutputNode();
	}

	private notifyOverlaySurfaceResize(): void {
		// Same size source as allocateFeedbackRTs — the post-scale backing store.
		this.overlaySurfaceResize?.(this._renderer.domElement.width, this._renderer.domElement.height);
	}

	/**
	 * Register a scene whose contents (filtered to the given layer) render in
	 * a TSL pass and composite on top of the DaoFog overlay. State is cached
	 * here so `recreateGpuContext` can re-bind after the graph is rebuilt.
	 */
	setSlidesOverlay(scene: THREE.Scene | null, layer: number): void {
		this.slidesOverlayScene = scene;
		this.slidesOverlayLayer = layer;
		this.postGraph.setSlidesOverlay(scene, layer);
	}

	onResize(width: number, height: number): void {
		this.applyRenderSurfaceSize(width, height);
		this.postGraph.aspectRatio.value = width / height;
		this.allocateFeedbackRTs();
		this.notifyOverlaySurfaceResize();
	}

	/**
	 * Re-applies the current `graphicsOptions.resolutionScale` at the last
	 * known viewport size. For runtime quality demotion: only the backing
	 * store changes (CSS/layout size is untouched), so ResponsiveLayout
	 * consumers don't need to re-run. Side effect: the feedback RTs are
	 * reallocated, clearing feedback trails for one frame.
	 */
	reapplyResolutionScale(): void {
		this.onResize(this.viewportWidth, this.viewportHeight);
	}

	renderAsync(): void {
		if (this.postGraph.feedbackPipeline && this.feedbackWriteRT && this.feedbackReadRT) {
			const prevRT = this._renderer.getRenderTarget();
			this._renderer.setRenderTarget(this.feedbackWriteRT);
			this.postGraph.feedbackPipeline.render();

			const swap = this.feedbackReadRT;
			this.feedbackReadRT = this.feedbackWriteRT;
			this.feedbackWriteRT = swap;
			this.feedbackPrevTexture.value = this.feedbackReadRT.texture;
			this._renderer.setRenderTarget(prevRT);
		}
		this.postGraph.postProcessing.render();
	}

	setFeedbackDecay(amount: number): void {
		if (!this.postGraph.feedbackDecay) return;
		// The decay smear is part of the transition look — with the transition
		// disabled, pin the feedback pipeline to identity. The feedback pass
		// itself must keep rendering either way: it is the image carrier.
		if (!this.graphicsOptions.postProcessing.cloudTransition) amount = 0;
		this.postGraph.feedbackDecay.value = Math.max(0, Math.min(0.95, amount));
	}

	getPostProcessing() {
		return this.postGraph.postProcessing;
	}

	getVignetteIntensity(): any {
		return this.postGraph.vignetteIntensity;
	}

	getVignetteWidth(): any {
		return this.postGraph.vignetteWidth;
	}

	getVignetteRoundness(): any {
		return this.postGraph.vignetteRoundness;
	}

	getFluidActive(): any {
		return this.postGraph.fluidActive;
	}

	getFluidDistortionStrength(): any {
		return this.postGraph.fluidDistortionStrength;
	}

	getFluidDebug(): any {
		return this.postGraph.fluidDebug;
	}

	getFluidColorTint(): any {
		return this.postGraph.fluidColorTint;
	}

	getFluidColorAmount(): any {
		return this.postGraph.fluidColorAmount;
	}

	setCloudTransitionFillProgress(progress: number): void {
		if (!this.postGraph.cloudTransitionProgress) return;
		const clamped = Math.max(0, Math.min(1, progress));
		this.postGraph.cloudTransitionProgress.value = clamped;
		// Transition disabled: no dissolve consumes the progress — keep the fluid
		// field active (no mid-window fade) and skip dominance gating (the pair
		// is suppressed in setActiveScenes, so the gates stay at 1).
		if (!this.graphicsOptions.postProcessing.cloudTransition) return;
		this.postGraph.fluidActive.value = this.getFluidActiveForCloudFill(clamped);
		// Bloom/freeze dominance gating follows the progress just written.
		this.postGraph.updateTransitionChannelGates();
	}

	getCloudTransitionFillProgress(): number {
		return this.postGraph.cloudTransitionProgress?.value ?? 0;
	}

	setCloudTransitionSweepDirection(direction: 1 | -1): void {
		if (!this.postGraph.cloudTransitionSweepDirection) return;
		this.postGraph.cloudTransitionSweepDirection.value = direction === -1 ? -1 : 1;
	}

	setTransitionLook(pair: TransitionPairId, params: TransitionLookParams): void {
		this.postGraph.setTransitionLook(pair, params);
	}

	setActiveTransitionPair(pair: TransitionPairId): void {
		this.postGraph.setActiveTransitionPair(pair);
	}

	setActiveScenes(active: SceneIndex, from: SceneIndex | null, to: SceneIndex | null): void {
		this.postGraph.setActiveScenes(active, from, to);
	}

	/** True while a scene-pair dissolve (1→2 or 2→3) is in flight. */
	isTransitionActive(): boolean {
		return this.postGraph.isTransitionActive();
	}

	getRefs(): any {
		return this.postGraph.getRefs();
	}

	getPostProcessingPanel(): any {
		return this.postGraph.postProcessingPanel;
	}

	setPostProcessingPanel(panel: any): void {
		this.postGraph.postProcessingPanel = panel;
	}

	setSceneInvertCallback(callback: (amount: number) => void): void {
		this.sceneInvertCallback = callback;
	}

	setSceneInvertAmount(amount: number): void {
		this.sceneInvertAmount = Math.max(0, Math.min(1, amount));
	}

	setupInspectorControls(inspectorInstance: any, scene?: THREE.Scene): any {
		return setupRendererInspectorControls(this, inspectorInstance, scene);
	}

	getGraphicsOptions(): GraphicsOptions {
		return this.graphicsOptions;
	}

	dispose(): void {
		if (this.feedbackReadRT) this.feedbackReadRT.dispose();
		if (this.feedbackWriteRT) this.feedbackWriteRT.dispose();
		this.postGraph.dispose();
		this._renderer.dispose();
	}

	private setupPostProcessing(): void {
		this.postGraph.build(this.feedbackReadRT!);
		if (this.slidesOverlayScene) {
			this.postGraph.setSlidesOverlay(this.slidesOverlayScene, this.slidesOverlayLayer);
		}
	}

	private allocateFeedbackRTs(): void {
		const width = Math.max(1, this._renderer.domElement.width);
		const height = Math.max(1, this._renderer.domElement.height);
		const opts = {
			type: HalfFloatType,
			colorSpace: THREE.LinearSRGBColorSpace,
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			depthBuffer: false,
			stencilBuffer: false
		};

		if (this.feedbackReadRT) this.feedbackReadRT.dispose();
		if (this.feedbackWriteRT) this.feedbackWriteRT.dispose();

		this.feedbackReadRT = new RenderTarget(width, height, opts);
		this.feedbackWriteRT = new RenderTarget(width, height, opts);

		this.clearFeedbackRTs();

		if (this.feedbackPrevTexture) {
			this.feedbackPrevTexture.value = this.feedbackReadRT.texture;
		}
	}

	private clearFeedbackRTs(): void {
		const r = this._renderer;
		const prev = r.getRenderTarget();
		const prevAutoClear = r.autoClear;
		const prevAutoClearColor = r.autoClearColor;
		r.autoClear = true;
		r.autoClearColor = true;

		for (const rt of [this.feedbackReadRT, this.feedbackWriteRT]) {
			if (!rt) continue;
			r.setRenderTarget(rt);
			r.clear(true, false, false);
		}

		r.setRenderTarget(prev);
		r.autoClear = prevAutoClear;
		r.autoClearColor = prevAutoClearColor;
	}

	private applyRenderSurfaceSize(width: number, height: number): void {
		this.viewportWidth = width;
		this.viewportHeight = height;
		const pixelRatio = getCappedDevicePixelRatio();
		const resolutionScale = THREE.MathUtils.clamp(
			this.graphicsOptions.resolutionScale ?? 1,
			0.05,
			1
		);
		const clampedPhysical = clampResolution(
			Math.max(1, Math.round(width * pixelRatio)),
			Math.max(1, Math.round(height * pixelRatio)),
			this.graphicsOptions.maxResolution
		);
		const renderWidth = Math.max(
			1,
			Math.round((clampedPhysical.width * resolutionScale) / pixelRatio)
		);
		const renderHeight = Math.max(
			1,
			Math.round((clampedPhysical.height * resolutionScale) / pixelRatio)
		);
		this._renderer.setPixelRatio(pixelRatio);
		this._renderer.setSize(renderWidth, renderHeight, false);
	}

	private getFluidActiveForCloudFill(fillProgress: number): number {
		const fade = THREE.MathUtils.smoothstep(
			fillProgress,
			FLUID_DISABLE_FILL_START,
			FLUID_DISABLE_FILL_END
		);
		return 1 - fade;
	}

	private createWebGPURenderer(canvas?: HTMLCanvasElement): WebGPURenderer {
		return new WebGPURenderer({
			...(canvas ? { canvas } : {}),
			antialias: this.isMobile,
			forceWebGL: this.forceWebGLFallback
		});
	}
}

export default Renderer;
