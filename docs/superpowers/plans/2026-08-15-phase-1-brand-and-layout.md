# Phase 1: Brand and Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the green brand colour with blue across the site, reorder the homepage so food leads and About sits low, and pull the Farfalle photos out of the hero collage.

**Architecture:** Every change here edits content or components that already exist. No new dependencies, no infrastructure, no new content types. The one refactor is replacing ~45 hardcoded green hex literals with Tailwind theme tokens, which the palette change forces anyway and which makes the next change a one-file edit.

**Tech Stack:** Vite 5, React 18, TypeScript strict (solution-style tsconfig), Tailwind 3, Vitest 3.2.7, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-15-rebrand-and-content-platform-design.md`

## Global Constraints

- Typecheck is `npx tsc -b --noEmit`. Plain `tsc --noEmit` checks nothing here; the tsconfig is solution-style.
- Full gate before any push: `npx tsc -b --noEmit && npm test -- --run && npx eslint .`
- Run `npm run images` before tests on a fresh clone. The `public/` derivatives are gitignored and 48 specs in `src/content/__tests__/assets.test.ts` fail without them.
- Every test must be able to fail. After writing one, mutate the code it covers and confirm it goes red. A test that cannot fail is a defect.
- jsdom has no layout engine. Any claim about rendering, occlusion, computed style, or gesture goes in `e2e/`, not `src/test/`.
- Tailwind's content scanner is a plain text extractor with no JS parser. Never write a bare utility-class-looking token in a comment; it emits a real CSS rule.
- `tailwind.config.js` does not scan `./src/content/*.json`, `./src/**/__tests__/**`, or `./src/test/**`. Class names appearing only in those files produce no CSS.
- Never list Claude or any AI as co-author, and never mention AI in a commit message.
- Colour values, exact: brand `#C8D8E8`, brand hover `#A6B3C1`, accent `#9D4949`, ink `#222`, cream `#FFFDF8`, cream-alt `#F9F9F9`. The green being replaced is `#6B8B59` with hover `#5a7349`.
- The `SectionId` union stays closed at its current seven members. `ourStory` is not renamed. Only its display name changes, to "About".
- The `#our-story` DOM anchor does not change. It is a live, possibly bookmarked URL.
- Sitka VF Italic and the favicon rework are out of scope for Phase 1. Parisienne stays.

## File Structure

**Created:**
- `src/test/palette.test.ts` — asserts no green literals survive anywhere in `src/`, and asserts every brand colour pairing meets WCAG AA numerically.
- `src/test/contrast.ts` — the sRGB relative-luminance and contrast-ratio functions the palette test uses. Its own module because Task 5's e2e spec imports it too, and a test importing another test file is a smell.
- `scripts/strip-farfalle.mjs` — one-off, run once, committed for the record. Calls `removeCollagePhoto` five times and rewrites `galleries.json`.
- `e2e/brand-contrast.spec.ts` — loads the real homepage in Chromium, reads computed styles, asserts no unreadable text on a brand-blue background.
- `e2e/hero-collage-after-farfalle.spec.ts` — asserts all eleven remaining collage photos are visible and unclipped at both breakpoints.

**Modified:**
- `tailwind.config.js` — add the colour tokens.
- 12 component files under `src/components/` and `src/admin/` — the literal sweep.
- `src/content/sections.json` — reorder.
- `src/content/copy.json` — nav label and order.
- `src/content/story.json` — heading.
- `src/content/pages.json` — delete two stubs.
- `src/admin/SectionList.tsx:67` and `src/admin/EditMode.tsx:100` — display name.
- `src/content/galleries.json` — rewritten by the script in Task 6.

---

### Task 1: Contrast maths

Pure functions with no dependencies, extracted first because two later tasks import them.

**Files:**
- Create: `src/test/contrast.ts`
- Test: `src/test/contrast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `relativeLuminance(hex: string): number` and `contrastRatio(a: string, b: string): number`. Task 2 and Task 5 both import these.

- [ ] **Step 1: Write the failing test**

Create `src/test/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  // Anchors the sRGB gamma curve, and it is the case that catches the most
  // likely wrong implementation. Skipping the linearisation and averaging
  // the raw channels puts mid-grey at 128/255 = 0.502. The eye reads it at
  // 0.216. Every threshold downstream would inherit that error.
  it('applies the sRGB transfer function, not a linear average', () => {
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#C8D8E8', '#C8D8E8')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#9D4949', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#9D4949'), 5);
  });

  it('accepts three-digit hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/test/contrast.test.ts`
Expected: FAIL, "Failed to resolve import ./contrast".

- [ ] **Step 3: Write the implementation**

Create `src/test/contrast.ts`:

```ts
// WCAG 2.1 relative luminance and contrast ratio.
//
// Lives under src/test/ rather than src/ because nothing SHIPPING needs it:
// it exists so the palette assertions in src/test/palette.test.ts and
// e2e/brand-contrast.spec.ts are arithmetic rather than opinion. Note that
// tailwind.config.js deliberately excludes ./src/test/** from its content
// glob, so nothing in this directory can emit CSS.
function channels(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

// The sRGB transfer function. The linearisation is the whole point: a plain
// channel average would call #808080 mid-grey at 0.5 when a human eye reads
// it at 0.216, and every threshold downstream would be wrong.
function linearize(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linearize) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/test/contrast.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the tests can fail**

Change `linearize` to `return value / 255;` and re-run. Expected: the `#808080` case fails with `0.5` against an expected `0.2159`. Revert the change and confirm green again.

- [ ] **Step 6: Commit**

```bash
git add src/test/contrast.ts src/test/contrast.test.ts
git commit -m "test: add WCAG contrast maths for the palette assertions"
```

---

### Task 2: Colour tokens and the palette guard

Defines the tokens and the test that will gate the sweep in Task 3. The guard test is expected to be RED at the end of this task, which is why the sweep is its own task and its own commit.

**Files:**
- Modify: `tailwind.config.js`
- Create: `src/test/palette.test.ts`

**Interfaces:**
- Consumes: `contrastRatio` from `src/test/contrast.ts`.
- Produces: Tailwind class names `bg-brand`, `text-brand`, `border-brand`, `bg-brand-dark`, `text-accent`, `bg-accent`, `text-ink`, `bg-cream`, `bg-cream-alt`, plus opacity variants like `bg-brand/20`. Task 3 uses all of these.

- [ ] **Step 1: Add the tokens**

In `tailwind.config.js`, inside `theme.extend`, add a `colors` key alongside the existing `keyframes` and `animation`:

```js
      // Named tokens rather than hex literals scattered through components.
      // Before this, the brand green was written out ~45 times across 12
      // files with a separate hover partner, so a palette change meant a
      // find-and-replace across the codebase and a guarantee of missing one.
      // src/test/palette.test.ts asserts none of the old literals survive.
      colors: {
        brand: '#C8D8E8',
        'brand-dark': '#A6B3C1',
        accent: '#9D4949',
        ink: '#222222',
        cream: '#FFFDF8',
        'cream-alt': '#F9F9F9',
      },
```

- [ ] **Step 2: Write the failing guard test**

Create `src/test/palette.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

const BRAND = '#C8D8E8';
const BRAND_DARK = '#A6B3C1';
const ACCENT = '#9D4949';
const INK = '#222222';
const WHITE = '#FFFFFF';

// Every hex the old palette used, lowercased for comparison. `6b8b59` is the
// green itself; `5a7349` is its hover partner. Both appeared as bare literals
// inside className strings.
const RETIRED = ['6b8b59', '5a7349'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

describe('the retired green', () => {
  it('appears nowhere in src/, including comments', () => {
    // Comments count. Tailwind's scanner is a plain text extractor with no
    // JS parser, so a hex inside a comment is indistinguishable from one in
    // a className as far as the generated CSS is concerned, and a stale hex
    // in a comment is a lie to the next reader either way.
    const offenders = sourceFiles('src')
      .filter((file) => file !== 'src/test/palette.test.ts')
      .filter((file) => {
        const text = readFileSync(file, 'utf8').toLowerCase();
        return RETIRED.some((hex) => text.includes(hex));
      });
    expect(offenders).toEqual([]);
  });
});

describe('the brand palette meets WCAG AA where it carries meaning', () => {
  it('puts readable text on a brand-blue surface', () => {
    // #C8D8E8 is a light surface at 1.45:1 against white. Ink on it is the
    // only readable pairing, and this is the assertion that stops a future
    // edit from putting white text on a blue button.
    expect(contrastRatio(BRAND, INK)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(BRAND, WHITE)).toBeLessThan(4.5);
  });

  it('lets the accent carry text on white and white text on itself', () => {
    expect(contrastRatio(ACCENT, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the hover shade distinguishable from the base', () => {
    // The eye needs to see the hover happen. Equal colours would pass every
    // other assertion in this file.
    expect(contrastRatio(BRAND, BRAND_DARK)).toBeGreaterThan(1.1);
  });

  it('keeps ink readable on both creams', () => {
    expect(contrastRatio('#FFFDF8', INK)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#F9F9F9', INK)).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 3: Run it and confirm the guard fails and the maths passes**

Run: `npx vitest run src/test/palette.test.ts`
Expected: the four contrast cases PASS. The "appears nowhere in src/" case FAILS, listing roughly 12 files. That failing list is the worklist for Task 3.

Record the list. You will need it.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.js src/test/palette.test.ts
git commit -m "feat(theme): add brand colour tokens and the palette guard

The guard is red until the literal sweep lands in the next commit. It is
committed first so the sweep has something to prove it finished."
```

---

### Task 3: Sweep the green literals

Turns the Task 2 guard green. Mechanical, but the file count is why it gets its own task.

**Files:**
- Modify: every file the Task 2 guard listed. Expect these twelve: `src/components/ChefGallery.tsx`, `BlogTeaser.tsx`, `BlogsPage.tsx`, `Footer.tsx`, `ErrorBoundary.tsx`, `NotFound.tsx`, `NewsPress.tsx`, `PlaceGallery.tsx`, `NavBar.tsx`, `Drinks.tsx`, `Hero.tsx`, plus any admin file the guard flags.

**Interfaces:**
- Consumes: the Tailwind tokens from Task 2.
- Produces: nothing new. Purely a substitution.

- [ ] **Step 1: Re-run the guard to get the current worklist**

Run: `npx vitest run src/test/palette.test.ts`

Work from the file list it prints rather than from the list above. The list above is what was measured while writing this plan and may have drifted.

- [ ] **Step 2: Substitute, file by file**

The mapping, applied to `className` strings:

| Before | After |
|---|---|
| `text-[#6B8B59]` | `text-brand` |
| `bg-[#6B8B59]` | `bg-brand` |
| `border-[#6B8B59]` | `border-brand` |
| `border-t-2 border-[#6B8B59]` | `border-t-2 border-brand` |
| `bg-[#6B8B59]/20` | `bg-brand/20` |
| `bg-[#6B8B59]/30` | `bg-brand/30` |
| `bg-[#6B8B59]/15` | `bg-brand/15` |
| `bg-[#6B8B59]/25` | `bg-brand/25` |
| `hover:bg-[#6B8B59]/8` | `hover:bg-brand/8` |
| `border-[#6B8B59]/15` | `border-brand/15` |
| `border-[#6B8B59]/20` | `border-brand/20` |
| `hover:text-[#6B8B59]` | `hover:text-brand` |
| `hover:bg-[#5a7349]` | `hover:bg-brand-dark` |
| `hover:text-[#5a7349]` | `hover:text-brand-dark` |
| `after:bg-[#6B8B59]` | `after:bg-brand` |
| `text-[#222]` | `text-ink` |
| `bg-[#FFFDF8]` | `bg-cream` |
| `bg-[#F9F9F9]` | `bg-cream-alt` |
| `from-[#FFFDF8]` | `from-cream` |
| `from-[#F9F9F9]` | `from-cream-alt` |

Two rules that are not mechanical:

**Buttons that pair `bg-brand` with `text-white` must become `text-ink`.** White on `#C8D8E8` is 1.45:1 and effectively invisible. Every occurrence of `bg-[#6B8B59] ... text-white` becomes `bg-brand ... text-ink`. Task 5 has an e2e test that catches any you miss, but fix them here. Known sites: `Drinks.tsx:70`, `BlogTeaser.tsx:89`, `ErrorBoundary.tsx:33`, `NotFound.tsx:15`, plus the `bg-[#6B8B59] text-white` pill in `NewsPress.tsx:46`, `BlogTeaser.tsx:45`, and `BlogsPage.tsx:90`.

**Leave `AdminReservations.tsx` and `ReservationForm.tsx` alone.** Their `green-100` / `green-600` / `focus:ring-green-500` are Tailwind's stock palette used as status and focus colours, not the brand green. They contain no `6b8b59` and the guard does not flag them. Changing them is out of scope.

- [ ] **Step 3: Run the guard and the full suite**

Run: `npx vitest run src/test/palette.test.ts && npm test -- --run`
Expected: the guard PASSES with an empty offender list. The full suite passes.

If a snapshot test fails because a className changed, that is expected and correct. Update the snapshot only after reading the diff and confirming it is a colour change and nothing else.

- [ ] **Step 4: Prove the guard can still fail**

Put `// #6B8B59` back into any one component as a comment. Re-run `npx vitest run src/test/palette.test.ts`. Expected: FAIL, naming that file. Remove the comment and confirm green.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc -b --noEmit && npx eslint .`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add -A src/
git commit -m "feat(theme): swap the brand green for blue across every component

Blue is a surface colour, not a text colour: #C8D8E8 is 1.45:1 against
white, so every button that paired the old green with white text now takes
ink instead."
```

---

### Task 4: Homepage order and the About label

**Files:**
- Modify: `src/content/sections.json`, `src/content/copy.json`, `src/content/story.json`, `src/admin/SectionList.tsx:67`, `src/admin/EditMode.tsx:100`
- Test: `src/test/section-order.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Content and label changes only. The `SectionId` union is untouched.

- [ ] **Step 1: Write the failing test**

Create `src/test/section-order.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import sections from '../content/sections.json';
import copy from '../content/copy.json';
import story from '../content/story.json';

describe('homepage section order', () => {
  it('leads with the food and puts the story last before Visit', () => {
    // The PR head's note: atmosphere, food, then drinks come first. Taran's:
    // About moves towards the bottom. Both are satisfied by this order.
    expect(sections.map((s) => s.id)).toEqual([
      'hero', 'atmosphere', 'food', 'drinks', 'press', 'ourStory', 'visit',
    ]);
  });

  it('keeps every section enabled', () => {
    expect(sections.every((s) => s.enabled)).toBe(true);
  });
});

describe('the story section presents as About', () => {
  it('headings say About, not Our Story', () => {
    expect(story.heading).toBe('About');
  });

  it('the nav calls it About and places it after the menu', () => {
    const labels = copy.nav.links.map((l) => l.label);
    expect(labels).toContain('About');
    expect(labels).not.toContain('Our Story');
    expect(labels.indexOf('About')).toBeGreaterThan(labels.indexOf('Menu'));
  });

  it('keeps the section id and the live anchor unchanged', () => {
    // Both are load-bearing and independently so. The id is also the
    // galleries.ourStory key and the galleries.ourStory.N editable path;
    // the anchor is a URL someone may have bookmarked.
    const link = copy.nav.links.find((l) => l.label === 'About');
    expect(link?.section).toBe('ourStory');
    expect(link?.href).toBe('#our-story');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/test/section-order.test.ts`
Expected: FAIL on the order (currently `ourStory` sits at index 1), FAIL on `story.heading`, FAIL on the nav label.

- [ ] **Step 3: Reorder `sections.json`**

Rewrite `src/content/sections.json` so the entries appear in this order, each keeping `"kind": "bespoke"` and `"enabled": true`:

`hero`, `atmosphere`, `food`, `drinks`, `press`, `ourStory`, `visit`

- [ ] **Step 4: Change the labels**

In `src/content/story.json`, set `"heading": "About"`.

In `src/content/copy.json`, change the `Our Story` link's `label` to `About` and move that object so it sits after the `Menu` entry. The `href` stays `#our-story` and `section` stays `ourStory`. Final `links` order: Gallery, Menu, About, Stories, Visit.

In `src/admin/SectionList.tsx:67`, change `ourStory: { name: 'Our Story', anchor: '#our-story' }` to `ourStory: { name: 'About', anchor: '#our-story' }`. The anchor does not change.

In `src/admin/EditMode.tsx:100`, change `ourStory: 'Our Story'` to `ourStory: 'About'`.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/test/section-order.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Prove it can fail**

Swap `press` and `ourStory` in `sections.json`. Re-run. Expected: the order assertion fails. Revert.

- [ ] **Step 7: Run the full gate**

Run: `npx tsc -b --noEmit && npm test -- --run && npx eslint .`

`src/admin/__tests__/SectionList.test.tsx:80` iterates the seven ids and may assert on the visible name. If it fails on `'Our Story'`, update it to `'About'`. That is a real assertion doing its job, not a flake.

`src/test/homepage-bytes.test.tsx` will fail, because the rendered homepage moved. Update the expected byte count to whatever the run reports, and only that.

- [ ] **Step 8: Commit**

```bash
git add -A src/
git commit -m "feat(home): lead with food and drinks, move the story to About near the bottom

The section id stays ourStory: it is also the galleries key, the upload
category mapping, and the editable-path prefix. Only the display name and
the nav position change. The #our-story anchor stays too, since it is a
live URL."
```

---

### Task 5: Prove no unreadable text shipped

A browser test, because computed colour needs a layout engine and jsdom has none. This is the assertion that catches a blue button with white text anywhere in the app, including places Task 3 did not think to look.

**Files:**
- Create: `e2e/brand-contrast.spec.ts`

**Interfaces:**
- Consumes: `contrastRatio` from `src/test/contrast.ts`.
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `e2e/brand-contrast.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { contrastRatio } from '../src/test/contrast';

function toHex(rgb: string): string | null {
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}

test('no text on a brand-blue surface is unreadable', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Every element that paints the brand blue as its own background AND has
  // its own text. Walking computed style rather than class names is the
  // whole point: a Tailwind token, an arbitrary value, and an inline style
  // are indistinguishable here, so this cannot be fooled by spelling.
  const failures = await page.evaluate(() => {
    const out: { text: string; bg: string; fg: string }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(el);
      const bg = style.backgroundColor;
      if (bg !== 'rgb(200, 216, 232)') continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      // Only elements whose own text node is direct, so a wrapper does not
      // get blamed for a child's text on a different background.
      const ownText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
      );
      if (!ownText) continue;
      out.push({ text: text.slice(0, 40), bg, fg: style.color });
    }
    return out;
  });

  const unreadable = failures.filter((f) => {
    const fg = toHex(f.fg);
    const bg = toHex(f.bg);
    return fg !== null && bg !== null && contrastRatio(fg, bg) < 4.5;
  });

  expect(unreadable).toEqual([]);
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/brand-contrast.spec.ts`
Expected: PASS, assuming Task 3's button fixes are complete.

If it fails, it is telling you about a real unreadable button. Fix the component, do not loosen the test.

- [ ] **Step 3: Prove it can fail**

Change any one `bg-brand text-ink` button to `bg-brand text-white`. Re-run. Expected: FAIL, naming that button's text. Revert and confirm green.

This step is not optional. A test that walks the DOM looking for a condition can silently match nothing and pass forever. Watching it go red is the only proof it is looking in the right place.

- [ ] **Step 4: Commit**

```bash
git add e2e/brand-contrast.spec.ts
git commit -m "test(e2e): fail the build if any text on brand blue drops below AA"
```

---

### Task 6: Remove the Farfalle photos from the hero collage

**Files:**
- Create: `scripts/strip-farfalle.mjs`
- Modify: `src/content/galleries.json` (rewritten by the script)
- Create: `e2e/hero-collage-after-farfalle.spec.ts`

**Interfaces:**
- Consumes: `removeCollagePhoto` and `countCollagePhotos` from `src/content/collage.ts`.
- Produces: a `heroCollage` tree with eleven photos.

- [ ] **Step 1: Write the script**

Create `scripts/strip-farfalle.mjs`:

```js
// One-off, run once, committed for the record rather than for reuse.
//
// Hand-editing the tree was the alternative and it is the wrong one: removing
// a photo is not a delete. A split left with one child has to collapse into
// that child, and a split left with two or more has to redistribute the
// removed photo's share across its siblings. removeCollagePhoto already does
// both, is already tested, and is what the dashboard's own remove button
// calls -- so running it here means the committed JSON is reachable by the
// same code path the editor would have produced.
//
// Four of these five removals collapse a split, which is why the result needs
// a look in a browser afterwards. See e2e/hero-collage-after-farfalle.spec.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { countCollagePhotos, removeCollagePhoto } from '../src/content/collage.ts';

const PATH = 'src/content/galleries.json';
const FARFALLE = ['photo-4', 'photo-5', 'photo-9', 'photo-14', 'photo-16'];

const galleries = JSON.parse(readFileSync(PATH, 'utf8'));
const before = countCollagePhotos(galleries.heroCollage);

let tree = galleries.heroCollage;
for (const id of FARFALLE) {
  const next = removeCollagePhoto(tree, id);
  if (next === tree) throw new Error(`refused to remove ${id} -- it returned the tree unchanged`);
  tree = next;
}

const after = countCollagePhotos(tree);
if (after !== before - FARFALLE.length) {
  throw new Error(`expected ${before - FARFALLE.length} photos, got ${after}`);
}

galleries.heroCollage = tree;
writeFileSync(PATH, JSON.stringify(galleries, null, 2) + '\n');
console.log(`removed ${FARFALLE.length}: ${before} photos -> ${after}`);
```

The identity check on line `if (next === tree)` matters: `removeCollagePhoto` returns the input unchanged when it refuses, so without it a typo in a photo id would silently do nothing and the script would still report success.

- [ ] **Step 2: Confirm the five ids are the Farfalle photos before running anything**

Run: `grep -n 'farfalle' src/content/galleries.json`
Expected: five lines, with ids `photo-4`, `photo-5`, `photo-9`, `photo-14`, `photo-16`. If the ids differ, update `FARFALLE` in the script rather than running it against the wrong tiles.

- [ ] **Step 3: Run it**

Run: `npx vite-node scripts/strip-farfalle.mjs`
Expected: `removed 5: 16 photos -> 11`

It must be `vite-node`, not `node`. The script imports a `.ts` module and bare node cannot resolve it. `tsx` is not installed in this project; `vite-node` is, at `node_modules/.bin/vite-node`.

- [ ] **Step 4: Confirm the result**

Run: `grep -c 'farfalle' src/content/galleries.json`
Expected: `0`

Run: `npm test -- --run`
Expected: the collage validation tests pass. `src/test/homepage-bytes.test.tsx` fails again; update the byte count and nothing else.

- [ ] **Step 5: Give the collage photos a test hook**

There is no way to select the collage photos today, and a generic `#hero img` would also catch `/hero/brick.webp`, the decorative background at `src/components/Hero.tsx:108`. That image is deliberately outside the collage and has no content leaf behind it, so counting it would make the assertion wrong by one and hide a real missing tile.

In `src/components/Hero.tsx`, in the photo branch of `renderCollageNode` (the `<img>` it returns for a `kind: 'photo'` node, not the brick image at line 108), add `data-collage-photo=""` to the element.

Add nothing to the brick image.

- [ ] **Step 6: Write the browser test**

Create `e2e/hero-collage-after-farfalle.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// This repo has shipped invisible collage tiles before: nine photos were
// clipped out of view by Hero's own overflow-hidden and nobody could see why,
// because jsdom has no layout engine and every unit test stayed green. That
// is the failure this file exists to catch, so it asserts on measured boxes
// rather than on the DOM containing eleven <img> elements.
for (const [label, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
  test(`all eleven collage photos are visible at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The attribute added in the previous step. Deliberately NOT a generic
    // `#hero img`: /hero/brick.webp is a decorative background inside the same
    // section and counting it would make this assertion wrong by one, which
    // would mask exactly the missing tile it exists to catch.
    const target = page.locator('[data-collage-photo]');

    await expect(target).toHaveCount(11);

    const boxes = await target.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );
    for (const [i, box] of boxes.entries()) {
      expect(box.w, `photo ${i} has zero width`).toBeGreaterThan(0);
      expect(box.h, `photo ${i} has zero height`).toBeGreaterThan(0);
    }
  });
}
```

- [ ] **Step 7: Run it and prove it can fail**

Run: `npx playwright test e2e/hero-collage-after-farfalle.spec.ts`
Expected: PASS at both viewports.

Then change the expected count from 11 to 12 and re-run. Expected: FAIL. Revert.

- [ ] **Step 8: Look at it**

Open the homepage in a browser at both breakpoints and actually look at the hero.

The left column lost its bottom third when `photo-4` went, so `photo-1` and the `photo-2`/`photo-3` pair now stretch to fill the full column height. The test proves they are visible. It does not prove they look right. If the aspect ratios read badly, adjust the `sizes` on the root split, which is the one number that rebalances left against right, and re-run both e2e specs.

- [ ] **Step 9: Commit**

```bash
git add scripts/strip-farfalle.mjs src/content/galleries.json e2e/hero-collage-after-farfalle.spec.ts src/test/homepage-bytes.test.tsx
git commit -m "feat(hero): drop the Farfalle photos from the collage

Sixteen tiles down to eleven, via removeCollagePhoto rather than by hand,
so the splits collapse and redistribute the same way the dashboard's own
remove button would. Four of the five removals collapsed a split."
```

---

### Task 7: Delete the two empty page stubs

These are what produce the "this section needs at least one item" warning the PR head saw on the `/edit` screen. Both are already disabled and neither has ever held content.

**Files:**
- Modify: `src/content/pages.json`
- Test: `src/test/pages-clean.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `src/test/pages-clean.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import pages from '../content/pages.json';
import { validateContent } from '../content/validate';

describe('pages.json', () => {
  it('holds only the four real pages', () => {
    expect(pages.map((p) => p.slug)).toEqual([
      'catering', 'cheeseboards', 'cooking-class', 'membership',
    ]);
  });

  it('has no section that would warn in the dashboard', () => {
    // The "this section needs at least one item" and "needs at least one
    // image" warnings are editor-only -- nothing public reads validation
    // problems -- but she still sees them every time she opens /edit, on
    // pages that were never going to be finished.
    const problems = validateContent('pages.json', pages);
    expect(problems).toEqual([]);
  });
});
```

Check `validateContent`'s real signature in `src/content/validate.ts` before running. If it takes only the data, or returns a differently shaped object, match it rather than guessing.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/test/pages-clean.test.ts`
Expected: FAIL. Six slugs found, four expected. The validation case fails naming `breads-and-dips` and `who-we-supply`.

- [ ] **Step 3: Delete the two stubs**

Remove the `breads-and-dips` and `who-we-supply` objects from `src/content/pages.json` entirely. Both are already `"enabled": false` and `"inNav": false`, so nothing links to them and no redirect is needed.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/test/pages-clean.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Prove it can fail**

Add back a page with `"sections": [{ "kind": "template", "id": "x", "template": "itemList", "enabled": true, "content": { "heading": "x", "items": [] } }]`. Re-run. Expected: the validation case fails. Remove it.

- [ ] **Step 6: Full gate**

Run: `npx tsc -b --noEmit && npm test -- --run && npx eslint .`

- [ ] **Step 7: Commit**

```bash
git add src/content/pages.json src/test/pages-clean.test.ts
git commit -m "fix(pages): delete the two stubs that never held content

Both were disabled and invisible to the public, but they produced a
validation warning on every visit to /edit, on the section headings, which
is what the site review flagged."
```

---

### Task 8: Ship it

- [ ] **Step 1: Regenerate derivatives and run the whole gate**

```bash
npm run images
npx tsc -b --noEmit
npm test -- --run
npx eslint .
npm run test:e2e
npm run test:csp
```

All six clean before proceeding.

- [ ] **Step 2: Push**

```bash
git push
```

The pre-push hook in `.githooks/pre-push` runs the same gate. If it refuses, do not reach for `--no-verify`.

- [ ] **Step 3: Verify the deployment**

Run: `npm run verify:deploy`

This resolves the live deployment, waits for it to settle, and checks the served assets rather than the local `dist/`. Do not skip the settle window; fetching assets the instant the sha flips is what poisoned the asset cache once before.

- [ ] **Step 4: Look at the live site**

Load `https://vb.aionxxxi.uk` on a phone-sized viewport and a desktop one. Check the hero collage, that buttons are readable, and that the section order is food-first with About near the bottom.

- [ ] **Step 5: Close every browser you opened**

Close every Playwright and Chrome-for-testing browser, then confirm no orphans survive:

```bash
pgrep -fl "Chrome for Testing|chromium" || echo "clean"
```

`browser.close()` has left orphaned renderers behind in this project before. Check, do not assume.

---

## Self-Review

**Spec coverage.** Phase 1 of the spec lists five items. Colour tokens: Tasks 2 and 3. Homepage order: Task 4. Hero Farfalle removal: Task 6. Cleanup of the two stubs: Task 7. Nav: Task 4 renames the label and moves it; the spec says the Experiences dropdown survives Phase 1 untouched, so there is deliberately no task for it. Type and favicon are cut from Phase 1 by the spec itself. Contrast assertions, which the spec's testing section calls for by name, are Tasks 1, 2 and 5.

**Known gaps, deliberate.** The spec's "Awards sits between Blog and About" ordering cannot be implemented in Phase 1 because neither section exists. The final order is recorded in the spec and reached in Phases 3 to 5.

**Two things this plan corrects in the spec, already amended there:** the `ourStory` section id is not renamed, because it is also the galleries key and the editable-path prefix and the live published data depends on it; and the collage surgery runs through `removeCollagePhoto` rather than by hand.

**Byte-count churn.** `src/test/homepage-bytes.test.tsx` asserts an exact rendered byte length and will fail in Tasks 3, 4, and 6. Each is expected. Update the number, never the assertion, and never fold it into an unrelated commit.
