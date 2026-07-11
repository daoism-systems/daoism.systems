<script lang="ts">
	import { konami, konamiGlyphs, konamiSequence } from '$lib/voidhero/konami.svelte';
	import { onMount } from 'svelte';

	type Props = {
		enabled: boolean;
	};

	let { enabled }: Props = $props();

	onMount(() => {
		const handleKey = (event: KeyboardEvent) => {
			if (!enabled) return;
			konami.processKey(event.key);
		};
		window.addEventListener('keydown', handleKey);
		return () => {
			window.removeEventListener('keydown', handleKey);
		};
	});

	$effect(() => {
		if (!enabled) konami.reset();
	});
</script>

{#if enabled && konami.index >= 1}
	<div class="konami-hint">
		<span class="konami-hint__whisper">a secret stirs…</span>
		<div class="konami-hint__glyphs">
			{#each konamiGlyphs as glyph, i}
				<button
					type="button"
					class="konami-hint__glyph"
					class:lit={i < konami.index}
					onclick={() => konami.processKey(konamiSequence[i])}
					aria-label={`Press ${glyph}`}>{glyph}</button
				>
			{/each}
		</div>
	</div>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.konami-hint {
		position: fixed;
		left: 50%;
		bottom: calc(#{$offset-x} + 3.4rem);
		transform: translateX(-50%);
		z-index: 11;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.45rem;
		padding: 0.55rem 0.95rem;
		backdrop-filter: blur(18px);
		color: rgba(238, 247, 255, 0.85);
		font-family: 'IBM Plex Mono', monospace;
		animation: konamiHintIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;

		// Mobile skips konami entirely — STILL HERE / LET'S PLAY hint goes straight to ready.
		@include breakpoint(phone) {
			display: none;
		}
	}

	@keyframes konamiHintIn {
		from {
			opacity: 0;
			transform: translate(-50%, 0.4rem);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	.konami-hint__whisper {
		font-size: 0.6rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: rgba(238, 247, 255, 0.55);
	}

	.konami-hint__glyphs {
		display: flex;
		gap: 0.32rem;
		font-size: 0.78rem;
		line-height: 1;

		@include breakpoint(phone) {
			gap: 0.4rem;
			font-size: 1.4rem;
			flex-wrap: nowrap;
		}
	}

	.konami-hint__glyph {
		display: grid;
		place-items: center;
		min-width: 0.95rem;
		padding: 0.18rem 0.34rem;
		border-radius: 0.3rem;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: transparent;
		color: rgba(238, 247, 255, 0.32);
		font: inherit;
		line-height: 1;
		cursor: pointer;
		transition:
			color 0.25s ease,
			border-color 0.25s ease,
			background 0.25s ease,
			box-shadow 0.25s ease,
			transform 0.25s ease;

		&:hover {
			color: rgba(238, 247, 255, 0.95);
			border-color: rgba(151, 222, 255, 0.5);
			background: rgba(128, 214, 255, 0.1);
			transform: translateY(-1px);
		}

		&:active {
			transform: translateY(0);
		}

		&.lit {
			color: #ffffff;
			border-color: rgba(151, 222, 255, 0.65);
			background: rgba(128, 214, 255, 0.18);
			box-shadow: 0 0 0.7rem rgba(151, 222, 255, 0.32);
			transform: translateY(-1px);
		}

		@include breakpoint(phone) {
			min-width: 1.7rem;
			padding: 0.44rem 0.52rem;
		}
	}
</style>
