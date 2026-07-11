import { SCENE_SWAP_POINTS } from '../animation/sceneManifest';
import { SCENE_LAYERS } from '../sceneLayers';
import type { SceneStage, SceneStageBindings } from './SceneStage';
import { assignSceneLayer } from './assignSceneLayer';

/**
 * Scene 3 — forest + contact (`[scene2To3, 1.0]`).
 *
 * Forest visibility is owned by the layer system — the Scene 3 pass is the
 * only one that renders `SCENE_LAYERS.SCENE_3`. Cross-cutting post FX are
 * Theatre-owned and applied outside the stage system.
 */
export class Scene3Stage implements SceneStage {
	readonly index = 3;
	get start(): number {
		return SCENE_SWAP_POINTS.scene2To3;
	}
	readonly end = 1.1;

	bindGltf(bindings: SceneStageBindings): void {
		const c = SCENE_LAYERS.SCENE_3;
		assignSceneLayer(bindings.forestGroup ?? null, c);
		for (const sys of bindings.forestParticles ?? []) {
			assignSceneLayer(sys.getMesh(), c);
		}
		for (const sys of bindings.signTreeParticles ?? []) {
			assignSceneLayer(sys.getMesh(), c);
		}
	}

	activate(): void {}
	deactivate(): void {}
	update(_progress: number, _delta: number): void {}
}
