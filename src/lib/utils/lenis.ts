import Lenis, { type VirtualScrollData } from 'lenis';
import { detectAndroid } from '$lib/utils/isMobile';

export const SCROLL_TO_EASING = (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t));

const WHEEL_DELTA_SOFT_CAP_DESKTOP = 42;
const WHEEL_DELTA_SOFT_CAP_MOBILE = 34;

export const DESKTOP_LENIS_CONFIG = {
	lerp: 0.055,
	syncTouchLerp: 0.055,
	wheelMultiplier: 0.62,
	touchMultiplier: 0.9
} as const;

// iOS uses syncTouch: false so WebKit's native momentum (paired with
// -webkit-overflow-scrolling: touch on the wrapper) drives touch input.
// Android Blink can't natively scroll our position:fixed wrapper from
// touches on its position:fixed children, so on Android we flip syncTouch
// on and let Lenis animate the scroll itself — see ANDROID_LENIS_TOUCH_CONFIG.
export const MOBILE_LENIS_CONFIG = {
	lerp: 0.1,
	wheelMultiplier: 0.45
} as const;

// Tuned for finger drag rather than wheel: snappier lerp than wheel and a
// higher multiplier so a swipe travels roughly the distance it would under
// native momentum.
const ANDROID_LENIS_TOUCH_CONFIG = {
	syncTouchLerp: 0.1,
	touchMultiplier: 1.4
} as const;

const clampProgress = (value: number) => Math.min(1, Math.max(0, value));

const compressWheelDelta = (deltaY: number, softCap: number) =>
	Math.sign(deltaY) * softCap * Math.tanh(Math.abs(deltaY) / softCap);

export type LenisControllerOptions = {
	isMobile: boolean;
	mapToSceneProgress: (progress: number) => number;
	onCameraProgress: (sceneProgress: number) => void;
	onScrollUpdate: (progress: number, animatedScroll: number) => void;
};

export type LenisController = {
	lenis: Lenis;
	startRaf: () => void;
	stopRaf: () => void;
	getCurrentProgress: () => number;
	resetProgress: () => void;
	destroy: () => void;
};

export function createLenisController(
	wrapper: HTMLElement,
	content: HTMLElement,
	options: LenisControllerOptions
): LenisController {
	let currentProgress = 0;
	let lastAnimatedScroll = 0;
	let storeUpdateRafId: number | null = null;
	let rafId: number | null = null;
	const isMobile = options.isMobile;
	const isAndroid = detectAndroid();
	const useSyncTouch = !isMobile || isAndroid;
	const wheelDeltaSoftCap = isMobile ? WHEEL_DELTA_SOFT_CAP_MOBILE : WHEEL_DELTA_SOFT_CAP_DESKTOP;

	const lenis = new Lenis({
		wrapper,
		content,
		eventsTarget: wrapper,
		gestureOrientation: 'vertical',
		smoothWheel: true,
		infinite: false,
		overscroll: false,
		virtualScroll: handleVirtualScroll,
		lerp: isMobile ? MOBILE_LENIS_CONFIG.lerp : DESKTOP_LENIS_CONFIG.lerp,
		wheelMultiplier: isMobile
			? MOBILE_LENIS_CONFIG.wheelMultiplier
			: DESKTOP_LENIS_CONFIG.wheelMultiplier,
		syncTouch: useSyncTouch,
		...(useSyncTouch && {
			syncTouchLerp: isAndroid
				? ANDROID_LENIS_TOUCH_CONFIG.syncTouchLerp
				: DESKTOP_LENIS_CONFIG.syncTouchLerp,
			touchMultiplier: isAndroid
				? ANDROID_LENIS_TOUCH_CONFIG.touchMultiplier
				: DESKTOP_LENIS_CONFIG.touchMultiplier
		})
	});

	function handleVirtualScroll(eventData: VirtualScrollData) {
		const isTouchEvent = typeof TouchEvent !== 'undefined' && eventData.event instanceof TouchEvent;

		if (!isTouchEvent && typeof eventData.deltaY === 'number') {
			eventData.deltaY = compressWheelDelta(eventData.deltaY, wheelDeltaSoftCap);
		}

		return true;
	}

	lenis.on('scroll', (e) => {
		const maxScrollableDistance = Math.max(1, e.dimensions.scrollHeight - e.dimensions.height);
		const progress = clampProgress(e.animatedScroll / maxScrollableDistance);

		lastAnimatedScroll = e.animatedScroll;

		if (Math.abs(progress - currentProgress) < 0.0001) return;

		currentProgress = progress;
		options.onCameraProgress(options.mapToSceneProgress(progress));

		if (storeUpdateRafId === null) {
			storeUpdateRafId = requestAnimationFrame(() => {
				storeUpdateRafId = null;
				options.onScrollUpdate(currentProgress, lastAnimatedScroll);
			});
		}
	});

	const animateWithRaf = (time: number) => {
		lenis.raf(time);
		rafId = requestAnimationFrame(animateWithRaf);
	};

	function startRaf() {
		if (rafId !== null) return;
		rafId = requestAnimationFrame(animateWithRaf);
	}

	function stopRaf() {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	}

	function getCurrentProgress() {
		return currentProgress;
	}

	function resetProgress() {
		currentProgress = 0;
		if (storeUpdateRafId !== null) {
			cancelAnimationFrame(storeUpdateRafId);
			storeUpdateRafId = null;
		}
	}

	function destroy() {
		stopRaf();
		if (storeUpdateRafId !== null) {
			cancelAnimationFrame(storeUpdateRafId);
			storeUpdateRafId = null;
		}
		lenis.destroy();
	}

	return { lenis, startRaf, stopRaf, getCurrentProgress, resetProgress, destroy };
}
