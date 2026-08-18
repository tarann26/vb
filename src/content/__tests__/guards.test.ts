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
    ['gallery', { heading: 'Hi', layout: 'diagonal', images: [] }, /"layout" must be one of scroll, grid, hero/],
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

import { RESERVED_PAGE_SLUGS, assertPages } from '../guards';

describe('reserved page slugs', () => {
  // Pinned as an exact set, not a `.has('blog')` spot check: this is the
  // list the build guard and the write boundary must agree on, and a spot
  // check cannot notice one of them quietly losing a member.
  it('is exactly the routes the site owns itself', () => {
    expect([...RESERVED_PAGE_SLUGS].sort()).toEqual(['blog', 'blogs', 'edit']);
  });

  it('assertPages throws at import time for a page slugged blog', () => {
    expect(() =>
      assertPages([
        { slug: 'blog', name: 'Blog', inNav: false, enabled: true, seo: { title: 'T', description: 'D' }, sections: [] },
      ]),
    ).toThrow(/collides with an existing route/);
  });
});

import { BLOCK_KINDS, POST_KEYS, assertPosts, isBlockKind } from '../guards';

// A fixture that is NOT the committed content. Phase 4's root cause was two
// fixtures equal to production data, which cannot tell a real binding from a
// hardcoded copy of that same data. Nothing in src/content/posts.json is
// slugged "a-test-post" or titled "A test post".
const A_POST = {
  id: 'test-1',
  slug: 'a-test-post',
  type: 'recipe',
  title: 'A test post',
  date: '2026-01-02',
  excerpt: 'A test excerpt.',
  image: '/food/tielle.webp',
  blocks: [{ kind: 'paragraph', text: 'A test paragraph.' }],
};

describe('BLOCK_KINDS', () => {
  // Spelled out as a literal rather than derived from the type or from
  // Object.keys of the same object the guard uses -- deriving both sides of
  // an equality from one constant asserts nothing (areas.test.tsx:31 makes
  // the identical argument for the panel ids).
  it('is exactly the ten kinds the spec names', () => {
    expect([...BLOCK_KINDS].sort()).toEqual(
      [
        'bulletList',
        'citation',
        'gallery',
        'heading',
        'image',
        'ingredients',
        'numberList',
        'paragraph',
        'quote',
        'steps',
      ].sort(),
    );
  });

  it('isBlockKind refuses a kind that is not one of them', () => {
    expect(isBlockKind('paragraph')).toBe(true);
    expect(isBlockKind('video')).toBe(false);
    expect(isBlockKind(42)).toBe(false);
  });
});

describe('POST_KEYS', () => {
  it('names every field a post has and nothing else', () => {
    expect(Object.keys(POST_KEYS).sort()).toEqual(
      ['blocks', 'date', 'excerpt', 'id', 'image', 'slug', 'title', 'type'].sort(),
    );
  });
});

describe('assertPosts', () => {
  it('accepts a well-formed list and returns it', () => {
    const posts = assertPosts([A_POST]);
    expect(posts).toHaveLength(1);
    expect(posts[0].slug).toBe('a-test-post');
    expect(posts[0].blocks[0].kind).toBe('paragraph');
  });

  // Each refusal is pinned to its OWN message. Phase 4's tenth plan defect
  // was a bare toThrow() that could not distinguish the guard under test
  // from a different guard downstream, so its mutation passed for the wrong
  // reason.
  it.each([
    ['a non-array', {}, /expected an array of posts/],
    ['an entry that is not an object', [null], /entry \[0\] is not an object/],
    ['a missing id', [{ ...A_POST, id: '' }], /entry \[0\] needs an id/],
    ['a duplicate id', [A_POST, A_POST], /duplicate id "test-1"/],
    ['a slug that is not URL-safe', [{ ...A_POST, slug: 'A Test Post' }], /is not a URL-safe slug/],
    ['a duplicate slug', [A_POST, { ...A_POST, id: 'test-2' }], /duplicate slug "a-test-post"/],
    ['an unknown post type', [{ ...A_POST, type: 'essay' }], /"essay" is not a post type/],
    ['a blank title', [{ ...A_POST, title: '  ' }], /needs a title/],
    ['a blank image', [{ ...A_POST, image: '' }], /needs an image/],
    ['blocks that are not an array', [{ ...A_POST, blocks: 'nope' }], /needs a list of blocks/],
    ['an unknown block kind', [{ ...A_POST, blocks: [{ kind: 'video', src: 'x' }] }], /"video" is not a block kind/],
    ['a block carrying a key its kind does not have', [{ ...A_POST, blocks: [{ kind: 'paragraph', text: 'x', align: 'left' }] }], /carries "align"/],
    // Added after running this task's own mutation 4 (drop the post-level
    // `unknownKeys(record, POST_KEYS)` block) and watching NOTHING go red.
    // The brief disclosed the row as a miss; this is the fix. The
    // BLOCK-level unknown-key case above was already covered -- the
    // POST-level one was not, which is the same `publishAt` field whose
    // absence from one end and presence at the other is what
    // DISH_KEYS' own comment records this project already paying for.
    ['a post carrying a key the type does not have', [{ ...A_POST, publishAt: '2026-01-01' }], /carries "publishAt"/],
  ])('refuses %s', (_name, raw, pattern) => {
    expect(() => assertPosts(raw)).toThrow(pattern);
  });

  // An empty list is LEGAL and this is deliberate: a restaurant with no
  // posts yet is the ordinary first state, not a failure, and Task 8's index
  // renders an empty state for it. The same call that makes dishes.json
  // refuse an empty list (the menu genuinely needs a dish) would be wrong
  // here.
  it('accepts an empty list', () => {
    expect(assertPosts([])).toEqual([]);
  });

  // The unsafe-path refusals for `image` live in the both-ends table below,
  // not here -- a table that asserted only assertPosts on these same values
  // would be a byte-for-byte duplicate of that table's own `refuses` rows,
  // able to fail only in lockstep with it, and a maintainer strengthening
  // one copy would have no reason to remember the other.

  // A percent-encoded backslash is NOT decoded before parsing, so it stays
  // on this origin and is accepted. Asserted beside the refusals rather than
  // left implicit: refusing it would be over-strict against real content,
  // and it was a deliberate call when isSafeHref was hardened.
  //
  // The encoded backslash has to sit in the LEADING run for this to mean
  // anything -- decoding one that sits after a directory changes only the
  // path shape, never the origin, because a browser's parser treats a
  // backslash as an ordinary separator everywhere except where it completes
  // the opening slash pair. A fixture with a directory in front of the
  // escape would pass this test whether or not decoding happened at all.
  it('accepts a percent-encoded backslash, which stays on this origin', () => {
    expect(assertPosts([{ ...A_POST, image: '/%5Cevil.example/hotelier.webp' }])[0].image).toBe(
      '/%5Cevil.example/hotelier.webp',
    );
  });

  it('still accepts the ordinary case', () => {
    expect(assertPosts([{ ...A_POST, image: '/press/hotelier.webp' }])[0].image).toBe('/press/hotelier.webp');
  });
});

import { validateContent } from '../validate';
import realPosts from '../posts.json';

// Review finding (Important #2). assertBlock checked the discriminant and
// the key set and nothing else, while its own comment claimed it kept "a
// hand-edited file from reaching a renderer that destructures a field that
// is not there". It did not: a MISSING key is not an UNKNOWN key. Every
// block below passed the guard at the reviewed commit; the first three then
// threw a TypeError inside BlockView on a live page, and the citation put
// `javascript:` into an href.
//
// Each row is checked at BOTH ends, in one table, on purpose. assertBlock
// cannot call validatePosts (validate.ts imports guards.ts, so the call
// would be a cycle -- see assertBlock's own comment), so the rules exist
// twice, and a table that only checked one end would let the other drift
// silently. The guard message is pinned per row rather than a bare toThrow,
// the same reason the assertPosts table above gives.
describe('assertBlock and the write boundary refuse the same broken blocks', () => {
  const withBlock = (block: unknown) => [{ ...A_POST, blocks: [block] }];

  it.each([
    ['a paragraph with no text at all', { kind: 'paragraph' }, /block test-1\[0\] needs a "text"/, '[0].blocks[0].text'],
    ['a heading with no text at all', { kind: 'heading' }, /needs a "text"/, '[0].blocks[0].text'],
    ['a bullet list with no items key', { kind: 'bulletList' }, /needs a "items" list of text/, '[0].blocks[0].items'],
    [
      'a numbered list holding something that is not text',
      { kind: 'numberList', items: ['A step.', 42] },
      /needs a "items" list of text/,
      '[0].blocks[0].items[1]',
    ],
    ['an image with no source', { kind: 'image', alt: 'A dish' }, /needs a "src"/, '[0].blocks[0].src'],
    [
      'an image whose source leaves this site through a backslash',
      { kind: 'image', src: '/\\evil.example/x.webp', alt: 'A dish' },
      /"src" must be a photo on this site/,
      '[0].blocks[0].src',
    ],
    ['an image with no description', { kind: 'image', src: '/food/tielle.webp' }, /needs a "alt"/, '[0].blocks[0].alt'],
    [
      'an image whose caption is not text',
      { kind: 'image', src: '/food/tielle.webp', alt: 'A dish', caption: 42 },
      /has a "caption" that is not text/,
      '[0].blocks[0].caption',
    ],
    ['a gallery with no images key', { kind: 'gallery' }, /needs an "images" list/, '[0].blocks[0].images'],
    [
      'a gallery photo that is not an object',
      { kind: 'gallery', images: [null] },
      /images\[0\] is not an object/,
      '[0].blocks[0].images[0].src',
    ],
    [
      'a gallery photo with no source',
      { kind: 'gallery', images: [{ alt: 'A dish' }] },
      /needs a "images\[0\]\.src"/,
      '[0].blocks[0].images[0].src',
    ],
    [
      'a gallery photo leaving this site through a backslash',
      { kind: 'gallery', images: [{ src: '/\\evil.example/x.webp', alt: 'A dish' }] },
      /"images\[0\]\.src" must be a photo on this site/,
      '[0].blocks[0].images[0].src',
    ],
    ['a quote with no words in it', { kind: 'quote' }, /needs a "text"/, '[0].blocks[0].text'],
    [
      'a quote whose attribution is not text',
      { kind: 'quote', text: 'Words worth repeating.', attribution: 42 },
      /has a "attribution" that is not text/,
      '[0].blocks[0].attribution',
    ],
    [
      'ingredients with no heading',
      { kind: 'ingredients', items: ['Flour'] },
      /needs a "heading"/,
      '[0].blocks[0].heading',
    ],
    ['steps with no items key', { kind: 'steps', heading: 'Method' }, /needs a "items" list of text/, '[0].blocks[0].items'],
    [
      'a citation with no publication',
      { kind: 'citation', url: null, date: '2026-01-01' },
      /needs a "publication"/,
      '[0].blocks[0].publication',
    ],
    [
      'a citation with no date',
      { kind: 'citation', publication: 'A Paper', url: null },
      /needs a "date"/,
      '[0].blocks[0].date',
    ],
    [
      'a citation with no url key at all',
      { kind: 'citation', publication: 'A Paper', date: '2026-01-01' },
      /needs a usable "url"/,
      '[0].blocks[0].url',
    ],
    [
      'a citation whose url is script',
      { kind: 'citation', publication: 'A Paper', url: 'javascript:alert(1)', date: '2026-01-01' },
      /needs a usable "url"/,
      '[0].blocks[0].url',
    ],
    [
      'a citation whose url leaves this site through a backslash',
      { kind: 'citation', publication: 'A Paper', url: '/\\evil.example', date: '2026-01-01' },
      /needs a usable "url"/,
      '[0].blocks[0].url',
    ],
    // Phase 5B, Task 6. The exact shape blankBlock('image') and
    // blankBlock('gallery') produce (src/admin/blocks/blank-block.ts) -- a
    // PRESENT but blank `src`, which every row above misses: the two src rows
    // above omit the key entirely, and a missing key is not a blank one.
    //
    // Refused at both ends, and it is the only pair of blank kinds that is:
    // assertBlock checks presence and primitive type only and accepts a
    // present-but-blank string by design (its own comment says so), so the
    // other eight blank kinds are refused by the write boundary alone. There
    // is deliberately no row here claiming otherwise.
    //
    // This is what makes the import-time refusal of a freshly-added photo
    // block a pinned decision rather than a surprise: she cannot publish one
    // either, because the write boundary refuses the same block first, so it
    // can never reach a committed posts.json for this guard to meet. Nobody
    // may "fix" the factory with a placeholder path -- there would be no file
    // behind it, and assets.test.ts fails the build on that.
    [
      'a blank image block, the shape a freshly-added photo block has',
      { kind: 'image', src: '', alt: '' },
      /"src" must be a photo on this site/,
      '[0].blocks[0].src',
    ],
    [
      'a blank gallery photo, the shape a freshly-added photo grid has',
      { kind: 'gallery', images: [{ src: '', alt: '' }] },
      /"images\[0\]\.src" must be a photo on this site/,
      '[0].blocks[0].images[0].src',
    ],
    // Admin redesign Task 26. `levels` is a PARALLEL array -- one nesting
    // depth per item -- and the two coming apart is the entire cost of
    // storing it that way rather than nesting the items themselves. Neither
    // end guesses which of the two arrays is right; both refuse the block.
    //
    // Both directions, deliberately: a `levels` shorter than `items` and a
    // `levels` longer than it are different bugs (a truncating write and an
    // appending one) and a length check written with the wrong comparison
    // catches only one of them.
    [
      'a bullet list carrying fewer nesting depths than items',
      { kind: 'bulletList', items: ['One', 'Two'], levels: [0] },
      /has a "levels" list that does not match its items/,
      '[0].blocks[0].levels',
    ],
    [
      'a numbered list carrying more nesting depths than items',
      { kind: 'numberList', items: ['One'], levels: [0, 1] },
      /has a "levels" list that does not match its items/,
      '[0].blocks[0].levels',
    ],
    [
      'a bullet list whose levels are not an array at all',
      { kind: 'bulletList', items: ['One'], levels: 1 },
      /has a "levels" list that does not match its items/,
      '[0].blocks[0].levels',
    ],
    [
      'a bullet list nested deeper than MAX_LIST_DEPTH',
      { kind: 'bulletList', items: ['One', 'Two'], levels: [0, 7] },
      /levels\[1\] is not a nesting depth/,
      '[0].blocks[0].levels',
    ],
    [
      'a numbered list whose depth is not a whole number',
      { kind: 'numberList', items: ['One', 'Two'], levels: [0, 1.5] },
      /levels\[1\] is not a nesting depth/,
      '[0].blocks[0].levels',
    ],
    [
      'a bullet list with a negative depth',
      { kind: 'bulletList', items: ['One', 'Two'], levels: [0, -1] },
      /levels\[1\] is not a nesting depth/,
      '[0].blocks[0].levels',
    ],
  ])('refuses %s', (_name, block, message, field) => {
    expect(() => assertPosts(withBlock(block))).toThrow(message);
    expect(validateContent('posts.json', withBlock(block)).map((p) => p.field)).toContain(field);
  });

  // The other direction. Without these the table above is satisfied by a
  // guard that refuses everything, which would fail the build on the three
  // posts already committed.
  it.each([
    ['a paragraph', { kind: 'paragraph', text: 'A paragraph.' }],
    ['a heading', { kind: 'heading', text: 'A heading' }],
    // NO `levels` KEY AT ALL is the shape every list committed before nesting
    // existed has, and it stays valid untouched -- which is the whole of the
    // spec's "there is no migration, because the storage never moves". If
    // either of these two rows ever reddens, three live posts stopped
    // building.
    ['a bullet list', { kind: 'bulletList', items: ['One', 'Two'] }],
    ['a numbered list', { kind: 'numberList', items: ['One', 'Two'] }],
    ['a bullet list with one item nested under the one above it', { kind: 'bulletList', items: ['One', 'Two'], levels: [0, 1] }],
    ['a numbered list nested as deep as it may go', { kind: 'numberList', items: ['One', 'Two', 'Three'], levels: [0, 1, 2] }],
    ['a bullet list whose levels are all zero, which is a flat list spelled the long way', { kind: 'bulletList', items: ['One', 'Two'], levels: [0, 0] }],
    ['an image with a caption', { kind: 'image', src: '/food/tielle.webp', alt: 'A dish', caption: 'A caption.' }],
    ['an image with no caption key', { kind: 'image', src: '/food/tielle.webp', alt: 'A dish' }],
    ['a gallery', { kind: 'gallery', images: [{ src: '/food/tielle.webp', alt: 'A dish' }] }],
    ['a quote with an attribution', { kind: 'quote', text: 'Words.', attribution: 'Someone' }],
    ['a quote with no attribution key', { kind: 'quote', text: 'Words.' }],
    ['ingredients', { kind: 'ingredients', heading: 'Ingredients', items: ['Flour'] }],
    ['steps', { kind: 'steps', heading: 'Method', items: ['Rest the dough.'] }],
    ['a citation with a link', { kind: 'citation', publication: 'A Paper', url: 'https://example.com/a', date: '2026-01-01' }],
    ['a citation with no online copy', { kind: 'citation', publication: 'A Paper', url: null, date: '2026-01-01' }],
  ])('accepts %s', (_name, block) => {
    const posts = assertPosts(withBlock(block));
    expect(posts[0].blocks[0]).toEqual(block);
  });

  // The committed file itself. The guard above is new and strict, and
  // posts.json is what it gates -- src/content/index.ts runs assertPosts on
  // it at import time, so this pins the shipped content against the new
  // rules here rather than leaving it to a build failure. Three, and the
  // three slugs, are hand-written: shape.test.ts's own tripwire pins the
  // same count for the same reason.
  it('accepts the three posts this branch ships', () => {
    const posts = assertPosts(realPosts);
    expect(posts.map((post) => post.slug)).toEqual([
      'bw-hotelier-regional-flair',
      'delhi-royale-pastificio-ristorante',
      'restaurant-india-cordon-bleu-debut',
    ]);
  });

  // Admin redesign Task 26, the migration claim stated as a fact about the
  // committed file rather than as an intention. Nesting was added by making
  // `levels` OPTIONAL, so the three published posts had to stay valid with no
  // edit at all -- and this checks the stronger half of that: not merely that
  // they still pass, but that the guard hands every block back exactly as the
  // JSON spells it, carrying no key nobody wrote. A "migration" that quietly
  // rewrote posts.json, or a guard that started filling a default `levels` in,
  // would redden here.
  //
  // The committed posts are paragraphs and citations today and hold no list at
  // all, which is precisely why this is written over EVERY block rather than
  // over the lists: a list-only assertion would pass vacuously and go on
  // passing after the first recipe is published.
  it('hands back every committed block exactly as the file spells it', () => {
    const blocks = assertPosts(realPosts).flatMap((post) => post.blocks);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks).toEqual((realPosts as { blocks: unknown[] }[]).flatMap((post) => post.blocks));
    blocks.forEach((block) => {
      expect(Object.prototype.hasOwnProperty.call(block, 'levels')).toBe(false);
    });
  });
});

// Task 2 of Phase 5B, the last guard asymmetry: assertPosts checked only
// that `image` was a non-empty string, while validatePost already ran the
// full isUnsafeAssetPath check on the same field. Both ends now ask
// isSiteRelativePath the same question. This table pairs them the same way
// the block-level table above does -- one row, both boundaries asserted in
// the same test -- because a row that only reached one end would look like
// coverage without being any.
//
// isSiteRelativePath, not a pattern: '/' followed by a backslash resolves
// to somebody else's host, and so does '/' followed by a tab followed by
// '//host'. Naming the dangerous characters one at a time is how the old
// check came to be wrong.
describe('assertPosts and the write boundary refuse the same unsafe card image', () => {
  it.each([
    ['an off-site card image', { image: 'https://evil.example/x.webp' }, '[0].image'],
    ['a protocol-relative card image', { image: '//evil.example/x.webp' }, '[0].image'],
    ['a backslash card image', { image: '/\\evil.example/x.webp' }, '[0].image'],
    ['a card image whose leading run mixes both slashes', { image: '/\\/evil.example/x.webp' }, '[0].image'],
    ['a traversing card image', { image: '/press/../../etc/passwd' }, '[0].image'],
    // Review finding (Minor 5): refused in fact by isUnsafeAssetPath's own
    // leading-slash test, but never pinned at the write boundary before this
    // row -- posts[].image is absent from validate.test.ts's own ASSET_FIELDS
    // table, which covers eight other image-shaped fields but not this one.
    ['a bare filename', { image: 'hotelier.webp' }, '[0].image'],
  ])('refuses %s', (_name, override, field) => {
    expect(() => assertPosts([{ ...A_POST, ...override }])).toThrow(/photo on this site/);
    expect(validateContent('posts.json', [{ ...A_POST, ...override }]).map((p) => p.field)).toContain(field);
  });

  // The other direction, the same reason the block-level table above gives:
  // without this, the table above is satisfied by a guard that refuses every
  // card image, which would fail the build on the three posts already
  // committed.
  it('accepts an ordinary card image at both ends', () => {
    const image = '/press/hotelier.webp';
    expect(assertPosts([{ ...A_POST, image }])[0].image).toBe(image);
    expect(validateContent('posts.json', [{ ...A_POST, image }])).toEqual([]);
  });
});

import type { Block } from '../types';

// Review finding (Important): `image.caption` and `quote.attribution` were
// declared as required `InlineText` while NOTHING at either boundary
// enforced them -- validatePosts accepts both blocks below (see
// validate.test.ts's two cases pinning that) and assertBlock waves them
// through, since it stops at the discriminant and the key set by design. A
// renderer trusting the type would have handed `undefined` to parseInline
// and thrown, on content already committed to this branch.
describe('the two optional block text fields', () => {
  // Spellable at all is the first half of the claim: with the old required
  // type, neither of these annotations compiles.
  const CAPTION_LESS_IMAGE: Block = { kind: 'image', src: '/food/tielle.webp', alt: 'A dish' };
  const UNATTRIBUTED_QUOTE: Block = { kind: 'quote', text: 'Words worth repeating.' };

  it('survive the import-time guard as real blocks', () => {
    const posts = assertPosts([{ ...A_POST, blocks: [CAPTION_LESS_IMAGE, UNATTRIBUTED_QUOTE] }]);
    expect(posts[0].blocks.map((b) => b.kind)).toEqual(['image', 'quote']);
  });

  // A COMPILE-TIME assertion, and it is the half that actually protects
  // Tasks 5 and 6. tsc -b typechecks this file (tsconfig.app.json includes
  // "src" whole), so each `@ts-expect-error` below is a real check with a
  // real failure mode: if either field is ever changed back to a required
  // string, the error it expects stops happening and tsc fails the build
  // with "Unused '@ts-expect-error' directive". That is the mutation --
  // drop the `?` from either field in BlockContentMap (types.ts) and watch
  // `npx tsc -b --noEmit` go red here rather than in a renderer months
  // later. Runtime alone could never assert this: the whole point is that
  // the compiler now refuses a consumer that assumes presence.
  it('force a consumer to handle their absence', () => {
    if (CAPTION_LESS_IMAGE.kind !== 'image') throw new Error('narrowing failed');
    if (UNATTRIBUTED_QUOTE.kind !== 'quote') throw new Error('narrowing failed');
    // @ts-expect-error -- caption is `string | undefined`, so a consumer that
    // wants a plain string has to say what happens when there is none.
    const caption: string = CAPTION_LESS_IMAGE.caption;
    // @ts-expect-error -- attribution is `string | undefined`, same reason.
    const attribution: string = UNATTRIBUTED_QUOTE.attribution;
    expect(caption).toBeUndefined();
    expect(attribution).toBeUndefined();
  });
});
