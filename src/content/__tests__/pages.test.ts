import { describe, it, expect } from 'vitest';
import { pages, assertPages } from '../index';

// Plan 7, Task 1: pages.json is the tenth content file, and -- unlike every
// other file under src/content/ -- starts genuinely empty. Recorded
// decision (see Page's own comment, types.ts): Plan 8 (Phase C content) is
// what actually authors real pages, and it is blocked on the founder for
// the photography and copy those pages would need. Shipping a fake example
// page here risks looking like a real, live page to anyone reading the
// committed content, and an empty list is already exactly the "disabled by
// construction" posture every template section itself ships in (Task 2).
describe('pages.json', () => {
  it('starts empty, and the real file parses through assertPages without throwing', () => {
    expect(pages).toEqual([]);
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
