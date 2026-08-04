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
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CollageTile from '../CollageTile';
// The real, committed collage -- the exact fixture the cascade test below
// needs (see that describe block's own comment for why a hand-built
// fixture isn't enough here).
import { galleries } from '../../content';

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

  it('a drag that would land off-grid is refused: no commit, visible feedback, tile reads back its original className', () => {
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

  // Task 4 Step 4: Escape cancels an in-flight drag -- the one undo this
  // plan adds. Attached to the tile itself, so it only matters while a
  // pointer is actually captured there.
  it('pressing Escape mid-drag cancels it -- no commit, even if pointerup follows', () => {
    stubPointerCapture();
    const { container, onCommit } = renderTileIntoGrid();
    const surface = dragSurfaceOf(container);
    const tile = container.querySelector('[data-collage-tile-index="0"]') as HTMLElement;

    firePointer(surface, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    firePointer(surface, 'pointermove', { pointerId: 1, clientX: CELL_PX + 20, clientY: 5 });
    fireEvent.keyDown(tile, { key: 'Escape' });
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
