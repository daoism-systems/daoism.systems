import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	// For debug purps will remove later
	return {
		uiHidden: url.searchParams.get('hideUI') === 'true',
		sceneHidden: url.searchParams.get('hide3d') === 'true',
		preset: parseInt(url.searchParams.get('preset') ?? '4', 10) || 4 // Default to preset 4
	};
};
