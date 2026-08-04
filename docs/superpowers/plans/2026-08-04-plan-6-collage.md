# Collage Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let her move and resize the sixteen photos in the hero collage, on the real homepage, and publish the result. Buttons on every device; drag as well on a pointer device.

**Architecture:** `galleries.heroCollage[i].className` is a Tailwind grid placement string (`col-start-5 col-span-2 row-span-2`). This plan parses it into four **optional** integers, edits them, and serialises back to the same string shape. The public component keeps rendering `className` verbatim — it never learns anything is editable. Editing rides Plan 5's `renderImage` channel, alongside `EditableImage`.

**Tech Stack:** React 18, TypeScript strict, Tailwind 3, Vitest, Testing Library, Playwright for the interaction tests. Pointer Events, no drag library.

## Global Constraints

- **Branch `repair/phase-a`. Never push. Never touch `main`.** The site is live.
- **`npx tsc -b --noEmit`, never `npx tsc --noEmit`.** The root `tsconfig.json` is solution-style with `"files": []`, so the plain form checks nothing and exits 0 on any codebase.
- **A test that cannot fail is a defect.** Forty have been caught here. Name the mutation for each test, then run it.
- **Tailwind scans comments and has no JS parser.** Ten instances of unused CSS have shipped that way. The rule-level build diff is the only method that has ever caught one, baselined from a **worktree checkout** of the parent commit, never a stash.
- **CSS ceiling:** `src/test/bundle.post-build.test.ts:359` asserts `< 32300` against a measured 32084. Task 2 raises it to **32900** against a measured **32674**.
- Commit messages in the style of `git log --oneline -5`. Never mention AI or any assistant; no co-author trailers.

---

## The live defect this plan repairs, stated correctly

**Nine of the sixteen hero collage photos are not visible on the homepage right now, and have not been for the life of the file.**

`tailwind.config.js:3`'s content glob is `['./index.html', './src/**/*.{js,ts,jsx,tsx}']`. It does not include `.json`, and every collage placement lives in `src/content/galleries.json`. Tailwind never sees them.

Measured against the built stylesheet (`index-BADOuW7d.css`, 32084 bytes), of the 14 distinct grid utilities the file uses:

| | Utilities | Effect |
|---|---|---|
| **Absent** | `col-start-2` `col-start-4` `col-start-6` `row-start-3` `row-start-4` `row-start-5` `row-start-6` | The placement does nothing; the tile auto-places |
| **Present only via test files** | `col-span-1` `col-span-2` `col-start-3` `col-start-5` `row-span-1` `row-span-2` `row-start-2` | They survive because `src/components/__tests__/Hero.test.tsx` spells them out as fixture strings (and `col-span-1` also at `src/content/__tests__/validate.test.ts:145`). Excluding test directories removes all seven. `ReservationForm.tsx:203`'s `md:col-span-2` does **not** rescue the bare `col-span-2` — Tailwind extracts the prefixed candidate only |

**What that does to the page,** measured in real Chromium with `getBoundingClientRect()` per tile: the six explicit rows collapse, and **tiles 5, 6, 7, 10, 11, 12, 13, 14 and 15 land in implicit rows below the section**, where `Hero.tsx:57`'s `overflow-hidden` clips them. Nine photos she paid a photographer for are on the page and cannot be seen.

**After the fix, 14 of the 16 tiles change position.** Only tiles 0 and 8 stay put. An earlier draft of this plan said "twelve tiles are laid out differently, only 0, 2, 4 and 8 render as authored" — that was true of the *declared* placement and false of the *render*, and it named two tiles (2 and 4) that in fact move. Do not reuse that number.

### Two consequences that shape everything below

**1. `homepage-bytes.test.tsx` cannot see any of this.** The rendered HTML carries the `className` strings whether or not a matching rule exists, so the 53473-byte invariant — the gate every other task in this sequence leans on — stays green through a total visual change to a live homepage. **This is the one plan where that test is not the guard.** The guards here are the rule-level CSS diff, a test pinning which utilities ship, and before/after geometry from a real browser.

**2. A safelist is required; scanning `.json` is not a substitute.** Plan 3's ledger proposed adding `./src/content/*.json` to the content glob. Measured, that produces a **byte-identical stylesheet with an identical selector set** once the safelist exists — a strict no-op, plus a permanent scanning surface over owner-authored prose (the hazard `blocklist: ['blur']` already exists for). **Decision: safelist yes, JSON glob no.** Recorded here so Plan 3's proposal is not re-litigated.

The reason the glob cannot stand alone: **scanning is build-time and dragging is runtime.** `/edit` and `/` load the same stylesheet, so a position no tile occupied at last build has no rule at `/edit` either, and the tile auto-places in the preview. Only a publish plus a Cloudflare rebuild would make it correct. That is "the preview is not a preview" on the one surface whose whole value is that it is.

### Measured numbers, so a wrong diff is visible

| Config | CSS bytes | Δ |
|---|---|---|
| as shipped | 32084 | — |
| `!__tests__` + `!src/test` only | 31834 | **−250** (the 7 accidental rules) |
| + `./src/content/*.json` alone | 32303 | +219 — *already over the current 32300 ceiling* |
| + 24-entry safelist | **32674** | **+840** over the exclusion-only build |
| safelist **and** glob | 32674 | +0, identical selectors |

---

## What Plans 4 and 5 handed over

1. **`registry.updateData`, never `register`, on an edit.** `register` overwrites the refreshed sha and makes the second publish in a session report a false *"Someone else published while you were editing."*
2. **Reuse `publish.ts`; do not fork it.** It attaches `baseSha` per file, scrubs staged references, enforces the 8-photo cap and maps a typed 409.
3. **`EditMode.tsx`'s capture-phase click guard cancels clicks by default,** exempting only same-document anchors, `aria-expanded` buttons, and anything inside `[data-editable-image-path]`. Plan 5 shipped its photo control **completely inert** because a `<label>` fell outside those carve-outs — and no test caught it, because every image test called `fireEvent.change(input)` instead of clicking inside `EditMode`.
4. **`EditableImage`'s staged-file key is the `renderImage` path**, deliberately not `useRowIds`. Keep that scheme; it is index-based and therefore unaffected by a placement change.

---

## Task 1: Placement as data

**Files:**
- Create: `src/content/placement.ts`, `src/content/__tests__/placement.test.ts`
- Modify: `src/content/validate.ts`, `src/content/__tests__/validate.test.ts`, `src/components/__tests__/Hero.test.tsx`

**This task is first deliberately.** It is pure, has no visible effect, and Task 2's CSS test needs its parser. An earlier draft ran the CSS repair first; that was wrong.

**Interfaces:**
- Produces: `GRID_SIZE = 6`; `Placement = { colStart: number | null; colSpan: number | null; rowStart: number | null; rowSpan: number | null }`; `parsePlacement(className: string): Placement | null`; `formatPlacement(p: Placement): string`; `resolveLayout(entries): ...` (see Step 3).

- [ ] **Step 1: All four fields nullable, and that is what makes the round trip work**

An earlier draft declared four required `number`s and *also* demanded a byte-identical round trip. Those contradict, and the contradiction is measurable: with four nullable fields and a formatter emitting `col-start, col-span, row-start, row-span` in that order and omitting what is absent, **all sixteen real entries round-trip byte-identically**. With required numbers, only entries 1, 5 and 7 survive and **thirteen get rewritten** — entries 2 and 3 would gain a `col-start` they never had, changing the layout. That is thirteen lines in her next publish diff that she did not touch.

Nullability is needed on all four, not just the starts: `row-span` is absent in entries 8–15 (eight of sixteen), `col-span` is present in all sixteen, and `row-span-1` is written explicitly in entries 4 and 5. Verify that against the file yourself.

`GRID_SIZE` is exported and **the single source of the bound**. Task 2's safelist and this task's validator both derive from it. Hard-code 6 in two places and a future `grid-cols-8` breaks silently, in exactly the way this plan exists to prevent.

- [ ] **Step 2: Refuse a bad placement server-side**

`validate.ts:357` today checks only that `className` is non-blank, so `"col-start-99"`, `"garbage"` and `""` are equally acceptable. Add rules so the Worker refuses before it becomes a commit:

- a `className` that does not parse
- any index outside 1–`GRID_SIZE` on either axis
- a start plus span that runs off the grid (`col-start-6 col-span-2`)
- **any tile that resolves into an implicit row** — see Step 3

**Overlap is allowed.** She is arranging a photo collage; overlapping tiles are a legitimate thing to want, and CSS grid paints the later item over the earlier. Do not refuse it.

Deliverable is **named assertions of the form "placement X is refused by `validateContent`"**, in `validate.test.ts` alongside Plan 5 Task 6's five.

- [ ] **Step 3: Replace `Hero.test.tsx:49` — it is not the test its name claims**

`src/components/__tests__/Hero.test.tsx:49` ("places every collage image in a distinct grid cell") runs against the **real** `galleries.json` (`:5` imports `{ galleries } from '../../content'`, `:52` maps `galleries.heroCollage`). But it builds the key `` `${col-start-N}:${row-start-M}` `` and **never reads spans**. Both failure directions are real:

- `col-start-3 col-span-2 row-start-2` and `col-start-4 col-span-1 row-start-2` — the second sits *inside* the first — distinct keys, **test passes**
- two tiles both `col-start-3 col-span-1` with auto rows — they land in different rows and never touch — identical keys, **test fails**

So it accepts real overlaps and refuses legal layouts. It was written to catch an authoring mistake in a hand-edited file, back when a developer was the only editor. Once she is the editor it becomes a rule that silently reverts her drags.

Replace it with a test of what actually breaks the page: **every tile resolves inside rows and columns 1–`GRID_SIZE`, and no tile lands in an implicit row.** Compute that with a `resolveLayout` helper in `placement.ts` that implements CSS grid's sparse auto-placement cursor, so the test and `validateContent` cannot disagree by construction — the validator calls the same function.

This matters beyond tidiness: `npm run test:deploy` runs `Hero.test.tsx`, so a validator that disagrees with it lets her pass the Worker's check, publish, and have **Cloudflare refuse the build** — the "refused deploy poisons `main` until a developer hand-edits JSON" outcome this plan exists to avoid.

- [ ] **Step 4: Commit**

---

## Task 2: Make the collage render what the file says

**Files:**
- Modify: `tailwind.config.js`, `src/test/bundle.post-build.test.ts`, `src/content/galleries.json`
- Create: `src/test/collage-css.test.ts`

**This is a visible change to a live restaurant's homepage. It needs her yes before it ships — see Step 5.**

- [ ] **Step 1: The failing test first**

`src/test/collage-css.test.ts` reads `galleries.json`, extracts every distinct utility via `parsePlacement`, and asserts each has a matching rule in the built stylesheet. Today it fails on seven; run it and paste the seven names **before** touching the config.

It needs `dist/`, so follow `bundle.post-build.test.ts`'s existing convention (`it.runIf(REQUIRED)` / `skipIf(!REQUIRED && !existsSync(...))`) rather than inventing a second mechanism.

- [ ] **Step 2: Safelist, and exclude test directories**

Safelist all 24: `col-start-1`…`-6`, `col-span-1`…`-6`, `row-start-1`…`-6`, `row-span-1`…`-6`, generated from `GRID_SIZE`. Add `'!./src/**/__tests__/**'` and `'!./src/test/**'` to the content globs — seven utilities currently ship because a test fixture spells them out, which leaks in both directions: it ships dead CSS, and it churns the stylesheet hash (a full CDN cache-bust) whenever a test comment happens to mention a utility name.

Do **not** add `./src/content/*.json`. Decided above, with measurements.

- [ ] **Step 3: Fix entry 4, which the safelist alone does not**

**The safelist does not achieve this task's title on its own.** Measured against a safelisted build: entry 4 (`/hero/farfalle4.webp`, `col-start-3 col-span-2 row-span-1`) has no `row-start`. By the time the sparse cursor reaches it — fifth in document order, cursor already at row 3 — columns 3–4 are occupied in every remaining row, so it is pushed into an **implicit seventh row**: outside `grid-rows-6`, outside the safelist, outside the validator's range. With real images it renders as a ~397×298 block below the collage and compresses all six explicit rows from ~124px to 74/152px. Meanwhile row 1, columns 1–2 sit empty.

Give entry 4 an explicit `row-start-1`. Verified: all sixteen tiles then land inside rows 1–6, leaving two free cells at row 1, columns 1–2. This is a decision to make, not a thing to discover — and it is the reason this task edits `galleries.json`, which changes the rendered HTML and therefore **moves the 53473 byte count**. State the new number.

- [ ] **Step 4: Raise the ceiling and prove the diff**

New ceiling **32900** against a measured **32674**. Justify with a **rule-level** diff from a **worktree checkout** of the parent commit — never `git stash`. Report added and removed separately: **−250 bytes / 7 selectors** from the exclusion, **+840 / 24** from the safelist.

- [ ] **Step 5: Show her, then ship**

Produce before/after screenshots of the homepage at **390px and 1440px**, and one sentence she can act on: *"Nine of your sixteen hero photos are not currently showing. This puts them back, and moves the others."* Her yes goes in the commit message.

"State it in the commit message" is not a gate — she cannot read a diff, and the geometry evidence in Step 3 is for a developer. Screenshots are the deliverable here. If she is unreachable, stop and report rather than shipping a homepage change on her behalf.

- [ ] **Step 6: Commit**

---

## Task 3: Buttons — the control that works everywhere

**Files:**
- Create: `src/admin/CollageTile.tsx`, `src/admin/__tests__/CollageTile.test.tsx`
- Modify: `src/admin/EditMode.tsx`

**Buttons come before drag deliberately.** The spec's Risks section mandates them on touch, they are also the keyboard interface, and they satisfy the goal on every device. If scope must be cut, **drag (Task 4) is the droppable piece, not this.** The spec calls Plan 6 "the most droppable" plan; that cut line lives here, in writing.

- [ ] **Step 1: Select a tile, then move and resize it**

Four arrows to move, plus/minus per axis to resize. All of it goes through `Placement`, `validateContent` and the same write-back — if the button path and the drag path can produce different results from the same intent, you have two implementations and one is wrong.

- [ ] **Step 2: Resolve the collision with the camera badge**

`EditableImage.tsx:149` puts an `h-8 w-8` `<label>` at `bottom-1 right-1` **inside every collage tile** — `Hero.tsx:59` wraps every collage image in `renderImage`. On a 390px screen the spec computes a ~60px cell, so the photo-replace target already occupies more than a quarter of it, in the corner where a resize handle would otherwise go. **A tap on a tile already means "replace this photo."**

Decide what selects a tile versus what replaces its photo, and make both reachable at 390px. This is not a detail: Plan 5's Critical was a control at `/edit` that could not be activated at all.

- [ ] **Step 3: Available on fine pointers too, not gated behind `(pointer: coarse)`**

The buttons are the keyboard interface. This repo has taken accessibility seriously — `aria-hidden` on the logo circle, `sr-only` `role="status"`/`role="alert"` in `EditableImage`, `aria-label` on the camera control, and Plan 5's Critical explicitly tracked the keyboard activation path. A pointer-only drag with a touch-only fallback leaves keyboard users nothing. Surface the buttons on focus or on selection regardless of pointer type.

Where you do branch on device, use `matchMedia('(pointer: coarse)')`, not viewport width — a small laptop window has a mouse and a large tablet does not.

- [ ] **Step 4: Write back through the registry**

`registry.updateData('galleries.json', next)` — **never `register`.** Write `formatPlacement(placement)` into `heroCollage[i].className`, leaving `src` untouched. **A tile whose photo she also replaced this session must keep both changes** — the staged key is the index-based `renderImage` path, so this should work; test it rather than asserting it.

- [ ] **Step 5: Test it the way Plan 5's control broke**

Real Chromium against a **vite-served `/edit`**, logged in, clicking the real button at real page coordinates, asserting the registry's `galleries.json` value changed and the tile moved. Not a jsdom render, not a direct handler call. Drive the touch path with `pointerType: 'touch'` on a touch-emulating context — **a stubbed `matchMedia` does not count**.

- [ ] **Step 6: Commit**

---

## Task 4: Drag to move and resize

**Files:**
- Modify: `src/admin/CollageTile.tsx`, its tests

- [ ] **Step 1: Pointer Events, and the three properties that make drag work at all**

One code path for mouse and pen. `setPointerCapture` so a fast drag leaving the element still tracks. No drag library — a 6×6 grid with cell-sized drop targets is arithmetic on `getBoundingClientRect()`.

Three things the drag will not work without, and none is optional:
- `touch-action: none` on the tile — without it the browser scrolls and fires `pointercancel` mid-drag
- `draggable={false}` on the `<img>` — native HTML5 image drag hijacks the pointer sequence on desktop
- `user-select: none`

State whether coarse pointers get drag **as well as** buttons, or buttons only.

- [ ] **Step 2: Snap to cells; say what a refused drop looks like**

The tile follows the pointer and commits only to a whole cell. A drop that runs off the grid does not commit. Call Task 1's validator rather than reimplementing the rule.

**Say what she sees.** A drag with no ghost, no drop-target highlight and a silent snap-back reads exactly like Plan 5's inert camera badge did. A refused drop must produce visible feedback, not silence.

Resize is the same arithmetic on a corner handle: it changes span, not start.

- [ ] **Step 3: Auto-placed tiles are the hard case**

Entries 0, 2 and 4 have auto rows; entry 2 is auto on both axes. Their rendered positions are **emergent** from the sparse cursor and document order, so:

- **Pinning one tile relocates others.** Dragging any explicitly-placed tile silently moves the auto-placed ones. Dragging tile 2 itself takes it out of the auto-flow and changes where tile 4 lands.
- **A drag on an auto-placed tile has no starting position to read** — `className` does not contain one, so the UI must read it from layout, and the value it computes must be one `formatPlacement` can emit and the validator accepts.

Decide what the user sees when a drag moves tiles she did not touch. Silently is not an answer.

- [ ] **Step 4: Undo**

Plan 5's review found "she could not undo her own edit" as a Critical. A drag is far easier to trigger accidentally than a text edit and has no natural inverse — she cannot retype `col-start-4 col-span-1 row-start-5` from memory. At minimum: **Escape cancels an in-flight drag**, and the plan states explicitly whether Discard is the only undo for a committed one.

- [ ] **Step 5: Test as in Task 3 Step 5** — real Chromium, vite-served `/edit`, `mouse.down/move/up` at real coordinates.

- [ ] **Step 6: Commit**

---

## Task 5: Publish, and pin what the safelist promised

**Files:**
- Modify: `src/admin/EditMode.tsx`, `src/test/collage-css.test.ts`

- [ ] **Step 1: Publish through the existing path**

`galleries.json` is already one of the five files `/edit` can write, so a placement edit should ride the existing publish with **no new plumbing**. Confirm that rather than adding any.

- [ ] **Step 2: Pin all 24 positions, not just the used ones**

Extend `collage-css.test.ts` to assert every one of the 24 ships — including positions no tile currently occupies. Mutation: drop one safelist entry and the test must name it.

This is what stops a future "trim the safelist, nothing uses `col-start-1`" commit from making one column silently unreachable by drag — the exact defect this plan opened with, reintroduced by a tidy-up.

- [ ] **Step 3: Commit**

---

## Definition of done

- [ ] `npm run test`, `npm run test:deploy`, `npx tsc -b --noEmit`, `npm run build`, `npx eslint .` all clean. Record the count.
- [ ] Every distinct utility in `galleries.json` has a rule in the built CSS, and all 24 grid positions ship.
- [ ] No grid utility ships because a test file spells it out.
- [ ] All sixteen tiles resolve inside rows and columns 1–6; none lands in an implicit row.
- [ ] Before/after tile geometry recorded from a real browser; 14 tiles move.
- [ ] Before/after screenshots at 390px and 1440px, and her yes, in the Task 2 commit message.
- [ ] The homepage byte count is restated: Task 2 edits `galleries.json`, so 53473 **will** move. Give the new number and what accounts for it. (A CSS-only change would not have moved it, which is precisely why that test is not this plan's guard.)
- [ ] `formatPlacement(parsePlacement(x)) === x` for all sixteen real entries, byte-identically.
- [ ] A placement that does not parse, is out of range, runs off the grid, or resolves into an implicit row is refused by `validateContent`. Overlap is **not** refused.
- [ ] `Hero.test.tsx:49` is replaced by a real resolved-layout check sharing code with the validator.
- [ ] A real click and a real drag, in real Chromium against a vite-served `/edit`, each move a tile and change the JSON.
- [ ] The buttons produce results identical to drag, are reachable at 390px with no hover, and are reachable by keyboard on a fine pointer.
- [ ] Selecting a tile and replacing its photo are separately reachable at 390px.
- [ ] A tile moved **and** photo-replaced in one session keeps both changes.
- [ ] Escape cancels an in-flight drag; the undo story for a committed one is stated.
- [ ] A placement edit publishes through `publish.ts` with no forked logic.
- [ ] The CSS ceiling is 32900 against a measured 32674, with the rule-level diff stated.

## Handed to later plans

- **Plan 7 (Section templates)** adds template types to Plan 4's descriptors. `Page { slug, name, inNav, sections }` is the first nested list-of-records.
- **Still open from Plan 5:** `dish.name`, `drink.name`, `article.title` and `article.publication` are each both a text child and an attribute, so none is editable in place — that is every dish name, drink name and article title on the page. `copy.nav.links[*].label` is visible text editable nowhere.
- **Still unowned:** the 12×-repeated file-level validation message; the silent `localStorage`-quota swallow; orphaned staged bytes on Discard and row-remove; a drink's photo that cannot be cleared; a stale `dist/` making plain `npm run test` check an artifact that need not match source.
