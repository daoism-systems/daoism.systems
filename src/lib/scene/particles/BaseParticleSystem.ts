import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { SpriteNodeMaterial } from 'three/webgpu';
import { releaseSharedGeometry } from './SharedGeometries';

/**
 * Base options shared by all particle systems
 */
export interface BaseParticleOptions {
	particleRadius?: number;
	particleSegments?: number;
	baseColor?: THREE.Color;
	emissiveIntensity?: number;
	emissiveThreshold?: number;
	emissiveFalloff?: number;
}

/**
 * BaseParticleSystem - Abstract base class for particle systems
 *
 * Provides shared functionality for:
 * - Sprite mesh management (PlaneGeometry + SpriteNodeMaterial)
 * - Opacity control
 * - Resource disposal
 *
 * Subclasses implement:
 * - initFromGroup() - Initialize from source meshes
 * - updateTransforms() - Update particle positions each frame
 * - hideSourceMeshes() / showSourceMeshes() - Control source mesh visibility
 */
export abstract class BaseParticleSystem {
	protected mesh: THREE.Mesh | null = null;
	protected particleCount: number = 0;

	// Group-visibility gate, independent of opacity. The Theatre `Visibility`
	// object toggles whole forest sub-groups (main tree / other trees); the
	// matching particle cloud lives on the scene root (not under the Forest
	// group), so `group.visible` can't reach it. This gate lets the visibility
	// writer hide/show the cloud without fighting the opacity writer:
	// mesh.visible = gate AND opacity>0, so neither re-shows what the other hid.
	private visibilityGate = true;

	// Material uniforms
	protected emissiveIntensityUniform: ReturnType<typeof uniform<number>>;
	protected opacityUniform: ReturnType<typeof uniform<number>>;

	// Sprite scale (diameter in world units)
	protected spriteScale: number = 0.5;
	private spriteScaleMultiplier = 1;
	private transitionSpriteScaleMultiplier = 1;

	// Inversion override: when `colorInverted` is on, the material renders as
	// flat black sprites with zero emissive over standard alpha-blended white
	// bg — no glow into the bloom MRT, no chromatic source for the post-FX
	// chain to scatter. Artist keyframes for color and emissive intensity are
	// snapshot-only while inverted; the originals are restored on de-invert.
	//
	// Stronger than a "two-layer complement" model — the user wants a clean
	// black silhouette at the inverted step rather than a faithful negative
	// of the additive emissive look.
	private artistColor: number = 0xffffff;
	private artistEmissive: number = 0.8;
	private colorInverted: boolean = false;

	// Pooled objects for transform calculations (avoid GC pressure)
	protected static readonly _tempVec = new THREE.Vector3();
	protected static readonly _tempMatrix = new THREE.Matrix4();

	constructor() {
		this.emissiveIntensityUniform = uniform(0.8);
		this.opacityUniform = uniform(1.0);
	}

	/**
	 * Initialize the particle system from a group or mesh
	 */
	public abstract initFromGroup(
		groupOrMesh: THREE.Group | THREE.Object3D,
		options: BaseParticleOptions
	): void;

	/**
	 * Update particle positions from animated source meshes
	 * Default no-op; override in subclasses that need per-frame updates
	 */
	public updateTransforms(): void {}

	/**
	 * Hide original source meshes (call after setup if you want particles only)
	 */
	public abstract hideSourceMeshes(): void;

	/**
	 * Show original source meshes
	 */
	public abstract showSourceMeshes(): void;

	/**
	 * Set the opacity of all particles (0-1)
	 * Also toggles mesh.visible so the GPU skips draw calls when fully transparent
	 */
	public setOpacity(opacity: number): void {
		const clamped = Math.max(0, Math.min(1, opacity));
		if (this.opacityUniform.value === clamped) return;
		this.opacityUniform.value = clamped;
		this.syncMeshVisibility();
	}

	/**
	 * Set the group-visibility gate (see `visibilityGate`). Combined with the
	 * current opacity to decide whether the cloud draws.
	 */
	public setVisibilityGate(visible: boolean): void {
		if (this.visibilityGate === visible) return;
		this.visibilityGate = visible;
		this.syncMeshVisibility();
	}

	private syncMeshVisibility(): void {
		if (this.mesh) {
			this.mesh.visible = this.visibilityGate && this.opacityUniform.value > 0;
		}
	}

	/**
	 * Get the current opacity value
	 */
	public getOpacity(): number {
		return this.opacityUniform.value;
	}

	public setBaseColor(hex: number): void {
		this.artistColor = hex & 0xffffff;
		this.applyInversionState();
	}

	public getBaseColor(): number {
		return this.artistColor;
	}

	/**
	 * Toggle scene-inversion mode for this particle system. When enabled, the
	 * material renders as a flat black sprite with no emissive contribution
	 * (so it stays out of the bloom MRT and the chromatic-aberration source).
	 * On de-invert the artist's color, emissive, and original blending mode
	 * are all restored.
	 */
	public setColorInversion(inverted: boolean): void {
		if (this.colorInverted === inverted) return;
		this.colorInverted = inverted;
		this.applyInversionState();
	}

	public setEmissiveIntensity(intensity: number): void {
		this.artistEmissive = intensity;
		this.applyInversionState();
	}

	public getEmissiveIntensity(): number {
		return this.artistEmissive;
	}

	private applyInversionState(): void {
		const material = this.mesh?.material as any;
		if (!material) return;
		const ud = material.userData;
		const colorUniform = ud?.colorUniform;
		if (!colorUniform) return;

		// Snapshot the construction-time blend mode the first time we touch it
		// so we can restore exactly on de-invert without duplicating the value
		// at every material factory.
		if (ud.originalBlending == null) {
			ud.originalBlending = material.blending;
		}

		// Octagon fluid sprites compose color from multiple uniforms — the
		// per-pixel light contribution (`lightColorUniform`) and speed tint
		// (`speedColorUniform`) bypass `emissiveIntensity`, so zeroing emissive
		// alone leaves them lit. Snapshot all three on first invert so we can
		// fully blacken the source and restore exactly on de-invert.
		const lightColorUniform = ud.lightColorUniform;
		const speedColorUniform = ud.speedColorUniform;
		// Octagon fluid sprites also tint their emissive/bloom output via
		// `emissiveColorUniform`. It tracks the artist color exactly like
		// `colorUniform` (no snapshot needed): zeroed while inverted so the source
		// stays black, recomputed from `artistColor` on de-invert.
		const emissiveColorUniform = ud.emissiveColorUniform;
		const snapshotVec3 = (u: any) =>
			u ? { x: u.value.x, y: u.value.y, z: u.value.z } : null;
		const writeVec3 = (u: any, snap: { x: number; y: number; z: number } | null) => {
			if (u && snap) u.value.set(snap.x, snap.y, snap.z);
		};

		if (this.colorInverted) {
			if (!ud._inversionSnapshot) {
				ud._inversionSnapshot = {
					light: snapshotVec3(lightColorUniform),
					speed: snapshotVec3(speedColorUniform)
				};
			}

			// Additive sprites can't render dark on a white bg (`0 + dst = dst`),
			// so swap to standard alpha blending. Non-additive sources already
			// alpha-blend correctly.
			if (ud.originalBlending === THREE.AdditiveBlending) {
				material.blending = THREE.NormalBlending;
			}
			colorUniform.value.set(0, 0, 0);
			emissiveColorUniform?.value?.set(0, 0, 0);
			lightColorUniform?.value?.set(0, 0, 0);
			speedColorUniform?.value?.set(0, 0, 0);
			this.emissiveIntensityUniform.value = 0;
		} else {
			material.blending = ud.originalBlending;
			const r = ((this.artistColor >> 16) & 0xff) / 255;
			const g = ((this.artistColor >> 8) & 0xff) / 255;
			const b = (this.artistColor & 0xff) / 255;
			colorUniform.value.set(r, g, b);
			emissiveColorUniform?.value?.set(r, g, b);
			this.emissiveIntensityUniform.value = this.artistEmissive;

			if (ud._inversionSnapshot) {
				writeVec3(lightColorUniform, ud._inversionSnapshot.light);
				writeVec3(speedColorUniform, ud._inversionSnapshot.speed);
				ud._inversionSnapshot = null;
			}
		}
	}

	public setSpriteScaleMultiplier(multiplier: number): void {
		this.spriteScaleMultiplier = multiplier;
		this.applySpriteScale();
	}

	public setTransitionSpriteScaleMultiplier(multiplier: number): void {
		this.transitionSpriteScaleMultiplier = multiplier;
		this.applySpriteScale();
	}

	private applySpriteScale(): void {
		const u = (this.mesh?.material as any)?.userData?.spriteScaleUniform;
		if (!u) return;
		u.value = this.spriteScale * this.spriteScaleMultiplier * this.transitionSpriteScaleMultiplier;
	}

	/**
	 * Check if the particle system is currently visible (opacity > 0)
	 * Used to skip expensive per-frame updates for invisible systems
	 */
	public isVisible(): boolean {
		return this.opacityUniform.value > 0;
	}

	/**
	 * Get the mesh to add to scene
	 */
	public getMesh(): THREE.Mesh | null {
		return this.mesh;
	}

	/**
	 * Get particle count
	 */
	public getParticleCount(): number {
		return this.particleCount;
	}

	/**
	 * Get configuration for export
	 */

	public setupInspectorControls(parentFolder: any): void {
		const mesh = this.mesh;
		if (!mesh) return;

		const material = mesh.material as any;

		const colorUniform = material.userData?.colorUniform;
		if (colorUniform) {
			const v = colorUniform.value;
			const colorObj = { color: '#' + new THREE.Color(v.x, v.y, v.z).getHexString() };
			parentFolder
				.addColor(colorObj, 'color')
				.name('Color')
				.onChange((v: string) => {
					const c = new THREE.Color(v);
					colorUniform.value.set(c.r, c.g, c.b);
				});
		}

		if (material.userData?.emissiveIntensityUniform) {
			parentFolder
				.add(material.userData.emissiveIntensityUniform, 'value', 0, 3, 0.01)
				.name('Emissive Intensity');
		}

		if (material.userData?.edgeSoftnessUniform) {
			parentFolder
				.add(material.userData.edgeSoftnessUniform, 'value', 0, 1, 0.01)
				.name('Edge Softness');
		}

		const opacityObj = { opacity: this.getOpacity() };
		parentFolder
			.add(opacityObj, 'opacity', 0, 1, 0.01)
			.name('Opacity')
			.onChange((v: number) => this.setOpacity(v));
	}

	/**
	 * Cleanup resources
	 */
	public dispose(): void {
		if (this.mesh) {
			if (!releaseSharedGeometry(this.mesh.geometry)) {
				this.mesh.geometry.dispose();
			}
			if (this.mesh.material instanceof THREE.Material) {
				this.mesh.material.dispose();
			}
			this.mesh = null;
		}

		this.particleCount = 0;
	}
}
