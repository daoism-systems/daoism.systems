import { detectMob } from '$lib/utils/isMobile';
import type { GraphicsOptions } from './GraphicsConfig';

export const BASIC_SCENE_FEATURES = {
	performanceBenchmark: false,
	rendererPrecompile: true,
	warmup: true,
	shadows: false,
	grid: true,
	groundFog: true,
	daoFog: true,
	modelMaterials: true,
	modelAnimations: true,
	animationPipeline: true,
	introTransition: true,
	annotations: true,
	mouseInteraction: true,
	mouseParallax: true,
	globalFluid: true,
	fluidPostProcessing: true,
	octagonParticles: true,
	octagonFluid: true,
	cubesParticles: true,
	pyramidParticles: true,
	forestParticles: true,
	fallbackPyramidParticles: true,
	pyramidVat: true,
	trainSlider: true,
	// Scene-to-scene transition: the dissolve/smear post pass AND its support
	// machinery (pair double-render, bloom dominance gating, feedback-decay
	// smear, fluid fade, warmup pin steps). Off = hard cut at the window start.
	transition: true,
	bloom: true,
	chromaticAberration: true,
	vignette: true,
	fxaa: false
};

export type SceneFeatureFlags = typeof BASIC_SCENE_FEATURES;

export type SceneFeatureKey = keyof SceneFeatureFlags;

// Per-platform default flag overrides on top of `BASIC_SCENE_FEATURES`. Picked
// once via `detectMob()` at config resolution; refresh-only — no runtime swap.
export const DESKTOP_SCENE_FEATURES: Partial<SceneFeatureFlags> = {};
export const MOBILE_SCENE_FEATURES: Partial<SceneFeatureFlags> = {
	// octagonFluid is listed explicitly (not left to normalizeDependencies) so a
	// ?sceneEnable=globalFluid debug URL on mobile doesn't drag the octagon sim on.
	octagonFluid: false,
	globalFluid: false
};

export interface SceneFeatureConfig {
	flags: SceneFeatureFlags;
	debug: boolean;
	unknownTokens: string[];
}

const SCENE_FEATURE_KEYS = Object.keys(BASIC_SCENE_FEATURES) as SceneFeatureKey[];
const FEATURE_KEY_BY_LOWER = new Map<string, SceneFeatureKey>(
	SCENE_FEATURE_KEYS.map((key) => [key.toLowerCase(), key])
);

function parseTokens(value: string | null): string[] {
	if (!value) return [];
	return value
		.split(/[,\s]+/)
		.map((token) => token.trim())
		.filter(Boolean);
}

function applyToken(
	flags: SceneFeatureFlags,
	rawToken: string,
	enabled: boolean,
	unknownTokens: string[]
): void {
	const token = rawToken.trim().toLowerCase();
	if (!token) return;

	const key = FEATURE_KEY_BY_LOWER.get(token);
	if (key) {
		flags[key] = enabled;
		return;
	}

	unknownTokens.push(rawToken);
}

function applyParamTokens(
	params: URLSearchParams,
	names: string[],
	flags: SceneFeatureFlags,
	enabled: boolean,
	unknownTokens: string[]
): void {
	for (const name of names) {
		for (const value of params.getAll(name)) {
			for (const token of parseTokens(value)) {
				applyToken(flags, token, enabled, unknownTokens);
			}
		}
	}
}

// Feature implications, enforced once after the URL layer so every consumer can
// check a single flag: the octagon fluid sim and the fluid post-processing pass
// both ride the shared FluidMouseField, which only exists with globalFluid.
function normalizeDependencies(flags: SceneFeatureFlags): void {
	if (!flags.globalFluid) {
		flags.octagonFluid = false;
		flags.fluidPostProcessing = false;
	}
}

export function resolveSceneFeatureConfig(search?: string): SceneFeatureConfig {
	const rawSearch =
		search ?? (typeof window !== 'undefined' && window.location ? window.location.search : '');
	const params = new URLSearchParams(rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch);
	const sceneFeaturesParam = params.get('sceneFeatures')?.trim().toLowerCase() ?? null;

	// Layered defaults: BASIC → platform overrides → URL params below.
	const flags: SceneFeatureFlags = { ...BASIC_SCENE_FEATURES };
	Object.assign(flags, detectMob() ? MOBILE_SCENE_FEATURES : DESKTOP_SCENE_FEATURES);
	const unknownTokens: string[] = [];

	// 'basic'/'full' are legacy profile values — accepted and ignored.
	if (sceneFeaturesParam && sceneFeaturesParam !== 'basic' && sceneFeaturesParam !== 'full') {
		for (const token of parseTokens(sceneFeaturesParam)) {
			applyToken(flags, token, true, unknownTokens);
		}
	}

	applyParamTokens(params, ['sceneEnable', 'enableSceneFeature'], flags, true, unknownTokens);
	applyParamTokens(params, ['sceneDisable', 'disableSceneFeature'], flags, false, unknownTokens);
	normalizeDependencies(flags);

	return {
		flags,
		debug: params.has('sceneFeatureDebug') || params.get('debug') === 'features',
		unknownTokens
	};
}

export function applySceneFeaturesToGraphicsOptions(
	options: GraphicsOptions,
	features: SceneFeatureFlags
): GraphicsOptions {
	const shadowMapType = features.shadows ? options.shadowMapType : null;

	return {
		...options,
		shadowMapType,
		enableOctagonParticles: features.octagonParticles,
		// Flags arrive normalized — octagonFluid/fluidPostProcessing already imply
		// globalFluid (see normalizeDependencies).
		enableOctagonPhysics: features.octagonFluid && options.enableOctagonPhysics,
		postProcessing: {
			...options.postProcessing,
			// Feature flags are additional gates on top of platform/tier caps.
			bloom: options.postProcessing.bloom && features.bloom,
			fxaa: options.postProcessing.fxaa && features.fxaa,
			fluidDistortion: options.postProcessing.fluidDistortion && features.fluidPostProcessing,
			chromaticAberration:
				options.postProcessing.chromaticAberration && features.chromaticAberration,
			vignette: options.postProcessing.vignette && features.vignette,
			cloudTransition: options.postProcessing.cloudTransition && features.transition
		}
	};
}

export function logSceneFeatureConfig(config: SceneFeatureConfig): void {
	console.info(
		'Scene features. Override with ?sceneEnable=featureA,featureB or ?sceneDisable=featureA.'
	);
	if (config.unknownTokens.length > 0) {
		console.warn('Unknown scene feature tokens:', config.unknownTokens);
	}
	console.table(config.flags);
}
