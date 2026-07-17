<script lang="ts">
	import { onMount } from 'svelte';
	import { Howler } from 'howler';
	import { EASINGS } from '$lib/utils/animations/constants/easings';
	import { headingReveal } from '$lib/utils/animations/headingReveal';
	import {
		loadingProgress,
		loadingFinish,
		showPreloader,
		preloaderTransitioning,
		warmupComplete
	} from '../../store.svelte';
	import BackgroundPattern from './BackgroundPattern.svelte';
	import SvgArt from './SvgArt/index.svelte';
	import LoadingLabel from './LoadingLabel.svelte';
	import PreloaderCta from './PreloaderCta.svelte';

	const waitingMessages = [
		'Please stand by',
		'Creating the scene',
		'Ensuring the best experience'
	] as const;
	const lastWaitingMessageIndex = waitingMessages.length - 1;
	const waitingMessageHoldDuration = 120;
	type WaitingMessagePhase = 'revealing' | 'holding' | 'visible' | 'hiding';

	let artSequenceComplete = $state(false);
	let backgroundTransitionComplete = $state(false);
	let isExiting = $state(false);
	let waitingMessageIndex = $state(0);
	let waitingMessagePhase = $state<WaitingMessagePhase>('revealing');
	let waitingMessageSequenceComplete = $state(false);
	let waitingMessage = $derived(waitingMessages[waitingMessageIndex]);
	let unlockedWaitingMessageIndex = $derived(getUnlockedWaitingMessageIndex($loadingProgress));
	let shouldHideWaitingMessage = $derived(waitingMessagePhase === 'hiding');
	let isPreloaderReady = $derived(
		backgroundTransitionComplete && $warmupComplete && $loadingProgress >= 100
	);
	let shouldPlaySequence = $derived(isPreloaderReady && waitingMessageSequenceComplete);

	const preloaderMotionEase = EASINGS.EASE_CUSTOM_REVEAL;
	const preloaderExitEase = EASINGS.EASE_POWER1_INOUT;
	const waitingMessageRevealOptions = $derived({
		trigger: true,
		reversed: shouldHideWaitingMessage,
		duration: 0.42,
		stagger: 0.006,
		reverseSpeedMultiplier: 2,
		onDone: handleWaitingMessageRevealDone,
		onReverseDone: handleWaitingMessageOutDone
	});

	$effect(() => {
		if (waitingMessagePhase !== 'holding') return;

		const holdTimer = setTimeout(() => {
			waitingMessagePhase = 'visible';
		}, waitingMessageHoldDuration);

		return () => clearTimeout(holdTimer);
	});

	$effect(() => {
		if (!$showPreloader || waitingMessagePhase !== 'visible') return;

		const hasUnlockedNextMessage = unlockedWaitingMessageIndex > waitingMessageIndex;
		const canFinishSequence =
			isPreloaderReady && waitingMessageIndex === lastWaitingMessageIndex;

		if (hasUnlockedNextMessage || canFinishSequence) {
			waitingMessagePhase = 'hiding';
		}
	});

	$effect(() => {
		if (!$showPreloader || $loadingProgress > 0.1) return;

		artSequenceComplete = false;
		isExiting = false;
		waitingMessageIndex = 0;
		waitingMessagePhase = 'revealing';
		waitingMessageSequenceComplete = false;
	});

	onMount(() => {
		Howler.mute(true);
		backgroundTransitionComplete = true;
	});

	function handleExit() {
		if (isExiting) return;
		isExiting = true;
		$preloaderTransitioning = true;
		$loadingFinish = true;
	}

	function handleWaitingMessageRevealDone() {
		if (waitingMessagePhase !== 'revealing') return;
		waitingMessagePhase = 'holding';
	}

	function handleWaitingMessageOutDone() {
		if (waitingMessagePhase !== 'hiding') return;

		if (waitingMessageIndex < unlockedWaitingMessageIndex) {
			waitingMessageIndex += 1;
			waitingMessagePhase = 'revealing';
			return;
		}

		if (isPreloaderReady && waitingMessageIndex === lastWaitingMessageIndex) {
			waitingMessageSequenceComplete = true;
			return;
		}

		waitingMessagePhase = 'visible';
	}

	function getUnlockedWaitingMessageIndex(progress: number) {
		if (progress < 25) return 0;
		if (progress < 75) return 1;
		return lastWaitingMessageIndex;
	}

	function handleStart(withSound: boolean) {
		if (withSound) {
			Howler.mute(false);
			window.dispatchEvent(new CustomEvent('audio-visualiser-play'));
		} else {
			Howler.mute(true);
		}

		handleExit();
	}
</script>

{#if $showPreloader}
	<div
		class="preloader-shell fixed inset-0 z-100 overflow-hidden bg-black"
		class:preloader-shell--exit={isExiting}
		style:--preloader-btn-ease={preloaderMotionEase}
		style:--preloader-exit-ease={preloaderExitEase}
		style:--preloader-with-sound-stagger="0.1s"
		onanimationend={(event) => {
			if (event.currentTarget !== event.target || !isExiting) return;
			$preloaderTransitioning = false;
			$showPreloader = false;
		}}
	>
		<BackgroundPattern onTransitionComplete={() => (backgroundTransitionComplete = true)} />

		{#if !shouldPlaySequence}
			{#key waitingMessage}
				<p class="preloader-waiting-copy" use:headingReveal={waitingMessageRevealOptions}>
					<span class="text-line">{waitingMessage}</span>
				</p>
			{/key}
		{/if}

		{#if shouldPlaySequence}
			<SvgArt onSequenceComplete={() => (artSequenceComplete = true)} {isExiting} />
			<PreloaderCta ready={artSequenceComplete} exiting={isExiting} onStart={handleStart} />
		{/if}

		<LoadingLabel />
	</div>
{/if}

<style lang="scss">
	.preloader-shell {
		word-spacing: normal;
	}

	.preloader-shell :global(.preloader-background-pattern),
	.preloader-shell :global(.preloader-art) {
		opacity: 0;
		transform: translate3d(0, 18px, 0) scale(0.985);
		filter: blur(12px);
		will-change: opacity, transform, filter;
		animation: preloader-reveal-fade 1.4s var(--preloader-btn-ease) 0.05s forwards;
	}

	.preloader-shell :global(.preloader-status) {
		opacity: 0;
		transform: translate3d(0, 16px, 0);
		filter: blur(8px);
		will-change: opacity, transform, filter;
		animation: preloader-status-reveal 0.68s var(--preloader-btn-ease) 0.28s forwards;
	}

	.preloader-shell.preloader-shell--exit {
		pointer-events: none;
		will-change: opacity, filter;
		animation: preloader-shell-fade 1.15s var(--preloader-exit-ease) forwards;
	}

	.preloader-shell.preloader-shell--exit :global(.preloader-status) {
		animation: preloader-status-hide 0.32s var(--preloader-exit-ease) forwards;
	}

	.preloader-waiting-copy {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 1;
		margin: 0;
		width: min(90vw, 720px);
		padding: 0 20px;
		text-align: center;
		text-transform: uppercase;
		letter-spacing: 0.18em;
		font-size: clamp(0.74rem, 1.6vw, 1rem);
		font-weight: 500;
		color: rgba(168, 174, 188, 0.55);
		text-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
		pointer-events: none;
		opacity: 1;
		transform: translate(-50%, -50%);
	}

	@media (max-width: 1400px) {
		.preloader-waiting-copy {
			width: min(92vw, 620px);
			letter-spacing: 0.14em;
			font-size: clamp(0.72rem, 1.3vw, 0.92rem);
		}
	}

	@media (max-width: 1024px) {
		.preloader-waiting-copy {
			width: min(90vw, 520px);
			padding: 0 16px;
			letter-spacing: 0.12em;

		}

		.preloader-shell :global(.preloader-status) {
			bottom: 12px;
			left: 12px;
			gap: 10px;
			padding: 0.28rem 0.7rem;
			font-size: 0.72rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.preloader-shell :global(.preloader-background-pattern),
		.preloader-shell :global(.preloader-art),
		.preloader-shell :global(.preloader-status),
		.preloader-waiting-copy {
			animation-duration: 0.01ms !important;
			animation-delay: 0ms !important;
			transition-duration: 0.01ms !important;
			filter: none !important;
		}

		.preloader-shell :global(.preloader-background-pattern),
		.preloader-shell :global(.preloader-art) {
			opacity: 1;
			transform: none;
		}

		.preloader-waiting-copy {
			animation: none;
			opacity: 1;
			transform: translate(-50%, -50%);
		}
	}

	@keyframes preloader-reveal-fade {
		from {
			opacity: 0;
			transform: translate3d(0, 18px, 0) scale(0.985);
			filter: blur(12px);
		}
		to {
			opacity: 1;
			transform: translate3d(0, 0, 0) scale(1);
			filter: blur(0);
		}
	}

	@keyframes preloader-status-reveal {
		from {
			opacity: 0;
			transform: translate3d(0, 16px, 0);
			filter: blur(8px);
		}
		to {
			opacity: 1;
			transform: translate3d(0, 0, 0);
			filter: blur(0);
		}
	}

	@keyframes preloader-status-hide {
		from {
			opacity: 1;
			transform: translate3d(0, 0, 0);
		}
		to {
			opacity: 0;
			transform: translate3d(0, -10px, 0);
		}
	}

	@keyframes preloader-shell-fade {
		from {
			opacity: 1;
			filter: blur(0);
		}
		to {
			opacity: 0;
			filter: blur(6px);
		}
	}
</style>
