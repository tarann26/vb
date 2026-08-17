import { describe, expect, it } from 'vitest';
import { moveTo, swapAt } from '../reorder';

// A move is not a swap, and that is the whole reason this function exists
// beside swapAt rather than reusing it. Dragging block 1 to position 4 must
// SLIDE the three in between up by one, not exchange two of them -- which is
// what Up/Down does and what a swap-based drag would do wrongly.
//
// The table is typed rather than inferred: an untyped array of mixed rows
// widens every column to `string | number | string[]`, so the callback's
// `from` is not a number and the call below does not compile.
const MOVES: [string, number, number, string[]][] = [
  ['forwards', 0, 2, ['b', 'c', 'a', 'd']],
  ['backwards', 3, 1, ['a', 'd', 'b', 'c']],
  ['to itself, unchanged', 2, 2, ['a', 'b', 'c', 'd']],
  ['to the end', 0, 3, ['b', 'c', 'd', 'a']],
  ['to the start', 3, 0, ['d', 'a', 'b', 'c']],
  ['one step forwards, which IS a swap', 1, 2, ['a', 'c', 'b', 'd']],
];

// Clamped rather than trusted. `to` reaches this from a drop target's own
// index today and from anywhere the moment anyone adds a keyboard affordance.
//
// The first row is -1, not some comfortably far-out -5, and the difference is
// the whole value of these four cases. `splice` clamps an insertion index
// BELOW -length and ABOVE length by itself, so -5 and 99 produce the right
// answer with or without the clamp in moveTo -- they pin the behaviour and
// cannot fail if the clamp is deleted. A SMALL negative index is the one
// splice interprets rather than clamps: it counts back from the end, which
// drops the block one place short of where she let go of it. Phase 5A's
// fourteenth under-asserting test was this shape, an out-of-range index
// returning a real but wrong result that a length check accepted.
const CLAMPS: [string, number, number, string[]][] = [
  ['a small negative target, which splice would read as counting back', 0, -1, ['a', 'b', 'c', 'd']],
  ['a negative target far past the start', 2, -5, ['c', 'a', 'b', 'd']],
  ['a target past the end', 1, 99, ['a', 'c', 'd', 'b']],
  ['a negative source', -1, 0, ['a', 'b', 'c', 'd']],
  ['a source past the end', 99, 0, ['a', 'b', 'c', 'd']],
];

describe('moveTo', () => {
  it.each(MOVES)('moves %s', (_name, from, to, expected) => {
    expect(moveTo(['a', 'b', 'c', 'd'], from, to)).toEqual(expected);
  });

  it.each(CLAMPS)('clamps %s', (_name, from, to, expected) => {
    expect(moveTo(['a', 'b', 'c', 'd'], from, to)).toEqual(expected);
  });

  // An out-of-range splice silently drops an item -- which, on a block list,
  // is a paragraph she wrote disappearing. Asserted over every index pair a
  // drop or a future keyboard move could hand in, because "the answer is a
  // real array" is what the weaker version of this check accepted.
  it('never loses an item, whatever it is asked', () => {
    const items = ['a', 'b', 'c', 'd'];
    for (let from = -2; from < 6; from += 1) {
      for (let to = -2; to < 6; to += 1) {
        expect([...moveTo(items, from, to)].sort(), `moveTo(items, ${from}, ${to})`).toEqual([...items].sort());
      }
    }
  });

  it('returns a new array and does not mutate the one it was given', () => {
    const items = ['a', 'b', 'c', 'd'];
    const next = moveTo(items, 0, 3);
    expect(next).not.toBe(items);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });
});

// swapAt had no test of its own -- it was extracted in Task 5 and covered only
// through BlockList's and BlockFields' own Up/Down cases. Its behaviour is now
// one line away from moveTo's in the same file, and the difference between the
// two is exactly what a reader of this module needs to see, so it is pinned
// here rather than left to be inferred from a component test.
describe('swapAt', () => {
  it('exchanges two entries and leaves everything else alone', () => {
    expect(swapAt(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('is NOT a move: the entries in between stay where they were', () => {
    expect(swapAt(['a', 'b', 'c', 'd'], 0, 3)).not.toEqual(moveTo(['a', 'b', 'c', 'd'], 0, 3));
  });

  it('returns a new array and does not mutate the one it was given', () => {
    const items = ['a', 'b', 'c', 'd'];
    const next = swapAt(items, 0, 1);
    expect(next).not.toBe(items);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });
});
