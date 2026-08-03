# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/edit/manage` — the screen where the restaurant owner adds a dish, replaces a photo, swaps the menu PDF, reorders a section, schedules something for next week, and presses Publish, then finds out whether it worked.

**Architecture:** A lazy-loaded admin route that never enters the public bundle. Forms are rendered from per-type field descriptors typed `Record<keyof T, FieldSpec>`, so `tsc` fails if a content type gains a field the form doesn't cover. Every write goes through the Worker built in Plan 3: validate, commit, poll. No new backend.

**Tech Stack:** React 18, React Router 7, TypeScript strict, Vitest, Testing Library. No form library, no state library, no new runtime dependency.

## Global Constraints

- **Branch `repair/phase-a`. Never push. Never touch `main`.** The site is live.
- **`npx tsc -b --noEmit`, never `npx tsc --noEmit`.** The root `tsconfig.json` is solution-style with `"files": []`, so the plain form checks nothing and exits 0 on any codebase. It produced two false "typecheck clean" reports during Plan 2.
- **Admin code must never reach the public bundle.** This is the constraint most likely to be broken silently, because a single static import does it. See "The bundle guard is currently inert" below — fixing it is Task 1's job, before anything is built on top.
- **The rendered homepage stays byte-identical at 53473 bytes**, pinned by `src/test/homepage-bytes.test.tsx` (measure with `TextEncoder`; JS `.length` reads 53454 and is not the invariant). Adding a route to `AppRoutes` must not change what renders at `/`.
- **A test that cannot fail is a defect, not coverage.** Nineteen have been caught on this project — three in briefs the orchestrator wrote, one created by a fix, one inert in both states. For every behaviour you claim, break it and confirm *that named assertion* fires.
- **A test must be invariant under any legitimate content edit.** `test:deploy` is `vitest run` and the deploy command runs it, so a test coupled to today's content blocks the owner's future edits. Eleven such tests were found at the end of Plan 2.
- **Tailwind's content scanner reads `./src/**/*.{js,ts,jsx,tsx}` including comments.** Three separate tasks have moved a bundle hash by writing a utility-class name in a comment. If a hash shifts without a class change, check that first.
- Six components are parked and unrendered (`AdminReservations`, `ReservationForm`, `ReservationPage`, `ChefGallery`, `NewsPress`, `SignatureMocktails`). A test fails if any is deleted.
- Commit messages in the style of `git log --oneline -5`. Never mention AI or any assistant; no co-author trailers.

## What Plan 3 built that this consumes

| Endpoint | Contract |
|---|---|
| `POST /api/login` | `{ password }` → 204 + `vb_session` cookie (httpOnly, Secure, SameSite=Strict, 7 days). 401 wrong, 429 rate-limited, 500 if unconfigured. |
| `POST /api/publish` | `{ files: [{ path, content, encoding }] }` → `{ sha }`. **422 with `{ problems: [{ field, message }] }` if any file is invalid — nothing is committed.** 401 unauthenticated. 502 on a conflict. |
| `POST /api/upload` | multipart `category` + `file` → `{ path }`. Rejects >25MB, unknown formats, HEIC, unknown categories. |
| `GET /api/build-status?sha=` | `{ state: 'queued'\|'building'\|'live'\|'failed', deploymentUrl, commitUrl }`. Authenticated. |
| `GET /api/wa` | `{ ..., lowerBound: true }`. Authenticated. |
| `build-info.json` | `{ sha, builtAt }`, served `no-store`. Written only on a **successful** build. |

`validateContent` in `src/content/validate.ts` is the same function the Worker calls. **Import it and validate in the browser too**, so she sees "this dish needs a name" as she types rather than after pressing Publish. The Worker remains the authority; the client copy is for latency, not trust.

## Three things the last review left for this plan

**1. The bundle guard is currently inert.** `src/test/bundle.test.ts`'s HEIC check is `skipIf(!existsSync('dist/assets'))`, and `npm run test:deploy` runs *before* `npm run build`, so it is the one skipped test on every run. And nothing outside `src/admin/` imports the module yet, so it passes either way, for the wrong reason. **This plan is the first real caller.** Task 1 makes both halves real before any admin code exists to leak.

**2. Upload returns the wrong path for content JSON.** `POST /api/upload` returns `assets-source/food/<hash>.jpg`. What `dishes.json` needs is `/food/<hash>.webp` — the derivative `npm run images` generates. Getting this wrong is a broken image *and* a failed deploy, because the content guards catch a dangling image reference at `test:deploy` time. Task 4 fixes this at the source rather than in the UI.

**3. PDF replacement has no endpoint at all.** The menus live at `public/menus/*.pdf`; `commitFiles`' allowlist permits only `src/content/*.json` and `assets-source/<cat>/<file>`; and `/api/upload` rejects PDFs at format detection. Task 5 extends the Worker.

## Two decisions this plan makes, stated up front

**`site.seo.*`, `site.name` and `site.tagline` stay developer-owned.** `src/test/head.test.ts` keeps `index.html`'s hardcoded `<title>` and meta tags in sync with `site.json`, so editing those fields in the dashboard fails the deploy until someone hand-edits `index.html` too. The alternative — deriving the head at build time — is a real improvement and a separate piece of work touching a live file. The dashboard shows these fields **read-only with a one-line explanation**. A restaurant renames itself approximately never; a broken deploy every time she opens the settings screen is the worse trade.

**The WhatsApp number is shown as an estimate.** It is capped, origin-checked and built on eventually-consistent storage, and `GET /api/wa` returns `lowerBound: true` for exactly this reason. Label it "at least N" — implying precision it does not have would be worse than the estimate.

---

### Task 1: The admin route, and making the bundle guard real

**Files:**
- Create: `src/admin/AdminApp.tsx`, `src/admin/Login.tsx`, `src/admin/session.ts`, `src/admin/__tests__/session.test.ts`
- Modify: `src/App.tsx`, `src/test/bundle.test.ts`

**Interfaces:**
- Produces: `<AdminApp />` mounted at `/edit/manage/*`; `useSession()` returning `{ status: 'checking' | 'out' | 'in', logIn, logOut }`.
- Consumes: `POST /api/login`.

**Do the guard first.** Everything else in this plan is built behind it, and a leak found later is a leak that has already shipped.

- [ ] **Step 1: Make the two bundle checks real, and prove both fail**

`src/test/bundle.test.ts` currently has an import-graph test (works) and a `dist/` grep that is skipped on every run because `test:deploy` precedes the build.

Keep the grep but stop pretending it runs in the gate: rename it so its name says it only runs post-build, and add a separate npm script that runs it after `npm run build`. Then extend the **import-graph** test — the one that does run — to cover `src/admin/` as a whole, not just `admin/heic`:

```ts
it('nothing outside src/admin imports admin code', () => {
  const offenders = gitLsFiles('src')
    .filter((f) => !f.startsWith('src/admin/') && /\.tsx?$/.test(f))
    .filter((f) => /from ['"][^'"]*admin\/[^'"]+['"]|^\s*import\s+['"][^'"]*admin\/[^'"]+['"]/m.test(read(f)));
  expect(offenders).toEqual([]);
});
```

Note the second alternative: a bare side-effect import (`import '../admin/x';`) has no `from`. An earlier version of this check missed that, and the widened form then matched the test file itself — exclude the test's own path deliberately, with a comment saying why.

**Verify both:** add a static `import { AdminApp } from './admin/AdminApp'` to `src/App.tsx`, confirm the import-graph test goes red; build and confirm the post-build check goes red too; remove.

- [ ] **Step 2: Write the failing route test**

```tsx
it('does not render admin code at /', () => {
  render(<MemoryRouter initialEntries={['/']}><AppRoutes /></MemoryRouter>);
  expect(screen.queryByLabelText(/password/i)).toBeNull();
});

it('renders the login form at /edit/manage', async () => {
  render(<MemoryRouter initialEntries={['/edit/manage']}><AppRoutes /></MemoryRouter>);
  expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
});
```

The second needs `findBy`, not `getBy` — the route is lazy, so it resolves asynchronously.

- [ ] **Step 3: Add the lazy route**

```tsx
const AdminApp = lazy(() => import('./admin/AdminApp'));
// ...
<Route path="/edit/manage/*" element={<Suspense fallback={null}><AdminApp /></Suspense>} />
```

`lazy` is what keeps the admin chunk out of the main bundle. A static import here defeats the whole task.

Add `/edit/*` to `public/robots.txt` as `Disallow`. It is not a security control — the login is — but there is no reason for it in an index.

- [ ] **Step 4: Session state without storing anything**

The session cookie is `httpOnly`, so JavaScript cannot read it. `useSession` therefore cannot check "am I logged in" by inspecting a cookie. Probe instead: call an authenticated endpoint (`GET /api/wa`) and treat 401 as logged out.

Do **not** store a "logged in" flag in `localStorage`. It would go stale the moment the 7-day token expires, and she would see a dashboard that 401s on every action.

- [ ] **Step 5: The login form**

One password field, one button. On 401 show "That password didn't work." On 429 show "Too many attempts. Try again in 15 minutes." On 500 show "Login isn't set up yet — ask your developer." Never echo the password.

- [ ] **Step 6: Verify and commit**

Homepage still 53473 bytes and the rendered DOM byte-identical. Report the main-chunk hash and the new lazy chunk separately — the main chunk must not grow.

```bash
git add -A
git commit -m "feat(admin): add the lazy-loaded dashboard route behind a password"
```

---

### Task 2: Field descriptors the compiler keeps honest

**Files:**
- Create: `src/admin/fields.ts`, `src/admin/__tests__/fields.test.ts`

**Interfaces:**
- Produces: `type FieldSpec = { label: string; kind: 'text' | 'textarea' | 'image' | 'select' | 'date' | 'tags' | 'readonly'; options?: readonly string[]; help?: string }`, and one `Record<keyof T, FieldSpec>` per editable type.
- Consumes: the types in `src/content/types.ts`.

The spec says forms are "generated from the existing TypeScript types, not hand-built per content type", because that is "what makes Phase C's sections editable the day they exist."

TypeScript types do not exist at runtime, so nothing can literally read them. What delivers the spec's intent without a codegen step or a new dependency is a descriptor typed `Record<keyof T, FieldSpec>`: **add a field to `Dish` and `tsc` fails until the form covers it.** This repo already relies on that exact pattern three times — `DISH_KEYS`, `DRINK_KEYS` and `ARTICLE_KEYS` in `src/content/__tests__/shape.test.ts`, and `SECTION_ID_SET` in `src/content/guards.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it('fails to compile if a type gains a field', () => {
  // Compile-time, not runtime: this test documents the guarantee and the
  // typecheck enforces it. The falsifiability check is in Step 3.
  expect(Object.keys(DISH_FIELDS).sort()).toEqual(
    (['id', 'name', 'description', 'image', 'tags', 'publishAt'] as string[]).sort(),
  );
});

it('marks tags as not visible to a diner', () => {
  expect(DISH_FIELDS.tags.help).toMatch(/not shown|not visible/i);
});
```

- [ ] **Step 2: Write the descriptors**

`Dish`, `Drink`, `Article`, `Section`, `MenuFile`, `GalleryImage`, `Hours`, and the `Copy` leaves.

Two the descriptors must get right, both from earlier reviews:

- **`Dish.tags`** carries a comment in `types.ts` saying it is authored but deliberately not rendered, and that any editing tool "must not treat `tags` as visible to a diner today." Give it `help` text saying so. She will otherwise reasonably assume editing it changes the page.
- **`press.readArticle`** in `copy.json` drives **both** the homepage teaser and `/blogs`. Its `help` must say so — one field, two surfaces.

`site.seo.*`, `site.name`, `site.tagline` get `kind: 'readonly'` with the explanation from this plan's header.

- [ ] **Step 3: Prove the compiler guarantee is real**

Add a field to `Dish` in `src/content/types.ts`, run `npx tsc -b --noEmit`, confirm it fails naming `fields.ts`, remove it. A descriptor that drifts silently is the whole thing this design exists to prevent, so verify it rather than asserting it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): describe every editable field in a compiler-checked map"
```

---

### Task 3: The form, the list, and validation as she types

**Files:**
- Create: `src/admin/Field.tsx`, `src/admin/RecordForm.tsx`, `src/admin/RecordList.tsx`, `src/admin/__tests__/RecordForm.test.tsx`, `src/admin/__tests__/RecordList.test.tsx`
- Modify: `src/admin/AdminApp.tsx`

**Interfaces:**
- Produces: `<RecordForm fields={…} value={…} onChange={…} problems={…} />`, `<RecordList items={…} onReorder={…} onAdd={…} onRemove={…} />`.
- Consumes: `validateContent` from `src/content/validate.ts`; `FieldSpec` from Task 2.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the problem next to the field it names', () => {
  render(<RecordForm fields={DISH_FIELDS} value={{ ...validDish, name: '' }}
    problems={[{ field: '[0].name', message: 'A dish needs a name.' }]} onChange={noop} />);
  const input = screen.getByLabelText(DISH_FIELDS.name.label);
  expect(input).toHaveAccessibleDescription('A dish needs a name.');
});

it('reorders without losing the item', async () => {
  const onReorder = vi.fn();
  render(<RecordList items={[a, b, c]} fields={DISH_FIELDS} onReorder={onReorder} … />);
  await userEvent.click(screen.getAllByRole('button', { name: /move down/i })[0]);
  expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
});
```

Associate the message with the input via `aria-describedby` and assert `toHaveAccessibleDescription` — asserting the text merely *appears somewhere* passes even when it is attached to the wrong field, which for a 38-item drinks list is the difference between useful and useless.

- [ ] **Step 2: Reorder with buttons, not drag**

Up and down buttons. Drag-to-reorder is Plan 6's problem and it is the expensive one; a list of 38 drinks reorders fine with buttons, and buttons work on her phone.

- [ ] **Step 3: Validate as she types, using the real validator**

`validateContent` is the same function the Worker runs. Import it. Debounce, and show problems inline.

Say plainly in a comment that this is a **latency optimisation, not a trust boundary** — the Worker re-validates and is the authority. A future contributor who deletes the server-side check because "the client already validates" is the failure this comment exists to prevent.

- [ ] **Step 4: Never let a save lose unrelated data**

She edits one dish; the publish sends the whole file. Round-trip every field, including ones no form renders (`tags`, and anything a later type gains before its descriptor does).

Test it: load a record with an unknown extra key, edit one field, and assert the extra key survives.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): render records from field descriptors with inline validation"
```

---

### Task 4: Photos

**Files:**
- Create: `src/admin/PhotoField.tsx`, `src/admin/__tests__/PhotoField.test.tsx`, `src/shared/derivative-path.ts`, `src/shared/__tests__/derivative-path.test.ts`
- Modify: `worker/upload.ts`, `worker/__tests__/upload.test.ts`

**Interfaces:**
- Produces: `derivativePath(sourcePath: string): string` — `assets-source/food/abc.jpg` → `/food/abc.webp`; `POST /api/upload` response gains `contentPath`.
- Consumes: `convertHeic` from `src/admin/heic.ts`.

- [ ] **Step 1: Put the derivation next to the rule it mirrors**

The upload response returns the **source** path. Content JSON needs the **derivative** path. `scripts/paths.mjs` owns that naming rule, but it is a Node module the Worker cannot import.

Extract the rule into `src/shared/derivative-path.ts` — the same move `src/shared/image-format.ts` made for the same reason — and have **the Worker** return `contentPath` alongside `path`. Deriving it in the UI would put the rule in a third place; a mismatch there is a broken image *and* a failed deploy.

Test against real cases from `scripts/paths.mjs`: the per-directory width rules do not affect the path, but the extension always becomes `.webp` and the leading `assets-source/` becomes a leading `/`.

- [ ] **Step 2: Wire HEIC conversion — and keep it out of the public bundle**

```ts
const converted = await convertHeic(file);   // dynamic import inside
```

**Keep the dynamic import.** `convertHeic` already uses one, and Task 1 made the import-graph test real — but a `dist/` grep alone would not catch a regression here, because the WASM only appears once something imports it. This is the first real caller, so this is where it can first go wrong.

- [ ] **Step 3: Show her what is happening**

Converting a HEIC takes seconds on a phone. Show progress. On rejection, show the Worker's message, which already names the reason ("This photo is HEIC…", "This upload is 26.30MB; the limit is 25MB").

- [ ] **Step 4: Batch uploads into one commit**

Uploading twelve photos as twelve commits makes Cloudflare cancel superseded builds, which `GET /api/build-status` now correctly reports as `failed` — so she would see most of her successful uploads marked failed, retry, and double the build burn against a 500/month quota.

Collect uploads and send them with the publish. `commitFiles` already takes N files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): upload photos, convert heic, and return the path content needs"
```

---

### Task 5: The menu PDFs

**Files:**
- Modify: `worker/github.ts`, `worker/upload.ts`, `worker/__tests__/github.test.ts`, `worker/__tests__/upload.test.ts`
- Create: `src/admin/PdfField.tsx`, `src/admin/__tests__/PdfField.test.tsx`

**Interfaces:**
- Produces: a third allowed path shape, `public/menus/<name>.pdf`.
- Consumes: `commitFiles`.

The printed menu is the thing she will most want to replace and the one the current Worker cannot accept at all.

- [ ] **Step 1: Extend the allowlist deliberately, and test the boundary**

`commitFiles`' path allowlist is the only thing between a malformed request and a rewritten `.github/workflows/`. A whole-branch review threw 54 hostile paths at it and none escaped. **Do not loosen the existing shapes.** Add a third, equally tight:

```ts
/^public\/menus\/[a-z0-9-]+\.pdf$/
```

Re-run the traversal cases with the new shape in place — `public/menus/../../package.json`, `public/menus/%2e%2e/x.pdf`, `public/../public/menus/x.pdf`, and a nested `public/menus/a/b.pdf` — and confirm each is still rejected.

- [ ] **Step 2: Accept PDFs at upload, only for this path**

`detectFormat` returns `null` for a PDF, which is correct for photos. Add a separate, explicit check for the menu route: `%PDF-` magic bytes, and the same 25MB ceiling.

A PDF must **not** become acceptable to the photo route, and an image must not become acceptable to the menu route. Test both directions.

- [ ] **Step 3: Keep `menus.json` and the file in step**

`src/content/menus.json` holds the label and the `file` path. Replacing the PDF under the same name needs no JSON change; uploading under a new name does. Send both in one publish, so a rename cannot half-land.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): let the owner replace the printed menu pdfs"
```

---

### Task 6: Hours, sections, and scheduling

**Files:**
- Create: `src/admin/HoursField.tsx`, `src/admin/SectionList.tsx`, `src/admin/ScheduleField.tsx`, and their tests
- Modify: `src/admin/AdminApp.tsx`

**Interfaces:**
- Consumes: `assertHours`, `assertSections` from `src/content/guards.ts`; `Section` from `types.ts`.

- [ ] **Step 1: Hours**

`site.json`'s `hours` is an array of `{ days: DayCode[], opens, closes }`. One value drives both the footer and the structured data Google reads, which is the point of it living in one place.

Two things the guards already know and the form must not fight:
- `assertHours` takes a **typed** parameter, not `unknown`. Feed it the right shape.
- A closing time **past midnight** is valid and documented in `src/content/hours.ts` as "a correct literal reading of the two clock times, not a bug" — a real shape this repo has had before. The restaurant has a bar. Do not add a "closes must be after opens" rule; a previous test asserted exactly that and had to be removed because it blocked a legitimate edit.

- [ ] **Step 2: Sections — reorder and toggle**

`sections.json` is the homepage's ordered list. She reorders and toggles.

`assertSections` **rejects a disabled hero** and rejects a `publishAt` key on any section. Surface both as form-level rules rather than letting the publish 422 — she should not be able to build a state the server will refuse.

Show the seven sections by a human name, not by `SectionId`. `atmosphere` renders as "Atmosfera" and lives at `#gallery`; the ids deliberately differ from the anchors and neither is her vocabulary.

- [ ] **Step 3: Scheduling**

`publishAt` is an optional ISO `YYYY-MM-DD` on `Dish`, `Drink` and `Article`. Use a native `<input type="date">` — it produces `YYYY-MM-DD` and sidesteps the DD-MM-versus-MM-DD ambiguity that a text field invites. A malformed date is now caught by `validateContent`, but the right fix is not letting her type one.

State plainly next to the control that publishing happens on an **hourly** check, not at midnight — the cron's cadence is the granularity, and nobody should promise otherwise.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): edit hours, reorder sections, and schedule content"
```

---

### Task 7: Publish, and finding out whether it worked

**Files:**
- Create: `src/admin/publish.ts`, `src/admin/PublishBar.tsx`, `src/admin/__tests__/publish.test.ts`
- Modify: `src/admin/AdminApp.tsx`

**Interfaces:**
- Consumes: `POST /api/publish`, `GET /api/build-status`, `build-info.json`.

The spec: *"Step 5 exists because of step 4. Once a bad edit cannot break the site, the new failure mode is that her work silently evaporates. She must be told."*

- [ ] **Step 1: Accumulate, then send once**

Edits mark unsaved. Publish sends every changed file plus every pending upload in **one** request, which becomes one commit.

- [ ] **Step 2: Poll, and say something true at every stage**

Poll `GET /api/build-status?sha=` and stop on `live` or `failed`. Back off — a 90-second build polled every second is 90 requests for one publish.

| State | What she sees |
|---|---|
| `queued` / `building` | "Publishing… this usually takes a minute or two." |
| `live` | "Your changes are live." |
| `failed` | "Something went wrong publishing. Your site hasn't changed." + the commit link. |

- [ ] **Step 3: Translate the developer sentences**

Plan 3's Worker returns accurate but developer-facing errors. Own the translation here:

| From the Worker | What she reads |
|---|---|
| 422 `{ problems }` | each message inline, next to its field |
| 502 "someone else published while you were editing" | "Someone else published while you were editing. Reload to get their changes, then try again." |
| 502 "GitHub returned 5xx" | "Couldn't reach the server that stores your changes. Nothing was lost — try again in a minute." |
| 401 | "You've been signed out. Log in and your changes will still be here." |

**The 401 case matters most.** The session lasts seven days and can expire mid-edit. Losing an afternoon's work to a silent 401 is the worst outcome this screen can produce — keep the unsaved state in memory across the re-login.

- [ ] **Step 4: The non-breaking space control point**

`copy.footer.followLabel` is `Follow Us:`. The non-breaking space stops the label wrapping at ≤280px, and its loss was ruled Critical during Plan 2 — found only by measuring in a browser. **No test can catch it**, which is why the handoff assigned the control point here.

Add a rule to `validateContent` in `src/content/validate.ts`: that field must contain U+00A0. Then surface it in the form as a field that renders the character visibly (a marker, not a raw space) so she can see it exists.

Server-side, because the client is not the authority — and because a paste from a plain-text editor is how it would actually be lost.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): publish in one commit and report what happened"
```

---

## Definition of done

- [ ] `npm run test` green; `npm run test:deploy` green; `npx tsc -b --noEmit` clean; `npm run build` exit 0; `npx eslint .` clean. Record the count.
- [ ] **Nothing under `src/admin/` reaches the main bundle**, proven by an import-graph test that fails on a static import and a post-build check that actually runs.
- [ ] The homepage is 53473 bytes and the rendered DOM byte-identical.
- [ ] Adding a field to `Dish` fails `tsc` until the descriptor covers it.
- [ ] A publish with one invalid file shows the problem next to its field and commits nothing.
- [ ] A photo upload returns the path `dishes.json` needs, not the source path.
- [ ] A HEIC uploads successfully from a phone-sized file, and its WASM is absent from the main bundle.
- [ ] A menu PDF can be replaced; `commitFiles` still rejects every traversal case with the third path shape in place.
- [ ] A past-midnight closing time is accepted.
- [ ] A disabled hero cannot be built in the form.
- [ ] `copy.footer.followLabel` without U+00A0 is refused by the server with a readable message.
- [ ] A 401 mid-publish does not lose unsaved work.
- [ ] The WhatsApp figure is labelled an estimate.

## Handed to later plans

- **Plan 5 (Edit mode)** reuses `RecordForm`, `PhotoField` and `publish.ts` against the real page. It must wrap the public components rather than reimplement them — a second copy of the rendering drifts from the real one and defeats the purpose (D3).
- **Plan 6 (Collage)** replaces `RecordList`'s buttons with drag for the hero grid only. **Read the Plan 3 ledger's note on the Tailwind defect first:** seven grid utilities in `galleries.json` are absent from the shipped CSS and seven more ship only because test files spell them out, so the collage is already laid out differently from what the JSON says. That must be fixed deliberately — it changes the live homepage — before drag is built on top.
- **Plan 7 (Section templates)** adds template types to the descriptors in Task 2. Every type here is a flat record; `Page { slug, name, inNav, sections: Section[] }` will be the first nested list-of-records, so do not assume flatness in the form machinery.
- **Session revocation** still does not exist: rotating the password leaves outstanding 7-day tokens valid unless `TOKEN_SECRET` is rotated too.
