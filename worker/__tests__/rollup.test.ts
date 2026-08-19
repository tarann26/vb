import { afterEach, describe, expect, it, vi } from 'vitest';
import { asD1, FakeD1 } from './fakeD1';
import { runDailyRollup, type RollupEnv } from '../rollup';
import { RUM_CAPABILITIES } from '../analytics-schema';

// The nightly archive job. Runs under this repo's single jsdom Vitest
// environment like every other worker/__tests__ file, so `fetch`, `Request`
// and `Response` here are Node's own -- `fetch` is stubbed in every case so
// nothing in this file can reach the real Cloudflare API.
//
// The clock is passed in, never read: `runDailyRollup(env, nowMs)` takes the
// scheduled time as an argument precisely so "which day did it record" is a
// table-testable question rather than something that has to be arranged with
// fake timers.

function rollupEnv() {
  const fake = new FakeD1();
  const env: RollupEnv = {
    DB: asD1(fake),
    CLOUDFLARE_API_TOKEN: 'rollup-test-cf-token-not-real',
    CLOUDFLARE_ACCOUNT_ID: 'rollup-test-account-id',
    CF_WEB_ANALYTICS_SITE_TAG: 'rollup-test-site-tag',
  };
  return { fake, env };
}

type Row = { path?: string; visits: number };

// Shaped like the real GraphQL envelope, because worker/analytics.ts's
// totalVisitsFor walks it leaf by leaf and a flatter fixture would exercise
// none of that walk.
function dayWithRows(rows: Row[]): unknown {
  return {
    data: {
      viewer: {
        accounts: [
          {
            last28: rows.map((row) => ({ sum: { visits: row.visits }, dimensions: { requestPath: row.path ?? '/' } })),
            thisWeek: [],
            priorWeek: [],
          },
        ],
      },
    },
  };
}

function dayWithVisits(visits: number): unknown {
  return dayWithRows([{ path: '/', visits }]);
}

// The backfill's own envelope: a DIFFERENT alias (`byDay`) and a date
// dimension beside the path, so a fixture built for one cannot accidentally
// satisfy the other.
function byDayRows(rows: { day: string; path?: string; visits: number }[]): unknown {
  const dimension = RUM_CAPABILITIES.dateDimension ?? 'date';
  return {
    data: {
      viewer: {
        accounts: [
          {
            byDay: rows.map((row) => ({
              sum: { visits: row.visits },
              dimensions: { [dimension]: row.day, requestPath: row.path ?? '/' },
            })),
          },
        ],
      },
    },
  };
}

// One stub answering BOTH documents, told apart by the alias each asks for.
// A stub that answered the same body to both would let the day's snapshot
// pass on the backfill's fixture and hide which call did what.
function stubGraphql(daily: unknown, byDay: unknown = { data: { viewer: { accounts: [{ byDay: [] }] } } }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { query: string };
      return new Response(JSON.stringify(body.query.includes('byDay:') ? byDay : daily), { status: 200 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the nightly rollup', () => {
  it('records yesterday, not today, in UTC', async () => {
    const { fake, env } = rollupEnv();
    stubGraphql(dayWithVisits(140));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect([...fake.dailyVisits.keys()]).toEqual(['2026-08-19']);
    expect(fake.dailyVisits.get('2026-08-19')?.visits).toBe(140);
  });

  it('running twice leaves one row, not two, holding the LATER number', async () => {
    // The count alone cannot see the mutation this case is for. Dropping the
    // upsert's `DO UPDATE SET visits = excluded.visits` leaves the row count
    // at one either way -- what it changes is WHICH number survives, and a
    // retry that keeps a stale first answer is a day pinned wrong forever in
    // a table nothing recomputes.
    const { fake, env } = rollupEnv();
    const at = Date.UTC(2026, 7, 20, 3, 17);
    stubGraphql(dayWithVisits(140));
    await runDailyRollup(env, at);
    stubGraphql(dayWithVisits(151));
    await runDailyRollup(env, at);
    expect(fake.dailyVisits.size).toBe(1);
    expect(fake.dailyVisits.get('2026-08-19')?.visits).toBe(151);
  });

  it('writes NOTHING when Cloudflare refuses, rather than writing a zero', async () => {
    // A zero row is worse than a gap: the chart draws a real trough on a day
    // the site was fine and the API was not, and it never recovers.
    const { fake, env } = rollupEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect(fake.dailyVisits.size).toBe(0);
  });

  it('excludes her own editing visits from the day it records', async () => {
    const { fake, env } = rollupEnv();
    stubGraphql(
      dayWithRows([
        { path: '/', visits: 100 },
        { path: '/edit/manage/menu', visits: 40 },
      ]),
    );
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect(fake.dailyVisits.get('2026-08-19')?.visits).toBe(100);
  });

  it('rolls the last three months, not only the one that just ended', async () => {
    const { fake, env } = rollupEnv();
    fake.dailyVisits.set('2026-06-15', { visits: 3, recorded_at: 0 });
    fake.dailyVisits.set('2026-07-15', { visits: 4, recorded_at: 0 });
    stubGraphql(dayWithVisits(5));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect([...fake.monthlyVisits.keys()].sort()).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('prunes days past the stated ceiling and nothing nearer', async () => {
    const { fake, env } = rollupEnv();
    fake.dailyVisits.set('2024-01-01', { visits: 1, recorded_at: 0 });
    fake.dailyVisits.set('2026-06-15', { visits: 1, recorded_at: 0 });
    stubGraphql(dayWithVisits(1));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect(fake.dailyVisits.has('2024-01-01')).toBe(false);
    expect(fake.dailyVisits.has('2026-06-15')).toBe(true);
  });
});

// The conditional step, and the only step in this plan the schema
// verification changes. worker/analytics-schema.ts recorded a real date
// dimension for this dataset, so it RUNS -- and it runs exactly once, in
// production, writing ninety rows nobody will ever watch it write. That is
// precisely the shape of code that has to be proven here instead.
describe('the one-off backfill', () => {
  it('reaches ninety days backwards on the first run, and excludes her own visits from every day of it', async () => {
    const { fake, env } = rollupEnv();
    stubGraphql(
      dayWithVisits(7),
      byDayRows([
        { day: '2026-08-01', path: '/', visits: 20 },
        { day: '2026-08-01', path: '/catering', visits: 5 },
        { day: '2026-08-01', path: '/edit/manage/menu', visits: 90 },
        { day: '2026-08-02', path: '/', visits: 11 },
      ]),
    );
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect(fake.dailyVisits.get('2026-08-01')?.visits).toBe(25);
    expect(fake.dailyVisits.get('2026-08-02')?.visits).toBe(11);
    // And the night's own snapshot still landed on top of it.
    expect(fake.dailyVisits.get('2026-08-19')?.visits).toBe(7);
  });

  it('never runs again once the table holds anything at all', async () => {
    const { fake, env } = rollupEnv();
    fake.dailyVisits.set('2026-08-18', { visits: 1, recorded_at: 0 });
    stubGraphql(dayWithVisits(7), byDayRows([{ day: '2026-08-01', visits: 20 }]));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect(fake.dailyVisits.has('2026-08-01')).toBe(false);
    expect([...fake.dailyVisits.keys()].sort()).toEqual(['2026-08-18', '2026-08-19']);
  });

  it('asks Cloudflare for the dimension the verification actually recorded', async () => {
    // Not a name somebody remembered. A document built on a guessed spelling
    // is refused whole and the backfill silently writes nothing.
    const { env } = rollupEnv();
    stubGraphql(dayWithVisits(7));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    const stub = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const documents = stub.mock.calls.map(
      (call) => (JSON.parse((call[1] as RequestInit).body as string) as { query: string }).query,
    );
    const backfill = documents.find((query) => query.includes('byDay:'));
    expect(backfill, 'the backfill document was never sent').toBeDefined();
    expect(backfill).toContain(`dimensions { ${RUM_CAPABILITIES.dateDimension} requestPath }`);
  });
});
