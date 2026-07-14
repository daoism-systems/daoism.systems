import type { NoteSpec } from './voidHero.helpers';

export type PatternStep = NoteSpec[];

export type PatternKind = 'breather' | 'flow' | 'chord' | 'hold' | 'syncopation' | 'burst';

export interface PatternEntry {
	readonly id: string;
	readonly steps: ReadonlyArray<PatternStep>;
	readonly kind: PatternKind;
	// Average notes-per-step (hand-tuned 0..1). Drives density bias matching.
	readonly density: number;
	readonly minStage: number;
	readonly weight: number;
	// Optional sub-beat cadence override (default 1 = one step per beat).
	// Engine reads this when consuming the pattern; only used by burst/syncopation.
	readonly beatsPerStep?: number;
}

export interface StageDef {
	readonly id: number;
	readonly name: string;
	readonly minStep: number;
	readonly speedMul: number;
	readonly hitWindowScale: number;
	readonly scoreMul: number;
	readonly allowedKinds: ReadonlyArray<PatternKind>;
	// 0..1 — picker prefers patterns whose density ≈ this value.
	readonly densityBias: number;
	// Min steps between any 'burst' pick. Infinity disables bursts.
	readonly burstCooldownSteps: number;
	// First N steps after entering this stage: no bursts, breather/low-density bias.
	readonly settleSteps: number;
}

export interface ActiveAxes {
	readonly speedMul: number;
	readonly hitWindowScale: number;
	readonly scoreMul: number;
	readonly stageId: number;
	readonly stageName: string;
	readonly stepsIntoStage: number;
	readonly stepsToNextStage: number;
	readonly progressToNext: number;
}

// First steps of a run: the picker only serves sparse (density ≤ WARMUP_MAX_DENSITY)
// patterns so a new player can find the keys before full-density lines arrive.
const RUN_WARMUP_STEPS = 16;
const WARMUP_MAX_DENSITY = 0.1;

const VOID_SUBSTAGE_STEPS = 256;
const VOID_AXIS_CAP = {
	speedMul: 1.85,
	hitWindowScale: 0.62,
	densityBias: 0.86
} as const;
const VOID_SUBSTAGE_PLATEAU = 4;

export const STAGE_DEFS: ReadonlyArray<StageDef> = [
	{
		id: 0,
		name: 'Drift',
		minStep: 0,
		speedMul: 1.0,
		hitWindowScale: 1.0,
		scoreMul: 1.0,
		allowedKinds: ['breather', 'flow'],
		densityBias: 0.18,
		burstCooldownSteps: Infinity,
		settleSteps: 0
	},
	{
		id: 1,
		name: 'Pulse',
		minStep: 56,
		speedMul: 1.1,
		hitWindowScale: 0.94,
		scoreMul: 1.2,
		allowedKinds: ['breather', 'flow', 'chord', 'hold'],
		densityBias: 0.34,
		burstCooldownSteps: Infinity,
		settleSteps: 16
	},
	{
		id: 2,
		name: 'Surge',
		minStep: 120,
		speedMul: 1.22,
		hitWindowScale: 0.85,
		scoreMul: 1.5,
		allowedKinds: ['breather', 'flow', 'chord', 'hold', 'syncopation', 'burst'],
		densityBias: 0.5,
		burstCooldownSteps: 48,
		settleSteps: 16
	},
	{
		id: 3,
		name: 'Storm',
		minStep: 216,
		speedMul: 1.36,
		hitWindowScale: 0.76,
		scoreMul: 1.85,
		allowedKinds: ['breather', 'flow', 'chord', 'hold', 'syncopation', 'burst'],
		densityBias: 0.66,
		burstCooldownSteps: 32,
		settleSteps: 16
	},
	{
		id: 4,
		name: 'Void',
		minStep: 344,
		speedMul: 1.5,
		hitWindowScale: 0.7,
		scoreMul: 2.25,
		allowedKinds: ['breather', 'chord', 'hold', 'syncopation', 'burst'],
		densityBias: 0.78,
		burstCooldownSteps: 24,
		settleSteps: 16
	}
];

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function smoothstep01(x: number): number {
	const t = Math.max(0, Math.min(1, x));
	return t * t * (3 - 2 * t);
}

function getBaseStage(step: number): StageDef {
	let base = STAGE_DEFS[0];
	for (let i = STAGE_DEFS.length - 1; i >= 0; i--) {
		if (step >= STAGE_DEFS[i].minStep) {
			base = STAGE_DEFS[i];
			break;
		}
	}
	return base;
}

function synthVoidSubStage(step: number): { stage: StageDef; subIndex: number } {
	const voidBase = STAGE_DEFS[STAGE_DEFS.length - 1];
	const sub = Math.floor((step - voidBase.minStep) / VOID_SUBSTAGE_STEPS);
	if (sub <= 0) return { stage: voidBase, subIndex: 0 };
	const t = Math.min(1, sub / VOID_SUBSTAGE_PLATEAU);
	return {
		stage: {
			...voidBase,
			name: `Void ${ROMAN[Math.min(sub + 1, ROMAN.length - 1)] ?? sub + 1}`,
			minStep: voidBase.minStep + sub * VOID_SUBSTAGE_STEPS,
			speedMul: lerp(voidBase.speedMul, VOID_AXIS_CAP.speedMul, t),
			hitWindowScale: lerp(voidBase.hitWindowScale, VOID_AXIS_CAP.hitWindowScale, t),
			scoreMul: voidBase.scoreMul + 0.3 * sub,
			densityBias: lerp(voidBase.densityBias, VOID_AXIS_CAP.densityBias, t)
		},
		subIndex: sub
	};
}

export function getStageForStep(step: number): StageDef {
	const base = getBaseStage(step);
	if (base.id < STAGE_DEFS.length - 1) return base;
	return synthVoidSubStage(step).stage;
}

export function getActiveAxes(step: number): ActiveAxes {
	const stage = getStageForStep(step);
	const stepsIntoStage = Math.max(0, step - stage.minStep);

	// Smooth the first `settleSteps` of every stage transition by interpolating
	// from the previous stage's axes — avoids cliff-edge difficulty jumps.
	let speedMul = stage.speedMul;
	let hitWindowScale = stage.hitWindowScale;
	let scoreMul = stage.scoreMul;
	if (stage.settleSteps > 0 && stepsIntoStage < stage.settleSteps && stage.minStep > 0) {
		const prev = getStageForStep(stage.minStep - 1);
		const t = smoothstep01(stepsIntoStage / stage.settleSteps);
		speedMul = lerp(prev.speedMul, stage.speedMul, t);
		hitWindowScale = lerp(prev.hitWindowScale, stage.hitWindowScale, t);
		scoreMul = lerp(prev.scoreMul, stage.scoreMul, t);
	}

	const isVoidPlateau =
		stage.id === STAGE_DEFS.length - 1 &&
		stepsIntoStage >= VOID_SUBSTAGE_STEPS * VOID_SUBSTAGE_PLATEAU;
	const stepsToNextStage = isVoidPlateau
		? 0
		: stage.id === STAGE_DEFS.length - 1
			? VOID_SUBSTAGE_STEPS - (stepsIntoStage % VOID_SUBSTAGE_STEPS)
			: STAGE_DEFS[stage.id + 1].minStep - step;
	const stageSpan = isVoidPlateau
		? 1
		: stage.id === STAGE_DEFS.length - 1
			? VOID_SUBSTAGE_STEPS
			: STAGE_DEFS[stage.id + 1].minStep - stage.minStep;
	const progressToNext = isVoidPlateau
		? 1
		: Math.max(0, Math.min(1, 1 - stepsToNextStage / stageSpan));

	return {
		speedMul,
		hitWindowScale,
		scoreMul,
		stageId: stage.id,
		stageName: stage.name,
		stepsIntoStage,
		stepsToNextStage,
		progressToNext
	};
}

// --- Pattern bank --------------------------------------------------------

const H_SHORT = 0.95;
const H_MID = 1.35;
const H_LONG = 1.8;

export const PATTERN_LIBRARY: ReadonlyArray<PatternEntry> = [
	// Stage 0 — Drift warm-up: one note every other beat while the player finds the keys.
	{
		id: 'drift_intro_walk',
		steps: [[0], [], [1], [], [2], [], [3], []],
		kind: 'breather',
		density: 0.06,
		minStage: 0,
		weight: 1.3
	},
	{
		id: 'drift_intro_echo',
		steps: [[1], [], [2], [], [0], [], [3], []],
		kind: 'breather',
		density: 0.06,
		minStage: 0,
		weight: 1.2
	},
	{
		id: 'drift_intro_edges',
		steps: [[0], [], [3], [], [0], [3], [], []],
		kind: 'flow',
		density: 0.08,
		minStage: 0,
		weight: 1.1
	},

	// Stage 0 — Drift: gentle single-lane intro.
	{
		id: 'drift_march',
		steps: [[0], [1], [2], [3], [3], [2], [1], [0]],
		kind: 'breather',
		density: 0.12,
		minStage: 0,
		weight: 1.0
	},
	{
		id: 'drift_alt',
		steps: [[0], [2], [1], [3], [2], [0], [3], [1]],
		kind: 'flow',
		density: 0.18,
		minStage: 0,
		weight: 1.1
	},
	{
		id: 'drift_breath',
		steps: [[1], [2], [1], [2], [0], [3]],
		kind: 'breather',
		density: 0.12,
		minStage: 0,
		weight: 0.85
	},
	{
		id: 'drift_zig_lite',
		steps: [[0], [3], [1], [2], [3], [0], [2], [1]],
		kind: 'flow',
		density: 0.2,
		minStage: 0,
		weight: 1.0
	},

	// Stage 1 — Pulse: chords + first holds.
	{
		id: 'pulse_chord_a',
		steps: [[0], [1, 3], [2], [0], [2, 3], [1], [3], [0, 2]],
		kind: 'chord',
		density: 0.36,
		minStage: 1,
		weight: 1.0
	},
	{
		id: 'pulse_chord_b',
		steps: [[0, 2], [1], [3], [0], [1, 3], [2], [0, 3], [1]],
		kind: 'chord',
		density: 0.32,
		minStage: 1,
		weight: 1.0
	},
	{
		id: 'pulse_hold_short',
		steps: [
			[{ lane: 0, hold: H_SHORT }],
			[2],
			[3],
			[1],
			[{ lane: 3, hold: H_SHORT }],
			[1],
			[2],
			[0]
		],
		kind: 'hold',
		density: 0.32,
		minStage: 1,
		weight: 0.9
	},
	{
		id: 'pulse_hold_mid',
		steps: [[1], [3], [{ lane: 2, hold: H_MID }], [0], [3], [1], [2], [0]],
		kind: 'hold',
		density: 0.3,
		minStage: 1,
		weight: 0.8
	},
	{
		id: 'pulse_flow',
		steps: [[2], [0], [3], [1], [0], [2], [3], [1]],
		kind: 'flow',
		density: 0.22,
		minStage: 1,
		weight: 0.85
	},

	// Stage 2 — Surge: denser chords, longer holds, syncopation, first bursts.
	{
		id: 'surge_chord_dense',
		steps: [[0, 2], [1, 3], [0], [2], [1, 3], [0, 2], [3], [1]],
		kind: 'chord',
		density: 0.52,
		minStage: 2,
		weight: 1.0
	},
	{
		id: 'surge_hold_long',
		steps: [
			[{ lane: 1, hold: H_LONG }],
			[3],
			[0],
			[2],
			[3],
			[0],
			[{ lane: 2, hold: H_MID }],
			[1]
		],
		kind: 'hold',
		density: 0.4,
		minStage: 2,
		weight: 0.9
	},
	{
		id: 'surge_hold_double',
		steps: [
			[{ lane: 0, hold: H_MID }],
			[2],
			[1],
			[3],
			[{ lane: 3, hold: H_SHORT }],
			[0],
			[2],
			[1]
		],
		kind: 'hold',
		density: 0.42,
		minStage: 2,
		weight: 0.85
	},
	{
		id: 'surge_synco',
		steps: [[0], [1, 3], [], [2], [0, 2], [], [1], [3]],
		kind: 'syncopation',
		density: 0.42,
		minStage: 2,
		weight: 0.8
	},
	{
		id: 'surge_burst_zig',
		steps: [[0], [3], [1], [2], [0], [3], [1], [2]],
		kind: 'burst',
		density: 0.48,
		minStage: 2,
		weight: 0.55,
		beatsPerStep: 0.5
	},

	// Stage 3 — Storm: heavy chords, hold combos, triplet burst.
	{
		id: 'storm_chord_pair',
		steps: [
			[0, 2],
			[1, 3],
			[0, 3],
			[1, 2],
			[0, 2],
			[1, 3],
			[2, 3],
			[0, 1]
		],
		kind: 'chord',
		density: 0.7,
		minStage: 3,
		weight: 1.0
	},
	{
		id: 'storm_hold_chord',
		steps: [
			[{ lane: 0, hold: H_MID }, 3],
			[1],
			[2],
			[{ lane: 3, hold: H_SHORT }, 1],
			[0],
			[2],
			[1, 3],
			[0, 2]
		],
		kind: 'hold',
		density: 0.62,
		minStage: 3,
		weight: 0.9
	},
	{
		id: 'storm_synco_chord',
		steps: [[0, 2], [], [1, 3], [2], [], [0, 3], [1], [2, 3]],
		kind: 'syncopation',
		density: 0.6,
		minStage: 3,
		weight: 0.85
	},
	{
		id: 'storm_burst_triplet',
		steps: [[0], [2], [1], [3], [0], [2], [1], [3], [0], [2], [1], [3]],
		kind: 'burst',
		density: 0.5,
		minStage: 3,
		weight: 0.5,
		beatsPerStep: 0.5
	},
	{
		id: 'storm_burst_wall',
		steps: [[0, 1, 2, 3]],
		kind: 'burst',
		density: 1.0,
		minStage: 3,
		weight: 0.35
	},

	// Stage 4 — Void: max-density rotations.
	{
		id: 'void_chord_rotor',
		steps: [
			[0, 2],
			[1, 3],
			[0, 1],
			[2, 3],
			[0, 3],
			[1, 2],
			[0, 2],
			[1, 3]
		],
		kind: 'chord',
		density: 0.78,
		minStage: 4,
		weight: 1.0
	},
	{
		id: 'void_hold_braid',
		steps: [
			[{ lane: 0, hold: H_LONG }, 2],
			[1],
			[3],
			[{ lane: 2, hold: H_MID }, 0],
			[3],
			[1],
			[{ lane: 3, hold: H_SHORT }, 0],
			[2]
		],
		kind: 'hold',
		density: 0.7,
		minStage: 4,
		weight: 0.85
	},
	{
		id: 'void_synco_dense',
		steps: [[0, 3], [], [1, 2], [0], [], [2, 3], [1], [], [0, 2], [1, 3]],
		kind: 'syncopation',
		density: 0.7,
		minStage: 4,
		weight: 0.8
	},
	{
		id: 'void_burst_double_wall',
		steps: [[0, 1, 2, 3], [], [0, 1, 2, 3]],
		kind: 'burst',
		density: 1.0,
		minStage: 4,
		weight: 0.3
	},
	// Late-game breather — sparse run that doubles as combo recovery.
	{
		id: 'void_breath',
		steps: [[0], [2], [3], [1]],
		kind: 'breather',
		density: 0.1,
		minStage: 4,
		weight: 0.45
	}
];

export interface PickContext {
	readonly stage: StageDef;
	readonly currentStep: number;
	readonly history: ReadonlyArray<string>;
	readonly lastBurstStep: number;
	readonly rng?: () => number;
}

export function pickNextPattern(ctx: PickContext): PatternEntry {
	const { stage, currentStep, history, lastBurstStep, rng = Math.random } = ctx;
	const stepsIntoStage = Math.max(0, currentStep - stage.minStep);
	const inSettle = stepsIntoStage < stage.settleSteps;
	const burstOnCooldown = currentStep - lastBurstStep < stage.burstCooldownSteps;
	// After any burst, force ~8 steps of low-density bias to give the player a beat to recover.
	const stepsSinceBurst = currentStep - lastBurstStep;
	const recovering = stepsSinceBurst < 8 && lastBurstStep >= 0;

	let candidates = PATTERN_LIBRARY.filter((p) => {
		if (p.minStage > stage.id) return false;
		if (!stage.allowedKinds.includes(p.kind)) return false;
		if (history.includes(p.id)) return false;
		if (p.kind === 'burst' && (inSettle || burstOnCooldown)) return false;
		return true;
	});

	if (currentStep < RUN_WARMUP_STEPS) {
		const sparse = candidates.filter((p) => p.density <= WARMUP_MAX_DENSITY);
		if (sparse.length > 0) candidates = sparse;
	}

	if (candidates.length === 0) {
		return (
			PATTERN_LIBRARY.find((p) => p.kind === 'breather' && p.minStage <= stage.id) ??
			PATTERN_LIBRARY[0]
		);
	}

	const targetDensity = recovering
		? Math.min(stage.densityBias, 0.2)
		: inSettle
			? Math.min(stage.densityBias, 0.3)
			: stage.densityBias;

	const weights = candidates.map((p) => {
		const densityMatch = 1 - Math.abs(p.density - targetDensity);
		const settleBoost =
			(inSettle || recovering) && (p.kind === 'breather' || p.kind === 'flow') ? 1.8 : 1.0;
		return Math.max(0.05, p.weight * densityMatch * settleBoost);
	});
	const total = weights.reduce((a, b) => a + b, 0);
	let r = rng() * total;
	for (let i = 0; i < candidates.length; i++) {
		r -= weights[i];
		if (r <= 0) return candidates[i];
	}
	return candidates[candidates.length - 1];
}

// History ring buffer helper — keeps last N picks to discourage repeats.
export const HISTORY_SIZE = 4;
