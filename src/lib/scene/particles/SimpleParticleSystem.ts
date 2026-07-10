import * as THREE from 'three/webgpu';
import { instancedArray, uniformArray } from 'three/tsl';

import { BaseParticleSystem, type BaseParticleOptions } from './BaseParticleSystem';
import { SharedMaterials } from '../materials/SharedMaterials';
import { acquireUnitQuadGeometry } from './SharedGeometries';

interface MeshData {
	mesh: THREE.Mesh;
	matrixSlot: number;
}

/**
 * SimpleParticleSystem - A lightweight particle system without physics
 *
 * Converts source-mesh vertices into billboarded sprite particles. Per-frame work is
 * O(meshCount), not O(particleCount): the vertex shader does `meshMatrix × localPos`,
 * so we only push ~5–50 mat4s into a uniform array each frame instead of re-uploading
 * tens of thousands of world positions.
 *
 * Source-mesh vertex data is static after init; only each source mesh's `matrixWorld`
 * changes per frame (driven by Theatre / ModelRotationController). No skinning/morphs.
 */
export class SimpleParticleSystem extends BaseParticleSystem {
	private static readonly _tempScale = new THREE.Vector3();
	private static readonly MIN_VISIBLE_SCALE = 0.001;

	// Hidden matrix: zero scale collapses every local position to the translation,
	// (1e6, 1e6, 1e6) is well outside any plausible camera reach but stays inside
	// float32's precise integer range so downstream subtractions don't lose precision.
	private static readonly HIDDEN_MATRIX = new THREE.Matrix4()
		.makeScale(0, 0, 0)
		.setPosition(1e6, 1e6, 1e6);

	private meshDataList: MeshData[] = [];
	private meshMatrices: THREE.Matrix4[] = [];

	constructor() {
		super();
	}

	/**
	 * Collect all valid meshes (with position attributes) from one or more root objects.
	 * Deduplicates and sorts by name for deterministic ordering.
	 */
	private collectSourceMeshes(roots: THREE.Object3D[]): THREE.Mesh[] {
		const seen = new Set<THREE.Mesh>();
		const sourceMeshes: THREE.Mesh[] = [];

		const addMesh = (mesh: THREE.Mesh) => {
			if (!seen.has(mesh) && mesh.geometry?.attributes?.position) {
				seen.add(mesh);
				sourceMeshes.push(mesh);
			}
		};

		for (const root of roots) {
			if (root instanceof THREE.Mesh) {
				addMesh(root);
			}
			root.traverse((child) => {
				if (child instanceof THREE.Mesh && child !== root) {
					addMesh(child);
				}
			});
		}

		sourceMeshes.sort((a, b) => a.name.localeCompare(b.name));
		return sourceMeshes;
	}

	/**
	 * Core initialization from pre-collected source meshes.
	 * Extracts vertex local positions (static) + per-particle mesh-index, allocates the
	 * per-mesh matrix uniform array, and builds the sprite mesh.
	 */
	private initFromSources(
		sourceMeshes: THREE.Mesh[],
		name: string,
		options: BaseParticleOptions = {}
	): void {
		const {
			particleRadius = 0.004,
			baseColor = new THREE.Color(1, 1, 1),
			emissiveIntensity = 0.8,
			emissiveThreshold = 1.0,
			emissiveFalloff = 3.0
		} = options;

		this.spriteScale = particleRadius * 2;
		this.emissiveIntensityUniform.value = emissiveIntensity;

		if (sourceMeshes.length === 0) {
			console.warn('SimpleParticleSystem: No meshes found in group');
			return;
		}

		// Collect valid local positions per mesh.
		interface MeshInitData {
			mesh: THREE.Mesh;
			validIndices: number[];
		}
		const validMeshes: MeshInitData[] = [];

		for (const mesh of sourceMeshes) {
			const positions = mesh.geometry.attributes.position;
			const count = positions.count;
			const validIndices: number[] = [];

			for (let i = 0; i < count; i++) {
				const x = positions.getX(i);
				const y = positions.getY(i);
				const z = positions.getZ(i);

				if (
					x === null ||
					y === null ||
					z === null ||
					x === undefined ||
					y === undefined ||
					z === undefined ||
					Number.isNaN(x) ||
					Number.isNaN(y) ||
					Number.isNaN(z)
				) {
					continue;
				}

				validIndices.push(i);
			}

			if (validIndices.length > 0) {
				validMeshes.push({ mesh, validIndices });
			}
		}

		this.particleCount = validMeshes.reduce((total, m) => total + m.validIndices.length, 0);

		if (this.particleCount === 0) {
			console.warn('SimpleParticleSystem: No valid positions found in meshes');
			return;
		}

		// Per-particle local positions (static GPU buffer, never re-uploaded).
		const localPositions = new Float32Array(this.particleCount * 3);
		// Per-particle mesh-index (which mat4 slot to multiply against in the vertex shader).
		const meshIndices = new Uint32Array(this.particleCount);

		this.meshDataList = [];
		let cursor = 0;

		for (let slot = 0; slot < validMeshes.length; slot++) {
			const { mesh, validIndices } = validMeshes[slot];
			const positions = mesh.geometry.attributes.position;

			this.meshDataList.push({ mesh, matrixSlot: slot });

			for (let i = 0; i < validIndices.length; i++) {
				const srcIdx = validIndices[i];
				localPositions[(cursor + i) * 3 + 0] = positions.getX(srcIdx);
				localPositions[(cursor + i) * 3 + 1] = positions.getY(srcIdx);
				localPositions[(cursor + i) * 3 + 2] = positions.getZ(srcIdx);
				meshIndices[cursor + i] = slot;
			}

			cursor += validIndices.length;
		}

		// Pre-seed mat4 array from current source-mesh world matrices so the FIRST render
		// shows particles in the right place even before updateTransforms() runs.
		this.meshMatrices = this.meshDataList.map(({ mesh }) => {
			mesh.updateMatrixWorld(true);
			return new THREE.Matrix4().copy(mesh.matrixWorld);
		});

		const localPositionsNode = instancedArray(localPositions, 'vec3');
		const meshIndicesNode = instancedArray(meshIndices, 'uint');
		const meshMatricesNode = uniformArray(this.meshMatrices, 'mat4');

		const geometry = acquireUnitQuadGeometry();

		const material = SharedMaterials.createParticleMaterial({
			baseColor,
			emissiveIntensity,
			emissiveThreshold,
			emissiveFalloff,
			position: {
				kind: 'transformed-multi',
				localPositions: localPositionsNode,
				meshIndices: meshIndicesNode,
				meshMatrices: meshMatricesNode
			},
			useVelocityShading: false,
			opacityUniform: this.opacityUniform,
			spriteScale: this.spriteScale
		});

		this.emissiveIntensityUniform = material.userData.emissiveIntensityUniform;
		this.opacityUniform = material.userData.opacityUniform;

		this.mesh = new THREE.Mesh(geometry, material);
		this.mesh.count = this.particleCount;
		this.mesh.position.set(0, 0, 0);
		this.mesh.frustumCulled = false;
		this.mesh.name = `${name}_SimpleParticles`;
	}

	/**
	 * Initialize the particle system from a group containing meshes or a single mesh
	 */
	public initFromGroup(
		groupOrMesh: THREE.Group | THREE.Object3D,
		options: BaseParticleOptions = {}
	): void {
		const sourceMeshes = this.collectSourceMeshes([groupOrMesh]);
		this.initFromSources(sourceMeshes, groupOrMesh.name || 'Group', options);
	}

	/**
	 * Initialize from multiple groups, merging all meshes into a single particle system.
	 * Reduces draw calls by consolidating N groups into one sprite mesh.
	 */
	public initFromGroups(
		groups: THREE.Object3D[],
		name: string,
		options: BaseParticleOptions = {}
	): void {
		const sourceMeshes = this.collectSourceMeshes(groups);
		this.initFromSources(sourceMeshes, name, options);
	}

	/**
	 * Refresh per-mesh world matrices. The vertex shader does the matrix×local multiply,
	 * so we only push meshCount mat4s per frame, not particleCount vec3s. Source meshes
	 * whose scale collapses get a "hidden matrix" (zero scale, translation far from camera)
	 * so all their particles project to the same off-screen point.
	 */
	public override updateTransforms(): void {
		if (this.meshDataList.length === 0) return;

		const tempScale = SimpleParticleSystem._tempScale;

		for (let i = 0; i < this.meshDataList.length; i++) {
			const { mesh } = this.meshDataList[i];
			mesh.updateWorldMatrix(true, false);
			const matrix = mesh.matrixWorld;

			tempScale.setFromMatrixScale(matrix);
			const collapsed =
				Math.max(tempScale.x, tempScale.y, tempScale.z) < SimpleParticleSystem.MIN_VISIBLE_SCALE;

			this.meshMatrices[i].copy(collapsed ? SimpleParticleSystem.HIDDEN_MATRIX : matrix);
		}
		// `uniformArray.update()` runs automatically each render frame and uploads from
		// `this.meshMatrices` — no needsUpdate / version bump required.
	}

	/**
	 * Hide original meshes (call after setup if you want particles only)
	 */
	public hideSourceMeshes(): void {
		for (const meshData of this.meshDataList) {
			meshData.mesh.visible = false;
			meshData.mesh.castShadow = false;
		}
	}

	/**
	 * Show original meshes
	 */
	public showSourceMeshes(): void {
		for (const meshData of this.meshDataList) {
			meshData.mesh.visible = true;
		}
	}

	/**
	 * Cleanup resources
	 */
	public override dispose(): void {
		super.dispose();
		this.meshDataList = [];
		this.meshMatrices = [];
	}
}
