<script lang="ts">
	import type { RunHudState } from "$lib/voidhero/voidHero.helpers";


	type Props = {
		lastRunHud: RunHudState;
	};

	let { lastRunHud }: Props = $props();
</script>

<aside
	class="game-results"
	aria-labelledby="void-hero-results-title"
	onpointerdown={(e) => e.stopPropagation()}
	onpointerup={(e) => e.stopPropagation()}
>
	<span class="game-results__eyebrow">Run complete</span>
	<h2 class="game-results__title" id="void-hero-results-title">{lastRunHud.score}</h2>
	<div class="game-results__rows">
		<div class="game-results__row">
			<span class="game-results__label">Stage</span>
			<span class="game-results__value">{lastRunHud.stageName || '—'}</span>
		</div>
		<div class="game-results__row">
			<span class="game-results__label">Best score</span>
			<span class="game-results__value">{lastRunHud.bestScore}</span>
		</div>
		<div class="game-results__row">
			<span class="game-results__label">Best stage</span>
			<span class="game-results__value">{lastRunHud.bestStage}</span>
		</div>
	</div>
</aside>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.game-results {
		position: fixed;
		top: calc(#{$offset-x} + 4.4rem);
		right: $offset-x;
		z-index: 12;
		min-width: 13rem;
		display: grid;
		gap: 0.5rem;
		padding: 1rem 1.1rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.5rem;
		background:
			linear-gradient(135deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.015)),
			rgba(4, 6, 8, 0.52);
		color: #fff;
		font-family: 'IBM Plex Mono', monospace;
		text-align: left;
		animation: gameHudIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		opacity: 0;
		transform: translateY(-0.7rem);

		@include breakpoint(phone) {
			display: none;
		}
	}

	@keyframes gameHudIn {
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.game-results__eyebrow {
		font-size: 0.6rem;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: rgba(238, 247, 255, 0.55);
	}

	.game-results__title {
		margin: 0;
		font-family: KH Interference TRIAL;
		font-weight: 400;
		font-size: 2rem;
		line-height: 1;
		color: #fff;
	}

	.game-results__rows {
		display: grid;
		gap: 0.32rem;
		margin-top: 0.25rem;
	}

	.game-results__row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		font-size: 0.68rem;
	}

	.game-results__label {
		color: rgba(238, 247, 255, 0.5);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.game-results__value {
		color: #fff;
	}
</style>
