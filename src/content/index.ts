import siteRaw from './site.json';
import galleriesRaw from './galleries.json';
import dishesRaw from './dishes.json';
import type { SiteContent, Galleries, Dish } from './types';

export const site: SiteContent = siteRaw;
export const galleries: Galleries = galleriesRaw;
export const dishes: Dish[] = dishesRaw;

export * from './types';
