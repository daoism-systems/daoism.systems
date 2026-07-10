type VisualizerFlagGetter = () => boolean;

type PreloaderVisualizerController = {
  attach: (svgEl: SVGSVGElement | undefined) => void;
  start: () => void;
  stop: () => void;
  destroy: () => void;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const VISUALISER_MAX_FPS = 60;
const VISUALISER_FRAME_INTERVAL_MS = 1000 / VISUALISER_MAX_FPS;
const STATIC_WAVE_INTENSITY = 0.2;
const ACTIVE_WAVE_INTENSITY = 1;
const DUMMY_BUFFER_LENGTH = 96;
const NOISE_FLOOR = 0.02;
const MIN_COLUMNS = 2;

const DOT_RADIUS = 1.35;
const DOT_GAP = 2.5;

// Dots inherit `fill` from the parent <g>; each state paints a different colour.
const COLOR_MUTED = 'rgb(182, 190, 206)';
const COLOR_STATIC = 'rgb(241, 244, 255)';
const COLOR_ACTIVE = 'rgb(255, 255, 255)';
const GLOW_FILTER = 'drop-shadow(0 0 2px rgba(255, 255, 255, 0.5))';

export function createPreloaderVisualizer(
  isEnterWithSound: VisualizerFlagGetter,
  isWavePlaying: VisualizerFlagGetter
): PreloaderVisualizerController {
  let svg: SVGSVGElement | undefined;
  let group: SVGGElement | undefined;
  let resizeObserver: ResizeObserver | null = null;

  let logicalWidth = 0;
  let logicalHeight = 0;

  let animationId = 0;
  let lastVisualiserFrameTs = 0;
  let waveIntensity = STATIC_WAVE_INTENSITY;
  let playBlend = 0;
  let motionPhase = 0;

  const dotRadius = DOT_RADIUS;
  let gridStep = 0;
  let columnCount = 0;

  let columnXs: number[] = [];
  let shiftedXs: number[] = [];
  let dataIndices: number[] = [];
  let edgeFadeByColumn: number[] = [];
  let isCenterBandByColumn: boolean[] = [];
  let isSparseByColumn: boolean[] = [];

  // Reused <circle> pool — grown on demand, repositioned each frame. Circles
  // past `drawCursor` are hidden rather than removed so the DOM stays stable.
  const circles: SVGCircleElement[] = [];
  let drawCursor = 0;
  let currentFill = '';
  let currentGlow = false;

  const dummyDataArray = new Uint8Array(DUMMY_BUFFER_LENGTH);
  const sampleX = new Float32Array(DUMMY_BUFFER_LENGTH);
  const sampleEnvelope = new Float32Array(DUMMY_BUFFER_LENGTH);
  const sampleStaticRidge = new Float32Array(DUMMY_BUFFER_LENGTH);

  for (let i = 0; i < DUMMY_BUFFER_LENGTH; i += 1) {
    const x = i / (DUMMY_BUFFER_LENGTH - 1);
    const centeredX = x - 0.5;
    sampleX[i] = x;
    sampleEnvelope[i] = Math.exp(-Math.pow(centeredX / 0.19, 2));
    sampleStaticRidge[i] = 0.78 + 0.22 * Math.cos(centeredX * Math.PI * 8.6);
  }

  function stop() {
    if (!animationId) return;
    cancelAnimationFrame(animationId);
    animationId = 0;
  }

  function recomputeGeometry() {
    if (!svg) return;

    logicalWidth = svg.clientWidth;
    logicalHeight = svg.clientHeight;

    // 1:1 viewBox → SVG user units equal CSS px, so the layout matches the old
    // canvas exactly while staying vector-crisp at any device pixel ratio.
    svg.setAttribute('viewBox', `0 0 ${logicalWidth} ${logicalHeight}`);

    gridStep = dotRadius * 2 + DOT_GAP;

    columnCount = Math.max(MIN_COLUMNS, Math.floor((logicalWidth - dotRadius * 2) / gridStep) + 1);
    const horizontalSpan = Math.max(0, logicalWidth - dotRadius * 2);
    const columnStep = columnCount > 1 ? horizontalSpan / (columnCount - 1) : 0;

    columnXs = new Array(columnCount);
    shiftedXs = new Array(columnCount);
    dataIndices = new Array(columnCount);
    edgeFadeByColumn = new Array(columnCount);
    isCenterBandByColumn = new Array(columnCount);
    isSparseByColumn = new Array(columnCount);

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const progressX = columnCount > 1 ? columnIndex / (columnCount - 1) : 0;
      const x = dotRadius + columnIndex * columnStep;
      const centerDistance = Math.abs(progressX - 0.5);

      columnXs[columnIndex] = x;
      shiftedXs[columnIndex] =
        progressX > 0.5 ? Math.min(logicalWidth - dotRadius, x + columnStep) : x;
      dataIndices[columnIndex] = Math.min(
        DUMMY_BUFFER_LENGTH - 1,
        Math.floor(progressX * DUMMY_BUFFER_LENGTH)
      );
      edgeFadeByColumn[columnIndex] = Math.max(0, 1 - Math.pow(Math.abs(progressX - 0.5) * 2, 1.4));
      isCenterBandByColumn[columnIndex] = centerDistance <= 0.22;
      isSparseByColumn[columnIndex] = columnIndex % 2 === 0;
    }
  }

  function emitDot(g: SVGGElement, x: number, y: number, opacity: number) {
    let circle = circles[drawCursor];
    if (!circle) {
      circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r', String(dotRadius));
      g.appendChild(circle);
      circles.push(circle);
    }

    circle.setAttribute('cx', x.toFixed(2));
    circle.setAttribute('cy', y.toFixed(2));
    circle.setAttribute('opacity', opacity.toFixed(3));
    if (circle.style.display === 'none') circle.style.display = '';

    drawCursor += 1;
  }

  function hideRest() {
    for (let i = drawCursor; i < circles.length; i += 1) {
      if (circles[i].style.display !== 'none') circles[i].style.display = 'none';
    }
  }

  function setStyle(g: SVGGElement, fill: string, glow: boolean) {
    if (fill !== currentFill) {
      g.setAttribute('fill', fill);
      currentFill = fill;
    }
    if (glow !== currentGlow) {
      g.style.filter = glow ? GLOW_FILTER : 'none';
      currentGlow = glow;
    }
  }

  function draw(timestamp: number) {
    if (!svg || !group || logicalWidth <= 0 || logicalHeight <= 0 || columnCount <= 0) {
      stop();
      return;
    }

    animationId = requestAnimationFrame(draw);

    const frameDelta =
      lastVisualiserFrameTs === 0
        ? VISUALISER_FRAME_INTERVAL_MS
        : timestamp - lastVisualiserFrameTs;

    if (lastVisualiserFrameTs !== 0 && frameDelta < VISUALISER_FRAME_INTERVAL_MS) {
      return;
    }

    lastVisualiserFrameTs = timestamp;

    const g = group;
    const midY = logicalHeight / 2;
    drawCursor = 0;

    if (!isEnterWithSound()) {
      setStyle(g, COLOR_MUTED, false);

      for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        emitDot(g, columnXs[columnIndex], midY, 0.85);
      }

      hideRest();
      return;
    }

    const activeWave = isWavePlaying();

    if (!activeWave) {
      waveIntensity = STATIC_WAVE_INTENSITY;
      playBlend = 0;
      motionPhase = 0;
      setStyle(g, COLOR_STATIC, false);

      for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        emitDot(g, columnXs[columnIndex], midY, 0.9);

        if (isCenterBandByColumn[columnIndex] && isSparseByColumn[columnIndex]) {
          emitDot(g, shiftedXs[columnIndex], midY - gridStep, 0.82);
          emitDot(g, shiftedXs[columnIndex], midY + gridStep, 0.82);
        }
      }

      hideRest();
      return;
    }

    const intensityLerp = 1 - Math.exp(-frameDelta / 150);
    const blendLerp = 1 - Math.exp(-frameDelta / 230);

    playBlend += (1 - playBlend) * blendLerp;
    waveIntensity += (ACTIVE_WAVE_INTENSITY - waveIntensity) * intensityLerp;

    if (playBlend > 0.002) {
      motionPhase += frameDelta * (0.0018 + playBlend * 0.0032);
    } else {
      motionPhase = 0;
    }

    for (let i = 0; i < DUMMY_BUFFER_LENGTH; i += 1) {
      const x = sampleX[i];
      const centerEnvelope = sampleEnvelope[i];
      const staticShape = centerEnvelope * sampleStaticRidge[i];

      const movingA = Math.sin(x * 9.4 + motionPhase * 1.8) * 0.42;
      const movingB = Math.sin(x * 19.7 - motionPhase * 2.9) * 0.33;
      const movingC = Math.sin(x * 33.6 + motionPhase * 4.1) * 0.25;
      const movingShape = Math.abs(movingA + movingB + movingC) * (0.2 + centerEnvelope * 0.8);

      const shapedAmplitude = staticShape * (1 - playBlend) + movingShape * playBlend;
      const intensity = shapedAmplitude * (0.36 + waveIntensity * 0.64);

      dummyDataArray[i] = Math.max(0, Math.min(255, Math.round(128 + intensity * 108)));
    }

    setStyle(g, COLOR_ACTIVE, true);

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const value = dummyDataArray[dataIndices[columnIndex]];

      let rawAmplitude = Math.abs(value - 128) / 128;
      if (rawAmplitude < NOISE_FLOOR) rawAmplitude = 0;

      const easedAmplitude = Math.pow(rawAmplitude, 0.82);
      const columnHeight = easedAmplitude * (gridStep * 2.35);
      const baseAlpha = 0.84 + edgeFadeByColumn[columnIndex] * 0.14;

      for (let y = 0; y <= columnHeight; y += gridStep) {
        emitDot(g, columnXs[columnIndex], midY - y, baseAlpha);
        if (y > 0) {
          emitDot(g, columnXs[columnIndex], midY + y, baseAlpha);
        }
      }
    }

    hideRest();
  }

  function teardownGroup() {
    group?.remove();
    group = undefined;
    circles.length = 0;
    currentFill = '';
    currentGlow = false;
  }

  function attach(nextSvg: SVGSVGElement | undefined) {
    if (svg === nextSvg) return;

    stop();
    resizeObserver?.disconnect();
    resizeObserver = null;
    teardownGroup();
    svg = nextSvg;

    if (!svg) {
      logicalWidth = 0;
      logicalHeight = 0;
      columnCount = 0;
      return;
    }

    group = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(group);

    recomputeGeometry();

    resizeObserver = new ResizeObserver(() => {
      recomputeGeometry();
    });

    resizeObserver.observe(svg);
  }

  function start() {
    if (!svg || !group || logicalWidth <= 0 || logicalHeight <= 0) return;
    stop();
    lastVisualiserFrameTs = 0;
    draw(0);
  }

  function destroy() {
    stop();
    resizeObserver?.disconnect();
    resizeObserver = null;
    teardownGroup();
    svg = undefined;
  }

  return {
    attach,
    start,
    stop,
    destroy
  };
}
