import * as THREE from 'three/webgpu';
import {
	uniform,
	texture,
	vec2,
	vec3,
	float,
	dot,
	mix,
	clamp,
	pow,
	smoothstep,
	screenUV,
	time,
	mx_noise_float,
	Fn,
	rtt
} from 'three/tsl';
import type { Inspectable } from '../debug/Inspectable';
import { TextureCache } from '../materials/TextureCache';
import { detectMob } from '$lib/utils/isMobile';

type DaoBlendName = 'Normal' | 'Additive' | 'Multiply';

interface DaoFogLayerDef {
	name: string;
	file: string;
	defaultOpacity: number;
	defaultScale: number;
	defaultOffsetX: number;
	defaultOffsetY: number;
	blending?: DaoBlendName;
	defaultTint?: string;
	defaultSaturation?: number;
}

const LAYER_DEFS: DaoFogLayerDef[] = [
	// {
	// 	name: 'Clouds',
	// 	file: 'bg.ktx2',
	// 	defaultOpacity: 1,
	// 	defaultScale: 1,
	// 	defaultOffsetX: 0,
	// 	defaultOffsetY: 0,
	// 	blending: 'Normal'
	// },
	{
		name: 'Shine',
		file: 'Shine.ktx2',
		defaultOpacity: 0.35,
		defaultScale: 1,
		defaultOffsetX: 0.0,
		defaultOffsetY: 0.0,
		blending: 'Additive'
	},
	// {
	// 	name: 'Fog01',
	// 	file: 'fog01.ktx2',
	// 	defaultOpacity: 0.35,
	// 	defaultScale: 1,
	// 	defaultOffsetX: 0.0,
	// 	defaultOffsetY: 0.0,
	// 	blending: 'Additive'
	// },
	{
		// Light_01 is a saturated orange/blue/cream gradient; additive at full
		// opacity over a dark scene washes everything out. Keep opacity in the
		// subtle range so the gradient reads as a soft tint at the corners
		// rather than a flat color overlay. Fine-tune live via the dat.gui /
		// Theatre inspector.
		name: 'Lighting',
		file: 'Light_01.ktx2',
		defaultOpacity: 0.35,
		defaultScale: 1.25,
		defaultOffsetX: 0.0,
		defaultOffsetY: 0.0,
		defaultSaturation: 1,
		blending: 'Additive'
	}
];

// const DARK_CIRCLE_DEFAULTS = {
// 	name: 'Dark Circle Left',
// 	tint: '#8790a1',
// 	color: '#21252E',
// 	opacity: 1.0,
// 	scale: 1.85,
// 	offsetX: -0.58,
// 	offsetY: -0.26,
// 	saturation: 1,
// 	blending: 'Normal' as DaoBlendName
// };

const BLENDING_OPTIONS: DaoBlendName[] = ['Normal', 'Additive', 'Multiply'];

const LUMA_WEIGHTS = vec3(0.2126, 0.7152, 0.0722);
const NOISE_OCTAVES_MAX = 4;

const NOISE_LAYER_DEFAULTS = {
	name: 'Noise',
	opacity: 0.05,
	scale: 1.0,
	offsetX: 0,
	offsetY: 0,
	tint: '#ffffff',
	saturation: 1,
	blending: 'Additive' as DaoBlendName,
	strength: 1.0,
	speed: 0.15,
	noiseScale: 6.8,
	contrast: 2.0,
	octaves: 2.5
};

export interface NoiseLayerState {
	strengthUniform: ReturnType<typeof uniform>;
	speedUniform: ReturnType<typeof uniform>;
	noiseScaleUniform: ReturnType<typeof uniform>;
	contrastUniform: ReturnType<typeof uniform>;
	octavesUniform: ReturnType<typeof uniform>;
	strength: number;
	speed: number;
	noiseScale: number;
	contrast: number;
	octaves: number;
}

export interface DaoFogLayer {
	name: string;
	kind: 'texture' | 'noise';
	tex: THREE.Texture | null;
	ownsTexture: boolean;
	opacityUniform: ReturnType<typeof uniform>;
	tintUniform: ReturnType<typeof uniform>;
	saturationUniform: ReturnType<typeof uniform>;
	scaleUniform: ReturnType<typeof uniform>;
	offsetUniform: ReturnType<typeof uniform>;
	tintColor: THREE.Color;
	saturation: number;
	blending: DaoBlendName;
	opacity: number;
	scale: number;
	offsetX: number;
	offsetY: number;
	noise: NoiseLayerState | null;
}

// function createBlurredCircleTexture(color: string, size = 512): THREE.CanvasTexture {
// 	const canvas = document.createElement('canvas');
// 	canvas.width = size;
// 	canvas.height = size;
// 	const ctx = canvas.getContext('2d')!;

// 	const cx = size / 2;
// 	const cy = size / 2;
// 	const radius = size / 2;

// 	const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
// 	gradient.addColorStop(0, color);
// 	gradient.addColorStop(0.4, color);
// 	gradient.addColorStop(1, 'rgba(0,0,0,0)');

// 	ctx.fillStyle = gradient;
// 	ctx.fillRect(0, 0, size, size);

// 	const tex = new THREE.CanvasTexture(canvas);
// 	tex.minFilter = THREE.LinearFilter;
// 	tex.magFilter = THREE.LinearFilter;
// 	tex.generateMipmaps = false;
// 	tex.wrapS = THREE.ClampToEdgeWrapping;
// 	tex.wrapT = THREE.ClampToEdgeWrapping;
// 	// CanvasTextures are authored in sRGB.
// 	tex.colorSpace = THREE.SRGBColorSpace;
// 	return tex;
// }

function configureFogTexture(tex: THREE.Texture): void {
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.needsUpdate = true;
}

/**
 * DaoFog — screen-space fog overlay composited as a single TSL node after
 * vignette. Owned by `Renderer.setOverlayCompositor`. Each layer is sampled
 * in screen UV with per-layer scale / offset / tint / saturation. Layers can
 * be texture-backed or procedural FBM noise (the `Noise` layer); procedural
 * layers carry their own speed / scale / contrast / octaves uniforms and
 * blend identically to texture layers.
 *
 * Replaces the previous billboard-mesh implementation, which had cross-
 * browser issues on Safari (depthTest-off transparent draw order +
 * KTX2 SRGB autoconversion produced washed-out colors).
 */
export class DaoFog implements Inspectable {
	masterOpacity = 0.34;
	readonly layers: DaoFogLayer[] = [];

	/**
	 * When true and every layer blends additively, the layer stack is rendered
	 * into a half-resolution RT once per frame and the composite reduces to
	 * `background + sample(RT)` — algebraically identical to the inline path
	 * (additive blending is background-independent), at ~1/4 the fragment cost.
	 */
	constructor(private readonly halfResPrepass = false) {}

	/** Half-res prepass RT scale relative to the physical render surface. */
	private static readonly PREPASS_SCALE = 0.5;
	private fogRttNode: ReturnType<typeof rtt> | null = null;
	private surfaceWidth = 1;
	private surfaceHeight = 1;

	/**
	 * Renderer surface-resize hook (physical backing-store pixels). Sizes the
	 * prepass RT; called before the compositor builds and on every resize, so
	 * the RT also tracks runtime resolution-scale changes.
	 */
	resizeRenderTarget(width: number, height: number): void {
		this.surfaceWidth = Math.max(1, width);
		this.surfaceHeight = Math.max(1, height);
		this.fogRttNode?.setSize(this.surfaceWidth, this.surfaceHeight);
	}

	async loadTextures(): Promise<void> {
		const isMobile = detectMob();
		const textures = await Promise.all(
			LAYER_DEFS.map((def) => TextureCache.load(`/textures/daofog/${def.file}`))
		);

		for (let i = 0; i < LAYER_DEFS.length; i++) {
			const def = LAYER_DEFS[i];
			const tex = textures[i];
			configureFogTexture(tex);
			this.layers.push(
				this.createLayer({
					name: def.name,
					tex,
					ownsTexture: false,
					tint: def.defaultTint ?? '#ffffff',
					saturation: def.defaultSaturation ?? 1,
					opacity: def.defaultOpacity,
					scale: isMobile ? def.defaultScale * 2 : def.defaultScale,
					offsetX: def.defaultOffsetX,
					offsetY: def.defaultOffsetY,
					blending: def.blending ?? 'Additive'
				})
			);
		}

		// this.layers.push(
		// 	this.createLayer({
		// 		name: DARK_CIRCLE_DEFAULTS.name,
		// 		tex: createBlurredCircleTexture(DARK_CIRCLE_DEFAULTS.color, 512),
		// 		ownsTexture: true,
		// 		tint: DARK_CIRCLE_DEFAULTS.tint,
		// 		saturation: DARK_CIRCLE_DEFAULTS.saturation,
		// 		opacity: DARK_CIRCLE_DEFAULTS.opacity,
		// 		scale: DARK_CIRCLE_DEFAULTS.scale,
		// 		offsetX: DARK_CIRCLE_DEFAULTS.offsetX,
		// 		offsetY: DARK_CIRCLE_DEFAULTS.offsetY,
		// 		blending: DARK_CIRCLE_DEFAULTS.blending
		// 	})
		// );

		this.layers.push(
			this.createLayer({
				name: NOISE_LAYER_DEFAULTS.name,
				tex: null,
				ownsTexture: false,
				tint: NOISE_LAYER_DEFAULTS.tint,
				saturation: NOISE_LAYER_DEFAULTS.saturation,
				opacity: NOISE_LAYER_DEFAULTS.opacity,
				scale: isMobile ? NOISE_LAYER_DEFAULTS.scale * 2 : NOISE_LAYER_DEFAULTS.scale,
				offsetX: NOISE_LAYER_DEFAULTS.offsetX,
				offsetY: NOISE_LAYER_DEFAULTS.offsetY,
				blending: NOISE_LAYER_DEFAULTS.blending,
				noise: {
					strength: NOISE_LAYER_DEFAULTS.strength,
					speed: NOISE_LAYER_DEFAULTS.speed,
					noiseScale: NOISE_LAYER_DEFAULTS.noiseScale,
					contrast: NOISE_LAYER_DEFAULTS.contrast,
					octaves: NOISE_LAYER_DEFAULTS.octaves
				}
			})
		);
	}

	private createLayer(opts: {
		name: string;
		tex: THREE.Texture | null;
		ownsTexture: boolean;
		tint: string;
		saturation: number;
		opacity: number;
		scale: number;
		offsetX: number;
		offsetY: number;
		blending: DaoBlendName;
		noise?: {
			strength: number;
			speed: number;
			noiseScale: number;
			contrast: number;
			octaves: number;
		};
	}): DaoFogLayer {
		const tintColor = new THREE.Color(opts.tint);
		const noise: NoiseLayerState | null = opts.noise
			? {
					strengthUniform: uniform(float(opts.noise.strength)),
					speedUniform: uniform(float(opts.noise.speed)),
					noiseScaleUniform: uniform(float(opts.noise.noiseScale)),
					contrastUniform: uniform(float(opts.noise.contrast)),
					octavesUniform: uniform(float(opts.noise.octaves)),
					strength: opts.noise.strength,
					speed: opts.noise.speed,
					noiseScale: opts.noise.noiseScale,
					contrast: opts.noise.contrast,
					octaves: opts.noise.octaves
				}
			: null;
		return {
			name: opts.name,
			kind: opts.noise ? 'noise' : 'texture',
			tex: opts.tex,
			ownsTexture: opts.ownsTexture,
			opacityUniform: uniform(float(opts.opacity)),
			tintUniform: uniform(vec3(tintColor.r, tintColor.g, tintColor.b)),
			saturationUniform: uniform(float(opts.saturation)),
			scaleUniform: uniform(float(opts.scale)),
			offsetUniform: uniform(vec2(opts.offsetX, opts.offsetY)),
			tintColor,
			saturation: opts.saturation,
			blending: opts.blending,
			opacity: opts.opacity,
			scale: opts.scale,
			offsetX: opts.offsetX,
			offsetY: opts.offsetY,
			noise
		};
	}

	/**
	 * Build a TSL node that composites every fog layer over `background`.
	 * Called once by `Renderer.setOverlayCompositor`; the returned node holds
	 * direct references to this fog's uniforms, so live edits (Theatre, GUI)
	 * propagate without recompiling the graph.
	 */
	buildCompositeNode(background: any): any {
		// Half-res fast path. Valid only while every layer is additive — the
		// inspector can switch a layer's blend mode at runtime (which triggers
		// a graph rebuild through here), so re-check on every build.
		if (this.halfResPrepass && this.layers.every((l) => l.blending === 'Additive')) {
			// vec3() — the RT samples as vec4 (alpha 1); the inline path only
			// ever adds vec3 contributions, so keep the math identical.
			return background.add(vec3(this.getAdditiveFogRtt()));
		}

		let composed: any = background;
		for (const layer of this.layers) {
			const contribution = this.buildLayerContribution(layer);
			if (!contribution) continue;
			composed = this.blendLayer(composed, contribution.tinted, contribution.alpha, layer.blending);
		}
		return composed;
	}

	/**
	 * Per-layer screen-space evaluation shared by the inline and prepass paths.
	 * Screen-UV sample: scale=1 covers full screen, scale>1 zooms in (samples a
	 * smaller texture window), offset shifts in NDC. Mirrors the billboard
	 * semantics in the old mesh implementation.
	 */
	private buildLayerContribution(layer: DaoFogLayer): { tinted: any; alpha: any } | null {
		const centeredUv = screenUV.sub(vec2(0.5, 0.5)).sub(layer.offsetUniform);
		const sampleUv = centeredUv.div(layer.scaleUniform).add(vec2(0.5, 0.5));

		let rgb: any;
		let baseAlpha: any;

		if (layer.kind === 'noise' && layer.noise) {
			// Procedural FBM fog. strength=0 → uniform fog (mask=1),
			// strength=1 → noise-shaped fog. rgb stays white pre-tint so
			// the noise modulates density rather than luminance.
			const noiseValue = this.buildFbmFn(layer.noise)(sampleUv);
			const mask = mix(float(1), noiseValue, layer.noise.strengthUniform);
			rgb = vec3(1, 1, 1);
			baseAlpha = mask;
		} else if (layer.tex) {
			const sampled = texture(layer.tex, sampleUv);
			rgb = sampled.rgb;
			baseAlpha = sampled.a;
		} else {
			return null;
		}

		const luma = dot(rgb, LUMA_WEIGHTS);
		const grayscale = vec3(luma, luma, luma);
		const tinted = mix(grayscale, rgb, layer.saturationUniform).mul(layer.tintUniform);
		const alpha = baseAlpha
			.mul(layer.opacityUniform)
			.mul(this.masterOpacityUniform)
			.mul(this.introOpacityUniform);

		return { tinted, alpha };
	}

	/**
	 * Lazily builds (and caches across graph rebuilds — `rebuildOutputNode`
	 * runs repeatedly and a fresh RT per build would leak) the half-res RT
	 * holding `Σ tintedᵢ·alphaᵢ`. Re-rendered every frame, so `time`-driven
	 * FBM and live Theatre/intro uniforms keep animating inside it.
	 */
	private getAdditiveFogRtt(): any {
		if (this.fogRttNode) return this.fogRttNode;

		let sum: any = vec3(0, 0, 0);
		for (const layer of this.layers) {
			const contribution = this.buildLayerContribution(layer);
			if (!contribution) continue;
			sum = sum.add(contribution.tinted.mul(contribution.alpha));
		}

		// Explicit size — RTTNode's autoResize tracks the full surface and
		// ignores pixelRatio, so the half scale must go through setSize.
		// `depthBuffer` is forwarded to the RenderTarget at runtime but missing
		// from RTTNodeOptions, hence the cast.
		const node = rtt(sum, this.surfaceWidth, this.surfaceHeight, {
			type: THREE.HalfFloatType,
			depthBuffer: false
		} as Parameters<typeof rtt>[3]);
		node.pixelRatio = DaoFog.PREPASS_SCALE;
		node.setSize(this.surfaceWidth, this.surfaceHeight);
		this.fogRttNode = node;
		return node;
	}

	// Manual FBM loop instead of `mx_fractal_noise_float` because that helper
	// bakes the octave count into the compiled shader — a uniform octaves
	// value would silently do nothing. The smoothstep fade lets fractional
	// octaves cross-fade smoothly for animation.
	private buildFbmFn(noise: NoiseLayerState) {
		return Fn(([uv]: any) => {
			const flow = vec2(time.mul(noise.speedUniform), time.mul(noise.speedUniform).mul(0.37));
			const basePos = uv.mul(noise.noiseScaleUniform).add(flow);

			let acc: any = float(0);
			let norm: any = float(0);
			let amp = 0.5;
			let freq = 1.0;
			for (let i = 0; i < NOISE_OCTAVES_MAX; i++) {
				const fade = smoothstep(float(i), float(i + 1), noise.octavesUniform);
				const sample = mx_noise_float(basePos.mul(freq));
				acc = acc.add(sample.mul(amp).mul(fade));
				norm = norm.add(float(amp).mul(fade));
				amp *= 0.5;
				freq *= 2;
			}
			const normalized = clamp(acc.div(norm.add(0.0001)).mul(0.5).add(0.5), 0, 1);
			return pow(normalized, noise.contrastUniform);
		});
	}

	private masterOpacityUniform = uniform(float(this.masterOpacity));

	// Intro-only fade gate. Multiplied into each layer's alpha so the fog can
	// bloom in 0→1 during the intro transition without touching `masterOpacity`
	// (which Theatre owns and writes on its own ticker — sharing that uniform
	// races the flush order and flickers). Defaults to 1 so post-intro frames
	// and recovery render at full Theatre-authored opacity.
	private introOpacityUniform = uniform(float(1));

	private blendLayer(background: any, color: any, alpha: any, mode: DaoBlendName): any {
		switch (mode) {
			case 'Additive':
				// Premultiplied add — alpha-weighted color piles onto background.
				// Stays HDR-stable; tone-map at output handles clamping.
				return background.add(color.mul(alpha));
			case 'Multiply':
				// `mix(1, color, alpha)` is the multiplier; alpha=0 → identity.
				return background.mul(mix(vec3(1.0), color, alpha));
			case 'Normal':
			default:
				return mix(background, color, alpha);
		}
	}

	setMasterOpacity(v: number): void {
		this.masterOpacity = v;
		this.masterOpacityUniform.value = v;
	}

	setIntroOpacity(v: number): void {
		this.introOpacityUniform.value = v < 0 ? 0 : v > 1 ? 1 : v;
	}

	// ── Theatre.js Inspectable ────────────────────────────────────────

	// Theatre.js requires alphanumeric keys starting with a letter. Layer names
	// like "Dark Circle Left" need to fold into a flat key, so getConfig and
	// applyConfig round-trip through this helper to stay in agreement.
	private theatreLayerKey(name: string): string {
		const cleaned = name
			.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
			.replace(/[^a-zA-Z0-9]/g, '');
		return /^[a-zA-Z]/.test(cleaned) ? cleaned : `Layer${cleaned}`;
	}

	getConfig(): Record<string, any> {
		const layers: Record<string, any> = {};
		for (const l of this.layers) {
			const entry: Record<string, any> = {
				opacity: l.opacity,
				scale: l.scale,
				offsetX: l.offsetX,
				offsetY: l.offsetY,
				saturation: l.saturation,
				tintColor: { r: l.tintColor.r, g: l.tintColor.g, b: l.tintColor.b }
			};
			if (l.noise) {
				entry.noise = {
					strength: l.noise.strength,
					speed: l.noise.speed,
					scale: l.noise.noiseScale,
					contrast: l.noise.contrast,
					octaves: l.noise.octaves
				};
			}
			layers[this.theatreLayerKey(l.name)] = entry;
		}
		return {
			masterOpacity: this.masterOpacity,
			layers
		};
	}

	applyConfig(config: Record<string, any>): void {
		if (typeof config.masterOpacity === 'number') {
			this.setMasterOpacity(config.masterOpacity);
		}
		const layersIn = config.layers ?? {};
		for (const layer of this.layers) {
			const c = layersIn[this.theatreLayerKey(layer.name)];
			if (!c) continue;
			if (typeof c.opacity === 'number') {
				layer.opacity = c.opacity;
				layer.opacityUniform.value = c.opacity;
			}
			if (typeof c.scale === 'number') {
				layer.scale = c.scale;
				layer.scaleUniform.value = c.scale;
			}
			if (typeof c.offsetX === 'number') {
				layer.offsetX = c.offsetX;
				(layer.offsetUniform.value as THREE.Vector2).x = c.offsetX;
			}
			if (typeof c.offsetY === 'number') {
				layer.offsetY = c.offsetY;
				(layer.offsetUniform.value as THREE.Vector2).y = c.offsetY;
			}
			if (typeof c.saturation === 'number') {
				layer.saturation = c.saturation;
				layer.saturationUniform.value = c.saturation;
			}
			const t = c.tintColor;
			if (t && typeof t.r === 'number' && typeof t.g === 'number' && typeof t.b === 'number') {
				layer.tintColor.setRGB(t.r, t.g, t.b);
				(layer.tintUniform.value as THREE.Vector3).set(t.r, t.g, t.b);
			}
			if (layer.noise && c.noise) {
				const n = c.noise;
				if (typeof n.strength === 'number') {
					layer.noise.strength = n.strength;
					layer.noise.strengthUniform.value = n.strength;
				}
				if (typeof n.speed === 'number') {
					layer.noise.speed = n.speed;
					layer.noise.speedUniform.value = n.speed;
				}
				if (typeof n.scale === 'number') {
					layer.noise.noiseScale = n.scale;
					layer.noise.noiseScaleUniform.value = n.scale;
				}
				if (typeof n.contrast === 'number') {
					layer.noise.contrast = n.contrast;
					layer.noise.contrastUniform.value = n.contrast;
				}
				if (typeof n.octaves === 'number') {
					const clamped = Math.max(0, Math.min(NOISE_OCTAVES_MAX, n.octaves));
					layer.noise.octaves = clamped;
					layer.noise.octavesUniform.value = clamped;
				}
			}
		}
	}

	setupInspectorControls(inspectorInstance: any): any {
		const gui = inspectorInstance.createParameters('Dao Fog');
		gui.close();

		const masterObj = { masterOpacity: this.masterOpacity };
		gui
			.add(masterObj, 'masterOpacity', 0, 1, 0.01)
			.name('Master Opacity')
			.onChange((v: number) => this.setMasterOpacity(v));

		for (const layer of this.layers) {
			const folder = gui.addFolder(layer.name);
			const layerProxy = {
				opacity: layer.opacity,
				scale: layer.scale,
				offsetX: layer.offsetX,
				offsetY: layer.offsetY,
				saturation: layer.saturation,
				blending: layer.blending,
				tint: '#' + layer.tintColor.getHexString()
			};

			folder
				.add(layerProxy, 'opacity', 0, 1, 0.01)
				.name('Opacity')
				.onChange((v: number) => {
					layer.opacity = v;
					layer.opacityUniform.value = v;
				});
			folder
				.add(layerProxy, 'scale', 0.1, 5, 0.01)
				.name('Scale')
				.onChange((v: number) => {
					layer.scale = v;
					layer.scaleUniform.value = v;
				});
			folder
				.add(layerProxy, 'offsetX', -1, 1, 0.01)
				.name('Offset X')
				.onChange((v: number) => {
					layer.offsetX = v;
					(layer.offsetUniform.value as THREE.Vector2).x = v;
				});
			folder
				.add(layerProxy, 'offsetY', -1, 1, 0.01)
				.name('Offset Y')
				.onChange((v: number) => {
					layer.offsetY = v;
					(layer.offsetUniform.value as THREE.Vector2).y = v;
				});
			folder
				.add(layerProxy, 'blending', BLENDING_OPTIONS)
				.name('Blending')
				.onChange((v: DaoBlendName) => {
					layer.blending = v;
					// Blend mode is sampled at graph build time; trigger a rebuild
					// through the renderer's overlay-compositor mechanism externally
					// if you toggle at runtime. (No automatic rebuild here to avoid
					// coupling DaoFog to the renderer instance.)
				});
			folder
				.addColor(layerProxy, 'tint')
				.name('Tint')
				.onChange((v: string) => {
					const c = new THREE.Color(v);
					layer.tintColor.copy(c);
					(layer.tintUniform.value as THREE.Vector3).set(c.r, c.g, c.b);
				});
			folder
				.add(layerProxy, 'saturation', 0, 1, 0.01)
				.name('Saturation')
				.onChange((v: number) => {
					layer.saturation = v;
					layer.saturationUniform.value = v;
				});

			if (layer.noise) {
				const noise = layer.noise;
				const noiseProxy = {
					strength: noise.strength,
					speed: noise.speed,
					noiseScale: noise.noiseScale,
					contrast: noise.contrast,
					octaves: noise.octaves
				};
				folder
					.add(noiseProxy, 'strength', 0, 1, 0.01)
					.name('Noise Strength')
					.onChange((v: number) => {
						noise.strength = v;
						noise.strengthUniform.value = v;
					});
				folder
					.add(noiseProxy, 'speed', 0, 2, 0.01)
					.name('Noise Speed')
					.onChange((v: number) => {
						noise.speed = v;
						noise.speedUniform.value = v;
					});
				folder
					.add(noiseProxy, 'noiseScale', 0.1, 20, 0.1)
					.name('Noise Scale')
					.onChange((v: number) => {
						noise.noiseScale = v;
						noise.noiseScaleUniform.value = v;
					});
				folder
					.add(noiseProxy, 'contrast', 0.1, 4, 0.01)
					.name('Noise Contrast')
					.onChange((v: number) => {
						noise.contrast = v;
						noise.contrastUniform.value = v;
					});
				folder
					.add(noiseProxy, 'octaves', 0, NOISE_OCTAVES_MAX, 0.01)
					.name('Noise Octaves')
					.onChange((v: number) => {
						const clamped = Math.max(0, Math.min(NOISE_OCTAVES_MAX, v));
						noise.octaves = clamped;
						noise.octavesUniform.value = clamped;
					});
			}

			folder.close();
		}

		return gui;
	}

	dispose(): void {
		for (const layer of this.layers) {
			if (layer.ownsTexture) {
				layer.tex.dispose();
			}
		}
		this.layers.length = 0;
		this.fogRttNode?.renderTarget?.dispose();
		this.fogRttNode = null;
	}
}
