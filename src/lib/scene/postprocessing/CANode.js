import { TempNode } from 'three/webgpu';
import { nodeObject, Fn, convertToTexture, float, vec3, vec4, uv, max } from 'three/tsl';
import { caExclusionFactor } from './caExclusion';

class ChromaticAberrationNode extends TempNode {
	static get type() {
		return 'ChromaticAberrationNode';
	}

	constructor(
		textureNode,
		strengthNode,
		centerNode,
		scaleNode,
		splitMixNode,
		exclusionRadiusNode,
		exclusionFeatherNode,
		aspectRatioNode,
		redTintNode,
		greenTintNode,
		blueTintNode
	) {
		super('vec4');

		this.textureNode = textureNode;
		this.strengthNode = strengthNode;
		this.centerNode = centerNode;
		this.scaleNode = scaleNode;
		this.splitMixNode = splitMixNode;
		this.exclusionRadiusNode = exclusionRadiusNode;
		this.exclusionFeatherNode = exclusionFeatherNode;
		this.aspectRatioNode = aspectRatioNode;
		this.redTintNode = redTintNode;
		this.greenTintNode = greenTintNode;
		this.blueTintNode = blueTintNode;
	}

	setup() {
		const textureNode = this.textureNode;
		const uvNode = textureNode.uvNode || uv();

		const ApplyChromaticAberration = Fn(
			([uv, strength, center, scale, splitMix, exclusionFactor, redTint, greenTint, blueTint]) => {
				const delta = uv.sub(center);
				const distance = delta.length();

				// `exclusionFactor` (0 inside the shared exclusion zone, 1 outside) is
				// computed once in the outer fn via the shared aspect-corrected helper
				// so this pass and RGBSplitNode carve out the SAME central disc.

				// Keep the existing large-scale radial feel, but make the per-channel
				// separation stable and monotonic so dense particle dots do not produce
				// black/negative-looking shimmer.
				const radialScale = scale.mul(float(0.02)).mul(strength).mul(exclusionFactor);
				const aberrationOffset = delta
					.mul(strength)
					.mul(distance)
					.mul(float(0.01))
					.mul(exclusionFactor);

				const base = textureNode.sample(uv);
				const splitOffset = delta.mul(radialScale).add(aberrationOffset);
				const redUV = uv.add(splitOffset);
				// Keep green closer to the source sample so it reads as the middle band,
				// but still offset it enough that the additive fringe pass can reveal it.
				const greenUV = uv.sub(splitOffset.mul(float(0.35)));
				const blueUV = uv.sub(splitOffset);

				// Per-channel chromatic dispersion: each offset sample MINUS the base at
				// this pixel, then colored by its tint. The subtraction is what keeps the
				// fringe OFF the flat body of the object — where a sample equals the base
				// the dispersion is 0, so no tint (of any color) can leak onto the solid
				// interior; only real edges/dots carry a fringe. Tinting the absolute
				// sample instead would recolor flat areas whenever the tints don't sum to
				// (1,1,1). Default tints (1,0,0)/(0,1,0)/(0,0,1) reproduce the prior
				// `split − base` exactly.
				const dispR = textureNode.sample(redUV).r.sub(base.r);
				const dispG = textureNode.sample(greenUV).g.sub(base.g);
				const dispB = textureNode.sample(blueUV).b.sub(base.b);

				// `disp` is the signed chromatic dispersion; the positive half
				// (`max(disp, 0)`) only brightens — safe to add over a dark composite and
				// the only half that survives on dense particle dots without black
				// shimmer. `splitMix` is the animated fringe-intensity multiplier scaling
				// all three channels uniformly (0 hides the fringe entirely; the timeline
				// pulses it across each scene), so it never shifts the fringe hue.
				const disp = redTint.mul(dispR).add(greenTint.mul(dispG)).add(blueTint.mul(dispB));
				const color = max(disp, vec3(0.0)).mul(splitMix);
				return vec4(color, base.a);
			}
		).setLayout({
			name: 'ChromaticAberrationShader',
			type: 'vec4',
			inputs: [
				{ name: 'uv', type: 'vec2' },
				{ name: 'strength', type: 'float' },
				{ name: 'center', type: 'vec2' },
				{ name: 'scale', type: 'float' },
				{ name: 'splitMix', type: 'float' },
				{ name: 'exclusionFactor', type: 'float' },
				{ name: 'redTint', type: 'vec3' },
				{ name: 'greenTint', type: 'vec3' },
				{ name: 'blueTint', type: 'vec3' }
			]
		});

		const chromaticAberrationFn = Fn(() => {
			const exclusionFactor = caExclusionFactor(
				uvNode,
				this.centerNode,
				this.exclusionRadiusNode,
				this.exclusionFeatherNode,
				this.aspectRatioNode
			);
			return ApplyChromaticAberration(
				uvNode,
				this.strengthNode,
				this.centerNode,
				this.scaleNode,
				this.splitMixNode,
				exclusionFactor,
				this.redTintNode,
				this.greenTintNode,
				this.blueTintNode
			);
		});

		return chromaticAberrationFn();
	}
}

export default ChromaticAberrationNode;

export const chromaticAberration = (
	node,
	strength = 1.0,
	center = null,
	scale = 1.1,
	splitMix = 0.35,
	exclusionRadius = 0.0,
	exclusionFeather = 0.16,
	aspectRatio = 1.0,
	redTint = vec3(1, 0, 0),
	greenTint = vec3(0, 1, 0),
	blueTint = vec3(0, 0, 1)
) => {
	return nodeObject(
		new ChromaticAberrationNode(
			convertToTexture(node),
			nodeObject(strength),
			nodeObject(center),
			nodeObject(scale),
			nodeObject(splitMix),
			nodeObject(exclusionRadius),
			nodeObject(exclusionFeather),
			nodeObject(aspectRatio),
			nodeObject(redTint),
			nodeObject(greenTint),
			nodeObject(blueTint)
		)
	);
};
