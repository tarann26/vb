import { describe, it, expect } from 'vitest';
import { press } from '../../content';

describe('press content', () => {
  it('gives every article a real destination or none at all', () => {
    press.forEach((article) => {
      expect(article.url).not.toBe('#');
      if (article.url !== null) {
        expect(article.url).toMatch(/^https?:\/\//);
      }
    });
  });

  // "Sorted newest first" moved to src/content/validate.ts: it rejects a
  // bad press.json before the commit exists, rather than after the build
  // has already run against it.

  it('has unique ids', () => {
    expect(new Set(press.map((a) => a.id)).size).toBe(press.length);
  });
});
