const CIRCLE_PADDING = 24;

export function updateDirectionalFillPosition(node: HTMLElement, event: MouseEvent) {
	const rect = node.getBoundingClientRect();
	if (!rect.width || !rect.height) return;

	const localX = event.clientX - rect.left;
	const localY = event.clientY - rect.top;
	const distances = [
		Math.hypot(localX, localY),
		Math.hypot(rect.width - localX, localY),
		Math.hypot(localX, rect.height - localY),
		Math.hypot(rect.width - localX, rect.height - localY)
	];
	const diameter = Math.max(...distances) * 2 + CIRCLE_PADDING;

	node.style.setProperty('--button-circle-x', `${localX.toFixed(2)}px`);
	node.style.setProperty('--button-circle-y', `${localY.toFixed(2)}px`);
	node.style.setProperty('--button-circle-size', `${diameter.toFixed(2)}px`);
}

export function directionalFill(node: HTMLElement) {
	const handleMouseEnter = (event: MouseEvent) => updateDirectionalFillPosition(node, event);
	const handleMouseLeave = (event: MouseEvent) => updateDirectionalFillPosition(node, event);

	node.addEventListener('mouseenter', handleMouseEnter);
	node.addEventListener('mouseleave', handleMouseLeave);

	return {
		destroy() {
			node.removeEventListener('mouseenter', handleMouseEnter);
			node.removeEventListener('mouseleave', handleMouseLeave);
		}
	};
}
