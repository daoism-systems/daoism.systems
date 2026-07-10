<script lang="ts">
	import { onMount, tick } from 'svelte';

	type SlideTooltipPlacement = 'above' | 'below';

	type SlideTooltipDetail = {
		visible: boolean;
		x: number;
		y: number;
		text: string | null;
		href: string | null;
		placement?: SlideTooltipPlacement;
	};

	const EDGE_MARGIN = 12;
	const TOOLTIP_GAP = 22;

	let visible = $state(false);
	let rawX = $state(0);
	let rawY = $state(0);
	let displayX = $state(0);
	let displayY = $state(0);
	let tailOffsetX = $state(0);
	let flipped = $state(false);
	let placement: SlideTooltipPlacement = $state('above');
	let text: string | null = $state(null);
	let tooltipEl: HTMLDivElement | null = $state(null);
	let viewportWidth = $state(typeof window === 'undefined' ? 0 : window.innerWidth);
	let viewportHeight = $state(typeof window === 'undefined' ? 0 : window.innerHeight);

	function clampPosition() {
		if (!tooltipEl) {
			displayX = rawX;
			displayY = rawY;
			tailOffsetX = 0;
			flipped = false;
			return;
		}
		const halfWidth = tooltipEl.offsetWidth / 2;
		const minX = halfWidth + EDGE_MARGIN;
		const maxX = viewportWidth - halfWidth - EDGE_MARGIN;
		const clampedX = maxX < minX ? viewportWidth / 2 : Math.max(minX, Math.min(maxX, rawX));
		displayX = clampedX;
		// Tail points back to the original anchor when we had to nudge the bubble.
		const offset = rawX - clampedX;
		const tailLimit = halfWidth - 14;
		tailOffsetX = Math.max(-tailLimit, Math.min(tailLimit, offset));

		// Choose vertical placement. The dispatcher's preferred side wins unless
		// it would clip the viewport and the opposite side fits.
		const tooltipHeight = tooltipEl.offsetHeight;
		const fitsAbove = rawY - TOOLTIP_GAP - tooltipHeight >= EDGE_MARGIN;
		const fitsBelow = rawY + TOOLTIP_GAP + tooltipHeight <= viewportHeight - EDGE_MARGIN;
		if (placement === 'below') {
			flipped = fitsBelow || !fitsAbove;
		} else {
			flipped = !fitsAbove && fitsBelow;
		}
		displayY = rawY;
	}

	$effect(() => {
		// Re-clamp whenever position, text, placement, or viewport changes.
		void rawX;
		void rawY;
		void text;
		void placement;
		void viewportWidth;
		void viewportHeight;
		void visible;
		tick().then(clampPosition);
	});

	onMount(() => {
		const handler = (event: Event) => {
			const detail = (event as CustomEvent<SlideTooltipDetail>).detail;
			if (!detail) return;
			const nextVisible = !!detail.visible && !!detail.text;
			if (nextVisible) {
				rawX = detail.x;
				rawY = detail.y;
				text = detail.text;
				placement = detail.placement ?? 'above';
			}
			visible = nextVisible;
		};
		const onResize = () => {
			viewportWidth = window.innerWidth;
			viewportHeight = window.innerHeight;
		};
		window.addEventListener('slide:tap-tooltip', handler);
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('slide:tap-tooltip', handler);
			window.removeEventListener('resize', onResize);
		};
	});
</script>

{#if visible && text}
	<div
		bind:this={tooltipEl}
		class="slide-tooltip"
		class:slide-tooltip--flipped={flipped}
		style={`left: ${displayX}px; top: ${displayY}px; --tail-x: ${tailOffsetX}px;`}
	>
		<p class="slide-tooltip__text">{text}</p>
		<span class="slide-tooltip__tail" aria-hidden="true"></span>
	</div>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.slide-tooltip {
		position: fixed;
		transform: translate(-50%, calc(-100% - 22px));
		pointer-events: none;
		z-index: 10001;
		max-width: calc(100vw - 24px);
		color: #efeeec;
		background-color: #e64749;
		border-radius: 0.45em;
		padding: 0.4em 0.85em 0.45em;
		font-size: 0.85rem;
		font-weight: 500;
		line-height: 1.2;
		letter-spacing: 0.01em;
		word-spacing: $word-spacing;
		text-align: center;
		word-break: break-word;
		box-shadow:
			0 8px 18px rgba(0, 0, 0, 0.22),
			0 2px 4px rgba(0, 0, 0, 0.18);
		opacity: 0;
		animation: slide-tooltip-in 0.18s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
		will-change: left, top, transform;

		@media (max-width: 768px) {
			width: 220px;
			max-width: 220px;
		}
	}

	.slide-tooltip--flipped {
		transform: translate(-50%, 22px);
		animation-name: slide-tooltip-in-flipped;
	}

	.slide-tooltip__text {
		margin: 0;
	}

	.slide-tooltip__tail {
		position: absolute;
		top: 100%;
		left: calc(50% + var(--tail-x, 0px));
		width: 0;
		height: 0;
		border-left: 7px solid transparent;
		border-right: 7px solid transparent;
		border-top: 7px solid #e64749;
		transform: translateX(-50%);
	}

	.slide-tooltip--flipped .slide-tooltip__tail {
		top: auto;
		bottom: 100%;
		border-top: none;
		border-bottom: 7px solid #e64749;
	}

	@keyframes slide-tooltip-in {
		from {
			opacity: 0;
			transform: translate(-50%, calc(-100% - 14px)) scale(0.92);
		}
		to {
			opacity: 1;
			transform: translate(-50%, calc(-100% - 22px)) scale(1);
		}
	}

	@keyframes slide-tooltip-in-flipped {
		from {
			opacity: 0;
			transform: translate(-50%, 14px) scale(0.92);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 22px) scale(1);
		}
	}
</style>
