// The completeness pin for the ten -> five regrouping, and the cheapest
// guard in this whole piece of work.
//
// Written BEFORE the 1300-line move, against the dashboard as it stands
// today, and asserted unchanged after it. Two distinct failures it catches:
//
//  1. A panel silently DROPPED (or duplicated) while its implementation is
//     carried into an area module. `AREAS` says which panels exist; the
//     render below says which ones the dashboard actually mounts. Neither on
//     its own is evidence. Eleven now, not ten -- Phase 2, Task 11 added
//     `awards` to the `pages` area without touching the five-area shape this
//     file's own title names.
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
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminApp from '../../AdminApp';
import { AREAS, PANELS, areaForFile, findArea, panelForFile, slugFromPathname } from '../areas';
import type { PanelId } from '../areas';
import { CONTENT_FILES } from '../../content';

// The eleven ids, spelled out as a literal rather than derived from `PANELS` --
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

describe('the dashboard renders exactly the eleven frozen panel ids', () => {
  it('every aria-controls value is section-panel-<id>, for those eleven ids and no others', async () => {
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
