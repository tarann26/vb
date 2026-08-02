# Phase A2: Performance and Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the site load in seconds on Delhi mobile data, and make it shareable and findable, without changing how it looks.

**Architecture:** Camera originals move out of the deploy path into `assets-source/`. A build-time Node script using `sharp` generates web-sized WebP into `public/`, and the content layer's paths update to match, guarded by the existing asset test. Everything else is head metadata, static files, and one Vercel config.

**Tech Stack:** Vite 5, React 18, TypeScript 5.5 (strict), Tailwind 3, Vitest, sharp (devDependency, build-time only).

## Context

Phase A1 (branch `repair/phase-a`, 28 commits) moved all content into typed JSON under `src/content/`, fixed 60 broken asset paths, removed a dead unauthenticated Supabase admin page, added a mobile menu, and built a 433-test suite. It deliberately left the site heavy.

Current state:

| Measure | Value |
|---|---|
| `public/` | 219MB |
| `dist/` | 238MB |
| Image files | 48 |
| `.JPG` camera originals | 17 files, 154MB, averaging 9MB each |
| `.png` | 18 files, 30MB |
| Largest single image | `public/food/pizza1.JPG`, 12MB, displayed at 320×256 CSS px |
| Menu PDFs | 21MB, committed deliberately in A1 |

## Global Constraints

- **No restyling.** No change to palette, type scale, spacing, radii, shadows or layout. Tailwind classes on existing elements stay byte-identical. Images must look the same at the sizes they are displayed.
- **No component file is deleted.** Seven are protected and covered by a test: `AdminReservations.tsx`, `ReservationForm.tsx`, `ReservationPage.tsx`, `ChefGallery.tsx`, `NewsPress.tsx`, `SignatureMocktails.tsx`, `BlogsPage.tsx`.
- **No new runtime services.** No CDN, no image service, no account with a quota. `sharp` is a devDependency invoked by an npm script; nothing new runs in production.
- **Asset paths never start with `/public/`.** Vite serves `public/` at the root.
- **Every asset path in content JSON must match the on-disk filename byte for byte,** including case. macOS is case-insensitive; Vercel's Linux hosts are not.
- **Content exports use a type annotation or a throwing runtime guard, never `as`.** `src/content/index.ts` is bundled into the browser: never import `node:fs` or use `import.meta.glob` there. Test files and build scripts may use node APIs freely.
- **Brand colours stay:** `#6B8B59` (sage), `#222` (near-black), `#F9F9F9`, `#FFFDF8`. **Fonts stay:** Parisienne (display), Montserrat (headings/UI), Open Sans (body).
- Work continues on branch `repair/phase-a`. Do not push to `main`.
- Commit after every task.

## The metric that matters

A1's spec set a target of "total `dist/` under 5MB". That is now unreachable and was the wrong measure anyway: A1 deliberately committed 21MB of menu PDFs, and those transfer only when a visitor clicks a download button.

**A2's target is homepage transfer weight**, measured as the sum of everything the browser fetches for a cold load of `/`. Target: **under 1.5MB**. Secondary: `public/` image bytes under 5MB total.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `assets-source/` | Camera originals, tracked in git, never deployed. |
| `scripts/images.mjs` | Reads `assets-source/`, writes web-sized WebP into `public/`. |
| `public/robots.txt` | Crawler directives plus sitemap pointer. |
| `public/sitemap.xml` | Two routes. |
| `public/favicon.svg` | Replaces the dangling `/vite.svg` reference. |
| `README.md` | How to run, build, test, and regenerate images. |

**Modified:** `package.json`, `index.html`, `vercel.json`, `src/index.css`, `src/components/Hero.tsx`, `src/test/head.test.ts`, every JSON file under `src/content/` that holds an image path.

---

### Task 1: Image pipeline

The single largest change in the phase. Everything else in A2 is small by comparison.

**Files:**
- Create: `assets-source/` (via `git mv`), `scripts/images.mjs`
- Modify: `package.json`, `src/content/galleries.json`, `dishes.json`, `drinks.json`, `press.json`, `site.json`
- Test: existing `src/content/__tests__/assets.test.ts` is the guardrail; add `scripts/__tests__/images.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run images`, regenerating every derivative from `assets-source/`.

- [ ] **Step 1: Move the originals out of the deploy path**

Vite copies everything in `public/` into `dist/`, so originals sitting there are deployed whether or not anything references them. Use `git mv` so history follows the files and no new blobs enter the pack.

```bash
mkdir -p assets-source
for d in atmosphere food hero mocktails our_story press team; do
  git mv "public/$d" "assets-source/$d"
done
```

Leave `public/menus/` and `public/Menu - Expanded.pdf` where they are. They are already compressed and are not image sources.

At this point every image path in the content layer is broken. That is expected and temporary. Confirm the guardrail notices:

Run: `npx vitest run src/content`
Expected: FAIL, many paths no longer resolving. If it passes, the guardrail is not doing its job and you should stop and report.

- [ ] **Step 2: Install sharp**

```bash
npm install -D sharp@^0.35
```

devDependency only. It must not appear in `dependencies`.

- [ ] **Step 3: Write the generator**

`scripts/images.mjs`:

```js
import { readdir, mkdir, stat } from 'node:fs/promises';
import { join, extname, basename, relative } from 'node:path';
import sharp from 'sharp';

const SOURCE = 'assets-source';
const OUT = 'public';
const MAX_WIDTH = 1000;
const QUALITY = 78;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png']);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    ),
  );
  return files.flat();
}

export function outputPathFor(sourcePath) {
  const rel = relative(SOURCE, sourcePath);
  const dir = rel.slice(0, rel.length - basename(rel).length);
  return join(OUT, dir, `${basename(rel, extname(rel))}.webp`);
}

export async function build({ log = () => {} } = {}) {
  const sources = (await walk(SOURCE)).filter((f) =>
    IMAGE_EXT.has(extname(f).toLowerCase()),
  );
  let total = 0;
  for (const src of sources) {
    const out = outputPathFor(src);
    await mkdir(out.slice(0, out.length - basename(out).length), { recursive: true });
    await sharp(src)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(out);
    const { size } = await stat(out);
    total += size;
    log(`${src} -> ${out} (${(size / 1024).toFixed(0)}KB)`);
  }
  return { count: sources.length, totalBytes: total };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { count, totalBytes } = await build({ log: console.log });
  console.log(`\n${count} images, ${(totalBytes / 1024 / 1024).toFixed(2)}MB total`);
}
```

Note `.rotate()` with no argument: it applies the EXIF orientation tag and then strips metadata. Camera originals frequently carry orientation, and dropping it silently rotates portrait photos sideways. This is the single most likely way to make the site visibly wrong.

Add to `package.json` scripts: `"images": "node scripts/images.mjs"`.

- [ ] **Step 4: Generate and measure**

Run: `npm run images`

Expected: 48 images processed. Record the reported total. If it exceeds 5MB, lower `QUALITY` in steps of 4 and rerun until it fits, then note the final value in your report. Do not go below 65; below that, artefacts become visible on food photography, which is the whole point of the site.

- [ ] **Step 5: Point the content layer at the derivatives**

Every image path in `src/content/*.json` still ends in `.JPG`, `.jpg`, `.jpeg` or `.png`. All derivatives are `.webp`, at the same relative path.

Rewrite the extensions, preserving the rest of each path exactly, including capitalisation of the basename. `public/food/Aglio e Pepperoncini.jpg` becomes `public/food/Aglio e Pepperoncini.webp`, so the content path is `/food/Aglio e Pepperoncini.webp` with its capitals intact.

Do not touch `site.json`'s `seo.url`, which is not an asset path.

Run: `npx vitest run src/content`
Expected: PASS. Any failure names the exact offending path. Fix the JSON, never the test.

- [ ] **Step 6: Test the generator itself**

`scripts/__tests__/images.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { outputPathFor } from '../images.mjs';

describe('outputPathFor', () => {
  it('maps a source image to a webp at the same relative path', () => {
    expect(outputPathFor('assets-source/food/pizza1.JPG')).toBe('public/food/pizza1.webp');
  });

  it('preserves capitalisation and spaces in the basename', () => {
    expect(outputPathFor('assets-source/food/Aglio e Pepperoncini.jpg')).toBe(
      'public/food/Aglio e Pepperoncini.webp',
    );
  });

  it('preserves the subdirectory', () => {
    expect(outputPathFor('assets-source/our_story/cut.JPG')).toBe('public/our_story/cut.webp');
  });
});
```

Run: `npx vitest run scripts`
Expected: PASS.

- [ ] **Step 7: Verify orientation survived**

The failure this catches is silent and severe. Pick the three tallest source images and confirm the derivative has the same aspect orientation:

```bash
node -e "
import('sharp').then(async ({default: sharp}) => {
  for (const f of ['our_story/cut','food/pizza1','atmosphere/ambience']) {
    const src = await sharp('assets-source/'+f+'.JPG').metadata();
    const out = await sharp('public/'+f+'.webp').metadata();
    const o = (m) => m.width >= m.height ? 'landscape' : 'portrait';
    console.log(f, 'source', o({width: src.autoOrient?.width ?? src.width, height: src.autoOrient?.height ?? src.height}), '-> out', o(out));
  }
});
"
```

Expected: source and output orientation match on all three. If any flipped, `.rotate()` is not applying and you must fix it before continuing.

- [ ] **Step 8: Confirm the deploy shrank**

```bash
rm -rf dist && npm run build && du -sh dist && du -sh public
```

Expected: `public/` image bytes under 5MB; `dist/` around 25MB, of which ~21MB is the two menu PDFs. Record both.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "perf: resize and convert images to webp, move originals out of the deploy path"
```

---

### Task 2: Document head and social sharing

`index.html` points its favicon at `/vite.svg`, which does not exist. `twitter:card` is `summary_large_image` with no image declared, so every WhatsApp share of this restaurant renders a blank grey card. Six metadata strings duplicate content-layer values with nothing pinning them.

**Files:**
- Create: `public/favicon.svg`
- Modify: `index.html`, `src/content/site.json`, `src/content/types.ts`, `src/test/head.test.ts`
- Test: `src/test/head.test.ts`

**Interfaces:**
- Consumes: `site` from `src/content`.

- [ ] **Step 1: Make a favicon**

A monogram in the brand sage, no external assets:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#6B8B59"/>
  <text x="32" y="44" font-family="Georgia, serif" font-size="34" font-style="italic"
        text-anchor="middle" fill="#FFFDF8">VB</text>
</svg>
```

Update `index.html`'s icon link to `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`.

- [ ] **Step 2: Choose the share image**

`site.json` already carries `seo.ogImage`, currently `/atmosphere/dining.jpg`, which Task 1 renamed to `.webp`. WebP is not reliably rendered by WhatsApp or older link-preview crawlers, so the share image needs a JPEG.

Generate one at the standard 1200×630:

```bash
node -e "
import('sharp').then(({default: sharp}) =>
  sharp('assets-source/atmosphere/dining.jpg')
    .resize(1200, 630, { fit: 'cover' })
    .jpeg({ quality: 82 })
    .toFile('public/og-image.jpg')
    .then(() => console.log('written'))
);
"
```

Set `seo.ogImage` to `/og-image.jpg`. Confirm the file is under 300KB; crawlers commonly ignore larger.

- [ ] **Step 3: Write the failing test**

Extend `src/test/head.test.ts`. It already pins `<title>` and `meta[name=description]` against `site.seo`. Add the six that drifted:

```ts
const tag = (html: string, attr: string, value: string) =>
  html.match(new RegExp(`<meta\\s+${attr}="${value}"\\s+content="([^"]*)"`))?.[1];

it('pins open graph and twitter strings to the content layer', () => {
  const html = readFileSync('index.html', 'utf8');
  expect(tag(html, 'property', 'og:title')).toBe(`${site.name} - ${site.tagline}`);
  expect(tag(html, 'property', 'og:description')).toBe(site.strapline);
  expect(tag(html, 'property', 'og:url')).toBe(site.seo.url);
  expect(tag(html, 'property', 'og:image')).toBe(`${site.seo.url}${site.seo.ogImage}`);
  expect(tag(html, 'property', 'twitter:title')).toBe(`${site.name} - ${site.tagline}`);
  expect(tag(html, 'property', 'twitter:description')).toBe(site.strapline);
});

it('declares a canonical url', () => {
  const html = readFileSync('index.html', 'utf8');
  expect(html).toContain(`<link rel="canonical" href="${site.seo.url}" />`);
});

it('points the favicon at a file that exists', () => {
  const html = readFileSync('index.html', 'utf8');
  const href = html.match(/<link rel="icon"[^>]*href="([^"]*)"/)?.[1];
  expect(href).toBeTruthy();
  expect(existsSync(`public${href}`)).toBe(true);
});
```

This puts `site.strapline` to work. The whole-branch review found it had no consumer anywhere while the same sentence sat hardcoded in three places.

Run: `npx vitest run src/test/head.test.ts`
Expected: FAIL on all three.

- [ ] **Step 4: Update index.html to match**

Set `og:title`, `og:description`, `og:url`, `og:image` (absolute URL, as crawlers require), `twitter:title`, `twitter:description`, `twitter:image`, plus `og:site_name`, `og:locale` (`en_IN`), and the canonical link.

Run: `npx vitest run src/test/head.test.ts`
Expected: PASS.

- [ ] **Step 5: Move the font import out of CSS**

`src/index.css:1` loads Google Fonts with `@import`. That is render-blocking and cannot benefit from the `preconnect` hints already in `index.html`, because the CSS itself has to download and parse first.

Delete the `@import` line and add to `index.html`, after the existing preconnects:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Parisienne&family=Montserrat:wght@300;400;500;600;700&family=Open+Sans:wght@300;400;500;600;700&display=swap">
```

Keep the family and weight list byte-identical. Dropping a weight silently changes rendered type.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(seo): real favicon, social share image, canonical url, non-blocking fonts"
```

---

### Task 3: Crawler files

**Files:**
- Create: `public/robots.txt`, `public/sitemap.xml`
- Test: `src/test/crawlers.test.ts`

- [ ] **Step 1: Write the failing test**

`src/test/crawlers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { site } from '../content';

describe('crawler files', () => {
  it('serves robots.txt pointing at the sitemap', () => {
    expect(existsSync('public/robots.txt')).toBe(true);
    expect(readFileSync('public/robots.txt', 'utf8')).toContain(`${site.seo.url}/sitemap.xml`);
  });

  it('lists every public route in the sitemap', () => {
    const xml = readFileSync('public/sitemap.xml', 'utf8');
    expect(xml).toContain(`<loc>${site.seo.url}/</loc>`);
    expect(xml).toContain(`<loc>${site.seo.url}/blogs</loc>`);
  });

  it('does not advertise the unrouted admin or reservation pages', () => {
    const xml = readFileSync('public/sitemap.xml', 'utf8');
    expect(xml).not.toContain('/admin');
    expect(xml).not.toContain('/reservation');
  });
});
```

The third assertion matters: those routes were unregistered in A1 precisely because `/admin` had no authentication. Listing them in a sitemap would invite crawlers to the exact pages that must stay unfindable if a backend ever returns.

Run: `npx vitest run src/test/crawlers.test.ts`
Expected: FAIL, files missing.

- [ ] **Step 2: Write the files**

`public/robots.txt`:

```
User-agent: *
Allow: /

Sitemap: https://viabiancadelhi.com/sitemap.xml
```

`public/sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://viabiancadelhi.com/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://viabiancadelhi.com/blogs</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>
```

No `<lastmod>`. A hardcoded date rots the moment the page changes, and a wrong one is worse than none.

Run: `npx vitest run src/test/crawlers.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(seo): add robots.txt and sitemap.xml"
```

---

### Task 4: Hero heading hierarchy

`Hero.tsx` renders `<h1>Via Bianca</h1>` inside the decorative logo circle and then `<h2>Via Bianca</h2>` immediately below. Screen readers announce the restaurant's name twice, and the page's actual heading is a decorative element.

**Files:**
- Modify: `src/components/Hero.tsx`
- Test: `src/components/__tests__/Hero.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('has exactly one h1, and it is the page heading rather than the logo', () => {
  const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
  const h1s = container.querySelectorAll('h1');
  expect(h1s).toHaveLength(1);
  expect(h1s[0].textContent).toBe(site.name);
  expect(h1s[0].closest('[aria-hidden="true"]')).toBeNull();
});
```

Run: `npx vitest run src/components/__tests__/Hero.test.tsx`

Expected: FAIL on the third assertion. The current markup has one `<h1>` (inside the logo circle) and one `<h2>`, so the count assertion passes and the text assertion passes; what fails is `closest('[aria-hidden="true"]')`, because today's single `h1` **is** the decorative logo. Confirm it fails for that reason and not another before proceeding.

- [ ] **Step 2: Fix the hierarchy**

In the logo circle, change the `<h1>` to a `<p>` and mark the circle `aria-hidden="true"`, since it duplicates text that appears immediately below. Promote the visible `<h2>Via Bianca</h2>` to `<h1>`.

**Keep every Tailwind class byte-identical on both elements.** `h1` and `h2` carry no default styling here; Tailwind's preflight resets both. The rendered output must not change.

Run: `npx vitest run src/components/__tests__/Hero.test.tsx`
Expected: PASS.

- [ ] **Step 3: Confirm nothing moved visually**

Run `npm run dev` and compare the hero against the previous commit at 1440px and 375px. Report what you observed. If you cannot drive a browser, say so plainly rather than claiming you checked.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "a11y(hero): single h1, decorative logo hidden from assistive tech"
```

---

### Task 5: Rename the chef's photo

`public/team/alice.jpg` is labelled "Chef Kamalika Anand". "alice" is placeholder naming from the original generated build.

It has **two** referrers, and missing the second breaks a live image: the parked `ChefGallery.tsx`, and `src/content/press.json`, which renders it on `/blogs`.

**Files:**
- Modify: `assets-source/team/`, `src/content/press.json`, `src/components/ChefGallery.tsx`

- [ ] **Step 1: Rename the source and regenerate**

```bash
git mv "assets-source/team/alice.jpg" "assets-source/team/kamalika-anand.jpg"
rm public/team/alice.webp
npm run images
```

- [ ] **Step 2: Update both referrers**

`src/content/press.json`: `/team/alice.webp` becomes `/team/kamalika-anand.webp`.

`src/components/ChefGallery.tsx`: same change. It is parked and unrendered, but leaving a dangling path there is a landmine for whoever revives it.

- [ ] **Step 3: Verify**

Run: `npx vitest run`
Expected: PASS. The asset guardrail fails loudly if either referrer was missed.

```bash
grep -rn "alice" src/ assets-source/ public/
```
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: rename the chef's photo from its placeholder filename"
```

---

### Task 6: Vercel configuration

Two changes, one of which is a stated prerequisite for Phase B.

**Files:**
- Modify: `vercel.json`, `package.json`

- [ ] **Step 1: Run the tests in the deploy pipeline**

A1's final review parked this with a ruling. The content layer validates at module load and throws on bad data, so a malformed `site.json` produces a **blank page on every route** while `tsc` and `vite build` both exit 0. There is no CI, and `vercel.json` sets no build command, so nothing runs the test suite before a deploy.

That is tolerable while only engineers edit content through git. It stops being tolerable the moment Phase B puts editing in a non-engineer's hands, which is the entire point of Phase B.

In `vercel.json`, add:

```json
"buildCommand": "npm run test && npm run build"
```

Verify it fails closed. Temporarily set `site.json`'s `hours[0].days` to `["Xx"]`, run `npm run test && npm run build`, and confirm the command exits non-zero and no `dist/` is produced. Revert and confirm it exits 0.

- [ ] **Step 2: Cache the images**

Everything in `public/` is served with Vercel's default `cache-control: public, max-age=0, must-revalidate`, so every image revalidates on every visit. Vite's own bundle output is content-hashed and already cached correctly; `public/` files are not hashed, so they need an explicit policy.

Add to `vercel.json`:

```json
"headers": [
  {
    "source": "/(.*)\\.(webp|jpg|png|svg|pdf)",
    "headers": [{ "key": "Cache-Control", "value": "public, max-age=604800, must-revalidate" }]
  }
]
```

One week with revalidation, not the usual immutable year, because these filenames are stable and their contents change whenever the founder replaces a photo. An immutable year would leave a stale photo on repeat visitors' screens with no way to bust it.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ci: run tests before deploy, cache static assets"
```

---

### Task 7: README

The repo has no README. The next person to open it, quite possibly the owner months from now, has no way to know that images are generated rather than committed by hand.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write it**

Cover, briefly and concretely:

- What this is and where it deploys.
- `npm install`, `npm run dev`, `npm run build`, `npm test`.
- **How to add or replace a photo:** drop the original into `assets-source/<folder>/`, run `npm run images`, update the path in the relevant `src/content/*.json`, run `npm test`. State that `public/` images are generated and hand-editing them will be overwritten.
- How to change opening hours, dishes, drinks, press, and the story, naming the specific file for each.
- That `src/content/` is the only place content lives, and that the test suite fails if a path or required field is wrong.
- That six components are parked and unrendered, and where the revival notes are.
- That `New Menu/` is gitignored and holds the designer's source files.

Write it for someone who is not a developer and may be following instructions rather than reasoning about them.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README covering content edits and the image pipeline"
```

---

## Definition of done

- [ ] `npm run build` exits 0; `npm test` green.
- [ ] `public/` image bytes under 5MB; record the actual figure.
- [ ] Homepage cold-load transfer weight under 1.5MB, measured in a browser's network panel with cache disabled. If you cannot measure it, say so.
- [ ] No image in `assets-source/` is deployed; `dist/` contains no `assets-source` directory.
- [ ] Photo orientation verified unchanged on at least three portrait sources.
- [ ] Favicon, `og:image`, canonical, `robots.txt` and `sitemap.xml` all present, and the head strings pinned to `site.json` by test.
- [ ] Exactly one `<h1>` on the homepage.
- [ ] `grep -rn "alice" src/ public/ assets-source/` returns nothing.
- [ ] Site renders correctly at 375px, 768px and 1440px with no console errors.

## Not in this phase

Phase C adds the founder's new sections: B2B supply, the B2C bread and dip line, catering, cheeseboards, the membership booklet, and Sunday kids' classes. Phase B builds the editing dashboard.

Still blocked on the founder, carried forward from A1: eight dish confirmations, nine press URLs, authoritative opening hours (`site.json` currently claims noon to 11:30pm daily, which the new breakfast menu contradicts), whether the LinkedIn page exists, and whether the "award-winning tiramisu" and "Michelin-starred kitchens" claims in `press.json` are accurate.
