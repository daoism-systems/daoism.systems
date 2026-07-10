import { detectMob } from '$lib/utils/isMobile';

export const MOBILE_MAX_DEVICE_PIXEL_RATIO = 1;
export const DESKTOP_MAX_DEVICE_PIXEL_RATIO = 1.25;

export function getMaxDevicePixelRatio(): number {
	return detectMob() ? MOBILE_MAX_DEVICE_PIXEL_RATIO : DESKTOP_MAX_DEVICE_PIXEL_RATIO;
}

export function getCappedDevicePixelRatio(): number {
	if (typeof window === 'undefined') {
		return 1;
	}

	return Math.min(window.devicePixelRatio, getMaxDevicePixelRatio());
}
