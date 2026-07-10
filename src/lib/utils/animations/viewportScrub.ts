import { clamp } from './helpers';

type ScrubParams = {
  yOffset?: number;
  startViewport?: number;
  endViewport?: number;
};

export function viewportScrub(node: HTMLElement, params: ScrubParams = {}) {
  let rafId = 0;
  let isInViewport = false;
  let intersectionObserver: IntersectionObserver | null = null;
  
  const yOffset = params.yOffset ?? 32;
  const startVw = params.startViewport ?? 1; // Start animating when top enters viewport
  const endVw = params.endViewport ?? 0.6;   // Finish animating when 60% up the screen

  // Hardware acceleration hint
  node.style.willChange = 'transform, opacity';
  node.style.transform = `translate3d(0, ${yOffset}px, 0)`;
  node.style.opacity = '0';

  const updateDOM = () => {
    if (!isInViewport) return;

    const rect = node.getBoundingClientRect();
    const vh = window.innerHeight || 1;
    
    const startY = vh * startVw;
    const endY = vh * endVw;
    const distance = Math.max(startY - endY, 1);
    
    // Calculate progress 0 to 1
    const progress = clamp(0, 1, (startY - rect.top) / distance);

    // Apply directly to DOM, bypassing Svelte entirely
    const currentY = (1 - progress) * yOffset;
    node.style.opacity = progress.toString();
    node.style.transform = `translate3d(0, ${currentY}px, 0)`;

    rafId = requestAnimationFrame(updateDOM);
  };

  if (typeof IntersectionObserver !== 'undefined') {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        isInViewport = entries[0].isIntersecting;
        if (isInViewport) {
          rafId = requestAnimationFrame(updateDOM);
        } else {
          cancelAnimationFrame(rafId);
        }
      },
      { threshold: 0 } // Triggers just before entering viewport
    );
    intersectionObserver.observe(node);
  }

  return {
    update(newParams: ScrubParams) {
      // Allow dynamic updates if necessary
    },
    destroy() {
      cancelAnimationFrame(rafId);
      intersectionObserver?.disconnect();
    }
  };
}
