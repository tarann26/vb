import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

// Updated by Task 9 (Plan 4): this describe group used to assert the
// libheif marker appeared in NO built asset at all -- true only because
// src/admin/heic.ts, though it existed since Task 5, was not yet reachable
// from anywhere real. PhotoField.tsx (Task 5) called `convertHeic`, but
// nothing rendered PhotoField until this task wires it into Field.tsx's own
// `image`-kind dispatch, which RecordForm/RecordList/AdminApp already reach
// -- so heic.ts's own dynamic `import('heic-to')` (heic.ts's own comment
// explains why it's dynamic, not static) only NOW actually produces a
// chunk. This is the exact, anticipated shape: a comment already sitting in
// this file (below) said "that arrives in Task 5" about heic.ts becoming
// reachable -- it actually arrived here, in Task 9, once PhotoField itself
// was finally wired in.
//
// The invariant that actually matters was never "heic-to must not exist in
// dist/assets at all" -- it was always the SAME one the admin-code check
// below already encodes correctly: a visitor who never opens the dashboard
// (let alone picks a HEIC photo inside it) must never download the decoder.
// Confirmed directly against a real build: `heic-to-<hash>.js` is its own
// ~3MB chunk, entirely separate from both the entry chunk and the AdminApp
// chunk, produced by Rollup's own code-splitting for a genuine dynamic
// `import()` -- exactly what heic.ts's own comment on why the import is
// dynamic (not static) describes as the point.
describe('dist/assets/ keeps the libheif WASM decoder out of every EAGERLY-loaded chunk', () => {
  // "libheif" itself, not a more specific symbol name: it is the single
  // most direct textual trace of the decoder actually being present,
  // appears exactly once in heic-to's own built bundle (verified directly
  // against node_modules/heic-to/dist/heic-to.js while writing this test).
  const LIBHEIF_MARKER = 'libheif';

  function assetsContainingLibheif(): string[] {
    return readdirSync(DIST_ASSETS).filter((name) => readFileSync(join(DIST_ASSETS, name)).includes(LIBHEIF_MARKER));
  }

  // The decoder DOES land in the build now -- proven first, so the "clean"
  // checks below are proving something real (a marker never present
  // anywhere trivially passes every "absent from X" check that follows,
  // the same "a test that cannot fail" trap this project's own standing
  // rule warns about).
  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('the decoder IS present somewhere in dist/assets -- it is reachable now, not silently dropped', () => {
    expect(assetsContainingLibheif().length).toBeGreaterThan(0);
  });

  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('the entry chunk does not contain it', () => {
    const entryChunks = readdirSync(DIST_ASSETS).filter((n) => /^index-.*\.js$/.test(n));
    expect(entryChunks.length).toBeGreaterThan(0);
    const leaking = assetsContainingLibheif().filter((name) => entryChunks.includes(name));
    expect(leaking).toEqual([]);
  });

  // Not just the entry chunk: the AdminApp chunk itself must also stay
  // clean, or every dashboard visit (not just one that picks a HEIC photo)
  // pays for the ~3MB decoder -- heic.ts's own comment on why the
  // `import('heic-to')` is dynamic, gated behind a per-file content check,
  // rather than a static import at the top of the module, is precisely what
  // this asserts actually held.
  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('the AdminApp chunk does not contain it either -- it stays in its own, separately-loaded chunk', () => {
    const adminChunks = readdirSync(DIST_ASSETS).filter((n) => /^AdminApp-.*\.js$/.test(n));
    expect(adminChunks.length).toBeGreaterThan(0);
    const leaking = assetsContainingLibheif().filter((name) => adminChunks.includes(name));
    expect(leaking).toEqual([]);
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
// AdminApp.tsx's own text is the second marker, so that leak is caught here
// too, independent of Login's. Re-pointed by Task 6 (Plan 4) from the
// logged-in placeholder's "Dashboard coming soon." to the publish-not-built
// note that replaced it -- still text unique to AdminApp.tsx, not shared
// with any other admin file, which is what this marker needs to keep
// meaning "AdminApp.tsx specifically leaked" rather than "some admin file
// did."
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
  //
  // Task 10 re-points the AdminApp.tsx marker: its old value, "Publishing
  // isn't built yet", was the very placeholder note this task replaces with
  // a real Publish button, so it stopped existing in AdminApp.tsx's own
  // source entirely. The dashboard's own <h1> ("Via Bianca Dashboard", not
  // the bare "Via Bianca" several PUBLIC components also render -- see
  // src/components/ErrorBoundary.tsx and ReservationPage.tsx, both
  // legitimately part of the entry chunk, which is exactly why the bare
  // phrase would be a false-positive marker here) is the new one: unique to
  // this file, confirmed by a direct search of src/ for the word
  // "Dashboard" turning up nowhere else at the time this was written.
  const ADMIN_MARKERS: Record<string, string> = {
    'Login.tsx': 'Admin login', // the login form's own aria-label
    'AdminApp.tsx': 'Via Bianca Dashboard', // the logged-in dashboard's own heading
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

// I5 review finding: Tailwind emits ONE stylesheet for the whole app (this
// project's own standing WATCH, recorded since Task 1) -- every admin-only
// utility class ArraySection/RecordForm/PhotoField/GalleryList/etc. use
// ships to every visitor, whether or not they ever open /edit/manage.
// Measured across this plan's ten tasks: 27660 -> 30784 bytes (+3124,
// +11.3%), and a rule-level diff (this project's own only reliable method --
// see this file's own comment on why a text-marker check like the two above
// can't be reused for CSS) traced every one of the 45 rules added since
// Task 1 to a file under src/admin/. The ledger promised a ceiling at Task
// 9 and never added one; this is that ceiling. Plans 5 and 6 add more admin
// screens on top of this, so 31000 is a real budget, not a rounded-up
// snapshot of today's number (30784) -- close enough that the very next
// admin-only class landing without a matching removal will trip it.
describe('dist/assets/ keeps the shared stylesheet under a byte ceiling', () => {
  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('the entry CSS file stays under 31000 bytes', () => {
    const cssFiles = readdirSync(DIST_ASSETS).filter((n) => /^index-.*\.css$/.test(n));
    expect(cssFiles.length).toBeGreaterThan(0);
    const size = statSync(join(DIST_ASSETS, cssFiles[0])).size;
    expect(size).toBeLessThan(31000);
  });
});
