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
  // prevents -- keeping /edit and /edit/manage out of search results.
  //
  // Post-review Fix 6: the original pin here was `'Disallow: /edit/'` --
  // with the trailing slash. Per RFC 9309's prefix matching (Google's own
  // /fish/-vs-/fish example), a rule ending in a slash matches only paths
  // that themselves start with that slash-terminated prefix, so
  // `Disallow: /edit/` never covered the bare `/edit` route Plan 5 Task 2
  // added -- only `/edit/manage`. The old test was pinning the wrong
  // string: it stayed green while the actual crawlable route sat outside
  // the rule it was supposedly guarding. Corrected to the no-trailing-slash
  // form below, which covers both.
  it('disallows crawlers from the admin route, including the bare /edit route', () => {
    const robots = readFileSync('public/robots.txt', 'utf8');
    expect(robots).toMatch(/^Disallow: \/edit\s*$/m);
  });

  // The test above pins the exact line; this one proves what that line
  // actually MATCHES, using real RFC 9309 prefix semantics (a simple
  // `path.startsWith(rule)`, the same test Google's own robots.txt docs use
  // to explain why `/fish/` does not cover `/fish`) rather than a substring
  // `.toContain` check on the rule text alone -- the exact gap that let the
  // old `/edit/` rule pass its own pin while covering nothing at the bare
  // route.
  it('the disallow rule, matched as a real robots.txt prefix rule, covers both /edit and /edit/manage', () => {
    const robots = readFileSync('public/robots.txt', 'utf8');
    const match = robots.match(/^Disallow:\s*(\S+)/m);
    expect(match).not.toBeNull();
    const rule = match![1];
    const coversPath = (path: string) => path.startsWith(rule);
    expect(coversPath('/edit')).toBe(true);
    expect(coversPath('/edit/manage')).toBe(true);
    // And, for contrast, the trailing-slash form this replaces really would
    // have failed the bare route -- confirmed directly, not asserted from
    // the RFC alone.
    expect('/edit'.startsWith('/edit/')).toBe(false);
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
