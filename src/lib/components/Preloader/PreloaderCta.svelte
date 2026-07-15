<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createPreloaderVisualizer } from './usePreloaderVisualizer';
  import { loadEnterWithSound, saveEnterWithSound } from '$lib/utils/soundPreference';

  const CURSOR_VISIBILITY_EVENT = 'cursor:set-hidden';

  let {
    ready = false,
    exiting = false,
    onStart
  }: {
    ready?: boolean;
    exiting?: boolean;
    onStart?: (withSound: boolean) => void;
  } = $props();

  let isEnterWithSound = $state(loadEnterWithSound(true));
  let isHoveringStart = false;
  let isPressingStart = $state(false);
  let svgEl: SVGSVGElement | undefined = $state();

  const visualizer = createPreloaderVisualizer(
    () => isEnterWithSound,
    () => isHoveringStart
  );

  $effect(() => {
    visualizer.attach(svgEl);
  });

  $effect(() => {
    if (!svgEl || !ready) {
      visualizer.stop();
      return;
    }

    visualizer.start();

    return () => {
      visualizer.stop();
    };
  });

  onDestroy(() => {
    visualizer.destroy();
    setCursorHidden(false);
  });

  function setCursorHidden(hidden: boolean) {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(
      new CustomEvent<{ hidden: boolean }>(CURSOR_VISIBILITY_EVENT, { detail: { hidden } })
    );
  }

  function handleStart() {
    onStart?.(isEnterWithSound);
  }

  function handleStartPointerEnter() {
    isHoveringStart = true;
    setCursorHidden(true);
  }

  function handleStartPointerLeave() {
    isHoveringStart = false;
    isPressingStart = false;
    setCursorHidden(false);
  }

  function handleStartPointerDown() {
    isPressingStart = true;
  }

  function handleStartPointerUp() {
    isPressingStart = false;
  }

  function toggleEnterWithSound() {
    isEnterWithSound = !isEnterWithSound;
    saveEnterWithSound(isEnterWithSound);
  }
</script>

<div
  class="preloader-btn-with-sound"
  class:preloader-btn-with-sound--ready={ready}
  class:preloader-btn-with-sound--exit={exiting}
>
  <button
    class="start"
    class:sound-on={isEnterWithSound}
    class:pressed={isPressingStart}
    onclick={toggleEnterWithSound}
    onpointerenter={handleStartPointerEnter}
    onpointerleave={handleStartPointerLeave}
    onpointerdown={handleStartPointerDown}
    onpointerup={handleStartPointerUp}
    onpointercancel={handleStartPointerUp}
    aria-label={isEnterWithSound ? 'Enter with sound' : 'Enter in silence'}
  >
    <svg bind:this={svgEl} class="start-canvas" aria-hidden="true"></svg>
  </button>
  <div class="preloader-with-sound-lines">
    <p class="preloader-with-sound-label-wrap">
      <span class="preloader-with-sound-label">
        {isEnterWithSound ? 'Enter with Sound' : 'Enter in Silence'}
      </span>
    </p>
    <p class="preloader-with-sound-label-wrap">
      <span class="preloader-with-sound-label">(Turn the sound on — It matters)</span>
    </p>
  </div>
  <button
    class="preloader-sound-toggle"
    class:preloader-sound-toggle--on={isEnterWithSound}
        onpointerenter={handleStartPointerEnter}
    onpointerleave={handleStartPointerLeave}
    onclick={handleStart}
    aria-label="start"
  >
    <span class="preloader-sound-toggle__text">
      Start
    </span>
  </button>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;

  .preloader-btn-with-sound {
    --cta-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.72);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    width: min(92vw, 360px);
    padding: 0 12px;
    gap: 8px;
    color: #a8aebc;
    line-height: 150%;
    opacity: 0;
    pointer-events: none;
    will-change: opacity, transform;
  }


  .preloader-btn-with-sound.preloader-btn-with-sound--ready {
    pointer-events: auto;
    animation: preloader-with-sound-wrap-in 0.86s var(--preloader-btn-ease)
      var(--preloader-with-sound-stagger) forwards;
  }

  .preloader-btn-with-sound.preloader-btn-with-sound--exit {
    animation: preloader-with-sound-wrap-out 0.6s var(--preloader-btn-ease) forwards;
    pointer-events: none;
  }

  .preloader-btn-with-sound.preloader-btn-with-sound--exit .start {
    animation: preloader-with-sound-button-out 0.54s var(--preloader-btn-ease) forwards;
  }

  .preloader-btn-with-sound.preloader-btn-with-sound--exit .preloader-with-sound-label {
    animation: preloader-with-sound-label-hide 0.5s var(--preloader-btn-ease) forwards;
  }

  .preloader-btn-with-sound.preloader-btn-with-sound--exit .preloader-sound-toggle {
    animation: preloader-sound-toggle-hide 0.45s var(--preloader-btn-ease) forwards;
  }

  .preloader-btn-with-sound button.start {
    position: relative;
    isolation: isolate;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    /* Ring is drawn by ::after box-shadow, not this border, to avoid the
       arc-join seam that border-radius:50% borders show at top/bottom. */
    --ring-color: rgba(222, 230, 244, 0.35);
    background:
      radial-gradient(80% 80% at 50% 24%, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0) 100%),
      linear-gradient(180deg, rgba(0, 0, 0, 0.85) 0%, rgba(180, 20, 20, 0.9) 100%);


    transform: scale(0.74);
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    will-change: transform, background, border-color, box-shadow, filter;
    transition:
      transform 0.42s cubic-bezier(0.16, 1, 0.3, 1),
      background 0.42s cubic-bezier(0.16, 1, 0.3, 1),
      border-color 0.42s cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 0.42s cubic-bezier(0.16, 1, 0.3, 1),
      filter 0.32s ease;

    &::before {
      content: '';
      position: absolute;
      inset: -7px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.12);
      opacity: 0;
      transform: scale(0.88);
      transition: transform 0.42s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.42s ease;
      pointer-events: none;
    }

    /* The visible 1px ring — a single continuous shadow, no corner-arc seam. */
    &::after {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px var(--ring-color);
      pointer-events: none;
      transition: box-shadow 0.42s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .start-canvas {
      width: 44.3px;
      height: 24px;
      display: block;
      overflow: visible;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }

    &:not(.sound-on) {
      --ring-color: rgba(168, 174, 188, 0.38);
      background:
        radial-gradient(80% 80% at 50% 24%, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0) 100%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(54, 58, 69, 0.5) 100%);

      .start-canvas {
        opacity: 0.58;
      }
    }

    &.sound-on {
      --ring-color: rgba(214, 86, 84, 0.42);
      background:
        radial-gradient(86% 76% at 50% 80%, rgba(196, 52, 50, 0.7) 0%, rgba(196, 52, 50, 0) 72%),
        linear-gradient(180deg, rgba(32, 12, 14, 0.96) 0%, rgba(150, 40, 42, 0.95) 100%);
      box-shadow:
        0 0 28px rgba(150, 32, 34, 0.22),
        0 0 66px 6px rgba(140, 26, 28, 0.18),
        inset 0 11px 20px rgba(0, 0, 0, 0.44);
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        transform: scale(1.08);
        --ring-color: rgba(255, 255, 255, 0.62);
        /* box-shadow:
          0 18px 42px rgba(0, 0, 0, 0.5),
          0 0 22px rgba(255, 255, 255, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.25); */

        &::before {
          opacity: 1;
          transform: scale(1);
        }
      }

      &.sound-on:hover {
        --ring-color: rgba(236, 110, 106, 0.5);
        background:
          radial-gradient(86% 76% at 50% 80%, rgba(220, 64, 60, 0.75) 0%, rgba(220, 64, 60, 0) 72%),
          linear-gradient(180deg, rgba(42, 16, 18, 0.96) 0%, rgba(172, 48, 48, 0.95) 100%);
        box-shadow:
          0 0 34px rgba(176, 38, 38, 0.28),
          0 0 80px 8px rgba(160, 30, 32, 0.22),
          inset 0 11px 20px rgba(0, 0, 0, 0.42);
      }
    }

    &.pressed,
    &:active {
      transform: scale(0.95);
      filter: saturate(1.12);
    }

    &:focus-visible {
      outline: none;
      --ring-color: rgba(255, 255, 255, 0.82);
      box-shadow:
        0 0 0 3px rgba(255, 255, 255, 0.16),
        0 0 0 6px rgba(230, 71, 73, 0.22),
        0 16px 40px rgba(0, 0, 0, 0.5);
    }
  }

  .preloader-with-sound-lines {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.28rem;
    line-height: 145%;
  }

  .preloader-with-sound-label-wrap {
    margin: 0;
    white-space: nowrap;

    &:first-of-type > span {
      color: #e5ebf5;
      text-align: center;
      font-family: $font-main;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 1.33rem;
      font-weight: 400;
      line-height: 110%;
      margin: 0.92rem 0 0.54rem;
    }

    &:last-of-type > span {
      color: #a8aebc;
      font-size: 0.875rem;
      font-weight: 400;
      line-height: 100%;
      letter-spacing: 0.03em;
      margin-bottom: 0.72rem;
    }
  }

  .preloader-with-sound-label {
    display: block;
    opacity: 0;
    transform: scale(0.82);
    will-change: transform, opacity;
  }

  .preloader-btn-with-sound.preloader-btn-with-sound--ready .start {
    transform: scale(1);
    transition:
      transform 0.6s var(--cta-bounce) var(--preloader-with-sound-stagger),
      background 0.42s cubic-bezier(0.16, 1, 0.3, 1),
      border-color 0.42s cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 0.42s cubic-bezier(0.16, 1, 0.3, 1),
      filter 0.32s ease;
  }

  .preloader-btn-with-sound.preloader-btn-with-sound--ready
    .preloader-with-sound-label-wrap:nth-child(1)
    .preloader-with-sound-label {
    animation: preloader-with-sound-label-reveal 0.75s var(--cta-bounce)
      calc(var(--preloader-with-sound-stagger) + 0.1s) forwards;
  }

  .preloader-btn-with-sound.preloader-btn-with-sound--ready
    .preloader-with-sound-label-wrap:nth-child(2)
    .preloader-with-sound-label {
    animation: preloader-with-sound-label-reveal 0.75s var(--cta-bounce)
      calc(var(--preloader-with-sound-stagger) + 0.2s) forwards;
  }

  .preloader-sound-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.44rem;
    margin-top: 0.2rem;
    padding: 0.42rem 0.72rem;
    border-radius: 999px;
    border: 1px solid rgba(168, 174, 188, 0.35);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(51, 55, 68, 0.72) 100%);
    color: rgba(175, 183, 198, 0.9);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.58rem;
    line-height: 1;
    opacity: 0;
    transform: scale(0.82);
    cursor: pointer;
    will-change: transform, opacity, border-color, background-color, color, box-shadow;
    transition:
      transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
      border-color 0.3s ease,
      color 0.3s ease,
      background 0.3s ease,
      box-shadow 0.3s ease;

    &:focus-visible {
      outline: none;
      border-color: rgba(255, 255, 255, 0.75);
      box-shadow:
        0 0 0 2px rgba(255, 255, 255, 0.2),
        0 0 0 4px rgba(230, 71, 73, 0.2);
    }
  }

  .preloader-sound-toggle__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .preloader-sound-toggle svg {
    width: 15px;
    height: 15px;
    display: block;
  }

  .preloader-sound-toggle svg path {
    stroke: currentColor;
    transition: stroke 0.3s ease;
  }

  .preloader-btn-with-sound.preloader-btn-with-sound--ready .preloader-sound-toggle {
    animation: preloader-sound-toggle-reveal 0.75s var(--cta-bounce)
      calc(var(--preloader-with-sound-stagger) + 0.3s) forwards;
  }

  .preloader-sound-toggle--on {
    border-color: rgba(230, 71, 73, 0.52);
    background: linear-gradient(180deg, rgba(230, 71, 73, 0.26) 0%, rgba(88, 36, 42, 0.74) 100%);
    color: rgba(255, 199, 199, 0.94);
    box-shadow: 0 8px 24px rgba(230, 71, 73, 0.14);
  }

  @media (hover: hover) and (pointer: fine) {
    .preloader-sound-toggle:hover {
      transform: translateY(-1px) scale(1.04);
      border-color: rgba(255, 255, 255, 0.56);
      color: rgba(235, 241, 252, 0.95);
      box-shadow: 0 12px 26px rgba(0, 0, 0, 0.4);
    }

    .preloader-sound-toggle.preloader-sound-toggle--on:hover {
      border-color: rgba(255, 178, 178, 0.68);
      color: rgba(255, 225, 225, 0.98);
      box-shadow:
        0 12px 28px rgba(0, 0, 0, 0.42),
        0 0 24px rgba(230, 71, 73, 0.2);
    }
  }

  @media (max-width: 1400px) {
    .preloader-btn-with-sound {
      gap: 6px;
      font-size: 0.9rem;
    }

    .preloader-btn-with-sound button.start {
      width: 52px;
      height: 52px;
    }
  }

  @media (max-width: 1024px) {
    .preloader-btn-with-sound {
      top: 50%;
      gap: 5px;
      font-size: 0.82rem;
      width: min(90vw, 300px);
      line-height: 145%;
    }

    .preloader-btn-with-sound button.start {
      width: 46px;
      height: 46px;
    }
  }

  @media (max-width: 640px) {
    .preloader-btn-with-sound {
      top: 50%;
      font-size: 0.7rem;
      width: min(88vw, 250px);
      line-height: 135%;
    }

    .preloader-btn-with-sound button.start {
      width: 40px;
      height: 40px;

      .start-canvas {
        width: 30px;
        height: 18px;
      }
    }

    .preloader-sound-toggle {
      padding: 0.34rem 0.58rem;
      font-size: 0.54rem;
      letter-spacing: 0.1em;
    }
  }

  @media (max-width: 555px) {
    .preloader-btn-with-sound {
      gap: 15px;

      p:last-of-type {
        display: none;
      }
    }

    //.preloader-sound-toggle__text {
    //  display: none;
    //}

    .preloader-sound-toggle {
      //padding: 0.42rem;
      //margin-top: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .preloader-btn-with-sound,
    .preloader-with-sound-label,
    .preloader-sound-toggle,
    .preloader-btn-with-sound .start {
      animation-duration: 0.01ms !important;
      animation-delay: 0ms !important;
      transition-duration: 0.01ms !important;
      filter: none !important;
    }

    .preloader-btn-with-sound {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }

    .preloader-with-sound-label,
    .preloader-sound-toggle {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes preloader-with-sound-wrap-in {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.72);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  @keyframes preloader-with-sound-wrap-out {
    from {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    to {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.96);
    }
  }

  @keyframes preloader-with-sound-label-reveal {
    from {
      opacity: 0;
      transform: scale(0.82);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes preloader-with-sound-label-hide {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.8);
    }
  }

  @keyframes preloader-with-sound-button-out {
    from {
      transform: scale(1);
      opacity: 1;
    }
    to {
      transform: scale(0.2);
      opacity: 0;
    }
  }

  @keyframes preloader-sound-toggle-reveal {
    from {
      opacity: 0;
      transform: scale(0.82);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes preloader-sound-toggle-hide {
    from {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateY(0) scale(0.88);
    }
  }
</style>
