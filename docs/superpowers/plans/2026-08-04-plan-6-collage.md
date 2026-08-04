# Collage Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let her move and resize the sixteen photos in the hero collage, on the real homepage, and publish the result. Drag on a pointer device; tap-and-buttons on a phone.

**Architecture:** `galleries.heroCollage[i].className` is a Tailwind grid placement string (`col-start-5 col-span-2 row-span-2`). Plan 6 parses it into four integers, edits the integers, and serialises back to the same string shape. The public component keeps rendering `className` verbatim — it never learns that anything is editable. Editing rides Plan 5's `renderImage` channel, alongside `EditableImage`.

**Tech Stack:** React 18, TypeScript strict, Tailwind 3, Vitest, Testing Library. Pointer Events, no drag library.

## Global Constraints

- **Branch `repair/phase-a`. Never push. Never touch `main`.** The site is live.
- **`npx tsc -b --noEmit`, never `npx tsc --noEmit`.** The root `tsconfig.json` is solution-style with `"files": []`, so the plain form checks nothing and exits 0 on any codebase.
- **A test that cannot fail is a defect.** Forty have been caught in this project. For each test, name the mutation that makes it fail, then run it. Two of Plan 5's Criticals were invisible to 1724 green tests and were found only by driving a real browser — where DOM behaviour is the question, drive a browser.
- **Tailwind scans comments and has no JS parser.** Ten instances of unused CSS have shipped that way. The rule-level build diff is the only method that has ever caught one, and it must be baselined from a **worktree checkout** of the parent commit, never a stash.
- **CSS ceiling:** `src/test/bundle.post-build.test.ts:359` asserts `< 32300` against a measured 32084 — 216 bytes. **Task 1 will exceed it deliberately.**
- Commit messages in the style of `git log --oneline -5`. Never mention AI or any assistant; no co-author trailers.

## The defect this plan has to fix before it can build anything

**The homepage collage does not render what `galleries.json` says, and it has not for the life of the file.**

`tailwind.config.js`'s content glob is `['./index.html', './src/**/*.{js,ts,jsx,tsx}']`. It does not include `.json`. Every collage placement lives in `src/content/galleries.json`. So Tailwind never sees them.

Verified against the built stylesheet, not inferred. Of the 14 distinct grid utilities the file uses:

| | Utilities | What actually happens |
|---|---|---|
| **Absent from the shipped CSS** | `col-start-2` `col-start-4` `col-start-6` `row-start-3` `row-start-4` `row-start-5` `row-start-6` | The placement has **no effect**; the tile auto-places into the next free cell |
| **Present only by accident** | `col-span-1` `col-span-2` `col-start-3` `col-start-5` `row-span-1` `row-span-2` `row-start-2` | They ship **solely because `src/components/__tests__/Hero.test.tsx` spells them out as fixture strings.** Nothing else in `src/**/*.tsx` contains them |

**Twelve of the sixteen tiles are therefore laid out differently from what the file specifies.** Only tiles 0, 2, 4 and 8 render as authored. The live homepage's collage layout currently depends on the string literals in a test file's fixtures.

Two consequences that shape this plan:

**1. `homepage-bytes.test.tsx` cannot see any of this, and adding the fix will not move it.** The rendered HTML contains the `className` strings whether or not a matching CSS rule exists. The 53473-byte invariant — the gate every other task in this sequence leans on — stays green through a total visual change to the homepage. This is the one task where that test is not the guard. **The guard here is the rule-level CSS diff plus a new test that pins which grid utilities ship.**

**2. A safelist is required, and JSON scanning is not a substitute.** Plan 3's ledger proposed adding `./src/content/*.json` to the content glob. That is worth doing, but it cannot serve this plan on its own: **JSON scanning happens at build time and dragging happens at runtime.** She drags a tile to `col-start-4`, and if no tile happened to occupy column 4 when the site was last built, that class is not in the stylesheet — so the preview shows the tile auto-placing, and only a publish plus a Cloudflare rebuild makes it correct. That is precisely "the preview is not a preview," on the one surface whose whole value is that it is not. Enumerate all 24 positions in `safelist` so every position drag can produce is already in the stylesheet.

## What Plans 4 and 5 handed over

1. **`registry.updateData`, never `register`, on an edit.** `register` overwrites the refreshed sha and makes the second publish in a session report a false *"Someone else published while you were editing."*
2. **Reuse `publish.ts`; do not fork it.** It attaches `baseSha` per file, scrubs staged references, enforces the 8-photo cap and maps a typed 409.
3. **The capture-phase click guard at `/edit` cancels clicks by default.** `EditMode.tsx`'s `handleCaptureClick` exempts same-document anchors, `aria-expanded` buttons, and anything inside `[data-editable-image-path]`. Plan 5 shipped Task 4 **completely inert** because a `<label>` fell outside those carve-outs and `preventDefault()` cancelled its activation behaviour — the camera badge could not open the file picker, and no test caught it because every image test called `fireEvent.change(input)` directly. **Any new control this plan adds at `/edit` must be tested by a real click inside `EditMode`, not by firing its handler.**
4. **`EditableImage` (`src/admin/EditableImage.tsx`) is solid and its staged-file key is the `renderImage` path**, deliberately not `useRowIds` — that WeakMap keys on the record object, and the commit path creates a new object each time, so it would orphan staged bytes. Build alongside it, keep the key scheme.
5. **`validateContent` refuses what the deploy gate would reject.** `validate.ts:357` currently checks only that `className` is non-blank.

## What already constrains the layout

`src/components/__tests__/Hero.test.tsx:49` — *"places every collage image in a distinct grid cell"* — already fails on an overlap, and `:91` proves it detects one. **Overlap is therefore not a design choice this plan gets to make; it is already forbidden by a passing test.** Confirm whether that test runs against the real `galleries.json` or a fixture before deciding what drag must prevent. If it runs against the real file, a drag that lands one tile on another turns an existing test red, and the drag has to refuse the move rather than commit it.

---

## Task 1: Make the collage render what the file says

**Files:**
- Modify: `tailwind.config.js`, `src/test/bundle.post-build.test.ts`
- Create: `src/test/collage-css.test.ts`

This is a **deliberate, visible change to the live homepage.** Twelve tiles move. State that in the commit message, and say what the collage looked like before and after.

- [ ] **Step 1: The failing test first**

`src/test/collage-css.test.ts` reads `src/content/galleries.json`, extracts every distinct utility from every `className`, and asserts each one has a matching rule in the built stylesheet. Today that test fails on seven. It must be written so it fails on seven **before** you touch the config — run it and paste the seven names.

It needs the built CSS, so follow `bundle.post-build.test.ts`'s existing convention for tests that require `dist/` (`it.runIf(REQUIRED)` / `skipIf(!REQUIRED && !existsSync(...))`) rather than inventing a second mechanism. Read that file first.

- [ ] **Step 2: Safelist all 24 grid positions**

`col-start-1`…`col-start-6`, `col-span-1`…`col-span-6`, `row-start-1`…`row-start-6`, `row-span-1`…`row-span-6`. The grid is `grid-cols-6 grid-rows-6` (`Hero.tsx`), so 6 is the bound in both axes and a 7th of anything is a bug, not a missing safelist entry.

Also add `'!./src/**/__tests__/**'` and `'!./src/test/**'` to the content globs. Seven utilities currently ship because a test fixture spells them out; that is a leak in both directions — it ships dead CSS and it churns the stylesheet hash (a full CDN cache-bust) whenever a test comment happens to mention a utility name. Verify the exclusion works by confirming the seven accidental ones now arrive via the safelist rather than the leak.

Whether to also add `./src/content/*.json` to the glob is your call — with the safelist in place it changes nothing for the collage. If you add it, say what else it starts scanning and what that costs.

- [ ] **Step 3: Raise the ceiling, deliberately**

24 grid rules will not fit in 216 bytes. Measure, state the old and new numbers, and justify with a **rule-level** diff from a **worktree checkout** of the parent commit — never `git stash`. Report the added rules and the removed ones separately; this task should remove seven as well as add.

- [ ] **Step 4: Prove the homepage changed, and that the byte test could not tell**

Two things, both required:

- Show `homepage-bytes.test.tsx` still reads **53473**, and say in one sentence why that proves nothing here.
- Capture the rendered collage geometry before and after — `getBoundingClientRect()` per tile from a real browser against a built site, or computed `grid-column-start`/`grid-row-start` — and show that twelve tiles moved and that each now matches its `className`.

- [ ] **Step 5: Commit**

---

## Task 2: Placement as data, and a server that refuses a bad one

**Files:**
- Create: `src/content/placement.ts`, `src/content/__tests__/placement.test.ts`
- Modify: `src/content/validate.ts`, `src/content/__tests__/validate.test.ts`

**Interfaces:**
- Produces: `Placement = { colStart: number; colSpan: number; rowStart: number; rowSpan: number }`; `parsePlacement(className: string): Placement | null`; `formatPlacement(p: Placement): string`.

- [ ] **Step 1: Parse and format**

The real file uses four shapes, and your parser must handle all of them — check `galleries.json` yourself rather than trusting this list: an explicit start on both axes, a start on one axis only, a span with no start at all (auto-placement, `col-span-2 row-span-2`), and `row-span-1`/`col-span-1` written explicitly where they are the default.

`formatPlacement` must round-trip every one of the sixteen real entries **byte-identically** where the input is already canonical, and where it is not, the difference must be a deliberate normalisation you name. A round-trip that silently rewrites twelve entries changes the file the next time she publishes anything, for no reason she asked for.

Auto-placement (no `col-start`) is a real, used state — decide how `Placement` represents it and say why. A sentinel integer and a nullable field are not equivalent: one of them makes `formatPlacement` able to emit a class that does not exist.

- [ ] **Step 2: Refuse a bad placement server-side**

`validate.ts:357` checks only that `className` is non-blank, so `"col-start-99"`, `"garbage"` and `""` are equally acceptable today. Add rules so the Worker refuses, before it becomes a commit:

- a `className` that does not parse
- any index outside 1–6, on either axis
- a start plus span that runs off the grid (`col-start-6 col-span-2`)
- a placement that overlaps another tile, if `Hero.test.tsx:49` runs against the real file

Deliverable is **named assertions of the form "placement X is refused by `validateContent`"**, in `validate.test.ts` alongside Plan 5 Task 6's five. A refused deploy poisons `main` until a developer hand-edits JSON; a refused publish is a sentence she can act on.

- [ ] **Step 3: Commit**

---

## Task 3: Drag to move and resize

**Files:**
- Create: `src/admin/CollageTile.tsx`, `src/admin/__tests__/CollageTile.test.tsx`
- Modify: `src/admin/EditMode.tsx`

- [ ] **Step 1: Pointer Events, not mouse events**

One code path for mouse, pen and touch. `setPointerCapture` on the tile so a fast drag that leaves the element still tracks. No drag library — the grid is 6×6 and the drop target is a cell, so this is arithmetic on `getBoundingClientRect()`, not physics.

- [ ] **Step 2: Snap to cells, and refuse an illegal drop**

The tile follows the pointer but commits only to a whole cell. A drop that would run off the grid, or land on an occupied cell, **does not commit** — it returns the tile to where it was. Task 2's validator is the definition of legal; call it rather than reimplementing the rule, so the two cannot disagree.

Resize is the same arithmetic on a corner handle: it changes span, not start.

- [ ] **Step 3: Write back through the registry**

`registry.updateData('galleries.json', next)` — **never `register`** (Plan 4 handover item 1). Write `formatPlacement(placement)` into `heroCollage[i].className`, leaving `src` untouched. A tile whose photo she also replaced this session must keep both changes.

- [ ] **Step 4: Test it the way Plan 5's Task 4 broke**

`EditMode.tsx`'s capture-phase click guard cancels clicks by default. A `pointerdown` is not a `click`, so the guard may not touch drag at all — **verify that in a real browser rather than assuming it**, because the identical assumption is what shipped Plan 5's photo control inert. Drive a real drag inside a real `EditMode` and assert the tile moved and the JSON changed. A test that calls the drag handler directly cannot catch the class of bug that has now bitten this plan's dependency twice.

- [ ] **Step 5: Commit**

---

## Task 4: Tap and buttons on touch

**Files:**
- Modify: `src/admin/CollageTile.tsx`, its tests

The spec's Risks section rules this a mandate, not a preference: *"A 6×6 grid on a 390px screen gives roughly 60px cells, and a corner handle inside that is a few pixels wide. On phones she gets tap-to-select with plus, minus and arrow buttons instead. Same data, different controls."*

- [ ] **Step 1: Tap selects; buttons move and resize**

Four arrows to move, plus/minus per axis to resize. Same `Placement`, same validator, same write-back — **only the controls differ.** If the two paths can produce different results from the same intent, you have two implementations and one of them is wrong.

- [ ] **Step 2: Choose the switch, and defend it**

Do not switch on viewport width. A 390px viewport is not the same question as "does this device have a fine pointer" — a small laptop window has a mouse, and a large tablet does not. `matchMedia('(pointer: coarse)')` asks the actual question. Whatever you choose, state why, and make sure **both** control sets are reachable in tests without stubbing the component's own internals.

- [ ] **Step 3: Test at 390px, with no hover**

Same standard as Plan 5's text and image affordances: the control is visible without hovering, and the test would catch a `hover:`-gated one.

- [ ] **Step 4: Commit**

---

## Task 5: Publish, and the classes that must exist when she does

**Files:**
- Modify: `src/admin/EditMode.tsx`, `src/test/collage-css.test.ts`

- [ ] **Step 1: Publish through the same path**

Reuse `publish.ts` and `PublishBar` exactly as Plan 5 Task 5 does. `galleries.json` is already one of the five files `/edit` can write, so a placement edit should ride the existing publish with no new plumbing. Confirm that rather than adding any.

- [ ] **Step 2: Close the loop the safelist opened**

Task 1's safelist covers all 24 positions, so anything she drags to already has a rule. **Pin that.** Extend `collage-css.test.ts` to assert every one of the 24 ships — not merely the ones `galleries.json` currently uses. Its mutation: drop one entry from the safelist and the test must name it.

This is the test that stops a future "trim the safelist, nothing uses `col-start-1`" commit from making one column silently unreachable by drag.

- [ ] **Step 3: Commit**

---

## Definition of done

- [ ] `npm run test`, `npm run test:deploy`, `npx tsc -b --noEmit`, `npm run build`, `npx eslint .` all clean. Record the count.
- [ ] Every distinct utility in `galleries.json` has a rule in the built CSS, and all 24 grid positions ship.
- [ ] Twelve tiles moved, and the before/after geometry is recorded.
- [ ] `homepage-bytes.test.tsx` still reads 53473 — and the plan says in one sentence why that is not evidence here.
- [ ] No grid utility ships because a test file spells it out.
- [ ] `formatPlacement(parsePlacement(x)) === x` for every canonical entry in the real file; any normalisation is named.
- [ ] A placement that does not parse, is out of range, runs off the grid, or overlaps is refused by `validateContent`.
- [ ] A real drag inside a real `EditMode` moves a tile and changes the JSON.
- [ ] The touch controls produce results identical to drag, and are reachable at 390px with no hover.
- [ ] A placement edit publishes through `publish.ts` with no forked logic.
- [ ] The CSS ceiling is raised deliberately, with the new number and the rule-level diff stated.

## Handed to later plans

- **Plan 7 (Section templates)** adds template types to Plan 4's descriptors. `Page { slug, name, inNav, sections }` is the first nested list-of-records.
- **Still open from Plan 5:** `dish.name`, `drink.name`, `article.title` and `article.publication` are each both a text child and an attribute, so none is editable in place — that is every dish name, drink name and article title on the page. `copy.nav.links[*].label` is visible text editable nowhere.
- **Still unowned:** the 12×-repeated file-level validation message; the silent `localStorage`-quota swallow; orphaned staged bytes on Discard and row-remove; a drink's photo that cannot be cleared; a stale `dist/` making plain `npm run test` check an artifact that need not match source.
