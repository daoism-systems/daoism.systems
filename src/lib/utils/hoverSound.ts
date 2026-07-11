import { sfx, SFX_KEY } from './sfx';

export function hoverSound(node: HTMLElement) {
	const play = () => {
		if (node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true') return;
		sfx.play(SFX_KEY.hover);
	};

	node.addEventListener('mouseenter', play);

	return {
		destroy() {
			node.removeEventListener('mouseenter', play);
		}
	};
}
