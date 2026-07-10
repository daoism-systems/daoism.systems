import * as THREE from 'three/webgpu';
import {
	vec3,
	vec2,
	float,
	mix,
	abs,
	select,
	uniform,
	pass,
	renderOutput,
	time,
	sin,
	texture,
	vec4,
	mrt,
	output,
	emissive,
	convertToTexture
} from 'three/tsl';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { chromaticAberration } from './CANode';
import { vignette } from './VignetteNode';
import { fluidDistortion } from './FluidDistortionNode';
import { fisheye } from './FisheyeNode';
import { rgbSplit } from './RGBSplitNode';
import { transitionNode } from './TransitionNode';
import { BlendMode, RenderPipeline, RenderTarget } from 'three/webgpu';
import { TextureCache } from '../materials/TextureCache';
import { SCENE_LAYERS, type SceneIndex } from '../sceneLayers';
import {
	type ChromaticPassEntry,
	type PostProcessingGraphHost,
	type SceneColorPass,
	type SceneComposition,
	type ScenePassEntry,
	type TransitionLookParams,
	type TransitionLookUniforms,
	type TransitionPairId,
	DEFAULT_CHROME_TINTS,
	DESKTOP_VIGNETTE_CENTER,
	DESKTOP_VIGNETTE_ROUNDNESS,
	DESKTOP_VIGNETTE_WIDTH,
	SCENE_CHANNELS,
	SCENE_LAYER_BY_CHANNEL
} from './types';
import { TRANSITION_LOOK_PROCEDURAL, TRANSITION_LOOK_SWARM } from './transitionLooks';

export class PostProcessingGraph {
	postProcessing!: RenderPipeline;
	feedbackPipeline: RenderPipeline | null = null;
	feedbackDecay: any = null;

	private postFogBloomNode: any | null = null;
	private postFogEmissiveBoostNode: any | null = null;
	private emissivePostFogIntensity: any = null;
	private sceneBloomPasses: Partial<Record<SceneIndex, any>> = {};
	private sceneEmissiveNodes: Partial<Record<SceneIndex, any>> = {};

	vignetteIntensity: any;
	vignetteWidth: any;
	vignetteRoundness: any;
	vignetteCenter: any;
	vignetteColor: any;

	fluidActive: any;
	fluidDistortionStrength: any;
	fluidDebug: any;
	fluidColorTint: any;
	fluidColorAmount: any;

	fisheyeStrength: any;
	fisheyeBarrel: any;
	fisheyeAberration: any;
	aspectRatio: any;

	// Full-frame RGB channel-split ("glitch CA"). strength is timeline-driven
	// (Theatre `rgbSplitStrength`), ~0 outside the pyramid window; offset/radial
	// are look constants tunable live in the inspector. See RGBSplitNode.
	rgbSplitStrength: any;
	rgbSplitOffset: any;
	rgbSplitRadial: any;
	// Green channel displacement for the split, as a fraction of the red/blue
	// offset (0 = green stationary, the reference look; ~0.35 = radial-CA-like).
	// Gives greenTint a fringe to color — see RGBSplitNode. Desktop-only knob.
	rgbSplitGreenOffset: any;

	// Shared CA "breathing" pulse. A single time-based oscillation applied to
	// EVERY chromatic pass — added to the radial CANode scale and used as a
	// ±fraction on the RGBSplit offset — so the octagon's vibrant breathing also
	// rides the white-bg pyramid split. `caBreathAmount` is the amplitude (0 =
	// frozen CA), `caBreathSpeed` the frequency; both default to the values the
	// radial CA previously hard-coded. `caBreath` is the built signed oscillator.
	caBreathAmount: any;
	caBreathSpeed: any;
	private caBreath: any = null;

	// Shared screen-space CA exclusion zone (UV center / radius / feather). One
	// set of knobs consumed by BOTH the radial CANode pass and the full-frame
	// RGBSplitNode so the same un-aberrated disc is carved out of every CA
	// implementation. See caExclusion.js.
	caExclusionCenter: any;
	caExclusionRadius: any;
	caExclusionFeather: any;

	// Shared per-channel CA tints (vec3 each). Like the exclusion zone above,
	// allocated in setupUniforms so BOTH the radial CANode pass and the
	// full-frame RGBSplitNode read the SAME Theatre-driven `chromaticRedTint/
	// GreenTint/BlueTint` — so recoloring a channel affects every CA path. With
	// the default basis tints (1,0,0)/(0,1,0)/(0,0,1) each pass reproduces its
	// prior look exactly (RGBSplit's split reduces to the untinted R/G/B pack).
	chromeRedTint: any;
	chromeGreenTint: any;
	chromeBlueTint: any;

	cloudTransitionProgress: any;
	cloudTransitionSweepDirection: any;
	// Branch selector: 0 = procedural (1→2), 1 = swarm (2→3). Drives the
	// If() in TransitionNode.setup() that picks which uniform set to read.
	transitionPairSelector: any;
	proceduralLook!: TransitionLookUniforms;
	swarmLook!: TransitionLookUniforms;
	transitionMaskTexture: THREE.Texture | null = null;
	// TSL nodes wrapping transitionMaskTexture; the loaded KTX2 swaps in via
	// `.value` (a CompressedTexture can't be image-swapped into the placeholder).
	// Mobile can build a second transition node for the unified emissive bloom
	// source, so every wrapper must be updated when the texture loads.
	private transitionMaskTextureNodes: any[] = [];

	private slidesOverlayPassNode: any | null = null;

	private activeChannelWeights!: Record<SceneIndex, any>;
	private fromChannelWeights!: Record<SceneIndex, any>;
	private toChannelWeights!: Record<SceneIndex, any>;
	// Per-channel bloom gates (1 = bloom on). During a transition only the
	// dominant end of the pair keeps its bloom — see updateTransitionChannelGates.
	// A uniform (not just a JS render skip) so the stale bloom texture is also
	// zeroed out of the composition while gated.
	private bloomChannelGates!: Record<SceneIndex, any>;
	// The in-flight transition pair as passed to setActiveScenes; null outside
	// transitions. Drives bloom dominance gating and the optional channel freeze.
	private transitionFromChannel: SceneIndex | null = null;
	private transitionToChannel: SceneIndex | null = null;
	// Freeze bookkeeping (postProcessing.freezeTransitionScenes): a channel may
	// only freeze after it has rendered fresh within the current pair activation,
	// so the dissolve never reveals stale/never-rendered content.
	private pairActivationId = 0;
	private readonly lastPairRenderId: Record<SceneIndex, number> = { 1: 0, 2: 0, 3: 0 };
	private scenePasses: ScenePassEntry[] = [];
	private sceneColorPasses: Partial<Record<SceneIndex, SceneColorPass>> = {};
	private chromaticPassEntry: ChromaticPassEntry | null = null;
	postProcessingPanel: any = null;

	constructor(private readonly host: PostProcessingGraphHost) {}

	build(feedbackReadRT: RenderTarget): any | null {
		const renderer = this.host.webGPURenderer;
		this.postProcessing = new RenderPipeline(renderer);
		this.scenePasses = [];
		this.sceneColorPasses = {};
		this.chromaticPassEntry = null;
		this.transitionMaskTextureNodes = [];

		const composedByChannel: Record<SceneIndex, any> = {} as Record<SceneIndex, any>;
		let primaryBloomPass: any | null = null;
		this.sceneBloomPasses = {};
		this.sceneEmissiveNodes = {};

		// Allocated before composeSceneChannel so gateBloomToActiveChannel and the
		// bloom fold below can reference them.
		this.bloomChannelGates = {
			1: uniform(float(1)),
			2: uniform(float(1)),
			3: uniform(float(1))
		};

		for (const channel of SCENE_CHANNELS) {
			const composition = this.composeSceneChannel(channel);
			composedByChannel[channel] = composition.composed;
			if (composition.bloomPass) this.sceneBloomPasses[channel] = composition.bloomPass;
			if (composition.emissiveNode) this.sceneEmissiveNodes[channel] = composition.emissiveNode;
			if (channel === 1) primaryBloomPass = composition.bloomPass;
		}

		// setupUniforms first: it allocates `aspectRatio` and the shared CA
		// exclusion uniforms that addChromaticAberration now reads (and that
		// addRgbSplit reads later via rebuildOutputNode).
		this.setupUniforms();
		this.addChromaticAberration(composedByChannel);

		// emissivePostFogIntensity must exist before we fold per-channel
		// emissive contributions into composedByChannel below.
		const postFogEmissive =
			typeof this.host.params.emissivePostFogIntensity?.value === 'number'
				? this.host.params.emissivePostFogIntensity.value
				: 0.5;
		this.emissivePostFogIntensity = uniform(float(postFogEmissive));
		this.host.params.emissivePostFogIntensity = this.emissivePostFogIntensity;

		// Fold bloom + emissive boost into each channel's composition so the
		// transition node displaces them with color and fog. Otherwise scene 3's
		// bloom/emissive sail through unchanged and you see a static scene 3
		// underlay behind the swarm-displaced color.
		for (const channel of SCENE_CHANNELS) {
			const bloomNode = this.sceneBloomPasses[channel];
			const emissiveNode = this.sceneEmissiveNodes[channel];
			if (bloomNode) {
				// select, not mul: while a channel's bloom is gated off its texture
				// goes stale, and a stale HalfFloat texel can hold Inf (emissive
				// overflow) — Inf * 0 = NaN would poison the whole channel. Same
				// guard rationale as weightedChannel below.
				const gatedBloom = select(
					this.bloomChannelGates[channel].greaterThan(0.5),
					vec4(bloomNode),
					vec4(0.0)
				);
				composedByChannel[channel] = composedByChannel[channel].add(gatedBloom);
			}
			if (emissiveNode) {
				composedByChannel[channel] = composedByChannel[channel].add(
					emissiveNode.mul(this.emissivePostFogIntensity)
				);
			}
		}

		this.activeChannelWeights = {
			1: uniform(float(1)),
			2: uniform(float(0)),
			3: uniform(float(0))
		};
		this.fromChannelWeights = {
			1: uniform(float(1)),
			2: uniform(float(0)),
			3: uniform(float(0))
		};
		this.toChannelWeights = {
			1: uniform(float(1)),
			2: uniform(float(0)),
			3: uniform(float(0))
		};

		// convertToTexture builds an RTTNode that renders a full-frame pass every
		// frame regardless of the downstream channel weight. Gate inactive
		// channels' RTTs to needed channels only (mirrors gateBloomToActiveChannel)
		// — the gated channel's stale texture is multiplied to 0 in weightedSum and
		// zeroed by the select guard below, so this is visually identical. Weights
		// are assigned above so isChannelNeeded reads live values at render time.
		const compositionTexture: Record<SceneIndex, any> = {} as Record<SceneIndex, any>;
		for (const channel of SCENE_CHANNELS) {
			const rtt = convertToTexture(composedByChannel[channel]);
			this.gateRttToActiveChannel(rtt, channel);
			compositionTexture[channel] = rtt;
		}

		// Guard against `0 * NaN/Inf = NaN`. The channel weights are binary
		// (exactly one is 1 per active/from/to set), so a non-active scene is
		// multiplied by 0 — but if that scene's composition is transiently
		// non-finite (e.g. scene 3 mid 2→3 transition), `0 * NaN` poisons the
		// whole weighted sum and blacks the canvas. `select` drops an inactive
		// channel to a hard 0 first, so only the active channel's value flows
		// through. Confirmed via FeedbackProbe: swarm 2→3, full-frame NaN.
		const weightedChannel = (comp: any, weight: any) =>
			select(weight.greaterThan(0.0), vec4(comp), vec4(0.0)).mul(weight);
		const weightedSum = (weights: Record<SceneIndex, any>) =>
			weightedChannel(compositionTexture[1], weights[1])
				.add(weightedChannel(compositionTexture[2], weights[2]))
				.add(weightedChannel(compositionTexture[3], weights[3]));

		const activeComposition = weightedSum(this.activeChannelWeights);
		const fromComposition = weightedSum(this.fromChannelWeights);
		const toComposition = weightedSum(this.toChannelWeights);

		let transitionOutput = this.addTransitionNode(
			activeComposition,
			fromComposition,
			toComposition
		);

		if (this.shouldUseMobileUnifiedBloom()) {
			const emissiveByChannel = {
				1: this.sceneEmissiveNodes[1] ?? vec4(0.0),
				2: this.sceneEmissiveNodes[2] ?? vec4(0.0),
				3: this.sceneEmissiveNodes[3] ?? vec4(0.0)
			} as Record<SceneIndex, any>;
			const weightedEmissiveSum = (weights: Record<SceneIndex, any>) =>
				weightedChannel(emissiveByChannel[1], weights[1])
					.add(weightedChannel(emissiveByChannel[2], weights[2]))
					.add(weightedChannel(emissiveByChannel[3], weights[3]));

			const transitionedEmissive = this.addTransitionNode(
				weightedEmissiveSum(this.activeChannelWeights),
				weightedEmissiveSum(this.fromChannelWeights),
				weightedEmissiveSum(this.toChannelWeights)
			);
			primaryBloomPass = this.createUnifiedMobileBloomPass(transitionedEmissive);
			if (primaryBloomPass) {
				transitionOutput = transitionOutput.add(vec4(primaryBloomPass));
			}
		}

		this.host.feedbackPrevTexture = texture(feedbackReadRT.texture);
		const feedbackBlended = mix(
			transitionOutput,
			this.host.feedbackPrevTexture,
			this.feedbackDecay
		);

		this.feedbackPipeline = new RenderPipeline(renderer);
		// The feedback ping-pong RT is the persistent buffer the whole frame
		// flows through (renderAsync only swaps it; it's cleared exclusively on
		// init/resize/gpu-recreate). A single non-finite pixel latches forever:
		// `mix(x, NaN, t)` and `mix(x, Inf, 0)` both resolve to NaN (Inf·0 = NaN,
		// NaN·t = NaN), so it survives every subsequent frame regardless of
		// feedbackDecay until the RT is reallocated — which is why a window
		// resize was the only known recovery. Sanitize the written value so the
		// buffer can only ever store finite, in-range values; a transient bad
		// frame holds the previous (already-sanitized) value instead.
		this.feedbackPipeline.outputNode = this.sanitizeFeedbackOutput(
			feedbackBlended,
			this.host.feedbackPrevTexture
		);
		this.feedbackPipeline.outputColorTransform = false;

		this.buildPostFogContributions();
		this.rebuildOutputNode();

		this.host.params.bloomPass = primaryBloomPass;
		// bloom() wraps strength/radius/threshold into per-instance uniforms. Desktop
		// exposes all per-channel passes; mobile exposes the single unified pass.
		this.host.params.bloomPasses =
			this.shouldUseMobileUnifiedBloom() && primaryBloomPass
				? [primaryBloomPass]
				: Object.values(this.sceneBloomPasses);
		return primaryBloomPass;
	}

	rebuildOutputNode(): void {
		if (!this.postProcessing || !this.host.feedbackPrevTexture) return;

		let finalNode: any = this.host.feedbackPrevTexture;
		if (this.postFogBloomNode) {
			finalNode = finalNode.add(this.postFogBloomNode);
		}
		if (this.postFogEmissiveBoostNode) {
			finalNode = finalNode.add(this.postFogEmissiveBoostNode);
		}

		finalNode = this.addCommonPostStack(finalNode);

		const overlayCompositor = this.host.getOverlayCompositor();
		if (overlayCompositor) {
			finalNode = overlayCompositor(finalNode);
		}
		// Slides overlay composites on top of everything else (including DaoFog)
		// via straight-alpha `over`: where slides.a==0 (cleared pixels) the
		// background passes through unchanged; where slides.a==1 (rasterized
		// slide pixels) the slide color replaces it.
		if (this.slidesOverlayPassNode) {
			finalNode = mix(finalNode, this.slidesOverlayPassNode, this.slidesOverlayPassNode.a);
		}

		// FXAA requires tone-mapped, sRGB-encoded input — its luma thresholds
		// (contrast 0.0312 / relative 0.063) are calibrated for gamma LDR, so on
		// the linear-HDR frame it barely fires and edges stay aliased (see
		// FXAANode docstring; desktop has no MSAA, so this is the only AA). Apply
		// the renderer's tone-map + color-space transform here — after the full
		// linear composite (scene/bloom/CA/transition/fluid/fisheye/vignette/fog/
		// slides), so every contributor's color is preserved exactly — then run
		// FXAA on the encoded image and suppress the pipeline's own final
		// transform so the encode isn't applied twice.
		finalNode = renderOutput(finalNode);
		finalNode = this.addFxaa(finalNode);
		this.postProcessing.outputColorTransform = false;

		this.postProcessing.outputNode = finalNode;
		this.postProcessing.needsUpdate = true;
	}

	/**
	 * Register a dedicated scene + layer to be rendered as a TSL pass and
	 * composited on top of the DaoFog overlay. Idempotent — calling again
	 * replaces the previous pass. Pass `null` to remove.
	 *
	 * The pass clears with alpha=0 so non-slide pixels are transparent and
	 * the underlying fog/scene shows through. This requires temporarily
	 * setting the renderer's clearAlpha during the pass render — same
	 * `updateBefore` override pattern the channel-1 scene-invert uses.
	 */
	setSlidesOverlay(overlayScene: THREE.Scene | null, layer: number): void {
		this.slidesOverlayPassNode = null;
		if (overlayScene && this.postProcessing) {
			const overlayPass = pass(overlayScene, this.host.camera, { depthBuffer: false });
			overlayPass.setLayers(this.createLayerMask(layer));

			const original = overlayPass.updateBefore.bind(overlayPass);
			overlayPass.updateBefore = (frame: any): boolean | undefined => {
				const renderer = frame.renderer;
				const prevAlpha = renderer.getClearAlpha();
				renderer.setClearAlpha(0);
				const result = original(frame);
				renderer.setClearAlpha(prevAlpha);
				return result;
			};

			const overlayTexture = overlayPass.getTextureNode();
			overlayTexture.toInspector?.('Slides Overlay');
			this.slidesOverlayPassNode = overlayTexture;
		}
		this.rebuildOutputNode();
	}

	setActiveScenes(active: SceneIndex, from: SceneIndex | null, to: SceneIndex | null): void {
		// Transition disabled: the output follows activeComposition only (a hard
		// cut at the window start — see addTransitionNode), so suppress the pair.
		// The non-visible end then never renders (isChannelNeeded) and the bloom
		// dominance gating never zeroes the visible channel's bloom.
		if (!this.host.graphicsOptions.postProcessing.cloudTransition) {
			from = null;
			to = null;
		}
		const fromChannel = from ?? active;
		const toChannel = to ?? active;

		const pairActive = from !== null && to !== null && from !== to;
		if (pairActive && this.transitionFromChannel === null) this.pairActivationId += 1;
		this.transitionFromChannel = pairActive ? from : null;
		this.transitionToChannel = pairActive ? to : null;
		this.updateTransitionChannelGates();

		for (const channel of SCENE_CHANNELS) {
			this.activeChannelWeights[channel].value = channel === active ? 1 : 0;
			this.fromChannelWeights[channel].value = channel === fromChannel ? 1 : 0;
			this.toChannelWeights[channel].value = channel === toChannel ? 1 : 0;
		}

		const needed = new Set<SceneIndex>([active]);
		if (from !== null) needed.add(from);
		if (to !== null) needed.add(to);

		for (let i = 0; i < this.scenePasses.length; i++) {
			const channel = (i + 1) as SceneIndex;
			const entry = this.scenePasses[i];
			entry.pass.setLayers(needed.has(channel) ? entry.cachedLayers : entry.emptyLayers);
		}

		if (this.chromaticPassEntry) {
			const wantS1 = needed.has(1);
			const wantS3 = needed.has(3);
			const mask =
				wantS1 && wantS3
					? this.chromaticPassEntry.masks.both
					: wantS1
						? this.chromaticPassEntry.masks.s1Only
						: wantS3
							? this.chromaticPassEntry.masks.s3Only
							: this.chromaticPassEntry.masks.none;
			this.chromaticPassEntry.pass.setLayers(mask);
		}
	}

	/** True while a scene-pair dissolve (1→2 or 2→3) is in flight. */
	isTransitionActive(): boolean {
		return this.transitionFromChannel !== null;
	}

	setTransitionLook(pair: TransitionPairId, params: TransitionLookParams): void {
		const look = this.lookFor(pair);
		if (!look) return;
		look.smearStrength.value = params.smearStrength;
		look.caStrength.value = params.caStrength;
		look.maskSoftness.value = params.maskSoftness;
		look.axisIndex.value = params.axisIndex;
		look.noiseScaleX.value = params.noiseScaleX;
		look.noiseScaleY.value = params.noiseScaleY;
		look.noiseScrollSpeed.value = params.noiseScrollSpeed;
		look.maskNoiseStrength.value = params.maskNoiseStrength;
		look.detailNoiseAmount.value = params.detailNoiseAmount;
		look.radialStrength.value = params.radialStrength;
		look.radialOriginX.value = params.radialOriginX;
		look.radialOriginY.value = params.radialOriginY;
		look.radialRadius.value = params.radialRadius;
		look.radialSpreadX.value = params.radialSpreadX;
		look.pixelStrength.value = params.pixelStrength;
		look.pixelBlockSize.value = params.pixelBlockSize;
		look.pixelGlitchAmount.value = params.pixelGlitchAmount;
	}

	setActiveTransitionPair(pair: TransitionPairId): void {
		if (!this.transitionPairSelector) return;
		this.transitionPairSelector.value = pair === 'swarm' ? 1 : 0;
	}

	private lookFor(pair: TransitionPairId): TransitionLookUniforms | null {
		if (pair === 'swarm') return this.swarmLook ?? null;
		return this.proceduralLook ?? null;
	}

	private createLookUniforms(seed: TransitionLookParams): TransitionLookUniforms {
		return {
			smearStrength: uniform(float(seed.smearStrength)),
			caStrength: uniform(float(seed.caStrength)),
			maskSoftness: uniform(float(seed.maskSoftness)),
			axisIndex: uniform(float(seed.axisIndex)),
			noiseScaleX: uniform(float(seed.noiseScaleX)),
			noiseScaleY: uniform(float(seed.noiseScaleY)),
			noiseScrollSpeed: uniform(float(seed.noiseScrollSpeed)),
			maskNoiseStrength: uniform(float(seed.maskNoiseStrength)),
			detailNoiseAmount: uniform(float(seed.detailNoiseAmount)),
			radialStrength: uniform(float(seed.radialStrength)),
			radialOriginX: uniform(float(seed.radialOriginX)),
			radialOriginY: uniform(float(seed.radialOriginY)),
			radialRadius: uniform(float(seed.radialRadius)),
			radialSpreadX: uniform(float(seed.radialSpreadX)),
			pixelStrength: uniform(float(seed.pixelStrength)),
			pixelBlockSize: uniform(float(seed.pixelBlockSize)),
			pixelGlitchAmount: uniform(float(seed.pixelGlitchAmount))
		};
	}

	getRefs(): Record<string, any> {
		return {
			params: this.host.params,
			vignetteIntensity: this.vignetteIntensity,
			vignetteWidth: this.vignetteWidth,
			vignetteRoundness: this.vignetteRoundness,
			vignetteCenter: this.vignetteCenter,
			vignetteColor: this.vignetteColor,
			fluidActive: this.fluidActive,
			fluidDistortionStrength: this.fluidDistortionStrength,
			fluidDebug: this.fluidDebug,
			fluidColorTint: this.fluidColorTint,
			fluidColorAmount: this.fluidColorAmount,
			fisheyeStrength: this.fisheyeStrength,
			fisheyeBarrel: this.fisheyeBarrel,
			fisheyeAberration: this.fisheyeAberration,
			rgbSplitStrength: this.rgbSplitStrength,
			rgbSplitOffset: this.rgbSplitOffset,
			rgbSplitRadial: this.rgbSplitRadial,
			rgbSplitGreenOffset: this.rgbSplitGreenOffset,
			caBreathAmount: this.caBreathAmount,
			caBreathSpeed: this.caBreathSpeed,
			caExclusionFeather: this.caExclusionFeather,
			cloudTransitionProgress: this.cloudTransitionProgress,
			cloudTransitionSweepDirection: this.cloudTransitionSweepDirection,
			transitionPairSelector: this.transitionPairSelector,
			proceduralLook: this.proceduralLook,
			swarmLook: this.swarmLook,
			transitionMaskTexture: this.transitionMaskTexture,
			feedbackDecay: this.feedbackDecay,
			postProcessingFlags: this.host.graphicsOptions.postProcessing,
			denoise: this.host.graphicsOptions.denoise,
			postProcessing: this.postProcessing
		};
	}

	dispose(): void {
		this.feedbackPipeline?.dispose();
	}

	/**
	 * Guard the value written to the persistent feedback ping-pong RT so it can
	 * never store NaN/Inf (which latch forever — see build()). A pixel passes
	 * through only if every component is finite and within half-float range;
	 * otherwise it falls back to `fallback` (the previous frame's sample, which
	 * is itself always sanitized). Comparison-based, not clamp-based: clamping
	 * Inf yields ~60000, which ACES tone-maps to a one-frame white flash —
	 * holding the previous value keeps a transient bad frame invisible.
	 * `abs(x).lessThan(MAX)` is false for NaN and Inf (any NaN/Inf comparison is
	 * false), so both route to the fallback per-component.
	 */
	private sanitizeFeedbackOutput(node: any, fallback: any): any {
		const FEEDBACK_MAX = 60000; // just below half-float Inf (~65504)
		const value = vec4(node);
		const isFinite = abs(value).lessThan(vec4(FEEDBACK_MAX));
		return select(isFinite, value, vec4(fallback));
	}

	private buildPostFogContributions(): void {
		// Bloom/emissive contributions are already added before the feedback write
		// (desktop per-channel, mobile unified bloom), so the final stage adds nothing.
		// The null guards in rebuildOutputNode() short-circuit cleanly.
		this.postFogBloomNode = null;
		this.postFogEmissiveBoostNode = null;
	}

	private composeSceneChannel(channel: SceneIndex): SceneComposition {
		const colorPass = this.createSceneColorPass(channel);
		this.sceneColorPasses[channel] = colorPass;
		const { colorNode, emissiveNode } = colorPass;
		const composed: any = colorNode;

		const bloomPass =
			this.host.graphicsOptions.postProcessing.bloom && !this.host.isMobile
				? this.createBloomPass(emissiveNode, channel)
				: null;

		return { composed, bloomPass, emissiveNode };
	}

	private createSceneColorPass(channel: SceneIndex): SceneColorPass {
		const cachedLayers = this.createLayerMask(SCENE_LAYER_BY_CHANNEL[channel]);
		const emptyLayers = this.createLayerMask();
		const scenePass = pass(this.host.scene, this.host.camera);

		scenePass.setLayers(cachedLayers);
		this.scenePasses.push({ pass: scenePass, cachedLayers, emptyLayers });

		if (channel === 1) {
			const original = scenePass.updateBefore.bind(scenePass);
			scenePass.updateBefore = (frame: any): boolean | undefined => {
				const amount = this.host.sceneInvertAmount;
				const invert = amount > 0 && this.host.sceneInvertCallback != null;
				if (invert) this.host.sceneInvertCallback!(amount);
				const result = original(frame);
				if (invert) this.host.sceneInvertCallback!(0);
				return result;
			};
		}

		// if (channel === 2) {
		// 	// DEBUG: swap scene.background to red just for the channel 2 pass so
		// 	// scene 2 is visually unmistakable during 2→3 transition validation.
		// 	// Mirrors the channel-1 invert pattern above. Remove once confirmed.
		// 	const debugBg = new THREE.Color('#ff0000');
		// 	const original = scenePass.updateBefore.bind(scenePass);
		// 	scenePass.updateBefore = (frame: any): boolean | undefined => {
		// 		const previous = this.host.scene.background;
		// 		this.host.scene.background = debugBg;
		// 		const result = original(frame);
		// 		this.host.scene.background = previous;
		// 		return result;
		// 	};
		// }

		if (channel === 3) {
			const debugBg = new THREE.Color('#222226');
			const original = scenePass.updateBefore.bind(scenePass);
			scenePass.updateBefore = (frame: any): boolean | undefined => {
				const previous = this.host.scene.background;
				this.host.scene.background = debugBg;
				const result = original(frame);
				this.host.scene.background = previous;
				return result;
			};
		}

		const emissiveNode = this.host.graphicsOptions.postProcessing.bloom
			? this.addEmissiveMrt(scenePass, channel)
			: null;

		// Skip the scene-color render entirely for channels that are neither
		// active nor part of an in-flight transition. setActiveScenes already
		// switches them to empty layers (renders nothing but still binds + clears
		// the RT and emissive MRT); this gate short-circuits the whole pass.
		// Applied last so it wraps the channel-1 invert / channel-3 background
		// updateBefore overrides above. The stale color is multiplied to 0 + select
		// guard downstream, and isChannelNeeded flips true (in setActiveScenes)
		// before renderAsync on the frame a channel becomes needed, so it renders
		// fresh that same frame — visually identical.
		const gatedSceneUpdate = scenePass.updateBefore.bind(scenePass);
		scenePass.updateBefore = (frame: any): boolean | undefined => {
			if (!this.isChannelNeeded(channel) || this.isChannelFrozen(channel)) return;
			if (this.transitionFromChannel !== null) {
				this.lastPairRenderId[channel] = this.pairActivationId;
			}
			return gatedSceneUpdate(frame);
		};

		const colorNode = scenePass.getTextureNode();
		colorNode.toInspector?.(`Scene ${channel} Color`);

		return { scenePass, colorNode, emissiveNode };
	}

	private addEmissiveMrt(scenePass: any, channel: SceneIndex): any {
		const mrtNode = mrt({
			output: output,
			emissive: vec4(emissive, output.a)
		});
		mrtNode.setBlendMode('emissive', new BlendMode(THREE.NormalBlending));
		scenePass.setMRT(mrtNode);

		const emissiveTexture = scenePass.getTexture('emissive');
		emissiveTexture.type = THREE.HalfFloatType;
		const emissiveNode = scenePass.getTextureNode('emissive');
		emissiveNode.toInspector?.(`Emissive ${channel}`);
		return emissiveNode;
	}

	private createBloomPass(emissiveNode: any | null, channel: SceneIndex): any | null {
		if (!emissiveNode) return null;
		const bloomSource = emissiveNode.mul(this.host.params.emissiveBloomIntensity ?? uniform(1));
		bloomSource.toInspector?.(`Emissive Bloom Source ${channel}`);

		const bloomPass = bloom(
			bloomSource,
			this.host.params.bloomStrength,
			this.host.params.bloomRadius,
			this.host.params.bloomThreshold
		);
		bloomPass.toInspector?.(`Bloom ${channel}`);
		this.gateBloomToActiveChannel(bloomPass, channel);
		return bloomPass;
	}

	private shouldUseMobileUnifiedBloom(): boolean {
		return this.host.isMobile && this.host.graphicsOptions.postProcessing.bloom;
	}

	private createUnifiedMobileBloomPass(emissiveNode: any | null): any | null {
		if (!emissiveNode) return null;
		const bloomSource = emissiveNode.mul(this.host.params.emissiveBloomIntensity ?? uniform(1));
		bloomSource.toInspector?.('Mobile Unified Emissive Bloom Source');

		const bloomPass = bloom(
			bloomSource,
			this.host.params.bloomStrength,
			this.host.params.bloomRadius,
			this.host.params.bloomThreshold
		);
		bloomPass.toInspector?.('Mobile Unified Bloom');
		return bloomPass;
	}

	/**
	 * Skip a channel's bloom mip-chain render on frames where the channel is
	 * neither active nor part of an in-flight transition. BloomNode renders ~12
	 * fullscreen passes once per frame (NodeUpdateType.FRAME) regardless of how
	 * it's used downstream, so without this guard all three channels' bloom run
	 * every frame even when two are invisible — and the channel weights only
	 * zero out the *composite sample*, not the upstream RTT work. The gated
	 * channel's stale bloom texture is multiplied to 0 in weightedSum, so this
	 * is visually identical. Mirrors the scenePass.updateBefore overrides.
	 *
	 * Also skips while the channel's bloom gate is 0 — during a transition both
	 * ends of the pair are "needed", but only the dominant one keeps its bloom
	 * (see updateTransitionChannelGates), so at most one mip-chain renders per
	 * frame. The gated channel's stale bloom is zeroed in the composition by the
	 * select() in build().
	 */
	private gateBloomToActiveChannel(bloomPass: any, channel: SceneIndex): void {
		const original = bloomPass.updateBefore.bind(bloomPass);
		bloomPass.updateBefore = (frame: any): boolean | undefined => {
			if (!this.isChannelNeeded(channel) || this.bloomChannelGates[channel].value === 0) return;
			return original(frame);
		};
	}

	/**
	 * Skip a channel's composition RTT render on frames where the channel is
	 * neither active nor part of an in-flight transition. `convertToTexture`
	 * produces an RTTNode that renders a full-frame pass every frame (its
	 * updateBeforeType is NodeUpdateType.RENDER) regardless of how the downstream
	 * weight zeroes it; the gated channel's stale texture is multiplied to 0 in
	 * weightedSum, so this is visually identical. Mirrors gateBloomToActiveChannel.
	 */
	private gateRttToActiveChannel(rtt: any, channel: SceneIndex): void {
		const original = rtt.updateBefore.bind(rtt);
		rtt.updateBefore = (frame: any): boolean | undefined => {
			if (!this.isChannelNeeded(channel) || this.isChannelFrozen(channel)) return;
			return original(frame);
		};
	}

	/**
	 * A channel is needed this frame if it's the active scene or either end of
	 * an in-flight transition. Reads the live weight uniforms (set by
	 * setActiveScenes) so it can never drift from the composite's own gating.
	 */
	private isChannelNeeded(channel: SceneIndex): boolean {
		return (
			this.activeChannelWeights[channel].value > 0 ||
			this.fromChannelWeights[channel].value > 0 ||
			this.toChannelWeights[channel].value > 0
		);
	}

	/**
	 * A transition renders BOTH ends of its pair every frame — the costliest
	 * stretch of the timeline (two scene passes + two bloom mip-chains). The
	 * dissolve shows pure `from` near progress 0 and pure `to` near 1
	 * (TransitionNode's lowEdge/highPull), so the non-dominant end's bloom is
	 * gated off: at most one bloom chain renders per frame. The flip at
	 * progress 0.5 lands at peak distortion + feedback persistence, which masks
	 * it. Direction-safe: AnimationController swaps from/to and inverts progress
	 * for backward scroll, so progress 0 always means "from dominant".
	 *
	 * Called from setActiveScenes (pair changes) and from the renderer's
	 * setCloudTransitionFillProgress (dominance follows the live progress).
	 */
	updateTransitionChannelGates(): void {
		if (!this.bloomChannelGates) return;
		for (const channel of SCENE_CHANNELS) {
			this.bloomChannelGates[channel].value = 1;
		}
		const from = this.transitionFromChannel;
		const to = this.transitionToChannel;
		if (from === null || to === null) return;
		const progress = this.cloudTransitionProgress?.value ?? 0;
		this.bloomChannelGates[progress >= 0.5 ? from : to].value = 0;
	}

	/**
	 * Optional (postProcessing.freezeTransitionScenes): while a pair is active,
	 * skip re-rendering the non-dominant scene channel entirely (scene pass,
	 * composition RTT — bloom is already off via its gate) and let the dissolve
	 * sample its last fresh frame. After the first in-band frame, exactly one
	 * scene channel renders per frame. A channel only freezes once it has
	 * rendered within the current pair activation (lastPairRenderId), so the
	 * first in-band frame renders both ends and stale/never-rendered content is
	 * never revealed. Off by default — the camera keeps moving mid-transition,
	 * so the frozen side is parallax-misaligned under the dissolve.
	 */
	private isChannelFrozen(channel: SceneIndex): boolean {
		if (!this.host.graphicsOptions.postProcessing.freezeTransitionScenes) return false;
		const from = this.transitionFromChannel;
		const to = this.transitionToChannel;
		if (from === null || to === null) return false;
		const progress = this.cloudTransitionProgress?.value ?? 0;
		const nonDominant = progress >= 0.5 ? from : to;
		return channel === nonDominant && this.lastPairRenderId[channel] === this.pairActivationId;
	}

	private addChromaticAberration(composedByChannel: Record<SceneIndex, any>): void {
		const opts = this.host.graphicsOptions;
		if (!opts.postProcessing.chromaticAberration) return;

		// Mobile: drop the radial CA entirely. Its pass is a full extra scene
		// re-render of the chromatic-layer objects (the costliest piece of the CA
		// stack) whose only output is a soft additive fringe. The cheap full-frame
		// RGBSplit keeps running: the shared exclusion/tint/breathing uniforms it
		// reads are allocated in setupUniforms (already run above), NOT here, so
		// skipping this pass leaves the RGB split byte-for-byte unchanged. The
		// chromatic-layer markers on meshes stay enabled but inert — no pass filters
		// them. The CA-only Theatre knobs are hidden on mobile (MOBILE_HIDDEN_PROPS).
		if (this.host.isMobile) return;

		const chromaticLayerPass = pass(this.host.scene, this.host.camera, { depthBuffer: true });
		// This pass is a full scene re-render of the chromatic-layer objects — the
		// costliest piece of the CA stack. Its output only ever reaches the frame
		// as the soft additive fringe (the CA node emits only the positive
		// dispersion fringe, no base term), which survives upsampling — so mobile
		// renders it at half resolution: ~1/4 the fill/clear cost while the
		// timeline's animated strength/scale pulse keeps working.
		if (this.host.isMobile) {
			chromaticLayerPass.setResolutionScale(0.5);
		}
		const chromaticMasks = {
			none: this.createLayerMask(),
			s1Only: this.createLayerMask(SCENE_LAYERS.CHROMATIC_1),
			s3Only: this.createLayerMask(SCENE_LAYERS.CHROMATIC_3),
			both: this.createLayerMask(SCENE_LAYERS.CHROMATIC_1, SCENE_LAYERS.CHROMATIC_3)
		};

		chromaticLayerPass.setLayers(chromaticMasks.both);
		this.chromaticPassEntry = { pass: chromaticLayerPass, masks: chromaticMasks };

		// Skip this 4th scene re-render when neither contributing channel is
		// needed. setActiveScenes masks it to `none` in that case (renders nothing
		// but still binds + clears); the gate drops the bind/clear too. caPass is
		// folded only into channels 1 & 3, whose composition RTTs are themselves
		// gated when not needed, so the stale chromatic sample never reaches
		// output — visually identical.
		const originalChromaticUpdate = chromaticLayerPass.updateBefore.bind(chromaticLayerPass);
		chromaticLayerPass.updateBefore = (frame: any): boolean | undefined => {
			// Mobile: skip this pass for the whole transition, not just once a
			// side freezes — the dominant channel doesn't freeze until progress
			// 0.5, so the first half of every transition still paid for it. Same
			// trade as freezing: a stale fringe is fine.
			if (this.host.isMobile && this.isTransitionActive()) return;
			// A frozen channel's composition RTT is not re-rendered, so a fresh
			// chromatic sample could never reach output — skip the render too.
			const wantS1 = this.isChannelNeeded(1) && !this.isChannelFrozen(1);
			const wantS3 = this.isChannelNeeded(3) && !this.isChannelFrozen(3);
			if (!wantS1 && !wantS3) return;
			return originalChromaticUpdate(frame);
		};

		const chromaticLayerOutput = renderOutput(chromaticLayerPass);

		const staticStrength = uniform(this.host.params.chromeStrength);
		// Exclusion center/radius/feather are the SHARED zone allocated in
		// setupUniforms (also drives RGBSplit). The radial CA uses the same center
		// as its origin, so the central disc reads as a single un-aberrated focus.
		const staticCenter = this.caExclusionCenter;
		const exclusionRadius = this.caExclusionRadius;
		const exclusionFeather = this.caExclusionFeather;
		const staticScale = uniform(this.host.params.chromeScale);
		// Animated fringe-intensity multiplier — scales all three CA channels
		// uniformly, so the timeline can pulse the fringe up/down (and to 0) without
		// shifting its hue. Kept distinct from `strength`, which moves the geometric
		// UV offset per channel and cannot reproduce a uniform amplitude change.
		const splitMix = uniform(this.host.params.chromeSplitMix ?? opts.chromeSplitMix ?? 0.22);
		// Per-channel tints are the SHARED uniforms allocated in setupUniforms
		// (also drive RGBSplit), so a Theatre tint edit recolors both CA paths.
		const redTint = this.chromeRedTint;
		const greenTint = this.chromeGreenTint;
		const blueTint = this.chromeBlueTint;

		this.host.params.staticStrength = staticStrength;
		this.host.params.staticScale = staticScale;
		this.host.params.chromeSplitMix = splitMix;

		const caRawPass = (chromaticAberration as any)(
			chromaticLayerOutput,
			staticStrength,
			staticCenter,
			staticScale.add(this.caBreath),
			splitMix,
			exclusionRadius,
			exclusionFeather,
			this.aspectRatio,
			redTint,
			greenTint,
			blueTint
		);

		const caPass = vec4(caRawPass as any);
		chromaticLayerOutput.toInspector?.('Chromatic Layer');
		caPass.toInspector?.('Chromatic Aberration');

		this.host.params.chromeLayerPass = chromaticLayerPass;
		this.host.params.chromeAberPass = caPass;

		composedByChannel[1] = composedByChannel[1].add(caPass);
		composedByChannel[3] = composedByChannel[3].add(caPass);
	}

	private setupUniforms(): void {
		const domElement = this.host.webGPURenderer.domElement as HTMLCanvasElement;
		this.vignetteIntensity = uniform(float(0));
		this.vignetteWidth = uniform(float(DESKTOP_VIGNETTE_WIDTH));
		this.vignetteRoundness = uniform(float(DESKTOP_VIGNETTE_ROUNDNESS));
		this.vignetteCenter = uniform(float(DESKTOP_VIGNETTE_CENTER));
		this.vignetteColor = uniform(vec3(0.0));
		this.aspectRatio = uniform(domElement.clientWidth / domElement.clientHeight);

		// Shared CA exclusion zone. Allocated here (not in addChromaticAberration)
		// so it exists even when the radial CA pass is off but RGBSplit is active,
		// and so both passes read the SAME uniforms. center is UV — 0.5,0.5 is the
		// screen center. Mirrored onto `params.staticCenter` / `chromeExclusionRadius`
		// / `chromeExclusionFeather` so Theatre (`Visuals.chromatic`) keeps driving
		// them. The radial CANode pass also uses this center as its CA origin.
		const p = this.host.params;
		// On a GPU-context recreate, build() re-runs and these params already hold
		// the prior uniforms (set below), not numbers — so read `.value` back to
		// preserve the artist's last setting instead of re-wrapping a node.
		const numOr = (v: any, d: number): number =>
			typeof v === 'number' ? v : typeof v?.value === 'number' ? v.value : d;
		const centerSource = p.staticCenter?.value;
		this.caExclusionCenter = uniform(
			new THREE.Vector2(
				centerSource?.x ?? numOr(p.chromeCenterX, 0.5),
				centerSource?.y ?? numOr(p.chromeCenterY, 0.5)
			)
		);
		this.caExclusionRadius = uniform(float(numOr(p.chromeExclusionRadius, 0.2)));
		this.caExclusionFeather = uniform(float(numOr(p.chromeExclusionFeather, 0.16)));
		p.staticCenter = this.caExclusionCenter;
		p.chromeExclusionRadius = this.caExclusionRadius;
		p.chromeExclusionFeather = this.caExclusionFeather;

		// Shared per-channel CA tints. Allocated here (not in addChromaticAberration)
		// so the full-frame RGBSplit can read them even when the radial CA pass is
		// off, and so both passes read the SAME Theatre-driven uniforms. On a
		// GPU-context recreate p.chromeRedTint already holds the artist's last
		// uniform — clone its .value back instead of re-seeding the default.
		const tintOr = (v: any, d: THREE.Vector3): THREE.Vector3 =>
			v?.value?.isVector3 ? v.value.clone() : d.clone();
		this.chromeRedTint = uniform(tintOr(p.chromeRedTint, DEFAULT_CHROME_TINTS.red));
		this.chromeGreenTint = uniform(tintOr(p.chromeGreenTint, DEFAULT_CHROME_TINTS.green));
		this.chromeBlueTint = uniform(tintOr(p.chromeBlueTint, DEFAULT_CHROME_TINTS.blue));
		p.chromeRedTint = this.chromeRedTint;
		p.chromeGreenTint = this.chromeGreenTint;
		p.chromeBlueTint = this.chromeBlueTint;

		this.cloudTransitionProgress = uniform(float(0));
		this.cloudTransitionSweepDirection = uniform(float(1));
		this.transitionPairSelector = uniform(float(0));
		this.proceduralLook = this.createLookUniforms(TRANSITION_LOOK_PROCEDURAL);
		this.swarmLook = this.createLookUniforms(TRANSITION_LOOK_SWARM);
		this.transitionMaskTexture = this.createTransitionMaskPlaceholder();
		this.feedbackDecay = uniform(float(0));

		this.fisheyeStrength = uniform(float(0));
		this.fisheyeBarrel = uniform(float(0.5));
		this.fisheyeAberration = uniform(float(0.015));

		this.rgbSplitStrength = uniform(float(0));
		this.rgbSplitOffset = uniform(float(0.004));
		this.rgbSplitRadial = uniform(float(0.15));
		// Green's displacement as a fraction of the red/blue offset, mirroring the
		// radial CA pass's 0.35 green split. A DISTINCT green position (not 0, not 1)
		// is what lets dense dot grids scatter into the full R/G/B rainbow: at 0
		// green sits on the source pixel and thin features leave a magenta (R+B)
		// ghost in place (the pink-dots bug); at 1 green rides with blue and the
		// whole split collapses to two-tone red/cyan.
		this.rgbSplitGreenOffset = uniform(float(0.35));

		// Single breathing pulse shared by every CA pass (radial CANode scale +
		// full-frame RGBSplit offset). Defaults reproduce the values the radial CA
		// previously hard-coded (sin(time*1.3)*0.5); set amount to 0 to freeze all
		// CA. Built once here so addChromaticAberration and addRgbSplit read the
		// same node and breathe in phase. Resets to defaults on a GPU-context
		// recreate (like the other look-constant uniforms above).
		this.caBreathAmount = uniform(float(0.5));
		this.caBreathSpeed = uniform(float(1.3));
		this.caBreath = sin(time.mul(this.caBreathSpeed)).mul(this.caBreathAmount);
	}

	private addTransitionNode(finalScenePass: any, fromColor: any, toColor: any): any {
		if (!this.host.graphicsOptions.postProcessing.cloudTransition) return finalScenePass;

		const maskTextureNode = this.transitionMaskTexture ? texture(this.transitionMaskTexture) : null;
		if (maskTextureNode) this.transitionMaskTextureNodes.push(maskTextureNode);

		const transitionPass = (transitionNode as any)({
			inputColorNode: finalScenePass,
			progressNode: this.cloudTransitionProgress,
			fromSceneColorNode: fromColor,
			toSceneColorNode: toColor,
			mixTextureNode: maskTextureNode,
			blueNoiseTextureNode: fromColor,
			sweepDirectionNode: this.cloudTransitionSweepDirection,
			pairSelectorNode: this.transitionPairSelector,
			aspectRatioNode: this.aspectRatio,
			proceduralLook: this.proceduralLook,
			swarmLook: this.swarmLook,
			// Mobile builds the cheap shader variant: single-tap sampling (no
			// chromatic split), fewer smear taps, gradient extras dropped.
			reducedQuality: this.host.isMobile
		});
		transitionPass.toInspector?.('Transition Node');
		return transitionPass;
	}

	private createTransitionMaskPlaceholder(): THREE.Texture {
		// 1x1 white CanvasTexture as placeholder so the shader gets a valid
		// sample before the PNG arrives. Using a canvas (not DataTexture)
		// keeps WebGPU on the copyExternalImageToTexture path, which matches
		// the HTMLImageElement we swap in once the PNG loads. luma=1 keeps
		// the threshold smoothstep at 0 for all but the last sliver of
		// progress, so the in-flight window effectively shows the `from`
		// scene rather than flashing.
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		const ctx = canvas.getContext('2d');
		if (ctx) {
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, 1, 1);
		}
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.NoColorSpace;
		tex.needsUpdate = true;

		if (this.host.graphicsOptions.postProcessing.cloudTransition) {
			// KTX2/ETC1S (~63 KB vs ~760 KB PNG), transcoded off-thread and kept
			// GPU-compressed. Encoded with -linear (matches the placeholder's
			// NoColorSpace raw sampling) and -y_flip (CompressedTexture can't
			// flipY at runtime, so the flip the PNG got from TextureLoader is
			// baked into the file). TextureCache defers .ktx2 loads until
			// MainScene registers the KTX2 loader, so this build-time kickoff
			// is safe. The loaded texture swaps in via the TSL node's value.
			TextureCache.load('/textures/Transition/Transition 3_00015.ktx2')
				.then((loaded) => {
					loaded.colorSpace = THREE.NoColorSpace;
					this.transitionMaskTexture = loaded;
					for (const node of this.transitionMaskTextureNodes) {
						node.value = loaded;
					}
				})
				.catch((err) => {
					console.warn('[Transition] failed to load mix texture', err);
				});
		}

		return tex;
	}

	private addCommonPostStack(scenePass: any): any {
		let finalScenePass = scenePass;
		finalScenePass = this.addFluidDistortion(finalScenePass);
		finalScenePass = this.addFisheye(finalScenePass);
		finalScenePass = this.addRgbSplit(finalScenePass);
		finalScenePass = this.addVignette(finalScenePass);
		return finalScenePass;
	}

	private addRgbSplit(finalScenePass: any): any {
		// Ride the same breathing pulse as the radial CA so the white-bg pyramid
		// split breathes in phase with the octagon. caBreath is signed
		// (±caBreathAmount); (1 + caBreath) keeps the offset positive for amounts
		// < 1. Outside the pyramid window rgbSplitStrength is 0, so this pulse is
		// invisible there.
		const breathingOffset = this.caBreath
			? this.rgbSplitOffset.mul(float(1).add(this.caBreath))
			: this.rgbSplitOffset;
		const splitPass = rgbSplit(
			finalScenePass,
			this.rgbSplitStrength,
			breathingOffset,
			this.rgbSplitRadial,
			this.aspectRatio,
			this.caExclusionCenter,
			this.caExclusionRadius,
			this.caExclusionFeather,
			// Shared Theatre-driven tints (allocated in setupUniforms) — the same
			// uniforms the radial CA pass reads, so one control recolors both. Green
			// only gains a fringe when rgbSplitGreenOffset > 0 displaces it (else it
			// stays the stationary anchor and greenTint is inert here — see RGBSplitNode).
			this.chromeRedTint,
			this.chromeGreenTint,
			this.chromeBlueTint,
			this.rgbSplitGreenOffset
		);
		splitPass.toInspector?.('RGB Split');
		return splitPass;
	}

	private addFisheye(finalScenePass: any): any {
		const fisheyePass = fisheye(
			finalScenePass,
			this.fisheyeStrength,
			this.fisheyeBarrel,
			this.fisheyeAberration,
			this.aspectRatio
		);
		fisheyePass.toInspector?.('Fisheye');
		return fisheyePass;
	}

	private addFluidDistortion(finalScenePass: any): any {
		if (!this.host.fluidEffect) return finalScenePass;

		const velocityNode = this.host.fluidEffect.getVelocityNode();
		const sim = this.host.fluidEffect.getSimSize();
		const simSizeNode = uniform(vec2(sim.x, sim.y));

		if (!this.fluidDistortionStrength) {
			this.fluidDistortionStrength = uniform(float(1.0));
			this.fluidColorTint = uniform(vec3(1, 1, 1));
			this.fluidColorAmount = uniform(float(0.15));
			this.fluidDebug = uniform(float(0.0));
		}

		const fluidDistortionPass = fluidDistortion(
			finalScenePass,
			velocityNode,
			simSizeNode,
			this.fluidDistortionStrength,
			this.fluidActive,
			this.fluidDebug,
			this.fluidColorTint,
			this.fluidColorAmount
		);
		fluidDistortionPass.toInspector?.('Fluid Distortion');

		return this.host.graphicsOptions.postProcessing.fluidDistortion
			? fluidDistortionPass
			: finalScenePass;
	}

	private addFxaa(finalScenePass: any): any {
		if (!this.host.graphicsOptions.postProcessing.fxaa) return finalScenePass;
		const fxaaPass = fxaa(finalScenePass);
		fxaaPass.toInspector?.('FXAA');
		return fxaaPass;
	}

	private addVignette(finalScenePass: any): any {
		if (!this.host.graphicsOptions.postProcessing.vignette) return finalScenePass;
		const vignettePass = vignette(
			finalScenePass,
			this.vignetteIntensity,
			this.vignetteWidth,
			this.vignetteRoundness,
			this.vignetteCenter,
			this.vignetteColor,
			this.aspectRatio
		) as any;
		vignettePass.toInspector?.('Vignette / Final');
		return vignettePass;
	}

	private createLayerMask(...layers: number[]): THREE.Layers {
		const mask = new THREE.Layers();
		mask.disableAll();
		for (const layer of layers) {
			mask.enable(layer);
		}
		return mask;
	}
}

export default PostProcessingGraph;
