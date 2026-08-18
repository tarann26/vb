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

  // I3 review finding: the two checks this replaced asserted "not in
  // index-*.js" and "not in AdminApp-*.js" -- two HARDCODED chunk names.
  // `82490de` made EditMode.tsx import PublishBar.tsx, and because both
  // AdminApp.tsx and EditMode.tsx now share that dependency, Rollup split
  // it into its OWN chunk (`PublishBar-<hash>.js`) that matches NEITHER
  // hardcoded pattern -- confirmed directly: the reviewer's mutation (the
  // dynamic `import('heic-to')` in heic.ts changed to a static one) put
  // libheif in exactly that chunk, and every check below (and both of the
  // two this replaced) stayed green, because a hardcoded allowlist of
  // chunk names can only ever catch a regression that lands in a chunk it
  // already knew to name.
  //
  // The fix walks the REAL static-import graph Rollup actually built,
  // instead of guessing at names. Two facts make this graph cheap to
  // reconstruct from the built files alone, with no bundler API: Rollup's
  // ESM output writes a static `import ... from"./chunk.js"` for every
  // module-graph edge that must be paid for immediately, and a *dynamic*
  // `import("./chunk.js")` (a function call, never a `from` clause) for
  // every edge that may be deferred -- confirmed directly against this
  // project's own real build (`import("./AdminApp-*.js")` /
  // `import("./EditMode-*.js")` inside the entry chunk, for React.lazy;
  // `import("./heic-to-*.js")` inside whichever chunk ends up holding
  // `convertHeic`, for heic.ts's own dynamic import). Only a STATIC edge
  // is followed below -- crossing a dynamic one is exactly the boundary a
  // lazy route or a lazily-imported dependency is allowed to defer past,
  // and the entire point of this file's guard is telling those two apart.
  function staticImportTargets(source: string): string[] {
    return [...source.matchAll(/from"\.\/([^"]+)"/g)].map((m) => m[1]);
  }

  function dynamicImportTargets(source: string): string[] {
    return [...source.matchAll(/import\("\.\/([^"]+)"\)/g)].map((m) => m[1]);
  }

  function readChunk(name: string): string {
    return readFileSync(join(DIST_ASSETS, name), 'utf8');
  }

  // Every chunk reachable from `start` by following only STATIC import
  // edges -- i.e. everything that is downloaded the instant `start` itself
  // is, with no further choice involved. `start` is included: a regression
  // that inlined libheif directly into the start chunk itself (no separate
  // chunk at all, the shape the reviewer's own mutation actually produced)
  // must be caught the same way as one that landed one hop away.
  function staticClosure(start: string): Set<string> {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const name = stack.pop()!;
      if (seen.has(name)) continue;
      seen.add(name);
      staticImportTargets(readChunk(name)).forEach((dep) => {
        if (!seen.has(dep)) stack.push(dep);
      });
    }
    return seen;
  }

  function entryChunkName(): string {
    const html = readFileSync('dist/index.html', 'utf8');
    const match = html.match(/<script[^>]*type="module"[^>]*src="\/assets\/([^"]+)"/);
    if (!match) throw new Error('bundle.post-build.test.ts: no <script type="module"> found in dist/index.html');
    return match[1];
  }

  // The lazy route chunks React.lazy actually produced -- discovered by
  // reading the entry chunk's OWN dynamic-import call sites, never
  // hardcoded as `AdminApp-*`/`EditMode-*` name patterns: a future route
  // (or a rename Rollup applies on its own) is picked up here automatically
  // the same way a genuinely new one would be.
  function lazyRoutes(): string[] {
    return dynamicImportTargets(readChunk(entryChunkName()));
  }

  function libheifChunksIn(closure: Iterable<string>): string[] {
    return [...closure].filter((name) => readChunk(name).includes(LIBHEIF_MARKER));
  }

  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))(
    'no chunk reachable from a bare page load, or from opening either lazy admin route, contains it -- via the real import graph, not a hardcoded chunk name',
    () => {
      // A bare visit to `/`: everything the entry chunk pulls in
      // statically, whatever it's named.
      expect(libheifChunksIn(staticClosure(entryChunkName()))).toEqual([]);

      // Opening either lazy admin route: everything ITS OWN static closure
      // pulls in -- this is what actually catches the PublishBar-*.js
      // case, since PublishBar is a static dependency of both AdminApp and
      // EditMode's own chunks, wherever Rollup happens to place it.
      const routes = lazyRoutes();
      // Non-vacuous: there really are lazy routes here for the loop below
      // to walk -- a refactor that removed React.lazy entirely would
      // otherwise make every assertion below pass by finding nothing to
      // check, silently.
      expect(routes.length).toBeGreaterThan(0);
      routes.forEach((route) => {
        expect(libheifChunksIn(staticClosure(route))).toEqual([]);
      });
    },
  );
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
  // The dashboard marker has been re-pointed twice, and the reason each time
  // is the same: it has to be text that exists ONLY in the admin chunk, and
  // the obvious candidates are traps.
  //
  // Task 10 moved it off "Publishing isn't built yet" (a placeholder that
  // stopped existing) onto the dashboard's own <h1>, "Via Bianca Dashboard".
  // The manage-screen redesign deletes that <h1> too: it is replaced by the
  // real brand lockup, whose two strings are "Via Bianca" and "Pastificio &
  // Ristorante" -- BOTH of which are false positives here. Bare "Via Bianca"
  // is rendered by src/components/ErrorBoundary.tsx and ReservationPage.tsx,
  // and "Pastificio & Ristorante" is site.tagline, which Footer renders;
  // both are legitimately in the entry chunk, so either would make this
  // check pass no matter what leaked.
  //
  // The replacement is the phone home's own Menu description, which lives
  // only in src/admin/manage/areas.ts. It is a full SENTENCE rather than a
  // label, which is what makes it unlikely to be casually retouched by a
  // wording pass, and its uniqueness against src/ was confirmed by a direct
  // search before this landed -- one occurrence, in areas.ts. The key names
  // that file rather than AdminApp.tsx, because that is where the string now
  // is; what the marker MEANS is unchanged ("the admin chunk did not leak
  // into the entry chunk"), since areas.ts is reachable only through
  // AdminApp.
  const ADMIN_MARKERS: Record<string, string> = {
    'Login.tsx': 'Admin login', // the login form's own aria-label
    'manage/areas.ts': 'Dishes, drinks and the PDF menus', // the phone home's Menu description
    // Plan 5 Task 2's own text, not shared with any other file -- confirmed
    // by a direct search of src/ for this exact sentence turning up nowhere
    // else at the time this was written. Unlike the two markers above,
    // EditMode.tsx renders the REAL public components alongside this text
    // (Hero, Navbar, Footer, ...), which is exactly the leak this marker
    // needs to catch: a regression that put EditMode.tsx's own JSX in the
    // entry chunk would put every public component's own markers there too
    // (they are already expected there, unconditionally), so only text
    // unique to EditMode.tsx itself proves anything.
    //
    // Post-review Fix 7 (minor): re-pointed from `'Loading live content…'`
    // (the loading banner) to a substring of SIGN_OUT_NOTICE (error-path
    // copy). Both are unique to this file, so either COULD serve, but the
    // loading banner is ordinary status text -- exactly the kind of copy a
    // routine wording pass tweaks without a second thought -- while
    // SIGN_OUT_NOTICE is a carefully-worded sentence Fix 1's review already
    // rewrote once specifically to stop it promising something untrue; a
    // sentence that has already been through that scrutiny is far less
    // likely to be casually re-worded again than a loading spinner's label.
    // Confirmed unique via a direct search of src/ for this exact substring
    // turning up nowhere else (in particular, not colliding with
    // PublishBar.tsx's own, differently-worded "You've been signed out..."
    // sentence, which shares only the opening clause).
    'EditMode.tsx': "whatever hasn't will load now",
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
// Measured across Plan 4's ten tasks: 27660 -> 30784 bytes (+3124, +11.3%),
// and a rule-level diff (this project's own only reliable method -- see this
// file's own comment on why a text-marker check like the two above can't be
// reused for CSS) traced every one of the 45 rules added since Task 1 to a
// file under src/admin/. That was this ceiling's first number.
//
// Plan 5 Task 3 (editable text) raises it again: 30784 -> 31156 (+372), a
// rule-level diff against a worktree checkout of the parent commit (never a
// stash -- this project's own standing instruction, given the stash
// baselines already on record here as having produced wrong results)
// tracing all nine added rules to EditableText.tsx's own persistent,
// non-hover edit affordance (`cursor-text`, `rounded-sm`, `outline-dashed`,
// `outline-1`, `outline-offset-2`, `outline-brand/50`,
// `focus:bg-brand/10`, `focus:outline-2`, `focus:outline-brand`; the three
// colour utilities are named here by their CURRENT token for legibility --
// this palette's named tokens did not exist at measurement time, so what
// actually shipped in this commit was an arbitrary-hex value, not a token) --
// nothing removed, nothing from any other file. (Confirmed the hard way: an
// early draft of that component's own source, plus an early draft of THIS
// very paragraph, each spelled a few ordinary English words in bare prose
// that also happen to be real Tailwind utility names or DOM event names --
// exactly the class of accident tailwind.config.js's own `blocklist`
// comment already documents for a different word. Tailwind's content
// scanner has no JS parser behind it, so each one was picked up as a
// candidate class and got an unused rule emitted for it; the rule-level
// diff is what caught it, and rewording the offending prose -- here and in
// EditableText.tsx -- is what took the added-rule count from twelve back
// down to the nine actually used above.)
//
// The Task 3 review's own fix for Finding C2 (an emptied field measuring a
// real, tappable zero-size box in a browser) raises the MEASURED number
// again without moving the ceiling: 31156 -> 31250 (+94), traced the same
// way to exactly three added rules (`inline-block`, `min-h-[1em]`,
// `min-w-[1ch]`) on EditableText.tsx's own className -- still comfortably
// under 31400, so that ceiling itself stayed put.
//
// Plan 5 Task 4 (editable images) is what actually moves the ceiling next:
// 31250 -> 32084 (+834), a rule-level diff against a worktree checkout of
// the parent commit tracing all eleven added rules to EditableImage.tsx's
// own two control-label classNames and its screen-reader-only status/error
// text (`bottom-1`, `right-1`, `h-8`, `w-8`, `bg-black/60`, `bg-red-600/90`,
// `border-white/70`, `focus-within:ring-2`, `focus-within:ring-brand`,
// `leading-none`, `sr-only`; `ring-brand` is this commit's own rule named by
// its current token -- the palette rename came later, so what this commit
// actually shipped was an arbitrary-hex ring colour, not the token) --
// nothing removed, nothing from any other file. 32300 keeps roughly the
// same ~200-250-byte margin over today's real
// number that every earlier ceiling in this lineage kept over ITS own real
// number -- a real budget, not a rounded-up snapshot, so the very next
// admin-only class landing without a matching removal still trips it.
//
// Plan 6, Task 2 is a DIFFERENT kind of move: not a new admin-only
// affordance, but the fix for a live bug (tailwind.config.js's own content
// glob never included `.json`, so the hero collage's grid placements in
// `src/content/galleries.json` were never scanned -- see that file's own
// header comment). Two changes, measured independently, each with a
// rule-level diff against a worktree checkout of the parent commit (never a
// stash):
//   1. `!./src/**/__tests__/**` and `!./src/test/**` added to the content
//      glob: 32084 -> 31834 (-250 bytes), removing exactly 7 selectors
//      (`col-span-1`, `col-span-2`, `col-start-3`, `col-start-5`,
//      `row-span-1`, `row-span-2`, `row-start-2`) that survived only
//      because a test fixture happened to spell them out as literal
//      strings -- dead CSS shipped to every visitor, and a stylesheet hash
//      that churned on an unrelated test-comment edit.
//   2. A 24-entry safelist (`col-start-1`..`6`, `col-span-1`..`6`,
//      `row-start-1`..`6`, `row-span-1`..`6`, generated from
//      `placement.ts`'s own `GRID_SIZE`) added on top: 31834 -> 32674
//      (+840 bytes), adding exactly those 24 selectors -- confirmed by the
//      identical method, and confirmed separately that adding
//      `./src/content/*.json` to the content glob INSTEAD of the safelist
//      produces a byte-identical stylesheet with an identical selector set
//      once the safelist exists (this task's own decision record explains
//      why the safelist, not the glob, is the real fix: scanning is
//      build-time, dragging the collage is runtime).
// New ceiling (at that point) 32900 against this measured 32674 -- the same
// ~200-250-byte real budget over the real number every earlier ceiling in
// this lineage kept, not a rounded-up snapshot.
//
// Plan 6, Task 3 (buttons) moves it again: 32674 -> 33578 (+904 -- corrected
// below, not the +887/33561 this comment used to claim), a rule-level diff
// against a worktree checkout of the parent commit tracing SEVENTEEN added
// rules, not sixteen, to CollageTile.tsx's own select toggle and its
// portal-rendered move/size-change panel (`border-white`, `bottom-0`,
// `focus-visible:outline` and its three colour/width variants, `grid-cols-3`,
// `grid-rows-3`, `h-9`, `inset-x-0`, `left-1`, `max-w-md`, the panel's own
// arbitrary-value shadow, `text-[11px]`, `top-1`, `w-9`, and `z-20`) --
// nothing removed. Confirmed the hard way, again: an early draft of this
// component's own source used the bare words "resize", "grow" and "shrink"
// in prose comments and a real, user-facing aria-label -- all three real
// Tailwind utility names (`resize`, `grow`, `shrink` are single-word
// core-plugin utilities with no numeric suffix to distinguish them from
// ordinary English) -- and each emitted an unused rule. Rewording the
// offending text (a TypeScript discriminant renamed from `'resize'` to
// `'span'`, "resize"/"grow"/"shrink" replaced with "size
// change"/"larger"/"smaller" everywhere they were prose rather than an
// identifier) is what took the added-rule count from nineteen back down to
// the seventeen actually used above.
//
// Repair-review correction (this list's own earlier version undercounted by
// one, and its "nothing from any other file" claim was wrong for the same
// rule): `z-20` is co-sourced -- EditableImage.tsx's own two control-label
// classNames (`CONTROL_LABEL_CLASSNAME`/`ERROR_CONTROL_LABEL_CLASSNAME`,
// :81/:84) already carry `z-20` too, for the identical camera-badge
// hit-testing fix landed in the same task, so this ONE rule has two real
// sources, not one. A FOURTH step (Task 4, drag) added `.cursor-nwse-resize`
// (+39 bytes) on top, also previously unmentioned here. Measured, corrected:
// 33578 (Task 3) -> 33617 (Plan 6 HEAD, Task 4's own drag/resize work,
// including the .cursor-nwse-resize rule just named). No NEW comment-scan
// leak in either step; two pre-existing ones remain (`.collapse`,
// `.invisible`, both dead weight from earlier tasks' comments) and
// CollageTile.tsx (Task 3) re-sources `.invisible` from its own prose
// independently of those.
//
// Plan 7, Task 1 (content model, no component styling touched at all) is
// what this comment's own earlier version did NOT anticipate needing an
// entry for -- and needed one anyway: 33617 -> 33653 (+36), a real
// comment-scan leak, `.lowercase`, caught by this task's own rule-level
// diff (a worktree checkout of the true parent commit, 663ce09, never a
// stash) rather than by the ceiling test itself, which stayed green
// throughout -- 33653 is comfortably under the 33800 ceiling that was
// already in place, the exact blind spot a "stays under N" test always has
// for a leak smaller than its own margin. src/content/validate.ts's own
// page-slug message used the plain-English word for "a-z, no capitals" --
// itself a real, bare, no-argument Tailwind utility -- and was reworded to
// avoid it, alongside its own explanatory comment (which repeated the same
// word in prose and leaked the identical rule a second time on its own
// first draft). Fixed before Task 1 was committed; recorded here rather
// than silently, since the number this comment's own history tracks
// briefly included it.
//
// Plan 7, Task 2 (the five -- four, after the Task 2 Step 1 merge --
// template components) is the one this task's own Step 4 asks for: 33653
// -> 34459 (+806), a rule-level diff against a worktree checkout of the
// true parent commit (062e2d6, Task 1's own commit -- so this figure is
// Task 2's contribution alone, with Task 1's own `.lowercase` fix riding
// along and already netted out of it) tracing all twelve added rules to
// real classNames in the four new template components: `.border-l-4`/
// `.pl-4` (DetailBlockSection's fact rows), `.grayscale`/
// `.hover:grayscale-0`/`.justify-items-center`/`.max-h-full`/`.max-w-full`/
// `.object-contain`/`.md:grid-cols-4`/`.sm:grid-cols-3` (GallerySection's
// `layout: 'grid'` variant -- the merged-in Logo grid use), `.max-w-xl`
// (DetailBlockSection's facts list) and `.mt-10` (the shared spacing above
// every template's own optional WhatsAppButton) -- nothing removed, nothing
// from any other file.
//
// Repair-review correction (M3): the 34459/34700 pair above was Task 2's
// OWN contribution in isolation, measured against Task 1's commit -- it was
// never the real number at Plan 7 HEAD, and the comment did not say so.
// Task 4 (the dashboard's own Add screens, PageList.tsx/
// TemplateSectionList.tsx/AdminApp.tsx) landed four more rules on top,
// undocumented until now: `.mt-4`/`.border-gray-100`/`.pt-4`
// (PageList.tsx's and TemplateSectionList.tsx's own `"mt-4 border-t
// border-gray-100 pt-4"` wrapper around an open row's content form) and
// `.mt-8` (AdminApp.tsx's own "Homepage template sections" heading
// spacing). Measured directly, the real way -- a rule-level diff against a
// worktree checkout of `663ce09` (the actual pre-Plan-7 parent, one commit
// before Task 1's own 062e2d6): 33617 -> 34626 (+1009), SIXTEEN rules
// added (the twelve above plus these four), zero removed, nothing from any
// other file. New ceiling 34700 against this real, HEAD number -- a
// 74-byte margin, tighter than this lineage's usual ~200-250-byte range
// (matching Plan 6 Task 4's own 183-byte margin as the closer precedent):
// the very next admin-only or template class landing without a matching
// removal still trips it, with less room than the stale 34459/~240 figure
// this replaces implied.
//
// Drinks section rebuild: 34626 -> 34485 (-141 bytes), the first task in
// this lineage to ever LOWER the measured number -- every prior entry here
// only ever added markup. Drinks.tsx dropped its three text-list categories
// (Mocktails/Cocktails/Wine) for a single FoodGallery-style photo carousel
// (see Drinks.tsx's own header comment and homepage-bytes.test.tsx's
// matching entry). A rule-level diff (postcss, walking both stylesheets'
// real rule trees, against a worktree checkout of the true parent commit
// 9fe77c5, never a stash) found exactly four selectors removed and zero
// added: `.gap-x-12`/`.gap-y-6` (the retired category list's own
// `grid-cols-2 gap-x-12 gap-y-6`), `.last\:mb-0:last-child` (the per-category
// wrapper's own spacing rule) and `.sm\:text-left` (the retired `<li>`'s own
// responsive alignment) -- all four unique to that removed markup; nothing
// else in this tree used them. Every OTHER class the new carousel needs
// (`w-80`, `h-64`, `rounded-2xl`, `space-x-6`, `from-black/70`, ...) already
// had a rule, shared with FoodGallery.tsx's identical card markup -- exactly
// the "one component used twice" shape this task asked for, which is why
// ADDED is empty. New ceiling 34600 against this real, measured 34485 -- a
// 115-byte margin, matching this lineage's own tightened-margin precedent
// rather than the older ~200-250-byte range, since this repo's own standing
// rule is that CSS growth should be caught close to the moment it happens.
// MISSING ENTRY, added late: commit 68a70ec ("group pages under one nav
// entry and float the mobile menu") raised the assertion below from 34600
// to 38700 and changed neither this comment nor the test's own NAME, which
// went on claiming "stays under 34600 bytes" while asserting 38700. Both
// are corrected here. Anyone reading this lineage before now would have
// computed a margin against a number that had not been the ceiling for
// several commits.
//
// Measured properly, the way this file's own standing rule requires -- a
// rule-level postcss diff against a WORKTREE CHECKOUT of the true parent
// commit (97d4675), never a stash: 34485 -> 38468 (+3983), FORTY-SIX rules
// added and two removed. Every one traces to that commit's own NavBar.tsx
// rebuild and the `scroll-padding-top` rule it added to src/index.css:
// the floating mobile menu panel (`.w-[15rem]`, `.min-w-[13rem]`,
// `.max-w-[15rem]`, `.max-w-[calc(100vw-2rem)]`, `.mx-5`, `.my-2`,
// `.px-5`, `.py-2.5`, `.pt-3`, `.shadow-black/5`, `.shadow-black/10`,
// `.ring-1`, `.ring-black/5`, `.backdrop-blur-md`, `.bg-white/90`), the
// chevron that flips open (`.h-3.5`, `.w-3.5`, `.rotate-180`,
// `.duration-200`), the staggered reveal keyframe declared in
// tailwind.config.js (`@keyframes nav-in` plus `.animate-nav-in`), the
// animated underline every nav link now carries (eleven `.after:*` rules
// plus `.origin-left`, `.hover:after:scale-x-100`,
// `.focus-visible:after:scale-x-100`, `.hover:text-ink`,
// `.focus-visible:text-ink`), and the bar's scrolled/unscrolled border
// swap (`.border-b`, `.border-t-2`, `.border-brand/15`,
// `.border-brand/20`, `.border-transparent`, replacing
// `.bg-transparent` and `.shadow-none`; `.hover:text-ink`,
// `.border-brand/15` and `.border-brand/20` are this commit's own rules
// named by their current tokens -- the palette rename came later, so what
// 68a70ec actually shipped for these three was arbitrary-hex utilities, not
// the tokens), with `.font-["Open_Sans"]`,
// `.normal-case`, `.tracking-normal` and `.text-ink/80` from the new
// link typography. No comment-scan leak among them. Confirmed by building
// 68a70ec itself in the same worktree: byte-identical to the tree today,
// same content hash, so nothing between that commit and this one moved the
// stylesheet at all.
//
// Publish confirmation step (the bottom-docked confirm panel, the `offsetTop`
// prop that makes /edit's Publish button clickable, and the time-expectation
// line): 38468 -> 38468, ZERO bytes, byte-identical output down to the same
// content hash. Designed for that: the panel reuses CollageTile.tsx's own
// already-shipped panel class string character for character, its buttons
// reuse the classes DraftBanner's Restore/Discard buttons already carry, and
// the one piece of geometry that had no existing utility (a 72px offset
// clearing a 61px fixed nav -- the largest top-margin rule in this
// stylesheet is 48px) is an inline style, the escape hatch CollageTile.tsx
// documents for exactly this ceiling. The real margin at the ceiling below
// is 232 bytes, not the ~115 the pre-68a70ec text above implies.
//
// Editing pause during a publish, and undo-my-last-publish: 38468 -> 38468
// for both, again byte-identical with the same content hash. The pause is
// expressed entirely as a `disabled` fieldset carrying an inline style
// reset and an inline opacity, and on /edit by REMOVING affordances rather
// than restyling them -- no disabled variant was added to any editor
// (RecordList's move buttons document that they have none, which is exactly
// why greying controls was the wrong lever). The undo button and its
// confirm reuse BANNER_BUTTON_CLASSNAME plus the classes DraftBanner's own
// two buttons already carry. Three consecutive features at zero bytes is
// the constraint being designed for, not a coincidence to assume holds for
// the next one: the margin is still 232 bytes, and four or five new
// utilities would spend it.
//
// Phase 3, the Experiences carousel: four new utilities spent it, exactly as
// the paragraph above predicted, and this assertion caught it. 38468 ->
// 39032 against a 38700 ceiling -- `npm run build` exited 1, and with it the
// documented Cloudflare Pages build command and CI's `test:csp` step. The
// four rules were a default-cursor utility, a 75% black gradient stop, a 20%
// black mid-stop and an 85% white text colour, all real class usages in
// Experiences.tsx, none of them a comment leak.
//
// THE CEILING WAS NOT RAISED. It is still 38700, and the fix was to spend
// nothing:
//
//   - The card scrim became an inline gradient. Same pixels, no rule. This
//     is the escape hatch CollageTile.tsx has documented for this exact
//     ceiling since Plan 6, used here for the reason it was written down:
//     the two gradient stops were values nothing else in the codebase uses,
//     so each one could only ever be a rule of its own. Reusing the shared
//     class idiom (a 70% stop over a transparent midpoint, which
//     FoodGallery.tsx, Drinks.tsx and ItemListSection.tsx already ship) was
//     the tidier option and was measured and rejected: on the Cooking Class
//     card, whose photo is a near-white pamphlet, it drops the caption's
//     backdrop contrast from 4.22:1 to 3.45:1. Experiences.tsx carries that
//     measurement. Cost: +198 bytes of HTML, recorded in
//     src/test/homepage-bytes.test.tsx.
//   - The caption's one-off 85% white became the 80% the rest of the site
//     already uses. Zero bytes either way in HTML, one fewer rule in CSS.
//   - The cursor utility was deleted outright. A <div> with no href and no
//     handler already computes to `auto`; the utility bought one cosmetic
//     difference over the caption text and cost a rule.
//   - The `hero` gallery layout added in the same commit is built the same
//     way, out of already-present utilities only.
//
// Measured the way this lineage requires -- a worktree checkout of `main`
// (bad668c) built in place, never a stash. Result: 38555 bytes with content
// hash wZZ_sICA on main, and 38555 bytes with content hash wZZ_sICA here.
// BYTE-IDENTICAL, confirmed with `cmp`. Not merely "zero net": zero rules
// added and zero removed by the entire branch. Margin back to 145 bytes.
//
// Phase 5A, the blog's ten block renderers plus both routes: 38555 -> 38593
// (+38), ONE rule added and zero removed, traced by a rule-level diff
// against a worktree checkout of the true parent commit (never a stash) to
// `.list-decimal` on blocks.tsx's numberList and steps blocks. Preflight
// ships `ol,ul,menu{list-style:none}`, so an ordered list without it renders
// as unnumbered lines -- it is load-bearing, not decoration.
//
// The interesting number is what this DID NOT cost, because it is the reason
// a ten-block-type feature fits in a 145-byte budget at all. Preflight
// already ships `b,strong{font-weight:bolder}`, `code,kbd,samp,pre{font-family:
// ui-monospace,...}` and NO `em` rule at all -- so markdown bold, inline code
// and markdown emphasis each render correctly with no utility whatsoever.
// Measured individually before the design was fixed: the monospace utility
// costs 111 bytes, the slant utility 26, and both would have changed nothing
// visible. A thirteen-utility "comfortable" set measured +427, a 282-byte
// breach. THE CEILING WAS NOT RAISED and is still 38700, with a 107-byte
// margin.
//
// blocks.tsx's own comments confirm the same comment-scan hazard this file
// already documents twice above (`.lowercase`, `.collapse`/`.invisible`). An
// early draft named the slant utility and the larger grid breakpoint's class
// bare in prose: 38593 -> 38682 (+89), the rule-level diff showing `italic`
// and `md:grid-cols-3` alongside `list-decimal` in ADDED. Rewording the first
// pass removed both words but introduced a third, the bare three-column class
// with no breakpoint prefix at all: 38682 -> 38652, ADDED now showing
// `grid-cols-3` alone alongside `list-decimal`. Only the final wording, which
// describes the effect ("three columns from the 640px breakpoint up") rather
// than naming any class, produced the clean `ADDED: ['list-decimal']` this
// task's own diff is built on. Caught each time by the rule-level diff, not
// by reading the prose -- exactly why this lineage's standing rule is to run
// the diff rather than trust that a reworded comment is safe by inspection.
//
// Phase 5B, the block editor, all eight tasks including drag-to-reorder:
// 38593 -> 38593, ZERO bytes, byte-identical output down to the same content
// hash 4e742936. ADDED: [], REMOVED: [] -- not zero net, zero of each --
// measured by a rule-level diff against a worktree checkout of the true parent
// commit 2df6aef, never a stash. (That worktree build also came out
// byte-identical to a build of the clean working tree, which is the check that
// says the method itself is sound.) Rule count 536 both sides. THE CEILING IS
// NOT RAISED and is still 38700, with the same 107-byte margin Phase 5A left.
//
// This entry exists because the plan for the drag handle called for a raise and
// did not need one, and the arithmetic is worth leaving where the next person
// will look. The class version of the handle is `cursor-move` on the glyph and
// `opacity-50` on the row in flight: measured at 38593 -> 38641, +48, two rules
// added, zero removed -- which is UNDER the existing 38700 ceiling, by 59 bytes.
// It would have passed this assertion untouched. The argument for raising
// anyway was that 59 is below this lineage's own 115-250 margin band, which is a
// real argument and is not the same thing as a build that fails; the plan's own
// mutation table claimed `npm run build` would exit 1 at 38641 against 38700,
// and that was simply run and found to pass.
//
// So neither rule was bought. Both went inline instead, the escape hatch this
// file has pointed at since Plan 6 and the same one CollageTile.tsx's gradient
// (that file has since been deleted whole, along with the grid machinery),
// CollapsibleSection.tsx's fieldset reset and the publish panel's 72px offset
// took: `style={{ cursor: 'move' }}` on the handle and `style={{ opacity: 0.5 }}`
// on the row being dragged. The second of those is not even a new shape here --
// CollapsibleSection.tsx already ships `opacity: locked ? 0.6 : undefined` on
// its own fieldset, which is the same conditional inline opacity for the same
// reason. Identical pixels, no rule, and `style-src` allows it on purpose
// (src/test/hosting.test.ts, whose own count of components doing this was one
// short before this commit and is right again after it -- do not re-derive a
// headcount from a comment, grep for it).
//
// Reusing a shipped opacity utility was considered and rejected on the pixels
// rather than the bytes: the UNPREFIXED ones that ship are 0, 20, 90 and 100,
// and 90 is no change she would notice while 20 is a block she can no longer
// read. Read "unprefixed" literally in both of the next two sentences. The
// sheet does carry `.disabled:opacity-50` and `.disabled:opacity-60`, and it
// carries `.disabled:cursor-not-allowed` as well as the unprefixed
// `.cursor-pointer` and `.cursor-text` -- none of which can dim or re-point a
// list row, because a `<li>` is not a disabled form control. So there is no
// reusable rule for either property, which is what makes both of them genuinely
// new rather than a lookup somebody skipped. The handle's user-select and
// padding utilities ARE classes, because those rules already exist -- and the
// user-select one is not decoration, since without it a slow drag selects the
// kind label instead of starting a drag.
//
// What that leaves is a whole sub-plan at zero: the Posts panel, PostList, the
// block fields, the picker, the toolbar and the drag handle. Four of its files
// (PostList, BlockList, BlockFields, InlineTextField) import RecordList's and
// Field.tsx's own exported class bindings rather than retyping the strings -- a
// retyped string is a new class to the scanner and ships a duplicate rule for a
// style that already exists. Each task ran this same rule-level diff and each
// reported ADDED: [], REMOVED: [].
//
// One near-miss worth recording, because it is the hazard the blocks.tsx
// paragraph above measures at 26 bytes and it fired again: the toolbar's middle
// button is labelled "Italic" in JSX text, and the scanner is a plain text
// extractor. The capital letter is the whole of what saves it, since Tailwind's
// own class name is lowercase -- and it was CHECKED with a diff rather than
// assumed. BlockList.tsx's comment above HANDLE_CLASSNAME names no utility for
// the same reason.
//
// The finding worth more than the byte count, recorded here because this is
// where the next person will look: this assertion is `skipIf`, and for the
// whole of Phase 3 it silently skipped. `npm test -- --run` reported it as
// the one skip in "2765 passed | 1 skipped", and eight tasks, five per-task
// reviews and eleven commits all read that line as green. The check was
// present, correct, and never once run, because no gate in this project
// invoked the production build command. `npm run gate` (package.json) now
// ends with `npm run build`, and .githooks/pre-push runs it as its own
// unconditional step instead of only reaching it through the browser-suite
// branch, which is skipped entirely for a docs- or content-shaped push. A
// skipped assertion and an unfalsifiable one cost exactly the same.
//
// Admin redesign Task 1, EditorSheet: 38593 -> 38749 (+156), five rules
// added, zero removed. Measured by a rule-level diff -- EditorSheet.tsx (and
// its test) moved out of src/ with `mv` (never a stash, never a `git
// checkout`, since this project's git-safety rule forbids that on tracked
// history), `vite build` run to get the 38593-byte baseline back, the file
// restored with `mv` and rebuilt to 38749, then the two dist CSS files
// diffed. `tsc -b --noEmit` was clean on both sides. The five new rules,
// each traced to the one class in EditorSheet.tsx that has no other user in
// src/ today:
//   .overflow-y-auto{overflow-y:auto}          33 bytes  (the panel's own scroll)
//   .sm\:m-auto{margin:auto}                   24 bytes  (interior addition to
//                                                          the @media(min-width:
//                                                          640px) block every
//                                                          other sm: rule
//                                                          already shares)
//   .sm\:max-h-\[85vh\]{max-height:85vh}       36 bytes  (the desktop dialog cap)
//   .sm\:w-\[32rem\]{width:32rem}              29 bytes  (the desktop dialog width)
//   .sm\:rounded{border-radius:.25rem}         34 bytes  (the desktop dialog corner)
//                                              --------
//                                              156 bytes, matching the measured delta exactly
// Every other class EditorSheet.tsx writes -- fixed, inset-0, flex, w-full,
// bg-white, p-4, mb-4, items-center, justify-between, gap-2, the bracketed
// Montserrat font family, text-base, uppercase, tracking-wide, text-accent,
// rounded, bg-brand, px-4, py-2, text-sm, text-ink, transition,
// hover:bg-brand-dark, mt-6, border-t, border-gray-200, pt-4, and every class
// inside RecordList's imported REMOVE_BUTTON_CLASSNAME -- already had a rule
// in the sheet before this file existed and cost nothing marginal.
//
// The ceiling below is 38749 itself, not 38749 plus a cushion: the plan's own
// rule is that a raise lands on a measured number, and a margin added "to be
// safe" is the same defect wearing a different shape. That is also why the
// assertion below reads `toBeLessThanOrEqual` rather than `toBeLessThan` --
// matching the ceiling to the exact measured value and then keeping the
// stricter operator would fail this task's own build, which is the same
// name/assertion mismatch this file already caught itself making once
// (the 34600-vs-38700 incident above). The test's name was changed with it,
// for the same reason.
//
// Schedule change, ruled after this task: the plan text above this line
// still says the first raise is Task 12's. It isn't -- Task 1 breaches the
// ceiling on its own, correctly and unavoidably (EditorSheet has to exist
// before anything wires it in, and Tailwind's scanner reads the file whether
// or not anything imports it yet), and Task 11's e2e spec cannot run at all
// against a build that `npm run build` refuses to finish. Every rule-adding
// task now raises this ceiling to its own measured number as it goes, rather
// than saving it up for the three checkpoints the plan named; Task 12
// becomes an audit of the accumulated total instead of the first raise. A
// reader who finds more than three raise-entries in this file by the plan's
// end should look here for why.
//
// Admin redesign Task 2, ItemList: 38749 -> 38836 (+87), two rules added,
// zero removed. Measured the same way as Task 1's entry above: ItemList.tsx
// and drag-row.ts moved out of src/ with `mv`, `vite build` run to confirm
// the 38749-byte baseline still held, both files restored with `mv` and
// rebuilt to 38836, then the two dist CSS files diffed rule-by-rule with
// `comm` against sorted rule lists. `tsc -b --noEmit` was clean on both
// sides. Two new rules, each traced to the one class in ItemList.tsx (the
// only file this task adds that renders anything) that has no other user in
// src/ today:
//   .p-2{padding:.5rem}                                19 bytes  (ROW_CLASSNAME's
//                                                                  own row padding)
//   .truncate{overflow:hidden;text-overflow:ellipsis;
//             white-space:nowrap}                       68 bytes  (the row-name span,
//                                                                  so a long dish
//                                                                  name clips
//                                                                  instead of
//                                                                  wrapping the row)
//                                                        --------
//                                                        87 bytes, matching the measured delta exactly
// Every other class ItemList.tsx and drag-row.ts write -- flex, min-w-0,
// flex-1, items-center, gap-3, rounded, text-left, the bracketed Montserrat
// font family, text-sm, text-ink, transition, hover:bg-brand/10,
// focus-visible:outline, focus-visible:outline-2, focus-visible:outline-accent,
// mb-3, w-full, border-2, border-dashed, border-brand, py-2, uppercase,
// tracking-wide, text-accent, mb-1, border, border-gray-200, text-xs,
// text-red-600, select-none, px-3 -- already had a rule in the sheet before
// this task and cost nothing marginal. BlockList.tsx's own move of
// HANDLE_CLASSNAME/HANDLE_STYLE/DRAGGING_STYLE into drag-row.ts changes no
// rendered class and moves the byte count by zero.
// Admin redesign Task 25b, Move up / Move down / Remove on every block of the
// writing surface: 38836 -> 38836 (+0), zero rules added, zero removed. The
// brief for that task expected a raise and it did not happen, so the
// measurement is recorded here rather than the expectation. Measured with a
// full `npm run build` on 4768ea6 before and after: the two stylesheets are
// BYTE-IDENTICAL (`cmp` reports no difference, both 540 rules, and Vite's own
// content hash in the filename is unchanged), which is a stronger result than
// a rule-level diff and is what the diff was run to check.
//
// The reason there is nothing to account for: the two button bindings are
// RecordList's own exported constants, imported rather than retyped, and the
// four utilities on the row that holds them are the same four
// WritingToolbar.tsx's own row already carries. Every one of them had a rule
// in this sheet before this task and cost nothing marginal. The new
// `data-block-controls` attribute is an attribute and not a class, the same
// cheap-query-surface reasoning `data-slot` and `data-panel` follow, and the
// wrapper element the rows gained carries no class at all.
//
// The ceiling is therefore NOT moved. A raise to a number nothing measured is
// the "margin added to be safe" this file's Task 1 entry above already refuses
// by name, and it would hide the next real leak by exactly its own size.
//
// Admin redesign Task 26, Tab and Shift+Tab nesting a list item: 38836 ->
// 38836 (+0), zero rules added and zero removed. Measured the way this lineage
// requires -- a worktree checkout of the true parent commit (a543e9f, `git
// worktree add`, never a stash), `npm ci` and `npm run build` in place, then
// both stylesheets compared. They are BYTE-IDENTICAL (`cmp` reports no
// difference) and Vite's own content hash is the same on both sides, which is
// the stronger result the rule-level diff was run to check: 543 selector
// groups each, ADDED [] and REMOVED [].
//
// Read that 543 as this entry's own count and not as a continuation of the
// "536" and "540" above it. The earlier entries counted with a `grep -o
// '^[^{]*{'` pipeline, and THAT PIPELINE IS WRONG on the file it is pointed
// at: the built stylesheet is a single line, so `^` matches once and the grep
// reports one rule for the whole sheet. This entry's numbers come from
// extracting every `selector{declarations}` pair instead, at-rule interiors
// included, which is why the count is a few higher. Anyone re-running the
// method from the brief should fix the extractor before believing a diff of
// two one-line files.
//
// Where the nesting COULD have cost rules and does not:
//   * the published sub-list reuses `list-disc`, `list-decimal`, `pl-5`,
//     `space-y-2` and `mt-2`, all of which already had a user in this sheet;
//   * the indent she sees while writing is an inline `margin-inline-start`
//     rather than two utilities -- no shipped rule is 1.25rem or 2.5rem of
//     margin (`ml-2` and `ml-8` are the only two in the sheet), so a class
//     version would have bought both. The same escape hatch the drag handle's
//     cursor and the dragged row's dimming already take.
//
// The comment-leak scan this file exists to run was widened rather than
// repeated by eye, and it found nothing: every one of the 379 class selectors
// in the shipped sheet is named on at least one NON-comment line under src/.
// That covers `.lowercase`, `.collapse`, `.invisible`, the slant utility, the
// grid-columns utility and the "shrink" incident in one pass, and it covers
// every comment in the repository rather than only the ones written since
// Task 13.
//
// THE CEILING IS RAISED ANYWAY, to 39000 -- measured size rounded up to the
// next 100, plus 100 -- and that reverses the "no cushion" rule Task 1's entry
// above states. Read this as the correction it is, not as an oversight.
//
// Task 1's rule was written against a real defect (a ceiling nobody measured
// hides the next leak by its own size) and it produced a different one: the
// last three tasks each landed on a ceiling exactly equal to the measured
// size, so the branch has been carrying ZERO headroom. That exact condition
// has broken this build before -- a task breached the ceiling, the raise was
// scheduled eleven tasks later, and the branch was red the whole way. A
// hundred-odd bytes of headroom is what makes a task that adds one honest rule
// a passing build with a raise to write, instead of a failing build with a
// schedule to renegotiate.
//
// What is given up is stated rather than glossed: a leak smaller than the
// headroom now passes this assertion silently. The rule-level diff above is
// what catches those, and it is the check that has caught every leak in this
// file's history -- not the byte count. The byte count is the tripwire for
// the large accidental import; the diff is the instrument.
//
// The operator goes back to `toBeLessThan` with the raise, and the number in
// the test's NAME is changed in the same edit as the number in the assertion.
// Those two have drifted apart in this file once already (the 34600-vs-38700
// incident above), and nothing tests a test's name -- the counter-measure is
// that they move together and that a reviewer greps this file for the old
// number before merging.
describe('dist/assets/ keeps the shared stylesheet under a byte ceiling', () => {
  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('the entry CSS file stays under 39000 bytes', () => {
    const cssFiles = readdirSync(DIST_ASSETS).filter((n) => /^index-.*\.css$/.test(n));
    expect(cssFiles.length).toBeGreaterThan(0);
    const size = statSync(join(DIST_ASSETS, cssFiles[0])).size;
    expect(size).toBeLessThan(39000);
  });
});
