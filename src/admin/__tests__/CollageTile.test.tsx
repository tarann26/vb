// Plan 6, Task 3: CollageTile is the buttons-first control that makes a
// hero collage tile selectable, movable and resizable everywhere -- this
// file covers the logic and rendering an isolated component render can
// prove (selection, the panel's own buttons, refusal feedback, Escape).
// What a component-level jsdom render CANNOT prove -- that a real click at
// real page coordinates reaches this component at all, past EditMode's own
// capture-phase click guard and past Hero.tsx's stacking order -- was
// checked separately, in real Chromium against a real vite-served /edit
// (see this task's own report): that pass is what actually caught the
// click-guard carve-out gap and the (pre-existing, Plan 5) z-index
// collision this component's own comments now document. This file is the
// regression net for the logic; that pass was the proof it is reachable.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CollageTile from '../CollageTile';
// The real, committed collage -- the exact fixture the cascade test below
// needs (see that describe block's own comment for why a hand-built
// fixture isn't enough here).
import { galleries } from '../../content';

// `renderTileIntoGrid`'s own `vi.spyOn(window, 'getComputedStyle')` (below)
// was never restored anywhere in this file before the I-D/I-F tests added
// alongside this repair -- harmless as long as nothing LATER in the file
// ever called `screen.getByRole` again (accessible-name computation reads
// real `getComputedStyle().getPropertyValue`, which the stubbed return
// value doesn't have), which happened to be true of every test written
// before these. It stopped being true the moment a later describe block
// needed `getByRole` after an earlier one had run `renderTileIntoGrid` --
// confirmed directly, this is what "TypeError: style.getPropertyValue is
// not a function" inside dom-accessibility-api was. `afterEach` matches
// this file's own existing convention (`matchMediaSpy.mockRestore()` at
// the end of the touch-pointer test below) instead of asking every test
// that calls `renderTileIntoGrid` to remember it individually.
afterEach(() => {
  vi.restoreAllMocks();
});

// A realistic six-tile fixture -- entry 0 fully definite, entry 1 auto on
// both axes -- so tests below can exercise both "read the declared start"
// and "resolve the current position first" (Task 4 Step 3's own finding,
// which this plan's Task 3 Step 1 says the buttons must not diverge from).
const CLASS_NAMES = [
  'col-start-3 col-span-1 row-start-3 row-span-1',
  'col-span-1 row-span-1',
  'col-start-1 col-span-1 row-start-1 row-span-1',
];

function renderTile(overrides: Partial<React.ComponentProps<typeof CollageTile>> = {}) {
  const onSelect = vi.fn();
  const onCommit = vi.fn();
  const utils = render(
    <CollageTile
      index={0}
      className={CLASS_NAMES[0]}
      classNames={CLASS_NAMES}
      image={<img src="/hero/a.webp" alt="" />}
      selected={false}
      onSelect={onSelect}
      onCommit={onCommit}
      {...overrides}
    />,
  );
  return { ...utils, onSelect, onCommit };
}

describe('CollageTile: selecting and deselecting', () => {
  it('renders the select toggle, unpressed, when not selected', () => {
    renderTile();
    const toggle = screen.getByRole('button', { name: 'Move or change the size of photo 1' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onSelect(index) when the unselected toggle is clicked', () => {
    const { onSelect } = renderTile();
    fireEvent.click(screen.getByRole('button', { name: 'Move or change the size of photo 1' }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('calls onSelect(null) when the SELECTED toggle is clicked -- deselecting', () => {
    const { onSelect } = renderTile({ selected: true });
    fireEvent.click(screen.getByRole('button', { name: 'Stop moving photo 1' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('shows the move/resize panel only when selected', () => {
    const { rerender } = renderTile({ selected: false });
    expect(screen.queryByRole('region', { name: 'Moving or resizing photo 1' })).not.toBeInTheDocument();
    rerender(
      <CollageTile
        index={0}
        className={CLASS_NAMES[0]}
        classNames={CLASS_NAMES}
        image={<img src="/hero/a.webp" alt="" />}
        selected
        onSelect={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: 'Moving or resizing photo 1' })).toBeInTheDocument();
  });

  it('every interactive element in the panel carries data-collage-control -- EditMode\'s click guard carve-out depends on it', () => {
    renderTile({ selected: true });
    const region = screen.getByRole('region', { name: 'Moving or resizing photo 1' });
    const buttons = region.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((button) => {
      expect(button).toHaveAttribute('data-collage-control', 'true');
    });
  });
});

describe('CollageTile: move buttons commit through the shared moveTile arithmetic', () => {
  it('moving a fully-definite tile right commits formatPlacement of the new position', () => {
    const { onCommit } = renderTile({ selected: true });
    fireEvent.click(screen.getByRole('button', { name: 'Move right' }));
    expect(onCommit).toHaveBeenCalledWith(0, 'col-start-4 col-span-1 row-start-3 row-span-1');
  });

  it('moving an AUTO-placed tile resolves its current position first, then moves -- not a naive read of its own (absent) className', () => {
    // Entry 1 is fully auto; entry 0 occupies (3,3) and entry 2 occupies
    // (1,1), so entry 1 resolves to (1,2) via resolveLayout's own
    // document-order cursor.
    const { onCommit } = renderTile({
      index: 1,
      className: CLASS_NAMES[1],
      selected: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move down' }));
    expect(onCommit).toHaveBeenCalledWith(1, 'col-start-2 col-span-1 row-start-2 row-span-1');
  });

  it('an off-grid move is refused: onCommit is never called, and a visible status message explains why', () => {
    // Entry 2 sits at col-start-1 -- moving left would go to column 0.
    const { onCommit } = renderTile({
      index: 2,
      className: CLASS_NAMES[2],
      selected: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move left' }));
    expect(onCommit).not.toHaveBeenCalled();
    // Two role="status" regions now exist (refusal, red; side-effect info,
    // gray) -- the refusal is the first in DOM order.
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      "Can't move left — that would move this photo off the collage grid.",
    );
  });

  it('a refusal message from a stale action is cleared once the tile becomes deselected then reselected', () => {
    const { rerender } = renderTile({
      index: 2,
      className: CLASS_NAMES[2],
      selected: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move left' }));
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(/off the collage grid/);

    rerender(
      <CollageTile
        index={2}
        className={CLASS_NAMES[2]}
        classNames={CLASS_NAMES}
        image={<img src="/hero/a.webp" alt="" />}
        selected={false}
        onSelect={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    rerender(
      <CollageTile
        index={2}
        className={CLASS_NAMES[2]}
        classNames={CLASS_NAMES}
        image={<img src="/hero/a.webp" alt="" />}
        selected
        onSelect={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    screen.getAllByRole('status').forEach((status) => expect(status).toHaveTextContent(''));
  });
});

describe('CollageTile: size-change buttons', () => {
  it('"Wider" grows colSpan by one, leaving colStart/row alone', () => {
    const { onCommit } = renderTile({ selected: true });
    fireEvent.click(screen.getByRole('button', { name: 'Wider' }));
    expect(onCommit).toHaveBeenCalledWith(0, 'col-start-3 col-span-2 row-start-3 row-span-1');
  });

  it('"Taller" grows rowSpan by one, leaving colStart/col alone', () => {
    const { onCommit } = renderTile({ selected: true });
    fireEvent.click(screen.getByRole('button', { name: 'Taller' }));
    expect(onCommit).toHaveBeenCalledWith(0, 'col-start-3 col-span-1 row-start-3 row-span-2');
  });

  it('"Narrower" on a 1-wide tile is refused -- a zero-width tile is not a real placement', () => {
    const { onCommit } = renderTile({ selected: true });
    fireEvent.click(screen.getByRole('button', { name: 'Narrower' }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      "Can't make this narrower — that would move this photo off the collage grid.",
    );
  });
});

describe('CollageTile: Escape dismisses the panel', () => {
  it('pressing Escape inside the panel calls onSelect(null)', () => {
    const { onSelect } = renderTile({ selected: true });
    const region = screen.getByRole('region', { name: 'Moving or resizing photo 1' });
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('a key other than Escape does nothing', () => {
    const { onSelect } = renderTile({ selected: true });
    const region = screen.getByRole('region', { name: 'Moving or resizing photo 1' });
    fireEvent.keyDown(region, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('CollageTile: the outer tile div still carries the real placement className', () => {
  it('renders className + the fixed relative/overflow-hidden suffix, matching the public page exactly', () => {
    const { container } = renderTile();
    const tile = container.querySelector('[data-collage-tile-index="0"]');
    expect(tile).toHaveClass('col-start-3', 'col-span-1', 'row-start-3', 'row-span-1', 'relative', 'overflow-hidden');
  });

  it('renders the passed-in image as a real child', () => {
    // Not `getByRole('img')` -- an empty `alt` (the real collage's own
    // choice, matching Hero.tsx's real renderImage call) removes an <img>
    // from the accessibility tree entirely, per the ARIA spec's own
    // "presentational" treatment of alt="".
    const { container } = renderTile();
    expect(container.querySelector('img')).toHaveAttribute('src', '/hero/a.webp');
  });
});

// Task 4: drag, on fine pointers only. jsdom has no `PointerEvent`
// constructor at all (confirmed directly: `typeof window.PointerEvent ===
// 'undefined'`), so `fireEvent.pointerDown` silently drops every init
// property this test needs (`pointerId`, `clientX`, `clientY`) -- React
// still routes a `MouseEvent` named "pointerdown"/"pointermove"/etc. to
// `onPointerDown`/`onPointerMove` handlers (it attaches native listeners
// by STRING type, not by checking `instanceof PointerEvent`), so a real
// `MouseEvent` with `pointerId`/`pointerType` attached via
// `Object.defineProperty` reaches this component's own handlers with every
// property they read intact -- confirmed directly against a throwaway
// component before writing the tests below (`fireEvent.pointerDown` alone
// produced `undefined` for every one of `pointerId`/`clientX`/`clientY`/
// `pointerType`).
//
// jsdom also always reads all zeros from `getBoundingClientRect`, and does
// not implement `setPointerCapture`/`releasePointerCapture` at all --
// stubbed below so the ARITHMETIC (pixel delta -> cell delta -> candidate
// placement -> commit/refuse) can be proven here. Whether a real pointer
// gesture actually REACHES this component past a real browser's own
// hit-testing was checked separately, in real Chromium against a real
// vite-served /edit (this task's own report) -- the same split
// CollageTile.test.tsx's own header comment already draws for clicks.
function firePointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { pointerId: number; clientX: number; clientY: number; pointerType?: string; button?: number },
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY, button: init.button ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId, configurable: true });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse', configurable: true });
  fireEvent(el, event);
}

function stubPointerCapture() {
  // Always assigned, not feature-detected: jsdom's own DOM classes throw
  // "not a function" for these rather than leaving the property entirely
  // absent, so an `if (!('setPointerCapture' in Element.prototype))` guard
  // never actually replaces jsdom's own throwing stub (confirmed directly).
  // No `@ts-expect-error` needed here -- lib.dom.d.ts already declares both
  // methods, so a no-arg stub type-checks fine against them.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

const CELL_PX = 100; // an arbitrary, easy-to-reason-about cell size

// Renders DIRECTLY into a pre-built "grid" element -- not a post-render DOM
// mutation (moving `container`'s children after React has already rendered
// into it corrupts React's own record of what it owns, and testing-library's
// automatic cleanup between tests then throws "the node to be removed is
// not a child of this node"). `measureCell` (CollageTile.tsx) reads the
// tile's OWN parent element, so rendering into this element directly is
// what makes it that parent with no mutation involved.
function renderTileIntoGrid(overrides: Partial<React.ComponentProps<typeof CollageTile>> = {}) {
  const grid = document.createElement('div');
  document.body.appendChild(grid);
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
    width: CELL_PX * 6,
    height: CELL_PX * 6,
    top: 0,
    left: 0,
    right: CELL_PX * 6,
    bottom: CELL_PX * 6,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ columnGap: '0px' } as CSSStyleDeclaration);

  const onSelect = vi.fn();
  const onCommit = vi.fn();
  const utils = render(
    <CollageTile
      index={0}
      className={CLASS_NAMES[0]}
      classNames={CLASS_NAMES}
      image={<img src="/hero/a.webp" alt="" />}
      selected={false}
      onSelect={onSelect}
      onCommit={onCommit}
      {...overrides}
    />,
    { container: grid },
  );
  return { ...utils, grid, onSelect, onCommit };
}

// Real Chromium finding (Task 4's own report), reproduced here against the
// SAME real content: dragging tile 7 (`col-start-6 col-span-1 row-start-3
// row-span-2`) up one row is perfectly legal FOR TILE 7 ITSELF (on-grid,
// resolveLayout has no complaint) -- but it also occupies the row auto-
// placed tiles 0 and 2 were resolving into, and the cascade pushes THEM
// off-grid. `validateContent` (the real server-side rule,
// `commitCollagePlacement` in EditMode.tsx) correctly refuses the whole
// write -- before this fix, SILENTLY: CollageTile's own `isOnGrid` check
// only ever looked at the tile being moved, never at what moving it does
// to an auto-placed sibling. A small hand-built fixture can't reproduce
// this (it needs enough real siblings, in the real document order, for the
// cascade to have somewhere to go wrong) -- the real, committed
// `galleries.json` is the smallest fixture that actually exercises it.
describe('CollageTile: a move that is legal for the tile itself but pushes an auto-placed SIBLING off-grid', () => {
  const REAL_CLASS_NAMES = galleries.heroCollage.map((t) => t.className);

  it('is refused before ever calling onCommit, with visible feedback naming the real reason', () => {
    const onCommit = vi.fn();
    render(
      <CollageTile
        index={7}
        className={REAL_CLASS_NAMES[7]}
        classNames={REAL_CLASS_NAMES}
        image={<img src="/hero/bus.webp" alt="" />}
        selected
        onSelect={vi.fn()}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move up' }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      "Can't move up — that would push another auto-placed photo off the collage grid.",
    );
  });
});

describe('CollageTile: drag to move (fine pointers only)', () => {
  function dragSurfaceOf(container: HTMLElement, index = 0): HTMLElement {
    return container.querySelector(`[data-collage-tile-index="${index}"] > div.select-none`) as HTMLElement;
  }

  it('a small drag that snaps to the SAME cell it started in does not commit -- a drop back where it started is not an edit', () => {
    stubPointerCapture();
    const { container, onCommit } = renderTileIntoGrid();
    const surface = dragSurfaceOf(container);

    firePointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    firePointer(surface, 'pointermove', { pointerId: 1, clientX: 10, clientY: 10 }); // well under one cell
    firePointer(surface, 'pointerup', { pointerId: 1, clientX: 10, clientY: 10 });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a drag of one full cell right commits the moved placement, snapped to whole cells', () => {
    stubPointerCapture();
    const { container, onCommit } = renderTileIntoGrid();
    const surface = dragSurfaceOf(container);

    firePointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    firePointer(surface, 'pointermove', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5 }); // rounds to +1 cell right, 0 down
    firePointer(surface, 'pointerup', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5 });

    // Tile 0 starts at col-start-3 row-start-3 -- one cell right is col 4.
    expect(onCommit).toHaveBeenCalledWith(0, 'col-start-4 col-span-1 row-start-3 row-span-1');
  });

  // C1 review finding (Critical): this test used to render with
  // `selected: false` (the default -- unchanged below) and assert nothing
  // about feedback, even though its own title claimed one. `selected`
  // defaults false deliberately here: `handleMovePointerDown` has no
  // `selected` guard at all (a drag works on any tile), so a refusal has
  // to be visible without her ever having selected this one -- the exact
  // gap the reviewer's own proof hit on the very first unprompted drag,
  // one cell, no selection.
  it('a drag that would land off-grid is refused: no commit, VISIBLE FEEDBACK even though the tile was never selected, tile reads back its original className', () => {
    stubPointerCapture();
    // Tile 2 (index passed via override) starts at col-start-1 -- one cell
    // left runs off the grid.
    const { container, onCommit } = renderTileIntoGrid({ index: 2, className: CLASS_NAMES[2] });
    const surface = dragSurfaceOf(container, 2);

    firePointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    firePointer(surface, 'pointermove', { pointerId: 1, clientX: -(CELL_PX + 20), clientY: 5 });
    firePointer(surface, 'pointerup', { pointerId: 1, clientX: -(CELL_PX + 20), clientY: 5 });

    expect(onCommit).not.toHaveBeenCalled();
    const tile = container.querySelector('[data-collage-tile-index="2"]') as HTMLElement;
    expect(tile).toHaveClass('col-start-1', 'col-span-1', 'row-start-1', 'row-span-1');
    // No panel exists at all -- this tile was never selected -- and the
    // refusal is on screen anyway.
    expect(screen.queryByRole('region', { name: /Moving or resizing/ })).not.toBeInTheDocument();
    expect(screen.getByText("Can't drop it there — that would move this photo off the collage grid.")).toBeInTheDocument();
  });

  // C1's own secondary finding: the message-clearing effect used to fire
  // on EVERY `selected` change, including false -> true -- which meant
  // selecting the tile (to find out why a drag just failed) wiped the
  // very explanation she opened the panel to read, in the same render
  // that revealed the question.
  it('selecting the tile right after an unselected refused drag does not wipe the message', () => {
    stubPointerCapture();
    const { container, rerender, onCommit } = renderTileIntoGrid({ index: 2, className: CLASS_NAMES[2] });
    const surface = dragSurfaceOf(container, 2);

    firePointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    firePointer(surface, 'pointermove', { pointerId: 1, clientX: -(CELL_PX + 20), clientY: 5 });
    firePointer(surface, 'pointerup', { pointerId: 1, clientX: -(CELL_PX + 20), clientY: 5 });
    expect(onCommit).not.toHaveBeenCalled();

    rerender(
      <CollageTile
        index={2}
        className={CLASS_NAMES[2]}
        classNames={CLASS_NAMES}
        image={<img src="/hero/a.webp" alt="" />}
        selected
        onSelect={vi.fn()}
        onCommit={vi.fn()}
      />,
    );

    // Plain DOM queries, not `screen.getByRole`: `renderTileIntoGrid`'s own
    // `getComputedStyle` stub (needed for the drag's cell-size math above)
    // is still active for the rest of THIS test, and RTL's accessible-name
    // computation calls the real `getComputedStyle(...).getPropertyValue`
    // to check visibility -- a stub with no such method throws, not a
    // concern this test is actually about.
    const region = document.body.querySelector('[role="region"][aria-label="Moving or resizing photo 3"]');
    expect(region).toBeInTheDocument();
    const statuses = document.body.querySelectorAll('[role="status"]');
    expect(statuses[0]).toHaveTextContent(
      "Can't drop it there — that would move this photo off the collage grid.",
    );
  });

  it('a real pointercancel mid-drag cancels without committing, the same as a refused drop', () => {
    stubPointerCapture();
    const { container, onCommit } = renderTileIntoGrid();
    const surface = dragSurfaceOf(container);

    firePointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    firePointer(surface, 'pointermove', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5 });
    firePointer(surface, 'pointercancel', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5 });

    expect(onCommit).not.toHaveBeenCalled();
  });

  // C2 review finding (Critical): the old version of this test fired
  // Escape straight at the tile element (`fireEvent.keyDown(tile, ...)`),
  // which is not what a real browser ever does -- a real keydown's target
  // is whatever element currently has FOCUS, and confirmed directly (real
  // Chromium, capture-phase listeners on every tile plus one on
  // `document`) that during a drag, focus stayed on `document.body` the
  // whole time: the tile was a plain, non-focusable `<div>`, so Escape's
  // real target was never a descendant of it, and this component's own
  // `onKeyDown` never fired -- the subsequent pointerup committed the move
  // Escape was supposed to cancel. Firing at `document.activeElement`
  // below (never at `tile` directly) is what makes this test exercise the
  // same path a real keyboard actually takes -- and what makes it catch
  // the class of bug the old version structurally could not: dispatching
  // at `document.activeElement` when nothing focuses the tile reaches
  // `document.body`, which never bubbles down into a descendant, so a
  // reverted fix leaves this red rather than green.
  it('pressing Escape mid-drag cancels it -- no commit, even if pointerup follows, via whatever element real focus actually landed on', () => {
    stubPointerCapture();
    const { container, onCommit } = renderTileIntoGrid();
    const surface = dragSurfaceOf(container);
    const tile = container.querySelector('[data-collage-tile-index="0"]') as HTMLElement;

    firePointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    firePointer(surface, 'pointermove', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5 });
    // The drag itself must have moved real focus onto the tile -- not
    // asserted for its own sake, but because the next line depends on it:
    // firing at `document.activeElement` only exercises the real bug if
    // that really is where a real drag leaves focus.
    expect(document.activeElement).toBe(tile);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    firePointer(surface, 'pointerup', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5 });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('touch does not start a drag at all -- coarse pointers get buttons only (Step 1\'s own decision)', () => {
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    stubPointerCapture();
    const { container, onCommit } = renderTileIntoGrid();
    const surface = dragSurfaceOf(container);

    firePointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0, pointerType: 'touch' });
    firePointer(surface, 'pointermove', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5, pointerType: 'touch' });
    firePointer(surface, 'pointerup', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5, pointerType: 'touch' });

    expect(onCommit).not.toHaveBeenCalled();
    matchMediaSpy.mockRestore();
  });

  // I-D review finding: `wouldStayOnGrid` (the cascade guard -- "pinning
  // one tile relocates others" pushing an auto-placed SIBLING off-grid) is
  // called separately on the button path (`handleAction`) and the drag
  // path (`endDrag`) -- this plan's own Task 3 Step 1 rule is that if the
  // two paths can ever disagree, one of them is wrong. Until this test
  // existed, only the BUTTON path (the "is refused before ever calling
  // onCommit" test above, in the cascade describe block) was ever
  // exercised against this exact cascade. Mutation: neuter the
  // `if (!wouldStayOnGrid(...))` check inside `endDrag` alone (leaving
  // `handleAction`'s own copy untouched) and every other test in this
  // file, including that one, stays green -- this is the one that goes
  // red.
  it('the SAME cascade (tile 7, real content) is refused via a real drag, not just the "Move up" button', () => {
    stubPointerCapture();
    const realClassNames = galleries.heroCollage.map((t) => t.className);
    const { container, onCommit } = renderTileIntoGrid({
      index: 7,
      className: realClassNames[7],
      classNames: realClassNames,
      image: <img src="/hero/bus.webp" alt="" />,
    });
    const surface = dragSurfaceOf(container, 7);

    // Tile 7 is col-start-6 col-span-1 row-start-3 row-span-2 -- one cell
    // UP is the same gesture the button-path test's own "Move up" exercises.
    firePointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    firePointer(surface, 'pointermove', { pointerId: 1, clientX: 5, clientY: -(CELL_PX + 20) });
    firePointer(surface, 'pointerup', { pointerId: 1, clientX: 5, clientY: -(CELL_PX + 20) });

    expect(onCommit).not.toHaveBeenCalled();
    const tile = container.querySelector('[data-collage-tile-index="7"]') as HTMLElement;
    expect(tile).toHaveClass('col-start-6', 'col-span-1', 'row-start-3', 'row-span-2');
  });
});

describe('CollageTile: drag to resize (fine pointers only, tile selected)', () => {
  it('the resize handle is only rendered when the tile is selected', () => {
    const { container, rerender } = renderTileIntoGrid({ selected: false });
    expect(container.querySelector('[aria-label="Drag to change the size of photo 1"]')).not.toBeInTheDocument();
    rerender(
      <CollageTile
        index={0}
        className={CLASS_NAMES[0]}
        classNames={CLASS_NAMES}
        image={<img src="/hero/a.webp" alt="" />}
        selected
        onSelect={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    expect(container.querySelector('[aria-label="Drag to change the size of photo 1"]')).toBeInTheDocument();
  });

  it('dragging the resize handle right grows colSpan, leaving colStart/row alone, and commits on release', () => {
    stubPointerCapture();
    const { container, onCommit } = renderTileIntoGrid({ selected: true });
    const handle = container.querySelector('[aria-label="Drag to change the size of photo 1"]') as HTMLElement;

    firePointer(handle, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    firePointer(handle, 'pointermove', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5 });
    firePointer(handle, 'pointerup', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5 });

    expect(onCommit).toHaveBeenCalledWith(0, 'col-start-3 col-span-2 row-start-3 row-span-1');
  });

  it('the resize handle cannot shrink a span below 1 -- the drag clamps, it does not produce a refusable negative span', () => {
    stubPointerCapture();
    const { container, onCommit } = renderTileIntoGrid({ selected: true });
    const handle = container.querySelector('[aria-label="Drag to change the size of photo 1"]') as HTMLElement;

    firePointer(handle, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    // Three cells left -- would be span -2 unclamped.
    firePointer(handle, 'pointermove', { pointerId: 1, clientX: -(CELL_PX * 3), clientY: 0 });
    firePointer(handle, 'pointerup', { pointerId: 1, clientX: -(CELL_PX * 3), clientY: 0 });

    // Clamped to span 1 -- a real, on-grid, but unchanged-from-a-shrink-
    // attempt result, since tile 0 already has colSpan 1. Not a commit at
    // all: the clamped candidate is identical to where it started.
    expect(onCommit).not.toHaveBeenCalled();
  });
});

// I-F review finding: the panel is `createPortal`'d to the very end of
// `document.body`, so Tab from the select button that opens it followed
// the portal's real DOM position, not the tile's -- measured at 101 Tab
// presses to actually reach it. The fix moves focus explicitly instead of
// relying on DOM position: straight into the panel when it opens, trapped
// there while it's open, and back to the select button when it closes.
describe('CollageTile: keyboard reachability of the move/resize panel (I-F)', () => {
  it('selecting the tile moves focus straight into the panel -- no Tabbing through the rest of the page needed', () => {
    const { rerender } = renderTile({ selected: false });
    rerender(
      <CollageTile
        index={0}
        className={CLASS_NAMES[0]}
        classNames={CLASS_NAMES}
        image={<img src="/hero/a.webp" alt="" />}
        selected
        onSelect={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    const region = screen.getByRole('region', { name: 'Moving or resizing photo 1' });
    expect(region.contains(document.activeElement)).toBe(true);
  });

  it("Tab from the panel's last focusable control wraps back to its first -- it never escapes into the rest of the page", () => {
    renderTile({ selected: true });
    const region = screen.getByRole('region', { name: 'Moving or resizing photo 1' });
    const buttons = region.querySelectorAll('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(region, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab from the panel's first focusable control wraps to its last", () => {
    renderTile({ selected: true });
    const region = screen.getByRole('region', { name: 'Moving or resizing photo 1' });
    const buttons = region.querySelectorAll('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    first.focus();
    fireEvent.keyDown(region, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  // Falsifies the in-code claim this comment replaced: a browser does NOT
  // return focus to "the nearest preceding focusable element" on its own
  // when a focused element unmounts -- it goes to document.body. This is
  // the explicit fix, proven directly.
  it("closing the panel returns focus to the tile's own select button, not document.body", () => {
    const { rerender } = renderTile({ selected: true });
    const selectButton = screen.getByRole('button', { name: 'Stop moving photo 1' });
    rerender(
      <CollageTile
        index={0}
        className={CLASS_NAMES[0]}
        classNames={CLASS_NAMES}
        image={<img src="/hero/a.webp" alt="" />}
        selected={false}
        onSelect={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(selectButton);
    expect(document.activeElement).not.toBe(document.body);
  });
});
