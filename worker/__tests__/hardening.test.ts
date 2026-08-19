import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeGitHubStub } from './githubStub';
import worker, {
  AUTHENTICATED_PATHS,
  AUTHENTICATED_UNLIMITED,
  CACHEABLE_PATHS,
  RATE_POLICIES,
  WA_DAILY_CAP,
  type Env,
} from '../index';
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
    CF_WEB_ANALYTICS_SITE_TAG: '29e1ba52fba74885a5fc44875a48a078',
    // Phase 2. Unused by any test in this file -- required only for `env`
    // to satisfy `Env`.
    DB: {} as unknown as D1Database,
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
  //
  // The `fetch` stub is load-bearing, and this file has no other: this is the
  // only case here that authenticates successfully against a route which reads
  // through to GitHub, and without a stub it issued a LIVE request to
  // api.github.com on every run. It passed anyway -- `handleGetContent` catches
  // the failed read and answers 502, and `Cache-Control` is set by the router
  // either way -- so the only symptom was that this one case took a real
  // internet round trip, and timed out at Vitest's 5000ms default whenever that
  // round trip was slow. That intermittent failure ran inside `npm run
  // test:deploy` and failed two Cloudflare Pages builds. Stubbed so the read
  // succeeds, and the status pinned below so it stays that way.
  it('still marks the content route no-store now that the header is set centrally', async () => {
    vi.stubGlobal(
      'fetch',
      makeGitHubStub({
        contents: { 'src/content/site.json': { content: '{}', sha: 'site-sha-hardening' } },
      }).fetch,
    );
    try {
      const response = await worker.fetch(
        new Request(`${SITE_ORIGIN}/api/content?path=src/content/site.json`, {
          headers: { Cookie: await cookie() },
        }),
        env,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The one exemption to the blanket no-store, pinned in BOTH directions:
  // the public read path is cacheable, and nothing else became cacheable
  // with it.
  //
  // Asserts the exact value published.ts's own `body()` sends, not merely
  // "anything other than no-store" -- `not.toBe('no-store')` would also
  // pass for a MISSING header, which proves nothing about what this route
  // actually returns. `env.DB` here is the placeholder `{}` every other
  // test in this file uses, so `store.version()` throws and this exercises
  // the SNAPSHOT branch of handlePublished, not the d1 one -- which is why
  // there is no ETag to assert here: `body()` only sets one when it is
  // handed a sha, and the snapshot branch calls it with `null` (see
  // published.ts's own `body()`). The d1-branch ETag, a real sha256 of
  // seeded content, is pinned instead in published.test.ts, which already
  // sets up a FakeD1 to reach that branch.
  it('leaves the public read path cacheable and everything else no-store', async () => {
    const cacheable = await worker.fetch(new Request(`${SITE_ORIGIN}/api/published?path=awards.json`), env);
    expect(cacheable.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(cacheable.headers.get('ETag')).toBeNull();
    expect(cacheable.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect([...CACHEABLE_PATHS]).toEqual(['/api/published']);
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

  // The case above cannot tell an authenticated route left unlimited ON
  // PURPOSE from one whose author never thought about it -- both are simply
  // absent from RATE_POLICIES, and it would go on passing while a new
  // authenticated route quietly shipped with no limiter and no decision
  // behind it. AUTHENTICATED_UNLIMITED is the second, named set that closes
  // that: an authenticated route now has to appear in one list or the other,
  // and a future limiter has to EDIT a list rather than slip past one.
  //
  // Disjoint, because a route cannot be both limited and deliberately
  // unlimited. A subset of AUTHENTICATED_PATHS, because "deliberately
  // unlimited" is a statement about authenticated routes -- listing an
  // unauthenticated path here would be claiming a decision that does not
  // apply.
  it('names the authenticated read-only routes that are deliberately unlimited', () => {
    expect([...AUTHENTICATED_UNLIMITED].sort()).toEqual(['/api/analytics', '/api/build-status']);

    for (const path of AUTHENTICATED_UNLIMITED) {
      expect(Object.keys(RATE_POLICIES)).not.toContain(path);
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

describe('cross-origin write protection', () => {
  let kv: FakeKV;
  let env: Env;

  beforeEach(() => {
    kv = new FakeKV();
    env = buildEnv(kv);
  });

  const WRITE_ROUTES = ['/api/login', '/api/publish', '/api/undo', '/api/upload'];

  for (const path of WRITE_ROUTES) {
    it(`refuses a POST to ${path} from another origin`, async () => {
      const response = await worker.fetch(
        new Request(`${SITE_ORIGIN}${path}`, {
          method: 'POST',
          headers: { Origin: 'https://evil.example', 'CF-Connecting-IP': '4.4.4.4' },
          body: '{}',
        }),
        env,
      );
      expect(response.status).toBe(403);
      // Refused before anything expensive: no KV write, so a hostile page
      // cannot spend the shared write budget either.
      expect(kv.puts).toEqual([]);
    });

    it(`allows a POST to ${path} carrying the site's own Origin`, async () => {
      const response = await worker.fetch(
        new Request(`${SITE_ORIGIN}${path}`, {
          method: 'POST',
          headers: { Origin: SITE_ORIGIN, 'CF-Connecting-IP': '4.4.4.4' },
          body: '{}',
        }),
        env,
      );
      expect(response.status).not.toBe(403);
    });

    // Absence is not hostile -- see isCrossOriginWrite's comment. A browser
    // always sends Origin on a POST, so nothing that can mount this attack
    // gets through here; betting the owner's ability to log in on every
    // proxy in the world preserving a header is the worse risk.
    it(`allows a POST to ${path} with no Origin header at all`, async () => {
      const response = await worker.fetch(
        new Request(`${SITE_ORIGIN}${path}`, {
          method: 'POST',
          headers: { 'CF-Connecting-IP': '4.4.4.4' },
          body: '{}',
        }),
        env,
      );
      expect(response.status).not.toBe(403);
    });
  }

  // The routes anyone on the internet may POST to with no session at all.
  // They are NOT in WRITE_ROUTES above because the rule is different, not
  // absent: each carries its own stricter Origin check inside its handler and
  // refuses an ABSENT Origin too, where an authenticated route deliberately
  // allows one. WRITE_ROUTES is hand-maintained and this list is its
  // counterpart -- a new public write route added to `route` and to neither
  // list is a route nothing in this file has an opinion about.
  const PUBLIC_WRITE_ROUTES = ['/api/wa', '/api/campaign'];

  for (const path of PUBLIC_WRITE_ROUTES) {
    it(`leaves ${path} on its own stricter origin rule`, async () => {
      const missing = await worker.fetch(
        new Request(`${SITE_ORIGIN}${path}`, { method: 'POST', headers: { 'CF-Connecting-IP': '4.4.4.4' } }),
        env,
      );
      expect(missing.status).toBe(403);

      const good = await worker.fetch(
        new Request(`${SITE_ORIGIN}${path}`, {
          method: 'POST',
          headers: { Origin: SITE_ORIGIN, 'CF-Connecting-IP': '4.4.4.4' },
        }),
        env,
      );
      expect(good.status).toBe(204);
    });
  }
});

describe('body size ceiling on the JSON write routes', () => {
  let kv: FakeKV;
  let env: Env;
  let sessionCookie: string;

  beforeEach(async () => {
    kv = new FakeKV();
    env = buildEnv(kv);
    sessionCookie = await cookie();
  });

  const OVER = String(3 * 1024 * 1024);

  // worker/upload.ts has capped its body since it was written; these two
  // routes call request.json(), which buffers the whole body exactly as
  // formData() does, and had no cap at all. The asymmetry was the finding.
  for (const path of ['/api/publish', '/api/undo']) {
    it(`refuses an oversized body on ${path} before reading it`, async () => {
      const response = await worker.fetch(
        new Request(`${SITE_ORIGIN}${path}`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
            Origin: SITE_ORIGIN,
            'CF-Connecting-IP': '7.7.7.7',
            'Content-Length': OVER,
          },
          body: '{}',
        }),
        env,
      );
      expect(response.status).toBe(413);
    });

    // The half that keeps the cap from being a bug of its own. A limit that
    // rejected ordinary publishes would pass the test above and break the
    // only thing this Worker exists to do.
    //
    // Content-Length is set EXPLICITLY, and that is the whole point of this
    // test rather than an incidental detail. The first version reused
    // authedGarbage(), whose Request carries no Content-Length header at all
    // -- Node populates it at send time, not at construction -- so
    // tooLargeToRead's `header === null` branch returned early and the
    // assertion held for ANY limit. Proven by mutation: setting the cap to
    // one single byte left it green. A cap this cannot distinguish from no
    // cap is not being tested.
    //
    // 200KB is comfortably more than every content JSON file in the
    // repository put together, which is the realistic ceiling for a publish
    // that sends only what changed.
    it(`still accepts a realistic ${path} body of 200KB`, async () => {
      const response = await worker.fetch(
        new Request(`${SITE_ORIGIN}${path}`, {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
            Origin: SITE_ORIGIN,
            'CF-Connecting-IP': '7.7.7.7',
            'Content-Length': String(200 * 1024),
          },
          body: '{}',
        }),
        env,
      );
      expect(response.status).not.toBe(413);
    });

    // Checked AFTER the session check, deliberately: an unauthenticated
    // caller should not learn this route's limits, and 401 is cheaper anyway.
    it(`answers 401 before 413 on ${path} when there is no session`, async () => {
      const response = await worker.fetch(
        new Request(`${SITE_ORIGIN}${path}`, {
          method: 'POST',
          headers: { Origin: SITE_ORIGIN, 'CF-Connecting-IP': '7.7.7.7', 'Content-Length': OVER },
          body: '{}',
        }),
        env,
      );
      expect(response.status).toBe(401);
    });
  }
});
