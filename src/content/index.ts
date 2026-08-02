import siteRaw from './site.json';
import galleriesRaw from './galleries.json';
import dishesRaw from './dishes.json';
import drinksRaw from './drinks.json';
import pressRaw from './press.json';
import storyRaw from './story.json';
import menusRaw from './menus.json';
import type {
  SiteContent,
  Galleries,
  Dish,
  Drink,
  Article,
  StoryContent,
  MenuFile,
  Hours,
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

export * from './types';
