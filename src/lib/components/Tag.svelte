<script lang="ts">
	import { ctaResonance } from '$lib/utils/actions/ctaResonance';

	export let text: string;
	export let action: ((node: HTMLElement, params: any) => { destroy?: () => void }) | null = null;
	export let actionParams: any = undefined;
</script>

{#if action}
	<div
		class="label text-sm min-[2245px]:!text-xl"
		use:ctaResonance={{ maxShift: 3.5, maxRotate: 1.4, maxGlow: 0.12 }}
		use:action={actionParams}
	>
		{text}
	</div>
{:else}
	<div
		class="label text-sm min-[2245px]:!text-xl"
		use:ctaResonance={{ maxShift: 3.5, maxRotate: 1.4, maxGlow: 0.12 }}
	>
		{text}
	</div>
{/if}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.label {
		--cta-shift-x: 0px;
		--cta-shift-y: 0px;
		--cta-scale: 1;
		--cta-tilt-x: 0deg;
		--cta-tilt-y: 0deg;
		--cta-pointer-x: 50%;
		--cta-pointer-y: 50%;
		--cta-glow-alpha: 0;
		color: #fff;
		position: relative;
		padding: 0.35rem 1rem;
		width: fit-content;
		background: $color-grey-600;
		border-radius: 4px;
		margin-bottom: 1rem;
		overflow: hidden;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			0 0 0 1px rgba(255, 255, 255, 0.03),
			0 12px 24px rgba(7, 10, 18, 0.12);
		transform: perspective(760px)
			translate3d(calc(var(--cta-shift-x) * 0.48), calc(var(--cta-shift-y) * 0.48), 0)
			rotateX(var(--cta-tilt-x)) rotateY(var(--cta-tilt-y)) scale(var(--cta-scale));
		transition:
			transform 420ms cubic-bezier(0.16, 1, 0.3, 1),
			box-shadow 420ms cubic-bezier(0.16, 1, 0.3, 1),
			background 320ms cubic-bezier(0.16, 1, 0.3, 1);

		&::before {
			content: '';
			position: absolute;
			inset: -24%;
			background: radial-gradient(
				12rem circle at var(--cta-pointer-x) var(--cta-pointer-y),
				rgba(255, 255, 255, calc(var(--cta-glow-alpha) * 1.2)) 0%,
				rgba(255, 255, 255, calc(var(--cta-glow-alpha) * 0.22)) 22%,
				rgba(255, 255, 255, 0) 62%
			);
			mix-blend-mode: screen;
			opacity: calc(var(--cta-glow-alpha) * 2.3);
			transform: translate3d(calc(var(--cta-shift-x) * -0.2), calc(var(--cta-shift-y) * -0.2), 0);
			transition:
				opacity 360ms cubic-bezier(0.16, 1, 0.3, 1),
				transform 420ms cubic-bezier(0.16, 1, 0.3, 1);
			pointer-events: none;
		}
	}
</style>
