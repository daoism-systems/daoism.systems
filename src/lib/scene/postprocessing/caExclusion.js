// @ts-nocheck
import { float, vec2, smoothstep, length, max } from 'three/tsl';

/**
 * Shared screen-space chromatic-aberration exclusion factor.
 *
 * Returns 0 inside a circular zone centered at `center` (UV coords, where
 * 0.5,0.5 is the screen center) of the given `radius`, ramping to 1 over a
 * `feather`-wide band, and 1 everywhere outside. Multiply ANY CA pass's
 * per-channel offset by this so a single zone carves the same un-aberrated disc
 * out of every implementation (CANode radial CA + RGBSplitNode glitch CA).
 *
 * Aspect-corrected with the half-min-dimension convention shared by
 * VignetteNode / FisheyeNode / RGBSplitNode, so the zone is a true circle in
 * pixel space regardless of viewport ratio — not the corner-anchored ellipse
 * the old per-node math produced.
 *
 * Plain node-builder (not a layout'd `Fn`): callers invoke it in `setup()` with
 * the actual uniform nodes and pass the resulting float into their shader so the
 * exclusion math is computed once, outside the layout.
 */
export function caExclusionFactor(currentUv, center, radius, feather, aspectRatio) {
	const centered = currentUv.sub(center);
	const corrected = vec2(
		centered.x.mul(max(aspectRatio, 1.0)),
		centered.y.mul(max(float(1.0).div(aspectRatio), 1.0))
	);
	const dist = length(corrected);
	return smoothstep(radius, radius.add(feather), dist);
}
