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
// ---------------------------------------------------------------------------
// SUBREQUEST AND CPU BUDGET -- recomputed if anything is added here.
// ---------------------------------------------------------------------------
// Workers Free allows 50 subrequests and 10ms CPU per invocation, and Cache
// API calls count toward the 50 the same way KV calls do. This route's WORST
// case is FOUR: `cache.match`, one GraphQL `fetch`, one `KV.get`,
// `cache.put`. A cache HIT is ONE. CPU is one HMAC verify (the session gate)
// plus a `JSON.parse` and a single pass over at most 1000 small rows.
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
//   2. The key is a FIXED, CONSTRUCTED, IN-ZONE request:
//      `/__cache/analytics/v1` on this Worker's own origin. Fixed and
//      constructed rather than derived from the incoming request, so the
//      session cookie can never enter the key (two logins would fragment the
//      cache, and a cached body could be keyed to a credential) and no query
//      string can multiply it into an unbounded number of upstream calls.
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
// every question these four cards ask is a 7- or 28-day question so nothing
// she can perceive changes inside ten minutes, and it bounds upstream
// GraphQL calls to six per hour per colo however often the dashboard
// reloads or misbehaves.
//
// `await cache.put(...)` inline rather than `ctx.waitUntil(...)`: this
// Worker's `fetch` handler and its `route()` take `(request, env)` with no
// ExecutionContext, and threading one through every route for a
// sub-millisecond edge write is a wider change than it is worth.
import { parseCookie, verifyToken } from './auth';
import { todayInKolkata } from '../src/shared/date';
import { readWaCounts } from './wa';
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

export type AnalyticsEnv = PagesEnv &
  WebAnalyticsEnv & {
    KV: KVNamespace;
    TOKEN_SECRET: string;
    ADMIN_PASSWORD_HASH: string;
  };

// ---------------------------------------------------------------------------
// The response body. Shared with the dashboard that renders it.
//
// SCOPE NOTE, recorded rather than left as a surprise: the plan's task C1
// puts these declarations in `src/shared/analytics-payload.ts`, so the Worker
// that produces the body and the React area that renders it cannot drift.
// This module was written under an instruction not to touch anything outside
// `worker/` and `wrangler.toml`, so they live here for now and are exported.
// When C1 lands, this block MOVES there and this file imports it -- the
// shapes below are written to be that module's contents verbatim so the move
// is a move, not a rewrite.
// ---------------------------------------------------------------------------

// Which of Card C's four buckets a referring host fell into. `kind` is the
// machine value the UI switches on; `label` is the words the spec fixes,
// kept beside it so the Worker's bucketing and the screen's wording cannot
// disagree about what a bucket IS. `host` is set only for `other`, where the
// card shows the real hostname in smaller text under "Other links".
export type RefererBucketKind = 'direct' | 'instagram' | 'google' | 'other';

export interface AnalyticsRefererBucket {
  kind: RefererBucketKind;
  label: string;
  host: string | null;
  visits: number;
}

export interface AnalyticsPathRow {
  // Already normalised: no query string, no trailing slash except for `/`
  // itself. Deliberately NOT translated into a page name here -- that is
  // `labelForPath` on the dashboard, which has pages.json to hand and is a
  // pure function with its own table test.
  path: string;
  visits: number;
}

export interface AnalyticsPayload {
  // 28. Stated in the body rather than assumed by the reader, because every
  // number below is scoped to it and the card copy quotes it.
  windowDays: number;
  // An ESTIMATE. `rumPageloadEventsAdaptiveGroups` is an adaptive, sampled
  // dataset, which is why Card A reads "about 4,100 visits" and not "4,100".
  visits: number;
  visitsAreEstimate: true;
  byPath: AnalyticsPathRow[];
  byReferer: AnalyticsRefererBucket[];
  thisWeekVisits: number;
  priorWeekVisits: number;
  // A LOWER BOUND, not a count -- origin-checked, rate-limited, capped per
  // day and delivered by fire-and-forget sendBeacon (see worker/index.ts's
  // /api/wa file comment). `lowerBound` is in the body, not just in a
  // comment, so the dashboard cannot forget: the card says "at least 41
  // tapped Reserve a Table", never "41 bookings".
  bookingTaps: { total: number; days: number; lowerBound: true };
}

export type AnalyticsFailureReason = 'unreachable' | 'upstream-auth' | 'upstream-error';

export interface AnalyticsError {
  reason: AnalyticsFailureReason;
  message: string;
}

// The launch state, and the fixture both sides test against. Every count is
// zero and every list is empty -- which is what "the beacon shipped
// yesterday" looks like, and is NOT an error. That distinction is the whole
// reason the failure bodies above carry a `reason` instead of the route
// answering 200-with-nothing for both.
export const ZERO_DATA_PAYLOAD: AnalyticsPayload = {
  windowDays: 28,
  visits: 0,
  visitsAreEstimate: true,
  byPath: [],
  byReferer: [],
  thisWeekVisits: 0,
  priorWeekVisits: 0,
  bookingTaps: { total: 0, days: 28, lowerBound: true },
};

// ---------------------------------------------------------------------------
// Pure helpers. Exported because they carry every judgement on this route
// that a human would argue with, and a function that can be table-tested is
// the only honest place to put a judgement.
// ---------------------------------------------------------------------------

const WINDOW_DAYS = 28;
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

export function sumWaCounts(counts: Record<string, number>, dates: string[]): number {
  return dates.reduce((total, date) => total + (counts[date] ?? 0), 0);
}

// ---------------------------------------------------------------------------
// The GraphQL document.
// ---------------------------------------------------------------------------

const ANALYTICS_QUERY = `query ViaBiancaAnalytics(
  $accountTag: String!
  $siteTag: String!
  $since28: Time!
  $sinceThisWeek: Time!
  $sincePriorWeek: Time!
  $until: Time!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      last28: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $siteTag, datetime_geq: $since28, datetime_lt: $until }
        limit: 1000
        orderBy: [sum_visits_DESC]
      ) {
        sum { visits }
        dimensions { requestPath refererHost }
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
  dimensions?: { requestPath?: unknown; refererHost?: unknown };
}

interface RumAccount {
  last28?: unknown;
  thisWeek?: unknown;
  priorWeek?: unknown;
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

const CACHE_KEY_PATH = '/__cache/analytics/v1';
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
  // NO query parameters are read, anywhere in this handler. The windows are
  // fixed in this module. A caller-supplied range would be an unbounded
  // cache-key space, and therefore an unbounded number of upstream calls,
  // behind an endpoint whose entire load control is this single entry.
  // `?days=90` therefore produces this same key, this same upstream call and
  // this same body as the bare URL, and that is pinned by a test.
  const cacheKey = new Request(new URL(CACHE_KEY_PATH, request.url).toString());

  const cached = await cache.match(cacheKey);
  if (cached) {
    // Re-wrapped rather than returned as-is: the stored copy carries
    // `public, max-age=600` for the edge's benefit and that header must not
    // reach the browser, where this is per-session data behind a login.
    return jsonString(200, await cached.text());
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
          since28: iso(until - WINDOW_DAYS * DAY_MS),
          sinceThisWeek: iso(until - WEEK_DAYS * DAY_MS),
          sincePriorWeek: iso(until - 2 * WEEK_DAYS * DAY_MS),
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

  const payload: AnalyticsPayload = {
    windowDays: WINDOW_DAYS,
    visits: totalVisits(last28),
    visitsAreEstimate: true,
    byPath: rankPaths(last28),
    byReferer: rankReferers(last28, selfHost),
    thisWeekVisits: totalVisits(rowsOf(account.thisWeek)),
    priorWeekVisits: totalVisits(rowsOf(account.priorWeek)),
    bookingTaps: {
      total: sumWaCounts(waCounts, recentIstDates(todayInKolkata(), WINDOW_DAYS)),
      days: WINDOW_DAYS,
      lowerBound: true,
    },
  };

  // Built ONCE as a string, then two Responses -- see this file's header.
  const body = JSON.stringify(payload);
  try {
    await cache.put(
      cacheKey,
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
  return jsonString(200, body);
}
