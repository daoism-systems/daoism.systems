import { EASINGS } from './constants/easings';
import { AnimationTimeline } from './helpers/animationTimeline';

const OPEN_DURATION = 500;

function measureBox(element: HTMLElement): { width: number; height: number } {
	const bounds = element.getBoundingClientRect();
	return {
		width: Math.ceil(bounds.width),
		height: Math.ceil(bounds.height)
	};
}

export function createAnnotationRevealTimeline(root: HTMLElement): AnimationTimeline | null {
	const button = root.querySelector<HTMLElement>('.hotspot__btn');
	const panel = root.querySelector<HTMLElement>('.hotspot__desc');
	const title = root.querySelector<HTMLElement>(
		'.hotspot__summary .hotspot__title > span:first-child'
	);
	// Animate the mask wrapper, not .info itself — a WAAPI animation with
	// fill:'both' would permanently override the CSS open/close transition
	// on the inner element.
	const info = root.querySelector<HTMLElement>('.hotspot__title .info-mask');

	if (!button && !panel && !title && !info) return null;

	const timeline = new AnimationTimeline();

	if (button) {
		timeline.add(
			button,
			[
				{ transform: 'scale(0) translateY(20%)', opacity: '0' },
				{ transform: 'scale(1) translateY(0)', opacity: '1' }
			],
			{
				duration: 400,
				easing: EASINGS.EASE_POWER1_INOUT,
				fill: 'both'
			},
			0
		);
	}

	if (panel) {
		timeline.add(
			panel,
			[{ opacity: '0' }, { opacity: '1' }],
			{
				duration: 420,
				easing: EASINGS.EASE_POWER1_INOUT,
				fill: 'both'
			},
			180
		);
	}

	if (title) {
		timeline.add(
			title,
			[
				{ transform: 'translateY(18px)', opacity: '0' },
				{ transform: 'translateY(0)', opacity: '1' }
			],
			{
				duration: 400,
				easing: EASINGS.EASE_POWER1_INOUT,
				fill: 'both'
			},
			320
		);
	}

	if (info) {
		timeline.add(
			info,
			[
				{ transform: 'translateY(18px)', opacity: '0' },
				{ transform: 'translateY(0)', opacity: '1' }
			],
			{
				duration: 400,
				easing: EASINGS.EASE_POWER1_INOUT,
				fill: 'both'
			},
			420
		);
	}

	return timeline;
}

export function createAnnotationOpenTimeline(root: HTMLElement): AnimationTimeline | null {
	const panel = root.querySelector<HTMLElement>('.hotspot__desc');
	const summary = root.querySelector<HTMLElement>('.hotspot__summary');
	const contentInner = root.querySelector<HTMLElement>('.hotspot__content-inner');

	if (!panel || !summary || !contentInner) return null;

	const collapsed = measureBox(panel);
	const expanded = measureBox(contentInner);
	if (!collapsed.width || !collapsed.height || !expanded.width || !expanded.height) return null;

	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const duration = reducedMotion ? 1 : OPEN_DURATION;
	const timeline = new AnimationTimeline();

	timeline.add(
		panel,
		[
			{ width: `${collapsed.width}px`, height: `${collapsed.height}px` },
			{ width: `${expanded.width}px`, height: `${expanded.height}px` }
		],
		{
			duration,
			easing: reducedMotion ? 'linear' : EASINGS.EASE_BACK_OUT_2,
			reverseEasing: reducedMotion ? 'linear' : EASINGS.EASE_BACK_IN_2,
			fill: 'both'
		}
	);

	timeline.setProgress(0);
	return timeline;
}
