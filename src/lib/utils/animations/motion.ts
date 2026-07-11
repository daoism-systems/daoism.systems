function hasCoarsePointer() {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

export function isMobileMotionContext() {
	if (typeof window === 'undefined') return false;
	return window.innerWidth <= 1024 || hasCoarsePointer();
}

export function scaleMotionDuration(duration: number, factor = 1.18) {
	return isMobileMotionContext() ? duration * factor : duration;
}

export function useMotionBlur() {
	if (typeof window === 'undefined') return true;
	return !hasCoarsePointer();
}
