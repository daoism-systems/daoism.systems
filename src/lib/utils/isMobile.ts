export function detectMob() {
	if (typeof navigator === 'undefined') return false;

	// Debug override: `?forceMobile=1` takes the full mobile path (mobile GLB,
	// mobile theatre state, mobile feature flags) on a desktop browser.
	if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('forceMobile')) {
		return true;
	}

	const ua = navigator.userAgent;
	const toMatch = [
		/Android/i,
		/webOS/i,
		/iPhone/i,
		/iPad/i,
		/iPod/i,
		/BlackBerry/i,
		/Windows Phone/i
	];

	if (toMatch.some((toMatchItem) => toMatchItem.test(ua))) {
		return true;
	}

	if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
		const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
		const shortEdge = Math.min(window.innerWidth, window.innerHeight);
		if (coarsePointer && shortEdge <= 1024) {
			return true;
		}
	}

	return false;
}

/**
 * Flagship-class phone: gets the uncapped render path (native DPR, no
 * maxResolution clamp, 'high' graphics tier). iPhones are classified by panel
 * density — DPR 3 means the X/12-and-later class, while SE-style models stay
 * at 2. Androids by RAM (Chrome caps deviceMemory reporting at 8, so >= 8
 * marks the 8 GB+ flagships), with a core-count + density fallback for
 * browsers that hide deviceMemory.
 */
export function detectHighEndMob(): boolean {
	if (!detectMob()) return false;
	if (typeof window === 'undefined') return false;

	const dpr = window.devicePixelRatio || 1;
	if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
		return dpr >= 3;
	}

	const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory;
	if (typeof deviceMemory === 'number') {
		return deviceMemory >= 8;
	}
	return (navigator.hardwareConcurrency ?? 0) >= 8 && dpr >= 2.5;
}

export function detectSafari(): boolean {
	if (typeof navigator === 'undefined') return false;

	const ua = navigator.userAgent;

	return (
		/Safari/i.test(ua) &&
		!/Chrome/i.test(ua) &&
		!/Chromium/i.test(ua) &&
		!/CriOS/i.test(ua) &&
		!/FxiOS/i.test(ua) &&
		!/EdgiOS/i.test(ua)
	);
}

export function detectIOSWebKit(): boolean {
	if (typeof navigator === 'undefined') return false;

	const ua = navigator.userAgent;
	const isIOSDevice = /iPhone|iPad|iPod/i.test(ua);
	const isWebKitBrowser =
		/AppleWebKit/i.test(ua) && !/CriOS/i.test(ua) && !/FxiOS/i.test(ua) && !/EdgiOS/i.test(ua);

	return isIOSDevice && isWebKitBrowser;
}

export function detectAndroid(): boolean {
	if (typeof navigator === 'undefined') return false;
	return /Android/i.test(navigator.userAgent);
}

export function detectAndroidChrome(): boolean {
	if (typeof navigator === 'undefined') return false;

	const ua = navigator.userAgent;
	const isAndroid = /Android/i.test(ua);
	const hasChromeToken = /Chrome\/\d+/i.test(ua);
	const isChromeFamilyButNotGoogleChrome =
		/EdgA\//i.test(ua) ||
		/OPR\//i.test(ua) ||
		/SamsungBrowser\//i.test(ua) ||
		/YaBrowser\//i.test(ua) ||
		/Firefox\//i.test(ua) ||
		/FxiOS\//i.test(ua) ||
		/CriOS\//i.test(ua);

	return isAndroid && hasChromeToken && !isChromeFamilyButNotGoogleChrome;
}
