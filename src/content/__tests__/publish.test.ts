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

  // A day/month swap (the exact typo Indian DD-MM date-format habit
  // produces) yields an out-of-range month or day -- "2026-25-12" reads as
  // month 25. `new Date(...)` for that produces an Invalid Date, and
  // `.toISOString()` on an Invalid Date throws `RangeError: Invalid time
  // value` *before* the round-trip `===` comparison ever runs, bypassing
  // this function's own readable message. Pinned to the readable message,
  // not just "throws something", so a regression back to the unguarded
  // `.toISOString()` call is caught even though it still throws either way.
  it('rejects an out-of-range month/day with a readable message, not a raw RangeError', () => {
    expect(() => isPublished({ publishAt: '2026-25-12' }, '2026-08-02')).toThrow(/publishAt/);
  });
});
