/**
 * Runtime frame-pacing monitor for adaptive quality demotion. Samples frame
 * deltas from the render loop and fires `onDemote` when the p95 frame time
 * stays above the budget. Demote-only by design — promotion would oscillate
 * on thermally-throttled mobile GPUs. Pure measurement; the host owns the
 * actual quality actions (resolution scale, fog octaves, …).
 */
export class FramePacingGovernor {
	/** Frames above this delta are tab-switch/GC outliers, not pacing signal. */
	private static readonly OUTLIER_MS = 250;
	private static readonly WINDOW_SIZE = 120;
	private static readonly EVALUATE_INTERVAL_MS = 2000;
	private static readonly DEMOTE_COOLDOWN_MS = 4000;
	private static readonly P95_BUDGET_MS = 33;
	private static readonly MAX_STEPS = 2;

	private readonly samples: number[] = [];
	private sampleIndex = 0;
	private lastEvaluateAt = 0;
	private lastDemoteAt = 0;
	private stepsTaken = 0;

	constructor(private readonly onDemote: (step: number) => void) {}

	/** Feed one rendered frame's delta (seconds). Call only on rendered frames. */
	public recordFrame(deltaSeconds: number, now: number): void {
		if (this.stepsTaken >= FramePacingGovernor.MAX_STEPS) return;
		if (document.hidden) return;

		const frameMs = deltaSeconds * 1000;
		if (frameMs <= 0 || frameMs > FramePacingGovernor.OUTLIER_MS) return;

		if (this.samples.length < FramePacingGovernor.WINDOW_SIZE) {
			this.samples.push(frameMs);
		} else {
			this.samples[this.sampleIndex] = frameMs;
			this.sampleIndex = (this.sampleIndex + 1) % FramePacingGovernor.WINDOW_SIZE;
		}

		if (now - this.lastEvaluateAt < FramePacingGovernor.EVALUATE_INTERVAL_MS) return;
		this.lastEvaluateAt = now;
		this.evaluate(now);
	}

	private evaluate(now: number): void {
		if (this.samples.length < FramePacingGovernor.WINDOW_SIZE) return;
		if (now - this.lastDemoteAt < FramePacingGovernor.DEMOTE_COOLDOWN_MS) return;

		const sorted = [...this.samples].sort((a, b) => a - b);
		const p95 = sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * 0.95))];
		if (p95 <= FramePacingGovernor.P95_BUDGET_MS) return;

		this.stepsTaken += 1;
		this.lastDemoteAt = now;
		// Demotion changes frame pacing — discard the window so the next
		// evaluation only sees post-demotion frames.
		this.samples.length = 0;
		this.sampleIndex = 0;
		this.onDemote(this.stepsTaken);
	}
}
