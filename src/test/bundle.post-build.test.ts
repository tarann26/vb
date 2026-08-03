import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The artifact-level half of the two-part check described in
// src/test/bundle.test.ts's file comment: that file proves nothing outside
// src/admin/ ever *references* admin code in source; this file proves the
// decoder heic-to pulls in doesn't actually *land* in the built output
// either. A source-level check alone can't rule out a bundler quirk (or a
// transitive dependency neither check was written to expect) putting it
// there anyway -- only inspecting the real artifact can.
//
// Moved here from src/test/bundle.test.ts (Plan 4 Task 1) and given its
// own `"test:bundle": "vitest run src/test/bundle.post-build.test.ts"`
// script, appended to the end of `npm run build` in package.json. Before
// this move, this check only ever ran if a `dist/` directory happened to
// already exist on disk when someone ran the full suite by hand -- never
// wired into any script, so it never actually ran as part of a real
// deploy. It still uses the same skipIf guard below (so `npm run test` and
// `npm run test:deploy`, both of which run *before* `dist/` exists on a
// fresh checkout or a real Cloudflare build -- see docs/cloudflare-cutover.md
// -- see this as a clean skip, not a false failure), but `npm run build`
// now runs `vite build` immediately before invoking this file, so on every
// real build dist/assets/ exists and this check runs for real, not
// skipped, for the first time.
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

// The libheif check above guards one dependency. This guards the invariant
// the whole lazy route exists for: admin code lands in its OWN chunk, never
// in the entry chunk every visitor downloads.
//
// Written after the libheif check was found to pass while admin code WAS in
// the main chunk: switching src/App.tsx's `lazy(() => import(...))` to a
// static import puts AdminApp in index-*.js, and that mutation stayed green
// here, because AdminApp does not import src/admin/heic.ts (that arrives in
// Task 5). Correct for what it claimed, silent on what mattered.
describe('dist/assets/ keeps admin code out of the entry chunk', () => {
  const DIST_ASSETS = 'dist/assets';

  // The login form's aria-label: present in admin source, in no public
  // component, and stable enough to survive styling changes.
  const ADMIN_MARKER = 'Admin login';

  function assetsContaining(marker: string): string[] {
    return readdirSync(DIST_ASSETS).filter((name) =>
      readFileSync(join(DIST_ASSETS, name), 'utf8').includes(marker),
    );
  }

  // Without this, a renamed aria-label would make the check below pass by
  // finding the marker nowhere at all -- guarding nothing, silently. If this
  // fails, the marker moved; re-point it rather than deleting the check.
  it.skipIf(!existsSync(DIST_ASSETS))('the admin marker is present in some chunk', () => {
    expect(assetsContaining(ADMIN_MARKER).length).toBeGreaterThan(0);
  });

  it.skipIf(!existsSync(DIST_ASSETS))('the entry chunk does not contain admin code', () => {
    const entryChunks = readdirSync(DIST_ASSETS).filter((n) => /^index-.*\.js$/.test(n));
    expect(entryChunks.length).toBeGreaterThan(0);

    const leaking = entryChunks.filter((name) =>
      readFileSync(join(DIST_ASSETS, name), 'utf8').includes(ADMIN_MARKER),
    );
    expect(leaking).toEqual([]);
  });
});
