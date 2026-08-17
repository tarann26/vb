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

// NO TIMEOUT AND NO AbortController, decided rather than overlooked, and
// written down here because the next person to read this will wonder.
//
// A response that HANGS -- open, silent, never settling -- leaves "Loading
// this post…" on screen without a bound. That is real, and it is the only
// visitor-facing state here with no end. It was still left alone:
//
//   - The blast radius is a URL that does not exist. A post in the
//     compiled-in list never reaches the loading branch at all (PostPage
//     checks `post` before `status`), and a post only in the database gets
//     its content the moment the read lands. What a hang actually costs is a
//     bogus /blog/<slug> its not-found screen -- a wrong screen on a URL
//     that has nothing to show anyway.
//   - A timeout trades that for something worse in the direction that
//     matters. Firing on a slow connection turns a REAL post into a false
//     not-found, which is precisely the defect this whole module exists to
//     prevent, reintroduced from the other side. There is no interval that
//     is right for both a congested mobile connection in Delhi and a fast
//     one, and picking one means picking who gets the wrong answer.
//   - A connection that genuinely dies rejects rather than hangs, and lands
//     in the catch below: `status: 'error'`, committed posts, not-found
//     rendered correctly. The unbounded case needs a peer that accepts the
//     request and then says nothing, which is rare and clears on a reload.
//
// If this ever does need addressing, the right shape is not an abort but a
// SECOND message -- "still loading, this is taking a while" -- which keeps
// the read alive while telling the reader the truth. That is a design
// decision with copy attached, not a patch.
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
