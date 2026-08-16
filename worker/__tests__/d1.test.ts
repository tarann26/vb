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

  it('prunes per path, so a busy file cannot evict a quiet one', async () => {
    await store.write([file('src/content/quiet.json', 'q1')], 'x', 'q');
    await store.write([file('src/content/quiet.json', 'q2')], 'x', 'q2');
    for (let i = 0; i <= REVISION_DEPTH + 5; i += 1) {
      await store.write([file('src/content/busy.json', `b${i}`)], 'x', `b${i}`);
    }
    expect(fake.revisions.filter((r) => r.path === 'src/content/quiet.json')).toHaveLength(1);
  });
});

describe('undo', () => {
  it('puts back exactly the group one publish wrote', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    await store.write([file('src/content/awards.json', 'v2')], 'second', 'p2');
    expect(await store.undo('p2')).toEqual(['src/content/awards.json']);
    expect((await store.read('src/content/awards.json'))!.content).toBe('v1');
  });

  it('reports nothing restored for a publish id with no revisions', async () => {
    expect(await store.undo('never-happened')).toEqual([]);
  });

  it('is itself revisioned, so the state before the undo is not lost', async () => {
    await store.write([file('src/content/awards.json', 'v1')], 'first', 'p1');
    await store.write([file('src/content/awards.json', 'v2')], 'second', 'p2');
    await store.undo('p2');
    expect(fake.revisions.some((r) => r.publish_id === 'undo:p2' && r.body === 'v2')).toBe(true);
  });
});
