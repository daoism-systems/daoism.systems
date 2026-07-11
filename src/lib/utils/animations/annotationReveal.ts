import { EASINGS } from './constants/easings';
import { AnimationTimeline } from './helpers/animationTimeline';

export function createAnnotationRevealTimeline(root: HTMLElement): AnimationTimeline | null {
	const button = root.querySelector<HTMLElement>('.hotspot__btn');
	const panel = root.querySelector<HTMLElement>('.hotspot__desc');
	const title = root.querySelector<HTMLElement>('.hotspot__title span:not(.info)');
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
