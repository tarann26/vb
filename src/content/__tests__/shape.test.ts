import { describe, it, expect } from 'vitest';
import { site, story, dishes, drinks, press, menus, galleries } from '../index';
import type { Dish, Drink, Article } from '../types';

// Types catch a missing field at build time. Nothing catches an *empty* one
// -- and the it.each/forEach loops elsewhere in this suite become vacuous
// once the array they iterate is emptied, so an edit like `site.hours: []`
// or `story.paragraphs: []` keeps the rest of the suite green while
// breaking the live page. This file is the guardrail against that: every
// collection must be non-empty, and every required string field must not
// be blank or whitespace-only.
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

describe('site content is present and non-empty', () => {
  it('has a non-empty name', () => {
    expect(isBlank(site.name)).toBe(false);
  });

  it('has a non-empty tagline', () => {
    expect(isBlank(site.tagline)).toBe(false);
  });

  it('has at least one phone number', () => {
    expect(site.phones.length).toBeGreaterThan(0);
  });

  it.each(site.phones.map((phone, i) => [i, phone] as const))(
    'phones[%i] is not blank',
    (_i, phone) => {
      expect(isBlank(phone)).toBe(false);
    },
  );

  it('has at least one hours entry', () => {
    expect(site.hours.length).toBeGreaterThan(0);
  });

  it.each(site.hours.map((h, i) => [i, h] as const))(
    'hours[%i] has a non-empty days list and opens/closes',
    (_i, h) => {
      expect(h.days.length).toBeGreaterThan(0);
      expect(isBlank(h.opens)).toBe(false);
      expect(isBlank(h.closes)).toBe(false);
    },
  );

  it('has a complete, non-blank address', () => {
    expect(isBlank(site.address.street)).toBe(false);
    expect(isBlank(site.address.locality)).toBe(false);
    expect(isBlank(site.address.postalCode)).toBe(false);
    expect(isBlank(site.address.country)).toBe(false);
  });

  it('has a non-blank WhatsApp number and message', () => {
    expect(isBlank(site.whatsapp.number)).toBe(false);
    expect(isBlank(site.whatsapp.prefilledMessage)).toBe(false);
  });

  it('has a non-blank Instagram link', () => {
    expect(isBlank(site.socials.instagram)).toBe(false);
  });

  it('has non-blank SEO title and description', () => {
    expect(isBlank(site.seo.title)).toBe(false);
    expect(isBlank(site.seo.description)).toBe(false);
  });
});

describe('story content is present and non-empty', () => {
  it('has a non-blank heading', () => {
    expect(isBlank(story.heading)).toBe(false);
  });

  it('has at least one paragraph', () => {
    expect(story.paragraphs.length).toBeGreaterThan(0);
  });

  it.each(story.paragraphs.map((p, i) => [i, p] as const))(
    'paragraphs[%i] is not blank',
    (_i, p) => {
      expect(isBlank(p)).toBe(false);
    },
  );
});

describe('collections are non-empty', () => {
  it('has at least one dish', () => {
    expect(dishes.length).toBeGreaterThan(0);
  });

  it('has at least one drink', () => {
    expect(drinks.length).toBeGreaterThan(0);
  });

  it('has at least one press article', () => {
    expect(press.length).toBeGreaterThan(0);
  });

  it('has at least one downloadable menu', () => {
    expect(menus.length).toBeGreaterThan(0);
  });

  it('has at least one atmosphere image', () => {
    expect(galleries.atmosphere.length).toBeGreaterThan(0);
  });

  it('has at least one Our Story image', () => {
    expect(galleries.ourStory.length).toBeGreaterThan(0);
  });

  it('has at least one hero collage image', () => {
    expect(galleries.heroCollage.length).toBeGreaterThan(0);
  });
});

describe('dish required fields are non-blank', () => {
  it.each(dishes.map((d) => [d.id, d] as const))(
    '%s has non-blank id, name, description and image',
    (_id, dish) => {
      expect(isBlank(dish.id)).toBe(false);
      expect(isBlank(dish.name)).toBe(false);
      expect(isBlank(dish.description)).toBe(false);
      expect(isBlank(dish.image)).toBe(false);
    },
  );
});

describe('drink required fields are non-blank', () => {
  it.each(drinks.map((d) => [d.id, d] as const))(
    '%s has non-blank id, name and description',
    (_id, drink) => {
      expect(isBlank(drink.id)).toBe(false);
      expect(isBlank(drink.name)).toBe(false);
      expect(isBlank(drink.description)).toBe(false);
    },
  );
});

describe('press article required fields are non-blank', () => {
  it.each(press.map((a) => [a.id, a] as const))(
    '%s has non-blank id, title, publication, date, excerpt and image',
    (_id, article) => {
      expect(isBlank(article.id)).toBe(false);
      expect(isBlank(article.title)).toBe(false);
      expect(isBlank(article.publication)).toBe(false);
      expect(isBlank(article.date)).toBe(false);
      expect(isBlank(article.excerpt)).toBe(false);
      expect(isBlank(article.image)).toBe(false);
      // article.url is legitimately null for entries awaiting a founder-
      // supplied link (see press.test.tsx); only check it when present.
      if (article.url !== null) {
        expect(isBlank(article.url)).toBe(false);
      }
    },
  );
});

// `dishesRaw`/`drinksRaw`/`pressRaw` are assigned into `Dish[]`/`Drink[]`/
// `Article[]` in index.ts through a type annotation or a spread, neither of
// which excess-property-checks -- TypeScript only excess-property-checks
// object *literals* assigned directly to a typed position, never a value
// that merely structurally matches. So a typo'd or entirely invented key on
// a real content item compiles clean and ships, with `tsc -b` green and the
// build succeeding, while whatever the author expected that key to do
// silently never happens. Confirmed directly: an extra key on a real dish
// left `tsc -b --noEmit` exit 0, `vitest run` all green (before this guard
// existed), `npm run build` exit 0, and the dish shipped in `dist/assets/`
// with the stray key intact.
//
// `Record<keyof X, true>` gets this the same compile-time completeness
// `SECTION_ID_SET` already relies on in guards.ts: if `Dish`/`Drink`/
// `Article` gains a field, the corresponding record below fails to compile
// until it's added here too, so this list can't silently drift out of sync
// with the real type the way a hand-written `string[]` could.
const DISH_KEYS: Record<keyof Dish, true> = {
  id: true,
  name: true,
  description: true,
  image: true,
  tags: true,
};
const DRINK_KEYS: Record<keyof Drink, true> = {
  id: true,
  name: true,
  description: true,
  category: true,
  image: true,
};
const ARTICLE_KEYS: Record<keyof Article, true> = {
  id: true,
  title: true,
  publication: true,
  date: true,
  excerpt: true,
  url: true,
  image: true,
};

function unknownKeys(item: object, knownKeys: Record<string, true>): string[] {
  return Object.keys(item).filter((key) => !(key in knownKeys));
}

describe('content items carry no keys outside their type -- a typo is silent otherwise', () => {
  it.each(dishes.map((d) => [d.id, d] as const))('dish %s has only known keys', (id, dish) => {
    expect(unknownKeys(dish, DISH_KEYS), `dish "${id}"`).toEqual([]);
  });

  it.each(drinks.map((d) => [d.id, d] as const))('drink %s has only known keys', (id, drink) => {
    expect(unknownKeys(drink, DRINK_KEYS), `drink "${id}"`).toEqual([]);
  });

  it.each(press.map((a) => [a.id, a] as const))('press %s has only known keys', (id, article) => {
    expect(unknownKeys(article, ARTICLE_KEYS), `press "${id}"`).toEqual([]);
  });
});

describe('menu required fields are non-blank', () => {
  it.each(menus.map((m) => [m.id, m] as const))(
    '%s has non-blank id, label and file',
    (_id, menu) => {
      expect(isBlank(menu.id)).toBe(false);
      expect(isBlank(menu.label)).toBe(false);
      expect(isBlank(menu.file)).toBe(false);
    },
  );
});

describe('gallery image required fields are non-blank', () => {
  it.each(galleries.atmosphere.map((img, i) => [i, img] as const))(
    'atmosphere[%i] has non-blank src and alt',
    (_i, img) => {
      expect(isBlank(img.src)).toBe(false);
      expect(isBlank(img.alt)).toBe(false);
    },
  );

  it.each(galleries.ourStory.map((img, i) => [i, img] as const))(
    'ourStory[%i] has non-blank src and alt',
    (_i, img) => {
      expect(isBlank(img.src)).toBe(false);
      expect(isBlank(img.alt)).toBe(false);
    },
  );

  it.each(galleries.heroCollage.map((img, i) => [i, img] as const))(
    'heroCollage[%i] has non-blank src and className',
    (_i, img) => {
      expect(isBlank(img.src)).toBe(false);
      expect(isBlank(img.className)).toBe(false);
    },
  );
});
