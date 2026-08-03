<script lang="ts">
	import { EASINGS } from '$lib/utils/animations/constants/easings';
	import CircleDash from './CircleDash.svelte';

	let {
		onSequenceComplete,
		isExiting = false
	}: { onSequenceComplete?: () => void; isExiting?: boolean } = $props();

	let sequenceNotified = false;

	function notifySequenceComplete() {
		if (sequenceNotified) return;
		sequenceNotified = true;
		onSequenceComplete?.();
	}

	const outerCircleDashes = [
		{ id: 'outer-right', startAngle: 58, endAngle: 122 },
		{ id: 'outer-left', startAngle: 238, endAngle: 302 }
	];

	const innerCircleDashes = [
		{ id: 'inner-top-left', startAngle: 20, endAngle: 160, glyphAngle: 0 },
		{ id: 'inner-bottom-right', startAngle: 200, endAngle: 340, glyphAngle: 180 }
	];

	const motionVars = `
		--ease-reveal: ${EASINGS.EASE_CUSTOM_REVEAL};
		--ease-morph: ${EASINGS.EASE_CUSTOM_REVEAL};
	`;
</script>

<div class="preloader-art" style={motionVars} class:preloader-art--exit={isExiting}>
	<span
		class="preloader-art__sequence-end"
		aria-hidden="true"
		onanimationend={notifySequenceComplete}
	></span>
	<div class="preloader-art__frame">
		<div class="preloader-art__rings">
			{#each outerCircleDashes as dash (dash.id)}
				<div class="preloader-art__outer-mount">
					<CircleDash
						className={`preloader-art__dash preloader-art__dash--${dash.id}`}
						dashId={dash.id}
						radius={345}
						startAngle={dash.startAngle}
						endAngle={dash.endAngle}
						strokeWidth={1.00286}
						showCenterGlyph={dash.id === 'outer-right' || dash.id === 'outer-left'}
						glyphScale={0.5}
					/>
				</div>
			{/each}

			{#each innerCircleDashes as dash (dash.id)}
				<CircleDash
					className={`preloader-art__dash preloader-art__dash--${dash.id} preloader-art__dash--inner`}
					dashId={dash.id}
					radius={172.5}
					startAngle={dash.startAngle}
					endAngle={dash.endAngle}
					strokeWidth={0.501429}
					showCenterGlyph={true}
					glyphAngle={dash.glyphAngle}
					glyphScale={0.5}
				/>
			{/each}
		</div>
	</div>
</div>

<style lang="scss">
	:global(.preloader-art__dash--outer-right) {
		transform-origin: 50% 50%;
		will-change: transform;
		animation: outer-right-push var(--t-expand-dur) var(--ease-morph) var(--t-expand-delay) both;
	}

	:global(.preloader-art__dash--outer-left) {
		transform-origin: 50% 50%;
		will-change: transform;
		animation: outer-left-push var(--t-expand-dur) var(--ease-morph) var(--t-expand-delay) both;
	}

	:global(.preloader-art__dash--inner) {
		opacity: 0;
		transform-origin: 50% 50%;
		will-change: transform, opacity;
		animation:
			inner-fade-in var(--t-orbit-dur) var(--ease-reveal) var(--t-orbit-delay) forwards,
			inner-align-to-sides var(--t-expand-dur) var(--ease-morph) var(--t-expand-delay) both;
	}

	/* Only the cross glyphs rotate; the arcs above just scale. Glyphs orbit the
	   centre on the same timing the arcs scale, so the motion stays in sync. */
	:global(.preloader-art__dash--outer-right .circle-dash__glyph),
	:global(.preloader-art__dash--outer-left .circle-dash__glyph) {
		animation: outer-glyph-orbit-in var(--t-expand-dur) var(--ease-morph) var(--t-expand-delay) both;
	}

	:global(.preloader-art__dash--inner .circle-dash__glyph) {
		animation: inner-glyph-orbit-in var(--t-expand-dur) var(--ease-morph) var(--t-expand-delay) both;
	}

	/* Exit: reverse the intro — rings spin back and collapse to center. */
	.preloader-art--exit :global(.preloader-art__dash--outer-right) {
		animation: outer-right-collapse var(--t-exit-rings-dur) var(--ease-morph) both;
	}

	.preloader-art--exit :global(.preloader-art__dash--outer-left) {
		animation: outer-left-collapse var(--t-exit-rings-dur) var(--ease-morph) both;
	}

	.preloader-art--exit :global(.preloader-art__dash--inner) {
		animation: inner-collapse var(--t-exit-rings-dur) var(--ease-morph) both;
	}

	.preloader-art--exit :global(.preloader-art__dash--outer-right .circle-dash__glyph),
	.preloader-art--exit :global(.preloader-art__dash--outer-left .circle-dash__glyph) {
		animation: outer-glyph-orbit-out var(--t-exit-rings-dur) var(--ease-morph) both;
	}

	.preloader-art--exit :global(.preloader-art__dash--inner .circle-dash__glyph) {
		animation: inner-glyph-orbit-out var(--t-exit-rings-dur) var(--ease-morph) both;
	}

	.preloader-art {
		--t-art-reveal-delay: 0.05s;
		--t-art-reveal-dur: 0.95s;
		--t-orbit-delay: 0.2s;
		--t-orbit-dur: 1.2s;
		--t-expand-delay: 0.25s;
		--t-expand-dur: 2.8s;
		--t-exit-rings-dur: 0.8s;
		--t-exit-frame-delay: 0.48s;
		--t-exit-frame-dur: 0.62s;
		/* Buttons reveal a beat into the circles' intro (orbit phase + offset). */
		--t-buttons-ready: calc(var(--t-orbit-delay) + 0.4s);
		--preloader-frame-size: min(691px, 78vmin, calc(100vw - 2rem), calc(100vh - 2rem));
		--outer-push-shift: 5%;
		--outer-push-scale: 1.8;
		--inner-align-scale: 2;

		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		z-index: 1;
		pointer-events: none;

		&__sequence-end {
			position: absolute;
			width: 0;
			height: 0;
			opacity: 0;
			pointer-events: none;
			animation: preloader-art-sequence-end 0s linear forwards;
			animation-delay: var(--t-buttons-ready);
		}

		@media (prefers-reduced-motion: reduce) {
			--t-art-reveal-delay: 0s;
			--t-art-reveal-dur: 0.12s;
			--t-orbit-delay: 0s;
			--t-orbit-dur: 0.01s;
			--t-expand-delay: 0.04s;
			--t-expand-dur: 0.12s;
			--t-exit-rings-dur: 0.1s;
			--t-exit-frame-delay: 0.02s;
			--t-exit-frame-dur: 0.1s;
			--t-buttons-ready: calc(var(--t-orbit-delay) + 0.05s);
		}

		&__frame {
			position: relative;
			width: var(--preloader-frame-size);
			height: var(--preloader-frame-size);
			opacity: 0;
			transform: scale(0);
			will-change: transform, opacity;
			/* Gentle fade — the ring expansion carries the punch; a fast-attack ease
			   here would make the arcs appear instantly instead of emerging. */
			animation: art-reveal var(--t-art-reveal-dur) ease-out var(--t-art-reveal-delay) forwards;
		}

		&--exit &__frame {
			animation: frame-collapse var(--t-exit-frame-dur) var(--ease-reveal) var(--t-exit-frame-delay)
				both;
		}

		&__outer-mount {
			position: absolute;
			inset: 0;
			pointer-events: none;
		}

	}

	@media (max-width: 1400px) {
		.preloader-art {
			--preloader-frame-size: min(620px, 72vmin, calc(100vw - 2.5rem), calc(100vh - 4rem));
		}
	}

	@media (max-width: 1215px) {
		.preloader-art {
			--outer-push-shift: 2.5%;
			--outer-push-scale: 1.5;
			--inner-align-scale: 1.75;
		}
	}

	@media (max-width: 860px) {
		.preloader-art {
			--outer-push-shift: 1.4%;
			--outer-push-scale: 1.32;
			--inner-align-scale: 1.45;
		}
	}

	@media (max-width: 555px) {
		.preloader-art {
			--outer-push-shift: 0.8%;
			--outer-push-scale: 1.1;
			--inner-align-scale: 1.1;
		}
	}

	@media (max-width: 1024px) {
		.preloader-art {
			--preloader-frame-size: min(540px, 66vmin, calc(100vw - 2.5rem), calc(100vh - 6rem));
		}
	}

	@media (max-width: 640px) {
		.preloader-art {
			--preloader-frame-size: min(400px, 82vmin, calc(100vw - 1.2rem), calc(100vh - 6.2rem));
		}
	}

	/* Mobile: hide the orbiting circles. The CTA still reveals on the same
	   timing because &__sequence-end (a sibling of the frame) keeps animating. */
	@media (max-width: 767px) {
		.preloader-art__frame {
			display: none;
		}
	}

	@keyframes art-reveal {
		from {
			opacity: 0;
			transform: scale(0.92);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	/* Exit collapses are the explicit reverse of each intro keyframe. */
	@keyframes frame-collapse {
		from {
			opacity: 1;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(0);
		}
	}

	@keyframes outer-right-collapse {
		from {
			transform: translateX(var(--outer-push-shift)) scale(var(--outer-push-scale));
		}
		to {
			transform: translateX(0) scale(0);
		}
	}

	@keyframes outer-left-collapse {
		from {
			transform: translateX(calc(var(--outer-push-shift) * -1)) scale(var(--outer-push-scale));
		}
		to {
			transform: translateX(0) scale(0);
		}
	}

	@keyframes inner-collapse {
		from {
			opacity: 1;
			transform: scale(var(--inner-align-scale));
		}
		to {
			opacity: 0;
			transform: scale(0);
		}
	}

	@keyframes outer-right-push {
		from {
			transform: translateX(0) scale(0);
		}
		to {
			transform: translateX(var(--outer-push-shift)) scale(var(--outer-push-scale));
		}
	}

	@keyframes outer-left-push {
		from {
			transform: translateX(0) scale(0);
		}
		to {
			transform: translateX(calc(var(--outer-push-shift) * -1)) scale(var(--outer-push-scale));
		}
	}

	@keyframes inner-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes inner-align-to-sides {
		from {
			transform: scale(0);
		}
		to {
			transform: scale(var(--inner-align-scale));
		}
	}

	/* Cross-glyph orbits — the rotation removed from the arc keyframes above. */
	@keyframes outer-glyph-orbit-in {
		from {
			transform: rotate(180deg);
		}
		to {
			transform: rotate(0deg);
		}
	}

	@keyframes inner-glyph-orbit-in {
		from {
			transform: rotate(-180deg);
		}
		to {
			transform: rotate(0deg);
		}
	}

	@keyframes outer-glyph-orbit-out {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(180deg);
		}
	}

	@keyframes inner-glyph-orbit-out {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(-180deg);
		}
	}

	@keyframes preloader-art-sequence-end {
		to {
			opacity: 0;
		}
	}
</style>
