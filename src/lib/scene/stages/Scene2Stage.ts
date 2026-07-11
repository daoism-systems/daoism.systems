import { SCENE_SWAP_POINTS } from '../animation/sceneManifest';
import { SCENE_LAYERS } from '../sceneLayers';
import type { SceneStage, SceneStageBindings } from './SceneStage';
import { assignSceneLayer } from './assignSceneLayer';

/**
 * Scene 2 — slider / UI section.
 *
 * Slide meshes already need `LAYER_TRAIN_SLIDER` for raycasting + the cloud's
 * exclusion mask, so we layer-enable both `SCENE_2` and `TRAIN_SLIDER` on the
 * slider group. Cross-cutting post FX are Theatre-owned and applied outside
 * the stage system.
 */
export class Scene2Stage implements SceneStage {
	readonly index = 2;
	get start(): number {
		return SCENE_SWAP_POINTS.scene1To2;
	}
	get end(): number {
		return SCENE_SWAP_POINTS.scene2To3;
	}

	bindGltf(bindings: SceneStageBindings): void {
		const sliderGroup = bindings.trainSlider?.getGroup();
		if (sliderGroup) {
			assignSceneLayer(sliderGroup, SCENE_LAYERS.SCENE_2);
		}
	}

	activate(): void {}
	deactivate(): void {}
	update(_progress: number, _delta: number): void {}
}
