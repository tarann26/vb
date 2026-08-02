import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('toolchain', () => {
  it('build script type-checks before bundling', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.build).toBe('npm run images && tsc -b && vite build');
  });

  it('package is not named after the starter template', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.name).not.toBe('vite-react-typescript-starter');
  });
});

// vercel.json is JSON, so it cannot explain itself in a comment. These pin
// the two decisions in it that are easy to get wrong in opposite directions.
describe('vercel deploy configuration', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const ruleFor = (source: string) =>
    vercel.headers.find((rule: { source: string }) => rule.source === source);

  it('runs the deploy gate before building', () => {
    expect(vercel.buildCommand).toBe('npm run test:deploy && npm run build');
  });

  // Vite writes JS and CSS to /assets/ under a content hash, so the URL
  // changes the instant the bytes do. That is the one case where a year of
  // immutable caching is safe -- and it is the case that had no rule at all.
  it('caches content-hashed bundles for a year', () => {
    const rule = ruleFor('/assets/(.*)');
    expect(rule).toBeDefined();
    expect(rule.headers[0]).toEqual({
      key: 'Cache-Control',
      value: 'public, max-age=31536000, immutable',
    });
  });

  // Everything under public/ keeps a stable filename across edits -- replace
  // a photo and /food/pizza1.webp still points at the new one -- so the same
  // immutable year here would strand the old image in browser caches. It
  // must stay revalidating.
  it('keeps public/ assets revalidating rather than immutable', () => {
    const rule = ruleFor('/(.*)\\.(webp|jpg|png|svg|pdf)');
    expect(rule).toBeDefined();
    expect(rule.headers[0].value).toContain('must-revalidate');
    expect(rule.headers[0].value).not.toContain('immutable');
  });
});
