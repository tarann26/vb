import { describe, it, expect } from 'vitest';
import { isPublished } from '../publish';

describe('isPublished', () => {
  it('publishes an item with no date', () => {
    expect(isPublished({}, '2026-08-02')).toBe(true);
  });

  it('publishes an item dated today', () => {
    expect(isPublished({ publishAt: '2026-08-02' }, '2026-08-02')).toBe(true);
  });

  it('publishes an item dated in the past', () => {
    expect(isPublished({ publishAt: '2026-07-01' }, '2026-08-02')).toBe(true);
  });

  it('withholds an item dated in the future', () => {
    expect(isPublished({ publishAt: '2026-09-01' }, '2026-08-02')).toBe(false);
  });

  it('rejects a malformed date rather than guessing', () => {
    expect(() => isPublished({ publishAt: 'next tuesday' }, '2026-08-02')).toThrow();
  });

  it('rejects a date that looks valid but is not', () => {
    expect(() => isPublished({ publishAt: '2026-02-30' }, '2026-08-02')).toThrow();
  });
});
