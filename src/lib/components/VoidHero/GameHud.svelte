<script lang="ts">
	import type { MusicState, RunHudState } from '$lib/voidhero/voidHero.helpers';
	import MusicMixer from './MusicMixer.svelte';

	type Props = {
		runHud: RunHudState;
		music: MusicState;
		onTrackChange: (id: string) => void;
		onVolumeChange: (volume: number) => void;
		onMuteToggle: () => void;
	};

	let { runHud, music, onTrackChange, onVolumeChange, onMuteToggle }: Props = $props();
</script>

<div
	class="game-hud ready"
	onpointerdown={(e) => e.stopPropagation()}
	onpointerup={(e) => e.stopPropagation()}
	role="presentation"
>
	<span class="game-hud__eyebrow">
		Void Hero
		<button
			type="button"
			class="game-hud__mute"
			class:active={music.muted}
			title={music.muted ? 'Muted (press M)' : 'Press M to mute'}
			aria-label={music.muted ? 'Unmute' : 'Mute'}
			aria-pressed={music.muted}
			onclick={(e) => {
				onMuteToggle();
				e.currentTarget.blur();
			}}>M</button
		>
	</span>

	{#if runHud.progressionActive && runHud.stageName}
		<div class="game-hud__stage" aria-label="Stage progress">
			<span class="game-hud__stage-name">{runHud.stageName}</span>
			<div class="game-hud__progress" aria-hidden="true">
				<div
					class="game-hud__progress-fill"
					style="width: {Math.min(100, Math.max(0, runHud.stageProgress * 100))}%"
				></div>
			</div>
		</div>
	{/if}
	<div
		class="game-hud__lives"
		aria-label="Lives remaining: {runHud.lives} of {runHud.maxLives}"
	>
		{#each Array.from({ length: runHud.maxLives }, (_, i) => i) as i (i)}
			{@const stage = Math.min(5, Math.max(1, runHud.heartStages[i] ?? (i < runHud.lives ? 1 : 5)))}
			<span class="game-hud__heart" class:lit={i < runHud.lives}>
				<img src="/textures/HeartBar/HeartStage{stage}.png" alt="heart icon" />
			</span>
		{/each}
	</div>
	<MusicMixer {music} idSuffix="hud" {onTrackChange} {onVolumeChange} />
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.game-hud {
		position: fixed;
		top: calc(#{$offset-x} + 4.4rem);
		left: $offset-x;
		z-index: 12;
		width: 17rem;
		display: grid;
		gap: 0.55rem;
		padding: 1rem 1.1rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.5rem;
		background:
			linear-gradient(135deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.015)),
			rgba(4, 6, 8, 0.52);
		opacity: 0;
		transform: translateY(-0.7rem);
		pointer-events: none;
		animation: gameHudIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;

		&.ready {
			pointer-events: all;
		}

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

	.game-hud__eyebrow {
		font-size: 0.67rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.72);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.game-hud__mute {
		display: inline-grid;
		place-items: center;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 0.32rem;
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 0.25rem;
		font-family: inherit;
		font-size: 0.6rem;
		letter-spacing: 0;
		color: rgba(255, 255, 255, 0.45);
		background: rgba(255, 255, 255, 0.04);
		cursor: pointer;
		transition:
			color 0.18s ease,
			border-color 0.18s ease,
			background 0.18s ease;

		&:hover {
			color: rgba(255, 255, 255, 0.85);
			border-color: rgba(255, 255, 255, 0.4);
			background: rgba(255, 255, 255, 0.1);
		}

		&.active {
			color: #fff;
			border-color: rgba(255, 255, 255, 0.55);
			background: rgba(255, 255, 255, 0.16);
			text-decoration: line-through;
		}
	}

	.game-hud__keys {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.28rem;
		margin-top: 0.25rem;

		span {
			display: grid;
			place-items: center;
			height: 1.55rem;
			border: 1px solid rgba(255, 255, 255, 0.2);
			border-radius: 0.25rem;
			background: rgba(255, 255, 255, 0.08);
			color: #ffffff;
			font-family: 'IBM Plex Mono', monospace;
			font-size: 0.76rem;
		}
	}

	.game-hud__stage {
		display: grid;
		gap: 0.24rem;
		margin-top: 0.5rem;
		font-family: 'IBM Plex Mono', monospace;
	}

	.game-hud__stage-name {
		font-size: 0.66rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: rgba(238, 247, 255, 0.92);
	}

	.game-hud__progress {
		position: relative;
		height: 3px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		overflow: hidden;
	}

	.game-hud__progress-fill {
		position: absolute;
		inset: 0 auto 0 0;
		height: 100%;
		background: linear-gradient(90deg, rgba(151, 222, 255, 0.78), #ffffff);
		box-shadow: 0 0 0.55rem rgba(151, 222, 255, 0.45);
		transition: width 0.18s linear;
	}

	.game-hud__lives {
		display: flex;
		gap: 0.32rem;
		margin-top: 0.45rem;
		align-items: center;
	}

	.game-hud__heart {
		display: inline-grid;
		place-items: center;
		width: 1.25rem;
		transition:
			transform 0.2s ease;
	}
	.game-hud__heart img {
		width: 100%;
		object-fit: contain;
	}
</style>
