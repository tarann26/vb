import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BlogsPage from '../BlogsPage';
import { press } from '../../content';

// Pinned to specific ids, not a `press.find((a) => a.url === null)` predicate: a
// dynamic lookup would silently retarget itself to the next null-url entry if this
// specific record's url ever changed, masking a regression instead of catching it.
const NULL_URL_ARTICLE_ID = 'food-wine-india-handmade-pasta';
const LINKED_ARTICLE_ID = 'bw-hotelier-regional-flair';

describe('BlogsPage', () => {
  it('renders no "Read Article" link for an article whose url is null', () => {
    const article = press.find((a) => a.id === NULL_URL_ARTICLE_ID);
    if (!article) {
      throw new Error(`Fixture assumption broken: press.json no longer has an article with id "${NULL_URL_ARTICLE_ID}"`);
    }
    expect(article.url).toBeNull();

    render(
      <MemoryRouter>
        <BlogsPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole('link', { name: `Read full article: ${article.title}` }),
    ).not.toBeInTheDocument();
  });

  it('renders a "Read Article" link for an article whose url is set', () => {
    const article = press.find((a) => a.id === LINKED_ARTICLE_ID);
    if (!article) {
      throw new Error(`Fixture assumption broken: press.json no longer has an article with id "${LINKED_ARTICLE_ID}"`);
    }
    expect(article.url).not.toBeNull();

    render(
      <MemoryRouter>
        <BlogsPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('link', { name: `Read full article: ${article.title}` }),
    ).toBeInTheDocument();
  });
});
