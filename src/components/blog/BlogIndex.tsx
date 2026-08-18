// Phase 5. /blog -- every post, newest first, nine to a page.
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
import { EMPTY_POSTS_MESSAGE, pageCount, pageSlice, sortedPosts } from './posts';
import { usePosts } from './use-posts';

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
  useCanonical(`${site.seo.url}/blog`);

  const total = pageCount(posts);
  // The sort is spelled out here rather than hidden inside the slice, which
  // is what `pageOf` used to do. Task 29 split the two so the controls it
  // adds -- filter, search, sort -- can compose in front of the paging;
  // Task 30 replaces this line with `visiblePosts`. What this page shows
  // today is unchanged: newest first, nine to a page.
  const shown = pageSlice(sortedPosts(posts), page);

  function goTo(next: number): void {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
                  className={`px-4 py-2 rounded-lg font-['Montserrat'] text-sm transition-colors duration-300 ${
                    page === n ? 'bg-brand text-ink' : 'bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
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
