import { describe, expect, it } from 'vitest';
import {
  ALL_FILTER_LABEL,
  EMPTY_POSTS_MESSAGE,
  NO_MATCHING_POSTS_MESSAGE,
  POSTS_PER_PAGE,
  POST_FILTERS,
  POST_TYPE_LABELS,
  filterByType,
  filterLabel,
  orderedPosts,
  pageCount,
  pageSlice,
  postBySlug,
  searchPosts,
  sortedPosts,
  visiblePosts,
} from '../posts';
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

  it('slices the requested page out of the list it was handed', () => {
    // Handed an ordered list, it pages that order. `pageOf` used to sort
    // inside, which would have thrown away the order /blog's own controls
    // choose on every page after Task 29 split the two.
    const newestFirst = sortedPosts(many);
    expect(pageSlice(newestFirst, 1)[0].slug).toBe('p19');
    expect(pageSlice(newestFirst, 3)).toHaveLength(2);
    // And handed the raw file order, it pages THAT -- the same twenty posts,
    // the other way round, with no sort of its own applied to them.
    expect(pageSlice(many, 1)[0].slug).toBe('p0');
  });

  // Asserting only non-emptiness is too weak to catch a dropped clamp: for
  // this 20-item fixture, Array.prototype.slice's own negative-index
  // wraparound makes an UNCLAMPED page -1 resolve to (start=-18, end=-9),
  // which slices to a real, non-empty, nine-item range purely by
  // coincidence -- the wrong nine posts, but nine posts. Asserting equality
  // with the real page the number should clamp to is what a dropped clamp
  // cannot survive, for every one of these four cases including -1.
  it.each([[0], [-1]])('clamps a too-low page number (%i) to page 1', (page) => {
    expect(pageSlice(many, page)).toEqual(pageSlice(many, 1));
  });

  it.each([[4], [99]])('clamps a too-high page number (%i) to the last real page', (page) => {
    expect(pageSlice(many, page)).toEqual(pageSlice(many, pageCount(many)));
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

// Section C, Task 29. The three controls /blog is about to grow, as functions
// with no component around them: what she picks, what she types, and which
// way round the list reads. Nothing renders any of this yet -- Task 30 wires
// it up -- so what is pinned here is the behaviour, not a screen.
describe('the /blog controls', () => {
  const mixed: Post[] = [
    { ...post('r-new', '2026-03-01'), type: 'recipe', title: 'Lemon and caper spaghetti', excerpt: 'A weeknight plate.' },
    { ...post('s-mid', '2026-02-01'), type: 'story', title: 'The oven arrives', excerpt: 'Six men and a lemon tree.' },
    { ...post('m-old', '2026-01-01'), type: 'mention', title: 'A review', excerpt: 'Nothing citrus here.' },
  ];
  const slugs = (posts: Post[]): string[] => posts.map((p) => p.slug);

  it('offers All plus every kind the model carries, once each', () => {
    expect([...POST_FILTERS]).toEqual(['all', 'recipe', 'story', 'mention']);
    expect(new Set(POST_FILTERS).size).toBe(POST_FILTERS.length);
  });

  it("labels every filter that names a kind with that kind's own card badge", () => {
    for (const kind of ['recipe', 'story', 'mention'] as const) expect(filterLabel(kind)).toBe(POST_TYPE_LABELS[kind]);
    expect(filterLabel('all')).toBe(ALL_FILTER_LABEL);
  });

  it('keeps only the chosen kind, and everything under All', () => {
    expect(slugs(filterByType(mixed, 'recipe'))).toEqual(['r-new']);
    expect(slugs(filterByType(mixed, 'story'))).toEqual(['s-mid']);
    expect(slugs(filterByType(mixed, 'mention'))).toEqual(['m-old']);
    expect(filterByType(mixed, 'all')).toBe(mixed);
  });

  it('searches titles', () => {
    expect(slugs(searchPosts(mixed, 'spaghetti'))).toEqual(['r-new']);
  });

  it('searches excerpts too, on a word no title contains', () => {
    expect(slugs(searchPosts(mixed, 'six men'))).toEqual(['s-mid']);
  });

  it('ignores case and surrounding space', () => {
    expect(slugs(searchPosts(mixed, '  LEMON  '))).toEqual(['r-new', 's-mid']);
  });

  it('hands back the very same array for an empty query, not a copy of it', () => {
    // Referential, deliberately: `''.includes('')` is true for every post, so
    // a filtered branch would return the same CONTENTS and this is the only
    // assertion the early return can fail.
    expect(searchPosts(mixed, '')).toBe(mixed);
    expect(searchPosts(mixed, '   ')).toBe(mixed);
  });

  it('orders newest first and oldest first', () => {
    // Out of order to start with, so neither direction can pass by inheriting
    // the order of the fixture.
    const scrambled = [mixed[1], mixed[2], mixed[0]];
    expect(slugs(orderedPosts(scrambled, 'newest'))).toEqual(['r-new', 's-mid', 'm-old']);
    expect(slugs(orderedPosts(scrambled, 'oldest'))).toEqual(['m-old', 's-mid', 'r-new']);
    // Neither direction mutates what it was handed, which matters because the
    // live content array is what /blog passes in.
    expect(slugs(scrambled)).toEqual(['s-mid', 'm-old', 'r-new']);
  });

  it('keeps file order between two posts sharing a date in BOTH directions', () => {
    // This is what a reverse() implementation of oldest-first cannot do.
    const same = [post('a', '2026-01-01'), post('b', '2026-01-01')];
    expect(orderedPosts(same, 'newest').map((p) => p.slug)).toEqual(['a', 'b']);
    expect(orderedPosts(same, 'oldest').map((p) => p.slug)).toEqual(['a', 'b']);
  });

  it('composes: a kind and a word together', () => {
    expect(slugs(visiblePosts(mixed, 'recipe', 'lemon', 'newest'))).toEqual(['r-new']);
    // The same word, a different kind: the excerpt match rather than the
    // title one, which is how the filter and the search are shown to be two
    // separate steps and not one.
    expect(slugs(visiblePosts(mixed, 'story', 'lemon', 'newest'))).toEqual(['s-mid']);
    expect(visiblePosts(mixed, 'mention', 'lemon', 'newest')).toEqual([]);
  });

  it('applies the order AFTER the filter and the search', () => {
    expect(slugs(visiblePosts(mixed, 'all', 'lemon', 'oldest'))).toEqual(['s-mid', 'r-new']);
  });

  it('hands back a NEW array on first paint, and leaves the caller\'s alone', () => {
    // Task 30's own report left this open. With no filter and no query,
    // filterByType and searchPosts both return their input, so visiblePosts
    // hands /blog's live ContentContext array straight to orderedPosts -- and
    // it is only safe today because BOTH orderedPosts branches copy before
    // sorting. Nothing pinned that, so an "as-is" order or an early return
    // added to orderedPosts later would have /blog sorting the content store
    // in place, silently, with every other blog surface reading the result.
    // Each list is ALREADY in the order it is then asked for, which is the
    // only case where `not.toBe` can catch anything: on a scrambled list every
    // implementation has to build a new array to sort into, so the identity
    // assertion would pass on the bug as well as on the fix.
    // `as const` on the two order strings only, NOT on the array: a whole-array
    // `as const` makes each `live` a readonly tuple, which visiblePosts will
    // not take, and vitest would never have told me -- it does not typecheck.
    // `npx tsc -b --noEmit` did.
    const cases = [
      { order: 'newest' as const, live: [mixed[0], mixed[1], mixed[2]] },
      { order: 'oldest' as const, live: [mixed[2], mixed[1], mixed[0]] },
    ];
    for (const { order, live } of cases) {
      const before = slugs(live);
      const out = visiblePosts(live, 'all', '', order);
      expect(out, `${order} handed back the caller's own array`).not.toBe(live);
      expect(slugs(out), `${order} did not keep the order it was already in`).toEqual(before);
      expect(slugs(live), `${order} mutated the array it was given`).toEqual(before);
    }
  });

  it('says something different about an empty result than about an empty blog', () => {
    expect(NO_MATCHING_POSTS_MESSAGE).not.toBe(EMPTY_POSTS_MESSAGE);
  });
});
