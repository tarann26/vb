# Edit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/edit` — the real homepage, rendered by the real components, with an editing layer over it. The owner clicks a heading and rewrites it, hovers or taps a photo and replaces it, presses Publish, and the same Worker commits it.

**Architecture:** Public components keep rendering exactly what they render today. Each reads content through `useContent()`, whose default is the same static import, and wraps its editable values in `content.renderText(path, value)` / `content.renderImage(path, props)`, whose defaults are the identity. With no provider the output is byte-identical and the types stay honest. `/edit` mounts a provider holding live content plus real render functions.

**Tech Stack:** React 18, React Router 7, TypeScript strict, Vitest, Testing Library. No new runtime dependency.

## Global Constraints

- **Branch `repair/phase-a`. Never push. Never touch `main`.** The site is live.
- **`npx tsc -b --noEmit`, never `npx tsc --noEmit`.** The root `tsconfig.json` is solution-style with `"files": []`, so the plain form checks nothing and exits 0 on any codebase.
- **The homepage stays byte-identical at 53473 bytes.** `src/test/homepage-bytes.test.tsx` is that gate — **do not write a second copy of it**; this plan edits every rendered component, so that one file is the most important thing standing between this work and a visibly changed live site.
- **Two separate bundle guards, and they cover opposite edges.** `src/test/bundle.test.ts` + `bundle.post-build.test.ts` keep `src/admin/` out of the entry chunk (`src/App.tsx` is the only file allowed to reference admin code, and only through `React.lazy`). `src/admin/__tests__/content.test.ts` keeps `src/admin/` from importing the stale `src/content` snapshot — that is where the twelve import forms live. Do not conflate them.
- **A test that cannot fail is a defect.** Twenty-four have been caught here, several from this orchestrator's own briefs. The recurring shape is a fixture that cannot reach the state its test names. For each test, name the mutation that makes it fail, then run it.
- **Tailwind scans comments**; ten instances of unused CSS have shipped that way. The rule-level build diff is the only method that has ever caught one, baselined from a **worktree checkout** of the parent commit, never a stash.
- **The CSS ceiling has ~216 bytes of headroom** (`bundle.post-build.test.ts:215` asserts `< 31000`; measured 30784). An overlay, a hover state and editor chrome will not fit. **Expect to raise it** — state the new number and the rule-level diff that justifies it.
- Six components are parked and unrendered (`AdminReservations`, `ReservationForm`, `ReservationPage`, `ChefGallery`, `NewsPress`, `SignatureMocktails`). A test fails if any is deleted.
- Commit messages in the style of `git log --oneline -5`. Never mention AI or any assistant; no co-author trailers.

## What Plan 4 handed over

1. **The registry owns the sha; a section must never pass one on an edit.** All nine sections overwrote the refreshed sha with their load-time copy, so the *second* publish of a file in one session was refused with a false *"Someone else published while you were editing."* Use `ContentRegistry.updateData`, never `register`, on an edit.
2. **A staged-file key must be an identity the stage does not mutate.** See Task 4 — the obvious key collides on eight real rows.
3. **"Anything the tools can produce must pass the deploy gate" is established nowhere.** Task 6.
4. **`RecordForm`, `RecordList`, `Field` and `problems.ts` are solid** and fail correctly under mutation. Build on them.

## The mechanism, and why it is not value substitution

D3 requires reusing "the **same components the public site uses**, wrapped rather than reimplemented."

Every public component does `import { site, galleries, copy } from '../content'` — module-level bindings, no props. A React provider cannot override that.

**A module-level binding *can* be overridden** — ESM exports are live bindings, and this repo already swaps `../../content` wholesale with `vi.doMock` in three test files. That is not the reason to reject it. The reasons are:

1. The replacement content is **fetched**, and a synchronous module binding cannot express async.
2. It is process-global: after editing at `/edit`, `BlogTeaser`'s "View all" (`navigate('/blogs')`) would render `/blogs` with unsaved edits presented as live.
3. It abandons re-render-on-change, forcing a manual force-update per keystroke — the caret-loss shape `TagsInput` already paid for.
4. It does not fix `Drinks.tsx`'s module-scope capture, so a component edit is required regardless.

So: **`useContent()`, defaulting to the static import.**

**And editability travels as render functions, not as substituted values.** An earlier draft had the provider return React elements where the public site returns strings. That is wrong twice over:

- **Every image on the site is an attribute** — `Hero.tsx:47` `src={src}`, `OurStory.tsx:42`, `PlaceGallery.tsx:24`, `FoodGallery.tsx:23`, `Drinks.tsx:61`, `BlogTeaser.tsx:33`, `BlogsPage.tsx:65`. An element cannot go there, so value substitution can never make an image editable.
- **It requires `as unknown as Copy`**, since `Copy`'s leaves are declared `string`. That cast silences tsc on four real string operations in the shipped tree: `Hero.tsx:85` `site.strapline.replace(...)` (a `TypeError`, so `/edit` white-pages), `BlogTeaser.tsx:53` and `BlogsPage.tsx:85` `new Date(article.date)`, `Footer.tsx:57-58` `formatDayRange`/`formatTimeRange`, and `Footer.tsx:39,56` `key={phone}` — which React coerces to N identical `"[object Object]"` keys, invisible to any attribute assertion. This is the exact blind-cast class already recorded as a root cause in Plan 4 Task 7.

```ts
renderText(path: EditableTextPath, value: string): ReactNode   // default: (_, v) => v
renderImage(path: EditableImagePath, props: ImgHTMLAttributes<HTMLImageElement>): ReactNode
                                                               // default: (_, p) => <img {...p} />
```

Components call them at the JSX site. `Copy` stays `string` everywhere, tsc keeps working, and images become editable by the same channel as text. The cost is that Task 1 touches JSX — which is why that decision lives in Task 1, gated by the byte invariant, rather than being improvised in Task 4.

## What edit mode covers, stated exactly

Checked against every rendered component, because an earlier draft got this wrong.

**Covered:** the non-attribute leaves of `copy.json` **that have a `COPY_FIELDS` entry** and are rendered on a page edit mode serves, plus every `<img>` **whose `src` comes from content**.

Both qualifiers are load-bearing and an earlier draft omitted both. Without the first, this rule demands wrapping `copy.nav.links[*].label`, which the exclusion note below correctly excludes — an affordance no publish path can honour, since `CopyLeafShape` drops `nav.links` as an array and no nav-link editor exists in `src/admin/`. Without the second, it demands wrapping `Hero.tsx:44`'s `/hero/brick.webp`, a hardcoded decorative asset with no content leaf behind it: an editor there would edit nothing. Wrap exactly the 31 `COPY_FIELDS` keys that are not attribute-bound, and exactly the seven content-sourced image sites.

**Excluded, and why — three different reasons, not one:**

| Excluded | Reason |
|---|---|
| `site.name`, `site.tagline`, `seo.*` | **Permanently.** `SITE_FIELDS` marks them `readonly`; `head.test.ts` pins nine `index.html` strings to them, and `validateSiteDeveloperOwnedFields` refuses them server-side. `site.name` is the `<h1>` and `site.tagline` the line under it — the two most obvious things to click, so Task 3 must render them with no affordance. |
| `dish.name`, `drink.name`, `article.title`, `article.publication` | **Deferred.** Each is *simultaneously* a text child and an attribute (`FoodGallery.tsx:24` alt / `:30` text; `Drinks.tsx:62` / `:69`; `BlogTeaser.tsx:75` aria-label / `:62`; `:34` / `:43`). A per-path list cannot say "editable here, not there." That is every dish name, drink name and article title. |
| `site.strapline`, `article.date`, the footer hours | **Derived, not attribute-bound.** `Hero.tsx:85` renders `strapline.replace(/ /g,' ')`, so the displayed string ≠ the stored one; a DOM readback would write NBSPs into `site.json`. Same for `formatDayRange`/`formatTimeRange`. |
| phones | Text children (`Hero.tsx:93`, `Footer.tsx:39`), but an **array** — add/remove belongs in a form. |
| alt text, URLs | Genuine attributes. Already editable in the dashboard. |

**This is a defensible first increment, not full coverage of D3's "rewording any visible text."** Say so in those words. What `/edit` cannot reword in this plan: the `<h1>`, the subtitle, the strapline, 15 dish names and descriptions, 38 drink names and descriptions, 12 article titles and excerpts, Our Story's heading and paragraphs, the nav links, the phones, and the footer hours.

**One live gap to record, not fix here:** `copy.nav.links[*].label` is visible text that is editable **nowhere** — `COPY_FIELDS`'s `CopyLeafShape` covers `nav.wordmark`, `nav.instagramLabel` and `nav.menuLabel` only, excluding `nav.links` as an array, and `CopySection` renders `COPY_FIELDS`. That is an inherited D10 miss; note it in the handoff.

---

### Task 1: Every component reads content through a context, and nothing changes

**Files:**
- Create: `src/content/ContentContext.tsx`, `src/content/__tests__/ContentContext.test.tsx`, `src/test/content-context-migration.test.ts`
- Modify: `src/App.tsx`, `src/components/{Hero,OurStory,PlaceGallery,FoodGallery,Drinks,BlogTeaser,VisitUs,Footer,NavBar,BlogsPage,NotFound,SeoHead}.tsx`

**Interfaces:**
- Produces: `ContentBundle` = `{ site, galleries, dishes, drinks, press, story, menus, copy, sections, renderText, renderImage }`; `<ContentProvider value={…}>`; `useContent(): ContentBundle`.

**`src/App.tsx` is in this list deliberately** — `App.tsx:15` imports `sections` and `HomePage` filters on it at `:43`. Miss it and `/edit` shows the build-time on/off list: a section she disabled and published still renders, on the one surface whose whole value is that the preview is not a preview.

- [ ] **Step 1: Write the failing tests**

`src/test/homepage-bytes.test.tsx` already pins 53473 with the right method and a comment explaining it. **That existing file is this task's gate — do not add a second copy.**

Two new tests:

```tsx
it('renders the provider value when one is present', () => {
  const bundle = { ...defaultBundle, copy: { ...defaultBundle.copy,
    atmosphere: { heading: 'Sentinel' } } };
  render(<ContentProvider value={bundle}><MemoryRouter><AppRoutes /></MemoryRouter></ContentProvider>);
  expect(screen.getByText('Sentinel')).toBeInTheDocument();
});
```

`defaultBundle` is the bundle `useContent()` falls back to — export it for tests.

And the completeness gate, in the shape `bundle.test.ts` already uses:

```ts
it('no rendered component imports a content value directly', () => {
  const offenders = RENDERED_FILES.filter((f) =>
    /^\s*import\s+(?!type\b)[^;]*from\s*['"][^'"]*\/content['"]/m.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
```

`RENDERED_FILES` is the twelve components plus `src/App.tsx`; the six parked components are excluded by name with a comment saying why.

**That third test is the one that matters.** The byte test passes with **zero** components migrated — identical output either way. The sentinel test passes with **one** migrated. Without the completeness gate, a twelve-file migration is guarded by something that goes green at 1/12, and the failure only shows at `/edit`, where an unmigrated component renders the stale snapshot beside live content with no signal why.

- [ ] **Step 2: Default to the static import**

```tsx
const ContentContext = createContext<ContentBundle | null>(null);
export function useContent(): ContentBundle { return useContext(ContentContext) ?? defaultBundle; }
```

`defaultBundle` wraps `src/content/index.ts`'s existing exports and sets `renderText: (_, v) => v`, `renderImage: (_, p) => <img {...p} />`. **Do not change `index.ts`'s guards or exports** — they run at import and are the site's validation.

- [ ] **Step 3: Migrate, mechanically, with two named exceptions**

`import { copy } from '../content'` → `const { copy } = useContent();` in the component body. Then wrap editable sites: `{copy.atmosphere.heading}` → `{content.renderText('atmosphere.heading', copy.atmosphere.heading)}`, and each `<img …>` → `{content.renderImage(path, {…})}`.

**Two module-scope content reads exist in the rendered tree, and they fail differently.** `Drinks.tsx:8-12`'s `CATEGORY_ORDER` *eagerly* captures `copy.drinks.mocktails/cocktails/wine` into a frozen array at import. `Hero.tsx`'s `openReservationWhatsApp` *defers* its read of `site.whatsapp` to click time, but still through a module binding, so it bypasses the provider just the same. Move both into the component body. An earlier draft of this plan named only the first and called it "the one" — the implementer found the second and was right to move it. Leaving `CATEGORY_ORDER` would freeze three visible headings at build-time values while the dashboard edits those same three leaves.

**`SeoHead` migrates normally and is simply never editable.** It has no module-scope read; all nine values are interpolated into `JSON.stringify`, so there is no text child to wrap.

- [ ] **Step 4: Prove nothing moved**

Homepage **53473 bytes and DOM byte-identical** — compare with `cmp`, not length. Every pre-existing component test passes **unedited**. If one needs changing, you have changed behaviour rather than plumbing: stop and report.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(content): read content through a context so it can be overridden"
```

---

### Task 2: The `/edit` route, live content, a login that does not unmount, and dead links

**Files:**
- Create: `src/admin/EditMode.tsx`, `src/admin/__tests__/EditMode.test.tsx`
- Modify: `src/App.tsx`, `src/test/bundle.post-build.test.ts`

**Note `bundle.test.ts` needs no change** — I ran its regexes against this task's exact edit: a static `import EditMode from './admin/EditMode'` and the no-space form both already fail the guard, and `src/App.tsx` is already the allowed file. What *does* need changing is `bundle.post-build.test.ts`, whose `ADMIN_MARKERS` has two entries and whose own comment records that a module with no user-facing text leaks without moving either. Add an `EditMode.tsx` marker with its own presence test, per that file's one-presence-test-per-marker rule.

- [ ] **Step 1: Lazy route**

```tsx
const EditMode = lazy(() => import('./admin/EditMode'));
<Route path="/edit" element={<Suspense fallback={null}><EditMode /></Suspense>} />
```

React Router 7 ranks by specificity, so `/edit/manage/*` wins over `/edit` regardless of order — no ordering caution needed.

- [ ] **Step 2: Live content, per-section boundaries**

`fetchContent` per file into a `ContentRegistry`, then into `<ContentProvider>`. Never import `src/content/index.ts` from `src/admin/` — a test enforces it, including the direct-JSON form. `src/admin/content.ts:96` does a blind `JSON.parse(...) as` with no runtime validation and has already blanked a screen twice; reuse Plan 4's per-section error boundary.

- [ ] **Step 3: A 401 must not unmount the page**

This is Plan 4's Critical, verbatim, on a new surface. There, a 401 mid-edit wiped `vb:draft:v1` on in-page re-login; the fix depended on `AdminApp` never unmounting plus a render-phase restore.

If `EditMode` renders `<Login/>` **in place of** the page when `session.status === 'out'`, the tree unmounts, every in-place edit held in refs is gone, and on re-login the sections refetch and overwrite with clean server values.

So: render login as an **overlay over the still-mounted page**. `EditMode` never unmounts on `status === 'out'`. Carry Plan 4's proof obligation — drive a real 401 through `EditMode` and assert the edited value is still on screen after re-login, and that removing the guard turns that test red.

- [ ] **Step 4: The page's own links must not fire**

`/edit` renders the real components, so every link works. `BlogTeaser.tsx:89` navigates away from `/edit` entirely; `Drinks.tsx:108` starts a 9–12MB PDF download; `VisitUs.tsx:31` opens Google Maps; and `Hero.tsx:100` opens WhatsApp **and** fires `navigator.sendBeacon('/api/wa')` — so every attempt to click the reserve button *in order to reword it* pops a tab and increments the conversion counter the spec calls the single action that becomes revenue.

Add a capture-phase `click` handler on the edit-mode root that `preventDefault()`s anchors and stops propagation before content handlers run. Test: **clicking the reserve button at `/edit` fires no beacon and opens no window.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): render the real homepage at /edit with live content"
```

---

### Task 3: Editable text

**Files:**
- Create: `src/admin/EditableText.tsx`, `src/admin/editable-paths.ts`, and their tests

**Interfaces:**
- Produces: `EDITABLE_TEXT_PATHS` — the explicit list of dotted paths edit mode covers; `EditableText`.

- [ ] **Step 1: The path list, derived and then narrowed**

Start from Plan 4 Task 2's `COPY_FIELDS` flat map — do not re-derive it. Remove the leaves that are attribute-only, and exclude `site.*` entirely per the table above. That leaves 31 paths, which is exactly what Task 1 wrapped.

**A path is not a DOM identity.** `press.readArticle` renders up to ten times on `/blogs` (`BlogsPage.tsx:111`, inside the article map) and up to three on the homepage (`BlogTeaser.tsx:79`) — one leaf, N sites, all correct. Key a React `key`, a DOM `id` or an `aria-` reference on the path alone and you get N duplicate ids on one page, and clicking any "Read article" opens the editor over the first. Compose the path with the site's own index.

- [ ] **Step 2: The boundary test, which an earlier draft got wrong twice**

```ts
for (const path of EDITABLE_TEXT_PATHS) {
  // render '/', '/blogs' and an unmatched route
  // assert the path was REACHED on at least one: expect(reached).toBe(true)
  // substitute a real ELEMENT sentinel, not a string
  // assert innerHTML contains no '[object Object]' and the render did not throw
}
```

Both halves are required:

- **Render more than the homepage.** Nine of `COPY_FIELDS`'s 36 leaves never appear at `/` — `blogsPage.*` and `notFound.*`. A loop asserting "the sentinel never appears in an attribute" passes for all nine **without rendering anything at all**. Asserting each path was reached is what stops that.
- **Use an element sentinel, not a string.** Edit mode substitutes elements. With a string sentinel, `BlogTeaser.tsx:34`'s `` alt={`${article.publication} article about Via Bianca`} `` trips the check correctly — but the *real* value produces `alt="[object Object] article about Via Bianca"`, which contains no sentinel, so both assertions pass and the failing case is invisible to the test named after it.

Mutation check: adding `press.readArticle` passes; adding `visit.mapTitle` (a `title=` attribute) or any template-interpolated path fails.

- [ ] **Step 3: `contentEditable`, not an input swap**

Specify `contentEditable`, uncontrolled, buffered on focus, committed on blur. An `<input>` swap is **not** an equivalent choice: the text is styled entirely by its parent (`font-['Parisienne'] text-6xl`, `uppercase tracking-wide`), so swapping in an input changes the page's appearance while she is editing it — precisely what D3 exists to prevent.

- Escape restores the previous value and does not mark dirty.
- Blur commits, matching `TagsInput`; Plan 4's publish already force-blurs before reading the payload.
- **The U+00A0 in `copy.footer.followLabel` survives a round trip.** `validate.ts:374` refuses that field without it, and `contentEditable` normalisation is exactly where it dies. Test explicitly.
- **Tap, not hover.** The spec's Risks section already ruled this a mandate: "On phones she gets tap-to-select… instead." No hover-only cue. Test at a 390px viewport.

- [ ] **Step 4: Write back through the registry**

`registry.updateData(file, next)` — **never `register`**, which overwrites the refreshed sha and produces a false conflict on the second publish.

**Task 2's re-login proof obligation lands here, undischarged.** Task 2 could only prove the page did not unmount across a 401 — there was no edit to survive. Now there is. Drive a real 401 mid-edit through `/edit`, log back in, and assert the edited text is **still on screen and still dirty**. Task 2's per-file fetch guard is what should make this hold: a file already in the registry is never refetched, so her edit is never overwritten by a clean server value. Prove that guard is what does it — remove it and the test must go red.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): edit visible text in place on the real page"
```

---

### Task 4: Editable images

**Files:**
- Create: `src/admin/upload-photo.ts`, `src/admin/EditableImage.tsx`, and their tests
- Modify: `src/admin/PhotoField.tsx`

- [ ] **Step 1: Extract the upload pipeline — it is not exported today**

`uploadStaged` is a module-private `function` at `PhotoField.tsx:120`; the only exports are `StagedPhoto`, `PhotoFieldProps`, `MAX_STAGED_PHOTOS_PER_PUBLISH`, `MAX_STAGED_PHOTO_BYTES` and the default component. And `PhotoField` itself is a labelled form control with a visible file input and status text — it cannot be a hover-or-tap overlay.

Lift `uploadStaged` plus the HEIC, size and progress pipeline into `src/admin/upload-photo.ts`, leaving `PhotoField` as its first consumer **with its tests unedited**. If one needs editing, you changed behaviour rather than location.

The collector hook is `useStagedFiles` (`staged.ts:65`) — there is no `useStaged`.

**Know before you start: the thirty gallery paths Task 1 emitted are positional.** `Hero.tsx:53` `galleries.heroCollage.${i}`, `OurStory.tsx:43` `.ourStory.${idx}`, `PlaceGallery.tsx:24` `.atmosphere.${index}`. Entries in `galleries.json` are `{src, alt}` or `{src, className}` with **no `id` field**, so the index is the only handle the content shape offers — and deleting one photo shifts the path of every photo after it. `dishes`, `drinks` and `press` are unaffected: those paths key on `.id`, which is unique and contains no dots. This is Plan 4's handover item 2 in a second costume, so treat it as an input to Step 2's key decision rather than discovering it there.

- [ ] **Step 2: Key staged bytes on `useRowIds`, not on the content path**

Plan 4's second handover, and the obvious key is wrong here for a reason the repo can prove. **Eight image paths in `galleries.json` appear in two lists at once** — five shared between `atmosphere` and `heroCollage` (`/atmosphere/dining.webp`, `/atmosphere/ambience.webp`, `/atmosphere/ceiling decor.webp`, `/atmosphere/front mirror.webp`, `/atmosphere/room.webp`) and three between `ourStory` and `heroCollage` (`/our_story/cut.webp`, `/our_story/oven.webp`, `/our_story/stuff.webp`). Verify this yourself before relying on it — an earlier draft of this plan described the same eight as shared between `atmosphere` and `ourStory`, which is wrong; those two lists share nothing.

Key on "the content path as it was when the page loaded" and replacing the Atmosfera copy of `/atmosphere/dining.webp` evicts the staged bytes for the hero-collage tile showing the same photo, because `PhotoField.tsx:250` fires `onStaged(null)` the instant a new pick starts — so merely *opening* the second picker destroys the first. Both are visible on the homepage at once.

`GalleryList.tsx:95`'s `useRowIds` already solves this: a `WeakMap<T,string>` in a ref, keyed on the record object, written precisely because `src` is the one mutable field. Reuse it. (`GalleryImage` has no `id` — `types.ts:85` — which is why it exists.)

**Test both cases:** stage the same row three times → exactly one staged file; stage the Atmosfera row and the hero-collage tile that share `/atmosphere/dining.webp` → two staged files with distinct keys.

- [ ] **Step 3: A persistent control, not a hover reveal**

The image renders exactly as the public component renders it — same `className`, same `alt`, same dimensions. The affordance is an overlay.

Per the spec's Risks section, the control is **persistently visible**, not hover-revealed. On a 390px screen the hero collage is 16 tiles at ~60px each — the case the spec names. Test at 390px.

- [ ] **Step 4: The upload path is unchanged**

`POST /api/upload?stage=1` returns `{ path, contentPath }` without committing; bytes travel with the publish. Keep HEIC's dynamic import — the import-graph test catches a regression there and a `dist/` grep cannot, because the WASM only appears once something imports it.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): replace any visible photo in place"
```

---

### Task 5: Publish from edit mode

**Files:**
- Modify: `src/admin/EditMode.tsx`, `src/admin/drafts.ts`

- [ ] **Step 1: Reuse `publish.ts`, do not fork**

It already attaches `baseSha` per file (`publish.ts:240`), scrubs staged references out of drafts (`:310`), enforces the 8-photo cap (`:228`) and maps a typed 409 (`:429`). Each cost a Critical or an Important to get right. If the layout must differ over the real page, extract the layout, not the logic.

- [ ] **Step 2: Two tabs, one draft key — the decision, not a deferral**

`DRAFT_STORAGE_KEY` is `vb:draft:v1` and holds the whole `DraftMap`. Both surfaces edit the same files, both persist on their own edits, and nothing listens for `storage` events. So the dashboard tab's next keystroke silently overwrites the edit-mode tab's draft **for every file**, not just the one it touched.

**Decide one of these and implement it — do not leave the choice open:**
- separate keys, with the other surface's draft explicitly not offered; or
- one key with a per-file `updatedAt` merge plus a `storage` listener.

Test: tab A edits dishes, tab B edits copy, **both drafts survive**.

- [ ] **Step 3: The self-conflict wording**

Each tab holds its own `baseSha`, so publishing from one makes the other stale and the 409 says *"Someone else published while you were editing."* She is the someone else, on her own second tab, and that sentence tells her to discard work that is hers. Add wording for the same-session case.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): publish edit-mode changes through the same path as the dashboard"
```

---

### Task 6: What the tools can produce must pass the deploy gate

**Files:**
- Modify: `src/content/validate.ts`, `src/content/__tests__/validate.test.ts`

The disagreements are already enumerable — no search needed. Note the deploy-gate file is `src/content/__tests__/assets.test.ts`, not `src/test/assets.test.ts`.

| Deploy-gate rule | `validateContent` today | Reachable by |
|---|---|---|
| `PlaceGallery.test.tsx:15` alt ≠ `/^Place \d+$/` | non-blank only | the dashboard |
| `OurStory.test.tsx:22` alt ≠ `/^Slide \d+$/` | non-blank only | the dashboard |
| `FoodGallery.test.tsx:15-17` name ≠ `/^(Idk\|Pizza)\d+$/`, not `*.jpg` | non-blank only | dish names |
| `assets.test.ts` — every content asset path exists in `public/` with exact case | no filesystem access | every image replacement |
| `head.test.ts` — nine `index.html` strings pinned to `site.*` | refused server-side | must stay unreachable |

- [ ] **Step 1: Move the content-quality rules server-side**

For the first three, add rules to `validate.ts` so the Worker refuses them **before** they become a commit. A refused deploy poisons `main` until a developer edits the JSON by hand; a refused publish is a sentence she can act on.

The deliverable is **five named assertions of the form "content state X is refused by `validateContent`"** — not a report. Asset existence is already handled by `scrubStagedReferences`; assert that, don't rebuild it.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(content): refuse content the deploy gate would reject, before it commits"
```

---

## Definition of done

- [ ] `npm run test`, `npm run test:deploy`, `npx tsc -b --noEmit`, `npm run build`, `npx eslint .` all clean. Record the count.
- [ ] The homepage is **53473 bytes and DOM byte-identical** with no provider, proven by `cmp`.
- [ ] Every pre-existing component test passes **unedited**.
- [ ] Reverting any one component's migration turns the completeness test red, naming that file.
- [ ] `ContentBundle` requires no `as unknown as` anywhere; `Copy`'s leaves are still `string`.
- [ ] Every `EDITABLE_TEXT_PATH` is reached by at least one rendered route, and none produces `[object Object]`.
- [ ] `site.name` and `site.tagline` render at `/edit` with **no** edit affordance.
- [ ] `copy.footer.followLabel`'s U+00A0 survives an in-place edit round trip.
- [ ] Staging the same row three times leaves one staged file; the Atmosfera row and hero tile sharing `/atmosphere/dining.webp` leave two.
- [ ] Clicking the reserve button at `/edit` fires no beacon and opens no window.
- [ ] A 401 mid-edit leaves the edited value on screen after re-login.
- [ ] Both tabs' drafts survive concurrent edits.
- [ ] `EditMode.tsx` has a marker in `bundle.post-build.test.ts` with its own presence test.
- [ ] Text and image affordances work at a 390px viewport with no hover.
- [ ] The CSS ceiling is raised deliberately, with the new number and the rule-level diff stated.

## Handed to later plans

- **Plan 6 (Collage)** adds 2-D drag placement for `galleries.heroCollage`'s `className` grid strings on top of `EditableImage`. **Read Plan 3's ledger note first:** seven grid utilities in `galleries.json` are absent from the shipped CSS because Tailwind does not scan `.json`, so the collage is *already* laid out differently from what the file says — fixing it changes the live homepage and must be deliberate. Also: `tailwind.config.js` blocklists `blur`, so a future genuine `className="blur"` emits nothing, and a *missing* rule is invisible to the rule-level diff.
- **Plan 7 (Section templates)** adds template types to Plan 4's descriptors. `Page { slug, name, inNav, sections }` is the first nested list-of-records.
- **Deferred here, worth a later increment:** `dish.name`, `drink.name`, `article.title` and `article.publication` are each both a text child and an attribute, so none is editable in place. That is every dish name, drink name and article title on the page.
- **A live D10 miss, inherited:** `copy.nav.links[*].label` is visible text editable **nowhere** — excluded from `COPY_FIELDS` as an array, and out of this plan's scope as an attribute-free but array-shaped value.
- **Still unowned:** the 12×-repeated file-level validation message; the silent `localStorage`-quota swallow; orphaned staged bytes on Discard and row-remove; a drink's photo that cannot be cleared; a stale `dist/` making plain `npm run test` check an artifact that need not match source; and Plan 4 Task 8's "a new menu name needs a JSON change", never delivered — `menuNameFor` derives the name from `menu.file`, so a rename is unreachable rather than orphaning.
