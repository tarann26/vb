import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
});
