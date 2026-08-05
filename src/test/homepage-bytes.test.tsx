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
//
// Plan 6, Task 2, Step 3: 53473 -> 53485 (+12 bytes). `galleries.json`'s
// entry 4 gained an explicit `row-start-1` -- twelve ASCII characters,
// including the leading space Hero.tsx's own template-literal join adds
// (`` `${className} relative overflow-hidden` ``) -- so it stops
// auto-placing into an implicit seventh row, where `Hero.tsx:57`'s
// `overflow-hidden` hid it. This is the one task in this plan that is
// EXPECTED to move this number: `className` is rendered into the DOM
// verbatim regardless of whether Tailwind has a matching CSS rule for it,
// so this invariant cannot see -- and is not the guard for -- the CSS
// repair itself (Task 2's own rule-level stylesheet diff is).
//
// Plan 6, Task 4, Step 1: 53485 -> 53773 (+288 bytes). Hero.tsx passed
// `draggable={false}` on every one of the sixteen collage `<img>`s (React
// renders `draggable` as an explicit `draggable="false"` attribute, never
// omitted the way a plain boolean HTML attribute would be for `false` --
// eighteen bytes, `" draggable=\"false\""`, times sixteen tiles).
//
// I-A review finding (repair): 53773 -> 53485 (-288 bytes), back to the
// pre-Task-4 number. The `draggable={false}` above was never the only way
// to stop native HTML5 image drag from hijacking a real drag-to-move's
// pointer sequence -- it was just the one that happened to cost public
// bytes for an /edit-only requirement. `dragstart` bubbles, so
// CollageTile.tsx's own `onDragStart` on its (edit-only) tile wrapper
// cancels the child `<img>`'s native drag just as effectively, confirmed
// directly in real Chromium (see that file's own comment for the full
// comparison against the other candidates that also worked). Hero.tsx (the
// public page) no longer sets `draggable` on this `<img>` at all.
//
// Drinks section rebuild: 53486 -> 44113 (-9373 bytes). Drinks.tsx stopped
// rendering three text-list categories (Mocktails/Cocktails/Wine -- 37 of
// the 38 real drinks.json records have no photo yet, and every one of them
// used to print as a name-and-description `<li>`) and became a single
// FoodGallery-style photo carousel, the owner's own request: "I don't need
// to list out these things. It just adds too much." The three category
// `<h3>` headings (and copy.json's own drinks.mocktails/cocktails/wine
// strings that fed them) are also gone. What's left renders one card --
// today exactly one drink (`Piccante`) has an `image` -- so the removed
// markup (37 list items' worth of name/description text plus three
// headings) accounts for the whole drop; nothing else on the page changed.
describe('homepage byte count', () => {
  it('the public homepage is unchanged', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(new TextEncoder().encode(container.innerHTML).length).toBe(49863);
  });
});
