// What a photograph reference is allowed to look like, for every boundary
// that has to decide: the import-time guards (./guards), the Worker's write
// gate (./validate) and the browser's runtime shape check on a document read
// out of D1 (../components/story-api.ts). ONE answer, read from one place,
// because those ends have disagreed before -- the shape they disagreed about
// was a slash followed by a backslash, which a browser fetches from somebody
// else's host.
//
// THE ANSWER IS ONE SHAPE AGAIN, and the shape is a path on this site.
//
// It was briefly two. The 2026-08-21 migration was going to move every
// photograph onto img.viabiancarestaurant.com, an R2 custom domain, so this
// module grew a second predicate admitting a whole URL on that host and on no
// other -- with a userinfo check, an origin comparison rather than a prefix
// test, and a traversal refusal in front of the parser, because deciding
// whose host a photograph comes from is exactly the kind of question a
// careless `startsWith` gets wrong.
//
// The owner chose the main domain instead. `viabiancarestaurant.com/images/*`
// is a Worker route that reads the object out of the bucket
// (worker/images.ts), so a migrated reference is `/images/<key>` -- a path on
// this site, which is the shape this module already admitted and always did.
// The second predicate is deleted rather than left in place unused: a
// predicate that admits a foreign origin is a widening whether or not
// anything currently produces one, and there is no longer a reason for this
// site to admit any host but its own.
//
// THE RULE IS STILL NOT "ANY ABSOLUTE URL", and the reason has not changed: a
// photograph on a third party's host hands that party every visitor's IP
// address and referrer, and hands anyone who can write content an arbitrary
// URL inside an img src.
import { isSiteRelativePath } from './markdown';

// The one question every boundary asks: may this site put this string in an
// img src, a link to a menu, or an og:image?
//
// A one-line wrapper over one predicate, kept rather than folded away, and
// the reason is the four boundaries above. They import THIS name; what it
// means is decided here, in one place, and it has already been two things.
// Deleting it would put the next widening -- or the next narrowing -- back to
// being four separate edits that have to agree.
export function isSiteAssetReference(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return isSiteRelativePath(value);
}
