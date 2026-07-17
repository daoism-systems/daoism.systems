import * as THREE from 'three/webgpu';

interface ModelRotationControllerOptions {
	cubesAutoRotateSpeed?: number;
	pyramidsAutoRotateSpeed?: number;
}

interface RotationUpdateResult {
	cubesDirty: boolean;
	pyramidsDirty: boolean;
}

export class ModelRotationController {
	private readonly worldYAxis = new THREE.Vector3(0, 1, 0);
	private readonly tempParentQuat = new THREE.Quaternion();
	private readonly tempRotationQuat = new THREE.Quaternion();
	private readonly tempLocalQuat = new THREE.Quaternion();
	private readonly tempWorldCenter = new THREE.Vector3();
	private readonly tempLocalCenter = new THREE.Vector3();
	private readonly tempPivotQuat = new THREE.Quaternion();
	private readonly tempBox = new THREE.Box3();

	private cubesAutoRotateSpeed: number;
	private pyramidsAutoRotateSpeed: number;

	private pyramidsSourceGroup: THREE.Object3D | null = null;
	private pyramidVATMesh: THREE.Object3D | null = null;
	private cubesRotationPivot: THREE.Group | null = null;
	private pyramidsTransitionPivot: THREE.Group | null = null;
	private pyramidsRotationPivot: THREE.Group | null = null;
	private pyramidSourceMixer: THREE.AnimationMixer | null = null;
	private pyramidSourceActions: THREE.AnimationAction[] = [];

	private cubesRotationAngle = 0;
	private pyramidsRotationAngle = 0;
	private pyramidsScale = 1;

	private normalizeSignedAngle(angle: number): number {
		const fullTurn = Math.PI * 2;
		let normalized = angle % fullTurn;
		if (normalized > Math.PI) normalized -= fullTurn;
		if (normalized < -Math.PI) normalized += fullTurn;
		return normalized;
	}

	constructor(options: ModelRotationControllerOptions = {}) {
		this.cubesAutoRotateSpeed = options.cubesAutoRotateSpeed ?? THREE.MathUtils.degToRad(18);
		this.pyramidsAutoRotateSpeed = options.pyramidsAutoRotateSpeed ?? -THREE.MathUtils.degToRad(12);
	}

	public setCubesRotationSpeed(deg: number): void {
		this.cubesAutoRotateSpeed = THREE.MathUtils.degToRad(deg);
	}

	public setPyramidsRotationSpeed(deg: number): void {
		this.pyramidsAutoRotateSpeed = THREE.MathUtils.degToRad(deg);
	}

	private getObjectWorldCenter(target: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
		target.updateWorldMatrix(true, true);
		this.tempBox.setFromObject(target);
		if (!this.tempBox.isEmpty()) {
			return this.tempBox.getCenter(out);
		}

		return target.getWorldPosition(out);
	}

	private ensurePyramidsPivots(target: THREE.Object3D): THREE.Group | null {
		if (target.parent === this.pyramidsRotationPivot && this.pyramidsTransitionPivot) {
			return this.pyramidsRotationPivot;
		}

		if (this.pyramidsRotationPivot) {
			this.attachToPyramidsRotationPivot(target);
			return this.pyramidsRotationPivot;
		}

		const parent = target.parent;
		if (!parent) {
			return null;
		}

		this.getObjectWorldCenter(target, this.tempWorldCenter);
		this.tempLocalCenter.copy(this.tempWorldCenter);
		parent.worldToLocal(this.tempLocalCenter);

		const transitionPivot = new THREE.Group();
		transitionPivot.name = 'PyramidsTransitionPivot';
		transitionPivot.position.copy(this.tempLocalCenter);
		parent.add(transitionPivot);

		const rotationPivot = new THREE.Group();
		rotationPivot.name = 'PyramidsRotationPivot';
		transitionPivot.add(rotationPivot);
		rotationPivot.attach(target);

		this.pyramidsTransitionPivot = transitionPivot;
		this.pyramidsRotationPivot = rotationPivot;

		return rotationPivot;
	}

	private isDescendantOfObject(target: THREE.Object3D, ancestor: THREE.Object3D): boolean {
		let parent = target.parent;
		while (parent) {
			if (parent === ancestor) {
				return true;
			}
			parent = parent.parent;
		}
		return false;
	}

	private attachToPyramidsRotationPivot(target: THREE.Object3D): void {
		if (!this.pyramidsRotationPivot) {
			return;
		}

		const transitionScale = this.pyramidsTransitionPivot?.scale.x ?? 1;
		this.tempPivotQuat.copy(this.pyramidsRotationPivot.quaternion);

		if (this.pyramidsTransitionPivot) {
			this.pyramidsTransitionPivot.scale.setScalar(1);
		}
		this.pyramidsRotationPivot.quaternion.identity();
		this.pyramidsTransitionPivot?.updateWorldMatrix(true, true);

		this.pyramidsRotationPivot.attach(target);

		this.pyramidsRotationPivot.quaternion.copy(this.tempPivotQuat);
		if (this.pyramidsTransitionPivot) {
			this.pyramidsTransitionPivot.scale.setScalar(transitionScale);
			this.pyramidsTransitionPivot.updateWorldMatrix(true, true);
		}
	}

	private setPivotWorldYRotation(target: THREE.Object3D | null, angle: number): void {
		if (!target) {
			return;
		}

		this.tempRotationQuat.setFromAxisAngle(this.worldYAxis, angle);
		if (!target.parent) {
			target.quaternion.copy(this.tempRotationQuat);
			return;
		}

		target.parent.getWorldQuaternion(this.tempParentQuat);
		this.tempLocalQuat
			.copy(this.tempParentQuat)
			.invert()
			.multiply(this.tempRotationQuat)
			.multiply(this.tempParentQuat);
		target.quaternion.copy(this.tempLocalQuat);
	}

	private ensureCubesPivot(target: THREE.Object3D): THREE.Group | null {
		if (target.parent === this.cubesRotationPivot && this.cubesRotationPivot) {
			return this.cubesRotationPivot;
		}

		if (this.cubesRotationPivot) {
			this.attachToCubesRotationPivot(target);
			return this.cubesRotationPivot;
		}

		const parent = target.parent;
		if (!parent) {
			return null;
		}

		this.getObjectWorldCenter(target, this.tempWorldCenter);
		this.tempLocalCenter.copy(this.tempWorldCenter);
		parent.worldToLocal(this.tempLocalCenter);

		const rotationPivot = new THREE.Group();
		rotationPivot.name = 'CubesRotationPivot';
		rotationPivot.position.copy(this.tempLocalCenter);
		parent.add(rotationPivot);
		rotationPivot.attach(target);

		this.cubesRotationPivot = rotationPivot;
		return rotationPivot;
	}

	public attachCubes(group: THREE.Object3D): void {
		this.cubesRotationPivot = this.ensureCubesPivot(group) ?? this.cubesRotationPivot;
	}

	public attachCubesParticleSources(groups: THREE.Object3D[]): void {
		for (const group of groups) {
			this.cubesRotationPivot = this.ensureCubesPivot(group) ?? this.cubesRotationPivot;
		}
	}

	private attachToCubesRotationPivot(target: THREE.Object3D): void {
		if (!this.cubesRotationPivot) {
			return;
		}
		this.tempPivotQuat.copy(this.cubesRotationPivot.quaternion);
		this.cubesRotationPivot.quaternion.identity();
		this.cubesRotationPivot.updateWorldMatrix(true, true);
		this.cubesRotationPivot.attach(target);
		this.cubesRotationPivot.quaternion.copy(this.tempPivotQuat);
		this.cubesRotationPivot.updateWorldMatrix(true, true);
	}

	public getCubesVisibilityGroup(): THREE.Object3D | null {
		return this.cubesRotationPivot;
	}

	public attachPyramidsSource(
		group: THREE.Object3D,
		gltf?: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }
	): void {
		this.pyramidsSourceGroup = group;
		this.pyramidsRotationPivot = this.ensurePyramidsPivots(group) ?? this.pyramidsRotationPivot;
		if (this.pyramidsRotationPivot && this.pyramidVATMesh) {
			this.attachToPyramidsRotationPivot(this.pyramidVATMesh);
		}

		if (gltf && gltf.animations.length > 0 && !this.pyramidSourceMixer) {
			// Bind to gltf.scene (not the pivot). pyramidsRoot is reparented under
			// pivots that remain children of gltf.scene, so PropertyBinding.findNode
			// still resolves clip track names through the subtree walk.
			this.pyramidSourceMixer = new THREE.AnimationMixer(gltf.scene);
			this.pyramidSourceMixer.timeScale = 0;
			this.pyramidSourceActions = gltf.animations.map((clip) => {
				const action = this.pyramidSourceMixer!.clipAction(clip);
				action.loop = THREE.LoopOnce;
				action.clampWhenFinished = true;
				action.paused = true;
				action.play();
				return action;
			});
			if (typeof location !== 'undefined' && location.search.includes('pyramidDebug')) {
				console.log(
					`[pyramidDebug] attachPyramidsSource: mixer bound, actions=${this.pyramidSourceActions.length} durations=[${this.pyramidSourceActions
						.slice(0, 4)
						.map((a) => a.getClip().duration.toFixed(2))
						.join(', ')}]`
				);
			}
		}
	}

	public attachPyramidsParticleSources(groups: THREE.Object3D[]): void {
		for (const group of groups) {
			if (!this.pyramidsRotationPivot) {
				this.pyramidsRotationPivot = this.ensurePyramidsPivots(group) ?? this.pyramidsRotationPivot;
				continue;
			}

			const sharedRoot = this.pyramidsTransitionPivot ?? this.pyramidsRotationPivot;
			if (sharedRoot && !this.isDescendantOfObject(group, sharedRoot)) {
				this.attachToPyramidsRotationPivot(group);
			}
		}
	}

	/**
	 * No-VAT path (mobile): wrap a MIXER-ANIMATED pyramids root in a pivot chain
	 * that stays exact under per-frame mixer writes. The `attach()`-based pivots
	 * (`ensurePyramidsPivots`) bake the pivot offset into the target's local
	 * transform once — but the mixer then overwrites that local with clip values
	 * authored for the ORIGINAL parent space, so the bbox-center offset corrupts
	 * every animated TRS (position/scale/rotation all land wrong). Here the chain
	 *   transitionPivot(+center) → rotationPivot(spin) → counterPivot(−center)
	 * carries the compensation itself and the root is `add()`-ed with its local
	 * transform untouched: at identity spin the authored world transform
	 * reproduces exactly, and the auto-spin still rotates about the group's rest
	 * center like the VAT pivot does.
	 */
	public attachAnimatedPyramidsRoot(root: THREE.Object3D): void {
		if (this.pyramidsRotationPivot) return;
		const parent = root.parent;
		if (!parent) return;

		this.getObjectWorldCenter(root, this.tempWorldCenter);
		this.tempLocalCenter.copy(this.tempWorldCenter);
		parent.worldToLocal(this.tempLocalCenter);

		const transitionPivot = new THREE.Group();
		transitionPivot.name = 'PyramidsTransitionPivot';
		transitionPivot.position.copy(this.tempLocalCenter);

		const rotationPivot = new THREE.Group();
		rotationPivot.name = 'PyramidsRotationPivot';

		const counterPivot = new THREE.Group();
		counterPivot.name = 'PyramidsCounterPivot';
		counterPivot.position.copy(this.tempLocalCenter).negate();

		parent.add(transitionPivot);
		transitionPivot.add(rotationPivot);
		rotationPivot.add(counterPivot);
		// add(), NOT attach(): the root's local transform must stay exactly what
		// the mixer writes.
		counterPivot.add(root);

		this.pyramidsSourceGroup = root;
		this.pyramidsTransitionPivot = transitionPivot;
		this.pyramidsRotationPivot = rotationPivot;
	}

	public attachPyramidVATMesh(mesh: THREE.Object3D): void {
		this.pyramidVATMesh = mesh;
		if (this.pyramidsRotationPivot) {
			this.attachToPyramidsRotationPivot(mesh);
		}
	}

	public getPyramidsVisibilityGroup(): THREE.Object3D | null {
		return this.pyramidsTransitionPivot ?? this.pyramidsRotationPivot ?? this.pyramidsSourceGroup;
	}

	public applyCurrentTransform(contentProgress: number): void {
		this.setPivotWorldYRotation(this.cubesRotationPivot, this.cubesRotationAngle);
		this.setPivotWorldYRotation(this.pyramidsRotationPivot, this.pyramidsRotationAngle);
		this.advancePyramidSourceAnimations(contentProgress);
	}

	private advancePyramidSourceAnimations(contentProgress: number): void {
		if (!this.pyramidSourceMixer || this.pyramidSourceActions.length === 0) return;
		const t = THREE.MathUtils.clamp(contentProgress, 0, 1);
		for (const action of this.pyramidSourceActions) {
			action.time = t * action.getClip().duration;
		}
		this.pyramidSourceMixer.update(0);
	}

	/**
	 * Pose the remesh source meshes at `contentProgress` WITHOUT touching the
	 * rotation pivot. Used once at setup so the VAT-driven particle cloud can
	 * sample the source at the crossover frame (both shapes spread) when binding
	 * each dot to its solid object. Leaving the pivot at rest keeps the captured
	 * world positions in the same FBX-absolute frame as the VAT matrices.
	 */
	public posePyramidSourceAt(contentProgress: number): void {
		this.advancePyramidSourceAnimations(contentProgress);
	}

	public update(
		delta: number,
		cubesVisible: boolean,
		pyramidsVisible: boolean,
		advanceAutoRotation = true
	): RotationUpdateResult {
		let cubesDirty = false;
		let pyramidsDirty = false;

		// `setPivotWorldYRotation` layers this spin ON TOP of the parent's
		// (scroll-clip-driven) orientation, so we keep re-writing the pivot every
		// visible frame to hold the offset correct as the parent animates. We only
		// freeze the *angle advance* while the scroll is actively driving the scene:
		// otherwise the auto-spin runs forward while the clip plays backward on a
		// scroll-back (Partners/Ventures), and the two fight into a visible flicker.
		if (cubesVisible && this.cubesRotationPivot) {
			if (advanceAutoRotation) {
				this.cubesRotationAngle += this.cubesAutoRotateSpeed * delta;
			}
			this.setPivotWorldYRotation(this.cubesRotationPivot, this.cubesRotationAngle);
			cubesDirty = true;
		}

		if (pyramidsVisible && this.pyramidsRotationPivot) {
			if (advanceAutoRotation) {
				this.pyramidsRotationAngle += this.pyramidsAutoRotateSpeed * delta;
				this.pyramidsRotationAngle = this.normalizeSignedAngle(this.pyramidsRotationAngle);
			}
			this.setPivotWorldYRotation(this.pyramidsRotationPivot, this.pyramidsRotationAngle);
			pyramidsDirty = true;
		}

		return { cubesDirty, pyramidsDirty };
	}

	public cleanup(): void {
		for (const action of this.pyramidSourceActions) action.stop();
		this.pyramidSourceActions = [];
		this.pyramidSourceMixer = null;
		this.pyramidsSourceGroup = null;
		this.pyramidVATMesh = null;
		this.cubesRotationPivot = null;
		this.pyramidsTransitionPivot = null;
		this.pyramidsRotationPivot = null;
		this.cubesRotationAngle = 0;
		this.pyramidsRotationAngle = 0;
		this.pyramidsScale = 1;
	}
}

export default ModelRotationController;
