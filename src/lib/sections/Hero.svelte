<script lang="ts">
	import { canScroll } from '$lib/store.svelte';
	import { headingReveal } from '$lib/utils/animations/headingReveal';
	import { textReveal } from '$lib/utils/animations/textReveal';
	import { DURATIONS } from '$lib/utils/animations/constants/durations';
	import IconPlus from '$lib/components/IconPlus.svelte';
	import { pauseWhenHidden } from '$lib/utils/animations/pauseWhenHidden';

	let { progress, introPhase = 5, isMobileIntro = false } = $props();
	const HIDDEN_EPSILON = 0.001;
	// Fraction of the hero's (short, ~5–7% of total scroll) section progress where the
	// title stays fully visible before it scrubs out. Held longer than the 0.3 default
	// so the title doesn't vanish within the first half-screen of scroll.
	const STATIC_REVEAL_END_AT = 0.5;
	const UTC_OFFSET_HOURS = 1;
	const TIME_REFRESH_MS = 10_000;
	const TOP_LINE_TRANSFORM_ORIGIN = 'center';
	// Cubic-bezier equivalent of GSAP's `power2.out` (≡ easeOutCubic).
	const POWER2_OUT_BEZIER = 'cubic-bezier(0.33, 1, 0.68, 1)';

	// State
	let time = $state(getOffsetUtcTime(UTC_OFFSET_HOURS));
	let textRevealPhase = $derived(isMobileIntro ? 3 : 4);
	let headingRevealPhase = $derived(isMobileIntro ? 4 : 5);
	let isTextRevealPhaseActive = $derived(introPhase >= textRevealPhase);
	let isHeadingPhaseActive = $derived(introPhase >= headingRevealPhase);
	let sectionProgress = $derived(clamp01(progress));
	let scrollRevealProgress = $derived(getHeroUiProgress(sectionProgress));
	// Scrub mode follows the GLOBAL unlocked state, not a per-mount flag. Hero is
	// section 0 with a ±1 mount window, so scrolling past section 1 unmounts it and
	// scrolling back remounts a fresh instance. Keying off local state replayed the
	// intro reveal on every remount — freezing the title in play mode for ~1.1s
	// instead of scrubbing with scroll. `canScroll` is set true once the intro
	// unlocks and stays true, so a remounted Hero resumes scrubbing immediately.
	let isScrubMode = $derived($canScroll);
	let isHidden = $derived(isScrubMode ? scrollRevealProgress <= HIDDEN_EPSILON : false);
	let isIconHidden = $derived(!isScrubMode || isHidden);
	let topLine = $state<HTMLElement | null>(null);

	const textRevealOptions = $derived({
		trigger: isScrubMode ? undefined : isTextRevealPhaseActive,
		reversed: isScrubMode ? undefined : false,
		progress: isScrubMode ? scrollRevealProgress : undefined,
		scrubProgressPower: isScrubMode ? 1.25 : undefined,
		duration: 0.55
	});

	const timeRevealOptions = $derived({ ...textRevealOptions, split: false });

	const headingRevealOptions = $derived({
		trigger: isScrubMode ? undefined : isHeadingPhaseActive,
		reversed: isScrubMode ? undefined : false,
		// Soften the heading hide curve (was ** 2.0) so it fades close to the line/text
		// rate instead of snapping out ahead of them.
		progress: isScrubMode ? scrollRevealProgress ** 1.2 : undefined,
		duration: Math.max(0.6, DURATIONS.MOTION_REVEAL_DURATION / 1000),
		stagger: 0.02
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
		if (p <= STATIC_REVEAL_END_AT) return 1;
		const hideTimelineProgress = clamp01((p - STATIC_REVEAL_END_AT) / (1 - STATIC_REVEAL_END_AT));
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

		if (!isTextRevealPhaseActive) {
			setTopLineProgress(0);
			return () => setTopLineProgress(0);
		}

		topLine.style.transformOrigin = TOP_LINE_TRANSFORM_ORIGIN;
		const tween = topLine.animate(
			[
				{ transform: 'translate3d(-50%, 0, 0) scaleX(0)' },
				{ transform: 'translate3d(-50%, 0, 0) scaleX(1)' }
			],
			{ duration: 1100, easing: POWER2_OUT_BEZIER, fill: 'both' }
		);
		const handleFinish = () => unlockScroll();
		tween.addEventListener('finish', handleFinish);

		return () => {
			tween.removeEventListener('finish', handleFinish);
			tween.cancel();
			setTopLineProgress(0);
		};
	});
</script>

<div class="hero">
	<div class="hero__top text-[15px]  md:text-base min-[1181px]:text-lg min-[2245px]:text-2xl!">
		<div class="hidden lg:flex">
			<p use:textReveal={textRevealOptions}>
			    Web3 studio serving self-sovereign internet
			</p>
			<p use:textReveal={textRevealOptions}>Berlin, DE</p>
		</div>

		<div class="flex">
			<p use:textReveal={textRevealOptions}>Founded in 2022</p>
			<!--<p use:textReveal={textRevealOptions} class="lg:hidden">
				Scroll
			</p>-->
			<p class="flex gap-2">
				<!-- split: false — splitting would detach the text node Svelte updates,
				     freezing the clock at its first rendered value. -->
				<span class="font-medium" use:textReveal={timeRevealOptions}>{time}</span>
				<span use:textReveal={textRevealOptions}>UTC+1</span>
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
