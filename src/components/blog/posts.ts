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

// A total Record over PostType, so a fourth type is a `tsc -b` failure here
// rather than a blank badge on every one of its cards.
export const POST_TYPE_LABELS: Record<PostType, string> = {
  recipe: 'Recipe',
  story: 'Story',
  mention: 'In the press',
};

// Newest first, and STABLE within a date: Array.prototype.sort has been
// required to be stable since ES2019, so two posts published the same day
// keep the order she put them in. `[...posts]` because sort mutates, and
// this function is handed the live content array.
export function sortedPosts(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
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
export function pageOf(posts: Post[], page: number): Post[] {
  const clamped = Math.min(Math.max(1, Math.trunc(page)), pageCount(posts));
  const start = (clamped - 1) * POSTS_PER_PAGE;
  return sortedPosts(posts).slice(start, start + POSTS_PER_PAGE);
}
