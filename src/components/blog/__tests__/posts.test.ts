import { describe, expect, it } from 'vitest';
import { POSTS_PER_PAGE, POST_TYPE_LABELS, pageCount, pageOf, postBySlug, sortedPosts } from '../posts';
import type { Post } from '../../../content/types';

// Fixtures that appear nowhere in src/content/posts.json -- see the Global
// Constraints note on fixtures equal to real content.
function post(slug: string, date: string): Post {
  return {
    id: `id-${slug}`,
    slug,
    type: 'story',
    title: `Title ${slug}`,
    date,
    excerpt: 'An excerpt.',
    image: '/food/tielle.webp',
    blocks: [{ kind: 'paragraph', text: 'Body.' }],
  };
}

const OUT_OF_ORDER: Post[] = [post('middle', '2026-02-01'), post('oldest', '2025-12-31'), post('newest', '2026-03-15')];

describe('sortedPosts', () => {
  it('puts the newest first regardless of the order in the file', () => {
    expect(sortedPosts(OUT_OF_ORDER).map((p) => p.slug)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('does not mutate the array it was given', () => {
    const input = [...OUT_OF_ORDER];
    sortedPosts(input);
    expect(input.map((p) => p.slug)).toEqual(['middle', 'oldest', 'newest']);
  });

  it('keeps file order between two posts sharing a date', () => {
    const same = [post('a', '2026-01-01'), post('b', '2026-01-01')];
    expect(sortedPosts(same).map((p) => p.slug)).toEqual(['a', 'b']);
  });
});

describe('postBySlug', () => {
  it('finds a post by its slug', () => {
    expect(postBySlug(OUT_OF_ORDER, 'middle')?.title).toBe('Title middle');
  });

  it.each([['a slug nothing matches', 'nope'], ['an undefined slug', undefined]])(
    'returns undefined for %s',
    (_name, slug) => {
      expect(postBySlug(OUT_OF_ORDER, slug)).toBeUndefined();
    },
  );
});

describe('pagination', () => {
  const many = Array.from({ length: 20 }, (_, i) => post(`p${i}`, `2026-01-${String(i + 1).padStart(2, '0')}`));

  it('pages at nine, which is three rows of three on a desktop grid', () => {
    expect(POSTS_PER_PAGE).toBe(9);
  });

  it('counts pages, rounding up', () => {
    expect(pageCount(many)).toBe(3);
    expect(pageCount(many.slice(0, 9))).toBe(1);
    // An empty blog is ONE page showing an empty state, not zero pages --
    // zero would make every page number out of range and the index
    // unreachable.
    expect(pageCount([])).toBe(1);
  });

  it('slices the requested page out of the SORTED list, not the raw one', () => {
    expect(pageOf(many, 1)[0].slug).toBe('p19');
    expect(pageOf(many, 3)).toHaveLength(2);
  });

  // Asserting only non-emptiness is too weak to catch a dropped clamp: for
  // this 20-item fixture, Array.prototype.slice's own negative-index
  // wraparound makes an UNCLAMPED page -1 resolve to (start=-18, end=-9),
  // which slices to a real, non-empty, nine-item range purely by
  // coincidence -- the wrong nine posts, but nine posts. Asserting equality
  // with the real page the number should clamp to is what a dropped clamp
  // cannot survive, for every one of these four cases including -1.
  it.each([[0], [-1]])('clamps a too-low page number (%i) to page 1', (page) => {
    expect(pageOf(many, page)).toEqual(pageOf(many, 1));
  });

  it.each([[4], [99]])('clamps a too-high page number (%i) to the last real page', (page) => {
    expect(pageOf(many, page)).toEqual(pageOf(many, pageCount(many)));
  });
});

describe('POST_TYPE_LABELS', () => {
  // A total record over PostType, pinned as a literal so a fourth type
  // cannot arrive without a label -- an unlabelled badge is a blank pill on
  // every card.
  it('names all three types in words a reader understands', () => {
    expect(POST_TYPE_LABELS).toEqual({ recipe: 'Recipe', story: 'Story', mention: 'In the press' });
  });
});
