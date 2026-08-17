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

// The thirteen ids, spelled out as a literal rather than derived from `PANELS` --
// deriving both sides of an equality from the same constant asserts nothing.
// This list is what the dashboard has rendered since folding landed, and the
// stored fold state on every device she has ever used is keyed on it.
const EXPECTED_PANEL_IDS = [
  'dishes',
  'drinks',
  'press',
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

  it('every panel names a real content file, and every content file has a panel', () => {
    const files = EXPECTED_PANEL_IDS.map((id) => PANELS[id as PanelId].file);
    expect([...files].sort()).toEqual([...CONTENT_FILES].sort());
  });

  // The Posts panel goes in "Story & Photos", after Press. It is the same
  // kind of thing to her as press coverage is -- words about the restaurant
  // -- and a sixth area for one panel would split one idea into two doors,
  // the same reasoning that put Awards inside "Pages" rather than beside it.
  it('the Posts panel is the last one in Story & Photos', () => {
    expect(findArea('story')?.panelIds).toEqual(['galleries', 'story', 'press', 'posts']);
  });

  // A SOURCE-level pin, and it says so rather than pretending to be a
  // behavioural one. `PostsArea.tsx` is the first panel in this dashboard to
  // paint its heading from `PANELS.posts.heading` instead of a literal, which
  // is what finally gives that constant a reader whose change she can see.
  // Nothing rendered can prove it: the literal `"Posts"` and the constant
  // hold the SAME string, so every DOM assertion passes identically under
  // both -- confirmed by running exactly that mutation (Step 8 #4). Reading
  // the file is the only assertion that can tell two identical strings apart.
  // `src/admin/__tests__/content.test.ts` already reads source in this suite,
  // so this is a precedent rather than a new kind of test.
  it('PostsArea paints its heading from PANELS, not a literal of its own', () => {
    const source = readFileSync('src/admin/areas/PostsArea.tsx', 'utf8');
    expect(source).toContain('PANELS.posts.heading');
    expect(source).not.toContain('heading="Posts"');
  });

  // content.ts's own comment on CONTENT_FILE_LABELS states this as a fact --
  // "Every string here is the heading the dashboard already uses for the panel
  // that owns that file" -- so that the publish confirmation, the status strip
  // and the undo description name the same things the panels do rather than
  // inventing a second vocabulary. Nothing asserted it. Two hand-maintained
  // constants that must agree, in two different modules, is exactly the shape
  // that drifts.
  //
  // It is also the only thing in `npm run gate` that pins a panel HEADING's
  // value. panel-snapshots.test.tsx looks like it does, and does not: the
  // heading is part of its own test NAME, so a rename moves the snapshot KEY
  // and vitest writes the new one rather than comparing -- green locally, red
  // only under CI, where writing is refused. Verified by running exactly that
  // mutation (Step 8 #3): `PANELS.posts.heading` -> 'Postz' left all 83 cases
  // in the four candidate files green, and failed only with CI=true.
  it('every panel heading is the same word CONTENT_FILE_LABELS gives its file', () => {
    (Object.keys(PANELS) as PanelId[]).forEach((id) => {
      expect(PANELS[id].heading).toBe(CONTENT_FILE_LABELS[PANELS[id].file]);
    });
  });

  it('maps a content file back to the area and panel that edits it', () => {
    expect(areaForFile('site.json')?.slug).toBe('details');
    expect(panelForFile('site.json')?.id).toBe('hours');
    expect(areaForFile('dishes.json')?.slug).toBe('menu');
    expect(panelForFile('copy.json')?.heading).toBe('Words on the site');
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

describe('the dashboard renders exactly the thirteen frozen panel ids', () => {
  it('every aria-controls value is section-panel-<id>, for those thirteen ids and no others', async () => {
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
