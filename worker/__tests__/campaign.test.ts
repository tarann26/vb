import { describe, expect, it, vi } from 'vitest';
import { asD1, FakeD1 } from './fakeD1';
import { CAMPAIGN_DAILY_CAP, CAMPAIGN_RATE_MAX, handleCampaignArrival, readCampaignRows } from '../campaign';
import { recordArrival } from '../analytics-store';
import worker, { type Env } from '../index';
import { todayInKolkata } from '../../src/shared/date';

const ORIGIN = 'https://viabiancarestaurant.com';

function post(body: unknown, headers: Record<string, string> = {}, origin = ORIGIN): Request {
  return new Request(`${origin}/api/campaign`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function env() {
  const fake = new FakeD1();
  return { fake, env: { DB: asD1(fake) } };
}

// The read half takes a plain D1Database, not an env -- same shape
// worker/__tests__/analytics-store.test.ts's own `store()` hands out.
function store() {
  const fake = new FakeD1();
  return { fake, db: asD1(fake) };
}

describe('POST /api/campaign', () => {
  it('writes exactly one row for one tagged arrival', async () => {
    const { fake, env: e } = env();
    const response = await handleCampaignArrival(post({ source: 'instagram' }), e);
    expect(response.status).toBe(204);
    expect(fake.campaignArrivals).toHaveLength(1);
    expect(fake.campaignArrivals[0].source).toBe('instagram');
  });

  // Stated as its own case so the ONE-ROW guarantee is unambiguous about
  // where it lives: the server does not deduplicate and cannot. What stops
  // four page views becoming four rows is that only ONE request is ever sent
  // (src/campaign.ts, observed in e2e/campaign-write.spec.ts). Without this
  // test the browser half and the server half can quietly cover for each
  // other and nothing says which one holds the guarantee.
  it('four arrivals write four rows — the server counts what it is sent', async () => {
    const { fake, env: e } = env();
    for (let i = 0; i < 4; i += 1) await handleCampaignArrival(post({ source: 'instagram' }), e);
    expect(fake.campaignArrivals).toHaveLength(4);
  });

  it('refuses a request from another origin before it touches storage', async () => {
    const { fake, env: e } = env();
    const response = await handleCampaignArrival(post({ source: 'instagram' }, { Origin: 'https://evil.example' }), e);
    expect(response.status).toBe(403);
    expect(fake.statements).toEqual([]);
  });

  it('refuses a request with no Origin header at all', async () => {
    const { fake, env: e } = env();
    const bare = new Request(`${ORIGIN}/api/campaign`, { method: 'POST', body: '{"source":"instagram"}' });
    expect((await handleCampaignArrival(bare, e)).status).toBe(403);
    expect(fake.statements).toEqual([]);
  });

  // The case a hardcoded origin literal passes and a derived one fails. This
  // site is served from a preview host as well as its own domain, and the
  // last hardcoded-origin defect here pinned a counter at zero for weeks.
  //
  // The host below is THIS project's generated Pages subdomain, read off
  // `npx wrangler pages project list`. It used to read `vb.pages.dev`, which
  // is a live, unrelated third party's website -- inert here, since the
  // handler compares the request's Origin against its own URL and never
  // fetches anything, but the same wrong belief written into wrangler.toml's
  // PAGES_ORIGIN would have served that stranger's HTML on every page view.
  // See src/test/wrangler-config.test.ts.
  it('accepts a same-origin request on the preview host too', async () => {
    const { fake, env: e } = env();
    const response = await handleCampaignArrival(post({ source: 'instagram' }, {}, 'https://vb-c7r.pages.dev'), e);
    expect(response.status).toBe(204);
    expect(fake.campaignArrivals).toHaveLength(1);
  });

  it('folds a source it does not know into one bucket', async () => {
    const { fake, env: e } = env();
    await handleCampaignArrival(post({ source: 'fbclid-9911' }), e);
    await handleCampaignArrival(post({ source: '<script>' }), e);
    expect(fake.campaignArrivals.map((row) => row.source)).toEqual(['other', 'other']);
  });

  it('writes nothing for a body with no usable source in it', async () => {
    const { fake, env: e } = env();
    for (const body of [{}, { source: '' }, { source: 42 }]) {
      expect((await handleCampaignArrival(post(body), e)).status).toBe(204);
    }
    expect(fake.campaignArrivals).toEqual([]);
  });

  it('stops writing once one address is over the per-minute limit', async () => {
    const { fake, env: e } = env();
    for (let i = 0; i < CAMPAIGN_RATE_MAX + 5; i += 1) {
      await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '1.2.3.4' }), e);
    }
    expect(fake.campaignArrivals).toHaveLength(CAMPAIGN_RATE_MAX);
  });

  it('limits each address separately', async () => {
    const { fake, env: e } = env();
    for (let i = 0; i < CAMPAIGN_RATE_MAX; i += 1) {
      await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '1.2.3.4' }), e);
    }
    await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '5.6.7.8' }), e);
    expect(fake.campaignArrivals).toHaveLength(CAMPAIGN_RATE_MAX + 1);
  });

  // The mutation table's "drop the window from the hashed bucket" row. Task
  // 7's own "starts again once the window has moved on" names its buckets by
  // hand, so it cannot see what THIS module puts inside one -- a bucket built
  // without the window number is a permanent ban on that address, and nothing
  // else in the suite would say so.
  it('starts counting that address again once the minute has moved on', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T10:00:00Z'));
    try {
      const { fake, env: e } = env();
      for (let i = 0; i < CAMPAIGN_RATE_MAX + 1; i += 1) {
        await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '9.9.9.9' }), e);
      }
      expect(fake.campaignArrivals).toHaveLength(CAMPAIGN_RATE_MAX);
      vi.setSystemTime(new Date('2026-08-18T10:01:01Z'));
      await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '9.9.9.9' }), e);
      expect(fake.campaignArrivals).toHaveLength(CAMPAIGN_RATE_MAX + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stores no address anywhere, in any column', async () => {
    // The privacy claim, checked against what actually landed rather than
    // against the schema. The limiter bucket is a hash; the arrival row has
    // no address column at all.
    const { fake, env: e } = env();
    await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '203.0.113.9' }), e);
    const stored = JSON.stringify([...fake.campaignRate.keys(), ...fake.campaignArrivals]);
    expect(stored).not.toContain('203.0.113.9');
  });

  it('answers a capped request the same way it answers an accepted one', async () => {
    const { env: e } = env();
    const accepted = await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '5.5.5.5' }), e);
    let last = accepted;
    for (let i = 0; i < CAMPAIGN_RATE_MAX + 2; i += 1) {
      last = await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '5.5.5.5' }), e);
    }
    expect(last.status).toBe(accepted.status);
    expect(await last.text()).toBe(await accepted.text());
  });

  // The case the test above does NOT reach, and the gap is worth naming: at
  // ten a minute per address, thirteen requests from one address are refused
  // by the PER-MINUTE limiter long before the 2,000-a-day cap is consulted,
  // so nothing there can see what the cap's own branch answers. The day
  // bucket is seeded to its limit instead of looped to it, exactly as
  // count.test.ts seeds a fake KV at WA_DAILY_CAP rather than issuing
  // hundreds of real requests.
  it('answers a request refused by the DAILY CAP exactly as it answers an accepted one', async () => {
    const { fake, env: e } = env();
    const accepted = await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '7.7.7.7' }), e);
    fake.campaignRate.set(`day:${todayInKolkata()}`, { hits: CAMPAIGN_DAILY_CAP, expires: 0 });
    const capped = await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '8.8.8.8' }), e);
    expect(capped.status).toBe(accepted.status);
    expect(await capped.text()).toBe(await accepted.text());
    // And it stopped: the arrival row from the accepted request is the only one.
    expect(fake.campaignArrivals).toHaveLength(1);
  });

  it('answers 204 rather than throwing when the insert fails', async () => {
    const { fake, env: e } = env();
    fake.failWith = 'D1_ERROR: no such table';
    fake.failAfter = 2; // the two limiter statements succeed; the insert does not
    expect((await handleCampaignArrival(post({ source: 'instagram' }), e)).status).toBe(204);
  });

  it('keys the row by IST date, not UTC', async () => {
    // 21:00 UTC on the 17th is 02:30 IST on the 18th. A UTC key files this
    // under her yesterday.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T21:00:00Z'));
    const { fake, env: e } = env();
    await handleCampaignArrival(post({ source: 'instagram' }), e);
    expect(fake.campaignArrivals[0].day).toBe('2026-08-18');
    vi.useRealTimers();
  });

  it('has a daily cap larger than one address can reach alone', () => {
    expect(CAMPAIGN_DAILY_CAP).toBeGreaterThan((CAMPAIGN_RATE_MAX * 60 * 24) / 10);
  });
});

// The READ half. A correct table can still produce a wrong card: the words
// beside each row, and what happens when the database is not there at all.
describe('readCampaignRows', () => {
  it('gives every row the words the card shows', async () => {
    const { db } = store();
    await recordArrival(db, 'instagram', '2026-08-18', 0);
    await recordArrival(db, 'instagram', '2026-08-18', 0);
    await recordArrival(db, 'zomato', '2026-08-17', 0);
    expect(await readCampaignRows(db, '2026-08-01')).toEqual([
      { source: 'instagram', label: 'Instagram link', arrivals: 2 },
      { source: 'zomato', label: 'Zomato link', arrivals: 1 },
    ]);
  });

  it('shows a source it has no words for rather than dropping the row', async () => {
    // Written straight into the table, because normalizeSource on the write
    // path cannot produce this -- a row the Worker has no label for means a
    // deploy that half-landed, and the card showing it is how that becomes
    // visible instead of becoming a missing row.
    const { db, fake } = store();
    fake.campaignArrivals.push({ source: 'mystery', day: '2026-08-18', created_at: 0 });
    expect(await readCampaignRows(db, '2026-08-01')).toEqual([
      { source: 'mystery', label: 'mystery', arrivals: 1 },
    ]);
  });

  it('degrades to empty when the database is down, and never throws', async () => {
    const { fake, db } = store();
    fake.failWith = 'D1 is down';
    await expect(readCampaignRows(db, '2026-08-01')).resolves.toEqual([]);
  });
});

// EVERY CASE ABOVE CALLS handleCampaignArrival DIRECTLY, so not one of them
// can see the two lines in worker/index.ts's `route` that decide this handler
// is ever reached. That gap was real: changing the dispatch path string to
// something no visitor sends left all 179 test files green. A Worker that
// 404s this route is exactly the shape of the defect worker/campaign.ts's own
// header records having already shipped once -- src/campaign.ts swallows the
// rejection by design, so the browser reports nothing and the card reads zero
// until somebody opens the Numbers screen and disbelieves it.
//
// So these three drive worker.fetch, the same entry point count.test.ts uses
// for POST /api/wa, against a FakeD1-backed env.
describe('POST /api/campaign, through the Worker entry point', () => {
  // A full Env because `fetch` takes one, not because this route reads any of
  // it: /api/campaign is in neither AUTHENTICATED_PATHS nor RATE_POLICIES, so
  // KV is never opened on this path and nothing here needs a real one.
  function workerEnv(fake: FakeD1): Env {
    return {
      KV: {} as unknown as KVNamespace,
      ADMIN_PASSWORD_HASH: 'campaign-test-only-password-hash-placeholder',
      TOKEN_SECRET: 'campaign-test-token-secret',
      GITHUB_OWNER: 'tarann26',
      GITHUB_REPO: 'vb',
      GITHUB_BRANCH: 'main',
      GITHUB_TOKEN: 'campaign-test-github-token-not-real',
      CLOUDFLARE_ACCOUNT_ID: 'campaign-test-account-id',
      CLOUDFLARE_PAGES_PROJECT: 'campaign-test-project',
      CLOUDFLARE_API_TOKEN: 'campaign-test-cf-token-not-real',
      CF_WEB_ANALYTICS_SITE_TAG: '29e1ba52fba74885a5fc44875a48a078',
      DB: asD1(fake),
    };
  }

  it('routes a same-origin arrival all the way to a row', async () => {
    const fake = new FakeD1();
    const response = await worker.fetch(post({ source: 'instagram' }), workerEnv(fake));
    expect(response.status).toBe(204);
    expect(fake.campaignArrivals).toHaveLength(1);
    expect(fake.campaignArrivals[0].source).toBe('instagram');
  });

  // The blanket check in `route` refuses every cross-origin POST except
  // /api/wa's, before any route is matched at all -- and worker/campaign.ts
  // repeats the check for itself. STATED PLAINLY: two independent guards
  // answer this request, so deleting either one alone leaves this case green.
  // It is here for the outcome, not for either mechanism.
  it('refuses a cross-origin POST to /api/campaign', async () => {
    const fake = new FakeD1();
    const response = await worker.fetch(
      post({ source: 'instagram' }, { Origin: 'https://evil.example' }),
      workerEnv(fake),
    );
    expect(response.status).toBe(403);
    expect(fake.statements).toEqual([]);
  });

  // This one is the singly-falsifiable half, and it is why an Origin-less
  // request is worth a case of its own: `route` deliberately ALLOWS a POST
  // with no Origin header (a proxy that strips the header must not lock the
  // owner out), so this request reaches the dispatch branch and is refused by
  // worker/campaign.ts's own stricter rule. Break the dispatch path and it is
  // a 404; delete the handler's Origin check and it is a 204 with a row.
  it('keeps its own stricter rule at the entry point: no Origin is still refused', async () => {
    const fake = new FakeD1();
    const bare = new Request(`${ORIGIN}/api/campaign`, {
      method: 'POST',
      body: JSON.stringify({ source: 'instagram' }),
    });
    const response = await worker.fetch(bare, workerEnv(fake));
    expect(response.status).toBe(403);
    expect(fake.campaignArrivals).toEqual([]);
  });
});
