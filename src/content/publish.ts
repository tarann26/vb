// Pure predicate for whether a scheduled content item is live. Deliberately
// takes `today` as a parameter rather than reading the clock itself -- the
// clock is a build-time concern (see plugins/filter-unpublished.ts, which
// is the only caller that matters: this function never runs in the browser,
// and never in the dev server or Vitest, since the plugin is `apply:
// 'build'` only). Keeping the clock out of this function is what makes the
// one interesting boundary -- an item dated exactly `today` -- testable
// without stubbing global Date/Intl state.
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// `YYYY-MM-DD` round-trips through `Date` exactly when it names a real
// calendar date: `new Date('2026-02-30T00:00:00Z')` silently rolls over to
// March 2nd rather than throwing, so the round trip -- not the regex alone
// -- is what catches it.
//
// An out-of-range month or day (e.g. "2026-25-12", the day/month swap a
// DD-MM date-format habit produces) is a *different* failure shape: `Date`
// doesn't roll that over, it produces an Invalid Date, and calling
// `.toISOString()` on one throws `RangeError: Invalid time value` --
// bypassing this function's `=== iso` check entirely and surfacing as a raw
// engine error instead of `isPublished`'s own readable message. The
// `Number.isNaN(parsed.getTime())` check catches that shape before
// `.toISOString()` ever runs, so both shapes end up going through the same
// "invalid date" path.
function isRealCalendarDate(iso: string): boolean {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === iso;
}

// `today` and `item.publishAt` are both `YYYY-MM-DD` strings, so a plain
// lexicographic `<=` is an exact date comparison -- no `Date` object, no
// timezone or parsing quirk to get wrong. "Dated today" publishes: she
// means "live on this date", not "the day after".
export function isPublished(item: { publishAt?: string }, today: string): boolean {
  if (item.publishAt === undefined) return true;
  if (!ISO_DATE_PATTERN.test(item.publishAt) || !isRealCalendarDate(item.publishAt)) {
    throw new Error(`invalid "publishAt" date "${item.publishAt}", expected a real calendar date as YYYY-MM-DD`);
  }
  return item.publishAt <= today;
}
