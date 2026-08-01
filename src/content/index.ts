import siteRaw from './site.json';
import type { SiteContent } from './types';

export const site = siteRaw as SiteContent;

export function collectAssetPaths(): string[] {
  return [site.seo.ogImage];
}

export * from './types';
