import * as THREE from 'three/webgpu';
import {
	Fn,
	vec3,
	int,
	uniform,
	instancedBufferAttribute,
	positionGeometry,
	clamp,
	max
} from 'three/tsl';
import type { MeshStandardNodeMaterial } from 'three/webgpu';

import { BaseParticleSystem, type BaseParticleOptions } from './BaseParticleSystem';
import { SharedMaterials } from '../materials/SharedMaterials';
import type { PyramidVAT } from '../animation/PyramidVAT';

interface ParticleSlot {
	sourceMesh: THREE.Mesh;
	localPosition: THREE.Vector3;
}

/**
 * PyramidInstancedParticles — pyramid particle system rendered as instanced
 * PBR spheres. Shares its material with the pyramid VAT pillar mesh (via
 * `SharedMaterials.getPyramidMaterial`), so any Theatre write on the
 * material updates both meshes in lockstep.
 *
 * Unlike SimpleParticleSystem (sprites, billboarded, additive blending), each
 * particle is a real 3D sphere placed in world space via `instanceMatrix`,
 * which is required for scene-lit specular shading.
 *
 * Per-frame instance matrices recompute from each source mesh's `matrixWorld`
 * only when the per-system `dirty` flag is set — callers (the orchestrator)
 * already gate this through `updateTransforms`.
 */
export class PyramidInstancedParticles extends BaseParticleSystem {
	private static readonly _tempScale = new THREE.Vector3();
	private static readonly _tempMatrix = new THREE.Matrix4();
	private static readonly _tempWorldPos = new THREE.Vector3();

	private particleSlots: ParticleSlot[] = [];
	private sourceMeshes: THREE.Mesh[] = [];
	private particleRadius = 0.01;
	private spriteScaleMultiplier = 1;
	private transitionSpriteScaleMultiplier = 1;
	private opacityValue = 1;
	private instancedMesh: THREE.InstancedMesh | null = null;
	/**
	 * Running max of source-mesh world scale = the objects' "full" scale. Used to
	 * fade each particle's radius with its source object's scale, so the cloud
	 * appears/disappears exactly as the solid VAT mesh does. (The model fades
	 * objects in/out via scale 0↔full; a hard visibility cutoff popped particles
	 * in/out a frame off from the smoothly-scaled solid.)
	 */
	private referenceScale = 0;

	// ── Ride-the-solid-VAT mode ──
	// The particle source meshes (remesh) animate on a DIFFERENT schedule than the
	// solid VAT base meshes, so mixer-driven particles drift from the solid mid-
	// morph. In this mode each particle keeps its spawn position (remesh vertex,
	// same look) but is rigidly carried by its nearest solid object's VAT transform
	// — so it morphs/rotates IDENTICALLY to the solid (one source of truth).
	//
	// The per-frame transform runs entirely on the GPU: the binding writes each
	// particle's object index + object-local offset into per-instance attributes
	// once, and the material's positionNode samples the VAT texture (same rows,
	// same progress uniform as the solid) to place every dot. CPU per-frame cost
	// is one radius-uniform write and one matrixWorld copy — the old path rebuilt
	// ~54k instance matrices up to 3× per frame (Theatre opacity + size tracks +
	// the orchestrator tick), which saturated the main thread on iOS.
	private ridingVat: PyramidVAT | null = null;
	/** Per-particle solid object index it rides (binding scratch; uploaded once). */
	private ridingObj: Int32Array | null = null;
	/** Per-particle offset in that object's VAT-local frame (binding scratch). */
	private ridingLocal: Float32Array | null = null;
	/** GPU radius = particleRadius × sprite/transition multipliers × opacity. */
	private readonly effectiveRadiusUniform = uniform(0.0);
	/** During multi-frame binding: best source-mesh scale seen per particle so far
	 *  (so each vertex is bound at the frame where its shape is most fully formed). */
	private bindBestScale: Float32Array | null = null;
	private bindVat: PyramidVAT | null = null;

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
			if (root instanceof THREE.Mesh) addMesh(root);
			root.traverse((child) => {
				if (child instanceof THREE.Mesh && child !== root) addMesh(child);
			});
		}

		sourceMeshes.sort((a, b) => a.name.localeCompare(b.name));
		return sourceMeshes;
	}

	public initFromGroup(
		groupOrMesh: THREE.Group | THREE.Object3D,
		options: BaseParticleOptions = {}
	): void {
		this.initFromSources(this.collectSourceMeshes([groupOrMesh]), options);
	}

	public initFromGroups(
		groups: THREE.Object3D[],
		name: string,
		options: BaseParticleOptions = {}
	): void {
		this.initFromSources(this.collectSourceMeshes(groups), options, name);
	}

	private initFromSources(
		sourceMeshes: THREE.Mesh[],
		options: BaseParticleOptions,
		name = 'PyramidInstancedParticles'
	): void {
		const { particleRadius = 0.01 } = options;
		this.particleRadius = particleRadius;
		this.sourceMeshes = sourceMeshes;

		if (sourceMeshes.length === 0) {
			console.warn('PyramidInstancedParticles: no meshes found in group');
			return;
		}

		const slots: ParticleSlot[] = [];
		for (const mesh of sourceMeshes) {
			const positions = mesh.geometry.attributes.position;
			for (let i = 0; i < positions.count; i++) {
				const x = positions.getX(i);
				const y = positions.getY(i);
				const z = positions.getZ(i);
				if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
				slots.push({ sourceMesh: mesh, localPosition: new THREE.Vector3(x, y, z) });
			}
		}

		this.particleSlots = slots;
		this.particleCount = slots.length;

		if (this.particleCount === 0) {
			console.warn('PyramidInstancedParticles: no valid positions found');
			return;
		}

		// Low-detail icosahedron — 20 faces is enough for tiny particles and keeps
		// total vertex work to ~12 verts × instance count.
		const geometry = new THREE.IcosahedronGeometry(1, 0);
		// Particles and the VAT pillar mesh share world-space positions (both
		// sourced from the same pyramid geometry), so without a depth bias the
		// opaque VAT mesh occludes most particles. They use a fresh clone of the
		// white-emissive material (forest-parity bloom dots), distinct from the solid's
		// dark-metallic rim. polygonOffset is added only on the particle side so VAT is unaffected.
		const material = SharedMaterials.createPyramidParticleMaterial();
		material.polygonOffset = true;
		material.polygonOffsetFactor = -1;
		material.polygonOffsetUnits = -1;

		const instanced = new THREE.InstancedMesh(geometry, material, this.particleCount);
		instanced.name = `${name}_InstancedParticles`;
		instanced.frustumCulled = false;
		instanced.castShadow = false;
		instanced.receiveShadow = false;
		instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

		this.instancedMesh = instanced;
		this.mesh = instanced;

		this.refreshInstanceMatrices();
	}

	private refreshInstanceMatrices(): void {
		if (this.ridingVat) {
			this.refreshRidingVatUniforms();
			return;
		}
		const instanced = this.instancedMesh;
		if (!instanced) return;

		const tempScale = PyramidInstancedParticles._tempScale;
		const tempMatrix = PyramidInstancedParticles._tempMatrix;
		const tempWorldPos = PyramidInstancedParticles._tempWorldPos;

		const effectiveRadius =
			this.particleRadius *
			this.spriteScaleMultiplier *
			this.transitionSpriteScaleMultiplier *
			this.opacityValue;

		// Source mesh matrixWorld is refreshed once per source — particles inherit
		// the most recent state. Caller (orchestrator.updateTransforms) gates this
		// call on the pyramidsDirty flag. In the same pass, track the largest source
		// scale seen so far as the "full" reference (objects fade in/out via scale).
		let ref = this.referenceScale;
		for (const mesh of this.sourceMeshes) {
			mesh.updateWorldMatrix(true, false);
			tempScale.setFromMatrixScale(mesh.matrixWorld);
			const ms = Math.max(tempScale.x, tempScale.y, tempScale.z);
			if (ms > ref) ref = ms;
		}
		this.referenceScale = ref;
		const refInv = ref > 1e-9 ? 1 / ref : 0;

		for (let i = 0; i < this.particleSlots.length; i++) {
			const slot = this.particleSlots[i];
			const sourceMatrix = slot.sourceMesh.matrixWorld;

			// Fade the sphere radius with the source object's scale (0 → full),
			// matching how the solid VAT mesh scales each object in/out. At scale 0
			// the radius is 0 (degenerate, invisible) — no off-screen parking, so no
			// frame-off pop as objects cross a visibility threshold. The source
			// scale only drives the FADE, not the absolute size: a fully-scaled
			// object always gets the full configured radius (ref normalizes it).
			tempScale.setFromMatrixScale(sourceMatrix);
			const objScale = Math.max(tempScale.x, tempScale.y, tempScale.z);
			const radius = effectiveRadius * Math.min(1, objScale * refInv);

			// World position of the particle = sourceMatrix × localPosition.
			tempWorldPos.copy(slot.localPosition).applyMatrix4(sourceMatrix);
			tempMatrix.makeScale(radius, radius, radius).setPosition(tempWorldPos);

			instanced.setMatrixAt(i, tempMatrix);
		}

		instanced.instanceMatrix.needsUpdate = true;
	}

	public override updateTransforms(): void {
		this.refreshInstanceMatrices();
	}

	/**
	 * Bind this cloud to ride the solid VAT — three phases, driven by the
	 * orchestrator across several posed frames:
	 *   beginVatBinding(vat)              — once
	 *   sampleVatBindingFrame()           — per candidate frame (source + VAT posed there)
	 *   finalizeVatBinding()              — once
	 *
	 * Why multi-frame: the model fades its two shapes in/out via scale. There is NO
	 * single frame where both are full — at rest one shape is collapsed (verts pile
	 * up → mis-assigned → vanish), and at the crossover a shape is half-scale (its
	 * matrix inverse blows the offset up → dots scatter). So each VERTEX is bound at
	 * the candidate frame where ITS shape is most fully formed (max source-mesh
	 * scale), where the assignment is unambiguous and the inverse well-conditioned.
	 * The offset is stored in the object's local frame, so it rides correctly at any
	 * later scale. Spawn distribution (remesh vertices) is unchanged.
	 */
	public beginVatBinding(vat: PyramidVAT): boolean {
		const geo = vat.getMergedGeometry();
		if (!geo || vat.getObjectCount() === 0 || this.particleSlots.length === 0) {
			console.warn('PyramidInstancedParticles.beginVatBinding: VAT or slots not ready');
			return false;
		}
		if (!geo.attributes.position || !geo.attributes.color) {
			console.warn('PyramidInstancedParticles.beginVatBinding: merged geometry missing attrs');
			return false;
		}
		const count = this.particleSlots.length;
		this.ridingObj = new Int32Array(count); // default obj 0
		this.ridingLocal = new Float32Array(count * 3);
		this.bindBestScale = new Float32Array(count).fill(-1);
		this.bindVat = vat;
		this.ridingVat = null; // inactive until finalize
		return true;
	}

	/**
	 * Capture, at the currently-posed frame, every vertex whose source mesh is now
	 * at a higher scale than any frame seen so far (i.e. closer to fully formed).
	 * Caller must have posed both the source meshes and the VAT at this frame.
	 */
	public sampleVatBindingFrame(): void {
		const vat = this.bindVat;
		const ridingObj = this.ridingObj;
		const ridingLocal = this.ridingLocal;
		const bestScale = this.bindBestScale;
		if (!vat || !ridingObj || !ridingLocal || !bestScale) return;
		const geo = vat.getMergedGeometry();
		if (!geo) return;
		const pos = geo.attributes.position;
		const col = geo.attributes.color as THREE.BufferAttribute;
		const objectCount = vat.getObjectCount();
		const assignFrame = vat.getCurrentFrameFloat();

		// Per-object matrix at this frame + scale. Only objects that are (near-)full
		// here go into the match set, so a vertex never binds to a near-zero-scale
		// object (whose inverse would explode the offset).
		const objScale = new Float32Array(objectCount);
		const restMat: Float32Array[] = new Array(objectCount);
		let maxScale = 0;
		for (let o = 0; o < objectCount; o++) {
			const r = new Float32Array(12);
			vat.sampleObjectMatrix(o, assignFrame, r);
			restMat[o] = r;
			const s = Math.max(
				Math.hypot(r[0], r[4], r[8]),
				Math.hypot(r[1], r[5], r[9]),
				Math.hypot(r[2], r[6], r[10])
			);
			objScale[o] = s;
			if (s > maxScale) maxScale = s;
		}
		if (maxScale <= 0) return;
		const fullThresh = maxScale * 0.5;
		const objInv: (THREE.Matrix4 | null)[] = new Array(objectCount).fill(null);
		for (let o = 0; o < objectCount; o++) {
			if (objScale[o] < fullThresh) continue;
			const r = restMat[o];
			objInv[o] = new THREE.Matrix4()
				.set(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], 0, 0, 0, 1)
				.invert();
		}

		// Hash full-scale solid surface points at this frame, tagged with object.
		const div = col.normalized
			? col.array instanceof Uint8Array
				? 255
				: col.array instanceof Uint16Array
					? 65535
					: 1
			: 1;
		const carr = col.array as ArrayLike<number>;
		const cis = col.itemSize;
		const CELL = 0.35;
		const hash = new Map<string, number[]>();
		const sx: number[] = [];
		const sy: number[] = [];
		const sz: number[] = [];
		const sObj: number[] = [];
		const keyOf = (x: number, y: number, z: number) =>
			`${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
		for (let i = 0; i < pos.count; i++) {
			let o = Math.round((carr[i * cis] / div) * 512);
			if (o < 0) o = 0;
			else if (o >= objectCount) o = objectCount - 1;
			if (objScale[o] < fullThresh) continue; // skip faded objects
			const r = restMat[o];
			const lx = pos.getX(i),
				ly = pos.getY(i),
				lz = pos.getZ(i);
			const wx = r[0] * lx + r[1] * ly + r[2] * lz + r[3];
			const wy = r[4] * lx + r[5] * ly + r[6] * lz + r[7];
			const wz = r[8] * lx + r[9] * ly + r[10] * lz + r[11];
			const idx = sObj.length;
			sx.push(wx);
			sy.push(wy);
			sz.push(wz);
			sObj.push(o);
			const k = keyOf(wx, wy, wz);
			let a = hash.get(k);
			if (!a) hash.set(k, (a = []));
			a.push(idx);
		}
		if (sObj.length === 0) return;
		const nearestObj = (x: number, y: number, z: number): number => {
			const cx = Math.floor(x / CELL),
				cy = Math.floor(y / CELL),
				cz = Math.floor(z / CELL);
			let best = Infinity;
			let bestObj = -1;
			for (let dx = -1; dx <= 1; dx++)
				for (let dy = -1; dy <= 1; dy++)
					for (let dz = -1; dz <= 1; dz++) {
						const a = hash.get(`${cx + dx},${cy + dy},${cz + dz}`);
						if (!a) continue;
						for (const idx of a) {
							const d = (x - sx[idx]) ** 2 + (y - sy[idx]) ** 2 + (z - sz[idx]) ** 2;
							if (d < best) {
								best = d;
								bestObj = sObj[idx];
							}
						}
					}
			if (bestObj < 0) {
				for (let idx = 0; idx < sObj.length; idx++) {
					const d = (x - sx[idx]) ** 2 + (y - sy[idx]) ** 2 + (z - sz[idx]) ** 2;
					if (d < best) {
						best = d;
						bestObj = sObj[idx];
					}
				}
			}
			return bestObj;
		};

		// Per source mesh: world scale (for most-formed selection) AND a BIND matrix.
		// Six remesh wings (named below) are exported yawed relative to the solid they
		// ride, so binding off their raw matrixWorld lands their dots on the wrong
		// blocks.
		const CORRECTABLE_WINGS = new Set([
			'PArticles_remesh',
			'PArticles_3_remesh',
			'PArticles_5_remesh',
			'PArticles_7_remesh',
			'PArticles_9_remesh',
			'PArticles_12_remesh_1'
		]);
		const meshScale = new Map<THREE.Mesh, number>();
		const bindMatrix = new Map<THREE.Mesh, THREE.Matrix4>();
		const tmpScale = PyramidInstancedParticles._tempScale;
		const _pivot = new THREE.Vector3();
		const _rotY = new THREE.Matrix4().makeRotationY(-0.5);
		for (const mesh of this.sourceMeshes) {
			mesh.updateWorldMatrix(true, false);
			tmpScale.setFromMatrixScale(mesh.matrixWorld);
			meshScale.set(mesh, Math.max(tmpScale.x, tmpScale.y, tmpScale.z));
			if (CORRECTABLE_WINGS.has(mesh.name)) {
				// bind = T(pivot) · Ry(~−28deg) · T(−pivot) · matrixWorld
				_pivot.setFromMatrixPosition(mesh.matrixWorld);
				const m = new THREE.Matrix4()
					.makeTranslation(_pivot.x, _pivot.y, _pivot.z)
					.multiply(_rotY)
					.multiply(new THREE.Matrix4().makeTranslation(-_pivot.x, -_pivot.y, -_pivot.z))
					.multiply(mesh.matrixWorld);
				bindMatrix.set(mesh, m);
			} else {
				bindMatrix.set(mesh, mesh.matrixWorld.clone());
			}
		}

		const rest = new THREE.Vector3();
		for (let i = 0; i < this.particleSlots.length; i++) {
			const slot = this.particleSlots[i];
			const ms = meshScale.get(slot.sourceMesh) ?? 0;
			if (ms <= bestScale[i]) continue; // a better (more-formed) frame already bound it
			rest.copy(slot.localPosition).applyMatrix4(bindMatrix.get(slot.sourceMesh)!);
			const o = nearestObj(rest.x, rest.y, rest.z);
			const inv = o >= 0 ? objInv[o] : null;
			if (o < 0 || !inv) continue; // no full object to ride here; keep prior binding
			ridingObj[i] = o;
			rest.applyMatrix4(inv); // -> object-local offset
			ridingLocal[i * 3 + 0] = rest.x;
			ridingLocal[i * 3 + 1] = rest.y;
			ridingLocal[i * 3 + 2] = rest.z;
			bestScale[i] = ms;
		}
	}

	public finalizeVatBinding(): void {
		const vat = this.bindVat;
		if (!vat || !this.ridingObj || !this.ridingLocal || !this.instancedMesh) return;
		this.ridingVat = vat;
		this.bindVat = null;
		this.bindBestScale = null;
		this.setupVatRideMaterial(vat, this.instancedMesh);
		// Bound data now lives in per-instance attributes — drop the CPU copies.
		this.ridingObj = null;
		this.ridingLocal = null;
		this.refreshInstanceMatrices();
	}

	/**
	 * Switch the instanced mesh to the GPU ride path: per-instance attributes
	 * carry (objIndex, object-local offset), and the positionNode reproduces the
	 * CPU chain `vatMesh.matrixWorld · VAT_matrix(obj, frame) · local` exactly —
	 * matrixWorld via the mesh transform (synced from the VAT mesh), the VAT
	 * matrix via the same texture rows + progress uniform the solid samples, and
	 * the sphere offset as an axis-aligned `positionGeometry × radius` (the CPU
	 * matrices were scale+translate only, so normals/look are unchanged).
	 */
	private setupVatRideMaterial(vat: PyramidVAT, instanced: THREE.InstancedMesh): void {
		const ridingObj = this.ridingObj!;
		const ridingLocal = this.ridingLocal!;
		const count = this.particleCount;

		const objIdxArr = new Float32Array(count);
		for (let i = 0; i < count; i++) objIdxArr[i] = ridingObj[i];
		const objIdxAttr = instancedBufferAttribute(new THREE.InstancedBufferAttribute(objIdxArr, 1));
		const offsetAttr = instancedBufferAttribute(new THREE.InstancedBufferAttribute(ridingLocal, 3));

		// Identity instance matrices, uploaded once — position comes fully from
		// the shader (the instancing transform must be a no-op either side of
		// positionNode).
		const identity = PyramidInstancedParticles._tempMatrix.identity();
		for (let i = 0; i < count; i++) instanced.setMatrixAt(i, identity);
		instanced.instanceMatrix.needsUpdate = true;

		const maxScale = vat.getMaxObjectScale();
		const refScaleInvU = uniform(maxScale > 1e-9 ? 1 / maxScale : 0);
		const radiusU = this.effectiveRadiusUniform;

		const material = instanced.material as MeshStandardNodeMaterial;
		material.positionNode = Fn(() => {
			const objIdx = int(objIdxAttr.add(0.5));
			const rows = vat.tslSampleObjectRows(objIdx)!;
			const r0 = rows.r0;
			const r1 = rows.r1;
			const r2 = rows.r2;

			// objPos = mat4x3 · [local, 1]
			const lp = offsetAttr;
			const wx = r0.x.mul(lp.x).add(r0.y.mul(lp.y)).add(r0.z.mul(lp.z)).add(r0.w);
			const wy = r1.x.mul(lp.x).add(r1.y.mul(lp.y)).add(r1.z.mul(lp.z)).add(r1.w);
			const wz = r2.x.mul(lp.x).add(r2.y.mul(lp.y)).add(r2.z.mul(lp.z)).add(r2.w);

			// Radius fades with the object's scale (max column norm — the same
			// metric the CPU path used), normalized by the bake-wide max.
			const sx = vec3(r0.x, r1.x, r2.x).length();
			const sy = vec3(r0.y, r1.y, r2.y).length();
			const sz = vec3(r0.z, r1.z, r2.z).length();
			const objScale = max(sx, max(sy, sz));
			const radius = radiusU.mul(clamp(objScale.mul(refScaleInvU), 0.0, 1.0));

			return vec3(wx, wy, wz).add(positionGeometry.mul(radius));
		})();
		material.needsUpdate = true;

		// The mesh transform now mirrors the VAT mesh's matrixWorld each tick.
		instanced.matrixAutoUpdate = false;
	}

	/**
	 * Ride-the-VAT per-frame update — GPU mode. The shader owns every particle
	 * position; the CPU only feeds it the effective radius (one uniform) and the
	 * VAT mesh's matrixWorld (the mesh transform mirrors it so modelMatrix
	 * carries the same pivot rotation the solid gets).
	 */
	private refreshRidingVatUniforms(): void {
		this.effectiveRadiusUniform.value =
			this.particleRadius *
			this.spriteScaleMultiplier *
			this.transitionSpriteScaleMultiplier *
			this.opacityValue;
		this.syncRidingMeshTransform();
	}

	/**
	 * Mirror the VAT mesh's world transform onto the (scene-root) instanced
	 * mesh. The instanced mesh's parent is the scene (identity), so copying the
	 * matrixWorld into `matrix` with matrixAutoUpdate off reproduces the exact
	 * `worldM` factor of the old CPU chain — without reparenting, which would
	 * change the cloud's inherited-visibility semantics.
	 */
	private syncRidingMeshTransform(): void {
		const instanced = this.instancedMesh;
		const vatMesh = this.ridingVat?.getMesh();
		if (!instanced || !vatMesh) return;
		vatMesh.updateWorldMatrix(true, false);
		instanced.matrix.copy(vatMesh.matrixWorld);
		instanced.matrixWorldNeedsUpdate = true;
	}

	public override hideSourceMeshes(): void {
		for (const mesh of this.sourceMeshes) {
			mesh.visible = false;
			mesh.castShadow = false;
		}
	}

	public override showSourceMeshes(): void {
		for (const mesh of this.sourceMeshes) {
			mesh.visible = true;
		}
	}

	public override setOpacity(opacity: number): void {
		const clamped = Math.max(0, Math.min(1, opacity));
		if (this.opacityValue === clamped) return;
		this.opacityValue = clamped;
		if (this.instancedMesh) {
			this.instancedMesh.visible = clamped > 0;
		}
		this.refreshInstanceMatrices();
	}

	public override getOpacity(): number {
		return this.opacityValue;
	}

	public override setSpriteScaleMultiplier(multiplier: number): void {
		if (this.spriteScaleMultiplier === multiplier) return;
		this.spriteScaleMultiplier = multiplier;
		this.refreshInstanceMatrices();
	}

	public override setTransitionSpriteScaleMultiplier(multiplier: number): void {
		if (this.transitionSpriteScaleMultiplier === multiplier) return;
		this.transitionSpriteScaleMultiplier = multiplier;
		this.refreshInstanceMatrices();
	}

	public override setColorInversion(_inverted: boolean): void {
		// Pyramid path no longer participates in scene inversion — PBR color is
		// driven by shared uniforms and scene lighting instead.
	}

	public override isVisible(): boolean {
		return this.opacityValue > 0;
	}

	public override dispose(): void {
		if (this.instancedMesh) {
			this.instancedMesh.dispose();
			this.instancedMesh.geometry.dispose();
			// Material is the shared singleton from SharedMaterials — disposal is
			// owned there.
			this.instancedMesh = null;
			this.mesh = null;
		}
		this.particleSlots = [];
		this.sourceMeshes = [];
		this.particleCount = 0;
		this.referenceScale = 0;
		this.ridingVat = null;
		this.ridingObj = null;
		this.ridingLocal = null;
		this.bindBestScale = null;
		this.bindVat = null;
	}
}
