<script lang="ts">
	import { canScroll } from '$lib/store.svelte';
	import {
		HERO_INTRO_PHASE,
		HERO_INTRO_PHASE_MOBILE,
		HERO_UI_TIMING,
		SUPPORTING_UI_REVEAL_PROGRESS
	} from '$lib/config/revealTiming';
	import { headingReveal } from '$lib/utils/animations/headingReveal';
	import { textReveal } from '$lib/utils/animations/textReveal';
	import { getBeatProgress } from '$lib/utils/animations/uiProgress';
	import IconPlus from '$lib/components/IconPlus.svelte';
	import { pauseWhenHidden } from '$lib/utils/animations/pauseWhenHidden';

	let { progress, introPhase = HERO_INTRO_PHASE.heading, isMobileIntro = false } = $props();
	const HIDDEN_EPSILON = 0.001;
	const UTC_OFFSET_HOURS = 1;
	const TIME_REFRESH_MS = 10_000;
	const TOP_LINE_TRANSFORM_ORIGIN = 'center';
	// Cubic-bezier equivalent of GSAP's `power2.out` (≡ easeOutCubic).
	const POWER2_OUT_BEZIER = 'cubic-bezier(0.33, 1, 0.68, 1)';

	// State
	let time = $state(getOffsetUtcTime(UTC_OFFSET_HOURS));
	let primaryTextRevealPhase = $derived(
		isMobileIntro ? HERO_INTRO_PHASE_MOBILE.primaryText : HERO_INTRO_PHASE.primaryText
	);
	let secondaryTextRevealPhase = $derived(
		isMobileIntro ? HERO_INTRO_PHASE_MOBILE.secondaryText : HERO_INTRO_PHASE.secondaryText
	);
	let headingRevealPhase = $derived(
		isMobileIntro ? HERO_INTRO_PHASE_MOBILE.heading : HERO_INTRO_PHASE.heading
	);
	let isPrimaryTextPhaseActive = $derived(introPhase >= primaryTextRevealPhase);
	let isSecondaryTextPhaseActive = $derived(introPhase >= secondaryTextRevealPhase);
	let isHeadingPhaseActive = $derived(introPhase >= headingRevealPhase);
	let sectionProgress = $derived(clamp01(progress));
	let scrollRevealProgress = $derived(getHeroUiProgress(sectionProgress));
	let secondaryScrollRevealProgress = $derived(
		getBeatProgress(scrollRevealProgress, HERO_UI_TIMING.scrollBeats.secondaryText)
	);
	let headingScrollRevealProgress = $derived(
		getBeatProgress(scrollRevealProgress, HERO_UI_TIMING.scrollBeats.heading)
	);
	// Scrub mode follows the GLOBAL unlocked state, not a per-mount flag. Hero is
	// section 0 with a ±1 mount window, so scrolling past section 1 unmounts it and
	// scrolling back remounts a fresh instance. Keying off local state replayed the
	// intro reveal on every remount — freezing the title in play mode for ~1.1s
	// instead of scrubbing with scroll. `canScroll` is set true once the intro
	// unlocks and stays true, so a remounted Hero resumes scrubbing immediately.
	let isScrubMode = $derived($canScroll);
	let isHidden = $derived(isScrubMode ? scrollRevealProgress <= HIDDEN_EPSILON : false);
	let isIconHidden = $derived(
		!isScrubMode ||
		(isMobileIntro
			? headingScrollRevealProgress < SUPPORTING_UI_REVEAL_PROGRESS
			: isHidden)
	);
	let topLine = $state<HTMLElement | null>(null);

	const primaryTextRevealOptions = $derived({
		trigger: isScrubMode ? undefined : isPrimaryTextPhaseActive,
		reversed: isScrubMode ? undefined : false,
		progress: isScrubMode ? scrollRevealProgress : undefined,
		scrubProgressPower: isScrubMode ? 1.25 : undefined,
		duration: HERO_UI_TIMING.textDuration
	});

	const secondaryTextRevealOptions = $derived({
		...primaryTextRevealOptions,
		trigger: isScrubMode ? undefined : isSecondaryTextPhaseActive,
		progress: isScrubMode ? secondaryScrollRevealProgress : undefined
	});

	const timeRevealOptions = $derived({ ...secondaryTextRevealOptions, split: false });

	const headingRevealOptions = $derived({
		trigger: isScrubMode ? undefined : isHeadingPhaseActive,
		reversed: isScrubMode ? undefined : false,
		progress: isScrubMode ? headingScrollRevealProgress ** 1.12 : undefined,
		...HERO_UI_TIMING.headingMotion,
		onBeforeRevealEnd: unlockScroll,
		beforeRevealEndOffset: HERO_UI_TIMING.unlockBeforeHeadingEnd
	});

	// Time Logic
	function clamp01(value: number) {
		return Math.max(0, Math.min(1, value));
	}

	function smoothstep(value: number) {
		const x = clamp01(value);
		return x * x * (3 - 2 * x);
	}

	function getHeroUiProgress(sectionProgress: number) {
		const p = clamp01(sectionProgress);
		if (p <= HERO_UI_TIMING.scrollHoldEnd) return 1;
		const hideTimelineProgress = clamp01(
			(p - HERO_UI_TIMING.scrollHoldEnd) / (1 - HERO_UI_TIMING.scrollHoldEnd)
		);
		return 1 - smoothstep(hideTimelineProgress);
	}

	function getOffsetUtcTime(offsetHours: number) {
		const now = new Date();
		now.setUTCHours(now.getUTCHours() + offsetHours);
		const hours = String(now.getUTCHours()).padStart(2, '0');
		const minutes = String(now.getUTCMinutes()).padStart(2, '0');
		return `${hours}:${minutes}`;
	}

	function updateTime() {
		time = getOffsetUtcTime(UTC_OFFSET_HOURS);
	}

	function setTopLineProgress(scaleX: number) {
		if (!topLine) return;
		topLine.style.transformOrigin = TOP_LINE_TRANSFORM_ORIGIN;
		topLine.style.transform = `translate3d(-50%, 0, 0) scaleX(${clamp01(scaleX)})`;
	}

	function unlockScroll() {
		canScroll.set(true);
	}

	$effect(() => {
		const timer = setInterval(updateTime, TIME_REFRESH_MS);
		return () => clearInterval(timer);
	});

	$effect(() => {
		if (!topLine) return;

		if (isScrubMode) {
			setTopLineProgress(scrollRevealProgress);
			return () => setTopLineProgress(0);
		}

		if (!isPrimaryTextPhaseActive) {
			setTopLineProgress(0);
			return () => setTopLineProgress(0);
		}

		topLine.style.transformOrigin = TOP_LINE_TRANSFORM_ORIGIN;
		const tween = topLine.animate(
			[
				{ transform: 'translate3d(-50%, 0, 0) scaleX(0)' },
				{ transform: 'translate3d(-50%, 0, 0) scaleX(1)' }
			],
			{ duration: HERO_UI_TIMING.topLineDurationMs, easing: POWER2_OUT_BEZIER, fill: 'both' }
		);

		return () => {
			tween.cancel();
			setTopLineProgress(0);
		};
	});
</script>

<div class="hero">
	<div class="hero__top text-[15px]  md:text-base min-[1181px]:text-lg min-[2245px]:text-2xl!">
		<div class="hidden lg:flex">
			<p use:textReveal={primaryTextRevealOptions}>
			    Web3 studio serving self-sovereign internet
			</p>
			<p use:textReveal={secondaryTextRevealOptions}>Berlin, DE</p>
		</div>

		<div class="flex">
			<p use:textReveal={primaryTextRevealOptions}>Founded in 2022</p>
			<!--<p use:textReveal={primaryTextRevealOptions} class="lg:hidden">
				Scroll
			</p>-->
			<p class="flex gap-2">
				<!-- split: false — splitting would detach the text node Svelte updates,
				     freezing the clock at its first rendered value. -->
				<span class="font-medium" use:textReveal={timeRevealOptions}>{time}</span>
				<span use:textReveal={secondaryTextRevealOptions}>UTC+1</span>
			</p>
		</div>

		<span class="hero__top-line" bind:this={topLine} aria-hidden="true"></span>
	</div>

	<h1 use:pauseWhenHidden use:headingReveal={headingRevealOptions}>
		<div>
			<span class="text-line">EMERGING</span>
			<span class="text-line">SYSTEMS</span>
			<span class="text-line">OF THE FUTURE</span>
		</div>

		<IconPlus top={['43%']} right={'20px'} hidden={isIconHidden} />
		<IconPlus top={['65%']} left={['20px']} hidden={isIconHidden} />
	</h1>
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.hero {
		display: flex;
		flex-direction: column;
		justify-content: end;
		height: 100%;
		width: 100%;
		/* removed will-change for container, as children now handle anims */

		:global(.icon) {
			@media (max-width: 1600px) {
				&:first-of-type {
					--top-desktop: 48% !important;
				}
			}

			@media (max-width: 1450px) {
				&:first-of-type {
					--top-desktop: 55% !important;
				}

				&:last-of-type {
					--top-desktop: 70% !important;
				}
			}

			@media (max-width: 1240px) {
				&:first-of-type {
					--top-desktop: 62% !important;
				}

				&:last-of-type {
					--top-desktop: 75% !important;
				}
			}

			@media (max-width: 1055px) {
				&:first-of-type {
					--top-desktop: 70% !important;
				}

				&:last-of-type {
					--top-desktop: 83% !important;
				}
			}

			@media (max-width: 1024px) {
				&:first-of-type {
					--top-desktop: 65% !important;
					--right: 10px !important;
				}

				&:last-of-type {
					--top-desktop: 77% !important;
					--left-desktop: 10px !important;
				}
			}

			@media (max-width: 767px) {
				&:first-of-type {
					--top-phone: 65% !important;
				}

				&:last-of-type {
					--top-phone: 77% !important;
					--left-phone: 10px !important;
				}
			}

			@media (max-width: 700px) {
				&:first-of-type {
					--top-phone: 72% !important;
				}

				&:last-of-type {
					--top-phone: 80% !important;
				}
			}

			@media (max-width: 530px) {
				&:first-of-type {
					--top-phone: 72% !important;
				}

				&:last-of-type {
					--top-phone: 85% !important;
				}
			}
		}

		@include breakpoint(not-desktop) {
			justify-content: space-between;
			padding-top: 15rem;
		}

		@include breakpoint(phone) {
			padding-top: 12.5rem;
		}

		&__top {
			padding-bottom: 0.5rem;
			display: flex;
			justify-content: space-between;
			align-items: end;
			position: relative;
			color: $color-text;
			margin-bottom: 2rem;

			@include breakpoint(not-desktop) {
				height: 100%;
			}

			p {
				// 27ch ≡ the old 18rem @ text-lg and 24rem @ text-2xl; one rule, same breaks.
				max-width: 27ch;
			}

			> div {
				width: 100%;
				justify-content: space-between;
				align-items: end;

				@include breakpoint(desktop) {
					width: 35%;
				}
			}

			/* Keep the line animation logic */
			.hero__top-line {
				position: absolute;
				bottom: 0;
				left: 50%;
				transform: translateX(-50%) scaleX(0);
				transform-origin: center;
				width: 100%;
				height: 1px;
				background: rgba(255, 255, 255, 0.2);
				will-change: transform;
				pointer-events: none;
			}
		}
	}

	h1 {
		color: transparent;
		font-size: 200px;

		/* text-5xl md:text-8xl lg:text-9xl xl:text-[200px] min-[2245px]:!text-[196px] */
		@media (max-width: 1600px) {
			font-size: 178px;
		}

		@media (max-width: 1450px) {
			font-size: 154px;
		}

		@media (max-width: 1240px) {
			font-size: var(--text-9xl);
		}

		@media (max-width: 1055px) {
			font-size: var(--text-8xl);
		}

		@media (max-width: 700px) {
			font-size: var(--text-7xl);
		}

		@media (max-width: 530px) {
			font-size: var(--text-5xl);
		}

		.text-line {
			position: relative;
			display: block;
			width: fit-content;
			line-height: 90%;

			&.opacity-0 {
				opacity: 0;
			}

			&:first-of-type {
				margin-left: -5px;
			}
			&:nth-of-type(2),
			&:nth-of-type(3) {
				margin-left: auto;
				margin-right: -5px;
			}

			:global(.char) {
				display: inline-block;
				color: rgb(210 215 225);
			}
		}
	}

</style>
