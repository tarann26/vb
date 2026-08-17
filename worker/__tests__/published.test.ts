import { describe, expect, it } from 'vitest';
import { CONTENT_SOURCE_HEADER, PUBLIC_FILES, handlePublished, type PublishedEnv } from '../published';
import { D1Store, sha256Hex } from '../d1';
import { snapshotFor } from '../snapshot';
import { asD1, FakeD1 } from './fakeD1';

// The real compiled snapshot's body, not a hardcoded '[]' -- worker/snapshot.ts
// (Task 8) compiles real content rather than an empty list (the seed
// placeholder pre-Task-12; the live database's own content from Task 12
// onward), so these two assertions read the same value the module under test
// actually returns instead of pinning stale content by hand.
const SNAPSHOT_BODY = snapshotFor('awards.json')!;
const SNAPSHOT_STORY_BODY = snapshotFor('story.json')!;

// A Map keyed on the cache key's URL, in the same spirit as fakeD1.ts: real
// enough to prove the caching behaviour handlePublished depends on (a miss
// populates it, a hit short-circuits D1, a new key from a version bump is a
// miss again) without pulling in workerd's actual Cache API, which has no
// runtime shape in this repo's jsdom test environment.
class FakeCache {
  store = new Map<string, Response>();
  deleteCalls: string[] = [];

  async match(key: Request): Promise<Response | undefined> {
    const hit = this.store.get(key.url);
    return hit ? hit.clone() : undefined;
  }

  async put(key: Request, response: Response): Promise<void> {
    this.store.set(key.url, response.clone());
  }

  async delete(key: Request): Promise<boolean> {
    this.deleteCalls.push(key.url);
    return this.store.delete(key.url);
  }
}

const PATH = 'src/content/awards.json';
const STORY_PATH = 'src/content/story.json';
const POSTS_PATH = 'src/content/posts.json';

function cache(): FakeCache {
  return new FakeCache();
}

function env(fake: FakeD1): PublishedEnv {
  return { DB: asD1(fake) };
}

function publish(fake: FakeD1, content: string, publishId: string): Promise<{ sha: null }> {
  return new D1Store(asD1(fake)).write([{ path: PATH, content, encoding: 'utf-8' as const }], 'seed', publishId);
}

function publishStory(fake: FakeD1, content: string, publishId: string): Promise<{ sha: null }> {
  return new D1Store(asD1(fake)).write([{ path: STORY_PATH, content, encoding: 'utf-8' as const }], 'seed', publishId);
}

function publishPosts(fake: FakeD1, content: string, publishId: string): Promise<{ sha: null }> {
  return new D1Store(asD1(fake)).write([{ path: POSTS_PATH, content, encoding: 'utf-8' as const }], 'seed', publishId);
}

function req(query = 'path=awards.json'): Request {
  return new Request(`https://vb.aionxxxi.uk/api/published?${query}`);
}

describe('GET /api/published', () => {
  it('serves from D1 on a miss and labels the source', async () => {
    const fake = new FakeD1();
    await publish(fake, '[{"id":"a"}]', 'p1');

    const response = await handlePublished(req(), env(fake), cache() as unknown as Cache);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('[{"id":"a"}]');
    expect(response.headers.get(CONTENT_SOURCE_HEADER)).toBe('d1');
    // ETag is the D1 store's own sha (a SHA-256 of the body, not a made-up
    // value) -- pinned here because nothing else in this suite checks it.
    // The snapshot branch never sets one at all (its `sha` argument to
    // `body()` is `null`); see hardening.test.ts's own comment on that.
    expect(response.headers.get('ETag')).toBe(`"${await sha256Hex('[{"id":"a"}]')}"`);
  });

  it('serves from the cache on the second identical request', async () => {
    const fake = new FakeD1();
    await publish(fake, '[{"id":"a"}]', 'p1');
    const c = cache();
    const e = env(fake);

    await handlePublished(req(), e, c as unknown as Cache);
    // Reset AFTER the seeding write and the first (miss) read, so what
    // remains below reflects only the second request.
    fake.statements = [];

    const second = await handlePublished(req(), e, c as unknown as Cache);

    expect(second.headers.get(CONTENT_SOURCE_HEADER)).toBe('cache');
    expect(await second.text()).toBe('[{"id":"a"}]');
    // Only the version read happened -- the body was never re-read from D1.
    expect(fake.statements).toEqual(['SELECT version FROM content WHERE path = ?']);
  });

  // The spec asks for this one by name: "publishes, then reads, and asserts
  // the new value, not the cached one."
  it('serves the new value after a publish, with no purge call anywhere', async () => {
    const fake = new FakeD1();
    await publish(fake, '[{"id":"a"}]', 'p1');
    const c = cache();
    const e = env(fake);

    const first = await handlePublished(req(), e, c as unknown as Cache);
    expect(first.headers.get(CONTENT_SOURCE_HEADER)).toBe('d1');

    const stillCached = await handlePublished(req(), e, c as unknown as Cache);
    expect(stillCached.headers.get(CONTENT_SOURCE_HEADER)).toBe('cache');

    // A publish: version 1 -> 2.
    await publish(fake, '[{"id":"b"}]', 'p2');

    const afterPublish = await handlePublished(req(), e, c as unknown as Cache);
    expect(afterPublish.headers.get(CONTENT_SOURCE_HEADER)).toBe('d1');
    expect(await afterPublish.text()).toBe('[{"id":"b"}]');
    expect(c.deleteCalls).toEqual([]);
  });

  // Also asked for by name: "forces a query failure and asserts the snapshot
  // fallback serves." An always-on `failWith` rejects the VERY FIRST query
  // handlePublished makes (`store.version`), so this exercises that
  // fallback specifically, not the separate one guarding `store.read` below.
  it('falls back to the compiled snapshot when the version read fails', async () => {
    const fake = new FakeD1();
    fake.failWith = 'D1_ERROR: no such table: content';

    const response = await handlePublished(req(), env(fake), cache() as unknown as Cache);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SNAPSHOT_BODY);
    expect(response.headers.get(CONTENT_SOURCE_HEADER)).toBe('snapshot');
  });

  // handlePublished has a SECOND, independent try/catch: a cache miss whose
  // body read (`store.read`) fails, after the version read that built the
  // cache key already succeeded. A blanket `failWith` alone can never reach
  // this -- version is always checked first -- so `failAfter` (fakeD1.ts)
  // lets the version read through once and fails the read that follows it.
  it('falls back to the compiled snapshot when the body read fails after a successful version read', async () => {
    const fake = new FakeD1();
    await publish(fake, '[{"id":"a"}]', 'p1');
    fake.failAfter = 1;
    fake.failWith = 'D1_ERROR: database is locked';

    const response = await handlePublished(req(), env(fake), cache() as unknown as Cache);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SNAPSHOT_BODY);
    expect(response.headers.get(CONTENT_SOURCE_HEADER)).toBe('snapshot');
  });

  // Phase 4: story.json is the second D1-only path, and the second one this
  // endpoint has to serve. The fixture body below is deliberately NOT
  // src/content/story.json's real committed text -- a fixture identical to
  // production content cannot distinguish "this route actually reads D1"
  // from "this route happens to return the right bytes some other way", the
  // exact trap an earlier task in this phase fell into.
  it('serves story.json from D1, not just awards.json', async () => {
    const fake = new FakeD1();
    await publishStory(fake, '{"heading":"Distinct Test Heading, Not Production Copy","paragraphs":["one"]}', 'p1');

    const response = await handlePublished(req('path=story.json'), env(fake), cache() as unknown as Cache);

    expect(response.status).toBe(200);
    expect(response.headers.get(CONTENT_SOURCE_HEADER)).toBe('d1');
    expect(await response.text()).toBe('{"heading":"Distinct Test Heading, Not Production Copy","paragraphs":["one"]}');
  });

  // The spec's own testing requirement for this task, named directly: force
  // a query failure and assert the snapshot serves. A database problem must
  // cost freshness, never availability -- and About is now the section
  // whose entire body is on the other side of this call, unlike awards.json
  // which sits beside chrome that renders fine without it.
  //
  // `toBe(SNAPSHOT_STORY_BODY)`, not `toMatchObject({ heading:
  // expect.any(String) })` -- the awards fallback tests above already use
  // the strict form, and the loose one here passed even when
  // `snapshotFor('story.json')` returned `{"heading":"WRONG BODY"}` with no
  // `paragraphs` or `chef` at all, because `expect.any(String)` only checks
  // that SOME string sits at `heading`. About's entire visible body is on
  // the other side of this fallback, so the weakest assertion in the suite
  // was guarding its largest payload.
  it('falls back to the snapshot when the D1 version read throws for story.json', async () => {
    const fake = new FakeD1();
    fake.failWith = 'D1_ERROR: no such table: content';

    const response = await handlePublished(req('path=story.json'), env(fake), cache() as unknown as Cache);

    expect(response.status).toBe(200);
    expect(response.headers.get(CONTENT_SOURCE_HEADER)).toBe('snapshot');
    expect(await response.text()).toBe(SNAPSHOT_STORY_BODY);
  });

  // Phase 5B: the third document this endpoint serves, and the one two whole
  // public routes read at runtime. The fixture body is deliberately NOT
  // src/content/posts.json's committed text -- a fixture identical to
  // production content cannot distinguish "this route actually reads D1" from
  // "this route happens to return the right bytes some other way".
  it('serves posts.json from D1, which is what makes a publish visible in seconds', async () => {
    const fake = new FakeD1();
    await publishPosts(fake, '[{"id":"from-d1","slug":"a-post-only-in-the-database"}]', 'p1');

    const response = await handlePublished(req('path=posts.json'), env(fake), cache() as unknown as Cache);

    expect(response.status).toBe(200);
    expect(response.headers.get(CONTENT_SOURCE_HEADER)).toBe('d1');
    expect(await response.text()).toBe('[{"id":"from-d1","slug":"a-post-only-in-the-database"}]');
  });

  // The allowlist's exact membership, positive AND negative, pinned the way
  // worker/__tests__/store.test.ts pins D1_ONLY_PATHS's -- because this map is
  // the whole of what makes a D1 document public, and both directions matter:
  // a document missing from it is a dead read path in production, and a
  // document added to it by accident is a private file served to the world.
  it('publishes exactly the three public documents, under names that do not leak the repo layout', () => {
    expect([...PUBLIC_FILES.keys()].sort()).toEqual(['awards.json', 'posts.json', 'story.json']);
    expect(PUBLIC_FILES.get('posts.json')).toBe(POSTS_PATH);
    expect(PUBLIC_FILES.has('src/content/posts.json')).toBe(false);
    expect(PUBLIC_FILES.has('dishes.json')).toBe(false);
  });

  it('404s an unknown or non-public path rather than reading anything', async () => {
    const fake = new FakeD1();
    const e = env(fake);
    const c = cache();

    const unknown = await handlePublished(req('path=dishes.json'), e, c as unknown as Cache);
    expect(unknown.status).toBe(404);

    const traversal = await handlePublished(
      req(`path=${encodeURIComponent('../../etc/passwd')}`),
      e,
      c as unknown as Cache,
    );
    expect(traversal.status).toBe(404);

    expect(fake.statements).toEqual([]);
  });
});
