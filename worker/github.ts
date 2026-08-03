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
// required, and both load-bearing on their own (confirmed by a security
// review: removing only the `..` check lets `assets-source/../wrangler.toml`
// through, because `..` and `wrangler.toml` parse as two ordinary-looking
// segments the anchored regexes below don't otherwise object to):
//
//  1. No path may contain `..`, checked as a plain substring before
//     anything else. This does NOT reject `.github/workflows/evil.yml` or
//     `package.json` -- neither string contains two consecutive dots -- so
//     it is necessary but not sufficient on its own.
//  2. The path must positively match one of the two shapes this Worker is
//     allowed to touch. Each character class is deliberately narrow, not
//     just `[^/]+` -- a security review found the wider version admitted
//     junk that names no real repository path (percent-encoded sequences,
//     embedded whitespace/newlines, uppercase content filenames, arbitrary
//     length), some of which only surfaced as an opaque GitHub 422 later
//     rather than a clean rejection here. `[a-z0-9-]+\.json` matches all
//     nine real files under src/content/ today (see github.test.ts's
//     `still accepts the real content file` block); `[A-Za-z0-9 ._-]+`
//     matches every real assets-source/<category>/<file> checked in the
//     same suite except one apostrophe'd filename -- see that test's own
//     comment for why that specific gap is recorded, not fixed.
//
// Together they cover both attack shapes: traversal sequences, and
// requests that simply name a path outside the two allowed directories
// without using `..` at all.
const CONTENT_PATH = /^src\/content\/[a-z0-9-]+\.json$/;
const ASSET_PATH = /^assets-source\/[a-z0-9_-]+\/[A-Za-z0-9 ._-]+$/;

// Distinguishable from a generic Error so a caller (worker/index.ts's
// handlePublish) can map a bad *path* to a 400 -- a client-side mistake --
// rather than the 502 every other commitFiles failure gets, which would
// otherwise misdirect diagnosis toward "GitHub is broken" for what is
// actually "the request named a path outside the allowlist".
export class DisallowedPathError extends Error {}

function assertAllowedPath(path: string): void {
  if (path.includes('..') || !(CONTENT_PATH.test(path) || ASSET_PATH.test(path))) {
    throw new DisallowedPathError(
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

// Only `status` used to survive into a thrown message ("... (GitHub
// returned 403)"), dropping GitHub's own, far more actionable explanation
// (e.g. "Resource not accessible by personal access token" for a token
// missing `contents:write`) -- a difference that matters to a
// non-technical owner trying to tell "something I can fix" from "the
// internet is broken". Reads `res.text()`, GitHub's own response BODY,
// never the request's own headers (where `env.GITHUB_TOKEN` actually
// lives) -- so there is no mechanism here for the token itself to end up
// echoed into a thrown message. Capped at 200 characters so an unexpectedly
// huge or non-JSON error body can't balloon a thrown message.
async function describeFailure(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  const snippet = text.slice(0, 200).trim();
  return snippet ? ` -- ${snippet}` : '';
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
    throw new Error(`could not read the current ${env.GITHUB_BRANCH} branch (GitHub returned ${res.status})${await describeFailure(res)}`);
  }
  const body = (await res.json()) as { object?: { sha?: unknown } };
  const sha = body.object?.sha;
  // A security review's exact reproduction: GitHub can answer 200 OK with a
  // body that is present but malformed (`{ object: {} }`, no `sha` at all).
  // `res.ok` alone doesn't catch that -- only checking the shape of what
  // came back does. Without this, `sha` would be `undefined`, and every
  // caller downstream (createTree's `parents`, createCommit's `parents`)
  // would silently build a commit with no real parent instead of failing.
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new Error(`could not read the current ${env.GITHUB_BRANCH} branch -- GitHub's response had no commit sha`);
  }
  return sha;
}

// GET /git/commits/{sha} -- the commit's tree sha, which is what "create a
// tree"'s `base_tree` actually needs (a tree sha, not a commit sha).
async function getCommitTreeSha(env: GitHubEnv, commitSha: string): Promise<string> {
  const url = repoUrl(env, `/git/commits/${commitSha}`);
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) {
    throw new Error(`could not read commit ${commitSha} (GitHub returned ${res.status})${await describeFailure(res)}`);
  }
  const body = (await res.json()) as { tree?: { sha?: unknown } };
  const sha = body.tree?.sha;
  // The exact scenario a security review reproduced and named the most
  // dangerous finding in this task: a 200 OK with `{ tree: {} }` (no `sha`)
  // used to flow straight through -- `baseTreeSha` became `undefined`,
  // `JSON.stringify` silently DROPPED the `base_tree` key from createTree's
  // request body entirely (it does not serialise as `null`; the key simply
  // isn't there), and the run continued straight through to the ref update.
  // That is precisely "a tree built without base_tree" -- the single most
  // destructive bug this whole task exists to prevent -- reached via a
  // malformed read instead of a missing line of code. Checking the shape
  // here, before `baseTreeSha` is ever used, closes that path entirely: no
  // blob, tree, commit or ref-update call happens once this throws, since
  // this is the second call commitFiles ever makes.
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new Error(`could not read the base tree of commit ${commitSha} -- GitHub's response had no tree sha`);
  }
  return sha;
}

// base64 -> UTF-8 text, for GET /contents' response. Not a byte-for-byte
// `atob` + `String.fromCharCode` round trip (worker/auth.ts's
// `base64ToBytes`, sized for small fixed-width secrets): this decodes real
// file content that can contain multi-byte UTF-8 characters, and a naive
// per-char decode would silently corrupt any of those into mojibake instead
// of throwing -- a wrong-but-plausible-looking result is worse here than a
// clean failure would be.
//
// No explicit newline-stripping before `atob`, despite GitHub's Contents
// API wrapping its base64 payload at 60 characters -- an earlier version of
// this comment claimed `atob` "does not tolerate" that and stripped
// whitespace manually before decoding. Confirmed false, directly: both
// Node's and workerd's `atob` implement the WHATWG "forgiving-base64"
// decode algorithm, which strips ASCII whitespace (including embedded
// newlines) before decoding, on its own. Reproduced with a real
// newline-wrapped payload decoding correctly through a bare `atob` call,
// no `.replace()` needed. Left out rather than kept as inert
// belt-and-braces: dead code with a wrong justification in its own comment
// is worse than no code, and worker/__tests__/github.test.ts's own
// newline-wrapping test still exercises the real (native) behavior this
// relies on.
function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// GET /contents/{path}?ref={branch} -- reads a file's current text content
// directly from the branch Cloudflare Pages builds from, independent of
// whatever commit last touched it. Task 8's `reconcileScheduleFromSource`
// (worker/index.ts) is the one caller: it needs the *actual current* state
// of dishes/drinks/press.json, including content that reached `main` some
// way other than `POST /api/publish` (a direct commit, the GitHub web UI, a
// revert) -- none of which ever runs through `recordScheduledDates`, since
// that only fires from inside `handlePublish` itself.
//
// Returns `null` on a 404 (the file genuinely doesn't exist on this branch)
// rather than throwing -- a schedulable file that doesn't exist yet isn't a
// GitHub failure, it's "nothing to reconcile for this one". Any other
// non-OK status, or a 200 whose body isn't the base64 shape the Contents API
// documents, still throws: unlike `resolveCommitSha` (plugins/build-info.ts),
// a read this function's one caller depends on to *recover* missed schedule
// dates should not quietly pretend nothing changed on a genuine failure.
export async function getFileContent(env: GitHubEnv, path: string): Promise<string | null> {
  const url = repoUrl(env, `/contents/${path}?ref=${env.GITHUB_BRANCH}`);
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`could not read ${path} (GitHub returned ${res.status})${await describeFailure(res)}`);
  }
  const body = (await res.json()) as { content?: unknown; encoding?: unknown };
  if (typeof body.content !== 'string' || body.encoding !== 'base64') {
    throw new Error(`could not read ${path} -- GitHub's response had no base64 content`);
  }
  return base64ToUtf8(body.content);
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
    throw new Error(`could not upload "${file.path}" (GitHub returned ${res.status})${await describeFailure(res)}`);
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
    throw new Error(`could not build the tree (GitHub returned ${res.status})${await describeFailure(res)}`);
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
    throw new Error(`could not create the commit (GitHub returned ${res.status})${await describeFailure(res)}`);
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
    throw new Error(`could not update ${env.GITHUB_BRANCH} (GitHub returned ${res.status})${await describeFailure(res)}`);
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
