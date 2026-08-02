// The admin Worker's entry point. Scaffold only (Task 3 of the worker plan):
// no real route does anything yet, and there is nothing here for a visitor
// to reach -- `/api/*` on the site's own zone is the only thing routed to
// this Worker (see wrangler.toml), and every path other than /api/health
// replies 404 until a later task adds a real route.
//
// Deliberately typed against `@cloudflare/workers-types` (tsconfig.worker.json)
// rather than tsconfig.node.json: this file needs `Response`/`Request`/`fetch`/
// `crypto`, none of which tsconfig.node.json's ES2023-only `lib` declares.
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Unauthenticated by design and reveals nothing (no version, no commit
    // sha, no env var, no account/zone detail) -- its only job is letting a
    // human confirm the Worker route is actually live rather than the
    // request having silently fallen through to the Pages SPA catch-all.
    // public/_redirects cannot express that check itself (Cloudflare Pages'
    // _redirects only accepts a handful of status codes, none of which can
    // signal "this path is unrouted" -- see that file's own comment), so
    // this is the endpoint docs/cloudflare-cutover.md's deploy-time curl
    // check hits: `text/html` back means the SPA answered instead of this
    // Worker, `application/json` means the route is working.
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
