# Phase 5B: the block editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kamalika can write, reorder and publish a blog post from `/edit/manage/story` without being told how, and the live copy of `posts.json` moves onto D1 so publishing is instant.

**Architecture:** A Posts panel in the Manage shell, built from the pieces the dashboard already has: `RecordForm` over `POST_FIELDS` for a post's scalar fields, and a bespoke `BlockList` for `blocks[]` — because `FieldsOf<Post>` is *uninhabitable* (`Kind<Block[]>` resolves to `never`), which is proven in the conflict scan below and is what forces the same bespoke-array shape `StoryForm.tsx` and `GalleryList.tsx` already take. Text inside a block is edited in a plain `<textarea>` with a bold/italic/link toolbar driven by `setSelectionRange` — no contenteditable, no rich-text library. Reordering is the existing Up/Down buttons plus HTML5 drag-and-drop as a second way, never the only way. Storage follows Phase 4's `story.json` fallback-then-swap exactly: the committed file stays as the first-paint fallback and the asset-walk anchor, D1 holds the live copy, and `/blog/:slug` gains a third state — loading — so a D1-only post cannot flash `NotFound`.

**Tech Stack:** Vite 5, React 18, TypeScript strict (solution-style tsconfig), Tailwind 3, react-router-dom 7, Vitest 3.2.7, Playwright, sharp (build-time only), Cloudflare Workers + D1 + KV. No new dependency.

**Spec:** `docs/superpowers/specs/2026-08-15-rebrand-and-content-platform-design.md` (Phase 5, line 211; the Editor paragraph, line 220)

**Parent plan:** `docs/superpowers/plans/2026-08-16-phase-5-blog.md` (5B outline at lines 4076-4094)

**Base commit:** `3025385` on `main`. Phase 5A is merged, deployed and verified live.

**Prior ledger, read it before Task 1:** `.superpowers/sdd/2026-08-16-phase-5-blog/progress.md`. Its last section lists six items carried into this plan; every one has a home below.

---

## Global Constraints

Every task's requirements implicitly include this section. Copied from the parent plan's Global Constraints, with the 5B deltas marked **[5B]**.

- **The gate is `npm run gate`.** In full: `npm run images && npx tsc -b --noEmit && npx eslint . && npm test -- --run && npm run test:deploy && npm run build`. Cloudflare Pages runs the subset `npm run images && npm run test:deploy && npm run build` (`docs/cloudflare-cutover.md`, confirmed against the Pages API and asserted by `src/test/hosting.test.ts`). **`npm run build` and `npm run test:deploy` are both mandatory for every task.** A green `npm test -- --run` alone has twice certified a branch CI rejected: once because the CSS ceiling test silently skips without `dist/`, once because `test:deploy` distributes files across workers differently and timed a test out. Two different commands cannot both be "the suite".
- **Run the gate AFTER `git add`, never before.** `src/admin/__tests__/content.test.ts` shells out to `git ls-files`. **[5B]** Task 3 changes exactly what that test derives, so this is not theoretical here.
- **Pushing requires `npx wrangler deploy` for any Worker change**, or the feature ships inert. Phase 4's final review caught exactly this: the runbook omitted it and `GET /api/published?path=story.json` 404'd in production while every test was green. **[5B] Tasks 9 and 12 change Worker files. A push without `npx wrangler deploy` ships the blog's read path inert.**
- **[5B] CSS: 38593 bytes against a 38700 ceiling, 107 bytes of headroom, verified by a real `npx vite build` at `3025385` (`dist/assets/index-3025385c-Dtw7xeoc.css`, 38593 bytes). 5B's budget is +48 and its expected result is 38641. Task 8 is the one task that raises the ceiling, 38700 to 38800.** See "The CSS budget, measured" below for the allowlist, the ban list and the two new rules. `npm run build` exits 1 the moment the ceiling is exceeded.
- **Every test must be able to fail, proven by a named mutation, and every task below states its mutations.** Seventeen tests that could not fail have been found in this project. Four failure modes to design against **by name**:
  - *`expect(x.length > 0)`.* Phase 5A's fourteenth: `Array.prototype.slice`'s negative-index wraparound returned a real but wrong non-empty result, so the assertion passed on broken behaviour. Assert equality against a literal, not non-emptiness.
  - *`not.toThrow()`.* Proves the code ran, not that it did anything.
  - *A present-but-empty fixture used to test absence.* `caption: ''` does not test a missing `caption`. Twice in two phases. **The key must be genuinely absent.**
  - *A test whose NAME claims more than its assertions check.* Three sightings, including two named "redirects to /blog" that only checked the index rendered.
  - **Every task's mutation table must include the mutation that would catch the thing the task is *for*, not only the mutations that are easy to write.** A mutation table is only as good as the mutations someone thought to list.
- **Never raise a timeout to make a red test green.** **[5B]** Both dashboard timeouts this project has had were fixed by making the query cheap. The pattern that worked: wait on a cheap `[data-*]` attribute, then assert the expensive role-and-name thing **once**. Task 10 owns this; every task that adds an `AdminApp.test.tsx` or `ManageShell.test.tsx` case uses it.
- **jsdom has no layout engine.** Geometry, occlusion, computed style, contrast and gesture claims go in `e2e/`. **Drag-to-reorder is a browser claim and belongs in `e2e/`, not in a jsdom test that proves only that a handler was called.** A `fireEvent.dragStart` test proves a handler was called and nothing about whether a block moved.
- **`e2e/` is not covered by the solution tsconfig** and never has been, across all eleven specs. Pre-existing and deferred by a recorded ruling; **do not fix it in this phase.** `npx eslint .` does cover `e2e/`.
- **Kamalika is the restaurant's chef and owner and she is not technical.** The standard for 5B: she could write a recipe post without being told how, and could not get stuck. Phase 4 shipped a panel that *crashed* the whole About section on a stale draft with no `chef` key, and the crash took the section heading down with it because `SectionErrorBoundary` wraps that too. **Every new panel reads its data defensively, and every new required field ships with a stale-draft test that restores the pre-feature shape and proves she can recover.**
- **Colour.** Brand `#C8D8E8` is a SURFACE colour only (1.45:1 on white). Foreground text and icons on light backgrounds use accent `#9D4949` (6.03:1); on dark backgrounds brand stays. Retired hexes `#6B8B59` and `#5a7349` appear nowhere except `scripts/favicons.mjs`. `e2e/brand-contrast.spec.ts` measures every text element against its effective background and structurally cannot reach text over a photograph.
- **Tailwind's content scanner is a plain text extractor with no JS parser.** A utility-looking token in a *comment* under `src/` emits a real CSS rule. **This fired three times in one 5A task and was caught each time only by a rule-level diff.** Words to avoid spelling bare in any comment or user-facing string this phase writes: `italic`, `underline`, `table`, `grid`, `block`, `inline`, `fixed`, `static`, `visible`, `hidden`, `resize`, `grow`, `shrink`, `capitalize`, `truncate`, `cursor-move`, `opacity-50`. `docs/` is outside the scanned globs (`tailwind.config.js`'s content is `['./index.html', './src/**/*.{js,ts,jsx,tsx}', '!./src/**/__tests__/**', '!./src/test/**']`, verified), so prose in *this file* costs nothing.
- **[5B] Tailwind's dev JIT never removes an already-generated class within one server session.** A CSS-removal mutation reads stale unless the dev server is cold-restarted. Any task that measures CSS after removing a class must stop and restart `npm run dev`, or build instead.
- **`/public/*/` is gitignored except `/public/menus/`.** Derivatives are build-time generated, never committed. `git add public/posts` fails with an ignored-file error and that is correct.
- **Do NOT touch `heroCollage` in `src/content/galleries.json`.** The user has explicitly demanded it stay exactly as it is. `git diff src/content/galleries.json` must be empty at the end of every task in this phase.
- **D1 free tier, verified against live Cloudflare docs 2026-08-15:** 5,000,000 rows read/day, 100,000 rows written/day, 5 GB/account, 500 MB/database, 10 databases. The entire content set is about 400 KB. **R2 is not enabled** (`wrangler r2 bucket create` returns code 10042, billing-gated) **and no paid Cloudflare resource may be created. If a task would need one, stop and say so.**
- **Never list Claude or any AI as co-author, and never mention AI in a commit message.**
- Typecheck is `npx tsc -b --noEmit`. Plain `tsc --noEmit` checks nothing; the tsconfig is solution-style.
- Run Playwright only when nothing else is running — port 8080 is shared and concurrent runs give phantom failures. Close every browser you open. **[5B] Flake watchlist, eight entries:** `dashboard-sections:392`, `collage-add-remove`, `page-galleries:125` and `:229`, `StatusStrip`, `NumbersArea`, plus `e2e/blog.spec.ts:81` and `:99-103` as predicted-not-observed. A single red among those that passes in isolation is a flake, not a regression. **Anything not on that list that goes red is a regression until proven otherwise** — 5A's Task 11 met an unlisted red (`hero-collage-after-farfalle.spec.ts:41`) that turned out to be machine contention, and the correct handling was to re-run serialised, alone, not to retry blindly.

---

## The six items carried forward from 5A, and where each lands

Straight from the ledger's closing section. A plan that does not account for all six is incomplete.

| # | Carried item | Home in this plan |
| --- | --- | --- |
| 1 | **`parseNodes` backtracks exponentially on an unclosed `[`.** Measured: 24 brackets = 1.6s, 30 = about two minutes. It is a **hang**, so the root `ErrorBoundary` cannot catch it. Unreachable today because the only authoring path is a committed JSON file; 5B's toolbar over a live `<textarea>` makes it a keystroke away. **A 5B ENTRY CONDITION.** | **Task 1, and it is first.** Fixed and mutation-proven before any task puts a textarea in front of the parser. Fix and numbers re-measured for this plan: see Task 1. |
| 2 | **2-4 `AdminApp.test.tsx` cases redden under heavy CPU load, at 5A's commit and at its parent alike.** Mechanism: a `findBy*` role-and-name sweep over the ~1200-element manage shell re-runs every 50ms, two thirds of the cost jsdom `getComputedStyle`, starving the render it polls for. 5B adds panels to that shell. | **Task 10 owns it**, and the cheap-attribute-then-assert-once pattern is mandated in Global Constraints so Tasks 3-9 do not add more of the bad shape. Task 3 adds the `data-panel` attribute the pattern needs. |
| 3 | **`PANELS[...].heading` has no production reader.** Renaming `PANELS.dishes.heading` to `'Dishez'` leaves all 40 cases in `ManageShell.test.tsx` green, because the painted heading is a literal in `MenuArea.tsx`. 5B adds `PANELS.posts`, so it inherits this. | **Task 3.** The new panel is the first to *read* the constant rather than duplicate it, with a mutation that pins the reading. **The ledger's claim is corrected there against a run of the real mutation — see the conflict scan, row S3.** |
| 4 | **`assertPosts` checks only that `post.image` is non-empty, while `validatePost` runs the full asset-path check on the same field.** | **Task 2**, with the both-ends test table `validate.test.ts` already uses for blocks. |
| 5 | **Flaky-spec watchlist:** `dashboard-sections:392`, `collage-add-remove`, `page-galleries:125` and `:229`, `StatusStrip`, `NumbersArea`, plus `e2e/blog.spec.ts:81` and `:99-103` as predicted-not-observed. | **Global Constraints** (so every task carries it) and **Task 12**, which runs the whole Playwright suite serialised and judges reds against the list. |
| 6 | **Two pending owner decisions.** The nine fabricated `press.json` entries, and `public/press/hotelier.webp` being the wrong asset (a social card whose baked-in headline the card crops mid-descender and then repeats as its own heading). | **"Pending owner decisions" below, and Task 12 Step 7**, which re-states both in the runbook as still open. **No task in this plan assumes either answer.** Task 11's homepage swap works identically at three posts or twelve. |

---

## Spec-vs-code conflicts this plan resolves

Each found by reading the tree at `3025385` or by running a real build or a real mutation. Where the spec and the code disagree, the code wins and this plan says so.

**1. `FieldsOf<Post>` cannot be constructed, so `RecordList<Post>` cannot compile. The 5B outline's Task 2 says the opposite.** The outline says "`RecordList` over `Post`'s scalar fields (`POST_FIELDS` in `fields.ts`), following `AwardsArea.tsx` shape for shape". `RecordListProps<T extends { id: string }>` requires `fields: FieldsOf<T>`, and `FieldsOf<T> = { [K in keyof Required<T>]: FieldSpec<Required<T>[K]> }` where `FieldSpec<V>`'s three branches are all keyed on `Kind<V>`. `Kind<Block[]>` matches none of `[string]`, `[string | null]`, `[string[]]`, `[boolean]`, `[number]`, so it is `never`, so all three branches of `FieldSpec<Block[]>` are uninhabitable. **Proven, not argued:** a probe file declaring `FieldsOf<Post>` with `blocks: { label: 'Blocks', kind: 'text' }` fails `npx tsc -b --noEmit` with `error TS2322: Type 'string' is not assignable to type 'never'` on that line; the same probe with `FieldsOf<Omit<Post, 'blocks'>>` compiles clean. **Resolution, Task 4: `export type PostMeta = Omit<Post, 'blocks'>` and `POST_FIELDS: FieldsOf<PostMeta>`, consumed by a bespoke `PostList.tsx` that renders `RecordForm<PostMeta>` plus `BlockList` per post.** That is the same shape `GALLERY_IMAGE_FIELDS: FieldsOf<Pick<GalleryImage, 'alt'>>` already uses and the same bespoke-array decision `StoryForm.tsx` and `GalleryList.tsx` both took. The outline's other sentence — "Blocks are handled outside `FieldsOf`/`RecordForm` entirely, the precedent `StoryForm.tsx` and `GalleryList.tsx` both set" — is the half that is right.

**2. Block problems land nowhere through `problemsFor`, and the loss is silent.** `validatePosts` emits `[0].blocks[2].text`. `problemsFor(problems, 0, 'blocks')` filters on `p.field === '[0].blocks'` exactly — a suffix match was deliberately rejected (`problems.ts`'s own comment) — so `[0].blocks[2].text` matches no rendered key. `RecordForm` then puts every *unmatched same-index* problem in its own form-level banner, so the message would appear on the post's banner rather than on the block that has the problem, and if `BlockList` also places it, it appears twice. **Resolution, Task 5: `PostList` partitions the problem list in both directions.** `RecordForm<PostMeta>` receives `problems.filter((p) => !isBlockProblem(p.field))`; `BlockList` receives the block half and owns all of it, with its own independently-written regex (`StoryForm.tsx`'s `PARAGRAPH_ITEM` precedent, and its own comment on why a shared regex would be wrong). This is a deliberate departure from the "not pre-filtered" contract `RecordForm`'s own `problems` prop documents, and Task 5 states it and pins the partition as exhaustive **in both directions** — the same posture that made `EDITABLE_TEXT_PATHS`' 27 + 11 = 38 partition trustworthy.

**3. `posts.json` is already accepted by `commitFiles`; the allowlist needs no change.** `CONTENT_PATH` in `worker/github.ts` is `/^src\/content\/[a-z0-9-]+\.json$/`, which `src/content/posts.json` matches today. Task 3 adds `'posts.json'` to `worker/__tests__/github.test.ts`'s `it.each` as an assertion, not as a fix — the same treatment `experiences.json` got, and for the same reason `story.json` stayed on that list after moving to D1: the allowlist is a security boundary on which paths the function will touch at all, not a map of which store owns a path's live traffic.

**4. Registering `posts.json` in `CONTENT_FILES` breaks every `e2e/` dashboard spec unless `e2e/edit-backend.ts` is updated in the same commit.** `EditMode.tsx`'s blanket load effect is keyed on `CONTENT_FILES`; `e2e/edit-backend.ts` holds its own copy of that list and answers 404 for any name not in it, which surfaces as a "Could not load posts.json" banner **above** the real page content and shifts everything every spec is about to measure. That file's own comment says so. **Task 3 adds `'posts.json'` there, and it stays there after Task 9 moves the live copy to D1** — the fixture serves `realContentJson('posts.json')` from disk, and the file still exists on disk.

**5. `panel-snapshots.test.tsx` and `owner-facing-labels.test.tsx` each iterate `Object.keys(PANELS)`, so Task 3 adds two test cases and one new snapshot automatically.** Vitest writes a missing snapshot on a local run and *fails* on it under CI. **Task 3 must read the written snapshot rather than accept it**, and must never run `vitest -u` — Phase 3 caught itself one keystroke from baking a real validation-error banner into a snapshot that way.

**6. The homepage swap is not in the 5B outline's nine tasks, and it is a spec requirement.** The spec says "'Latest Stories' disappears as a separate homepage section" (line 218). 5A's Task 9 was to do it and the ledger explicitly deferred it: *"Ruling: TASK 9 DEFERS THE HOMEPAGE SWAP TO 5B."* Verified at `3025385`: `src/components/blog/BlogSection.tsx` does not exist, `SECTION_COMPONENTS.press` is still `() => <BlogTeaser />` in both `src/App.tsx:54` and `src/admin/EditMode.tsx:108`, and `copy.json`'s `nav.links[4]` is still `{ href: '#blogs', label: 'Stories', section: 'press' }`. **The outline is incomplete and this plan adds Task 11 for it.** Phase 1's ruling for `ourStory` applies verbatim: rename the display, keep the id, keep the `#blogs` anchor because it is a live, possibly bookmarked URL. **No tenth `SectionId` is added.**

**7. `EMPTY_POSTS` in `src/admin/EditMode.tsx:279` stops being honest the moment a post surface exists, and its own comment says who owns it.** `/edit` builds its bundle from fetched entries via `pick`, whose key type is `ContentFileName`, so `pick(entries, 'posts.json', ...)` cannot typecheck while `posts.json` is out of `CONTENT_FILES`. Once Task 3 registers it, the constant must be read through `pick` like every file above it — otherwise `/edit` renders a zero-card blog against real posts live, which is Phase 3's `EMPTY_EXPERIENCES` defect verbatim and cost a full fix round. **Task 3 does the `pick`. Task 11 is what makes the surface visible, and it depends on Task 3 having done it.**

**8. `assertPosts`' image check is one level weaker than `validatePost`'s, and it is the only guard in front of a direct commit.** `assertPosts` (`guards.ts:785`) refuses a missing or blank `image` and nothing else; `validatePost` (`validate.ts`) also runs `isUnsafeAssetPath`. The dashboard path is safe because `validatePosts` catches it; the exposed path is a direct commit to `posts.json`, which is how posts are authored **today**. Same guard asymmetry 5A fixed one level down, in `assertBlock`/`validateBlock`. **Task 2.** The rules stay *duplicated* rather than delegated, deliberately: `validate.ts` imports `guards.ts`, so delegation would cycle through the module the Worker bundles. What keeps the copies honest is the both-ends test table, one row per refused shape checked at **both** ends.

**9. The spec's Phase 2 `posts` and `blocks` D1 tables are still not needed.** `worker/migrations/0001_content.sql` created one generic key-value `content` table, and `awards.json` and `story.json` both live in it as whole documents with optimistic concurrency, revisions, depth-20 undo, an ETag, a version-keyed cache and a snapshot fallback built on top. One `posts.json` document reuses all of it with **zero new Worker code beyond two allowlist entries**. `content_meta` is empty and `docs/cloudflare-cutover.md` records it as existing "for Phase 5 to use without a second migration" — **5B does not need it either, and Task 9 says so rather than inventing a use.**

**10. `scripts/build-snapshot.mjs` needs no change.** It does `SELECT path, body, version FROM content` over every row and keys the output on the public filename. Once Task 9 seeds `src/content/posts.json`, the snapshot picks it up automatically. `scripts/sync-posts-fallback.mjs` is the new script, and it is new because the *shape* check is document-specific.

**11. `DIR_MAX_WIDTH` needs no `posts` entry.** `scripts/paths.mjs`'s `DIR_MAX_WIDTH` is `{ hero: 500 }` and everything else falls through to `DEFAULT_MAX_WIDTH = 1000`. A post photo is a full-width figure inside `max-w-3xl`, so 1000 is right. `assets-source/posts/` does not need to exist before the first upload: `walk(SOURCE)` simply finds no files there, and `worker/upload.ts` commits into the directory on the first upload.

**12. The spec's R2 image path still does not exist.** Standing ruling from Phase 3 and Phase 4, unchanged. Post images go into `assets-source/posts/`, `npm run images` writes `public/posts/<name>.webp`, content references the derivative by its leading-slash path. **Task 4 adds `'posts'` to `UPLOAD_CATEGORIES` (eight members today, `src/shared/upload-categories.ts:15`), which `worker/upload.ts` enforces.** Nothing binds that list to the filesystem — `worker/__tests__/upload.test.ts:207` and `src/admin/__tests__/fields.test.ts:168` both check membership, never length — so adding a ninth member breaks nothing.

**13. `src/test/homepage-bytes.test.tsx:207` pins the rendered homepage at exactly 52355 bytes.** Task 11 changes what the `press` section renders and will move it. **Re-measure and hand-write the new number with an accounting comment. Never run `vitest -u`.** Phase 4's byte-delta comment was found attributing all 490 bytes to one source when it had two.

**14. `withLeaf` spreads the fetched object rather than rebuilding from `COPY_FIELDS`.** An unlisted copy leaf survives a publish. That is why 5A's fix round kept the five retired `blogsPage.*` **values** in `copy.json` while removing them from `COPY_FIELDS` — verified still true at `3025385`, where `copy.json`'s `blogsPage` carries all seven keys. **Task 11 must not delete any `copy.json` value.** Rebuilding from `COPY_FIELDS` instead would drop keys on the owner's next save and break every later build.

---

## The conflict scan

5A's plan carried fourteen defects found during execution, and its own two-couplings section is why the phase survived. This is the equivalent for 5B. **Read it before starting Task 3.**

### Pairs of tasks that share a file or an interface

One row per pair, naming what one produces against what the other consumes.

| # | Pair | Producer → consumer | What goes wrong in the wrong order | Severity |
| --- | --- | --- | --- | --- |
| C1 | **1 → 5, 6, 7** | Task 1 produces a `parseInline` that cannot hang. Tasks 5-7 put a `<textarea>` and a live preview in front of it. | The owner types `[`, the preview re-parses, the tab freezes for two minutes, and the root `ErrorBoundary` cannot catch a hang. **This is why Task 1 is first and is an entry condition, not a cleanup.** | **Blocking** |
| C2 | **3 ↔ 3** (couplings A and B, which point at each other) | Task 3 produces `CONTENT_FILES` containing `'posts.json'`, `PANELS.posts`, and the *deletion* of 5A's `content.test.ts` exception and its inverse assertion. | Split across two commits it is red either way. Register the file without the panel and `areas.test.tsx:95` fails ("every panel names a real content file, and every content file has a panel"). Add the panel without registering and `PANELS.posts.file` has no `ContentFileName` to name, which is a `tsc -b` error. Delete the exception without registering and `content.test.ts` fails because `git ls-files` sees a real file `CONTENT_FILES` does not list. **Verified from three directions during 5A: registering `posts.json` reddened 2 cases in `content.test.ts`, 1 in `areas.test.tsx`, and produced 13 `tsc` errors.** **ONE COMMIT.** | **Blocking** |
| C3 | **3 → all e2e dashboard specs** | Task 3 produces a `CONTENT_FILES` that `EditMode.tsx`'s blanket fetch iterates; `e2e/edit-backend.ts` consumes its own copy of that list. | Any name missing from `e2e/edit-backend.ts`'s list is answered 404, which paints a "Could not load posts.json" banner above the content every spec measures — shifting geometry in `dashboard-sections`, `page-galleries` and `collage-*`, four of which are already on the flake watchlist. Task 3 must update it **in the same commit**, or Task 12's Playwright run fails for a reason nothing in the diff explains. | **Blocking** |
| C4 | **3 → 4, 5, 10** | Task 3 produces `data-panel="posts"` on the Posts panel container and `PANELS.posts.heading` as the *painted* heading. Tasks 4, 5 and 10 consume the attribute as the cheap wait target. | Without the attribute, every new dashboard test has to `findByRole('heading', { name: 'Posts' })` over a shell that Task 3 has just made larger — the exact query shape that has nearly refused a production deploy twice. | High |
| C5 | **4 → 5** | Task 4 produces `PostMeta`, `POST_FIELDS`, `blankPost()`, and `PostList.tsx` with a `BlockList` seam already cut but stubbed to render nothing. Task 5 fills the seam. | If Task 4 renders `RecordForm<PostMeta>` with the **unfiltered** problem list, block problems land in the post's banner; Task 5 then also places them on their block and the owner sees every message twice. Task 4 must ship the `isBlockProblem` partition and its both-directions test **before** `BlockList` exists, with `BlockList`'s stub rendering the block half as a banner so nothing is lost in between. | High |
| C6 | **5 → 6** | Task 5 produces `BlockList`'s `onChange(next: Block[])` contract and `BLOCK_KIND_LABELS`. Task 6 produces `blankBlock(kind: BlockKind): Block` and calls `onChange([...blocks, blankBlock(kind)])`. | `blankBlock` must produce a record `assertBlock` accepts *and* `validateBlock` reports on. Get it wrong the other way — omit a required key — and 5A's `assertBlock` fix throws at the next build on content already committed. Task 6's mutation table checks both ends per kind. | High |
| C7 | **6 → 2, and 6 → guards.ts** | Task 6 consumes `BLOCK_KINDS` from `guards.ts` and produces `BLANK_BLOCK: Record<BlockKind, () => Block>`. | `assertBlock` "duplicates `validateBlock`'s rules rather than delegating", deliberately, and the mitigation is a test table checking every refused shape at **both** ends per row. A `blankBlock(kind)` factory that produces a shape only one end accepts breaks that guarantee silently. Task 6 adds one row per kind to the existing both-ends table rather than a new table of its own. | High |
| C8 | **7 → 1** | Task 7 consumes `isSafeHref` from `src/content/markdown.ts` — the function 5A rewrote to normalise through `new URL(...).origin` rather than pattern-match. Task 1 modifies the same module. | Task 1 must not touch `isSafeHref`, `isSiteRelativePath` or `rawLinkTargets`. `/\evil.example` resolves to `https://evil.example/`, and so does `/` + TAB + `/host`; `/%5C` is deliberately **accepted** (a percent-encoded backslash stays on-origin). Task 1's diff is `parseNodes`/`tryLink`/`tryDelimited`/`parseInline` and the `Cursor` interface, nothing else. **Task 1's Step 6 greps its own diff to prove it.** | High |
| C9 | **8 → 5** | Task 8 consumes `BlockList`'s move handler and produces drag handlers plus **the two new CSS rules and the ceiling raise**. | The ceiling raise is measured against a worktree checkout of the **true parent commit** — Task 7's commit — never a stash. If Task 8 lands before Task 5, there is no list to attach a handle to. If Task 8's measurement is taken against a stash, the number is wrong; several numbers in `bundle.post-build.test.ts`'s own comment had to be corrected for exactly that. | High |
| C10 | **8 ↔ 4, 5, 6, 7, 11** | Task 8 produces the *only* authorised CSS delta in this phase (+48, two rules). Tasks 4-7 and 11 produce components. | Any class in Tasks 4-7 or 11 that is not already in the bundle silently eats Task 8's 159-byte margin, and a byte count cannot tell "one rule added" from "two added and one removed". **Every one of those tasks runs a rule-level diff and must see `ADDED: []`.** | High |
| C11 | **9 → 4, 5, 6, 7** | Task 9 consumes the finished panel and produces `D1_ONLY_PATHS`/`PUBLIC_FILES` entries plus `posts-api.ts`. | Moving storage before the editor exists is what 5A's decomposition deliberately avoided: "instant publishing buys exactly nothing until something other than a script can write a post". Moving it *after* also means the seed script seeds a file whose shape the panel has already exercised. | Medium |
| C12 | **9 → 11** | Task 9 produces `usePosts()`, the loading/loaded/error hook. Task 11 consumes it in `BlogSection`. | If Task 11 lands first, `BlogSection` reads `useContent().posts` — the compiled-in fallback only — so the homepage silently shows stale posts after every publish while `/blog` shows fresh ones. Two surfaces, one content, two answers. **Task 11 after Task 9.** | High |
| C13 | **9 → 12** | Task 9 produces the first Worker change in this phase. Task 12 consumes it as a deploy step. | A push without `npx wrangler deploy` leaves `GET /api/published?path=posts.json` 404ing in production while the frontend already expects it. The site does not break — the compiled-in fallback renders — but the feature is inert and every test is green. Phase 4's final review caught exactly this. | **Blocking** |
| C14 | **11 → homepage-bytes, section-order, press tests** | Task 11 produces a different `press` section render. `src/test/homepage-bytes.test.tsx:207` consumes the exact byte count (52355 today). | Phase 3's tenth unfalsifiable test was created by a legitimate content edit, not a bad test: the edit stripped a test of its power to fail without touching a line of test code. Task 11 changes what the homepage renders, so it must re-check `src/components/__tests__/press.test.tsx`, `src/test/section-order.test.ts` and `src/content/__tests__/sections.test.tsx` for vacuity **by running them and recording the result, not by asserting it**. | High |
| C15 | **11 → 14 (conflict), `copy.json`** | Task 11 relabels `nav.links[4].label` from `'Stories'` to `'Blog'` and adds `copy.press.*` reuse. | `withLeaf` spreads the fetched object, so an unlisted leaf survives a publish — which is why the five retired `blogsPage.*` values are still in `copy.json`. **Task 11 must not delete any value from `copy.json`**, and must not add a `COPY_FIELDS` leaf without updating the pinned literal counts (33 fields, 6 excluded, `EDITABLE_TEXT_PATHS` 27). | High |
| C16 | **2 → 9** | Task 2 produces an `assertPosts` that refuses an off-site card image. Task 9 produces `scripts/sync-posts-fallback.mjs`, which writes `src/content/posts.json` from a D1 row. | `assertPosts` runs at *import* time, so a bad row synced into the file breaks `tsc -b` and blocks every subsequent deploy — including the one that would fix it. `sync-story-fallback.mjs`'s own comment says exactly this. Task 9's script must refuse to write anything `assertPosts` would refuse, and its guards exist for the write paths that never reach `handlePublish` (`seed-posts-d1.mjs`, a hand-run `wrangler d1 execute UPDATE`). | High |
| C17 | **10 → 3, 4, 5, 6, 7** | Task 10 consumes every panel built above it and produces the stale-draft proof. | A stale draft restores through `registerLoaded`'s unchecked `draftEntry.data as ContentTypeMap[K]` cast, so a draft saved before 5B existed has **no `posts.json` entry at all** and one saved mid-5B may have posts with no `blocks` key. Every read of `post.blocks` in Tasks 4-7 must already be defended; Task 10 proves it and is not the place to add the defences. Each of Tasks 4-7 carries its own `?? []` and its own mutation for it. | High |
| C18 | **12 → 8** | Task 12 consumes the raised ceiling as its expected build number. | Task 12's expected CSS is **38641 against a 38800 ceiling**, not 38593 against 38700. A gate task that reads its own output as the answer proves nothing; it must be given the number in advance so it can spot a deviation. | Medium |

**Verdict on the outline's own claim.** The outline says coupling A and coupling B "point at each other, which is why its Task 1 must be a single commit". **Verified against the real code and the claim holds, and is in fact stronger than stated:** it is not two-way but three-way. `src/admin/__tests__/content.test.ts:128-134` derives from `git ls-files src/content` with `.filter((f) => f !== 'posts.json')`; `src/admin/manage/__tests__/areas.test.tsx:95` asserts `EXPECTED_PANEL_IDS.map((id) => PANELS[id].file)` equals `CONTENT_FILES` sorted; and `PanelDefinition.file` is typed `ContentFileName`, so the panel cannot even be *spelled* before the registration. The third leg is a compile error rather than a test failure, which is why 5A's own mutation of this coupling produced 13 `tsc` errors alongside the 3 test failures. **Conflict C3 is a fourth leg the outline does not mention at all** and it is the one that would have cost a task, because its symptom appears only in Playwright.

### Does each task's own text agree with itself?

One row per task. This is the self-consistency pass, run after the task bodies were written.

| Task | Internal contradiction found | Resolution in the text |
| --- | --- | --- |
| 1 | The first draft claimed the fix "degrades deeply nested input to literal text". Measured: `'['.repeat(40) + 'x](https://example.com)'` returns `[text('[' × 39), link]` — **byte-identical to the current parser**, because the innermost `[` is the one that opens the link and every outer attempt fails at depth 0. | Claim removed. The test asserts the **measured** output rather than a believed rule, and the comment says only what the depth cap actually buys: no stack overflow, and no behaviour change at any nesting depth ≤ 32. |
| 2 | None. The task modifies one function and adds table rows. | — |
| 3 | The first draft said "give `PANELS[].heading` a production reader" and cited the ledger's "no production reader" claim. **Running the mutation showed the ledger is only half right** — see row S3 below. | The step now states the corrected fact, and the new panel still reads the constant (which is the right design regardless), with a mutation that pins the reading specifically rather than relying on the two files that already catch a rename. |
| 4 | The outline's "`RecordList` over `Post`'s scalar fields" contradicts its own "blocks handled outside `FieldsOf`/`RecordForm` entirely". Only the second is compilable. | Conflict 1 above. `PostList.tsx` is bespoke; the outline's first sentence is discarded with the `tsc` error that discards it. |
| 5 | The first draft passed `RecordForm` the unfiltered problem list "as every other screen does" while also placing block problems on blocks — double display. | Conflict 2 above. The partition is explicit, stated as a deliberate departure, and pinned in both directions. |
| 6 | None found. `BLOCK_KINDS` is derived from `BLOCK_KIND_SET`, which is `Record<BlockKind, true>`, so an eleventh kind is a compile error in three places before it can reach the picker. | — |
| 7 | The first draft said the toolbar "rejects an unsafe link at paste time" and also that `validatePosts` would catch it. Both are true and they are different boundaries; saying only the first would imply the second is unnecessary. | Both stated, with the reason they are not redundant: the toolbar tells her at the moment she pastes, `validatePosts` refuses at publish, and neither can be removed on the strength of the other. |
| 8 | The outline's "+48 bytes … against a measured 38641" was not re-measured after 5A shipped. | **Re-measured for this plan against a real `npx vite build` at `3025385`: 38593 → 38641, `ADDED: ['cursor-move', 'opacity-50']`, `REMOVED: []`.** The number is now this plan's own, not inherited. |
| 9 | The first draft had `usePosts()` returning `Post[]` with `[]` while loading — which is exactly the `NotFound` flash the outline says to prevent. | The hook returns a discriminated state, and `/blog/:slug` branches on it. The test asserts the loading state renders **while the fetch is pending** and `NotFound` **only after it settles**. |
| 10 | The first draft asserted "no crash" with `not.toThrow()`. That is one of the four named tells. | Replaced with assertions on what is on screen: the panel heading is present, each problem lands on its own field by `aria-describedby`, and the Publish button becomes enabled after the fields are filled. |
| 11 | The first draft deleted `copy.blogsPage.title` and friends as "now unreachable". | Conflict 14/C15. Values stay; only `nav.links[4].label` changes, and the homepage byte count is re-measured by hand. |
| 12 | None. | — |

### Claims checked against the real code, with the result

| # | Claim, as inherited | Verdict |
| --- | --- | --- |
| S1 | `npx tsc -b --noEmit` is the only typecheck that works | **Confirmed by use.** The `FieldsOf<Post>` probe was caught by `tsc -b`. |
| S2 | CSS is 38593 with a 38700 ceiling, 107 free; `cursor-move` and `opacity-50` are genuinely absent | **Confirmed by a real build.** `dist/assets/index-3025385c-Dtw7xeoc.css` is 38593 bytes; `grep -o '\.cursor-move[,{:]'` and `'\.opacity-50[,{:]'` both return 0. **Bonus for Task 8: `select-none` and `cursor-pointer` already ship, so a drag handle can use both at zero cost.** |
| S3 | `PANELS[...].heading` has no production reader, so renaming it leaves everything green | **HALF FALSE, and this is the claim the real code contradicts.** No *production* module reads `.heading` — confirmed, the only non-test readers are `e2e/dashboard-sections.spec.ts:119,126,133`. But two files inside `npm run gate` do read it and both go red on the rename. **Ran the mutation** (`PANELS.dishes.heading` → `'Dishez'`, then `npx vitest run` over the four candidate files): `2 failed | 75 passed`. `areas.test.tsx` and `ManageShell.test.tsx` stayed green exactly as the ledger says; `src/admin/__tests__/panel-snapshots.test.tsx:51` and `src/admin/__tests__/owner-facing-labels.test.tsx:54` both failed on `findByRole('button', { name: heading })`. So the constant is **not** unpinned, and the ledger's sibling claim that `ManageShell.test.tsx:182` drives a loop off it is off by one file and one line — the loop is at `ManageShell.test.tsx:214`, and it is a `queryByRole(...).not.toBeInTheDocument()` **absence** assertion, which is the genuinely weak half: it passes vacuously whatever string the constant holds. |
| S4 | `assertPosts` checks only `post.image` non-empty | **Confirmed**, `guards.ts:785-787`. `validatePost` runs `isUnsafeAssetPath` on the same field. |
| S5 | `assertBlock` duplicates `validateBlock` rather than delegating, and the mitigation is a both-ends table | **Confirmed**, `guards.ts:855-861` states the import-direction reason in its own comment. |
| S6 | `withLeaf` spreads rather than rebuilding, so an unlisted leaf survives a publish | **Confirmed by consequence:** `copy.json`'s `blogsPage` still carries all seven keys while `COPY_FIELDS` lists two. |
| S7 | The 5A outline's nine tasks are complete | **FALSE.** The deferred homepage swap is missing. Conflict 6. |
| S8 | `RecordList` can render posts | **FALSE.** Conflict 1, proven by `tsc`. |
| S9 | `parseNodes` backtracks exponentially on `[`; 24 brackets ≈ 1.6s, 30 ≈ two minutes | **Confirmed, and re-measured on a faithful port of the shipped file.** 14 brackets 2ms, 18 15ms, 20 59ms, 22 229ms, 24 906ms, 26 3646ms — a clean 4× per two brackets, i.e. 2^n. 40 brackets did not finish in 120 seconds. **`**` is NOT affected**: `'**'.repeat(26)` parses in 0ms and `'*'.repeat(2000)` in 1ms, because an emphasis run stops at the next standalone `*` and succeeds. The hazard is `[` alone. |

---

## The CSS budget, measured

**Measured for this plan, against a real `npx vite build` at `3025385`. Not inherited.**

```
before: 38593 bytes   dist/assets/index-3025385c-Dtw7xeoc.css   (ceiling 38700, 107 free)
probe:  one component with className="cursor-move opacity-50"
after:  38641 bytes   (delta +48)
ADDED:   [ 'cursor-move', 'opacity-50' ]
REMOVED: []
```

**The whole of 5B's CSS cost is those two rules, and only Task 8 spends them.** `cursor-move` on the drag handle is the entire discoverability of drag-to-reorder for someone who has never dragged a block before; `opacity-50` on the dragged block is what tells her which one is moving. Both are worth their 48 bytes and neither is decoration.

**Task 8 raises the ceiling once, 38700 to 38800, against a measured 38641.** That is a **159-byte** margin, inside this lineage's own 115-250 band, which `src/test/bundle.post-build.test.ts`'s comment tracks for every prior raise. Task 8 carries the rule-level diff and appends its own entry to that comment's history, naming both rules and their sources.

**Free for the taking, already in the bundle, verified by grep at `3025385`:** `select-none`, `cursor-pointer`, `bg-white`, plus the 479-selector set 5A's components were built from. The drag handle uses `cursor-move select-none` — one new rule, not two.

**Already-shipping utilities Tasks 3-7 and 11 build from, cost 0.** `mb-6` `mb-4` `mb-3` `mb-10` `mt-2` `mt-4` `max-w-7xl` `max-w-3xl` `mx-auto` `p-3` `p-4` `p-6` `px-3` `px-4` `py-1` `py-2` `py-20` `pl-5` `gap-2` `gap-4` `gap-8` `space-y-2` `space-x-4` `grid` `grid-cols-2` `sm:grid-cols-3` `md:grid-cols-2` `lg:grid-cols-3` `flex` `flex-wrap` `items-center` `justify-between` `justify-center` `w-full` `h-48` `object-cover` `rounded` `rounded-lg` `rounded-2xl` `rounded-full` `border` `border-2` `border-dashed` `border-gray-200` `border-gray-300` `border-red-300` `border-brand` `bg-brand` `bg-brand/10` `bg-cream` `bg-gray-50` `bg-red-50` `bg-slate-50` `bg-white` `text-center` `text-xs` `text-sm` `text-lg` `text-2xl` `text-4xl` `md:text-5xl` `text-ink` `text-accent` `text-red-600` `text-red-700` `text-white` `text-gray-500` `text-gray-600` `text-gray-700` `font-bold` `font-semibold` `uppercase` `tracking-wide` `leading-relaxed` `leading-tight` `list-disc` `list-decimal` `shadow-lg` `hover:shadow-2xl` `hover:bg-brand` `hover:bg-brand/10` `hover:bg-red-600` `hover:bg-gray-50` `hover:text-ink` `hover:text-white` `hover:text-accent` `hover:text-accent-dark` `group` `group-hover:scale-110` `group-hover:text-accent` `transition` `transition-all` `transition-colors` `transition-transform` `duration-300` `duration-500` `transform` `hover:scale-105` `overflow-hidden` `relative` `absolute` `inset-0` `top-4` `left-4` `bg-gradient-to-t` `from-black/30` `via-transparent` `to-transparent` `min-h-screen` `select-none` `cursor-pointer` `font-['Montserrat']` `font-['Open_Sans']`

**Banned outright, with the measured cost from 5A, so nobody rediscovers it:** `font-mono` (+111 — would have breached 5A's ceiling by 4 bytes), `italic` (+26, and unnecessary: preflight has no `em` rule, so `<em>` is slanted by browser default), `font-bold` on markdown strong (unnecessary: preflight ships `b,strong{font-weight:bolder}`), `md:grid-cols-3` (use `sm:grid-cols-3`), `aspect-square` (use `h-40`/`h-48`), `list-inside`, `whitespace-pre-wrap`, `break-words`, `resize-y`, `text-justify`, `gap-5`, `mt-5`, `mb-5`, `p-5`, `cursor-grab`, `ring-2`, `ring-brand`. A probe of thirteen "comfortable" utilities measured **+427**, a 282-byte breach.

**Verify before using anything not on the allowlist:** build, then `grep -o '\.the-class[,{:]' dist/assets/index-*.css`. A miss costs 25-40 bytes and Task 8 leaves 159 to spend.

**The rule-level diff is mandatory, and a stash is not a baseline.** Every task that introduces a `className` runs it. Several numbers in `bundle.post-build.test.ts`'s own comment had to be corrected later because a stash baseline produced wrong results.

---

## Pending owner decisions

**This plan does not resolve either of these and no task assumes an answer.**

**U1. The nine invented `press.json` entries.** Twelve entries; three carry a real, resolvable URL and their own publication logo (BW Hotelier, Delhi Royale, Restaurant India) and became Mention posts in 5A. The other nine have `url: null`, publications that read as invented, and images borrowed from elsewhere — **6 from `/food/`, 2 from `/mocktails/`, and 1 from `/team/kamalika-anand.webp`**, the chef portrait; the earlier claim that they were all food and mocktail images was incomplete and is corrected here. Options: (a) leave them unrendered, which is what ships today; (b) migrate all twelve and publish nine fabricated citations; (c) delete the nine. **Not blocking:** after Task 9, moving any of them is a data edit through the editor this plan builds, not a code change. `src/content/__tests__/shape.test.ts` pins the three, so a fourth appearing without her decision fails the build — **Task 9 must keep that pin working against the D1 copy too, and Task 9 Step 8 says how.**

**U2. `public/press/hotelier.webp` is the wrong asset for its post.** It is a BW Hotelier social card with the headline baked into the pixels; `PostCard`'s 2:1 cover box clips its second line mid-descender, and the card then repeats the same headline in full as its own `<h3>`. It is her press asset, so it is her call. **Not blocking:** it is one path she can change from the Posts panel the moment Task 4 ships, and no task in this plan touches it.

**Also recorded, and explicitly out of scope:** the owner has acquired `viabiancadelhi.com` at GoDaddy. **Do not begin the cutover on any task in this plan.** The Worker route must move with the site in the same cutover (the session cookie is `SameSite=Strict` with no `Domain=`, so it is host-only), the Web Analytics tag is bound to the `aionxxxi.uk` zone, six hostnames are hardcoded, and a nameserver switch that drops MX kills her email silently. That is its own plan and its own explicit yes.

---

## Twelve tasks, in order

The outline named nine. Three were added and each has a reason: two are 5A's carried-forward defects, which have to be fixed where they are cheap rather than discovered where they are expensive, and one is a spec requirement the outline omitted entirely.

| # | Task | Why it is where it is |
| --- | --- | --- |
| 1 | The parser can no longer hang | **Entry condition.** Nothing may put a textarea in front of `parseInline` before this. Carried item 1. |
| 2 | `assertPosts` checks the card image | Carried item 4. Cheap now, and Task 9's sync script depends on it. **Not in the outline.** |
| 3 | Register `posts.json` and give it a panel — one commit | The outline's Task 1. Three-way coupling plus a fourth leg only Playwright sees. Carried item 3. |
| 4 | `POST_FIELDS`, `PostList`, the panel for real | The outline's Task 2, with its `RecordList` claim replaced by what compiles. |
| 5 | `BlockList` — every block's fields, Up/Down/Remove | The outline's Task 3. |
| 6 | The block picker and `blankBlock(kind)` | The outline's Task 4. |
| 7 | The formatting toolbar | The outline's Task 5. Depends on Task 1 for safety and on 5A's `isSafeHref` for correctness. |
| 8 | Drag to reorder, and the ceiling raise | The outline's Task 6. The only task authorised to raise the ceiling. |
| 9 | `posts.json` onto D1 | The outline's Task 7. First Worker change. |
| 10 | The stale draft and the query-cost pattern | The outline's Task 8, plus carried item 2. |
| 11 | The homepage `press` section becomes the blog | 5A's deferred Task 9, a spec requirement. **Absent from the outline.** Must follow Task 9. |
| 12 | Gate, `npx wrangler deploy`, verify, runbook | The outline's Task 9. Carries items 5 and 6. |

## File Structure

**Created.** Four small `.ts` modules rather than one, each with one responsibility — and plain `.ts` rather than `.tsx` because `eslint`'s `react-refresh/only-export-components` flags a `.tsx` exporting both a component and plain values, the split `src/components/awards-api.ts` and `src/components/blog/posts.ts` already made:
- `src/admin/blocks/block-problems.ts` (Task 4) — `isBlockProblem(field)`, `blockProblemOf(field)`, `BlockProblemTarget`. Where a `posts.json` problem belongs on screen.
- `src/admin/blocks/block-meta.ts` (Task 5) — `BLOCK_KIND_LABELS`, `BLOCK_KIND_HELP`. What each kind is called in her words.
- `src/admin/blocks/blank-block.ts` (Task 6) — `BLANK_BLOCK`, `blankBlock(kind)`. The factory the picker calls.
- `src/admin/blocks/reorder.ts` (Task 8) — `moveTo(items, from, to)`. Extracted because the drag handlers cannot be tested in jsdom and this is the part of them that can.
- `src/admin/blocks/BlockList.tsx` — every block of one post: its own fields, Up/Down/Remove, and (from Task 8) a drag handle. Created as a banner-only stub in Task 4 so the problem partition is never half-shipped.
- `src/admin/blocks/BlockFields.tsx` — one exhaustive `switch (block.kind)`, one branch per kind.
- `src/admin/blocks/BlockPicker.tsx` — ten buttons, built from `BLOCK_KINDS`.
- `src/admin/blocks/InlineTextField.tsx` — a `<textarea>` plus (from Task 7) the bold/italic/link toolbar. The one component that touches `setSelectionRange`.
- `src/admin/blocks/__tests__/block-problems.test.ts`, `block-meta.test.ts`, `blank-block.test.ts`, `reorder.test.ts`, `BlockList.test.tsx`, `BlockFields.test.tsx`, `BlockPicker.test.tsx`, `InlineTextField.test.tsx`
- `src/admin/PostList.tsx` — the bespoke list of posts. Sits beside `RecordList.tsx`, not inside `manage/`, matching `GalleryList.tsx` and `StoryForm.tsx`.
- `src/admin/areas/PostsArea.tsx` — the panel: `SectionErrorBoundary` → `CollapsibleSection` → fetch/register/validate/commit, `AwardsArea.tsx` shape for shape.
- `src/admin/__tests__/PostList.test.tsx`, `src/admin/areas/__tests__/PostsArea.test.tsx`
- `src/components/blog/posts-api.ts` — `POSTS_ENDPOINT`, `isPost`, `fetchPosts`.
- `src/components/blog/use-posts.ts` — `usePosts(fetchImpl?)`, the loading/loaded state every blog surface reads.
- `src/components/blog/BlogSection.tsx` — the homepage section that replaces `BlogTeaser` behind the `press` id.
- `src/components/blog/__tests__/posts-api.test.ts`, `use-posts.test.tsx`, `BlogSection.test.tsx`
- `scripts/seed-posts-d1.mjs` — the one-off seed, `seed-story-d1.mjs` shape for shape.
- `scripts/sync-posts-fallback.mjs` — `postsFileFromRow(row)` plus the CLI entry, `sync-story-fallback.mjs` shape for shape.
- `scripts/__tests__/sync-posts-fallback.test.mjs`
- `e2e/block-editor.spec.ts` — the drag claim and the browser claims.

**Modified:**
- `src/content/markdown.ts` — `Cursor`, `tryLink`, `tryDelimited`, `parseInline`. **Nothing else in that file.**
- `src/content/__tests__/markdown.test.ts` — the runtime-bound battery and the equivalence cases.
- `src/content/guards.ts` — `assertPosts`' image check.
- `src/content/__tests__/validate.test.ts` — the both-ends table gains rows for the image path and for every `blankBlock` shape.
- `src/admin/content.ts` — `CONTENT_FILES`, `CONTENT_FILE_LABELS`, `ContentTypeMap`.
- `src/admin/manage/areas.ts` — `PanelId`, `PANELS.posts`, `AREAS[2].panelIds`.
- `src/admin/manage/ManageShell.tsx` — `PostsArea` in the `story` case, and `data-panel` on the panel container.
- `src/admin/fields.ts` — `PostMeta`, `POST_FIELDS`.
- `src/admin/EditMode.tsx` — `posts: pick(entries, 'posts.json', EMPTY_POSTS)`, the `EMPTY_POSTS` comment, and `SECTION_COMPONENTS.press`.
- `src/admin/CollapsibleSection.tsx` — the `data-panel` attribute (one attribute, zero classes).
- `src/shared/upload-categories.ts` — `'posts'`.
- `src/admin/__tests__/content.test.ts` — **deletes** 5A's exception and its inverse assertion.
- `src/admin/manage/__tests__/areas.test.tsx` — `EXPECTED_PANEL_IDS`.
- `src/admin/manage/__tests__/ManageShell.test.tsx` — the Posts panel case, written with the cheap-attribute pattern.
- `src/admin/__tests__/AdminApp.test.tsx` — the stale-draft case, same pattern.
- `src/admin/__tests__/__snapshots__/panel-snapshots.test.tsx.snap` — one new panel snapshot, **read before it is committed**.
- `src/components/blog/PostPage.tsx`, `BlogIndex.tsx` — the three-state read.
- `src/App.tsx` — `SECTION_COMPONENTS.press`.
- `src/content/copy.json` — `nav.links[4].label` only.
- `worker/store.ts` — `D1_ONLY_PATHS`.
- `worker/published.ts` — `PUBLIC_FILES`.
- `worker/snapshot.ts` — **generated**, by `node scripts/build-snapshot.mjs`. Never hand-edited.
- `worker/__tests__/github.test.ts` — one `it.each` row.
- `e2e/edit-backend.ts` — `CONTENT_FILES`.
- `src/test/bundle.post-build.test.ts` — the ceiling assertion (Task 8, the one task allowed to touch it) and its comment history.
- `src/test/homepage-bytes.test.tsx` — the byte count and its accounting comment (Task 11).
- `docs/cloudflare-cutover.md` — the 5B section.

**Not modified by any task in this plan, and a diff touching them is a defect:** `src/content/galleries.json`, `src/content/sections.json`, `src/content/press.json`, `src/components/BlogsPage.tsx`, `src/components/BlogTeaser.tsx`, `src/components/NewsPress.tsx`, `wrangler.toml`, `worker/migrations/`, `scripts/paths.mjs`, `scripts/build-snapshot.mjs`, `src/test/wrangler-config.test.ts`, `public/_redirects`, `public/_headers`.

> `BlogTeaser.tsx` stays on disk untouched after Task 11 removes its last caller. `src/test/no-dead-backend.test.ts` holds a `protectedComponents` list under the owner's never-delete constraint (`NewsPress.tsx` is already on it). Task 11 removes the **mapping**, not the file, and adds `BlogTeaser.tsx` to that list in the same commit so a later tidy-up cannot delete it.

---

### Task 1: the parser can no longer hang — the 5B entry condition

**This is first and nothing else may start before it is merged.** `parseNodes` backtracks exponentially on an unclosed `[`. It is a **hang**, not a throw, so the root `ErrorBoundary` cannot catch it and the tab simply stops. Today it is unreachable, because the only authoring path is a committed JSON file and `validatePosts` never calls `parseInline` at all (it reads `rawLinkTargets`, which is linear). **Task 7 puts a `<textarea>` and a live preview in front of it, at which point the owner types `[` and the tab freezes.**

**The measurement, re-taken for this plan on a faithful port of the shipped file:**

| unclosed `[` | current parser | after this task |
| --- | --- | --- |
| 14 | 2 ms | 0 ms |
| 18 | 15 ms | 0 ms |
| 20 | 59 ms | 0 ms |
| 22 | 229 ms | 0 ms |
| 24 | 906 ms | 0 ms |
| 26 | 3 646 ms | 0 ms |
| 30 | ~2 minutes | 0 ms |
| 40 | **did not finish in 120 s** | 0 ms |
| 50 000 | — | 4 ms |
| 50 000 followed by a real `](https://e.com)` | — | 3 ms |
| a 32 000-char paste of 400 × (50 `[` + real markup) | — | 3 ms |

A clean 4× per two brackets, i.e. 2^n. **`**` is NOT affected and must not be "fixed" on suspicion:** `'**'.repeat(26)` parses in 0 ms today and `'*'.repeat(2000)` in 1 ms, because an emphasis run stops at the next standalone `*` and *succeeds*. The hazard is `[` alone. The memo is added to `tryDelimited` as well, but as symmetry and cheap insurance, not as a fix for an observed problem — and the task says so rather than implying a bug that is not there.

**The fix is memoisation, and it is a packrat memo on both outcomes.** Three parts, and all three are needed — this was arrived at by building four candidates and measuring each:

1. **Memoise every attempt, success and failure alike, keyed on the start index.** `tryLink`'s verdict at an index is a pure function of `(source, index)`: the inner `parseNodes` is always called with `stopAt = ']'` regardless of the outer `stopAt`, so nothing about the enclosing context can change the answer. Memoising *failures only* kills the exponential but leaves an O(n²) residual on input containing both a long bracket run and a real `](` — measured at **38 seconds** for 50 000 brackets plus a target, because a *success* is recomputed at every outer position that retries. Memoising both makes that case 3 ms.
2. **Cap the recursion depth at 32.** Memoisation alone still overflows the stack: the first descent through 10 000 consecutive `[` is 10 000 frames deep, and `RangeError: Maximum call stack size exceeded` was reproduced. A `RangeError` is catchable, unlike a hang, but a white screen is not the answer either. **What the cap does NOT do is change any output at nesting depth ≤ 32**, which is every real input; and at depth > 32 it was measured to change nothing either, because in the pathological shape the innermost `[` is the one that opens the link and every outer attempt fails at depth 0. `parseInline('['.repeat(40) + 'x](https://example.com)')` returns exactly what it returns today.
3. **An O(1) reject for a `[` that cannot possibly open a link.** `source.lastIndexOf('](')` is computed once per parse; a `[` at a later index than that can never find a target, so it fails without parsing the rest of the paragraph.

**Do not attempt the "sound" variant.** Guarding the memo on "no depth cap fired beneath this attempt" was built and measured: it declines to memoise exactly when memoisation is needed, and made the 2 000-bracket-plus-target case **42.5 seconds**, worse than doing nothing. The honest statement, which the code comment carries, is: identical behaviour at nesting depth ≤ 32, proven by equivalence testing; at depth > 32 the memo is context-insensitive in principle, and the regime it applies to is the one that hangs today, so any terminating answer is an improvement.

**Behaviour equivalence was verified before this plan was written**, against a faithful port of the shipped file: 26 hand-written cases covering every form in `markdown.test.ts` plus every payload in its XSS battery, and **300 000 random strings** over the alphabet `[]()*`\ ab/:h` at lengths 1-20. **Zero differences.** The fast path costs about 19% more (5 520-char prose × 500: 26 ms → 31 ms), which is the price of three `Map` allocations per parse and is stated rather than hidden.

**Files:**
- Modify: `src/content/markdown.ts` (`Cursor`, `tryDelimited`, `tryLink`, `parseInline`, and one new constant)
- Test: `src/content/__tests__/markdown.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces, consumed by Tasks 5, 6, 7 and by every existing caller unchanged:
  - `export function parseInline(source: string): InlineNode[]` — **same signature, same output, bounded runtime**
  - `export const MAX_NESTING_DEPTH = 32` — exported only so the test can name it instead of repeating the literal
- **Must NOT touch:** `isSafeHref`, `isSiteRelativePath`, `rawLinkTargets`, `findTargetEnd`, `atStop`, `ESCAPABLE`, `PROBE_ORIGIN`, `InlineNode`. Those are 5A's security fix and Task 7 depends on them exactly as they are. `/\evil.example` resolves to `https://evil.example/` and so does `/` + TAB + `/host`; `/%5C` is deliberately **accepted**. Step 6 greps the diff to prove none of them moved.

- [ ] **Step 1: Write the failing runtime-bound test**

Append to `src/content/__tests__/markdown.test.ts`. Put it after the existing `describe('parseInline: unclosed and malformed runs stay literal', ...)` block.

```ts
// The hazard this block exists for, and why a runtime bound rather than an
// output assertion: parseNodes used to backtrack exponentially on an
// unclosed '['. Every case below returns the RIGHT answer before this fix
// and after it -- what changed is how long it takes. 24 brackets took 906ms
// and 30 took about two minutes, on a faithful port of the pre-fix file; 40
// did not finish in 120 seconds. A HANG is not something the root
// ErrorBoundary can catch, so the failure mode was a tab that simply stops,
// and 5B's formatting toolbar over a live textarea is what puts a keystroke
// in front of it.
//
// Bounds, not exact timings: the numbers above are 2^n, so a 1000ms budget
// against a measured 0-4ms is a margin of two to three orders of magnitude.
// A machine slow enough to fail this honestly has a different problem.
describe('parseInline: an unclosed bracket cannot hang the tab', () => {
  function msToParse(source: string): number {
    const started = performance.now();
    parseInline(source);
    return performance.now() - started;
  }

  it.each([
    ['24 unclosed brackets -- 906ms before this fix', '['.repeat(24) + 'ok'],
    ['30 unclosed brackets -- about two minutes before this fix', '['.repeat(30) + 'ok'],
    ['40 unclosed brackets -- did not finish in 120 seconds before this fix', '['.repeat(40) + 'ok'],
    ['2000 unclosed brackets', '['.repeat(2000) + 'ok'],
    ['50000 unclosed brackets -- a paste, not typing', '['.repeat(50000) + 'ok'],
  ])('%s parses in under 1000ms', (_name, source) => {
    expect(msToParse(source)).toBeLessThan(1000);
  });

  // The shape that defeats a failure-only memo: a long bracket run WITH a
  // real link target after it, so every outer attempt succeeds and, without
  // success memoisation, is recomputed at every position. Measured at 38
  // SECONDS with failures memoised and successes not; 3ms with both.
  it.each([
    ['2000 brackets then a real target', '['.repeat(2000) + '](https://example.com)'],
    ['50000 brackets then a real target', '['.repeat(50000) + '](https://example.com)'],
  ])('%s parses in under 1000ms', (_name, source) => {
    expect(msToParse(source)).toBeLessThan(1000);
  });

  // A mixed paste bomb: brackets interleaved with real markup, so neither
  // the O(1) reject nor a single memo class carries it alone.
  it('a 32000-character mixed paste parses in under 1000ms', () => {
    const source = ('['.repeat(50) + ' *x* **y** [z](https://example.com) ').repeat(400);
    expect(source.length).toBe(32000);
    expect(msToParse(source)).toBeLessThan(1000);
  });

  // Deep nesting must not trade a hang for a stack overflow. Memoisation
  // alone still descends once per consecutive '[', which is 50000 frames.
  it('50000 levels of nesting does not overflow the stack', () => {
    expect(() => parseInline('['.repeat(50000) + 'ok')).not.toThrow(RangeError);
  });
});
```

> `not.toThrow(RangeError)` is a named tell in this project's Global Constraints, and it is used here deliberately and exactly once, because the claim genuinely *is* "this specific throw does not happen" and the surrounding block already asserts the positive behaviour six times over. It is not standing in for an assertion about output.

- [ ] **Step 2: Write the failing equivalence test**

Immediately after the block above, in the same file. **These are the assertions that stop the fix changing what the parser means.** Every expected value is a hand-written literal — never computed by calling `parseInline`.

```ts
// The fix is only a fix if it is invisible. These are literals, not values
// read back out of the thing under test: Phase 4's thirteenth unfalsifiable
// test compared a response against the value under test and corrupting that
// value left 2837 tests green.
describe('parseInline: the memo changes no output', () => {
  it.each([
    ['a bracket run then a real link', '[[[x](https://example.com)', [
      { kind: 'text' as const, value: '[[' },
      { kind: 'link' as const, href: 'https://example.com', children: [{ kind: 'text' as const, value: 'x' }] },
    ]],
    // 40 deep, which the pre-fix parser could not finish. The answer is the
    // same one it would have given: the INNERMOST bracket is the one that
    // opens the link, and the 39 outer attempts each fail at depth 0, so the
    // 32-level cap never touches the result. Asserted because it was
    // measured, not because a rule was believed.
    ['forty deep, then a real link', '['.repeat(40) + 'x](https://example.com)', [
      { kind: 'text' as const, value: '['.repeat(39) },
      { kind: 'link' as const, href: 'https://example.com', children: [{ kind: 'text' as const, value: 'x' }] },
    ]],
    ['a bracket run with no target at all', '[[[[ok', [{ kind: 'text' as const, value: '[[[[ok' }]],
    ['a refused target inside a bracket run', '[[x](javascript:alert(1))', [
      { kind: 'text' as const, value: '[' },
      { kind: 'text' as const, value: '[x](javascript:alert(1))' },
    ]],
    ['a target holding balanced parentheses', '[a](https://e.com/f(1)_g) end', [
      { kind: 'link' as const, href: 'https://e.com/f(1)_g', children: [{ kind: 'text' as const, value: 'a' }] },
      { kind: 'text' as const, value: ' end' },
    ]],
    ['bold inside a link', '**[a](/x)**', [
      {
        kind: 'strong' as const,
        children: [{ kind: 'link' as const, href: '/x', children: [{ kind: 'text' as const, value: 'a' }] }],
      },
    ]],
    ['a bracketed run that is not a link, after a real one', '[a](https://e.com) [', [
      { kind: 'link' as const, href: 'https://e.com', children: [{ kind: 'text' as const, value: 'a' }] },
      { kind: 'text' as const, value: ' [' },
    ]],
  ])('%s', (_name, source, expected) => {
    expect(parseInline(source)).toEqual(expected);
  });

  // Nested brackets inside a link label are LITERAL today, because the
  // inner parseNodes stops at the first ']' with no depth counting. Pinned
  // so nobody "improves" it into a depth-matching label scanner while
  // touching this file: that would be a behaviour change, and it would move
  // the case markdown.test.ts already pins two blocks above.
  it('a nested bracket inside a label keeps the whole run literal', () => {
    expect(parseInline('[nested [brackets]](https://e.com/x)')).toEqual([
      { kind: 'text', value: '[nested [brackets]](https://e.com/x)' },
    ]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```
npx vitest run src/content/__tests__/markdown.test.ts -t 'cannot hang the tab'
```

Expected: the 24-bracket case fails with `expected 906.xx to be less than 1000` **passing** (it is under 1000 today) and the **30-bracket case times out** at vitest's 5000ms default, reported as `Test timed out in 5000ms`. The 40-bracket, 2000, 50000 and mixed cases also time out. **That is the failure this task exists for; do not raise the timeout.**

Then:

```
npx vitest run src/content/__tests__/markdown.test.ts -t 'the memo changes no output'
```

Expected: every case **passes** already, except `forty deep, then a real link`, which times out. That is the point — the equivalence block is a regression net for Step 4, not a red-to-green target, and the one case that is red is red because of the hang rather than because of the answer.

- [ ] **Step 4: Rewrite the three functions**

In `src/content/markdown.ts`. Replace the `Cursor` interface (currently at line 141) and the bodies of `tryDelimited`, `tryLink` and `parseInline`. **Leave `atStop`, `findTargetEnd`, `parseNodes`, `isSafeHref`, `isSiteRelativePath`, `rawLinkTargets`, `ESCAPABLE` and `PROBE_ORIGIN` exactly as they are.**

```ts
// How deep a nested run may go before this parser stops descending.
//
// It is here to stop a stack overflow, not to stop a hang -- the memo below
// does that. Memoisation alone still makes ONE descent per consecutive
// opener, so a pasted run of ten thousand '[' is ten thousand frames and
// throws RangeError. Real prose nests three deep at most (bold inside
// emphasis inside a link label), so 32 is four times more than anything a
// person writes and cheap insurance against the rest.
//
// Measured, not assumed: at forty levels the output is byte-identical to the
// pre-cap parser's, because in a run of openers it is the INNERMOST one that
// finds the target and every outer attempt fails at depth 0. The cap
// therefore changes no result at any depth this repository can produce, and
// the test pins that case rather than trusting the argument.
export const MAX_NESTING_DEPTH = 32;

// One remembered attempt: what the run produced (null for "this is not a
// run"), and where the cursor should be afterwards.
interface Attempt {
  readonly node: InlineNode | null;
  readonly end: number;
}

interface Cursor {
  readonly source: string;
  index: number;
  // Incremented across a speculative descent, decremented on the way out.
  // Read only against MAX_NESTING_DEPTH above.
  depth: number;
  // `source.lastIndexOf('](')`, computed once. A '[' at a later index than
  // this can never find a target, so tryLink can refuse it in constant time
  // instead of parsing the rest of the paragraph to discover the same thing.
  // -1 when the source holds no target at all, which refuses every '['
  // immediately -- the pure-paste case.
  readonly lastTargetOpen: number;
  // THE FIX. A speculative run's verdict at a given index is a pure function
  // of (source, index): the inner parseNodes is always called with the run's
  // own delimiter as `stopAt`, never the enclosing one, so nothing about the
  // context above can change the answer. Without these Maps, a '[' that
  // fails re-parses the whole remainder, and the '[' one character along does
  // it again -- 2^n, measured at 906ms for 24 brackets and about two minutes
  // for 30.
  //
  // SUCCESSES are remembered too, not only failures, and that is not
  // symmetry for its own sake: with failures alone, a bracket run followed by
  // a real target recomputes a SUCCESS at every outer position, which
  // measured 38 seconds for fifty thousand brackets. Both -> 3ms.
  //
  // Honest about the one edge: an attempt whose subtree hit
  // MAX_NESTING_DEPTH is context-sensitive in principle, and this memo does
  // not distinguish it. Guarding on that was built and measured -- it
  // declines to memoise exactly where memoisation is needed and made the
  // same case 42.5 seconds, worse than no fix. The regime it applies to is
  // input nested deeper than 32, which is the regime that HANGS today, so a
  // terminating answer is an improvement in every case. At depth <= 32 --
  // every input this repository can produce -- the behaviour is identical,
  // verified against 26 hand cases and 300000 random strings with zero
  // differences.
  readonly linkMemo: Map<number, Attempt>;
  readonly strongMemo: Map<number, Attempt>;
  readonly emMemo: Map<number, Attempt>;
}

function remember(memo: Map<number, Attempt>, start: number, node: InlineNode | null, end: number): InlineNode | null {
  memo.set(start, { node, end });
  return node;
}

// A delimited run (`**...**`, `*...*`) is parsed SPECULATIVELY: the cursor is
// saved, the body is parsed, and if the closing delimiter is not where it
// should be the cursor is restored and the opener becomes ordinary text.
// That is what makes an unclosed run render as a stray asterisk rather than
// swallowing the rest of the paragraph -- the behaviour a non-technical
// author will actually meet, and the one the tests pin hardest.
//
// The memo here is insurance rather than a fix for anything observed: an
// emphasis run stops at the next standalone '*' and SUCCEEDS, so
// '*'.repeat(2000) already parsed in 1ms and '**'.repeat(26) in 0ms. It
// costs one Map lookup and removes the whole question.
function tryDelimited(cursor: Cursor, delimiter: string, kind: 'strong' | 'em'): InlineNode | null {
  const start = cursor.index;
  const memo = delimiter === '**' ? cursor.strongMemo : cursor.emMemo;
  const seen = memo.get(start);
  if (seen !== undefined) {
    cursor.index = seen.end;
    return seen.node;
  }
  // Deliberately NOT remembered: the answer at this index depends on how
  // deep the caller was, so caching it would poison a shallower attempt.
  if (cursor.depth >= MAX_NESTING_DEPTH) return null;

  cursor.index += delimiter.length;
  cursor.depth += 1;
  const children = parseNodes(cursor, delimiter);
  cursor.depth -= 1;
  if (children.length === 0 || !cursor.source.startsWith(delimiter, cursor.index)) {
    cursor.index = start;
    return remember(memo, start, null, start);
  }
  cursor.index += delimiter.length;
  return remember(memo, start, { kind, children }, cursor.index);
}

function tryLink(cursor: Cursor): InlineNode | null {
  const start = cursor.index;
  const seen = cursor.linkMemo.get(start);
  if (seen !== undefined) {
    cursor.index = seen.end;
    return seen.node;
  }
  if (cursor.depth >= MAX_NESTING_DEPTH) return null;
  // The constant-time refusal. Remembered, because it does not depend on
  // depth at all.
  if (start > cursor.lastTargetOpen) return remember(cursor.linkMemo, start, null, start);

  cursor.index += 1;
  cursor.depth += 1;
  const children = parseNodes(cursor, ']');
  cursor.depth -= 1;
  if (!cursor.source.startsWith('](', cursor.index)) {
    cursor.index = start;
    return remember(cursor.linkMemo, start, null, start);
  }
  const open = cursor.index + 1;
  const close = findTargetEnd(cursor.source, open);
  if (close === -1) {
    cursor.index = start;
    return remember(cursor.linkMemo, start, null, start);
  }
  const href = cursor.source.slice(open + 1, close);
  cursor.index = close + 1;
  if (!isSafeHref(href)) {
    // Refused, and refused VISIBLY: the whole run comes back as literal
    // text, brackets and target included, so she can see what she pasted
    // and fix it. Silently dropping the target would leave link text with
    // no link and nothing to explain it.
    return remember(
      cursor.linkMemo,
      start,
      { kind: 'text', value: cursor.source.slice(start, cursor.index) },
      cursor.index,
    );
  }
  return remember(cursor.linkMemo, start, { kind: 'link', href: href.trim(), children }, cursor.index);
}

export function parseInline(source: string): InlineNode[] {
  return parseNodes(
    {
      source,
      index: 0,
      depth: 0,
      lastTargetOpen: source.lastIndexOf(']('),
      linkMemo: new Map(),
      strongMemo: new Map(),
      emMemo: new Map(),
    },
    null,
  );
}
```

> The comment above `tryDelimited` is a rewrite of the existing one, kept because it records why speculation exists at all. **Note what is not in any of these comments: no bare utility-class token.** The words `italic` and `inline` do not appear as standalone tokens; `emphasis` and `inline code` are used instead, and `InlineNode`/`parseInline` are multi-word identifiers the scanner cannot mistake for a class. Step 5 proves it.

- [ ] **Step 5: Run to verify it passes, and prove the CSS did not move**

```
npx vitest run src/content/__tests__/markdown.test.ts
npx tsc -b --noEmit
npx eslint src/content/markdown.ts
npx vite build && wc -c dist/assets/index-*.css
```

Expected: all cases PASS, `tsc -b` exit 0, eslint silent, and **38593 bytes** — this task adds no `className` and its comments must add no rule either. If the byte count moved, a comment token paid for a rule; find it with a rule-level diff and reword to describe the effect rather than name a utility.

- [ ] **Step 6: Prove nothing else in the file moved**

```bash
git diff -U0 src/content/markdown.ts | grep -E '^[-+]' | grep -vE '^(---|\+\+\+)' \
  | grep -nE 'isSafeHref|isSiteRelativePath|rawLinkTargets|findTargetEnd|atStop|ESCAPABLE|PROBE_ORIGIN|InlineNode ='
```

Expected: **the only hits are the two `isSafeHref(href)` call sites and the `Map<number, Attempt>` type lines** — no hit inside any of those functions' own bodies or the `ESCAPABLE`/`PROBE_ORIGIN` declarations. 5A's final review found `isSafeHref` accepting `/\evil.example`, which browsers resolve to `https://evil.example/`, and the fix was a `new URL(...).origin` normalisation rather than pattern-matching the known bad shapes. Task 7's link button depends on it exactly as it is. If any of those bodies appears in this diff, revert that part.

Then re-run the two suites that pin the security boundary from the other end:

```
npx vitest run src/content/__tests__/validate.test.ts src/content/__tests__/guards.test.ts src/test/html-sinks.test.ts
```

Expected: PASS. `html-sinks.test.ts` scans every shipped file for a parsing sink; `markdown.ts` is inside its `SHIPPED_FILES` set, so a rewrite of this file is exactly when it earns its keep.

- [ ] **Step 7: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | Delete the `cursor.linkMemo.get(start)` early return in `tryLink` (keep `remember`) | **the mutation this task is FOR.** `50000 brackets then a real target` and `a 32000-character mixed paste` both exceed 1000ms; the 30/40-bracket cases time out at 5000ms. Run it and read which cases go red — if only the mixed case reddens, the bracket-run cases are not doing their job |
| 2 | In `tryLink`, replace `remember(cursor.linkMemo, start, { kind: 'link', ... }, cursor.index)` with a bare `return { kind: 'link', ... }` — i.e. memoise failures only | `50000 brackets then a real target` fails at ~38 000ms → reported as a 5000ms timeout. **This is the mutation that justifies memoising successes, and without it the design decision is unevidenced** |
| 3 | Remove the `if (start > cursor.lastTargetOpen)` reject | `50000 unclosed brackets` goes from 4ms to about 5700ms at 20 000 and does not finish at 50 000 → timeout. The other cases stay green, which is the correct separation: this line is only about input with no target |
| 4 | Set `MAX_NESTING_DEPTH = 1000000` (effectively no cap) | `50000 levels of nesting does not overflow the stack` fails with `RangeError: Maximum call stack size exceeded` |
| 5 | Set `MAX_NESTING_DEPTH = 2` | `bold inside a link` fails — a link inside bold is two levels, so a cap of 2 refuses the real content shape. **This is the mutation that proves 32 is not arbitrary**: it shows where a too-small cap first becomes visible |
| 6 | In `tryDelimited`, remember the depth-cap refusal (`if (cursor.depth >= MAX_NESTING_DEPTH) return remember(memo, start, null, start);`) | **PREDICTED NOT TO REDDEN.** No test in this file nests 32 deep with a shallower retry, so nothing distinguishes the two. Stated as a gap rather than reported as proof: the guard is correct by argument (a depth-dependent answer must not be cached under a depth-independent key) and is deliberately not test-covered, because a test for it would have to construct an input whose only observable difference is in the >32 regime this task declines to make guarantees about. **Do not "fix" this by writing a test that asserts the >32 output; that would pin the very thing the comment says is not guaranteed.** |
| 7 | Change `source.lastIndexOf('](')` to `source.indexOf('](')` | `a bracketed run that is not a link, after a real one` still passes, but `a 32000-character mixed paste` and `50000 brackets then a real target` slow down. **Also predicted weak** — `indexOf` is *more* permissive than `lastIndexOf` for the reject, so it is a performance mutation only. Run it and record the actual result rather than assuming |
| 8 | In `parseInline`, reuse a single module-level `Map` instead of fresh ones per call | `the memo changes no output` — the second call in the same test file reads a memo built against a different `source` and returns nodes from the wrong string. **Run this one specifically**: a module-level memo is the natural "optimisation" a later reader will reach for, and it is a correctness bug |

- [ ] **Step 8: Gate, then commit**

```bash
git add src/content/markdown.ts src/content/__tests__/markdown.test.ts
npm run gate
```

Expected: exit 0, entry CSS still **38593 bytes**.

```bash
git commit -m "fix(markdown): an unclosed bracket can no longer hang the tab

parseNodes backtracked exponentially on '['. Measured on a faithful port of
the shipped file: 24 brackets 906ms, 30 about two minutes, 40 unfinished
after 120 seconds. It is a hang rather than a throw, so the root error
boundary could not catch it, and the block editor's textarea is what puts a
keystroke in front of it.

A packrat memo on both outcomes, keyed on the start index, plus a 32-level
depth cap so the fix does not trade a hang for a stack overflow, plus a
constant-time refusal for a bracket that cannot reach a target. 50000
brackets now parse in 4ms and a 32000-character mixed paste in 3ms.

Remembering successes as well as failures is load-bearing: with failures
alone a bracket run followed by a real target still took 38 seconds,
because the success was recomputed at every outer position.

Output is unchanged at every nesting depth up to the cap, verified against
26 hand-written cases and 300000 random strings with zero differences. The
security functions in this module were not touched."
```

---

### Task 2: `assertPosts` checks the card image the way `validatePost` does

The last of 5A's guard asymmetries, one level up from the one 5A fixed. `assertPosts` (`src/content/guards.ts:785-787`) refuses a missing or blank `image` and stops there; `validatePost` runs the full `isUnsafeAssetPath` check on the same field. The dashboard path is safe because `validatePosts` catches it. **The exposed path is a direct commit to `posts.json`, which is the only way a post is authored today** — and it stays a real path after Task 9, because `scripts/sync-posts-fallback.mjs` writes that file from a D1 row and `assertPosts` runs at import time, so a bad value breaks `tsc -b` and blocks every subsequent deploy including the one that would fix it.

**The rules stay duplicated rather than delegated, and that is deliberate.** `src/content/validate.ts` imports `./guards`, so a call the other way is a cycle through the module the Worker bundles. What keeps the two copies honest is `validate.test.ts`'s existing "both ends refuse the same broken shapes" table, one row per shape checked at **both** boundaries. This task adds rows to that table; it does not start a new one.

**Files:**
- Modify: `src/content/guards.ts` (`assertPosts`, the `image` branch only)
- Test: `src/content/__tests__/validate.test.ts` (the both-ends table), `src/content/__tests__/guards.test.ts`

**Interfaces:**
- Consumes: `isSiteRelativePath` from `./markdown` — **already imported by `guards.ts`** and already used by `assertBlockAssetPath` (`guards.ts:835-840`). No new import.
- Produces: `assertPosts` throws `content/posts.json: "<id>" needs a photo on this site, starting with /` for an off-origin, protocol-relative or traversing card image. Task 9's `sync-posts-fallback.mjs` relies on this being true.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe` for `assertPosts` in `src/content/__tests__/guards.test.ts`:

```ts
  // The asymmetry a review found and this closes: validatePost runs the full
  // asset-path check on `image` and this guard checked only that the string
  // was non-empty. Both boundaries now ask isSiteRelativePath the same
  // question, which is the same shared-primitive treatment assertBlock's own
  // `src` check already gets -- and it matters because the exposed path is a
  // DIRECT COMMIT to posts.json, which is the only way a post is authored
  // today, and because scripts/sync-posts-fallback.mjs writes this file from
  // a database row.
  //
  // isSiteRelativePath, not a pattern: '/' followed by a backslash resolves
  // to somebody else's host, and so does '/' followed by a tab followed by
  // '//host'. Naming the dangerous characters one at a time is how the old
  // check came to be wrong.
  it.each([
    ['an off-site card image', 'https://evil.example/x.webp'],
    ['a protocol-relative card image', '//evil.example/x.webp'],
    ['a backslash card image', '/\\evil.example/x.webp'],
    ['a traversing card image', '/press/../../etc/passwd'],
    ['a bare filename', 'hotelier.webp'],
  ])('refuses %s', (_name, image) => {
    expect(() => assertPosts([{ ...VALID_RAW_POST, image }])).toThrow(/photo on this site/);
  });

  // A percent-encoded backslash is NOT decoded before parsing, so it stays
  // on this origin and is accepted. Asserted beside the refusals rather than
  // left implicit: refusing it would be over-strict against real content,
  // and it was a deliberate call when isSafeHref was hardened.
  it('accepts a percent-encoded backslash, which stays on this origin', () => {
    expect(assertPosts([{ ...VALID_RAW_POST, image: '/press/%5Chotelier.webp' }])[0].image).toBe(
      '/press/%5Chotelier.webp',
    );
  });

  it('still accepts the ordinary case', () => {
    expect(assertPosts([{ ...VALID_RAW_POST, image: '/press/hotelier.webp' }])[0].image).toBe('/press/hotelier.webp');
  });
```

> `VALID_RAW_POST` is the fixture the existing `assertPosts` block already uses. If it does not exist under that name, read the block and use whatever it does have — **do not add a second fixture**, because two fixtures for one guard is how a later edit ends up strengthening one and not the other. If the block has no shared fixture, add one and give every other case in the block the same treatment in this commit.

Then add the matching rows to `validate.test.ts`'s both-ends table. Find the table 5A's fix round added — it is the one whose cases run each refused shape through `validateContent` **and** through the `guards.ts` entry point and assert both refuse. Add:

```ts
    ['an off-site card image', { image: 'https://evil.example/x.webp' }, '[0].image'],
    ['a protocol-relative card image', { image: '//evil.example/x.webp' }, '[0].image'],
    ['a backslash card image', { image: '/\\evil.example/x.webp' }, '[0].image'],
    ['a traversing card image', { image: '/press/../../etc/passwd' }, '[0].image'],
```

**If the existing table's row shape differs from this, match the existing shape.** Read it before writing. The point of the table is that both ends are checked per row; a row that only reaches one end is worse than no row, because it looks like coverage.

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run src/content/__tests__/guards.test.ts -t 'card image'
```

Expected: the four refusal cases fail with `expected [Function] to throw error matching /photo on this site/ but it didn't` — `assertPosts` accepts all four today. The `%5C` and ordinary cases pass already.

- [ ] **Step 3: Add the check**

In `src/content/guards.ts`, in `assertPosts`, replace the single `image` branch:

```ts
    if (typeof image !== 'string' || image.trim().length === 0) {
      throw new Error(`content/posts.json: "${id}" needs an image`);
    }
```

with:

```ts
    if (typeof image !== 'string' || image.trim().length === 0) {
      throw new Error(`content/posts.json: "${id}" needs an image`);
    }
    // The same question validatePost asks of this field, asked here too --
    // and asked through isSiteRelativePath (./markdown) rather than a pattern
    // of its own, so the two boundaries cannot come to disagree about what a
    // path on this site is. They disagreed once, and the shape they
    // disagreed about was '/' followed by a backslash, which a browser
    // fetches from somebody else's host.
    //
    // This guard runs at IMPORT time, which is what makes it worth having
    // rather than leaving to the write boundary: a bad value reaching
    // src/content/posts.json -- by a direct commit, which is how posts are
    // authored today, or by scripts/sync-posts-fallback.mjs writing a
    // database row into the file -- breaks `tsc -b` and blocks every later
    // deploy, including the one that would fix it.
    if (!isSiteRelativePath(image)) {
      throw new Error(`content/posts.json: "${id}" needs a photo on this site, starting with /`);
    }
```

- [ ] **Step 4: Run to verify it passes**

```
npx vitest run src/content/__tests__/guards.test.ts src/content/__tests__/validate.test.ts src/content/__tests__/shape.test.ts src/content/__tests__/assets.test.ts
npx tsc -b --noEmit
```

Expected: PASS, `tsc -b` exit 0. `assets.test.ts` matters here: it walks every `.json` under `src/content/` and resolves every asset-shaped string against `public/` with exact case, so it is what proves the three committed post images still pass the *new* check as well as the old one. If it goes red, the derivative pipeline is broken and that is a separate bug — **do not "fix" it by loosening this guard.**

- [ ] **Step 5: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | Remove the new `isSiteRelativePath(image)` branch | **the mutation this task is FOR.** All four `guards.test.ts` refusal cases, and the four new `validate.test.ts` both-ends rows at the `guards` end |
| 2 | Replace `!isSiteRelativePath(image)` with `!image.startsWith('/')` | `a backslash card image` and `a traversing card image` — the two shapes a leading-slash test waves through, and the exact pair the hardening was for |
| 3 | Replace `!isSiteRelativePath(image)` with `image.startsWith('//') || image.includes('..')` | `a bare filename` (`hotelier.webp` has no slash and no dots-dots) and `a backslash card image` |
| 4 | In `validate.ts`, remove `isUnsafeAssetPath(post.image)` from `validatePost` | the four new both-ends rows at the **`validateContent`** end. **Run this one and confirm the rows go red at that end specifically** — if they only redden at the `guards` end, the table is not checking both and the whole mitigation for the deliberate duplication is fiction |
| 5 | Change the message to something without "photo on this site" | all four refusal cases, on the `toThrow` matcher. **Deliberate**: the message is what a maintainer reading a failed build sees, so it is part of the contract |
| 6 | Make `isSiteRelativePath` return `true` for a percent-encoded backslash's decoded form (add `decodeURIComponent` before the parse) | `accepts a percent-encoded backslash` — proving the accept case is a real assertion and not a description |

- [ ] **Step 6: Gate, then commit**

```bash
git add src/content/guards.ts src/content/__tests__/guards.test.ts src/content/__tests__/validate.test.ts
npm run gate
```

Expected: exit 0, entry CSS still **38593 bytes**.

```bash
git commit -m "fix(content): assertPosts checks the card image, not just that it is there

The last of the guard asymmetries a review found: validatePost ran the full
asset-path check on post.image and the import-time guard checked only that
the string was non-empty. The dashboard was never the exposed path -- a
direct commit was, and that is still the only way a post is authored, and it
is about to become the way a database row reaches this file.

Through isSiteRelativePath, the same primitive assertBlock's own src check
reads, so the two boundaries cannot come to disagree about what a path on
this site is. They disagreed once and the shape was a leading slash followed
by a backslash, which a browser fetches from another host.

Four refusals added to the both-ends table so the deliberate duplication
between the two boundaries keeps failing by name if either side drifts."
```

---

### Task 3: `posts.json` is registered and gets a Manage panel — one commit

**Read the conflict scan's row C2 before starting.** This is 5A's coupling A and coupling B, and they point at each other three ways, not two. Every part of this task lands in **one commit**, because the tree is red at every intermediate state:

- Register `posts.json` in `CONTENT_FILES` without a panel → `areas.test.tsx:95` fails ("every panel names a real content file, and every content file has a panel").
- Add `PANELS.posts` without registering → `PanelDefinition.file` is typed `ContentFileName`, so `'posts.json'` is not spellable: a `tsc -b` error, not a test failure.
- Delete 5A's `content.test.ts` exception without registering → that test derives from `git ls-files src/content` and now sees a real file `CONTENT_FILES` does not list.
- **And the fourth leg the outline does not mention:** `e2e/edit-backend.ts` holds its own copy of `CONTENT_FILES` and answers 404 for any name absent from it, which paints a "Could not load posts.json" banner **above** the content every dashboard spec measures. Its symptom appears only in Playwright, which `npm run gate` does not run. Miss it and Task 12 fails for a reason nothing in the diff explains.

5A verified this coupling from three directions during execution: registering `posts.json` reddened 2 cases in `content.test.ts` (including the inverse assertion), 1 in `areas.test.tsx`, and produced 13 `tsc` errors.

**On the dead `PANELS[...].heading` constant, with the ledger's claim corrected.** The ledger records it as having "no production reader", with all 40 `ManageShell.test.tsx` cases staying green on a rename. **Half of that is right and the important half is wrong. Verified by running the mutation** (`PANELS.dishes.heading` → `'Dishez'`, then `npx vitest run` over the four candidate files): `2 failed | 75 passed`. `areas.test.tsx` and `ManageShell.test.tsx` stayed green exactly as recorded; `src/admin/__tests__/panel-snapshots.test.tsx:51` and `src/admin/__tests__/owner-facing-labels.test.tsx:54` both failed at `findByRole('button', { name: heading })`, and both run inside `npm run gate`. So the constant is **pinned**, just not where the ledger looked. What *is* genuinely weak is `ManageShell.test.tsx:214` — a `queryByRole(...).not.toBeInTheDocument()` absence assertion in the draft-gate loop, which passes vacuously whatever string the constant holds. The new panel reads the constant rather than duplicating it, because that is the right design either way, and Step 6 pins the reading directly instead of leaning on two files that catch it for unrelated reasons.

**Files:**
- Modify: `src/admin/content.ts` (`CONTENT_FILES`, `CONTENT_FILE_LABELS`, `ContentTypeMap`)
- Modify: `src/admin/manage/areas.ts` (`PanelId`, `PANELS.posts`, `AREAS[2].panelIds`)
- Modify: `src/admin/CollapsibleSection.tsx` (one `data-panel` attribute)
- Modify: `src/admin/EditMode.tsx` (`posts: pick(...)`, and the `EMPTY_POSTS` comment)
- Modify: `src/admin/manage/ManageShell.tsx` (`PostsArea` in the `story` case)
- Create: `src/admin/areas/PostsArea.tsx` — **a stub in this task**, so the panel exists and can be found; Task 4 fills it
- Modify: `src/admin/__tests__/content.test.ts` (**delete** the exception and the inverse assertion)
- Modify: `src/admin/manage/__tests__/areas.test.tsx` (`EXPECTED_PANEL_IDS`)
- Modify: `e2e/edit-backend.ts` (`CONTENT_FILES`)
- Modify: `worker/__tests__/github.test.ts` (one `it.each` row)
- Test: `src/admin/manage/__tests__/areas.test.tsx`, `src/admin/manage/__tests__/ManageShell.test.tsx`, `src/admin/__tests__/content.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces, consumed by Tasks 4, 5, 10, 11:
  - `'posts.json'` as a `ContentFileName`, so `fetchContent('posts.json'): Promise<LoadedContent<Post[]>>` and `useValidation('posts.json', data)` both typecheck
  - `PANELS.posts: { id: 'posts', heading: 'Posts', file: 'posts.json' }` and `PanelId` gaining `'posts'`
  - `data-panel="<id>"` on every `CollapsibleSection`'s `<section>` — **the cheap wait target every new dashboard test uses instead of a role-and-name sweep**
  - `/edit`'s bundle carrying real posts through `pick`, which is what makes Task 11's homepage swap honest
  - `src/admin/areas/PostsArea.tsx` default-exporting `React.FC<AreaProps>`

- [ ] **Step 1: Write the failing tests**

First, extend `EXPECTED_PANEL_IDS` in `src/admin/manage/__tests__/areas.test.tsx` (the literal at line 35, spelled out rather than derived from `PANELS` — keep it that way):

```ts
  // Phase 5B, Task 3: the thirteenth panel. Registered together with
  // posts.json in CONTENT_FILES, because the two assertions below require
  // each other -- see the plan's conflict scan row C2.
  'posts',
```

Then append to the same file's `describe` block, beside "every panel names a real content file":

```ts
  // The Posts panel goes in "Story & Photos", after Press. It is the same
  // kind of thing to her as press coverage is -- words about the restaurant
  // -- and a sixth area for one panel would split one idea into two doors,
  // the same reasoning that put Awards inside "Pages" rather than beside it.
  it('the Posts panel is the last one in Story & Photos', () => {
    expect(findArea('story')?.panelIds).toEqual(['galleries', 'story', 'press', 'posts']);
  });
```

Then add a new case to `src/admin/manage/__tests__/ManageShell.test.tsx`. **Written with the cheap-attribute pattern, and that is not optional** — the fix for this file's own CI timeout was to wait on a `[data-*]` attribute and then assert the expensive role-and-name thing once, and this task makes the shell bigger:

```ts
  // Phase 5B, Task 3. The pattern here is the one that fixed this file's own
  // Cloudflare-build timeout, and it is used deliberately rather than
  // copied: findByRole with a NAME filter polls a role-and-name sweep over
  // the whole ~1200-element shell every 50ms, two thirds of the cost being
  // jsdom getComputedStyle, and burns most of its own budget on the single
  // thread React needs to commit the render it is waiting for. So: wait on a
  // cheap attribute -- 0.6ms -- and then assert the expensive thing ONCE.
  //
  // Never raise a timeout to make this green. Both dashboard timeouts this
  // project has had were fixed by making the query cheap.
  it('the Story & Photos area carries a Posts panel', async () => {
    stubFetch();
    renderDashboard('/edit/manage/story', { wide });

    await waitFor(() => {
      expect(document.querySelector('[data-panel="posts"]')).not.toBeNull();
    });
    expect(screen.getByRole('heading', { name: PANELS.posts.heading })).toBeInTheDocument();
    expect(document.getElementById('section-panel-posts')).not.toBeNull();
  });
```

Then **delete** both halves of 5A's exception from `src/admin/__tests__/content.test.ts` — the whole `it('CONTENT_FILES lists exactly the real *.json files ... minus posts.json (no panel yet)')` case *and* the `it('posts.json is deliberately absent from CONTENT_FILES until its Manage panel exists')` case that guards it, along with the comment paragraph that begins "Phase 5: `posts.json` is the SECOND deliberate exception". Replace the first with the pre-5A form plus one new sentence of comment:

```ts
  // Phase 2, Task 11: `awards.json` is the one deliberate exception --
  // content.ts's own header comment on `CONTENT_FILES` explains why it names
  // a D1 row, not a file `git ls-files` could ever see. Listed alongside
  // `real` explicitly, not folded into the derivation above, so this test
  // still catches its original defect (a real file added to or removed from
  // src/content/ without a matching CONTENT_FILES update) while accepting
  // the one name that is correctly present without a file behind it.
  //
  // Phase 5B, Task 3: `posts.json`'s exception is GONE, and its inverse
  // assertion with it. 5A kept the file out of CONTENT_FILES because that
  // list is what areas.test.tsx requires a Manage panel for, and the Posts
  // panel did not exist yet. It does now, so posts.json is an ordinary
  // registered file and this derivation covers it with no carve-out. If you
  // are re-adding a filter here, something has gone backwards.
  it('CONTENT_FILES lists exactly the real *.json files under src/content/, plus awards.json (D1-only, no file)', () => {
    const real = gitLsFiles('src/content')
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice('src/content/'.length));
    expect([...CONTENT_FILES].sort()).toEqual([...real, 'awards.json'].sort());
  });
```

**Leave the `import { existsSync } from 'node:fs';` line alone if any other case in the file uses it; remove it only if the deleted inverse assertion was its sole consumer** — `npx eslint .` will tell you which, and an unused import fails it.

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run src/admin/manage/__tests__/areas.test.tsx src/admin/manage/__tests__/ManageShell.test.tsx src/admin/__tests__/content.test.ts
npx tsc -b --noEmit
```

Expected, and read all of it rather than the first line:
- `areas.test.tsx`: `'posts'` is not assignable to `PanelId` → a `tsc` error, and at runtime `PANELS['posts']` is `undefined` so `PANELS[id].file` throws.
- `ManageShell.test.tsx`: the new case fails at the `waitFor` — no element carries `data-panel`.
- `content.test.ts`: the reinstated derivation fails, because `git ls-files` sees `src/content/posts.json` and `CONTENT_FILES` does not list it.
- `tsc -b`: errors in `areas.test.tsx` and `areas.ts`.

- [ ] **Step 3: Register the file**

`src/admin/content.ts`. Add `Post` to the existing `import type { ... } from '../content/types'` list. Then, after the `'experiences.json'` entry in `CONTENT_FILES`:

```ts
  // Phase 5B, Task 3: the thirteenth entry, and a real
  // `src/content/posts.json` blob -- on the GitHub store when this lands and
  // on D1 from Task 9 onward, which is exactly the journey story.json took
  // and exactly why nothing in this module has to know. `fetchContent` below
  // hits the same route with the same query shape and gets back the same
  // `{ content, sha }` envelope either way.
  //
  // Registered here TOGETHER with its Manage panel (manage/areas.ts's
  // PANELS.posts) and not before: `areas.test.tsx` asserts this list and the
  // panel list are the same set, in both directions, so the two are one
  // change. 5A deliberately kept this file out and carried an exception in
  // content.test.ts for the whole of that sub-plan; that exception is gone.
  'posts.json',
```

In `CONTENT_FILE_LABELS`, after `'experiences.json': 'Experiences'`:

```ts
  'posts.json': 'Posts',
```

In `ContentTypeMap`, after `'experiences.json': Experience[]`:

```ts
  'posts.json': Post[];
```

> All three are total records or a `const` tuple the type is derived from, so missing any one of them is a `tsc -b` error rather than a file that reaches her screen unnamed. That is the whole design of this module and it does the work here.

- [ ] **Step 4: Add the panel**

`src/admin/manage/areas.ts`. In the `PanelId` union, after `| 'experiences'`:

```ts
  // Phase 5B, Task 3: the thirteenth panel. Registered in the same commit as
  // `posts.json`'s CONTENT_FILES entry -- `file` below is typed
  // ContentFileName, so this id is not even spellable before that lands.
  | 'posts';
```

In `PANELS`, after the `experiences` entry:

```ts
  posts: { id: 'posts', heading: 'Posts', file: 'posts.json' },
```

In `AREAS`, the `story` entry — `panelIds` and the `description`:

```ts
  {
    slug: 'story',
    label: 'Story & Photos',
    description: 'Photo galleries, your story, press coverage, and your blog',
    // 'posts' last: it is the newest thing on this screen and the one she
    // will be looking for deliberately rather than stumbling into, and
    // panelIds[0] is the panel an area opens by itself on her first ever
    // visit (open-sections.ts's hasSeededArea/markAreaSeeded) -- which
    // should stay Galleries, the panel that was there before.
    panelIds: ['galleries', 'story', 'press', 'posts'],
  },
```

Also fix the stale count in this file's own header comment: `// The five areas of /edit/manage, and the ten existing panels that live in them.` has been wrong since Phase 2 added the eleventh. Make it `// The five areas of /edit/manage, and the thirteen panels that live in them.`

- [ ] **Step 5: Add `data-panel`, and give the heading constant a reader**

`src/admin/CollapsibleSection.tsx`, line 108. One attribute, **zero classes**:

```tsx
    <section data-panel={id} className={open ? 'mb-10' : 'mb-2'}>
```

```
// A cheap, stable hook for a test to wait on. Every dashboard test that
// needs a panel currently finds it by role AND accessible name over the
// whole shell, which polls a getComputedStyle sweep every 50ms and starves
// the render it is waiting for -- the root cause of both timeouts this
// project has had, one of which failed a Cloudflare build. A `[data-panel]`
// lookup is 0.6ms. The expensive assertion still happens; it just happens
// ONCE, after this attribute says the panel is mounted.
//
// A data attribute rather than a class: it costs no CSS rule, and the
// stylesheet has 107 bytes of headroom.
```

Put that comment above the `<section>`, not inside the JSX attribute list.

Then create `src/admin/areas/PostsArea.tsx` as a stub that reads the constant:

```tsx
// The Posts panel -- Phase 5B. A stub in Task 3 and filled in Task 4: this
// task's job is the registration coupling (CONTENT_FILES, PANELS,
// content.test.ts's retired exception, e2e/edit-backend.ts), and shipping
// that with no panel on screen would leave `areas.test.tsx`'s
// panel-completeness assertion satisfied by a component that renders
// nothing anybody could find.
//
// It reads PANELS.posts.heading rather than repeating the string, and that
// is the first place in this dashboard that does. Every other panel paints a
// literal, which makes the constant's value load-bearing only through
// panel-snapshots.test.tsx and owner-facing-labels.test.tsx -- two files
// that catch a rename for reasons unrelated to the rename. Reading it here
// means a rename of PANELS.posts.heading changes what she sees, which is
// what the constant claims to be for.
import React from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import { PANELS } from '../manage/areas';
import type { AreaProps } from './area-props';

const PostsArea: React.FC<AreaProps> = ({ publishLocked }) => (
  <SectionErrorBoundary name={PANELS.posts.heading}>
    <CollapsibleSection id="posts" heading={PANELS.posts.heading} locked={publishLocked}>
      <p className={`mb-10 font-['Montserrat'] text-sm text-gray-500`}>Loading posts…</p>
    </CollapsibleSection>
  </SectionErrorBoundary>
);

export default PostsArea;
```

> `Loading posts…` is not a placeholder pretending to be finished work: it is the same string every sibling panel renders in its loading state, and Task 4 replaces it with the real fetch that makes it true. The alternative — an empty panel — would make `panel-snapshots.test.tsx`'s new snapshot record an empty `<div>` that a reviewer cannot distinguish from a broken one. **The ellipsis is the single character `…`, matching every other panel's string; `owner-facing-labels.test.tsx` reads panel text, so a three-dot version would be inconsistent with eleven siblings.**

`src/admin/manage/ManageShell.tsx`: import it and add it to the `story` case:

```tsx
import PostsArea from '../areas/PostsArea';
```

```tsx
    case 'story':
      return (
        <>
          <StoryPhotosArea {...areaProps} />
          {/* Phase 5B: the Posts panel renders here, not as a sixth
              AreaSlug -- manage/areas.ts's own panelIds already places the
              'posts' PanelId inside the 'story' area, and this switch
              dispatches by AreaSlug, one level up. No new case, so the
              `never` exhaustiveness check below is untouched. Same shape
              Awards and Experiences already take inside 'pages'. */}
          <PostsArea {...areaProps} />
        </>
      );
```

- [ ] **Step 6: Close the `/edit` preview gap, and the two fixture lists**

`src/admin/EditMode.tsx`. Replace `posts: EMPTY_POSTS,` (line 687) with:

```ts
    // Phase 5B, Task 3: a `pick` at last. `posts.json` is registered in
    // CONTENT_FILES now, so the blanket fetch effect below already puts its
    // real data into `entries` and this reads it the way every file above it
    // does. Before this, /edit held a permanently empty list, which was
    // honest only because /edit rendered no post surface at all -- and
    // Task 11 is about to give it one. An empty preview against real posts
    // live is Phase 3's EMPTY_EXPERIENCES defect verbatim: a carousel drawing
    // zero cards in /edit while the homepage showed six, which cost a full
    // fix round.
    posts: pick(entries, 'posts.json', EMPTY_POSTS),
```

And rewrite `EMPTY_POSTS`' own comment (line 254-279) down to the two sentences that are still true:

```ts
// The pre-fetch fallback for posts, the same shape every EMPTY_* above it
// is: what /edit renders for the one frame before GET /api/content answers.
// It stopped being a permanent value in Task 3, when posts.json joined
// CONTENT_FILES and `pick` became available -- see the bundle field below.
const EMPTY_POSTS: Post[] = [];
```

`e2e/edit-backend.ts`, after `'experiences.json'` in its own `CONTENT_FILES`:

```ts
  // Phase 5B, Task 3: posts.json joined src/admin/content.ts's CONTENT_FILES,
  // so EditMode's blanket load effect now fetches it and the route below has
  // to answer. A name missing from this array is answered 404, which paints a
  // "Could not load posts.json" banner ABOVE the real page content -- i.e. it
  // shifts everything every spec in this suite is about to measure, including
  // four already on the flake watchlist. It stays listed after Task 9 moves
  // the live copy to D1: realContentJson reads the committed file, which
  // still exists as the first-paint fallback.
  'posts.json',
```

`worker/__tests__/github.test.ts`, in the "still accepts the real content file" `it.each` (alphabetical, so between `'pages.json'` and `'press.json'`):

```ts
      // Phase 5B: CONTENT_PATH (/^src\/content\/[a-z0-9-]+\.json$/) already
      // matched this path before it was ever registered, so this row is an
      // assertion rather than a fix. It stays after Task 9 moves the live
      // copy to D1, exactly as story.json did: this allowlist is a security
      // boundary on which paths commitFiles will touch at all, not a map of
      // which store owns a path's live traffic.
      'posts.json',
```

- [ ] **Step 7: Run to verify it passes, and READ the new snapshot**

```
npx vitest run src/admin/manage/__tests__/areas.test.tsx src/admin/manage/__tests__/ManageShell.test.tsx src/admin/__tests__/content.test.ts src/admin/__tests__/panel-snapshots.test.tsx src/admin/__tests__/owner-facing-labels.test.tsx worker/__tests__/github.test.ts
npx tsc -b --noEmit
npx eslint .
```

Expected: PASS, `tsc -b` exit 0, eslint silent. `panel-snapshots.test.tsx` and `owner-facing-labels.test.tsx` each gain one case automatically, because both iterate `Object.keys(PANELS)`.

**Then open the new snapshot and read it.**

```bash
git diff src/admin/__tests__/__snapshots__/panel-snapshots.test.tsx.snap
```

Expected: exactly one added block, `the twelve panels, as they render today > Posts (posts) 1`, containing the `Loading posts…` paragraph and nothing else. **Never run `vitest -u`** — Phase 3 caught itself one keystroke from baking a real validation-error banner into a snapshot that way. Also rename that describe's title from "the twelve panels" to "the thirteen panels" in the same commit; leaving it will make the *whole file's* snapshot keys move on the next edit, which is a diff nobody can review.

> Note the CI asymmetry: vitest writes a missing snapshot on a local run and **fails** on it under CI. So this file is green locally the first time and would be red on Cloudflare if the `.snap` were not staged. That is what Step 9's `git add` covers, and it is why the gate runs after `git add`.

- [ ] **Step 8: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | Remove `'posts.json'` from `CONTENT_FILES` | **the mutation this task is FOR, and it must go red in four places.** `content.test.ts`'s derivation (`git ls-files` sees the file), `areas.test.tsx:95` (panel names a file the list lacks), `tsc -b` (`PANELS.posts.file` not assignable to `ContentFileName`, plus `ContentTypeMap`/`CONTENT_FILE_LABELS` now over-complete, plus `pick(entries, 'posts.json', ...)`), and `PostsArea`. **Count the reds; if only one appears, one of the four legs is not pinned** |
| 2 | Remove `'posts'` from `AREAS[2].panelIds` (keep `PANELS.posts`) | `areas.test.tsx`'s new "the Posts panel is the last one in Story & Photos" AND its `EXPECTED_PANEL_IDS` render sweep, AND `areas.test.tsx:95` (a `CONTENT_FILES` entry with no panel) |
| 3 | Rename `PANELS.posts.heading` to `'Postz'` | `ManageShell.test.tsx`'s new case still passes — **it reads the constant on both sides, so it cannot catch a rename, and that is correct**; what must go red is `panel-snapshots.test.tsx > Posts (posts)` on the changed snapshot text and `owner-facing-labels.test.tsx`. **Run it.** This is the mutation that proves `PostsArea` genuinely reads the constant rather than a literal that happens to match — under the old literal-painting design, only the snapshot would move, and the snapshot would move for a literal too. **The assertion that distinguishes them is #4** |
| 4 | In `PostsArea.tsx`, replace `heading={PANELS.posts.heading}` with `heading="Posts"` | **PREDICTED NOT TO REDDEN as the tests stand**, because the literal and the constant are the same string. That is the whole seventeenth-unfalsifiable-assertion shape. **Fix it before moving on** by adding this to `ManageShell.test.tsx`, which fails under the literal and passes under the constant: `it('the Posts panel paints the heading from PANELS, not a literal of its own', ...)` asserting `screen.getByRole('heading', { name: PANELS.posts.heading })` **after** mutating nothing — no, that passes either way. The assertion that works is a module-level one in `areas.test.tsx`: read `src/admin/areas/PostsArea.tsx` off disk with `readFileSync` and assert it contains `PANELS.posts.heading` and does not contain the bare string `heading="Posts"`. That is a source-level pin, it is honest about being one, and it is the only kind that can distinguish two identical strings. `src/admin/__tests__/content.test.ts` already sets the precedent for reading source in this suite |
| 5 | Remove `data-panel={id}` from `CollapsibleSection.tsx` | `ManageShell.test.tsx`'s new case fails at the `waitFor` with a timeout. **And this is a shared attribute — run the whole `src/admin/` suite** and confirm nothing else depended on it yet; Tasks 4, 5 and 10 will |
| 6 | Revert `posts: pick(...)` to `posts: EMPTY_POSTS` | **PREDICTED NOT TO REDDEN at this task**, because nothing on `/edit` renders a post yet — this is the same gap 5A recorded for `defaultBundle.posts` and fixed with an identity-plus-length binding test. **Add that test here rather than leaving it for Task 11:** in `src/admin/__tests__/EditMode.test.tsx` (or the file that already mounts `EditMode` with stubbed content), assert the bundle's `posts` is `toBe`-identical to the fetched entry's data and has non-zero length, so `posts: [...fetched]` is caught too. Then re-run the mutation and confirm exactly that one test reddens |
| 7 | Remove `'posts.json'` from `e2e/edit-backend.ts` | **Not caught by any vitest run.** Verify in Task 12's Playwright pass, or run `npx playwright test e2e/dashboard-sections.spec.ts` alone here (nothing else running, port 8080 is shared) and confirm the "Could not load posts.json" banner appears. **Record the result rather than assuming it** — this is the fourth coupling leg and the only one with no unit-test coverage |
| 8 | Remove the `'posts.json'` row from `worker/__tests__/github.test.ts` | nothing reddens, because `CONTENT_PATH` already matched. **Correctly so** — the row asserts an existing property. Recorded so nobody reads its non-reddening as a defect |

- [ ] **Step 9: Gate, after staging, then commit — ONE commit**

```bash
git add src/admin src/content e2e/edit-backend.ts worker/__tests__/github.test.ts
git status --short
npm run gate
```

`git status --short` before the gate, deliberately: `src/admin/__tests__/content.test.ts` shells out to `git ls-files`, so this test sees a different world either side of `git add`, and the new `.snap` block must be staged or Cloudflare fails on a missing snapshot. Confirm the staged set includes `src/admin/__tests__/__snapshots__/panel-snapshots.test.tsx.snap`.

Expected: exit 0, entry CSS still **38593 bytes** — a data attribute costs no rule, and `PostsArea`'s only classes (`mb-10`, `font-['Montserrat']`, `text-sm`, `text-gray-500`) are the exact string eleven sibling panels already ship.

```bash
git commit -m "feat(admin): register posts.json and give it a Manage panel

One commit, because the pieces require each other three ways and a fourth
that only Playwright can see. PanelDefinition.file is typed ContentFileName,
so the panel id is not spellable before the registration; areas.test.tsx
asserts the two lists are the same set in both directions; content.test.ts
derives from git ls-files, so 5A's exception and its inverse assertion both
retire here; and e2e/edit-backend.ts keeps its own copy of the list and 404s
anything absent from it, which paints a load-failure banner above the
content every dashboard spec measures.

/edit reads posts through pick now instead of a permanently empty constant.
That was honest while no post surface existed there and stops being honest
the moment one does -- an empty preview against real posts live is the
defect a carousel already shipped once.

CollapsibleSection gains a data-panel attribute so a test can wait on
something cheap. A role-and-name sweep over this shell is what failed a
Cloudflare build once, and this task makes the shell bigger.

The panel reads its heading from PANELS rather than painting a literal, so
the constant finally has a reader that changes what she sees."
```

---

### Task 4: `POST_FIELDS`, `PostList.tsx`, and the Posts panel for real

The list of posts, with every scalar field editable and a stubbed seam where blocks will go. **Read conflict 1 and conflict 2 in the conflict scan before starting** — the outline says to use `RecordList` and that does not compile, and the problem-routing partition has to ship in this task even though `BlockList` does not exist until Task 5.

**Why `RecordList` cannot be used, proven rather than argued.** `RecordListProps<T extends { id: string }>` requires `fields: FieldsOf<T>`; `FieldsOf<T>` demands a `FieldSpec` for every key of `Required<T>`; `FieldSpec<V>`'s three branches are all keyed on `Kind<V>`; and `Kind<Block[]>` matches none of `[string]`, `[string | null]`, `[string[]]`, `[boolean]`, `[number]`, so it is `never`. A probe declaring `FieldsOf<Post>` with `blocks: { label: 'Blocks', kind: 'text' }` fails with `error TS2322: Type 'string' is not assignable to type 'never'`; the same probe over `FieldsOf<Omit<Post, 'blocks'>>` compiles clean. **So: `PostMeta = Omit<Post, 'blocks'>`, and a bespoke `PostList.tsx`** — the same decision `GalleryList.tsx` and `StoryForm.tsx` already took for the same reason, and the same `FieldsOf<Pick<...>>` shape `GALLERY_IMAGE_FIELDS` already uses.

**Why the problem partition ships here and not in Task 5.** `validatePosts` emits `[0].blocks[2].text`. `problemsFor(problems, 0, 'blocks')` matches `p.field === '[0].blocks'` exactly — a suffix match was deliberately rejected — so a block problem matches no rendered key, and `RecordForm` then puts every unmatched **same-index** problem in its own form-level banner. Hand `RecordForm` the unfiltered list and every block message appears on the post's banner; let Task 5 also place it on its block and she sees each one twice. So this task partitions, and `PostList`'s own banner holds the block half until `BlockList` exists to claim it. **Nothing is ever dropped at any point in the sequence, and Step 5 pins that in both directions.**

**Files:**
- Create: `src/admin/blocks/block-problems.ts`
- Create: `src/admin/blocks/__tests__/block-problems.test.ts`
- Create: `src/admin/PostList.tsx`
- Create: `src/admin/__tests__/PostList.test.tsx`
- Modify: `src/admin/areas/PostsArea.tsx` (replace Task 3's stub with the real fetch/validate/commit panel)
- Create: `src/admin/areas/__tests__/PostsArea.test.tsx`
- Modify: `src/admin/fields.ts` (`PostMeta`, `POST_FIELDS`)
- Modify: `src/shared/upload-categories.ts` (`'posts'`)
- Test: also `src/admin/__tests__/fields.test.ts` (its existing sweeps pick the new record up automatically — confirm, do not assume)

**Interfaces:**
- Consumes: `'posts.json'` as a `ContentFileName`, `PANELS.posts`, `data-panel` (Task 3); `Post`, `PostType`, `Block` from `src/content/types`; `POST_TYPES` from `src/content/guards`; `RecordForm`, `MOVE_BUTTON_CLASSNAME`, `REMOVE_BUTTON_CLASSNAME`, `ADD_BUTTON_CLASSNAME`, `fetchContent`, `registerLoaded`, `useValidation`, `replaceAt`, `fromStagedPhoto`, `Thumbnail`, `CollapsibleSection`, `SectionErrorBoundary`, `AreaProps`.
- Produces, consumed by Tasks 5, 6, 7, 8, 10, 11:
  - `export type PostMeta = Omit<Post, 'blocks'>` and `export const POST_FIELDS: FieldsOf<PostMeta>` from `src/admin/fields.ts`
  - `export function isBlockProblem(field: string): boolean` and `export function blockProblemOf(field: string): BlockProblemTarget | undefined` from `src/admin/blocks/block-problems.ts`, where `export interface BlockProblemTarget { post: number; block: number | undefined; key: string | undefined }`
  - `export default function PostList(props: PostListProps)` from `src/admin/PostList.tsx`, with `PostListProps` as written in Step 3
  - `blankPost(): Post` — module-private to `PostsArea.tsx`, mentioned so no later task looks for it elsewhere
  - `'posts'` as an `UploadCategory`

- [ ] **Step 1: Write the failing problem-routing test**

Create `src/admin/blocks/__tests__/block-problems.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { blockProblemOf, isBlockProblem } from '../block-problems';

// Every field shape validatePosts can emit for a post, taken from
// src/content/validate.ts's own validatePost/validateBlock rather than
// invented here. The partition below has to be exhaustive in BOTH
// directions: a shape that matches neither predicate is a message the owner
// never sees, and RecordList's own comment calls a total silent loss worse
// than a message in the wrong place.
const POST_FIELD_SHAPES = [
  '',
  '[0].id',
  '[0].slug',
  '[0].type',
  '[0].title',
  '[0].date',
  '[0].excerpt',
  '[0].image',
  '[0].publishAt',
];

const BLOCK_FIELD_SHAPES = [
  '[0].blocks',
  '[0].blocks[0].kind',
  '[0].blocks[0].text',
  '[0].blocks[2].items',
  '[0].blocks[2].items[1]',
  '[0].blocks[3].src',
  '[0].blocks[3].alt',
  '[0].blocks[3].caption',
  '[0].blocks[4].images[0].src',
  '[0].blocks[5].attribution',
  '[0].blocks[6].heading',
  '[0].blocks[7].publication',
  '[0].blocks[7].url',
  '[0].blocks[7].date',
  '[0].blocks[8].align',
];

describe('isBlockProblem partitions a posts.json problem list', () => {
  it.each(BLOCK_FIELD_SHAPES)('claims %s', (field) => {
    expect(isBlockProblem(field)).toBe(true);
  });

  it.each(POST_FIELD_SHAPES)('leaves %s to the post form', (field) => {
    expect(isBlockProblem(field)).toBe(false);
  });

  // The direction that is easy to forget: a field naming a DIFFERENT post's
  // blocks still belongs to the block half, so RecordForm never sees it and
  // never banners it. RecordForm's own belongsToAnotherIndex would have
  // dropped it, which is right for a rendered sibling and wrong for one the
  // list is not rendering at all.
  it('claims another post index too', () => {
    expect(isBlockProblem('[7].blocks[1].text')).toBe(true);
  });

  it('does not claim a field that merely starts with the same letters', () => {
    expect(isBlockProblem('[0].blocksy')).toBe(false);
    expect(isBlockProblem('[0].blocks.text')).toBe(false);
  });
});

describe('blockProblemOf', () => {
  it.each([
    ['[0].blocks', { post: 0, block: undefined, key: undefined }],
    ['[0].blocks[2].text', { post: 0, block: 2, key: 'text' }],
    ['[3].blocks[10].items[1]', { post: 3, block: 10, key: 'items[1]' }],
    ['[0].blocks[4].images[0].src', { post: 0, block: 4, key: 'images[0].src' }],
    ['[0].blocks[0]', { post: 0, block: 0, key: undefined }],
  ])('reads %s', (field, expected) => {
    expect(blockProblemOf(field)).toEqual(expected);
  });

  it('returns undefined for a field it does not own', () => {
    expect(blockProblemOf('[0].title')).toBeUndefined();
    expect(blockProblemOf('')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write `block-problems.ts`**

```ts
// Where a posts.json validation problem belongs on screen.
//
// src/admin/problems.ts cannot answer this, and the reason is structural
// rather than an oversight: problemsFor(problems, 0, 'blocks') matches
// `[0].blocks` EXACTLY -- a suffix match was deliberately rejected there,
// because `field.endsWith('.' + key)` would also match `[1].name` while
// rendering index 0 -- so `[0].blocks[2].text` matches no rendered key of the
// post form. RecordForm then puts every unmatched SAME-INDEX problem into its
// own form-level banner, so without this partition every block message would
// appear on the post rather than on the block, and if BlockList also placed
// it she would see each one twice.
//
// A second, independently-written regex rather than a shared one, which is
// exactly the call StoryForm.tsx made for PARAGRAPH_ITEM and for the same
// reason it wrote out there: unifying it with problems.ts's ARRAY_ITEM would
// either miss this shape (`[i].key[j].sub`, three levels) or wrongly widen
// that one.
const BLOCK_PROBLEM = /^\[(\d+)\]\.blocks(?:\[(\d+)\](?:\.(.+))?)?$/;

export interface BlockProblemTarget {
  // Which post in the list.
  post: number;
  // Which block within it, or undefined for a problem about the block LIST
  // itself -- validatePost's "has nothing in it yet" names `[i].blocks` with
  // no index, and that message has to reach her or deleting her last block
  // leaves an Add button with no explanation. RecordList's unclaimedProblems
  // exists for precisely this shape one level up.
  block: number | undefined;
  // The field within the block, or undefined for a problem about the block as
  // a whole. Carries any nesting after it verbatim (`items[1]`,
  // `images[0].src`) so BlockList can place a list item's own message on that
  // item rather than on the list.
  key: string | undefined;
}

export function blockProblemOf(field: string): BlockProblemTarget | undefined {
  const found = field.match(BLOCK_PROBLEM);
  if (found === null) return undefined;
  return {
    post: Number(found[1]),
    block: found[2] === undefined ? undefined : Number(found[2]),
    key: found[3],
  };
}

export function isBlockProblem(field: string): boolean {
  return BLOCK_PROBLEM.test(field);
}
```

Run it:

```
npx vitest run src/admin/blocks/__tests__/block-problems.test.ts
```

Expected: PASS.

- [ ] **Step 3: Add `PostMeta` and `POST_FIELDS`, and the upload category**

`src/shared/upload-categories.ts` — the list and its header count:

```ts
// The NINE directories that may exist under assets-source/, and the only
// `category` values POST /api/upload accepts.
```

```ts
export const UPLOAD_CATEGORIES = ['atmosphere', 'food', 'hero', 'mocktails', 'our_story', 'press', 'team', 'experiences', 'posts'] as const;
```

Add above the list:

```ts
// 'posts' is the ninth, and the first whose directory does not exist yet.
// That is fine and is not an oversight: scripts/images.mjs walks
// assets-source/ and simply finds no files under a directory that is not
// there, worker/upload.ts commits into the path on the first upload, and
// scripts/paths.mjs's DIR_MAX_WIDTH has no entry for it deliberately -- a
// post photo is a full-width figure inside a 3xl column, so DEFAULT_MAX_WIDTH
// (1000) is the right size and a special case would be one more thing to
// keep true. Nothing binds this list to the filesystem: both tests that read
// it check MEMBERSHIP, never length.
```

`src/admin/fields.ts`. Add `Post` and `PostType` to the existing `import type { ... } from '../content/types'` list, and `POST_TYPES` to the existing `import { GALLERY_LAYOUTS } from '../content/guards'`. Then, after `EXPERIENCE_FIELDS`:

```ts
// ---------------------------------------------------------------------------
// Post -- and the one record type in this file that CANNOT be described whole.
//
// `FieldsOf<Post>` is uninhabitable, and that is a fact about the type system
// rather than a limitation of this file. FieldsOf demands a FieldSpec for
// every key of Required<T>; FieldSpec<V>'s three branches are all keyed on
// Kind<V>; and Kind<Block[]> matches none of Kind's five cases, so it is
// `never`, so no value of any shape satisfies it. Confirmed with a probe
// module: `blocks: { label: 'Blocks', kind: 'text' }` inside a
// FieldsOf<Post> fails `tsc -b` with TS2322 "Type 'string' is not assignable
// to type 'never'".
//
// So blocks are edited entirely outside FieldsOf/RecordForm -- the same
// decision GalleryList.tsx and StoryForm.tsx already took for an array-valued
// field, and the same `FieldsOf<Pick<...>>` shape GALLERY_IMAGE_FIELDS above
// already uses. PostList.tsx renders RecordForm<PostMeta> for the scalars and
// BlockList for the rest.
export type PostMeta = Omit<Post, 'blocks'>;

export const POST_FIELDS: FieldsOf<PostMeta> = {
  id: {
    label: 'ID',
    kind: 'text',
    help: 'A short identifier used only to tell posts apart -- changing it does not rename or relink anything else.',
  },
  // The web address, and the one field that is expensive to change after
  // publishing: an inbound link to the old one stops working. Said here
  // rather than left for her to find out, because nothing in this dashboard
  // can add a redirect on her behalf.
  slug: {
    label: 'Web address',
    kind: 'text',
    help: 'The last part of the post’s address, e.g. "spaghetti-all-assassina" for /blog/spaghetti-all-assassina. Letters a-z, numbers and hyphens only. Changing it after the post is live breaks any link anyone already has to it.',
  },
  // Options come from POST_TYPES (src/content/guards.ts), the one array that
  // is checked exhaustive against the PostType union at compile time -- the
  // same reason SECTION_FIELDS reads GALLERY_LAYOUTS rather than retyping
  // three strings. A select that could offer a type the validator refuses,
  // or miss one it accepts, is the failure this avoids.
  type: {
    label: 'Kind of post',
    kind: 'select',
    options: POST_TYPES,
    help: 'A recipe is something to cook, a story is something to read, and a mention is somebody else writing about the restaurant.',
  },
  title: { label: 'Title', kind: 'text' },
  date: { label: 'Published on', kind: 'date' },
  excerpt: {
    label: 'Short summary',
    kind: 'textarea',
    help: 'One or two sentences. This is what shows on the card, not in the post itself.',
  },
  // 'posts', the ninth upload category (src/shared/upload-categories.ts) and
  // the first one added for a content type rather than reused from a
  // neighbour -- unlike AWARD_FIELDS.image, which borrows 'press'. A post
  // photo is a full-width figure and a press logo is a 96px badge; sharing a
  // directory would mean sharing a max width neither wants.
  image: { label: 'Card photo', kind: 'image', category: 'posts' },
};
```

> `POST_TYPES` is `PostType[]` and the `select` branch wants `readonly V[]` with `V = PostType`. That checks. The rendered `<option>` text is the raw value (`Field.tsx:193-195` renders `{String(option)}`), so she sees `recipe`, `story`, `mention` — three plain English words, with the `help` string above explaining what a mention is. **Do not add a label map for this**: `Field.tsx`'s select has no slot for one, and adding one is a change to a component eleven other fields render through.

- [ ] **Step 4: Write the failing `PostList` test**

Create `src/admin/__tests__/PostList.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostList from '../PostList';
import { POST_FIELDS } from '../fields';
import { createPreviews } from '../previews';
import type { Post } from '../../content/types';
import type { ValidationProblem } from '../../content/validate';

// Fixtures that differ from src/content/posts.json in EVERY field asserted
// on. Phase 4's root cause was two fixtures equal to the real committed
// content, which cannot distinguish a real binding from a hardcoded copy of
// that same data -- the assertion passes either way and looks perfectly
// reasonable while doing so.
const POSTS: Post[] = [
  {
    id: 'fixture-a',
    slug: 'a-fixture-post',
    type: 'recipe',
    title: 'A fixture post',
    date: '2026-03-04',
    excerpt: 'A fixture excerpt.',
    image: '/food/tielle.webp',
    blocks: [{ kind: 'paragraph', text: 'A fixture paragraph.' }],
  },
  {
    id: 'fixture-b',
    slug: 'a-second-fixture-post',
    type: 'story',
    title: 'A second fixture post',
    date: '2026-02-01',
    excerpt: 'A second fixture excerpt.',
    image: '/food/tiramisu.webp',
    blocks: [{ kind: 'heading', text: 'A fixture heading' }],
  },
];

function renderList(overrides: Partial<React.ComponentProps<typeof PostList>> = {}) {
  const onChange = vi.fn();
  const onReorder = vi.fn();
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  const view = render(
    <PostList
      items={POSTS}
      onChange={onChange}
      onReorder={onReorder}
      onAdd={onAdd}
      onRemove={onRemove}
      problems={[]}
      onStaged={vi.fn()}
      previews={createPreviews()}
      {...overrides}
    />,
  );
  return { ...view, onChange, onReorder, onAdd, onRemove };
}

describe('PostList renders one form per post', () => {
  it('shows every scalar field POST_FIELDS declares, and no field for blocks', () => {
    renderList();
    Object.values(POST_FIELDS).forEach((spec) => {
      expect(screen.getAllByText(spec.label, { selector: 'label' }).length).toBe(POSTS.length);
    });
    expect(screen.queryByText('Blocks', { selector: 'label' })).toBeNull();
  });

  it('binds each post’s own values, not the first post’s twice', () => {
    renderList();
    expect(screen.getByDisplayValue('A fixture post')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A second fixture post')).toBeInTheDocument();
    expect(screen.getByDisplayValue('a-fixture-post')).toBeInTheDocument();
    expect(screen.getByDisplayValue('a-second-fixture-post')).toBeInTheDocument();
  });

  it('editing a scalar keeps the post’s blocks intact', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    const title = screen.getByDisplayValue('A fixture post');
    await user.clear(title);
    await user.type(title, 'X');
    const [index, next] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(index).toBe(0);
    expect(next.blocks).toEqual([{ kind: 'paragraph', text: 'A fixture paragraph.' }]);
  });

  // The stale-draft defence, at the read boundary rather than left to
  // Task 10. A draft saved before blocks existed restores through
  // registerLoaded's unchecked `draftEntry.data as ContentTypeMap[K]` cast
  // with no `blocks` key at all, and the only error boundary between this
  // component and the page is per-SECTION -- so an unguarded read would take
  // the whole panel down, heading included, rather than leaving her one
  // fixable field.
  it('a post with no blocks key at all renders instead of crashing', () => {
    const noBlocks = { ...POSTS[0] } as Partial<Post>;
    delete noBlocks.blocks;
    expect(() =>
      renderList({ items: [noBlocks as Post] }),
    ).not.toThrow();
    expect(screen.getByDisplayValue('A fixture post')).toBeInTheDocument();
  });
});

describe('PostList reorders and removes', () => {
  it('Up is omitted on the first post and Down on the last', () => {
    renderList();
    expect(screen.queryByRole('button', { name: 'Move A fixture post up' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move A fixture post down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move A second fixture post up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move A second fixture post down' })).toBeNull();
  });

  it('Down hands back the swapped id order', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move A fixture post down' }));
    expect(onReorder).toHaveBeenCalledWith(['fixture-b', 'fixture-a']);
  });

  it('Remove names the post it removes', async () => {
    const user = userEvent.setup();
    const { onRemove } = renderList();
    await user.click(screen.getByRole('button', { name: 'Remove A second fixture post' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('an untitled post is still nameable in its own buttons', () => {
    renderList({ items: [{ ...POSTS[0], title: '' }, POSTS[1]] });
    expect(screen.getByRole('button', { name: 'Remove Untitled post' })).toBeInTheDocument();
  });
});

describe('PostList places every problem somewhere, and only once', () => {
  const PROBLEMS: ValidationProblem[] = [
    { field: '[0].title', message: 'the post at position 0 needs a title' },
    { field: '[0].blocks[0].text', message: 'a paragraph needs some words' },
    { field: '[0].blocks', message: 'this post has nothing in it yet' },
    { field: '[9].slug', message: 'a post that is not rendered here' },
    { field: '', message: 'expected a list of posts' },
  ];

  it('a scalar problem lands on its own field, not in a banner', () => {
    renderList({ problems: PROBLEMS });
    const field = screen.getAllByText(POST_FIELDS.title.label, { selector: 'label' })[0].parentElement!;
    expect(within(field).getByText('the post at position 0 needs a title')).toBeInTheDocument();
  });

  // The partition, asserted in the direction that catches a double
  // display. RecordForm banners every unmatched same-index problem, so
  // without the filter these two messages appear on the post AS WELL AS
  // wherever BlockList puts them.
  it('a block problem is NOT shown by the post form', () => {
    renderList({ problems: PROBLEMS });
    const forms = screen.getAllByTestId('post-form');
    expect(within(forms[0]).queryByText('a paragraph needs some words')).toBeNull();
    expect(within(forms[0]).queryByText('this post has nothing in it yet')).toBeNull();
  });

  // ...and in the direction that catches a total silent loss, which
  // RecordList's own comment calls the worse of the two.
  it('every problem in the list is on screen exactly once', () => {
    const { container } = renderList({ problems: PROBLEMS });
    PROBLEMS.forEach((problem) => {
      const hits = [...container.querySelectorAll('*')].filter(
        (el) => el.children.length === 0 && el.textContent === problem.message,
      );
      expect(hits.length, `"${problem.message}" appears ${hits.length} times`).toBe(1);
    });
  });
});
```

> `screen.getAllByTestId('post-form')` needs `data-testid="post-form"` on the wrapper `PostList` puts around each `RecordForm`; Step 5 adds it. A `data-testid` is used here rather than a role because a `<div>` grouping a form's fields has no role of its own, and giving it one purely for a test would put a landmark in her accessibility tree that means nothing to her.
>
> The `container.querySelectorAll('*')` sweep is deliberately leaf-only (`el.children.length === 0`): counting every ancestor whose `textContent` happens to equal the message would count the same message once per level of nesting. This is the "exhaustive in both directions" posture that made `EDITABLE_TEXT_PATHS`' 27 + 11 = 38 partition trustworthy, and it is the assertion that will catch Task 5 double-placing.

- [ ] **Step 5: Write `PostList.tsx`**

```tsx
// posts.json's own list screen. Bespoke rather than RecordList, and forced
// rather than chosen: RecordListProps<T> wants FieldsOf<T>, and
// FieldsOf<Post> is uninhabitable because Kind<Block[]> is `never` (see
// POST_FIELDS' own comment in fields.ts, and the TS2322 the probe there
// records). So the scalars go through RecordForm<PostMeta> and the blocks go
// through BlockList -- the same split GalleryList.tsx and StoryForm.tsx
// already make for an array-valued field.
//
// Every button class string is imported from RecordList rather than retyped.
// A retyped Tailwind string is a brand-new class to the content scanner and
// ships extra CSS for a rule that already exists, which is why those three
// bindings are exported at all (RecordList.tsx's own comment says so, and
// HoursField/SectionList/StoryForm already read them).
import RecordForm from './RecordForm';
import BlockList from './blocks/BlockList';
import { isBlockProblem } from './blocks/block-problems';
import { ADD_BUTTON_CLASSNAME, MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME } from './RecordList';
import Thumbnail from './manage/Thumbnail';
import { POST_FIELDS, type PostMeta } from './fields';
import type { ImagePreviews } from './previews';
import type { StagedPhoto } from './PhotoField';
import type { Block, Post } from '../content/types';
import type { ValidationProblem } from '../content/validate';

export interface PostListProps {
  items: Post[];
  onChange: (index: number, next: Post) => void;
  // The id ORDER, never a reordered array: this is a controlled list and the
  // caller owns `items`, the same contract RecordList documents.
  onReorder: (ids: string[]) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  // The FULL posts.json problem list, unfiltered. This component is the one
  // place that knows how many post forms are mounted and how many blocks each
  // one has, so it is the one place that can tell "belongs to a sibling I am
  // not rendering" from "belongs to nobody at all".
  problems: ValidationProblem[];
  onStaged: (key: string, staged: StagedPhoto | null) => void;
  previews: ImagePreviews;
}

// Written out rather than rest-destructured (`const { blocks, ...meta } =
// post`). A field added to Post is then a compile error HERE, naming this
// function, instead of a field silently missing from every post form.
function metaOf(post: Post): PostMeta {
  return {
    id: post.id,
    slug: post.slug,
    type: post.type,
    title: post.title,
    date: post.date,
    excerpt: post.excerpt,
    image: post.image,
  };
}

// A draft saved before this feature existed restores through
// registerLoaded's unchecked cast (sections/register-loaded.ts) with no
// `blocks` key at all, so this reads `undefined` at runtime while Post's
// type promises an array. The only error boundary between here and the page
// is per-SECTION, so an unguarded read would not leave her one broken field
// -- it would take the whole Posts panel down, heading included. Same
// treatment StoryForm.tsx gives a missing `chef`.
function blocksOf(post: Post): Block[] {
  return Array.isArray(post.blocks) ? post.blocks : [];
}

export default function PostList({
  items,
  onChange,
  onReorder,
  onAdd,
  onRemove,
  problems,
  onStaged,
  previews,
}: PostListProps) {
  // The partition. RecordForm banners every unmatched SAME-INDEX problem, so
  // handing it a block problem would show that message on the post as well
  // as on its block. This is a deliberate departure from RecordForm's
  // "not pre-filtered" contract, and it is safe only because BlockList
  // claims the whole other half -- PostList.test.tsx asserts both
  // directions, so a message cannot end up in two places OR in none.
  const metaProblems = problems.filter((p) => !isBlockProblem(p.field));

  function swap(index: number, otherIndex: number): void {
    const ids = items.map((item) => item.id);
    const moved = ids[index];
    ids[index] = ids[otherIndex];
    ids[otherIndex] = moved;
    onReorder(ids);
  }

  return (
    <div>
      <ul>
        {items.map((post, index) => {
          const name = post.title || 'Untitled post';
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          return (
            <li key={post.id} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Thumbnail
                    path={post.image ?? null}
                    previewKey={`posts.json:${post.id}:image`}
                    previews={previews}
                  />
                  {/* Omitted at the ends, not disabled -- RecordList's own
                      rule, and its reasoning applies unchanged: a control
                      that reads as live and does nothing is worse than no
                      control. */}
                  {!isFirst && (
                    <button
                      type="button"
                      aria-label={`Move ${name} up`}
                      onClick={() => swap(index, index - 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Up
                    </button>
                  )}
                  {!isLast && (
                    <button
                      type="button"
                      aria-label={`Move ${name} down`}
                      onClick={() => swap(index, index + 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Down
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => onRemove(index)}
                  className={REMOVE_BUTTON_CLASSNAME}
                >
                  Remove
                </button>
              </div>
              <div data-testid="post-form">
                <RecordForm<PostMeta>
                  fields={POST_FIELDS}
                  index={index}
                  value={metaOf(post)}
                  onChange={(next) => onChange(index, { ...next, blocks: blocksOf(post) })}
                  problems={metaProblems}
                  onStaged={(fieldKey, staged) => onStaged(`${post.id}:${fieldKey}`, staged)}
                  previews={previews}
                  previewKeyPrefix={`posts.json:${post.id}`}
                  scope="posts"
                />
              </div>
              <BlockList
                blocks={blocksOf(post)}
                postIndex={index}
                onChange={(nextBlocks) => onChange(index, { ...metaOf(post), blocks: nextBlocks })}
                problems={problems}
                previews={previews}
                onStaged={(key, staged) => onStaged(`${post.id}:${key}`, staged)}
                previewKeyPrefix={`posts.json:${post.id}`}
              />
            </li>
          );
        })}
      </ul>

      {/* `() => onAdd()`, not `onAdd` -- onClick would forward the DOM
          MouseEvent as the first argument, which does not match this
          component's own no-argument contract. RecordList documents the
          same trap. */}
      <button type="button" onClick={() => onAdd()} className={ADD_BUTTON_CLASSNAME}>
        Add a post
      </button>
    </div>
  );
}
```

**`BlockList` does not exist yet, so this task ships a minimal version of it that renders the block half as a banner and nothing else.** Create `src/admin/blocks/BlockList.tsx`:

```tsx
// Phase 5B, Task 4: the block half of the problem partition, and only that.
// Task 5 turns this into the real per-block editor.
//
// It exists in this shape rather than as an empty component because
// PostList.tsx filters block problems out of the post form in this same
// commit, and a filter with nothing on the other side of it is a silent
// loss -- the failure RecordList's own unclaimedProblems comment calls
// worse than a message in the wrong place. So from the first commit, every
// message reaches her; Task 5 only improves WHERE.
import { blockProblemOf } from './block-problems';
import type { Block } from '../../content/types';
import type { ImagePreviews } from '../previews';
import type { StagedPhoto } from '../PhotoField';
import type { ValidationProblem } from '../../content/validate';

export interface BlockListProps {
  blocks: Block[];
  // Which post in the list, so this component can pick its own problems out
  // of the whole file's list without the caller pre-slicing (the same
  // "hand it everything" contract RecordList takes, for the same reason).
  postIndex: number;
  onChange: (next: Block[]) => void;
  problems: ValidationProblem[];
  previews: ImagePreviews;
  onStaged: (key: string, staged: StagedPhoto | null) => void;
  previewKeyPrefix: string;
}

export default function BlockList({ blocks, postIndex, problems }: BlockListProps) {
  const mine = problems.filter((p) => blockProblemOf(p.field)?.post === postIndex);
  if (mine.length === 0) return null;
  return (
    <div
      role="alert"
      aria-label="Problems with this post’s content"
      className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
    >
      <ul className="list-disc pl-5">
        {mine.map((p, i) => (
          <li key={i}>{p.message}</li>
        ))}
      </ul>
    </div>
  );
}
```

> The unused props (`blocks`, `onChange`, `previews`, `onStaged`, `previewKeyPrefix`) will fail `npx eslint .` under `@typescript-eslint/no-unused-vars`. **Do not delete them from the interface** — Task 5 needs the interface to be the final one so `PostList` never changes again. Destructure only what is used, as written above: the interface declares them, the destructure does not take them, and eslint is satisfied. That is why the signature above lists three names and the interface lists seven.

- [ ] **Step 6: Write the real `PostsArea.tsx`**

Replace Task 3's stub entirely. `AwardsArea.tsx` shape for shape, including the `ContentNotFoundError` branch — **which `posts.json` needs for a different reason than `awards.json` did, and the comment says which:** after Task 9 moves the live copy to D1, `GET /api/content?path=src/content/posts.json` 404s until the seed runs, and a 404 between the flip and the seed must not put an error banner in front of her.

```tsx
// The Posts panel -- Phase 5B. PagesArea/AwardsArea shape for shape:
// SectionErrorBoundary wrapping CollapsibleSection wrapping a section that
// loads through fetchContent, registers via registerLoaded, validates via
// useValidation and commits through registry.updateData.
//
// The heading comes from PANELS.posts (manage/areas.ts) rather than a
// literal, which makes this the first panel whose painted heading actually
// depends on that constant. Every sibling repeats the string, which is why a
// rename there is caught only by panel-snapshots.test.tsx and
// owner-facing-labels.test.tsx -- two files that catch it for reasons
// unrelated to the rename.
//
// The 404 branch: awards.json needed one because no award had ever been
// published. posts.json needs one for a different reason and it is worth
// naming, because it is a WINDOW rather than a first-run state -- Task 9
// moves the live copy to D1, and between that flip and
// scripts/seed-posts-d1.mjs running there is no row. A 404 in that window
// must read as "no posts yet", not as a failure in front of her.
import React, { useEffect, useState } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import SectionErrorBoundary from '../SectionErrorBoundary';
import { registerLoaded } from '../sections/register-loaded';
import PostList from '../PostList';
import { PANELS } from '../manage/areas';
import { fetchContent, ContentNotFoundError } from '../content';
import { replaceAt, useValidation } from '../useValidation';
import { fromStagedPhoto } from '../staged';
import type { StagedFile } from '../staged';
import type { ContentRegistry } from '../publish';
import type { DraftMap } from '../drafts';
import type { ImagePreviews } from '../previews';
import type { Post } from '../../content/types';
import type { AreaProps } from './area-props';

const PostsArea: React.FC<AreaProps> = ({ registry, restoreDraft, stage, publishLocked, previews }) => (
  <SectionErrorBoundary name={PANELS.posts.heading}>
    <CollapsibleSection id="posts" heading={PANELS.posts.heading} locked={publishLocked}>
      <PostsSection registry={registry} restoreDraft={restoreDraft} stage={stage} previews={previews} />
    </CollapsibleSection>
  </SectionErrorBoundary>
);

type PostsLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Post[]; sha: string };

function PostsSection({
  registry,
  restoreDraft,
  stage,
  previews,
}: {
  registry: ContentRegistry;
  restoreDraft: DraftMap | null;
  stage: (key: string, file: StagedFile | null) => void;
  previews: ImagePreviews;
}) {
  const [state, setState] = useState<PostsLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchContent('posts.json')
      .then((loaded) => {
        if (!cancelled) {
          const data = registerLoaded(registry, 'posts.json', loaded, restoreDraft);
          setState({ status: 'loaded', data, sha: loaded.sha });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ContentNotFoundError) {
          // `sha: ''` is a real, load-bearing sentinel and never a value GET
          // /api/content hands back for any file -- buildPublishRequest
          // (publish.ts) reads it back out and omits `baseSha` entirely for
          // the first publish this makes. Not a placeholder and not a
          // fabricated sha, both of which would break the concurrency guard.
          const data = registerLoaded(registry, 'posts.json', { data: [], sha: '' }, restoreDraft);
          setState({ status: 'loaded', data, sha: '' });
          return;
        }
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.status === 'loaded' ? state.data : undefined;
  const problems = useValidation('posts.json', data);

  if (state.status === 'loading') {
    return <p className={`mb-10 font-['Montserrat'] text-sm text-gray-500`}>Loading posts…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className={`mb-10 font-['Montserrat'] text-sm text-red-600`}>
        {`Could not load posts: ${state.message}`}
      </p>
    );
  }

  const items = state.data;
  const sha = state.sha;
  function commit(next: Post[]) {
    registry.updateData('posts.json', next);
    setState({ status: 'loaded', data: next, sha });
  }

  return (
    <PostList
      items={items}
      onChange={(index, next) => commit(replaceAt(items, index, next))}
      onReorder={(ids) => {
        const byId = new Map(items.map((item) => [item.id, item]));
        commit(ids.map((id) => byId.get(id) as Post));
      }}
      onAdd={() => commit([...items, blankPost()])}
      onRemove={(index) => commit(items.filter((_, i) => i !== index))}
      problems={problems}
      onStaged={(key, staged) => stage(`posts.json:${key}`, fromStagedPhoto(staged))}
      previews={previews}
    />
  );
}

// A blank starting point for "Add a post": every required field present, so
// the freshly-added record renders and immediately shows her, through the
// same debounced validation as everything else, exactly what it still needs.
// AwardsArea's blankAward posture, with one difference.
//
// The difference is `date`, and it is pre-filled rather than left empty. A
// date input with nothing in it is the one field on this form whose empty
// state gives her no hint about the format it wants, and today is very
// nearly always the right answer for a post she is writing now. Every other
// field is genuinely better left blank, because the validator's own sentence
// is a better prompt than a made-up value would be.
//
// `blocks: []` on purpose: validatePost refuses an empty block list with
// "has nothing in it yet -- add a paragraph before publishing it", which is
// exactly the sentence that should be on screen next to the block picker the
// moment she adds a post.
function blankPost(): Post {
  return {
    id: crypto.randomUUID(),
    slug: '',
    type: 'story',
    title: '',
    date: new Date().toISOString().slice(0, 10),
    excerpt: '',
    image: '',
    blocks: [],
  };
}

export default PostsArea;
```

- [ ] **Step 7: Write the panel test**

Create `src/admin/areas/__tests__/PostsArea.test.tsx`. **Copy the harness (`stubFetch`, `renderDashboard`) from `src/admin/manage/__tests__/ManageShell.test.tsx` rather than inventing one**, so the fetch stub answers the session probe and every content file the shell loads; a harness that answers only `posts.json` puts eleven "Could not load" banners on screen and shifts everything this test measures.

```tsx
// The panel, mounted inside the real shell rather than in isolation: the
// thing most likely to break here is the seam (fetchContent's generic,
// registerLoaded's file key, useValidation's file key), and every one of
// those is only exercised by a real mount.
//
// The wait is on [data-panel="posts"] and then on a display value, never on
// findByRole with a name filter over the shell. That query is what failed a
// Cloudflare build once, and this file adds to the same shell.
describe('the Posts panel', () => {
  it('renders every committed post it is given', async () => {
    stubFetchWithPosts(FIXTURE_POSTS);
    renderDashboard('/edit/manage/story');

    await waitFor(() => {
      expect(document.querySelector('[data-panel="posts"]')).not.toBeNull();
    });
    const panel = document.getElementById('section-panel-posts')!;
    expect(await within(panel).findByDisplayValue('A fixture post')).toBeInTheDocument();
    expect(within(panel).getByDisplayValue('a-fixture-post')).toBeInTheDocument();
  });

  it('a 404 reads as no posts yet, not as a failure', async () => {
    stubFetchNotFound('posts.json');
    renderDashboard('/edit/manage/story');

    await waitFor(() => {
      expect(document.querySelector('[data-panel="posts"]')).not.toBeNull();
    });
    const panel = document.getElementById('section-panel-posts')!;
    expect(await within(panel).findByRole('button', { name: 'Add a post' })).toBeInTheDocument();
    expect(within(panel).queryByText(/Could not load posts/)).toBeNull();
  });

  it('a real failure says so, in its own field, without taking the heading down', async () => {
    stubFetchFailing('posts.json', 502, 'GitHub is unreachable');
    renderDashboard('/edit/manage/story');

    await waitFor(() => {
      expect(document.querySelector('[data-panel="posts"]')).not.toBeNull();
    });
    // The heading survives, which is the Phase 4 lesson: a panel that throws
    // takes SectionErrorBoundary's whole subtree, heading included.
    expect(screen.getByRole('heading', { name: PANELS.posts.heading })).toBeInTheDocument();
    const panel = document.getElementById('section-panel-posts')!;
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/Could not load posts.*GitHub is unreachable/);
  });

  it('Add a post produces a record whose problems name what it still needs', async () => {
    const user = userEvent.setup();
    stubFetchWithPosts([]);
    renderDashboard('/edit/manage/story');

    await waitFor(() => {
      expect(document.querySelector('[data-panel="posts"]')).not.toBeNull();
    });
    const panel = document.getElementById('section-panel-posts')!;
    await user.click(await within(panel).findByRole('button', { name: 'Add a post' }));

    // Every problem the validator raises for a blank post, each on its own
    // field or in the block banner -- never a single "something is wrong".
    expect(await within(panel).findByText(/needs a web address/)).toBeInTheDocument();
    expect(within(panel).getByText(/needs a title/)).toBeInTheDocument();
    expect(within(panel).getByText(/needs a short summary/)).toBeInTheDocument();
    expect(within(panel).getByText(/needs a photo for its card/)).toBeInTheDocument();
    expect(within(panel).getByText(/has nothing in it yet/)).toBeInTheDocument();

    // The one field that is pre-filled, and the reason it is: an empty date
    // input tells her nothing about the format it wants.
    expect(within(panel).getByLabelText(POST_FIELDS.date.label)).toHaveValue(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown as string,
    );
    expect(within(panel).queryByText(/needs a date like/)).toBeNull();
  });
});
```

> `toHaveValue` with a matcher is awkward; if it does not typecheck against this project's `@testing-library/jest-dom` version, read the value directly instead: `expect((within(panel).getByLabelText(POST_FIELDS.date.label) as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/)`. **Use whichever compiles; do not skip the assertion.** `npx tsc -b --noEmit` covers `src/**` including tests, so a wrong choice is a compile error rather than a silent pass.
>
> `stubFetchWithPosts`, `stubFetchNotFound` and `stubFetchFailing` are this file's own helpers, built on the shell harness's `stubFetch` by overriding one path's response. Write them at the top of the file; each is four or five lines around the existing stub.

- [ ] **Step 8: Run to verify it passes, and measure the CSS**

```
npx vitest run src/admin/blocks src/admin/__tests__/PostList.test.tsx src/admin/areas/__tests__/PostsArea.test.tsx src/admin/__tests__/fields.test.ts worker/__tests__/upload.test.ts
npx tsc -b --noEmit
npx eslint .
npx vite build && wc -c dist/assets/index-*.css
```

Expected: PASS, `tsc -b` exit 0, eslint silent, **38593 bytes**. `fields.test.ts:168` asserts every `kind: 'image'` field's `category` is a member of `UPLOAD_CATEGORIES` and sweeps every exported `*_FIELDS`, so `POST_FIELDS` is picked up with no test change — **confirm it by reading the run's test count, not by assuming.**

Then the rule-level diff, because this task introduced `className` strings:

```bash
cp dist/assets/index-*.css /tmp/vb-after.css
PARENT=$(git rev-parse HEAD)
git worktree add /tmp/vb-parent "$PARENT"
(cd /tmp/vb-parent && npm ci --silent && npx vite build && cp dist/assets/index-*.css /tmp/vb-before.css)
git worktree remove --force /tmp/vb-parent
node -e '
const fs=require("fs");
const sel=(f)=>new Set([...fs.readFileSync(f,"utf8").matchAll(/\.((?:[a-zA-Z0-9_\-]|\\.)+?)(?=[,{:\s>~+\[])/g)].map(m=>m[1].replace(/\\/g,"")));
const a=sel("/tmp/vb-before.css"),b=sel("/tmp/vb-after.css");
console.log("ADDED:",[...b].filter(x=>!a.has(x)).sort());
console.log("REMOVED:",[...a].filter(x=>!b.has(x)).sort());
console.log("before",fs.statSync("/tmp/vb-before.css").size,"after",fs.statSync("/tmp/vb-after.css").size);
'
```

**Expected exactly `ADDED: []`, `REMOVED: []`, 38593 both sides. A worktree checkout of the true parent, never a stash** — several numbers in `bundle.post-build.test.ts`'s comment history had to be corrected because a stash baseline produced wrong results. **If `ADDED` holds anything, stop.** Two causes: a class in a `className` that is not on the allowlist (fix the component), or a utility-looking word spelled bare in a comment (fix the comment — it fired three times in one 5A task).

- [ ] **Step 9: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | In `PostList`, pass `problems` instead of `metaProblems` to `RecordForm` | **the mutation this task's partition is FOR.** "a block problem is NOT shown by the post form" AND "every problem in the list is on screen exactly once" (the two block messages now appear twice) |
| 2 | In `PostList`, pass `metaProblems` to `BlockList` as well | "every problem in the list is on screen exactly once" — the block messages vanish (`metaProblems` excludes them), so the count is 0 not 1. **This is the loss direction, and it is the one RecordList's own comment calls worse** |
| 3 | In `block-problems.ts`, change `BLOCK_PROBLEM` to `/^\[(\d+)\]\.blocks/` (drop the anchoring on what follows) | `does not claim a field that merely starts with the same letters` — `[0].blocksy` |
| 4 | In `blocksOf`, return `post.blocks` directly | `a post with no blocks key at all renders instead of crashing` — `BlockList` receives `undefined` and `blocks.length` throws. **Run it and confirm the throw is a TypeError from the component, not an assertion failure**; if the test passes anyway, `BlockList`'s stub never reads `blocks` and the guard is unprotected until Task 5 — in which case move this mutation's coverage to Task 5's table rather than deleting it |
| 5 | In `metaOf`, drop `excerpt` from the returned object | `tsc -b` fails on the missing property. **This is the mutation that justifies writing the object out instead of rest-destructuring**: with `const { blocks, ...meta } = post` the same edit is not expressible, and a NEW field added to `Post` would be silently missing from every form |
| 6 | In `PostList`'s `onChange`, drop `blocks: blocksOf(post)` from the recombination | `editing a scalar keeps the post's blocks intact` — `next.blocks` is `undefined`. **The defect this catches is real and severe**: without it, typing one character in a title deletes the whole post body |
| 7 | Swap `!isFirst`/`!isLast` in `PostList` | `Up is omitted on the first post and Down on the last` |
| 8 | Change `post.title \|\| 'Untitled post'` to `post.title` | `an untitled post is still nameable in its own buttons` — the button's accessible name becomes `Remove ` and the query finds nothing |
| 9 | In `PostsArea`, drop the `ContentNotFoundError` branch | `a 404 reads as no posts yet, not as a failure` |
| 10 | In `PostsArea`, `useValidation('press.json', data)` instead of `'posts.json'` | `Add a post produces a record whose problems name what it still needs` — `validatePress` produces different messages against a `Post[]`. **This is the seam mutation**: a wrong file key here would otherwise show plausible-looking problems from the wrong validator |
| 11 | In `blankPost`, set `date: ''` | `Add a post produces a record...` on the date assertion AND on `queryByText(/needs a date like/)` being null. **Both halves — run it.** One asserts the pre-fill, the other asserts the pre-fill is *valid*, and a pre-fill in the wrong format would satisfy only the first |
| 12 | In `blankPost`, set `blocks: [{ kind: 'paragraph', text: 'x' }]` | `Add a post produces a record...` on `has nothing in it yet`. **Deliberate**: a pre-filled block would hide the one message that tells her the post needs content, and Task 6's picker is what she should reach for instead |
| 13 | Remove `'posts'` from `UPLOAD_CATEGORIES` | `tsc -b` fails on `POST_FIELDS.image.category`. Also confirm `worker/__tests__/upload.test.ts` still passes — its assertions are membership checks on other names and must not have been coupled to the length |
| 14 | Remove `data-testid="post-form"` | `a block problem is NOT shown by the post form` fails to find the element. Recorded so a later tidy-up of "unnecessary" test ids knows what it costs |

- [ ] **Step 10: Gate, then commit**

```bash
git add src/admin src/shared/upload-categories.ts
npm run gate
```

Expected: exit 0, entry CSS **38593 bytes**.

```bash
git commit -m "feat(admin): the Posts panel, with every scalar field editable

RecordList cannot render a post and the reason is the type system, not
taste: FieldsOf<Post> is uninhabitable because Kind<Block[]> resolves to
never, proven with a probe module that fails tsc with TS2322. So POST_FIELDS
describes Omit<Post, 'blocks'> and PostList is bespoke, the same split
GalleryList and StoryForm already make for an array-valued field.

The problem partition ships here rather than with the block editor, because
RecordForm banners every unmatched same-index problem -- so a block message
would appear on the post as well as on its block. BlockList lands in this
commit as a banner that claims the whole block half, so no message is ever
lost in between, and the test asserts every message appears exactly once in
both directions.

Reading post.blocks is guarded: a draft saved before this feature restores
with no blocks key at all, and the only error boundary between this
component and the page is per-section, so an unguarded read would take the
heading down with the panel.

'posts' is the ninth upload category. Its directory does not exist yet and
does not need to: the derivative walk finds no files there and the upload
route creates the path on first use."
```

---

### Task 5: `BlockList` — every block's own fields, and Up/Down/Remove

The block editor's body. Every one of the ten kinds gets its fields, dispatched through **one exhaustive switch**, so an eleventh kind added to `BlockContentMap` is a `tsc -b` failure naming this file rather than a block she can insert that shows no controls. The toolbar is **not** in this task — `InlineTextField` lands here as a plain `<textarea>` with a label and its errors, and Task 7 adds bold/italic/link to it.

**Everything reuses existing plumbing rather than reinventing it.** `Field` (`src/admin/Field.tsx`) already renders a label, help text, `aria-describedby` and a per-field error region for eight kinds, and takes an ad-hoc `FieldSpec` — so `citation.date`, `citation.url`, `ingredients.heading` and `image.alt` go through it, and `image.src`/`gallery.images[].src` go through `PhotoField` exactly as every other photo in this dashboard does. Only the **inline-markdown** fields need a component of their own, because Task 7 has to attach a toolbar to the textarea and `Field` has no slot for one. `InlineTextField` reads `INPUT_CLASSNAME` and `LABEL_CLASSNAME` from `Field.tsx` — the same exported bindings `Field` itself uses — so it costs zero CSS.

**Files:**
- Create: `src/admin/blocks/block-meta.ts`
- Create: `src/admin/blocks/InlineTextField.tsx`
- Create: `src/admin/blocks/BlockFields.tsx`
- Modify: `src/admin/blocks/BlockList.tsx` (replace Task 4's banner-only version)
- Create: `src/admin/blocks/__tests__/block-meta.test.ts`, `InlineTextField.test.tsx`, `BlockFields.test.tsx`, `BlockList.test.tsx`

**Interfaces:**
- Consumes: `BlockListProps` (Task 4 — **unchanged, that was the point of declaring all seven props then**), `blockProblemOf` (Task 4), `Field`, `INPUT_CLASSNAME`, `LABEL_CLASSNAME`, `PhotoField`, `MOVE_BUTTON_CLASSNAME`, `REMOVE_BUTTON_CLASSNAME`, `BLOCK_KINDS` from `src/content/guards`.
- Produces, consumed by Tasks 6, 7, 8:
  - `export const BLOCK_KIND_LABELS: Record<BlockKind, string>` and `export const BLOCK_KIND_HELP: Record<BlockKind, string>` from `block-meta.ts`
  - `export default function InlineTextField(props: InlineTextFieldProps)` — Task 7 adds a toolbar **inside** this component and changes no caller
  - `export default function BlockFields(props: BlockFieldsProps)` from `BlockFields.tsx`
  - `BlockList` rendering a `<ul>` of blocks with `aria-label={`Move ${BLOCK_KIND_LABELS[kind]} block up`}`-style buttons, and an `onChange(next: Block[])` the picker (Task 6) and the drag handle (Task 8) both call

- [ ] **Step 1: Write `block-meta.ts` and its test**

`src/admin/blocks/block-meta.ts`:

```ts
// What each block kind is CALLED on her screen, as opposed to what it is
// named in the content model. Total records over BlockKind, the same posture
// CONTENT_FILE_LABELS takes over ContentFileName: an eleventh kind added to
// BlockContentMap (src/content/types.ts) without an entry here fails
// `tsc -b`, rather than reaching her screen labelled `numberList`.
//
// Her words, not the model's. "numberList" and "bulletList" are programmer
// names for two things she thinks of as a numbered list and a bulleted list;
// "citation" is a word a chef has no reason to know.
import type { BlockKind } from '../../content/types';

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  bulletList: 'Bulleted list',
  numberList: 'Numbered list',
  image: 'Photo',
  gallery: 'Photo grid',
  quote: 'Quote',
  ingredients: 'Ingredients',
  steps: 'Method',
  citation: 'Where it was published',
};

// One line under each picker button, in her words, saying what the block is
// FOR rather than what it looks like. The picker offers ten choices at once
// and a bare list of ten nouns is the point at which a non-technical owner
// stops and asks somebody -- which is the thing this whole sub-plan is
// measured against.
export const BLOCK_KIND_HELP: Record<BlockKind, string> = {
  paragraph: 'Ordinary writing.',
  heading: 'A line that introduces the part that follows it.',
  bulletList: 'A list where the order does not matter.',
  numberList: 'A list where the order does matter.',
  image: 'One photo, as wide as the post, with words underneath it if you want them.',
  gallery: 'Several photos side by side.',
  quote: 'Somebody’s words, set apart, with their name if you have it.',
  ingredients: 'What somebody needs before they start cooking.',
  steps: 'What to do, in order.',
  citation: 'The publication, the date, and a link to the original.',
};
```

`src/admin/blocks/__tests__/block-meta.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BLOCK_KIND_HELP, BLOCK_KIND_LABELS } from '../block-meta';
import { BLOCK_KINDS } from '../../../content/guards';

describe('every block kind has words she can read', () => {
  // Derived from BLOCK_KINDS (itself checked exhaustive against the union at
  // compile time by BLOCK_KIND_SET), not from Object.keys of the thing under
  // test -- deriving both sides of an equality from the same constant
  // asserts nothing, which is the reason areas.test.tsx spells its own
  // twelve ids out as a literal.
  it('a label for every kind, and no kind without one', () => {
    expect(Object.keys(BLOCK_KIND_LABELS).sort()).toEqual([...BLOCK_KINDS].sort());
    expect(Object.keys(BLOCK_KIND_HELP).sort()).toEqual([...BLOCK_KINDS].sort());
  });

  // The point of the labels, asserted rather than described: not one of them
  // is the model's own name for the kind. `numberList` on a button is the
  // defect this record exists to prevent, and a record that quietly fell
  // back to the key would satisfy the completeness check above.
  it('no label is the kind’s own identifier', () => {
    BLOCK_KINDS.forEach((kind) => {
      expect(BLOCK_KIND_LABELS[kind]).not.toBe(kind);
    });
  });

  it('every help line is a sentence, not a fragment', () => {
    BLOCK_KINDS.forEach((kind) => {
      expect(BLOCK_KIND_HELP[kind].endsWith('.'), `${kind}: "${BLOCK_KIND_HELP[kind]}"`).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Write `InlineTextField.tsx`**

```tsx
// A textarea for a field holding INLINE MARKDOWN, with its label and its own
// error region. Task 7 adds the bold/italic/link toolbar inside this
// component, which is the whole reason it exists rather than routing these
// fields through Field.tsx like every other kind: Field renders eight kinds
// and has no slot for a toolbar, and giving it one would change a component
// that eleven other fields already depend on.
//
// The class strings come from Field.tsx's own exported bindings rather than
// being retyped. A retyped Tailwind string is a brand-new class to the
// content scanner and ships a duplicate rule for a style that already
// exists -- which is exactly why those two are exported (Field.tsx's own
// comment), and the stylesheet has 107 bytes of headroom.
import { INPUT_CLASSNAME, LABEL_CLASSNAME } from '../Field';
import type { ValidationProblem } from '../../content/validate';

export interface InlineTextFieldProps {
  id: string;
  label: string;
  help?: string;
  value: string;
  onChange: (next: string) => void;
  // Already narrowed to this field's own problems by the caller, the same
  // contract Field.tsx documents for its own `problems` prop. BlockList is
  // what does the narrowing, through blockProblemOf.
  problems: ValidationProblem[];
}

export default function InlineTextField({ id, label, help, value, onChange, problems }: InlineTextFieldProps) {
  const helpId = help === undefined ? undefined : `${id}-help`;
  const errorId = problems.length === 0 ? undefined : `${id}-error`;
  // Both, space-separated, and in this order -- the same shape Field.tsx
  // builds, so a screen reader reads the guidance before the complaint.
  const describedBy = [helpId, errorId].filter((part) => part !== undefined).join(' ') || undefined;

  return (
    <div className="mb-4">
      <label htmlFor={id} className={LABEL_CLASSNAME}>
        {label}
      </label>
      {help !== undefined && (
        <p id={helpId} className={`mb-1 font-['Open_Sans'] text-sm text-gray-600`}>
          {help}
        </p>
      )}
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy}
        className={INPUT_CLASSNAME}
      />
      {errorId !== undefined && (
        <p id={errorId} role="alert" className={`mt-1 font-['Montserrat'] text-sm text-red-600`}>
          {problems.map((problem) => problem.message).join(' ')}
        </p>
      )}
    </div>
  );
}
```

> **Check `Field.tsx`'s own error markup before writing this and match it.** If `Field` renders one `<p>` per problem rather than a joined string, or uses a different `role`, copy what it does — two error presentations on one screen is the "two names for one thing" defect this project has already fixed twice. The code above is the shape to aim for, not a licence to differ from the sibling.

`src/admin/blocks/__tests__/InlineTextField.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InlineTextField from '../InlineTextField';

describe('InlineTextField', () => {
  it('associates its label with its textarea', () => {
    render(<InlineTextField id="f" label="Words" value="Rest the dough" onChange={vi.fn()} problems={[]} />);
    expect(screen.getByLabelText('Words')).toHaveValue('Rest the dough');
  });

  it('reports every keystroke', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<InlineTextField id="f" label="Words" value="" onChange={onChange} problems={[]} />);
    await user.type(screen.getByLabelText('Words'), 'Hi');
    expect(onChange.mock.calls.map(([next]) => next)).toEqual(['H', 'i']);
  });

  it('points the textarea at its help text and its error, in that order', () => {
    render(
      <InlineTextField
        id="f"
        label="Words"
        help="Some guidance."
        value=""
        onChange={vi.fn()}
        problems={[{ field: 'x', message: 'this paragraph needs some words' }]}
      />,
    );
    expect(screen.getByLabelText('Words')).toHaveAttribute('aria-describedby', 'f-help f-error');
    expect(screen.getByRole('alert')).toHaveTextContent('this paragraph needs some words');
  });

  it('has no error region and no dangling aria-describedby when nothing is wrong', () => {
    render(<InlineTextField id="f" label="Words" value="ok" onChange={vi.fn()} problems={[]} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Words')).not.toHaveAttribute('aria-describedby');
  });
});
```

> The last case matters more than it looks: an `aria-describedby` pointing at an element that does not exist is read as nothing by some screen readers and as a broken reference by others, and it is the state this component is in for most of its life. `''` from the `.join()` is coerced to `undefined` by the `|| undefined` for exactly that reason.

- [ ] **Step 3: Write `BlockFields.tsx`**

One exhaustive switch. **Every field a renderer reads is editable, and none that it does not.**

```tsx
// One block's own fields. The switch is exhaustive over BlockKind, so an
// eleventh kind added to BlockContentMap (src/content/types.ts) fails
// `tsc -b` naming this file -- the same guarantee blocks.tsx has on the
// render side and assertBlock has at the guard.
//
// Everything that is not inline markdown goes through Field.tsx with an
// ad-hoc FieldSpec, and every photo goes through PhotoField, so labels, help
// text, aria-describedby, error regions and the whole upload/stage/preview
// chain are the dashboard's existing ones rather than a second set. Only the
// markdown-bearing fields get InlineTextField, because Task 7 attaches a
// toolbar to those and Field has no slot for one.
import Field from '../Field';
import PhotoField from '../PhotoField';
import InlineTextField from './InlineTextField';
import { MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME, ADD_BUTTON_CLASSNAME } from '../RecordList';
import type { FieldSpec } from '../fields';
import type { ImagePreviews } from '../previews';
import type { StagedPhoto } from '../PhotoField';
import type { Block, GalleryImage } from '../../content/types';
import type { ValidationProblem } from '../../content/validate';

export interface BlockFieldsProps {
  block: Block;
  onChange: (next: Block) => void;
  // The DOM id prefix for this block, composed on the way down the same way
  // every preview key in this dashboard is: file, then record, then block.
  // Two posts' block 0 must not produce the same input id, or a `<label for>`
  // click lands in the wrong post entirely -- the exact defect RecordForm's
  // own `scope` prop exists for.
  idPrefix: string;
  // Keyed by the field name inside this block: 'text', 'items[1]',
  // 'images[0].src'. BlockList does the narrowing.
  problemsFor: (key: string) => ValidationProblem[];
  previews: ImagePreviews;
  onStaged: (key: string, staged: StagedPhoto | null) => void;
  previewKeyPrefix: string;
}

// Ad-hoc specs, declared once at module scope rather than rebuilt per render.
// `satisfies` rather than a type annotation so the literal keeps its narrow
// `kind`, which is what lets Field<string>'s generic resolve.
const ALT_SPEC = {
  label: 'Photo description',
  kind: 'text',
  help: 'Read aloud to anyone using a screen reader, and shown if the photo fails to load.',
} satisfies FieldSpec<string>;

const HEADING_SPEC = { label: 'Heading', kind: 'text' } satisfies FieldSpec<string>;

const PUBLICATION_SPEC = { label: 'Publication', kind: 'text' } satisfies FieldSpec<string>;

const CITATION_DATE_SPEC = { label: 'Published on', kind: 'date' } satisfies FieldSpec<string>;

const CITATION_URL_SPEC = {
  label: 'Link',
  kind: 'text',
  help: 'The full web address of the original, or leave empty if it is not online.',
  optional: true,
} satisfies FieldSpec<string | null>;

export default function BlockFields({
  block,
  onChange,
  idPrefix,
  problemsFor,
  previews,
  onStaged,
  previewKeyPrefix,
}: BlockFieldsProps) {
  // A list of markdown-bearing strings, with add/remove/move -- the shape
  // bulletList, numberList, ingredients and steps all share. StoryForm.tsx's
  // paragraph list is the same idea and the same button bindings; this is not
  // routed through that component because its problems key off
  // `paragraphs[i]` and these off `items[i]`.
  function itemList(items: string[], noun: string): React.ReactNode {
    const safe = Array.isArray(items) ? items : [];
    const commit = (next: string[]) => onChange({ ...block, items: next } as Block);
    return (
      <>
        {safe.map((item, i) => (
          <div key={i}>
            <InlineTextField
              id={`${idPrefix}-items-${i}`}
              label={`${noun} ${i + 1}`}
              value={item}
              onChange={(next) => commit(safe.map((existing, j) => (j === i ? next : existing)))}
              problems={problemsFor(`items[${i}]`)}
            />
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {i > 0 && (
                <button
                  type="button"
                  aria-label={`Move ${noun} ${i + 1} up`}
                  onClick={() => commit(swapAt(safe, i, i - 1))}
                  className={MOVE_BUTTON_CLASSNAME}
                >
                  Up
                </button>
              )}
              {i < safe.length - 1 && (
                <button
                  type="button"
                  aria-label={`Move ${noun} ${i + 1} down`}
                  onClick={() => commit(swapAt(safe, i, i + 1))}
                  className={MOVE_BUTTON_CLASSNAME}
                >
                  Down
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${noun} ${i + 1}`}
                onClick={() => commit(safe.filter((_, j) => j !== i))}
                className={REMOVE_BUTTON_CLASSNAME}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {/* The bare `items` message -- validateInlineList's "needs at least
            one X", only reachable when the list IS empty, which is exactly
            when no per-item field exists to carry it. Same reasoning as
            RecordList's unclaimedProblems: the one message the validator
            produces for an empty list must not be the one message this
            component drops. */}
        {problemsFor('items').map((problem, i) => (
          <p key={i} role="alert" className={`mb-3 font-['Montserrat'] text-sm text-red-600`}>
            {problem.message}
          </p>
        ))}
        <button type="button" onClick={() => commit([...safe, ''])} className={ADD_BUTTON_CLASSNAME}>
          {`Add a ${noun.toLowerCase()}`}
        </button>
      </>
    );
  }

  switch (block.kind) {
    case 'paragraph':
      return (
        <InlineTextField
          id={`${idPrefix}-text`}
          label="Words"
          value={block.text ?? ''}
          onChange={(next) => onChange({ ...block, text: next })}
          problems={problemsFor('text')}
        />
      );
    case 'heading':
      return (
        <InlineTextField
          id={`${idPrefix}-text`}
          label="Heading"
          value={block.text ?? ''}
          onChange={(next) => onChange({ ...block, text: next })}
          problems={problemsFor('text')}
        />
      );
    case 'bulletList':
      return itemList(block.items, 'Item');
    case 'numberList':
      return itemList(block.items, 'Item');
    case 'image':
      return (
        <>
          <PhotoField
            id={`${idPrefix}-src`}
            label="Photo"
            category="posts"
            value={block.src ?? null}
            onChange={(contentPath) => onChange({ ...block, src: contentPath ?? '' })}
            onStaged={(staged) => onStaged('src', staged)}
            previews={previews}
            previewKey={`${previewKeyPrefix}:src`}
            problems={problemsFor('src')}
          />
          <Field<string>
            id={`${idPrefix}-alt`}
            spec={ALT_SPEC}
            value={block.alt ?? ''}
            onChange={(next) => onChange({ ...block, alt: next })}
            problems={problemsFor('alt')}
          />
          {/* `?? ''` on a genuinely optional field, and the reason is a
              landmine this project has already defused once: caption is
              optional in BlockContentMap and a committed block may not carry
              the key at all, so reading block.caption straight would hand
              undefined to a controlled textarea and React would switch it to
              uncontrolled mid-edit. */}
          <InlineTextField
            id={`${idPrefix}-caption`}
            label="Words underneath (optional)"
            value={block.caption ?? ''}
            onChange={(next) => onChange({ ...block, caption: next })}
            problems={problemsFor('caption')}
          />
        </>
      );
    case 'gallery':
      return galleryFields(block.images, (next) => onChange({ ...block, images: next }));
    case 'quote':
      return (
        <>
          <InlineTextField
            id={`${idPrefix}-text`}
            label="The words being quoted"
            value={block.text ?? ''}
            onChange={(next) => onChange({ ...block, text: next })}
            problems={problemsFor('text')}
          />
          <InlineTextField
            id={`${idPrefix}-attribution`}
            label="Who said it (optional)"
            value={block.attribution ?? ''}
            onChange={(next) => onChange({ ...block, attribution: next })}
            problems={problemsFor('attribution')}
          />
        </>
      );
    case 'ingredients':
      return (
        <>
          <Field<string>
            id={`${idPrefix}-heading`}
            spec={HEADING_SPEC}
            value={block.heading ?? ''}
            onChange={(next) => onChange({ ...block, heading: next })}
            problems={problemsFor('heading')}
          />
          {itemList(block.items, 'Ingredient')}
        </>
      );
    case 'steps':
      return (
        <>
          <Field<string>
            id={`${idPrefix}-heading`}
            spec={HEADING_SPEC}
            value={block.heading ?? ''}
            onChange={(next) => onChange({ ...block, heading: next })}
            problems={problemsFor('heading')}
          />
          {itemList(block.items, 'Step')}
        </>
      );
    case 'citation':
      return (
        <>
          <Field<string>
            id={`${idPrefix}-publication`}
            spec={PUBLICATION_SPEC}
            value={block.publication ?? ''}
            onChange={(next) => onChange({ ...block, publication: next })}
            problems={problemsFor('publication')}
          />
          {/* `null`, never `''`, when she clears it: null is the real "there
              is no online copy" value, matching Article['url'] and the
              committed press.json entries that carry it, and validateBlock
              refuses anything else that is not a usable link. An empty string
              would be refused at publish with a message about web addresses,
              which is not what she meant. `optional: true` on the spec is
              what makes RecordForm-style clearing delete rather than blank --
              but Field is rendered directly here, so the mapping is explicit
              below rather than inherited. */}
          <Field<string | null>
            id={`${idPrefix}-url`}
            spec={CITATION_URL_SPEC}
            value={block.url}
            onChange={(next) => onChange({ ...block, url: next === null || next.trim() === '' ? null : next })}
            problems={problemsFor('url')}
          />
          <Field<string>
            id={`${idPrefix}-date`}
            spec={CITATION_DATE_SPEC}
            value={block.date ?? ''}
            onChange={(next) => onChange({ ...block, date: next })}
            problems={problemsFor('date')}
          />
        </>
      );
    default: {
      // Unreachable while BlockContentMap and this switch agree; an eleventh
      // kind with no branch fails to compile here.
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }

  function galleryFields(images: GalleryImage[], commit: (next: GalleryImage[]) => void): React.ReactNode {
    const safe = Array.isArray(images) ? images : [];
    return (
      <>
        {safe.map((image, i) => (
          <div key={i}>
            <PhotoField
              id={`${idPrefix}-images-${i}-src`}
              label={`Photo ${i + 1}`}
              category="posts"
              value={image.src ?? null}
              onChange={(contentPath) =>
                commit(safe.map((existing, j) => (j === i ? { ...existing, src: contentPath ?? '' } : existing)))
              }
              onStaged={(staged) => onStaged(`images[${i}].src`, staged)}
              previews={previews}
              previewKey={`${previewKeyPrefix}:images[${i}].src`}
              problems={problemsFor(`images[${i}].src`)}
            />
            <Field<string>
              id={`${idPrefix}-images-${i}-alt`}
              spec={ALT_SPEC}
              value={image.alt ?? ''}
              onChange={(next) =>
                commit(safe.map((existing, j) => (j === i ? { ...existing, alt: next } : existing)))
              }
              problems={problemsFor(`images[${i}].alt`)}
            />
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => commit(safe.filter((_, j) => j !== i))}
                className={REMOVE_BUTTON_CLASSNAME}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {problemsFor('images').map((problem, i) => (
          <p key={i} role="alert" className={`mb-3 font-['Montserrat'] text-sm text-red-600`}>
            {problem.message}
          </p>
        ))}
        <button type="button" onClick={() => commit([...safe, { src: '', alt: '' }])} className={ADD_BUTTON_CLASSNAME}>
          Add a photo
        </button>
      </>
    );
  }
}

function swapAt<T>(items: T[], index: number, otherIndex: number): T[] {
  const next = [...items];
  const moved = next[index];
  next[index] = next[otherIndex];
  next[otherIndex] = moved;
  return next;
}
```

> **Two things to verify against the real components before this compiles.** (a) `PhotoFieldProps` may not have a `problems` prop — read `src/admin/PhotoField.tsx`'s interface. If it does not, render the `src` problems as a sibling `<p role="alert">` beside the `PhotoField`, using the same class string `itemList` uses above; do **not** add a prop to `PhotoField`, which nine other call sites render. (b) `FieldSpec`'s `optional?: true` is on all three branches, so `CITATION_URL_SPEC` is legal — but `Kind<string | null>` is `'text' | 'image' | 'readonly'`, so `kind: 'text'` is the only text-like option and `'textarea'` would not compile. That is why the link is a single-line input.
>
> `itemList` and `galleryFields` are declared inside the component, and function declarations hoist, so `galleryFields` being written after the `switch` is legal. It is written there deliberately, to keep the switch readable as the exhaustiveness argument it is. **`eslint` may object under `no-inner-declarations` or `func-style`; if it does, move both to module scope and pass the props they need as arguments rather than disabling the rule.**

- [ ] **Step 4: Write the real `BlockList.tsx`**

```tsx
// Every block of one post, in order, with Up/Down/Remove. The drag handle
// arrives in Task 8; the buttons stay when it does, because a drag is
// unusable on a phone with a long block list, so drag is a SECOND way to do
// this and never the only way.
//
// Button bindings imported from RecordList rather than retyped, for the
// reason that file's own comment gives: a retyped Tailwind string is a new
// class to the content scanner and ships a duplicate rule.
import BlockFields from './BlockFields';
import { blockProblemOf } from './block-problems';
import { BLOCK_KIND_LABELS } from './block-meta';
import { MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME } from '../RecordList';
import type { Block } from '../../content/types';
import type { ImagePreviews } from '../previews';
import type { StagedPhoto } from '../PhotoField';
import type { ValidationProblem } from '../../content/validate';

export interface BlockListProps {
  blocks: Block[];
  postIndex: number;
  onChange: (next: Block[]) => void;
  problems: ValidationProblem[];
  previews: ImagePreviews;
  onStaged: (key: string, staged: StagedPhoto | null) => void;
  previewKeyPrefix: string;
}

export default function BlockList({
  blocks,
  postIndex,
  onChange,
  problems,
  previews,
  onStaged,
  previewKeyPrefix,
}: BlockListProps) {
  // A draft saved before this feature restores with no `blocks` key at all
  // (registerLoaded's unchecked cast), and the only error boundary between
  // here and the page is per-SECTION -- so an unguarded read would take the
  // Posts panel's heading down with it, which is the Phase 4 defect verbatim.
  const safe = Array.isArray(blocks) ? blocks : [];

  // Only this post's block problems, and all of them: the list-level ones
  // (`[i].blocks`, "has nothing in it yet"), the per-block field ones, and
  // anything naming a block index this post no longer has -- which is
  // reachable, because validation is debounced and she can remove a block
  // between the run and the render.
  const mine = problems
    .map((problem) => ({ problem, target: blockProblemOf(problem.field) }))
    .filter((entry) => entry.target?.post === postIndex);

  const banner = mine.filter(
    (entry) =>
      entry.target?.block === undefined ||
      entry.target.block < 0 ||
      entry.target.block >= safe.length,
  );

  function problemsForBlock(index: number): (key: string) => ValidationProblem[] {
    return (key) =>
      mine
        .filter((entry) => entry.target?.block === index && entry.target.key === key)
        .map((entry) => entry.problem);
  }

  function swap(index: number, otherIndex: number): void {
    const next = [...safe];
    const moved = next[index];
    next[index] = next[otherIndex];
    next[otherIndex] = moved;
    onChange(next);
  }

  return (
    <div>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with this post’s content"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((entry, i) => (
              <li key={i}>{entry.problem.message}</li>
            ))}
          </ul>
        </div>
      )}

      <ul>
        {safe.map((block, index) => {
          const label = BLOCK_KIND_LABELS[block.kind];
          return (
            <li key={index} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className={`font-['Montserrat'] text-sm uppercase tracking-wide text-accent`}>{label}</span>
                <div className="flex items-center gap-2">
                  {index > 0 && (
                    <button
                      type="button"
                      aria-label={`Move ${label} block ${index + 1} up`}
                      onClick={() => swap(index, index - 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Up
                    </button>
                  )}
                  {index < safe.length - 1 && (
                    <button
                      type="button"
                      aria-label={`Move ${label} block ${index + 1} down`}
                      onClick={() => swap(index, index + 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Down
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${label} block ${index + 1}`}
                    onClick={() => onChange(safe.filter((_, i) => i !== index))}
                    className={REMOVE_BUTTON_CLASSNAME}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <BlockFields
                block={block}
                onChange={(next) => onChange(safe.map((existing, i) => (i === index ? next : existing)))}
                idPrefix={`posts-${postIndex}-block-${index}`}
                problemsFor={problemsForBlock(index)}
                previews={previews}
                onStaged={(key, staged) => onStaged(`blocks[${index}].${key}`, staged)}
                previewKeyPrefix={`${previewKeyPrefix}:blocks[${index}]`}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

> **The `aria-label`s carry the block's POSITION as well as its kind, and that is not padding.** A recipe has two `Paragraph` blocks more often than not, and `getByRole('button', { name: 'Move Paragraph block up' })` would then throw on multiple matches — which reads as a broken test rather than as the ambiguity it is. It also means she hears "Move Paragraph block 3 up", which is the only way a screen-reader user can tell two paragraphs apart at all.
>
> A **positional `key`** on the `<li>`, deliberately, and it is the opposite call from `RecordList`'s `key={item.id}`. A block carries no id and its identity **is** its position: moving one is exactly what Up/Down and the drag handle do, and React should re-render both. `PostBody.tsx`'s own comment (5A, Task 6) argues this at length against `CollagePhoto`, where a positional identity was wrong because a photo survives a swap and a staged replacement has to follow it. **A block does not survive anything — but a staged PHOTO inside one does**, which is why `onStaged`'s key is `blocks[<index>].src`: reordering blocks after staging a photo and before publishing would mis-attribute it. **Task 10 must test that**, and its table carries the case.

- [ ] **Step 5: Write the `BlockFields` and `BlockList` tests**

`src/admin/blocks/__tests__/BlockFields.test.tsx` — the completeness check that means something, plus one shape assertion per kind:

```tsx
// Fixtures that appear nowhere in src/content/posts.json: a fixture equal to
// the real committed content cannot distinguish a real binding from a
// hardcoded copy of that same value, which was Phase 4's root cause.
const EVERY_BLOCK: Record<BlockKind, Block> = {
  paragraph: { kind: 'paragraph', text: 'Rest the **dough** for an hour.' },
  heading: { kind: 'heading', text: 'Before you start' },
  bulletList: { kind: 'bulletList', items: ['A wide bowl', 'A bench scraper'] },
  numberList: { kind: 'numberList', items: ['Mix', 'Knead', 'Rest'] },
  image: { kind: 'image', src: '/food/tielle.webp', alt: 'A tielle, sliced', caption: 'Tielle, *sliced*' },
  gallery: {
    kind: 'gallery',
    images: [
      { src: '/food/tielle.webp', alt: 'A tielle' },
      { src: '/food/tiramisu.webp', alt: 'A tiramisu' },
    ],
  },
  quote: { kind: 'quote', text: 'Slow down, stay awhile.', attribution: 'Chef Kamalika' },
  ingredients: { kind: 'ingredients', heading: 'What you need', items: ['400g 00 flour', '4 eggs'] },
  steps: { kind: 'steps', heading: 'How to make it', items: ['Make a well', 'Break in the eggs'] },
  citation: { kind: 'citation', publication: 'A Magazine', url: 'https://example.com/a', date: '2026-03-04' },
};

describe('BlockFields covers every kind', () => {
  // Derived from BLOCK_KINDS, so an eleventh kind added to the model with no
  // fixture and no branch fails HERE rather than rendering a block she can
  // insert and cannot edit.
  it('has a fixture and at least one control for every kind in BLOCK_KINDS', () => {
    expect(Object.keys(EVERY_BLOCK).sort()).toEqual([...BLOCK_KINDS].sort());
    BLOCK_KINDS.forEach((kind) => {
      const { container, unmount } = renderFields(EVERY_BLOCK[kind]);
      const controls = container.querySelectorAll('input, textarea, select, button');
      expect(controls.length, `${kind} rendered no control`).toBeGreaterThan(0);
      unmount();
    });
  });

  // The completeness check the one above cannot make: a kind whose branch
  // renders SOME controls but forgets a field. Derived from BLOCK_KEYS
  // (guards.ts), minus the discriminant, so a field added to a kind without a
  // control fails here.
  it('every key a block kind declares has a control, except the discriminant', () => {
    BLOCK_KINDS.forEach((kind) => {
      const { container, unmount } = renderFields(EVERY_BLOCK[kind]);
      const labels = [...container.querySelectorAll('label')].map((el) => el.textContent ?? '');
      const expected = Object.keys(BLOCK_KEYS[kind]).filter((key) => key !== 'kind');
      expect(labels.length, `${kind}: ${expected.length} fields declared, ${labels.length} labels rendered`)
        .toBeGreaterThanOrEqual(expected.length);
      unmount();
    });
  });
});
```

> The second case is deliberately a `>=` rather than an `=`: a list block declares one key (`items`) and renders one label **per item**, so an equality would be wrong by construction. It still catches the failure it is for — a kind with three declared keys and two labels — and the message names both numbers so a red is readable. **That is a weaker assertion than it looks and the plan says so rather than letting a reader assume otherwise.** The per-kind shape cases below are what actually pin each field:

```tsx
describe('each kind renders its own fields', () => {
  it('paragraph is one markdown textarea, unparsed', () => {
    renderFields(EVERY_BLOCK.paragraph);
    expect(screen.getByLabelText('Words')).toHaveValue('Rest the **dough** for an hour.');
    // The asterisks are VISIBLE here, on purpose: this is the source she
    // edits, not the rendered post. blocks.tsx is what turns them into
    // <strong>, and Inline.tsx is what guarantees no HTML string is involved.
    expect(screen.getByLabelText('Words').tagName.toLowerCase()).toBe('textarea');
  });

  it('a list renders one field per item, plus an Add', () => {
    renderFields(EVERY_BLOCK.numberList);
    expect(screen.getByLabelText('Item 1')).toHaveValue('Mix');
    expect(screen.getByLabelText('Item 2')).toHaveValue('Knead');
    expect(screen.getByLabelText('Item 3')).toHaveValue('Rest');
    expect(screen.getByRole('button', { name: 'Add a item' })).toBeInTheDocument();
  });

  it('a list item moves and the whole block is handed back', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields(EVERY_BLOCK.numberList);
    await user.click(screen.getByRole('button', { name: 'Move Item 1 down' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'numberList', items: ['Knead', 'Mix', 'Rest'] });
  });

  it('image has a photo picker, a description and an optional caption', () => {
    renderFields(EVERY_BLOCK.image);
    expect(screen.getByLabelText('Photo')).toBeInTheDocument();
    expect(screen.getByLabelText('Photo description')).toHaveValue('A tielle, sliced');
    expect(screen.getByLabelText('Words underneath (optional)')).toHaveValue('Tielle, *sliced*');
  });

  // The landmine this project has already defused once, now at the EDIT
  // boundary: caption and attribution are optional in BlockContentMap, so a
  // committed block may not carry the key at all. The fixture has the key
  // GENUINELY ABSENT -- `caption: ''` does not test absence, which is the
  // mistake this repository made twice.
  it('an image with no caption key renders an empty caption box, not undefined', () => {
    const noCaption = { kind: 'image', src: '/food/tielle.webp', alt: 'A tielle' } as Block;
    expect('caption' in noCaption).toBe(false);
    renderFields(noCaption);
    expect(screen.getByLabelText('Words underneath (optional)')).toHaveValue('');
  });

  it('a quote with no attribution key renders an empty box, not undefined', () => {
    const noAttribution = { kind: 'quote', text: 'Just the words.' } as Block;
    expect('attribution' in noAttribution).toBe(false);
    renderFields(noAttribution);
    expect(screen.getByLabelText('Who said it (optional)')).toHaveValue('');
  });

  it('citation clearing the link commits null, never an empty string', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields(EVERY_BLOCK.citation);
    await user.clear(screen.getByLabelText('Link'));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'citation',
      publication: 'A Magazine',
      url: null,
      date: '2026-03-04',
    });
  });

  it('gallery renders one picker and one description per photo', () => {
    renderFields(EVERY_BLOCK.gallery);
    expect(screen.getByLabelText('Photo 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Photo 2')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Photo description')).toHaveLength(2);
  });

  it('ingredients and steps each have a heading and their own noun', () => {
    const { unmount } = renderFields(EVERY_BLOCK.ingredients);
    expect(screen.getByLabelText('Heading')).toHaveValue('What you need');
    expect(screen.getByLabelText('Ingredient 1')).toHaveValue('400g 00 flour');
    unmount();
    renderFields(EVERY_BLOCK.steps);
    expect(screen.getByLabelText('Step 1')).toHaveValue('Make a well');
  });

  it('an empty list shows the validator’s own message where the items would be', () => {
    renderFields({ kind: 'bulletList', items: [] }, [
      { field: '[0].blocks[0].items', message: 'needs at least one list item' },
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('needs at least one list item');
  });
});
```

`src/admin/blocks/__tests__/BlockList.test.tsx`:

```tsx
describe('BlockList', () => {
  const BLOCKS: Block[] = [
    { kind: 'heading', text: 'First' },
    { kind: 'paragraph', text: 'Second' },
    { kind: 'paragraph', text: 'Third' },
  ];

  it('labels each block by kind AND position, so two paragraphs are distinguishable', () => {
    renderList({ blocks: BLOCKS });
    expect(screen.getByRole('button', { name: 'Remove Paragraph block 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Paragraph block 3' })).toBeInTheDocument();
  });

  it('Up is omitted on the first block and Down on the last', () => {
    renderList({ blocks: BLOCKS });
    expect(screen.queryByRole('button', { name: 'Move Heading block 1 up' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Heading block 1 down' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Paragraph block 3 down' })).toBeNull();
  });

  it('Down hands back the whole reordered list', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList({ blocks: BLOCKS });
    await user.click(screen.getByRole('button', { name: 'Move Heading block 1 down' }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'paragraph', text: 'Second' },
      { kind: 'heading', text: 'First' },
      { kind: 'paragraph', text: 'Third' },
    ]);
  });

  it('Remove hands back the list without that block', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList({ blocks: BLOCKS });
    await user.click(screen.getByRole('button', { name: 'Remove Paragraph block 2' }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'heading', text: 'First' },
      { kind: 'paragraph', text: 'Third' },
    ]);
  });

  it('a problem lands on its own block’s own field', () => {
    renderList({
      blocks: BLOCKS,
      problems: [{ field: '[0].blocks[1].text', message: 'this paragraph needs some words' }],
    });
    const block = screen.getByLabelText('Words', { selector: '#posts-0-block-1-text' });
    expect(block).toHaveAttribute('aria-describedby', 'posts-0-block-1-text-error');
    expect(screen.getByRole('alert')).toHaveTextContent('this paragraph needs some words');
  });

  it('ignores another post’s block problems entirely', () => {
    renderList({
      blocks: BLOCKS,
      postIndex: 0,
      problems: [{ field: '[4].blocks[1].text', message: 'a different post’s problem' }],
    });
    expect(screen.queryByText('a different post’s problem')).toBeNull();
  });

  it('a problem naming a block that no longer exists goes in the banner', () => {
    renderList({
      blocks: BLOCKS,
      problems: [{ field: '[0].blocks[9].text', message: 'a stale indexed problem' }],
    });
    expect(screen.getByRole('alert', { name: 'Problems with this post’s content' })).toHaveTextContent(
      'a stale indexed problem',
    );
  });

  it('the list-level message goes in the banner, which is the only place it can go', () => {
    renderList({
      blocks: [],
      problems: [{ field: '[0].blocks', message: 'this post has nothing in it yet' }],
    });
    expect(screen.getByRole('alert', { name: 'Problems with this post’s content' })).toHaveTextContent(
      'this post has nothing in it yet',
    );
  });

  it('a post whose blocks key is absent renders nothing and does not throw', () => {
    expect(() => renderList({ blocks: undefined as unknown as Block[] })).not.toThrow();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('two posts’ block 1 get different input ids, so a label click cannot land in the wrong post', () => {
    const { unmount } = renderList({ blocks: BLOCKS, postIndex: 0 });
    expect(document.getElementById('posts-0-block-1-text')).not.toBeNull();
    unmount();
    renderList({ blocks: BLOCKS, postIndex: 3 });
    expect(document.getElementById('posts-3-block-1-text')).not.toBeNull();
    expect(document.getElementById('posts-0-block-1-text')).toBeNull();
  });
});
```

- [ ] **Step 6: Run to verify it passes, and measure the CSS**

```
npx vitest run src/admin/blocks src/admin/__tests__/PostList.test.tsx src/admin/areas/__tests__/PostsArea.test.tsx
npx tsc -b --noEmit
npx eslint .
```

Expected: PASS, exit 0, silent. **Task 4's `PostList.test.tsx` case "every problem in the list is on screen exactly once" is the one to watch**: `BlockList` now places problems on fields instead of in a banner, and if it also leaves them in the banner that test goes red for the right reason.

Then the rule-level diff, exactly as Task 4 Step 8 ran it (worktree checkout of the true parent, never a stash). **Expected `ADDED: []`, `REMOVED: []`, 38593 both sides.** Every class string in this task is either imported from `RecordList`/`Field` or drawn from the allowlist in "The CSS budget, measured".

- [ ] **Step 7: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | Delete the `citation` case from `BlockFields`' switch | `tsc -b` fails at `const _exhaustive: never = block` naming `BlockFields.tsx` — the completeness guarantee working |
| 2 | Add an eleventh kind to `BlockContentMap` with no branch, no label and no fixture | `tsc -b` fails in **four** places: `BlockFields.tsx`'s `never`, `BLOCK_KIND_LABELS`, `BLOCK_KIND_HELP`, and `BLOCK_KEYS` in `guards.ts`. **Plus** `block-meta.test.ts`'s two key-set equalities and `BlockFields.test.tsx`'s fixture equality. **Run it and count** — 5A found a mutation of exactly this shape reddening only `tsc` because vitest does not typecheck and a type-only mutation leaves the runtime `BLOCK_KIND_SET` untouched. Here the runtime records are the ones that move, so both halves should fire; confirm rather than assume |
| 3 | In `BLOCK_KIND_LABELS`, set `numberList: 'numberList'` | `no label is the kind's own identifier`. **The mutation the record exists for** — a completeness check alone would pass |
| 4 | In `BlockList`, `key={block.kind}` instead of `key={index}` | `Down hands back the whole reordered list` may still pass (the handler is unaffected), but two paragraphs share a key and React warns. **Predicted weak.** Add an assertion that survives it: after a Down click, re-render with the returned list and assert `getByLabelText('Words', { selector: '#posts-0-block-1-text' })` holds the moved text. If that still passes, record the mutation as not-caught rather than reporting it as proof |
| 5 | In `BlockList`, drop the position from every `aria-label` | `labels each block by kind AND position` — `getByRole` throws "Found multiple elements" for `Remove Paragraph block`. **This is the mutation that justifies the longer label** |
| 6 | In `BlockList`, `const safe = blocks;` | `a post whose blocks key is absent renders nothing and does not throw` — TypeError on `.map`. **And re-run `PostList.test.tsx`'s own no-blocks case**: Task 4's mutation #4 was predicted possibly-weak because the stub never read `blocks`; it does now, so that prediction resolves here |
| 7 | In `BlockList`, filter `mine` on `target?.post === postIndex` → drop the `postIndex` comparison | `ignores another post's block problems entirely` |
| 8 | In `BlockList`'s `banner` filter, drop the `>= safe.length` clause | `a problem naming a block that no longer exists goes in the banner` — the message vanishes. **The silent-loss direction** |
| 9 | In `BlockList`, drop the `=== undefined` clause from the `banner` filter | `the list-level message goes in the banner` — "this post has nothing in it yet" vanishes, which is the one message an empty block list produces |
| 10 | In `BlockFields`, read `block.caption` without `?? ''` | `an image with no caption key renders an empty caption box, not undefined` — React logs "changing an uncontrolled input to be controlled" and the value assertion fails. **Both fixtures use an ABSENT key, not `''`; that distinction is the twice-repeated mistake this row exists to close** |
| 11 | In `BlockFields`' citation `onChange`, commit `next` unchanged | `citation clearing the link commits null, never an empty string` |
| 12 | In `BlockFields`, give `idPrefix` a constant value | `two posts' block 1 get different input ids` |
| 13 | In `BlockFields`' `itemList`, drop the `problemsFor('items')` block | `an empty list shows the validator's own message where the items would be` |
| 14 | In `InlineTextField`, always set `aria-describedby={describedBy}` without the `|| undefined` | `has no error region and no dangling aria-describedby when nothing is wrong` |

- [ ] **Step 8: Gate, then commit**

```bash
git add src/admin
npm run gate
```

Expected: exit 0, entry CSS **38593 bytes**.

```bash
git commit -m "feat(admin): every block kind gets its fields

One exhaustive switch over BlockKind, so an eleventh kind is a compile error
naming BlockFields.tsx rather than a block she can insert and cannot edit.
Everything that is not markdown goes through the dashboard's existing Field
and PhotoField, so labels, help text, aria-describedby, error regions and the
whole upload chain are the ones already on screen elsewhere rather than a
second set.

Only the markdown-bearing fields get a component of their own, and only
because the toolbar has to attach to that textarea; it reads Field's own
exported class bindings, so it costs no CSS.

Block problems now land on the block that has them. The banner keeps the two
shapes that have nowhere else to go -- the list-level message an empty block
list produces, and a problem naming a block she has since removed -- because
validation is debounced and both are reachable.

Block labels carry position as well as kind. A recipe usually has two
paragraphs, and 'Move Paragraph block up' is ambiguous to a query and to a
screen reader alike.

Reading blocks, items, images, caption and attribution is guarded at every
point. Caption and attribution are optional in the model, and the fixtures
that prove it have the key genuinely absent rather than set to an empty
string -- present-but-empty does not test absence, which this repository has
now got wrong twice."
```

---

### Task 6: the block picker, and `blankBlock(kind)`

Ten buttons, built from `BLOCK_KINDS` so the picker cannot offer a kind the renderer has no branch for, and a factory typed `Record<BlockKind, () => Block>` so a new kind is a compile error rather than an Add button that produces an invalid record.

**One thing to understand before writing the factory, because it looks like a bug and is not.** A blank `image` block carries `src: ''`, and `assertBlock` runs `assertBlockAssetPath` on that field, which calls `isSiteRelativePath('')` → `''.startsWith('/')` is false → **throws**. Same for a blank `gallery` photo. That is correct and is not something to work around: `validatePosts` refuses the same block at the **write** boundary with "an image block needs a photo", so a blank image block can never reach a committed `posts.json` for `assertBlock` to meet at import time. The two guards are doing exactly what they are for, in the right order. **What must be true, and what Step 3 asserts per kind, is that every blank block produces a validation problem naming the field she has to fill in** — never silence, and never a problem naming something she cannot see.

**Files:**
- Create: `src/admin/blocks/blank-block.ts`
- Create: `src/admin/blocks/BlockPicker.tsx`
- Modify: `src/admin/blocks/BlockList.tsx` (render the picker under the list)
- Create: `src/admin/blocks/__tests__/blank-block.test.ts`, `BlockPicker.test.tsx`
- Modify: `src/content/__tests__/validate.test.ts` (one both-ends row per kind, in the existing table)

**Interfaces:**
- Consumes: `BLOCK_KINDS` from `src/content/guards`, `BLOCK_KIND_LABELS`/`BLOCK_KIND_HELP` (Task 5), `ADD_BUTTON_CLASSNAME`, `BlockList`'s `onChange` (Task 5).
- Produces, consumed by Tasks 8, 10:
  - `export const BLANK_BLOCK: Record<BlockKind, () => Block>` and `export function blankBlock(kind: BlockKind): Block`
  - `export default function BlockPicker({ onPick }: { onPick: (kind: BlockKind) => void })`

- [ ] **Step 1: Write the failing factory test**

`src/admin/blocks/__tests__/blank-block.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BLANK_BLOCK, blankBlock } from '../blank-block';
import { BLOCK_KEYS, BLOCK_KINDS, unknownKeys } from '../../../content/guards';
import { validateContent } from '../../../content/validate';

// A post that is otherwise valid, so the only problems below belong to the
// block under test. Differs from src/content/posts.json in every field.
const VALID_POST = {
  id: 'fixture-1',
  slug: 'a-fixture-post',
  type: 'recipe',
  title: 'A fixture post',
  date: '2026-03-04',
  excerpt: 'A fixture excerpt.',
  image: '/food/tielle.webp',
};

function blockProblems(kind: (typeof BLOCK_KINDS)[number]): string[] {
  return validateContent('posts.json', [{ ...VALID_POST, blocks: [blankBlock(kind)] }])
    .map((problem) => problem.field)
    .filter((field) => field.startsWith('[0].blocks'))
    .sort();
}

describe('blankBlock', () => {
  it('has a factory for every kind, and no factory for a kind that does not exist', () => {
    expect(Object.keys(BLANK_BLOCK).sort()).toEqual([...BLOCK_KINDS].sort());
  });

  it('every blank block carries its own discriminant and no key its kind does not declare', () => {
    BLOCK_KINDS.forEach((kind) => {
      const block = blankBlock(kind);
      expect(block.kind).toBe(kind);
      expect(unknownKeys(block as unknown as object, BLOCK_KEYS[kind])).toEqual([]);
    });
  });

  // Two fresh calls, not one shared object: a factory that returned a shared
  // literal would let two blocks of the same kind alias one array, so typing
  // into one list would type into the other. `toEqual` then `not.toBe` is
  // what distinguishes them.
  it('returns a fresh object every time, with fresh arrays inside it', () => {
    const a = blankBlock('bulletList');
    const b = blankBlock('bulletList');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.kind === 'bulletList' && b.kind === 'bulletList' && a.items).not.toBe(
      b.kind === 'bulletList' ? b.items : null,
    );
  });

  // The property the whole factory exists for, stated as an EXACT field list
  // per kind rather than "at least one problem". `expect(x.length > 0)` is a
  // named tell in this project: Array.slice's negative-index wraparound once
  // satisfied exactly that shape on broken behaviour, and 14 under-asserting
  // tests have been found here.
  //
  // Read down the right-hand column: every entry is a field she can SEE on
  // the block she just added. A blank block whose only problem named a field
  // with no control -- or no problem at all -- is the "she could get stuck"
  // failure this sub-plan is measured against.
  it.each([
    ['paragraph', ['[0].blocks[0].text']],
    ['heading', ['[0].blocks[0].text']],
    ['bulletList', ['[0].blocks[0].items[0]']],
    ['numberList', ['[0].blocks[0].items[0]']],
    ['image', ['[0].blocks[0].alt', '[0].blocks[0].src']],
    ['gallery', ['[0].blocks[0].images[0].src']],
    ['quote', ['[0].blocks[0].text']],
    ['ingredients', ['[0].blocks[0].items[0]']],
    ['steps', ['[0].blocks[0].items[0]']],
    ['citation', ['[0].blocks[0].publication']],
  ] as const)('a blank %s tells her exactly what it needs', (kind, expected) => {
    expect(blockProblems(kind)).toEqual([...expected].sort());
  });

  // The two kinds whose blank shape assertBlock REFUSES, asserted rather than
  // discovered. That is correct and is the two guards working in order:
  // validatePosts refuses the same block at the write boundary (see the row
  // above), so a blank photo can never reach a committed file for the
  // import-time guard to meet. Pinned here so nobody "fixes" the factory by
  // inventing a placeholder path -- which would be a path with no file behind
  // it, and src/content/__tests__/assets.test.ts would then fail the build.
  it.each(['image', 'gallery'] as const)('a blank %s is refused at the import boundary too', (kind) => {
    expect(() => assertPosts([{ ...VALID_POST, blocks: [blankBlock(kind)] }])).toThrow(/photo on this site/);
  });

  // The optional fields are ABSENT, not empty strings. `caption: ''` and
  // `attribution: ''` would round-trip a key she never filled in, which is
  // the "present-but-empty is not absent" mistake this repository has made
  // twice -- and blocks.tsx's renderer branches on emptiness either way, so
  // the only difference is what a committed file carries.
  it('omits caption and attribution entirely rather than blanking them', () => {
    expect('caption' in blankBlock('image')).toBe(false);
    expect('attribution' in blankBlock('quote')).toBe(false);
  });

  // `null`, and it has to be null: validateBlock accepts `url: null` as the
  // real "there is no online copy" value and refuses anything else that is
  // not a usable link, so `''` would be refused with a message about web
  // addresses on a citation she has only just created.
  it('a blank citation has a null link, not an empty one', () => {
    const block = blankBlock('citation');
    expect(block.kind === 'citation' && block.url).toBeNull();
  });

  // A date she does not have to guess the format of, matching blankPost's own
  // reasoning (PostsArea.tsx) and matching the pattern validateBlock checks.
  it('a blank citation has today’s date, in the shape the validator wants', () => {
    const block = blankBlock('citation');
    expect(block.kind === 'citation' && block.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

Add `assertPosts` to that file's imports from `../../../content/guards`.

- [ ] **Step 2: Write `blank-block.ts`**

```ts
// A blank starting point for every block kind, and the reason it is a total
// Record rather than a switch: an eleventh kind added to BlockContentMap
// (src/content/types.ts) fails `tsc -b` at this declaration, instead of
// reaching the picker as an Add button that produces a record no renderer
// and no validator recognises. The same posture CONTENT_FILE_LABELS and
// BLOCK_KEYS both take.
//
// Every field a renderer reads is PRESENT and empty, so the freshly-added
// block renders and immediately shows her, through the same debounced
// validation as everything else, exactly what it still needs.
// blank-block.test.ts asserts the exact problem list per kind, because "she
// could not get stuck" is a claim about what appears on screen.
//
// Two kinds -- image and gallery -- produce a shape assertBlock REFUSES,
// because a blank `src` is not a path on this site. That is the two guards
// working in the right order, not a defect: validatePosts refuses the same
// block at the write boundary, so it can never reach a committed posts.json
// for the import-time guard to meet. Do not "fix" it with a placeholder
// path; there would be no file behind it and assets.test.ts would fail the
// build.
//
// Optional fields are OMITTED, never blanked. `caption: ''` and
// `attribution: ''` would round-trip a key she never filled in, and this
// project has twice made the mistake of treating present-but-empty as
// equivalent to absent.
import type { Block, BlockKind } from '../../content/types';

// The same "today, in the shape the validator wants" call blankPost makes
// (areas/PostsArea.tsx): a date input with nothing in it is the one field
// whose empty state gives her no hint about the format, and today is very
// nearly always right for something she is writing now.
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const BLANK_BLOCK: Record<BlockKind, () => Block> = {
  paragraph: () => ({ kind: 'paragraph', text: '' }),
  heading: () => ({ kind: 'heading', text: '' }),
  // One empty item rather than none: an empty list would show her the
  // list-level "needs at least one item" message and no box to type in, so
  // the only control on screen would be Add -- one more click before she can
  // start. One box, already there, is the difference.
  bulletList: () => ({ kind: 'bulletList', items: [''] }),
  numberList: () => ({ kind: 'numberList', items: [''] }),
  image: () => ({ kind: 'image', src: '', alt: '' }),
  gallery: () => ({ kind: 'gallery', images: [{ src: '', alt: '' }] }),
  quote: () => ({ kind: 'quote', text: '' }),
  // The two headings ARE pre-filled, unlike every other field here, and for
  // the same reason the date is: these are the only fields whose right answer
  // is the same for essentially every recipe anybody writes. She can change
  // either, and a blank one would be refused at publish with a message she
  // would have to read to learn what the field is for.
  ingredients: () => ({ kind: 'ingredients', heading: 'Ingredients', items: [''] }),
  steps: () => ({ kind: 'steps', heading: 'Method', items: [''] }),
  citation: () => ({ kind: 'citation', publication: '', url: null, date: today() }),
};

export function blankBlock(kind: BlockKind): Block {
  return BLANK_BLOCK[kind]();
}
```

Run:

```
npx vitest run src/admin/blocks/__tests__/blank-block.test.ts
```

Expected: PASS. **If the exact-field-list rows disagree with what the validator actually emits, the rows are wrong and the factory is probably right — re-read `validateBlock` in `src/content/validate.ts` and fix the expectation, then say so in the report.** Do not adjust the factory to make a guessed expectation pass; that inverts the whole exercise.

- [ ] **Step 3: Add the both-ends rows**

In `src/content/__tests__/validate.test.ts`, in the table that runs every refused shape through **both** `validateContent` and the `guards.ts` entry point, add one row per blank kind whose blank shape is refused at both ends. `assertBlock` refuses on presence and primitive type only and accepts a present-but-blank string (its own comment says so), so the only two blank kinds refused at both ends are `image` and `gallery`:

```ts
    ['a blank image block', { kind: 'image', src: '', alt: '' }, '[0].blocks[0].src'],
    ['a blank gallery photo', { kind: 'gallery', images: [{ src: '', alt: '' }] }, '[0].blocks[0].images[0].src'],
```

**Read the table's real row shape before writing these and match it**; the point of the table is that both ends are exercised per row, and a row that reaches only one end looks like coverage and is not. The other eight blank kinds are refused by `validatePosts` and **accepted** by `assertBlock`, which is the deliberate asymmetry `assertBlock`'s own comment records ("a present but blank string passes here… 'this paragraph needs some words' is a sentence only the boundary that can show it to her should be producing"). **Do not add rows asserting they are refused at both ends; they are not, and a row claiming otherwise would be a false pin.**

- [ ] **Step 4: Write the failing picker test**

`src/admin/blocks/__tests__/BlockPicker.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockPicker from '../BlockPicker';
import { BLOCK_KIND_HELP, BLOCK_KIND_LABELS } from '../block-meta';
import { BLOCK_KINDS } from '../../../content/guards';

describe('BlockPicker', () => {
  // Derived from BLOCK_KINDS, so a kind added to the model with no branch in
  // BlockFields cannot reach the picker without failing here first. The
  // ordering matters too: the two she reaches for constantly come first.
  it('offers exactly the kinds the model has, in a deliberate order', () => {
    render(<BlockPicker onPick={vi.fn()} />);
    const names = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(names.length).toBe(BLOCK_KINDS.length);
    BLOCK_KINDS.forEach((kind) => {
      expect(names.some((name) => name.includes(BLOCK_KIND_LABELS[kind])), `${kind} is not offered`).toBe(true);
    });
    expect(names[0]).toContain(BLOCK_KIND_LABELS.paragraph);
    expect(names[1]).toContain(BLOCK_KIND_LABELS.heading);
  });

  it('says what each one is for, not just what it is called', () => {
    render(<BlockPicker onPick={vi.fn()} />);
    BLOCK_KINDS.forEach((kind) => {
      expect(screen.getByText(BLOCK_KIND_HELP[kind])).toBeInTheDocument();
    });
  });

  it('hands back the kind she clicked, not the one next to it', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<BlockPicker onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: new RegExp(BLOCK_KIND_LABELS.ingredients) }));
    expect(onPick).toHaveBeenCalledWith('ingredients');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('every button is a real button, so Enter and Space both work', () => {
    render(<BlockPicker onPick={vi.fn()} />);
    screen.getAllByRole('button').forEach((button) => {
      expect(button.tagName.toLowerCase()).toBe('button');
      expect(button).toHaveAttribute('type', 'button');
    });
  });
});
```

- [ ] **Step 5: Write `BlockPicker.tsx`**

```tsx
// Ten buttons, one per block kind, built from BLOCK_KINDS (src/content/guards.ts)
// rather than a list of its own -- so the picker cannot offer a kind
// BlockFields has no branch for, and cannot silently miss one the model has.
// BLOCK_KIND_SET is checked exhaustive against BlockKind at compile time, so
// that list is the closed one.
//
// `type="button"` on every one, and not cosmetic: this renders inside the one
// <form> PublishBar's Publish button submits, and an unlabelled <button>
// inside a form defaults to type="submit" -- so adding a block would have
// opened the publish confirmation instead. CollapsibleSection's own toggle
// carries the same comment for the same reason.
//
// Two across on a phone and three from 640px up: `grid-cols-2` and
// `sm:grid-cols-3` both already ship. NOT the larger breakpoint's
// three-column variant, which would be a new rule against 107 bytes of
// headroom, and there is no visual argument for it here.
import { BLOCK_KIND_HELP, BLOCK_KIND_LABELS } from './block-meta';
import { BLOCK_KINDS } from '../../content/guards';
import type { BlockKind } from '../../content/types';

// Her order, not the model's. BLOCK_KINDS comes out in BlockContentMap's
// declaration order, which is fine for a compiler and wrong for a person:
// paragraph and heading are what she reaches for in every post and belong
// first, and the recipe pair belongs together. A hand-written order that is
// CHECKED against BLOCK_KINDS for completeness (BlockPicker.test.tsx) gets
// both -- a deliberate arrangement, and no chance of an eleventh kind going
// missing from it.
const PICKER_ORDER: BlockKind[] = [
  'paragraph',
  'heading',
  'bulletList',
  'numberList',
  'ingredients',
  'steps',
  'image',
  'gallery',
  'quote',
  'citation',
];

export default function BlockPicker({ onPick }: { onPick: (kind: BlockKind) => void }) {
  // Completeness at runtime as well as in the test: a kind in BLOCK_KINDS
  // that PICKER_ORDER forgot is appended rather than lost. The test is what
  // fails; this is what keeps her able to insert it in the meantime.
  const order = [...PICKER_ORDER, ...BLOCK_KINDS.filter((kind) => !PICKER_ORDER.includes(kind))];

  return (
    <div>
      <p className={`mb-3 font-['Montserrat'] text-sm uppercase tracking-wide text-accent`}>Add to this post</p>
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
        {order.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            className="rounded border-2 border-dashed border-brand p-4 text-left transition hover:bg-brand/10"
          >
            <span className={`block font-['Montserrat'] text-sm uppercase tracking-wide text-accent`}>
              {BLOCK_KIND_LABELS[kind]}
            </span>
            <span className={`mt-1 block font-['Open_Sans'] text-sm text-gray-600`}>{BLOCK_KIND_HELP[kind]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

> Every class here is on the allowlist in "The CSS budget, measured" — `border-2 border-dashed border-brand`, `hover:bg-brand/10` and `p-4` all come from `ADD_BUTTON_CLASSNAME`'s own rule set, which already ships. **`text-left` is the one to check**: build and `grep -o '\.text-left[,{:]' dist/assets/index-*.css`. If it returns 0 it is a new rule, and the fix is to drop it — a `<button>`'s default `text-align: center` is wrong for a two-line card, so if `text-left` costs bytes, use `<span className="block">` children and accept centred text rather than spending Task 8's margin here. **Measure before deciding.**

- [ ] **Step 6: Wire the picker into `BlockList`**

At the end of `BlockList`'s returned `<div>`, after the `</ul>`:

```tsx
      <BlockPicker onPick={(kind) => onChange([...safe, blankBlock(kind)])} />
```

and add the two imports. Append to `BlockList.test.tsx`:

```tsx
  it('picking a kind appends a blank block of that kind', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList({ blocks: [{ kind: 'heading', text: 'First' }] });
    await user.click(screen.getByRole('button', { name: new RegExp(BLOCK_KIND_LABELS.numberList) }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'heading', text: 'First' },
      { kind: 'numberList', items: [''] },
    ]);
  });

  it('the picker is offered even when the post has no blocks at all', () => {
    renderList({ blocks: [] });
    expect(screen.getByRole('button', { name: new RegExp(BLOCK_KIND_LABELS.paragraph) })).toBeInTheDocument();
  });
```

> The second case is the one that matters for "she could not get stuck": an empty post shows the validator's "has nothing in it yet" message **and** the ten things she could add, in the same view. A picker rendered only when blocks exist would leave a new post with a complaint and no remedy.
>
> `renderList`'s existing cases now find more buttons than before. **Re-run the whole file**: `Move Heading block 1 down` and friends are unaffected (the picker's buttons have different accessible names), but a `getAllByRole('button')` count anywhere in that file will have moved. Fix by narrowing the query, never by asserting the new number — a bare count is a change detector.

- [ ] **Step 7: Run to verify it passes, and measure the CSS**

```
npx vitest run src/admin/blocks src/content/__tests__/validate.test.ts src/admin/__tests__/PostList.test.tsx src/admin/areas/__tests__/PostsArea.test.tsx
npx tsc -b --noEmit
npx eslint .
```

Then the rule-level diff against a worktree checkout of the true parent, exactly as Task 4 Step 8 ran it. **Expected `ADDED: []`, `REMOVED: []`, 38593 both sides** — unless `text-left` turns out to be new, in which case remove it and re-measure rather than raising anything. **Task 8 is the only task authorised to raise the ceiling, and its 159-byte margin is not a slush fund.**

- [ ] **Step 8: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | Add an eleventh kind to `BlockContentMap` with no `BLANK_BLOCK` entry | `tsc -b` on the total Record. **This is what the factory's shape is FOR** |
| 2 | In `BLANK_BLOCK`, `image: () => ({ kind: 'image', src: '/placeholder.webp', alt: '' })` | `a blank image tells her exactly what it needs` (the `src` problem disappears) AND `a blank image is refused at the import boundary too`. **And `src/content/__tests__/assets.test.ts` if anyone commits such a block** — the reason the comment forbids a placeholder path |
| 3 | In `BLANK_BLOCK`, `bulletList: () => ({ kind: 'bulletList', items: [] })` | `a blank bulletList tells her exactly what it needs` — the field becomes `[0].blocks[0].items` rather than `[0].blocks[0].items[0]`, i.e. a message with no box beside it |
| 4 | In `BLANK_BLOCK`, `citation: () => ({ ..., url: '' })` | `a blank citation has a null link, not an empty one` AND `a blank citation tells her exactly what it needs` (a second problem appears on `url`) |
| 5 | In `BLANK_BLOCK`, `image: () => ({ kind: 'image', src: '', alt: '', caption: '' })` | `omits caption and attribution entirely rather than blanking them` |
| 6 | Hoist the ten factories to shared literals (`const P = { kind: 'paragraph', text: '' }; paragraph: () => P`) | `returns a fresh object every time, with fresh arrays inside it`. **Run it** — this is the aliasing bug where typing into one list types into another, and it is exactly the shape a later "optimisation" would introduce |
| 7 | In `BLANK_BLOCK`, `ingredients: () => ({ kind: 'ingredients', heading: '', items: [''] })` | `a blank ingredients tells her exactly what it needs` — a second problem appears on `heading`. **Deliberate**: the pre-filled heading is a decision, and this is what makes it a decision rather than an accident |
| 8 | In `BlockPicker`, replace `BLOCK_KINDS`-derived completeness with `PICKER_ORDER` alone and remove `citation` from `PICKER_ORDER` | `offers exactly the kinds the model has` on the length AND on `citation is not offered` |
| 9 | In `BlockPicker`, reorder `PICKER_ORDER` so `image` is first | `offers exactly the kinds the model has` on the `names[0]` assertion. **This is the mutation that makes the hand-written order a decision rather than incidental** |
| 10 | In `BlockPicker`, drop `type="button"` | `every button is a real button` — and the real defect is worse than the test: adding a block would submit the publish form |
| 11 | In `BlockPicker`, drop the `BLOCK_KIND_HELP` span | `says what each one is for, not just what it is called` |
| 12 | In `BlockList`, render `<BlockPicker>` only when `safe.length > 0` | `the picker is offered even when the post has no blocks at all` |
| 13 | In `BlockList`, `onPick={() => onChange([...safe, blankBlock('paragraph')])}` (ignore the argument) | `picking a kind appends a blank block of that kind` |

- [ ] **Step 9: Gate, then commit**

```bash
git add src/admin src/content/__tests__/validate.test.ts
npm run gate
```

Expected: exit 0, entry CSS **38593 bytes**.

```bash
git commit -m "feat(admin): a block picker she can read, and a blank block per kind

Ten buttons built from BLOCK_KINDS, so the picker cannot offer a kind the
editor has no branch for and cannot miss one the model has. The order on
screen is hand-written -- paragraph and heading first, the recipe pair
together -- and checked against BLOCK_KINDS for completeness, so the
arrangement is deliberate and an eleventh kind still cannot go missing.

Each button says what the block is for, not just what it is called. Ten
nouns in a grid is the point at which a non-technical owner stops and asks
somebody.

The factory is a total Record over BlockKind, so a new kind is a compile
error rather than an Add button that produces a record nothing recognises.
Every blank block's exact validation-problem list is asserted per kind, not
"at least one problem" -- a length check is the tell that has already let a
broken slice pass here once.

A blank photo block is refused by the import-time guard, and that is the two
guards working in order rather than a defect: the write boundary refuses the
same block first, so it can never reach a committed file. Pinned, so nobody
fixes it with a placeholder path that has no file behind it."
```

---

### Task 7: the formatting toolbar — bold, italic, link

Three buttons over the `<textarea>` `InlineTextField` already renders. `setSelectionRange` on a plain textarea — **no contenteditable and no rich-text library**, because a contenteditable's value is markup and this codebase's entire safety argument is that no markup string exists anywhere.

**The link button rejects an unsafe target at the moment she pastes it, through the same `isSafeHref` the parser and the write boundary both read.** That is not redundant with `validatePosts` and neither can be removed on the strength of the other: `validatePosts` refuses at publish, minutes later, naming a field; the toolbar refuses at the keystroke, next to the box, while she still has the thing she pasted on her clipboard. And `isSafeHref` is 5A's hardened version — it normalises through `new URL(...).origin` rather than pattern-matching, because `/\evil.example` resolves to `https://evil.example/` and so does `/` + TAB + `/host`, and `/%5C` is deliberately **accepted** because a percent-encoded backslash stays on-origin.

**Files:**
- Modify: `src/admin/blocks/InlineTextField.tsx` (the toolbar goes inside; **no caller changes**)
- Modify: `src/admin/blocks/__tests__/InlineTextField.test.tsx`
- Modify: `e2e/block-editor.spec.ts` — **no; the e2e spec is Task 8's file.** Nothing in `e2e/` here: every claim in this task is about a string and a selection, both of which jsdom implements faithfully.

**Interfaces:**
- Consumes: `isSafeHref` from `src/content/markdown` (Task 1 did not touch it, and Task 1 Step 6 proves that), `MOVE_BUTTON_CLASSNAME` from `../RecordList`, `InlineTextFieldProps` (Task 5 — **unchanged**).
- Produces: nothing new. The toolbar is internal, which is why `InlineTextField` was given its own component in Task 5.

- [ ] **Step 1: Write the failing test**

Append to `src/admin/blocks/__tests__/InlineTextField.test.tsx`:

```tsx
// window.prompt is "not implemented" in jsdom and printing that stack is the
// noise a review already had fixed once (window.scrollTo, stubbed in
// setup.ts) -- noise in a passing suite is what hides the next real error. It
// is spied per-test rather than stubbed globally in setup.ts, because its
// RETURN VALUE is this feature's input and a global stub would have to pick
// one answer for every test in the repository.
function promptWith(answer: string | null) {
  return vi.spyOn(window, 'prompt').mockReturnValue(answer);
}

function renderField(value: string, onChange = vi.fn()) {
  render(<InlineTextField id="f" label="Words" value={value} onChange={onChange} problems={[]} />);
  const area = screen.getByLabelText('Words') as HTMLTextAreaElement;
  return { area, onChange };
}

function select(area: HTMLTextAreaElement, start: number, end: number) {
  area.focus();
  area.setSelectionRange(start, end);
}

describe('the formatting toolbar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps the selection in bold markers and leaves the rest alone', async () => {
    const user = userEvent.setup();
    const { area, onChange } = renderField('Rest the dough for an hour.');
    select(area, 9, 14);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onChange).toHaveBeenCalledWith('Rest the **dough** for an hour.');
  });

  it('wraps the selection in emphasis markers', async () => {
    const user = userEvent.setup();
    const { area, onChange } = renderField('Rest the dough for an hour.');
    select(area, 9, 14);
    await user.click(screen.getByRole('button', { name: 'Italic' }));
    expect(onChange).toHaveBeenCalledWith('Rest the *dough* for an hour.');
  });

  // With nothing selected the markers still go in, around an empty middle, so
  // she can turn bold ON and then type. A toolbar that did nothing without a
  // selection is a button that appears broken.
  it('with nothing selected, inserts the markers and puts the caret between them', async () => {
    const user = userEvent.setup();
    const { area, onChange } = renderField('Rest the dough.');
    select(area, 15, 15);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onChange).toHaveBeenCalledWith('Rest the dough.****');
  });

  // The selection has to survive the round trip, or the second click of a
  // bold-then-italic pair applies to the wrong characters. This is the one
  // claim in the file that is about the textarea's own state rather than the
  // string, and jsdom implements setSelectionRange faithfully -- unlike
  // layout, which is why this is not an e2e test.
  it('keeps the same words selected afterwards, so a second marker lands correctly', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <InlineTextField id="f" label="Words" value="Rest the dough." onChange={onChange} problems={[]} />,
    );
    const area = screen.getByLabelText('Words') as HTMLTextAreaElement;
    select(area, 9, 14);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    rerender(
      <InlineTextField id="f" label="Words" value="Rest the **dough**." onChange={onChange} problems={[]} />,
    );
    expect(area.selectionStart).toBe(11);
    expect(area.selectionEnd).toBe(16);
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe('dough');
  });

  it('a link wraps the selection and takes the target she typed', async () => {
    const user = userEvent.setup();
    promptWith('https://example.com/a');
    const { area, onChange } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).toHaveBeenCalledWith('See [the piece](https://example.com/a) here.');
  });

  it('a link with nothing selected gets placeholder words she can then replace', async () => {
    const user = userEvent.setup();
    promptWith('/catering');
    const { area, onChange } = renderField('Read more: ');
    select(area, 11, 11);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).toHaveBeenCalledWith('Read more: [this](/catering)');
  });

  it('cancelling the prompt changes nothing at all', async () => {
    const user = userEvent.setup();
    promptWith(null);
    const { area, onChange } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The security half, and every payload here is one isSafeHref was hardened
  // against. Refused BEFORE it reaches the text: validatePosts would refuse
  // it too, at publish, minutes later and one screen away -- both boundaries
  // exist and neither replaces the other.
  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['//evil.example/x'],
    ['/\\evil.example'],
    ['/press/../../etc/passwd'],
    ['example.com'],
    ['https:// evil.example'],
  ])('refuses %s before it reaches the text', async (target) => {
    const user = userEvent.setup();
    promptWith(target);
    const { area, onChange } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/will not work as a link/);
  });

  // Accepted, and asserted beside the refusals rather than left implicit. A
  // percent-encoded backslash is not decoded before parsing, so it stays on
  // this origin -- refusing it would be over-strict against real content, and
  // that was a deliberate call when isSafeHref was hardened.
  it.each([['https://example.com/a'], ['/catering'], ['/press/%5Cx.webp']])(
    'accepts %s',
    async (target) => {
      const user = userEvent.setup();
      promptWith(target);
      const { area, onChange } = renderField('See the piece here.');
      select(area, 4, 13);
      await user.click(screen.getByRole('button', { name: 'Link' }));
      expect(onChange).toHaveBeenCalledWith(`See [the piece](${target}) here.`);
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );

  it('the refusal message clears once she supplies a usable target', async () => {
    const user = userEvent.setup();
    const spy = promptWith('javascript:alert(1)');
    const { area } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    spy.mockReturnValue('https://example.com/a');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The error region for a VALIDATION problem and the one for a refused link
  // are different things and must not collide -- two role="alert" nodes in
  // one field is the "two names for one thing" defect this project has
  // already fixed twice.
  it('a refused link and a validation problem are one alert region each', async () => {
    const user = userEvent.setup();
    promptWith('javascript:alert(1)');
    render(
      <InlineTextField
        id="f"
        label="Words"
        value="x"
        onChange={vi.fn()}
        problems={[{ field: '[0].blocks[0].text', message: 'this paragraph needs some words' }]}
      />,
    );
    const area = screen.getByLabelText('Words') as HTMLTextAreaElement;
    select(area, 0, 1);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts.map((el) => el.textContent)).toEqual([
      expect.stringContaining('will not work as a link'),
      'this paragraph needs some words',
    ]);
  });
});
```

- [ ] **Step 2: Add the toolbar to `InlineTextField.tsx`**

```tsx
// A toolbar over a plain <textarea>, driven by setSelectionRange. NOT
// contenteditable and NOT a rich-text library, and the reason is the same one
// that makes src/content/markdown.ts hand-written: a contenteditable's value
// IS markup, and this codebase's whole safety argument is that no markup
// string exists anywhere -- src/test/html-sinks.test.ts fails the build if
// any shipped module so much as names a parsing sink.
//
// What she sees in this box is the source, asterisks and all. That is a
// deliberate trade and the alternative was measured: a live rendered preview
// would re-parse on every keystroke, which is the path the parser hang made
// dangerous (Task 1) and which would need its own debounce, its own error
// boundary and its own answer to "which one is the real text". Three
// buttons that insert the two characters she would otherwise have to know
// about is the smaller, honest version.
import { useEffect, useRef, useState } from 'react';
import { INPUT_CLASSNAME, LABEL_CLASSNAME } from '../Field';
import { MOVE_BUTTON_CLASSNAME } from '../RecordList';
import { isSafeHref } from '../../content/markdown';
import type { ValidationProblem } from '../../content/validate';
```

Inside the component, above the `return`:

```tsx
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Where the selection should be after the parent re-renders with the new
  // value. It cannot be set synchronously: this is a controlled textarea, so
  // onChange goes up, the parent re-renders, React writes `value` back down,
  // and any selection set before that is discarded. A ref plus the effect
  // below is what survives the round trip -- and it matters, because without
  // it a bold-then-italic pair applies the second marker to the wrong
  // characters.
  const pendingSelection = useRef<[number, number] | null>(null);
  // A target she pasted that will not work as a link. Held here rather than
  // pushed through `problems`, because it is not a validation result: it
  // describes something that did NOT happen to the text.
  const [linkError, setLinkError] = useState<string | null>(null);

  // No dependency array on purpose: this has to run after whichever render
  // carries the new value, and the ref guard makes it a no-op on every other
  // one. A dependency on `value` would also fire when the parent changes the
  // text for some unrelated reason and would steal focus.
  useEffect(() => {
    const area = areaRef.current;
    const pending = pendingSelection.current;
    if (area === null || pending === null) return;
    pendingSelection.current = null;
    area.focus();
    area.setSelectionRange(pending[0], pending[1]);
  });

  function surround(marker: string): void {
    const area = areaRef.current;
    if (area === null) return;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    // With nothing selected this inserts the markers around an empty middle
    // and leaves the caret between them, so she can turn bold on and type. A
    // button that did nothing without a selection reads as broken.
    pendingSelection.current = [start + marker.length, end + marker.length];
    onChange(`${value.slice(0, start)}${marker}${value.slice(start, end)}${marker}${value.slice(end)}`);
  }

  function insertLink(): void {
    const area = areaRef.current;
    if (area === null) return;
    // window.prompt, and it is the right control here rather than a lazy one.
    // It is blocking, universally understood, cancellable with Escape, and
    // costs zero CSS against 107 bytes of headroom. An inline panel would be
    // a second focus trap, a second Escape handler and new rules for a
    // control used a handful of times per post.
    const answer = window.prompt(
      'Where should this link go? Paste a full web address starting with https://, or a page on this site starting with /',
    );
    // null is Cancel. An EMPTY string is not: she pressed OK with nothing in
    // the box, which isSafeHref refuses below and which deserves the same
    // sentence as any other unusable target.
    if (answer === null) return;
    const target = answer.trim();
    if (!isSafeHref(target)) {
      // The same judgement isSafeHref makes for the parser and (through
      // rawLinkTargets) for the write boundary, asked here first so she is
      // told at the moment she pastes rather than at publish. It normalises
      // through the URL parser rather than matching patterns, because a
      // leading slash followed by a backslash lands on somebody else's host
      // and so does a slash followed by a tab and two more slashes.
      setLinkError(
        `"${target}" will not work as a link. Use a full web address starting with https://, or a page on this site starting with /`,
      );
      return;
    }
    setLinkError(null);
    const start = area.selectionStart;
    const end = area.selectionEnd;
    // Placeholder words when nothing is selected, and the caret lands ON them
    // so her next keystroke replaces them. `[](url)` with an empty label
    // renders as a link with nothing to click.
    const label = value.slice(start, end) || 'this';
    pendingSelection.current = [start + 1, start + 1 + label.length];
    onChange(`${value.slice(0, start)}[${label}](${target})${value.slice(end)}`);
  }
```

Then, in the returned JSX, between the help paragraph and the `<textarea>`:

```tsx
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => surround('**')} className={MOVE_BUTTON_CLASSNAME}>
          Bold
        </button>
        <button type="button" onClick={() => surround('*')} className={MOVE_BUTTON_CLASSNAME}>
          Italic
        </button>
        <button type="button" onClick={insertLink} className={MOVE_BUTTON_CLASSNAME}>
          Link
        </button>
      </div>
```

and give the `<textarea>` `ref={areaRef}`, and add the refusal region **above** the validation one so a screen reader hears the thing that just happened first:

```tsx
      {linkError !== null && (
        <p role="alert" className={`mt-1 font-['Montserrat'] text-sm text-red-600`}>
          {linkError}
        </p>
      )}
```

> **`Italic` is a button LABEL, in JSX text, not a class name — and that is exactly the token the content scanner emits a rule for.** It is safe here for one specific reason and the reason must be checked, not assumed: `italic` (lowercase) is what Tailwind matches, and `Italic` (capitalised) is not. **Build and run the rule-level diff before believing that.** If `ADDED` shows `italic`, the fix is to label the button `Emphasis` — the parser's own word for `*`, and one `Inline.tsx` already renders as `<em>`. 5A measured the slant utility at **+26 bytes**, and this task has no budget.
>
> `MOVE_BUTTON_CLASSNAME` for all three, imported rather than retyped: it is the small bordered uppercase button this dashboard already uses for Up/Down, which is the right visual weight for a toolbar and costs nothing.

- [ ] **Step 3: Run to verify it passes, and measure**

```
npx vitest run src/admin/blocks/__tests__/InlineTextField.test.tsx
npx vitest run src/admin/blocks src/admin/__tests__/PostList.test.tsx src/admin/areas/__tests__/PostsArea.test.tsx
npx tsc -b --noEmit
npx eslint .
```

Expected: PASS. **Watch for two things in the wider run:** `BlockFields.test.tsx`'s `getAllByRole('button')` counts have moved (three per inline field now), and `PostsArea.test.tsx` may now print a jsdom "Not implemented: window.prompt" line if any case reaches the Link button without a spy. **Zero "Not implemented" in the whole suite is the standard this project set** — a review found `window.scrollTo` printing the only such stack in a 139-file run and had it stubbed in `setup.ts`. If one appears, add the spy to the test that triggers it, not a global stub.

Then the rule-level diff against a worktree checkout of the true parent. **Expected `ADDED: []`, `REMOVED: []`, 38593 both sides.** If `italic` appears, relabel the button and re-measure.

- [ ] **Step 4: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | In `insertLink`, drop the `isSafeHref` check | **the mutation this task's security half is FOR.** All eight refusal cases, on both assertions each — `onChange` fires and no alert appears |
| 2 | In `insertLink`, replace `isSafeHref(target)` with `/^https?:\/\//.test(target) \|\| target.startsWith('/')` | `refuses /\evil.example` and `refuses /press/../../etc/passwd` and `refuses https:// evil.example` — the three shapes 5A's hardening was for, and the three a plausible hand-rolled check waves through |
| 3 | In `insertLink`, treat `''` as Cancel (`if (answer === null \|\| answer === '') return;`) | **PREDICTED NOT TO REDDEN** — no case supplies `''`. **Add one:** `promptWith('')` must produce the refusal alert and no `onChange`, because pressing OK on an empty box is not the same act as pressing Cancel and she should be told so. Then re-run and confirm |
| 4 | In `insertLink`, drop `setLinkError(null)` on the success path | `the refusal message clears once she supplies a usable target` |
| 5 | In `surround`, set `pendingSelection` to `[start, end]` (unshifted) | `keeps the same words selected afterwards` — `selectionStart` is 9, not 11, and the selected slice is `he d` rather than `dough`. **This is the defect that makes bold-then-italic apply to the wrong characters** |
| 6 | Remove the `useEffect` entirely | `keeps the same words selected afterwards` |
| 7 | Give the `useEffect` a `[value]` dependency array | **PREDICTED NOT TO REDDEN** — the `rerender` changes `value`, so the effect still fires. Recorded as a gap rather than as proof: the difference it makes is focus theft on an unrelated parent re-render, which jsdom can express but no assertion here covers. **Do not add a test that asserts focus after an unrelated re-render unless you can make it fail with the dep array present** — an unfalsifiable test for a subtle bug is worse than a comment |
| 8 | In `surround`, `onChange(marker + value)` | `wraps the selection in bold markers and leaves the rest alone` |
| 9 | In `insertLink`, `const label = value.slice(start, end);` (no fallback) | `a link with nothing selected gets placeholder words she can then replace` — the value becomes `Read more: [](/catering)` |
| 10 | Swap `'**'` and `'*'` between the Bold and Italic buttons | both `wraps the selection in bold markers` and `wraps the selection in emphasis markers` |
| 11 | Render the `linkError` paragraph **after** the validation one | `a refused link and a validation problem are one alert region each` — the array order flips |
| 12 | Give the `linkError` paragraph the same `id` as the validation one | duplicate ids; `aria-describedby` then points at whichever the DOM returns first. **PREDICTED NOT CAUGHT by any assertion here.** The `linkError` paragraph deliberately carries **no id and is not in `aria-describedby`**, because it is announced by `role="alert"` at the moment it appears, which is when she needs it. Recorded so a later reader does not "fix" it by wiring it in and colliding with the validation id |
| 13 | Label the Italic button `italic` (lowercase) | no test moves — **the CSS does.** The rule-level diff shows `ADDED: ['italic']` and the build reports **38619**. The comment-and-string scanner hazard, made concrete, and the reason Step 3 measures |

- [ ] **Step 5: Gate, then commit**

```bash
git add src/admin/blocks
npm run gate
```

Expected: exit 0, entry CSS **38593 bytes**.

```bash
git commit -m "feat(admin): bold, italic and link over a plain textarea

setSelectionRange on a real textarea, not contenteditable and not a
rich-text library: a contenteditable's value is markup, and this codebase's
whole safety argument is that no markup string exists anywhere.

The selection survives the controlled round trip. Without that, the second
of a bold-then-italic pair applies its marker to the wrong characters, which
is the kind of thing that reads as the editor being broken.

The link button refuses an unusable target before it reaches the text,
through the same isSafeHref the parser and the write boundary both read --
including the shapes a hand-rolled check waves through: a leading slash
followed by a backslash, and a slash followed by whitespace and two more
slashes, both of which browsers resolve to another host. A percent-encoded
backslash is accepted, because it stays on this origin.

Both boundaries stay. This one tells her at the keystroke, next to the box,
while she still has what she pasted; the write boundary refuses at publish.
Neither replaces the other."
```

---

### Task 8: drag to reorder, and the phase's only CSS ceiling raise

HTML5 drag-and-drop on the block list, with `cursor-move` on the handle and `opacity-50` on the block being dragged. **This is the first task in this project to raise the CSS ceiling**, and it does it with a rule-level diff against a worktree checkout of the true parent commit and its own entry in `bundle.post-build.test.ts`'s comment history.

**The Up/Down buttons stay.** Drag is a second way to do the same thing and never the only way: a drag is unusable on a phone with a long block list, and the owner edits this site from her phone. A task whose diff removes those buttons has gone wrong.

**The drag itself is a browser claim and belongs in `e2e/`.** A `fireEvent.dragStart` test in jsdom proves a handler was called and nothing whatsoever about whether a block moved — jsdom has no drag implementation, no `DataTransfer` worth the name and no layout engine. The jsdom tests in this task assert what they can honestly assert: that the handle exists, that it is reachable, and that the reorder **function** produces the right array. Whether a drag moves a block is `e2e/block-editor.spec.ts`'s job.

**The measurement, taken for this plan against a real `npx vite build` at `3025385`:**

```
before: 38593 bytes   (ceiling 38700, 107 free)
probe:  one component with className="cursor-move opacity-50"
after:  38641 bytes   (delta +48)
ADDED:   [ 'cursor-move', 'opacity-50' ]
REMOVED: []
```

**Ceiling 38700 → 38800, against a measured 38641: a 159-byte margin**, inside this lineage's own 115-250 band. `select-none` and `cursor-pointer` are already in the bundle (verified by grep), so the handle takes both for free.

**Files:**
- Modify: `src/admin/blocks/BlockList.tsx` (the handle and the four drag handlers)
- Modify: `src/admin/blocks/__tests__/BlockList.test.tsx`
- Create: `src/admin/blocks/reorder.ts` and `src/admin/blocks/__tests__/reorder.test.ts`
- Create: `e2e/block-editor.spec.ts`
- Modify: `src/test/bundle.post-build.test.ts` (**the assertion and its comment — the one task authorised to touch either**)

**Interfaces:**
- Consumes: `BlockList` (Tasks 5, 6), `e2e/edit-backend.ts`'s harness.
- Produces, consumed by Task 10:
  - `export function moveTo<T>(items: T[], from: number, to: number): T[]` from `src/admin/blocks/reorder.ts` — a pure function, extracted **because** the drag handlers cannot be tested in jsdom and this is the part of them that can

- [ ] **Step 1: Write the failing reorder test**

`src/admin/blocks/__tests__/reorder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { moveTo } from '../reorder';

// A move is not a swap, and that is the whole reason this function exists
// separately from BlockList's own `swap`. Dragging block 1 to position 4
// must SLIDE the three in between up by one, not exchange two of them --
// which is what Up/Down does and what a swap-based drag would do wrongly.
describe('moveTo', () => {
  it.each([
    ['forwards', 0, 2, ['b', 'c', 'a', 'd']],
    ['backwards', 3, 1, ['a', 'd', 'b', 'c']],
    ['to itself, unchanged', 2, 2, ['a', 'b', 'c', 'd']],
    ['to the end', 0, 3, ['b', 'c', 'd', 'a']],
    ['to the start', 3, 0, ['d', 'a', 'b', 'c']],
    ['one step forwards, which IS a swap', 1, 2, ['a', 'c', 'b', 'd']],
  ])('moves %s', (_name, from, to, expected) => {
    expect(moveTo(['a', 'b', 'c', 'd'], from, to)).toEqual(expected);
  });

  // Clamped rather than trusted. `to` reaches this from a drop target's own
  // index today and from anywhere the moment anyone adds a keyboard
  // affordance, and an out-of-range splice silently drops an item -- which,
  // on a block list, is a paragraph she wrote disappearing. Phase 5A's
  // fourteenth under-asserting test was exactly this shape: an out-of-range
  // slice returning a real but wrong result that a length check accepted.
  it.each([
    ['a negative target', 2, -5, ['c', 'a', 'b', 'd']],
    ['a target past the end', 1, 99, ['a', 'c', 'd', 'b']],
    ['a negative source', -1, 0, ['a', 'b', 'c', 'd']],
    ['a source past the end', 99, 0, ['a', 'b', 'c', 'd']],
  ])('clamps %s', (_name, from, to, expected) => {
    expect(moveTo(['a', 'b', 'c', 'd'], from, to)).toEqual(expected);
  });

  it('never loses an item, whatever it is asked', () => {
    const items = ['a', 'b', 'c', 'd'];
    for (let from = -2; from < 6; from += 1) {
      for (let to = -2; to < 6; to += 1) {
        expect([...moveTo(items, from, to)].sort(), `moveTo(items, ${from}, ${to})`).toEqual([...items].sort());
      }
    }
  });

  it('returns a new array and does not mutate the one it was given', () => {
    const items = ['a', 'b', 'c', 'd'];
    const next = moveTo(items, 0, 3);
    expect(next).not.toBe(items);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });
});
```

- [ ] **Step 2: Write `reorder.ts`**

```ts
// Move one item to another position, sliding everything between it and the
// target. Extracted from BlockList's drag handlers rather than written inline,
// and the reason is testability rather than tidiness: jsdom has no drag
// implementation at all, so the handlers themselves can only be proven in a
// real browser (e2e/block-editor.spec.ts) -- and this is the part of them that
// can be proven here, exhaustively and cheaply.
//
// A MOVE, not a swap. BlockList's Up/Down buttons swap two neighbours, which
// is right for a one-step nudge and wrong for a drag from position 1 to
// position 5: a swap would exchange those two and leave the three in between
// where they were, which is not what she just did with her finger.
//
// Clamped rather than trusted. An out-of-range splice silently drops an item,
// which on a block list is a paragraph she wrote vanishing -- and Phase 5A's
// fourteenth under-asserting test was this exact shape, an out-of-range slice
// returning a real but wrong non-empty result that a length check accepted.
export function moveTo<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.min(Math.max(0, to), next.length - 1);
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}
```

Run:

```
npx vitest run src/admin/blocks/__tests__/reorder.test.ts
```

Expected: PASS.

- [ ] **Step 3: Add the handle and the handlers to `BlockList.tsx`**

Above the component:

```tsx
// A drag handle's whole discoverability is its cursor, which is why
// `cursor-move` is worth a new CSS rule (see this task's entry in
// bundle.post-build.test.ts's comment). `select-none` and `cursor-pointer`
// already ship, so the handle takes them for free -- without select-none, a
// slow drag selects the label text instead of starting a drag, which reads as
// the handle not working.
//
// `aria-hidden` and no role: this is a mouse affordance, and a screen-reader
// user reorders with the Up/Down buttons, which are real buttons with real
// names and are not going anywhere. A `role="button"` here would announce a
// third control that does nothing without a pointer.
const HANDLE_CLASSNAME = 'cursor-move select-none px-3 py-1 text-gray-500';
```

Inside the component, beside `swap`:

```tsx
  // Which block is being dragged, or null. State rather than a ref, because
  // the dragged block renders differently (dimmed) while it is in flight, and
  // that dimming is the only thing telling her which one she has hold of.
  const [dragging, setDragging] = useState<number | null>(null);
```

On each `<li>`:

```tsx
            <li
              key={index}
              // The drop target is the whole row, not a thin line between
              // rows: a 4px gap is not something anybody can hit on a phone,
              // and dropping "on" a block meaning "put mine here" is the
              // behaviour every list she has used works this way.
              onDragOver={(event) => {
                if (dragging === null) return;
                // preventDefault is what makes an element a valid drop target
                // at all -- without it the browser refuses the drop and the
                // drag ends with nothing happening, which is the single most
                // common way HTML5 drag-and-drop is got wrong.
                event.preventDefault();
              }}
              onDrop={(event) => {
                if (dragging === null) return;
                event.preventDefault();
                if (dragging !== index) onChange(moveTo(safe, dragging, index));
                setDragging(null);
              }}
              className={`mb-6 rounded border border-gray-200 p-4 ${dragging === index ? 'opacity-50' : ''}`}
            >
```

And, as the first child of the header row's left-hand group, before the kind label:

```tsx
                  <span
                    aria-hidden="true"
                    draggable
                    onDragStart={(event) => {
                      setDragging(index);
                      // Firefox refuses to start a drag at all unless
                      // something is set on the DataTransfer. The value is
                      // never read -- the index lives in component state,
                      // which is the only thing that survives a drop
                      // reliably across browsers -- so this is deliberately
                      // the block's position as a plain string rather than
                      // anything a paste could act on.
                      event.dataTransfer.setData('text/plain', String(index));
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={HANDLE_CLASSNAME}
                    data-drag-handle={index}
                    title="Drag to move this block"
                  >
                    ⠿
                  </span>
```

> `⠿` (U+283F, braille pattern) is the conventional drag-handle glyph, is a single character, needs no icon import and adds no CSS. `lucide-react` is already a dependency and has a `GripVertical` icon — **do not use it here**: every `lucide` icon this project renders is inside a component that already imports one, and adding an import to `BlockList` pulls another icon into the admin chunk for a decoration. Check the glyph renders in the browser during Step 5's look; if it does not, `⋮⋮` is the fallback and it is also zero-cost.
>
> `data-drag-handle={index}` is the e2e spec's selector, and it carries the index so the spec can target a specific handle without a role-and-name query. It costs nothing and it is the same cheap-attribute reasoning `data-panel` follows.

Add `useState` to the React import, and `moveTo` from `./reorder`.

- [ ] **Step 4: Add the honest jsdom tests**

Append to `src/admin/blocks/__tests__/BlockList.test.tsx`:

```tsx
// What jsdom can honestly say about a drag: that the handle is there, that it
// is marked draggable, and that it is NOT a second control competing with the
// buttons. Whether a block moves is e2e/block-editor.spec.ts's claim -- jsdom
// has no drag implementation, so a fireEvent.dragStart test would prove a
// handler was called and nothing at all about whether anything moved.
describe('BlockList’s drag handle, as far as jsdom can tell', () => {
  it('every block has one, and it is draggable', () => {
    renderList({ blocks: BLOCKS });
    const handles = document.querySelectorAll('[data-drag-handle]');
    expect(handles).toHaveLength(BLOCKS.length);
    handles.forEach((handle) => {
      expect(handle).toHaveAttribute('draggable', 'true');
    });
  });

  it('is hidden from assistive technology, because the buttons are the accessible path', () => {
    renderList({ blocks: BLOCKS });
    document.querySelectorAll('[data-drag-handle]').forEach((handle) => {
      expect(handle).toHaveAttribute('aria-hidden', 'true');
    });
    // And the buttons are still there. Drag is a second way, never the only
    // way: a drag is unusable on a phone with a long block list.
    expect(screen.getByRole('button', { name: 'Move Heading block 1 down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Paragraph block 3 up' })).toBeInTheDocument();
  });

  it('adds no third button to the accessibility tree', () => {
    renderList({ blocks: [{ kind: 'heading', text: 'Only' }] });
    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');
    expect(names.filter((name) => /drag/i.test(name))).toEqual([]);
  });
});
```

- [ ] **Step 5: The rule-level diff, the ceiling raise, and a look in a real browser**

First the diff. **A worktree checkout of the true parent commit, never a stash** — this lineage's standing rule, and the reason several numbers in the comment you are about to append had to be corrected.

```bash
git add -A src/admin/blocks
npx vite build
wc -c dist/assets/index-*.css
cp dist/assets/index-*.css /tmp/vb-after.css

PARENT=$(git rev-parse HEAD)
git worktree add /tmp/vb-parent "$PARENT"
(cd /tmp/vb-parent && npm ci --silent && npx vite build && wc -c dist/assets/index-*.css && cp dist/assets/index-*.css /tmp/vb-before.css)
git worktree remove --force /tmp/vb-parent

node -e '
const fs=require("fs");
const sel=(f)=>new Set([...fs.readFileSync(f,"utf8").matchAll(/\.((?:[a-zA-Z0-9_\-]|\\.)+?)(?=[,{:\s>~+\[])/g)].map(m=>m[1].replace(/\\/g,"")));
const a=sel("/tmp/vb-before.css"),b=sel("/tmp/vb-after.css");
console.log("ADDED:",[...b].filter(x=>!a.has(x)).sort());
console.log("REMOVED:",[...a].filter(x=>!b.has(x)).sort());
console.log("before",fs.statSync("/tmp/vb-before.css").size,"after",fs.statSync("/tmp/vb-after.css").size);
'
```

**Expected, exactly:**

```
before: 38593
after:  38641
ADDED:   [ 'cursor-move', 'opacity-50' ]
REMOVED: []
```

**If `ADDED` holds a third selector, stop.** The build will now be over the old 38700 ceiling for the first time in this project, so `npm run build` exits 1 — which is the guard working, and it is why the raise is the next step and not the first. Two causes for a surprise selector: a class not on this task's list (fix the component), or a utility-looking token in a comment (fix the comment). **`cursor-move` and `opacity-50` are both spelled out in the comment you are about to write into `bundle.post-build.test.ts`, and that file is glob-excluded from the scanner (`'!./src/test/**'` in `tailwind.config.js`), which is why that comment is free and `BlockList.tsx`'s must not name them.** `HANDLE_CLASSNAME` uses them in a real `className`, so `BlockList.tsx`'s own comment above it says "cursor" and "dimmed" rather than naming either utility.

Now raise the ceiling. In `src/test/bundle.post-build.test.ts`, the assertion at line ~656:

```ts
  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('the entry CSS file stays under 38800 bytes', () => {
    const cssFiles = readdirSync(DIST_ASSETS).filter((n) => /^index-.*\.css$/.test(n));
    expect(cssFiles.length).toBeGreaterThan(0);
    const size = statSync(join(DIST_ASSETS, cssFiles[0])).size;
    expect(size).toBeLessThan(38800);
  });
```

**Both the literal and the test's own name.** A name that still says 38700 over an assertion that says 38800 is two numbers for one thing, and it is the name a reader greps for.

Append to the long comment above it, after the Phase 5A paragraph that ends "…with a 107-byte margin.":

```
// Phase 5B, the block editor: 38593 -> 38641 (+48), TWO rules added and zero
// removed, traced by a rule-level diff against a worktree checkout of the
// true parent commit (never a stash) to `.cursor-move` and `.opacity-50`,
// both on BlockList.tsx's drag handle and dragged row.
//
// THE CEILING IS RAISED, 38700 -> 38800, and this is the first raise since
// Phase 3. The margin is 159 bytes, inside the 115-250 band every prior raise
// in this comment sits in. It is raised deliberately rather than absorbed:
// 5A landed at 38593 with 107 free, and +48 would have left 59 -- under this
// lineage's own floor, which means the next task to add one utility fails a
// build for a reason unrelated to itself.
//
// Both rules are load-bearing and neither is decoration. `cursor-move` on the
// handle IS the discoverability of drag-to-reorder for somebody who has never
// dragged a block before -- there is no other affordance, because the handle
// is a single glyph. `opacity-50` on the row in flight is the only thing
// telling her which block she has hold of once the pointer has left it.
//
// What this did NOT cost, because it is why 48 was enough: `select-none` and
// `cursor-pointer` were ALREADY in the bundle (verified by grep against the
// built stylesheet before the design was fixed), so the handle takes both for
// free -- and select-none is not optional, since without it a slow drag
// selects the label text instead of starting a drag. `cursor-grab` was
// considered and rejected: it is a second new rule for a state
// `cursor-move` already covers, and `ring-2`/`ring-brand` were rejected as a
// drop indicator for the same reason -- the dimming already says which block
// is moving.
//
// Everything else in this sub-plan spent ZERO. The Posts panel, PostList, the
// block fields, the picker and the toolbar are all built out of utilities
// already in the stylesheet, five of them by importing RecordList's and
// Field.tsx's own exported class bindings rather than retyping the strings --
// a retyped string is a new class to the scanner and ships a duplicate rule
// for a style that already exists. Each of those tasks ran the same
// rule-level diff and each reported ADDED: [], REMOVED: [].
//
// One near-miss worth recording: the toolbar's middle button is labelled
// "Italic" in JSX text, and the scanner is a plain text extractor. The
// capital letter is what saves it -- Tailwind matches `italic`, not `Italic`
// -- and that was CHECKED with a diff rather than assumed, because the same
// hazard fired three times in one 5A task. The lowercase form costs 26 bytes.
```

Then look at it in a real browser, because a drag handle is a thing you have to try:

```bash
npm run dev
```

Open `http://localhost:8080/edit/manage/story`, log in, unfold Posts, add a post, add three blocks, and **drag the second one to the top with the mouse**. Confirm: the cursor changes over the handle, the dragged row dims, the drop lands where you let go, and the Up/Down buttons still work. **Then stop the dev server** — Playwright binds the same port and a concurrent run gives phantom failures.

> **Restart the dev server cold if you re-run any CSS-removal check against it.** Tailwind's dev JIT never un-generates a class within one server session: it only ever adds, so removing the source that referenced a rule reads as still-present until a cold restart. This cost real time in 5A.

- [ ] **Step 6: Write the browser proof**

Create `e2e/block-editor.spec.ts`. **Look at the page before asserting anything about it** — Phase 3's e2e disaster was a spec that measured a wrong baseline and reddened faithfully against it for four rounds.

```ts
// The one claim in this sub-plan that jsdom cannot make: that a drag moves a
// block. jsdom has no drag implementation, so the unit tests deliberately
// assert only that the handle exists and is marked draggable
// (BlockList.test.tsx says so in its own describe name).
//
// Playwright's dragTo drives real pointer events and Chromium synthesises the
// HTML5 drag sequence from them, which is the same path the owner's own mouse
// takes. That is the whole point of running this here.
//
// Runs against `npm run dev` (playwright.config.ts's webServer.command), NOT
// against dist/ -- so no build in any earlier step has any bearing on what
// this spec sees.
import { expect, test } from '@playwright/test';
import { installEditBackend } from './edit-backend';

test.describe('the block editor', () => {
  test.beforeEach(async ({ page }) => {
    await installEditBackend(page);
    await page.goto('/edit/manage/story');
    await page.locator('[data-panel="posts"]').waitFor();
  });

  test('a block dragged onto another one lands there, and the others slide', async ({ page }) => {
    const panel = page.locator('#section-panel-posts');
    await panel.getByRole('button', { name: /^Posts$/ }).click().catch(() => undefined);

    // Build a post with three blocks whose kinds are distinguishable at a
    // glance, so the assertion reads the ORDER rather than the text -- text
    // would need typing into three textareas and would prove less.
    await panel.getByRole('button', { name: 'Add a post' }).click();
    await panel.getByRole('button', { name: /Heading/ }).first().click();
    await panel.getByRole('button', { name: /Bulleted list/ }).first().click();
    await panel.getByRole('button', { name: /Quote/ }).first().click();

    const kinds = panel.locator('li[class*="border-gray-200"] > div > div > span').first();
    const before = await panel.locator('[data-drag-handle]').count();
    expect(before).toBe(3);

    // LOOK FIRST. Read the labels off the page and assert the starting order
    // against what the picker was clicked in, rather than assuming it.
    const labelsBefore = await panel.locator('[data-drag-handle]').evaluateAll((handles) =>
      handles.map((handle) => handle.parentElement?.textContent?.replace('⠿', '').trim() ?? ''),
    );
    expect(labelsBefore).toEqual(['Heading', 'Bulleted list', 'Quote']);

    // The drag: third handle onto the first row.
    await panel.locator('[data-drag-handle="2"]').dragTo(panel.locator('[data-drag-handle="0"]'));

    const labelsAfter = await panel.locator('[data-drag-handle]').evaluateAll((handles) =>
      handles.map((handle) => handle.parentElement?.textContent?.replace('⠿', '').trim() ?? ''),
    );
    // A MOVE, not a swap: Quote goes to the top and the other two slide down.
    // A swap would have produced ['Quote', 'Bulleted list', 'Heading'], and
    // that difference is the entire reason moveTo exists.
    expect(labelsAfter).toEqual(['Quote', 'Heading', 'Bulleted list']);
  });

  test('the handle shows a move cursor, which is its only affordance', async ({ page }) => {
    const panel = page.locator('#section-panel-posts');
    await panel.getByRole('button', { name: 'Add a post' }).click();
    await panel.getByRole('button', { name: /Paragraph/ }).first().click();
    const handle = panel.locator('[data-drag-handle="0"]');
    // Read off the HANDLE ITSELF, not an ancestor: `cursor` IS inherited, so
    // reading a parent would pass on a handle that had lost the class -- the
    // same reading-the-wrong-element mechanism that produced this
    // repository's eleventh unfalsifiable assertion, where a filter was
    // asserted on an img while the grayscale sat on the wrapper.
    await expect(handle).toHaveCSS('cursor', 'move');
  });

  test('the Up and Down buttons still work, because a drag is unusable on a phone', async ({ page }) => {
    const panel = page.locator('#section-panel-posts');
    await panel.getByRole('button', { name: 'Add a post' }).click();
    await panel.getByRole('button', { name: /Heading/ }).first().click();
    await panel.getByRole('button', { name: /Quote/ }).first().click();
    await panel.getByRole('button', { name: 'Move Heading block 1 down' }).click();
    const labels = await panel.locator('[data-drag-handle]').evaluateAll((handles) =>
      handles.map((handle) => handle.parentElement?.textContent?.replace('⠿', '').trim() ?? ''),
    );
    expect(labels).toEqual(['Quote', 'Heading']);
  });
});
```

> **`installEditBackend` is the harness `e2e/edit-backend.ts` exports; read that file for its real export name and signature before writing this.** Several existing specs use it, so copy a working call site rather than inventing one. Same for how they log in — the harness answers the session probe, but the login step may still be needed.
>
> **The `kinds` locator above is dead code as written** and must be deleted before committing: it was a first draft and the `evaluateAll` approach replaced it. It is left visible here so the reviewer of this plan can see the discarded approach and why — a CSS-class-substring locator is brittle against exactly the class edits this task makes. **Delete the line; do not ship it.**
>
> **The unfolding click is written with `.catch(() => undefined)`, which is a smell.** Read `CollapsibleSection`'s `aria-expanded` and branch on it the way `AdminApp.test.tsx`'s `sectionByHeading` does, rather than swallowing a failure — a swallowed failure is how a spec passes against a panel that never opened. **Fix it in the real file.**

Run it, **alone, with nothing else running**:

```bash
npx playwright test e2e/block-editor.spec.ts
```

Expected: 3 passed. **If `dragTo` does not trigger the HTML5 sequence in this Chromium version, do not fall back to a jsdom test** — that is the thing this task exists to avoid. Instead drive the sequence explicitly with `page.dispatchEvent` for `dragstart`/`dragover`/`drop`, and say in the spec's own comment that it is a synthesised sequence rather than a real pointer drag, so a later reader knows exactly how much the green means.

- [ ] **Step 7: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | In `moveTo`, `next.splice(target, 0, moved)` → `next[target] = moved` (a swap) | `moves forwards` and `moves backwards` and the e2e `a block dragged onto another one lands there` — the e2e case gets `['Quote', 'Bulleted list', 'Heading']`. **The mutation that justifies `moveTo` existing at all** |
| 2 | In `moveTo`, remove the `Math.min(Math.max(...))` clamp | `clamps a negative target` and `clamps a target past the end` and `never loses an item, whatever it is asked`. **The last one is the important assertion** — Phase 5A's fourteenth under-asserting test was an out-of-range index returning a real but wrong result that a weaker check accepted |
| 3 | In `moveTo`, drop the `from < 0 \|\| from >= next.length` guard | `clamps a negative source` — `splice(-1, 1)` removes the LAST item and reinserts it, silently reordering on a nonsense input |
| 4 | In `moveTo`, `const next = items;` | `returns a new array and does not mutate the one it was given` |
| 5 | Remove `event.preventDefault()` from `onDragOver` | **the e2e `a block dragged onto another one lands there` only.** No jsdom test moves, and that is exactly the point: this is the most common way HTML5 drag-and-drop is got wrong, the browser silently refuses the drop, and **no jsdom test can see it.** Run it and confirm the e2e case reddens |
| 6 | Remove `draggable` from the handle | `every block has one, and it is draggable` in jsdom, **and** the e2e drag case |
| 7 | Remove `data-drag-handle` | `every block has one, and it is draggable` and all three e2e cases fail on the locator |
| 8 | Remove `aria-hidden="true"` from the handle | `is hidden from assistive technology` — and the real defect is that she hears a third control that a keyboard cannot use |
| 9 | Remove `cursor-move` from `HANDLE_CLASSNAME` | **the e2e `the handle shows a move cursor` only**, and the rule-level diff drops to `ADDED: ['opacity-50']` at 38619. **Cold-restart the dev server before re-running the e2e case** — the JIT does not un-generate a class within a session, so a warm server serves the rule that is no longer referenced and the test passes on a removed class |
| 10 | Remove `select-none` from `HANDLE_CLASSNAME` | **nothing reddens.** Recorded rather than hidden: its effect is that a slow drag selects text instead of dragging, which is a real usability defect and which neither jsdom nor a scripted `dragTo` reproduces, because neither performs a slow human drag. **The Step 5 browser look is the only check on it, and that is stated rather than papered over with a test that cannot fail** |
| 11 | Remove the `opacity-50` conditional from the `<li>` className | **nothing reddens**, for the same reason: the dimming exists only mid-drag and `dragTo` completes in one tick. Same disclosure. If a check is wanted, it is a Playwright `dragstart`-then-read-then-`drop` three-step, which is a synthesised sequence and worth adding **only** if it is written to actually fail with the class removed — verify that before keeping it |
| 12 | Set the ceiling literal back to 38700, leaving the name at 38800 | `npm run build` exits 1 with `expected 38641 to be less than 38700`. **Run it**, because it proves the raise was necessary rather than decorative |
| 13 | Set the ceiling to 39000 | nothing reddens. **Correctly so**, and recorded: this assertion is a budget, not a measurement, and only the comment records what the real number is. That is why the comment carries the measured 38641 and the margin |

> Rows 10 and 11 are **stated gaps in this task's own test list**, with the reason and the alternative both given. Two of this project's plan documents shipped mutation tables whose entries did not redden and were reported as proof anyway; disclosing two that genuinely cannot is the opposite of that, not an instance of it.

- [ ] **Step 8: Gate, then commit**

```bash
git add src/admin/blocks src/test/bundle.post-build.test.ts e2e/block-editor.spec.ts
npm run gate
```

Expected: exit 0, with `npm run build` reporting the entry CSS at **38641 bytes** against the new **38800** ceiling.

```bash
git commit -m "feat(admin): drag a block to move it, and raise the CSS ceiling to 38800

Two new rules, cursor-move and opacity-50, measured at +48 bytes by a
rule-level diff against a worktree build of the parent commit: two added,
zero removed, 38593 to 38641. The ceiling goes 38700 to 38800, leaving 159
bytes -- inside the band every prior raise in that comment's history sits in,
and raised deliberately rather than absorbed, because +48 against 107 free
would have left the next task failing a build for a reason unrelated to
itself.

Both rules are load-bearing. The cursor is the entire discoverability of a
drag handle that is one glyph wide, and the dimming is the only thing telling
her which block she has hold of. select-none and cursor-pointer were already
in the bundle, which is why 48 was enough.

The Up and Down buttons stay. A drag is unusable on a phone with a long block
list, so drag is a second way and never the only way, and there is a test
that fails if the buttons go.

Whether a drag moves a block is proven in a real browser. jsdom has no drag
implementation, so the unit tests assert only that the handle exists and is
marked draggable, and they say so in their own describe name. The pure move
function is extracted and tested exhaustively there instead -- including that
it never loses an item whatever index it is handed, which is the shape of a
bug this repository has already shipped once."
```

---

### Task 9: `posts.json` onto D1, with a loading state that is not `NotFound`

Phase 4's `story.json` fallback-then-swap, applied to posts. The committed file **stays** — it is the first paint, what a crawler and a reader with JS off see, and the anchor that keeps every post image inside `src/content/__tests__/assets.test.ts`'s walk, which cannot see D1 at all. D1 holds the live copy, so a publish is visible in seconds instead of after a two-minute Pages build.

**The specific defect to plan against, and it is the reason this task is not a copy of Phase 4's.** A post that exists **only** in D1 must not flash `NotFound` before the fetch lands. `story.json` never faced this because the committed copy always had content to paint; a post published after the last deploy is genuinely absent from the compiled-in list, so `/blog/:slug` needs a **third state — loading — distinct from not-found**, with a test asserting the loading view renders while the fetch is pending and `NotFound` **only after it settles**.

**This is the first task in this sub-plan that changes a Worker file. From here on, a push without `npx wrangler deploy` ships the read path inert:** `GET /api/published?path=posts.json` 404s in production while the frontend already expects it to work. The site does not break — the compiled-in fallback renders — but the feature is dead and every test is green. Phase 4's final review caught exactly this.

**No new migration and no new table.** `worker/migrations/0001_content.sql`'s generic `content` table holds whole documents with optimistic concurrency, revisions, depth-20 undo, an ETag, a version-keyed cache and a snapshot fallback already built on top. `content_meta` is empty and the runbook records it as existing "for Phase 5 to use without a second migration" — **5B does not need it either, and this task does not invent a use for it.** `scripts/build-snapshot.mjs` needs no change either: it selects every row and keys on the public filename, so a seeded `posts.json` is picked up automatically.

**Files:**
- Modify: `worker/store.ts` (`D1_ONLY_PATHS`)
- Modify: `worker/published.ts` (`PUBLIC_FILES`)
- Create: `src/components/blog/posts-api.ts`, `src/components/blog/use-posts.ts`
- Create: `src/components/blog/__tests__/posts-api.test.ts`, `src/components/blog/__tests__/use-posts.test.tsx`
- Modify: `src/components/blog/PostPage.tsx`, `src/components/blog/BlogIndex.tsx`
- Modify: `src/components/blog/__tests__/PostPage.test.tsx`, `BlogIndex.test.tsx`
- Create: `scripts/seed-posts-d1.mjs`, `scripts/sync-posts-fallback.mjs`, `scripts/__tests__/sync-posts-fallback.test.mjs`
- Regenerate: `worker/snapshot.ts` (by `node scripts/build-snapshot.mjs` — **never hand-edited**)

**Interfaces:**
- Consumes: `assertPosts` from `src/content/guards` (Task 2's hardened version), `postBySlug`/`pageOf`/`pageCount` from `src/components/blog/posts`, `useContent`.
- Produces, consumed by Tasks 10, 11, 12:
  - `export const POSTS_ENDPOINT = '/api/published?path=posts.json'` and `export async function fetchPosts(fetchImpl?: typeof fetch): Promise<Post[] | null>` from `posts-api.ts`
  - `export interface PostsState { status: 'loading' | 'loaded' | 'error'; posts: Post[] }` and `export function usePosts(fetchImpl?: typeof fetch): PostsState` from `use-posts.ts`
  - `export function postsFileFromRow(row: { body?: unknown } | undefined): string` from `scripts/sync-posts-fallback.mjs`

- [ ] **Step 1: Write the failing read-path tests**

`src/components/blog/__tests__/posts-api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { POSTS_ENDPOINT, fetchPosts } from '../posts-api';
import { posts as committed } from '../../../content';

// A fixture that differs from src/content/posts.json in every field asserted
// on, so this cannot pass by accidentally reading the committed copy.
const ROW = [
  {
    id: 'from-d1',
    slug: 'a-post-only-in-the-database',
    type: 'recipe',
    title: 'A post only in the database',
    date: '2026-05-06',
    excerpt: 'A database excerpt.',
    image: '/food/tielle.webp',
    blocks: [{ kind: 'paragraph', text: 'A database paragraph.' }],
  },
];

function respond(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as typeof fetch;
}

describe('fetchPosts', () => {
  it('asks the published read path for posts.json', async () => {
    const impl = respond(ROW);
    await fetchPosts(impl);
    expect(impl).toHaveBeenCalledWith(POSTS_ENDPOINT);
  });

  it('returns the posts the database holds', async () => {
    const got = await fetchPosts(respond(ROW));
    expect(got?.map((post) => post.slug)).toEqual(['a-post-only-in-the-database']);
    // Not the committed list. Phase 4's root cause was a fixture equal to the
    // real content, which cannot distinguish a real binding from a copy.
    expect(got?.map((post) => post.slug)).not.toEqual(committed.map((post) => post.slug));
  });

  it('throws on a non-2xx, so a caller can tell an outage from an empty blog', async () => {
    await expect(fetchPosts(respond({}, false))).rejects.toThrow(/status 503/);
  });

  // The security half, and it is the reason this runs the REAL guard rather
  // than a hand-rolled shape check. This body arrives from a database with no
  // build-time guard in front of it, and every one of these would otherwise
  // reach a live <img src> or an <a href>.
  it.each([
    ['a body that is not a list', { posts: [] }],
    ['a post with no blocks', [{ ...ROW[0], blocks: undefined }]],
    ['an unknown block kind', [{ ...ROW[0], blocks: [{ kind: 'video', src: '/x.mp4' }] }]],
    ['an off-site card image', [{ ...ROW[0], image: 'https://evil.example/x.webp' }]],
    ['a backslash card image', [{ ...ROW[0], image: '/\\evil.example/x.webp' }]],
    ['an off-site block photo', [{ ...ROW[0], blocks: [{ kind: 'image', src: '//evil.example/x.webp', alt: 'a' }] }]],
    ['a citation link that is not a link', [{ ...ROW[0], blocks: [{ kind: 'citation', publication: 'X', url: 'javascript:alert(1)', date: '2026-01-01' }] }]],
    ['two posts sharing a slug', [ROW[0], { ...ROW[0], id: 'other' }]],
  ])('returns null for %s -- keep whatever you already have', async (_name, body) => {
    expect(await fetchPosts(respond(body))).toBeNull();
  });

  it('accepts an empty list, because a restaurant with no posts is not an error', async () => {
    expect(await fetchPosts(respond([]))).toEqual([]);
  });
});
```

`src/components/blog/__tests__/use-posts.test.tsx`:

```tsx
describe('usePosts', () => {
  // A promise this test resolves by hand, so "while the fetch is pending" is
  // an actual state the assertions run in rather than a race.
  function deferred() {
    let settle: (value: unknown) => void = () => undefined;
    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }

  it('paints the committed posts while the fetch is pending, and says it is loading', () => {
    const { promise } = deferred();
    const impl = vi.fn().mockReturnValue(promise) as unknown as typeof fetch;
    const { result } = renderHook(() => usePosts(impl), { wrapper: ContentWrapper });
    expect(result.current.status).toBe('loading');
    expect(result.current.posts.map((post) => post.slug)).toEqual(committed.map((post) => post.slug));
  });

  it('swaps in the database copy once it lands', async () => {
    const impl = respond(ROW);
    const { result } = renderHook(() => usePosts(impl), { wrapper: ContentWrapper });
    await waitFor(() => expect(result.current.status).toBe('loaded'));
    expect(result.current.posts.map((post) => post.slug)).toEqual(['a-post-only-in-the-database']);
  });

  // A database problem costs freshness, never availability -- the same
  // guarantee worker/published.ts's snapshot fallback makes one layer down.
  it('keeps the committed posts and reports an error when the fetch fails', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    const { result } = renderHook(() => usePosts(impl), { wrapper: ContentWrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.posts.map((post) => post.slug)).toEqual(committed.map((post) => post.slug));
  });

  // A refused body is not an outage: fetchPosts returns null for a shape it
  // will not vouch for, and null means "keep what you have" -- which is
  // `loaded`, not `error`, because there is nothing wrong with the network and
  // nothing for a reader to retry.
  it('keeps the committed posts and settles as loaded when the body is refused', async () => {
    const impl = respond({ posts: [] });
    const { result } = renderHook(() => usePosts(impl), { wrapper: ContentWrapper });
    await waitFor(() => expect(result.current.status).toBe('loaded'));
    expect(result.current.posts.map((post) => post.slug)).toEqual(committed.map((post) => post.slug));
  });
});
```

> `ContentWrapper` mounts a `ContentProvider` around the hook with the real committed bundle; copy it from whichever existing test in `src/components/blog/__tests__/` already wraps a component in one. `renderHook` comes from `@testing-library/react`, which this project already uses at v18-compatible versions — **if `renderHook` is not available, render a tiny probe component that writes `state` to a `data-*` attribute and read that instead.** Do not skip the pending-state assertion; it is the whole point of the task.

- [ ] **Step 2: Write `posts-api.ts` and `use-posts.ts`**

```ts
// The public read for posts, Phase 5B. GET /api/published?path=posts.json.
//
// Split out of the components for the reason awards-api.ts and story-api.ts
// already are: eslint's react-refresh/only-export-components flags a .tsx
// that exports both a component and plain values.
//
// THE SHAPE CHECK IS THE REAL GUARD, not a hand-rolled copy of it. This body
// arrives from a database with no build-time guard in front of it, and
// assertPosts (src/content/guards.ts) is exactly the check the BUILD already
// trusts for the same document -- including, since Task 2, the card image's
// own asset-path check, and including every block's `src` and every
// citation's `url`. story-api.ts re-implemented isUnsafeAssetPath by hand
// because src/content/validate.ts is the Worker's module and does not export
// it; guards.ts has no such problem, it holds no React, and src/content/index.ts
// already pulls it into this bundle. Reusing it means there is one answer to
// "what is a valid post", not two that can drift.
//
// It THROWS, so it is wrapped: a refused body returns null, meaning "keep
// whatever you already have", which is the same posture fetchStory takes and
// for the same reason -- a malformed award is one missing card, and a
// malformed post list is the whole blog.
import { assertPosts } from '../../content/guards';
import type { Post } from '../../content/types';

export const POSTS_ENDPOINT = '/api/published?path=posts.json';

// `fetchImpl` is injected with a default, the same posture fetchAwards,
// fetchStory and requestPublish already take -- what lets a test hand this a
// fake without stubbing the global.
export async function fetchPosts(fetchImpl: typeof fetch = fetch): Promise<Post[] | null> {
  const response = await fetchImpl(POSTS_ENDPOINT);
  if (!response.ok) throw new Error(`the blog is unavailable (status ${response.status})`);
  const parsed: unknown = await response.json();
  try {
    return assertPosts(parsed);
  } catch {
    // Deliberately swallowed rather than rethrown, and the distinction
    // matters to the caller: a non-2xx above is an OUTAGE, which a reader
    // could retry; a body this guard refuses is bad DATA, which retrying
    // cannot fix. `null` is what tells usePosts to settle rather than to
    // report a problem.
    return null;
  }
}
```

```ts
// The blog's runtime read, in one place, so /blog, /blog/:slug and the
// homepage section cannot disagree about what the current posts are.
//
// FALLBACK-THEN-SWAP, Phase 4's shape: the compiled-in copy paints first --
// it is what a crawler, a reader with JS off and every first paint see -- and
// the database copy replaces it when it arrives. `status` is what the callers
// that need to tell "not here" from "not here YET" branch on, and it exists
// because a post published after the last deploy is genuinely absent from the
// compiled-in list. story.json never had that problem: it always had content.
import { useEffect, useState } from 'react';
import { useContent } from '../../content/ContentContext';
import { fetchPosts } from './posts-api';
import type { Post } from '../../content/types';

export interface PostsState {
  // 'loading' while the fetch is in flight -- so a slug missing from `posts`
  // is "not here YET", never "not here". 'error' means the read failed and
  // `posts` is the compiled-in copy: a database problem costs freshness,
  // never availability. 'loaded' means this is the current answer, whether it
  // came from the database or -- when the body was refused -- from the
  // compiled-in copy, because neither is going to change by waiting.
  status: 'loading' | 'loaded' | 'error';
  // Never empty while the committed file has content, at any status. A
  // caller that reads this can always render something.
  posts: Post[];
}

export function usePosts(fetchImpl: typeof fetch = fetch): PostsState {
  const { posts: committed } = useContent();
  const [state, setState] = useState<PostsState>({ status: 'loading', posts: committed });

  useEffect(() => {
    let cancelled = false;
    fetchPosts(fetchImpl)
      .then((fetched) => {
        if (cancelled) return;
        setState({ status: 'loaded', posts: fetched ?? committed });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error', posts: committed });
      });
    return () => {
      cancelled = true;
    };
    // `committed` is the compiled-in array and is referentially stable for
    // the life of the bundle, so it is not a real dependency; listing it
    // would re-run this on every ContentProvider re-render, which /edit does
    // on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchImpl]);

  return state;
}
```

- [ ] **Step 3: The three states on `/blog/:slug`**

In `src/components/blog/PostPage.tsx`, replace `const { posts, site } = useContent();` with:

```tsx
  const { site } = useContent();
  // The third state, and the reason it exists: a post published since the
  // last deploy is in the database and NOT in the compiled-in list, so
  // "postBySlug found nothing" means "not here YET" until the fetch settles.
  // Rendering NotFound before then would flash a 404 at a reader who followed
  // a link the owner had just given them -- and a crawler that samples the
  // first paint would record it.
  const { status, posts } = usePosts();
```

and replace the early return:

```tsx
  // Order matters: `post` first, so a post that IS in the compiled-in copy
  // renders immediately at first paint and never shows this screen at all.
  if (!post && status === 'loading') {
    return (
      <div className="min-h-screen bg-white">
        <NavBar offHomePage />
        <div className="max-w-3xl mx-auto px-4 py-20">
          <p className={`font-['Open_Sans'] text-gray-600`}>Loading this post…</p>
        </div>
        <Footer />
      </div>
    );
  }

  // A post that does not exist and a URL that does not exist are the same
  // thing to a visitor and to a crawler -- the same decision App.tsx's
  // PageRoute already made for a disabled page. Reached only once the fetch
  // has SETTLED, which is the whole difference this task makes.
  if (!post) return <NotFound />;
```

`useCanonical` is already called unconditionally above the early returns with a `null` opt-out, so the hook order stays stable through the new branch. **Confirm that by reading the file rather than trusting this sentence** — a conditional hook is an eslint `react-hooks/rules-of-hooks` failure, which is the correct place for it to be caught.

In `src/components/blog/BlogIndex.tsx`, replace `const { posts, copy, site, renderText } = useContent();` with:

```tsx
  const { copy, site, renderText } = useContent();
  // No loading screen here, deliberately. The index has content to paint at
  // first paint -- the compiled-in list -- so a spinner would replace real
  // cards with nothing for the length of one fetch. `status` is unused on
  // this route and that is the honest answer for it.
  const { posts } = usePosts();
```

- [ ] **Step 4: Extend the route tests**

Append to `src/components/blog/__tests__/PostPage.test.tsx`:

```tsx
// THE defect this task exists to prevent, and the test that would have caught
// it: a post that lives only in the database must not flash NotFound.
describe('a post that is only in the database', () => {
  const D1_ONLY: Post[] = [
    {
      id: 'from-d1',
      slug: 'a-post-only-in-the-database',
      type: 'story',
      title: 'A post only in the database',
      date: '2026-05-06',
      excerpt: 'A database excerpt.',
      image: '/food/tielle.webp',
      blocks: [{ kind: 'paragraph', text: 'A database paragraph.' }],
    },
  ];

  it('shows a loading line while the fetch is pending, NOT NotFound', () => {
    const { promise } = deferred();
    stubFetch(() => promise);
    renderAt('/blog/a-post-only-in-the-database');
    expect(screen.getByText('Loading this post…')).toBeInTheDocument();
    // NotFound's own copy, matched the way NotFound.test.tsx matches it, not
    // a bare heading query -- a review found two tests named "redirects to
    // /blog" that asserted only that something rendered.
    expect(screen.queryByText(NOT_FOUND_HEADING)).toBeNull();
  });

  it('renders the post once the fetch lands', async () => {
    stubFetchResolving(D1_ONLY);
    renderAt('/blog/a-post-only-in-the-database');
    expect(await screen.findByRole('heading', { level: 1, name: 'A post only in the database' })).toBeInTheDocument();
    expect(screen.getByText('A database paragraph.')).toBeInTheDocument();
  });

  it('renders NotFound only after the fetch settles, for a slug nothing has', async () => {
    stubFetchResolving(D1_ONLY);
    renderAt('/blog/no-such-post');
    expect(screen.getByText('Loading this post…')).toBeInTheDocument();
    expect(await screen.findByText(NOT_FOUND_HEADING)).toBeInTheDocument();
    expect(screen.queryByText('Loading this post…')).toBeNull();
  });

  it('a committed post never shows the loading line at all', () => {
    const { promise } = deferred();
    stubFetch(() => promise);
    renderAt(`/blog/${committed[0].slug}`);
    expect(screen.queryByText('Loading this post…')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: committed[0].title })).toBeInTheDocument();
  });

  it('a failed fetch still renders the committed post, and never NotFound', async () => {
    stubFetchRejecting();
    renderAt(`/blog/${committed[0].slug}`);
    expect(await screen.findByRole('heading', { level: 1, name: committed[0].title })).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_HEADING)).toBeNull();
  });
});
```

> `NOT_FOUND_HEADING` is the literal string `NotFound.tsx` renders — read it off that component and write the literal, never import a constant from the thing under test. Phase 4's thirteenth unfalsifiable test compared a response against the value under test and corrupting that value left 2837 tests green.
>
> `stubFetch`, `stubFetchResolving`, `stubFetchRejecting`, `deferred` and `renderAt` are this file's own helpers; the file already has a render helper, so extend it rather than adding a second.

Append to `src/components/blog/__tests__/BlogIndex.test.tsx`:

```tsx
  it('paints the committed cards immediately and swaps in the database ones', async () => {
    stubFetchResolving(D1_ONLY);
    renderAt('/blog');
    // Committed content first -- no spinner, because the index has something
    // real to show.
    expect(screen.getByRole('heading', { level: 3, name: committed[0].title })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 3, name: 'A post only in the database' })).toBeInTheDocument();
    // Scoped to `article h3`: Footer.tsx renders an <h3> on every page, so a
    // bare level-3 query counts the footer too. That was the fifteenth
    // mis-asserting test in this project and the first where the pollution
    // came from a component the test never mentions.
    expect(document.querySelectorAll('article h3')).toHaveLength(D1_ONLY.length);
  });
```

- [ ] **Step 5: The Worker's two allowlist entries**

`worker/store.ts`, in `D1_ONLY_PATHS`:

```ts
  // Phase 5B. The same case story.json is, one document later: the file still
  // EXISTS in this repository and is still compiled into the bundle. It is no
  // longer what the site writes to -- it is the first-paint fallback
  // BlogIndex.tsx and PostPage.tsx render before their runtime fetch resolves
  // (use-posts.ts), what a crawler and a reader with JS off see, and the ONLY
  // thing keeping every post's card image and every image/gallery block's src
  // inside src/content/__tests__/assets.test.ts's walk, which cannot see D1 at
  // all. That last one is why this document could not have gone to D1 in 5A:
  // the fields most likely to break would have been entirely unguarded.
  //
  // scripts/sync-posts-fallback.mjs is what keeps the compiled-in copy from
  // drifting away from the row. It is run by a human before a deploy that
  // matters, not by the build -- see its own header for why.
  'src/content/posts.json',
```

`worker/published.ts`, in `PUBLIC_FILES`:

```ts
  // Phase 5B. Like story.json and unlike awards.json, this document's body is
  // the entire visible content of two routes rather than a list beside chrome
  // that renders without it -- so both surfaces paint the compiled-in copy
  // first and swap this one in when it arrives, instead of rendering nothing
  // until it does.
  ['posts.json', 'src/content/posts.json'],
```

**That is the whole Worker diff.** No new route, no new handler, no migration: `handlePublished` is generic over `PUBLIC_FILES` and `storeFor` is generic over `D1_ONLY_PATHS`, and the version-keyed cache, the ETag, the snapshot fallback and the 503-vs-404 branches all come for free. Run the Worker's own suite to prove the seam holds rather than assuming it:

```
npx vitest run worker/__tests__/
```

- [ ] **Step 6: The seed script**

Create `scripts/seed-posts-d1.mjs`. **Copy the entire preamble of `scripts/seed-story-d1.mjs` verbatim** — the `getPlatformProxy` comment block, the temp-directory `wrangler.toml` patching with `remote = true` on the DB binding only, and the `finally` that deletes it. That machinery was arrived at by reading wrangler's own `cli.js` and getting two documented things wrong first; retyping it from memory is how those two mistakes come back. Change only:

```js
const PATH = 'src/content/posts.json';
```

and the body it writes:

```js
// The committed file, byte for byte, so the very first read after the flip
// returns exactly what the build was already serving. Through the real
// D1Store rather than raw SQL, and that is the point: the row has to carry
// the same sha (SHA-256 of the exact body text) and the same version the
// Worker's own write path would produce, or the first publish after the flip
// gets a 409 it can never clear.
const body = readFileSync(PATH, 'utf8');
```

and its refusal guard, which is this script's own and is not in the story one:

```js
// Refuses to seed a body the BUILD would reject. assertPosts runs at import
// time, so a bad row that later comes back through
// scripts/sync-posts-fallback.mjs breaks `tsc -b` and blocks every subsequent
// deploy -- including the one that would fix it. Checking here as well as
// there costs nothing and closes the loop at both ends.
//
// Imported from the real guard rather than reimplemented: it is the same
// check src/content/index.ts already applies to this exact file.
const { assertPosts } = await import('../src/content/guards.ts');
assertPosts(JSON.parse(body));
```

> `import('../src/content/guards.ts')` from a `.mjs` needs the same `tsx` runner the story seed already needs (`worker/d1.ts` uses a TypeScript parameter property, which Node's strip-only mode refuses). The script's header already says `npx tsx scripts/seed-posts-d1.mjs`; keep that line and change the filename.

Then run it, **once**, against the live database:

```bash
npx tsx scripts/seed-posts-d1.mjs
```

Expected: it writes one row and prints the path. **Run it a second time and confirm it refuses** — the story seed reads the row before writing and exits 1 rather than overwriting or duplicating, and this one must too.

- [ ] **Step 7: The sync script and its test**

Create `scripts/sync-posts-fallback.mjs`. Same shape as `sync-story-fallback.mjs`, with a shape check that is this document's own:

```js
// Writes the LIVE D1 copy of the blog back into the committed
// src/content/posts.json.
//
// Why that file still exists after this phase moved the document to D1, and
// why it must not be allowed to rot:
//   - it is what BlogIndex.tsx and PostPage.tsx paint at first paint, before
//     their runtime fetch resolves, and what a crawler or a reader with JS
//     off sees;
//   - it is the ONLY thing keeping every post's card image and every image
//     and gallery block's src inside src/content/__tests__/assets.test.ts's
//     walk, which cannot see D1;
//   - plugins/sitemap.ts reads it at build time, so a post published between
//     deploys is absent from sitemap.xml until this runs and the site is
//     rebuilt;
//   - src/content/__tests__/shape.test.ts pins the three migrated mentions
//     against it, which is what makes a fourth post appearing without the
//     owner's decision on the nine unmigrated press entries fail the build.
//
// Run by a human before a deploy that matters, alongside
// scripts/build-snapshot.mjs:
//   node scripts/sync-posts-fallback.mjs
//
// NOT a build step, for the reason build-snapshot.mjs is not: an
// authenticated network call on Cloudflare Pages' build path means a
// transient failure fails a deploy of unrelated code.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DB = 'via-bianca-content';
const PATH = 'src/content/posts.json';

// Exported so scripts/__tests__/sync-posts-fallback.test.mjs can exercise the
// part that can actually go wrong without a network call.
//
// It refuses rather than writing anything it is unsure about, and the guard it
// delegates to is the REAL one: assertPosts (src/content/guards.ts) is what
// src/content/index.ts already applies to this exact file at import time, so
// anything it refuses would break `tsc -b` and block every subsequent deploy
// -- including the one that would fix it. sync-story-fallback.mjs hand-rolled
// its checks because validateStory lives in the Worker's module and is not
// exported; there is no such obstacle here, and one implementation cannot
// drift from itself.
//
// What this is actually defending against, stated precisely because the story
// script's own comment records getting this wrong once: NOT a publish through
// /edit, which handlePublish already validates with validateContent before
// anything reaches D1. It is the write paths that never reach handlePublish --
// scripts/seed-posts-d1.mjs, and a `wrangler d1 execute UPDATE` run by hand.
export async function postsFileFromRow(row) {
  if (!row || typeof row.body !== 'string') {
    throw new Error(`no row for ${PATH} in D1 -- refusing to write an empty fallback`);
  }
  const parsed = JSON.parse(row.body);
  const { assertPosts } = await import('../src/content/guards.ts');
  // Throws with the guard's own message, which names the post and the field.
  assertPosts(parsed);
  // Reformatted rather than written verbatim: the stored body is exactly what
  // the dashboard sent, which is minified, and a minified
  // src/content/posts.json would produce an unreadable diff on every sync. The
  // D1 row keeps the byte-exact text; this file is the human-readable mirror.
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

// import.meta.filename, not import.meta.url: the latter is percent-encoded
// (spaces become %20) and would silently never match process.argv[1] on a
// checkout path containing a space. scripts/images.mjs documents this at
// length; this copies the working form.
if (import.meta.filename === process.argv[1]) {
  const raw = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB, '--remote', '--json',
    '--command', `SELECT body FROM content WHERE path='${PATH}'`,
  ], { encoding: 'utf8' });
  const row = JSON.parse(raw)[0]?.results?.[0];
  writeFileSync(PATH, await postsFileFromRow(row));
  console.log(`${PATH} synced from live D1`);
}
```

`scripts/__tests__/sync-posts-fallback.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { postsFileFromRow } from '../sync-posts-fallback.mjs';

const VALID = [
  {
    id: 'from-d1',
    slug: 'a-post-only-in-the-database',
    type: 'story',
    title: 'A post only in the database',
    date: '2026-05-06',
    excerpt: 'A database excerpt.',
    image: '/press/hotelier.webp',
    blocks: [{ kind: 'paragraph', text: 'A database paragraph.' }],
  },
];

describe('postsFileFromRow', () => {
  it('writes the row, reformatted, with a trailing newline', async () => {
    const out = await postsFileFromRow({ body: JSON.stringify(VALID) });
    expect(out).toBe(`${JSON.stringify(VALID, null, 2)}\n`);
    expect(JSON.parse(out)[0].slug).toBe('a-post-only-in-the-database');
  });

  it.each([
    ['no row at all', undefined],
    ['a row with no body', {}],
    ['a body that is not a string', { body: 42 }],
  ])('refuses %s', async (_name, row) => {
    await expect(postsFileFromRow(row)).rejects.toThrow(/refusing to write an empty fallback/);
  });

  // Every one of these would break `tsc -b` at import time if it were
  // written, blocking the deploy that would fix it. The messages come from
  // assertPosts, which is the same guard the build applies -- so there is one
  // definition of a valid post, not two that can drift.
  it.each([
    ['a body that is not a list', { posts: [] }],
    ['a post with no title', [{ ...VALID[0], title: '' }]],
    ['an off-site card image', [{ ...VALID[0], image: 'https://evil.example/x.webp' }]],
    ['a backslash card image', [{ ...VALID[0], image: '/\\evil.example/x.webp' }]],
    ['an unknown block kind', [{ ...VALID[0], blocks: [{ kind: 'video', src: '/x.mp4' }] }]],
    ['a duplicate slug', [VALID[0], { ...VALID[0], id: 'other' }]],
  ])('refuses %s', async (_name, body) => {
    await expect(postsFileFromRow({ body: JSON.stringify(body) })).rejects.toThrow();
  });

  it('refuses a body that is not JSON at all', async () => {
    await expect(postsFileFromRow({ body: 'not json' })).rejects.toThrow();
  });
});
```

- [ ] **Step 8: Regenerate the snapshot, and check the two pins that read the committed file**

```bash
node scripts/build-snapshot.mjs
git diff worker/snapshot.ts
```

Expected: one added `"posts.json"` entry carrying the committed body and its D1 `version`, and `SNAPSHOT_BUILT_AT` moved. **Read the diff** — this file is generated and never hand-edited, and the one thing worth confirming is that `awards.json` and `story.json`'s bodies are unchanged.

Then re-check the two tests that read the committed file, because this task changed what that file *is for*:

```
npx vitest run src/content/__tests__/shape.test.ts src/content/__tests__/assets.test.ts plugins/__tests__/sitemap.test.ts
```

Both must still pass **and still have power to fail.** Phase 3's tenth unfalsifiable test was created by a legitimate content edit, not a bad test. `shape.test.ts`'s "is the three real press mentions" pin now guards the **fallback** rather than the live copy — **that is a real narrowing and it must be recorded in the runbook rather than left implicit**: a fourth post published through the editor is live immediately and does not fail the build; it fails the build only after `sync-posts-fallback.mjs` is run. Task 12 Step 7 writes that down. **Do not weaken the pin to accommodate it** — the pin still does its job for the committed artefact, which is what it was always about.

- [ ] **Step 9: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | In `PostPage`, delete the `!post && status === 'loading'` branch | **the mutation this task exists for.** `shows a loading line while the fetch is pending, NOT NotFound` and `renders NotFound only after the fetch settles` |
| 2 | In `PostPage`, reverse the branch order (`if (!post) return <NotFound />` first) | same two cases. **Run both mutations** — they are different defects (no loading state at all, versus a loading state that is unreachable) and a table with only one of them is half a table |
| 3 | In `usePosts`, initialise with `{ status: 'loading', posts: [] }` | `paints the committed posts while the fetch is pending` and `a committed post never shows the loading line at all`. **The second is the one that matters**: with an empty initial list, every existing post flashes a loading screen on every page load |
| 4 | In `usePosts`, set `status: 'loaded'` in the initial state | `paints the committed posts while the fetch is pending, and says it is loading` — and the real defect is the `NotFound` flash returning |
| 5 | In `usePosts`'s `.catch`, set `posts: []` | `keeps the committed posts and reports an error when the fetch fails` and `a failed fetch still renders the committed post, and never NotFound`. **A database outage would blank the blog**, which is the availability guarantee this whole design is for |
| 6 | In `usePosts`, treat a `null` from `fetchPosts` as an error | `keeps the committed posts and settles as loaded when the body is refused` |
| 7 | In `fetchPosts`, `return parsed as Post[]` (drop the `assertPosts` call) | **all eight** `returns null for ...` cases. Run it and count: fewer than eight means one of the rows is not reaching the guard, and the two image rows are the ones to check, because they only redden thanks to Task 2 |
| 8 | In `fetchPosts`, rethrow instead of returning null | the eight refusal cases fail with a rejection rather than `null`, and `keeps the committed posts and settles as loaded when the body is refused` fails. **This is the outage-versus-bad-data distinction, and it is a real product difference**: bad data must not put an error in front of a reader who can do nothing about it |
| 9 | Remove `'src/content/posts.json'` from `D1_ONLY_PATHS` | `worker/__tests__/` — read which case reddens. **If nothing does, that is a finding**, not a pass: it would mean the Worker suite has no coverage of the store routing for a newly added path, and the fix is a case in `worker/__tests__/store.test.ts` (or wherever `partitionByStore`/`storeFor` is tested) asserting `storeFor(env, 'src/content/posts.json').name === 'd1'` regardless of `CONTENT_STORE` |
| 10 | Remove `['posts.json', ...]` from `PUBLIC_FILES` | `worker/__tests__/published.test.ts` if it has a `PUBLIC_FILES` sweep; if not, add a case asserting `GET /api/published?path=posts.json` is not a 404. **Same finding-not-a-pass rule as row 9** |
| 11 | In `postsFileFromRow`, drop the `assertPosts` call | all six shape-refusal rows and `refuses a body that is not JSON at all` |
| 12 | In `postsFileFromRow`, return `row.body` unchanged | `writes the row, reformatted, with a trailing newline` |
| 13 | In `seed-posts-d1.mjs`, remove the read-before-write refusal | run it a second time against the live database and confirm it now writes a duplicate. **Then restore the guard and check the row count.** This is the only mutation in this plan that touches production data; if that is not acceptable, skip it and say so rather than reporting it as verified |

- [ ] **Step 10: Gate, then commit**

```bash
git add src/components/blog worker scripts src/content
npm run gate
```

Expected: exit 0, entry CSS **38641 bytes** against the **38800** ceiling — the loading line's classes (`font-['Open_Sans']`, `text-gray-600`, `max-w-3xl`, `mx-auto`, `px-4`, `py-20`, `min-h-screen`, `bg-white`) all already ship. **Run the rule-level diff anyway** and expect `ADDED: []`.

```bash
git commit -m "feat(blog): the live posts come from D1, with a loading state that is not a 404

Phase 4's fallback-then-swap, one document later: the committed file stays as
the first paint, as what a crawler and a reader with JS off see, and as the
only thing keeping every post image inside the asset walk, which cannot see
the database at all. Two allowlist entries and no new Worker code -- the
version-keyed cache, the ETag, the snapshot fallback and the 503-vs-404
branches all already existed.

The defect this had to plan against, and the one difference from story.json:
a post published since the last deploy is genuinely absent from the
compiled-in list, so /blog/:slug needs a third state. Loading is distinct
from not-found, NotFound is reached only once the fetch has settled, and a
post that IS committed never shows the loading line at all.

The shape check is the real guard rather than a hand-rolled copy. This body
arrives from a database with nothing in front of it, and assertPosts is the
same check the build already applies to the same document -- including the
card image's own asset-path check, every block src and every citation link.
A refused body means keep what you have, which is not the same as an outage:
retrying cannot fix bad data, so it must not put an error in front of a
reader.

PUSHING THIS WITHOUT npx wrangler deploy SHIPS THE READ PATH INERT."
```

---

### Task 10: the stale draft, the cannot-get-stuck proof, and the query-cost pattern

**Phase 4 shipped a panel that crashed the whole About section on a draft saved before the feature existed, and the crash took the section heading with it because `SectionErrorBoundary` wraps that too.** This task is the proof that 5B did not repeat it. The standard, stated as the deliverable: a test that restores a genuine pre-5B draft, confirms no crash, confirms every problem lands on its own field, and confirms filling them in lets her publish.

**It also carries the second item 5A handed forward.** Two to four `AdminApp.test.tsx` cases redden under heavy CPU load, at 5A's commit and at its parent alike, by the same mechanism that failed a Cloudflare build: a `findBy*` role-and-name sweep over the manage shell re-runs every 50ms, two thirds of the cost jsdom `getComputedStyle`, starving the render it polls for. **5B has made that shell bigger.** So every case added here uses the cheap-attribute-then-assert-once pattern, and this task also converts the two or three worst existing offenders — **without raising a single timeout.**

**Files:**
- Modify: `src/admin/__tests__/AdminApp.test.tsx` (the stale-draft cases, and the query-cost conversions)
- Modify: `src/admin/blocks/__tests__/BlockList.test.tsx` (the staged-photo-after-reorder case)
- Test only. **No source file changes are expected in this task.** Every defence it exercises was written in Tasks 4-7 with its own mutation. **If this task has to change a source file, that is a defect Tasks 4-7 shipped and the report must say which one and why the earlier mutation missed it.**

**Interfaces:**
- Consumes: everything Tasks 3-9 built.
- Produces: nothing. This is a proof task.

- [ ] **Step 1: Write the pre-5B stale-draft test**

Append to `src/admin/__tests__/AdminApp.test.tsx`. **Read the file's existing draft cases first and reuse their harness** — `DRAFT_STORAGE_KEY`, `stubFetch` and `renderDashboard` all already exist there, and a second harness would diverge.

```tsx
// The Phase 4 defect, tested rather than asserted. A draft saved before this
// feature existed restores through registerLoaded's unchecked
// `draftEntry.data as ContentTypeMap[K]` cast (sections/register-loaded.ts),
// so the shapes below are what the dashboard genuinely gets handed -- not
// hypotheticals. The only error boundary between a panel and the page is
// per-SECTION, so an unguarded read does not leave her one broken field: it
// takes the heading down with the panel, and she cannot even find the thing
// that is wrong.
describe('a draft saved before the block editor existed', () => {
  // Three genuinely different pre-5B shapes, and none of them uses a
  // present-but-empty stand-in for an absent key -- `blocks: []` is a
  // DIFFERENT state from no `blocks` key, and this project has twice made the
  // mistake of testing absence with emptiness.
  const NO_POSTS_ENTRY = {
    'dishes.json': { data: DISHES, savedAt: Date.now() },
  };
  const POST_WITH_NO_BLOCKS_KEY = {
    'posts.json': {
      data: [{ id: 'stale-1', slug: 'a-stale-post', type: 'story', title: 'A stale post', date: '2026-01-02', excerpt: 'A stale excerpt.', image: '/press/hotelier.webp' }],
      savedAt: Date.now(),
    },
  };
  const BLOCK_WITH_NO_TEXT_KEY = {
    'posts.json': {
      data: [{ id: 'stale-2', slug: 'another-stale-post', type: 'story', title: 'Another stale post', date: '2026-01-02', excerpt: 'A stale excerpt.', image: '/press/hotelier.webp', blocks: [{ kind: 'paragraph' }] }],
      savedAt: Date.now(),
    },
  };

  it.each([
    ['a draft with no posts.json entry at all', NO_POSTS_ENTRY],
    ['a post with no blocks key', POST_WITH_NO_BLOCKS_KEY],
    ['a paragraph block with no text key', BLOCK_WITH_NO_TEXT_KEY],
  ])('%s restores without taking the panel down', async (_name, draft) => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/story');

    await user.click(await screen.findByRole('button', { name: /^Restore/ }));

    // Cheap wait, then the expensive assertion ONCE. A findByRole with a name
    // filter polls a getComputedStyle sweep over the whole shell every 50ms
    // and starves the render it is waiting for; that is what failed a
    // Cloudflare build, and this file is where two to four cases still tip
    // under load.
    await waitFor(() => {
      expect(document.querySelector('[data-panel="posts"]')).not.toBeNull();
    });
    // The heading survives. That is the whole Phase 4 lesson in one
    // assertion: the crash there took the heading, so she could not find the
    // section that was broken.
    expect(screen.getByRole('heading', { name: PANELS.posts.heading })).toBeInTheDocument();
    // And the panel body is really there, not replaced by the boundary's
    // fallback -- SectionErrorBoundary renders its own message, so asserting
    // the heading alone would pass on a caught crash.
    expect(document.getElementById('section-panel-posts')).not.toBeNull();
    expect(screen.queryByText(SECTION_ERROR_BOUNDARY_MESSAGE)).toBeNull();
  });

  it('every problem in a stale post lands on its own field, never as one banner', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(BLOCK_WITH_NO_TEXT_KEY));
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/story');
    await user.click(await screen.findByRole('button', { name: /^Restore/ }));
    await waitFor(() => {
      expect(document.querySelector('[data-panel="posts"]')).not.toBeNull();
    });
    const panel = document.getElementById('section-panel-posts')!;
    await user.click(within(panel).getByRole('button', { name: PANELS.posts.heading }));

    // The block's own field carries the block's own problem, by
    // aria-describedby -- the association she actually depends on, not merely
    // the message being somewhere on the page.
    const box = await within(panel).findByLabelText('Words');
    const describedBy = box.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!.split(' ').pop()!)).toHaveTextContent(/needs some words/);
  });

  it('filling in what is missing lets her publish', async () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(BLOCK_WITH_NO_TEXT_KEY));
    stubFetch();
    const user = userEvent.setup();
    renderDashboard('/edit/manage/story');
    await user.click(await screen.findByRole('button', { name: /^Restore/ }));
    await waitFor(() => {
      expect(document.querySelector('[data-panel="posts"]')).not.toBeNull();
    });
    const panel = document.getElementById('section-panel-posts')!;
    await user.click(within(panel).getByRole('button', { name: PANELS.posts.heading }));

    await user.type(await within(panel).findByLabelText('Words'), 'A real paragraph.');

    // The publish path is what "she could not get stuck" actually means: not
    // that the screen rendered, but that the work can leave the browser. The
    // validation debounce is 400ms, so this waits for the problem to CLEAR
    // rather than for a fixed time.
    await waitFor(
      () => {
        expect(within(panel).queryByText(/needs some words/)).toBeNull();
      },
      { timeout: 2000 },
    );
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });
});
```

> `SECTION_ERROR_BOUNDARY_MESSAGE` is the literal string `SectionErrorBoundary.tsx` renders — read it off that component and write the literal. **The `{ timeout: 2000 }` on the last `waitFor` is a wait for a debounce that is genuinely 400ms, not a raised timeout on a slow query.** That distinction is the one this project's standing rule is about: the rule forbids lengthening a wait to hide a cost, not waiting for something that genuinely takes time. The query inside it is a `queryByText` over one panel, which is cheap.

- [ ] **Step 2: The staged-photo-after-reorder case**

Task 5 recorded this and deferred it here: `onStaged`'s key is `blocks[<index>].src`, so reordering blocks after staging a photo and before publishing would mis-attribute it. Append to `src/admin/blocks/__tests__/BlockList.test.tsx`:

```tsx
// The one thing about a positional block key that is NOT free. A block's
// identity is its position -- moving one is exactly what Up/Down and the drag
// handle do -- but a STAGED PHOTO inside a block is keyed by that position, so
// reordering after staging and before publishing would send the bytes to the
// wrong block's field.
//
// This test pins the CURRENT behaviour rather than asserting a fix, and says
// so: the key reported after a reorder is the block's NEW index. That is
// correct as long as the staged collector is re-keyed too, which
// staged.ts does not do -- so the honest statement is that staging a photo and
// then reordering before publishing is a known gap, recorded in the runbook,
// with the workaround being to publish before reordering. A test that claimed
// otherwise would be the ninth incomplete claim in this project.
it('reports a staged photo under the block’s current index', async () => {
  const user = userEvent.setup();
  const onStaged = vi.fn();
  const { onChange } = renderList({
    blocks: [
      { kind: 'paragraph', text: 'First' },
      { kind: 'image', src: '', alt: '' },
    ],
    onStaged,
  });
  await user.click(screen.getByRole('button', { name: 'Move Paragraph block 1 down' }));
  expect(onChange).toHaveBeenCalledWith([
    { kind: 'image', src: '', alt: '' },
    { kind: 'paragraph', text: 'First' },
  ]);
  // Re-render in the new order, then stage: the key must name index 0, which
  // is where the image block now is.
  renderList({
    blocks: [
      { kind: 'image', src: '', alt: '' },
      { kind: 'paragraph', text: 'First' },
    ],
    onStaged,
  });
  // Drive PhotoField's own file input the way PhotoField.test.tsx does; copy
  // that call site rather than inventing one, because the component does HEIC
  // conversion and object-URL bookkeeping on the way.
  // ... then:
  expect(onStaged).toHaveBeenCalledWith('blocks[0].src', expect.anything());
});
```

> **This case is written as a pin on current behaviour with the gap stated, not as a fix.** Re-keying the staged collector on reorder means reaching into `staged.ts`'s shared map from `BlockList`, which is a cross-cutting change to a module every panel shares, on the last task before a deploy. **The decision is: record it, put the workaround in the runbook (Task 12 Step 7), and do not attempt the fix in this phase.** If a reviewer disagrees, that is a scoped follow-up with its own plan.

- [ ] **Step 3: Convert the worst existing query-cost offenders — no timeouts raised**

Find them by measurement, not by reading:

```bash
npx vitest run src/admin/__tests__/AdminApp.test.tsx --reporter=verbose 2>&1 | sort -t'(' -k2 -rn | head -20
```

Take the two or three slowest cases that use `findByRole` or `getByLabelText` **over a whole panel or the whole shell** and convert each to: `await waitFor(() => expect(document.querySelector('[data-panel="<id>"]')).not.toBeNull())`, then the same expensive assertion **once**. The file already documents this in its own comments (`fieldBlock`, `photoPickers`, and the note above the Experiences case) — **reuse those helpers where they fit rather than adding a third pattern.**

Record the before and after per case. **Do not touch a timeout, do not add a retry, and do not mark anything flaky.** The precedent: the ManageShell fix took a case from 1/8 failures under 24-burner load to 0/8, median 937ms → 305ms, worst 1645ms → 502ms against an unchanged 1000ms budget.

Then reproduce the load the ledger measured, so the improvement is evidence rather than a hope:

```bash
for i in $(seq 1 24); do (while :; do :; done) & done
for i in 1 2 3 4 5 6 7 8; do npx vitest run src/admin/__tests__/AdminApp.test.tsx 2>&1 | tail -3; done
kill $(jobs -p)
```

Expected: 8/8 green. **If a case still tips, report the number rather than raising its budget** — the honest answer is "2 of 8 under 24 burners, down from 4 of 8", and a Cloudflare build has never hit these cases at all.

- [ ] **Step 4: Run the whole suite and read the counts**

```
npm test -- --run
npm run test:deploy
```

Expected: both green. **They are different commands with different worker distribution and only `test:deploy` runs on Cloudflare** — a failure in one and not the other is a real signal, not noise. Record both counts.

- [ ] **Step 5: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | In `PostList`, `blocksOf` returns `post.blocks` directly | `a post with no blocks key restores without taking the panel down` — and confirm the failure is the `SectionErrorBoundary` message appearing, not just a missing element. **That is the Phase 4 defect reproduced** |
| 2 | In `BlockList`, `const safe = blocks;` | same case. **Both mutations, because there are two independent guards on the same path and either one alone would have shipped the crash** |
| 3 | In `BlockFields`, read `block.text` without `?? ''` | `a paragraph block with no text key restores without taking the panel down` |
| 4 | In `BlockFields`, drop the `problemsFor('text')` argument to the paragraph's `InlineTextField` | `every problem in a stale post lands on its own field, never as one banner` — `aria-describedby` is null |
| 5 | In `BlockList`, route every block problem to the banner instead of to the field | same case, and it is the mutation that distinguishes "the message is on the page" from "the message is on the field she has to fix". A banner-only implementation passes a naive text search |
| 6 | In `useValidation`, raise the debounce to 4000ms | `filling in what is missing lets her publish` times out at its 2000ms wait. **Deliberate**: it proves that wait is a debounce wait and not slack |
| 7 | Remove `data-panel` from `CollapsibleSection` | every case in this task fails at its `waitFor`. **Recorded because it is now load-bearing in three files**, and a later tidy-up of "unused" attributes would break all of them at once |
| 8 | In `SectionErrorBoundary`, change its message string | `restores without taking the panel down` passes vacuously — `queryByText` of the old literal finds nothing either way. **PREDICTED WEAK, and the fix is in this task**: also assert the panel body's own first control is present (`within(panel).getByRole('button', { name: 'Add a post' })`), which a caught crash cannot satisfy. Add it before moving on |

- [ ] **Step 6: Gate, then commit**

```bash
git add src/admin
npm run gate
```

Expected: exit 0, entry CSS **38641 bytes** — this task is tests only, so the byte count must be **byte-identical** to Task 9's. That unchanged number is itself the evidence that no source file moved.

```bash
git commit -m "test(admin): a draft from before the block editor cannot break the panel

Three genuinely different pre-5B shapes, restored through the same unchecked
cast the dashboard really uses: a draft with no posts entry, a post with no
blocks key, and a paragraph with no text key. None of them uses an empty
value to stand in for an absent key -- that substitution is what defeated
this repository's last attempt at the same class of test, twice.

The assertions are what Phase 4's crash actually cost: the heading survives,
the panel body is really there rather than replaced by the boundary's
fallback, every problem is attached to its own field by aria-describedby, and
filling the field in lets the work leave the browser.

Two AdminApp cases converted to wait on a cheap attribute and then assert the
expensive thing once, measured under the same synthetic load that found them.
No timeout raised, nothing retried, nothing marked flaky.

One gap recorded rather than papered over: a photo staged into a block and
then reordered before publishing is keyed by the block's old position. The
test pins the current behaviour and names the workaround instead of claiming
a fix."
```

---

### Task 11: the homepage `press` section becomes the blog

**5A's Task 9, deferred by an explicit ruling and absent from the 5B outline's nine tasks.** The spec says "'Latest Stories' disappears as a separate homepage section" (line 218). Verified at `3025385`: `BlogSection.tsx` does not exist, `SECTION_COMPONENTS.press` is still `() => <BlogTeaser />` in both `src/App.tsx:54` and `src/admin/EditMode.tsx:108`, and `copy.json`'s `nav.links[4]` still reads `{ href: '#blogs', label: 'Stories', section: 'press' }`.

**"Disappears as a separate section" cannot mean deleting the `press` `SectionId`.** That id is load-bearing in seven places: the `SectionId` union (`types.ts:231`), `sections.json`'s pinned nine-entry order (`src/test/section-order.test.ts:11`), `SECTION_COMPONENTS` in both `App.tsx` and `EditMode.tsx`, `Copy['press']`'s four strings plus their `COPY_FIELDS` entries and `fields.test.ts`'s leaf sweep, `copy.json`'s `nav.links[4]`, and the live `#blogs` anchor. **Phase 1's ruling for `ourStory` applies verbatim: rename the display, keep the id.** The anchor stays because it is a live, possibly bookmarked URL. **No tenth `SectionId` is added and `press.json` is not touched** — after this task nothing public reads it, and retiring it is a fourteen-site sweep with a live asset-guard dependency that gets its own plan.

**It comes after Task 9 for one reason:** `BlogSection` must read `usePosts()`, not `useContent().posts`. If it read the compiled-in list while `/blog` read the database, the homepage would show stale posts after every publish and the two surfaces would give two answers about the same content.

**Files:**
- Create: `src/components/blog/BlogSection.tsx`, `src/components/blog/__tests__/BlogSection.test.tsx`
- Modify: `src/App.tsx` (`SECTION_COMPONENTS.press`)
- Modify: `src/admin/EditMode.tsx` (`SECTION_COMPONENTS.press`)
- Modify: `src/content/copy.json` (`nav.links[4].label` — **and nothing else in that file**)
- Modify: `src/test/homepage-bytes.test.tsx` (the byte count and its accounting comment)
- Modify: `src/test/no-dead-backend.test.ts` (`BlogTeaser.tsx` onto `protectedComponents`)
- Re-check: `src/components/__tests__/press.test.tsx`, `src/test/section-order.test.ts`, `src/content/__tests__/sections.test.tsx`, `src/test/crawlers.test.ts`

**Interfaces:**
- Consumes: `usePosts` (Task 9), `PostCard` and `sortedPosts`/`POSTS_PER_PAGE` (5A), `useContent`'s `copy` and `renderText`.
- Produces: `export default function BlogSection()`, mapped behind the `press` `SectionId`.

- [ ] **Step 1: Write the failing test**

`src/components/blog/__tests__/BlogSection.test.tsx`:

```tsx
describe('BlogSection', () => {
  it('keeps the #blogs anchor, because it is a live URL people have linked', () => {
    renderSection();
    expect(document.querySelector('section#blogs')).not.toBeNull();
  });

  it('shows the three newest posts, newest first, and no more', () => {
    renderSection({ posts: SIX_POSTS });
    const titles = [...document.querySelectorAll('article h3')].map((el) => el.textContent);
    expect(titles).toEqual(['Newest', 'Second', 'Third']);
  });

  it('links each card into this site, never out to the publication', () => {
    renderSection({ posts: SIX_POSTS });
    [...document.querySelectorAll('article a')].forEach((anchor) => {
      expect(anchor.getAttribute('href')).toMatch(/^\/blog\/[a-z0-9-]+$/);
    });
  });

  it('offers a way through to the whole blog', () => {
    renderSection({ posts: SIX_POSTS });
    expect(screen.getByRole('link', { name: /all|blog/i })).toHaveAttribute('href', '/blog');
  });

  it('renders its heading and intro from the press copy leaves, unchanged', () => {
    renderSection({ posts: SIX_POSTS });
    expect(screen.getByRole('heading', { level: 2, name: copy.press.heading })).toBeInTheDocument();
    expect(screen.getByText(copy.press.intro)).toBeInTheDocument();
  });

  // A restaurant with no posts yet is the ordinary first state, and this
  // section renders on the homepage regardless of what sections.json says
  // about the others -- so an empty grid under a heading is the shape that
  // reads as broken.
  it('says something honest when there are no posts at all', () => {
    renderSection({ posts: [] });
    expect(document.querySelectorAll('article')).toHaveLength(0);
    expect(screen.getByText(/on its way/i)).toBeInTheDocument();
  });

  it('paints the committed posts while the database fetch is pending', () => {
    const { promise } = deferred();
    renderSection({ fetchImpl: () => promise as Promise<Response> });
    expect(document.querySelectorAll('article').length).toBeGreaterThan(0);
  });
});
```

> `SIX_POSTS` must differ from `src/content/posts.json` in every field asserted on and must have deliberately shuffled dates, so "newest first" is a real claim rather than a restatement of the fixture's array order. Give the three that must be shown the titles `Newest`, `Second`, `Third` and the three that must not `Fourth`, `Fifth`, `Sixth`, with dates that put them in that order but an **array** order that does not.

- [ ] **Step 2: Write `BlogSection.tsx`**

```tsx
// The homepage's blog section, behind the `press` SectionId. Phase 5B, and
// 5A's Task 9 finally landing.
//
// The id stays `press` and the anchor stays `#blogs`, and neither is
// negligence: that id is load-bearing in seven places (the SectionId union,
// sections.json's pinned order, SECTION_COMPONENTS in two files, Copy['press']
// and its COPY_FIELDS leaves, copy.json's nav link, and this anchor), and the
// anchor is a live URL somebody may have bookmarked. Phase 1 made the same
// call for ourStory, which displays as "About" at #our-story: renaming the
// display without renaming the id is this codebase's established pattern, not
// a compromise -- types.ts says so in its own comment about atmosphere
// displaying as "Gallery".
//
// It reads usePosts, NOT useContent().posts, and that is the reason this task
// comes after the D1 move: the compiled-in list is a build-time snapshot, so a
// homepage reading it while /blog read the database would show stale cards
// after every publish -- two surfaces giving two answers about one thing.
//
// PostCard is shared with /blog verbatim, one component and not two: Phase 3's
// final review found two sections shipping as grey 96px thumbnails precisely
// because the same visual idea had two implementations and only one of them
// was ever looked at.
import { Link } from 'react-router-dom';
import { useContent } from '../../content/ContentContext';
import { usePosts } from './use-posts';
import { sortedPosts } from './posts';
import PostCard from './PostCard';

// Three, matching what BlogTeaser showed before it and what a three-across
// grid fills exactly. The full list is one click away.
const HOMEPAGE_POSTS = 3;

export default function BlogSection() {
  const { copy, renderText } = useContent();
  const { posts } = usePosts();
  const shown = sortedPosts(posts).slice(0, HOMEPAGE_POSTS);

  return (
    <section id="blogs" className="py-20 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className={`mb-6 font-['Montserrat'] text-4xl md:text-5xl font-bold text-ink`}>
            {renderText('press.heading', copy.press.heading)}
          </h2>
          <p className={`font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed`}>
            {renderText('press.intro', copy.press.intro)}
          </p>
        </div>

        {shown.length === 0 ? (
          // The same honest empty state BlogIndex renders, word for word, so
          // the two surfaces do not describe one situation two ways.
          <p className={`text-center font-['Open_Sans'] text-gray-600`}>
            Nothing here yet — the first post is on its way.
          </p>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
            {shown.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        )}

        <div className="text-center">
          <Link
            to="/blog"
            className={`inline-block rounded-lg bg-brand px-6 py-3 font-['Montserrat'] text-sm uppercase tracking-wide text-ink transition hover:bg-brand-dark`}
          >
            {renderText('press.viewAll', copy.press.viewAll)}
          </Link>
        </div>
      </div>
    </section>
  );
}
```

> **`copy.press.viewAll` and `copy.press.readArticle` both exist already** (`EditMode.tsx:288` shows all four `press` leaves). Reusing `viewAll` for the through-link means **no `COPY_FIELDS` change and no movement in the pinned literals** (33 fields, 6 excluded, `EDITABLE_TEXT_PATHS` 27). `readArticle` becomes unused by any component — **leave its value in `copy.json` and leave its `COPY_FIELDS` entry alone.** Retiring a leaf moves three pinned counts and a panel snapshot, and it is not what this task is for. **Check what her current `press.viewAll` string actually says** and if it reads as press-specific ("View all press"), that is a one-string edit she can make herself from the dashboard — say so in the report rather than editing her copy.
>
> **Verify `inline-block`, `px-6`, `py-3`, `rounded-lg`, `bg-brand`, `hover:bg-brand-dark` and `text-ink` against the built stylesheet before committing to this markup.** `bg-brand` with `text-ink` is the brand rule honoured (10.9:1, never white on brand at 1.45:1). If any of them is new, lift the exact class string from an existing homepage button — `BlogTeaser.tsx`'s own "view all" control is right there and its rules already ship, which is the zero-cost answer.

- [ ] **Step 3: Swap the component behind the id, and relabel the nav**

`src/App.tsx`, in `SECTION_COMPONENTS`:

```tsx
  // Phase 5B: the section behind the `press` id is the blog now. The ID does
  // not change and the #blogs anchor does not change -- see BlogSection.tsx's
  // own header for the seven places that id is load-bearing, and Phase 1's
  // identical ruling for ourStory.
  press: () => <BlogSection />,
```

`src/admin/EditMode.tsx`, the same one-line change in its own `SECTION_COMPONENTS` — **compiler-forced, because both maps are total over `SectionId`.** Import `BlogSection` in both and remove the now-unused `BlogTeaser` import from both; `npx eslint .` fails on an unused import, which is the correct place for that to be caught.

`src/content/copy.json`, `nav.links[4]`:

```json
    { "href": "#blogs", "label": "Blog", "section": "press" }
```

**The `href` does not change and no other value in this file changes.** `withLeaf` spreads the fetched object rather than rebuilding from `COPY_FIELDS`, so every unlisted leaf survives a publish — which is why the five retired `blogsPage.*` values are still there. Deleting a value would drop it on her next save and break every later build.

`src/test/no-dead-backend.test.ts`, in `protectedComponents`:

```ts
  // Phase 5B: nothing routes to BlogTeaser after the homepage swap, and it
  // stays on disk under the owner's never-delete constraint -- the same
  // treatment NewsPress.tsx already has. The section it used to draw is the
  // blog now; the file is kept because she asked for nothing to be deleted.
  'BlogTeaser.tsx',
```

- [ ] **Step 4: Re-measure the homepage byte count by hand**

```bash
npx vitest run src/test/homepage-bytes.test.tsx
```

Expected: FAIL, with `expected <new> to be 52355`. **Take the number out of the failure message, write it in by hand, and never run `vitest -u`** — Phase 3 caught itself one keystroke from baking a real validation-error banner into a snapshot that way.

Then account for the delta at the rule level rather than attributing it to one cause. **Phase 4's byte-delta comment was found attributing all 490 bytes to one source when it had two.** The sources here are at least three: `BlogTeaser`'s three press cards leaving, `PostCard`'s three post cards arriving, and the through-link's markup differing. Measure each by rendering the homepage with the section swapped and with it not, and diff the innerHTML — do not estimate. Append to that file's comment:

```
// Phase 5B, the homepage press section becomes the blog: 52355 -> <new>
// (<delta>). Three sources, measured separately rather than attributed to
// one, because a prior entry in this comment was found crediting a whole
// delta to one cause when it had two:
//   <n>  BlogTeaser's three press cards, each an external anchor with a
//        publication line and a Read-article label, leaving.
//   <n>  PostCard's three post cards, each an internal <Link> with a type
//        badge and an excerpt, arriving.
//   <n>  the through-link's own markup, which differs from BlogTeaser's.
// The section id, the #blogs anchor and both press copy leaves are unchanged,
// so none of the delta is chrome.
```

- [ ] **Step 5: Re-check what this task made vacuous**

**Phase 3's tenth unfalsifiable test was created by a legitimate content change, not by a bad test**, and the implementer's report said the test was "unaffected" — true of the code and false of its power. This task changes what the homepage renders, so:

```
npx vitest run src/components/__tests__/press.test.tsx src/test/section-order.test.ts src/content/__tests__/sections.test.tsx src/test/crawlers.test.ts src/test/routing.test.tsx src/admin/__tests__/copy-rendered.test.tsx
```

For each: run it, then **mutate the thing it claims to check and confirm it still reddens.** Specifically —
- `press.test.tsx` tests `NewsPress.tsx`, which is on `protectedComponents` and is rendered by nothing. **It was already testing an unrouted component before this task**; confirm that and record it rather than "fixing" it, because the file is protected by the owner's constraint.
- `section-order.test.ts` asserts `sections.json`'s nine ids including `press`. **Unchanged and must stay unchanged** — mutate `sections.json`'s order and confirm it reddens, then revert.
- `copy-rendered.test.tsx:145` renders components to check every editable copy leaf is reachable. `press.readArticle` is now rendered by nothing. **Check whether that file's partition assertion still holds in both directions** — if it derives "editable" from `COPY_FIELDS` and "rendered" from a component sweep, `readArticle` moving out of the second set may break it, and the correct fix is `NOT_EDITABLE_IN_PLACE_COPY_FIELDS` plus the pinned counts, not weakening the assertion. **If that is what happens, report it: it changes the 33/6 literals and is a real scope addition.**

- [ ] **Step 6: Prove the tests can fail**

| # | Mutation | Must redden, with this error |
| --- | --- | --- |
| 1 | In `App.tsx`, map `press` back to `BlogTeaser` | `src/test/homepage-bytes.test.tsx` on the byte count, and `BlogSection.test.tsx` is unaffected (it renders the component directly). **That asymmetry is the finding**: without a homepage test that names the blog cards, the swap itself is pinned only by a byte count. **Add one** to whichever test mounts the real homepage — assert `document.querySelector('section#blogs article a')` has an `href` starting `/blog/` |
| 2 | In `BlogSection`, change `id="blogs"` to `id="blog"` | `keeps the #blogs anchor` — and the real defect is every bookmarked and nav link to `#blogs` silently doing nothing |
| 3 | In `BlogSection`, `slice(0, 6)` | `shows the three newest posts, newest first, and no more` |
| 4 | In `BlogSection`, drop `sortedPosts` and slice the raw array | same case — which is why the fixture's array order deliberately differs from its date order |
| 5 | In `BlogSection`, read `useContent().posts` instead of `usePosts()` | `paints the committed posts while the database fetch is pending` still passes (both paint the same thing), but `shows the three newest posts` fails **only if the fixture reaches the component through the fetch**. **PREDICTED WEAK — fix it**: add a case that resolves the fetch with a post absent from the committed list and asserts its card appears. Without that, the whole reason this task comes after Task 9 is unpinned |
| 6 | In `BlogSection`, drop the empty-state branch | `says something honest when there are no posts at all` |
| 7 | In `BlogSection`, render `copy.press.heading` bare instead of through `renderText` | `copy-rendered.test.tsx` — the leaf stops being editable in place on `/edit`, which is a control she uses today silently going dead. **That is the third sighting of this orphan class in this project and the reason it is a named mutation** |
| 8 | In `copy.json`, revert `nav.links[4].label` to `'Stories'` | whichever test pins the nav labels — find it (`section-order.test.ts` reads `copy.json`) and if nothing pins it, **that is a finding**: add the assertion rather than leaving the rename unpinned |
| 9 | Delete `copy.json`'s `press.readArticle` value | **PREDICTED NOT TO REDDEN**, because `withLeaf` spreads. Recorded as the reason the value stays: the failure it would cause is on her *next publish*, not in any test, and it would break every later build |
| 10 | Remove `'BlogTeaser.tsx'` from `protectedComponents` | `no-dead-backend.test.ts` reports it as dead and fails. **Confirm the direction** — if that test only flags files that are *listed* and *reachable*, removing the entry may not redden, in which case the entry is documentation rather than a pin and the report should say so |

- [ ] **Step 7: Gate, then commit**

```bash
git add src/components src/App.tsx src/admin/EditMode.tsx src/content/copy.json src/test
npm run gate
```

Expected: exit 0, entry CSS **38641 bytes** and byte-identical to Task 10's unless the through-link introduced a rule — **run the rule-level diff and expect `ADDED: []`.**

```bash
git commit -m "feat(home): the homepage section behind press is the blog

5A deferred this deliberately rather than shipping half of it: swapping the
component while /edit held a permanently empty post list would have drawn a
zero-card blog in the dashboard against real posts live, which is a defect a
carousel already shipped once and which cost a full fix round.

The section id stays press and the anchor stays #blogs. That id is
load-bearing in seven places and the anchor is a live URL somebody may have
bookmarked; Phase 1 made exactly this call for ourStory, which displays as
About at #our-story. The visible nav label becomes Blog, which is one string
she can change herself.

It reads the same runtime post list /blog does, which is why it lands after
the storage move: a homepage reading the build-time snapshot while the index
read the database would show stale cards after every publish.

The cards are the same PostCard component /blog renders, not a second
implementation of the same idea -- two implementations of one visual is
exactly how this site once shipped two sections as grey thumbnails.

press.json is untouched and nothing public reads it now. Retiring it is a
fourteen-site sweep with a live asset-guard dependency and it gets its own
plan. BlogTeaser stays on disk under the never-delete constraint."
```

---

### Task 12: the gate, `npx wrangler deploy`, the verification, and the runbook

**5B changes Worker files, so a push without `npx wrangler deploy` ships the blog's read path inert.** That is not a footnote: `GET /api/published?path=posts.json` would 404 against production while the frontend already expects it to work, the compiled-in fallback would render, and every test would be green. Phase 4's final review caught exactly this shape and the runbook was corrected for it.

**The expected numbers, given in advance so a deviation is visible.** A gate task that reads its own output as the answer proves nothing.

| Check | Expected |
| --- | --- |
| `npx tsc -b --noEmit` | exit 0, no output |
| `npx eslint .` | exit 0, no output |
| entry CSS | **38641 bytes**, ceiling **38800**, 159 free |
| `npm test -- --run` | green; count will be well above 5A's 3101 |
| `npm run test:deploy` | green; **a different count from the line above, and that is normal** — it excludes two files |
| Playwright | green, and the only acceptable reds are the eight on the flake watchlist, each confirmed passing in isolation |
| "Not implemented" in the vitest run | **zero occurrences** |

- [ ] **Step 1: Run the real gate, after staging, and read every number**

```bash
git add -A
git status --short
npm run gate 2>&1 | tee /tmp/vb-gate.log
```

`git add -A` before the gate, because `src/admin/__tests__/content.test.ts` shells out to `git ls-files` and sees a different world either side of it, and because a missing panel snapshot fails under CI while passing locally.

Then read the log rather than the exit code:

```bash
grep -c 'Not implemented' /tmp/vb-gate.log     # must be 0
grep -E 'Test Files|Tests ' /tmp/vb-gate.log   # two lines, two different counts
wc -c dist/assets/index-*.css                  # must be 38641
grep -n '38800' src/test/bundle.post-build.test.ts
```

**If any number differs from the table above, stop and find out why before going further.** A grep count is not a finding until somebody looks at what it matched — 5A's Task 11 got a `1` from a `38700` grep and did the right thing by reading the hit, which was inside a comment.

- [ ] **Step 2: Check what this phase plausibly broke**

```bash
git diff 3025385..HEAD --stat -- src/content/galleries.json src/content/sections.json src/content/press.json
git diff 3025385..HEAD --stat -- wrangler.toml worker/migrations public/_redirects public/_headers
git diff 3025385..HEAD -- src/content/copy.json
```

Expected: **the first two commands print nothing at all.** `heroCollage` is under an explicit owner demand, `press.json` is not this phase's to touch, and `wrangler.toml` gains no route in 5B (that is 5C). The third must show **exactly one changed line**, `nav.links[4].label`.

```bash
git log --oneline 3025385..HEAD | cat
git log 3025385..HEAD --format='%an <%ae>%n%b' | grep -iE 'claude|anthropic|co-authored|AI' | cat
```

Expected: the commit list, and **no output at all** from the second — no AI mentioned anywhere, no co-author trailer, author `tarann26`.

- [ ] **Step 3: Run Playwright, alone and serialised**

Nothing else may be running. Port 8080 is shared and a concurrent run gives phantom failures — 5A met an unlisted red here that turned out to be a second agent sharing the machine, and the correct handling was to re-run serialised rather than to retry blindly or to accept "probably fine".

```bash
npx playwright test 2>&1 | tail -30
```

Expected: green. **The eight watchlist entries** (`dashboard-sections:392`, `collage-add-remove`, `page-galleries:125`, `page-galleries:229`, `StatusStrip`, `NumbersArea`, `blog.spec.ts:81`, `blog.spec.ts:99-103`) **are the only acceptable reds, and only after each is confirmed passing in isolation.** Anything else is a regression until proven otherwise. The new `e2e/block-editor.spec.ts` is **not** on that list; if it flakes, it goes on the list only after the flake is characterised, never before.

**Close every browser you open.**

- [ ] **Step 4: Push, then deploy the Worker — both, in that order**

```bash
git push origin HEAD
```

The pre-push hook runs the full gate again. **If it is red, do not push.** Cloudflare has already rejected two branches this project believed were green.

```bash
npx wrangler deploy
```

**Not optional, and not something the Pages build does for you.** It is the third of three artefacts a content-routing change touches, alongside `scripts/build-snapshot.mjs` (already run in Task 9) and `scripts/sync-posts-fallback.mjs`. Skipping it after adding a path to `D1_ONLY_PATHS` or `PUBLIC_FILES` leaves the live Worker serving its previous build.

**Order matters and this is the safe one.** Pushing first means Pages rebuilds the frontend, which paints the compiled-in fallback and works perfectly with the old Worker; deploying the Worker second turns the live read path on. The reverse order is also safe here, but only by luck — the new Worker would serve a document the old frontend does not ask for.

- [ ] **Step 5: Verify against the live site, not against the build log**

```bash
npm run verify:deploy
curl -sI https://vb.aionxxxi.uk/blog | head -1
curl -sI https://vb.aionxxxi.uk/blogs | head -1
curl -s 'https://vb.aionxxxi.uk/api/published?path=posts.json' -D - -o /tmp/posts.json | grep -iE '^(HTTP|x-content-source|etag|cache-control)'
node -e 'const p=require("/tmp/posts.json");console.log(p.length,"posts:",p.map(x=>x.slug).join(", "))'
```

Expected: `/blog` is 200, `/blogs` is **HTTP/2 301** (5A's real redirect, still working), the published route answers **200 with `x-content-source: d1`** and an `ETag`, and the body carries the three post slugs. **`x-content-source: snapshot` means the seed did not land or the D1 read failed — investigate rather than accepting it**, because the page will look right either way.

Then confirm the frontend really reads it, and **fetch the bundle to disk before grepping it** — Phase 4 recorded a false negative caused by grepping a shell variable holding the body:

```bash
curl -s https://vb.aionxxxi.uk/ | grep -o 'assets/index-[^"]*\.js' | head -1
curl -s -o /tmp/entry.js "https://vb.aionxxxi.uk/assets/<that file>"
grep -c 'api/published?path=posts.json' /tmp/entry.js   # must be > 0
```

Then **open it in a real browser and use it as she would.** This is the check no curl replaces: log in at `/edit/manage/story`, add a post, give it a title and a slug and a photo, add a paragraph, make a word bold, add a link, drag a block, publish, and then load `/blog` and the post's own URL in a normal tab. Confirm the published post appears **without a rebuild** — that is the entire point of the storage move, and it is the one claim in this phase that only a live check can make.

- [ ] **Step 6: Confirm the second read of the same document is cached**

```bash
curl -s 'https://vb.aionxxxi.uk/api/published?path=posts.json' -o /dev/null -D - | grep -i x-content-source
```

Expected: `cache` on a second request with no publish in between, and `d1` again immediately after a publish — the version-keyed cache key invalidating with no purge call, which is the mechanism Phase 2 built and which 5B is the first feature to lean on for something the owner edits every week.

- [ ] **Step 7: Write the runbook section**

Append to `docs/cloudflare-cutover.md`, after the "Phase 5A: the blog" section. **`docs/` is outside Tailwind's content globs** (`['./index.html', './src/**/*.{js,ts,jsx,tsx}', '!./src/**/__tests__/**', '!./src/test/**']`, verified in `tailwind.config.js`), so class-like tokens in this prose cost nothing against the ceiling.

```markdown
### Phase 5B: the block editor, and posts on D1

**`src/content/posts.json` is now a D1 document with a committed fallback**,
exactly like `src/content/story.json`. `worker/store.ts`'s `D1_ONLY_PATHS` and
`worker/published.ts`'s `PUBLIC_FILES` both name it. The live copy is the row;
the file is what first paint, a crawler, a reader with JS off and
`src/content/__tests__/assets.test.ts`'s asset walk all see.

**A push to `main` is no longer the whole deploy.** From this phase on:

    node scripts/build-snapshot.mjs        # worker/snapshot.ts -- the Worker's outage fallback
    node scripts/sync-posts-fallback.mjs   # src/content/posts.json -- the browser's first-paint fallback
    node scripts/sync-story-fallback.mjs   # unchanged, still needed
    npx wrangler deploy                    # ships the Worker itself

Skipping `wrangler deploy` leaves `GET /api/published?path=posts.json` 404ing
against production while the frontend already expects it. The site does not
break — the compiled-in fallback renders — but publishing a post changes
nothing anybody can see, and every test is green.

**Adding a post is now something she does herself**, from
`/edit/manage/story` → Posts. A photo uploads into `assets-source/posts/`
(the ninth upload category) and `npm run images` writes
`public/posts/<name>.webp` at build time. R2 is still not enabled.

**A post published between deploys is live immediately but absent from
`sitemap.xml`** until `sync-posts-fallback.mjs` runs and the site rebuilds.
`plugins/sitemap.ts` reads the committed file at build time. That is a
freshness cost on discovery, not a correctness one.

**One pin narrowed, and it is worth knowing.**
`src/content/__tests__/shape.test.ts` pins the three migrated press mentions
against the committed file, which is what makes a fourth post appearing
without a decision on the nine unmigrated `press.json` entries fail the
build. It now guards the **fallback** rather than the live copy: a fourth post
published through the editor is live at once and fails nothing, and only
becomes a build failure after `sync-posts-fallback.mjs` is run. The pin still
does its job for the committed artefact, which is what it was always about.

**One known gap, with its workaround.** A photo staged into a block and then
reordered *before publishing* is keyed by the block's old position, so it
would attach to the wrong block. Publish, then reorder. Re-keying the shared
staged-file collector on reorder is a cross-cutting change to a module every
panel uses and it is deliberately not in this phase.

**The parser can no longer hang.** `parseNodes` used to backtrack
exponentially on an unclosed `[` — 24 brackets took 906ms and 30 took about
two minutes, and it was a hang rather than a throw, so the root error boundary
could not catch it. It was unreachable while the only authoring path was a
committed file; the toolbar's textarea is what put a keystroke in front of it.
Fixed with a memo on both outcomes, a 32-level depth cap and a constant-time
refusal: 50 000 brackets now parse in 4ms.

**The CSS ceiling is 38800 now, up from 38700, and the build sits at 38641.**
Two rules, `cursor-move` and `opacity-50`, both on the drag handle and the
dragged row. `src/test/bundle.post-build.test.ts`'s comment carries the
measurement and the reasoning. Everything else in this phase spent zero, five
files by importing `RecordList`'s and `Field.tsx`'s own exported class
bindings rather than retyping the strings.

**Still the owner's call, unresolved by this phase:**

- the nine fabricated `press.json` entries — twelve entries, three real, and
  the other nine carry `url: null`, publications that read as invented, and
  images borrowed from elsewhere (**six from `/food/`, two from
  `/mocktails/`, and one from `/team/kamalika-anand.webp`**, the chef
  portrait). Moving any of them is now a data edit through the Posts panel,
  not a code change;
- `public/press/hotelier.webp` is the wrong asset for its post — a social
  card whose headline is baked into the pixels, cropped mid-descender by the
  card's 2:1 box, with the same headline then repeated as the post's own
  heading. One path she can change from the Posts panel.

**Also still pending and explicitly out of this phase:** the
`viabiancadelhi.com` cutover. The Worker route must move with the site in the
same change (the session cookie is `SameSite=Strict` with no `Domain=`, so it
is host-only), the Web Analytics tag is bound to the `aionxxxi.uk` zone, six
hostnames are hardcoded, and a nameserver switch that drops MX kills email on
the domain silently. Screenshot GoDaddy's record list before touching
anything.
```

- [ ] **Step 8: Commit the runbook**

```bash
git add docs/cloudflare-cutover.md
git commit -m "docs: how the blog is written, stored and deployed after 5B"
git push origin HEAD
```

- [ ] **Step 9: One last live look, a day later if possible**

```bash
npm run verify:deploy
curl -s 'https://vb.aionxxxi.uk/api/published?path=posts.json' -D - -o /dev/null | grep -i x-content-source
```

The reason for the delay: the Cache API entry expires on its own schedule and the browser copy has a 60-second `max-age`, so a second look the next day is the only check that the version-keyed key is still resolving rather than serving one warm entry forever. **If it reports `snapshot`, the D1 read is failing in production and the site is quietly serving a frozen copy** — which is exactly the failure the snapshot fallback is designed to make invisible, and therefore the one worth going and looking for.

---

## Self-review

Run against the spec after writing, with the findings fixed inline rather than listed as future work.

### 1. Spec coverage

Phase 5's Editor and Rendering paragraphs (spec lines 220-227) plus the two Phase 5 items 5A left open.

| Spec sentence | Where |
| --- | --- |
| "A block editor in the Manage screen." | Tasks 3 (the panel), 4 (the post list), 5 (the block fields) |
| "Toolbar for bold, italic, and links inside text blocks." | Task 7 |
| "A block picker for paragraph, heading, bullet list, numbered list, image, gallery, quote, ingredients, steps, and citation." | Task 6 — all ten, built from `BLOCK_KINDS` so the list cannot drift from the model |
| "Blocks reorder by drag or by the existing up/down buttons the dashboard already uses." | Task 5 (the buttons, reusing `RecordList`'s exported bindings) and Task 8 (drag). Both, and there is a test that fails if the buttons go |
| "Each block type is a React component." | 5A Task 6 shipped the render side; Task 5 is the edit side, with the same exhaustive-switch guarantee |
| "Markdown inside text blocks parses to an AST and renders as elements. No HTML string ever reaches the DOM." | 5A Tasks 2 and 5. **Task 1 is what keeps it true under an editor** — the parser was safe and could hang, and a hang is not something an error boundary catches |
| "'Latest Stories' disappears as a separate homepage section." | **Task 11**, as a rename and component swap rather than a section deletion. This is the sentence the 5B outline omitted and the reason the plan has twelve tasks |
| "This is where the existing `press.json` lands." | **Partially, and the gap is stated:** three of twelve migrated in 5A, nine pending the owner (U1). After Task 9 moving any of them is a data edit through the panel this plan builds, not a code change |
| "Storage. Content moves to Cloudflare D1, read by the existing Worker, and written into the Cloudflare edge cache." (line 58) | Task 9, on the generic `content` table with the version-keyed cache Phase 2 built. **The spec's per-type `posts`/`blocks` tables are not created and conflict 9 says why** |
| "Posts render server-side in the Worker with per-post title, description, Open Graph image, and Article structured data." | **5C, entirely, and not in this plan.** Blocked three ways today: `wrangler.toml` routes only `/api/*`, `worker/__tests__/bundle.test.ts` fails the build if `react` appears in the Worker bundle, and `withSecurityHeaders` rewrites `Cache-Control` to `no-store`. Task 9's loading state is client-side and Task 12's runbook does not claim otherwise |
| Spec "Testing": "every test must be able to fail, verified by mutating the code and watching it go red" | Every task ends with a mutation table. **Six mutations across the twelve tasks are disclosed as predicted-not-to-redden, each with the reason and the fix, and four of those carry an instruction to add the missing assertion before moving on** |
| Spec "Testing": "jsdom has no layout engine, so any claim about rendering, occlusion, or gesture goes in `e2e/`" | Task 8. The drag is `e2e/block-editor.spec.ts`; the jsdom tests say in their own `describe` name that they assert only what jsdom can honestly assert |
| Spec "Testing": "Cache invalidation gets a test that publishes, then reads, and asserts the new value" | Exists from Phase 2 and is reused unchanged. Task 12 Step 6 confirms it live, which is the first time this mechanism carries content the owner edits weekly |
| Spec "Risks": "R2 at roughly 10GB" | R2 is **not enabled** (code 10042, billing-gated) and no task assumes it. `'posts'` is a build-time derivative category, Task 4 |

**Gaps found and closed during this review:** none that needed a new task. **Gaps found and left open, deliberately:** the two owner decisions (U1, U2), 5C's server-side rendering, and the staged-photo-after-reorder key (Task 10 Step 2, recorded with its workaround in the runbook rather than fixed in the last task before a deploy).

### 2. Placeholder scan

Searched for every pattern the writing-plans skill names as a plan failure.

- **"TBD" / "TODO" / "implement later" / "fill in details":** none.
- **"add appropriate validation" / "handle edge cases":** none. Every validation rule is either written out or named against the real function that already implements it.
- **"write tests for the above" without the test code:** none. Every test step carries the test.
- **"similar to Task N":** none. One instruction does point at a file on disk — Task 9 Step 6's "copy the entire preamble of `scripts/seed-story-d1.mjs` verbatim" — and that is deliberate and different in kind: it names a specific existing file whose `getPlatformProxy` machinery was arrived at by reading wrangler's own `cli.js` after getting two documented things wrong, and retyping it from a plan would reintroduce those. The parts that differ are given in full.
- **Steps that describe without showing:** three checked and each is a *measurement* rather than an implementation — Task 8 Step 5's browser look, Task 10 Step 3's load reproduction, and Task 12 Step 5's live check. Each gives the exact commands.
- **References to types or functions not defined anywhere:** four found and fixed inline during this pass. `PostMeta` was used in Task 5 before Task 4 declared it → Task 4's Interfaces block now names it with its definition. `BlockListProps`' full seven-prop shape was implicit in Task 4 and needed by Task 5 → Task 4 now declares all seven with the note that only three are destructured so eslint passes. `moveTo` was referenced in Task 8's `BlockList` diff before its module existed → its own step now precedes the diff. `isBlockProblem` was consumed by `PostList` in Task 4 with its module created in the same task → the step order now puts the module first.
- **Deliberately visible dead code:** one, Task 8 Step 6's `kinds` locator, marked in bold as a discarded approach to be **deleted before committing**, with the reason. It is left in the plan so a reviewer can see why a class-substring locator was rejected. That is a disclosure, not a placeholder.

### 3. Type consistency

Checked every name that crosses a task boundary, in both spellings.

- `parseInline` / `MAX_NESTING_DEPTH` / `InlineNode` / `isSafeHref` / `isSiteRelativePath` / `rawLinkTargets` (Task 1) — consumed with those exact names in Tasks 7 and 9. Task 1 explicitly does not touch the last three, and Step 6 greps the diff to prove it.
- `assertPosts` (Task 2) — consumed in Task 9 by `posts-api.ts`, `seed-posts-d1.mjs` and `sync-posts-fallback.mjs`. All three read it from `src/content/guards`, which is the only place it lives.
- `PANELS.posts` / `PanelId 'posts'` / `'posts.json'` as `ContentFileName` / `data-panel` (Task 3) — consumed in Tasks 4, 5, 10, 11. `PANELS.posts.heading` is read, never re-spelled as a literal, and Task 3 mutation #4 adds a source-level pin for exactly that.
- `PostMeta` / `POST_FIELDS` / `isBlockProblem` / `blockProblemOf` / `BlockProblemTarget` / `PostList` / `PostListProps` / `blankPost` (Task 4) — consumed in Tasks 5, 6, 10. `blankPost` is module-private to `PostsArea.tsx` and the Interfaces block says so, so no later task looks for it elsewhere.
- `BlockListProps` (Task 4, seven props) / `BLOCK_KIND_LABELS` / `BLOCK_KIND_HELP` / `InlineTextField` / `InlineTextFieldProps` / `BlockFields` / `BlockFieldsProps` (Task 5) — consumed in Tasks 6, 7, 8, 10. `BlockListProps` is declared complete in Task 4 precisely so `PostList` never changes again, and Task 7 changes `InlineTextField`'s internals with **no caller change**, which is why it got its own component in Task 5.
- `BLANK_BLOCK` / `blankBlock` / `BlockPicker` (Task 6) — consumed in Tasks 8 and 10.
- `moveTo` (Task 8) — consumed by `BlockList`'s drop handler in the same task and by `reorder.test.ts`. Not consumed elsewhere.
- `POSTS_ENDPOINT` / `fetchPosts` / `usePosts` / `PostsState` / `postsFileFromRow` (Task 9) — `usePosts` is consumed in Task 11, `PostsState`'s `status` union is branched on in `PostPage` in Task 9 itself. `PostsState.status` is spelled `'loading' | 'loaded' | 'error'` in every one of the four places it appears.
- `HANDLE_CLASSNAME` (Task 8) is module-private and named once.
- `MOVE_BUTTON_CLASSNAME` / `REMOVE_BUTTON_CLASSNAME` / `ADD_BUTTON_CLASSNAME` / `INPUT_CLASSNAME` / `LABEL_CLASSNAME` — all five imported from their existing homes (`RecordList.tsx`, `Field.tsx`) in every task that uses them, never retyped. That is a CSS-budget requirement as much as a naming one.
- **One inconsistency found and fixed:** an early draft of Task 5 named the item-list noun parameter `label` while Task 6's picker used `label` for the kind's display name. Renamed to `noun` in `BlockFields`, matching `RecordList`'s own `noun` prop, so one word does not mean two things across three files.

### 4. Known gaps, stated rather than hidden

- **Six mutations are predicted not to redden**, each with the reason and, where a fix is possible, the assertion to add before moving on: Task 1 #6 and #7, Task 4 #6, Task 7 #3, #7 and #12, Task 8 #10 and #11, Task 10 #8, Task 11 #5 and #9. **Three of those (Task 4 #6, Task 7 #3, Task 10 #8) carry an explicit instruction to add the missing assertion in that task**; the rest are disclosed as genuinely uncoverable with the reason. Two of this project's plan documents shipped mutation tables whose entries did not redden and were reported as proof anyway; disclosing these is the opposite of that. **Assume more exist and check each.**
- **Task 8's `select-none` and `opacity-50` have no test that can fail.** Their effects are a slow human drag and a mid-drag frame, neither of which jsdom nor a scripted `dragTo` reproduces. The Step 5 browser look is the only check, and the plan says so rather than shipping two tests that cannot fail.
- **The staged-photo-after-reorder key** is pinned as current behaviour with the workaround recorded, not fixed. Re-keying the shared collector is a cross-cutting change to a module every panel uses.
- **`shape.test.ts`'s three-mentions pin narrows** from the live copy to the fallback once Task 9 lands. Recorded in the runbook. The pin still does its job for the committed artefact.
- **A post published between deploys is absent from `sitemap.xml`** until the sync script runs and the site rebuilds. A freshness cost on discovery, not a correctness one.
- **`e2e/` is still untypechecked**, across all twelve specs including the new one. Pre-existing, recorded, and deliberately not fixed mid-phase.
- **Task 9 mutation #13 touches production data.** If that is not acceptable, skip it and say so rather than reporting it as verified.
