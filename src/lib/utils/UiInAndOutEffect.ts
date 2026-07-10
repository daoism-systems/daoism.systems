const HEADING_EFFECT_ATTR = 'data-heading-effect-id';
const HEADING_FILTER_ID_PREFIX = 'daoism-heading-goo-';
const HEADING_FILTER_DEFS_ID = 'daoism-heading-filter-defs';
const HEADING_FILTER_EFFECT_IDS = [1, 2, 3, 4, 5, 6, 7] as const;

export type HeadingFilterEffectId = (typeof HEADING_FILTER_EFFECT_IDS)[number];

type FilterPrimitiveValues = {
	stdDeviation: number;
	scale?: number;
	baseFrequency?: number;
};

type HeadingTextTweenValues = {
	opacity?: number;
	scale?: number;
	scaleX?: number;
	yPercent?: number;
};

type HeadingFilterEffectConfig = {
	duration: number;
	textDuration?: number;
	ease: string;
	primitiveFrom: FilterPrimitiveValues;
	primitiveTo: FilterPrimitiveValues;
	textFrom: HeadingTextTweenValues;
	textTo: HeadingTextTweenValues;
};

export type HeadingEffectController = {
	element: HTMLHeadingElement;
	play: (effectId: HeadingFilterEffectId) => void;
	playReverse: (effectId: HeadingFilterEffectId) => void;
	reset: () => void;
};

type HeadingEffectsConsoleApi = {
	play: (effectId?: number, target?: string | HTMLElement) => void;
	playReverse: (effectId?: number, target?: string | HTMLElement) => void;
	reset: (target?: string | HTMLElement) => void;
	headings: () => string[];
	effects: () => number[];
};

export type HeadingFilterTween = {
	kill: () => void;
};

type HeadingEffectsRuntime = {
	controllers: Map<string, HeadingEffectController>;
	instanceCounter: number;
	activeSectionTimeline: HeadingFilterTween | null;
	activeSectionElement: HTMLElement | null;
};

const HEADING_FILTER_EFFECTS: Record<HeadingFilterEffectId, HeadingFilterEffectConfig> = {
	1: {
		duration: 2,
		ease: 'expo',
		primitiveFrom: { stdDeviation: 50 },
		primitiveTo: { stdDeviation: 0 },
		textFrom: { opacity: 0 },
		textTo: { opacity: 1 }
	},
	2: {
		duration: 2,
		ease: 'expo',
		primitiveFrom: { stdDeviation: 20, scale: 100, baseFrequency: 0.1 },
		primitiveTo: { stdDeviation: 0, scale: 0, baseFrequency: 0.05 },
		textFrom: { opacity: 0 },
		textTo: { opacity: 1 }
	},
	3: {
		duration: 2,
		ease: 'power4',
		primitiveFrom: { stdDeviation: 40, scale: 150 },
		primitiveTo: { stdDeviation: 0, scale: 0 },
		textFrom: { opacity: 0, scale: 0.9 },
		textTo: { opacity: 1, scale: 1 }
	},
	4: {
		duration: 2,
		ease: 'expo',
		primitiveFrom: { stdDeviation: 70, scale: 200 },
		primitiveTo: { stdDeviation: 0, scale: 0 },
		textFrom: { opacity: 0 },
		textTo: { opacity: 1 }
	},
	5: {
		duration: 1.7,
		ease: 'expo',
		primitiveFrom: { stdDeviation: 40, scale: 100 },
		primitiveTo: { stdDeviation: 0, scale: 0 },
		textFrom: { opacity: 0, scale: 0.6 },
		textTo: { opacity: 1, scale: 1 }
	},
	6: {
		duration: 2,
		ease: 'expo',
		primitiveFrom: { stdDeviation: 90, scale: 300, baseFrequency: 0.1 },
		primitiveTo: { stdDeviation: 0, scale: 0, baseFrequency: 0.01 },
		textFrom: { opacity: 0, scaleX: 2.4 },
		textTo: { opacity: 1, scaleX: 1 }
	},
	7: {
		duration: 1.6,
		textDuration: 1.3,
		ease: 'expo',
		primitiveFrom: { stdDeviation: 35, scale: 250 },
		primitiveTo: { stdDeviation: 0, scale: 0 },
		textFrom: { opacity: 0, scale: 0.8, yPercent: 20 },
		textTo: { opacity: 1, scale: 1, yPercent: 0 }
	}
};

declare global {
	interface Window {
		headingEffects?: HeadingEffectsConsoleApi;
		__daoismHeadingEffects?: HeadingEffectsConsoleApi;
		__daoismHeadingEffectsRuntime?: HeadingEffectsRuntime;
	}
}

// JS easing functions matching GSAP's named-easing defaults (which are .out
// when no direction suffix is given).
const JS_EASINGS: Record<string, (t: number) => number> = {
	linear: (t) => t,
	none: (t) => t,
	expo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
	'expo.out': (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
	power4: (t) => 1 - Math.pow(1 - t, 5),
	'power4.out': (t) => 1 - Math.pow(1 - t, 5)
};

const jsEaseFor = (name: string): ((t: number) => number) => JS_EASINGS[name] ?? ((t) => t);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const interpolatePrimitives = (
	from: FilterPrimitiveValues,
	to: FilterPrimitiveValues,
	t: number
): FilterPrimitiveValues => {
	const result: FilterPrimitiveValues = {
		stdDeviation: lerp(from.stdDeviation, to.stdDeviation, t)
	};
	if (typeof from.scale === 'number' && typeof to.scale === 'number') {
		result.scale = lerp(from.scale, to.scale, t);
	}
	if (typeof from.baseFrequency === 'number' && typeof to.baseFrequency === 'number') {
		result.baseFrequency = lerp(from.baseFrequency, to.baseFrequency, t);
	}
	return result;
};

// Mirrors GSAP's transform composition for the props used by these effects:
// translate3d(0, yPercent%, 0) scale(scaleX, scaleY) — falling back to
// scaleX-only or scale-only when the other axis isn't tweened.
const composeTransformFromTween = (values: HeadingTextTweenValues): string | null => {
	const parts: string[] = [];
	if (values.yPercent !== undefined) parts.push(`translate3d(0, ${values.yPercent}%, 0)`);
	if (values.scaleX !== undefined && values.scale !== undefined) {
		parts.push(`scale(${values.scaleX}, ${values.scale})`);
	} else if (values.scaleX !== undefined) {
		parts.push(`scaleX(${values.scaleX})`);
	} else if (values.scale !== undefined) {
		parts.push(`scale(${values.scale})`);
	}
	return parts.length > 0 ? parts.join(' ') : null;
};

const interpolateTextValues = (
	from: HeadingTextTweenValues,
	to: HeadingTextTweenValues,
	t: number
): HeadingTextTweenValues => {
	const result: HeadingTextTweenValues = {};
	if (from.opacity !== undefined && to.opacity !== undefined)
		result.opacity = lerp(from.opacity, to.opacity, t);
	if (from.scale !== undefined && to.scale !== undefined)
		result.scale = lerp(from.scale, to.scale, t);
	if (from.scaleX !== undefined && to.scaleX !== undefined)
		result.scaleX = lerp(from.scaleX, to.scaleX, t);
	if (from.yPercent !== undefined && to.yPercent !== undefined)
		result.yPercent = lerp(from.yPercent, to.yPercent, t);
	return result;
};

const applyTextValues = (element: HTMLElement, values: HeadingTextTweenValues) => {
	if (values.opacity !== undefined) element.style.opacity = String(values.opacity);
	const transform = composeTransformFromTween(values);
	if (transform !== null) element.style.transform = transform;
};

function getHeadingEffectsRuntime() {
	if (typeof window === 'undefined') {
		return {
			controllers: new Map<string, HeadingEffectController>(),
			instanceCounter: 0,
			activeSectionTimeline: null,
			activeSectionElement: null
		};
	}

	if (!window.__daoismHeadingEffectsRuntime) {
		window.__daoismHeadingEffectsRuntime = {
			controllers: new Map<string, HeadingEffectController>(),
			instanceCounter: 0,
			activeSectionTimeline: null,
			activeSectionElement: null
		};
	}

	return window.__daoismHeadingEffectsRuntime;
}

function getHeadingEffectPrimitives(effectId: HeadingFilterEffectId) {
	const filterId = `${HEADING_FILTER_ID_PREFIX}${effectId}`;
	return {
		blur: document.querySelector<SVGFEGaussianBlurElement>(`#${filterId} feGaussianBlur`),
		turbulence: document.querySelector<SVGFETurbulenceElement>(`#${filterId} feTurbulence`),
		displacement: document.querySelector<SVGFEDisplacementMapElement>(
			`#${filterId} feDisplacementMap`
		)
	};
}

function applyHeadingFilterPrimitives(
	effectId: HeadingFilterEffectId,
	values: FilterPrimitiveValues
) {
	const primitives = getHeadingEffectPrimitives(effectId);
	primitives.blur?.setAttribute('stdDeviation', String(values.stdDeviation));
	if (typeof values.scale === 'number') {
		primitives.displacement?.setAttribute('scale', String(values.scale));
	}
	if (typeof values.baseFrequency === 'number') {
		primitives.turbulence?.setAttribute('baseFrequency', String(values.baseFrequency));
	}
}

function normalizeHeadingEffectId(effectId = 1): HeadingFilterEffectId | null {
	if (HEADING_FILTER_EFFECT_IDS.includes(effectId as HeadingFilterEffectId)) {
		return effectId as HeadingFilterEffectId;
	}
	console.warn(
		`Invalid heading effect id: ${effectId}. Available ids: ${HEADING_FILTER_EFFECT_IDS.join(', ')}`
	);
	return null;
}

function findHeadingControllerByElement(element: HTMLElement) {
	const runtime = getHeadingEffectsRuntime();
	for (const controller of runtime.controllers.values()) {
		if (controller.element === element) return controller;
	}
	return undefined;
}

function resolveHeadingController(target?: string | HTMLElement) {
	const runtime = getHeadingEffectsRuntime();
	if (target instanceof HTMLElement) {
		return findHeadingControllerByElement(target);
	}

	if (typeof target === 'string') {
		const byId = runtime.controllers.get(target);
		if (byId) return byId;

		const byAttr = document.querySelector<HTMLElement>(`h2[${HEADING_EFFECT_ATTR}="${target}"]`);
		if (byAttr) {
			const byAttrController = findHeadingControllerByElement(byAttr);
			if (byAttrController) return byAttrController;
		}

		const bySelector = document.querySelector<HTMLElement>(target);
		if (bySelector) {
			return findHeadingControllerByElement(bySelector);
		}
	}

	return runtime.controllers.values().next().value;
}

function getActiveSectionElement() {
	return document.querySelector<HTMLElement>('.section.active');
}

function clearTextInline(element: HTMLElement) {
	element.style.removeProperty('opacity');
	element.style.removeProperty('transform');
}

// Drives one combined SVG-primitive + text-style tween via rAF. Mirrors GSAP's
// `timeline.to(obj, ...).to(el, ...)` pattern that this file used to express,
// and supports the same forward and `progress(1).reverse()` flows.
function createHeadingFilterTween(
	element: HTMLElement,
	effectId: HeadingFilterEffectId,
	options: { direction: 'forward' | 'reverse' }
): HeadingFilterTween {
	const effect = HEADING_FILTER_EFFECTS[effectId];
	const primitiveDurationMs = effect.duration * 1000;
	const textDurationMs = (effect.textDuration ?? effect.duration) * 1000;
	const totalDurationMs = Math.max(primitiveDurationMs, textDurationMs);
	const ease = jsEaseFor(effect.ease);
	const isReverse = options.direction === 'reverse';

	let killed = false;
	let rafId = 0;
	let startTime: number | null = null;

	const applyAtElapsed = (elapsed: number) => {
		const rawPrim = Math.min(1, elapsed / primitiveDurationMs);
		const tPrim = isReverse ? 1 - rawPrim : rawPrim;
		applyHeadingFilterPrimitives(
			effectId,
			interpolatePrimitives(effect.primitiveFrom, effect.primitiveTo, ease(tPrim))
		);

		const rawText = Math.min(1, elapsed / textDurationMs);
		const tText = isReverse ? 1 - rawText : rawText;
		applyTextValues(
			element,
			interpolateTextValues(effect.textFrom, effect.textTo, ease(tText))
		);
	};

	const tick = (now: number) => {
		if (killed) return;
		if (startTime === null) startTime = now;
		const elapsed = now - startTime;
		applyAtElapsed(elapsed);
		if (elapsed >= totalDurationMs) {
			rafId = 0;
			return;
		}
		rafId = requestAnimationFrame(tick);
	};

	// Initial visual setup mirrors GSAP: apply FROM state to both primitives and
	// the element, then attach the SVG filter URL. For reverse, jump immediately
	// to TO state so the rAF loop animates back to FROM (the GSAP equivalent is
	// `timeline.progress(1).reverse()`).
	applyHeadingFilterPrimitives(effectId, effect.primitiveFrom);
	element.style.filter = `url(#${HEADING_FILTER_ID_PREFIX}${effectId})`;
	applyTextValues(element, effect.textFrom);

	if (isReverse) {
		applyHeadingFilterPrimitives(effectId, effect.primitiveTo);
		applyTextValues(element, effect.textTo);
	}

	rafId = requestAnimationFrame(tick);

	return {
		kill() {
			killed = true;
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
		}
	};
}

function resetActiveSectionEffect() {
	const runtime = getHeadingEffectsRuntime();
	runtime.activeSectionTimeline?.kill();
	runtime.activeSectionTimeline = null;

	if (runtime.activeSectionElement) {
		runtime.activeSectionElement.style.removeProperty('filter');
		clearTextInline(runtime.activeSectionElement);
		runtime.activeSectionElement = null;
	}
}

function playActiveSectionEffect(effectId: HeadingFilterEffectId) {
	const runtime = getHeadingEffectsRuntime();
	const activeSection = getActiveSectionElement();
	if (!activeSection) {
		console.warn('No active section found to play effect on.');
		return;
	}

	resetActiveSectionEffect();
	runtime.activeSectionElement = activeSection;
	runtime.activeSectionTimeline = createHeadingFilterTween(activeSection, effectId, {
		direction: 'forward'
	});
}

function playActiveSectionEffectReverse(effectId: HeadingFilterEffectId) {
	const runtime = getHeadingEffectsRuntime();
	const activeSection = getActiveSectionElement();
	if (!activeSection) {
		console.warn('No active section found to play reverse effect on.');
		return;
	}

	resetActiveSectionEffect();
	runtime.activeSectionElement = activeSection;
	runtime.activeSectionTimeline = createHeadingFilterTween(activeSection, effectId, {
		direction: 'reverse'
	});
}

export function ensureHeadingFilterDefs() {
	if (typeof document === 'undefined') return;
	if (document.getElementById(HEADING_FILTER_DEFS_ID)) return;

	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.id = HEADING_FILTER_DEFS_ID;
	svg.setAttribute('aria-hidden', 'true');
	svg.style.position = 'absolute';
	svg.style.width = '0';
	svg.style.height = '0';
	svg.style.overflow = 'hidden';

	svg.innerHTML = `
      <defs>
        <filter id="${HEADING_FILTER_ID_PREFIX}1">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blur"></feGaussianBlur>
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 1 0 1 0 0 0 0 0 13 -6" result="goo"></feColorMatrix>
          <feComposite in="SourceGraphic" in2="goo" operator="atop"></feComposite>
        </filter>
        <filter id="${HEADING_FILTER_ID_PREFIX}2">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blur"></feGaussianBlur>
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 1 0 1 0 0 0 0 0 12 -4" result="goo"></feColorMatrix>
          <feTurbulence type="turbulence" baseFrequency="1" numOctaves="1" seed="2" result="noise"></feTurbulence>
          <feDisplacementMap in="goo" in2="noise" scale="0" result="displacement"></feDisplacementMap>
          <feComposite in="SourceGraphic" in2="displacement" operator="atop"></feComposite>
        </filter>
        <filter id="${HEADING_FILTER_ID_PREFIX}3">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blur"></feGaussianBlur>
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 1 0 1 0 0 0 0 0 15 -8" result="goo"></feColorMatrix>
          <feTurbulence type="fractalNoise" baseFrequency="0.1 0.5" numOctaves="5" seed="2" result="noise"></feTurbulence>
          <feDisplacementMap in="goo" in2="noise" scale="0" result="displacement"></feDisplacementMap>
          <feComposite in="SourceGraphic" in2="displacement" operator="atop"></feComposite>
        </filter>
        <filter id="${HEADING_FILTER_ID_PREFIX}4">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blur"></feGaussianBlur>
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -8" result="goo"></feColorMatrix>
          <feTurbulence type="fractalNoise" baseFrequency="1 0.01" numOctaves="1" seed="1" result="noise"></feTurbulence>
          <feDisplacementMap in="goo" in2="noise" scale="0" result="displacement"></feDisplacementMap>
          <feComposite in="SourceGraphic" in2="displacement" operator="atop"></feComposite>
        </filter>
        <filter id="${HEADING_FILTER_ID_PREFIX}5">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blur"></feGaussianBlur>
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 14 -1" result="goo"></feColorMatrix>
          <feTurbulence type="fractalNoise" baseFrequency="0.009 1" numOctaves="1" seed="1" result="noise"></feTurbulence>
          <feDisplacementMap in="goo" in2="noise" scale="0" result="displacement"></feDisplacementMap>
          <feComposite in="SourceGraphic" in2="displacement" operator="atop"></feComposite>
        </filter>
        <filter id="${HEADING_FILTER_ID_PREFIX}6">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blur"></feGaussianBlur>
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 1 0 1 0 0 0 0 0 12 -8" result="goo"></feColorMatrix>
          <feTurbulence type="fractalNoise" baseFrequency="1" numOctaves="1" seed="1" result="noise"></feTurbulence>
          <feDisplacementMap in="goo" in2="noise" scale="0" result="displacement"></feDisplacementMap>
          <feComposite in="SourceGraphic" in2="displacement" operator="atop"></feComposite>
        </filter>
        <filter id="${HEADING_FILTER_ID_PREFIX}7">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blur"></feGaussianBlur>
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -5" result="goo"></feColorMatrix>
          <feTurbulence type="fractalNoise" baseFrequency="0.07 0.3" numOctaves="1" seed="1" result="noise"></feTurbulence>
          <feDisplacementMap in="goo" in2="noise" scale="0" result="displacement"></feDisplacementMap>
          <feComposite in="SourceGraphic" in2="displacement" operator="atop"></feComposite>
        </filter>
      </defs>
    `;

	document.body.appendChild(svg);

	for (const effectId of HEADING_FILTER_EFFECT_IDS) {
		applyHeadingFilterPrimitives(effectId, HEADING_FILTER_EFFECTS[effectId].primitiveTo);
	}
}

export function registerHeadingController(instanceId: string, controller: HeadingEffectController) {
	const runtime = getHeadingEffectsRuntime();
	runtime.controllers.set(instanceId, controller);
}

export function unregisterHeadingController(instanceId: string) {
	const runtime = getHeadingEffectsRuntime();
	runtime.controllers.delete(instanceId);
}

export function nextHeadingEffectInstanceId() {
	const runtime = getHeadingEffectsRuntime();
	runtime.instanceCounter += 1;
	return `heading-${runtime.instanceCounter}`;
}

export function resetHeadingFilterEffectOnElement(
	element: HTMLElement,
	timeline: HeadingFilterTween | null
) {
	timeline?.kill();
	element.style.removeProperty('filter');
	clearTextInline(element);
}

export function playHeadingFilterEffectOnElement(
	element: HTMLElement,
	effectId: HeadingFilterEffectId
): HeadingFilterTween {
	return createHeadingFilterTween(element, effectId, { direction: 'forward' });
}

export function playHeadingFilterEffectReverseOnElement(
	element: HTMLElement,
	effectId: HeadingFilterEffectId
): HeadingFilterTween {
	return createHeadingFilterTween(element, effectId, { direction: 'reverse' });
}

export function registerHeadingEffectsConsoleApi() {
	if (typeof window === 'undefined') return;
	if (window.__daoismHeadingEffects) {
		window.headingEffects = window.__daoismHeadingEffects;
		return;
	}

	const api: HeadingEffectsConsoleApi = {
		play(effectId = 1, target) {
			const normalizedEffectId = normalizeHeadingEffectId(effectId);
			if (!normalizedEffectId) return;

			if (target === undefined || target === 'active' || target === 'active-section') {
				playActiveSectionEffect(normalizedEffectId);
				return;
			}

			const controller = resolveHeadingController(target);
			if (!controller) {
				console.warn('No heading instances available to play effects.');
				return;
			}

			controller.play(normalizedEffectId);
		},
		playReverse(effectId = 1, target) {
			const normalizedEffectId = normalizeHeadingEffectId(effectId);
			if (!normalizedEffectId) return;

			if (target === undefined || target === 'active' || target === 'active-section') {
				playActiveSectionEffectReverse(normalizedEffectId);
				return;
			}

			const controller = resolveHeadingController(target);
			if (!controller) {
				console.warn('No heading instances available to play reverse effects.');
				return;
			}

			controller.playReverse(normalizedEffectId);
		},
		reset(target) {
			if (target === undefined || target === 'active' || target === 'active-section') {
				resetActiveSectionEffect();
				return;
			}

			const controller = resolveHeadingController(target);
			if (!controller) {
				console.warn('No heading instances available to reset effects.');
				return;
			}

			controller.reset();
		},
		headings() {
			const runtime = getHeadingEffectsRuntime();
			return Array.from(runtime.controllers.keys());
		},
		effects() {
			return [...HEADING_FILTER_EFFECT_IDS];
		}
	};

	window.__daoismHeadingEffects = api;
	window.headingEffects = api;
}
