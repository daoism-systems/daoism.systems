<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ContactForm from '$lib/components/ContactForm.svelte';
  import { headingReveal } from '$lib/utils/animations/headingReveal';
  import { hoverSound } from '$lib/utils/hoverSound';
  import { CONTACT_UI_TIMING } from '$lib/config/revealTiming';
  import { clamp01, getLinearBeatProgress } from '$lib/utils/animations/uiProgress';
  import { textReveal } from '$lib/utils/animations/textReveal';
  import Socials from '$lib/components/Socials.svelte';

  let { progress, isMobileTiming = false } = $props();

  const HIDDEN_EPSILON = 0.001;
  let timing = $derived(isMobileTiming ? CONTACT_UI_TIMING.mobile : CONTACT_UI_TIMING.desktop);

  const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3;
  const easeOutQuart = (x: number) => 1 - (1 - clamp01(x)) ** 4;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t);

  let sectionProgress = $derived(clamp01(progress));
  let clock = $derived(clamp01(sectionProgress / timing.revealWindow));
  let panelProgress = $derived(
    clamp01(sectionProgress / timing.panelRevealEnd)
  );

  let headingSlice = $derived(getLinearBeatProgress(clock, timing.beats.heading));
  let nameFieldSlice = $derived(
    getLinearBeatProgress(clock, timing.beats.nameField)
  );
  let emailFieldSlice = $derived(
    getLinearBeatProgress(clock, timing.beats.emailField)
  );
  let leadSlice = $derived(getLinearBeatProgress(clock, timing.beats.lead));
  let messageSlice = $derived(getLinearBeatProgress(clock, timing.beats.message));
  let submitSlice = $derived(getLinearBeatProgress(clock, timing.beats.submit));
  let lynksenSlice = $derived(getLinearBeatProgress(clock, timing.beats.lynksen));
  let socialsSlice = $derived(getLinearBeatProgress(clock, timing.beats.socials));
  let footerPrimarySlice = $derived(
    getLinearBeatProgress(clock, timing.beats.footerPrimary)
  );
  let footerSecondarySlice = $derived(
    getLinearBeatProgress(clock, timing.beats.footerSecondary)
  );

  let panelShow = $derived(easeOutCubic(panelProgress));
  let headingShow = $derived(easeOutCubic(headingSlice));
  let leadShow = $derived(easeOutCubic(leadSlice));
  let nameFieldShow = $derived(easeOutCubic(nameFieldSlice));
  let emailFieldShow = $derived(easeOutCubic(emailFieldSlice));
  let messageShow = $derived(easeOutCubic(messageSlice));
  let submitShow = $derived(easeOutQuart(submitSlice));
  let socialsShow = $derived(easeOutCubic(socialsSlice));

  // Container scales up from its bottom edge (transform-origin set in CSS) as it fades in.
  let panelScale = $derived(lerp(0.955, 1, panelShow));

  let isSectionHidden = $derived(clock <= HIDDEN_EPSILON);

  // Slide-up offsets locked to each block's eased fade (positive → 0, rising into place).
  // Travel escalates down the rows so the bottom-to-top motion reads clearly; the footer
  // rides up from off the bottom screen edge (large offset → starts below the viewport).
  let panelOffsetY = $derived((1 - panelShow) * 18);
  let headingOffsetY = $derived((1 - headingShow) * 24);
  let introCopyOffsetY = $derived((1 - leadShow) * 28);
  let socialsOffsetY = $derived((1 - socialsShow) * 40);

  let headingEl = $state<HTMLHeadingElement | null>(null);
  let driftFrame: number | null = null;
  let currentDriftX = 0;
  let currentDriftY = 0;
  let targetDriftX = 0;
  let targetDriftY = 0;
  let isPointerActive = false;
  const driftSmoothing = 0.11;
  const driftRange = 34;

  // Linear slice in; the action's own power3.out per-char curve shapes the feel.
  const headingRevealOptions = $derived({
    trigger: true,
    reversed: isSectionHidden,
    progress: headingSlice,
    ...timing.headingMotion
  });

  const footerPrimaryRevealOptions = $derived({
    progress: footerPrimarySlice,
    split: false,
    duration: timing.footerDuration,
    scrubProgressPower: 1.25,
    wordOffsetY: 72
  });

  const footerSecondaryRevealOptions = $derived({
    ...footerPrimaryRevealOptions,
    progress: footerSecondarySlice,
    wordOffsetY: 80
  });

  // "Website by Lynksen" rides row 3 (with the submit button); slides up like the rest.
  const lynksenRevealOptions = $derived({
    progress: lynksenSlice,
    split: false,
    duration: timing.footerDuration,
    scrubProgressPower: 1.25,
    wordOffsetY: 32
  });

  onMount(() => {
    applyHeadingSurface(0, 0);

    const handleWindowPointerMove = (event: PointerEvent) => {
      updatePointerDrift(event);
    };

    const handleWindowPointerLeave = () => {
      resetPointerDrift();
    };

    window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
    window.addEventListener('pointerleave', handleWindowPointerLeave);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerleave', handleWindowPointerLeave);
    };
  });

  onDestroy(() => {
    if (driftFrame !== null) {
      cancelAnimationFrame(driftFrame);
    }
  });

  function applyHeadingSurface(x: number, y: number) {
    if (!headingEl) return;

    const focusX = 50 + (x / driftRange) * 18;
    const focusY = 50 + (y / driftRange) * 24;
    const intensity = Math.min(Math.hypot(x, y) / driftRange, 1);
    const glowStrength = isPointerActive ? 0.2 + intensity * 0.15 : 0.16;
    const shadowStrength = isPointerActive ? 0.1 + intensity * 0.09 : 0.07;

    // Use Math.round to ease CSS rendering, .toFixed(2) only for alphas
    headingEl.style.setProperty('--contact-heading-drift-x', `${Math.round(x)}px`);
    headingEl.style.setProperty('--contact-heading-drift-y', `${Math.round(y)}px`);
    headingEl.style.setProperty('--contact-heading-focus-x', `${Math.round(focusX)}%`);
    headingEl.style.setProperty('--contact-heading-focus-y', `${Math.round(focusY)}%`);
    headingEl.style.setProperty('--contact-heading-glow-alpha', glowStrength.toFixed(2));
    headingEl.style.setProperty('--contact-heading-shadow-alpha', shadowStrength.toFixed(2));
  }

  function tickGradientDrift() {
    const deltaX = targetDriftX - currentDriftX;
    const deltaY = targetDriftY - currentDriftY;

    currentDriftX += deltaX * driftSmoothing;
    currentDriftY += deltaY * driftSmoothing;
    applyHeadingSurface(currentDriftX, currentDriftY);

    if (Math.abs(deltaX) < 0.08 && Math.abs(deltaY) < 0.08) {
      currentDriftX = targetDriftX;
      currentDriftY = targetDriftY;
      applyHeadingSurface(currentDriftX, currentDriftY);
      driftFrame = null;
      return;
    }

    driftFrame = requestAnimationFrame(tickGradientDrift);
  }

  function ensureGradientDrift() {
    if (driftFrame !== null) return;
    driftFrame = requestAnimationFrame(tickGradientDrift);
  }

  function updatePointerDrift(event: PointerEvent) {
    if (!headingEl || event.pointerType === 'touch') return;

    const normalizedX = event.clientX / window.innerWidth - 0.5;
    const normalizedY = event.clientY / window.innerHeight - 0.5;

    targetDriftX = normalizedX * driftRange;
    targetDriftY = normalizedY * driftRange;

    if (!isPointerActive) {
      isPointerActive = true;
      currentDriftX = targetDriftX * 0.2;
      currentDriftY = targetDriftY * 0.2;
      applyHeadingSurface(currentDriftX, currentDriftY);
    }

    ensureGradientDrift();
  }

  function resetPointerDrift() {
    isPointerActive = false;
    targetDriftX = 0;
    targetDriftY = 0;
    ensureGradientDrift();
  }
</script>

<div
  class="contact section__wrap"
  style:--contact-name-progress={nameFieldShow}
  style:--contact-email-progress={emailFieldShow}
  style:--contact-message-progress={messageShow}
  style:--contact-submit-progress={submitShow}
>
  <div
    class="contact__panel"
    style:opacity={panelShow}
    style:transform={`translate3d(0, ${panelOffsetY}px, 0) scale(${panelScale})`}
  >
    <div class="contact__content">
      <div class="contact__intro">
        <div>
          <h2
            bind:this={headingEl}
            class="contact__heading"
            use:headingReveal={headingRevealOptions}
            style:opacity={headingShow}
            style:transform={`translate3d(0, ${headingOffsetY}px, 0)`}
          >
            <span class="text-line">GET IN TOUCH</span>
          </h2>
          <p
            class="contact__lead"
            style:opacity={leadShow}
            style:transform={`translate3d(0, ${introCopyOffsetY}px, 0)`}
          >
            A few sentences is enough — we’ll take it from there.
          </p>
        </div>

        <div class="contact__left-meta">
          <a
            use:hoverSound
            use:textReveal={lynksenRevealOptions}
            href="https://www.lynksen.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Website by <span class="text-white">Lynksen</span>
          </a>
          <div
            class="contact__socials"
            style:opacity={socialsShow}
            style:transform={`translate3d(0, ${socialsOffsetY}px, 0)`}
          >
            <Socials />
          </div>
        </div>
      </div>

      <div class="contact__right">
        <!-- Form controls reveal in reading order through the CSS vars below. -->
        <div class="contact__form">
          <ContactForm />
        </div>

        <footer class="contact__footer">
          <p use:textReveal={footerPrimaryRevealOptions}>© 2026. All rights reserved.</p>
          <p use:textReveal={footerSecondaryRevealOptions}>
            <a class="contact__footer-link" use:hoverSound href="/privacy-policy">Privacy Policy</a>
          </p>
        </footer>
      </div>
    </div>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;

  .contact {
    position: relative;
    width: 100%;
    max-width: none;
    padding-top: $offset-content-top;
    height: 100%;
    display: flex;
    align-items: flex-end;

    &__panel {
      width: 100%;
      border: 0.5px solid #A8AEBC4D;
      background: rgba(8, 9, 14, 0.76);
      padding: 1.3rem 1.5rem 1rem;
      border-radius: 0.25rem;
      transform-origin: bottom center;
      will-change: transform, opacity;
    }

    &__content {
      display: grid;
      grid-template-columns: minmax(16rem, 50%) minmax(22rem, 1fr);
      gap: 1.4rem;
      align-items: start;
    }

    &__intro {
      min-height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 1rem;
    }

    &__heading {
      --contact-heading-gradient: linear-gradient(0deg, rgb(210 215 225), rgb(210 215 225));
      --contact-heading-drift-x: 0px;
      --contact-heading-drift-y: 0px;
      --contact-heading-focus-x: 50%;
      --contact-heading-focus-y: 50%;
      --contact-heading-glow-alpha: 0.16;
      --contact-heading-shadow-alpha: 0.07;
      font-family: 'KH Interference TRIAL';
      font-size: 3.6rem;
      font-weight: 400;
      line-height: 0.9;
      align-self: start;
      margin: 0;
      will-change: transform, opacity;

      + p {
        color: #A8AEBC;
        font-size: 0.9rem;
        font-weight: 400;
        line-height: 1.35;
        margin-top: 1rem;
        max-width: 50ch;
        text-wrap: pretty;
        word-spacing: $word-spacing;
      }

      @media (max-width: 1330px) {
        font-size: clamp(3.2rem, 7.4vw, 5.5rem);
      }
    }

    &__right {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      min-width: 0;
    }

    &__form {
      will-change: transform, opacity;
    }

    &__left-meta {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      color: #8a8f9d;
      font-size: 0.92rem;
      will-change: transform, opacity;
    }

    &__lead {
      will-change: transform, opacity;
    }

    &__socials {
      will-change: transform, opacity;
    }

    &__footer {
      margin-top: 0.25rem;
      color: $color-grey-100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      will-change: transform;
      font-size: 0.92rem;
    }

    &__footer p {
      margin: 0;
      white-space: nowrap;
    }

    &__footer-link {
      color: inherit;
      padding: 0;
      transition: color 0.25s ease;

      @media (hover: hover) and (pointer: fine) {
        &:hover {
          color: #fff;
        }
      }
    }

    @media (min-width: 2245px) {
      padding-top: 5.8rem;

      &__panel {
        padding: 1.8rem 2rem 1.4rem;
        border-radius: 0.35rem;
      }

      &__content {
        grid-template-columns: minmax(22rem, 1fr) minmax(42rem, 64rem);
        gap: 1.75rem;
      }

      &__heading {
        font-size: clamp(6.2rem, 7vw, 9.5rem);
        margin-top: 0.1rem;
      }

      &__footer {
        margin-top: 1.25rem;
        font-size: 1.12rem;
      }
    }

    @media (max-width: 1255px) {
      padding-top: 5.7rem;

      &__panel {
        padding: 1rem 1rem 0.85rem;
      }

      &__content {
        grid-template-columns: 1fr;
        gap: 1rem;
      }

      &__heading {
        font-size: clamp(2.9rem, 10vw, 5.25rem);
        margin-top: 0;
      }

      &__intro {
        gap: 0.85rem;
      }

      &__left-meta {
        margin-top: 0.25rem;
      }
    }

    @include breakpoint(phone) {
      padding-top: 3.3rem;

      &__panel {
        padding: 0.75rem;
      }

      &__heading {
        font-size: clamp(2.5rem, 12vw, 4rem);
      }

      &__footer {
        font-size: 0.72rem;
        word-spacing: normal;
        gap: 0.45rem;
      }
    }
  }

  :global(.contact .contact__heading .text-line) {
    display: block;
    width: fit-content;
    overflow: visible;
    line-height: 0.88;
  }

  :global(.contact .contact__heading .text-line + .text-line) {
    margin-top: -0.02em;
  }

  /* Solid fill instead of `background-clip: text`. The gradient here is a single
     flat color (rgb(210 215 225)), so a clipped fill is visually identical — but
     `-webkit-background-clip: text` under the promoted (will-change/transform)
     panel + heading layers triggers a Chromium raster bug that corrupts the glyph
     at the layer origin, rendering the heading's first letter as a solid box. */
  :global(.contact .contact__heading .char),
  :global(.contact .contact__heading) {
    color: rgb(210 215 225);
    -webkit-text-stroke: 0.35px rgba(221, 229, 246, 0.22);
  }

  :global(.contact .contact-form) {
    width: 100%;
  }

  :global(.contact .socials) {
    gap: 0.45rem;
  }

  :global(.contact .social-item) {
    width: 2.65rem;
    border: 1px solid rgba(168, 174, 188, 0.28);
    background: rgba(255, 255, 255, 0.08);
  }

  :global(.contact .social-item svg) {
    height: 0.92rem;
  }

  @media (hover: hover) and (pointer: fine) {
    :global(.contact .social-item:hover svg) {
      color: #000;
    }
  }

  :global(.contact .contact-form__cell:first-child) {
    opacity: var(--contact-name-progress, 1);
    transform: translate3d(0, calc((1 - var(--contact-name-progress, 1)) * 24px), 0);
  }

  :global(.contact .contact-form__cell:nth-child(2)) {
    opacity: var(--contact-email-progress, 1);
    transform: translate3d(0, calc((1 - var(--contact-email-progress, 1)) * 24px), 0);
  }

  /* Row 2 — the Message field (the only `.input-field` that's a direct child of the form). */
  :global(.contact .contact-form > .input-field) {
    opacity: var(--contact-message-progress, 1);
    transform: translate3d(0, calc((1 - var(--contact-message-progress, 1)) * 28px), 0);
  }

  /* Row 3 — the submit button. */
  :global(.contact .contact-form__submit) {
    opacity: var(--contact-submit-progress, 1);
    clip-path: inset(0 calc((1 - var(--contact-submit-progress, 1)) * 100%) 0 0);
  }
</style>
