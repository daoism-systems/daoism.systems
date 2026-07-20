<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Heading from '$lib/components/Heading.svelte';
	import IconPlus from '$lib/components/IconPlus.svelte';
	import ForestCard from '$lib/components/ForestCard.svelte';
	import { SUPPORTING_UI_REVEAL_PROGRESS, TEAM_UI_TIMING } from '$lib/config/revealTiming';
	import { vacancies } from '$lib/store.svelte';
	import { clamp01, getBeatProgress } from '$lib/utils/animations/uiProgress';

	let { progress, isMobileTiming = false } = $props();
	const HIDDEN_EPSILON = 0.001;
	const DESKTOP_MIN_SCALE = 0.45;
	const DESKTOP_MAX_ROTATION_DEG = -8;
	const MOBILE_CROSSFADE_FALLOFF = 1.8;
	const MOBILE_SNAP_FALLOFF = 2.5;
	const MOBILE_SNAP_SCALE = 0.018;
	const MOBILE_PRESS_SCALE = 0.015;
	let timing = $derived(isMobileTiming ? TEAM_UI_TIMING.mobile : TEAM_UI_TIMING.desktop);

	let sectionProgress = $derived(clamp01(progress));
	let headingUiProgress = $derived(getTeamHeadingProgress(sectionProgress));
	let isIconHidden = $derived(
		isMobileTiming
			? headingUiProgress < SUPPORTING_UI_REVEAL_PROGRESS
			: headingUiProgress <= HIDDEN_EPSILON
	);

	function getTeamHeadingProgress(p: number) {
		const reveal = getBeatProgress(p, timing.beats.headingReveal);
		const hide = getBeatProgress(p, timing.beats.headingHide);
		return reveal * (1 - hide);
	}

	const teamHeadingRevealConfig = $derived({
		progress: headingUiProgress,
		...timing.headingMotion
	});

	const cardCount = vacancies.length;
	let revealOpacity = $derived(
		getBeatProgress(sectionProgress, timing.beats.cardsReveal)
	);
	let activeFloatTarget = $derived(
		Math.max(0, cardCount - 1) *
			getBeatProgress(sectionProgress, timing.beats.cardsCycle)
	);

	let smoothedActiveFloat = $state(0);
	let isDesktop = $state(false);
	let prefersReducedMotion = $state(false);
	let pressedIndex = $state(-1);
	let sliderEl = $state<HTMLElement | null>(null);
	let cardEls: HTMLElement[] = [];
	let spacing = 0;
	let stripTransform = $state('translate3d(0, 0, 0)');
	let frame = 0;
	let frameTime = 0;
	let reducedMotionMq: MediaQueryList | null = null;
	let onReducedMotionChange: ((e: MediaQueryListEvent) => void) | null = null;

	function refreshCardEls() {
		if (!sliderEl) {
			cardEls = [];
			return;
		}
		cardEls = Array.from(sliderEl.querySelectorAll<HTMLElement>('.team__card-slot'));
	}

	function scheduleResize() {
		if (typeof window === 'undefined') return;
		isDesktop = window.matchMedia('(min-width: 1024px)').matches;
		refreshCardEls();
		recalcSpacing();
		applyTransforms(smoothedActiveFloat);
	}

	function recalcSpacing() {
		if (!isDesktop) {
			spacing = 0;
			return;
		}
		const first = cardEls[0];
		if (!first) {
			spacing = 0;
			return;
		}
		const style = getComputedStyle(first);
		const gapRight = parseFloat(style.marginRight) || 0;
		spacing = first.offsetWidth + gapRight;
	}

	function applyTransforms(activeFloat: number) {
		if (cardEls.length === 0) refreshCardEls();
		if (isDesktop) {
			if (spacing > 0) {
				const dragX = activeFloat * spacing;
				stripTransform = `translate3d(${-dragX}px, 0, 0)`;
				cardEls.forEach((el, i) => {
					if (!el) return;
					const threshold = i * spacing;
					const local = Math.max(0, dragX - threshold);
					const t = Math.min(local / spacing, 1);
					const scale = 1 - (1 - DESKTOP_MIN_SCALE) * t;
					const rotate = DESKTOP_MAX_ROTATION_DEG * t;
					el.style.setProperty('--card-x', `${local}px`);
					el.style.setProperty('--card-y', `0px`);
					el.style.setProperty('--card-scale', `${scale}`);
					el.style.setProperty('--card-rotate', `${rotate}deg`);
					el.style.setProperty('--card-opacity', `1`);
					el.style.zIndex = `${cardCount - i}`;
				});
			} else {
				stripTransform = 'translate3d(0, 0, 0)';
				cardEls.forEach((el, i) => {
					if (!el) return;
					el.style.setProperty('--card-x', `0px`);
					el.style.setProperty('--card-y', `0px`);
					el.style.setProperty('--card-scale', `1`);
					el.style.setProperty('--card-rotate', `0deg`);
					el.style.setProperty('--card-opacity', `1`);
					el.style.zIndex = `${cardCount - i}`;
				});
			}
			return;
		}

		stripTransform = 'translate3d(0, 0, 0)';
		cardEls.forEach((el, i) => {
			if (!el) return;
			const distance = i - activeFloat;
			const absD = Math.abs(distance);
			const isActive = absD < 0.5;
			const isPressed = i === pressedIndex;
			const baseOpacity = Math.max(0, 1 - absD * MOBILE_CROSSFADE_FALLOFF);
			const opacity = isPressed ? 1 : baseOpacity;
			const snapBump = Math.max(0, 1 - absD * MOBILE_SNAP_FALLOFF);
			let scale = prefersReducedMotion ? 1 : 1 + MOBILE_SNAP_SCALE * snapBump * snapBump;
			if (isPressed && !prefersReducedMotion) scale += MOBILE_PRESS_SCALE;

			el.style.setProperty('--card-x', `0px`);
			el.style.setProperty('--card-y', `0px`);
			el.style.setProperty('--card-scale', `${scale}`);
			el.style.setProperty('--card-rotate', `0deg`);
			el.style.setProperty('--card-opacity', `${opacity}`);
			el.style.zIndex = `${isActive ? cardCount + 10 - i : cardCount - i}`;
			el.classList.toggle('is-active', isActive);
		});
	}

	function handlePress(index: number) {
		pressedIndex = index;
	}

	function handleRelease() {
		pressedIndex = -1;
	}

	function tick(now: number) {
		if (!frameTime) frameTime = now;
		const dt = Math.min(Math.max(now - frameTime, 0), 64);
		frameTime = now;
		const alpha = 1 - Math.exp(-dt / timing.cardsSmoothingMs);
		smoothedActiveFloat += (activeFloatTarget - smoothedActiveFloat) * alpha;
		if (Math.abs(activeFloatTarget - smoothedActiveFloat) < 0.0005) {
			smoothedActiveFloat = activeFloatTarget;
		}
		applyTransforms(smoothedActiveFloat);
		frame = requestAnimationFrame(tick);
	}

	onMount(() => {
		isDesktop = window.matchMedia('(min-width: 1024px)').matches;
		reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
		prefersReducedMotion = reducedMotionMq.matches;
		onReducedMotionChange = (e: MediaQueryListEvent) => {
			prefersReducedMotion = e.matches;
		};
		reducedMotionMq.addEventListener('change', onReducedMotionChange);
		refreshCardEls();
		recalcSpacing();
		smoothedActiveFloat = activeFloatTarget;
		applyTransforms(smoothedActiveFloat);
		frame = requestAnimationFrame(tick);
		window.addEventListener('resize', scheduleResize);
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('resize', scheduleResize);
		}
		if (reducedMotionMq && onReducedMotionChange) {
			reducedMotionMq.removeEventListener('change', onReducedMotionChange);
		}
		if (frame) cancelAnimationFrame(frame);
	});
</script>

<div class="team section__wrap">
	<div class="team__content">
		<Heading
			text={['How', 'we work']}
			progress={headingUiProgress}
			className="mobile-padded team-heading"
			headingRevealConfig={teamHeadingRevealConfig}
		/>
		<IconPlus top={['0', '4.6rem']} left={['0']} desktopHide={true} hidden={isIconHidden} />
	</div>

	<div class="team__cards" aria-hidden={revealOpacity < 0.05}>
		<div class="team__slider" bind:this={sliderEl} style:transform={stripTransform}>
			{#each vacancies as vacancy, index (index)}
				<div
					class="team__card-slot"
					data-card-index={index}
					onpointerdown={() => handlePress(index)}
					onpointerup={handleRelease}
					onpointercancel={handleRelease}
					onpointerleave={handleRelease}
				>
					<ForestCard
						{index}
						total={cardCount}
						title={vacancy.title}
						description={vacancy.description}
						itemRevealTiming={timing.cardItems}
						revealProgress={revealOpacity}
					/>
				</div>
			{/each}
		</div>
	</div>
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.team {
		position: relative;
		width: 100%;
		height: 100%;
		padding-top: $offset-content-top;
		display: flex;
		flex-direction: column;

		@include breakpoint(desktop) {
			margin-left: $offset-content;
		}

		/* H2 Large — shared oversized title (Daoism Systems / Services / Join our team). */
		:global(.team-heading) {
			@include breakpoint(desktop) {
				font-size: 104px;
			}
		}

		&__content {
			width: 100%;
			display: flex;
			flex-direction: column;
			justify-content: space-between;

			@include breakpoint(tablet) {
				position: relative;
			}
		}

		&__cards {
			position: absolute;
			left: 0;
			right: 0;
			bottom: 0;
			pointer-events: none;
			z-index: 3;

			@include breakpoint(desktop) {
				display: none;
			}
		}

		&__cards-gradient {
			position: absolute;
			left: 0;
			right: 0;
			bottom: -5rem;
			height: 290px;
			background: linear-gradient(
				to bottom,
				rgba(28, 30, 32, 0) 0%,
				rgba(28, 30, 32, 0.6) 40%,
				#1c1e20 73.85%
			);
			pointer-events: none;
			z-index: -1;

			@include breakpoint(desktop) {
				display: none;
			}
		}

		&__slider {
			display: flex;
			width: 100%;
			will-change: transform;
			backface-visibility: hidden;

			@include breakpoint(not-desktop) {
				flex-direction: column;
				align-items: stretch;
				position: relative;
				min-height: 10rem;
			}

			@include breakpoint(desktop) {
				flex-direction: row;
				align-items: flex-end;
			}
		}

		&__card-slot {
			--card-x: 0px;
			--card-y: 0px;
			--card-scale: 1;
			--card-rotate: 0deg;
			--card-opacity: 0;
			transform: translate3d(var(--card-x), var(--card-y), 0) scale(var(--card-scale))
				rotate(var(--card-rotate));
			opacity: var(--card-opacity);
			transition:
				transform 0.18s cubic-bezier(0.22, 0.61, 0.36, 1),
				opacity 0.18s cubic-bezier(0.22, 0.61, 0.36, 1);
			will-change: transform, opacity;
			pointer-events: none;
			transform-origin: 75% center;
			touch-action: manipulation;
			-webkit-tap-highlight-color: transparent;

			@include breakpoint(not-desktop) {
				position: absolute;
				left: 0;
				right: 0;
				bottom: 0;
				transform-origin: center bottom;

				&:global(.is-active) {
					pointer-events: auto;
				}
			}

			@include breakpoint(desktop) {
				flex: none;
				width: 24em;
				max-width: 32vw;
				margin-right: 1.5em;
			}
		}
	}
</style>
