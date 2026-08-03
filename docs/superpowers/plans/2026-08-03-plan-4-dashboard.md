# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/edit/manage` — the screen where the restaurant owner adds a dish, replaces a photo, swaps the menu PDF, reorders a section, schedules something for next week, and presses Publish, then finds out whether it worked.

**Architecture:** A lazy-loaded admin route that never enters the main bundle. Forms render from per-type field descriptors whose `kind` is constrained by the field's own value type, so `tsc` fails if a content type gains a field, loses one, or changes shape. The dashboard reads current content **from `main` through the Worker**, not from the bundled snapshot, and publishes with a conditional write so a second device cannot be silently overwritten.

**Tech Stack:** React 18, React Router 7, TypeScript strict, Vitest, Testing Library. No form library, no state library, no new runtime dependency.

## Global Constraints

- **Branch `repair/phase-a`. Never push. Never touch `main`.** The site is live.
- **`npx tsc -b --noEmit`, never `npx tsc --noEmit`.** The root `tsconfig.json` is solution-style with `"files": []`, so the plain form checks nothing and exits 0 on any codebase.
- **Admin code must never reach the main bundle.** One static import does it. Task 1 fixes the guard before anything exists to leak.
- **The rendered homepage stays byte-identical at 53473 bytes**, pinned by `src/test/homepage-bytes.test.tsx` (`TextEncoder`; JS `.length` reads 53454 and is not the invariant).
- **A test that cannot fail is a defect, not coverage.** Nineteen have been caught on this project — three in briefs the orchestrator wrote, one created by a fix, one inert in both states. **This plan's own first draft specified three more**, all caught in review. Trace every assertion: given the implementation, would it pass if the feature were absent?
- **A test must be invariant under any legitimate content edit.** `test:deploy` is `vitest run` and the deploy command runs it, so a content-coupled test blocks her future edits.
- **Tailwind's content scanner reads `./src/**/*.{js,ts,jsx,tsx}` including comments.** Three tasks have moved a bundle hash by writing a utility-class name in a comment.
- Six components are parked and unrendered (`AdminReservations`, `ReservationForm`, `ReservationPage`, `ChefGallery`, `NewsPress`, `SignatureMocktails`). A test fails if any is deleted.
- Commit messages in the style of `git log --oneline -5`. Never mention AI or any assistant; no co-author trailers.

## What Plan 3 built that this consumes

| Endpoint | Contract (verified against the source) |
|---|---|
| `POST /api/login` | `{ password }` → 204 + `vb_session` cookie (httpOnly, Secure, SameSite=Strict, 7 days). 401 / 429 / 500-if-unconfigured. |
| `POST /api/publish` | `{ files: [{ path, content, encoding }] }` → `{ sha }`. **422 `{ problems: [{ field, message }] }` if any file is invalid — nothing committed.** 401. 502 on conflict (Task 10 changes this to 409). |
| `POST /api/upload` | multipart `category` + `file` → **`{ sha, path }`** — note `sha`: every upload is already its own commit today. Task 5 changes that. |
| `GET /api/build-status?sha=` | `{ state: 'queued'\|'building'\|'live'\|'failed', deploymentUrl, commitUrl }`. Authenticated. Returns `queued` when no deployment matches the sha. |
| `GET /api/wa` | `{ …, lowerBound: true }`. Authenticated. |
| `build-info.json` | `{ sha, builtAt }`, `no-store`, written **only on a successful build**. |

`validateContent(file, data)` in `src/content/validate.ts` is the same function the Worker calls, imports no JSON, and is browser-safe. **It validates a whole file, not one record** — `validateDishes` requires an array, ordering rules are file-scoped, and retired-name rules are cross-file. Task 6 depends on that.

## Corrections this plan carries, from its own review

Three things an earlier draft asserted that are false. They are recorded because each was believed twice.

1. **"No test can catch the non-breaking space" is wrong.** `copy.footer.followLabel` is `Follow\xa0Us:`; `Footer` renders it on the homepage; jsdom serialises U+00A0 as `&nbsp;` (6 bytes) where a space is 1. Losing it reads **53468**, not 53473 — and Plan 2's ledger records commit `424835c`, the NBSP defect itself, measuring exactly 53468. The byte test catches it; what it cannot do is say *why*. Task 2 adds the rule that names it.
2. **`Record<keyof T, FieldSpec>` does not catch a type change.** `Dish.tags` going `string[]` → `string` leaves `kind: 'tags'` legal. Task 2 closes this by making `kind` depend on the value type.
3. **`keyof Copy` yields ten objects, not leaf strings.** The descriptor pattern does not reach `copy.json` or `site.json` as written. Task 2 handles those explicitly.

---

### Task 1: The admin route, and a bundle guard that actually runs

**Files:**
- Create: `src/admin/AdminApp.tsx`, `src/admin/Login.tsx`, `src/admin/session.ts`, `src/admin/__tests__/session.test.ts`, `src/test/bundle.post-build.test.ts`
- Modify: `src/App.tsx`, `src/test/bundle.test.ts`, `src/test/smoke.test.ts`, `src/test/hosting.test.ts`, `package.json`, `docs/cloudflare-cutover.md`, `public/robots.txt`

**Interfaces:**
- Produces: `src/admin/AdminApp.tsx` with a **default export** (`React.lazy` requires it — an earlier draft contradicted itself here); `useSession()` → `{ status: 'checking' | 'out' | 'in', logIn, logOut }`.

- [ ] **Step 1: Keep the shipped regex; make the one legitimate exception explicit**

`src/test/bundle.test.ts:41` already has a good anchor. An earlier draft proposed replacing it with `/from ['"]…/`, which is **strictly weaker** — it misses `lazy(() => import('./admin/AdminApp'))`, `await import(…)`, `import X from'…'` with no space, and a prettier-wrapped `from\n  '…'`. The last is what any formatter produces for a long import list.

Widening the shipped regex from `admin/heic` to `admin/` flags `src/App.tsx`, because Step 3's own `lazy()` matches it. Do **not** solve that by deleting dynamic-import detection — that is the detection that would catch a future `await import('../admin/publish')` inside a public component. Name the exception instead:

```ts
const IMPORTS_ADMIN = /(?:from|import)\s*\(?\s*['"][^'"]*admin\/[^'"]+['"]/;

// src/App.tsx's lazy route is the ONE legitimate reference: React.lazy's dynamic
// import is what puts admin code in its own chunk. Listed explicitly so a SECOND
// file gaining any admin import -- static or dynamic -- fails here.
const ALLOWED = ['src/App.tsx'];

it('nothing outside src/admin imports admin code', () => {
  const offenders = gitLsFiles('src')
    .filter((f) => !f.startsWith('src/admin/') && /\.tsx?$/.test(f))
    .filter((f) => IMPORTS_ADMIN.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual(ALLOWED);
});

it('App.tsx references admin code only through React.lazy', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  expect(app).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(['"]\.\/admin\/AdminApp['"]\)\s*\)/);
  expect(app).not.toMatch(/(?:from|import)\s+['"][^'"]*admin\/[^'"]+['"]/);
});
```

`gitLsFiles` already exists at `bundle.test.ts:23`, scoped inside the `describe` — hoist it to module scope.

**Do not add a self-exclusion.** Neither regex self-matches; that instruction in the earlier draft described a stale problem from Plan 3 Task 9, and this repo's own precedent is against it (Plan 3's ledger on `secrets.test.ts`: the reviewer removed the self-exclusion and it still passed).

**Verify all six forms**, not one: static default, static named, bare side-effect, `import type`, `export * from`, and dynamic `import()`.

- [ ] **Step 2: Make the post-build check run on the deploy path, and fix the test it breaks**

Move the `dist/` grep into `src/test/bundle.post-build.test.ts` and add `"test:bundle": "vitest run src/test/bundle.post-build.test.ts"`. Append ` && npm run test:bundle` to the `build` script.

**`src/test/smoke.test.ts:6` asserts `pkg.scripts.build` by exact string equality.** Appending to `build` turns it red, and `test:deploy` runs on every deploy — so shipping the script change alone fails every deployment. That is verbatim the Critical from Plan 3's whole-plan review, where completing the runbook broke the build forever. **Update that assertion in the same commit.**

Also update `docs/cloudflare-cutover.md`'s `**Build command:**` line and the ordering assertion in `src/test/hosting.test.ts`, and note in the runbook that a human must re-paste it into the Pages dashboard — nothing in this repository can verify that.

- [ ] **Step 3: The lazy route**

```tsx
const AdminApp = lazy(() => import('./admin/AdminApp'));
<Route path="/edit/manage/*" element={<Suspense fallback={null}><AdminApp /></Suspense>} />
```

Add `Disallow: /edit/` to `public/robots.txt` — conventional prefix form. Not a security control; the login is.

- [ ] **Step 4: One route test, not two**

```tsx
it('renders the login form at /edit/manage', async () => {
  render(<MemoryRouter initialEntries={['/edit/manage']}><AppRoutes /></MemoryRouter>);
  expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
});
```

`findBy`, not `getBy` — the route is lazy.

Do **not** add "does not render admin code at `/`". At `/`, `AppRoutes` renders `HomePage`, which has no password field whether `AdminApp` is lazy, static, or inlined. No mutation of the feature turns it red. A route test cannot observe a bundler's decision; Steps 1 and 2 are what do. Say that in a comment where the test would have gone.

- [ ] **Step 5: Session state without storing anything**

The cookie is `httpOnly`, so JS cannot read it. Probe instead: call `GET /api/wa` and treat 401 as logged out.

Do **not** store a logged-in flag in `localStorage` — it goes stale the moment the 7-day token expires and she gets a dashboard that 401s on every action. (This is about the *session*. Drafts are different and are Task 10 Step 4.)

- [ ] **Step 6: The login form**

One password field, one button. 401 → "That password didn't work." 429 → "Too many attempts. Try again in 15 minutes." 500 → "Login isn't set up yet — ask your developer." Never echo the password.

- [ ] **Step 7: Verify and commit**

Homepage 53473 and the DOM byte-identical. Report the main-chunk hash and the new lazy chunk separately. The invariant is **"the main chunk contains no admin module"** — `lazy` + `Suspense` legitimately adds a few bytes to the main chunk, so "must not grow" is not literally achievable.

```bash
git add -A
git commit -m "feat(admin): add the lazy-loaded dashboard route behind a password"
```

---

### Task 2: Field descriptors the compiler keeps honest

**Files:**
- Create: `src/admin/fields.ts`, `src/admin/__tests__/fields.test.ts`
- Modify: `src/content/validate.ts`, `src/content/__tests__/validate.test.ts`

**Interfaces:**
- Produces: `FieldSpec<V>`, `FieldsOf<T>`, and `DISH_FIELDS`, `DRINK_FIELDS`, `ARTICLE_FIELDS`, `SECTION_FIELDS`, `MENU_FIELDS`, `GALLERY_IMAGE_FIELDS`, `HOURS_FIELDS`, plus explicit leaf maps for `copy.json` and `site.json`.

The spec wants forms "generated from the existing TypeScript types… what makes Phase C's sections editable the day they exist." Types don't exist at runtime, so nothing literally reads them. A descriptor whose completeness *and shape* the compiler enforces delivers that intent with no codegen and no new dependency — the pattern this repo already relies on in `shape.test.ts:226` and `guards.ts:85`.

Zod was considered and rejected: the content layer already exists as nine hand-written interfaces, five throwing guards and `validateContent`'s nine rules, all of which are the authority. Switching means re-deriving every owner-facing guard message and adding a runtime dependency to the Worker.

- [ ] **Step 1: Make `kind` depend on the value type**

```ts
type Kind<V> =
  [V] extends [string] ? 'text' | 'textarea' | 'image' | 'select' | 'date' | 'readonly' :
  [V] extends [string | null] ? 'text' | 'image' | 'readonly' :
  [V] extends [string[]] ? 'tags' :
  [V] extends [boolean] ? 'toggle' :
  [V] extends [number] ? 'number' : never;

export type FieldSpec<V = unknown> = { label: string; kind: Kind<V>; options?: readonly string[]; help?: string };
export type FieldsOf<T> = { [K in keyof Required<T>]: FieldSpec<Required<T>[K]> };
```

`Required<T>` makes optional fields (`publishAt`) required in the descriptor. Note `Section.enabled` is `boolean` and `SiteContent.copyrightYear` is `number` — both kinds an earlier draft's union omitted.

**Declare each descriptor as a directly-annotated object literal.** Excess-property checking — which is what catches a *removed* field — only fires on a fresh literal in an annotated position. Built by spread or assigned through an intermediate variable, a removal goes silent.

- [ ] **Step 2: A test the compiler actually enforces**

Do **not** write `expect(Object.keys(DISH_FIELDS).sort()).toEqual([…])`. Mutating `FieldsOf<Dish>` to `Record<string, FieldSpec>` destroys the guarantee and leaves that assertion green. It is also redundant: `shape.test.ts:226` already makes "adding a field to `Dish` fails `tsc`" true today.

```ts
// @ts-expect-error a descriptor missing a key of Dish must not compile. If the
// FieldsOf<Dish> annotation is ever removed, this directive becomes unused and
// `tsc -b` fails -- which is the point.
const _incomplete: FieldsOf<Dish> = { id: DISH_FIELDS.id };
```

- [ ] **Step 3: Write the descriptors**

Two the `help` text must get right:

- **`Dish.tags`** — `types.ts` says it is authored but deliberately not rendered, and that any editing tool "must not treat `tags` as visible to a diner today." Say so, or she will assume editing it changes the page.
- **`press.readArticle`** in `copy.json` drives **both** the homepage teaser and `/blogs`. One field, two surfaces.

- [ ] **Step 4: `copy.json` and `site.json` need explicit leaf maps**

`keyof Copy` is ten *objects*; `keyof SiteContent` gives `address`, `seo`, `hours` as single objects. `FieldsOf` is meaningless on both — and they are where `press.readArticle` and `footer.followLabel` live.

Write a flat map keyed by dotted path (`'footer.followLabel'`), and a test asserting every leaf string in the real `copy.json` has an entry. That test is content-coupled by design and legitimate: `copy.json`'s *shape* is developer-owned even though its *values* are hers.

- [ ] **Step 5: `site.seo.*`, `site.name`, `site.tagline` — refuse server-side, not just in the UI**

`src/test/head.test.ts` pins nine strings in `index.html` against `site.json`. If she edits `site.name`, the deploy fails — and because the bad value is on `main`, **every subsequent publish of anything also fails** until a developer hand-edits `index.html`. Same poisoned-`main` shape as Plan 3's `publishAt` finding.

A read-only input is one attribute away from being editable by a future contributor. Add the rule to `validateContent`: if `site.json`'s `name`, `tagline` or any `seo.*` differs from the committed value, return "Changing this needs your developer — it's written into a file the site is built from."

What she loses is real: `site.seo.description` is the share-preview text that appears every time someone sends the restaurant over WhatsApp. **Record the successor work**: a `transformIndexHtml` Vite plugin substituting tokens from `site.json`, after which `head.test.ts` asserts against built `dist/index.html`. Roughly 30 lines, and it unlocks the most commercially useful strings on the site.

- [ ] **Step 6: The non-breaking space rule**

`copy.footer.followLabel` must contain U+00A0. Add to `validateContent`, and add a content-rule test:

```ts
expect(copy.footer.followLabel).not.toMatch(/ /);   // U+0020, not U+00A0
```

Invariant under any legitimate rewording — it constrains the separator, not the words.

Do **not** add it to `assertCopy`. A throwing guard white-pages the live site if any path reaches `npm run build` without `test:deploy` (Plan 2's I4).

- [ ] **Step 7: Verify and commit**

Add a field to `Dish`, run `npx tsc -b --noEmit`, confirm it fails **naming `src/admin/fields.ts`** — not just failing somewhere, since `shape.test.ts` would also fail. Remove it. Then change `Dish.tags` to `string`, confirm the descriptor fails to compile, revert.

```bash
git add -A
git commit -m "feat(admin): describe every editable field in a type-checked map"
```

---

### Task 3: Read what is actually on `main`

**Files:**
- Modify: `worker/index.ts`, `worker/github.ts`, `worker/__tests__/index.test.ts`, `worker/__tests__/github.test.ts`
- Create: `src/admin/content.ts`, `src/admin/__tests__/content.test.ts`

**Interfaces:**
- Produces: `GET /api/content?path=src/content/<name>.json` → `{ content, sha }`, authenticated; `POST /api/publish` files accept an optional `baseSha`.
- Consumes: `getFileContent` in `worker/github.ts` — it exists, for the cron's `reconcileScheduleFromSource`, and is on no route.

**Without this task the dashboard silently destroys edits.** The only content available in the browser is the build-time bundle. She publishes at 14:00; Cloudflare rebuilds over 1–2 minutes; she reloads or opens her phone before it lands and gets the **previous** `dishes.json`; she edits a different dish and publishes the whole array — without the 14:00 edit. `base_tree` is set, the ref fast-forwards cleanly, **200 OK, green "live", the earlier edit gone.**

The existing 502 does not save her: `updateBranchHead` 422s only on a non-fast-forward, i.e. only if the branch moved inside one request. Two devices ten minutes apart never collide.

`guards.ts:110-117` already anticipates this for `sections.json` — "a dashboard write that drops one silently deletes that section from the homepage." Nothing covers the other eight files.

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses a publish whose baseSha is stale', async () => {
  const res = await handle(publish([{ path: 'src/content/dishes.json', content: '[]',
                                      encoding: 'utf-8', baseSha: 'old-sha' }]));
  expect(res.status).toBe(409);
  expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(false);   // nothing written
});

it('publishes when baseSha matches', async () => { … expect(res.status).toBe(200); });
it('publishes when baseSha is absent, for callers that do not track it', async () => { … });
it('requires a session token to read content', async () => {
  expect((await handle(get('/api/content?path=src/content/dishes.json'))).status).toBe(401);
});
it('refuses a content path outside src/content', async () => { … 400 … });
```

- [ ] **Step 2: Implement**

`getFileContent` gains the blob `sha` in its return — GitHub's Contents API already sends it. `GET /api/content` reuses the same path allowlist shape as `commitFiles`; do not write a second one.

- [ ] **Step 3: Load from the route, never from the bundle**

`src/admin/content.ts` fetches each editable file and keeps its `sha`. The admin bundle must not import `src/content/index.ts` — that is the stale snapshot, and importing it also drags all nine JSON files into the admin chunk.

Add a test asserting no file under `src/admin/` imports `../content` or `../content/index`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(worker): serve current content and refuse a publish from a stale copy"
```

---

### Task 4: The form and its problem messages

**Files:**
- Create: `src/admin/Field.tsx`, `src/admin/RecordForm.tsx`, `src/admin/problems.ts`, and their tests

**Interfaces:**
- Produces: `<RecordForm fields={…} index={…} value={…} onChange={…} problems={…} />`; `problemsFor(problems, index, key): ValidationProblem[]`.

- [ ] **Step 1: Map `field` strings to inputs — all four shapes**

`validateContent` emits four: `[i].key` (dishes/drinks/press), bare `key` (story, site), `key[i].sub` (`hours[0]`, `atmosphere[0].src`, `paragraphs[1]`), and `''` for file-level problems (`'press.json: articles must be sorted newest first'`).

Suffix-matching misattributes `[1].name` to a form showing index 0 — for a 38-drink list that is the difference between useful and useless.

```ts
// exact match on the index this form is rendering, never a suffix
const matches = (p: ValidationProblem) => p.field === `[${index}].${key}`;
```

For a non-array file: `p.field === key || p.field.startsWith(`${key}[`)`.

**Problems with `field === ''`, and any whose prefix matches no rendered field, render in a form-level banner.** Test that an unmatched field still appears somewhere on screen — silently dropping a problem is worse than showing it in the wrong place.

- [ ] **Step 2: Associate the message with the input**

```tsx
expect(screen.getByLabelText(DISH_FIELDS.name.label))
  .toHaveAccessibleDescription('A dish needs a name.');
```

`aria-describedby`. Asserting the text merely appears somewhere passes when it is attached to the wrong field.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(admin): render a record's fields with its own validation messages"
```

---

### Task 5: Lists, and photos in one commit

**Files:**
- Create: `src/admin/RecordList.tsx`, `src/admin/PhotoField.tsx`, `src/shared/derivative-path.ts`, and their tests
- Modify: `worker/upload.ts`, `worker/index.ts`, and their tests

**Interfaces:**
- Produces: `<RecordList items fields onReorder onAdd onRemove />` where `onReorder(ids: string[])`; `derivativePath(sourcePath: string): string`; `POST /api/upload?stage=1`.

**Carried from Task 4's review — a guarantee only this task can keep.** `RecordForm` suppresses problems belonging to *another* index, which fixes real cross-item leakage but works by assuming some sibling form renders the index the problem is actually on. No single form can verify that. Proven: a list rendering indices 0–37 with a problem on `[40].name` surfaces it in **zero** banners — a total silent drop, which the plan's own rule calls worse than showing it in the wrong place. Task 6 validates the whole array on a debounce tick while this task adds remove, so a remove landing between a scheduled tick and its resolution leaves `problems` referencing an index nobody renders.

**So `RecordList` owns the aggregate guarantee:** render a top-level banner for every problem whose index no mounted `RecordForm` claims. Test it by validating against a longer array than you render.

- [ ] **Step 1: Up/down buttons, named per item**

The spec's Risks section already *mandates* buttons: *"On phones she gets tap-to-select with plus, minus and arrow buttons instead."* This is not a deferral of drag; it is the required touch interaction.

Name buttons per item ("Move Negroni down"), and omit them at the ends — 38 identically-named buttons is the same failure as an unassociated error message.

- [ ] **Step 2: `derivativePath`, linked to the rule it mirrors**

Upload returns `assets-source/food/<hash>.jpg`; `dishes.json` needs `/food/<hash>.webp`. `scripts/paths.mjs`'s `outputPathFor` owns that rule and is a `.mjs` the Worker cannot import.

Do not hand-copy cases. `scripts/paths.mjs` is plain ESM and Vitest runs on Node, so import **both** and assert equivalence over every real file:

```ts
expect(derivativePath(src)).toBe('/' + relative('public', outputPathFor(src)));
```

- [ ] **Step 3: Stop `/api/upload` from committing on its own**

`worker/upload.ts:295` calls `commitFiles(env, [file], …)` — **every upload is already a commit.** Twelve photos means twelve commits, Cloudflare cancels eleven superseded builds, and `mapDeploymentState` correctly reports `canceled → failed`, so she sees eleven failures for eleven photos that all landed.

Add `?stage=1`: run every existing check — Content-Length, post-read size, `detectFormat`, HEIC rejection, `looksComplete`, `uploadPath` — and return `{ path, contentPath }` **without calling `commitFiles`**. The browser keeps the bytes and sends them in the same `POST /api/publish` array.

**State the arithmetic and cap the UI at 8 photos per publish:** base64 inflates 4/3×, so 8 × 5MB ≈ 53MB of request body, and `commitFiles`' own comment caps a publish at ~45 files (N+5 subrequests against the 50 limit).

Add a Worker test that a `.json` path labelled `base64` is **still refused** — that validation exemption is the exact hole Plan 3's review found and closed.

- [ ] **Step 4: HEIC, keeping the dynamic import**

```ts
const converted = await convertHeic(file);
```

Task 1 made the import-graph test real, and it is the one that catches a regression here — a `dist/` grep alone cannot, because the WASM only appears once something imports it. This is the first real caller.

`fetch` **cannot report upload progress**; only `XMLHttpRequest.upload.onprogress` can. Give the request a 120-second timeout and a Retry button — the path is content-addressed, so a retry is idempotent.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): reorder lists and stage photos into a single publish"
```

---

### Task 6: Validate as she types, and never lose a field

**Files:**
- Create: `src/admin/useValidation.ts`, `src/admin/__tests__/useValidation.test.ts`
- Modify: `src/admin/AdminApp.tsx`

- [ ] **Step 1: Validate the whole file, not the record**

`validateContent('dishes.json', oneDish)` returns `[{ field: '', message: 'expected a list of dishes' }]` — `validateDishes` requires an array, and ordering and retired-name rules are file-scoped by construction.

The dashboard holds the whole file in memory. Every debounce tick validates the whole file and distributes problems by index via Task 4's `problemsFor`.

- [ ] **Step 2: Say why the client copy exists**

A comment: this is a **latency optimisation, not a trust boundary**. The Worker re-validates and is the authority. Plan 3's ledger records exactly this deletion being attempted — "the client already validates" — and caught.

- [ ] **Step 3: Round-trip every field, including ones no form renders**

She edits one dish; the publish sends the whole file. `tags` is authored on all fifteen dishes and rendered by nothing.

```ts
const withExtra = { ...validDish, futureField: 'x' } as Dish & { futureField: string };
// edit one field, then:
expect(published[0]).toHaveProperty('futureField', 'x');
```

The explicit widening is required — `value` typed as `Dish` will not admit an unknown key in a literal.

**This is the most valuable test in the plan.** Without it, editing one dish deletes `tags` from fifteen.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): validate the whole file as she types without dropping fields"
```

---

### Task 7: Hours, sections, and scheduling

**Files:**
- Create: `src/admin/HoursField.tsx`, `src/admin/SectionList.tsx`, `src/admin/ScheduleField.tsx`, and their tests

- [ ] **Step 1: Hours**

Two things the guards already know:
- `assertHours` takes a **typed** parameter, not `unknown`.
- A closing time **past midnight is valid** — `src/content/hours.ts:55-63` calls it "a correct literal reading of the two clock times, not a bug." The restaurant has a bar. **Do not add "closes must be after opens";** Plan 2's final review had to remove a test asserting exactly that because it blocked a legitimate edit.

- [ ] **Step 2: Sections — three rules, not two**

`assertSections` rejects a disabled `hero`, rejects a `publishAt` key, **and requires every `SectionId` to appear exactly once** (`guards.ts:150-153`). That third rule is the one a reorder/remove UI can actually break, and an earlier draft missed it.

D6: *"Nothing is ever deleted, only disabled."* So the section list offers reorder and toggle — **no Remove button at all**.

Show human names, not `SectionId`s: `atmosphere` renders "Atmosfera" and lives at `#gallery`. The ids deliberately differ from the anchors and neither is her vocabulary.

- [ ] **Step 3: Scheduling, and clearing a date**

`<input type="date">` produces `YYYY-MM-DD` and sidesteps the DD-MM ambiguity that a text field invites.

**An emptied date input yields `''`, and `validatePublishAt` → `isPublished` throws on it → 422.** Clearing the field must **delete the key**, not write an empty string. Test: set a date, clear it, assert the published JSON has no `publishAt` key.

State next to the control that publishing happens on an **hourly** check, not at midnight.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): edit hours, reorder sections, and schedule content"
```

---

### Task 8: The menu PDFs

**Files:**
- Modify: `worker/github.ts`, `worker/upload.ts`, and their tests
- Create: `src/admin/PdfField.tsx`, `src/admin/__tests__/PdfField.test.tsx`

- [ ] **Step 1: A third path shape, equally tight**

`commitFiles`' allowlist is the only thing between a malformed request and a rewritten `.github/workflows/`. A whole-branch review threw 54 hostile paths at it and none escaped. Do not loosen the existing two:

```ts
/^public\/menus\/[a-z0-9-]+\.pdf$/
```

Re-run the traversal cases with it in place — `public/menus/../../package.json`, `public/menus/%2e%2e/x.pdf`, `public/../public/menus/x.pdf`, `public/menus/a/b.pdf`. Add the new shape to `DisallowedPathError`'s message, which enumerates only two.

- [ ] **Step 2: `category=menu`, specified**

`uploadPath` is content-addressed, which is **wrong here** — Step 3 wants "replacing the PDF under the same name needs no JSON change", so the path must be stable and named.

On the `category=menu` branch only: no `detectFormat`; require `%PDF-` at bytes 0–4 **and `%%EOF` within the last 1KB** (the direct analogue of the JPEG `FF D9` check `looksComplete` already does — note `looksComplete`'s `default: return true` accepts a truncated PDF today); the same 25MB ceiling; and a required `name` matching `/^[a-z0-9-]+$/`, rejected with "A menu name can only use lowercase letters, numbers and hyphens."

Path is `public/menus/<name>.pdf`. Test both directions: `category=menu` with image bytes is refused, and an image category with PDF bytes is refused by `detectFormat` returning `null`.

- [ ] **Step 3: Keep `menus.json` and the file in step**

Replacing under the same name needs no JSON change; a new name does. Send both in one publish so a rename cannot half-land.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): let the owner replace the printed menu pdfs"
```

---

### Task 9: Story, galleries, and the rest of the prose

**Files:**
- Create: `src/admin/StoryForm.tsx`, `src/admin/GalleryList.tsx`, and their tests
- Modify: `src/admin/Field.tsx`, `src/admin/fields.ts`, `src/admin/RecordForm.tsx`, `src/admin/AdminApp.tsx`

**Wire the `image` kind — Task 5 built `PhotoField` and deliberately did not connect it, and no other task claimed it.** Today `Field.tsx` falls `'image'` through to the plain text case, so "Photo" on a dish, a drink and a press article is a box she must type `/food/abc123abc123.webp` into by hand, while a working picker sits unused.

Two things block a one-line wiring, both real:
- `PhotoFieldProps.category` is required and no `FieldSpec` carries one. Give the `image` specs a `category`.
- `onStaged` is optional, and rendering `PhotoField` without a collector is **worse than the text box**: it writes `contentPath` into the record while dropping the bytes, so the publish commits JSON pointing at a derivative whose source was never committed, and the photo 404s on the live site. Thread the collector from `AdminApp` down through `RecordList` → `RecordForm` → `Field` before rendering it.

Note Task 9's own `GALLERY_FIELDS.src` is a *different* descriptor from the `image` kind on dishes/drinks/press — reusing `PhotoField` there does not cover these.

**Wire `PdfField` too, for the same reason.** Task 8 built it and, following Task 5's precedent, deliberately left it unconnected — and again no later task claimed it. Add a menus section to `AdminApp` that renders `PdfField` per entry in `menus.json`, so she can actually replace the printed menu. Replacing under the same name needs no JSON change; a new name does, and both must go in one publish so a rename cannot half-land.

D10 makes prose editable and the spec's Plan-4 row says "list add/remove/reorder". An earlier draft had no task for either, though `validateContent` has rules for both.

- [ ] **Step 1: `story.json`** — heading plus a paragraph list. The no-trailing-ellipsis rule lives in `validateContent`; surface it inline rather than at publish.

- [ ] **Step 2: `galleries.json`** — `atmosphere`, `ourStory` and `heroCollage`, each a list of `{ src, alt }` (plus `className` on the collage). Add, remove, reorder, and edit alt text. Reuse `PhotoField` for `src`.

**Leave `heroCollage`'s `className` alone.** It is a Tailwind grid-placement string and Plan 6 owns it. Render it read-only with a note.

- [ ] **Step 3: `copy.json`'s leaves** — the flat dotted-path map from Task 2 Step 4, rendered as a plain list of labelled inputs grouped by section. `footer.followLabel` renders its U+00A0 visibly (a marker, not a raw space) so she can see it exists.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): edit the story, the galleries and the page copy"
```

---

### Task 10: Publish, and finding out whether it worked

**Files:**
- Create: `src/admin/publish.ts`, `src/admin/PublishBar.tsx`, `src/admin/drafts.ts`, and their tests
- Modify: `worker/github.ts`, `worker/index.ts`, and their tests

The spec: *"Step 5 exists because of step 4. Once a bad edit cannot break the site, the new failure mode is that her work silently evaporates. She must be told."*

- [ ] **Step 1: One request, one commit**

Every changed file plus every staged photo, in one `POST /api/publish`.

**Attach `baseSha` to every content file.** Task 3 built the conditional write that stops a second device's edit being silently overwritten, and verified it end to end — but **nothing sends `baseSha` yet**. If this step omits it, publish reverts to the destructive overwrite and **no test goes red**. `src/admin/content.ts` keeps each file's sha; send it.

**Flush the focused field before reading the payload.** `TagsInput` (Task 4) commits its buffer on blur. Clicking a button blurs first, so that path is safe — but a keyboard submit inside a wrapping `<form>` does not, and her last-typed tag would be silently excluded. One line: `if (document.activeElement instanceof HTMLElement) document.activeElement.blur();` before collecting values.

- [ ] **Step 2: 409, not a parsed error string**

Today both "someone else published" and "GitHub returned 5xx" arrive as `json(502, { message })`, so the dashboard would have to match on literal text with nothing pinning it — a reword on either side silently degrades the conflict case.

`export class PublishConflictError extends Error {}` in `worker/github.ts`, thrown by `updateBranchHead` on 422; `handlePublish` maps it to **409**. Same status Task 3's `baseSha` mismatch uses. Branch on status, never on message text.

- [ ] **Step 3: Poll with a timeout, and confirm with `build-info.json`**

`GET /api/build-status` returns `queued` when **no deployment matches the sha** — honest for the first seconds, but if GitHub never notifies Cloudflare or Pages is wired to another branch, it returns `queued` forever and "stop on live or failed" never fires. That is Plan 3 Task 8's limbo in a new shape.

Back off. After **10 minutes** without `live`/`failed`: "This is taking longer than it should. Here's the commit — send this link to your developer."

`deploy: success` is not "the CDN is serving it". Once `live`, fetch `/build-info.json` (it is `no-store` for exactly this) and confirm `sha` matches before saying "Your changes are live." If it does not match within 60 more seconds: "Published, but the site hasn't picked it up yet."

Note `GET /api/build-status` is authenticated — handle a 401 mid-poll, not only on publish.

- [ ] **Step 4: Drafts survive the tab**

In-memory state does not survive a reload, a tab crash, or iOS evicting a backgrounded tab.

On every change, write dirty files to `localStorage` under `vb:draft:v1` with a timestamp. On load, if a draft exists, show "You have unsaved changes from &lt;relative time&gt;" with Restore and Discard — **never auto-apply**. Clear on a 200 from `/api/publish`. Add a `beforeunload` handler while dirty.

This is site content, not a secret, and is deliberately separate from the session, which is still never stored (Task 1 Step 5).

- [ ] **Step 5: Translate the developer sentences**

| From the Worker | What she reads |
|---|---|
| 422 `{ problems }` | each message inline, next to its field |
| 409 | "Someone else published while you were editing. Reload to get their changes, then try again." |
| 502 GitHub 5xx | "Couldn't reach the server that stores your changes. Nothing was lost — try again in a minute." |
| 401 | "You've been signed out. Log in and your changes will still be here." |

The 401 case matters most: the session lasts seven days and can expire mid-edit. Keep unsaved state across the re-login **and** in the draft store, so a reload during the re-login does not lose it either.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(admin): publish in one commit and report what happened"
```

---

## Definition of done

- [ ] `npm run test`, `npm run test:deploy`, `npx tsc -b --noEmit`, `npm run build`, `npx eslint .` all clean. Record the count.
- [ ] **Nothing under `src/admin/` reaches the main bundle**, proven by an import-graph test that fails on all six import forms and a post-build check that runs on the deploy path.
- [ ] `smoke.test.ts`'s build-script assertion was updated in the same commit that changed the script.
- [ ] The homepage is 53473 bytes and the rendered DOM byte-identical.
- [ ] Adding a field to `Dish` fails `tsc -b` **with an error naming `src/admin/fields.ts`**; changing `tags` to `string` fails the descriptor.
- [ ] A publish from a stale `baseSha` returns 409 and writes nothing.
- [ ] The dashboard reads content from `GET /api/content`, and no file under `src/admin/` imports `src/content/index.ts`.
- [ ] A problem whose field matches no rendered input still appears on screen.
- [ ] Editing one dish preserves `tags` on all fifteen and an unknown extra key.
- [ ] Several photos publish as **one** commit, and the staged-photo cap is enforced rather than merely declared. (The "twelve photos" figure earlier in this plan describes the *problem* — twelve uploads becoming twelve commits — not a target. Task 5 set the cap at `MAX_STAGED_PHOTOS_PER_PUBLISH = 8` with a 5MB per-photo ceiling, derived from base64's 4/3 inflation against the Workers request-body limit and the ~22-file subrequest ceiling. The cap is the researched number and wins.)
- [ ] A menu PDF can be replaced; `commitFiles` still rejects every traversal case with the third shape in place; a truncated PDF is refused.
- [ ] A past-midnight closing time is accepted; a cleared date removes the `publishAt` key.
- [ ] The section list has no Remove, and cannot build a state `assertSections` refuses.
- [ ] `copy.footer.followLabel` without U+00A0 is refused server-side and by a content-rule test.
- [ ] A reload mid-edit offers to restore the draft.
- [ ] A publish that never reaches `live` gives up after 10 minutes with the commit link.
- [ ] The WhatsApp figure is labelled an estimate.

## Handed to later plans

- **Plan 5 (Edit mode)** reuses `RecordForm`, `PhotoField`, `content.ts` and `publish.ts` against the real page, wrapping the public components rather than reimplementing them (D3).
- **Plan 6 (Collage)** adds 2-D drag placement for `galleries.heroCollage`'s `className` grid strings. It does **not** replace `RecordList`, whose up/down buttons are the mandated touch interaction per the spec's Risks section. **Read the Plan 3 ledger's Tailwind note first:** seven grid utilities in `galleries.json` are absent from the shipped CSS and seven more ship only because test files spell them out, so the collage is already laid out differently from what the JSON says. Fixing that changes the live homepage and must be deliberate.
- **Plan 7 (Section templates)** adds template types to Task 2's descriptors. Every type here is a flat record; `Page { slug, name, inNav, sections: Section[] }` is the first nested list-of-records — do not assume flatness in the form machinery.
- **Deriving `index.html`'s head from `site.json`** (Task 2 Step 5) is ~30 lines and unlocks the share-preview text, which is currently developer-owned.
- **Session revocation** still does not exist: rotating the password leaves outstanding 7-day tokens valid unless `TOKEN_SECRET` is rotated too.
