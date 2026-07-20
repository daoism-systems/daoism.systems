<script lang="ts">
	import { clamp01, smoothstep } from '$lib/utils/animations/uiProgress';

	export let index: number;
	export let total: number;
	export let title: string;
	export let description: string;
	export let revealProgress = 1;

	const SETTLED_EPSILON = 0.001;

	function getLayerProgress(progress: number, start: number, span: number) {
		return smoothstep(clamp01((progress - start) / span));
	}

	$: surfaceProgress = getLayerProgress(revealProgress, 0, 0.68);
	$: indexProgress = getLayerProgress(revealProgress, 0.12, 0.62);
	$: titleProgress = getLayerProgress(revealProgress, 0.18, 0.64);
	$: descriptionProgress = getLayerProgress(revealProgress, 0.28, 0.68);
	$: isSettled = surfaceProgress >= 1 - SETTLED_EPSILON;
	$: surfaceTransform = isSettled
		? 'none'
		: `perspective(900px) translate3d(0, ${(1 - surfaceProgress) * 38}px, 0) rotateX(${(1 - surfaceProgress) * 6}deg) scale(${0.975 + surfaceProgress * 0.025})`;
</script>

<div
	class="forest-card"
	data-index={index}
	data-total={total}
	style:--forest-edge-progress={getLayerProgress(revealProgress, 0.14, 0.7)}
	style:opacity={surfaceProgress}
	style:transform={surfaceTransform}
	style:will-change={!isSettled && surfaceProgress > SETTLED_EPSILON ? 'transform, opacity' : 'auto'}
>
	<div
		class="forest-card__index"
		aria-hidden="true"
		style:opacity={indexProgress}
		style:transform={indexProgress >= 1 - SETTLED_EPSILON
			? 'none'
			: `translate3d(${(1 - indexProgress) * 12}px, 0, 0)`}
	>
		{String(index + 1).padStart(2, '0')}
	</div>
	<div
		class="forest-card__title"
		style:opacity={titleProgress}
		style:transform={titleProgress >= 1 - SETTLED_EPSILON
			? 'none'
			: `translate3d(0, ${(1 - titleProgress) * 14}px, 0)`}
	>
		{title}
	</div>
	<div
		class="forest-card__desc"
		style:opacity={descriptionProgress}
		style:transform={descriptionProgress >= 1 - SETTLED_EPSILON
			? 'none'
			: `translate3d(0, ${(1 - descriptionProgress) * 18}px, 0)`}
	>
		{description}
	</div>
</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.forest-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		padding: 1rem;
		padding-right: 3rem;
		border-radius: 10px;
		background:
			linear-gradient(145deg, rgba(255, 255, 255, 0.055), transparent 44%),
			rgba(43, 44, 48, 0.84);
		border: 1px solid rgba(255, 255, 255, 0.06);
		font-family: $font-main;
		color: #fff;
		contain: layout style paint;
		transform-origin: center bottom;
		backface-visibility: hidden;

		&__index {
			position: absolute;
			top: 0.875rem;
			right: 1rem;
			font-size: 0.75rem;
			line-height: 1;
			font-weight: 400;
			color: $color-grey-300;
			letter-spacing: 0.04em;
			font-variant-numeric: tabular-nums;
			pointer-events: none;
			user-select: none;
			backface-visibility: hidden;
		}

		&__title {
			font-size: 15px;
			line-height: 1.25;
			font-weight: 400;
			color: #fff;
			word-spacing: $word-spacing;
			backface-visibility: hidden;
		}

		&__desc {
			font-size: 13px;
			line-height: 1.45;
			font-weight: 400;
			color: $color-grey-300;
			word-spacing: $word-spacing;
			backface-visibility: hidden;
		}

		@include breakpoint(desktop) {
			padding: 1rem 1.25rem 1.5rem;
			padding-right: 3.25rem;
			gap: 1rem;
			border: none;

			&__index {
				top: 1rem;
				right: 1.25rem;
				font-size: 0.875rem;
			}

			&__title {
				font-size: 1.125rem;
			}

			&__desc {
				font-size: 1rem;
				line-height: 1.3;
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.forest-card {
			transform: none !important;
			will-change: auto !important;
		}

		.forest-card__index,
		.forest-card__title,
		.forest-card__desc {
			opacity: 1 !important;
			transform: none !important;
		}

		.forest-card::before {
			opacity: 1 !important;
			transform: none !important;
		}
	}
</style>
