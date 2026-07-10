<script lang="ts">
	let { isMirrored = false } = $props();
</script>

<svg
	style="transform: {isMirrored ? 'scaleY(-1)' : 'scaleY(1)'};"
	width="1"
	height="154"
	viewBox="0 0 1 154"
	class="preloader-vertical-line"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<line
		y1="-0.5"
		x2="154"
		y2="-0.5"
		transform="matrix(-4.37114e-08 1 1 4.37114e-08 1 0)"
		stroke="url(#paint0_linear_785_4180)"
	/>
	<defs>
		<linearGradient
			id="paint0_linear_785_4180"
			x1="0"
			y1="0.5"
			x2="154"
			y2="0.5"
			gradientUnits="userSpaceOnUse"
		>
			<stop stop-color="white" stop-opacity="0.5" />
			<stop offset="1" stop-color="white" stop-opacity="0" />
		</linearGradient>
	</defs>
</svg>

<style>
	.preloader-vertical-line {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
