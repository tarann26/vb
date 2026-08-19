// Every expected path string below was DERIVED BY HAND, once, and checked
// against the arithmetic in the comment beside it. A string pasted out of a
// failing run is an assertion that can never fail again -- it is the shape of
// six of this project's unfalsifiable assertions. Never paste one from output.
import { describe, expect, it } from 'vitest';
import { areaPaths, barPercents, cellOpacity } from '../chart-geometry';

describe('areaPaths', () => {
  it('spans the full width and puts the peak at the top', () => {
    // Hand-derived and checked: x steps 0, 100, 200 across a 200-wide box;
    // y is height - value, so 100, 50, 0. A big value is a SMALL y.
    const paths = areaPaths([0, 50, 100], { width: 200, height: 100 });
    expect(paths?.line).toBe('M0 100 L100 50 L200 0');
    expect(paths?.peak).toBe(100);
  });

  it('closes the fill down to the baseline and back', () => {
    expect(areaPaths([0, 100], { width: 100, height: 50 })?.area).toBe('M0 50 L100 0 L100 50 L0 50 Z');
  });

  it('draws a flat line at the baseline for an all-zero series, not NaN', () => {
    // The state this panel SHIPS in. A NaN in a path attribute renders as
    // literal text in the markup and draws nothing at all.
    const paths = areaPaths([0, 0, 0], { width: 90, height: 30 });
    expect(paths?.line).toBe('M0 30 L45 30 L90 30');
    expect(paths?.line).not.toContain('NaN');
  });

  it('refuses a series too short to be a line', () => {
    expect(areaPaths([], { width: 100, height: 50 })).toBeNull();
    expect(areaPaths([7], { width: 100, height: 50 })).toBeNull();
  });

  it('refuses a zero-sized box rather than dividing by it', () => {
    expect(areaPaths([1, 2], { width: 0, height: 50 })).toBeNull();
    expect(areaPaths([1, 2], { width: 100, height: 0 })).toBeNull();
  });

  it('never puts a negative value above the top of the box', () => {
    expect(areaPaths([-10, 10], { width: 100, height: 50 })?.line).toBe('M0 50 L100 0');
  });
});

describe('barPercents', () => {
  it('gives the largest value the whole track', () => {
    expect(barPercents([10, 5, 1])).toEqual([100, 50, 10]);
  });

  it('is share of the LARGEST, not share of the total', () => {
    // Share-of-total would make these 50 and 50, and the card would read as
    // though nothing were popular.
    expect(barPercents([4, 4])).toEqual([100, 100]);
  });

  it('draws a visible sliver for a single visit rather than nothing', () => {
    expect(barPercents([900, 1])).toEqual([100, 2]);
  });

  it('does not emit NaN when everything is zero', () => {
    expect(barPercents([0, 0])).toEqual([2, 2]);
  });

  it('never returns a negative width', () => {
    expect(barPercents([-5, 10])).toEqual([2, 100]);
  });
});

describe('cellOpacity', () => {
  it('leaves an empty hour completely empty', () => {
    expect(cellOpacity(0, 50)).toBe(0);
  });

  it('makes one visit visible rather than invisible', () => {
    // "Quiet" and "closed" must not look the same. This is the floor.
    expect(cellOpacity(1, 1000)).toBeGreaterThanOrEqual(0.08);
    expect(cellOpacity(1, 1000)).not.toBe(cellOpacity(0, 1000));
  });

  it('takes the busiest hour to full strength', () => {
    expect(cellOpacity(50, 50)).toBe(1);
  });

  it('returns zero rather than dividing by a zero peak', () => {
    expect(cellOpacity(5, 0)).toBe(0);
  });
});
