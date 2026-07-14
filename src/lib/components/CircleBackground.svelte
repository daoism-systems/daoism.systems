<script lang="ts">
  import { useEyeTracking } from '$lib/hooks/useEyeTracking';
  import { getCircleVignetteSyncProgress } from '$lib/scene/animation/sceneProgress';

  // `progress` is RAW scene-progress (= Theatre position / 100). Phase windows on
  // that clock:
  //   Octagon (hero)       0.000 – 0.083
  //   Cubes  (About us)    0.083 – 0.136   → 3 circles + side lines (handoff #2)
  //   Pyramids (Services)  0.136 – 0.296   → 1 circle + eyes; clears at the vignette OUT (#3)
  // One continuous motion: the outer ring (circle 1) draws in as the octagon clears
  // and survives the whole way; circles 2 & 3 join during the cubes section and
  // retract as the pyramids/spotlight take over; the eyes fade in for the pyramid
  // phase. Tweak the numbers below to nudge each beat.
  // `debugGlobalProgress` is the raw 0–1 scroll fraction (pageProgress.globalProgress),
  // passed only so the debug log can show scroll alongside the Theatre/scene clock.
  let { progress, debugGlobalProgress } = $props();

  // The whole circle's SIZE is the container width % — ONE continuous motion across the scroll:
  //   CUBES    (< 0.127):          held at `cubesWidth` while the rings bloom outward (the
  //                                inside→outside reveal is the per-ring scale in revealRing).
  //   SNAP     (0.127 → 0.138):    contracts cubesWidth → spotlightWidth (outside → inside) on the
  //                                vignette RISE, landing tight exactly as vignetteIntensity reaches 3.
  //   HOLD     (0.138 → 0.25433):  stays at spotlightWidth while the vignette plateaus (3 → 3.4).
  //   END      (0.25433 → 0.296):  expands spotlightWidth → finalWidth (outside), the ring
  //                                sweeping past the viewport as the vignette opens.
  // 0.25433 / 0.296 are the NEW vignetteIntensity OUT keyframes (peak → open) in desktop.json,
  // so the ring clears together WITH the spotlight + eyes and doesn't linger onto Collaboration
  // (§3). eye_center ≈ 50 − 0.75·width%, so spotlightWidth 48 → eyes ~14% from each edge.
  const cubesWidth = 88; // outside (cubes)
  const spotlightWidth = 48; // inside (pyramids spotlight frame)
  const finalWidth = 130; // outside (expands past the viewport on exit)
  const contractStart = 0.127; // = Theatre 12s21f (cubes scale out): contraction begins as cubes clear
  const contractEnd = 0.138; // = vignetteIntensity hits 3 (pos 13.8): collapsed to 1 ring at spotlight width
  const expandStart = 0.25433; // vignette PEAK — ring holds tight to here, then expands out (OUT, untouched)
  const finalExpandEnd = 0.296; // vignette fully open — ring expanded + gone (OUT, untouched)

  // All three rings bloom outward TOGETHER during the cubes section (revealRing scales each
  // 0.2→1 from the centre = inside→outside). They are CONTINUOUS through to the spotlight; the
  // container width then drives the contract (pyramids) and the final expand-out (see above).
  //   • inner rings 2 & 3 collapse OUT during the snap (≈0.127 → 0.138), so by the time the
  //     vignette hits 3 only the single outer ring frames the spotlight.
  //   • the outer ring 1 fades OUT during the final expand (0.25433 → 0.296 = vignette OUT),
  //     so the ring sweeps past the viewport as the spotlight opens — gone before Collaboration.
  // The draw window (Start→End) is shifted LATER (was 0.05→0.11) so the bloom plays ON the cube
  // scale-up; its SPAN is unchanged (same inside→outside motion). Rings 2 & 3's undraw is pulled
  // into the snap window (0.127–0.138) so the collapse-to-1 lands with the vignette reaching 3;
  // ring 1's undraw stays locked to the vignette (0.25433 peak), untouched.
  const c1DrawStart = 0.07;
  const c1DrawEnd = 0.13;
  const c1UndrawStart = 0.25433;
  const c1UndrawEnd = 0.296;

  const c2DrawStart = 0.07;
  const c2DrawEnd = 0.13;
  const c2UndrawStart = 0.131;
  const c2UndrawEnd = 0.138;

  const c3DrawStart = 0.07;
  const c3DrawEnd = 0.13;
  const c3UndrawStart = 0.127;
  const c3UndrawEnd = 0.136;

  // Eyes fade IN on the raw clock so they reach full exactly as the vignette hits 3 — the reveal
  // window IS the contraction snap [eyeRevealStart, eyeRevealEnd], so the collapse-to-1 and the
  // eyes landing full happen together at 0.138, then hold. The fade-OUT still rides the LIVE
  // vignette clock (eyeProgress) UNTOUCHED: getCircleVignetteSyncProgress maps the vignette release
  // onto [circleSmallFadeOutStart, circleSmallRevealEnd] → raw ≈ 0.244 → 0.296.
  let eyeProgress = $derived(getCircleVignetteSyncProgress(progress));
  const eyeRevealStart = contractStart; // 0.127 — eyes begin as the cubes clear / contraction starts
  const eyeRevealEnd = contractEnd; // 0.138 — eyes fully visible as vignetteIntensity reaches 3
  const circleSmallFadeOutStart = 0.163; // = vignette release onset (~peak, pos ~25.4) in native units
  const circleSmallRevealEnd = 0.215; // = hiddenEnd; eyes gone as the vignette finishes opening (pos 29.6)

  // expo: hold bright through the spotlight, then drop off — mirrors vignetteIntensity's release
  let circleSmallOpacity = $derived(
    easeOutExpo(getProgress(progress, eyeRevealStart, eyeRevealEnd)) *
      (1 - easeInExpo(getProgress(eyeProgress, circleSmallFadeOutStart, circleSmallRevealEnd)))
  );

  function getProgress(p: number, start: number, end: number): number {
    if (p <= start) return 0;
    if (p >= end) return 1;
    return (p - start) / (end - start);
  }

  function easeInOutCubic(t: number): number {
    const clamped = Math.min(Math.max(t, 0), 1);
    return clamped < 0.5
      ? 4 * clamped * clamped * clamped
      : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
  }

  function easeOutExpo(t: number): number {
    const clamped = Math.min(Math.max(t, 0), 1);
    return clamped >= 1 ? 1 : 1 - Math.pow(2, -10 * clamped);
  }

  function easeInExpo(t: number): number {
    const clamped = Math.min(Math.max(t, 0), 1);
    return clamped <= 0 ? 0 : Math.pow(2, 10 * (clamped - 1));
  }

  function getPairDashArray(progressValue: number): string {
    const clamped = Math.min(Math.max(progressValue, 0), 1);
    if (clamped === 0) return '0 1';
    const half = clamped / 2;
    const gap = Math.max((1 - clamped) / 2, 0);
    // Keep decimals small for CSS parsing performance
    return `${half.toFixed(3)} ${gap.toFixed(3)} ${half.toFixed(3)} ${gap.toFixed(3)}`;
  }

  function easeOutCubic(t: number): number {
    const clamped = Math.min(Math.max(t, 0), 1);
    return 1 - Math.pow(1 - clamped, 3);
  }

  // CSS-style cubic-bezier easing with P0=(0,0), P3=(1,1) and control points P1=(x1,y1),
  // P2=(x2,y2). Given linear x∈[0,1] it solves bezierX(t)=x (binary search) then returns
  // bezierY(t). Lets the circle ease on the EXACT vignetteIntensity bezier handles.
  function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
    const cx = (t: number) => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3;
    const cy = (t: number) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3;
    return (x: number) => {
      const clamped = Math.min(Math.max(x, 0), 1);
      let lo = 0;
      let hi = 1;
      let t = clamped;
      for (let i = 0; i < 24; i++) {
        const dx = cx(t) - clamped;
        if (Math.abs(dx) < 1e-5) break;
        if (dx < 0) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
      return cy(t);
    };
  }

  // vignetteIntensity bezier segments (desktop.json), matched to the current keyframes:
  //   RISE = spotlight forming  (pos 11.867 → 13.8): cubic-bezier(0.5, 0,  0.45, 0.94)
  //   FALL = spotlight opening  (pos 25.433 → 29.6): cubic-bezier(0.23, 1, 0.32, 1)
  // The circle CONTRACTS on the rise easing and EXPANDS on the fall easing, so its scale moves
  // in lock-step with the spotlight.
  const easeVignetteRise = cubicBezier(0.5, 0, 0.45, 0.94);
  const easeVignetteFall = cubicBezier(0.23, 1, 0.32, 1);

  // Outward reveal (inside → outside): the ring grows from `ringScaleFrom` up to full size
  // while fading in, then fades out in place (no inward contraction). Used by all three rings
  // AND the outer frame, so the whole overlay emanates as one. `ringScaleFrom` is the knob —
  // 0 = born at the dead centre (strongest ping), 1 = pure fade with no growth.
  const ringScaleFrom = 0.2;
  function revealRing(
    p: number,
    drawStart: number,
    drawEnd: number,
    undrawStart: number,
    undrawEnd: number
  ): { scale: number; opacity: number } {
    const inT = easeOutCubic(getProgress(p, drawStart, drawEnd));
    const outT = easeInOutCubic(getProgress(p, undrawStart, undrawEnd));
    return {
      scale: ringScaleFrom + (1 - ringScaleFrom) * inT,
      opacity: Math.max(inT * (1 - outT), 0)
    };
  }

  // Short-circuit to avoid expensive repaints. The cubes bloom (inner rings c2/c3) starts the
  // sequence at c2DrawStart and the outer ring's finalize (c1) ends it at c1UndrawEnd, so
  // those two bound the whole lifetime; the eye window sits inside it, so this also gates the
  // container.
  let isCircleActive = $derived(progress >= c2DrawStart && progress <= c1UndrawEnd);
  let opacity = $derived(isCircleActive ? 1 : 0);

  // Container width = the circle's continuous scale (see the constants above): held big through
  // the cubes bloom, snap-contracts to the spotlight frame on the vignette RISE (done as it hits 3),
  // holds tight across the vignette plateau, then expands past the viewport on exit. The
  // contract/expand ease on the vignette's RISE and FALL bezier curves, so it tracks the spotlight.
  let width = $derived.by(() => {
    if (progress < contractStart) return cubesWidth;
    if (progress < contractEnd)
      return (
        cubesWidth +
        (spotlightWidth - cubesWidth) * easeVignetteRise(getProgress(progress, contractStart, contractEnd))
      );
    if (progress < expandStart) return spotlightWidth; // hold tight while the vignette plateaus (3 → 3.4)
    return (
      spotlightWidth +
      (finalWidth - spotlightWidth) * easeVignetteFall(getProgress(progress, expandStart, finalExpandEnd))
    );
  });

  // `firstRing` drives the WHOLE outer-frame unit (ring 1 + plus-markers + side-lines) so
  // the cross, the horizontal line and the outer circle stay locked together. All three
  // rings + the frame use the same revealRing, so they grow outward concentric and together.
  let firstRing = $derived(revealRing(progress, c1DrawStart, c1DrawEnd, c1UndrawStart, c1UndrawEnd));
  let secondRing = $derived(revealRing(progress, c2DrawStart, c2DrawEnd, c2UndrawStart, c2UndrawEnd));
  let thirdRing = $derived(revealRing(progress, c3DrawStart, c3DrawEnd, c3UndrawStart, c3UndrawEnd));

  // Eye small ring draws in with the snap (raw clock, = contraction window); 0 outside → '0 1' (hidden).
  let circleSmallDashArray = $derived(getPairDashArray(Math.max(getProgress(progress, eyeRevealStart, eyeRevealEnd), 0)));

  // Eye tracking
  const eyeTracking = useEyeTracking();
  const _leftEye = eyeTracking?.leftEye;
  const _rightEye = eyeTracking?.rightEye;
  const setLeftEyeElem = eyeTracking?.setLeftEyeElem;
  const setRightEyeElem = eyeTracking?.setRightEyeElem;
  const pupilMax = eyeTracking?.pupilMax ?? 0;
  const defaultEye: { x: number; y: number } = { x: 0, y: 0 };
  let leftEyePos = $derived(_leftEye ? $_leftEye ?? defaultEye : defaultEye);
  let rightEyePos = $derived(_rightEye ? $_rightEye ?? defaultEye : defaultEye);

  function leftEyeAction(node: HTMLDivElement) {
    setLeftEyeElem?.(node);
    return {};
  }

  function rightEyeAction(node: HTMLDivElement) {
    setRightEyeElem?.(node);
    return {};
  }

  function getPupilTransform(eye: { x: number; y: number }): string {
    const premiumRange = pupilMax * 0.42;
    return `translate3d(-50%, -50%, 0) translate3d(${(eye.x * premiumRange).toFixed(1)}px, ${(eye.y * premiumRange).toFixed(1)}px, 0)`;
  }
</script>

<div
  class="circle-background"
  style="opacity: {opacity};"
>
  <div
    class="circle-background__item"
    style="width: {width}%;"
  >
    <!-- Outer frame: ring 1 + plus-markers + side-lines scale as ONE unit (via firstRing)
         so the cross, the horizontal line and the outer circle stay perfectly in sync. -->
    <div
      class="outer-frame"
      style="opacity: {firstRing.opacity}; transform: scale3d({firstRing.scale}, {firstRing.scale}, 1);"
    >
    <svg class="circle" viewBox="0 0 1402 900" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g opacity="0.5">
        <circle cx="701" cy="450" r="700" pathLength="1" stroke="url(#paint0_linear_4729_15154)" stroke-width="1.00286" stroke-linecap="round" />
        <circle cx="701" cy="450" r="700" pathLength="1" stroke="url(#paint0_linear_4729_15154)" stroke-width="1.00286" stroke-linecap="round" transform="translate(0 900) scale(1 -1)" />
      </g>
      <defs>
        <linearGradient id="paint0_linear_4729_15154" x1="701" y1="24.392" x2="701" y2="881.116" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0" />
          <stop offset="0.5" stop-color="white" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>

    <span class="icon-plus icon-plus--left">
      <svg viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.62 0.5H12.38V22.5H10.62V0.5Z" fill="currentColor" />
        <path d="M22.5 10.62V12.38L0.5 12.38L0.5 10.62L22.5 10.62Z" fill="currentColor" />
        <path d="M7.76645 11.06L11.5 7.32648L15.2335 11.06L11.5 14.7935L7.76645 11.06Z" fill="currentColor" />
      </svg>
    </span>

    <span class="icon-plus icon-plus--right">
      <svg viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.62 0.5H12.38V22.5H10.62V0.5Z" fill="currentColor" />
        <path d="M22.5 10.62V12.38L0.5 12.38L0.5 10.62L22.5 10.62Z" fill="currentColor" />
        <path d="M7.76645 11.06L11.5 7.32648L15.2335 11.06L11.5 14.7935L7.76645 11.06Z" fill="currentColor" />
      </svg>
    </span>

    <span class="line line--left"></span>
    <span class="line line--right"></span>
    </div>

    <svg class="circle" viewBox="0 0 1034 900" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity: {secondRing.opacity}; transform: translate3d(-50%, -50%, 0) scale3d({secondRing.scale}, {secondRing.scale}, 1);">
      <g opacity="0.5">
        <circle cx="517" cy="450" r="516" pathLength="1" stroke="url(#paint0_linear_4729_15256)" stroke-opacity="0.8" stroke-width="1" stroke-linecap="round" />
        <circle cx="517" cy="450" r="516" pathLength="1" stroke="url(#paint0_linear_4729_15256)" stroke-opacity="0.8" stroke-width="1" stroke-linecap="round" transform="translate(0 900) scale(1 -1)" />
      </g>
      <defs>
        <linearGradient id="paint0_linear_4729_15256" x1="517" y1="136.266" x2="517" y2="767.794" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0" />
          <stop offset="0.5" stop-color="white" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
    <svg class="circle" viewBox="0 0 1402 900" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity: {thirdRing.opacity}; transform: translate3d(-50%, -50%, 0) scale3d({thirdRing.scale}, {thirdRing.scale}, 1);">
      <g style={'mix-blend-mode:difference'} opacity="0.8">
        <circle cx="701" cy="450" r="700" pathLength="1" stroke="url(#paint0_linear_4729_15154)" stroke-width="1" stroke-linecap="round" />
        <circle cx="701" cy="450" r="700" pathLength="1" stroke="url(#paint0_linear_4729_15154)" stroke-width="1" stroke-linecap="round" transform="translate(0 900) scale(1 -1)" />
      </g>
      <defs>
        <linearGradient id="paint0_linear_4729_15154" x1="701" y1="24.392" x2="701" y2="881.116" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0" />
          <stop offset="0.5" stop-color="white" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>

    <div
      class="circle-small circle-small--left"
      style="opacity: {circleSmallOpacity};"
    >
      <div class="eye min-[2245px]:!w-[6rem]" use:leftEyeAction>
        <svg viewBox="0 0 30 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: {getPupilTransform(leftEyePos)};">
          <path d="M29.9137 9.595C29.87 9.49625 28.8112 7.1475 26.4575 4.79375C23.3212 1.6575 19.36 0 15 0C10.64 0 6.67874 1.6575 3.54249 4.79375C1.18874 7.1475 0.124988 9.5 0.086238 9.595C0.0293795 9.72289 0 9.86129 0 10.0012C0 10.1412 0.0293795 10.2796 0.086238 10.4075C0.129988 10.5062 1.18874 12.8538 3.54249 15.2075C6.67874 18.3425 10.64 20 15 20C19.36 20 23.3212 18.3425 26.4575 15.2075C28.8112 12.8538 29.87 10.5062 29.9137 10.4075C29.9706 10.2796 30 10.1412 30 10.0012C30 9.86129 29.9706 9.72289 29.9137 9.595ZM15 15C14.0111 15 13.0444 14.7068 12.2221 14.1573C11.3999 13.6079 10.759 12.827 10.3806 11.9134C10.0022 10.9998 9.90314 9.99445 10.0961 9.02455C10.289 8.05464 10.7652 7.16373 11.4645 6.46447C12.1637 5.7652 13.0546 5.289 14.0245 5.09607C14.9944 4.90315 15.9998 5.00216 16.9134 5.3806C17.827 5.75904 18.6079 6.3999 19.1573 7.22215C19.7067 8.04439 20 9.01109 20 10C20 11.3261 19.4732 12.5979 18.5355 13.5355C17.5978 14.4732 16.3261 15 15 15Z" fill="black" />
        </svg>
      </div>
      <div class="circle-small__title min-[2245px]:!text-3xl">Hover to explore</div>
      <div class="circle-small__text text-sm min-[2245px]:!text-2xl">
        <h6>On-Chain Solutions</h6>
        <p>Custom design and implementation of on-chain systems: smart contracts, DAOs, and DeFi protocols engineered end to end across web3.</p>
      </div>
      <svg class="circle-small__circle" viewBox="0 0 1402 900" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g opacity="0.8">
          <circle cx="701" cy="450" r="700" pathLength="1" stroke-dasharray={circleSmallDashArray} stroke="url(#paint0_linear_4729_15154)" stroke-width="1" stroke-linecap="round" />
          <circle cx="701" cy="450" r="700" pathLength="1" stroke-dasharray={circleSmallDashArray} stroke="url(#paint0_linear_4729_15154)" stroke-width="1" stroke-linecap="round" transform="translate(0 900) scale(1 -1)" />
        </g>
        <defs>
          <linearGradient id="paint0_linear_4729_15154" x1="701" y1="24.392" x2="701" y2="881.116" gradientUnits="userSpaceOnUse">
            <stop stop-color="white" stop-opacity="0" />
            <stop offset="0.5" stop-color="white" />
            <stop offset="1" stop-color="white" stop-opacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
    <div
      class="circle-small circle-small--right"
      style="opacity: {circleSmallOpacity};"
    >
      <div class="eye min-[2245px]:!w-[6rem]" use:rightEyeAction>
        <svg viewBox="0 0 30 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: {getPupilTransform(rightEyePos)};">
          <path d="M29.9137 9.595C29.87 9.49625 28.8112 7.1475 26.4575 4.79375C23.3212 1.6575 19.36 0 15 0C10.64 0 6.67874 1.6575 3.54249 4.79375C1.18874 7.1475 0.124988 9.5 0.086238 9.595C0.0293795 9.72289 0 9.86129 0 10.0012C0 10.1412 0.0293795 10.2796 0.086238 10.4075C0.129988 10.5062 1.18874 12.8538 3.54249 15.2075C6.67874 18.3425 10.64 20 15 20C19.36 20 23.3212 18.3425 26.4575 15.2075C28.8112 12.8538 29.87 10.5062 29.9137 10.4075C29.9706 10.2796 30 10.1412 30 10.0012C30 9.86129 29.9706 9.72289 29.9137 9.595ZM15 15C14.0111 15 13.0444 14.7068 12.2221 14.1573C11.3999 13.6079 10.759 12.827 10.3806 11.9134C10.0022 10.9998 9.90314 9.99445 10.0961 9.02455C10.289 8.05464 10.7652 7.16373 11.4645 6.46447C12.1637 5.7652 13.0546 5.289 14.0245 5.09607C14.9944 4.90315 15.9998 5.00216 16.9134 5.3806C17.827 5.75904 18.6079 6.3999 19.1573 7.22215C19.7067 8.04439 20 9.01109 20 10C20 11.3261 19.4732 12.5979 18.5355 13.5355C17.5978 14.4732 16.3261 15 15 15Z" fill="black" />
        </svg>
      </div>

      <div class="circle-small__title min-[2245px]:text-3xl!">Hover to explore</div>
      <div class="circle-small__text text-sm min-[2245px]:text-2xl!">
        <h6>Consultancy</h6>
        <p>Advisory, architecture, and maintenance for precise system requirements, from protocol design reviews to ongoing on-chain support.</p>
      </div>
      <svg class="circle-small__circle" viewBox="0 0 1402 900" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g opacity="0.8">
          <circle cx="701" cy="450" r="700" pathLength="1" stroke-dasharray={circleSmallDashArray} stroke="url(#paint0_linear_4729_15154)" stroke-width="1" stroke-linecap="round" />
          <circle cx="701" cy="450" r="700" pathLength="1" stroke-dasharray={circleSmallDashArray} stroke="url(#paint0_linear_4729_15154)" stroke-width="1" stroke-linecap="round" transform="translate(0 900) scale(1 -1)" />
        </g>
        <defs>
          <linearGradient id="paint0_linear_4729_15154" x1="701" y1="24.392" x2="701" y2="881.116" gradientUnits="userSpaceOnUse">
            <stop stop-color="white" stop-opacity="0" />
            <stop offset="0.5" stop-color="white" />
            <stop offset="1" stop-color="white" stop-opacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;

  .circle-background {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 3;
    /* transition: opacity ... removed because JS scrubs it */
    -webkit-transform: translateZ(0);
    transform: translateZ(0);
    contain: layout style;

    &__item {
      position: absolute;
      top: 50%;
      left: 50%;
      aspect-ratio: 1;
      transform: translate3d(-50%, -50%, 0); /* Upgraded */
      /* transition: width ... removed because JS scrubs it */
      will-change: width; /* Optimization for width repaints */
    }

    /* Ring 1 + plus-markers + side-lines, scaled as one unit. Fills __item so its
       children keep the same positions; scales about its centre (= __item centre). */
    .outer-frame {
      position: absolute;
      inset: 0;
      transform-origin: center;
      will-change: transform, opacity;
    }

    .circle {
      position: absolute;
      top: 50%;
      left: 50%;
      /* transform/opacity scrubbed inline (scale-from-centre reveal) — no transition
         so it stays in lock-step with scroll */
      transform: translate3d(-50%, -50%, 0); /* base; inline transform adds the scale */
      border-radius: 50%;
      aspect-ratio: 1;
      will-change: transform, opacity; /* Protect SVG painting */

      &:nth-child(1) { width: 100%; }
      &:nth-child(2) { width: 80%; }
      &:nth-child(3) { width: 60%; }
    }

    .icon-plus {
      position: absolute;
      width: 1.1rem;
      aspect-ratio: 1;
      color: #fff;
      top: 50%;
      margin: -0.55rem;

      @include breakpoint(tablet) {
        width: 3.5rem;
        margin: -1.75rem;
      }

      &--left { left: 0; }
      &--right { right: 0; }
    }

    .line {
      position: absolute;
      width: 20vw;
      height: 1px;
      top: 50%;
      /* Removed transition opacity, upgraded to will-change transform */
      will-change: transform, opacity;
      opacity: 1;

      &--left {
        right: 100%;
        transform-origin: right center;
        background: linear-gradient(to left, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0));
      }
      &--right {
        left: 100%;
        transform-origin: left center;
        background: linear-gradient(to right, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0));
      }
    }
  }

  .circle-small {
    position: absolute;
    top: 50%;
    right: 100%;
    width: 50%;
    aspect-ratio: 1;
    transform: translate3d(0, -50%, 0); /* Upgraded */
    /* opacity is scrubbed inline (expo, scroll-driven) to stay in sync with the
       vignette open — a time-based transition here would lag/desync it */
    color: #fff;

    @include breakpoint(not-desktop) {
      display: none;
    }

    .circle-small__title {
      min-width: 143px;
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        .circle-small__title,
        .eye {
          opacity: 0;
          /* Upgraded scale to scale3d to prevent layout thrashing */
          transform: translate3d(-50%, -50%, 0) scale3d(0.7, 0.7, 1);
          transition: opacity 0.3s ease-out, transform 0.3s ease-out;
        }

        .circle-small__text {
          opacity: 1;
          transition: opacity 0.3s ease-out 0.2s;
        }
      }
    }

    &--right {
      left: 100%;
      right: auto;
    }

    .eye {
      background: #fff;
      aspect-ratio: 1;
      border-radius: 50%;
      position: absolute;
      width: 3.3rem;
      top: 50%;
      left: 50%;
      transform: translate3d(-50%, -50%, 0) scale3d(1, 1, 1); /* Upgraded */
      transition: opacity 0.3s ease-out, transform 0.3s ease-out;
      box-shadow:
        0 10px 30px rgba(0, 0, 0, 0.18),
        inset 0 1px 0 rgba(255, 255, 255, 0.8);

      svg {
        position: absolute;
        z-index: 2;
        top: 50%;
        left: 50%;
        width: 50%;
        transform-origin: center;
        color: #000;
        transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
        -webkit-transform: translateZ(0);
        backface-visibility: hidden;
      }
    }

    &__circle {
      width: 100%;
      aspect-ratio: 1;
    }

    &__title {
      color: $color-grey-300;
      position: absolute;
      top: 62%;
      left: 50%;
      transform: translate3d(-50%, 0, 0); /* Upgraded */
      transition: opacity 0.3s ease-out, transform 0.3s ease-out;
    }

    &__text {
      opacity: 0;
      position: absolute;
      text-align: center;
      top: 50%;
      left: 50%;
      width: 28ch;
      max-width: 28ch;
      pointer-events: none;
      transform: translate3d(-50%, -50%, 0); /* Upgraded */
      transition: opacity 0.3s ease-out;
      font-family: $font-main;
      font-variant-ligatures: none;
      word-spacing: 0.1em;

      h6 {
        color: #fff;
        margin-bottom: 0.6rem;
        font-family: inherit;
        display: block;
        width: 100%;
      }

      p {
        color: $color-grey-300;
        font-family: inherit;
        display: block;
        width: 100%;
      }
    }
  }
</style>
