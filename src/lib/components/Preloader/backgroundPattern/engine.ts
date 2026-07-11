// Renderer for the preloader background grid. Context-agnostic: the target canvas may be an
// HTMLCanvasElement (main-thread fallback) or an OffscreenCanvas (worker path), so this module
// touches no DOM, store, or events — the host (component or worker) feeds it via the returned API.

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type LayerBuffer = {
	canvas: AnyCanvas;
	ctx: Ctx2D;
};

type BackgroundPhase = 'fill' | 'cleanup' | 'done';

export type BackgroundPatternEngine = {
	resize: (width: number, height: number) => void;
	setProgress: (value: number) => void;
	setPointer: (x: number, y: number) => void;
	setVisible: (visible: boolean) => void;
	start: () => void;
	stop: () => void;
};

type EngineOptions = {
	canvas: AnyCanvas;
	dpr: number;
	reducedMotion: boolean;
	onTransitionComplete: () => void;
	// Eased progress readout. The bar and this value share one source, so the DOM number
	// (LoadingLabel) can follow the bar's exact curve instead of running a divergent
	// main-thread easer. Fired only when the integer readout changes — the label rounds,
	// so per-frame reporting would just spam identical values across the worker boundary.
	onDisplayProgress?: (value: number) => void;
};

const cellWidth = 18;
const cellHeight = 10;
const cellGapX = 8;
const cellGapY = 8;
const gridStrokeColor = 'rgba(255, 255, 255, 0.18)';
const gridFillColor = 'rgba(255, 255, 255, 0.025)';
const gridOpacity = 0.88;
const ACTIVE_AREA_RATIO = 0.68;
const ACTIVE_AREA_SOFTNESS_PX = 108;
const ACTIVE_AREA_CONTRAST = 1.45;
const DEPTH_MIN = 0.42;
const DEPTH_MAX = 1;
const RED_LAYER_OPACITY = 0.84;
const FILL_EDGE_SOFTNESS_PX = 136;
const FILL_FOLLOW_MS = 340;
const FILL_MAX_SPEED_PX_PER_SEC = 760;
const CLEANUP_DURATION_MS = 1500;
const CLEANUP_EDGE_SOFTNESS_PX = 152;
const FLAME_NOISE_FX = 8;
const FLAME_NOISE_FY = 2.5;
const FLAME_OCTAVES = 4;
const FLAME_CONTRAST = 1.6;
const FLAME_STRENGTH = 0.4;
const BACKGROUND_WASH_STRENGTH = 0.5;
const BACKGROUND_WASH_TOP_ALPHA = 0.08;
const BACKGROUND_WASH_CENTER_ALPHA = 0.05;
const TRAIL_RADIUS_PX = 72;
const TRAIL_DECAY_MS = 460;
const TRAIL_MAX_ALPHA = 0.3;
const TRAIL_STEP_RATIO = 0.5;

// Progress is advanced on the render thread (not the main thread) so the bar keeps
// moving while the main thread is blocked compiling shaders. Rather than easing toward
// the lumpy real target (which arrives in bursts and decelerates as it converges), the
// bar sweeps at a constant velocity toward a sub-100 ceiling: a steady, smooth, linear
// march that never stalls during a long block (e.g. precompileAsync). The bar holds at
// the ceiling until the host reports real completion (target >= 100), then finishes
// linearly to 100.
const PROGRESS_CEILING = 99; // the linear sweep holds here — only real completion releases it
const PROGRESS_SWEEP_MS = 8000; // wall-clock for the full 0 -> ceiling linear sweep
const PROGRESS_FINISH_MS = 400; // linear finish to 100 once the host reports 100
const PROGRESS_SWEEP_PER_MS = PROGRESS_CEILING / PROGRESS_SWEEP_MS;
const PROGRESS_FINISH_PER_MS = 100 / PROGRESS_FINISH_MS;
const BAR_HEIGHT_PX = 2;
const BAR_COLOR = '#e64749';
const BAR_GLOW_COLOR = 'rgba(230, 71, 73, 0.5)';
const BAR_GLOW_BLUR_PX = 10;

const pitchX = cellWidth + cellGapX;
const pitchY = cellHeight + cellGapY;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeInOutSine = (value: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(value));
const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp01(value), 3);
const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

const hashNoise = (ix: number, iy: number) => {
	let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967295;
};

const valueNoise = (x: number, y: number) => {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const n00 = hashNoise(x0, y0);
	const n10 = hashNoise(x0 + 1, y0);
	const n01 = hashNoise(x0, y0 + 1);
	const n11 = hashNoise(x0 + 1, y0 + 1);
	const nx0 = n00 + (n10 - n00) * sx;
	const nx1 = n01 + (n11 - n01) * sx;
	return nx0 + (nx1 - nx0) * sy;
};

const fbm = (x: number, y: number) => {
	let amplitude = 0.5;
	let frequency = 1;
	let sum = 0;
	let norm = 0;
	for (let octave = 0; octave < FLAME_OCTAVES; octave++) {
		sum += amplitude * valueNoise(x * frequency, y * frequency);
		norm += amplitude;
		amplitude *= 0.5;
		frequency *= 2;
	}
	return sum / norm;
};

// Subtle flame texture for the red fill: vertically-stretched fbm wisps, contrast-boosted
// so they read as flame. Returns 0..1; baked into each red cell's alpha at rebuild time.
const flameAt = (nx: number, ny: number) => {
	const n = fbm(nx * FLAME_NOISE_FX, ny * FLAME_NOISE_FY);
	return clamp01((n - 0.5) * FLAME_CONTRAST + 0.5);
};

const areaMaskForY = (centerY: number, activeAreaBottom: number) => {
	const areaMaskSoftness = Math.max(ACTIVE_AREA_SOFTNESS_PX, pitchY * 5);
	const withinArea = clamp01(1 - centerY / Math.max(activeAreaBottom, 1));
	const withinMask = Math.pow(withinArea, ACTIVE_AREA_CONTRAST);
	const overflowMask =
		centerY <= activeAreaBottom
			? 1
			: 1 - sigmoid((centerY - activeAreaBottom) / Math.max(areaMaskSoftness * 0.45, 1));
	return clamp01(withinMask * overflowMask);
};

// OffscreenCanvas backs internal buffers in both contexts (it exists on the main thread too);
// only the rare browser that lacks it — and therefore also lacks transferControlToOffscreen, so
// it took the main-thread fallback — uses a DOM canvas.
const createBuffer = (width: number, height: number): AnyCanvas =>
	typeof OffscreenCanvas !== 'undefined'
		? new OffscreenCanvas(width, height)
		: document.createElement('canvas');

const get2d = (canvas: AnyCanvas): Ctx2D | null =>
	(canvas as HTMLCanvasElement).getContext('2d') as Ctx2D | null;

// Workers may lack requestAnimationFrame; fall back to a timer (delta-time clamping keeps motion
// sane without vsync). performance.now() exists in both contexts.
const raf: (cb: FrameRequestCallback) => number =
	typeof requestAnimationFrame !== 'undefined'
		? requestAnimationFrame.bind(globalThis)
		: (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
const caf: (id: number) => void =
	typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame.bind(globalThis) : clearTimeout;

export function createBackgroundPatternEngine(options: EngineOptions): BackgroundPatternEngine {
	const { canvas, dpr, reducedMotion, onTransitionComplete, onDisplayProgress } = options;
	const ctx = get2d(canvas);
	if (!ctx) {
		const noop = () => {};
		return {
			resize: noop,
			setProgress: noop,
			setPointer: noop,
			setVisible: noop,
			start: noop,
			stop: noop
		};
	}

	let baseCellSprite: AnyCanvas | null = null;
	let redCellSprite: AnyCanvas | null = null;
	let highlightCellSprite: AnyCanvas | null = null;
	let staticLayer: LayerBuffer | null = null;
	let redLayer: LayerBuffer | null = null;
	let maskedRedLayer: LayerBuffer | null = null;
	let viewportWidth = 0;
	let viewportHeight = 0;
	let frameId = 0;
	let started = false;
	let stopped = false;
	let isVisible = true;
	let phase: BackgroundPhase = 'fill';
	let lastTimestamp = performance.now();
	let fillFrontierVisualY = Number.NaN;
	let cleanupStartAt = 0;
	let transitionCompleteNotified = false;
	let targetProgress = 0;
	let displayedProgress = 0;
	let lastReportedProgress = -1;

	const trailCells = new Map<number, { x: number; y: number; i: number }>();
	let trailCols = 0;
	let trailRows = 0;
	let trailStride = 0;
	let trailActiveAreaBottom = 0;
	let pointerX = 0;
	let pointerY = 0;
	let lastStampX = 0;
	let lastStampY = 0;
	let pointerMoved = false;
	let pointerInitialized = false;
	let trailNeedsClear = false;

	const createSprite = (draw: (spriteCtx: Ctx2D) => void): AnyCanvas | null => {
		const sprite = createBuffer(
			Math.max(1, Math.ceil(cellWidth * dpr)),
			Math.max(1, Math.ceil(cellHeight * dpr))
		);
		const spriteCtx = get2d(sprite);
		if (!spriteCtx) return null;
		spriteCtx.scale(dpr, dpr);
		draw(spriteCtx);
		return sprite;
	};

	const createLayerBuffer = (width: number, height: number): LayerBuffer | null => {
		const layerCanvas = createBuffer(
			Math.max(1, Math.floor(width * dpr)),
			Math.max(1, Math.floor(height * dpr))
		);
		const layerCtx = get2d(layerCanvas);
		if (!layerCtx) return null;
		layerCtx.scale(dpr, dpr);
		return { canvas: layerCanvas, ctx: layerCtx };
	};

	const buildSprites = () => {
		baseCellSprite = createSprite((spriteCtx) => {
			spriteCtx.fillStyle = gridFillColor;
			spriteCtx.fillRect(0.5, 0.5, cellWidth - 1, cellHeight - 1);
			spriteCtx.strokeStyle = gridStrokeColor;
			spriteCtx.lineWidth = 1;
			spriteCtx.strokeRect(0.5, 0.5, cellWidth - 1, cellHeight - 1);
		});

		redCellSprite = createSprite((spriteCtx) => {
			const gradient = spriteCtx.createLinearGradient(0, 0, 0, cellHeight);
			gradient.addColorStop(0, 'rgba(230, 71, 73, 0.22)');
			gradient.addColorStop(1, 'rgba(230, 71, 73, 0.60)');
			spriteCtx.fillStyle = gradient;
			spriteCtx.fillRect(1, 1, cellWidth - 2, cellHeight - 2);
			spriteCtx.strokeStyle = 'rgba(255, 162, 157, 0.26)';
			spriteCtx.lineWidth = 1;
			spriteCtx.strokeRect(0.5, 0.5, cellWidth - 1, cellHeight - 1);
		});

		highlightCellSprite = createSprite((spriteCtx) => {
			spriteCtx.fillStyle = 'rgba(255, 214, 190, 0.16)';
			spriteCtx.fillRect(0.5, 0.5, cellWidth - 1, cellHeight - 1);
			spriteCtx.strokeStyle = 'rgba(255, 224, 205, 0.85)';
			spriteCtx.lineWidth = 1;
			spriteCtx.strokeRect(0.5, 0.5, cellWidth - 1, cellHeight - 1);
		});
	};

	const drawBackgroundWash = (targetCtx: Ctx2D) => {
		const washes = [
			[0.5, 0.3, 0.52, 0.5, BACKGROUND_WASH_TOP_ALPHA],
			[0.5, 0.44, 0.96, 0.88, BACKGROUND_WASH_CENTER_ALPHA]
		];

		for (const [x, y, radiusX, radiusY, alpha] of washes) {
			targetCtx.save();
			targetCtx.translate(viewportWidth * x, viewportHeight * y);
			targetCtx.scale(viewportWidth * radiusX, viewportHeight * radiusY);
			const gradient = targetCtx.createRadialGradient(0, 0, 0, 0, 0, 1);
			const strength = alpha * BACKGROUND_WASH_STRENGTH;
			gradient.addColorStop(0, `rgba(255, 255, 255, ${strength})`);
			gradient.addColorStop(0.7, `rgba(255, 255, 255, ${strength * 0.34})`);
			gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
			targetCtx.fillStyle = gradient;
			targetCtx.fillRect(-1, -1, 2, 2);
			targetCtx.restore();
		}
	};

	const rebuildLayers = () => {
		if (!baseCellSprite || !redCellSprite) return;

		staticLayer = createLayerBuffer(viewportWidth, viewportHeight);
		redLayer = createLayerBuffer(viewportWidth, viewportHeight);
		maskedRedLayer = createLayerBuffer(viewportWidth, viewportHeight);
		if (!staticLayer || !redLayer || !maskedRedLayer) return;

		// Bake the fully-opaque background (black + wash) into staticLayer once; the grid cells draw
		// on top, so presenting a frame is a single opaque blit instead of a per-frame fill + washes.
		staticLayer.ctx.fillStyle = '#000';
		staticLayer.ctx.fillRect(0, 0, viewportWidth, viewportHeight);
		drawBackgroundWash(staticLayer.ctx);

		const activeAreaBottom = viewportHeight * ACTIVE_AREA_RATIO;
		const cols = Math.ceil((viewportWidth + pitchX) / pitchX) + 1;
		const rows = Math.ceil((viewportHeight + pitchY) / pitchY) + 1;

		trailActiveAreaBottom = activeAreaBottom;
		trailCols = cols;
		trailRows = rows;
		trailStride = cols + 2;
		trailCells.clear();

		for (let row = -1; row < rows; row++) {
			for (let col = -1; col < cols; col++) {
				const x = col * pitchX;
				const y = row * pitchY;
				const centerX = x + cellWidth * 0.5;
				const centerY = y + cellHeight * 0.5;
				const areaMask = areaMaskForY(centerY, activeAreaBottom);
				if (areaMask <= 0.002) continue;

				staticLayer.ctx.globalAlpha = gridOpacity * areaMask;
				staticLayer.ctx.drawImage(baseCellSprite, x, y, cellWidth, cellHeight);

				const flame = flameAt(centerX / Math.max(viewportWidth, 1), centerY / Math.max(activeAreaBottom, 1));
				const flameMod = 1 - FLAME_STRENGTH + FLAME_STRENGTH * flame;
				const depth = DEPTH_MIN + Math.random() * (DEPTH_MAX - DEPTH_MIN);
				redLayer.ctx.globalAlpha = Math.min(1, areaMask * depth * RED_LAYER_OPACITY * flameMod);
				redLayer.ctx.drawImage(redCellSprite, x, y, cellWidth, cellHeight);
			}
		}

		staticLayer.ctx.globalAlpha = 1;
		redLayer.ctx.globalAlpha = 1;
	};

	const addColorStop = (gradient: CanvasGradient, offset: number, alpha: number) => {
		gradient.addColorStop(clamp01(offset), `rgba(0, 0, 0, ${alpha})`);
	};

	const drawMaskedRedLayer = (
		targetCtx: Ctx2D,
		currentPhase: BackgroundPhase,
		frontierY: number
	) => {
		if (!redLayer || !maskedRedLayer) return;

		const maskCtx = maskedRedLayer.ctx;
		maskCtx.clearRect(0, 0, viewportWidth, viewportHeight);
		maskCtx.globalCompositeOperation = 'source-over';
		maskCtx.globalAlpha = 1;
		maskCtx.drawImage(redLayer.canvas, 0, 0, viewportWidth, viewportHeight);
		maskCtx.globalCompositeOperation = 'destination-in';

		const softness =
			currentPhase === 'cleanup'
				? Math.max(CLEANUP_EDGE_SOFTNESS_PX, pitchY * 3.6)
				: Math.max(FILL_EDGE_SOFTNESS_PX, pitchY * 3.4);
		const halfSoftness = softness * 0.5;
		const start = clamp01((frontierY - halfSoftness) / Math.max(viewportHeight, 1));
		const end = clamp01((frontierY + halfSoftness) / Math.max(viewportHeight, 1));
		const span = Math.max(end - start, 0.0001);
		const lead = clamp01(start + span * 0.18);
		const mid = clamp01(start + span * 0.5);
		const tail = clamp01(start + span * 0.82);
		const gradient = maskCtx.createLinearGradient(0, 0, 0, viewportHeight);

		if (currentPhase === 'cleanup') {
			addColorStop(gradient, 0, 1);
			addColorStop(gradient, start, 1);
			addColorStop(gradient, lead, 0.92);
			addColorStop(gradient, mid, 0.58);
			addColorStop(gradient, tail, 0.16);
			addColorStop(gradient, end, 0.02);
			addColorStop(gradient, 1, 0);
		} else {
			addColorStop(gradient, 0, 0);
			addColorStop(gradient, start, 0.02);
			addColorStop(gradient, lead, 0.14);
			addColorStop(gradient, mid, 0.52);
			addColorStop(gradient, tail, 0.88);
			addColorStop(gradient, end, 1);
			addColorStop(gradient, 1, 1);
		}

		maskCtx.fillStyle = gradient;
		maskCtx.fillRect(0, 0, viewportWidth, viewportHeight);
		maskCtx.globalCompositeOperation = 'source-over';
		targetCtx.drawImage(maskedRedLayer.canvas, 0, 0, viewportWidth, viewportHeight);
	};

	const drawStaticLayer = (targetCtx: Ctx2D) => {
		if (!staticLayer) return;
		targetCtx.globalAlpha = 1;
		targetCtx.globalCompositeOperation = 'source-over';
		targetCtx.drawImage(staticLayer.canvas, 0, 0, viewportWidth, viewportHeight);
	};

	// Deposit a soft, distance-weighted highlight onto every grid cell within TRAIL_RADIUS_PX of
	// the pointer. Cells store their peak intensity (max-stamp) and decay over time, so the lit
	// cluster trails behind motion and fades when the cursor stops.
	const stampTrailPoint = (px: number, py: number) => {
		const radius = TRAIL_RADIUS_PX;
		const colStart = Math.max(-1, Math.floor((px - radius) / pitchX) - 1);
		const colEnd = Math.min(trailCols - 1, Math.ceil((px + radius) / pitchX));
		const rowStart = Math.max(-1, Math.floor((py - radius) / pitchY) - 1);
		const rowEnd = Math.min(trailRows - 1, Math.ceil((py + radius) / pitchY));

		for (let row = rowStart; row <= rowEnd; row++) {
			for (let col = colStart; col <= colEnd; col++) {
				const x = col * pitchX;
				const y = row * pitchY;
				const centerX = x + cellWidth * 0.5;
				const centerY = y + cellHeight * 0.5;
				const dist = Math.hypot(centerX - px, centerY - py);
				if (dist > radius) continue;
				const falloff = 1 - dist / radius;
				const eased = falloff * falloff * (3 - 2 * falloff);
				const target = eased * areaMaskForY(centerY, trailActiveAreaBottom);
				if (target < 0.01) continue;
				const key = (row + 1) * trailStride + (col + 1);
				const existing = trailCells.get(key);
				if (existing) {
					if (target > existing.i) existing.i = target;
				} else {
					trailCells.set(key, { x, y, i: target });
				}
			}
		}
	};

	const stampTrailSegment = (x0: number, y0: number, x1: number, y1: number) => {
		const dist = Math.hypot(x1 - x0, y1 - y0);
		const steps = Math.max(1, Math.ceil(dist / (pitchX * TRAIL_STEP_RATIO)));
		for (let step = 0; step <= steps; step++) {
			const t = step / steps;
			stampTrailPoint(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
		}
	};

	const updateTrail = (deltaMs: number) => {
		if (trailCells.size > 0) {
			const decay = Math.exp(-deltaMs / TRAIL_DECAY_MS);
			for (const [key, cell] of trailCells) {
				cell.i *= decay;
				if (cell.i < 0.01) trailCells.delete(key);
			}
		}
		if (pointerMoved) {
			stampTrailSegment(lastStampX, lastStampY, pointerX, pointerY);
			lastStampX = pointerX;
			lastStampY = pointerY;
			pointerMoved = false;
		}
	};

	const drawTrailLayer = (targetCtx: Ctx2D) => {
		if (!highlightCellSprite || trailCells.size === 0) return;
		targetCtx.globalCompositeOperation = 'source-over';
		for (const cell of trailCells.values()) {
			const alpha = cell.i * TRAIL_MAX_ALPHA;
			if (alpha <= 0.003) continue;
			targetCtx.globalAlpha = alpha;
			targetCtx.drawImage(highlightCellSprite, cell.x, cell.y, cellWidth, cellHeight);
		}
		targetCtx.globalAlpha = 1;
	};

	// The loading bar lives here (not in the DOM) so it animates on the render thread,
	// immune to main-thread stalls. Spans the canvas bottom edge; fades out as it tops out.
	const drawProgressBar = (targetCtx: Ctx2D) => {
		const fillWidth = clamp01(displayedProgress / 100) * viewportWidth;
		if (fillWidth <= 0) return;
		const alpha = 1 - clamp01(displayedProgress - 99); // fade across the final 1%
		if (alpha <= 0.001) return;
		targetCtx.save();
		targetCtx.globalCompositeOperation = 'source-over';
		targetCtx.globalAlpha = alpha;
		targetCtx.shadowColor = BAR_GLOW_COLOR;
		targetCtx.shadowBlur = BAR_GLOW_BLUR_PX;
		targetCtx.fillStyle = BAR_COLOR;
		targetCtx.fillRect(0, viewportHeight - BAR_HEIGHT_PX, fillWidth, BAR_HEIGHT_PX);
		targetCtx.restore();
	};

	const renderFrame = (currentPhase: BackgroundPhase, frontierY: number) => {
		const resolvedFrontierY = Number.isNaN(frontierY) ? viewportHeight * ACTIVE_AREA_RATIO : frontierY;
		drawStaticLayer(ctx);
		if (currentPhase !== 'done') {
			drawMaskedRedLayer(ctx, currentPhase, resolvedFrontierY);
		}
		drawTrailLayer(ctx);
		drawProgressBar(ctx);
	};

	const draw = (now: number) => {
		if (stopped) return;

		if (!isVisible) {
			lastTimestamp = now;
			frameId = raf(draw);
			return;
		}

		if (!staticLayer || !redLayer || !maskedRedLayer) {
			frameId = raf(draw);
			return;
		}

		const rawDeltaMs = Math.max(0, now - lastTimestamp);
		const deltaMs = Math.min(rawDeltaMs, 48);
		lastTimestamp = now;

		// Preloader has finished, but the grid stays on screen behind the CTA. Keep the loop alive
		// so the cursor trail still animates — only repaint when the trail has activity (plus one
		// final clearing pass when it empties), so an idle CTA screen stays cheap.
		if (phase === 'done') {
			if (reducedMotion) return;
			updateTrail(deltaMs);
			if (trailCells.size > 0 || trailNeedsClear) {
				trailNeedsClear = trailCells.size > 0;
				renderFrame('done', viewportHeight * ACTIVE_AREA_RATIO);
			}
			frameId = raf(draw);
			return;
		}

		// Constant-velocity (linear) advance, so the bar reads as a steady, smooth march
		// instead of an exponential ease that visibly decelerates. Monotonic: only ever
		// pushes upward. The bar climbs to PROGRESS_CEILING and holds there; only real
		// completion (target >= 100) releases it, finishing linearly to 100.
		if (targetProgress >= 100) {
			displayedProgress = Math.min(100, displayedProgress + PROGRESS_FINISH_PER_MS * deltaMs);
		} else if (displayedProgress < PROGRESS_CEILING) {
			displayedProgress = Math.min(
				PROGRESS_CEILING,
				displayedProgress + PROGRESS_SWEEP_PER_MS * deltaMs
			);
		}

		// Mirror the bar's eased value to the host on each integer step. displayedProgress is
		// monotonic non-decreasing, so this never thrashes a boundary.
		if (onDisplayProgress) {
			const rounded = Math.round(displayedProgress);
			if (rounded !== lastReportedProgress) {
				lastReportedProgress = rounded;
				onDisplayProgress(displayedProgress);
			}
		}

		const activeAreaBottom = viewportHeight * ACTIVE_AREA_RATIO;
		const progressRatio = clamp01(displayedProgress / 100);
		// Overshoot the top edge by the fill mask's half-softness so the grid solidifies to full red
		// across the active area during the fill's easing. Without it the top ~68px stays a soft
		// leading edge, then snaps to full when cleanup pins the top opaque — a "pop to full red".
		const fillFrontierTargetY =
			activeAreaBottom - (activeAreaBottom + FILL_EDGE_SOFTNESS_PX * 0.5) * easeInOutSine(progressRatio);

		if (Number.isNaN(fillFrontierVisualY)) {
			fillFrontierVisualY = fillFrontierTargetY;
		} else {
			const followEase = 1 - Math.exp(-deltaMs / FILL_FOLLOW_MS);
			const desiredStep = (fillFrontierTargetY - fillFrontierVisualY) * followEase;
			const maxStep = (FILL_MAX_SPEED_PX_PER_SEC * deltaMs) / 1000;
			const step = Math.sign(desiredStep) * Math.min(Math.abs(desiredStep), maxStep);
			fillFrontierVisualY += step;
		}

		const fillFrontierY = fillFrontierVisualY;

		if (
			phase === 'fill' &&
			displayedProgress >= 99.9 &&
			Math.abs(fillFrontierTargetY - fillFrontierY) <= pitchY * 0.25
		) {
			phase = 'cleanup';
			cleanupStartAt = now;
		}

		let currentPhase = phase;
		let frontierY = fillFrontierY;

		if (phase === 'cleanup') {
			const cleanupElapsedRatio = clamp01((now - cleanupStartAt) / CLEANUP_DURATION_MS);
			const cleanupRatio = easeOutCubic(cleanupElapsedRatio);
			// Overshoot the top edge by the mask's half-softness so the soft red band above the
			// frontier fully clears before the hard cut to 'done' — otherwise a ~76px residual band
			// stays lit at frontierY=0 and pops off when the red layer stops drawing.
			frontierY = activeAreaBottom - (activeAreaBottom + CLEANUP_EDGE_SOFTNESS_PX * 0.5) * cleanupRatio;
			if (cleanupElapsedRatio >= 1) {
				phase = 'done';
				currentPhase = 'done';
				if (!transitionCompleteNotified) {
					transitionCompleteNotified = true;
					onTransitionComplete();
				}
			}
		}

		updateTrail(deltaMs);
		renderFrame(currentPhase, frontierY);
		frameId = raf(draw);
	};

	buildSprites();

	const resize = (width: number, height: number) => {
		viewportWidth = Math.max(1, Math.round(width));
		viewportHeight = Math.max(1, Math.round(height));
		canvas.width = Math.max(1, Math.round(viewportWidth * dpr));
		canvas.height = Math.max(1, Math.round(viewportHeight * dpr));
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		rebuildLayers();
		renderFrame(phase, fillFrontierVisualY);
	};

	return {
		resize,
		setProgress: (value: number) => {
			// Raw target from the host; the draw loop eases displayedProgress toward it.
			targetProgress = Math.min(100, Math.max(0, value));
		},
		setPointer: (x: number, y: number) => {
			pointerX = x;
			pointerY = y;
			if (!pointerInitialized) {
				lastStampX = x;
				lastStampY = y;
				pointerInitialized = true;
			}
			pointerMoved = true;
		},
		setVisible: (visible: boolean) => {
			isVisible = visible;
		},
		start: () => {
			if (started) return;
			started = true;
			lastTimestamp = performance.now();
			frameId = raf(draw);
		},
		stop: () => {
			stopped = true;
			caf(frameId);
		}
	};
}
