import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import galleriesJson from '../content/galleries.json';
import sectionsJson from '../content/sections.json';

// All seven renderImage call sites keep `key` on a real element the
// component itself returns (a wrapping <div> at six sites, <Fragment
// key={idx}> at OurStory.tsx:42) -- never inside the props object handed to
// renderImage. That is correct today and nothing enforced it: moving `key`
// from PlaceGallery.tsx:20's div into the props object leaves the rest of
// the suite fully green, because React only *logs* a warning for a missing
// list key (via console.error, in dev builds) rather than throwing, and a
// missing key never changes rendered output, so the byte test (which can
// only ever see markup) cannot see it either. Task 3/4 rewrite exactly
// these seven call sites to add editing overlays, which is exactly the kind
// of change that could accidentally repeat this mistake at any of them.
//
// React's exact wording for this warning (confirmed directly against this
// repo's React 18.3.1 under jsdom): the first console.error argument starts
// 'Warning: Each child in a list should have a unique "key" prop.' --
// matched by substring, not full equality, since the remaining %s-style
// arguments (the offending component's name and stack) vary per site and
// are not what this test is pinning.
const MISSING_KEY_WARNING = 'Each child in a list should have a unique "key" prop';

describe('no route renders a list without a real React key on every item', () => {
  it('never logs the missing-key warning across /, /blogs, or an unmatched route', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let keyWarnings: unknown[][] = [];
    try {
      render(
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>,
      );
      render(
        <MemoryRouter initialEntries={['/blogs']}>
          <AppRoutes />
        </MemoryRouter>,
      );
      render(
        <MemoryRouter initialEntries={['/this-route-matches-nothing']}>
          <AppRoutes />
        </MemoryRouter>,
      );
    } finally {
      keyWarnings = errorSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes(MISSING_KEY_WARNING),
      );
      errorSpy.mockRestore();
    }
    expect(keyWarnings).toEqual([]);
  });

  // The collage is a tree of splits, and EVERY split builds a React array
  // from `children.map(...)` -- one array per split, thirteen of them in the
  // committed arrangement, all produced inside `renderCollageNode`
  // (Hero.tsx) and all keyed by the node's own path (src/content/context.ts's
  // two default renderers). That is thirteen chances to emit an unkeyed
  // list, against the old model's one, which is exactly why this test is
  // worth more now than it was.
  //
  // Driven at /edit rather than at /, deliberately: it is the call site the
  // original test above cannot reach (it never logs in, so /edit stays on its
  // login form and the collage never mounts), and it is where an override of
  // either seam would land. Caught directly by this test's Plan 6 ancestor:
  // an earlier draft of /edit's own collage seam put its component into the
  // mapped array with no `key` at all, and a REAL Chromium build printed this
  // exact warning. jsdom reproduces it identically once /edit reaches its
  // logged-in, loaded state, which is what this test drives.
  it('never logs the missing-key warning on /edit\'s hero collage, logged in with real content loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/wa') return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('galleries.json')) {
          return new Response(JSON.stringify({ content: JSON.stringify(galleriesJson), sha: 'sha-galleries' }), { status: 200 });
        }
        // sections.json must load too, real content -- DynamicSections
        // (EditMode.tsx) filters `bundle.sections` for enabled sections,
        // and a file that failed to load falls back to an EMPTY array
        // (EMPTY-safe by design, see that fallback's own comment), which
        // would mean Hero never renders at all and this test would pass
        // VACUOUSLY -- the collage grid it exists to check never mounting
        // is not the same as it mounting cleanly.
        if (url.includes('sections.json')) {
          return new Response(JSON.stringify({ content: JSON.stringify(sectionsJson), sha: 'sha-sections' }), { status: 200 });
        }
        // Every other content file: a 404 is enough -- EditMode.tsx's own
        // EMPTY_* fallbacks render safely without it, and this test only
        // needs the COLLAGE grid (galleries.json + sections.json) to reach
        // its loaded, real-content state.
        return new Response(JSON.stringify({ message: 'not stubbed' }), { status: 404 });
      }),
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let keyWarnings: unknown[][] = [];
    try {
      const { container } = render(
        <MemoryRouter initialEntries={['/edit']}>
          <AppRoutes />
        </MemoryRouter>,
      );
      await waitFor(
        () => {
          // Sixteen collage photos, each rendered through the editable-image
          // seam -- non-vacuous in the way that matters: if the collage
          // never mounted, this count is zero and the test fails rather
          // than passing with no arrays ever built.
          expect(container.querySelectorAll('[data-editable-image-path^="galleries.heroCollage."]').length).toBe(16);
        },
        { timeout: 5000 },
      );
    } finally {
      keyWarnings = errorSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes(MISSING_KEY_WARNING),
      );
      errorSpy.mockRestore();
      vi.unstubAllGlobals();
    }
    expect(keyWarnings).toEqual([]);
  });
});
