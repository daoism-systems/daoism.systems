<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import type { OctagonScene } from '$lib/scene/OctagonScene';

	// Isolated octagon environment for marketing / showreel capture: black page,
	// direct OrbitControls view, faithful fluid interaction. No UI, scroll or Lenis.
	let sceneContainer = $state<HTMLElement | null>(null);
	let scene: OctagonScene | null = null;
	let destroyed = false;

	onMount(async () => {
		const { OctagonScene } = await import('$lib/scene/OctagonScene');
		if (destroyed) return;
		scene = new OctagonScene();
		await scene.init();
		if (destroyed) {
			scene.dispose();
			scene = null;
		}
	});

	onDestroy(() => {
		if (!browser) return;
		destroyed = true;
		scene?.dispose();
		scene = null;
	});
</script>

<svelte:head>
	<title>Octagon — showreel</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div bind:this={sceneContainer} class="canvas-container"></div>

<style lang="scss">
	:global(html),
	:global(body) {
		background: #000;
	}

	.canvas-container {
		position: fixed;
		inset: 0;
		z-index: 1;
		background: #000;
	}

	/* The Renderer appends its canvas with class `.canvas` into .canvas-container.
	   The main page defines this globally too, but that style only mounts with the
	   main route — restate it here so the canvas fills the viewport on this route. */
	:global(.canvas) {
		position: fixed !important;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 1;
	}

	:global(.canvas-container canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
