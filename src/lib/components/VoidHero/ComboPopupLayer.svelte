<script lang="ts">
	import type { PadLabel } from "$lib/voidhero/voidHero.helpers";
	import type { StoredPopup } from "$lib/voidhero/voidHeroStore.svelte";



	type Props = {
		popups: StoredPopup[];
		padLabels: PadLabel[];
		onPopupEnd: (id: number) => void;
	};

	let { popups, padLabels, onPopupEnd }: Props = $props();
</script>

<div class="combo-popups" aria-hidden="true">
	{#each popups as popup (popup.id)}
		<span
			class="combo-popup combo-popup--{popup.tier}"
			style="--popup-x: {popup.x}px; --popup-y: {popup.y}px;"
			onanimationend={() => onPopupEnd(popup.id)}>{popup.text}</span
		>
	{/each}
</div>

<div class="pad-labels" aria-hidden="true">
	{#each padLabels as p (p.label)}
		<span class="pad-label" style="--pad-x: {p.x}px; --pad-y: {p.y}px;">{p.label}</span>
	{/each}
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.combo-popups {
		position: fixed;
		inset: 0;
		z-index: 13;
		pointer-events: none;
	}

	.pad-labels {
		position: fixed;
		inset: 0;
		z-index: 12;
		pointer-events: none;
	}

	.pad-label {
		position: absolute;
		left: var(--pad-x);
		top: var(--pad-y);
		transform: translate(-50%, 1.6rem);
		display: grid;
		place-items: center;
		min-width: 2.4rem;
		padding: 0.18rem 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.25rem;
		background: rgba(255, 255, 255, 0.08);
		color: #ffffff;
		font-family: 'IBM Plex Mono', monospace;
		font-size: 0.7rem;
		letter-spacing: 0.04em;
		white-space: nowrap;
		backdrop-filter: blur(6px);

		&::before {
			content: '';
			position: absolute;
			inset: -0.45rem -0.7rem;
			z-index: -1;
			border: 1px solid rgba(151, 222, 255, 0.16);
			border-radius: 999px;
			background: radial-gradient(circle, rgba(151, 222, 255, 0.14), rgba(151, 222, 255, 0));
		}

		@include breakpoint(phone) {
			transform: translate(-50%, 1rem);
			min-width: 3.25rem;
			padding: 0.32rem 0.62rem;
			border-color: rgba(151, 222, 255, 0.28);
			background: rgba(5, 10, 14, 0.42);
			font-size: 0.62rem;

			&::before {
				inset: -0.95rem -1.15rem;
				border-color: rgba(151, 222, 255, 0.2);
				background: radial-gradient(circle, rgba(151, 222, 255, 0.2), rgba(151, 222, 255, 0));
			}
		}
	}

	.combo-popup {
		position: absolute;
		left: var(--popup-x);
		top: var(--popup-y);
		font-family: KH Interference TRIAL;
		color: white;
		white-space: nowrap;
		font-weight: 400;
		text-shadow: 0 0 0.6rem rgba(255, 255, 255, 0.4);
		animation: comboFloat 0.7s ease-out forwards;
		will-change: transform, opacity;
	}

	.combo-popup--judgment {
		font-size: 1.2rem;
	}

	.combo-popup--combo {
		font-size: 1.8rem;
	}

	.combo-popup--milestone {
		font-size: 2.6rem;
		text-shadow:
			0 0 1.2rem rgba(255, 255, 255, 0.7),
			0 0 2rem rgba(255, 255, 255, 0.4);
		animation-duration: 0.9s;
	}

	@keyframes comboFloat {
		0% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(1.2);
		}
		20% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(-50%, calc(-50% - 90px)) scale(1);
		}
	}
</style>
