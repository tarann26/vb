import { describe, expect, it } from 'vitest';
import { GRID_SIZE, formatPlacement, isOnGrid, moveTile, parsePlacement, resizeTile, resolveLayout, type Placement } from '../placement';
import { galleries } from '..';

describe('GRID_SIZE', () => {
  it('is 6 -- the collage grid this whole module is built around', () => {
    expect(GRID_SIZE).toBe(6);
  });
});

describe('parsePlacement', () => {
  it('parses all four fields', () => {
    expect(parsePlacement('col-start-5 col-span-2 row-start-2 row-span-2')).toEqual({
      colStart: 5,
      colSpan: 2,
      rowStart: 2,
      rowSpan: 2,
    });
  });

  it('leaves an absent field null, not zero or undefined', () => {
    expect(parsePlacement('col-span-2 row-span-2')).toEqual({
      colStart: null,
      colSpan: 2,
      rowStart: null,
      rowSpan: 2,
    });
  });

  it('tolerates the fields in the order the real content already uses (col-start, col-span, row-start, row-span)', () => {
    expect(parsePlacement('col-start-3 col-span-1 row-start-2')).toEqual({
      colStart: 3,
      colSpan: 1,
      rowStart: 2,
      rowSpan: null,
    });
  });

  it('refuses an empty string', () => {
    expect(parsePlacement('')).toBeNull();
    expect(parsePlacement('   ')).toBeNull();
  });

  it('refuses a token it does not recognise', () => {
    expect(parsePlacement('garbage')).toBeNull();
    expect(parsePlacement('col-start-3 relative')).toBeNull();
  });

  it('refuses col-start-0 -- grid lines are 1-based', () => {
    expect(parsePlacement('col-start-0')).toBeNull();
  });

  it('refuses a duplicate axis token rather than silently picking one', () => {
    expect(parsePlacement('col-start-3 col-start-5')).toBeNull();
  });

  // Mutation check: dropping the `value < 1` guard (leaving only
  // `Number.isInteger`) would let `col-start-0` back in -- confirmed by
  // temporarily removing that clause and re-running this file: the
  // 'refuses col-start-0' test above goes red immediately, proving it is
  // load-bearing rather than redundant with the regex's own `\d+`.
  it('refuses a non-numeric index the token regex cannot match at all', () => {
    expect(parsePlacement('col-start-abc')).toBeNull();
  });
});

describe('formatPlacement', () => {
  it('omits every null field', () => {
    expect(formatPlacement({ colStart: null, colSpan: 2, rowStart: null, rowSpan: 2 })).toBe('col-span-2 row-span-2');
  });

  it('emits all four in col-start, col-span, row-start, row-span order', () => {
    expect(formatPlacement({ colStart: 5, colSpan: 2, rowStart: 2, rowSpan: 2 })).toBe(
      'col-start-5 col-span-2 row-start-2 row-span-2',
    );
  });

  it('is the empty string for every field null', () => {
    expect(formatPlacement({ colStart: null, colSpan: null, rowStart: null, rowSpan: null })).toBe('');
  });
});

// The plan's own headline requirement: with four nullable fields, every one
// of the sixteen real, committed `galleries.heroCollage` entries round-trips
// BYTE-IDENTICALLY through parse -> format. An earlier draft of this plan
// declared four required numbers instead -- confirmed directly (by trying
// it) that only 3 of the 16 real entries survive that round trip; the other
// 13 get rewritten, two of them (entries with no `col-start` at all) gaining
// one they never had, which silently changes the layout. This test reads
// the real committed file, not a copy or a fixture, so it can never drift
// from what `galleries.json` actually contains.
describe('formatPlacement(parsePlacement(x)) === x for every real heroCollage entry', () => {
  const classNames = galleries.heroCollage.map((t) => t.className);

  it('has sixteen real entries to check -- non-vacuous', () => {
    expect(classNames.length).toBe(16);
  });

  classNames.forEach((className, i) => {
    it(`entry ${i}: "${className}"`, () => {
      const parsed = parsePlacement(className);
      expect(parsed).not.toBeNull();
      expect(formatPlacement(parsed as Placement)).toBe(className);
    });
  });
});

describe('isOnGrid', () => {
  it('is false for null', () => {
    expect(isOnGrid(null)).toBe(false);
  });

  it('is true for a placement that sits entirely within 1..GRID_SIZE on both axes', () => {
    expect(isOnGrid({ colStart: 5, colSpan: 2, rowStart: 5, rowSpan: 2 })).toBe(true);
  });

  it('is false when the span runs off the right edge', () => {
    expect(isOnGrid({ colStart: 6, colSpan: 2, rowStart: 1, rowSpan: 1 })).toBe(false);
  });

  it('is false when the row starts past GRID_SIZE (an implicit row)', () => {
    expect(isOnGrid({ colStart: 1, colSpan: 1, rowStart: 7, rowSpan: 1 })).toBe(false);
  });

  // Task 3's resize buttons are what first makes a non-positive span
  // reachable (shrinking a 1-wide tile once more). Without this, a resolved
  // placement with colSpan 0 or -1 would read as "on grid" -- colStart + 0 -
  // 1 is still <= GRID_SIZE -- which is exactly backwards.
  it('is false when colSpan is zero or negative', () => {
    expect(isOnGrid({ colStart: 3, colSpan: 0, rowStart: 1, rowSpan: 1 })).toBe(false);
    expect(isOnGrid({ colStart: 3, colSpan: -1, rowStart: 1, rowSpan: 1 })).toBe(false);
  });

  it('is false when rowSpan is zero or negative', () => {
    expect(isOnGrid({ colStart: 1, colSpan: 1, rowStart: 3, rowSpan: 0 })).toBe(false);
  });
});

describe('moveTile', () => {
  const FIXTURE = ['col-start-3 col-span-1 row-start-3 row-span-1', 'col-start-1 col-span-1 row-start-1 row-span-1'];

  it('moves a fully-definite tile one cell in each direction', () => {
    expect(moveTile(FIXTURE, 0, 'up')).toEqual({ colStart: 3, colSpan: 1, rowStart: 2, rowSpan: 1 });
    expect(moveTile(FIXTURE, 0, 'down')).toEqual({ colStart: 3, colSpan: 1, rowStart: 4, rowSpan: 1 });
    expect(moveTile(FIXTURE, 0, 'left')).toEqual({ colStart: 2, colSpan: 1, rowStart: 3, rowSpan: 1 });
    expect(moveTile(FIXTURE, 0, 'right')).toEqual({ colStart: 4, colSpan: 1, rowStart: 3, rowSpan: 1 });
  });

  // Task 4 Step 3's own finding applies to a button too: an auto-placed
  // tile has no colStart/rowStart in its own className for a naive "read
  // the field, add one" implementation to start from -- only resolveLayout,
  // across every sibling, can say where it currently IS. This is what makes
  // that possible for a button press, not just a drag.
  it('resolves an auto-placed tile\'s CURRENT position first, then moves from there -- not from a raw (absent) field', () => {
    const autoFixture = ['col-span-1 row-span-1', 'col-start-1 col-span-1 row-start-1 row-span-1'];
    // Entry 0 is fully auto; entry 1 occupies (1,1), so entry 0 resolves to
    // (2,1) via resolveLayout's own wrap-to-next-row behaviour.
    expect(moveTile(autoFixture, 0, 'right')).toEqual({ colStart: 3, colSpan: 1, rowStart: 1, rowSpan: 1 });
  });

  it('returns null when the named entry cannot be resolved at all', () => {
    expect(moveTile(['garbage'], 0, 'up')).toBeNull();
  });

  // Confirms the move is a PURE candidate -- it does not itself refuse an
  // off-grid result. `isOnGrid` (the same function validateContent and
  // Hero.test.tsx use) is what a caller checks before committing; the
  // component test (CollageTile.test.tsx) proves a button that would
  // produce this candidate is disabled rather than committing it.
  it('produces an off-grid candidate without refusing it -- that is the caller\'s job', () => {
    const atLeftEdge = ['col-start-1 col-span-1 row-start-1 row-span-1'];
    const candidate = moveTile(atLeftEdge, 0, 'left');
    expect(candidate).toEqual({ colStart: 0, colSpan: 1, rowStart: 1, rowSpan: 1 });
    expect(isOnGrid(candidate)).toBe(false);
  });
});

describe('resizeTile', () => {
  const FIXTURE = ['col-start-3 col-span-2 row-start-3 row-span-1'];

  it('grows and shrinks the column span, leaving the row alone', () => {
    expect(resizeTile(FIXTURE, 0, 'col', 1)).toEqual({ colStart: 3, colSpan: 3, rowStart: 3, rowSpan: 1 });
    expect(resizeTile(FIXTURE, 0, 'col', -1)).toEqual({ colStart: 3, colSpan: 1, rowStart: 3, rowSpan: 1 });
  });

  it('grows and shrinks the row span, leaving the column alone', () => {
    expect(resizeTile(FIXTURE, 0, 'row', 1)).toEqual({ colStart: 3, colSpan: 2, rowStart: 3, rowSpan: 2 });
    expect(resizeTile(FIXTURE, 0, 'row', -1)).toEqual({ colStart: 3, colSpan: 2, rowStart: 3, rowSpan: 0 });
  });

  it('a shrink past 1 produces a non-positive span, which isOnGrid refuses', () => {
    const shrunkTwice = resizeTile(['col-start-3 col-span-1 row-start-3 row-span-1'], 0, 'col', -1);
    expect(shrunkTwice).toEqual({ colStart: 3, colSpan: 0, rowStart: 3, rowSpan: 1 });
    expect(isOnGrid(shrunkTwice)).toBe(false);
  });

  it('returns null when the named entry cannot be resolved at all', () => {
    expect(resizeTile(['garbage'], 0, 'col', 1)).toBeNull();
  });
});

// resolveLayout's own correctness -- checked here against small, hand-built
// fixtures whose expected answer can be reasoned about directly, and
// against the real sixteen-entry galleries.json below (golden numbers
// measured from a real, compiled Tailwind stylesheet in real Chromium --
// see this module's own header comment for how).
describe('resolveLayout', () => {
  it('places a single, fully-definite item exactly where it says', () => {
    const [resolved] = resolveLayout([{ colStart: 3, colSpan: 2, rowStart: 4, rowSpan: 1 }]);
    expect(resolved).toEqual({ colStart: 3, colSpan: 2, rowStart: 4, rowSpan: 1 });
  });

  it('defaults an absent span to 1, matching CSS grid default', () => {
    const [resolved] = resolveLayout([{ colStart: 3, colSpan: null, rowStart: 4, rowSpan: null }]);
    expect(resolved).toEqual({ colStart: 3, colSpan: 1, rowStart: 4, rowSpan: 1 });
  });

  it('leaves a null entry unresolved (null in, null out)', () => {
    expect(resolveLayout([null])).toEqual([null]);
  });

  it('leaves an item unresolved when its span alone is wider than the grid', () => {
    const [resolved] = resolveLayout([{ colStart: null, colSpan: GRID_SIZE + 1, rowStart: null, rowSpan: 1 }]);
    expect(resolved).toBeNull();
  });

  it('auto-places a fully-indefinite item into the first free cell, document order', () => {
    const [first, second] = resolveLayout([
      { colStart: null, colSpan: 1, rowStart: null, rowSpan: 1 },
      { colStart: null, colSpan: 1, rowStart: null, rowSpan: 1 },
    ]);
    expect(first).toEqual({ colStart: 1, colSpan: 1, rowStart: 1, rowSpan: 1 });
    expect(second).toEqual({ colStart: 2, colSpan: 1, rowStart: 1, rowSpan: 1 });
  });

  it('does not let two explicitly-placed, overlapping tiles collide in the occupancy map -- overlap is allowed, both keep their own authored position', () => {
    const [a, b] = resolveLayout([
      { colStart: 1, colSpan: 2, rowStart: 1, rowSpan: 2 },
      { colStart: 1, colSpan: 1, rowStart: 1, rowSpan: 1 },
    ]);
    expect(a).toEqual({ colStart: 1, colSpan: 2, rowStart: 1, rowSpan: 2 });
    expect(b).toEqual({ colStart: 1, colSpan: 1, rowStart: 1, rowSpan: 1 });
  });

  it('routes an auto-placed item around cells a fully-definite item already occupies', () => {
    const [, second] = resolveLayout([
      { colStart: 1, colSpan: GRID_SIZE, rowStart: 1, rowSpan: 1 },
      { colStart: null, colSpan: 1, rowStart: null, rowSpan: 1 },
    ]);
    // Row 1 is entirely occupied by the first (definite, full-width) item;
    // the second must fall through to row 2.
    expect(second).toEqual({ colStart: 1, colSpan: 1, rowStart: 2, rowSpan: 1 });
  });

  // The real, sixteen-entry hero collage -- golden values measured directly
  // from a real, compiled Tailwind stylesheet in real Chromium (this
  // module's own header comment explains the method), against the REPAIRED
  // content Task 2 Step 3 committed: entry 4 (`/hero/farfalle4.webp`) now
  // carries an explicit row start pinning it to the collage's first row.
  // Before that fix, entry 4 resolved into an IMPLICIT seventh row, outside
  // the six explicit rows `grid-rows-6` declares -- proven directly, not
  // just described, by this same describe block before Task 2 landed (see
  // that commit's own diff): fifteen of these sixteen assertions were
  // already true then; only entry 4's own expected value changed, from
  // `{ colStart: 3, colSpan: 2, rowStart: 7, rowSpan: 1 }` (implicit, off
  // grid) to the on-grid value below.
  describe('the real, repaired galleries.json', () => {
    const placements = galleries.heroCollage.map((t) => parsePlacement(t.className));
    const resolved = resolveLayout(placements);

    const golden: Record<number, { colStart: number; colSpan: number; rowStart: number; rowSpan: number }> = {
      0: { colStart: 5, colSpan: 2, rowStart: 1, rowSpan: 2 },
      1: { colStart: 5, colSpan: 2, rowStart: 5, rowSpan: 2 },
      2: { colStart: 3, colSpan: 2, rowStart: 3, rowSpan: 2 },
      3: { colStart: 1, colSpan: 2, rowStart: 5, rowSpan: 2 },
      4: { colStart: 3, colSpan: 2, rowStart: 1, rowSpan: 1 },
      5: { colStart: 3, colSpan: 2, rowStart: 6, rowSpan: 1 },
      6: { colStart: 1, colSpan: 1, rowStart: 3, rowSpan: 2 },
      7: { colStart: 6, colSpan: 1, rowStart: 3, rowSpan: 2 },
      8: { colStart: 3, colSpan: 1, rowStart: 2, rowSpan: 1 },
      9: { colStart: 4, colSpan: 1, rowStart: 2, rowSpan: 1 },
      10: { colStart: 2, colSpan: 1, rowStart: 3, rowSpan: 1 },
      11: { colStart: 5, colSpan: 1, rowStart: 3, rowSpan: 1 },
      12: { colStart: 2, colSpan: 1, rowStart: 4, rowSpan: 1 },
      13: { colStart: 5, colSpan: 1, rowStart: 4, rowSpan: 1 },
      14: { colStart: 3, colSpan: 1, rowStart: 5, rowSpan: 1 },
      15: { colStart: 4, colSpan: 1, rowStart: 5, rowSpan: 1 },
    };

    Object.entries(golden).forEach(([index, expected]) => {
      it(`entry ${index} resolves exactly where real Chromium renders it`, () => {
        expect(resolved[Number(index)]).toEqual(expected);
      });
    });

    it('all sixteen tiles resolve inside rows and columns 1..GRID_SIZE -- none lands in an implicit row', () => {
      resolved.forEach((r) => {
        expect(isOnGrid(r)).toBe(true);
      });
      expect(resolved.length).toBe(16);
    });
  });

  // I-E review finding: CSS Grid L1 §8.5 step 4's own definite-column
  // branch carries a cursor rule this function was missing entirely --
  // "Set the column position of the cursor to the grid item's column-start
  // line. If this is less than the previous column position of the
  // cursor, increment the row position by 1." Not reachable through this
  // plan's own editing UI today (the real, committed galleries.json has
  // exactly one definite-column/auto-row entry, and this needs two), but a
  // hand-edited galleries.json with two makes it real -- and a real
  // differential against headless Chromium (15,376 tiles, the review's own
  // number) found 13 cases where the missing rule said "on grid" where
  // Chromium actually clips into an implicit row. Always that direction,
  // never the reverse -- which is what makes this dangerous rather than
  // merely imprecise.
  describe('I-E: the definite-column, auto-row cursor rule (CSS Grid L1 §8.5 step 4)', () => {
    it('a later definite-column item whose column is LESS than the previous cursor column moves to the NEXT row, not the cursor\'s current one', () => {
      // The review's own minimal reproducer: col-start-4 then col-start-2,
      // both row-auto. Real Chromium: tile 1 lands at row 2, col 2 -- not
      // row 1, col 2, which is what a cursor with no such comparison at all
      // (the unrepaired version of this function) produced.
      const [first, second] = resolveLayout([
        { colStart: 4, colSpan: null, rowStart: null, rowSpan: null },
        { colStart: 2, colSpan: null, rowStart: null, rowSpan: null },
      ]);
      expect(first).toEqual({ colStart: 4, colSpan: 1, rowStart: 1, rowSpan: 1 });
      expect(second).toEqual({ colStart: 2, colSpan: 1, rowStart: 2, rowSpan: 1 });
    });

    it('a later definite-column item whose column is NOT less than the previous cursor column stays on the cursor\'s current row', () => {
      // col-start-2 then col-start-4: 4 is NOT less than the cursor's
      // column after placing the first item (2 + 1 = 3), so the second
      // item can still land on row 1, same as the unrepaired version
      // already got right -- this is the negative control proving the new
      // comparison doesn't fire when the spec says it shouldn't.
      const [first, second] = resolveLayout([
        { colStart: 2, colSpan: null, rowStart: null, rowSpan: null },
        { colStart: 4, colSpan: null, rowStart: null, rowSpan: null },
      ]);
      expect(first).toEqual({ colStart: 2, colSpan: 1, rowStart: 1, rowSpan: 1 });
      expect(second).toEqual({ colStart: 4, colSpan: 1, rowStart: 1, rowSpan: 1 });
    });

    it('the wrap can cross more than one item -- a THIRD definite-column item still less than the running cursor also drops a row', () => {
      const [, , third] = resolveLayout([
        { colStart: 4, colSpan: null, rowStart: null, rowSpan: null },
        { colStart: 5, colSpan: null, rowStart: null, rowSpan: null },
        { colStart: 1, colSpan: null, rowStart: null, rowSpan: null },
      ]);
      // Cursor column after the second item is 5 + 1 = 6; the third
      // item's column (1) is less than that, so it drops to row 2.
      expect(third).toEqual({ colStart: 1, colSpan: 1, rowStart: 2, rowSpan: 1 });
    });
  });
});
