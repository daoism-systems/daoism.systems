<script lang="ts">
  import Card from '$lib/components/Card.svelte';
  import Heading from '$lib/components/Heading.svelte';
  import IconPlus from '$lib/components/IconPlus.svelte';
  import { onMount } from 'svelte';
  import { clamp01, getPhaseProgress, getUiProgress } from '$lib/utils/animations/uiProgress';
  import { textReveal } from '$lib/utils/animations/textReveal';

  let { progress } = $props();

  const HIDDEN_EPSILON = 0.001;
  const HEADING_HIDE_START = 0.86;
  const HEADING_HIDE_END = 0.98;

  let sectionProgress = $derived(clamp01(progress));
  let uiProgress = $derived(getUiProgress(sectionProgress));
  let headingUiProgress = $derived(
    getUiProgress(sectionProgress, { hideStart: HEADING_HIDE_START, hideEnd: HEADING_HIDE_END })
  );
  let paragraphUiProgress = $derived(getPhaseProgress(uiProgress, 0.08, 0.82));
  let lineUiProgress = $derived(getPhaseProgress(uiProgress, 0.04, 0.86));
  let isSectionHidden = $derived(uiProgress <= HIDDEN_EPSILON);
  let paragraphOffsetY = $derived((1 - paragraphUiProgress) * 24);

  const headingRevealConfig = $derived({
    progress: headingUiProgress,
    duration: 0.58,
    stagger: 0.01
  });

  const paragraphRevealOptions = $derived({
    progress: paragraphUiProgress,
    duration: 1.1,
    scrubProgressPower: 1.25
  });

  // Cards Scroll Logic
  let cardsEl = $state<HTMLElement | null>(null);
  let isDesktop = $state(false);
  let moveY = $state(0);
  let moveX = $state(0);
  let smoothedSectionProgress = $state(0);
  let cardsFrame = 0;
  let cardsFrameTime = 0;
  const cardsSmoothingMs = 120;
  let cardsTransform = $derived.by(() => {
    const clampedProgress = smoothedSectionProgress;
    return isDesktop
      ? `translate3d(0, -${moveY * clampedProgress}px, 0)`
      : `translate3d(-${moveX * clampedProgress}px, 0, 0)`;
  });

  onMount(() => {
    const cards = cardsEl;
    if (!cards) return;

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
      const alpha = 1 - Math.exp(-frameDeltaMs / cardsSmoothingMs);
      smoothedSectionProgress += (sectionProgress - smoothedSectionProgress) * alpha;
      if (Math.abs(sectionProgress - smoothedSectionProgress) < 0.0005) {
        smoothedSectionProgress = sectionProgress;
      }
      cardsFrame = requestAnimationFrame(animateCards);
    };

    updateMeasurements();
    smoothedSectionProgress = sectionProgress;
    cardsFrame = requestAnimationFrame(animateCards);

    window.addEventListener('resize', updateMeasurements);
    return () => {
      window.removeEventListener('resize', updateMeasurements);
      cancelAnimationFrame(cardsFrame);
    };
  });

  const Cards = [
    { id: '01', title: 'Company Name', subtitle: 'DoinGud', type: 'Customer', icon: '/icons/iconPartner1.svg' },
    { id: '02', title: 'Company Name', subtitle: 'PrimeDAO', type: 'Customer', icon: '/icons/iconPartner2.svg' },
    { id: '03', title: 'Company Name', subtitle: 'Balancer', type: 'Customer', icon: '/icons/iconPartner3.svg' },
    { id: '04', title: 'Company Name', subtitle: 'The DAOist', type: 'Customer', icon: '/daoist.gif' },
    { id: '05', title: 'Company Name', subtitle: 'Ceramic Network', type: 'Customer', icon: '/icons/iconPartner4.png' },
    { id: '06', title: 'Company Name', subtitle: 'Safe', type: 'Customer', icon: '/icons/iconPartnerSafe.svg' }
  ];
</script>

<div class="partners">
  <Heading
    className="partners"
    text={['Teams we previously', 'worked with']}
    sup="5"
    position="bottom"
    progress={sectionProgress}
    headingRevealConfig={headingRevealConfig}
  />

  <div class="partners__desc">
    <p
      class="section-reveal-paragraph"
      style:transform={`translate3d(0, ${paragraphOffsetY}px, 0)`}
      use:textReveal={paragraphRevealOptions}
    >
        We work through interdependence — your goals become our requirements.
    </p>
    <div
      class="partners__divider"
      style:opacity={lineUiProgress}
      style:transform={`scale3d(${lineUiProgress}, 1, 1)`}
    ></div>

    <IconPlus top={['1rem', '0.2rem']} left={['0']} hidden={isSectionHidden} />
  </div>
</div>

<div class="cards" style="transform: {cardsTransform}" bind:this={cardsEl}>
  {#each Cards as card, index}
    <Card
      id={card.id}
      icon={card.icon}
      title={card.title}
      subtitle={card.subtitle}
      type={card.type}
      index={index}
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
    will-change: transform;
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
      top: 29%;
    }

    @include breakpoint(small-phone) {
      top: 32%;
    }
  }
</style>
