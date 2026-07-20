export const DEFAULT_UI_REVEAL_END = 0.36;
export const DEFAULT_UI_HIDE_START = 0.72;
export const DEFAULT_UI_HIDE_END = 1;

export function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function smoothstep(value: number): number {
	const x = clamp01(value);
	return x * x * (3 - 2 * x);
}

export type ProgressBeat = Readonly<{
	start: number;
	end: number;
}>;

export function getLinearBeatProgress(progressValue: number, beat: ProgressBeat): number {
	const start = Number.isFinite(beat.start) ? beat.start : 0;
	const end = Number.isFinite(beat.end) ? Math.max(start, beat.end) : start;
	return clamp01((progressValue - start) / Math.max(end - start, Number.EPSILON));
}

export function getBeatProgress(progressValue: number, beat: ProgressBeat): number {
	return smoothstep(getLinearBeatProgress(progressValue, beat));
}

export function getPhaseProgress(progressValue: number, start: number, span = 1 - start): number {
	return getBeatProgress(progressValue, { start, end: start + span });
}

type UiProgressWindow = {
	revealStart?: number;
	revealEnd?: number;
	hideStart?: number;
	hideEnd?: number;
};

function normalizeProgressPoint(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function getUiProgress(
	sectionProgress: number,
	{
		revealStart = 0,
		revealEnd = DEFAULT_UI_REVEAL_END,
		hideStart = DEFAULT_UI_HIDE_START,
		hideEnd = DEFAULT_UI_HIDE_END
	}: UiProgressWindow = {}
): number {
	const normalizedRevealStart = normalizeProgressPoint(revealStart);
	const normalizedRevealEnd = normalizeProgressPoint(revealEnd);
	const safeRevealStart = Math.min(normalizedRevealStart, normalizedRevealEnd);
	const safeRevealEnd = Math.max(safeRevealStart, normalizedRevealEnd);
	const safeHideStart = Math.max(safeRevealEnd, normalizeProgressPoint(hideStart));
	const safeHideEnd = Math.max(safeHideStart, normalizeProgressPoint(hideEnd));
	const p = Math.max(0, Math.min(sectionProgress, safeHideEnd));

	if (p <= safeRevealStart) {
		return 0;
	}

	if (p <= safeRevealEnd) {
		const revealProgress =
			(p - safeRevealStart) / Math.max(safeRevealEnd - safeRevealStart, Number.EPSILON);
		return smoothstep(clamp01(revealProgress));
	}
	if (p <= safeHideStart) {
		return 1;
	}
	if (p >= safeHideEnd) {
		return 0;
	}

	const hideProgress = clamp01(
		(p - safeHideStart) / Math.max(safeHideEnd - safeHideStart, Number.EPSILON)
	);
	return 1 - smoothstep(hideProgress);
}
