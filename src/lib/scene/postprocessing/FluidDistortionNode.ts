import {
	nodeObject,
	Fn,
	If,
	clamp,
	convertToTexture,
	float,
	vec2,
	vec3,
	vec4,
	uv,
	abs,
	cos,
	length,
	max,
	mix,
	sin,
	smoothstep,
	step,
	Loop
} from 'three/tsl';
import { TempNode } from 'three/webgpu';

/**
 * FluidDistortionNode
 *
 * Post-process effect modeled on the VFX-JS fluid demo's display shader:
 * an 8-tap chromatic dispersion sweep along the local fluid velocity, plus
 * a speed-keyed spectrum overlay and a thin edge highlight at v ≈ 0.25.
 *
 * Inputs:
 *   - screen color (the upstream pass)
 *   - fluid velocity field (TextureNode from FluidMouseField.getVelocityNode())
 *   - simSize uniform (Vector2): pixel dimensions of the velocity buffer.
 *     Velocity samples are in sim-texel units, so divisions by simSize convert
 *     velocity to UV displacement.
 *   - strength: multiplier on the displacement vector (0 disables distortion).
 *   - isActive: 0/1 gate for cloud-transition fades; multiplied into strength.
 */
class FluidDistortionNode extends TempNode {
	static get type() {
		return 'FluidDistortionNode';
	}

	private screenTextureNode: any;
	private fluidTextureNode: any;
	private simSizeNode: any;
	private strengthNode: any;
	private isActiveNode: any;
	private debugNode: any;
	private colorTintNode: any;
	private colorAmountNode: any;

	constructor(
		screenTextureNode: any,
		fluidTextureNode: any,
		simSizeNode: any,
		strengthNode: any,
		isActiveNode: any,
		debugNode: any,
		colorTintNode: any,
		colorAmountNode: any
	) {
		super('vec4');
		this.screenTextureNode = screenTextureNode;
		this.fluidTextureNode = fluidTextureNode;
		this.simSizeNode = simSizeNode;
		this.strengthNode = strengthNode;
		this.isActiveNode = isActiveNode;
		this.debugNode = debugNode;
		this.colorTintNode = colorTintNode;
		this.colorAmountNode = colorAmountNode;
	}

	setup(): any {
		const screenTextureNode = this.screenTextureNode;
		const fluidTextureNode = this.fluidTextureNode;
		const simSizeNode = this.simSizeNode;
		const strengthNode = this.strengthNode;
		const isActiveNode = this.isActiveNode;
		const debugNode = this.debugNode;
		const colorTintNode = this.colorTintNode;
		const colorAmountNode = this.colorAmountNode;

		const fluidDispersionEffect = Fn(() => {
			const uvCoord = uv();

			// Y-flip when sampling the velocity texture: TSL `uv()` in this post-
			// processing pass uses y-down convention (top-left origin), but the
			// FluidMouseField writes splats via QuadMesh with y-up `uv()`. Without
			// this flip the dispersion mirrors vertically off the cursor.
			const fluidUv = vec2(uvCoord.x, float(1).sub(uvCoord.y));
			const velRaw = fluidTextureNode.sample(fluidUv);
			// Negate vy to keep the displacement direction consistent with the
			// flipped sample coordinate so the smear extends *toward* the cursor's
			// motion direction in screen space.
			const vel = vec2(velRaw.x, velRaw.y.negate());
			const activeStrength = strengthNode.mul(isActiveNode);
			// Clamp displacement so a runaway velocity field can't sample
			// pixels far outside [0,1] and smear edge color across the
			// whole screen. The bound has to stay above the visible
			// thresholds the shader uses below — the spectrum overlay
			// kicks in at length(disp) ≈ 0.2 and the edge ring at ~0.25,
			// so a per-axis cap of 0.5 leaves the normal effect intact
			// while still bounding worst-case sampling to half a screen.
			const dispRaw = vel.div(simSizeNode).mul(activeStrength);
			const disp = clamp(dispRaw, vec2(-0.5, -0.5), vec2(0.5, 0.5)).toVar();
			const v = length(disp);
			const tint = colorTintNode.toVar();
			const clearSampleUv = uvCoord.sub(disp.mul(0.3).mul(v));
			const clearDistorted = screenTextureNode.sample(clearSampleUv).toVar();

			// Idle gate: when the fluid is decayed/zero, displacement is tiny and
			// every tap below resolves to ~the same point as `clearDistorted`. Skip
			// the 8 samples and the spectrum/edge math entirely on those pixels.
			// The threshold matches the visible noise floor — well below the
			// spectrum onset (v ≈ 0.2) and edge ring (v ≈ 0.25) so motion-time
			// visuals are unaffected.
			//
			// Branch is GPU-coherent because nearby pixels share the same
			// near-zero velocity. Texture samples inside the `If` use `.level(0)`
			// because WGSL `textureSample` is undefined in non-uniform control
			// flow (implicit derivatives) — explicit LOD is safe and produces
			// identical output for the single-mip post-fx target.
			const dispersed = clearDistorted.toVar();
			const spectrumStrength = float(0).toVar();
			const spectrum = vec3(0).toVar();
			const edge = float(0).toVar();

			If(v.greaterThan(0.001), () => {
				// 8-tap chromatic dispersion: each tap contributes per-channel
				// weights from cos() lobes centered on (0, 0.5, 1) along the
				// sweep parameter t — R/G/B fan along the velocity vector.
				const accum = vec4(0).toVar();
				const wsum = vec3(0).toVar();
				const N = 8;
				Loop(N, ({ i }: { i: any }) => {
					const t = float(i).div(float(N - 1));
					const w = max(vec3(0), cos(t.sub(vec3(0, 0.5, 1)).mul(float(Math.PI).mul(0.5))));
					const sampleUv = uvCoord.sub(disp.mul(0.3).mul(t.add(0.3)).mul(v));
					const s = screenTextureNode.sample(sampleUv).level(0);
					accum.rgb.addAssign(s.rgb.mul(w));
					accum.a.addAssign(s.a.mul(w.r.add(w.g).add(w.b).div(3)));
					wsum.addAssign(w);
				});

				dispersed.assign(
					vec4(accum.rgb.div(wsum), accum.a.div(wsum.r.add(wsum.g).add(wsum.b).div(3)))
				);

				// Spectrum overlay keyed on speed.
				const sx = sin(v.mul(2)).mul(0.4).add(0.6);
				spectrum.assign(cos(sx.mul(vec3(0.1, 0.2, 0.01)).mul(float(Math.PI))));
				spectrumStrength.assign(smoothstep(0.2, 0.8, v).mul(0.5));

				// Thin edge highlight at v ≈ 0.25 — invert-trick with abs() flips
				// colors right at the ring (the example's signature look).
				edge.assign(smoothstep(0.003, 0, abs(v.sub(0.25))));
			});

			const spectrumOverlay = vec4(spectrum.mul(tint), 1).mul(spectrumStrength);
			dispersed.addAssign(spectrumOverlay.mul(colorAmountNode));

			const tintedEdge = vec4(tint.mul(0.5), 0).mul(edge.mul(colorAmountNode));
			const coloredDistortion = abs(dispersed.sub(tintedEdge));
			const finalColor = mix(clearDistorted, coloredDistortion, colorAmountNode);

			// Debug views:
			//   0 = final effect
			//   1 = raw velocity heatmap
			//   2 = glass distortion only (no color treatment)
			//   3 = color overlay only
			const debugVis = vec4(
				abs(vel.x).div(simSizeNode.x).mul(8),
				abs(vel.y).div(simSizeNode.y).mul(8),
				v.mul(2),
				1
			);
			const overlayOnly = vec4(spectrumOverlay.rgb.add(tint.mul(edge.mul(0.5))), 1);
			const showVelocity = step(0.5, debugNode).mul(float(1).sub(step(1.5, debugNode)));
			const showGlass = step(1.5, debugNode).mul(float(1).sub(step(2.5, debugNode)));
			const showOverlay = step(2.5, debugNode);
			const withVelocityDebug = mix(finalColor, debugVis, showVelocity);
			const withGlassDebug = mix(withVelocityDebug, clearDistorted, showGlass);
			return mix(withGlassDebug, overlayOnly, showOverlay);
		});

		return fluidDispersionEffect();
	}
}

export default FluidDistortionNode;

// Return type is intentionally `any` so the result chains naturally with the other
// post-processing nodes (bloom, fxaa, vignette) — TSL's node-chaining lives outside
// the TS class hierarchy and narrowing it here breaks `.add(...)` and the FXAA wrap.
export const fluidDistortion = (
	screenNode: any,
	fluidTexture: any,
	simSize: any,
	strength: any = 1.0,
	isActive: any = 1.0,
	debug: any = 0.0,
	colorTint: any = vec3(1, 1, 1),
	colorAmount: any = 0.15
): any => {
	const screenTextureNode = convertToTexture(screenNode);

	let fluidTextureNode: any;
	if (fluidTexture && fluidTexture.isNode) {
		fluidTextureNode = fluidTexture;
	} else {
		fluidTextureNode = convertToTexture(fluidTexture);
	}

	const simSizeNode = simSize?.isNode ? simSize : nodeObject(simSize);
	const strengthNode = strength?.isNode ? strength : nodeObject(strength);
	const isActiveNode = isActive?.isNode ? isActive : nodeObject(isActive);
	const debugNode = debug?.isNode ? debug : nodeObject(debug);
	const colorTintNode = colorTint?.isNode ? colorTint : nodeObject(colorTint);
	const colorAmountNode = colorAmount?.isNode ? colorAmount : nodeObject(colorAmount);

	return nodeObject(
		new FluidDistortionNode(
			screenTextureNode,
			fluidTextureNode,
			simSizeNode,
			strengthNode,
			isActiveNode,
			debugNode,
			colorTintNode,
			colorAmountNode
		)
	);
};
