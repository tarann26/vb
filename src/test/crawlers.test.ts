import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { site } from '../content';

describe('crawler files', () => {
  it('serves robots.txt pointing at the sitemap', () => {
    expect(existsSync('public/robots.txt')).toBe(true);
    expect(readFileSync('public/robots.txt', 'utf8')).toContain(`${site.seo.url}/sitemap.xml`);
  });

  it('lists every public route in the sitemap', () => {
    const xml = readFileSync('public/sitemap.xml', 'utf8');
    expect(xml).toContain(`<loc>${site.seo.url}/</loc>`);
    expect(xml).toContain(`<loc>${site.seo.url}/blogs</loc>`);
  });

  it('does not advertise the unrouted admin or reservation pages', () => {
    const xml = readFileSync('public/sitemap.xml', 'utf8');
    expect(xml).not.toContain('/admin');
    expect(xml).not.toContain('/reservation');
  });
});
