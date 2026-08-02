import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { site } from '../content';

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
});

const tag = (html: string, attr: string, value: string) =>
  html.match(new RegExp(`<meta\\s+${attr}="${value}"\\s+content="([^"]*)"`))?.[1];

it('pins open graph and twitter strings to the content layer', () => {
  const html = readFileSync('index.html', 'utf8');
  expect(tag(html, 'property', 'og:title')).toBe(`${site.name} - ${site.tagline}`);
  expect(tag(html, 'property', 'og:description')).toBe(site.strapline);
  expect(tag(html, 'property', 'og:url')).toBe(site.seo.url);
  expect(tag(html, 'property', 'og:image')).toBe(`${site.seo.url}${site.seo.ogImage}`);
  expect(tag(html, 'property', 'twitter:title')).toBe(`${site.name} - ${site.tagline}`);
  expect(tag(html, 'property', 'twitter:description')).toBe(site.strapline);
});

it('declares a canonical url', () => {
  const html = readFileSync('index.html', 'utf8');
  expect(html).toContain(`<link rel="canonical" href="${site.seo.url}" />`);
});

it('points the favicon at a file that exists', () => {
  const html = readFileSync('index.html', 'utf8');
  const href = html.match(/<link rel="icon"[^>]*href="([^"]*)"/)?.[1];
  expect(href).toBeTruthy();
  expect(existsSync(`public${href}`)).toBe(true);
});
