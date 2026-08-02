import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';

// Pinned by hand in four separate plan reviews and enforced by nothing
// until now. Measured with `TextEncoder`, not `.length`: the rendered page
// contains U+00A0 (non-breaking space) and `é`, both of which are one JS
// UTF-16 code unit but more than one UTF-8 byte, so `.length` reads 53454 --
// a different number that is not the invariant this test exists to guard.
//
// Every task in the worker plan runs this. A change here is either a real,
// deliberate edit to the public homepage (state the old and new numbers and
// what accounts for the difference, in the same commit) or a regression --
// this test cannot tell those apart, which is the point: it forces the
// distinction to be made explicitly rather than silently.
describe('homepage byte count', () => {
  it('the public homepage is unchanged', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(new TextEncoder().encode(container.innerHTML).length).toBe(53473);
  });
});
