import * as THREE from 'three/webgpu';
import {
	vec2,
	vec3,
	vec4,
	Fn,
	time,
	uniform,
	uniformArray,
	positionLocal,
	positionView,
	positionViewDirection,
	materialColor,
	normalView,
	instanceIndex,
	smoothstep,
	mix,
	pow,
	float,
	instancedArray,
	sin,
	color,
	clamp,
	dot,
	length,
	max,
	abs,
	reciprocal,
	modelViewMatrix,
	cameraProjectionMatrix,
	screenSize,
	normalize,
	sqrt,
	uv,
	varying,
	Discard,
	pmremTexture
} from 'three/tsl';
import {
	MeshStandardNodeMaterial,
	SpriteNodeMaterial,
	PMREMGenerator,
	type StorageBufferNode,
	type UniformArrayNode
} from 'three/webgpu';
import type { Inspectable } from '../debug/Inspectable';
import { SharedTextureLoader } from './TextureCache';

/**
 * Source of per-instance world positions for `createParticleMaterial`.
 *
 * - `world`: a precomputed world-position storage buffer (used by OctagonParticleSystem,
 *   which writes positions from a compute kernel).
 * - `transformed`: static local-position buffer + a single mat4 uniform; the vertex shader
 *   does `transformMatrix × localPos` (single source mesh).
 * - `transformed-multi`: static local-position buffer + per-instance mesh-index buffer +
 *   a uniformArray of mat4s; the vertex shader picks the matrix per particle and multiplies
 *   (multiple source meshes consolidated into one draw).
 */
export type ParticlePositionSource =
	| { kind: 'world'; worldPositions: StorageBufferNode<'vec3'> }
	| {
			kind: 'transformed';
			localPositions: StorageBufferNode<'vec3'>;
			transformMatrix: ReturnType<typeof uniform>;
	  }
	| {
			kind: 'transformed-multi';
			localPositions: StorageBufferNode<'vec3'>;
			meshIndices: StorageBufferNode<'uint'>;
			meshMatrices: UniformArrayNode<'mat4'>;
	  };

export interface ParticleMaterialOptions {
	baseColor?: THREE.Color;
	emissiveIntensity?: number;
	position: ParticlePositionSource;
	velocities?: StorageBufferNode<'vec4'>;
	useVelocityShading?: boolean;
	localMousePosition?: ReturnType<typeof uniform<THREE.Vector3>>;
	influenceRadius?: ReturnType<typeof uniform>;
	opacityUniform?: ReturnType<typeof uniform>;
	/** Sprite scale — diameter in world units (default 0.5) */
	spriteScale?: number;
	/** Edge softness for radial gradient falloff 0..1 (default 0.3) */
	edgeSoftness?: number;
	/** Fog absorption factor 0..1 — darkens particles and reduces emissive to simulate thick fog coverage */
	fogAbsorption?: number;
	speedColor?: THREE.Color;
	emissiveThreshold?: number;
	emissiveFalloff?: number;
}

/**
 * Smallest on-screen diameter, in render-target pixels, that an octagon sprite is
 * allowed to shrink to. Below ~1px a quad is shaded once at whatever pixel center
 * it happens to land on, so the octagon's regular vertex lattice beats against the
 * pixel grid into moiré — worst on mobile, which renders at 0.75× CSS pixels with
 * devicePixelRatio pinned to 1. Sprites at or above this size are untouched.
 */
const MIN_SPRITE_PIXELS = 1.5;

/**
 * Options for the octagon fluid sprite material — per-sprite shaded sphere with
 * directional lighting, distance-fade base color, speed-driven tint and
 * speed-driven emissive output (feeds the MRT bloom pass).
 */
export interface OctagonFluidParticleMaterialOptions {
	baseColor?: THREE.Color;
	lightColor?: THREE.Color;
	speedColor?: THREE.Color;
	lightPosition?: THREE.Vector3;
	lightIntensity?: number;
	specularPower?: number;
	maxLightDistance?: number;
	emissiveIntensity?: number;
	emissiveThreshold?: number;
	emissiveFalloff?: number;
	worldPositions: StorageBufferNode<'vec3'>;
	velocities: StorageBufferNode<'vec4'>;
	opacityUniform?: ReturnType<typeof uniform>;
	spriteScale?: number;
	fogAbsorption?: number;
}

export interface PhysicsParticleMaterialOptions {
	baseColor?: THREE.Color;
	metalness?: number;
	roughness?: number;
	emissiveIntensity?: number;
	positions: ReturnType<typeof instancedArray>;
	localMousePosition: ReturnType<typeof uniform<THREE.Vector3>>;
	influenceRadius: ReturnType<typeof uniform>;
}

export interface StaticInstancedMaterialOptions {
	baseColor?: THREE.Color;
	metalness?: number;
	roughness?: number;
	emissiveIntensity?: number;
	emissiveColor?: THREE.Color;
}

/**
 * Shared 0/1 mix that flips every rim emissive to its per-channel complement
 * when the scene is rendered in inverted-palette mode. Drives the in-shader
 * `mix(rimColor, 1 - rimColor, rimInversionMix)` so artist-keyed rim colors are
 * preserved as the source of truth — only the on-GPU presentation flips.
 */
const rimInversionMix = uniform(0);

/**
 * Exponential distance fog shared by the forest-tree + white-emissive (city)
 * materials — a controllable replacement for the removed hardcoded depth fade.
 * `factor = 1 - exp(-density · viewDist)`; each material lerps its albedo toward
 * `distanceFogColor` by `factor` and fades its rim glow out by `1 - factor` so
 * distant trees/buildings dissolve into the background and stop blooming. One
 * density/color drives both materials, exposed to Theatre + the debug inspector
 * as the "Distance Fog" controls. density 0 = no fog (independent of GroundFog).
 */
const distanceFogDensity = uniform(0.08);
const distanceFogColor = uniform(color('#0a0a0a'));

/**
 * SharedMaterials - Singleton factory for cached and reusable materials
 *
 * Provides centralized material creation to:
 * - Reduce memory allocation by reusing material templates
 * - Ensure consistent material properties across the scene
 * - Simplify material management and disposal
 */
class SharedMaterialsFactory {
	private whiteEmissiveMaterial: MeshStandardNodeMaterial | null = null;
	private baseDarkMaterial: MeshStandardNodeMaterial | null = null;
	private forestTreeMaterial: MeshStandardNodeMaterial | null = null;
	// Pyramids now follow the forest split: the solid (VAT pillars + any static
	// pyramid meshes) is a dark-metallic Fresnel-rim material, and the particle
	// spheres are white-emissive bloom dots. No envMap — the camera-tracked spot
	// is the solid's only specular source, exactly as on the trees, so the body
	// reads near-black with a glowing rim.
	private pyramidMaterial: MeshStandardNodeMaterial | null = null;
	// Procedural PMREM environment (no HDR download) so metalness/roughness have
	// something to reflect — metalness = reflection strength, roughness = blur.
	// `pyramidMaterialInstances` tracks every solid clone so envMap + intensity
	// fan out to the VAT + static meshes.
	private pyramidEnvMap: THREE.Texture | null = null;
	private readonly pyramidMaterialInstances: MeshStandardNodeMaterial[] = [];
	// Modest default: visible reflections so the knobs read, still dark-metal.
	// Set to 0 for the exact (flat) forest look.
	private pyramidEnvMapIntensity = 0.5;
	// Procedural env gradient (vertical sky→ground + soft horizon band). Exposed
	// to inspector/Theatre; changing any of these re-bakes the PMREM, so the stored
	// renderer is kept for on-demand re-bakes.
	private pyramidEnvRenderer: THREE.WebGPURenderer | null = null;
	// Persistent bake resources: the target is reused across re-bakes so the env
	// texture identity (and the materials' compiled programs) stays stable while
	// Theatre animates the gradient. See initPyramidEnvironment.
	private pyramidEnvPmrem: PMREMGenerator | null = null;
	private pyramidEnvTarget: THREE.RenderTarget | null = null;
	private pyramidEnvSrc: THREE.DataTexture | null = null;
	private readonly pyramidEnvSkyColor = new THREE.Color('#6b7a99');
	private readonly pyramidEnvGroundColor = new THREE.Color('#0a0a0a');
	private readonly pyramidEnvBandColor = new THREE.Color('#cfd6e0');
	private pyramidEnvHorizon = 0.42;
	private pyramidEnvBandWidth = 0.05;
	// Shared across pyramid solid clones (VAT needs separate instances for its
	// position/normal overrides) via uniform nodes so Theatre / inspector writes
	// propagate to every clone. Defaults match getForestTreeMaterial().
	private readonly pyramidColorUniform = uniform(color('#ffffff'));
	private readonly pyramidRoughnessUniform = uniform(0.2);
	private readonly pyramidMetalnessUniform = uniform(1);
	private readonly pyramidEmissiveIntensityUniform = uniform(0);
	// Fresnel rim glow — defaults match getForestTreeMaterial() exactly so the
	// pyramid solid reads 1:1 with the forest trees out of the box.
	private readonly pyramidRimColorUniform = uniform(vec3(0x61 / 255, 0x61 / 255, 0x61 / 255));
	private readonly pyramidRimPowerUniform = uniform(3);
	private readonly pyramidRimIntensityUniform = uniform(1.15);
	// Pyramid particle spheres (feed the bloom MRT). Emissive = color × intensity.
	private readonly pyramidParticleColorUniform = uniform(vec3(0, 0, 0));
	private readonly pyramidParticleEmissiveIntensityUniform = uniform(1.5);
	private createdMaterials: THREE.Material[] = [];

	/**
	 * Apply the shared exponential distance fog to a material: blend its albedo
	 * toward `distanceFogColor` by `factor = 1 - exp(-density · viewDist)` and
	 * return `factor` so the caller can fade its rim emissive out with
	 * `1 - factor` (distant city/trees stop blooming). `materialColor` references
	 * the live `material.color`, so the inspector base-color control is preserved.
	 * The fog is density-gated, so near-camera (hero) geometry stays crisp.
	 */
	private applyDistanceFog(material: MeshStandardNodeMaterial, baseColorNode: any = materialColor) {
		// `positionView.z.negate()` is the positive view-space distance (matches
		// GroundFog). FogExp1 form: 1 - exp(-density · dist). `baseColorNode`
		// defaults to `materialColor` (forest/city, which key material.color); the
		// pyramid passes its Theatre-driven color uniform so keyframes still apply.
		const viewDist = positionView.z.negate();
		const fogFactor = distanceFogDensity.mul(viewDist).negate().exp().oneMinus().clamp(0, 1);
		material.colorNode = mix(baseColorNode, distanceFogColor, fogFactor);
		return fogFactor;
	}

	/**
	 * Get a shared white emissive material for model meshes
	 * This material is reused across all non-particle meshes
	 */
	getWhiteEmissiveMaterial(): MeshStandardNodeMaterial {
		if (!this.whiteEmissiveMaterial) {
			const myColor = new THREE.Color('#616161');
			const rimColorUniform = uniform(vec3(myColor.r, myColor.g, myColor.b));
			const rimPowerUniform = uniform(2.4);
			const rimIntensityUniform = uniform(0.5);
			const rimPowerMaxUniform = uniform(5.48);
			const rimIntensityMaxUniform = uniform(2.92);
			const rimLoopSpeedUniform = uniform(0.8);

			this.whiteEmissiveMaterial = new MeshStandardNodeMaterial({
				color: '#696969',
				roughness: 0.3,
				metalness: 1
			});

			// Distant city / ground dissolves toward the background with distance
			// (shared control with the forest material).
			const fogFactor = this.applyDistanceFog(this.whiteEmissiveMaterial);

			this.whiteEmissiveMaterial.emissiveNode = Fn(() => {
				const n = normalView.normalize();
				const v = positionViewDirection.normalize();
				const rimBase = float(1.0).sub(n.dot(v).max(float(0.0)));
				const loopPhase = sin(time.mul(rimLoopSpeedUniform)).mul(0.5).add(0.5);
				const animatedRimPower = mix(rimPowerUniform, rimPowerMaxUniform, loopPhase);
				const animatedRimIntensity = mix(rimIntensityUniform, rimIntensityMaxUniform, loopPhase);
				const rim = pow(rimBase, animatedRimPower).mul(animatedRimIntensity);

				const effectiveRim = mix(rimColorUniform, vec3(1).sub(rimColorUniform), rimInversionMix);
				// Fade the rim glow out with distance so the far city stops blooming.
				return effectiveRim.mul(rim).mul(fogFactor.oneMinus());
			})();
			this.whiteEmissiveMaterial.userData.rimColorUniform = rimColorUniform;
			this.whiteEmissiveMaterial.userData.rimPowerUniform = rimPowerUniform;
			this.whiteEmissiveMaterial.userData.rimIntensityUniform = rimIntensityUniform;
			this.whiteEmissiveMaterial.userData.rimPowerMaxUniform = rimPowerMaxUniform;
			this.whiteEmissiveMaterial.userData.rimIntensityMaxUniform = rimIntensityMaxUniform;
			this.whiteEmissiveMaterial.userData.rimLoopSpeedUniform = rimLoopSpeedUniform;
			this.createdMaterials.push(this.whiteEmissiveMaterial);
		}
		return this.whiteEmissiveMaterial;
	}

	/**
	 * Get a shared dark material applied to all meshes by default
	 * Dark stone-like appearance with subtle emissive
	 */
	getBaseDarkMaterial(): MeshStandardNodeMaterial {
		if (!this.baseDarkMaterial) {
			this.baseDarkMaterial = new MeshStandardNodeMaterial({
				color: 0x1a1818,
				roughness: 0.75,
				metalness: 0.05,
				emissive: new THREE.Color(0x050404),
				emissiveIntensity: 0.15
			});
			this.createdMaterials.push(this.baseDarkMaterial);
		}
		return this.baseDarkMaterial;
	}

	/**
	 * Get a shared material for forest tree meshes (non-particle)
	 * Separate from whiteEmissiveMaterial for independent control
	 */
	getForestTreeMaterial(): MeshStandardNodeMaterial {
		if (!this.forestTreeMaterial) {
			const myColor = new THREE.Color('#616161');
			const rimColorUniform = uniform(vec3(myColor.r, myColor.g, myColor.b));
			const rimPowerUniform = uniform(3);
			const rimIntensityUniform = uniform(1.15);

			this.forestTreeMaterial = new MeshStandardNodeMaterial({
				color: '#fff',
				roughness: 0.2,
				metalness: 1
			});

			// Distant trees dissolve toward the background with distance (shared
			// control with the city material).
			const fogFactor = this.applyDistanceFog(this.forestTreeMaterial);

			this.forestTreeMaterial.emissiveNode = Fn(() => {
				const n = normalView.normalize();
				const v = positionViewDirection.normalize();
				const rimBase = float(1.0).sub(n.dot(v).max(float(0.0)));
				const rim = pow(rimBase, rimPowerUniform).mul(rimIntensityUniform);

				const effectiveRim = mix(rimColorUniform, vec3(1).sub(rimColorUniform), rimInversionMix);
				// Fade the rim glow out with distance so far trees stop blooming.
				return effectiveRim.mul(rim).mul(fogFactor.oneMinus());
			})();

			this.forestTreeMaterial.userData.rimColorUniform = rimColorUniform;
			this.forestTreeMaterial.userData.rimPowerUniform = rimPowerUniform;
			this.forestTreeMaterial.userData.rimIntensityUniform = rimIntensityUniform;
			this.forestTreeMaterial.userData.baseEmissiveIntensityUniform = rimIntensityUniform;
			this.createdMaterials.push(this.forestTreeMaterial);
		}
		return this.forestTreeMaterial;
	}

	/**
	 * Pyramid SOLID material — dark-metallic Fresnel rim, mirroring
	 * getForestTreeMaterial(). Shared by the VAT pillar mesh and any static
	 * pyramid meshes. Uses uniform nodes so Theatre / inspector writes propagate
	 * to every clone (the VAT needs separate instances for its position/normal
	 * overrides).
	 */
	getPyramidMaterial(): MeshStandardNodeMaterial {
		if (!this.pyramidMaterial) {
			this.pyramidMaterial = this.buildPyramidSolidMaterial();
		}
		return this.pyramidMaterial;
	}

	/**
	 * Fresh pyramid SOLID material instance for per-mesh shader nodes (the VAT's
	 * position/normal overrides). Shares the same uniform nodes as the singleton.
	 */
	createPyramidSolidMaterialClone(): MeshStandardNodeMaterial {
		return this.buildPyramidSolidMaterial();
	}

	/**
	 * Build a small procedural equirect environment (vertical sky to ground
	 * gradient plus a soft bright horizon band for reflection detail) and
	 * PMREM-blur it. No HDR download; the band is the detail that makes
	 * roughness's blur visible. Called once the WebGPU renderer exists (PMREM
	 * needs it); re-bakes on GPU recover.
	 */
	initPyramidEnvironment(renderer: THREE.WebGPURenderer): void {
		// A fresh renderer (first init or GPU recovery) invalidates every GPU
		// resource — rebuild the generator/target and rewire the materials.
		if (this.pyramidEnvRenderer !== renderer) {
			this.pyramidEnvRenderer = renderer;
			this.disposePyramidEnvResources();
		}
		this.writeProceduralEnvTexture();
		if (!this.pyramidEnvPmrem) {
			this.pyramidEnvPmrem = new PMREMGenerator(renderer);
		}
		// Bake into the SAME render target on re-bakes: the env texture identity
		// stays stable, so the materials' pmremTexture node (and their compiled
		// programs) survive. Theatre-animated gradient keyframes re-bake per frame;
		// a fresh target each bake forced a full shader recompile of every pyramid
		// material per frame — the About→Services transition FPS collapse.
		const firstBake = this.pyramidEnvTarget === null;
		this.pyramidEnvTarget = this.pyramidEnvPmrem.fromEquirectangular(
			this.pyramidEnvSrc!,
			this.pyramidEnvTarget
		);
		this.pyramidEnvMap = this.pyramidEnvTarget.texture;
		if (firstBake) {
			for (const material of this.pyramidMaterialInstances) {
				this.assignPyramidEnv(material);
			}
		}
	}

	/**
	 * Wire the baked PMREM into one pyramid material. We assign an explicit
	 * `pmremTexture()` env node rather than relying on `material.envMap` alone:
	 * the bare `envMap` path routes through a lazy material-reference wrap that
	 * produced no radiance on these heavily node-overridden VAT materials, so the
	 * reflection never rendered (even at a 275× intensity). `envMap` is still set
	 * so `materialEnvIntensity` reads `envMapIntensity` (keeps the intensity knob
	 * live); the env node is rebuilt each bake because the PMREM texture identity
	 * changes. `needsUpdate` forces the node program to recompile with the env in.
	 */
	private assignPyramidEnv(material: MeshStandardNodeMaterial): void {
		if (!this.pyramidEnvMap) return;
		material.envNode = pmremTexture(this.pyramidEnvMap);
		material.envMap = this.pyramidEnvMap;
		material.envMapIntensity = this.pyramidEnvMapIntensity;
		material.needsUpdate = true;
	}

	/** Re-bake the env from the current gradient fields, reusing the stored renderer. */
	private rebakePyramidEnvironment(): void {
		if (this.pyramidEnvRenderer) {
			this.initPyramidEnvironment(this.pyramidEnvRenderer);
		}
	}

	/**
	 * Write the current gradient fields into the persistent equirect source
	 * texture (allocated on first call, reused on every re-bake so animated env
	 * keyframes don't allocate/upload a fresh texture per frame).
	 */
	private writeProceduralEnvTexture(): void {
		const width = 256;
		const height = 128;
		if (!this.pyramidEnvSrc) {
			this.pyramidEnvSrc = new THREE.DataTexture(
				new Uint8Array(width * height * 4),
				width,
				height,
				THREE.RGBAFormat,
				THREE.UnsignedByteType
			);
			this.pyramidEnvSrc.colorSpace = THREE.SRGBColorSpace;
			this.pyramidEnvSrc.mapping = THREE.EquirectangularReflectionMapping;
		}
		const data = this.pyramidEnvSrc.image.data as Uint8Array;
		const sky = this.pyramidEnvSkyColor;
		const ground = this.pyramidEnvGroundColor;
		const band = this.pyramidEnvBandColor;
		const horizon = this.pyramidEnvHorizon; // 0 = zenith (top), 1 = nadir (bottom)
		const bandWidth = Math.max(0.001, this.pyramidEnvBandWidth);
		const c = new THREE.Color();
		for (let y = 0; y < height; y++) {
			const t = y / (height - 1);
			c.copy(sky).lerp(ground, t);
			const d = (t - horizon) / bandWidth;
			const bandAmt = Math.exp(-d * d); // soft gaussian horizon strip
			const ri = Math.round(Math.min(1, c.r + band.r * bandAmt) * 255);
			const gi = Math.round(Math.min(1, c.g + band.g * bandAmt) * 255);
			const bi = Math.round(Math.min(1, c.b + band.b * bandAmt) * 255);
			for (let x = 0; x < width; x++) {
				const i = (y * width + x) * 4;
				data[i] = ri;
				data[i + 1] = gi;
				data[i + 2] = bi;
				data[i + 3] = 255;
			}
		}
		this.pyramidEnvSrc.needsUpdate = true;
	}

	/** Drop the env bake's GPU resources (fresh renderer / factory dispose). */
	private disposePyramidEnvResources(): void {
		this.pyramidEnvPmrem?.dispose();
		this.pyramidEnvPmrem = null;
		this.pyramidEnvTarget?.dispose();
		this.pyramidEnvTarget = null;
		this.pyramidEnvSrc?.dispose();
		this.pyramidEnvSrc = null;
		this.pyramidEnvMap = null;
	}

	private applyPyramidEnvMapIntensity(): void {
		for (const material of this.pyramidMaterialInstances) {
			material.envMapIntensity = this.pyramidEnvMapIntensity;
		}
	}

	private buildPyramidSolidMaterial(): MeshStandardNodeMaterial {
		const material = new MeshStandardNodeMaterial({
			color: '#ffffff',
			roughness: 0.2,
			metalness: 1
		});

		// Distant pyramids dissolve toward the background with distance (shared
		// control with the forest + city materials). Base color is the
		// Theatre-driven uniform, not material.color, so keyframes still apply.
		const fogFactor = this.applyDistanceFog(material, this.pyramidColorUniform);
		material.roughnessNode = this.pyramidRoughnessUniform;
		material.metalnessNode = this.pyramidMetalnessUniform;

		material.emissiveNode = Fn(() => {
			// normalView (post-normalNode since r177) so the VAT's animated normalNode
			// drives the rim on the morphing pillars; it falls back to the geometry
			// normal on static pyramid meshes that don't override it.
			const n = normalView.normalize();
			const v = positionViewDirection.normalize();
			const rimBase = float(1.0).sub(n.dot(v).max(float(0.0)));
			const rim = pow(rimBase, this.pyramidRimPowerUniform).mul(this.pyramidRimIntensityUniform);

			const rimColor = this.pyramidRimColorUniform;
			const effectiveRim = mix(rimColor, vec3(1).sub(rimColor), rimInversionMix);
			// Fade the rim out with distance so far pyramids stop blooming, then add
			// the optional flat emissive (default 0) on top. The visible "reflections"
			// (specular highlights) come from the scene spotlight via the PBR
			// metalness/roughness — identical to the forest trees.
			return effectiveRim
				.mul(rim)
				.mul(fogFactor.oneMinus())
				.add(vec3(this.pyramidEmissiveIntensityUniform));
		})();

		material.userData.colorUniform = this.pyramidColorUniform;
		material.userData.roughnessUniform = this.pyramidRoughnessUniform;
		material.userData.metalnessUniform = this.pyramidMetalnessUniform;
		material.userData.emissiveIntensityUniform = this.pyramidEmissiveIntensityUniform;
		material.userData.rimColorUniform = this.pyramidRimColorUniform;
		material.userData.rimPowerUniform = this.pyramidRimPowerUniform;
		material.userData.rimIntensityUniform = this.pyramidRimIntensityUniform;
		// Procedural environment so metalness (reflection amount) + roughness
		// (reflection blur) actually do something. Assigned now if the PMREM is
		// already baked; otherwise initPyramidEnvironment() fans it out later.
		this.pyramidMaterialInstances.push(material);
		this.assignPyramidEnv(material);
		this.createdMaterials.push(material);
		return material;
	}

	/**
	 * Fresh pyramid PARTICLE material — white-emissive bloom spheres, the pyramid
	 * analogue of the forest's white-emissive particles. The instanced sphere
	 * geometry + VAT-ride positionNode are owned by PyramidInstancedParticles;
	 * here we only define the shaded output. The emissive feeds the bloom MRT.
	 * Each system gets its own clone (it sets a per-mesh positionNode), but the
	 * color/intensity uniforms are shared so one inspector write drives them all.
	 */
	createPyramidParticleMaterial(): MeshStandardNodeMaterial {
		const material = new MeshStandardNodeMaterial({
			color: '#000000',
			roughness: 1,
			metalness: 0
		});
		const emissive = this.pyramidParticleColorUniform.mul(
			this.pyramidParticleEmissiveIntensityUniform
		);
		material.colorNode = emissive;
		material.emissiveNode = emissive;
		material.userData.colorUniform = this.pyramidParticleColorUniform;
		material.userData.emissiveIntensityUniform = this.pyramidParticleEmissiveIntensityUniform;
		this.createdMaterials.push(material);
		return material;
	}

	/**
	 * Create a particle sprite material with world positions and optional mouse interaction
	 *
	 * Each particle system needs its own material instance due to unique position arrays,
	 * but the shader structure is standardized here
	 */
	createParticleMaterial(options: ParticleMaterialOptions): SpriteNodeMaterial {
		const {
			baseColor = new THREE.Color(1, 1, 1),
			emissiveIntensity = 1.0,
			position,
			velocities,
			useVelocityShading = false,
			opacityUniform: externalOpacityUniform,
			spriteScale = 1,
			edgeSoftness = 0.3,
			fogAbsorption = 0,
			speedColor = new THREE.Color('#ffffff'),
			emissiveThreshold = 1.0,
			emissiveFalloff = 3.0
		} = options;

		// When fogAbsorption > 0, darken the effective emissive so particles
		// rely more on scene lighting / shadows and appear swallowed by fog.
		const effectiveEmissive = emissiveIntensity * (1 - fogAbsorption);

		const emissiveIntensityUniform = uniform(effectiveEmissive);
		const opacityUniform = externalOpacityUniform || uniform(1.0);
		const edgeSoftnessUniform = uniform(edgeSoftness);
		const spriteScaleUniform = uniform(spriteScale);

		// Darken the visual color by fog absorption so lit areas still look correct
		// but unlit / shadow areas become much darker.
		const fogDarken = 1 - fogAbsorption * 0.6;
		const colorUniform = uniform(
			vec3(baseColor.r * fogDarken, baseColor.g * fogDarken, baseColor.b * fogDarken)
		);
		const speedColorUniform = uniform(vec3(speedColor.r, speedColor.g, speedColor.b));
		const emissiveThresholdUniform = uniform(emissiveThreshold);
		const emissiveFalloffUniform = uniform(emissiveFalloff);

		const material = new SpriteNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		});
		// Bias sprite depth toward the camera so particles sourced from a co-located
		// opaque base mesh (pyramid VAT, tree meshes) don't z-fight it. Without this,
		// individual sprites randomly fail depth test against the base mesh per frame,
		// dropping additive contributions and producing dark flicker in dense clusters.
		material.polygonOffset = true;
		material.polygonOffsetFactor = -1;
		material.polygonOffsetUnits = -1;

		// Position each instance at its world position (SpriteNodeMaterial uses world-space center).
		// `position.kind` selects how that world position is computed:
		// - 'world': read directly from a precomputed storage buffer (compute-driven systems).
		// - 'transformed': single mat4 uniform × static local-pos buffer (single source mesh).
		// - 'transformed-multi': per-particle mesh-index picks one of N mat4s × static local-pos buffer.
		switch (position.kind) {
			case 'world':
				material.positionNode = position.worldPositions.element(instanceIndex);
				break;
			case 'transformed':
				// `uniform<mat4>` lacks Node math operators in @types/three; cast to `any`
				// matches the existing pattern in this file (e.g. `opacityUniform as any`).
				material.positionNode = (position.transformMatrix as any).mul(
					vec4(position.localPositions.element(instanceIndex), 1)
				).xyz;
				break;
			case 'transformed-multi': {
				const meshIdx = position.meshIndices.element(instanceIndex);
				material.positionNode = position.meshMatrices
					.element(meshIdx)
					.mul(vec4(position.localPositions.element(instanceIndex), 1)).xyz;
				break;
			}
		}

		// Scale controls sprite size in world units
		material.scaleNode = vec2(spriteScaleUniform as any, spriteScaleUniform as any);

		if (velocities && useVelocityShading) {
			const vSpeed = varying(velocities.toAttribute().w);

			material.colorNode = Fn(() => {
				const speedTint = clamp(vSpeed.sub(1), 0, 1);
				const boostedColor = mix(colorUniform, speedColorUniform, speedTint);
				return boostedColor.mul(emissiveIntensityUniform);
			})();

			// Mirror the example material: emissive only ramps up once particle speed
			// crosses a threshold, so bloom is concentrated on actively moving particles.
			material.emissiveNode = Fn(() => {
				const speedBoost = clamp(
					vSpeed.sub(emissiveThresholdUniform).div(emissiveFalloffUniform),
					0,
					1
				);
				return speedColorUniform.mul(speedBoost).mul(emissiveIntensityUniform).mul(opacityUniform);
			})();
		} else {
			// Color output for static sprites
			material.colorNode = colorUniform.mul(emissiveIntensityUniform);
			// Emissive node feeds the MRT emissive channel used by the bloom pass
			material.emissiveNode = colorUniform.mul(emissiveIntensityUniform).mul(opacityUniform as any);
		}

		// Radial gradient opacity: soft circle via UV distance from center.
		// Alpha-test the fully transparent quad corners so auxiliary passes/MRT
		// cannot occasionally composite the full black billboard rectangle.
		const centeredUv = uv().sub(vec2(0.5));
		const radialDist = centeredUv.length().mul(2.0);
		const edgeFade = smoothstep(float(1.0), edgeSoftnessUniform, radialDist);
		material.opacityNode = edgeFade.mul(opacityUniform as any);
		material.alphaTestNode = float(0.001);

		// Store uniforms for GUI access
		material.userData.emissiveIntensityUniform = emissiveIntensityUniform;
		material.userData.opacityUniform = opacityUniform;
		material.userData.colorUniform = colorUniform;
		material.userData.speedColorUniform = speedColorUniform;
		material.userData.emissiveThresholdUniform = emissiveThresholdUniform;
		material.userData.emissiveFalloffUniform = emissiveFalloffUniform;
		material.userData.edgeSoftnessUniform = edgeSoftnessUniform;
		material.userData.spriteScaleUniform = spriteScaleUniform;

		this.createdMaterials.push(material);
		return material;
	}

	/**
	 * Create the octagon fluid sprite material.
	 *
	 * Each sprite renders as a tiny shaded sphere (per-fragment normal reconstructed
	 * from sprite UV) lit by a single directional-style light, with a distance fade
	 * to a base "fog" color and a speed tint. The emissive node outputs a speed-driven
	 * glow that the MRT pipeline picks up for bloom.
	 *
	 * Used by `OctagonParticleSystem` — the only system that runs the fluid sim.
	 */
	createOctagonFluidParticleMaterial(
		options: OctagonFluidParticleMaterialOptions
	): SpriteNodeMaterial {
		const {
			baseColor = new THREE.Color('#797979'),
			lightColor = new THREE.Color('#f8f8f8'),
			speedColor = new THREE.Color('#ffffff'),
			lightPosition = new THREE.Vector3(0.3, 0.8, 0.2),
			lightIntensity = 1,
			specularPower = 5,
			maxLightDistance = 3,
			emissiveIntensity = 2.5,
			emissiveThreshold = 1.0,
			emissiveFalloff = 3.0,
			worldPositions,
			velocities,
			opacityUniform: externalOpacityUniform,
			spriteScale = 1,
			fogAbsorption = 0
		} = options;

		const fogDarken = 1 - fogAbsorption * 0.6;
		const effectiveEmissive = emissiveIntensity * (1 - fogAbsorption);

		const colorUniform = uniform(
			vec3(baseColor.r * fogDarken, baseColor.g * fogDarken, baseColor.b * fogDarken)
		);
		// Tints the emissive/bloom output. Seeded from `baseColor` and driven by
		// `setBaseColor` alongside `colorUniform` so the user's octagon color shows
		// up in the bloom pass instead of the previous hard-coded white. No fog
		// darken here — `effectiveEmissive` already scales the glow with fog.
		const emissiveColorUniform = uniform(vec3(baseColor.r, baseColor.g, baseColor.b));
		const lightColorUniform = uniform(vec3(lightColor.r, lightColor.g, lightColor.b));
		const speedColorUniform = uniform(vec3(speedColor.r, speedColor.g, speedColor.b));
		const lightPositionUniform = uniform(lightPosition.clone());
		const lightIntensityUniform = uniform(lightIntensity);
		const specularPowerUniform = uniform(specularPower);
		const maxLightDistanceUniform = uniform(maxLightDistance);
		const emissiveIntensityUniform = uniform(effectiveEmissive);
		const emissiveThresholdUniform = uniform(emissiveThreshold);
		const emissiveFalloffUniform = uniform(emissiveFalloff);
		const opacityUniform = externalOpacityUniform || uniform(1.0);
		const spriteScaleUniform = uniform(spriteScale);

		const material = new SpriteNodeMaterial({
			transparent: true,
			depthWrite: false,
			depthTest: true,
			blending: THREE.NormalBlending
		});

		material.positionNode = worldPositions.element(instanceIndex);

		// Screen-space size floor (see MIN_SPRITE_PIXELS). `spriteGrowth` is the factor
		// needed to bring this sprite up to the floor — 1 for any sprite already at or
		// above it, so the desktop look is bit-for-bit unchanged.
		const minSpritePixelsUniform = uniform(MIN_SPRITE_PIXELS);
		const spriteGrowth = Fn(() => {
			const centerView = modelViewMatrix.mul(vec4(worldPositions.element(instanceIndex), 1.0));
			const clipCenter = cameraProjectionMatrix.mul(centerView);
			// Offset along view-space X. A perspective projection's w depends only on
			// view Z, so both points share a w and the clip-space delta is exactly the
			// sprite's projected width — no matrix element indexing needed.
			const clipEdge = cameraProjectionMatrix.mul(
				vec4(centerView.xyz.add(vec3(spriteScaleUniform as any, 0, 0)), 1.0)
			);
			// `screenSize` is the CURRENT render target's size, so a sprite is measured
			// against the buffer it actually rasterizes into, not the CSS viewport. The
			// octagon is rasterized by two passes — the scene pass and the chromatic
			// layer pass, which mobile renders at half resolution — and each one floors
			// the sprite against its own buffer. That is what keeps the CA source free
			// of the moiré, at the cost of the fringe deriving from a slightly larger
			// disc than the base image. Do not swap this for a fixed viewport size.
			const projectedWidth = abs(clipEdge.x.sub(clipCenter.x))
				.div(max(abs(clipCenter.w), float(1e-4)))
				.mul(0.5)
				.mul(screenSize.x);
			return max(float(1), minSpritePixelsUniform.div(max(projectedWidth, float(1e-4))));
		})();

		const grownSpriteScale = float(spriteScaleUniform as any).mul(spriteGrowth);
		material.scaleNode = vec2(grownSpriteScale, grownSpriteScale);

		// Per-instance varyings (broadcast to fragments via instance attribute interpolation).
		const vSpeed = varying(velocities.toAttribute().w);
		const vCenter = varying(worldPositions.toAttribute());
		// Give back the brightness the growth added: coverage scales with the disc's
		// area, so alpha and emissive both divide by growth². A sprite that was going
		// to land on a fraction of a pixel now lands on a stable 1.5px disc of
		// proportionally lower intensity instead of flickering between 0 and full.
		const vSizeFade = varying(reciprocal(spriteGrowth.mul(spriteGrowth)));

		material.colorNode = Fn(() => {
			const spriteUV = uv();
			const centered = spriteUV.sub(0.5);
			const distFromCenter = length(centered);
			Discard(distFromCenter.greaterThan(0.5));

			// Reconstruct a hemisphere normal from the sprite UV: gives every billboard
			// the appearance of a tiny shaded ball.
			const normal = vec3(centered.mul(2), 0).toVar();
			const r2 = clamp(dot(normal.xy, normal.xy), 0, 1);
			normal.z.assign(sqrt(float(1).sub(r2)));
			normal.y.assign(float(1).sub(normal.y));

			const lightDir = normalize(lightPositionUniform);
			const diff = max(dot(normal, lightDir), 0);
			const reflDir = lightDir.negate().reflect(normal);
			const viewDir = vec3(0, 0, 1);
			const spec = pow(max(reflDir.negate().dot(viewDir), 0), specularPowerUniform);
			const light = diff.add(spec).mul(lightIntensityUniform);

			// Tint the lit side by the chosen color (albedo) so the light-facing
			// hemisphere is a bright shade of the selection rather than pure white
			// light. With the default white color this is a no-op (white × light).
			const litColor = lightColorUniform.mul(colorUniform).mul(light);
			const distFromLight = length(vCenter.sub(lightPositionUniform));
			const distFade = smoothstep(0, maxLightDistanceUniform, distFromLight);
			const mixed = mix(litColor, colorUniform, distFade);

			const speedTint = clamp(vSpeed.sub(1), 0, 1);
			return mix(mixed, speedColorUniform, speedTint);
		})();

		material.emissiveNode = Fn(() => {
			const spriteUV = uv();
			const centered = spriteUV.sub(0.5);
			const distFromCenter = length(centered);
			Discard(distFromCenter.greaterThan(0.5));

			const speedBoost = clamp(
				vSpeed.sub(emissiveThresholdUniform).div(emissiveFalloffUniform),
				0,
				1
			);
			// Color follows the user's octagon selection (emissiveColorUniform);
			// speed-driven intensity (speedBoost / emissiveIntensity) is unchanged.
			// The ambient floor is tinted by the same color so a dark chosen color
			// isn't washed back toward white. The final opacity multiply is required
			// because this feeds the MRT bloom/emissive channel directly; alpha only
			// affects the color pass.
			return emissiveColorUniform
				.mul(speedBoost)
				.mul(emissiveIntensityUniform)
				.add(emissiveColorUniform.mul(emissiveIntensityUniform).mul(0.1))
				.mul(opacityUniform as any)
				.mul(vSizeFade);
		})();

		// Edge fade (radial gradient) drives the alpha so opacity fades cleanly.
		const centeredUv = uv().sub(vec2(0.5));
		const radialDist = centeredUv.length().mul(2.0);
		const edgeFade = smoothstep(float(1.0), float(0.7), radialDist);
		material.opacityNode = edgeFade.mul(opacityUniform as any).mul(vSizeFade);

		// userData exposes uniforms for the inspector + BaseParticleSystem inspector helpers.
		material.userData.emissiveIntensityUniform = emissiveIntensityUniform;
		material.userData.opacityUniform = opacityUniform;
		material.userData.colorUniform = colorUniform;
		material.userData.emissiveColorUniform = emissiveColorUniform;
		material.userData.lightColorUniform = lightColorUniform;
		material.userData.speedColorUniform = speedColorUniform;
		material.userData.lightPositionUniform = lightPositionUniform;
		material.userData.lightIntensityUniform = lightIntensityUniform;
		material.userData.specularPowerUniform = specularPowerUniform;
		material.userData.maxLightDistanceUniform = maxLightDistanceUniform;
		material.userData.emissiveThresholdUniform = emissiveThresholdUniform;
		material.userData.emissiveFalloffUniform = emissiveFalloffUniform;
		material.userData.spriteScaleUniform = spriteScaleUniform;
		material.userData.minSpritePixelsUniform = minSpritePixelsUniform;

		this.createdMaterials.push(material);
		return material;
	}

	/**
	 * Create a physics-enabled particle material with mouse interaction
	 */
	createPhysicsParticleMaterial(options: PhysicsParticleMaterialOptions): MeshStandardNodeMaterial {
		const {
			baseColor = new THREE.Color(1, 1, 1),
			metalness = 0.5,
			roughness = 0.2,
			emissiveIntensity = 1.0,
			positions,
			localMousePosition,
			influenceRadius
		} = options;

		const material = new MeshStandardNodeMaterial();
		material.color = baseColor;
		material.metalness = metalness;
		material.roughness = roughness;

		// Position each instance at its computed position
		material.positionNode = positionLocal.add(positions.element(instanceIndex));

		// Emissive with mouse proximity glow
		const emissiveIntensityUniform = uniform(emissiveIntensity);
		material.emissiveNode = Fn(() => {
			const position = positions.element(instanceIndex);
			const distToMouse = position.distance(localMousePosition);
			const mouseInfluence = smoothstep(influenceRadius, float(0), distToMouse);
			return vec3(0.25).add(mouseInfluence.mul(0.5));
		})().mul(emissiveIntensityUniform);

		// Store uniform for GUI access
		material.userData.emissiveIntensityUniform = emissiveIntensityUniform;

		this.createdMaterials.push(material);
		return material;
	}

	/**
	 * Create a smoke sprite material and register it for disposal.
	 * The caller configures TSL nodes (positionNode, scaleNode, etc.) after creation.
	 */
	createSmokeMaterial(
		options: {
			blending?: THREE.Blending;
			depthWrite?: boolean;
		} = {}
	): SpriteNodeMaterial {
		const { blending = THREE.NormalBlending, depthWrite = false } = options;

		const material = new SpriteNodeMaterial({
			transparent: true,
			depthWrite,
			blending
		});

		this.createdMaterials.push(material);
		return material;
	}

	/**
	 * Create a static instanced material without physics
	 */
	createStaticInstancedMaterial(
		options: StaticInstancedMaterialOptions = {}
	): THREE.MeshStandardMaterial {
		const {
			baseColor = new THREE.Color(1, 1, 1),
			metalness = 0.5,
			roughness = 0.2,
			emissiveIntensity = 0.2,
			emissiveColor = new THREE.Color(0xffffff)
		} = options;

		const material = new THREE.MeshStandardMaterial({
			color: baseColor,
			metalness,
			roughness,
			emissive: emissiveColor,
			emissiveIntensity
		});

		this.createdMaterials.push(material);
		return material;
	}

	private setupSingleMaterialFolder(
		parent: any,
		name: string,
		material: MeshStandardNodeMaterial
	): void {
		const folder = parent.addFolder(name);
		const ud = material.userData as any;

		folder
			.addColor({ color: `#${material.color.getHexString()}` }, 'color')
			.name('Base Color')
			.onChange((v: string) => {
				material.color.set(v);
			});

		folder.add(material, 'roughness', 0, 1, 0.01).name('Roughness');
		folder.add(material, 'metalness', 0, 1, 0.01).name('Metalness');

		// Emissive controls (uniform-based, actually affects the shader)
		if (ud?.baseEmissiveColorUniform) {
			const u = ud.baseEmissiveColorUniform;
			const emColorObj = {
				emissiveColor: `#${new THREE.Color(u.value.x, u.value.y, u.value.z).getHexString()}`
			};
			folder
				.addColor(emColorObj, 'emissiveColor')
				.name('Emissive Color')
				.onChange((v: string) => {
					const c = new THREE.Color(v);
					u.value.set(c.r, c.g, c.b);
				});
		}

		if (ud?.baseEmissiveIntensityUniform) {
			folder.add(ud.baseEmissiveIntensityUniform, 'value', 0, 5, 0.01).name('Emissive Intensity');
		}

		// Chromatic Fringe controls (white emissive)
		if (ud?.chromaticFringeStrengthUniform || ud?.chromaticFringeSpreadUniform) {
			const cfFolder = folder.addFolder('Chromatic Fringe');
			if (ud.chromaticFringeStrengthUniform) {
				cfFolder.add(ud.chromaticFringeStrengthUniform, 'value', 0, 3, 0.01).name('Strength');
			}
			if (ud.chromaticFringeSpreadUniform) {
				cfFolder.add(ud.chromaticFringeSpreadUniform, 'value', 0, 1, 0.01).name('Spread');
			}
		}

		// Rim Light controls
		const rimColorUniform = ud?.rimColorUniform;
		const rimPowerUniform = ud?.rimPowerUniform;
		const rimIntensityUniform = ud?.rimIntensityUniform;
		const rimPowerMaxUniform = ud?.rimPowerMaxUniform;
		const rimIntensityMaxUniform = ud?.rimIntensityMaxUniform;
		const rimLoopSpeedUniform = ud?.rimLoopSpeedUniform;

		if (
			rimColorUniform ||
			rimPowerUniform ||
			rimIntensityUniform ||
			rimPowerMaxUniform ||
			rimIntensityMaxUniform ||
			rimLoopSpeedUniform
		) {
			const rimFolder = folder.addFolder('Rim Light');

			if (rimColorUniform?.value) {
				const rimColorObj = {
					rimColorUniform: `#${new THREE.Color(
						rimColorUniform.value.x ?? 0,
						rimColorUniform.value.y ?? 1,
						rimColorUniform.value.z ?? 1
					).getHexString()}`
				};
				rimFolder
					.addColor(rimColorObj, 'rimColorUniform')
					.name('Color')
					.onChange((v: string) => {
						const c = new THREE.Color(v);
						if (typeof rimColorUniform.value?.set === 'function') {
							rimColorUniform.value.set(c.r, c.g, c.b);
						}
					});
			}

			if (rimPowerUniform) {
				rimFolder.add(rimPowerUniform, 'value', 0.1, 8.0, 0.01).name('Power');
			}

			if (rimIntensityUniform) {
				rimFolder.add(rimIntensityUniform, 'value', 0.0, 5.0, 0.01).name('Intensity');
			}

			if (rimPowerMaxUniform) {
				rimFolder.add(rimPowerMaxUniform, 'value', 0.1, 8.0, 0.01).name('Power Max');
			}

			if (rimIntensityMaxUniform) {
				rimFolder.add(rimIntensityMaxUniform, 'value', 0.0, 5.0, 0.01).name('Intensity Max');
			}

			if (rimLoopSpeedUniform) {
				rimFolder.add(rimLoopSpeedUniform, 'value', 0.0, 5.0, 0.01).name('Loop Speed');
			}
		}
	}

	/** Add material folders directly to a parent folder (no new top-level panel). */
	setupInspectorFolder(parentFolder: any): void {
		const sharedMat = this.whiteEmissiveMaterial;
		const forestMat = this.forestTreeMaterial;
		const pyramidMat = this.pyramidMaterial;
		if (sharedMat) {
			this.setupSingleMaterialFolder(parentFolder, 'White Emissive', sharedMat);
		}
		if (pyramidMat) {
			this.setupPyramidMaterialFolder(parentFolder, 'Pyramids');
		}
		if (forestMat) {
			this.setupSingleMaterialFolder(parentFolder, 'Forest Trees', forestMat);
		}
		if (sharedMat || forestMat) {
			this.setupDistanceFogFolder(parentFolder);
		}
	}

	/** Shared exponential distance fog controls (forest + white-emissive city). */
	private setupDistanceFogFolder(parent: any): void {
		const folder = parent.addFolder('Distance Fog');
		folder.add(distanceFogDensity, 'value', 0, 0.5, 0.001).name('Density');
		const colorObj = {
			color: `#${new THREE.Color(
				distanceFogColor.value.x,
				distanceFogColor.value.y,
				distanceFogColor.value.z
			).getHexString()}`
		};
		folder
			.addColor(colorObj, 'color')
			.name('Color')
			.onChange((v: string) => {
				const c = new THREE.Color(v);
				distanceFogColor.value.set(c.r, c.g, c.b);
			});
	}

	setupInspectorControls(inspectorInstance: any): any {
		const sharedMat = this.whiteEmissiveMaterial;
		const forestMat = this.forestTreeMaterial;
		const pyramidMat = this.pyramidMaterial;
		if (!sharedMat && !forestMat && !pyramidMat) return null;

		const gui = inspectorInstance.createParameters('Materials');
		gui.close();
		this.setupInspectorFolder(gui);
		return gui;
	}

	private setupPyramidMaterialFolder(parent: any, name: string): void {
		const folder = parent.addFolder(name);
		const colorU = this.pyramidColorUniform;
		const roughnessU = this.pyramidRoughnessUniform;
		const metalnessU = this.pyramidMetalnessUniform;
		const emissiveU = this.pyramidEmissiveIntensityUniform;

		const colorObj = {
			color: `#${new THREE.Color(colorU.value.x, colorU.value.y, colorU.value.z).getHexString()}`
		};
		folder
			.addColor(colorObj, 'color')
			.name('Base Color')
			.onChange((v: string) => {
				const c = new THREE.Color(v);
				colorU.value.set(c.r, c.g, c.b);
			});
		folder.add(roughnessU, 'value', 0, 1, 0.01).name('Roughness');
		folder.add(metalnessU, 'value', 0, 1, 0.01).name('Metalness');
		folder.add(emissiveU, 'value', 0, 5, 0.01).name('Emissive Intensity');

		// Fresnel rim glow (same controls as the forest tree material).
		const rimColorU = this.pyramidRimColorUniform;
		const rimFolder = folder.addFolder('Rim Light');
		const rimColorObj = {
			color: `#${new THREE.Color(rimColorU.value.x, rimColorU.value.y, rimColorU.value.z).getHexString()}`
		};
		rimFolder
			.addColor(rimColorObj, 'color')
			.name('Color')
			.onChange((v: string) => {
				const c = new THREE.Color(v);
				rimColorU.value.set(c.r, c.g, c.b);
			});
		rimFolder.add(this.pyramidRimPowerUniform, 'value', 0.1, 8, 0.01).name('Power');
		rimFolder.add(this.pyramidRimIntensityUniform, 'value', 0, 5, 0.01).name('Intensity');

		// Procedural environment reflection — metalness/roughness act on this.
		// 0 = exact (flat) forest look. Colors/band shape re-bake the PMREM.
		const envFolder = folder.addFolder('Environment');
		const envProxy = {
			intensity: this.pyramidEnvMapIntensity,
			sky: `#${this.pyramidEnvSkyColor.getHexString()}`,
			ground: `#${this.pyramidEnvGroundColor.getHexString()}`,
			band: `#${this.pyramidEnvBandColor.getHexString()}`,
			horizon: this.pyramidEnvHorizon,
			bandWidth: this.pyramidEnvBandWidth
		};
		envFolder
			.add(envProxy, 'intensity', 0, 3, 0.01)
			.name('Env Intensity')
			.onChange((v: number) => {
				this.pyramidEnvMapIntensity = v;
				this.applyPyramidEnvMapIntensity();
			});
		envFolder
			.addColor(envProxy, 'sky')
			.name('Sky Color')
			.onChange((v: string) => {
				this.pyramidEnvSkyColor.set(v);
				this.rebakePyramidEnvironment();
			});
		envFolder
			.addColor(envProxy, 'ground')
			.name('Ground Color')
			.onChange((v: string) => {
				this.pyramidEnvGroundColor.set(v);
				this.rebakePyramidEnvironment();
			});
		envFolder
			.addColor(envProxy, 'band')
			.name('Horizon Color')
			.onChange((v: string) => {
				this.pyramidEnvBandColor.set(v);
				this.rebakePyramidEnvironment();
			});
		envFolder
			.add(envProxy, 'horizon', 0, 1, 0.01)
			.name('Horizon Pos')
			.onChange((v: number) => {
				this.pyramidEnvHorizon = v;
				this.rebakePyramidEnvironment();
			});
		envFolder
			.add(envProxy, 'bandWidth', 0.005, 0.5, 0.005)
			.name('Horizon Width')
			.onChange((v: number) => {
				this.pyramidEnvBandWidth = v;
				this.rebakePyramidEnvironment();
			});

		// White-emissive particle spheres.
		const partColorU = this.pyramidParticleColorUniform;
		const partFolder = folder.addFolder('Particles');
		const partColorObj = {
			color: `#${new THREE.Color(partColorU.value.x, partColorU.value.y, partColorU.value.z).getHexString()}`
		};
		partFolder
			.addColor(partColorObj, 'color')
			.name('Emissive Color')
			.onChange((v: string) => {
				const c = new THREE.Color(v);
				partColorU.value.set(c.r, c.g, c.b);
			});
		partFolder
			.add(this.pyramidParticleEmissiveIntensityUniform, 'value', 0, 5, 0.01)
			.name('Emissive Intensity');
	}

	private getVec3Hex(u: any): string | null {
		if (u?.value && typeof u.value.x === 'number') {
			return `#${new THREE.Color(u.value.x, u.value.y, u.value.z).getHexString()}`;
		}
		return null;
	}

	/**
	 * Build an Inspectable that exposes a curated set of material props
	 * (base color / roughness / metalness, optional emissive, optional rim-light
	 * uniforms) for the auto-flatten Theatre pipeline.
	 *
	 * `getConfig()` returns shapes the auto-flatten recognizes:
	 *  - hex strings (`#RRGGBB`) for `material.color` / `material.emissive`
	 *  - `{ r, g, b }` objects for vec3 rim-color uniforms
	 *  - plain numbers for scalars
	 *
	 * `applyConfig()` writes back live values; missing keys are tolerated since
	 * Theatre may pass partial values during scrub.
	 */
	private buildMaterialInspectable(
		material: MeshStandardNodeMaterial,
		manifest: {
			baseColor?: boolean;
			roughness?: boolean;
			metalness?: boolean;
			emissiveColor?: boolean;
			emissiveIntensity?: boolean;
			rim?: {
				color?: boolean;
				power?: boolean;
				intensity?: boolean;
				powerMax?: boolean;
				intensityMax?: boolean;
				loopSpeed?: boolean;
			};
		}
	): Inspectable {
		return {
			getConfig() {
				const cfg: Record<string, any> = {};
				const ud = material.userData as any;
				if (manifest.baseColor) {
					cfg.baseColor = `#${material.color.getHexString()}`;
				}
				if (manifest.roughness) cfg.roughness = material.roughness;
				if (manifest.metalness) cfg.metalness = material.metalness;
				if (manifest.emissiveColor && material.emissive) {
					cfg.emissiveColor = `#${(material.emissive as THREE.Color).getHexString()}`;
				}
				if (manifest.emissiveIntensity) {
					cfg.emissiveIntensity = material.emissiveIntensity;
				}
				if (manifest.rim) {
					if (manifest.rim.color && ud.rimColorUniform?.value) {
						const v = ud.rimColorUniform.value;
						cfg.rimColor = { r: v.x, g: v.y, b: v.z };
					}
					if (manifest.rim.power && ud.rimPowerUniform) {
						cfg.rimPower = ud.rimPowerUniform.value;
					}
					if (manifest.rim.intensity && ud.rimIntensityUniform) {
						cfg.rimIntensity = ud.rimIntensityUniform.value;
					}
					if (manifest.rim.powerMax && ud.rimPowerMaxUniform) {
						cfg.rimPowerMax = ud.rimPowerMaxUniform.value;
					}
					if (manifest.rim.intensityMax && ud.rimIntensityMaxUniform) {
						cfg.rimIntensityMax = ud.rimIntensityMaxUniform.value;
					}
					if (manifest.rim.loopSpeed && ud.rimLoopSpeedUniform) {
						cfg.rimLoopSpeed = ud.rimLoopSpeedUniform.value;
					}
				}
				return cfg;
			},
			applyConfig(cfg) {
				const ud = material.userData as any;
				if (typeof cfg.baseColor === 'string') {
					material.color.set(cfg.baseColor);
				}
				if (typeof cfg.roughness === 'number') material.roughness = cfg.roughness;
				if (typeof cfg.metalness === 'number') material.metalness = cfg.metalness;
				if (typeof cfg.emissiveColor === 'string' && material.emissive) {
					(material.emissive as THREE.Color).set(cfg.emissiveColor);
				}
				if (typeof cfg.emissiveIntensity === 'number') {
					material.emissiveIntensity = cfg.emissiveIntensity;
				}
				const rim = cfg.rimColor;
				if (rim && ud.rimColorUniform?.value?.set) {
					ud.rimColorUniform.value.set(rim.r ?? 0, rim.g ?? 0, rim.b ?? 0);
				}
				if (typeof cfg.rimPower === 'number' && ud.rimPowerUniform) {
					ud.rimPowerUniform.value = cfg.rimPower;
				}
				if (typeof cfg.rimIntensity === 'number' && ud.rimIntensityUniform) {
					ud.rimIntensityUniform.value = cfg.rimIntensity;
				}
				if (typeof cfg.rimPowerMax === 'number' && ud.rimPowerMaxUniform) {
					ud.rimPowerMaxUniform.value = cfg.rimPowerMax;
				}
				if (typeof cfg.rimIntensityMax === 'number' && ud.rimIntensityMaxUniform) {
					ud.rimIntensityMaxUniform.value = cfg.rimIntensityMax;
				}
				if (typeof cfg.rimLoopSpeed === 'number' && ud.rimLoopSpeedUniform) {
					ud.rimLoopSpeedUniform.value = cfg.rimLoopSpeed;
				}
			}
		};
	}

	/**
	 * Per-material Inspectables for the four shared MeshStandard materials.
	 * Skips any material that hasn't been instantiated yet (factory creates
	 * lazily on first `get*` call).
	 */
	getInspectables(): Map<string, Inspectable> {
		const m = new Map<string, Inspectable>();
		// Shared exponential distance fog (forest + white-emissive city materials).
		m.set('DistanceFog', {
			getConfig() {
				const c = distanceFogColor.value;
				return {
					density: distanceFogDensity.value,
					color: `#${new THREE.Color(c.x, c.y, c.z).getHexString()}`
				};
			},
			applyConfig(cfg) {
				if (typeof cfg.density === 'number') distanceFogDensity.value = cfg.density;
				if (typeof cfg.color === 'string') {
					const c = new THREE.Color(cfg.color);
					distanceFogColor.value.set(c.r, c.g, c.b);
				}
			}
		});
		if (this.whiteEmissiveMaterial) {
			m.set(
				'MaterialWhiteEmissive',
				this.buildMaterialInspectable(this.whiteEmissiveMaterial, {
					baseColor: true,
					roughness: true,
					metalness: true,
					rim: {
						color: true,
						power: true,
						intensity: true,
						powerMax: true,
						intensityMax: true,
						loopSpeed: true
					}
				})
			);
		}
		if (this.forestTreeMaterial) {
			m.set(
				'MaterialForestTree',
				this.buildMaterialInspectable(this.forestTreeMaterial, {
					baseColor: true,
					roughness: true,
					metalness: true,
					rim: { color: true, power: true, intensity: true }
				})
			);
		}
		if (this.pyramidMaterial) {
			const colorU = this.pyramidColorUniform;
			const roughnessU = this.pyramidRoughnessUniform;
			const metalnessU = this.pyramidMetalnessUniform;
			const emissiveU = this.pyramidEmissiveIntensityUniform;
			const rimColorU = this.pyramidRimColorUniform;
			const rimPowerU = this.pyramidRimPowerUniform;
			const rimIntensityU = this.pyramidRimIntensityUniform;
			const partColorU = this.pyramidParticleColorUniform;
			const partEmissiveU = this.pyramidParticleEmissiveIntensityUniform;
			const self = this;
			m.set('MaterialPyramid', {
				getConfig() {
					return {
						// Existing keys preserved so authored Theatre tracks still apply.
						baseColor: `#${new THREE.Color(colorU.value.x, colorU.value.y, colorU.value.z).getHexString()}`,
						roughness: roughnessU.value,
						metalness: metalnessU.value,
						emissiveIntensity: emissiveU.value,
						rimColor: { r: rimColorU.value.x, g: rimColorU.value.y, b: rimColorU.value.z },
						rimPower: rimPowerU.value,
						rimIntensity: rimIntensityU.value,
						envIntensity: self.pyramidEnvMapIntensity,
						envSkyColor: {
							r: self.pyramidEnvSkyColor.r,
							g: self.pyramidEnvSkyColor.g,
							b: self.pyramidEnvSkyColor.b
						},
						envGroundColor: {
							r: self.pyramidEnvGroundColor.r,
							g: self.pyramidEnvGroundColor.g,
							b: self.pyramidEnvGroundColor.b
						},
						envHorizonColor: {
							r: self.pyramidEnvBandColor.r,
							g: self.pyramidEnvBandColor.g,
							b: self.pyramidEnvBandColor.b
						},
						envHorizonPos: self.pyramidEnvHorizon,
						envHorizonWidth: self.pyramidEnvBandWidth,
						particleColor: {
							r: partColorU.value.x,
							g: partColorU.value.y,
							b: partColorU.value.z
						},
						particleEmissiveIntensity: partEmissiveU.value
					};
				},
				applyConfig(cfg) {
					if (typeof cfg.baseColor === 'string') {
						const c = new THREE.Color(cfg.baseColor);
						colorU.value.set(c.r, c.g, c.b);
					}
					if (typeof cfg.roughness === 'number') roughnessU.value = cfg.roughness;
					if (typeof cfg.metalness === 'number') metalnessU.value = cfg.metalness;
					if (typeof cfg.emissiveIntensity === 'number') {
						emissiveU.value = cfg.emissiveIntensity;
					}
					if (cfg.rimColor && typeof rimColorU.value?.set === 'function') {
						rimColorU.value.set(cfg.rimColor.r ?? 0, cfg.rimColor.g ?? 0, cfg.rimColor.b ?? 0);
					}
					if (typeof cfg.rimPower === 'number') rimPowerU.value = cfg.rimPower;
					if (typeof cfg.rimIntensity === 'number') rimIntensityU.value = cfg.rimIntensity;
					if (typeof cfg.envIntensity === 'number') {
						self.pyramidEnvMapIntensity = cfg.envIntensity;
						self.applyPyramidEnvMapIntensity();
					}
					// Gradient → only re-bake when a value actually changes, so Theatre
					// scrubbing a constant keyframe doesn't re-PMREM every frame.
					let envGradientChanged = false;
					const applyEnvColor = (col: THREE.Color, c: { r?: number; g?: number; b?: number }) => {
						const r = c.r ?? col.r;
						const g = c.g ?? col.g;
						const b = c.b ?? col.b;
						if (
							Math.abs(col.r - r) > 1e-4 ||
							Math.abs(col.g - g) > 1e-4 ||
							Math.abs(col.b - b) > 1e-4
						) {
							col.setRGB(r, g, b);
							envGradientChanged = true;
						}
					};
					if (cfg.envSkyColor) applyEnvColor(self.pyramidEnvSkyColor, cfg.envSkyColor);
					if (cfg.envGroundColor) applyEnvColor(self.pyramidEnvGroundColor, cfg.envGroundColor);
					if (cfg.envHorizonColor) applyEnvColor(self.pyramidEnvBandColor, cfg.envHorizonColor);
					if (
						typeof cfg.envHorizonPos === 'number' &&
						Math.abs(self.pyramidEnvHorizon - cfg.envHorizonPos) > 1e-4
					) {
						self.pyramidEnvHorizon = cfg.envHorizonPos;
						envGradientChanged = true;
					}
					if (
						typeof cfg.envHorizonWidth === 'number' &&
						Math.abs(self.pyramidEnvBandWidth - cfg.envHorizonWidth) > 1e-4
					) {
						self.pyramidEnvBandWidth = cfg.envHorizonWidth;
						envGradientChanged = true;
					}
					if (envGradientChanged) self.rebakePyramidEnvironment();
					if (cfg.particleColor && typeof partColorU.value?.set === 'function') {
						partColorU.value.set(
							cfg.particleColor.r ?? 0,
							cfg.particleColor.g ?? 0,
							cfg.particleColor.b ?? 0
						);
					}
					if (typeof cfg.particleEmissiveIntensity === 'number') {
						partEmissiveU.value = cfg.particleEmissiveIntensity;
					}
				}
			});
		}
		if (this.baseDarkMaterial) {
			m.set(
				'MaterialBaseDark',
				this.buildMaterialInspectable(this.baseDarkMaterial, {
					baseColor: true,
					roughness: true,
					metalness: true,
					emissiveColor: true,
					emissiveIntensity: true
				})
			);
		}
		return m;
	}

	/**
	 * Drive the shared rim-inversion mix (0 = artist palette, 1 = complement).
	 * Read by every cached rim material's `emissiveNode`, so a single write
	 * flips all rim emissives in lockstep without touching per-material uniforms.
	 */
	setRimInversion(amount: number): void {
		rimInversionMix.value = Math.max(0, Math.min(1, amount));
	}

	/**
	 * Dispose all cached materials
	 */
	dispose(): void {
		for (const material of this.createdMaterials) {
			material.dispose();
		}
		this.createdMaterials = [];
		this.whiteEmissiveMaterial = null;
		this.baseDarkMaterial = null;
		this.forestTreeMaterial = null;
		this.pyramidMaterial = null;
		this.pyramidMaterialInstances.length = 0;
		this.disposePyramidEnvResources();
	}
}

// Export singleton instance
export const SharedMaterials = new SharedMaterialsFactory();
