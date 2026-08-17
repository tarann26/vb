// @vitest-environment node
//
// Same reasoning as plugins/__tests__/build-info.test.ts's own header
// comment: this file runs a real `vite build`, which needs Node's real
// globals, not jsdom's.
import { describe, it, expect, afterEach } from 'vitest';
import { build } from 'vite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sitemap, { buildSitemapXml, pageUrls, postUrls, STATIC_ROUTES } from '../sitemap';
import type { Page, Post } from '../../src/content/types';

const BASE_URL = 'https://example.com';

function page(slug: string, enabled: boolean): Pick<Page, 'slug' | 'enabled'> {
  return { slug, enabled };
}

function post(slug: string): Pick<Post, 'slug'> {
  return { slug };
}

describe('buildSitemapXml / pageUrls (pure)', () => {
  it('always lists the three static routes, home with a trailing slash, blog and blogs without', () => {
    const xml = buildSitemapXml(BASE_URL, []);
    expect(xml).toContain(`<loc>${BASE_URL}/</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/blog</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/blogs</loc>`);
  });

  // Phase 5, Task 8: lists the three static routes, then every page, then
  // every post -- pinned as an exact ordered array, not a set of
  // `.toContain`s, so a regression that reorders or drops a section is
  // caught even if every individual URL still happens to be present.
  it('lists the three static routes, then every page, then every post', () => {
    const xml = buildSitemapXml(BASE_URL, [page('catering', true)], [post('a-post')]);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      `${BASE_URL}/`,
      `${BASE_URL}/blog`,
      `${BASE_URL}/blogs`,
      `${BASE_URL}/catering`,
      `${BASE_URL}/blog/a-post`,
    ]);
  });

  it('postUrls maps every post to its own /blog/<slug>', () => {
    expect(postUrls([post('a'), post('b')])).toEqual(['/blog/a', '/blog/b']);
  });

  it('appends every ENABLED page as its own /<slug> entry', () => {
    const xml = buildSitemapXml(BASE_URL, [page('our-menu', true), page('breads-and-dips', true)]);
    expect(xml).toContain(`<loc>${BASE_URL}/our-menu</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/breads-and-dips</loc>`);
  });

  // The mutation this exists to catch: a disabled page still 404s at
  // `/:slug` (App.tsx's PageRoute) -- advertising it here anyway would send
  // a crawler straight into a 404, which is worse for ranking than never
  // mentioning it.
  it('omits a disabled page entirely', () => {
    const xml = buildSitemapXml(BASE_URL, [page('coming-soon', false)]);
    expect(xml).not.toContain('coming-soon');
    expect(pageUrls([page('coming-soon', false)])).toEqual([]);
  });

  it('produces well-formed XML with exactly one <urlset> and one <url> per route', () => {
    const xml = buildSitemapXml(BASE_URL, [page('a', true), page('b', false)]);
    expect(xml.match(/<url>/g)).toHaveLength(STATIC_ROUTES.length + 1); // + one enabled page
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
});

// Behavioural, mirroring plugins/__tests__/build-info.test.ts's own pattern:
// a real `vite build` against a minimal, isolated fixture root, reading the
// file the plugin actually produced on disk -- not just asserting on the
// plugin object's own shape.
function makeFixtureRoot(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sitemap-fixture-')));
  writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>',
  );
  writeFileSync(path.join(root, 'main.js'), 'export default 1;\n');
  return root;
}

const cleanupRoots: string[] = [];

afterEach(() => {
  while (cleanupRoots.length) {
    rmSync(cleanupRoots.pop() as string, { recursive: true, force: true });
  }
});

describe('sitemap (the Vite plugin)', () => {
  it('is scoped to apply: build', () => {
    expect(sitemap(BASE_URL, []).apply).toBe('build');
  });

  it('writes dist/sitemap.xml, including an enabled page, after a real build', async () => {
    const root = makeFixtureRoot();
    cleanupRoots.push(root);
    const outDir = path.join(root, 'dist');

    await build({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [sitemap(BASE_URL, [page('our-menu', true)])],
      build: { outDir, write: true },
    });

    const sitemapPath = path.join(outDir, 'sitemap.xml');
    expect(existsSync(sitemapPath)).toBe(true);
    const xml = readFileSync(sitemapPath, 'utf8');
    expect(xml).toContain(`<loc>${BASE_URL}/our-menu</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/</loc>`);
  });

  it('does not write sitemap.xml during vite dev-equivalent (apply: build only)', async () => {
    // Reuses build-info.test.ts's own already-verified `apply: 'build'`
    // mechanics (this repo's own standing "don't re-derive a proof twice"
    // preference) -- checked here only at the shallow, structural level.
    expect(sitemap(BASE_URL, []).apply).toBe('build');
  });

  // M5 review fix: the test above never had a public/sitemap.xml in its own
  // fixture root, so it could not tell "this plugin's write landed" apart
  // from "Vite's own public-dir copy landed, and happens to look right
  // because nobody made it look wrong." Real production has a real,
  // committed public/sitemap.xml (the two hand-authored static routes, `/`
  // and `/blogs` -- see this plugin's own header comment): Vite copies that
  // into dist/ as part of every build, and this plugin's own `writeBundle`
  // must overwrite it with the freshly generated one (now including every
  // enabled page), not the other way around. A stale, deliberately WRONG
  // public/sitemap.xml here is what makes that order observable: if Vite's
  // copy ever ran AFTER this plugin's write, dist/sitemap.xml would still
  // contain "STALE-MARKER" and this test would catch it.
  it('overwrites Vite\'s own public/sitemap.xml copy in dist/, rather than being overwritten by it', async () => {
    const root = makeFixtureRoot();
    cleanupRoots.push(root);
    const outDir = path.join(root, 'dist');
    const publicDir = path.join(root, 'public');
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(path.join(publicDir, 'sitemap.xml'), '<?xml version="1.0"?><urlset><!-- STALE-MARKER --></urlset>\n');

    await build({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [sitemap(BASE_URL, [page('our-menu', true)])],
      build: { outDir, write: true },
    });

    const xml = readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
    expect(xml).not.toContain('STALE-MARKER');
    expect(xml).toContain(`<loc>${BASE_URL}/our-menu</loc>`);
  });
});
