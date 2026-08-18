import { describe, expect, it } from 'vitest';
import { POSTS_FILE, POSTS_PATH, lookupPost } from '../post-lookup';
import { snapshotFor } from '../snapshot';
import { asD1, FakeD1 } from './fakeD1';
import { D1Store } from '../d1';
import { PUBLIC_FILES } from '../published';
import { D1_ONLY_PATHS } from '../store';

// The snapshot's own posts, read from the compiled module rather than
// hardcoded here -- the same posture worker/__tests__/published.test.ts takes
// for awards.json and story.json, and for the same reason: a hardcoded copy
// pins content that has already moved.
const SNAPSHOT_POSTS = JSON.parse(snapshotFor('posts.json')!) as { slug: string; title: string }[];
const SNAPSHOT_SLUG = SNAPSHOT_POSTS[0].slug;
const SNAPSHOT_TITLE = SNAPSHOT_POSTS[0].title;

const D1_POSTS = JSON.stringify([
  {
    id: 'post-live',
    slug: 'live-only',
    type: 'story',
    title: 'A post that exists only in the database',
    date: '2026-08-12',
    excerpt: 'Published after the last deploy.',
    image: '/press/royale.webp',
    blocks: [],
  },
]);

// Review fix (F3). This used to be FakeD1.seed(), a direct row insert with a
// literal 'test-sha' and a version frozen at 1 -- a row shape D1Store.write
// can never actually produce (write always derives sha from sha256Hex(body)
// and advances version through its own ON CONFLICT guard). lookupPost only
// ever reads `.content`, so the divergence never falsified a test here, but
// it was a second definition of "what a content row is" sitting next to the
// real one, and the two would drift the moment a later task read `sha` or
// `version` off this path (an ETag, say). published.test.ts's own
// `publishPosts` already proves a real `D1Store.write` is enough to serve
// every shape this file needs, malformed and blank-image bodies included --
// `write` validates only encoding and `baseSha`, never content shape.
async function dbWith(body: string): Promise<D1Database> {
  const fake = new FakeD1();
  await new D1Store(asD1(fake)).write(
    [{ path: POSTS_PATH, content: body, encoding: 'utf-8' as const }],
    'seed',
    'p1',
  );
  return asD1(fake);
}

describe('looking a post up', () => {
  // Review fix (F1). Every other test in this file seeds at POSTS_PATH and
  // reads at POSTS_PATH, so they move together and none of them can catch
  // POSTS_PATH drifting from the path the rest of the Worker actually uses
  // for posts.json. Pinned here against two sources neither dbWith nor
  // lookupPost touches: PUBLIC_FILES (worker/published.ts -- what
  // /api/published maps the public "posts.json" name to) and D1_ONLY_PATHS
  // (worker/store.ts -- what the publish route treats as D1-backed).
  // Measured: setting POSTS_PATH to a typo'd path leaves every other test in
  // this file green (they all move with the constant) and reddens only this
  // one.
  it('POSTS_PATH is the same path PUBLIC_FILES and D1_ONLY_PATHS already use for posts.json', () => {
    expect(POSTS_PATH).toBe(PUBLIC_FILES.get(POSTS_FILE));
    expect(D1_ONLY_PATHS.has(POSTS_PATH)).toBe(true);
  });

  it('finds a post that exists only in D1, and says where it came from', async () => {
    const found = await lookupPost(await dbWith(D1_POSTS), 'live-only');
    expect(found?.post.title).toBe('A post that exists only in the database');
    expect(found?.source).toBe('d1');
  });

  it('returns null for a slug in neither store', async () => {
    expect(await lookupPost(await dbWith(D1_POSTS), 'no-such-post')).toBeNull();
  });

  // Decision D4. A database problem must cost freshness, never availability
  // -- the same sentence worker/published.ts already lives by. A 500 or a
  // manufactured 404 on a post URL is a de-indexing event.
  it('falls back to the compiled-in snapshot when the read throws', async () => {
    const throwing = asD1({
      prepare() {
        throw new Error('D1_ERROR: no such table');
      },
    } as unknown as FakeD1);
    const found = await lookupPost(throwing, SNAPSHOT_SLUG);
    expect(found?.post.slug).toBe(SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
  });

  // Review fix (F6). This used to assert only `source`, unlike the throwing
  // case just above -- a fallback that answered with the WRONG post would
  // still have passed. Now asserts the same two fields its sibling does.
  it('falls back to the snapshot when the row is missing entirely', async () => {
    const found = await lookupPost(asD1(new FakeD1()), SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
    expect(found?.post.slug).toBe(SNAPSHOT_SLUG);
  });

  // The guard is the boundary. A D1 body that assertPosts refuses is BAD
  // DATA arriving healthy, not an outage -- so it is treated exactly like a
  // failed read, and the snapshot answers.
  it('refuses a malformed D1 body and uses the snapshot instead', async () => {
    const found = await lookupPost(await dbWith('[{"slug":"live-only"}]'), SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
  });

  // Review fix (F4). The old version of this test asked for `null` on a slug
  // ('live-only') that is ALSO absent from the snapshot, so it passed for
  // two independent reasons at once -- the guard refusing the blank-image
  // body, AND the snapshot never having that slug -- and would have kept
  // passing, for the wrong reason, even with the guard removed, the moment
  // the snapshot happened to gain a 'live-only' post. This version asks for
  // a slug the snapshot DOES hold, so the only way to pass is for the guard
  // to have actually refused the blank-image D1 body and fallen back:
  // `source` proves the D1 row was rejected rather than served, and
  // `post.title` proves what came back is the real snapshot post, not the
  // blank-image one leaking through under a borrowed slug.
  it('refuses a D1 post with a blank image, and serves the snapshot post at that same slug instead', async () => {
    const blankImage = JSON.stringify([
      { ...JSON.parse(D1_POSTS)[0], slug: SNAPSHOT_SLUG, image: '' },
    ]);
    const found = await lookupPost(await dbWith(blankImage), SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
    expect(found?.post.title).toBe(SNAPSHOT_TITLE);
  });

  // Review fix (F2). assertPosts([]) succeeds -- an emptied blog is a legal
  // state (guards.ts's own comment says so) -- so a D1 body of "[]" reaches
  // `posts = []` through a HEALTHY read, never touches the fallback branch,
  // and every slug then resolves to null: this is the one shape in this
  // module that answers null for a reason that has nothing to do with D1
  // being unreachable. See post-lookup.ts's own comment on this branch for
  // why that is deliberate (Decision D5: the caller serves the Pages shell
  // unmodified at 200, not a 404) rather than a gap.
  it('an emptied posts.json resolves no slug, and does not resurrect one from the snapshot', async () => {
    const found = await lookupPost(await dbWith('[]'), SNAPSHOT_SLUG);
    expect(found).toBeNull();
  });
});
