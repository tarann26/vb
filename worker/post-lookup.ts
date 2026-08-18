// Phase 5C. Slug in, post out -- over D1, with the compiled-in snapshot as
// the fallback.
//
// DECISION D4, written down because the wrong answer here looks fine in
// every test that does not simulate an outage. When D1 is unreachable a
// crawler gets the SNAPSHOT, never a 500 and never a manufactured 404. A
// stale title costs one crawl's worth of freshness; a 5xx or a 404 on a post
// URL is a de-indexing event that takes weeks to undo. This is the same
// sentence worker/published.ts already lives by -- "a database problem must
// cost freshness, never availability" -- applied to the same document.
//
// The snapshot did not carry posts.json until this phase regenerated it
// (scripts/build-snapshot.mjs). Before that, snapshotFor('posts.json')
// returned null and the public read path answered 404 during an outage.
import { D1Store } from './d1';
import { snapshotFor } from './snapshot';
import { assertPosts } from '../src/content/guards';
import type { Post } from '../src/content/types';

// The PUBLIC filename (what snapshotFor is keyed on) and the repo-relative
// path (what the `content` table stores) -- the same two names
// worker/published.ts's PUBLIC_FILES maps between.
export const POSTS_FILE = 'posts.json';
export const POSTS_PATH = 'src/content/posts.json';

export type PostSource = 'd1' | 'snapshot';

export interface PostLookup {
  post: Post;
  source: PostSource;
}

// THE GUARD IS THE BOUNDARY, and it is the REAL one rather than a hand-rolled
// copy: assertPosts is exactly what src/content/index.ts applies to this same
// document at build time and what src/components/blog/posts-api.ts applies to
// the same D1 body in the browser. Three readers, one definition of "what is
// a valid post", so they cannot come to different conclusions -- and it is
// what makes worker/post-seo.ts's `${siteUrl}${post.image}` safe without a
// second check of its own (guards.ts requires a non-blank, site-relative
// image).
//
// A body it refuses is BAD DATA arriving with a healthy read, not an outage.
// Treated identically to a failed read here, because the caller's only
// sensible move is the same either way.
function parsePosts(body: string): Post[] | null {
  try {
    return assertPosts(JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

export async function lookupPost(db: D1Database, slug: string): Promise<PostLookup | null> {
  let posts: Post[] | null = null;
  try {
    const stored = await new D1Store(db).read(POSTS_PATH);
    posts = stored ? parsePosts(stored.content) : null;
  } catch {
    posts = null;
  }

  const source: PostSource = posts === null ? 'snapshot' : 'd1';
  if (posts === null) {
    const fallback = snapshotFor(POSTS_FILE);
    posts = fallback === null ? null : parsePosts(fallback);
  }
  if (posts === null) return null;

  const post = posts.find((candidate) => candidate.slug === slug);
  return post ? { post, source } : null;
}
