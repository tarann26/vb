import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PostPage from '../PostPage';
import { ContentProvider } from '../../../content/context';
import { defaultBundle } from '../../../content/ContentContext';
import { site, copy } from '../../../content';
import type { Post } from '../../../content/types';

const canonicals = () =>
  Array.from(document.head.querySelectorAll('link[rel="canonical"]'));

// The literal string NotFound.tsx renders, written out rather than imported
// from the module under test's own source of truth. Phase 4's thirteenth
// unfalsifiable test compared a response against the value under test, and
// corrupting that value left 2837 tests green. Pinned against the shipped
// copy by the case just below, so this literal cannot silently go stale
// either.
const NOT_FOUND_HEADING = 'Page not found';

// PostPage now does a runtime read (use-posts.ts). Every test here drives it
// through the global `fetch`, because PostPage calls `usePosts()` with no
// argument -- which is the real production call and the only one worth
// covering on this route.
function stubFetch(impl: () => Promise<unknown>): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function stubFetchResolving(posts: Post[]): void {
  stubFetch(() => Promise.resolve({ ok: true, status: 200, json: async () => posts } as unknown as Response));
}

function stubFetchRejecting(): void {
  stubFetch(() => Promise.reject(new Error('no network here')));
}

// A promise this file settles by hand, so "while the fetch is pending" is an
// actual state the assertions run in rather than a race.
function deferred() {
  let settle: (value: unknown) => void = () => undefined;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

// The same idea for the failure direction. `fail` is called inside `act`, so
// the assertions that follow run on the SETTLED state rather than on first
// paint -- which is the whole claim of the case that uses it, and what makes
// that case able to fail when usePosts's catch branch drops the committed
// posts. No unhandled rejection: usePosts attaches its catch synchronously,
// before this promise is ever rejected.
function deferredFailure() {
  let fail: (reason: unknown) => void = () => undefined;
  const promise = new Promise((_resolve, reject) => {
    fail = reject;
  });
  return { promise, fail };
}

// A fixture bundle whose post shares NO field value with
// src/content/posts.json. If this fixture matched the committed content, a
// hardcoded title in PostPage would be indistinguishable from a real
// binding -- Phase 4's root cause, in the same shape.
const FIXTURE_POST: Post = {
  id: 'fixture-1',
  slug: 'a-fixture-post',
  type: 'recipe',
  title: 'A fixture post title',
  date: '2026-03-04',
  excerpt: 'A fixture excerpt for the card.',
  image: '/food/tielle.webp',
  blocks: [
    { kind: 'paragraph', text: 'A fixture paragraph with **bold** in it.' },
    { kind: 'steps', heading: 'How to make it', items: ['Mix', 'Rest'] },
  ],
};

function renderAt(path: string, posts: Post[] = [FIXTURE_POST]) {
  return render(
    <ContentProvider value={{ ...defaultBundle, posts }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/blog/:slug" element={<PostPage />} />
        </Routes>
      </MemoryRouter>
    </ContentProvider>,
  );
}

beforeEach(() => {
  document.title = 'Original title';
  // The default for every case that is not about the runtime read: a fetch
  // that never settles. Those cases are all about FIRST PAINT -- the
  // compiled-in copy, rendered before anything comes back -- which is exactly
  // the state a pending fetch holds the component in. It also means they
  // queue no state update at all, so none of them needs an `act` wrapper for
  // an assertion it never makes.
  stubFetch(() => deferred().promise);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PostPage', () => {
  it('pins the literal this file matches NotFound by', () => {
    expect(copy.notFound.heading).toBe(NOT_FOUND_HEADING);
  });

  it('renders the post title as the page\'s single h1', () => {
    const { container } = renderAt('/blog/a-fixture-post');
    const h1s = [...container.querySelectorAll('h1')];
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('A fixture post title');
  });

  // Mutation 6's own fix: a hardcoded `<h1>A fixture post title</h1>` in
  // PostPage would satisfy the test above and nothing would redden. A
  // second fixture with a DIFFERENT title is what makes a literal
  // indistinguishable from a real binding fail.
  it('renders a different post\'s own title, not a fixed string', () => {
    const otherPost: Post = { ...FIXTURE_POST, slug: 'a-different-post', title: 'A different fixture title' };
    const { container } = renderAt('/blog/a-different-post', [otherPost]);
    const h1s = [...container.querySelectorAll('h1')];
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('A different fixture title');
  });

  it('renders every block, in order', () => {
    const { container } = renderAt('/blog/a-fixture-post');
    expect(container.querySelector('p strong')?.textContent).toBe('bold');
    expect(container.querySelector('ol')).not.toBeNull();
    expect([...container.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual(['Mix', 'Rest']);
  });

  it('shows the date in the readable form the rest of the site uses', () => {
    renderAt('/blog/a-fixture-post');
    // formatArticleDate('2026-03-04'). Written as a literal rather than by
    // calling formatArticleDate -- an expectation computed by the code under
    // test proves nothing (Phase 4's thirteenth unfalsifiable test).
    expect(screen.getByText('March 4, 2026')).toBeInTheDocument();
  });

  it('shows the type as a readable badge, not the raw union member', () => {
    renderAt('/blog/a-fixture-post');
    expect(screen.getByText('Recipe')).toBeInTheDocument();
    expect(screen.queryByText('recipe')).toBeNull();
  });

  it('sets the document title to the post title while it is mounted, and restores it after', () => {
    const { unmount } = renderAt('/blog/a-fixture-post');
    expect(document.title).toBe('A fixture post title');
    unmount();
    expect(document.title).toBe('Original title');
  });

  it('rewrites the existing description meta rather than appending a second one', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'the original description');
    document.head.appendChild(meta);
    try {
      const { unmount } = renderAt('/blog/a-fixture-post');
      expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
      expect(meta.getAttribute('content')).toBe('A fixture excerpt for the card.');
      unmount();
      expect(meta.getAttribute('content')).toBe('the original description');
    } finally {
      meta.remove();
    }
  });

  // `await findBy`, not a bare `getBy`, and the await is the task: the
  // not-found screen is now reached only once the runtime read has SETTLED.
  // Before it settles the loading line stands in for it, which is the whole
  // point of use-posts.ts's third state.
  it('renders the not-found page for a slug no post has', async () => {
    stubFetchRejecting();
    renderAt('/blog/nothing-here');
    // Matched against copy.notFound.* itself, not merely "some h1 exists" --
    // NotFound.test.tsx uses the same pattern. A truthy-heading check alone
    // would pass for ANY component with an h1, including a distinct
    // "unpublished" screen that would contradict 80adc55's own commit
    // message ("a missing slug and a nonexistent URL are indistinguishable
    // to a visitor and a crawler").
    expect(await screen.findByRole('heading', { name: copy.notFound.heading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.notFound.back })).toBeInTheDocument();
    expect(screen.queryByText('A fixture post title')).toBeNull();
  });

  // Renamed from "...rather than crashing..." to match what it actually
  // proves now: the old version was named for a not.toThrow() alone, which
  // is silent about WHAT was rendered. Replacing NotFound with any other
  // component that also doesn't throw -- e.g. a distinct "unpublished"
  // screen -- left the old version green. This asserts NotFound's own copy
  // renders, on top of not throwing.
  it('renders the same not-found page, not merely without throwing, when there are no posts at all', async () => {
    stubFetchResolving([]);
    renderAt('/blog/a-fixture-post', []);
    expect(await screen.findByRole('heading', { name: copy.notFound.heading })).toBeInTheDocument();
  });

  // S1: useCanonical(post ? `${site.seo.url}/blog/${post.slug}` : null) is
  // called unconditionally above the early return. Mutating that call to
  // useCanonical(null) leaves the rest of this file's suite green -- nothing
  // else looks in document.head. site.seo.url is the real, non-fixture
  // domain the Cloudflare Pages duplicate-host problem (useCanonical.ts's
  // own header) needs pinned to a real value, so this is deliberately not a
  // fixture URL.
  it('declares the post\'s own canonical url', () => {
    renderAt('/blog/a-fixture-post');
    expect(canonicals().map((link) => link.getAttribute('href'))).toEqual([
      `${site.seo.url}/blog/a-fixture-post`,
    ]);
  });

  it('removes the post canonical on unmount', () => {
    const { unmount } = renderAt('/blog/a-fixture-post');
    expect(canonicals()).toHaveLength(1);
    unmount();
    expect(canonicals()).toHaveLength(0);
  });
});

// THE defect this task exists to prevent, and the test that would have caught
// it: a post that lives only in the database must not flash NotFound.
//
// "Committed" in this block means FIXTURE_POST, not src/content/posts.json --
// renderAt hands the provider its own fixture, which is what usePosts reads
// as the compiled-in fallback here. That is the stronger arrangement, not a
// weaker one: this file's whole premise (see FIXTURE_POST's own comment) is
// that a fixture equal to real content cannot tell a real binding from a
// hardcoded copy, and D1_ONLY below differs from FIXTURE_POST in every field
// asserted on, exactly as FIXTURE_POST differs from the real committed list.
describe('a post that is only in the database', () => {
  const D1_ONLY: Post[] = [
    {
      id: 'from-d1',
      slug: 'a-post-only-in-the-database',
      type: 'story',
      title: 'A post only in the database',
      date: '2026-05-06',
      excerpt: 'A database excerpt.',
      image: '/food/tielle.webp',
      blocks: [{ kind: 'paragraph', text: 'A database paragraph.' }],
    },
  ];

  it('shows a loading line while the fetch is pending, NOT NotFound', () => {
    const { promise } = deferred();
    stubFetch(() => promise);
    renderAt('/blog/a-post-only-in-the-database');
    expect(screen.getByText('Loading this post…')).toBeInTheDocument();
    // NotFound's own copy, matched the way NotFound.test.tsx matches it, not
    // a bare heading query -- a review found two tests named "redirects to
    // /blog" that asserted only that something rendered.
    expect(screen.queryByText(NOT_FOUND_HEADING)).toBeNull();
  });

  // The role is a promise, so it is asserted rather than left as decoration --
  // and asserted as `status` specifically. `alert` would announce this as a
  // problem and would drag the line into FIRST_PROBLEM_SELECTOR
  // ('[aria-describedby*="-error"], [role="alert"]'), which is what /edit
  // jumps to; nothing is wrong here and nothing for her to fix.
  it('announces the wait politely, and never as a problem', () => {
    const { promise } = deferred();
    stubFetch(() => promise);
    renderAt('/blog/a-post-only-in-the-database');
    expect(screen.getByRole('status')).toHaveTextContent('Loading this post…');
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it('renders the post once the fetch lands', async () => {
    stubFetchResolving(D1_ONLY);
    renderAt('/blog/a-post-only-in-the-database');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'A post only in the database' }),
    ).toBeInTheDocument();
    expect(screen.getByText('A database paragraph.')).toBeInTheDocument();
  });

  // The settle is driven by hand, inside act, rather than waited for with a
  // polling findBy: "before" and "after" are then two assertions either side
  // of one controlled event, and there is no interval in which the test could
  // have observed either state by luck.
  it('renders NotFound only after the fetch settles, for a slug nothing has', async () => {
    const { promise, settle } = deferred();
    stubFetch(() => promise);
    renderAt('/blog/no-such-post');
    expect(screen.getByText('Loading this post…')).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_HEADING)).toBeNull();

    await act(async () => {
      settle({ ok: true, status: 200, json: async () => D1_ONLY });
    });

    expect(screen.getByText(NOT_FOUND_HEADING)).toBeInTheDocument();
    expect(screen.queryByText('Loading this post…')).toBeNull();
  });

  it('a committed post never shows the loading line at all', () => {
    const { promise } = deferred();
    stubFetch(() => promise);
    renderAt('/blog/a-fixture-post');
    expect(screen.queryByText('Loading this post…')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'A fixture post title' })).toBeInTheDocument();
  });

  it('a failed fetch still renders the committed post, and never NotFound', async () => {
    const { promise, fail } = deferredFailure();
    stubFetch(() => promise);
    renderAt('/blog/a-fixture-post');
    // The failure is triggered inside act, so what follows is asserted on the
    // settled state. A database outage costs freshness, never availability.
    await act(async () => {
      fail(new Error('the database is down'));
    });
    expect(screen.getByRole('heading', { level: 1, name: 'A fixture post title' })).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_HEADING)).toBeNull();
    expect(screen.queryByText('Loading this post…')).toBeNull();
  });
});
