// Every D1 statement the Numbers panel will ever issue, in one module.
//
// ONE module, and the reason is FakeD1: worker/__tests__/fakeD1.ts matches
// statements by `startsWith` and throws on anything it does not recognise, so
// the set of statements has to be enumerable by reading one file. A statement
// written inline at a call site is a statement somebody will change without
// teaching the fake, and the failure shows up in production as a D1_ERROR on
// a request nobody is watching. This repository has already shipped a data
// model maintained in four places once.
//
// Nothing here reads `env`. Every function takes a plain D1Database, so the
// tests hand it a fake and the handlers hand it `env.DB`, and neither has to
// know about the other.
//
// NOTHING HERE CATCHES. Callers decide what a failure costs: a failed
// campaign read costs one card, a failed snapshot costs one night's row, and
// those are different decisions that must not be made here.
//
// The tables are worker/migrations/0002_analytics.sql, applied by hand. Every
// read below is no-throw by the CALLER's choice, which means an unapplied
// migration shows up as a card reading zero rather than as an error -- so if
// a number here is permanently empty, check the migration landed first.
import type { D1Database } from '@cloudflare/workers-types';

export interface CampaignTotal {
  source: string;
  arrivals: number;
}

export interface DayVisits {
  // 'YYYY-MM-DD' at day grain, 'YYYY-MM' at month grain. ONE type, because
  // the chart draws a run of points against an ordered axis and does not care
  // what a point is called -- the payload's seriesGrain says which it is.
  day: string;
  visits: number;
  // Always true for a day. For a month, whether every one of its days is
  // present in daily_visits.
  complete: boolean;
}

// Hand-computed rather than through Date, because `new Date('2026-02')` is a
// UTC-midnight parse in some engines and a local-midnight parse in others,
// and the answer for February decides whether a month is called complete.
export function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(index) || index < 1 || index > 12) return 31;
  if (index === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(index) ? 30 : 31;
}

// EXACT counts, not estimates, and that is the whole reason this table
// exists: these are our own rows. The card is allowed to say "84" here where
// every Cloudflare number says "about 84".
//
// `ORDER BY arrivals DESC, source ASC` -- the second key is not decoration.
// Two sources with equal counts must come back in the same order on every
// load, or the card reshuffles itself between refreshes and looks broken.
// rankPaths in worker/analytics.ts already makes exactly this argument.
export async function campaignTotals(db: D1Database, since: string): Promise<CampaignTotal[]> {
  const { results } = await db
    .prepare(
      'SELECT source, COUNT(*) AS arrivals FROM campaign_arrivals WHERE day >= ? GROUP BY source ORDER BY arrivals DESC, source ASC',
    )
    .bind(since)
    .all<{ source: string; arrivals: number }>();
  return (results ?? []).map((row) => ({ source: String(row.source), arrivals: Number(row.arrivals) || 0 }));
}

export async function dailySince(db: D1Database, since: string): Promise<DayVisits[]> {
  const { results } = await db
    .prepare('SELECT day, visits FROM daily_visits WHERE day >= ? ORDER BY day ASC')
    .bind(since)
    .all<{ day: string; visits: number }>();
  return (results ?? []).map((row) => ({ day: String(row.day), visits: Number(row.visits) || 0, complete: true }));
}

// The first day the archive holds anything, so the chart can say where its
// line begins instead of starting at an unexplained zero. `null` means no row
// has ever landed, which is a different sentence.
export async function firstDailyDay(db: D1Database): Promise<string | null> {
  const row = await db.prepare('SELECT MIN(day) AS first_day FROM daily_visits').first<{ first_day: string | null }>();
  const day = row?.first_day;
  return typeof day === 'string' && day.length > 0 ? day : null;
}

export async function monthlySeries(db: D1Database, sinceMonth: string): Promise<DayVisits[]> {
  const { results } = await db
    .prepare('SELECT month, visits, complete FROM monthly_visits WHERE month >= ? ORDER BY month ASC')
    .bind(sinceMonth)
    .all<{ month: string; visits: number; complete: number }>();
  return (results ?? []).map((row) => ({
    day: String(row.month),
    visits: Number(row.visits) || 0,
    complete: Number(row.complete) === 1,
  }));
}

// Whether the by-year button has anything behind it. Folded into the same
// round trip as everything else rather than being a third question.
export async function monthlyCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM monthly_visits').first<{ n: number }>();
  return Number(row?.n) || 0;
}

export async function recordArrival(db: D1Database, source: string, day: string, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO campaign_arrivals (source, day, created_at) VALUES (?, ?, ?)')
    .bind(source, day, now)
    .run();
}

// ONE statement, not read-then-write, and that is not a style choice: two
// arrivals in the same second would both read the same count and both decide
// they were under the limit. `ON CONFLICT ... DO UPDATE` with `RETURNING`
// makes the increment and the answer one atomic step.
//
// The `expires` comparison in the UPDATE arm is what resets a stale bucket:
// without it, a bucket that filled an hour ago is still full, and the limiter
// becomes a permanent ban rather than a window.
//
// `bucket` is OPAQUE by construction and the caller is responsible for
// keeping it so -- see worker/campaign.ts, which hashes the address with the
// window and a salt before it ever gets here. Nothing in this module has an
// address to leak.
export async function takeRateSlot(
  db: D1Database,
  bucket: string,
  limit: number,
  expires: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      'INSERT INTO campaign_rate (bucket, hits, expires) VALUES (?, 1, ?) ' +
        'ON CONFLICT(bucket) DO UPDATE SET ' +
        'hits = CASE WHEN campaign_rate.expires <= excluded.expires - 1 THEN 1 ELSE campaign_rate.hits + 1 END, ' +
        'expires = excluded.expires ' +
        'RETURNING hits',
    )
    .bind(bucket, expires)
    .first<{ hits: number }>();
  return (Number(row?.hits) || 0) <= limit;
}

// INSERT OR REPLACE by way of ON CONFLICT: running the nightly job twice on
// the same day must leave ONE row holding the better (later, more complete)
// number, not two rows and not an error. A scheduled handler that fails on a
// retry is a scheduled handler that stops silently.
export async function recordDailyVisits(db: D1Database, day: string, visits: number, now: number): Promise<void> {
  await db
    .prepare(
      'INSERT INTO daily_visits (day, visits, recorded_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(day) DO UPDATE SET visits = excluded.visits, recorded_at = excluded.recorded_at',
    )
    .bind(day, visits, now)
    .run();
}

// EVERY MONTH TOUCHED BY THE LAST NINETY-THREE DAYS, recomputed from its own
// days -- not only the month that just ended.
//
// Three things follow from that and each of them is the reason for it:
//   - a day that arrives late is picked up on the next night's run instead of
//     being lost;
//   - ONE missed cron night cannot lose a whole month permanently, which a
//     job that only fires on the 1st can and does;
//   - a month is recomputed rather than incremented, so running twice cannot
//     double anything and a corrected day corrects its month too.
//
// `complete` is computed here, from COUNT(*) against the real length of the
// month, because this is the only place that knows both numbers.
export async function rollMonths(db: D1Database, sinceDay: string, now: number): Promise<void> {
  const { results } = await db
    .prepare(
      'SELECT substr(day, 1, 7) AS month, SUM(visits) AS visits, COUNT(*) AS days FROM daily_visits WHERE day >= ? GROUP BY month',
    )
    .bind(sinceDay)
    .all<{ month: string; visits: number; days: number }>();
  for (const row of results ?? []) {
    const month = String(row.month);
    await db
      .prepare(
        'INSERT INTO monthly_visits (month, visits, complete, recorded_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(month) DO UPDATE SET visits = excluded.visits, complete = excluded.complete, recorded_at = excluded.recorded_at',
      )
      .bind(month, Number(row.visits) || 0, Number(row.days) >= daysInMonth(month) ? 1 : 0, now)
      .run();
  }
}

// Two deletes in one batch, so the nightly job costs one subrequest for both.
// Daily rows older than the cutoff are already rolled into their month;
// expired limiter buckets are dead weight the moment they expire -- and
// deleting them is also what keeps the limiter's opaque buckets from
// accumulating forever.
//
// 400 days rather than 365, so a by-year view of the current year always has
// a full preceding year of days behind it. That is the table's stated
// ceiling: 400 rows, forever.
export async function pruneAnalytics(db: D1Database, dayCutoff: string, now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM daily_visits WHERE day < ?').bind(dayCutoff),
    db.prepare('DELETE FROM campaign_rate WHERE expires < ?').bind(now),
  ]);
}
