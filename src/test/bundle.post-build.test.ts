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
// own `"test:bundle": "VB_REQUIRE_DIST=1 vitest run
// src/test/bundle.post-build.test.ts"` script, appended to the end of
// `npm run build` in package.json. Before this move, this check only ever
// ran if a `dist/` directory happened to already exist on disk when someone
// ran the full suite by hand -- never wired into any script, so it never
// actually ran as part of a real deploy.
//
// REQUIRED (VB_REQUIRE_DIST) is what actually closes that hole. `npm run
// test` and `npm run test:deploy` both run *before* `dist/` exists on a
// fresh checkout or a real Cloudflare build (see
// docs/cloudflare-cutover.md), so this file needs a way to tell "no dist/
// yet, that's expected" apart from "dist/ should be here and isn't." A bare
// `skipIf(!existsSync(...))` can't: confirmed directly, running
// `npm run test:bundle` with `dist/` moved away reported 3 skipped, exit 0
// -- the documented Cloudflare build order (npm run build runs `vite build`
// immediately before this file) happens to always leave a real dist/ on
// disk today, but any future change to vite's outDir/assetsDir, or anyone
// invoking `vitest run src/test/bundle.post-build.test.ts` standalone
// without VB_REQUIRE_DIST set, silently reduces this guard to nothing --
// no red, no signal, the exact inertness this whole task exists to remove.
// `test:bundle` now sets VB_REQUIRE_DIST=1, so its own runs demand dist/
// exist (the "dist/assets exists" test below) rather than quietly skipping
// if it doesn't; every OTHER invocation (`npm run test`, `npm run
// test:deploy`, or a bare `vitest run` sweeping this file up incidentally)
// keeps the old best-effort skip, since dist/ genuinely may not exist yet
// on those paths and that is not a failure.
const REQUIRED = !!process.env.VB_REQUIRE_DIST;
const DIST_ASSETS = 'dist/assets';

// Enforces the "no red, no signal" gap itself, not just the two checks
// below it. it.runIf, not skipIf -- this test must not exist at all (and
// therefore can't fail) on a run where REQUIRED is false, since dist/
// genuinely may not exist yet on those paths (see the file comment above).
// On a REQUIRED run (`npm run test:bundle`, and therefore the last step of
// `npm run build`), a missing dist/assets/ is exactly the failure this task
// existed to make loud.
it.runIf(REQUIRED)('dist/assets exists', () => {
  expect(existsSync(DIST_ASSETS)).toBe(true);
});

describe('dist/assets/ excludes the libheif WASM decoder', () => {
  // "libheif" itself, not a more specific symbol name: it is the single
  // most direct textual trace of the decoder actually being present,
  // appears exactly once in heic-to's own built bundle (verified directly
  // against node_modules/heic-to/dist/heic-to.js while writing this test),
  // and does not appear anywhere in this repository's current dist/assets/
  // output (also verified directly) -- so neither a false positive nor a
  // false negative today.
  const LIBHEIF_MARKER = 'libheif';

  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('no built asset contains the libheif marker', () => {
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
//
// Two markers, not one. The first pass here only checked Login.tsx's own
// aria-label, which is silent on a leak of AdminApp.tsx itself if it ever
// reaches the entry chunk by some path that doesn't also render Login (e.g.
// a future static import of AdminApp directly, bypassing the lazy route).
// AdminApp.tsx's own placeholder text is the second marker, so that leak is
// caught here too, independent of Login's.
//
// This does NOT, on its own, close every gap a single marker leaves: a
// no-space static import of src/admin/session.ts alongside an otherwise
// intact `lazy()` line (called from HomePage, never rendering Login or
// AdminApp at all) grows the entry chunk and shrinks the admin chunk
// without moving EITHER marker -- session.ts carries no user-facing text of
// its own for either marker to catch. That specific case is what
// src/test/bundle.test.ts's source-level check exists to catch instead (see
// this task's fix to that file's `\s+` -> `\s*`), and it runs earlier in the
// documented pipeline (`npm run test:deploy`, before `npm run build` even
// starts) -- so by the time this file's checks would run, that leak has
// already failed loudly upstream. Recorded as a known gap for a later task
// (M-4) rather than solved here: parsing the actual asset graph out of
// dist/index.html, instead of grepping for hand-picked text markers, would
// close it structurally.
describe('dist/assets/ keeps admin code out of the entry chunk', () => {
  // Source file each marker's own presence test (and the shared leak check
  // below) exists to catch a leak of.
  const ADMIN_MARKERS: Record<string, string> = {
    'Login.tsx': 'Admin login', // the login form's own aria-label
    'AdminApp.tsx': 'Dashboard coming soon.', // the placeholder dashboard's own text
  };

  function assetsContaining(marker: string): string[] {
    return readdirSync(DIST_ASSETS).filter((name) =>
      readFileSync(join(DIST_ASSETS, name), 'utf8').includes(marker),
    );
  }

  // One presence test per marker, not one shared test for both. Without
  // this, a renamed marker would make the leak check below pass by finding
  // it nowhere at all -- guarding nothing, silently. If one of these fails,
  // that marker moved; re-point it rather than deleting the check.
  Object.entries(ADMIN_MARKERS).forEach(([source, marker]) => {
    it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))(`the ${source} marker is present in some chunk`, () => {
      expect(assetsContaining(marker).length).toBeGreaterThan(0);
    });
  });

  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('the entry chunk does not contain admin code', () => {
    const entryChunks = readdirSync(DIST_ASSETS).filter((n) => /^index-.*\.js$/.test(n));
    expect(entryChunks.length).toBeGreaterThan(0);

    const markers = Object.values(ADMIN_MARKERS);
    const leaking = entryChunks.filter((name) => {
      const content = readFileSync(join(DIST_ASSETS, name), 'utf8');
      return markers.some((marker) => content.includes(marker));
    });
    expect(leaking).toEqual([]);
  });
});
