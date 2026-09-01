// What a photograph reference is allowed to look like, for every boundary
// that has to decide: the import-time guards (./guards), the Worker's write
// gate (./validate) and the browser's runtime shape check on a document read
// out of D1 (../components/story-api.ts). ONE answer, read from one place,
// because those ends have disagreed before -- the shape they disagreed about
// was a slash followed by a backslash, which a browser fetches from somebody
// else's host.
//
// Until the 2026-08-21 migration there was one valid shape, a path on this
// site, and `isSiteRelativePath` (./markdown) was the whole answer. The
// migration moves every photograph into the R2 bucket served from
// src/shared/image-host.ts's IMAGE_HOST, so a second shape becomes valid: a
// URL on that host and on no other.
//
// WHY THIS LANDS BEFORE THE REWRITE RATHER THAN WITH IT.
// scripts/rewrite-image-refs.mjs turns seventy-seven references from the
// first shape into the second in a single commit. Without this widening in
// place first, that commit does not merely redden a test: `assertPosts` runs
// at module scope in src/content/index.ts, vite.config.ts imports that
// module, and `npm run build` therefore exits 1 before it emits anything.
// Measured on 2026-09-01 by running the rewrite over the real tree: 54 of
// 195 test files red, and the build stopping at
// `content/posts.json: "bw-hotelier-regional-flair" needs a photo ...`.
// Nothing deploys, so the site keeps serving its last good build -- the
// failure is loud rather than a page of missing photographs, which is the
// one mercy in it. This widening is inert until something actually names the
// image host, so it is safe to ship on its own and it has to.
//
// THE RULE IS NOT "ANY ABSOLUTE URL", and the reason the old check refused
// one is unchanged: a photograph on a third party's host hands that party
// every visitor's IP address and referrer, and hands anyone who can write
// content an arbitrary URL inside an <img src>. The image host is this
// site's own bucket, on a subdomain of this site's own zone, covered by the
// apex's Strict-Transport-Security and named in public/_headers' img-src.
// Nothing else passes.
import { IMAGE_HOST } from '../shared/image-host';
import { isSiteRelativePath } from './markdown';

// The ORIGIN, computed once, is what an answer is measured against -- never
// a prefix test on the constant. A prefix test answers "does this text begin
// with these characters"; the parser answers "where does a browser send this
// request", and only the second question is worth asking at a boundary whose
// whole job is deciding whose host a photograph comes from. Same posture
// isSiteRelativePath takes, and for the same reason.
const IMAGE_ORIGIN = new URL(IMAGE_HOST).origin;

// A whole URL on the image host, naming an object rather than the bare host.
export function isImageHostUrl(value: string): boolean {
  const url = value.trim();
  // In FRONT of the parser rather than left to it, exactly as
  // isSiteRelativePath does it and for the same reason: the parser resolves
  // traversal instead of refusing it, so `/a/../../b` would arrive here
  // looking perfectly ordinary. A key with two dots in it is not a key
  // anything in this repository writes.
  if (url.includes('..')) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Everything relative lands here, which is correct: a path on this site
    // is the other function's answer to give, not this one's.
    return false;
  }
  // A userinfo field is refused rather than ignored. `origin` drops it, so
  // https://someone@img.<host>/x.webp would otherwise pass on an origin it
  // does not literally spell, and no reference this repository produces has
  // one.
  if (parsed.username !== '' || parsed.password !== '') return false;
  // pathname is "/" for the bare host, with or without its trailing slash.
  return parsed.origin === IMAGE_ORIGIN && parsed.pathname.length > 1;
}

// The one question every boundary asks: may this site put this string in an
// img src, a link to a menu, or an og:image?
export function isSiteAssetReference(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return isSiteRelativePath(value) || isImageHostUrl(value);
}
