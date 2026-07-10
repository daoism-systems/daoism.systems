// @ts-nocheck
import { TempNode } from 'three/webgpu';
import {
	nodeObject,
	Fn,
	convertToTexture,
	float,
	vec2,
	vec3,
	vec4,
	uv,
	mix,
	clamp,
	length,
	max
} from 'three/tsl';

/**
 * FisheyeNode
 *
 * Full-frame post-process barrel (fisheye) lens distortion with optional
 * radial chromatic aberration. Master `strength` blends the warped result
 * with the unmodified upstream pass, so a single Theatre track can ramp the
 * whole effect in/out without snapping on at non-zero distortion. No circular
 * lens mask — edge darkening is owned by the separate vignette pass.
 *
 * Uniforms:
 *   - strength (0..1): master blend. 0 → identity; 1 → full warp + CA.
 *   - barrel: pincushion magnification. Larger values stretch content
 *     from the screen center outward so geometry near the lens center
 *     visibly bulges toward the edges.
 *   - aberration: per-channel radial offset around the warp direction so
 *     lens edges fringe red/blue. Stays subtle (~0.015) — accumulates with
 *     `barrel`.
 *
 * Aspect-corrected radial math keeps the warp symmetric in pixel space
 * regardless of viewport ratio (same convention as `VignetteNode`).
 */
class FisheyeNode extends TempNode {
	static get type() {
		return 'FisheyeNode';
	}

	constructor(textureNode, strengthNode, barrelNode, aberrationNode, aspectRatioNode) {
		super('vec4');
		this.textureNode = textureNode;
		this.strengthNode = strengthNode;
		this.barrelNode = barrelNode;
		this.aberrationNode = aberrationNode;
		this.aspectRatioNode = aspectRatioNode;
	}

	setup() {
		const textureNode = this.textureNode;
		const uvNode = textureNode.uvNode || uv();

		const ApplyFisheye = Fn(([currentUv, strength, barrel, aberration, aspectRatio]) => {
				const baseColor = textureNode.sample(currentUv);

				// Aspect-corrected centered coords. Half-min-dimension units, so a
				// radius of 0.5 reaches the shorter axis edge — same convention as
				// VignetteNode for visual consistency between the two passes.
				const centered = currentUv.sub(vec2(0.5));
				const corrected = vec2(
					centered.x.mul(max(aspectRatio, 1.0)),
					centered.y.mul(max(float(1.0).div(aspectRatio), 1.0))
				);
				const r = length(corrected);
				const r2 = r.mul(r);

				// Pincushion sample displacement: sampleR = screenR / (1 + barrel*r²).
				// Sample radius SHRINKS with r so content from near the screen
				// center gets pushed outward toward the lens edge — geometry
				// "pools" against the outside of the disc, matching the handoff.
				// Rational form (vs. `1 - k*r²`) stays monotonic and strictly
				// positive for any barrel >= 0, so pushing the slider hard in
				// Studio can't flip the image inside-out at the corners. Active
				// barrel is scaled by `strength` so the warp rolls off in lockstep
				// with the master blend.
				const activeBarrel = barrel.mul(strength);
				const warpFactor = float(1.0).div(float(1.0).add(r2.mul(activeBarrel)));
				const warpedCorrected = corrected.mul(warpFactor);
				const warpedUv = vec2(
					warpedCorrected.x.div(max(aspectRatio, 1.0)),
					warpedCorrected.y.div(max(float(1.0).div(aspectRatio), 1.0))
				).add(vec2(0.5));

				// Per-channel radial CA. Red samples slightly further out, blue
				// slightly further in, along the same radial direction as the
				// barrel warp — produces coherent prismatic fringes on lens
				// edges rather than per-pixel speckle.
				const caAmount = aberration.mul(strength).mul(r);
				const radialDir = corrected.div(r.add(0.0001));
				const radialDirUv = vec2(
					radialDir.x.div(max(aspectRatio, 1.0)),
					radialDir.y.div(max(float(1.0).div(aspectRatio), 1.0))
				);
				const caOffset = radialDirUv.mul(caAmount);
				const uvR = clamp(warpedUv.add(caOffset), vec2(0.0), vec2(1.0));
				const uvG = clamp(warpedUv, vec2(0.0), vec2(1.0));
				const uvB = clamp(warpedUv.sub(caOffset), vec2(0.0), vec2(1.0));

				const warpedSample = vec3(
					textureNode.sample(uvR).r,
					textureNode.sample(uvG).g,
					textureNode.sample(uvB).b
				);

				// Master crossfade between the upstream pass and the warped output.
				// At strength=0 this resolves to base, so an empty timeline has zero
				// visual impact.
				const finalRgb = mix(baseColor.rgb, warpedSample, strength);
				return vec4(finalRgb, baseColor.a);
			}
		).setLayout({
			name: 'FisheyeShader',
			type: 'vec4',
			inputs: [
				{ name: 'currentUv', type: 'vec2' },
				{ name: 'strength', type: 'float' },
				{ name: 'barrel', type: 'float' },
				{ name: 'aberration', type: 'float' },
				{ name: 'aspectRatio', type: 'float' }
			]
		});

		return ApplyFisheye(
			uvNode,
			this.strengthNode,
			this.barrelNode,
			this.aberrationNode,
			this.aspectRatioNode
		);
	}
}

export default FisheyeNode;

export const fisheye = (node, strength = 0.0, barrel = 0.5, aberration = 0.015, aspectRatio = 1.0) =>
	nodeObject(
		new FisheyeNode(
			convertToTexture(node),
			nodeObject(strength),
			nodeObject(barrel),
			nodeObject(aberration),
			nodeObject(aspectRatio)
		)
	);
