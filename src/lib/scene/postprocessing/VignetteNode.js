import { TempNode } from 'three/webgpu';
import {
	nodeObject,
	Fn,
	float,
	vec2,
	vec3,
	vec4,
	uv,
	mix,
	dot,
	clamp,
	smoothstep,
	max
} from 'three/tsl';

class VignetteNode extends TempNode {
	static get type() {
		return 'VignetteNode';
	}

	constructor(
		inputColorNode,
		intensityNode = 1.0,
		widthNode = 0.187,
		roundnessNode = 1.0,
		centerNode = 0.5,
		colorNode = [0, 0, 0],
		aspectRatioNode = 1.0
	) {
		super('vec4');

		this.inputColorNode = inputColorNode;
		this.intensityNode = float(intensityNode);
		this.widthNode = float(widthNode);
		this.roundnessNode = float(roundnessNode);
		this.centerNode = float(centerNode);
		this.colorNode = vec3(colorNode);
		this.aspectRatioNode = float(aspectRatioNode);
	}

	setup() {
		const uvNode = uv();

		const ApplyVignette = Fn(
			([
				inputColor,
				currentUv,
				intensity,
				width,
				roundness,
				center,
				vignetteColor,
				aspectRatio
			]) => {
				const centeredUV = currentUv.sub(vec2(0.5));

				// Scale UVs so a unit of distance equals half the SHORTER screen dimension.
				// This keeps the vignette circular in pixel space (the bright "eye" is a true circle).
				const correctedUV = vec2(
					centeredUV.x.mul(max(aspectRatio, 1.0)),
					centeredUV.y.mul(max(float(1.0).div(aspectRatio), 1.0))
				);

				// dist is the squared screen-space radius in half-min-dimension units.
				// 0 at center, 0.25 at the inscribed circle (top/bottom on wide, left/right on tall),
				// >0.25 outside the inscribed circle (long-axis edges and corners).
				const dist = dot(correctedUV, correctedUV);
				const adjustedDist = dist.mul(roundness);

				// Bounds work in dist² units (0 at center, 0.25 at the inscribed circle).
				// Two decoupled knobs define the fade band:
				//  - `center` (0..1) positions the band's center radius. 0.5 → 0.14,
				//    reproducing the original hardcoded position.
				//  - `width` is the gap (outerBound − innerBound) set DIRECTLY, so it
				//    is the literal thickness of the soft fade ring — 0 = razor-thin
				//    hard edge, larger = wider/softer. `spread` is just half of it.
				const centerDist = center.mul(0.28);
				const spread = width.mul(0.5);
				const innerBound = centerDist.sub(spread);
				const outerBound = centerDist.add(spread);

				const vignetteFactor = smoothstep(innerBound, outerBound, adjustedDist).mul(intensity);

				const finalColor = mix(inputColor.rgb, vignetteColor, clamp(vignetteFactor, 0.0, 1.0));

				return vec4(finalColor, inputColor.a);
			}
		).setLayout({
			name: 'VignetteShader',
			type: 'vec4',
			inputs: [
				{ name: 'inputColor', type: 'vec4' },
				{ name: 'currentUv', type: 'vec2' },
				{ name: 'intensity', type: 'float' },
				{ name: 'width', type: 'float' },
				{ name: 'roundness', type: 'float' },
				{ name: 'center', type: 'float' },
				{ name: 'vignetteColor', type: 'vec3' },
				{ name: 'aspectRatio', type: 'float' }
			]
		});

		// Pass the executed color node directly into the function
		return ApplyVignette(
			this.inputColorNode,
			uvNode,
			this.intensityNode,
			this.widthNode,
			this.roundnessNode,
			this.centerNode,
			this.colorNode,
			this.aspectRatioNode
		);
	}
}

export default VignetteNode;

export const vignette = (
	node,
	intensity = 1.0,
	width = 0.187,
	roundness = 1.0,
	center = 0.5,
	color = [0, 0, 0],
	aspectRatio = 1.0
) =>
	nodeObject(
		// No longer using convertToTexture(node) here so we don't trigger an extra render pass
		new VignetteNode(nodeObject(node), intensity, width, roundness, center, color, aspectRatio)
	);
