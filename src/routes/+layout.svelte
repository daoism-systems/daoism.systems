<script lang="ts">
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import '../app.css';
	import '../app.scss';
	import 'lenis/dist/lenis.css';
	import Preloader from '$lib/components/Preloader/index.svelte';
	import Cursor from '$lib/components/Cursor.svelte';
	import SlideTooltip from '$lib/components/SlideTooltip.svelte';
	import LandscapeOverlay from '$lib/components/LandscapeOverlay.svelte';

	let { children } = $props();
	// The /_octagon showreel route mounts its own isolated scene and never drives
	// the global loading progress, so the shared Preloader/Cursor/UI are suppressed
	// there (otherwise the Preloader would block the page forever). The static
	// /privacy-policy route has the same constraint — it never loads the scene.
	let hideUI = $derived(
		page.url.searchParams.get('hideUI') === 'true' ||
			page.url.pathname.startsWith('/_octagon') ||
			page.url.pathname.startsWith('/privacy-policy')
	);

	const siteName = 'Daoism Systems — DAO & DeFi Development Studio';
	const defaultDescription = 'Daoism Systems is a web3 tech studio engineering DAOs, DeFi protocols, and on-chain tooling. Building decentralized systems since 2017.';

	// Progressive enhancement: use View Transitions API when available
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head>
	<meta charset="utf-8" />
	<link rel="icon" href="/favicon.svg" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />

	<title>{siteName}</title>
	<meta name="description" content={defaultDescription} />

	<meta property="og:title" content={siteName} />
	<meta property="og:description" content={defaultDescription} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://daoism.systems" />
</svelte:head>

{#if !hideUI}
	<Cursor />
	<SlideTooltip />
	<Preloader />
	<LandscapeOverlay />
{/if}

{@render children()}
