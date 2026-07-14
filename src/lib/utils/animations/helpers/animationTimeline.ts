/**
 * Lightweight timeline sequencer built on the Web Animations API.
 *
 * Replaces GSAP timelines with a thin abstraction that supports:
 * - Sequential and overlapping animations with start offsets
 * - Stagger across multiple targets
 * - Paused creation with play/reverse/progress control
 * - playbackRate (timeScale) adjustments
 * - Callbacks at specific timeline positions (forward and reverse-aware)
 * - Lifecycle hooks: onStart / onComplete / onReverseComplete
 */

export interface TimelineEntry {
	animations: Animation[];
	durations: number[]; // cached per-animation duration (avoids re-reading effect.getTiming() each frame)
	startTime: number; // ms from timeline start
	stagger?: number; // ms between animations in this entry
	forwardEasing: string;
	reverseEasing: string;
}

export interface CallbackEntry {
	fn: () => void;
	time: number; // ms from timeline start
	fired: boolean;
}

export interface AnimationTimelineOptions {
	onStart?: () => void;
	onComplete?: () => void;
	onReverseComplete?: () => void;
}

export class AnimationTimeline {
	private entries: TimelineEntry[] = [];
	private callbacks: CallbackEntry[] = [];
	private _duration = 0;
	private _playbackRate = 1;
	private _playing = false;
	private _reversed = false;
	private _currentTime = 0;
	private _rafId = 0;
	private _lastTimestamp = 0;
	private _lastCallbackTime = 0;

	private _onStart?: () => void;
	private _onComplete?: () => void;
	private _onReverseComplete?: () => void;

	constructor(options: AnimationTimelineOptions = {}) {
		this._onStart = options.onStart;
		this._onComplete = options.onComplete;
		this._onReverseComplete = options.onReverseComplete;
	}

	get duration(): number {
		return this._duration;
	}

	get isActive(): boolean {
		return this._playing;
	}

	get currentTime(): number {
		return this._currentTime;
	}

	get progress(): number {
		return this._duration > 0 ? this._currentTime / this._duration : 0;
	}

	set timeScale(rate: number) {
		this._playbackRate = rate;
	}

	get timeScale(): number {
		return this._playbackRate;
	}

	add(
		target: Element | Element[],
		keyframes: Keyframe[],
		options: { duration: number; easing?: string; reverseEasing?: string; fill?: FillMode },
		startOffset = 0,
		stagger = 0
	): this {
		const targets = Array.isArray(target) ? target : [target];
		const animations: Animation[] = [];
		const durations: number[] = [];
		const forwardEasing = options.easing ?? 'linear';
		const reverseEasing = options.reverseEasing ?? forwardEasing;

		for (const el of targets) {
			const anim = el.animate(keyframes, {
				duration: options.duration,
				easing: forwardEasing,
				fill: options.fill ?? 'both'
			});
			anim.pause();
			animations.push(anim);
			durations.push(options.duration);
		}

		this.entries.push({
			animations,
			durations,
			startTime: startOffset,
			stagger,
			forwardEasing,
			reverseEasing
		});
		const lastStart = startOffset + Math.max(0, targets.length - 1) * stagger;
		this._recalcDuration(lastStart, options.duration);
		return this;
	}

	addCallback(fn: () => void, atTime: number): this {
		this.callbacks.push({ fn, time: atTime, fired: false });
		this._recalcDuration(atTime, 0);
		return this;
	}

	play(fromStart = false): void {
		if (fromStart) {
			this._currentTime = 0;
			this._lastCallbackTime = 0;
			this._resetCallbacks();
		}
		const wasPlayingForward = this._playing && !this._reversed;
		if (fromStart || this._currentTime <= 0) this._setEasing(false);
		this._reversed = false;
		if (!this._playing) {
			this._playing = true;
			this._lastTimestamp = performance.now();
			this._startRaf();
		}
		// Fire onStart on transition into forward play, only if there is room to play.
		if (!wasPlayingForward && this._currentTime < this._duration) {
			this._onStart?.();
		}
	}

	reverse(): void {
		if (this._currentTime >= this._duration) this._setEasing(true);
		this._reversed = true;
		if (!this._playing) {
			this._playing = true;
			this._lastTimestamp = performance.now();
			this._startRaf();
		}
	}

	pause(): void {
		this._playing = false;
		this._stopRaf();
	}

	/**
	 * Set progress directly (0 to 1). Used for scroll-driven animations.
	 * Fires user callbacks (addCallback) when scrubbing past their time, and
	 * un-fires them when scrubbing backward past their time so that the next
	 * forward pass refires them.
	 */
	setProgress(p: number): void {
		const clamped = Math.max(0, Math.min(1, p));
		this._currentTime = clamped * this._duration;
		this._applyTime(this._currentTime);
		this._checkCallbacks(this._currentTime);
	}

	/**
	 * Commit current animation styles to inline styles and cancel animations.
	 * Useful when you want to "freeze" the current state.
	 */
	commitStyles(): void {
		for (const entry of this.entries) {
			for (const anim of entry.animations) {
				try {
					anim.commitStyles();
				} catch {
					// May fail if animation is not in a valid state
				}
				anim.cancel();
			}
		}
	}

	destroy(): void {
		this._stopRaf();
		for (const entry of this.entries) {
			for (const anim of entry.animations) {
				anim.cancel();
			}
		}
		this.entries = [];
		this.callbacks = [];
		this._duration = 0;
		this._currentTime = 0;
		this._lastCallbackTime = 0;
	}

	private _recalcDuration(startOffset: number, animDuration: number): void {
		const end = startOffset + animDuration;
		if (end > this._duration) this._duration = end;
	}

	private _resetCallbacks(): void {
		for (const cb of this.callbacks) {
			cb.fired = false;
		}
	}

	private _startRaf(): void {
		if (this._rafId) return;
		const tick = (now: number) => {
			if (!this._playing) {
				this._rafId = 0;
				return;
			}

			const delta = (now - this._lastTimestamp) * this._playbackRate;
			this._lastTimestamp = now;

			if (this._reversed) {
				this._currentTime = Math.max(0, this._currentTime - delta);
			} else {
				this._currentTime = Math.min(this._duration, this._currentTime + delta);
			}

			this._applyTime(this._currentTime);
			this._checkCallbacks(this._currentTime);

			// Stop at boundaries — fire lifecycle hooks here so they only trigger on
			// natural RAF playback completion (not on setProgress / scrub jumps).
			if (!this._reversed && this._currentTime >= this._duration) {
				this._playing = false;
				this._rafId = 0;
				this._onComplete?.();
				return;
			}
			if (this._reversed && this._currentTime <= 0) {
				this._playing = false;
				this._rafId = 0;
				this._onReverseComplete?.();
				return;
			}

			this._rafId = requestAnimationFrame(tick);
		};
		this._rafId = requestAnimationFrame(tick);
	}

	private _stopRaf(): void {
		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = 0;
		}
	}

	private _applyTime(time: number): void {
		for (const entry of this.entries) {
			const stagger = entry.stagger ?? 0;
			for (let i = 0; i < entry.animations.length; i++) {
				const anim = entry.animations[i];
				const animStart = entry.startTime + i * stagger;
				const localTime = time - animStart;
				const duration = entry.durations[i] ?? 0;
				anim.currentTime = Math.max(0, Math.min(duration, localTime));
			}
		}
	}

	private _setEasing(reversed: boolean): void {
		for (const entry of this.entries) {
			const easing = reversed ? entry.reverseEasing : entry.forwardEasing;
			for (const animation of entry.animations) {
				animation.effect?.updateTiming({ easing });
			}
		}
	}

	/**
	 * Forward motion: fire callbacks whose time has just been crossed.
	 * Backward motion: clear `fired` for callbacks now ahead of `time` so the
	 * next forward pass refires them. This works for both RAF reverse playback
	 * and scrub-driven setProgress jumps.
	 */
	private _checkCallbacks(time: number): void {
		const movingForward = time >= this._lastCallbackTime;
		if (movingForward) {
			for (const cb of this.callbacks) {
				if (!cb.fired && time >= cb.time) {
					cb.fired = true;
					cb.fn();
				}
			}
		} else {
			for (const cb of this.callbacks) {
				if (cb.fired && time < cb.time) {
					cb.fired = false;
				}
			}
		}
		this._lastCallbackTime = time;
	}
}
