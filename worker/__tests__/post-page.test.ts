import { describe, expect, it } from 'vitest';
import { POSTS_PATH, lookupPost } from '../post-lookup';
import { snapshotFor } from '../snapshot';
import { asD1, FakeD1 } from './fakeD1';

// The snapshot's own posts, read from the compiled module rather than
// hardcoded here -- the same posture worker/__tests__/published.test.ts takes
// for awards.json and story.json, and for the same reason: a hardcoded copy
// pins content that has already moved.
const SNAPSHOT_POSTS = JSON.parse(snapshotFor('posts.json')!) as { slug: string; title: string }[];
const SNAPSHOT_SLUG = SNAPSHOT_POSTS[0].slug;

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

function dbWith(body: string): D1Database {
  const fake = new FakeD1();
  fake.seed(POSTS_PATH, body);
  return asD1(fake);
}

describe('looking a post up', () => {
  it('finds a post that exists only in D1, and says where it came from', async () => {
    const found = await lookupPost(dbWith(D1_POSTS), 'live-only');
    expect(found?.post.title).toBe('A post that exists only in the database');
    expect(found?.source).toBe('d1');
  });

  it('returns null for a slug in neither store', async () => {
    expect(await lookupPost(dbWith(D1_POSTS), 'no-such-post')).toBeNull();
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

  it('falls back to the snapshot when the row is missing entirely', async () => {
    const found = await lookupPost(asD1(new FakeD1()), SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
  });

  // The guard is the boundary. A D1 body that assertPosts refuses is BAD
  // DATA arriving healthy, not an outage -- so it is treated exactly like a
  // failed read, and the snapshot answers.
  it('refuses a malformed D1 body and uses the snapshot instead', async () => {
    const found = await lookupPost(dbWith('[{"slug":"live-only"}]'), SNAPSHOT_SLUG);
    expect(found?.source).toBe('snapshot');
  });

  it('never returns a post whose image is blank, because the guard refuses it', async () => {
    const blank = JSON.stringify([{ ...JSON.parse(D1_POSTS)[0], image: '' }]);
    const found = await lookupPost(dbWith(blank), 'live-only');
    expect(found).toBeNull();
  });
});
