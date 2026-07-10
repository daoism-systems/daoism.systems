import { clamp, clearStyles } from './helpers';
import { scaleMotionDuration, useMotionBlur } from './motion';

// Cubic-bezier equivalent of GSAP's `power2.out` (≡ easeOutCubic).
const POWER2_OUT_BEZIER = 'cubic-bezier(0.33, 1, 0.68, 1)';

type CardRevealParams = {
	startViewport?: number;
	endViewport?: number;
	ease?: string;
	mobileBreakpoint?: number;
	fromDirection?: 'top' | 'bottom';
};

type TweenSpec = {
	el: HTMLElement;
	xPercent?: number;
	yPercent?: number;
	scale?: number;
	filter?: string;
	offsetMs: number;
	durationMs: number;
};

const composeTransform = (opts: {
	xPercent?: number;
	yPercent?: number;
	scale?: number;
}): string => {
	const x = opts.xPercent ?? 0;
	const y = opts.yPercent ?? 0;
	const parts = [`translate3d(${x}%, ${y}%, 0)`];
	if (opts.scale !== undefined) parts.push(`scale(${opts.scale})`);
	return parts.join(' ');
};

export function cardReveal(node: HTMLElement, initialParams: CardRevealParams = {}) {
	let params = initialParams;
	let animations: Animation[] = [];
	let timelineDurationMs = 0;
	let rafId = 0;
	let lastRafTime = 0;
	let lastIsMobile: boolean | null = null;
	let isMobileMode = false;
	let isInViewport = true;
	let isDocumentVisible =
		typeof document === 'undefined' ? true : document.visibilityState === 'visible';
	let intersectionObserver: IntersectionObserver | null = null;
	let smoothedTime = 0;
	let isActivelyAnimating = false;

	const SCRUB_SMOOTHING_MS = scaleMotionDuration(110, 1.65);
	const getIsMobile = () => window.innerWidth < (params.mobileBreakpoint ?? 1024);
	const shouldRebuild = (prev: CardRevealParams, next: CardRevealParams): boolean =>
		prev.ease !== next.ease ||
		prev.mobileBreakpoint !== next.mobileBreakpoint ||
		prev.fromDirection !== next.fromDirection;

	const icon = (node.querySelector('.card__icon img, .card__icon svg') ||
		node.querySelector('.card__icon')) as HTMLElement | null;
	const category = node.querySelector<HTMLElement>('.card__desc span');
	const title = node.querySelector<HTMLElement>('.card__desc h4');
	const subtitle = node.querySelector<HTMLElement>('.card__desc p');
	const number = node.querySelector<HTMLElement>('.card__number');
	const targets = [node, icon, category, title, subtitle, number].filter(Boolean) as HTMLElement[];

	const setWillChange = (active: boolean) => {
		if (active === isActivelyAnimating) return;
		isActivelyAnimating = active;
		for (const t of targets) {
			t.style.willChange = active ? 'transform, opacity, filter' : 'auto';
		}
	};

	const getRevealProgress = () => {
		const rect = node.getBoundingClientRect();
		if (isMobileMode) {
			const vw = window.innerWidth || 1;
			const startX = vw * (params.startViewport ?? 0.86);
			const endX = vw * (params.endViewport ?? 0.55);
			const distance = Math.max(startX - endX, 1);
			return clamp(0, 1, (startX - rect.left) / distance);
		}
		const vh = window.innerHeight || 1;
		const startY = vh * (params.startViewport ?? 1);
		const endY = vh * (params.endViewport ?? 0.7);
		const distance = Math.max(startY - endY, 1);
		return clamp(0, 1, (startY - rect.top) / distance);
	};

	const updateFromViewport = (forceSnap = false, frameDeltaMs = 16) => {
		if (!animations.length || !timelineDurationMs) return;
		const targetTime = getRevealProgress() * timelineDurationMs;

		if (forceSnap) {
			smoothedTime = targetTime;
		} else {
			const dt = clamp(0, 64, frameDeltaMs);
			const alpha = 1 - Math.exp(-dt / SCRUB_SMOOTHING_MS);
			smoothedTime += (targetTime - smoothedTime) * alpha;
			if (Math.abs(targetTime - smoothedTime) < 0.5) smoothedTime = targetTime;
		}

		const isMidAnim = smoothedTime > 0.001 && smoothedTime < timelineDurationMs - 0.001;
		setWillChange(isMidAnim);

		for (const anim of animations) {
			anim.currentTime = smoothedTime;
		}
	};

	const shouldRunRafLoop = () => animations.length > 0 && isInViewport && isDocumentVisible;

	const stopRafLoop = () => {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		lastRafTime = 0;
	};

	const startRafLoop = () => {
		if (rafId || !shouldRunRafLoop()) return;
		const tick = (now: number) => {
			if (!shouldRunRafLoop()) {
				stopRafLoop();
				return;
			}
			if (!lastRafTime) lastRafTime = now;
			const frameDeltaMs = now - lastRafTime;
			lastRafTime = now;
			updateFromViewport(false, frameDeltaMs);
			rafId = requestAnimationFrame(tick);
		};
		lastRafTime = 0;
		rafId = requestAnimationFrame(tick);
	};

	const syncRafLoop = () => {
		if (shouldRunRafLoop()) startRafLoop();
		else stopRafLoop();
	};

	const destroyAnimations = () => {
		stopRafLoop();
		setWillChange(false);
		for (const anim of animations) anim.cancel();
		animations = [];
		timelineDurationMs = 0;
	};

	const clearAllStyles = () => {
		for (const el of targets) {
			clearStyles(el, ['transform', 'opacity', 'visibility', 'filter', 'will-change']);
		}
	};

	const buildTweens = (): TweenSpec[] => {
		const revealDurationMs = scaleMotionDuration(1) * 1000;
		const revealStaggerMs = scaleMotionDuration(0.12) * 1000;
		const startBlur = useMotionBlur() ? 'blur(12px)' : undefined;
		const titleBlur = useMotionBlur() ? 'blur(4px)' : undefined;
		const startScale = 0.94;
		const verticalOffsetSign = params.fromDirection === 'bottom' ? 1 : -1;

		const tweens: TweenSpec[] = [];

		if (isMobileMode) {
			tweens.push({
				el: node,
				yPercent: verticalOffsetSign * 24,
				scale: startScale,
				filter: startBlur,
				offsetMs: 0,
				durationMs: revealDurationMs
			});
			if (icon) {
				tweens.push({
					el: icon,
					yPercent: verticalOffsetSign * 22,
					scale: startScale,
					offsetMs: 0,
					durationMs: revealDurationMs
				});
			}
			if (number) {
				tweens.push({
					el: number,
					yPercent: verticalOffsetSign * 18,
					offsetMs: 0,
					durationMs: revealDurationMs
				});
			}
			if (category) {
				tweens.push({
					el: category,
					yPercent: verticalOffsetSign * 14,
					offsetMs: 90,
					durationMs: revealDurationMs
				});
			}
			const titleParts = [title, subtitle].filter(Boolean) as HTMLElement[];
			titleParts.forEach((el, i) => {
				tweens.push({
					el,
					yPercent: verticalOffsetSign * 16,
					filter: titleBlur,
					offsetMs: 150 + i * revealStaggerMs,
					durationMs: revealDurationMs
				});
			});
		} else {
			tweens.push({
				el: node,
				xPercent: -20,
				scale: startScale,
				filter: startBlur,
				offsetMs: 0,
				durationMs: revealDurationMs
			});
			if (icon) {
				tweens.push({
					el: icon,
					xPercent: -18,
					scale: startScale,
					offsetMs: 0,
					durationMs: revealDurationMs
				});
			}
			if (number) {
				tweens.push({
					el: number,
					xPercent: -12,
					offsetMs: 0,
					durationMs: revealDurationMs
				});
			}
			if (category) {
				tweens.push({
					el: category,
					xPercent: -10,
					offsetMs: 90,
					durationMs: revealDurationMs
				});
			}
			const titleParts = [title, subtitle].filter(Boolean) as HTMLElement[];
			titleParts.forEach((el, i) => {
				tweens.push({
					el,
					xPercent: -14,
					filter: titleBlur,
					offsetMs: 150 + i * revealStaggerMs,
					durationMs: revealDurationMs
				});
			});
		}

		return tweens;
	};

	// Build a 3-keyframe sequence so that visibility flips to `visible` at the
	// start of the tween (mirroring GSAP's `autoAlpha` behavior) instead of at
	// the WAAPI default discrete switch point of 0.5.
	const buildKeyframes = (t: TweenSpec): Keyframe[] => {
		const fromTransform = composeTransform({
			xPercent: t.xPercent,
			yPercent: t.yPercent,
			scale: t.scale
		});
		const toTransform = composeTransform({
			scale: t.scale !== undefined ? 1 : undefined
		});

		const fromKf: Keyframe = {
			transform: fromTransform,
			opacity: 0,
			visibility: 'hidden',
			offset: 0
		};
		const stepKf: Keyframe = {
			transform: fromTransform,
			opacity: 0,
			visibility: 'visible',
			offset: 0.001
		};
		const toKf: Keyframe = {
			transform: toTransform,
			opacity: 1,
			visibility: 'visible',
			offset: 1
		};

		if (t.filter) {
			fromKf.filter = t.filter;
			stepKf.filter = t.filter;
			toKf.filter = 'none';
		}

		return [fromKf, stepKf, toKf];
	};

	const createAnimations = () => {
		destroyAnimations();
		if (typeof window === 'undefined') return;

		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			clearAllStyles();
			return;
		}

		const isMobile = getIsMobile();
		isMobileMode = isMobile;
		lastIsMobile = isMobile;
		smoothedTime = 0;

		clearAllStyles();

		// Defaulting to power2.out instead of expo.out: expo creates a harsh
		// wall at the end of a scrubbed animation; power2 feels more organic.
		const ease = params.ease ?? POWER2_OUT_BEZIER;
		const tweens = buildTweens();

		let maxEnd = 0;
		for (const t of tweens) {
			const end = t.offsetMs + t.durationMs;
			if (end > maxEnd) maxEnd = end;

			const anim = t.el.animate(buildKeyframes(t), {
				duration: t.durationMs,
				easing: ease,
				fill: 'both',
				delay: t.offsetMs
			});
			anim.pause();
			animations.push(anim);
		}

		timelineDurationMs = maxEnd;

		updateFromViewport(true);
		syncRafLoop();
	};

	createAnimations();

	const onVisibilityChange = () => {
		isDocumentVisible = document.visibilityState === 'visible';
		syncRafLoop();
	};

	if (typeof IntersectionObserver !== 'undefined') {
		intersectionObserver = new IntersectionObserver(
			(entries) => {
				isInViewport = Boolean(entries[0]?.isIntersecting);
				if (isInViewport) updateFromViewport(true);
				syncRafLoop();
			},
			{ threshold: 0.01 }
		);
		intersectionObserver.observe(node);
	}

	document.addEventListener('visibilitychange', onVisibilityChange);

	const onResize = () => {
		const isMobile = getIsMobile();
		if (isMobile !== lastIsMobile) {
			createAnimations();
			return;
		}
		updateFromViewport(true);
	};
	window.addEventListener('resize', onResize);

	return {
		update(newParams: CardRevealParams) {
			const rebuild = shouldRebuild(params, newParams);
			params = newParams;
			if (rebuild) {
				createAnimations();
				return;
			}
			if (animations.length) updateFromViewport(true);
		},
		destroy() {
			window.removeEventListener('resize', onResize);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			intersectionObserver?.disconnect();
			intersectionObserver = null;
			destroyAnimations();
			clearAllStyles();
		}
	};
}
