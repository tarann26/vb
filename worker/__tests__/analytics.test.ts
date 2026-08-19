import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleAnalytics,
  bucketReferer,
  firstMonthOfYearWindow,
  hourCells,
  isExcludedPath,
  istDateDaysAgo,
  normalizePath,
  recentIstDates,
  sumWaCounts,
  type AnalyticsEnv,
} from '../analytics';
import { asD1, FakeD1 } from './fakeD1';
import { refusalFor } from './graphqlDocument';
import { RUM_CAPABILITIES } from '../analytics-schema';
import { todayInKolkata } from '../../src/shared/date';
import {
  PAYLOAD_SHAPE_VERSION,
  ZERO_DATA_PAYLOAD,
  isAnalyticsPayload,
  type AnalyticsError,
  type AnalyticsPayload,
} from '../../src/shared/analytics-payload';
import worker, { type Env } from '../index';
import { signToken } from '../auth';
import { site } from '../../src/content';

// GET /api/analytics -- the Worker half of the dashboard's "Numbers" screen.
//
// Runs under this repo's single jsdom Vitest environment, same as every
// other worker/__tests__ file (see vitest.config.ts's comment) -- fetch,
// Request, Response and URL here come from Node itself, not jsdom.
//
// TWO globals have to be manufactured for this file, and the reason each is
// manufactured rather than mocked at a module boundary matters:
//
//   `caches`  -- does not exist in this environment AT ALL (workerd-only;
//                add it to vitest.config.ts's "Absent, needs a workaround"
//                list). The fake below is deliberately a real cache, not a
//                spy: it stores what it is given and answers `match` from
//                what it stored, so "a second request makes no upstream
//                call" is a behavioural assertion rather than a count of
//                method calls. It also REFUSES to store a `no-store`
//                response, exactly as the real Cache API does, because that
//                refusal is the silent failure worker/analytics.ts's header
//                block is most worried about: get it wrong and every request
//                becomes a live GraphQL call while nothing errors.
//   `fetch`    -- stubbed so no test in this file can reach the real
//                Cloudflare API. Every stub returns a real `Response`, so
//                the handler's own `res.ok` / `res.json()` path is the one
//                under test rather than a mock of it.
//
// What is NOT done here: driving these cases through `worker.fetch`. The
// browser-facing `Cache-Control: no-store` in particular MUST be asserted
// against `handleAnalytics` directly -- `withSecurityHeaders` sets that
// header on every response leaving this Worker unconditionally, so a
// router-driven assertion would pass even if this module set nothing at all,
// and a test that cannot fail is worse than no test.

const SITE_ORIGIN = new URL(site.seo.url).origin;
const SITE_HOST = new URL(site.seo.url).host;
// The key carries the shape version AND the range. Spelled out with the
// version interpolated and the range as a literal, so leaving CACHE_KEY_PREFIX
// at v1 moves this and the assertions below go red -- which is the whole
// point of putting a version in a cache key.
const DEFAULT_CACHE_KEY_URL = `${SITE_ORIGIN}/__cache/analytics/${PAYLOAD_SHAPE_VERSION}/30d`;

const TOKEN_SECRET = 'analytics-test-token-secret';
// Deliberately NOT in `pbkdf2$<iterations>$<salt>$<hash>` shape:
// src/test/secrets.test.ts scans every tracked file for that pattern to stop
// a real password hash being committed. Nothing here needs a well-formed
// hash -- the session key treats it as opaque key material.
const PASSWORD_HASH = 'analytics-test-only-password-hash-placeholder';

class FakeKV {
  store = new Map<string, string>();
  puts: string[] = [];
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
    this.puts.push(key);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class FakeCache {
  entries = new Map<string, { body: string; headers: Headers }>();
  // Every put, in order, with the headers it was called with -- the stored
  // `Cache-Control` is a claim about this module and is unreadable from the
  // returned response, which carries the opposite value on purpose.
  puts: { url: string; cacheControl: string | null }[] = [];
  matches: string[] = [];

  async match(key: Request): Promise<Response | undefined> {
    this.matches.push(key.url);
    const entry = this.entries.get(key.url);
    return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
  }

  async put(key: Request, response: Response): Promise<void> {
    const cacheControl = response.headers.get('Cache-Control');
    this.puts.push({ url: key.url, cacheControl });
    // The real Cache API refuses a response it is told not to store. Mirrored
    // here so that storing the wrong copy is a cache that never hits, not a
    // cache that quietly works in tests and never works in production.
    if (cacheControl && /no-store/i.test(cacheControl)) return;
    this.entries.set(key.url, { body: await response.text(), headers: response.headers });
  }
}

let kv: FakeKV;
let cache: FakeCache;
let d1: FakeD1;
let env: AnalyticsEnv;
let fetchStub: ReturnType<typeof vi.fn>;

function buildEnv(overrides: Partial<AnalyticsEnv> = {}): AnalyticsEnv {
  return {
    KV: kv as unknown as KVNamespace,
    ADMIN_PASSWORD_HASH: PASSWORD_HASH,
    TOKEN_SECRET,
    CLOUDFLARE_ACCOUNT_ID: 'analytics-test-account-id',
    CLOUDFLARE_PAGES_PROJECT: 'analytics-test-project',
    CLOUDFLARE_API_TOKEN: 'analytics-test-cf-token-not-real',
    CF_WEB_ANALYTICS_SITE_TAG: 'analytics-test-site-tag',
    // A REAL fake, not an empty object: readCampaignRows swallows a D1
    // failure by design, so an env whose DB throws on every statement would
    // make every campaign assertion in this file pass on the catch arm
    // instead of on the query.
    DB: asD1(d1),
    ...overrides,
  };
}

// `lifetime` exists so two calls can produce two GENUINELY DIFFERENT tokens.
// `signToken` is deterministic in its claims and `Date.now()` only moves in
// whole seconds here, so two back-to-back calls with the same arguments
// return the same string -- which would make the "two different sessions
// share one cache entry" case below assert nothing at all. Varying `exp`
// varies the signed payload while leaving both tokens perfectly valid.
async function cookie(secret = TOKEN_SECRET, lifetime = 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return `vb_session=${await signToken(secret, PASSWORD_HASH, now, now + lifetime)}`;
}

async function authed(path = '/api/analytics', sessionCookie?: string): Promise<Request> {
  return new Request(`${SITE_ORIGIN}${path}`, {
    headers: { Cookie: sessionCookie ?? (await cookie()) },
  });
}

type Row = { path?: string; referer?: string; visits: number };
// The hourly node groups by (datetimeHour x requestPath), so its rows carry a
// timestamp where the other three carry a referer.
type HourRow = { at: string; visits: number; path?: string };

function rowsToNodes(rows: Row[], withReferer: boolean): unknown[] {
  return rows.map((row) => ({
    sum: { visits: row.visits },
    dimensions: withReferer
      ? { requestPath: row.path ?? '/', refererHost: row.referer ?? '' }
      : { requestPath: row.path ?? '/' },
  }));
}

function hourRowsToNodes(rows: HourRow[]): unknown[] {
  return rows.map((row) => ({
    sum: { visits: row.visits },
    dimensions: { datetimeHour: row.at, requestPath: row.path ?? '/' },
  }));
}

// A well-formed Cloudflare GraphQL success body.
function graphqlOk(
  opts: {
    last28?: Row[];
    previousWindow?: Row[];
    thisWeek?: Row[];
    priorWeek?: Row[];
    hourly?: HourRow[];
  } = {},
): Response {
  return new Response(
    JSON.stringify({
      data: {
        viewer: {
          accounts: [
            {
              last28: rowsToNodes(opts.last28 ?? [], true),
              previousWindow: rowsToNodes(opts.previousWindow ?? [], false),
              thisWeek: rowsToNodes(opts.thisWeek ?? [], false),
              priorWeek: rowsToNodes(opts.priorWeek ?? [], false),
              hourly: hourRowsToNodes(opts.hourly ?? []),
            },
          ],
        },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function respondWith(response: () => Response): void {
  fetchStub.mockImplementation(async () => response());
}

// The launch state THIS SITE produces, which is ZERO_DATA_PAYLOAD in every
// field but two.
//
// `hourly` is an EMPTY ARRAY here, not the shared fixture's `null`. Null means
// "this site cannot answer that question", and this site can: the
// verification found `datetimeHour` on the dataset, so a window nobody
// visited yields zero cells rather than no grid. src/shared/ must never
// import from worker/, so the shared fixture cannot know that either.
//
// `seriesSource` is read from worker/analytics-schema.ts, and that constant
// records a real `date` dimension on this dataset -- so the nightly job's
// first run reaches ninety days backwards and the payload says 'backfilled'
// from the start. The shared fixture cannot know that: it lives in
// src/shared/, which must never import from worker/, and it therefore holds
// the value for a dataset with no date dimension. Spelled as a LITERAL rather
// than derived from RUM_CAPABILITIES, so re-running the verification to a
// different answer reddens this instead of quietly agreeing with itself.
const ZERO_DATA_HERE: AnalyticsPayload = { ...ZERO_DATA_PAYLOAD, seriesSource: 'backfilled', hourly: [] };

async function payloadOf(response: Response): Promise<AnalyticsPayload> {
  return (await response.json()) as AnalyticsPayload;
}

async function errorOf(response: Response): Promise<AnalyticsError> {
  return (await response.json()) as AnalyticsError;
}

beforeEach(() => {
  kv = new FakeKV();
  cache = new FakeCache();
  d1 = new FakeD1();
  env = buildEnv();
  // Refuses an incomplete request at the same point Cloudflare refuses it --
  // variable coercion, before any node runs. The exact assertion below
  // (`body.variables` by toEqual on the whole set) already pins THIS sender;
  // what this adds is that the sender cannot be broken by a document change
  // elsewhere and stay green here. The other sender of the same document had
  // no such assertion and was broken for exactly that reason
  // (worker/__tests__/graphqlDocument.ts).
  fetchStub = vi.fn(async (_url: string, init: RequestInit) => refusalFor(init.body as string) ?? graphqlOk());
  vi.stubGlobal('caches', { default: cache });
  vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The gate. Everything else in this file assumes it holds.
// ---------------------------------------------------------------------------

describe('the session gate', () => {
  it('refuses a request with no cookie, and touches nothing else at all', async () => {
    const response = await handleAnalytics(new Request(`${SITE_ORIGIN}/api/analytics`), env);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Not authenticated.' });
    // The point of checking auth BEFORE the cache: a cached body must never
    // be served to an unauthenticated caller, and an unauthenticated request
    // must cost this Worker one HMAC verify and nothing else.
    expect(cache.matches).toEqual([]);
    expect(cache.puts).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(kv.store.size).toBe(0);
  });

  it('refuses a cookie signed with a different secret', async () => {
    const response = await handleAnalytics(
      await authed('/api/analytics', await cookie('some-other-secret')),
      env,
    );

    expect(response.status).toBe(401);
    expect(cache.matches).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('never serves a cached body to an unauthenticated caller', async () => {
    // Warm the cache with a real, authenticated request first, so the entry
    // genuinely exists when the anonymous one arrives.
    await handleAnalytics(await authed(), env);
    expect(cache.entries.size).toBe(1);

    const response = await handleAnalytics(new Request(`${SITE_ORIGIN}/api/analytics`), env);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('windowDays');
  });
});

// ---------------------------------------------------------------------------
// Degrading honestly. The whole reason the failure bodies carry a `reason`.
// ---------------------------------------------------------------------------

describe('failure shapes', () => {
  it('answers 200 with zero data when the account is valid but has no rows yet', async () => {
    // THE LAUNCH STATE, and the case most easily got wrong in the
    // reassuring direction. An empty-but-valid response is "nobody has
    // visited yet", which is not an error and must not read as one.
    respondWith(() => graphqlOk());

    const response = await handleAnalytics(await authed(), env);

    expect(response.status).toBe(200);
    expect(await payloadOf(response)).toEqual(ZERO_DATA_HERE);
  });

  it('answers 502 upstream-error when GraphQL returns 200 with a non-empty errors array', async () => {
    // Cloudflare's GraphQL API answers 200 WITH errors. Collapsing that into
    // zero data would report the most reassuring state possible at exactly
    // the wrong moment.
    // The fixture carries a WELL-FORMED `data` alongside the errors, which is
    // what GraphQL actually does -- it answers with partial data and an error
    // list rather than one or the other. A fixture with `data: null` would
    // make this case pass through the malformed-shape branch instead, so it
    // would go on passing with the errors check deleted entirely and would
    // prove nothing about the branch it names.
    respondWith(
      () =>
        new Response(
          JSON.stringify({
            data: {
              viewer: {
                accounts: [
                  {
                    last28: [{ sum: { visits: 3 }, dimensions: { requestPath: '/', refererHost: '' } }],
                    thisWeek: [],
                    priorWeek: [],
                  },
                ],
              },
            },
            errors: [{ message: 'unable to query the requested data' }],
          }),
          { status: 200 },
        ),
    );

    const response = await handleAnalytics(await authed(), env);

    expect(response.status).toBe(502);
    expect((await errorOf(response)).reason).toBe('upstream-error');
    // A failure is never cached: it would pin the screen to "not connected"
    // for ten minutes after the token was fixed.
    expect(cache.puts).toEqual([]);
  });

  it('answers 502 upstream-error when GraphQL returns 200 with an empty errors array', async () => {
    // `errors: []` is a success. Treating any `errors` key as a failure
    // would make the launch state unreachable.
    respondWith(() => new Response(JSON.stringify({ data: { viewer: { accounts: [{}] } }, errors: [] })));

    const response = await handleAnalytics(await authed(), env);
    expect(response.status).toBe(200);
  });

  for (const status of [401, 403]) {
    it(`answers 502 upstream-auth when Cloudflare returns ${status}`, async () => {
      // The one upstream failure with a different human action behind it:
      // the token is missing Account Analytics: Read, and retrying will
      // never grant it.
      respondWith(() => new Response('nope', { status }));

      const response = await handleAnalytics(await authed(), env);

      expect(response.status).toBe(502);
      expect((await errorOf(response)).reason).toBe('upstream-auth');
    });
  }

  it('answers 502 upstream-auth when the accounts array comes back empty', async () => {
    // `accounts` is filtered by accountTag; a token that can read the
    // account gets the node back with EMPTY GROUPS inside it. Nothing coming
    // back at all is an account/token mismatch, not "no visitors yet" -- see
    // worker/analytics.ts for why this deliberately departs from the spec's
    // failure table, which files it under zero data.
    respondWith(() => new Response(JSON.stringify({ data: { viewer: { accounts: [] } } })));

    const response = await handleAnalytics(await authed(), env);

    expect(response.status).toBe(502);
    expect((await errorOf(response)).reason).toBe('upstream-auth');
  });

  it('answers 502 upstream-error when Cloudflare returns some other status', async () => {
    respondWith(() => new Response('gateway', { status: 500 }));

    const response = await handleAnalytics(await authed(), env);
    expect((await errorOf(response)).reason).toBe('upstream-error');
  });

  it('answers 502 upstream-error when the 200 body does not parse', async () => {
    // A maintenance-mode HTML page served with a 200 is the real shape of
    // this: it must not become zeroes.
    respondWith(() => new Response('<html>we are down</html>', { status: 200 }));

    const response = await handleAnalytics(await authed(), env);
    expect((await errorOf(response)).reason).toBe('upstream-error');
  });

  it('answers 502 upstream-error when the body parses but has no accounts array', async () => {
    respondWith(() => new Response(JSON.stringify({ data: { viewer: null } })));

    const response = await handleAnalytics(await authed(), env);
    expect((await errorOf(response)).reason).toBe('upstream-error');
  });

  it('answers 502 unreachable when the fetch rejects', async () => {
    fetchStub.mockRejectedValue(new TypeError('network error'));

    const response = await handleAnalytics(await authed(), env);

    expect(response.status).toBe(502);
    expect((await errorOf(response)).reason).toBe('unreachable');
  });

  it('answers 502 unreachable when the fetch aborts on the timeout', async () => {
    // A hung upstream and a dead one mean the same thing to her -- try again
    // in a minute -- and must not be confused with a token problem.
    fetchStub.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

    const response = await handleAnalytics(await authed(), env);
    expect((await errorOf(response)).reason).toBe('unreachable');
  });
});

// ---------------------------------------------------------------------------
// The cache: this route's only load control.
// ---------------------------------------------------------------------------

describe('the Cache API entry', () => {
  it('makes exactly one upstream call on a miss and none on a hit', async () => {
    await handleAnalytics(await authed(), env);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    const second = await handleAnalytics(await authed(), env);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(200);
    expect(await payloadOf(second)).toEqual(ZERO_DATA_HERE);
  });

  it('keys on a constructed in-zone path, never on the incoming URL', async () => {
    await handleAnalytics(await authed(), env);

    expect(cache.matches).toEqual([DEFAULT_CACHE_KEY_URL]);
    expect(cache.puts.map((put) => put.url)).toEqual([DEFAULT_CACHE_KEY_URL]);
  });

  it('serves two different sessions from the same entry', async () => {
    // If the cookie reached the key, two logins would fragment the cache and
    // a cached body would be keyed to a credential.
    const first = await cookie(TOKEN_SECRET, 3600);
    const second = await cookie(TOKEN_SECRET, 7200);
    expect(second).not.toBe(first);

    await handleAnalytics(await authed('/api/analytics', first), env);
    await handleAnalytics(await authed('/api/analytics', second), env);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(cache.entries.size).toBe(1);
    expect(new Set(cache.matches).size).toBe(1);
  });

  it('ignores every query parameter but `range`, so no caller can multiply the upstream calls', async () => {
    // `range` is the ONE parameter this route reads, and parseRange narrows
    // it to four values. Everything else -- `?days=90` here -- is not read at
    // all and produces the default key, the default upstream call and the
    // default body.
    const first = await handleAnalytics(await authed(), env);
    const second = await handleAnalytics(await authed('/api/analytics?days=90'), env);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(cache.entries.size).toBe(1);
    expect(await second.text()).toBe(await first.text());
  });

  it('stores a copy the edge will actually keep for ten minutes', async () => {
    // Read off the captured `put` argument, because it is unreadable from
    // the returned response, which carries the OPPOSITE value on purpose.
    await handleAnalytics(await authed(), env);

    expect(cache.puts).toHaveLength(1);
    expect(cache.puts[0].cacheControl).toBe('public, max-age=600');
    expect(cache.entries.size).toBe(1);
  });

  it('returns a no-store copy to the browser', async () => {
    // Asserted against handleAnalytics DIRECTLY. withSecurityHeaders sets
    // this header on everything leaving the Worker, so the same assertion
    // through worker.fetch could not fail and would prove nothing.
    const response = await handleAnalytics(await authed(), env);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('still answers when the cache write is refused', async () => {
    vi.stubGlobal('caches', {
      default: {
        match: async () => undefined,
        put: async () => {
          throw new Error('cache unavailable');
        },
      },
    });

    const response = await handleAnalytics(await authed(), env);
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// The range parameter -- the ONE query parameter this route reads.
// ---------------------------------------------------------------------------

// `analyticsRequest(query)` mirrors worker/__tests__/status.test.ts's
// statusRequest(): an authenticated GET whose query string is the thing under
// test. `authed()` already builds one, so this is that helper with the path
// spelled once.
async function analyticsRequest(query: string): Promise<Request> {
  return authed(`/api/analytics${query}`);
}

describe('the range parameter', () => {
  it('serves 7d and 30d from DIFFERENT cache entries', async () => {
    const seven = await handleAnalytics(await analyticsRequest('?range=7d'), env);
    const thirty = await handleAnalytics(await analyticsRequest('?range=30d'), env);
    expect((await payloadOf(seven)).windowDays).toBe(7);
    expect((await payloadOf(thirty)).windowDays).toBe(30);
  });

  it('answers an unrecognised range with the default, not an error', async () => {
    const response = await handleAnalytics(await analyticsRequest('?range=90'), env);
    expect(response.status).toBe(200);
    const body = await payloadOf(response);
    expect(body.range).toBe('30d');
    expect(body.windowDays).toBe(30);
  });

  it('echoes the range it actually served', async () => {
    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=90d'), env));
    expect(body.range).toBe('90d');
  });

  // The stale-body outage, as a red test rather than as ten minutes of
  // "the visitor numbers aren't connected yet" after every deploy.
  it('stores every entry under the current shape version', async () => {
    await handleAnalytics(await analyticsRequest('?range=7d'), env);
    expect(cache.puts.map((entry) => entry.url)).toEqual([
      expect.stringContaining(`/__cache/analytics/${PAYLOAD_SHAPE_VERSION}/7d`),
    ]);
  });

  it('emits a body its own consumer accepts', async () => {
    // The two sides now share one guard, so this is a real end-to-end
    // assertion rather than two hopes pointing at each other.
    const body = await (await handleAnalytics(await analyticsRequest(''), env)).json();
    expect(isAnalyticsPayload(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The trend series and the archive, which come from OUR OWN rows and never
// from Cloudflare -- the thing that collapses the date-dimension branch from
// two implementations to one optional backfill step.
// ---------------------------------------------------------------------------

describe('the trend series on the payload', () => {
  it('draws from the snapshot table, ascending, over the range it was asked for', async () => {
    d1.dailyVisits.set(istDateDaysAgo(todayInKolkata(), 2), { visits: 12, recorded_at: 0 });
    d1.dailyVisits.set(istDateDaysAgo(todayInKolkata(), 1), { visits: 30, recorded_at: 0 });

    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=7d'), env));
    expect(body.series).toEqual([
      { date: istDateDaysAgo(todayInKolkata(), 2), visits: 12, complete: true },
      { date: istDateDaysAgo(todayInKolkata(), 1), visits: 30, complete: true },
    ]);
    expect(body.seriesGrain).toBe('day');
  });

  it('leaves a day older than the range out of the line', async () => {
    d1.dailyVisits.set(istDateDaysAgo(todayInKolkata(), 7), { visits: 99, recorded_at: 0 });
    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=7d'), env));
    expect(body.series).toEqual([]);
  });

  it('says where the line begins, from the earliest row rather than from a constant', async () => {
    d1.dailyVisits.set('2026-01-04', { visits: 1, recorded_at: 0 });
    d1.dailyVisits.set('2026-01-09', { visits: 1, recorded_at: 0 });
    const body = await payloadOf(await handleAnalytics(await authed(), env));
    expect(body.seriesStartsOn).toBe('2026-01-04');
  });

  it('says the archive holds nothing when it holds nothing, rather than a date it invented', async () => {
    const body = await payloadOf(await handleAnalytics(await authed(), env));
    expect(body.seriesStartsOn).toBeNull();
  });

  // The By-year button's whole condition. Offering a fourth button against an
  // empty rollup on day one teaches her the feature is broken.
  it('reports the by-year archive as empty until a month has been rolled', async () => {
    const first = await payloadOf(await handleAnalytics(await authed(), env));
    expect(first.yearAvailable).toBe(false);

    d1.monthlyVisits.set('2026-07', { visits: 40, complete: 1, recorded_at: 0 });
    cache = new FakeCache();
    vi.stubGlobal('caches', { default: cache });
    const second = await payloadOf(await handleAnalytics(await authed(), env));
    expect(second.yearAvailable).toBe(true);
  });

  it('says the chart reaches backwards, because the verification found a date dimension', async () => {
    // Spelled as a literal, not read back off RUM_CAPABILITIES: this is the
    // caption the owner reads, and it must not agree with the code by
    // construction. worker/analytics-schema.ts records `date`; if a re-run of
    // the probe ever answers differently, this is where that surfaces.
    const body = await payloadOf(await handleAnalytics(await authed(), env));
    expect(body.seriesSource).toBe('backfilled');
  });

  it('still answers every other card when the archive reads fail', async () => {
    respondWith(() => graphqlOk({ last28: [{ path: '/', visits: 12 }] }));
    d1.failWith = 'D1 is down';

    const body = await payloadOf(await handleAnalytics(await authed(), env));
    expect(body.visits).toBe(12);
    expect(body.series).toEqual([]);
    expect(body.seriesStartsOn).toBeNull();
    expect(body.yearAvailable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The by-year range, which is served from OUR archive alone. Cloudflare holds
// about six months, so asking it for twelve would return six and label them
// twelve -- and she would read that as the restaurant having halved.
// ---------------------------------------------------------------------------

describe('the year range', () => {
  beforeEach(() => {
    // Pinned. `sinceMonth` is derived from today's own calendar month, so the
    // thirteen-month fixture below is only a boundary case if the month it is
    // a boundary of is a fixed one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T12:00:00Z'));
  });

  it('makes no upstream call at all', async () => {
    await handleAnalytics(await analyticsRequest('?range=year'), env);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('draws from the monthly rollup, in order', async () => {
    // July inserted BEFORE June on purpose: the fake iterates a Map in
    // insertion order, so a dropped `ORDER BY month ASC` comes back the wrong
    // way round rather than accidentally right.
    d1.monthlyVisits.set('2026-07', { visits: 200, complete: 1, recorded_at: 0 });
    d1.monthlyVisits.set('2026-06', { visits: 100, complete: 1, recorded_at: 0 });

    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=year'), env));

    expect(body.visits).toBe(300);
    expect(body.series).toEqual([
      { date: '2026-06', visits: 100, complete: true },
      { date: '2026-07', visits: 200, complete: true },
    ]);
    expect(body.seriesGrain).toBe('month');
    expect(body.seriesStartsOn).toBe('2026-06');
  });

  it('carries the partial-month flag through to the panel', async () => {
    // The first year of this view IS a partial year and cannot be made
    // otherwise. A column drawn short and unmarked reads as a collapse in
    // traffic that did not happen.
    d1.monthlyVisits.set('2026-08', { visits: 40, complete: 0, recorded_at: 0 });

    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=year'), env));
    expect(body.series[0].complete).toBe(false);
  });

  it('leaves the two breakdown cards empty rather than filling them from a different window', async () => {
    // The upstream answer is deliberately NOT empty: if this branch ever
    // reached for a 30-day breakdown to fill a twelve-month heading, these
    // rows are what would show up under it.
    respondWith(() => graphqlOk({ last28: [{ path: '/catering', referer: 'instagram.com', visits: 40 }] }));

    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=year'), env));
    expect(body.byPath).toEqual([]);
    expect(body.byReferer).toEqual([]);
  });

  it('answers 200 even when the rollup is completely empty', async () => {
    // The state this ships in. The archive accumulates from the day it was
    // switched on and cannot recover the past. Empty is not an error.
    const response = await handleAnalytics(await analyticsRequest('?range=year'), env);
    expect(response.status).toBe(200);
    expect((await payloadOf(response)).series).toEqual([]);
  });

  it('says the by-year view has nothing behind it until it does', async () => {
    const empty = await payloadOf(await handleAnalytics(await analyticsRequest('?range=year'), env));
    expect(empty.yearAvailable).toBe(false);

    d1.monthlyVisits.set('2026-07', { visits: 1, complete: 1, recorded_at: 0 });
    cache = new FakeCache();
    vi.stubGlobal('caches', { default: cache });
    const filled = await payloadOf(await handleAnalytics(await analyticsRequest('?range=year'), env));
    expect(filled.yearAvailable).toBe(true);
  });

  it('reaches back twelve months and not thirteen', async () => {
    // THE FIXTURE IS THE BOUNDARY ITSELF, and it has to be. The clock is
    // pinned to 2026-08-19, so the twelve months this view may show are
    // 2025-09 through 2026-08 inclusive. An out-of-range fixture parked two
    // months clear of the edge (2025-06, which the first version of this test
    // used) never touches the comparison that decides the answer: an
    // off-by-one that reached back THIRTEEN months and summed 2025-08 into a
    // total labelled 365 days passed it, and did. So the row on each side of
    // the line is here, one month apart, and the visit counts are far enough
    // apart that a total is unambiguous about which one it contains.
    d1.monthlyVisits.set('2025-08', { visits: 999, complete: 1, recorded_at: 0 });
    d1.monthlyVisits.set('2025-09', { visits: 1, complete: 1, recorded_at: 0 });
    d1.monthlyVisits.set('2026-08', { visits: 2, complete: 1, recorded_at: 0 });

    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=year'), env));

    expect(body.series.map((point) => point.date)).toEqual(['2025-09', '2026-08']);
    // The headline sums exactly what the chart draws. A thirteenth bucket
    // over-counts Card A under a twelve-month heading while the taps number
    // beside it still covers twelve, which is the mismatch nobody can see.
    expect(body.visits).toBe(3);
  });

  it('counts the same number of months the label promises, at every month of the year', () => {
    // sinceMonth is calendar arithmetic across a year boundary, and the
    // pinned clock above only ever exercises August. Walked over all twelve
    // starting months here so a December-to-January wrap cannot be wrong for
    // one month a year in a way no other test in this file would reach.
    for (let month = 1; month <= 12; month += 1) {
      const today = `2026-${String(month).padStart(2, '0')}-19`;
      const since = firstMonthOfYearWindow(today);
      const months: string[] = [];
      for (let year = 2024; year <= 2026; year += 1) {
        for (let index = 1; index <= 12; index += 1) {
          months.push(`${String(year)}-${String(index).padStart(2, '0')}`);
        }
      }
      const window = months.filter((entry) => entry >= since && entry <= today.slice(0, 7));
      expect(window).toHaveLength(12);
      expect(window[11]).toBe(today.slice(0, 7));
    }
  });

  it('stores its answer under its own key, so the second reader costs no D1 read', async () => {
    // The year path returns early, so it has its own `cache.put` call site. A
    // branch that returned without storing would re-query D1 on every load
    // and no other assertion in this file would notice.
    await handleAnalytics(await analyticsRequest('?range=year'), env);
    expect(cache.puts.map((entry) => entry.url)).toEqual([
      `${SITE_ORIGIN}/__cache/analytics/${PAYLOAD_SHAPE_VERSION}/year`,
    ]);
    expect(cache.puts[0].cacheControl).toBe('public, max-age=600');
  });
});

// ---------------------------------------------------------------------------
// The campaign card. The wiring, not just the helper -- a correct
// readCampaignRows called over the wrong window still puts a wrong number on
// the screen.
// ---------------------------------------------------------------------------

describe('the campaign card on the payload', () => {
  it('carries the rows for the range it was asked for', async () => {
    d1.campaignArrivals.push({ source: 'instagram', day: todayInKolkata(), created_at: 0 });
    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=7d'), env));
    expect(body.campaigns).toEqual([{ source: 'instagram', label: 'Instagram link', arrivals: 1 }]);
    expect(body.campaignsAreExact).toBe(true);
  });

  it('counts the whole first day of the window, inclusive', async () => {
    // The off-by-one. A 7-day window ending today must include the day seven
    // calendar days ago, not six.
    d1.campaignArrivals.push({ source: 'instagram', day: istDateDaysAgo(todayInKolkata(), 6), created_at: 0 });
    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=7d'), env));
    expect(body.campaigns[0].arrivals).toBe(1);
  });

  it('leaves out an arrival one day older than the window', async () => {
    // The other direction. Both boundaries exist because either one alone
    // stays green under one of the two ways this window can be built wrong.
    d1.campaignArrivals.push({ source: 'instagram', day: istDateDaysAgo(todayInKolkata(), 7), created_at: 0 });
    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=7d'), env));
    expect(body.campaigns).toEqual([]);
  });

  it('still answers every other card when the campaign read fails', async () => {
    respondWith(() => graphqlOk({ last28: [{ path: '/', visits: 12 }] }));
    d1.failWith = 'D1 is down';

    const body = await payloadOf(await handleAnalytics(await authed(), env));
    expect(body.visits).toBe(12);
    expect(body.campaigns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The numbers themselves.
// ---------------------------------------------------------------------------

describe('the shaped payload', () => {
  it('totals, ranks and buckets the default 30-day window', async () => {
    respondWith(() =>
      graphqlOk({
        last28: [
          { path: '/', referer: '', visits: 100 },
          { path: '/catering', referer: 'www.instagram.com', visits: 40 },
          { path: '/catering', referer: 'www.google.com', visits: 10 },
          { path: '/cheeseboards', referer: 't.co', visits: 7 },
        ],
        thisWeek: [{ path: '/', visits: 30 }],
        priorWeek: [{ path: '/', visits: 24 }],
      }),
    );

    const payload = await payloadOf(await handleAnalytics(await authed(), env));

    expect(payload.windowDays).toBe(30);
    expect(payload.visits).toBe(157);
    expect(payload.visitsAreEstimate).toBe(true);
    expect(payload.byPath).toEqual([
      { path: '/', visits: 100 },
      { path: '/catering', visits: 50 },
      { path: '/cheeseboards', visits: 7 },
    ]);
    expect(payload.thisWeekVisits).toBe(30);
    expect(payload.priorWeekVisits).toBe(24);
    expect(payload.byReferer).toEqual([
      { kind: 'direct', label: 'Typed it in or used a bookmark', host: null, visits: 100 },
      { kind: 'instagram', label: 'Instagram', host: null, visits: 40 },
      { kind: 'google', label: 'Google', host: null, visits: 10 },
      { kind: 'other', label: 'Other links', host: 't.co', visits: 7 },
    ]);
  });

  it('fills the busiest-times grid from the hourly node, not from the ranked list', async () => {
    // The wiring, which the pure hourCells tests below cannot see: reading
    // `account.last28` here instead of `account.hourly` would still produce a
    // plausible-looking grid, from rows that carry no timestamp at all.
    respondWith(() =>
      graphqlOk({
        last28: [{ path: '/', referer: '', visits: 900 }],
        hourly: [{ at: '2026-08-21T12:00:00Z', visits: 4 }],
      }),
    );

    const payload = await payloadOf(await handleAnalytics(await authed(), env));
    expect(payload.hourly).toEqual([{ day: 5, hour: 17, visits: 4 }]);
  });

  it('asks Cloudflare for the hourly node exactly as the verification recorded it', async () => {
    // The document is one aliased node per card. A missing or misspelled field
    // is not a missing card here -- it is a rejected document and every card
    // at once, which is why this is pinned rather than sampled.
    //
    // THE WHOLE NODE, not a substring of it. A bare toContain('datetimeHour')
    // stood here and could not fail: `orderBy: [datetimeHour_ASC]` on the line
    // above supplied that substring, so misspelling the DIMENSION to
    // datetimeFifteenMinutes left this file green while the real API returned
    // rows with no datetimeHour key at all, hourCells skipped every one of
    // them, and the busiest-times card drew 168 blank cells reading as "nobody
    // ever came". Two more mutations were green under it: the limit and
    // ordering could be swapped for `limit: 10` / `sum_visits_DESC`, and the
    // window could be moved from $sinceWindow to $sinceThisWeek so the card
    // silently answered from 7 days on every range including 90d.
    //
    // Whitespace-normalised so that reindenting the document is not a failure,
    // and every token that changes the ANSWER is inside the compared string.
    await handleAnalytics(await authed(), env);
    const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    const { query } = JSON.parse(init.body as string) as { query: string };
    const flattened = query.replace(/\s+/g, ' ');

    expect(flattened).toContain(
      'hourly: rumPageloadEventsAdaptiveGroups( ' +
        'filter: { siteTag: $siteTag, datetime_geq: $sinceWindow, datetime_lt: $until } ' +
        'limit: 1000 ' +
        'orderBy: [sum_visits_DESC] ' +
        ') { sum { visits } dimensions { datetimeHour requestPath } }',
    );
    expect(RUM_CAPABILITIES.hourDimension).toBe('datetimeHour');
  });

  it('orders the hourly node by size, because ordering by time truncates the wrong end', async () => {
    // Named separately from the block assertion above so that the ONE token
    // this decision turns on says why it is what it is when it reddens.
    //
    // The node groups by (datetimeHour x requestPath), so its group count is
    // 24 x days x paths and passes `limit: 1000` inside the 30d range. Ordered
    // by datetimeHour_ASC the 1000 kept are the OLDEST, so the 90d grid answers
    // "when were we busiest three months ago" under a ninety-day heading and
    // gets worse the longer the range she picks. Ordered by size, the rows lost
    // are the quietest cells instead -- the busy ones, which are the entire
    // answer, survive at every range.
    await handleAnalytics(await authed(), env);
    const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    const { query } = JSON.parse(init.body as string) as { query: string };
    expect(query).not.toContain('datetimeHour_ASC');
  });

  it('normalises a path so one page is one row', async () => {
    respondWith(() =>
      graphqlOk({
        last28: [
          { path: '/catering', visits: 3 },
          { path: '/catering/', visits: 4 },
          { path: '/catering?utm_source=ig', visits: 5 },
        ],
      }),
    );

    const payload = await payloadOf(await handleAnalytics(await authed(), env));
    expect(payload.byPath).toEqual([{ path: '/catering', visits: 12 }]);
  });

  it('ranks at most ten pages', async () => {
    respondWith(() =>
      graphqlOk({
        last28: Array.from({ length: 14 }, (_, i) => ({ path: `/p${i}`, visits: 100 - i })),
      }),
    );

    const payload = await payloadOf(await handleAnalytics(await authed(), env));
    expect(payload.byPath).toHaveLength(10);
    expect(payload.byPath[0]).toEqual({ path: '/p0', visits: 100 });
    // The total is over EVERY row, not only the ten shown.
    expect(payload.visits).toBe(Array.from({ length: 14 }, (_, i) => 100 - i).reduce((a, b) => a + b));
  });

  it('shows at most five other hosts, largest first', async () => {
    respondWith(() =>
      graphqlOk({
        last28: Array.from({ length: 8 }, (_, i) => ({ referer: `ref${i}.example`, visits: 100 - i })),
      }),
    );

    const payload = await payloadOf(await handleAnalytics(await authed(), env));
    expect(payload.byReferer).toHaveLength(5);
    expect(payload.byReferer.map((bucket) => bucket.host)).toEqual([
      'ref0.example',
      'ref1.example',
      'ref2.example',
      'ref3.example',
      'ref4.example',
    ]);
  });

  it('omits a bucket nobody arrived through rather than showing it as zero', async () => {
    respondWith(() => graphqlOk({ last28: [{ referer: 'instagram.com', visits: 5 }] }));

    const payload = await payloadOf(await handleAnalytics(await authed(), env));
    expect(payload.byReferer).toEqual([
      { kind: 'instagram', label: 'Instagram', host: null, visits: 5 },
    ]);
  });

  it('treats a row with a missing or non-numeric visits count as zero rather than NaN', async () => {
    respondWith(
      () =>
        new Response(
          JSON.stringify({
            data: {
              viewer: {
                accounts: [
                  {
                    last28: [
                      { sum: { visits: 'lots' }, dimensions: { requestPath: '/', refererHost: '' } },
                      { dimensions: { requestPath: '/catering', refererHost: '' } },
                      { sum: { visits: 4 }, dimensions: { requestPath: '/', refererHost: '' } },
                    ],
                    thisWeek: [],
                    priorWeek: [],
                  },
                ],
              },
            },
          }),
        ),
    );

    const payload = await payloadOf(await handleAnalytics(await authed(), env));
    expect(payload.visits).toBe(4);
    expect(payload.byPath).toEqual([
      { path: '/', visits: 4 },
      { path: '/catering', visits: 0 },
    ]);
  });
});

describe('excluding her own editing sessions', () => {
  it('keeps every /edit path out of all five numbers', async () => {
    // The beacon is on index.html and the SPA rewrite serves index.html for
    // /edit and every /edit/manage/* route, so her own sessions are tracked
    // pageloads. Without this, Card B would very likely rank
    // /edit/manage/menu first at launch and Card A's denominator would be
    // inflated by the one person the screen exists for.
    respondWith(() =>
      graphqlOk({
        last28: [
          { path: '/', referer: '', visits: 10 },
          { path: '/edit', referer: 'admin.example', visits: 500 },
          { path: '/edit/manage/menu', referer: 'admin.example', visits: 500 },
          { path: '/edit/manage/numbers?tab=1', referer: 'instagram.com', visits: 500 },
        ],
        thisWeek: [
          { path: '/', visits: 3 },
          { path: '/edit/manage/menu', visits: 90 },
        ],
        priorWeek: [
          { path: '/', visits: 2 },
          { path: '/edit', visits: 80 },
        ],
      }),
    );

    const payload = await payloadOf(await handleAnalytics(await authed(), env));

    expect(payload.visits).toBe(10);
    expect(payload.byPath).toEqual([{ path: '/', visits: 10 }]);
    expect(payload.thisWeekVisits).toBe(3);
    expect(payload.priorWeekVisits).toBe(2);
    // And out of Card C too -- the exclusion is about the pageload, not
    // about the ranked list.
    expect(payload.byReferer).toEqual([
      { kind: 'direct', label: 'Typed it in or used a bookmark', host: null, visits: 10 },
    ]);
  });

  it('does not erase a public page whose slug merely starts with those letters', async () => {
    respondWith(() => graphqlOk({ last28: [{ path: '/editorial', visits: 6 }] }));

    const payload = await payloadOf(await handleAnalytics(await authed(), env));
    expect(payload.byPath).toEqual([{ path: '/editorial', visits: 6 }]);
  });
});

describe('the previous window', () => {
  it('is the same length, ending where this one begins', async () => {
    respondWith(() =>
      graphqlOk({
        last28: [{ path: '/', visits: 70 }],
        previousWindow: [{ path: '/', visits: 35 }],
      }),
    );

    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=7d'), env));
    expect(body.visits).toBe(70);
    expect(body.visitsPrevious).toBe(35);
  });

  // The test above hands the fixture its own `previousWindow` array, so it
  // cannot see what FILTER actually asked Cloudflare for it -- the fake fetch
  // returns whatever this file gives it, whatever the query's filter clause
  // says. Wiring `datetime_geq` to $sinceWindow instead of $sincePrevious
  // would silently ask Cloudflare for the CURRENT window twice, and nothing
  // above would notice. This is the query-string pin the hourly node's own
  // test above uses for the identical reason.
  it('asks Cloudflare for the window immediately before this one, not this one twice', async () => {
    await handleAnalytics(await authed(), env);
    const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    const { query } = JSON.parse(init.body as string) as { query: string };
    const flattened = query.replace(/\s+/g, ' ');

    expect(flattened).toContain(
      'previousWindow: rumPageloadEventsAdaptiveGroups( ' +
        'filter: { siteTag: $siteTag, datetime_geq: $sincePrevious, datetime_lt: $sinceWindow } ' +
        'limit: 1000 ' +
        'orderBy: [sum_visits_DESC] ' +
        ') { sum { visits } dimensions { requestPath } }',
    );
  });

  it('counts the previous window of taps too, and does not double-count today', async () => {
    // The fixture uses DIFFERENT daily counts per window -- 1 a day for the
    // recent seven, 2 a day for the seven before -- so that "the same window
    // twice" and "the window before" produce different numbers. A uniform
    // fixture would make both mutations below green for the wrong reason.
    const today = todayInKolkata();
    const fourteenDays = recentIstDates(today, 14);
    const counts: Record<string, number> = {};
    fourteenDays.slice(0, 7).forEach((date) => {
      counts[date] = 1;
    });
    fourteenDays.slice(7).forEach((date) => {
      counts[date] = 2;
    });
    await kv.put('wa:counts', JSON.stringify(counts));

    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=7d'), env));
    expect(body.bookingTaps.total).toBe(7);
    expect(body.tapsPrevious).toBe(14);
  });

  it('moves with the range, unlike Card D which is a fixed seven days', async () => {
    // thisWeekVisits/priorWeekVisits is Card D's fixed seven-day comparison.
    // Reusing it here would leave visitsPrevious frozen at the same number
    // for every range, which would only ever be caught by asking at a range
    // other than 7d.
    respondWith(() =>
      graphqlOk({
        last28: [{ path: '/', visits: 100 }],
        previousWindow: [{ path: '/', visits: 40 }],
        thisWeek: [{ path: '/', visits: 9 }],
        priorWeek: [{ path: '/', visits: 6 }],
      }),
    );

    const body = await payloadOf(await handleAnalytics(await analyticsRequest('?range=30d'), env));
    expect(body.visitsPrevious).toBe(40);
    expect(body.visitsPrevious).not.toBe(body.priorWeekVisits);
  });
});

describe('the Reserve a Table tap total', () => {
  beforeEach(() => {
    // Fixed so "the last 30 IST dates, ending yesterday" is a set this test
    // can name rather than one it has to recompute.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'));
  });

  it('sums only the last 30 IST dates, ending yesterday', async () => {
    await kv.put(
      'wa:counts',
      JSON.stringify({
        '2026-08-04': 7, // today -- outside the window, which ends yesterday
        '2026-08-03': 5, // yesterday -- the newest date counted
        '2026-07-05': 3, // the 30th day back -- the oldest date counted
        '2026-07-04': 99, // one day too old
        '2026-01-01': 1000, // ancient; wa:counts has no expiry
      }),
    );

    const payload = await payloadOf(await handleAnalytics(await authed(), env));

    // 5 + 3. The two boundary dates are the whole point: 2026-07-05 is the
    // same day `sinceWindow` opens the visits window on, so the tap numerator
    // and the visit denominator cover the same 30 days.
    expect(payload.bookingTaps).toEqual({ total: 8, days: 30, lowerBound: true });
  });

  it('reads the counter without writing to it', async () => {
    // A KV WRITE here would come straight out of the 1,000/day budget that
    // keeps login rate limiting alive. Reads are free.
    await handleAnalytics(await authed(), env);
    expect(kv.puts).toEqual([]);
  });

  it('still answers the visits cards when the KV read fails', async () => {
    const brokenKv = {
      get: async () => {
        throw new Error('KV unavailable');
      },
      put: async () => undefined,
      delete: async () => undefined,
    };
    respondWith(() => graphqlOk({ last28: [{ path: '/', visits: 12 }] }));

    const payload = await payloadOf(
      await handleAnalytics(await authed(), buildEnv({ KV: brokenKv as unknown as KVNamespace })),
    );

    expect(payload.visits).toBe(12);
    expect(payload.bookingTaps.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The pure helpers, table-tested. Each one carries a judgement a human would
// argue with, which is exactly why it is a function and not an inline branch.
// ---------------------------------------------------------------------------

describe('hourCells', () => {
  function row(datetimeHour: string, visits: number, requestPath = '/') {
    return { sum: { visits }, dimensions: { datetimeHour, requestPath } };
  }

  it('buckets a UTC hour into the IST day and hour it actually was', () => {
    // 19:00 UTC Friday is 00:30 IST Saturday, so the half-hour offset moves
    // BOTH the day and the hour. This is the case a naive +5 gets wrong and
    // nothing on screen would explain.
    expect(hourCells([row('2026-08-21T19:00:00Z', 5)])).toEqual([{ day: 6, hour: 0, visits: 5 }]);
  });

  it('shifts by the full five and a half hours, not by five', () => {
    // THE ROW ABOVE CANNOT SEE THIS, and that is worth stating rather than
    // assuming. `datetimeHour` is truncated to the hour, so its minutes are
    // always :00 -- and adding 5:00 to an :00 timestamp lands in the SAME
    // hour bucket as adding 5:30, every single time. The half-hour is
    // unobservable on the input this dataset actually sends, which means a
    // fixture built from that input cannot pin the constant.
    //
    // This one can: at :45, five hours lands on Friday 23:00 IST and five and
    // a half lands on Saturday 00:00, so the offset moves the day. The input
    // is deliberately finer than `datetimeHour` because the introspected
    // dimension list beside it (worker/analytics-schema.ts) also carries
    // datetimeFifteenMinutes and datetimeFiveMinutes -- the day a later
    // reader groups by one of those, this is what stops the grid quietly
    // sliding an hour backwards.
    expect(hourCells([row('2026-08-21T18:45:00Z', 5)])).toEqual([{ day: 6, hour: 0, visits: 5 }]);
  });

  it('adds rows that land in the same cell', () => {
    expect(hourCells([row('2026-08-21T12:00:00Z', 2), row('2026-08-21T12:00:00Z', 3)])).toEqual([
      { day: 5, hour: 17, visits: 5 },
    ]);
  });

  it('leaves out her own editing visits', () => {
    expect(hourCells([row('2026-08-21T12:00:00Z', 9, '/edit/manage/menu')])).toEqual([]);
  });

  it('ignores a row whose timestamp is unparseable rather than charting it at zero', () => {
    expect(hourCells([row('not-a-time', 9)])).toEqual([]);
  });

  it('comes back ordered by day then hour', () => {
    const cells = hourCells([row('2026-08-22T12:00:00Z', 1), row('2026-08-21T06:00:00Z', 1)]);
    expect(cells.map((cell) => `${String(cell.day)}:${String(cell.hour)}`)).toEqual(['5:11', '6:17']);
  });

  it('gives the same answer whatever timezone the process is in', () => {
    // The mutation this row exists for -- getDay()/getHours() in place of the
    // UTC pair -- passes on a machine running in UTC and fails east of
    // Greenwich. Asserting the PROPERTY rather than one machine's answer is
    // what makes it fail everywhere.
    const original = process.env.TZ;
    const answers = new Set<string>();
    try {
      for (const zone of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Kiritimati']) {
        process.env.TZ = zone;
        answers.add(JSON.stringify(hourCells([row('2026-08-21T19:00:00Z', 5)])));
      }
    } finally {
      process.env.TZ = original;
    }
    expect([...answers]).toEqual([JSON.stringify([{ day: 6, hour: 0, visits: 5 }])]);
  });
});

describe('bucketReferer', () => {
  // Every accepted, deliberate mis-bucket the spec records, so they stay
  // decisions rather than becoming surprises.
  const CASES: [string, string, string | null][] = [
    ['', 'direct', null],
    ['   ', 'direct', null],
    [SITE_HOST, 'direct', null],
    [`www.${SITE_HOST}`, 'direct', null],
    ['instagram.com', 'instagram', null],
    ['www.instagram.com', 'instagram', null],
    ['l.instagram.com', 'instagram', null],
    ['google.com', 'google', null],
    ['www.google.co.in', 'google', null],
    ['com.google.android.gm', 'google', null],
    ['t.co', 'other', 't.co'],
    ['blog.example.com', 'other', 'blog.example.com'],
    // The `l.` strip has to be pinned on a host the label match does NOT
    // already rescue. `l.instagram.com` above buckets as Instagram either
    // way -- `instagram` is still a label with the prefix left on -- so it
    // proves nothing about the strip. This one does: with the strip gone,
    // the same link shim shows up as two different "Other links" rows.
    ['l.somesite.example', 'other', 'somesite.example'],
    ['somesite.example', 'other', 'somesite.example'],
    ['INSTAGRAM.COM', 'instagram', null],
  ];

  for (const [host, kind, bucketHost] of CASES) {
    it(`buckets ${JSON.stringify(host)} as ${kind}`, () => {
      expect(bucketReferer(host, SITE_HOST)).toEqual({ kind, host: bucketHost });
    });
  }

  it('reads the site’s own host from the request, so a preview deploy self-refers correctly', () => {
    expect(bucketReferer('preview.example.pages.dev', 'preview.example.pages.dev').kind).toBe('direct');
    expect(bucketReferer('preview.example.pages.dev', SITE_HOST).kind).toBe('other');
  });

  it('does not merge two genuinely different subdomains', () => {
    expect(bucketReferer('blog.example.com', SITE_HOST).host).toBe('blog.example.com');
    expect(bucketReferer('shop.example.com', SITE_HOST).host).toBe('shop.example.com');
  });
});

describe('normalizePath', () => {
  const CASES: [string, string][] = [
    ['/', '/'],
    ['/catering', '/catering'],
    ['/catering/', '/catering'],
    ['/catering//', '/catering'],
    ['/catering?utm_source=ig', '/catering'],
    ['/catering/?a=b', '/catering'],
    ['/catering#top', '/catering'],
    ['', ''],
    ['not-a-path', 'not-a-path'],
  ];

  for (const [raw, expected] of CASES) {
    it(`normalises ${JSON.stringify(raw)} to ${JSON.stringify(expected)}`, () => {
      expect(normalizePath(raw)).toBe(expected);
    });
  }
});

describe('isExcludedPath', () => {
  const EXCLUDED = ['/edit', '/edit/', '/edit/manage', '/edit/manage/numbers'];
  const KEPT = ['/', '/editorial', '/edits', '/catering', '/blogs'];

  for (const path of EXCLUDED) {
    it(`excludes ${path}`, () => expect(isExcludedPath(path)).toBe(true));
  }
  for (const path of KEPT) {
    it(`keeps ${path}`, () => expect(isExcludedPath(path)).toBe(false));
  }
});

describe('recentIstDates', () => {
  it('returns the days before today, newest first, and never today itself', () => {
    expect(recentIstDates('2026-08-04', 3)).toEqual(['2026-08-03', '2026-08-02', '2026-08-01']);
  });

  it('crosses a month boundary', () => {
    expect(recentIstDates('2026-03-02', 3)).toEqual(['2026-03-01', '2026-02-28', '2026-02-27']);
  });

  it('returns nothing for a date it cannot read, rather than inventing one', () => {
    expect(recentIstDates('not-a-date', 5)).toEqual([]);
    expect(recentIstDates('', 5)).toEqual([]);
  });
});

describe('istDateDaysAgo', () => {
  it.each([
    ['2026-08-18', 0, '2026-08-18'],
    ['2026-08-18', 6, '2026-08-12'],
    ['2026-08-18', 29, '2026-07-20'],
    ['2026-03-01', 1, '2026-02-28'],
    ['2026-01-01', 1, '2025-12-31'],
  ])('%s minus %i days is %s', (today, days, expected) => {
    expect(istDateDaysAgo(today as string, days as number)).toBe(expected);
  });

  it('hands back a date it cannot read rather than inventing one', () => {
    expect(istDateDaysAgo('not-a-date', 5)).toBe('not-a-date');
  });

  // THE TABLE ABOVE CANNOT SEE THE DEFECT THIS FUNCTION IS BUILT AGAINST, and
  // that is worth stating rather than assuming. Rebuilding the base as
  // `new Date(y, m - 1, d)` -- a LOCAL-time parse -- gives the identical
  // answer everywhere from UTC westward, so every row above stays green on a
  // machine in New York and reddens only on one east of Greenwich. This case
  // makes the property itself the assertion: the same date, from every
  // offset, including the two that straddle the boundary.
  it('gives the same answer whatever timezone the process is in', () => {
    const original = process.env.TZ;
    const answers = new Set<string>();
    try {
      for (const zone of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Kiritimati']) {
        process.env.TZ = zone;
        answers.add(istDateDaysAgo('2026-08-18', 6));
      }
    } finally {
      process.env.TZ = original;
    }
    expect([...answers]).toEqual(['2026-08-12']);
  });
});

describe('sumWaCounts', () => {
  it('adds only the dates it was asked for', () => {
    expect(sumWaCounts({ a: 1, b: 2, c: 4 }, ['a', 'c'])).toBe(5);
  });

  it('treats a missing date as zero, not NaN', () => {
    expect(sumWaCounts({ a: 1 }, ['a', 'missing'])).toBe(1);
  });
});

describe('ZERO_DATA_PAYLOAD', () => {
  // The launch state and a shared fixture, so it has to be exactly what an
  // empty-but-valid response produces -- which the zero-data case above
  // asserts by comparing the two.
  it('is every count at zero, every list empty, and still says the tap number is a lower bound', () => {
    expect(ZERO_DATA_PAYLOAD).toEqual({
      windowDays: 30,
      visits: 0,
      visitsAreEstimate: true,
      byPath: [],
      byReferer: [],
      thisWeekVisits: 0,
      priorWeekVisits: 0,
      bookingTaps: { total: 0, days: 30, lowerBound: true },
      range: '30d',
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
    });
  });
});

// ---------------------------------------------------------------------------
// Router wiring. Everything above calls `handleAnalytics` directly, which
// proves nothing about the path actually being reachable -- delete the route
// block from `route()` and every case above still passes while the dashboard
// gets a 404.
// ---------------------------------------------------------------------------

describe('the route, reached through the router', () => {
  function routerEnv(): Env {
    return {
      ...buildEnv(),
      GITHUB_OWNER: 'tarann26',
      GITHUB_REPO: 'vb',
      GITHUB_BRANCH: 'main',
      GITHUB_TOKEN: 'analytics-test-github-token-not-real',
    };
  }

  it('is routed, and answers 401 rather than 404 without a session', async () => {
    const response = await worker.fetch(new Request(`${SITE_ORIGIN}/api/analytics`), routerEnv());
    expect(response.status).toBe(401);
  });

  it('answers with the shaped body for a real session', async () => {
    respondWith(() => graphqlOk({ last28: [{ path: '/', visits: 9 }] }));

    const response = await worker.fetch(await authed(), routerEnv());

    expect(response.status).toBe(200);
    expect((await payloadOf(response)).visits).toBe(9);
  });

  it('slides the idle window, the way GET /api/content does', async () => {
    // Reading Numbers IS her using the tool. A route that authenticates but
    // does not slide would log her out mid-read of the one screen she only
    // ever reads.
    const response = await worker.fetch(await authed(), routerEnv());
    expect(response.headers.get('Set-Cookie')).toContain('vb_session=');
  });

  it('is not reachable by POST', async () => {
    const response = await worker.fetch(
      new Request(`${SITE_ORIGIN}/api/analytics`, {
        method: 'POST',
        headers: { Cookie: await cookie(), Origin: SITE_ORIGIN },
        body: '{}',
      }),
      routerEnv(),
    );
    expect(response.status).toBe(404);
  });

  it('costs no KV write, so it cannot eat the budget that keeps login limited', async () => {
    await worker.fetch(await authed(), routerEnv());
    await worker.fetch(await authed(), routerEnv());
    expect(kv.puts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The GraphQL request this route actually sends.
// ---------------------------------------------------------------------------

describe('the upstream request', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'));
  });

  it('posts one document to Cloudflare with the account, the site tag and four windows', async () => {
    await handleAnalytics(await authed(), env);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    );
    expect(init.signal).toBeDefined();

    const body = JSON.parse(init.body as string) as {
      query: string;
      variables: Record<string, string>;
    };
    // ONE round trip for all five cards, not six.
    expect(body.query).toContain('last28:');
    expect(body.query).toContain('previousWindow:');
    expect(body.query).toContain('thisWeek:');
    expect(body.query).toContain('priorWeek:');
    expect(body.variables).toEqual({
      accountTag: 'analytics-test-account-id',
      siteTag: 'analytics-test-site-tag',
      // Every window ends at the start of TODAY, so no partial day is ever
      // compared against a whole one.
      until: '2026-08-04T00:00:00.000Z',
      sinceWindow: '2026-07-05T00:00:00.000Z',
      sinceThisWeek: '2026-07-28T00:00:00.000Z',
      sincePriorWeek: '2026-07-21T00:00:00.000Z',
      // The window immediately BEFORE sinceWindow, same length: the default
      // 30-day range's window opens 2026-07-05, so the previous window opens
      // 30 days before that.
      sincePrevious: '2026-06-05T00:00:00.000Z',
    });
  });

  it('opens the visits window at the range it was asked for, not at a fixed 28 days', async () => {
    // The variable is named `sinceWindow` rather than `since28` precisely
    // because it is no longer 28 days and no longer one length.
    await handleAnalytics(await authed('/api/analytics?range=7d'), env);
    const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    const { variables } = JSON.parse(init.body as string) as { variables: Record<string, string> };
    expect(variables.sinceWindow).toBe('2026-07-28T00:00:00.000Z');
  });
});
