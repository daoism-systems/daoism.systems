import {
	PAGE_SECTION_SCENE_RANGES,
	SCENE_MANIFEST,
	type ProgressRange
} from '$lib/scene/animation/sceneManifest';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * The seven tunable page-section scene-boundaries, as FRAME positions in the
 * baked clip (0..`SCENE_MANIFEST.totalDuration`). Each value is where that
 * section's 3D-scene slice begins; the first section pins to 0 and the last
 * ends at the clip total, so together they tile the scene axis. Authored via the
 * Theatre `Scene Boundaries` object (see `TheatreController.registerSceneBoundaries`).
 */
export type SceneBoundaryValues = {
	aboutStart: number;
	servicesStart: number;
	collaborationStart: number;
	venturesStart: number;
	partnersStart: number;
	careersStart: number;
	contactStart: number;
};

/** Code defaults — the current `SCENE_MANIFEST` boundaries, so nothing changes until dragged. */
export const DEFAULT_SCENE_BOUNDARIES: SceneBoundaryValues = {
	aboutStart: SCENE_MANIFEST.scenes[1].start, // 260 — Scene_02_Cubes start
	servicesStart: SCENE_MANIFEST.scenes[2].start, // 350 — Scene_03_Pyramids start
	collaborationStart: SCENE_MANIFEST.scenes[3].start, // 750 — Scene_04_MorphingPyramids start
	venturesStart: SCENE_MANIFEST.scenes[4].start, // 900 — Scene_05_UI start
	partnersStart: SCENE_MANIFEST.scenes[4].end, // 1300 — Scene_05_UI end
	careersStart: SCENE_MANIFEST.scenes[5].end, // 1450 — Scene_06_UI end
	contactStart: SCENE_MANIFEST.scenes[7].start // 2720 — Scene_08_Contact start
};

/**
 * Reactive owner of the page-section SCENE-axis ranges (the scroll→scene map's
 * target slices). Seeded from the shipped `PAGE_SECTION_SCENE_RANGES`, then
 * republished by `setSceneBoundaries` whenever the Theatre `Scene Boundaries`
 * values change (at boot with the persisted/baked values, and live on every
 * Studio drag). `pagePipeline.mapGlobalProgressToSceneProgress` reads these, so
 * moving a boundary re-paces which 3D frame a given scroll lands on.
 *
 * Read `ranges` in `$derived`/templates for reactive consumers; plain call-time
 * reads (scroll-tick closures) always see the current build. `version` bumps on
 * every rebuild for effects that re-drive the render.
 */
export const sceneRangeState = $state({
	ranges: PAGE_SECTION_SCENE_RANGES.map((range) => ({
		start: range.start,
		end: range.end
	})) as ProgressRange[],
	version: 0
});

/** Rebuild the live scene-axis ranges from the Theatre `Scene Boundaries` frame values. */
export function setSceneBoundaries(values: SceneBoundaryValues): void {
	const total = SCENE_MANIFEST.totalDuration;
	const boundaries = [
		0,
		values.aboutStart,
		values.servicesStart,
		values.collaborationStart,
		values.venturesStart,
		values.partnersStart,
		values.careersStart,
		values.contactStart,
		total
	].map((frame) => clamp01(frame / total));

	sceneRangeState.ranges = boundaries.slice(0, 8).map((start, index) => ({
		start,
		end: boundaries[index + 1]
	}));
	sceneRangeState.version += 1;
}
