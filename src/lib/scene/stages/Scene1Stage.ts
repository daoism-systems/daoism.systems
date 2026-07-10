import { SCENE_SWAP_POINTS } from '../animation/sceneManifest';
import { SCENE_LAYERS } from '../sceneLayers';
import type { SceneStage, SceneStageBindings } from './SceneStage';
import { assignSceneLayer } from './assignSceneLayer';

/**
 * Scene 1 — octagon → end of pyramids (`[0, scene1To2)`).
 *
 * Presence is gated by `SCENE_LAYERS.SCENE_1`: the renderer's scene-1 pass is
 * the only one that includes that channel, so scene-owned content cannot leak
 * into Scene 2/3 even if its `.visible` is left true.
 */
export class Scene1Stage implements SceneStage {
	readonly index = 1;
	readonly start = 0;
	get end(): number {
		return SCENE_SWAP_POINTS.scene1To2;
	}

	bindGltf(bindings: SceneStageBindings): void {
		const c = SCENE_LAYERS.SCENE_1;
		assignSceneLayer(bindings.octagonPrimary?.getMesh() ?? null, c);
		for (const extra of bindings.octagonExtras ?? []) {
			assignSceneLayer(extra.getMesh(), c);
		}
		assignSceneLayer(bindings.cubesGroup ?? null, c);
		assignSceneLayer(bindings.cubesParticles?.getMesh() ?? null, c);
		assignSceneLayer(bindings.pyramidsGroup ?? null, c);
		assignSceneLayer(bindings.pyramidVATMesh ?? null, c);
		for (const sys of bindings.pyramidParticles ?? []) {
			assignSceneLayer(sys.getMesh(), c);
		}
	}

	activate(): void {}
	deactivate(): void {}
	update(_progress: number, _delta: number): void {}
}
