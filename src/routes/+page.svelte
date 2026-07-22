<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import {
		HERO_INTRO_DELAY_MS,
		HERO_INTRO_PHASE,
		HERO_INTRO_PHASE_MOBILE
	} from '$lib/config/revealTiming';
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
	import { resolveCloudFill } from '$lib/scene/animation/sceneUiTiming';

	type Section = PageSection;

	// Mobile = UA match OR a ≤1024px viewport, so the 1.5× scroll-height scale stays
	// in sync with the intro reveal phases (which key off matchMedia(1024px)). When
	// these disagreed — desktop-UA tablets, narrow windows, devtools emulation — the
	// hero ran the mobile intro on a short desktop-length scroll and the title
	// scrubbed out within half a screen.
	const IS_MOBILE_LAYOUT = browser ? window.matchMedia('(max-width: 1024px)').matches : false;
	const IS_MOBILE_DEVICE = browser ? detectMob() || IS_MOBILE_LAYOUT : false;
	const IS_PHONE_LAYOUT = browser ? window.matchMedia('(max-width: 766px)').matches : false;
	const IS_CONTACT_STACKED_LAYOUT = browser
		? window.matchMedia('(max-width: 1255px)').matches
		: false;
	const PAGE_PIPELINE = createPagePipeline(
		IS_MOBILE_DEVICE,
		IS_MOBILE_LAYOUT,
		IS_CONTACT_STACKED_LAYOUT
	);
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
	let isMobileIntro = $state(IS_MOBILE_LAYOUT);
	let introMediaQuery: MediaQueryList | null = null;
	let introMediaHandler: ((event: MediaQueryListEvent) => void) | null = null;
	let phoneViewportQuery: MediaQueryList | null = null;
	let phoneViewportHandler: ((event: MediaQueryListEvent) => void) | null = null;
	let sceneContainer = $state<HTMLElement | null>(null);
	let scrollWrapper = $state<HTMLElement | null>(null);
	let scrollContainer = $state<HTMLElement | null>(null);
	let isMobile = $state(false);
	let isPhoneViewport = $state(false);
	let scrollProgress = $state(0);
	let siteRuntime = $state<SiteRuntime | null>(null);
	let runtimeDestroyed = false;
	const { scrollToSection } = useScrollToSection(
		IS_MOBILE_LAYOUT,
		IS_CONTACT_STACKED_LAYOUT
	);
	let { data }: PageProps = $props();
	let activeSectionLabel = $derived(SECTIONS[pageProgress.step]?.label ?? '');
	let isContactActive = $derived(pageProgress.step === CONTACT_SECTION_INDEX);
	let collaborationShaderInProgress = $derived(
		resolveCloudFill(
			PAGE_PIPELINE.mapGlobalProgressToSceneProgress(pageProgress.globalProgress)
		).oneToTwo
	);
	let introRevealReady = $derived(data.sceneHidden || $introTransitionEnded);
	let isPeripheralUiIntroVisible = $derived(
		introRevealReady &&
			(isMobileIntro
				? introPhase >= HERO_INTRO_PHASE_MOBILE.scrollIndicator
				: introPhase >= HERO_INTRO_PHASE.uiGroup)
	);

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
		// Phone-only: tablets (767–1024px) keep the CircleBackground, matching the
		// component's `breakpoint(phone) { display: none }` rule. Kept in sync with
		// the SCSS `phone` breakpoint (max-width: 767px).
		phoneViewportQuery = window.matchMedia('(max-width: 767px)');
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
			introPhase = HERO_INTRO_PHASE.heading;
			return;
		}

		clearIntroTimers();

		if (!introRevealReady) {
			introPhase = 0;
			return;
		}

		introPhase = HERO_INTRO_PHASE.logo;
		if (isMobileIntro) {
			scheduleIntroPhase(HERO_INTRO_PHASE_MOBILE.buttons, HERO_INTRO_DELAY_MS.mobile.buttons);
			scheduleIntroPhase(
				HERO_INTRO_PHASE_MOBILE.primaryText,
				HERO_INTRO_DELAY_MS.mobile.primaryText
			);
			scheduleIntroPhase(
				HERO_INTRO_PHASE_MOBILE.secondaryText,
				HERO_INTRO_DELAY_MS.mobile.secondaryText
			);
			scheduleIntroPhase(HERO_INTRO_PHASE_MOBILE.heading, HERO_INTRO_DELAY_MS.mobile.heading);
			scheduleIntroPhase(
				HERO_INTRO_PHASE_MOBILE.scrollIndicator,
				HERO_INTRO_DELAY_MS.mobile.scrollIndicator
			);
			return;
		}

		scheduleIntroPhase(HERO_INTRO_PHASE.uiGroup, HERO_INTRO_DELAY_MS.desktop.uiGroup);
		scheduleIntroPhase(HERO_INTRO_PHASE.menuButtons, HERO_INTRO_DELAY_MS.desktop.menuButtons);
		scheduleIntroPhase(HERO_INTRO_PHASE.primaryText, HERO_INTRO_DELAY_MS.desktop.primaryText);
		scheduleIntroPhase(
			HERO_INTRO_PHASE.secondaryText,
			HERO_INTRO_DELAY_MS.desktop.secondaryText
		);
		scheduleIntroPhase(HERO_INTRO_PHASE.heading, HERO_INTRO_DELAY_MS.desktop.heading);
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
		introVisible={isPeripheralUiIntroVisible}
	/>

	{#if !data.uiHidden}
		<Scrollbar
			progress={scrollProgress}
			onProgressDrag={scrollToProgress}
			introVisible={isPeripheralUiIntroVisible}
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
				introVisible={isPeripheralUiIntroVisible}
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
								shaderInProgress={collaborationShaderInProgress}
								isMobileTiming={IS_MOBILE_LAYOUT}
								isPhoneTiming={IS_PHONE_LAYOUT}
								onGetInTouch={navigateToContactForm}
							/>
						{:else if i === CONTACT_SECTION_INDEX}
							<section.component
								progress={getSectionProgress(i, pageProgress.step, pageProgress.value)}
								isMobileTiming={IS_CONTACT_STACKED_LAYOUT}
							/>
						{:else}
							<section.component
								progress={getSectionProgress(i, pageProgress.step, pageProgress.value)}
								isMobileTiming={IS_MOBILE_LAYOUT}
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

			/* Same circle, stops pushed outward on phones. The radius is the diagonal
			   (farthest-corner), so on a tall/narrow screen the 35% clear core is
			   narrower than the half-width and the copy sits in the falloff band.
			   Widening it to 48% puts the clear edge just past the screen's side
			   edges; the darkening band still closes at 0.98 in the corners. */
			@include breakpoint(phone) {
				background: radial-gradient(
					circle at center,
					rgba(0, 0, 0, 0) 0%,
					rgba(0, 0, 0, 0) 48%,
					rgba(0, 0, 0, 0.4) 64%,
					rgba(0, 0, 0, 0.8) 80%,
					rgba(0, 0, 0, 0.98) 100%
				);
			}
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
