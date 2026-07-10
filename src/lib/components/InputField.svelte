<script lang="ts">
	import { ctaResonance } from '$lib/utils/actions/ctaResonance';

	let {
		value = $bindable(),
		oninput,
		id,
		name,
		required,
		label,
		placeholder,
		type,
		hasError = false
	} = $props();
</script>

<div
	class="input-field"
	class:has-error={hasError}
	use:ctaResonance={{ maxShift: 4.5, maxRotate: 1.4, maxGlow: 0.14 }}
>
	<label class="text-sm" for={id}>{label}</label>
	<input
		class="text-base"
		{id}
		{name}
		{type}
		{placeholder}
		bind:value
		{required}
		{oninput}
	/>
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.input-field {
		--cta-shift-x: 0px;
		--cta-shift-y: 0px;
		--cta-scale: 1;
		--cta-tilt-x: 0deg;
		--cta-tilt-y: 0deg;
		--cta-pointer-x: 50%;
		--cta-pointer-y: 50%;
		--cta-glow-alpha: 0;
		--field-lift: 0px;
		position: relative;
		display: flex;
		width: 100%;
		min-width: 0;
		min-height: 3.5rem;
		flex-direction: column;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.375rem 1rem;
		border-radius: 4px;
		border: 1px solid rgba($color-grey-300, 0.3);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0)),
			rgb(43 44 48 / 80%);
		backdrop-filter: blur(5px);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			0 10px 24px rgba(0, 0, 0, 0);
		transition:
			border-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
			background 220ms cubic-bezier(0.22, 1, 0.36, 1),
			box-shadow 420ms cubic-bezier(0.16, 1, 0.3, 1),
			transform 420ms cubic-bezier(0.16, 1, 0.3, 1);
		overflow: hidden;
		transform: perspective(900px)
			translate3d(
				calc(var(--cta-shift-x) * 0.55),
				calc(var(--field-lift) + var(--cta-shift-y) * 0.55),
				0
			)
			rotateX(var(--cta-tilt-x)) rotateY(var(--cta-tilt-y)) scale(var(--cta-scale));

		@include breakpoint(phone) {
			padding: 0.6rem 0.8rem;
			gap: 0.25rem;
		}

		@include breakpoint(small-phone) {
			padding: 0.4rem 0.6rem;
		}

		&::before {
			content: '';
			position: absolute;
			inset: -1px;
			border-radius: inherit;
			background: linear-gradient(
				120deg,
				rgba(255, 255, 255, 0) 0%,
				rgba(255, 255, 255, 0.14) 28%,
				rgba(193, 202, 222, 0.18) 55%,
				rgba(255, 255, 255, 0) 100%
			);
			opacity: 0;
			transform: translateX(-22%) scale(0.98);
			transform-origin: center;
			transition:
				opacity 280ms cubic-bezier(0.22, 1, 0.36, 1),
				transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
			pointer-events: none;
		}

		&::after {
			content: '';
			position: absolute;
			inset: -18%;
			border-radius: inherit;
			background: radial-gradient(
				18rem circle at var(--cta-pointer-x) var(--cta-pointer-y),
				rgba(193, 202, 222, calc(var(--cta-glow-alpha) * 1.2)) 0%,
				rgba(193, 202, 222, calc(var(--cta-glow-alpha) * 0.28)) 22%,
				rgba(193, 202, 222, 0) 62%
			);
			mix-blend-mode: screen;
			opacity: calc(var(--cta-glow-alpha) * 2.2);
			transform: translate3d(calc(var(--cta-shift-x) * -0.2), calc(var(--cta-shift-y) * -0.2), 0);
			transition:
				opacity 360ms cubic-bezier(0.16, 1, 0.3, 1),
				transform 420ms cubic-bezier(0.16, 1, 0.3, 1);
			pointer-events: none;
		}

		label {
			color: rgba($color-grey-300, 0.5);
			font-size: 0.875rem;
			line-height: 1;
			word-spacing: $word-spacing;
			transition:
				color 220ms cubic-bezier(0.22, 1, 0.36, 1),
				transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
				opacity 220ms cubic-bezier(0.22, 1, 0.36, 1);
		}

		input {
			background: transparent;
			color: #fff;
			border: none;
			outline: none;
			word-spacing: $word-spacing;
			transition:
				color 180ms ease,
				transform 360ms cubic-bezier(0.16, 1, 0.3, 1);

			@include breakpoint(small-phone) {
				font-size: 0.8rem;
			}

			transform: translate3d(calc(var(--cta-shift-x) * 0.08), calc(var(--cta-shift-y) * 0.08), 0);

			&::placeholder {
				color: #a8aebc;
			}
		}

		@media (hover: hover) and (pointer: fine) {
			&:hover {
				--field-lift: -1px;
				border-color: rgba($color-grey-300, 0.44);
				background:
					linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0)),
					rgba(43, 44, 48, 0.88);
				box-shadow:
					inset 0 1px 0 rgba(255, 255, 255, 0.06),
					0 10px 24px rgba(0, 0, 0, 0.14);

				&::before {
					opacity: 0.72;
					transform: translateX(-8%) scale(0.995);
				}

				label {
					color: rgba(255, 255, 255, 0.78);
				}

				input {
					transform: translate3d(
						calc(1px + var(--cta-shift-x) * 0.08),
						calc(var(--cta-shift-y) * 0.08),
						0
					);
				}
			}
		}

		&:focus-within {
			--field-lift: -1px;
			border-color: rgba(193, 202, 222, 0.55);
			background:
				linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0)),
				rgba(43, 44, 48, 0.92);
			box-shadow:
				inset 0 1px 0 rgba(255, 255, 255, 0.07),
				0 0 0 1px rgba(193, 202, 222, 0.2),
				0 14px 30px rgba(0, 0, 0, 0.18),
				0 10px 24px rgba(193, 202, 222, 0.1);

			&::before {
				opacity: 1;
				transform: translateX(0) scale(1);
			}

			label {
				color: rgba(255, 255, 255, 0.9);
				transform: translateY(-1px);
			}

			input {
				transform: translate3d(
					calc(1px + var(--cta-shift-x) * 0.08),
					calc(var(--cta-shift-y) * 0.08),
					0
				);
			}
		}
	}

	.input-field.has-error {
		border-color: rgba(#e64749, 0.55);

		label,
		input {
			color: #e64749;
		}

		&:focus-within {
			box-shadow:
				inset 0 1px 0 rgba(255, 255, 255, 0.04),
				0 0 0 1px rgba(#e64749, 0.24),
				0 14px 30px rgba(230, 71, 73, 0.12);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.input-field,
		.input-field::before,
		.input-field label,
		.input-field input {
			transition: none;
			transform: none;
		}
	}
</style>
