import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleAnalytics,
  bucketReferer,
  isExcludedPath,
  normalizePath,
  recentIstDates,
  sumWaCounts,
  ZERO_DATA_PAYLOAD,
  type AnalyticsEnv,
  type AnalyticsError,
  type AnalyticsPayload,
} from '../analytics';
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
const CACHE_KEY_URL = `${SITE_ORIGIN}/__cache/analytics/v1`;

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

function rowsToNodes(rows: Row[], withReferer: boolean): unknown[] {
  return rows.map((row) => ({
    sum: { visits: row.visits },
    dimensions: withReferer
      ? { requestPath: row.path ?? '/', refererHost: row.referer ?? '' }
      : { requestPath: row.path ?? '/' },
  }));
}

// A well-formed Cloudflare GraphQL success body.
function graphqlOk(opts: { last28?: Row[]; thisWeek?: Row[]; priorWeek?: Row[] } = {}): Response {
  return new Response(
    JSON.stringify({
      data: {
        viewer: {
          accounts: [
            {
              last28: rowsToNodes(opts.last28 ?? [], true),
              thisWeek: rowsToNodes(opts.thisWeek ?? [], false),
              priorWeek: rowsToNodes(opts.priorWeek ?? [], false),
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

async function payloadOf(response: Response): Promise<AnalyticsPayload> {
  return (await response.json()) as AnalyticsPayload;
}

async function errorOf(response: Response): Promise<AnalyticsError> {
  return (await response.json()) as AnalyticsError;
}

beforeEach(() => {
  kv = new FakeKV();
  cache = new FakeCache();
  env = buildEnv();
  fetchStub = vi.fn(async () => graphqlOk());
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
    expect(await payloadOf(response)).toEqual(ZERO_DATA_PAYLOAD);
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
    expect(await payloadOf(second)).toEqual(ZERO_DATA_PAYLOAD);
  });

  it('keys on a fixed in-zone path, never on the incoming URL', async () => {
    await handleAnalytics(await authed(), env);

    expect(cache.matches).toEqual([CACHE_KEY_URL]);
    expect(cache.puts.map((put) => put.url)).toEqual([CACHE_KEY_URL]);
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

  it('ignores query parameters entirely, so no caller can multiply the upstream calls', async () => {
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
// The numbers themselves.
// ---------------------------------------------------------------------------

describe('the shaped payload', () => {
  it('totals, ranks and buckets the last 28 days', async () => {
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

    expect(payload.windowDays).toBe(28);
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

describe('the Reserve a Table tap total', () => {
  beforeEach(() => {
    // Fixed so "the last 28 IST dates, ending yesterday" is a set this test
    // can name rather than one it has to recompute.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'));
  });

  it('sums only the last 28 IST dates, ending yesterday', async () => {
    await kv.put(
      'wa:counts',
      JSON.stringify({
        '2026-08-04': 7, // today -- outside the window, which ends yesterday
        '2026-08-03': 5, // yesterday -- the newest date counted
        '2026-07-07': 3, // the 28th day back -- the oldest date counted
        '2026-07-06': 99, // one day too old
        '2026-01-01': 1000, // ancient; wa:counts has no expiry
      }),
    );

    const payload = await payloadOf(await handleAnalytics(await authed(), env));

    // 5 + 3. The two boundary dates are the whole point: 2026-07-07 is the
    // same day `since28` opens the visits window on, so the tap numerator
    // and the visit denominator cover the same 28 days.
    expect(payload.bookingTaps).toEqual({ total: 8, days: 28, lowerBound: true });
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
      windowDays: 28,
      visits: 0,
      visitsAreEstimate: true,
      byPath: [],
      byReferer: [],
      thisWeekVisits: 0,
      priorWeekVisits: 0,
      bookingTaps: { total: 0, days: 28, lowerBound: true },
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
      // Phase 2. Unused by any test in this file -- required only for
      // `env` to satisfy `Env`.
      DB: {} as unknown as D1Database,
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

  it('posts one document to Cloudflare with the account, the site tag and three windows', async () => {
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
    // ONE round trip for all four cards, not five.
    expect(body.query).toContain('last28:');
    expect(body.query).toContain('thisWeek:');
    expect(body.query).toContain('priorWeek:');
    expect(body.variables).toEqual({
      accountTag: 'analytics-test-account-id',
      siteTag: 'analytics-test-site-tag',
      // Every window ends at the start of TODAY, so no partial day is ever
      // compared against a whole one.
      until: '2026-08-04T00:00:00.000Z',
      since28: '2026-07-07T00:00:00.000Z',
      sinceThisWeek: '2026-07-28T00:00:00.000Z',
      sincePriorWeek: '2026-07-21T00:00:00.000Z',
    });
  });
});
