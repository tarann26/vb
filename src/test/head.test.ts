import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { site } from '../content';
import { publicFiles } from './publicFiles';

// index.html is a static file with no server rendering, so site.seo.title and
// site.seo.description are necessarily duplicated there. This test pins the
// two copies together so silent drift between them fails the suite instead
// of waiting to be noticed by a human (or by Google).
describe('index.html head matches site.seo', () => {
  const html = readFileSync('index.html', 'utf-8');

  it('title matches site.seo.title', () => {
    const match = html.match(/<title>([^<]*)<\/title>/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(site.seo.title);
  });

  it('meta description matches site.seo.description', () => {
    const match = html.match(/<meta\s+name="description"\s+content="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(site.seo.description);
  });

  // Named alongside og:title/og:description/og:url/twitter:title/twitter:description
  // as one of the six strings that duplicate the content layer with nothing
  // pinning them; the brief's own sample test omitted it, but it drifts
  // exactly the same way the other five do, so it gets the same pin.
  it('meta keywords matches site.seo.keywords', () => {
    const match = html.match(/<meta\s+name="keywords"\s+content="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(site.seo.keywords);
  });

  it('meta author matches the restaurant name and tagline', () => {
    const match = html.match(/<meta\s+name="author"\s+content="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(`${site.name} ${site.tagline}`);
  });
});

const tag = (html: string, attr: string, value: string) =>
  html.match(new RegExp(`<meta\\s+${attr}="${value}"\\s+content="([^"]*)"`))?.[1];

// Every og/twitter string that restates a content-layer value gets a pin --
// including both image tags. Pinning og:image alone would let a change to
// site.seo.ogImage fail on one line, get "fixed" on that one line, go green,
// and ship a Twitter card pointing at a URL that 404s.
it('pins open graph and twitter strings to the content layer', () => {
  const html = readFileSync('index.html', 'utf8');
  expect(tag(html, 'property', 'og:site_name')).toBe(`${site.name} - ${site.tagline}`);
  expect(tag(html, 'property', 'og:locale')).toBe(site.seo.locale);
  expect(tag(html, 'property', 'og:title')).toBe(`${site.name} - ${site.tagline}`);
  expect(tag(html, 'property', 'og:description')).toBe(site.seo.description);
  expect(tag(html, 'property', 'og:url')).toBe(site.seo.url);
  expect(tag(html, 'property', 'og:image')).toBe(`${site.seo.url}${site.seo.ogImage}`);
  expect(tag(html, 'property', 'twitter:title')).toBe(`${site.name} - ${site.tagline}`);
  expect(tag(html, 'property', 'twitter:description')).toBe(site.seo.description);
  expect(tag(html, 'property', 'twitter:image')).toBe(`${site.seo.url}${site.seo.ogImage}`);
});

// The share preview's whole job is to say where this restaurant is and what
// it serves. site.strapline ("Sip Italiano, Taste the Soul of Puglia") is 38
// characters with no locality and no cuisine in it; for a neighbourhood
// restaurant shared mainly over WhatsApp, the locality is the single most
// valuable string in the preview, so the description tags take
// site.seo.description instead.
it('gives the share preview a description that names the neighbourhood', () => {
  const html = readFileSync('index.html', 'utf8');
  const description = tag(html, 'property', 'og:description');
  // Spelled out rather than read from site.address, whose `locality` is the
  // city ("New Delhi") and whose `street` embeds the neighbourhood in a
  // postal address. It is the neighbourhood a Delhi diner searches and
  // recognises, so this asserts on it directly.
  expect(description).toContain('Greater Kailash');
  expect(description).not.toBe(site.strapline);
});

// public/_redirects rewrites every route to this one file, so any canonical
// declared here is also served on /blogs -- which public/sitemap.xml asks
// Google to index. The homepage's self-canonical lives in SeoHead.tsx (see
// SeoHead.test.tsx); this asserts the static copy has not come back.
it('declares no canonical url, which every route would otherwise inherit', () => {
  // Comments stripped first: index.html explains this absence in a comment
  // that necessarily contains the very markup being searched for.
  const markup = readFileSync('index.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  expect(markup).not.toMatch(/rel=["']?canonical/);
});

// existsSync would answer this one on macOS's case-insensitive filesystem
// and still 404 on Vercel's case-sensitive one, so the check is against a
// readdir-built listing of public/ instead.
// EVERY icon link, not just the first. An earlier version matched only the
// first `rel="icon"` -- fine while there was exactly one, and silently
// pointless the moment the favicon set grew to a 16px, a 32px and an Apple
// touch icon: two of the three references were unchecked, and a typo in
// either would 404 in the one place nobody looks at a network panel.
it('points every icon link at a file that exists, with exact case', () => {
  const html = readFileSync('index.html', 'utf8');
  const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]*)"/g)].map((m) => m[1]);
  // Guards the guard: a regex that matched nothing would make the loop below
  // vacuous, which is exactly how the single-match version stopped meaning
  // anything without failing.
  expect(hrefs.length).toBeGreaterThanOrEqual(3);
  for (const href of hrefs) {
    expect(publicFiles.has(href), `${href} is referenced by index.html but not in public/`).toBe(true);
  }
});

// Deliberate overlap with src/test/analytics.test.ts, which owns "exactly
// one beacon, and here is why the assertion was inverted". This one owns a
// narrower job: index.html's head-and-tail markup is edited by hand and has
// drifted before, and the beacon is the one tag in it whose absence produces
// no symptom at all -- the site looks perfect and the owner's Numbers screen
// silently reports nothing forever. So it is pinned next to the other
// hand-maintained strings, where an edit to this file will trip over it.
it('still carries the Cloudflare Web Analytics beacon with this site\'s token', () => {
  const markup = readFileSync('index.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  expect(markup).toMatch(
    /<script[^>]*src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js"[^>]*data-cf-beacon='\{"token": "7d977bcbda6e4e38884875918d153e7f"\}'/,
  );
});

describe('share card', () => {
  it('exists in public/ with exact case', () => {
    expect(publicFiles.has(site.seo.ogImage)).toBe(true);
  });

  // Crawlers commonly ignore share images past this size, which would leave
  // a shared link with no preview picture at all.
  it('is small enough for crawlers to fetch', () => {
    const { size } = statSync(`public${site.seo.ogImage}`);
    expect(size).toBeLessThan(300 * 1024);
  });
});
