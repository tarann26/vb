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
// The commit an undo would put back -- i.e. the parent of the branch head --
// and its own tree. Distinct constants from BASE_* above so a test can prove
// restoreBlobs builds on the CURRENT head's tree and not the parent's, which
// is the difference between an undo and silently deleting every file changed
// since.
export const PARENT_COMMIT_SHA = 'parent-commit-sha-eeee';
export const PARENT_TREE_SHA = 'parent-tree-sha-ffff';
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
    // re-check, and GET /api/content all read through it. Keyed by the exact
    // repo-relative path (e.g. 'src/content/site.json'), ASCII-only content
    // so a plain `btoa` round-trips it cleanly. A path with
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
    // GET /repos/{owner}/{repo}/commits/{ref} -- the REST Commits API,
    // which only getHeadCommit uses. Defaults to a shape no existing suite
    // requests, so nothing already written changes behaviour.
    headCommit?: { sha?: string; parents?: { sha: string }[]; files?: { filename: string }[] };
    // GET /git/trees/{sha}?recursive=1, keyed by tree sha. `truncated` is
    // settable so a test can prove a partial response is refused rather
    // than turned into a partial revert.
    trees?: Record<string, { tree?: { path: string; sha: string; type: string }[]; truncated?: boolean }>;
    // What GET /git/ref/heads/{branch} reports the branch head to be, when a
    // test needs that to DIFFER from the commit the request was authorised
    // against -- i.e. someone else's commit landed mid-request. Setting this
    // also turns on the PATCH branch's non-fast-forward modelling below,
    // which is the only thing that makes "the ref moved" observable as
    // anything other than a different sha in a body. Left undefined by
    // default so nothing already written changes behaviour.
    refSha?: string;
  } = {},
): GitHubStub {
  const calls: RecordedCall[] = [];
  const bodies: Record<string, unknown>[] = [];
  let blobCount = 0;
  // The parent of the most recent POST /git/commits, so the PATCH below can
  // answer the way GitHub actually does: a ref update to a commit that does
  // not descend from the current head is a non-fast-forward, 422.
  let lastCommitParent: string | null = null;

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

    // GET /repos/{owner}/{repo}/commits/{ref} -- matched BEFORE the Git Data
    // `/git/commits/{sha}` branch below, and distinguishable from it because
    // this one has no `/git/` segment at all.
    if (method === 'GET' && /\/repos\/[^/]+\/[^/]+\/commits\/[^/]+$/.test(url) && !url.includes('/git/')) {
      const head = opts.headCommit ?? {
        sha: BASE_COMMIT_SHA,
        parents: [{ sha: PARENT_COMMIT_SHA }],
        files: [{ filename: 'src/content/dishes.json' }],
      };
      return new Response(JSON.stringify(head), { status: 200 });
    }

    // GET /git/trees/{sha}?recursive=1 -- the whole-tree read an undo uses
    // to find the blob shas it should put back.
    if (method === 'GET' && url.includes('/git/trees/')) {
      const treeSha = url.split('/git/trees/')[1].split('?')[0];
      const fixture = opts.trees?.[treeSha] ?? {
        tree: [{ path: 'src/content/dishes.json', sha: 'parent-blob-dishes', type: 'blob' }],
      };
      return new Response(JSON.stringify({ sha: treeSha, truncated: fixture.truncated ?? false, tree: fixture.tree ?? [] }), {
        status: 200,
      });
    }

    // GET /git/ref/heads/{branch} -- singular "ref", the read side.
    if (method === 'GET' && /\/git\/ref\/heads\/[^/]+$/.test(url)) {
      return new Response(
        JSON.stringify({ object: opts.malformedRefSha ? {} : { sha: opts.refSha ?? BASE_COMMIT_SHA } }),
        { status: 200 },
      );
    }

    // GET /git/commits/{sha} -- fetches the base commit's tree sha.
    if (method === 'GET' && /\/git\/commits\/[^/]+$/.test(url)) {
      // The PARENT commit answers with its own, different tree -- otherwise
      // a test could not tell "built on the head's tree" (correct) apart
      // from "built on the parent's tree" (deletes everything since).
      const requested = url.split('/git/commits/')[1];
      if (requested === PARENT_COMMIT_SHA) {
        return new Response(JSON.stringify({ sha: PARENT_COMMIT_SHA, tree: { sha: PARENT_TREE_SHA } }), { status: 200 });
      }
      // Any OTHER commit answers with a tree sha derived from its own sha,
      // for the same reason PARENT_COMMIT_SHA has a distinct one: a test
      // that moves the branch head has to be able to tell "built on the sha
      // the caller validated" apart from "built on whatever the ref says
      // now", and that difference is only visible in `base_tree`.
      if (requested !== BASE_COMMIT_SHA) {
        return new Response(JSON.stringify({ sha: requested, tree: { sha: `tree-of-${requested}` } }), { status: 200 });
      }
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
      const parents = (body as { parents?: unknown } | undefined)?.parents;
      lastCommitParent = Array.isArray(parents) && typeof parents[0] === 'string' ? parents[0] : null;
      return new Response(JSON.stringify({ sha: NEW_COMMIT_SHA }), { status: 201 });
    }

    // PATCH /git/refs/heads/{branch} -- plural "refs", the write side.
    if (method === 'PATCH' && /\/git\/refs\/heads\/[^/]+$/.test(url)) {
      // GitHub's own concurrency guard, modelled only for tests that have
      // actually moved the head (`refSha`): a non-force update to a commit
      // whose parent is not the current head is not a fast-forward, and
      // answers 422 rather than quietly accepting it.
      if (opts.refSha !== undefined && lastCommitParent !== opts.refSha) {
        return new Response(JSON.stringify({ message: 'Update is not a fast forward' }), { status: 422 });
      }
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
