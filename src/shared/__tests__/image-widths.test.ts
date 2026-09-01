import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
// paths.mjs, never images.mjs: images.mjs loads sharp's native binding at
// module scope and this file runs inside `npm run test:deploy`. Nothing below
// encodes anything, so nothing below should be able to fail on a machine
// where sharp will not install or load.
import { maxWidthFor, outputPathFor, SOURCE, IMAGE_EXT } from '../../../scripts/paths.mjs';
import { maxWidthForOutput, DEFAULT_MAX_WIDTH } from '../image-widths';

function everySource(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? everySource(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

// scripts/__tests__/images.derivatives.test.mjs writes
// `assets-source/food/__corrupt-probe__.jpg` and removes it again while it
// runs, and this file enumerates the same directory at module load -- so
// whether that probe lands in `sources` depends on scheduler order. Filtered
// out for the reason src/shared/__tests__/derivative-path.test.ts records in
// full: it made the suite's own test count non-deterministic.
const TEMP_FIXTURE = /^__.*__\./;

// Every real file under assets-source/, not a hand-picked list -- the same
// arrangement src/shared/__tests__/derivative-path.test.ts uses, and for the
// same reason: a hand-picked list only ever proves the cases somebody thought
// of, and the cases that break are the ones nobody did.
const sources = everySource(SOURCE).filter(
  (f) => IMAGE_EXT.has(f.slice(f.lastIndexOf('.')).toLowerCase()) && !TEMP_FIXTURE.test(basename(f)),
);

describe('the browser width rule agrees with the build-time one', () => {
  it('finds real source files to compare over', () => {
    expect(sources.length).toBeGreaterThanOrEqual(50);
  });

  // Vacuity guard with teeth: a rule that returned DEFAULT_MAX_WIDTH for
  // everything would satisfy every it.each row below on the forty files that
  // genuinely take the default, and the agreement claim would be carried
  // entirely by ten files nobody counted. The distribution is 40/9/1.
  it('compares over files that actually exercise all three branches', () => {
    const caps = sources.map(maxWidthFor);
    expect(caps.filter((w) => w === 1000).length).toBeGreaterThan(0);
    expect(caps.filter((w) => w === 500).length).toBeGreaterThan(0);
    expect(caps.filter((w) => w === 400).length).toBe(1);
  });

  it.each(sources)('%s gets the same cap from both implementations', (source) => {
    expect(maxWidthForOutput(outputPathFor(source))).toBe(maxWidthFor(source));
  });

  // The three precedence branches, named, so a change that happens to leave
  // every current file unchanged still has to be deliberate.
  it('gives the per-file override precedence over the directory one', () => {
    expect(maxWidthForOutput('public/hero/brick.webp')).toBe(400);
    expect(maxWidthForOutput('public/hero/scene.webp')).toBe(500);
  });

  it('does not let a nested directory inherit a top-level cap', () => {
    expect(maxWidthForOutput('public/food/hero/x.webp')).toBe(DEFAULT_MAX_WIDTH);
  });

  it('caps an unknown category at the default', () => {
    expect(maxWidthForOutput('public/posts/abc123abc123.webp')).toBe(DEFAULT_MAX_WIDTH);
  });
});
