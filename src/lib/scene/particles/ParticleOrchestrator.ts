import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SimpleParticleSystem } from './SimpleParticleSystem';
import { PyramidInstancedParticles } from './PyramidInstancedParticles';
import { PyramidVAT } from '../animation/PyramidVAT';
import type { ModelRotationController } from '../rotation/ModelRotationController';
import { isDescendantOf, isPyramidObject } from '../composition/modelAssembly';
import { SCENE_LAYERS } from '../sceneLayers';

export interface ParticleOrchestratorFeatures {
	cubesParticles: boolean;
	pyramidParticles: boolean;
	forestParticles: boolean;
	fallbackPyramidParticles: boolean;
	pyramidVat: boolean;
	chromaticAberration: boolean;
}

export interface ParticleOrchestratorDeps {
	scene: THREE.Scene;
	isMobile: boolean;
	particleRadiusScale: number;
	features: ParticleOrchestratorFeatures;
	modelRotationController: ModelRotationController;
	gltfLoader: GLTFLoader;
}

export interface TickFlags {
	progressDirty: boolean;
	cubesDirty: boolean;
	pyramidsDirty: boolean;
	mouseShiftDirty: boolean;
}

/**
 * Owns the non-octagon particle systems (cubes, pyramids, forest, sign-tree)
 * plus the pyramid VAT mesh and the optional fallback-pyramid GLB. Wires
 * each set into the model rotation controller, applies the chromatic-
 * aberration layer when enabled, and fans out per-frame transform updates
 * along with color-inversion and disposal.
 *
 * Scene-graph groups (cubes/pyramids/forest) stay in MainScene because they
 * are consumed by Theatre, the stage dispatcher, and mouse parallax — the
 * orchestrator only owns the particle/VAT objects derived from them.
 */
export class ParticleOrchestrator {
	private cubesParticleSystem: SimpleParticleSystem | null = null;
	private pyramidParticleSystems: PyramidInstancedParticles[] = [];
	private forestParticleSystems: SimpleParticleSystem[] = [];
	private signTreeParticleSystems: SimpleParticleSystem[] = [];
	private simpleParticleSystems: SimpleParticleSystem[] = [];
	private pyramidInstancedSystems: PyramidInstancedParticles[] = [];

	private pyramidVAT: PyramidVAT | null = null;
	private pyramidVATMesh: THREE.Mesh | null = null;
	private pyramidSourceScene: THREE.Group | null = null;

	constructor(private readonly deps: ParticleOrchestratorDeps) {}

	// ── Setup ──────────────────────────────────────────────────────────────

	public setupCubes(cubesGroup: THREE.Object3D | undefined): void {
		if (!this.deps.features.cubesParticles) return;
		if (!cubesGroup) {
			console.warn('Cubes group not found in model');
			return;
		}

		this.deps.modelRotationController.attachCubesParticleSources([cubesGroup]);

		const system = new SimpleParticleSystem();
		system.initFromGroup(cubesGroup, {
			particleRadius: (this.deps.isMobile ? 0.015 : 0.007) * this.deps.particleRadiusScale,
			particleSegments: 8,
			baseColor: new THREE.Color(0.65, 0.65, 0.65),
			emissiveIntensity: this.deps.isMobile ? 0.3 : 0.4,
			emissiveThreshold: this.deps.isMobile ? 1.35 : 1.0,
			emissiveFalloff: this.deps.isMobile ? 4.5 : 3.0
		});

		cubesGroup.visible = false;

		const mesh = system.getMesh();
		if (mesh) {
			mesh.name = 'CubesParticles';
			this.deps.scene.add(mesh);
			this.enableChromaticLayer(mesh, SCENE_LAYERS.CHROMATIC_1);
			this.simpleParticleSystems.push(system);
			this.cubesParticleSystem = system;
		}
	}

	/**
	 * No-VAT path (mobile): the pyramid solids ship in the main GLB and ride the
	 * main scroll mixer. Attach the whole pyramids root to the rotation pivot
	 * BEFORE the particle-source attach in `setupPyramidsAndForest` — that way
	 * the pivot wraps solids AND particle sources, so Theatre's `pyramidsVisible`
	 * and the auto-rotation cover both coherently (with VAT, the solid mesh gets
	 * this via `attachPyramidVATMesh`). Solids also take the chromatic layer the
	 * VAT mesh would have received.
	 */
	public setupPyramidSolids(modelScene: THREE.Group): void {
		if (this.deps.features.pyramidVat) return;
		const root =
			modelScene.getObjectByName('pyramids_1') ?? modelScene.getObjectByName('Pyramids');
		if (!root) return;

		// Mixer-safe pivots: the root is animated by the main mixer, so the
		// attach()-style pivots would corrupt its animated transforms.
		this.deps.modelRotationController.attachAnimatedPyramidsRoot(root);

		root.traverse((child) => {
			if (child instanceof THREE.Mesh && !/particle/i.test(child.name)) {
				this.enableChromaticLayer(child, SCENE_LAYERS.CHROMATIC_1);
			}
		});
	}

	public setupPyramidsAndForest(modelScene: THREE.Group, includePyramidParticles = true): void {
		if (!this.deps.features.pyramidParticles && !this.deps.features.forestParticles) {
			return;
		}

		const particleGroups: THREE.Object3D[] = [];
		const processedNames = new Set<string>();

		modelScene.traverse((child) => {
			if (!child.name) return;
			if (!/particle/i.test(child.name)) return;

			let isNested = false;
			let parent = child.parent;
			while (parent) {
				if (parent.name && /particle/i.test(parent.name)) {
					isNested = true;
					break;
				}
				parent = parent.parent;
			}

			if (!isNested && !processedNames.has(child.name)) {
				particleGroups.push(child);
				processedNames.add(child.name);
			}
		});

		if (particleGroups.length === 0) return;

		const pyramidGroups: THREE.Object3D[] = [];
		const forestTreeGroups: THREE.Object3D[] = [];
		const signTreeGroups: THREE.Object3D[] = [];

		for (const group of particleGroups) {
			if (isPyramidObject(group)) {
				pyramidGroups.push(group);
			} else if (isDescendantOf(group, 'Forest')) {
				if (isDescendantOf(group, 'BIG_TREEE_1')) {
					signTreeGroups.push(group);
				} else {
					forestTreeGroups.push(group);
				}
			}
		}

		const pyramidRadiusBoost = this.deps.isMobile ? 1.8 : 1.0;
		const particleOptions = {
			particleRadius: 0.01 * this.deps.particleRadiusScale * pyramidRadiusBoost,
			particleSegments: 3,
			baseColor: new THREE.Color(0.65, 0.65, 0.65),
			emissiveIntensity: this.deps.isMobile ? 0.7 : 0.8,
			emissiveThreshold: this.deps.isMobile ? 1.6 : 1.0,
			emissiveFalloff: this.deps.isMobile ? 5.0 : 3.0
		};

		if (
			includePyramidParticles &&
			this.deps.features.pyramidParticles &&
			pyramidGroups.length > 0
		) {
			this.deps.modelRotationController.attachPyramidsParticleSources(pyramidGroups);

			const system = new PyramidInstancedParticles();
			// 3D matcap spheres have a tighter visible footprint than additive
			// sprite billboards at the same nominal radius (no soft-edge dilation),
			// so a modest bump keeps each particle ≥4 px onscreen — small enough
			// to read as discrete cells, large enough to show top/bottom matcap
			// shading. Theatre `pyramidsSize` multiplies on top.
			system.initFromGroups(pyramidGroups, 'Pyramids_SharedParticles', {
				...particleOptions,
				particleRadius: particleOptions.particleRadius * 2.25
			});
			if (this.attachPyramidSystem(system, 'Pyramids_SharedParticles', SCENE_LAYERS.CHROMATIC_1)) {
				this.pyramidParticleSystems.push(system);
			}
		}

		if (this.deps.features.forestParticles && forestTreeGroups.length > 0) {
			// Particles are kept on the sign tree (BIG_TREEE_1) plus the two
			// foreground trees nearest the camera (Small_tree, Small_tree_5). The
			// remaining forest trees render as solid meshes, so hide their
			// particle-source geometry instead of spawning a cloud for them.
			const NEAR_FOREST_TREE_NAMES = ['Small_tree', 'Small_tree_5'];
			const nearTreeGroups: THREE.Object3D[] = [];

			for (const group of forestTreeGroups) {
				if (NEAR_FOREST_TREE_NAMES.some((name) => isDescendantOf(group, name))) {
					nearTreeGroups.push(group);
					continue;
				}
				group.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						child.visible = false;
						child.castShadow = false;
					}
				});
			}

			if (nearTreeGroups.length > 0) {
				const system = new SimpleParticleSystem();
				system.initFromGroups(nearTreeGroups, 'Forest_SharedParticles', {
					...particleOptions,
					particleRadius: particleOptions.particleRadius * 0.5,
					emissiveIntensity: 0.4
				});
				system.setOpacity(0.7);
				// attachSystem hides the source meshes once the cloud is built.
				if (this.attachSystem(system, 'Forest_SharedParticles', SCENE_LAYERS.CHROMATIC_3)) {
					this.forestParticleSystems.push(system);
				}
			}
		}

		if (this.deps.features.forestParticles && signTreeGroups.length > 0) {
			const system = new SimpleParticleSystem();
			system.initFromGroups(signTreeGroups, 'SignTree_SharedParticles', {
				...particleOptions,
				particleRadius: particleOptions.particleRadius * 0.8,
				emissiveIntensity: 0.4
			});
			if (this.attachSystem(system, 'SignTree_SharedParticles', SCENE_LAYERS.CHROMATIC_3)) {
				this.signTreeParticleSystems.push(system);
			}
		}
	}

	private attachSystem(
		system: SimpleParticleSystem,
		name: string,
		chromaticLayer: number | null
	): boolean {
		const mesh = system.getMesh();
		if (!mesh) return false;
		mesh.name = name;
		this.deps.scene.add(mesh);
		if (chromaticLayer !== null) {
			this.enableChromaticLayer(mesh, chromaticLayer);
		}
		system.hideSourceMeshes();
		this.simpleParticleSystems.push(system);
		return true;
	}

	private attachPyramidSystem(
		system: PyramidInstancedParticles,
		name: string,
		chromaticLayer: number | null
	): boolean {
		const mesh = system.getMesh();
		if (!mesh) return false;
		mesh.name = name;
		this.deps.scene.add(mesh);
		if (chromaticLayer !== null) {
			this.enableChromaticLayer(mesh, chromaticLayer);
		}
		system.hideSourceMeshes();
		this.pyramidInstancedSystems.push(system);
		return true;
	}

	public async loadFallbackPyramids(
		onProgress?: (loaded: number, total: number) => void
	): Promise<void> {
		if (!this.deps.features.fallbackPyramidParticles) return;
		if (this.pyramidParticleSystems.length > 0) return;
		const sourceUrls = [`${this.pyramidAssetPrefix}_source.glb`];

		for (const url of sourceUrls) {
			try {
				const gltf = await this.deps.gltfLoader.loadAsync(url, (xhr) => {
					if (xhr.lengthComputable) onProgress?.(xhr.loaded, xhr.total);
					else if (xhr.loaded > 0) onProgress?.(xhr.loaded, 0);
				});
				const pyramidsRoot =
					gltf.scene.getObjectByName('pyramids_1') || gltf.scene.getObjectByName('Pyramids');

				if (!pyramidsRoot) {
					console.warn(`Fallback pyramid source not found in ${url}`);
					continue;
				}

				this.pyramidSourceScene = gltf.scene;
				this.deps.scene.add(gltf.scene);
				this.deps.modelRotationController.attachPyramidsSource(pyramidsRoot, gltf);

				// Source GLB is a particle/animation data provider — its meshes are
				// never rendered. VAT owns the visible solid look. Traverse only
				// `pyramidsRoot`; VAT loads in parallel and gets reparented as a
				// sibling under the rotation pivot, so a `gltf.scene` walk would
				// race into the VAT mesh and hide it.
				pyramidsRoot.traverse((child) => {
					if (!(child instanceof THREE.Mesh)) return;
					child.castShadow = false;
					child.receiveShadow = false;
					child.visible = false;
				});

				this.setupPyramidsAndForest(pyramidsRoot as THREE.Group);

				return;
			} catch (error) {
				console.warn(`Failed to load fallback pyramid particle source from ${url}`, error);
			}
		}
	}

	/** Mobile ships its own (smaller) pyramid bake from the mobile FBX; both
	 * tiers use the same `<prefix>_source|merged|vat` file naming. */
	private get pyramidAssetPrefix(): string {
		return this.deps.isMobile ? '/models/pyramids_mobile' : '/models/pyramids';
	}

	public async loadPyramidVAT(
		onProgress?: (loaded: number, total: number) => void
	): Promise<void> {
		if (!this.deps.features.pyramidVat) return;
		try {
			this.pyramidVAT = new PyramidVAT(this.deps.gltfLoader);
			const vatMesh = await this.pyramidVAT.load(
				`${this.pyramidAssetPrefix}_merged.glb`,
				`${this.pyramidAssetPrefix}_vat.bin.gz`,
				onProgress
			);

			if (vatMesh) {
				this.deps.scene.add(vatMesh);
				this.pyramidVATMesh = vatMesh;
				this.deps.modelRotationController.attachPyramidVATMesh(vatMesh);
				this.enableChromaticLayer(vatMesh, SCENE_LAYERS.CHROMATIC_1);
			}
		} catch (e) {
			console.error('PyramidVAT: Failed to load. Pyramid visuals will be missing.', e);
			this.pyramidVAT = null;
			this.pyramidVATMesh = null;
		}
	}

	/**
	 * Switch the pyramid particle clouds to ride the solid VAT (one source of
	 * truth). Keeps each cloud's spawn distribution (the remesh vertices) but
	 * carries every dot by its nearest solid object's VAT transform, so the
	 * particles morph/rotate exactly like the solid instead of following the
	 * remesh meshes' divergent animation. Must run AFTER both the VAT and the
	 * remesh source have loaded and while the remesh is still at its rest pose
	 * (MainScene calls this right after the load Promise.all).
	 */
	public attachPyramidParticlesToVat(): void {
		const vat = this.pyramidVAT;
		if (!this.deps.features.pyramidVat || !vat) return;
		if (this.pyramidParticleSystems.length === 0) return;

		// The model fades its two shapes in/out via scale and there is NO frame where
		// both are full: at rest one shape is collapsed (dots pile up → vanish) and at
		// the crossover a shape is half-scale (its matrix inverse explodes the offset →
		// dots scatter). So bind each VERTEX at the candidate frame where ITS shape is
		// most fully formed. Candidates are bake-specific hardcodes (same spirit as
		// the desktop wing-yaw correction in PyramidInstancedParticles):
		// - Desktop FBX: shape 1 displays early, shape 2 late, swapping ~0.32.
		// - Mobile bake: every displayed source mesh lives only inside ~[0.20..0.33]
		//   (outside it all sit at scale 0, so a sample there can bind nothing), and
		//   source/VAT alignment is only settled from ~0.23; the desktop list would
		//   sample the window exactly once, at 0.26. Source scale is flat across the
		//   window and the bind keeps the FIRST max-scale candidate, so the first
		//   entry does the bulk of the binding — later ones rescue objects that were
		//   near zero scale there. Bind, then restore.
		// Mobile windows (measured from the corrected pyramids_mobile_source bake):
		// shape 1 displays at progress 0.194–0.332, shape 2 at 0.306–0.462. One
		// mid-window candidate per shape binds every dot; 0.36/0.4 double-cover
		// shape 2 (offline binding sim: 23390/23390 bound, 0 unbound).
		const CANDIDATES = this.deps.isMobile
			? [0.26, 0.36, 0.4]
			: [0.1, 0.18, 0.26, 0.36, 0.4];
		const systems = this.pyramidParticleSystems.filter((s) => s.beginVatBinding(vat));
		for (const progress of CANDIDATES) {
			this.deps.modelRotationController.posePyramidSourceAt(progress);
			vat.setProgress(progress);
			for (const system of systems) system.sampleVatBindingFrame();
		}
		for (const system of systems) system.finalizeVatBinding();

		this.deps.modelRotationController.posePyramidSourceAt(0);
		vat.setProgress(0);
	}

	/**
	 * Enable a per-scene chromatic-aberration layer on a mesh hierarchy. Public
	 * so MainScene's octagon setup can route through the same implementation.
	 * Caller picks the CHROMATIC_X layer for the scene the mesh belongs to —
	 * a single shared CA layer would leak Scene 1 content into Scene 2's CA
	 * composition.
	 */
	public enableChromaticLayer(root: THREE.Object3D, layer: number): void {
		if (!this.deps.features.chromaticAberration) return;
		root.traverse((child) => {
			if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
				child.layers.enable(layer);
			}
		});
	}

	// ── Per-frame ──────────────────────────────────────────────────────────

	public tickTransforms(flags: TickFlags): void {
		const { progressDirty, cubesDirty, pyramidsDirty, mouseShiftDirty } = flags;

		if (progressDirty || cubesDirty || mouseShiftDirty) {
			if (this.cubesParticleSystem?.isVisible()) {
				this.cubesParticleSystem.updateTransforms();
			}
		}

		if (progressDirty || pyramidsDirty || mouseShiftDirty) {
			for (const system of this.pyramidParticleSystems) {
				if (system.isVisible()) system.updateTransforms();
			}
		}

		if (progressDirty || mouseShiftDirty) {
			for (const system of this.forestParticleSystems) {
				if (system.isVisible()) system.updateTransforms();
			}
			for (const system of this.signTreeParticleSystems) {
				if (system.isVisible()) system.updateTransforms();
			}
		}
	}

	public setColorInversion(inverted: boolean): void {
		// Pyramid particles are matcap-shaded and share their material with the
		// pillar mesh — they intentionally opt out of scene inversion.
		this.cubesParticleSystem?.setColorInversion(inverted);
		for (const s of this.forestParticleSystems) s.setColorInversion(inverted);
		for (const s of this.signTreeParticleSystems) s.setColorInversion(inverted);
	}

	// ── Accessors ──────────────────────────────────────────────────────────

	public getCubes(): SimpleParticleSystem | null {
		return this.cubesParticleSystem;
	}

	public getPyramidSystems(): PyramidInstancedParticles[] {
		return this.pyramidParticleSystems;
	}

	public getForestSystems(): SimpleParticleSystem[] {
		return this.forestParticleSystems;
	}

	public getSignTreeSystems(): SimpleParticleSystem[] {
		return this.signTreeParticleSystems;
	}

	public getPyramidVAT(): PyramidVAT | null {
		return this.pyramidVAT;
	}

	public getPyramidVATMesh(): THREE.Mesh | null {
		return this.pyramidVATMesh;
	}

	public hasPyramidParticles(): boolean {
		return this.pyramidParticleSystems.length > 0;
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	public dispose(): void {
		if (this.pyramidVAT) {
			this.pyramidVAT.dispose();
			this.pyramidVAT = null;
		}
		this.pyramidVATMesh = null;
		if (this.pyramidSourceScene) {
			this.deps.scene.remove(this.pyramidSourceScene);
			this.pyramidSourceScene = null;
		}

		for (const system of this.simpleParticleSystems) {
			system.dispose();
		}
		for (const system of this.pyramidInstancedSystems) {
			system.dispose();
		}
		this.simpleParticleSystems = [];
		this.pyramidInstancedSystems = [];
		this.cubesParticleSystem = null;
		this.pyramidParticleSystems = [];
		this.forestParticleSystems = [];
		this.signTreeParticleSystems = [];
	}
}
