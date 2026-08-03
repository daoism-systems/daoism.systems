import { BASE_SLIDE_COUNT } from '$lib/scene/ui/slideData';
import { DEFAULT_SCENE_TIMELINE, createSceneTimeline } from '$lib/scene/animation/sceneTimeline';
import { PAGE_SECTION_SCENE_RANGES } from '$lib/scene/animation/sceneManifest';
import { SECTION_REVEAL_COMPLETE as SECTION_UI_REVEAL_COMPLETE } from '$lib/config/revealTiming';

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
	{ label: 'Scroll down', indicatorLabel: 'Start' },
	{ label: 'About us', indicatorLabel: 'About us' },
	{ label: 'Services', indicatorLabel: 'Services' },
	{
		label: 'Collaboration',
		indicatorLabel: 'COLLABORATION',
		duration: 0.106
	},
	{
		label: 'Blog',
		indicatorLabel: 'Blog',
		duration: 0.52,
		stretchWithSlides: true
	},
	{
		label: 'Partners',
		indicatorLabel: 'Partners',
		duration: 0.18,
		stretchWithSlides: true
	},
	{ label: 'Process', indicatorLabel: 'Process', duration: 0.316 },
	{ label: '', indicatorLabel: 'Contact', duration: 0.223 }
];

export const SCROLL_INDICATOR_LABELS = SECTION_TEMPLATES.map((section) => section.indicatorLabel);

export function getSectionRevealComplete(isMobile: boolean, isContactStacked = isMobile): number[] {
	const timing = isMobile ? SECTION_UI_REVEAL_COMPLETE.mobile : SECTION_UI_REVEAL_COMPLETE.desktop;
	const contactTiming = isContactStacked
		? SECTION_UI_REVEAL_COMPLETE.mobile.contact
		: SECTION_UI_REVEAL_COMPLETE.desktop.contact;
	return [
		0,
		timing.about,
		timing.services,
		timing.collaboration,
		timing.ventures,
		timing.partners,
		timing.team,
		contactTiming
	];
}

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
