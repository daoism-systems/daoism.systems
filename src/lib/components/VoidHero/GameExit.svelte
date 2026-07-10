<script lang="ts">
	type Props = {
		active: boolean;
		onLose: () => void;
	};

	let { active, onLose }: Props = $props();
</script>

<div class="game-exit" class:ready={active}>
	<span>Return to void?</span>
	<button type="button" onclick={onLose}>Lose</button>
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.game-exit {
		position: fixed;
		bottom: 1rem;
		left: $offset-x;
		z-index: 12;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.5rem 0.45rem 0.75rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: 0.45rem;
		background: rgba(4, 6, 8, 0.62);
		backdrop-filter: blur(18px);
		color: rgba(238, 247, 255, 0.68);
		font-family: 'IBM Plex Mono', monospace;
		font-size: 0.62rem;
		opacity: 0;
		transform: translateY(-0.5rem);
		pointer-events: none;

		&.ready {
			animation: gameExitIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
			pointer-events: all;
		}

		button {
			border: 1px solid rgba(255, 255, 255, 0.28);
			border-radius: 0.25rem;
			padding: 0.32rem 0.58rem;
			background: rgba(255, 255, 255, 0.1);
			color: #fff;
			font: inherit;
			line-height: 1;
			cursor: pointer;
			transition:
				background 0.18s ease,
				border-color 0.18s ease,
				transform 0.18s ease;

			&:hover {
				background: rgba(255, 255, 255, 0.18);
				border-color: rgba(255, 255, 255, 0.45);
				transform: translateY(-1px);
			}
		}

		// Mobile relies on the end-of-run popup's BACK TO 404 button to exit, so the
		// floating "Return to void? Lose" panel isn't needed and shouldn't crowd play.
		@include breakpoint(phone) {
			display: none;
		}
	}

	@keyframes gameExitIn {
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
