import { get } from 'svelte/store';
import { SLIDES } from '$lib/scene/ui/slideData';
import { canScroll, lenisInstance } from '$lib/store.svelte';
import { buildSectionTimelines, getSectionRevealComplete } from '$lib/config/sectionTimeline';
import { runFullScreenSmokeTransition } from '$lib/utils/fullScreenSmokeTransition';

const SECTION_TIMELINES = buildSectionTimelines(SLIDES.length);
const DUPLICATE_REQUEST_WINDOW_MS = 280;
const MIN_SCROLL_DURATION = 0.9;
const MAX_SCROLL_DURATION = 1.8;
const SCROLL_COMPLETION_BUFFER_MS = 320;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const responsiveStep = (value: number) => {
	const t = clamp01(value);
	const smooth = t * t * t * (t * (t * 6 - 15) + 10);
	return t * 0.22 + smooth * 0.78;
};

function scrollLenisTo(targetScroll: number, duration: number, immediate: boolean): Promise<void> {
	const lenis = lenisInstance.instance;
	if (!lenis) return Promise.resolve();

	return new Promise((resolve) => {
		let isResolved = false;
		let fallbackTimeoutId = 0;
		const resolveOnce = () => {
			if (isResolved) return;
			isResolved = true;
			if (typeof window !== 'undefined') {
				window.clearTimeout(fallbackTimeoutId);
			}
			resolve();
		};

		fallbackTimeoutId =
			typeof window !== 'undefined'
				? window.setTimeout(
						resolveOnce,
						(immediate ? 0 : duration * 1000) + SCROLL_COMPLETION_BUFFER_MS
					)
				: 0;

		lenis.scrollTo(targetScroll, {
			duration,
			easing: responsiveStep,
			immediate,
			lock: !immediate,
			force: true,
			onComplete: resolveOnce
		});

		if (immediate) {
			resolveOnce();
		}
	});
}

export function useScrollToSection(
	isMobileTiming = typeof window !== 'undefined' &&
		window.matchMedia('(max-width: 1024px)').matches,
	isContactStackedTiming = typeof window !== 'undefined' &&
		window.matchMedia('(max-width: 1255px)').matches
) {
	let lastRequestSection = -1;
	let lastRequestAt = 0;
	const sectionRevealComplete = getSectionRevealComplete(isMobileTiming, isContactStackedTiming);
	const sectionNavTargetProgresses = SECTION_TIMELINES.map((section, index) => {
		const reveal = sectionRevealComplete[index] ?? 0;
		return clamp01(section.timelineStart + (section.timelineEnd - section.timelineStart) * reveal);
	});

	function scrollToSection(
		idx: number,
		{
			withSmokeTransition = true,
			immediate = false
		}: { withSmokeTransition?: boolean; immediate?: boolean } = {}
	): Promise<void> {
		const lenis = lenisInstance.instance;
		if (!lenis || !get(canScroll)) return Promise.resolve();

		const targetSection = SECTION_TIMELINES[idx];
		if (!targetSection) return Promise.resolve();

		const now = performance.now();
		const isDuplicateRequest =
			idx === lastRequestSection && now - lastRequestAt <= DUPLICATE_REQUEST_WINDOW_MS;
		if (isDuplicateRequest) return Promise.resolve();
		lastRequestSection = idx;
		lastRequestAt = now;

		const maxScrollableDistance = Math.max(
			1,
			lenis.dimensions.scrollHeight - lenis.dimensions.height
		);
		const currentProgress = clamp01(lenis.animatedScroll / maxScrollableDistance);
		const targetProgress = clamp01(sectionNavTargetProgresses[idx] ?? targetSection.timelineStart);
		const targetScroll = targetProgress * maxScrollableDistance;
		const distance = Math.abs(targetProgress - currentProgress);
		const duration =
			MIN_SCROLL_DURATION + (MAX_SCROLL_DURATION - MIN_SCROLL_DURATION) * Math.sqrt(distance);
		const prefersReducedMotion =
			typeof window !== 'undefined' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		if (!withSmokeTransition) {
			return scrollLenisTo(targetScroll, duration, immediate || prefersReducedMotion);
		}

		return runFullScreenSmokeTransition(() => {
			scrollLenisTo(targetScroll, duration, prefersReducedMotion);
		});
	}

	return { scrollToSection };
}
