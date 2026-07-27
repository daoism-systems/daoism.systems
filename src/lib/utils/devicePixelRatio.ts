import { detectHighEndMob, detectMemoryConstrainedMob, detectMob } from '$lib/utils/isMobile';

export const MOBILE_MAX_DEVICE_PIXEL_RATIO = 1;
export const DESKTOP_MAX_DEVICE_PIXEL_RATIO = 1.25;
// Flagship density on a small RAM budget. Every framebuffer scales with the
// square of this — dropping 3 -> 2 cuts the swapchain, the feedback ping-pong
// pair, and every intermediate post target to ~44% of their pixel count, which
// is what keeps the content process inside its jetsam limit. Still 2x denser
// than the desktop cap, so the render stays sharp on a phone panel.
export const CONSTRAINED_MOBILE_MAX_DEVICE_PIXEL_RATIO = 2;

export function getMaxDevicePixelRatio(): number {
	if (!detectMob()) return DESKTOP_MAX_DEVICE_PIXEL_RATIO;
	if (!detectHighEndMob()) return MOBILE_MAX_DEVICE_PIXEL_RATIO;
	// Flagship phones render at native panel density — no DPR cap, unless they're
	// in the memory-constrained class, where native density is what kills them.
	return detectMemoryConstrainedMob() ? CONSTRAINED_MOBILE_MAX_DEVICE_PIXEL_RATIO : Infinity;
}

export function getCappedDevicePixelRatio(): number {
	if (typeof window === 'undefined') {
		return 1;
	}

	return Math.min(window.devicePixelRatio, getMaxDevicePixelRatio());
}
