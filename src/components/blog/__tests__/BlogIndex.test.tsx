import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import BlogIndex from '../BlogIndex';
// Brief said `../../../content/context`; that module holds only
// ContentReactContext/ContentProvider and the collage renderers -- no
// `defaultBundle`. defaultBundle is exported from ContentContext.ts (see
// that file's own comment on why the split happened), which is where this
// import actually resolves.
import { ContentProvider, defaultBundle } from '../../../content/ContentContext';
import type { Post } from '../../../content/types';

function post(n: number): Post {
  return {
    id: `fixture-${n}`,
    slug: `fixture-post-${n}`,
    type: n % 2 === 0 ? 'recipe' : 'mention',
    title: `Fixture post ${n}`,
    date: `2026-01-${String(n).padStart(2, '0')}`,
    excerpt: `Excerpt ${n}.`,
    image: '/food/tielle.webp',
    blocks: [{ kind: 'paragraph', text: 'Body.' }],
  };
}

function renderIndex(posts: Post[]) {
  return render(
    <ContentProvider value={{ ...defaultBundle, posts }}>
      <MemoryRouter>
        <BlogIndex />
      </MemoryRouter>
    </ContentProvider>,
  );
}

// Scoped to `article h3` rather than `screen.getAllByRole('heading', {
// level: 3 })` -- Footer.tsx renders its own level-3 heading (`{site.name}`,
// "Via Bianca") on every page including this one, so an unscoped role query
// counts the footer alongside every card and both over-counts and
// mis-orders the comparison. Each PostCard's own title is the only h3 that
// lives inside an <article>, which is what actually distinguishes a card
// heading from chrome.
function cardHeadings(container: HTMLElement): string[] {
  return [...container.querySelectorAll('article h3')].map((h) => h.textContent ?? '');
}

describe('BlogIndex', () => {
  it('renders one card per post, newest first', () => {
    const { container } = renderIndex([post(1), post(3), post(2)]);
    expect(cardHeadings(container)).toEqual(['Fixture post 3', 'Fixture post 2', 'Fixture post 1']);
  });

  it('links each card to the post, not to an external article', () => {
    const { container } = renderIndex([post(1)]);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/blog/fixture-post-1');
  });

  it('shows nine posts on the first page and the rest on the second', async () => {
    const many = Array.from({ length: 11 }, (_, i) => post(i + 1));
    const { container } = renderIndex(many);
    expect(cardHeadings(container)).toHaveLength(9);

    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(cardHeadings(container)).toHaveLength(2);
    // Page 2 holds the two OLDEST, which is what proves the slice runs over
    // the sorted list rather than the raw one.
    expect(cardHeadings(container)).toEqual(['Fixture post 2', 'Fixture post 1']);
  });

  it('renders no pagination controls at all when everything fits on one page', () => {
    renderIndex([post(1), post(2)]);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
  });

  it('says so plainly when there are no posts yet, rather than rendering an empty grid', () => {
    const { container } = renderIndex([]);
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
    expect(cardHeadings(container)).toHaveLength(0);
  });

  it('shows each post\'s type as a readable badge', () => {
    renderIndex([post(1), post(2)]);
    expect(screen.getByText('In the press')).toBeInTheDocument();
    expect(screen.getByText('Recipe')).toBeInTheDocument();
  });
});
