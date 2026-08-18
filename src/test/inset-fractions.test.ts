import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `right-1/6` shipped on the live homepage for months and nothing caught it.
// Tailwind's default inset scale has halves, thirds and quarters and no
// sixths, so no rule was emitted, `right` stayed `auto` beside `left: auto`,
// and one of Drinks.tsx's four decorative dots fell back to its static
// position at the very left edge of the section at every viewport. It looked
// like a design choice.
//
// Nothing could have caught it. It is not a type error, `tsc` cannot see
// inside a string, eslint has no opinion about class names, jsdom has no
// layout so no vitest render test can measure where the dot went, and the
// stylesheet ceiling in bundle.post-build.test.ts only ever gets SMALLER when
// a utility silently emits nothing. It surfaced by accident, because Task 33
// happened to sample a section's background at the pixel the dot landed on.
//
// So this scans for the whole shape of the mistake rather than for that one
// token. A fraction the inset scale does not define is always a no-op, and a
// no-op that looks like a position is the worst kind: the class is right
// there in the markup, so every review reads it as working.
//
// This file lives under src/test/, which tailwind.config.js's content array
// excludes by name, so the retired token can be written out in full above
// without the scanner emitting a rule for it -- the same comment-leak hazard
// that has cost this project six CSS leaks.
const PROPERTIES = ['inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left'];

// Tailwind v3's default `inset` scale, fractions only. `full` and the numeric
// spacing steps are not fractions and are not this test's subject.
const DEFINED = new Set(['1/2', '1/3', '2/3', '1/4', '2/4', '3/4']);

const PATTERN = new RegExp(`\\b(${PROPERTIES.join('|')})-(\\d+/\\d+)`, 'g');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts)$/.test(full) ? [full] : [];
  });
}

describe('positioning utilities resolve to a real rule', () => {
  it('no inset utility uses a fraction Tailwind does not define', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      // This file names the retired token on purpose, in the comment above.
      if (file === join('src', 'test', 'inset-fractions.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(PATTERN)) {
        if (!DEFINED.has(match[2])) offenders.push(`${file}: ${match[0]}`);
      }
    }
    // Named in the failure rather than counted, because the whole problem
    // with this class of bug is that a reader cannot tell the broken token
    // from the working one by looking at it.
    expect(offenders).toEqual([]);
  });
});
