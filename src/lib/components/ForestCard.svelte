<script lang="ts">
	export let index: number;
	export let total: number;
	export let title: string;
	export let description: string;
</script>

<div class="forest-card" data-index={index} data-total={total}>
	<div class="forest-card__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
	<div class="forest-card__title">{title}</div>
	<div class="forest-card__desc">{description}</div>
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
		background: $color-grey-600;
		border: 1px solid rgba(255, 255, 255, 0.06);
		font-family: $font-main;
		color: #fff;
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		will-change: transform, opacity;

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
		}

		&__title {
			font-size: 15px;
			line-height: 1.25;
			font-weight: 400;
			color: #fff;
			word-spacing: $word-spacing;
		}

		&__desc {
			font-size: 13px;
			line-height: 1.45;
			font-weight: 400;
			color: $color-grey-300;
			word-spacing: $word-spacing;
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
</style>
