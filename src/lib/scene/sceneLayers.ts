/**
 * Single source of truth for camera-layer channel assignments.
 *
 * `SCENE_1`/`SCENE_2`/`SCENE_3` gate scene-level presence: each scene's
 * postprocessing pass sets its layer exclusively, so a Scene 1 object cannot
 * leak into Scene 2's render even if its `.visible` is true.
 *
 * `CHROMATIC_1`/`CHROMATIC_3` are per-scene chromatic-aberration markers.
 * They must be per-scene because the CA pass composes into every scene
 * channel — a single shared CA layer would render Scene 1's pyramid into
 * Scene 2's composition through the CA channel. Scene 2 has no chromatic
 * content, so no CHROMATIC_2 exists.
 */
export const SCENE_LAYERS = {
	SCENE_1: 1,
	SCENE_2: 2,
	SCENE_3: 3,
	CHROMATIC_1: 11,
	TRAIN_SLIDER: 12,
	CHROMATIC_3: 13
} as const;

export type SceneIndex = 1 | 2 | 3;
