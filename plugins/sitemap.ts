import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '../src/content/types';

// Plan 7, Task 3, Step 3: "a new page appears in ... the sitemap." Before
// this task, public/sitemap.xml was a plain STATIC file -- `/` and `/blogs`
// hand-typed, copied into dist/ verbatim by Vite with no build-time
// involvement at all (crawlers.test.ts's own "lists every public route"
// test reads that exact source file). A page she creates through the
// dashboard (Task 4) and publishes needs no developer touch to become
// crawlable -- the entire point of this plan -- so a hand-maintained static
// file cannot be the mechanism once pages exist; this plugin is what
// replaces it, generated fresh on every build from the same `pages` array
// src/content/index.ts already validated.
//
// The two routes public/sitemap.xml already hand-authored (`/`, `/blogs`)
// are kept here as a literal base, not derived from anything -- they are
// genuinely static, developer-owned routes with no content-model
// counterpart to generate them FROM. Every ENABLED page's own `/<slug>`
// is appended on top -- a disabled page is deliberately absent, matching
// `/:slug`'s own routing behaviour (App.tsx's PageRoute 404s a disabled
// page exactly like a nonexistent one) and NotFound's own robots.txt-level
// invisibility; advertising a URL in the sitemap that then 404s would be
// actively counterproductive for search ranking, not merely unhelpful.
export const STATIC_ROUTES = ['/', '/blogs'] as const;

export function pageUrls(pages: Pick<Page, 'slug' | 'enabled'>[]): string[] {
  return pages.filter((page) => page.enabled).map((page) => `/${page.slug}`);
}

// `changefreq`/`priority` match public/sitemap.xml's own committed values
// for the two static routes (`monthly`/`1.0` for `/`, `monthly`/`0.7` for
// `/blogs`) -- a page she creates is closer in kind to `/blogs` (content
// that occasionally changes, not the homepage itself) than to `/`, so it
// gets the same `0.7` priority, not a hand-tuned per-page value nothing in
// this content model would let her set anyway.
function urlEntry(baseUrl: string, route: string, priority: string): string {
  return `  <url>\n    <loc>${baseUrl}${route}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>${priority}</priority>\n  </url>\n`;
}

export function buildSitemapXml(baseUrl: string, pages: Pick<Page, 'slug' | 'enabled'>[]): string {
  const homeAndBlogs = STATIC_ROUTES.map((route, i) => urlEntry(baseUrl, route, i === 0 ? '1.0' : '0.7')).join('');
  const pageEntries = pageUrls(pages)
    .map((route) => urlEntry(baseUrl, route, '0.7'))
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${homeAndBlogs}${pageEntries}</urlset>\n`;
}

// `writeBundle`, not `closeBundle` -- the identical reasoning
// plugins/build-info.ts's own header comment gives in detail, not repeated
// here: a build that fails after the module graph resolves but before
// output is written must not leave a plausible-looking sitemap.xml behind
// (`closeBundle` fires either way; `writeBundle` only once real output
// exists). `apply: 'build'` for the same reason every other build-only
// plugin here has it -- Vitest never sees this file, so nothing in the
// suite depends on the wall clock or on `pages` being importable from a
// jsdom environment.
export default function sitemap(baseUrl: string, pages: Pick<Page, 'slug' | 'enabled'>[]): Plugin {
  let outDir = 'dist';
  return {
    name: 'sitemap',
    apply: 'build',
    configResolved(config) {
      outDir = path.isAbsolute(config.build.outDir) ? config.build.outDir : path.join(config.root, config.build.outDir);
    },
    writeBundle() {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, 'sitemap.xml'), buildSitemapXml(baseUrl, pages));
    },
  };
}
