import * as THREE from 'three/webgpu';

interface ShiftTarget {
	object: THREE.Object3D;
	horizontalRange: number;
	verticalRange: number;
}

interface MouseParallaxShiftOptions {
	smoothing?: number;
}

const DEFAULT_SMOOTHING = 8;

export class MouseParallaxShift {
	private readonly smoothing: number;
	private readonly targets: ShiftTarget[] = [];
	private readonly basePositions = new Map<THREE.Object3D, THREE.Vector3>();
	private readonly currentOffset = new THREE.Vector2(0, 0);
	private readonly targetOffset = new THREE.Vector2(0, 0);
	private isActive = false;

	constructor(options: MouseParallaxShiftOptions = {}) {
		this.smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
	}

	private isTouchDevice(): boolean {
		if (typeof window === 'undefined' || typeof navigator === 'undefined') {
			return false;
		}

		if (navigator.maxTouchPoints > 0) {
			return true;
		}

		return window.matchMedia('(pointer: coarse), (hover: none)').matches;
	}

	public start(): void {
		if (this.isActive || this.isTouchDevice()) {
			return;
		}

		this.isActive = true;
		window.addEventListener('mousemove', this.onMouseMove, { passive: true });
	}

	public setTargets(targets: ShiftTarget[]): void {
		this.targets.length = 0;
		this.targets.push(...targets.filter((target) => Boolean(target.object)));
		this.basePositions.clear();

		for (const target of this.targets) {
			this.basePositions.set(target.object, target.object.position.clone());
		}
	}

	public update(delta: number): boolean {
		if (!this.isActive || this.targets.length === 0) {
			return false;
		}

		const blend = 1 - Math.exp(-this.smoothing * delta);
		this.currentOffset.lerp(this.targetOffset, blend);

		let dirty = false;
		for (const target of this.targets) {
			const base = this.basePositions.get(target.object);
			if (!base) continue;

			const nextX = base.x + this.currentOffset.x * target.horizontalRange;
			const nextY = base.y + this.currentOffset.y * target.verticalRange;
			if (target.object.position.x !== nextX || target.object.position.y !== nextY) {
				dirty = true;
			}

			target.object.position.set(nextX, nextY, base.z);
		}

		return dirty;
	}

	public stop(): void {
		if (!this.isActive) {
			return;
		}

		window.removeEventListener('mousemove', this.onMouseMove);
		this.isActive = false;

		for (const target of this.targets) {
			const base = this.basePositions.get(target.object);
			if (!base) continue;
			target.object.position.copy(base);
		}

		this.currentOffset.set(0, 0);
		this.targetOffset.set(0, 0);
	}

	private onMouseMove = (event: MouseEvent): void => {
		const width = window.innerWidth || 1;
		const height = window.innerHeight || 1;
		const normalizedX = (event.clientX / width) * 2 - 1;
		const normalizedY = (event.clientY / height) * 2 - 1;

		this.targetOffset.set(normalizedX, -normalizedY);
	};
}

export default MouseParallaxShift;
