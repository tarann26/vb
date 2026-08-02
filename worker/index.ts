// The admin Worker's entry point. `/api/*` on the site's own zone is the
// only thing routed to this Worker (see wrangler.toml); every path other
// than /api/health, POST /api/login and POST /api/publish still replies 404
// until a later task adds a real route.
//
// Deliberately typed against `@cloudflare/workers-types` (tsconfig.worker.json)
// rather than tsconfig.node.json: this file needs `Response`/`Request`/`fetch`/
// `crypto`, none of which tsconfig.node.json's ES2023-only `lib` declares.
import { verifyPassword, signToken, verifyToken, parseCookie } from './auth';
import { checkLoginRate, recordLoginFailure, clearLoginFailures } from './ratelimit';
import { commitFiles, DisallowedPathError, type CommitFile, type GitHubEnv } from './github';
import { validateContent, type ValidationProblem } from '../src/content/validate';

// Grows as later tasks need more bindings -- only what this file actually
// reads belongs here. GITHUB_OWNER/REPO/BRANCH/TOKEN come in via GitHubEnv
// (worker/github.ts), which also owns the vars' shape so there's one
// definition, not two that could drift.
export interface Env extends GitHubEnv {
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

// path -> filename, e.g. "src/content/dishes.json" -> "dishes.json". Hand
// rolled rather than imported from "node:path": validateContent (Task 2)
// keys its RULES table by bare filename, not by the full repo-relative path
// the dashboard sends, and pulling in a Node built-in for one string split
// isn't worth it in a Worker.
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function isPublishFile(value: unknown): value is CommitFile {
  if (!value || typeof value !== 'object') return false;
  const { path, content, encoding } = value as Record<string, unknown>;
  return typeof path === 'string' && typeof content === 'string' && (encoding === 'utf-8' || encoding === 'base64');
}

async function handlePublish(request: Request, env: Env): Promise<Response> {
  // 1. Verify token -- first, and unconditionally. Nothing below this line
  // runs for an unauthenticated request, which in particular means no
  // GitHub call of any kind: a bad or missing session cookie can't spend
  // any of the N+5 subrequests a real publish costs (see github.ts), let
  // alone write anything.
  const token = parseCookie(request.headers.get('Cookie'), 'vb_session');
  const now = Math.floor(Date.now() / 1000);
  if (!token || !(await verifyToken(env.TOKEN_SECRET, token, now))) {
    return json(401, { message: 'Not authenticated.' });
  }

  // 2. Parse. A malformed envelope (not JSON, no `files` array, a file
  // missing `path`/`content`/`encoding`) is a clean 400 here -- distinct
  // from step 3 below, which is about the *content* of otherwise
  // well-formed files.
  let files: CommitFile[];
  let message: string;
  try {
    const body: unknown = await request.json();
    const rawFiles = (body as { files?: unknown } | null)?.files;
    if (!Array.isArray(rawFiles) || rawFiles.length === 0 || !rawFiles.every(isPublishFile)) {
      return json(400, { message: 'No files to publish.' });
    }
    files = rawFiles;
    // Security review Minor 1: two entries for the same path produce two
    // blobs and two tree entries with the same path; GitHub's tree API
    // keeps the *last* one, not both, so she'd silently get one of two
    // edits she believed were both applied, with no error anywhere. Checked
    // here, in the same "malformed envelope" step as the array-shape check
    // above -- a request naming one path twice is malformed the same way a
    // request missing `path` is, before content validation is ever reached.
    if (new Set(files.map((f) => f.path)).size !== files.length) {
      return json(400, { message: 'The same file was sent twice.' });
    }
    const rawMessage = (body as { message?: unknown } | null)?.message;
    message = typeof rawMessage === 'string' && rawMessage.trim().length > 0 ? rawMessage : 'Update site content';
  } catch {
    return json(400, { message: 'Invalid request body.' });
  }

  // 3. Validate every file before committing any of them. `validateContent`
  // (Task 2) never throws, but `JSON.parse` on her submitted content -- not
  // on the request envelope parsed in step 2 -- can, and this try/catch is
  // what keeps a malformed file body from becoming a 500 reading "something
  // went wrong" one line before the function whose entire contract is
  // "never throws".
  const problems: ValidationProblem[] = files.flatMap((f) => {
    // `encoding` is client-supplied. A security review found that labelling
    // any file `'base64'` -- including one whose *path* is a `.json` file
    // under src/content/ -- skipped validateContent entirely: this used to
    // be a bare `if (f.encoding !== 'utf-8') return [];` with no exception,
    // so a request could opt a content file out of validation just by
    // mislabelling its own encoding. A `.json` path always gets checked
    // regardless of what `encoding` claims; only a genuinely non-JSON path
    // (an image under assets-source/) is exempt from JSON parsing here.
    if (f.encoding !== 'utf-8') {
      return f.path.endsWith('.json') ? [{ field: f.path, message: 'This file must be sent as text.' }] : [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(f.content);
    } catch {
      return [{ field: f.path, message: 'This file is not valid JSON.' }];
    }
    return validateContent(basename(f.path), parsed);
  });
  if (problems.length) return json(422, { problems });

  // 4. Commit only if every file passed. commitFiles carries its own,
  // independent path allowlist (worker/github.ts) -- so a request that
  // somehow reached this point with a path outside src/content/ or
  // assets-source/ still can't make it to GitHub.
  try {
    const { sha } = await commitFiles(env, files, message);
    return json(200, { sha });
  } catch (error) {
    // A disallowed path is a client mistake, not a GitHub failure -- give it
    // its own 400 rather than falling into the generic 502 below, which
    // would misdirect diagnosis toward "GitHub is broken".
    if (error instanceof DisallowedPathError) {
      return json(400, { message: error.message });
    }
    return json(502, { message: error instanceof Error ? error.message : 'Publish failed.' });
  }
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

    if (url.pathname === '/api/publish' && request.method === 'POST') {
      return handlePublish(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};
