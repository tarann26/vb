// Phase 5. The list operations every blog surface shares, in a plain .ts
// module rather than inside a component: eslint's
// react-refresh/only-export-components flags a .tsx that exports both a
// component and plain values, the same split src/components/awards-api.ts
// already made for the same rule.
import type { Post, PostType } from '../../content/types';

// Nine, not ten: the index grid is `md:grid-cols-2 lg:grid-cols-3`
// (BlogIndex.tsx, Task 8 -- review fix: this comment said `sm:grid-cols-2`,
// which is a real, differently-costed utility that BlogIndex does not
// actually use), so nine fills three complete rows on a desktop and leaves
// no orphan card. The old /blogs page used ten against a three-across grid,
// which is why its last row always had one card sitting alone.
export const POSTS_PER_PAGE = 9;

// Fix round 1, Finding 1: BlogSection's own header comment used to claim its
// empty state matched BlogIndex's "word for word" -- true when written, and
// unguarded: nothing compared the two strings, and both surfaces' own tests
// only assert a loose regex (`/on its way/i`, `/nothing here yet/i`), so a
// silent re-wording of either one stayed green. One exported constant, both
// components importing it, makes "the two surfaces do not describe one
// situation two ways" a property of the code rather than a claim about it --
// there is no longer a second string for either to drift from.
export const EMPTY_POSTS_MESSAGE = 'Nothing here yet — the first post is on its way.';

// A total Record over PostType, so a fourth type is a `tsc -b` failure here
// rather than a blank badge on every one of its cards.
export const POST_TYPE_LABELS: Record<PostType, string> = {
  recipe: 'Recipe',
  story: 'Story',
  mention: 'In the press',
};

// The controls above the list on /blog. `all` is NOT a PostType and must
// never become one: it is the absence of a filter, and POST_TYPE_LABELS
// stays total over the three real kinds so a fourth kind is still a
// `tsc -b` failure at the card badge rather than a blank pill.
export type PostFilter = PostType | 'all';
export type PostOrder = 'newest' | 'oldest';

export const POST_FILTERS: readonly PostFilter[] = ['all', 'recipe', 'story', 'mention'];
export const ALL_FILTER_LABEL = 'All';

// The filter row and the card badge read ONE table for the three real
// kinds. A control reading "Press mentions" beside a card badged "In the
// press" is two vocabularies for one idea; deriving the label rather than
// retyping it makes that impossible instead of merely currently-true.
export function filterLabel(filter: PostFilter): string {
  return filter === 'all' ? ALL_FILTER_LABEL : POST_TYPE_LABELS[filter];
}

// Deliberately NOT EMPTY_POSTS_MESSAGE. "the first post is on its way" is
// true of a blog with no posts and false of a blog with three posts and a
// filter that matches none of them -- and with today's committed content
// (three Mentions, pinned by src/content/__tests__/shape.test.ts:367-379)
// the Recipe and Story filters land here on the very first click.
export const NO_MATCHING_POSTS_MESSAGE = 'No stories match that — try another kind, or a different word.';

// Newest first, and STABLE within a date: Array.prototype.sort has been
// required to be stable since ES2019, so two posts published the same day
// keep the order she put them in. `[...posts]` because sort mutates, and
// this function is handed the live content array.
export function sortedPosts(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function filterByType(posts: Post[], filter: PostFilter): Post[] {
  return filter === 'all' ? posts : posts.filter((post) => post.type === filter);
}

// Titles and excerpts, case-insensitive, over what is already in memory.
// No endpoint: use-posts.ts keeps the compiled-in list on `error`, so this
// keeps working with the database down. The empty-query early return is not
// an optimisation -- `''.includes('')` is true for every post, so the
// filtered branch would return the same CONTENTS -- it returns the same
// ARRAY, which is the only observable difference and is what posts.test.ts
// asserts.
export function searchPosts(posts: Post[], query: string): Post[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return posts;
  return posts.filter(
    (post) => post.title.toLowerCase().includes(needle) || post.excerpt.toLowerCase().includes(needle),
  );
}

// Oldest-first is its own ascending sort, NOT sortedPosts().reverse():
// reversing a stable descending sort also reverses the file order of two
// posts sharing a date, so one pair would read one way newest-first and the
// other way oldest-first for no reason a reader could name.
export function orderedPosts(posts: Post[], order: PostOrder): Post[] {
  if (order === 'newest') return sortedPosts(posts);
  return [...posts].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
}

export function visiblePosts(posts: Post[], filter: PostFilter, query: string, order: PostOrder): Post[] {
  return orderedPosts(searchPosts(filterByType(posts, filter), query), order);
}

export function postBySlug(posts: Post[], slug: string | undefined): Post | undefined {
  if (!slug) return undefined;
  return posts.find((post) => post.slug === slug);
}

// One page, always, even with no posts: zero pages would put every page
// number out of range and make the index unreachable rather than empty.
export function pageCount(posts: Post[]): number {
  return Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
}

// Clamped rather than trusted. The page number reaches this from component
// state today and from a URL segment the moment anyone adds one, and an
// out-of-range slice returning [] renders as "no posts" -- which reads as a
// broken blog rather than as a bad page number.
//
// Takes an ALREADY-ordered list: /blog composes filter, search and sort
// before paging, and a function that re-sorted internally would silently
// throw the chosen order away on every page.
export function pageSlice(posts: Post[], page: number): Post[] {
  const clamped = Math.min(Math.max(1, Math.trunc(page)), pageCount(posts));
  const start = (clamped - 1) * POSTS_PER_PAGE;
  return posts.slice(start, start + POSTS_PER_PAGE);
}
