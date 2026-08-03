import synthwaveRaw from './charts/synthwave.json';
import oldskoolRaw from './charts/oldskool.json';
import spaceRangerRaw from './charts/space-ranger.json';

/**
 * Music-derived note charts, generated from the actual audio by
 * scripts/generate-voidhero-charts.mjs. Chart notes are TIME-based (seconds
 * into the file) because the connected tracks are swung/tempo-unstable —
 * see the generator header for the analysis pipeline.
 */

/** Raw JSON shape: notes are [timeSec, lane, salience, holdSec] tuples. */
interface RawChart {
	id: string;
	durationSec: number;
	notes: number[][];
}

export interface ChartNote {
	readonly time: number;
	readonly lane: number;
	readonly salience: number;
	readonly holdSec: number;
}

export interface TrackChart {
	readonly id: string;
	readonly durationSec: number;
	readonly notes: readonly ChartNote[];
	/** All note saliences sorted descending — rank k ⇒ threshold admitting k+1 notes. */
	readonly salienceDesc: readonly number[];
}

// Stage densityBias → chart notes-per-minute target. Mirrors the generator's
// density report (NPM_PER_DENSITY in scripts/generate-voidhero-charts.mjs):
// Drift ≈ 20/min up to ≈ 95/min at the Void axis cap — matches the pattern
// bank's effective cadence (densityBias × ~110 steps/min).
const NPM_PER_DENSITY = 110;

function buildChart(raw: RawChart): TrackChart {
	const notes = raw.notes.map(([time, lane, salience, holdSec]) => ({
		time,
		lane,
		salience,
		holdSec
	}));
	const salienceDesc = notes.map((n) => n.salience).sort((a, b) => b - a);
	return { id: raw.id, durationSec: raw.durationSec, notes, salienceDesc };
}

const CHARTS: ReadonlyMap<string, TrackChart> = new Map(
	[synthwaveRaw, oldskoolRaw, spaceRangerRaw].map((raw) => {
		const chart = buildChart(raw);
		return [chart.id, chart];
	})
);

export function getChartForTrack(id: string): TrackChart | null {
	return CHARTS.get(id) ?? null;
}

/**
 * Salience threshold that plays the chart's strongest notes at a rate of
 * `densityBias * NPM_PER_DENSITY` notes per minute (spawn if salience ≥ gate).
 */
export function chartSalienceGate(chart: TrackChart, densityBias: number): number {
	const target = Math.floor(densityBias * NPM_PER_DENSITY * (chart.durationSec / 60));
	if (target <= 0) return Infinity;
	if (target >= chart.salienceDesc.length) return 0;
	return chart.salienceDesc[target - 1];
}
