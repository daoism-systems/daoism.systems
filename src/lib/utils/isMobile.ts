export function detectMob() {
	if (typeof navigator === 'undefined') return false;

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

	return toMatch.some((toMatchItem) => toMatchItem.test(ua));
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
