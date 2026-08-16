# Phase 3: Experiences Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put an Experiences carousel on the homepage — six cards, four of which navigate to the four real pages and two of which are static Coming Soon cards that do not respond to clicks — retire the nav dropdown in its favour, give Catering a photo gallery and Cooking Class a hero image, make the section's heading, intro and every item editable from the Manage screen, let the owner add a coming-soon item herself, and remove "Add a page" so she cannot create a real page.

**Architecture:** A ninth `SectionId`, `experiences`, backed by a new committed JSON file `src/content/experiences.json` on the existing GitHub store — *not* D1. The storage decision is argued in full below and it is the one architectural choice this phase makes. `Experiences.tsx` renders the list from the build-time content snapshot exactly the way `FoodGallery.tsx` renders dishes, so the carousel is live at first paint with no fetch. An item's `link` is resolved against the live `pages` list at render time, so a card whose destination has been switched off degrades to a Coming Soon card rather than to a dead link or a build failure. Images continue to come from the build-time derivative pipeline (`scripts/images.mjs` into `public/`), which gains an eighth category, `experiences`, so the owner can upload a coming-soon photo through the same `POST /api/upload` route every other photo already uses.

**Tech Stack:** Vite 5, React 18, TypeScript strict (solution-style tsconfig), Tailwind 3, react-router-dom 7, Vitest 3.2.7, Playwright, sharp (build-time only), Cloudflare Workers + D1 + KV (untouched by this phase beyond one routing assertion).

**Spec:** `docs/superpowers/specs/2026-08-15-rebrand-and-content-platform-design.md` (Phase 3)

---

## The storage decision, and what it costs

**Experiences content lives in a committed `src/content/experiences.json` served by the GitHub store, not in D1.**

Phase 2 built the seam that would make D1 a one-line change: adding `'src/content/experiences.json'` to `D1_ONLY_PATHS` in `worker/store.ts` is all it would take, and the dashboard genuinely cannot tell the difference (`src/admin/content.ts`'s own `CONTENT_FILES` comment says so, and it is true). D1 was still rejected, for three reasons that are specific to *this* content rather than general:

1. **Every experience item requires an image, and under the standing build-time-pipeline ruling a new image already needs a commit and a Pages build.** D1's headline win is a publish with no build — instant, and immune to the Pages flakiness the Phase 2 ledger recorded (three consecutive builds failed on unchanged, working source). That win does not apply to the operation this phase exists to enable. "Add a coming-soon item" means uploading a photo, which commits to `assets-source/experiences/` and triggers a build regardless of where the *text* is stored. D1 would buy an instant publish for renaming an existing card, and nothing for adding a new one.

2. **D1 content is invisible to `src/content/__tests__/assets.test.ts`.** That guardrail walks every `.json` file *under `src/content/`* plus every `.tsx`/`.ts`/`.css` file, collects every asset-shaped string, and asserts each one exists in `public/` with exact case. It is the only thing in this repository that catches an image path pointing at a derivative that was never generated or was pruned. `awards.json` is already outside that guarantee and that is an accepted, low-stakes hole — an award badge is optional and most awards have none. An experience's image is mandatory and is the whole card. Putting this file in D1 would mean a mistyped or stale image path renders a broken image on the homepage with nothing anywhere going red.

3. **Every add would be a mixed publish**, one D1 file plus one GitHub asset commit in a single request. Phase 2's ledger documents that path as the fragile one: partial landings on the 400/409/502 branches, and a conflict that can be misattributed to a third party when it was the owner's own retry. `reconcileAfterConflict` narrows it; it does not close it. Choosing to route the *most common owner operation in this phase* through the least proven path is not a trade worth making for a two-minute saving.

**What the JSON choice costs, stated plainly:**

- **Every experiences edit is a git commit and a 2-3 minute Cloudflare Pages build**, on a build system this project has recorded as intermittently flaky. Renaming a card is as slow as adding one. This is the same cost the other ten content files already carry, so nothing regresses — but nothing improves either, and the owner will notice that Awards publishes instantly and Experiences does not.
- **A broken build blocks every subsequent publish**, the failure mode `src/test/homepage-bytes.test.tsx`'s own header documents at length. This plan therefore adds no `src/content/index.ts` build-time assertion and no `npm test` invariant that can be made false by an ordinary owner action (see Task 3's link-resolution design, which degrades at render time instead).
- **It defers, rather than answers, the question of when this file moves.** When `CONTENT_STORE` flips to `"d1"`, `experiences.json` migrates with every other file at once, through `storeFor`. It is deliberately *not* added to `D1_ONLY_PATHS`, so it is on the ordinary side of the switch and needs no special case at cutover. Task 2 pins that with a test.

---

## Global Constraints

- Typecheck is `npx tsc -b --noEmit`. Plain `tsc --noEmit` checks nothing; the tsconfig is solution-style.
- Full gate: `npx tsc -b --noEmit && npm test -- --run && npx eslint .` plus `npx playwright test`. Run Playwright only when nothing else is running — port 8080 is shared and concurrent runs give phantom failures.
- Every test must be able to fail; every test-writing step needs an explicit mutation proof naming the expected failure. This project has caught eight tests that could not fail.
- jsdom has no layout engine — rendering, geometry, occlusion, and computed-style claims go in `e2e/`. A carousel is exactly the kind of thing whose visibility claims must be measured in a browser.
- `src/test/homepage-bytes.test.tsx` asserts an exact byte count and will need its number updated when a section lands. Update the number, never the assertion.
- Brand `#C8D8E8` is a SURFACE colour only (1.45:1 on white); foreground text on light backgrounds uses accent `#9D4949` (6.03:1); on dark backgrounds brand stays. `e2e/brand-contrast.spec.ts` measures every text element against its effective background and will fail the build for unreadable text.
- Retired hexes `#6B8B59` and `#5a7349` appear nowhere except `scripts/favicons.mjs`.
- Never list Claude or any AI as co-author, and never mention AI in a commit message.
- Nothing billable without the owner's approval.

### Constraints specific to this phase

- **Images use the existing build-time pipeline (`scripts/images.mjs` into `public/`), not R2.** This is a standing ruling carried forward from the Phase 3 progress file and it is not reopened here. R2 is not bound at all: `wrangler r2 bucket create` fails with code 10042 pending a Cloudflare dashboard activation that can require billing details, which the standing authorization forbids doing unilaterally. Even with a bucket, the derivative pipeline could not move: `scripts/images.mjs` loads sharp's native binding at module scope and workerd cannot execute native code, and every Cloudflare resizing product is billable. **Do not invent an upload path.** Photos go into `assets-source/<category>/`, `npm run images` produces the `.webp` derivative in `public/<category>/`, and content references the derivative by its leading-slash path. That is the whole mechanism, it already works, and `worker/upload.ts` already commits owner uploads into exactly that shape.
- **Adding a `SectionId` is a compile-driven sweep.** Work from what `npx tsc -b --noEmit` actually reports, not from any list in this plan. Task 3 names the seven literals it expects, and that list may be incomplete — a literal may exist that this plan did not find. The compiler is the authority; the table is a starting point.
- **`src/admin/__tests__/EditMode.test.tsx` compares `App.tsx`'s and `EditMode.tsx`'s `SECTION_COMPONENTS` object-literal bodies verbatim.** The two new entries must be byte-identical, and no comment may be placed inside either literal's braces. `EditMode.tsx`'s own comment above the literal says this; it is easy to break by adding a helpful note in the wrong place.
- **`copy.json` has three coupled totality checks.** Adding `Copy['experiences']` requires an entry in `src/admin/fields.ts`'s `CopyLeafShape` *and* in `COPY_FIELDS`, because `src/admin/__tests__/fields.test.ts` walks the real committed `copy.json` and asserts every leaf it finds has a matching entry and that no entry is orphaned. `assertCopy` (`src/content/guards.ts`) additionally rejects any blank string leaf anywhere in the file, so an empty intro fails at import time.
- **`validateContent`'s `RULES` table is keyed on BASENAME, not on the full path** (`worker/index.ts`'s `handlePublish` calls `validateContent(basename(f.path), parsed)`). Registering `'experiences.json'` therefore also makes `assets-source/<category>/experiences.json` validate and commit, exactly the documented hole `validate.ts:1076-1114` already describes for `awards.json`. This phase does **not** close it — `worker/index.ts` is out of scope and the fix touches eleven call sites — but Task 2 must not repeat Task 5's mistake of writing a mitigation comment that is false. State the hole, state that it is authenticated-only and grants a session nothing it could not already do to `assets-source/`, and stop there.
- **The `gallery` template refuses an empty image list** (`validate.ts:691`, "this section needs at least one image"). Tasks 6 and 7 both add gallery sections and both therefore need real, resolvable image paths at the moment they land. There are no catering photographs in this repository; the spec's own Open Items says so. Task 6 seeds from existing photos and labels them as placeholders rather than shipping an empty gallery that cannot be published.
- **`UPLOAD_CATEGORIES` (`src/shared/upload-categories.ts`) is a closed seven-member union shared by the Worker and the browser.** The owner cannot upload into a directory that is not in it — `worker/upload.ts` answers 400 `Unknown category`. Task 1 widens it to eight.

---

## File Structure

**Created:**
- `assets-source/experiences/retail.png` — copied from `/Users/taran/Desktop/retail.png` (1430x1100).
- `assets-source/experiences/pamphlet.jpg` — copied from `/Users/taran/Desktop/pamphlet.jpg`.
- `public/experiences/retail.webp`, `public/experiences/pamphlet.webp` — generated by `npm run images`, committed.
- `src/content/experiences.json` — the six seeded items.
- `src/components/Experiences.tsx` — the homepage carousel.
- `src/components/__tests__/Experiences.test.tsx`
- `src/admin/areas/ExperiencesArea.tsx` — the Manage panel.
- `src/admin/areas/__tests__/ExperiencesArea.test.tsx`
- `e2e/experiences-carousel.spec.ts` — the layout, occlusion and click-inertness claims.

**Modified:**
- `src/shared/upload-categories.ts` — an eighth category.
- `src/content/types.ts` — `Experience`, `SectionId` gains `experiences`, `Copy` gains `experiences`.
- `src/content/guards.ts` — `EXPERIENCE_KEYS`, `assertExperiences`, `SECTION_ID_SET` gains `experiences`.
- `src/content/validate.ts` — `validateExperience`/`validateExperiences`, `RULES['experiences.json']`.
- `src/content/index.ts` — imports, asserts and exports `experiences`.
- `src/content/context.ts`, `src/content/ContentContext.ts` — `experiences` on the content value (follow whichever of the two actually declares the shape; `tsc -b` will say).
- `src/content/sections.json` — the `experiences` entry, after `drinks`.
- `src/content/copy.json` — `experiences.heading`/`experiences.intro`, and `nav.links` gains the Experiences anchor.
- `src/content/pages.json` — four `inNav: false`, Catering's gallery section, Cooking Class's pamphlet section.
- `src/App.tsx`, `src/admin/EditMode.tsx`, `src/admin/SectionList.tsx` — the `Record<SectionId, …>` literals.
- `src/content/__tests__/sections.test.tsx` — `MARKER` and `SECTION_SELECTOR`.
- `src/admin/fields.ts` — `EXPERIENCE_FIELDS`, `CopyLeafShape`, `COPY_FIELDS`.
- `src/admin/content.ts` — `CONTENT_FILES`, `CONTENT_FILE_LABELS`, `ContentTypeMap`.
- `src/admin/manage/areas.ts`, `src/admin/manage/ManageShell.tsx` — the twelfth panel.
- `src/admin/PageList.tsx` — "Add a page" removed.
- `src/test/homepage-bytes.test.tsx` — the byte count, in Task 3 only.
- `worker/__tests__/store.test.ts` — the routing pin, in Task 2.

---

### Task 1: The two real photos, and an eighth upload category

Assets first, because `src/content/__tests__/assets.test.ts` fails the *entire suite* the moment any content file names a path with no derivative in `public/`. Every later task references `/experiences/retail.webp` and `/experiences/pamphlet.webp`; if those do not exist yet, Task 3 goes red for a reason that has nothing to do with Task 3.

**Files:**
- Create: `assets-source/experiences/retail.png`, `assets-source/experiences/pamphlet.jpg`
- Create (generated): `public/experiences/retail.webp`, `public/experiences/pamphlet.webp`
- Modify: `src/shared/upload-categories.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, consumed by Tasks 3, 6 and 7: the asset paths `/experiences/retail.webp` and `/experiences/pamphlet.webp`, resolvable by `src/test/publicFiles.ts`. Produces `UploadCategory` gaining `'experiences'`, consumed by Task 8's `EXPERIENCE_FIELDS.image.category`.

- [ ] **Step 1: Copy the two sources into the tree**

```bash
mkdir -p assets-source/experiences
cp "/Users/taran/Desktop/retail.png" assets-source/experiences/retail.png
cp "/Users/taran/Desktop/pamphlet.jpg" assets-source/experiences/pamphlet.jpg
```

Named by hand rather than content-addressed. `worker/upload.ts`'s `uploadPath` hashes owner uploads into `assets-source/<category>/<12-hex>.<ext>` so two iPhone photos both called `IMG_1234.png` cannot collide; these two are developer-placed seed assets and a readable filename is worth more than hash-uniqueness for files nobody will ever upload twice. `findCollisions` (`scripts/paths.mjs`) is what would catch it if that ever stopped being true.

**About `pamphlet.jpg`, recorded here because it is the file's own defect and not a bug to be found later:** it was made in Canva, its headings are green, and its illustration style does not match the rest of the site. It works for now and the owner has been told it should be redesigned against the new palette later. Do not "fix" the green in code — the green is baked into the JPEG's pixels, so there is nothing a colour token can reach, and `e2e/brand-contrast.spec.ts` measures *text elements* against their computed backgrounds and never inspects image pixels, so it will not fail on this. It is a known, accepted, temporary mismatch.

- [ ] **Step 2: Widen `UPLOAD_CATEGORIES`**

In `src/shared/upload-categories.ts`:

```ts
export const UPLOAD_CATEGORIES = ['atmosphere', 'food', 'hero', 'mocktails', 'our_story', 'press', 'team', 'experiences'] as const;
```

Update the file's own opening comment, which says "The seven directories that exist under assets-source/ today" — it is eight now. This list is the *only* thing standing between `POST /api/upload` and an arbitrary directory name: `worker/upload.ts` builds `CATEGORIES` from it and answers 400 `Unknown category "…"` for anything else, and `src/admin/PhotoField.tsx` reads it so the browser knows what it may ask for. Both sides import this one constant, so there is nothing to keep in step by hand.

Appended rather than inserted alphabetically: nothing depends on the order, and appending keeps the diff to one line so a reviewer can see at a glance that no existing category was renamed or dropped.

- [ ] **Step 3: Generate the derivatives**

```bash
npm run images
```

Expected in the log: two new lines naming `assets-source/experiences/retail.png -> public/experiences/retail.webp` and the pamphlet, both `@ 1000px`. 1000 is `DEFAULT_MAX_WIDTH` (`scripts/paths.mjs`) — `experiences` deliberately gets **no** `DIR_MAX_WIDTH` entry. The carousel card is `w-80` (320 CSS px) like `FoodGallery`'s, so 1000px is generous, and `food` has no override for the identical reason: those photos are reused at larger sizes elsewhere and the larger use wins. `retail.png` is 1430x1100, so it is genuinely downscaled; `withoutEnlargement: true` means the pamphlet is capped rather than stretched whatever its source width is.

Then confirm the pruner did not eat anything and nothing else moved:

```bash
git status --short public/ assets-source/
```

Expected: exactly two new files under `public/experiences/` and two under `assets-source/experiences/`. Any *deletion* under `public/` means `prune()` removed a derivative whose source it could not find, which is a separate problem and must be understood before committing.

- [ ] **Step 4: Prove the derivatives are real and the category guard is alive**

```bash
npx vitest run src/content/__tests__/assets.test.ts scripts/__tests__/images.test.mjs
```

Expected: PASS. Nothing references the new paths yet, so `assets.test.ts` is not yet checking them — it is being run to confirm this task broke nothing, not to confirm the new files work. That check arrives in Task 3, when a content file first names them.

Mutation, to prove the upload allowlist is enforced rather than decorative: in `src/shared/upload-categories.ts` remove `'experiences'` again and run `npx vitest run worker/__tests__/upload.test.ts`. If that suite has a case pinning the category list, it goes red and names it; if it does not, add one now —

```ts
it('accepts the experiences category and refuses one that is not on the list', () => {
  expect(UPLOAD_CATEGORIES).toContain('experiences');
  expect(UPLOAD_CATEGORIES).not.toContain('retail');
});
```

— and re-run the mutation to watch it fail. A widened allowlist with nothing asserting the new member is a change that can be silently reverted.

- [ ] **Step 5: Commit**

```bash
git add assets-source/experiences public/experiences src/shared/upload-categories.ts worker/__tests__/upload.test.ts
git commit -m "feat(assets): add the retail and pamphlet photos and an experiences category

Both go through the existing build-time pipeline into public/, not R2: R2 is
not enabled on the account (wrangler fails with 10042 pending a dashboard
step that can require billing details) and the derivative pipeline could not
move into the Worker anyway, because sharp is a native binding and workerd
cannot execute native code.

The eighth upload category is what lets the owner add a coming-soon photo
herself through the route every other photo already uses -- POST /api/upload
refuses any category not on that one shared list."
```

---

### Task 2: The `Experience` type, its guards, its validator, and the seeded file

Everything about the data, with no UI and no `SectionId` change, so `tsc -b` stays green throughout and the storage decision is testable before anything renders.

**Files:**
- Create: `src/content/experiences.json`
- Modify: `src/content/types.ts`, `src/content/guards.ts`, `src/content/validate.ts`, `src/content/index.ts`
- Modify: `src/content/__tests__/validate.test.ts`, `src/content/__tests__/guards.test.ts`
- Modify: `worker/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `/experiences/retail.webp` and `/experiences/pamphlet.webp` from Task 1.
- Produces, consumed by Tasks 3 and 8:

```ts
export interface Experience {
  id: string;
  title: string;
  description: string;
  image: string;
  link?: string;
  comingSoon: boolean;
}
export const EXPERIENCE_KEYS: Record<keyof Experience, true>;
export function assertExperiences(raw: unknown): Experience[];
// RULES['experiences.json'] -> validateExperiences
export const experiences: Experience[];   // from src/content/index.ts
```

- [ ] **Step 1: The type**

In `src/content/types.ts`, next to `Award`:

```ts
// Phase 3. One card in the homepage carousel. `link` and `comingSoon` are
// BOTH declared because the spec names both, and they are kept from
// disagreeing by validateExperiences rather than by collapsing one into the
// other: a derived `comingSoon = link === undefined` would read the same in
// every rendering path today, but it would also make "an item that links
// somewhere AND says coming soon" unspellable, which is a decision that
// belongs in the validator where the owner gets a sentence about it, not in
// the type where she gets nothing.
//
// `image` is REQUIRED, unlike Award['image']. An award with no badge is an
// ordinary award; a carousel card with no photo is an empty rectangle. That
// difference is also why this file is committed JSON rather than D1 -- see
// the plan's own storage section: src/content/__tests__/assets.test.ts only
// walks src/content/, so a D1-stored image path would be checked by nothing.
//
// `link` is a site-relative path ("/catering"), never an absolute URL. The
// validator refuses anything else; Experiences.tsx resolves it against the
// live pages list and renders an unresolvable one as a coming-soon card
// rather than as a dead <Link>.
export interface Experience {
  id: string;
  title: string;
  description: string;
  image: string;
  link?: string;
  comingSoon: boolean;
}
```

And to `Copy`, after `drinks`:

```ts
  experiences: { heading: string; intro: string };
```

`{ heading, intro }` and nothing else, matching `drinks` and `awards` exactly. The spec asks for copy that "matches the wording pattern of the other homepage sections", and the pattern is structural as well as verbal: two strings, both plain `copy.json` leaves, both editable through the ordinary text/textarea field treatment.

Do **not** touch `SectionId` in this task. That is Task 3, and it is a compile-driven sweep that would swamp this diff.

- [ ] **Step 2: The key set and the import-time guard**

In `src/content/guards.ts`, beside `AWARD_KEYS`:

```ts
export const EXPERIENCE_KEYS: Record<keyof Experience, true> = {
  id: true,
  title: true,
  description: true,
  image: true,
  link: true,
  comingSoon: true,
};
```

Then an `assertExperiences` in the same idiom as `assertPages`/`assertSections` — it rebuilds each entry from named keys so a stray key in a hand-edited file cannot reach runtime, and throws with a `content/experiences.json: …` prefixed message naming the offending index. What it must check, and only this:

- the top level is an array;
- each entry's `id` is a non-empty string, unique across the list;
- `title`, `description` and `image` are non-empty strings;
- `comingSoon` is a boolean;
- `link` is either absent or a non-empty string.

**It must NOT cross-check `link` against `pages.json`.** That is deliberate and it is the single most important line in this task. `src/content/index.ts` imports every content file, so the cross-check is *possible* — and it would mean that switching a page off in the dashboard throws at import time, which fails the build, which (per `src/test/homepage-bytes.test.tsx`'s own header, written after this exact outage) then blocks every subsequent publish of every other file with no control the owner can reach to recover. A one-click, entirely legitimate owner action must not be able to do that. The resolution happens at render time instead (Task 3).

- [ ] **Step 3: The write-time validator**

In `src/content/validate.ts`, following `validateAwards`'s shape — a list of id-carrying records with an image field and a `seenIds` Set threaded through:

```ts
// Phase 3. experiences.json, committed under src/content/ and served by the
// GitHub store -- deliberately NOT in worker/store.ts's D1_ONLY_PATHS. See
// the phase plan's storage section for the full argument; the short form is
// that every item carries a mandatory image, a new image needs a build
// regardless of where the text lives, and a D1-stored image path would be
// invisible to src/content/__tests__/assets.test.ts.
const EXPERIENCE_LINK_PATTERN = /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateExperience(raw: unknown, index: number, seenIds: Set<string>): ValidationProblem[] {
  const item = asRecord(raw);
  const problems: ValidationProblem[] = [];
  const name = String(item.title ?? 'this item');

  if (isBlank(item.id)) {
    problems.push(problem(`[${index}].id`, `the item at position ${index} needs an id`));
  } else if (seenIds.has(item.id as string)) {
    problems.push(problem(`[${index}].id`, `"${item.id}" is already used by another item`));
  } else {
    seenIds.add(item.id as string);
  }
  if (isBlank(item.title)) {
    problems.push(problem(`[${index}].title`, 'this item needs a title'));
  }
  if (isBlank(item.description)) {
    problems.push(problem(`[${index}].description`, `"${name}" needs a short description`));
  }
  // Required, unlike an award badge: a card with no photo is an empty
  // rectangle. Same isUnsafeAssetPath rule as every other image field here.
  if (isBlank(item.image)) {
    problems.push(problem(`[${index}].image`, `"${name}" needs a photo`));
  } else if (isUnsafeAssetPath(item.image)) {
    problems.push(problem(`[${index}].image`, `"${name}" needs a photo on this site, starting with /`));
  }
  if (typeof item.comingSoon !== 'boolean') {
    problems.push(problem(`[${index}].comingSoon`, `"${name}" needs to say whether it is coming soon`));
  }
  if (item.link !== undefined) {
    if (isBlank(item.link)) {
      problems.push(problem(`[${index}].link`, `"${name}" needs a page to open, or leave it blank`));
    } else if (!EXPERIENCE_LINK_PATTERN.test((item.link as string).trim())) {
      // Refuses an absolute URL, a protocol-relative "//evil.example", a
      // nested path, a trailing slash and a query string in one rule. This
      // value reaches react-router's <Link to={...}>, and a page slug is
      // already constrained to the same shape by isUrlSafeSlug -- so the
      // set of links this accepts is exactly the set of page routes that
      // can exist, and nothing else.
      problems.push(problem(`[${index}].link`, `"${name}" can only open a page on this site, like "/catering"`));
    }
  }
  // The one rule that is about the PAIR rather than either field. The spec
  // binds them: an item with a link navigates, an item without one is a
  // static Coming Soon card. Both contradictions are refused, and each gets
  // its own sentence, because they are different mistakes: a coming-soon
  // item that links somewhere would render a stamp over a working card, and
  // a not-coming-soon item with no link would render a card that looks
  // clickable and does nothing.
  if (typeof item.comingSoon === 'boolean') {
    if (item.comingSoon && item.link !== undefined) {
      problems.push(problem(`[${index}].link`, `"${name}" is marked coming soon, so it cannot open a page yet`));
    }
    if (!item.comingSoon && item.link === undefined) {
      problems.push(problem(`[${index}].link`, `"${name}" needs a page to open, or mark it coming soon`));
    }
  }
  problems.push(...validateKnownKeys(item, EXPERIENCE_KEYS, `[${index}]`, name));
  return problems;
}

function validateExperiences(data: unknown): ValidationProblem[] {
  if (!Array.isArray(data)) return [problem('', 'expected a list of experiences')];
  // An empty list is REFUSED, unlike awards. A zero-award restaurant is an
  // ordinary state; a homepage section headed "Experiences" with no cards
  // under it is a hole in the page. She can still switch the whole section
  // off from "What shows on the homepage", which is the supported way to
  // have no carousel.
  if (data.length === 0) return [problem('', 'the carousel needs at least one item')];
  const seenIds = new Set<string>();
  return data.flatMap((item, i) => validateExperience(item, i, seenIds));
}
```

Register it:

```ts
  'experiences.json': validateExperiences,
```

Add a short comment above the `RULES` entry recording the basename hole *accurately*: `RULES` is keyed on basename because `handlePublish` calls `validateContent(basename(f.path), parsed)`, so this entry also makes `assets-source/<category>/experiences.json` validate and commit — `ASSET_PATH` in `worker/github.ts` is `/^assets-source\/[a-z0-9_-]+\/[A-Za-z0-9 ._-]+$/` and it matches that path. What limits it is that the route is authenticated and an authenticated session can already commit arbitrary bytes anywhere under `assets-source/<category>/`, so this grants nothing new. Do not claim the path is refused; it is not. `validate.ts:1076-1114` already documents this for `awards.json` and got it wrong the first time — do not reintroduce the wrong version.

- [ ] **Step 4: Seed the file**

Create `src/content/experiences.json` with the six items. Four link to the real pages in `pages.json` (`catering`, `cheeseboards`, `cooking-class`, `membership` — read that file, do not trust these slugs from memory); Gifting and Retail are coming-soon.

```json
[
  {
    "id": "catering",
    "title": "Catering",
    "description": "Bespoke and curated menus for up to 100 guests, cooked by our kitchen and brought to your event.",
    "image": "/atmosphere/table.webp",
    "link": "/catering",
    "comingSoon": false
  },
  {
    "id": "cheeseboards",
    "title": "Cheeseboards",
    "description": "Boards put together by the kitchen and delivered across Delhi.",
    "image": "/atmosphere/dining.webp",
    "link": "/cheeseboards",
    "comingSoon": false
  },
  {
    "id": "cooking-class",
    "title": "Cooking Class",
    "description": "Every Sunday, four children cook four dishes with our kitchen.",
    "image": "/experiences/pamphlet.webp",
    "link": "/cooking-class",
    "comingSoon": false
  },
  {
    "id": "membership",
    "title": "Membership",
    "description": "A booklet limited to one hundred a year, handpicked by Chef Kamalika.",
    "image": "/atmosphere/ambience.webp",
    "link": "/membership",
    "comingSoon": false
  },
  {
    "id": "gifting",
    "title": "Gifting",
    "description": "Hampers and gift boxes from the kitchen, in time for the season.",
    "image": "/food/tiramisu.webp",
    "comingSoon": true
  },
  {
    "id": "retail",
    "title": "Retail",
    "description": "Our pantry shelf -- sauces, preserves and pasta to take home.",
    "image": "/experiences/retail.webp",
    "comingSoon": true
  }
]
```

**Four of these six images are placeholders and must be recorded as such**, not quietly shipped as if they were chosen photographs. Only `/experiences/pamphlet.webp` and `/experiences/retail.webp` are the real, supplied assets. Catering, Cheeseboards, Membership and Gifting are drawn from photos already in `public/` because the spec's own Open Items lists catering photographs as still needed and names no Gifting asset at all, and `validateExperiences` refuses a blank image, so there is no "leave it empty for now" state. Each is one click to replace from the Manage screen once real photos exist. Say this in the commit message.

Filenames without spaces were chosen deliberately from the available set: `assets.test.ts` `decodeURIComponent`s each path before checking it against `publicFiles`, so a literal space works — but several existing derivatives (`/atmosphere/painting board.webp`, `/atmosphere/front mirror.webp`) carry one, and picking those would put a space inside a `<Link>`-adjacent JSON string for no gain.

- [ ] **Step 5: Wire it into the content barrel**

In `src/content/index.ts`, import `experiences.json`, run it through `assertExperiences`, and export the result — following exactly what the file already does for `pages`. Then extend whichever module declares the shape the `ContentContext` provides (`src/content/context.ts` or `src/content/ContentContext.ts`) so `useContent().experiences` exists. `tsc -b` will name the file if you pick the wrong one; do not guess from this plan.

- [ ] **Step 6: Pin the storage decision in the routing test**

In `worker/__tests__/store.test.ts`, the existing "leaves every existing content file on GitHub" case reads `src/content/` with `readdirSync`, so `experiences.json` joins it automatically the moment the file exists — that is the coverage working and it needs no edit. What *does* need an explicit line is the negative:

```ts
  // Phase 3's storage decision, pinned rather than implied. experiences.json
  // is committed JSON on the GitHub store, so it is on the ORDINARY side of
  // the CONTENT_STORE switch and migrates with everything else when that
  // flips -- unlike awards.json, which is D1-only and would need a special
  // case at cutover. Adding it to D1_ONLY_PATHS is a one-line change; this
  // is what makes that one line a deliberate decision rather than a slip.
  it('keeps experiences.json out of D1_ONLY_PATHS', () => {
    expect([...D1_ONLY_PATHS]).toEqual(['src/content/awards.json']);
  });
```

`toEqual` on the whole array, not `.not.toContain` — the Phase 2 review found that a membership check that only tests growth misses a swap.

- [ ] **Step 7: Tests, and prove each can fail**

In `src/content/__tests__/validate.test.ts`, add cases for: a well-formed list returning `[]`; a duplicate id; a blank title; a missing image; an image not starting with `/`; a `link` of `"https://example.com/catering"`; a `link` of `"//evil.example"`; a coming-soon item that also carries a link; a not-coming-soon item with no link; an unknown key; and an empty array.

In `src/content/__tests__/guards.test.ts`, add: `assertExperiences` throws naming the index for a non-array, a duplicate id, and a non-boolean `comingSoon`; and — the one that matters — `assertExperiences` **accepts** an item whose `link` names a page that does not exist in `pages.json`, with a comment saying why that is correct and what would break if it threw.

```bash
npx vitest run src/content/__tests__/validate.test.ts src/content/__tests__/guards.test.ts worker/__tests__/store.test.ts
```

Expected: PASS.

Mutation one: delete the `!item.comingSoon && item.link === undefined` branch and re-run. Expected: FAIL on the "needs a page to open, or mark it coming soon" case, and *only* that one — if two cases go red, the two contradiction rules are not independent and one of them is not doing its own work.

Mutation two: change `EXPERIENCE_LINK_PATTERN` to `/^\/.+$/` and re-run. Expected: FAIL on both hostile-URL rows (`https://` and `//evil.example`). Revert.

Mutation three: add a `pages`-cross-check throw to `assertExperiences` and run `npm test -- --run`. Expected: a large number of tests fail at import time. This is not a bug to fix — it is the demonstration of why Step 2 forbids that check, and it is worth seeing once. Revert immediately.

- [ ] **Step 8: Gate and commit**

```bash
npx tsc -b --noEmit && npm test -- --run && npx eslint .
```

```bash
git add src/content worker/__tests__/store.test.ts
git commit -m "feat(content): add the Experience type, its validator and the seeded carousel list

Committed JSON on the GitHub store rather than D1, deliberately: every item
carries a mandatory image, a new image needs a build whichever store holds
the text, and a D1-stored image path would be invisible to the assets
guardrail, which only walks src/content/. The cost is that every experiences
edit is a commit and a Pages build; that is recorded rather than hidden.

Four of the six images are placeholders drawn from photos already on the
site -- only the pamphlet and the retail photo are real supplied assets, and
the spec's own open items say catering photographs do not exist yet. Each is
one click to replace from the Manage screen.

link is validated for shape only and never cross-checked against pages.json:
that check would make switching a page off throw at import time, fail the
build, and block every subsequent publish -- the exact outage the homepage
byte-count test's own header documents. The carousel resolves links at
render time instead."
```

---

### Task 3: `Experiences.tsx`, and the `SectionId` sweep

The union grows for the second time since it was written. `Record<SectionId, …>` is what turns that into a listed, compile-error-driven sweep rather than a search.

**Files:**
- Create: `src/components/Experiences.tsx`, `src/components/__tests__/Experiences.test.tsx`
- Modify: `src/content/types.ts`, `src/content/guards.ts`
- Modify: `src/App.tsx`, `src/admin/EditMode.tsx`, `src/admin/SectionList.tsx`
- Modify: `src/content/__tests__/sections.test.tsx`, `src/test/homepage-bytes.test.tsx`
- Modify: `src/content/sections.json`, `src/content/copy.json`
- Modify: `src/admin/fields.ts` (`CopyLeafShape`, `COPY_FIELDS`)

**Interfaces:**
- Consumes: `Experience`, `experiences` from Task 2.
- Produces, consumed by Tasks 4, 5 and 8:

```ts
export type SectionId =
  | 'hero' | 'ourStory' | 'atmosphere' | 'food' | 'drinks' | 'experiences' | 'press' | 'awards' | 'visit';
export default function Experiences(): JSX.Element;   // renders <section id="experiences">
// data-testid contract, depended on by e2e/experiences-carousel.spec.ts:
//   "experiences-track"          the horizontal scroller
//   "experience-card-<id>"       one card, link or static
//   "experience-stamp-<id>"      the Coming Soon stamp
```

- [ ] **Step 1: Widen the union**

In `src/content/types.ts`:

```ts
export type SectionId =
  | 'hero' | 'ourStory' | 'atmosphere' | 'food' | 'drinks' | 'experiences' | 'press' | 'awards' | 'visit';
```

Placed between `drinks` and `press` to match the order the spec gives (`… drinks, experiences, blog, awards, about, visit`), though the union's order carries no meaning — `sections.json` is what orders the page. Update the comment above it: it currently says the union grew to eight in Phase 2 and "stays closed at eight, on purpose". Nine now, and the closure guarantee is unchanged: nothing the owner does can add a tenth.

- [ ] **Step 2: Run the compiler and fix what it names**

```bash
npx tsc -b --noEmit
```

**Work from this output, not from the table below.** The table is what this plan expects to see; a literal may exist that it did not find, and the compiler is the authority.

| File | Literal | Add |
|---|---|---|
| `src/content/guards.ts:216` | `SECTION_ID_SET` | `experiences: true,` |
| `src/App.tsx:45` | `SECTION_COMPONENTS` | `experiences: () => <Experiences />,` |
| `src/admin/EditMode.tsx:98` | `SECTION_COMPONENTS` | `experiences: () => <Experiences />,` |
| `src/admin/EditMode.tsx:109` | `SECTION_LABELS` | `experiences: 'Experiences',` |
| `src/admin/SectionList.tsx:65` | `SECTION_NAMES` | `experiences: { name: 'Experiences', anchor: '#experiences' },` |
| `src/content/__tests__/sections.test.tsx:24` | `MARKER` | `experiences: copy.experiences.heading,` |
| `src/content/__tests__/sections.test.tsx:66` | `SECTION_SELECTOR` | `experiences: '#experiences',` |

Two of these have a trap each:

- `src/admin/__tests__/EditMode.test.tsx` compares `App.tsx`'s and `EditMode.tsx`'s `SECTION_COMPONENTS` **object-literal bodies verbatim**. The two entries must be byte-identical and no comment may go inside either literal's braces. Put explanation above the literal or nowhere.
- `SECTION_NAMES` in `SectionList.tsx` takes `anchor: string | null`, and `hero`/`drinks` are `null` because they have no nav entry. `experiences` gets a real anchor because Task 5 gives it a real nav link.

- [ ] **Step 3: The copy**

In `src/content/copy.json`, after `drinks`:

```json
  "experiences": {
    "heading": "Experiences",
    "intro": "What the kitchen does beyond dinner -- catering, cheeseboards, a Sunday class for children, and a members' booklet."
  },
```

The register matches `awards.intro` ("Recognition the kitchen has picked up along the way.") and `drinks.intro`: one sentence, plain, in her voice, naming what is there rather than selling it.

Then three coupled edits in `src/admin/fields.ts`, all of which `src/admin/__tests__/fields.test.ts` enforces by walking the real committed `copy.json` and asserting every leaf has an entry and no entry is orphaned:

```ts
// CopyLeafShape
  'experiences.heading': string;
  'experiences.intro': string;
```

```ts
// COPY_FIELDS
  'experiences.heading': { label: 'Experiences heading', kind: 'text' },
  'experiences.intro': { label: 'Experiences intro', kind: 'textarea' },
```

`textarea` for the intro, `text` for the heading — identical to `awards.heading`/`awards.intro`, and `press.intro`/`drinks.intro` before them. Both leaves are painted through `content.renderText`, so both are inline-editable at `/edit` automatically: `src/admin/editable-paths.ts` derives `EDITABLE_TEXT_PATHS` from `COPY_FIELDS` rather than repeating it, and its three exclusions (attribute-bound leaves, `site.*`, and `nav.pagesLabel`) do not apply here. That is the spec's "the heading and intro copy … are editable from the Manage screen" satisfied on both surfaces at once, with no third list to maintain.

- [ ] **Step 4: The section entry**

In `src/content/sections.json`, between `drinks` and `press`:

```json
  {
    "kind": "bespoke",
    "id": "experiences",
    "enabled": true
  },
```

`assertSections` requires every `SectionId` to appear exactly once among the bespoke entries, so omitting this is a hard import-time failure, not a missing section.

- [ ] **Step 5: The component**

Create `src/components/Experiences.tsx`. It follows `FoodGallery.tsx`'s horizontal scroller — `overflow-x-auto scrollbar-hide` around a `flex` row of `w-80` cards with `width: max-content` — because that is the carousel this site already has, it already works on touch, and inventing a second scroller idiom would mean a second set of e2e assertions about the same behaviour.

```tsx
// Phase 3. The homepage carousel, and the thing that replaces the nav's
// Experiences dropdown (Task 5). Content comes from the build-time snapshot
// like every other bespoke section except Awards -- see the phase plan's
// storage section for why this one is committed JSON and Awards is not --
// so the whole carousel is live at first paint with no fetch and no
// chrome-only degraded state to design.
import React from 'react';
import { Link } from 'react-router-dom';
import { useContent } from '../content/ContentContext';
import type { Experience } from '../content/types';

const CARD_BASE =
  'flex-shrink-0 w-80 h-80 relative rounded-2xl overflow-hidden shadow-xl ' +
  'transition-all duration-300 group';

const Experiences: React.FC = () => {
  const content = useContent();
  const { copy, experiences, pages } = content;

  // Resolved at RENDER time against the live pages list, not at import time
  // and not in a validator. A page she has switched off, or one that was
  // removed, must not throw and must not render a <Link> to a route that
  // answers NotFound -- so it degrades to exactly what an item with no link
  // already is: a static Coming Soon card. See assertExperiences' own
  // comment (guards.ts) for why the alternative -- an import-time
  // cross-check -- is an outage rather than a safety net.
  const openable = new Set(pages.filter((page) => page.enabled).map((page) => `/${page.slug}`));
  const navigable = (item: Experience): boolean =>
    !item.comingSoon && item.link !== undefined && openable.has(item.link);

  return (
    <section id="experiences" className="py-20 bg-cream">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="font-['Montserrat'] text-4xl md:text-5xl font-bold text-ink mb-6">
            {content.renderText('experiences.heading', copy.experiences.heading)}
          </h2>
          <p className="font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed">
            {content.renderText('experiences.intro', copy.experiences.intro)}
          </p>
        </div>

        <div className="relative">
          <div className="overflow-x-auto scrollbar-hide">
            <div
              data-testid="experiences-track"
              className="flex space-x-6 pb-4 px-1 py-2"
              style={{ width: 'max-content' }}
            >
              {experiences.map((item) => {
                const body = <ExperienceCardBody item={item} />;
                // A navigable card is a router <Link>; a coming-soon card is
                // a plain <div> with no href, no onClick and no tabIndex, so
                // it is not focusable, not activatable by Enter, and does
                // nothing on click -- the spec's "do not respond to clicks"
                // as a property of the element rather than a handler that
                // swallows the event. pointer-events-none was rejected: it
                // would also stop the card being scrolled by a drag on
                // touch, which is how the whole carousel is operated.
                return navigable(item) ? (
                  <Link
                    key={item.id}
                    to={item.link as string}
                    data-testid={`experience-card-${item.id}`}
                    className={`${CARD_BASE} hover:shadow-2xl cursor-pointer`}
                  >
                    {body}
                  </Link>
                ) : (
                  <div
                    key={item.id}
                    data-testid={`experience-card-${item.id}`}
                    className={`${CARD_BASE} cursor-default`}
                  >
                    {body}
                    <span
                      data-testid={`experience-stamp-${item.id}`}
                      // Accent on white, not brand on white: brand is 1.45:1
                      // and unreadable as text, which e2e/brand-contrast
                      // measures and fails the build over. White on accent
                      // is 6.03:1 the other way round and is what the rest
                      // of the site uses for an emphasised label.
                      className="absolute top-4 right-4 rounded-full bg-accent px-3 py-1
                                 font-['Montserrat'] text-xs uppercase tracking-wider text-white"
                    >
                      Coming Soon
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-cream to-transparent" />
        </div>
      </div>
    </section>
  );
};

function ExperienceCardBody({ item }: { item: Experience }) {
  return (
    <div className="relative w-full h-full">
      <img
        src={item.image}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      <div className="absolute bottom-4 left-4 right-4 text-white">
        <h3 className="font-['Montserrat'] font-semibold text-xl">{item.title}</h3>
        <p className="font-['Open_Sans'] text-sm text-white/85">{item.description}</p>
      </div>
    </div>
  );
}

export default Experiences;
```

Two notes on what is deliberately *not* here. The card image is a plain `<img>`, not `content.renderImage` — the same choice `Awards.tsx` made, and the reason is the same: `renderImage` wires an `/edit` upload target keyed on a dotted content path, and inline photo editing for this file belongs to Task 8's Manage panel, not to the page overlay. The right-edge gradient fades from `cream` because the section's background is `bg-cream`; `FoodGallery`'s fades from white because its section is `bg-white`. Copying that literal across would leave a white smear over a cream background.

- [ ] **Step 6: Component tests**

`src/components/__tests__/Experiences.test.tsx`, rendered inside a `MemoryRouter` with a stubbed content context:

- an item with a link to an enabled page renders an `<a>` whose `href` is that path;
- an item with `comingSoon: true` renders no `<a>` and no `<button>` inside its card, and renders the stamp;
- an item with a link to a **disabled** page renders no `<a>` and *does* render the stamp — the degradation path, and the one nothing else covers;
- the heading and intro render from the injected copy;
- every item in the list produces exactly one card (count the `experience-card-` testids), so a filter added later cannot silently drop one.

Nothing here asserts anything about visibility, overflow or position. jsdom has no layout engine; those claims are Task 4's.

- [ ] **Step 7: Run, and prove they can fail**

```bash
npx vitest run src/components/__tests__/Experiences.test.tsx src/content/__tests__/sections.test.tsx
```

Mutation one: change `navigable` to `!item.comingSoon && item.link !== undefined` (dropping the `openable` check) and re-run. Expected: FAIL on the disabled-page case, which now renders a `<Link>` to a route that answers NotFound. Revert.

Mutation two: remove the `experiences` entry from `sections.json` and run `npm test -- --run`. Expected: `assertSections` throws at import time naming the missing section, and a large number of tests fail. Restore it. That is the completeness guarantee working and it is worth seeing once.

- [ ] **Step 8: Update the byte count**

```bash
npx tsc -b --noEmit && npm test -- --run && npx eslint .
```

`src/test/homepage-bytes.test.tsx` fails. Take the number the run reports, update **only** that number, and add a paragraph to that file's running log in the same style as the entries already there: the old number, the new number, and that the difference is the Experiences section — `<section id="experiences">`, the heading, the intro, and six full cards with their images, titles, descriptions and two Coming Soon stamps. Unlike the Awards entry above it, this one is *not* chrome-only: the content is compiled in, so every card is present at first paint. That is the storage decision made visible in a number.

`src/admin/__tests__/SectionList.test.tsx` and `src/content/__tests__/sections.test.tsx` may assert a count of eight sections. Those are real assertions doing their job; update them to nine and read each diff before you do.

- [ ] **Step 9: Commit**

```bash
git add -A src/
git commit -m "feat(experiences): add the homepage carousel

SectionId grows from eight members to nine, the second time it has grown
since it was written; every Record<SectionId, ...> literal failed to compile
until it had a matching entry, which is the completeness guarantee working
rather than churn.

A card with a link is a router Link; a card without one is a plain div with
no href, no onClick and no tabIndex, so it is not focusable, not activatable
and does nothing on click -- inertness as a property of the element rather
than a handler that swallows the event. A card whose page has been switched
off degrades to the same static card, resolved at render time, because the
alternative cross-check would fail the build on a one-click owner action.

homepage-bytes: NNNNN -> NNNNN, the whole carousel at first paint."
```

---

### Task 4: Prove the carousel in a real browser

jsdom told us the right elements exist. It cannot tell us the stamp is on top of the image rather than behind it, that a card is reachable by scrolling, or that a coming-soon card does not navigate when a real pointer lands on it. This project has shipped invisible collage tiles before.

**Files:**
- Create: `e2e/experiences-carousel.spec.ts`

**Interfaces:**
- Consumes: the `data-testid` contract from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test';

// Every claim here is one jsdom structurally cannot make. Element existence
// is already covered by src/components/__tests__/Experiences.test.tsx; what
// is measured here is geometry, occlusion, and what a real pointer does.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('#experiences').scrollIntoViewIfNeeded();
});

test('every card is laid out with real width and height', async ({ page }) => {
  const cards = page.locator('[data-testid^="experience-card-"]');
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i += 1) {
    const box = await cards.nth(i).boundingBox();
    expect(box, `card ${i} has no box at all`).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);
  }
});

test('the track scrolls horizontally and the last card is reachable', async ({ page }) => {
  const track = page.locator('[data-testid="experiences-track"]');
  const scroller = track.locator('xpath=..');
  // The carousel only earns its name if the content is wider than its
  // viewport. If these were ever equal the section would be a static row and
  // the last cards would simply be missing on a narrow screen.
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);

  const last = page.locator('[data-testid="experience-card-retail"]');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});

test('a Coming Soon stamp sits on top of its card, not behind it', async ({ page }) => {
  const stamp = page.locator('[data-testid="experience-stamp-retail"]');
  await expect(stamp).toBeVisible();
  const box = (await stamp.boundingBox())!;
  // Hit-testing the stamp's own centre point: if anything is painted over
  // it, elementFromPoint returns that instead. "toBeVisible" alone is
  // satisfied by an element with a real box that is completely covered.
  const onTop = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('[data-testid^="experience-stamp-"]')?.getAttribute('data-testid') ?? null;
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(onTop).toBe('experience-stamp-retail');
});

test('clicking a coming-soon card does nothing', async ({ page }) => {
  const before = page.url();
  await page.locator('[data-testid="experience-card-retail"]').click();
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
  await expect(page.locator('#experiences')).toBeVisible();
});

test('a coming-soon card is not reachable by keyboard either', async ({ page }) => {
  // The mouse case above would still pass if the card were a focusable
  // element with a suppressed click. This is what distinguishes "inert" from
  // "swallows the event".
  const focusable = await page
    .locator('[data-testid="experience-card-retail"]')
    .evaluate((el) => el.matches('a[href], button, [tabindex]') || el.querySelector('a[href], button, [tabindex]') !== null);
  expect(focusable).toBe(false);
});

test('clicking a linked card navigates to its page', async ({ page }) => {
  await page.locator('[data-testid="experience-card-catering"]').click();
  await expect(page).toHaveURL(/\/catering$/);
  await expect(page.getByRole('heading', { name: /catering/i }).first()).toBeVisible();
});
```

- [ ] **Step 2: Run it, alone**

Nothing else may be running — port 8080 is shared and a concurrent run produces phantom failures.

```bash
npx playwright test
```

Expected: the whole suite green, including `e2e/brand-contrast.spec.ts`, which now measures the Coming Soon stamp's white-on-accent text (6.03:1) and both card overlay texts (white on a black gradient). If brand-contrast fails naming the stamp, the fix is the colour, not the test.

- [ ] **Step 3: Prove each can fail**

Mutation one: in `Experiences.tsx`, change the stamp's `absolute top-4 right-4` to `absolute top-4 right-4 -z-10` and re-run. Expected: FAIL on the occlusion test, which now finds the image at the stamp's centre point. Revert.

Mutation two: render every card as a `<Link>` regardless of `comingSoon` and re-run. Expected: FAIL on both the click test and the keyboard test. Two, not one — if only the click test reddens, the keyboard test is not distinguishing anything. Revert.

Mutation three: change the track from `flex` to `grid grid-cols-2` and re-run. Expected: FAIL on the horizontal-scroll test. Revert.

- [ ] **Step 4: Close every browser**

```bash
pgrep -fl "Chrome for Testing|chromium" || echo "clean"
```

`browser.close()` has left orphaned renderers behind in this project before. Check, do not assume.

- [ ] **Step 5: Commit**

```bash
git add e2e/experiences-carousel.spec.ts
git commit -m "test(e2e): measure the carousel's geometry, occlusion and inertness

Six claims jsdom cannot make: that every card has a real box, that the track
is genuinely wider than its viewport, that a Coming Soon stamp wins the hit
test at its own centre point rather than merely existing, that a click and a
Tab both do nothing on a coming-soon card, and that a linked card navigates.

The keyboard case is what separates an inert element from a handler that
swallows a click; without it, making every card a Link and preventing
default would pass."
```

---

### Task 5: The nav dropdown gives way to the carousel

The spec's Phase 1 section says the dropdown "survives Phase 1 deliberately: removing it before the carousel exists would strand the four real pages with no route to them. Phase 3 replaces it with a link to the carousel." The carousel now exists.

**Files:**
- Modify: `src/content/pages.json`, `src/content/copy.json`
- Modify: `src/components/__tests__/NavBar.test.tsx`
- Modify: `e2e/experiences-carousel.spec.ts`

**Interfaces:**
- Consumes: the `#experiences` anchor from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Understand why this is a content edit and not a code edit**

`NavBar.tsx` does not have a hardcoded dropdown. It builds `pageEntries` from `pages.filter((page) => page.inNav && page.enabled)` and groups them behind a disclosure only when `pageEntries.length >= GROUP_PAGES_FROM` (2). Setting `inNav: false` on the four pages makes `pageEntries` empty, `grouped` false, and the disclosure disappears — with no change to `NavBar.tsx` at all.

That is the right lever, and the alternative — deleting the grouping code — was rejected. The grouping is a general mechanism with its own tests and its own carefully-argued open-never-toggle click behaviour; deleting it to satisfy one content decision would throw away a working control that a future page may want, and would make "bring the dropdown back" a code change instead of a checkbox.

**The consequence, stated rather than discovered later:** the dropdown is reversible from the dashboard. If the owner switches "Show in menu" back on for two or more pages, it returns. One page returning renders flat alongside the section links, not as a dropdown. Neither state is broken and both are hers to choose, which is the point — but it means "the dropdown is gone" is a content fact, not an invariant, and nothing in this plan asserts it as one.

- [ ] **Step 2: Turn the four pages out of the nav**

In `src/content/pages.json`, set `"inNav": false` on all four pages. Leave `"enabled": true` — the pages themselves stay live and reachable, now from the carousel.

- [ ] **Step 3: Add the carousel's nav link**

In `src/content/copy.json`, in `nav.links`, between the Menu and About entries:

```json
    {
      "href": "#experiences",
      "label": "Experiences",
      "section": "experiences"
    },
```

`section` is typed `SectionId`, and `narrowSectionId` (`src/content/guards.ts`) throws at import time for anything that is not one — which is precisely why `experiences` had to become a `SectionId` in Task 3 for this link to be expressible at all. The link's own `href` is the DOM anchor and its `section` is the id the nav uses to hide the link when the section is switched off; `types.ts`'s own comment on `SectionId` explains why the two are deliberately allowed to differ, and here they happen to agree.

Leave `nav.pagesLabel` ("Experiences") in place. It is still `Copy`'s required field, `CopyLeafShape` and `COPY_FIELDS` still cover it, and it still governs the disclosure if pages ever return to the nav. Deleting it would mean a `Copy` type change, an `assertCopy` change, and a `fields.test.ts` change to remove a working control for no gain. It stays excluded from `EDITABLE_TEXT_PATHS` for the reason `src/admin/editable-paths.ts` already gives at length.

- [ ] **Step 4: Update the nav tests**

`src/components/__tests__/NavBar.test.tsx` has a block for the pages disclosure. With no `inNav` page in the real content, tests that render the real content and expect a disclosure now fail. Do not delete them — convert them to render an **explicit fixture** with two `inNav` pages, so the grouping mechanism stays covered on its own terms, and add one test against the real committed content asserting the disclosure is absent and the Experiences *section link* is present.

That split matters: a test that only checked the real content would go green for the wrong reason if `GROUP_PAGES_FROM` were raised to 99, and a test that only used fixtures would never notice that the shipped site's nav had changed.

- [ ] **Step 5: Extend the e2e spec**

Add to `e2e/experiences-carousel.spec.ts`:

```ts
test('the nav offers Experiences as a section link, not a dropdown', async ({ page }) => {
  const nav = page.getByTestId('desktop-nav-links');
  await expect(nav.getByRole('button', { name: /experiences/i })).toHaveCount(0);
  const link = nav.getByRole('link', { name: /experiences/i });
  await expect(link).toHaveAttribute('href', '#experiences');
  await link.click();
  await expect(page.locator('#experiences')).toBeInViewport();
});
```

The `toBeInViewport` at the end is the part worth having: an anchor that points at an id which does not exist still renders, still clicks, and quietly does nothing.

- [ ] **Step 6: Run and prove**

```bash
npx tsc -b --noEmit && npm test -- --run && npx eslint .
```

Then, alone: `npx playwright test`.

Mutation one: set `"inNav": true` on two pages and re-run the browser spec. Expected: FAIL on the "not a dropdown" case, which now finds a button. Revert.

Mutation two: change the nav link's `href` to `#experience` (singular) and re-run. Expected: FAIL on the `toBeInViewport` assertion. Revert. This is the mutation that proves the click assertion is not vacuous.

- [ ] **Step 7: Commit**

```bash
git add src/content/pages.json src/content/copy.json src/components/__tests__/NavBar.test.tsx e2e/experiences-carousel.spec.ts
git commit -m "feat(nav): replace the Experiences dropdown with a link to the carousel

A content edit, not a code edit: the nav groups pages behind a disclosure
only when two or more carry inNav, so turning the four pages out of the menu
retires the dropdown with NavBar.tsx untouched. The grouping mechanism and
its tests stay, now covered by an explicit fixture, because deleting a
working control to satisfy one content decision would make bringing it back
a code change instead of a checkbox.

That also means the dropdown is reversible from the dashboard, and nothing
here asserts otherwise -- 'the dropdown is gone' is a content fact."
```

---

### Task 6: Catering's photo gallery

**Files:**
- Modify: `src/content/pages.json`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the gallery as a second template section**

The `gallery` template already exists (`GalleryTemplateContent`: `{ heading, layout: 'scroll' | 'grid', images: GalleryImage[], whatsapp? }`), `GallerySection` already renders it, and `PageRoute` already renders a page's `sections` in order. No type change, no compile sweep, no new component.

In `src/content/pages.json`, append to the Catering page's `sections` array, after the existing `detailBlock`:

```json
      {
        "kind": "template",
        "id": "catering-gallery",
        "template": "gallery",
        "enabled": true,
        "content": {
          "heading": "From recent events",
          "layout": "grid",
          "images": [
            { "src": "/atmosphere/table.webp", "alt": "A laid table set for a private dinner" },
            { "src": "/food/pizza1.webp", "alt": "A wood-fired pizza fresh from the oven" },
            { "src": "/food/arrosticini.webp", "alt": "Arrosticini, grilled and plated" },
            { "src": "/our_story/dinner.webp", "alt": "Guests seated for dinner" }
          ]
        }
      }
```

`layout: "grid"` rather than `"scroll"`: a page-level gallery of event photographs is browsed, not swiped past, and the homepage already has two horizontal scrollers competing for the same gesture.

A template section's `id` must be unique among *every* section id in that page's own list, must be a URL-safe slug, and must not collide with a `SectionId` — `validateSectionEntry` enforces all three, and `catering-gallery` satisfies all three (`catering` alone would not; it is already the id of the `detailBlock` above it).

- [ ] **Step 2: Record that these are placeholders**

**There are no catering photographs in this repository.** The spec's own Open Items says so: "Blocking nothing yet, needed before their phases: catering photographs". `validateTemplateContentFields` refuses an empty `images` list ("this section needs at least one image"), so shipping the gallery empty is not an available state — the page would be unpublishable from the dashboard the moment she touched it.

The four above are real, resolvable photos already on the site, chosen for plausibility and nothing more. Each is one click to replace from the Manage screen's Pages panel, which already renders every page's nested gallery through `PageList`/`TemplateSectionList` with a working `PhotoField`. Say this in the commit message so that the next person to look does not assume these were selected by anyone who had seen a catering event.

- [ ] **Step 3: Run**

```bash
npx vitest run src/content/__tests__/assets.test.ts src/content/__tests__/validate.test.ts src/content/__tests__/guards.test.ts
```

Expected: PASS. `assets.test.ts` now checks four more paths, discovered automatically by walking `pages.json` — no registration anywhere.

Mutation: change one `src` to `/atmosphere/Table.webp` (capital T) and re-run. Expected: FAIL naming that path. This is the check that matters on a macOS machine, where the filesystem is case-insensitive and the served one is not. Revert.

- [ ] **Step 4: Look at it**

```bash
npm run dev
```

Open `/catering`. The gallery sits below the detail block with its facts and its WhatsApp button. Confirm the grid is not clipped and the four photos are all present at both a phone width and a desktop width. This is a real-browser check because it is a layout claim.

- [ ] **Step 5: Gate and commit**

```bash
npx tsc -b --noEmit && npm test -- --run && npx eslint .
```

```bash
git add src/content/pages.json
git commit -m "feat(catering): add a photo gallery to the catering page

The gallery template, GallerySection and PageRoute's ordered section render
already existed, so this is content only -- no type, no component, no sweep.

All four photos are placeholders drawn from what is already on the site.
There are no catering photographs in this repository and the spec's own open
items say so, and the gallery template refuses an empty image list, so an
honest empty state was not available. Each is one click to replace from the
Pages panel."
```

---

### Task 7: Cooking Class's pamphlet hero

**Files:**
- Modify: `src/content/pages.json`

**Interfaces:**
- Consumes: `/experiences/pamphlet.webp` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Understand what "hero image" can mean here**

**The page model has no hero image field.** A `Page` is `{ slug, name, inNav, enabled, seo, sections }`, and `DetailBlockTemplateContent` — which is the only section the Cooking Class page has — is `{ heading, body, facts, whatsapp? }`. There is nowhere to put an image. This is a genuine disagreement between the spec ("Cooking Class gains `pamphlet.jpg` as its hero image") and the code, and it has two possible resolutions:

1. Add an optional `image` to `DetailBlockTemplateContent`. That is a `TemplateContentMap` change, so it moves `TemplateSection`'s discriminated union, which means `assertTemplateContent`, `validateTemplateContentFields`, `DETAIL_BLOCK_FIELDS` and `DetailBlockSection` all move with it — a four-file type change to place one photograph on one page.
2. Prepend a single-image `gallery` section. Sections render in document order, so a gallery placed first *is* the hero position, and it costs no type change at all.

**Take option 2.** Option 1 is the better model if several detail blocks ever want a photo, and it should be revisited then; today it would be a type change bought for one asset, and the spec's own instruction is about where the photo appears, not about how the type is shaped.

- [ ] **Step 2: Prepend the section**

In `src/content/pages.json`, insert **before** the existing `kids-class` detail block in the Cooking Class page's `sections`:

```json
      {
        "kind": "template",
        "id": "cooking-class-pamphlet",
        "template": "gallery",
        "enabled": true,
        "content": {
          "heading": "Sunday, 12pm",
          "layout": "grid",
          "images": [
            { "src": "/experiences/pamphlet.webp", "alt": "The cooking class pamphlet: Sunday at 12pm, four children, four dishes" }
          ]
        }
      }
```

The `alt` describes what the pamphlet *says*, because the pamphlet is text rendered as an image and a screen reader gets nothing from it otherwise. That is not decoration; it is the only route to the content for anyone who cannot see it.

- [ ] **Step 3: Record the pamphlet's known defects**

Written into the commit message and into this plan, not left to be rediscovered:

**`pamphlet.jpg` is Canva-made, its headings are green, and its illustration style differs from the rest of the site.** It works for now and the owner has been told it should be redesigned against the new palette later.

Nothing in the build will catch this. `e2e/brand-contrast.spec.ts` walks *text elements* and measures each against its computed background; the green here is pixels inside a JPEG, so there is no element and no computed style to measure. The retired-hex check (`#6B8B59`, `#5a7349` appear nowhere except `scripts/favicons.mjs`) is a source-text grep and does not read image data either. Both guards are working correctly and both are structurally blind to this. It is an accepted, temporary mismatch with a named owner and a named remedy, which is the only reason it is acceptable at all.

- [ ] **Step 4: Run and look**

```bash
npx vitest run src/content/__tests__/assets.test.ts src/content/__tests__/validate.test.ts
npm run dev
```

Open `/cooking-class`. The pamphlet is above the facts and the booking button. Check it at a phone width: the pamphlet is portrait-ish and a single-image grid can stretch it — if it does, the fix is in `GallerySection`'s existing `grid` layout classes and it must not change how the four-image Catering gallery lays out. Confirm both pages after any such change.

- [ ] **Step 5: Gate and commit**

```bash
npx tsc -b --noEmit && npm test -- --run && npx eslint .
```

```bash
git add src/content/pages.json
git commit -m "feat(cooking-class): put the pamphlet at the top of the page

A single-image gallery section prepended to the page's own section list,
rather than an optional image on DetailBlockTemplateContent. The page model
genuinely has no hero image field, and adding one would move the template
content map, the discriminated union derived from it, the assert, the
validator, the field descriptors and the component -- a four-file type
change to place one photograph on one page. Sections render in order, so
first IS the hero position.

The pamphlet was made in Canva, its headings are green and its illustration
style does not match the site. It works for now and should be redesigned
against the new palette later. Nothing in the build can catch this: the
contrast spec measures text elements against computed backgrounds and the
retired-hex check greps source, and green pixels inside a JPEG are invisible
to both."
```

---

### Task 8: The Experiences panel, and removing "Add a page"

The spec's own words: "She keeps editing text, prices, facts, and photos on the four real pages. 'Add a page' is removed. In its place: 'Add a coming-soon item'." Both halves are this task, together, because shipping one without the other leaves the dashboard either offering a page builder with no carousel editor or the reverse.

**Files:**
- Create: `src/admin/areas/ExperiencesArea.tsx`, `src/admin/areas/__tests__/ExperiencesArea.test.tsx`
- Modify: `src/admin/fields.ts`, `src/admin/content.ts`
- Modify: `src/admin/manage/areas.ts`, `src/admin/manage/ManageShell.tsx`
- Modify: `src/admin/PageList.tsx`, `src/admin/__tests__/PageList.test.tsx`
- Modify: `src/admin/manage/__tests__/areas.test.tsx`, `src/admin/__tests__/panel-snapshots.test.tsx`

**Interfaces:**
- Consumes: `Experience` and the validator from Task 2; `AreaProps` from `src/admin/areas/area-props.ts`; `fetchContent`, `registerLoaded`, `useValidation`, `RecordList`, `Thumbnail`, `fromStagedPhoto`.
- Produces: `EXPERIENCE_FIELDS: FieldsOf<Experience>`; `PanelId` gains `'experiences'`; `ContentFileName` gains `'experiences.json'`.

- [ ] **Step 1: The field descriptors**

In `src/admin/fields.ts`, beside `AWARD_FIELDS`:

```ts
export const EXPERIENCE_FIELDS: FieldsOf<Experience> = {
  id: {
    label: 'ID',
    kind: 'text',
    help: 'A short identifier used only to tell items apart -- changing it does not rename or relink anything else.',
  },
  title: { label: 'Title', kind: 'text' },
  description: {
    label: 'Short description',
    kind: 'textarea',
    help: 'One line, shown under the title on the card.',
  },
  image: {
    label: 'Photo',
    kind: 'image',
    category: 'experiences',
    help: 'Every card needs a photo -- the card is mostly photo.',
  },
  // The field she is NOT expected to fill in by hand, and the reason it is
  // 'text' rather than a 'select' over page slugs: FieldSpec's select branch
  // requires `options: readonly V[]`, a compile-time literal, and the set of
  // page slugs is runtime content she can change. A select built from a
  // stale literal would offer her a page that no longer exists, which is
  // worse than a text box. The validator refuses anything that is not a
  // site-relative slug path, and Experiences.tsx degrades an unresolvable
  // one to a coming-soon card, so a wrong value here is caught before
  // publish and harmless if it somehow lands.
  link: {
    label: 'Opens page',
    kind: 'text',
    help: 'Leave this blank for a coming-soon item. Otherwise a page on this site, like /catering.',
  },
  comingSoon: {
    label: 'Coming soon',
    kind: 'toggle',
    help: 'A coming-soon item shows a stamp and does not open anything. Turn this off only once it has a page to open.',
  },
};
```

`FieldsOf<T>` is `{ [K in keyof Required<T>]: FieldSpec<Required<T>[K]> }`, so `link`'s optionality does not exempt it — every key must be present. `Kind<V>` derives the legal `kind` values from the value type, so `comingSoon: boolean` can only be `'toggle'` and `image: string` can be `'image'` (which then *requires* `category`). Getting any of these wrong is a compile error naming this file, not a runtime surprise.

- [ ] **Step 2: Register the file**

In `src/admin/content.ts`:
- `CONTENT_FILES` gains `'experiences.json'`. Add a comment noting that unlike `awards.json` immediately above it, this one **is** a real file in the repository — the eleventh entry is D1-backed and the twelfth is not, and a reader who assumes the list is now uniformly one or the other will be wrong either way.
- `CONTENT_FILE_LABELS` gains `'experiences.json': 'Experiences'`. It is a total `Record<ContentFileName, string>`; omitting it does not compile.
- `ContentTypeMap` gains `'experiences.json': Experience[]`.

- [ ] **Step 3: The panel**

`ExperiencesArea.tsx` follows `AwardsArea.tsx`'s shape — `SectionErrorBoundary` → `CollapsibleSection` → a section component that loads through `fetchContent`, registers via `registerLoaded`, validates via `useValidation`, and commits via `registry.updateData`, with the list itself a `RecordList` over `EXPERIENCE_FIELDS`.

Three differences from `AwardsArea`, each of which needs its own comment in the file:

1. **No `ContentNotFoundError` branch.** `experiences.json` is a committed file that has existed since Task 2, so `fetchContent` never 404s for it. `AwardsArea`'s 404-as-empty-list handling exists because `awards.json` is a D1 row that does not exist until the first publish; copying that branch here would be dead code that reads like a real case.
2. **`onAdd` produces a coming-soon item.** This is the spec's "Add a coming-soon item" and it is why the button reads that way:

```tsx
// The spec's own replacement for "Add a page". A new item is ALWAYS
// coming-soon: `comingSoon: true` and no `link` at all. She cannot create a
// real page (Step 5 removes that button), so a freshly added item has
// nowhere it could legitimately point, and validateExperience refuses a
// not-coming-soon item with no link -- so seeding it any other way would
// hand her a record that is invalid the instant it appears.
//
// `image` is `''` rather than omitted, unlike blankAward's optional badge:
// Experience['image'] is required, and an omitted key would fail
// validateKnownKeys' shape check before she ever saw the field. Blank means
// the debounced validation immediately tells her a photo is needed, which is
// the same treatment every other required field on a fresh record gets.
function blankExperience(): Experience {
  return { id: crypto.randomUUID(), title: '', description: '', image: '', comingSoon: true };
}
```

   and the `RecordList` gets `noun="coming-soon item"` so the button reads "Add a coming-soon item" rather than "Add an experience".

3. **`onRemove` is offered.** `RecordList` renders Remove unconditionally and there is no prop to hide it. That is correct here — a coming-soon item she added is hers to delete, unlike a page, which has a live URL that may be linked from outside. Note the asymmetry in the file so it does not read as an oversight.

Staged uploads follow `AwardsArea` exactly: `onStaged={(key, staged) => stage(\`experiences.json:${key}\`, fromStagedPhoto(staged))}`, `previewKeyPrefix="experiences.json"`, and a `Thumbnail` reading `item.image`.

- [ ] **Step 4: Register the panel**

In `src/admin/manage/areas.ts`: `PanelId` gains `'experiences'`, `PANELS` gains `experiences: { id: 'experiences', heading: 'Experiences', file: 'experiences.json' }`, and `'experiences'` joins the `pages` area's `panelIds`. Place it **after `'sections'` and before `'awards'`**, mirroring the homepage order the section list itself now has.

`PANELS` is a total record over `PanelId`, so the compiler names the omission. The panel ids are frozen — `open-sections.ts` builds its localStorage key as `vb:section-open:v1:<id>` — so `'experiences'` is the id forever and renaming the heading later costs nothing.

In `ManageShell.tsx`, add `<ExperiencesArea {...areaProps} />` to the `pages` case, beside `<AwardsArea />`. No new `AreaSlug`, so the `never` exhaustiveness switch is untouched.

`src/admin/manage/__tests__/areas.test.tsx` pins the panel ids against what the dashboard renders — eleven becomes twelve. `src/admin/__tests__/panel-snapshots.test.tsx` has a comment saying "the eleven panels" and a committed snapshot; update the count, regenerate the snapshot, and **read the snapshot diff** rather than accepting it. A regenerated snapshot that silently absorbs an unrelated change is a test that stopped testing.

- [ ] **Step 5: Remove "Add a page"**

In `src/admin/PageList.tsx`, delete the button at the bottom (`onClick={() => onChange([...items, blankPage()])}`, label "Add a page") and the now-unused `blankPage()` helper — eslint will flag it if you leave it, and leaving a dead constructor for a capability that was deliberately removed is an invitation to restore it.

Add a comment where the button was:

```tsx
// "Add a page" was removed deliberately (Phase 3, and the spec's own
// decision, not an implementation choice): a general page builder is the
// thing that makes a dashboard frightening to a non-technical owner. She
// still edits every word, price, fact and photo on the four real pages
// above; what she cannot do is create a fifth. "Add a coming-soon item" in
// the Experiences panel is what took its place -- a carousel card with a
// photo, a title and a description and no route behind it -- and Taran
// builds a real page when one is genuinely needed.
//
// Removing the BUTTON, not the capability underneath: PageList still
// commits whatever array it is handed, so a page added by any other means
// still renders, and validatePages still checks it. This is a UI decision
// enforced at the UI, which is the right layer for it -- putting a
// "maximum four pages" rule in the validator would refuse a page Taran
// added on purpose.
```

`src/admin/__tests__/PageList.test.tsx` will have a case exercising the Add button. Replace it with the inverse: assert no control matching `/add a page/i` renders, and that the existing four pages are all still editable. That inverse assertion is the one that keeps the button from quietly returning.

- [ ] **Step 6: Tests**

`src/admin/areas/__tests__/ExperiencesArea.test.tsx`, with a stubbed `fetchContent`:

- renders two items and both are editable;
- pressing "Add a coming-soon item" calls `registry.updateData` with an array one longer whose new entry has `comingSoon: true` and **no `link` key at all** (`expect('link' in added).toBe(false)`, not `toBeUndefined()` — the two differ under `validateKnownKeys`);
- editing a title calls `registry.updateData` with the new array;
- an item edited into an invalid state surfaces the validator's own message through `useValidation`, so the panel is wired to the real validator and not to a stub.

- [ ] **Step 7: Run, prove, gate**

```bash
npx vitest run src/admin/
```

Mutation one: change `blankExperience` to return `comingSoon: false`. Expected: FAIL on the add case *and* on the validation case, because a not-coming-soon item with no link is refused. Two failures from one mutation is correct here — the validator and the panel agree about the same rule, which is what makes the panel's Add button safe. Revert.

Mutation two: restore the "Add a page" button. Expected: FAIL on the inverse assertion in `PageList.test.tsx`. Revert.

```bash
npx tsc -b --noEmit && npm test -- --run && npx eslint .
```

- [ ] **Step 8: Commit**

```bash
git add src/admin
git commit -m "feat(admin): add the Experiences panel and remove Add a page

The two halves of one decision, so neither ships alone. She can add a
coming-soon item -- a photo, a title, a description, no route behind it --
and she cannot create a real page, because a general page builder is the
thing that makes a dashboard frightening to a non-technical owner.

A new item is always coming-soon, with no link key at all rather than an
undefined one: the validator refuses a not-coming-soon item with no link, so
any other seed would hand her a record that is invalid the instant it
appears.

Removing the button, not the capability: PageList still commits whatever
array it is handed and validatePages still checks it, because a 'maximum
four pages' rule in the validator would refuse a page added on purpose."
```

---

### Task 9: Full gate, deploy, and verify in production

**Files:**
- Modify: `docs/cloudflare-cutover.md`

- [ ] **Step 1: The whole gate, locally, before anything is pushed**

```bash
npm run images
npx tsc -b --noEmit
npm test -- --run
npx eslint .
npm run test:csp
npm run test:deploy
```

All clean. `test:deploy` is run explicitly here, separately from `npm test`, because it is what Cloudflare Pages actually runs on the build machine and it excludes two files (`homepage-bytes`, `images.derivatives`) — a suite that passes locally and fails on Pages is the specific outage this step exists to prevent.

Then, on its own with nothing else running:

```bash
npx playwright test
```

Concurrent runs share port 8080 and produce phantom failures. If anything else is running, wait.

- [ ] **Step 2: Confirm nothing billable was enabled and nothing moved to D1**

```bash
grep -n "r2_buckets\|CONTENT_STORE" wrangler.toml
```

Expected: no `[[r2_buckets]]` block at all (R2 is still not enabled on the account — `wrangler r2 bucket create` fails with code 10042 pending a dashboard step that can require billing details), and `CONTENT_STORE = "github"` unchanged. Flipping that is not Phase 3's job.

```bash
npx vitest run worker/__tests__/store.test.ts
```

Expected: PASS, including Task 2's `D1_ONLY_PATHS` pin. Nothing this phase added went to D1.

- [ ] **Step 3: Push and let Pages build**

Push the branch and open the PR, or merge, per whatever the branch policy is. Watch the build. If it fails on unchanged, working code, retry once before investigating — three consecutive builds have failed that way on this project before, and a retry of an identical commit succeeded.

- [ ] **Step 4: Verify the deploy resolved to the new assets**

```bash
npm run verify:deploy
```

Do not skip the settle window. Fetching assets the instant the sha flips is what poisoned the asset cache once before, and the deploy script was changed specifically to resolve the deployment and read its assets rather than the local `dist`.

- [ ] **Step 5: Verify by hand, in a real browser**

On the live site:

1. The homepage shows the Experiences carousel between Drinks and Latest Stories, with six cards.
2. The nav shows an Experiences link, not a dropdown. Clicking it scrolls to the carousel.
3. Catering, Cheeseboards, Cooking Class and Membership cards each open their page.
4. Gifting and Retail show a Coming Soon stamp and do nothing on click or tap. Check on a phone as well as a desktop — the tap path and the click path are different code in the browser even though they are the same code here.
5. `/catering` shows the gallery below the detail block.
6. `/cooking-class` shows the pamphlet above the facts.
7. `/edit` renders the carousel and the heading and intro are inline-editable.
8. `/edit/manage/pages` shows the Experiences panel with six items, an "Add a coming-soon item" button, and **no** "Add a page" button.

- [ ] **Step 6: One real edit, end to end**

From `/edit/manage/pages`, add a coming-soon item: upload a photo, give it a title and a description, and publish. This is the operation the whole phase exists to enable and it is the only proof that the upload category, the derivative pipeline, the validator, the publish path and the carousel all agree.

Expected, watching it: the upload commits the source into `assets-source/experiences/`, the publish commits `experiences.json`, Pages builds, `npm run images` produces the derivative, and the new card appears. Two commits and one build cycle — slower than an Awards publish, which is the cost the storage decision buys and which was recorded rather than hidden.

Then delete it again and publish, and confirm the carousel returns to six.

- [ ] **Step 7: Record the state**

Add to `docs/cloudflare-cutover.md`: that `experiences.json` is a committed file on the GitHub store and is deliberately not in `D1_ONLY_PATHS`, so it migrates with everything else when `CONTENT_STORE` flips; that `assets-source/experiences/` is the eighth upload category; and that R2 is still **not created and not bound**, with enabling it in the dashboard still the outstanding user action before any phase needs owner-uploaded imagery at scale.

- [ ] **Step 8: Close every browser**

```bash
pgrep -fl "Chrome for Testing|chromium" || echo "clean"
```

- [ ] **Step 9: Commit**

```bash
git add docs/cloudflare-cutover.md
git commit -m "chore(docs): record Phase 3's storage and asset decisions in the runbook

experiences.json is committed JSON on the GitHub store and deliberately out
of D1_ONLY_PATHS, so it moves with everything else at cutover rather than
needing a special case. assets-source/experiences is the eighth upload
category. R2 is still neither created nor bound, and enabling it in the
dashboard remains the outstanding user action."
```

---

## Self-Review

**Spec coverage.** Phase 3 of the spec lists seven items.

- *An Experiences carousel on the homepage, replacing the nav dropdown*: Task 3 builds it, Task 5 retires the dropdown.
- *Each item carries an image, a title, a short description, an optional link and a `comingSoon` flag; items with a link navigate, items without render as static cards with a Coming Soon stamp and do not respond to clicks*: Task 2's `Experience` type and validator, Task 3's component, Task 4's browser proof. Inertness is a property of the element (a `<div>` with no `href`, no `onClick`, no `tabIndex`) rather than a suppressed handler, and Task 4 has a keyboard test specifically to distinguish those two.
- *Seeded with the four real pages plus Gifting and Retail as coming-soon*: Task 2, Step 4, with slugs read from the real `pages.json` rather than assumed.
- *Retail uses `retail.png` (1430x1100) through the derivative pipeline*: Task 1, capped at the 1000px default, output at `/experiences/retail.webp`.
- *Cooking Class gains `pamphlet.jpg` as its hero image*: Task 7, with the Canva/green-headings/style-mismatch note recorded in the plan, in the commit message, and with an explanation of why no automated guard can catch it.
- *Catering gains a photo gallery*: Task 6.
- *Heading and intro match the other sections' wording pattern and are editable, as is every item; she can add a coming-soon item but cannot create a real page*: Task 3 (copy plus the two `fields.ts` registrations, which give inline `/edit` editing for free through `EDITABLE_TEXT_PATHS`' derivation) and Task 8 (the panel, the Add button, and the removal of "Add a page").

**Where the spec and the real code disagree.**

1. **"Cooking Class gains `pamphlet.jpg` as its hero image" — there is no hero image field on a page.** `Page` has no image, and `DetailBlockTemplateContent` is `{ heading, body, facts, whatsapp? }`. Task 7 resolves it with a prepended single-image `gallery` section rather than by widening `TemplateContentMap`, because widening it moves the derived discriminated union and therefore the assert, the validator, the field descriptors and the component — four files for one photograph. Recorded as the deviation it is, with the condition under which option 1 becomes correct.
2. **"Catering gains a photo gallery" — there are no catering photographs**, which the spec's own Open Items admits, and `validateTemplateContentFields` refuses an empty image list. Task 6 seeds from existing photos and labels all four as placeholders rather than shipping an unpublishable section.
3. **The spec names no Gifting image**, and its Open Items explicitly leaves open "whether the Coming Soon header image the PR head mentioned is `retail.png` or a separate asset". Task 2 seeds Gifting from an existing photo and labels it. Four of the six seeded card images are placeholders; only the pamphlet and the retail photo are real supplied assets.
4. **"Replaces the nav dropdown" is a content edit, not a code edit**, and it is reversible from the dashboard. `NavBar.tsx` groups pages behind a disclosure whenever two or more carry `inNav`; nothing hardcodes an Experiences menu. Task 5 turns the four pages out of the nav and leaves the mechanism intact, and says plainly that the owner can bring it back.
5. **The spec's Phase 2 lists an `experiences` D1 table.** This phase creates none. The storage decision is argued at the top of this plan; the short form is that a D1-stored image path is invisible to `assets.test.ts`, every item's image is mandatory, and a new image needs a build whichever store holds the text.
6. **`SectionId` had already grown to eight**, not seven — Phase 2 added `awards`. Several comments in `types.ts`, `guards.ts`, `SectionList.tsx` and `EditMode.tsx` still say "seven" or "eight" in places; Task 3 updates the ones the union change touches and does not chase the rest. (One "seven" in `EditMode.tsx` counts `renderImage` call sites, not `SectionId` members, and was correctly left alone in Phase 2 — do not "fix" it back.)

**Deliberate deviations, with reasons.**

1. **Committed JSON rather than D1.** Argued in full above. Cost: every edit is a commit and a Pages build, on a build system recorded as intermittently flaky. Accepted because the operation this phase enables needs a build regardless, and because the alternative loses the asset guardrail on mandatory images and routes the commonest owner action through the least proven publish path.
2. **`link` is validated for shape only, never cross-checked against `pages.json`.** A cross-check is possible in `src/content/index.ts`, which imports every content file. It was rejected because switching a page off — a one-click, legitimate owner action — would then throw at import time, fail the build, and block every subsequent publish of every other file, which is precisely the outage `src/test/homepage-bytes.test.tsx`'s own header documents. `Experiences.tsx` resolves links at render time and degrades an unresolvable one to a Coming Soon card instead.
3. **`link` and `comingSoon` are both stored, and the validator refuses the two contradictory combinations.** The spec names both fields, so both exist; deriving one from the other would make the contradiction unspellable in the type and unexplainable to the owner. Refusing it in the validator is what puts a sentence in front of her instead.
4. **The basename hole in `RULES` is not closed.** Registering `'experiences.json'` also lets `assets-source/<category>/experiences.json` validate and commit, exactly as `awards.json` already does. Closing it means changing `worker/index.ts`'s `handlePublish` to pass the full path and either widening all twelve `RULES` keys or adding a second path-keyed table. `worker/index.ts` is not in this phase's scope. The comment states the hole accurately and does not repeat Phase 2's mistake of claiming a mitigation that a reviewer then ran and found false.
5. **`nav.pagesLabel` is kept even though nothing renders it today.** Removing it means a `Copy` change, an `assertCopy` change, and a `fields.test.ts` change, to delete a working control that governs the disclosure if a page ever returns to the nav.
6. **The Experiences panel offers Remove; the Pages panel does not.** A coming-soon card she added is hers to delete. A page has a live URL that may be linked from outside, and D6's "Add, never Remove" was written for exactly that. Noted in the file so the asymmetry reads as a decision.
7. **The carousel reuses `FoodGallery`'s scroller idiom rather than introducing a new one.** A second carousel implementation would mean a second set of touch, overflow and gradient behaviours to prove in `e2e/`.

**Placeholders.** Four of six card images (Catering, Cheeseboards, Membership, Gifting) and all four Catering gallery images are real, resolvable photos already in `public/`, standing in for photographs that do not exist yet. Every one is one click to replace from the Manage screen. They are placeholders in *content*, not in code: there is no `TBD`, no unimplemented branch, and no string anywhere that a build would have to resolve later. The only numeric placeholder is the homepage byte count in Task 3, Step 8, which is taken from the run rather than guessed and which the test itself refuses to let anyone skip.

**Type consistency across tasks.** `Experience` is deliberately *not* structurally identical to `Award`: `image` is required here and optional there, and the reason (a card is mostly photo; a badge is decoration) is written at the type. `EXPERIENCE_KEYS: Record<keyof Experience, true>` and `EXPERIENCE_FIELDS: FieldsOf<Experience>` are both total over the same type, so a field added to `Experience` without an entry in either is a compile error naming the file — the same guarantee `AWARD_KEYS`/`AWARD_FIELDS` already have. `ContentTypeMap['experiences.json']` is `Experience[]`, which is what makes `fetchContent('experiences.json')` return `LoadedContent<Experience[]>` with no cast in `ExperiencesArea`. `Copy['experiences']` is `{ heading: string; intro: string }`, structurally identical to `Copy['awards']` and `Copy['drinks']`, which is what lets `CopyLeafShape` describe it with two flat string leaves and `COPY_FIELDS` render it with the ordinary text/textarea treatment. `link?: string` is the one optional field in the phase and it propagates: `FieldsOf` uses `keyof Required<T>` so the descriptor is still mandatory, `validateKnownKeys` treats an absent key and an `undefined` key differently, and Task 8's Add test asserts `'link' in added === false` rather than `=== undefined` for exactly that reason.

**Ordering risk.** Task 1 must land before Task 3, or `assets.test.ts` fails the whole suite on `/experiences/pamphlet.webp`. Task 2 must land before Task 3, because `Experiences.tsx` reads `experiences` off the content context. Task 3 must land before Tasks 4, 5 and 8, all of which depend on the `#experiences` anchor, the `SectionId`, or both. Tasks 6 and 7 are independent of everything after Task 1 and can be done in either order or in parallel with Task 8 — but not by two concurrent writers against one working tree, which Phase 2 ruled out after a collision.
