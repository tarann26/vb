import { describe, it, expect, afterEach, vi } from 'vitest';
import { todayInKolkata } from '../date';

// The only tests that read `todayInKolkata`'s actual output -- every other
// caller in this repository takes the resulting string as data. A regression
// in here (e.g. dropping the explicit `timeZone` and falling back to the
// host clock, the exact bug this function exists to prevent) would leave the
// rest of the Worker suite green, since nothing else asserts on which DAY a
// tap lands under.
describe('todayInKolkata', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Cloudflare runs Workers in UTC. 23:00 UTC on the 1st is 04:30 IST on the
  // 2nd -- the boundary that decides which day a late-evening tap is counted
  // under. A UTC-based implementation would report "2026-08-01" here; this
  // must report "2026-08-02".
  it('reports the IST date, not the UTC date, when they disagree', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T23:00:00Z'));
    expect(todayInKolkata()).toBe('2026-08-02');
  });

  // The mirror case: a UTC instant that is *not yet* past the IST boundary
  // must not be reported as the next day either -- confirms this isn't
  // just "always add a day", which would also make the case above pass.
  it('does not report the next day before the IST boundary is crossed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T10:00:00Z')); // 15:30 IST on the 1st
    expect(todayInKolkata()).toBe('2026-08-01');
  });

  // The whole point of passing an explicit `timeZone` to `Intl.DateTimeFormat`
  // is that it must not depend on the host machine's own configured
  // timezone. Confirmed directly rather than assumed: same instant, two
  // different `TZ` env values, same IST-derived answer both times.
  it('is independent of the host TZ environment variable', () => {
    const originalTz = process.env.TZ;
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T23:00:00Z'));
      process.env.TZ = 'UTC';
      const underUtc = todayInKolkata();
      process.env.TZ = 'America/Los_Angeles';
      const underLosAngeles = todayInKolkata();
      expect(underUtc).toBe('2026-08-02');
      expect(underLosAngeles).toBe('2026-08-02');
    } finally {
      process.env.TZ = originalTz;
    }
  });
});
