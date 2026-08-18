import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
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
import { ALL_FILTER_LABEL, EMPTY_POSTS_MESSAGE, NO_MATCHING_POSTS_MESSAGE, POST_TYPE_LABELS } from '../posts';
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

// BlogIndex now does a runtime read (use-posts.ts) through the global
// `fetch`. Every case that is not about that read gets one that fails on the
// first tick: usePosts settles to `error` and keeps the provider's posts, so
// those cases see the same cards they saw before this task -- and see them
// through the same path a real reader hits when the database is down.
function stubFetch(impl: () => Promise<unknown>): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function stubFetchResolving(posts: Post[]): void {
  stubFetch(() => Promise.resolve({ ok: true, status: 200, json: async () => posts } as unknown as Response));
}

beforeEach(() => {
  // A fetch that never settles. Every case below this one is about FIRST
  // PAINT -- the compiled-in cards, rendered before anything comes back --
  // which is exactly the state a pending fetch holds the component in, and it
  // queues no state update for an assertion that never looks for one.
  stubFetch(() => new Promise(() => undefined));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    // Review fix (Minor #1): named exactly, not just counted -- a bug that
    // returns the right COUNT but the wrong nine (while still returning the
    // correct oldest two on page 2, which the assertion below already pins)
    // would have passed the old `toHaveLength(9)` check.
    expect(cardHeadings(container)).toEqual([
      'Fixture post 11',
      'Fixture post 10',
      'Fixture post 9',
      'Fixture post 8',
      'Fixture post 7',
      'Fixture post 6',
      'Fixture post 5',
      'Fixture post 4',
      'Fixture post 3',
    ]);

    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(cardHeadings(container)).toHaveLength(2);
    // Page 2 holds the two OLDEST, which is what proves the slice runs over
    // the sorted list rather than the raw one.
    expect(cardHeadings(container)).toEqual(['Fixture post 2', 'Fixture post 1']);
  });

  it('renders no pagination controls at all when everything fits on one page', () => {
    renderIndex([post(1), post(2)]);
    // Review fix (Minor #2): the old 'Next' half of this assertion could not
    // fail on any code path -- BlogIndex never renders a Next control at
    // all (unlike BlogsPage's Previous/Next design), only bare numbered
    // buttons. Replaced with an exhaustive check over every possible
    // numbered page button, not just '1', so a future change that renders
    // some OTHER page number here is still caught.
    expect(screen.queryAllByRole('button', { name: /^\d+$/ })).toHaveLength(0);
  });

  // Fix round 1, Finding 1: asserts the exact, imported EMPTY_POSTS_MESSAGE
  // rather than a loose regex, for the same reason BlogSection.test.tsx's
  // sibling case does -- checking both surfaces against the SAME constant is
  // what makes a re-inlined, un-imported string in either one fail its own
  // test.
  it('says so plainly when there are no posts yet, rather than rendering an empty grid', () => {
    const { container } = renderIndex([]);
    expect(screen.getByText(EMPTY_POSTS_MESSAGE)).toBeInTheDocument();
    expect(cardHeadings(container)).toHaveLength(0);
  });

  // Task 30 scoped this to the cards. Both strings now appear TWICE on the
  // page -- once as a filter control, once as a card badge -- and
  // `getByText` throws on multiple matches. Scoping to `article span`
  // (PostCard.tsx:32 renders exactly one <span> per <article>) is the claim
  // this case was always making, and the "in the same words" half is pinned
  // against the filter row in the first control case below.
  it("shows each post's type as a readable badge on the card, in the same words as the filter", () => {
    const { container } = renderIndex([post(1), post(2)]);
    const badges = [...container.querySelectorAll('article span')].map((s) => s.textContent);
    expect(badges).toEqual(['Recipe', 'In the press']);
  });

  // The index's half of the runtime read, and the deliberate difference from
  // /blog/:slug: no loading screen, because this route always has something
  // real to paint. A post only in the database appears when it arrives; the
  // compiled-in cards are never replaced by nothing in the meantime.
  it('paints the committed cards immediately and swaps in the database ones', async () => {
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
    stubFetchResolving(D1_ONLY);
    const { container } = renderIndex([post(1)]);
    // Committed content first -- no spinner, because the index has something
    // real to show.
    expect(cardHeadings(container)).toEqual(['Fixture post 1']);
    expect(await screen.findByRole('heading', { level: 3, name: 'A post only in the database' })).toBeInTheDocument();
    // Scoped to `article h3`: Footer.tsx renders an <h3> on every page, so a
    // bare level-3 query counts the footer too.
    expect(cardHeadings(container)).toEqual(['A post only in the database']);
  });

  // Task 30. The three controls the owner asked for in her own words: tell
  // press releases from recipes from posts, sort by most recent, and look
  // something up in a search bar.

  it('starts on All, newest first, with an empty search box', () => {
    renderIndex([post(1), post(2)]);
    expect(screen.getByRole('button', { name: ALL_FILTER_LABEL, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Newest first', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Oldest first', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search stories' })).toHaveValue('');

    // The vocabulary claim, stated once and directly: what she filters by IS
    // the table the card badge reads (posts.ts POST_TYPE_LABELS), plus the
    // absence-of-a-filter label. A control reading "Press mentions" beside a
    // card badged "In the press" fails here rather than at a reader's eye.
    const filters = screen.getByRole('group', { name: 'Filter stories by kind' });
    expect([...filters.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      ALL_FILTER_LABEL,
      ...Object.values(POST_TYPE_LABELS),
    ]);
  });

  it('narrows to one kind when that kind is chosen', async () => {
    // Fixture parity: even n is a recipe, odd n is a mention.
    const { container } = renderIndex([post(1), post(2), post(3), post(4)]);
    expect(cardHeadings(container)).toHaveLength(4);

    await userEvent.click(screen.getByRole('button', { name: 'Recipe' }));
    expect(cardHeadings(container)).toEqual(['Fixture post 4', 'Fixture post 2']);
    expect(screen.getByRole('button', { name: 'Recipe', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ALL_FILTER_LABEL, pressed: false })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'In the press' }));
    expect(cardHeadings(container)).toEqual(['Fixture post 3', 'Fixture post 1']);
  });

  it('turns the order round without changing which posts are shown', async () => {
    const { container } = renderIndex([post(1), post(2), post(3)]);
    expect(cardHeadings(container)).toEqual(['Fixture post 3', 'Fixture post 2', 'Fixture post 1']);

    await userEvent.click(screen.getByRole('button', { name: 'Oldest first' }));
    expect(cardHeadings(container)).toEqual(['Fixture post 1', 'Fixture post 2', 'Fixture post 3']);
    expect(screen.getByRole('button', { name: 'Oldest first', pressed: true })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Newest first' }));
    expect(cardHeadings(container)).toEqual(['Fixture post 3', 'Fixture post 2', 'Fixture post 1']);
  });

  it('filters as she types, over titles and excerpts', async () => {
    const { container } = renderIndex([post(1), post(2), post(3), post(4)]);
    const box = screen.getByRole('searchbox', { name: 'Search stories' });

    // A title match.
    await userEvent.type(box, 'post 3');
    expect(cardHeadings(container)).toEqual(['Fixture post 3']);

    // An excerpt match -- the same word appears in no title, so a search that
    // only looked at titles would find nothing here.
    await userEvent.clear(box);
    await userEvent.type(box, 'Excerpt 2');
    expect(cardHeadings(container)).toEqual(['Fixture post 2']);

    await userEvent.clear(box);
    expect(cardHeadings(container)).toHaveLength(4);
  });

  it('composes a kind and a word', async () => {
    // The spec's own example: choose Recipes, type "lemon", see lemon
    // recipes. Both a recipe and a mention carry the word, and a second
    // recipe does not, so neither control alone produces this answer.
    const lemonRecipe: Post = { ...post(2), title: 'Lemon tart' };
    const lemonMention: Post = { ...post(3), title: 'Lemon on the menu' };
    const { container } = renderIndex([post(1), lemonRecipe, lemonMention, post(4)]);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search stories' }), 'lemon');
    expect(cardHeadings(container)).toEqual(['Lemon on the menu', 'Lemon tart']);

    await userEvent.click(screen.getByRole('button', { name: 'Recipe' }));
    expect(cardHeadings(container)).toEqual(['Lemon tart']);
  });

  it('says so in words when nothing matches, and does not claim the blog is empty', async () => {
    const { container } = renderIndex([post(1), post(3)]);
    await userEvent.click(screen.getByRole('button', { name: 'Recipe' }));

    expect(screen.getByText(NO_MATCHING_POSTS_MESSAGE)).toBeInTheDocument();
    // A blog with two posts and a filter matching none of them is NOT an
    // empty blog, and "the first post is on its way" is plainly false on a
    // page that has posts.
    expect(screen.queryByText(EMPTY_POSTS_MESSAGE)).not.toBeInTheDocument();
    expect(cardHeadings(container)).toHaveLength(0);
  });

  it('goes back to page one when a control changes', async () => {
    const many = Array.from({ length: 12 }, (_, i) => post(i + 1));
    const { container } = renderIndex(many);

    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(cardHeadings(container)).toEqual(['Fixture post 3', 'Fixture post 2', 'Fixture post 1']);

    // Standing on page 2, turn the order round. Without the reset this lands
    // on page 2 of the oldest-first list (posts 10, 11, 12) with the page-1
    // button highlighted -- cards and page number disagreeing.
    await userEvent.click(screen.getByRole('button', { name: 'Oldest first' }));
    expect(cardHeadings(container)).toEqual([
      'Fixture post 1',
      'Fixture post 2',
      'Fixture post 3',
      'Fixture post 4',
      'Fixture post 5',
      'Fixture post 6',
      'Fixture post 7',
      'Fixture post 8',
      'Fixture post 9',
    ]);
  });

  it('counts pages over the filtered list, not the whole one', async () => {
    // Twelve posts is two pages; the six recipes among them are one. Three
    // numbered buttons above a single-page result is the exact bug a filter
    // introduces when a count is taken over the wrong list.
    const many = Array.from({ length: 12 }, (_, i) => post(i + 1));
    renderIndex(many);
    expect(screen.queryAllByRole('button', { name: /^\d+$/ }).map((b) => b.textContent)).toEqual(['1', '2']);

    await userEvent.click(screen.getByRole('button', { name: 'Recipe' }));
    expect(screen.queryAllByRole('button', { name: /^\d+$/ })).toHaveLength(0);
  });

});
