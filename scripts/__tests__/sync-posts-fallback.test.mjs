import { describe, expect, it } from 'vitest';
import { postsFileFromRow } from '../sync-posts-fallback.mjs';

const VALID = [
  {
    id: 'from-d1',
    slug: 'a-post-only-in-the-database',
    type: 'story',
    title: 'A post only in the database',
    date: '2026-05-06',
    excerpt: 'A database excerpt.',
    image: '/press/hotelier.webp',
    blocks: [{ kind: 'paragraph', text: 'A database paragraph.' }],
  },
];

describe('postsFileFromRow', () => {
  it('writes the row, reformatted, with a trailing newline', async () => {
    const out = await postsFileFromRow({ body: JSON.stringify(VALID) });
    expect(out).toBe(`${JSON.stringify(VALID, null, 2)}\n`);
    expect(JSON.parse(out)[0].slug).toBe('a-post-only-in-the-database');
  });

  it.each([
    ['no row at all', undefined],
    ['a row with no body', {}],
    ['a body that is not a string', { body: 42 }],
  ])('refuses %s', async (_name, row) => {
    await expect(postsFileFromRow(row)).rejects.toThrow(/refusing to write an empty fallback/);
  });

  // Every one of these would break `tsc -b` at import time if it were
  // written, blocking the deploy that would fix it. The messages come from
  // assertPosts, which is the same guard the build applies -- so there is one
  // definition of a valid post, not two that can drift.
  it.each([
    ['a body that is not a list', { posts: [] }],
    ['a post with no title', [{ ...VALID[0], title: '' }]],
    ['an off-site card image', [{ ...VALID[0], image: 'https://evil.example/x.webp' }]],
    ['a backslash card image', [{ ...VALID[0], image: '/\\evil.example/x.webp' }]],
    ['an unknown block kind', [{ ...VALID[0], blocks: [{ kind: 'video', src: '/x.mp4' }] }]],
    ['a duplicate slug', [VALID[0], { ...VALID[0], id: 'other' }]],
  ])('refuses %s', async (_name, body) => {
    await expect(postsFileFromRow({ body: JSON.stringify(body) })).rejects.toThrow();
  });

  it('refuses a body that is not JSON at all', async () => {
    await expect(postsFileFromRow({ body: 'not json' })).rejects.toThrow();
  });

  // Pinning the negative: the row above has to be one the guard genuinely
  // ACCEPTS, or every refusal case here would be satisfied by a function that
  // throws unconditionally. The first case proves acceptance by its return
  // value; this proves the refusals are not free.
  it('does not simply refuse everything', async () => {
    await expect(postsFileFromRow({ body: JSON.stringify([]) })).resolves.toBe('[]\n');
  });
});
