import { describe, it, expect } from 'vitest';
import { validateContent } from '../validate';
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

// Whole-branch review, Important 3: validateContent had no rule for
// `publishAt` at all. Verified directly: POST /api/publish with
// {"publishAt":"01-09-2026"} -- the DD-MM date-format habit -- returned 200
// and the commit landed on `main`, where the build's own guard then fails
// it, and stays failed for every subsequent publish of any file until she
// happens to re-edit that one field. A field that isn't even present here
// (`publishAt` was simply absent from the type this suite's other fixtures
// use) is exactly what "no rule for it at all" means, so these are new
// fixtures, not edits to the existing valid ones above.
describe('validateContent: publishAt (Important 3, whole-branch review)', () => {
  it('accepts a dish with no publishAt at all -- the ordinary case', () => {
    expect(validateContent('dishes.json', [validDish])).toEqual([]);
  });

  it('accepts a dish with a well-formed future publishAt', () => {
    const problems = validateContent('dishes.json', [{ ...validDish, publishAt: '2099-01-01' }]);
    expect(problems).toEqual([]);
  });

  it('refuses a dish with a day/month-swapped publishAt, the DD-MM habit', () => {
    const problems = validateContent('dishes.json', [{ ...validDish, publishAt: '01-09-2026' }]);
    expect(messages(problems)).toMatch(/publishAt/i);
  });

  it('refuses a dish with a publishAt that is not a real calendar date', () => {
    const problems = validateContent('dishes.json', [{ ...validDish, publishAt: '2026-02-30' }]);
    expect(messages(problems)).toMatch(/publishAt/i);
  });

  it('refuses a drink with a malformed publishAt the same way', () => {
    const problems = validateContent('drinks.json', [{ ...validDrink, publishAt: 'next tuesday' }]);
    expect(messages(problems)).toMatch(/publishAt/i);
  });

  it('accepts a drink with no publishAt at all', () => {
    expect(validateContent('drinks.json', [validDrink])).toEqual([]);
  });

  it('refuses a press article with a malformed publishAt the same way', () => {
    const problems = validateContent('press.json', [{ ...newerArticle, publishAt: '2026-13-01' }]);
    expect(messages(problems)).toMatch(/publishAt/i);
  });

  it('accepts a press article with no publishAt at all', () => {
    expect(validateContent('press.json', [newerArticle])).toEqual([]);
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
