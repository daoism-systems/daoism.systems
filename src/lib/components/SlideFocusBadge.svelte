<script lang="ts">
	import { onMount } from 'svelte';
	import { SLIDES } from '$lib/scene/ui/slideData';
	import { isMobileMotionContext, scaleMotionDuration } from '$lib/utils/animations/motion';

	// `reveal` (0..1) is the host Ventures section's own reveal progress. The badge
	// only fades in with the section — not the moment the slider group turns visible
	// (which happens mid-transition, before Ventures is actually in view).
	let { reveal = 1 } = $props();

	// Cubic-bezier equivalents of GSAP's named easings — same values the
	// ScrollTracker "pagination" reel uses, reused here so the badge text swap
	// shares the exact transition style (per design requirement).
	const POWER2_OUT_BEZIER = 'cubic-bezier(0.33, 1, 0.68, 1)';
	const POWER2_INOUT_BEZIER = 'cubic-bezier(0.65, 0, 0.35, 1)';

	type FocusDetail = { visible: boolean; index: number; text: string | null };

	const titles = SLIDES.map((slide) => slide.title);

	let visible = $state(false);
	let index = $state(0);
	let viewportEl = $state<HTMLSpanElement | null>(null);
	let trackEl = $state<HTMLSpanElement | null>(null);
	let sizeTween: Animation | null = null;
	let trackTween: Animation | null = null;
	let hasSynced = false;

	let currentTitle = $derived(titles[Math.max(0, Math.min(index, titles.length - 1))] ?? '');

	// Commit the current animated values as inline styles, then cancel — so a
	// replacement animation picks up smoothly from the current visual state
	// instead of snapping. Mirrors ScrollTracker.handOffAnimation / GSAP overwrite.
	function handOff(anim: Animation | null) {
		if (!anim) return;
		try {
			anim.commitStyles();
		} catch {
			// commitStyles can throw if the element is detached.
		}
		anim.cancel();
	}

	function shouldReduceMotion() {
		return (
			typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		);
	}

	function clampIndex(i: number) {
		return Math.max(0, Math.min(i, titles.length - 1));
	}

	function getItems(): HTMLElement[] {
		return trackEl ? (Array.from(trackEl.children) as HTMLElement[]) : [];
	}

	function getOffset(i: number) {
		const items = getItems();
		if (!items.length) return 0;
		const target = clampIndex(i);
		// Use the item's own layout position relative to the first item rather than
		// summing measured heights. offsetTop/offsetHeight are integer layout metrics,
		// so the clip-box height (getItemSize) and this translate stay exactly
		// consistent — no sub-pixel sliver of the neighbouring title bleeds in.
		return -(items[target].offsetTop - items[0].offsetTop);
	}

	function getItemSize(i: number) {
		const items = getItems();
		const item = items[clampIndex(i)];
		if (!item) return null;
		return { width: item.offsetWidth, height: item.offsetHeight };
	}

	function updateReel(i: number, animate: boolean) {
		if (!viewportEl || !trackEl) return;
		const size = getItemSize(i);
		if (!size) return;
		const y = getOffset(i);

		// Clip-box (pill) width + height tween — the label wraps, so both dimensions
		// vary. POWER2_OUT / 0.34s, matching the ScrollTracker label-width tween.
		handOff(sizeTween);
		sizeTween = null;
		if (!animate) {
			viewportEl.style.width = `${size.width}px`;
			viewportEl.style.height = `${size.height}px`;
		} else {
			const from = viewportEl.getBoundingClientRect();
			sizeTween = viewportEl.animate(
				[
					{ width: `${from.width}px`, height: `${from.height}px` },
					{ width: `${size.width}px`, height: `${size.height}px` }
				],
				{
					duration: scaleMotionDuration(0.34) * 1000,
					easing: POWER2_OUT_BEZIER,
					fill: 'both'
				}
			);
		}

		// Vertical reel translate — POWER2_INOUT / 0.72s, matching the reel tween.
		handOff(trackTween);
		trackTween = null;
		if (!animate) {
			trackEl.style.transform = `translate3d(0, ${y}px, 0)`;
			return;
		}
		const fromTransform = trackEl.style.transform || 'translate3d(0, 0, 0)';
		trackTween = trackEl.animate(
			[{ transform: fromTransform }, { transform: `translate3d(0, ${y}px, 0)` }],
			{
				duration: scaleMotionDuration(0.72) * 1000,
				easing: POWER2_INOUT_BEZIER,
				fill: 'both'
			}
		);
	}

	onMount(() => {
		const handler = (event: Event) => {
			const detail = (event as CustomEvent<FocusDetail>).detail;
			if (!detail) return;
			if (typeof detail.index === 'number') index = detail.index;
			visible = !!detail.visible;
		};
		const onResize = () => {
			if (visible && hasSynced) updateReel(index, false);
		};

		window.addEventListener('slide:focus-change', handler);
		window.addEventListener('resize', onResize);
		// Ask the slider to (re)broadcast the current focus, so a badge mounted
		// after the slider is already visible gets its initial label.
		window.dispatchEvent(new CustomEvent('slide:focus-request'));
		document.fonts?.ready.then(() => {
			if (visible && hasSynced) updateReel(index, false);
		});

		return () => {
			window.removeEventListener('slide:focus-change', handler);
			window.removeEventListener('resize', onResize);
			sizeTween?.cancel();
			trackTween?.cancel();
		};
	});

	$effect(() => {
		const activeIndex = index;

		if (!visible) {
			hasSynced = false;
			return;
		}
		if (!viewportEl || !trackEl) return;

		updateReel(activeIndex, hasSynced && !shouldReduceMotion());
		hasSynced = true;
	});
</script>

<!-- {#if visible}
	<div class="slide-focus-badge" style:opacity={reveal}>
		<span class="slide-focus-badge__viewport" aria-hidden="true" bind:this={viewportEl}>
			<span class="slide-focus-badge__track" bind:this={trackEl}>
				{#each titles as title (title)}
					<span class="slide-focus-badge__item">{title}</span>
				{/each}
			</span>
		</span>
		<span class="sr-only" aria-live="polite">{currentTitle}</span>
	</div>
{/if} -->

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.slide-focus-badge {
		position: relative;
		display: inline-flex;
		align-items: center;
		margin-top: 2.5rem;
		padding: 6.7px 17.86px;
		border-radius: 4.47px;
		background: $color-red;
		color: #fff;
		font-family: $font-main;
		font-size: 0.9375rem;
		line-height: 1.25;
		letter-spacing: 0.01em;
		word-spacing: $word-spacing;
		box-shadow:
			0 8px 18px rgba(0, 0, 0, 0.22),
			0 2px 4px rgba(0, 0, 0, 0.18);
		pointer-events: none;

		// Mobile-only: desktop keeps the existing hover cursor-text behavior.
		@include breakpoint(desktop) {
			display: none;
		}
	}

	.slide-focus-badge__viewport {
		display: block;
		overflow: hidden;
		max-width: 16rem;
		will-change: width, height;
		transform: translateZ(0);
	}

	.slide-focus-badge__track {
		display: block;
		// Fixed wrap width, independent of the viewport's animated width. Without
		// this the track fills the (mid-tween) viewport width, so measuring a new
		// title against a stale narrow viewport wraps it wrong — the source of the
		// garbled reveals. A constant width makes every item's layout deterministic.
		width: 14rem;
		will-change: transform;
	}

	.slide-focus-badge__item {
		// Clamp every title to at most two lines.
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		width: fit-content;
		max-width: 100%; // = track width (14rem)
		white-space: normal;
		word-break: break-word;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.slide-focus-badge__track {
			will-change: auto;
		}
	}
</style>
