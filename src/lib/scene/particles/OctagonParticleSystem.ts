import * as THREE from 'three/webgpu';

import { uniform, instancedArray } from 'three/tsl';
import { WebGPURenderer, type StorageBufferNode } from 'three/webgpu';
import { BaseParticleSystem, type BaseParticleOptions } from './BaseParticleSystem';
import {
	createOctagonFluidPhysicsCompute,
	createOctagonFluidUniforms,
	type CameraProjectionUniforms,
	type OctagonFluidUniforms
} from './PhysicsCompute';
import { SharedMaterials } from '../materials/SharedMaterials';
import { acquireUnitQuadGeometry } from './SharedGeometries';
import type { VelocityNode } from './FluidMouseField';

export interface OctagonParticleOptions extends BaseParticleOptions {
	/** Fog absorption 0..1 — how much the particles are swallowed by scene fog */
	fogAbsorption?: number;
	worldOffsetY?: number;
	/** Light position used by the sprite shading (in world space). */
	lightPosition?: THREE.Vector3;
	/** Per-particle scatter radius in source-mesh local space (the cloud "rest pose" extent). */
	originScatterRadius?: number;
}

export interface OctagonParticleSystemOptions {
	/** Shared FluidMouseField velocity texture node — only required when WebGPU compute is available. */
	velocityNode?: VelocityNode;
	/** Shared camera projection uniforms (updated per frame from the scene camera). */
	cameraUniforms?: CameraProjectionUniforms;
	/** When true, skip the fluid GPU sim and pin particles to `transformMatrix * localPos` on CPU. */
	useCpuFallback?: boolean;
}

/**
 * OctagonParticleSystem — fluid-style particle sim around an animated source mesh.
 *
 * Each particle is anchored to a vertex of the source mesh (its model target) but
 * "rests" at a scatter offset from the mesh's local origin (its origin spring).
 * Curl noise + screen-space FluidMouseField velocity disturbance + origin spring +
 * model attraction produce a cloud-around-shape look that follows the source
 * mesh's animated `matrixWorld`.
 *
 * Three instances of this class run side-by-side for the 3-part octagon assembly
 * intro, each tracking a different `inner_0X` mesh.
 */
export class OctagonParticleSystem extends BaseParticleSystem {
	private static readonly _tempScale = new THREE.Vector3();
	private static readonly MIN_VISIBLE_SCALE = 0.001;
	private static readonly HIDDEN_POSITION = 1e10;
	private static readonly IDLE_ACTIVITY_EPSILON = 0.0005;

	private readonly velocityNode: VelocityNode | null;
	private readonly cameraUniforms: CameraProjectionUniforms | null;
	private readonly useCpuFallback: boolean;
	private readonly fluidUniforms: OctagonFluidUniforms = createOctagonFluidUniforms();
	private readonly transformMatrixUniform = uniform(new THREE.Matrix4());
	/** Until the intro-transition completes, particles are CPU-pinned to the mesh shape
	 * (the assembly stays crisp). Flipped to true by MainScene once the intro ends. */
	private fluidActive = false;
	private idlePosePinned = false;
	/** Matrix the CPU-pin path last wrote positions for — the pinned pose is a
	 * pure function of it (worldOffsetY is baked in), so an unchanged matrix
	 * means the per-particle rewrite + buffer re-upload can be skipped. */
	private readonly lastPinnedMatrix = new THREE.Matrix4();
	private hasPinnedPose = false;

	private worldPositionsBuffer: StorageBufferNode<'vec3'> | null = null;
	private velocitiesBuffer: StorageBufferNode<'vec4'> | null = null;
	private originsBuffer: StorageBufferNode<'vec3'> | null = null;
	private localPositionsBuffer: StorageBufferNode<'vec3'> | null = null;
	private worldPositionsAttr: THREE.StorageInstancedBufferAttribute | null = null;
	private velocitiesAttr: THREE.StorageInstancedBufferAttribute | null = null;

	private physicsKernel: ReturnType<typeof createOctagonFluidPhysicsCompute> | null = null;
	private sourceMesh: THREE.Mesh | null = null;
	private localPositionsArray: Float32Array | null = null;
	private worldOffsetY = 0;
	private authoredOpacity = 1;
	private introOpacityMultiplier = 1;

	constructor(options: OctagonParticleSystemOptions) {
		super();
		this.velocityNode = options.velocityNode ?? null;
		this.cameraUniforms = options.cameraUniforms ?? null;
		this.useCpuFallback = options.useCpuFallback ?? false;
	}

	private hash01(value: number): number {
		let x = value | 0;
		x ^= x >>> 16;
		x = Math.imul(x, 0x7feb352d);
		x ^= x >>> 15;
		x = Math.imul(x, 0x846ca68b);
		x ^= x >>> 16;
		return (x >>> 0) / 4294967295;
	}

	public initFromGroup(octagonObject: THREE.Object3D, options: OctagonParticleOptions = {}): void {
		const {
			particleRadius = 0.15,
			baseColor = new THREE.Color(1, 1, 1),
			emissiveIntensity = 1.0,
			fogAbsorption = 0,
			worldOffsetY = 0,
			lightPosition,
			originScatterRadius = 0.15
		} = options;

		this.spriteScale = particleRadius * 2;
		this.emissiveIntensityUniform.value = emissiveIntensity;
		this.worldOffsetY = worldOffsetY;

		// Locate the merged mesh — could be the object itself or a descendant.
		let mergedMesh: THREE.Mesh | null = null;
		if (octagonObject instanceof THREE.Mesh && octagonObject.geometry?.attributes?.position) {
			mergedMesh = octagonObject;
		} else {
			octagonObject.traverse((child) => {
				if (child instanceof THREE.Mesh && child.geometry?.attributes?.position) {
					mergedMesh = child;
				}
			});
		}

		if (!mergedMesh) {
			console.warn('No mesh found in Octagon object');
			return;
		}

		this.sourceMesh = mergedMesh;
		const positions = mergedMesh.geometry.attributes.position;
		const selectedIndices: number[] = [];
		for (let srcIdx = 0; srcIdx < positions.count; srcIdx++) {
			selectedIndices.push(srcIdx);
		}
		if (selectedIndices.length === 0 && positions.count > 0) {
			selectedIndices.push(0);
		}
		this.particleCount = selectedIndices.length;

		// Local-space vertex positions (the "model target" each particle is anchored to).
		// One particle per mesh vertex — the mesh's vertex layout IS the intended look:
		// the regular grid/lattice the design reference shows. (Do not surface-sample or
		// jitter these; that destroys the structure and reads as a random scatter.)
		const localPositionsArray = new Float32Array(this.particleCount * 3);
		for (let dstIdx = 0; dstIdx < selectedIndices.length; dstIdx++) {
			const srcIdx = selectedIndices[dstIdx];
			localPositionsArray[dstIdx * 3 + 0] = positions.getX(srcIdx);
			localPositionsArray[dstIdx * 3 + 1] = positions.getY(srcIdx);
			localPositionsArray[dstIdx * 3 + 2] = positions.getZ(srcIdx);
		}
		this.localPositionsArray = localPositionsArray;

		// Seed scattered origins (mesh-local) plus initial world positions on CPU.
		// Initial world positions start on the source mesh vertices so CPU-pinned
		// paths and intro frames match the model immediately.
		const originsArray = new Float32Array(this.particleCount * 3);
		const initialWorldPositions = new Float32Array(this.particleCount * 3);
		const matrix = this.copySourceWorldMatrix(BaseParticleSystem._tempMatrix);
		this.transformMatrixUniform.value.copy(matrix);
		const tempVec = BaseParticleSystem._tempVec;

		for (let i = 0; i < this.particleCount; i++) {
			const r0 = this.hash01(i * 3 + 1);
			const r1 = this.hash01(i * 3 + 2);
			const r2 = this.hash01(i * 3 + 3);
			const lx = (r0 - 0.5) * originScatterRadius;
			const ly = (r1 - 0.5) * originScatterRadius;
			const lz = (r2 - 0.5) * originScatterRadius;

			originsArray[i * 3] = lx;
			originsArray[i * 3 + 1] = ly;
			originsArray[i * 3 + 2] = lz;

			tempVec
				.set(
					localPositionsArray[i * 3],
					localPositionsArray[i * 3 + 1],
					localPositionsArray[i * 3 + 2]
				)
				.applyMatrix4(matrix);
			initialWorldPositions[i * 3] = tempVec.x;
			initialWorldPositions[i * 3 + 1] = tempVec.y;
			initialWorldPositions[i * 3 + 2] = tempVec.z;
		}

		// Build TSL storage buffers.
		const worldPositionsBuffer = instancedArray(initialWorldPositions, 'vec3');
		const velocitiesBuffer = instancedArray(this.particleCount, 'vec4');
		const originsBuffer = instancedArray(originsArray, 'vec3');
		const localPositionsBuffer = instancedArray(new Float32Array(localPositionsArray), 'vec3');

		this.worldPositionsBuffer = worldPositionsBuffer;
		this.velocitiesBuffer = velocitiesBuffer;
		this.originsBuffer = originsBuffer;
		this.localPositionsBuffer = localPositionsBuffer;
		this.worldPositionsAttr = worldPositionsBuffer.value as THREE.StorageInstancedBufferAttribute;
		this.velocitiesAttr = velocitiesBuffer.value as THREE.StorageInstancedBufferAttribute;

		if (this.useCpuFallback || !this.velocityNode || !this.cameraUniforms) {
			this.physicsKernel = null;
		} else {
			this.physicsKernel = createOctagonFluidPhysicsCompute({
				worldPositions: worldPositionsBuffer,
				velocities: velocitiesBuffer,
				origins: originsBuffer,
				localPositions: localPositionsBuffer,
				transformMatrix: this.transformMatrixUniform,
				mouseVelocityNode: this.velocityNode,
				camera: this.cameraUniforms,
				uniforms: this.fluidUniforms,
				particleCount: this.particleCount
			});
		}

		// Sprite material — per-particle shaded sphere with directional lighting and
		// speed-driven emissive output for selective bloom (MainScene's MRT picks it up).
		const spriteMaterial = SharedMaterials.createOctagonFluidParticleMaterial({
			baseColor,
			lightPosition,
			emissiveIntensity,
			opacityUniform: this.opacityUniform,
			spriteScale: this.spriteScale,
			worldPositions: worldPositionsBuffer,
			velocities: velocitiesBuffer,
			fogAbsorption
		});

		this.emissiveIntensityUniform = spriteMaterial.userData.emissiveIntensityUniform;
		this.opacityUniform = spriteMaterial.userData.opacityUniform;

		const spriteGeometry = acquireUnitQuadGeometry();
		this.mesh = new THREE.Mesh(spriteGeometry, spriteMaterial);
		this.mesh.count = this.particleCount;
		this.mesh.position.set(0, 0, 0);
		this.mesh.name = 'OctagonParticles';
		this.mesh.frustumCulled = false;
	}

	private copySourceWorldMatrix(target: THREE.Matrix4): THREE.Matrix4 {
		if (!this.sourceMesh) {
			target.identity();
			return target;
		}

		this.sourceMesh.updateWorldMatrix(true, false);
		target.copy(this.sourceMesh.matrixWorld);
		if (this.worldOffsetY !== 0) {
			target.elements[13] += this.worldOffsetY;
		}
		return target;
	}

	/**
	 * Refresh the transform matrix uniform from the (animated) source mesh.
	 * While the fluid sim is inactive or at idle activity, pins worldPositions to
	 * `transformMatrix * localPos` directly into the storage buffer so particles
	 * cleanly assemble with the mesh and do not drift at rest.
	 */
	public updateTransforms(): void {
		if (!this.sourceMesh) return;
		const matrix = this.copySourceWorldMatrix(BaseParticleSystem._tempMatrix);
		this.transformMatrixUniform.value.copy(matrix);

		const shouldCpuPinPose =
			!this.fluidActive ||
			this.fluidUniforms.uActivity.value <= OctagonParticleSystem.IDLE_ACTIVITY_EPSILON;
		if (!shouldCpuPinPose) {
			this.idlePosePinned = false;
			// The GPU sim owns positions from here — the cached pinned pose no
			// longer matches the buffer, so the next pin must rewrite it.
			this.hasPinnedPose = false;
			return;
		}
		if (!this.worldPositionsAttr || !this.localPositionsArray) return;

		if (this.hasPinnedPose && matrix.equals(this.lastPinnedMatrix)) {
			return;
		}

		const tempVec = BaseParticleSystem._tempVec;
		const tempScale = OctagonParticleSystem._tempScale;
		const bufferArray = this.worldPositionsAttr.array as Float32Array;

		tempScale.setFromMatrixScale(matrix);
		const currentMaxScale = Math.max(tempScale.x, tempScale.y, tempScale.z);
		if (currentMaxScale < OctagonParticleSystem.MIN_VISIBLE_SCALE) {
			bufferArray.fill(OctagonParticleSystem.HIDDEN_POSITION);
			this.worldPositionsAttr.needsUpdate = true;
			this.worldPositionsAttr.version++;
			this.lastPinnedMatrix.copy(matrix);
			this.hasPinnedPose = true;
			this.clearVelocitiesWhenIdle();
			return;
		}

		for (let i = 0; i < this.particleCount; i++) {
			const i3 = i * 3;
			tempVec
				.set(
					this.localPositionsArray[i3],
					this.localPositionsArray[i3 + 1],
					this.localPositionsArray[i3 + 2]
				)
				.applyMatrix4(matrix);
			bufferArray[i3] = tempVec.x;
			bufferArray[i3 + 1] = tempVec.y;
			bufferArray[i3 + 2] = tempVec.z;
		}
		this.worldPositionsAttr.needsUpdate = true;
		this.worldPositionsAttr.version++;
		this.lastPinnedMatrix.copy(matrix);
		this.hasPinnedPose = true;
		this.clearVelocitiesWhenIdle();
	}

	/**
	 * Toggle the GPU fluid simulation. While inactive, particles are CPU-pinned
	 * to the mesh shape so the intro assembly reads clearly. After intro ends,
	 * MainScene flips this on and the fluid sim takes over (curl + spring + mouse).
	 *
	 * No-op for systems constructed with `useCpuFallback: true` — those have no
	 * physics kernel and remain CPU-pinned forever.
	 */
	public setFluidActive(active: boolean): void {
		if (this.useCpuFallback || !this.physicsKernel) {
			this.fluidActive = false;
			this.idlePosePinned = false;
			return;
		}
		if (active && !this.fluidActive) {
			this.resetSimulationStateToCurrentPose();
		}
		if (active) {
			this.idlePosePinned = false;
		}
		this.fluidActive = active;
	}

	private clearVelocitiesWhenIdle(): void {
		if (!this.fluidActive || this.idlePosePinned || !this.velocitiesAttr) return;

		const velocityArray = this.velocitiesAttr.array as Float32Array;
		velocityArray.fill(0);
		this.velocitiesAttr.needsUpdate = true;
		this.velocitiesAttr.version++;
		this.idlePosePinned = true;
	}

	private resetSimulationStateToCurrentPose(): void {
		// Before handing off from the intro's CPU-pinned pose to the GPU sim,
		// snap positions to the current assembled mesh and clear velocities.
		// Without this handoff, the first compute frames can start from stale
		// buffer data and the octagon appears "floaty" until interaction nudges
		// the springs back into place.
		this.updateTransforms();

		if (this.velocitiesAttr) {
			const velocityArray = this.velocitiesAttr.array as Float32Array;
			velocityArray.fill(0);
			this.velocitiesAttr.needsUpdate = true;
			this.velocitiesAttr.version++;
		}
	}

	public hasActiveFluidSimulation(): boolean {
		return (
			this.fluidActive &&
			this.physicsKernel !== null &&
			this.fluidUniforms.uActivity.value > OctagonParticleSystem.IDLE_ACTIVITY_EPSILON
		);
	}

	public async compute(renderer: WebGPURenderer): Promise<void> {
		if (this.hasActiveFluidSimulation() && this.physicsKernel) {
			await renderer.computeAsync(this.physicsKernel);
		}
	}

	public hideSourceMeshes(): void {
		if (this.sourceMesh) this.sourceMesh.visible = false;
	}

	public showSourceMeshes(): void {
		if (this.sourceMesh) this.sourceMesh.visible = true;
	}

	public getSourceMeshes(): THREE.Mesh[] {
		return this.sourceMesh ? [this.sourceMesh] : [];
	}

	public setWorldOffsetY(offsetY: number): void {
		this.worldOffsetY = offsetY;
	}

	public override setOpacity(opacity: number): void {
		this.authoredOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
		this.applyResolvedOpacity();
	}

	public setIntroOpacityMultiplier(opacity: number): void {
		this.introOpacityMultiplier = THREE.MathUtils.clamp(opacity, 0, 1);
		this.applyResolvedOpacity();
	}

	private applyResolvedOpacity(): void {
		super.setOpacity(this.authoredOpacity * this.introOpacityMultiplier);
	}

	/**
	 * Update — call each frame from MainScene.
	 * Refreshes the transform matrix from the animated source mesh, then dispatches
	 * the GPU compute (only after `setFluidActive(true)` has been called).
	 * The shared FluidMouseField is stepped separately by MainScene.
	 */
	public async update(renderer: WebGPURenderer): Promise<void> {
		this.updateTransforms();
		await this.compute(renderer);
	}

	public getFluidUniforms(): OctagonFluidUniforms {
		return this.fluidUniforms;
	}

	public override dispose(): void {
		super.dispose();

		this.physicsKernel = null;
		this.localPositionsArray = null;
		this.sourceMesh = null;
		this.worldPositionsBuffer = null;
		this.velocitiesBuffer = null;
		this.originsBuffer = null;
		this.localPositionsBuffer = null;
		this.worldPositionsAttr = null;
		this.velocitiesAttr = null;
		this.idlePosePinned = false;
		this.hasPinnedPose = false;
		this.authoredOpacity = 1;
		this.introOpacityMultiplier = 1;
	}
}
