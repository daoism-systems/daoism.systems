import {
	displayedLoadingProgress,
	loadingFinish,
	loadingProgress,
	preloaderTransitioning,
	showPreloader
} from '$lib/store.svelte';

const PRELOADER_SHOW_AT_MS = 1200;
const NAVIGATE_AT_MS = 1800;

export interface HomeTransitionDeps {
	triggerTransition: () => void;
	navigate: () => void;
	signal?: AbortSignal;
}

export async function runHomeTransition({
	triggerTransition,
	navigate,
	signal
}: HomeTransitionDeps): Promise<void> {
	triggerTransition();

	await wait(PRELOADER_SHOW_AT_MS, signal);
	loadingProgress.set(0);
	// displayedLoadingProgress is no longer derived from loadingProgress — the background-pattern
	// engine now drives it — so reset the number explicitly here before the engine remounts.
	displayedLoadingProgress.set(0);
	loadingFinish.set(false);
	preloaderTransitioning.set(true);
	showPreloader.set(true);

	await wait(NAVIGATE_AT_MS - PRELOADER_SHOW_AT_MS, signal);
	navigate();
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const id = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(id);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
