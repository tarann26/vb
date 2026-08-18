// The homepage's blog section, behind the `press` SectionId. Phase 5B, and
// 5A's Task 9 finally landing.
//
// The id stays `press` and the anchor stays `#blogs`, and neither is
// negligence: that id is load-bearing in seven places (the SectionId union,
// sections.json's pinned order, SECTION_COMPONENTS in two files, Copy['press']
// and its COPY_FIELDS leaves, copy.json's nav link, and this anchor), and the
// anchor is a live URL somebody may have bookmarked. Phase 1 made the same
// call for ourStory, which displays as "About" at #our-story: renaming the
// display without renaming the id is this codebase's established pattern, not
// a compromise -- types.ts says so in its own comment about atmosphere
// displaying as "Gallery".
//
// It reads usePosts, NOT useContent().posts, and that is the reason this task
// comes after the D1 move: the compiled-in list is a build-time snapshot, so a
// homepage reading it while /blog read the database would show stale cards
// after every publish -- two surfaces giving two answers about one thing.
//
// PostCard is shared with /blog verbatim, one component and not two: Phase 3's
// final review found two sections shipping as grey 96px thumbnails precisely
// because the same visual idea had two implementations and only one of them
// was ever looked at.
import { Link } from 'react-router-dom';
import { useContent } from '../../content/ContentContext';
import { usePosts } from './use-posts';
import { EMPTY_POSTS_MESSAGE, sortedPosts } from './posts';
import PostCard from './PostCard';

// Three, matching what BlogTeaser showed before it and what a three-across
// grid fills exactly. The full list is one click away.
const HOMEPAGE_POSTS = 3;

export default function BlogSection() {
  const { copy, renderText } = useContent();
  const { posts } = usePosts();
  const shown = sortedPosts(posts).slice(0, HOMEPAGE_POSTS);

  return (
    <section id="blogs" className="py-20 relative bg-wash">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className={`mb-6 font-['Montserrat'] text-4xl md:text-5xl font-bold text-ink`}>
            {renderText('press.heading', copy.press.heading)}
          </h2>
          <p className={`font-['Open_Sans'] text-gray-700 max-w-2xl mx-auto leading-relaxed`}>
            {renderText('press.intro', copy.press.intro)}
          </p>
        </div>

        {shown.length === 0 ? (
          // The same honest empty state BlogIndex renders -- EMPTY_POSTS_MESSAGE
          // (posts.ts) is the one place this sentence is written, so the two
          // surfaces cannot drift into describing one situation two ways.
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

        <div className="text-center">
          <Link
            to="/blog"
            className={`inline-block rounded-lg bg-brand px-6 py-3 font-['Montserrat'] text-sm uppercase tracking-wide text-ink transition hover:bg-brand-dark`}
          >
            {renderText('press.viewAll', copy.press.viewAll)}
          </Link>
        </div>
      </div>
    </section>
  );
}
