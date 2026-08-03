<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { headingReveal } from '$lib/utils/animations/headingReveal';
	import { isLowPerformanceTier } from '$lib/utils/animations/motion';
	import {
		ensureHeadingFilterDefs,
		nextHeadingEffectInstanceId,
		playHeadingFilterEffectOnElement,
		playHeadingFilterEffectReverseOnElement,
		registerHeadingController,
		registerHeadingEffectsConsoleApi,
		resetHeadingFilterEffectOnElement,
		unregisterHeadingController,
		type HeadingFilterEffectId
	} from '$lib/utils/UiInAndOutEffect';
	type HeadingRevealConfig = Partial<NonNullable<Parameters<typeof headingReveal>[1]>>;
	const HEADING_EFFECT_ATTR = 'data-heading-effect-id';

	let {
		text = [''],
		sup = '',
		position = 'top',
		className = '',
		progress = 0,
		onBeforeRevealEnd = undefined,
		beforeRevealEndOffset = 0.2,
		headingRevealConfig = {} as HeadingRevealConfig
	} = $props();

	let effectiveProgress = $derived(
		typeof headingRevealConfig.progress === 'number' ? headingRevealConfig.progress : progress
	);

	// `effectiveProgress` is a single-peak reveal curve: it rises 0→1, HOLDS at 1
	// through the middle of the section, then falls 1→0. "Shown" means past the
	// midpoint (so it stays visible through the whole hold). The old `> 0 && < 1`
	// treated the hold (=== 1) as not-visible, which blinked the reduced-motion
	// heading out mid-section and back in while hiding — a double show/hide.
	const VISIBLE_THRESHOLD = 0.5;
	let isVisible = $derived(effectiveProgress >= VISIBLE_THRESHOLD);
	// Seeded eagerly (not in onMount) so a low-tier Heading mounted mid-scroll
	// never builds the char pipeline only to throw it away a frame later.
	// Headings stay per-char on mobile: at ~8–15 chars each they're affordable —
	// the mobile perf levers are block-mode paragraphs (textReveal) and the
	// filter-free char keyframes, not the heading char count.
	let isReducedHeading = $state(typeof window !== 'undefined' && isLowPerformanceTier());
	let headingEl = $state<HTMLHeadingElement | null>(null);
	let driftFrame: number | null = null;
	let currentDriftX = 0;
	let currentDriftY = 0;
	let targetDriftX = 0;
	let targetDriftY = 0;
	let isPointerActive = false;
	let headingEffectInstanceId = '';
	let headingFilterTimeline: ReturnType<typeof playHeadingFilterEffectOnElement> | null = null;
	const driftSmoothing = 0.11;
	const driftRange = 34;
	const revealOptions = $derived({
		trigger: true,
		reversed: !isVisible,
		onBeforeRevealEnd,
		beforeRevealEndOffset,
		...headingRevealConfig
	});

	onMount(() => {
		isReducedHeading = isLowPerformanceTier();
		applyHeadingSurface(0, 0);
		ensureHeadingFilterDefs();
		registerHeadingEffectsConsoleApi();

		if (headingEl) {
			headingEffectInstanceId = nextHeadingEffectInstanceId();
			headingEl.setAttribute(HEADING_EFFECT_ATTR, headingEffectInstanceId);
			registerHeadingController(headingEffectInstanceId, {
				element: headingEl,
				play: playHeadingFilterEffect,
				playReverse: playHeadingFilterEffectReverse,
				reset: resetHeadingFilterEffect
			});
		}

		const handleWindowPointerMove = (event: PointerEvent) => {
			updatePointerDrift(event);
		};

		const handleWindowPointerLeave = () => {
			resetPointerDrift();
		};

		window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
		window.addEventListener('pointerleave', handleWindowPointerLeave);

		return () => {
			window.removeEventListener('pointermove', handleWindowPointerMove);
			window.removeEventListener('pointerleave', handleWindowPointerLeave);
		};
	});

	onDestroy(() => {
		if (driftFrame !== null) {
			cancelAnimationFrame(driftFrame);
		}

		resetHeadingFilterEffect();
		if (headingEffectInstanceId) {
			unregisterHeadingController(headingEffectInstanceId);
		}
	});

	function resetHeadingFilterEffect() {
		if (!headingEl) return;

		resetHeadingFilterEffectOnElement(headingEl, headingFilterTimeline);
		headingFilterTimeline = null;
	}

	function playHeadingFilterEffect(effectId: HeadingFilterEffectId) {
		if (!headingEl) return;

		resetHeadingFilterEffect();
		headingFilterTimeline = playHeadingFilterEffectOnElement(headingEl, effectId);
	}

	function playHeadingFilterEffectReverse(effectId: HeadingFilterEffectId) {
		if (!headingEl) return;

		resetHeadingFilterEffect();
		headingFilterTimeline = playHeadingFilterEffectReverseOnElement(headingEl, effectId);
	}

	function applyHeadingSurface(x: number, y: number) {
		if (!headingEl) return;

		const focusX = 50 + (x / driftRange) * 18;
		const focusY = 50 + (y / driftRange) * 24;
		const glowStrength = isPointerActive
			? 0.22 + Math.min(Math.hypot(x, y) / driftRange, 1) * 0.16
			: 0.18;
		const shadowStrength = isPointerActive
			? 0.12 + Math.min(Math.hypot(x, y) / driftRange, 1) * 0.1
			: 0.08;

		// OPTIMIZED: Using Math.round and limiting decimals heavily reduces string parsing & layout calculation times
		headingEl.style.setProperty('--heading-drift-x', `${Math.round(x)}px`);
		headingEl.style.setProperty('--heading-drift-y', `${Math.round(y)}px`);
		headingEl.style.setProperty('--heading-focus-x', `${Math.round(focusX)}%`);
		headingEl.style.setProperty('--heading-focus-y', `${Math.round(focusY)}%`);
		headingEl.style.setProperty('--heading-glow-alpha', glowStrength.toFixed(2));
		headingEl.style.setProperty('--heading-shadow-alpha', shadowStrength.toFixed(2));
	}

	function tickGradientDrift() {
		const deltaX = targetDriftX - currentDriftX;
		const deltaY = targetDriftY - currentDriftY;

		currentDriftX += deltaX * driftSmoothing;
		currentDriftY += deltaY * driftSmoothing;
		applyHeadingSurface(currentDriftX, currentDriftY);

		if (Math.abs(deltaX) < 0.08 && Math.abs(deltaY) < 0.08) {
			currentDriftX = targetDriftX;
			currentDriftY = targetDriftY;
			applyHeadingSurface(currentDriftX, currentDriftY);
			driftFrame = null;
			return;
		}

		driftFrame = requestAnimationFrame(tickGradientDrift);
	}

	function ensureGradientDrift() {
		if (driftFrame !== null) return;
		driftFrame = requestAnimationFrame(tickGradientDrift);
	}

	function updatePointerDrift(event: PointerEvent) {
		if (!headingEl || event.pointerType === 'touch') return;

		const normalizedX = event.clientX / window.innerWidth - 0.5;
		const normalizedY = event.clientY / window.innerHeight - 0.5;

		targetDriftX = normalizedX * driftRange;
		targetDriftY = normalizedY * driftRange;

		if (!isPointerActive) {
			isPointerActive = true;
			currentDriftX = targetDriftX * 0.2;
			currentDriftY = targetDriftY * 0.2;
			applyHeadingSurface(currentDriftX, currentDriftY);
		}

		ensureGradientDrift();
	}

	function resetPointerDrift() {
		isPointerActive = false;
		targetDriftX = 0;
		targetDriftY = 0;
		ensureGradientDrift();
	}
</script>


{#if isReducedHeading}
	<h2
		bind:this={headingEl}
		class="{className} {position === 'bottom' ? 'bottom' : ''} ios-reduced-heading"
		class:ios-reduced-heading--visible={isVisible}
	>
		<div aria-label={text.join(' ')}>
			{#each text as line}
				<span class="text-line">{line}</span>
			{/each}
		</div>
	</h2>
	{#if sup}
		<sup
			class="text-sm"
			style="opacity: {effectiveProgress >= 1 ? 0 : 1}; transform: {effectiveProgress >= 1 ? 'scale(0.6)' : 'scale(1)'}"
			>[<span>{sup}</span>]
		</sup>
	{/if}
{:else}
	<h2
		bind:this={headingEl}
		class="{className} {position === 'bottom' ? 'bottom' : ''}"
		use:headingReveal={revealOptions}
	>
		<div aria-label={text.join(' ')}>
			{#each text as line}
				<span class="text-line">{line}</span>
			{/each}
		</div>
	</h2>

	{#if sup}
		<sup
			class="text-sm"
			style="opacity: {effectiveProgress >= 1 ? 0 : 1}; transform: {effectiveProgress >= 1
				? 'scale(0.6)'
				: 'scale(1)'}"
		>
			[<span>{sup}</span>]
		</sup>
	{/if}
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	h2 {
		--heading-gradient: linear-gradient(0deg, rgb(210 215 225), rgb(210 215 225));
		--heading-drift-x: 0px;
		--heading-drift-y: 0px;
		--heading-focus-x: 50%;
		--heading-focus-y: 50%;
		--heading-glow-alpha: 0.18;
		--heading-shadow-alpha: 0.08;
		position: relative;
		font-size: 80px;
		line-height: 90%;
		margin-left: -4px;

		@media (max-width: 550px) {
			font-size: clamp(2rem, 10.4vw, 3rem);
			line-height: 0.9;
		}

		:global(.text-line) {
			display: block;
			width: fit-content;
			overflow: visible;
			margin-bottom: 0;

			@include breakpoint(not-desktop) {
				line-height: 0.9;
			}
		}

		:global(.char) {
			transform-style: preserve-3d;

			background-image: var(--heading-gradient);
			background-repeat: no-repeat;
			background-size:
				175% 175%,
				155% 155%,
				145% 145%;
			background-position:
				calc(50% + var(--heading-drift-x) * 0.8) calc(50% + var(--heading-drift-y) * 0.8),
				calc(50% + var(--heading-drift-x)) calc(50% + var(--heading-drift-y)),
				calc(50% - var(--heading-drift-x) * 0.55) calc(50% - var(--heading-drift-y) * 0.35);
			-webkit-background-clip: text;
			-webkit-text-fill-color: transparent;
			background-clip: text;
			color: transparent;
			-webkit-text-stroke: 0.35px rgba(221, 229, 246, 0.22);
		}

		@include breakpoint(not-desktop) {
			&.mobile-padded {
				padding-left: 1.68rem;
			}

			&.mobile-top {
				top: 2rem;
			}
		}
	}

	h2.heading-inverted {
		--heading-gradient:
			radial-gradient(
				circle at var(--heading-focus-x, 50%) var(--heading-focus-y, 50%),
				rgba(255, 255, 255, calc(var(--heading-glow-alpha, 0.18) + 0.15)) 0%,
				rgba(255, 255, 255, calc(var(--heading-glow-alpha, 0.18) * 0.4)) 25%,
				rgba(0, 0, 0, 0) 60%
			),
			linear-gradient(
				118deg,
				rgba(60, 60, 60, 0.95) 0%,
				rgba(15, 15, 15, 0.98) 28%,
				rgba(45, 45, 45, 0.94) 52%,
				rgba(5, 5, 5, 1) 72%,
				rgba(55, 55, 55, 0.95) 100%
			),
			linear-gradient(
				128deg,
				rgba(255, 255, 255, 0) 10%,
				rgba(255, 255, 255, 0.22) 40%,
				rgba(255, 255, 255, 0.05) 55%,
				rgba(255, 255, 255, 0) 85%
			);
	}

	h2.heading-inverted :global(.char) {
		-webkit-text-stroke: 0.4px rgba(255, 255, 255, 0.2);
	}

	h2.heading-inverted.ios-reduced-heading {
		.text-line {
			-webkit-text-stroke: 0.4px rgba(255, 255, 255, 0.2);
		}
	}

	h2.ios-reduced-heading {
		opacity: 0;
		transform: translateY(2rem);
		transition:
			opacity 420ms cubic-bezier(0.22, 1, 0.36, 1),
			transform 420ms cubic-bezier(0.22, 1, 0.36, 1);

		.text-line {
			background-image: var(--heading-gradient);
			background-repeat: no-repeat;
			background-size:
				175% 175%,
				155% 155%,
				145% 145%;
			background-position:
				calc(50% + var(--heading-drift-x) * 0.8) calc(50% + var(--heading-drift-y) * 0.8),
				calc(50% + var(--heading-drift-x)) calc(50% + var(--heading-drift-y)),
				calc(50% - var(--heading-drift-x) * 0.55) calc(50% - var(--heading-drift-y) * 0.35);
			-webkit-background-clip: text;
			-webkit-text-fill-color: transparent;
			background-clip: text;
			color: transparent;
			-webkit-text-stroke: 0.35px rgba(221, 229, 246, 0.22);
		}
	}

	h2.ios-reduced-heading.ios-reduced-heading--visible {
		opacity: 1;
		transform: translateY(0);
	}

	h2.bottom {
		position: absolute;
		bottom: 0;
		width: fit-content;
	}

	h2.partners sup {
		right: 1rem;
	}

	sup {
		--sup-shift-x: -50%;
		position: fixed;
		top: auto;
		bottom: 5rem;
		right: 20px;
		font-family: $font-main;
		color: $color-grey-300;
		transition:
			opacity 0.5s ease-in-out 0.5s,
			transform 0.5s ease-in-out 0.5s;

		@media (max-width: 1024px) {
			bottom: 6rem;
			right: 0;
			font-size: 1rem;
		}

		span {
			display: inline-block;
			padding: 0 0.15rem;
		}
	}
</style>
