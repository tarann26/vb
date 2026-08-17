// GET /api/published?path=awards.json -- the public read path.
//
// JSON, not server-rendered HTML, and that is a decision. wrangler.toml
// routes only vb.aionxxxi.uk/api/* to this Worker and the site itself is a
// Pages-hosted SPA, so SSR would need a second route pattern AND a React
// renderer inside this Worker -- which worker/__tests__/bundle.test.ts fails
// the build over, on purpose. Everything that makes this a SEAM rather than
// an endpoint -- the content version, the cache key, invalidation with no
// explicit purge, the snapshot fallback, the source header -- is built here
// and is independent of the body's format. The spec's SSR requirement
// attaches to per-post SEO, which is Phase 5's.
import { D1Store } from './d1';
import { snapshotFor } from './snapshot';

export const CONTENT_SOURCE_HEADER = 'x-content-source';
export type ContentSource = 'd1' | 'cache' | 'snapshot';

// The public API names a file, never a repository path: `?path=awards.json`,
// not `?path=src/content/awards.json`. Two reasons -- the public surface
// should not leak the repo layout, and this map is a positive allowlist, so
// a D1 document added later is private until someone puts it here.
export const PUBLIC_FILES: ReadonlyMap<string, string> = new Map([
  ['awards.json', 'src/content/awards.json'],
  // Phase 4. Unlike awards.json, this document's body is the entire visible
  // content of a homepage section rather than a list beside chrome that
  // renders without it -- so OurStory.tsx paints the compiled-in copy
  // first and swaps this one in when it arrives (Task 7), instead of
  // rendering nothing until it does.
  ['story.json', 'src/content/story.json'],
]);

export interface PublishedEnv {
  DB: D1Database;
}

// The cache key is a URL, so the version has to be IN the URL. That is the
// whole invalidation mechanism: a publish bumps `version`, the next request
// computes a different key, and the old entry is simply never asked for
// again. No purge call, no API token, nothing to fail silently.
//
// Deliberately built on the request's own origin rather than a hardcoded
// host, the same self-configuring posture siteOriginOf takes in index.ts:
// buying the real domain must not quietly split the cache.
export function publicCacheKey(request: Request, file: string, version: number): Request {
  const url = new URL(request.url);
  url.pathname = '/__cache/published';
  url.search = `?file=${encodeURIComponent(file)}&v=${version}`;
  return new Request(url.toString(), { method: 'GET' });
}

function body(text: string, source: ContentSource, sha: string | null): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [CONTENT_SOURCE_HEADER]: source,
    // 60 seconds, not longer, and not `no-store`. The cache KEY carries the
    // version, so the edge is invalidated the instant a publish lands -- but
    // the URL the BROWSER holds does not, so a browser copy can only expire
    // on time. A minute is the honest trade: it is shorter than the 2-3
    // minutes a Pages build used to take for the same edit, which is the bar
    // this path has to clear to be an improvement.
    'Cache-Control': 'public, max-age=60',
  };
  if (sha) headers.ETag = `"${sha}"`;
  return new Response(text, { status: 200, headers });
}

export async function handlePublished(request: Request, env: PublishedEnv, cache: Cache): Promise<Response> {
  const file = new URL(request.url).searchParams.get('path') ?? '';
  const path = PUBLIC_FILES.get(file);
  if (!path) {
    return new Response(JSON.stringify({ message: 'Not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const store = new D1Store(env.DB);

  // One row read to get the version, then a cache lookup on path + version.
  //
  // Worth being exact about what that buys TODAY, because at this size it is
  // not much: the generic `content` table holds one row per document, so
  // reading the version and reading the body cost the same one row, and the
  // cache saves a round trip and a little CPU rather than a meaningful
  // number of D1 reads. It is built now, on a case whose correctness is
  // checkable by hand, because Phase 5's blog reads N block rows per post
  // and the mechanism has to already exist and already be trusted by then.
  // At 5,000,000 row reads/day on the free tier, one row per request is not
  // a constraint at this site's traffic.
  let version: number | null = null;
  try {
    version = await store.version(path);
  } catch {
    // Fall through to the snapshot -- a version read that failed is a
    // database problem, and a database problem must cost freshness, never
    // availability.
    version = null;
  }

  if (version === null) {
    const fallback = snapshotFor(file);
    if (fallback === null) {
      return new Response(JSON.stringify({ message: 'Not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', [CONTENT_SOURCE_HEADER]: 'snapshot' },
      });
    }
    return body(fallback, 'snapshot', null);
  }

  const key = publicCacheKey(request, file, version);
  const hit = await cache.match(key);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set(CONTENT_SOURCE_HEADER, 'cache');
    return new Response(hit.body, { status: hit.status, headers });
  }

  let stored;
  try {
    stored = await store.read(path);
  } catch {
    const fallback = snapshotFor(file);
    if (fallback === null) {
      return new Response(JSON.stringify({ message: 'Temporarily unavailable.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', [CONTENT_SOURCE_HEADER]: 'snapshot' },
      });
    }
    return body(fallback, 'snapshot', null);
  }

  if (!stored) {
    const fallback = snapshotFor(file);
    return fallback === null
      ? new Response(JSON.stringify({ message: 'Not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      : body(fallback, 'snapshot', null);
  }

  const response = body(stored.content, 'd1', stored.sha);
  // Stored BEFORE the router's security headers run. withSecurityHeaders
  // rewrites Cache-Control to no-store on everything this Worker returns,
  // and a no-store response is not something the Cache API will keep -- so
  // caching has to happen here, on the response this handler built, not on
  // the one the router eventually hands back.
  await cache.put(key, response.clone());
  return response;
}
