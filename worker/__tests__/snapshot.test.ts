import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SNAPSHOT_BUILT_AT, snapshotFor, snapshotVersionFor } from '../snapshot';
import { validateContent } from '../../src/content/validate';
import { siteRootForm } from '../../src/test/siteRootForm';

describe('the compiled snapshot', () => {
  it('holds the pilot document', () => {
    expect(snapshotFor('awards.json')).not.toBeNull();
  });

  it('holds story.json (Phase 4, the second D1-only path)', () => {
    expect(snapshotFor('story.json')).not.toBeNull();
  });

  // A corrupt snapshot is worse than none: it would serve broken content at
  // exactly the moment nobody can look at the database to find out why.
  it('parses, and passes the same validator the write path runs', () => {
    const parsed = JSON.parse(snapshotFor('awards.json')!);
    expect(validateContent('awards.json', parsed)).toEqual([]);
  });

  it('story.json parses, and passes the same validator the write path runs', () => {
    const parsed = JSON.parse(snapshotFor('story.json')!);
    expect(validateContent('story.json', parsed)).toEqual([]);
  });

  // "Parses and validates" cannot catch every corruption -- a paragraph
  // with its real prose swapped for wrong text still parses and still
  // validates, because validateStory checks shape (blank? trailing
  // ellipsis?), not content. worker/__tests__/published.test.ts's fallback
  // test compares the served body against `snapshotFor('story.json')`,
  // which is this exact value -- so that test can catch published.ts
  // serving the WRONG thing, but it structurally cannot catch this
  // snapshot's own body being wrong, because both sides of that
  // comparison come from the same place. This test gives the snapshot's
  // story.json body a genuinely independent thing to be checked against:
  // src/content/story.json, the committed fallback file that
  // scripts/sync-story-fallback.mjs keeps in step with this generated
  // file before a deploy that matters. Unlike awards.json (see the retired
  // byte-for-byte test's comment below), story.json still has a real
  // committed source of truth outside this generated one, so this
  // assertion does not go stale the way that one did -- it fails exactly
  // when the two are supposed to agree and don't, whether the drift is a
  // stale snapshot, a stale committed file, or (proven live before this
  // test was written) a hand-corrupted snapshot body.
  //
  // Read through `siteRootForm` on both sides, and only for the 2026-08-21
  // migration's own window. Task 6 rewrites the committed file's photograph
  // onto the image host; this floor is GENERATED FROM D1 and legitimately
  // lags until Task 7 rewrites the row and Task 8 regenerates it, so for those
  // two commits the two files disagree about the spelling of one path and
  // about nothing else. Hand-editing the generated file to close that gap
  // would be worse than the gap: the next `node scripts/build-snapshot.mjs`
  // would silently undo it, and the `version` beside the body would go on
  // claiming a D1 body it no longer matches. Every other kind of drift this
  // test was written for -- a stale snapshot, a stale committed file, a
  // hand-corrupted body, a swapped paragraph -- still fails it, because
  // siteRootForm changes nothing but this one substitution.
  it("story.json's body matches the committed fallback file, photograph spellings aside", () => {
    const committed = readFileSync(join(process.cwd(), 'src', 'content', 'story.json'), 'utf-8');
    expect(siteRootForm(snapshotFor('story.json')!)).toBe(siteRootForm(committed));
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

  it("records story.json's D1 version its body was captured at", () => {
    const version = snapshotVersionFor('story.json');
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
