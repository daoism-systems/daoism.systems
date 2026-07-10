export function pauseWhenHidden(node: HTMLElement) {
  // Ensure we only run this in the browser
  if (typeof window === 'undefined' || !window.IntersectionObserver) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const isVisible = entries[0].isIntersecting;
      
      // We toggle a data attribute so we can target it cleanly in SCSS
      if (isVisible) {
        node.dataset.animated = 'true';
      } else {
        node.dataset.animated = 'false';
      }
    },
    { threshold: 0 } // Triggers the moment 1px goes off-screen
  );

  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
    }
  };
}
