// Pure predicate for whether a scheduled content item is live. Deliberately
// takes `today` as a parameter rather than reading the clock itself. Two
// real callers today, each supplying `today` a different way: the Vite
// plugin (plugins/filter-unpublished.ts), which is a pure build-time
// concern -- this function never runs in the browser, and never in the dev
// server or Vitest, since that plugin is `apply: 'build'` only -- and the
// admin Worker (worker/index.ts's recordScheduledDates, Task 8), which
// calls it at publish time to decide which of a freshly-published file's
// `publishAt` dates are still in the future and therefore worth tracking
// for the scheduled-rebuild cron. Keeping the clock out of this function is
// what makes the one interesting boundary -- an item dated exactly `today`
// -- testable without stubbing global Date/Intl state, in either caller.
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

// Resolves "today" in the restaurant's own timezone, Asia/Kolkata (IST), not
// the caller's own clock. Cloudflare builds in UTC; at 23:00 UTC on the 1st
// -- 04:30 IST on the 2nd -- a UTC comparison would still withhold content
// dated the 2nd. IST has no DST, so this needs no seasonal correction.
//
// Moved here from plugins/filter-unpublished.ts (Task 8 of the worker plan):
// that file is a Vite-plugin module (`import type { Plugin } from 'vite'`),
// and the admin Worker's own tsconfig (tsconfig.worker.json) is a separate
// project from Vite's -- pulling Vite's types across that boundary just to
// reach this one function is exactly the kind of project-boundary leak
// tsconfig.worker.json exists to avoid (see worker/index.ts's own comment on
// why it's typed against `@cloudflare/workers-types`, not tsconfig.node.json).
// This module has no such dependency, so both the Vite plugin and the Worker
// can import it from here.
//
// Two real callers, each on a different cadence: the Vite plugin calls it at
// build time, once per build, to decide what ships in that build's bundle.
// The Worker's `scheduled` handler (worker/index.ts) calls it once per cron
// tick to compute the day the cron's own "is anything due today" check
// should compare against -- see that file's `anythingPublishesToday`. Publish
// granularity is therefore the cadence of whichever caller's clock last
// ticked over IST midnight and then ran -- the next scheduled rebuild for the
// Worker, the next `npm run build` for the Vite plugin -- not the instant
// midnight itself arrives.
//
// Exported (not module-private) so both callers' own test suites can verify
// the IST resolution itself under fake timers -- see
// plugins/__tests__/filter-unpublished.test.ts's `todayInKolkata` describe
// block, the only place that reads this function's actual output rather than
// taking `today` as a parameter the way `isPublished`'s own tests do.
export function todayInKolkata(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
