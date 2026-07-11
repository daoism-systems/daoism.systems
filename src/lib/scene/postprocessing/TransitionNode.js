// @ts-nocheck
import { TempNode, Vector2 } from 'three/webgpu';
import {
	nodeObject,
	convertToTexture,
	float,
	vec2,
	vec3,
	vec4,
	uv,
	If,
	clamp,
	mix,
	smoothstep,
	floor,
	fract,
	sin,
	dot,
	texture,
	uniform,
	NodeUpdateType,
	viewportCoordinate
} from 'three/tsl';

const BLUE_NOISE_FALLBACK_SIZE = 128;
const SMEAR_TAPS = 16;
// Reduced-quality (mobile) swarm tap count. The blue-noise per-pixel jitter
// dithers the gaps between taps, so the smear reads as blur rather than
// banding even this sparse.
const REDUCED_SMEAR_TAPS = 6;
const CA_ACTIVE_EPSILON = 0.0001;
const GRADIENT_EPS = 0.003;
// `maskSoftness` is the half-width of the dissolve smoothstep band
// (`smoothstep(threshold - s, threshold + s, …)` in buildDissolveMask/maskAtTap).
// Theatre keyframes both pairs' softness down to 0 at the high-position end of
// their transition windows; at s=0 the two smoothstep edges coincide and the
// GPU divides by zero → NaN/Inf in the transition output. Forward scroll never
// hits it (softness reaches 0 only as progress→1, where coreWeight gates the
// distortion branch off), but reverse scroll evaluates the band mid-progress
// with softness≈0 → a dark frame the feedback sanitize then freezes. Floor it
// so the edges always have non-zero separation; the value is tiny enough to
// preserve the intended near-hard cut.
const MASK_SOFTNESS_MIN = 0.0015;
// Radial zoom-BLUR + CA layered on the swarm smear, AE CC-Radial-Fast-Blur
// style, emanating from a tunable origin. These bake the per-unit-distance
// scale of the streak length (how far each tap is displaced along the radial
// line at the far tap) and of the radial chromatic split; the artist dials
// overall intensity via the per-look `radialStrength` uniform.
const RADIAL_BLUR_SCALE = 0.3;
const RADIAL_CA_SCALE = 0.06;

// Pixelation-glitch layered on the swarm smear (2→3 only): mosaic-quantize each
// tap's sample UV to a block grid, tear whole blocks horizontally with a
// time-stepped per-block noise, and split RGB on the tearing blocks. These bake
// the fixed scales the per-look `pixel*` uniforms dial against; the artist sets
// overall intensity via `pixelStrength` (0 ⇒ inert, as on the procedural look).
// PIXEL_BLOCK_MIN floors the block size so 1/pixelBlockSize can't blow up the
// grid resolution (or divide by zero at pixelBlockSize 0 on the procedural look).
const PIXEL_BLOCK_MIN = 0.004;
// Per-block horizontal tear distance (UV) at pixelGlitchAmount 1.
const PIXEL_DISPLACE_SCALE = 0.08;
// Per-block RGB channel split (UV) at pixelGlitchAmount 1.
const PIXEL_CA_SCALE = 0.04;
// Tear re-step rate: floor(noiseTime·this) advances the per-block seed in
// discrete jumps so the glitch stutters digitally instead of scrolling smoothly.
const PIXEL_TIME_SCALE = 14.0;

// Per-pair uniform records (`proceduralLook`, `swarmLook`) carry the look
// params for each transition pair. The branch chosen at runtime by
// `pairSelectorNode` (0 = procedural, 1 = swarm) reads its own set, so
// theatre/inspector edits to one pair don't leak into the other.
//
// Both pairs now run the same directional-smear distortion, so every field has
// identical meaning across pairs; each pair keeps its own uniform set only so
// its look can be tuned independently. `detailNoiseAmount` adds a blue-noise
// perturbation to the dissolve edge for either pair.
const LOOK_FIELDS = [
	'smearStrength',
	'caStrength',
	'maskSoftness',
	'axisIndex',
	'noiseScaleX',
	'noiseScaleY',
	'noiseScrollSpeed',
	'maskNoiseStrength',
	'detailNoiseAmount',
	// Swarm-only radial zoom-blur/CA. `radialStrength` is 0 on the procedural
	// look, so the radial term is inert there; `radialOriginX/Y` set the UV origin,
	// `radialRadius` the inner dead-zone (effect is 0 within it, grows outward), and
	// `radialSpreadX` stretches the fan horizontally (>1 reaches further left/right).
	'radialStrength',
	'radialOriginX',
	'radialOriginY',
	'radialRadius',
	'radialSpreadX',
	// Swarm-only pixelation-glitch. `pixelStrength` is 0 on the procedural look, so
	// the mosaic/tear/split term is inert there; `pixelBlockSize` is the mosaic
	// block edge (fraction of screen height; smaller ⇒ finer grid), and
	// `pixelGlitchAmount` drives the per-block horizontal tear and RGB channel split.
	'pixelStrength',
	'pixelBlockSize',
	'pixelGlitchAmount'
];

function normalizeLook(source = {}, fallbackScalar = 0) {
	const out = {};
	for (const key of LOOK_FIELDS) {
		const value = source[key];
		out[key] = value !== undefined && value !== null ? float(value) : float(fallbackScalar);
	}
	return out;
}

class TransitionNode extends TempNode {
	static get type() {
		return 'TransitionNode';
	}

	constructor({
		inputColorNode,
		progressNode = 0.0,
		fromSceneColorNode = null,
		toSceneColorNode = null,
		mixTextureNode = null,
		blueNoiseTextureNode = null,
		sweepDirectionNode = 1.0,
		pairSelectorNode = 0.0,
		aspectRatioNode = 1.0,
		proceduralLook = {},
		swarmLook = {},
		// Build-time quality fork (mobile): single-tap sampling (no per-channel
		// chromatic split), fewer smear taps, and the gradient-based extras
		// (stroke edge, curl, glass wobble) dropped. Decided once at graph
		// construction — the cheap variant is a different shader, not a runtime
		// branch, so there is no per-frame or pipeline-count cost.
		reducedQuality = false
	}) {
		super('vec4');
		this.updateBeforeType = NodeUpdateType.FRAME;
		this.reducedQuality = reducedQuality === true;
		this.inputColorNode = inputColorNode;
		this.progressNode = float(progressNode);
		this.sweepDirectionNode = float(sweepDirectionNode);
		this.pairSelectorNode = float(pairSelectorNode);
		this.aspectRatioNode = float(aspectRatioNode);
		this.proceduralLook = normalizeLook(proceduralLook);
		this.swarmLook = normalizeLook(swarmLook);
		// Floor maskSoftness so the dissolve smoothstep can never divide by zero
		// (see MASK_SOFTNESS_MIN). Covers both use sites since the clamped node
		// flows through buildDissolveMask and maskAtTap.
		const minSoftness = float(MASK_SOFTNESS_MIN);
		this.proceduralLook.maskSoftness = this.proceduralLook.maskSoftness.max(minSoftness);
		this.swarmLook.maskSoftness = this.swarmLook.maskSoftness.max(minSoftness);
		// `float(progressNode)` above wraps the uniform in a VarNode with no
		// CPU-side `.value`, so keep the raw uniform to read live progress in
		// updateBefore (used to gate + reset the noise clock at rest).
		this._progressInput = progressNode;
		this.fromSceneTextureNode = convertToTexture(fromSceneColorNode || inputColorNode);
		this.toSceneTextureNode = convertToTexture(
			toSceneColorNode || fromSceneColorNode || inputColorNode
		);
		this.mixTextureNode = convertToTexture(mixTextureNode || fromSceneColorNode || inputColorNode);
		this.blueNoiseTextureNode = convertToTexture(
			blueNoiseTextureNode || fromSceneColorNode || toSceneColorNode || inputColorNode
		);
		this.blueOffsetNode = uniform(new Vector2(Math.random() * 10.0, Math.random() * 12.5));
		this.blueInvSizeNode = uniform(1 / BLUE_NOISE_FALLBACK_SIZE);
		this.noiseTimeNode = uniform(0);
		this._noiseLastMs = -1;
	}

	updateBefore() {
		// `noiseTimeNode` scrolls the procedural FBM, which hashes through
		// `sin(dot(floor(noiseUv), bigConstants)) * 43758`. Because `noiseUv`
		// scales with `noiseTime`, the hash argument grows with it, and GPU
		// `sin()` loses precision badly once that argument reaches the thousands —
		// the noise then collapses into a static-looking field. So `noiseTime`
		// must stay small. Read the LIVE progress from the raw uniform
		// (`this.progressNode` is a float()-wrapped VarNode whose `.value` is
		// `undefined`, which is why the old `progressNode.value <= 0` guard never
		// fired and let `noiseTime` accumulate every frame — idle included — until
		// the swarm mask froze on later passes). At rest, reset the dt clock AND
		// `noiseTime` so every transition starts from 0 and the hash stays in its
		// reliable range. The reset is invisible: at progress<=0 the smear is fully
		// gated out (envelope/coreWeight = 0).
		const rawProgress =
			typeof this._progressInput === 'number' ? this._progressInput : this._progressInput?.value;
		if (typeof rawProgress === 'number' && rawProgress <= 0) {
			this._noiseLastMs = -1;
			this.noiseTimeNode.value = 0;
			return;
		}

		const blueTexture = this.blueNoiseTextureNode?.value;
		const width = blueTexture?.image?.width;
		if (typeof width === 'number' && width > 0) {
			this.blueInvSizeNode.value = 1 / width;
		}

		const now = performance.now();
		if (this._noiseLastMs < 0) {
			this._noiseLastMs = now;
			return;
		}
		const dt = Math.min(0.1, (now - this._noiseLastMs) / 1000);
		this._noiseLastMs = now;
		this.noiseTimeNode.value = (this.noiseTimeNode.value + dt) % 1e4;
	}

	sample2D(texNode, coord) {
		return texture(texNode, coord);
	}

	sampleMaskLuma(coord) {
		const maskUv = vec2(float(1.0).sub(coord.x), coord.y);
		const rgb = this.sample2D(this.mixTextureNode, maskUv).rgb;
		return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
	}

	getBlueNoiseSample() {
		const noiseUv = viewportCoordinate.xy.mul(this.blueInvSizeNode).add(this.blueOffsetNode);
		return this.sample2D(this.blueNoiseTextureNode, noiseUv);
	}

	valueNoise(p) {
		const i = floor(p);
		const f = fract(p);
		const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
		const hash = (n) => fract(sin(dot(n, vec2(127.1, 311.7))).mul(43758.5453));
		const a = hash(i);
		const b = hash(i.add(vec2(1.0, 0.0)));
		const c = hash(i.add(vec2(0.0, 1.0)));
		const d = hash(i.add(vec2(1.0, 1.0)));
		return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
	}

	ridgedOctave(p) {
		const n = this.valueNoise(p);
		const ridge = float(1.0).sub(n.mul(2.0).sub(1.0).abs());
		return ridge.pow(1.35);
	}

	ridgedFbm2(p) {
		const o0 = this.ridgedOctave(p).mul(0.58);
		const o1 = this.ridgedOctave(p.mul(2.05)).mul(0.42);
		return o0.add(o1);
	}

	fbm2(p) {
		const o0 = this.valueNoise(p).mul(0.5);
		const o1 = this.valueNoise(p.mul(2.0)).mul(0.25);
		return o0.add(o1).div(0.75);
	}

	// Per-pair noise UV: takes the look set's noise scales/scroll so each
	// transition pair can dial its own displacement field independently.
	noiseUvAt(screenUv, look) {
		const baseX = screenUv.x.mul(look.noiseScaleX);
		const warpX = this.fbm2(
			vec2(
				baseX.mul(0.45).add(this.noiseTimeNode.mul(look.noiseScrollSpeed.mul(0.35))),
				screenUv.y.mul(look.noiseScaleY.mul(0.08))
			)
		)
			.sub(0.5)
			.mul(look.noiseScaleX.mul(0.22));
		return vec2(
			baseX.add(warpX),
			screenUv.y.mul(look.noiseScaleY).add(this.noiseTimeNode.mul(look.noiseScrollSpeed))
		);
	}

	ridgedFbm2At(noiseUv) {
		return this.ridgedFbm2(noiseUv);
	}

	noiseRidgeEdgeAt(noiseUv) {
		const eps = float(GRADIENT_EPS);
		const nPx = this.ridgedFbm2At(noiseUv.add(vec2(eps, 0.0)));
		const nMx = this.ridgedFbm2At(noiseUv.sub(vec2(eps, 0.0)));
		const nPy = this.ridgedFbm2At(noiseUv.add(vec2(0.0, eps)));
		const nMy = this.ridgedFbm2At(noiseUv.sub(vec2(0.0, eps)));
		const grad = vec2(nPx.sub(nMx), nPy.sub(nMy)).div(eps.mul(2.0));
		return clamp(grad.length().mul(float(7.0)), float(0.0), float(1.0));
	}

	maskAtTap(tapUv, ridgeAtSource, sweepSign01, look) {
		const tapAxisCoord = mix(tapUv.x, tapUv.y, look.axisIndex);
		const tapAxis = mix(float(1.0).sub(tapAxisCoord), tapAxisCoord, sweepSign01);
		const tapPerturbed = tapAxis.add(ridgeAtSource.sub(0.5).mul(2.0).mul(look.maskNoiseStrength));
		return float(1.0).sub(
			smoothstep(
				this.progressNode.sub(look.maskSoftness),
				this.progressNode.add(look.maskSoftness),
				tapPerturbed
			)
		);
	}

	// Parabolic 0→1→0 envelope: 1 at x=0.5, 0 at x∈{0,1}. Used for the
	// progress bell (peaks mid-transition) and the boundary band (peaks at the
	// dissolve front).
	bell(x) {
		return x.mul(float(1.0).sub(x)).mul(4.0);
	}

	frontProximityAt(m) {
		return this.bell(m).pow(1.6);
	}

	sweepAxisVec(axisIndexNode) {
		return mix(vec2(1.0, 0.0), vec2(0.0, 1.0), axisIndexNode);
	}

	sweepPerpAxisVec(axisIndexNode) {
		return mix(vec2(0.0, 1.0), vec2(-1.0, 0.0), axisIndexNode);
	}

	smearTapCaGates(t, mAtTap, strokeEdge, envelope) {
		const tailGate = float(1.0).sub(t).pow(3.0);
		const frontBand = this.frontProximityAt(mAtTap);
		const frontGate = tailGate.mul(frontBand).mul(envelope);
		const strokeGate = tailGate.mul(strokeEdge).mul(frontBand).mul(0.75).mul(envelope);
		return { frontGate, strokeGate };
	}

	caSplitTap(texNode, tapUv, caVec) {
		// Reduced quality: one sample instead of three — drops 2/3 of the
		// transition's texture taps. `caVec` may be null in this mode.
		if (this.reducedQuality) {
			return this.sample2D(texNode, tapUv).rgb;
		}
		const result = vec3(0.0).toVar();
		const caMag = caVec.length();
		If(caMag.greaterThan(CA_ACTIVE_EPSILON), () => {
			result.assign(
				vec3(
					this.sample2D(texNode, tapUv.add(caVec)).r,
					this.sample2D(texNode, tapUv).g,
					this.sample2D(texNode, tapUv.sub(caVec)).b
				)
			);
		}).Else(() => {
			result.assign(this.sample2D(texNode, tapUv).rgb);
		});
		return result;
	}

	// Soft noisy dissolve shared by both paths: sweeps along the look's axis,
	// perturbed by ridged noise (`maskNoiseStrength`) so the boundary breaks
	// into fingers, and resolved into a 0→1 mask `m` against `threshold` (raw
	// progress; pixels that never reach m=1 are pulled to the `to` scene by
	// highPull downstream). `detailTerm`, when provided, adds the extra
	// blue-noise edge perturbation. Returns the pieces each branch reuses.
	buildDissolveMask(screenUv, look, threshold, detailTerm = null) {
		const sweepSign01 = this.sweepDirectionNode.mul(0.5).add(0.5);
		const axisCoord = mix(screenUv.x, screenUv.y, look.axisIndex);
		const axis = mix(float(1.0).sub(axisCoord), axisCoord, sweepSign01);
		const noiseUv = this.noiseUvAt(screenUv, look);
		const L1 = this.ridgedFbm2At(noiseUv);
		let perturbedAxis = axis.add(L1.sub(0.5).mul(2.0).mul(look.maskNoiseStrength));
		if (detailTerm) perturbedAxis = perturbedAxis.add(detailTerm);
		const m = float(1.0).sub(
			smoothstep(threshold.sub(look.maskSoftness), threshold.add(look.maskSoftness), perturbedAxis)
		);
		return { sweepSign01, noiseUv, L1, m };
	}

	// Directional smear + chromatic-aberration distortion used by the SWARM
	// (2→3) pair. Sweeps along `look.axisIndex`, accumulating SMEAR_TAPS samples
	// of the from/to scenes displaced along the sweep direction (broken into
	// fingers by ridged noise and a curl perturbation), with the chromatic split
	// gated by the dissolve front/stroke envelope. Because it AVERAGES many taps
	// it reads as a motion blur — the swarm look. (The procedural 1→2 pair uses
	// `glassDistort` instead, which displaces + samples once for a sharp,
	// refractive "liquid glass" look.) `detailTerm` adds the optional blue-noise
	// edge perturbation; `blueNoiseR` drives per-tap jitter; `tag` disambiguates
	// the toVar names. Each tap is also displaced along the radial line from a
	// tunable origin (a radial zoom-blur) with a matching radial CA term —
	// swarm-only, inert on the procedural look (`radialStrength` 0). Each tap's
	// sample UV is then run through a pixelation-glitch (mosaic block-quantize +
	// per-block horizontal tear + RGB channel split), also swarm-only and gated by
	// `bell(progress)·pixelStrength` so it ramps in/out and is inert at progress
	// 0/1. Returns the settled vec3.
	smearDistort(screenUv, look, detailTerm, blueNoiseR, tag) {
		// Radial zoom-BLUR from the tunable origin (`radialOriginX/Y`), layered on
		// the swarm smear: each tap is additionally displaced ALONG the
		// line from the origin (see `radialTapOffset` in the loop — proportional to
		// the tap parameter and to distance from the origin), so content streaks
		// into rays that lengthen toward the edges, AE CC-Radial-Fast-Blur style.
		// `radialGate` folds in `radialStrength` (0 → inert, as on the procedural
		// look) and the progress bell (0 at the endpoints), so the streaks ramp
		// in/out with the transition and vanish at rest. The dissolve mask stays on
		// the unwarped `screenUv` so only the content streaks, not the front shape.
		const radialGate = this.bell(this.progressNode).mul(look.radialStrength);
		// Origin-relative delta, with the horizontal axis stretched by
		// `radialSpreadX` so the fan reaches further left/right (a wider 180° spread
		// from a bottom-center origin) without changing the vertical reach.
		const radialDelta = vec2(
			screenUv.x.sub(look.radialOriginX).mul(look.radialSpreadX),
			screenUv.y.sub(look.radialOriginY)
		);
		// Aspect-correct into square (pixel-proportional) space so the spread is an
		// even CIRCLE in screen pixels, take the unit direction, then let the
		// magnitude GROW with distance beyond a `radialRadius` dead-zone. The effect
		// is ~0 at the origin (and inside the dead-zone) and gets stronger toward the
		// edges, so the streaks spread OUTWARD from the origin instead of sitting
		// bounded inside a central circle.
		const aspect = this.aspectRatioNode;
		const radialDeltaSq = vec2(radialDelta.x.mul(aspect), radialDelta.y);
		const radialDist = radialDeltaSq.length();
		const radialDir = radialDeltaSq.div(radialDist.add(0.0001));
		const radialDirUv = vec2(radialDir.x.div(aspect), radialDir.y);
		const radialMag = radialDist.sub(look.radialRadius).max(0.0);
		const radialVec = radialDirUv.mul(radialMag);

		// Pixelation-glitch precompute (swarm-only; pixelStrength 0 ⇒ pixelGate 0 ⇒
		// every tap's UV passes through untouched, so the procedural look and the
		// transition endpoints are unaffected). `pixelGate` folds in pixelStrength and
		// the progress bell so the mosaic ramps in/out with the transition and is inert
		// at progress 0/1. `pixelGrid` is the block resolution: 1/pixelBlockSize rows,
		// aspect-scaled in X so the blocks stay square on screen.
		const pixelGate = this.bell(this.progressNode).mul(look.pixelStrength);
		const pixelGridY = float(1.0).div(look.pixelBlockSize.max(float(PIXEL_BLOCK_MIN)));
		const pixelGrid = vec2(pixelGridY.mul(aspect), pixelGridY);

		const { sweepSign01, noiseUv, L1, m } = this.buildDissolveMask(
			screenUv,
			look,
			this.progressNode,
			detailTerm
		);

		const globalBell = this.bell(this.progressNode);
		const boundaryBell = this.bell(m);
		const envelope = globalBell.mul(boundaryBell);

		const smearAmp = look.smearStrength.mul(envelope);
		// strokeEdge only feeds the per-tap CA gates, which the reduced path
		// drops entirely — skipping it saves 4 ridged-fbm evaluations per pixel.
		const strokeEdge = this.reducedQuality ? null : this.noiseRidgeEdgeAt(noiseUv);
		const sweepAxis = this.sweepAxisVec(look.axisIndex);
		const sweepPerp = this.sweepPerpAxisVec(look.axisIndex);
		const dir = this.sweepDirectionNode;

		// Curl perturbation costs 4 fbm evaluations per pixel; on the reduced
		// path the fingers are still broken up by L1 via smearMag, so drop it.
		let curl;
		if (this.reducedQuality) {
			curl = vec2(0.0, 0.0);
		} else {
			const curlEps = float(0.02);
			const hCx = this.fbm2(noiseUv.add(vec2(curlEps, 0.0))).sub(
				this.fbm2(noiseUv.sub(vec2(curlEps, 0.0)))
			);
			const hCy = this.fbm2(noiseUv.add(vec2(0.0, curlEps))).sub(
				this.fbm2(noiseUv.sub(vec2(0.0, curlEps)))
			);
			curl = vec2(hCy.negate(), hCx).mul(0.45);
		}

		const smearMag = smearAmp.mul(L1.mul(0.7).add(0.3));
		const tapCount = this.reducedQuality ? REDUCED_SMEAR_TAPS : SMEAR_TAPS;
		const denom = Math.max(1, tapCount - 1);
		const jitter = blueNoiseR.sub(0.5).div(denom);
		const fromAccum = vec3(0.0).toVar('fromAccum' + tag);
		const toAccum = vec3(0.0).toVar('toAccum' + tag);
		const fromWeights = float(0.0001).toVar('fromWeights' + tag);
		const toWeights = float(0.0001).toVar('toWeights' + tag);

		for (let i = 0; i < tapCount; i++) {
			const t = float(i / denom)
				.add(jitter)
				.max(0.0)
				.min(1.0);
			const w = float(1.0).sub(t);
			const tapBase = dir.mul(smearMag).mul(t);
			const dirOffset = curl.mul(t);
			const tapOffset = mix(
				vec2(tapBase, 0.0).add(dirOffset),
				vec2(0.0, tapBase).add(dirOffset),
				look.axisIndex
			);
			// Radial zoom-blur displacement: samples gathered progressively outward
			// along the (aspect-corrected, even) radial direction × tap parameter `t`
			// so the streak grows along the ray and emanates evenly from the origin.
			const radialTapOffset = radialVec.mul(radialGate).mul(RADIAL_BLUR_SCALE).mul(t);
			const tapUv = screenUv.add(tapOffset).add(radialTapOffset);
			// Pixelation-glitch on this tap's sample UV: mosaic-quantize to the square
			// block grid, then tear whole blocks horizontally with a time-stepped
			// per-block noise. The mosaic ramps in via mix(tapUv, …, pixelGate) — at
			// pixelGate 0 this is exactly tapUv, so procedural/endpoints are untouched.
			// reducedQuality keeps the cheap mosaic but drops the noise-driven tear
			// (and, via the null caVec below, the channel split).
			const blockId = floor(tapUv.mul(pixelGrid));
			const quantUv = blockId.add(0.5).div(pixelGrid);
			// floor(noiseTime·rate) re-steps the per-block seed in discrete time jumps
			// so the tear stutters digitally; blockId.y seeds it per row.
			const glitchSeed = vec2(blockId.y, floor(this.noiseTimeNode.mul(PIXEL_TIME_SCALE)));
			const glitchActive = this.reducedQuality
				? float(0.0)
				: smoothstep(float(0.6), float(0.85), this.valueNoise(glitchSeed));
			const tear = this.reducedQuality
				? float(0.0)
				: this.valueNoise(glitchSeed.add(vec2(11.3, 5.7)))
						.sub(0.5)
						.mul(2.0);
			const tearOffset = vec2(
				tear.mul(glitchActive).mul(look.pixelGlitchAmount).mul(PIXEL_DISPLACE_SCALE),
				0.0
			);
			const pixelUv = mix(tapUv, quantUv.add(tearOffset), pixelGate);
			// Per-tap mask + CA gates exist only to drive the chromatic split,
			// which the reduced path's single-tap caSplitTap ignores.
			let caVec = null;
			if (!this.reducedQuality) {
				const mAtTap = this.maskAtTap(tapUv, L1, sweepSign01, look);
				const caGates = this.smearTapCaGates(t, mAtTap, strokeEdge, envelope);
				// Radial CA: per-channel split along the direction away from the origin,
				// growing with distance, so the rays fringe rainbow toward the edges.
				// Shares `radialGate` with the zoom-blur so it ramps in/out together.
				const radialCaVec = radialVec.mul(radialGate).mul(RADIAL_CA_SCALE);
				// Pixel-glitch RGB split: horizontal channel offset confined to the
				// actively-tearing blocks (glitchActive) and ramped by pixelGate.
				const pixelCaVec = vec2(
					look.pixelGlitchAmount.mul(PIXEL_CA_SCALE).mul(pixelGate).mul(glitchActive),
					0.0
				);
				caVec = sweepAxis
					.mul(dir)
					.mul(look.caStrength)
					.mul(caGates.frontGate)
					.add(sweepPerp.mul(look.caStrength).mul(caGates.strokeGate))
					.add(radialCaVec)
					.add(pixelCaVec);
			}
			const fromTap = this.caSplitTap(this.fromSceneTextureNode, pixelUv, caVec);
			const toTap = this.caSplitTap(this.toSceneTextureNode, pixelUv, caVec);
			fromAccum.assign(fromAccum.add(fromTap.mul(w)));
			toAccum.assign(toAccum.add(toTap.mul(w)));
			fromWeights.assign(fromWeights.add(w));
			toWeights.assign(toWeights.add(w));
		}

		const fromDark = float(1.0).sub(envelope.mul(0.18));
		const fromColor = fromAccum.div(fromWeights).mul(fromDark);
		const toColor = toAccum.div(toWeights);
		return clamp(mix(fromColor, toColor, m), vec3(0.0), vec3(1.0));
	}

	// Liquid-glass refraction used by the PROCEDURAL (1→2) pair. Instead of
	// averaging many taps (which blurs), it builds a single smooth displacement
	// field and samples the from/to scenes ONCE per channel — so the geometry
	// stays sharp but bends/stretches as if seen through flowing glass:
	//   • `advect` slides the scene along the sweep direction, modulated by the
	//     ridged noise (L1) so different regions pull different distances and the
	//     geometry stretches into streaks rather than shifting rigidly;
	//   • `wobble` adds the gradient of the low-freq fbm (a refraction slope) for
	//     the liquid undulation;
	//   • per-channel `caVec` gives the prismatic dispersion along the bend.
	// Everything is scaled by the same front/progress `envelope`, so the warp is
	// confined to the dissolve front and vanishes at the endpoints. `smearStrength`
	// is the warp/stretch distance and `caStrength` the dispersion — both stay
	// live-tunable and zero out cleanly.
	glassDistort(screenUv, look, detailTerm) {
		const { noiseUv, L1, m } = this.buildDissolveMask(
			screenUv,
			look,
			this.progressNode,
			detailTerm
		);

		const envelope = this.bell(this.progressNode).mul(this.bell(m));

		const sweepAxis = this.sweepAxisVec(look.axisIndex);
		const sweepPerp = this.sweepPerpAxisVec(look.axisIndex);
		const dir = this.sweepDirectionNode;

		// Directional advection (varied by noise → streaks) along the sweep axis,
		// plus a softer lateral refraction wobble. Single displacement, no averaging.
		// The wobble's fbm gradient costs 8 noise evaluations per pixel; the
		// reduced path keeps only the advection — the streaking survives, the
		// liquid undulation goes.
		const advect = sweepAxis.mul(dir).mul(look.smearStrength).mul(L1.mul(0.7).add(0.3));
		let warp;
		if (this.reducedQuality) {
			warp = advect.mul(envelope);
		} else {
			// Smooth refraction slope: true gradient of the low-freq fbm field.
			const eps = float(0.02);
			const gx = this.fbm2(noiseUv.add(vec2(eps, 0.0))).sub(this.fbm2(noiseUv.sub(vec2(eps, 0.0))));
			const gy = this.fbm2(noiseUv.add(vec2(0.0, eps))).sub(this.fbm2(noiseUv.sub(vec2(0.0, eps))));
			const grad = vec2(gx, gy).div(eps.mul(2.0));
			const gradAlong = sweepAxis.mul(dot(grad, sweepAxis));
			const gradPerp = sweepPerp.mul(dot(grad, sweepPerp));
			const wobble = gradAlong.add(gradPerp.mul(0.5)).mul(look.smearStrength).mul(0.6);
			warp = advect.add(wobble).mul(envelope);
		}

		// Prismatic dispersion along the sweep axis, confined to the front.
		// Null on the reduced path — caSplitTap ignores it there.
		const caVec = this.reducedQuality
			? null
			: sweepAxis.mul(dir).mul(look.caStrength).mul(envelope);

		const warpedUv = screenUv.add(warp);
		const fromTap = this.caSplitTap(this.fromSceneTextureNode, warpedUv, caVec);
		const toTap = this.caSplitTap(this.toSceneTextureNode, warpedUv, caVec);

		const fromColor = fromTap.mul(float(1.0).sub(envelope.mul(0.18)));
		return clamp(mix(fromColor, toTap, m), vec3(0.0), vec3(1.0));
	}

	setup() {
		const outputColor = vec4(this.inputColorNode).toVar('outputColor');
		const screenUv = uv();

		// Resting endpoints come from the transition pair, not activeComposition.
		// Passthrough (active scene) diverges from the wipe destination when
		// scrolling backward — e.g. fillIn at progress=1 shows scene 1 (to)
		// while active is still scene 2, which caused a dark blink.
		const fromRest = this.sample2D(this.fromSceneTextureNode, screenUv).rgb;
		const toRest = this.sample2D(this.toSceneTextureNode, screenUv).rgb;

		const lowEdge = smoothstep(float(0.0), float(0.04), this.progressNode);
		const highEdge = float(1.0).sub(smoothstep(float(0.72), float(1.0), this.progressNode));
		const coreWeight = lowEdge.mul(highEdge);
		const highPull = float(1.0).sub(highEdge);

		If(coreWeight.greaterThan(0.0001), () => {
			const settled = vec3(0.0).toVar('settled');

			// The two pairs share the dissolve mask but use different distortions:
			// swarm (2→3) averages many taps → motion-blur smear; procedural (1→2)
			// displaces + samples once → sharp refractive "liquid glass". Each
			// branch reads its own look uniform set so they stay independently
			// tunable.
			If(this.pairSelectorNode.greaterThan(0.5), () => {
				// --- Swarm path (scene 2 → 3): directional smear ---
				const look = this.swarmLook;
				const L3 = this.getBlueNoiseSample().r;
				const detailTerm = L3.sub(0.5).mul(look.maskSoftness).mul(look.detailNoiseAmount);
				settled.assign(this.smearDistort(screenUv, look, detailTerm, L3, 'Swarm'));
			}).Else(() => {
				// --- Procedural path (scene 1 → 2): liquid-glass refraction ---
				const look = this.proceduralLook;
				const L3 = this.getBlueNoiseSample().r;
				const detailTerm = L3.sub(0.5).mul(look.maskSoftness).mul(look.detailNoiseAmount);
				settled.assign(this.glassDistort(screenUv, look, detailTerm));
			});

			const settled2 = settled.toVar('settled2');
			settled2.assign(mix(fromRest, settled, lowEdge));
			// perturbedAxis can exceed 1 + softness, so some pixels never reach
			// m=1 by progress=1; highPull forces those to the static `to` scene
			// for a clean endpoint. Both pairs share the dissolve, so both use it.
			settled2.assign(mix(settled2, toRest, highPull));
			outputColor.assign(vec4(settled2, 1.0));
		}).Else(() => {
			// Keep the inactive branch continuous with the high-progress endpoint
			// pull above. A separate 0.995→1.0 smoothstep can still contain a
			// visible slice of `fromRest` after `coreWeight` has already dropped
			// below the active-branch threshold, producing a one-frame blink.
			const restColor = mix(fromRest, toRest, highPull);
			outputColor.assign(vec4(restColor, 1.0));
		});

		return outputColor;
	}
}

export default TransitionNode;

export const transitionNode = (opts) =>
	nodeObject(
		new TransitionNode({
			...opts,
			inputColorNode: nodeObject(opts.inputColorNode)
		})
	);
