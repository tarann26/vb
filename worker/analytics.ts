// GET /api/analytics -- the four numbers behind the dashboard's "Numbers"
// screen, in ONE response: how many visits, which pages, where people came
// from, and busier-or-quieter-than-last-week.
//
// A THIN PROXY over Cloudflare's own analytics, and nothing else. There is no
// database behind this route, no Analytics Engine, no second store to keep in
// step: visits come from Cloudflare's GraphQL `rumPageloadEventsAdaptiveGroups`
// dataset (fed by the Web Analytics beacon in index.html), and the only other
// number on the screen -- taps on "Reserve a Table" -- comes from the single
// KV key this Worker already writes (worker/wa.ts).
//
// Shaped after worker/status.ts deliberately, rather than inventing a second
// pattern for talking to Cloudflare's API: same auth gate first, same
// `Authorization: Bearer ${env.CLOUDFLARE_API_TOKEN}` header, same
// `AbortSignal.timeout(10_000)`, same refusal to collapse a malformed
// upstream answer into a reassuring empty one.
//
// ---------------------------------------------------------------------------
// THE DOCUMENT BELOW HAS BEEN RUN AGAINST THE REAL API.
// ---------------------------------------------------------------------------
// It had not been, for a long time, and this block used to say so. The
// evidence is docs/analytics-schema-verification.md (the introspected
// dimension list, the request, the response, the verdict) and
// worker/analytics-schema.ts (the same verdict, typed). Re-run
// `node scripts/verify-analytics-schema.mjs` and update both if this
// document is ever changed.
//
// Two things about the document are still deliberate and still load-bearing:
//   - No requestPath prefix filter goes upstream. /edit is excluded HERE, by
//     isExcludedPath, over returned rows. One filtered set feeds every card,
//     so a card's total and its breakdown cannot disagree.
//   - Every aliased node lives in ONE document. That is why a rejected field
//     takes every card down at once, and it is why the probe above exists.
//
// AND THE THIRD, WHICH COSTS HER A WRONG NUMBER RATHER THAN A CRASH:
// `requestHost` is NOT asked for and NOT filtered on, so a developer's
// `npm run dev` pageload of a PUBLIC page is counted as an ordinary visit.
// It lands inside Card A's "about N visits" and inside Card B's page list,
// and the /edit exclusion above does not catch it because the path is `/`.
//
// This is accepted residue, and it is recorded here rather than assumed away,
// because the residue is REAL and was measured. The 90-day grouping in
// docs/analytics-schema-verification.md returns 8,100 and 3,200 visits under
// `requestHost: "localhost"` against 0 under `viabiancarestaurant.com`, for
// the two site tags that predate the 2026-08-18 unification -- i.e. under
// those tags essentially every row was a dev-server row. The current tag has
// no rows at all yet, so nothing is wrong on the screen today; the day it
// starts ingesting, this is what "about" in Card A is partly covering for.
//
// The trade-off, so a later task can reverse it deliberately: excluding
// localhost means adding `requestHost` to the upstream filter, which means
// pinning the production hostname somewhere and keeping it in step with the
// domain this Worker is routed on -- the same hostname problem bucketReferer
// solves by reading the INCOMING request's host, which is not available to a
// query built for a fixed site tag. If the numbers she reads are ever visibly
// inflated by development traffic, that is the change to make, and it belongs
// with the range contract rather than bolted on here.
//
// Two facts the probe settled that constrain what this file may ever ask for:
//   - `sum` offers exactly ONE field on this dataset, `visits`. There is no
//     pageViews. Every number this route returns is a count of arrivals.
//   - `requestPath` never carries a query string. The beacon strips it in the
//     browser before the measurement is sent, so no utm tag can reach this
//     dataset under any grouping. normalizePath's query-stripping is
//     defensive here rather than load-bearing.
//
// TRUNCATION, recorded because it is the cost of grouping: `last28` is
// grouped by (requestPath x refererHost) with `limit: 1000`. For a site with
// under a dozen pages that is far more rows than can exist, but if it ever
// truncated, `orderBy: [sum_visits_DESC]` means the rows lost are the
// smallest ones and the totals under-report slightly. Card A already says
// "about N visits" because the dataset is adaptive and sampled; this sits
// inside that same caveat rather than adding a new claim.
//
// THE `hourly` NODE TRUNCATES DIFFERENTLY, and the arithmetic is written out
// here because the first version of it got the direction wrong.
//
// It is grouped by (datetimeHour x requestPath), so the number of groups grows
// with the RANGE rather than being bounded by the site: 24 x days x
// trafficked-paths. dist/sitemap.xml carries ten public URLs, so at two to
// four groups per trafficked hour the 1000 ceiling is reached somewhere around
// ten to twenty days -- inside the 30d range and far inside 90d.
//
// The ordering therefore decides WHICH rows survive, and it used to be
// `datetimeHour_ASC`, which kept the OLDEST. That is the worst available
// choice and it degrades as the range grows: the 7d answer is complete, the
// 90d answer is built from roughly the oldest third of the window, so the
// longer the range she picks the more the card answers "when were we busiest
// three months ago" while the heading still says ninety days. Nothing on the
// screen could explain that, and the chart -- which scales opacity by whatever
// peak survived -- would draw the truncated shape as confidently as a whole
// one.
//
// It is now `sum_visits_DESC`, the same ordering the other three nodes use and
// the same one the verified document already proved this dataset accepts on
// this node. The rows lost are the QUIETEST (hour x path) groups instead of
// the most recent hours, which is the trade-off `last28` above already makes
// and the one a shape can absorb: the busy cells are the answer, they survive
// at every range, and the pattern no longer marches across the calendar as the
// range widens. `hourCells` aggregates into a map and sorts at the end, so it
// never depended on the rows arriving in time order.
//
// THE RESIDUE, so it is a decision and not a discovery: at 90 days the quiet
// cells under-report, so the grid reads slightly flatter than the truth. It
// cannot invert the pattern, because inverting it would mean a quiet cell
// outranking a busy one.
//
// THE CHEAPER GROUPING IS BLOCKED ON A PROBE, not on effort. Dropping
// requestPath would divide the group count by the number of trafficked paths
// and bring 90 days close to the ceiling -- but requestPath is what
// isExcludedPath filters on downstream, so dropping it means moving the /edit
// exclusion UPSTREAM into the filter, and that needs a string operator
// (requestPath_notlike or similar) that nothing has run against this API.
// docs/analytics-schema-verification.md records an accepted EQUALITY filter
// (`bot: 0`) and nothing about string operators. A rejected field here answers
// HTTP 200 with `data: null` and takes every card down at once, so the
// operator has to come back from a real probe run before it goes in the
// document. Re-run scripts/verify-analytics-schema.mjs with that filter added
// and this becomes a one-line change.
//
// `datetimeHour` is the spelling INTROSPECTION returned
// (worker/analytics-schema.ts's `hourDimension`), not one somebody
// remembered. Re-run scripts/verify-analytics-schema.mjs before changing it.
//
// ---------------------------------------------------------------------------
// SUBREQUEST AND CPU BUDGET, recomputed because this route grew.
// ---------------------------------------------------------------------------
// Workers Free allows 50 subrequests and 10ms CPU per invocation. Cloudflare
// counts a subrequest per outbound fetch and per Cache API call. D1 queries
// through a binding are NOT subrequests -- they are billed as rows read,
// against 5,000,000 a day, and this route reads at most a handful per miss.
//
//   cache HIT:  1  (cache.match)
//   cache MISS: 4  (cache.match, one GraphQL fetch, one KV get, cache.put)
//               + 1 D1 query for the campaign card
//               + 2 D1 queries for the trend series and its first day
//               + 1 D1 query for whether the by-year archive holds anything
//
//   ?range=year, cache MISS: 2 subrequests (cache.match, cache.put)
//                            + 2 D1 queries + 1 KV get
// No GraphQL call on this path at all, which is why it is also the one range
// that cannot answer 502 upstream-error.
//
// The SUBREQUEST count is therefore UNCHANGED at 4 worst case, which is the
// number that mattered. Recompute this block again if anything is added.
//
// CPU is one HMAC verify (the session gate) plus a `JSON.parse` and a single
// pass over at most 1000 small rows.
//
// ---------------------------------------------------------------------------
// CACHING: THE CLOUDFLARE CACHE API, NEVER KV.
// ---------------------------------------------------------------------------
// Not a preference. This repo's rate limiters, login counters and the
// reserve-a-table counter already commit roughly 800 of KV Free's 1,000
// writes/day across the WHOLE namespace (see RATE_POLICIES in
// worker/index.ts). A KV-cached analytics response -- one write per miss,
// against a route the dashboard hits on every visit to Numbers -- would push
// that over and SILENTLY DISABLE LOGIN RATE LIMITING. The Cache API costs no
// writes against that budget.
//
// Three details that each look like a tidy-up and are each load-bearing:
//
//   1. `caches.default` is read LAZILY, inside the handler, never at module
//      scope. This module must import cleanly under vitest, whose jsdom
//      environment has no `caches` global at all -- a module-scope
//      `caches.default` is a ReferenceError at import time and takes the
//      whole test file with it.
//   2. The key is a CONSTRUCTED, IN-ZONE request on this Worker's own
//      origin: `/__cache/analytics/<shape version>/<range>`. Constructed
//      rather than derived from the incoming request, so the session cookie
//      can never enter the key (two logins would fragment the cache, and a
//      cached body could be keyed to a credential). The only caller-supplied
//      input that reaches it is the range, which parseRange narrows to FOUR
//      values before it gets here -- so the key space is bounded at four
//      entries and no query string can multiply it into an unbounded number
//      of upstream calls.
//      In-zone because Cloudflare documents the Cache API working on
//      Workers/Pages routes and custom domains but does NOT document
//      `caches.default` accepting an arbitrary off-zone host -- if it
//      silently no-opped, this route's only load control would be gone and
//      nothing anywhere would error.
//   3. The body is built ONCE as a string and used to construct TWO separate
//      Response objects. A Response body is a one-shot stream:
//      `cache.put(key, response)` followed by `return response` consumes it
//      before the browser ever sees it. The STORED copy carries
//      `public, max-age=600`; the RETURNED copy carries `no-store`, because
//      this is per-session data behind a login and must never sit in a shared
//      browser or edge cache.
//
// And the trap the stored copy exists to avoid: the `cache.put` must happen
// HERE, on the body this handler built -- never on whatever
// `withSecurityHeaders` returns. That wrapper sets `Cache-Control: no-store`
// on EVERY response leaving this Worker, unconditionally, and the Cache API
// refuses to store a `no-store` response. Get that wrong and every request
// becomes a live GraphQL call while no test fails. (For the same reason, a
// test asserting `no-store` through `worker.fetch` cannot fail and proves
// nothing about this module -- worker/__tests__/analytics.test.ts asserts it
// by calling `handleAnalytics` directly.)
//
// TTL is 600 seconds. Cloudflare's own RUM aggregation is not real-time,
// every question these cards ask is a 7-, 30-, 90-day or by-year question so
// nothing she can perceive changes inside ten minutes, and it bounds
// upstream GraphQL calls to six per hour per colo PER RANGE -- 24 an hour
// across all four -- however often the dashboard reloads or misbehaves.
//
// `await cache.put(...)` inline rather than `ctx.waitUntil(...)`: this
// Worker's `fetch` handler and its `route()` take `(request, env)` with no
// ExecutionContext, and threading one through every route for a
// sub-millisecond edge write is a wider change than it is worth.
import { parseCookie, verifyToken } from './auth';
import { todayInKolkata } from '../src/shared/date';
import { PAYLOAD_SHAPE_VERSION, RANGE_DAYS, parseRange } from '../src/shared/analytics-payload';
import type {
  AnalyticsError,
  AnalyticsFailureReason,
  AnalyticsHourCell,
  AnalyticsPathRow,
  AnalyticsPayload,
  AnalyticsRefererBucket,
  RefererBucketKind,
} from '../src/shared/analytics-payload';
import { readWaCounts } from './wa';
import { readCampaignRows } from './campaign';
import { dailySince, firstDailyDay, monthlyCount, monthlySeries } from './analytics-store';
import { RUM_CAPABILITIES } from './analytics-schema';
import type { PagesEnv } from './status';

// The Web Analytics site tag: an identifier, not a secret -- the same
// non-sensitive-var treatment CLOUDFLARE_PAGES_PROJECT gets in
// worker/status.ts, and it lives in wrangler.toml's [vars] beside it. It is
// a FILTER VALUE; the thing that grants read access is CLOUDFLARE_API_TOKEN,
// which PagesEnv already owns and which needs Account Analytics: Read added
// to it (plan prerequisite P1). Declared here rather than in PagesEnv
// because nothing about Pages deployments needs it -- each module owns the
// shape of the vars it actually reads.
export interface WebAnalyticsEnv {
  CF_WEB_ANALYTICS_SITE_TAG: string;
}

// Exactly the three vars sending the document needs, and no more. NOT
// `PagesEnv & WebAnalyticsEnv`: that drags in CLOUDFLARE_PAGES_PROJECT, which
// this query has no use for and which the nightly job (worker/rollup.ts's
// RollupEnv) therefore has no reason to carry. Narrowing it here is what lets
// the scheduled handler send the same verified document without pretending to
// be a Pages caller.
export interface AnalyticsQueryEnv extends WebAnalyticsEnv {
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
}

export type AnalyticsEnv = PagesEnv &
  WebAnalyticsEnv & {
    KV: KVNamespace;
    TOKEN_SECRET: string;
    ADMIN_PASSWORD_HASH: string;
    // The campaign card, the trend series and the by-year archive are all our
    // own rows. Reads only on this route; the write path is worker/campaign.ts
    // and the nightly job is worker/rollup.ts.
    DB: D1Database;
  };

// ---------------------------------------------------------------------------
// The response body lives in `src/shared/analytics-payload.ts`, imported
// above. It used to be declared HERE as well, because this module was
// written under an instruction not to touch anything outside `worker/`, and
// `src/shared/__tests__/analytics-payload.test.ts` compared the two copies as
// text so neither could be edited alone. That guard has done its job and is
// now inert by its own design: there is one declaration, this file imports
// it, and the Worker that produces the body and the React area that renders
// it cannot drift because there is nothing left to drift from.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pure helpers. Exported because they carry every judgement on this route
// that a human would argue with, and a function that can be table-tested is
// the only honest place to put a judgement.
// ---------------------------------------------------------------------------

const WEEK_DAYS = 7;
const DAY_MS = 86_400_000;
const BYPATH_LIMIT = 10;
const OTHER_HOSTS_LIMIT = 5;

export const REFERER_BUCKET_LABELS: Record<RefererBucketKind, string> = {
  direct: 'Typed it in or used a bookmark',
  instagram: 'Instagram',
  google: 'Google',
  other: 'Other links',
};

// Strips the query string and any trailing slash (except for `/` itself), so
// `/catering?utm_source=ig`, `/catering/` and `/catering` are one row rather
// than three. Anything that does not start with a slash is returned
// unchanged -- it is not a path this site served, and inventing a shape for
// it would hide that.
export function normalizePath(raw: string): string {
  const withoutQuery = raw.split('?')[0].split('#')[0];
  if (!withoutQuery.startsWith('/')) return withoutQuery;
  if (withoutQuery === '/') return '/';
  return withoutQuery.replace(/\/+$/, '') || '/';
}

// Her own editing sessions are tracked pageloads: the beacon is on
// index.html and the SPA rewrite serves index.html for /edit and every
// /edit/manage/* route. Without this, Card B would very likely rank
// `/edit/manage/menu` first at launch and Card A's denominator would be
// inflated by the one person the screen exists for.
//
// Prefix, not equality, and `/edit` itself counts. `/editorial` deliberately
// does NOT: the boundary is a path segment, so a future public page whose
// slug happens to begin with those four letters is not silently erased from
// her own analytics.
export function isExcludedPath(path: string): boolean {
  return path === '/edit' || path.startsWith('/edit/');
}

// `www.` and `l.` only -- the two this site actually sees. Not a general
// subdomain stripper: chopping the first label off every host would turn
// `blog.example.com` into `example.com` and merge two genuinely different
// referrers.
function stripKnownSubdomain(host: string): string {
  return host.replace(/^(www|l)\./, '');
}

// Card C's bucketing, in the Worker so the rule is one implementation with
// one set of tests rather than being re-derived in the browser.
//
// `selfHost` is THE INCOMING REQUEST'S OWN HOST, passed in by the handler --
// not a [vars] entry and not site.json's seo.url. This Worker is routed on
// viabiancarestaurant.com now that vb.aionxxxi.uk's zone has been deleted;
// reading it from the request means the rule follows the domain with
// nothing to remember to change, and on a preview deploy that preview's own
// host correctly IS self-referral.
//
// This is a DISPLAY HEURISTIC and is documented as one. The accepted,
// deliberate mis-buckets, written down so they are decisions rather than
// surprises:
//   com.google.android.gm -> Google      (it is Gmail; close enough for her)
//   t.co                  -> Other links (it is Twitter/X; no bucket exists)
//   l.instagram.com       -> Instagram
//   www.instagram.com     -> Instagram
//   ''                    -> Typed it in or used a bookmark
// The alternative -- a public-suffix list inside a Worker -- is a large
// dependency for a four-row card.
export function bucketReferer(rawHost: string, selfHost: string): { kind: RefererBucketKind; host: string | null } {
  const host = stripKnownSubdomain(rawHost.trim().toLowerCase());
  if (host === '') return { kind: 'direct', host: null };
  if (host === stripKnownSubdomain(selfHost.trim().toLowerCase())) return { kind: 'direct', host: null };
  const labels = host.split('.');
  if (labels.includes('instagram')) return { kind: 'instagram', host: null };
  if (labels.includes('google')) return { kind: 'google', host: null };
  return { kind: 'other', host };
}

// The last `days` IST dates, ENDING YESTERDAY -- the same window the visits
// query covers, so Card A's ratio has the same numerator and denominator
// period. `wa:counts` has no expiry and holds every date since the counter
// shipped; summing all of it would put an all-time numerator against a
// 28-day denominator and the "ratio" would rise forever even as traffic
// fell.
//
// The IST/UTC edge offset is ACCEPTED and recorded: `wa:counts` keys come
// from `todayInKolkata()` while Cloudflare's RUM days are UTC, so the two
// 28-day windows are offset by 5h30m at their edges. Against 28 days that is
// a fraction of a percent, and re-keying the counter to UTC would silently
// change the meaning of every date already stored.
export function recentIstDates(today: string, days: number): string[] {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.test(today) ? today.split('-') : null;
  if (!parts) return [];
  const base = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const dates: string[] = [];
  for (let i = 1; i <= days; i += 1) {
    dates.push(new Date(base - i * DAY_MS).toISOString().slice(0, 10));
  }
  return dates;
}

// N days back from an IST calendar date, as an IST calendar date. Built on
// Date.UTC arithmetic over the parsed parts rather than on a Date in local
// time -- the Worker's own clock is UTC and a local-time Date would shift the
// answer by a day for five and a half hours out of every twenty-four.
export function istDateDaysAgo(today: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return today;
  const [year, month, day] = today.split('-').map(Number);
  const base = Date.UTC(year, month - 1, day);
  return new Date(base - days * DAY_MS).toISOString().slice(0, 10);
}

export function sumWaCounts(counts: Record<string, number>, dates: string[]): number {
  return dates.reduce((total, date) => total + (counts[date] ?? 0), 0);
}

// The EARLIEST month the by-year view may show, given today. Twelve calendar
// months ending with the current one, so the answer is ELEVEN months back and
// not twelve.
//
// That off-by-one is the whole reason this is a named function with its own
// tests. `monthlySeries` filters `month >= ?` INCLUSIVELY, so subtracting a
// full year lands on the same month one year ago and hands back THIRTEEN
// buckets -- last August through this August -- summed into a headline
// labelled 365 days, beside a taps number covering 365 days exactly. A month
// of over-count on one card and not its neighbour is precisely the
// quietly-wrong number this range was added to prevent, inverted.
//
// Integer arithmetic on a month index rather than a Date: constructing a Date
// and calling setMonth(-4) is correct here but relies on a rollover rule that
// is easy to misread, and every value in play is already a calendar month
// string.
export function firstMonthOfYearWindow(today: string): string {
  const year = Number(today.slice(0, 4));
  const monthIndex = Number(today.slice(5, 7)) - 1 - 11;
  const shiftedYear = year + Math.floor(monthIndex / 12);
  const shiftedMonth = (((monthIndex % 12) + 12) % 12) + 1;
  return `${String(shiftedYear)}-${String(shiftedMonth).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// The GraphQL document.
// ---------------------------------------------------------------------------

const ANALYTICS_QUERY = `query ViaBiancaAnalytics(
  $accountTag: String!
  $siteTag: String!
  $sinceWindow: Time!
  $sinceThisWeek: Time!
  $sincePriorWeek: Time!
  $sincePrevious: Time!
  $until: Time!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      last28: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $siteTag, datetime_geq: $sinceWindow, datetime_lt: $until }
        limit: 1000
        orderBy: [sum_visits_DESC]
      ) {
        sum { visits }
        dimensions { requestPath refererHost }
      }
      previousWindow: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $siteTag, datetime_geq: $sincePrevious, datetime_lt: $sinceWindow }
        limit: 1000
        orderBy: [sum_visits_DESC]
      ) {
        sum { visits }
        dimensions { requestPath }
      }
      thisWeek: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $siteTag, datetime_geq: $sinceThisWeek, datetime_lt: $until }
        limit: 500
        orderBy: [sum_visits_DESC]
      ) {
        sum { visits }
        dimensions { requestPath }
      }
      priorWeek: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $siteTag, datetime_geq: $sincePriorWeek, datetime_lt: $sinceThisWeek }
        limit: 500
        orderBy: [sum_visits_DESC]
      ) {
        sum { visits }
        dimensions { requestPath }
      }
      hourly: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $siteTag, datetime_geq: $sinceWindow, datetime_lt: $until }
        limit: 1000
        orderBy: [sum_visits_DESC]
      ) {
        sum { visits }
        dimensions { datetimeHour requestPath }
      }
    }
  }
}`;

const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

// Narrowed to the fields this route reads, and every one of them is guarded
// at the point of use rather than trusted -- the same posture
// worker/status.ts and worker/github.ts take toward Cloudflare's and
// GitHub's own responses. A 200 whose body is shaped differently than
// expected must not silently become zeroes.
interface RumRow {
  sum?: { visits?: unknown };
  dimensions?: { requestPath?: unknown; refererHost?: unknown; datetimeHour?: unknown };
}

interface RumAccount {
  last28?: unknown;
  previousWindow?: unknown;
  thisWeek?: unknown;
  priorWeek?: unknown;
  hourly?: unknown;
}

function rowsOf(value: unknown): RumRow[] {
  return Array.isArray(value) ? (value as RumRow[]) : [];
}

function visitsOf(row: RumRow): number {
  const visits = row.sum?.visits;
  return typeof visits === 'number' && Number.isFinite(visits) ? visits : 0;
}

function pathOf(row: RumRow): string {
  const path = row.dimensions?.requestPath;
  return normalizePath(typeof path === 'string' ? path : '');
}

function refererHostOf(row: RumRow): string {
  const host = row.dimensions?.refererHost;
  return typeof host === 'string' ? host : '';
}

// Sums visits over the rows that survive the /edit exclusion. This is where
// the fallback design actually pays: Card A's total and Card D's two weekly
// totals are all sums over FILTERED rows, so admin traffic is gone from
// every number on the screen and not just from the ranked list.
function totalVisits(rows: RumRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (isExcludedPath(pathOf(row))) continue;
    total += visitsOf(row);
  }
  return total;
}

// The one upstream call, factored out so the scheduled snapshot sends exactly
// the document Task 1 verified rather than a second one. Returns null on any
// failure -- the caller decides whether that is a 502 (the panel) or a
// skipped night (the snapshot).
//
// The rows go through isExcludedPath before they are summed, exactly as every
// card does, which is why requestPath is in the document at all. An archive
// that counted her own editing visits would sit permanently above the number
// printed beside it.
//
// EVERY VARIABLE THE DOCUMENT DECLARES IS SENT, INCLUDING THE ONES THIS
// CALLER THROWS AWAY. Sharing one document is what stops the archive and the
// panel counting differently; the price is that a node added for the panel
// adds a variable this sender must supply too. GraphQL coerces variables
// before it runs anything, so ONE missing non-null variable is not a missing
// node in the answer -- it is `data: null`, `errors[]`, and a nightly job
// that returns early and reports success forever. That is exactly what
// happened when `previousWindow`/`$sincePrevious` was added for the stat
// cards and only handleAnalytics was updated.
export async function totalVisitsFor(
  env: AnalyticsQueryEnv,
  since: string,
  until: string,
): Promise<number | null> {
  let upstream: Response;
  try {
    upstream = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: ANALYTICS_QUERY,
        variables: {
          accountTag: env.CLOUDFLARE_ACCOUNT_ID,
          siteTag: env.CF_WEB_ANALYTICS_SITE_TAG,
          sinceWindow: since,
          sinceThisWeek: since,
          sincePriorWeek: since,
          // `since` rather than an earlier moment, deliberately: it makes
          // previousWindow's own filter (`datetime_geq: $sincePrevious,
          // datetime_lt: $sinceWindow`) an EMPTY window, so the node this
          // caller discards costs the smallest answer Cloudflare can give
          // rather than a second day of rows nobody reads.
          sincePrevious: since,
          until,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!upstream.ok) return null;
  const parsed = (await upstream.json().catch(() => null)) as { data?: unknown; errors?: unknown[] } | null;
  if (!parsed || (Array.isArray(parsed.errors) && parsed.errors.length > 0)) return null;
  const accounts = (parsed.data as { viewer?: { accounts?: unknown } } | undefined)?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  return totalVisits(rowsOf((accounts[0] as RumAccount).last28));
}

// day 0-6 with 0 = Sunday, hour 0-23, IN IST. A restaurant deciding when to
// staff thinks in its own evenings; a chart in UTC would put Friday dinner in
// two different cells and split the one pattern the card exists to show.
//
// datetimeHour comes back as an ISO timestamp truncated to the hour. Shifted
// by a fixed +5:30 rather than through Intl, because Intl.DateTimeFormat in a
// Worker is a per-call cost inside a loop over up to 1000 rows, and IST has
// no daylight saving to get wrong.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function hourCells(rows: RumRow[]): AnalyticsHourCell[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (isExcludedPath(pathOf(row))) continue;
    const raw = typeof row.dimensions?.datetimeHour === 'string' ? row.dimensions.datetimeHour : '';
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) continue;
    const ist = new Date(at + IST_OFFSET_MS);
    // getUTCDay/getUTCHours on a Date ALREADY shifted by the offset -- not
    // getDay/getHours, which would apply the host's own timezone a second
    // time and give a different answer on every machine.
    const key = `${String(ist.getUTCDay())}:${String(ist.getUTCHours())}`;
    totals.set(key, (totals.get(key) ?? 0) + visitsOf(row));
  }
  return [...totals.entries()]
    .map(([key, visits]) => {
      const [day, hour] = key.split(':').map(Number);
      return { day, hour, visits };
    })
    .sort((a, b) => a.day - b.day || a.hour - b.hour);
}

function rankPaths(rows: RumRow[]): AnalyticsPathRow[] {
  const byPath = new Map<string, number>();
  for (const row of rows) {
    const path = pathOf(row);
    if (isExcludedPath(path)) continue;
    byPath.set(path, (byPath.get(path) ?? 0) + visitsOf(row));
  }
  return [...byPath.entries()]
    .map(([path, visits]) => ({ path, visits }))
    // Ties broken by path so the order is deterministic -- a list that
    // reshuffles between two identical responses reads as a bug.
    .sort((a, b) => b.visits - a.visits || a.path.localeCompare(b.path))
    .slice(0, BYPATH_LIMIT);
}

function rankReferers(rows: RumRow[], selfHost: string): AnalyticsRefererBucket[] {
  let direct = 0;
  let instagram = 0;
  let google = 0;
  const others = new Map<string, number>();

  for (const row of rows) {
    if (isExcludedPath(pathOf(row))) continue;
    const visits = visitsOf(row);
    const { kind, host } = bucketReferer(refererHostOf(row), selfHost);
    if (kind === 'direct') direct += visits;
    else if (kind === 'instagram') instagram += visits;
    else if (kind === 'google') google += visits;
    else if (host) others.set(host, (others.get(host) ?? 0) + visits);
  }

  const named: AnalyticsRefererBucket[] = (
    [
      ['direct', direct],
      ['instagram', instagram],
      ['google', google],
    ] as [RefererBucketKind, number][]
  )
    // A bucket nobody arrived through is absent, not a zero row. Four rows
    // where three of them say 0 reads as "this is broken"; one row that says
    // where people came from reads as an answer.
    .filter(([, visits]) => visits > 0)
    .map(([kind, visits]) => ({ kind, label: REFERER_BUCKET_LABELS[kind], host: null, visits }));

  const otherRows: AnalyticsRefererBucket[] = [...others.entries()]
    .map(([host, visits]) => ({ kind: 'other' as const, label: REFERER_BUCKET_LABELS.other, host, visits }))
    .sort((a, b) => b.visits - a.visits || (a.host ?? '').localeCompare(b.host ?? ''))
    .slice(0, OTHER_HOSTS_LIMIT);

  return [...named, ...otherRows].sort(
    (a, b) => b.visits - a.visits || (a.host ?? a.kind).localeCompare(b.host ?? b.kind),
  );
}

// ---------------------------------------------------------------------------
// The handler.
// ---------------------------------------------------------------------------

// The key carries BOTH the shape version and the range. The version retires
// every entry written by the previous deploy the moment this one lands (see
// PAYLOAD_SHAPE_VERSION's own ledger); the range is what stops four
// different questions sharing one answer.
const CACHE_KEY_PREFIX = `/__cache/analytics/${PAYLOAD_SHAPE_VERSION}`;
const CACHE_TTL_SECONDS = 600;

function jsonString(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function json(status: number, body: unknown): Response {
  return jsonString(status, JSON.stringify(body));
}

function fail(reason: AnalyticsFailureReason, message: string): Response {
  const body: AnalyticsError = { reason, message };
  // 502 for all three: the route itself is fine, its upstream is not. The
  // reason is what the screen actually reads, because "wait" and "fix a
  // token" are different human actions and an undifferentiated "something
  // went wrong" would have her retrying forever against a permission that
  // will never grant itself.
  return json(502, body);
}

// Midnight UTC at the start of today, so every window ends YESTERDAY and no
// partial day is compared against a whole one -- a half-finished today would
// make Card D say "quieter than last week" every single morning.
function startOfTodayUtc(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

// The one place this route writes to the edge cache, so both return paths
// store the SAME thing: a copy carrying `public, max-age=600` rather than the
// `no-store` copy the browser gets. Two hand-rolled copies of this block is
// how one of them ends up storing the wrong headers and the cache silently
// stops working -- see this file's header for why that failure is invisible.
async function putInCache(cache: Cache, key: Request, body: string): Promise<void> {
  try {
    await cache.put(
      key,
      new Response(body, {
        headers: {
          'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
          'Content-Type': 'application/json',
        },
      }),
    );
  } catch {
    // A cache write that fails costs the next caller an upstream call. It
    // must not cost this caller the answer she already has in hand.
  }
}

// Everything a year can honestly answer, and nothing it cannot.
//
// byPath and byReferer are EMPTY rather than stale: the rollup holds monthly
// totals, not a breakdown, and inventing one from the last 30 days under a
// twelve-month heading would be a false number. The panel does NOT render its
// usual "nothing to rank yet" copy for this -- the range control's task gives
// those two cards a sentence that says the breakdown is not kept, because the
// difference between "nothing was kept" and "nobody visited" is the
// distinction this whole screen exists to make.
async function yearPayload(env: AnalyticsEnv): Promise<AnalyticsPayload> {
  const today = todayInKolkata();
  const series = await monthlySeries(env.DB, firstMonthOfYearWindow(today)).catch(() => []);
  const visits = series.reduce((total, point) => total + point.visits, 0);

  let waCounts: Record<string, number> = {};
  try {
    waCounts = await readWaCounts(env.KV);
  } catch {
    waCounts = {};
  }

  return {
    windowDays: RANGE_DAYS.year,
    visits,
    visitsAreEstimate: true,
    byPath: [],
    byReferer: [],
    thisWeekVisits: 0,
    priorWeekVisits: 0,
    bookingTaps: {
      total: sumWaCounts(waCounts, recentIstDates(today, RANGE_DAYS.year)),
      days: RANGE_DAYS.year,
      lowerBound: true,
    },
    range: 'year',
    series: series.map((point) => ({ date: point.day, visits: point.visits, complete: point.complete })),
    seriesGrain: 'month',
    seriesSource: RUM_CAPABILITIES.dateDimension === null ? 'snapshot' : 'backfilled',
    // The earliest month IN VIEW, which is the earliest month the archive
    // holds for as long as the archive is shorter than twelve months -- and
    // monthly rows are never pruned (analytics-store.ts's pruneAnalytics
    // sweeps daily_visits and campaign_rate only), so from about a year after
    // the first roll these two stop being the same thing and the caption's
    // "when the record started" clause becomes false here in exactly the way
    // it was false at day grain. Closing it properly needs a MIN(month) read
    // this branch does not make today; it is recorded rather than assumed
    // away, and trendCaption already takes the two dates separately so the
    // fix is one query and one argument.
    seriesStartsOn: series[0]?.day ?? null,
    // A year cannot be an hour grid. The rollup holds one row per month, and
    // an hour is not recoverable from it at any price.
    hourly: null,
    campaigns: await readCampaignRows(env.DB, istDateDaysAgo(today, RANGE_DAYS.year - 1)),
    campaignsAreExact: true,
    // No comparison at year grain: the period before the last twelve months is
    // twelve months this archive does not have and cannot invent.
    visitsPrevious: 0,
    tapsPrevious: 0,
    yearAvailable: series.length > 0,
  };
}

export async function handleAnalytics(request: Request, env: AnalyticsEnv): Promise<Response> {
  // Same auth gate as every other admin route (worker/status.ts's
  // handleBuildStatus, worker/index.ts's handlePublish), and deliberately
  // BEFORE the cache is consulted: a cached body must never be served to an
  // unauthenticated caller, and an unauthenticated request must cost this
  // Worker one HMAC verify and nothing else -- no Cache API call, no KV read,
  // no Cloudflare API call.
  const token = parseCookie(request.headers.get('Cookie'), 'vb_session');
  const now = Math.floor(Date.now() / 1000);
  if (!token || !(await verifyToken(env.TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, token, now))) {
    return json(401, { message: 'Not authenticated.' });
  }

  // Lazily, inside the handler -- see this file's header for why module
  // scope would break every test that imports this file.
  const cache = caches.default;
  // ONE query parameter is read, and it can take four values. See
  // src/shared/analytics-payload.ts's parseRange for why it is an enum and
  // not a number: this endpoint's entire load control is the entry below, and
  // a numeric parameter would make the key space unbounded.
  //
  // Unrecognised input is not an error -- `?range=90`, `?range=` and
  // `?range=<anything>` all produce the 30-day key, the 30-day upstream call
  // and the 30-day body, and that is pinned by a test.
  const range = parseRange(new URL(request.url).searchParams.get('range'));
  const windowDays = RANGE_DAYS[range];
  const cacheKey = new Request(new URL(`${CACHE_KEY_PREFIX}/${range}`, request.url).toString());

  const cached = await cache.match(cacheKey);
  if (cached) {
    // Re-wrapped rather than returned as-is: the stored copy carries
    // `public, max-age=600` for the edge's benefit and that header must not
    // reach the browser, where this is per-session data behind a login.
    return jsonString(200, await cached.text());
  }

  // A year is OURS, entirely. Cloudflare holds about six months, so asking it
  // for twelve would return six and label them twelve -- the exact class of
  // quietly-wrong number this panel exists not to produce. This branch makes
  // no upstream call at all, which also means it cannot answer 502 when
  // Cloudflare is having a bad afternoon.
  if (range === 'year') {
    const yearBody = JSON.stringify(await yearPayload(env));
    await putInCache(cache, cacheKey, yearBody);
    return jsonString(200, yearBody);
  }

  const until = startOfTodayUtc(Date.now());
  const iso = (ms: number): string => new Date(ms).toISOString();

  let upstream: Response;
  try {
    upstream = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: ANALYTICS_QUERY,
        variables: {
          accountTag: env.CLOUDFLARE_ACCOUNT_ID,
          siteTag: env.CF_WEB_ANALYTICS_SITE_TAG,
          sinceWindow: iso(until - windowDays * DAY_MS),
          sinceThisWeek: iso(until - WEEK_DAYS * DAY_MS),
          sincePriorWeek: iso(until - 2 * WEEK_DAYS * DAY_MS),
          // The window immediately BEFORE this one, same length, ending where
          // this one begins -- see `visitsPrevious` below for why this is a
          // different question than thisWeek/priorWeek.
          sincePrevious: iso(until - 2 * windowDays * DAY_MS),
          until: iso(until),
        },
      }),
      // Same bound handleBuildStatus uses: generous for a JSON call, but a
      // hung upstream must not tie this route up for longer than a human
      // waiting on "how did last week go?" would tolerate. An abort lands in
      // the same catch as a network failure, and both mean the same thing to
      // her: try again in a minute.
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return fail('unreachable', 'Could not reach Cloudflare.');
  }

  // 401/403 is the one upstream failure with a DIFFERENT human action behind
  // it -- the token is missing Account Analytics: Read (plan prerequisite
  // P1) and no amount of retrying will grant it.
  if (upstream.status === 401 || upstream.status === 403) {
    return fail('upstream-auth', 'Cloudflare refused the analytics token.');
  }
  if (!upstream.ok) {
    return fail('upstream-error', `Cloudflare returned ${upstream.status} for the analytics query.`);
  }

  const parsed = (await upstream.json().catch(() => null)) as {
    data?: { viewer?: { accounts?: unknown } | null } | null;
    errors?: unknown;
  } | null;

  if (parsed === null) {
    return fail('upstream-error', 'Cloudflare returned an unreadable analytics response.');
  }

  // GraphQL answers 200 WITH an `errors` array. Collapsing that into "no
  // data yet" would report the most reassuring state possible at exactly the
  // wrong moment -- the identical trap worker/status.ts already documents
  // for Cloudflare's REST `success: false`. Empty-but-valid is the launch
  // state and must render as empty; malformed is a 502.
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    return fail('upstream-error', 'Cloudflare returned an error for the analytics query.');
  }

  const accounts = parsed.data?.viewer?.accounts;
  if (!Array.isArray(accounts)) {
    return fail('upstream-error', 'Cloudflare returned an unexpected analytics response shape.');
  }
  // An EMPTY accounts array is not zero data -- `accounts` is filtered by
  // accountTag, and a token that can read the account gets the node back
  // with empty groups inside it. Nothing coming back at all is what an
  // account/token mismatch looks like, and the spec's own prose says so.
  // This is a DELIBERATE, RECORDED departure from the spec's failure table,
  // which lists a missing accounts[0] under the 200-zero-data row: the whole
  // point of these three reasons is that the screen can tell "not set up"
  // from "no visitors yet", and answering zero-data here would say "no
  // visitors yet" to a token that will never work.
  if (accounts.length === 0) {
    return fail('upstream-auth', 'Cloudflare returned no account for this analytics token.');
  }

  const account = accounts[0] as RumAccount;
  const last28 = rowsOf(account.last28);
  const selfHost = new URL(request.url).host;

  // Swallowed for the same reason readWaCounts itself never throws: a KV
  // read that fails must degrade the tap number, which is already a
  // documented lower bound, rather than take the three cards that have
  // nothing to do with KV down with it.
  let waCounts: Record<string, number> = {};
  try {
    waCounts = await readWaCounts(env.KV);
  } catch {
    waCounts = {};
  }

  // THE THREE WINDOWS UNDER ONE PILL, stated here because they are not the
  // same window and a reader who assumes they are will draw the wrong
  // conclusion from any one of them. Whole-branch review, finding 5.
  //
  //   visits, visitsPrevious, pages, referrers -- `until` above is midnight
  //     UTC TODAY, so the window is `windowDays` UTC days ENDING YESTERDAY.
  //     Cloudflare has no complete figure for today and asking for a partial
  //     one would draw a column that shrinks as the day goes on.
  //
  //   bookingTaps -- `recentIstDates(today, windowDays)` counts back from
  //     yesterday, so `windowDays` of the restaurant's OWN calendar days,
  //     also ending yesterday. IST rather than UTC because the KV keys were
  //     written in IST and re-keying them would change the meaning of every
  //     date already stored (see recentIstDates' own comment). The two
  //     windows are therefore offset by 5h30m at their edges, which against
  //     thirty days is a fraction of a percent and is accepted.
  //
  //   campaigns -- `windowDays` IST days INCLUDING TODAY, and this is the one
  //     that genuinely differs rather than merely being offset. These rows are
  //     OURS: they exist the moment someone arrives, so there is no upstream
  //     lag to wait out, and this is the one card she can check by hand --
  //     paste a link, tap it, look. A window that stopped at yesterday would
  //     answer that check with a zero.
  //
  // The pill cannot say all of that, so the CARD does: CAMPAIGN_CAVEAT
  // (src/admin/manage/analytics.ts) tells her in as many words that today so
  // far is in this number and not in the ones above it. Changing either half
  // without the other puts a label back in front of her that disagrees with
  // what it counts.
  const today = todayInKolkata();
  const sinceDay = istDateDaysAgo(today, windowDays - 1);
  const campaigns = await readCampaignRows(env.DB, sinceDay);

  // The trend chart ALWAYS reads from our own snapshots, never from Cloudflare
  // directly, whichever way the schema verification went (see
  // worker/analytics-schema.ts). That is what collapses the date-dimension
  // branch from two implementations to one optional backfill step, so no
  // later task can rewrite an earlier one either way.
  //
  // `day` becomes `date` here and nowhere else: analytics-store.ts holds ONE
  // row shape for days and months alike, because a chart draws a run of
  // points against an ordered axis and does not care what a point is called.
  // `seriesGrain` below is what says which this one is.
  //
  // Each read degrades on its own. A missing archive costs the chart and
  // leaves every Cloudflare-fed card standing, the same bargain
  // readCampaignRows and readWaCounts already keep.
  const series = (await dailySince(env.DB, sinceDay).catch(() => [])).map((point) => ({
    date: point.day,
    visits: point.visits,
    complete: point.complete,
  }));
  const seriesStartsOn = await firstDailyDay(env.DB).catch(() => null);
  const yearAvailable = (await monthlyCount(env.DB).catch(() => 0)) > 0;

  const payload: AnalyticsPayload = {
    windowDays,
    visits: totalVisits(last28),
    visitsAreEstimate: true,
    byPath: rankPaths(last28),
    byReferer: rankReferers(last28, selfHost),
    thisWeekVisits: totalVisits(rowsOf(account.thisWeek)),
    priorWeekVisits: totalVisits(rowsOf(account.priorWeek)),
    bookingTaps: {
      total: sumWaCounts(waCounts, recentIstDates(today, windowDays)),
      days: windowDays,
      lowerBound: true,
    },
    range,
    series,
    seriesGrain: 'day',
    // 'backfilled' only when the verification found a date dimension, which
    // is the one thing that lets the nightly job's first run reach ninety
    // days backwards. Set from RUM_CAPABILITIES so the chart's caption cannot
    // claim a reach backwards that never happened.
    seriesSource: RUM_CAPABILITIES.dateDimension === null ? 'snapshot' : 'backfilled',
    seriesStartsOn,
    // An array, because this dataset DOES have an hour dimension
    // (worker/analytics-schema.ts). Empty means nobody arrived in any hour of
    // the window; `null` -- which only the by-year branch above returns -- is
    // the different sentence, "this range cannot answer that question".
    hourly: hourCells(rowsOf(account.hourly)),
    campaigns,
    campaignsAreExact: true,
    // NOT thisWeekVisits/priorWeekVisits. Those two are Card D's, they are a
    // fixed seven days against the seven before, and they are correct for the
    // sentence that card writes. Reusing them here would make the stat cards
    // and Card D disagree at every range EXCEPT 7d -- she would read
    // "18% more visits" beside "about the same as usual" on one screen, with
    // nothing to tell her which was answering which question.
    visitsPrevious: totalVisits(rowsOf(account.previousWindow)),
    tapsPrevious: sumWaCounts(
      waCounts,
      // The window BEFORE this one: skip the current windowDays, then take
      // the next windowDays back. recentIstDates already ends yesterday, so
      // slicing is the whole of it.
      recentIstDates(today, windowDays * 2).slice(windowDays),
    ),
    yearAvailable,
  };

  // Built ONCE as a string, then two Responses -- see this file's header.
  const body = JSON.stringify(payload);
  await putInCache(cache, cacheKey, body);
  return jsonString(200, body);
}
