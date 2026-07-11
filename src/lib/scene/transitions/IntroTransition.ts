import * as THREE from 'three/webgpu';
import { introTransitionEnded, loadingFinish, showPreloader } from '$lib/store.svelte';

export const INTRO_TRANSITION_SECONDS = 3.5;
const INTRO_TRANSITION_MAX_DELTA_SECONDS = 1 / 30;
const INTRO_TRANSITION_FALLBACK_DELTA_SECONDS = 1 / 60;

export interface IntroTransitionDeps {
	/** `features.introTransition` — when false, the tween is skipped and the
	 *  transition is marked ended immediately (onStart still fires). */
	enabled: boolean;
	/** Lazy getter — `scrollAnimationAction` is only resolved after the GLB loads. */
	scrollAnimationAction: () => THREE.AnimationAction | null;
	/**
	 * Fired the first time gates pass. `immediate` is true when the transition
	 * skips the tween (feature off or no clip), in which case the host should
	 * trigger any post-tween side effects (e.g. octagon fluid activation) right
	 * away. When `immediate` is false, the host should seed the progress
	 * pipeline at zero and apply it; the tween then drives subsequent ticks.
	 */
	onStart?: (info: { immediate: boolean }) => void;
}

export interface IntroTransitionTickResult {
	/** Current intra-tween progress (0 → endProgress). */
	progress: number;
	/** Elapsed time within the intro tween, in seconds. */
	elapsedSeconds: number;
	/** True on the final frame of the tween. */
	complete: boolean;
}

export interface IntroTransitionStartResult {
	/** True the first time gates pass and the transition decides whether to tween or skip. */
	justStarted: boolean;
	/** True when started without an actual tween (feature off or no scrollAnimationAction). */
	immediate: boolean;
}

/**
 * Owns the preloader → intro tween → scene state machine. Subscribes to the
 * `showPreloader` and `loadingFinish` stores internally so the host doesn't
 * have to wire each subscriber. The host is responsible for:
 *   1. calling `start()` once during init
 *   2. calling `markWarmupFinished()` when scene warmup completes
 *   3. calling `tick(delta)` every frame and dispatching the returned progress
 *      to its progress pipeline plus any post-complete side effects (e.g.
 *      activating the octagon fluid simulation)
 */
export class IntroTransition {
	private started = false;
	private active = false;
	private elapsed = 0;
	private endProgress = 0;

	private preloaderVisible = true;
	private preloaderFinished = false;
	private warmupFinished = false;

	private unsubscribeShowPreloader: (() => void) | null = null;
	private unsubscribeLoadingFinish: (() => void) | null = null;

	constructor(private readonly deps: IntroTransitionDeps) {}

	/** Subscribes to preloader stores. Idempotent. */
	public start(): void {
		introTransitionEnded.set(false);
		if (!this.unsubscribeShowPreloader) {
			this.unsubscribeShowPreloader = showPreloader.subscribe((isVisible) => {
				this.preloaderVisible = isVisible;
				if (!isVisible) this.tryStart();
			});
		}
		if (!this.unsubscribeLoadingFinish) {
			this.unsubscribeLoadingFinish = loadingFinish.subscribe((isFinished) => {
				this.preloaderFinished = isFinished;
				if (!isFinished) {
					introTransitionEnded.set(false);
				}
				if (isFinished) this.tryStart();
			});
		}
	}

	public markWarmupFinished(): void {
		this.warmupFinished = true;
		this.tryStart();
	}

	/**
	 * Returns information about whether the gates passed this call. Returns
	 * `{ justStarted: false }` once the transition has already started, or while
	 * any gate is still blocking.
	 */
	public tryStart(): IntroTransitionStartResult {
		if (this.started) return { justStarted: false, immediate: false };
		if (!this.warmupFinished) return { justStarted: false, immediate: false };
		if (!this.preloaderFinished) return { justStarted: false, immediate: false };
		// Intentionally NOT gated on `preloaderVisible`. `preloaderFinished`
		// (loadingFinish) flips true the instant the user hits Start, which is the
		// SAME moment the preloader shell begins its 0.7s dissolve. Starting here
		// lets the octagon fade in UNDER the fading overlay (a crossfade) instead
		// of waiting for the overlay to fully clear — which left a black beat: the
		// scene at progress 0 is near-black (octagon opacity 0), so revealing it
		// before the tween ran showed pure black until the octagon ramped up. The
		// only cost is ~0.7s of the 3.5s reveal spent behind the semi-transparent
		// dissolve, which is still visible. Warmup completes before Start is even
		// offered, so this can't fire while the overlay is fully opaque/idle.

		// Skip the tween when the feature is gated off or no animation clip is
		// available — but still mark the transition as "ended" so anything
		// gated on the end signal (octagon fluid sim activation) can proceed.
		if (!this.deps.enabled) {
			this.started = true;
			this.active = false;
			introTransitionEnded.set(true);
			this.deps.onStart?.({ immediate: true });
			return { justStarted: true, immediate: true };
		}

		const action = this.deps.scrollAnimationAction();
		if (!action) {
			this.started = true;
			this.active = false;
			introTransitionEnded.set(true);
			this.deps.onStart?.({ immediate: true });
			return { justStarted: true, immediate: true };
		}

		const clipDuration = action.getClip().duration;
		if (!(clipDuration > 0)) {
			return { justStarted: false, immediate: false };
		}

		this.started = true;
		this.endProgress = Math.min(1, INTRO_TRANSITION_SECONDS / clipDuration);
		this.active = true;
		this.elapsed = 0;
		introTransitionEnded.set(false);
		this.deps.onStart?.({ immediate: false });
		return { justStarted: true, immediate: false };
	}

	/**
	 * Per-frame tween. Returns null when no transition is active. Otherwise
	 * returns the current intra-tween progress; `complete` is true on the final
	 * frame, after which subsequent calls return null.
	 */
	public tick(delta: number): IntroTransitionTickResult | null {
		if (!this.active || !this.deps.scrollAnimationAction()) return null;

		// Mobile production cold starts can block the render loop while the
		// browser compiles GPU work. Cap large hitches so they do not consume the
		// whole intro before any visible frames are presented. Conversely, iOS
		// WebGPU can report a zero timer delta on resumed/compiled frames; still
		// advance by one visible frame so the intro cannot stick on frame zero.
		const rawDelta =
			Number.isFinite(delta) && delta > 0 ? delta : INTRO_TRANSITION_FALLBACK_DELTA_SECONDS;
		const frameDelta = Math.min(rawDelta, INTRO_TRANSITION_MAX_DELTA_SECONDS);
		this.elapsed += frameDelta;
		const t = Math.min(1, this.elapsed / INTRO_TRANSITION_SECONDS);
		const progress = this.endProgress * t;

		if (t >= 1) {
			this.active = false;
			introTransitionEnded.set(true);
			return {
				progress: this.endProgress,
				elapsedSeconds: INTRO_TRANSITION_SECONDS,
				complete: true
			};
		}
		return { progress, elapsedSeconds: this.elapsed, complete: false };
	}

	public isStarted(): boolean {
		return this.started;
	}

	public isActive(): boolean {
		return this.active;
	}

	public getEndProgress(): number {
		return this.endProgress;
	}

	public getDebugState() {
		return {
			started: this.started,
			active: this.active,
			elapsedSeconds: this.elapsed,
			endProgress: this.endProgress,
			preloaderVisible: this.preloaderVisible,
			preloaderFinished: this.preloaderFinished,
			warmupFinished: this.warmupFinished
		};
	}

	public dispose(): void {
		if (this.unsubscribeShowPreloader) {
			this.unsubscribeShowPreloader();
			this.unsubscribeShowPreloader = null;
		}
		if (this.unsubscribeLoadingFinish) {
			this.unsubscribeLoadingFinish();
			this.unsubscribeLoadingFinish = null;
		}
	}
}
