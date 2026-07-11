import { browser } from '$app/environment';
import { get, writable, type Writable } from 'svelte/store';

export const SMOKE_TRANSITION_FILL_MS = 520;
export const SMOKE_TRANSITION_SETTLE_MS = 0;
export const SMOKE_TRANSITION_REVEAL_MS = 640;
export const SMOKE_BACKGROUND_SMOOTHING_MS = 220;
export const SMOKE_BACKGROUND_APERTURE_SMOOTHING_MS = 300;
export const SMOKE_BACKGROUND_FILL_SMOOTHING_MS = 260;

export type SmokeTransitionStage = 'idle' | 'covering' | 'revealing';

type SmokeTransitionState = {
	active: boolean;
	stage: SmokeTransitionStage;
	progress: number;
	sequence: number;
};

const INITIAL_STATE: SmokeTransitionState = {
	active: false,
	stage: 'idle',
	progress: 0,
	sequence: 0
};

export const fullScreenSmokeTransition = writable<SmokeTransitionState>(INITIAL_STATE);
export const fullScreenSmokeBackgroundProgress = writable(0);
export const fullScreenSmokeBackgroundAperture = writable(0);
export const fullScreenSmokeBackgroundFillProgress = writable(0);

let isSmokeTransitionRunning = false;

type SmoothedScalarController = {
	frameId: number | null;
	current: number;
	target: number;
	smoothingMs: number;
	snapThreshold: number;
	store: Writable<number>;
};

const wait = (durationMs: number) =>
	new Promise<void>((resolve) => {
		if (!browser || durationMs <= 0) {
			resolve();
			return;
		}

		window.setTimeout(resolve, durationMs);
	});

const nextFrame = () =>
	new Promise<void>((resolve) => {
		if (!browser) {
			resolve();
			return;
		}

		requestAnimationFrame(() => resolve());
	});

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeOutQuint = (value: number) => 1 - Math.pow(1 - clamp01(value), 5);
const easeInOutCubic = (value: number) => {
	const t = clamp01(value);
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const createSmoothedScalarController = (
	store: Writable<number>,
	smoothingMs: number,
	snapThreshold: number
): SmoothedScalarController => ({
	frameId: null,
	current: 0,
	target: 0,
	smoothingMs,
	snapThreshold,
	store
});

const updateSmoothedScalar = (controller: SmoothedScalarController, value: number) => {
	const nextValue = clamp01(value);
	controller.target = nextValue;

	const prefersReducedMotion =
		browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (!browser || prefersReducedMotion) {
		controller.current = nextValue;
		controller.store.set(nextValue);
		return;
	}

	if (controller.frameId !== null) return;

	let lastTimestamp = performance.now();
	const tick = (timestamp: number) => {
		const delta = Math.max(0, timestamp - lastTimestamp);
		lastTimestamp = timestamp;
		const ease = 1 - Math.exp(-delta / controller.smoothingMs);
		controller.current += (controller.target - controller.current) * ease;

		if (Math.abs(controller.target - controller.current) <= controller.snapThreshold) {
			controller.current = controller.target;
			controller.store.set(controller.current);
			controller.frameId = null;
			return;
		}

		controller.store.set(controller.current);
		controller.frameId = requestAnimationFrame(tick);
	};

	controller.frameId = requestAnimationFrame(tick);
};

const backgroundProgressController = createSmoothedScalarController(
	fullScreenSmokeBackgroundProgress,
	SMOKE_BACKGROUND_SMOOTHING_MS,
	0.0015
);
const backgroundApertureController = createSmoothedScalarController(
	fullScreenSmokeBackgroundAperture,
	SMOKE_BACKGROUND_APERTURE_SMOOTHING_MS,
	0.001
);
const backgroundFillController = createSmoothedScalarController(
	fullScreenSmokeBackgroundFillProgress,
	SMOKE_BACKGROUND_FILL_SMOOTHING_MS,
	0.0015
);

const getDurations = () => {
	const prefersReducedMotion =
		browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	if (prefersReducedMotion) {
		return {
			fillMs: 140,
			settleMs: 0,
			revealMs: 160
		};
	}

	return {
		fillMs: SMOKE_TRANSITION_FILL_MS,
		settleMs: SMOKE_TRANSITION_SETTLE_MS,
		revealMs: SMOKE_TRANSITION_REVEAL_MS
	};
};

export function isFullScreenSmokeTransitionRunning() {
	return isSmokeTransitionRunning;
}

export function setFullScreenSmokeBackgroundProgress(value: number) {
	updateSmoothedScalar(backgroundProgressController, value);
}

export function setFullScreenSmokeBackgroundAperture(value: number) {
	updateSmoothedScalar(backgroundApertureController, value);
}

export function setFullScreenSmokeBackgroundFillProgress(value: number) {
	updateSmoothedScalar(backgroundFillController, value);
}

async function animateSmokeProgress(params: {
	from: number;
	to: number;
	durationMs: number;
	stage: Exclude<SmokeTransitionStage, 'idle'>;
	sequence: number;
	easing: (value: number) => number;
}) {
	const { from, to, durationMs, stage, sequence, easing } = params;

	if (!browser || durationMs <= 0) {
		fullScreenSmokeTransition.set({
			active: to > 0,
			stage: to > 0 ? stage : 'idle',
			progress: clamp01(to),
			sequence
		});
		return;
	}

	return await new Promise<void>((resolve) => {
		const startedAt = performance.now();

		const tick = (now: number) => {
			const elapsed = now - startedAt;
			const progress = clamp01(elapsed / durationMs);
			const easedProgress = easing(progress);
			const currentValue = from + (to - from) * easedProgress;

			fullScreenSmokeTransition.set({
				active: currentValue > 0.001 || to > 0,
				stage: currentValue > 0.001 || to > 0 ? stage : 'idle',
				progress: clamp01(currentValue),
				sequence
			});

			if (progress >= 1) {
				resolve();
				return;
			}

			requestAnimationFrame(tick);
		};

		requestAnimationFrame(tick);
	});
}

export async function runFullScreenSmokeTransition<T>(
	task: () => Promise<T> | T
): Promise<T | undefined> {
	if (!browser) {
		return await task();
	}

	if (isSmokeTransitionRunning) return undefined;

	isSmokeTransitionRunning = true;
	const { fillMs, settleMs, revealMs } = getDurations();
	const sequence = get(fullScreenSmokeTransition).sequence + 1;

	let result: T | undefined;
	let error: unknown;

	fullScreenSmokeTransition.set({
		active: true,
		stage: 'covering',
		progress: 0,
		sequence
	});

	await nextFrame();
	await animateSmokeProgress({
		from: 0,
		to: 1,
		durationMs: fillMs,
		stage: 'covering',
		sequence,
		easing: easeOutQuint
	});

	await wait(settleMs);

	try {
		result = await task();
	} catch (caughtError) {
		error = caughtError;
	}

	fullScreenSmokeTransition.set({
		active: true,
		stage: 'revealing',
		progress: 1,
		sequence
	});

	await nextFrame();
	await animateSmokeProgress({
		from: 1,
		to: 0,
		durationMs: revealMs,
		stage: 'revealing',
		sequence,
		easing: easeInOutCubic
	});

	fullScreenSmokeTransition.set({
		active: false,
		stage: 'idle',
		progress: 0,
		sequence
	});

	isSmokeTransitionRunning = false;

	if (error) throw error;

	return result;
}
