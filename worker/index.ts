// The admin Worker's entry point. `/api/*` on the site's own zone is the
// only thing routed to this Worker (see wrangler.toml); every path other
// than /api/health and POST /api/login still replies 404 until a later
// task adds a real route.
//
// Deliberately typed against `@cloudflare/workers-types` (tsconfig.worker.json)
// rather than tsconfig.node.json: this file needs `Response`/`Request`/`fetch`/
// `crypto`, none of which tsconfig.node.json's ES2023-only `lib` declares.
import { verifyPassword, signToken } from './auth';
import { checkLoginRate, recordLoginFailure, clearLoginFailures } from './ratelimit';

// Grows as later tasks need more bindings (GITHUB_TOKEN in Task 5, etc.) --
// only what this file actually reads belongs here.
export interface Env {
  KV: KVNamespace;
  ADMIN_PASSWORD_HASH: string;
  TOKEN_SECRET: string;
}

// 7 days. Rotating ADMIN_PASSWORD_HASH alone does not invalidate a session
// token already issued under the old password -- a token's validity comes
// entirely from TOKEN_SECRET (see worker/auth.ts's verifyToken), not from
// whether the password that produced it is still current. Revoking an
// outstanding session requires rotating TOKEN_SECRET too; see
// docs/cloudflare-cutover.md.
const SESSION_SECONDS = 604_800;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  // IP-only limiting, checked before the request body is even read -- see
  // worker/ratelimit.ts for why this is KV rather than the Workers Rate
  // Limiting binding. `CF-Connecting-IP` is set by Cloudflare itself on
  // every request that reaches a Worker; unlike an arbitrary header, a
  // client cannot forge it to pin someone else's IP or dodge the limiter
  // for its own.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await checkLoginRate(env.KV, ip))) {
    return json(429, { message: 'Too many attempts. Try again in 15 minutes.' });
  }

  let password: unknown;
  try {
    const body: unknown = await request.json();
    password = (body as { password?: unknown } | null)?.password;
  } catch {
    return json(400, { message: 'Invalid request body.' });
  }

  if (typeof password !== 'string' || password.length === 0) {
    return json(400, { message: 'Password required.' });
  }

  // The supplied password is never logged, in any form, on any path below
  // -- not the plaintext, not a hash of it, whether the login succeeds or
  // fails.
  if (!(await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) {
    await recordLoginFailure(env.KV, ip);
    return json(401, { message: 'Incorrect password.' });
  }

  await clearLoginFailures(env.KV, ip);

  // Checked here, not left for signToken to discover: `crypto.subtle`
  // rejects a zero-length HMAC key with an unhandled throw rather than a
  // clean failure (see worker/auth.ts's verifyToken for the same issue on
  // the read side). Without this, an operator who sets ADMIN_PASSWORD_HASH
  // but not TOKEN_SECRET yet -- entirely possible mid-setup, see
  // docs/cloudflare-cutover.md's Step 10 -- would type the correct
  // password and get a Cloudflare error page instead of the clean failure
  // the runbook promises.
  if (!env.TOKEN_SECRET) {
    return json(500, { message: 'Login is not configured.' });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = await signToken(env.TOKEN_SECRET, expiresAt);
  return new Response(null, {
    status: 204,
    headers: {
      'Set-Cookie': `vb_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    if (url.pathname === '/api/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};
