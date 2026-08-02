import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('cloudflare hosting config', () => {
  it('rewrites every unmatched route to the SPA entry point', () => {
    expect(existsSync('public/_redirects')).toBe(true);
    const redirects = readFileSync('public/_redirects', 'utf8');
    expect(redirects).toMatch(/^\/\*\s+\/index\.html\s+200$/m);
  });

  it('caches hashed bundles immutably', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    expect(headers).toContain('/assets/*');
    expect(headers).toMatch(/max-age=31536000/);
    expect(headers).toMatch(/immutable/);
  });

  it('caches unhashed public assets for a week, revalidating', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    expect(headers).toMatch(/max-age=604800/);
    expect(headers).toMatch(/must-revalidate/);
  });

  it('never marks unhashed assets immutable', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    const blocks = headers.trim().split(/\n\s*\n/);
    const unhashed = blocks.filter((b) => !b.startsWith('/assets/'));
    expect(unhashed.length).toBeGreaterThan(0);
    unhashed.forEach((block) => expect(block).not.toContain('immutable'));
  });
});
