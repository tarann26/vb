import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('guards module', () => {
  it('imports no JSON, so a Worker can use it', () => {
    // `import.meta.url` is routed through a variable rather than passed as a
    // literal second argument to `new URL(...)`: Vite's import-analysis
    // plugin statically recognizes the exact syntactic pattern
    // `new URL('literal', import.meta.url)` as its asset-URL-import feature
    // and rewrites the base to the dev-server origin (`http://localhost:3000/`)
    // instead of leaving it a `file:` URL -- confirmed directly, `readFileSync`
    // then throws "The URL must be of scheme file". Assigning `import.meta.url`
    // to `metaUrl` first (so the call site no longer matches that pattern)
    // sidesteps the rewrite and resolves to the real file on disk.
    const metaUrl = import.meta.url;
    const source = readFileSync(new URL('../guards.ts', metaUrl), 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/[a-z-]+\.json['"]/);
  });

  it('accepts a valid copy fixture and rejects a blank string in it', async () => {
    const { assertCopy } = await import('../guards');
    const valid = {
      nav: {
        wordmark: 'Via Bianca',
        links: [{ section: 'hero', label: 'Home', href: '#a' }],
        instagramLabel: 'Follow Via Bianca on Instagram',
        menuLabel: 'Menu',
      },
      hero: {
        logoName: 'Via Bianca',
        logoTagline: 'Pastificio & Ristorante',
        reservationsLabel: 'For reservations',
        reserveButton: 'Reserve a Table',
      },
      atmosphere: { heading: 'Atmosfera' },
      food: { heading: 'Hand-crafted Pastas' },
      drinks: {
        heading: 'Drinks',
        intro: 'Our bar pours a full Italian programme.',
      },
      press: {
        heading: 'Latest Stories',
        intro: 'Discover what critics are saying.',
        readArticle: 'Read Article',
        viewAll: 'View All Stories',
      },
      visit: { heading: 'Visit Us', navigateButton: 'Navigate', mapTitle: 'Via Bianca Location' },
      footer: {
        hoursHeading: 'Opening Hours',
        followLabel: 'Follow Us:',
        reservationsLabel: 'For Reservations:',
        rightsSuffix: '. All rights reserved.',
        instagramLabel: 'Follow Via Bianca on Instagram',
        linkedinLabel: 'Connect with Via Bianca on LinkedIn',
      },
      blogsPage: {
        title: 'Via Bianca Stories',
        subtitle: 'News and press',
        heading: 'Stories',
        intro: 'Read the latest.',
        back: 'Back',
        previous: 'Previous',
        next: 'Next',
      },
      notFound: { heading: 'Page not found', back: 'Back to home' },
    };
    expect(() => assertCopy(valid)).not.toThrow();
    expect(() => assertCopy({ ...valid, nav: { ...valid.nav, wordmark: '   ' } }))
      .toThrow(/nav\.wordmark/);
  });

  it('accepts a valid drink category and rejects an unknown one', async () => {
    const { assertDrinkCategory } = await import('../guards');
    expect(assertDrinkCategory({ id: 'aperol-spritz', category: 'cocktail' }, 0)).toBe('cocktail');
    expect(() => assertDrinkCategory({ id: 'aperol-spritz', category: 'soda' }, 0)).toThrow(
      /invalid category "soda"/,
    );
  });
});

// ---------------------------------------------------------------------------
// Plan 7, Task 1: assertSections/assertPages both now parse a discriminated
// Section union (bespoke | template) through the same shared entry parser.
// isTemplateType (TEMPLATE_TYPE_SET's own runtime backstop) and the
// per-template content shape checks are exercised indirectly through
// assertSections/assertPages -- the same "test the public guard, not a
// private helper" posture this file already takes toward assertCopy/
// assertDrinkCategory above.
describe('template sections (Plan 7)', () => {
  const BESPOKE_NINE = [
    { kind: 'bespoke', id: 'hero', enabled: true },
    { kind: 'bespoke', id: 'ourStory', enabled: true },
    { kind: 'bespoke', id: 'atmosphere', enabled: true },
    { kind: 'bespoke', id: 'food', enabled: true },
    { kind: 'bespoke', id: 'drinks', enabled: true },
    { kind: 'bespoke', id: 'experiences', enabled: true },
    { kind: 'bespoke', id: 'press', enabled: true },
    { kind: 'bespoke', id: 'awards', enabled: true },
    { kind: 'bespoke', id: 'visit', enabled: true },
  ];

  const VALID_TEXT_TEMPLATE = {
    kind: 'template',
    id: 'membership',
    enabled: true,
    template: 'text',
    content: { heading: 'Join Us', paragraphs: ['Membership has its privileges.'] },
  };

  it('accepts a homepage with the nine bespoke sections plus one valid template section', async () => {
    const { assertSections } = await import('../guards');
    const result = assertSections([...BESPOKE_NINE, VALID_TEXT_TEMPLATE]);
    expect(result).toHaveLength(10);
    expect(result[9]).toEqual(VALID_TEXT_TEMPLATE);
  });

  it('rejects a template section id colliding with a built-in SectionId', async () => {
    const { assertSections } = await import('../guards');
    const colliding = { ...VALID_TEXT_TEMPLATE, id: 'food' };
    expect(() => assertSections([...BESPOKE_NINE, colliding])).toThrow(/food.*collides with a built-in section/);
  });

  it('rejects two template sections sharing an id', async () => {
    const { assertSections } = await import('../guards');
    expect(() =>
      assertSections([...BESPOKE_NINE, VALID_TEXT_TEMPLATE, VALID_TEXT_TEMPLATE]),
    ).toThrow(/duplicate section id "membership"/);
  });

  it('rejects an unknown template type', async () => {
    const { assertSections } = await import('../guards');
    const bad = { ...VALID_TEXT_TEMPLATE, template: 'carousel' };
    expect(() => assertSections([...BESPOKE_NINE, bad])).toThrow(/unknown template "carousel"/);
  });

  it('rejects a template section with a blank id', async () => {
    const { assertSections } = await import('../guards');
    const bad = { ...VALID_TEXT_TEMPLATE, id: '  ' };
    expect(() => assertSections([...BESPOKE_NINE, bad])).toThrow(/needs an id/);
  });

  // C1 review fix: the whole point of this rule is a dotted id -- confirmed
  // directly, the hard way, this is what let a section named "Menu v2.0"
  // pass this guard before this check existed, render editable at /edit and
  // silently discard every edit made to it (template-section-paths.ts's own
  // SECTION_CONTENT_PATH can't tell "sections.Menu v2.0.content.heading"
  // apart from a well-formed path once the id itself contains a dot). Every
  // other case here (spaces, capitals, underscores) is the SAME
  // isUrlSafeSlug rule a page's own slug already enforces (guards.test.ts's
  // own assertPages describe block, above), reused rather than re-invented.
  it.each(['Menu v2.0', 'Our Story', 'promo_two', 'PROMO', 'sections.promo'])(
    'rejects the non-URL-safe template section id %j',
    async (id) => {
      const { assertSections } = await import('../guards');
      const bad = { ...VALID_TEXT_TEMPLATE, id };
      expect(() => assertSections([...BESPOKE_NINE, bad])).toThrow(/letters a-z, numbers and hyphens only/);
    },
  );

  it.each([
    ['text', { paragraphs: ['ok'] }, /needs a "heading"/],
    ['text', { heading: 'Hi', paragraphs: 'not-an-array' }, /needs a "paragraphs" list/],
    ['itemList', { heading: 'Hi' }, /needs an "items" list/],
    ['itemList', { heading: 'Hi', items: [{ image: '/a.webp', name: 'A' }] }, /needs an "image", a "name" and a "description"/],
    ['gallery', { heading: 'Hi', layout: 'diagonal', images: [] }, /"layout" must be "scroll" or "grid"/],
    ['gallery', { heading: 'Hi', layout: 'grid' }, /needs an "images" list/],
    ['detailBlock', { heading: 'Hi', facts: [] }, /needs a "body"/],
    ['detailBlock', { heading: 'Hi', body: 'b', facts: 'not-an-array' }, /needs a "facts" list/],
  ])('rejects malformed %s content: %j', async (template, content, expected) => {
    const { assertSections } = await import('../guards');
    const bad = { kind: 'template', id: 'x', enabled: true, template, content };
    expect(() => assertSections([...BESPOKE_NINE, bad])).toThrow(expected);
  });

  it('accepts every template type with a minimal valid content shape', async () => {
    const { assertSections } = await import('../guards');
    const entries = [
      { kind: 'template', id: 't1', enabled: true, template: 'text', content: { heading: 'H', paragraphs: ['p'] } },
      {
        kind: 'template',
        id: 't2',
        enabled: true,
        template: 'itemList',
        content: { heading: 'H', items: [{ image: '/a.webp', name: 'A', description: 'd' }] },
      },
      {
        kind: 'template',
        id: 't3',
        enabled: true,
        template: 'gallery',
        content: { heading: 'H', layout: 'scroll', images: [{ src: '/a.webp', alt: 'a' }] },
      },
      {
        kind: 'template',
        id: 't4',
        enabled: true,
        template: 'detailBlock',
        content: { heading: 'H', body: 'b', facts: [{ label: 'l', value: 'v' }] },
      },
    ];
    expect(() => assertSections([...BESPOKE_NINE, ...entries])).not.toThrow();
  });

  it('accepts an optional whatsapp button and rejects a malformed one', async () => {
    const { assertSections } = await import('../guards');
    const withButton = {
      ...VALID_TEXT_TEMPLATE,
      content: { ...VALID_TEXT_TEMPLATE.content, whatsapp: { label: 'Ask us', message: 'Hi, I have a question' } },
    };
    expect(() => assertSections([...BESPOKE_NINE, withButton])).not.toThrow();

    const badButton = {
      ...VALID_TEXT_TEMPLATE,
      content: { ...VALID_TEXT_TEMPLATE.content, whatsapp: { label: 'Ask us' } },
    };
    expect(() => assertSections([...BESPOKE_NINE, badButton])).toThrow(/whatsapp button needs a "label" and a "message"/);
  });

  it('rejects an entry with neither a bespoke nor a template kind', async () => {
    const { assertSections } = await import('../guards');
    const bad = { kind: 'mystery', id: 'x', enabled: true };
    expect(() => assertSections([...BESPOKE_NINE, bad])).toThrow(/needs a "kind" of "bespoke" or "template"/);
  });
});

describe('assertPages (Plan 7, Task 1)', () => {
  it('accepts an empty pages list', async () => {
    const { assertPages } = await import('../guards');
    expect(assertPages([])).toEqual([]);
  });

  const SEO = { title: 'Our Menu | Via Bianca', description: 'A short, honest description for search engines.' };

  it('accepts a valid page with a template section, and does not require any bespoke section to be present', async () => {
    const { assertPages } = await import('../guards');
    const page = {
      slug: 'our-menu',
      name: 'Our Menu',
      inNav: true,
      enabled: true,
      seo: SEO,
      sections: [
        {
          kind: 'template',
          id: 'menu-intro',
          enabled: true,
          template: 'text',
          content: { heading: 'Menu', paragraphs: ['Welcome.'] },
        },
      ],
    };
    const result = assertPages([page]);
    expect(result).toEqual([page]);
  });

  it.each(['Our-Menu', 'our menu', 'our_menu', 'our--menu', '', '-menu', 'menu-'])(
    'rejects the non-URL-safe slug %j',
    async (slug) => {
      const { assertPages } = await import('../guards');
      const page = { slug, name: 'X', inNav: true, enabled: true, seo: SEO, sections: [] };
      expect(() => assertPages([page])).toThrow(/URL-safe slug/);
    },
  );

  it.each(['blogs', 'edit'])('rejects the reserved slug "%s", which would shadow a live route', async (slug) => {
    const { assertPages } = await import('../guards');
    const page = { slug, name: 'X', inNav: true, enabled: true, seo: SEO, sections: [] };
    expect(() => assertPages([page])).toThrow(/collides with an existing route/);
  });

  it('rejects two pages sharing a slug', async () => {
    const { assertPages } = await import('../guards');
    const page = { slug: 'menu', name: 'Menu', inNav: true, enabled: true, seo: SEO, sections: [] };
    expect(() => assertPages([page, { ...page, name: 'Menu Again' }])).toThrow(/duplicate slug "menu"/);
  });

  it('rejects two sections sharing an id within the same page', async () => {
    const { assertPages } = await import('../guards');
    const section = {
      kind: 'template',
      id: 'dup',
      enabled: true,
      template: 'text',
      content: { heading: 'H', paragraphs: ['p'] },
    };
    const page = { slug: 'menu', name: 'Menu', inNav: true, enabled: true, seo: SEO, sections: [section, section] };
    expect(() => assertPages([page])).toThrow(/duplicate section id "dup"/);
  });

  // C1 review fix, the page's own sections path: `assertSectionEntry` is the
  // ONE function both assertSections (above) and assertPages (here) parse
  // every entry through, so this closes the identical gap for a page's own
  // template sections, not just the homepage's.
  it('rejects a non-URL-safe template section id inside a page\'s own sections', async () => {
    const { assertPages } = await import('../guards');
    const section = {
      kind: 'template',
      id: 'Menu v2.0',
      enabled: true,
      template: 'text',
      content: { heading: 'H', paragraphs: ['p'] },
    };
    const page = { slug: 'menu', name: 'Menu', inNav: true, enabled: true, seo: SEO, sections: [section] };
    expect(() => assertPages([page])).toThrow(/letters a-z, numbers and hyphens only/);
  });

  // The scoping decision: a template id is unique WITHIN one page's own
  // sections list (and within the homepage's own sections.json), never
  // globally -- two different pages, or a page and the homepage, may freely
  // reuse the same template id without colliding.
  it('allows the SAME template section id to be reused across two different pages', async () => {
    const { assertPages } = await import('../guards');
    const section = {
      kind: 'template',
      id: 'shared-id',
      enabled: true,
      template: 'text',
      content: { heading: 'H', paragraphs: ['p'] },
    };
    const pageA = { slug: 'page-a', name: 'Page A', inNav: true, enabled: true, seo: SEO, sections: [section] };
    const pageB = { slug: 'page-b', name: 'Page B', inNav: true, enabled: true, seo: SEO, sections: [section] };
    expect(() => assertPages([pageA, pageB])).not.toThrow();
  });

  it('rejects a page reusing a bespoke section id it already has, and allows the same bespoke id on two different pages', async () => {
    const { assertPages } = await import('../guards');
    const bespoke = { kind: 'bespoke', id: 'visit', enabled: true };
    const dup = { slug: 'a', name: 'A', inNav: true, enabled: true, seo: SEO, sections: [bespoke, bespoke] };
    expect(() => assertPages([dup])).toThrow(/duplicate section id "visit"/);

    const pageA = { slug: 'a', name: 'A', inNav: true, enabled: true, seo: SEO, sections: [bespoke] };
    const pageB = { slug: 'b', name: 'B', inNav: true, enabled: true, seo: SEO, sections: [bespoke] };
    expect(() => assertPages([pageA, pageB])).not.toThrow();
  });

  it('rejects a page missing a name, inNav or enabled', async () => {
    const { assertPages } = await import('../guards');
    expect(() => assertPages([{ slug: 'a', inNav: true, enabled: true, seo: SEO, sections: [] }])).toThrow(/needs a name/);
    expect(() => assertPages([{ slug: 'a', name: 'A', enabled: true, seo: SEO, sections: [] }])).toThrow(/"inNav" must be a boolean/);
    expect(() => assertPages([{ slug: 'a', name: 'A', inNav: true, seo: SEO, sections: [] }])).toThrow(/"enabled" must be a boolean/);
    expect(() => assertPages([{ slug: 'a', name: 'A', inNav: true, enabled: true, sections: [] }])).toThrow(/needs an SEO title/);
    expect(() => assertPages([{ slug: 'a', name: 'A', inNav: true, enabled: true, seo: { title: 'T' }, sections: [] }])).toThrow(/needs an SEO description/);
  });

  it('rejects pages.json that is not an array', async () => {
    const { assertPages } = await import('../guards');
    expect(() => assertPages({})).toThrow(/expected an array of pages/);
  });
});

// Phase 3. assertExperiences (guards.ts) -- the import-time guard that gates
// src/content/index.ts, same idiom as assertPages above. The write-time
// rules (link shape, the comingSoon/link pair) are validateExperiences'
// (validate.ts) job, exercised in validate.test.ts instead -- this guard
// checks only what the interface itself requires: id, title, description
// and image are non-empty strings, comingSoon is a boolean, and link, if
// present, is a non-empty string.
describe('assertExperiences (Phase 3)', () => {
  const VALID = {
    id: 'catering',
    title: 'Catering',
    description: 'Bespoke menus for your event.',
    image: '/experiences/catering.webp',
    link: '/catering',
    comingSoon: false,
  };

  it('accepts a well-formed list', async () => {
    const { assertExperiences } = await import('../guards');
    expect(assertExperiences([VALID])).toEqual([VALID]);
  });

  it('rejects experiences.json that is not an array', async () => {
    const { assertExperiences } = await import('../guards');
    expect(() => assertExperiences({})).toThrow(/content\/experiences\.json: expected an array/);
  });

  it('rejects a duplicate id, naming the offending index', async () => {
    const { assertExperiences } = await import('../guards');
    const dup = { ...VALID, title: 'Catering Again' };
    expect(() => assertExperiences([VALID, dup])).toThrow(/content\/experiences\.json: duplicate id "catering" at \[1\]/);
  });

  it('rejects a non-boolean comingSoon, naming the offending index', async () => {
    const { assertExperiences } = await import('../guards');
    const bad = { ...VALID, comingSoon: 'no' };
    expect(() => assertExperiences([bad])).toThrow(/content\/experiences\.json: "catering" at \[0\] needs "comingSoon" to be a boolean/);
  });

  // The one case that matters most in this file: assertExperiences must NOT
  // cross-check `link` against pages.json, even though it runs from
  // index.ts, which has `pages` sitting right there. If it threw here, then
  // switching a page off in the dashboard (an ordinary, supported,
  // one-click action -- "What shows on the homepage" already offers the
  // same toggle for every bespoke section) would make an experiences.json
  // that validated fine yesterday throw at import time today. That failure
  // is not scoped to the one broken card: it fails `npm run build`, which
  // blocks every subsequent publish of every other content file, with no
  // control anywhere in the dashboard able to clear it (see the phase plan's
  // own storage section, and validateExperiences' identical comment in
  // validate.ts). A page a link names not existing is a real state a
  // rendering surface has to handle -- Task 3's Experiences.tsx resolves it
  // against the live pages list and renders an unresolvable link as a
  // coming-soon card, at render time, where a bad state costs one card
  // instead of the whole site.
  it('accepts an item whose link names a page that does not exist in pages.json', async () => {
    const { assertExperiences } = await import('../guards');
    const danglingLink = { ...VALID, link: '/a-page-that-does-not-exist' };
    expect(() => assertExperiences([danglingLink])).not.toThrow();
    expect(assertExperiences([danglingLink])).toEqual([danglingLink]);
  });
});
