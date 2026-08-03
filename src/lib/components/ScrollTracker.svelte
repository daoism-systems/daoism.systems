<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { canScroll } from '$lib/store.svelte';
	import { isMobileMotionContext, scaleMotionDuration } from '$lib/utils/animations/motion';

	// Cubic-bezier equivalents of GSAP's named easings.
	const POWER2_OUT_BEZIER = 'cubic-bezier(0.33, 1, 0.68, 1)';
	const POWER2_INOUT_BEZIER = 'cubic-bezier(0.65, 0, 0.35, 1)';

	type Props = {
		number?: number;
		label?: string;
		sectionLabels?: string[];
		globalProgress?: number;
		sectionStarts?: number[];
	};

	let { number = 0, label = '', sectionLabels = [], globalProgress = 0, sectionStarts = [] }: Props =
		$props();

	let numberViewport = $state<HTMLSpanElement | null>(null);
	let labelViewport = $state<HTMLSpanElement | null>(null);
	let numberTrack = $state<HTMLSpanElement | null>(null);
	let labelTrack = $state<HTMLSpanElement | null>(null);
	let labelWidthTween: Animation | null = null;
	let reelsTweens: Animation[] = [];
	let hasSyncedReels = false;

	// Hand-off helper: commit the current animated values as inline styles, then
	// cancel — so a replacement animation picks up smoothly from the current
	// visual state instead of snapping. Mirrors GSAP `overwrite: true`.
	function handOffAnimation(anim: Animation | null) {
		if (!anim) return;
		try {
			anim.commitStyles();
		} catch {
			// commitStyles can throw if the element is detached or the effect is invalid.
		}
		anim.cancel();
	}

	function cancelReelsTweens() {
		for (const a of reelsTweens) handOffAnimation(a);
		reelsTweens = [];
	}

	let trackerLabels = $derived(sectionLabels.filter((_, index) => index > 0));
	let trackerStarts = $derived(sectionStarts.filter((_, index) => index > 0));
	let trackerNumbers = $derived(
		trackerLabels.map((_, index) => (index + 1).toString().padStart(2, '0'))
	);
	let trackerFirstStart = $derived(trackerStarts[0] ?? 0);
	let isTrackerActive = $derived(
		trackerStarts.length ? globalProgress >= trackerFirstStart - 0.0001 : number > 0
	);
	let fallbackTrackerIndex = $derived(Math.max(0, Math.min(number - 1, trackerLabels.length - 1)));
	let canUseProgressIndex = $derived(
		trackerStarts.length > 0 && trackerStarts.length === trackerLabels.length
	);
	let progressTrackerIndex = $derived(getProgressTrackerIndex(globalProgress, trackerStarts));
	let trackerIndex = $derived(canUseProgressIndex ? progressTrackerIndex : fallbackTrackerIndex);
	let currentTrackerLabel = $derived(trackerLabels[trackerIndex] ?? label);

	function getOffset(track: HTMLElement | null, index: number) {
		if (!track) return 0;

		const items = Array.from(track.children) as HTMLElement[];
		if (!items.length) return 0;

		const itemIndex = Math.max(0, Math.min(index, items.length - 1));
		const firstItem = items[0];
		if (!firstItem) return 0;

		return -firstItem.getBoundingClientRect().height * itemIndex;
	}

	function shouldReduceMotion() {
		return (
			typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		);
	}

	function getProgressTrackerIndex(progress: number, starts: number[]) {
		if (!starts.length) return 0;

		for (let i = starts.length - 1; i >= 0; i--) {
			if (progress >= starts[i]) return i;
		}

		return 0;
	}

	function getCurrentLabelWidth(index: number) {
		if (!labelTrack) return null;

		const items = Array.from(labelTrack.children) as HTMLElement[];
		if (!items.length) return null;

		const activeItem = items[Math.max(0, Math.min(index, items.length - 1))];
		if (!activeItem) return null;

		const width = Math.ceil(activeItem.scrollWidth);
		return width > 0 ? width : null;
	}

	function updateReels(index: number, animate: boolean) {
		if (!numberViewport || !labelViewport || !numberTrack || !labelTrack) return;
		const durationFactor = isMobileMotionContext() ? 1.18 : 1;

		const numberY = getOffset(numberTrack, index);
		const labelY = getOffset(labelTrack, index);
		const labelWidth = getCurrentLabelWidth(index);

		if (labelWidth !== null) {
			handOffAnimation(labelWidthTween);
			labelWidthTween = null;
			if (!animate) {
				labelViewport.style.width = `${labelWidth}px`;
			} else {
				const fromWidth = labelViewport.getBoundingClientRect().width;
				labelWidthTween = labelViewport.animate(
					[{ width: `${fromWidth}px` }, { width: `${labelWidth}px` }],
					{
						duration: scaleMotionDuration(0.34, durationFactor) * 1000,
						easing: POWER2_OUT_BEZIER,
						fill: 'both'
					}
				);
			}
		}

		cancelReelsTweens();

		if (!animate) {
			numberTrack.style.transform = `translate3d(0, ${numberY}px, 0)`;
			labelTrack.style.transform = `translate3d(0, ${labelY}px, 0)`;
			return;
		}

		const fromNumberTransform = numberTrack.style.transform || `translate3d(0, 0, 0)`;
		const fromLabelTransform = labelTrack.style.transform || `translate3d(0, 0, 0)`;

		const numberAnim = numberTrack.animate(
			[
				{ transform: fromNumberTransform },
				{ transform: `translate3d(0, ${numberY}px, 0)` }
			],
			{
				duration: scaleMotionDuration(0.58, durationFactor) * 1000,
				easing: POWER2_INOUT_BEZIER,
				fill: 'both'
			}
		);
		const labelAnim = labelTrack.animate(
			[
				{ transform: fromLabelTransform },
				{ transform: `translate3d(0, ${labelY}px, 0)` }
			],
			{
				duration: scaleMotionDuration(0.72, durationFactor) * 1000,
				easing: POWER2_INOUT_BEZIER,
				fill: 'both'
			}
		);
		reelsTweens = [numberAnim, labelAnim];
	}

	onMount(() => {
		const handleResize = () => {
			if (isTrackerActive && hasSyncedReels) updateReels(trackerIndex, false);
		};

		window.addEventListener('resize', handleResize);
		document.fonts?.ready.then(() => {
			if (isTrackerActive && hasSyncedReels) updateReels(trackerIndex, false);
		});

		return () => {
			window.removeEventListener('resize', handleResize);
			labelWidthTween?.cancel();
			labelWidthTween = null;
			for (const a of reelsTweens) a.cancel();
			reelsTweens = [];
		};
	});

	$effect(() => {
		const activeIndex = trackerIndex;

		if (!isTrackerActive) {
			hasSyncedReels = false;
			return;
		}

		if (!trackerLabels.length) return;
		if (!numberViewport || !labelViewport || !numberTrack || !labelTrack) return;

		updateReels(activeIndex, hasSyncedReels && !shouldReduceMotion());
		hasSyncedReels = true;
	});
</script>

<div class="scroll-tracker {!isTrackerActive ? 'scroll-tracker--empty' : ''}">
	{#if !isTrackerActive && $canScroll && label !== ''}
		<span class="scroll-down-mask desktop-only text-base" in:fade={{ duration: 300 }}>
			<span class="scroll-down-text">{label}</span>
		</span>
	{:else if isTrackerActive && currentTrackerLabel !== ''}
		<div class="scroll-tracker__wrap">
			<span class="reel-viewport reel-viewport--number" aria-hidden="true" bind:this={numberViewport}>
				<span class="reel-track" bind:this={numberTrack}>
					{#each trackerNumbers as item (item)}
						<span class="reel-track__item">{item}</span>
					{/each}
				</span>
			</span>
			<span class="diamond">◆</span>
			<span
				class="reel-viewport reel-viewport--label"
				aria-live="polite"
				bind:this={labelViewport}
			>
				<span class="reel-track" bind:this={labelTrack}>
					{#if trackerLabels.length}
						{#each trackerLabels as item (item)}
							<span class="reel-track__item">{item}</span>
						{/each}
					{:else}
						<span class="reel-track__item">{label}</span>
					{/if}
				</span>
			</span>
		</div>
	{/if}
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.scroll-tracker {
		position: fixed;
		z-index: 101;
		color: #A8AEBC;
		font-size: 0.875rem;
		word-spacing: $word-spacing;
		font-weight: 400;
		user-select: none;



		@include breakpoint(desktop) {
			bottom: $offset-x;
			left: $offset-x;
		}

		@include breakpoint(not-desktop) {
			--mobile-audio-size: 52px;
			--mobile-tracker-height: 2rem;
			top: auto;
			left: $offset-x-phone;
			bottom: calc(
				1.2rem + env(safe-area-inset-bottom, 0px) +
					((var(--mobile-audio-size) - var(--mobile-tracker-height)) / 2)
			);
		}

		&__wrap {
			background: $color-grey-600;
			border: 0.5px solid rgba($color-grey-300, 0.3);
			padding: 0.4rem 1rem;
			box-shadow: 0 1px 8px rgba(0, 0, 0, 0.04);
			border-radius: 0.25rem;
			backdrop-filter: blur(50px);
			display: flex;
			height: 1.75rem;
			padding: 0.375rem 1rem;
			align-items: center;
			gap: 1rem;

			@include breakpoint(not-desktop) {
				min-height: var(--mobile-tracker-height);
				padding: 0 1rem;
			}
		}

		&--empty {
			background: transparent;
			border: none;
			padding: 0;
		}
	}

	.reel-viewport {
		display: inline-flex;
		overflow: hidden;
		height: 1.25em;
		line-height: 1.25;
		position: relative;
		contain: paint;
		transform: translateZ(0);
		-webkit-transform: translateZ(0);
	}

	.reel-viewport--number {
		width: 2ch;
		font-variant-numeric: tabular-nums;
	}

	.reel-track {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		will-change: transform;
	}

	.reel-track__item {
		display: inline-flex;
		align-items: center;
		height: 1.25em;
		white-space: nowrap;
	}

	.reel-viewport--label .reel-track__item {
		letter-spacing: 0.01em;
	}

	.diamond {
		font-size: 0.5rem;
		color: #c6c9d6;
		opacity: 0.7;
	}

	.scroll-down-mask {
		display: inline-block;
		overflow: hidden;
		line-height: 1.2;
	}

	.scroll-down-text {
		display: inline-block;
		transform: translateZ(0);
		-webkit-transform: translateZ(0);
		animation: scroll-down-cycle 2.2s ease-in-out infinite;
	}

	@keyframes scroll-down-cycle {
		0%,
		22% {
			transform: translateY(0);
		}
		42% {
			transform: translateY(118%);
		}
		49% {
			transform: translateY(136%);
		}
		50% {
			transform: translateY(-136%);
		}
		76% {
			transform: translateY(12%);
		}
		87% {
			transform: translateY(-4%);
		}
		100% {
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.reel-track {
			will-change: auto;
		}

		.scroll-down-text {
			animation: none;
		}
	}

	@include breakpoint(small-phone) {
		.scroll-tracker {
			--mobile-audio-size: 48px;
		}
	}

</style>
