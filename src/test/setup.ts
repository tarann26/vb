import '@testing-library/jest-dom/vitest';

// jsdom does not implement matchMedia. Components that read motion/contrast
// preferences (e.g. usePrefersReducedMotion) need a default so tests that
// don't care about the preference can render without stubbing it themselves.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
