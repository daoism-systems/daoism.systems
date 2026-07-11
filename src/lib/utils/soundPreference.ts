const STORAGE_KEY = 'audio:enter-with-sound';
const VOLUME_STORAGE_KEY = 'audio:volume';

function clamp01(value: number): number {
	return Math.max(0, Math.min(value, 1));
}

export function loadVolume(fallback = 1): number {
	if (typeof window === 'undefined') return fallback;
	try {
		const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
		if (raw === null) return fallback;
		const parsed = Number.parseFloat(raw);
		return Number.isFinite(parsed) ? clamp01(parsed) : fallback;
	} catch {
		return fallback;
	}
}

export function saveVolume(value: number): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(VOLUME_STORAGE_KEY, clamp01(value).toFixed(3));
	} catch {
		// localStorage may be unavailable (private mode, quota, etc.)
	}
}

export function loadEnterWithSound(fallback = true): boolean {
	if (typeof window === 'undefined') return fallback;
	try {
		const value = window.localStorage.getItem(STORAGE_KEY);
		if (value === null) return fallback;
		return value === '1';
	} catch {
		return fallback;
	}
}

export function saveEnterWithSound(value: boolean): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
	} catch {
		// localStorage may be unavailable (private mode, quota, etc.)
	}
}
