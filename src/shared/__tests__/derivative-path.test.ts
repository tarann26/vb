import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { derivativePath } from '../derivative-path';
// Imported from paths.mjs, never from images.mjs: images.mjs loads sharp's
// native binding at module scope, and this file runs inside
// `npm run test:deploy` (nothing in package.json excludes it), the same
// constraint scripts/__tests__/images.test.mjs's own file comment explains.
// Nothing below encodes an image, so nothing below needs sharp to be
// installed or loadable.
import { outputPathFor, SOURCE, IMAGE_EXT } from '../../../scripts/paths.mjs';

// A private copy of images.mjs's own `walk`, not an import of it -- for the
// identical sharp-avoidance reason as the paths.mjs-not-images.mjs import
// choice above. Lists every file under `dir`, recursively.
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

// Temporary fixtures other test files write INTO assets-source/ while they
// run. scripts/__tests__/images.derivatives.test.mjs creates
// `assets-source/food/__corrupt-probe__.jpg` and deletes it again, and this
// file enumerates that same directory at module load -- so whether the probe
// appeared in `sources` depended on whether that other file happened to be
// mid-run at the time.
//
// Found by upgrading vitest: the suite reported 2283 tests on one version and
// 2282 on the next, and the single missing case was the probe. The scheduler
// changed; the race was already here. It made the total test count
// non-deterministic, which quietly devalues that number as a signal -- and it
// meant this file was sometimes asserting a derivative rule against a
// deliberately-corrupt fixture that is not a source image at all.
//
// Matched on the `__name__` convention rather than that one filename, so a
// second probe added by some future test does not reintroduce this.
const TEMP_FIXTURE = /^__.*__\./;

// The same filter listSources() (scripts/images.mjs) applies -- assets-source/
// also holds "Menu - Expanded.pdf", which is not a photo and has no
// derivative rule to agree on.
function realSources(): string[] {
  return walk(SOURCE).filter(
    (f) => IMAGE_EXT.has(extname(f).toLowerCase()) && !TEMP_FIXTURE.test(basename(f)),
  );
}

describe("derivativePath mirrors scripts/paths.mjs's outputPathFor", () => {
  const sources = realSources();

  // Guards the guard: if assets-source/ were ever emptied or this filter
  // broken, every it.each below would report "0 passed" -- green, and
  // silent about having checked nothing. A test that cannot fail is a
  // defect; this is what makes THAT failure mode fail instead.
  it('finds real source images to check against', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  // Not a hand-picked list of cases: every real file this repository
  // actually ships through the upload path, including the messy real-world
  // names (spaces, mixed case, no extension normalization) that a
  // hand-written fixture would be tempted to clean up first.
  it.each(sources)('agrees with outputPathFor for %s', (src) => {
    expect(derivativePath(src)).toBe('/' + relative('public', outputPathFor(src)));
  });

  // The one shape no real file in assets-source/ today actually has: a
  // content-addressed, lowercase-hex stem with no spaces or capitals --
  // exactly what uploadPath (worker/upload.ts) writes for a fresh photo.
  // The equivalence sweep above proves agreement on today's real files; this
  // proves it on the shape tomorrow's uploads will actually produce.
  it('derives the public path for a freshly-uploaded, content-addressed source', () => {
    expect(derivativePath('assets-source/food/0123456789ab.jpg')).toBe('/food/0123456789ab.webp');
  });

  // Every real caller (worker/upload.ts) only ever passes a path uploadPath
  // itself just built, always under assets-source/ -- a path that doesn't
  // start there must fail loudly, not silently mis-derive an answer with a
  // leading ".." segment.
  it('throws on a path not under assets-source/, rather than silently mis-deriving one', () => {
    expect(() => derivativePath('public/food/x.jpg')).toThrow();
  });
});
