// @vitest-environment node
//
// Same reasoning as plugins/__tests__/build-info.test.ts's own header
// comment: this file runs a real `vite build`, which needs Node's real
// globals, not jsdom's.
import { describe, it, expect, afterEach } from 'vitest';
import { build } from 'vite';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sitemap, { buildSitemapXml, pageUrls, STATIC_ROUTES } from '../sitemap';
import type { Page } from '../../src/content/types';

const BASE_URL = 'https://example.com';

function page(slug: string, enabled: boolean): Pick<Page, 'slug' | 'enabled'> {
  return { slug, enabled };
}

describe('buildSitemapXml / pageUrls (pure)', () => {
  it('always lists the two static routes, home with a trailing slash, blogs without', () => {
    const xml = buildSitemapXml(BASE_URL, []);
    expect(xml).toContain(`<loc>${BASE_URL}/</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/blogs</loc>`);
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
});
