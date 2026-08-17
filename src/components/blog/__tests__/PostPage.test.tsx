import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PostPage from '../PostPage';
import { ContentProvider } from '../../../content/context';
import { defaultBundle } from '../../../content/ContentContext';
import type { Post } from '../../../content/types';

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
    // NotFound's own heading, from copy.json. A blog post that does not
    // exist and a URL that does not exist are the same thing to a visitor,
    // and to a crawler -- the same decision App.tsx's PageRoute already made
    // for a disabled page.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('A fixture post title')).toBeNull();
  });

  it('renders the not-found page rather than crashing when there are no posts at all', () => {
    expect(() => renderAt('/blog/a-fixture-post', [])).not.toThrow();
  });
});
