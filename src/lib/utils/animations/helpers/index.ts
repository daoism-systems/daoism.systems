import { EVENTS } from '../constants/events';

export function clamp(min: number, max: number, value: number): number {
	return Math.max(min, Math.min(max, value));
}

export function emitCursorHoverAnim(event: MouseEvent, fallbackNode: HTMLElement) {
	if (typeof window === 'undefined') return;
	const hasPointerCoords = Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
	const rect = fallbackNode.getBoundingClientRect();
	const x = hasPointerCoords ? event.clientX : rect.left + rect.width / 2;
	const y = hasPointerCoords ? event.clientY : rect.top + rect.height / 2;
	window.dispatchEvent(
		new CustomEvent<{ x: number; y: number }>(EVENTS.CURSOR_HOVER_ANIM_EVENT, { detail: { x, y } })
	);
}

export function clearStyles(el: HTMLElement, props: string[]) {
	for (const p of props) el.style.removeProperty(p);
}
