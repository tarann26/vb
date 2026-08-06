// The collage editor, checked through the REAL renderer -- `<Hero />` inside
// a provider whose two collage seams are this module's, exactly the wiring
// EditMode.tsx does -- rather than through a hand-written walk of the tree.
// A test that re-implements Hero.tsx's own recursion proves that the copy
// works.
//
// WHAT IS DELIBERATELY NOT HERE. jsdom has no layout engine and cannot
// hit-test, so every claim about what is DRAGGABLE, what is under the
// pointer, whether a drop landed on a photo or on a gap, and whether the
// panel's controls are actually reachable belongs in e2e/collage-swap.spec.ts
// against a real Chromium. Firing `pointerdown` here and calling it a drag is
// the exact evasion that shipped an inert control in this project once
// already. What jsdom CAN answer honestly, and what this file sticks to: the
// markup each box carries, that the sizing handed to the seam survives the
// override, that the native image drag is cancelled, and what the model does
// when a real <button> is clicked or focus lands inside a box.
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import Hero from '../../components/Hero';
import { ContentProvider, defaultBundle } from '../../content/ContentContext';
import { COLLAGE_PHOTO_ATTR, useCollageEditor } from '../CollageEditor';
import { NO_IMAGE_PREVIEWS } from '../previews';
import type { ImagePreviews } from '../previews';
import { findCollageSplit } from '../../content/collage';
import type { CollageNode } from '../../content/types';

function photo(id: string, src = `/hero/${id}.webp`): CollageNode {
  return { kind: 'photo', id, src, alt: '' };
}

// Four photos, two levels, one uneven split -- enough that a dropped
// `flexGrow`, a reordered child or a swap that moved a box would all show.
function fixture(): CollageNode {
  return {
    kind: 'split',
    id: 'root',
    direction: 'row',
    sizes: [1.5, 0.5],
    children: [
      photo('p1'),
      {
        kind: 'split',
        id: 'right',
        direction: 'column',
        sizes: [1, 1, 1],
        children: [photo('p2'), photo('p3'), photo('p4')],
      },
    ],
  };
}

function Harness({
  initial,
  locked = false,
  previews = NO_IMAGE_PREVIEWS,
  onChange,
}: {
  initial: CollageNode;
  locked?: boolean;
  previews?: ImagePreviews;
  onChange?: (next: CollageNode) => void;
}) {
  const [tree, setTree] = useState<CollageNode>(initial);
  const editor = useCollageEditor({
    tree,
    onChange: (next) => {
      setTree(next);
      onChange?.(next);
    },
    locked,
    previews,
  });
  return (
    <>
      <ContentProvider
        value={{
          ...defaultBundle,
          galleries: { atmosphere: [], ourStory: [], heroCollage: tree },
          renderCollagePhoto: editor.renderCollagePhoto,
          renderCollageSplit: editor.renderCollageSplit,
        }}
      >
        <Hero />
      </ContentProvider>
      {editor.panel}
    </>
  );
}

function boxes(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[${COLLAGE_PHOTO_ATTR}]`)];
}

function boxFor(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[${COLLAGE_PHOTO_ATTR}="${id}"]`);
  if (!el) throw new Error(`no collage box for ${id}`);
  return el;
}

describe('the collage editor: what every photo box carries', () => {
  it('gives every photo box its own id, in document order', () => {
    render(<Harness initial={fixture()} />);
    expect(boxes().map((el) => el.getAttribute(COLLAGE_PHOTO_ATTR))).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('keeps the class name and the inline sizing the seam handed it', () => {
    render(<Harness initial={fixture()} />);
    // The public renderer's own className, untouched -- `relative` is what
    // EditableImage's camera badge positions against, `overflow-hidden` is
    // what stops a photo's intrinsic width leaking into the ratio.
    expect(boxFor('p1').className).toBe('relative overflow-hidden');
    // ...and the sizing, which is the thing an override must never drop:
    // root is [1.5, 0.5], so p1's box grows at 1.5 from a zero base.
    expect(boxFor('p1').style.flexGrow).toBe('1.5');
    expect(boxFor('p1').style.flexBasis).toBe('0px');
    expect(boxFor('p2').style.flexGrow).toBe('1');
  });

  it('cancels the browser’s own image drag, without a draggable attribute anywhere', () => {
    render(<Harness initial={fixture()} />);
    // `dragstart` bubbles, so cancelling it on the box cancels the <img>'s
    // native drag -- the whole reason `draggable={false}` (which would ship
    // to every public visitor through renderImage) is not the fix.
    expect(fireEvent.dragStart(boxFor('p1').querySelector('img') as HTMLImageElement)).toBe(false);
    expect(document.querySelectorAll('[draggable]')).toHaveLength(0);
  });

});

describe('the collage editor: what every split box carries', () => {
  it('keeps the public renderer’s class name and sizing, and adds only a containing block', () => {
    render(<Harness initial={fixture()} />);
    const right = document.querySelector<HTMLElement>('[data-collage-split-id="right"]')!;
    expect(right.className).toBe('flex flex-col gap-1 overflow-hidden');
    // The sizing it was handed, untouched -- root is [1.5, 0.5].
    expect(right.style.flexGrow).toBe('0.5');
    expect(right.style.flexBasis).toBe('0px');
    // ...plus the one thing the editor adds, which the handles position
    // against and which changes no layout of its own.
    expect(right.style.position).toBe('relative');
  });

  it('puts one divider between each adjacent pair, and none after the last box', () => {
    render(<Harness initial={fixture()} />);
    // root has two children -> one gap; `right` has three -> two gaps. In
    // document order the nested split's own handles come first, because each
    // split renders its children before its dividers.
    expect([...document.querySelectorAll('[data-collage-divider]')].map((el) => el.getAttribute('data-collage-divider'))).toEqual([
      'right:0',
      'right:1',
      'root:0',
    ]);
  });

  // The offset flexbox actually produces: it subtracts every gap from the box
  // FIRST and distributes what is left by the grow factors, so the boundary
  // after child 0 of a [1.5, 0.5] pair sits at 75% of (100% - one 4px gap),
  // and the handle is then pulled back by its own 6px overhang so its CENTRE
  // lands on the gap rather than its leading edge.
  //
  // Asserted as the three numbers rather than as one string: jsdom's CSS
  // parser re-orders the terms of a `calc()` when it round-trips it (the
  // literal here comes back as `calc(-6px + 0.75 * (100% - 4px))`), so an
  // exact match would be pinning jsdom's formatter, not this code. That the
  // handle really lands on the gap is measured in a real browser instead --
  // e2e/collage-divider.spec.ts puts its centre within a pixel of the
  // measured boundary between the two rendered boxes.
  it('offsets each handle by the fraction, the gaps before it, and its own overhang', () => {
    render(<Harness initial={fixture()} />);
    const root = document.querySelector<HTMLElement>('[data-collage-divider="root:0"]')!;
    expect(root.style.left).toContain('0.75');
    expect(root.style.left).toContain('(100% - 4px)');
    expect(root.style.left).toContain('-6px');
    expect(root.style.width).toBe('16px');
    const second = document.querySelector<HTMLElement>('[data-collage-divider="right:1"]')!;
    // `right` is a column of three: two gaps come out of the percentage, the
    // boundary is two thirds along, and one whole gap lies before it (4px)
    // against the 6px overhang -- a net -2px.
    expect(second.style.top).toContain('0.666');
    expect(second.style.top).toContain('(100% - 8px)');
    expect(second.style.top).toContain('-2px');
    expect(second.style.height).toBe('16px');
  });

  it('gives every divider the marker /edit’s click guard looks for', () => {
    render(<Harness initial={fixture()} />);
    const dividers = [...document.querySelectorAll('[data-collage-divider]')];
    expect(dividers.length).toBeGreaterThan(0);
    dividers.forEach((el) => expect(el).toHaveAttribute('data-collage-control'));
  });

  it('takes every divider off the page while a publish is in flight', () => {
    render(<Harness initial={fixture()} locked />);
    expect(document.querySelectorAll('[data-collage-divider]')).toHaveLength(0);
  });
});

describe('the collage editor: changing a box’s size from the panel', () => {
  it('names the axis the divider actually moves along', () => {
    render(<Harness initial={fixture()} />);
    // p1 is a child of the ROW root, so its own divider runs vertically.
    fireEvent.focusIn(boxFor('p1'));
    expect(screen.getByRole('button', { name: 'Make this photo wider, and the one beside it narrower' })).toBeEnabled();
    // p2 is a child of the COLUMN split, so its divider runs horizontally.
    fireEvent.focusIn(boxFor('p2'));
    expect(screen.getByRole('button', { name: 'Make this photo taller, and the one beside it shorter' })).toBeEnabled();
  });

  it('moves size from the box beside it and conserves the pair’s total', () => {
    const onChange = vi.fn();
    render(<Harness initial={fixture()} onChange={onChange} />);
    fireEvent.focusIn(boxFor('p2'));
    fireEvent.click(screen.getByRole('button', { name: 'Make this photo taller, and the one beside it shorter' }));

    const next = onChange.mock.calls[0][0] as CollageNode;
    const right = findCollageSplit(next, 'right')!;
    // One step is 5% of what the pair shares (2 of the 3 units here), so p2
    // gains 0.1 and p3 loses exactly 0.1...
    expect(right.sizes[0]).toBeCloseTo(1.1, 5);
    expect(right.sizes[1]).toBeCloseTo(0.9, 5);
    // ...and p4, which is not part of that pair, does not move at all.
    expect(right.sizes[2]).toBe(1);
  });

  it('moves the divider BEFORE the last box, in the opposite sense', () => {
    const onChange = vi.fn();
    render(<Harness initial={fixture()} onChange={onChange} />);
    fireEvent.focusIn(boxFor('p4'));
    fireEvent.click(screen.getByRole('button', { name: 'Make this photo taller, and the one beside it shorter' }));

    const right = findCollageSplit(onChange.mock.calls[0][0] as CollageNode, 'right')!;
    expect(right.sizes[2]).toBeCloseTo(1.1, 5);
    expect(right.sizes[1]).toBeCloseTo(0.9, 5);
    expect(right.sizes[0]).toBe(1);
  });

  it('stops at the floor, with the control disabled and the reason on screen', () => {
    render(<Harness initial={fixture()} />);
    fireEvent.focusIn(boxFor('p2'));
    const smaller = () => screen.getByRole('button', { name: 'Make this photo shorter, and the one beside it taller' });
    // Seven taps take an even split to MIN_PAIR_SHARE.
    for (let tap = 0; tap < 7; tap += 1) fireEvent.click(smaller());
    expect(smaller()).toBeDisabled();
    expect(screen.getByText('This box is as short as it goes — any less and you could not see what is in it.')).toBeInTheDocument();
  });

  it('says why, rather than offering a control that would do nothing, for a collage of one photo', () => {
    render(<Harness initial={photo('only')} />);
    fireEvent.focusIn(boxFor('only'));
    expect(screen.getByRole('button', { name: 'Make this photo wider, and the one beside it narrower' })).toBeDisabled();
    expect(
      screen.getByText('This photo fills the whole collage — there is nothing beside it to take the space from.'),
    ).toBeInTheDocument();
  });

  it('refuses both size controls while a publish is in flight', () => {
    render(<Harness initial={fixture()} locked />);
    fireEvent.focusIn(boxFor('p1'));
    expect(screen.getByRole('button', { name: 'Make this photo wider, and the one beside it narrower' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Make this photo narrower, and the one beside it wider' })).toBeDisabled();
  });
});

describe('the collage editor: the panel', () => {
  // The panel itself, not just its buttons: an empty bar pinned to the bottom
  // of the screen is precisely what the owner objected to about the panel this
  // replaces -- "a control panel which has no information in it". Asserting
  // only that its buttons are absent would pass for an always-present blank
  // one, which is what the first version of this test did.
  it('is not on screen at all until something is selected', () => {
    render(<Harness initial={fixture()} />);
    expect(document.querySelector('[data-collage-panel]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Swap this photo with another photo' })).toBeNull();
  });

  // Focus doubles as selection so the collage is reachable from a keyboard
  // without adding sixteen tab stops of its own -- the camera badge's own
  // file input inside each box is already focusable. No hit-testing involved,
  // which is why this one is honest in jsdom.
  it('opens on the photo focus lands inside, and names which one of how many', () => {
    render(<Harness initial={fixture()} />);
    fireEvent.focusIn(boxFor('p3'));
    expect(screen.getByText('Photo 3 of 4')).toBeInTheDocument();
  });

  it('shows the photo itself, not just its number', () => {
    render(<Harness initial={fixture()} />);
    fireEvent.focusIn(boxFor('p3'));
    const panel = screen.getByText('Photo 3 of 4').closest('div')!.parentElement!;
    expect(within(panel).getByRole('presentation', { hidden: true })).toHaveAttribute('src', '/hero/p3.webp');
  });

  it('prefers the photo she just picked over the path that is not built yet', () => {
    const previews: ImagePreviews = { urls: { 'galleries.heroCollage.p3': 'blob:just-picked' }, set: () => {} };
    render(<Harness initial={fixture()} previews={previews} />);
    fireEvent.focusIn(boxFor('p3'));
    const panel = screen.getByText('Photo 3 of 4').closest('div')!.parentElement!;
    expect(within(panel).getByRole('presentation', { hidden: true })).toHaveAttribute('src', 'blob:just-picked');
  });

  it('says the collage is paused, and refuses the swap control, while a publish is in flight', () => {
    render(<Harness initial={fixture()} locked />);
    fireEvent.focusIn(boxFor('p1'));
    expect(screen.getByRole('button', { name: 'Swap this photo with another photo' })).toBeDisabled();
    expect(screen.getByText('Publishing… arranging the collage is paused for a moment.')).toBeInTheDocument();
  });
});

describe('the collage editor: swapping without a drag', () => {
  function arm(id: string) {
    fireEvent.focusIn(boxFor(id));
    fireEvent.click(screen.getByRole('button', { name: 'Swap this photo with another photo' }));
  }

  it('offers every OTHER photo as a target, and never the one already chosen', () => {
    render(<Harness initial={fixture()} />);
    arm('p1');
    const targets = screen.getAllByRole('button', { name: 'Swap the selected photo into this box' });
    expect(targets).toHaveLength(3);
    expect(boxFor('p1').querySelector('button')).toBeNull();
  });

  it('every control it puts inside the collage carries the marker /edit’s click guard looks for', () => {
    // EditMode.tsx's capture-phase guard cancels every click it does not
    // recognise, and `data-collage-control` is the carve-out for these. The
    // guard had no producer at all between the split-tree rewrite and this
    // file, so this pins the two together.
    render(<Harness initial={fixture()} />);
    arm('p1');
    const inside = boxes().flatMap((box) => [...box.querySelectorAll('button, [role="button"], input')]);
    expect(inside.length).toBeGreaterThan(0);
    inside.forEach((el) => {
      expect(el.closest('[data-collage-control]'), `${el.outerHTML} is not inside a collage control`).not.toBeNull();
    });
  });

  it('exchanges exactly the two photos and moves no box', () => {
    const onChange = vi.fn();
    render(<Harness initial={fixture()} onChange={onChange} />);
    arm('p1');
    fireEvent.click(within(boxFor('p4')).getByRole('button', { name: 'Swap the selected photo into this box' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    // Document order is where each photo now sits.
    expect(boxes().map((el) => el.getAttribute(COLLAGE_PHOTO_ATTR))).toEqual(['p4', 'p2', 'p3', 'p1']);
    // ...and every box is exactly the size it was: the tree's sizes are
    // rendered as inline flexGrow, so a changed box is a changed number here.
    expect(boxFor('p4').style.flexGrow).toBe('1.5');
    expect(boxFor('p1').style.flexGrow).toBe('1');
    expect(document.querySelectorAll('[data-collage-photo-id]')).toHaveLength(4);
  });

  it('says so, out loud, when the swap lands', () => {
    render(<Harness initial={fixture()} />);
    arm('p1');
    fireEvent.click(within(boxFor('p4')).getByRole('button', { name: 'Swap the selected photo into this box' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Swapped. The two photos exchanged places; both boxes are exactly the size they were.',
    );
  });

  it('disarms without swapping when she cancels', () => {
    const onChange = vi.fn();
    render(<Harness initial={fixture()} onChange={onChange} />);
    arm('p1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the swap' }));
    expect(screen.queryAllByRole('button', { name: 'Swap the selected photo into this box' })).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers nothing to swap with when the collage holds a single photo', () => {
    render(<Harness initial={photo('only')} />);
    fireEvent.focusIn(boxFor('only'));
    expect(screen.getByRole('button', { name: 'Swap this photo with another photo' })).toBeDisabled();
  });
});
