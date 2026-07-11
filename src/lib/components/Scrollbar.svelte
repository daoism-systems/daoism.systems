<script lang="ts">
	import { onMount } from 'svelte';

	// Below this width the native/touch scroll feel takes over and the bottom-right
	// UI (audio visualiser) lives where the bar would; mirror ScrollIndicator's breakpoint.
	const MOBILE_BREAKPOINT_PX = 767;
	const IDLE_HIDE_MS = 1100;

	let {
		progress = 0,
		introVisible = true,
		onProgressDrag = (_progress: number) => {}
	}: {
		progress?: number;
		introVisible?: boolean;
		onProgressDrag?: (progress: number) => void;
	} = $props();

	let trackEl = $state<HTMLDivElement>();
	let thumbEl = $state<HTMLDivElement>();

	let shouldRender = $state(
		typeof window === 'undefined' ? true : window.innerWidth > MOBILE_BREAKPOINT_PX
	);

	let trackHeight = $state(0);
	let thumbHeight = $state(0);

	let isHovered = $state(false);
	let isDragging = $state(false);
	let isScrolling = $state(false);

	let visible = $derived(introVisible && (isScrolling || isHovered || isDragging));
	let clampedProgress = $derived(Math.max(0, Math.min(1, progress)));
	let thumbTravel = $derived(Math.max(0, trackHeight - thumbHeight));
	let thumbY = $derived(clampedProgress * thumbTravel);

	let idleTimer: number | null = null;
	let dragRaf: number | null = null;
	let pendingClientY = 0;

	function markScrolling() {
		isScrolling = true;
		if (idleTimer !== null) clearTimeout(idleTimer);
		idleTimer = window.setTimeout(() => {
			isScrolling = false;
			idleTimer = null;
		}, IDLE_HIDE_MS);
	}

	// Reveal the bar whenever scroll progress moves (wheel, drag, programmatic).
	$effect(() => {
		void progress; // reactive dependency
		markScrolling();
	});

	function updateMetrics() {
		if (trackEl) trackHeight = trackEl.offsetHeight;
		if (thumbEl) thumbHeight = thumbEl.offsetHeight;
	}

	function progressFromClientY(clientY: number): number {
		if (!trackEl) return clampedProgress;
		const rect = trackEl.getBoundingClientRect();
		const travel = Math.max(1, rect.height - thumbHeight);
		const y = clientY - rect.top - thumbHeight / 2;
		return Math.max(0, Math.min(1, y / travel));
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		isDragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		onProgressDrag(progressFromClientY(e.clientY));
		markScrolling();
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		pendingClientY = e.clientY;
		if (dragRaf !== null) return;
		dragRaf = requestAnimationFrame(() => {
			dragRaf = null;
			onProgressDrag(progressFromClientY(pendingClientY));
		});
	}

	function endDrag(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		if (dragRaf !== null) {
			cancelAnimationFrame(dragRaf);
			dragRaf = null;
		}
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		markScrolling();
	}

	// Recompute metrics + observe size whenever the bar is actually mounted.
	$effect(() => {
		if (!shouldRender || !trackEl) return;
		updateMetrics();

		const ro = new ResizeObserver(updateMetrics);
		ro.observe(trackEl);
		window.addEventListener('resize', updateMetrics);

		return () => {
			ro.disconnect();
			window.removeEventListener('resize', updateMetrics);
		};
	});

	onMount(() => {
		const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
		const sync = () => {
			shouldRender = !mq.matches;
			if (!shouldRender) {
				isHovered = false;
				isDragging = false;
			}
		};
		sync();
		mq.addEventListener('change', sync);

		return () => {
			mq.removeEventListener('change', sync);
			if (idleTimer !== null) clearTimeout(idleTimer);
			if (dragRaf !== null) cancelAnimationFrame(dragRaf);
		};
	});
</script>

{#if shouldRender}
	<div
		class="scrollbar"
		class:scrollbar--visible={visible}
		class:scrollbar--dragging={isDragging}
		bind:this={trackEl}
		onpointerenter={() => (isHovered = true)}
		onpointerleave={() => (isHovered = false)}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={endDrag}
		onpointercancel={endDrag}
		role="scrollbar"
		aria-orientation="vertical"
		aria-label="Page scroll progress"
		aria-valuenow={Math.round(clampedProgress * 100)}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-controls="page-scroll-wrapper"
		tabindex={-1}
	>
		<div class="scrollbar__track" aria-hidden="true"></div>
		<div
			class="scrollbar__thumb"
			bind:this={thumbEl}
			style="transform: translateY({thumbY}px) translateZ(0);"
			aria-hidden="true"
		></div>
	</div>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	$bar-inset: $offset-x;
	$hit-width: 0.875rem;
	$track-width: 2px;
	$thumb-width: 4px;

	.scrollbar {
		position: fixed;
		top: $bar-inset;
		bottom: $bar-inset;
		right: 0;
		width: $hit-width;
		z-index: 104;
		cursor: grab;
		touch-action: none;
		// Stays hoverable even while invisible so it reappears on edge hover.
		opacity: 0;
		transition: opacity 320ms cubic-bezier(0.22, 1, 0.36, 1);

		&--visible {
			opacity: 1;
		}

		&--dragging {
			cursor: grabbing;
		}
	}

	.scrollbar__track {
		position: absolute;
		top: 0;
		bottom: 0;
		right: calc(($hit-width - $track-width) / 2);
		width: $track-width;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
	}

	.scrollbar__thumb {
		position: absolute;
		top: 0;
		right: calc(($hit-width - $thumb-width) / 2);
		width: $thumb-width;
		height: 3.5rem;
		border-radius: 999px;
		background: linear-gradient(180deg, rgba($color-red, 0.65) 0%, $color-red 100%);
		box-shadow: 0 0 12px rgba($color-red, 0.45);
		will-change: transform;
		transition:
			width 200ms cubic-bezier(0.22, 1, 0.36, 1),
			box-shadow 200ms ease,
			right 200ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.scrollbar:hover .scrollbar__thumb,
	.scrollbar--dragging .scrollbar__thumb {
		width: 6px;
		right: calc(($hit-width - 6px) / 2);
		box-shadow: 0 0 18px rgba($color-red, 0.6);
	}
</style>
