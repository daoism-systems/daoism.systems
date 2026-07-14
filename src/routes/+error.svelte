<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import type NotFoundSketch from './404';
	import { showPreloader } from '$lib/store.svelte';
	import { runHomeTransition } from '$lib/transitions/runHomeTransition';
	import ScrollIndicator from '$lib/components/ScrollIndicator.svelte';
	import { begin, dispatch, end, prepare, removePopup, restoreView, setTransitioning, voidHeroState } from '$lib/voidhero/voidHeroStore.svelte';
	import { konami } from '$lib/voidhero/konami.svelte';
	import HeroHeading from '$lib/components/VoidHero/HeroHeading.svelte';
	import KonamiHint from '$lib/components/VoidHero/KonamiHint.svelte';
	import IdleHint from '$lib/components/VoidHero/IdleHint.svelte';
	import GameActionCta from '$lib/components/VoidHero/GameActionCta.svelte';
	import GameModal from '$lib/components/VoidHero/GameModal.svelte';
	import GameHud from '$lib/components/VoidHero/GameHud.svelte';
	import GameResults from '$lib/components/VoidHero/GameResults.svelte';
	import GameExit from '$lib/components/VoidHero/GameExit.svelte';
	import ComboPopupLayer from '$lib/components/VoidHero/ComboPopupLayer.svelte';
	import { SceneEventBus } from '$lib/voidhero/events';

	let scene = $state<NotFoundSketch | null>(null);
	let ready = $state(false);
	let prewarming = $state(false);
	let transitionController: AbortController | null = null;

	const idleAndStill = $derived(
		voidHeroState.phase === 'idle' && !voidHeroState.transitioning
	);

	onMount(() => {
		$showPreloader = false;
		document.documentElement.classList.add('void-hero-no-zoom');
		document.body.classList.add('void-hero-no-zoom');

		konami.setOnComplete(() => {
			prepare();
		});

		const events = new SceneEventBus();
		const unsubscribe = events.subscribe((event) => {
			if (event.kind === 'ready') {
				ready = true;
				return;
			}
			if (event.kind === 'prewarm') {
				prewarming = event.busy;
				return;
			}
			if (event.kind === 'secretRequest') {
				prepare();
				return;
			}
			if (event.kind === 'gameOver') {
				if (voidHeroState.transitioning) return;
				scene?.stopGame();
				end();
				return;
			}
			dispatch(event);
		});

		let cancelled = false;
		let sceneInstance: NotFoundSketch | null = null;

		const mountScene = async () => {
			const { default: NotFoundSketchCtor } = await import('./404');
			if (cancelled) return;
			sceneInstance = new NotFoundSketchCtor({ events });
			scene = sceneInstance;
			sceneInstance.ready.catch((error) => {
				console.error('[404] scene failed to initialize', error);
				if (!cancelled) ready = true;
			});
		};

		void mountScene().catch((error) => {
			console.error('[404] scene failed to load', error);
			if (!cancelled) ready = true;
		});

		const handleStartKey = (event: KeyboardEvent) => {
			if (
				event.key.toLowerCase() === 'm' &&
				!event.repeat &&
				voidHeroState.phase !== 'idle'
			) {
				event.preventDefault();
				handleMuteToggle();
				return;
			}
			if (voidHeroState.phase !== 'ready') return;
			if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
				event.preventDefault();
				handleStart();
			}
		};
		window.addEventListener('keydown', handleStartKey);

		// Block zoom on this page only. The layout viewport meta (which permits
		// pinch-zoom) is overridden via <svelte:head>; these listeners cover the
		// remaining vectors: ctrl/meta + wheel (desktop) and Safari pinch gestures.
		const handleWheel = (event: WheelEvent) => {
			if (event.ctrlKey || event.metaKey) event.preventDefault();
		};
		const handleGesture = (event: Event) => {
			event.preventDefault();
		};
		window.addEventListener('wheel', handleWheel, { passive: false });
		window.addEventListener('gesturestart', handleGesture as EventListener);
		window.addEventListener('gesturechange', handleGesture as EventListener);
		window.addEventListener('gestureend', handleGesture as EventListener);

		return () => {
			cancelled = true;
			document.documentElement.classList.remove('void-hero-no-zoom');
			document.body.classList.remove('void-hero-no-zoom');
			window.removeEventListener('keydown', handleStartKey);
			window.removeEventListener('wheel', handleWheel);
			window.removeEventListener('gesturestart', handleGesture as EventListener);
			window.removeEventListener('gesturechange', handleGesture as EventListener);
			window.removeEventListener('gestureend', handleGesture as EventListener);
			transitionController?.abort();
			unsubscribe();
			konami.setOnComplete(null);
			konami.reset();
			restoreView();
			// Reset transition flag so a subsequent visit to an error route starts fresh —
			// the store is module-level and persists across component mounts.
			setTransitioning(false);
			const activeScene = sceneInstance ?? scene;
			if (activeScene) {
				activeScene.destroy();
				scene = null;
				sceneInstance = null;
			}
		};
	});

	$effect(() => {
		scene?.setSecretButtonVisible(idleAndStill);
	});

	// Warm the game's GPU pipelines while the player reads the pre-start screen —
	// the modal dwell covers compile jank the idle scene would otherwise show.
	// Reads `scene`, so it re-fires if the phase flips before the scene loads.
	$effect(() => {
		if (voidHeroState.phase === 'ready') scene?.prewarmGame();
	});

	function handleStart() {
		if (voidHeroState.transitioning) return;
		if (begin()) scene?.startGame();
	}

	function handleRestart() {
		if (voidHeroState.transitioning) return;
		if (prepare() && begin()) scene?.startGame();
	}

	function handlePrepare() {
		if (voidHeroState.transitioning) return;
		if (prepare()) scene?.previewGame();
	}

	function handleClose() {
		if (voidHeroState.transitioning) return;
		scene?.stopGame();
		restoreView();
	}

	function handleLose() {
		if (voidHeroState.phase !== 'playing' || voidHeroState.transitioning) return;
		scene?.stopGame();
		end();
	}

	function handleCtaEnter() {
		if (voidHeroState.phase !== 'idle') return;
		scene?.setCtaHovered(true);
	}

	function handleCtaLeave() {
		scene?.setCtaHovered(false);
	}

	async function handleGoHome(e?: MouseEvent) {
		e?.preventDefault();
		if (voidHeroState.transitioning) return;
		setTransitioning(true);
		transitionController?.abort();
		transitionController = new AbortController();
		try {
			await runHomeTransition({
				triggerTransition: () => scene?.triggerTransition(),
				navigate: () => goto('/'),
				signal: transitionController.signal
			});
		} catch (err) {
			if ((err as Error)?.name !== 'AbortError') {
				console.error('[404] home transition failed', err);
			}
		}
	}

	function handleTrackChange(id: string) {
		scene?.setMusicTrack(id);
	}

	function handleVolumeChange(volume: number) {
		scene?.setMusicVolume(volume);
	}

	function handleMuteToggle() {
		scene?.toggleMusicMute();
	}
</script>

<svelte:head>
	<title>Daoism Systems — Void</title>
	<meta
		name="viewport"
		content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
	/>
	<!-- Injected at component mount (ssr=false), so these start the scene's asset
	     downloads in parallel with the lazy scene-chunk download/parse instead of
	     after it. crossorigin="anonymous" matches three.js FileLoader (fetch,
	     same-origin credentials) and ImageLoader (crossOrigin anonymous). -->
	<link rel="preload" href="/models/404.glb" as="fetch" crossorigin="anonymous" />
	<link rel="preload" href="/textures/Concrete_basecolor.webp" as="image" crossorigin="anonymous" />
	<link rel="preload" href="/draco/draco_wasm_wrapper.js" as="fetch" crossorigin="anonymous" />
	<link rel="preload" href="/draco/draco_decoder.wasm" as="fetch" crossorigin="anonymous" />
</svelte:head>

<a href="/" class="error-logo" onclick={handleGoHome}>
	<img src="/icons/logo.svg" alt="daoism systems logo" height="48" />
</a>

<ScrollIndicator
	sectionLabels={[
		'404',
		'404',
		'Still 404',
		'And here too',
		'...',
		'404',
		'404',
		"You won't believe it..."
	]}
/>

<HeroHeading
	phase={voidHeroState.phase}
	score={voidHeroState.runHud.score}
	{ready}
	preparing={prewarming}
/>

<div
	class="error-cta-text"
	class:ready
	class:transitioning={voidHeroState.transitioning}
	class:playing={voidHeroState.phase !== 'idle'}
>
	<span class="go-home__text-label">Go Home</span>
	<span class="go-home__text-sub">It’s much more safe there</span>
</div>

<button
	class="error-cta-btn hotspot"
	class:ready
	class:transitioning={voidHeroState.transitioning}
	class:playing={voidHeroState.phase !== 'idle'}
	onclick={handleGoHome}
	onmouseenter={handleCtaEnter}
	onmouseleave={handleCtaLeave}
	aria-label="Go Home"
></button>

<KonamiHint enabled={idleAndStill} />
<IdleHint enabled={idleAndStill} onPlay={handlePrepare} />

{#if !voidHeroState.transitioning}
	<GameActionCta
		phase={voidHeroState.phase}
		onStart={handleStart}
		onRestart={handleRestart}
		onClose={handleClose}
	/>
{/if}

{#if !voidHeroState.transitioning}
	<GameModal
		phase={voidHeroState.phase}
		music={voidHeroState.music}
		lastRunHud={voidHeroState.lastRunHud}
		onStart={handleStart}
		onRestart={handleRestart}
		onClose={handleClose}
		onTrackChange={handleTrackChange}
		onVolumeChange={handleVolumeChange}
	/>
{/if}

{#if voidHeroState.phase !== 'idle' && !voidHeroState.transitioning}
	<GameHud
		runHud={voidHeroState.runHud}
		music={voidHeroState.music}
		onTrackChange={handleTrackChange}
		onVolumeChange={handleVolumeChange}
		onMuteToggle={handleMuteToggle}
	/>
{/if}

{#if voidHeroState.phase === 'ended' && voidHeroState.lastRunHud && !voidHeroState.transitioning}
	<GameResults lastRunHud={voidHeroState.lastRunHud} />
{/if}

{#if voidHeroState.phase === 'playing'}
	<GameExit active={voidHeroState.runHud.active} onLose={handleLose} />
	<ComboPopupLayer
		popups={voidHeroState.popups}
		padLabels={voidHeroState.padLabels}
		onPopupEnd={removePopup}
	/>
{/if}

<div
	class="error-page"
	class:ready
	class:transitioning={voidHeroState.transitioning}
	class:playing={voidHeroState.phase !== 'idle'}
	class:ended={voidHeroState.phase === 'ended'}
>
	<div class="error-tracker">
		<span class="error-tracker__label">Error</span>
		<span class="diamond">&#9670;</span>
		<span class="error-tracker__label">Void</span>
		<button type="button" class="error-tracker__restart" onclick={handleRestart}>Restart</button>
	</div>

	<p class="error-tagline">
		404 — page not found.
		<br />
		In the Dao of the web, not all routes Lead
		<br />
		to meaning — this one leads to void.
	</p>
</div>

{#if !ready}
	<div class="page-loader" out:fade={{ duration: 500 }} aria-hidden="true">
		<span class="page-loader__spinner"></span>
	</div>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	:global(.scroll-indicator) {
		word-spacing: $word-spacing;
	}

	// Scoped to this route via classes added on mount. The 404 canvas is appended
	// to <body>, so component-local selectors cannot cover all touch targets.
	:global(html.void-hero-no-zoom),
	:global(body.void-hero-no-zoom) {
		touch-action: none;
		overscroll-behavior: none;
	}

	:global(body.void-hero-no-zoom canvas),
	.error-page,
	.error-cta-btn,
	.error-logo,
	:global(.game-hud),
	:global(.game-modal),
	:global(.game-action-cta),
	:global(.game-exit) {
		touch-action: none;
		-webkit-tap-highlight-color: transparent;
	}

	.error-page {
		position: fixed;
		inset: 0;
		z-index: 10;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.8s ease-out;
		font-family: 'IBM Plex Mono', monospace;

		&.ready {
			opacity: 1;
		}

		&.transitioning {
			animation: fadeOutUI 1.2s ease-in forwards;
			animation-delay: 0.4s;
		}

		&.playing {
			.error-tagline {
				opacity: 0;
				transform: translateY(0.5rem);
			}
		}

		> * {
			pointer-events: all;
		}
	}

	@keyframes fadeOutUI {
		to {
			opacity: 0;
		}
	}

	.error-logo {
		position: absolute;
		top: 0;
		left: 0;
		padding: $offset-x;
		width: 7rem;
		display: flex;
		align-items: center;

		img {
			width: 100%;
			height: auto;
		}

		@include breakpoint(phone) {
			width: 6.2rem;
			padding: 1rem $offset-x-phone;
		}
	}

	.error-cta-text {
		position: fixed;
		width: 100%;
		top: 70%;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity 0.8s ease-out;

		@include breakpoint(phone) {
			color: #ffffff;
			backdrop-filter: blur(12px);
			background: rgba(3, 5, 7, 0.01);
			padding: 0.45rem;
		}

		&.ready {
			opacity: 1;
		}

		&.transitioning {
			animation: fadeOutUI 1.2s ease-in forwards;
			animation-delay: 0.4s;
		}

		&.playing {
			animation: fadeOutUI 0.55s ease forwards;
			pointer-events: none;
		}
	}

	.error-cta-btn {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 53px;
		height: 53px;
		border-radius: 50%;
		background: rgb(0 0 0 / 50%);
		opacity: 0;
		transition:
			opacity 0.8s ease-out,
			transform 0.25s ease;
		z-index: 10;

		// Override the global `.hotspot { display: none }` mobile rule in app.scss
		// so the error-page CTA matches desktop on phone/tablet.
		&.hotspot {
			@include breakpoint(not-desktop) {
				display: block;
			}
		}

		&::after {
			content: '';
			position: absolute;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			width: 20%;
			height: 20%;
			border-radius: 50%;
			background: white;
			transition: transform 0.25s ease;
		}

		&.ready {
			opacity: 1;
		}

		&.transitioning {
			animation: fadeOutUI 1.2s ease-in forwards;
			animation-delay: 0.4s;
		}

		&.playing {
			animation: fadeOutUI 0.55s ease forwards;
			pointer-events: none;
		}

		@media (hover: hover) and (pointer: fine) {
			&:hover {
				transform: translate(-50%, -50%) scale(1.1);

				&::after {
					transform: translate(-50%, -50%) scale(0.5);
				}
			}
		}
	}

	.go-home__text-label {
		color: black;
		font-weight: 400;
		line-height: 120%;
		font-size: 1.5rem;
		word-spacing: 25%;
		font-family: KH Interference TRIAL;

		@include breakpoint(phone) {
			color: #ffffff;
		}
	}

	.go-home__text-sub {
		color: #3a4245;
		font-size: 0.875rem;
		font-weight: 400;
		word-spacing: 0;

		@include breakpoint(phone) {
			color: rgba(255, 255, 255, 0.65);
		}
	}

	.error-tracker {
		position: absolute;
		bottom: $offset-x;
		left: $offset-x;
		display: flex;
		align-items: center;
		gap: 1rem;
		background: $color-grey-600;
		border: 1px solid rgba($color-grey-300, 0.3);
		padding: 0.4rem 1rem;
		color: #c6c9d6;
		font-size: 0.56rem;
		font-weight: 400;
		font-family: 'IBM Plex Mono', monospace;
		user-select: none;
		border-radius: 0.25rem;
		backdrop-filter: blur(50px);

		@include breakpoint(not-desktop) {
			top: $offset-x-phone;
			right: $offset-x-phone;
			left: auto;
			bottom: auto;
		}
	}

	.error-tracker__restart {
		display: none;
		background: transparent;
		border: 0;
		padding: 0;
		font: inherit;
		font-size: 0.7rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: #ffffff;
		cursor: pointer;
	}

	// On phones, swap Error ◊ Void for a Restart CTA after the run ends so the
	// player has the design's top-right restart anchor without leaving the popup.
	@include breakpoint(phone) {
		.error-page.ended .error-tracker {
			padding: 0.55rem 0.85rem;
			gap: 0;
		}

		.error-page.ended .error-tracker__label,
		.error-page.ended .error-tracker .diamond {
			display: none;
		}

		.error-page.ended .error-tracker__restart {
			display: inline-block;
		}
	}

	.diamond {
		color: $color-grey-300;
		font-size: 0.46rem;
	}

	.error-tagline {
		position: absolute;
		bottom: $offset-x;
		right: 1.25rem;
		color: #a9aebb;
		font-size: 1rem;
		font-weight: 300;
		text-align: right;
		line-height: 120%;
		word-spacing: 0;
		transition:
			opacity 0.55s ease,
			transform 0.55s ease;

		@include breakpoint(not-desktop) {
			display: none;
		}
	}

	.page-loader {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: var(--bg-primary, #20242d);
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}

	.page-loader__spinner {
		display: block;
		width: 4rem;
		height: 4rem;
		border-radius: 50%;
		border: 0.25rem solid rgba(255, 255, 255, 0.18);
		border-top-color: #fff;
		animation: page-loader-spin 0.85s linear infinite;
	}

	@keyframes page-loader-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
