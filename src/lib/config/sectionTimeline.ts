import { BASE_SLIDE_COUNT } from '$lib/scene/ui/slideData';
import { DEFAULT_SCENE_TIMELINE, createSceneTimeline } from '$lib/scene/animation/sceneTimeline';
import { PAGE_SECTION_SCENE_RANGES } from '$lib/scene/animation/sceneManifest';
import { DEFAULT_UI_REVEAL_END } from '$lib/utils/animations/uiProgress';
import { ABOUT_UI_WINDOW, VENTURES_UI_WINDOW } from '$lib/config/revealTiming';

export type SectionTimeline = {
	label: string;
	timelineStart: number;
	timelineEnd: number;
};

type SectionTemplate = {
	/** Section-tracker label. */
	label: string;
	/** Scroll-indicator label (separate copy from the tracker label). */
	indicatorLabel: string;
	/**
	 * Scroll share. OMIT for the front reveal sections (Hero/About/Services):
	 * their share is derived from the matching Scene_0x width in `sceneManifest`
	 * (× FRONT_SCROLL_FACTOR), so the reveal can't drift off a constant slope when
	 * the scene boundaries are re-tuned.
	 */
	duration?: number;
	stretchWithSlides?: boolean;
	/**
	 * Within-section scroll progress (0–1) at which this section's UI reveal
	 * finishes. The scroll indicator slides its marker onto the section's tick over
	 * the reveal window and ARRIVES at exactly this point — so the tick "selects" the
	 * moment the section is fully revealed (and click-to-navigate lands here too).
	 * Mirror each section component's reveal timing when it changes: Hero is
	 * pre-revealed by the intro (0); About and Ventures use custom windows;
	 * Services/Collaboration/Partners finish at the default `getUiProgress`
	 * revealEnd; Team at `REVEAL_END` (0.22); Contact at its last footer slice
	 * (clock 0.9 · `REVEAL_WINDOW` 0.3 = 0.27).
	 */
	revealCompleteAt: number;
};

// Must equal the maximum reachable scroll progress (1.0). Lenis clamps
// `animatedScroll / maxScrollableDistance` to [0, 1], so any total > 1 leaves
// the tail of the last section — and the end of the 3D timeline — unreachable.
export const SECTION_TIMELINE_TOTAL = 1.0;
export const CURRENT_MODEL_FULL_TIMELINE_DURATION_SECONDS = 66.66666361317039;
const CURRENT_MODEL_SCENE_TIMELINE = createSceneTimeline(
	CURRENT_MODEL_FULL_TIMELINE_DURATION_SECONDS,
	DEFAULT_SCENE_TIMELINE.introDurationSeconds
);
const MODEL_SCROLL_DURATION_SCALE =
	CURRENT_MODEL_SCENE_TIMELINE.contentDurationSeconds /
	DEFAULT_SCENE_TIMELINE.contentDurationSeconds;

// How much scroll the derived front reveal (Hero/About/Services) gets relative to
// the hand-tuned back sections — raise for a slower intro. Tuned so the derived
// weights ≈ the previous hand-set 0.102 / 0.151 / 0.178.
const FRONT_SCROLL_FACTOR = 1.23;

// One row per page section, in scroll order — the single source for section
// labels and scroll pacing. The front reveal sections (Hero/About/Services) OMIT
// `duration`: it's derived from their Scene_0x width (see `resolveDuration`) so
// the octagon → cubes → pyramid-reveal stretch always scrolls at ONE constant
// slope — the reveal is vignette-timed and an uneven slope lurches the camera
// pull-out + VAT morph at the handoff. The rest are hand-tuned content/slide
// pacing; Ventures/Partners stretch with slide count.
const SECTION_TEMPLATES: SectionTemplate[] = [
	{ label: 'Scroll down', indicatorLabel: 'Start', revealCompleteAt: 0 },
	{ label: 'About us', indicatorLabel: 'About us', revealCompleteAt: ABOUT_UI_WINDOW.revealEnd },
	{ label: 'Services', indicatorLabel: 'Services', revealCompleteAt: DEFAULT_UI_REVEAL_END },
	{
		label: 'Collaboration',
		indicatorLabel: 'COLLABORATION',
		duration: 0.106,
		revealCompleteAt: DEFAULT_UI_REVEAL_END
	},
	{
		label: 'Blog',
		indicatorLabel: 'Blog',
		duration: 0.52,
		stretchWithSlides: true,
		revealCompleteAt: VENTURES_UI_WINDOW.revealEnd
	},
	{
		label: 'Partners',
		indicatorLabel: 'Partners',
		duration: 0.18,
		stretchWithSlides: true,
		revealCompleteAt: DEFAULT_UI_REVEAL_END
	},
	{ label: 'Process', indicatorLabel: 'Process', duration: 0.316, revealCompleteAt: 0.22 },
	{ label: '', indicatorLabel: 'Contact', duration: 0.223, revealCompleteAt: 0.27 }
];

export const SCROLL_INDICATOR_LABELS = SECTION_TEMPLATES.map((section) => section.indicatorLabel);

// Per-section within-section progress (0–1) where the UI reveal completes — see
// `SectionTemplate.revealCompleteAt`. Drives the scroll-indicator marker arrival
// and click-to-navigate landing.
export const SECTION_REVEAL_COMPLETE = SECTION_TEMPLATES.map((section) => section.revealCompleteAt);

function getSliderMultiplier(slideCount: number): number {
	return Math.max(1, slideCount / BASE_SLIDE_COUNT);
}

/**
 * A section's scroll share: explicit `duration`, or — for the front reveal
 * sections that omit it — derived from its `sceneManifest` scene-progress width
 * so it stays proportional (constant slope) no matter how the boundaries move.
 */
function resolveDuration(template: SectionTemplate, index: number): number {
	if (template.duration != null) return template.duration;
	const range = PAGE_SECTION_SCENE_RANGES[index];
	return (range.end - range.start) * FRONT_SCROLL_FACTOR;
}

function getStretchedDurations(templates: SectionTemplate[], slideCount: number): number[] {
	const sliderMultiplier = getSliderMultiplier(slideCount);
	return templates.map((template, index) => {
		const duration = resolveDuration(template, index);
		return (
			(template.stretchWithSlides ? duration * sliderMultiplier : duration) *
			MODEL_SCROLL_DURATION_SCALE
		);
	});
}

function buildTimelines(templates: SectionTemplate[], slideCount: number): SectionTimeline[] {
	const stretchedDurations = getStretchedDurations(templates, slideCount);
	const totalDuration = stretchedDurations.reduce((sum, duration) => sum + duration, 0);
	const normalizeFactor = SECTION_TIMELINE_TOTAL / totalDuration;

	let cursor = 0;
	return templates.map((template, index) => {
		const timelineStart = cursor;
		const duration = stretchedDurations[index] * normalizeFactor;
		cursor += duration;
		return {
			label: template.label,
			timelineStart,
			timelineEnd: cursor
		};
	});
}

export function buildSectionTimelines(slideCount: number): SectionTimeline[] {
	return buildTimelines(SECTION_TEMPLATES, slideCount);
}
