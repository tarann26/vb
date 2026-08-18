// Phase 5. /blog -- every post, newest first, nine to a page, with the three
// controls above the list: kind, order, and a search box over what is already
// loaded (Task 30). The list operations themselves live in posts.ts.
//
// Pagination is client-side state with no ?page= in the URL, which is what
// /blogs already did and what its own comment (BlogsPage.tsx:20-23) argues
// for: the paginated views are slices of one collection reached by state,
// the address bar never changes, so every one of them IS /blog and the
// canonical says so. 5C's server-rendered pages inherit that; a per-page URL
// would need its own canonical strategy and buys nothing at three posts.
import { useState } from 'react';
import { useContent } from '../../content/ContentContext';
import { useCanonical } from '../useCanonical';
import NavBar from '../NavBar';
import Footer from '../Footer';
import PostCard from './PostCard';
import {
  EMPTY_POSTS_MESSAGE,
  NO_MATCHING_POSTS_MESSAGE,
  POST_FILTERS,
  filterLabel,
  pageCount,
  pageSlice,
  visiblePosts,
} from './posts';
import type { PostFilter, PostOrder } from './posts';
import { usePosts } from './use-posts';

// The one control chrome, shared by the three rows. Byte-identical to the
// string the numbered page buttons already built inline, so this split costs
// zero new rules. The pressed state paints ink on the brand surface, never
// white: the brand blue is 1.45:1 against white and the palette sweep exists
// because this project once shipped exactly that button.
const CONTROL_CLASSNAME = `px-4 py-2 rounded-lg font-['Montserrat'] text-sm transition-colors duration-300`;
const CONTROL_ON = 'bg-brand text-ink';
const CONTROL_OFF = 'bg-white border border-gray-300 hover:bg-gray-50';
const ORDERS: readonly PostOrder[] = ['newest', 'oldest'];
const ORDER_LABELS: Record<PostOrder, string> = { newest: 'Newest first', oldest: 'Oldest first' };

// `copy.blogsPage.heading`/`.intro` are the two blogsPage.* leaves still
// genuinely painted on a live page after this task -- BlogsPage.tsx's own
// title/subtitle/back/previous/next have no route left to render on (see
// App.tsx's own comment), but this heading and this intro are the real
// copy shown here, reusing the same two keys BlogsPage used rather than
// minting new ones. Wrapped in `renderText`, not read bare, so /edit keeps
// its in-place editing affordance for them instead of silently losing it
// the moment BlogsPage stopped being the thing that rendered them --
// src/admin/editable-paths.ts's own NOT_EDITABLE_IN_PLACE_COPY_FIELDS is
// where the other five, now genuinely unreachable, retire instead.
export default function BlogIndex() {
  const { copy, site, renderText } = useContent();
  // No loading screen here, deliberately. The index has content to paint at
  // first paint -- the compiled-in list -- so a spinner would replace real
  // cards with nothing for the length of one fetch. `status` is unused on
  // this route and that is the honest answer for it.
  const { posts } = usePosts();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<PostFilter>('all');
  const [order, setOrder] = useState<PostOrder>('newest');
  const [query, setQuery] = useState('');
  useCanonical(`${site.seo.url}/blog`);

  // Every count on this page is a count of the VISIBLE list, not of the
  // whole one. Reading pageCount(posts) here while slicing the filtered list
  // is the exact bug shape a filter introduces: three numbered buttons above
  // a single-page result, two of which show nothing.
  const visible = visiblePosts(posts, filter, query, order);
  const total = pageCount(visible);
  const shown = pageSlice(visible, page);

  function goTo(next: number): void {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Every control resets to page 1. Choosing Recipes while standing on page 2
  // of All otherwise lands on page 2 of a one-page result, which pageSlice
  // clamps back to page 1 -- so the cards would be right and the highlighted
  // page number wrong, which is worse than either.
  function chooseFilter(next: PostFilter): void {
    setFilter(next);
    setPage(1);
  }
  function chooseOrder(next: PostOrder): void {
    setOrder(next);
    setPage(1);
  }
  function changeQuery(next: string): void {
    setQuery(next);
    setPage(1);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar offHomePage />
      <div className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            {/* Review fix (Important #1): the brief's own Step 4 code lifted
                this heading out of BlogsPage.tsx:63, where it sat under that
                page's own real <h1> (BlogsPage.tsx:44) -- a header that did
                not come along. Every sibling route has one (NotFound.tsx,
                PostPage.tsx, Hero.tsx); this is the only one that didn't.
                <h1>, not <h2> -- same class string, zero CSS, every rule
                already ships. Cards stay <h3> (PostCard.tsx): that component
                is shared with 5B's homepage section, where a different level
                would clash. */}
            <h1 className={`mb-6 font-['Montserrat'] text-4xl md:text-5xl font-bold text-ink`}>
              {renderText('blogsPage.heading', copy.blogsPage.heading)}
            </h1>
            <p className={`font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed`}>
              {renderText('blogsPage.intro', copy.blogsPage.intro)}
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-4 mb-8" role="group" aria-label="Filter stories by kind">
            {POST_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => chooseFilter(value)}
                className={`${CONTROL_CLASSNAME} ${filter === value ? CONTROL_ON : CONTROL_OFF}`}
              >
                {filterLabel(value)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-4 mb-8" role="group" aria-label="Sort stories">
            {ORDERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={order === value}
                onClick={() => chooseOrder(value)}
                className={`${CONTROL_CLASSNAME} ${order === value ? CONTROL_ON : CONTROL_OFF}`}
              >
                {ORDER_LABELS[value]}
              </button>
            ))}
          </div>

          {/* aria-label rather than a visually-hidden <label>: the
              hidden-label utility has no rule in the shipped stylesheet today
              and would be a new one for no reader-visible gain, and a heading
              over these rows would make e2e/blog.spec.ts:52-53's own "no h2
              anywhere on the page" comment stale. */}
          <div className="flex justify-center mb-12">
            <input
              id="blog-search"
              type="search"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              aria-label="Search stories"
              placeholder="Search stories"
              className={`w-full max-w-2xl px-4 py-2 rounded-lg border border-gray-300 bg-white font-['Open_Sans'] text-sm text-ink`}
            />
          </div>

          {posts.length === 0 ? (
            // An honest empty state rather than an empty grid. A restaurant
            // with no posts yet is the ordinary first state (assertPosts and
            // validatePosts both accept an empty list on purpose), and a
            // silent blank area reads as a broken page. EMPTY_POSTS_MESSAGE
            // (posts.ts) is shared with BlogSection's own empty state, so the
            // two surfaces cannot drift into describing one situation two ways.
            <p className={`text-center font-['Open_Sans'] text-gray-600`}>
              {EMPTY_POSTS_MESSAGE}
            </p>
          ) : visible.length === 0 ? (
            // A different situation and so a different sentence. A blog with
            // three posts and a filter matching none of them is not an empty
            // blog, and telling her reader "the first post is on its way" on a
            // page that plainly has posts is simply false -- with today's
            // committed content (three Mentions) the Recipe and Story filters
            // land here on the very first click. NO_MATCHING_POSTS_MESSAGE
            // (posts.ts) carries the words and the way out of it.
            <p className={`text-center font-['Open_Sans'] text-gray-600`}>
              {NO_MATCHING_POSTS_MESSAGE}
            </p>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
              {shown.map((post) => (
                <PostCard key={post.slug} post={post} />
              ))}
            </div>
          )}

          {total > 1 && (
            <div className="flex justify-center items-center space-x-4">
              {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => goTo(n)}
                  className={`${CONTROL_CLASSNAME} ${page === n ? CONTROL_ON : CONTROL_OFF}`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
