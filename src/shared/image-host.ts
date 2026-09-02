// Where photographs are served from, as one constant the Worker, the browser
// bundle and every script under scripts/ all read.
//
// IT IS A PATH, NOT A HOSTNAME, and the whole of this file's previous design
// note is superseded by that one fact. The bucket used to be reached at
// img.viabiancarestaurant.com, an R2 custom domain; the owner chose the main
// domain instead, so `viabiancarestaurant.com/images/*` is a Worker route and
// worker/images.ts reads the object out of the R2 binding and returns it.
// No second subdomain, no second DNS record, no second certificate story,
// nothing for a non-technical owner to connect in a dashboard before a single
// photograph can move.
//
// The constant is therefore a SITE-ROOT PREFIX and the reference it builds is
// a relative one, which resolves against whichever host served the page --
// the apex, the Pages production alias, a preview deployment, `vite dev` on a
// laptop. A hardcoded https:// origin would have been wrong on three of those
// four.
//
// The name changed with the value. `IMAGE_HOST = "/images"` would have been a
// false statement sitting in the one file that exists to be the single source
// of this answer, and the previous name is what invited
// src/content/asset-reference.ts to parse it as a URL -- code that throws the
// moment the value stops being one.
export const IMAGE_BASE = '/images';

// An R2 object key, e.g. food/pizza1.webp, to the reference a browser fetches.
//
// Keys never carry a leading slash: R2 treats a key that starts with one and
// the otherwise identical key that does not as two separate objects, and half
// this codebase's paths carry one. The boundary is enforced here rather than
// remembered at each call site.
//
// The two spellings are NOT written out here as examples, deliberately. A
// site-root path inside a quoted or backticked span in any src/ file is a
// real reference as far as src/content/__tests__/assets.test.ts is concerned,
// and it fails the suite demanding a file that was only ever illustrative.
// That is not hypothetical: this comment's first draft did exactly it.
//
// encodeURI, because five of this library's filenames carry spaces
// (mocktails/blood orange espresso tonic.webp, mocktails/signor bianca.webp,
// mocktails/viola and sambuco.webp among them). As a bare path in an img
// element the browser would encode those itself; sitting inside JSON, inside
// a CSS url(), or being compared against a request's own pathname they have
// to arrive already encoded, or the request goes to a different key than the
// one R2 holds.
export function imageUrl(key: string): string {
  if (key.startsWith('/')) throw new Error(`imageUrl: key must not start with a slash, got "${key}"`);
  return IMAGE_BASE + '/' + encodeURI(key);
}

// The inverse, returning null for anything that is not one of ours -- a path
// outside the prefix, a whole URL on some other host, a bare filename.
// Callers use the null to mean "not an image reference", never "broken".
//
// It takes a PATH, and worker/images.ts hands it a request's own pathname
// unchanged. That is the reason it refuses an absolute URL even on this
// site's own origin: the Worker never sees one, and accepting a shape the
// only production caller cannot produce would be widening the R2 key space a
// request can name for no caller's benefit.
//
// THE TRY/CATCH IS NOT DEFENSIVE PADDING. `decodeURI` throws a URIError on a
// malformed escape, and a stranger can put one in a pathname just by typing a
// percent sign followed by two characters that are not hex. The URL parser
// keeps such a run in the pathname untouched, so the throw happens here,
// inside the Worker, and an uncaught throw in a fetch handler is a 500. A key
// nothing could have written is a MISS, and a miss is a 404 -- see
// worker/images.ts on why that distinction is worth a branch. (The failing
// example is deliberately not written out above: a leading slash and an image
// extension inside a quoted or backticked span is a real reference to
// src/content/__tests__/assets.test.ts, which then demands the file exist.
// Confirmed by this comment's own first draft, exactly as the paragraph on
// imageUrl says.)
export function keyFromImageUrl(url: string): string | null {
  const prefix = IMAGE_BASE + '/';
  if (!url.startsWith(prefix)) return null;
  let key: string;
  try {
    key = decodeURI(url.slice(prefix.length));
  } catch {
    return null;
  }
  return key.length > 0 && !key.includes('..') ? key : null;
}

// Twelve hex characters before the extension is worker/upload.ts's
// content-addressed key shape: the bytes under such a key are named by their
// own hash, so they can never legitimately change and a browser may keep them
// until it runs out of disk.
//
// A LEGACY HUMAN-NAMED KEY IS NOT THAT, and the difference is why there are
// two answers here rather than one blanket year. The fifty photographs that
// existed before the migration are named for what they show, and a corrected
// one is re-uploaded under the SAME key. Nothing in this system purges R2 or
// the edge, so a year-long response for one of those would leave the old
// photograph on every screen that had already loaded it until the browser
// evicted it -- which for a returning diner could be never.
//
// scripts/migrate-images.mjs owns the identical rule and writes the answer
// into each object's own R2 metadata at upload time. This is the second
// spelling of it, in TypeScript, because that script is plain Node and the
// Worker cannot import a .mjs from outside its own tsconfig project -- the
// same split, and the same remedy, that src/shared/derivative-path.ts and
// scripts/paths.mjs already live with. The link between them is a test that
// runs both (src/shared/__tests__/image-host.test.ts), not an import.
const HASH_STEM = /\/[0-9a-f]{12}\.[a-z0-9]+$/i;

export function cacheControlForKey(key: string): string {
  return HASH_STEM.test('/' + key)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400';
}
