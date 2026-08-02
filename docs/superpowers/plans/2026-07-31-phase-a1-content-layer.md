# Phase A1: Content Layer and Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every editable string and asset path out of React components into validated JSON under `src/content/`, and fix the correctness bugs that make the live site show broken images and fabricated dish names.

**Architecture:** Components become dumb renderers that read typed JSON. A Vitest suite walks every content file and asserts each referenced asset exists in `public/` with exact case, which is the guardrail against the bug class that broke this site. No backend, no new services, no visual redesign.

**Tech Stack:** Vite 5, React 18, TypeScript 5.5 (strict), Tailwind 3, Vitest, @testing-library/react, jsdom.

## Global Constraints

- **No restyling.** Do not change the palette, type scale, spacing, border radii, shadows or layout of any existing element. Tailwind classes on elements that already exist stay byte-identical. This constraint forbids redesign; it does not forbid the new elements this plan mandates (the mobile menu in Task 12, dish descriptions in Task 5, carousel edge fades in Task 13, the Drinks section in Task 6). New elements must adopt the existing visual language rather than introduce a new one.
- **No component file is deleted.** `ChefGallery.tsx`, `NewsPress.tsx`, `AdminReservations.tsx`, `ReservationForm.tsx`, `ReservationPage.tsx`, `SignatureMocktails.tsx` and `BlogsPage.tsx` all stay on disk. Routes may be unregistered; files may not be removed.
- **No new runtime services.** No CDN, no image service, no database, no account with a quota. Build-time and dev-time tooling only.
- **Asset paths never start with `/public/`.** Vite serves `public/` at the root. `/public/x.jpg` 404s in a production build.
- **Every asset path in content JSON must match the on-disk filename byte for byte,** including case. macOS is case-insensitive and Vercel's Linux hosts are not.
- **Brand colours stay:** `#6B8B59` (sage), `#222` (near-black), `#F9F9F9` and `#FFFDF8` (section grounds).
- **Fonts stay:** Parisienne (display), Montserrat (headings/UI), Open Sans (body).
- Work happens on branch `repair/phase-a`. Do not push to `main`.
- Commit after every task.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/content/types.ts` | TypeScript interfaces for every content file. Single source of shape. |
| `src/content/site.json` | Hours, phones, address, socials, SEO strings. |
| `src/content/story.json` | Our Story paragraphs. |
| `src/content/dishes.json` | Food gallery items. |
| `src/content/drinks.json` | Mocktails, cocktails, wine. |
| `src/content/press.json` | Press articles. |
| `src/content/galleries.json` | Atmosphere and hero collage images. |
| `src/content/menus.json` | Downloadable menu PDFs. |
| `src/content/index.ts` | Typed re-export barrel. Components import from here, never from raw JSON. |
| `src/content/__tests__/assets.test.ts` | Asserts every content asset path resolves, exact case. |
| `src/content/__tests__/shape.test.ts` | Asserts required fields are present and non-empty. |
| `src/components/Drinks.tsx` | Merged, removable drinks section. |
| `src/components/NotFound.tsx` | 404 route. |
| `src/components/ErrorBoundary.tsx` | Top-level render guard. |
| `src/test/setup.ts` | Vitest DOM setup. |
| `vitest.config.ts` | Test config. |
| `vercel.json` | SPA rewrite. |

**Modified:** every file in `src/components/` except the parked ones, plus `package.json`, `vite.config.ts`, `index.html`, `src/App.tsx`.

---

### Task 1: Toolchain baseline

Nothing can be verified until the project installs, type-checks and tests. `node_modules` is absent and `npm run build` currently skips `tsc` entirely, which is why an unused `useNavigate()` in `Hero.tsx` ships despite `noUnusedLocals` being on.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `src/test/setup.ts`, `vercel.json`
- Test: `src/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs Vitest; `npm run build` runs `tsc -b && vite build`.

- [ ] **Step 1: Install dependencies**

```bash
npm install
npm install -D vitest@^2 jsdom@^25 @testing-library/react@^16 @testing-library/jest-dom@^6
```

- [ ] **Step 2: Create the test config**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
```

`src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Write a smoke test that fails**

`src/test/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('toolchain', () => {
  it('build script type-checks before bundling', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.build).toBe('tsc -b && vite build');
  });

  it('package is not named after the starter template', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.name).not.toBe('vite-react-typescript-starter');
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run src/test/smoke.test.ts`
Expected: FAIL, both assertions. Build is `vite build`, name is `vite-react-typescript-starter`.

- [ ] **Step 5: Update package.json**

Set `"name": "via-bianca-site"`, and in `scripts`:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "preview": "vite preview"
}
```

- [ ] **Step 6: Run the test again**

Run: `npx vitest run src/test/smoke.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the build and fix what it surfaces**

Run: `npm run build`
Expected: FAIL. At minimum `src/components/Hero.tsx:7`, `'navigate' is declared but its value is never read.` (TS6133).

Fix that one by deleting line 7 (`const navigate = useNavigate();`) and the now-unused `useNavigate` import on line 3. Hero's only button uses `window.open` for WhatsApp, so nothing else changes.

`tsc` has never run on this codebase, so other strict-mode errors may surface. Fix each with the minimum change that preserves current runtime behaviour. Do not disable a rule, do not add `any`, and do not delete a component to make an error go away. If an error cannot be fixed without changing behaviour, stop and report it rather than guessing.

Re-run `npm run build`. Expected: PASS.

- [ ] **Step 8: Add the SPA rewrite**

`vercel.json`:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts vercel.json src/test src/components/Hero.tsx
git commit -m "build: add vitest, type-check the build, add SPA rewrite"
```

---

### Task 2: Content types and the asset guardrail

This is the highest-value task in the plan. The bug that broke this site is a path string that looks right and resolves to nothing. A test that walks the content and checks the filesystem makes that class of bug impossible to ship again.

Case sensitivity matters here and is easy to get wrong. `fs.existsSync` on macOS returns `true` for `public/food/aglio e pepperoncini.jpg` even though the file is `Aglio e Pepperoncini.jpg`, then 404s on Vercel. The test must build a `Set` of real filenames from `readdir` and compare against that, not call `existsSync`.

**Files:**
- Create: `src/content/types.ts`, `src/content/site.json`, `src/content/index.ts`, `src/content/__tests__/assets.test.ts`
- Modify: `tsconfig.app.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the typed content exports consumed by Tasks 3 through 9, and the guardrail test in `src/content/__tests__/assets.test.ts`, which discovers asset paths by walking every JSON file in `src/content/`. Later tasks add a JSON file and a typed export; discovery needs no registration.

- [ ] **Step 1: Allow JSON imports**

In `tsconfig.app.json` `compilerOptions`, add `"resolveJsonModule": true`.

- [ ] **Step 2: Define the types**

`src/content/types.ts`:

```ts
export interface Hours {
  label: string;
  value: string;
}

export interface SiteContent {
  name: string;
  tagline: string;
  strapline: string;
  address: { street: string; locality: string; postalCode: string; country: string };
  phones: string[];
  whatsapp: { number: string; prefilledMessage: string };
  socials: { instagram: string; linkedin: string | null };
  hours: Hours[];
  structuredDataHours: string[];
  seo: { title: string; description: string; keywords: string; ogImage: string; url: string };
  copyrightYear: number;
}

export interface Dish {
  id: string;
  name: string;
  description: string;
  image: string;
  tags: string[];
}

export interface Drink {
  id: string;
  name: string;
  description: string;
  category: 'mocktail' | 'cocktail' | 'wine';
  image: string | null;
}

export interface Article {
  id: string;
  title: string;
  publication: string;
  date: string;
  excerpt: string;
  url: string;
  image: string;
}

export interface GalleryImage {
  src: string;
  alt: string;
}

export interface Galleries {
  atmosphere: GalleryImage[];
  ourStory: GalleryImage[];
  heroCollage: { src: string; className: string }[];
}

export interface StoryContent {
  heading: string;
  paragraphs: string[];
}

export interface MenuFile {
  id: string;
  label: string;
  file: string;
}
```

- [ ] **Step 3: Write site.json**

Values below come from the existing footer and `index.html`, with two corrections: the Saturday/Sunday closing time was `11:30 AM` (a PM/AM typo reading as 23.5 hours of service) and the copyright year was 2024. If the founder supplies different hours, only this file changes.

`src/content/site.json`:

```json
{
  "name": "Via Bianca",
  "tagline": "Pastificio & Ristorante",
  "strapline": "Sip Italiano, Taste the Soul of Puglia",
  "address": {
    "street": "N-Block Market, Greater Kailash I",
    "locality": "New Delhi",
    "postalCode": "110048",
    "country": "IN"
  },
  "phones": ["+91 92115 63311", "+91 92117 91188"],
  "whatsapp": {
    "number": "919211791188",
    "prefilledMessage": "Hi, I want to reserve a table"
  },
  "socials": {
    "instagram": "https://instagram.com/viabiancadelhi",
    "linkedin": "https://linkedin.com/company/viabiancadelhi"
  },
  "hours": [
    { "label": "Monday – Friday", "value": "12:00 PM – 11:30 PM" },
    { "label": "Saturday – Sunday", "value": "12:00 PM – 11:30 PM" }
  ],
  "structuredDataHours": ["Mo-Su 12:00-23:30"],
  "seo": {
    "title": "Via Bianca - Pastificio & Ristorante | Authentic Italian Dining in Delhi",
    "description": "Via Bianca Pastificio & Ristorante - Authentic Italian dining in Greater Kailash, Delhi. Hand-crafted pastas, wood-fired classics, and a full bar by Chef Kamalika Anand.",
    "keywords": "Italian restaurant Delhi, handmade pasta, Via Bianca, Greater Kailash dining, authentic Italian food, Chef Kamalika Anand",
    "ogImage": "/atmosphere/dining.jpg",
    "url": "https://viabiancadelhi.com"
  },
  "copyrightYear": 2026
}
```

- [ ] **Step 4: Create the barrel**

> **Superseded during execution (2026-08-01).** Review of this task found that a hand-registered
> `collectAssetPaths()` fails silently when a later task forgets to extend it: `it.each` still passes
> while covering one path out of sixty-one. The human approved replacing registration with discovery.
> As shipped in `c61bc12`: `collectAssetPaths()` does not exist, the barrel holds only typed exports,
> and the test walks every JSON file in `src/content/` itself. The barrel must never import `node:fs`
> or use `import.meta.glob`, because components import it and it is bundled for the browser.
> The same review also found `as SiteContent` accepts a `site.json` missing a required field, where an
> annotation does not. Every content export uses `const x: T = raw`, never `as`.
> The code blocks below are the original text, kept for the record.

`src/content/index.ts`:

```ts
import siteRaw from './site.json';
import type { SiteContent } from './types';

export const site = siteRaw as SiteContent;

export function collectAssetPaths(): string[] {
  return [site.seo.ogImage];
}

export * from './types';
```

- [ ] **Step 5: Write the failing guardrail test**

`src/content/__tests__/assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { collectAssetPaths } from '../index';

const PUBLIC_DIR = join(process.cwd(), 'public');

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), posix.join(prefix, entry.name))
      : [posix.join('/', prefix, entry.name)],
  );
}

// Built from readdir, not existsSync: macOS is case-insensitive and Vercel is not.
const onDisk = new Set(listFiles(PUBLIC_DIR));

describe('content assets', () => {
  const paths = collectAssetPaths();

  it('references at least one asset', () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it.each(paths)('%s exists in public/ with exact case', (path) => {
    expect(onDisk.has(decodeURIComponent(path))).toBe(true);
  });

  it.each(paths)('%s does not use the /public/ prefix', (path) => {
    expect(path.startsWith('/public/')).toBe(false);
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run src/content`
Expected: PASS. `/atmosphere/dining.jpg` exists and has no `/public/` prefix. If it fails, the path in `site.json` is wrong, not the test.

- [ ] **Step 7: Prove the guardrail actually catches the bug**

Temporarily change `ogImage` in `site.json` to `/public/atmosphere/dining.jpg` and run `npx vitest run src/content`.
Expected: FAIL on both the existence and the prefix assertion.

Then change it to `/atmosphere/Dining.jpg` and re-run.
Expected: FAIL on existence, proving case sensitivity is enforced despite macOS.

Revert to `/atmosphere/dining.jpg` and confirm PASS.

- [ ] **Step 8: Commit**

```bash
git add src/content tsconfig.app.json
git commit -m "feat(content): add typed content layer with asset path guardrail"
```

---

### Task 3: Site data drives the footer and the document head

Three sources currently disagree about opening hours, and Google reads the one in `index.html`. After this task there is one source.

**Files:**
- Modify: `src/components/Footer.tsx`, `index.html`
- Create: `src/components/SeoHead.tsx`
- Test: `src/components/__tests__/Footer.test.tsx`

**Interfaces:**
- Consumes: `site` from `src/content`.
- Produces: `<SeoHead />`, a component rendering JSON-LD from `site`, mounted once in `App.tsx`.

- [ ] **Step 1: Write the failing test**

`src/components/__tests__/Footer.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Footer from '../Footer';
import { site } from '../../content';

describe('Footer', () => {
  it('shows the current copyright year from content', () => {
    render(<Footer />);
    expect(screen.getByText(new RegExp(`© ${site.copyrightYear}`))).toBeInTheDocument();
  });

  it('never shows a closing time in the morning', () => {
    render(<Footer />);
    site.hours.forEach((h) => {
      expect(h.value).not.toMatch(/–\s*\d{1,2}:\d{2}\s*AM/);
    });
  });

  it('renders every phone number from content', () => {
    render(<Footer />);
    site.phones.forEach((phone) => {
      expect(screen.getByText(phone)).toBeInTheDocument();
    });
  });

  it('renders the LinkedIn link only when content provides one', () => {
    render(<Footer />);
    const link = screen.queryByLabelText(/LinkedIn/i);
    if (site.socials.linkedin === null) {
      expect(link).toBeNull();
    } else {
      expect(link).toHaveAttribute('href', site.socials.linkedin);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/components/__tests__/Footer.test.tsx`
Expected: FAIL. Footer hardcodes `© 2024` and `11:30 AM`.

- [ ] **Step 3: Rewrite Footer to read from content**

Replace the hardcoded address block, phone list, hours grid and copyright line in `src/components/Footer.tsx` with values from `site`. Keep every existing Tailwind class exactly as it is. The hours grid maps over `site.hours`:

```tsx
<div className="grid grid-cols-2 gap-4 font-['Open_Sans'] text-sm">
  {site.hours.map((h) => (
    <div key={h.label}>
      <p className="mb-1 text-gray-400">{h.label}</p>
      <p className="text-white">{h.value}</p>
    </div>
  ))}
</div>
```

Guard the LinkedIn anchor with `{site.socials.linkedin && ( ... )}` so it disappears if the founder confirms the page does not exist.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/__tests__/Footer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Move structured data out of index.html**

`src/components/SeoHead.tsx`:

```tsx
import { site } from '../content';

const SeoHead: React.FC = () => {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: `${site.name} ${site.tagline}`,
    description: site.seo.description,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address.street,
      addressLocality: site.address.locality,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    },
    telephone: site.phones[0],
    servesCuisine: 'Italian',
    priceRange: '$$',
    openingHours: site.structuredDataHours,
    chef: { '@type': 'Person', name: 'Kamalika Anand' },
  };
  return <script type="application/ld+json">{JSON.stringify(json)}</script>;
};

export default SeoHead;
```

Delete the `<script type="application/ld+json">` block from `index.html` (lines 28-53) and update the `<meta name="description">` and `<title>` to match `site.seo`. Mount `<SeoHead />` inside `HomePage` in `src/App.tsx`.

- [ ] **Step 6: Verify the hours agree**

Run: `npm run build && npx vitest run`
Expected: PASS. Then grep to confirm only one source remains:

```bash
grep -rn "11:30\|12:00" index.html src/ --include="*.tsx" --include="*.html"
```

Expected: no matches outside `src/content/site.json`.

- [ ] **Step 7: Commit**

```bash
git add src/components/Footer.tsx src/components/SeoHead.tsx src/App.tsx index.html src/components/__tests__
git commit -m "feat(content): drive footer and structured data from site.json"
```

---

### Task 4: Atmosphere gallery reads from content

Eight image paths, all currently prefixed `/public/`, all currently 404ing in production, all with alt text reading "Place 1" through "Place 8".

**Files:**
- Create: `src/content/galleries.json`
- Modify: `src/content/index.ts`, `src/components/PlaceGallery.tsx`
- Test: `src/components/__tests__/PlaceGallery.test.tsx`

**Interfaces:**
- Consumes: `Galleries` type from Task 2.
- Produces: `galleries` export from `src/content`, with `atmosphere`, `ourStory` and `heroCollage` arrays. Tasks 8 and 9 consume `ourStory` and `heroCollage`.

- [ ] **Step 1: Write galleries.json**

Alt text describes what is in each photo rather than its index. `ourStory` and `heroCollage` are populated here so Tasks 8 and 9 have them ready.

```json
{
  "atmosphere": [
    { "src": "/atmosphere/dining.jpg", "alt": "The dining room laid for service" },
    { "src": "/atmosphere/outsideLOGO.jpg", "alt": "Via Bianca's signage on N-Block Market" },
    { "src": "/atmosphere/ambience.JPG", "alt": "Warm evening light across the restaurant" },
    { "src": "/atmosphere/ceiling decor.png", "alt": "Hand-painted ceiling detail" },
    { "src": "/atmosphere/front mirror.png", "alt": "The antique mirror by the entrance" },
    { "src": "/atmosphere/painting board.JPG", "alt": "Painted board on the dining room wall" },
    { "src": "/atmosphere/room.png", "alt": "The main room seen from the doorway" },
    { "src": "/atmosphere/table.png", "alt": "A set table with linen and glassware" }
  ],
  "ourStory": [
    { "src": "/our_story/cut.JPG", "alt": "Cutting fresh pasta by hand" },
    { "src": "/our_story/dinner.JPG", "alt": "A finished plate at the pass" },
    { "src": "/our_story/handmaking.jpg", "alt": "Working dough by hand" },
    { "src": "/our_story/oven.JPG", "alt": "The wood-fired oven at full heat" },
    { "src": "/our_story/shape.JPG", "alt": "Shaping pasta in the pastificio" },
    { "src": "/our_story/stuff.JPG", "alt": "Filling fresh pasta" }
  ],
  "heroCollage": [
    { "src": "/hero/scene.png", "className": "col-start-5 col-span-2 row-span-2" },
    { "src": "/hero/farfalle1.png", "className": "col-start-5 col-span-2 row-start-5 row-span-2" },
    { "src": "/hero/farfalle2.png", "className": "col-span-2 row-span-2" },
    { "src": "/hero/farfalle3.png", "className": "col-span-2 row-start-5 row-span-2" },
    { "src": "/hero/farfalle4.png", "className": "col-start-3 col-span-2 row-span-1" },
    { "src": "/atmosphere/dining.jpg", "className": "col-start-3 col-span-2 row-start-6 row-span-1" },
    { "src": "/atmosphere/ambience.JPG", "className": "col-span-1 row-start-3 row-span-2" },
    { "src": "/hero/bus.jpeg", "className": "col-start-6 col-span-1 row-start-3 row-span-2" },
    { "src": "/atmosphere/ceiling decor.png", "className": "col-start-3 col-span-1 row-start-2" },
    { "src": "/our_story/oven.JPG", "className": "col-start-4 col-span-1 row-start-2" },
    { "src": "/atmosphere/front mirror.png", "className": "col-start-2 col-span-1 row-start-3" },
    { "src": "/hero/building.png", "className": "col-start-5 col-span-1 row-start-3" },
    { "src": "/our_story/stuff.JPG", "className": "col-start-2 col-span-1 row-start-4" },
    { "src": "/atmosphere/room.png", "className": "col-start-5 col-span-1 row-start-4" },
    { "src": "/our_story/cut.JPG", "className": "col-start-3 col-span-1 row-start-5" },
    { "src": "/hero/farfalle.png", "className": "col-start-4 col-span-1 row-start-5" }
  ]
}
```

Two deliberate changes to `heroCollage`: the two entries that had `src: ''` now use `farfalle2.png` and `farfalle3.png`, two of the five orphaned files already sitting unused in `public/hero/`; and the duplicate `col-start-3 row-start-2` placement is resolved by giving `bus.jpeg` the `col-start-6 row-start-3` slot and leaving `ceiling decor.png` alone in `col-start-3`.

- [ ] **Step 2: Extend the barrel**

In `src/content/index.ts`:

```ts
import galleriesRaw from './galleries.json';
import type { Galleries } from './types';

export const galleries: Galleries = galleriesRaw;
```

The test in `src/content/__tests__/assets.test.ts` discovers asset paths by walking every JSON
file in `src/content/`, so there is nothing to register. Adding the file above is all that is
required for its paths to be checked. Use a type annotation, never `as`: an annotation catches a
missing required field, a cast does not.


- [ ] **Step 3: Run the guardrail**

Run: `npx vitest run src/content`
Expected: PASS for all 30 paths. Any failure here is a real broken path, most likely a case mismatch on a `.JPG` extension. Fix the JSON, not the test.

- [ ] **Step 4: Write the failing component test**

`src/components/__tests__/PlaceGallery.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlaceGallery from '../PlaceGallery';
import { galleries } from '../../content';

describe('PlaceGallery', () => {
  it('renders one image per atmosphere entry', () => {
    render(<PlaceGallery />);
    expect(screen.getAllByRole('img')).toHaveLength(galleries.atmosphere.length);
  });

  it('uses descriptive alt text, not positional labels', () => {
    render(<PlaceGallery />);
    screen.getAllByRole('img').forEach((img) => {
      expect(img.getAttribute('alt')).not.toMatch(/^Place \d+$/);
    });
  });

  it('never emits a /public/ src', () => {
    render(<PlaceGallery />);
    screen.getAllByRole('img').forEach((img) => {
      expect(img.getAttribute('src')).not.toContain('/public/');
    });
  });
});
```

- [ ] **Step 5: Run it**

Run: `npx vitest run src/components/__tests__/PlaceGallery.test.tsx`
Expected: FAIL on alt text and on `/public/`.

- [ ] **Step 6: Rewrite PlaceGallery**

Replace the local `places` array with `galleries.atmosphere`, and map over it using `image.src` and `image.alt`. Delete the `<style>` block at the bottom; `.scrollbar-hide` already exists in `index.css`. Every Tailwind class on the wrapper and card divs stays byte-identical.

- [ ] **Step 7: Run the test**

Run: `npx vitest run src/components/__tests__/PlaceGallery.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/content src/components/PlaceGallery.tsx src/components/__tests__/PlaceGallery.test.tsx
git commit -m "feat(content): drive atmosphere gallery from galleries.json"
```

---

### Task 5: Real dish names replace filename derivation

`FoodGallery.tsx` currently derives display names from filenames, so the live homepage labels dishes "Pizza1", "Pizza2", "Idk1", "Idk2", "PistaAffo" and "Margarita". That function gets deleted.

Identifying the photos is genuine work, not a lookup. Do it by opening each image and matching it against the new menu.

**Files:**
- Create: `src/content/dishes.json`
- Modify: `src/content/index.ts`, `src/components/FoodGallery.tsx`
- Test: `src/components/__tests__/FoodGallery.test.tsx`

**Interfaces:**
- Consumes: `Dish` type from Task 2.
- Produces: `dishes` export from `src/content`.

- [ ] **Step 1: Identify every photo**

Read each of the 15 files in `public/food/` and match against the new menu at `New Menu/Via Bianca Food Menu/Printable Files/Via Bianca Menu - With Prices Expanded.pdf` (12 pages). Descriptions come from the menu where the dish appears there.

Known so far: `idk1.JPG` is a pistachio-crusted prawn served with rocket and confit tomato.

Record uncertain identifications in a list to send to the founder. Do not guess a name onto the site; if a dish cannot be identified, use the section it belongs to as the name and flag it.

- [ ] **Step 2: Write dishes.json**

Shape, using the one confirmed identification as the pattern. Fill the remaining 14 from Step 1.

```json
[
  {
    "id": "gamberi-pistacchio",
    "name": "Gamberi al Pistacchio",
    "description": "Pistachio-crusted prawn with rocket and confit tomato",
    "image": "/food/idk1.JPG",
    "tags": ["seafood", "nuts"]
  }
]
```

Keep the existing `image` filenames. Renaming files is a separate concern handled in A2 when the image pipeline rewrites them.

- [ ] **Step 3: Extend the barrel**

```ts
import dishesRaw from './dishes.json';
import type { Dish } from './types';

export const dishes: Dish[] = dishesRaw;
```

The test in `src/content/__tests__/assets.test.ts` discovers asset paths by walking every JSON
file in `src/content/`, so there is nothing to register. Adding the file above is all that is
required for its paths to be checked. Use a type annotation, never `as`: an annotation catches a
missing required field, a cast does not.


- [ ] **Step 4: Run the guardrail**

Run: `npx vitest run src/content`
Expected: FAIL on `/food/aglio e pepperoncini.jpg` if that path was copied across verbatim. The file on disk is `Aglio e Pepperoncini.jpg`. Correct the JSON.

Re-run. Expected: PASS.

- [ ] **Step 5: Write the failing component test**

`src/components/__tests__/FoodGallery.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FoodGallery from '../FoodGallery';
import { dishes } from '../../content';

describe('FoodGallery', () => {
  it('renders one card per dish', () => {
    render(<FoodGallery />);
    expect(screen.getAllByRole('img')).toHaveLength(dishes.length);
  });

  it('shows no filename-derived names', () => {
    render(<FoodGallery />);
    dishes.forEach((dish) => {
      expect(dish.name).not.toMatch(/^(Idk|Pizza)\d+$/);
      expect(dish.name).not.toMatch(/\.(jpg|JPG|png)$/i);
      expect(screen.getByText(dish.name)).toBeInTheDocument();
    });
  });

  it('gives every dish a non-empty description', () => {
    dishes.forEach((dish) => {
      expect(dish.description.trim().length).toBeGreaterThan(0);
    });
  });

  it('uses the dish name as alt text', () => {
    render(<FoodGallery />);
    dishes.forEach((dish) => {
      expect(screen.getByAltText(dish.name)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run src/components/__tests__/FoodGallery.test.tsx`
Expected: FAIL, because `FoodGallery` still builds its own array.

- [ ] **Step 7: Rewrite FoodGallery**

Delete `dishFiles` and the `dishes` mapping block entirely, including the `.replace(/\.[^/.]+$/, "")` title derivation. Import `dishes` from `../content` and map over it. Add the description under the name inside the existing caption div:

```tsx
<div className="absolute bottom-4 left-4 right-4 text-white">
  <h3 className="font-['Montserrat'] font-semibold text-xl">{dish.name}</h3>
  <p className="font-['Open_Sans'] text-sm text-white/80">{dish.description}</p>
</div>
```

Delete the trailing `<style>` block.

- [ ] **Step 8: Run the test**

Run: `npx vitest run src/components/__tests__/FoodGallery.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/content src/components/FoodGallery.tsx src/components/__tests__/FoodGallery.test.tsx
git commit -m "feat(content): real dish names and descriptions from dishes.json"
```

---

### Task 6: One removable Drinks section

The site sells itself on zero-proof drinks while the new menu is a full bar. The founder wants a single section that can be pulled cleanly if licensing or positioning changes, which means one component and one line in `App.tsx`, with no other file referencing it.

`SignatureMocktails.tsx` stays on disk untouched per the global constraints. `Drinks.tsx` replaces it in the render tree.

**Files:**
- Create: `src/content/drinks.json`, `src/components/Drinks.tsx`
- Modify: `src/content/index.ts`, `src/App.tsx`
- Test: `src/components/__tests__/Drinks.test.tsx`

**Interfaces:**
- Consumes: `Drink` type from Task 2.
- Produces: `drinks` export from `src/content`; `<Drinks />` default export.

- [ ] **Step 1: Write drinks.json**

Mocktails come from the existing five in `SignatureMocktails.tsx`, which are real. Cocktails and wine come from the new drinks menu (12 pages). Wine entries have no photography, so `image` is `null`.

```json
[
  {
    "id": "bicerin",
    "name": "Bicerin",
    "description": "Espresso, chocolate and cream",
    "category": "mocktail",
    "image": "/mocktails/bicerin.jpg"
  },
  {
    "id": "bellini",
    "name": "Bellini",
    "description": "A classic spritz with peach and prosecco",
    "category": "cocktail",
    "image": null
  },
  {
    "id": "brunello-uggiano",
    "name": "Uggiano, Brunello di Montalcino DOCG",
    "description": "Italy",
    "category": "wine",
    "image": null
  }
]
```

Fill in the remaining four mocktails and the full cocktail and wine lists from the menu.

- [ ] **Step 2: Extend the barrel**

```ts
import drinksRaw from './drinks.json';
import type { Drink } from './types';

export const drinks: Drink[] = drinksRaw;
```

The test in `src/content/__tests__/assets.test.ts` discovers asset paths by walking every JSON
file in `src/content/`, so there is nothing to register. Adding the file above is all that is
required for its paths to be checked. Use a type annotation, never `as`: an annotation catches a
missing required field, a cast does not.

The walk tolerates `null`, which is what `Drink.image` carries for wine entries, and Task 2 added a
regression test pinning that. No filtering is needed here.


- [ ] **Step 3: Write the failing test**

`src/components/__tests__/Drinks.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Drinks from '../Drinks';
import { drinks } from '../../content';

describe('Drinks', () => {
  it('renders every drink name', () => {
    render(<Drinks />);
    drinks.forEach((drink) => {
      expect(screen.getByText(drink.name)).toBeInTheDocument();
    });
  });

  it('groups drinks into the three categories', () => {
    render(<Drinks />);
    ['Mocktails', 'Cocktails', 'Wine'].forEach((heading) => {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    });
  });

  it('describes only drinks that exist', () => {
    render(<Drinks />);
    ['basil-lime spritz', 'rosemary-grapefruit fizz', 'espresso-orange tonic'].forEach((ghost) => {
      expect(screen.queryByText(new RegExp(ghost, 'i'))).toBeNull();
    });
  });
});
```

The third test pins the specific bug being fixed: the current intro paragraph describes three drinks that appear nowhere on the menu.

- [ ] **Step 4: Run it**

Run: `npx vitest run src/components/__tests__/Drinks.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 5: Build Drinks.tsx**

Copy the section shell from `SignatureMocktails.tsx` so the visual language is unchanged: `py-20 bg-[#FFFDF8] relative overflow-hidden`, the same card treatment, the same heading type scale. Three subsections keyed on `category`, each with an `<h3>` reading Mocktails, Cocktails or Wine. Drinks with an image keep the photo card; drinks without render as a name-and-description list item.

Write a new intro paragraph that describes the actual programme. Do not carry across the existing one.

Section id stays `id="drinks"`.

- [ ] **Step 6: Run the test**

Run: `npx vitest run src/components/__tests__/Drinks.test.tsx`
Expected: PASS.

- [ ] **Step 7: Swap it into the render tree**

In `src/App.tsx`, replace `<SignatureMocktails />` with `<Drinks />` and update the import. `SignatureMocktails.tsx` stays on disk.

Verify removability:

```bash
grep -rn "Drinks" src/ --include="*.tsx" | grep -v "__tests__" | grep -v "components/Drinks.tsx"
```

Expected: exactly two lines in `App.tsx`, the import and the element.

- [ ] **Step 8: Commit**

```bash
git add src/content src/components/Drinks.tsx src/App.tsx src/components/__tests__/Drinks.test.tsx
git commit -m "feat(content): merged removable drinks section covering the full bar"
```

---

### Task 7: Press articles from one source

The same article data currently lives in `BlogTeaser.tsx`, `NewsPress.tsx` and `BlogsPage.tsx` in three slightly different shapes. Ten of the thirteen entries have `url: "#"`, which with `target="_blank"` opens a second copy of the current page in a new tab. Two point at `food/aglio.jpg` and `food/assassina.jpg`, neither of which exists.

**Files:**
- Create: `src/content/press.json`
- Modify: `src/content/index.ts`, `src/components/BlogTeaser.tsx`, `src/components/BlogsPage.tsx`, `src/components/NewsPress.tsx`
- Test: `src/components/__tests__/press.test.tsx`

**Interfaces:**
- Consumes: `Article` type from Task 2.
- Produces: `press` export from `src/content`, ordered newest first at source so no component sorts at render time.

- [ ] **Step 1: Write press.json**

All thirteen articles, sorted newest first. Real URLs required for every entry; the founder is supplying the ten that are missing. Card images: the three linked entries already have publication logos in `public/press/`. The other ten need either a logo added to `public/press/` or an existing food photo as fallback.

```json
[
  {
    "id": "bw-hotelier-regional-flair",
    "title": "Via Bianca Brings Regional Italian Flair to Delhi's Dining Scene",
    "publication": "BW Hotelier",
    "date": "2024-12-15",
    "excerpt": "Chef Kamalika Anand's latest venture showcases authentic Puglian cuisine with handcrafted pastas and zero-proof cocktails.",
    "url": "https://www.bwhotelier.com/article/via-bianca-brings-regional-italian-flair-to-delhis-dining-scene-558510",
    "image": "/press/hotelier.png"
  }
]
```

If a URL has not arrived by the time this task runs, leave that entry out of `press.json` rather than shipping a `#` link, and note it in the handoff. An article with no link is not publishable.

- [ ] **Step 2: Extend the barrel**

```ts
import pressRaw from './press.json';
import type { Article } from './types';

export const press: Article[] = pressRaw;
```

The test in `src/content/__tests__/assets.test.ts` discovers asset paths by walking every JSON
file in `src/content/`, so there is nothing to register. Adding the file above is all that is
required for its paths to be checked. Use a type annotation, never `as`: an annotation catches a
missing required field, a cast does not.


- [ ] **Step 3: Write the failing test**

`src/components/__tests__/press.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { press } from '../../content';

describe('press content', () => {
  it('gives every article a real destination', () => {
    press.forEach((article) => {
      expect(article.url).not.toBe('#');
      expect(article.url).toMatch(/^https?:\/\//);
    });
  });

  it('is sorted newest first at source', () => {
    const dates = press.map((a) => new Date(a.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('has unique ids', () => {
    expect(new Set(press.map((a) => a.id)).size).toBe(press.length);
  });
});
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/components/__tests__/press.test.tsx`
Expected: PASS once `press.json` holds only linked articles. If it fails on the URL assertion, a `#` entry was carried across.

- [ ] **Step 5: Point all three components at it**

- `BlogTeaser.tsx`: delete the local `articles` array, import `press`, render `press.slice(0, 3)`.
- `NewsPress.tsx`: same, `press.slice(0, 3)`. This file is not rendered but must not hold stale data.
- `BlogsPage.tsx`: delete the local `allArticles` array and the in-render `.sort()` on line 111, which mutates a module-scope array during render. Import `press` and paginate it directly.

- [ ] **Step 6: Verify no duplication remains**

```bash
grep -rn "bwhotelier\|delhiroyale\|restaurantindia" src/ --include="*.tsx"
```

Expected: no matches. All three URLs now live only in `press.json`.

- [ ] **Step 7: Run the suite**

Run: `npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/content src/components/BlogTeaser.tsx src/components/BlogsPage.tsx src/components/NewsPress.tsx src/components/__tests__/press.test.tsx
git commit -m "feat(content): single source for press articles, real URLs only"
```

---

### Task 8: Our Story and the menu downloads

The three Our Story paragraphs are placeholder text ending in literal ellipses. The chef's own copy exists on page 2 of the new food menu and is better than anything that would be written to replace it. The menu download link is also broken, pointing at `/public/Menu%20-%20Expanded.pdf`.

**Files:**
- Create: `src/content/story.json`, `src/content/menus.json`
- Modify: `src/content/index.ts`, `src/components/OurStory.tsx`, `src/components/Drinks.tsx`
- Test: `src/components/__tests__/OurStory.test.tsx`

**Interfaces:**
- Consumes: `StoryContent`, `MenuFile`, `Galleries` types.
- Produces: `story` and `menus` exports from `src/content`.

- [ ] **Step 1: Compress the PDFs into public/menus/**

The source PDFs are 39MB and 54MB. Do not copy them in raw. Whatever lands in `public/menus/` is committed, and git history is permanent, so compressing afterwards in A2 would leave the 93MB originals in the pack forever. Compress first, commit once.

Ghostscript 10.04 is installed at `/usr/local/bin/gs`. Note that `gs` is aliased to `git status` in this shell, so call the absolute path.

```bash
mkdir -p public/menus
/usr/local/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.5 -dPDFSETTINGS=/ebook \
  -dNOPAUSE -dQUIET -dBATCH -sOutputFile=public/menus/food-menu.pdf \
  "New Menu/Via Bianca Food Menu/Printable Files/Via Bianca Menu - With Prices Expanded.pdf"
/usr/local/bin/gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.5 -dPDFSETTINGS=/ebook \
  -dNOPAUSE -dQUIET -dBATCH -sOutputFile=public/menus/drinks-menu.pdf \
  "New Menu/Via Bianca Drinks Menu/Printable Files/Drink Menu (with pricing).pdf"
```

Expected: roughly 12MB and 8.7MB, a 77% reduction. Verified visually lossless at this setting; the tile border and dietary-tag colours survive intact.

`/screen` and `/printer` both produce the same 12MB, so DPI downsampling is not the lever here. The floor comes from the decorative border artwork's pixel dimensions. Getting below 12MB needs the border re-exported at web resolution, which is a job for A2, not this task. Confirm the sizes you get and record them.

`New Menu/` is gitignored, so the uncompressed originals stay on the owner's disk and out of git.

The existing `public/Menu - Expanded.pdf` stays where it is. It is already tracked, and removing it would not shrink history.

- [ ] **Step 2: Write menus.json**

```json
[
  { "id": "food", "label": "Food Menu", "file": "/menus/food-menu.pdf" },
  { "id": "drinks", "label": "Drinks Menu", "file": "/menus/drinks-menu.pdf" }
]
```

- [ ] **Step 3: Write story.json**

Transcribe the four paragraphs from page 2 of the food menu verbatim, ending with the sign-off. No ellipses, no truncation.

```json
{
  "heading": "Our Story",
  "paragraphs": [
    "Welcome to Via Bianca, a love letter to Italy. The interiors that are inspired by Puglia, its whitewashed streets, sunlit kitchens, and soulful food, we bring you more than a menu; we bring you a moment. One that's heartfelt, full of flavour, and kneaded with love."
  ]
}
```

- [ ] **Step 4: Extend the barrel**

```ts
import storyRaw from './story.json';
import menusRaw from './menus.json';
import type { StoryContent, MenuFile } from './types';

export const story: StoryContent = storyRaw;
export const menus: MenuFile[] = menusRaw;
```

The test in `src/content/__tests__/assets.test.ts` discovers asset paths by walking every JSON
file in `src/content/`, so there is nothing to register. Adding the file above is all that is
required for its paths to be checked. Use a type annotation, never `as`: an annotation catches a
missing required field, a cast does not.


- [ ] **Step 5: Write the failing test**

`src/components/__tests__/OurStory.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OurStory from '../OurStory';
import { story, galleries } from '../../content';

describe('OurStory', () => {
  it('has no truncated placeholder paragraphs', () => {
    story.paragraphs.forEach((p) => {
      expect(p.trim().endsWith('...')).toBe(false);
      expect(p.trim().endsWith('…')).toBe(false);
    });
  });

  it('renders every paragraph', () => {
    render(<OurStory />);
    story.paragraphs.forEach((p) => {
      expect(screen.getByText(p)).toBeInTheDocument();
    });
  });

  it('carousel images come from content, not a filename list', () => {
    render(<OurStory />);
    expect(screen.getAllByRole('img')).toHaveLength(galleries.ourStory.length);
    screen.getAllByRole('img').forEach((img) => {
      expect(img.getAttribute('alt')).not.toMatch(/^Slide \d+$/);
    });
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run src/components/__tests__/OurStory.test.tsx`
Expected: FAIL on all three.

- [ ] **Step 7: Rewrite OurStory**

Delete the `imageFiles` array and the `/public/our_story/` mapping on lines 3-12. Read paragraphs from `story.paragraphs` and images from `galleries.ourStory`, using each image's `alt`. Keep the carousel markup and every Tailwind class unchanged.

- [ ] **Step 8: Fix the menu download**

In `Drinks.tsx`, replace the single hardcoded `/public/Menu%20-%20Expanded.pdf` anchor with one button per entry in `menus`, using `href={menu.file}` and the existing button classes.

- [ ] **Step 9: Run the suite**

Run: `npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/content public/menus src/components/OurStory.tsx src/components/Drinks.tsx src/components/__tests__/OurStory.test.tsx
git commit -m "feat(content): real story copy and working menu downloads"
```

---

### Task 9: Hero collage repair

Two entries have `src=""`, which makes the browser refetch the page HTML as an image. Two more occupy the same grid cell, so one is invisible. Nine use the `/public/` prefix. `galleries.heroCollage` from Task 4 already encodes the fixes.

**Files:**
- Modify: `src/components/Hero.tsx`
- Test: `src/components/__tests__/Hero.test.tsx`

**Interfaces:**
- Consumes: `galleries.heroCollage`, `site` from `src/content`.

- [ ] **Step 1: Write the failing test**

`src/components/__tests__/Hero.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Hero from '../Hero';
import { galleries } from '../../content';

describe('Hero', () => {
  it('never renders an image with an empty src', () => {
    const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
    const images = Array.from(container.querySelectorAll('img'));
    expect(images.length).toBeGreaterThan(0);
    images.forEach((img) => {
      expect(img.getAttribute('src')).toBeTruthy();
    });
  });

  it('places every collage image in a distinct grid cell', () => {
    const cells = galleries.heroCollage.map((i) => {
      const col = i.className.match(/col-start-\d+/)?.[0] ?? 'col-auto';
      const row = i.className.match(/row-start-\d+/)?.[0] ?? 'row-auto';
      return `${col}:${row}`;
    });
    expect(new Set(cells).size).toBe(cells.length);
  });
});
```

The second test is the one that matters. It asserts the property rather than the fix, so a future edit that reintroduces an overlap fails here.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/components/__tests__/Hero.test.tsx`
Expected: FAIL on the grid cell assertion if `galleries.heroCollage` still contains a duplicate placement.

- [ ] **Step 3: Rewrite the collage**

Replace the inline array on lines 20-40 with `galleries.heroCollage.map(...)`. Keep the wrapper `grid grid-cols-6 grid-rows-6 gap-1` and the per-image classes unchanged. Every collage image is decorative, so `alt=""` stays.

Replace the hardcoded phone numbers with `site.phones` and the WhatsApp URL with values from `site.whatsapp`:

```tsx
onClick={() =>
  window.open(
    `https://wa.me/${site.whatsapp.number}?text=${encodeURIComponent(site.whatsapp.prefilledMessage)}`,
    '_blank',
    'noopener',
  )
}
```

Note the added `'noopener'`, which the current `window.open` call omits.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/__tests__/Hero.test.tsx`
Expected: PASS.

- [ ] **Step 5: Confirm no /public/ references survive anywhere**

```bash
grep -rn "/public/" src/ index.html
```

Expected: no matches. This is the single check that the site's images work again.

- [ ] **Step 6: Commit**

```bash
git add src/components/Hero.tsx src/components/__tests__/Hero.test.tsx
git commit -m "fix(hero): repair collage paths, empty sources and overlapping cells"
```

---

### Task 10: Strip the dead backend

The Supabase project no longer exists, so `/admin` and `/reservation` render network errors to anyone who finds them. `/admin` also has no authentication, which matters again the moment a backend comes back. `lovable-tagger` announces where the site came from.

Per the global constraints, the three reservation component files stay on disk.

**Files:**
- Modify: `src/App.tsx`, `package.json`, `vite.config.ts`
- Delete: `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`
- Test: `src/test/no-dead-backend.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Removal only.

- [ ] **Step 1: Write the failing test**

`src/test/no-dead-backend.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('dead backend', () => {
  it('has no supabase client', () => {
    expect(existsSync('src/integrations/supabase/client.ts')).toBe(false);
  });

  it('has no supabase dependency', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies['@supabase/supabase-js']).toBeUndefined();
  });

  it('has no lovable-tagger', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies['lovable-tagger']).toBeUndefined();
    expect(readFileSync('vite.config.ts', 'utf8')).not.toContain('lovable-tagger');
  });

  it('does not route to the unauthenticated admin page', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).not.toContain('path="/admin"');
    expect(app).not.toContain('path="/reservation"');
  });

  it('keeps the reservation components on disk for later revival', () => {
    expect(existsSync('src/components/AdminReservations.tsx')).toBe(true);
    expect(existsSync('src/components/ReservationForm.tsx')).toBe(true);
    expect(existsSync('src/components/ReservationPage.tsx')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/test/no-dead-backend.test.ts`
Expected: FAIL on the first four, PASS on the fifth.

- [ ] **Step 3: Remove the routes and the client**

In `src/App.tsx`, delete the `/admin` and `/reservation` `<Route>` elements and their imports. Delete `src/integrations/`.

- [ ] **Step 4: Park the reservation components out of the type-check**

The three parked files import the deleted client, so `tsc -b` will fail. A stub assignment does not type-check cleanly under `strict` (`null as never` is rejected as a possible mistake), and nothing imports these files after Step 3, so exclude them instead.

In `tsconfig.app.json`:

```json
{
  "include": ["src"],
  "exclude": [
    "src/components/AdminReservations.tsx",
    "src/components/ReservationForm.tsx",
    "src/components/ReservationPage.tsx"
  ]
}
```

Add a comment at the top of each of the three files:

```tsx
// Parked 2026-07-31. The Supabase project was retired, so this page is
// unrouted and excluded from tsconfig.app.json. To revive: restore a
// client at src/integrations/supabase/client.ts, add auth to the admin
// page, remove this file from the tsconfig exclude list, and re-register
// the route in App.tsx.
```

Note: `ReservationPage.tsx` navigates with `window.location.href = '/'` rather than `navigate('/')`. That is a real defect but it is unreachable while the route is unregistered, so it is left for whoever revives the page and called out in the comment above.

- [ ] **Step 5: Remove the dependencies**

```bash
npm uninstall @supabase/supabase-js lovable-tagger
```

In `vite.config.ts`, delete the `componentTagger` import and the `mode === 'development' && componentTagger()` plugin entry. The `.filter(Boolean)` can stay or go; keeping it is harmless.

- [ ] **Step 6: Run the test and the build**

Run: `npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove retired supabase backend and lovable-tagger"
```

---

### Task 11: 404 route and error boundary

Any unmatched path currently renders an empty page. Any render error blanks the whole site with no message.

**Files:**
- Create: `src/components/NotFound.tsx`, `src/components/ErrorBoundary.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`
- Test: `src/components/__tests__/NotFound.test.tsx`

**Interfaces:**
- Consumes: `site` from `src/content`.
- Produces: `<NotFound />` and `<ErrorBoundary>` default exports.

- [ ] **Step 1: Write the failing test**

`src/components/__tests__/NotFound.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../App';

describe('unmatched routes', () => {
  it('renders a 404 with a way home', () => {
    render(
      <MemoryRouter initialEntries={['/not-a-real-page']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /not found/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home/i })).toBeInTheDocument();
  });
});
```

The test cannot render `App` directly, because `App` supplies its own `BrowserRouter` and routers do not nest. Split it in `src/App.tsx`: export a named `AppRoutes` holding the `<Routes>` block, and keep the default `App` export as `<Router><AppRoutes /></Router>`. The test then supplies `MemoryRouter`.

```tsx
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/blogs" element={<BlogsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  );
}
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/components/__tests__/NotFound.test.tsx`
Expected: FAIL, no heading found.

- [ ] **Step 3: Build NotFound**

Match the existing visual language: `min-h-screen`, Parisienne wordmark, sage accent, Montserrat body.

```tsx
import { Link } from 'react-router-dom';
import { site } from '../content';

const NotFound: React.FC = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-[#F9F9F9] px-6 text-center">
    <h1 className="font-['Parisienne'] text-5xl text-[#222] mb-2">{site.name}</h1>
    <h2 className="font-['Montserrat'] text-lg uppercase tracking-wide text-[#6B8B59] mb-6">
      Page not found
    </h2>
    <Link
      to="/"
      className="bg-[#6B8B59] hover:bg-[#5a7349] text-white px-8 py-4 rounded-lg font-['Montserrat'] font-semibold uppercase tracking-wide transition-colors duration-300"
    >
      Back to home
    </Link>
  </div>
);

export default NotFound;
```

Add `<Route path="*" element={<NotFound />} />` as the last route.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/__tests__/NotFound.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the error boundary**

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean }

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F9F9F9] px-6 text-center">
        <h1 className="font-['Parisienne'] text-5xl text-[#222] mb-2">Via Bianca</h1>
        <p className="font-['Open_Sans'] text-gray-700 mb-6">
          Something went wrong loading this page.
        </p>
        <a
          href="/"
          className="bg-[#6B8B59] hover:bg-[#5a7349] text-white px-8 py-4 rounded-lg font-['Montserrat'] font-semibold uppercase tracking-wide"
        >
          Reload
        </a>
      </div>
    );
  }
}

export default ErrorBoundary;
```

Wrap `<App />` in `src/main.tsx` with `<ErrorBoundary>`.

- [ ] **Step 6: Run the suite**

Run: `npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/NotFound.tsx src/components/ErrorBoundary.tsx src/App.tsx src/main.tsx src/components/__tests__/NotFound.test.tsx
git commit -m "feat: add 404 route and top-level error boundary"
```

---

### Task 12: Mobile navigation

`NavBar.tsx` puts a wordmark, five uppercase links and an Instagram icon in one flex row at every breakpoint. At 375px that overflows. This is the most visible defect on the device most visitors use.

**Files:**
- Modify: `src/components/NavBar.tsx`
- Test: `src/components/__tests__/NavBar.test.tsx`

**Interfaces:**
- Consumes: `site` from `src/content`.

- [ ] **Step 1: Write the failing test**

`src/components/__tests__/NavBar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from '../NavBar';

describe('Navbar', () => {
  it('exposes a menu toggle for small screens', () => {
    render(<Navbar />);
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
  });

  it('opens and closes the menu', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const toggle = screen.getByRole('button', { name: /menu/i });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the menu after a link is followed', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    const toggle = screen.getByRole('button', { name: /menu/i });
    await user.click(toggle);
    await user.click(screen.getByRole('link', { name: /our story/i }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
```

Install the interaction library: `npm install -D @testing-library/user-event@^14`

- [ ] **Step 2: Run it**

Run: `npx vitest run src/components/__tests__/NavBar.test.tsx`
Expected: FAIL, no button found.

- [ ] **Step 3: Add the toggle**

Move the link list into a `NAV_LINKS` constant so desktop and mobile render the same source. Hide the inline list below `md` with `hidden md:flex`. Add a `Menu`/`X` toggle from `lucide-react` shown only below `md`, with `aria-expanded` and `aria-label="Menu"`. The open panel is a full-width column below the bar. Clicking any link sets the open state to false.

- [ ] **Step 4: Fix the scroll listener while here**

The effect currently depends on `lastScrollY`, so it removes and re-adds the listener on every scroll frame. Replace the state with a ref and register once:

```tsx
const lastScrollY = useRef(0);

useEffect(() => {
  const handleScroll = () => {
    const y = window.scrollY;
    setShowNavbar(y < 100 || y < lastScrollY.current);
    lastScrollY.current = y;
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  return () => window.removeEventListener('scroll', handleScroll);
}, []);
```

Also force the bar visible whenever the mobile menu is open, so scrolling cannot hide an open menu.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/components/__tests__/NavBar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Check it by eye**

Run `npm run dev`, open at 375px in device emulation. Confirm: nothing overflows horizontally, the toggle is reachable with a thumb, the panel covers the full width, and tapping a link scrolls to the section and closes the panel.

- [ ] **Step 7: Commit**

```bash
git add src/components/NavBar.tsx src/components/__tests__/NavBar.test.tsx package.json package-lock.json
git commit -m "feat(nav): add mobile menu and fix scroll listener churn"
```

---

### Task 13: Motion and carousel fixes

Four carousels hide their scrollbars with no arrows, no edge fade and no keyboard access, so on desktop there is no signal that content continues. Card hover scaling can push the last card past the container edge. The Our Story carousel keeps advancing under `prefers-reduced-motion`. `scroll-behavior: smooth` is applied to `*`.

**Files:**
- Modify: `src/index.css`, `src/components/OurStory.tsx`, `src/components/PlaceGallery.tsx`, `src/components/FoodGallery.tsx`, `src/components/Drinks.tsx`
- Create: `src/hooks/usePrefersReducedMotion.ts`
- Test: `src/hooks/__tests__/usePrefersReducedMotion.test.ts`

**Interfaces:**
- Produces: `usePrefersReducedMotion(): boolean`.

- [ ] **Step 1: Write the failing hook test**

`src/hooks/__tests__/usePrefersReducedMotion.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('usePrefersReducedMotion', () => {
  it('is false when the user has no preference', () => {
    mockMatchMedia(false);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
  });

  it('is true when the user prefers reduced motion', () => {
    mockMatchMedia(true);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/hooks`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the hook**

```ts
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setPrefers(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return prefers;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/hooks`
Expected: PASS.

- [ ] **Step 5: Stop the carousel under reduced motion**

In `OurStory.tsx`, guard the interval:

```tsx
const reduceMotion = usePrefersReducedMotion();

useEffect(() => {
  if (reduceMotion) return;
  const interval = setInterval(() => {
    setCurrentIndex((prev) => (prev + 1) % galleries.ourStory.length);
  }, 3200);
  return () => clearInterval(interval);
}, [reduceMotion]);
```

- [ ] **Step 6: Fix the CSS**

In `src/index.css`:
- Change the `* { scroll-behavior: smooth; }` rule on line 23 to target `html` only.
- Delete the `body::before` block on lines 147-158. It is a fixed, `mix-blend-mode: multiply` full-viewport layer that repaints on every scroll, and `Hero.tsx` already paints the same `brick.jpg`.
- Keep `.scrollbar-hide` and `.animation-delay-*`, which the components will now rely on rather than re-declaring.

- [ ] **Step 7: Remove the duplicated style blocks**

Delete the trailing `<style>{...}` blocks from `PlaceGallery.tsx`, `FoodGallery.tsx` and `Drinks.tsx` if any survived earlier tasks. `ChefGallery.tsx` keeps its own, since it is parked and unrendered.

- [ ] **Step 8: Fix hover overflow and add scroll affordance**

In each carousel, move `hover:scale-105` off the flex child and onto an inner wrapper div, so growth happens inside the card's footprint. Add `px-1 py-2` to the scrolling row so scaled cards are not clipped. Add a right-edge fade to signal more content:

```tsx
<div className="relative">
  <div className="overflow-x-auto scrollbar-hide">{/* existing row */}</div>
  <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#F9F9F9] to-transparent" />
</div>
```

Match the `from-` colour to each section's background: `#F9F9F9` for PlaceGallery, `white` for FoodGallery, `#FFFDF8` for Drinks.

- [ ] **Step 9: Verify**

Run: `npx vitest run && npm run build`
Expected: PASS.

Then `npm run dev` and check by hand:
- Hovering the last card in each carousel does not create a horizontal jump.
- With reduced motion enabled in OS settings, the Our Story carousel holds still.
- Scrolling the homepage is smooth on a throttled CPU profile.

- [ ] **Step 10: Commit**

```bash
git add src/index.css src/hooks src/components
git commit -m "fix(motion): scope smooth scroll, honour reduced motion, add carousel affordances"
```

---

## Definition of done for A1

- [ ] `npm run build` passes with `tsc -b` enabled.
- [ ] `npx vitest run` passes.
- [ ] `grep -rn "/public/" src/ index.html` returns nothing.
- [ ] Every asset in the content layer resolves case-sensitively, enforced by the guardrail test.
- [ ] No component reads a hardcoded dish name, article, phone number, or opening time.
- [ ] The homepage renders correctly at 375px, 768px and 1440px with no horizontal overflow.
- [ ] No console errors on `/`, `/blogs` and an unmatched path.
- [ ] `npm run preview` served locally shows every image loading.

## Handed to A2

Not in this plan: the image pipeline (199MB to roughly 2MB, `assets-source/` split), font loading moved out of `@import`, favicon, `og:image` and `twitter:image`, `robots.txt`, `sitemap.xml`, canonical URL, the duplicate hero `h1`/`h2`, renaming `public/team/alice.jpg` (it is labelled as Chef Kamalika Anand; it is referenced by `src/content/press.json` and rendered on the live `/blogs` page, not only by the parked `ChefGallery.tsx`, so renaming it in A2 must also update `press.json`), and the README. PDF compression is done, not handed off: Task 8 already compressed both menu PDFs with Ghostscript, 93MB down to 21MB.

A1 deliberately leaves the site heavy. It will be correct, honest and mobile-usable, but still slow until A2 lands.

## Blocked on the founder

These leave content stubbed with existing values until answered. None block starting.

- Ten press URLs. Entries without a URL are omitted from `press.json` rather than shipped with `#`.
- Dish identifications and descriptions for `public/food/`.
- Which award the tiramisu won, or the claim is dropped.
- Whether the Michelin training claim is accurate. Her menu bio says "iconic kitchens across India and Italy".
- Authoritative opening hours, including whether 9am breakfast service is current. `site.json` currently carries corrected versions of the old footer values.
- Whether `linkedin.com/company/viabiancadelhi` exists. If not, set `socials.linkedin` to `null` and the icon disappears.
- A wide photo for `seo.ogImage`, currently defaulted to `/atmosphere/dining.jpg`.
