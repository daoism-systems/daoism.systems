<script lang="ts">
	import { onDestroy } from 'svelte';
	import { cardReveal } from '$lib/utils/animations/cardReveal';
	import { hoverSound } from '$lib/utils/hoverSound';

	export let id: string;
	export let icon: string;
	export let title: string;
	export let subtitle: string;
	export let type: string;
	export let index: number;
	export let iconScale: number = 1;

	let cardEl: HTMLDivElement;
	let isHovering = false;
	let isPressing = false;
	let isReleasing = false;
	let releaseBurstPeakTimer: ReturnType<typeof setTimeout> | null = null;
	let releaseBurstEndTimer: ReturnType<typeof setTimeout> | null = null;
	let pointerMoveRaf: number | null = null;
	let targetPointerX = 0;
	let targetPointerY = 0;
	let currentPointerX = 0;
	let currentPointerY = 0;
	let hasPointerTarget = false;
	const CURSOR_HOVER_ANIM_EVENT = 'cursor:hover-anim';
	const maxRotate = 6.4;
	const maxShift = 11;
	const maxImageShift = 14;
	const tiltSmoothing = 0.12;
	const revealOptions = {
		startViewport: 0.92,
		endViewport: 0.16,
		ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
		fromDirection: index % 2 === 0 ? 'top' : 'bottom'
	} as const;

	function clearReleaseBurstTimers() {
		if (releaseBurstPeakTimer) {
			clearTimeout(releaseBurstPeakTimer);
			releaseBurstPeakTimer = null;
		}
		if (releaseBurstEndTimer) {
			clearTimeout(releaseBurstEndTimer);
			releaseBurstEndTimer = null;
		}
	}

	function clearPointerMoveRaf() {
		if (pointerMoveRaf === null) return;
		cancelAnimationFrame(pointerMoveRaf);
		pointerMoveRaf = null;
	}

	function handlePointerDown(event: PointerEvent) {
		if (!cardEl) return;
		clearReleaseBurstTimers();
		isReleasing = false;
		isPressing = true;
		cardEl.style.setProperty('--press-scale', '0.975');
		cardEl.setPointerCapture(event.pointerId);
	}

	function handlePointerRelease(event: PointerEvent) {
		if (cardEl?.hasPointerCapture(event.pointerId)) {
			cardEl.releasePointerCapture(event.pointerId);
		}
		runReleaseBurst();
	}

	function runReleaseBurst() {
		if (!cardEl || (!isPressing && isReleasing)) return;
		clearReleaseBurstTimers();
		isPressing = false;
		isReleasing = true;
		cardEl.style.setProperty('--press-scale', '1.018');

		releaseBurstPeakTimer = setTimeout(() => {
			if (!cardEl) return;
			cardEl.style.setProperty('--press-scale', '1');
			releaseBurstPeakTimer = null;
		}, 130);

		releaseBurstEndTimer = setTimeout(() => {
			isReleasing = false;
			releaseBurstEndTimer = null;
		}, 340);
	}

	function handleBlur() {
		runReleaseBurst();
		settleToRest();
	}

	function pulseCursorAtCard() {
		if (!cardEl || typeof window === 'undefined') return;
		const rect = cardEl.getBoundingClientRect();
		window.dispatchEvent(
			new CustomEvent<{ x: number; y: number }>(CURSOR_HOVER_ANIM_EVENT, {
				detail: {
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2
				}
			})
		);
	}

	function handlePointerEnter(event: PointerEvent) {
		if (event.pointerType === 'touch') return;
		isHovering = true;
		pulseCursorAtCard();
		handlePointerMove(event);
	}

	function clearPointerState() {
		if (!cardEl) return;
		cardEl.style.setProperty('--card-rotate-x', '0deg');
		cardEl.style.setProperty('--card-rotate-y', '0deg');
		cardEl.style.setProperty('--card-shift-x', '0px');
		cardEl.style.setProperty('--card-shift-y', '0px');
		cardEl.style.setProperty('--img-shift-x', '0px');
		cardEl.style.setProperty('--img-shift-y', '0px');
		cardEl.style.setProperty('--img-scale', '1');
		cardEl.style.setProperty('--img-z', '24px');
		cardEl.style.setProperty('--card-pointer-x', '50%');
		cardEl.style.setProperty('--card-pointer-y', '50%');
		cardEl.style.setProperty('--card-glow-alpha', '0');
	}

	function settleToRest() {
		if (!cardEl) return;
		isHovering = false;
		targetPointerX = 0;
		targetPointerY = 0;

		if (!hasPointerTarget) {
			hasPointerTarget = true;
			currentPointerX = 0;
			currentPointerY = 0;
		}

		if (pointerMoveRaf !== null) return;
		pointerMoveRaf = requestAnimationFrame(tickPointerMove);
	}

	onDestroy(() => {
		clearReleaseBurstTimers();
		clearPointerMoveRaf();
		clearPointerState();
	});

	function applyPointerMove(x: number, y: number) {
    if (!cardEl) return;
    const pointerIntensity = Math.min(Math.hypot(x, y) / Math.hypot(0.5, 0.5), 1);
    const imageScale = 1.012 + pointerIntensity * 0.028;
    const imageDepth = 24 + pointerIntensity * 9;
    const pointerPercentX = (x + 0.5) * 100;
    const pointerPercentY = (y + 0.5) * 100;
    const glowAlpha = 0.1 + pointerIntensity * 0.19;

    // Use .toFixed(1) for degrees/percents, and Math.round for pixels
    cardEl.style.setProperty('--card-rotate-x', `${(-y * maxRotate).toFixed(1)}deg`);
    cardEl.style.setProperty('--card-rotate-y', `${(x * maxRotate).toFixed(1)}deg`);
    cardEl.style.setProperty('--card-shift-x', `${Math.round(x * maxShift)}px`);
    cardEl.style.setProperty('--card-shift-y', `${Math.round(y * maxShift)}px`);
    cardEl.style.setProperty('--img-shift-x', `${Math.round(x * maxImageShift)}px`);
    cardEl.style.setProperty('--img-shift-y', `${Math.round(y * maxImageShift)}px`);
    cardEl.style.setProperty('--img-scale', imageScale.toFixed(2));
    cardEl.style.setProperty('--img-z', `${Math.round(imageDepth)}px`);
    cardEl.style.setProperty('--card-pointer-x', `${Math.round(pointerPercentX)}%`);
    cardEl.style.setProperty('--card-pointer-y', `${Math.round(pointerPercentY)}%`);
    cardEl.style.setProperty('--card-glow-alpha', glowAlpha.toFixed(2));
  }

	function tickPointerMove() {
		if (!cardEl || !hasPointerTarget) {
			pointerMoveRaf = null;
			return;
		}

		currentPointerX += (targetPointerX - currentPointerX) * tiltSmoothing;
		currentPointerY += (targetPointerY - currentPointerY) * tiltSmoothing;
		applyPointerMove(currentPointerX, currentPointerY);

		const deltaX = Math.abs(targetPointerX - currentPointerX);
		const deltaY = Math.abs(targetPointerY - currentPointerY);
		if (deltaX < 0.002 && deltaY < 0.002) {
			currentPointerX = targetPointerX;
			currentPointerY = targetPointerY;
			applyPointerMove(currentPointerX, currentPointerY);
			if (!isHovering && targetPointerX === 0 && targetPointerY === 0) {
				hasPointerTarget = false;
			}
			pointerMoveRaf = null;
			return;
		}

		pointerMoveRaf = requestAnimationFrame(tickPointerMove);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!cardEl || event.pointerType === 'touch') return;
		isHovering = true;
		const rect = cardEl.getBoundingClientRect();
		targetPointerX = (event.clientX - rect.left) / rect.width - 0.5;
		targetPointerY = (event.clientY - rect.top) / rect.height - 0.5;

		if (!hasPointerTarget) {
			hasPointerTarget = true;
			currentPointerX = targetPointerX * 0.35;
			currentPointerY = targetPointerY * 0.35;
		}

		if (pointerMoveRaf !== null) return;
		pointerMoveRaf = requestAnimationFrame(tickPointerMove);
	}
</script>

<div class="card-wrap" use:cardReveal={revealOptions}>
	<div
		bind:this={cardEl}
		use:hoverSound
		role="presentation"
		class="card text-lg"
		class:is-hovering={isHovering}
		class:is-pressing={isPressing}
		class:is-releasing={isReleasing}
		on:pointerenter={handlePointerEnter}
		on:pointerdown={handlePointerDown}
		on:pointerup={handlePointerRelease}
		on:pointercancel={handlePointerRelease}
		on:pointermove={handlePointerMove}
		on:pointerleave={settleToRest}
		on:blur={handleBlur}
	>
		<div class="card__header">
			<div class="card__number">
				<span class="text-3xl">{id}</span>
				<span>/ 5</span>
			</div>
			<span class="card__type text-sm">{type}</span>
		</div>
		<div class="card__desc">
			<!-- <h4>{title}</h4> -->
			<p>{subtitle}</p>
		</div>
		<div class="card__icon">
			<div class="card__icon-inner">
				<img src={icon} alt={`partner icon ${id}`} style:--icon-scale={iconScale} />
			</div>
		</div>
	</div>
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.card {
		--card-rotate-x: 0deg;
		--card-rotate-y: 0deg;
		--card-shift-x: 0px;
		--card-shift-y: 0px;
		--card-pointer-x: 50%;
		--card-pointer-y: 50%;
		--card-glow-alpha: 0;
		--img-shift-x: 0px;
		--img-shift-y: 0px;
		--img-scale: 1;
		--img-z: 24px;
		--press-scale: 1;
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background: $color-grey-600;
		padding: 1rem;
		transform-style: preserve-3d;
		transform: perspective(1120px) translate3d(var(--card-shift-x), var(--card-shift-y), 0)
			rotateX(var(--card-rotate-x)) rotateY(var(--card-rotate-y)) scale(var(--press-scale));
		transition:
			transform 460ms cubic-bezier(0.16, 1, 0.3, 1),
			box-shadow 460ms cubic-bezier(0.16, 1, 0.3, 1),
			background 420ms cubic-bezier(0.16, 1, 0.3, 1);
		will-change: transform;
		overflow: hidden;
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.05) inset,
			0 0 0 1px rgba(255, 255, 255, 0.03),
			0 18px 40px rgba(7, 10, 18, 0.18);
		clip-path: polygon(
			1rem 0%,
			100% 0,
			100% calc(100% - 1rem),
			calc(100% - 1rem) 100%,
			0 100%,
			0 1rem
		);

		@include breakpoint(desktop) {
			width: 47vw;
			aspect-ratio: 3/2;
		}

		@include breakpoint(tablet) {
			width: 48vw;
			aspect-ratio: 320 / 329;
		}

		@include breakpoint(phone) {
			width: 71.2vw;
			aspect-ratio: 320 / 329;
		}

		@include breakpoint(small-phone) {
			width: 60vw;
		}

		&::before,
		&::after {
			content: '';
			position: absolute;
			inset: 0;
			pointer-events: none;
			transition:
				opacity 380ms cubic-bezier(0.16, 1, 0.3, 1),
				transform 420ms cubic-bezier(0.16, 1, 0.3, 1);
		}

		&::before {
			z-index: 0;
			opacity: calc(var(--card-glow-alpha) * 1.05);
			background:
				radial-gradient(
					34rem circle at var(--card-pointer-x) var(--card-pointer-y),
					rgba(255, 255, 255, 0.22) 0%,
					rgba(255, 255, 255, 0.08) 24%,
					rgba(230, 71, 73, 0.1) 45%,
					rgba(230, 71, 73, 0) 72%
				),
				linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 44%);
			mix-blend-mode: screen;
		}

		&::after {
			z-index: 1;
			opacity: calc(var(--card-glow-alpha) * 0.92);
			background:
				linear-gradient(
					115deg,
					rgba(255, 255, 255, 0) 18%,
					rgba(255, 255, 255, 0.16) 48%,
					rgba(255, 255, 255, 0.04) 58%,
					rgba(255, 255, 255, 0) 74%
				),
				radial-gradient(
					22rem circle at var(--card-pointer-x) var(--card-pointer-y),
					rgba(255, 255, 255, 0.24) 0%,
					rgba(255, 255, 255, 0.08) 18%,
					rgba(255, 255, 255, 0) 52%
				);
			transform: translate3d(calc(var(--card-shift-x) * -0.18), calc(var(--card-shift-y) * -0.18), 1px);
		}

		&__header {
			position: relative;
			z-index: 2;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 1rem;

			@include breakpoint(desktop) {
				display: contents;
			}
		}

		&__number {
			display: flex;
			align-items: baseline;
			gap: 0.4rem;
			color: #9ea4b1;
			line-height: 1.1;

			@include breakpoint(desktop) {
				position: absolute;
				top: 1rem;
				left: 1rem;
				z-index: 2;
			}

			span:first-of-type {
				font-family: $font-secondary;
				color: #fff;
				line-height: 1;
			}
		}

		&__type {
			display: inline-flex;
			align-items: center;
			padding: 0.375rem 0.75rem;
			border-radius: 4px;
			background: rgba(#fff, 0.1);
			backdrop-filter: blur(50px);
			-webkit-backdrop-filter: blur(50px);
			color: #fff;
			line-height: 1;
			white-space: nowrap;

			@include breakpoint(desktop) {
				position: absolute;
				top: 1rem;
				right: 1rem;
				z-index: 2;
			}
		}

		&__desc {
			position: relative;
			z-index: 2;
			padding-bottom: 1rem;
			border-bottom: 1px solid rgba(#fff, 0.2);
			color: #fff;
			text-align: left;

			@include breakpoint(desktop) {
				width: 48%;
				margin-left: auto;
			}

			h4, p {
        // Force GPU rendering to prevent jitter during animation blur/scale
        -webkit-transform: translate3d(0, 0, 0);
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
      }

			h4 {
				color: #9ea4b1;
				font-size: 0.875rem;
				font-weight: 500;
				margin-bottom: 0.25rem;
			}

			p {
				font-size: 1.25rem;
				line-height: 1.2;
			}
		}

		&__icon {
			position: relative;
			z-index: 2;
			flex: 1 1 auto;
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 0;

			@include breakpoint(desktop) {
				position: absolute;
				top: 50%;
				left: 50%;
				transform: translate(-50%, -50%);
				width: 20%;
				flex: none;
				display: block;
				min-height: 0;
			}

			img,
			svg {
				max-width: 35%;
				max-height: 100%;
				object-fit: contain;

				@include breakpoint(desktop) {
					width: 100%;
					max-width: 100%;
					height: auto;
					max-height: none;
					transform: scale(var(--icon-scale, 1));
				}

				// Partner logos ship at very different intrinsic sizes, so a plain
				// max-width leaves the small SVGs tiny. Drive every logo off a
				// uniform height (~the design's share of the card) so the set scales
				// in step with the card and reads consistently on tablet/phone.
				@include breakpoint(not-desktop) {
					width: auto;
					max-width: 60%;
					height: 42%;
					max-height: 42%;
				}
			}

			&-inner {
				display: flex;
				align-items: center;
				justify-content: center;
				width: 100%;
				height: 100%;
				transform: translate3d(var(--img-shift-x), var(--img-shift-y), var(--img-z))
					scale(var(--img-scale));
				transition: transform 520ms cubic-bezier(0.16, 1, 0.3, 1);
				will-change: transform;

				@include breakpoint(desktop) {
					height: auto;
				}
			}
		}

		&.is-hovering {
			transition: none;
			box-shadow:
				0 1px 0 rgba(255, 255, 255, 0.08) inset,
				0 0 0 1px rgba(255, 255, 255, 0.05),
				0 30px 64px rgba(7, 10, 18, 0.32),
				0 14px 30px rgba(230, 71, 73, 0.12);
		}

		&.is-pressing {
			--press-scale: 0.975;
		}

		&.is-releasing {
			transition:
				transform 300ms cubic-bezier(0.16, 1, 0.3, 1),
				box-shadow 300ms cubic-bezier(0.16, 1, 0.3, 1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card,
		.card__icon-inner,
		.card::before,
		.card::after {
			transition: none;
		}
	}
</style>
