import * as THREE from 'three/webgpu';
import type Lenis from 'lenis';
import TrainSlider, { type ScrollDriver } from './TrainSlider';
import { FluidMouseField } from '../particles/FluidMouseField';
import type { GraphicsTier } from '../GraphicsConfig';
import { TRAIN_SLIDER_LAYOUT, VENTURES_SECTION_INDEX } from '../animation/sceneUiTiming';
import { PHONE_MAX_WIDTH, TABLET_MAX_WIDTH } from './trainSlider/config';

/**
 * Group zoom for the tablet band (768–1024]. Tablets take the mobile single-focus
 * treatment, but the phone scale formula saturates at ~1.05 by 768 — a value tuned
 * to fill a narrow phone — which oversized the card on the wider tablet viewport
 * (see camera FOV 30 at this range). This pulls the single card back to leave the
 * neighbours peeking. Sole knob for tablet card size; lower = smaller card.
 */
const TABLET_SLIDER_SCALE = 0.85;

export interface TrainSliderHostDeps {
	/**
	 * Dedicated overlay scene the slide group is attached to. Rendered by a
	 * TSL pass composited on top of the DaoFog overlay so slides sit visually
	 * above fog. Must have `background = null` for the transparent clear that
	 * lets non-slide pixels show through to the fog underneath.
	 */
	slidesScene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	webGPURenderer: THREE.WebGPURenderer;
	globalFluidEffect: FluidMouseField | null;
	graphicsTier: GraphicsTier;
	isMobile: boolean;
	buildScrollDriver: (lenis: Lenis) => ScrollDriver;
}

/**
 * Owns the TrainSlider lifecycle: construction with tier-derived options, scene
 * attachment, ventures-section visibility/interaction gating, viewport layout,
 * and per-frame ticking. Public API mirrors what MainScene used to do inline.
 */
export class TrainSliderHost {
	private trainSlider: TrainSlider | null = null;
	private trainSliderReady: Promise<void> | null = null;

	constructor(private readonly deps: TrainSliderHostDeps) {}

	public setup(): void {
		// Feature-gated by the host: MainScene only constructs this when
		// `features.trainSlider` is on.
		const cardWidth = this.deps.isMobile ? 10 : 8;
		// Match the 2:1 source artwork (1024×512 KTX2 / 852×426 AVIF) so the texture
		// wraps 1:1 with no vertical stretch: desktop 8 / 4 = 2:1; mobile 10 / 5 = 2:1.
		// Equal-scaling in resolveSliderProps preserves this ratio across mobile breakpoints.
		const cardHeight = this.deps.isMobile ? 5.0 : 4.0;
		this.trainSlider = new TrainSlider({
			renderer: this.deps.webGPURenderer,
			planeWidth: cardWidth,
			planeHeight: cardHeight,
			spacing: 0.07,
			mobileClickHint: window.innerWidth <= TABLET_MAX_WIDTH,
			// Run the slider at full desktop 'high' fidelity on mobile too. The slider's
			// tier only drives the harmonica/curve params + plane geometry segments
			// (16×8 → 32×16), so this upgrades just the slide effect without lifting the
			// scene-wide medium-tier caps (resolution, bloom, shadows stay as-is).
			performanceTier: this.deps.isMobile ? 'high' : this.deps.graphicsTier,
			fluidVelocityNode: this.deps.globalFluidEffect?.getVelocityNode(),
			fluidSimSize: this.deps.globalFluidEffect?.getSimSize()
		});
		this.trainSliderReady = this.trainSlider.whenReady();

		this.trainSlider.setCamera(this.deps.camera);
		this.trainSlider.setInteractionEnabled(false);
		this.trainSlider.enablePointerInteraction();
		if (this.deps.globalFluidEffect) {
			this.trainSlider.enableFluidInteraction();
		}

		const sliderGroup = this.trainSlider.getGroup();
		sliderGroup.position.set(
			TRAIN_SLIDER_LAYOUT.HIDDEN_X,
			TRAIN_SLIDER_LAYOUT.BASE_Y,
			TRAIN_SLIDER_LAYOUT.BASE_Z
		);
		sliderGroup.visible = false;
		this.updateLayout();

		this.deps.slidesScene.add(sliderGroup);
	}

	public setLenis(lenis: Lenis | null): void {
		if (!this.trainSlider) return;
		if (lenis) {
			this.trainSlider.setScrollDriver(this.deps.buildScrollDriver(lenis));
		} else {
			this.trainSlider.setScrollDriver(null);
		}
	}

	public awaitReady(): Promise<void> {
		return this.trainSliderReady ?? Promise.resolve();
	}

	public handleResize(): void {
		if (!this.trainSlider) return;
		this.updateLayout();
		this.trainSlider.handleResize();
	}

	public updateLayout(): void {
		if (!this.trainSlider) return;

		// Responsive SCALE only. The group's position (X slide-in/out, Y, Z) is
		// owned by the Theatre `TrainSlider` tracks; writing position here too made
		// updateLayout (resize) and Theatre (scroll) fight over Y/Z. Theatre has no
		// scale track, so scale is host-owned and conflict-free.
		const sliderGroup = this.trainSlider.getGroup();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		// Desktop (> 1024): unchanged packed layout.
		if (viewportWidth > TABLET_MAX_WIDTH) {
			const desktopT = Math.max(0, Math.min(1, (viewportWidth - 375) / (1440 - 375)));
			const desktopScale = (0.8 + (0.9 - 0.8) * desktopT) * 0.5;
			sliderGroup.scale.setScalar(desktopScale);
			return;
		}

		// Tablet (768–1024]: mobile single-focus treatment, but a dedicated flat scale
		// instead of the phone formula's saturated ~1.05 max, which oversized the card.
		if (viewportWidth > PHONE_MAX_WIDTH) {
			sliderGroup.scale.setScalar(TABLET_SLIDER_SCALE);
			return;
		}

		// Phone (≤768): original width/height-tuned scale, unchanged.
		const widthT = Math.max(0, Math.min(1, (viewportWidth - 320) / (768 - 320)));
		const heightT = Math.max(0, Math.min(1, (viewportHeight - 640) / (900 - 640)));
		const mobileScale = (0.88 + (1.05 - 0.88) * widthT) * (0.95 + 0.08 * heightT);
		sliderGroup.scale.setScalar(mobileScale);
	}

	/**
	 * Per-progress-update gate: hides the slider and disables interaction outside
	 * of the ventures section, and ties interaction to warmup completion inside it.
	 */
	public syncPageSection(activeSection: number, warmupFinished: boolean): void {
		if (!this.trainSlider) return;
		const inVentures = activeSection === VENTURES_SECTION_INDEX;
		// Sole owner of the group's on/off visibility, gated to the Ventures
		// section. Theatre authors the *reveal* (positionX slide + opacity fade +
		// progress) but NOT `visible` — it's excluded from registration via
		// ALWAYS_HIDDEN_PROPS so this synchronous, section-driven write is the only
		// one. Symmetric (true inside / false outside): nothing else flips it on.
		this.trainSlider.getGroup().visible = inVentures;
		if (!inVentures) {
			// Force-hide the touch tap tooltip during prev/next scene transitions —
			// setInteractionEnabled below also clears it, but a direct call here
			// guarantees hide even if interactionEnabled was already false.
			this.trainSlider.hideTapTooltip();
		}
		this.trainSlider.setInteractionEnabled(inVentures && warmupFinished);
	}

	public tickAnimation(delta: number): void {
		if (!this.trainSlider) return;
		if (!this.trainSlider.getGroup().visible) return;
		this.trainSlider.update(delta);
	}

	public setInteractionEnabled(enabled: boolean): void {
		this.trainSlider?.setInteractionEnabled(enabled);
	}

	public getInstance(): TrainSlider | null {
		return this.trainSlider;
	}

	public dispose(): void {
		if (this.trainSlider) {
			this.trainSlider.dispose();
			this.trainSlider = null;
		}
		this.trainSliderReady = null;
	}
}
