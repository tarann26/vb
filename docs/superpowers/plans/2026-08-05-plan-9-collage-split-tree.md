# Collage as a Split Tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The hero collage becomes a fluid, editable arrangement. Dragging a photo onto another **swaps** them — each photo fills whichever box it lands in. Dragging a divider **resizes both boxes either side of it**, so making one wider takes space from its neighbour instead of being refused.

**Architecture:** Replace sixteen CSS-Grid placement strings with one nested tree of splits. A node is either a photo or a split (row or column) holding children with proportional sizes. Rendering is nested flexbox driven by inline `flex-grow` — no generated class names anywhere.

**Tech Stack:** React 18, TypeScript strict, Tailwind 3 (for chrome only, not layout), Vitest, Playwright.

## Why this is a rewrite and not an adjustment

The owner asked for two things the current model structurally cannot do:

> "when I move the picture to the left, I would rather have it go into the entire white box, and the picture in the white box takes the place of the picture I move"
>
> "if I drag the same picture to the left to increase the width of the box, the box to the left should shrink to make space for this"

Today each photo owns absolute grid coordinates (`col-start-5 col-span-2 row-span-2`). Moving one changes its own coordinates and nothing else's; a destination that is occupied is **refused**, which is the red *"Can't make this wider — that would push another auto-placed photo off the collage grid"* she hit. Nothing can move out of the way, because nothing knows about anything else.

A split tree makes neighbours structural: two boxes either side of a divider share a fixed span, so one growing **is** the other shrinking. That is not a feature added to the grid model; it is a different model.

## The migration is a re-author, and this is the decisive fact

**The current layout cannot be expressed as a split tree.** Verified, not assumed: the sixteen tiles resolve to these rectangles (tile, row, col, rowspan, colspan) —

```
(0,0,4,2,2) (1,4,4,2,2) (2,1,0,2,2) (3,1,2,2,2) (4,0,2,1,2) (5,5,2,1,2)
(6,2,4,2,1) (7,2,5,2,1) (8,1,2,1,1) (9,1,3,1,1) (10,2,1,1,1) (11,2,4,1,1)
(12,3,1,1,1) (13,3,4,1,1) (14,4,2,1,1) (15,4,3,1,1)
```

— and a guillotine-sliceability check over that set returns **false**. There is no sequence of straight edge-to-edge cuts that produces it, which is exactly what a split tree can express. (This is the classic sliceable-vs-non-sliceable floorplan distinction; a pinwheel of five rectangles is the smallest example.)

So Task 3 **re-authors the arrangement**. That is acceptable here for a reason specific to this project: the current layout was authored blind. The Tailwind content glob never scanned `.json`, so seven of its fourteen grid utilities were absent from the shipped stylesheet and nine photos rendered in implicit rows that `overflow-hidden` clipped away entirely. Nobody has ever seen the authored layout render. There is no approved arrangement to preserve.

**Show her before and after anyway** — see Task 3 Step 3.

## What this deletes

Worth stating because it is most of the reason to be confident:

- `src/content/placement.ts` — parse/format/resolveLayout, and its reimplementation of CSS Grid's sparse auto-placement cursor (which a review already found deviating from the spec in the dangerous direction)
- The 24-entry Tailwind `safelist` in `tailwind.config.js`
- `src/test/collage-css.test.ts` — the guard that every grid utility ships
- The grid-placement rules in `src/content/validate.ts` and `src/content/guards.ts`
- `CollageTile.tsx`'s move/resize-by-cell arithmetic and its off-grid refusal messages

**Layout stops being class names.** A split ratio is a number in `style`, so Tailwind never needs to see it. The entire "Tailwind cannot scan JSON" hazard — which cost this project nine invisible photos and a day of debugging — stops applying to the collage.

## Global Constraints

- **Branch `main`. Never push without the orchestrator.** The site is live at `vb.aionxxxi.uk`.
- **`npx tsc -b --noEmit`, never `npx tsc --noEmit`.** The root tsconfig is solution-style with `"files": []`, so the plain form checks nothing and exits 0 on any codebase.
- **A test that cannot fail is a defect.** ~50 caught here. Name the mutation, apply it to real executable source, run it, confirm red, revert.
- **Tailwind scans comments and has no JS parser.** The bare words "outline", "ring", "contents", "resize", "lowercase", "grow" have each emitted a bogus rule here — twice inside comments warning about it. Note that **"grow" is now a live hazard for this plan specifically**, since `flex-grow` will be discussed constantly in prose. Write it as `flexGrow` or "the grow factor" and check the rule-level diff.
- **The homepage byte count moves.** It is pinned in `src/test/homepage-bytes.test.tsx`; state the old and new numbers and what accounts for them.
- **jsdom has no layout engine.** Every claim about what is draggable, droppable or visible belongs in `e2e/`. Close every browser.
- Commit messages in the style of `git log --oneline -5`. Never mention AI or any assistant.

---

## Task 1: The tree

**Files:**
- Create: `src/content/collage.ts`, `src/content/__tests__/collage.test.ts`
- Modify: `src/content/types.ts`, `src/content/guards.ts`, `src/content/validate.ts`

- [ ] **Step 1: The shape**

```ts
type CollagePhoto = { kind: 'photo'; src: string; alt: string };
type CollageSplit = { kind: 'split'; direction: 'row' | 'column'; children: CollageNode[]; sizes: number[] };
type CollageNode  = CollagePhoto | CollageSplit;
```

Decide and defend: n-ary children with a `sizes` array, or strictly binary splits with one ratio. N-ary maps directly onto flexbox and keeps trees shallow; binary makes every divider unambiguous and every resize a two-party negotiation. **Whichever you choose, a divider must always resolve to exactly two adjacent boxes** — that is the owner's requirement, and it is the thing to preserve.

`sizes` are proportions, not pixels or percentages. Normalise on write so they always sum to a known value; a tree whose sizes drift is a tree that renders differently after a round trip.

- [ ] **Step 2: Reuse the `Record<K, true>` completeness idiom**

`src/content/guards.ts:85`'s `SECTION_ID_SET` is a `Record<SectionId, true>` rather than an array, and its comment records why: an array literal checks each element but never that every member is present, and the author confirmed the array version left `tsc -b` clean with a new member entirely unenforced. Do the same for `direction` and for the node `kind` discriminant.

- [ ] **Step 3: Validate server-side**

`validateContent` must refuse: a split with fewer than two children, `sizes.length !== children.length`, any size `<= 0`, a non-finite size, a photo with a blank `src`, and a tree deeper than a stated limit (pick one and say why — an unbounded tree is a rendering stack the browser has to walk).

Named assertions of the form "collage tree X is refused by `validateContent`", alongside the existing ones.

- [ ] **Step 4: Commit**

---

## Task 2: Rendering

**Files:**
- Modify: `src/components/Hero.tsx`, `src/content/ContentContext.ts`
- Delete: `src/content/placement.ts` and its tests, the `safelist` in `tailwind.config.js`, `src/test/collage-css.test.ts`

- [ ] **Step 1: Nested flex, sized inline**

A split renders as a flex container (`row` or `column`); each child gets `style={{ flexGrow: size, flexBasis: 0 }}`. A photo renders as its `<img>` filling its box with `object-cover`.

`flexBasis: 0` matters: without it, an image's intrinsic width leaks into the size calculation and the ratios stop meaning what they say. Test that a wide photo and a narrow photo in a 1:1 split render equal.

- [ ] **Step 2: Keep the editing channel**

Photos still render through `content.renderImage(path, props)` — Plan 5's channel — so `/edit` keeps working. The path scheme changes (there is no `heroCollage.5` any more); decide what identifies a photo in a tree and make sure it survives a swap. **A path that is positional will name a different photo the instant two are swapped**, which is exactly the class of bug this project has hit repeatedly.

- [ ] **Step 3: Delete the grid machinery, and prove nothing needed it**

Removing the safelist must not remove a rule something else uses. Rule-level CSS diff from a **worktree checkout** of the parent commit — report added and removed separately. This should be a large net removal.

- [ ] **Step 4: Commit**

---

## Task 3: Re-author the arrangement

**Files:**
- Modify: `src/content/galleries.json`

- [ ] **Step 1: Build a tree that holds all sixteen photos, as close to today's arrangement as a tree allows**

The owner's decision: *"just build something with the arrangement we have right now"*, and on how close it needs to be — *"dont care, but again close to what we have, but if not, its chill"*.

So: approximate the live arrangement, do not redesign it. It cannot be an exact translation — see the sliceability finding above — so treat the resolved rectangles as a target to get near, not a spec to satisfy. Where a straight cut cannot reproduce a region, choose the nearest arrangement that can and keep the same photos in roughly the same neighbourhood.

Constraints worth respecting while approximating: the logo circle and the reservation text sit over the middle of the hero, so the centre should carry the calmest photos; the two "Farfalle" brand cards read as texture rather than content and belong at the edges.

- [ ] **Step 2: The public homepage moves**

State the old and new byte counts. The rendered markup changes shape entirely (nested divs instead of a flat grid), so expect a large difference and account for it.

- [ ] **Step 3: Show her**

Before/after screenshots at **390px and 1440px**, and one sentence she can act on. Her yes goes in the commit message. She has already accepted that this is a re-author, but she has not seen the result — and this is the hero of her restaurant's homepage.

If she is unreachable, stop and report rather than shipping the change on her behalf.

- [ ] **Step 4: Commit**

---

## Task 4: Swap by drag

**Files:**
- Modify: `src/admin/CollageTile.tsx` (or replace it), `src/admin/EditMode.tsx`

- [ ] **Step 1: Drag a photo onto another and they trade places**

The owner's decision, in her words: *"The boxes keep their shape. The photos are the ones — it's like the photo fills the box it travels to."* So a swap exchanges the two `{src, alt}` payloads and **leaves the tree's structure untouched**. No box moves; no size changes.

Drop on a non-photo (a divider, the gap, outside) is a no-op that returns the photo home, **visibly** — a silent snap-back reads exactly like the inert camera badge this project already shipped once.

- [ ] **Step 2: Show the target before the drop**

She is dragging a photo across a dense collage; she needs to see which box will receive it. Highlight the drop target under the pointer.

- [ ] **Step 3: Pointer Events, and the three properties without which drag does not work**

`touch-action: none` on the drag surface (or the browser scrolls and fires `pointercancel` mid-drag), `draggable={false}` on the `<img>` (native HTML5 image drag hijacks the pointer sequence), and `user-select: none`. All three were needed for the previous collage drag; they are needed again.

**And `draggable={false}` must not reach the public page.** Plan 6 shipped it through `renderImage` and cost 288 public bytes for an editor-only need; the fix was an edit-only `dragstart` handler on the wrapper, since `dragstart` bubbles. Do that from the start.

- [ ] **Step 4: Test it the way this project's drags have broken**

Real Chromium against a **vite-served `/edit`**, logged in, `mouse.down/move/up` at real page coordinates, asserting the two photos actually exchanged in the registry. jsdom cannot do this. Firing `pointerdown` in jsdom and calling it a drag is the same evasion that shipped Plan 5's photo control completely inert.

- [ ] **Step 5: Commit**

---

## Task 5: Resize by divider

**Files:**
- Modify: `src/admin/CollageTile.tsx`, its tests

- [ ] **Step 1: Drag the line between two boxes**

A divider belongs to a split and sits between two adjacent children. Dragging it moves size from one to the other, **conserving their total** — that is what makes the neighbour shrink rather than the layout being refused.

Pointer position maps to a proportion of the split's own box, so the photo tracks the cursor rather than moving in fixed steps.

- [ ] **Step 2: A minimum, so a box cannot vanish**

Pick one and say why. A box dragged to zero is a photo she can no longer see or select, and no obvious way back.

- [ ] **Step 3: Touch**

The spec's Risks section is a mandate, not a preference: *"On phones she gets tap-to-select with plus, minus and arrow buttons instead."* A divider is a few pixels wide; on a 390px screen it is not a touch target. Tap-to-select a box, then buttons to grow and shrink it — the same data, the same conservation rule, different controls.

- [ ] **Step 4: Replace the empty control panel**

Her words: *"I don't know why we have this kind of a thing at the bottom, like a control panel which has no information in it."* Whatever the panel becomes, it must show **which photo** it is controlling — a thumbnail, not just "Photo 5 of the collage".

- [ ] **Step 5: Commit**

---

## Task 6: Add and remove photos

**Files:**
- Modify: `src/admin/CollageTile.tsx` (or its replacement), `src/content/collage.ts`, `src/content/validate.ts`

The owner: *"the tree should be able to grow. like from the client console, we should be able to insert or remove pictures, but have a minimum picture cap ... and a upper limit."*

- [ ] **Step 1: Adding is splitting; removing is collapsing**

This is the payoff of the tree model: there is no free cell to find and no grid to fit into.

- **Add** — pick a photo, choose a direction, and that photo's box becomes a split holding the original and the new one. Everything else keeps its proportions; only the chosen box subdivides. Decide whether she picks the direction or it is inferred from the box's aspect (a wide box splits vertically, a tall one horizontally) and defend the choice — inferring is fewer decisions for her, but it will sometimes guess wrong.
- **Remove** — the photo's sibling takes over the whole of their shared box, and the now-single-child split collapses into its parent. **Collapsing matters:** without it every removal leaves a redundant split behind, the tree deepens forever, and after enough edits a divider drag moves something she did not point at.

Both operations must leave `sizes` normalised and the tree valid by Task 1's rules.

- [ ] **Step 2: The caps, and the numbers**

**Minimum: 1.** Her words — *"realistically no picture would look ugly but we should be able to go down to that"* — so the floor exists to prevent a broken state, not to enforce taste. One photo is a legitimate design (a full-bleed hero) and is the smallest tree that still renders. Zero is not allowed: a split needs children, and the hero would have no background at all.

**Maximum: 24.** Measured, not guessed. The sixteen current photos average **53 KB** each (848 KB total), and this collage is entirely above the fold:

| photos | weight above the fold | average tile on a 390×844 phone |
|---|---|---|
| 16 (today) | 0.83 MB | 143 px |
| 20 | 1.04 MB | 128 px |
| **24** | **1.24 MB** | **117 px** |
| 30 | 1.55 MB | 105 px |
| 36 | 1.86 MB | 96 px |

24 is where both curves are still acceptable: half again as many photos as today, comfortably under 1.5 MB for a hero, and tiles still large enough on a phone to recognise what they are. Past that the page gets heavy for a restaurant's first impression and individual photos stop reading as anything.

Enforce both in `validateContent`, not only in the UI — the UI is where she is told, the validator is what makes it true. Named assertions: a tree with zero photos is refused; a tree with 25 is refused.

- [ ] **Step 3: Tell her at the boundary, before she hits it**

At 24, the add control disables with a sentence saying why — not a silent no-op, and not an error after the fact. At 1, the same for remove. This project has shipped a silent refusal before (the collage's own *"Can't make this wider"* was at least visible; the camera badge that did nothing was not).

- [ ] **Step 4: Adding needs a photo**

Adding a box and then having to find the camera badge inside it is two steps for one intention. Decide whether "add" opens the picker immediately, or inserts a placeholder box she fills afterwards. If a placeholder, it must be obvious it is empty and `validateContent` must refuse publishing one — a blank box shipped to the live homepage is worse than no button.

- [ ] **Step 5: Commit**

---

## Definition of done

- [ ] `npm run test`, `test:deploy`, `test:e2e`, `tsc -b --noEmit`, `npm run build`, `eslint .` all clean. Record the count.
- [ ] `tailwind.config.js` has no `safelist`, and `src/content/placement.ts` no longer exists.
- [ ] A malformed tree — too few children, mismatched `sizes`, a zero or non-finite size, too deep — is refused by `validateContent`, each with its own named assertion.
- [ ] A 1:1 split renders two equal boxes regardless of the intrinsic size of the photos in them.
- [ ] Dragging photo A onto photo B exchanges exactly those two photos and changes **no** box.
- [ ] A refused or cancelled drop returns the photo visibly, never silently.
- [ ] Dragging a divider grows one box and shrinks its neighbour by the same amount; their total is unchanged.
- [ ] No box can be reduced to zero.
- [ ] Both gestures are proven in real Chromium against a vite-served `/edit`, at 390px and 1440px.
- [ ] The touch path is driven with `pointerType: 'touch'` on a touch-emulating context — a stubbed `matchMedia` does not count.
- [ ] `draggable="false"` appears nowhere in the public homepage's markup.
- [ ] The control panel shows which photo it controls.
- [ ] Adding a photo subdivides exactly one box and leaves every other proportion unchanged.
- [ ] Removing a photo gives its box to its sibling and collapses the redundant split, so repeated add/remove cycles do not deepen the tree.
- [ ] `validateContent` refuses a collage with 0 photos and one with 25; the UI disables the control at each boundary with a reason.
- [ ] A placeholder box with no photo cannot be published.
- [ ] The homepage byte count is restated with the reason, and before/after screenshots plus her yes are in the Task 3 commit.

## Handed forward

- **Still open:** `dish.name`, `drink.name`, `article.title` and `article.publication` are each both a text child and an attribute, so none is editable in place. `copy.nav.links[*].label` is visible text editable nowhere.
- **Phase C content** still needs the B2B client list, the breads-and-dips product list, and photography.
