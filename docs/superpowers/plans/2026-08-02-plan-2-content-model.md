# Plan 2: Content model — prose, sections and scheduling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every visible string out of components into the content layer, make the homepage an ordered list of toggleable sections, and let content carry a publish date that is honoured at build time.

**Architecture:** `src/content/copy.json` holds headings, intros and labels, validated by the same throwing-guard pattern the existing content uses. `src/content/sections.json` is the homepage's running order and the source the nav derives from. A `publishAt` field is filtered by a **Vite build plugin**, not by the browser-bundled barrel, so future-dated content is genuinely absent from `dist/`.

**Tech Stack:** Vite 5, React 18, TypeScript strict, Tailwind 3, Vitest.

## Context

Via Bianca is a real Italian restaurant in Greater Kailash, Delhi. Phases A1 and A2 built a typed content layer under `src/content/`; Plan 1 moved hosting to Cloudflare Pages. Spec: `docs/superpowers/specs/2026-08-02-phase-b-c-dashboard-and-sections-design.md`.

This is Plan 2 of 8. Plans 4 (dashboard) and 5 (edit mode) both depend on it.

Current state: `npm run build` exits 0, `npx vitest run` is 452/452 across 25 files, working tree clean.

**Why this plan exists.** Two whole-phase reviews reached the same conclusion: the content layer holds *records* but not *prose*. Every section heading, intro and button label is hardcoded. As shipped, the founder can change a dish but not a headline.

**This plan was reviewed before implementation and substantially rewritten.** The review found three Critical defects, and the corrections are marked inline where they matter. Do not "simplify" them back.

## Scope deviations from the spec, both declared

**1. The page model moves to Plan 7.** Plan 7 already owns "the five templates and the page builder" and depends on Plans 2 *and* 4, so the spec itself sequences the page builder after the dashboard.

Note honestly: D3's dashboard table does say the dashboard handles "adding, removing and reordering items, **pages** and sections". So the page *editing* UI is assigned to Plan 4. This plan moves the page **model** to Plan 7 alongside the builder that populates it, which means Plan 4 ships without page management. That is a deliberate resequencing, not an oversight.

One warning for Plan 4's author, recorded in Handed to later plans: every type the dashboard generates forms from today is a flat record. `Page { slug, name, inNav, sections: Section[] }` will be the first nested list-of-records, and the form machinery should not be built in a way that assumes flatness.

**2. No `order` field.** The spec's Plan 2 row asks for `enabled`, `order` and `publishAt`. This plan implements `enabled` and `publishAt` but rejects `order`: an array plus an `order` field is two sources of truth for the same fact, which is how lists drift. The array's order *is* the order.

## Global Constraints

- **No visible change to the site.** Every page must render identically, string for string. This plan moves text; it does not rewrite it.
- **No component file is deleted.** Seven are protected and covered by a test: `AdminReservations.tsx`, `ReservationForm.tsx`, `ReservationPage.tsx`, `ChefGallery.tsx`, `NewsPress.tsx`, `SignatureMocktails.tsx`, `BlogsPage.tsx`. **Six of those seven are parked and unrendered — leave their strings alone. `BlogsPage.tsx` is protected but live, and its prose IS in scope.**
- **No restyling.** Tailwind classes on existing elements stay byte-identical.
- **No new runtime services.**
- **Asset paths never start with `/public/`.**
- **Content exports use a type annotation or a throwing runtime guard, never `as`.** `src/content/index.ts` is bundled into the browser: never `node:fs` or `import.meta.glob` there. Test files, build scripts and Vite plugins may use node APIs freely.
- **Brand colours stay:** `#6B8B59`, `#222`, `#F9F9F9`, `#FFFDF8`. **Fonts stay:** Parisienne, Montserrat, Open Sans.
- Work continues on branch `repair/phase-a`. Do not push to `main`.
- Commit after every task.

## The prose inventory

Ten rendered components. This is the complete set, corrected by review — an earlier version missed six entries and wrongly excluded two.

| Component | Strings |
|---|---|
| `NavBar` | Wordmark; five `NAV_LINKS` labels; `aria-label` "Follow Via Bianca on Instagram"; `aria-label` "Menu" |
| `Hero` | Logo "Via Bianca" / "Pastificio & Ristorante"; **the h1 and the tagline below it** (see Critical note); "For reservations"; "Reserve a Table" |
| `PlaceGallery` | "Atmosfera" |
| `FoodGallery` | "Hand-crafted Pastas & Wood-Fired Classics" |
| `Drinks` | "Drinks"; intro; three category headings |
| `BlogTeaser` | "Latest Stories"; intro; "Read Article"; "View All Stories" |
| `VisitUs` | "Visit Us"; "Navigate"; **the iframe `title`** |
| `Footer` | "Opening Hours"; `Follow&nbsp;Us:`; **"For Reservations:"**; **". All rights reserved."**; two social `aria-label`s |
| `BlogsPage` | "Via Bianca Stories"; "Press & Articles"; "All Stories"; intro; "← Back to Home"; "Previous"; "Next" |
| `NotFound` | "Page not found"; "Back to home" |

**`Hero`'s h1 and tagline are hardcoded, and an earlier version of this plan wrongly said they were not.** `Hero.tsx:50` is the literal `Via Bianca` and `:52` is the literal `Pastificio & Ristorante`. Only the strapline at `:59` reads from content. Change the h1 to `{site.name}` and the tagline to `{site.tagline}`.

Note the trap: `Hero.test.tsx:12` already asserts `h1s[0].textContent === site.name` — and it **passes today against the hardcoded literal**, because the literal happens to equal the content value. It is a test that cannot fail on this defect. It will keep passing after the fix, correctly, but do not take its green as evidence the work was done.

The logo-circle strings at `:42` and `:44` are separate and go to `copy.hero`.

**Deliberately out of scope, each for a reason:**

- **`OurStory`** — its prose already lives in `story.json`. Nothing to do. Listed so its absence does not read as an omission.
- **`ErrorBoundary`** — it renders when the app has crashed, quite possibly because the content layer threw. It must not import content. Its strings stay hardcoded and a comment must say why. The reason is stronger than "defensive style": `main.tsx` evaluates the whole import graph before `createRoot`, so a content module that throws at import never reaches the boundary at all.
- **Templated article strings** — `` `${article.publication} article about Via Bianca` `` and `` `Read full article: ${article.title}` `` in `BlogTeaser` and `BlogsPage`. `BlogsPage.test.tsx:28,46` pin the exact rendered string, so moving them breaks two tests for no user-visible gain. Leave them.
- **`SeoHead`'s `servesCuisine`, `priceRange` and `chef.name`** — structured data, not visible prose. Leave them; revisit if the founder ever needs to change the price range.

## File Structure

**Created:** `src/content/copy.json`, `src/content/sections.json`, `src/content/publish.ts`, `src/content/__tests__/copy.test.ts`, `src/content/__tests__/sections.test.tsx`, `src/content/__tests__/publish.test.ts`, `plugins/filter-unpublished.ts`, `plugins/__tests__/filter-unpublished.test.ts`

**Modified:** `src/content/types.ts`, `src/content/index.ts`, `src/App.tsx`, `vite.config.ts`, and the nine components with prose in scope.

---

### Task 1: The copy content file, and all ten components' simple strings

**Task 1 writes `copy.json` in full.** `Copy` is fully typed here, so a partial file fails `tsc`. Task 2 does not extend the file; it only rewires the remaining components to read from it.

**Files:**
- Create: `src/content/copy.json`, `src/content/__tests__/copy.test.ts`
- Modify: `src/content/types.ts`, `src/content/index.ts`, `src/components/PlaceGallery.tsx`, `FoodGallery.tsx`, `VisitUs.tsx`, `Footer.tsx`, `NavBar.tsx`

**Interfaces:**
- Produces: `copy` (typed `Copy`) and the exported guard `assertCopy(raw): Copy` from `src/content`.

- [ ] **Step 1: Define the shape**

In `src/content/types.ts`:

```ts
export interface NavLink {
  href: string;
  label: string;
}

export interface Copy {
  nav: { wordmark: string; links: NavLink[]; instagramLabel: string; menuLabel: string };
  hero: { logoName: string; logoTagline: string; reservationsLabel: string; reserveButton: string };
  atmosphere: { heading: string };
  food: { heading: string };
  drinks: { heading: string; intro: string; mocktails: string; cocktails: string; wine: string };
  press: { heading: string; intro: string; readArticle: string; viewAll: string };
  visit: { heading: string; navigateButton: string; mapTitle: string };
  footer: {
    hoursHeading: string; followLabel: string; reservationsLabel: string;
    rightsSuffix: string; instagramLabel: string; linkedinLabel: string;
  };
  blogsPage: { title: string; subtitle: string; heading: string; intro: string; back: string; previous: string; next: string };
  notFound: { heading: string; back: string };
}
```

One flat file rather than one per component: Plan 4's dashboard generates forms from this type, and a single nested object gives it a natural grouping without needing a registry.

- [ ] **Step 2: Write the failing tests**

`src/content/__tests__/copy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { copy, assertCopy } from '../index';

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

  it('has one nav link per anchor, all fragments', () => {
    expect(copy.nav.links.length).toBe(5);
    copy.nav.links.forEach((l) => expect(l.href).toMatch(/^#/));
  });
});

describe('assertCopy', () => {
  it('rejects a blank string, naming its path', () => {
    const bad = structuredClone(copy) as unknown as Record<string, Record<string, string>>;
    bad.atmosphere.heading = '   ';
    expect(() => assertCopy(bad)).toThrow(/atmosphere\.heading/);
  });

  it('rejects an empty nav link list', () => {
    const bad = structuredClone(copy) as unknown as { nav: { links: unknown[] } };
    bad.nav.links = [];
    expect(() => assertCopy(bad)).toThrow(/nav\.links/);
  });
});
```

Two things here are deliberate.

`expect(all.length).toBeGreaterThan(20)` is a non-vacuity guard. Without it, an empty `copy.json` makes `it.each` generate nothing and the file passes green. This project has caught **five** tests that passed on the bug they named. Do not remove it.

The `assertCopy` block exists because the `it.each` blank-string cases become unreachable once the guard is in place — the import throws before any test body runs. Testing the guard directly with a bad fixture is the only way that coverage stays real. This mirrors `site.test.ts`, which unit-tests `assertHours` with `days: []` and `'Xx'`.

Run: `npx vitest run src/content/__tests__/copy.test.ts`
Expected: FAIL, no `copy` export.

- [ ] **Step 3: Write copy.json by transcribing, not rewriting**

Read each component and copy its strings **exactly**. Do not improve wording, fix punctuation, or normalise the ampersand.

Three specific traps:

- **`Footer.tsx:66` is `Follow&nbsp;Us:`** with a literal non-breaking space entity. In JSON that must be `"Follow Us:"`. This is the only literal nbsp in scope; the hero's is generated by a `.replace()` and is not in scope.
- **`Footer`'s copyright is split** around `{site.copyrightYear}`. The suffix `. All rights reserved.` is the part that moves; the year keeps coming from `site`.
- The `NAV_LINKS` array already exists in `NavBar.tsx`. Move it verbatim. `tsconfig.app.json` sets `noUnusedLocals`, so a stranded const fails `tsc` rather than lingering — that is a help.

- [ ] **Step 4: Export it with a guard**

Follow `assertHours` in `src/content/index.ts`: an exported function taking the raw shape, returning the narrowed type, throwing with the offending path in the message.

Note what the guard is *for*. Unlike `Section.id`, every field in `Copy` is `string`, so a plain annotation type-checks fine and no narrowing dance is needed. The guard exists to reject **blank** strings and an empty `nav.links`, which types cannot express. Do not write a pointless cast-and-narrow.

Run: `npx vitest run src/content/__tests__/copy.test.ts`
Expected: PASS, including both `assertCopy` cases.

- [ ] **Step 5: Wire up five components**

`PlaceGallery`, `FoodGallery`, `VisitUs`, `Footer`, `NavBar`. One-for-one substitution. Keep every Tailwind class byte-identical.

**`Footer.test.tsx` will break, and this is expected.** It mocks the content module *partially* at lines 39-79 — `vi.doMock('../../content', () => ({ site: {…} }))` returns only `site`. The moment `Footer` imports `copy`, both LinkedIn tests throw `Cannot read properties of undefined`. Fix by switching that mock to the `importActual` spread pattern the same file uses elsewhere, so it stays a partial override rather than a replacement.

- [ ] **Step 6: Prove nothing moved**

```bash
npm run build && npx vitest run
```

Then check by eye. Build the previous commit in a separate worktree and compare screenshots at 375px and 1440px. Plan 1's Task 4 did exactly this and it worked; "no visible change" is this plan's central claim and a transcription typo is invisible to tests.

If you cannot drive a browser, say so plainly.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(content): move headings, labels and aria text into the content layer"
```

---

### Task 2: The prose-heavy components

`Hero`, `Drinks`, `BlogTeaser`, `BlogsPage`, `NotFound`. Multi-sentence intros, where transcription errors are easiest to make and hardest to see.

**Files:**
- Modify: `src/components/Hero.tsx`, `Drinks.tsx`, `BlogTeaser.tsx`, `BlogsPage.tsx`, `NotFound.tsx`
- Test: `src/components/__tests__/copy-rendered.test.tsx`

- [ ] **Step 1: Understand the whitespace trap before you transcribe**

The Drinks, BlogTeaser and BlogsPage intros span several source lines. **JSX collapses that whitespace at compile time**, so the rendered text is a single line with single spaces. Transcribing "exactly" from the source produces a JSON value containing newlines and indentation, which then renders differently.

Transcribe the **collapsed** form: join the lines with single spaces. Task 2's tests will catch it if you get this wrong, because Testing Library normalises the DOM text but not your matcher string — but knowing up front saves a confusing debug.

- [ ] **Step 2: Write the failing tests**

`src/components/__tests__/copy-rendered.test.tsx` renders each of the five and asserts its longest string appears. Use `MemoryRouter` where router context is needed.

```tsx
it('renders the drinks intro from content', () => {
  render(<Drinks />);
  expect(screen.getByText(copy.drinks.intro)).toBeInTheDocument();
});
```

Short labels are covered by Task 1's shape test; the intros are what break.

Run it and confirm each fails because the component still hardcodes the string, not because of a missing import.

- [ ] **Step 3: Substitute, including the Hero headline**

`Hero.tsx:50` becomes `{site.name}` and `:52` becomes `{site.tagline}`. The logo-circle strings go to `copy.hero`. The strapline at `:59` is already content-driven — leave it.

`BlogsPage`'s "← Back to Home" contains a literal arrow. Preserve it.

- [ ] **Step 4: Verify**

`npm run build`, full suite, and the visual comparison. Report what you observed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(content): move section intros and page copy into the content layer"
```

---

### Task 3: The homepage as an ordered, toggleable section list

**Files:**
- Create: `src/content/sections.json`, `src/content/__tests__/sections.test.tsx`
- Modify: `src/content/types.ts`, `src/content/index.ts`, `src/App.tsx`, `src/components/NavBar.tsx`

**Interfaces:**
- Produces: `sections` and the exported guard `assertSections(raw): Section[]`. Plan 4 reorders and toggles it; Plan 7 inserts template sections.

Note the test file is **`.tsx`** — it renders JSX, and esbuild's `.ts` loader parses `<MemoryRouter>` as a type assertion and errors.

- [ ] **Step 1: Define the shape**

```ts
export type SectionId =
  | 'hero' | 'ourStory' | 'atmosphere' | 'food' | 'drinks' | 'press' | 'visit';

export interface Section {
  id: SectionId;
  enabled: boolean;
}
```

Order is the array order. `nav` and `footer` are chrome and stay outside the list. `hero` is in the list so it can be reordered, but the guard rejects disabling it: a homepage with no hero is not a state worth supporting, and the founder disabling it by accident is worse than her being unable to.

- [ ] **Step 2: Make the nav follow the sections**

This is the Critical the review caught. The spec's D6 says a section she turns off "stops rendering **and disappears from the nav**". A static `copy.nav.links` means disabling Atmosfera leaves a nav link scrolling nowhere — and the founder would hit it the first time she used the headline feature of this plan.

Give each nav link the `SectionId` it points at, and render only links whose section is enabled:

```ts
export interface NavLink {
  href: string;
  label: string;
  section: SectionId;
}
```

Then `NavBar` filters `copy.nav.links` by the enabled set. Add a guard assertion that every nav link's `section` is a real `SectionId`, so a typo fails the build rather than silently hiding a link forever.

- [ ] **Step 3: Write the failing tests**

```tsx
describe('homepage sections', () => {
  it('renders every enabled section and no disabled one', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByText(copy.atmosphere.heading)).toBeInTheDocument();
  });

  it('omits a disabled section and its nav link', async () => {
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return {
        ...actual,
        sections: actual.sections.map((s) =>
          s.id === 'atmosphere' ? { ...s, enabled: false } : s),
      };
    });
    const { HomePage } = await import('../../App');
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.queryByText(copy.atmosphere.heading)).toBeNull();
    expect(screen.queryByRole('link', { name: copy.nav.links.find((l) => l.section === 'atmosphere')!.label })).toBeNull();
  });
});

afterEach(() => {
  vi.doUnmock('../../content');
  vi.resetModules();
});

describe('assertSections', () => {
  it('rejects a disabled hero', () => {
    const bad = sections.map((s) => (s.id === 'hero' ? { ...s, enabled: false } : s));
    expect(() => assertSections(bad)).toThrow(/hero/);
  });

  it('rejects a missing hero', () => {
    expect(() => assertSections(sections.filter((s) => s.id !== 'hero'))).toThrow(/hero/);
  });

  it('rejects a duplicate id', () => {
    expect(() => assertSections([...sections, { id: 'food', enabled: true }])).toThrow(/food/);
  });
});
```

Three things the review corrected here.

The second test is the one that matters: without it, "renders every enabled section" is satisfied by a component that ignores the flag entirely. Mock the module rather than editing the JSON, so the test does not depend on what happens to be enabled today. Note `copy` here is the real import, not a mocked alias.

The `assertSections` block exists because a test asserting `sections.json` has the hero enabled cannot fail — the author writes that file. Only a bad fixture tests the guard, and the guard is in the Definition of Done.

`afterEach` with `doUnmock` prevents the mock leaking, the way `Footer.test.tsx` already does.

- [ ] **Step 4: Render from the list, with an exhaustive dispatch**

Export `HomePage` from `App.tsx` (it currently is not; `AppRoutes` already is) so tests can render it without nesting routers.

Type the dispatch map `Record<SectionId, () => ReactNode>`. That makes `tsc` enforce exhaustiveness — otherwise dropping a case leaves the suite green while a section silently vanishes, which the review flagged as a real hole in an earlier version.

The wrapper `<div className="min-h-screen">` stays byte-identical.

- [ ] **Step 5: Prove it against fixtures, not the real file**

Do **not** edit `sections.json` and rely on remembering to revert. This plan commits with `git add -A`; an interrupted toggle commits a disabled hero, and a disabled hero throws at import — which `ErrorBoundary` cannot catch, because `main.tsx` evaluates the import graph before `createRoot`. The result is a white page.

The tests in Step 3 already prove both directions against fixtures. If you want an end-to-end check as well, run `git diff --exit-code src/content` before committing and treat a non-empty diff as a failure.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(content): render the homepage and nav from an ordered section list"
```

---

### Task 4: Scheduling, filtered at build time

**This task was rewritten after review.** An earlier version filtered inside `src/content/index.ts` and claimed that was build-time. It is not: that module is bundled into the browser, so the filter would run in the visitor's browser and the unpublished content would ship inside the JavaScript — exactly what the spec's D9 rejects. The reviewer confirmed it against the real artifact, finding dish names inlined in `dist/assets/index-*.js`.

The filter must run in the build.

**Files:**
- Create: `src/content/publish.ts`, `src/content/__tests__/publish.test.ts`, `plugins/filter-unpublished.ts`, `plugins/__tests__/filter-unpublished.test.ts`
- Modify: `src/content/types.ts`, `vite.config.ts`, `src/content/__tests__/shape.test.ts`

- [ ] **Step 1: Define the field**

Add `publishAt?: string` — an ISO `YYYY-MM-DD` date — to `Dish`, `Drink` and `Article`.

**Not to `Section`.** The review found an unspecified interaction: a future-dated hero is either a hard build failure or a silently heroless homepage, depending on whether the guard or the filter runs first. Sections have `enabled`, which covers the founder's actual need. Have `assertSections` reject a `publishAt` key outright so the ambiguity cannot arise.

- [ ] **Step 2: Write the failing tests for the pure function**

`src/content/publish.ts` exports `isPublished(item: { publishAt?: string }, today: string): boolean`, where `today` is an ISO date string.

```ts
describe('isPublished', () => {
  it('publishes an item with no date', () => {
    expect(isPublished({}, '2026-08-02')).toBe(true);
  });

  it('publishes an item dated today', () => {
    expect(isPublished({ publishAt: '2026-08-02' }, '2026-08-02')).toBe(true);
  });

  it('publishes an item dated in the past', () => {
    expect(isPublished({ publishAt: '2026-07-01' }, '2026-08-02')).toBe(true);
  });

  it('withholds an item dated in the future', () => {
    expect(isPublished({ publishAt: '2026-09-01' }, '2026-08-02')).toBe(false);
  });

  it('rejects a malformed date rather than guessing', () => {
    expect(() => isPublished({ publishAt: 'next tuesday' }, '2026-08-02')).toThrow();
  });

  it('rejects a date that looks valid but is not', () => {
    expect(() => isPublished({ publishAt: '2026-02-30' }, '2026-08-02')).toThrow();
  });
});
```

Four deliberate choices.

**Compare ISO strings, not `Date` objects.** Lexicographic comparison of `YYYY-MM-DD` is exact and removes every timezone and parsing quirk in one move.

**Take `today` as a string parameter.** A function that reads the clock internally cannot be tested at the boundary without stubbing globals, and the boundary is the only interesting part.

**"Dated today" publishes.** She means "live on this date", not "the day after".

**Throwing on a malformed date is right, but only because of where it runs.** In the build, a typo fails the deploy and the last good build stays live — which satisfies the spec's Goal 3. Had this run in the browser, the same throw would produce a white page that `ErrorBoundary` cannot catch. That asymmetry is the second and stronger reason the filter belongs in the build.

- [ ] **Step 3: Write the Vite plugin**

`plugins/filter-unpublished.ts`, applied **`apply: 'build'` only**, transforming `src/content/{dishes,drinks,press}.json`.

`apply: 'build'` is not incidental. It means the dev server and Vitest import unfiltered JSON, so **the deploy gate never depends on the wall clock**. That matters: the gate is what stands between the founder and a broken site, and a clock-dependent suite means an unrelated edit could be blocked by a date boundary crossing overnight.

Resolve "today" in **`Asia/Kolkata`**, not the build machine's timezone. Cloudflare builds in UTC and the restaurant is in Delhi; under a UTC comparison a build at 23:00 UTC on the 1st — which is 04:30 on the 2nd in Delhi — would still withhold content dated the 2nd.

State plainly in a comment that publish granularity is the Plan 3 cron cadence, not midnight, so nobody promises the founder otherwise.

- [ ] **Step 4: Test the plugin against fixtures**

Unit-test the transform directly with a fixture containing one past-dated and one future-dated item. Assert the future one is absent from the output and the past one is present.

This is the coverage that matters, because the plugin never runs during the test suite.

- [ ] **Step 5: Guard the date format where it fails a deploy**

Add to `shape.test.ts`: every `publishAt` in every content JSON matches `/^\d{4}-\d{2}-\d{2}$/` **and** round-trips through `Date` so `2026-02-30` is caught.

This gives the founder a named field in a failed-deploy report rather than a mystery.

- [ ] **Step 6: Check what the filtering would break, naming the real tests**

An earlier version of this plan claimed existing tests assert `press` has 12 articles and `drinks` has 38. **That is false** — every count assertion in the suite is self-referential (`toHaveLength(dishes.length)`) and therefore immune.

The genuinely date-sensitive tests, if filtering ever reached the test path, are:

- `BlogsPage.test.tsx:15-19,33-37` — pins two article ids and throws `Fixture assumption broken` if either disappears.
- `Drinks.test.tsx:14-19` — `getByRole('heading', { name: 'Wine' })` fails if every wine were future-dated, because `Drinks.tsx:39` returns `null` for an empty category.
- `shape.test.ts:87-102` — "has at least one dish/drink/press".

With `apply: 'build'` none of these are reachable from the suite. Confirm that is still true after your change rather than assuming it.

- [ ] **Step 7: Prove the content is genuinely not shipped**

Temporarily set a future `publishAt` on one dish. Build. Then:

```bash
grep -r "Gamberi" dist/assets/ | wc -l
```

Expected: `0`. Revert and confirm it returns to non-zero.

That grep is the real proof. A shorter array proves the filter ran; an absent string proves the content is not in the bundle, which is the entire point of doing this in the build.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(content): filter future-dated content out of the build"
```

---

## Definition of done

- [ ] `npm run build` exits 0; `npx vitest run` green. Record the count.
- [ ] Every string in the prose inventory reads from the content layer.
- [ ] The site renders identically, verified against the previous commit at 375px and 1440px. If no browser was available, say so.
- [ ] Disabling a homepage section removes both the section **and its nav link**, proven by the mocked test.
- [ ] `assertCopy` and `assertSections` are exported and unit-tested with bad fixtures.
- [ ] The hero cannot be disabled or given a `publishAt`; the guard throws with a readable message.
- [ ] A future-dated dish is absent from `dist/assets/`, verified by grep.
- [ ] `git diff --exit-code src/content` is clean before each commit.
- [ ] No rendered component holds a visible string, apart from `ErrorBoundary`, which is excluded and says why in a comment.

## Handed to later plans

- **The page model** — Plan 7, with the templates that populate it. Warning for Plan 4's author: every type the dashboard generates forms from today is a flat record. `Page { slug, name, inNav, sections: Section[] }` will be the first nested list-of-records; do not build the form machinery assuming flatness.
- **Editing all of this** — Plans 4 and 5.
- **`.gitignore`'s eight explicit paths** — carried from Plan 1. If Plan 3's upload UI lets the founder create a new asset category, its derivatives will not be auto-ignored and a later `git add -A` would commit generated files. Prerequisite for Plan 3.
- **The WhatsApp conversion count** — Plan 3, server-side in the Worker.
