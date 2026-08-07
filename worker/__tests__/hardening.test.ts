import { describe, it, expect, beforeEach } from 'vitest';
import worker, { AUTHENTICATED_PATHS, RATE_POLICIES, WA_DAILY_CAP, type Env } from '../index';
import { hashPassword, signToken } from '../auth';
import { site } from '../../src/content';

// Security-hardening tests: the response headers this Worker sets on
// everything it returns, and the per-route rate limits on the authenticated
// routes that spend a capped quota.
//
// Kept out of index.test.ts on purpose. Both of these are properties of the
// ROUTER rather than of any one handler -- they are applied in `fetch` and
// `route` precisely so that no individual handler has to remember them -- so
// testing them per handler would be testing the wrong thing, and testing
// them once inside index.test.ts's per-route describes would bury a
// cross-cutting guarantee inside a block about publishing.
//
// Runs under this repo's single jsdom Vitest environment, same as every
// other worker/__tests__ file (see vitest.config.ts's comment) -- fetch,
// Request, Response and URL here come from Node itself, not jsdom.

const SITE_ORIGIN = new URL(site.seo.url).origin;
const TOKEN_SECRET = 'hardening-test-token-secret';
const PASSWORD_HASH = 'hardening-test-only-password-hash-placeholder';

// A hand-built fake, not an import from @cloudflare/workers-types --
// KVNamespace has no runtime shape in this repo's test environment.
// `puts` records every write in order, because these tests care about how
// many KV writes a request made, not only about the value left behind: the
// central claim below ("an unauthenticated request never costs a write") is
// invisible to a test that can only read the final store.
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

// Stands in for a real KV that has hit Free's 1,000-writes/day cap. The
// limiter's own bookkeeping must degrade against this, not take the request
// down with it.
class KvThatRejectsWrites extends FakeKV {
  override async put(): Promise<void> {
    throw new Error('KV temporarily unavailable');
  }
}

function buildEnv(kv: FakeKV): Env {
  return {
    KV: kv as unknown as KVNamespace,
    ADMIN_PASSWORD_HASH: PASSWORD_HASH,
    TOKEN_SECRET,
    GITHUB_OWNER: 'tarann26',
    GITHUB_REPO: 'vb',
    GITHUB_BRANCH: 'main',
    GITHUB_TOKEN: 'hardening-test-github-token-not-real',
    CLOUDFLARE_ACCOUNT_ID: 'hardening-test-account-id',
    CLOUDFLARE_PAGES_PROJECT: 'hardening-test-project',
    CLOUDFLARE_API_TOKEN: 'hardening-test-cf-token-not-real',
  };
}

async function cookie(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return `vb_session=${await signToken(TOKEN_SECRET, PASSWORD_HASH, now, now + 3600)}`;
}

// Deliberately sends a well-formed, AUTHENTICATED request with a body the
// handler will reject as malformed (400). That is what these tests want: the
// limiter must count a request that got past auth, and a 400 gets there
// without needing a GitHub stub, so a rate-limit test never depends on the
// publish machinery it is not testing.
function authedGarbage(path: string, sessionCookie: string, ip = '9.9.9.9'): Request {
  return new Request(`${SITE_ORIGIN}${path}`, {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

describe('security headers on every response', () => {
  let kv: FakeKV;
  let env: Env;

  beforeEach(() => {
    kv = new FakeKV();
    env = buildEnv(kv);
  });

  // Deliberately spans an unauthenticated 200, a 404 and a 401 rather than
  // checking one happy path. These headers are applied in `fetch`, outside
  // the router, precisely so that the paths nobody thinks about -- the 404
  // for an unrouted URL, the 401 for a missing cookie -- carry them too.
  const CASES: { name: string; request: () => Request }[] = [
    { name: 'an unauthenticated 200 (/api/health)', request: () => new Request(`${SITE_ORIGIN}/api/health`) },
    { name: 'a 404 for an unrouted path', request: () => new Request(`${SITE_ORIGIN}/api/nope`) },
    {
      name: 'a 401 for an authenticated route with no cookie',
      request: () => new Request(`${SITE_ORIGIN}/api/publish`, { method: 'POST', body: '{}' }),
    },
  ];

  const EXPECTED: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
  };

  for (const { name, request } of CASES) {
    it(`sets every security header on ${name}`, async () => {
      const response = await worker.fetch(request(), env);
      for (const [header, value] of Object.entries(EXPECTED)) {
        expect(response.headers.get(header), header).toBe(value);
      }
    });
  }

  // The one that catches a regression the header assertions above cannot:
  // withSecurityHeaders rebuilds the Response to attach headers, and a
  // rebuild that drops Set-Cookie would silently break login and every
  // sliding session refresh while leaving all five headers perfectly in
  // place.
  it('does not drop Set-Cookie when it rebuilds the response', async () => {
    const password = 'the real restaurant password';
    const loginEnv = buildEnv(kv);
    loginEnv.ADMIN_PASSWORD_HASH = await hashPassword(password);
    const response = await worker.fetch(
      new Request(`${SITE_ORIGIN}/api/login`, {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.1.1.1' },
        body: JSON.stringify({ password }),
      }),
      loginEnv,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Set-Cookie')).toMatch(/^vb_session=/);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  // no-store is the point of the header, so prove the previously-explicit
  // one on /api/content did not get lost when it moved into the router.
  it('still marks the content route no-store now that the header is set centrally', async () => {
    const response = await worker.fetch(
      new Request(`${SITE_ORIGIN}/api/content?path=src/content/site.json`, {
        headers: { Cookie: await cookie() },
      }),
      env,
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('rate limits on the routes that spend a capped quota', () => {
  let kv: FakeKV;
  let env: Env;
  let sessionCookie: string;

  beforeEach(async () => {
    kv = new FakeKV();
    env = buildEnv(kv);
    sessionCookie = await cookie();
  });

  // Table-driven off RATE_POLICIES itself rather than repeating three
  // near-identical blocks with the numbers copied in. A limit added to that
  // table therefore arrives already tested, and a limit whose `max` is
  // changed cannot pass a test that hardcoded the old number.
  for (const [path, policy] of Object.entries(RATE_POLICIES)) {
    it(`allows ${policy.max} requests to ${path} and refuses the next one`, async () => {
      for (let i = 0; i < policy.max; i += 1) {
        const response = await worker.fetch(authedGarbage(path, sessionCookie), env);
        expect(response.status, `request ${i + 1} of ${policy.max}`).not.toBe(429);
      }
      const refused = await worker.fetch(authedGarbage(path, sessionCookie), env);
      expect(refused.status).toBe(429);
      expect(await refused.json()).toEqual({ message: policy.message });
    });

    it(`limits ${path} per IP, so one caller cannot lock another out`, async () => {
      for (let i = 0; i < policy.max; i += 1) {
        await worker.fetch(authedGarbage(path, sessionCookie, '5.5.5.5'), env);
      }
      expect((await worker.fetch(authedGarbage(path, sessionCookie, '5.5.5.5'), env)).status).toBe(429);
      expect((await worker.fetch(authedGarbage(path, sessionCookie, '6.6.6.6'), env)).status).not.toBe(429);
    });

    // The KV-budget rule the whole design rests on. An unauthenticated
    // caller can hammer these paths, and must get nothing for it in either
    // direction: no KV write (which would let a stranger burn the shared
    // 1,000/day budget and take login's own rate limiting down with it),
    // and no progress toward locking the real owner out of her own site.
    it(`does not let unauthenticated requests to ${path} cost a KV write or lock the owner out`, async () => {
      for (let i = 0; i < policy.max * 2; i += 1) {
        const response = await worker.fetch(
          new Request(`${SITE_ORIGIN}${path}`, {
            method: 'POST',
            headers: { 'CF-Connecting-IP': '9.9.9.9' },
            body: '{}',
          }),
          env,
        );
        expect(response.status).toBe(401);
      }
      expect(kv.puts).toEqual([]);
      // Same IP, now with a real session: still has its full allowance.
      const authed = await worker.fetch(authedGarbage(path, sessionCookie), env);
      expect(authed.status).not.toBe(429);
    });

    it(`keeps ${path} working when KV refuses the limiter's write`, async () => {
      const brokenKv = new KvThatRejectsWrites();
      const response = await worker.fetch(authedGarbage(path, sessionCookie), buildEnv(brokenKv));
      expect(response.status).not.toBe(429);
      expect(response.status).toBeLessThan(500);
    });
  }

  // Pins the DECISION, not the absence. /api/content and /api/build-status
  // are authenticated and read-only, and build-status in particular is
  // polled throughout a publish -- a KV write per poll would be the single
  // largest consumer on this Worker, spent guarding a route whose whole cost
  // is one Cloudflare API read. Excluding them is a judgement about the KV
  // write budget, so changing it should require editing this list and
  // re-doing the arithmetic below, the same way AUTHENTICATED_PATHS makes
  // adding a route a visible decision rather than a silent omission.
  it('limits exactly the authenticated routes that mutate, and no others', () => {
    expect(new Set(Object.keys(RATE_POLICIES))).toEqual(
      new Set(['/api/publish', '/api/undo', '/api/upload']),
    );
    for (const path of Object.keys(RATE_POLICIES)) {
      expect(AUTHENTICATED_PATHS.has(path)).toBe(true);
    }
  });

  // The arithmetic those limits were chosen against, as a test rather than a
  // comment -- because the comment cannot fail. KV Free allows 1,000 writes
  // per day across the WHOLE namespace, and this Worker's other writers have
  // already claimed part of it: the reserve-a-table counter budgets itself
  // two writes per accepted tap up to WA_DAILY_CAP.
  //
  // Raising any `max`, or shortening any window, without checking that total
  // is how a rate limit ends up disabling login's rate limiting.
  it('cannot exhaust the shared KV write budget at its own worst case', () => {
    const SECONDS_PER_DAY = 86_400;
    const KV_FREE_WRITES_PER_DAY = 1_000;
    const WA_WORST_CASE = WA_DAILY_CAP * 2;

    const limiterWorstCase = Object.values(RATE_POLICIES).reduce(
      (total, policy) => total + policy.max * (SECONDS_PER_DAY / policy.windowSeconds),
      0,
    );

    expect(limiterWorstCase + WA_WORST_CASE).toBeLessThan(KV_FREE_WRITES_PER_DAY);
    // And leaves real headroom for login's own counters, not just a margin
    // of one write.
    expect(KV_FREE_WRITES_PER_DAY - (limiterWorstCase + WA_WORST_CASE)).toBeGreaterThanOrEqual(100);
  });

  // Lockout is the cost of every rate limit, and this one is paid by the
  // restaurant owner, not an attacker. `recordHit` re-sets the TTL on each
  // recorded hit, so the window runs from the LAST hit -- the cap is also
  // the wait. Pinning it against the session's own idle timeout keeps that
  // wait to something already explainable ("log back in") rather than a
  // second, longer number nobody documented.
  it('never locks the owner out for longer than a session would idle out anyway', () => {
    for (const policy of Object.values(RATE_POLICIES)) {
      expect(policy.windowSeconds).toBeLessThanOrEqual(6 * 60 * 60);
    }
  });
});
