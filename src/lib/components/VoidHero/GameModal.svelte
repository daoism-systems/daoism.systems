<script lang="ts">
	import type { MusicState, RunHudState } from '$lib/voidhero/voidHero.helpers';
	import type { GamePhase } from '$lib/voidhero/voidHeroStore.svelte';
	import MusicMixer from './MusicMixer.svelte';

	type Props = {
		phase: GamePhase;
		music: MusicState;
		lastRunHud: RunHudState | null;
		onStart: () => void;
		onRestart: () => void;
		onClose: () => void;
		onTrackChange: (id: string) => void;
		onVolumeChange: (volume: number) => void;
	};

	let {
		phase,
		music,
		lastRunHud,
		onRestart,
		onClose,
		onTrackChange,
		onVolumeChange
	}: Props = $props();
</script>

{#if phase === 'ended' && lastRunHud}
	<div
		class="game-modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="void-hero-results-modal-title"
		onpointerdown={(e) => e.stopPropagation()}
		onpointerup={(e) => e.stopPropagation()}
	>
		<div class="game-modal__header">
			<span class="game-modal__eyebrow">Run complete</span>
			<h2 class="game-modal__title" id="void-hero-results-modal-title">{lastRunHud.score}</h2>
		</div>

		<div class="game-modal__stats">
			<div class="game-modal__row">
				<span class="game-modal__label">Stage</span>
				<span class="game-modal__value">{lastRunHud.stageName || '—'}</span>
			</div>
			<div class="game-modal__row">
				<span class="game-modal__label">Best score</span>
				<span class="game-modal__value">{lastRunHud.bestScore}</span>
			</div>
			<div class="game-modal__row">
				<span class="game-modal__label">Best stage</span>
				<span class="game-modal__value">{lastRunHud.bestStage}</span>
			</div>
		</div>

		<MusicMixer {music} idSuffix="end" {onTrackChange} {onVolumeChange} />

		<div class="game-modal__cta">
			<button type="button" class="game-modal__primary" onclick={onRestart}>Restart</button>
			<button type="button" class="game-modal__secondary" onclick={onClose}>Back to 404</button>
		</div>
	</div>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.game-modal {
		position: fixed;
		left: $offset-x-phone;
		right: $offset-x-phone;
		bottom: $offset-x-phone;
		z-index: 14;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		padding: 1.25rem 1.1rem 1.1rem;
		border: 1px solid rgba(168, 174, 188, 0.35);
		border-radius: 0.5rem;
		background: rgba(20, 22, 26, 0.78);
		backdrop-filter: blur(50px);
		color: #ffffff;
		font-family: 'IBM Plex Mono', monospace;
		box-shadow: 0 1.2rem 3rem rgba(0, 0, 0, 0.42);
		animation: gameModalIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;

		// Desktop already shows GameActionCta + GameResults; the popup is mobile-only.
		@include breakpoint(not-phone) {
			display: none;
		}
	}

	.game-modal__header {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.game-modal__eyebrow {
		font-size: 0.62rem;
		letter-spacing: 0.16em;
		word-spacing: 0.5em;
		text-transform: uppercase;
		color: rgba(238, 247, 255, 0.55);
	}

	.game-modal__title {
		margin: 0;
		font-family: $font-secondary;
		font-weight: 400;
		font-size: 2.5rem;
		line-height: 1;
		color: #ffffff;
	}

	.game-modal__stats {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.9rem 0;
		border-top: 1px solid rgba(168, 174, 188, 0.22);
		border-bottom: 1px solid rgba(168, 174, 188, 0.22);
	}

	.game-modal__row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.7rem;
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		word-spacing: 0.4em;
		text-transform: uppercase;
	}

	.game-modal__label {
		color: rgba(238, 247, 255, 0.55);
	}

	.game-modal__value {
		color: #ffffff;
	}

	.game-modal__cta {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.game-modal__primary,
	.game-modal__secondary {
		padding: 0.85rem 1rem;
		border-radius: 0.3rem;
		font: inherit;
		font-size: 0.7rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			background 0.18s ease,
			border-color 0.18s ease,
			transform 0.18s ease;
	}

	.game-modal__primary {
		border: 1px solid rgba(255, 255, 255, 0.55);
		background: rgba(255, 255, 255, 0.16);
		color: #ffffff;

		&:active {
			transform: translateY(1px);
		}
	}

	.game-modal__secondary {
		border: 1px solid rgba(168, 174, 188, 0.5);
		background: rgba(75, 78, 81, 0.18);
		color: rgba(238, 247, 255, 0.92);

		&:active {
			transform: translateY(1px);
		}
	}

	@keyframes gameModalIn {
		from {
			opacity: 0;
			transform: translateY(1rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
