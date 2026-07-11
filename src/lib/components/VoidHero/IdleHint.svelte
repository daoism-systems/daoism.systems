<script lang="ts">
	import { konami } from '$lib/voidhero/konami.svelte';
	import { onMount } from 'svelte';

	type Props = {
		enabled: boolean;
		onPlay?: () => void;
	};

	let { enabled, onPlay }: Props = $props();

	const IDLE_DELAY_MS = 5000;
	let shown = $state(false);
	let alreadyShown = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function schedule() {
		if (alreadyShown || !enabled) return;
		if (timer !== null) clearTimeout(timer);
		// Both desktop and mobile wait 5s of stillness before the "are you still here?" hint.
		timer = setTimeout(() => {
			timer = null;
			if (alreadyShown || !enabled) return;
			shown = true;
			alreadyShown = true;
		}, IDLE_DELAY_MS);
	}

	function clearTimer() {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function handleArrowClick(key: string) {
		shown = false;
		konami.processKey(key);
	}

	function handlePlay() {
		shown = false;
		onPlay?.();
	}

	onMount(() => {
		const onActivity = () => {
			if (!alreadyShown) schedule();
		};
		window.addEventListener('pointermove', onActivity, { passive: true });
		window.addEventListener('pointerdown', onActivity);
		window.addEventListener('keydown', onActivity);
		window.addEventListener('wheel', onActivity, { passive: true });
		window.addEventListener('touchstart', onActivity, { passive: true });

		schedule();

		return () => {
			clearTimer();
			window.removeEventListener('pointermove', onActivity);
			window.removeEventListener('pointerdown', onActivity);
			window.removeEventListener('keydown', onActivity);
			window.removeEventListener('wheel', onActivity);
			window.removeEventListener('touchstart', onActivity);
		};
	});

	$effect(() => {
		if (!enabled) {
			shown = false;
			clearTimer();
		}
	});
</script>

{#if enabled && shown && konami.index === 0}
	<div class="idle-hint" role="status">
		<!-- Desktop: konami-style "Hey! Still here? Click ↑ ↑". Mobile: "STILL HERE? LET'S PLAY"
		     where LET'S PLAY skips the konami sequence and goes straight to the ready phase. -->
		<span class="idle-hint__text idle-hint__text--desktop">Hey! Still here? </span>
		<button
			type="button"
			class="idle-hint__click idle-hint__click--desktop"
			onclick={() => handleArrowClick('ArrowUp')}
			aria-label="Click to continue"
		>
			Click
		</button>
		<span class="idle-hint__arrows">
			<button
				type="button"
				class="idle-hint__key"
				onclick={() => handleArrowClick('ArrowUp')}
				aria-label="Press up arrow"
			>
				<span aria-hidden="true">↑</span>
			</button>
			<button
				type="button"
				class="idle-hint__key"
				onclick={() => handleArrowClick('ArrowUp')}
				aria-label="Press up arrow"
			>
				<span aria-hidden="true">↑</span>
			</button>
		</span>
		<span class="idle-hint__text idle-hint__text--mobile">STILL HERE?</span>
		<button
			type="button"
			class="idle-hint__click idle-hint__click--mobile"
			onclick={handlePlay}
			aria-label="Let's play"
		>
			LET'S PLAY
		</button>
	</div>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.idle-hint {
		position: fixed;
		left: 50%;
		bottom: 1rem;
		transform: translateX(-50%);
		z-index: 11;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.7rem 1rem;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 0.6rem;
		background: rgba(8, 10, 14, 0.62);
		backdrop-filter: blur(18px);
		color: rgba(238, 247, 255, 0.92);
		font-family: 'IBM Plex Mono', monospace;
		font-size: 0.82rem;
		word-spacing: $word-spacing;
		box-shadow: 0 0.6rem 1.6rem rgba(0, 0, 0, 0.32);
		animation: idleHintIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;

		@include breakpoint(phone) {
			font-size: 0.7rem;
			padding: 0.55rem 0.95rem;
			letter-spacing: 0.14em;
			text-transform: uppercase;
			border: none;
			background: transparent;
			backdrop-filter: none;
			box-shadow: none;
			white-space: nowrap;
			flex-wrap: nowrap;
		}
	}

	.idle-hint__text--mobile,
	.idle-hint__click--mobile {
		display: none;
	}

	@include breakpoint(phone) {
		.idle-hint__text--desktop,
		.idle-hint__click--desktop {
			display: none;
		}

		.idle-hint__text--mobile {
			display: inline;
			white-space: nowrap;
		}

		.idle-hint__click--mobile {
			display: inline-block;
			text-decoration: underline;
			text-underline-offset: 0.18em;
			margin: 0 0 0 0.4em;
			white-space: nowrap;
		}
	}

	@keyframes idleHintIn {
		from {
			opacity: 0;
			transform: translate(-50%, 0.5rem);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	.idle-hint__click {
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		padding: 0;
		margin: 0 0.2em;
		transition: text-decoration 0.18s;
		text-decoration: none;

		&:hover,
		&:focus {
			text-decoration: underline;
		}

		@include breakpoint(phone) {
			text-decoration: underline;
		}
	}

	.idle-hint__arrows {
		display: flex;
		gap: 0.2rem;

		@include breakpoint(phone) {
			display: none;
		}
	}

	.idle-hint__key {
		display: grid;
		place-items: center;
		min-width: 1.55rem;
		height: 1.55rem;
		padding: 0 0.35rem;
		border: 1px solid rgba(255, 255, 255, 0.32);
		border-radius: 0.3rem;
		background: rgba(255, 255, 255, 0.06);
		color: #ffffff;
		font: inherit;
		line-height: 1;
		cursor: pointer;
		transition:
			background 0.18s ease,
			border-color 0.18s ease,
			transform 0.18s ease,
			box-shadow 0.18s ease;

		&:hover {
			background: rgba(151, 222, 255, 0.18);
			border-color: rgba(151, 222, 255, 0.65);
			box-shadow: 0 0 0.7rem rgba(151, 222, 255, 0.32);
			transform: translateY(-1px);
		}

		&:active {
			transform: translateY(0);
		}
	}
</style>
