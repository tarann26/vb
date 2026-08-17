import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { usePosts } from '../use-posts';
import { ContentProvider, defaultBundle } from '../../../content/ContentContext';
import { posts as committed } from '../../../content';

// The real committed bundle, which is what `committed` above is: usePosts
// reads its fallback off the provider, so the two have to be the same thing
// or the assertions below would be comparing the hook against something the
// site never renders.
function ContentWrapper({ children }: { children: ReactNode }) {
  return <ContentProvider value={defaultBundle}>{children}</ContentProvider>;
}

// A fixture that shares no slug with src/content/posts.json, so "swapped in
// the database copy" cannot be satisfied by the compiled-in list.
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

// A second valid list, used only to be the WRONG answer: it is what a read
// that has already been superseded would write if nothing stopped it.
const STALE = [{ ...ROW[0], id: 'stale', slug: 'the-read-that-was-superseded' }];

function responseOf(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function respond(body: unknown) {
  return vi.fn().mockResolvedValue(responseOf(body)) as unknown as typeof fetch;
}

function deferredResponse() {
  let settle: (value: unknown) => void = () => undefined;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe('usePosts', () => {
  // A promise this test resolves by hand, so "while the fetch is pending" is
  // an actual state the assertions run in rather than a race.
  function deferred() {
    let settle: (value: unknown) => void = () => undefined;
    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }

  it('paints the committed posts while the fetch is pending, and says it is loading', () => {
    const { promise } = deferred();
    const impl = vi.fn().mockReturnValue(promise) as unknown as typeof fetch;
    const { result } = renderHook(() => usePosts(impl), { wrapper: ContentWrapper });
    expect(result.current.status).toBe('loading');
    expect(result.current.posts.map((post) => post.slug)).toEqual(committed.map((post) => post.slug));
  });

  it('swaps in the database copy once it lands', async () => {
    const impl = respond(ROW);
    const { result } = renderHook(() => usePosts(impl), { wrapper: ContentWrapper });
    await waitFor(() => expect(result.current.status).toBe('loaded'));
    expect(result.current.posts.map((post) => post.slug)).toEqual(['a-post-only-in-the-database']);
  });

  // A database problem costs freshness, never availability -- the same
  // guarantee worker/published.ts's snapshot fallback makes one layer down.
  it('keeps the committed posts and reports an error when the fetch fails', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    const { result } = renderHook(() => usePosts(impl), { wrapper: ContentWrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.posts.map((post) => post.slug)).toEqual(committed.map((post) => post.slug));
  });

  // A refused body is not an outage: fetchPosts returns null for a shape it
  // will not vouch for, and null means "keep what you have" -- which is
  // `loaded`, not `error`, because there is nothing wrong with the network and
  // nothing for a reader to retry.
  it('keeps the committed posts and settles as loaded when the body is refused', async () => {
    const impl = respond({ posts: [] });
    const { result } = renderHook(() => usePosts(impl), { wrapper: ContentWrapper });
    await waitFor(() => expect(result.current.status).toBe('loaded'));
    expect(result.current.posts.map((post) => post.slug)).toEqual(committed.map((post) => post.slug));
  });

  // The `cancelled` flag, tested on the property it actually protects.
  //
  // Deliberately NOT "unmount before it settles": in React 18 a setState on an
  // unmounted component is a silent no-op -- the old "can't perform a React
  // state update on an unmounted component" warning was removed in 18.0 -- so
  // that test passes identically with the flag and without it. It would be
  // unfalsifiable, and an unfalsifiable test costs exactly what a skipped one
  // does. This exercises the same two lines through the case that IS
  // observable: the effect re-runs, its cleanup cancels the first read, and
  // the first read then lands LAST. Without the flag the superseded answer
  // wins and the reader sees content that was already out of date when it
  // arrived.
  it('ignores a read that lands after a newer one has replaced it', async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const implA = vi.fn().mockReturnValue(first.promise) as unknown as typeof fetch;
    const implB = vi.fn().mockReturnValue(second.promise) as unknown as typeof fetch;

    const { result, rerender } = renderHook(({ impl }: { impl: typeof fetch }) => usePosts(impl), {
      wrapper: ContentWrapper,
      initialProps: { impl: implA },
    });
    // Changing the injected fetch re-runs the effect, which runs the first
    // one's cleanup on the way.
    rerender({ impl: implB });

    await act(async () => {
      second.settle(responseOf(ROW));
    });
    await act(async () => {
      first.settle(responseOf(STALE));
    });

    expect(result.current.posts.map((post) => post.slug)).toEqual(['a-post-only-in-the-database']);
    expect(result.current.status).toBe('loaded');
  });

  // Pinning the negative: the committed list is not empty, so every
  // "posts stay the committed ones" assertion above is comparing against
  // something real. Without this, blanking src/content/posts.json would make
  // three of the four cases above pass against two empty arrays.
  it('has a non-empty committed list to fall back to in the first place', () => {
    expect(committed.length).toBeGreaterThan(0);
  });
});
