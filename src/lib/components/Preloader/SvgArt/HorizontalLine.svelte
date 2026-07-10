<script lang="ts">
	let { isMirrored = false } = $props();
</script>

<svg
	style="transform: {isMirrored ? 'scaleX(-1)' : 'scaleX(1)'};"
	width="355"
	height="1"
	viewBox="0 0 355 1"
	class="preloader-horizontal-line"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<line
		y1="-0.5"
		x2="355"
		y2="-0.5"
		transform="matrix(-1 8.74228e-08 8.74228e-08 1 355 1)"
		stroke="url(#paint0_linear_785_4181)"
	/>
	<defs>
		<linearGradient
			id="paint0_linear_785_4181"
			x1="0"
			y1="0.5"
			x2="355"
			y2="0.5"
			gradientUnits="userSpaceOnUse"
		>
			<stop stop-color="white" stop-opacity="0.5" />
			<stop offset="1" stop-color="white" stop-opacity="0" />
		</linearGradient>
	</defs>
</svg>

<style>
	.preloader-horizontal-line {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
