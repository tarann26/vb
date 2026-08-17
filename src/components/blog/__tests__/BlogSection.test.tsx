import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BlogSection from '../BlogSection';
import { ContentProvider, defaultBundle } from '../../../content/ContentContext';
import { copy } from '../../../content';
import type { Post } from '../../../content/types';

function post(overrides: Partial<Post> & Pick<Post, 'slug' | 'title' | 'date'>): Post {
  return {
    id: overrides.slug,
    type: 'story',
    excerpt: `Excerpt for ${overrides.title}.`,
    image: '/food/tielle.webp',
    blocks: [{ kind: 'paragraph', text: 'Body.' }],
    ...overrides,
  };
}

// Six posts, none sharing a field with src/content/posts.json (Phase 4's root
// cause: a fixture that happens to match real content can't tell a real
// binding from a hardcoded literal). Dates put them Newest..Sixth in that
// order; the ARRAY below is deliberately shuffled relative to that, so
// "newest first" is a real claim about sortedPosts, not a restatement of the
// fixture's own declaration order.
const NEWEST = post({ slug: 'fixture-newest', title: 'Newest', date: '2026-06-06' });
const SECOND = post({ slug: 'fixture-second', title: 'Second', date: '2026-05-05' });
const THIRD = post({ slug: 'fixture-third', title: 'Third', date: '2026-04-04' });
const FOURTH = post({ slug: 'fixture-fourth', title: 'Fourth', date: '2026-03-03' });
const FIFTH = post({ slug: 'fixture-fifth', title: 'Fifth', date: '2026-02-02' });
const SIXTH = post({ slug: 'fixture-sixth', title: 'Sixth', date: '2026-01-01' });

const SIX_POSTS: Post[] = [FOURTH, NEWEST, SIXTH, SECOND, FIFTH, THIRD];

function stubFetch(impl: () => Promise<unknown>): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

// A promise this file settles by hand, so "while the fetch is pending" is an
// actual state the assertions run in rather than a race -- same shape as
// PostPage.test.tsx's own helper.
function deferred() {
  let settle: (value: unknown) => void = () => undefined;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

beforeEach(() => {
  // A fetch that never settles, by default -- every case below that isn't
  // specifically about the runtime read sees only the committed (provider)
  // posts, the same posture BlogIndex.test.tsx and PostPage.test.tsx take.
  stubFetch(() => new Promise(() => undefined));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// BlogSection takes no props -- App.tsx maps `press: () => <BlogSection />`
// with nowhere to pass one, and BlogIndex/PostPage both call `usePosts()`
// bare. `posts` seeds the ContentProvider's compiled-in list (what usePosts
// falls back to and paints first); `fetchImpl`, when given, replaces the
// default never-resolving stub so a test can drive the runtime read directly.
function renderSection({
  posts = [],
  fetchImpl,
}: { posts?: Post[]; fetchImpl?: () => Promise<Response> } = {}): void {
  if (fetchImpl) stubFetch(fetchImpl);
  render(
    <ContentProvider value={{ ...defaultBundle, posts }}>
      <MemoryRouter>
        <BlogSection />
      </MemoryRouter>
    </ContentProvider>,
  );
}

describe('BlogSection', () => {
  it('keeps the #blogs anchor, because it is a live URL people have linked', () => {
    renderSection();
    expect(document.querySelector('section#blogs')).not.toBeNull();
  });

  it('shows the three newest posts, newest first, and no more', () => {
    renderSection({ posts: SIX_POSTS });
    const titles = [...document.querySelectorAll('article h3')].map((el) => el.textContent);
    expect(titles).toEqual(['Newest', 'Second', 'Third']);
  });

  it('links each card into this site, never out to the publication', () => {
    renderSection({ posts: SIX_POSTS });
    [...document.querySelectorAll('article a')].forEach((anchor) => {
      expect(anchor.getAttribute('href')).toMatch(/^\/blog\/[a-z0-9-]+$/);
    });
  });

  it('offers a way through to the whole blog', () => {
    renderSection({ posts: SIX_POSTS });
    expect(screen.getByRole('link', { name: /all|blog/i })).toHaveAttribute('href', '/blog');
  });

  it('renders its heading and intro from the press copy leaves, unchanged', () => {
    renderSection({ posts: SIX_POSTS });
    expect(screen.getByRole('heading', { level: 2, name: copy.press.heading })).toBeInTheDocument();
    expect(screen.getByText(copy.press.intro)).toBeInTheDocument();
  });

  // A restaurant with no posts yet is the ordinary first state, and this
  // section renders on the homepage regardless of what sections.json says
  // about the others -- so an empty grid under a heading is the shape that
  // reads as broken.
  it('says something honest when there are no posts at all', () => {
    renderSection({ posts: [] });
    expect(document.querySelectorAll('article')).toHaveLength(0);
    expect(screen.getByText(/on its way/i)).toBeInTheDocument();
  });

  it('paints the committed posts while the database fetch is pending', () => {
    const { promise } = deferred();
    renderSection({ posts: SIX_POSTS, fetchImpl: () => promise as Promise<Response> });
    expect(document.querySelectorAll('article').length).toBeGreaterThan(0);
  });

  // Step 6, row 5's own fix: without this, reading `useContent().posts`
  // instead of `usePosts()` is indistinguishable from the correct code by
  // every other case here, because both paint the identical committed list
  // at first render. This is the one assertion that can only pass if the
  // fetch's OWN result reaches the page -- which is the entire reason this
  // task was ordered after Task 9 (usePosts, not the build-time snapshot).
  it('shows a post that exists only in the database fetch, absent from the committed list', async () => {
    const FROM_DATABASE = post({
      slug: 'fixture-from-database',
      title: 'From The Database',
      date: '2026-07-07',
    });
    renderSection({ posts: SIX_POSTS, fetchImpl: () => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => [FROM_DATABASE, ...SIX_POSTS],
    } as unknown as Response) });
    expect(await screen.findByRole('heading', { level: 3, name: 'From The Database' })).toBeInTheDocument();
  });
});
