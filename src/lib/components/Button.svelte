<script lang="ts">
	import { hoverSound } from '$lib/utils/hoverSound';
	import { updateDirectionalFillPosition } from '$lib/utils/actions/directionalFill';
	import { ctaResonance } from '$lib/utils/actions/ctaResonance';

	type ButtonType = 'link' | 'submit' | 'button';

	let {
		label = '',
		href = '',
		color = '',
		type = 'link' as ButtonType,
		className = '',
		vertical = false,
		revealed = false,
		showIcon = false,
		disabled = false,
		onclick = undefined,
		ontouchstart = undefined,
		...restProps
	} = $props();

	const GLITCH_RUN_CLASS = 'glitch--run';
	function runGlitch(event: MouseEvent) {
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;

		target.classList.remove(GLITCH_RUN_CLASS);
		// Force reflow so a new hover can restart the same animation immediately.
		void target.offsetWidth;
		target.classList.add(GLITCH_RUN_CLASS);
	}

	function clearGlitchClass(event: AnimationEvent) {
		if (event.animationName !== 'glitch') return;
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;
		target.classList.remove(GLITCH_RUN_CLASS);
	}

	function updateDirectionalHover(event: MouseEvent) {
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;
		updateDirectionalFillPosition(target, event);
	}

	function handleMouseEnter(event: MouseEvent) {
		if (disabled) return;
		updateDirectionalHover(event);
		runGlitch(event);
	}

	function handleMouseLeave(event: MouseEvent) {
		if (disabled) return;
		updateDirectionalHover(event);
	}

	function getButtonStyle() {
		return `--glitch-bg: ${color === 'red' ? 'white' : '#e64749'};`;
	}
</script>

{#if type === 'link'}
	<a
		use:hoverSound
		use:ctaResonance
		class={`button glitch glitch-vertical ${className}`}
		class:button--red={color === 'red'}
			class:button--vertical={vertical}
			class:button--vertical-revealed={revealed}
			aria-disabled={disabled}
			onmouseenter={handleMouseEnter}
			onmouseleave={handleMouseLeave}
			onanimationend={clearGlitchClass}
			{onclick}
			{ontouchstart}
			style={getButtonStyle()}
			href={disabled ? undefined : href}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		<span class="button__bg"></span>
		<span class="button__circle-wrap" aria-hidden="true">
			<span class="button__circle"></span>
		</span>
		<span class="button__content">
			<span>{label}</span>
			{#if showIcon}
				<svg viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M10.62 0.5H12.38V22.5H10.62V0.5Z" fill="currentColor" />
					<path d="M22.5 10.62V12.38L0.5 12.38L0.5 10.62L22.5 10.62Z" fill="currentColor" />
					<path
						d="M7.76645 11.06L11.5 7.32648L15.2335 11.06L11.5 14.7935L7.76645 11.06Z"
						fill="currentColor"
					/>
				</svg>
			{/if}
		</span>
	</a>
{:else}
	<button
		use:hoverSound
		use:ctaResonance
		class={`button glitch glitch-vertical ${className}`}
		class:button--red={color === 'red'}
			class:button--vertical={vertical}
			class:button--vertical-revealed={revealed}
			{disabled}
			type={type === 'submit' ? 'submit' : 'button'}
			onmouseenter={handleMouseEnter}
			onmouseleave={handleMouseLeave}
			onanimationend={clearGlitchClass}
			{onclick}
			{ontouchstart}
			style={getButtonStyle()}
			{...restProps}
	>
		<span class="button__bg"></span>
		<span class="button__circle-wrap" aria-hidden="true">
			<span class="button__circle"></span>
		</span>
		<span class="button__content">
			<span>{label}</span>
			{#if showIcon}
				<svg viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M10.62 0.5H12.38V22.5H10.62V0.5Z" fill="currentColor" />
					<path d="M22.5 10.62V12.38L0.5 12.38L0.5 10.62L22.5 10.62Z" fill="currentColor" />
					<path
						d="M7.76645 11.06L11.5 7.32648L15.2335 11.06L11.5 14.7935L7.76645 11.06Z"
						fill="currentColor"
					/>
				</svg>
			{/if}
		</span>
	</button
	>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.button {
		--button-bg: #{$color-dark};
		--button-accent: #{$color-red};
		--button-text: #fff;
		--button-text-hover: #{$color-dark};
		--button-circle-x: 50%;
		--button-circle-y: 50%;
		--button-circle-size: 160px;
		--button-enter-y: 0px;
		--cta-shift-x: 0px;
		--cta-shift-y: 0px;
		--cta-scale: 1;
		--cta-tilt-x: 0deg;
		--cta-tilt-y: 0deg;
		--cta-pointer-x: 50%;
		--cta-pointer-y: 50%;
		--cta-glow-alpha: 0;

		padding: 1rem 0;
		width: 100%;
		border: 0;
		background: transparent;
		color: var(--button-text);
		clip-path: $clip;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		isolation: isolate;
		overflow: hidden;
		cursor: pointer;
		transform-style: preserve-3d;
		will-change: transform;
		transition:
			color 320ms var(--motion-ease-standard),
			transform 420ms cubic-bezier(0.16, 1, 0.3, 1),
			box-shadow 420ms cubic-bezier(0.16, 1, 0.3, 1),
			filter 420ms cubic-bezier(0.16, 1, 0.3, 1);
		transform: translate3d(
				var(--cta-shift-x),
				calc(var(--button-enter-y) + var(--cta-shift-y)),
				0
			)
			rotateX(var(--cta-tilt-x)) rotateY(var(--cta-tilt-y))
			scale(var(--cta-scale));
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.06) inset,
			0 0 0 1px rgba(255, 255, 255, 0.04),
			0 18px 34px rgba(6, 8, 12, 0.2);
		filter: saturate(1);

		&::after {
			content: '';
			position: absolute;
			inset: -18%;
			z-index: 1;
			pointer-events: none;
			background:
				radial-gradient(
					18rem circle at var(--cta-pointer-x) var(--cta-pointer-y),
					rgba(255, 255, 255, calc(var(--cta-glow-alpha) * 1.45)) 0%,
					rgba(255, 255, 255, calc(var(--cta-glow-alpha) * 0.42)) 18%,
					rgba(255, 255, 255, 0) 52%
				),
				linear-gradient(
					120deg,
					rgba(255, 255, 255, 0.1) 4%,
					rgba(255, 255, 255, 0.02) 28%,
					rgba(255, 255, 255, 0.14) 54%,
					rgba(255, 255, 255, 0) 76%
				);
			mix-blend-mode: screen;
			opacity: calc(0.08 + var(--cta-glow-alpha) * 1.8);
			transform: translate3d(calc(var(--cta-shift-x) * -0.24), calc(var(--cta-shift-y) * -0.24), 0);
			transition:
				opacity 360ms cubic-bezier(0.16, 1, 0.3, 1),
				transform 420ms cubic-bezier(0.16, 1, 0.3, 1);
		}

		&--red {
			--button-bg: #{$color-red};
			--button-accent: #fff;
		}

		&--vertical {
			border: none;
			outline: none;
			padding: 1.4rem 1.25rem 1.9rem 1.25rem;
			margin: 0;
			font-size: 1.1rem;
			font-family: inherit;
			gap: 1rem;
			writing-mode: vertical-rl;
			text-orientation: mixed;
			width: 3.5rem;
			opacity: 0;
			--button-enter-y: -110%;
			transition:
				transform 760ms cubic-bezier(0.16, 1, 0.3, 1) 0.14s,
				opacity 760ms cubic-bezier(0.16, 1, 0.3, 1) 0.14s;

			.button__content > span {
				transform: scale(-1, -1);
				writing-mode: unset;
			}

			.button__content svg {
				width: 1.4rem;
				height: 1.4rem;
				color: currentColor;
			}

			@media (hover: hover) and (pointer: fine) {
				&:hover svg {
					transform: rotate(90deg);
					transition: transform var(--motion-duration-fast) var(--motion-ease-standard);
				}
			}
		}

		&--vertical-revealed {
			opacity: 1;
			--button-enter-y: 0px;
		}

		&:global(.cta-resonance--active) {
			box-shadow:
				0 1px 0 rgba(255, 255, 255, 0.08) inset,
				0 0 0 1px rgba(255, 255, 255, 0.06),
				0 24px 46px rgba(8, 10, 16, 0.32),
				0 12px 30px rgba(230, 71, 73, 0.16);
			filter: saturate(1.08);
		}

		&:global(.cta-resonance--pressed) {
			box-shadow:
				0 1px 0 rgba(255, 255, 255, 0.05) inset,
				0 0 0 1px rgba(255, 255, 255, 0.05),
				0 12px 24px rgba(8, 10, 16, 0.22);
		}

		&[aria-disabled='true'],
		&:disabled {
			cursor: not-allowed;
			opacity: 0.7;
		}

		@media (hover: hover) and (pointer: fine) {
			&:not([aria-disabled='true']):not(:disabled):hover,
			&:not([aria-disabled='true']):not(:disabled):focus-visible {
				color: var(--button-text-hover);

				.button__circle {
					transform: translate(-50%, -50%) scale(1);
				}

				.button__content {
					transform: translate3d(
						calc(var(--cta-shift-x) * 0.12),
						calc(var(--cta-shift-y) * 0.12),
						22px
					);
				}

				.button__content svg {
					transform: translate3d(0.18rem, 0, 0) rotate(90deg);
				}
			}
		}

		span {
			text-decoration: none;
		}
	}

	.button__bg,
	.button__circle-wrap {
		position: absolute;
		inset: 0;
	}

	.button__bg {
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0) 38%),
			linear-gradient(135deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0) 56%),
			var(--button-bg);
		z-index: 0;
	}

	.button__circle-wrap {
		overflow: hidden;
		z-index: 2;
	}

	.button__circle {
		position: absolute;
		top: var(--button-circle-y);
		left: var(--button-circle-x);
		width: var(--button-circle-size);
		height: var(--button-circle-size);
		border-radius: 999px;
		background: var(--button-accent);
		transform: translate(-50%, -50%) scale(0);
		transform-origin: center;
		transition:
			transform 0.9s cubic-bezier(0.16, 1, 0.3, 1),
			width 0.9s cubic-bezier(0.16, 1, 0.3, 1),
			height 0.9s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.button__content {
		position: relative;
		z-index: 3;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		gap: 0.7rem;
		padding: 0 1.25rem;
		transition:
			color 320ms var(--motion-ease-standard),
			transform 420ms cubic-bezier(0.16, 1, 0.3, 1);
		transform: translate3d(
			calc(var(--cta-shift-x) * 0.08),
			calc(var(--cta-shift-y) * 0.08),
			18px
		);
	}

	.button__content > span {
		color: currentColor;
		position: relative;
		z-index: 1;
	}

	.button__content svg {
		position: relative;
		z-index: 1;
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		transition: transform 420ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	@media (prefers-reduced-motion: reduce) {
		.button,
		.button__circle,
		.button__content,
		.button__content svg {
			transition-duration: 0.01ms !important;
			animation-duration: 0.01ms !important;
		}
	}

</style>
