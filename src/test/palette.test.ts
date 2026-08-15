import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

const BRAND = '#C8D8E8';
const BRAND_DARK = '#A6B3C1';
const ACCENT = '#9D4949';
const INK = '#222222';
const WHITE = '#FFFFFF';

// Every hex the old palette used, lowercased for comparison. `6b8b59` is the
// green itself; `5a7349` is its hover partner. Both appeared as bare literals
// inside className strings.
const RETIRED = ['6b8b59', '5a7349'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

describe('the retired green', () => {
  it('appears nowhere in src/, including comments', () => {
    // Comments count. Tailwind's scanner is a plain text extractor with no
    // JS parser, so a hex inside a comment is indistinguishable from one in
    // a className as far as the generated CSS is concerned, and a stale hex
    // in a comment is a lie to the next reader either way.
    const offenders = sourceFiles('src')
      .filter((file) => file !== 'src/test/palette.test.ts')
      .filter((file) => {
        const text = readFileSync(file, 'utf8').toLowerCase();
        return RETIRED.some((hex) => text.includes(hex));
      });
    expect(offenders).toEqual([]);
  });
});

describe('the brand palette meets WCAG AA where it carries meaning', () => {
  it('puts readable text on a brand-blue surface', () => {
    // #C8D8E8 is a light surface at 1.45:1 against white. Ink on it is the
    // only readable pairing, and this is the assertion that stops a future
    // edit from putting white text on a blue button.
    expect(contrastRatio(BRAND, INK)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(BRAND, WHITE)).toBeLessThan(4.5);
  });

  it('lets the accent carry text on white and white text on itself', () => {
    expect(contrastRatio(ACCENT, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the hover shade distinguishable from the base', () => {
    // The eye needs to see the hover happen. Equal colours would pass every
    // other assertion in this file.
    expect(contrastRatio(BRAND, BRAND_DARK)).toBeGreaterThan(1.1);
  });

  it('keeps ink readable on both creams', () => {
    expect(contrastRatio('#FFFDF8', INK)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#F9F9F9', INK)).toBeGreaterThanOrEqual(4.5);
  });
});
