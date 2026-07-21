<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Clock } from 'three';
	import { Howler } from 'howler';
	import { loadingFinish } from '../store.svelte';
	import { getCappedDevicePixelRatio } from '$lib/utils/devicePixelRatio';
	import { sfx, SFX_KEY } from '$lib/utils/sfx';
	import { hoverSound } from '$lib/utils/hoverSound';
	import { saveEnterWithSound, loadVolume, saveVolume } from '$lib/utils/soundPreference';

	const { isMenu = false, introVisible = true, mobileHidden = false } = $props();
	let shouldShowIntro = $derived(isMenu || introVisible);
	const CURSOR_TEXT_EVENT = 'cursor:set-text';
	const CURSOR_VISIBILITY_EVENT = 'cursor:set-hidden';

	let canvas: HTMLCanvasElement | undefined = $state();
	let ctx: CanvasRenderingContext2D | null = null;
	let logicalWidth = 0;
	let logicalHeight = 0;

	let isMobile = $state(false);

	// Howler Logic
	let analyser: AnalyserNode | null = null;
	let dataArray: Uint8Array<ArrayBuffer> | null = null;
	let bufferLength = 0;

	const FADE_MS = 350;
	const VISUALISER_MAX_FPS = 30;
	const VISUALISER_FRAME_INTERVAL_MS = 1000 / VISUALISER_MAX_FPS;
	let isInitialized = false;
	let animationId: number;
	let isMuted = $state(true);
	// User-chosen master level (0..1) scaling both SFX and music. Howler's master
	// volume is set to `isMuted ? 0 : masterVolume`; muting only gates it, so the
	// chosen level survives a mute/unmute round-trip.
	let masterVolume = $state(loadVolume(1));
	let fadeRaf: number | null = null;
	let lastVisualiserFrameTs = 0;
	let isDocumentVisible = $state(true);
	let isHovered = $state(false);
	// "Audible" = unmuted AND above zero, so a drag down to 0% reads as "off".
	let isAudible = $derived(!isMuted && masterVolume > 0);
	let statusText = $derived(isAudible ? 'Sound on' : 'Sound off');
	let statusHint = $derived(isAudible ? 'Mute ambient audio' : 'Enable ambient audio');
	let hoverLabel = $derived(isAudible ? 'Mute sound' : 'Enable sound');
	let audioLevel = $derived(isMuted ? 0 : masterVolume);
	let volumePct = $derived(Math.round(masterVolume * 100));
	let isMobileDocked = $derived(!isMenu && isMobile);
	let shouldRenderMobileDocked = $derived(!(isMobileDocked && mobileHidden));

	// --- Drag-to-set-volume (desktop surface) ---
	// Mirrors ScrollIndicator's drag/click disambiguation: a pointer that moves past
	// the threshold scrubs volume; one that doesn't is a plain click (toggles mute).
	const DRAG_THRESHOLD_PX = 6;
	const RESTORE_VOLUME = 0.6; // level to return to when unmuting from a 0% state
	let pointerDown = false;
	let isDragging = $state(false);
	let didDrag = false;
	let dragStartX = 0;
	let dragRect: DOMRect | null = null;

	onMount(() => {
		const mql = window.matchMedia('(max-width: 1024px)');
		isMobile = mql.matches;

		const onChange = (e: MediaQueryListEvent) => {
			isMobile = e.matches;
		};

		mql.addEventListener('change', onChange);

		const handleVisibilityChange = () => {
			isDocumentVisible = document.visibilityState === 'visible';
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);
		handleVisibilityChange();

		const handlePreloaderEnterWithSound = () => {
			isMuted = false;
			handlePlay();
		};
		window.addEventListener('audio-visualiser-play', handlePreloaderEnterWithSound);

		return () => {
			mql.removeEventListener('change', onChange);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('audio-visualiser-play', handlePreloaderEnterWithSound);
		};
	});

	$effect(() => {
		if ($loadingFinish) {
			handlePlay();
		}
	});

	$effect(() => {
		if (!canvas) return;

		ctx = canvas.getContext('2d');
		const dpr = getCappedDevicePixelRatio();

		const resize = () => {
			const rect = canvas!.getBoundingClientRect();
			const w = rect.width;
			const h = rect.height;
			if (w <= 0 || h <= 0) return;
			logicalWidth = w;
			logicalHeight = h;
			canvas!.width = Math.round(w * dpr);
			canvas!.height = Math.round(h * dpr);
			if (ctx) {
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.scale(dpr, dpr);
			}
			if (!animationId) startVisualiser();
		};

		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(canvas);

		return () => ro.disconnect();
	});

	onDestroy(() => {
		if (animationId) cancelAnimationFrame(animationId);
		if (fadeRaf !== null) cancelAnimationFrame(fadeRaf);
	});

	// While muted the analyser output is flat, so draw() renders one static frame
	// and does not re-arm its rAF — no 30fps loop competing with the scene while
	// idle. isMuted/isHovered/shouldShowIntro are re-read here so any change that
	// alters the drawn frame restarts the loop (or repaints the static frame).
	$effect(() => {
		void isMuted;
		void isHovered;
		void shouldShowIntro;
		if (isDocumentVisible && shouldRenderMobileDocked) {
			startVisualiser();
			return;
		}
		stopVisualiser();
	});

	function handlePlay() {
		const bgMusicHowl = sfx.get(SFX_KEY.bgMusic);
		if (!bgMusicHowl) return;

		if (!isInitialized) {
			initAudioHelpers();
			isInitialized = true;
		}

		Howler.mute(isMuted);
		Howler.volume(isMuted ? 0 : masterVolume);

		if (!bgMusicHowl.playing()) {
			bgMusicHowl.play();
		}
	}

	function initAudioHelpers() {
		const audioContext = Howler.ctx;

		analyser = audioContext.createAnalyser();
		analyser.fftSize = 2048;
		bufferLength = analyser.fftSize;
		dataArray = new Uint8Array(new ArrayBuffer(bufferLength));

		Howler.masterGain.connect(analyser);

		startVisualiser();
	}

	function startVisualiser() {
		if (!isDocumentVisible || !shouldRenderMobileDocked) return;

		stopVisualiser();
		lastVisualiserFrameTs = 0;

		draw();
	}

	function stopVisualiser() {
		if (animationId) {
			cancelAnimationFrame(animationId);
			animationId = 0;
		}
	}

	function draw(timestamp = 0) {
		if (!shouldRenderMobileDocked || !canvas || !ctx || logicalWidth <= 0 || logicalHeight <= 0) {
			stopVisualiser();
			return;
		}
		if (isMuted) {
			// Flat line while muted — render this one frame and halt (animationId 0
			// keeps the resize → startVisualiser repaint path working).
			animationId = 0;
		} else {
			animationId = requestAnimationFrame(draw);
			if (
				lastVisualiserFrameTs !== 0 &&
				timestamp - lastVisualiserFrameTs < VISUALISER_FRAME_INTERVAL_MS
			) {
				return;
			}
			lastVisualiserFrameTs = timestamp;
		}

		const hasAudioData = Boolean(analyser && dataArray && bufferLength > 0);
		if (hasAudioData) {
			analyser!.getByteTimeDomainData(dataArray!);
		}
		ctx.clearRect(0, 0, logicalWidth, logicalHeight);

		const w = logicalWidth;
		const h = logicalHeight;
		const midY = h / 2;
		const dotRadius = 1.35;
		const gap = 2.5;
		const gridStep = dotRadius * 2 + gap;
		const minColumns = 2;
		const columnCount = Math.max(minColumns, Math.floor((w - dotRadius * 2) / gridStep) + 1);
		const horizontalSpan = Math.max(0, w - dotRadius * 2);
		const columnStep = columnCount > 1 ? horizontalSpan / (columnCount - 1) : 0;
		const preAmp = isMobileDocked ? 44.0 : 24.0;
		const maxVal = isMobileDocked ? 1.4 : 0.9;
		const noiseFloor = isMobileDocked ? 0.004 : 0.012;
		const baseColor = isMobileDocked
			? isMuted
				? 'rgba(182, 190, 206, 0.92)'
				: 'rgba(230, 71, 73, 0.98)'
			: isHovered
				? 'rgba(255, 255, 255, 0.94)'
				: 'rgba(230, 71, 73, 0.94)';
		const glowColor = isMobileDocked
			? isMuted
				? 'rgba(182, 190, 206, 0.18)'
				: 'rgba(230, 71, 73, 0.36)'
			: isHovered
				? 'rgba(255, 255, 255, 0.26)'
				: 'rgba(230, 71, 73, 0.22)';
		ctx.fillStyle = baseColor;
		// No canvas shadow on the mobile dock — shadowBlur is one of the most
		// expensive 2D-canvas ops and competes with the WebGL scene's frame budget.
		ctx.shadowBlur = isMobileDocked ? 0 : isHovered ? 10 : 7;
		ctx.shadowColor = glowColor;
		ctx.globalAlpha = shouldShowIntro ? 1 : 0.82;

		for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
			const x = dotRadius + columnIndex * columnStep;
			const sampleLength = hasAudioData ? bufferLength : 1;
			const progressX = columnCount > 1 ? columnIndex / (columnCount - 1) : 0;
			const dataIndex = Math.min(sampleLength - 1, Math.floor(progressX * sampleLength));
			const v = hasAudioData ? dataArray![dataIndex] : 128;
			let rawAmplitude = Math.abs(v - 128) / 128;
			if (isMobileDocked) {
				rawAmplitude = Math.min(1, rawAmplitude * 2.3);
				if (!isMuted) {
					const drift = 0.03 * (0.5 + 0.5 * Math.sin(timestamp * 0.011 + columnIndex * 0.35));
					rawAmplitude = Math.min(1, rawAmplitude + drift);
				}
			}
			if (rawAmplitude < noiseFloor) rawAmplitude = 0;
			const compressed = Math.atan(rawAmplitude * preAmp) / (Math.PI / 2);
			const columnHeight = Math.min(compressed * midY * maxVal, Math.max(0, midY - dotRadius));

			for (let y = 0; y <= columnHeight; y += gridStep) {
				ctx.beginPath();
				ctx.arc(x, midY - y, dotRadius, 0, Math.PI * 2);
				ctx.fill();
				if (y > 0) {
					ctx.beginPath();
					ctx.arc(x, midY + y, dotRadius, 0, Math.PI * 2);
					ctx.fill();
				}
			}
		}
		ctx.shadowBlur = 0;
		ctx.globalAlpha = 1;
	}

	function fadeVolume(from: number, to: number, onComplete: () => void) {
		if (fadeRaf !== null) cancelAnimationFrame(fadeRaf);
		const clock = new Clock(true);
		const run = () => {
			const t = Math.min((clock.getElapsedTime() * 1000) / FADE_MS, 1);
			const eased = t * (2 - t);
			const v = from + (to - from) * eased;
			Howler.volume(v);
			if (t < 1) {
				fadeRaf = requestAnimationFrame(run);
			} else {
				fadeRaf = null;
				onComplete();
			}
		};
		fadeRaf = requestAnimationFrame(run);
	}

	function toggleMute() {
		if (!isInitialized) handlePlay();
		if (fadeRaf !== null) return;

		if (isMuted) {
			// Unmute: unmute first, start at 0, fade up to the chosen level. If the
			// level was dragged to 0, restore an audible default so unmute is heard.
			if (masterVolume === 0) {
				masterVolume = RESTORE_VOLUME;
				saveVolume(masterVolume);
			}
			isMuted = false;
			Howler.mute(false);
			Howler.volume(0);
			fadeVolume(0, masterVolume, () => {});
			saveEnterWithSound(true);
		} else {
			// Mute: fade out from the chosen level, then mute.
			fadeVolume(masterVolume, 0, () => {
				Howler.mute(true);
				Howler.volume(masterVolume);
				isMuted = true;
				saveEnterWithSound(false);
			});
		}
	}

	function setCursorText(text: string | null) {
		window.dispatchEvent(new CustomEvent<{ text: string | null }>(CURSOR_TEXT_EVENT, { detail: { text } }));
	}

	function setCursorHidden(hidden: boolean) {
		window.dispatchEvent(
			new CustomEvent<{ hidden: boolean }>(CURSOR_VISIBILITY_EVENT, { detail: { hidden } })
		);
	}

	function handlePointerEnter() {
		if (isMobileDocked) return;
		isHovered = true;
		setCursorText(null);
		setCursorHidden(true);
	}

	function handlePointerLeave() {
		if (isMobileDocked) return;
		isHovered = false;
		setCursorText(null);
		setCursorHidden(false);
	}

	function levelFromClientX(clientX: number, rect: DOMRect): number {
		if (rect.width <= 0) return masterVolume;
		return Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
	}

	// Live-apply during drag/keyboard: no fade, follows the pointer instantly. A drag
	// from a muted state unmutes so the level change is audible immediately.
	function applyLiveVolume(level: number) {
		if (fadeRaf !== null) {
			cancelAnimationFrame(fadeRaf);
			fadeRaf = null;
		}
		if (!isInitialized) handlePlay();
		masterVolume = level;
		if (isMuted) {
			isMuted = false;
			Howler.mute(false);
		}
		Howler.volume(level);
	}

	function persistVolume() {
		saveVolume(masterVolume);
		saveEnterWithSound(masterVolume > 0);
	}

	function handlePointerDown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		pointerDown = true;
		didDrag = false;
		dragStartX = e.clientX;
		dragRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		// Drag-to-scrub is desktop-only; the mobile dock stays tap-to-toggle.
		if (!pointerDown || isMobile) return;
		if (!didDrag && Math.abs(e.clientX - dragStartX) > DRAG_THRESHOLD_PX) {
			didDrag = true;
			isDragging = true;
		}
		if (!isDragging) return;
		const rect = dragRect ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
		applyLiveVolume(levelFromClientX(e.clientX, rect));
	}

	function handlePointerUp(e: PointerEvent) {
		if (!pointerDown) return;
		const wasDrag = didDrag;
		pointerDown = false;
		isDragging = false;
		dragRect = null;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		// A scrub commits its level; a plain press toggles mute (same as before).
		if (wasDrag) persistVolume();
		else toggleMute();
	}

	function handlePointerCancel(e: PointerEvent) {
		pointerDown = false;
		isDragging = false;
		dragRect = null;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
	}

	// Pointer taps/clicks are handled in handlePointerUp; this fires only for
	// keyboard activation (Enter/Space → detail 0), keeping mute toggleable there.
	function handleClick(e: MouseEvent) {
		if (e.detail === 0) toggleMute();
	}

	function handleKeydown(e: KeyboardEvent) {
		const dir =
			e.key === 'ArrowRight' || e.key === 'ArrowUp'
				? 1
				: e.key === 'ArrowLeft' || e.key === 'ArrowDown'
					? -1
					: 0;
		if (dir === 0) return;
		e.preventDefault();
		applyLiveVolume(Math.max(0, Math.min(masterVolume + dir * 0.05, 1)));
		persistVolume();
	}
</script>

{#if shouldRenderMobileDocked}
	<button
		id="audio-visualiser"
		class:revealed={shouldShowIntro}
		class:hovered={isHovered}
		class:muted={!isAudible}
		class:dragging={isDragging}
		class:audio-visualiser--mobile={isMobileDocked}
		style="--audio-level: {audioLevel};"
		use:hoverSound
		onclick={handleClick}
		onkeydown={handleKeydown}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		onpointerenter={handlePointerEnter}
		onpointerleave={handlePointerLeave}
		aria-label={statusHint}
	>
		{#if isMobileDocked}
			<span class="audio-visualiser__mobile-shell">
				<canvas id="oscilloscope" class="audio-visualiser__mobile-scope" bind:this={canvas}></canvas>
			</span>
		{:else}
			<div class="audio-visualiser__chrome">
				<div class="audio-visualiser__scope-wrap">
					<div class="audio-visualiser__scope-glow"></div>
					<canvas id="oscilloscope" bind:this={canvas}></canvas>
					<span
						class="audio-visualiser__pct"
						class:audio-visualiser__pct--visible={isHovered || isDragging}
						aria-hidden="true">{volumePct}%</span
					>
				</div>
				<div class="audio-visualiser__meter" aria-hidden="true"></div>
					<div class="audio-visualiser__meta">
					<div class="audio-visualiser__status-row">
						<span class="audio-visualiser__status-dot"></span>
						<span class="audio-visualiser__eyebrow">Ambient</span>
					</div>
					<div class="audio-visualiser__state">{statusText}</div>
				</div>
			</div>
			<div
				class="audio-visualiser__hover-label"
				class:audio-visualiser__hover-label--visible={isHovered}
				aria-hidden="true"
			>
				{hoverLabel}
			</div>
		{/if}
	</button>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	$scrollIndicatorWidth: 23.5rem;
	$gap: 6px;

	#audio-visualiser {
		--audio-accent: #e64749;
		--audio-accent-soft: rgba(230, 71, 73, 0.18);
		--audio-surface: rgba(43, 44, 48, 0.95);
		--audio-border: rgba(168, 174, 188, 0.26);
		position: fixed;
		top: 1.2rem;
		left: calc(50% + ($scrollIndicatorWidth / 2) + $gap);
		z-index: 99;
		display: grid;
		color: white;
		opacity: 0;
		pointer-events: none;
		transform: translateY(-10px);
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		transition:
			opacity 680ms cubic-bezier(0.22, 1, 0.36, 1),
			transform 680ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	#audio-visualiser.revealed {
		opacity: 1;
		pointer-events: all;
		transform: translateY(0);
		transition-delay: 0.22s, 0s;
	}

	#audio-visualiser.audio-visualiser--mobile {
		top: auto;
		left: auto;
		z-index: 101;
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		border: 1px solid rgba(168, 174, 188, 0.42);
		background:
			radial-gradient(90% 70% at 50% 100%, rgba(230, 71, 73, 0.58), transparent 72%),
			linear-gradient(180deg, rgba(14, 15, 17, 0.96) 0%, rgba(30, 20, 23, 0.96) 52%, rgba(116, 38, 45, 0.98) 100%);
		box-shadow:
			0 14px 34px rgba(0, 0, 0, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.08),
			inset 0 -12px 22px rgba(230, 71, 73, 0.18);
		background-clip: padding-box;
		transform: translateY(10px) scale(0.92);
		place-items: center;
	}

	#audio-visualiser.audio-visualiser--mobile::before {
		content: '';
		position: absolute;
		inset: -7px;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.12);
		opacity: 0;
		transform: scale(0.88);
		transition: transform 0.42s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.42s ease;
		pointer-events: none;
	}

	#audio-visualiser.audio-visualiser--mobile.revealed {
		transform: translateY(0) scale(1);
	}

	#audio-visualiser.audio-visualiser--mobile .audio-visualiser__mobile-shell {
		width: 42px;
		height: 18px;
		display: block;
		pointer-events: none;
	}

	#audio-visualiser.audio-visualiser--mobile #oscilloscope {
		width: 100%;
		height: 100%;
		background: transparent;
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}

	#audio-visualiser.audio-visualiser--mobile.muted {
		border-color: rgba(168, 174, 188, 0.38);
		background: linear-gradient(180deg, rgba(14, 15, 17, 0.98), rgba(43, 44, 48, 0.98));
		box-shadow:
			0 14px 34px rgba(0, 0, 0, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.08),
			inset 0 -12px 22px rgba(0, 0, 0, 0.16);
	}

	@media (hover: hover) and (pointer: fine) {
		#audio-visualiser.revealed:hover,
		#audio-visualiser.revealed:focus-visible,
		#audio-visualiser.revealed.hovered {
			transform: translateY(-1px);
			transition:
				opacity 680ms cubic-bezier(0.22, 1, 0.36, 1),
				transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
		}

		#audio-visualiser.audio-visualiser--mobile.revealed:hover,
		#audio-visualiser.audio-visualiser--mobile.revealed:focus-visible {
			transform: translateY(-1px) scale(1.08);
			border-color: rgba(255, 255, 255, 0.62);
			box-shadow:
				0 18px 42px rgba(0, 0, 0, 0.5),
				0 0 22px rgba(255, 255, 255, 0.08),
				inset 0 1px 0 rgba(255, 255, 255, 0.25);
		}

		#audio-visualiser.audio-visualiser--mobile.revealed:hover::before,
		#audio-visualiser.audio-visualiser--mobile.revealed:focus-visible::before {
			opacity: 1;
			transform: scale(1);
		}
	}

	.audio-visualiser__chrome {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0;
		height: 2rem;
		padding: 0;
		box-sizing: border-box;
		border-radius: 0.42rem;
		overflow: hidden;
		background:
			linear-gradient(180deg, rgba(49, 51, 57, 0.96), rgba(28, 30, 35, 0.98)),
			var(--audio-surface);
		border: 1px solid var(--audio-border);
		box-shadow:
			0 0.8rem 2rem rgba(0, 0, 0, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		transition:
			border-color 240ms ease,
			box-shadow 260ms cubic-bezier(0.22, 1, 0.36, 1),
			background 260ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	/* Master-volume meter: a baseline bar shown only while scrubbing. */
	.audio-visualiser__meter {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 100%;
		height: 2px;
		transform-origin: left center;
		transform: scaleX(var(--audio-level, 0));
		background: linear-gradient(90deg, rgba(230, 71, 73, 0.55), #e64749);
		box-shadow: 0 0 10px rgba(230, 71, 73, 0.5);
		border-radius: 0 999px 999px 0;
		pointer-events: none;
		z-index: 3;
		opacity: 0;
		transition:
			transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
			box-shadow 220ms ease,
			opacity 220ms ease;
	}

	/* Fade in while dragging; the bar then tracks the pointer with no easing lag. */
	#audio-visualiser.dragging .audio-visualiser__meter {
		opacity: 1;
		box-shadow: 0 0 14px rgba(230, 71, 73, 0.72);
		transition: opacity 160ms ease;
	}

	#audio-visualiser.dragging {
		cursor: grabbing;
	}

	.audio-visualiser__hover-label {
		position: absolute;
		top: calc(100% + 0.45rem);
		left: 50%;
		transform: translateX(-50%) translateY(6px) scale(0.92);
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
		pointer-events: none;
		opacity: 0;
		transition:
			transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 220ms ease;
	}

	.audio-visualiser__hover-label--visible {
		opacity: 1;
		transform: translateX(-50%) translateY(0) scale(1);
	}

	#audio-visualiser:hover .audio-visualiser__chrome,
	#audio-visualiser.hovered .audio-visualiser__chrome {
		border-color: rgba(255, 255, 255, 0.24);
		box-shadow:
			0 1rem 2.4rem rgba(0, 0, 0, 0.24),
			0 0 0 1px rgba(255, 255, 255, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.07);
	}

	.audio-visualiser__scope-wrap {
		position: relative;
		overflow: hidden;
		width: 5.2rem;
		height: 100%;
		flex: 0 0 auto;
		border-radius: 0.42rem 0 0 0.42rem;
	}

	.audio-visualiser__scope-glow {
		position: absolute;
		inset: -20% -10%;
		background:
			radial-gradient(circle at 25% 50%, rgba(230, 71, 73, 0.18), transparent 58%),
			linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent);
		opacity: 0.7;
		transform: translateX(-12%);
		transition:
			opacity 260ms ease,
			transform 420ms cubic-bezier(0.22, 1, 0.36, 1),
			filter 260ms ease;
		filter: blur(2px);
		pointer-events: none;
	}

	#audio-visualiser:hover .audio-visualiser__scope-glow,
	#audio-visualiser.hovered .audio-visualiser__scope-glow {
		opacity: 1;
		transform: translateX(10%);
		filter: blur(0);
	}

	/* Live level readout over the scope; fades in on hover/drag, never reflows. */
	.audio-visualiser__pct {
		position: absolute;
		right: 0.35rem;
		bottom: 0.16rem;
		z-index: 2;
		font-size: 0.52rem;
		line-height: 1;
		letter-spacing: 0.04em;
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.92);
		text-shadow: 0 0 6px rgba(0, 0, 0, 0.65);
		pointer-events: none;
		opacity: 0;
		transform: translateY(2px);
		transition:
			opacity 200ms ease,
			transform 200ms ease;
	}

	.audio-visualiser__pct--visible {
		opacity: 0.95;
		transform: translateY(0);
	}

	#oscilloscope {
		width: 100%;
		height: 2rem;
		display: block;
		background:
			linear-gradient(180deg, rgba(15, 17, 20, 0.9), rgba(25, 27, 32, 0.82)),
			rgba(43, 44, 48, 0.95);
		border: 0.5px solid rgba(168, 174, 188, 0.2);
		border-radius: 4px;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}

	.audio-visualiser__meta {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.08rem;
		height: 100%;
		min-width: 5rem;
		padding: 0 0.62rem 0 0.52rem;
		border-left: 1px solid rgba(168, 174, 188, 0.16);
		box-sizing: border-box;
		text-align: left;
		flex: 0 0 auto;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0));
	}

	.audio-visualiser__status-row {
		display: inline-flex;
		align-items: center;
		gap: 0.24rem;
		min-width: 0;
	}

	.audio-visualiser__status-dot {
		width: 0.24rem;
		height: 0.24rem;
		border-radius: 999px;
		background: var(--audio-accent);
		box-shadow: 0 0 10px rgba(230, 71, 73, 0.36);
		animation: audio-status-pulse 2.4s ease-in-out infinite;
	}

	.audio-visualiser__eyebrow {
		font-size: 0.48rem;
		line-height: 1;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.52);
		white-space: nowrap;
	}

	.audio-visualiser__state {
		font-size: 0.68rem;
		line-height: 1;
		color: rgba(255, 255, 255, 0.96);
		white-space: nowrap;
		word-spacing: $word-spacing;
	}

	#audio-visualiser.muted .audio-visualiser__status-dot {
		background: rgba(255, 255, 255, 0.4);
		box-shadow: none;
		animation: none;
	}

	@media (max-width: 1024px) {
		#audio-visualiser:not(.audio-visualiser--mobile) {
			position: static;
			font-family: 'KH Interference TRIAL';
			margin-top: 2rem;
			width: 100%;
		}

		.audio-visualiser__chrome {
			width: 100%;
			height: auto;
			min-height: 2rem;
			justify-content: space-between;
		}

		.audio-visualiser__scope-wrap {
			width: auto;
			flex: 1 1 auto;
		}

		.audio-visualiser__meta {
			min-width: auto;
		}

		#oscilloscope {
			width: 100%;
			height: 1.75rem;
		}
	}

	@include breakpoint(small-phone) {
		#audio-visualiser.audio-visualiser--mobile {
			width: 48px;
			height: 48px;
		}

		#audio-visualiser.audio-visualiser--mobile .audio-visualiser__mobile-shell {
			height: 16px;
		}
	}

	@keyframes audio-status-pulse {
		0%,
		100% {
			opacity: 0.65;
			transform: scale(0.9);
		}
		50% {
			opacity: 1;
			transform: scale(1.1);
		}
	}

</style>
