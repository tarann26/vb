import siteRaw from './site.json';
import galleriesRaw from './galleries.json';
import dishesRaw from './dishes.json';
import drinksRaw from './drinks.json';
import pressRaw from './press.json';
import type { SiteContent, Galleries, Dish, Drink, Article } from './types';

export const site: SiteContent = siteRaw;
export const galleries: Galleries = galleriesRaw;
export const dishes: Dish[] = dishesRaw;
export const press: Article[] = pressRaw;

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
