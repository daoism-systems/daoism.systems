<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Heading from '$lib/components/Heading.svelte';
	import IconPlus from '$lib/components/IconPlus.svelte';
	import {
		COLLABORATION_UI_TIMING,
		SUPPORTING_UI_REVEAL_PROGRESS
	} from '$lib/config/revealTiming';
	import { textReveal } from '$lib/utils/animations/textReveal';
	import { clamp01, getBeatProgress, getUiProgress } from '$lib/utils/animations/uiProgress';

	type Props = {
		progress: number;
		shaderInProgress?: number;
		onGetInTouch?: () => void | Promise<void>;
	};

	let {
		progress,
		shaderInProgress = 0,
		isMobileTiming = false,
		isPhoneTiming = false,
		onGetInTouch = () => {}
	}: Props & {
		isMobileTiming?: boolean;
		isPhoneTiming?: boolean;
	} = $props();

	const HIDDEN_EPSILON = 0.001;
	let timing = $derived(
		isPhoneTiming
			? COLLABORATION_UI_TIMING.phone
			: isMobileTiming
				? COLLABORATION_UI_TIMING.mobile
				: COLLABORATION_UI_TIMING.desktop
	);
	let usesMobileExitTiming = $derived(isMobileTiming || isPhoneTiming);

	let sectionProgress = $derived(clamp01(progress));
	let revealProgress = $derived(
		getUiProgress(Math.min(progress, timing.window.hideStart), timing.window)
	);
	let uiProgress = $derived(
		usesMobileExitTiming
			? getUiProgress(progress, timing.window)
			: revealProgress * (1 - clamp01(shaderInProgress))
	);
	let scrimOpacity = $derived(
		getBeatProgress(sectionProgress, timing.beats.scrimIn) *
			(usesMobileExitTiming
				? 1 - getBeatProgress(progress, timing.beats.scrimOut)
				: 1 - clamp01(shaderInProgress))
	);
	let headingUiProgress = $derived(
		getBeatProgress(uiProgress, timing.beats.heading)
	);
	let subtitleUiProgress = $derived(
		getBeatProgress(uiProgress, timing.beats.subtitle)
	);
	let buttonUiProgress = $derived(
		getBeatProgress(uiProgress, timing.beats.button)
	);

	let isIconHidden = $derived(
		isMobileTiming
			? headingUiProgress < SUPPORTING_UI_REVEAL_PROGRESS
			: uiProgress <= HIDDEN_EPSILON
	);

	let headingOffsetY = $derived((1 - headingUiProgress) * 20);

	const headingRevealConfig = $derived({
		progress: headingUiProgress,
		...timing.headingMotion
	});

	const subtitleRevealOptions = $derived({
		progress: subtitleUiProgress,
		duration: timing.subtitleDuration,
		scrubProgressPower: 1.12
	});

	const buttonClipPath = $derived(`inset(0 ${(1 - buttonUiProgress) * 100}% 0 0)`);

	function handleGetInTouch(event: MouseEvent | TouchEvent) {
		event.preventDefault();
		void onGetInTouch();
	}
</script>

<div class="collaboration section__wrap" style:--collab-scrim-opacity={scrimOpacity}>
	<div class="collaboration__wrap">
		<div class="collaboration__heading" style:transform={`translate3d(0, ${headingOffsetY}px, 0)`}>
			<Heading
				text={['Partner', 'with us']}
				progress={sectionProgress}
				{headingRevealConfig}
				className="mobile-padded heading-inverted"
			/>
		</div>

		<IconPlus top={['0', '4.75rem']} left={['0']} desktopHide={true} hidden={isIconHidden} />
		{@render cta()}
	</div>

	<div class="collaboration__footer">
		<div class="collaboration__subtitle" use:textReveal={subtitleRevealOptions}>
			<span class="text-line">
				We work through <span class="highlight">interdependence</span> — your goals become our requirements.
			</span>
		</div>
		{@render cta()}
	</div>
</div>

{#snippet cta()}
	<div
		class="collaboration__button"
		style:clip-path={buttonClipPath}
		style:opacity={buttonUiProgress}
		style:transform={`scaleX(${buttonUiProgress})`}
	>
		<Button
			label="Connect now"
			type="button"
			onclick={handleGetInTouch}
			ontouchstart={handleGetInTouch}
			data-cursor-text-label="Proceed"
		/>
	</div>
{/snippet}

<style lang="scss">
	@use '$lib/styles/variables' as *;

	.collaboration {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;

		@include breakpoint(desktop) {
			padding-top: $offset-content-top;
		}

		@include breakpoint(not-desktop) {
			padding: 4.5rem 0 0;

			// Readability scrim behind the bottom text block (mobile only): the 3D
			// model fades into a solid light panel so the grey copy stays legible.
			&::before {
				content: '';
				position: absolute;
				top: 70vh;
				// Use stable viewport height when available so browser chrome changes do not move the scrim.
				@supports (height: 100svh) {
					top: 70svh;
				}
				// Real iOS Safari needs a higher scrim start than desktop/mobile emulation.
				@supports (-webkit-touch-callout: none) {
					@media (hover: none) and (pointer: coarse) {
						top: 52svh;
					}
				}
				// Full-bleed: span the viewport width and reach its bottom edge,
				// escaping the section's 10px side / 5rem bottom padding.
				left: 50%;
				width: 100vw;
				transform: translateX(-50%);
				bottom: -$offset-y-phone;
				z-index: 0;
				pointer-events: none;
				// Fade with the section's reveal so it never bleeds a white panel
				// over the next section during the cross-fade.
				opacity: var(--collab-scrim-opacity, 1);
				background: linear-gradient(180deg, rgba(238, 237, 236, 0) 0%, #eeedec 19.166%);
				// Own compositor layer: the opacity is scrubbed every frame during the
				// section hand-off, and without it this near-viewport-sized gradient
				// repaints on each of those frames.
				will-change: opacity;
			}
		}

		@include breakpoint(phone) {
			padding: 4.75rem 0 0;
		}

		&__button {
			transform-origin: left center;
			/* Include translate3d in will-change if using it on the wrapper */
			will-change: transform, opacity, clip-path;
			// Stay hittable even while the wrapping section is pointer-events:none
			// (the Collaboration → Ventures holdover keeps the CTA visible but the
			// section click-through). When hidden, the scaleX(0) + clip-path reveal
			// collapses the box, so this doesn't capture stray clicks.
			pointer-events: auto;

			// The CTA is rendered twice — once under the heading (in the wrap) and
			// once in the bottom footer group — so it can sit beneath the heading on
			// desktop/tablet yet share a flex container with the subtitle on phone.
			// Only the copy that belongs to the current breakpoint is shown.
			.collaboration__wrap & {
				@include breakpoint(phone) {
					display: none;
				}
			}

			.collaboration__footer & {
				@include breakpoint(not-phone) {
					display: none;
				}

				@include breakpoint(phone) {
					width: 100%;
					position: relative; // keep the CTA above the readability scrim
					z-index: 1;
				}
			}
		}

		&__heading {
			will-change: transform; /* Opacity removed from wrapper */
		}

		&__wrap {
			max-width: 21rem;
			display: flex;
			flex-direction: column;
			gap: 1.6rem;

			@media (max-width: 1350px) {
				max-width: 21rem;
			}

			@media (max-width: 1024px) {
				max-width: 26rem;
			}

			@media (min-width: 2245px) {
				max-width: 34rem;
			}

			@include breakpoint(desktop) {
				:global(h2) {
					margin-left: -3px;
				}
			}

			@include breakpoint(tablet) {
				position: relative;
			}
		}

		&__footer {
			flex: 1;
			display: flex;
			flex-direction: column;
			min-height: 0;

			@include breakpoint(phone) {
				position: relative;
				z-index: 1; // lift the group above the readability scrim
				justify-content: flex-end;
				gap: 1.5rem;
			}
		}

		&__subtitle {
			position: relative;
			z-index: 1;
			margin: auto 0 0 auto;
			padding-bottom: 3.5rem;
			// em, not ch: KH Interference isn't monospace, so em is the unit that
			// keeps the measure proportional across the font-size steps below.
			max-width: 22em;
			font-size: var(--text-2xl);
			line-height: var(--tw-leading, var(--text-2xl--line-height));
			font-family: $font-secondary;
			color: #3c3f46;
			// One cohesive soft shadow for the whole line instead of a per-character
			// text-shadow: the split .char spans each cast their own blurred blob, and
			// the gaps between the monospace glyphs keep those blobs from merging, so
			// they read as blocky rectangles. A container drop-shadow shadows the
			// composited text as a single shape, matching the design.
			filter:
				drop-shadow(0 2px 4px rgba(4, 7, 13, 0.26))
				drop-shadow(0 8px 20px rgba(4, 7, 13, 0.2));

			:global(.text-line) {
				display: block;
			}

			.highlight {
				position: relative;
				display: inline-block;
				color: #f8fbff;
				font-weight: 400;
				// Depth comes from the container drop-shadow now; no per-word shadow.
			}

			@media (min-width: 2245px) {
				font-size: var(--text-5xl);
				line-height: var(--tw-leading, var(--text-5xl--line-height));
			}

			@media (max-width: 776px) {
				font-size: var(--text-3xl);
				line-height: var(--tw-leading, var(--text-3xl--line-height));
			}

			@media (max-width: 628px) {
				font-size: var(--text-2xl);
				line-height: var(--tw-leading, var(--text-2xl--line-height));
			}

			@media (max-width: 450px) {
				font-size: var(--text-xl);
				line-height: var(--tw-leading, var(--text-xl--line-height));
			}

			@media (max-width: 420px) {
				font-size: var(--text-base);
				line-height: var(--tw-leading, var(--text-base--line-height));
			}

			@include breakpoint(not-desktop) {
				color: $color-grey-400;
				text-shadow: none;
				filter: none; // flat text on the light readability scrim
				font-size: 18px;
				line-height: 0.95;
				word-spacing: $word-spacing;

				margin: 0;
				margin-top: auto;

				.highlight {
					color: $color-grey-100;
					text-shadow: none;
				}
			}

			@include breakpoint(phone) {
				margin-top: 0;
				padding-bottom: 0;
			}
		}
	}
</style>
