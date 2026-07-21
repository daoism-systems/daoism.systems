<script lang="ts">
  import Card from '$lib/components/Card.svelte';
  import Heading from '$lib/components/Heading.svelte';
  import IconPlus from '$lib/components/IconPlus.svelte';
  import { onMount } from 'svelte';
  import { PARTNERS_UI_TIMING, SUPPORTING_UI_REVEAL_PROGRESS } from '$lib/config/revealTiming';
  import { gsapSplitReveal } from '$lib/utils/animations/gsapSplitReveal';
  import { clamp01, getBeatProgress, getUiProgress } from '$lib/utils/animations/uiProgress';
  import { textReveal } from '$lib/utils/animations/textReveal';

  let { progress, isMobileTiming = false } = $props();

  const HIDDEN_EPSILON = 0.001;
  const PARTNERS_GSAP_SPLIT_REVEAL_EXPERIMENT_ENABLED = true;
  let timing = $derived(
    isMobileTiming ? PARTNERS_UI_TIMING.mobile : PARTNERS_UI_TIMING.desktop
  );

  let sectionProgress = $derived(clamp01(progress));
  let uiProgress = $derived(getUiProgress(sectionProgress, timing.window));
  let headingUiProgress = $derived(
    getBeatProgress(uiProgress, timing.beats.heading)
  );
  let paragraphUiProgress = $derived(
    getBeatProgress(uiProgress, timing.beats.paragraph)
  );
  let lineUiProgress = $derived(getBeatProgress(uiProgress, timing.beats.divider));
  let cardsRevealProgress = $derived(
    getBeatProgress(sectionProgress, timing.beats.cardsReveal)
  );
  let cardsMoveProgress = $derived(
    getBeatProgress(sectionProgress, timing.beats.cardsMove)
  );
  let isIconHidden = $derived(
    isMobileTiming
      ? paragraphUiProgress < SUPPORTING_UI_REVEAL_PROGRESS
      : uiProgress <= HIDDEN_EPSILON
  );
  let paragraphOffsetY = $derived((1 - paragraphUiProgress) * 24);

  const headingRevealConfig = $derived({
    progress: headingUiProgress,
    ...timing.headingMotion
  });

  const paragraphRevealOptions = $derived({
    progress: paragraphUiProgress,
    duration: timing.copyDuration,
    scrubProgressPower: 1.25
  });

  const gsapParagraphRevealOptions = $derived({
    enabled: PARTNERS_GSAP_SPLIT_REVEAL_EXPERIMENT_ENABLED,
    progress: paragraphUiProgress,
    progressPower: 1.25,
    duration: timing.copyDuration,
    split: 'chars' as const
  });

  // Cards Scroll Logic
  let cardsEl = $state<HTMLElement | null>(null);
  let isDesktop = $state(false);
  let prefersReducedMotion = $state(false);
  let moveY = $state(0);
  let moveX = $state(0);
  let smoothedCardsMoveProgress = $state(0);
  let cardsFrame = 0;
  let cardsFrameTime = 0;
  let cardsTransform = $derived.by(() => {
    const revealProgress = prefersReducedMotion ? 1 : cardsRevealProgress;
    const revealX = isDesktop ? (1 - revealProgress) * -32 : 0;
    const revealY = (1 - revealProgress) * 28;
    const translateX = revealX - moveX * smoothedCardsMoveProgress;
    const translateY = revealY - moveY * smoothedCardsMoveProgress;
    const scale = 0.975 + revealProgress * 0.025;

    return `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
  });
  let cardsOpacity = $derived(prefersReducedMotion ? 1 : cardsRevealProgress);
  let cardsBlur = $derived(prefersReducedMotion ? 0 : (1 - cardsRevealProgress) * 10);

  onMount(() => {
    const cards = cardsEl;
    if (!cards) return;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => {
      prefersReducedMotion = reducedMotionQuery.matches;
    };

    const updateMeasurements = () => {
      const containerHeight = window.innerHeight;
      const containerWidth = window.innerWidth;
      isDesktop = window.innerWidth >= 1024;

      if (isDesktop) {
        const cardHeight = cards.clientHeight;
        moveY = Math.max(cardHeight - containerHeight, 0);
        moveX = 0;
      } else {
        const cardWidth = cards.scrollWidth;
        moveX = Math.max(cardWidth - containerWidth, 0);
        moveY = 0;
      }
    };

    const animateCards = (now: number) => {
      if (!cardsFrameTime) cardsFrameTime = now;
      const frameDeltaMs = Math.min(Math.max(now - cardsFrameTime, 0), 64);
      cardsFrameTime = now;
      const alpha = prefersReducedMotion
        ? 1
        : 1 - Math.exp(-frameDeltaMs / timing.cardsSmoothingMs);
      smoothedCardsMoveProgress +=
        (cardsMoveProgress - smoothedCardsMoveProgress) * alpha;
      if (Math.abs(cardsMoveProgress - smoothedCardsMoveProgress) < 0.0001) {
        smoothedCardsMoveProgress = cardsMoveProgress;
      }
      cardsFrame = requestAnimationFrame(animateCards);
    };

    updateMotionPreference();
    updateMeasurements();
    smoothedCardsMoveProgress = cardsMoveProgress;
    cardsFrame = requestAnimationFrame(animateCards);

    window.addEventListener('resize', updateMeasurements);
    reducedMotionQuery.addEventListener('change', updateMotionPreference);
    return () => {
      window.removeEventListener('resize', updateMeasurements);
      reducedMotionQuery.removeEventListener('change', updateMotionPreference);
      cancelAnimationFrame(cardsFrame);
    };
  });

  const Cards = [
    { id: '01', title: 'Company Name', subtitle: 'DoinGud', type: 'Customer', icon: '/icons/iconPartner1.svg' },
    { id: '02', title: 'Company Name', subtitle: 'PrimeDAO', type: 'Customer', icon: '/icons/iconPartner2.svg' },
    { id: '03', title: 'Company Name', subtitle: 'Balancer', type: 'Customer', icon: '/icons/iconPartner3.svg' },
    { id: '04', title: 'Company Name', subtitle: 'Ceramic Network', type: 'Customer', icon: '/icons/iconPartner4.png' },
    { id: '05', title: 'Company Name', subtitle: 'Safe', type: 'Customer', icon: '/icons/iconPartnerSafe.svg', iconScale: 1.7 }
  ];
</script>

<div class="partners">
  <Heading
    className="partners"
    text={['Teams we', 'worked with']}
    sup="5"
    position="bottom"
    progress={sectionProgress}
    headingRevealConfig={headingRevealConfig}
  />

  <div class="partners__desc">
    {#if PARTNERS_GSAP_SPLIT_REVEAL_EXPERIMENT_ENABLED}
      <p
        class="section-reveal-paragraph"
        use:gsapSplitReveal={gsapParagraphRevealOptions}
      >
        Teams shaping decentralized web
      </p>
    {:else}
      <p
        class="section-reveal-paragraph"
        style:transform={`translate3d(0, ${paragraphOffsetY}px, 0)`}
        use:textReveal={paragraphRevealOptions}
      >
        Teams shaping decentralized web
      </p>
    {/if}
    <div
      class="partners__divider"
      style:opacity={lineUiProgress}
      style:transform={`scale3d(${lineUiProgress}, 1, 1)`}
    ></div>

    <IconPlus top={['1rem', '0.2rem']} left={['0']} hidden={isIconHidden} />
  </div>
</div>

<div
  class="cards"
  style:opacity={cardsOpacity}
  style:filter={`blur(${cardsBlur}px)`}
  style:transform={cardsTransform}
  bind:this={cardsEl}
>
  {#each Cards as card, index}
    <Card
      id={card.id}
      icon={card.icon}
      title={card.title}
      subtitle={card.subtitle}
      type={card.type}
      iconScale={card.iconScale ?? 1}
      index={index}
      total={Cards.length}
    />
  {/each}
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;

  .partners {
    position: relative;
    width: 100%;
    overflow: hidden;
    height: 100%;

    :global(h2) {
      @media (max-width: 700px) and (min-width: 550px) {
        font-size: 62px;
      }
    }

    @include breakpoint(desktop) {
      padding-left: $offset-content;
    }

    @include breakpoint(phone) {
      height: 101%;
      overflow: visible;
    }

    &__desc {
      position: absolute;
      line-height: 1.2;
      color: $color-text;

      .section-reveal-paragraph {
        will-change: transform;
      }

      @include breakpoint(desktop) {
        text-align: left;
        top: 43%;
        left: $offset-content;
        width: calc(100% - $offset-content);
      }

      @include breakpoint(not-desktop) {
        position: relative;
        top: 6.75rem;
      }

      @include breakpoint(phone) {
        top: 6rem;
      }

      p {
        margin-left: auto;
        color: $color-grey-300;

        @include breakpoint(desktop) {
          padding-top: 1rem;
        }

        @include breakpoint(tablet) {
          margin-left: 3rem;
        }

        @include breakpoint(phone) {
          margin-left: 1.675rem;
        }

        @media (min-width: 2245px) {
          max-width: 36ch;
          font-size: var(--text-2xl);
          line-height: var(--tw-leading, var(--text-2xl--line-height));
        }
      }
    }

    &__divider {
      display: none;

      @include breakpoint(desktop) {
        display: block;
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 1px;
        background-color: rgba(255, 255, 255, 0.2);
        transform: scaleX(0);
        transform-origin: right;
        will-change: transform, opacity;
      }
    }
  }

  :global(.partners .icon) {
    @include breakpoint(tablet) {
      top: 0;
      left: 0;
    }
  }

  .cards {
    position: absolute;
    top: 25%;
    left: 0;
    display: flex;
    gap: 1.25rem;
    transform-origin: left center;
    will-change: transform, opacity, filter;
    backface-visibility: hidden;

    @include breakpoint(desktop) {
      flex-direction: column;
      padding-top: 15svh;
      padding-bottom: 1.25rem;
      padding-left: $offset-x;
      top: 0;
    }

    @include breakpoint(not-desktop) {
      flex-direction: row;
      gap: 1rem;
      padding-left: 1rem;
      padding-right: 1rem;
    }

    @include breakpoint(phone) {
      top: 24%;
    }

    @include breakpoint(small-phone) {
      top: 32%;
    }
  }
</style>
