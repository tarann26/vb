import { describe, it, expect } from 'vitest';
// Direct JSON imports, not `../../content` (index.ts): that file is the
// stale build-time snapshot Task 3 replaces, and importing it here would
// drag all nine content JSON files into whatever imports this test's
// helpers. copy.json and site.json are imported directly instead -- the
// same thing fields.ts itself would need to avoid, if it ever needed real
// content (it doesn't; every descriptor there is a hand-written literal).
import copyRaw from '../../content/copy.json';
import siteRaw from '../../content/site.json';
import {
  DISH_FIELDS,
  DRINK_FIELDS,
  ARTICLE_FIELDS,
  SECTION_FIELDS,
  MENU_FIELDS,
  GALLERY_IMAGE_FIELDS,
  HOURS_FIELDS,
  COPY_FIELDS,
  SITE_FIELDS,
} from '../fields';

// Every FieldsOf<T> descriptor already gets its completeness and shape
// checked by tsc -b at every build -- that is this whole task's point, and
// re-asserting `Object.keys(...).sort()` here would be the exact test
// task-2-brief.md warns against: it cannot fail on the defect it would
// claim to catch (mutate FieldsOf<Dish> to Record<string, FieldSpec> and an
// assertion like that stays green). This file instead checks the one thing
// tsc cannot: that each descriptor actually renders something -- a label
// worth reading and a `kind` the dashboard knows how to draw.
const ALL_KNOWN_KINDS = ['text', 'textarea', 'image', 'select', 'date', 'readonly', 'tags', 'toggle', 'number'];

function checkSpecs(specs: Record<string, { label: string; kind: string }>) {
  Object.entries(specs).forEach(([key, spec]) => {
    expect(spec.label.trim().length, `${key}.label`).toBeGreaterThan(0);
    expect(ALL_KNOWN_KINDS, `${key}.kind`).toContain(spec.kind);
  });
}

describe('every descriptor has a non-empty label and a real kind', () => {
  it('DISH_FIELDS', () => checkSpecs(DISH_FIELDS));
  it('DRINK_FIELDS', () => checkSpecs(DRINK_FIELDS));
  it('ARTICLE_FIELDS', () => checkSpecs(ARTICLE_FIELDS));
  it('SECTION_FIELDS', () => checkSpecs(SECTION_FIELDS));
  it('MENU_FIELDS', () => checkSpecs(MENU_FIELDS));
  it('GALLERY_IMAGE_FIELDS', () => checkSpecs(GALLERY_IMAGE_FIELDS));
  it('HOURS_FIELDS', () => checkSpecs(HOURS_FIELDS));
  it('COPY_FIELDS', () => checkSpecs(COPY_FIELDS));
  it('SITE_FIELDS', () => checkSpecs(SITE_FIELDS));
});

describe('DISH_FIELDS.category-equivalent controlled vocabularies carry their options', () => {
  it('DRINK_FIELDS.category lists the same three categories assertDrinkCategory accepts', () => {
    // Hand-checked against src/content/guards.ts's assertDrinkCategory
    // rather than imported from it, so this test does not silently pass by
    // comparing the same list to itself if that function's own list ever
    // drifted.
    expect(DRINK_FIELDS.category.options).toEqual(['mocktail', 'cocktail', 'wine']);
  });
});

// `Dish.tags` is authored but not rendered anywhere on the site today
// (src/content/types.ts's comment on the field). An editing tool that
// doesn't say so risks the owner assuming her edit changed something a
// diner sees. This is the one field.help string this suite pins by
// content, not just presence -- everything else only needs a label and a
// known kind (checked generically above).
describe('the two field.help strings task-2-brief.md calls out by name', () => {
  it('DISH_FIELDS.tags warns that tags are not rendered on the site yet', () => {
    expect(DISH_FIELDS.tags.help).toMatch(/not (yet )?(shown|rendered|visible)/i);
  });

  it("COPY_FIELDS['press.readArticle'] says it drives both the homepage teaser and /blogs", () => {
    expect(COPY_FIELDS['press.readArticle'].help).toMatch(/homepage/i);
    expect(COPY_FIELDS['press.readArticle'].help).toMatch(/blogs/i);
  });
});

describe("SITE_FIELDS marks name, tagline and every seo.* field read-only", () => {
  it.each(['name', 'tagline', 'seo.title', 'seo.description', 'seo.keywords', 'seo.ogImage', 'seo.url', 'seo.locale'] as const)(
    '%s is kind: readonly',
    (key) => {
      expect(SITE_FIELDS[key].kind).toBe('readonly');
    },
  );

  it('strapline is NOT read-only -- only the fields index.html duplicates are', () => {
    expect(SITE_FIELDS.strapline.kind).not.toBe('readonly');
  });
});

// The leaf-coverage check below is deliberately content-coupled: copy.json's
// and site.json's *shape* -- which fields exist -- is developer-owned even
// though their *values* are the owner's, the same reasoning
// src/content/__tests__/shape.test.ts already applies to dishes/drinks/press
// via DISH_KEYS. `keyof Copy`/`keyof SiteContent` can't drive this
// completeness check at the type level (see fields.ts's own comment on
// CopyLeafShape/SiteLeafShape for why), so it runs here instead, against the
// real, committed JSON.
//
// Any array-of-objects field (Copy.nav.links, SiteContent.hours) is not a
// leaf any FieldSpec kind can describe (Kind<V> in fields.ts has no branch
// that produces one for an array of objects) and is skipped entirely, not
// recursed into. An array of strings (SiteContent.phones) IS a leaf -- kind
// 'tags' describes the whole array as one field -- so it is collected as
// one path, not expanded per element.
function collectLeafPaths(value: unknown, prefix: string, out: string[]): void {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push(prefix);
    return;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) out.push(prefix);
    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, v]) => collectLeafPaths(v, prefix ? `${prefix}.${key}` : key, out));
  }
  // `value === null` (e.g. Drink.image, SiteContent.socials.linkedin) is
  // deliberately not collected as a leaf: this walk only ever runs over
  // copy.json and site.json, and site.json's `socials.linkedin` is a
  // non-null URL today, so this branch does not currently fire -- it exists
  // only so a future null value here fails loudly by omission (missing from
  // `paths`, so the "no orphaned entry" direction below stays meaningful)
  // rather than by silently miscounting.
}

describe('COPY_FIELDS covers every editable leaf in the real, committed copy.json', () => {
  const paths: string[] = [];
  collectLeafPaths(copyRaw, '', paths);

  it('the walk actually found leaves (a regression in the walker itself would make every check below vacuous)', () => {
    expect(paths.length).toBeGreaterThan(20);
  });

  it.each(paths)('copy.json leaf "%s" has a COPY_FIELDS entry', (path) => {
    expect(Object.prototype.hasOwnProperty.call(COPY_FIELDS, path), path).toBe(true);
  });

  it('has no COPY_FIELDS entry that does not correspond to a real leaf in copy.json', () => {
    const orphaned = Object.keys(COPY_FIELDS).filter((key) => !paths.includes(key));
    expect(orphaned).toEqual([]);
  });
});

describe('SITE_FIELDS covers every editable leaf in the real, committed site.json (hours[] excluded, edited via HOURS_FIELDS)', () => {
  const paths: string[] = [];
  collectLeafPaths(siteRaw, '', paths);

  it('the walk actually found leaves', () => {
    expect(paths.length).toBeGreaterThan(10);
  });

  it.each(paths)('site.json leaf "%s" has a SITE_FIELDS entry', (path) => {
    expect(Object.prototype.hasOwnProperty.call(SITE_FIELDS, path), path).toBe(true);
  });

  it('has no SITE_FIELDS entry that does not correspond to a real leaf in site.json', () => {
    const orphaned = Object.keys(SITE_FIELDS).filter((key) => !paths.includes(key));
    expect(orphaned).toEqual([]);
  });

  it('excludes hours[] from the walk entirely (array of objects, not a leaf)', () => {
    expect(paths).not.toContain('hours');
    expect(paths.some((p) => p.startsWith('hours'))).toBe(false);
  });
});
