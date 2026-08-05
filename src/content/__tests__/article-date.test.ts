import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { formatArticleDate } from '../article-date';

// Reads the formatter's own output under an explicit TZ, in a CHILD PROCESS.
// It has to be a child process: `Intl` resolves the runtime timezone once and
// caches it, so assigning `process.env.TZ` inside a running test changes
// nothing -- a test written that way passes in every zone while proving none.
//
// This is the check that would have caught the Cloudflare build failure that
// produced this file. The build container runs UTC, the machine that pinned
// `src/test/homepage-bytes.test.tsx` did not, and a two-digit day rendering as
// a one-digit day is exactly the one byte that failed it (53486 vs 53485).
function formatIn(tz: string, date: string): string {
  const src = `
    const { formatArticleDate } = await import('./src/content/article-date.ts');
    console.log(formatArticleDate(${JSON.stringify(date)}));
  `;
  return execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', src], {
    encoding: 'utf8',
    env: { ...process.env, TZ: tz },
  }).trim();
}

describe('formatArticleDate', () => {
  // `Article.date` is a calendar date, not an instant. JS parses a date-only
  // ISO string as UTC midnight, so without an explicit `timeZone` the DISPLAYED
  // day depended on where the page was rendered. Verified before the fix:
  //   TZ=UTC and TZ=Asia/Kolkata -> "August 10, 2026"
  //   TZ=America/New_York        -> "August 9, 2026"
  // Every visitor west of UTC saw each press article dated a day early.
  it('renders the authored calendar day', () => {
    expect(formatArticleDate('2026-08-10')).toBe('August 10, 2026');
    expect(formatArticleDate('2026-01-01')).toBe('January 1, 2026');
  });

  // Mutation that proves this is not vacuous: delete `timeZone: 'UTC'` from
  // ARTICLE_DATE_FORMAT in ../article-date.ts and the America/New_York arm
  // returns "August 9, 2026" while the other two still return the 10th.
  // A date whose day is two digits is deliberate -- the rollover has to change
  // the rendered WIDTH for this to reproduce the byte the build tripped on.
  it('is identical west of UTC, east of UTC, and in UTC itself', () => {
    expect(formatIn('UTC', '2026-08-10')).toBe('August 10, 2026');
    expect(formatIn('America/New_York', '2026-08-10')).toBe('August 10, 2026');
    expect(formatIn('Asia/Kolkata', '2026-08-10')).toBe('August 10, 2026');
  });
});
