// The archive. One job, three steps, all idempotent and all harmless to run
// twice.
//
// WHY THIS EXISTS AT ALL: Cloudflare keeps roughly six months of beacon data,
// unsampled for seven days and aggregated to about ten per cent after that.
// "Across years" cannot come from Cloudflare at any price on this plan. So
// each day's total is copied here before Cloudflare discards it, and the
// trend chart draws from the copy -- WHICHEVER WAY the schema verification
// went, so there is one source and one set of tests rather than two.
//
// STATED PLAINLY BECAUSE IT CANNOT BE FIXED: this accumulates from the day it
// is switched on and cannot recover the past. The panel says so, driven by
// the earliest row in the table rather than by a constant. The one softening
// of that is the backfill below, which reaches ninety days back on the very
// first run because worker/analytics-schema.ts recorded a real date dimension
// on this dataset -- ninety days, not more, because ninety is the longest
// range the panel offers and reaching further would fill a chart nothing
// draws.
import { recordDailyVisits, rollMonths, pruneAnalytics, dailySince } from './analytics-store';
import { isExcludedPath, normalizePath, totalVisitsFor, type AnalyticsQueryEnv } from './analytics';
import { RUM_CAPABILITIES } from './analytics-schema';
import type { D1Database } from '@cloudflare/workers-types';

const DAY_MS = 86_400_000;

// Ninety-three days, so the last three months are re-rolled every night
// rather than only the month that just ended.
const ROLL_DAYS = 93;

// 400 days of daily rows, then the month's own row carries it. 400 rather
// than 365 so a by-year view of the current year always has a full preceding
// year of days behind it. That is this table's stated ceiling.
const PRUNE_DAYS = 400;

// The longest range the panel offers, and therefore the whole reach of the
// one-off backfill.
const BACKFILL_DAYS = 90;

export interface RollupEnv extends AnalyticsQueryEnv {
  DB: D1Database;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The one-off backfill.
// ---------------------------------------------------------------------------

// The same document shape totalVisitsFor sends, with one dimension added.
//
// The dimension NAME comes from worker/analytics-schema.ts, which read it off
// an introspection reply. It is not spelled here, because a name somebody
// remembered is exactly what the verification exists to replace.
//
// requestPath is grouped alongside it for the same reason the panel's own
// document asks for it: the rows go through isExcludedPath in the Worker
// before they are summed, so an archive cannot start life above the number
// printed beside it.
function byDayQuery(dimension: string): string {
  return `query ViaBiancaAnalyticsByDay(
  $accountTag: String!
  $siteTag: String!
  $since: Time!
  $until: Time!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      byDay: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until }
        limit: 10000
        orderBy: [sum_visits_DESC]
      ) {
        sum { visits }
        dimensions { ${dimension} requestPath }
      }
    }
  }
}`;
}

interface DayTotal {
  day: string;
  visits: number;
}

// Guarded at every leaf rather than trusted, the same posture the panel's own
// reader takes toward this API: a 200 shaped differently than expected must
// not become a run of confident zeroes in a table that is never recomputed.
async function visitsByDay(env: RollupEnv, dimension: string, since: number, until: number): Promise<DayTotal[]> {
  let upstream: Response;
  try {
    upstream = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: byDayQuery(dimension),
        variables: {
          accountTag: env.CLOUDFLARE_ACCOUNT_ID,
          siteTag: env.CF_WEB_ANALYTICS_SITE_TAG,
          since: new Date(since).toISOString(),
          until: new Date(until).toISOString(),
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return [];
  }
  if (!upstream.ok) return [];
  const parsed = (await upstream.json().catch(() => null)) as { data?: unknown; errors?: unknown[] } | null;
  if (!parsed || (Array.isArray(parsed.errors) && parsed.errors.length > 0)) return [];
  const accounts = (parsed.data as { viewer?: { accounts?: unknown } } | undefined)?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) return [];
  const rows = (accounts[0] as { byDay?: unknown }).byDay;
  if (!Array.isArray(rows)) return [];

  const totals = new Map<string, number>();
  for (const row of rows as { sum?: { visits?: unknown }; dimensions?: Record<string, unknown> }[]) {
    const path = row.dimensions?.requestPath;
    if (isExcludedPath(normalizePath(typeof path === 'string' ? path : ''))) continue;
    const bucket = row.dimensions?.[dimension];
    if (typeof bucket !== 'string' || bucket.length < 10) continue;
    // Cloudflare spells a date dimension 'YYYY-MM-DD'; a datetime one carries
    // a time after it. Either way the first ten characters are the calendar
    // day, which is the column's whole domain.
    const day = bucket.slice(0, 10);
    const visits = row.sum?.visits;
    totals.set(day, (totals.get(day) ?? 0) + (typeof visits === 'number' && Number.isFinite(visits) ? visits : 0));
  }
  return [...totals.entries()].map(([day, visits]) => ({ day, visits }));
}

// Runs once, when daily_visits is empty, and never again: the table having
// any row at all is the flag, so there is no state to keep and a redeploy
// cannot re-trigger it.
async function backfillIfEmpty(env: RollupEnv, until: number): Promise<void> {
  const dimension = RUM_CAPABILITIES.dateDimension;
  if (dimension === null) return;
  const existing = await dailySince(env.DB, '0000-01-01');
  if (existing.length > 0) return;
  const rows = await visitsByDay(env, dimension, until - BACKFILL_DAYS * DAY_MS, until);
  const now = Math.floor(Date.now() / 1000);
  for (const row of rows) await recordDailyVisits(env.DB, row.day, row.visits, now);
  await rollMonths(env.DB, isoDay(until - ROLL_DAYS * DAY_MS), now);
}

// ---------------------------------------------------------------------------
// The nightly job.
// ---------------------------------------------------------------------------

export async function runDailyRollup(env: RollupEnv, nowMs: number): Promise<void> {
  const until = Math.floor(nowMs / DAY_MS) * DAY_MS; // midnight UTC today
  const since = until - DAY_MS; // midnight UTC yesterday
  const day = isoDay(since);

  await backfillIfEmpty(env, until);

  const visits = await totalVisitsFor(env, new Date(since).toISOString(), new Date(until).toISOString());
  // `null` means the call failed. A failed snapshot must leave the day's row
  // ABSENT rather than write a zero: a zero is a CLAIM that nobody visited,
  // and the chart would draw it as a real trough that never recovers. A gap
  // is honest and tomorrow's run is unaffected.
  if (visits === null) return;

  const now = Math.floor(nowMs / 1000);
  await recordDailyVisits(env.DB, day, visits, now);

  // Ninety-three days, so the last three months are re-rolled every night
  // rather than only the month that just ended. A late-arriving day is picked
  // up, and ONE missed night cannot lose a whole month permanently -- which a
  // job that fires only on the 1st can and does.
  await rollMonths(env.DB, isoDay(until - ROLL_DAYS * DAY_MS), now);

  await pruneAnalytics(env.DB, isoDay(until - PRUNE_DAYS * DAY_MS), now);
}
