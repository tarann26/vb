# Section Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** She can add a new section to the homepage, and create whole new pages, without a developer. Five templates cover the six Phase C sections the business actually needs.

**Architecture:** The homepage's ordered section list stops being seven fixed ids and becomes a list of two kinds: **bespoke** sections rendered by name (the seven that exist), and **template** sections rendered by type with their own content. Both sit in one ordered list obeying the same toggles. Pages are the same list with a slug and a nav flag.

**Tech Stack:** React 18, React Router 7, TypeScript strict, Tailwind 3, Vitest, Playwright.

## Global Constraints

- **Branch `repair/phase-a`. Never push. Never touch `main`.** The site is live.
- **`npx tsc -b --noEmit`, never `npx tsc --noEmit`.** The root `tsconfig.json` is solution-style with `"files": []`, so the plain form checks nothing and exits 0 on any codebase.
- **The public homepage stays byte-identical at 53485** unless a task deliberately changes it. Every template section ships **disabled**, so nothing on `/` moves.
- **A test that cannot fail is a defect.** Forty-three have been caught here, including two new species: a test whose fixture dispatches at an element that is never the real event target, and a guard that goes green because it never runs in CI. Name the mutation for each test, run it, confirm red.
- **Tailwind scans comments and has no JS parser.** Ten instances of unused CSS have shipped that way. Rule-level diff from a **worktree checkout** of the parent commit, never a stash.
- **CSS ceiling `bundle.post-build.test.ts` `< 33800` against a measured 33617 — 183 bytes.** Five new components will not fit. **Expect to raise it,** with the new number and the rule-level diff.
- **jsdom has no layout and no hit-testing.** Anything about stacking, hit-testing or focus needs `e2e/` (Playwright is now wired in; `npm run test:e2e`). Close every browser you open.
- Commit messages in the style of `git log --oneline -5`. Never mention AI or any assistant; no co-author trailers.

---

## What the repo already decided, which this plan must not casually undo

1. **`SectionId` is a closed seven-member union and that closure is load-bearing.** `src/content/guards.ts:85`'s `SECTION_ID_SET` is a `Record<SectionId, true>`, not an array, and its own comment explains why: an array literal checks each element against `SectionId` but never that every member is present, so it *"would silently stop enforcing completeness the moment SectionId grows (e.g. in Plan 7)"* — confirmed by the author, who added a member and found `tsc -b` clean and the suite green with the new section entirely unenforced. `src/App.tsx:38`'s `SECTION_COMPONENTS` is a `Record<SectionId, …>` for the same reason. **Whatever shape you choose, adding a section type must remain a compile error until every site that must handle it does.**

2. **`SectionList` has no Add and no Remove, deliberately.** Its header comment (`src/admin/SectionList.tsx:15`) records that reorder *"only ever PERMUTES the seven"*, which is what makes `assertSections`'s duplicate-and-missing check a cheap after-the-fact assertion. **This plan adds Add. That invariant is being broken on purpose** — say so, and make `assertSections` carry the weight it no longer gets for free.

3. **Nothing is ever deleted, only disabled** (D6). A section or page she turns off stops rendering and leaves the nav; its content stays in the repository. Permanent deletion is a developer operation. Do not add a delete button.

4. **Every call to action is a WhatsApp deep link** (D8). No forms, no stored contact details. Every template carries an optional WhatsApp button with a pre-filled message.

---

## Two contradictions to resolve before writing code, not during

### A. The spec says sections carry `publishAt`. The code says they deliberately do not.

D9: *"Items and sections carry an optional `publishAt` date."*

`src/content/types.ts:35-48`: `Schedulable` is *"Deliberately not on `Section`: see the comment on `assertSections` in src/content/guards.ts for why a future-dated section is rejected outright rather than supported."*

**Resolve it in Task 1 and record the decision.** If sections gain `publishAt`, `assertSections`'s rejection must go and the build filter must learn about it. If they do not, the spec's D9 is narrower than written and this plan says so. Either is defensible; silently shipping one while the other is documented is not.

### B. `plugins/filter-unpublished.ts` will not filter anything this plan adds.

Its `TARGET_SUFFIXES` (`:9`) is a hand-maintained list of exactly three files: `dishes.json`, `drinks.json`, `press.json`. `types.ts:44-48` already warns that a fourth type extending `Schedulable` *"compiles clean and `tsc -b` stays silent while that type's build-time filtering silently never happens."*

Every new content file this plan creates that can carry `publishAt` must be added to that list, **and the gap itself must be closed** — a hand-maintained list with no compiler link back to the type is how this defect stays live. D9's whole point is that unpublished content is not in the page source; a missed entry ships it to every visitor's browser.

---

## Task 1: Open the section model

**Files:**
- Modify: `src/content/types.ts`, `src/content/guards.ts`, `src/content/sections.json`, `src/content/validate.ts`, `src/App.tsx`, and their tests
- Create: `src/content/pages.json`, `src/content/__tests__/pages.test.ts`

- [ ] **Step 1: `Section` becomes a discriminated union**

```ts
type BespokeSection  = { kind: 'bespoke'; id: SectionId; enabled: boolean };
type TemplateSection = { kind: 'template'; id: string; template: TemplateType; enabled: boolean; content: TemplateContent };
```

`SectionId` stays closed at seven — it names hand-built components, and nothing she does should be able to add one. `TemplateSection.id` is a free string (she creates these), so it needs its own uniqueness rule that `SectionId`'s union previously gave for free.

Keep the `Record<…, true>` idiom for `TemplateType` so a new template is a compile error in every switch, exactly as `SECTION_ID_SET` does for `SectionId`. Read that comment before choosing a shape.

**`sections.json`'s existing seven entries must migrate** to the new shape without changing what renders. The homepage byte count is the gate: **53485, unchanged.**

- [ ] **Step 2: Pages**

`Page { slug: string; name: string; inNav: boolean; enabled: boolean; sections: Section[] }` in a new `pages.json`, starting empty or with one disabled example — decide and say which.

`slug` needs a rule: unique, URL-safe, and **not colliding with an existing route.** `/`, `/blogs`, `/edit` and `/edit/manage` are all live. A page slugged `edit` would shadow the dashboard.

- [ ] **Step 3: Resolve contradiction A, and close gap B**

Decide `publishAt` on sections, record it, and make the build filter's target list impossible to forget — a type-level link, a test that enumerates every `Schedulable` type against `TARGET_SUFFIXES`, or whatever genuinely fails when they diverge. A comment warning about it is what exists now and it did not work.

- [ ] **Step 4: Validate server-side**

`validateContent` refuses: a duplicate section id, a template id colliding with a `SectionId`, a page slug that is not URL-safe or collides with a live route, a duplicate slug, an unknown template type, and a section with no matching content shape. Named assertions, alongside Plan 5 Task 6's five and Plan 6's placement rules.

- [ ] **Step 5: Commit**

---

## Task 2: The five templates

**Files:**
- Create: `src/components/templates/{TextSection,ItemListSection,GallerySection,LogoGridSection,DetailBlockSection}.tsx`, `src/components/templates/WhatsAppButton.tsx`, and their tests

| Template | Built for | Also serves |
|---|---|---|
| **Text** | Membership, catering intro | Any prose block |
| **Item list** | Breads and dips, cheeseboards | Photo + name + description |
| **Gallery** | Product or venue photos | Horizontal scroller like Atmosfera |
| **Logo grid** | B2B clients | Press logos, partners |
| **Detail block** | Kids' classes | Facts plus a button |

- [ ] **Step 1: Build them against the existing site's visual language**

The spec's own Risk says it plainly: *"As she adds template sections, the site will drift toward uniform. That is the price of her not needing a developer, and it is usually worth paying, but it is not free."* Reuse the type scale, spacing and palette the seven bespoke sections already use — `PlaceGallery` is the model for Gallery, `FoodGallery` for Item list. Do not invent a second design system.

**Two of the five may merge during implementation.** The spec says so explicitly and calls it expected. If Logo grid is Gallery with different sizing, say so and ship four.

- [ ] **Step 2: The WhatsApp button, once**

Every template carries an optional button with a pre-filled message. `Hero.tsx`'s `openReservationWhatsApp` is the existing implementation and it fires `navigator.sendBeacon('/api/wa')` — **the conversion counter the spec calls the single action that becomes revenue.** Decide whether a template button counts as a conversion. If it does, reuse that path exactly; if not, say why and keep them distinguishable server-side.

Read `Hero.test.tsx`'s eleven cases first — `window.open` must be called synchronously in the same tick as the click and **before** the beacon, and the beacon must never break the link.

- [ ] **Step 3: Every template renders through the content channel**

`useContent()`, `renderText`, `renderImage` — Plan 5's channels, so `/edit` gets these for free. A template that reads its content directly is a section she cannot edit in place.

- [ ] **Step 4: Raise the CSS ceiling**

Five components will not fit in 183 bytes. New number, rule-level diff from a worktree checkout, and confirm no comment-scan leaks — five bare English words have caused these here already.

- [ ] **Step 5: Commit**

---

## Task 3: Routes and nav

**Files:**
- Modify: `src/App.tsx`, `src/components/NavBar.tsx`, `src/components/SeoHead.tsx`, `public/sitemap.xml` (or its generator), and their tests

- [ ] **Step 1: A dynamic route that cannot shadow a live one**

`/:slug` for pages. React Router 7 ranks by specificity so `/blogs` and `/edit` should win, but **verify it** rather than assuming — Plan 5 verified the same property for `/edit` vs `/edit/manage` and it is now pinned by a regression test. Do the same here, including `/edit` and `/edit/manage`.

A disabled page 404s. A page that does not exist 404s. Both through the existing `NotFound`.

- [ ] **Step 2: One nav, not two**

`copy.nav.links` is a hand-maintained list whose entries carry `section: SectionId` (`NavBar.tsx:18` filters on `enabledSectionIds`). Pages have their own `inNav` flag. **That is two mechanisms for one nav bar and they will drift.**

Decide how a page reaches the nav and make the two agree by construction. And note the standing gap this touches: `copy.nav.links[*].label` is visible text editable **nowhere** — excluded from `COPY_FIELDS` as an array. If this task gives nav links a real editor, say so; if not, the gap survives and should be recorded again.

- [ ] **Step 3: A new page must be findable**

`SeoHead` currently takes `emitMetadata` and is mounted by `HomePage`. A page with no title, description or canonical is a page Google will not rank. Decide what a page's metadata is and where it comes from. `public/sitemap.xml` lists routes and `src/test/crawlers.test.ts` pins them — a new page that is not in the sitemap is invisible.

- [ ] **Step 4: Commit**

---

## Task 4: The dashboard grows Add

**Files:**
- Modify: `src/admin/SectionList.tsx`, `src/admin/AdminApp.tsx`, `src/admin/fields.ts`, and their tests
- Create: `src/admin/PageList.tsx`, `src/admin/TemplateContentForm.tsx`, and their tests

- [ ] **Step 1: Add a section — the invariant this breaks**

`SectionList`'s comment says reorder *"only ever PERMUTES the seven"*, which is exactly why duplicate-and-missing was cheap to check after the fact. Adding Add means a new id can now collide, and the seven bespoke entries must remain present and unduplicated. Make `assertSections` and `validateContent` carry that, and test the collision directly.

**Still no Remove** (D6). Disable, never delete.

- [ ] **Step 2: Template content forms**

`FieldsOf<T>` + `FieldSpec` already generate forms from a descriptor (`fields.ts:66`). Template content is per-template, so this is the first **discriminated** descriptor — `FieldsOf<TextContent>` and `FieldsOf<ItemListContent>` are different shapes behind one `template` value.

`RecordForm`, `RecordList`, `Field` and `problems.ts` are recorded as solid and mutation-tested. Build on them; do not fork.

- [ ] **Step 3: Pages are the first nested list-of-records**

`Page.sections` is a list inside a list. Every existing list in the dashboard is flat. `GalleryList.tsx:94`'s `useRowIds<T>()` — a `WeakMap` keyed on the record object — is the existing answer to stable row identity, **and Plan 6 found its limit**: a commit path that creates `{...entry, changed}` mints a new object and orphans the id. Read Plan 6's ledger on that before reusing it.

- [ ] **Step 4: Commit**

---

## Task 5: `/edit` and publish

**Files:**
- Modify: `src/admin/EditMode.tsx`, `src/test/bundle.post-build.test.ts`, and their tests

- [ ] **Step 1: Template sections are editable in place**

They already render through `renderText`/`renderImage` (Task 2 Step 3), so this should be wiring, not new machinery. `EditMode` fetches a fixed set of content files — `pages.json` and any template content file must join it, and the **per-file fetch guard** must cover them (Plan 5's Critical: a boolean guard stranded `/edit` permanently after a 401; the rule is *never clobber, but do fill what is empty*).

- [ ] **Step 2: Publish through the existing path**

Reuse `publish.ts` unchanged — `baseSha` per file, staged-reference scrubbing, the 8-photo cap, the typed 409. Confirm no new plumbing rather than adding any. `registry.updateData`, never `register`.

- [ ] **Step 3: `/edit` renders a page, not only the homepage**

`EditMode` mounts SEO, Navbar, the homepage sections and Footer. A page she creates is not reachable there, so she could create a page she cannot edit in place. Decide and state whether `/edit` gains a page route now or pages are dashboard-only for this plan.

- [ ] **Step 4: Commit**

---

## Definition of done

- [ ] `npm run test`, `npm run test:deploy`, `npm run test:e2e`, `npx tsc -b --noEmit`, `npm run build`, `npx eslint .` all clean. Record the count.
- [ ] The public homepage is **53485 bytes**, unchanged — every template section ships disabled.
- [ ] Adding a `TemplateType` without handling it everywhere is a **compile error**, proven by adding one and reading `tsc -b`'s output.
- [ ] `publishAt`-on-`Section` is resolved: the code and the spec agree, and the decision is written down.
- [ ] Every `Schedulable` content file is in `TARGET_SUFFIXES`, enforced by something that fails when they diverge — not a comment.
- [ ] `validateContent` refuses a duplicate section id, a template id colliding with a `SectionId`, a bad or colliding slug, an unknown template, and mismatched content.
- [ ] `/:slug` does not shadow `/`, `/blogs`, `/edit` or `/edit/manage`, pinned by a regression test.
- [ ] A disabled page and a nonexistent page both 404.
- [ ] A new page appears in the nav, the sitemap and its own metadata — or the plan records why not.
- [ ] She can add a section to the homepage from the dashboard, and it cannot collide with the seven bespoke ids.
- [ ] There is no Remove button anywhere.
- [ ] Every template's WhatsApp button opens the link synchronously and never breaks on a beacon failure.
- [ ] Template sections are editable at `/edit` and publish through `publish.ts` with no forked logic.
- [ ] The CSS ceiling is raised deliberately, with the new number and the rule-level diff.

## Handed to Plan 8

- **Plan 8 (Phase C content)** authors the six new sections through this dashboard. It is **blocked on the founder** for: the B2B client list, the breads-and-dips product list, and photography for the new sections.
- **Still open:** `dish.name`, `drink.name`, `article.title` and `article.publication` are each both a text child and an attribute, so none is editable in place. `copy.nav.links[*].label` is visible text editable nowhere.
- **The collage layout question is unresolved and needs the owner** — `galleries.json`'s authored layout was never rendered by anyone (the CSS never worked), and restoring it looks worse than the accidental auto-placed fallback the site has been showing. Either re-author the sixteen strings or accept the authored layout; the code is right either way.
- **Still unowned:** the 12×-repeated file-level validation message; the silent `localStorage`-quota swallow; orphaned staged bytes on Discard and row-remove; a drink's photo that cannot be cleared; a stale `dist/` making plain `npm run test` check an artifact that need not match source.
- **Ordering constraint (repair-review M2), recorded rather than fixed:** `AdminApp.tsx`'s and `PageList.tsx`'s own writes always rebuild a section list as `[...bespokeItems, ...templateItems]` — a new template section is permanently ordered after every bespoke one and can never sit *between* two bespoke sections (e.g. between Our Story and Atmosfera). Only Visit Us being last is guaranteed by the seven bespoke ids' own fixed order; a template section always lands after ALL of them. This was previously disclosed only in a code comment, not in this plan's own text, even though it is a visible constraint on this plan's own headline goal ("she can add a section"). Fixing it for real means `TemplateSectionList`/`SectionList`'s shared `rowPrefix` addressing (both keyed on a bespoke-first, template-second array layout) would need to become order-agnostic across both files — real, scoped work for a future plan, not attempted here.
