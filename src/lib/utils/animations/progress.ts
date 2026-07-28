export const PROGRESS_PER_SECOND = 30;
export const MAX_PROGRESS_FRAME_DELTA_MS = 1000 / PROGRESS_PER_SECOND;
export const MAX_PENDING_PROGRESS = 99;

export function getProgressTarget(progress: number, ready: boolean) {
	return ready ? 100 : Math.min(MAX_PENDING_PROGRESS, Math.max(0, progress));
}

export function advanceProgress(current: number, target: number, elapsedMs: number) {
	const elapsed = Math.min(Math.max(0, elapsedMs), MAX_PROGRESS_FRAME_DELTA_MS);
	return Math.min(target, current + (elapsed / 1000) * PROGRESS_PER_SECOND);
}
