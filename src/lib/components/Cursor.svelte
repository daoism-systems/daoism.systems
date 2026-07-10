<script lang="ts">
	import { onMount } from 'svelte';

	type CursorHoverAnimDetail = { x: number; y: number };
	const CURSOR_HOVER_ANIM_EVENT = 'cursor:hover-anim';
	type CursorTextDetail = { text: string | null | undefined };
	const CURSOR_TEXT_EVENT = 'cursor:set-text';
	type CursorLinkDetail = { href: string | null | undefined };
	const CURSOR_LINK_EVENT = 'cursor:set-link';
	type CursorVisibilityDetail = { hidden: boolean | null | undefined };
	const CURSOR_VISIBILITY_EVENT = 'cursor:set-hidden';
	type CursorMode = 'grab' | 'grabbing' | null;
	type CursorModeDetail = { mode: CursorMode | undefined };
	const CURSOR_MODE_EVENT = 'cursor:set-mode';

	const FORM_FIELD_SELECTOR = 'input, textarea, select';

	let isDeviceHasCursor = $state(false);
	let isHoveringInteractive = $state(false);
	let isHiddenByComponent = $state(false);
	let isOverFormField = $state(false);
	// Hotspot buttons have their own icon animation; the enlarged
	// difference-blend cursor disc would invert it, so collapse the custom
	// cursor there (the system pointer takes over via the cursor style).
	let isOverHotspot = $state(false);
	let cursorX = $state(0);
	let cursorY = $state(0);
	let hoverCursorText: string | null = $state(null);
	let hoverCursorAnchor: HTMLElement | null = $state(null);
	let hoverCursorLabelX = $state(0);
	let hoverCursorLabelY = $state(0);
	let hoverCursorLabelSide = $state<'left' | 'right'>('right');
	let cursorText: string | null = $state(null);
	let cursorHref: string | null = $state(null);
	let cursorMode: CursorMode = $state(null);
	let clickRipples = $state<Array<{ id: number; x: number; y: number }>>([]);
	let hoverAnimPulses = $state<Array<{ id: number; x: number; y: number }>>([]);
	let rippleId = 0;
	let targetCursorX = 0;
	let targetCursorY = 0;
	let renderedCursorX = 0;
	let renderedCursorY = 0;
	let hasPointerPosition = false;
	let cursorAnimationFrame: number | null = null;
	let lastAnimationTimestamp = 0;
	let activeCursorText = $derived(cursorText);
	let isPointerState = $derived(isHoveringInteractive || !!hoverCursorText || !!activeCursorText);
	let isCursorHidden = $derived(
		isHiddenByComponent || !!hoverCursorText || isOverFormField || isOverHotspot
	);

	$effect(() => {
		if (!isDeviceHasCursor) return;

		let cursorValue = '';
		if (cursorMode === 'grabbing') cursorValue = 'grabbing';
		else if (isPointerState) cursorValue = 'pointer';
		else if (cursorMode === 'grab') cursorValue = 'grab';
		document.documentElement.style.cursor = cursorValue;
		document.body.style.cursor = cursorValue;

		return () => {
			document.documentElement.style.cursor = '';
			document.body.style.cursor = '';
		};
	});

	onMount(() => {
		const handleCursorText = (event: Event) => {
			const customEvent = event as CustomEvent<CursorTextDetail>;
			const rawText = customEvent.detail?.text ?? null;
			const normalized = rawText && rawText.trim().length > 0 ? rawText : null;

			// Avoid re-animating when the text hasn't actually changed
			if (normalized === cursorText) return;

			cursorText = normalized;
		};

		const handleCursorLink = (event: Event) => {
			const customEvent = event as CustomEvent<CursorLinkDetail>;
			const rawHref = customEvent.detail?.href ?? null;
			const normalized = rawHref && rawHref.trim().length > 0 ? rawHref : null;
			if (normalized === cursorHref) return;
			cursorHref = normalized;
		};

		const handleCursorVisibility = (event: Event) => {
			const customEvent = event as CustomEvent<CursorVisibilityDetail>;
			isHiddenByComponent = !!customEvent.detail?.hidden;
		};

		const handleCursorMode = (event: Event) => {
			const customEvent = event as CustomEvent<CursorModeDetail>;
			cursorMode = customEvent.detail?.mode ?? null;
		};

		const updateDevice = (e: MediaQueryListEvent | MediaQueryList) => {
			isDeviceHasCursor = e.matches;
			isDeviceHasCursor ? addPointerListeners() : removePointerListeners();
		};

		const mediaQuery = window.matchMedia('(pointer: fine)');
		window.addEventListener(CURSOR_TEXT_EVENT, handleCursorText);
		window.addEventListener(CURSOR_LINK_EVENT, handleCursorLink);
		window.addEventListener(CURSOR_VISIBILITY_EVENT, handleCursorVisibility);
		window.addEventListener(CURSOR_MODE_EVENT, handleCursorMode);
		updateDevice(mediaQuery);
		mediaQuery.addEventListener('change', updateDevice); // Listen for changes (e.g., if a user plugs in a mouse or uses a hybrid device)

		return () => {
			mediaQuery.removeEventListener('change', updateDevice);
			removePointerListeners();
			window.removeEventListener(CURSOR_TEXT_EVENT, handleCursorText);
			window.removeEventListener(CURSOR_LINK_EVENT, handleCursorLink);
			window.removeEventListener(CURSOR_VISIBILITY_EVENT, handleCursorVisibility);
			window.removeEventListener(CURSOR_MODE_EVENT, handleCursorMode);
		};
	});

	let cursorEl: HTMLDivElement | null = $state(null);
	function handleMouseMove(e: MouseEvent) {
		targetCursorX = e.clientX;
		targetCursorY = e.clientY;
		if (!hasPointerPosition) {
			hasPointerPosition = true;
			renderedCursorX = targetCursorX;
			renderedCursorY = targetCursorY;
			cursorX = renderedCursorX;
			cursorY = renderedCursorY;
			if (cursorEl) {
				cursorEl.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0)`;
			}
		}
	}

	function animateCursor(timestamp: number) {
		const delta = lastAnimationTimestamp ? Math.min(40, timestamp - lastAnimationTimestamp) : 16.67;
		lastAnimationTimestamp = timestamp;

		if (hasPointerPosition && cursorEl) {
			const baseSmoothing = isPointerState ? 0.42 : 0.32;
			const normalizedDelta = Math.min(2.4, delta / 16.67);
			const interpolation = 1 - Math.pow(1 - baseSmoothing, normalizedDelta);

			renderedCursorX += (targetCursorX - renderedCursorX) * interpolation;
			renderedCursorY += (targetCursorY - renderedCursorY) * interpolation;

			if (Math.abs(targetCursorX - renderedCursorX) < 0.08) {
				renderedCursorX = targetCursorX;
			}
			if (Math.abs(targetCursorY - renderedCursorY) < 0.08) {
				renderedCursorY = targetCursorY;
			}

			cursorX = renderedCursorX;
			cursorY = renderedCursorY;
			cursorEl.style.transform = `translate3d(${renderedCursorX}px, ${renderedCursorY}px, 0)`;
		}

		cursorAnimationFrame = window.requestAnimationFrame(animateCursor);
	}

	function updateHoverTarget(interactive: HTMLElement | null) {
		isHoveringInteractive = !!interactive;
		isOverHotspot = !!interactive?.classList.contains('hotspot__btn');
		hoverCursorAnchor = interactive;
		hoverCursorText =
			interactive?.getAttribute('cursor-text-label') ??
			interactive?.getAttribute('data-cursor-text-label') ??
			null;

		if (hoverCursorAnchor && hoverCursorText) {
			updateHoverLabelPosition(hoverCursorAnchor);
		}
	}

	function syncHoverTargetFromPoint(clientX: number, clientY: number) {
		const hoveredElement = document.elementFromPoint(clientX, clientY);
		const interactive =
			hoveredElement?.closest('a, button') instanceof HTMLElement
				? (hoveredElement.closest('a, button') as HTMLElement)
				: null;

		updateHoverTarget(interactive);
		isOverFormField = !!hoveredElement?.closest(FORM_FIELD_SELECTOR);
	}

	// Anchor labels to the button's resting layout box, not its live transform.
	// Buttons like the header CTAs apply a magnetic shift (ctaResonance) and
	// slide their sibling out of the way on hover; reading getBoundingClientRect()
	// directly made the label drift along with that motion. Stripping the
	// element's own translate keeps the label still.
	function getRestingRect(node: HTMLElement): DOMRect {
		const rect = node.getBoundingClientRect();
		const transform = getComputedStyle(node).transform;
		if (!transform || transform === 'none') return rect;
		const matrix = new DOMMatrixReadOnly(transform);
		if (!matrix.m41 && !matrix.m42) return rect;
		return new DOMRect(rect.left - matrix.m41, rect.top - matrix.m42, rect.width, rect.height);
	}

	function updateHoverLabelPosition(node: HTMLElement) {
		const rect = getRestingRect(node);
		const shouldPlaceLeft = rect.right > window.innerWidth * 0.7;

		hoverCursorLabelSide = shouldPlaceLeft ? 'left' : 'right';
		hoverCursorLabelX = shouldPlaceLeft ? rect.left - 12 : rect.right + 12;
		hoverCursorLabelY = rect.top + rect.height / 2;
	}

	function handleMouseOver(e: MouseEvent) {
		const target = e.target as Element | null;
		const interactive = target?.closest('a, button');
		updateHoverTarget(interactive instanceof HTMLElement ? interactive : null);
		isOverFormField = !!target?.closest(FORM_FIELD_SELECTOR);
	}

	function handleMouseOut(e: MouseEvent) {
		const nextTarget = e.relatedTarget;
		const interactive = nextTarget instanceof Element ? nextTarget.closest('a, button') : null;

		updateHoverTarget(interactive instanceof HTMLElement ? interactive : null);
		isOverFormField =
			nextTarget instanceof Element ? !!nextTarget.closest(FORM_FIELD_SELECTOR) : false;
	}

	function handleClick(e: MouseEvent) {
		const id = rippleId++;
		clickRipples = [...clickRipples, { id, x: e.clientX, y: e.clientY }];

		if (cursorHref && cursorText) {
			window.open(cursorHref, '_blank', 'noopener,noreferrer');
		}

		window.setTimeout(() => {
			clickRipples = clickRipples.filter((ripple) => ripple.id !== id);
		}, 450);

		requestAnimationFrame(() => {
			syncHoverTargetFromPoint(e.clientX, e.clientY);
		});
	}

	function handleHoverAnim(event: Event) {
		const customEvent = event as CustomEvent<CursorHoverAnimDetail>;
		const x = customEvent.detail?.x ?? cursorX;
		const y = customEvent.detail?.y ?? cursorY;
		const id = rippleId++;
		hoverAnimPulses = [...hoverAnimPulses, { id, x, y }];

		window.setTimeout(() => {
			hoverAnimPulses = hoverAnimPulses.filter((pulse) => pulse.id !== id);
		}, 380);
	}

	function addPointerListeners() {
		if (cursorAnimationFrame === null) {
			lastAnimationTimestamp = 0;
			cursorAnimationFrame = window.requestAnimationFrame(animateCursor);
		}
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseover', handleMouseOver);
		window.addEventListener('mouseout', handleMouseOut);
		window.addEventListener('click', handleClick);
		window.addEventListener(CURSOR_HOVER_ANIM_EVENT, handleHoverAnim);
	}

	function removePointerListeners() {
		if (cursorAnimationFrame !== null) {
			window.cancelAnimationFrame(cursorAnimationFrame);
			cursorAnimationFrame = null;
		}
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseover', handleMouseOver);
		window.removeEventListener('mouseout', handleMouseOut);
		window.removeEventListener('click', handleClick);
		window.removeEventListener(CURSOR_HOVER_ANIM_EVENT, handleHoverAnim);
		isHoveringInteractive = false;
		hoverCursorText = null;
		hoverCursorAnchor = null;
		isOverFormField = false;
		isOverHotspot = false;
		hasPointerPosition = false;
	}
</script>

{#if isDeviceHasCursor}
	<div
		bind:this={cursorEl}
		class="cursor"
		class:hover={isPointerState}
		class:grab={cursorMode === 'grab' && !isPointerState}
		class:grabbing={cursorMode === 'grabbing'}
		class:hidden={isCursorHidden}
	>
		<div class="cursor__core"></div>
	</div>
	{#if hoverCursorText && !isHiddenByComponent && cursorMode !== 'grabbing'}
		<div
			class="cursor-anchor-label"
			class:cursor-anchor-label--left={hoverCursorLabelSide === 'left'}
			style={`left: ${hoverCursorLabelX}px; top: ${hoverCursorLabelY}px;`}
		>
			<p class="cursor-anchor-label__text">{hoverCursorText}</p>
		</div>
	{:else if activeCursorText && !isHiddenByComponent && cursorMode !== 'grabbing'}
		{#key activeCursorText}
			<div class="cursor-label" style={`left: ${cursorX}px; top: ${cursorY + 24}px;`}>
				<p class="cursor-label__text">{activeCursorText}</p>
			</div>
		{/key}
	{/if}
	{#each clickRipples as ripple (ripple.id)}
		<div class="cursor-ripple" style={`transform: translate(${ripple.x}px, ${ripple.y}px);`}>
			<div class="cursor-ripple-dot"></div>
		</div>
	{/each}
	{#each hoverAnimPulses as pulse (pulse.id)}
		<div class="cursor-hover-pulse" style={`transform: translate(${pulse.x}px, ${pulse.y}px);`}>
			<div class="cursor-hover-pulse-dot"></div>
		</div>
	{/each}
{/if}

<style lang="scss">
	.cursor {
		position: fixed;
		top: -0.6rem;
		left: -0.6rem;
		width: 1.2rem;
		height: 1.2rem;
		pointer-events: none;
		z-index: 10;
		transition:
			width 0.16s ease,
			height 0.16s ease,
			top 0.16s ease,
			left 0.16s ease;
		mix-blend-mode: difference;
		will-change: transform, width, height, top, left;
		backface-visibility: hidden;
	}

	.cursor__core {
		width: 100%;
		height: 100%;
		background-color: #fff;
		border-radius: 50%;
		mix-blend-mode: difference;
		transform: scale(1);
		transform-origin: center;
		opacity: 1;
		filter: blur(0);
		transition:
			transform 0.26s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.22s ease,
			filter 0.26s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.cursor.hover {
		top: -1.2rem;
		left: -1.2rem;
		width: 2.4rem;
		height: 2.4rem;
	}

	.cursor.hidden {
		.cursor__core {
			opacity: 0;
			transform: scale(0.38);
			filter: blur(3px);
		}
	}

	.cursor.grab,
	.cursor.grabbing {
		top: -0.8rem;
		left: -0.8rem;
		width: 1.6rem;
		height: 1.6rem;
	}

	.cursor.grab .cursor__core {
		transform: scale(1.35, 1.35);
		border-radius: 999px;
		background-color: #fff;
	}

	.cursor.grabbing .cursor__core {
		transform: scale(1.05, 1.05);
		border-radius: 999px;
		background-color: #e64749;
		mix-blend-mode: normal;
	}

	.cursor.grabbing {
		mix-blend-mode: normal;
	}

	.cursor-label {
		position: fixed;
		top: 0;
		left: 0;
		transform: translate(-50%, 0) scale(1);
		transform-origin: top center;
		opacity: 0;
		animation: cursor-label-in 0.22s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
		pointer-events: none;
		z-index: 10001;
		color: #efeeec;
		background-color: #e64749;
		border-radius: 0.25em;
		padding: 0.3em 0.75em 0.4em;
		font-size: 0.9rem;
		white-space: nowrap;
		will-change: transform, opacity;
	}

	.cursor-label__text {
		margin: 0;
	}

	.cursor-anchor-label {
		position: fixed;
		top: 0;
		left: 0;
		transform: translate(0, -50%);
		transform-origin: left center;
		opacity: 0;
		animation: cursor-anchor-label-in 0.22s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
		pointer-events: none;
		z-index: 10001;
		color: #efeeec;
		background-color: #e64749;
		border-radius: 0.25em;
		padding: 0.3em 0.75em 0.4em;
		font-size: 0.9rem;
		white-space: nowrap;
	}

	.cursor-anchor-label--left {
		transform: translate(-100%, -50%);
		transform-origin: right center;
	}

	.cursor-anchor-label__text {
		margin: 0;
	}

	@keyframes cursor-label-in {
		from {
			opacity: 0;
			transform: translate(-50%, 6px) scale(0.92);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0) scale(1);
		}
	}

	@keyframes cursor-anchor-label-in {
		from {
			opacity: 0;
			transform: translate(0, calc(-50% + 6px)) scale(0.92);
		}
		to {
			opacity: 1;
			transform: translate(0, -50%) scale(1);
		}
	}

	.cursor-anchor-label--left {
		animation-name: cursor-anchor-label-in-left;
	}

	@keyframes cursor-anchor-label-in-left {
		from {
			opacity: 0;
			transform: translate(-100%, calc(-50% + 6px)) scale(0.92);
		}
		to {
			opacity: 1;
			transform: translate(-100%, -50%) scale(1);
		}
	}

	.cursor-ripple {
		position: fixed;
		top: -0.6rem;
		left: -0.6rem;
		pointer-events: none;
		z-index: 9999;
	}

	.cursor-ripple-dot {
		width: 1.2rem;
		height: 1.2rem;
		border-radius: 50%;
		background-color: rgba(255, 255, 255, 0.9);
		animation: cursor-ripple 0.45s ease-out forwards;
	}

	@keyframes cursor-ripple {
		from {
			opacity: 1;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(3);
		}
	}

	.cursor-hover-pulse {
		position: fixed;
		top: -0.7rem;
		left: -0.7rem;
		pointer-events: none;
		z-index: 9998;
	}

	.cursor-hover-pulse-dot {
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.42);
		animation: cursor-hover-pulse 0.3s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
	}

	@keyframes cursor-hover-pulse {
		from {
			opacity: 0.55;
			transform: scale(0.96);
		}
		to {
			opacity: 0;
			transform: scale(1.32);
		}
	}
</style>
