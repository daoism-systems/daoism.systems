<script lang="ts">
	import type { MusicState, MusicTrack } from '$lib/voidhero/voidHero.helpers';

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

	// Patterns advance one step per beat (scaled by beatsPerStep), so the track's
	// effective steps-per-minute is what actually sets gameplay difficulty.
	function complexityOf(track: MusicTrack): { level: number; label: string } {
		const stepsPerMin = track.bpm / Math.max(0.25, track.beatsPerStep);
		if (stepsPerMin < 95) return { level: 1, label: 'Easy' };
		if (stepsPerMin < 115) return { level: 2, label: 'Medium' };
		return { level: 3, label: 'Hard' };
	}
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
					{@const complexity = complexityOf(track)}
					<button
						type="button"
						class="mixer__tile"
						class:active={!isMuted && music.currentTrackId === track.id}
						aria-label={`${track.label} — ${complexity.label} tempo`}
						aria-pressed={!isMuted && music.currentTrackId === track.id}
						title={`${complexity.label} tempo`}
						onclick={() => onTrackChange(track.id)}
					>
						<img src={TRACK_ART[track.id]} alt={track.label} />
						<span class="mixer__badge" data-level={complexity.level} aria-hidden="true">
							{#each [1, 2, 3] as bolt (bolt)}
								<svg
									class="mixer__badge-bolt"
									class:lit={bolt <= complexity.level}
									viewBox="0 0 8 12"
								>
									<path d="M5 0 L1 7 h2.2 L2.6 12 L7 5 H4.6 Z" />
								</svg>
							{/each}
						</span>
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
		position: relative;
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

	.mixer__badge {
		position: absolute;
		right: 0.28rem;
		bottom: 0.28rem;
		display: flex;
		align-items: center;
		gap: 1.5px;
		padding: 3px 3.5px;
		border-radius: 3px;
		background: rgba(10, 14, 20, 0.6);
		pointer-events: none;

		// Lit-bolt color ramps with difficulty: green → cyan → hot pink.
		--lit: #9fdcff;

		&[data-level='1'] {
			--lit: #7ef0b2;
		}
		&[data-level='3'] {
			--lit: #ff8fb3;
		}
	}

	.mixer__badge-bolt {
		width: 4px;
		height: 4px;
		fill: rgba(238, 247, 255, 0.22);

		&.lit {
			fill: var(--lit);
			filter: drop-shadow(0 0 2px var(--lit));
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
