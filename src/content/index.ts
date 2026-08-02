import siteRaw from './site.json';
import galleriesRaw from './galleries.json';
import dishesRaw from './dishes.json';
import drinksRaw from './drinks.json';
import pressRaw from './press.json';
import storyRaw from './story.json';
import menusRaw from './menus.json';
import copyRaw from './copy.json';
import type {
  SiteContent,
  Galleries,
  Dish,
  Drink,
  Article,
  StoryContent,
  MenuFile,
  Hours,
  Copy,
} from './types';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/; // 24-hour "HH:MM"

// site.json's `hours[].days` field is a plain string[] in the JSON module's
// inferred type, wider than Hours['days'] (DayCode[]). As with drinks.category
// below, an annotation alone can't narrow it and a blind `as` would silently
// accept a typo'd day code (e.g. "Xx", which hours.ts's WEEK_ORDER.indexOf
// would read as -1 and misreport as contiguous with Monday), an empty `days`
// array, or a malformed opens/closes string. This guard narrows via runtime
// checks instead, so any of those throw at import time rather than rendering
// "undefined" text or bad JSON-LD to a customer.
export function assertHours(raw: { days: string[]; opens: string; closes: string }): Hours {
  if (raw.days.length === 0) {
    throw new Error('content/site.json: an hours entry has an empty "days" array');
  }
  const days = raw.days.map((day) => {
    if (
      day !== 'Mo' &&
      day !== 'Tu' &&
      day !== 'We' &&
      day !== 'Th' &&
      day !== 'Fr' &&
      day !== 'Sa' &&
      day !== 'Su'
    ) {
      throw new Error(`content/site.json: invalid day code "${day}" in hours entry`);
    }
    return day;
  });
  if (!TIME_PATTERN.test(raw.opens)) {
    throw new Error(`content/site.json: invalid "opens" time "${raw.opens}", expected 24-hour HH:MM`);
  }
  if (!TIME_PATTERN.test(raw.closes)) {
    throw new Error(`content/site.json: invalid "closes" time "${raw.closes}", expected 24-hour HH:MM`);
  }
  return { days, opens: raw.opens, closes: raw.closes };
}

export const site: SiteContent = {
  ...siteRaw,
  hours: siteRaw.hours.map(assertHours),
};
export const galleries: Galleries = galleriesRaw;
export const dishes: Dish[] = dishesRaw;
export const press: Article[] = pressRaw;
export const story: StoryContent = storyRaw;
export const menus: MenuFile[] = menusRaw;

// drinks.json's `category` field is a plain string in the JSON module's inferred
// type, wider than Drink['category']. A type annotation alone can't narrow it and
// a blind `as Drink[]` would silently accept a typo'd category. This guard
// narrows via runtime equality checks instead, so an invalid category throws.
export const drinks: Drink[] = drinksRaw.map((raw) => {
  const { category } = raw;
  if (category !== 'mocktail' && category !== 'cocktail' && category !== 'wine') {
    throw new Error(`content/drinks.json: invalid category "${category}" for drink "${raw.id}"`);
  }
  return { ...raw, category };
});

// Recurses through the raw copy.json shape checking every string leaf for
// blank content, building a dotted/bracketed path (e.g. "footer.followLabel"
// or "nav.links[0].label") for the error message.
function assertNonBlank(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      throw new Error(`content/copy.json: "${path}" must not be blank`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNonBlank(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, v]) =>
      assertNonBlank(v, path ? `${path}.${key}` : key),
    );
  }
}

// Every field in Copy is already `string` (or an array of a string-only
// record), so a plain type annotation on copyRaw type-checks fine without
// this guard -- unlike drinks.category or hours.days, nothing here needs
// runtime narrowing. What a type annotation cannot catch is a field left
// blank, or the nav link list emptied out entirely (still a valid
// `NavLink[]`, just one with no links to render). This guard rejects both,
// naming the offending path so a bad edit to copy.json fails loudly at
// import time instead of rendering invisible text or a menu with nothing in
// it.
export function assertCopy(raw: unknown): Copy {
  const navLinks = (raw as { nav?: { links?: unknown[] } }).nav?.links;
  if (!Array.isArray(navLinks) || navLinks.length === 0) {
    throw new Error('content/copy.json: "nav.links" must not be empty');
  }
  assertNonBlank(raw, '');
  return raw as Copy;
}

// `satisfies Copy` restores the compile-time structural check that
// `assertCopy`'s `unknown` parameter (needed so the test fixtures in
// copy.test.ts, which are deliberately not shaped like Copy, can still be
// passed to it) otherwise erases. Without it, a copy.json missing an entire
// section still type-checks -- `assertNonBlank` only walks keys that are
// present, so a missing section is invisible to the runtime guard too, and
// the failure mode becomes a browser-time crash instead of a build failure.
export const copy: Copy = assertCopy(copyRaw satisfies Copy);

export * from './types';
