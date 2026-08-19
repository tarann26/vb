import { afterEach, describe, expect, it, vi } from 'vitest';
import { asD1, FakeD1 } from './fakeD1';
import { runDailyRollup, type RollupEnv } from '../rollup';
import { RUM_CAPABILITIES } from '../analytics-schema';
import worker, { type Env } from '../index';

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

// What each call actually ASKED FOR, not merely that a call happened. The
// alias tells the two documents apart; the variables are the only place the
// window lives, and the window is the half of "which day is this number" that
// the row's key cannot show. A snapshot filed under yesterday's key holding
// today's partial count looks perfect in the table and is permanently wrong.
function sentDocuments(): { query: string; variables: Record<string, string> }[] {
  const stub = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return stub.mock.calls.map(
    (call) =>
      JSON.parse((call[1] as RequestInit).body as string) as {
        query: string;
        variables: Record<string, string>;
      },
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

  it("asks Cloudflare for yesterday's whole window, not today's partial day", async () => {
    // The case above pins which KEY the row is filed under and NOTHING about
    // where the number came from. Both halves have to be pinned separately,
    // because every way of getting the window wrong -- asking for today, or
    // for the last thirty days -- still writes exactly one row under exactly
    // the right key. This table is never recomputed, so a number that arrives
    // wrong stays wrong for as long as the site exists.
    const { env } = rollupEnv();
    stubGraphql(dayWithVisits(140));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    const snapshot = sentDocuments().find((doc) => !doc.query.includes('byDay:'));
    expect(snapshot, "the night's own snapshot document was never sent").toBeDefined();
    // Midnight UTC to midnight UTC: one closed day, the same document the
    // panel sends (worker/analytics.ts's totalVisitsFor), with its window
    // narrowed to that day.
    expect(snapshot!.variables.sinceWindow).toBe('2026-08-19T00:00:00.000Z');
    expect(snapshot!.variables.until).toBe('2026-08-20T00:00:00.000Z');
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

    // The REACH, which the rows above cannot show: a fixture answers whatever
    // window it is handed, so a backfill that asked for thirty days would
    // still write these two days and this case would still be green under a
    // name promising ninety. The reach is only visible in what was asked for,
    // and it is asked for exactly once, in production, on a table that is
    // never recomputed -- a short first run leaves the panel's longest range
    // permanently missing its history, with no symptom but a chart that
    // starts late.
    const backfill = sentDocuments().find((doc) => doc.query.includes('byDay:'));
    expect(backfill, 'the backfill document was never sent').toBeDefined();
    expect(backfill!.variables.since).toBe('2026-05-22T00:00:00.000Z'); // ninety days back
    expect(backfill!.variables.until).toBe('2026-08-20T00:00:00.000Z'); // midnight UTC today
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
    const backfill = sentDocuments().find((doc) => doc.query.includes('byDay:'));
    expect(backfill, 'the backfill document was never sent').toBeDefined();
    expect(backfill!.query).toContain(`dimensions { ${RUM_CAPABILITIES.dateDimension} requestPath }`);
    // And the window it was sent with, which is the other half of a document
    // that can be wrong without anything failing: a correctly-spelled
    // dimension over the wrong ninety days is still a chart that starts on
    // the wrong day, forever.
    expect(backfill!.variables.since).toBe('2026-05-22T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// The cron's other half. Everything above calls `runDailyRollup` directly,
// which proves nothing about anything ever calling it: an empty `scheduled`
// export passes every case above, and it passes the source-text check in
// src/test/wrangler-config.test.ts too. That failure is WORSE than the one
// that check was written for -- a missing handler is 365 failed invocations a
// year, visibly; a handler that runs and does nothing is 365 SUCCESSFUL
// invocations a year against an archive that silently never fills.
//
// This repo has written that lesson down twice already (see
// worker/__tests__/campaign.test.ts's 'through the Worker entry point' block
// and worker/__tests__/analytics.test.ts's 'the route, reached through the
// router'). So these two drive `worker.scheduled` itself.
// ---------------------------------------------------------------------------

describe("the nightly rollup, reached through the Worker's scheduled export", () => {
  // A full Env because `scheduled` takes one, not because the job reads any
  // of it beyond DB and the three analytics vars -- nothing on this path
  // opens KV or GitHub.
  function cronEnv(fake: FakeD1): Env {
    return {
      KV: {} as unknown as KVNamespace,
      ADMIN_PASSWORD_HASH: 'rollup-test-only-password-hash-placeholder',
      TOKEN_SECRET: 'rollup-test-token-secret',
      GITHUB_OWNER: 'tarann26',
      GITHUB_REPO: 'vb',
      GITHUB_BRANCH: 'main',
      GITHUB_TOKEN: 'rollup-test-github-token-not-real',
      CLOUDFLARE_ACCOUNT_ID: 'rollup-test-account-id',
      CLOUDFLARE_PAGES_PROJECT: 'rollup-test-project',
      CLOUDFLARE_API_TOKEN: 'rollup-test-cf-token-not-real',
      CF_WEB_ANALYTICS_SITE_TAG: 'rollup-test-site-tag',
      DB: asD1(fake),
    };
  }

  // The real ExecutionContext has members this test has no use for, so this
  // is the same cast the KV fakes elsewhere in worker/__tests__ use. What it
  // keeps is the one behaviour that matters: waitUntil COLLECTS the promise,
  // so a handler that registers nothing is visible as an empty list rather
  // than as work that quietly happened anyway.
  function fakeCtx() {
    const registered: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        registered.push(promise);
      },
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext;
    return { registered, ctx };
  }

  function cronEvent(scheduledTime: number): ScheduledController {
    return { scheduledTime, cron: '17 3 * * *', noRetry: () => undefined };
  }

  it('fires the cron and a row lands in D1', async () => {
    const fake = new FakeD1();
    stubGraphql(dayWithVisits(212));
    const { registered, ctx } = fakeCtx();

    await worker.scheduled(cronEvent(Date.UTC(2026, 7, 20, 3, 17)), cronEnv(fake), ctx);

    // A scheduled invocation's lifetime is the promise it registers; one that
    // registers none has done nothing at all.
    expect(registered).toHaveLength(1);
    await Promise.all(registered);
    expect(fake.dailyVisits.get('2026-08-19')?.visits).toBe(212);
  });

  it("archives the day the CRON fired for, not the day the machine thinks it is", async () => {
    // `event.scheduledTime`, not `Date.now()`. A retried or delayed invocation
    // carries the time it was scheduled for, and that is the day being
    // archived -- reading the wall clock instead files the number under
    // whatever day the retry happened to land on.
    const fake = new FakeD1();
    stubGraphql(dayWithVisits(9));
    const { registered, ctx } = fakeCtx();

    await worker.scheduled(cronEvent(Date.UTC(2026, 0, 5, 3, 17)), cronEnv(fake), ctx);
    await Promise.all(registered);

    expect([...fake.dailyVisits.keys()]).toEqual(['2026-01-04']);
  });
});
