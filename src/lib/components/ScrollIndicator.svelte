<script lang="ts">
	import { onMount } from 'svelte';
	import { spring } from 'svelte/motion';
	import { sfx, SFX_KEY } from '$lib/utils/sfx';

	// --- Types & Constants ---
	type SectionTimeline = { timelineStart: number; timelineEnd: number };

	const CURSOR_HOVER_ANIM_EVENT = 'cursor:hover-anim';
	const CURSOR_TEXT_EVENT = 'cursor:set-text';
	const CURSOR_VISIBILITY_EVENT = 'cursor:set-hidden';
	const MOBILE_BREAKPOINT_PX = 767;
	const DRAG_THRESHOLD_PX = 6;

	// --- Props ---
	let {
		sections = 8,
		smallPerGap = 3,
		active = 0,
		progress = 0,
		sectionTimelines = [] as SectionTimeline[],
		sectionRevealProgresses = [] as number[],
		sectionLabels = [] as string[],
		introVisible = true,
		onSectionClick = () => {},
		onProgressDrag = () => {}
	} = $props();

	// --- DOM References ---
	let container = $state<HTMLDivElement>();
	let arrows = $state<HTMLDivElement>();
	let bigTickEls = $state<HTMLElement[]>([]);

	// --- Layout State ---
	let shouldRender = $state(
		typeof window === 'undefined' ? true : window.innerWidth > MOBILE_BREAKPOINT_PX
	);
	let layout = $state({ containerWidth: 0, arrowsWidth: 0, arrowsMarginLeft: 0, containerLeft: 0 });
	let tickCenters = $state<number[]>([]);
	let bigTickCenters = $state<number[]>([]);

	// --- Interaction State ---
	let isDragging = $state(false);
	let dragStartX = $state(0);
	let didDrag = $state(false);
	let pointerLocalX = $state<number | null>(null);
	let isPointerInside = $state(false);
	let pointerDownSection = $state<number | null>(null);

	let hoveredSection = $state<number | null>(null);
	let focusedSection = $state<number | null>(null);
	let lastHoverPulseSection = $state<number | null>(null);
	let lastCrossedBigTick = $state(-1);
	let lastEmphasizedSection = $state(0);

	const waveFocusSpring = spring(0, { stiffness: 0.18, damping: 0.86, precision: 0.01 });
	const headXSpring = spring(0, { stiffness: 0.2, damping: 0.88, precision: 0.01 });
	let hasHeadXSpringValue = false;

	// --- Derived State ---
	let emphasizedSection = $derived(
		hoveredSection ?? focusedSection ?? (isPointerInside ? active : null)
	);
	let renderedSection = $derived(emphasizedSection ?? lastEmphasizedSection);
	let emphasisLabel = $derived(sectionLabels[renderedSection] ?? `Section ${renderedSection + 1}`);
	let tickMagnifyOrigin = $derived(
		isPointerInside || emphasizedSection !== null ? $waveFocusSpring : null
	);

	let emphasisPosition = $derived.by(() => {
		if ((isPointerInside || emphasizedSection !== null) && bigTickCenters.length > 0) {
			const first = bigTickCenters[0] ?? 0;
			const last = bigTickCenters[bigTickCenters.length - 1] ?? first;
			return Math.max(first, Math.min($waveFocusSpring, last));
		}
		return bigTickCenters[renderedSection] ?? 0;
	});

	let ticks = $derived.by(() => {
		const arr = [];
		for (let i = 0; i < sections; i++) {
			arr.push({ type: 'big' as const, section: i });
			if (i < sections - 1) {
				for (let j = 0; j < smallPerGap; j++) arr.push({ type: 'small' as const });
			}
		}
		return arr;
	});

	// The marker tracks section REVEAL, not raw scroll position: it slides from the
	// previous tick onto a section's tick over that section's reveal window and
	// ARRIVES exactly when the reveal completes (`sectionRevealProgresses[i]` = the
	// within-section progress where section i is fully revealed). It then holds on
	// that tick — the section is "selected" — until the next section begins
	// revealing. Because arrival is pinned to reveal completion rather than the
	// section's scroll midpoint, wide sections (Ventures, Careers) no longer leave
	// the marker stranded between ticks.
	let markerTrack = $derived.by<MarkerTrack>(() =>
		buildMarkerTrack(sectionTimelines, bigTickCenters, sectionRevealProgresses)
	);

	let headX = $derived(sampleTrack(markerTrack, progress));
	let displayedHeadX = $derived(isDragging ? headX : $headXSpring);

	// --- Helper Functions (Math & Logic) ---
	type MarkerTrack = { progresses: number[]; pixels: number[] };

	function buildMarkerTrack(
		timelines: SectionTimeline[],
		centers: number[],
		revealProgresses: number[]
	): MarkerTrack {
		const count = Math.min(timelines.length, centers.length);
		const progresses: number[] = [];
		const pixels: number[] = [];
		if (count === 0) return { progresses, pixels };

		// Start parked on the first section's tick (revealed by the intro).
		progresses.push(timelines[0].timelineStart);
		pixels.push(centers[0]);

		for (let i = 1; i < count; i++) {
			const { timelineStart, timelineEnd } = timelines[i];
			const reveal = Math.max(0, Math.min(revealProgresses[i] ?? 0, 1));
			const revealDone = timelineStart + (timelineEnd - timelineStart) * reveal;

			// Hold the previous tick until this section starts, then slide to this
			// section's tick over its reveal window, arriving when the reveal completes.
			progresses.push(timelineStart);
			pixels.push(centers[i - 1]);
			progresses.push(revealDone);
			pixels.push(centers[i]);
		}

		// Hold the final section's tick through its tail.
		progresses.push(timelines[count - 1].timelineEnd);
		pixels.push(centers[count - 1]);
		return { progresses, pixels };
	}

	// Piecewise-linear lookup along the monotonic track (progress → pixel).
	function sampleTrack({ progresses, pixels }: MarkerTrack, prog: number): number {
		if (!progresses.length) return 0;
		const last = progresses.length - 1;
		if (prog <= progresses[0]) return pixels[0];
		if (prog >= progresses[last]) return pixels[last];

		let lo = 0;
		for (let i = last; i >= 0; i--) {
			if (prog >= progresses[i]) {
				lo = i;
				break;
			}
		}
		const hi = Math.min(lo + 1, last);
		const span = Math.max(1e-6, progresses[hi] - progresses[lo]);
		const t = (prog - progresses[lo]) / span;
		return pixels[lo] + (pixels[hi] - pixels[lo]) * t;
	}

	// Inverse lookup (pixel → progress) for drag scrubbing. Track pixels are
	// non-decreasing with flats where the marker holds on a tick; resolve to the
	// FIRST segment that reaches localX (the reveal slide), so dragging onto a tick
	// lands in that tick's section — at its reveal-complete point — not at the far
	// end of the hold (which is already the next section).
	function barPositionToProgress(clientX: number): number {
		const { progresses, pixels } = markerTrack;
		if (progresses.length < 2) return 0;

		const localX = clientX - layout.containerLeft;
		const last = pixels.length - 1;
		if (localX <= pixels[0]) return progresses[0];
		if (localX >= pixels[last]) return progresses[last];

		let hi = last;
		for (let i = 1; i <= last; i++) {
			if (pixels[i] >= localX) {
				hi = i;
				break;
			}
		}
		const lo = hi - 1;
		const span = Math.max(1e-6, pixels[hi] - pixels[lo]);
		const t = (localX - pixels[lo]) / span;
		return progresses[lo] + (progresses[hi] - progresses[lo]) * t;
	}

	// The big tick the head is currently closest to — drives the drag pulse + sfx.
	function nearestBigTick(prog: number): number {
		if (!bigTickCenters.length) return 0;
		const x = sampleTrack(markerTrack, prog);
		return bigTickCenters.reduce(
			(nearest, center, i) =>
				Math.abs(x - center) < Math.abs(x - bigTickCenters[nearest]) ? i : nearest,
			0
		);
	}

	function nearestBigTickFromClientX(clientX: number): number {
		if (!bigTickCenters.length) return 0;
		const localX = clientX - layout.containerLeft;
		return bigTickCenters.reduce((nearest, center, i) => {
			return Math.abs(localX - center) < Math.abs(localX - bigTickCenters[nearest]) ? i : nearest;
		}, 0);
	}

	// --- UI/Animation Helpers ---
	function triggerHoverPulse(sectionIndex: number) {
		const el = bigTickEls[sectionIndex];
		if (!el) return;
		const rect = el.getBoundingClientRect();
		window.dispatchEvent(
			new CustomEvent(CURSOR_HOVER_ANIM_EVENT, {
				detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
			})
		);
	}

	function pulseTick(index: number) {
		const el = bigTickEls[index];
		if (!el) return;
		el.classList.remove('pulse');
		void el.offsetWidth; // Trigger reflow
		el.classList.add('pulse');
	}

	function setCursor(text: string | null = null, hidden: boolean = false) {
		window.dispatchEvent(new CustomEvent(CURSOR_TEXT_EVENT, { detail: { text } }));
		window.dispatchEvent(new CustomEvent(CURSOR_VISIBILITY_EVENT, { detail: { hidden } }));
	}

	function setHoveredSection(nextSection: number | null, pulse = false) {
		if (hoveredSection === nextSection) return;
		hoveredSection = nextSection;
		if (nextSection === null) {
			lastHoverPulseSection = null;
			return;
		}
		if (pulse && lastHoverPulseSection !== nextSection) {
			triggerHoverPulse(nextSection);
			lastHoverPulseSection = nextSection;
		}
	}

	// --- Layout Updaters ---
	function updateWidths() {
		if (!container) return;
		const rect = container.getBoundingClientRect();
		layout = {
			containerWidth: container.offsetWidth,
			containerLeft: rect.left,
			arrowsWidth: arrows?.offsetWidth ?? 0,
			arrowsMarginLeft: arrows ? Number.parseFloat(getComputedStyle(arrows).marginLeft) || 0 : 0
		};

		const allTicks = Array.from(container.querySelectorAll<HTMLElement>('.tick'));
		tickCenters = allTicks.map(
			(t) => t.getBoundingClientRect().left - rect.left + t.offsetWidth / 2
		);

		// bigTickEls are bound directly, no need for querySelectorAll
		bigTickCenters = bigTickEls
			.filter(Boolean)
			.map((t) => t.getBoundingClientRect().left - rect.left + t.offsetWidth / 2);
	}

	function getTickStyle(index: number, type: 'big' | 'small') {
		const center = tickCenters[index] ?? 0;
		let style = `--center-x: ${center}px; `;

		if (tickMagnifyOrigin === null)
			return style + '--tick-scale: 1; --tick-opacity: 0.6; --tick-glow: 0;';

		const distance = Math.abs(center - tickMagnifyOrigin);
		const waveRadius = type === 'big' ? 70 : 60;
		const x = distance / waveRadius;
		const influence = (1 - x * x) * Math.exp(-0.5 * x * x);

		const scale = Math.max(0.4, 1 + influence * (type === 'big' ? 0.85 : 0.65));
		const opacity = Math.min(1, 0.25 + Math.max(0, influence) * 0.75);
		const glow = Math.max(0, influence) * (type === 'big' ? 0.5 : 0.2);

		return style + `--tick-scale: ${scale}; --tick-opacity: ${opacity}; --tick-glow: ${glow};`;
	}

	// --- Pointer Events ---
	let pointerIsDown = false;
	let pointerMoveRaf: number | null = null;
	let pendingPointerClientX = 0;

	function clampPointerLocalX(localX: number): number {
		return Math.max(0, Math.min(localX, layout.containerWidth));
	}

	function clientXToLocalX(clientX: number): number {
		return clampPointerLocalX(clientX - layout.containerLeft);
	}

	function commitPointerClientX(clientX: number, instant = false) {
		const nextLocalX = clientXToLocalX(clientX);
		pointerLocalX = nextLocalX;
		if (instant) waveFocusSpring.set(nextLocalX, { hard: true });
	}

	function schedulePointerClientX(clientX: number) {
		pendingPointerClientX = clientX;
		if (pointerMoveRaf !== null) return;

		pointerMoveRaf = requestAnimationFrame(() => {
			pointerMoveRaf = null;
			commitPointerClientX(pendingPointerClientX);
		});
	}

	function clearPointerMoveRaf() {
		if (pointerMoveRaf === null) return;
		cancelAnimationFrame(pointerMoveRaf);
		pointerMoveRaf = null;
	}

	function getSectionFromEventTarget(target: EventTarget | null): number | null {
		if (!(target instanceof HTMLElement)) return null;
		const tick = target.closest<HTMLElement>('[data-section-index]');
		if (!tick) return null;

		const section = Number.parseInt(tick.dataset.sectionIndex ?? '', 10);
		return Number.isInteger(section) ? section : null;
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		pointerIsDown = true;
		pointerDownSection = getSectionFromEventTarget(e.target);
		didDrag = false;
		dragStartX = e.clientX;
		lastCrossedBigTick = nearestBigTick(progress);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		schedulePointerClientX(e.clientX);

		if (isPointerInside && !pointerIsDown) {
			setHoveredSection(nearestBigTickFromClientX(e.clientX), true);
		}

		if (!pointerIsDown) return;
		if (!didDrag && Math.abs(e.clientX - dragStartX) > DRAG_THRESHOLD_PX) {
			didDrag = true;
			isDragging = true;
		}
		if (!isDragging) return;

		const prog = barPositionToProgress(e.clientX);
		onProgressDrag(prog);

		const currentTick = nearestBigTick(prog);
		hoveredSection = currentTick; // keep tooltip label in sync while dragging
		if (currentTick !== lastCrossedBigTick) {
			pulseTick(currentTick);
			sfx.play(SFX_KEY.hover);
			lastCrossedBigTick = currentTick;
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (!pointerIsDown) return;
		const wasDrag = didDrag;
		const clickSection = pointerDownSection ?? nearestBigTick(barPositionToProgress(e.clientX));
		pointerIsDown = isDragging = false;
		pointerDownSection = null;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

		if (!wasDrag) onSectionClick(clickSection);
	}

	function onPointerCancel(e: PointerEvent) {
		pointerIsDown = isDragging = false;
		pointerDownSection = null;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
	}

	function onPointerEnter(e: PointerEvent) {
		isPointerInside = true;
		commitPointerClientX(e.clientX, true);
		setCursor(null, true);
		setHoveredSection(nearestBigTickFromClientX(e.clientX), true);
	}

	function onPointerLeave() {
		clearPointerMoveRaf();
		isPointerInside = false;
		pointerLocalX = null;
		pointerDownSection = null;
		setCursor(null, false);
		setHoveredSection(null);
	}

	function onTickClick(e: MouseEvent, section: number) {
		e.preventDefault();
		e.stopPropagation();
		if (e.detail === 0) onSectionClick(section);
	}

	// --- Effects & Lifecycle ---
	$effect(() => {
		if (isPointerInside && pointerLocalX !== null) waveFocusSpring.set(pointerLocalX);
		else if (emphasizedSection !== null && bigTickCenters.length)
			waveFocusSpring.set(bigTickCenters[emphasizedSection] ?? 0);
	});

	$effect(() => {
		const instant = !hasHeadXSpringValue || isDragging || layout.containerWidth === 0;
		if (instant) headXSpring.set(headX, { hard: true });
		else headXSpring.set(headX);
		hasHeadXSpringValue = true;
	});

	$effect(() => {
		if (emphasizedSection !== null) lastEmphasizedSection = emphasizedSection;
	});

	$effect(() => {
		if (!shouldRender || !container) return;

		// Ticks dependencies trigger a resize calculation
		ticks;
		updateWidths();

		const ro = new ResizeObserver(updateWidths);
		ro.observe(container);
		if (arrows) ro.observe(arrows);

		// The indicator is centered with a fixed width, so its box size never changes
		// on a window resize — but its viewport position (containerLeft) does. The
		// ResizeObserver won't catch that, so recompute on window resize too.
		window.addEventListener('resize', updateWidths);

		return () => {
			ro.disconnect();
			window.removeEventListener('resize', updateWidths);
		};
	});

	onMount(() => {
		const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
		const sync = () => {
			shouldRender = !mq.matches;
			if (!shouldRender) {
				isPointerInside = false;
				pointerLocalX = null;
				hoveredSection = focusedSection = null;
				setCursor(null, false);
			}
		};

		sync();
		mq.addEventListener('change', sync);
		return () => {
			mq.removeEventListener('change', sync);
			clearPointerMoveRaf();
			setCursor(null, false);
		};
	});
</script>

{#if shouldRender}
	<div
		class="scroll-indicator"
		class:scroll-indicator--visible={introVisible}
		class:hovered={emphasizedSection !== null}
	>
		<div
			class="scroll-indicator__wrap"
			class:dragging={isDragging}
			class:interacting={isPointerInside}
			class:hovered={emphasizedSection !== null}
			onpointerenter={onPointerEnter}
			onpointerleave={onPointerLeave}
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerCancel}
			role="slider"
			aria-valuenow={Math.round(progress * 100)}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-label="Page scroll progress"
			tabindex={0}
		>
			<div class="page-indicators" bind:this={container} style="--head-x: {displayedHeadX};">
				{#if bigTickCenters.length > 0}
					<div
						class="section-emphasis"
						class:section-emphasis--visible={emphasizedSection !== null}
						style="transform: translateX({emphasisPosition}px) translateX(-50%);"
						aria-hidden="true"
					>
						<div class="section-emphasis__beam"></div>
						<div class="section-emphasis__label">{emphasisLabel}</div>
					</div>
				{/if}

				{#each ticks as tick, index}
					{#if tick.type === 'big'}
						<button
							bind:this={bigTickEls[tick.section ?? 0]}
							class="tick big"
							class:active={tick.section === active}
							class:hovered={tick.section === emphasizedSection}
							data-section-index={tick.section}
							aria-label={sectionLabels[tick.section ?? 0] ?? `Go to section ${tick.section}`}
							style={getTickStyle(index, 'big')}
							onclick={(e) => onTickClick(e, tick.section ?? 0)}
							onfocus={(e) => {
								if ((e.currentTarget as HTMLElement).matches(':focus-visible')) {
									focusedSection = tick.section ?? 0;
									setCursor(null, true);
								}
							}}
							onblur={() => {
								focusedSection = null;
								if (!isPointerInside) setCursor(null, false);
							}}
						>
							<span></span>
						</button>
					{:else}
						<div class="tick small" style={getTickStyle(index, 'small')}>
							<span></span>
						</div>
					{/if}
				{/each}
			</div>

			<div
				class="progress-arrows"
				bind:this={arrows}
				style="transform: translateX({displayedHeadX -
					(layout.arrowsWidth / 2 + layout.arrowsMarginLeft)}px) translateZ(0);"
			>
				<img src="/icons/star.svg" alt="" aria-hidden="true" />
				<img src="/icons/star.svg" alt="" aria-hidden="true" />
			</div>
		</div>
	</div>
{/if}

<style lang="scss">
	@use 'sass:color';
	@use '$lib/styles/variables' as *;

	$transition: 0.33s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	$gap: 0.6rem;

	.scroll-indicator {
		position: fixed;
		top: $offset-x;
		left: 50%;
		transform: translateX(-50%) translateY(12px) translateZ(0);
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 700ms cubic-bezier(0.22, 1, 0.36, 1),
			transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
		border-radius: 0.25rem;
		background:
			linear-gradient(180deg, rgba(46, 48, 54, 0.94), rgba(27, 29, 34, 0.98)),
			rgba(43, 44, 48, 0.95);
		height: 2rem;
		width: 23.5rem;
		z-index: 99;
		padding: 0 1.4rem;
		contain: layout style;
		box-shadow:
			0 0.8rem 2rem rgba(0, 0, 0, 0.24),
			inset 0 1px 0 rgba(white, 0.05);

		&--visible {
			opacity: 1;
			pointer-events: all;
			transform: translateX(-50%) translateY(0) translateZ(0);
			transition-delay: 0.12s, 0s;
		}

		&.hovered {
			background:
				linear-gradient(180deg, rgba(55, 57, 63, 0.98), rgba(31, 33, 39, 0.98)),
				rgba(43, 44, 48, 0.98);
			box-shadow:
				0 1rem 2.4rem rgba(0, 0, 0, 0.35),
				0 0 0 1px rgba(255, 255, 255, 0.04),
				inset 0 1px 0 rgba(255, 255, 255, 0.08);
		}

		&__wrap {
			position: relative;
			height: 100%;
			cursor: pointer;
			touch-action: none;

			&.dragging {
				cursor: grabbing;
			}
		}
	}

	.page-indicators {
		position: relative;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.section-emphasis {
		position: absolute;
		top: 50%;
		left: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.45rem;
		pointer-events: none;
		z-index: 0;
		transform: translateX(-50%);
		opacity: 0;
		transition: opacity 180ms ease;
		will-change: transform, opacity;

		&__beam {
			width: 2.9rem;
			height: 1.8rem;
			border-radius: 999px;
			background:
				radial-gradient(
					circle at center,
					rgba($color-red, 0.32) 0%,
					rgba($color-red, 0.18) 42%,
					transparent 76%
				),
				linear-gradient(180deg, rgba(white, 0.09), rgba(white, 0));
			filter: blur(1px);
			transform: translateY(-50%);
			box-shadow:
				0 0 30px rgba($color-red, 0.18),
				inset 0 1px 0 rgba(white, 0.12);
			animation: section-beam-breathe 2.4s ease-in-out infinite;
		}

		&__label {
			transform: translateY(-0.2rem) scale(0.92);
			padding: 0.24rem 0.58rem 0.28rem;
			border-radius: 999px;
			background: #e64749;
			border: 1px solid rgba(230, 71, 73, 0.4);
			box-shadow: 0 0.6rem 1.4rem rgba(230, 71, 73, 0.24);
			color: #efeeec;
			font-size: 0.62rem;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			white-space: nowrap;
			opacity: 0;
			transition:
				transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
				opacity 220ms ease,
				background-color 240ms ease,
				color 240ms ease,
				border-color 240ms ease;
		}
	}

	.section-emphasis--visible {
		opacity: 1;
		.section-emphasis__label {
			opacity: 0.96;
			transform: translateY(-0.2rem) scale(1);
		}
	}

	.tick {
		position: relative;
		z-index: 1;
		--tick-scale: 1;
		--tick-opacity: 1;
		--tick-glow: 0;

		span {
			display: block;
			background: rgba(255, 255, 255, 0.65);
			opacity: var(--tick-opacity);
			transform-origin: center center;
			filter: saturate(calc(1 + var(--tick-glow) * 0.55));
			box-shadow: 0 0 calc(16px * var(--tick-glow))
				rgba(255, 255, 255, calc(var(--tick-glow) * 0.28));
			will-change: transform, opacity, filter;

			transition:
				transform 0.6s cubic-bezier(0.22, 1, 0.36, 1),
				background-color 0.3s ease,
				opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1),
				box-shadow 0.3s ease,
				filter 0.6s cubic-bezier(0.22, 1, 0.36, 1);
		}

		&.big {
			cursor: pointer;
			position: relative;
			padding: 0 $gap;
			span {
				width: 2px;
				height: 0.9rem;
				border-radius: 999px;
				transform: translateZ(0) scale(var(--tick-scale));
			}
			&:first-of-type {
				padding-left: 0;
			}
			&:last-of-type {
				padding-right: 0;
			}
		}

		&.small {
			pointer-events: none;
			margin-left: $gap;
			.big + & {
				margin-left: 0;
			}
			span {
				width: 2px;
				height: 0.6rem;
				border-radius: 999px;
				transform: translateZ(0) scale(var(--tick-scale));
			}
		}

		&.active span {
			background: $color-red;
			opacity: 1;
			box-shadow: 0 0 14px rgba($color-red, 0.28);
		}

		&.hovered span {
			background: rgba(255, 255, 255, 0.98);
			opacity: 1;
			box-shadow:
				0 0 18px rgba(255, 255, 255, 0.34),
				0 0 calc(20px * var(--tick-glow)) rgba(255, 255, 255, calc(var(--tick-glow) * 0.34));
		}

		&:global(.pulse) span {
			animation: tick-pulse 0.35s ease-out;
		}
	}

	.scroll-indicator__wrap.interacting .tick span {
		transition:
			transform 0s linear,
			background-color 0.3s ease,
			opacity 0s linear,
			box-shadow 0.3s ease,
			filter 0s linear;
	}

	@keyframes tick-pulse {
		0% {
			transform: scale(1.4);
			background: $color-red;
		}
		100% {
			transform: scale(1);
		}
	}

	.progress-arrows {
		position: absolute;
		height: 100%;
		top: 0;
		pointer-events: none;
		left: 0;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		margin: 0 -0.36rem;
		-webkit-transform: translateZ(0);
		transform: translateZ(0);
		cursor: grab;
		transition:
			filter 0.28s ease,
			opacity 0.28s ease;
		opacity: 0.8;
		will-change: transform;

		.scroll-indicator__wrap.hovered & {
			filter: drop-shadow(0 0 12px rgba($color-red, 0.42));
			opacity: 1;
		}
		.scroll-indicator__wrap.dragging & {
			filter: drop-shadow(0 0 6px rgba($color-red, 0.5));
			cursor: grabbing;
		}
		img {
			width: 0.8rem;
			height: auto;
		}
		img:last-of-type {
			transform: scale(-1, -1);
		}
	}

	@keyframes section-beam-breathe {
		0%,
		100% {
			transform: translateY(-50%) scale(0.94);
			opacity: 0.72;
		}
		50% {
			transform: translateY(-50%) scale(1.06);
			opacity: 1;
		}
	}
</style>
