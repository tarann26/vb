// Two guards on one contract: that the launch fixture really is the launch
// state, and that the Worker and the dashboard have not drifted apart about
// what the body looks like.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ZERO_DATA_PAYLOAD } from '../analytics-payload';
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
      ].sort(),
    );
    expect(ZERO_DATA_PAYLOAD.visits).toBe(0);
    expect(ZERO_DATA_PAYLOAD.thisWeekVisits).toBe(0);
    expect(ZERO_DATA_PAYLOAD.priorWeekVisits).toBe(0);
    expect(ZERO_DATA_PAYLOAD.byPath).toEqual([]);
    expect(ZERO_DATA_PAYLOAD.byReferer).toEqual([]);
    expect(ZERO_DATA_PAYLOAD.bookingTaps).toEqual({ total: 0, days: 28, lowerBound: true });
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
// The drift guard.
//
// worker/analytics.ts declared these shapes first, under an instruction not
// to touch anything outside `worker/`, with a note saying they belong here.
// Until that stream imports this module and deletes its copy, there are two
// declarations of one contract, and the failure mode is silent: the Worker
// starts sending a field the screen never reads, or renames one the screen
// still expects, and nothing anywhere is red until someone opens the page.
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

  // Comments and whitespace removed, so the two files may explain themselves
  // differently and only the DECLARATIONS are compared.
  function declarations(source: string): Map<string, string> {
    const stripped = source
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const found = new Map<string, string>();
    NAMES.forEach((name) => {
      const iface = stripped.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
      if (iface) found.set(name, iface[1].replace(/\s+/g, ' ').trim());
      const alias = stripped.match(new RegExp(`export type ${name}\\s*=([^;]*);`));
      if (alias) found.set(name, alias[1].replace(/\s+/g, ' ').trim());
    });
    return found;
  }

  const workerSource = readFileSync('worker/analytics.ts', 'utf8');
  const sharedSource = readFileSync('src/shared/analytics-payload.ts', 'utf8');

  // The guard is inert -- and says so out loud -- once the Worker imports
  // this module instead of declaring its own copy, which is the end state
  // this whole thing is waiting for.
  const workerImportsShared = /from '\.\.\/src\/shared\/analytics-payload'/.test(workerSource);

  it.skipIf(workerImportsShared).each(NAMES)('%s is declared identically in both', (name) => {
    const worker = declarations(workerSource).get(name);
    const shared = declarations(sharedSource).get(name);
    expect(shared, `${name} is missing from src/shared/analytics-payload.ts`).toBeDefined();
    expect(worker, `${name} is missing from worker/analytics.ts`).toBeDefined();
    expect(shared).toBe(worker);
  });

  it.skipIf(workerImportsShared)('ZERO_DATA_PAYLOAD is declared identically in both', () => {
    const literal = (source: string) =>
      source
        .match(/export const ZERO_DATA_PAYLOAD: AnalyticsPayload = \{([\s\S]*?)\n\};/)?.[1]
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    expect(literal(sharedSource)).toBe(literal(workerSource));
  });
});
