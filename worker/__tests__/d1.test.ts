import { beforeEach, describe, expect, it } from 'vitest';
import { D1ConflictError, D1Store, REVISION_DEPTH, sha256Hex } from '../d1';
import { asD1, FakeD1 } from './fakeD1';

let fake: FakeD1;
let store: D1Store;

beforeEach(() => {
  fake = new FakeD1();
  store = new D1Store(asD1(fake));
});

function file(path: string, content: string, baseSha?: string) {
  return { path, content, encoding: 'utf-8' as const, baseSha };
}

describe('read and write', () => {
  it('round-trips a document byte for byte', async () => {
    const body = '[{"id":"a","title":"Best Restaurant","awardedBy":"Delhi Times","year":"2025"}]';
    await store.write([file('src/content/awards.json', body)], 'first', 'p1');
    const read = await store.read('src/content/awards.json');
    expect(read?.content).toBe(body);
    // Not a re-serialisation. `sha` is a hash OF the stored text, so the two
    // cannot be allowed to disagree -- a store that reformatted the JSON on
    // the way in would produce a sha that matched nothing the client held.
    expect(read?.sha).toBe(await sha256Hex(body));
  });

  it('answers null for a path that has never been written', async () => {
    expect(await store.read('src/content/awards.json')).toBeNull();
  });

  it('bumps the version on every write, which is what invalidates the cache', async () => {
    await store.write([file('src/content/awards.json', '[]')], 'first', 'p1');
    expect(await store.version('src/content/awards.json')).toBe(1);
    await store.write([file('src/content/awards.json', '[{"id":"a"}]')], 'second', 'p2');
    expect(await store.version('src/content/awards.json')).toBe(2);
  });

  it('refuses non-utf-8 content rather than corrupting it', async () => {
    await expect(
      store.write([{ path: 'src/content/awards.json', content: 'AAAA', encoding: 'base64' }], 'x', 'p1'),
    ).rejects.toThrow(/only utf-8/);
  });
});

describe('optimistic concurrency', () => {
  it('accepts a write whose baseSha is current', async () => {
    await store.write([file('src/content/awards.json', '[]')], 'first', 'p1');
    const current = await store.read('src/content/awards.json');
    await expect(
      store.write([file('src/content/awards.json', '[{"id":"a"}]', current!.sha)], 'second', 'p2'),
    ).resolves.toEqual({ sha: null });
  });

  it('refuses a write whose baseSha is stale', async () => {
    await store.write([file('src/content/awards.json', '[]')], 'first', 'p1');
    const stale = (await store.read('src/content/awards.json'))!.sha;
    await store.write([file('src/content/awards.json', '[{"id":"a"}]')], 'second', 'p2');
    await expect(
      store.write([file('src/content/awards.json', '[{"id":"b"}]', stale)], 'third', 'p3'),
    ).rejects.toBeInstanceOf(D1ConflictError);
  });

  it('refuses a baseSha for a document that does not exist', async () => {
    await expect(
      store.write([file('src/content/awards.json', '[]', 'whatever')], 'x', 'p1'),
    ).rejects.toBeInstanceOf(D1ConflictError);
  });

  // The assertion the whole design turns on. A conditional UPDATE matching
  // zero rows is NOT an error in D1, so a guard that ran after the mutation
  // would already have written the revision row and the sibling files by the
  // time it noticed. Checking that NOTHING was written is what distinguishes
  // "guarded before" from "detected after".
  it('writes nothing at all when any file in the request conflicts', async () => {
    await store.write([file('src/content/awards.json', '[]')], 'first', 'p1');
    const stale = 'not-the-current-sha';
    const before = fake.revisions.length;
    await expect(
      store.write(
        [
          file('src/content/awards.json', '[{"id":"a"}]', stale),
          file('src/content/other.json', '{}'),
        ],
        'mixed',
        'p2',
      ),
    ).rejects.toBeInstanceOf(D1ConflictError);
    expect(fake.revisions.length, 'a revision row was written before the conflict was noticed').toBe(before);
    expect(fake.content.has('src/content/other.json'), 'a sibling file was written anyway').toBe(false);
    expect((await store.read('src/content/awards.json'))!.content).toBe('[]');
  });
});

describe('revisions', () => {
  it('records the PRIOR value on every write, not the new one', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    await store.write([file('src/content/awards.json', 'v2')], 'second', 'p2');
    const rows = fake.revisions.filter((r) => r.publish_id === 'p2');
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe('v1');
  });

  it('records nothing for the first write of a new path -- there is no prior', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    expect(fake.revisions).toHaveLength(0);
  });

  it(`keeps at most ${REVISION_DEPTH} per path, pruned on write`, async () => {
    for (let i = 0; i <= REVISION_DEPTH + 5; i += 1) {
      await store.write([file('src/content/awards.json', `v${i}`)], 'x', `p${i}`);
    }
    const mine = fake.revisions.filter((r) => r.path === 'src/content/awards.json');
    expect(mine.length).toBe(REVISION_DEPTH);
    // The NEWEST are what survive. A prune that kept the oldest would pass a
    // bare length assertion and make undo restore ancient content.
    expect(mine.map((r) => r.body)).toContain(`v${REVISION_DEPTH + 4}`);
    expect(mine.map((r) => r.body)).not.toContain('v0');
  });

  // Both paths write past REVISION_DEPTH here, deliberately -- with only two
  // quiet.json writes (well under the depth), pruning never engages for it
  // at all, and the test would pass whether or not the DELETE is scoped by
  // path. Both paths must actually get pruned, independently, for this to
  // exercise anything.
  it('prunes per path, so a busy file cannot evict a quiet one', async () => {
    for (let i = 0; i <= REVISION_DEPTH + 3; i += 1) {
      await store.write([file('src/content/quiet.json', `q${i}`)], 'x', `q${i}`);
    }
    for (let i = 0; i <= REVISION_DEPTH + 5; i += 1) {
      await store.write([file('src/content/busy.json', `b${i}`)], 'x', `b${i}`);
    }
    const quiet = fake.revisions.filter((r) => r.path === 'src/content/quiet.json');
    const busy = fake.revisions.filter((r) => r.path === 'src/content/busy.json');
    // Each path pruned to its own REVISION_DEPTH -- not to 0 (busy wiping
    // quiet's history) and not to more than 20 (quiet's DELETE never firing
    // because busy's writes are the ones triggering it).
    expect(quiet).toHaveLength(REVISION_DEPTH);
    expect(busy).toHaveLength(REVISION_DEPTH);
    expect(quiet.map((r) => r.body)).toContain(`q${REVISION_DEPTH + 2}`);
    expect(quiet.map((r) => r.body)).not.toContain('q0');
  });
});

describe('undo', () => {
  it('puts back exactly the group one publish wrote', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    await store.write([file('src/content/awards.json', 'v2')], 'second', 'p2');
    expect(await store.undo('p2')).toEqual(['src/content/awards.json']);
    expect((await store.read('src/content/awards.json'))!.content).toBe('v1');
  });

  // Task 6: worker/index.ts's handleUndo refuses a REPEAT undo of the same
  // publish with a 409, and it can only do that off this return value being
  // empty the second time. Without the consuming delete this pins, the
  // SELECT this method runs would find the exact same revision rows again --
  // restoring them changes nothing about their own existence in `revisions`
  // -- and a second call would silently restore the same group a second
  // time rather than reporting nothing left to undo.
  it('consumes the group it restores, so a second undo of the same publish finds nothing left', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    await store.write([file('src/content/awards.json', 'v2')], 'second', 'p2');
    expect(await store.undo('p2')).toEqual(['src/content/awards.json']);
    expect(await store.undo('p2')).toEqual([]);
    // And the content stays at what the first undo restored -- a second,
    // silently-applied restore would still show 'v1' here even if it were
    // wrongly allowed to run, so this alone would not catch the bug; paired
    // with the empty-array assertion above it confirms both that nothing
    // ran a second time AND that nothing was corrupted by trying.
    expect((await store.read('src/content/awards.json'))!.content).toBe('v1');
  });

  // `results.map(...)` on an empty array is `[]` regardless, so asserting
  // only the return value here cannot tell "undo returned early" from "undo
  // ran write([]) and that happened to produce the same answer" -- write([])
  // is a no-op that also returns []. batchCalls is the observable that
  // actually distinguishes them: the early return in `undo` skips `write`
  // entirely, so `batch` is never invoked; without it, `write([])` still
  // calls `this.db.batch([])` once.
  it('reports nothing restored for a publish id with no revisions, without touching write at all', async () => {
    expect(await store.undo('never-happened')).toEqual([]);
    expect(fake.batchCalls, 'undo called write/batch for a publish with no revisions').toBe(0);
  });

  it('is itself revisioned, so the state before the undo is not lost', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    await store.write([file('src/content/awards.json', 'v2')], 'second', 'p2');
    await store.undo('p2');
    expect(fake.revisions.some((r) => r.publish_id === 'undo:p2' && r.body === 'v2')).toBe(true);
  });

  // The distinction the schema comment on `revisions.publish_id` calls
  // load-bearing: "the newest revision of each path" and "the group one
  // publish_id wrote" agree whenever no path gets written a second time
  // before the undo -- which is all the tests above ever exercise, since
  // each of them writes a given path at most twice total. They diverge
  // exactly when a path is written by publish A, then written AGAIN by a
  // later publish B that doesn't touch every path A did, and someone then
  // undoes A. "By publish_id" restores A's whole group to A's own prior
  // values. "Newest revision per path" would instead, for any path A and B
  // share, reach for the newest row on that path -- the one B's write
  // created, holding B's prior (== A's result), not A's prior. That is the
  // "silently mixes two publishes together" the schema comment warns about:
  // undoing A would leave the shared path at A's OWN output instead of
  // reverting it.
  //
  // menu.json is included specifically because it is NOT shared with p2:
  // under either query it lands in the same place, which is exactly why a
  // test using only one path (as every test above does) cannot tell the two
  // queries apart. The assertion that actually distinguishes them is on
  // awards.json.
  it('restores the group one publish wrote, not "the newest revision of every path it touched"', async () => {
    // Establish priors for both paths, so p1's write below creates revision
    // rows at all (a path's first-ever write has no prior and revisions
    // this store).
    await store.write(
      [file('src/content/awards.json', 'awards-v0'), file('src/content/menu.json', 'menu-v0')],
      'baseline',
      'p0',
    );
    // p1 touches both paths together.
    await store.write(
      [file('src/content/awards.json', 'awards-v1'), file('src/content/menu.json', 'menu-v1')],
      'first',
      'p1',
    );
    // p2 touches only awards.json -- menu.json is untouched from here on.
    await store.write([file('src/content/awards.json', 'awards-v2')], 'second', 'p2');

    expect(await store.undo('p1')).toEqual(
      expect.arrayContaining(['src/content/awards.json', 'src/content/menu.json']),
    );
    // The path p1 and p2 both wrote: undoing p1 must land on p1's OWN prior
    // (v0), not p2's prior (v1, which is a "newest per path" read of the
    // same row p2's write produced).
    expect((await store.read('src/content/awards.json'))!.content).toBe('awards-v0');
    // The path only p1 wrote: both queries happen to agree here, which is
    // exactly why this path alone could never have caught the bug.
    expect((await store.read('src/content/menu.json'))!.content).toBe('menu-v0');
  });
});
