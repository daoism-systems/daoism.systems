export interface ProgressRange {
	start: number;
	end: number;
}

export interface RangeProgressState {
	sectionIndex: number;
	sectionProgress: number;
}

export const CIRCLE_BACKGROUND_PROGRESS = {
	revealStart: 0.05,
	revealEnd: 0.09,
	hideStart: 0.105,
	hiddenEnd: 0.215
} as const;

// Scene/Theatre-clock window the eyes + spotlight ring ride. The driver is
// `mapGlobalProgressToSceneProgress`, which post-intro equals the Theatre
// `sequence.position / 100` that drives `vignetteIntensity` (so this is the EXACT
// vignette clock). desktop.json vignetteIntensity keyframes (pos → value):
//   0 (held) → 13.167:1.5 (reveal onset) → 19.8:3 → 25.433:3.4 (peak) → 29.6:0 (open).
// formStart/openEnd are matched EXACTLY to the vignette's visible lifetime: onset at pos
// 13.167 (scene 0.13167), fully clear at pos 29.6 (scene 0.296). This is what makes the
// eyes fade in WITH the spotlight (right after the cubes clear) instead of lagging it.
// Nudge only to deviate from the vignette on purpose.
export const CIRCLE_VIGNETTE_SYNC = {
	formStart: 0.13167,
	openEnd: 0.296
} as const;

/**
 * Map scene progress (`mapGlobalProgressToSceneProgress` output = Theatre
 * position / 100, the same clock that drives the vignette/fisheye/morph) onto the
 * circle overlay's native active range [revealStart, hiddenEnd]. Below
 * `formStart`/above `openEnd` the result falls outside that range, so the
 * component stays inert/hidden. This locks the ring + eyes to the vignette.
 */
export function getCircleVignetteSyncProgress(sceneProgress: number): number {
	const a = CIRCLE_BACKGROUND_PROGRESS.revealStart;
	const b = CIRCLE_BACKGROUND_PROGRESS.hiddenEnd;
	const span = Math.max(CIRCLE_VIGNETTE_SYNC.openEnd - CIRCLE_VIGNETTE_SYNC.formStart, 1e-6);
	const t = (sceneProgress - CIRCLE_VIGNETTE_SYNC.formStart) / span;
	return a + t * (b - a);
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function getWindowedFadeProgress(
	progress: number,
	fadeInStart: number,
	fadeInEnd: number,
	fadeOutStart: number,
	fadeOutEnd: number
): number {
	const clampedProgress = clamp01(progress);
	const safeFadeInSpan = Math.max(fadeInEnd - fadeInStart, 0.0001);
	const safeFadeOutSpan = Math.max(fadeOutEnd - fadeOutStart, 0.0001);

	if (clampedProgress <= fadeInStart || clampedProgress >= fadeOutEnd) return 0;
	if (clampedProgress < fadeInEnd) return clamp01((clampedProgress - fadeInStart) / safeFadeInSpan);
	if (clampedProgress <= fadeOutStart) return 1;

	return 1 - clamp01((clampedProgress - fadeOutStart) / safeFadeOutSpan);
}

export function getActiveRangeIndex(progress: number, ranges: readonly ProgressRange[]): number {
	for (let index = ranges.length - 1; index >= 0; index--) {
		if (progress >= ranges[index].start) {
			return index;
		}
	}

	return 0;
}

export function getRangeProgress(
	progress: number,
	ranges: readonly ProgressRange[]
): RangeProgressState {
	const sectionIndex = getActiveRangeIndex(progress, ranges);
	const section = ranges[sectionIndex];

	if (!section) {
		return { sectionIndex: 0, sectionProgress: 0 };
	}

	const span = Math.max(section.end - section.start, 0.0001);
	return {
		sectionIndex,
		sectionProgress: clamp01((progress - section.start) / span)
	};
}

export function mapProgressAcrossRanges(
	progress: number,
	sourceRanges: readonly ProgressRange[],
	targetRanges: readonly ProgressRange[]
): number {
	const { sectionIndex, sectionProgress } = getRangeProgress(progress, sourceRanges);
	const targetRange = targetRanges[sectionIndex] ??
		targetRanges[targetRanges.length - 1] ?? {
			start: 0,
			end: 1
		};

	return targetRange.start + (targetRange.end - targetRange.start) * sectionProgress;
}
