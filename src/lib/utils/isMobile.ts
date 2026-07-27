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

/**
 * Flagship-density phone that nonetheless runs a small RAM budget — the iPhone
 * X through 13 class (3–4 GB, occasionally 6). These share one WKWebView
 * content-process memory limit with the rest of the browser, and native 3x
 * pushes every framebuffer 2.25x past what that limit tolerates: the process is
 * jetsam-killed at the preloader -> scene handoff, which the browser surfaces as
 * "Can't open this page".
 *
 * Panel size is the only proxy available here. WebKit does not implement
 * navigator.deviceMemory, and every iPhone since the X reports DPR 3, so
 * detectHighEndMob's density check cannot separate a 13 mini from a 16 Pro Max.
 * Short edge <= 390 covers the 375-wide (X / XS / 11 Pro / 12 mini / 13 mini)
 * and 390-wide (12 / 13 / 14) classes while leaving the 393-wide-and-up models
 * (14 Pro and later, 6–8 GB) on the uncapped path.
 *
 * Android is excluded deliberately: it exposes deviceMemory, so detectHighEndMob
 * already gates those on a real >= 8 GB reading.
 *
 * Measured against `screen`, not innerWidth, so browser chrome, the URL bar, or
 * a rotation can't reclassify the device mid-session.
 */
export function detectMemoryConstrainedMob(): boolean {
	if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
	if (!/iPhone|iPod/i.test(navigator.userAgent)) return false;

	const { width, height } = window.screen;
	return Math.min(width, height) <= 390;
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
