// A hand-built fetch stub for GitHub's Git Data API, shared between
// github.test.ts (which exercises commitFiles directly) and index.test.ts
// (which exercises POST /api/publish's ordering through commitFiles). Not a
// `*.test.ts` file itself -- Vitest's default include glob only picks up
// `*.test.ts`/`*.spec.ts`, so this sits alongside the suites it supports
// without being collected as one of them (same pattern as src/test/setup.ts
// and src/test/publicFiles.ts).
//
// Records METHOD, URL and BODY for every call, not just a count. The bug
// this whole task guards against -- a tree built without `base_tree`,
// silently deleting the rest of the repository on the next ref update -- is
// invisible to a call counter; only inspecting bodies catches it.
import { vi } from 'vitest';

export const BASE_COMMIT_SHA = 'base-commit-sha-aaaa';
export const BASE_TREE_SHA = 'base-tree-sha-bbbb';
export const NEW_TREE_SHA = 'new-tree-sha-cccc';
export const NEW_COMMIT_SHA = 'new-commit-sha-dddd';

export interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

export interface GitHubStub {
  fetch: typeof fetch;
  calls: RecordedCall[];
  // Parsed JSON bodies only, in call order -- GET calls (no body) are not
  // represented here, so `.find((b) => b.tree)` etc. only ever considers
  // requests that actually sent one.
  bodies: Record<string, unknown>[];
}

export function makeGitHubStub(
  opts: {
    failOn?: string;
    failStatus?: number;
    // Raw response body text for the `failOn` case. Defaults to a small JSON
    // object; a test that wants to prove GitHub's own error text survives
    // into the thrown message passes a realistic-looking one here.
    failBody?: string;
    // Reproduces a GitHub response that is 200 OK but malformed: the ref (or
    // its commit) answers with an object that has no `sha` at all, rather
    // than erroring outright. See github.ts's own comment on why this is
    // checked explicitly instead of trusting `body.object.sha` /
    // `body.tree.sha` to be a string.
    malformedRefSha?: boolean;
    malformedTreeSha?: boolean;
    // GET /contents/{path} fixtures for `getFileContent` -- Task 3's
    // `baseSha` check on POST /api/publish, the site.json developer-owned
    // re-check, and GET /api/content all read through it now, not just the
    // cron's `reconcileScheduleFromSource`. Keyed by the exact
    // repo-relative path (e.g. 'src/content/site.json'), ASCII-only content
    // so a plain `btoa` round-trips it cleanly (same constraint
    // scheduled.test.ts's own `contentsApiResponse` documents). A path with
    // no entry here answers 404 -- `getFileContent` treats that as "no
    // current content" without throwing, which is the safe, deliberate
    // default: unlike every other GitHub endpoint this stub answers, a GET
    // /contents/ request is now something MANY existing tests trigger
    // incidentally (any site.json publish, via the developer-owned
    // re-check) rather than only tests that opted into it -- an
    // "unexpected request" throw here would turn every one of those into a
    // failure over a read they never meant to exercise.
    contents?: Record<string, { content: string; sha: string }>;
    // A genuine read failure for one specific GET /contents/ path (a GitHub
    // outage, not "file doesn't exist") -- separate from `failOn` above
    // because that option matches with `url.endsWith(...)`, and a Contents
    // API request always ends with `?ref={branch}`, never with the bare
    // path -- `failOn` alone can never target this endpoint.
    contentsFailPath?: string;
    contentsFailStatus?: number;
  } = {},
): GitHubStub {
  const calls: RecordedCall[] = [];
  const bodies: Record<string, unknown>[] = [];
  let blobCount = 0;

  const fetchStub = vi.fn(async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = init.method ?? 'GET';
    let body: unknown;
    if (typeof init.body === 'string') {
      body = JSON.parse(init.body) as Record<string, unknown>;
      bodies.push(body as Record<string, unknown>);
    }
    calls.push({ method, url, body });

    // Matched with `endsWith`, not `includes`, and for the same reason the
    // production code in github.ts distinguishes `/git/ref/` (GET, singular)
    // from `/git/refs/` (PATCH, plural): GitHub's "get a commit"
    // (`/git/commits/{sha}`, GET) and "create a commit" (`/git/commits`,
    // POST) both *contain* `/git/commits` -- only the create call *ends
    // with* it. An `includes` match here would make a test that means to
    // fail only the create-commit call also fail the earlier
    // get-commit-for-the-base-tree-sha call, and the test would still go
    // green, just not for the reason its name claims.
    if (opts.failOn && url.endsWith(opts.failOn)) {
      return new Response(opts.failBody ?? JSON.stringify({ message: 'stubbed failure' }), {
        status: opts.failStatus ?? 500,
      });
    }

    // GET /contents/{path}?ref={branch} -- getFileContent's endpoint, the
    // Contents API rather than the Git Data API every other branch here
    // answers. Split on '?' and on '/contents/' rather than a regex, so
    // this doesn't care where `?ref=` falls or what branch name it names.
    if (method === 'GET' && url.includes('/contents/')) {
      const path = url.split('?')[0].split('/contents/')[1];
      if (opts.contentsFailPath && path === opts.contentsFailPath) {
        return new Response(JSON.stringify({ message: 'stubbed failure' }), {
          status: opts.contentsFailStatus ?? 500,
        });
      }
      const fixture = opts.contents?.[path];
      if (!fixture) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ content: btoa(fixture.content), encoding: 'base64', sha: fixture.sha }), {
        status: 200,
      });
    }

    // GET /git/ref/heads/{branch} -- singular "ref", the read side.
    if (method === 'GET' && /\/git\/ref\/heads\/[^/]+$/.test(url)) {
      return new Response(JSON.stringify({ object: opts.malformedRefSha ? {} : { sha: BASE_COMMIT_SHA } }), {
        status: 200,
      });
    }

    // GET /git/commits/{sha} -- fetches the base commit's tree sha.
    if (method === 'GET' && /\/git\/commits\/[^/]+$/.test(url)) {
      return new Response(
        JSON.stringify({ sha: BASE_COMMIT_SHA, tree: opts.malformedTreeSha ? {} : { sha: BASE_TREE_SHA } }),
        { status: 200 },
      );
    }

    if (method === 'POST' && url.endsWith('/git/blobs')) {
      const sha = `blob-sha-${blobCount++}`;
      return new Response(JSON.stringify({ sha }), { status: 201 });
    }

    if (method === 'POST' && url.endsWith('/git/trees')) {
      return new Response(JSON.stringify({ sha: NEW_TREE_SHA }), { status: 201 });
    }

    if (method === 'POST' && url.endsWith('/git/commits')) {
      return new Response(JSON.stringify({ sha: NEW_COMMIT_SHA }), { status: 201 });
    }

    // PATCH /git/refs/heads/{branch} -- plural "refs", the write side.
    if (method === 'PATCH' && /\/git\/refs\/heads\/[^/]+$/.test(url)) {
      return new Response(JSON.stringify({ object: { sha: NEW_COMMIT_SHA } }), { status: 200 });
    }

    throw new Error(`githubStub: unexpected request ${method} ${url}`);
  });

  return { fetch: fetchStub as unknown as typeof fetch, calls, bodies };
}

// Stubs global `fetch` with the given stub's handler and returns a GitHubEnv
// fixture to pass alongside it. Not a realistic-looking token -- see
// src/test/secrets.test.ts, which fails the suite on anything shaped like a
// real GitHub token or password hash appearing in a tracked file.
export function envWith(stub: GitHubStub) {
  vi.stubGlobal('fetch', stub.fetch);
  return {
    GITHUB_OWNER: 'tarann26',
    GITHUB_REPO: 'vb',
    GITHUB_BRANCH: 'main',
    GITHUB_TOKEN: 'test-fixture-token-not-real',
  };
}

export function utf8(path: string, content: string): { path: string; content: string; encoding: 'utf-8' } {
  return { path, content, encoding: 'utf-8' };
}
