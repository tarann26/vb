// The public read for posts, Phase 5B. GET /api/published?path=posts.json.
//
// Split out of the components for the reason awards-api.ts and story-api.ts
// already are: eslint's react-refresh/only-export-components flags a .tsx
// that exports both a component and plain values.
//
// THE SHAPE CHECK IS THE REAL GUARD, not a hand-rolled copy of it. This body
// arrives from a database with no build-time guard in front of it, and
// assertPosts (src/content/guards.ts) is exactly the check the BUILD already
// trusts for the same document -- including the card image's own
// site-relative-path check, every block's `src` and every citation's `url`.
// story-api.ts re-implemented isUnsafeAssetPath by hand because
// src/content/validate.ts is the Worker's module and does not export it;
// guards.ts has no such problem, it holds no React, and src/content/index.ts
// already pulls it into this bundle. Reusing it means there is one answer to
// "what is a valid post", not two that can drift.
//
// It THROWS, so it is wrapped: a refused body returns null, meaning "keep
// whatever you already have", which is the same posture fetchStory takes and
// for the same reason -- a malformed award is one missing card, and a
// malformed post list is the whole blog.
import { assertPosts } from '../../content/guards';
import type { Post } from '../../content/types';

export const POSTS_ENDPOINT = '/api/published?path=posts.json';

// `fetchImpl` is injected with a default, the same posture fetchAwards,
// fetchStory and requestPublish already take -- what lets a test hand this a
// fake without stubbing the global.
export async function fetchPosts(fetchImpl: typeof fetch = fetch): Promise<Post[] | null> {
  const response = await fetchImpl(POSTS_ENDPOINT);
  if (!response.ok) throw new Error(`the blog is unavailable (status ${response.status})`);
  const parsed: unknown = await response.json();
  try {
    return assertPosts(parsed);
  } catch {
    // Deliberately swallowed rather than rethrown, and the distinction
    // matters to the caller: a non-2xx above is an OUTAGE, which a reader
    // could retry; a body this guard refuses is bad DATA, which retrying
    // cannot fix. `null` is what tells usePosts to settle rather than to
    // report a problem.
    return null;
  }
}
