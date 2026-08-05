// `Article.date` is a calendar date -- `"2026-08-10"` means the tenth of
// August, not an instant in time. JavaScript disagrees: a date-only ISO
// string is parsed as UTC midnight (ECMA-262 21.4.3.2), and
// `toLocaleDateString` then renders that instant in the RUNTIME's timezone.
// So the same article rendered the tenth in UTC and in Delhi, and the ninth
// in New York -- verified directly:
//
//   TZ=UTC            new Date('2026-08-10').toLocaleDateString('en-US', ...)  -> August 10, 2026
//   TZ=Asia/Kolkata   ...                                                      -> August 10, 2026
//   TZ=America/New_York ...                                                    -> August 9, 2026
//
// Every visitor west of UTC was shown a press article dated a day early.
//
// This surfaced as a Cloudflare Pages build failure rather than as a bug
// report: `src/test/homepage-bytes.test.tsx` pins the rendered homepage at a
// byte count, the build container runs UTC while the machine that set the
// number did not, and a two-digit day rendering as a one-digit day is
// exactly one byte. The byte gate caught a real rendering bug it was not
// written to look for.
//
// Passing `timeZone: 'UTC'` renders the instant back in the frame it was
// parsed in, so the displayed day always equals the authored day and the
// output no longer depends on where it is rendered. Deliberately NOT fixed
// by appending 'T00:00:00' to parse as local midnight instead: that makes
// the output correct-by-accident on the developer's machine and still
// timezone-dependent for the build.
const ARTICLE_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
};

export function formatArticleDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', ARTICLE_DATE_FORMAT);
}
