<script lang="ts">
	type CircleDashProps = {
		dashId: string;
		radius: number;
		startAngle: number;
		endAngle: number;
		size?: number;
		strokeWidth?: number;
		opacity?: number;
		className?: string;
		showCenterGlyph?: boolean;
		glyphAngle?: number;
		glyphScale?: number;
		glyphRotate?: number;
	};

	let {
		dashId,
		radius,
		startAngle,
		endAngle,
		size = 691,
		strokeWidth = 1,
		opacity = 0.5,
		className = '',
		showCenterGlyph = false,
		glyphAngle,
		glyphScale = 1,
		glyphRotate = 0
	}: CircleDashProps = $props();

	const toRad = (angle: number) => ((angle - 90) * Math.PI) / 180;
	const normalizeDelta = (start: number, end: number) => {
		const delta = (end - start) % 360;
		return delta < 0 ? delta + 360 : delta;
	};
	const toPoint = (angle: number, center: number) => ({
		x: center + radius * Math.cos(toRad(angle)),
		y: center + radius * Math.sin(toRad(angle))
	});

	let center = $derived(size / 2);
	let start = $derived.by(() => toPoint(startAngle, center));
	let end = $derived.by(() => toPoint(endAngle, center));
	let largeArc = $derived(normalizeDelta(startAngle, endAngle) > 180 ? 1 : 0);
	let arcDelta = $derived(normalizeDelta(startAngle, endAngle));
	let midAngle = $derived((startAngle + arcDelta / 2) % 360);
	let marker = $derived.by(() => toPoint(glyphAngle ?? midAngle, center));
	let gradientId = $derived(`circle-dash-gradient-${dashId}`);
	let path = $derived(
		`M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`
	);
</script>

<svg
	class={`circle-dash ${className}`}
	width={size}
	height={size}
	viewBox={`0 0 ${size} ${size}`}
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<g {opacity} style="mix-blend-mode:difference">
		<path d={path} stroke={`url(#${gradientId})`} stroke-width={strokeWidth} stroke-linecap="round" />
	</g>
	{#if showCenterGlyph}
		<g class="circle-dash__glyph">
			<g
				transform={`translate(${marker.x} ${marker.y}) rotate(${glyphRotate}) scale(${glyphScale}) translate(-9 -9)`}
			>
				<path d="M8.28 0H9.72V18H8.28V0Z" fill="white" />
				<path d="M18 8.28V9.72L0 9.72L6.29429e-08 8.28L18 8.28Z" fill="white" />
				<path
					d="M5.94527 8.64L8.99998 5.5853L12.0547 8.64L8.99998 11.6947L5.94527 8.64Z"
					fill="white"
				/>
			</g>
		</g>
	{/if}
	<defs>
		<linearGradient
			id={gradientId}
			x1={start.x}
			y1={start.y}
			x2={end.x}
			y2={end.y}
			gradientUnits="userSpaceOnUse"
		>
			<stop stop-color="white" stop-opacity="0" />
			<stop offset="0.5" stop-color="white" />
			<stop offset="1" stop-color="white" stop-opacity="0" />
		</linearGradient>
	</defs>
</svg>

<style>
	.circle-dash {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}

	/* Orbit pivot for the cross glyph: rotate around the SVG viewBox centre,
	   independent of the arc. The arc (the parent <svg>) only scales. */
	.circle-dash__glyph {
		transform-box: view-box;
		transform-origin: 50% 50%;
		will-change: transform;
	}
</style>
