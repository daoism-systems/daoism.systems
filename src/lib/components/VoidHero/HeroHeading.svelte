<script lang="ts">
	import { gradientDrift } from '$lib/utils/actions/gradientDrift';
	import type { GamePhase } from '$lib/voidhero/voidHeroStore.svelte';

	type Props = {
		phase: GamePhase;
		score: number;
		ready?: boolean;
	};

	let { phase, score, ready = false }: Props = $props();

	let headingEl = $state<HTMLHeadingElement | null>(null);
	let prevScore = -1;

	$effect(() => {
		const s = score;
		if (phase !== 'playing' || !headingEl) return;
		if (s === prevScore) return;
		prevScore = s;
		headingEl.classList.remove('score-pulse');
		void headingEl.offsetWidth;
		headingEl.classList.add('score-pulse');
	});
</script>

<h1 bind:this={headingEl} use:gradientDrift class:playing={phase !== 'idle'} class:ready class:preview={phase === 'ready'}>
	{#if phase === 'playing' || phase === 'ready'}{score}{:else}4<span class="mx-30"></span>4{/if}
</h1>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	h1 {
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

		--heading-drift-x: 0px;
		--heading-drift-y: 0px;
		--heading-focus-x: 50%;
		--heading-focus-y: 50%;
		--heading-glow-alpha: 0.18;
		--heading-shadow-alpha: 0.08;

		position: fixed;
		top: 50%;
		right: 50%;
		transform: translate(50%, -50%);
		z-index: 10;
		font-family: KH Interference TRIAL;
		font-weight: 400;
		font-size: 25rem;
		line-height: 90%;

		background-image: var(--heading-gradient);
		background-size:
			170% 170%,
			140% 140%,
			150% 150%;
		background-position:
			calc(50% + var(--heading-drift-x) * 0.8) calc(50% + var(--heading-drift-y) * 0.8),
			calc(50% + var(--heading-drift-x)) calc(50% + var(--heading-drift-y)),
			calc(50% - var(--heading-drift-x) * 0.55) calc(50% - var(--heading-drift-y) * 0.35);

		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		color: transparent;

		-webkit-text-stroke: 0.4px rgba(255, 255, 255, 0.2);
		padding: 1.2rem;
		opacity: 0;
		transform: translate(50%, -50%) scale(0.86);
		transition:
			opacity 0.85s ease 0.15s,
			transform 0.95s cubic-bezier(0.2, 0.8, 0.2, 1) 0.15s,
			filter 0.7s ease;
		transform-origin: 50% 50%;
		will-change: transform;

		&.ready {
			opacity: 1;
			transform: translate(50%, -50%) scale(1);
		}

		span {
			opacity: 0;
		}

		&.playing {
			pointer-events: none;
		}

		/* &:global(.score-pulse) {
			animation: scorePulse 0.13s ease-out;
		} */

		@include breakpoint(not-desktop) {
			font-size: 12rem;
		}
	}

	@keyframes scorePulse {
		0% {
			transform: translate(50%, -50%) scale(1);
			text-shadow: none;
		}
		45% {
			transform: translate(50%, -50%) scale(1.06);
			text-shadow: 0 0 1.4rem rgba(255, 255, 255, 0.35);
		}
		100% {
			transform: translate(50%, -50%) scale(1);
			text-shadow: none;
		}
	}
</style>
