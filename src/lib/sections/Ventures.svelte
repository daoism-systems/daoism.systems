<script lang="ts">
  import Heading from '$lib/components/Heading.svelte';
  import IconPlus from '$lib/components/IconPlus.svelte';
  import SlideFocusBadge from '$lib/components/SlideFocusBadge.svelte';
  import { SUPPORTING_UI_REVEAL_PROGRESS, VENTURES_UI_TIMING } from '$lib/config/revealTiming';
  import { clamp01, getBeatProgress, getUiProgress } from '$lib/utils/animations/uiProgress';
  import { textReveal } from '$lib/utils/animations/textReveal';

  let { progress, isMobileTiming = false } = $props();

  const HIDDEN_EPSILON = 0.001;
  let timing = $derived(
    isMobileTiming ? VENTURES_UI_TIMING.mobile : VENTURES_UI_TIMING.desktop
  );

  let sectionProgress = $derived(clamp01(progress));
  let uiProgress = $derived(getUiProgress(progress, timing.window));
  let descOutProgress = $derived(
    getUiProgress(progress, {
      ...timing.window,
      hideStart: timing.descriptionHide.start,
      hideEnd: timing.descriptionHide.end
    })
  );
  let headingUiProgress = $derived(uiProgress);
  let contentRevealProgress = $derived(getBeatProgress(sectionProgress, timing.content));
  let contentUiProgress = $derived(contentRevealProgress * descOutProgress);
  let isIconHidden = $derived(
    isMobileTiming
      ? headingUiProgress < SUPPORTING_UI_REVEAL_PROGRESS
      : uiProgress <= HIDDEN_EPSILON
  );
  let contentOffsetY = $derived((1 - contentUiProgress) * 30);

  const headingRevealConfig = $derived({
    progress: headingUiProgress,
    from: 'start' as const,
    ...timing.headingMotion
  });

  const paragraphRevealOptions = $derived({
    progress: contentUiProgress,
    duration: timing.copyDuration,
    scrubProgressPower: 1.18
  });

</script>

<div class="ventures section__wrap">
  <Heading
    text={['Our Blog']}
    position="bottom"
    progress={sectionProgress}
    headingRevealConfig={headingRevealConfig}
    className="mobile-padded"
  />

  <IconPlus bottom="3.35rem" left={['0']} desktopHide={true} hidden={isIconHidden} />

  <div
    class="ventures__desc"
    style:transform={`translate3d(0, ${contentOffsetY}px, 0)`}
  >
    <p class="section-reveal-paragraph" use:textReveal={paragraphRevealOptions}>
        A public record of our activity, case studies and patterns for resilient, permissionless coordination systems.
    </p>

    <!-- Mobile: red badge pinned above the slider, tracks the centered slide -->
    <SlideFocusBadge reveal={contentUiProgress} />
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;

  .ventures {
    position: relative;
    display: flex;
    flex-direction: column;
    padding-top: 4.6rem;
    height: 100%;
    width: 100%;
    margin-left: 0;

    :global(h2) {
      @media (max-width: 612px) and (min-width: 550px) {
        font-size: 64px;
      }
    }

    @include breakpoint(desktop) {
      margin-left: $offset-content;
    }

    &__desc {
      position: absolute;
      left: 0;
      top: 4rem;
      line-height: 1.2;
      color: $color-text;
      will-change: transform;

      @include breakpoint(phone) {
        top: 4.5rem;
      }

      @include breakpoint(desktop) {
        left: -100%;
      }
    }

    .section-reveal-paragraph {
      // Tighter measure than the shared 44ch; this column sits beside the slider.
      max-width: 40ch;

      @include breakpoint(phone) {
        font-size: 14px;
        line-height: 1.4;
      }
    }
  }
</style>
