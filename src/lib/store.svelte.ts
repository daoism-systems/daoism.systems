import { browser } from '$app/environment';
import type Lenis from 'lenis';
import { writable } from 'svelte/store';

export let loadingProgress = writable(0);

// Eased progress for the loading number (LoadingLabel). Driven by the background-pattern
// render engine (worker or main-thread fallback) via BackgroundPattern, so the number shares
// the bar's exact eased curve — including its render-thread trickle — instead of running a
// second main-thread easer that froze (and diverged) whenever shader compile blocked the
// main thread. The engine eases the raw loadingProgress; this store is the readout sink.
export const displayedLoadingProgress = writable(0);

const initialHide3d = browser
	? new URLSearchParams(window.location.search).get('hide3d') === 'true'
	: false;
const initialHideUI = browser
	? new URLSearchParams(window.location.search).get('hideUI') === 'true'
	: false;
const initialSkipPreloader = initialHide3d || initialHideUI;

export let loadingFinish = writable(initialSkipPreloader);
export const canScroll = writable(false);

export const showPreloader = writable(!initialSkipPreloader);
export const preloaderTransitioning = writable(false);
export const warmupComplete = writable(false);
export const introTransitionEnded = writable(initialSkipPreloader);

export let lenisInstance = $state<{ instance: Lenis | null }>({ instance: null });

function deduplicatedWritable(initial: number) {
	const store = writable(initial);
	let current = initial;
	return {
		...store,
		set(value: number) {
			if (value === current) return;
			current = value;
			store.set(value);
		}
	};
}

export const scrollY = deduplicatedWritable(0);
export const scrollPosition = deduplicatedWritable(0);

export const BASE_VIRTUAL_SCROLL_HEIGHT = 6000;
export let virtualScrollHeight = $state({ h: BASE_VIRTUAL_SCROLL_HEIGHT });

export const GALLERY_CONFIG = {
	itemSpacing: 20,
	snapThreshold: 0.5,
	dampingFactor: 0.85,
	scrollSensitivity: 0.005,
	inertiaDamping: 0.95,
	wheelMultiplier: 1
};

type Vacancy = {
	title: string;
	description: string;
	textPosition: 'left' | 'right';
	top: string;
	left?: string;
	right?: string;
};

export const vacancies: Vacancy[] = [
	{
		title: 'Discovery',
		textPosition: 'left',
		description:
			'We map your goals, technical constraints, and system requirements to define the right on-chain architecture.',
		top: '50%',
		left: '20%'
	},
	{
		title: 'Build',
		textPosition: 'left',
		description:
			'We design and implement your DAO, DeFi protocol, or tooling with production-grade smart contract engineering.',
		top: '60%',
		left: '29%'
	},
	{
		title: 'Sustain',
		textPosition: 'right',
		description:
			'We provide ongoing advisory, audits support, and maintenance so your system stays secure and evolves with web3.',
		top: '50%',
		left: '60%'
	}
];
