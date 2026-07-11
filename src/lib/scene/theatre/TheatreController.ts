import { getProject, onChange, types, val } from '@theatre/core';
import type { IProject, ISheet } from '@theatre/core';
import * as THREE from 'three/webgpu';
import type Lenis from 'lenis';
import type { Inspectable } from '../debug/Inspectable';
import type { OctagonParticleSystem } from '../particles/OctagonParticleSystem';
import type { SimpleParticleSystem } from '../particles/SimpleParticleSystem';
import type { PyramidInstancedParticles } from '../particles/PyramidInstancedParticles';
import { GridPlane } from '../grid/GridPlane';
import type { ModelRotationController } from '../rotation/ModelRotationController';
import {
	DEFAULT_SCENE_BOUNDARIES,
	setSceneBoundaries
} from '$lib/config/sceneBoundaryStore.svelte';
import { SCENE_MANIFEST } from '$lib/scene/animation/sceneManifest';
import { version } from '$app/environment';

/**
 * Theatre object key holding the page-section scene-boundaries as static props.
 * Referenced where it's registered and where the persistence filter exempts it
 * from static-override stripping.
 */
const SCENE_BOUNDARIES_OBJECT_KEY = 'Scene Boundaries';

export interface ScrollConfigDeps {
	/** Live ref — Lenis is created after Theatre registers, so we read on each tick. */
	lenisInstance: { instance: Lenis | null };
	virtualScrollHeight: { h: number };
	/**
	 * Inverse of the page pipeline's `mapGlobalProgressToSceneProgress` (the
	 * piecewise section→scene-range remap). Converts a scene-timeline progress
	 * back to the raw *global* scroll progress (0..1) that Lenis pixels measure.
	 * The debug reverse-scrub path needs it so dragging the Studio playhead lands
	 * the page at the physically correct scroll; without it the scene desyncs
	 * from the Theatre values until the user scrolls. See `registerScrollConfigs`.
	 */
	mapSceneProgressToGlobal: (sceneProgress: number) => number;
}

export interface TheatreDependencies {
	inspectables: Map<string, Inspectable>;
	particleSystems: {
		octagon?: OctagonParticleSystem | null;
		octagonExtras: OctagonParticleSystem[];
		cubes: SimpleParticleSystem | null;
		pyramids: PyramidInstancedParticles[];
		forest: SimpleParticleSystem[];
		signTree: SimpleParticleSystem[];
	};
	objectGroups: {
		cubes: THREE.Object3D | null;
		pyramids: THREE.Object3D | null;
		/** Forest hero tree (BIG_TREEE_1). */
		forestMainTree: THREE.Object3D | null;
		/** Remaining forest trees (BIG_TREEE, BIG_TREEE_2, Trees). */
		forestOtherTrees: THREE.Object3D[];
		/** Forest city buildings (City). */
		forestCity: THREE.Object3D | null;
	};
	gridPlane?: GridPlane | null;
	modelRotationController?: ModelRotationController | null;
	cameraFov?: {
		/** Platform default (responsive breakpoint value) used as the prop default. */
		initial: number;
		/** Apply the authored FOV and refresh the camera projection. */
		setFov: (fov: number) => void;
	};
	sceneInvert?: {
		isMobile: boolean;
		/** Rest-state scene background — color 1 of the invert lerp. */
		sceneBackgroundBase: THREE.Color;
		/** Target background at full invert — color 2 of the invert lerp. */
		invertBackgroundColor: THREE.Color;
		/**
		 * Continuous scene-invert amount (0..1). The renderer lerps
		 * background and rim around the channel-1 scene pass (so channels
		 * 2/3 — incl. the train slider on SCENE_2 — keep the normal palette).
		 * Vignette tint is driven by a sibling uniform off the same amount.
		 * Particles/octagon snap at 0.5 because their blend-mode swap can't
		 * be tweened — see `MainScene.setSceneInverted`. The reveal back into
		 * Services uses the pre-existing cloud transition between scene
		 * channels — there is no second wipe layered here.
		 */
		setInverted: (amount: number) => void;
	};
	scroll?: ScrollConfigDeps;
}

type VoidFn = () => void;

// Keys to skip when flattening configs (metadata, non-animatable)
const SKIP_KEYS = new Set(['name', 'timestamp', 'noiseType', 'type']);

type ColorFormat = 'rgb' | 'hex-number' | 'hex-string';
type RgbaColor = { r: number; g: number; b: number; a: number };
type FlatValue = number | boolean | RgbaColor;

function isRgbaColor(v: unknown): v is RgbaColor {
	return (
		!!v &&
		typeof v === 'object' &&
		typeof (v as RgbaColor).r === 'number' &&
		typeof (v as RgbaColor).g === 'number' &&
		typeof (v as RgbaColor).b === 'number'
	);
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinKey(prefix: string, key: string): string {
	return prefix ? `${prefix}${capitalize(key)}` : key;
}

/** "spotLightSub" → "spot light sub", "spotLightOffset0" → "spot light offset 0" */
function camelToWords(s: string): string {
	return s
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/([a-zA-Z])(\d)/g, '$1 $2')
		.toLowerCase();
}

/**
 * Common long words → terse forms so auto-labels fit Theatre's fixed-width
 * prop column (the panel can't be widened). Custom `getLabels()` overrides
 * still win over anything generated here.
 */
const LABEL_ABBREVIATIONS: Record<string, string> = {
	aberration: 'aberr',
	ambient: 'amb',
	amplitude: 'amp',
	background: 'bg',
	chromatic: 'ca',
	direction: 'dir',
	dissolve: 'diss',
	distance: 'dist',
	emissive: 'emis',
	exclusion: 'excl',
	exit: 'ex',
	frequency: 'freq',
	harmonica: 'harm',
	intensity: 'intens',
	multiplier: 'mult',
	position: 'pos',
	procedural: 'proc',
	ripple: 'rip',
	rotation: 'rot',
	saturation: 'sat',
	smoothness: 'smooth',
	softness: 'soft',
	threshold: 'thresh',
	vignette: 'vig'
};

/** Whole-segment overrides where per-word abbreviation reads badly. */
const SEGMENT_ABBREVIATIONS: Record<string, string> = {
	ambientLight: 'amb',
	rgbSplit: 'rgb'
};

/** Singular/plural-insensitive form for dedupe ("offsets" matches "offset"). */
function dedupeStem(word: string): string {
	return word.endsWith('s') ? word.slice(0, -1) : word;
}

/**
 * Build a human-readable label for a Theatre prop from its nested config path.
 * The top-level group is dropped once paths nest 3+ deep so the section name
 * (e.g. `lights`, `spotLightOffsets`) doesn't repeat on every label — Theatre
 * already shows the sheet object name above the prop list. Words already shown
 * by an earlier segment are dropped from later ones (`fog · fog intensity` →
 * `fog·intensity`) and long words are abbreviated. Theatre's label column only
 * shows the first ~12 characters, hence the hard group abbreviations and the
 * tight `·` separator — the goal is that labels differ within that window.
 */
function makeLabel(path: string[]): string {
	const effective = path.length >= 3 ? path.slice(1) : path;
	const seen = new Set<string>();
	const segments: string[] = [];
	for (let i = 0; i < effective.length; i++) {
		const part = effective[i];
		const isLeaf = i === effective.length - 1;
		const words = camelToWords(part).split(' ');
		const kept = words.filter((w) => !/^[a-z]/.test(w) || !seen.has(dedupeStem(w)));
		for (const w of words) if (/^[a-z]/.test(w)) seen.add(dedupeStem(w));

		const override = SEGMENT_ABBREVIATIONS[part];
		if (override) {
			segments.push(override);
			continue;
		}
		// Multi-word group segments (e.g. fog layer names like `darkCircleLeft`)
		// would fill the visible window on their own — collapse them to initials
		// so the leaf survives. Leaves are never collapsed.
		const segment =
			!isLeaf && kept.length >= 2
				? kept.map((w) => (/^[a-z]/.test(w) ? w[0] : w)).join('')
				: kept.map((w) => LABEL_ABBREVIATIONS[w] ?? w).join(' ');
		if (segment) segments.push(segment);
	}
	return segments.join('·');
}

/**
 * Theatre props NOT registered on mobile (keyed by sheet-object name, values
 * are flattened prop keys). Three reasons a prop lands here:
 * - the shader path it drives doesn't exist on mobile: the reduced-quality
 *   TransitionNode never reads `caStrength`;
 * - it's a look constant with no mobile keyframes/overrides, so hiding it
 *   keeps the code default — visually identical, one less knob;
 * - it's wheel-input-only (`wheelMultiplier`) on a touch platform.
 * The radial CA pass is skipped entirely on mobile (see
 * PostProcessingGraph.addChromaticAberration), so its exclusive knobs
 * (strength/scale/splitMix) are dead there and hidden below. The shared
 * exclusion zone and breathing pulse stay registered — mobile.json keyframes
 * them and they still shape the full-frame RGBSplit, which keeps running.
 * Orphaned tracks for hidden props in mobile.json are ignored by Theatre.
 */
const MOBILE_HIDDEN_PROPS: Record<string, ReadonlySet<string>> = {
	PostProcessing: new Set([
		'chromaticStrength',
		'chromaticScale',
		'chromaticSplitMix',
		'chromaticRedTint',
		'chromaticGreenTint',
		'chromaticBlueTint',
		'fisheyeAberration',
		'rgbSplitOffset',
		'rgbSplitRadial',
		'rgbSplitGreenOffset'
	]),
	Transition: new Set(['proceduralCaStrength', 'swarmCaStrength'])
};

/**
 * Theatre props NEVER registered, on any platform (keyed by sheet-object name,
 * values are flattened prop keys). Use this when the prop is owned
 * authoritatively elsewhere and a Theatre track would be a second, racing
 * writer.
 *
 * - `TrainSlider.visible`: the slider group's visibility is gated to the
 *   Ventures page-section by `TrainSliderHost.syncPageSection` (deterministic,
 *   synchronous). Registering it here too let Theatre's async `onValuesChange`
 *   re-show the group a frame after the host hid it — the slider flicker.
 *   Theatre still authors the *reveal* (positionX slide + opacity fade);
 *   on/off is host-owned. Orphaned `visible` tracks in the JSON are ignored.
 */
const ALWAYS_HIDDEN_PROPS: Record<string, ReadonlySet<string>> = {
	TrainSlider: new Set(['visible']),
	// The pyramid base color is a fixed look constant (white = neutral metal F0
	// that tints the env reflection); the inspector still tunes it live, but it's
	// not Theatre-animated and its orphaned `baseColor` track is ignored.
	// metalness/roughness ARE registered (the feature-JSON keyframes were retuned
	// to 1 / 0.2 to match the metallic look) so they can be animated.
	MaterialPyramid: new Set(['baseColor'])
};

type KeyMap = Map<string, string[]>;

interface FlatConfig {
	flat: Record<string, FlatValue>;
	keyMap: KeyMap;
	colorFormats: Map<string, ColorFormat>;
}

function hexToRgba(hex: number): RgbaColor {
	return {
		r: ((hex >> 16) & 0xff) / 255,
		g: ((hex >> 8) & 0xff) / 255,
		b: (hex & 0xff) / 255,
		a: 1
	};
}

/**
 * Recursively flatten a nested config into camelCase keys, producing in one
 * walk everything `registerInspectable`/`unflattenConfig` need:
 * - `flat`: leaf values for Theatre props
 * - `keyMap`: flat key → nested path, used to rebuild the original shape
 * - `colorFormats`: which flat keys came from hex-number / hex-string / {r,g,b}
 *
 * Numbers/booleans become leaves. Hex colors and {r,g,b} colors emit a single
 * `{r,g,b,a}` value so Theatre can render them with `types.rgba` (color picker).
 * THREE Vector2/3 split into X/Y/Z. Other strings/arrays are not animatable
 * and are skipped.
 */
function flattenConfig(
	obj: Record<string, any>,
	prefix = '',
	path: string[] = [],
	result: FlatConfig = { flat: {}, keyMap: new Map(), colorFormats: new Map() }
): FlatConfig {
	for (const [key, value] of Object.entries(obj)) {
		if (SKIP_KEYS.has(key)) continue;
		const flatKey = joinKey(prefix, key);
		const nestedPath = [...path, key];

		if (typeof value === 'number') {
			if (key === 'color' && value > 255) {
				result.colorFormats.set(flatKey, 'hex-number');
				result.flat[flatKey] = hexToRgba(value);
			} else {
				result.flat[flatKey] = value;
			}
			result.keyMap.set(flatKey, nestedPath);
		} else if (typeof value === 'boolean') {
			result.flat[flatKey] = value;
			result.keyMap.set(flatKey, nestedPath);
		} else if (typeof value === 'string') {
			if (/^#[0-9a-fA-F]{6}$/.test(value)) {
				result.colorFormats.set(flatKey, 'hex-string');
				result.flat[flatKey] = hexToRgba(parseInt(value.slice(1), 16));
				result.keyMap.set(flatKey, nestedPath);
			}
		} else if (value && typeof value === 'object' && !Array.isArray(value)) {
			if ('r' in value && 'g' in value && 'b' in value && Object.keys(value).length <= 4) {
				result.colorFormats.set(flatKey, 'rgb');
				result.flat[flatKey] = {
					r: typeof value.r === 'number' ? value.r : 0,
					g: typeof value.g === 'number' ? value.g : 0,
					b: typeof value.b === 'number' ? value.b : 0,
					a: typeof value.a === 'number' ? value.a : 1
				};
				result.keyMap.set(flatKey, nestedPath);
			} else if ('x' in value && 'y' in value && typeof value.x === 'number') {
				result.flat[`${flatKey}X`] = value.x;
				result.keyMap.set(`${flatKey}X`, [...nestedPath, 'x']);
				result.flat[`${flatKey}Y`] = value.y;
				result.keyMap.set(`${flatKey}Y`, [...nestedPath, 'y']);
				if ('z' in value && typeof value.z === 'number') {
					result.flat[`${flatKey}Z`] = value.z;
					result.keyMap.set(`${flatKey}Z`, [...nestedPath, 'z']);
				}
			} else {
				flattenConfig(value, flatKey, nestedPath, result);
			}
		}
	}
	return result;
}

function unflattenConfig(
	flat: Record<string, FlatValue>,
	keyMap: KeyMap,
	colorFormats: Map<string, ColorFormat>
): Record<string, any> {
	const result: Record<string, any> = {};

	for (const [flatKey, value] of Object.entries(flat)) {
		const path = keyMap.get(flatKey);
		if (!path) continue;

		let current = result;
		for (let i = 0; i < path.length - 1; i++) {
			if (!(path[i] in current)) {
				current[path[i]] = {};
			}
			current = current[path[i]];
		}
		current[path[path.length - 1]] = value;
	}

	for (const [camelKey, format] of colorFormats) {
		const path = keyMap.get(camelKey);
		if (!path) continue;

		let parent = result;
		for (let i = 0; i < path.length - 1; i++) {
			parent = parent[path[i]];
			if (!parent) break;
		}
		if (!parent) continue;

		const colorKey = path[path.length - 1];
		const rgba = parent[colorKey];
		if (!isRgbaColor(rgba)) continue;

		const r = Math.max(0, Math.min(1, rgba.r));
		const g = Math.max(0, Math.min(1, rgba.g));
		const b = Math.max(0, Math.min(1, rgba.b));

		if (format === 'hex-number') {
			parent[colorKey] =
				(Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
		} else if (format === 'hex-string') {
			const hex = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
			parent[colorKey] = `#${hex.toString(16).padStart(6, '0')}`;
		} else {
			// 'rgb' — preserve original {r,g,b[,a]} shape.
			parent[colorKey] = {
				r,
				g,
				b,
				...(typeof rgba.a === 'number' ? { a: rgba.a } : {})
			};
		}
	}

	return result;
}

/**
 * Build a Set of `"<objectKey>.<propName>"` for every prop that has at least
 * one authored keyframe in any Theatre project-state node found inside `root`.
 *
 * This works both for the imported save-file JSON (`{sheetsById: ...}`) and
 * for Studio's persisted localStorage blob, which wraps the same sheet state
 * under several historic/ahistoric containers.
 */
function collectTrackedPropPaths(root: any): Set<string> {
	const tracked = new Set<string>();

	const collectFromStateNode = (stateNode: any) => {
		const sheetsById = stateNode?.sheetsById;
		if (!sheetsById || typeof sheetsById !== 'object') return;
		for (const sheet of Object.values<any>(sheetsById)) {
			const tracks = sheet?.sequence?.tracksByObject;
			if (!tracks || typeof tracks !== 'object') continue;
			for (const [objectKey, info] of Object.entries(tracks as Record<string, any>)) {
				const map = info?.trackIdByPropPath;
				const trackData = info?.trackData;
				if (!map || typeof map !== 'object') continue;
				for (const [propPathJson, trackId] of Object.entries(map)) {
					const track = trackData?.[trackId as string];
					const keyframes = track?.keyframes;
					if (!Array.isArray(keyframes) || keyframes.length === 0) continue;
					try {
						const path = JSON.parse(propPathJson);
						if (Array.isArray(path) && path.every((p) => typeof p === 'string')) {
							tracked.add(`${objectKey}.${path.join('.')}`);
						}
					} catch {
						/* malformed path key — skip */
					}
				}
			}
		}
	};

	const visit = (node: any) => {
		if (!node || typeof node !== 'object') return;
		collectFromStateNode(node);
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				for (const item of value) visit(item);
			} else if (value && typeof value === 'object') {
				visit(value);
			}
		}
	};

	visit(root);
	return tracked;
}

/**
 * Mutate a Theatre persistent-state blob in place, removing any
 * `staticOverrides.byObject[obj][prop]` whose `(obj, prop)` isn't currently
 * keyframed anywhere in that saved state.
 */
function stripUntrackedStaticOverrides(blob: any, tracked: Set<string>): void {
	const visit = (node: any) => {
		if (!node || typeof node !== 'object') return;
		const overrides = node.staticOverrides;
		if (overrides && typeof overrides === 'object') {
			const byObject = overrides.byObject;
			if (byObject && typeof byObject === 'object') {
				for (const [objKey, props] of Object.entries<any>(byObject)) {
					if (!props || typeof props !== 'object') continue;
					// Scene Boundaries holds the scene-axis section boundaries as STATIC
					// props (no keyframes) — keep them so Studio edits persist across
					// reload instead of being treated as throwaway inspector tweaks.
					if (objKey === SCENE_BOUNDARIES_OBJECT_KEY) continue;
					for (const propName of Object.keys(props)) {
						if (!tracked.has(`${objKey}.${propName}`)) {
							delete props[propName];
						}
					}
					if (Object.keys(props).length === 0) {
						delete byObject[objKey];
					}
				}
			}
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				for (const item of value) visit(item);
			} else if (value && typeof value === 'object') {
				visit(value);
			}
		}
	};
	visit(blob);
}

function clearPersistentSequenceEditorViewport(
	blob: any,
	projectId: string,
	sheetId: string
): void {
	const sequenceState =
		blob?.ahistoric?.projects?.stateByProjectId?.[projectId]?.stateBySheetId?.[sheetId]?.sequence;
	if (!sequenceState || typeof sequenceState !== 'object') return;
	delete sequenceState.focusRange;
	delete sequenceState.clippedSpaceRange;
}

/** Hand-tuned Studio slider ranges for the train-slider exit keys (lowercased). */
const EXIT_RANGES: Record<string, [number, number]> = {
	exitprogressstart: [0, 1],
	exituvstart: [0, 1],
	exitdissolvestart: [0, 1],
	exitcorefadestart: [0, 1],
	exitstagger: [0, 0.55],
	exitconverge: [0, 1],
	exitsidespread: [-0.5, 0.5],
	exitarc: [-1, 1],
	exitdrop: [-1, 1],
	exitfocusarc: [-0.5, 0.5],
	exitdepth: [0, 10],
	exitdistancedepth: [0, 2],
	exitindexdepth: [-2, 3],
	exitscale: [0.05, 1.4],
	exitrotationx: [-20, 20],
	exitrotationxarc: [-20, 20],
	exitrotationy: [-35, 35],
	exitrotationz: [-35, 35],
	exitrotationydistance: [-10, 10],
	exitrotationzindex: [-15, 15],
	exituvradial: [0, 0.25],
	exituvvertical: [0, 0.15],
	exituvripplex: [0, 0.08],
	exituvrippley: [0, 0.04],
	exitdissolveedgewidth: [0.02, 1],
	exitdissolveripple: [0, 0.25]
};

function guessRange(key: string, value: number): [number, number] {
	const k = key.toLowerCase();

	if (k.startsWith('fog')) {
		if (k.includes('intensity')) return [0, 8];
		if (k.includes('speed')) return [-10, 10];
		if (k.includes('opacity')) return [0, 1];
	}

	const exitRange = EXIT_RANGES[k];
	if (exitRange) return exitRange;

	if (k.includes('opacity') || k.includes('alpha') || k.includes('saturation')) return [0, 1];
	if (/[a-z](r|g|b)$/i.test(key) && key.length > 1) {
		const base = key.slice(0, -1).toLowerCase();
		if (base.includes('color') || base.includes('tint') || base.includes('emissive')) return [0, 1];
	}
	if (k.includes('roughness') || k.includes('metalness')) return [0, 1];
	// Vignette softness gets a wider ceiling than other smoothness knobs: the
	// VignetteNode maps it via ±smoothness*0.05 onto the falloff band, so values
	// past 2 (up to ~15) produce a much more gradual edge. Roundness/penumbra
	// keep [0, 2] — they don't benefit from the extra range.
	// Vignette fade-band width = outerBound − innerBound, set directly: 0 = a
	// razor-thin/sharp edge, larger = a wider/softer fade. 2 covers the frame.
	if (k === 'vignettewidth') return [0, 2];
	// Vignette band-center radius (0..1). 0.5 reproduces the original position.
	if (k === 'vignettecenter') return [0, 1];
	// Shared CA exclusion zone (Visuals.chromatic): center is UV (0.5,0.5 =
	// screen center), radius/feather are UV-distance fractions. Pin these to
	// [0,1] so the Studio sliders aren't the ±30 the generic `endsWith('X')`
	// branch below would otherwise hand centerX/centerY — which slides the zone
	// far off-screen and makes the knobs look dead.
	if (k === 'chromaticcenterx' || k === 'chromaticcentery') return [0, 1];
	if (k === 'chromaticexclusionradius' || k === 'chromaticexclusionfeather') return [0, 1];
	// Shared CA breathing pulse (Visuals.chromatic): amplitude added to the
	// radial CA scale / used as a ±fraction on the RGB-split offset, plus its
	// frequency. Pinned so the generic 'scale'/'speed' branches below don't
	// hand them a huge or negative range.
	if (k === 'chromaticbreathingamount') return [0, 2];
	if (k === 'chromaticbreathingspeed') return [0, 5];
	// RGB-split green displacement is a 0..1 FRACTION of the red/blue offset, not a
	// world/UV offset — pin it to [0,1] so the generic 'offset' → [-30,30] branch
	// below doesn't hand it a slider where the useful band is invisible.
	if (k === 'rgbsplitgreenoffset') return [0, 1];
	// Transition dissolve-gradient softness (procedural/swarm `maskSoftness`):
	// half-width of the smoothstep band around the sweep threshold. Past ~0.5 the
	// band exceeds the [0,1] sweep axis so the dissolve no longer resolves to a
	// clean on/off — [0, 2] gives authoring headroom above that on purpose.
	if (k.includes('masksoftness')) return [0, 2];
	// Cloud transition sweep ramps (Transition.fillOneToTwo / fillTwoToThree) are
	// 0→1 — the keyframe POSITION carries the timing, the value is the sweep
	// amount. Pin the value range to [0, 1].
	if (k === 'fillonetotwo' || k === 'filltwotothree') return [0, 1];
	// Train-slider layout: gap is a world-unit spacing between cards (card
	// width ~8); negative pulls them together / overlapping since the step
	// multiplier already spaces them at 0. Roundness is a UV-space corner
	// radius where 0.5 is a full ellipse — keep its slider in the useful band.
	if (k === 'layoutgap') return [-3, 2];
	if (k === 'layoutroundness') return [0, 0.5];
	// Train-slider color gain (TrainSlider.color.intensity): RGB multiplier on the
	// graded slide color. 0 = black, 1 = unchanged, >1 = punchier. Pinned so the
	// generic 'intensity' branch below doesn't hand it a dead [0, 500] slider.
	if (k === 'colorintensity') return [0, 3];
	if (k.includes('penumbra') || k.includes('smoothness') || k.includes('roundness')) return [0, 2];
	if (k.includes('angle')) return [0, Math.PI];
	if (k.includes('intensity') || k.includes('strength')) return [0, Math.max(value * 5, 500)];
	if (k.includes('distance') || k.includes('decay')) return [0, Math.max(value * 3, 10)];
	if (k.includes('scale')) return [0, Math.max(value * 5, 10)];
	if (k.includes('speed') || k.includes('velocity')) return [-5, Math.max(value * 5, 5)];
	if (
		k.includes('offset') ||
		k.includes('position') ||
		// Axis suffix on the original camelCase key — `k` is lowercased, so
		// testing it for 'X'/'Y'/'Z' would never match (old bug).
		key.endsWith('X') ||
		key.endsWith('Y') ||
		key.endsWith('Z')
	) {
		return [-30, 30];
	}
	if (k.includes('count') || k.includes('segments') || k.includes('octaves')) {
		return [1, Math.max(value * 3, 10)];
	}
	if (k.includes('progress')) return [0, 1];

	if (value < 0) return [value * 3, Math.abs(value) * 3 || 1];
	if (value === 0) return [0, 1];
	return [Math.min(0, value * 3), Math.max(value * 3, 1)];
}

/**
 * Theatre.js owner for the scroll-driven scene.
 *
 * - One sheet `ScrollTimeline` whose sequence position is bound to normalized
 *   scroll progress (`setProgress(0..1)` on each scroll tick).
 * - Each `Inspectable` is registered as a Theatre object; its nested
 *   `getConfig()` is auto-flattened to camelCase props, and `applyConfig()` is
 *   invoked on every value change with the rebuilt nested object.
 * - Two manual objects (`Particles`, `Visibility`) own the per-system opacity
 *   and group-visibility scalars that don't live on any single Inspectable.
 * - Studio is dynamic-imported only when `?debug=true`. State is bundled from
 *   `theatre/features/{desktop,mobile}.json` — picked once per page load by
 *   `MainScene`; artists re-export from Studio over the matching file. Studio
 *   playhead drags also scrub the page scroll (dev-only).
 */
export class TheatreController {
	private static readonly PROJECT_ID = 'dao-scene';
	private static readonly SHEET_ID = 'ScrollTimeline';
	private project: IProject | null = null;
	private sheet: ISheet | null = null;
	private unsubscribes: VoidFn[] = [];
	private theatreReady = false;
	private debugMode = false;
	/** Filters MOBILE_HIDDEN_PROPS out of registration — see that map's docs. */
	private isMobile = false;
	private reapplyScrollConfig: (() => void) | null = null;
	/** Last value we wrote via setProgress — used to ignore echo events from the
	 *  scroll→sequence path when reflecting sequence→scroll in Studio. */
	private lastWrittenSequencePos = -1;
	/** Timestamp (performance.now()) until which forward setProgress writes are
	 *  suppressed because the Studio playhead is being scrubbed. The reverse map
	 *  (`registerScrollConfigs`) now inverts the same piecewise section→scene
	 *  remap the forward path applies, so the round-trip is near-symmetric — but
	 *  residual drift remains (Lenis pixel quantization, the scene-progress clamp
	 *  near the timeline ends). Holding off the write-back keeps that drift from
	 *  snapping the playhead away from where the user is dragging; while Studio
	 *  scrubs it's the source of truth. */
	private scrubActiveUntil = 0;
	private static readonly SCRUB_HOLD_MS = 250;
	/**
	 * Cached sequence length (in Theatre units) read from the loaded sheet —
	 * the JSON's `sequence.length` is the single source of truth. Scaling it
	 * up in the JSON gives Studio more horizontal room per keyframe at the same
	 * `subUnitsPerUnit`, provided every keyframe `position` is scaled by the
	 * same factor so playback at a given scroll progress lands on the same keys.
	 */
	private timelineLength = 1;
	/**
	 * Pinned to Theatre 0.4's current default so Studio persistence remains on
	 * a stable key across deploys.
	 */
	private static readonly STUDIO_PERSISTENCE_KEY = 'theatre-0.5';
	/** Suffix Theatre 0.7 appends to `persistenceKey` for the localStorage entry holding sheet state. */
	private static readonly STUDIO_STATE_LS_SUFFIX = '.persistent';
	/** Original `localStorage.setItem` saved while the persistence filter is active. */
	private originalLocalStorageSetItem: typeof Storage.prototype.setItem | null = null;

	async init(stateJson: object, debugMode: boolean, isMobile = false): Promise<void> {
		this.debugMode = debugMode;
		this.isMobile = isMobile;
		if (debugMode) {
			const persistenceKey = TheatreController.STUDIO_PERSISTENCE_KEY + version;
			this.installPersistenceFilter(persistenceKey);
			try {
				const studio = await import('@theatre/studio');
				studio.default.initialize({
					persistenceKey
				});
				requestAnimationFrame(() => {
					const studioRoot = document.getElementById('theatrejs-studio-root');
					if (studioRoot) {
						studioRoot.setAttribute('data-lenis-prevent', '');
						studioRoot.addEventListener('wheel', (e) => e.stopPropagation(), true);
						studioRoot.addEventListener('touchmove', (e) => e.stopPropagation(), true);
					}
				});
			} catch (e) {
				console.warn('Theatre.js Studio failed to load:', e);
			}
		}

		this.project = getProject(TheatreController.PROJECT_ID, { state: stateJson });
		await this.project.ready;
		this.sheet = this.project.sheet(TheatreController.SHEET_ID);
		this.timelineLength = Math.max(1e-6, val(this.sheet.sequence.pointer.length));
		this.theatreReady = true;
	}

	/**
	 * Keep Theatre Studio persistence, but strip any static override whose prop
	 * does not have at least one authored keyframe in the same saved blob.
	 *
	 * Result:
	 * - timeline edits persist across refresh
	 * - plain inspector tweaks without a keyframe are session-only
	 */
	private installPersistenceFilter(persistenceKey: string): void {
		if (typeof window === 'undefined') return;
		const stateKey = persistenceKey + TheatreController.STUDIO_STATE_LS_SUFFIX;

		try {
			const existing = window.localStorage.getItem(stateKey);
			if (existing) {
				const parsed = JSON.parse(existing);
				const tracked = collectTrackedPropPaths(parsed);
				stripUntrackedStaticOverrides(parsed, tracked);
				clearPersistentSequenceEditorViewport(
					parsed,
					TheatreController.PROJECT_ID,
					TheatreController.SHEET_ID
				);
				window.localStorage.setItem(stateKey, JSON.stringify(parsed));
			}
		} catch (e) {
			console.warn('[TheatreController] failed to clean Studio localStorage:', e);
		}

		const original = window.localStorage.setItem.bind(window.localStorage);
		this.originalLocalStorageSetItem = original;
		window.localStorage.setItem = function (k: string, v: string): void {
			if (k === stateKey) {
				try {
					const parsed = JSON.parse(v);
					const tracked = collectTrackedPropPaths(parsed);
					stripUntrackedStaticOverrides(parsed, tracked);
					v = JSON.stringify(parsed);
				} catch {
					/* malformed write — let it through unchanged */
				}
			}
			original(k, v);
		};
	}

	private uninstallPersistenceFilter(): void {
		if (!this.originalLocalStorageSetItem || typeof window === 'undefined') return;
		delete (window.localStorage as { setItem?: typeof Storage.prototype.setItem }).setItem;
		this.originalLocalStorageSetItem = null;
	}

	isReady(): boolean {
		return this.theatreReady;
	}

	registerObjects(deps: TheatreDependencies): void {
		if (!this.sheet) return;

		for (const [name, inspectable] of deps.inspectables) {
			this.registerInspectable(name, inspectable);
		}

		this.registerParticles(deps);
		this.registerVisibility(deps);
		this.registerSceneBoundaries();
		if (deps.modelRotationController) this.registerRotation(deps);
		if (deps.cameraFov) this.registerCamera(deps.cameraFov);
		if (deps.gridPlane) this.registerGrid(deps.gridPlane);
		if (deps.sceneInvert) this.registerCanvas(deps.sceneInvert);
		if (deps.scroll) this.registerScrollConfigs(deps.scroll);
	}

	private registerInspectable(name: string, inspectable: Inspectable): void {
		if (!this.sheet) return;
		if (typeof inspectable.applyConfig !== 'function') return;
		if (typeof inspectable.getConfig !== 'function') return;

		const config = inspectable.getConfig();
		const { flat, keyMap, colorFormats } = flattenConfig(config);
		const customLabels = inspectable.getLabels?.() ?? {};

		// Theatre demands alphanumeric keys starting with a letter — drop the
		// rest with a warning rather than crashing the whole panel.
		const isValidKey = (k: string) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(k);
		const mobileHidden = this.isMobile ? MOBILE_HIDDEN_PROPS[name] : undefined;
		const alwaysHidden = ALWAYS_HIDDEN_PROPS[name];
		const theatreProps: Record<string, any> = {};
		for (const [key, value] of Object.entries(flat)) {
			if (alwaysHidden?.has(key) || mobileHidden?.has(key)) continue;
			if (!isValidKey(key)) {
				console.warn(
					`[TheatreController] skipping prop "${name}.${key}" — keys must be alphanumeric starting with a letter`
				);
				continue;
			}
			const path = keyMap.get(key);
			const label = customLabels[key] ?? (path ? makeLabel(path) : undefined);
			if (typeof value === 'number') {
				theatreProps[key] = types.number(value, { range: guessRange(key, value), label });
			} else if (typeof value === 'boolean') {
				theatreProps[key] = types.boolean(value, label ? { label } : undefined);
			} else if (isRgbaColor(value)) {
				theatreProps[key] = types.rgba(
					{
						r: value.r,
						g: value.g,
						b: value.b,
						a: typeof value.a === 'number' ? value.a : 1
					},
					label ? { label } : undefined
				);
			}
		}

		if (Object.keys(theatreProps).length === 0) return;

		const obj = this.sheet.object(name, theatreProps, { reconfigure: true });
		const unsub = obj.onValuesChange((values) => {
			const nested = unflattenConfig(values as Record<string, FlatValue>, keyMap, colorFormats);
			inspectable.applyConfig?.(nested);
		});
		this.unsubscribes.push(unsub);
	}

	private registerParticles(deps: TheatreDependencies): void {
		if (!this.sheet) return;

		const whiteRgba = { r: 1, g: 1, b: 1, a: 1 };
		const obj = this.sheet.object(
			'Particles',
			{
				octagonOpacity: types.number(1, { range: [0, 1] }),
				cubesOpacity: types.number(0, { range: [0, 1] }),
				pyramidsOpacity: types.number(0, { range: [0, 1] }),
				forestOpacity: types.number(0, { range: [0, 1] }),
				signTreeOpacity: types.number(0, { range: [0, 1] }),

				octagonColor: types.rgba(whiteRgba),
				cubesColor: types.rgba(whiteRgba),
				forestColor: types.rgba(whiteRgba),
				signTreeColor: types.rgba(whiteRgba),

				octagonEmissive: types.number(1, { range: [0, 5] }),
				cubesEmissive: types.number(1, { range: [0, 5] }),
				forestEmissive: types.number(1, { range: [0, 5] }),
				signTreeEmissive: types.number(1, { range: [0, 5] }),

				octagonSize: types.number(1, { range: [0, 5] }),
				cubesSize: types.number(1, { range: [0, 5] }),
				pyramidsSize: types.number(1, { range: [0, 5] }),
				forestSize: types.number(1, { range: [0, 5] }),
				signTreeSize: types.number(1, { range: [0, 5] })
			},
			{ reconfigure: true }
		);

		const rgbaToHex = (c: { r: number; g: number; b: number }): number =>
			(Math.round(Math.max(0, Math.min(1, c.r)) * 255) << 16) |
			(Math.round(Math.max(0, Math.min(1, c.g)) * 255) << 8) |
			Math.round(Math.max(0, Math.min(1, c.b)) * 255);

		const unsub = obj.onValuesChange((values) => {
			deps.particleSystems.octagon?.setOpacity(values.octagonOpacity);
			for (const e of deps.particleSystems.octagonExtras) e.setOpacity(values.octagonOpacity);
			deps.particleSystems.cubes?.setOpacity(values.cubesOpacity);
			for (const sys of deps.particleSystems.pyramids) sys.setOpacity(values.pyramidsOpacity);
			for (const sys of deps.particleSystems.forest) sys.setOpacity(values.forestOpacity);
			for (const sys of deps.particleSystems.signTree) sys.setOpacity(values.signTreeOpacity);

			const octagonHex = rgbaToHex(values.octagonColor);
			deps.particleSystems.octagon?.setBaseColor(octagonHex);
			for (const e of deps.particleSystems.octagonExtras) e.setBaseColor(octagonHex);
			const cubesHex = rgbaToHex(values.cubesColor);
			deps.particleSystems.cubes?.setBaseColor(cubesHex);
			const forestHex = rgbaToHex(values.forestColor);
			for (const sys of deps.particleSystems.forest) sys.setBaseColor(forestHex);
			const signTreeHex = rgbaToHex(values.signTreeColor);
			for (const sys of deps.particleSystems.signTree) sys.setBaseColor(signTreeHex);

			deps.particleSystems.octagon?.setEmissiveIntensity(values.octagonEmissive);
			for (const e of deps.particleSystems.octagonExtras)
				e.setEmissiveIntensity(values.octagonEmissive);
			deps.particleSystems.cubes?.setEmissiveIntensity(values.cubesEmissive);
			// Pyramid emissive is shared with the VAT pillar mesh, so it is driven
			// at the material level via the `MaterialPyramid` inspectable rather
			// than per-particle-system here — avoids two writers fighting over the
			// same uniform per sheet tick.
			for (const sys of deps.particleSystems.forest)
				sys.setEmissiveIntensity(values.forestEmissive);
			for (const sys of deps.particleSystems.signTree)
				sys.setEmissiveIntensity(values.signTreeEmissive);

			deps.particleSystems.octagon?.setSpriteScaleMultiplier(values.octagonSize);
			for (const e of deps.particleSystems.octagonExtras)
				e.setSpriteScaleMultiplier(values.octagonSize);
			deps.particleSystems.cubes?.setSpriteScaleMultiplier(values.cubesSize);
			for (const sys of deps.particleSystems.pyramids)
				sys.setSpriteScaleMultiplier(values.pyramidsSize);
			for (const sys of deps.particleSystems.forest)
				sys.setSpriteScaleMultiplier(values.forestSize);
			for (const sys of deps.particleSystems.signTree)
				sys.setSpriteScaleMultiplier(values.signTreeSize);
		});
		this.unsubscribes.push(unsub);
	}

	private registerVisibility(deps: TheatreDependencies): void {
		if (!this.sheet) return;

		const obj = this.sheet.object(
			'Visibility',
			{
				cubesVisible: types.boolean(false),
				pyramidsVisible: types.boolean(false),
				// Forest is decomposed into three independently-authorable toggles so
				// the timeline can reveal e.g. only the hero tree at a given point.
				mainTreeVisible: types.boolean(false, { label: 'main tree' }),
				otherTreesVisible: types.boolean(false, { label: 'other trees' }),
				cityVisible: types.boolean(false, { label: 'city' }),
				gridVisible: types.boolean(true)
			},
			{ reconfigure: true }
		);

		const unsub = obj.onValuesChange((values) => {
			if (deps.objectGroups.cubes) deps.objectGroups.cubes.visible = values.cubesVisible;
			if (deps.objectGroups.pyramids) deps.objectGroups.pyramids.visible = values.pyramidsVisible;

			// Each forest toggle drives its mesh group(s) AND gates the matching
			// particle cloud (clouds live on the scene root, so `group.visible`
			// alone can't reach them). SignTree particles ride BIG_TREEE_1 (main
			// tree); the near-tree Forest particles ride the other trees. City has
			// no particle cloud.
			if (deps.objectGroups.forestMainTree)
				deps.objectGroups.forestMainTree.visible = values.mainTreeVisible;
			for (const group of deps.objectGroups.forestOtherTrees)
				group.visible = values.otherTreesVisible;
			if (deps.objectGroups.forestCity)
				deps.objectGroups.forestCity.visible = values.cityVisible;

			for (const sys of deps.particleSystems.signTree) sys.setVisibilityGate(values.mainTreeVisible);
			for (const sys of deps.particleSystems.forest) sys.setVisibilityGate(values.otherTreesVisible);

			deps.gridPlane?.setVisible(values.gridVisible);
		});
		this.unsubscribes.push(unsub);
	}

	private registerRotation(deps: TheatreDependencies): void {
		if (!this.sheet || !deps.modelRotationController) return;

		const obj = this.sheet.object(
			'Rotation',
			{
				cubesRotationSpeed: types.number(18, { range: [-90, 90], label: 'cubes rot speed' }),
				pyramidsRotationSpeed: types.number(-12, { range: [-90, 90], label: 'pyramids rot speed' })
			},
			{ reconfigure: true }
		);

		const controller = deps.modelRotationController;
		const unsub = obj.onValuesChange((values) => {
			controller.setCubesRotationSpeed(values.cubesRotationSpeed);
			controller.setPyramidsRotationSpeed(values.pyramidsRotationSpeed);
		});
		this.unsubscribes.push(unsub);
	}

	/**
	 * Single `fov` prop per platform — the desktop/mobile state JSONs each carry
	 * their own value, so no per-breakpoint props are needed. The default is the
	 * responsive breakpoint value for the current platform.
	 */
	private registerCamera(cameraFovDeps: NonNullable<TheatreDependencies['cameraFov']>): void {
		if (!this.sheet) return;

		const obj = this.sheet.object(
			'Camera',
			{
				fov: types.number(cameraFovDeps.initial, { range: [5, 90] })
			},
			{ reconfigure: true }
		);

		const unsub = obj.onValuesChange((values) => {
			cameraFovDeps.setFov(values.fov);
		});
		this.unsubscribes.push(unsub);
	}

	/**
	 * The page-section SCENE boundaries — where each section's slice of the baked
	 * 3D clip begins — as STATIC props in FRAME units (0..totalDuration). Dragging
	 * a value republishes the reactive `sceneRangeState`, which re-paces the
	 * scroll→scene map so the render at the current scroll follows live (see the
	 * `+page` version effect → `siteRuntime.refresh()`). Defaults mirror
	 * `SCENE_MANIFEST`; `onValuesChange` fires once on subscribe, so persisted/baked
	 * values apply at boot. Persistence is kept via the `SCENE_BOUNDARIES_OBJECT_KEY`
	 * exemption in `stripUntrackedStaticOverrides`. NOTE: this re-paces the mapping
	 * only — the baked geometry and vignette keyframes stay put.
	 */
	private registerSceneBoundaries(): void {
		if (!this.sheet) return;
		const frameRange: [number, number] = [0, SCENE_MANIFEST.totalDuration];
		const obj = this.sheet.object(
			SCENE_BOUNDARIES_OBJECT_KEY,
			{
				aboutStart: types.number(DEFAULT_SCENE_BOUNDARIES.aboutStart, { range: frameRange }),
				servicesStart: types.number(DEFAULT_SCENE_BOUNDARIES.servicesStart, { range: frameRange }),
				collaborationStart: types.number(DEFAULT_SCENE_BOUNDARIES.collaborationStart, {
					range: frameRange
				}),
				venturesStart: types.number(DEFAULT_SCENE_BOUNDARIES.venturesStart, { range: frameRange }),
				partnersStart: types.number(DEFAULT_SCENE_BOUNDARIES.partnersStart, { range: frameRange }),
				careersStart: types.number(DEFAULT_SCENE_BOUNDARIES.careersStart, { range: frameRange }),
				contactStart: types.number(DEFAULT_SCENE_BOUNDARIES.contactStart, { range: frameRange })
			},
			{ reconfigure: true }
		);
		const unsub = obj.onValuesChange((values) => setSceneBoundaries(values));
		this.unsubscribes.push(unsub);
	}

	private registerGrid(gridPlane: GridPlane): void {
		if (!this.sheet) return;

		const defaults = GridPlane.DEFAULTS;
		const defaultColor = new THREE.Color(defaults.dotColor);

		const obj = this.sheet.object(
			'Grid',
			{
				density: types.number(defaults.density, { range: [1, 500] }),
				dotRadius: types.number(defaults.dotRadius, { range: [0, 0.5] }),
				dotSoftness: types.number(defaults.dotSoftness, { range: [0, 0.2] }),
				dotColor: types.rgba({ r: defaultColor.r, g: defaultColor.g, b: defaultColor.b, a: 1 }),
				opacity: types.number(defaults.opacity, { range: [0, 1] })
			},
			{ reconfigure: true }
		);

		const tempColor = new THREE.Color();
		const unsub = obj.onValuesChange((values) => {
			gridPlane.setDensity(values.density);
			gridPlane.setDotRadius(values.dotRadius);
			gridPlane.setDotSoftness(values.dotSoftness);
			tempColor.setRGB(values.dotColor.r, values.dotColor.g, values.dotColor.b);
			gridPlane.setDotColor(tempColor);
			gridPlane.setOpacity(values.opacity);
		});
		this.unsubscribes.push(unsub);
	}

	/**
	 * Canvas-level effects driven by Theatre keyframes:
	 *  - `invertAmount` (0..1) is forwarded continuously so the renderer can
	 *    lerp background/vignette/rim toward the inverted palette. Particles
	 *    and octagon snap at 0.5 inside `MainScene.setSceneInverted` because
	 *    their blend-mode swap can't be tweened. The reveal between Services
	 *    and the rest of the page is handled by the pre-existing cloud
	 *    transition between scene channels, so no continuous wipe is needed
	 *    on top.
	 *  - The 0.5 threshold is also mirrored to a `data-scene-invert`
	 *    attribute on the document root for any CSS hooks outside the canvas
	 *    (CSS doesn't need the in-between values).
	 *
	 * The CA tint flip is intentionally NOT triggered here — `Visuals.chromatic`
	 * now owns the per-channel tints as Theatre props. Auto-flipping from this
	 * handler would clobber artist keyframes mid-frame. Inversion-style CA
	 * looks should be authored as tint keyframes alongside `invertAmount`.
	 */
	private registerCanvas(sceneInvertDeps: NonNullable<TheatreDependencies['sceneInvert']>): void {
		if (!this.sheet) return;

		const defaultInvertColor = sceneInvertDeps.invertBackgroundColor;
		const obj = this.sheet.object(
			'Canvas',
			{
				invertAmount: types.number(0, { range: [0, 1] }),
				invertBackgroundColor: types.rgba(
					{
						r: defaultInvertColor.r,
						g: defaultInvertColor.g,
						b: defaultInvertColor.b,
						a: 1
					},
					{ label: 'invert bg color' }
				)
			},
			{ reconfigure: true }
		);

		let lastAmount = -1;
		let lastSceneInverted: boolean | null = null;
		const tempColor = new THREE.Color();

		const unsub = obj.onValuesChange((values) => {
			tempColor.setRGB(
				values.invertBackgroundColor.r,
				values.invertBackgroundColor.g,
				values.invertBackgroundColor.b
			);
			sceneInvertDeps.invertBackgroundColor.copy(tempColor);

			const amount = Math.max(0, Math.min(1, values.invertAmount));
			if (amount === lastAmount) return;
			lastAmount = amount;
			sceneInvertDeps.setInverted(amount);
			const sceneInverted = amount > 0.5;
			if (sceneInverted !== lastSceneInverted) {
				lastSceneInverted = sceneInverted;
				if (typeof document !== 'undefined') {
					document.documentElement.dataset.sceneInvert = sceneInverted ? '1' : '0';
				}
			}
		});
		this.unsubscribes.push(unsub);
	}

	/**
	 * Lenis scroll config (page height + smoothing). The active platform's JSON
	 * (`theatre/features/{desktop,mobile}.json`) carries its own `Scroll`
	 * staticOverrides; this controller is platform-agnostic.
	 *
	 * `lenisInstance` is dereferenced on every change because Lenis is built
	 * after `registerObjects` runs (siteRuntime.ts wires it via setLenisInstance).
	 *
	 * In `?debug=true`, also wires the *reverse* — dragging the Theatre playhead
	 * scrubs the page scroll so the rendered scene matches the timeline position.
	 */
	private registerScrollConfigs(scrollDeps: ScrollConfigDeps): void {
		if (!this.sheet) return;

		const lenisAtInit = scrollDeps.lenisInstance.instance;
		const initialHeight = Math.round(scrollDeps.virtualScrollHeight.h || 5000);

		const obj = this.sheet.object(
			'Scroll',
			{
				lerp: types.number(lenisAtInit?.options.lerp ?? 0.055, { range: [0.01, 1] }),
				syncTouchLerp: types.number(lenisAtInit?.options.syncTouchLerp ?? 0.055, {
					range: [0.01, 1],
					label: 'sync touch lerp'
				}),
				// wheelMultiplier only affects wheel events — meaningless on touch,
				// so the mobile panel drops it (Lenis keeps its platform default).
				...(this.isMobile
					? {}
					: {
							wheelMultiplier: types.number(lenisAtInit?.options.wheelMultiplier ?? 0.62, {
								range: [0.1, 5],
								label: 'wheel mult'
							})
						}),
				touchMultiplier: types.number(lenisAtInit?.options.touchMultiplier ?? 0.9, {
					range: [0.1, 5],
					label: 'touch mult'
				}),
				scrollHeight: types.number(initialHeight, { range: [3000, 100000] })
			},
			{ reconfigure: true }
		);

		let lastScrollHeight: number | null = null;

		type ScrollValues = {
			lerp: number;
			syncTouchLerp: number;
			touchMultiplier: number;
			scrollHeight: number;
			wheelMultiplier?: unknown;
		};

		const apply = (values: ScrollValues) => {
			const lenis = scrollDeps.lenisInstance.instance;
			if (lenis) {
				lenis.options.lerp = values.lerp;
				lenis.options.syncTouchLerp = values.syncTouchLerp;
				// Absent on mobile (prop not registered) — keep Lenis' default.
				if (typeof values.wheelMultiplier === 'number') {
					lenis.options.wheelMultiplier = values.wheelMultiplier;
				}
				lenis.options.touchMultiplier = values.touchMultiplier;
			}
			const nextHeight = Math.round(values.scrollHeight);
			if (nextHeight !== lastScrollHeight) {
				lastScrollHeight = nextHeight;
				scrollDeps.virtualScrollHeight.h = nextHeight;
				lenis?.resize();
			}
		};

		this.unsubscribes.push(obj.onValuesChange(apply));

		// Lenis is created after registerObjects runs. Re-flush current values
		// when it attaches.
		this.reapplyScrollConfig = () => apply(obj.value as ScrollValues);

		if (this.debugMode) {
			// Sequence position → page scroll: invert the forward
			// `scroll → sequence.position` chain so the page lands where the
			// playhead points. Forward is:
			//   global → mapGlobalProgressToSceneProgress → sceneProgress
			//          → intro-tween affine + mapToContentTimelineProgress
			//          → contentProgress → seqPos = contentProgress * length
			// The intro tween fills the timeline up to the intro cutoff and
			// content scroll resumes from there, so those two middle steps cancel
			// (the tween's endProgress equals the timeline's introCutoff): content
			// progress equals scene-timeline progress. So we only need to invert
			// the section→scene range remap to recover the *global* scroll progress
			// Lenis pixels measure. (The previous code skipped that inverse and fed
			// scene progress straight into Lenis, scrolling to the wrong physical
			// position and desyncing the scene on a click.)
			const sequencePointer = this.sheet.sequence.pointer.position;
			const unsub = onChange(sequencePointer, (pos) => {
				const lenis = scrollDeps.lenisInstance.instance;
				if (!lenis) return;
				// Loop guard: ignore changes we caused via setProgress.
				if (Math.abs(pos - this.lastWrittenSequencePos) < 1e-4) return;
				// Studio is now the source of truth for sequence.position. Hold off
				// the forward write-back briefly so residual round-trip drift can't
				// snap the playhead away from where the user is dragging.
				this.lastWrittenSequencePos = pos;
				this.scrubActiveUntil = performance.now() + TheatreController.SCRUB_HOLD_MS;
				const sceneProgress = pos / this.timelineLength;
				const globalProgress = scrollDeps.mapSceneProgressToGlobal(sceneProgress);
				const limit = Math.max(1, lenis.limit);
				lenis.scrollTo(globalProgress * limit, { immediate: true, force: true });
			});
			this.unsubscribes.push(unsub);
		}
	}

	setProgress(normalizedProgress: number): void {
		if (!this.sheet) return;
		// Suppress write-back during an active Studio scrub — Studio owns
		// sequence.position while the playhead is being dragged.
		if (this.debugMode && this.scrubActiveUntil > performance.now()) return;
		const clamped = Math.max(0, Math.min(1, normalizedProgress));
		const seqPos = clamped * this.timelineLength;
		// Skip same-position rewrites. Theatre's position setter invalidates its
		// state atom on EVERY write (gotoPosition → setByPointer), so writing the
		// unchanged position each frame re-derives every sequenced prop and
		// re-fires onValuesChange — re-asserting keyframed values 60×/s, which
		// instantly clobbered any live Studio edit and made the panel feel dead.
		// Writing only on actual movement leaves Studio authoritative while idle.
		if (Math.abs(seqPos - this.lastWrittenSequencePos) < 1e-9) return;
		this.lastWrittenSequencePos = seqPos;
		this.sheet.sequence.position = seqPos;
	}

	/** Re-push the current `Scroll` Theatre values to Lenis. Call after Lenis attaches. */
	notifyLenisReady(): void {
		this.reapplyScrollConfig?.();
	}

	dispose(): void {
		for (const unsub of this.unsubscribes) {
			unsub();
		}
		this.unsubscribes = [];
		this.uninstallPersistenceFilter();
		this.sheet = null;
		this.project = null;
		this.theatreReady = false;
		this.debugMode = false;
		this.isMobile = false;
		this.reapplyScrollConfig = null;
		this.lastWrittenSequencePos = -1;
		this.scrubActiveUntil = 0;
		this.timelineLength = 1;
	}
}
