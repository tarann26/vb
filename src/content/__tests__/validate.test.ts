import { describe, it, expect } from 'vitest';
import { validateContent } from '../validate';
import type { Dish, Drink, Article, StoryContent, Copy, Section, SiteContent, Galleries, MenuFile } from '../types';

import sectionsRaw from '../sections.json';
import siteRaw from '../site.json';
import galleriesRaw from '../galleries.json';
import menusRaw from '../menus.json';

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
    mocktails: 'Mocktails',
    cocktails: 'Cocktails',
    wine: 'Wine',
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
  { id: 'hero', enabled: true },
  { id: 'ourStory', enabled: true },
  { id: 'atmosphere', enabled: true },
  { id: 'food', enabled: true },
  { id: 'drinks', enabled: true },
  { id: 'press', enabled: true },
  { id: 'visit', enabled: true },
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
  heroCollage: [{ src: '/hero/c.webp', className: 'col-span-1' }],
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

// Beyond the three moved rules: proof that the remaining default-deny
// files (sections.json, site.json, galleries.json, menus.json) are wired
// to a real rule and not silently accepting everything.

describe('validateContent: structural rules on the remaining files', () => {
  it('rejects sections.json with hero disabled', () => {
    const bad = structuredClone(sectionsRaw).map((s) => (s.id === 'hero' ? { ...s, enabled: false } : s));
    const problems = validateContent('sections.json', bad);
    expect(messages(problems)).toMatch(/hero/i);
  });

  it('rejects site.json with no phone numbers', () => {
    const bad = { ...structuredClone(siteRaw), phones: [] };
    const problems = validateContent('site.json', bad);
    expect(messages(problems)).toMatch(/phone/i);
  });

  it('rejects galleries.json with an image missing alt text', () => {
    const bad = structuredClone(galleriesRaw);
    bad.atmosphere[0].alt = '';
    const problems = validateContent('galleries.json', bad);
    expect(messages(problems)).toMatch(/alt/i);
  });

  it('rejects menus.json with a menu missing a label', () => {
    const bad = structuredClone(menusRaw);
    bad[0].label = '';
    const problems = validateContent('menus.json', bad);
    expect(messages(problems)).toMatch(/label/i);
  });

  it('rejects copy.json with a blank required field', () => {
    const bad = { ...validCopy, atmosphere: { heading: '   ' } };
    const problems = validateContent('copy.json', bad);
    expect(messages(problems)).toMatch(/atmosphere/i);
  });
});
