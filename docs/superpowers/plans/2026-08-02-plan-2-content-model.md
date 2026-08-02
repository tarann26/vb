# Plan 2: Content model — prose, sections and scheduling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every visible string out of components into the content layer, make the homepage an ordered list of toggleable sections, and let content carry a publish date.

**Architecture:** A new `src/content/copy.json` holds headings, intros and labels, validated by the same throwing-guard pattern the existing content uses. `src/content/sections.json` becomes the homepage's running order. A `publishAt` field on items and sections is filtered at build time, so future-dated content is absent from the shipped bundle rather than hidden in it.

**Tech Stack:** Vite 5, React 18, TypeScript strict, Tailwind 3, Vitest.

## Context

Via Bianca is a real Italian restaurant in Greater Kailash, Delhi. Phases A1 and A2 built a typed content layer under `src/content/`, and Plan 1 moved hosting to Cloudflare Pages. Spec: `docs/superpowers/specs/2026-08-02-phase-b-c-dashboard-and-sections-design.md`.

This is Plan 2 of 8. Plans 4 (dashboard) and 5 (edit mode) both depend on it: the dashboard generates its forms from these types, and edit mode can only edit what the content layer owns.

Current state: `npm run build` exits 0, `npx vitest run` is 452/452 across 25 files, working tree clean.

**Why this plan exists.** Two separate whole-phase reviews reached the same conclusion: the content layer holds *records* — dishes, drinks, press, hours, images — but not *prose*. Every section heading, intro paragraph and button label is hardcoded in a component. As shipped today the founder could change a dish but not a headline, which is the difference between "she can change the data" and "she can change the site".

## Scope deviation from the spec, and why

The spec's Plan 2 row assigns "the page and section model". This plan builds the **section** model and defers the **page** model to Plan 7.

Reason: Plan 7 builds the section templates and the page builder. Defining data-driven routing now, for two hand-built pages that already work, is speculative generality with no consumer for five plans. The section list, by contrast, has an immediate consumer — it is what makes enable/disable work, which the owner asked for directly.

Nothing in Plan 4 or 5 needs the page model. If that turns out to be wrong, it is a small addition then rather than dead abstraction now.

## Global Constraints

- **No visible change to the site.** Every page must render identically, string for string, before and after. This plan moves text; it does not rewrite it. Copy the existing strings **exactly**, including punctuation, ampersands, and the non-breaking spaces in the hero strapline.
- **No component file is deleted.** Seven are protected and covered by a test: `AdminReservations.tsx`, `ReservationForm.tsx`, `ReservationPage.tsx`, `ChefGallery.tsx`, `NewsPress.tsx`, `SignatureMocktails.tsx`, `BlogsPage.tsx`. The parked ones are not in scope for prose extraction; leave their strings alone.
- **No restyling.** Tailwind classes on existing elements stay byte-identical.
- **No new runtime services.**
- **Asset paths never start with `/public/`.**
- **Content exports use a type annotation or a throwing runtime guard, never `as`.** `src/content/index.ts` is bundled into the browser: never `node:fs` or `import.meta.glob` there. Test files and build scripts may use node APIs freely.
- **Brand colours stay:** `#6B8B59`, `#222`, `#F9F9F9`, `#FFFDF8`. **Fonts stay:** Parisienne, Montserrat, Open Sans.
- Work continues on branch `repair/phase-a`. Do not push to `main`.
- Commit after every task.

## The prose inventory

Extracted from the rendered components. This is the complete set in scope:

| Component | Strings |
|---|---|
| `NavBar` | Wordmark "Via Bianca"; the five `NAV_LINKS` labels |
| `Hero` | Logo "Via Bianca" / "Pastificio & Ristorante"; "For reservations"; "Reserve a Table" |
| `PlaceGallery` | "Atmosfera" |
| `FoodGallery` | "Hand-crafted Pastas & Wood-Fired Classics" |
| `Drinks` | "Drinks"; the intro paragraph; the three category headings |
| `BlogTeaser` | "Latest Stories"; the intro paragraph; "Read Article"; "View All Stories" |
| `VisitUs` | "Visit Us"; "Navigate" |
| `Footer` | "Opening Hours"; "Follow Us:" |
| `BlogsPage` | "Via Bianca Stories"; "Press & Articles"; "All Stories"; its intro; "← Back to Home"; "Previous"; "Next" |
| `NotFound` | "Page not found"; "Back to home" |

`Hero`'s h1 and the visible tagline already come from `site.name`, `site.tagline` and `site.strapline`. Do not duplicate those into `copy.json`; read them from `site` as the component already does.

`ErrorBoundary` is deliberately excluded. It renders when the app has crashed, quite possibly because the content layer threw, so it must not depend on the content layer. Its hardcoded strings stay, and a comment should say why.

## File Structure

**Created:** `src/content/copy.json`, `src/content/sections.json`, `src/content/__tests__/copy.test.ts`, `src/content/__tests__/sections.test.ts`, `src/content/publish.ts`, `src/content/__tests__/publish.test.ts`

**Modified:** `src/content/types.ts`, `src/content/index.ts`, `src/App.tsx`, and the nine rendered components listed above.

---

### Task 1: The copy content file, and the simple sections

**Files:**
- Create: `src/content/copy.json`, `src/content/__tests__/copy.test.ts`
- Modify: `src/content/types.ts`, `src/content/index.ts`, `src/components/PlaceGallery.tsx`, `FoodGallery.tsx`, `VisitUs.tsx`, `Footer.tsx`, `NavBar.tsx`

**Interfaces:**
- Produces: `copy` export from `src/content`, typed `Copy`, narrowed by a throwing guard. Tasks 2 and 3 extend the same file.

- [ ] **Step 1: Define the shape**

In `src/content/types.ts`:

```ts
export interface NavLink {
  href: string;
  label: string;
}

export interface Copy {
  nav: { wordmark: string; links: NavLink[] };
  hero: { logoName: string; logoTagline: string; reservationsLabel: string; reserveButton: string };
  atmosphere: { heading: string };
  food: { heading: string };
  drinks: { heading: string; intro: string; mocktails: string; cocktails: string; wine: string };
  press: { heading: string; intro: string; readArticle: string; viewAll: string };
  visit: { heading: string; navigateButton: string };
  footer: { hoursHeading: string; followLabel: string };
  blogsPage: { title: string; subtitle: string; heading: string; intro: string; back: string; previous: string; next: string };
  notFound: { heading: string; back: string };
}
```

One flat file rather than one per component. The dashboard in Plan 4 generates forms from this type, and a single nested object gives it a natural grouping to render without needing a registry of files.

- [ ] **Step 2: Write the failing guard test**

`src/content/__tests__/copy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { copy } from '../index';

const strings = (obj: unknown, path = ''): [string, string][] =>
  typeof obj === 'string'
    ? [[path, obj]]
    : Array.isArray(obj)
      ? obj.flatMap((v, i) => strings(v, `${path}[${i}]`))
      : obj && typeof obj === 'object'
        ? Object.entries(obj).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
        : [];

describe('copy', () => {
  const all = strings(copy);

  it('finds strings to check', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(all)('%s is not blank', (_path, value) => {
    expect(value.trim().length).toBeGreaterThan(0);
  });

  it('has one nav link per section anchor', () => {
    expect(copy.nav.links.length).toBe(5);
    copy.nav.links.forEach((l) => expect(l.href).toMatch(/^#/));
  });
});
```

The first assertion is a non-vacuity guard: without it, an empty `copy.json` would make `it.each` generate nothing and the file would pass green. This project has caught four tests that passed on the bug they named; do not remove it.

Run: `npx vitest run src/content/__tests__/copy.test.ts`
Expected: FAIL, no `copy` export.

- [ ] **Step 3: Write copy.json by copying strings, not by rewriting them**

Read each component and transcribe its strings **exactly**. Do not improve wording, fix punctuation, or normalise the ampersand in "Pastificio & Ristorante". A single character difference is a visible change to a live site.

The `NAV_LINKS` array already exists in `NavBar.tsx`; move it verbatim.

- [ ] **Step 4: Export it with a throwing guard**

Follow the existing pattern in `src/content/index.ts` — the one `assertHours` and the drinks category guard use. A plain annotation will not narrow JSON literal types, which is why that pattern exists.

At minimum the guard must reject a blank string anywhere and a `nav.links` array that is empty. Throw with the offending path in the message, the way `assertHours` names its field.

Run: `npx vitest run src/content/__tests__/copy.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire up the five simple components**

`PlaceGallery`, `FoodGallery`, `VisitUs`, `Footer`, `NavBar`. Each is a one-for-one substitution of a literal for a `copy.*` reference.

**Keep every Tailwind class byte-identical.** The only change is what sits between the tags.

- [ ] **Step 6: Prove nothing moved**

```bash
npm run build && npx vitest run
```

Then check by eye. Serve the build and compare against the previous commit at 1440px and 375px. Previous tasks in this project built the prior commit in a separate worktree and diffed screenshots; that method works and is worth repeating here, because "no visible change" is this plan's central claim and a typo in a transcribed string is invisible to tests.

If you cannot drive a browser, say so plainly rather than claiming you checked.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(content): move section headings and labels into the content layer"
```

---

### Task 2: The prose-heavy sections

`Hero`, `Drinks`, `BlogTeaser`, `BlogsPage` and `NotFound`. These carry multi-sentence intros where a transcription error is easiest to make and hardest to spot.

**Files:**
- Modify: `src/content/copy.json`, `src/components/Hero.tsx`, `Drinks.tsx`, `BlogTeaser.tsx`, `BlogsPage.tsx`, `NotFound.tsx`
- Test: `src/components/__tests__/copy-rendered.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/__tests__/copy-rendered.test.tsx` renders each section and asserts the copy string appears. Use `MemoryRouter` where the component needs router context.

```tsx
it('renders the drinks intro from content', () => {
  render(<Drinks />);
  expect(screen.getByText(copy.drinks.intro)).toBeInTheDocument();
});
```

Do this for each of the five components' longest string. Short labels are covered by Task 1's shape test; the intros are where transcription breaks.

Run it and confirm it fails because the component still hardcodes the string, not because of a missing import.

- [ ] **Step 2: Transcribe and substitute**

The same rule as Task 1: copy exactly. `Hero`'s strapline already reads from `site.strapline` with a non-breaking-space replacement — leave that alone, it is not in scope.

`BlogsPage`'s "← Back to Home" contains a literal arrow character. Preserve it.

- [ ] **Step 3: Verify**

`npm run build`, full suite, and the visual comparison again. Report what you observed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(content): move section intros and page copy into the content layer"
```

---

### Task 3: The homepage as an ordered, toggleable section list

**Files:**
- Create: `src/content/sections.json`, `src/content/__tests__/sections.test.ts`
- Modify: `src/content/types.ts`, `src/content/index.ts`, `src/App.tsx`

**Interfaces:**
- Produces: `sections` export from `src/content`, an ordered array. Plan 4's dashboard reorders and toggles it; Plan 7 inserts template sections into it.

- [ ] **Step 1: Define the shape**

```ts
export type SectionId =
  | 'hero' | 'ourStory' | 'atmosphere' | 'food' | 'drinks' | 'press' | 'visit';

export interface Section {
  id: SectionId;
  enabled: boolean;
}
```

Order is the array order. There is no `order` field: two sources of truth for ordering is how lists drift, and an array already expresses it.

`hero`, `nav` and `footer` are not optional. The nav and footer are chrome rather than sections and stay outside this list. The hero is in the list so it can be reordered, but Step 4 asserts it cannot be disabled — a homepage with no hero is not a state worth supporting, and the founder disabling it by accident is a worse outcome than her not being able to.

- [ ] **Step 2: Write the failing test**

```ts
describe('homepage sections', () => {
  it('lists every rendered section exactly once', () => {
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(7);
  });

  it('always keeps the hero enabled', () => {
    expect(sections.find((s) => s.id === 'hero')?.enabled).toBe(true);
  });

  it('renders only enabled sections', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    // Atmosfera is enabled today, so its heading is present.
    expect(screen.getByText(copy.atmosphere.heading)).toBeInTheDocument();
  });

  it('omits a disabled section', async () => {
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return { ...actual, sections: actual.sections.map((s) =>
        s.id === 'atmosphere' ? { ...s, enabled: false } : s) };
    });
    const { HomePage } = await import('../../App');
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.queryByText(actualCopy.atmosphere.heading)).toBeNull();
    vi.resetModules();
  });
});
```

The fourth test is the one that matters. Without it, "renders only enabled sections" is satisfied by a component that ignores the flag entirely and renders everything. Mock the module rather than editing the JSON, so the test does not depend on what happens to be enabled today.

`HomePage` is currently not exported from `App.tsx`. Export it, the way `AppRoutes` already is, so the test can render it without a router-in-router.

- [ ] **Step 3: Make HomePage render from the list**

Replace the hardcoded JSX sequence with a map over `sections`, dispatching by `id`. Keep `SeoHead`, `Navbar` and `Footer` outside the list.

The wrapper `<div className="min-h-screen">` stays byte-identical.

- [ ] **Step 4: Guard the hero**

Add to the throwing guard in `index.ts`: reject a `sections.json` where the hero is absent or disabled. Message should say why, not just that it failed.

- [ ] **Step 5: Prove it**

Temporarily set `atmosphere` to `enabled: false` in the real file, run the build, confirm the section is gone from the rendered output, and revert. Then temporarily disable the hero and confirm the guard throws.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(content): render the homepage from an ordered section list"
```

---

### Task 4: Scheduling by publish date

**Files:**
- Create: `src/content/publish.ts`, `src/content/__tests__/publish.test.ts`
- Modify: `src/content/types.ts`, `src/content/index.ts`

**Interfaces:**
- Produces: `isPublished(item, now)` from `src/content/publish.ts`, and filtering applied in the barrel.

- [ ] **Step 1: Define the field**

Add `publishAt?: string` (ISO date, `YYYY-MM-DD`) to `Dish`, `Drink`, `Article` and `Section`. Optional: absent means published.

- [ ] **Step 2: Write the failing test**

```ts
import { isPublished } from '../publish';

const at = (d: string) => new Date(`${d}T00:00:00Z`);

describe('isPublished', () => {
  it('publishes an item with no date', () => {
    expect(isPublished({}, at('2026-08-02'))).toBe(true);
  });

  it('publishes an item dated today', () => {
    expect(isPublished({ publishAt: '2026-08-02' }, at('2026-08-02'))).toBe(true);
  });

  it('publishes an item dated in the past', () => {
    expect(isPublished({ publishAt: '2026-07-01' }, at('2026-08-02'))).toBe(true);
  });

  it('withholds an item dated in the future', () => {
    expect(isPublished({ publishAt: '2026-09-01' }, at('2026-08-02'))).toBe(false);
  });

  it('rejects a malformed date rather than guessing', () => {
    expect(() => isPublished({ publishAt: 'next tuesday' }, at('2026-08-02'))).toThrow();
  });
});
```

"Dated today publishes" is a deliberate choice: she picks a date meaning "this goes live that day", not "the day after". Throwing on a malformed date rather than defaulting matters because both defaults are wrong — publishing something unfinished, or silently never publishing it.

**Pass `now` explicitly.** Do not read the clock inside the function. A function that reads `Date.now()` internally cannot be tested for the boundary without stubbing globals, and the boundary is the only interesting part.

- [ ] **Step 3: Implement, then filter in the barrel**

`dishes`, `drinks`, `press` and `sections` are filtered through `isPublished` at module load, using the build's clock. Future-dated content is therefore absent from the shipped bundle rather than hidden in it — which is the point, and the reason this is not done in the browser.

- [ ] **Step 4: Check what the filtering breaks**

This is the step most likely to surface something. Existing tests assert counts — `press` has 12 articles, `drinks` has 38. Those still pass today because nothing is future-dated, but they now depend on the build date, which is a hidden coupling.

Run the full suite and read what fails. Then consider: is any existing test now date-dependent in a way that would break on a future run? If so, say which, and make it robust rather than leaving a test that will fail on some arbitrary future day.

- [ ] **Step 5: Prove the filtering works end to end**

Temporarily set a future `publishAt` on one dish. Build. Confirm the dish is absent from `dist/` — grep the built JS bundle for its name and find nothing. Revert.

That grep is the real proof. A test asserting the array is shorter proves the filter ran; grepping the bundle proves the content is genuinely not shipped.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(content): filter future-dated content at build time"
```

---

## Definition of done

- [ ] `npm run build` exits 0; `npx vitest run` green. Record the count.
- [ ] Every string in the prose inventory reads from `src/content/copy.json`.
- [ ] The site renders identically to before, verified by comparing against the previous commit at 375px and 1440px. If a browser was not available, say so.
- [ ] Disabling a homepage section in `sections.json` removes it from the built output, verified for real.
- [ ] The hero cannot be disabled; the guard throws with a readable message.
- [ ] A future-dated dish is absent from the built bundle, verified by grepping `dist/`.
- [ ] No component outside the seven protected ones holds a visible string, apart from `ErrorBoundary`, which is deliberately excluded and says so in a comment.

## Handed to later plans

- **The page model** — pages with slugs, nav visibility and their own section lists. Deferred to Plan 7, which builds the templates that populate them.
- **Editing any of this** — Plan 4 (dashboard) and Plan 5 (edit mode).
- **`.gitignore`'s eight explicit paths** — carried from Plan 1. If Plan 3's upload UI ever lets the founder create a new asset category, its derivatives will not be auto-ignored and a later `git add -A` would commit generated files. Prerequisite for Plan 3, recorded here so it is not lost.
