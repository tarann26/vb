// The admin Worker's entry point. Scaffold only (Task 3 of the worker plan):
// no route does anything yet, and there is nothing here for a visitor to
// reach -- `/api/*` on the site's own zone is the only thing routed to this
// Worker (see wrangler.toml), and every path replies 404 until a later task
// adds a real route.
//
// Deliberately typed against `@cloudflare/workers-types` (tsconfig.worker.json)
// rather than tsconfig.node.json: this file needs `Response`/`Request`/`fetch`/
// `crypto`, none of which tsconfig.node.json's ES2023-only `lib` declares.
export default {
  async fetch(): Promise<Response> {
    return new Response('Not found', { status: 404 });
  },
};
