<script lang="ts">
	import { ctaResonance } from '$lib/utils/actions/ctaResonance';

	let { label, placeholder, value = $bindable(), id, name, required, oninput } = $props();
</script>

<div
	class="textarea-field"
	use:ctaResonance={{ maxShift: 4.5, maxRotate: 1.3, maxGlow: 0.14 }}
>
	<label for={id}>{label}</label>
	<textarea class="textarea" {id} {name} {placeholder} bind:value {required} {oninput}>
		{value}
	</textarea>
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.textarea-field {
		--cta-shift-x: 0px;
		--cta-shift-y: 0px;
		--cta-scale: 1;
		--cta-tilt-x: 0deg;
		--cta-tilt-y: 0deg;
		--cta-pointer-x: 50%;
		--cta-pointer-y: 50%;
		--cta-glow-alpha: 0;
		--field-lift: 0px;
		color: $color-grey-300;
		position: relative;
		width: 100%;
		padding: 0.8rem 1rem;
		border-radius: 4px;
		border: 1px solid rgba($color-grey-300, 0.3);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0)),
			rgb(43 44 48 / 80%);
		backdrop-filter: blur(5px);

		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		height: 13.68rem;
		overflow: hidden;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			0 10px 24px rgba(0, 0, 0, 0);
		transition:
			border-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
			background 220ms cubic-bezier(0.22, 1, 0.36, 1),
			box-shadow 420ms cubic-bezier(0.16, 1, 0.3, 1),
			transform 420ms cubic-bezier(0.16, 1, 0.3, 1);
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
			height: 7.5rem;
		}

		@include breakpoint(small-phone) {
			height: 6rem;
			overflow: hidden;
			scrollbar-width: none;

			&::-webkit-scrollbar {
				display: none;
			}
		}

		label {
			color: rgba($color-grey-300, 0.5);
			font-size: 0.75rem;
			margin-bottom: 0.1rem;
			word-spacing: $word-spacing;
			transition:
				color 220ms cubic-bezier(0.22, 1, 0.36, 1),
				transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
				opacity 220ms cubic-bezier(0.22, 1, 0.36, 1);
		}

		textarea {
			resize: none;
			background: transparent;
			color: #fff;
			border: none;
			outline: none;
			flex: 1 1 auto;
			word-spacing: $word-spacing;
			transition:
				color 180ms ease,
				transform 360ms cubic-bezier(0.16, 1, 0.3, 1);
			transform: translate3d(calc(var(--cta-shift-x) * 0.08), calc(var(--cta-shift-y) * 0.08), 0);
			&::placeholder {
				color: $color-grey-300;
			}
		}

		&::before {
			content: '';
			position: absolute;
			inset: -1px;
			border-radius: inherit;
			background: linear-gradient(
				120deg,
				rgba(255, 255, 255, 0) 0%,
				rgba(255, 255, 255, 0.12) 28%,
				rgba(193, 202, 222, 0.18) 55%,
				rgba(255, 255, 255, 0) 100%
			);
			opacity: 0;
			transform: translateX(-22%) scale(0.98);
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

				textarea {
					transform: translate3d(calc(1px + var(--cta-shift-x) * 0.08), calc(var(--cta-shift-y) * 0.08), 0);
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

			textarea {
				transform: translate3d(calc(1px + var(--cta-shift-x) * 0.08), calc(var(--cta-shift-y) * 0.08), 0);
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.textarea-field,
		.textarea-field::before,
		.textarea-field::after,
		.textarea-field label,
		.textarea-field textarea {
			transition: none;
			transform: none;
		}
	}
</style>
