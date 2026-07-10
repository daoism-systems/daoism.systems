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

const CAMERA_PROGRESS_EPSILON = 0.0004;
const SCROLL_PROGRESS_EPSILON = 0.0004;
const SCROLL_POSITION_EPSILON = 0.25;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export async function createSiteRuntime(options: SiteRuntimeOptions): Promise<SiteRuntime> {
	let scene: MainScene | null = null;
	let isDestroyed = false;
	let lastSceneProgressSent = -1;
	let lastScrollProgressSent = -1;
	let lastScrollPositionSent = -1;
	let previousStep = 0;
	let bodyClickHandler: ((event: MouseEvent) => void) | null = null;
	const previousDocumentOverflow = document.documentElement.style.overflow;
	const previousBodyOverflow = document.body.style.overflow;

	const emitProgress = (globalProgress: number, animatedScroll = 0) => {
		const pageProgress = options.calculatePageProgress(globalProgress);

		options.onScrollProgress(globalProgress);
		options.onPageProgress(pageProgress);
		scene?.setActivePageSection(pageProgress.step, pageProgress.value);

		if (pageProgress.step !== previousStep) {
			if (!sfx.isPlaying(SFX_KEY.transition)) sfx.play(SFX_KEY.transition);
			previousStep = pageProgress.step;
		}

		scrollY.set(globalProgress);
		scrollPosition.set(animatedScroll);
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
			onCameraProgress: (sceneProgress) => {
				if (!scene) return;
				if (Math.abs(sceneProgress - lastSceneProgressSent) < CAMERA_PROGRESS_EPSILON) return;
				lastSceneProgressSent = sceneProgress;
				scene.setCameraProgress(sceneProgress * 100);
			},
			onScrollUpdate: (progress, animatedScroll) => {
				if (Math.abs(progress - lastScrollProgressSent) >= SCROLL_PROGRESS_EPSILON) {
					lastScrollProgressSent = progress;
					options.onScrollProgress(progress);
					scrollY.set(progress);
				}

				if (Math.abs(animatedScroll - lastScrollPositionSent) >= SCROLL_POSITION_EPSILON) {
					lastScrollPositionSent = animatedScroll;
					scrollPosition.set(animatedScroll);
				}

				const pageProgress = options.calculatePageProgress(progress);
				options.onPageProgress(pageProgress);
				scene?.setActivePageSection(pageProgress.step, pageProgress.value);

				if (pageProgress.step !== previousStep) {
					if (!sfx.isPlaying(SFX_KEY.transition)) sfx.play(SFX_KEY.transition);
					previousStep = pageProgress.step;
				}
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
		lastSceneProgressSent = -1;
		lastScrollProgressSent = -1;
		lastScrollPositionSent = -1;
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

		lastSceneProgressSent = -1;
		lastScrollProgressSent = -1;
		scene.setCameraProgress(options.mapToSceneProgress(progress) * 100);

		const pageProgress = options.calculatePageProgress(progress);
		options.onPageProgress(pageProgress);
		scene.setActivePageSection(pageProgress.step, pageProgress.value);
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
