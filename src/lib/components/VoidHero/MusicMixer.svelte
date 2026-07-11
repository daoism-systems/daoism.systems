<script lang="ts">
	import type { MusicState } from '$lib/voidhero/voidHero.helpers';

	type Props = {
		music: MusicState;
		idSuffix: string;
		onTrackChange: (id: string) => void;
		onVolumeChange: (volume: number) => void;
	};

	let { music, idSuffix, onTrackChange, onVolumeChange }: Props = $props();

	// Mute is represented as the leftmost "disabled" tile — selecting it sets the
	// track to `none` (the engine's silent track).
	const TRACK_ART: Record<string, string> = {
		synthwave: '/textures/voidhero/tracks/synthwave.svg',
		oldskool: '/textures/voidhero/tracks/oldskool.svg',
		'space-ranger': '/textures/voidhero/tracks/space-ranger.svg'
	};
	const NAMED_TRACK_IDS = ['synthwave', 'oldskool', 'space-ranger'] as const;

	const namedTracks = $derived(
		NAMED_TRACK_IDS.map((id) => music.tracks.find((t) => t.id === id)).filter(
			(t): t is NonNullable<typeof t> => Boolean(t)
		)
	);

	const isMuted = $derived(music.currentTrackId === 'none' || music.muted);
</script>

{#if music.tracks.length > 0}
	<div class="mixer">
		<div class="mixer__section">
			<span class="mixer__label">Track</span>
			<div class="mixer__tiles">
				<button
					type="button"
					class="mixer__tile mixer__tile--mute"
					class:active={isMuted}
					aria-label="Mute"
					aria-pressed={isMuted}
					onclick={() => onTrackChange('none')}
				>
					<img src="/textures/voidhero/tracks/disabled.svg" alt="" />
				</button>
				{#each namedTracks as track (track.id)}
					<button
						type="button"
						class="mixer__tile"
						class:active={!isMuted && music.currentTrackId === track.id}
						aria-label={track.label}
						aria-pressed={!isMuted && music.currentTrackId === track.id}
						onclick={() => onTrackChange(track.id)}
					>
						<img src={TRACK_ART[track.id]} alt={track.label} />
					</button>
				{/each}
			</div>
		</div>

		<div class="mixer__section">
			<span class="mixer__label">Volume</span>
			<input
				id={`voidhero-volume-${idSuffix}`}
				class="mixer__slider"
				type="range"
				min="0"
				max="100"
				step="1"
				value={Math.round(music.volume * 100)}
				aria-label="Volume"
				oninput={(e) => onVolumeChange(Number((e.currentTarget as HTMLInputElement).value) / 100)}
			/>
		</div>
	</div>
{/if}

<style lang="scss">
	.mixer {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		font-family: 'IBM Plex Mono', monospace;
	}

	.mixer__section {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.mixer__label {
		font-size: 0.58rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: rgba(238, 247, 255, 0.55);
	}

	.mixer__tiles {
		display: flex;
		align-items: stretch;
		gap: 0.4rem;
	}

	.mixer__tile {
		flex: 1;
		aspect-ratio: 1 / 1;
		display: grid;
		place-items: center;
		padding: 0.45rem;
		border: 0.5px solid rgba(168, 174, 188, 0.7);
		border-radius: 0.25rem;
		background: rgba(75, 78, 81, 0.2);
		backdrop-filter: blur(50px);
		cursor: pointer;
		transition:
			border-color 0.18s ease,
			background 0.18s ease;
		overflow: hidden;
		outline: none;

		img {
			width: 100%;
			height: auto;
			max-height: 100%;
			object-fit: contain;
			display: block;
		}

		&:focus-visible {
			border-color: rgba(255, 255, 255, 0.75);
		}

		&:hover {
			border-color: rgba(255, 255, 255, 0.55);
		}

		&.active {
			border: 1.5px solid #ffffff;
			padding: calc(0.45rem - 1px);
		}
	}

	.mixer__tile--mute {
		flex: 0 0 auto;
		aspect-ratio: auto;
		width: 2.1rem;
		padding: 0;

		img {
			width: 1.1rem;
			height: 1.1rem;
			max-height: 1.1rem;
		}
	}

	.mixer__slider {
		appearance: none;
		-webkit-appearance: none;
		width: 100%;
		height: 1rem;
		background: transparent;
		cursor: pointer;

		&::-webkit-slider-runnable-track {
			height: 1px;
			background: rgba(255, 255, 255, 0.6);
		}

		&::-moz-range-track {
			height: 1px;
			background: rgba(255, 255, 255, 0.6);
		}

		&::-webkit-slider-thumb {
			appearance: none;
			-webkit-appearance: none;
			width: 0.7rem;
			height: 0.7rem;
			margin-top: -0.35rem;
			border-radius: 50%;
			background: #ffffff;
			border: none;
		}

		&::-moz-range-thumb {
			width: 0.7rem;
			height: 0.7rem;
			border-radius: 50%;
			background: #ffffff;
			border: none;
		}
	}
</style>
