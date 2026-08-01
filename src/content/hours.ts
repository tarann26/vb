// Pure formatting helpers derived from the single machine-readable `Hours`
// fact stored in site.json (days + 24-hour opens/closes). Components must
// not format hours inline; every rendering -- the footer's human-readable
// label/value pair and the JSON-LD `openingHours` line -- goes through here
// so the underlying fact can only be edited in one place.
//
// Browser-safe: no node:fs, no import.meta.glob, no Intl dependency. This
// module is imported directly by components and bundled into the browser.

import type { Hours } from './types';

const WEEK_ORDER: string[] = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const DAY_NAMES: Record<string, string> = {
  Mo: 'Monday',
  Tu: 'Tuesday',
  We: 'Wednesday',
  Th: 'Thursday',
  Fr: 'Friday',
  Sa: 'Saturday',
  Su: 'Sunday',
};

// Days are authored in site.json in ascending week order (see the Hours
// comment in types.ts), so contiguity only needs a forward check -- no
// sorting, and no wraparound across the Sunday/Monday boundary.
function isContiguous(days: string[]): boolean {
  if (days.length <= 1) return true;
  const indices = days.map((d) => WEEK_ORDER.indexOf(d));
  return indices.every((index, i) => i === 0 || index === indices[i - 1] + 1);
}

/** "Monday – Friday" for a contiguous range, "Sunday" for one day, and a
 * comma list for anything non-contiguous so unrelated days are never
 * mistaken for the days in between. */
export function formatDayRange(days: string[]): string {
  if (days.length === 1) return DAY_NAMES[days[0]];
  if (isContiguous(days)) {
    return `${DAY_NAMES[days[0]]} – ${DAY_NAMES[days[days.length - 1]]}`;
  }
  return days.map((d) => DAY_NAMES[d]).join(', ');
}

// hour: 0-23. Modulo-12 handles both off-by-twelve cases in one formula:
// hour 12 (noon) -> 12 % 12 === 0 -> displays as 12, period stays PM;
// hour 0 (midnight) -> 0 % 12 === 0 -> displays as 12, period is AM.
function to12Hour(time: string): string {
  const [hourStr, minute] = time.split(':');
  const hour = Number(hourStr);
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${period}`;
}

/** "12:00 PM – 11:30 PM" for the footer.
 *
 * A closing time numerically earlier than the opening time (e.g.
 * opens="12:00", closes="00:30") means "past midnight, the following day" --
 * the same convention schema.org's own openingHours format uses, and a real
 * shape this repo has had before ("Fr-Su 12:00-00:00"). Each time is
 * formatted independently with no reordering or day-rollover arithmetic, so
 * that case renders as "12:00 PM – 12:30 AM": a correct literal reading of
 * the two clock times, not a bug. */
export function formatTimeRange(opens: string, closes: string): string {
  return `${to12Hour(opens)} – ${to12Hour(closes)}`;
}

/** "Mo-Fr 12:00-23:30" for JSON-LD's openingHours. Non-contiguous days are
 * comma-joined (schema.org's own documented format) rather than collapsed
 * into a range that would misstate which days are actually open. The
 * opens/closes strings are passed through literally -- see formatTimeRange
 * above for why a past-midnight close is not reordered. */
export function toSchemaOpeningHours(entry: Hours): string {
  const { days, opens, closes } = entry;
  const dayCode =
    days.length === 1
      ? days[0]
      : isContiguous(days)
        ? `${days[0]}-${days[days.length - 1]}`
        : days.join(',');
  return `${dayCode} ${opens}-${closes}`;
}
