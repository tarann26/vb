import { describe, expect, it } from 'vitest';
import { asD1, FakeD1 } from './fakeD1';
import {
  campaignTotals,
  dailySince,
  daysInMonth,
  firstDailyDay,
  monthlyCount,
  monthlySeries,
  pruneAnalytics,
  recordArrival,
  recordDailyVisits,
  rollMonths,
  takeRateSlot,
} from '../analytics-store';

function store() {
  const fake = new FakeD1();
  return { fake, db: asD1(fake) };
}

describe('campaign rows', () => {
  it('counts by source, biggest first, and ties break by name so the card cannot reshuffle itself', async () => {
    const { db } = store();
    for (const source of ['instagram', 'instagram', 'google', 'other', 'other']) {
      await recordArrival(db, source, '2026-08-20', 1000);
    }
    expect(await campaignTotals(db, '2026-08-01')).toEqual([
      { source: 'instagram', arrivals: 2 },
      { source: 'other', arrivals: 2 },
      { source: 'google', arrivals: 1 },
    ]);
  });

  it('leaves rows older than the range out of the count', async () => {
    const { db } = store();
    await recordArrival(db, 'instagram', '2026-07-01', 1);
    await recordArrival(db, 'instagram', '2026-08-12', 2);
    // 2026-08-12 is the INCLUSIVE first day of a 7-day window ending
    // 2026-08-18. A window built one day short drops it.
    expect(await campaignTotals(db, '2026-08-12')).toEqual([{ source: 'instagram', arrivals: 1 }]);
  });
});

describe('the limiter', () => {
  it('allows exactly the limit and refuses the next one', async () => {
    const { db } = store();
    const results: boolean[] = [];
    for (let i = 0; i < 4; i += 1) results.push(await takeRateSlot(db, 'opaque-bucket', 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });

  it('starts again once the window has moved on', async () => {
    const { db } = store();
    // The bucket NAMES the window -- worker/campaign.ts hashes the window
    // number into the per-address bucket and the cap's bucket is the IST
    // date -- so a window that has moved on has no row of its own yet.
    await takeRateSlot(db, 'r:window-1', 1, 60);
    expect(await takeRateSlot(db, 'r:window-1', 1, 60)).toBe(false);
    expect(await takeRateSlot(db, 'r:window-2', 1, 120)).toBe(true);
  });

  it('keeps counting one bucket whose expiry advances by a second on every request', async () => {
    // The exact bindings Task 8 uses: `nowSeconds + <lifetime>`, one second
    // larger every second. A limiter that read the expiry to decide whether
    // the window had rolled reset on nearly every request and refused
    // NOTHING -- neither the ten a minute nor the 2,000 a day. Adjacent
    // expiries are what make that visible; the round numbers above do not.
    const { db } = store();
    const now = 1_760_000_000;
    const cap: boolean[] = [];
    for (let i = 0; i < 8; i += 1) cap.push(await takeRateSlot(db, 'day:2026-08-19', 3, now + i + 172_800));
    expect(cap).toEqual([true, true, true, false, false, false, false, false]);
    const perAddress: boolean[] = [];
    for (let i = 0; i < 8; i += 1) perAddress.push(await takeRateSlot(db, 'r:one-window', 3, now + i + 60));
    expect(perAddress).toEqual([true, true, true, false, false, false, false, false]);
  });

  it('pushes a bucket still being written to out of the prune it would otherwise die in', async () => {
    const { fake, db } = store();
    await takeRateSlot(db, 'day:2026-08-19', 500, 100);
    await takeRateSlot(db, 'day:2026-08-19', 500, 200);
    // The prune deletes `expires < now`. A DO UPDATE that left the stored
    // expiry alone would let the night's prune delete the cap's own row in
    // the middle of the day it is counting, and the day's 2,000 would start
    // again from zero.
    await pruneAnalytics(db, '2000-01-01', 150);
    expect(fake.campaignRate.size).toBe(1);
  });
});

describe('the snapshots and the roll', () => {
  it('corrects a day it has already recorded rather than adding a second row', async () => {
    const { fake, db } = store();
    await recordDailyVisits(db, '2026-08-20', 10, 1);
    await recordDailyVisits(db, '2026-08-20', 14, 2);
    expect(fake.dailyVisits.size).toBe(1);
    expect(await dailySince(db, '2026-08-01')).toEqual([{ day: '2026-08-20', visits: 14, complete: true }]);
  });

  it('reports no first day at all when nothing has ever landed', async () => {
    const { db } = store();
    expect(await firstDailyDay(db)).toBeNull();
    await recordDailyVisits(db, '2026-08-20', 1, 1);
    await recordDailyVisits(db, '2026-08-11', 1, 1);
    expect(await firstDailyDay(db)).toBe('2026-08-11');
  });

  it('rolls every month the window touches, not only the one that just ended', async () => {
    const { db } = store();
    await recordDailyVisits(db, '2026-06-30', 5, 1);
    await recordDailyVisits(db, '2026-07-01', 7, 1);
    await recordDailyVisits(db, '2026-08-01', 9, 1);
    await rollMonths(db, '2026-06-01', 1);
    expect((await monthlySeries(db, '2026-01')).map((row) => row.day)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('picks up a day that arrives late, on the next run', async () => {
    const { db } = store();
    await recordDailyVisits(db, '2026-07-01', 7, 1);
    await rollMonths(db, '2026-06-01', 1);
    await recordDailyVisits(db, '2026-07-02', 3, 2);
    await rollMonths(db, '2026-06-01', 2);
    expect((await monthlySeries(db, '2026-01'))[0]).toEqual({ day: '2026-07', visits: 10, complete: false });
  });

  it('recomputes rather than accumulating, so running twice cannot double a month', async () => {
    const { db } = store();
    await recordDailyVisits(db, '2026-08-19', 10, 1);
    await recordDailyVisits(db, '2026-08-20', 5, 1);
    await rollMonths(db, '2026-08-01', 1);
    await rollMonths(db, '2026-08-01', 2);
    expect((await monthlySeries(db, '2026-08'))[0].visits).toBe(15);
  });

  it('marks a month complete only when every one of its days is present', async () => {
    const { db } = store();
    for (let day = 1; day <= 30; day += 1) {
      await recordDailyVisits(db, `2026-09-${String(day).padStart(2, '0')}`, 1, 1);
    }
    await recordDailyVisits(db, '2026-10-01', 1, 1);
    await rollMonths(db, '2026-09-01', 1);
    const rows = await monthlySeries(db, '2026-09');
    expect(rows.find((row) => row.day === '2026-09')?.complete).toBe(true);
    expect(rows.find((row) => row.day === '2026-10')?.complete).toBe(false);
  });

  it('counts the months behind the by-year button', async () => {
    const { db } = store();
    expect(await monthlyCount(db)).toBe(0);
    await recordDailyVisits(db, '2026-08-01', 1, 1);
    await rollMonths(db, '2026-08-01', 1);
    expect(await monthlyCount(db)).toBe(1);
  });

  it('prunes old days and dead limiter buckets, and nothing else', async () => {
    const { fake, db } = store();
    await recordDailyVisits(db, '2025-01-01', 3, 1);
    await recordDailyVisits(db, '2026-08-20', 4, 1);
    await takeRateSlot(db, 'opaque-bucket', 500, 60);
    await pruneAnalytics(db, '2026-01-01', 90);
    expect(await dailySince(db, '2000-01-01')).toEqual([{ day: '2026-08-20', visits: 4, complete: true }]);
    expect(fake.campaignRate.size).toBe(0);
  });
});

describe('daysInMonth', () => {
  it.each([
    ['2026-01', 31],
    ['2026-02', 28],
    ['2024-02', 29],
    ['2000-02', 29],
    ['1900-02', 28],
    ['2026-04', 30],
    ['2026-12', 31],
  ])('%s has %i days', (month, expected) => {
    expect(daysInMonth(month)).toBe(expected);
  });
});
