import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { site } from '../content';

describe('crawler files', () => {
  it('serves robots.txt pointing at the sitemap', () => {
    expect(existsSync('public/robots.txt')).toBe(true);
    expect(readFileSync('public/robots.txt', 'utf8')).toContain(`${site.seo.url}/sitemap.xml`);
  });

  // M-6: nothing pinned this before -- the line was present in
  // public/robots.txt but nothing would have caught it being dropped or
  // typo'd. Not a security control on its own (the login gate is that); a
  // well-behaved crawler honoring this is the only thing it actually
  // prevents -- keeping /edit/manage out of search results.
  it('disallows crawlers from the admin route', () => {
    expect(readFileSync('public/robots.txt', 'utf8')).toContain('Disallow: /edit/');
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
