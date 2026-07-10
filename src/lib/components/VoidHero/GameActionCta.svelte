<script lang="ts">
	import type { GamePhase } from "$lib/voidhero/voidHeroStore.svelte";


	type Props = {
		phase: GamePhase;
		onStart: () => void;
		onRestart: () => void;
		onClose: () => void;
	};

	let { phase, onStart, onRestart, onClose }: Props = $props();
</script>

{#if phase === 'ready'}
	<div class="game-action-cta game-action-cta--ready">
		<button type="button" class="game-action-cta__primary" onclick={onStart}>Start Game</button>
		<span class="game-action-cta__hint">Enter / Space</span>
	</div>
{:else if phase === 'ended'}
	<div class="game-action-cta game-action-cta--ended">
		<button type="button" class="game-action-cta__primary" onclick={onRestart}>Restart</button>
		<button type="button" class="game-action-cta__secondary" onclick={onClose}>Close</button>
	</div>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.game-action-cta {
		position: fixed;
		top: 72%;
		left: 50%;
		z-index: 13;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.55rem;
		opacity: 0;
		transform: translate(-50%, 0.4rem);
		color: #fff;
		font-family: 'IBM Plex Mono', monospace;
		text-align: center;
		animation: gameActionCtaIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;

		&--ended {
			flex-direction: row;
			gap: 0.5rem;
		}

		// Mobile drops the 'ended' variant (handled by GameModal) and pins the
		// 'ready' START GAME button to the bottom per design screen 2.
		@include breakpoint(phone) {
			&--ended {
				display: none;
			}

			&--ready {
				top: auto;
				bottom: calc(#{$offset-y-phone} + 1.2rem);
				width: calc(100% - #{$offset-x-phone} * 2);
			}
		}
	}

	@include breakpoint(phone) {
		.game-action-cta--ready .game-action-cta__primary {
			width: 100%;
			padding: 0.95rem 1rem;
		}

		.game-action-cta__hint {
			display: none;
		}
	}

	@keyframes gameActionCtaIn {
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	.game-action-cta__primary,
	.game-action-cta__secondary {
		border-radius: 0.3rem;
		padding: 0.75rem 1.6rem;
		font: inherit;
		font-size: 0.78rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			background 0.18s ease,
			border-color 0.18s ease,
			transform 0.18s ease,
			box-shadow 0.18s ease;
	}

	.game-action-cta__primary {
		border: 1px solid rgba(255, 255, 255, 0.55);
		background: rgba(255, 255, 255, 0.16);
		color: #fff;

		&:hover {
			background: rgba(255, 255, 255, 0.28);
			border-color: rgba(255, 255, 255, 0.85);
			box-shadow: 0 0 0.9rem rgba(151, 222, 255, 0.32);
			transform: translateY(-1px);
		}

		&:active {
			transform: translateY(0);
		}
	}

	.game-action-cta__secondary {
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: rgba(255, 255, 255, 0.04);
		color: rgba(238, 247, 255, 0.85);

		&:hover {
			background: rgba(255, 255, 255, 0.1);
			border-color: rgba(255, 255, 255, 0.4);
			color: #fff;
			transform: translateY(-1px);
		}

		&:active {
			transform: translateY(0);
		}
	}

	.game-action-cta__hint {
		font-size: 0.58rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: rgba(238, 247, 255, 0.45);
	}
</style>
