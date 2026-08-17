import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { site, posts } from '../content';

// M5 review fix: `plugins/sitemap.ts`'s own `writeBundle` hook OVERWRITES
// dist/sitemap.xml on every real build (Plan 7, Task 3, Step 3 -- it has to,
// to append every enabled page's own `/<slug>`) -- the static
// public/sitemap.xml this file used to read is what Vite copies into dist/
// BEFORE this plugin's own write, not what a crawler ever actually reaches.
// Gated the same way src/test/bundle.post-build.test.ts's own dist-dependent
// checks already are (src/test/collage-css.test.ts used to be a second
// example of the same pattern; Plan 9's split-tree rewrite deleted it along
// with the grid machinery it tested):
// `npm run test`/`npm run test:deploy` both run before `dist/` exists, so a
// bare `existsSync` alone can't tell "no dist/ yet" apart from "dist/
// should be here and isn't" -- see that file's own comment for the exact
// silent-reduction-to-nothing failure mode this convention exists to avoid.
// `test:bundle` (package.json) now lists this file too, so
// VB_REQUIRE_DIST=1 forces these to actually run, post-build, in the real
// deploy pipeline, not just whenever a developer happens to have a stale
// dist/ lying around locally.
const REQUIRED = !!process.env.VB_REQUIRE_DIST;
const DIST_SITEMAP = 'dist/sitemap.xml';

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

  // The pre-build source file this repo hand-maintains -- `/` and `/blogs`,
  // literally. Review fix (Minor #7, Phase 5 Task 8): plugins/sitemap.ts's
  // own STATIC_ROUTES is three entries now (`/`, `/blog`, `/blogs`), not the
  // same two this file has -- `/blog` needs no hand-authored line here
  // because it did not exist before this file's own generated replacement
  // (that plugin's `writeBundle`) did, so there was never a "base" state of
  // this file to keep it in sync with. Still worth pinning THIS file on its
  // own: if `/` or `/blogs` ever drifted here, the generated
  // dist/sitemap.xml below would drift with it (Vite copies this file into
  // dist/ before the plugin overwrites it -- see that module's own comment).
  it('lists the two static routes in the pre-build source file', () => {
    const xml = readFileSync('public/sitemap.xml', 'utf8');
    expect(xml).toContain(`<loc>${site.seo.url}/</loc>`);
    expect(xml).toContain(`<loc>${site.seo.url}/blogs</loc>`);
  });

  // The file a real crawler actually reaches: plugins/sitemap.ts's own
  // `writeBundle` hook overwrites public/sitemap.xml's own copy in dist/
  // with a freshly generated one on every build, appending every enabled
  // page. Nothing pinned THIS file before this fix -- plugins/__tests__/
  // sitemap.test.ts covers the plugin's pure functions and its own isolated
  // fixture build, but not that its write wins over Vite's public-dir copy
  // in the REAL build, and not what the real site's own sitemap actually
  // contains post-build.
  it.skipIf(!REQUIRED && !existsSync(DIST_SITEMAP))('lists every public route in the built dist/sitemap.xml -- the file a crawler actually reaches', () => {
    const xml = readFileSync(DIST_SITEMAP, 'utf8');
    expect(xml).toContain(`<loc>${site.seo.url}/</loc>`);
    expect(xml).toContain(`<loc>${site.seo.url}/blog</loc>`);
    expect(xml).toContain(`<loc>${site.seo.url}/blogs</loc>`);
    // Phase 5, Task 8: every committed post's own /blog/<slug>, read off the
    // real posts array rather than hand-typed, so this test tracks
    // posts.json rather than needing its own edit the next time someone
    // publishes.
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(xml).toContain(`<loc>${site.seo.url}/blog/${post.slug}</loc>`);
    }
  });

  it.skipIf(!REQUIRED && !existsSync(DIST_SITEMAP))('does not advertise the unrouted admin or reservation pages in the built dist/sitemap.xml', () => {
    const xml = readFileSync(DIST_SITEMAP, 'utf8');
    expect(xml).not.toContain('/admin');
    expect(xml).not.toContain('/reservation');
  });
});
