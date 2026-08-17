import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// `press` is mocked to a two-article fixture -- one with `url: null`, one
// with a real url -- rather than pinned to specific ids in the live
// press.json. The spec's own "Blocked on the founder" list names nine press
// URLs still outstanding; the moment any one of them (including
// food-wine-india-handmade-pasta, previously pinned here directly) is
// supplied, a live-content assertion on that id would fail the deploy gate
// for a legitimate edit. A fixture guarantees both branches -- url present
// and url null -- are exercised on every run regardless of what today's
// press.json holds. Follows the same mock-`press` pattern already used in
// copy-rendered.test.tsx's BlogTeaser/BlogsPage tests.
const nullUrlArticle = {
  id: 'fixture-null-url',
  title: 'Fixture Article Without A Url',
  publication: 'Fixture Publication',
  date: '2026-01-01',
  excerpt: 'Fixture excerpt text.',
  url: null,
  image: '/fixture.jpg',
};
const linkedArticle = {
  id: 'fixture-linked',
  title: 'Fixture Article With A Url',
  publication: 'Fixture Publication',
  date: '2026-01-02',
  excerpt: 'Fixture excerpt text.',
  url: 'https://example.com/fixture',
  image: '/fixture.jpg',
};

// Review note (Minor #8, Phase 5 Task 8): BlogsPage is no longer reachable
// by any route -- App.tsx's /blogs now renders a <Navigate to="/blog"
// replace /> instead, and BlogIndex.tsx is what actually renders there. This
// file (and its component) stay under the owner's never-delete constraint
// and this suite still passes, correctly -- but green here proves only that
// BlogsPage still renders as written, not that a visitor can ever see it.
describe('BlogsPage', () => {
  afterEach(() => {
    vi.doUnmock('../../content');
    vi.resetModules();
  });

  it('renders no "Read Article" link for an article whose url is null', async () => {
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return { ...actual, press: [nullUrlArticle, linkedArticle] };
    });
    const { default: BlogsPage } = await import('../BlogsPage');

    render(
      <MemoryRouter>
        <BlogsPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole('link', { name: `Read full article: ${nullUrlArticle.title}` }),
    ).not.toBeInTheDocument();
  });

  it('renders a "Read Article" link for an article whose url is set', async () => {
    vi.resetModules();
    vi.doMock('../../content', async () => {
      const actual = await vi.importActual<typeof import('../../content')>('../../content');
      return { ...actual, press: [nullUrlArticle, linkedArticle] };
    });
    const { default: BlogsPage } = await import('../BlogsPage');

    render(
      <MemoryRouter>
        <BlogsPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('link', { name: `Read full article: ${linkedArticle.title}` }),
    ).toBeInTheDocument();
  });
});
