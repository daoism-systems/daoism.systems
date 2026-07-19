import { splitText, type SplitResult } from '../splitText';
import { DURATIONS } from './constants/durations';
import { clamp, clearStyles } from './helpers';
import {
	isLowPerformanceTier,
	isMobileMotionContext,
	scaleMotionDuration,
	useMotionBlur
} from './motion';
import { AnimationTimeline } from './helpers/animationTimeline';

export type TextRevealParams = {
	trigger?: boolean;
	reversed?: boolean;
	progress?: number;
	split?: boolean;
	motion?: boolean;
	duration?: number;
	stagger?: number;
	ease?: string;
	wordOffsetX?: number | string;
	wordOffsetY?: number | string;
	scrubProgressPower?: number;
};

export type TextRevealHandle = {
	update(nextParams: TextRevealParams): void;
	destroy(): void;
	play(): void;
	reverse(): void;
	seek(progress: number): void;
	kill(): void;
	readonly progress: number;
	readonly isActive: boolean;
	timeScale: number;
};

const DEFAULT_DURATION = (DURATIONS.MOTION_REVEAL_DURATION / 1000) * 1.2;
const DEFAULT_CHAR_STAGGER = 0.008;
const DEFAULT_BLOCK_STAGGER = 0;
const DEFAULT_EASE = 'power2.out';
const DEFAULT_BLOCK_EASE = 'power3.out';
const DEFAULT_CHAR_OFFSET_X = '0em';
const DEFAULT_CHAR_OFFSET_Y = '0.4em';
const DEFAULT_BLOCK_OFFSET_X = 0;
const DEFAULT_BLOCK_OFFSET_Y = 16;
const DEFAULT_CHAR_BLUR = '8px';
// Below this delta the scrub is considered settled and the driver rAF stops.
const SCRUB_SETTLE_EPSILON = 0.0005;

// Cubic-bezier equivalents of GSAP named easings.
const POWER2_OUT_BEZIER = 'cubic-bezier(0.33, 1, 0.68, 1)';
const POWER3_OUT_BEZIER = 'cubic-bezier(0.215, 0.61, 0.355, 1)';

const cssEaseFor = (name: string): string => {
	switch (name) {
		case 'power2.out':
			return POWER2_OUT_BEZIER;
		case 'power3.out':
			return POWER3_OUT_BEZIER;
		case 'none':
		case 'linear':
			return 'linear';
		default:
			// Allow callers to pass a raw CSS easing string.
			return name;
	}
};

const toCssLength = (value: number | string): string =>
	typeof value === 'number' ? `${value}px` : value;

// Scale a CSS length by a factor while preserving its unit (numbers are px).
// Used to interpolate the hidden→visible offset when baking eased keyframes.
const scaleCssLength = (value: number | string, factor: number): string => {
	if (typeof value === 'number') return `${value * factor}px`;
	const match = /^(-?[\d.]+)([a-z%]*)$/i.exec(value.trim());
	if (!match) return value;
	return `${parseFloat(match[1]) * factor}${match[2] || 'px'}`;
};

// Exact GSAP "out" power eases (Quad/Cubic/Quart/Quint), keyed by GSAP name. These
// are polynomials in the time input; a cubic-bezier can represent power2.out exactly
// but NOT quartic+ eases (power3.out), so we sample them into linear keyframes
// instead (see bakeRevealKeyframes) to reproduce GSAP's curve 1:1.
const GSAP_POWER_OUT: Record<string, ((t: number) => number) | undefined> = {
	'power1.out': (t) => 1 - (1 - t) ** 2,
	'power2.out': (t) => 1 - (1 - t) ** 3,
	'power3.out': (t) => 1 - (1 - t) ** 4,
	'power4.out': (t) => 1 - (1 - t) ** 5
};

// Keyframe-sampling resolution. 24 steps keeps the piecewise-linear error below
// ~0.13% of the curve while staying cheap (one Animation per char, parsed once).
const EASE_BAKE_STEPS = 24;
const CHAR_BLUR_PX = parseFloat(DEFAULT_CHAR_BLUR);

// Bake a GSAP "out" ease into linear-interpolated keyframes so WAAPI reproduces the
// exact curve. Mirrors GSAP `autoAlpha`: visibility is `hidden` only at offset 0 and
// flips to `visible` the instant the tween starts.
function bakeRevealKeyframes(
	ease: (t: number) => number,
	offsetX: number | string,
	offsetY: number | string,
	applyBlur: boolean
): Keyframe[] {
	const make = (p: number, visible: boolean): Keyframe => {
		const e = ease(p);
		const frame: Keyframe = {
			offset: p,
			opacity: e,
			transform: `translate(${scaleCssLength(offsetX, 1 - e)}, ${scaleCssLength(offsetY, 1 - e)})`,
			visibility: visible ? 'visible' : 'hidden'
		};
		if (applyBlur) frame.filter = e >= 1 ? 'none' : `blur(${CHAR_BLUR_PX * (1 - e)}px)`;
		return frame;
	};

	const frames: Keyframe[] = [make(0, false), make(0.001, true)];
	for (let i = 1; i <= EASE_BAKE_STEPS; i++) frames.push(make(i / EASE_BAKE_STEPS, true));
	return frames;
}

// Cubic-bezier fallback for non-polynomial eases: 3-keyframe sequence with the same
// `autoAlpha` visibility flip; the easing curve is applied by the timeline itself.
function bezierRevealKeyframes(
	offsetX: number | string,
	offsetY: number | string,
	applyBlur: boolean
): Keyframe[] {
	const hiddenTransform = `translate(${toCssLength(offsetX)}, ${toCssLength(offsetY)})`;
	const fromKf: Keyframe = {
		transform: hiddenTransform,
		opacity: 0,
		visibility: 'hidden',
		offset: 0
	};
	const stepKf: Keyframe = {
		transform: hiddenTransform,
		opacity: 0,
		visibility: 'visible',
		offset: 0.001
	};
	const toKf: Keyframe = {
		transform: 'translate(0px, 0px)',
		opacity: 1,
		visibility: 'visible',
		offset: 1
	};
	if (applyBlur) {
		const blur = `blur(${DEFAULT_CHAR_BLUR})`;
		fromKf.filter = blur;
		stepKf.filter = blur;
		toKf.filter = 'none';
	}
	return [fromKf, stepKf, toKf];
}

class TextRevealController {
	private split: SplitResult | null = null;
	private timeline: AnimationTimeline | null = null;
	private destroyed = false;
	private hasRevealed = false;
	private timeScaleValue = 1;
	private resizeObserver: ResizeObserver | null = null;
	private resizeTimeout: ReturnType<typeof setTimeout> | null = null;

	// Frame-aligned scrub driver (same pattern as headingReveal): scroll updates
	// set `targetProgress`; a single self-terminating rAF pulls the timeline
	// toward it, coalescing multiple reactive updates into one apply per frame.
	private targetProgress = 0;
	private appliedProgress = -1;
	private scrubRafId = 0;
	private willChangeActive = false;

	constructor(
		private readonly node: HTMLElement,
		private params: TextRevealParams = {}
	) {}

	init() {
		if (document.fonts?.ready) {
			document.fonts.ready.then(() => this.setup());
			return;
		}
		this.setup();
	}

	private setup() {
		this.build();

		this.resizeObserver = new ResizeObserver(() => {
			if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
			this.resizeTimeout = setTimeout(() => {
				if (this.destroyed) return;
				if (this.hasRevealed) {
					const currentProgress = this.timeline?.progress ?? 0;
					this.build();
					this.scrubTo(currentProgress);
				}
			}, 250);
		});

		this.resizeObserver.observe(this.node);
	}

	update(nextParams: TextRevealParams) {
		const shouldRebuild =
			nextParams.split !== this.params.split ||
			nextParams.motion !== this.params.motion ||
			nextParams.duration !== this.params.duration ||
			nextParams.stagger !== this.params.stagger ||
			nextParams.ease !== this.params.ease ||
			nextParams.wordOffsetX !== this.params.wordOffsetX ||
			nextParams.wordOffsetY !== this.params.wordOffsetY;

		this.params = nextParams;

		if (shouldRebuild) {
			this.build();
			return;
		}

		this.syncWithParams();
	}

	destroy() {
		this.destroyed = true;
		this.resizeObserver?.disconnect();
		if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
		if (this.scrubRafId) cancelAnimationFrame(this.scrubRafId);

		this.timeline?.destroy();
		this.timeline = null;
		this.clearSplit();
		clearStyles(this.node, ['transform', 'opacity', 'visibility', 'filter', 'will-change']);
	}

	play() {
		this.playReveal();
	}
	reverse() {
		this.hideReveal();
	}
	seek(progress: number) {
		this.scrubTo(progress);
	}
	kill() {
		this.timeline?.destroy();
		this.timeline = null;
	}
	get progress() {
		return this.timeline?.progress ?? 0;
	}
	get isActive() {
		return Boolean(this.timeline?.isActive);
	}
	set timeScale(value: number) {
		this.timeScaleValue = value;
		if (this.timeline) this.timeline.timeScale = value;
	}
	get timeScale() {
		return this.timeScaleValue;
	}

	private clearSplit() {
		this.split?.revert();
		this.split = null;
	}

	private isCharMode() {
		// Mobile shares the low-tier block mode: per-char splits mean dozens of
		// will-change-promoted layers rastering at once right as a section scrubs
		// in — the single biggest frame spike on phones.
		return this.params.split !== false && !isLowPerformanceTier() && !isMobileMotionContext();
	}

	private getTargets(): HTMLElement[] {
		if (!this.isCharMode()) return [this.node];
		return this.split?.chars ?? [];
	}

	private shouldApplyMotion() {
		return this.params.motion !== false;
	}

	private getDuration() {
		const duration = this.params.duration ?? DEFAULT_DURATION;
		return scaleMotionDuration(duration);
	}

	private getStagger() {
		if (!this.isCharMode()) return this.params.stagger ?? DEFAULT_BLOCK_STAGGER;
		const stagger = this.params.stagger ?? DEFAULT_CHAR_STAGGER;
		return scaleMotionDuration(stagger, 1.2);
	}

	private getEase() {
		return this.params.ease ?? (this.isCharMode() ? DEFAULT_EASE : DEFAULT_BLOCK_EASE);
	}

	private getOffsetX(): number | string {
		if (!this.shouldApplyMotion()) return 0;
		return (
			this.params.wordOffsetX ??
			(this.isCharMode() ? DEFAULT_CHAR_OFFSET_X : DEFAULT_BLOCK_OFFSET_X)
		);
	}

	private getOffsetY(): number | string {
		if (!this.shouldApplyMotion()) return 0;
		return (
			this.params.wordOffsetY ??
			(this.isCharMode() ? DEFAULT_CHAR_OFFSET_Y : DEFAULT_BLOCK_OFFSET_Y)
		);
	}

	private clearTargetStyles() {
		for (const target of this.getTargets()) {
			clearStyles(target, ['transform', 'opacity', 'visibility', 'filter', 'will-change']);
		}
	}

	private setWillChange(value: 'active' | 'auto') {
		const charMode = this.isCharMode();
		const cssValue =
			value === 'auto'
				? 'auto'
				: charMode && useMotionBlur()
					? 'transform, opacity, filter'
					: 'transform, opacity';
		for (const target of this.getTargets()) {
			target.style.willChange = cssValue;
		}
	}

	// Inline-style hidden state (mirrors GSAP `gsap.set` calls outside the timeline).
	private setHiddenState() {
		const targets = this.getTargets();
		if (!targets.length) return;
		const charMode = this.isCharMode();
		const blur = charMode && useMotionBlur() ? `blur(${DEFAULT_CHAR_BLUR})` : 'none';
		const hiddenTransform = `translate(${toCssLength(this.getOffsetX())}, ${toCssLength(this.getOffsetY())})`;

		for (const target of targets) {
			target.style.transform = hiddenTransform;
			target.style.opacity = '0';
			target.style.visibility = 'hidden';
			if (charMode) target.style.filter = blur;
		}
	}

	private ensureStructure() {
		this.clearSplit();
		if (!this.isCharMode()) return;
		this.split = splitText(this.node);
	}

	private createTimeline() {
		this.timeline?.destroy();
		// The new timeline's animations start at currentTime 0; force the next scrub
		// to re-apply against them regardless of the previously applied value.
		this.appliedProgress = -1;
		this.willChangeActive = false;

		const targets = this.getTargets();
		if (!targets.length) {
			this.timeline = null;
			return;
		}

		const charMode = this.isCharMode();
		const durationMs = this.getDuration() * 1000;
		const staggerMs = charMode ? this.getStagger() * 1000 : 0;
		const applyBlur = charMode && useMotionBlur();
		const offsetX = this.getOffsetX();
		const offsetY = this.getOffsetY();

		const tl = new AnimationTimeline({
			onStart: () => {
				this.hasRevealed = true;
				this.setWillChange('active');
			},
			onComplete: () => {
				this.setWillChange('auto');
				this.clearTargetStyles();
			},
			onReverseComplete: () => {
				this.setWillChange('auto');
			}
		});

		// For GSAP polynomial eases, bake the exact curve into linear-interpolated
		// keyframes — a cubic-bezier can't represent quartic+ eases (e.g. power3.out)
		// 1:1. Unknown eases fall back to the cubic-bezier approximation.
		const easeName = this.getEase();
		const easeFn = GSAP_POWER_OUT[easeName];
		const keyframes = easeFn
			? bakeRevealKeyframes(easeFn, offsetX, offsetY, applyBlur)
			: bezierRevealKeyframes(offsetX, offsetY, applyBlur);
		const easing = easeFn ? 'linear' : cssEaseFor(easeName);

		tl.add(targets, keyframes, { duration: durationMs, easing, fill: 'both' }, 0, staggerMs);
		tl.timeScale = this.timeScaleValue;
		this.timeline = tl;
	}

	private scrubTo(rawProgress: number) {
		// A non-finite value would set anim.currentTime = NaN, which throws in WAAPI
		// and aborts the apply loop mid-reveal (chars stuck). Drop it.
		if (!Number.isFinite(rawProgress)) return;

		const progress = clamp(0, 1, rawProgress);
		this.targetProgress = progress ** (this.params.scrubProgressPower ?? 1);
		this.hasRevealed = this.hasRevealed || this.targetProgress > 0;

		// First apply after a (re)build runs synchronously so there's no 1-frame
		// hidden flash when a section mounts mid-scroll; ongoing updates coalesce
		// through the rAF driver.
		if (this.appliedProgress < 0) {
			this.applyScrub(this.targetProgress);
			return;
		}
		this.ensureScrubRaf();
	}

	private applyScrub(p: number) {
		if (!this.timeline) return;
		this.appliedProgress = p;
		// Set-once based on whether we're mid-reveal — no per-frame re-write.
		this.setScrubWillChange(p > 0 && p < 1);
		this.timeline.pause();
		this.timeline.setProgress(p);
		if (p === 1) this.clearTargetStyles();
	}

	private ensureScrubRaf() {
		if (this.scrubRafId || !this.timeline) return;

		const tick = () => {
			this.scrubRafId = 0;
			if (this.destroyed || !this.timeline) return;

			if (this.targetProgress !== this.appliedProgress) {
				this.applyScrub(this.targetProgress);
			}

			// Re-arm only while the target is still moving (snap-to-target, no lag).
			if (Math.abs(this.targetProgress - this.appliedProgress) > SCRUB_SETTLE_EPSILON) {
				this.scrubRafId = requestAnimationFrame(tick);
			}
		};

		this.scrubRafId = requestAnimationFrame(tick);
	}

	private setScrubWillChange(active: boolean) {
		if (active === this.willChangeActive) return;
		this.willChangeActive = active;
		this.setWillChange(active ? 'active' : 'auto');
	}

	private playReveal() {
		if (!this.timeline) return;
		this.timeline.timeScale = this.timeScaleValue;
		this.timeline.play();
	}

	private hideReveal() {
		if (!this.timeline) return;

		if (!this.hasRevealed) {
			this.setHiddenState();
			return;
		}

		this.setWillChange('active');
		this.timeline.timeScale = this.timeScaleValue;
		this.timeline.reverse();
	}

	private syncWithParams() {
		if (typeof this.params.progress === 'number') {
			this.scrubTo(this.params.progress);
			return;
		}

		if (this.params.reversed) {
			this.hideReveal();
			return;
		}

		if (this.params.trigger) {
			this.playReveal();
			return;
		}

		this.setHiddenState();
	}

	private build() {
		if (this.destroyed) return;

		this.timeline?.destroy();
		this.timeline = null;
		this.ensureStructure();
		this.createTimeline();
		this.setHiddenState();
		this.syncWithParams();
	}
}

export function createTextRevealController(
	node: HTMLElement,
	initialParams: TextRevealParams = {}
): TextRevealHandle {
	const controller = new TextRevealController(node, initialParams);
	controller.init();
	return {
		update: (nextParams: TextRevealParams) => controller.update(nextParams),
		destroy: () => controller.destroy(),
		play: () => controller.play(),
		reverse: () => controller.reverse(),
		seek: (progress: number) => controller.seek(progress),
		kill: () => controller.kill(),
		get progress() {
			return controller.progress;
		},
		get isActive() {
			return controller.isActive;
		},
		set timeScale(value: number) {
			controller.timeScale = value;
		},
		get timeScale() {
			return controller.timeScale;
		}
	};
}

export function textReveal(node: HTMLElement, initialParams: TextRevealParams = {}) {
	const controller = createTextRevealController(node, initialParams);
	return {
		update: (newParams: TextRevealParams) => controller.update(newParams),
		destroy: () => controller.destroy()
	};
}
