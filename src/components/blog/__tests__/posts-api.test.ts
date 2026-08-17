import { describe, expect, it, vi } from 'vitest';
import { POSTS_ENDPOINT, fetchPosts } from '../posts-api';
import { posts as committed } from '../../../content';

// A fixture that differs from src/content/posts.json in every field asserted
// on, so this cannot pass by accidentally reading the committed copy.
const ROW = [
  {
    id: 'from-d1',
    slug: 'a-post-only-in-the-database',
    type: 'recipe',
    title: 'A post only in the database',
    date: '2026-05-06',
    excerpt: 'A database excerpt.',
    image: '/food/tielle.webp',
    blocks: [{ kind: 'paragraph', text: 'A database paragraph.' }],
  },
];

function respond(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('fetchPosts', () => {
  it('asks the published read path for posts.json', async () => {
    const impl = respond(ROW);
    await fetchPosts(impl);
    expect(impl).toHaveBeenCalledWith(POSTS_ENDPOINT);
    // Pinned as a literal rather than read off the value under test: an
    // expectation computed by the code under test proves nothing (Phase 4's
    // thirteenth unfalsifiable test). This is also the exact string
    // worker/published.ts's PUBLIC_FILES key has to answer for.
    expect(POSTS_ENDPOINT).toBe('/api/published?path=posts.json');
  });

  it('returns the posts the database holds', async () => {
    const got = await fetchPosts(respond(ROW));
    expect(got?.map((post) => post.slug)).toEqual(['a-post-only-in-the-database']);
    // Not the committed list. Phase 4's root cause was a fixture equal to the
    // real content, which cannot distinguish a real binding from a copy.
    expect(got?.map((post) => post.slug)).not.toEqual(committed.map((post) => post.slug));
  });

  it('throws on a non-2xx, so a caller can tell an outage from an empty blog', async () => {
    await expect(fetchPosts(respond({}, false))).rejects.toThrow(/status 503/);
  });

  // The security half, and it is the reason this runs the REAL guard rather
  // than a hand-rolled shape check. This body arrives from a database with no
  // build-time guard in front of it, and every one of these would otherwise
  // reach a live <img src> or an <a href>.
  it.each([
    ['a body that is not a list', { posts: [] }],
    ['a post with no blocks', [{ ...ROW[0], blocks: undefined }]],
    ['an unknown block kind', [{ ...ROW[0], blocks: [{ kind: 'video', src: '/x.mp4' }] }]],
    ['an off-site card image', [{ ...ROW[0], image: 'https://evil.example/x.webp' }]],
    ['a backslash card image', [{ ...ROW[0], image: '/\\evil.example/x.webp' }]],
    ['an off-site block photo', [{ ...ROW[0], blocks: [{ kind: 'image', src: '//evil.example/x.webp', alt: 'a' }] }]],
    [
      'a citation link that is not a link',
      [{ ...ROW[0], blocks: [{ kind: 'citation', publication: 'X', url: 'javascript:alert(1)', date: '2026-01-01' }] }],
    ],
    ['two posts sharing a slug', [ROW[0], { ...ROW[0], id: 'other' }]],
  ])('returns null for %s -- keep whatever you already have', async (_name, body) => {
    expect(await fetchPosts(respond(body))).toBeNull();
  });

  it('accepts an empty list, because a restaurant with no posts is not an error', async () => {
    expect(await fetchPosts(respond([]))).toEqual([]);
  });
});
