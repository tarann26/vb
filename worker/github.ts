// One Publish is one commit, built directly through GitHub's Git Data API
// (blobs -> tree -> commit -> ref update), not the Contents API. The
// Contents API is one call per file with no atomicity across files -- a
// four-file publish that fails on the third leaves the repository half
// written. This module never lets a partial publish happen: nothing is
// visible on `env.GITHUB_BRANCH` until the very last call (the ref update)
// succeeds.
//
// Deliberately typed against `@cloudflare/workers-types` (tsconfig.worker.json),
// same as auth.ts and index.ts -- see index.ts's own comment for why.

export interface GitHubEnv {
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_TOKEN: string;
}

export type CommitFile = {
  path: string;
  content: string;
  // Not optional. GitHub's "create a blob" endpoint takes `{ content,
  // encoding }`, and Task 6 sends photos through this same function --
  // committing a JPEG's bytes as a plain JS string (implicitly "utf-8")
  // corrupts it. The caller must say which one every time.
  encoding: 'utf-8' | 'base64';
};

const API = 'https://api.github.com';

// ---------------------------------------------------------------------------
// The path allowlist. The Worker's GITHUB_TOKEN can write anywhere in this
// repository -- this check is the only thing standing between a malformed
// or hostile publish request and a rewritten `.github/workflows/`,
// `package.json`, or `wrangler.toml`. Two independent conditions, both
// required:
//
//  1. No path may contain `..`, checked as a plain substring before
//     anything else. This does NOT reject `.github/workflows/evil.yml` or
//     `package.json` -- neither string contains two consecutive dots -- so
//     it is necessary but not sufficient on its own.
//  2. The path must positively match one of the two shapes this Worker is
//     allowed to touch. Each shape is anchored (`^...$`) and each segment
//     is `[^/]+` -- no slash allowed inside a segment -- so a value like
//     `src/content/x/../../package.json` cannot satisfy the shape even if
//     (hypothetically) the `..` check above were skipped: it has an extra
//     path segment the anchored pattern doesn't allow.
//
// Together they cover both attack shapes: traversal sequences, and
// requests that simply name a path outside the two allowed directories
// without using `..` at all.
const CONTENT_PATH = /^src\/content\/[^/]+\.json$/;
const ASSET_PATH = /^assets-source\/[^/]+\/[^/]+$/;

function assertAllowedPath(path: string): void {
  if (path.includes('..') || !(CONTENT_PATH.test(path) || ASSET_PATH.test(path))) {
    throw new Error(
      `refuses to write to path "${path}" -- only src/content/<name>.json and assets-source/<category>/<file> are allowed`,
    );
  }
}

// ---------------------------------------------------------------------------
// GitHub Git Data API calls. Each function owns exactly one endpoint so the
// method+path shape of every request is visible at the call site, not
// buried in a shared "make a GitHub request" helper that could paper over
// GET vs POST vs PATCH or `/git/ref/` vs `/git/refs/` differences.

function ghHeaders(env: GitHubEnv): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'via-bianca-admin-worker',
  };
}

function repoUrl(env: GitHubEnv, path: string): string {
  return `${API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`;
}

// GET /git/ref/heads/{branch} -- singular "ref". Read side: the current tip
// of the branch Cloudflare Pages builds from. Read fresh at the start of
// every publish, never cached, so the tree and commit built below are
// always based on the real current HEAD, not a stale one from an earlier
// request.
async function getBranchHeadSha(env: GitHubEnv): Promise<string> {
  const url = repoUrl(env, `/git/ref/heads/${env.GITHUB_BRANCH}`);
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) {
    throw new Error(`could not read the current ${env.GITHUB_BRANCH} branch (GitHub returned ${res.status})`);
  }
  const body = (await res.json()) as { object: { sha: string } };
  return body.object.sha;
}

// GET /git/commits/{sha} -- the commit's tree sha, which is what "create a
// tree"'s `base_tree` actually needs (a tree sha, not a commit sha).
async function getCommitTreeSha(env: GitHubEnv, commitSha: string): Promise<string> {
  const url = repoUrl(env, `/git/commits/${commitSha}`);
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) {
    throw new Error(`could not read commit ${commitSha} (GitHub returned ${res.status})`);
  }
  const body = (await res.json()) as { tree: { sha: string } };
  return body.tree.sha;
}

// POST /git/blobs -- one per file. `encoding` travels through unchanged
// from what the caller supplied; this is the one function in the whole
// chain that actually uploads file bytes, so this is where a dropped or
// hardcoded encoding would corrupt a photo.
async function createBlob(env: GitHubEnv, file: CommitFile): Promise<string> {
  const url = repoUrl(env, '/git/blobs');
  const res = await fetch(url, {
    method: 'POST',
    headers: ghHeaders(env),
    body: JSON.stringify({ content: file.content, encoding: file.encoding }),
  });
  if (!res.ok) {
    throw new Error(`could not upload "${file.path}" (GitHub returned ${res.status})`);
  }
  const body = (await res.json()) as { sha: string };
  return body.sha;
}

// POST /git/trees -- `base_tree` is what makes this an *update* rather than
// a replacement. A tree created without it contains only the entries listed
// here; every other file already in the repository would vanish from the
// resulting commit the instant the ref is updated to point at it. This is
// the single most destructive bug this module can contain, and it is
// invisible to a call counter -- only inspecting this request's body proves
// it's actually happening.
async function createTree(
  env: GitHubEnv,
  baseTreeSha: string,
  entries: { path: string; sha: string }[],
): Promise<string> {
  const url = repoUrl(env, '/git/trees');
  const res = await fetch(url, {
    method: 'POST',
    headers: ghHeaders(env),
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: entries.map((entry) => ({ path: entry.path, mode: '100644', type: 'blob', sha: entry.sha })),
    }),
  });
  if (!res.ok) {
    throw new Error(`could not build the tree (GitHub returned ${res.status})`);
  }
  const body = (await res.json()) as { sha: string };
  return body.sha;
}

// POST /git/commits -- `parents: [headSha]` is what makes this a normal
// single-parent commit on top of the branch this publish started from,
// rather than an orphan commit with no history.
async function createCommit(env: GitHubEnv, treeSha: string, parentSha: string, message: string): Promise<string> {
  const url = repoUrl(env, '/git/commits');
  const res = await fetch(url, {
    method: 'POST',
    headers: ghHeaders(env),
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!res.ok) {
    throw new Error(`could not create the commit (GitHub returned ${res.status})`);
  }
  const body = (await res.json()) as { sha: string };
  return body.sha;
}

// PATCH /git/refs/heads/{branch} -- plural "refs". Write side: the only
// call in this module that makes the new commit actually visible on the
// branch Cloudflare Pages builds from. Called last, and only once every
// earlier step has succeeded -- see commitFiles below.
//
// A non-fast-forward update (the branch moved since getBranchHeadSha read
// it, e.g. a second publish landed in between) is GitHub's own concurrency
// guard: it answers 422, not a generic error, and that specific status is
// surfaced as a sentence the owner can act on rather than a raw code.
async function updateBranchHead(env: GitHubEnv, commitSha: string): Promise<void> {
  const url = repoUrl(env, `/git/refs/heads/${env.GITHUB_BRANCH}`);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: ghHeaders(env),
    body: JSON.stringify({ sha: commitSha }),
  });
  if (!res.ok) {
    if (res.status === 422) {
      throw new Error('someone else published while you were editing -- reload and try again');
    }
    throw new Error(`could not update ${env.GITHUB_BRANCH} (GitHub returned ${res.status})`);
  }
}

// ---------------------------------------------------------------------------

// One publish costs N + 5 subrequests (N = files.length) against the
// Workers-per-invocation subrequest limit of 50: read the ref (1), read its
// commit for the base tree sha (1), one blob per file (N), create the tree
// (1), create the commit (1), update the ref (1). Fine for today's content
// files and Task 6's photo uploads, but a future "publish everything at
// once" button north of ~45 files would hit the ceiling silently (fetch
// just starts failing) rather than with a clear error -- worth checking
// against this comment before adding one.
export async function commitFiles(
  env: GitHubEnv,
  files: CommitFile[],
  message: string,
): Promise<{ sha: string }> {
  // Every path checked before any network call is made, not just the first
  // bad one lazily discovered mid-publish -- a request with one bad path
  // among several good ones must fail closed with nothing written, exactly
  // like an invalid file fails validateContent before commitFiles is ever
  // called at all.
  files.forEach((file) => assertAllowedPath(file.path));

  const headSha = await getBranchHeadSha(env);
  const baseTreeSha = await getCommitTreeSha(env, headSha);

  const blobs: { path: string; sha: string }[] = [];
  for (const file of files) {
    const sha = await createBlob(env, file);
    blobs.push({ path: file.path, sha });
  }

  const treeSha = await createTree(env, baseTreeSha, blobs);
  const commitSha = await createCommit(env, treeSha, headSha, message);
  await updateBranchHead(env, commitSha);

  return { sha: commitSha };
}
