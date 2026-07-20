<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { sceneRangeState } from '$lib/config/sceneBoundaryStore.svelte';
	import type { ProgressData } from '$lib/scene/MainScene';
	import type { PageProps } from './$types';
	import Header from '$lib/components/Header.svelte';
	import { canScroll, introTransitionEnded, virtualScrollHeight } from '$lib/store.svelte';
	import CircleBackground from '$lib/components/CircleBackground.svelte';
	import ScrollTracker from '$lib/components/ScrollTracker.svelte';
	import ScrollIndicator from '$lib/components/ScrollIndicator.svelte';
	import Scrollbar from '$lib/components/Scrollbar.svelte';
	import { detectMob } from '$lib/utils/isMobile';
	import AudioVisualiser from '$lib/components/AudioVisualiser.svelte';
	import {
		ABOUT_SECTION_INDEX,
		COLLABORATION_SECTION_INDEX,
		CONTACT_SECTION_INDEX,
		HERO_SECTION_INDEX,
		VENTURES_SECTION_INDEX,
		createPagePipeline,
		type PageSection
	} from '$lib/runtime/pagePipeline';
	import { createSiteRuntime, type SiteRuntime } from '$lib/runtime/siteRuntime';
	import { useScrollToSection } from '$lib/hooks/useScrollToSection';

	type Section = PageSection;

	// Mobile = UA match OR a ≤1024px viewport, so the 1.5× scroll-height scale stays
	// in sync with the intro reveal phases (which key off matchMedia(1024px)). When
	// these disagreed — desktop-UA tablets, narrow windows, devtools emulation — the
	// hero ran the mobile intro on a short desktop-length scroll and the title
	// scrubbed out within half a screen.
	const IS_MOBILE_DEVICE = browser
		? detectMob() || window.matchMedia('(max-width: 1024px)').matches
		: false;
	const PAGE_PIPELINE = createPagePipeline(IS_MOBILE_DEVICE);
	virtualScrollHeight.h = PAGE_PIPELINE.virtualScrollHeight;

	const SECTIONS: Section[] = PAGE_PIPELINE.sections;
	const SECTION_TIMELINES = PAGE_PIPELINE.sectionTimelines;
	const SCROLL_INDICATOR_SECTION_REVEAL_PROGRESSES =
		PAGE_PIPELINE.scrollIndicatorSectionRevealProgresses;
	const TRACKER_SECTION_LABELS = PAGE_PIPELINE.trackerSectionLabels;
	const TRACKER_SECTION_STARTS = PAGE_PIPELINE.trackerSectionStarts;

	let pageProgress = $state<ProgressData>({ step: 0, globalProgress: 0, value: 0 });
	let introPhase = $state(0);
	let introTimers: number[] = [];
	let isMobileIntro = $state(false);
	let introMediaQuery: MediaQueryList | null = null;
	let introMediaHandler: ((event: MediaQueryListEvent) => void) | null = null;
	let phoneViewportQuery: MediaQueryList | null = null;
	let phoneViewportHandler: ((event: MediaQueryListEvent) => void) | null = null;
	const INTRO_PHASE_DELAY_DESKTOP = {
		revealUiGroup: 160,
		revealMenuButtons: 240,
		revealTextAndLine: 380,
		revealHeading: 560
	} as const;
	const INTRO_PHASE_DELAY_MOBILE = {
		revealButtons: 160,
		revealTextAndLine: 340,
		revealHeading: 520,
		revealScrollIndicator: 780
	} as const;

	let sceneContainer = $state<HTMLElement | null>(null);
	let scrollWrapper = $state<HTMLElement | null>(null);
	let scrollContainer = $state<HTMLElement | null>(null);
	let isMobile = $state(false);
	let isPhoneViewport = $state(false);
	let scrollProgress = $state(0);
	let siteRuntime = $state<SiteRuntime | null>(null);
	let runtimeDestroyed = false;
	const { scrollToSection } = useScrollToSection();
	let { data }: PageProps = $props();
	let activeSectionLabel = $derived(SECTIONS[pageProgress.step]?.label ?? '');
	let isContactActive = $derived(pageProgress.step === CONTACT_SECTION_INDEX);
	let introRevealReady = $derived(data.sceneHidden || $introTransitionEnded);

	// ── DEBUG: scroll → section / scene-progress trace ──────────────────────────
	// Logs on each ~0.2% scroll move so you can pause on any frame and read where
	// each section label lands vs the 3D content — e.g. to align '02 Services' /
	// '05 Partners' to the new model. `scene` is content-progress (= Theatre
	// position/100, the vignette clock); the spotlight/eyes window is 0.132→0.296.
	// Set SCROLL_DEBUG = false to silence.
	// const SCROLL_DEBUG = true;
	// let lastScrollLogged = -1;
	// $effect(() => {
	// 	if (!SCROLL_DEBUG) return;
	// 	const scrollPct = pageProgress.globalProgress * 100;
	// 	if (lastScrollLogged >= 0 && Math.abs(scrollPct - lastScrollLogged) < 0.2) return;
	// 	lastScrollLogged = scrollPct;
	// 	const scene = PAGE_PIPELINE.mapGlobalProgressToSceneProgress(pageProgress.globalProgress);
	// 	const step = pageProgress.step;
	// 	console.log(
	// 		`[scroll] ${scrollPct.toFixed(2)}%  §${step} ${SECTIONS[step]?.label ?? ''}  ` +
	// 			`scene=${scene.toFixed(4)} (manifest ${Math.round(scene * 2801)})`
	// 	);
	// });

	function clearIntroTimers() {
		introTimers.forEach((id) => clearTimeout(id));
		introTimers = [];
	}

	function scheduleIntroPhase(phase: number, delayMs: number) {
		const id = window.setTimeout(() => {
			introPhase = phase;
		}, delayMs);
		introTimers = [...introTimers, id];
	}

	onMount(async () => {
		if (!scrollWrapper || !scrollContainer) return;

		introMediaQuery = window.matchMedia('(max-width: 1024px)');
		isMobileIntro = introMediaQuery.matches;
		introMediaHandler = (event: MediaQueryListEvent) => {
			isMobileIntro = event.matches;
		};
		introMediaQuery.addEventListener('change', introMediaHandler);
		phoneViewportQuery = window.matchMedia('(max-width: 1024px)');
		isPhoneViewport = phoneViewportQuery.matches;
		phoneViewportHandler = (event: MediaQueryListEvent) => {
			isPhoneViewport = event.matches;
		};
		phoneViewportQuery.addEventListener('change', phoneViewportHandler);

		isMobile = detectMob();

		const runtime = await createSiteRuntime({
			scrollWrapper,
			scrollContainer,
			sceneContainer,
			isMobile,
			data,
			mapToSceneProgress: PAGE_PIPELINE.mapGlobalProgressToSceneProgress,
			calculatePageProgress: PAGE_PIPELINE.calculateSectionProgress,
			onScrollProgress: (progress) => {
				scrollProgress = progress;
			},
			onPageProgress: (progressData) => {
				pageProgress = progressData;
			},
			isCancelled: () => runtimeDestroyed
		});

		if (runtimeDestroyed) {
			runtime.destroy();
			return;
		}

		siteRuntime = runtime;
		siteRuntime.setScrollEnabled($canScroll);
	});

	onDestroy(() => {
		if (!browser) return;
		clearIntroTimers();
		if (introMediaQuery && introMediaHandler) {
			introMediaQuery.removeEventListener('change', introMediaHandler);
		}
		if (phoneViewportQuery && phoneViewportHandler) {
			phoneViewportQuery.removeEventListener('change', phoneViewportHandler);
		}
		introMediaQuery = null;
		introMediaHandler = null;
		phoneViewportQuery = null;
		phoneViewportHandler = null;
		runtimeDestroyed = true;
		siteRuntime?.destroy();
		siteRuntime = null;
	});

	function scrollToProgress(progress: number) {
		siteRuntime?.scrollToProgress(progress);
	}

	function navigateToSection(
		sectionIndex: number,
		options?: { withSmokeTransition?: boolean; immediate?: boolean }
	) {
		void scrollToSection(sectionIndex, options);
	}

	function navigateToIndicatorSection(sectionIndex: number) {
		navigateToSection(sectionIndex, { withSmokeTransition: false });
	}

	function navigateToContactForm() {
		navigateToSection(CONTACT_SECTION_INDEX);
	}

	const SECTION_MOUNT_WINDOW = 1;

	function isSectionMounted(index: number, activeStep: number): boolean {
		return Math.abs(index - activeStep) <= SECTION_MOUNT_WINDOW;
	}

	function getSectionProgress(index: number, activeStep: number, activeValue: number): number {
		if (index === activeStep) return activeValue;
		// The just-left section gets overflow progress (1 + next-section progress)
		// so opted-in sections can keep their UI up past their own end.
		if (index === activeStep - 1) return 1 + activeValue;
		return index < activeStep ? 1 : 0;
	}

	const OUTGOING_HOLDOVER_SECTION_INDEXES = new Set([
		ABOUT_SECTION_INDEX,
		COLLABORATION_SECTION_INDEX,
		VENTURES_SECTION_INDEX
	]);

	// Some section UIs intentionally fade across the next section's early scroll
	// progress. Keep their wrappers opaque so the component-level reveal curve,
	// not the blanket 0.6s section fade, owns the handoff.
	function isOutgoingHoldover(index: number, activeStep: number): boolean {
		return activeStep === index + 1 && OUTGOING_HOLDOVER_SECTION_INDEXES.has(index);
	}

	$effect(() => {
		if (data.uiHidden) {
			introPhase = 5;
			return;
		}

		clearIntroTimers();

		if (!introRevealReady) {
			introPhase = 0;
			return;
		}

		introPhase = 1;
		if (isMobileIntro) {
			scheduleIntroPhase(2, INTRO_PHASE_DELAY_MOBILE.revealButtons);
			scheduleIntroPhase(3, INTRO_PHASE_DELAY_MOBILE.revealTextAndLine);
			scheduleIntroPhase(4, INTRO_PHASE_DELAY_MOBILE.revealHeading);
			scheduleIntroPhase(5, INTRO_PHASE_DELAY_MOBILE.revealScrollIndicator);
			return;
		}

		scheduleIntroPhase(2, INTRO_PHASE_DELAY_DESKTOP.revealUiGroup);
		scheduleIntroPhase(3, INTRO_PHASE_DELAY_DESKTOP.revealMenuButtons);
		scheduleIntroPhase(4, INTRO_PHASE_DELAY_DESKTOP.revealTextAndLine);
		scheduleIntroPhase(5, INTRO_PHASE_DELAY_DESKTOP.revealHeading);
	});

	$effect(() => {
		siteRuntime?.setScrollEnabled($canScroll);
	});

	// When Theatre retimes the scene boundaries (store version bump), re-drive the
	// render + page step at the current scroll so the change is visible immediately
	// instead of waiting for the next scroll event.
	$effect(() => {
		void sceneRangeState.version;
		siteRuntime?.refresh();
	});
</script>

<svelte:head>
	<title>Daoism Systems</title>
</svelte:head>

<div id="page-scroll-wrapper" class="page-scroll-wrapper" bind:this={scrollWrapper}>
	<!-- <ImageEffects /> -->

	{#if !data.uiHidden}
		<Header
			progress={pageProgress.globalProgress}
			introPhase={introRevealReady ? introPhase : 0}
			onNavigateSection={navigateToSection}
			{isMobileIntro}
		/>

		{#if !isMobile && !isPhoneViewport}
			<CircleBackground
				progress={PAGE_PIPELINE.mapGlobalProgressToSceneProgress(pageProgress.globalProgress)}
				debugGlobalProgress={pageProgress.globalProgress}
			/>
		{/if}
	{/if}

	<div
		class="scroll-container"
		bind:this={scrollContainer}
		style="height: {virtualScrollHeight.h}px;"
	></div>

	{#if !data.sceneHidden}
		<div bind:this={sceneContainer} class="canvas-container"></div>
	{/if}

	<ScrollIndicator
		sections={SECTIONS.length}
		active={pageProgress.step}
		progress={pageProgress.globalProgress}
		onSectionClick={navigateToIndicatorSection}
		onProgressDrag={scrollToProgress}
		sectionTimelines={SECTION_TIMELINES}
		sectionRevealProgresses={SCROLL_INDICATOR_SECTION_REVEAL_PROGRESSES}
		sectionLabels={PAGE_PIPELINE.scrollIndicatorLabels}
		introVisible={introRevealReady && (isMobileIntro ? introPhase >= 5 : introPhase >= 2)}
	/>

	{#if !data.uiHidden}
		<Scrollbar
			progress={scrollProgress}
			onProgressDrag={scrollToProgress}
			introVisible={introRevealReady && (isMobileIntro ? introPhase >= 5 : introPhase >= 2)}
		/>
	{/if}

	{#if !data.uiHidden}
		<div class="mobile-dock">
			<ScrollTracker
				number={pageProgress.step}
				label={activeSectionLabel}
				sectionLabels={TRACKER_SECTION_LABELS}
				globalProgress={scrollProgress}
				sectionStarts={TRACKER_SECTION_STARTS}
			/>

			<AudioVisualiser
				introVisible={introRevealReady && (isMobileIntro ? introPhase >= 5 : introPhase >= 2)}
				mobileHidden={isContactActive}
			/>
		</div>
	{/if}

	{#if !data.uiHidden}
		<div class={`sections ${isContactActive ? 'sections--contact' : ''}`}>
			{#each SECTIONS as section, i (i)}
				<section
					class="section {pageProgress.step === i ? 'active' : ''} {isSectionMounted(
						i,
						pageProgress.step
					)
						? 'nearby'
						: ''} {isOutgoingHoldover(i, pageProgress.step) ? 'outgoing' : ''}"
				>
					{#if isSectionMounted(i, pageProgress.step)}
						{#if i === HERO_SECTION_INDEX}
							<section.component
								progress={getSectionProgress(i, pageProgress.step, pageProgress.value)}
								introPhase={introRevealReady ? introPhase : 0}
								{isMobileIntro}
							/>
						{:else if i === COLLABORATION_SECTION_INDEX}
							<section.component
								progress={getSectionProgress(i, pageProgress.step, pageProgress.value)}
								onGetInTouch={navigateToContactForm}
							/>
						{:else}
							<section.component
								progress={getSectionProgress(i, pageProgress.step, pageProgress.value)}
							/>
						{/if}
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.page-scroll-wrapper {
		position: fixed;
		inset: 0;
		background: #000;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: none;
		scrollbar-width: none;
		-ms-overflow-style: none;
		-webkit-overflow-scrolling: touch;
		touch-action: pan-y;
	}

	.page-scroll-wrapper::-webkit-scrollbar {
		display: none;
	}

	.scroll-container {
		position: relative;
		width: 100%;
		pointer-events: none;
	}

	:global(.canvas) {
		position: fixed !important;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 1;
	}

	.canvas-container {
		position: fixed;
		inset: 0;
		z-index: 1;
		background: #000;
	}

	.mobile-dock {
		display: contents;

		@include breakpoint(not-desktop) {
			position: fixed;
			left: $offset-x-phone;
			right: $offset-x-phone;
			bottom: 1.25rem;
			z-index: 101;
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			gap: 1rem;
			pointer-events: none;

			:global(.scroll-tracker) {
				position: static;
				inset: auto;
				pointer-events: auto;
			}

			/* relative (not static) keeps the button's ::before ring anchored to it. */
			:global(#audio-visualiser.audio-visualiser--mobile) {
				position: relative;
				inset: auto;
			}
		}
	}

	.sections {
		position: fixed;
		inset: 0;
		width: 100%;
		z-index: 12;
		display: flex;
		flex-direction: column;
		pointer-events: none;
		isolation: isolate;
		-webkit-transform: translateZ(0);
		transform: translateZ(0);
		overflow: clip;

		&::before {
			content: '';
			position: absolute;
			inset: 0;
			opacity: 0;
			pointer-events: none;
			transition: opacity 600ms ease;
			background: radial-gradient(
				circle at center,
				rgba(0, 0, 0, 0) 0%,
				rgba(0, 0, 0, 0) 35%,
				rgba(0, 0, 0, 0.4) 52%,
				rgba(0, 0, 0, 0.8) 68%,
				rgba(0, 0, 0, 0.98) 100%
			);
		}
	}
	.sections--contact {
		&::before {
			opacity: 1;
		}
	}

	.section {
		visibility: hidden;
		opacity: 0;
		pointer-events: none;
		position: absolute;
		inset: 0;
		width: 100%;
		display: flex;
		contain: layout style paint;
		content-visibility: auto;

		&:nth-of-type(3) {
			pointer-events: none !important;
		}
	}
	/* Adjacent sections: visible for layout/observers but transparent — only ≤3 at a time */
	.section.nearby {
		visibility: visible;
		transition: opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1);
		-webkit-transform: translateZ(0);
		transform: translateZ(0);
		content-visibility: visible;
	}
	/* Cross-section holdover: the wrapper stays opaque so component-level overflow
	   hide curves retire the UI instead of the blanket 0.6s section fade. */
	.section.outgoing {
		opacity: 1;
		transition: none;
		/* Stack above the now-active section while the outgoing UI fades itself. */
		z-index: 3;
	}
	.section.active {
		visibility: visible;
		opacity: 1;
		pointer-events: auto;
		z-index: 2;
		content-visibility: visible;
	}
	:global(.canvas-container canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
