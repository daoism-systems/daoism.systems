import type * as THREE from 'three/webgpu';
import type TrainSlider from '../ui/TrainSlider';
import type { OctagonParticleSystem } from '../particles/OctagonParticleSystem';
import type { SimpleParticleSystem } from '../particles/SimpleParticleSystem';
import type { PyramidInstancedParticles } from '../particles/PyramidInstancedParticles';
import type { PyramidVAT } from '../animation/PyramidVAT';
import type Lights from '../lighting/Lights';
import type Renderer from '../postprocessing/Renderer';

/**
 * Bag of references to the *constructed* scene assets, handed to each stage
 * during `bindGltf` (after MainScene.loadObjects resolves). Stages don't
 * construct assets themselves — they just decide what is visible while their
 * progress range is active.
 */
export interface SceneStageBindings {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	renderer: Renderer;
	lights: Lights;

	octagonPrimary?: OctagonParticleSystem | null;
	octagonExtras?: readonly OctagonParticleSystem[];
	cubesGroup?: THREE.Object3D | null;
	cubesParticles?: SimpleParticleSystem | null;
	pyramidsGroup?: THREE.Object3D | null;
	pyramidParticles?: readonly PyramidInstancedParticles[];
	pyramidVAT?: PyramidVAT | null;
	pyramidVATMesh?: THREE.Mesh | null;

	forestGroup?: THREE.Object3D | null;
	forestParticles?: readonly SimpleParticleSystem[];
	signTreeParticles?: readonly SimpleParticleSystem[];

	trainSlider?: TrainSlider;
}

export interface SceneStage {
	/** Stable identifier (1, 2, 3) — used by the dispatcher and for telemetry. */
	readonly index: number;
	/** Progress range owned by this stage (`[start, end)`). */
	readonly start: number;
	readonly end: number;

	/**
	 * Wire up references to constructed scene objects. Called once after
	 * MainScene.loadObjects resolves, before the dispatcher starts running.
	 */
	bindGltf(bindings: SceneStageBindings): void;

	/**
	 * Called once when the dispatcher first activates this stage (or re-enters
	 * after deactivation). Idempotent — safe to call multiple times.
	 */
	activate(): void;

	/**
	 * Called once when the dispatcher leaves this stage's range. Should hide
	 * stage-owned objects and detach any window listeners attached on activate.
	 */
	deactivate(): void;

	/**
	 * Per-frame update while this stage is the active one. `progress` is the
	 * normalized scroll progress in `[0, 1]`; `delta` is the frame delta in
	 * seconds.
	 */
	update(progress: number, delta: number): void;
}
