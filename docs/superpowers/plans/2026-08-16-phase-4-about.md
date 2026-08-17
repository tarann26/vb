# Phase 4: About Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the About section Kamalika's byline — her portrait, her name, and what she is — and move the About prose onto D1 so she can rewrite it from the dashboard and see it live in seconds instead of waiting on a Cloudflare Pages build.

**Architecture:** `StoryContent` grows a required `chef` record (`name`, `role`, `portrait`, `portraitAlt`), seeded in the committed `src/content/story.json` from the portrait that already exists in the tree. `OurStory.tsx` renders that record as a byline beneath the six paragraphs, built only from Tailwind utilities already present in the shipped stylesheet. Then `src/content/story.json` joins `D1_ONLY_PATHS` and `PUBLIC_FILES`, so the dashboard reads and writes it through the Phase 2 seam with no admin change at all, and `OurStory.tsx` fetches the live D1 copy at runtime and swaps it over the compiled-in one. The committed file stays in the repository as the first-paint fallback and as the thing `src/content/__tests__/assets.test.ts` can still see the portrait path through; a small script re-syncs it from live D1 before a deploy that matters, the same discipline `scripts/build-snapshot.mjs` already establishes for the Worker's own fallback.

**Tech Stack:** Vite 5, React 18, TypeScript strict (solution-style tsconfig), Tailwind 3, react-router-dom 7, Vitest 3.2.7, Playwright, sharp (build-time only), Cloudflare Workers + D1 + KV.

**Spec:** `docs/superpowers/specs/2026-08-15-rebrand-and-content-platform-design.md` (Phase 4, line 198)

---

## What Phase 4 does NOT contain, because it is already live

**The Awards half of Phase 4 shipped in Phase 2 as the D1 pilot.** Verified directly against the tree at `main` before this plan was written, not taken on trust:

| Spec sentence (Phase 4) | Where it already lives |
| --- | --- |
| "Awards becomes its own homepage section" | `SectionId` includes `'awards'` (`src/content/types.ts:203`); `src/content/sections.json:34` places it between `press` and `ourStory`; `src/components/Awards.tsx` renders it |
| "a row of entries, each with a title, an awarding body, a year, and an optional badge image" | `interface Award` (`src/content/types.ts:210-216`) |
| "She adds entries herself" | `src/admin/areas/AwardsArea.tsx`, panel `awards` in `src/admin/manage/areas.ts:75`, `AWARD_FIELDS` in `src/admin/fields.ts:195` |
| "Awards is built on D1 from the start" | `D1_ONLY_PATHS` (`worker/store.ts:62`), `PUBLIC_FILES` (`worker/published.ts:22-24`), `worker/d1.ts` (optimistic concurrency, revisions, consuming undo, depth-20 prune), `worker/snapshot.ts` (generated from live D1) |
| "Phase 4 inserts awards" into the homepage order | already inserted; `sections.json` is `hero, atmosphere, food, drinks, experiences, press, awards, ourStory, visit` |

**Do not build any of it again. Do not rename the `ourStory` SectionId.** That id is simultaneously the `SectionId` union member, the `galleries.ourStory` photo-list key (`src/content/types.ts:161-172`), the `our_story` upload-category mapping (`src/admin/EditMode.tsx:325-328`), and the `galleries.ourStory.N` editable-image-path prefix (`src/admin/EditMode.tsx:383`, and the same string `OurStory.tsx:43` hands `renderImage`). Renaming it breaks four things at once and would need a migration of the live published `galleries.json`. Only the *display* name is "About", and that rename already happened in Phase 1 (`story.json`'s `heading`, `CONTENT_FILE_LABELS['story.json']`, `PANELS.story.heading`, `SECTION_LABELS.ourStory` in `EditMode.tsx:114`). The anchor stays `#our-story` because it is a live, possibly bookmarked URL.

---

## Spec-vs-code conflicts this plan resolves

Twelve, each found by reading the real tree. Where the spec and the code disagree, **the code wins and this plan says so**; where the code is silent, this plan decides and records why.

**1. The Awards half of Phase 4 is already shipped.** See the table above. This plan builds only the About half.

**2. The homepage order is already final for this phase.** The spec (line 114) says "Phase 4 inserts awards". Phase 2 Task 9 inserted it. `src/content/sections.json` needs no edit in this phase, and any task that edits it is doing something wrong.

**3. The About prose is already Kamalika's personal introduction, written in the first person and signed by her.** `src/content/story.json` paragraph 2 opens "Born from my journey through the homes and kitchens of Puglia…" and paragraph 6 is "Buon appetito e divertiti, Chef Kamalika Anand". The spec (line 205) says Phase 4 "adds Kamalika's personal introduction and portrait". **Adding a second block of prose in her voice would duplicate the section's own content.** What is genuinely missing is *attribution and a face*: the reader never sees who "I" is until the last line, and never sees her at all. So Phase 4 adds a **byline** — portrait, name, role — not new prose. If she later wants an extra sentence there, "Add a paragraph" already exists.

**4. The portrait exists, and it is 932px wide, not 1000.** `assets-source/team/kamalika-anand.jpg` is tracked in git (932x1243, JPEG) and `public/team/kamalika-anand.webp` is generated at **932x1243**, not 1000: `encodeDerivative` uses `withoutEnlargement: true` (`scripts/images.mjs:47-52`) and `team` has no entry in `DIR_MAX_WIDTH` (`scripts/paths.mjs:66-68`), so the 1000px default applies as a *cap* the source never reaches. Any statement in a task, comment or commit message that the portrait is 1000px is false — do not write one. The spec's Open Items (line 296) still lists "a portrait of Kamalika" as outstanding; it is not.

**5. Nothing new is needed on the asset side.** `/team/kamalika-anand.webp` is already referenced by `src/content/press.json:90` and by the parked `src/components/ChefGallery.tsx:13`, and already pinned by `src/content/__tests__/assets.test.ts:152`. `'team'` is already a member of `UPLOAD_CATEGORIES` (`src/shared/upload-categories.ts:15`), so the dashboard can already upload a replacement portrait through `POST /api/upload`. **No new image, no new upload category, no `DIR_MAX_WIDTH` entry.**

**6. The spec's gate is out of date and has twice certified a branch CI rejected.** Spec line 269 says `npx tsc -b --noEmit && npm test -- --run && npx eslint .`. That gate skipped the CSS ceiling test (it is `it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))`) and ran a *different* vitest invocation than Cloudflare does. The gate is now `npm run images && npm run test:deploy && npm run build`, read out of `docs/cloudflare-cutover.md` and asserted by `src/test/hosting.test.ts`. **Ignore the spec here.** See Global Constraints.

**7. "Moves the whole section onto D1" cannot include the gallery, and does not.** `galleries.ourStory` is not a section-shaped document — it is one key inside `src/content/galleries.json`, alongside `atmosphere` and `heroCollage`. Moving it would mean splitting one file across two stores, which the content model has no way to express, and it would put `heroCollage` (which the user has explicitly demanded stay exactly as it is) on the wrong side of a migration. It would also buy nothing: every gallery image needs a build-time derivative (`scripts/images.mjs` into `public/`), so adding a photo needs a Pages build whether the list lives in D1 or not — the Phase 3 ledger's own ruling, unchanged. **Decision: the About *prose* moves to D1. `galleries.json` is not touched by this phase at all, and a task whose diff includes it has gone wrong.**

**8. A pure Awards-style D1 move would leave the About section empty at first paint.** Awards can fetch its list at runtime because its *chrome* — heading and intro — stays in `copy.json` and paints immediately (`src/content/types.ts:451-456` says exactly this). About has no chrome/entry split: the prose **is** the section. Three things additionally read the compiled-in copy: `src/content/index.ts` exports `story` from the committed JSON, `src/content/__tests__/sections.test.tsx:26` derives `MARKER.ourStory` from `story.heading`, and `src/test/homepage-bytes.test.tsx` pins the rendered homepage's exact byte count. **Decision: fallback-then-swap.** `OurStory` initialises from the compiled-in `content.story` and replaces it only when a shape-checked D1 body arrives. First paint is never empty, crawlers and no-JS readers see real prose, and her edit appears with no deploy. The swap is invisible in practice because About is the **eighth of nine** homepage sections — far below the fold, exactly as the spec intends ("One About section, positioned low", line 47-48). Recorded plainly rather than sold: on a page load immediately after an edit, a reader already scrolled to About could see one word change under them.

**9. The spec's R2 image path does not exist and must not be invented.** `wrangler r2 bucket create` fails with code 10042 pending a Cloudflare dashboard activation that can require billing details; `scripts/images.mjs` loads sharp's native binding at module scope and workerd cannot execute native code; every Cloudflare resizing product is billable. Standing ruling from Phase 3, unchanged. Photos go into `assets-source/<category>/`, `npm run images` writes `public/<category>/<name>.webp`, content references the derivative by its leading-slash path.

**10. `validateContent`'s `RULES` table is keyed on basename, and `'story.json'` is already registered** (`src/content/validate.ts:1219`). Unlike Phases 2 and 3, this phase opens **no new** basename hole — there is nothing to disclose and nothing to "fix". Say nothing about it in a comment; a comment claiming a hole was closed or opened here would be false.

**11. After the flip, changing the *portrait* becomes a mixed publish.** One D1 file (`src/content/story.json`) plus one GitHub asset commit (`assets-source/team/<hash>.jpg`) in a single request — the path the Phase 3 plan named as the least proven. It is genuinely reachable and it is genuinely covered: `reconcileAfterConflict` builds `contentSnapshots` with no store filter, which Phase 2 Task 11's review verified closes the misattribution case for exactly this shape. What is *not* fixed is that a new photo still needs a Pages build before it resolves. **The prose is instant; the photo is not.** State that in the panel's help text (Task 4) rather than letting her discover it.

**12. `worker/__tests__/github.test.ts`'s `it.each` list claims to enumerate every `validateContent`-recognised content file except the deliberately D1-backed `awards.json`.** After Task 6, `story.json` is D1-backed too. Leaving it in that list makes the surrounding prose false — this project's signature failure mode, recorded three times in the Phase 3 ledger. Task 6 removes it **and** corrects the comment.

---

## Decisions this plan takes, that the spec leaves open

**D1 — The chef intro goes inside the existing About section, not a new homepage section.** The spec's own "Decisions already taken" says so ("One About section, positioned low, holding the story plus Kamalika's introduction", line 47-48), and the code agrees: a tenth `SectionId` is a compile-driven sweep across every `Record<SectionId, …>` literal (`SECTION_ID_SET`, `SECTION_COMPONENTS` in both `App.tsx` and `EditMode.tsx`, `SECTION_LABELS`, `SectionList.tsx`, `MARKER`, `SECTION_SELECTOR`), plus a new `Copy` namespace with three coupled totality checks, plus a nav decision, plus a `sections.json` migration — for content that is one photograph and two lines. `OurStory.tsx`'s left column is a `space-y-6` stack with room under the paragraphs; the byline goes there.

**D2 — Prose to D1; photos stay where they are.** Argued in conflict 7 above.

**D3 — The committed `src/content/story.json` stays in the repository after the flip, as the fallback.** Three things it keeps buying, none of them cosmetic:
  - `src/content/__tests__/assets.test.ts` walks every `.json` under `src/content/` and asserts every asset-shaped string resolves in `public/` with exact case. It is the only guard in this repository against a portrait path pointing at a derivative that was never generated. A D1-only document is invisible to it — the accepted, low-stakes hole `awards.json` already sits in. **Keeping the file keeps the portrait inside that guarantee.**
  - It is what paints at first paint and what a crawler sees.
  - `src/content/__tests__/content.test.ts:115` derives its expectation from `git ls-files src/content`, with `awards.json` as the single named exception. Deleting `story.json` would need a second exception; keeping it needs none.

  The cost is drift: after the flip, publishes write D1 and never the file, so the committed copy freezes at whatever it held. **Task 8 closes that with `scripts/sync-story-fallback.mjs`**, run before a deploy that matters, exactly the discipline `scripts/build-snapshot.mjs` already documents for the Worker's own fallback.

**D4 — The owner-facing test.** She edits the intro at `/edit/manage/story` → **Story & Photos → About**, a panel that already exists and is already called "About". Task 4 adds three fields to the top of that panel — "Your name", "What you are", "Your photo" — above the paragraph list she already uses. Nothing moves, nothing is renamed, no new door. She does not have to be told where it is, because it is where the About text already was.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **The gate is `npm run images && npm run test:deploy && npm run build`.** That is exactly what Cloudflare Pages runs (`docs/cloudflare-cutover.md`, confirmed against the Pages API). `npm run gate` also runs `tsc -b --noEmit` and `eslint .`; run the whole of `npm run gate`. **`npm run build` is mandatory and is not optional for any task.** A green `npm test -- --run` alone has twice certified a branch CI rejected: once because the CSS ceiling test silently skips without `dist/`, once because `test:deploy` distributes files across workers differently and timed a test out. Two different commands cannot both be "the suite".
- **Run the gate AFTER `git add`, never before.** `src/admin/__tests__/content.test.ts` shells out to `git ls-files`, so it sees a different world either side of staging. A gate run on an unstaged tree is a genuine green that becomes false the moment you stage.
- **CSS budget: 145 bytes.** The entry stylesheet is **38555 bytes** against a **38700** ceiling (`src/test/bundle.post-build.test.ts:620-624`), and is currently byte-identical to the previous release. `npm run build` exits 1 the moment it is exceeded. **Every new component must be built from utilities already in the bundle.** Each task below states which classes it introduces and whether they are already present; the classes this plan uses were checked against a real `npx vite build` of `main` and every one of them is already emitted. If you need a class this plan did not list, verify it first: `grep -F '.the-class{' dist/assets/index-*.css` after a build.
- **Every test must be able to fail, proven by a named mutation.** Eleven tests that could not fail have been found in this project. Two failure modes to design against by name:
  - *Vacuously true because the content changed under it.* A content edit can strip a test of its power to fail without touching a line of test code (Phase 3, the tenth unfalsifiable test). Task 2 and Task 7 both change what `OurStory` renders; both must re-check every existing test that reads real story content.
  - *Measures real geometry but encodes broken output as the baseline.* Phase 3 shipped an `e2e` spec asserting 96px grayscale thumbnails as correct, and it reddened under mutation the whole time, because it correctly detected changes away from a wrong baseline. **Measuring is not knowing what the measurement should be.** Task 3 must look at the rendered page in a browser at both widths before writing its expected numbers.
- **jsdom has no layout engine.** Geometry, occlusion, computed style and contrast claims go in `e2e/`. A `filter`/`opacity`/background claim about an image must name the element it is read from — CSS `filter` is not inherited, which is how the eleventh unfalsifiable test happened.
- **Colour.** Brand `#C8D8E8` is a SURFACE colour only (1.45:1 on white). Foreground text and icons on light backgrounds use accent `#9D4949` (6.03:1); on dark backgrounds brand stays. Retired hexes `#6B8B59` and `#5a7349` appear nowhere except `scripts/favicons.mjs` (`src/test/palette.test.ts` asserts this). `e2e/brand-contrast.spec.ts` measures every text element against its effective background.
- **`/public/*/` is gitignored except `/public/menus/`.** Derivatives are build-time generated, never committed. `git add public/team` fails with an ignored-file error and that is correct.
- **Do NOT touch `heroCollage` in `src/content/galleries.json`.** The user has explicitly demanded it stay exactly as it is. `git diff src/content/galleries.json` must be empty at the end of every task in this phase.
- **D1 free tier, verified against live Cloudflare docs:** 5,000,000 rows read/day, 100,000 rows written/day, 5 GB/account, 500 MB/database, 10 databases. The entire content set is ~400 KB. **No paid resources without asking.** R2 is not enabled on the account.
- **Never list Claude or any AI as co-author, and never mention AI in a commit message.**
- Typecheck is `npx tsc -b --noEmit`. Plain `tsc --noEmit` checks nothing; the tsconfig is solution-style.
- Run Playwright only when nothing else is running — port 8080 is shared and concurrent runs give phantom failures. Close every browser you open.

---

## File Structure

**Created:**
- `src/components/story-api.ts` — the `/api/published?path=story.json` fetch and its shape check. A plain `.ts` module, not part of `OurStory.tsx`, because `react-refresh/only-export-components` flags a `.tsx` that exports both a component and plain values — the same split `awards-api.ts` already made.
- `src/components/__tests__/story-api.test.ts` — the fetch and shape-check tests.
- `e2e/about-byline.spec.ts` — the geometry, occlusion and contrast claims about the byline.
- `scripts/seed-story-d1.mjs` — one-off: writes the committed `story.json` into D1 through the real `D1Store`.
- `scripts/sync-story-fallback.mjs` — writes live D1 back into the committed `src/content/story.json`.
- `scripts/__tests__/sync-story-fallback.test.mjs` — proves the sync script's transform, without a network call.

**Modified:**
- `src/content/types.ts` — `ChefIntro`, `StoryContent.chef`.
- `src/content/story.json` — the `chef` block.
- `src/content/validate.ts` — `validateStory` gains the chef rules.
- `src/content/__tests__/validate.test.ts` — the chef refusal cases.
- `src/content/__tests__/assets.test.ts` — the portrait's pin comment (it is no longer only the parked `ChefGallery.tsx`).
- `src/components/OurStory.tsx` — the byline (Task 2), then the D1 fetch (Task 7).
- `src/components/__tests__/OurStory.test.tsx` — byline tests, and the two existing tests that Task 2 would otherwise leave vacuous.
- `src/test/homepage-bytes.test.tsx` — the byte pin, in Task 2 only.
- `src/admin/EditMode.tsx` — `EMPTY_STORY` gains a chef stub (compiler-forced).
- `src/admin/fields.ts` — `CHEF_FIELDS`.
- `src/admin/StoryForm.tsx` — the three chef fields.
- `src/admin/__tests__/StoryForm.test.tsx` — the fixture, and the new field tests.
- `src/admin/areas/StoryPhotosArea.tsx` — `StorySection` gains `stage` and `previews`.
- `worker/store.ts` — `D1_ONLY_PATHS` gains `src/content/story.json`.
- `worker/published.ts` — `PUBLIC_FILES` gains `story.json`.
- `worker/snapshot.ts` — regenerated from live D1 (generated file; never hand-edited).
- `worker/__tests__/store.test.ts`, `worker/__tests__/published.test.ts`, `worker/__tests__/github.test.ts` — routing pin, public read path, and the corrected `it.each` list.
- `docs/cloudflare-cutover.md` — the two scripts and when to run them.

**Not modified by any task, and a diff touching them is a defect:** `src/content/galleries.json`, `src/content/sections.json`, `src/content/copy.json`, `src/components/Awards.tsx`, `src/admin/areas/AwardsArea.tsx`, `scripts/paths.mjs`, `src/shared/upload-categories.ts`.

---

### Task 1: `chef` on `StoryContent` — type, validator, and the committed seed

The type and the data first, because `src/content/__tests__/assets.test.ts` fails the *entire suite* the moment any content file names an asset path with no derivative in `public/` — and because every later task consumes `StoryContent['chef']`.

**Files:**
- Modify: `src/content/types.ts` (after `StoryContent`, line 174-177)
- Modify: `src/content/story.json`
- Modify: `src/content/validate.ts` (`validateStory`, lines 333-352)
- Modify: `src/admin/EditMode.tsx:227` (`EMPTY_STORY`)
- Modify: `src/content/__tests__/assets.test.ts:152` (the pin's comment)
- Test: `src/content/__tests__/validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, consumed by every later task: `export interface ChefIntro { name: string; role: string; portrait: string; portraitAlt: string }` and `StoryContent.chef: ChefIntro`, both from `src/content/types.ts`. Produces the validator problem field strings `'chef.name'`, `'chef.role'`, `'chef.portrait'`, `'chef.portraitAlt'`, which Task 4's `StoryForm` filters on.

- [ ] **Step 1: Write the failing tests**

Append to `src/content/__tests__/validate.test.ts`, inside the existing `describe('story.json')` block (find it by searching for `'story.json'`; if the file organises by top-level `describe` per content file, add a new `describe('story.json chef intro')` at the end of the file instead — do not restructure the file):

```ts
  // Phase 4. The chef byline is required content, not decoration: an About
  // section that shows a face with no name, or a name with no photo, is
  // worse than one with neither. Every field is checked BEFORE the
  // paragraph loop below returns early on an empty list -- see
  // validateStory's own comment for why that ordering is load-bearing.
  const VALID_CHEF = {
    name: 'Kamalika Anand',
    role: 'Chef and owner',
    portrait: '/team/kamalika-anand.webp',
    portraitAlt: 'Chef Kamalika Anand',
  };
  const VALID_STORY = { heading: 'About', paragraphs: ['A real paragraph.'], chef: VALID_CHEF };

  it('accepts a story with a well-formed chef intro', () => {
    expect(validateContent('story.json', VALID_STORY)).toEqual([]);
  });

  it('refuses a blank chef name', () => {
    const problems = validateContent('story.json', { ...VALID_STORY, chef: { ...VALID_CHEF, name: '  ' } });
    expect(problems.map((p) => p.field)).toContain('chef.name');
  });

  it('refuses a blank role', () => {
    const problems = validateContent('story.json', { ...VALID_STORY, chef: { ...VALID_CHEF, role: '' } });
    expect(problems.map((p) => p.field)).toContain('chef.role');
  });

  it('refuses a missing portrait', () => {
    const problems = validateContent('story.json', { ...VALID_STORY, chef: { ...VALID_CHEF, portrait: '' } });
    expect(problems.map((p) => p.field)).toContain('chef.portrait');
  });

  // isUnsafeAssetPath (validate.ts) -- the same check every other image
  // field in this file already goes through. An off-site portrait is not a
  // styling choice, it is a third-party request on the homepage.
  it.each(['team/kamalika.webp', '//evil.example/x.webp', '/team/../../etc/passwd', 'https://evil.example/x.webp'])(
    'refuses a portrait path that is not a site-relative asset path: %s',
    (portrait) => {
      const problems = validateContent('story.json', { ...VALID_STORY, chef: { ...VALID_CHEF, portrait } });
      expect(problems.map((p) => p.field)).toContain('chef.portrait');
    },
  );

  it('refuses a blank portrait description', () => {
    const problems = validateContent('story.json', { ...VALID_STORY, chef: { ...VALID_CHEF, portraitAlt: '' } });
    expect(problems.map((p) => p.field)).toContain('chef.portraitAlt');
  });

  // The ordering trap, asserted rather than assumed: validateStory returns
  // early when `paragraphs` is empty. If the chef checks sat after that
  // return, a story with no paragraphs would skip them entirely and every
  // test above would still pass -- the chef rules would be unreachable for
  // the one input most likely to be malformed.
  it('still reports a bad chef intro when the paragraph list is empty', () => {
    const problems = validateContent('story.json', { heading: 'About', paragraphs: [], chef: { ...VALID_CHEF, name: '' } });
    expect(problems.map((p) => p.field)).toContain('chef.name');
    expect(problems.map((p) => p.field)).toContain('paragraphs');
  });

  // A missing `chef` key entirely -- what an old D1 revision restored by
  // undo would look like. asRecord maps a missing value to {}, so every
  // field check fires; this pins that it degrades to four honest problems
  // rather than throwing.
  it('refuses a story with no chef intro at all, without throwing', () => {
    const problems = validateContent('story.json', { heading: 'About', paragraphs: ['A real paragraph.'] });
    expect(problems.map((p) => p.field).sort()).toEqual(
      ['chef.name', 'chef.portrait', 'chef.portraitAlt', 'chef.role'].sort(),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/content/__tests__/validate.test.ts -t 'chef'`
Expected: FAIL — every `expect(...).toContain('chef.name')` fails with `expected [ 'heading' ] to contain 'chef.name'` (or an empty array), because `validateStory` has no chef rules yet.

- [ ] **Step 3: Add the type**

In `src/content/types.ts`, replace `StoryContent` (lines 174-177) with:

```ts
// Phase 4. Kamalika's byline under the About prose. The six paragraphs are
// already written in her first person and already signed off in her name
// (src/content/story.json), so this adds attribution and a face rather than
// a second block of prose saying the same thing again -- which is what the
// spec's "adds Kamalika's personal introduction" turns out to mean once you
// read the copy that is already there.
//
// Every field is REQUIRED. A byline with no name, or a name with no
// photograph, reads as a half-finished page rather than as a smaller
// version of the same idea -- the same reasoning Experience['image'] uses
// (see that interface) and the opposite of Award['image'], where an award
// with no badge is simply an ordinary award.
//
// `portrait` is a site-relative derivative path ('/team/kamalika-anand.webp'),
// never an absolute URL: validateStory refuses anything else, and the
// committed story.json is what keeps this path inside
// src/content/__tests__/assets.test.ts's walk even after Phase 4 moves this
// document's live copy to D1 (see that task's own reasoning).
export interface ChefIntro {
  name: string;
  role: string;
  portrait: string;
  portraitAlt: string;
}

export interface StoryContent {
  heading: string;
  paragraphs: string[];
  chef: ChefIntro;
}
```

- [ ] **Step 4: Seed the committed content**

In `src/content/story.json`, add a `chef` key after `paragraphs` (keep the existing six paragraphs byte-identical):

```json
  "chef": {
    "name": "Kamalika Anand",
    "role": "Chef and owner",
    "portrait": "/team/kamalika-anand.webp",
    "portraitAlt": "Chef Kamalika Anand"
  }
```

The portrait path is the derivative that **already exists**: `assets-source/team/kamalika-anand.jpg` is tracked in git and `npm run images` writes `public/team/kamalika-anand.webp` at 932x1243 (the source's own width; `withoutEnlargement: true` means the 1000px default is a cap, not a target). Do not add a new image, do not add a `team` entry to `DIR_MAX_WIDTH`, and do not write "1000px" anywhere.

- [ ] **Step 5: Add the validator rules**

In `src/content/validate.ts`, replace `validateStory` (lines 333-352) with:

```ts
function validateStory(data: unknown): ValidationProblem[] {
  const story = asRecord(data);
  const problems: ValidationProblem[] = [];
  if (isBlank(story.heading)) problems.push(problem('heading', 'the About section needs a heading'));

  // Phase 4. Checked HERE, before the paragraph block below, because that
  // block returns early on an empty list -- chef rules placed after it
  // would be unreachable for exactly the input most likely to be malformed,
  // and every chef test would still pass while checking nothing.
  const chef = asRecord(story.chef);
  if (isBlank(chef.name)) {
    problems.push(problem('chef.name', 'the About section needs your name'));
  }
  if (isBlank(chef.role)) {
    problems.push(problem('chef.role', 'the About section needs a short line saying who you are, e.g. "Chef and owner"'));
  }
  if (isBlank(chef.portrait)) {
    problems.push(problem('chef.portrait', 'the About section needs a photo of you'));
  } else if (isUnsafeAssetPath(chef.portrait)) {
    problems.push(problem('chef.portrait', 'your photo needs to be one uploaded through this dashboard, starting with /'));
  }
  if (isBlank(chef.portraitAlt)) {
    problems.push(problem('chef.portraitAlt', 'your photo needs a short description, for people using a screen reader'));
  }

  if (!Array.isArray(story.paragraphs) || story.paragraphs.length === 0) {
    problems.push(problem('paragraphs', 'the About section needs at least one paragraph'));
    return problems;
  }
  story.paragraphs.forEach((raw: unknown, i: number) => {
    if (isBlank(raw)) {
      problems.push(problem(`paragraphs[${i}]`, `paragraph ${i + 1} is blank`));
      return;
    }
    const trimmed = (raw as string).trim();
    if (trimmed.endsWith('...') || trimmed.endsWith('…')) {
      problems.push(problem(`paragraphs[${i}]`, `paragraph ${i + 1} trails off with an ellipsis — finish the thought before publishing`));
    }
  });
  return problems;
}
```

Note the two message rewordings ("the story needs a heading" → "the About section needs a heading", and the same for paragraphs): the panel, the label and the section have all been called "About" since Phase 1, and "the story" was the last place the old name survived in something the owner reads. If `src/content/__tests__/validate.test.ts` pins either old string, update the pin — do not revert the message.

- [ ] **Step 6: Fix what the compiler now reports**

Run `npx tsc -b --noEmit` and work from what it actually reports, not from this list. Expected, at minimum:
- `src/admin/EditMode.tsx:227` — `EMPTY_STORY` is missing `chef`:

```ts
const EMPTY_STORY: StoryContent = {
  heading: '',
  paragraphs: [],
  chef: { name: '', role: '', portrait: '', portraitAlt: '' },
};
```

- `src/admin/__tests__/StoryForm.test.tsx` — the `STORY` fixture and the three inline `StoryContent` literals near lines 85, 103 and 115 each need a `chef`. Give them the real-looking values, not empty strings, so the fixtures stay valid content:

```ts
const CHEF = {
  name: 'Kamalika Anand',
  role: 'Chef and owner',
  portrait: '/team/kamalika-anand.webp',
  portraitAlt: 'Chef Kamalika Anand',
};
```

The compiler is the authority. If it names a file this plan did not, fix it there too and say so in the commit message.

- [ ] **Step 7: Correct the asset pin's comment**

`src/content/__tests__/assets.test.ts:152` currently reads:

```ts
    expect(paths).toContain('/team/kamalika-anand.webp'); // parked ChefGallery.tsx
```

That comment is now false — the path is reached from three places. Replace it with:

```ts
    // Reached from three places now: src/content/press.json's chef-interview
    // article, src/content/story.json's chef byline (Phase 4), and the
    // parked src/components/ChefGallery.tsx. The story.json reference is the
    // one that matters most, because Phase 4 moves that document's LIVE copy
    // to D1 -- where this walk cannot see it -- and the committed file is
    // what keeps the portrait inside this guarantee.
    expect(paths).toContain('/team/kamalika-anand.webp');
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/content/__tests__/validate.test.ts src/content/__tests__/assets.test.ts src/admin/__tests__/StoryForm.test.tsx`
Expected: PASS.

- [ ] **Step 9: Prove the tests can fail**

Run each mutation, confirm the named failure, revert:

1. Delete the `isBlank(chef.name)` block from `validateStory` → `refuses a blank chef name` and `refuses a story with no chef intro at all` both fail with `expected [...] to contain 'chef.name'`.
2. Move the whole chef block to *after* the `paragraphs` early return → `still reports a bad chef intro when the paragraph list is empty` fails, and nothing else does. This is the ordering trap; if this mutation leaves everything green, the test is not doing its job.
3. Change `else if (isUnsafeAssetPath(...))` to `else if (false)` → all four rows of the `it.each` fail.
4. In `src/content/story.json`, change the portrait to `/team/kamalika-anand-2.webp` → `src/content/__tests__/assets.test.ts` fails with the missing-public-file message. This is the guarantee D3 rests on; confirm it by running it, not by reasoning about it.

- [ ] **Step 10: Run the full gate, after staging**

```bash
git add -A
npm run gate
```

Expected: exit 0. `npm run build` must run and must exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/content/types.ts src/content/story.json src/content/validate.ts \
        src/content/__tests__/validate.test.ts src/content/__tests__/assets.test.ts \
        src/admin/EditMode.tsx src/admin/__tests__/StoryForm.test.tsx
git commit -m "feat(about): give StoryContent a required chef byline, seeded from the portrait already in the tree

The six About paragraphs were already written in the first person and
already signed \"Chef Kamalika Anand\" -- what was missing was attribution
and a face, not more prose. ChefIntro adds name, role, portrait and
portraitAlt, all required.

The portrait is not new: assets-source/team/kamalika-anand.jpg has been
tracked since Phase A2 and npm run images already writes
public/team/kamalika-anand.webp at 932x1243 (the source's own width --
withoutEnlargement means the 1000px default is a cap, not a target).
Referencing it from story.json is what keeps it inside assets.test.ts's
walk once this document's live copy moves to D1.

The chef checks run BEFORE validateStory's empty-paragraphs early return,
deliberately: after it they would be unreachable for the input most likely
to be malformed. There is a test for that specific ordering."
```

---

### Task 2: The byline on the page

**Files:**
- Modify: `src/components/OurStory.tsx`
- Modify: `src/components/__tests__/OurStory.test.tsx`
- Modify: `src/test/homepage-bytes.test.tsx:194`

**Interfaces:**
- Consumes: `StoryContent['chef']` from Task 1.
- Produces, consumed by Task 3: the DOM handles `data-testid="chef-byline"` on the wrapper and `data-testid="chef-portrait"` on the `<img>`. Produces, consumed by Task 7: the component still reads its story from a single `story` binding, so Task 7 only has to change where that binding comes from.

**CSS budget:** this task introduces **zero new Tailwind rules**. Every class below was checked against a real `npx vite build` of `main` and is already emitted in `dist/assets/index-*.css`: `mt-10`, `pt-8`, `border-t`, `border-gray-200`, `flex`, `items-center`, `gap-4`, `h-24`, `w-24`, `shrink-0`, `rounded-full`, `object-cover`, `font-['Montserrat']`, `font-['Open_Sans']`, `font-bold`, `font-semibold`, `text-lg`, `text-sm`, `text-ink`, `text-accent`, `uppercase`, `tracking-wide`. **Do not add a responsive variant.** `sm:flex-row`, `md:flex-row`, `sm:text-left` and `md:text-left` are all *absent* from the bundle and each one would cost real bytes against a 145-byte margin. The byline is a horizontal row at every width; a 96px avatar beside two short lines fits a 390px viewport with room to spare, which Task 3 measures rather than assumes.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `src/components/__tests__/OurStory.test.tsx` with:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import OurStory from '../OurStory';
import { story, galleries } from '../../content';

describe('OurStory', () => {
  // "No trailing ellipsis" moved to src/content/validate.ts: it rejects a
  // bad story.json before the commit exists, rather than after the build
  // has already run against it.

  it('renders every paragraph', () => {
    render(<OurStory />);
    story.paragraphs.forEach((p) => {
      expect(screen.getByText(p)).toBeInTheDocument();
    });
  });

  // Scoped to the carousel, not to the whole section. Before Phase 4 this
  // counted every <img> on the page and that happened to equal the carousel
  // length; the byline portrait is now a second kind of image in the same
  // section, so an unscoped count would have had to be bumped to
  // `length + 1` -- a number that stays correct no matter what goes wrong
  // with the portrait, i.e. an assertion that could no longer fail for its
  // stated reason.
  it('carousel images come from content, not a filename list', () => {
    const { container } = render(<OurStory />);
    const carousel = container.querySelector('[data-testid="our-story-carousel"]');
    expect(carousel).not.toBeNull();
    const images = within(carousel as HTMLElement).getAllByRole('img');
    expect(images).toHaveLength(galleries.ourStory.length);
    images.forEach((img) => {
      expect(img.getAttribute('alt')).not.toMatch(/^Slide \d+$/);
    });
  });

  describe('the chef byline', () => {
    it('names her and says what she is', () => {
      render(<OurStory />);
      const byline = screen.getByTestId('chef-byline');
      expect(within(byline).getByText(story.chef.name)).toBeInTheDocument();
      expect(within(byline).getByText(story.chef.role)).toBeInTheDocument();
    });

    it('shows her portrait, from content, with her own description of it', () => {
      render(<OurStory />);
      const portrait = screen.getByTestId('chef-portrait');
      expect(portrait).toHaveAttribute('src', story.chef.portrait);
      expect(portrait).toHaveAttribute('alt', story.chef.portraitAlt);
    });

    // The portrait is the last thing on the page's eighth section. Eager
    // loading it would put a 114KB request on the critical path for an
    // image almost nobody scrolls to.
    it('defers the portrait until it is scrolled to', () => {
      render(<OurStory />);
      expect(screen.getByTestId('chef-portrait')).toHaveAttribute('loading', 'lazy');
    });

    // The byline sits BELOW the prose, not above it: the paragraphs are
    // already written in her voice, so the signature belongs at the end of
    // the letter. Asserted by document order rather than by a class name,
    // which would survive a reorder.
    it('sits after the last paragraph', () => {
      render(<OurStory />);
      const lastParagraph = screen.getByText(story.paragraphs[story.paragraphs.length - 1]);
      const byline = screen.getByTestId('chef-byline');
      expect(lastParagraph.compareDocumentPosition(byline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/__tests__/OurStory.test.tsx`
Expected: FAIL — the four byline tests fail with `Unable to find an element by: [data-testid="chef-byline"]`, and `carousel images come from content` fails on `expect(carousel).not.toBeNull()`.

- [ ] **Step 3: Render the byline**

In `src/components/OurStory.tsx`, add `data-testid="our-story-carousel"` to the carousel wrapper (the `div` at line 36 with `className="relative overflow-hidden rounded-2xl shadow-2xl h-[400px]"`), and add the byline immediately after the paragraphs `<div>` (closing at line 32), still inside the `space-y-6` column:

```tsx
            {/* Her byline. The six paragraphs above are already in her first
                person and already sign off in her name, so this is
                attribution and a face rather than a second introduction --
                which is what makes it belong at the END of the prose, the
                way a signature does, and not above it.

                Built entirely from utilities already in the shipped
                stylesheet: the entry CSS budget is 145 bytes (38555 against
                a 38700 ceiling, src/test/bundle.post-build.test.ts) and one
                responsive variant would spend most of it. There is no
                sm:/md: prefix here on purpose -- a 96px avatar beside two
                short lines fits a 390px viewport, which
                e2e/about-byline.spec.ts measures rather than assumes. */}
            <div data-testid="chef-byline" className="mt-10 flex items-center gap-4 border-t border-gray-200 pt-8">
              <img
                data-testid="chef-portrait"
                src={chef.portrait}
                alt={chef.portraitAlt}
                loading="lazy"
                className="h-24 w-24 shrink-0 rounded-full object-cover"
              />
              <div>
                <p className="font-['Montserrat'] text-lg font-bold text-ink">{chef.name}</p>
                <p className="font-['Open_Sans'] text-sm font-semibold uppercase tracking-wide text-accent">
                  {chef.role}
                </p>
              </div>
            </div>
```

and destructure `chef` alongside `story` at the top of the component:

```tsx
  const { story, galleries } = content;
  const { chef } = story;
```

The portrait is rendered as a plain `<img>`, **not** through `content.renderImage`. `renderImage` is the `/edit` in-place editing seam, and `story.json` has no in-place editing affordance at all today — `EditMode.tsx:928` records that `site.json`/`story.json`/`menus.json` are dashboard-only, and `OurStory.tsx` already renders `story.heading` and every paragraph as bare text for the same reason. Wiring one seam for one image here would put an editing affordance on a section whose text beside it has none, which reads as broken. She changes the portrait in the Manage panel (Task 4), where she changes the words.

`text-accent` (`#9D4949`, 6.03:1 on white) for the role line, not `text-brand`: `#C8D8E8` is 1.45:1 and is a surface colour only.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/__tests__/OurStory.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Update the homepage byte pin**

Run: `npx vitest run src/test/homepage-bytes.test.tsx`
Expected: FAIL with `expected <N> to be 51865`. Replace `51865` at line 194 with the number the test reports, and add a line to that file's accounting comment block naming what bought the change — the byline's markup. **Update the number, never the assertion.** If the number goes *down*, stop and investigate: adding markup cannot shrink the rendered HTML, and a drop means something else was removed.

- [ ] **Step 6: Confirm the CSS did not move**

```bash
npm run build
ls -l dist/assets/index-*.css
```

Expected: `npm run build` exits 0 and the entry stylesheet is still **38555 bytes**. If it is larger, one of the classes above was mistyped into a new utility — find it with `npx vite build && grep -c 'YOUR-CLASS{' dist/assets/index-*.css` and fix the class, do not raise the ceiling.

- [ ] **Step 7: Prove the tests can fail**

1. Delete the `<img>` from the byline → `shows her portrait`, `defers the portrait`, and the e2e-facing testid disappear; the two jsdom portrait tests fail with `Unable to find an element by: [data-testid="chef-portrait"]`.
2. Change `loading="lazy"` to `loading="eager"` → `defers the portrait until it is scrolled to` fails with `expected element to have attribute loading="lazy"`.
3. Move the byline `<div>` above the paragraphs `<div>` → `sits after the last paragraph` fails, and nothing else does.
4. Hardcode `src="/team/kamalika-anand.webp"` instead of `{chef.portrait}` → `shows her portrait, from content` **still passes**, because the committed value is that string. That is expected and is why the test also asserts `alt`; change `alt` to a literal too and it still passes. **This is a real limit of the jsdom test and it must be recorded, not papered over:** what proves the portrait is content-driven rather than hardcoded is Task 4's `StoryForm` test (editing the field changes the value) and Task 7's swap test (a D1 body with a different portrait renders that portrait). Say this in the commit message.
5. Change `text-accent` to `text-brand` → nothing in jsdom fails. Task 3's contrast spec is what catches it.

- [ ] **Step 8: Run the full gate, after staging**

```bash
git add -A
npm run gate
```

- [ ] **Step 9: Commit**

```bash
git add src/components/OurStory.tsx src/components/__tests__/OurStory.test.tsx src/test/homepage-bytes.test.tsx
git commit -m "feat(about): show Kamalika's portrait, name and role beneath the About prose

The byline sits after the last paragraph rather than before the first: the
paragraphs are already in her first person, so this is a signature, not an
introduction to something that has not been said yet.

Zero new CSS. Every utility here was checked against a real build of main
and is already in the entry stylesheet, which stays at 38555 bytes against
its 38700 ceiling. No sm:/md: variant is used -- none of the ones this
layout would want are in the bundle, and one would spend most of the
145-byte margin.

Scoped the carousel image count to the carousel. It used to count every
<img> in the section, which happened to equal the carousel length; leaving
it unscoped and bumping it to length+1 would have produced a number that
stays correct however badly the portrait breaks.

Known limit, recorded rather than hidden: the jsdom test cannot tell
{chef.portrait} from a hardcoded '/team/kamalika-anand.webp', because they
are the same string today. The StoryForm edit test and the D1 swap test are
what actually prove the value is content-driven."
```

---

### Task 3: Prove the byline in a real browser

jsdom has no layout engine, so every claim about the portrait's size, its shape, whether it is clipped, and whether the role line is readable has to be measured in Chromium. This is the one task that runs Playwright, so **no other agent may hold the tree while it runs**.

**Before writing a single expected number, open the page and look at it.** Phase 3 shipped an `e2e` spec that measured real geometry and faithfully encoded a broken 96px grayscale thumbnail as the expected baseline; it reddened under every mutation the whole time, because it correctly detected changes away from a wrong baseline. Measuring is not the same as knowing what the measurement should be.

**Files:**
- Create: `e2e/about-byline.spec.ts`

**Interfaces:**
- Consumes: `data-testid="chef-byline"` and `data-testid="chef-portrait"` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Look at it**

```bash
npx playwright test --ui   # or: npx playwright codegen http://localhost:8080/
```

Load `/`, scroll to `#our-story`, and look at the byline at 1280x800 and at 390x844. Confirm by eye, before writing any number: the portrait is a circle, it is in colour, it is not squashed (the source is 932x1243 portrait, and `object-cover` on a square box crops rather than distorts), the name and role sit beside it and do not wrap onto four lines at 390px, and the whole block sits below the last paragraph and above the carousel on narrow screens. Write down the numbers you actually see. If any of that is wrong, **fix the component in this task** rather than encoding it.

- [ ] **Step 2: Write the failing spec**

Create `e2e/about-byline.spec.ts`. Follow the existing conventions in `e2e/page-galleries.spec.ts` for the base URL, the `beforeEach`, and the contrast helper import (read that file first; do not guess at the helper's name or signature).

```ts
import { test, expect } from '@playwright/test';

// Phase 4. The byline's claims that jsdom structurally cannot make:
// size, shape, colour, occlusion and contrast.
//
// Written AFTER looking at the rendered page at both widths, deliberately.
// This project has shipped an e2e spec that measured real geometry and
// encoded broken output as the expected baseline -- it reddened under every
// mutation while pinning the wrong thing. The numbers below are floors and
// ratios, not transcriptions of whatever the page happened to render.

const ABOUT = '#our-story';

test.describe('the About byline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator(ABOUT).scrollIntoViewIfNeeded();
  });

  test('the portrait is a real, visible circle at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const portrait = page.getByTestId('chef-portrait');
    await portrait.scrollIntoViewIfNeeded();
    await expect(portrait).toBeVisible();

    const box = await portrait.boundingBox();
    expect(box).not.toBeNull();
    // h-24 w-24 -- a square box, 96 CSS px. Asserted as a square with a
    // floor rather than as an exact pair, so a future size change fails on
    // "too small" or "no longer square" rather than on an incidental
    // repaint.
    expect(box!.width).toBeGreaterThanOrEqual(90);
    expect(box!.height).toBeGreaterThanOrEqual(90);
    expect(Math.abs(box!.width - box!.height)).toBeLessThanOrEqual(1);

    // rounded-full on a square box is a circle. Read off the IMG itself --
    // border-radius is not inherited, and this project has already shipped
    // a filter assertion that read the wrong element and passed on the
    // defect for four assertions running.
    const radius = await portrait.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(radius)).toBeGreaterThanOrEqual(box!.width / 2 - 1);

    // In colour, and read off the IMG, for the same reason.
    expect(await portrait.evaluate((el) => getComputedStyle(el).filter)).toBe('none');

    // Not distorted: the source is 932x1243 portrait and object-cover on a
    // square box must crop, never squash.
    expect(await portrait.evaluate((el) => getComputedStyle(el).objectFit)).toBe('cover');
  });

  test('the portrait is genuinely on top, not covered by the section behind it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const portrait = page.getByTestId('chef-portrait');
    await portrait.scrollIntoViewIfNeeded();
    const box = (await portrait.boundingBox())!;
    // Sampled at the centre, which is inside the circle at any radius.
    const hit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el === null ? null : el.getAttribute('data-testid');
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(hit).toBe('chef-portrait');
  });

  test('the name and role sit beside the portrait and stay on one line each at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const byline = page.getByTestId('chef-byline');
    await byline.scrollIntoViewIfNeeded();
    const portraitBox = (await page.getByTestId('chef-portrait').boundingBox())!;
    const nameBox = (await byline.locator('p').first().boundingBox())!;

    // Beside, not below: the text starts to the RIGHT of the portrait's
    // right edge. This is the claim that would break if a responsive
    // variant were added, or if the flex row wrapped on a phone.
    expect(nameBox.x).toBeGreaterThan(portraitBox.x + portraitBox.width - 1);

    // One line each. A 96px avatar plus a name that wraps to three lines is
    // the failure this measures; line-height at text-lg is ~28px, so a
    // second line would push this past 40.
    expect(nameBox.height).toBeLessThan(40);

    // And nothing overflows the viewport.
    const bylineBox = (await byline.boundingBox())!;
    expect(bylineBox.x).toBeGreaterThanOrEqual(0);
    expect(bylineBox.x + bylineBox.width).toBeLessThanOrEqual(390);
  });

  test('the role line is readable against what is actually behind it', async ({ page }) => {
    // The role sits on bg-cream-alt (#F9F9F9) in text-accent (#9D4949).
    // Measured, not asserted from the palette: the whole point of
    // e2e/brand-contrast.spec.ts is that this project once shipped a blue
    // button with white text at 1.45:1.
    const role = page.getByTestId('chef-byline').locator('p').nth(1);
    await role.scrollIntoViewIfNeeded();
    await expect(role).toBeVisible();
    const { color, background } = await role.evaluate((el) => {
      const style = getComputedStyle(el);
      let node: HTMLElement | null = el as HTMLElement;
      let background = 'rgba(0, 0, 0, 0)';
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          background = bg;
          break;
        }
        node = node.parentElement;
      }
      return { color: style.color, background };
    });
    // #9D4949 on #F9F9F9 -- reuse the project's own contrastRatio helper
    // rather than a second implementation; import it the way
    // e2e/brand-contrast.spec.ts does.
    expect(color).toBe('rgb(157, 73, 73)');
    expect(background).toBe('rgb(249, 249, 249)');
  });
});
```

If `e2e/brand-contrast.spec.ts` exports a reusable `contrastRatio`, import it and assert `>= 4.5` instead of pinning the two colour strings — a real ratio is a stronger claim than two literals. Read that file and use whatever is actually there.

- [ ] **Step 3: Run the spec to verify it fails against a broken build**

Before running it green, prove it is load-bearing. Temporarily remove `rounded-full` from the portrait's class string and run:

Run: `npx playwright test e2e/about-byline.spec.ts`
Expected: FAIL on `expect(parseFloat(radius)).toBeGreaterThanOrEqual(...)` with a radius of `0`.

Revert.

- [ ] **Step 4: Run the whole browser suite**

Run: `npx playwright test`
Expected: every existing spec still passes, plus the four new ones. Note the total. `e2e/dashboard-sections.spec.ts:392` is a **known pre-existing flake** (one failure in three full runs, recorded in the Phase 3 ledger, in code this phase never touches). If it fails, re-run that spec alone before reporting anything; if it passes alone, it is the flake and it does not block. Do not silence it and do not "fix" it here.

- [ ] **Step 5: Prove each test can fail**

1. Remove `rounded-full` → the circle assertion fails with radius `0`.
2. Change `h-24 w-24` to `h-16 w-16` → the `>= 90` floor fails at 64.
3. Change `object-cover` to `object-contain` → the `objectFit` assertion fails, and the square-ness assertion still passes (confirming the two measure different things).
4. Add `grayscale` to the `<img>` → the `filter` assertion fails with `grayscale(1)`. **Run this one specifically**: it is the mutation the eleventh unfalsifiable test failed to catch, because the filter sat on a wrapper and the assertion read the `img`. Here the class and the assertion are on the same element; confirm that by watching it go red.
5. Change `flex items-center gap-4` to `flex flex-col` → the "beside, not below" assertion fails at 390px.
6. Change `text-accent` to `text-brand` → the contrast assertion fails with `rgb(200, 216, 232)`.

- [ ] **Step 6: Close every browser, then run the full gate**

```bash
git add -A
npm run gate
```

- [ ] **Step 7: Commit**

```bash
git add e2e/about-byline.spec.ts
git commit -m "test(about): measure the byline in a real browser -- size, shape, colour, occlusion, contrast

Written after looking at the page at 1280 and 390, not by transcribing
whatever the first run produced. This project has shipped an e2e spec that
measured real geometry and encoded a broken 96px grayscale thumbnail as the
expected baseline; it reddened under every mutation while pinning the wrong
thing.

The filter assertion reads the IMG, which is the element the class is on.
The last time this project asserted 'filter: none' it read an element the
grayscale was not on, and passed on the shipped defect four times over.

Six mutations run and each reddened on its own assertion, including adding
grayscale and dropping rounded-full."
```

---

### Task 4: She edits her own byline

**Files:**
- Modify: `src/admin/fields.ts` (after `AWARD_FIELDS`)
- Modify: `src/admin/StoryForm.tsx`
- Modify: `src/admin/areas/StoryPhotosArea.tsx` (`StorySection`)
- Modify: `src/admin/__tests__/StoryForm.test.tsx`

**Interfaces:**
- Consumes: `ChefIntro` and the validator field strings `chef.name` / `chef.role` / `chef.portrait` / `chef.portraitAlt` from Task 1.
- Produces, consumed by nothing later: `CHEF_FIELDS: FieldsOf<ChefIntro>` exported from `src/admin/fields.ts`; the staged-photo key `story.json:chef:portrait`; the preview key `story.json:chef:portrait`.

**CSS budget:** zero new rules. `StoryForm` reuses `Field` (which owns every input class) and the existing `ADD_BUTTON_CLASSNAME`/`MOVE_BUTTON_CLASSNAME`/`REMOVE_BUTTON_CLASSNAME` bindings it already imports. The one new wrapper uses `mb-6 rounded border border-gray-200 p-4`, character-identical to the `<li>` wrapper already in this file, so it emits nothing new. Do not retype those utilities with a variation — this project has shipped duplicate CSS from exactly that drift.

- [ ] **Step 1: Write the failing tests**

Append to `src/admin/__tests__/StoryForm.test.tsx` (the file already has a `STORY` fixture; use the `CHEF` constant Task 1 added):

```tsx
  describe('the chef byline fields', () => {
    it('shows her name, her role and her photo above the paragraphs', () => {
      render(<StoryForm value={STORY} onChange={vi.fn()} problems={[]} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
      expect(screen.getByLabelText('Your name')).toHaveValue(STORY.chef.name);
      expect(screen.getByLabelText('What you are')).toHaveValue(STORY.chef.role);
      expect(screen.getByLabelText('Description of your photo')).toHaveValue(STORY.chef.portraitAlt);
      // PhotoField renders its own label and file input rather than a text
      // box holding the path -- see Field.tsx's own dispatch comment.
      expect(screen.getByLabelText('Your photo')).toBeInTheDocument();
    });

    it('edits her name without disturbing the paragraphs', async () => {
      const onChange = vi.fn();
      render(<StoryForm value={STORY} onChange={onChange} problems={[]} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
      await userEvent.clear(screen.getByLabelText('Your name'));
      await userEvent.type(screen.getByLabelText('Your name'), 'K');
      expect(onChange).toHaveBeenLastCalledWith({
        ...STORY,
        chef: { ...STORY.chef, name: 'K' },
      });
    });

    it('edits the role line', async () => {
      const onChange = vi.fn();
      render(<StoryForm value={STORY} onChange={onChange} problems={[]} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
      await userEvent.clear(screen.getByLabelText('What you are'));
      await userEvent.type(screen.getByLabelText('What you are'), 'C');
      expect(onChange).toHaveBeenLastCalledWith({ ...STORY, chef: { ...STORY.chef, role: 'C' } });
    });

    // Routed to the right field, not dumped in the banner: validateStory
    // emits 'chef.name', and StoryForm's existing paragraph banner catches
    // everything it does not recognise -- so a chef problem with no home
    // would silently appear in a box labelled "Problems with the About
    // section's paragraphs".
    it("shows a chef problem on the chef's own field, not in the paragraph banner", () => {
      const problems = [{ field: 'chef.name', message: 'the About section needs your name' }];
      render(<StoryForm value={STORY} onChange={vi.fn()} problems={problems} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
      expect(screen.getByText('the About section needs your name')).toBeInTheDocument();
      expect(screen.queryByRole('alert', { name: /paragraphs/i })).toBeNull();
    });

    it('still routes a paragraph problem to its paragraph', () => {
      const problems = [{ field: 'paragraphs[1]', message: 'paragraph 2 is blank' }];
      render(<StoryForm value={STORY} onChange={vi.fn()} problems={problems} stage={vi.fn()} previews={NO_IMAGE_PREVIEWS} />);
      expect(screen.getByText('paragraph 2 is blank')).toBeInTheDocument();
    });
  });
```

Add the imports the new tests need (`userEvent` and `NO_IMAGE_PREVIEWS` from `../previews`) if they are not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/admin/__tests__/StoryForm.test.tsx -t 'chef byline'`
Expected: FAIL — TypeScript rejects the new `stage`/`previews` props on `StoryFormProps`, and at runtime `Unable to find a label with the text of: Your name`.

- [ ] **Step 3: Add `CHEF_FIELDS`**

In `src/admin/fields.ts`, after `AWARD_FIELDS`:

```ts
// Phase 4. story.json's chef byline, rendered at the TOP of the About panel
// -- above the paragraph list she already knows -- because it is the part
// of that panel a first-time visitor can complete without reading anything.
//
// Labels are second person, unlike every other descriptor in this file.
// That is deliberate and it is the only place it happens: the owner IS the
// chef, so "Awarding body" and "Publication" describe someone else while
// "Your name" describes her. The alternative ("Chef's name") makes her
// dashboard talk about her in the third person.
//
// `category: 'team'` -- already a member of UPLOAD_CATEGORIES
// (src/shared/upload-categories.ts), already the directory
// assets-source/team/ her portrait lives in, and already what
// scripts/images.mjs writes public/team/*.webp from. No widening needed.
export const CHEF_FIELDS: FieldsOf<ChefIntro> = {
  name: { label: 'Your name', kind: 'text' },
  role: {
    label: 'What you are',
    kind: 'text',
    help: 'One short line under your name, e.g. "Chef and owner".',
  },
  portrait: {
    label: 'Your photo',
    kind: 'image',
    category: 'team',
    // The honest cost, in front of her rather than in a ledger she will
    // never read. The words in this panel now publish straight to the
    // database and are live in seconds; a NEW photo still has to be
    // processed by the site build, which takes a couple of minutes. Both
    // halves are true and she has no way to find out otherwise.
    help: 'Changing your photo takes a couple of minutes to appear, unlike the words above it, which are live as soon as you publish.',
  },
  portraitAlt: {
    label: 'Description of your photo',
    kind: 'text',
    help: 'A few words describing the photo, read aloud to anyone using a screen reader. "Chef Kamalika Anand" is enough.',
  },
};
```

Import `ChefIntro` alongside the existing `../content/types` imports.

- [ ] **Step 4: Render them in `StoryForm`**

In `src/admin/StoryForm.tsx`: widen the props, filter the chef problems, and render the block above the heading field.

```tsx
export interface StoryFormProps {
  value: StoryContent;
  onChange: (next: StoryContent) => void;
  // The FULL story.json problem list, unfiltered -- the same contract every
  // other list/form in this dashboard already documents on its own
  // `problems` prop.
  problems: ValidationProblem[];
  // Phase 4: the byline's portrait is a real upload, so this form now needs
  // the same two seams every other photo-carrying screen already takes.
  // The key shape is `story.json:chef:portrait` -- file, then record, then
  // field, exactly the convention staged.ts's own comment records for
  // ArraySection and GalleryList.
  stage: (key: string, file: StagedFile | null) => void;
  previews: ImagePreviews;
}
```

Inside the component, before `headingProblems`:

```tsx
  const chefProblems = problems.filter((p) => p.field.startsWith('chef.'));
```

and extend the banner filter so a chef problem is never swept into the paragraph banner:

```tsx
  const banner = problems.filter((p) => {
    if (p.field === 'heading') return false;
    if (p.field.startsWith('chef.')) return false;
    if (p.field === 'paragraphs') return true;
    const index = paragraphIndexOf(p.field);
    return index === undefined || index < 0 || index >= value.paragraphs.length;
  });
```

Render, as the first child of the returned `<div>`:

```tsx
      {/* Above the heading and the paragraphs: this is the part of the About
          panel she can finish without reading anything, and putting it under
          six textareas would mean scrolling past the hard part to reach the
          easy one. */}
      <div className="mb-6 rounded border border-gray-200 p-4">
        <Field
          id="story-chef-name"
          spec={CHEF_FIELDS.name}
          value={value.chef.name}
          onChange={(next) => onChange({ ...value, chef: { ...value.chef, name: next } })}
          problems={chefProblems.filter((p) => p.field === 'chef.name')}
        />
        <Field
          id="story-chef-role"
          spec={CHEF_FIELDS.role}
          value={value.chef.role}
          onChange={(next) => onChange({ ...value, chef: { ...value.chef, role: next } })}
          problems={chefProblems.filter((p) => p.field === 'chef.role')}
        />
        <Field
          id="story-chef-portrait"
          spec={CHEF_FIELDS.portrait}
          value={value.chef.portrait}
          onChange={(next) => onChange({ ...value, chef: { ...value.chef, portrait: next ?? '' } })}
          onStaged={(staged) => stage('story.json:chef:portrait', fromStagedPhoto(staged))}
          previews={previews}
          previewKey="story.json:chef:portrait"
          problems={chefProblems.filter((p) => p.field === 'chef.portrait')}
        />
        <Field
          id="story-chef-portrait-alt"
          spec={CHEF_FIELDS.portraitAlt}
          value={value.chef.portraitAlt}
          onChange={(next) => onChange({ ...value, chef: { ...value.chef, portraitAlt: next } })}
          problems={chefProblems.filter((p) => p.field === 'chef.portraitAlt')}
        />
      </div>
```

Import `CHEF_FIELDS` from `./fields`, `fromStagedPhoto` and `StagedFile` from `./staged`, and `ImagePreviews` from `./previews`.

`onChange={(next) => ... next ?? ''}`: `Field`'s image branch forwards `PhotoField`'s `onChange(contentPath: string | null)`, and `ChefIntro['portrait']` is a required `string`. Coercing `null` to `''` keeps the type honest and leaves the validator to refuse the empty value with a sentence, rather than letting `null` reach `story.json` where nothing would type-check it. `PhotoField` has no clear/remove control today so this is unreachable in practice — set it anyway, exactly as `AWARD_FIELDS.image`'s `optional: true` was set for the same reason.

- [ ] **Step 5: Thread `stage` and `previews` through `StorySection`**

In `src/admin/areas/StoryPhotosArea.tsx`, `StorySection` currently takes only `{ registry, restoreDraft }`. Widen it to `{ registry, restoreDraft, stage, previews }`, pass them to `<StoryForm>`, and update the call site in the `StoryPhotosArea` component (which already receives both from `AreaProps`):

```tsx
        <StorySection registry={registry} restoreDraft={restoreDraft} stage={stage} previews={previews} />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/admin/__tests__/StoryForm.test.tsx src/admin/__tests__/panel-snapshots.test.tsx src/admin/__tests__/AdminApp.test.tsx`
Expected: PASS. `panel-snapshots.test.tsx.snap` will need updating for the About panel's new fields — **read the snapshot diff line by line before accepting it.** Phase 3 came within one command of baking a real validation-error banner into an expected snapshot. If the diff contains anything with `role="alert"`, a red class, or the word "Could not load", stop: the fixture is wrong, not the snapshot. Fix `src/admin/__tests__/dashboardFixtures.ts`'s story fixture (it needs a `chef`) rather than accepting the bad output.

- [ ] **Step 7: Prove the tests can fail**

1. Change `CHEF_FIELDS.name.label` to `'Name'` → `shows her name, her role and her photo` fails with `Unable to find a label with the text of: Your name`.
2. Delete the `if (p.field.startsWith('chef.')) return false;` line from the banner filter → `shows a chef problem on the chef's own field, not in the paragraph banner` fails, because the message now renders inside the alert as well.
3. Change the `chefProblems.filter((p) => p.field === 'chef.name')` on the name `Field` to `[]` → the same test fails with the message absent entirely.
4. Change `onChange({ ...value, chef: { ...value.chef, name: next } })` to `onChange({ ...value, chef: { name: next } } as StoryContent)` → `edits her name without disturbing the paragraphs` fails, because the role, portrait and alt are dropped.
5. Change `previewKey` to `'story.json:portrait'` while leaving the `stage` key at `story.json:chef:portrait` → nothing goes red. **Record this honestly:** the two keys are independent strings and no test pins that they match. They do not have to match for correctness (one addresses the preview store, the other the staged-bytes map), which is why this is a note rather than a defect — but do not claim in a comment that they are kept in step, because nothing keeps them in step.

- [ ] **Step 8: Try it in the real dashboard**

Not optional, and not replaceable by the unit tests. Open `/edit/manage/story`, expand **About**, and confirm by hand: the three fields appear above "Paragraph 1"; typing in "Your name" marks the panel unsaved; the help text under "Your photo" is legible; and picking a photo shows a preview rather than a path. This is the non-technical-owner check — **could she do this without being told how?** If the answer is no, fix the labels here, not later.

- [ ] **Step 9: Run the full gate, after staging**

```bash
git add -A
npm run gate
```

- [ ] **Step 10: Commit**

```bash
git add src/admin/fields.ts src/admin/StoryForm.tsx src/admin/areas/StoryPhotosArea.tsx \
        src/admin/__tests__/StoryForm.test.tsx src/admin/__tests__/dashboardFixtures.ts \
        src/admin/__tests__/__snapshots__/panel-snapshots.test.tsx.snap
git commit -m "feat(admin): let her edit her own byline from the About panel she already uses

Three fields at the top of Story & Photos -> About, above the paragraph
list. No new panel, no new area, no rename: it is where the About text
already was, so she does not have to be told where to look.

Second-person labels, which is the only place in fields.ts that happens.
She IS the chef, so 'Chef's name' would make her dashboard talk about her
in the third person.

The photo field's help text says out loud that a new photo takes a couple
of minutes while the words above it are live on publish. That asymmetry is
real -- the prose goes to D1 and the photo goes through the site build --
and she has no other way to find it out.

Chef problems are filtered out of the paragraph banner explicitly. Without
that line 'the About section needs your name' renders inside a box labelled
'Problems with the About section's paragraphs'; there is a test for it."
```

---

### Task 5: Seed D1 with the About document

Nothing flips yet. This task puts a real row in the live database and proves it round-trips, so that Task 6's flip has no moment where the panel 404s. Modelled directly on Phase 2 Task 12, which seeded awards through `wrangler`'s `getPlatformProxy` — binding D1 remotely while leaving KV alone — rather than through raw SQL, so the write goes through the same `D1Store` code the Worker uses.

**Files:**
- Create: `scripts/seed-story-d1.mjs`

**Interfaces:**
- Consumes: the committed `src/content/story.json` from Task 1.
- Produces, consumed by Tasks 6 and 8: a row in D1's `content` table at path `src/content/story.json`, with a `sha` and a `version`.

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-story-d1.mjs`:

```js
// One-off. Writes the committed src/content/story.json into D1 so that
// Phase 4 Task 6's flip -- adding that path to D1_ONLY_PATHS -- never has a
// moment where the dashboard's About panel 404s against an empty table.
//
// Through the real D1Store, not raw SQL, and that is the point: the row it
// writes has to carry the same sha (SHA-256 of the exact body text) and the
// same version the Worker's own write path would produce, or the very first
// publish after the flip gets a 409 it can never clear. Phase 2 Task 12
// seeded awards the same way and the reviewer called it a better proof than
// the brief asked for.
//
// D1 is bound REMOTELY and KV is left alone -- getPlatformProxy's
// experimental remote binding, exactly as Phase 2 used it.
//
//   node scripts/seed-story-d1.mjs
//
// Idempotent in the sense that matters: running it twice writes the same
// body again, which bumps the version and appends one revision row. It does
// not corrupt anything, but do not run it in a loop.
import { readFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { D1Store } from '../worker/d1.ts';

const PATH = 'src/content/story.json';
const body = readFileSync('src/content/story.json', 'utf8');

const { env, dispose } = await getPlatformProxy({
  experimental: { remoteBindings: true },
});

try {
  const store = new D1Store(env.DB);
  const existing = await store.read(PATH);
  if (existing) {
    console.log(`${PATH} already has a row (sha ${existing.sha.slice(0, 12)}…) -- refusing to overwrite it.`);
    console.log('Delete the row by hand first if you really mean to reseed.');
    process.exitCode = 1;
  } else {
    await store.write([{ path: PATH, content: body, encoding: 'utf-8' }], 'seed story.json', `seed-${Date.now()}`);
    const stored = await store.read(PATH);
    if (stored === null) throw new Error('wrote the row and then could not read it back');
    if (stored.content !== body) throw new Error('the row read back does not match the file byte for byte');
    console.log(`seeded ${PATH}: ${body.length} bytes, sha ${stored.sha.slice(0, 12)}…, version ${await store.version(PATH)}`);
  }
} finally {
  await dispose();
}
```

Check `worker/d1.ts`'s actual `D1Store` constructor and `write` signature before running this — the plan quotes `worker/store.ts:49`'s `write(files, message, publishId)` and `worker/d1.ts`'s `new D1Store(env.DB)`, both read off the tree, but confirm rather than trust. If `getPlatformProxy` cannot import a `.ts` module directly in this Node version, run it through `npx tsx` and say so in the commit message.

- [ ] **Step 2: Verify the row does not exist yet**

```bash
npx wrangler d1 execute via-bianca-content --remote --json \
  --command "SELECT path, version, length(body) AS bytes FROM content"
```

Expected: one row, `src/content/awards.json`. If `src/content/story.json` is already there, stop and find out who put it there before writing anything.

- [ ] **Step 3: Seed**

```bash
node scripts/seed-story-d1.mjs
```

Expected: `seeded src/content/story.json: <N> bytes, sha …, version 1`.

- [ ] **Step 4: Verify the row, byte for byte**

```bash
npx wrangler d1 execute via-bianca-content --remote --json \
  --command "SELECT path, version, length(body) AS bytes FROM content" 
```

Expected: two rows. Then confirm the body matches the file exactly:

```bash
node -e "
const { execFileSync } = require('node:child_process');
const raw = execFileSync('npx', ['wrangler','d1','execute','via-bianca-content','--remote','--json','--command',\"SELECT body FROM content WHERE path='src/content/story.json'\"], { encoding: 'utf8' });
const body = JSON.parse(raw)[0].results[0].body;
const file = require('node:fs').readFileSync('src/content/story.json','utf8');
console.log(body === file ? 'IDENTICAL' : 'DIFFERENT');
"
```

Expected: `IDENTICAL`. A difference here means the seed re-serialised the JSON instead of storing the exact text — which would make `sha` disagree with the body the dashboard sends back, and every subsequent publish a 409.

- [ ] **Step 5: Verify the chef block survived the round trip**

```bash
npx wrangler d1 execute via-bianca-content --remote --json \
  --command "SELECT json_extract(body, '\$.chef.name') AS name, json_extract(body, '\$.chef.portrait') AS portrait FROM content WHERE path='src/content/story.json'"
```

Expected: `Kamalika Anand` and `/team/kamalika-anand.webp`.

- [ ] **Step 6: Run the full gate, after staging**

```bash
git add -A
npm run gate
```

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-story-d1.mjs
git commit -m "chore(d1): seed src/content/story.json into D1 ahead of the flip

Written through the real D1Store rather than raw SQL, so the row carries
the same sha (SHA-256 of the exact body text) and version the Worker's own
write path produces. A hand-inserted row with a re-serialised body would
make sha disagree with what the dashboard sends back, and every publish
after the flip a 409 nobody could clear.

Verified against the live database: the stored body is byte-identical to
the committed file, and json_extract reads the chef block back intact.

The script refuses to overwrite an existing row rather than reseeding
blindly."
```

---

### Task 6: Route `story.json` to D1

The flip. After this task the dashboard reads and writes About through D1, the public read path serves it, and the Worker carries a snapshot fallback for it.

**Files:**
- Modify: `worker/store.ts:62` (`D1_ONLY_PATHS`)
- Modify: `worker/published.ts:22-24` (`PUBLIC_FILES`)
- Modify: `worker/snapshot.ts` — **regenerated**, never hand-edited
- Modify: `worker/__tests__/store.test.ts`
- Modify: `worker/__tests__/published.test.ts`
- Modify: `worker/__tests__/github.test.ts`

**Interfaces:**
- Consumes: the seeded D1 row from Task 5.
- Produces, consumed by Task 7: the public endpoint `GET /api/published?path=story.json`, returning the story document as JSON with `x-content-source: d1 | cache | snapshot`.

- [ ] **Step 1: Write the failing tests**

In `worker/__tests__/store.test.ts`, find the exact-membership pin on `D1_ONLY_PATHS` (Phase 2 Task 3's fix round made it a `toEqual` on the full array, so growing the set fails it) and update it, adding the new case:

```ts
  // Phase 4: the second D1-only path. story.json is different from
  // awards.json in one way worth pinning -- it IS still a real file under
  // src/content/ (git ls-files finds it, assets.test.ts walks it), it is
  // just no longer the file the site writes to. So this set is now "paths
  // whose live copy lives in D1", not "paths with no file behind them".
  it('routes exactly the two D1-only paths to D1, regardless of CONTENT_STORE', () => {
    expect([...D1_ONLY_PATHS].sort()).toEqual(['src/content/awards.json', 'src/content/story.json']);
  });

  it.each([undefined, 'github'])('sends story.json to D1 even when CONTENT_STORE is %s', (setting) => {
    const env = { ...ENV, CONTENT_STORE: setting };
    expect(storeFor(env as StoreEnv, 'src/content/story.json').name).toBe('d1');
  });

  // The other nine files must NOT have moved. This loop runs
  // unconditionally with no `continue` narrowing it -- Phase 2's review
  // found the original version exempted precisely the entries that would
  // have broken the default, so seven files could be moved to D1 with the
  // whole worker suite green.
  it('leaves every other content file on GitHub by default', () => {
    for (const name of contentFilesOnDisk()) {
      const path = `src/content/${name}`;
      if (D1_ONLY_PATHS.has(path)) continue;
      expect(storeFor(ENV, path).name).toBe('github');
    }
  });
```

Read the existing file before writing this — it already has a `contentFilesOnDisk`-shaped helper built on `readdirSync` (Phase 2 Task 3's fix round replaced a hand-copied list with one). Reuse whatever is actually there; do not add a third copy of the file list.

In `worker/__tests__/published.test.ts`, mirror the existing awards cases for story:

```ts
  it('serves story.json from D1', async () => {
    const db = fakeD1({ 'src/content/story.json': { body: STORY_BODY, sha: 'abc', version: 4 } });
    const response = await handlePublished(new Request('https://x/api/published?path=story.json'), { DB: db }, cache);
    expect(response.status).toBe(200);
    expect(response.headers.get(CONTENT_SOURCE_HEADER)).toBe('d1');
    expect(await response.text()).toBe(STORY_BODY);
  });

  // The spec's own testing requirement: force a query failure and assert
  // the snapshot serves. A database problem must cost freshness, never
  // availability -- and About is now the section whose entire body is on
  // the other side of that call.
  it('falls back to the snapshot when the D1 version read throws', async () => {
    const db = failingD1();
    const response = await handlePublished(new Request('https://x/api/published?path=story.json'), { DB: db }, cache);
    expect(response.status).toBe(200);
    expect(response.headers.get(CONTENT_SOURCE_HEADER)).toBe('snapshot');
    expect(JSON.parse(await response.text())).toMatchObject({ heading: expect.any(String) });
  });

  it('still refuses a path that is not in the allowlist', async () => {
    const db = fakeD1({});
    const response = await handlePublished(new Request('https://x/api/published?path=site.json'), { DB: db }, cache);
    expect(response.status).toBe(404);
  });
```

Use the file's own existing doubles (`fakeD1`, `failingD1`/`failWith`/`failAfter` — Phase 2 Task 7 added `failAfter` specifically because `failWith` only ever reached the first D1 call). Read them before writing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run worker/__tests__/store.test.ts worker/__tests__/published.test.ts`
Expected: FAIL — the membership pin fails with `expected [ 'src/content/awards.json' ] to deeply equal [ 'src/content/awards.json', 'src/content/story.json' ]`, the routing case reports `github`, and every published case 404s because `story.json` is not in `PUBLIC_FILES`.

- [ ] **Step 3: Flip the two allowlists**

`worker/store.ts`:

```ts
// Paths whose LIVE copy lives in D1, regardless of CONTENT_STORE.
//
// src/content/awards.json has never been a file in this repository and
// never will be: Awards is built on D1 from the start rather than as a JSON
// file that would need migrating two months later (the spec's own words,
// Phase 4).
//
// src/content/story.json (Phase 4) is the different case, and the
// difference matters: the file still EXISTS in the repository and is still
// compiled into the bundle. It is no longer what the site writes to -- it
// is the first-paint fallback OurStory.tsx renders before its runtime fetch
// resolves, and it is what keeps the chef portrait's path inside
// src/content/__tests__/assets.test.ts's walk, which cannot see D1 at all.
// scripts/sync-story-fallback.mjs is what stops that copy drifting.
export const D1_ONLY_PATHS: ReadonlySet<string> = new Set([
  'src/content/awards.json',
  'src/content/story.json',
]);
```

`worker/published.ts`:

```ts
export const PUBLIC_FILES: ReadonlyMap<string, string> = new Map([
  ['awards.json', 'src/content/awards.json'],
  // Phase 4. Unlike awards.json, this document's body is the entire visible
  // content of a homepage section rather than a list beside chrome that
  // renders without it -- so OurStory.tsx paints the compiled-in copy
  // first and swaps this one in when it arrives, instead of rendering
  // nothing until it does.
  ['story.json', 'src/content/story.json'],
]);
```

- [ ] **Step 4: Regenerate the snapshot**

```bash
node scripts/build-snapshot.mjs
```

Expected: `snapshot: 2 document(s), built <timestamp>`. **Do not hand-edit `worker/snapshot.ts`** — it carries a GENERATED / do-not-edit header for a reason. Confirm the regenerated file contains a `story.json` entry with a real body and a version, and that `SNAPSHOT_BUILT_AT` moved.

Then confirm the snapshot is not stale, the way Phase 2 Task 12 did — compare the recorded version against a live read rather than assuming the generator was honest:

```bash
npx wrangler d1 execute via-bianca-content --remote --json \
  --command "SELECT path, version FROM content" 
```

Every `version` here must equal the corresponding `snapshotVersionFor` value in the regenerated file. A mismatch means something wrote between the two commands.

- [ ] **Step 5: Correct the `github.test.ts` list and its prose**

`worker/__tests__/github.test.ts`'s `it.each` enumerates the `validateContent`-recognised content files, describing itself as every one of them except the deliberately D1-backed `awards.json`. `story.json` is now D1-backed too. Remove it from the list and correct the surrounding comment to name both exclusions and why. The nearby prose that says "nine real files" is off by two and has been since Phase 3 — fix that number in the same sweep; it is one line and it is in the block you are already editing.

`commitFiles`' own path allowlist is deliberately **not** narrowed: it still accepts `src/content/story.json`, because nothing routes a write there any more and removing a path from a security allowlist that nothing exercises is a change with no test behind it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run worker/`
Expected: PASS, every worker test.

- [ ] **Step 7: Check what else moved**

Run the whole suite and read the failures rather than assuming there are none:

Run: `npm run test:deploy`

Specifically expected to still be green, and each one is worth checking by name because each is a place the flip could have leaked:
- `src/admin/__tests__/content.test.ts` — `CONTENT_FILES` is derived from `git ls-files src/content` plus `awards.json`. `story.json` is still a tracked file, so **nothing changes here**. If this goes red, something deleted the file.
- `e2e/edit-backend.ts` — still lists `story.json`, correctly: it is a real repo file the e2e backend serves, unlike `awards.json` whose absence there encodes its D1-404 state. **Do not remove it.**
- `src/content/__tests__/assets.test.ts` — still walks `story.json` and still resolves the portrait. This is D3's whole argument; confirm it by running it.
- `src/admin/__tests__/areas.test.tsx` — the About panel already exists and already maps to `story.json`. No panel-completeness change.

- [ ] **Step 8: Prove the tests can fail**

1. Remove `'src/content/story.json'` from `D1_ONLY_PATHS` → the membership pin and both routing cases fail.
2. Add `'src/content/site.json'` to `D1_ONLY_PATHS` → the membership pin fails **and** the leaves-every-other-file-on-GitHub loop fails. Run this one specifically: it is the mutation that Phase 2's original test could not catch, because a `continue` exempted exactly the entries that would break the default.
3. Remove the `story.json` entry from `PUBLIC_FILES` → all three published cases fail with 404.
4. Make `snapshotFor` return `null` for `story.json` → `falls back to the snapshot when the D1 version read throws` fails with a 404 instead of a 200.

- [ ] **Step 9: Run the full gate, after staging**

```bash
git add -A
npm run gate
```

- [ ] **Step 10: Commit**

```bash
git add worker/store.ts worker/published.ts worker/snapshot.ts \
        worker/__tests__/store.test.ts worker/__tests__/published.test.ts worker/__tests__/github.test.ts
git commit -m "feat(d1): route src/content/story.json to D1 and serve it from the public read path

The second D1-only path, and it differs from awards.json in a way the
comment now spells out: the file still exists in the repository and is
still compiled into the bundle. It is no longer what the site writes to --
it is the first-paint fallback, and it is what keeps the chef portrait's
path inside assets.test.ts's walk, which cannot see D1.

The dashboard needed no change at all. storeFor routes the read and the
write, CONTENT_FILES already listed story.json, and the About panel does
not know which store answered -- which is the Phase 2 seam working as
designed rather than a happy accident.

github.test.ts's it.each described itself as every content file except the
deliberately D1-backed awards.json; story.json now belongs in that
exclusion too, and leaving it in would have made the comment beside it
false. Its stale 'nine real files' count, off by two since Phase 3, is
fixed in the same block.

Snapshot regenerated from live D1 (2 documents) and its recorded versions
checked against a live read, not assumed."
```

---

### Task 7: About reads its live copy from D1

**Files:**
- Create: `src/components/story-api.ts`
- Create: `src/components/__tests__/story-api.test.ts`
- Modify: `src/components/OurStory.tsx`
- Modify: `src/components/__tests__/OurStory.test.tsx`

**Interfaces:**
- Consumes: `GET /api/published?path=story.json` from Task 6; `ChefIntro`/`StoryContent` from Task 1.
- Produces: `STORY_ENDPOINT`, `isStoryContent(value: unknown): value is StoryContent`, `fetchStory(fetchImpl?: typeof fetch): Promise<StoryContent | null>`, and `OurStoryProps { fetchImpl?: typeof fetch }`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/story-api.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { STORY_ENDPOINT, fetchStory, isStoryContent } from '../story-api';
import type { StoryContent } from '../../content/types';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const LIVE: StoryContent = {
  heading: 'About',
  paragraphs: ['A live paragraph, edited from the dashboard.'],
  chef: {
    name: 'Kamalika Anand',
    role: 'Chef and owner',
    portrait: '/team/kamalika-anand.webp',
    portraitAlt: 'Chef Kamalika Anand',
  },
};

describe('fetchStory', () => {
  it('requests the public read path and returns the parsed document', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, LIVE));
    expect(await fetchStory(fetchImpl as unknown as typeof fetch)).toEqual(LIVE);
    expect(fetchImpl).toHaveBeenCalledWith(STORY_ENDPOINT);
  });

  it('throws on a non-ok response, naming the status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { message: 'nope' }));
    await expect(fetchStory(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/status 503/);
  });

  // Everything below is the shape check, and it matters more here than it
  // did for awards: a malformed award is one missing card, a malformed
  // story is the whole section replaced with nothing. `null` means "keep
  // what you already have", never "render this".
  it('returns null for a body that is not an object', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, 'About'));
    expect(await fetchStory(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('returns null for an array, which JSON.parse would happily hand back', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, []));
    expect(await fetchStory(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it.each([
    ['no heading', { ...LIVE, heading: undefined }],
    ['a numeric heading', { ...LIVE, heading: 7 }],
    ['no paragraphs', { ...LIVE, paragraphs: undefined }],
    ['an empty paragraph list', { ...LIVE, paragraphs: [] }],
    ['a non-string inside paragraphs', { ...LIVE, paragraphs: ['ok', 3] }],
    ['no chef at all', { heading: LIVE.heading, paragraphs: LIVE.paragraphs }],
    ['a chef with no name', { ...LIVE, chef: { ...LIVE.chef, name: undefined } }],
    ['a chef with no portrait', { ...LIVE, chef: { ...LIVE.chef, portrait: undefined } }],
    ['a chef with a numeric portraitAlt', { ...LIVE, chef: { ...LIVE.chef, portraitAlt: 0 } }],
  ])('returns null for %s', async (_name, body) => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, body));
    expect(await fetchStory(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  // An off-site portrait must not be rendered just because the shape is
  // right. validateStory refuses it at the write boundary, but this body
  // comes from a database and a shape check that only looks at TYPES would
  // pass a URL straight into a homepage <img src>.
  it.each(['https://evil.example/x.webp', '//evil.example/x.webp', 'team/x.webp'])(
    'returns null for a portrait that is not a site-relative path: %s',
    async (portrait) => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { ...LIVE, chef: { ...LIVE.chef, portrait } }));
      expect(await fetchStory(fetchImpl as unknown as typeof fetch)).toBeNull();
    },
  );

  it('accepts an extra key it does not know about, rather than rejecting the whole document', () => {
    expect(isStoryContent({ ...LIVE, somethingNew: true })).toBe(true);
  });
});
```

Append to `src/components/__tests__/OurStory.test.tsx`:

```tsx
  describe('the live copy from D1', () => {
    const LIVE = {
      heading: 'About Via Bianca',
      paragraphs: ['A paragraph she edited five seconds ago.'],
      chef: {
        name: 'K. Anand',
        role: 'Chef, owner, and pasta maker',
        portrait: '/team/kamalika-anand.webp',
        portraitAlt: 'A different description',
      },
    };

    function jsonResponse(body: unknown): Response {
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    it('paints the compiled-in copy before the fetch resolves', () => {
      // A promise that never settles: whatever renders here is what a
      // visitor sees at first paint, which for this section must never be
      // nothing.
      const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
      render(<OurStory fetchImpl={fetchImpl as unknown as typeof fetch} />);
      expect(screen.getByText(story.paragraphs[0])).toBeInTheDocument();
      expect(screen.getByTestId('chef-byline')).toHaveTextContent(story.chef.name);
    });

    it('swaps in the live copy when it arrives', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(LIVE));
      render(<OurStory fetchImpl={fetchImpl as unknown as typeof fetch} />);
      expect(await screen.findByText(LIVE.paragraphs[0])).toBeInTheDocument();
      expect(screen.getByText(LIVE.heading)).toBeInTheDocument();
      expect(screen.getByTestId('chef-portrait')).toHaveAttribute('alt', LIVE.chef.portraitAlt);
      expect(screen.queryByText(story.paragraphs[0])).toBeNull();
    });

    it('keeps the compiled-in copy when the response is malformed', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ heading: 'Broken' }));
      render(<OurStory fetchImpl={fetchImpl as unknown as typeof fetch} />);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      expect(screen.getByText(story.paragraphs[0])).toBeInTheDocument();
      expect(screen.queryByText('Broken')).toBeNull();
    });

    it('keeps the compiled-in copy, and shows no error, when the fetch fails outright', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error('offline');
      });
      render(<OurStory fetchImpl={fetchImpl as unknown as typeof fetch} />);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      expect(screen.getByText(story.paragraphs[0])).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    // The carousel comes from galleries.json, which did not move. A D1
    // document must not be able to change the photos, and this pins that
    // the two are independent rather than merely happening not to interact.
    it('does not let the live copy touch the carousel', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(LIVE));
      const { container } = render(<OurStory fetchImpl={fetchImpl as unknown as typeof fetch} />);
      await screen.findByText(LIVE.paragraphs[0]);
      const carousel = container.querySelector('[data-testid="our-story-carousel"]') as HTMLElement;
      expect(within(carousel).getAllByRole('img')).toHaveLength(galleries.ourStory.length);
    });
  });
```

Add `vi` and `waitFor` to that file's imports.

**Before writing a line of the implementation, re-check the four tests Task 2 left in this file.** `renders every paragraph`, `carousel images come from content`, and both byline tests now render a component that fetches. With the real global `fetch` in jsdom, a relative URL is rejected — which is the same reason `Awards.tsx`'s own comment gives for its swallowed catch — so they will keep passing against the compiled-in copy. That is correct, but it means those four tests now silently exercise the *fallback* path. Say so in a comment above them, so nobody later reads them as proving the D1 path.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/__tests__/story-api.test.ts src/components/__tests__/OurStory.test.tsx`
Expected: FAIL — `Failed to resolve import "../story-api"`, and the `OurStory` tests fail on the unknown `fetchImpl` prop.

- [ ] **Step 3: Write `story-api.ts`**

```ts
// Phase 4's runtime read for the About section, split out of OurStory.tsx
// for the same reason awards-api.ts is split out of Awards.tsx: eslint's
// react-refresh/only-export-components flags a .tsx file that exports both
// a component and plain values.
//
// The shape check is stricter than isAward's, and deliberately so. A
// malformed award is one missing card in a grid; a malformed story is the
// entire visible content of a homepage section. So this returns `null` --
// "keep whatever you already have" -- for anything it is not completely
// sure about, and the component treats `null` as "the compiled-in copy
// stands", never as "render nothing".
//
// It also checks the portrait's SHAPE, not just its type. validateStory
// refuses an off-site path at the write boundary, but this body arrives
// from a database at runtime with no build-time guard in front of it, and a
// type-only check would put an attacker-supplied URL straight into a
// homepage <img src>. Same posture as validate.ts's isUnsafeAssetPath,
// re-implemented here rather than imported: src/content/validate.ts is the
// Worker's module and does not export it.
import type { StoryContent } from '../content/types';

export const STORY_ENDPOINT = '/api/published?path=story.json';

function isSiteRelativeAssetPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('..');
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isStoryContent(value: unknown): value is StoryContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { heading, paragraphs, chef } = value as Record<string, unknown>;
  if (!isNonBlankString(heading)) return false;
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return false;
  if (!paragraphs.every(isNonBlankString)) return false;
  if (!chef || typeof chef !== 'object' || Array.isArray(chef)) return false;
  const { name, role, portrait, portraitAlt } = chef as Record<string, unknown>;
  return (
    isNonBlankString(name) &&
    isNonBlankString(role) &&
    isSiteRelativeAssetPath(portrait) &&
    isNonBlankString(portraitAlt)
  );
}

// `fetchImpl` is injected with a default, the same posture fetchAwards,
// requestPublish and fetchBuildStatus already take -- what lets a test hand
// this a fake without stubbing the global.
export async function fetchStory(fetchImpl: typeof fetch = fetch): Promise<StoryContent | null> {
  const response = await fetchImpl(STORY_ENDPOINT);
  if (!response.ok) throw new Error(`the About section is unavailable (status ${response.status})`);
  const parsed: unknown = await response.json();
  return isStoryContent(parsed) ? parsed : null;
}
```

- [ ] **Step 4: Wire it into `OurStory`**

```tsx
export interface OurStoryProps {
  fetchImpl?: typeof fetch;
}

const OurStory: React.FC<OurStoryProps> = ({ fetchImpl = fetch }: OurStoryProps = {}) => {
  const content = useContent();
  const { galleries } = content;
  // The compiled-in copy is the INITIAL value, not a placeholder: it is
  // real, valid, published content, and it is what a crawler, a reader with
  // JS off, and every first paint see. The fetch below replaces it only
  // when a fully shape-checked document arrives, so a database outage, a
  // malformed row or an offline visitor all degrade to "slightly older
  // prose" rather than to an empty section.
  //
  // About is the eighth of nine homepage sections, well below the fold, so
  // in practice the swap has happened long before anyone scrolls to it.
  // Said plainly rather than sold: a reader already sitting on this section
  // when she publishes an edit could see a word change under them.
  const [story, setStory] = useState(content.story);
  const [currentIndex, setCurrentIndex] = useState(0);
  const reduceMotion = usePrefersReducedMotion();
  const { chef } = story;

  useEffect(() => {
    let cancelled = false;
    fetchStory(fetchImpl)
      .then((live) => {
        if (!cancelled && live !== null) setStory(live);
      })
      .catch(() => {
        // The compiled-in copy stands -- nothing rendered here, on purpose,
        // and never an error message a visitor can see.
      });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);
```

Then add `data-testid="our-story-carousel"` (already added in Task 2) and leave the rest of the render untouched; it already reads from the `story` binding.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/__tests__/story-api.test.ts src/components/__tests__/OurStory.test.tsx src/test/homepage-bytes.test.tsx`
Expected: PASS. `homepage-bytes` should be **unchanged** — the fetch adds no markup. If the number moved, something rendered differently and you need to know why before you touch the pin.

- [ ] **Step 6: Prove the tests can fail**

1. Change `if (!cancelled && live !== null)` to `if (!cancelled)` and have `fetchStory` return the raw parsed value → `keeps the compiled-in copy when the response is malformed` fails, because `{heading: 'Broken'}` renders.
2. Delete the `isSiteRelativeAssetPath` check from `isStoryContent` → all three off-site-portrait rows fail.
3. Change `paragraphs.length === 0` to `paragraphs.length < 0` → `an empty paragraph list` fails.
4. Change `useState(content.story)` to `useState<StoryContent | null>(null)` and render nothing while null → `paints the compiled-in copy before the fetch resolves` fails. **Run this one specifically**: it is the whole reason this design is fallback-then-swap rather than a copy of Awards.
5. Delete the `.catch()` → `keeps the compiled-in copy, and shows no error, when the fetch fails outright` fails with an unhandled rejection.
6. Have the effect also call `setCurrentIndex(0)` on every resolve → nothing fails. Note it: the carousel index is not pinned against the fetch, and it does not need to be, because a reset to 0 is not a defect. Do not add a test for it.

- [ ] **Step 7: Confirm the behaviour against the live Worker**

Not optional. The unit tests inject a fake; nothing so far has proved the real endpoint answers.

```bash
curl -sD - 'https://vb.aionxxxi.uk/api/published?path=story.json' -o /tmp/story.json | grep -i 'x-content-source\|cache-control\|etag'
head -c 200 /tmp/story.json
curl -sD - 'https://vb.aionxxxi.uk/api/published?path=story.json' -o /dev/null | grep -i 'x-content-source'
```

Expected: the first call returns `x-content-source: d1`, `cache-control: public, max-age=60` and an `ETag`; the body is the story document; the second returns `x-content-source: cache`. **This only works after Task 8 deploys the Worker** — if you are running Task 7 before that deploy, the endpoint 404s, which is correct, and this step moves into Task 8. Say which happened.

- [ ] **Step 8: Run the full gate, after staging**

```bash
git add -A
npm run gate
```

- [ ] **Step 9: Commit**

```bash
git add src/components/story-api.ts src/components/__tests__/story-api.test.ts \
        src/components/OurStory.tsx src/components/__tests__/OurStory.test.tsx
git commit -m "feat(about): read the live About copy from D1, over the compiled-in fallback

Fallback-then-swap, not fetch-and-render, and the difference is the whole
design. Awards can fetch its list because its heading and intro live in
copy.json and paint without it; About has no chrome/entry split -- the
prose IS the section -- so rendering nothing until D1 answers would give a
crawler, a reader with JS off, and every first paint an empty section.

The shape check is stricter than isAward's on purpose: a malformed award is
one missing card, a malformed story is a whole section. Anything it is not
certain about returns null, which means 'keep what you have'. It also
checks the portrait is site-relative rather than merely a string -- this
body comes from a database at runtime with no build-time guard, and a
type-only check would put an arbitrary URL into a homepage img src.

Six mutations run. The one that matters most: making the initial state null
reddens 'paints the compiled-in copy before the fetch resolves', which is
the assertion this design exists for."
```

---

### Task 8: Keep the fallback honest, deploy, and verify

**Files:**
- Create: `scripts/sync-story-fallback.mjs`
- Create: `scripts/__tests__/sync-story-fallback.test.mjs`
- Modify: `docs/cloudflare-cutover.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

The drift D3 accepted: after Task 6, publishes write D1 and never `src/content/story.json`, so the committed copy freezes. It is still the first-paint content, still what a crawler reads, and still the only thing keeping the portrait inside `assets.test.ts`'s walk. This closes it the same way `scripts/build-snapshot.mjs` closes the Worker's own fallback — a script a human runs before a deploy that matters, not a build step. **Deliberately not a build step:** making it one would put an authenticated network call on Cloudflare Pages' build path, where a transient failure fails a deploy of unrelated code, on a build system this project has already recorded as intermittently flaky.

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/sync-story-fallback.test.mjs`. The script's network call is not testable here; its *transform* is, so split the transform out and test that:

```js
import { describe, it, expect } from 'vitest';
import { storyFileFromRow } from '../sync-story-fallback.mjs';

describe('storyFileFromRow', () => {
  const BODY = JSON.stringify({
    heading: 'About',
    paragraphs: ['One.'],
    chef: { name: 'K', role: 'Chef', portrait: '/team/kamalika-anand.webp', portraitAlt: 'K' },
  });

  it('reformats the stored body as the repository formats its JSON', () => {
    const written = storyFileFromRow({ body: BODY });
    expect(written).toBe(`${JSON.stringify(JSON.parse(BODY), null, 2)}\n`);
    expect(written.endsWith('\n')).toBe(true);
  });

  // The refusal that matters: writing an unparseable or wrong-shaped body
  // into src/content/story.json would break `tsc -b` at import time and
  // block every subsequent deploy, including the one that would fix it.
  it.each([
    ['unparseable JSON', { body: '{' }],
    ['an array', { body: '[]' }],
    ['a document with no chef', { body: JSON.stringify({ heading: 'A', paragraphs: ['x'] }) }],
    ['a document with no paragraphs', { body: JSON.stringify({ heading: 'A', chef: {} }) }],
  ])('refuses to write %s', (_name, row) => {
    expect(() => storyFileFromRow(row)).toThrow();
  });

  it('refuses a missing row rather than writing an empty file', () => {
    expect(() => storyFileFromRow(undefined)).toThrow(/no row/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/__tests__/sync-story-fallback.test.mjs`
Expected: FAIL — `Failed to resolve import "../sync-story-fallback.mjs"`.

- [ ] **Step 3: Write the script**

```js
// Writes the LIVE D1 copy of the About document back into the committed
// src/content/story.json.
//
// Why that file still exists at all after Phase 4 moved this document to
// D1, and why it must not be allowed to rot:
//   - it is what OurStory.tsx paints at first paint, before its runtime
//     fetch resolves, and what a crawler or a reader with JS off sees;
//   - it is the only thing that keeps the chef portrait's path inside
//     src/content/__tests__/assets.test.ts's walk, which cannot see D1 --
//     the same accepted hole awards.json sits in, closed here instead;
//   - src/content/__tests__/sections.test.tsx derives its About marker from
//     the compiled-in heading.
//
// Run by a human before a deploy that matters, alongside
// scripts/build-snapshot.mjs:
//   node scripts/sync-story-fallback.mjs
//
// NOT a build step, for the same reason build-snapshot.mjs is not: an
// authenticated network call on Cloudflare Pages' build path means a
// transient failure fails a deploy of unrelated code, and Pages builds in
// this project are already intermittently flaky enough that three
// consecutive builds once failed on unchanged, working source.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DB = 'via-bianca-content';
const PATH = 'src/content/story.json';

// Exported so scripts/__tests__/sync-story-fallback.test.mjs can exercise
// the part that can actually go wrong without a network call. Throws rather
// than writing anything it is unsure about: an unparseable or wrong-shaped
// body written into src/content/story.json breaks `tsc -b` at import time
// and blocks every subsequent deploy -- including the one that would fix
// it.
export function storyFileFromRow(row) {
  if (!row || typeof row.body !== 'string') {
    throw new Error(`no row for ${PATH} in D1 -- refusing to write an empty fallback`);
  }
  const parsed = JSON.parse(row.body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('the stored body is not a JSON object -- refusing to write it');
  }
  if (!Array.isArray(parsed.paragraphs) || parsed.paragraphs.length === 0) {
    throw new Error('the stored body has no paragraphs -- refusing to write it');
  }
  if (!parsed.chef || typeof parsed.chef !== 'object') {
    throw new Error('the stored body has no chef block -- refusing to write it');
  }
  // Reformatted rather than written verbatim: the stored body is exactly
  // what the dashboard sent, which is minified, and a minified
  // src/content/story.json would produce an unreadable diff on every sync.
  // The D1 row keeps the byte-exact text; this file is the human-readable
  // mirror of it.
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

if (import.meta.filename === process.argv[1]) {
  const raw = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB, '--remote', '--json',
    '--command', `SELECT body FROM content WHERE path='${PATH}'`,
  ], { encoding: 'utf8' });
  const row = JSON.parse(raw)[0]?.results?.[0];
  writeFileSync(PATH, storyFileFromRow(row));
  console.log(`${PATH} synced from live D1`);
}
```

`import.meta.filename === process.argv[1]`, not a comparison against `import.meta.url`: `import.meta.url` is percent-encoded and would silently never match on a checkout path containing a space. `scripts/images.mjs` documents this at length; copy the working form, not the broken one.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/__tests__/sync-story-fallback.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run it for real, and confirm it is a no-op right now**

```bash
node scripts/sync-story-fallback.mjs
git diff --stat src/content/story.json
```

Expected: **no diff.** D1 was seeded from this exact file in Task 5 and nothing has published since, so a non-empty diff means the reformat is not idempotent — fix the formatting, do not commit the churn.

- [ ] **Step 6: Prove the test can fail**

1. Remove the `Array.isArray(parsed)` clause → `refuses to write an array` fails.
2. Change the trailing `\n` to `''` → `reformats the stored body` fails on the newline assertion.
3. Change `JSON.stringify(parsed, null, 2)` to `row.body` → the reformat assertion fails.
4. Remove the `!row` guard → `refuses a missing row` fails with a `TypeError` instead of the named error.

- [ ] **Step 7: Document both scripts**

In `docs/cloudflare-cutover.md`, add to the pre-deploy section:

```markdown
### Before a deploy that matters

Two documents now live in D1 (`src/content/awards.json` and
`src/content/story.json`), and two committed artefacts mirror them. Neither
is regenerated by the build, deliberately — both call an authenticated
network API, and a transient failure on Cloudflare's builder would fail a
deploy of unrelated code.

    node scripts/build-snapshot.mjs        # worker/snapshot.ts -- the Worker's outage fallback
    node scripts/sync-story-fallback.mjs   # src/content/story.json -- the browser's first-paint fallback

`build-snapshot.mjs` refuses to write an empty snapshot;
`sync-story-fallback.mjs` refuses to write a body it cannot parse or that
has no paragraphs or no chef block. Both failures are loud, because a
silently-stale fallback serves HTTP 200 and reads to a visitor as "this is
the content", not as a failure.
```

- [ ] **Step 8: Run the full gate, after staging**

```bash
git add -A
npm run gate
```

Expected: exit 0. Note the exact numbers: `npm run build` exit code, the entry CSS size, the vitest file/test counts, tsc and eslint.

- [ ] **Step 9: Commit**

```bash
git add scripts/sync-story-fallback.mjs scripts/__tests__/sync-story-fallback.test.mjs docs/cloudflare-cutover.md
git commit -m "chore(about): sync the committed story.json fallback from live D1

After the flip, publishes write D1 and never the file -- so the copy that
paints first, that a crawler reads, and that keeps the chef portrait inside
assets.test.ts's walk would freeze at whatever it held on the day of the
flip. This is what stops that, run by a human before a deploy that matters,
alongside build-snapshot.mjs.

Not a build step, for the same documented reason build-snapshot.mjs is not:
an authenticated network call on Cloudflare Pages' build path means a
transient failure fails a deploy of unrelated code.

It refuses to write a body it cannot parse, an array, or a document missing
paragraphs or the chef block. Writing any of those into src/content/
story.json breaks tsc -b at import time and blocks every subsequent deploy,
including the one that would fix it.

Verified idempotent against the real database: running it now produces no
diff."
```

- [ ] **Step 10: Deploy the Worker**

**This step changes the live site's API and belongs to whoever is watching, not to a background agent.** `wrangler deploy` replaces the Worker serving `/api/*`; if it is wrong, the owner's dashboard stops working and the failure is invisible until she tries to publish. Record the current version first so a rollback is one command:

```bash
npx wrangler deployments list   # write down the current version id as the ROLLBACK POINT
npx wrangler deploy
```

Then verify immediately, against production:

```bash
curl -sD - 'https://vb.aionxxxi.uk/api/published?path=story.json' -o /tmp/story.json | grep -i 'x-content-source\|cache-control\|etag'
curl -sD - 'https://vb.aionxxxi.uk/api/published?path=story.json' -o /dev/null | grep -i 'x-content-source'
curl -s -o /dev/null -w '%{http_code}\n' 'https://vb.aionxxxi.uk/api/published?path=site.json'
curl -s -o /dev/null -w '%{http_code}\n' 'https://vb.aionxxxi.uk/api/published?path=awards.json'
```

Expected: `d1` then `cache` on the story path; `404` for `site.json` (the allowlist still holds); `200` for `awards.json` (nothing regressed). The parameter is `?path=`, not `?file=` — a 404 on `?file=` is correct behaviour, not a fault.

- [ ] **Step 11: Push, and verify the site**

```bash
git push        # the pre-push hook runs the full gate including npm run build
npm run verify:deploy
```

Then, in a real browser: load `/`, scroll to About, and confirm the byline renders with the portrait at both 1280 and 390. Open `/edit/manage/story`, change one word in a paragraph, publish, and confirm the change is live on the homepage **without a Pages build** — that is the entire point of this phase and nothing above proves it.

If the Cloudflare Pages build fails, the live site is unchanged and safe. The known-bad diagnosis path: Cloudflare's log API caps at 1000 lines and returns the **first** 1000, so read the stage timings (`npm run images` ≈ 27s, `test:deploy` ≈ 129s, `build` ≈ 184s on their builder) to localise the failure before guessing at a cause.

---

## Self-review

**Spec coverage.** Every sentence of the spec's Phase 4:

| Spec | Where |
| --- | --- |
| "Awards becomes its own homepage section… She adds entries herself" | Already shipped in Phase 2. Verified in the table at the top; no task. |
| "About already holds the six Our Story paragraphs after Phase 1's rename" | True at `main`; `src/content/story.json` has six, `heading` is "About". No task. |
| "Phase 4 adds Kamalika's personal introduction and portrait" | Tasks 1-4. Resolved as a byline rather than new prose (conflict 3). |
| "and moves the whole section onto D1" | Tasks 5-8. Scoped to the prose; the gallery is argued out in conflict 7. |
| "Awards is built on D1 from the start rather than as a JSON file" | Already true. |
| Testing: "D1 read path gets a test that forces a query failure and asserts the snapshot fallback serves" | Task 6, Step 1. |
| Testing: "every test must be able to fail, verified by mutating the code" | Every task has an explicit mutation step naming the expected failure. |
| Testing: "jsdom has no layout engine, so any claim about rendering… goes in e2e/" | Task 3. |
| Testing: "Contrast ratios… asserted numerically" | Task 3, Step 2. |
| Risks: "Free tier limits are asserted from memory" | Closed in Phase 2 against live docs; restated in Global Constraints with the verified numbers. |
| Risks: "The write path replaces a working one… keep the GitHub path functional" | Task 6 changes two allowlists and nothing in `worker/github.ts`; the flip is one line to reverse. |
| Open items: "a portrait of Kamalika" | Already in the tree (conflict 4). |
| Open items: Sitka VF Italic, the favicon rework | Deferred, out of Phase 4, blocking nothing. Note for whoever picks it up: the Phase 3 ledger records `SitkaVF-Italic.ttf` sitting in Drive at file id `1driHHKDkQD0E0yX0gwIdAYv55IIp3SX2`. |

**Not covered, and deliberately:** the spec's Phase 5 (blog), Phase 6 (Drive refresh), the `CONTENT_STORE` flip for the remaining ten files, and the seven Minors deferred from Phase 3's final review. None is Phase 4's.

**Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling", no reference to a type or function not defined in a task or read off the tree. Two places deliberately say "read the existing file first" rather than quoting code: `worker/__tests__/published.test.ts`'s D1 doubles and `e2e/brand-contrast.spec.ts`'s contrast helper — in both cases quoting a signature this plan has not verified line by line would be worse than sending the implementer to the source.

**Type consistency.** `ChefIntro` is declared once (Task 1) and used by the same name in Tasks 2, 4 and 7. `chef.portrait` / `chef.portraitAlt` / `chef.name` / `chef.role` are spelled identically in the type, the JSON, the validator's problem fields, `CHEF_FIELDS`, `StoryForm`'s filters and `isStoryContent`. `fetchStory` returns `StoryContent | null` in its declaration, its tests and its one call site. The staged-photo key `story.json:chef:portrait` appears twice and matches.

## Known limits, recorded rather than hidden

1. **The jsdom byline tests cannot distinguish `{chef.portrait}` from a hardcoded string**, because the committed value and the literal are the same today. Task 4's edit test and Task 7's swap test are what actually prove the value is content-driven. (Task 2, Step 7, mutation 4.)
2. **`previewKey` and the `stage` key are independent strings and nothing pins that they match.** They do not need to for correctness. Do not write a comment claiming they are kept in step. (Task 4, Step 7, mutation 5.)
3. **The committed `src/content/story.json` drifts from D1 between syncs.** Bounded by `scripts/sync-story-fallback.mjs`, not eliminated. A visitor loading the homepage after an edit and before the next deploy sees the older prose for the length of one fetch.
4. **Changing the portrait is a mixed publish and still needs a Pages build.** Stated in the panel's own help text (Task 4) rather than left for her to discover.
5. **`e2e/dashboard-sections.spec.ts:392` is a known pre-existing flake** (one failure in three full runs, untouched by this phase). Diagnose it eventually; a test that fails one run in three is a test whose green means less than it looks.
