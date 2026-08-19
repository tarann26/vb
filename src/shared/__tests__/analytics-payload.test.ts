// Two guards on one contract: that the launch fixture really is the launch
// state, and that the Worker and the dashboard have not drifted apart about
// what the body looks like.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_RANGE,
  PAYLOAD_SHAPE_VERSION,
  RANGE_DAYS,
  ZERO_DATA_PAYLOAD,
  isAnalyticsPayload,
  isAnalyticsRange,
  parseRange,
} from '../analytics-payload';
import type { AnalyticsPayload } from '../analytics-payload';

describe('ZERO_DATA_PAYLOAD is the launch state, not an error state', () => {
  // Every key the type declares, spelled out rather than derived from the
  // object under test -- deriving both sides of an equality from the same
  // value asserts nothing.
  it('has every key, with every count at zero and every list empty', () => {
    expect(Object.keys(ZERO_DATA_PAYLOAD).sort()).toEqual(
      [
        'byPath',
        'byReferer',
        'bookingTaps',
        'priorWeekVisits',
        'thisWeekVisits',
        'visits',
        'visitsAreEstimate',
        'windowDays',
        'range',
        'series',
        'seriesGrain',
        'seriesSource',
        'seriesStartsOn',
        'hourly',
        'campaigns',
        'campaignsAreExact',
        'visitsPrevious',
        'tapsPrevious',
        'yearAvailable',
      ].sort(),
    );
    expect(ZERO_DATA_PAYLOAD.visits).toBe(0);
    expect(ZERO_DATA_PAYLOAD.thisWeekVisits).toBe(0);
    expect(ZERO_DATA_PAYLOAD.priorWeekVisits).toBe(0);
    expect(ZERO_DATA_PAYLOAD.byPath).toEqual([]);
    expect(ZERO_DATA_PAYLOAD.byReferer).toEqual([]);
    expect(ZERO_DATA_PAYLOAD.bookingTaps).toEqual({ total: 0, days: 30, lowerBound: true });
    // The launch values of the v2 fields, as literals. `hourly: null` means
    // "this site cannot answer that question", which is not an empty chart
    // and not an error; `seriesStartsOn: null` means the archive holds
    // nothing yet.
    expect(ZERO_DATA_PAYLOAD.series).toEqual([]);
    expect(ZERO_DATA_PAYLOAD.hourly).toBeNull();
    expect(ZERO_DATA_PAYLOAD.seriesStartsOn).toBeNull();
    expect(ZERO_DATA_PAYLOAD.campaigns).toEqual([]);
    expect(ZERO_DATA_PAYLOAD.visitsPrevious).toBe(0);
    expect(ZERO_DATA_PAYLOAD.tapsPrevious).toBe(0);
    expect(ZERO_DATA_PAYLOAD.yearAvailable).toBe(false);
  });

  // Both flags are in the BODY rather than only in a comment, and that is
  // the point of them: the card copy has to say "about 4,100 visits" and "at
  // least 41 tapped Reserve a Table", never a bare number and never "41
  // bookings".
  it('carries the two honesty flags the card copy depends on', () => {
    const payload: AnalyticsPayload = ZERO_DATA_PAYLOAD;
    expect(payload.visitsAreEstimate).toBe(true);
    expect(payload.bookingTaps.lowerBound).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The range, and the cache-key shape version that rides with it.
// ---------------------------------------------------------------------------

describe('the range', () => {
  it('offers exactly four values and no fifth', () => {
    // Spelled out rather than derived from RANGE_DAYS: deriving the expected
    // set from the value under test would accept any set at all.
    expect(Object.keys(RANGE_DAYS).sort()).toEqual(['30d', '7d', '90d', 'year']);
    expect(RANGE_DAYS).toEqual({ '7d': 7, '30d': 30, '90d': 90, year: 365 });
  });

  it('defaults to 30 days, not the 28 this panel shipped with', () => {
    expect(DEFAULT_RANGE).toBe('30d');
    expect(RANGE_DAYS[DEFAULT_RANGE]).toBe(30);
  });

  it.each(['7d', '30d', '90d', 'year'])('accepts %s', (raw) => {
    expect(isAnalyticsRange(raw)).toBe(true);
    expect(parseRange(raw)).toBe(raw);
  });

  // The whole reason the range is an enum: every one of these is something a
  // caller can put in a query string, and none of them may become a cache
  // key. `?days=<number>` behind a route whose only load control is one Cache
  // API entry is an unbounded number of upstream GraphQL calls.
  it.each([null, '', '90', '365d', 'YEAR', '30D', '<script>', '7d ', 'year;drop'])(
    'answers %s with the default rather than an error',
    (raw) => {
      expect(isAnalyticsRange(raw)).toBe(false);
      expect(parseRange(raw)).toBe('30d');
    },
  );

  it('is on v2 of the shape, because this cut added series, campaigns and the rest', () => {
    // A literal. The version is half of the cache key, and a body from the
    // previous deploy reaching a UI that expects the new fields renders as
    // "the visitor numbers aren't connected yet" for ten minutes after every
    // deploy.
    expect(PAYLOAD_SHAPE_VERSION).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
describe('the payload guard', () => {
  it('accepts the launch fixture', () => {
    expect(isAnalyticsPayload(ZERO_DATA_PAYLOAD)).toBe(true);
  });

  it('refuses a body missing any one required field', () => {
    for (const key of Object.keys(ZERO_DATA_PAYLOAD)) {
      // The three fields the guard deliberately does not read, named and
      // explained IN the loop rather than left as an unexplained hole:
      //   visitsAreEstimate  a literal `true` the type carries for the
      //                      reader; a body without it is still drawable.
      //   campaignsAreExact  the same.
      //   seriesStartsOn     legitimately null, so `in`-checking it would
      //                      reject a correct empty archive.
      if (key === 'visitsAreEstimate' || key === 'campaignsAreExact' || key === 'seriesStartsOn') continue;
      const short = { ...ZERO_DATA_PAYLOAD } as Record<string, unknown>;
      delete short[key];
      expect(isAnalyticsPayload(short), key).toBe(false);
    }
  });

  it('refuses a range it does not offer', () => {
    expect(isAnalyticsPayload({ ...ZERO_DATA_PAYLOAD, range: '365d' })).toBe(false);
  });

  it('refuses the things a broken proxy actually sends', () => {
    for (const body of [null, undefined, '', 'ok', 0, [], { message: 'Bad gateway' }]) {
      expect(isAnalyticsPayload(body)).toBe(false);
    }
  });

  it('treats a null busiest-times answer as valid and a missing one as not', () => {
    expect(isAnalyticsPayload({ ...ZERO_DATA_PAYLOAD, hourly: null })).toBe(true);
    const without = { ...ZERO_DATA_PAYLOAD } as Record<string, unknown>;
    delete without.hourly;
    expect(isAnalyticsPayload(without)).toBe(false);
  });

  it('keeps the day count in step with the range it names', () => {
    expect(ZERO_DATA_PAYLOAD.windowDays).toBe(RANGE_DAYS[ZERO_DATA_PAYLOAD.range]);
    expect(ZERO_DATA_PAYLOAD.bookingTaps.days).toBe(ZERO_DATA_PAYLOAD.windowDays);
  });
});

// ---------------------------------------------------------------------------
// The drift guard.
//
// worker/analytics.ts declared these shapes first, under an instruction not
// to touch anything outside `worker/`, with a note saying they belong here.
// While there were two declarations of one contract the failure mode was
// silent: the Worker starts sending a field the screen never reads, or
// renames one the screen still expects, and nothing anywhere is red until
// someone opens the page.
//
// THAT HAS NOW HAPPENED: the Worker imports this module and its copy is
// gone. So the guard's job changed. It used to hold two copies in step; what
// it watches now is that there is only ever ONE copy, and the first case
// below runs every time and says so.
//
// That case earns its place because `tsc` does not own it. A second
// declaration inside `worker/` that is merely STRUCTURALLY COMPATIBLE with
// this module's -- one extra optional field, or the same field name carrying
// a different meaning -- typechecks perfectly on both sides while putting a
// different contract on each end of the wire, which is the silent drift this
// whole comment is about. Only reading the source finds it.
//
// The text comparison is kept behind that case, asleep, gated on a Worker
// declaration actually existing. It is not the guard any more; it is what
// tells the next reader WHICH shape drifted and how.
//
// Compared as normalised TEXT rather than by importing worker/analytics.ts,
// deliberately: that module is compiled under tsconfig.worker.json against
// @cloudflare/workers-types (KVNamespace, and `caches` which does not exist
// in this environment at all), and pulling it into the app project to
// compare a type would drag all of that with it.
describe('the Worker and the dashboard agree on the body', () => {
  const NAMES = [
    'RefererBucketKind',
    'AnalyticsRefererBucket',
    'AnalyticsPathRow',
    'AnalyticsPayload',
    'AnalyticsFailureReason',
    'AnalyticsError',
  ];

  const withoutComments = (source: string) =>
    source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // Comments and whitespace removed, so the two files may explain themselves
  // differently and only the DECLARATIONS are compared. `export` is optional
  // here on purpose: a copy kept private to `worker/` drifts every bit as
  // silently as an exported one.
  function declarations(source: string): Map<string, string> {
    const stripped = withoutComments(source);
    const found = new Map<string, string>();
    NAMES.forEach((name) => {
      const iface = stripped.match(new RegExp(`(?:export )?interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
      if (iface) found.set(name, iface[1].replace(/\s+/g, ' ').trim());
      const alias = stripped.match(new RegExp(`(?:export )?type ${name}\\s*=([^;]*);`));
      if (alias) found.set(name, alias[1].replace(/\s+/g, ' ').trim());
    });
    return found;
  }

  // Which of the six a file DECLARES, as against imports. `import type {
  // AnalyticsPayload }` never matches, and that distinction is the whole
  // thing this guard turns on: the Worker is required to import all six and
  // required to declare none of them.
  function declaredIn(source: string): string[] {
    const stripped = withoutComments(source);
    return NAMES.filter((name) =>
      new RegExp(`(?:^|[\\n;}])\\s*(?:export\\s+)?(?:interface|type)\\s+${name}\\b`).test(stripped),
    );
  }

  const workerSource = readFileSync('worker/analytics.ts', 'utf8');
  const sharedSource = readFileSync('src/shared/analytics-payload.ts', 'utf8');

  const workerDeclares = declaredIn(workerSource);
  const workerDeclaresFixture = /(?:^|[\n;}])\s*(?:export\s+)?const ZERO_DATA_PAYLOAD\b/.test(
    withoutComments(workerSource),
  );

  // ALWAYS RUNS. Every other case in this file's last section is asleep in
  // the state the branch is actually in; this one is the live wire, and it
  // is the one a re-declaration inside `worker/` reddens -- including a
  // re-declaration `tsc` is happy with.
  it('leaves this module as the only place the contract is declared', () => {
    expect(workerDeclares, 'worker/analytics.ts declares a second copy of the contract').toEqual([]);
    expect(workerDeclaresFixture, 'worker/analytics.ts declares a second ZERO_DATA_PAYLOAD').toBe(false);
    // The other half of "only one place": the six have to be declared HERE,
    // so that deleting one from this module is red rather than green-by-
    // absence on both sides.
    expect([...declaredIn(sharedSource)].sort()).toEqual([...NAMES].sort());
    expect(workerSource).toMatch(/from '\.\.\/src\/shared\/analytics-payload'/);
  });

  it.skipIf(workerDeclares.length === 0).each(NAMES)('%s is declared identically in both', (name) => {
    const worker = declarations(workerSource).get(name);
    const shared = declarations(sharedSource).get(name);
    expect(shared, `${name} is missing from src/shared/analytics-payload.ts`).toBeDefined();
    expect(worker, `${name} is missing from worker/analytics.ts`).toBeDefined();
    expect(shared).toBe(worker);
  });

  it.skipIf(!workerDeclaresFixture)('ZERO_DATA_PAYLOAD is declared identically in both', () => {
    const literal = (source: string) =>
      source
        .match(/(?:export )?const ZERO_DATA_PAYLOAD: AnalyticsPayload = \{([\s\S]*?)\n\};/)?.[1]
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    expect(literal(sharedSource)).toBe(literal(workerSource));
  });
});
