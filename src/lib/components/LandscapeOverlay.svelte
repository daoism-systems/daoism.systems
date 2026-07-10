<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { detectMob } from '$lib/utils/isMobile';

	let isTouch = $state(false);
	let isLandscape = $state(false);
	let reducedMotion = $state(false);

	// Only nag touch devices held sideways — never desktop users with a narrow
	// window. `isTouch` is re-evaluated live so exiting Chrome's device emulation
	// (mobile UA → desktop monitor) clears the overlay instead of locking it on.
	let visible = $derived(isTouch && isLandscape);

	onMount(() => {
		if (typeof window === 'undefined') return;

		// Screen Orientation API is the most reliable modern signal; matchMedia and
		// raw dimensions are progressively-degrading fallbacks.
		const screenOrientation =
			typeof screen !== 'undefined' ? (screen.orientation ?? null) : null;
		const orientationQuery = window.matchMedia?.('(orientation: landscape)') ?? null;
		// Primary input being coarse = a real touch device. This is live, unlike a
		// UA snapshot, so it updates when Chrome's device emulation is toggled.
		const coarsePointer = window.matchMedia?.('(pointer: coarse)') ?? null;
		const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;

		reducedMotion = motionQuery?.matches ?? false;

		const update = () => {
			// Fall back to UA sniffing only where (pointer) media is unsupported.
			isTouch = coarsePointer ? coarsePointer.matches : detectMob();

			if (screenOrientation) {
				isLandscape = screenOrientation.type.startsWith('landscape');
			} else if (orientationQuery) {
				isLandscape = orientationQuery.matches;
			} else {
				isLandscape = window.innerWidth > window.innerHeight;
			}
		};

		update();

		// screen.orientation is primary; matchMedia + orientationchange/resize cover
		// browsers (older iOS Safari) where it's missing or fires unreliably.
		screenOrientation?.addEventListener('change', update);
		orientationQuery?.addEventListener('change', update);
		coarsePointer?.addEventListener('change', update);
		window.addEventListener('orientationchange', update);
		window.addEventListener('resize', update);

		return () => {
			screenOrientation?.removeEventListener('change', update);
			orientationQuery?.removeEventListener('change', update);
			coarsePointer?.removeEventListener('change', update);
			window.removeEventListener('orientationchange', update);
			window.removeEventListener('resize', update);
		};
	});
</script>

{#if visible}
	<div
		class="landscape-overlay"
		class:landscape-overlay--reduced={reducedMotion}
		role="alertdialog"
		aria-modal="true"
		aria-label="Rotate your device to portrait"
		transition:fade={{ duration: reducedMotion ? 0 : 280 }}
	>
		<div class="landscape-overlay__inner">
			<svg
				class="landscape-overlay__icon"
				viewBox="0 0 24 24"
				width="64"
				height="64"
				fill="none"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<rect x="7" y="2" width="10" height="20" rx="2.2" />
				<line x1="11" y1="18.5" x2="13" y2="18.5" />
			</svg>

			<p class="landscape-overlay__title">Please rotate your device</p>
			<p class="landscape-overlay__copy">
				This experience is built for portrait. Turn your device back to vertical to continue.
			</p>
		</div>
	</div>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.landscape-overlay {
		position: fixed;
		inset: 0;
		// Above the custom cursor/tooltip (10001) so the block is absolute.
		z-index: 10002;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background-color: rgba($color-dark, 0.97);
		backdrop-filter: blur(8px);
		// Intentionally swallow taps to whatever sits beneath the message.
		pointer-events: auto;
	}

	.landscape-overlay__inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		max-width: 22rem;
		text-align: center;
	}

	.landscape-overlay__icon {
		color: $color-red;
		transform-origin: center;
		// Rock from sideways back to upright to signal the desired motion.
		animation: landscape-rotate-hint 2.4s ease-in-out infinite;
	}

	.landscape-overlay__title {
		margin: 0;
		color: #efeeec;
		font-size: 1.05rem;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.landscape-overlay__copy {
		margin: 0;
		color: $color-text;
		font-size: 0.9rem;
		line-height: 1.5;
		letter-spacing: 0.02em;
	}

	.landscape-overlay--reduced .landscape-overlay__icon {
		animation: none;
		transform: rotate(0deg);
	}

	@keyframes landscape-rotate-hint {
		0%,
		15% {
			transform: rotate(-90deg);
		}
		55%,
		100% {
			transform: rotate(0deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.landscape-overlay__icon {
			animation: none;
			transform: rotate(0deg);
		}
	}
</style>
