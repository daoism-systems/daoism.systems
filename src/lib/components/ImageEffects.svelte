<script lang="ts">
	import { loadingFinish } from '$lib/store.svelte';
</script>

<!-- Decorative full-screen smoke and light overlays; pointer-events none -->
<div class="image-effects" aria-hidden="true" style="opacity: {$loadingFinish ? 1 : 0}">
	<div class="smoke-anchor smoke-anchor--br">
		<img src="/smoke.png" alt="" class="smoke-img smoke-img--a" draggable="false" />
	</div>
	<div class="smoke-anchor smoke-anchor--tl">
		<img src="/smoke.png" alt="" class="smoke-img smoke-img--b" draggable="false" />
	</div>
	<img
		src="/light.png"
		alt=""
		class="light-layer"
		draggable="false"
	/>
</div>

<style lang="scss">
	.image-effects {
		position: fixed;
		z-index: 2;
		left: 0;
		right: 0;
		pointer-events: none;
		transition: opacity 12s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.smoke-anchor {
		position: fixed;
		width: 400px;
		pointer-events: none;
	}

	.smoke-anchor--br {
		right: -95px;
		bottom: -20px;
		transform: rotate(54deg);
		transform-origin: center center;
	}

	.smoke-anchor--tl {
		left: -95px;
		top: -20px;
		transform: rotate(247deg);
		transform-origin: center center;
	}

	.smoke-img {
		display: block;
		width: 100%;
		height: auto;
		will-change: transform, opacity;
	}

	.smoke-img--a {
		animation: smoke-float-a 8s ease-in-out infinite;
	}

	.smoke-img--b {
		animation: smoke-float-b 8s ease-in-out infinite;
	}

	.light-layer {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: grayscale(1) brightness(0.5);
		will-change: transform, opacity, filter;
		animation: light-drift 10s ease-in-out infinite;
	}

	@keyframes smoke-float-a {
		0%,
		100% {
			transform: translate(0, 0) scale(1);
			opacity: 0.82;
		}
		35% {
			transform: translate(22px, -18px) scale(1.08);
			opacity: 1;
		}
		70% {
			transform: translate(-14px, -12px) scale(0.96);
			opacity: 0.88;
		}
	}

	@keyframes smoke-float-b {
		0%,
		100% {
			transform: translate(0, 0) scale(1);
			opacity: 0.8;
		}
		40% {
			transform: translate(-20px, 16px) scale(1.07);
			opacity: 1;
		}
		75% {
			transform: translate(16px, -14px) scale(0.95);
			opacity: 0.9;
		}
	}

	@keyframes light-drift {
		0%,
		100% {
			transform: scale(1) translate(0, 0);
			opacity: 0.92;
			filter: grayscale(1) brightness(0.48);
		}
		50% {
			transform: scale(1.03) translate(0.6%, -0.4%);
			opacity: 1;
			filter: grayscale(1) brightness(0.58);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.smoke-img--a,
		.smoke-img--b,
		.light-layer {
			animation: none;
		}

		.smoke-img {
			opacity: 0.9;
		}

		.light-layer {
			opacity: 1;
			filter: grayscale(1) brightness(0.5);
			transform: none;
		}
	}

</style>
