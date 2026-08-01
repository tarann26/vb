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

  it('is sorted newest first at source', () => {
    const dates = press.map((a) => new Date(a.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('has unique ids', () => {
    expect(new Set(press.map((a) => a.id)).size).toBe(press.length);
  });
});
