import { describe, expect, it, vi } from 'vitest';
import { asD1, FakeD1 } from './fakeD1';
import { CAMPAIGN_DAILY_CAP, CAMPAIGN_RATE_MAX, handleCampaignArrival } from '../campaign';

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
  it('accepts a same-origin request on the preview host too', async () => {
    const { fake, env: e } = env();
    const response = await handleCampaignArrival(post({ source: 'instagram' }, {}, 'https://vb.pages.dev'), e);
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
