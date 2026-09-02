// The arithmetic only. jsdom has no canvas encoder and no image decoder, so
// nothing here calls derive() itself; e2e/photo-upload.spec.ts is where a real
// encode is proven, in a real browser, against real bytes.
import { describe, it, expect } from 'vitest';
import { targetSize, halvingSteps, WEBP_QUALITY, JPEG_QUALITY } from '../derive';
import { maxWidthForCategory } from '../../shared/image-widths';
import { QUALITY } from '../../../scripts/paths.mjs';

describe('targetSize', () => {
  it('caps a wide photograph at the category width', () => {
    expect(targetSize({ width: 4032, height: 3024 }, 1000)).toEqual({ width: 1000, height: 750 });
  });

  it('never enlarges a small one', () => {
    expect(targetSize({ width: 400, height: 300 }, 1000)).toEqual({ width: 400, height: 300 });
  });

  it('caps a hero photograph lower than a food one', () => {
    const natural = { width: 4032, height: 3024 };
    expect(targetSize(natural, maxWidthForCategory('hero')).width)
      .toBeLessThan(targetSize(natural, maxWidthForCategory('food')).width);
  });

  it('never returns a zero dimension for an extreme aspect ratio', () => {
    expect(targetSize({ width: 8000, height: 3 }, 1000).height).toBeGreaterThanOrEqual(1);
  });
});

describe('halvingSteps', () => {
  // MEASURED, and it is not what the plan's own example claimed. The plan
  // wrote [2016, 1000] beside a loop whose condition is `width / 2 > toWidth`,
  // and that loop produces [2016, 1008, 1000]: after 2016, going straight to
  // 1000 would be a 2.016x reduction, which is over the doubling this
  // function exists to stay under, so it takes one more halving first. The
  // implementation matches the stated property and the plan's example did
  // not, so the example is what changed. The extra 1008 -> 1000 pass is a
  // near-identity drawImage and costs nothing worth measuring.
  it('halves until the last step is under a doubling', () => {
    expect(halvingSteps(4032, 1000)).toEqual([2016, 1008, 1000]);
  });

  // The property the array above is only one instance of, and the one that
  // actually matters: no single drawImage is ever asked for more than a 2x
  // reduction, which is the whole reason this function exists rather than one
  // direct draw. Checked over widths that bracket every branch.
  it('never asks one pass for more than a doubling, at any starting width', () => {
    for (const from of [800, 1200, 1999, 2001, 3000, 4032, 8000, 12000]) {
      for (const to of [400, 500, 1000]) {
        let previous = from;
        for (const step of halvingSteps(from, to)) {
          expect(previous / step).toBeLessThanOrEqual(2);
          previous = step;
        }
      }
    }
  });

  it('goes straight there when the reduction is already small', () => {
    expect(halvingSteps(1200, 1000)).toEqual([1000]);
  });

  it('always ends at the target', () => {
    // steps[length - 1] rather than .at(-1): this project's app tsconfig
    // targets ES2020, where Array#at is not declared.
    for (const from of [800, 1000, 1600, 4032, 8000]) {
      const steps = halvingSteps(from, 1000);
      expect(steps[steps.length - 1]).toBe(1000);
    }
  });

  it('terminates rather than looping on a target of one', () => {
    expect(halvingSteps(4032, 1).length).toBeLessThan(20);
  });

  // The length bound above is too loose to tell a correct loop from the
  // obvious wrong one: `width > toWidth` also terminates for a target of 1,
  // it just stops at 1 and pushes a second 1, so both sequences are well
  // under twenty and that test passes either way. Measured, not assumed.
  //
  // A repeated width is a drawImage that scales an image to the size it
  // already is, so no-repeats is both the real defect and the thing that
  // separates the two.
  it('never draws the same width twice', () => {
    for (const [from, to] of [[4032, 1], [4032, 1000], [3000, 500], [1200, 1000], [800, 1000]]) {
      const steps = halvingSteps(from, to);
      expect(new Set(steps).size).toBe(steps.length);
    }
  });
});

describe('quality', () => {
  // NOT `expect(WEBP_QUALITY).toBe(0.78)`, which compares a constant against
  // itself written twice. The claim is that the browser asks for the same
  // quality the fifty existing derivatives were made with, and QUALITY in
  // scripts/paths.mjs is the other half of it.
  it('matches the encoder the fifty existing derivatives were made with', () => {
    expect(Math.round(WEBP_QUALITY * 100)).toBe(QUALITY);
  });

  it('keeps the jpeg fallback above the webp number, since jpeg needs more', () => {
    expect(JPEG_QUALITY).toBeGreaterThan(WEBP_QUALITY);
  });
});
