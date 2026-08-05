import { describe, it, expect } from 'vitest';
import { pages, assertPages } from '../index';

// Plan 7, Task 1: pages.json is the tenth content file. It shipped empty --
// Plan 8 was expected to author the real pages, and was thought to be
// blocked on the founder for copy and photography.
//
// It was not, in the end: four of Phase C's six business lines (catering,
// cheeseboards, the Sunday cooking class and the membership booklet) had
// complete detail already, and the owner asked for each to be its OWN page
// reached from the nav rather than another block on the homepage. So the
// file now carries six real pages -- four live and in the nav, two
// (breads-and-dips, who-we-supply) `enabled: false` because their lists are
// still outstanding, which is the same "disabled by construction" posture
// an empty file had.
//
// This test therefore stopped asserting emptiness, which had become a pin on
// a decision that no longer held, and asserts the properties that actually
// matter about whatever the file holds: it parses through the real guard,
// every page is well-formed, and a disabled page is never in the nav.
describe('pages.json', () => {
  it('the real file parses through assertPages without throwing', () => {
    expect(() => assertPages(pages)).not.toThrow();
    expect(pages.length).toBeGreaterThan(0);
  });

  // Every field PageSeoHead and NavBar actually read, on every page in the
  // real file -- so a hand-edit that drops a title, or leaves a page linked
  // from the nav while disabled, fails here rather than at a visitor's
  // browser. `inNav && enabled` is exactly NavBar.tsx's own filter.
  it('every page carries the metadata the router and the nav depend on', () => {
    for (const page of pages) {
      expect(page.slug, `slug on ${page.name}`).toMatch(/^[a-z]([a-z0-9-]*[a-z0-9])?$/);
      expect(page.name.trim().length, `name on ${page.slug}`).toBeGreaterThan(0);
      expect(page.seo.title.trim().length, `seo.title on ${page.slug}`).toBeGreaterThan(0);
      expect(page.seo.description.trim().length, `seo.description on ${page.slug}`).toBeGreaterThan(0);
      expect(page.sections.length, `sections on ${page.slug}`).toBeGreaterThan(0);
      if (page.inNav) expect(page.enabled, `${page.slug} is in the nav but disabled`).toBe(true);
    }
  });

  it('no two pages share a slug', () => {
    const slugs = pages.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('assertPages is re-exported from ./index, the same as assertSections/assertCopy/assertHours', () => {
    expect(typeof assertPages).toBe('function');
    expect(assertPages([])).toEqual([]);
  });

  // A real, end-to-end round trip through the real guard -- not the
  // synthetic fixtures guards.test.ts already covers assertPages with in
  // isolation -- proving a page built the way the dashboard (Task 4) or a
  // hand-edit would actually shape one survives the exact function
  // src/content/index.ts calls at import time.
  it('a well-formed page with a template section round-trips through assertPages unchanged', () => {
    const page = {
      slug: 'breads-and-dips',
      name: 'Breads & Dips',
      inNav: true,
      enabled: false,
      seo: { title: 'Breads & Dips | Via Bianca', description: 'Our breads and dips menu.' },
      sections: [
        {
          kind: 'template' as const,
          id: 'intro',
          enabled: true,
          template: 'text' as const,
          content: { heading: 'Breads & Dips', paragraphs: ['Baked fresh daily.'] },
        },
      ],
    };
    expect(assertPages([page])).toEqual([page]);
  });

  it('rejects a page slugged "edit" -- it would shadow the dashboard route', () => {
    const page = { slug: 'edit', name: 'X', inNav: true, enabled: true, sections: [] };
    expect(() => assertPages([page])).toThrow(/collides with an existing route/);
  });
});
