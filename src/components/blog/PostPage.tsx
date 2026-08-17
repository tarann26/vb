// Phase 5. One post at /blog/<slug>.
//
// The title/description dance is PageSeoHead.tsx's, not reinvented: index.html
// ships a STATIC <title> and <meta name="description"> and public/_redirects
// serves that same index.html for every route, so a post's metadata can only
// reach a crawler that runs JavaScript, and only by MUTATING the tags already
// there. document.title is a singleton property and safe to overwrite; the
// description meta is a real DOM node, and appending a second one would leave
// two competing tags with no defined winner. Both are restored on unmount so
// a client-side navigation back to the homepage does not keep this post's.
//
// That is a client-side fix for a server-side problem, and it is honest about
// being one: a crawler that does not execute JavaScript still sees the static
// tags. Sub-plan 5C is what makes the Worker serve real per-post metadata,
// and it is a separate plan because it needs a Worker route pattern that does
// not exist today (see worker/published.ts's own header for the three
// separate reasons).
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useContent } from '../../content/ContentContext';
import { useCanonical } from '../useCanonical';
import { formatArticleDate } from '../../content/article-date';
import NavBar from '../NavBar';
import Footer from '../Footer';
import NotFound from '../NotFound';
import PostBody from './PostBody';
import { POST_TYPE_LABELS, postBySlug } from './posts';
import { usePosts } from './use-posts';

export default function PostPage() {
  const { slug } = useParams<{ slug: string }>();
  const { site } = useContent();
  // The third state, and the reason it exists: a post published since the
  // last deploy is in the database and NOT in the compiled-in list, so
  // "postBySlug found nothing" means "not here YET" until the fetch settles.
  // Rendering NotFound before then would flash a 404 at a reader who followed
  // a link the owner had just given them -- and a crawler that samples the
  // first paint would record it.
  const { status, posts } = usePosts();
  const post = postBySlug(posts, slug);

  const title = post?.title ?? '';
  const description = post?.excerpt ?? '';

  useEffect(() => {
    if (!post) return undefined;
    const previousTitle = document.title;
    document.title = title;

    const descriptionMeta = document.querySelector('meta[name="description"]');
    const previousDescription = descriptionMeta?.getAttribute('content') ?? null;
    if (descriptionMeta) descriptionMeta.setAttribute('content', description);

    return () => {
      document.title = previousTitle;
      if (descriptionMeta && previousDescription !== null) {
        descriptionMeta.setAttribute('content', previousDescription);
      }
    };
  }, [post, title, description]);

  // Called unconditionally, above the early return: a hook called
  // conditionally breaks the rules of hooks, which is the exact reason
  // useCanonical takes `null` as an opt-out value rather than being called
  // inside an `if` (see its own comment).
  useCanonical(post ? `${site.seo.url}/blog/${post.slug}` : null);

  // Order matters: `post` first, so a post that IS in the compiled-in copy
  // renders immediately at first paint and never shows this screen at all.
  if (!post && status === 'loading') {
    return (
      <div className="min-h-screen bg-white">
        <NavBar offHomePage />
        <div className="max-w-3xl mx-auto px-4 py-20">
          {/* role="status", not role="alert": nothing here is a problem, and
              alert is reserved for regions that carry one -- it would also put
              this line inside FIRST_PROBLEM_SELECTOR, which is /edit's "take
              me to what went wrong" query. A status region is the polite one,
              and the promise it makes is one this screen actually keeps: the
              text is advisory, it is not an error, and it does not steal
              focus. What it buys is real on the path that matters most --
              a reader following a link from /blog arrives by client-side
              navigation, so this region is INSERTED into a live document and
              is announced. On a cold load it is part of the first render and
              is simply read in order, which is the honest limit of it. */}
          <p role="status" className={`font-['Open_Sans'] text-gray-600`}>
            Loading this post…
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  // A post that does not exist and a URL that does not exist are the same
  // thing to a visitor and to a crawler -- the same decision App.tsx's
  // PageRoute already made for a disabled page, and for the same reason: a
  // distinct "this post is not here" screen would confirm that a slug is
  // reserved for something. Reached only once the fetch has SETTLED, which is
  // the whole difference this task makes.
  if (!post) return <NotFound />;

  return (
    <div className="min-h-screen bg-white">
      <NavBar offHomePage />
      <article className="max-w-3xl mx-auto px-4 py-20">
        <span className={`bg-brand text-ink px-3 py-1 rounded-full text-xs font-['Montserrat'] font-semibold uppercase tracking-wide`}>
          {POST_TYPE_LABELS[post.type]}
        </span>
        <h1 className={`mt-4 mb-4 font-['Montserrat'] text-4xl md:text-5xl font-bold text-ink`}>{post.title}</h1>
        <p className={`mb-6 font-['Open_Sans'] text-sm text-gray-500`}>{formatArticleDate(post.date)}</p>
        <PostBody blocks={post.blocks} />
      </article>
      <Footer />
    </div>
  );
}
