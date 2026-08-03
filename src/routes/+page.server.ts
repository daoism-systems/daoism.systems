import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	return {
		uiHidden: url.searchParams.get('hideUI') === 'true',
		sceneHidden: url.searchParams.get('hide3d') === 'true',
		preset: parseInt(url.searchParams.get('preset') ?? '4', 10) || 4
	};
};
