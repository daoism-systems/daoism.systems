import {
	createDefaultGraphicsOptions,
	createGraphicsOptionsForTier,
	runGraphicsBenchmark,
	type GraphicsOptions,
	type GraphicsTier
} from '../GraphicsConfig';
import { detectHighEndMob } from '$lib/utils/isMobile';
import { applySceneFeaturesToGraphicsOptions, type SceneFeatureFlags } from '../SceneFeatures';

export interface PerformanceTierResult {
	tier: GraphicsTier;
	options: GraphicsOptions;
}

/**
 * Picks a graphics tier (via benchmark when feature-gated, otherwise 'high'),
 * applies feature gating to the options, and writes tier-derived values back
 * into the shared `params` bag (resolution, denoise, fog, bloom, chrome, shadow).
 *
 * Reads bloom/chrome bases from `params` BEFORE applying tier multipliers, so
 * the call mutates `params` without losing the authored bases.
 */
export async function applyPerformanceTier(opts: {
	params: any;
	features: SceneFeatureFlags;
	isMobile: boolean;
	onBenchmarkComplete?: () => void;
}): Promise<PerformanceTierResult> {
	const { params, features, isMobile, onBenchmarkComplete } = opts;
	const baseOptions = createDefaultGraphicsOptions();
	const baseBloomStrength = params.bloomStrength;
	const baseBloomRadius = params.bloomRadius;
	const baseBloomThreshold = params.bloomThreshold;
	const baseChromeStrength = params.chromeStrength;
	const baseChromeScale = params.chromeScale;

	let tier: GraphicsTier = 'high';
	let options: GraphicsOptions;
	if (features.performanceBenchmark) {
		try {
			const result = await runGraphicsBenchmark();
			tier = result.tier;
			options = createGraphicsOptionsForTier(result.tier, baseOptions);
		} catch {
			tier = 'high';
			options = baseOptions;
		} finally {
			options = applySceneFeaturesToGraphicsOptions(options!, features);
			onBenchmarkComplete?.();
		}
	} else {
		tier = isMobile && !detectHighEndMob() ? 'medium' : 'high';
		options = createGraphicsOptionsForTier(tier, baseOptions);
		options = applySceneFeaturesToGraphicsOptions(options, features);
		onBenchmarkComplete?.();
	}

	params.resolution = options.resolutionScale;
	params.denoise = options.denoise;
	params.bloomStrength = baseBloomStrength * options.bloomMultiplier;
	params.bloomRadius = baseBloomRadius * options.bloomMultiplier;
	params.bloomThreshold = baseBloomThreshold + options.bloomThresholdOffset;
	params.chromeStrength = baseChromeStrength * options.chromeStrengthMultiplier;
	params.chromeScale = baseChromeScale * options.chromeScaleMultiplier;

	return { tier, options };
}

/**
 * Match the VFX-JS reference (256) on high-tier desktops; fall back on weaker GPUs.
 * `low` is unreachable in practice — fluidDistortion is disabled there — but
 * kept here so the field can run if a caller flips the gate manually.
 */
export function getFluidResolutionForTier(tier: GraphicsTier): number {
	switch (tier) {
		case 'low':
			return 96;
		case 'medium':
			return 128;
		default:
			return 256;
	}
}
