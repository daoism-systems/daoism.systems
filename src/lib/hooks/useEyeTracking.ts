import { onMount } from 'svelte';
import { writable, type Writable } from 'svelte/store';

export interface EyePosition {
  x: number;
  y: number;
}

export function useEyeTracking() {
  const leftEye = writable<EyePosition>({ x: 0, y: 0 });
  const rightEye = writable<EyePosition>({ x: 0, y: 0 });

  const leftEyeRef = { current: null as HTMLDivElement | null };
  const rightEyeRef = { current: null as HTMLDivElement | null };

  const setLeftEyeElem = (el: HTMLDivElement) => {
    leftEyeRef.current = el;
  };

  const setRightEyeElem = (el: HTMLDivElement) => {
    rightEyeRef.current = el;
  };

  const eyeRadius = (3.3 * 16) / 2;
  const pupilMax = eyeRadius * 0.45;

  const leftCurrent = { x: 0, y: 0 };
  const rightCurrent = { x: 0, y: 0 };
  const leftTarget = { x: 0, y: 0 };
  const rightTarget = { x: 0, y: 0 };

  const deadZone = 0.12;
  const smoothing = 0.24;
  const settleThreshold = 0.002;
  let rafId: number | null = null;

  function mapOffset(dx: number, dy: number): EyePosition {
    const len = Math.hypot(dx, dy);
    if (len === 0) return { x: 0, y: 0 };

    const clamped = Math.min(len, 1);
    const normalized = Math.max((clamped - deadZone) / (1 - deadZone), 0);
    // Eased response keeps center calm and edges intentional.
    const eased = 1 - Math.pow(1 - normalized, 3);
    const scale = eased / len;

    return {
      x: dx * scale,
      y: dy * scale
    };
  }

  function getEyeOffset(mouseX: number, mouseY: number, eyeElem: HTMLDivElement): EyePosition {
    const rect = eyeElem.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (mouseX - cx) / (rect.width / 2);
    const dy = (mouseY - cy) / (rect.height / 2);
    return mapOffset(dx, dy);
  }

  function animateEye(
    current: EyePosition,
    target: EyePosition,
    store: Writable<EyePosition>
  ): boolean {
    current.x += (target.x - current.x) * smoothing;
    current.y += (target.y - current.y) * smoothing;
    store.set({ x: current.x, y: current.y });

    return (
      Math.abs(target.x - current.x) > settleThreshold ||
      Math.abs(target.y - current.y) > settleThreshold
    );
  }

  function ensureAnimation() {
    if (rafId !== null) return;

    const frame = () => {
      const leftMoving = animateEye(leftCurrent, leftTarget, leftEye);
      const rightMoving = animateEye(rightCurrent, rightTarget, rightEye);

      if (leftMoving || rightMoving) {
        rafId = window.requestAnimationFrame(frame);
      } else {
        rafId = null;
      }
    };

    rafId = window.requestAnimationFrame(frame);
  }

  function updateTargets(mouseX: number, mouseY: number) {
    if (leftEyeRef.current) {
      const next = getEyeOffset(mouseX, mouseY, leftEyeRef.current);
      leftTarget.x = next.x;
      leftTarget.y = next.y;
    }
    if (rightEyeRef.current) {
      const next = getEyeOffset(mouseX, mouseY, rightEyeRef.current);
      rightTarget.x = next.x;
      rightTarget.y = next.y;
    }

    ensureAnimation();
  }

  function handleMouseMove(e: MouseEvent) {
    updateTargets(e.clientX, e.clientY);
  }

  function resetTargets() {
    leftTarget.x = 0;
    leftTarget.y = 0;
    rightTarget.x = 0;
    rightTarget.y = 0;
    ensureAnimation();
  }

  onMount(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', resetTargets);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', resetTargets);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  });

  return {
    leftEye,
    rightEye,
    setLeftEyeElem,
    setRightEyeElem,
    pupilMax
  };
}
