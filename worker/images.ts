// GET /images/<key> -- the photograph itself, read out of the R2 bucket and
// returned.
//
// WHY THIS EXISTS AT ALL, since the design spec once said the opposite.
// docs/superpowers/specs/2026-08-21-content-out-of-git-design.md's "R2's
// public URL is not usable in production" ruled out serving images through
// the Worker and chose an R2 custom domain, img.viabiancarestaurant.com.
// The owner chose the main domain instead. The subdomain would have needed a
// DNS record and a public-access change on the live zone -- a dashboard step
// only she can take, on a site she does not administer confidently -- and it
// would have put photographs on an origin the site's own CSP had to be
// widened for. Same origin needs neither. That section of the spec now
// records this decision instead of the one it superseded.
//
// ---------------------------------------------------------------------------
// THE COST THE SPEC WAS RIGHT ABOUT, and what actually pays it.
//
// Workers Free allows 100,000 requests a day. Photographs are the highest-
// volume request type on any site: one page view of the homepage asks for
// roughly a dozen. A Worker route is invoked for every matching request that
// reaches Cloudflare -- the CDN cache does not answer in a Worker's place,
// which is the entire reason the Cache API exists -- so nothing in this file
// can make a request that arrives cost zero.
//
// What makes it cost zero is the request NOT ARRIVING, and that is bought
// with one header. `Cache-Control: public, max-age=31536000, immutable` on a
// content-addressed key means a browser fetches that photograph once, ever,
// and re-renders it from disk on every later page view without asking. The
// difference is not marginal: without it, a returning diner clicking through
// four pages spends forty-odd invocations, and the site's own traffic is
// enough to exhaust a day's budget -- at which point the Worker stops
// answering /api/* too, so a publish and a login die alongside the pictures.
//
// The value is NOT a constant here. src/shared/image-host.ts's
// cacheControlForKey owns it, because a year is only correct for a key named
// after its own hash. A legacy human-named photograph can be re-uploaded
// under the same key, and nothing in this system purges R2 or the edge, so
// those get a day. See that function's own comment.
//
// It is set AFTER writeHttpMetadata deliberately. R2 stores a Cache-Control
// with each object (scripts/migrate-images.mjs writes it at upload time) and
// writeHttpMetadata replays it, but an object uploaded some other way -- by
// hand, by a future path that forgets -- would then be served with whatever
// happened to be stored, or with nothing. One rule, applied here, to every
// object, whatever its metadata says.
// ---------------------------------------------------------------------------
//
// A MISS IS A 404 AND IT IS NEVER A 200. An empty 200 is how a broken
// photograph looks fine to a crawler, fine to a status check and blank to a
// diner: the status code says the picture is there, the body says nothing,
// and the only place the failure is visible is a page nobody is looking at
// with the network tab open. A 500 is not the answer either -- an object that
// was never uploaded is not an error on this site's part, and a 5xx on a
// photograph invites retries and alarms for a key that is simply absent.
import { IMAGE_BASE, cacheControlForKey, keyFromImageUrl } from '../src/shared/image-host';

export interface ImagesEnv {
  R2: R2Bucket;
}

// The predicate the router branches on AND the one worker/index.ts consults
// when deciding whether to overwrite Cache-Control. Two predicates -- one
// choosing the handler, one choosing the headers -- is two things that must
// agree forever, checked by nobody; `servesSiteHtml` in worker/index.ts is
// shared between its two callers for exactly this reason and this follows it.
//
// GET and HEAD, and no other method. HEAD because every uptime monitor, link
// checker and crawler probes with one before fetching, and the Workers
// runtime does not turn a HEAD into a GET on a handler's behalf. Anything
// else falls through to the router and gets its 404 with the full security
// header set -- there is nothing to POST to a photograph.
export function servesImageBytes(request: Request): boolean {
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') return false;
  return new URL(request.url).pathname.startsWith(IMAGE_BASE + '/');
}

// `no-store` on the miss, spelled out here rather than left to
// worker/index.ts's header set. That set skips Cache-Control for anything
// under this prefix -- the exemption that lets a photograph carry a year -- so
// without this line a 404 leaves the Worker with NO Cache-Control at all, and
// RFC 9110 lists 404 among the statuses a cache may store HEURISTICALLY when
// nothing says otherwise. During the migration that is a live hazard: a
// reference requested in the window before its object lands would get a 404
// that the edge then holds after the object arrives, and the photograph stays
// missing with the bytes sitting in the bucket.
function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleImage(request: Request, env: ImagesEnv): Promise<Response> {
  // The pathname, not the whole URL, and keyFromImageUrl is the only thing
  // that turns one into a key. It is the same function the browser bundle and
  // every script read, so the encoding this end decodes is by construction the
  // encoding the other end produced -- and it is where `..` is refused, in
  // front of R2 rather than after it.
  const key = keyFromImageUrl(new URL(request.url).pathname);
  if (key === null) return notFound();

  const object = await env.R2.get(key);
  if (object === null) return notFound();

  const headers = new Headers();
  // Content-Type comes from the object's own stored metadata, which
  // scripts/migrate-images.mjs sets from the key's extension after sniffing
  // the bytes -- ten of the archived originals carry a .jpg name over PNG
  // data, so the extension alone is not the answer and that script already
  // works it out. A photograph served as application/octet-stream downloads
  // instead of painting, so an object with no stored type gets none from here
  // either: nosniff is added by worker/index.ts's header set, and a browser
  // refusing to paint an untyped byte stream is a louder failure than one
  // silently offering to save it.
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', cacheControlForKey(key));
  headers.set('ETag', object.httpEtag);

  // A hard refresh revalidates even an immutable response, and R2 hands us
  // the etag it would be compared against. Answering 304 there costs the
  // Worker invocation either way and saves the whole body.
  if (request.headers.get('If-None-Match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}
