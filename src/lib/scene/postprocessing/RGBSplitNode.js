// @ts-nocheck
import { TempNode } from 'three/webgpu';
import { nodeObject, Fn, convertToTexture, float, vec2, vec3, vec4, uv, mix, clamp, length, max } from 'three/tsl';
import { caExclusionFactor } from './caExclusion';

/**
 * RGBSplitNode
 *
 * Full-frame chromatic channel split ("glitch CA"). Samples the red channel at
 * `uv + offset` and the blue channel at `uv - offset`, recombining with the
 * UNSHIFTED green from the base sample, then crossfades to that result by
 * `strength`. Because flat regions have R==G==B, they stay neutral; only edges
 * and gradients separate into saturated red/cyan fringes.
 *
 * This REPLACES the frame with its per-channel-displaced version — unlike
 * {@link CANode}, which adds only the positive half of the dispersion as a halo
 * on top of the still-present original (and so washes out on a bright/inverted
 * background, and can never read as a true displacement no matter the params).
 * That additive-on-top model is why parameter sweeps on the existing CA never
 * matched the design's pyramid-frame look; this node is the displacement the
 * reference actually shows.
 *
 * Runs on the fully composited frame (see PostProcessingGraph.addCommonPostStack)
 * and is gated by a Theatre `rgbSplitStrength` track that is ~0 outside the
 * pyramid window, so it has no effect on the other scenes.
 *
 * Uniforms:
 *   - strength (0..1): master crossfade. 0 → identity (empty timeline = no-op).
 *   - offset: per-channel UV displacement magnitude (≈0.004 ≈ a few px each way).
 *   - radial (0..1): 0 = uniform horizontal split (the reference's left/right
 *     red/cyan fringes); 1 = radial split from screen center. Blended, so a
 *     small value adds a subtle lens-like curve to an otherwise horizontal split.
 *
 * Aspect-corrected radial direction matches the Fisheye/Vignette conventions so
 * the split stays symmetric in pixel space regardless of viewport ratio.
 */
class RGBSplitNode extends TempNode {
	static get type() {
		return 'RGBSplitNode';
	}

	constructor(
		textureNode,
		strengthNode,
		offsetNode,
		radialNode,
		aspectRatioNode,
		exclusionCenterNode,
		exclusionRadiusNode,
		exclusionFeatherNode,
		redTintNode,
		greenTintNode,
		blueTintNode,
		greenOffsetNode
	) {
		super('vec4');
		this.textureNode = textureNode;
		this.strengthNode = strengthNode;
		this.offsetNode = offsetNode;
		this.radialNode = radialNode;
		this.aspectRatioNode = aspectRatioNode;
		this.exclusionCenterNode = exclusionCenterNode;
		this.exclusionRadiusNode = exclusionRadiusNode;
		this.exclusionFeatherNode = exclusionFeatherNode;
		this.redTintNode = redTintNode;
		this.greenTintNode = greenTintNode;
		this.blueTintNode = blueTintNode;
		this.greenOffsetNode = greenOffsetNode;
	}

	setup() {
		const textureNode = this.textureNode;
		const uvNode = textureNode.uvNode || uv();

		// Shared CA exclusion zone (see caExclusion.js): 0 inside the central disc,
		// 1 outside. Computed once here and passed into the shader so this full-frame
		// split and the radial CANode pass carve out the SAME region.
		const exclusionFactor = caExclusionFactor(
			uvNode,
			this.exclusionCenterNode,
			this.exclusionRadiusNode,
			this.exclusionFeatherNode,
			this.aspectRatioNode
		);

		const ApplyRGBSplit = Fn(([currentUv, strength, offset, radial, aspectRatio, exclusion, redTint, greenTint, blueTint, greenOffset]) => {
			const baseColor = textureNode.sample(currentUv);

			// Aspect-corrected centered coords (half-min-dimension units, same
			// convention as VignetteNode) → a radial direction that points away
			// from the screen center symmetrically in pixel space.
			const centered = currentUv.sub(vec2(0.5));
			const corrected = vec2(
				centered.x.mul(max(aspectRatio, 1.0)),
				centered.y.mul(max(float(1.0).div(aspectRatio), 1.0))
			);
			const r = length(corrected).add(0.0001);
			const radialDir = vec2(
				corrected.x.div(r).div(max(aspectRatio, 1.0)),
				corrected.y.div(r).div(max(float(1.0).div(aspectRatio), 1.0))
			);

			// Horizontal-dominant split, optionally curved toward radial. The
			// reference fringes run left/right, so radial stays small by default.
			// Scaled by the exclusion factor so the per-channel displacement (and thus
			// any visible fringe) collapses to 0 inside the central zone — there the
			// red/blue samples land on the unshifted pixel, so the split equals base
			// regardless of strength.
			const dir = mix(vec2(1.0, 0.0), radialDir, radial);
			const channelOffset = dir.mul(offset).mul(exclusion);

			const uvR = clamp(currentUv.add(channelOffset), vec2(0.0), vec2(1.0));
			const uvB = clamp(currentUv.sub(channelOffset), vec2(0.0), vec2(1.0));
			// Green displaced OPPOSITE red (toward blue) by `greenOffset`× the channel
			// offset. At 0 green stays on the source pixel — its dispersion is 0, so its
			// tint is inert and the classic stationary-green look is preserved; raise it
			// and green gains a fringe its tint can color (0.35 mirrors the radial CA
			// pass's green split). Inherits the exclusion + breathing already folded into
			// channelOffset, so green collapses inside the central disc like red/blue.
			const uvG = clamp(currentUv.sub(channelOffset.mul(greenOffset)), vec2(0.0), vec2(1.0));

			// Tint each channel's DISPERSION — the offset sample MINUS the base at this
			// pixel — never its absolute value. In a flat region every sample equals the
			// base, so the dispersion is 0 and the pixel keeps its exact original color:
			// the tint can only ever touch real edges/gradients (the particles + pyramid
			// silhouettes), never the flat body of the frame. With the default tints
			// (1,0,0)/(0,1,0)/(0,0,1) and greenOffset 0 the fringe is
			// (sample(uvR).r − base.r, 0, sample(uvB).b − base.b), so `split` reduces to
			// the untinted vec3(sample(uvR).r, base.g, sample(uvB).b) exactly.
			const fringe = redTint
				.mul(textureNode.sample(uvR).r.sub(baseColor.r))
				.add(greenTint.mul(textureNode.sample(uvG).g.sub(baseColor.g)))
				.add(blueTint.mul(textureNode.sample(uvB).b.sub(baseColor.b)));
			const split = baseColor.rgb.add(fringe);

			const finalRgb = mix(baseColor.rgb, split, strength);
			return vec4(finalRgb, baseColor.a);
		}).setLayout({
			name: 'RGBSplitShader',
			type: 'vec4',
			inputs: [
				{ name: 'currentUv', type: 'vec2' },
				{ name: 'strength', type: 'float' },
				{ name: 'offset', type: 'float' },
				{ name: 'radial', type: 'float' },
				{ name: 'aspectRatio', type: 'float' },
				{ name: 'exclusion', type: 'float' },
				{ name: 'redTint', type: 'vec3' },
				{ name: 'greenTint', type: 'vec3' },
				{ name: 'blueTint', type: 'vec3' },
				{ name: 'greenOffset', type: 'float' }
			]
		});

		return ApplyRGBSplit(
			uvNode,
			this.strengthNode,
			this.offsetNode,
			this.radialNode,
			this.aspectRatioNode,
			exclusionFactor,
			this.redTintNode,
			this.greenTintNode,
			this.blueTintNode,
			this.greenOffsetNode
		);
	}
}

export default RGBSplitNode;

export const rgbSplit = (
	node,
	strength = 0.0,
	offset = 0.004,
	radial = 0.15,
	aspectRatio = 1.0,
	exclusionCenter = vec2(0.5, 0.5),
	exclusionRadius = 0.0,
	exclusionFeather = 0.16,
	redTint = vec3(1, 0, 0),
	greenTint = vec3(0, 1, 0),
	blueTint = vec3(0, 0, 1),
	greenOffset = 0.0
) =>
	nodeObject(
		new RGBSplitNode(
			convertToTexture(node),
			nodeObject(strength),
			nodeObject(offset),
			nodeObject(radial),
			nodeObject(aspectRatio),
			nodeObject(exclusionCenter),
			nodeObject(exclusionRadius),
			nodeObject(exclusionFeather),
			nodeObject(redTint),
			nodeObject(greenTint),
			nodeObject(blueTint),
			nodeObject(greenOffset)
		)
	);
