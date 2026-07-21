import { detectHighEndMob, detectMob } from '$lib/utils/isMobile';

export const MOBILE_MAX_DEVICE_PIXEL_RATIO = 1;
export const DESKTOP_MAX_DEVICE_PIXEL_RATIO = 1.25;

export function getMaxDevicePixelRatio(): number {
	if (!detectMob()) return DESKTOP_MAX_DEVICE_PIXEL_RATIO;
	// Flagship phones render at native panel density — no DPR cap.
	return detectHighEndMob() ? Infinity : MOBILE_MAX_DEVICE_PIXEL_RATIO;
}

export function getCappedDevicePixelRatio(): number {
	if (typeof window === 'undefined') {
		return 1;
	}

	return Math.min(window.devicePixelRatio, getMaxDevicePixelRatio());
}
