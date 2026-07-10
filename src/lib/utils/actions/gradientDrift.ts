const DEFAULT_RANGE = 34;
const DEFAULT_SMOOTHING = 0.11;
const SETTLE_THRESHOLD = 0.08;

type GradientDriftOptions = {
	range?: number;
	smoothing?: number;
};

export function gradientDrift(node: HTMLElement, options: GradientDriftOptions = {}) {
	let range = options.range ?? DEFAULT_RANGE;
	let smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
	let frame: number | null = null;
	let currentX = 0;
	let currentY = 0;
	let targetX = 0;
	let targetY = 0;
	let active = false;

	const applySurface = (x: number, y: number) => {
		const focusX = 50 + (x / range) * 18;
		const focusY = 50 + (y / range) * 24;
		const intensity = Math.min(Math.hypot(x, y) / range, 1);
		const glow = active ? 0.22 + intensity * 0.16 : 0.18;
		const shadow = active ? 0.12 + intensity * 0.1 : 0.08;

		node.style.setProperty('--heading-drift-x', `${x.toFixed(2)}px`);
		node.style.setProperty('--heading-drift-y', `${y.toFixed(2)}px`);
		node.style.setProperty('--heading-focus-x', `${focusX.toFixed(2)}%`);
		node.style.setProperty('--heading-focus-y', `${focusY.toFixed(2)}%`);
		node.style.setProperty('--heading-glow-alpha', glow.toFixed(3));
		node.style.setProperty('--heading-shadow-alpha', shadow.toFixed(3));
	};

	const tick = () => {
		const deltaX = targetX - currentX;
		const deltaY = targetY - currentY;
		currentX += deltaX * smoothing;
		currentY += deltaY * smoothing;
		applySurface(currentX, currentY);

		if (Math.abs(deltaX) < SETTLE_THRESHOLD && Math.abs(deltaY) < SETTLE_THRESHOLD) {
			currentX = targetX;
			currentY = targetY;
			applySurface(currentX, currentY);
			frame = null;
			return;
		}
		frame = requestAnimationFrame(tick);
	};

	const ensureFrame = () => {
		if (frame !== null) return;
		frame = requestAnimationFrame(tick);
	};

	const handlePointerMove = (event: PointerEvent) => {
		if (event.pointerType === 'touch') return;

		const normalizedX = event.clientX / window.innerWidth - 0.5;
		const normalizedY = event.clientY / window.innerHeight - 0.5;
		targetX = normalizedX * range;
		targetY = normalizedY * range;

		if (!active) {
			active = true;
			currentX = targetX * 0.2;
			currentY = targetY * 0.2;
			applySurface(currentX, currentY);
		}

		ensureFrame();
	};

	const handlePointerLeave = () => {
		active = false;
		targetX = 0;
		targetY = 0;
		ensureFrame();
	};

	applySurface(0, 0);
	window.addEventListener('pointermove', handlePointerMove, { passive: true });
	window.addEventListener('pointerleave', handlePointerLeave);

	return {
		update(nextOptions: GradientDriftOptions = {}) {
			range = nextOptions.range ?? DEFAULT_RANGE;
			smoothing = nextOptions.smoothing ?? DEFAULT_SMOOTHING;
		},
		destroy() {
			if (frame !== null) {
				cancelAnimationFrame(frame);
				frame = null;
			}
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerleave', handlePointerLeave);
		}
	};
}
