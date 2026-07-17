import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { detectMob, detectSafari } from '$lib/utils/isMobile';

// ── Tier ────────────────────────────────────────────────────────────────────

export type GraphicsTier = 'low' | 'medium' | 'high';

// ── Graphics options ────────────────────────────────────────────────────────

export interface GraphicsOptions {
	maxResolution: { width: number; height: number };
	resolutionScale: number;
	denoise: boolean;
	shadowMapType: THREE.ShadowMapType | null;
	enableOctagonParticles: boolean;
	enableOctagonPhysics: boolean;
	postProcessing: {
		bloom: boolean;
		fxaa: boolean;
		fluidDistortion: boolean;
		chromaticAberration: boolean;
		vignette: boolean;
		cloudTransition: boolean;
		// While a scene transition is in flight, skip re-rendering the pair's
		// non-dominant scene channel and let the dissolve sample its last fresh
		// frame (see PostProcessingGraph.isChannelFrozen). Halves the in-band
		// scene-render cost, but the camera keeps moving through transitions, so
		// the frozen side is parallax-misaligned under the dissolve — needs an
		// on-device visual pass before enabling.
		freezeTransitionScenes: boolean;
	};
	bloomMultiplier: number;
	bloomThresholdOffset: number;
	chromeStrengthMultiplier: number;
	chromeScaleMultiplier: number;
	chromeSplitMix: number;
	chromeExclusionRadius: number;
}

/** Clamp width/height to maxResolution while preserving aspect ratio. */
export function clampResolution(
	width: number,
	height: number,
	max: { width: number; height: number }
): { width: number; height: number } {
	const scale = Math.min(1, max.width / width, max.height / height);
	return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function applyMobileCaps(options: GraphicsOptions): GraphicsOptions {
	if (!detectMob()) {
		return options;
	}

	return {
		...options,
		maxResolution: {
			width: options.maxResolution.width,
			height: options.maxResolution.height
		},
		resolutionScale: options.resolutionScale,
		denoise: true,
		postProcessing: {
			...options.postProcessing,
			fxaa: true,
			bloom: false,
			fluidDistortion: false,
			// Kept on: the mobile timeline keyframes a continuous strength/scale
			// pulse (never 0), so the artist's animated CA must survive. The cost
			// is contained instead — the chromatic layer pass renders at half
			// resolution on mobile (see PostProcessingGraph.addChromaticAberration).
			chromaticAberration: true,
			vignette: options.postProcessing.vignette,
			cloudTransition: options.postProcessing.cloudTransition,
			// Transitions render both scene channels every frame — the heaviest
			// stretch of the timeline, and enough on weak mobile GPUs to drop or
			// corrupt frames. Freezing the non-dominant channel after its first
			// frame roughly halves that cost. Trade-off: it stops tracking camera
			// parallax, but the dissolve already hides that. Desktop has headroom,
			// so leave it off there.
			freezeTransitionScenes: true
		},
		bloomMultiplier: options.bloomMultiplier,
		bloomThresholdOffset: options.bloomThresholdOffset,
		chromeStrengthMultiplier: options.chromeStrengthMultiplier,
		chromeScaleMultiplier: options.chromeScaleMultiplier,
		chromeSplitMix: options.chromeSplitMix,
		chromeExclusionRadius: options.chromeExclusionRadius
	};
}

export function createDefaultGraphicsOptions(): GraphicsOptions {
	const isMobile = detectMob();
	const isSafari = detectSafari();

	return applyMobileCaps({
		maxResolution: { width: 2560, height: 1440 },
		// Scales the main drawing buffer after max-resolution clamping.
		// Safari gets a mild default reduction because its multi-pass particle path
		// is materially slower than Chromium on the same hardware.
        // resolutionScale: isMobile ? 0.85 : isSafari ? 0.85 : 1,
		resolutionScale: 1,
		denoise: true,
		shadowMapType: THREE.PCFSoftShadowMap,
		enableOctagonParticles: true,
		enableOctagonPhysics: true,
		postProcessing: {
			bloom: true,
			fxaa: true,
			fluidDistortion: true,
			chromaticAberration: true,
			vignette: true,
			cloudTransition: true,
			freezeTransitionScenes: false
		},
		// Mobile carries NO look attenuation: theatre/features/mobile.json is the
		// per-platform source of truth, and hidden multipliers made authored bloom/
		// CA/vignette edits look dead there. The desktop values only seed the
		// pre-Theatre window — the first applyConfig overwrites them.
		bloomMultiplier: isMobile ? 1 : 0.9,
		bloomThresholdOffset: 0,
		chromeStrengthMultiplier: 1,
		chromeScaleMultiplier: 1,
		chromeSplitMix: 0.22,
		chromeExclusionRadius: 0.2
	});
}

export function createGraphicsOptionsForTier(
	tier: GraphicsTier,
	base: GraphicsOptions = createDefaultGraphicsOptions()
): GraphicsOptions {
	const isMobile = detectMob();
	if (tier === 'high') return base;

	if (tier === 'medium') {
		const mediumShadowMapType = detectMob() ? THREE.PCFShadowMap : base.shadowMapType;

		return {
			...base,
			maxResolution: {
				width: Math.min(base.maxResolution.width, 1920),
				height: Math.min(base.maxResolution.height, 1080)
			},
			// resolutionScale: Math.min(base.resolutionScale, isMobile ? 0.75 : 0.85),
			resolutionScale: 1,
			denoise: false,
			shadowMapType: mediumShadowMapType,
			enableOctagonParticles: base.enableOctagonParticles,
			enableOctagonPhysics: base.enableOctagonPhysics,
			postProcessing: {
				...base.postProcessing,
				bloom: true,
				fxaa: true,
				// Inherit, don't force on — applyMobileCaps disables CA and mobile is
				// pinned to this tier, so an explicit `true` would undo the mobile cap.
				chromaticAberration: base.postProcessing.chromaticAberration
			},
			// Mobile is pinned to this tier — keep it attenuation-free (see
			// createDefaultGraphicsOptions); desktop demotion keeps its dimming.
			bloomMultiplier: isMobile ? 1 : 0.65,
			bloomThresholdOffset: 0,
			chromeStrengthMultiplier: isMobile ? 1 : 0.7,
			chromeScaleMultiplier: isMobile ? 1 : 0.85,
			chromeSplitMix: base.chromeSplitMix,
			chromeExclusionRadius: base.chromeExclusionRadius
		};
	}

	// low
	return {
		...base,
		maxResolution: {
			width: Math.min(base.maxResolution.width, 1280),
			height: Math.min(base.maxResolution.height, 720)
		},
		// resolutionScale: Math.min(base.resolutionScale, isMobile ? 0.65 : 0.7),
		resolutionScale: 1,
		denoise: true,
		shadowMapType: base.shadowMapType,
		enableOctagonParticles: base.enableOctagonParticles,
		// FluidMouseField + per-frame curl/spring compute is too heavy for low tier.
		enableOctagonPhysics: true,
		postProcessing: {
			...base.postProcessing,
			bloom: true,
			fxaa: false,
			fluidDistortion: false,
			chromaticAberration: base.postProcessing.chromaticAberration
		},
		bloomMultiplier: isMobile ? 1 : 0.42,
		bloomThresholdOffset: 0,
		chromeStrengthMultiplier: isMobile ? 1 : 0.5,
		chromeScaleMultiplier: isMobile ? 1 : 0.75,
		chromeSplitMix: base.chromeSplitMix,
		chromeExclusionRadius: base.chromeExclusionRadius
	};
}

// ── Benchmark ───────────────────────────────────────────────────────────────

export interface BenchmarkResult {
	tier: GraphicsTier;
	avgFrameMs: number;
	baselineFrameMs: number;
	p95FrameMs: number;
	slowFrameRatio: number;
	frameCount: number;
}

export interface BenchmarkOptions {
	width?: number;
	height?: number;
	maxDurationMs?: number;
	warmupFrames?: number;
	targetFrames?: number;
	cpuWorkMs?: number;
	extraMeshes?: number;
}

interface FramePacingSummary {
	avgFrameMs: number;
	baselineFrameMs: number;
	p95FrameMs: number;
	slowFrameRatio: number;
}

function percentile(values: number[], percentileValue: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = THREE.MathUtils.clamp(
		Math.round((sorted.length - 1) * percentileValue),
		0,
		sorted.length - 1
	);
	return sorted[index];
}

function summarizeFramePacing(frameTimes: number[]): FramePacingSummary {
	const avgFrameMs =
		frameTimes.reduce((total, frameMs) => total + frameMs, 0) / Math.max(1, frameTimes.length);
	const baselineFrameMs = percentile(frameTimes, 0.1);
	const p95FrameMs = percentile(frameTimes, 0.95);
	const slowFrameThreshold = Math.max(22, baselineFrameMs * 1.35);
	const slowFrameCount = frameTimes.filter((frameMs) => frameMs > slowFrameThreshold).length;

	return {
		avgFrameMs,
		baselineFrameMs,
		p95FrameMs,
		slowFrameRatio: slowFrameCount / Math.max(1, frameTimes.length)
	};
}

function tierFromFramePacing(summary: FramePacingSummary): GraphicsTier {
	// requestAnimationFrame is VSync-capped, so a stable 60 Hz desktop naturally
	// reports ~16.67 ms even with GPU headroom. Classify by dropped-frame pacing
	// first, then use absolute frame time only for clearly slow runs.
	if (summary.avgFrameMs > 30 || summary.p95FrameMs > 45 || summary.slowFrameRatio > 0.35) {
		return 'low';
	}

	const highFrameBudget = Math.max(18.5, summary.baselineFrameMs * 1.25);
	const mediumFrameBudget = Math.max(24.5, summary.baselineFrameMs * 1.7);
	if (
		summary.avgFrameMs > highFrameBudget ||
		summary.p95FrameMs > mediumFrameBudget ||
		summary.slowFrameRatio > 0.15
	) {
		return 'medium';
	}

	return 'high';
}

function burnCpu(ms: number): void {
	if (ms <= 0) return;
	const end = performance.now() + ms;
	let v = 0;
	while (performance.now() < end) {
		v = Math.sin(v + 0.1) * 0.5 + Math.cos(v + 0.2) * 0.5;
	}
}

export async function runGraphicsBenchmark(
	options: BenchmarkOptions = {}
): Promise<BenchmarkResult> {
	if (detectMob()) {
		return {
			tier: 'medium',
			avgFrameMs: 20,
			baselineFrameMs: 16.67,
			p95FrameMs: 20,
			slowFrameRatio: 0,
			frameCount: 0
		};
	}
	const width = options.width ?? 800;
	const height = options.height ?? 450;
	const maxDurationMs = options.maxDurationMs ?? 1200;
	const warmupFrames = options.warmupFrames ?? 12;
	const targetFrames = options.targetFrames ?? 50;
	const cpuWorkMs = options.cpuWorkMs ?? 1.5;
	const extraMeshes = options.extraMeshes ?? 6;

	const canvas = document.createElement('canvas');
	canvas.style.position = 'absolute';
	canvas.style.left = '-9999px';
	canvas.style.top = '-9999px';
	canvas.style.width = '1px';
	canvas.style.height = '1px';
	canvas.style.opacity = '0';
	document.body.appendChild(canvas);

	const renderer = new WebGPURenderer({
		canvas,
		antialias: false
	});

	try {
		await renderer.init();
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
		renderer.setSize(width, height);

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
		camera.position.z = 2.2;

		const geometry = new THREE.TorusKnotGeometry(0.5, 0.18, 240, 32);
		const material = new THREE.MeshStandardMaterial({
			color: 0x8a8a8a,
			metalness: 0.2,
			roughness: 0.6
		});
		const mesh = new THREE.Mesh(geometry, material);
		scene.add(mesh);
		for (let i = 0; i < extraMeshes; i += 1) {
			const clone = mesh.clone();
			clone.position.set((i % 3) - 1, Math.floor(i / 3) - 1, -i * 0.2);
			clone.rotation.set(i * 0.2, i * 0.15, i * 0.1);
			scene.add(clone);
		}

		const light = new THREE.DirectionalLight(0xffffff, 1.2);
		light.position.set(1, 1, 1);
		scene.add(light);
		scene.add(new THREE.AmbientLight(0xffffff, 0.25));

		let frames = 0;
		const frameTimes: number[] = [];
		let last = performance.now();
		const start = last;

		return await new Promise<BenchmarkResult>((resolve) => {
			const tick = () => {
				const now = performance.now();
				const dt = now - last;
				last = now;

				frames += 1;
				mesh.rotation.y += 0.02;
				mesh.rotation.x += 0.01;
				renderer.render(scene, camera);
				burnCpu(cpuWorkMs);

				if (frames > warmupFrames) frameTimes.push(dt);

				const elapsed = now - start;
				if (frameTimes.length >= targetFrames || elapsed >= maxDurationMs) {
					const summary = summarizeFramePacing(frameTimes);
					const tier = tierFromFramePacing(summary);
					geometry.dispose();
					material.dispose();
					renderer.dispose?.();
					canvas.remove();
					resolve({ tier, ...summary, frameCount: frameTimes.length });
					return;
				}

				requestAnimationFrame(tick);
			};

			requestAnimationFrame(tick);
		});
	} catch (err) {
		try {
			renderer.dispose?.();
			canvas.remove();
		} catch {
			// ignore cleanup errors
		}
		throw err;
	}
}
