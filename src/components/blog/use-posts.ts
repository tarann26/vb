// The blog's runtime read, in one place, so /blog and /blog/:slug cannot
// disagree about what the current posts are.
//
// FALLBACK-THEN-SWAP, Phase 4's shape: the compiled-in copy paints first --
// it is what a crawler, a reader with JS off and every first paint see -- and
// the database copy replaces it when it arrives. `status` is what the callers
// that need to tell "not here" from "not here YET" branch on, and it exists
// because a post published after the last deploy is genuinely absent from the
// compiled-in list. story.json never had that problem: it always had content.
import { useEffect, useState } from 'react';
import { useContent } from '../../content/ContentContext';
import { fetchPosts } from './posts-api';
import type { Post } from '../../content/types';

export interface PostsState {
  // 'loading' while the fetch is in flight -- so a slug missing from `posts`
  // is "not here YET", never "not here". 'error' means the read failed and
  // `posts` is the compiled-in copy: a database problem costs freshness,
  // never availability. 'loaded' means this is the current answer, whether it
  // came from the database or -- when the body was refused -- from the
  // compiled-in copy, because neither is going to change by waiting.
  status: 'loading' | 'loaded' | 'error';
  // Never empty while the committed file has content, at any status. A
  // caller that reads this can always render something.
  posts: Post[];
}

export function usePosts(fetchImpl: typeof fetch = fetch): PostsState {
  const { posts: committed } = useContent();
  const [state, setState] = useState<PostsState>({ status: 'loading', posts: committed });

  useEffect(() => {
    let cancelled = false;
    fetchPosts(fetchImpl)
      .then((fetched) => {
        if (cancelled) return;
        setState({ status: 'loaded', posts: fetched ?? committed });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error', posts: committed });
      });
    return () => {
      cancelled = true;
    };
    // `committed` is the compiled-in array and is referentially stable for
    // the life of the bundle, so it is not a real dependency; listing it
    // would re-run this on every ContentProvider re-render, which /edit does
    // on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchImpl]);

  return state;
}
