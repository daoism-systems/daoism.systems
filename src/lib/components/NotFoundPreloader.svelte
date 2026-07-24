<script lang="ts">
	import { onMount } from 'svelte';
	import { EASINGS } from '$lib/utils/animations/constants/easings';
	import { headingReveal } from '$lib/utils/animations/headingReveal';

	const frames = Array.from(
		{ length: 9 },
		(_, index) => `/images/404-preloader/frame-${String(index + 1).padStart(2, '0')}.png`
	);
	const phrase = 'Do nothing, and the brutalist mass will settle.';
	const minimumVisibleDuration = 4000;
	const frameInterval = 1000 / 3;
	const progressPerSecond = 30;
	const dominoOverlap = 50;
	const artRevealDelay = 120;
	const artRevealDuration = 720;
	const progressRevealDelay = artRevealDelay + artRevealDuration / 4;
	const progressRevealDuration = 560;
	const phraseRevealDelay = progressRevealDelay + progressRevealDuration / 100;
	const phraseRevealDuration = 0.42;
	const phraseRevealStagger = 0.006;
	const frameCycleDelay = artRevealDelay + artRevealDuration;
	const entranceDuration = 2000;
	const artRevealDelayCss = `${artRevealDelay}ms`;
	const artRevealDurationCss = `${artRevealDuration}ms`;
	const progressRevealDelayCss = `${progressRevealDelay}ms`;
	const progressRevealDurationCss = `${progressRevealDuration}ms`;

	let {
		progress = 0,
		ready = false,
		onDismissed
	}: { progress?: number; ready?: boolean; onDismissed?: () => void } = $props();
	let frameIndex = $state(0);
	let phraseRevealReady = $state(false);
	let entranceComplete = $state(false);
	let minimumDurationElapsed = $state(false);
	let displayedProgress = $state(0);
	let dismissalNotified = false;
	let canDismiss = $derived(
		ready && minimumDurationElapsed && entranceComplete && displayedProgress === 100
	);
	let phraseRevealOptions = $derived({
		trigger: phraseRevealReady,
		duration: phraseRevealDuration,
		stagger: phraseRevealStagger
	});

	onMount(() => {
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		let animatedProgress = 0;
		let previousFrameTime = performance.now();
		let progressAnimationFrame = 0;
		const phraseTimer = window.setTimeout(
			() => (phraseRevealReady = true),
			reducedMotion ? 0 : phraseRevealDelay
		);
		const entranceTimer = window.setTimeout(
			() => (entranceComplete = true),
			reducedMotion ? 0 : entranceDuration
		);
		const minimumDurationTimer = window.setTimeout(
			() => (minimumDurationElapsed = true),
			minimumVisibleDuration
		);
		let frameTimer: number | undefined;

		const advanceFrame = () => {
			frameIndex = (frameIndex + 1) % frames.length;
			frameTimer = window.setTimeout(advanceFrame, frameInterval);
		};

		if (!reducedMotion) {
			frameTimer = window.setTimeout(advanceFrame, frameCycleDelay);
		}

		const animateProgress = (currentFrameTime: number) => {
			const elapsed = Math.min(currentFrameTime - previousFrameTime, 1000 / progressPerSecond);
			const targetProgress = ready ? 100 : Math.min(99, Math.max(0, progress));

			animatedProgress = Math.min(
				targetProgress,
				animatedProgress + (elapsed / 1000) * progressPerSecond
			);
			displayedProgress = Math.floor(animatedProgress);
			previousFrameTime = currentFrameTime;
			progressAnimationFrame = window.requestAnimationFrame(animateProgress);
		};

		progressAnimationFrame = window.requestAnimationFrame(animateProgress);

		return () => {
			window.clearTimeout(phraseTimer);
			window.clearTimeout(entranceTimer);
			window.clearTimeout(minimumDurationTimer);
			if (frameTimer !== undefined) window.clearTimeout(frameTimer);
			window.cancelAnimationFrame(progressAnimationFrame);
		};
	});

	function handleTransitionEnd(event: TransitionEvent) {
		if (
			dismissalNotified ||
			!canDismiss ||
			event.target !== event.currentTarget ||
			event.propertyName !== 'opacity'
		) {
			return;
		}

		dismissalNotified = true;
		onDismissed?.();
	}
</script>

<div
	class="not-found-preloader"
	class:not-found-preloader--entering={!entranceComplete}
	class:not-found-preloader--complete={canDismiss}
	style:--not-found-reveal-ease={EASINGS.EASE_CUSTOM_REVEAL}
	style:--not-found-art-reveal-delay={artRevealDelayCss}
	style:--not-found-art-reveal-duration={artRevealDurationCss}
	style:--not-found-progress-reveal-delay={progressRevealDelayCss}
	style:--not-found-progress-reveal-duration={progressRevealDurationCss}
	role="status"
	aria-live="polite"
	aria-label={`Loading the 404 experience: ${displayedProgress}%`}
	ontransitionend={handleTransitionEnd}
>
	<!-- <div class="not-found-preloader__mobile-header" aria-hidden="true">
		<img src="/icons/logo.svg" alt="" />
		<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M8 8H12.2667V12.2667H8V8Z" fill="currentColor" />
			<path d="M8 19.7333H12.2667V24H8V19.7333Z" fill="currentColor" />
			<path d="M19.7333 8H24V12.2667H19.7333V8Z" fill="currentColor" />
			<path d="M19.7333 19.7333H24V24H19.7333V19.7333Z" fill="currentColor" />
		</svg>
	</div> -->

	<div class="not-found-preloader__art" aria-hidden="true">
		<svg
			class="not-found-preloader__ring not-found-preloader__ring--outer"
			viewBox="0 0 561.166 561.166"
			fill="none"
		>
			<circle
				class="not-found-preloader__ring-line"
				cx="280.583"
				cy="280.583"
				r="279.918"
				pathLength="1"
				stroke="url(#not-found-ring-gradient-outer)"
				stroke-width="1.33041"
			/>
			<defs>
				<linearGradient
					id="not-found-ring-gradient-outer"
					x1="280.583"
					y1="110.39"
					x2="280.583"
					y2="452.978"
					gradientUnits="userSpaceOnUse"
				>
					<stop stop-color="white" stop-opacity="0" />
					<stop offset="0.5" stop-color="white" />
					<stop offset="1" stop-color="white" stop-opacity="0" />
				</linearGradient>
			</defs>
		</svg>
		<svg
			class="not-found-preloader__ring not-found-preloader__ring--inner"
			viewBox="0 0 360.332 360.332"
			fill="none"
		>
			<circle
				class="not-found-preloader__ring-line"
				cx="180.166"
				cy="180.166"
				r="179.501"
				pathLength="1"
				stroke="url(#not-found-ring-gradient-inner)"
				stroke-width="1.33041"
			/>
			<defs>
				<linearGradient
					id="not-found-ring-gradient-inner"
					x1="359.667"
					y1="180.166"
					x2="0.665199"
					y2="180.166"
					gradientUnits="userSpaceOnUse"
				>
					<stop stop-color="white" stop-opacity="0" />
					<stop offset="0.5" stop-color="white" />
					<stop offset="1" stop-color="white" stop-opacity="0" />
				</linearGradient>
			</defs>
		</svg>

		<div class="not-found-preloader__frames">
			{#each frames as frame, index}
				<img class:active={index === frameIndex} src={frame} alt="" />
			{/each}
		</div>
	</div>

	<span class="not-found-preloader__progress">{displayedProgress}%</span>
	<p
		class="not-found-preloader__phrase"
		class:not-found-preloader__phrase--ready={phraseRevealReady}
		use:headingReveal={phraseRevealOptions}
	>
		<span class="text-line">{phrase}</span>
	</p>
</div>

<style lang="scss">
	.not-found-preloader {
		--art-image-size: 130px;
		--inner-ring-size: 360.332px;
		--outer-ring-size: 561.166px;
		--inner-ring-rotation: -30deg;

		position: fixed;
		inset: 0;
		z-index: 10000;
		overflow: hidden;
		background: #000;
		color: #fff;
		font-family: 'IBM Plex Mono', monospace;
		font-weight: 400;
		word-spacing: normal;
		pointer-events: none;
		opacity: 1;
		visibility: visible;
		transition:
			opacity 500ms cubic-bezier(0.22, 1, 0.36, 1),
			visibility 0s linear;

		&--entering &__mobile-header,
		&--entering &__progress {
			will-change: opacity, transform, filter;
		}

		&--entering &__ring-line {
			will-change: opacity;
		}

		&--entering &__frames {
			will-change: opacity, transform, filter;
		}

		&--complete {
			opacity: 0;
			visibility: hidden;
			transition:
				opacity 500ms cubic-bezier(0.22, 1, 0.36, 1),
				visibility 0s linear 500ms;
		}

		&__mobile-header {
			display: none;
			opacity: 0;
			filter: blur(8px);
			transform: translate3d(0, -12px, 0);
			animation: not-found-header-reveal 760ms var(--not-found-reveal-ease) 180ms forwards;
		}

		&__art {
			position: absolute;
			top: 50%;
			left: 50%;
			width: 0;
			height: 0;
		}

		&__ring,
		&__frames {
			position: absolute;
			top: 0;
			left: 0;
			transform: translate(-50%, -50%);
		}

		&__ring {
			max-width: none;
			mix-blend-mode: difference;
			transform-origin: center;
			will-change: transform;

			&-line {
				opacity: 0;
				animation: not-found-ring-line-reveal var(--not-found-art-reveal-duration)
					var(--not-found-reveal-ease) var(--not-found-art-reveal-delay) forwards;
			}

			&--outer {
				--ring-rotation: 0deg;

				width: var(--outer-ring-size);
				height: var(--outer-ring-size);
				animation: not-found-ring-spin-clockwise 6s linear infinite;
			}

			&--inner {
				--ring-rotation: var(--inner-ring-rotation);

				width: var(--inner-ring-size);
				height: var(--inner-ring-size);
				animation: not-found-ring-spin-counterclockwise 4s linear infinite;
			}
		}

		&__frames {
			width: var(--art-image-size);
			height: var(--art-image-size);
			overflow: hidden;
			opacity: 0;
			filter: blur(8px);
			transform: translate(-50%, calc(-50% + 24px)) scale(0.92);
			animation: not-found-image-reveal var(--not-found-art-reveal-duration)
				var(--not-found-reveal-ease) var(--not-found-art-reveal-delay) forwards;

			img {
				position: absolute;
				top: 50%;
				left: 50%;
				width: 100%;
				height: 100%;
				transform: translate(-50%, -50%) scale(1.025);
				opacity: 0;
				filter: blur(3px);
				transition:
					opacity 80ms linear,
					filter 80ms linear,
					transform 100ms linear;
			}

			img.active {
				opacity: 1;
				filter: blur(0);
				transform: translate(-50%, -50%) scale(1);
			}
		}

		&__progress {
			position: absolute;
			top: 86.5%;
			left: 50%;
			transform: translate(-50%, -50%);
			font-size: 18px;
			line-height: 1;
			opacity: 0;
			filter: blur(8px);
			animation: not-found-progress-reveal var(--not-found-progress-reveal-duration)
				var(--not-found-reveal-ease) var(--not-found-progress-reveal-delay) forwards;
		}

		p {
			position: absolute;
			right: 20px;
			bottom: 40px;
			left: 20px;
			margin: 0;
			color: #a8aebc;
			font-size: 15.623px;
			line-height: 100%;
			text-align: center;

			.text-line {
				display: block;
			}
		}

		&__phrase {
			opacity: 0;

			&--ready {
				opacity: 1;
			}
		}
	}

	@media (max-width: 767px) {
		.not-found-preloader {
			--art-image-size: 98px;
			--inner-ring-size: min(271.616px, 58.79vw);
			--outer-ring-size: min(423.003px, 91.56vw);
			--inner-ring-rotation: -90deg;

			&__mobile-header {
				position: absolute;
				top: 0;
				left: 0;
				display: flex;
				align-items: center;
				justify-content: space-between;
				width: 100%;
				height: 62.493px;
				padding: 0 11.159px;
				box-sizing: border-box;
				mix-blend-mode: difference;

				img {
					width: 121.227px;
					height: 35.71px;
				}

				svg {
					width: 35.71px;
					height: 35.71px;
				}
			}

			&__progress {
				top: 79.5%;
			}

			p {
				bottom: 40px;
				font-size: 14px;
			}
		}
	}

	@media (max-width: 438px) {
		.not-found-preloader p {
			right: 12px;
			left: 12px;
			font-size: 12px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.not-found-preloader {
			transition-duration: 1ms;

			&--complete {
				transition-duration: 1ms;
				transition-delay: 0s;
			}

			&__ring {
				opacity: 1;
				animation: none;
			}

			&__mobile-header,
			&__art,
			&__frames,
			&__progress {
				opacity: 1;
				filter: none;
				animation: none;
			}

			&__mobile-header,
			&__art {
				transform: none;
			}

			&__progress {
				transform: translate(-50%, -50%);
			}

			&__frames {
				transform: translate(-50%, -50%);
			}

			&__ring-line {
				opacity: 0.5;
				animation: none;
			}

			&__ring--outer {
				transform: translate(-50%, -50%) rotate(0deg);
			}

			&__ring--inner {
				transform: translate(-50%, -50%) rotate(var(--inner-ring-rotation));
			}

			&__frames img,
			p {
				transition: none;
			}
		}
	}

	@keyframes not-found-header-reveal {
		to {
			opacity: 1;
			filter: blur(0);
			transform: translate3d(0, 0, 0);
		}
	}

	@keyframes not-found-ring-line-reveal {
		to {
			opacity: 0.5;
		}
	}

	@keyframes not-found-image-reveal {
		to {
			opacity: 1;
			filter: blur(0);
			transform: translate(-50%, -50%) scale(1);
		}
	}

	@keyframes not-found-progress-reveal {
		to {
			opacity: 1;
			filter: blur(0);
			transform: translate(-50%, -50%);
		}
	}

	@keyframes not-found-ring-spin-clockwise {
		from {
			transform: translate(-50%, -50%) rotate(var(--ring-rotation));
		}

		to {
			transform: translate(-50%, -50%) rotate(calc(var(--ring-rotation) + 360deg));
		}
	}

	@keyframes not-found-ring-spin-counterclockwise {
		from {
			transform: translate(-50%, -50%) rotate(var(--ring-rotation));
		}

		to {
			transform: translate(-50%, -50%) rotate(calc(var(--ring-rotation) - 360deg));
		}
	}
</style>
