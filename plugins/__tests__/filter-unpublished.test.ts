import { describe, it, expect, vi, afterEach } from 'vitest';
import filterUnpublished, { filterUnpublishedJson } from '../filter-unpublished';
// Moved to src/content/publish.ts (Task 8 of the worker plan) -- see that
// file's own comment. Imported from its new home here; every assertion
// below is unchanged.
import { todayInKolkata } from '../../src/content/publish';

// This is the coverage that matters: the plugin is `apply: 'build'` only
// (see filter-unpublished.ts), so it never runs during `vitest run` --
// these are the only tests that ever exercise the transform.
const TODAY = '2026-08-02';

const fixture = JSON.stringify([
  { id: 'past-item', name: 'Past Item', publishAt: '2026-07-01' },
  { id: 'future-item', name: 'Future Item', publishAt: '2099-01-01' },
  { id: 'undated-item', name: 'Undated Item' },
]);

describe('filterUnpublishedJson', () => {
  it('drops a future-dated item and keeps past-dated and undated items', () => {
    const result = filterUnpublishedJson('/repo/src/content/dishes.json', fixture, TODAY);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result as string) as Array<{ id: string }>;
    expect(parsed.map((item) => item.id)).toEqual(['past-item', 'undated-item']);
  });

  it.each(['dishes', 'drinks', 'press'])(
    'filters %s.json, matched by its resolved module id',
    (name) => {
      const result = filterUnpublishedJson(`/repo/src/content/${name}.json`, fixture, TODAY);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as Array<{ id: string }>;
      expect(parsed.map((item) => item.id)).toEqual(['past-item', 'undated-item']);
    },
  );

  it('returns null (leaves the module untouched) for a file that is not scheduled content', () => {
    expect(filterUnpublishedJson('/repo/src/content/site.json', fixture, TODAY)).toBeNull();
  });

  it('returns null for a JSON payload that is not an array', () => {
    expect(filterUnpublishedJson('/repo/src/content/dishes.json', '{}', TODAY)).toBeNull();
  });

  it('propagates a throw on a malformed publishAt, rather than dropping or guessing', () => {
    const bad = JSON.stringify([{ id: 'x', publishAt: 'next tuesday' }]);
    expect(() => filterUnpublishedJson('/repo/src/content/dishes.json', bad, TODAY)).toThrow();
  });

  // asPublishable's own throw path, untested until now: mutating its guard
  // to `if (false)` left every other test in this describe block green,
  // because none of them pass a non-object array item.
  it('rejects a non-object item in the array, rather than treating it as unpublished', () => {
    const bad = JSON.stringify([42]);
    expect(() => filterUnpublishedJson('/repo/src/content/dishes.json', bad, TODAY)).toThrow(
      /expected an array of objects/,
    );
  });
});

describe('filterUnpublished (the Vite plugin)', () => {
  it('applies to build only, never to dev/test', () => {
    expect(filterUnpublished().apply).toBe('build');
  });

  it('runs pre, before Vite\'s own JSON plugin converts the file to JS', () => {
    expect(filterUnpublished().enforce).toBe('pre');
  });

  // Nothing else in this file ever calls `.transform` itself -- the tests
  // above exercise `filterUnpublishedJson` directly, and the two above this
  // one only read `.apply`/`.enforce`. Proven load-bearing: replacing the
  // transform hook's body with `return null`, and separately swapping its
  // call to `filterUnpublishedJson(code, id, ...)` (the hook receives
  // `(code, id)`, but the underlying function takes `(id, code, today)`),
  // each left every other gate green. This test routes a real module id and
  // real code string through the actual hook, the way Vite's build pipeline
  // does, and would fail under either mutation: the argument swap makes
  // `isTargetContentFile` check the JSON *string* instead of the module id
  // (never matching, so the hook returns null and future-item survives);
  // `return null` skips filtering outright for the same reason.
  it('the transform hook routes a real module id through the filter', () => {
    const t = filterUnpublished().transform as (c: string, id: string) => { code: string } | null;
    const out = t.call({}, fixture, '/repo/src/content/dishes.json');
    expect(out).not.toBeNull();
    expect(JSON.parse(out!.code).map((i: { id: string }) => i.id)).not.toContain('future-item');
  });
});

// `filterUnpublishedJson`'s own tests all take `today` as a parameter, so
// none of them exercise `todayInKolkata`'s body at all -- a regression there
// (e.g. reverting to plain UTC, the exact bug this function exists to
// prevent) would leave every other test in this file green. These are the
// only tests that read `todayInKolkata`'s actual output.
describe('todayInKolkata', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Cloudflare builds in UTC. 23:00 UTC on the 1st is 04:30 IST on the 2nd
  // -- the exact boundary the brief names. A UTC-based implementation would
  // report "2026-08-01" here; this must report "2026-08-02".
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
