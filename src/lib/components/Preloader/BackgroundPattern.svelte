<script lang="ts">
	import { onMount } from 'svelte';
	import { loadingProgress, displayedLoadingProgress } from '$lib/store.svelte';
	import { getCappedDevicePixelRatio } from '$lib/utils/devicePixelRatio';
	import { createBackgroundPatternEngine } from './backgroundPattern/engine';
	import type { WorkerOutbound } from './backgroundPattern/worker';

	let { onTransitionComplete }: { onTransitionComplete?: () => void } = $props();

	let containerEl: HTMLDivElement | null = null;
	let canvasEl: HTMLCanvasElement | null = null;

	type Controller = {
		resize: (width: number, height: number) => void;
		pointer: (x: number, y: number) => void;
		visible: (visible: boolean) => void;
		progress: (value: number) => void;
		dispose: () => void;
	};

	onMount(() => {
		if (!containerEl || !canvasEl) return;
		const container = containerEl;
		const canvas = canvasEl;

		const dpr = getCappedDevicePixelRatio();
		const reducedMotion =
			window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
		const onComplete = () => onTransitionComplete?.();

		const measure = () => ({
			width: Math.max(1, Math.round(container.clientWidth || container.offsetWidth)),
			height: Math.max(1, Math.round(container.clientHeight || container.offsetHeight))
		});

		let rect = container.getBoundingClientRect();
		const { width, height } = measure();

		// Render off the main thread when possible so the main-scene warmup can't starve the
		// animation; otherwise run the identical engine on the main thread.
		let worker: Worker | null = null;
		if (typeof canvas.transferControlToOffscreen === 'function' && typeof Worker !== 'undefined') {
			try {
				worker = new Worker(new URL('./backgroundPattern/worker.ts', import.meta.url), {
					type: 'module'
				});
				worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
					if (event.data?.type === 'transitionComplete') onComplete();
					// The worker eases progress on the render thread; mirror its readout into the
					// store so the DOM number follows the bar's exact curve. Queued during a main-thread
					// block, this applies the latest value once the thread frees — landing on the bar's
					// current position with no independent catch-up.
					else if (event.data?.type === 'displayProgress')
						displayedLoadingProgress.set(event.data.value);
				};
				const offscreen = canvas.transferControlToOffscreen();
				worker.postMessage({ type: 'init', canvas: offscreen, dpr, width, height, reducedMotion }, [
					offscreen
				]);
			} catch {
				worker = null;
			}
		}

		let controller: Controller;
		if (worker) {
			const post = (message: Record<string, unknown>) => worker!.postMessage(message);
			controller = {
				resize: (w, h) => post({ type: 'resize', width: w, height: h }),
				pointer: (x, y) => post({ type: 'pointer', x, y }),
				visible: (visible) => post({ type: 'visible', visible }),
				progress: (value) => post({ type: 'progress', value }),
				dispose: () => {
					post({ type: 'dispose' });
					worker!.terminate();
				}
			};
		} else {
			const engine = createBackgroundPatternEngine({
				canvas,
				dpr,
				reducedMotion,
				onTransitionComplete: onComplete,
				onDisplayProgress: (value) => displayedLoadingProgress.set(value)
			});
			engine.resize(width, height);
			engine.start();
			controller = {
				resize: engine.resize,
				pointer: engine.setPointer,
				visible: engine.setVisible,
				progress: engine.setProgress,
				dispose: engine.stop
			};
		}

		const handleResize = () => {
			rect = container.getBoundingClientRect();
			const size = measure();
			controller.resize(size.width, size.height);
		};

		const resizeObserver = new ResizeObserver(handleResize);
		resizeObserver.observe(container);
		window.addEventListener('resize', handleResize, { passive: true });

		const intersectionObserver = new IntersectionObserver(
			(entries) => controller.visible(entries[0]?.isIntersecting ?? true),
			{ threshold: 0.1 }
		);
		intersectionObserver.observe(container);

		const handlePointerMove = (event: PointerEvent) => {
			controller.pointer(event.clientX - rect.left, event.clientY - rect.top);
		};
		if (!reducedMotion) {
			window.addEventListener('pointermove', handlePointerMove, { passive: true });
		}

		// Feed the raw (un-eased) target: the worker eases it on the render thread, so the
		// bar keeps advancing even when the main thread is blocked compiling shaders and the
		// main-thread easing store (displayedLoadingProgress) would otherwise stall.
		const unsubscribe = loadingProgress.subscribe((value) =>
			controller.progress(Math.min(100, Math.max(0, value)))
		);

		return () => {
			unsubscribe();
			controller.dispose();
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('pointermove', handlePointerMove);
			resizeObserver.disconnect();
			intersectionObserver.disconnect();
		};
	});
</script>

<div class="preloader-background-pattern" aria-hidden="true" bind:this={containerEl}>
	<canvas class="preloader-background-pattern__canvas" bind:this={canvasEl}></canvas>
</div>

<style>
	.preloader-background-pattern {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
		background-color: #000;
	}

	.preloader-background-pattern__canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
