export type SceneTimeline = {
	fullDurationSeconds: number;
	introDurationSeconds: number;
	introCutoffProgress: number;
	contentDurationSeconds: number;
};

export const DEFAULT_FULL_TIMELINE_DURATION_SECONDS = 43.333333333333336;
export const DEFAULT_INTRO_DURATION_SECONDS = 3.5;

export function createSceneTimeline(
	fullDurationSeconds: number = DEFAULT_FULL_TIMELINE_DURATION_SECONDS,
	introDurationSeconds: number = DEFAULT_INTRO_DURATION_SECONDS
): SceneTimeline {
	const safeFullDuration =
		fullDurationSeconds > 0 ? fullDurationSeconds : DEFAULT_FULL_TIMELINE_DURATION_SECONDS;
	const safeIntroDuration = Math.max(0, Math.min(introDurationSeconds, safeFullDuration));

	return {
		fullDurationSeconds: safeFullDuration,
		introDurationSeconds: safeIntroDuration,
		introCutoffProgress: safeFullDuration > 0 ? safeIntroDuration / safeFullDuration : 0,
		contentDurationSeconds: Math.max(0, safeFullDuration - safeIntroDuration)
	};
}

export const DEFAULT_SCENE_TIMELINE = createSceneTimeline();

export function mapToContentTimelineProgress(
	normalizedProgress: number,
	timeline: SceneTimeline = DEFAULT_SCENE_TIMELINE
): number {
	const clampedProgress = Math.max(0, Math.min(1, normalizedProgress));
	const introCutoffProgress = timeline.introCutoffProgress;

	if (introCutoffProgress <= 0) {
		return clampedProgress;
	}

	if (introCutoffProgress >= 1 || clampedProgress <= introCutoffProgress) {
		return 0;
	}

	return Math.min(1, (clampedProgress - introCutoffProgress) / (1 - introCutoffProgress));
}
