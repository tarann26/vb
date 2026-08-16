import { describe, expect, it } from 'vitest';
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

  // Retired by Task 12, which is the boundary this test's own former name
  // named: this file used to assert the compiled snapshot matched
  // src/test/awards-seed.json BYTE FOR BYTE, so an edit to the hand-written
  // placeholder in worker/snapshot.ts (pre-Task-12, before the generator had
  // ever run against a live database) couldn't silently drift from the seed
  // it was supposed to mirror. Task 12 ran `node scripts/build-snapshot.mjs`
  // against the real, now-seeded database, and worker/snapshot.ts stopped
  // being a hand-maintained mirror of the seed fixture the moment that
  // happened -- it is real content now, written through the dashboard's own
  // code path (D1Store.write, validateContent), and it will keep changing
  // every time she publishes an edit. An exact-equality assertion against a
  // fixture that is never touched again would fail on the very first real
  // edit, for a reason that has nothing to do with a broken snapshot. The
  // tests above already cover what still matters post-migration: the
  // snapshot holds a document, that document parses and validates, and its
  // version is a real, provable value rather than a hand-typed one.
});
