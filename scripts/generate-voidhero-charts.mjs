#!/usr/bin/env node
/**
 * Void Hero chart generator.
 *
 * Decodes each connected music track (ffmpeg → mono PCM), runs band-split
 * spectral-flux onset detection and emits one playable TIME-based chart JSON
 * per track into src/lib/voidhero/charts/ (notes carry absolute seconds — the
 * connected tracks are swung/tempo-unstable, so no beat quantization).
 *
 * Lane mapping is instrument-flavoured: bass/kick → lane 0, low-mid (snare/
 * toms) → lane 1, high-mid (leads/stabs) → lane 2, highs (hats/cymbals) →
 * lane 3, with adjacent-lane fallback when playability rules block a lane.
 *
 * Every note carries a `salience` in [0, 1] (percentile of onset strength in
 * its band, plus a downbeat bonus). At runtime the stage progression's
 * densityBias gates notes by salience, so early stages play only the loudest
 * accents of the song and later stages the full chart.
 *
 * Usage: node scripts/generate-voidhero-charts.mjs [trackId ...]
 * Requires ffmpeg on PATH.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src/lib/voidhero/charts');

// Keep in sync with MUSIC_TRACKS in src/lib/voidhero/voidHero.helpers.ts.
// beatOffsetSec here is only a hint — the generator estimates the real grid
// offset from the audio and stores that in the chart.
const TRACKS = [
	{ id: 'synthwave', src: 'static/sounds/voidhero/synthwave-15k.mp3', bpm: 110 },
	{ id: 'oldskool', src: 'static/sounds/voidhero/oldskool.mp3', bpm: 120 },
	{ id: 'space-ranger', src: 'static/sounds/voidhero/space-ranger.mp3', bpm: 80 }
];

const SAMPLE_RATE = 22050;
const FRAME_SIZE = 1024;
const HOP = 256;
const HOP_SEC = HOP / SAMPLE_RATE;
const BIN_HZ = SAMPLE_RATE / FRAME_SIZE;
const STEPS_PER_BEAT = 2; // half-beat note grid

// Frequency bands → lanes. [loHz, hiHz, lane, altLane]
const BANDS = [
	{ name: 'bass', lo: 25, hi: 160, lane: 0, alt: 1 },
	{ name: 'lowmid', lo: 160, hi: 700, lane: 1, alt: 0 },
	{ name: 'highmid', lo: 700, hi: 3000, lane: 2, alt: 3 },
	{ name: 'high', lo: 3000, hi: 9000, lane: 3, alt: 2 }
];
const HOLD_BANDS = new Set(['bass', 'highmid']);

// --- audio decode -----------------------------------------------------------

function decode(path) {
	// VH_SCAN_WINDOW="start:len" (seconds) restricts decoding — scan diagnostics only.
	const win = process.env.VH_SCAN_WINDOW?.split(':').map(Number);
	const seek = win && win.length === 2 ? ['-ss', String(win[0]), '-t', String(win[1])] : [];
	const res = spawnSync(
		'ffmpeg',
		[
			'-v',
			'error',
			...seek,
			'-i',
			path,
			'-ac',
			'1',
			'-ar',
			String(SAMPLE_RATE),
			'-f',
			'f32le',
			'-'
		],
		{ maxBuffer: 1 << 30 }
	);
	if (res.status !== 0) {
		throw new Error(`ffmpeg failed for ${path}: ${res.stderr?.toString().slice(0, 400)}`);
	}
	const buf = res.stdout;
	return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

// --- FFT ---------------------------------------------------------------------

function fftInPlace(re, im) {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			const tr = re[i];
			re[i] = re[j];
			re[j] = tr;
			const ti = im[i];
			im[i] = im[j];
			im[j] = ti;
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len;
		const wRe = Math.cos(ang);
		const wIm = Math.sin(ang);
		const half = len >> 1;
		for (let i = 0; i < n; i += len) {
			let curRe = 1;
			let curIm = 0;
			for (let k = 0; k < half; k++) {
				const a = i + k;
				const b = a + half;
				const vRe = re[b] * curRe - im[b] * curIm;
				const vIm = re[b] * curIm + im[b] * curRe;
				re[b] = re[a] - vRe;
				im[b] = im[a] - vIm;
				re[a] += vRe;
				im[a] += vIm;
				const nRe = curRe * wRe - curIm * wIm;
				curIm = curRe * wIm + curIm * wRe;
				curRe = nRe;
			}
		}
	}
}

// --- analysis ----------------------------------------------------------------

/**
 * STFT → per-band log-magnitude spectra summed per frame.
 * Returns { frames, flux: Float32Array[band][frame], energy: linear band energy }.
 */
function analyze(pcm) {
	const frames = Math.max(0, Math.floor((pcm.length - FRAME_SIZE) / HOP));
	const window = new Float32Array(FRAME_SIZE);
	for (let i = 0; i < FRAME_SIZE; i++) {
		window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));
	}
	const bandBins = BANDS.map((b) => ({
		from: Math.max(1, Math.round(b.lo / BIN_HZ)),
		to: Math.min(FRAME_SIZE / 2, Math.round(b.hi / BIN_HZ))
	}));

	const re = new Float32Array(FRAME_SIZE);
	const im = new Float32Array(FRAME_SIZE);
	const prevLog = BANDS.map(({}, bi) => new Float32Array(bandBins[bi].to - bandBins[bi].from));
	const curLog = BANDS.map(({}, bi) => new Float32Array(bandBins[bi].to - bandBins[bi].from));
	const flux = BANDS.map(() => new Float32Array(frames));
	const energy = BANDS.map(() => new Float32Array(frames));

	for (let f = 0; f < frames; f++) {
		const off = f * HOP;
		for (let i = 0; i < FRAME_SIZE; i++) {
			re[i] = pcm[off + i] * window[i];
			im[i] = 0;
		}
		fftInPlace(re, im);
		for (let bi = 0; bi < BANDS.length; bi++) {
			const { from, to } = bandBins[bi];
			const cur = curLog[bi];
			const prev = prevLog[bi];
			let fluxSum = 0;
			let eSum = 0;
			for (let k = from; k < to; k++) {
				const mag = Math.hypot(re[k], im[k]);
				eSum += mag;
				const lm = Math.log1p(10 * mag);
				const d = lm - prev[k - from];
				if (d > 0) fluxSum += d;
				cur[k - from] = lm;
			}
			flux[bi][f] = fluxSum;
			energy[bi][f] = eSum;
			prevLog[bi].set(cur);
		}
	}

	// Light smoothing of flux (3-frame MA) to stabilise peak picking.
	for (let bi = 0; bi < BANDS.length; bi++) {
		const src = flux[bi];
		const out = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			const a = src[Math.max(0, f - 1)];
			const b = src[f];
			const c = src[Math.min(frames - 1, f + 1)];
			out[f] = (a + b + c) / 3;
		}
		flux[bi] = out;
	}
	return { frames, flux, energy };
}

/** Median-threshold peak picking. Returns [{frame, strength}] per band. */
function pickOnsets(flux) {
	const frames = flux.length;
	const W = Math.round(0.5 / HOP_SEC); // ±0.5s adaptive window
	const MIN_GAP = Math.round(0.09 / HOP_SEC); // 90ms refractory
	const sortedAll = Float32Array.from(flux).sort();
	const globalP90 = sortedAll[Math.floor(sortedAll.length * 0.9)] ?? 0;
	const onsets = [];
	let lastFrame = -Infinity;
	const win = [];
	for (let f = 0; f < frames; f++) {
		const from = Math.max(0, f - W);
		const to = Math.min(frames, f + W);
		win.length = 0;
		for (let i = from; i < to; i++) win.push(flux[i]);
		win.sort((a, b) => a - b);
		const median = win[win.length >> 1];
		const threshold = median * 1.5 + globalP90 * 0.07;
		if (flux[f] <= threshold) continue;
		let isPeak = true;
		for (let d = 1; d <= 3 && isPeak; d++) {
			if (flux[f] < (flux[f - d] ?? -1) || flux[f] < (flux[f + d] ?? -1)) isPeak = false;
		}
		if (!isPeak) continue;
		const strength = flux[f] - median;
		if (f - lastFrame < MIN_GAP) {
			const prev = onsets[onsets.length - 1];
			if (prev && strength > prev.strength) {
				prev.frame = f;
				prev.strength = strength;
				lastFrame = f;
			}
			continue;
		}
		onsets.push({ frame: f, strength });
		lastFrame = f;
	}
	return onsets;
}

/**
 * Estimate the beat-grid offset in [0, secPerBeat) that best aligns the
 * low-band onsets to whole beats (Gaussian kernel σ=20ms scoring).
 */
function estimateOffset(onsetsPerBand, secPerBeat) {
	const anchors = [...onsetsPerBand[0], ...onsetsPerBand[1]];
	if (anchors.length === 0) return 0;
	let bestOffset = 0;
	let bestScore = -Infinity;
	const sigma = 0.02;
	for (let off = 0; off < secPerBeat; off += 0.002) {
		let score = 0;
		for (const o of anchors) {
			const t = o.frame * HOP_SEC - off;
			const phase = t - Math.round(t / secPerBeat) * secPerBeat;
			score += o.strength * Math.exp(-(phase * phase) / (2 * sigma * sigma));
		}
		if (score > bestScore) {
			bestScore = score;
			bestOffset = off;
		}
	}
	return bestOffset;
}

/**
 * Autocorrelation BPM estimate over the summed flux envelope (55–200 BPM).
 * Harmonic-weighted (adds ×2/×3 lag energy) so the fundamental beats its
 * subdivisions; returns { bpm, candidates } with the top-scored lags.
 */
function estimateBpm(flux, frames) {
	const env = new Float32Array(frames);
	for (const f of flux) for (let i = 0; i < frames; i++) env[i] += f[i];
	const minLag = Math.round(60 / 200 / HOP_SEC);
	const maxLag = Math.round(60 / 55 / HOP_SEC);
	const ac = new Float32Array(maxLag * 3 + 2);
	for (let lag = minLag; lag < ac.length; lag++) {
		let s = 0;
		for (let i = 0; i + lag < frames; i++) s += env[i] * env[i + lag];
		ac[lag] = s / (frames - lag);
	}
	const scored = [];
	for (let lag = minLag; lag <= maxLag; lag++) {
		// Local peak only — skip shoulders of neighbouring lags.
		if (ac[lag] < ac[lag - 1] || ac[lag] < ac[lag + 1]) continue;
		const harmonic = ac[lag] + 0.5 * (ac[lag * 2] ?? 0) + 0.33 * (ac[lag * 3] ?? 0);
		scored.push({ bpm: 60 / (lag * HOP_SEC), score: harmonic });
	}
	scored.sort((a, b) => b.score - a.score);
	return { bpm: scored[0]?.bpm ?? 0, candidates: scored.slice(0, 8) };
}

/**
 * Grid-fit diagnostic for --scan: how well do the low-band onsets align to a
 * whole-beat grid at each candidate BPM (best offset, Gaussian σ=20ms), with
 * the score normalised by total onset strength so BPMs are comparable.
 */
function gridFit(onsetsPerBand, bpm) {
	const secPerBeat = 60 / bpm;
	const offset = estimateOffset(onsetsPerBand, secPerBeat);
	const anchors = [...onsetsPerBand[0], ...onsetsPerBand[1]];
	let score = 0;
	let total = 0;
	let errSum = 0;
	const sigma = 0.02;
	for (const o of anchors) {
		const t = o.frame * HOP_SEC - offset;
		const phase = t - Math.round(t / secPerBeat) * secPerBeat;
		score += o.strength * Math.exp(-(phase * phase) / (2 * sigma * sigma));
		errSum += o.strength * Math.abs(phase);
		total += o.strength;
	}
	return { offset, aligned: score / total, meanErrMs: (errSum / total) * 1000 };
}

/**
 * Sustain detection for hold notes. A leaky peak-follower (τ=250ms) bridges
 * the inter-beat dips of sidechain pumping; sustain ends when the envelope
 * falls below 45% of the onset peak or at the next significant onset.
 */
function measureSustain(energy, frame, nextOnsetFrame) {
	const frames = energy.length;
	const decay = Math.exp(-HOP_SEC / 0.25);
	let peak = 0;
	for (let f = frame; f < Math.min(frames, frame + 6); f++) peak = Math.max(peak, energy[f]);
	if (peak <= 0) return 0;
	const floor = peak * 0.45;
	const cap = Math.min(frames, nextOnsetFrame);
	let env = peak;
	let end = frame;
	for (let f = frame + 1; f < cap; f++) {
		env = Math.max(energy[f], env * decay);
		if (env < floor) break;
		end = f;
	}
	return (end - frame) * HOP_SEC;
}

// --- chart assembly ----------------------------------------------------------

// Charts are TIME-based (seconds), not beat-quantized: the connected tracks
// have swung/syncopated content and one (synthwave) has no stable tempo at
// all, so notes are placed exactly on the detected audio events. The beat
// grid only paces the runtime stage progression.

const CLUSTER_SEC = 0.06; // cross-band onsets within this window form one chord
const HOLD_MIN_SEC = 0.75;
const HOLD_MAX_SEC = 2.0;
const LANE_GAP_STRONG_SEC = 0.3; // min same-lane spacing for salient notes
const LANE_GAP_WEAK_SEC = 0.55;
const HOLD_LANE_PAD_SEC = 0.25; // lane stays blocked this long after a hold ends
// Distinct note times are at least this far apart — closer onsets either merge
// into an exact chord or the weaker one is dropped. Kills flams, which read as
// "impossible" double-taps at play speed.
const MIN_NOTE_SPACING_SEC = 0.18;
// A chord's second note must itself be reasonably salient.
const CHORD_MIN_SALIENCE = 0.5;

function buildChart(track, pcm) {
	const durationSec = pcm.length / SAMPLE_RATE;
	const { frames, flux, energy } = analyze(pcm);
	const onsetsPerBand = flux.map((f) => pickOnsets(f));
	const bpmEst = estimateBpm(flux, frames).bpm;

	// Flatten onsets → events with sustain (hold) measurement per band.
	const events = [];
	for (let bi = 0; bi < BANDS.length; bi++) {
		const onsets = onsetsPerBand[bi];
		for (let oi = 0; oi < onsets.length; oi++) {
			const o = onsets[oi];
			let holdSec = 0;
			if (HOLD_BANDS.has(BANDS[bi].name)) {
				// Sustain ends at the next *significant* onset in the band — weak
				// re-triggers (ghost notes inside a pad/bass swell) don't cut it short.
				let next = Infinity;
				for (let ni = oi + 1; ni < onsets.length; ni++) {
					if (onsets[ni].strength >= o.strength * 0.4) {
						next = onsets[ni].frame;
						break;
					}
				}
				const sustainSec = measureSustain(energy[bi], o.frame, next);
				if (sustainSec >= HOLD_MIN_SEC) {
					holdSec = Math.round(Math.min(HOLD_MAX_SEC, sustainSec) * 20) / 20;
				}
			}
			events.push({ t: o.frame * HOP_SEC, band: bi, strength: o.strength, holdSec });
		}
	}
	events.sort((a, b) => a.t - b.t);

	// Cluster near-simultaneous cross-band onsets into chords; keep the
	// strongest event per band per cluster and align members to one time.
	const clusters = [];
	for (const e of events) {
		const cur = clusters[clusters.length - 1];
		if (cur && e.t - cur.t0 <= CLUSTER_SEC) {
			const existing = cur.perBand.get(e.band);
			if (!existing || e.strength > existing.strength) cur.perBand.set(e.band, e);
		} else {
			clusters.push({ t0: e.t, perBand: new Map([[e.band, e]]) });
		}
	}
	for (const c of clusters) {
		let top = null;
		for (const e of c.perBand.values()) if (!top || e.strength > top.strength) top = e;
		c.t = top.t;
	}

	// Salience: percentile rank of strength within each band, plus an accent
	// bonus when several bands hit together (kick+snare+cymbal downbeats etc).
	const kept = clusters.flatMap((c) => [...c.perBand.values()].map((e) => ({ e, c })));
	for (let bi = 0; bi < BANDS.length; bi++) {
		const band = kept.filter((k) => k.e.band === bi).sort((a, b) => a.e.strength - b.e.strength);
		band.forEach((k, i) => {
			let s = band.length > 1 ? i / (band.length - 1) : 1;
			const bandsInCluster = k.c.perBand.size;
			if (bandsInCluster >= 3) s += 0.12;
			else if (bandsInCluster === 2) s += 0.06;
			k.e.salience = Math.min(1, s);
		});
	}

	// Playability pass — chronological clusters, chord cap 2 (second note must
	// be salient), no flams (distinct times ≥ MIN_NOTE_SPACING_SEC apart), no
	// same-lane jacks, lanes blocked while a hold is sustained.
	const lastNoteTime = [-Infinity, -Infinity, -Infinity, -Infinity];
	const laneBlockedUntil = [-Infinity, -Infinity, -Infinity, -Infinity];
	let lastPlacedTime = -Infinity;
	let holds = 0;
	const notes = [];
	for (const c of clusters) {
		if (c.t - lastPlacedTime < MIN_NOTE_SPACING_SEC) continue;
		const candidates = [...c.perBand.values()].sort((a, b) => b.salience - a.salience);
		const usedLanes = new Set();
		let placed = 0;
		for (const e of candidates) {
			if (placed >= 2) break;
			if (placed === 1 && e.salience < CHORD_MIN_SALIENCE) break;
			const band = BANDS[e.band];
			const minGap = e.salience >= 0.75 ? LANE_GAP_STRONG_SEC : LANE_GAP_WEAK_SEC;
			const laneFree = (lane) =>
				!usedLanes.has(lane) && c.t >= laneBlockedUntil[lane] && c.t - lastNoteTime[lane] >= minGap;
			const lane = laneFree(band.lane) ? band.lane : laneFree(band.alt) ? band.alt : -1;
			if (lane < 0) continue;
			usedLanes.add(lane);
			lastNoteTime[lane] = c.t;
			if (e.holdSec > 0) {
				laneBlockedUntil[lane] = c.t + e.holdSec + HOLD_LANE_PAD_SEC;
				holds++;
			}
			notes.push([
				Math.round(c.t * 1000) / 1000,
				lane,
				Math.round(e.salience * 1000) / 1000,
				e.holdSec
			]);
			lastPlacedTime = c.t;
			placed++;
		}
	}
	notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

	// Gap holds: sustained-energy holds are rare in these densely arpeggiated
	// tracks, but holds are a core mechanic. A salient note whose lane stays
	// quiet long enough becomes a hold through that stretch — the player keeps
	// tapping the other lanes while sustaining. One hold at a time, spaced out
	// so they stay special.
	let lastHoldEnd = -Infinity;
	for (let i = 0; i < notes.length; i++) {
		const [t, lane, salience, existingHold] = notes[i];
		if (existingHold > 0) {
			lastHoldEnd = t + existingHold;
			continue;
		}
		if (salience < 0.6 || t < lastHoldEnd + 1.0) continue;
		let nextSameLane = durationSec;
		for (let j = i + 1; j < notes.length; j++) {
			if (notes[j][1] === lane) {
				nextSameLane = notes[j][0];
				break;
			}
			if (notes[j][0] - t > HOLD_MAX_SEC + 0.5) break;
		}
		const holdSec = Math.min(HOLD_MAX_SEC, nextSameLane - t - 0.3);
		if (holdSec < HOLD_MIN_SEC) continue;
		notes[i][3] = Math.round(holdSec * 20) / 20;
		lastHoldEnd = t + notes[i][3];
		holds++;
	}

	return {
		chart: {
			id: track.id,
			durationSec: Math.round(durationSec * 1000) / 1000,
			notes
		},
		stats: {
			durationSec,
			bpmEst,
			onsetCounts: onsetsPerBand.map((o) => o.length),
			clusters: clusters.length,
			holds,
			totalNotes: notes.length
		}
	};
}

// --- validation ---------------------------------------------------------------

function validateChart(chart) {
	const errors = [];
	const lastTime = [-Infinity, -Infinity, -Infinity, -Infinity];
	const holdUntil = [-Infinity, -Infinity, -Infinity, -Infinity];
	let prevT = -Infinity;
	let chordCount = 0;
	let chordT = -Infinity;
	for (const [t, lane, salience, holdSec] of chart.notes) {
		if (t < prevT) errors.push(`unsorted note @${t}`);
		prevT = t;
		if (t < 0 || t > chart.durationSec) errors.push(`out-of-range time @${t}`);
		if (lane < 0 || lane > 3 || !Number.isInteger(lane)) errors.push(`bad lane ${lane} @${t}`);
		if (salience < 0 || salience > 1) errors.push(`bad salience ${salience} @${t}`);
		if (holdSec < 0 || holdSec > HOLD_MAX_SEC) errors.push(`bad hold ${holdSec} @${t}`);
		if (t < holdUntil[lane]) errors.push(`note during hold lane ${lane} @${t}`);
		if (t - lastTime[lane] < LANE_GAP_STRONG_SEC - 1e-3)
			errors.push(`same-lane jack lane ${lane} @${t}`);
		lastTime[lane] = t;
		if (holdSec > 0) holdUntil[lane] = t + holdSec;
		if (t === chordT) {
			chordCount++;
			if (chordCount > 2) errors.push(`chord >2 @${t}`);
		} else {
			if (t - chordT < MIN_NOTE_SPACING_SEC - 1e-3) errors.push(`flam @${t}`);
			chordT = t;
			chordCount = 1;
		}
	}
	return errors;
}

// Stage densityBias → notes-per-minute target; must match NPM_PER_DENSITY in
// src/lib/voidhero/voidHero.charts.ts.
const NPM_PER_DENSITY = 110;

function densityReport(chart, durationSec) {
	const stages = [
		['Drift', 0.18],
		['Pulse', 0.34],
		['Surge', 0.5],
		['Storm', 0.66],
		['Void', 0.78],
		['Void cap', 0.86]
	];
	const mins = durationSec / 60;
	const saliences = chart.notes.map((n) => n[2]).sort((a, b) => b - a);
	return stages
		.map(([name, bias]) => {
			const target = Math.floor(bias * NPM_PER_DENSITY * mins);
			const n = Math.min(saliences.length, target);
			return `${name}: ${n} (${(n / mins).toFixed(0)}/min)`;
		})
		.join('  |  ');
}

// --- main ----------------------------------------------------------------------

const argv = process.argv.slice(2);
const scanMode = argv.includes('--scan');
const only = argv.filter((a) => a !== '--scan');

if (scanMode) {
	// Tempo diagnostic: rank autocorrelation candidates and show whole-beat grid
	// fit for each plus the metadata BPM. Use when adding/validating a track.
	const targets = only.length > 0 ? TRACKS.filter((t) => only.includes(t.id)) : TRACKS;
	for (const track of targets) {
		console.log(`\n=== scan ${track.id} (metadata ${track.bpm} BPM) ===`);
		const pcm = decode(join(ROOT, track.src));
		const { frames, flux } = analyze(pcm);
		const onsetsPerBand = flux.map((f) => pickOnsets(f));
		const { candidates } = estimateBpm(flux, frames);
		const rows = [...candidates.map((c) => c.bpm), track.bpm];
		for (const bpm of rows) {
			const fit = gridFit(onsetsPerBand, bpm);
			const tag = bpm === track.bpm ? ' ← metadata' : '';
			console.log(
				`bpm ${bpm.toFixed(2).padStart(7)} | aligned ${(fit.aligned * 100).toFixed(1).padStart(5)}% | ` +
					`mean err ${fit.meanErrMs.toFixed(1).padStart(6)}ms | offset ${fit.offset.toFixed(3)}s${tag}`
			);
		}
		// Fine scan: the autocorrelation lag grid is ~11.6ms so candidates are
		// quantized; a fractional-BPM error compounds into total misalignment over
		// a full track. Sweep ±2 BPM around each candidate at 0.02 BPM resolution.
		let best = { bpm: 0, aligned: -1, offset: 0 };
		const centers = [...new Set([...candidates.slice(0, 4).map((c) => c.bpm), track.bpm])];
		for (const center of centers) {
			for (let bpm = center - 2; bpm <= center + 2; bpm += 0.02) {
				const fit = gridFit(onsetsPerBand, bpm);
				if (fit.aligned > best.aligned) best = { bpm, aligned: fit.aligned, offset: fit.offset };
			}
		}
		console.log(
			`fine-scan best: bpm ${best.bpm.toFixed(2)} | aligned ${(best.aligned * 100).toFixed(1)}% | ` +
				`offset ${best.offset.toFixed(3)}s`
		);
	}
	process.exit(0);
}

const targets = only.length > 0 ? TRACKS.filter((t) => only.includes(t.id)) : TRACKS;
if (targets.length === 0) {
	console.error(`No matching tracks. Known: ${TRACKS.map((t) => t.id).join(', ')}`);
	process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
let failed = false;

for (const track of targets) {
	const path = join(ROOT, track.src);
	console.log(`\n=== ${track.id} (${track.bpm} BPM) ===`);
	const pcm = decode(path);
	const { chart, stats } = buildChart(track, pcm);

	console.log(`duration ${stats.durationSec.toFixed(1)}s | est BPM ${stats.bpmEst.toFixed(1)}`);
	console.log(
		`onsets per band [${stats.onsetCounts.join(', ')}] | clusters ${stats.clusters} | ` +
			`notes ${stats.totalNotes} (holds ${stats.holds})`
	);
	console.log(`density by stage → ${densityReport(chart, stats.durationSec)}`);

	const errors = validateChart(chart);
	if (errors.length > 0) {
		failed = true;
		console.error(`VALIDATION FAILED:\n  ${errors.slice(0, 10).join('\n  ')}`);
		continue;
	}
	const outPath = join(OUT_DIR, `${track.id}.json`);
	writeFileSync(outPath, JSON.stringify(chart));
	console.log(`wrote ${outPath}`);
}

process.exit(failed ? 1 : 0);
