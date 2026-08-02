import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('analytics', () => {
  it('loads cloudflare web analytics', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('static.cloudflareinsights.com/beacon.min.js');
  });

  it('loads it deferred so it cannot block rendering', () => {
    const html = readFileSync('index.html', 'utf8');
    const tag = html.match(/<script[^>]*cloudflareinsights[^>]*>/)?.[0] ?? '';
    expect(tag).toMatch(/\bdefer\b/);
  });

  it('uses a placeholder token that must be replaced at cutover', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('CLOUDFLARE_ANALYTICS_TOKEN');
  });
});
