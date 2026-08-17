import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PostPage from '../PostPage';
import { ContentProvider } from '../../../content/context';
import { defaultBundle } from '../../../content/ContentContext';
import { site, copy } from '../../../content';
import type { Post } from '../../../content/types';

const canonicals = () =>
  Array.from(document.head.querySelectorAll('link[rel="canonical"]'));

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
});

describe('PostPage', () => {
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

  it('renders the not-found page for a slug no post has', () => {
    renderAt('/blog/nothing-here');
    // Matched against copy.notFound.* itself, not merely "some h1 exists" --
    // NotFound.test.tsx uses the same pattern. A truthy-heading check alone
    // would pass for ANY component with an h1, including a distinct
    // "unpublished" screen that would contradict 80adc55's own commit
    // message ("a missing slug and a nonexistent URL are indistinguishable
    // to a visitor and a crawler").
    expect(screen.getByRole('heading', { name: copy.notFound.heading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.notFound.back })).toBeInTheDocument();
    expect(screen.queryByText('A fixture post title')).toBeNull();
  });

  // Renamed from "...rather than crashing..." to match what it actually
  // proves now: the old version was named for a not.toThrow() alone, which
  // is silent about WHAT was rendered. Replacing NotFound with any other
  // component that also doesn't throw -- e.g. a distinct "unpublished"
  // screen -- left the old version green. This asserts NotFound's own copy
  // renders, on top of not throwing.
  it('renders the same not-found page, not merely without throwing, when there are no posts at all', () => {
    renderAt('/blog/a-fixture-post', []);
    expect(screen.getByRole('heading', { name: copy.notFound.heading })).toBeInTheDocument();
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
