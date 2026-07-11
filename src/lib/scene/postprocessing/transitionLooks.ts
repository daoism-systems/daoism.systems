import type { TransitionLookParams, TransitionPairId } from './types';
import type { SceneIndex } from '../sceneLayers';

// First transition (scene 1 → 2): the procedural-noise horizontal sweep, run
// through the "liquid glass" refraction (`glassDistort`) rather than the swarm's
// averaging smear — so the geometry stays sharp but bends/stretches like flowing
// glass. `smearStrength` is the refractive warp/stretch distance along the sweep
// axis; `maskSoftness` widens the melt band so it reads as a flowing zone rather
// than a thin seam; `caStrength` is the prismatic dispersion along the bend. All
// remain live-tunable in the Transition Shader GUI.
export const TRANSITION_LOOK_PROCEDURAL: TransitionLookParams = {
	smearStrength: 0.05,
	caStrength: 0.006,
	maskSoftness: 0.2,
	axisIndex: 0,
	noiseScaleX: 2.35,
	noiseScaleY: 6.2,
	noiseScrollSpeed: 0.0,
	// Keep the edge noise BELOW maskSoftness (the runtime softness is ~0.095 via
	// the Theatre static override) so the dissolve stays a single continuous
	// edge whose width is `maskSoftness`, not a full-screen noise wash. The old
	// 0.42 perturbed the axis ±0.42 — ~4.4× the band — which shattered the line
	// into noise and killed the sense of a sweeping front. `detailNoiseAmount`
	// added per-pixel blue-noise dither on top (salt-and-pepper), so it's off.
	// Both remain live-keyframable as `proceduralMaskNoiseStrength` /
	// `proceduralDetailNoiseAmount` in Theatre.
	maskNoiseStrength: 0.05,
	detailNoiseAmount: 0.0,
	// Radial term is swarm-only: 0 here keeps the procedural look untouched.
	radialStrength: 0.0,
	radialOriginX: 0.5,
	radialOriginY: 0.0,
	radialRadius: 0.1,
	radialSpreadX: -1,
	// Pixelation-glitch is swarm-only: 0 strength here keeps the procedural look
	// untouched (the mosaic/tear/split term gates fully off at pixelStrength 0).
	pixelStrength: 0.0,
	pixelBlockSize: 0.0,
	pixelGlitchAmount: 0.0
};

// Second transition (scene 2 → 3): directional-smear distortion over the
// original swarm dissolve mask — vertical sweep axis plus its own noise
// scales/softness/strength — so the fog-like mask shape reads as before, PLUS a
// radial zoom-BLUR + CA (`radial*` fields), AE CC-Radial-Fast-Blur style,
// emanating from a tunable origin (`radialOriginX/Y`). The radial term was
// previously dropped and is now re-introduced; it
// layers on top of the directional smear and is gated by the progress bell, so
// it ramps in/out with the transition and fades off cleanly at the endpoints.
export const TRANSITION_LOOK_SWARM: TransitionLookParams = {
	smearStrength: 0.25,
	caStrength: 0.028,
	maskSoftness: 0.23,
	axisIndex: 1,
	noiseScaleX: 11.75,
	noiseScaleY: 2.55,
	noiseScrollSpeed: 0.2,
	// Soft fingery fog front — but kept near the (now-sane) maskSoftness so the
	// front actually READS as advancing with progress. With the old keyframed
	// softness of ~0.6–0.8 the smoothstep band was wider than the whole screen,
	// so the mask was a near-flat gradient that barely moved (no progress feel);
	// see the `swarmMaskSoftness` keyframe fix. 0.315 also over-broke the edge.
	maskNoiseStrength: 0.15,
	detailNoiseAmount: 0.0,
	radialStrength: 0.6,
	radialOriginX: 0.5,
	radialOriginY: 0.0,
	radialRadius: 0.1,
	radialSpreadX: -1,
	// Pixelation-glitch into the forest: `pixelStrength` is the peak mosaic mix
	// (bells over progress), `pixelBlockSize` the block edge as a fraction of
	// screen height (0.04 ≈ 25 blocks tall), `pixelGlitchAmount` the per-block
	// horizontal tear + RGB split. All bake against the PIXEL_* scales in
	// TransitionNode and stay live-tunable as `swarmPixel*` in Theatre.
	pixelStrength: 0.6,
	pixelBlockSize: 0.04,
	pixelGlitchAmount: 0.5
};

// Picks the right pair for the active transition. Direction-symmetric:
// scrolling 2→3 forward and 3→2 backward both resolve to 'swarm'.
export function pickTransitionPair(
	from: SceneIndex | null,
	to: SceneIndex | null
): TransitionPairId {
	if (from === null || to === null) return 'procedural';
	const pair = from < to ? [from, to] : [to, from];
	if (pair[0] === 2 && pair[1] === 3) return 'swarm';
	return 'procedural';
}
