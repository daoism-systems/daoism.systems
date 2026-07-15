<script lang="ts">
  import Heading from '$lib/components/Heading.svelte';
  import IconPlus from '$lib/components/IconPlus.svelte';
  import { ABOUT_UI_WINDOW } from '$lib/config/revealTiming';
  import { clamp01, getPhaseProgress, getUiProgress } from '$lib/utils/animations/uiProgress';
  import { textReveal } from '$lib/utils/animations/textReveal';

  let { progress } = $props();

  const HIDDEN_EPSILON = 0.001;
  let sectionProgress = $derived(clamp01(progress));
  let uiProgress = $derived(getUiProgress(progress, ABOUT_UI_WINDOW));
  let paragraphUiProgress = $derived(getPhaseProgress(uiProgress, 0.14, 0.76));
  let isHidden = $derived(uiProgress <= HIDDEN_EPSILON);

  const headingRevealConfig = $derived({
    progress: uiProgress,
    from: 'start' as const,
    duration: 0.82,
    stagger: 0.014
  });

  const paragraphRevealOptions = $derived({
    progress: paragraphUiProgress,
    duration: 1.05,
    scrubProgressPower: 1.14,
    wordOffsetY: '0.5em',
    wordOffsetX: 0
  });
</script>

<div class="about section__wrap">
  <div class="about__title">
    <Heading
      text={['DAOISM', 'SYSTEMS']}
      progress={sectionProgress}
      headingRevealConfig={headingRevealConfig}
      className="about-heading"
    />
  </div>

  <div class="about__desc section-reveal-paragraph">
    <p use:textReveal={paragraphRevealOptions}>
        Coordination is the hardest problem on the internet. We design and build the systems that solve it for network economies.
    </p>

    <p use:textReveal={paragraphRevealOptions}>
        DeFi, DAOs, open-source AI tooling and protocols — engineered end to end.
    </p>
  </div>

  <IconPlus top={['10%', '5rem']} left={['1.2rem', '0.625rem']} hidden={isHidden} />
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;

  .about {
    display: flex;
    flex-direction: column;
    padding-top: 2.3rem;
    height: 100%;

    @include breakpoint(desktop) {
      margin-left: $offset-content;
    }

    @include breakpoint(tablet) {
      padding-top: 5.7rem;
    }

    @include breakpoint(phone) {
      padding-top: 3.3rem;
    }

    &__title {
      /* H2 Large — shared oversized title (Daoism Systems / Services / Join our team). */
      :global(.about-heading) {
        @include breakpoint(desktop) {
          font-size: 104px;
        }
      }

      @include breakpoint(tablet) {
        margin-left: 3rem;
      }

      @include breakpoint(phone) {
        margin-top: 1rem;
        margin-left: 1.68rem;
      }
    }

    &__desc {
      color: $color-text;
      margin-top: auto;

      p + p {
        padding-top: 1.5rem;

        @media (max-width: 1435px) {
          padding-top: 1rem;
        }
      }
    }
  }
</style>
