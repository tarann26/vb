# Plan 1: Migrate hosting to Cloudflare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the site off Vercel onto Cloudflare Pages, move image generation into the build, and add visitor analytics, with no visible change to the site.

**Architecture:** Cloudflare Pages reads `_headers` and `_redirects` from the build output the way Vercel read `vercel.json`. The build command grows an image-generation step, which means generated derivatives stop being committed and the test that guarded them is deleted. Everything else is unchanged.

**Tech Stack:** Vite 5, React 18, TypeScript strict, Tailwind 3, Vitest, sharp (build-time only), Cloudflare Pages.

## Context

Phases A1 and A2 (39 commits, reviewed, on branch `repair/phase-a`) fixed the site and built the content layer. Spec for B and C: `docs/superpowers/specs/2026-08-02-phase-b-c-dashboard-and-sections-design.md`.

This is Plan 1 of 8. It is a prerequisite for the Worker in Plan 3, which is where the login, the publishing and the scheduled-rebuild cron live.

Current state: `npm run build` exits 0, `npx vitest run` is 451/451 across 24 files, working tree clean, `dist/` is 24MB of which 20MB is menu PDFs.

**Two reasons for moving, and the second matters more than cost.** Cloudflare has points of presence in India, so the site is faster for Delhi visitors. And Vercel's Hobby plan is for non-commercial use, which a restaurant's website is not. The owner has been asked to verify that against Vercel's current terms independently.

## Global Constraints

- **No visible change to the site.** Every page must render identically before and after. This plan is infrastructure.
- **No component file is deleted.** Seven are protected and covered by a test: `AdminReservations.tsx`, `ReservationForm.tsx`, `ReservationPage.tsx`, `ChefGallery.tsx`, `NewsPress.tsx`, `SignatureMocktails.tsx`, `BlogsPage.tsx`.
- **No new runtime services.** Analytics is one script tag from the host we are already on.
- **Asset paths never start with `/public/`.** Vite serves `public/` at the root.
- **Content exports use a type annotation or a throwing runtime guard, never `as`.** `src/content/index.ts` is bundled into the browser: never `node:fs` or `import.meta.glob` there. Test files and build scripts may use node APIs freely.
- **Brand colours stay:** `#6B8B59`, `#222`, `#F9F9F9`, `#FFFDF8`. **Fonts stay:** Parisienne, Montserrat, Open Sans.
- **Do not delete `vercel.json` until the final task.** It is the rollback path if the Cloudflare cutover goes wrong.
- Work continues on branch `repair/phase-a`. Do not push to `main`.
- Commit after every task.

## What this plan cannot do, and who does it

Creating the Cloudflare account, connecting the repository and pointing DNS are operations only the owner can perform. This plan produces every artifact those steps need and ends with a checklist for the human. Do not attempt to create accounts or change DNS.

## File Structure

**Created:** `public/_headers`, `public/_redirects`, `src/test/hosting.test.ts`, `docs/cloudflare-cutover.md`, `.nvmrc`

**Modified:** `package.json`, `.gitignore`, `index.html`, `src/components/Hero.tsx`, `README.md`, `src/test/smoke.test.ts`

**Deleted:** `scripts/__tests__/freshness.test.mjs`, and eventually `vercel.json`

---

### Task 1: Cloudflare routing and cache config

`vercel.json` currently holds three things: a build command, an SPA rewrite, and two cache rules. Cloudflare Pages expresses the last two as files in the build output.

**Files:**
- Create: `public/_headers`, `public/_redirects`, `src/test/hosting.test.ts`
- Test: `src/test/hosting.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks. This is configuration.

- [ ] **Step 1: Write the failing test**

`src/test/hosting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('cloudflare hosting config', () => {
  it('rewrites every unmatched route to the SPA entry point', () => {
    expect(existsSync('public/_redirects')).toBe(true);
    const redirects = readFileSync('public/_redirects', 'utf8');
    expect(redirects).toMatch(/^\/\*\s+\/index\.html\s+200$/m);
  });

  it('caches hashed bundles immutably', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    expect(headers).toContain('/assets/*');
    expect(headers).toMatch(/max-age=31536000/);
    expect(headers).toMatch(/immutable/);
  });

  it('caches unhashed public assets for a week, revalidating', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    expect(headers).toMatch(/max-age=604800/);
    expect(headers).toMatch(/must-revalidate/);
  });

  it('never marks unhashed assets immutable', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    const blocks = headers.trim().split(/\n\s*\n/);
    const unhashed = blocks.filter((b) => !b.startsWith('/assets/'));
    expect(unhashed.length).toBeGreaterThan(0);
    unhashed.forEach((block) => expect(block).not.toContain('immutable'));
  });
});
```

The last assertion is the one that matters, and its shape is deliberate. It parses the file into blocks and checks
only the blocks that are not `/assets/`, with a `length > 0` guard so it cannot pass by finding nothing to check.

A review of this plan caught an earlier version that split the file on the literal `/assets/*` and checked the text
*before* it. Because that rule is first in the file, the checked segment was always empty and the assertion passed
whether or not the bug existed. Do not simplify it back.

Why it matters: unhashed filenames are stable while their contents change, so an immutable year would leave a
replaced photo stuck in visitors' caches with no way to bust it. That distinction is the whole reason there are two
rules.

Run: `npx vitest run src/test/hosting.test.ts`
Expected: FAIL, files missing.

- [ ] **Step 2: Write the redirect**

`public/_redirects`:

```
/*    /index.html   200
```

Status 200 rather than 301 or 302: this is a rewrite, not a redirect. The URL stays as the visitor typed it and React Router handles the route. A 301 would change the address bar and break every deep link.

- [ ] **Step 3: Write the headers**

`public/_headers`. **Cloudflare merges the headers of every matching rule** rather than taking the first match, and
two rules setting the same header name produce a comma-joined value. So ordering is not what keeps these rules
apart; the fact that they match disjoint sets of files is.

That holds today because Vite emits only hashed `.js` and `.css` into `dist/assets/`, never an image. It would stop
holding the day someone imports an image as an ES module, which is a normal Vite pattern and would place a hashed
image under `/assets/`. That file would then match both rules and receive a nonsense merged header. The test in
Step 1 does not catch it, because the collision is in the build output rather than in this file.

Write the rules in this order anyway, for readability:

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*.webp
  Cache-Control: public, max-age=604800, must-revalidate

/*.jpg
  Cache-Control: public, max-age=604800, must-revalidate

/*.png
  Cache-Control: public, max-age=604800, must-revalidate

/*.svg
  Cache-Control: public, max-age=604800, must-revalidate

/*.pdf
  Cache-Control: public, max-age=604800, must-revalidate
```

Cloudflare's `_headers` syntax does not support alternation, so each extension needs its own block. That is more verbose than `vercel.json`'s single regex and is not a mistake.

Run: `npx vitest run src/test/hosting.test.ts`
Expected: PASS.

- [ ] **Step 4: Confirm both files reach the build output**

```bash
rm -rf dist && npm run build && ls -la dist/_headers dist/_redirects
```

Expected: both present. Vite copies `public/` verbatim, so this should work, but confirm rather than assume: a config file that never ships is silently useless.

- [ ] **Step 5: Verify locally with Wrangler if available**

```bash
npx wrangler pages dev dist --port 8788
```

If it starts, request a deep route and confirm the rewrite works:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8788/blogs
curl -sI http://localhost:8788/assets/$(ls dist/assets | head -1) | grep -i cache-control
```

Expected: `200` for `/blogs`, and an immutable cache header on the hashed asset.

If Wrangler cannot be installed or run in this environment, say so plainly in your report rather than claiming you checked. This verification is genuinely useful but it is not worth fabricating.

- [ ] **Step 6: Commit**

```bash
git add public/_headers public/_redirects src/test/hosting.test.ts
git commit -m "feat(hosting): add cloudflare routing and cache configuration"
```

---

### Task 2: Move image generation into the build

Today, generated `.webp` derivatives are committed, and `scripts/__tests__/freshness.test.mjs` re-encodes all 48 sources to prove the committed bytes match. That test exists only because the derivatives are committed.

Phase B requires the founder to upload photos through a Worker, and a Worker cannot run the image library, which is a native binary. So the Worker will commit only her original, and the build generates the derivative. That makes committed derivatives redundant.

**Files:**
- Modify: `package.json`, `.gitignore`, `README.md`
- Delete: `scripts/__tests__/freshness.test.mjs`, and the committed derivatives under `public/`

**Interfaces:**
- Consumes: `scripts/images.mjs`, unchanged.
- Produces: a build that regenerates `public/` derivatives from `assets-source/` every time.

- [ ] **Step 1: Understand what you are deleting before you delete it**

Read `scripts/images.mjs` and `scripts/__tests__/freshness.test.mjs` first. The freshness test is good work and was praised in review; it is being removed because its premise no longer holds, not because it was wrong.

Confirm that `scripts/images.mjs` already handles everything the build will need: collision detection, pruning, per-directory widths, the share-image generation, and per-file error collection with a non-zero exit. All of that landed in A2 and none of it changes here.

- [ ] **Step 2: Put generation in the build**

In `package.json`, change the build script to run image generation first:

```json
"build": "npm run images && tsc -b && vite build"
```

Leave `test` and `test:deploy` alone. `test:deploy` currently excludes the freshness test by name; once that file is gone the exclusion is dead but harmless, and Task 4 tidies it.

- [ ] **Step 2b: Fix the test that pins the old build command**

`src/test/smoke.test.ts` asserts `pkg.scripts.build` equals the literal `'tsc -b && vite build'`. Step 2 just changed
it, so that test now fails. The plan originally missed this entirely and a review caught it.

Update the assertion to the new value. Keep it an exact-string check rather than loosening it to `toContain`: the
point of that test is to pin the build command so a later edit cannot silently drop the type-check, and a substring
match would let `vite build` alone pass.

Run: `npx vitest run src/test/smoke.test.ts`
Expected: PASS.

- [ ] **Step 3: Stop committing derivatives**

Add to `.gitignore`:

```
# Generated from assets-source/ by `npm run images`
/public/atmosphere/
/public/food/
/public/hero/
/public/mocktails/
/public/our_story/
/public/press/
/public/team/
/public/og-image.jpg
```

Then remove them from the index without deleting them from disk:

```bash
git rm -r --cached public/atmosphere public/food public/hero public/mocktails public/our_story public/press public/team public/og-image.jpg
```

**Do not add `/public/menus/` or `/public/Menu - Expanded.pdf`.** Those PDFs are not generated from `assets-source/` and must stay tracked.

**Do not use `git rm -r` without `--cached`.** That deletes the working copies, and while `npm run images` would regenerate them, doing it by accident on a live repository is the kind of mistake worth naming.

- [ ] **Step 4: Delete the freshness test**

```bash
git rm scripts/__tests__/freshness.test.mjs
```

- [ ] **Step 5: Prove the build regenerates from nothing**

This is the step that matters. If the build cannot recreate `public/` from `assets-source/` alone, the site ships without images and nothing catches it.

```bash
rm -rf public/atmosphere public/food public/hero public/mocktails public/our_story public/press public/team public/og-image.jpg
npm run build
npx vitest run
```

Expected: the build regenerates every derivative, the asset guardrail passes, and the full suite is green. Record how long the build took, before and after this change.

If the guardrail fails naming a missing file, the generator and the content layer disagree about a path. Fix the generator or the content, never the test.

- [ ] **Step 6: Update the README**

The README currently tells a non-developer that `public/` images are generated and warns that hand-placed files there get deleted. Both statements stay true. What changes:

- Generated images are no longer committed, so a fresh clone has no `public/` images until `npm run images` or `npm run build` runs. Say so in Setup.
- The freshness check no longer exists, so the "Tests" section's explanation of `test:deploy` needs rewriting.

Read those sections and correct them rather than appending. The README was written for someone who follows instructions literally, and a stale instruction is worse than a missing one.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "build: generate images during the build instead of committing them"
```

---

### Task 3: Visitor analytics and the reservation conversion event

The owner asked for visitor counts and nothing more. Cloudflare Web Analytics is free, requires no cookie banner because it does not track individuals, and is one script tag.

One custom event beyond page views: taps on the WhatsApp reservation button. It is the only action on the site that turns into money, and counting it costs nothing.

**Files:**
- Modify: `index.html`, `src/components/Hero.tsx`
- Test: `src/test/analytics.test.ts`, `src/components/__tests__/Hero.test.tsx`

**Interfaces:**
- Consumes: `site.whatsapp` from `src/content`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

`src/test/analytics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('analytics', () => {
  it('loads cloudflare web analytics', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('static.cloudflareinsights.com/beacon.min.js');
  });

  it('loads it deferred so it cannot block rendering', () => {
    const html = readFileSync('index.html', 'utf8');
    const tag = html.match(/<script[^>]*cloudflareinsights[^>]*>/)?.[0] ?? '';
    expect(tag).toMatch(/\bdefer\b/);
  });

  it('uses a placeholder token that must be replaced at cutover', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('CLOUDFLARE_ANALYTICS_TOKEN');
  });
});
```

The third assertion is deliberate. The real token only exists once the owner creates the Cloudflare project, so the repository carries an obvious placeholder and the cutover checklist names it. A test asserting the placeholder is present means nobody can forget it is there, and it will fail loudly the moment somebody replaces it, which is the reminder to update this test too.

Add to `src/components/__tests__/Hero.test.tsx`. That file does not currently import `userEvent`, so add it
alongside the existing imports, matching how `NavBar.test.tsx` already does it:

```tsx
import userEvent from '@testing-library/user-event';
```

`vi` needs no import; `vitest.config.ts` sets `globals: true`.

```tsx
it('reports a conversion when the reservation button is used', async () => {
  const user = userEvent.setup();
  const beacon = vi.fn();
  vi.stubGlobal('__cfBeacon', { trackEvent: beacon });
  vi.stubGlobal('open', vi.fn());

  render(<MemoryRouter><Hero /></MemoryRouter>);
  await user.click(screen.getByRole('button', { name: /reserve a table/i }));

  expect(beacon).toHaveBeenCalledWith('reservation_click');
  vi.unstubAllGlobals();
});

it('still opens whatsapp when analytics is unavailable', async () => {
  const user = userEvent.setup();
  const open = vi.fn();
  vi.stubGlobal('open', open);
  vi.stubGlobal('__cfBeacon', undefined);

  render(<MemoryRouter><Hero /></MemoryRouter>);
  await user.click(screen.getByRole('button', { name: /reserve a table/i }));

  expect(open).toHaveBeenCalled();
  vi.unstubAllGlobals();
});
```

The second test is the important one. Analytics must never be able to break the reservation button. A blocked script, an ad blocker, or a slow load must leave the button working.

Run: `npx vitest run src/test/analytics.test.ts src/components/__tests__/Hero.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Add the beacon**

In `index.html`, before `</body>`:

```html
<script defer src="https://static.cloudflareinsights.com/beacon.min.js"
        data-cf-beacon='{"token": "CLOUDFLARE_ANALYTICS_TOKEN"}'></script>
```

- [ ] **Step 3: Report the conversion, safely**

In `Hero.tsx`, the WhatsApp button currently calls `window.open` directly. Wrap it so the tracking call cannot throw into the click handler:

```tsx
const openWhatsApp = () => {
  try {
    (window as { __cfBeacon?: { trackEvent?: (name: string) => void } })
      .__cfBeacon?.trackEvent?.('reservation_click');
  } catch {
    // Analytics must never block a reservation.
  }
  window.open(
    `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(site.whatsapp.prefilledMessage)}`,
    '_blank',
    'noopener',
  );
};
```

Keep every Tailwind class on the button byte-identical. The only change is what `onClick` calls.

Run: `npx vitest run src/test/analytics.test.ts src/components/__tests__/Hero.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(analytics): add cloudflare web analytics and reservation conversion tracking"
```

---

### Task 4: Cutover checklist and decommission

Everything the repository can do is done. What remains needs the owner's hands.

**Files:**
- Create: `docs/cloudflare-cutover.md`
- Modify: `package.json`
- Delete: `vercel.json`

- [ ] **Step 1: Write the checklist**

`docs/cloudflare-cutover.md`, written for someone doing this once, under time pressure, who has not read this plan. Cover:

1. Create a Cloudflare account and a Pages project connected to this GitHub repository.
2. Build command `npm run test:deploy && npm run build`, output directory `dist`, Node version taken from the
   `.nvmrc` this plan adds rather than guessed.
3. Confirm the preview deployment renders correctly **before** touching DNS. Two specific checks, both of which
   have failed for other people:
   - A hard refresh on `/blogs` returns the page rather than a 404. That proves `_redirects` is working.
   - The build log shows the image-generation step running and reporting 48 images. This build is the first time
     `sharp` has ever run in this project's production pipeline; on Vercel it never did. The lockfile carries the
     Linux binaries so it should resolve, and a failure here is a loud build failure rather than a silent broken
     deploy, but check it on the first deploy rather than assuming.
4. Enable Web Analytics, copy the token, replace `CLOUDFLARE_ANALYTICS_TOKEN` in `index.html`, and update the test in `src/test/analytics.test.ts` that asserts the placeholder.
5. Point DNS at Cloudflare Pages.
6. Verify the live site: images load, `/blogs` deep-links, the menu PDFs download, the WhatsApp button opens WhatsApp.
7. Only then remove the Vercel project.

State plainly at the top that step 3 comes before step 5, and that the Vercel deployment stays live as the rollback until step 7.

- [ ] **Step 2: Remove the Vercel configuration**

```bash
git rm vercel.json
```

**First, remove the test that reads it.** `src/test/smoke.test.ts` has a `describe('vercel deploy configuration', …)`
block that calls `JSON.parse(readFileSync('vercel.json', 'utf8'))` at collection time. Deleting the file without
touching that block throws ENOENT and fails the whole test file. The plan originally missed this and a review caught
it.

Delete that describe block. Everything it asserted about routing and caching is now covered by
`src/test/hosting.test.ts` against `_headers` and `_redirects`, so nothing is lost. Leave the rest of
`smoke.test.ts` alone.

In `package.json`, simplify `test:deploy`. It was `vitest run --exclude "**/freshness.test.mjs"`, and that file no longer exists:

```json
"test:deploy": "vitest run"
```

Then `test` and `test:deploy` are identical. Keep both names: `test:deploy` is what the host's build command calls, and having it as its own script means the deploy gate can diverge later without editing host configuration.

- [ ] **Step 3: Verify nothing referenced what you deleted**

```bash
grep -rn "vercel" --include="*.json" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.md" . | grep -v node_modules | grep -v "\.superpowers"
```

Expected: matches in `docs/` and `README.md` describing history or the cutover, plus **comment-only** mentions in
`scripts/paths.mjs`, `scripts/__tests__/images.test.mjs`, `src/test/head.test.ts`, `src/components/SeoHead.tsx` and
`src/components/__tests__/SeoHead.test.tsx`. Those are prose explaining past decisions and are fine to leave.

What is not fine is any match that is **executable**: a `readFileSync('vercel.json')`, an import, or a config value.
Read each hit rather than counting them. Note that `--include="*.mjs"` was added after a review found the original
grep could not see the `scripts/` directory at all.

- [ ] **Step 3b: Pin the Node version**

Create `.nvmrc` containing the major version from `node -v`. Cloudflare reads it, which makes the project's Node
setting self-documenting instead of a number someone types into a dashboard and forgets.

- [ ] **Step 4: Full verification**

```bash
npm run build && npx vitest run && npm run lint && git status --porcelain
```

Expected: build exits 0, suite green, lint clean, working tree clean. Record the final test count and the build duration.

Then check the site by eye, because this plan's whole claim is that nothing visible changed. Serve the build
(`npx vite preview`) and compare against the previous commit at 375px, 768px and 1440px: images load, `/blogs`
deep-links, the menu PDFs download, the WhatsApp button opens WhatsApp, and the console is clean on both routes.

If you cannot drive a browser in this environment, say so plainly rather than claiming you checked. Close any
browser you open.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove vercel configuration and document the cutover"
```

---

## Definition of done

- [ ] `npm run build` exits 0 and regenerates `public/` images from `assets-source/` alone.
- [ ] `npx vitest run` green. Record the count.
- [ ] `dist/_headers` and `dist/_redirects` both present after a build.
- [ ] Deleting every generated image and rebuilding restores them, verified for real.
- [ ] The site renders identically to before at 375px, 768px and 1440px, with no console errors.
- [ ] No generated image is tracked in git; the two PDFs under `public/menus/` still are. (There is no
      `public/Menu - Expanded.pdf`; an unrelated file of that name lives under `assets-source/` and is also tracked.)
- [ ] `docs/cloudflare-cutover.md` exists and names the analytics token placeholder.
- [ ] `vercel.json` is gone and nothing in source or configuration references Vercel.

## Handed to Plan 3

The scheduled-rebuild cron trigger. A Cloudflare cron has to run inside a Worker, and no Worker exists until Plan 3. The spec originally assigned it here in error.
