import * as THREE from 'three';
import { TABLET_MAX_WIDTH } from './config';

/**
 * Pointer-drag scrubbing for the train slider.
 *
 * Desktop only: touch pointers never reach this controller (see TrainSlider's
 * pointerdown handler) because on touch the slider is advanced by native
 * vertical scrolling, and a horizontal drag layer only fought with it.
 */

/** Pointer travel before a press is promoted to a drag — also the click/drag split. */
const DRAG_START_THRESHOLD_PX = 12;
const DRAG_VELOCITY_WINDOW_MS = 80;
const EDGE_RUBBER_BAND_FRAC = 0.18;
/** How many cards span the viewport — sets how far the pointer travels per slide. */
const VISIBLE_CARDS_DESKTOP = 2.5;
const VISIBLE_CARDS_NARROW = 1.3;

const SNAP_ON_RELEASE_DEFAULT = true;
const DRAG_COMMIT_FRACTION = 0.35;
const INERTIA_TAU_SEC = 0.55;
const INERTIA_MIN_DURATION_SEC = 0.35;
const INERTIA_MAX_DURATION_SEC = 1.4;

export type ScrollDriver = {
	getScroll: () => number;
	setScrollImmediate: (px: number) => void;
	setScrollAnimated: (px: number, durationSec: number) => void;
	cancelAnimatedScroll: () => void;
	getVenturesPixelRange: () => { startPx: number; endPx: number };
	isDriverActive: () => boolean;
};

export type SliderTimingConfig = {
	snapOnRelease: boolean;
	dragCommitFraction: number;
	inertiaProjectionSec: number;
	inertiaMinDurationSec: number;
	inertiaMaxDurationSec: number;
	inertiaDurationScale: number;
};

export const DEFAULT_TIMING_CONFIG: SliderTimingConfig = {
	snapOnRelease: SNAP_ON_RELEASE_DEFAULT,
	dragCommitFraction: DRAG_COMMIT_FRACTION,
	inertiaProjectionSec: INERTIA_TAU_SEC,
	inertiaMinDurationSec: INERTIA_MIN_DURATION_SEC,
	inertiaMaxDurationSec: INERTIA_MAX_DURATION_SEC,
	inertiaDurationScale: 1
};

/**
 * - `idle`: press is armed but hasn't cleared the drag threshold yet.
 * - `started`: the drag began on this call.
 * - `dragging`: scroll was scrubbed on this call.
 * - `ended`: the driver stopped owning scroll mid-gesture; already settled and reset.
 */
export type DragMoveResult = 'idle' | 'started' | 'dragging' | 'ended';

type DragSample = { t: number; scrollPx: number };

function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

export class SliderDragController {
	readonly timing: SliderTimingConfig = { ...DEFAULT_TIMING_CONFIG };

	private driver: ScrollDriver | null = null;
	private samples: DragSample[] = [];
	private armed = false;
	private active = false;
	private originClientX = 0;
	private originClientY = 0;
	private startScrollPx = 0;

	constructor(private readonly getSlideCount: () => number) {}

	get isActive(): boolean {
		return this.active;
	}

	setDriver(driver: ScrollDriver | null): void {
		this.driver = driver;
		if (!driver) this.reset();
	}

	setSnapOnRelease(snap: boolean): void {
		this.timing.snapOnRelease = snap;
	}

	getTiming(): SliderTimingConfig {
		return { ...this.timing };
	}

	/** True while the slider owns page scroll — i.e. a press may become a drag. */
	canBegin(): boolean {
		return this.getLiveDriver() !== null;
	}

	/** Record the press origin. The drag itself starts once the threshold is cleared. */
	arm(clientX: number, clientY: number): void {
		const driver = this.getLiveDriver();
		if (!driver) return;
		this.armed = true;
		this.active = false;
		this.originClientX = clientX;
		this.originClientY = clientY;
		this.startScrollPx = driver.getScroll();
		this.samples = [{ t: performance.now(), scrollPx: this.startScrollPx }];
	}

	handlePointerMove(clientX: number, clientY: number): DragMoveResult {
		if (!this.armed) return 'idle';

		const driver = this.getLiveDriver();
		if (!driver) {
			// Scroll ownership left the slider mid-gesture (section change).
			if (this.active) this.release(0);
			this.reset();
			return 'ended';
		}

		if (!this.active) {
			const travelled = Math.hypot(clientX - this.originClientX, clientY - this.originClientY);
			if (travelled < DRAG_START_THRESHOLD_PX) return 'idle';
			// Re-base onto the current pointer/scroll so the card doesn't jump by the
			// threshold distance on the first scrubbed frame.
			this.active = true;
			driver.cancelAnimatedScroll();
			this.startScrollPx = driver.getScroll();
			this.originClientX = clientX;
			this.originClientY = clientY;
			this.samples = [{ t: performance.now(), scrollPx: this.startScrollPx }];
			return 'started';
		}

		this.scrubTo(driver, clientX - this.originClientX);
		return 'dragging';
	}

	/** Settle the gesture: project the fling, optionally snap to a slide, animate there. */
	release(velocityOverride?: number): void {
		const driver = this.driver;
		if (!driver) {
			this.reset();
			return;
		}

		const { startPx, endPx, scrollPxPerSlide } = this.measure(driver);
		this.trimSamples(performance.now());

		let velocityPxPerSec = velocityOverride ?? 0;
		if (velocityOverride === undefined && this.samples.length >= 2) {
			const first = this.samples[0];
			const last = this.samples[this.samples.length - 1];
			const dt = (last.t - first.t) / 1000;
			if (dt > 0.001) velocityPxPerSec = (last.scrollPx - first.scrollPx) / dt;
		}

		const reduceMotion = prefersReducedMotion();
		const tau = reduceMotion ? 0 : Math.max(0, this.timing.inertiaProjectionSec);
		const currentScrollPx = driver.getScroll();
		const projectedPx = currentScrollPx + velocityPxPerSec * tau;

		const snapped =
			this.timing.snapOnRelease && scrollPxPerSlide > 0
				? this.snapTarget(projectedPx, scrollPxPerSlide, startPx)
				: projectedPx;
		const target = THREE.MathUtils.clamp(snapped, startPx, endPx);

		const distance = Math.abs(target - currentScrollPx);
		const speed = Math.max(Math.abs(velocityPxPerSec), 1);
		const minDuration = Math.max(0, this.timing.inertiaMinDurationSec);
		const maxDuration = Math.max(minDuration, this.timing.inertiaMaxDurationSec);
		const durationScale = Math.max(0, this.timing.inertiaDurationScale);
		const duration = reduceMotion
			? minDuration
			: THREE.MathUtils.clamp((distance / speed) * durationScale, minDuration, maxDuration);

		this.reset();
		driver.setScrollAnimated(target, duration);
	}

	reset(): void {
		this.armed = false;
		this.active = false;
		this.samples = [];
	}

	/** Validate + apply an inspector timing patch (Theatre.js / lil-gui). */
	applyTimingPatch(patch: Record<string, unknown>): void {
		if (typeof patch.snapOnRelease === 'boolean') {
			this.timing.snapOnRelease = patch.snapOnRelease;
		}
		if (typeof patch.dragCommitFraction === 'number') {
			this.timing.dragCommitFraction = THREE.MathUtils.clamp(patch.dragCommitFraction, 0, 1);
		}
		if (typeof patch.inertiaProjectionSec === 'number') {
			this.timing.inertiaProjectionSec = Math.max(0, patch.inertiaProjectionSec);
		}
		let minDuration = this.timing.inertiaMinDurationSec;
		let maxDuration = this.timing.inertiaMaxDurationSec;
		if (typeof patch.inertiaMinDurationSec === 'number') {
			minDuration = Math.max(0, patch.inertiaMinDurationSec);
		}
		if (typeof patch.inertiaMaxDurationSec === 'number') {
			maxDuration = Math.max(0, patch.inertiaMaxDurationSec);
		}
		this.timing.inertiaMinDurationSec = Math.min(minDuration, maxDuration);
		this.timing.inertiaMaxDurationSec = Math.max(minDuration, maxDuration);
		if (typeof patch.inertiaDurationScale === 'number') {
			this.timing.inertiaDurationScale = Math.max(0, patch.inertiaDurationScale);
		}
	}

	private getLiveDriver(): ScrollDriver | null {
		return this.driver?.isDriverActive() ? this.driver : null;
	}

	private measure(driver: ScrollDriver): {
		startPx: number;
		endPx: number;
		scrollPxPerSlide: number;
	} {
		const { startPx, endPx } = driver.getVenturesPixelRange();
		const sectionPx = Math.max(0, endPx - startPx);
		return {
			startPx,
			endPx,
			scrollPxPerSlide: sectionPx / Math.max(1, this.getSlideCount() - 1)
		};
	}

	private scrubTo(driver: ScrollDriver, dx: number): void {
		const { startPx, endPx, scrollPxPerSlide } = this.measure(driver);
		const viewportWidth = typeof window !== 'undefined' ? window.innerWidth || 1 : 1;
		const visibleCards =
			viewportWidth <= TABLET_MAX_WIDTH ? VISIBLE_CARDS_NARROW : VISIBLE_CARDS_DESKTOP;
		const perSlideDragPx = Math.max(140, viewportWidth / visibleCards);
		const sensitivity = scrollPxPerSlide / Math.max(perSlideDragPx, 1);

		const rubber = Math.max(scrollPxPerSlide * EDGE_RUBBER_BAND_FRAC, 1);
		let target = this.startScrollPx - sensitivity * dx;
		if (target < startPx) {
			const overshoot = startPx - target;
			target = startPx - rubber * (1 - Math.exp(-overshoot / rubber));
		} else if (target > endPx) {
			const overshoot = target - endPx;
			target = endPx + rubber * (1 - Math.exp(-overshoot / rubber));
		}

		driver.setScrollImmediate(target);

		const now = performance.now();
		this.samples.push({ t: now, scrollPx: target });
		this.trimSamples(now);
	}

	private snapTarget(projectedPx: number, scrollPxPerSlide: number, startPx: number): number {
		const startSlide = Math.round((this.startScrollPx - startPx) / scrollPxPerSlide);
		const intentSlides = (projectedPx - this.startScrollPx) / scrollPxPerSlide;
		const commitFraction = THREE.MathUtils.clamp(this.timing.dragCommitFraction, 0, 1);
		const targetSlide =
			Math.abs(intentSlides) < commitFraction
				? startSlide
				: startSlide +
					(intentSlides > 0 ? 1 : -1) * Math.max(1, Math.round(Math.abs(intentSlides)));
		const clampedSlide = THREE.MathUtils.clamp(targetSlide, 0, this.getSlideCount() - 1);
		return startPx + clampedSlide * scrollPxPerSlide;
	}

	private trimSamples(now: number): void {
		const cutoff = now - DRAG_VELOCITY_WINDOW_MS;
		while (this.samples.length > 1 && this.samples[0].t < cutoff) this.samples.shift();
	}
}
