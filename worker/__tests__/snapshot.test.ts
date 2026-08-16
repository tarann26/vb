import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SNAPSHOT_BUILT_AT, snapshotFor, snapshotVersionFor } from '../snapshot';
import { validateContent } from '../../src/content/validate';

describe('the compiled snapshot', () => {
  it('holds the pilot document', () => {
    expect(snapshotFor('awards.json')).not.toBeNull();
  });

  // A corrupt snapshot is worse than none: it would serve broken content at
  // exactly the moment nobody can look at the database to find out why.
  it('parses, and passes the same validator the write path runs', () => {
    const parsed = JSON.parse(snapshotFor('awards.json')!);
    expect(validateContent('awards.json', parsed)).toEqual([]);
  });

  it('does not answer for inherited object properties', () => {
    expect(snapshotFor('toString')).toBeNull();
    expect(snapshotFor('constructor')).toBeNull();
    expect(snapshotVersionFor('toString')).toBeNull();
    expect(snapshotVersionFor('constructor')).toBeNull();
  });

  it('records when it was built', () => {
    expect(new Date(SNAPSHOT_BUILT_AT).getTime()).toBeGreaterThan(0);
  });

  // Staleness detection: a version D1 actually held at generation time, not
  // merely a timestamp -- see worker/snapshot.ts's own header comment on why
  // a version match is provable rather than merely likely. A later check
  // (Task 12) compares this against D1Store.version(path) on the live
  // database; this test only pins that the number exists and is the kind of
  // value D1Store.write actually produces (a positive integer -- see
  // worker/d1.ts's `(prior?.version ?? 0) + 1`).
  it('records the D1 version its body was captured at', () => {
    const version = snapshotVersionFor('awards.json');
    expect(version).not.toBeNull();
    expect(Number.isInteger(version)).toBe(true);
    expect(version!).toBeGreaterThan(0);
  });

  // The hand-written placeholder (this task's Step 3) is supposed to be the
  // seed file in "the exact shape the generator produces" -- if someone edits
  // src/test/awards-seed.json without updating worker/snapshot.ts to match,
  // this is what catches the drift, since nothing else ties the two files
  // together.
  it('matches the committed seed exactly, until Task 12 regenerates it from D1', () => {
    const seed = JSON.parse(readFileSync('src/test/awards-seed.json', 'utf8'));
    const snapshot = JSON.parse(snapshotFor('awards.json')!);
    expect(snapshot).toEqual(seed);
  });
});
