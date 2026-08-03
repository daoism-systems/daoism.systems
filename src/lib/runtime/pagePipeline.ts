import type { Component } from 'svelte';
import { BASE_VIRTUAL_SCROLL_HEIGHT } from '$lib/store.svelte';
import { SLIDES } from '$lib/scene/ui/slideData';
import {
	buildSectionTimelines,
	getSectionRevealComplete,
	SCROLL_INDICATOR_LABELS,
	type SectionTimeline
} from '$lib/config/sectionTimeline';
import {
	getRangeProgress,
	mapProgressAcrossRanges,
	type ProgressRange
} from '$lib/scene/animation/sceneProgress';
import { sceneRangeState } from '$lib/config/sceneBoundaryStore.svelte';
import type { ProgressData } from '$lib/scene/MainScene';
import Hero from '$lib/sections/Hero.svelte';
import About from '$lib/sections/About.svelte';
import Services from '$lib/sections/Services.svelte';
import Collaboration from '$lib/sections/Collaboration.svelte';
import Ventures from '$lib/sections/Ventures.svelte';
import Partners from '$lib/sections/Partners.svelte';
import Team from '$lib/sections/Team.svelte';
import Contact from '$lib/sections/Contact.svelte';

export type PageSection = SectionTimeline & {
	component: Component<any>;
};

export type TimelineRange = Pick<SectionTimeline, 'timelineStart' | 'timelineEnd'>;

export type PagePipeline = {
	sections: PageSection[];
	sectionTimelines: TimelineRange[];
	trackerSectionLabels: string[];
	trackerSectionStarts: number[];
	scrollIndicatorLabels: string[];
	scrollIndicatorSectionRevealProgresses: number[];
	virtualScrollHeight: number;
	calculateSectionProgress: (globalProgress: number) => ProgressData;
	mapGlobalProgressToSceneProgress: (globalProgress: number) => number;
};

const MOBILE_SCROLL_HEIGHT_SCALE = 1.5;

const SECTION_COMPONENTS: Component<any>[] = [
	Hero,
	About,
	Services,
	Collaboration,
	Ventures,
	Partners,
	Team,
	Contact
];

export const HERO_SECTION_INDEX = 0;
export const ABOUT_SECTION_INDEX = SECTION_COMPONENTS.indexOf(About);
export const COLLABORATION_SECTION_INDEX = SECTION_COMPONENTS.indexOf(Collaboration);
export const VENTURES_SECTION_INDEX = SECTION_COMPONENTS.indexOf(Ventures);
export const CONTACT_SECTION_INDEX = SECTION_COMPONENTS.length - 1;

export function createPagePipeline(
	isMobileDevice: boolean,
	isMobileTiming = isMobileDevice,
	isContactStackedTiming = isMobileTiming,
	slideCount = SLIDES.length
): PagePipeline {
	const virtualScrollHeight = Math.round(
		BASE_VIRTUAL_SCROLL_HEIGHT * (isMobileDevice ? MOBILE_SCROLL_HEIGHT_SCALE : 1)
	);

	const sections = buildSectionTimelines(slideCount).map((timeline, index) => ({
		component: SECTION_COMPONENTS[index],
		label: timeline.label,
		timelineStart: timeline.timelineStart,
		timelineEnd: timeline.timelineEnd
	}));
	const sectionTimelines = sections.map(({ timelineStart, timelineEnd }) => ({
		timelineStart,
		timelineEnd
	}));
	const sectionProgressRanges = sectionTimelines.map(({ timelineStart, timelineEnd }) => ({
		start: timelineStart,
		end: timelineEnd
	}));

	// Scene-axis target ranges read live from the reactive store so Theatre
	// `Scene Boundaries` edits re-pace the scroll→scene map. Version-cached to a
	// plain array so the per-tick map read doesn't touch the reactive proxy.
	let cachedSceneRanges: ProgressRange[] = [];
	let cachedSceneVersion = -1;
	const sceneRanges = (): ProgressRange[] => {
		if (cachedSceneVersion !== sceneRangeState.version) {
			cachedSceneVersion = sceneRangeState.version;
			cachedSceneRanges = sceneRangeState.ranges.map((range) => ({
				start: range.start,
				end: range.end
			}));
		}
		return cachedSceneRanges;
	};

	return {
		sections,
		sectionTimelines,
		trackerSectionLabels: sections.map((section) => section.label),
		trackerSectionStarts: sections.map((section) => section.timelineStart),
		scrollIndicatorLabels: SCROLL_INDICATOR_LABELS,
		scrollIndicatorSectionRevealProgresses: getSectionRevealComplete(
			isMobileTiming,
			isContactStackedTiming
		),
		virtualScrollHeight,
		calculateSectionProgress(globalProgress) {
			const { sectionIndex, sectionProgress } = getRangeProgress(
				globalProgress,
				sectionProgressRanges
			);

			return {
				step: sectionIndex,
				value: sectionProgress,
				globalProgress
			};
		},
		mapGlobalProgressToSceneProgress(globalProgress) {
			return mapProgressAcrossRanges(globalProgress, sectionProgressRanges, sceneRanges());
		}
	};
}
