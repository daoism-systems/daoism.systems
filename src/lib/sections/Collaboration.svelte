<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Heading from '$lib/components/Heading.svelte';
	import IconPlus from '$lib/components/IconPlus.svelte';
	import { COLLABORATION_UI_WINDOW } from '$lib/config/revealTiming';
	import { headingReveal } from '$lib/utils/animations/headingReveal';
	import { clamp01, getPhaseProgress, getUiProgress } from '$lib/utils/animations/uiProgress';

	type Props = {
		progress: number;
		onGetInTouch?: () => void | Promise<void>;
	};

	let { progress, onGetInTouch = () => {} }: Props = $props();

	const HIDDEN_EPSILON = 0.001;

	let sectionProgress = $derived(clamp01(progress));
	let revealProgress = $derived(getUiProgress(sectionProgress, { hideStart: 1 }));
	let uiProgress = $derived(getUiProgress(progress, COLLABORATION_UI_WINDOW));
	// The readability scrim retires as soon as the section ends (progress 1 → 1.1),
	// a touch ahead of the text hold-over, so it never bleeds a white panel through
	// the incoming Ventures section during the cross-fade.
	let scrimOpacity = $derived(revealProgress * (1 - getPhaseProgress(progress, 1, 0.1)));
	let headingUiProgress = $derived(uiProgress);
	let subtitleUiProgress = $derived(getPhaseProgress(uiProgress, 0.06, 0.74));
	let buttonUiProgress = $derived(getPhaseProgress(uiProgress, 0.1, 0.78));

	let isSectionHidden = $derived(uiProgress <= HIDDEN_EPSILON);

	let subtitleOffsetY = $derived((1 - subtitleUiProgress) * 28);
	let headingOffsetY = $derived((1 - headingUiProgress) * 20);

	const headingRevealConfig = $derived({
		progress: headingUiProgress,
		duration: 0.58,
		stagger: 0.01
	});

	const subtitleRevealOptions = $derived({
		progress: subtitleUiProgress,
		duration: 0.55,
		stagger: 0.01
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

		<IconPlus top={['0', '4.75rem']} left={['0']} desktopHide={true} hidden={isSectionHidden} />
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
	</div>

	<div
		class="collaboration__subtitle"
		style:transform={`translate3d(0, ${subtitleOffsetY}px, 0)`}
		use:headingReveal={subtitleRevealOptions}
	>
		<span class="text-line">
		    We work through <span class="highlight">interdependence</span> — your goals become our requirements.
		</span>
	</div>

</div>

<style lang="scss">
	@use '$lib/styles/variables' as *;

	// Phone CTA metrics. The button is out of flow at the section's bottom edge,
	// so the subtitle has to reserve its band by hand: 3.2rem button (2 × 1rem
	// padding + one 19px label line) + the offset below + ~1rem of breathing room.
	$collab-cta-offset: 20px;
	$collab-cta-band: 5.5rem;

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

			@include breakpoint(phone) {
				position: absolute;
				bottom: $collab-cta-offset;
				left: 0;
				width: 100%;
				// Above the subtitle (z-index 1) so the scrim it carries, which
				// reaches down past the CTA, cannot wash the button out.
				z-index: 2;
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

		&__subtitle {
			position: relative;
			z-index: 1;
			margin: auto 0 0 auto;
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
			will-change: transform; /* Added to prep GPU for transform scrub */

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

				// Readability scrim (mobile only): the 3D model fades into a solid
				// light panel so the grey copy stays legible. It hangs off this text
				// block rather than a viewport percentage — browser chrome, device
				// height and svh quirks used to move a `top: 70vh` scrim below the
				// copy on real devices, leaving the text on the model.
				&::before {
					content: '';
					position: absolute;
					// Full-bleed: span the viewport width, escaping the section's
					// 10px side padding.
					left: 50%;
					width: 100vw;
					transform: translateX(-50%);
					// The fade ramps in above the copy and is solid 1rem before the
					// first line; the bottom overshoots past the CTA and the section's
					// 5rem bottom padding — .section's overflow:hidden clips it at the
					// viewport edge, so there is no per-device bottom math.
					top: -7rem;
					bottom: -100vh;
					z-index: -1;
					pointer-events: none;
					// Fade with the section's reveal so it never bleeds a white panel
					// over the next section during the cross-fade.
					opacity: var(--collab-scrim-opacity, 1);
					background: linear-gradient(180deg, rgba(238, 237, 236, 0) 0, #eeedec 6rem);
				}

				.highlight {
					color: $color-grey-100;
					text-shadow: none;
				}
			}

			// The phone CTA is absolutely positioned at the section's bottom edge,
			// which is exactly where `margin-top: auto` parks this copy — reserve the
			// button's band so the two stop stacking on top of each other.
			@include breakpoint(phone) {
				margin-bottom: $collab-cta-band;
			}
		}
	}
</style>
