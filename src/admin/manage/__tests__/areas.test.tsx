// The completeness pin for the ten -> five regrouping, and the cheapest
// guard in this whole piece of work.
//
// Written BEFORE the 1300-line move, against the dashboard as it stands
// today, and asserted unchanged after it. Two distinct failures it catches:
//
//  1. A panel silently DROPPED (or duplicated) while its implementation is
//     carried into an area module. `AREAS` says which panels exist; the
//     render below says which ones the dashboard actually mounts. Neither on
//     its own is evidence. Thirteen now, not ten -- Phase 2, Task 11 added
//     `awards` and Phase 3, Task 8 added `experiences` to the `pages` area,
//     and Phase 5B, Task 3 added `posts` to the `story` area, none of them
//     touching the five-area shape this file's own title names.
//  2. A panel id silently RENAMED. `open-sections.ts` builds its
//     localStorage key as `vb:section-open:v1:<id>`, and
//     `CollapsibleSection` publishes that id as `aria-controls`
//     (`section-panel-<id>`), so reading the rendered `aria-controls` values
//     is a direct pin on the stored-state key. A `dishes` -> `menu-dishes`
//     rename would otherwise forget every remembered fold with nothing red.
//
// It deliberately does NOT depend on e2e/dashboard-sections.spec.ts, which
// is the only other place those ids are covered end to end and which this
// work rewrites.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminApp from '../../AdminApp';
import { AREAS, PANELS, areaForFile, findArea, panelForFile, slugFromPathname } from '../areas';
import type { PanelId } from '../areas';
import { CONTENT_FILES, CONTENT_FILE_LABELS } from '../../content';

// The twelve ids, spelled out as a literal rather than derived from `PANELS` --
// deriving both sides of an equality from the same constant asserts nothing.
// This list is what the dashboard renders, and the stored fold state on every
// device she has ever used is keyed on it.
//
// Backlog item 17: 'press' was the thirteenth and is gone. It edited
// press.json, which the blog superseded and which nothing a visitor can reach
// has rendered since -- so the panel offered her an afternoon's work with no
// effect on her site. A stored fold entry for it is simply never read again
// (open-sections.ts reads by id and ignores what it does not know).
const EXPECTED_PANEL_IDS = [
  'dishes',
  'drinks',
  'sections',
  'pages',
  'hours',
  'menus',
  'galleries',
  'story',
  'copy',
  // Phase 2, Task 11: the eleventh panel.
  'awards',
  // Phase 3, Task 8: the twelfth panel.
  'experiences',
  // Phase 5B, Task 3: the thirteenth panel. Registered together with
  // posts.json in CONTENT_FILES, because the two assertions below require
  // each other -- see the plan's conflict scan row C2.
  'posts',
];

// Every panel below renders its heading and its `aria-controls` panel id in
// EVERY load state, including the failed one (AdminApp's sections each
// render a `role="alert"` line inside the fold, never instead of it). So the
// cheapest possible backend for this test is one that answers the session
// probe and refuses every content file: the ids are the subject, the content
// is not.
function stubFetchFailingContent(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/wa') {
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('nope', { status: 500 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('AREAS covers every dashboard panel exactly once', () => {
  it('is five areas with unique slugs', () => {
    expect(AREAS).toHaveLength(5);
    expect(new Set(AREAS.map((a) => a.slug)).size).toBe(5);
  });

  it('every panel id appears in exactly one area', () => {
    const placed = AREAS.flatMap((area) => area.panelIds);
    expect([...placed].sort()).toEqual([...EXPECTED_PANEL_IDS].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('every area has a label and a one-line description', () => {
    AREAS.forEach((area) => {
      expect(area.label.length).toBeGreaterThan(0);
      expect(area.description.length).toBeGreaterThan(0);
    });
  });

  // The in-gate tripwire for the phone home list's height budget. Every
  // description above renders under its label on the 390px home list, where
  // e2e/dashboard-sections.spec.ts:430 requires all five rows to fit one 844px
  // screen without scrolling -- and that spec is the ONLY enforcement, sitting
  // outside `npm run gate`, so a reword lands green here and fails at Task 12
  // for a reason the diff does not explain. It has already happened once:
  // Phase 5B, Task 3's first wording of the `story` description ran to 57
  // characters, wrapped to a third line, and pushed the Numbers row to 854px.
  //
  // ASSERTED ON THE TOTAL, not per area, and that is the whole reason this
  // case exists as its own thing. The review suggested a per-area bound of 48
  // beside the `length > 0` check above; measured, it is red on the CURRENT
  // tree -- `pages` is 55 characters and `details` is 61, and both of them fit
  // today. A per-area bound loose enough to admit those (61) also admits the
  // 57-character string that broke the fold, so it would catch nothing. What
  // the viewport actually constrains is the SUM of five wrapped row heights,
  // and the sum of the five lengths is the cheap proxy for that.
  //
  // The bound was the current total exactly when this test was written,
  // because the screen was at its budget: 844px held what was there and
  // nothing more. The `story` description has since been shortened, leaving
  // 7 characters of slack under the bound today -- the bound was not lowered
  // to match, so it no longer proves the screen is at capacity, only that it
  // is within it. Growth is still not free -- pay for it by shortening
  // another description, or re-measure with that spec and move this number
  // in the same commit.
  //
  // What it does NOT catch, stated rather than implied: lengthening one
  // description and shortening another by the same count leaves the total
  // unchanged while moving where the rows wrap. Characters are a proxy. The
  // browser measurement remains the real guard; this one catches the reword
  // nobody thinks to re-measure.
  it('the five area descriptions still fit the 390px home list, by total length', () => {
    const total = AREAS.reduce((sum, area) => sum + area.description.length, 0);
    expect(total).toBeLessThanOrEqual(244);
  });

  it('every panel names a real content file, and every content file has a panel', () => {
    const files = EXPECTED_PANEL_IDS.map((id) => PANELS[id as PanelId].file);
    expect([...files].sort()).toEqual([...CONTENT_FILES].sort());
  });

  // The Posts panel goes in "Story & Photos", last. It is the same kind of
  // thing to her as the press coverage that used to sit beside it -- words
  // about the restaurant -- and a sixth area for one panel would split one
  // idea into two doors, the same reasoning that put Awards inside "Pages"
  // rather than beside it.
  it('the Posts panel is the last one in Story & Photos', () => {
    expect(findArea('story')?.panelIds).toEqual(['galleries', 'story', 'posts']);
  });

  it('maps a content file back to the area and panel that edits it', () => {
    expect(areaForFile('site.json')?.slug).toBe('details');
    expect(panelForFile('site.json')?.id).toBe('hours');
    expect(areaForFile('dishes.json')?.slug).toBe('menu');
    expect(panelForFile('copy.json')?.heading).toBe('Words on the site');
  });
});

// Its own describe: neither case below is about AREAS covering every panel
// once, and both are about the same narrow question -- what makes
// `PANELS[id].heading` load-bearing rather than decorative.
//
// The history matters, because three answers have been recorded and the first
// two were wrong. The ledger said the constant had "no production reader".
// A later measurement corrected that to "pinned by panel-snapshots.test.tsx
// and owner-facing-labels.test.tsx", which is true only for a panel whose area
// component paints a LITERAL <h2>: both files open a panel with
// `findByRole('button', { name: heading })`, reading `heading` from PANELS, so
// a rename moves the query away from the DOM string and the toggle is never
// found. Those files fail at a toggle lookup, not at any assertion about a
// heading.
//
// PostsArea reads the constant, so both sides of that lookup move together and
// neither file notices. Reading the constant is what REMOVED the accidental
// coverage that literal-painting gave -- the design change meant to make the
// constant load-bearing is what unpinned it. These two cases are what make the
// claim true instead of ironic.
describe('PANELS.heading is load-bearing, not decoration', () => {
  // A SOURCE-level pin, and it says so rather than pretending to be a
  // behavioural one. Nothing rendered can prove it: the literal `"Posts"` and
  // the constant hold the SAME string, so every DOM assertion passes
  // identically under both -- confirmed by running exactly that mutation
  // (Step 8 #4). Reading the file is the only assertion that can tell two
  // identical strings apart. `src/admin/__tests__/content.test.ts` already
  // reads source in this suite, including its own `git ls-files` shell-out, so
  // both the precedent and the repo-root cwd it depends on are established.
  //
  // Matched as a REGEX over the JSX attribute, not `toContain('heading="Posts"')`
  // -- review finding: a bare substring misses `heading={'Posts'}`, the form a
  // prettier pass or a copy-paste from a sibling could just as easily produce,
  // and it would false-red if that exact text ever appeared in a comment in
  // this file. Anchoring on `heading=` covers both spellings and cannot match
  // prose.
  it('PostsArea paints its heading from PANELS, not a literal of its own', () => {
    const source = readFileSync('src/admin/areas/PostsArea.tsx', 'utf8');
    expect(source).toContain('PANELS.posts.heading');
    expect(source).not.toMatch(/heading=(?:["']Posts["']|\{\s*["']Posts["']\s*\})/);
  });

  // content.ts's own comment on CONTENT_FILE_LABELS states this as a fact --
  // "Every string here is the heading the dashboard already uses for the panel
  // that owns that file" -- so that the publish confirmation, the status strip
  // and the undo description name the same things the panels do rather than
  // inventing a second vocabulary. Nothing asserted it. Two hand-maintained
  // constants that must agree, in two different modules, is exactly the shape
  // that drifts, and this repo has already shipped the half-done version of it
  // once ("Our Story" renamed to "About" in some places and not others, which
  // is why owner-facing-labels.test.tsx exists at all).
  //
  // It is also the only thing in `npm run gate` that pins a panel HEADING's
  // value. panel-snapshots.test.tsx looks like it does, and does not: the
  // heading is part of its own test NAME, so a rename moves the snapshot KEY
  // and vitest writes the new one rather than comparing -- green locally, red
  // only under CI, where writing is refused, and `npm run gate` never sets CI.
  // Verified by running exactly that mutation (Step 8 #3):
  // `PANELS.posts.heading` -> 'Postz' left all 83 cases in the four candidate
  // files green, and failed only with CI=true.
  //
  // ACCEPTED RESIDUAL, recorded so nobody re-litigates it: this is a
  // cross-constant equality, so renaming BOTH constants together stays green.
  // That is the deliberate case, not the accidental one -- nobody edits two
  // modules by mistake -- and the realistic failure is the half-done rename,
  // which this catches. Closing it would need a third hand-typed copy of the
  // owner's vocabulary in this file, making every deliberate reword a
  // three-file change; deriving either constant from the other would instead
  // make the assertion tautological. Neither trade is worth it.
  it('every panel heading is the same word CONTENT_FILE_LABELS gives its file', () => {
    (Object.keys(PANELS) as PanelId[]).forEach((id) => {
      expect(PANELS[id].heading).toBe(CONTENT_FILE_LABELS[PANELS[id].file]);
    });
  });
});

describe('slugFromPathname', () => {
  it.each([
    ['/edit/manage', ''],
    ['/edit/manage/', ''],
    ['/edit/manage/menu', 'menu'],
    ['/edit/manage/menu/', 'menu'],
    ['/edit/manage/numbers', 'numbers'],
    ['/edit/manage/not-a-thing', 'not-a-thing'],
  ])('%s -> %s', (pathname, expected) => {
    expect(slugFromPathname(pathname)).toBe(expected);
  });

  it('an unknown slug matches no area, so the shell can say so rather than redirect', () => {
    expect(findArea('not-a-thing')).toBeUndefined();
    expect(findArea('menu')?.label).toBe('Menu');
  });
});

describe('the dashboard renders exactly the twelve frozen panel ids', () => {
  it('every aria-controls value is section-panel-<id>, for those twelve ids and no others', async () => {
    stubFetchFailingContent();
    const { container } = render(
      <MemoryRouter initialEntries={['/edit/manage']}>
        <AdminApp />
      </MemoryRouter>,
    );

    // The session probe resolves a tick after render; without waiting, the
    // query below runs against the "checking" screen and finds nothing --
    // which would pass an assertion written the wrong way round and prove
    // nothing at all.
    await waitFor(() => {
      expect(container.querySelectorAll('[aria-controls^="section-panel-"]').length).toBeGreaterThan(0);
    });

    const rendered = Array.from(container.querySelectorAll('[aria-controls^="section-panel-"]')).map((el) =>
      (el.getAttribute('aria-controls') ?? '').replace('section-panel-', ''),
    );

    expect([...rendered].sort()).toEqual([...EXPECTED_PANEL_IDS].sort());
    // And each one really is the id of a panel AREAS claims to place.
    const placed = AREAS.flatMap((area) => area.panelIds);
    expect([...rendered].sort()).toEqual([...placed].sort());
  });
});
