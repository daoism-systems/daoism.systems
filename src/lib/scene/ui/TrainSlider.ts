import * as THREE from 'three';
import { uniform, float, vec2 } from 'three/tsl';
import type { WebGPURenderer } from 'three/src/Three.WebGPU.Nodes.js';
import { BASE_SLIDE_COUNT, SLIDES, type SlideData } from './slideData';
import { getCappedDevicePixelRatio } from '$lib/utils/devicePixelRatio';
import { TextureCache } from '../materials/TextureCache';
import type { GraphicsTier } from '../GraphicsConfig';
import type { VelocityNode } from '../particles/FluidMouseField';
import {
	DEFAULT_SLIDER_CONFIG,
	PERFORMANCE_PRESETS,
	getMobileCurveScale,
	resolveSliderProps,
	type ResolvedSliderProps,
	type SliderConfig,
	type SliderDebugValues
} from './trainSlider/config';
import {
	type FocusUniform,
	type SlideMeshLike,
	updateSlideTransforms as applySlideTransforms
} from './trainSlider/layout';
import { createSlideMaterial } from './trainSlider/materials';
import type { Inspectable } from '../debug/Inspectable';
import { SCENE_LAYERS } from '../sceneLayers';

const DRAG_AXIS_LOCK_PX = 12;
const DRAG_COMMIT_FRACTION = 0.35;
const DRAG_VELOCITY_WINDOW_MS = 80;
const INERTIA_TAU_SEC = 0.55;
const INERTIA_MIN_DURATION_SEC = 0.35;
const INERTIA_MAX_DURATION_SEC = 1.4;
const EDGE_RUBBER_BAND_FRAC = 0.18;
const VISIBLE_CARDS_DESKTOP = 2.5;
const VISIBLE_CARDS_MOBILE = 1.3;
const MOBILE_VIEWPORT_PX = 768;
const SNAP_ON_RELEASE_DEFAULT = true;

type SliderTimingConfig = {
	snapOnRelease: boolean;
	dragCommitFraction: number;
	inertiaProjectionSec: number;
	inertiaMinDurationSec: number;
	inertiaMaxDurationSec: number;
	inertiaDurationScale: number;
};

const DEFAULT_TIMING_CONFIG: SliderTimingConfig = {
	snapOnRelease: SNAP_ON_RELEASE_DEFAULT,
	dragCommitFraction: DRAG_COMMIT_FRACTION,
	inertiaProjectionSec: INERTIA_TAU_SEC,
	inertiaMinDurationSec: INERTIA_MIN_DURATION_SEC,
	inertiaMaxDurationSec: INERTIA_MAX_DURATION_SEC,
	inertiaDurationScale: 1
};

export type ScrollDriver = {
	getScroll: () => number;
	setScrollImmediate: (px: number) => void;
	setScrollAnimated: (px: number, durationSec: number) => void;
	cancelAnimatedScroll: () => void;
	getVenturesPixelRange: () => { startPx: number; endPx: number };
	isDriverActive: () => boolean;
};

type Props = {
	renderer: WebGPURenderer;
	aspect?: number;
	planeWidth?: number;
	planeHeight?: number;
	spacing?: number;
	mobileClickHint?: boolean;
	performanceTier?: GraphicsTier;
	fluidVelocityNode?: VelocityNode | null;
	fluidSimSize?: THREE.Vector2 | null;
};

type SlideUserData = {
	slideIndex: number;
	originalIndex: number;
	mainTexture: THREE.Texture;
	titleTexture: THREE.Texture | null;
	focusUniform: FocusUniform;
};

type SlideMesh = THREE.Mesh & {
	userData: SlideUserData;
};

class TrainSlider implements Inspectable {
	private group: THREE.Group;
	private slides: SlideMesh[] = [];
	private props: ResolvedSliderProps;
	private slideData: SlideData[] = [];
	private camera: THREE.Camera | null = null;
	private raycaster: THREE.Raycaster;
	private mouse: THREE.Vector2;
	private interactionDomElement: HTMLElement;
	private currentInteractionSlide: number = -1;
	private renderer: WebGPURenderer;
	private isMouseOver = false;
	private geometrySegments = { width: 32, height: 16 };
	private lastMouseMoveTime = 0;
	private lastHoverCheckTime = 0;
	private readonly tapMoveThresholdPx = 14;
	private readonly tapDurationThresholdMs = 350;
	private pointerDownClientX = 0;
	private pointerDownClientY = 0;
	private pointerDownTime = 0;
	private pointerIsDown = false;
	private interactionEnabled = false;
	private listenerCleanup: Array<() => void> = [];

	private scrollDriver: ScrollDriver | null = null;
	private dragSamples: Array<{ t: number; scrollPx: number }> = [];
	private dragActive = false;
	private dragAxisLocked: 'horizontal' | 'vertical' | null = null;
	private dragStartScrollPx = 0;
	private activePointerId: number | null = null;
	private timing: SliderTimingConfig = { ...DEFAULT_TIMING_CONFIG };

	private config: SliderConfig = { ...DEFAULT_SLIDER_CONFIG };

	private uniforms = {
		progress: uniform(float(0)),
		velocity: uniform(float(0)),
		globalOpacity: uniform(float(1)),
		colorIntensity: uniform(float(1)),
		cornerRadius: uniform(float(0.05)),
		mousePos: uniform(vec2(0, 0)),
		harmonicaCenter: uniform(float(0)),
		curveStrength: uniform(float(this.config.curveStrength)),
		curveFrequency: uniform(float(this.config.curveFrequency)),
		curveYInfluence: uniform(float(this.config.curveYInfluence)),
		curveMaxCurve: uniform(float(this.config.curveMaxCurve)),
		totalSliderWidth: uniform(float(0)),
		harmonicaBands: uniform(float(this.config.harmonicaBands)),
		harmonicaSpeed: uniform(float(this.config.harmonicaSpeed)),
		harmonicaAmplitude: uniform(float(this.config.harmonicaAmplitude)),
		harmonicaFrequency: uniform(float(this.config.harmonicaFrequency)),
		harmonicaRadius: uniform(float(this.config.harmonicaRadius)),
		harmonicaSmoothness: uniform(float(this.config.harmonicaSmoothness)),
		mobileClickHint: uniform(float(0)),
		mobileCurveScale: uniform(float(1)),
		fluidSimSize: uniform(vec2(1, 1)),
		fluidStrength: uniform(float(0.85)),
		fluidVelocityNode: null as VelocityNode | null
	};

	private previousProgress = 0;
	private targetProgressValue = 0;
	private currentVisualIndex = 0;
	private exitProgress = 0;
	private targetVelocity = 0;
	private smoothedVelocity = 0;
	private readonly snapSettlingSpeed = 2.5;
	private readonly slideStepMultiplier = 1.08;
	private readonly inactiveSlideScale = 0.9;
	private readonly activeSlideScale = 1.025;
	private readonly activeSlideYOffset = -0.2;
	private readonly activeSlideZOffset = 0.42;
	private readonly focusUniformLerp = 0.14;
	private readonly maxScrollVelocity = 1.3;
	private readonly velocityResponseGain = 3.6;
	private readonly velocityAttackRate = 11;
	private readonly velocityReleaseRate = 5.5;
	private exitPreview = {
		enabled: false,
		progress: 0
	};
	private debugValues: SliderDebugValues = {
		progress: 0,
		exitProgress: 0,
		velocity: 0,
		smoothedVelocity: 0,
		activeSlide: -1
	};

	// Cache last dispatched cursor values to skip redundant DOM events
	private _lastCursorText: string | null = undefined as unknown as null;
	private _lastCursorHref: string | null = undefined as unknown as null;
	private _readyPromise: Promise<void>;

	// Touch-only "tap tooltip": anchored to a fixed point on a slide. By default
	// it tracks the focused slide; when a tap lands on a specific slide, it
	// re-anchors to that slide until the focus moves elsewhere.
	private tapTooltipAnchor: { localX: number; localY: number } | null = null;
	private isTouchInteraction = false;
	private focusedSlideIndex = 0;
	private readonly focusSwitchThreshold = 0.7;
	private tapTargetSlideIndex: number | null = null;
	private tapTargetFocusedIndex = 0;
	private tapTooltipScratch = new THREE.Vector3();
	private tapTooltipLast: {
		visible: boolean;
		x: number;
		y: number;
		text: string | null;
		href: string | null;
	} = { visible: false, x: 0, y: 0, text: null, href: null };

	// Dedup guard for the mobile pinned "focused slide" badge (SlideFocusBadge).
	private focusBadgeLast: { visible: boolean; index: number } = { visible: false, index: -1 };

	// The per-slide title used to be baked onto the slide texture (tablet) and
	// surfaced as a tap tooltip (phone). Both are now consolidated into the pinned
	// SlideFocusBadge on mobile, so the baked-in pill is disabled. Flip to re-enable.
	private readonly bakedSlideTitleEnabled = false;

	constructor({
		renderer,
		aspect = 16 / 10,
		planeWidth = 15,
		planeHeight,
		spacing = 0.1,
		mobileClickHint = false,
		performanceTier = 'high',
		fluidVelocityNode = null,
		fluidSimSize = null
	}: Props) {
		this.renderer = renderer;
		this.applyPerformanceTier(performanceTier);
		this.syncUniformsFromConfig();
		const viewportWidth = typeof window !== 'undefined' ? window.innerWidth || 0 : 0;
		this.props = resolveSliderProps({
			aspect,
			planeWidth,
			planeHeight,
			spacing,
			mobileClickHint,
			viewportWidth
		});
		this.group = new THREE.Group();
		this.group.name = 'Slides';
		this.raycaster = new THREE.Raycaster();
		this.raycaster.layers.set(SCENE_LAYERS.TRAIN_SLIDER);
		this.mouse = new THREE.Vector2();
		this.interactionDomElement = this.renderer.domElement;
		this.syncViewportUniforms(viewportWidth);
		this.uniforms.fluidVelocityNode = fluidVelocityNode ?? null;
		if (fluidSimSize) {
			this.uniforms.fluidSimSize.value.set(fluidSimSize.x, fluidSimSize.y);
		}

		this.slideData = [...SLIDES];

		this._readyPromise = this.createSlides();
		this.previousProgress = this.uniforms.progress.value;
	}

	private syncViewportUniforms(viewportWidth: number): void {
		const totalWidth = (this.props.planeWidth + this.props.spacing) * this.props.slideCount;
		this.uniforms.totalSliderWidth.value = totalWidth;
		this.uniforms.mobileClickHint.value = this.props.mobileClickHint ? 1 : 0;
		this.uniforms.mobileCurveScale.value = getMobileCurveScale(viewportWidth);
	}

	setCamera(camera: THREE.Camera) {
		this.camera = camera;
	}

	setInteractionDomElement(domElement: HTMLElement) {
		this.interactionDomElement = domElement;
	}

	setHarmonicaCenter(worldX: number) {
		this.config.harmonicaCenterX = worldX;
		this.uniforms.harmonicaCenter.value = worldX;
	}

	animateHarmonicaCenter(targetX: number, duration = 1000) {
		const startX = this.config.harmonicaCenterX;
		const startTime = Date.now();

		const animate = () => {
			const elapsed = Date.now() - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
			this.setHarmonicaCenter(startX + (targetX - startX) * eased);
			if (progress < 1) requestAnimationFrame(animate);
		};
		animate();
	}

	private async loadTexture(src: string): Promise<THREE.Texture> {
		return new Promise((resolve) => {
			let settled = false;
			const finish = (texture: THREE.Texture) => {
				if (settled) return;
				settled = true;
				resolve(texture);
			};
			const timeoutId =
				typeof window !== 'undefined'
					? window.setTimeout(() => finish(this.createFallbackTexture()), 4000)
					: null;

			TextureCache.load(src)
				.then((texture) => {
					this.configureSlideTexture(texture);
					if (timeoutId !== null) window.clearTimeout(timeoutId);
					finish(texture);
				})
				.catch(() => {
					if (timeoutId !== null) window.clearTimeout(timeoutId);
					finish(this.createFallbackTexture());
				});
		});
	}

	private createFallbackTexture(): THREE.Texture {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 512;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			const texture = new THREE.Texture(canvas);
			texture.needsUpdate = true;
			return texture;
		}
		const gradient = ctx.createLinearGradient(0, 0, 512, 512);
		gradient.addColorStop(0, '#4a5568');
		gradient.addColorStop(1, '#2d3748');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, 512, 512);
		const texture = new THREE.Texture(canvas);
		this.configureSlideTexture(texture);
		return texture;
	}

	/**
	 * High-quality sampling for slides on the curved plane: sRGB, trilinear mips,
	 * max anisotropy. KTX2 ships its own mip chain (compressed mips can't be
	 * regenerated), so only uncompressed sources opt into generateMipmaps.
	 */
	private configureSlideTexture(texture: THREE.Texture): void {
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.magFilter = THREE.LinearFilter;
		texture.anisotropy = this.renderer.getMaxAnisotropy();

		const hasMipChain = (texture.mipmaps?.length ?? 0) > 1;
		const isCompressed = (texture as THREE.CompressedTexture).isCompressedTexture === true;
		// Uncompressed sources can build a chain at runtime; compressed must ship one.
		const useMips = hasMipChain || !isCompressed;
		texture.minFilter = useMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
		texture.generateMipmaps = useMips && !hasMipChain;
		texture.needsUpdate = true;
	}

	private async createSlides() {
		const geometry = this.createSharedSlideGeometry();

		const textures = await Promise.all(
			this.slideData.map((slide) => this.loadTexture(slide.imageSrc))
		);

		for (let i = 0; i < this.props.slideCount; i++) {
			const mesh = this.createSlideMesh(i, textures[i], geometry);
			this.slides.push(mesh);
			this.group.add(mesh);
		}

		this.updateSlideTransforms(true);
	}

	private createSharedSlideGeometry(): THREE.PlaneGeometry {
		return new THREE.PlaneGeometry(
			this.props.planeWidth,
			this.props.planeHeight,
			this.geometrySegments.width,
			this.geometrySegments.height
		);
	}

	private createSlideMesh(
		slideIndex: number,
		mainTexture: THREE.Texture,
		geometry: THREE.PlaneGeometry
	): SlideMesh {
		const slideData = this.slideData[slideIndex];
		const titleTexture =
			this.bakedSlideTitleEnabled && this.props.mobileClickHint
				? this.createTitleOverlayTexture(slideData.title)
				: null;
		const focusUniform = uniform(float(slideIndex === 0 ? 1 : 0)) as FocusUniform;
		const material = this.createSlideMaterial(mainTexture, slideIndex, titleTexture, focusUniform);
		this.prepareSlideMaterial(material);

		const mesh = new THREE.Mesh(geometry, material) as SlideMesh;
		mesh.name = `Slide ${slideIndex}`;
		mesh.userData = {
			slideIndex,
			originalIndex: slideIndex,
			mainTexture,
			titleTexture,
			focusUniform
		};
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.renderOrder = 1000;
		// Slides live in a dedicated overlay scene (see MainScene.slidesScene)
		// rendered by a TSL pass composited over the DaoFog overlay in
		// PostProcessingGraph. TRAIN_SLIDER gates both that pass's layer mask
		// and raycasting; slides are intentionally off SCENE_2 so the main
		// channel-2 scene/post-FX/fog stack doesn't draw them.
		mesh.layers.disableAll();
		mesh.layers.enable(SCENE_LAYERS.TRAIN_SLIDER);
		mesh.position.x = slideIndex * (this.props.planeWidth + this.props.spacing);
		mesh.position.y = -0.3;
		return mesh;
	}

	private prepareSlideMaterial(material: THREE.Material): void {
		material.depthTest = false;
		material.depthWrite = false;
	}

	public whenReady(): Promise<void> {
		return this._readyPromise;
	}

	private syncUniformsFromConfig(): void {
		this.uniforms.curveStrength.value = this.config.curveStrength;
		this.uniforms.curveFrequency.value = this.config.curveFrequency;
		this.uniforms.curveYInfluence.value = this.config.curveYInfluence;
		this.uniforms.curveMaxCurve.value = this.config.curveMaxCurve;
		this.uniforms.harmonicaBands.value = this.config.harmonicaBands;
		this.uniforms.harmonicaSpeed.value = this.config.harmonicaSpeed;
		this.uniforms.harmonicaAmplitude.value = this.config.harmonicaAmplitude;
		this.uniforms.harmonicaFrequency.value = this.config.harmonicaFrequency;
		this.uniforms.harmonicaRadius.value = this.config.harmonicaRadius;
		this.uniforms.harmonicaSmoothness.value = this.config.harmonicaSmoothness;
	}

	private applyPerformanceTier(tier: GraphicsTier): void {
		const preset = PERFORMANCE_PRESETS[tier];
		const { exit, ...config } = preset.config;
		this.geometrySegments = { ...preset.geometrySegments };
		this.config = {
			...this.config,
			...config,
			exit: {
				...this.config.exit,
				...(exit ?? {})
			}
		};
	}

	private createTitleOverlayTexture(title: string): THREE.Texture {
		const canvas = document.createElement('canvas');
		this.drawTitleOverlayCanvas(canvas, title);
		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.generateMipmaps = false;
		return texture;
	}

	private drawTitleOverlayCanvas(canvas: HTMLCanvasElement, title: string): void {
		const viewportWidth = Math.max(window.innerWidth || 375, 320);
		const responsiveScale = Math.min(Math.max(viewportWidth / 390, 0.72), 1.25);
		const dpr = getCappedDevicePixelRatio();
		const baseWidth = 1024;
		const baseHeight = Math.max(512, Math.round(baseWidth / this.props.aspect));
		const fontSize = Math.round(24 * responsiveScale);
		const paddingX = Math.round(42 * responsiveScale);
		const paddingY = Math.round(24 * responsiveScale);
		const radius = Math.round(16 * responsiveScale);
		const font = `600 ${fontSize}px Inter, system-ui, -apple-system, Segoe UI, sans-serif`;

		canvas.width = Math.round(baseWidth * dpr);
		canvas.height = Math.round(baseHeight * dpr);
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.font = font;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.clearRect(0, 0, baseWidth, baseHeight);

		const textWidth = Math.ceil(ctx.measureText(title).width);
		const rectW = Math.min(textWidth + paddingX * 2, baseWidth * 0.88);
		const rectH = fontSize + paddingY * 2;
		const rectX = (baseWidth - rectW) * 0.5;
		const rectY = baseHeight * 0.95 - rectH;

		this.drawRoundedRect(ctx, rectX, rectY, rectW, rectH, radius);
		ctx.fillStyle = '#e64749';
		ctx.fill();

		ctx.fillStyle = '#ffffff';
		ctx.fillText(title, baseWidth * 0.5, rectY + rectH * 0.53);
	}

	public handleResize(): void {
		const shouldShowHint = window.innerWidth < 1024;
		this.uniforms.mobileClickHint.value = shouldShowHint ? 1 : 0;
		this.uniforms.mobileCurveScale.value = getMobileCurveScale(window.innerWidth);

		if (!this.bakedSlideTitleEnabled) return;

		for (const slide of this.slides) {
			const title = this.slideData[slide.userData.slideIndex]?.title ?? '';
			if (shouldShowHint && !slide.userData.titleTexture) {
				this.attachTitleTextureToSlide(slide, title);
				continue;
			}

			if (shouldShowHint && slide.userData.titleTexture) {
				this.refreshTitleTexture(slide.userData.titleTexture, title);
			}
		}
	}

	private attachTitleTextureToSlide(slide: SlideMesh, title: string): void {
		const titleTexture = this.createTitleOverlayTexture(title);
		slide.userData.titleTexture = titleTexture;
		const replacement = this.createSlideMaterial(
			slide.userData.mainTexture,
			slide.userData.slideIndex,
			titleTexture,
			slide.userData.focusUniform
		);
		this.prepareSlideMaterial(replacement);
		this.disposeSlideMaterial(slide);
		slide.material = replacement;
	}

	private refreshTitleTexture(titleTexture: THREE.Texture, title: string): void {
		const canvas = titleTexture.image as HTMLCanvasElement | undefined;
		if (!canvas) return;
		this.drawTitleOverlayCanvas(canvas, title);
		titleTexture.needsUpdate = true;
	}

	private drawRoundedRect(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		width: number,
		height: number,
		radius: number
	) {
		const r = Math.min(radius, width / 2, height / 2);
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + width, y, x + width, y + height, r);
		ctx.arcTo(x + width, y + height, x, y + height, r);
		ctx.arcTo(x, y + height, x, y, r);
		ctx.arcTo(x, y, x + width, y, r);
		ctx.closePath();
	}

	private updateSlideTransforms(force = false): void {
		applySlideTransforms({
			slides: this.slides as SlideMeshLike[],
			props: this.props,
			currentVisualIndex: this.currentVisualIndex,
			slideStepMultiplier: this.slideStepMultiplier,
			inactiveSlideScale: this.inactiveSlideScale,
			activeSlideScale: this.activeSlideScale,
			activeSlideYOffset: this.activeSlideYOffset,
			activeSlideZOffset: this.activeSlideZOffset,
			focusUniformLerp: this.focusUniformLerp,
			exitProgress: this.exitProgress,
			exit: this.config.exit,
			force
		});
	}

	private createSlideMaterial(
		mainTexture: THREE.Texture,
		slideIndex: number,
		titleTexture: THREE.Texture | null,
		focusUniform: FocusUniform
	): THREE.Material {
		return createSlideMaterial({
			mainTexture,
			slideIndex,
			titleTexture,
			focusUniform,
			props: this.props,
			uniforms: this.uniforms,
			isMobileViewport: typeof window !== 'undefined' ? (window.innerWidth || 0) < 768 : false
		});
	}

	enableFluidInteraction() {
		const handleMouseMove = (event: MouseEvent) => {
			if (this.isOverlayInteractionTarget(event.target)) {
				if (!this.dragActive) {
					this.dispatchCursorMode(null);
					this.clearHoverOverOverlay();
				}
				return;
			}
			if (this.interactionEnabled && !this.dragActive) {
				this.dispatchCursorMode('grab');
			}
			if (this.dragActive) return;
			this.isMouseOver = true;
			this.lastMouseMoveTime = performance.now();
			if (!this.camera) return;

			const rect = this.interactionDomElement.getBoundingClientRect();
			this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
			this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

			this.uniforms.mousePos.value.set((this.mouse.x + 1) / 2, (this.mouse.y + 1) / 2);
			this.setHarmonicaCenter(this.mouse.x * (this.props.planeWidth / 2));
		};

		const handleMouseLeave = () => {
			this.isMouseOver = false;
			this.lastMouseMoveTime = 0;
			this.uniforms.mousePos.value.set(0.5, 0.5);
			this.animateHarmonicaCenter(0, 500);
			this.currentInteractionSlide = -1;
			if (typeof window !== 'undefined') this._dispatchCursor(null, null);
			if (!this.dragActive) this.dispatchCursorMode(null);
		};

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseleave', handleMouseLeave);
		this.listenerCleanup.push(() => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseleave', handleMouseLeave);
		});
	}

	public setScrollDriver(driver: ScrollDriver | null): void {
		this.scrollDriver = driver;
		if (!driver) {
			this.resetDragLifecycleState();
		}
	}

	public setSnapOnRelease(snap: boolean): void {
		this.timing.snapOnRelease = snap;
	}

	enablePointerInteraction() {
		const onPointerDown = (event: PointerEvent) => {
			if (event.button !== undefined && event.button !== 0) return;
			if (this.activePointerId !== null) return;
			if (!this.scrollDriver?.isDriverActive()) return;
			const target = event.target as Element | null;
			if (target?.closest('a, button, input, textarea, select, [role="button"], [tabindex]')) {
				return;
			}
			if (this.isOverlayInteractionTarget(target)) {
				return;
			}
			this.activePointerId = event.pointerId;
			this.pointerIsDown = true;
			this.pointerDownTime = performance.now();
			this.pointerDownClientX = event.clientX;
			this.pointerDownClientY = event.clientY;
			this.dragStartScrollPx = this.scrollDriver?.getScroll() ?? 0;
			this.dragSamples = [{ t: this.pointerDownTime, scrollPx: this.dragStartScrollPx }];
			this.dragActive = false;
			this.dragAxisLocked = null;
			this.updatePointerPosition(event.clientX, event.clientY);

			if (event.pointerType === 'touch') {
				this.isTouchInteraction = true;
				this.setDefaultTapTooltipAnchor();
				const touchedIndex = this.pickSlideIndexAt(event.clientX, event.clientY);
				if (touchedIndex !== null) {
					this.tapTargetSlideIndex = touchedIndex;
					this.tapTargetFocusedIndex = this.getFocusedSlideIndex();
				}
			}
		};

		const onPointerMove = (event: PointerEvent) => {
			if (!this.pointerIsDown && this.isOverlayInteractionTarget(event.target)) {
				this.clearHoverOverOverlay();
				return;
			}
			this.updatePointerPosition(event.clientX, event.clientY);

			if (!this.pointerIsDown || event.pointerId !== this.activePointerId) return;
			const driver = this.scrollDriver;
			if (!driver || !driver.isDriverActive()) {
				if (this.dragActive) {
					this.releaseDragInertia(0);
					this.resetDragLifecycleState();
				}
				return;
			}

			const dx = event.clientX - this.pointerDownClientX;
			const dy = event.clientY - this.pointerDownClientY;

			if (this.dragAxisLocked === null) {
				if (Math.hypot(dx, dy) >= DRAG_AXIS_LOCK_PX) {
					this.dragAxisLocked = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
					if (this.dragAxisLocked === 'horizontal') {
						this.dragActive = true;
						driver.cancelAnimatedScroll();
						this.dragStartScrollPx = driver.getScroll();
						this.pointerDownClientX = event.clientX;
						this.pointerDownClientY = event.clientY;
						this.dragSamples = [{ t: performance.now(), scrollPx: this.dragStartScrollPx }];
						this._dispatchCursor(null, null);
						this.dispatchCursorMode('grabbing');
					}
				}
			}

			if (this.dragAxisLocked !== 'horizontal') return;
			if (event.cancelable) event.preventDefault();
			this.applyDragMove(dx);
		};

		const onPointerUp = (event: PointerEvent) => {
			this.updatePointerPosition(event.clientX, event.clientY);
			if (!this.pointerIsDown || event.pointerId !== this.activePointerId) return;

			const wasDragActive = this.dragActive;
			const elapsedMs = performance.now() - this.pointerDownTime;
			const dx = event.clientX - this.pointerDownClientX;
			const dy = event.clientY - this.pointerDownClientY;
			const movedDistance = Math.hypot(dx, dy);

			if (wasDragActive) {
				this.releaseDragInertia();
				this.resetDragLifecycleState();
				this.dispatchCursorMode(this.interactionEnabled && this.isMouseOver ? 'grab' : null);
				return;
			}

			this.resetDragLifecycleState();
			const isTap =
				elapsedMs <= this.tapDurationThresholdMs && movedDistance <= this.tapMoveThresholdPx;
			if (!isTap) return;
			this._dispatchCursor(null, null);
			const tappedIndex = this.pickSlideIndexAt(event.clientX, event.clientY);
			if (tappedIndex === null) return;
			const href = this.slideData[tappedIndex]?.href;
			if (href) window.open(href, '_blank', 'noopener,noreferrer');
		};

		const onPointerCancel = (event: PointerEvent) => {
			if (event.pointerId !== this.activePointerId) return;
			const wasDragActive = this.dragActive;
			if (wasDragActive) this.releaseDragInertia(0);
			this.resetDragLifecycleState();
			this.dispatchCursorMode(this.interactionEnabled && this.isMouseOver ? 'grab' : null);
		};

		// External overlays (e.g., the menu) can request the tap tooltip be hidden
		// while it's anchored to a slide. Without this listener, updateTapTooltip
		// would re-dispatch visible:true on the very next frame and re-show it.
		const onExternalHide = (event: Event) => {
			const detail = (event as CustomEvent<{ visible?: boolean }>).detail;
			if (!detail || detail.visible !== false) return;
			if (this.tapTooltipAnchor === null) return;
			this.resetTapTooltip();
		};

		// A freshly mounted SlideFocusBadge asks for the current focus state; reset
		// the dedup guard so the next frame re-broadcasts it.
		const onFocusRequest = () => {
			this.focusBadgeLast = { visible: false, index: -1 };
		};

		window.addEventListener('pointerdown', onPointerDown, { passive: true });
		window.addEventListener('pointermove', onPointerMove, { passive: false });
		window.addEventListener('pointerup', onPointerUp, { passive: true });
		window.addEventListener('pointercancel', onPointerCancel, { passive: true });
		window.addEventListener('slide:tap-tooltip', onExternalHide);
		window.addEventListener('slide:focus-request', onFocusRequest);

		this.listenerCleanup.push(() => {
			window.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			window.removeEventListener('pointercancel', onPointerCancel);
			window.removeEventListener('slide:tap-tooltip', onExternalHide);
			window.removeEventListener('slide:focus-request', onFocusRequest);
		});
	}

	private applyDragMove(dx: number): void {
		const driver = this.scrollDriver;
		if (!driver) return;
		const ventures = driver.getVenturesPixelRange();
		const slideCount = this.props.slideCount;
		const viewportWidth = typeof window !== 'undefined' ? window.innerWidth || 1 : 1;
		const isMobile = viewportWidth < MOBILE_VIEWPORT_PX;
		const visibleCards = isMobile ? VISIBLE_CARDS_MOBILE : VISIBLE_CARDS_DESKTOP;
		const perSlideDragPx = Math.max(140, viewportWidth / visibleCards);
		const sectionPx = Math.max(0, ventures.endPx - ventures.startPx);
		const scrollPxPerSlide = sectionPx / Math.max(1, slideCount - 1);
		const sensitivity = scrollPxPerSlide / Math.max(perSlideDragPx, 1);

		const rawTarget = this.dragStartScrollPx - sensitivity * dx;
		const rubber = Math.max(scrollPxPerSlide * EDGE_RUBBER_BAND_FRAC, 1);
		let target = rawTarget;
		if (target < ventures.startPx) {
			const overshoot = ventures.startPx - target;
			target = ventures.startPx - rubber * (1 - Math.exp(-overshoot / rubber));
		} else if (target > ventures.endPx) {
			const overshoot = target - ventures.endPx;
			target = ventures.endPx + rubber * (1 - Math.exp(-overshoot / rubber));
		}

		driver.setScrollImmediate(target);

		const now = performance.now();
		this.dragSamples.push({ t: now, scrollPx: target });
		const cutoff = now - DRAG_VELOCITY_WINDOW_MS;
		while (this.dragSamples.length > 1 && this.dragSamples[0].t < cutoff) {
			this.dragSamples.shift();
		}
	}

	private releaseDragInertia(velocityOverride?: number): void {
		const driver = this.scrollDriver;
		if (!driver) return;
		const ventures = driver.getVenturesPixelRange();
		const slideCount = this.props.slideCount;
		const sectionPx = Math.max(0, ventures.endPx - ventures.startPx);
		const scrollPxPerSlide = sectionPx / Math.max(1, slideCount - 1);

		const releaseTime = performance.now();
		const cutoff = releaseTime - DRAG_VELOCITY_WINDOW_MS;
		while (this.dragSamples.length > 1 && this.dragSamples[0].t < cutoff) {
			this.dragSamples.shift();
		}

		let velocityPxPerSec = velocityOverride ?? 0;
		if (velocityOverride === undefined && this.dragSamples.length >= 2) {
			const first = this.dragSamples[0];
			const last = this.dragSamples[this.dragSamples.length - 1];
			const dt = (last.t - first.t) / 1000;
			if (dt > 0.001) {
				velocityPxPerSec = (last.scrollPx - first.scrollPx) / dt;
			}
		}

		const reduceMotion =
			typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const tau = reduceMotion ? 0 : Math.max(0, this.timing.inertiaProjectionSec);

		const currentScrollPx = driver.getScroll();
		const projectedPx = currentScrollPx + velocityPxPerSec * tau;

		let target: number;
		if (this.timing.snapOnRelease && scrollPxPerSlide > 0) {
			const startSlide = Math.round((this.dragStartScrollPx - ventures.startPx) / scrollPxPerSlide);
			const intentSlides = (projectedPx - this.dragStartScrollPx) / scrollPxPerSlide;
			const dragCommitFraction = THREE.MathUtils.clamp(this.timing.dragCommitFraction, 0, 1);
			let targetSlide: number;
			if (Math.abs(intentSlides) < dragCommitFraction) {
				targetSlide = startSlide;
			} else {
				const direction = intentSlides > 0 ? 1 : -1;
				const stride = Math.max(1, Math.round(Math.abs(intentSlides)));
				targetSlide = startSlide + direction * stride;
			}
			const clampedSlide = Math.max(0, Math.min(slideCount - 1, targetSlide));
			target = ventures.startPx + clampedSlide * scrollPxPerSlide;
		} else {
			target = projectedPx;
		}

		target = Math.max(ventures.startPx, Math.min(ventures.endPx, target));
		const distance = Math.abs(target - currentScrollPx);
		const speed = Math.max(Math.abs(velocityPxPerSec), 1);
		const minDuration = Math.max(0, this.timing.inertiaMinDurationSec);
		const maxDuration = Math.max(minDuration, this.timing.inertiaMaxDurationSec);
		const durationScale = Math.max(0, this.timing.inertiaDurationScale);
		let duration = THREE.MathUtils.clamp((distance / speed) * durationScale, minDuration, maxDuration);
		if (reduceMotion) duration = minDuration;

		driver.setScrollAnimated(target, duration);
	}

	private resetDragLifecycleState(): void {
		this.pointerIsDown = false;
		this.dragActive = false;
		this.dragAxisLocked = null;
		this.activePointerId = null;
		this.dragSamples = [];
	}

	private isOverlayInteractionTarget(target: EventTarget | null): boolean {
		if (typeof Element === 'undefined') return false;
		const element =
			target instanceof Element
				? target
				: typeof Node !== 'undefined' && target instanceof Node
					? target.parentElement
					: null;
		if (!element) return false;

		return Boolean(
			element.closest(
				[
					'#theatrejs-studio-root',
					'[data-lenis-prevent]',
					'[data-slider-interaction-ignore]',
					'.lil-gui',
					'.dg'
				].join(',')
			)
		);
	}

	// Overlay UI (Theatre.js studio, lil-gui) sits on top of the canvas. While
	// the pointer is over it, mousemove/pointermove bail out early, so the
	// stored mouse position freezes and the periodic hover re-check would keep
	// raycasting the stale position — leaving the slide's cursor href "live"
	// and turning clicks on overlay widgets into window.open calls.
	private clearHoverOverOverlay(): void {
		if (!this.isMouseOver && this.currentInteractionSlide === -1) return;
		this.isMouseOver = false;
		this.currentInteractionSlide = -1;
		this._dispatchCursor(null, null);
	}

	private updatePointerPosition(clientX: number, clientY: number): void {
		if (!this.camera) return;
		const rect = this.interactionDomElement.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;

		this.isMouseOver =
			clientX >= rect.left &&
			clientX <= rect.right &&
			clientY >= rect.top &&
			clientY <= rect.bottom;

		this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
		this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
		this.uniforms.mousePos.value.set((this.mouse.x + 1) / 2, (this.mouse.y + 1) / 2);
		this.lastMouseMoveTime = performance.now();
	}

	private pickSlideIndexAt(clientX: number, clientY: number): number | null {
		if (!this.interactionEnabled || !this.camera || !this.group.visible) return null;

		this.updatePointerPosition(clientX, clientY);
		this.raycaster.setFromCamera(this.mouse, this.camera);
		const intersects = this.raycaster.intersectObjects(this.slides);
		if (intersects.length === 0) return null;

		const slideIndex = (intersects[0].object as SlideMesh).userData.slideIndex;
		return typeof slideIndex === 'number' ? slideIndex : null;
	}

	private _dispatchCursor(text: string | null, href: string | null) {
		if (text === this._lastCursorText && href === this._lastCursorHref) return;
		this._lastCursorText = text;
		this._lastCursorHref = href;
		window.dispatchEvent(
			new CustomEvent<{ text: string | null }>('cursor:set-text', { detail: { text } })
		);
		window.dispatchEvent(
			new CustomEvent<{ href: string | null }>('cursor:set-link', { detail: { href } })
		);
	}

	private resetCursorState(): void {
		if (typeof window !== 'undefined') {
			this._dispatchCursor(null, null);
		}
	}

	private _lastCursorMode: 'grab' | 'grabbing' | null = null;
	private dispatchCursorMode(mode: 'grab' | 'grabbing' | null): void {
		if (typeof window === 'undefined') return;
		if (mode === this._lastCursorMode) return;
		this._lastCursorMode = mode;
		window.dispatchEvent(new CustomEvent('cursor:set-mode', { detail: { mode } }));
	}

	private updateHoverAtMouse() {
		if (!this.interactionEnabled) {
			this.resetCursorState();
			return;
		}
		if (this.dragActive) return;
		if (!this.camera) return;

		this.raycaster.setFromCamera(this.mouse, this.camera);
		const intersects = this.raycaster.intersectObjects(this.slides);

		if (intersects.length > 0 && this.group.visible) {
			const intersect = intersects[0];
			const slide = intersect.object as SlideMesh;
			this.setInteractionSlide(slide);
			this.dispatchSlideCursor(slide.userData.slideIndex);
		} else {
			this.resetCursorState();
		}
	}

	private setInteractionSlide(slide: SlideMesh): void {
		const slideIndex = slide.userData.slideIndex;
		if (this.currentInteractionSlide === slideIndex) return;
		this.currentInteractionSlide = slideIndex;
	}

	private dispatchSlideCursor(slideIndex: number): void {
		if (typeof window === 'undefined') return;
		const data = this.slideData[slideIndex];
		this._dispatchCursor(data?.title ?? null, data?.href ?? null);
	}

	update(delta: number) {
		const dt = Math.min(Math.max(delta, 1 / 240), 0.1);
		const now = performance.now();
		const recentlyInteracted =
			this.isMouseOver && this.lastMouseMoveTime > 0 && now - this.lastMouseMoveTime < 160;
		this.updateVisualProgress(dt);
		this.updateVelocityState(dt);
		this.updateDebugValues();
		this.updateHoverState(now, recentlyInteracted);
		this.updateTapTooltip();
		this.updateFocusBadge();
	}

	private setDefaultTapTooltipAnchor(): void {
		// Anchor at the bottom edge of the focused slide. The tooltip dispatches
		// with placement: 'below' so the bubble renders just under the slide
		// (not over the artwork) regardless of where the user tapped.
		this.tapTooltipAnchor = { localX: 0, localY: -this.props.planeHeight * 0.5 };
	}

	private getFocusedSlideIndex(): number {
		const maxIndex = Math.max(0, this.props.slideCount - 1);
		const idx = THREE.MathUtils.clamp(this.currentVisualIndex, 0, maxIndex);
		// Hysteresis: keep the current label until the visual index has clearly
		// entered a neighbor's territory, so the tooltip doesn't flip at the
		// exact midpoint while the previous slide still looks focused.
		if (Math.abs(idx - this.focusedSlideIndex) >= this.focusSwitchThreshold) {
			this.focusedSlideIndex = THREE.MathUtils.clamp(Math.round(idx), 0, maxIndex);
		}
		return this.focusedSlideIndex;
	}

	private updateTapTooltip(): void {
		if (typeof window === 'undefined') return;
		// On mobile (≤1024) the pinned SlideFocusBadge replaces the per-slide tap
		// tooltip, so the anchored bubble is never surfaced there.
		if ((window.innerWidth || 0) <= 1024) {
			this.dispatchTapTooltip(false, 0, 0, null, null);
			return;
		}
		if (
			!this.isTouchInteraction ||
			!this.interactionEnabled ||
			!this.group.visible ||
			!this.tapTooltipAnchor ||
			!this.camera
		) {
			this.dispatchTapTooltip(false, 0, 0, null, null);
			return;
		}

		const focusedIndex = this.getFocusedSlideIndex();
		if (this.tapTargetSlideIndex !== null && focusedIndex !== this.tapTargetFocusedIndex) {
			// Focus moved since the tap — fall back to tracking the focused slide.
			this.tapTargetSlideIndex = null;
		}
		const tooltipIndex = this.tapTargetSlideIndex ?? focusedIndex;
		const slide = this.slides[tooltipIndex];
		if (!slide) {
			this.dispatchTapTooltip(false, 0, 0, null, null);
			return;
		}

		const world = this.tapTooltipScratch.set(
			this.tapTooltipAnchor.localX,
			this.tapTooltipAnchor.localY,
			0
		);
		slide.localToWorld(world);
		world.project(this.camera);
		const screenX = (world.x * 0.5 + 0.5) * window.innerWidth;
		const screenY = (-world.y * 0.5 + 0.5) * window.innerHeight;

		const data = this.slideData[tooltipIndex];
		this.dispatchTapTooltip(true, screenX, screenY, data?.title ?? null, data?.href ?? null);
	}

	private dispatchTapTooltip(
		visible: boolean,
		x: number,
		y: number,
		text: string | null,
		href: string | null
	): void {
		const last = this.tapTooltipLast;
		if (
			last.visible === visible &&
			last.text === text &&
			last.href === href &&
			Math.abs(last.x - x) < 0.5 &&
			Math.abs(last.y - y) < 0.5
		) {
			return;
		}
		this.tapTooltipLast = { visible, x, y, text, href };
		window.dispatchEvent(
			new CustomEvent('slide:tap-tooltip', {
				detail: { visible, x, y, text, href, placement: 'below' }
			})
		);
	}

	private resetTapTooltip(): void {
		this.tapTooltipAnchor = null;
		this.isTouchInteraction = false;
		this.tapTargetSlideIndex = null;
		this.dispatchTapTooltip(false, 0, 0, null, null);
	}

	public hideTapTooltip(): void {
		this.resetTapTooltip();
	}

	private updateFocusBadge(): void {
		if (typeof window === 'undefined') return;
		// Mobile-only (≤1024): mirror whichever slide is currently centered into the
		// pinned SlideFocusBadge. Fires on every focus change during scroll (the same
		// 0.7-hysteresis boundary the tooltip used), deduped so the badge only swaps
		// when the centered slide actually changes.
		const isMobileViewport = (window.innerWidth || 0) <= 1024;
		const visible = isMobileViewport && this.group.visible;
		const index = visible ? this.getFocusedSlideIndex() : this.focusBadgeLast.index;
		if (this.focusBadgeLast.visible === visible && this.focusBadgeLast.index === index) return;
		this.focusBadgeLast = { visible, index };
		const data = this.slideData[index];
		window.dispatchEvent(
			new CustomEvent('slide:focus-change', {
				detail: { visible, index, text: data?.title ?? null }
			})
		);
	}

	private updateVisualProgress(dt: number): void {
		const maxIndex = Math.max(0, this.props.slideCount - 1);
		const visualTargetIndex = this.targetProgressValue * maxIndex;
		if (this.dragActive) {
			this.currentVisualIndex = visualTargetIndex;
		} else {
			const snapAlpha = 1 - Math.exp(-dt * this.snapSettlingSpeed);
			this.currentVisualIndex += (visualTargetIndex - this.currentVisualIndex) * snapAlpha;
		}
		this.currentVisualIndex = THREE.MathUtils.clamp(this.currentVisualIndex, 0, maxIndex);
		this.uniforms.progress.value = maxIndex === 0 ? 0 : this.currentVisualIndex / maxIndex;
		this.exitProgress = this.exitPreview.enabled
			? THREE.MathUtils.clamp(this.exitPreview.progress, 0, 1)
			: THREE.MathUtils.smootherstep(this.targetProgressValue, this.config.exit.progressStart, 1);
		this.updateSlideTransforms();
	}

	private updateVelocityState(dt: number): void {
		const progressNow = this.uniforms.progress.value;
		const progressVelocity = dt > 0 ? (progressNow - this.previousProgress) / dt : 0;
		this.previousProgress = progressNow;
		const boostedVelocity = progressVelocity * this.velocityResponseGain;
		const clampedVelocity = Math.max(
			-this.maxScrollVelocity,
			Math.min(this.maxScrollVelocity, boostedVelocity)
		);
		const velocityRate =
			Math.abs(clampedVelocity) > Math.abs(this.targetVelocity)
				? this.velocityAttackRate
				: this.velocityReleaseRate;
		const velocityAlpha = 1 - Math.exp(-dt * velocityRate);
		this.targetVelocity += (clampedVelocity - this.targetVelocity) * velocityAlpha;
		this.uniforms.velocity.value +=
			(this.targetVelocity - this.uniforms.velocity.value) * velocityAlpha;
		this.smoothedVelocity = this.uniforms.velocity.value;
	}

	private updateDebugValues(): void {
		this.debugValues.progress = this.uniforms.progress.value;
		this.debugValues.exitProgress = this.exitProgress;
		this.debugValues.velocity = this.targetVelocity;
		this.debugValues.smoothedVelocity = this.smoothedVelocity;
		this.debugValues.activeSlide = Math.round(this.currentVisualIndex);
	}

	private updateHoverState(now: number, recentlyInteracted: boolean): void {
		if (!this.interactionEnabled) {
			this.resetCursorState();
			return;
		}

		const shouldHoverCheck =
			this.isMouseOver &&
			(recentlyInteracted || this.lastHoverCheckTime === 0 || now - this.lastHoverCheckTime > 120);

		if (!shouldHoverCheck) return;

		this.lastHoverCheckTime = now;
		this.updateHoverAtMouse();
	}

	setProgress(progress: number) {
		this.targetProgressValue = Math.max(0, Math.min(1, progress));
	}

	setOpacity(opacity: number) {
		this.uniforms.globalOpacity.value = Math.max(0, Math.min(1, opacity));
	}

	setExitProgress(progress: number) {
		this.exitProgress = Math.max(0, Math.min(1, progress));
	}

	setInteractionEnabled(enabled: boolean): void {
		if (this.interactionEnabled === enabled) return;
		this.interactionEnabled = enabled;
		if (enabled) return;

		this.isMouseOver = false;
		this.currentInteractionSlide = -1;
		this.lastMouseMoveTime = 0;
		this.lastHoverCheckTime = 0;
		this.resetDragLifecycleState();
		this.resetCursorState();
		this.dispatchCursorMode(null);
		this.resetTapTooltip();
	}

	getRefs(): any {
		return {
			config: this.config,
			timing: this.timing,
			uniforms: this.uniforms,
			debugValues: this.debugValues,
			setHarmonicaCenter: (v: number) => this.setHarmonicaCenter(v)
		};
	}

	// ── Theatre.js Inspectable ────────────────────────────────────────

	getConfig(): Record<string, any> {
		const pos = this.group.position;
		return {
			progress: this.uniforms.progress.value,
			opacity: this.uniforms.globalOpacity.value,
			position: { x: pos.x, y: pos.y, z: pos.z },
			visible: this.group.visible,
			color: {
				intensity: this.uniforms.colorIntensity.value
			},
			layout: {
				gap: this.props.spacing,
				roundness: this.uniforms.cornerRadius.value
			},
			harmonica: {
				bands: this.config.harmonicaBands,
				speed: this.config.harmonicaSpeed,
				amplitude: this.config.harmonicaAmplitude,
				frequency: this.config.harmonicaFrequency,
				radius: this.config.harmonicaRadius,
				smoothness: this.config.harmonicaSmoothness,
				centerX: this.config.harmonicaCenterX
			},
			curve: {
				strength: this.config.curveStrength,
				frequency: this.config.curveFrequency,
				maxCurve: this.config.curveMaxCurve,
				yInfluence: this.config.curveYInfluence
			},
			timing: { ...this.timing },
			exit: { ...this.config.exit }
		};
	}

	applyConfig(config: Record<string, any>): void {
		if (typeof config.progress === 'number') {
			this.uniforms.progress.value = config.progress;
			this.setProgress(config.progress);
		}
		if (typeof config.opacity === 'number') {
			this.uniforms.globalOpacity.value = config.opacity;
		}
		if (typeof config.visible === 'boolean') {
			this.group.visible = config.visible;
		}
		const color = config.color;
		if (color && typeof color.intensity === 'number') {
			this.uniforms.colorIntensity.value = Math.max(0, color.intensity);
		}
		const pos = config.position;
		if (pos) {
			if (typeof pos.x === 'number') this.group.position.x = pos.x;
			if (typeof pos.y === 'number') this.group.position.y = pos.y;
			if (typeof pos.z === 'number') this.group.position.z = pos.z;
		}
		const layout = config.layout;
		if (layout) {
			if (typeof layout.gap === 'number') {
				// Negative gap tightens/overlaps cards: at 0 the slideStepMultiplier
				// (1.08) + inactive downscale already leave visible space between them.
				if (layout.gap !== this.props.spacing) {
					this.props.spacing = layout.gap;
					this.uniforms.totalSliderWidth.value =
						(this.props.planeWidth + this.props.spacing) * this.props.slideCount;
					this.updateSlideTransforms(true);
				}
			}
			if (typeof layout.roundness === 'number') {
				this.uniforms.cornerRadius.value = THREE.MathUtils.clamp(layout.roundness, 0, 0.5);
			}
		}
		const h = config.harmonica;
		if (h) {
			if (typeof h.bands === 'number') {
				this.config.harmonicaBands = h.bands;
				this.uniforms.harmonicaBands.value = h.bands;
			}
			if (typeof h.speed === 'number') {
				this.config.harmonicaSpeed = h.speed;
				this.uniforms.harmonicaSpeed.value = h.speed;
			}
			if (typeof h.amplitude === 'number') {
				this.config.harmonicaAmplitude = h.amplitude;
				this.uniforms.harmonicaAmplitude.value = h.amplitude;
			}
			if (typeof h.frequency === 'number') {
				this.config.harmonicaFrequency = h.frequency;
				this.uniforms.harmonicaFrequency.value = h.frequency;
			}
			if (typeof h.radius === 'number') {
				this.config.harmonicaRadius = h.radius;
				this.uniforms.harmonicaRadius.value = h.radius;
			}
			if (typeof h.smoothness === 'number') {
				this.config.harmonicaSmoothness = h.smoothness;
				this.uniforms.harmonicaSmoothness.value = h.smoothness;
			}
			if (typeof h.centerX === 'number') {
				this.setHarmonicaCenter(h.centerX);
			}
		}
		const c = config.curve;
		if (c) {
			if (typeof c.strength === 'number') {
				this.config.curveStrength = c.strength;
				this.uniforms.curveStrength.value = c.strength;
			}
			if (typeof c.frequency === 'number') {
				this.config.curveFrequency = c.frequency;
				this.uniforms.curveFrequency.value = c.frequency;
			}
			if (typeof c.maxCurve === 'number') {
				this.config.curveMaxCurve = c.maxCurve;
				this.uniforms.curveMaxCurve.value = c.maxCurve;
			}
			if (typeof c.yInfluence === 'number') {
				this.config.curveYInfluence = c.yInfluence;
				this.uniforms.curveYInfluence.value = c.yInfluence;
			}
		}
		const timing = config.timing;
		if (timing) {
			if (typeof timing.snapOnRelease === 'boolean') {
				this.timing.snapOnRelease = timing.snapOnRelease;
			}
			if (typeof timing.dragCommitFraction === 'number') {
				this.timing.dragCommitFraction = THREE.MathUtils.clamp(timing.dragCommitFraction, 0, 1);
			}
			if (typeof timing.inertiaProjectionSec === 'number') {
				this.timing.inertiaProjectionSec = Math.max(0, timing.inertiaProjectionSec);
			}
			let minDuration = this.timing.inertiaMinDurationSec;
			let maxDuration = this.timing.inertiaMaxDurationSec;
			if (typeof timing.inertiaMinDurationSec === 'number') {
				minDuration = Math.max(0, timing.inertiaMinDurationSec);
			}
			if (typeof timing.inertiaMaxDurationSec === 'number') {
				maxDuration = Math.max(0, timing.inertiaMaxDurationSec);
			}
			this.timing.inertiaMinDurationSec = Math.min(minDuration, maxDuration);
			this.timing.inertiaMaxDurationSec = Math.max(minDuration, maxDuration);
			if (typeof timing.inertiaDurationScale === 'number') {
				this.timing.inertiaDurationScale = Math.max(0, timing.inertiaDurationScale);
			}
		}
		const e = config.exit;
		if (e) {
			let exitChanged = false;
			for (const key of Object.keys(this.config.exit) as Array<keyof typeof this.config.exit>) {
				const value = e[key];
				if (typeof value !== 'number' || this.config.exit[key] === value) continue;
				this.config.exit[key] = value;
				exitChanged = true;
			}
			if (exitChanged) {
				if (!this.exitPreview.enabled) {
					this.exitProgress = THREE.MathUtils.smootherstep(
						this.targetProgressValue,
						this.config.exit.progressStart,
						1
					);
				}
				this.updateSlideTransforms(true);
			}
		}
	}

	getLabels(): Record<string, string> {
		return {
			layoutGap: 'gap',
			layoutRoundness: 'roundness',
			timingSnapOnRelease: 'snap release',
			timingDragCommitFraction: 'drag commit',
			timingInertiaProjectionSec: 'project sec',
			timingInertiaMinDurationSec: 'min settle',
			timingInertiaMaxDurationSec: 'max settle',
			timingInertiaDurationScale: 'settle x'
		};
	}

	setupInspectorControls(inspectorInstance: any): any {
		const gui = inspectorInstance.createParameters('Train Slider');
		gui.close();

		// Harmonica folder
		const harmonicaFolder = gui.addFolder('Harmonica');
		harmonicaFolder
			.add(this.config, 'harmonicaBands', 2, 30, 1)
			.name('harmonicaBands')
			.onChange((v: number) => {
				this.uniforms.harmonicaBands.value = v;
			});
		harmonicaFolder
			.add(this.config, 'harmonicaSpeed', 0, 5)
			.name('harmonicaSpeed')
			.onChange((v: number) => {
				this.uniforms.harmonicaSpeed.value = v;
			});
		harmonicaFolder
			.add(this.config, 'harmonicaAmplitude', 0, 0.2)
			.name('harmonicaAmplitude')
			.onChange((v: number) => {
				this.uniforms.harmonicaAmplitude.value = v;
			});
		harmonicaFolder
			.add(this.config, 'harmonicaFrequency', 0.1, 5)
			.name('harmonicaFrequency')
			.onChange((v: number) => {
				this.uniforms.harmonicaFrequency.value = v;
			});
		harmonicaFolder
			.add(this.config, 'harmonicaRadius', 1, 50)
			.name('harmonicaRadius')
			.onChange((v: number) => {
				this.uniforms.harmonicaRadius.value = v;
			});
		harmonicaFolder
			.add(this.config, 'harmonicaCenterX', -20, 20)
			.name('harmonicaCenterX')
			.onChange((v: number) => {
				this.setHarmonicaCenter(v);
			});

		// Curve folder
		const curveFolder = gui.addFolder('Curve');
		curveFolder
			.add(this.config, 'curveStrength', 0, 3)
			.name('curveStrength')
			.onChange((v: number) => {
				this.uniforms.curveStrength.value = v;
			});
		curveFolder
			.add(this.config, 'curveFrequency', 0.1, 2)
			.name('curveFrequency')
			.onChange((v: number) => {
				this.uniforms.curveFrequency.value = v;
			});
		curveFolder
			.add(this.config, 'curveMaxCurve', 0.5, 5)
			.name('curveMaxCurve')
			.onChange((v: number) => {
				this.uniforms.curveMaxCurve.value = v;
			});
		curveFolder
			.add(this.config, 'curveYInfluence', 0, 1)
			.name('curveYInfluence')
			.onChange((v: number) => {
				this.uniforms.curveYInfluence.value = v;
			});
		curveFolder.add(this.config, 'curveDamping', 0, 0.99).name('curveDamping');

		const applyExitPreview = () => {
			this.exitProgress = this.exitPreview.enabled
				? THREE.MathUtils.clamp(this.exitPreview.progress, 0, 1)
				: THREE.MathUtils.smootherstep(this.targetProgressValue, this.config.exit.progressStart, 1);
			this.updateSlideTransforms(true);
			this.updateDebugValues();
		};

		const exitFolder = gui.addFolder('Exit Transition');
		exitFolder.add(this.exitPreview, 'enabled').name('previewExit').onChange(applyExitPreview);
		exitFolder
			.add(this.exitPreview, 'progress', 0, 1, 0.001)
			.name('previewProgress')
			.onChange(applyExitPreview);
		exitFolder
			.add(this.config.exit, 'progressStart', 0, 0.95, 0.001)
			.name('progressStart')
			.onChange(applyExitPreview);
		exitFolder
			.add(this.config.exit, 'distance', 0, 120, 0.1)
			.name('distance')
			.onChange(applyExitPreview);

		// Debug folder
		const debugFolder = gui.addFolder('Debug');
		debugFolder.add(this.debugValues, 'progress').listen();
		debugFolder.add(this.debugValues, 'exitProgress').listen();
		debugFolder.add(this.debugValues, 'velocity').listen();
		debugFolder.add(this.debugValues, 'smoothedVelocity').listen();
		debugFolder.add(this.debugValues, 'activeSlide').listen();
		return gui;
	}

	getGroup(): THREE.Group {
		return this.group;
	}

	getSlideCount(): number {
		return this.props.slideCount;
	}

	getRecommendedEndX(baseEndX = -150): number {
		const extraSlides = Math.max(0, this.props.slideCount - BASE_SLIDE_COUNT);
		const perSlideTravel = this.props.planeWidth + this.props.spacing;
		return baseEndX - extraSlides * perSlideTravel;
	}

	dispose() {
		for (const cleanup of this.listenerCleanup) cleanup();
		this.listenerCleanup = [];
		this.resetTapTooltip();

		const geometryDisposed = new Set<THREE.BufferGeometry>();
		this.slides.forEach((slide) => {
			if (!geometryDisposed.has(slide.geometry)) {
				slide.geometry.dispose();
				geometryDisposed.add(slide.geometry);
			}
			this.disposeSlideResources(slide);
		});

		this.slides = [];
		this.group.clear();
	}

	private disposeSlideResources(slide: SlideMesh): void {
		this.disposeSlideMaterial(slide);
		if (slide.userData.titleTexture) {
			slide.userData.titleTexture.dispose();
			slide.userData.titleTexture = null;
		}
	}

	private disposeSlideMaterial(slide: SlideMesh): void {
		if (Array.isArray(slide.material)) {
			for (const material of slide.material) {
				material.dispose();
			}
			return;
		}

		slide.material.dispose();
	}
}

export default TrainSlider;
