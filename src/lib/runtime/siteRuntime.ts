import { get } from 'svelte/store';
import type { MainScene, ProgressData } from '$lib/scene/MainScene';
import { createLenisController, type LenisController } from '$lib/utils/lenis';
import {
	canScroll,
	lenisInstance,
	loadingFinish,
	scrollPosition,
	scrollY,
	showPreloader
} from '$lib/store.svelte';
import { sfx, SFX_KEY } from '$lib/utils/sfx';

type RouteRuntimeData = {
	preset: number;
	sceneHidden: boolean;
	uiHidden: boolean;
};

export type SiteRuntimeOptions = {
	scrollWrapper: HTMLElement;
	scrollContainer: HTMLElement;
	sceneContainer: HTMLElement | null;
	isMobile: boolean;
	data: RouteRuntimeData;
	calculatePageProgress: (globalProgress: number) => ProgressData;
	mapToSceneProgress: (globalProgress: number) => number;
	onPageProgress: (pageProgress: ProgressData) => void;
	onScrollProgress: (globalProgress: number) => void;
	isCancelled?: () => boolean;
};

export type SiteRuntime = {
	scrollToProgress: (progress: number) => void;
	setScrollEnabled: (enabled: boolean) => void;
	refresh: () => void;
	destroy: () => void;
};

// Lenis emits every frame and keeps lerping for ~1-2s after a flick, so every
// consumer below is epsilon-gated: re-publishing an unchanged value costs a
// Svelte invalidation or a scene write per frame for the whole momentum tail.
const CAMERA_PROGRESS_EPSILON = 0.0004;
const SCROLL_PROGRESS_EPSILON = 0.0004;
const PAGE_PROGRESS_EPSILON = 0.0004;
const SCROLL_POSITION_EPSILON = 0.25;

// "Nothing published yet" — the next value always clears the gate.
const UNSENT = -1;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export async function createSiteRuntime(options: SiteRuntimeOptions): Promise<SiteRuntime> {
	let scene: MainScene | null = null;
	let isDestroyed = false;
	let bodyClickHandler: ((event: MouseEvent) => void) | null = null;
	const previousDocumentOverflow = document.documentElement.style.overflow;
	const previousBodyOverflow = document.body.style.overflow;

	// Last value handed to each consumer, so each can be gated independently.
	let sentSceneProgress = UNSENT;
	let sentScrollProgress = UNSENT;
	let sentScrollPosition = UNSENT;
	let sentPageProgress = UNSENT;
	let previousStep = 0;

	const moved = (next: number, sent: number, epsilon: number) =>
		sent === UNSENT || Math.abs(next - sent) >= epsilon;

	/** Camera scrub — scene-side only, no DOM cost. */
	const publishSceneProgress = (sceneProgress: number) => {
		if (!scene || !moved(sceneProgress, sentSceneProgress, CAMERA_PROGRESS_EPSILON)) return;
		sentSceneProgress = sceneProgress;
		scene.setCameraProgress(sceneProgress * 100);
	};

	/** Scrollbar, tracker, scroll-driven components — plain numbers, cheap. */
	const publishScrollProgress = (progress: number, force = false) => {
		if (!force && !moved(progress, sentScrollProgress, SCROLL_PROGRESS_EPSILON)) return;
		sentScrollProgress = progress;
		options.onScrollProgress(progress);
		scrollY.set(progress);
	};

	/** Pixel offset for anything positioned against the virtual scroll height. */
	const publishScrollPosition = (animatedScroll: number, force = false) => {
		if (!force && !moved(animatedScroll, sentScrollPosition, SCROLL_POSITION_EPSILON)) return;
		sentScrollPosition = animatedScroll;
		scrollPosition.set(animatedScroll);
	};

	/**
	 * Section UI — the costly consumer. `calculatePageProgress` returns a fresh
	 * object and the page assigns it into `$state`, so Svelte invalidates on
	 * identity: an unchanged value still re-renders every mounted section.
	 * A step change always publishes, so a section transition is never held back
	 * by the epsilon.
	 */
	const publishPageProgress = (progress: number, force = false) => {
		const pageProgress = options.calculatePageProgress(progress);
		const stepChanged = pageProgress.step !== previousStep;

		if (force || stepChanged || moved(progress, sentPageProgress, PAGE_PROGRESS_EPSILON)) {
			sentPageProgress = progress;
			options.onPageProgress(pageProgress);
			scene?.setActivePageSection(pageProgress.step, pageProgress.value);
		}

		if (stepChanged) {
			previousStep = pageProgress.step;
			if (!sfx.isPlaying(SFX_KEY.transition)) sfx.play(SFX_KEY.transition);
		}
	};

	/** Seed or force-sync every consumer — initial paint and programmatic jumps. */
	const emitProgress = (globalProgress: number, animatedScroll = 0) => {
		publishScrollProgress(globalProgress, true);
		publishPageProgress(globalProgress, true);
		publishScrollPosition(animatedScroll, true);
	};

	document.documentElement.style.overflow = 'hidden';
	document.body.style.overflow = 'hidden';
	emitProgress(0, 0);

	const lenisController: LenisController = createLenisController(
		options.scrollWrapper,
		options.scrollContainer,
		{
			isMobile: options.isMobile,
			mapToSceneProgress: options.mapToSceneProgress,
			onCameraProgress: publishSceneProgress,
			onScrollUpdate: (progress, animatedScroll) => {
				publishScrollProgress(progress);
				publishScrollPosition(animatedScroll);
				publishPageProgress(progress);
			}
		}
	);

	lenisInstance.instance = lenisController.lenis;

	if (options.data.uiHidden) {
		canScroll.set(true);
		loadingFinish.set(true);
		showPreloader.set(false);
	}

	if (!options.data.sceneHidden && options.sceneContainer) {
		const SceneModule = await import('$lib/scene/MainScene');
		if (isDestroyed || options.isCancelled?.()) {
			destroy();
			return createDestroyedRuntime();
		}
		scene = new SceneModule.MainScene();
		scene.init(options.data.preset);
		scene.setLenisInstance(lenisController.lenis);
	}

	lenisController.lenis.scrollTo(0, { immediate: true, force: true });

	bodyClickHandler = (event: MouseEvent) => {
		const isInteractive = (event.target as HTMLElement).closest('button, a');
		sfx.play(isInteractive ? SFX_KEY.clickAlt : SFX_KEY.click);
	};
	document.body.addEventListener('click', bodyClickHandler);

	function setScrollEnabled(enabled: boolean) {
		if (isDestroyed) return;

		if (enabled) {
			scene ? lenisController.stopRaf() : lenisController.startRaf();
			lenisController.lenis.start();
			return;
		}

		lenisController.stopRaf();
		lenisController.lenis.stop();
		lenisController.lenis.scrollTo(0, { immediate: true, force: true });
		lenisController.resetProgress();
		sentSceneProgress = UNSENT;
		emitProgress(0, 0);
	}

	function scrollToProgress(progress: number) {
		if (!get(canScroll)) return;
		const lenis = lenisController.lenis;
		const dims = lenis.dimensions;
		const targetScroll = clamp01(progress) * Math.max(1, dims.scrollHeight - dims.height);
		lenis.scrollTo(targetScroll, { immediate: true });
	}

	// Re-run the scroll-tick drive at the CURRENT scroll position, without a scroll
	// event. Used when Theatre `Scene Boundaries` retiming changes the scroll→scene
	// map so the 3D camera + page step follow the new boundaries immediately.
	function refresh() {
		if (isDestroyed || !scene) return;
		const lenis = lenisController.lenis;
		const dims = lenis.dimensions;
		const progress = clamp01(lenis.animatedScroll / Math.max(1, dims.scrollHeight - dims.height));

		sentSceneProgress = UNSENT;
		publishSceneProgress(options.mapToSceneProgress(progress));
		publishPageProgress(progress, true);
	}

	function destroy() {
		if (isDestroyed) return;
		isDestroyed = true;
		lenisController.destroy();
		if (lenisInstance.instance === lenisController.lenis) {
			lenisInstance.instance = null;
		}
		if (bodyClickHandler) {
			document.body.removeEventListener('click', bodyClickHandler);
			bodyClickHandler = null;
		}
		if (scene) {
			scene.clearLenisInstance();
			scene.cleanup();
			scene = null;
		}
		document.documentElement.style.overflow = previousDocumentOverflow;
		document.body.style.overflow = previousBodyOverflow;
	}

	return {
		scrollToProgress,
		setScrollEnabled,
		refresh,
		destroy
	};
}

function createDestroyedRuntime(): SiteRuntime {
	return {
		scrollToProgress: () => {},
		setScrollEnabled: () => {},
		refresh: () => {},
		destroy: () => {}
	};
}
