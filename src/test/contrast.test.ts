import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  // Anchors the sRGB gamma curve, and it is the case that catches the most
  // likely wrong implementation. Skipping the linearisation and averaging
  // the raw channels puts mid-grey at 128/255 = 0.502. The eye reads it at
  // 0.216. Every threshold downstream would inherit that error.
  it('applies the sRGB transfer function, not a linear average', () => {
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#C8D8E8', '#C8D8E8')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#9D4949', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#9D4949'), 5);
  });

  it('accepts three-digit hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1);
  });
});
