import { describe, it, expect, beforeEach } from 'vitest';
import worker, { WA_DAILY_CAP, type Env } from '../index';
import { hashPassword, signToken } from '../auth';
import { todayInKolkata } from '../../src/content/publish';

// Runs under this repo's single jsdom Vitest environment, same as every
// other worker/__tests__ file (see vitest.config.ts's comment) -- fetch,
// Request, Response and URL here come from Node itself, not jsdom.
//
// POST /api/wa is the one route on this Worker anyone on the internet can
// call directly with no session cookie at all -- see worker/index.ts's own
// file comment on that route for the full threat model. Every guard tested
// below (origin, per-IP rate limit, daily cap, auth on the GET side) is
// tested by actually breaking it in worker/index.ts and confirming the
// specific assertion below is what catches it, not just that the test
// happens to pass today.

const SITE_ORIGIN = 'https://viabiancadelhi.com';

// A hand-built fake, not an import from @cloudflare/workers-types --
// KVNamespace has no runtime shape in this repo's test environment (see
// vitest.config.ts's comment), only a type-only ambient declaration.
class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const TOKEN_SECRET = 'count-test-token-secret';
const PASSWORD = 'the real restaurant password';

async function buildEnv(kv = new FakeKV()): Promise<Env> {
  return {
    KV: kv as unknown as KVNamespace,
    ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD),
    TOKEN_SECRET,
    GITHUB_OWNER: 'tarann26',
    GITHUB_REPO: 'vb',
    GITHUB_BRANCH: 'main',
    GITHUB_TOKEN: 'count-test-github-token-not-real',
    CLOUDFLARE_ACCOUNT_ID: 'count-test-account-id',
    CLOUDFLARE_PAGES_PROJECT: 'count-test-project',
    CLOUDFLARE_API_TOKEN: 'count-test-fixture-cf-token-not-real',
    DEPLOY_HOOK_URL: 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/count-test-not-real',
  };
}

function postWa(opts: { origin?: string | null; ip?: string } = {}): Request {
  const headers: Record<string, string> = {};
  const origin = 'origin' in opts ? opts.origin : SITE_ORIGIN;
  if (origin !== null && origin !== undefined) headers['Origin'] = origin;
  headers['CF-Connecting-IP'] = opts.ip ?? '1.2.3.4';
  return new Request('https://viabiancadelhi.com/api/wa', { method: 'POST', headers });
}

async function getWa(cookie?: string): Promise<Request> {
  const headers: Record<string, string> = {};
  if (cookie) headers['Cookie'] = cookie;
  return new Request('https://viabiancadelhi.com/api/wa', { headers });
}

async function sessionCookie(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = await signToken(TOKEN_SECRET, expiresAt);
  return `vb_session=${token}`;
}

describe('POST /api/wa', () => {
  let kv: FakeKV;
  let env: Env;

  beforeEach(async () => {
    kv = new FakeKV();
    env = await buildEnv(kv);
  });

  it('rejects a post from another origin', async () => {
    const response = await worker.fetch(postWa({ origin: 'https://evil.example' }), env);
    expect(response.status).toBe(403);
    // Not just the right status -- the request must never have reached the
    // point of touching KV at all, so it left no trace behind.
    expect(kv.store.size).toBe(0);
  });

  it('rejects a post with no Origin header at all', async () => {
    const response = await worker.fetch(postWa({ origin: null }), env);
    expect(response.status).toBe(403);
    expect(kv.store.size).toBe(0);
  });

  it('accepts a same-origin post and returns 204', async () => {
    const response = await worker.fetch(postWa(), env);
    expect(response.status).toBe(204);
  });

  it('records nothing but the date -- one KV key, whose value has no field but today\'s count', async () => {
    await worker.fetch(postWa(), env);
    // Exactly one KV key touched by a tap -- no per-IP, per-user-agent or
    // per-timestamp key alongside it.
    const keys = Array.from(kv.store.keys()).filter((k) => k !== 'wa:1.2.3.4');
    expect(keys).toEqual(['wa:counts']);
    const stored = JSON.parse(kv.store.get('wa:counts') as string) as Record<string, number>;
    const today = todayInKolkata();
    expect(stored).toEqual({ [today]: 1 });
  });

  it('rate-limits by ip like login does', async () => {
    // Same IP, over and over -- eventually blocked, without ever reaching
    // the login-style "attempts" ceiling this specific route uses.
    let sawLimited = false;
    for (let i = 0; i < 40; i++) {
      const response = await worker.fetch(postWa({ ip: '9.8.7.6' }), env);
      if (response.status === 429) {
        sawLimited = true;
        break;
      }
      expect(response.status).toBe(204);
    }
    expect(sawLimited).toBe(true);

    // A different IP is unaffected -- proves this is a per-IP limit, not a
    // global one that would have also broken every other visitor's ability
    // to reserve a table.
    const otherIp = await worker.fetch(postWa({ ip: '5.5.5.5' }), env);
    expect(otherIp.status).toBe(204);
  });

  it('a rate-limited post does not increment the daily counter', async () => {
    let limitedResponse: Response | undefined;
    for (let i = 0; i < 40; i++) {
      const response = await worker.fetch(postWa({ ip: '9.8.7.6' }), env);
      if (response.status === 429) {
        limitedResponse = response;
        break;
      }
    }
    expect(limitedResponse?.status).toBe(429);

    const stored = JSON.parse(kv.store.get('wa:counts') as string) as Record<string, number>;
    const today = todayInKolkata();
    // Every successful post before the limit hit incremented the counter by
    // 1 each; the request that got 429 must not have added one more on top.
    const countBeforeLimit = stored[today];
    const secondCall = await worker.fetch(postWa({ ip: '9.8.7.6' }), env);
    expect(secondCall.status).toBe(429);
    const storedAfter = JSON.parse(kv.store.get('wa:counts') as string) as Record<string, number>;
    expect(storedAfter[today]).toBe(countBeforeLimit);
  });

  it('stops writing once the daily cap is reached', async () => {
    // KV Free is 1,000 writes/day and 1 write/sec to the same key. Without a
    // cap, `while true; do curl -X POST .../api/wa; done` both inflates the
    // number she makes decisions on and exhausts the day's writes -- which,
    // since login rate limiting is also KV-backed, disables that too.
    //
    // Seeded directly at the cap rather than looping WA_DAILY_CAP real
    // requests through the per-IP rate limiter (which would also have to be
    // defeated with hundreds of distinct IPs) -- this test is about the
    // cap, not the rate limiter, which the two tests above already cover.
    const today = todayInKolkata();
    await kv.put('wa:counts', JSON.stringify({ [today]: WA_DAILY_CAP }));

    // Each post below comes from its own IP so the per-IP rate limit never
    // interferes with what this test is actually checking.
    const response = await worker.fetch(postWa({ ip: 'cap-test-1' }), env);
    expect(response.status).toBe(204);

    const stored = JSON.parse(kv.store.get('wa:counts') as string) as Record<string, number>;
    // Still exactly the cap -- the write was skipped, not merely capped
    // after incrementing.
    expect(stored[today]).toBe(WA_DAILY_CAP);

    const second = await worker.fetch(postWa({ ip: 'cap-test-2' }), env);
    expect(second.status).toBe(204);
    const storedAfterSecond = JSON.parse(kv.store.get('wa:counts') as string) as Record<string, number>;
    expect(storedAfterSecond[today]).toBe(WA_DAILY_CAP);
  });

  it('a day under the cap still counts normally -- the cap does not block everything', async () => {
    const today = todayInKolkata();
    await kv.put('wa:counts', JSON.stringify({ [today]: WA_DAILY_CAP - 1 }));
    const response = await worker.fetch(postWa({ ip: 'headroom-test' }), env);
    expect(response.status).toBe(204);
    const stored = JSON.parse(kv.store.get('wa:counts') as string) as Record<string, number>;
    expect(stored[today]).toBe(WA_DAILY_CAP);
  });
});

describe('GET /api/wa', () => {
  let kv: FakeKV;
  let env: Env;

  beforeEach(async () => {
    kv = new FakeKV();
    env = await buildEnv(kv);
  });

  it('requires a session token to read the counts', async () => {
    const response = await worker.fetch(await getWa(), env);
    expect(response.status).toBe(401);
  });

  it('a forged session cookie is also 401', async () => {
    const forged = await signToken('a-different-secret-entirely', Math.floor(Date.now() / 1000) + 3600);
    const response = await worker.fetch(await getWa(`vb_session=${forged}`), env);
    expect(response.status).toBe(401);
  });

  it('returns the recorded counts, and says explicitly that the number is a lower bound', async () => {
    await worker.fetch(postWa(), env);
    await worker.fetch(postWa(), env);
    const cookie = await sessionCookie();
    const response = await worker.fetch(await getWa(cookie), env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { counts: Record<string, number>; lowerBound: boolean };
    const today = todayInKolkata();
    expect(body.counts[today]).toBe(2);
    // Not just present and true -- this is the field the brief and Plan 4's
    // dashboard both depend on existing at all, so a naive `{ counts }`
    // response (dropping the caveat entirely) must fail this, not just an
    // equality check on `counts` alone.
    expect(body.lowerBound).toBe(true);
  });

  it('an empty day answers with an empty counts object, not an error', async () => {
    const cookie = await sessionCookie();
    const response = await worker.fetch(await getWa(cookie), env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { counts: Record<string, number>; lowerBound: boolean };
    expect(body.counts).toEqual({});
  });
});
