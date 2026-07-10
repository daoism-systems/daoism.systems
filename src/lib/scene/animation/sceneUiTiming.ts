export const PROGRESS_EPSILON = 0.0001;

// Page-section index for Ventures (the section that owns the train slider).
// Matches `SECTION_TEMPLATES` order in `$lib/config/sectionTimeline.ts`.
export const VENTURES_SECTION_INDEX = 4;

// ── Cloud scene-to-scene transitions ────────────────────────────────────────
// Two diagonal wipes on the content timeline (same scale as SCENE_MANIFEST and
// `mapToContentTimelineProgress`): 1→2 (procedural look) then 2→3 (swarm look).
//
// AUTHORING: each wipe is a keyframed 0→1 ramp on the `Transition` Theatre
// object (`fillOneToTwo` / `fillTwoToThree`). The keyframe POSITIONS are *when*
// the wipe happens; the 0→1 value is the sweep amount. `CLOUD_TRANSITION_FILL`
// mirrors the live interpolated values (written by `Transition.applyConfig`
// every tick) — that is what the cross-fade + stage router read, so dragging a
// marker in Studio retimes the wipe *and* the scene-content swap live.
//
// FALLBACK: `CLOUD_TRANSITION_TIMING` holds the default scroll-position
// thresholds, used two ways — (1) `resolveCloudFill` synthesizes the 0→1 ramps
// from it when no keyframes are authored, so the build is never transition-less
// (a dropped/absent track degrades to the legacy threshold behavior), and (2)
// the warmup shader-compile pins read it. At init `applyCloudKeyframeState`
// overwrites these with the authored keyframe span so warmup + fallback track
// the authored timing.
export const CLOUD_TRANSITION_TIMING: {
	fillInStart: number;
	fillInEnd: number;
	fadeOutStart: number;
	fadeOutEnd: number;
} = {
	fillInStart: 0.39,
	fillInEnd: 0.42,
	fadeOutStart: 0.58,
	fadeOutEnd: 0.6255
};

// Live 0→1 sweep amounts mirrored from the `Transition` Theatre keyframes.
// The `authored*` flags are set LAZILY at runtime (by `Transition.applyConfig`),
// PER RAMP: a wipe flips to value-driven the first time Theatre actually drives
// its value above `CLOUD_FILL_AUTHORED_EPSILON` — i.e. its keyframed track is
// present and in range. Until then (and forever, if the track is missing /
// Studio-dropped / its localStorage lacks it) that wipe stays on its threshold
// fallback ramp. Lazy (not read from the static JSON) so a JSON track that the
// live Studio state doesn't actually carry can never strand the wipe at 0.
// Monotonic + per-ramp: one wipe can't disable the other.
export const CLOUD_FILL_AUTHORED_EPSILON = 1e-4;
export const CLOUD_TRANSITION_FILL: {
	oneToTwo: number;
	twoToThree: number;
	authoredOneToTwo: boolean;
	authoredTwoToThree: boolean;
} = {
	oneToTwo: 0,
	twoToThree: 0,
	authoredOneToTwo: false,
	authoredTwoToThree: false
};

const rampUp = (p: number, start: number, end: number): number => {
	const t = (p - start) / Math.max(PROGRESS_EPSILON, end - start);
	return t < 0 ? 0 : t > 1 ? 1 : t;
};

/**
 * Current 0→1 sweep amount of each wipe at content progress `p`. When the
 * Theatre tracks are authored, returns the live keyframed values (so dragging a
 * marker retimes everything live); otherwise synthesizes the ramps from the
 * `CLOUD_TRANSITION_TIMING` thresholds — equivalent to the legacy behavior.
 */
export function resolveCloudFill(p: number): { oneToTwo: number; twoToThree: number } {
	// Per-ramp: each wipe is value-driven when its own track is authored, else it
	// falls back to its threshold ramp — independent, so a missing/dropped track
	// for one wipe never disables the other.
	return {
		oneToTwo: CLOUD_TRANSITION_FILL.authoredOneToTwo
			? CLOUD_TRANSITION_FILL.oneToTwo
			: rampUp(p, CLOUD_TRANSITION_TIMING.fillInStart, CLOUD_TRANSITION_TIMING.fillInEnd),
		twoToThree: CLOUD_TRANSITION_FILL.authoredTwoToThree
			? CLOUD_TRANSITION_FILL.twoToThree
			: rampUp(p, CLOUD_TRANSITION_TIMING.fadeOutStart, CLOUD_TRANSITION_TIMING.fadeOutEnd)
	};
}

/**
 * Active scene (1/2/3) for the stage router + cross-fade. Scene 2 once the 1→2
 * wipe has begun (fill > 0), scene 3 once the 2→3 wipe has begun. Shares
 * `resolveCloudFill`'s source so routing follows the keyframes.
 */
export function resolveCloudActiveScene(p: number): 1 | 2 | 3 {
	const { oneToTwo, twoToThree } = resolveCloudFill(p);
	if (twoToThree > 0) return 3;
	if (oneToTwo > 0) return 2;
	return 1;
}

/**
 * Read the cloud-transition keyframe positions out of the Theatre save-state at
 * init, PER RAMP, and overwrite that ramp's slice of `CLOUD_TRANSITION_TIMING`
 * with the keyframe scene-progress span (min→max position / sequence length).
 * This keeps the warmup pins + the threshold fallback aligned with the authored
 * timing. It does NOT flip the `authored*` flags — that is decided lazily from
 * the LIVE value (see `CLOUD_TRANSITION_FILL`), so a JSON track the live Studio
 * state doesn't carry can't strand a wipe. A missing/malformed track leaves
 * that ramp's defaults. Fully tolerant.
 */
export function applyCloudKeyframeState(state: unknown, sheetId = 'ScrollTimeline'): void {
	try {
		const seq = (state as Record<string, any>)?.sheetsById?.[sheetId]?.sequence;
		const length = typeof seq?.length === 'number' && seq.length > 0 ? seq.length : 100;
		const tracks = seq?.tracksByObject?.Transition;
		const idByPath = tracks?.trackIdByPropPath;
		const data = tracks?.trackData;
		const span = (prop: string): { start: number; end: number } | null => {
			const id = idByPath?.[`["${prop}"]`];
			const kfs = id ? data?.[id]?.keyframes : null;
			if (!Array.isArray(kfs) || kfs.length < 2) return null;
			const positions = kfs
				.map((k: any) => k?.position)
				.filter((n: any): n is number => typeof n === 'number');
			if (positions.length < 2) return null;
			return { start: Math.min(...positions) / length, end: Math.max(...positions) / length };
		};
		const a = span('fillOneToTwo');
		if (a) {
			CLOUD_TRANSITION_TIMING.fillInStart = a.start;
			CLOUD_TRANSITION_TIMING.fillInEnd = a.end;
		}
		const b = span('fillTwoToThree');
		if (b) {
			CLOUD_TRANSITION_TIMING.fadeOutStart = b.start;
			CLOUD_TRANSITION_TIMING.fadeOutEnd = b.end;
		}
	} catch {
		/* malformed save-state — keep defaults + threshold fallback */
	}
}

// Initial position for the train slider group at construction time. The
// scroll-driven X / Y / Z and visibility are now Theatre tracks (see
// `src/lib/scene/theatre/features/{desktop,mobile}.json` → object `TrainSlider`), but the slider needs a
// sensible starting transform before Theatre fires its first sample.
export const TRAIN_SLIDER_LAYOUT = {
	HIDDEN_X: 50,
	BASE_Y: 0.5,
	BASE_Z: -15
} as const;
