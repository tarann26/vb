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
    expect(screen.getByRole('status')).toHaveTextContent(
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
    expect(screen.getByRole('status')).toHaveTextContent(/off the collage grid/);

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
    expect(screen.getByRole('status')).toHaveTextContent('');
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
    expect(screen.getByRole('status')).toHaveTextContent(
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
