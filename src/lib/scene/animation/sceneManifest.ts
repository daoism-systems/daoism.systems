export const SCENE_MANIFEST = {
	// Frame space = the baked DAO_full_scene.glb clip (46.683s @60fps = 2801f), so a
	// manifest frame IS a clip frame and scene-prog = frame / 2801. Source is the 3D
	// artist's beat sheet for this same motion; their nominal total (2740) is where
	// the last beat lands — the clip runs ~61f longer (a settle tail, scene-prog
	// ~0.978..1.0). Boundaries sit at each transition ONSET; the calibration anchor
	// is scene02Start (artist octagon→sosiski onset 234/2801 = 0.0835, matching the
	// prior hand-scrubbed 0.0833). These drive label switches + the scroll→scene
	// mapping ONLY — the cloud layer-swaps run off CLOUD_TRANSITION_TIMING, and the
	// vignette/RGB-split reveal keyframes are authored in Theatre against scene-prog
	// and must be re-aligned THERE; they do not follow these numbers.
	//
	// Artist beats (frames): octagon reveal 0–180 (intro tween, pre-scroll), pause
	// 180–234, octagon→sosiski 234–466, pause 466–495, sosiski→pyramid_01 495–630,
	// pyramid_01 rotation 630–873, morph 01→02 873–1000, hold 1000–1116, pyramid_02
	// vanish 1116–1165, pause 1165–1575, camera down 1575–1671, to first tree
	// 1671–1891, pause 1891–1923, camera to end 1923–2740.
	totalDuration: 2801,
	scenes: [
		{ name: 'Scene_01_Octagon', start: 0, end: 260 },
		{ name: 'Scene_02_Cubes', start: 260, end: 350 },
		{ name: 'Scene_03_Pyramids', start: 350, end: 750 },
		{ name: 'Scene_04_MorphingPyramids', start: 750, end: 800 },
		{ name: 'Scene_05_UI', start: 800, end: 1300 },
		{ name: 'Scene_06_UI', start: 1300, end: 1450 },
		{ name: 'Scene_07_Forest', start: 1575, end: 2720 },
		{ name: 'Scene_08_Contact', start: 2720, end: 2801 }
	]
} as const;

export const SCENE_BOUNDARIES = {
	scene02Start: SCENE_MANIFEST.scenes[1].start / SCENE_MANIFEST.totalDuration,
	scene02End: SCENE_MANIFEST.scenes[1].end / SCENE_MANIFEST.totalDuration,
	scene03Start: SCENE_MANIFEST.scenes[2].start / SCENE_MANIFEST.totalDuration,
	scene03End: SCENE_MANIFEST.scenes[2].end / SCENE_MANIFEST.totalDuration,
	scene04Start: SCENE_MANIFEST.scenes[3].start / SCENE_MANIFEST.totalDuration,
	scene04End: SCENE_MANIFEST.scenes[3].end / SCENE_MANIFEST.totalDuration,
	scene05Start: SCENE_MANIFEST.scenes[4].start / SCENE_MANIFEST.totalDuration,
	scene05End: SCENE_MANIFEST.scenes[4].end / SCENE_MANIFEST.totalDuration,
	scene06End: SCENE_MANIFEST.scenes[5].end / SCENE_MANIFEST.totalDuration,
	scene07Start: SCENE_MANIFEST.scenes[6].start / SCENE_MANIFEST.totalDuration,
	scene08Start: SCENE_MANIFEST.scenes[7].start / SCENE_MANIFEST.totalDuration
} as const;

import { CLOUD_TRANSITION_TIMING } from './sceneUiTiming';

// Stages flip the moment the transition begins. The renderer composes
// one pass per scene layer, so the leaving scene is captured live in its own
// RT until the transition ends — the swap is no longer something the transition
// has to "hide". Aligning the boundary with the transition start means the
// diagonal cuts between two genuinely different scene contents.
// Getters so changes to `CLOUD_TRANSITION_TIMING` (driven by the
// `Transition` Theatre object) propagate without a stale-closure capture
// at module load.
export const SCENE_SWAP_POINTS = {
	get scene1To2(): number {
		return CLOUD_TRANSITION_TIMING.fillInStart;
	},
	get scene2To3(): number {
		return CLOUD_TRANSITION_TIMING.fadeOutStart;
	}
};

export interface ProgressRange {
	start: number;
	end: number;
}

// Each page section owns a fixed slice of the 3D scene timeline even when
// UI section durations stretch independently.
export const PAGE_SECTION_SCENE_RANGES: readonly ProgressRange[] = [
	{ start: 0, end: SCENE_BOUNDARIES.scene02Start },
	{ start: SCENE_BOUNDARIES.scene02Start, end: SCENE_BOUNDARIES.scene03Start },
	{ start: SCENE_BOUNDARIES.scene03Start, end: SCENE_BOUNDARIES.scene04Start },
	{ start: SCENE_BOUNDARIES.scene04Start, end: SCENE_BOUNDARIES.scene05Start },
	{ start: SCENE_BOUNDARIES.scene05Start, end: SCENE_BOUNDARIES.scene05End },
	{ start: SCENE_BOUNDARIES.scene05End, end: SCENE_BOUNDARIES.scene06End },
	{ start: SCENE_BOUNDARIES.scene06End, end: SCENE_BOUNDARIES.scene08Start },
	// End at 1.0 (max reachable scroll), in sync with SECTION_TIMELINE_TOTAL, so
	// full scroll maps the Contact section to scene/content progress 1.0.
	{ start: SCENE_BOUNDARIES.scene08Start, end: 1.0 }
];

export function getScene07AnnotationRange(viewportWidth: number): { start: number; end: number } {
	const isSmallViewport = viewportWidth < 768;
	const preRoll = isSmallViewport ? 0.02 : 0.01;
	const postRoll = isSmallViewport ? 0.015 : 0.008;
	return {
		start: Math.max(0, SCENE_BOUNDARIES.scene07Start - preRoll),
		end: Math.min(1, SCENE_BOUNDARIES.scene08Start + postRoll)
	};
}
