import * as THREE from 'three/webgpu';
import { OctagonParticleSystem } from './OctagonParticleSystem';
import { FluidMouseField, FluidProfiles } from './FluidMouseField';
import {
	createCameraProjectionUniforms,
	type CameraProjectionUniforms
} from './PhysicsCompute';

export interface OctagonControllerDeps {
	isMobile: boolean;
	hasComputeSupport: boolean;
	enablePhysics: boolean;
	globalFluidEffect: FluidMouseField | null;
	gpu: { renderer: THREE.WebGPURenderer };
	camera: THREE.PerspectiveCamera;
	domElement: HTMLCanvasElement;
}

export interface OctagonSetupOptions {
	particleRadius: number;
	baseColors: THREE.Color[];
	emissiveIntensity: number;
	fogAbsorption: number;
	worldOffsetY: number;
}

/**
 * Owns the 1+N OctagonParticleSystem layers plus the pointer/fluid
 * coupling that drives them: window-level pointer capture, splats into the
 * shared fluid field, simulation-activity envelope, and per-frame compute
 * scheduling (camera uniforms, stride throttle, in-flight gate).
 *
 * Setup returns the produced meshes so the host can add them to the scene
 * graph and tag them (render order, chromatic-aberration layer, etc.).
 */
export class OctagonController {
	private static readonly ACTIVITY_DECAY_HALF_LIFE = 0.65;
	private static readonly ACTIVITY_MOVE_SCALE = 0.35;

	private primary: OctagonParticleSystem | null = null;
	private extras: OctagonParticleSystem[] = [];
	private cameraUniforms: CameraProjectionUniforms | null = null;

	private pointerLastX = 0.5;
	private pointerLastY = 0.5;
	private pointerLastTime = 0;
	private pointerInitialized = false;
	private listenersAttached = false;

	private simulationActivity = 0;
	private readonly computeStride: number;
	private computeInFlight: Promise<void> | null = null;
	/** Per-layer visibility from the previous tickTransforms (index matches
	 * forEachLayer order: primary = 0, extras follow). */
	private layerWasVisible: boolean[] = [];

	constructor(private readonly deps: OctagonControllerDeps) {
		this.computeStride = deps.isMobile ? 2 : 1;
	}

	/**
	 * Build particle systems from the GLB octagon root. Splits into 3 layers
	 * (`inner_01..03`) when present, otherwise treats the root as a single
	 * layer. Returns the produced meshes — the caller adds them to the scene
	 * and applies any host-level tagging (render order, layers, etc.).
	 */
	public setupSystems(
		octagonRoot: THREE.Object3D,
		options: OctagonSetupOptions
	): THREE.Mesh[] {
		const targets = this.resolveSplitTargets(octagonRoot);
		const useCpuFallback = !this.deps.enablePhysics || !this.deps.hasComputeSupport;

		if (!useCpuFallback) {
			this.cameraUniforms = createCameraProjectionUniforms();
			if (this.deps.globalFluidEffect) {
				this.attachPointerListeners();
			}
		}

		const meshes: THREE.Mesh[] = [];
		const baseColors = options.baseColors;

		targets.forEach((target, index) => {
			const system = new OctagonParticleSystem({
				velocityNode: this.deps.globalFluidEffect?.getVelocityNode(),
				cameraUniforms: this.cameraUniforms ?? undefined,
				useCpuFallback
			});
			system.initFromGroup(target, {
				particleRadius: options.particleRadius,
				baseColor: baseColors[index] ?? baseColors[1] ?? baseColors[0],
				emissiveIntensity: options.emissiveIntensity,
				fogAbsorption: options.fogAbsorption,
				worldOffsetY: options.worldOffsetY
			});
			// `initFromGroup()` seeds world positions from the scattered origin buffer.
			// Snap once immediately so CPU-pinned/mobile paths start on the mesh shape.
			system.updateTransforms();
			const mesh = system.getMesh();
			if (!mesh) return;

			meshes.push(mesh);

			if (index === 0) {
				this.primary = system;
			} else {
				this.extras.push(system);
			}

			// Hide the source mesh — particles are the only visual; the original mesh
			// stays in the scene graph so the GLTF mixer keeps animating its matrixWorld.
			system.hideSourceMeshes();
		});

		return meshes;
	}

	private resolveSplitTargets(root: THREE.Object3D): THREE.Object3D[] {
		const targets: THREE.Object3D[] = [];
		for (let index = 1; index <= 3; index++) {
			const target = this.findLayerTarget(root, index);
			if (target) targets.push(target);
		}
		return targets.length > 0 ? targets : [root];
	}

	private findLayerTarget(root: THREE.Object3D, index: number): THREE.Object3D | undefined {
		const padded = String(index).padStart(2, '0');
		const names = [
			`inner_${index}`,
			`inner_${padded}`,
			`Inner_${index}`,
			`Inner_${padded}`,
			`Circle_${index}`,
			`Circle_${padded}`
		];
		for (const name of names) {
			const target = root.getObjectByName(name);
			if (target) return target;
		}
		return undefined;
	}

	// ── Pointer listeners (window-level so overlays don't intercept) ────────

	private attachPointerListeners(): void {
		if (this.listenersAttached) return;
		window.addEventListener('mousemove', this.onMouseMove);
		window.addEventListener('mousedown', this.onMouseDown);
		window.addEventListener('touchmove', this.onTouchMove, { passive: true });
		window.addEventListener('touchstart', this.onTouchStart, { passive: true });
		this.listenersAttached = true;
	}

	private detachPointerListeners(): void {
		if (!this.listenersAttached) return;
		window.removeEventListener('mousemove', this.onMouseMove);
		window.removeEventListener('mousedown', this.onMouseDown);
		window.removeEventListener('touchmove', this.onTouchMove);
		window.removeEventListener('touchstart', this.onTouchStart);
		this.listenersAttached = false;
	}

	private getCanvasUV(clientX: number, clientY: number): { x: number; y: number } | null {
		const dom = this.deps.domElement;
		if (!dom) return null;
		const rect = dom.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
		return { x, y };
	}

	private splatMove(uvX: number, uvY: number): void {
		const fluid = this.deps.globalFluidEffect;
		if (!fluid) return;
		const now = performance.now();
		const deltaSeconds = Math.max((now - this.pointerLastTime) / 1000, 1 / 120);

		if (!this.pointerInitialized) {
			this.pointerInitialized = true;
			this.pointerLastX = uvX;
			this.pointerLastY = uvY;
			this.pointerLastTime = now;
			return;
		}

		const vx = Math.max(-4, Math.min(4, (uvX - this.pointerLastX) / deltaSeconds));
		const vy = Math.max(-4, Math.min(4, (uvY - this.pointerLastY) / deltaSeconds));
		const activityBoost = THREE.MathUtils.clamp(
			Math.hypot(vx, vy) * OctagonController.ACTIVITY_MOVE_SCALE,
			0,
			1
		);
		this.boostActivity(activityBoost);
		fluid.splat({ x: uvX, y: uvY }, vx * 0.7, vy * 0.7, 0.8, FluidProfiles.OctagonParticles);
		this.pointerLastX = uvX;
		this.pointerLastY = uvY;
		this.pointerLastTime = now;
	}

	private onMouseMove = (event: MouseEvent): void => {
		const uv = this.getCanvasUV(event.clientX, event.clientY);
		if (!uv) return;
		this.splatMove(uv.x, uv.y);
	};

	private onMouseDown = (event: MouseEvent): void => {
		const fluid = this.deps.globalFluidEffect;
		if (!fluid) return;
		const uv = this.getCanvasUV(event.clientX, event.clientY);
		if (!uv) return;
		this.boostActivity(1);
		fluid.splat(uv, 0, 0, 1.75, FluidProfiles.OctagonParticles);
	};

	private onTouchMove = (event: TouchEvent): void => {
		const touch = event.touches[0];
		if (!touch) return;
		const uv = this.getCanvasUV(touch.clientX, touch.clientY);
		if (!uv) return;
		this.splatMove(uv.x, uv.y);
	};

	private onTouchStart = (event: TouchEvent): void => {
		const fluid = this.deps.globalFluidEffect;
		if (!fluid) return;
		const touch = event.touches[0];
		if (!touch) return;
		const uv = this.getCanvasUV(touch.clientX, touch.clientY);
		if (!uv) return;
		this.boostActivity(1);
		fluid.splat(uv, 0, 0, 1.75, FluidProfiles.OctagonParticles);
	};

	// ── Activity envelope ──────────────────────────────────────────────────

	private syncActivity(): void {
		const activity = this.simulationActivity;
		if (this.primary) {
			this.primary.getFluidUniforms().uActivity.value = activity;
		}
		for (const layer of this.extras) {
			layer.getFluidUniforms().uActivity.value = activity;
		}
	}

	private boostActivity(amount: number): void {
		const next = THREE.MathUtils.clamp(amount, 0, 1);
		if (next <= this.simulationActivity) return;
		this.simulationActivity = next;
		this.syncActivity();
	}

	/** Framerate-independent decay back toward a quiet near-rest state. */
	public tickActivityDecay(delta: number): void {
		const current = this.simulationActivity;
		if (current <= 0.0005) {
			if (current !== 0) {
				this.simulationActivity = 0;
				this.syncActivity();
			}
			return;
		}
		const lerpFactor =
			1 - Math.exp((-Math.LN2 * delta) / OctagonController.ACTIVITY_DECAY_HALF_LIFE);
		this.simulationActivity = THREE.MathUtils.lerp(current, 0, lerpFactor);
		this.syncActivity();
	}

	// ── Per-frame transforms + compute scheduling ──────────────────────────

	public tickTransforms(): void {
		this.forEachLayer((layer, index) => {
			const visible = layer.isVisible();
			// Hidden layers skip updateTransforms/compute entirely, so their
			// position buffers freeze at the pre-hide pose while the scroll scrub
			// keeps animating the source mesh. On re-show, force a re-pin so the
			// fluid sim resumes from the current pose instead of the stale one.
			if (visible && this.layerWasVisible[index] === false) {
				layer.markPoseStale();
			}
			this.layerWasVisible[index] = visible;
			if (visible) {
				layer.updateTransforms();
			}
		});
	}

	/** Schedule a compute pass when fluid is active and stride allows. No-op if a pass is already in flight. */
	public tickCompute(frameNumber: number): void {
		if (this.computeInFlight) return;
		const hasActiveFluid =
			Boolean(this.primary?.hasActiveFluidSimulation()) ||
			this.extras.some((s) => s.hasActiveFluidSimulation());
		if (!hasActiveFluid) return;
		const stride = Math.max(1, this.computeStride);
		if (frameNumber % stride !== 0) return;

		this.computeInFlight = this.runCompute()
			.catch((error) => {
				console.error('Octagon compute update failed:', error);
			})
			.finally(() => {
				this.computeInFlight = null;
			});
	}

	private async runCompute(): Promise<void> {
		// Refresh camera projection uniforms (shared across all 3 layers).
		// Note: the fluid field steps unconditionally in animate() so post-processing
		// keeps moving even on frames where octagon compute is throttled by stride.
		this.updateCameraUniforms();

		// Submit every layer's compute pass in THIS frame. computeAsync resolves
		// only after GPU completion, so awaiting layers sequentially staggered the
		// later layers' submissions into subsequent frames — and a straggler could
		// then land AFTER updateTransforms' CPU-pin buffer upload on the frame
		// activity crossed idle, stomping the freshly pinned pose (which persisted,
		// because the pin cache saw an unchanged matrix and skipped rewrites).
		const renderer = this.deps.gpu.renderer;
		const passes: Promise<void>[] = [];
		if (this.primary?.isVisible() && this.primary.hasActiveFluidSimulation()) {
			passes.push(this.primary.compute(renderer));
		}
		for (const layer of this.extras) {
			if (layer.isVisible() && layer.hasActiveFluidSimulation()) {
				passes.push(layer.compute(renderer));
			}
		}
		await Promise.all(passes);
	}

	private updateCameraUniforms(): void {
		const c = this.cameraUniforms;
		if (!c) return;
		const cam = this.deps.camera;
		cam.updateMatrixWorld();
		c.uProjMatrix.value.copy(cam.projectionMatrix);
		c.uViewMatrix.value.copy(cam.matrixWorldInverse);
		const e = cam.matrixWorld.elements;
		c.uCamRight.value.set(e[0], e[1], e[2]);
		c.uCamUp.value.set(e[4], e[5], e[6]);
	}

	// ── Lifecycle helpers ──────────────────────────────────────────────────

	/** Flip every layer into GPU fluid mode (called after the intro transition). */
	public activateFluidSim(): void {
		this.syncActivity();
		this.primary?.setFluidActive(true);
		for (const layer of this.extras) {
			layer.setFluidActive(true);
		}
	}

	public setWorldOffsetY(offsetY: number): void {
		this.primary?.setWorldOffsetY(offsetY);
		for (const layer of this.extras) {
			layer.setWorldOffsetY(offsetY);
		}
	}

	public setColorInversion(inverted: boolean): void {
		this.primary?.setColorInversion(inverted);
		for (const layer of this.extras) {
			layer.setColorInversion(inverted);
		}
	}

	public setLayerOpacities(opacities: readonly number[]): void {
		this.forEachLayer((layer, index) => {
			layer.setIntroOpacityMultiplier(opacities[index] ?? 1);
		});
	}

	public getLayerCount(): number {
		return (this.primary ? 1 : 0) + this.extras.length;
	}

	public getPrimary(): OctagonParticleSystem | null {
		return this.primary;
	}

	public getExtras(): OctagonParticleSystem[] {
		return this.extras;
	}

	private forEachLayer(callback: (layer: OctagonParticleSystem, index: number) => void): void {
		if (this.primary) {
			callback(this.primary, 0);
		}
		this.extras.forEach((layer, index) => callback(layer, index + 1));
	}

	public dispose(): void {
		this.detachPointerListeners();
		this.computeInFlight = null;
		if (this.primary) {
			this.primary.dispose();
			this.primary = null;
		}
		for (const layer of this.extras) {
			layer.dispose();
		}
		this.extras = [];
		this.cameraUniforms = null;
		this.pointerInitialized = false;
		this.simulationActivity = 0;
		this.layerWasVisible = [];
	}
}
