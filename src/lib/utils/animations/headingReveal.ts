import { splitText, type SplitResult } from '../splitText';
import { clamp } from './helpers';
import { scaleMotionDuration, useMotionBlur } from './motion';
import { AnimationTimeline } from './helpers/animationTimeline';

type HeadingRevealParams = {
	stagger?: number;
	duration?: number;
	trigger?: boolean;
	reversed?: boolean;
	progress?: number;
	reverseSpeedMultiplier?: number;
	onMidpoint?: () => void;
	onBeforeRevealEnd?: () => void;
	beforeRevealEndOffset?: number;
	onDone?: () => void;
};

const DEFAULT_REVEAL_DURATION = 1.2;
const DEFAULT_REVEAL_STAGGER = 0.02;
const DEFAULT_REVERSE_SPEED_MULTIPLIER = 1;
// Below this delta the scrub is considered settled and the driver rAF stops.
const SCRUB_SETTLE_EPSILON = 0.0005;
// Cubic-bezier equivalent of GSAP's `power3.out` (≡ easeOutQuart).
const POWER3_OUT_BEZIER = 'cubic-bezier(0.215, 0.61, 0.355, 1)';

// Composed in GSAP's transform order: translate3d → rotateX → scale.
const HIDDEN_TRANSFORM = 'translate3d(0, 100%, 0) rotateX(-85deg) scale(0.96)';
const VISIBLE_TRANSFORM = 'translate3d(0, 0, 0) rotateX(0deg) scale(1)';

class HeadingRevealController {
	private timeline: AnimationTimeline | null = null;
	private splits: SplitResult[] = [];
	private chars: HTMLElement[] = [];
	private destroyed = false;
	private hasRevealed = false;
	private resizeObserver: ResizeObserver | null = null;
	private resizeTimeout: ReturnType<typeof setTimeout> | null = null;

	// Frame-aligned scrub driver: scroll updates set `targetProgress`; a single
	// self-terminating rAF pulls the timeline toward it. This coalesces multiple
	// reactive updates into one apply per frame and pokes WAAPI currentTime inside
	// rAF (more reliable repaints than a microtask poke), so the reveal stays
	// solidly connected to scroll instead of freezing under load.
	private targetProgress = 0;
	private appliedProgress = -1;
	private scrubRafId = 0;
	private willChangeActive = false;

	constructor(
		private readonly node: HTMLElement,
		private params: HeadingRevealParams = {}
	) {}

	init() {
		// Build synchronously when fonts are already loaded (the common case) so a
		// section remounted mid-scroll paints its heading the same frame instead of
		// a microtask later. Only defer while fonts are still loading, and re-check
		// `destroyed` in case the node unmounted during the wait.
		if (document.fonts && document.fonts.status !== 'loaded') {
			document.fonts.ready.then(() => {
				if (this.destroyed) return;
				this.setup();
			});
			return;
		}
		this.setup();
	}

	private setup() {
		if (this.destroyed) return;
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

	update(nextParams: HeadingRevealParams) {
		const shouldRebuild =
			nextParams.duration !== this.params.duration ||
			nextParams.stagger !== this.params.stagger ||
			nextParams.onMidpoint !== this.params.onMidpoint ||
			nextParams.onBeforeRevealEnd !== this.params.onBeforeRevealEnd ||
			nextParams.beforeRevealEndOffset !== this.params.beforeRevealEndOffset ||
			nextParams.onDone !== this.params.onDone;

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
		this.clearSplits();
	}

	private setHiddenState() {
		const blur = useMotionBlur() ? 'blur(8px)' : 'none';
		for (const char of this.chars) {
			char.style.opacity = '0';
			char.style.transform = HIDDEN_TRANSFORM;
			char.style.filter = blur;
		}
	}

	private setWillChange(value: string) {
		for (const char of this.chars) {
			char.style.willChange = value;
		}
	}

	private clearSplits() {
		this.splits.forEach((s) => s.revert());
		this.splits = [];
		this.chars = [];
	}

	private getStaggerEachMs(): number {
		return scaleMotionDuration(this.params.stagger ?? DEFAULT_REVEAL_STAGGER, 1.18) * 1000;
	}

	private getRevealDurationMs(): number {
		return scaleMotionDuration(this.params.duration ?? DEFAULT_REVEAL_DURATION) * 1000;
	}

	private setupChars(): boolean {
		// Split per .text-line when present; otherwise treat the node as one line.
		const lines = Array.from(this.node.querySelectorAll<HTMLElement>('.text-line'));
		const targets = lines.length ? lines : [this.node];

		this.splits = targets.map((line) => splitText(line, { mask: true }));
		this.chars = this.splits.flatMap((s) => s.chars);
		this.setHiddenState();
		this.setWillChange('auto');

		return this.chars.length > 0;
	}

	private createTimeline() {
		this.timeline?.destroy();
		// The new timeline's animations start at currentTime 0; force the next scrub
		// to re-apply against them regardless of the previously applied value.
		this.appliedProgress = -1;
		this.willChangeActive = false;

		const blur = useMotionBlur() ? 'blur(8px)' : 'none';
		const durationMs = this.getRevealDurationMs();

		const tl = new AnimationTimeline({
			onStart: () => {
				this.setWillChange('transform, opacity, filter');
				this.hasRevealed = true;
			},
			onComplete: () => {
				this.setWillChange('auto');
			},
			onReverseComplete: () => {
				this.setWillChange('auto');
			}
		});

		const fromKf: Keyframe = {
			opacity: 0,
			transform: HIDDEN_TRANSFORM,
			filter: blur
		};
		const toKf: Keyframe = {
			opacity: 1,
			transform: VISIBLE_TRANSFORM,
			filter: 'none'
		};

		const staggerEachMs = this.getStaggerEachMs();
		const totalChars = this.chars.length;
		for (let i = 0; i < totalChars; i++) {
			const delay = i * staggerEachMs;
			tl.add(
				this.chars[i],
				[fromKf, toKf],
				{ duration: durationMs, easing: POWER3_OUT_BEZIER, fill: 'both' },
				delay,
				0
			);
		}

		const tlDurationMs = tl.duration;

		if (this.params.onBeforeRevealEnd) {
			const offsetMs = (this.params.beforeRevealEndOffset ?? 0.2) * 1000;
			const beforeEndAt = Math.max(tlDurationMs - offsetMs, 0);
			tl.addCallback(this.params.onBeforeRevealEnd, beforeEndAt);
		}

		if (this.params.onMidpoint) {
			tl.addCallback(this.params.onMidpoint, Math.min(200, tlDurationMs));
		}

		if (this.params.onDone) {
			tl.addCallback(this.params.onDone, tlDurationMs);
		}

		this.timeline = tl;
	}

	private scrubTo(rawProgress: number) {
		// A non-finite value would set anim.currentTime = NaN, which throws in WAAPI
		// and aborts the apply loop mid-reveal (chars stuck). Drop it.
		if (!Number.isFinite(rawProgress)) return;

		this.targetProgress = clamp(0, 1, rawProgress);
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
		this.setWillChange(active ? 'transform, opacity, filter' : 'auto');
	}

	private playReveal() {
		if (!this.timeline) return;
		this.setWillChange('transform, opacity, filter');
		this.timeline.timeScale = 1;
		this.timeline.play();
	}

	private hideReveal(speedMultiplier = DEFAULT_REVERSE_SPEED_MULTIPLIER) {
		if (!this.timeline) return;
		if (!this.hasRevealed) {
			this.setHiddenState();
			return;
		}
		this.setWillChange('transform, opacity, filter');
		this.timeline.timeScale = speedMultiplier;
		this.timeline.reverse();
	}

	private syncWithParams() {
		if (typeof this.params.progress === 'number') {
			this.scrubTo(this.params.progress);
			return;
		}

		if (this.params.reversed) {
			this.hideReveal(this.params.reverseSpeedMultiplier ?? DEFAULT_REVERSE_SPEED_MULTIPLIER);
			return;
		}

		if (this.params.trigger) {
			this.playReveal();
		}
	}

	private build() {
		if (this.destroyed) return;
		this.clearSplits();
		if (!this.setupChars()) return;
		this.createTimeline();
		this.syncWithParams();
	}
}

export function headingReveal(node: HTMLElement, params: HeadingRevealParams = {}) {
	const controller = new HeadingRevealController(node, params);
	controller.init();

	return {
		update(newParams: HeadingRevealParams) {
			controller.update(newParams);
		},
		destroy() {
			controller.destroy();
		}
	};
}
