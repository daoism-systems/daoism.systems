export interface PressAndHoldParams {
	duration?: number;
	onPressStart: () => void;
	onHoldComplete: () => void;
	onPressEnd: () => void;
}

export function pressAndHold(node: HTMLElement, params: PressAndHoldParams) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let completed = false;
	let current = params;

	function getDuration() {
		return current.duration ?? 500;
	}

	function syncDurationVar() {
		node.style.setProperty('--press-hold-duration', `${getDuration()}ms`);
	}

	function start() {
		completed = false;
		current.onPressStart();
		timer = setTimeout(() => {
			completed = true;
			current.onHoldComplete();
		}, getDuration());
	}

	function end() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (!completed) current.onPressEnd();
	}

	node.addEventListener('touchstart', start, { passive: true });
	node.addEventListener('touchend', end, { passive: true });
	node.addEventListener('touchcancel', end, { passive: true });
	syncDurationVar();

	return {
		update(newParams: PressAndHoldParams) {
			current = newParams;
			syncDurationVar();
		},
		destroy() {
			if (timer) clearTimeout(timer);
			node.style.removeProperty('--press-hold-duration');
			node.removeEventListener('touchstart', start);
			node.removeEventListener('touchend', end);
			node.removeEventListener('touchcancel', end);
		}
	};
}
