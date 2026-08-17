// Phase 5. One card, rendered identically by the index (/blog) and by the
// homepage section -- ONE component, not two, because Phase 3's final review
// found two sections shipping as grey 96px thumbnails precisely because the
// same visual idea had two implementations and only one of them was looked
// at. The markup and every class string come from BlogsPage.tsx, which is
// what put these rules in the stylesheet in the first place; reusing them
// verbatim is what keeps this task's CSS cost at zero.
//
// The card links to /blog/<slug> -- INTERNALLY. The old press card linked
// straight out to the publication, which meant the site's own "Latest
// Stories" section existed to send visitors somewhere else. A Mention post
// still cites and links the publication; it does it inside the post, where a
// reader has already arrived.
import { Link } from 'react-router-dom';
import { formatArticleDate } from '../../content/article-date';
import type { Post } from '../../content/types';
import { POST_TYPE_LABELS } from './posts';

export default function PostCard({ post }: { post: Post }) {
  return (
    <article className="bg-white rounded-2xl shadow-lg hover:shadow-2xl transform hover:scale-105 transition-all duration-300 overflow-hidden group">
      <Link to={`/blog/${post.slug}`}>
        <div className="h-48 relative overflow-hidden">
          <img
            src={post.image}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
          <div className="absolute top-4 left-4">
            <span className={`bg-brand text-ink px-3 py-1 rounded-full text-xs font-['Montserrat'] font-semibold uppercase tracking-wide`}>
              {POST_TYPE_LABELS[post.type]}
            </span>
          </div>
        </div>
        <div className="p-6">
          <p className={`mb-3 font-['Open_Sans'] text-sm text-gray-500`}>{formatArticleDate(post.date)}</p>
          <h3 className={`mb-3 font-['Montserrat'] font-bold text-lg text-ink leading-tight group-hover:text-accent transition-colors duration-300`}>
            {post.title}
          </h3>
          <p className={`font-['Open_Sans'] text-gray-600 text-sm leading-relaxed`}>{post.excerpt}</p>
        </div>
      </Link>
    </article>
  );
}
