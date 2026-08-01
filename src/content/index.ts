import siteRaw from './site.json';
import galleriesRaw from './galleries.json';
import type { SiteContent, Galleries } from './types';

export const site: SiteContent = siteRaw;
export const galleries: Galleries = galleriesRaw;

export * from './types';
