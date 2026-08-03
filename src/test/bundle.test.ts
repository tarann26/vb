import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The obvious way to prove heic-to's WASM decoder never reaches a visitor
// is to spy on some load callback deep inside it and assert the spy was
// never called for a JPEG upload. That test cannot fail: whether
// src/admin/heic.ts's `import('heic-to')` is written as a dynamic import
// (gated behind the content check) or hoisted to a static import at the
// top of the file, the spy goes uncalled either way for a JPEG input --
// the *code path* that would call it never runs regardless. But only the
// dynamic form keeps the decoder out of the built bundle; the static form
// puts it in every chunk that reaches src/admin/heic.ts, unconditionally,
// whether or not any particular request happens to need it. A runtime spy
// watches what ran; it cannot watch what a bundler decided to include.
// That is an artifact-level fact, not a runtime one, so it needs an
// artifact-level check -- both below.
describe('nothing outside src/admin imports the heic module', () => {
  // git ls-files, not a filesystem walk (readdirSync/glob): only tracked
  // files matter here, and this avoids ever descending into node_modules
  // or dist, neither of which `git ls-files src` would return anyway.
  function gitLsFiles(dir: string): string[] {
    return execFileSync('git', ['ls-files', dir], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  }

  it('no .ts/.tsx file outside src/admin/ imports admin/heic', () => {
    const offenders = gitLsFiles('src')
      .filter((f) => !f.startsWith('src/admin/') && /\.tsx?$/.test(f))
      .filter((f) => /from ['"].*admin\/heic['"]/.test(readFileSync(f, 'utf8')));

    expect(offenders).toEqual([]);
  });
});

// dist/ only exists after `npm run build`, which this repository always
// runs *after* its test suites -- see docs/cloudflare-cutover.md's
// documented build command (`npm run images && npm run test:deploy && npm
// run build`) and hosting.test.ts's own tests pinning that order. A bare,
// unconditional check here would fail `npm run test`/`test:deploy` on
// every fresh checkout and on every real Cloudflare Pages build, neither
// of which has run `npm run build` yet at that point -- a false failure,
// not a real one. skipIf keeps this green (as "skipped", not "passed")
// until a build has actually happened; run `npm run build` first (as this
// task's own report does) to get a real answer from it.
describe('dist/assets/ excludes the libheif WASM decoder', () => {
  const DIST_ASSETS = 'dist/assets';

  // "libheif" itself, not a more specific symbol name: it is the single
  // most direct textual trace of the decoder actually being present,
  // appears exactly once in heic-to's own built bundle (verified directly
  // against node_modules/heic-to/dist/heic-to.js while writing this test),
  // and does not appear anywhere in this repository's current dist/assets/
  // output (also verified directly) -- so neither a false positive nor a
  // false negative today.
  const LIBHEIF_MARKER = 'libheif';

  it.skipIf(!existsSync(DIST_ASSETS))('no built asset contains the libheif marker', () => {
    const offenders = readdirSync(DIST_ASSETS).filter((name) =>
      readFileSync(join(DIST_ASSETS, name)).includes(LIBHEIF_MARKER),
    );

    expect(offenders).toEqual([]);
  });
});
