import { describe, expect, it } from 'vitest';
import { GRID_SIZE, formatPlacement, isOnGrid, parsePlacement, resolveLayout, type Placement } from '../placement';
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
  // module's own header comment explains the method). This is the exact
  // input `galleries.json` has TODAY, before this plan's own Task 2 gives
  // entry 4 an explicit row start pinning it to the collage's first row --
  // so entry 4 resolving into an IMPLICIT seventh row, outside the six
  // explicit rows `grid-rows-6` declares,
  // is not a bug in this test: it is the live defect this whole plan exists
  // to repair, proven here the same way the plan's own review proved it.
  describe('the real, unrepaired galleries.json', () => {
    const placements = galleries.heroCollage.map((t) => parsePlacement(t.className));
    const resolved = resolveLayout(placements);

    const golden: Record<number, { colStart: number; colSpan: number; rowStart: number; rowSpan: number }> = {
      0: { colStart: 5, colSpan: 2, rowStart: 1, rowSpan: 2 },
      1: { colStart: 5, colSpan: 2, rowStart: 5, rowSpan: 2 },
      2: { colStart: 3, colSpan: 2, rowStart: 3, rowSpan: 2 },
      3: { colStart: 1, colSpan: 2, rowStart: 5, rowSpan: 2 },
      4: { colStart: 3, colSpan: 2, rowStart: 7, rowSpan: 1 },
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

    it('entry 4 lands in an implicit row today -- the nine-tile clip this plan repairs', () => {
      expect(isOnGrid(resolved[4])).toBe(false);
      expect((resolved[4] as { rowStart: number }).rowStart).toBeGreaterThan(GRID_SIZE);
    });

    it('every OTHER entry is on-grid today -- entry 4 is the one tile the safelist alone does not fix', () => {
      resolved.forEach((r, i) => {
        if (i === 4) return;
        expect(isOnGrid(r)).toBe(true);
      });
    });
  });
});
