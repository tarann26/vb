# Edit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/edit` — the real homepage, rendered by the real components, with an editing layer over it. The restaurant owner clicks a heading and rewrites it; hovers a photo and replaces it; presses Publish and the same Worker commits it.

**Architecture:** The public components keep rendering exactly what they render today. Each one stops importing content directly and reads it through a context whose **default is that same static import**, so with no provider the output is byte-identical. `/edit` mounts a provider holding live content fetched from the Worker, and an overlay that makes rendered values editable. Publishing reuses Plan 4's `publish.ts` unchanged.

**Tech Stack:** React 18, React Router 7, TypeScript strict, Vitest, Testing Library. No new runtime dependency.

## Global Constraints

- **Branch `repair/phase-a`. Never push. Never touch `main`.** The site is live.
- **`npx tsc -b --noEmit`, never `npx tsc --noEmit`.** The root `tsconfig.json` is solution-style with `"files": []`, so the plain form checks nothing and exits 0 on any codebase.
- **The rendered homepage stays byte-identical at 53473 bytes** (`src/test/homepage-bytes.test.tsx`, `TextEncoder`, not `.length`). This plan edits every rendered component, so that test is the single most important gate in it — see Task 1.
- **Nothing under `src/admin/` may reach the entry chunk.** Twelve import forms are guarded, including barrel and direct-JSON. The public components must **not** import admin code; the dependency runs the other way.
- **A test that cannot fail is a defect.** Twenty-four have been caught here, several from this orchestrator's own briefs. The recurring shape is a fixture that cannot reach the state its test names. For each test, name the mutation that makes it fail, then run it.
- **Tailwind scans comments**, and ten instances of unused CSS have shipped that way. The rule-level build diff is the only method that has ever caught one, and it must be baselined from a **worktree checkout** of the parent commit, not a stash. Avoid bare utility words in comments and test strings.
- **The CSS ceiling is now asserted** (`bundle.post-build.test.ts`). Admin-only styles ship to every visitor because Tailwind emits one stylesheet; if this plan pushes past the bound, raise it deliberately and say by how much.
- Six components are parked and unrendered (`AdminReservations`, `ReservationForm`, `ReservationPage`, `ChefGallery`, `NewsPress`, `SignatureMocktails`). A test fails if any is deleted.
- Commit messages in the style of `git log --oneline -5`. Never mention AI or any assistant; no co-author trailers.

## What Plan 4 handed over

Four things, all load-bearing here:

1. **The registry owns the sha; a section must never pass one on edit.** A whole-branch review found every one of nine sections overwriting the refreshed sha with its own load-time copy, so the *second* publish of a file in one session was refused with a false *"Someone else published while you were editing."* Fixed with `ContentRegistry.updateData`. Edit mode reuses that registry — use `updateData`, never `register`, on an edit.
2. **A staged-file key must be an identity the stage itself does not mutate.** `GalleryList` keyed staged bytes on `item.src`, the exact value a successful stage rewrites, so restaging the same row accumulated orphans until Publish locked out with no way to clear them. In-place image replacement is that shape with more surfaces.
3. **"Anything the dashboard can produce must pass the deploy gate" is established nowhere.** `src/test/assets.test.ts` rejects a dangling asset path, and `PlaceGallery`/`OurStory`/`FoodGallery` reject alt text and dish names the Worker's `validateContent` happily commits. Edit mode widens that surface considerably — Task 6 closes it.
4. **`RecordForm`, `RecordList`, `Field` and `problems.ts` are solid.** Their aggregate-banner contract, `publishAt` key-deletion and exact-index matching all fail correctly under mutation. Build on them.

## The decision this plan turns on

D3 says edit mode "reuses the **same components the public site uses**, wrapped rather than reimplemented; a second copy of the rendering would drift from the real one and defeat the purpose."

Every public component today does `import { site, galleries, copy } from '../content'` — module-level bindings, no props. **There is no way to wrap that.** A provider cannot override a module import, and reimplementing is what D3 forbids.

So: **each public component reads content through `useContent()` instead of importing it.** The hook's default value is the same static import, so with no provider the rendered output is unchanged. `/edit` mounts a provider holding live content.

This edits every rendered component on a live site, which is why it is Task 1 alone, gated by the byte invariant, before anything is built on it.

**Scope limit, stated plainly.** In edit mode the provider returns editable *elements* where the public site returns strings. That works for a value rendered as a text child (`{copy.atmosphere.heading}`). It does **not** work where a value becomes an attribute (`alt={image.alt}`) or is interpolated into a string (`` `https://wa.me/${site.whatsapp.number}` ``) — React renders an element as text there, or the template literal stringifies it.

So **edit mode covers text rendered as visible content, and images. Alt text, URLs, phone numbers and hours stay in the dashboard**, where Plan 4 already edits all of them. Task 3 enforces that boundary with a test rather than leaving it to discipline.

---

### Task 1: Every component reads content through a context, and nothing changes

**Files:**
- Create: `src/content/ContentContext.tsx`, `src/content/__tests__/ContentContext.test.tsx`
- Modify: `src/components/{Hero,OurStory,PlaceGallery,FoodGallery,Drinks,BlogTeaser,VisitUs,Footer,NavBar,BlogsPage,NotFound,SeoHead}.tsx`

**Interfaces:**
- Produces: `<ContentProvider value={…}>` and `useContent(): ContentBundle`, where `ContentBundle` is `{ site, galleries, dishes, drinks, press, story, menus, copy, sections }` — the same shape `src/content/index.ts` exports today.

- [ ] **Step 1: Write the failing test**

```tsx
it('renders identically with no provider', () => {
  const { container } = render(<MemoryRouter><AppRoutes /></MemoryRouter>);
  expect(new TextEncoder().encode(container.innerHTML).length).toBe(53473);
});

it('renders the provider value when one is present', () => {
  const bundle = { ...realBundle, copy: { ...realBundle.copy, atmosphere: { heading: 'Changed' } } };
  render(<ContentProvider value={bundle}><MemoryRouter><AppRoutes /></MemoryRouter></ContentProvider>);
  expect(screen.getByText('Changed')).toBeInTheDocument();
});
```

The first is the whole safety net. The second proves the override actually reaches the components — without it, Step 2 could "succeed" by changing nothing.

- [ ] **Step 2: Default to the static import**

```tsx
const ContentContext = createContext<ContentBundle | null>(null);
export function useContent(): ContentBundle {
  return useContext(ContentContext) ?? staticBundle;
}
```

`staticBundle` is built from `src/content/index.ts`'s existing exports. **Do not change `index.ts`'s guards or exports** — they run at import and are the site's validation.

- [ ] **Step 3: Migrate the components, one commit, mechanically**

`import { copy } from '../content'` → `const { copy } = useContent();` inside the component body. Nothing else changes: no JSX edit, no class change, no reordering.

`SeoHead` and any module-scope usage need care — a hook cannot run outside a component. If a value is read at module scope, leave that import in place and note why.

- [ ] **Step 4: Prove nothing moved**

The homepage must be **53473 bytes and the DOM byte-identical** — compare with `cmp`, not just the length. Run the whole suite: every existing component test must pass **unedited**. If one needs changing, you have changed behaviour, not plumbing — stop and report that instead.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(content): read content through a context so it can be overridden"
```

---

### Task 2: The `/edit` route, live content, and the same login

**Files:**
- Create: `src/admin/EditMode.tsx`, `src/admin/__tests__/EditMode.test.tsx`
- Modify: `src/App.tsx`, `src/test/bundle.test.ts`

**Interfaces:**
- Consumes: `useSession` (Task 1 of Plan 4), `fetchContent` and `ContentRegistry` (Plan 4 Task 3), `ContentProvider` (Task 1).

- [ ] **Step 1: Lazy route, same guard**

```tsx
const EditMode = lazy(() => import('./admin/EditMode'));
<Route path="/edit" element={<Suspense fallback={null}><EditMode /></Suspense>} />
```

`src/test/bundle.test.ts` allows exactly one file — `src/App.tsx` — to reference admin code, and asserts it does so only through `React.lazy`. Add the second lazy import there deliberately; a bare static import fails the guard, and it should.

Route ordering matters: `/edit/manage` must still reach the dashboard, not edit mode.

- [ ] **Step 2: Load live content, not the snapshot**

`fetchContent` per file, into a `ContentRegistry`, then into `<ContentProvider>`. **Never import `src/content/index.ts` from `src/admin/`** — a test enforces it, including the direct-JSON form, and that module is the stale build-time copy.

Reuse Plan 4's per-section error boundary pattern: `src/admin/content.ts:94` does a blind `JSON.parse(...) as` with no runtime validation, and it has already blanked the dashboard twice.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(admin): render the real homepage at /edit with live content"
```

---

### Task 3: Editable text

**Files:**
- Create: `src/admin/EditableText.tsx`, `src/admin/editable-paths.ts`, and their tests

**Interfaces:**
- Produces: `editableCopy(bundle, onEdit)` — returns a `Copy` whose leaf strings are React elements in edit mode; `EDITABLE_TEXT_PATHS`, the explicit list of dotted paths edit mode covers.

- [ ] **Step 1: An explicit list, not a heuristic**

`copy.json`'s leaves are already enumerated by Plan 4 Task 2's flat dotted-path map. Reuse it — do not re-derive.

But **not every leaf is editable in place.** A value used as an attribute or interpolated into a string cannot become an element. Enumerate the covered paths explicitly and test the boundary:

```ts
it('every editable path renders as a text child, never an attribute', () => {
  for (const path of EDITABLE_TEXT_PATHS) {
    // render the homepage with a sentinel at `path`, assert the sentinel
    // appears in textContent and in no attribute value anywhere
  }
});
```

That test is the boundary. Without it, adding a path later silently produces `alt="[object Object]"` on the live site.

- [ ] **Step 2: Click to edit, Escape to cancel**

A `contentEditable` span or an input swap — either is fine. What matters:
- Escape restores the previous value and does not mark dirty.
- Blur commits, matching `TagsInput`'s established behaviour — and Plan 4's publish already force-blurs before reading the payload, so a keyboard submit is covered.
- The U+00A0 in `copy.footer.followLabel` **survives a round trip**. `validateContent` refuses that field without it, so a normalising editor makes it unpublishable. Test it explicitly.

- [ ] **Step 3: Write back through the registry**

`registry.updateData(file, next)` — **not `register`**. Plan 4's whole-branch review found `register` on an edit path overwrites the refreshed sha and produces a false conflict on the second publish.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): edit visible text in place on the real page"
```

---

### Task 4: Editable images

**Files:**
- Create: `src/admin/EditableImage.tsx`, and its tests

**Interfaces:**
- Consumes: `PhotoField`'s upload machinery (Plan 4 Task 5), `useStaged` (`src/admin/staged.ts`), `derivativePath` (`src/shared/derivative-path.ts`).

- [ ] **Step 1: Key staged bytes on an identity the stage does not mutate**

This is Plan 4's second handover and it bit once already. `GalleryList` keyed on `item.src` — the value a successful stage rewrites — so restaging the same row accumulated orphans until Publish locked out with no way to clear them.

Key on something stable: the content path being replaced *as it was when the page loaded*, or the record id plus field name. **Test the restage case specifically:** pick, pick again, pick a third time on the same image, and assert exactly one staged file.

- [ ] **Step 2: Hover affordance, click to replace**

The image must still render exactly as the public component renders it — same `className`, same `alt`, same dimensions. The affordance is an overlay, not a replacement.

- [ ] **Step 3: The upload path is unchanged**

`POST /api/upload?stage=1` returns `{ path, contentPath }` without committing; the bytes travel with the publish. HEIC converts in the browser via the existing dynamic import — keep it dynamic, since the import-graph test is what catches a regression and a `dist/` grep cannot.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): replace any visible photo in place"
```

---

### Task 5: Publish from edit mode

**Files:**
- Modify: `src/admin/EditMode.tsx`; reuse `src/admin/publish.ts` and `PublishBar.tsx` unchanged if possible

- [ ] **Step 1: Reuse, do not fork**

`publish.ts` already attaches `baseSha` per file, scrubs staged references out of drafts, enforces the 8-photo cap, and maps 409 to a sentence she can act on. Every one of those was a review finding. Forking it re-opens all four.

If `PublishBar` needs a different layout over the real page, extract the layout, not the logic.

- [ ] **Step 2: Drafts are shared, and that is a decision**

Plan 4 writes drafts to `localStorage` under `vb:draft:v1`. Edit mode writes the same files. **Decide explicitly** whether they share one draft or use separate keys, and say why in a comment.

Sharing means an edit-mode change is offered for restore in the dashboard, which is probably right — it is the same content — but a draft restored in the wrong surface must not lose data. Test both directions.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(admin): publish edit-mode changes through the same path as the dashboard"
```

---

### Task 6: What she can produce must pass the deploy gate

**Files:**
- Create: `src/test/dashboard-output.test.ts`

Plan 4's whole-branch review flagged this as established nowhere, and edit mode widens the surface.

- [ ] **Step 1: Enumerate what the tools can write**

`src/test/assets.test.ts` rejects a dangling asset path. `PlaceGallery`, `OurStory` and `FoodGallery` have tests rejecting alt text and dish names that `validateContent` happily commits. So there are content states the editing tools can produce that the deploy gate then refuses — and a refused deploy poisons `main` until a developer edits the JSON by hand.

Write a test that takes each editable surface's plausible output and runs it through **both** `validateContent` and the deploy-gate assertions, asserting they agree on what is acceptable.

Where they disagree, that is a finding: either `validateContent` must refuse it before it becomes a commit, or the gate's rule is too strict. Report each one; do not silently loosen a gate.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "test: pin that editable content the tools accept also passes the deploy gate"
```

---

## Definition of done

- [ ] `npm run test`, `npm run test:deploy`, `npx tsc -b --noEmit`, `npm run build`, `npx eslint .` all clean. Record the count.
- [ ] The homepage is **53473 bytes and the DOM byte-identical**, with no provider present.
- [ ] Every pre-existing component test passes **unedited**.
- [ ] A provider value reaches the components — proven by a test that fails without it.
- [ ] Nothing under `src/admin/` reaches the entry chunk; `src/App.tsx` remains the only file referencing admin code, and only through `React.lazy`.
- [ ] No public component imports admin code.
- [ ] `copy.footer.followLabel`'s U+00A0 survives an in-place edit round trip.
- [ ] Restaging the same image three times leaves exactly one staged file.
- [ ] An edit-mode publish attaches `baseSha` and uses `updateData`, not `register`.
- [ ] Every `EDITABLE_TEXT_PATH` renders as a text child and never as an attribute.
- [ ] The CSS ceiling still holds, or is raised deliberately with the number stated.

## Handed to later plans

- **Plan 6 (Collage)** adds 2-D drag placement for `galleries.heroCollage`'s `className` grid strings, on top of this plan's `EditableImage`. **Read Plan 3's ledger note first:** seven grid utilities in `galleries.json` are absent from the shipped CSS because Tailwind does not scan `.json`, so the collage is *already* laid out differently from what the file says. Fixing that changes the live homepage and must be deliberate. Also: a future genuine `className="blur"` would emit nothing, because `tailwind.config.js` blocklists it — a *missing* rule is invisible to the rule-level diff.
- **Plan 7 (Section templates)** adds template types to Plan 4's descriptors. Every type there is a flat record; `Page { slug, name, inNav, sections }` is the first nested list-of-records.
- **Still unowned:** the 12×-repeated file-level validation message, the silent `localStorage`-quota swallow, orphaned staged bytes on Discard and on row-remove, a drink's photo that cannot be cleared, and a stale `dist/` making plain `npm run test` check an artifact that need not match source.
- **Task 8 of Plan 4 was never completed as written:** "a new menu name needs a JSON change" — `menuNameFor` derives the name from `menu.file` and nothing lets her change it, so a menu rename is currently unreachable rather than orphaning.
