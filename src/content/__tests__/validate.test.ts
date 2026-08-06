import { describe, it, expect } from 'vitest';
import { validateContent } from '../validate';
import { MAX_COLLAGE_PHOTOS, MIN_SPLIT_CHILDREN, normalizeSizes } from '../collage';
import type { CollageNode } from '../types';
import type { Dish, Drink, Article, StoryContent, Copy, Section, SiteContent, Galleries, MenuFile } from '../types';

// Every fixture in this file is hand-built against the real types, not read
// from the repo's own content/*.json. A negative fixture built by cloning
// live content and mutating one field (e.g. `structuredClone(galleriesRaw)`
// then `bad.atmosphere[0].alt = ''`) is only as safe as an assumption about
// that live file's shape that this file does not control -- `atmosphere[0]`
// existing, say. If a future edit ever emptied that array, the clone-based
// version would throw a raw TypeError before `validateContent` is even
// called, which is a crash in *this test*, not evidence about the rule.
// Every fixture below is a complete, self-contained object literal instead,
// so nothing in this file depends on what is currently committed.

// Fixtures built against the real types (src/content/types.ts), not
// against a guess: Dish requires `tags`, Drink requires `description`,
// Article has `publication`/`excerpt`/`image` and no `outlet`. A fixture
// missing a required field produces *extra* structural problems on top of
// whatever a test means to check, which makes every message-count or
// message-content assertion built on it unreliable for the wrong reason.
const validDish: Dish = {
  id: 'test-dish',
  name: 'Test Dish',
  description: 'A dish used only by this test file.',
  image: '/food/test-dish.webp',
  tags: ['veg'],
};

const validDrink: Drink = {
  id: 'test-drink',
  name: 'Test Drink',
  description: 'A drink used only by this test file.',
  category: 'mocktail',
  image: null,
};

const olderArticle: Article = {
  id: 'older-article',
  title: 'Older Article',
  publication: 'Test Press',
  date: '2024-01-01',
  excerpt: 'An older excerpt.',
  url: null,
  image: '/press/older.webp',
};

const newerArticle: Article = {
  id: 'newer-article',
  title: 'Newer Article',
  publication: 'Test Press',
  date: '2024-06-01',
  excerpt: 'A newer excerpt.',
  url: null,
  image: '/press/newer.webp',
};

const validStory: StoryContent = {
  heading: 'Our Story',
  paragraphs: ['A paragraph with a clean, finished sentence.'],
};

const validCopy: Copy = {
  nav: {
    wordmark: 'Via Bianca',
    links: [{ href: '#a', label: 'Home', section: 'hero' }],
    instagramLabel: 'Follow on Instagram',
    menuLabel: 'Menu',
    pagesLabel: 'Experiences',
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
    followLabel: 'Follow\u00a0Us:',
    reservationsLabel: 'For Reservations:',
    rightsSuffix: '. All rights reserved.',
    instagramLabel: 'Follow on Instagram',
    linkedinLabel: 'Connect on LinkedIn',
  },
  blogsPage: {
    title: 'Via Bianca Stories',
    subtitle: 'Press & Articles',
    heading: 'All Stories',
    intro: 'The complete collection.',
    back: '← Back to Home',
    previous: 'Previous',
    next: 'Next',
  },
  notFound: { heading: 'Page not found', back: 'Back to home' },
};

const validSections: Section[] = [
  { kind: 'bespoke', id: 'hero', enabled: true },
  { kind: 'bespoke', id: 'ourStory', enabled: true },
  { kind: 'bespoke', id: 'atmosphere', enabled: true },
  { kind: 'bespoke', id: 'food', enabled: true },
  { kind: 'bespoke', id: 'drinks', enabled: true },
  { kind: 'bespoke', id: 'press', enabled: true },
  { kind: 'bespoke', id: 'visit', enabled: true },
];

const validSite: SiteContent = {
  name: 'Test Restaurant',
  tagline: 'Test Tagline',
  strapline: 'Test Strapline',
  address: { street: '1 Test Street', locality: 'Test City', postalCode: '000000', country: 'IN' },
  phones: ['+91 00000 00000'],
  whatsapp: { number: '910000000000', prefilledMessage: 'Hi, I want to reserve a table' },
  socials: { instagram: 'https://instagram.com/test', linkedin: null },
  hours: [{ days: ['Mo', 'Tu'], opens: '12:00', closes: '23:00' }],
  seo: {
    title: 'Test title',
    description: 'Test description',
    keywords: 'test',
    ogImage: '/og-image.jpg',
    url: 'https://example.com',
    locale: 'en_IN',
  },
  copyrightYear: 2026,
};

const validGalleries: Galleries = {
  atmosphere: [{ src: '/atmosphere/a.webp', alt: 'A' }],
  ourStory: [{ src: '/our_story/b.webp', alt: 'B' }],
  heroCollage: { kind: 'photo', id: 'only', src: '/hero/c.webp', alt: '' },
};

const validMenus: MenuFile[] = [{ id: 'food', label: 'Food Menu', file: '/menus/food-menu.pdf' }];

const messages = (problems: { message: string }[]) => problems.map((p) => p.message).join(' ');

describe('validateContent: default-deny', () => {
  it('rejects a file it has no rule for, rather than committing it unvalidated', () => {
    expect(validateContent('unknown.json', {})).not.toEqual([]);
  });
});

describe('validateContent: never throws', () => {
  it('never throws, whatever it is handed', () => {
    for (const junk of [null, 42, 'string', [], {}, [{}], '{'] as unknown[]) {
      expect(() => validateContent('dishes.json', junk)).not.toThrow();
    }
  });

  it('never throws for any recognised file, whatever it is handed', () => {
    const files = [
      'copy.json',
      'sections.json',
      'dishes.json',
      'drinks.json',
      'press.json',
      'story.json',
      'site.json',
      'galleries.json',
      'menus.json',
    ];
    for (const file of files) {
      for (const junk of [null, undefined, 42, 'string', [], {}, [{}], '{'] as unknown[]) {
        expect(() => validateContent(file, junk)).not.toThrow();
      }
    }
  });

  // None of the plain junk values above make any individual rule actually
  // throw -- every rule already handles them internally, which means the
  // outer try/catch in validateContent is unexercised by the tests above.
  // This one forces a real, uncaught throw *inside* a rule (a getter that
  // throws when read, standing in for "a rule has a bug"), so the outer
  // catch's own job -- turning that into a returned problem instead of a
  // crash -- has a test that would actually fail if that catch were removed.
  it('the outer catch turns a bug inside a rule into a problem, not a crash', () => {
    const evil = {};
    Object.defineProperty(evil, 'name', {
      enumerable: true,
      get() {
        throw new Error('boom: a rule tried to read this and blew up');
      },
    });
    let problems: { field: string; message: string }[] = [];
    expect(() => {
      problems = validateContent('dishes.json', [evil]);
    }).not.toThrow();
    expect(messages(problems)).toMatch(/boom/);
  });
});

describe('validateContent: accepts content that is fine', () => {
  it('accepts a valid story', () => {
    expect(validateContent('story.json', validStory)).toEqual([]);
  });

  it('accepts a valid dish', () => {
    expect(validateContent('dishes.json', [validDish])).toEqual([]);
  });

  it('accepts a valid drink', () => {
    expect(validateContent('drinks.json', [validDrink])).toEqual([]);
  });

  it('accepts articles already sorted newest first', () => {
    expect(validateContent('press.json', [newerArticle, olderArticle])).toEqual([]);
  });

  it('accepts valid copy', () => {
    expect(validateContent('copy.json', validCopy)).toEqual([]);
  });

  it('accepts valid sections', () => {
    expect(validateContent('sections.json', validSections)).toEqual([]);
  });

  it('accepts a valid site', () => {
    expect(validateContent('site.json', validSite)).toEqual([]);
  });

  it('accepts valid galleries', () => {
    expect(validateContent('galleries.json', validGalleries)).toEqual([]);
  });

  it('accepts valid menus', () => {
    expect(validateContent('menus.json', validMenus)).toEqual([]);
  });
});

describe('validateContent: names the field when a required value is blank', () => {
  it('dishes.json', () => {
    const problems = validateContent('dishes.json', [{ ...validDish, name: '' }]);
    expect(messages(problems)).toMatch(/name/i);
  });
});

// The three rules below are the ones moved out of the component suite by
// this task. Each one is fed the exact content the retired test used to
// reject, so a rule that moved but stopped catching anything is caught
// here rather than discovered later by a bad edit sailing through.

describe('validateContent: story rule (moved from OurStory.test.tsx)', () => {
  it('refuses a story paragraph that trails off with "..."', () => {
    const problems = validateContent('story.json', { ...validStory, paragraphs: ['It began...'] });
    expect(messages(problems)).toMatch(/ellipsis|trails off/i);
  });

  it('refuses a story paragraph that trails off with "…"', () => {
    const problems = validateContent('story.json', { ...validStory, paragraphs: ['It began…'] });
    expect(messages(problems)).toMatch(/ellipsis|trails off/i);
  });
});

describe('validateContent: press rule (moved from press.test.tsx)', () => {
  it('refuses press articles out of date order', () => {
    const problems = validateContent('press.json', [olderArticle, newerArticle]);
    expect(messages(problems)).toMatch(/newest first|order/i);
  });
});

// Minor review finding: ARTICLE_FIELDS.url's own help text (fields.ts)
// promises "leave empty if it has none" -- but the field this dashboard
// actually renders (Field.tsx's generic `text` case) writes an emptied
// input back as `''`, never `null`, and this rule used to refuse that: the
// one action the field's own help text told her she could take was the one
// thing publishing then rejected.
describe("validateContent: an article's url accepts blank the same as null (Minor fix)", () => {
  it('accepts an EMPTY STRING url -- the one thing an emptied text field can actually produce', () => {
    const problems = validateContent('press.json', [{ ...olderArticle, url: '' }]);
    expect(problems).toEqual([]);
  });

  it('accepts a whitespace-only url the same way', () => {
    const problems = validateContent('press.json', [{ ...olderArticle, url: '   ' }]);
    expect(problems).toEqual([]);
  });

  it('still refuses a non-blank, non-http(s) url', () => {
    const problems = validateContent('press.json', [{ ...olderArticle, url: 'not-a-url' }]);
    expect(messages(problems)).toMatch(/real destination/i);
  });

  it('still accepts a real https url', () => {
    const problems = validateContent('press.json', [{ ...olderArticle, url: 'https://example.com/piece' }]);
    expect(problems).toEqual([]);
  });
});

describe('validateContent: retired-drink rules (moved from Drinks.test.tsx)', () => {
  it('refuses a retired drink returning by name', () => {
    const problems = validateContent('drinks.json', [{ ...validDrink, name: 'Bicerin' }]);
    expect(messages(problems)).toMatch(/retired/i);
  });

  it.each(['Bicerin', 'Espresso Tonic', 'Signor Bianca', 'Sambuco'])(
    'refuses "%s" specifically, by name',
    (retiredName) => {
      const problems = validateContent('drinks.json', [{ ...validDrink, name: retiredName }]);
      expect(messages(problems)).toMatch(/retired/i);
    },
  );

  it('refuses a retired drink named only in the intro prose', () => {
    const problems = validateContent('copy.json', {
      ...validCopy,
      drinks: { ...validCopy.drinks, intro: 'Try our basil-lime spritz.' },
    });
    expect(messages(problems)).toMatch(/basil-lime spritz/i);
  });

  it.each(['rosemary-grapefruit fizz', 'espresso-orange tonic'])(
    'refuses "%s" specifically, in the intro prose',
    (phrase) => {
      const problems = validateContent('copy.json', {
        ...validCopy,
        drinks: { ...validCopy.drinks, intro: `Featuring our ${phrase}.` },
      });
      expect(messages(problems)).toMatch(new RegExp(phrase, 'i'));
    },
  );
});

// Whole-branch review, M5: every test above compares a retired name/phrase
// against itself in the exact case (and, for drink names, the exact
// whitespace) it's already written in -- none of them exercises the
// `.toLowerCase()`/`.trim()` calls the comparison actually relies on
// (validate.ts's retired-drink checks). Confirmed directly: removing either
// call left every test above still green. "BICERIN" or "Basil-Lime Spritz"
// -- a differently-cased edit, not a byte-identical retyping of the exact
// retired string -- is the realistic way this comes back, since nobody
// reintroducing a retired drink is copy-pasting the old JSON verbatim.
describe('validateContent: retired-drink case-folding and whitespace are load-bearing (M5, whole-branch review)', () => {
  it('refuses a retired drink name in a different case ("BICERIN")', () => {
    const problems = validateContent('drinks.json', [{ ...validDrink, name: 'BICERIN' }]);
    expect(messages(problems)).toMatch(/retired/i);
  });

  it('refuses a retired drink name with leading/trailing whitespace ("  Bicerin  ")', () => {
    const problems = validateContent('drinks.json', [{ ...validDrink, name: '  Bicerin  ' }]);
    expect(messages(problems)).toMatch(/retired/i);
  });

  it('refuses a retired intro phrase in a different case ("Basil-Lime Spritz")', () => {
    const problems = validateContent('copy.json', {
      ...validCopy,
      drinks: { ...validCopy.drinks, intro: 'Try our Basil-Lime Spritz.' },
    });
    expect(messages(problems)).toMatch(/basil-lime spritz/i);
  });
});

// Beyond the three moved rules: proof that the remaining default-deny
// files (sections.json, site.json, galleries.json, menus.json) are wired
// to a real rule and not silently accepting everything.

describe('validateContent: structural rules on the remaining files', () => {
  it('rejects sections.json with hero disabled', () => {
    const bad = validSections.map((s) => (s.id === 'hero' ? { ...s, enabled: false } : s));
    const problems = validateContent('sections.json', bad);
    expect(messages(problems)).toMatch(/hero/i);
  });

  // C1 review fix: named, owner-facing message for the exact defect this
  // repair closes -- a template section named "Menu v2.0" used to pass this
  // check, render editable at /edit, and silently discard every edit made
  // to it (template-section-paths.ts's own SECTION_CONTENT_PATH can't parse
  // an id containing a "."). Reuses the same rule a page's own slug already
  // enforces -- see guards.ts's own assertSectionEntry for the throwing
  // twin of this check.
  it('rejects a template section id that is not a URL-safe slug, naming the field', () => {
    const bad: Section[] = [
      ...validSections,
      {
        kind: 'template',
        id: 'Menu v2.0',
        enabled: true,
        template: 'text',
        content: { heading: 'H', paragraphs: ['p'] },
      },
    ];
    const problems = validateContent('sections.json', bad);
    expect(problems.some((p) => p.field === '[7].id' && /can only use letters a-z, numbers and hyphens/.test(p.message))).toBe(
      true,
    );
  });

  it('rejects site.json with no phone numbers', () => {
    const bad = { ...validSite, phones: [] };
    const problems = validateContent('site.json', bad);
    expect(messages(problems)).toMatch(/phone/i);
  });

  it('rejects galleries.json with an image missing alt text', () => {
    const bad: Galleries = {
      ...validGalleries,
      atmosphere: [{ ...validGalleries.atmosphere[0], alt: '' }],
    };
    const problems = validateContent('galleries.json', bad);
    expect(messages(problems)).toMatch(/alt/i);
  });

  it('rejects menus.json with a menu missing a label', () => {
    const bad: MenuFile[] = [{ ...validMenus[0], label: '' }];
    const problems = validateContent('menus.json', bad);
    expect(messages(problems)).toMatch(/label/i);
  });

  it('rejects copy.json with a blank required field', () => {
    const bad = { ...validCopy, atmosphere: { heading: '   ' } };
    const problems = validateContent('copy.json', bad);
    expect(messages(problems)).toMatch(/atmosphere/i);
  });
});

// Plan 7: validateContent('pages.json', ...) and validateContent's own
// section-entry rule (shared by sections.json and pages.json) -- exercised
// here through the DASHBOARD-FACING function itself (validate.ts), not
// guards.test.ts's own coverage of assertSections/assertPages (guards.ts,
// the throwing, build-time twin). Both matter: the Worker's own
// POST /api/publish gate, and the dashboard's live, debounced validation
// (useValidation), call THIS function, not the guard directly.
describe('validateContent: pages.json (Plan 7)', () => {
  const validPage = {
    slug: 'our-menu',
    name: 'Our Menu',
    inNav: true,
    enabled: true,
    seo: { title: 'Our Menu | Via Bianca', description: 'A short description.' },
    sections: [],
  };

  it('accepts a well-formed page', () => {
    expect(validateContent('pages.json', [validPage])).toEqual([]);
  });

  it('rejects a non-URL-safe slug, naming the field', () => {
    const problems = validateContent('pages.json', [{ ...validPage, slug: 'Our Menu' }]);
    expect(messages(problems)).toMatch(/web-safe address/i);
    expect(problems.some((p) => p.field === '[0].slug')).toBe(true);
  });

  it('rejects a slug colliding with a live route', () => {
    const problems = validateContent('pages.json', [{ ...validPage, slug: 'blogs' }]);
    expect(messages(problems)).toMatch(/already used by the site itself/i);
  });

  it('rejects two pages sharing a slug', () => {
    const problems = validateContent('pages.json', [validPage, { ...validPage, name: 'Duplicate' }]);
    expect(problems.some((p) => p.field === '[1].slug' && /already used by another page/.test(p.message))).toBe(true);
  });

  it('rejects a page missing an SEO title or description', () => {
    const noTitle = validateContent('pages.json', [{ ...validPage, seo: { title: '', description: 'd' } }]);
    expect(messages(noTitle)).toMatch(/needs an SEO title/i);
    const noDescription = validateContent('pages.json', [{ ...validPage, seo: { title: 't', description: '' } }]);
    expect(messages(noDescription)).toMatch(/needs an SEO description/i);
  });

  it('rejects an unknown template type inside a page\'s own sections', () => {
    const problems = validateContent('pages.json', [
      {
        ...validPage,
        sections: [{ kind: 'template', id: 'x', enabled: true, template: 'carousel', content: {} }],
      },
    ]);
    expect(messages(problems)).toMatch(/is not a template this site knows/i);
  });

  it('rejects mismatched content -- a text section missing its own heading', () => {
    const problems = validateContent('pages.json', [
      {
        ...validPage,
        sections: [{ kind: 'template', id: 'x', enabled: true, template: 'text', content: { paragraphs: ['p'] } }],
      },
    ]);
    expect(messages(problems)).toMatch(/needs a heading/i);
  });

  it('rejects a page\'s own template section id colliding with a built-in SectionId', () => {
    const problems = validateContent('pages.json', [
      {
        ...validPage,
        sections: [{ kind: 'template', id: 'visit', enabled: true, template: 'text', content: { heading: 'H', paragraphs: ['p'] } }],
      },
    ]);
    expect(messages(problems)).toMatch(/collides with a built-in section/i);
  });

  // C1 review fix: the identical rule, for a page's own template sections --
  // validateSectionEntry is the one function both sections.json (above) and
  // pages.json (here) parse every entry through.
  it('rejects a page\'s own template section id that is not a URL-safe slug', () => {
    const problems = validateContent('pages.json', [
      {
        ...validPage,
        sections: [{ kind: 'template', id: 'Menu v2.0', enabled: true, template: 'text', content: { heading: 'H', paragraphs: ['p'] } }],
      },
    ]);
    expect(messages(problems)).toMatch(/can only use letters a-z, numbers and hyphens/i);
  });

  it('rejects pages.json that is not an array', () => {
    expect(messages(validateContent('pages.json', {}))).toMatch(/expected a list of pages/i);
  });
});

// Plan 5 Task 6: "anything the tools can produce must pass the deploy gate."
// Three content-quality rules already lived ONLY in a test against the
// PUBLIC page (PlaceGallery.test.tsx, OurStory.test.tsx, FoodGallery.test.tsx)
// -- true for every dashboard write that happens to render through those
// components today, but not enforced on the write path itself, so nothing
// stopped a bad value from reaching a commit through any OTHER caller. Moved
// server-side here, before a publish ever lands. The other two rows of the
// plan's own disagreement table are deliberately NOT rebuilt: asset
// existence (assets.test.ts) has no filesystem to check from inside
// validateContent, and is already handled at the write path a different way
// -- scrubStagedReferences (src/admin/publish.ts) strips a leaf that names a
// staged-but-uncommitted file out of what a draft ever persists, already
// covered by src/admin/__tests__/publish.test.ts's own dirtyDraftMap suite
// -- and the developer-owned site.* fields (head.test.ts) are already
// refused here (validateSiteDeveloperOwnedFields, above) and must stay that
// way, not be loosened.
describe('validateContent: Task 6 -- content-quality rules the dashboard already enforced, now refused server-side too', () => {
  it('an atmosphere image alt text like "Place 3" is refused by validateContent (PlaceGallery.test.tsx\'s own rule)', () => {
    const bad: Galleries = { ...validGalleries, atmosphere: [{ ...validGalleries.atmosphere[0], alt: 'Place 3' }] };
    const problems = validateContent('galleries.json', bad);
    expect(messages(problems)).toMatch(/placeholder/i);
  });

  it('an ourStory image alt text like "Slide 2" is refused by validateContent (OurStory.test.tsx\'s own rule)', () => {
    const bad: Galleries = { ...validGalleries, ourStory: [{ ...validGalleries.ourStory[0], alt: 'Slide 2' }] };
    const problems = validateContent('galleries.json', bad);
    expect(messages(problems)).toMatch(/placeholder/i);
  });

  // Both prefixes the real pattern names (FoodGallery.test.tsx's own
  // `/^(Idk|Pizza)\d+$/`) -- checking only one would stay green under a
  // mutation that narrowed the pattern to just that one prefix.
  it('a dish name that looks like a placeholder ("Idk3" or "Pizza7") is refused by validateContent (FoodGallery.test.tsx\'s own rule)', () => {
    expect(messages(validateContent('dishes.json', [{ ...validDish, name: 'Idk3' }]))).toMatch(/placeholder/i);
    expect(messages(validateContent('dishes.json', [{ ...validDish, name: 'Pizza7' }]))).toMatch(/placeholder/i);
  });

  // 'margherita.Jpg' (mixed case), not 'MARGHERITA.JPG' -- the real pattern's
  // own literal 'JPG' alternate already matches an all-caps extension with
  // no `i` flag at all, which would leave a dropped-`i`-flag mutation
  // undetected (confirmed directly while writing this test). A mixed-case
  // extension matches neither of the pattern's two literal spellings, so
  // it depends on the `i` flag alone.
  it('a dish name ending in .jpg (any case) is refused by validateContent (FoodGallery.test.tsx\'s own rule)', () => {
    expect(messages(validateContent('dishes.json', [{ ...validDish, name: 'margherita.jpg' }]))).toMatch(/filename/i);
    expect(messages(validateContent('dishes.json', [{ ...validDish, name: 'margherita.Jpg' }]))).toMatch(/filename/i);
  });

  it('a dish name ending in .png is refused by validateContent (FoodGallery.test.tsx\'s own rule)', () => {
    expect(messages(validateContent('dishes.json', [{ ...validDish, name: 'margherita.png' }]))).toMatch(/filename/i);
  });
});

// The hero collage is a tree of splits, and `validateContent` is the write
// boundary that refuses a malformed one before it can become a commit. The
// per-rule assertions -- and the proof that this end and the build-time guard
// (`assertCollageTree`) agree on every one of them -- live in
// src/content/__tests__/collage.test.ts, which drives the same thirteen
// malformed trees through both. What belongs HERE is the part that is
// specific to validateContent's own galleries.json rule: that a bad tree
// reaches it at all, that it is addressed to a field the dashboard can route,
// and that "no collage" is refused.
describe('validateContent: the hero collage tree (Plan 9, Task 1)', () => {
  function photo(id: string, src = `/hero/${id}.webp`): CollageNode {
    return { kind: 'photo', id, src, alt: '' };
  }

  function withCollage(heroCollage: unknown): unknown {
    return { ...validGalleries, heroCollage };
  }

  it('accepts the smallest legal collage -- a single photo filling the hero', () => {
    expect(validateContent('galleries.json', withCollage(photo('only')))).toEqual([]);
  });

  it('accepts a real nested tree', () => {
    const tree: CollageNode = {
      kind: 'split',
      id: 'root',
      direction: 'row',
      children: [photo('a'), { kind: 'split', id: 'mid', direction: 'column', children: [photo('b'), photo('c')], sizes: [1, 1] }],
      sizes: normalizeSizes([2, 1]),
    };
    expect(validateContent('galleries.json', withCollage(tree))).toEqual([]);
  });

  it('a collage with no tree at all is refused by validateContent', () => {
    expect(messages(validateContent('galleries.json', withCollage(null)))).toMatch(/at least 1 photo/i);
    expect(messages(validateContent('galleries.json', { ...validGalleries, heroCollage: undefined }))).toMatch(
      /at least 1 photo/i,
    );
  });

  it('a collage tree with a one-child split is refused by validateContent', () => {
    const problems = validateContent('galleries.json', withCollage({ kind: 'split', id: 'root', direction: 'row', children: [photo('a')], sizes: [1] }));
    expect(messages(problems)).toMatch(new RegExp(`at least ${MIN_SPLIT_CHILDREN} boxes`));
  });

  it('a collage tree whose sizes do not match its children is refused by validateContent', () => {
    const problems = validateContent('galleries.json', withCollage({ kind: 'split', id: 'root', direction: 'row', children: [photo('a'), photo('b')], sizes: [1] }));
    expect(messages(problems)).toMatch(/different number of sizes than boxes/i);
  });

  it('a collage tree with an un-normalised sizes array is refused by validateContent', () => {
    const problems = validateContent('galleries.json', withCollage({ kind: 'split', id: 'root', direction: 'row', children: [photo('a'), photo('b')], sizes: [1, 2] }));
    expect(messages(problems)).toMatch(/must add up to 2/i);
  });

  it('a collage tree with more than the cap of photos is refused by validateContent', () => {
    const children = Array.from({ length: MAX_COLLAGE_PHOTOS + 1 }, (_, i) => photo(`p${i}`));
    const problems = validateContent('galleries.json', withCollage({
      kind: 'split', id: 'root', direction: 'row', children, sizes: children.map(() => 1),
    }));
    expect(messages(problems)).toMatch(new RegExp(`${MAX_COLLAGE_PHOTOS} is the most`));
  });

  // The one thing that is this file's own rather than collage.test.ts's: the
  // FIELD a per-photo problem is addressed to. src/admin/problems.ts routes
  // `key[i].sub` to a row of the dashboard's own hero-collage list, which
  // renders the tree's photos in document order -- so an index that did not
  // mean "document order" would silently put the message on the wrong photo.
  it('addresses a bad photo to its document-order row, the shape the dashboard routes on', () => {
    const tree: CollageNode = {
      kind: 'split',
      id: 'root',
      direction: 'row',
      children: [photo('a'), { kind: 'split', id: 'mid', direction: 'column', children: [photo('b'), { kind: 'photo', id: 'c', src: '', alt: '' }], sizes: [1, 1] }],
      sizes: [1, 1],
    };
    const problems = validateContent('galleries.json', withCollage(tree));
    expect(problems.map((p) => p.field)).toEqual(['heroCollage[2].src']);
  });
});

// Step 6: copy.footer.followLabel must keep a non-breaking space (U+00A0)
// between its two words. validCopy above already carries the real one
// ('Follow Us:'), so "accepts valid copy" earlier in this file is
// itself proof the rule doesn't fire on legitimate content -- these two
// tests are the ones that would actually go red if the rule were removed
// or miswired.
describe('validateContent: footer.followLabel needs a non-breaking space (Step 6)', () => {
  it('refuses a followLabel with an ordinary space in place of the non-breaking one', () => {
    const bad = { ...validCopy, footer: { ...validCopy.footer, followLabel: 'Follow Us:' } };
    const problems = validateContent('copy.json', bad);
    expect(messages(problems)).toMatch(/non-breaking space/i);
  });

  it('refuses a followLabel with no space of any kind', () => {
    const bad = { ...validCopy, footer: { ...validCopy.footer, followLabel: 'FollowUs:' } };
    const problems = validateContent('copy.json', bad);
    expect(messages(problems)).toMatch(/non-breaking space/i);
  });
});

// Step 5: site.json's name, tagline, and every seo.* field are written into
// index.html by hand (src/test/head.test.ts pins them there) -- a dashboard
// write that changes one fails the deploy, and keeps failing every
// subsequent publish until a developer edits index.html too. validateContent
// only ever sees the *proposed* content, so this rule needs the committed
// value passed in separately -- the optional third parameter.
describe('validateContent: site.json refuses a change to a developer-owned field, given the committed value (Step 5)', () => {
  it('is a no-op with no third argument -- every existing 2-arg caller keeps working unchanged', () => {
    const changed = { ...validSite, name: 'Something Else Entirely' };
    expect(validateContent('site.json', changed)).toEqual([]);
  });

  it('accepts a site.json identical to the one passed as `current`', () => {
    expect(validateContent('site.json', validSite, validSite)).toEqual([]);
  });

  it('refuses a changed name', () => {
    const changed = { ...validSite, name: 'Something Else Entirely' };
    const problems = validateContent('site.json', changed, validSite);
    expect(messages(problems)).toMatch(/developer/i);
  });

  it('refuses a changed tagline', () => {
    const changed = { ...validSite, tagline: 'Something Else Entirely' };
    const problems = validateContent('site.json', changed, validSite);
    expect(messages(problems)).toMatch(/developer/i);
  });

  it('refuses a changed seo.description -- the share-preview text', () => {
    const changed = { ...validSite, seo: { ...validSite.seo, description: 'A different description' } };
    const problems = validateContent('site.json', changed, validSite);
    expect(messages(problems)).toMatch(/developer/i);
  });

  // Proof the rule covers every seo.* key generically, not a hand-picked
  // subset (e.g. only title/description): seo.locale is the one head.test.ts
  // pins into og:locale, and it's easy for a rule copied field-by-field to
  // miss.
  it('refuses a changed seo.locale', () => {
    const changed = { ...validSite, seo: { ...validSite.seo, locale: 'en_US' } };
    const problems = validateContent('site.json', changed, validSite);
    expect(messages(problems)).toMatch(/developer/i);
  });

  it('does not refuse strapline, which head.test.ts does not pin into index.html', () => {
    const changed = { ...validSite, strapline: 'A brand new strapline' };
    expect(validateContent('site.json', changed, validSite)).toEqual([]);
  });

  // I4 review finding: every test above keeps every seo.* key present and
  // only changes a VALUE, so none of them can tell "union the committed
  // side's keys too" apart from "only ever check a key the WRITE still
  // carries" -- narrowing validateSiteDeveloperOwnedFields' own `seoKeys`
  // union to `Object.keys(proposedSeo)` alone leaves all of them green. A
  // write that DROPS a key entirely is exactly as much a change as one that
  // alters its value (that function's own comment says so), and this is the
  // one test that actually depends on the union reaching the committed
  // side.
  it('refuses a DROPPED seo key, not only a changed one', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `locale` is destructured only to OMIT it from the proposed value below
    const { locale, ...seoWithoutLocale } = validSite.seo;
    const changed = { ...validSite, seo: seoWithoutLocale };
    const problems = validateContent('site.json', changed, validSite);
    expect(messages(problems)).toMatch(/developer/i);
  });

  // Code review finding: `asRecord` maps anything that isn't a plain object
  // -- including `null`, since `typeof null === 'object'` in JS -- to `{}`.
  // Before isPlainObject gated this rule, `validateContent('site.json',
  // validSite, null)` read as "every developer-owned field changed from
  // committed value undefined," and returned all eight problems even though
  // nothing about `validSite` itself is invalid. No caller does this today,
  // but Task 3 adds the one that will, and a failed content fetch is a
  // plausible way for `current` to arrive as `null` instead of being
  // omitted. `null` must be refused nothing at all, the same as omitting
  // the argument entirely.
  it('treats current: null the same as an omitted current -- no problems, not eight', () => {
    expect(validateContent('site.json', validSite, null)).toEqual([]);
  });

  it('treats a non-object current (e.g. a string) the same as an omitted current', () => {
    expect(validateContent('site.json', validSite, 'not an object')).toEqual([]);
  });

  it('treats an array current the same as an omitted current -- typeof [] === "object" too', () => {
    expect(validateContent('site.json', validSite, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Review finding (Important). The write boundary and the build gate must
// refuse the same keys, because the write boundary is the only one that can
// still say no: shape.test.ts runs during `npm run test:deploy`, on `main`,
// after the commit. A key this file lets through is a red build that the
// dashboard cannot undo -- and, since the bad key is then committed, a red
// build for every subsequent publish of every other file too, until a
// developer hand-edits the JSON.
//
// `publishAt` is the one that actually opened this window and gets its own
// tests: removing the scheduling subsystem deleted `validatePublishAt` from
// this module and made `publishAt` an unknown key to shape.test.ts in the
// same commit, while the DEPLOYED dashboard (origin/main, live at the time)
// still rendered a "Publish on" date input on every dish, drink and press
// row. A tab left open on that version, or a draft restored from it, carries
// the field into the next publish with nothing left able to remove it.
describe('validateContent: a key the type does not have is refused at the write boundary', () => {
  it('refuses publishAt on a dish, naming the field and the key', () => {
    const problems = validateContent('dishes.json', [{ ...validDish, publishAt: '2099-01-01' }]);
    expect(problems.some((p) => p.field === '[0].publishAt')).toBe(true);
    expect(messages(problems)).toMatch(/carries "publishAt", which this site does not use/);
  });

  // The malformed-date habit ("01-09-2026" for 1 September) that the deleted
  // validator existed for. It is refused now for a stronger reason than
  // being malformed: the field does not exist at all, so no shape of it is
  // acceptable and there is no date format left to get wrong.
  it('refuses a malformed publishAt just the same -- the field itself is gone, not just bad dates', () => {
    const problems = validateContent('dishes.json', [{ ...validDish, publishAt: '01-09-2026' }]);
    expect(problems.some((p) => p.field === '[0].publishAt')).toBe(true);
  });

  it('refuses publishAt on a drink', () => {
    const problems = validateContent('drinks.json', [{ ...validDrink, publishAt: '2099-01-01' }]);
    expect(problems.some((p) => p.field === '[0].publishAt')).toBe(true);
  });

  it('refuses publishAt on a press article', () => {
    const problems = validateContent('press.json', [{ ...newerArticle, publishAt: '2099-01-01' }, olderArticle]);
    expect(problems.some((p) => p.field === '[0].publishAt')).toBe(true);
  });

  // The other half of the same repair (review finding, Minor): sections.json
  // and pages.json lost the bespoke-section `publishAt` rejection and its
  // template-section format check and got nothing back, so this is where the
  // old guard's reach is restored -- generically, so the next retired field
  // needs no new rule.
  it('refuses publishAt on a built-in homepage section', () => {
    const [hero, ...rest] = validSections;
    const problems = validateContent('sections.json', [{ ...hero, publishAt: '2099-01-01' }, ...rest]);
    expect(problems.some((p) => p.field === '[0].publishAt')).toBe(true);
  });

  it('refuses publishAt on a template section, on the homepage and inside a page alike', () => {
    const templateSection = {
      kind: 'template',
      id: 'a-note',
      enabled: true,
      template: 'text',
      content: { heading: 'A note', paragraphs: ['One.'], whatsapp: null },
      publishAt: '2099-01-01',
    };
    const homepage = validateContent('sections.json', [...validSections, templateSection]);
    expect(homepage.some((p) => p.field === '[7].publishAt')).toBe(true);

    const page = validateContent('pages.json', [
      {
        slug: 'our-menu',
        name: 'Our Menu',
        inNav: true,
        enabled: true,
        seo: { title: 'Our Menu', description: 'A short description.' },
        sections: [templateSection],
      },
    ]);
    expect(page.some((p) => p.field === '[0].sections[0].publishAt')).toBe(true);
  });

  it('refuses publishAt on a page itself', () => {
    const problems = validateContent('pages.json', [
      {
        slug: 'our-menu',
        name: 'Our Menu',
        inNav: true,
        enabled: true,
        seo: { title: 'Our Menu', description: 'A short description.' },
        sections: [],
        publishAt: '2099-01-01',
      },
    ]);
    expect(problems.some((p) => p.field === '[0].publishAt')).toBe(true);
  });

  // Not a `publishAt` special case: the rule is "keys this type does not
  // have", so the typo that shape.test.ts's own header comment is about
  // ("publishedAt" for "publishAt") is refused by the identical path, and so
  // is anything else a future removal leaves behind.
  it('refuses an invented key, and names every one of them separately', () => {
    const problems = validateContent('dishes.json', [{ ...validDish, publishedAt: '2099-01-01', spiceLevel: 3 }]);
    expect(problems.map((p) => p.field).sort()).toEqual(['[0].publishedAt', '[0].spiceLevel']);
  });

  // Non-vacuous in the direction that matters: a rule that refused
  // everything would pass every test above while breaking every real
  // publish. Asserted against this file's own hand-built fixtures, not
  // against the committed JSON, for the reason its header comment gives.
  it('accepts a record carrying exactly the keys its type declares', () => {
    expect(validateContent('dishes.json', [validDish])).toEqual([]);
    expect(validateContent('drinks.json', [validDrink])).toEqual([]);
    expect(validateContent('press.json', [newerArticle, olderArticle])).toEqual([]);
    expect(validateContent('sections.json', validSections)).toEqual([]);
  });

  // `Object.prototype`'s own keys are not "known" -- guards.ts's
  // `unknownKeys` uses hasOwnProperty rather than `in` for exactly this, and
  // an `in` check would wave this through.
  it('refuses a key that merely exists on Object.prototype', () => {
    const problems = validateContent('dishes.json', [{ ...validDish, toString: 'not a function' }]);
    expect(problems.some((p) => p.field === '[0].toString')).toBe(true);
  });
});
