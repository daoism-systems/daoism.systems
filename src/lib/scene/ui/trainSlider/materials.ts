import * as THREE from 'three';
import {
	positionLocal,
	float,
	vec2,
	vec3,
	mul,
	sub,
	sin,
	time,
	abs,
	texture,
	uv,
	mix,
	smoothstep,
	clamp,
	add,
	length,
	floor,
	max,
	min,
	div,
	dot,
	fract,
	positionWorld,
	screenUV
} from 'three/tsl';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import type { ResolvedSliderProps } from './config';
import type { FocusUniform } from './layout';
import type { VelocityNode } from '../../particles/FluidMouseField';

type SliderUniforms = {
	velocity: { value: number };
	globalOpacity: any;
	colorIntensity: any;
	cornerRadius: any;
	harmonicaCenter: any;
	harmonicaRadius: any;
	harmonicaSmoothness: any;
	harmonicaBands: any;
	harmonicaSpeed: any;
	harmonicaFrequency: any;
	harmonicaAmplitude: any;
	curveFrequency: any;
	curveStrength: any;
	mobileCurveScale: any;
	curveMaxCurve: any;
	curveYInfluence: any;
	mobileClickHint: any;
	fluidVelocityNode?: VelocityNode | null;
	fluidSimSize?: any;
	fluidStrength?: any;
};

const SLIDE_EMISSIVE_INTENSITY = 1;

// Slides composite on top of the post-FX stack (see PostProcessingGraph), so
// they never pick up the global film grain / contrast. Re-create the handoff's
// brighter, grainier VHS look directly in the slide material instead.
const SLIDE_CONTRAST = 1.08; // pivot around 0.5: deepens blacks, lifts the logo
const SLIDE_BRIGHTNESS = 1.12; // overall gain so the mid-grey shapes read brighter
const GRAIN_STRENGTH = 0.06; // peak-to-peak ≈ ±0.03 luminance jitter
const GRAIN_SCALE = 900; // screen-space frequency of the grain cells

function applySlideGrade(color: any) {
	const contrasted = add(mul(sub(color, vec3(0.5)), float(SLIDE_CONTRAST)), vec3(0.5));
	const brightened = mul(contrasted, float(SLIDE_BRIGHTNESS));
	// Screen-locked, per-frame animated hash noise → film grain over the slide.
	const grainSeed = dot(mul(screenUV, float(GRAIN_SCALE)), vec2(12.9898, 78.233));
	const grainRandom = fract(mul(sin(add(grainSeed, mul(time, float(11.0)))), float(43758.5453)));
	const grain = mul(sub(grainRandom, float(0.5)), float(GRAIN_STRENGTH));
	return max(add(brightened, grain), vec3(0));
}

export function createContinuousPosition(props: ResolvedSliderProps, uniforms: SliderUniforms) {
	const unitWidth = props.planeWidth + props.spacing;
	const normalizedX = div(positionWorld.x, float(unitWidth * 5.5));
	const waveInput = mul(normalizedX, uniforms.curveFrequency);
	const curveWave = sin(mul(waveInput, float(Math.PI)));
	const curveInfluence = mul(
		mul(uniforms.velocity, uniforms.curveStrength),
		mul(uniforms.mobileCurveScale, float(0.22))
	);
	const zDisplacement = mul(
		mul(curveWave, curveInfluence),
		mul(uniforms.curveMaxCurve, float(0.22))
	);
	const yWave = sin(mul(add(waveInput, float(Math.PI * 0.5)), float(Math.PI * 0.8)));
	const yDisplacement = mul(mul(mul(yWave, curveInfluence), uniforms.curveYInfluence), float(0.12));

	return vec3(
		positionLocal.x,
		add(positionLocal.y, yDisplacement),
		add(positionLocal.z, zDisplacement)
	);
}

export function createHarmonicaBandsEffect(
	slideIndex: number,
	props: ResolvedSliderProps,
	uniforms: SliderUniforms
) {
	const uvCoord = uv();
	const uvOffsetX = mul(sub(uvCoord.x, float(0.5)), float(props.planeWidth));
	const distFromCenter = abs(sub(positionWorld.x, uniforms.harmonicaCenter));
	const effectMask = sub(
		float(1),
		smoothstep(
			sub(uniforms.harmonicaRadius, uniforms.harmonicaSmoothness),
			uniforms.harmonicaRadius,
			distFromCenter
		)
	);
	const bandWidth = div(uniforms.harmonicaRadius, uniforms.harmonicaBands);
	const bandIndex = floor(div(uvOffsetX, bandWidth));
	const wavePhase = add(mul(bandIndex, float(0.5)), mul(time, uniforms.harmonicaSpeed));
	const waveSin = sin(mul(wavePhase, uniforms.harmonicaFrequency));
	const bandDistortion = mul(
		waveSin,
		mul(uniforms.harmonicaAmplitude, mix(float(1), float(-1), bandIndex))
	);
	const maskedDistortion = mul(bandDistortion, effectMask);
	const harmonicaUV = vec2(add(uvCoord.x, mul(maskedDistortion, float(0.5))), uvCoord.y);
	return clamp(harmonicaUV, vec2(0), vec2(1));
}

export function createEdgeMaskNodes(uvCoord: ReturnType<typeof uv>) {
	const edgeDistance = min(
		min(uvCoord.x, sub(float(1), uvCoord.x)),
		min(uvCoord.y, sub(float(1), uvCoord.y))
	);
	return {
		edgeDistance,
		outerBorderMask: sub(float(1), smoothstep(float(0.0), float(0.014), edgeDistance))
	};
}

export function createRoundedOpacityNode(
	uvCoord: ReturnType<typeof uv>,
	cornerRadius: SliderUniforms['cornerRadius']
) {
	const centeredUV = sub(uvCoord, vec2(0.5, 0.5));
	const rectSize = sub(vec2(0.5, 0.5), vec2(cornerRadius, cornerRadius));
	const d = sub(abs(centeredUV), rectSize);
	const outsideDist = length(max(d, vec2(0.0, 0.0)));
	const insideDist = min(max(d.x, d.y), float(0.0));
	const roundedRectSdf = add(outsideDist, insideDist);
	const edgeSmoothing = float(0.01);
	return sub(float(1), smoothstep(sub(cornerRadius, edgeSmoothing), cornerRadius, roundedRectSdf));
}

export function createSharedFluidUvEffect(baseUv: ReturnType<typeof uv>, uniforms: SliderUniforms) {
	const velocityNode = uniforms.fluidVelocityNode;
	const simSize = uniforms.fluidSimSize;
	const strength = uniforms.fluidStrength;

	if (!velocityNode || !simSize || !strength) {
		return baseUv;
	}

	// The shared FluidMouseField is authored in screen space, so the slider samples
	// it via screenUV and remaps the resulting displacement into the slide's local
	// texture UVs. Strength is kept modest so the global pass and local warp layer.
	const fluidUv = vec2(screenUV.x, sub(float(1), screenUV.y));
	const velocity = velocityNode.sample(fluidUv).xy;
	const displacement = velocity.div(simSize).mul(strength);
	const sampleOffset = displacement.mul(add(float(0.1), length(displacement).mul(4.5)));

	return clamp(sub(baseUv, sampleOffset), vec2(0), vec2(1));
}

function createSampledSlideUv(params: {
	slideIndex: number;
	props: ResolvedSliderProps;
	uniforms: SliderUniforms;
}) {
	return createSharedFluidUvEffect(
		createHarmonicaBandsEffect(params.slideIndex, params.props, params.uniforms),
		params.uniforms
	);
}

export function createSlideMaterial(params: {
	mainTexture: THREE.Texture;
	slideIndex: number;
	titleTexture: THREE.Texture | null;
	focusUniform: FocusUniform;
	props: ResolvedSliderProps;
	uniforms: SliderUniforms;
	isMobileViewport: boolean;
}): THREE.Material {
	if (params.isMobileViewport) {
		return createMobileSlideMaterial(params);
	}
	return createDesktopSlideMaterial(params);
}

function createMobileSlideMaterial(params: {
	mainTexture: THREE.Texture;
	slideIndex: number;
	titleTexture: THREE.Texture | null;
	focusUniform: FocusUniform;
	props: ResolvedSliderProps;
	uniforms: SliderUniforms;
}): THREE.Material {
	const material = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true });
	const uvCoord = uv();
	const sampledUv = createSampledSlideUv(params);
	const { outerBorderMask, edgeDistance } = createEdgeMaskNodes(uvCoord);
	const activeHintMask = smoothstep(float(0.82), float(0.98), params.focusUniform);

	// Radial chromatic fringe near the rim, scaled by focus — a soft lens flare on the active slide.
	const caEdgeWeight = sub(float(1), smoothstep(float(0.06), float(0.28), edgeDistance));
	const caStrength = mul(caEdgeWeight, mul(params.focusUniform, float(0.014)));
	const radialDir = sub(uvCoord, vec2(0.5, 0.5));
	const baseR = texture(params.mainTexture, sub(sampledUv, mul(radialDir, caStrength))).r;
	const baseG = texture(params.mainTexture, sampledUv).g;
	const baseB = texture(params.mainTexture, add(sampledUv, mul(radialDir, caStrength))).b;
	const baseColor = vec3(baseR, baseG, baseB);

	// Inner vignette that fades out as the slide gains focus, so the active card pops.
	const dimAmount = sub(float(1), params.focusUniform);
	const innerVignette = smoothstep(float(0.42), float(0.0), edgeDistance);
	const focusBrightness = mix(float(0.62), float(1.0), params.focusUniform);
	const focusedBrightness = sub(focusBrightness, mul(innerVignette, mul(dimAmount, float(0.32))));
	const dimmedBase = mul(baseColor, focusedBrightness);

	const pulse = mul(add(sin(mul(time, float(3.1))), float(1)), float(0.5));
	const highlightStrength = mul(
		mul(params.uniforms.mobileClickHint, activeHintMask),
		add(float(0.18), mul(pulse, float(0.12)))
	);
	const darkBorderColor = vec3(0.1, 0.11, 0.14);
	const darkenedBase = mix(dimmedBase, darkBorderColor, mul(outerBorderMask, highlightStrength));

	material.colorNode = mul(applySlideGrade(darkenedBase), params.uniforms.colorIntensity);
	material.positionNode = createContinuousPosition(params.props, params.uniforms);
	material.opacityNode = mul(
		createRoundedOpacityNode(uvCoord, params.uniforms.cornerRadius),
		params.uniforms.globalOpacity
	);
	return material;
}

function createDesktopSlideMaterial(params: {
	mainTexture: THREE.Texture;
	slideIndex: number;
	titleTexture: THREE.Texture | null;
	focusUniform: FocusUniform;
	props: ResolvedSliderProps;
	uniforms: SliderUniforms;
}): THREE.Material {
	const material = new MeshStandardNodeMaterial({ side: THREE.DoubleSide, transparent: true });
	const uvCoord = uv();
	const sampledUv = createSampledSlideUv(params);

	const baseColor = texture(params.mainTexture, sampledUv).rgb;
	const activeHintMask = smoothstep(float(0.82), float(0.98), params.focusUniform);
	const titleMixMask = mul(params.uniforms.mobileClickHint, activeHintMask);
	let finalColor = baseColor;

	if (params.titleTexture) {
		const titleSample = texture(params.titleTexture, sampledUv);
		const titleAlpha = mul(titleSample.a, titleMixMask);
		const brightTitleColor = clamp(mul(titleSample.rgb, float(1.35)), vec3(0), vec3(1));
		finalColor = mix(baseColor, brightTitleColor, titleAlpha);
	}

	const gradedColor = mul(applySlideGrade(finalColor), params.uniforms.colorIntensity);

	const roundedOpacity = mul(
		createRoundedOpacityNode(uvCoord, params.uniforms.cornerRadius),
		params.uniforms.globalOpacity
	);

	material.positionNode = createContinuousPosition(params.props, params.uniforms);
	material.emissiveNode = mul(gradedColor, float(SLIDE_EMISSIVE_INTENSITY));
	material.colorNode = gradedColor;
	material.opacityNode = roundedOpacity;
	return material;
}
