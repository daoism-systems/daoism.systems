const CURSOR_HOVER_ANIM_EVENT = 'cursor:hover-anim';
const DEFAULT_MAX_SHIFT = 10;
const DEFAULT_MAX_ROTATE = 3.5;
const DEFAULT_MAX_GLOW = 0.18;
const PRESSED_SCALE = 0.982;
const SMOOTHING = 0.16;
const SHIFT_THRESHOLD = 0.12;
const POINTER_THRESHOLD = 0.35;
const GLOW_THRESHOLD = 0.006;

type CtaResonanceOptions = {
	maxShift?: number;
	maxRotate?: number;
	maxGlow?: number;
};

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function isDisabled(node: HTMLElement) {
	return node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true';
}

function setShift(node: HTMLElement, x: number, y: number) {
	node.style.setProperty('--cta-shift-x', `${x.toFixed(2)}px`);
	node.style.setProperty('--cta-shift-y', `${y.toFixed(2)}px`);
}

function setScale(node: HTMLElement, value: number) {
	node.style.setProperty('--cta-scale', value.toFixed(3));
}

function setTilt(node: HTMLElement, x: number, y: number) {
	node.style.setProperty('--cta-tilt-x', `${x.toFixed(2)}deg`);
	node.style.setProperty('--cta-tilt-y', `${y.toFixed(2)}deg`);
}

function setGlow(node: HTMLElement, value: number) {
	node.style.setProperty('--cta-glow-alpha', value.toFixed(3));
}

function setPointer(node: HTMLElement, x: number, y: number) {
	node.style.setProperty('--cta-pointer-x', `${x.toFixed(2)}%`);
	node.style.setProperty('--cta-pointer-y', `${y.toFixed(2)}%`);
}

function pulseAtNode(node: HTMLElement) {
	const rect = node.getBoundingClientRect();
	window.dispatchEvent(
		new CustomEvent<{ x: number; y: number }>(CURSOR_HOVER_ANIM_EVENT, {
			detail: {
				x: rect.left + rect.width / 2,
				y: rect.top + rect.height / 2
			}
		})
	);
}

export function ctaResonance(node: HTMLElement, options: CtaResonanceOptions = {}) {
	let maxShift = options.maxShift ?? DEFAULT_MAX_SHIFT;
	let maxRotate = options.maxRotate ?? DEFAULT_MAX_ROTATE;
	let maxGlow = options.maxGlow ?? DEFAULT_MAX_GLOW;
	let finePointerQuery: MediaQueryList | null = null;
	let reducedMotionQuery: MediaQueryList | null = null;
	let hasFinePointer = false;
	let prefersReducedMotion = false;
	let isHovered = false;
	let isFocused = false;
	let animationFrame: number | null = null;
	let targetShiftX = 0;
	let targetShiftY = 0;
	let currentShiftX = 0;
	let currentShiftY = 0;
	let targetTiltX = 0;
	let targetTiltY = 0;
	let currentTiltX = 0;
	let currentTiltY = 0;
	let targetGlow = 0;
	let currentGlow = 0;
	let targetPointerX = 50;
	let targetPointerY = 50;
	let currentPointerX = 50;
	let currentPointerY = 50;

	const syncMediaState = () => {
		hasFinePointer = finePointerQuery?.matches ?? false;
		prefersReducedMotion = reducedMotionQuery?.matches ?? false;
	};

	const syncActiveState = () => {
		node.classList.toggle('cta-resonance--active', isHovered || isFocused);
	};

	const applyState = () => {
		setShift(node, currentShiftX, currentShiftY);
		setTilt(node, currentTiltX, currentTiltY);
		setGlow(node, currentGlow);
		setPointer(node, currentPointerX, currentPointerY);
	};

	const stopAnimation = () => {
		if (animationFrame === null) return;
		cancelAnimationFrame(animationFrame);
		animationFrame = null;
	};

	const animate = () => {
		animationFrame = null;

		currentShiftX += (targetShiftX - currentShiftX) * SMOOTHING;
		currentShiftY += (targetShiftY - currentShiftY) * SMOOTHING;
		currentTiltX += (targetTiltX - currentTiltX) * SMOOTHING;
		currentTiltY += (targetTiltY - currentTiltY) * SMOOTHING;
		currentGlow += (targetGlow - currentGlow) * SMOOTHING;
		currentPointerX += (targetPointerX - currentPointerX) * SMOOTHING;
		currentPointerY += (targetPointerY - currentPointerY) * SMOOTHING;

		applyState();

		const isSettled =
			Math.abs(targetShiftX - currentShiftX) < SHIFT_THRESHOLD &&
			Math.abs(targetShiftY - currentShiftY) < SHIFT_THRESHOLD &&
			Math.abs(targetTiltX - currentTiltX) < 0.04 &&
			Math.abs(targetTiltY - currentTiltY) < 0.04 &&
			Math.abs(targetGlow - currentGlow) < GLOW_THRESHOLD &&
			Math.abs(targetPointerX - currentPointerX) < POINTER_THRESHOLD &&
			Math.abs(targetPointerY - currentPointerY) < POINTER_THRESHOLD;

		if (isSettled) {
			currentShiftX = targetShiftX;
			currentShiftY = targetShiftY;
			currentTiltX = targetTiltX;
			currentTiltY = targetTiltY;
			currentGlow = targetGlow;
			currentPointerX = targetPointerX;
			currentPointerY = targetPointerY;
			applyState();
			return;
		}

		animationFrame = requestAnimationFrame(animate);
	};

	const ensureAnimation = () => {
		if (prefersReducedMotion) {
			currentShiftX = targetShiftX;
			currentShiftY = targetShiftY;
			currentTiltX = targetTiltX;
			currentTiltY = targetTiltY;
			currentGlow = targetGlow;
			currentPointerX = targetPointerX;
			currentPointerY = targetPointerY;
			applyState();
			return;
		}

		if (animationFrame !== null) return;
		animationFrame = requestAnimationFrame(animate);
	};

	const setRestTargets = () => {
		targetShiftX = 0;
		targetShiftY = 0;
		targetTiltX = 0;
		targetTiltY = 0;
		targetPointerX = 50;
		targetPointerY = 50;
		targetGlow = isFocused ? maxGlow * 0.55 : 0;
		ensureAnimation();
	};

	const reset = () => {
		stopAnimation();
		isHovered = false;
		isFocused = false;
		node.classList.remove('cta-resonance--pressed');
		syncActiveState();
		targetShiftX = 0;
		targetShiftY = 0;
		currentShiftX = 0;
		currentShiftY = 0;
		targetTiltX = 0;
		targetTiltY = 0;
		currentTiltX = 0;
		currentTiltY = 0;
		targetGlow = 0;
		currentGlow = 0;
		targetPointerX = 50;
		targetPointerY = 50;
		currentPointerX = 50;
		currentPointerY = 50;
		applyState();
		setScale(node, 1);
	};

	const updateShift = (clientX: number, clientY: number) => {
		if (!hasFinePointer || prefersReducedMotion || isDisabled(node)) {
			setRestTargets();
			return;
		}

		const rect = node.getBoundingClientRect();
		if (!rect.width || !rect.height) return;

		const normalizedX = ((clientX - rect.left) / rect.width - 0.5) * 2;
		const normalizedY = ((clientY - rect.top) / rect.height - 0.5) * 2;
		const clampedX = clamp(normalizedX, -1, 1);
		const clampedY = clamp(normalizedY, -1, 1);
		const intensity = Math.min(Math.hypot(clampedX, clampedY) / Math.SQRT2, 1);

		targetShiftX = clampedX * maxShift;
		targetShiftY = clampedY * maxShift;
		targetTiltX = -clampedY * maxRotate;
		targetTiltY = clampedX * maxRotate;
		targetGlow = Math.max(intensity * maxGlow, isFocused ? maxGlow * 0.55 : 0);
		targetPointerX = ((clampedX + 1) / 2) * 100;
		targetPointerY = ((clampedY + 1) / 2) * 100;
		ensureAnimation();
	};

	const handlePointerEnter = (event: PointerEvent) => {
		if (isDisabled(node)) return;
		isHovered = true;
		syncActiveState();
		updateShift(event.clientX, event.clientY);
		if (!prefersReducedMotion) {
			pulseAtNode(node);
		}
	};

	const handlePointerMove = (event: PointerEvent) => {
		updateShift(event.clientX, event.clientY);
	};

	const handlePointerLeave = () => {
		isHovered = false;
		syncActiveState();
		setRestTargets();
		setScale(node, 1);
	};

	const handleFocusIn = () => {
		if (isDisabled(node)) return;
		isFocused = true;
		syncActiveState();
		targetGlow = Math.max(targetGlow, maxGlow * 0.55);
		ensureAnimation();
		if (!prefersReducedMotion) {
			pulseAtNode(node);
		}
	};

	const handleFocusOut = () => {
		isFocused = false;
		syncActiveState();
		setRestTargets();
		setScale(node, 1);
	};

	const handlePressStart = () => {
		if (isDisabled(node)) return;
		node.classList.add('cta-resonance--pressed');
		setScale(node, PRESSED_SCALE);
	};

	const handlePressEnd = () => {
		node.classList.remove('cta-resonance--pressed');
		setScale(node, 1);
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.repeat) return;
		if (event.key === 'Enter' || event.key === ' ') {
			handlePressStart();
		}
	};

	const handleKeyUp = (event: KeyboardEvent) => {
		if (event.key === 'Enter' || event.key === ' ') {
			handlePressEnd();
		}
	};

	if (typeof window !== 'undefined') {
		finePointerQuery = window.matchMedia('(pointer: fine)');
		reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		syncMediaState();
		finePointerQuery.addEventListener('change', syncMediaState);
		reducedMotionQuery.addEventListener('change', syncMediaState);
	}

	node.addEventListener('pointerenter', handlePointerEnter);
	node.addEventListener('pointermove', handlePointerMove);
	node.addEventListener('pointerleave', handlePointerLeave);
	node.addEventListener('focusin', handleFocusIn);
	node.addEventListener('focusout', handleFocusOut);
	node.addEventListener('pointerdown', handlePressStart);
	node.addEventListener('pointerup', handlePressEnd);
	node.addEventListener('pointercancel', handlePressEnd);
	node.addEventListener('keydown', handleKeyDown);
	node.addEventListener('keyup', handleKeyUp);

	return {
		update(nextOptions: CtaResonanceOptions = {}) {
			maxShift = nextOptions.maxShift ?? DEFAULT_MAX_SHIFT;
			maxRotate = nextOptions.maxRotate ?? DEFAULT_MAX_ROTATE;
			maxGlow = nextOptions.maxGlow ?? DEFAULT_MAX_GLOW;
		},
		destroy() {
			stopAnimation();
			finePointerQuery?.removeEventListener('change', syncMediaState);
			reducedMotionQuery?.removeEventListener('change', syncMediaState);
			node.removeEventListener('pointerenter', handlePointerEnter);
			node.removeEventListener('pointermove', handlePointerMove);
			node.removeEventListener('pointerleave', handlePointerLeave);
			node.removeEventListener('focusin', handleFocusIn);
			node.removeEventListener('focusout', handleFocusOut);
			node.removeEventListener('pointerdown', handlePressStart);
			node.removeEventListener('pointerup', handlePressEnd);
			node.removeEventListener('pointercancel', handlePressEnd);
			node.removeEventListener('keydown', handleKeyDown);
			node.removeEventListener('keyup', handleKeyUp);
			reset();
		}
	};
}
