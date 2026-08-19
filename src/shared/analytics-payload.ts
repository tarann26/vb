// The body of GET /api/analytics: what the Worker produces and what the
// dashboard's Numbers screen renders.
//
// ONE module, shared by both sides, because the alternative is two
// declarations of the same shape drifting apart until the first integration
// is a rewrite. `worker/` already imports from `src/shared/` (base64,
// image-format, derivative-path, upload-categories) and nothing in `src/`
// imports `worker/`, so this keeps that one-way boundary intact.
//
// Types, four small constants, and three pure predicates. Nothing here
// reaches the network, touches the DOM or reads a global; `parseRange` and
// `isAnalyticsPayload` run on both a request path and a render path, so they
// stay total functions over untrusted input and never throw.
//
// PROVENANCE, recorded honestly. worker/analytics.ts landed first, under an
// instruction not to touch anything outside `worker/`, and declared these
// shapes itself with a note saying they should move here. They did: that
// module now imports this one and its own copy is gone, which is the end
// state `src/shared/__tests__/analytics-payload.test.ts`'s drift guard was
// waiting for -- and which is why that guard now reports itself skipped.
//
// THE SHAPE IS v2 AND IT IS CUT ONCE. Every field any later piece of this
// work needs already exists below, including the two that are `null` at
// launch. A change here is a cache-key version bump; see
// PAYLOAD_SHAPE_VERSION for the ledger of which versions are spent.

// The four ranges, and only four. NOT `?days=<number>`: this endpoint's
// entire load control is one Cache API entry, and a numeric parameter is an
// unbounded key space and therefore an unbounded number of upstream GraphQL
// calls. Four values means at most four entries, so the worst case is four
// upstream calls per ten minutes per colo -- 24 an hour, against a quota
// measured in hundreds a minute.
export type AnalyticsRange = '7d' | '30d' | '90d' | 'year';

// 30, not the 28 this panel shipped with. The spec asks for 30 and the
// difference is two days of a number already labelled an estimate; changing
// it once, here, where the contract is cut, is cheaper than carrying two
// window lengths that mean nearly the same thing.
export const DEFAULT_RANGE: AnalyticsRange = '30d';

export const RANGE_DAYS: Record<AnalyticsRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  // A year is served entirely from our own monthly rollup and never touches
  // Cloudflare, which holds about six months.
  year: 365,
};

// The SHAPE version, and it is part of the cache key.
//
// A body written by the previous deploy deserialises into a payload with no
// `series` and no `campaigns`, which isAnalyticsPayload below correctly calls
// an error -- so without this the dashboard would show
// "the visitor numbers aren't connected yet" for the ten minutes each deploy
// takes to age out its own cache entries. Bumping the version retires every
// old entry at once instead of waiting and hoping.
//
// THE LEDGER, so the next reader knows which versions are spent:
//   v1  the shape this panel shipped with.
//   v2  THIS cut -- range, series, hourly, campaigns, the previous-period
//       numbers, yearAvailable. The shape is cut ONCE in this plan, so v2 is
//       the only version it spends.
//   v3..v6  reserved, deliberately unspent. If a field is genuinely needed
//       later, v3 is next.
// THE RULE: a version belonging to a task that gets cut is never renumbered.
// Renumbering is how two deploys come to disagree about what a key means.
export const PAYLOAD_SHAPE_VERSION = 'v2' as const;

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return value === '7d' || value === '30d' || value === '90d' || value === 'year';
}

// Anything unrecognised is the default, never an error. A caller who types
// `?range=90` or `?range=<script>` gets the 30-day answer, one cache entry is
// consulted, and no branch of this Worker ever sees an unbounded string.
export function parseRange(raw: string | null): AnalyticsRange {
  return isAnalyticsRange(raw) ? raw : DEFAULT_RANGE;
}

// One point per bucket, ascending. `date` is 'YYYY-MM-DD' at day grain and
// 'YYYY-MM' at month grain -- ONE type for both, because a MonthlyPoint
// identical to a DailyPoint but for the string format would mean two chart
// components tomorrow. The payload's `seriesGrain` says which it is.
export interface AnalyticsSeriesPoint {
  date: string;
  visits: number;
  // False only for a month the archive holds partially. The first year of the
  // by-year view IS a partial year and cannot be made otherwise, so the panel
  // marks the column rather than drawing a short one beside full ones and
  // letting her read a fall in traffic into it. Always true at day grain.
  complete: boolean;
}

// `day` is 0-6 with 0 = Sunday; `hour` is 0-23 in IST, because a restaurant
// deciding when to staff thinks in its own evenings, not in UTC.
export interface AnalyticsHourCell {
  day: number;
  hour: number;
  visits: number;
}

// EXACT, unlike everything else on this screen: these are rows we wrote
// ourselves, not a sampled estimate. `source` is one of the seven the Worker
// will store; `label` is the words the card shows.
export interface AnalyticsCampaignRow {
  source: string;
  label: string;
  arrivals: number;
}

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
  // RANGE_DAYS[range]. Stated in the body rather than assumed by the reader,
  // because every number below is scoped to it and the card copy quotes it.
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

  // Which range produced everything above. Echoed back rather than assumed,
  // so a cached body served under the wrong key shows on screen instead of
  // silently relabelling 90 days as 30 -- and so the panel can discard an
  // answer for a range she is no longer looking at.
  range: AnalyticsRange;

  // The trend chart's series, ascending.
  series: AnalyticsSeriesPoint[];
  seriesGrain: 'day' | 'month';
  // 'snapshot' means the archive starts the day the nightly job was switched
  // on. 'backfilled' means its first run reached ninety days backwards. The
  // chart's caption SAYS which, rather than beginning at an unexplained zero.
  seriesSource: 'snapshot' | 'backfilled';
  // The first bucket the archive holds, or null when it holds nothing.
  seriesStartsOn: string | null;

  // The busiest-times chart, or null meaning THIS SITE CANNOT ANSWER THAT.
  // null is not an empty set of cells and is not an error: Cloudflare's RUM
  // dataset either exposes an hour dimension or it does not
  // (worker/analytics-schema.ts), and when it does not the card is not drawn.
  hourly: AnalyticsHourCell[] | null;

  // Tagged arrivals, ours, exact, ordered by volume.
  campaigns: AnalyticsCampaignRow[];
  campaignsAreExact: true;

  // The same two measures over the PREVIOUS equivalent period, for the
  // comparison on the stat cards. Zero is a real answer here and means the
  // previous period genuinely had none.
  visitsPrevious: number;
  tapsPrevious: number;

  // Whether the monthly rollup holds anything at all. The range control
  // renders three buttons until this is true -- the spec says "once the
  // archive has filled", and offering a fourth button against an empty
  // rollup on day one teaches her the feature is broken.
  yearAvailable: boolean;
}

export type AnalyticsFailureReason = 'unreachable' | 'upstream-auth' | 'upstream-error';

export interface AnalyticsError {
  reason: AnalyticsFailureReason;
  message: string;
}

// A 200 whose body is not this shape is an ERROR, not an empty state -- the
// same refusal worker/status.ts documents for Cloudflare's REST
// `success: false`. Collapsing a malformed answer into "nothing to report"
// reports the most reassuring state possible at exactly the wrong moment,
// and here it would also throw mid-render on the first
// `undefined.toLocaleString()`, costing the whole area rather than one card.
//
// Structural rather than exhaustive: this guards against a shape change and
// a proxy's error page, not against a malicious server, and a check per leaf
// would be a second schema to keep in step with the first.
export function isAnalyticsPayload(value: unknown): value is AnalyticsPayload {
  if (value === null || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  const numbers = ['visits', 'windowDays', 'thisWeekVisits', 'priorWeekVisits', 'visitsPrevious', 'tapsPrevious'];
  if (!numbers.every((key) => typeof body[key] === 'number')) return false;
  const lists = ['byPath', 'byReferer', 'series', 'campaigns'];
  if (!lists.every((key) => Array.isArray(body[key]))) return false;
  if (!isAnalyticsRange(body.range)) return false;
  if (body.seriesGrain !== 'day' && body.seriesGrain !== 'month') return false;
  if (body.seriesSource !== 'snapshot' && body.seriesSource !== 'backfilled') return false;
  if (body.hourly !== null && !Array.isArray(body.hourly)) return false;
  if (typeof body.yearAvailable !== 'boolean') return false;
  const taps = body.bookingTaps as Record<string, unknown> | undefined;
  return typeof taps?.total === 'number' && typeof taps?.days === 'number';
}

// The launch state, and the fixture both sides test against. Every count is
// zero and every list is empty -- which is what "the beacon shipped
// yesterday" looks like, and is NOT an error. That distinction is the whole
// reason the failure bodies above carry a `reason` instead of the route
// answering 200-with-nothing for both.
export const ZERO_DATA_PAYLOAD: AnalyticsPayload = {
  windowDays: RANGE_DAYS[DEFAULT_RANGE],
  visits: 0,
  visitsAreEstimate: true,
  byPath: [],
  byReferer: [],
  thisWeekVisits: 0,
  priorWeekVisits: 0,
  bookingTaps: { total: 0, days: RANGE_DAYS[DEFAULT_RANGE], lowerBound: true },
  range: DEFAULT_RANGE,
  series: [],
  seriesGrain: 'day',
  seriesSource: 'snapshot',
  seriesStartsOn: null,
  hourly: null,
  campaigns: [],
  campaignsAreExact: true,
  visitsPrevious: 0,
  tapsPrevious: 0,
  yearAvailable: false,
};
