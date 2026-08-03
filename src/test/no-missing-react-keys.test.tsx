import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';

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
});
