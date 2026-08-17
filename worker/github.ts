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
// required, and both load-bearing on their own -- but not for the pairing an
// earlier version of this comment claimed. That version said removing only
// the `..` check lets `assets-source/../wrangler.toml` through. Whole-branch
// review, M6: false, checked directly against ASSET_PATH below -- `..` can
// never be a legal *category* segment (`[a-z0-9_-]+` has no `.` in it at
// all), so that path is rejected by condition 2 alone, with or without the
// `..` check. The real case the `..` check is load-bearing for is
// `assets-source/food/..`: a well-formed category, and, per condition 2's
// *filename* character class (`[A-Za-z0-9 ._-]+`, which does allow `.`), a
// filename segment `..` matches too -- so without the substring check that
// whole path sails straight through ASSET_PATH's regex (see
// github.test.ts's own reproduction of this exact path).
//
//  1. No path may contain `..`, checked as a plain substring before
//     anything else. This does NOT reject `.github/workflows/evil.yml` or
//     `package.json` -- neither string contains two consecutive dots -- so
//     it is necessary but not sufficient on its own.
//  2. The path must positively match one of the three shapes this Worker
//     is allowed to touch. Each character class is deliberately narrow,
//     not just `[^/]+` -- a security review found the wider version
//     admitted junk that names no real repository path (percent-encoded
//     sequences, embedded whitespace/newlines, uppercase content
//     filenames, arbitrary length), some of which only surfaced as an
//     opaque GitHub 422 later rather than a clean rejection here.
//     `[a-z0-9-]+\.json` matches all eleven real files under src/content/
//     today, including story.json (Phase 4: D1-backed for reads and writes
//     via storeFor, but still a real file this allowlist has no reason to
//     stop accepting -- see github.test.ts's `still accepts the real
//     content file` block); `[A-Za-z0-9 ._-]+` matches every real
//     assets-source/<category>/<file> checked in the same suite except one
//     apostrophe'd filename -- see that test's own comment for why that
//     specific gap is recorded, not fixed. The third shape,
//     `public/menus/[a-z0-9-]{1,64}\.pdf` (Plan 4 Task 8), is narrower
//     still: a menu PDF's name is always a chosen slug (worker/upload.ts's
//     own `MENU_NAME_PATTERN`), never an original filename or a hash the
//     way a photo's is, so there is no space, mixed case, or punctuation a
//     legitimate write here ever needs to admit. The `{1,64}` bound
//     (review finding) is a length cap CONTENT_PATH and ASSET_PATH do not
//     share -- deliberately not retrofitted onto either of those two
//     unchanged shapes, but worth adding here since a menu name is a fresh
//     surface with no existing behavior to preserve: an unbounded name
//     would otherwise reach GitHub's own ~255-byte path-component ceiling
//     and surface as an opaque 502 instead of this route's own clear
//     rejection message.
//
// Together they cover both attack shapes: traversal sequences, and
// requests that simply name a path outside the three allowed shapes
// without using `..` at all.
const CONTENT_PATH = /^src\/content\/[a-z0-9-]+\.json$/;
const ASSET_PATH = /^assets-source\/[a-z0-9_-]+\/[A-Za-z0-9 ._-]+$/;
const MENU_PATH = /^public\/menus\/[a-z0-9-]{1,64}\.pdf$/;

// Distinguishable from a generic Error so a caller (worker/index.ts's
// handlePublish) can map a bad *path* to a 400 -- a client-side mistake --
// rather than the 502 every other commitFiles failure gets, which would
// otherwise misdirect diagnosis toward "GitHub is broken" for what is
// actually "the request named a path outside the allowlist".
export class DisallowedPathError extends Error {}

// Distinguishable from a generic Error so a caller (worker/index.ts's
// handlePublish) can map a concurrent-edit ref update to 409 -- the same
// status Task 3's `baseSha` mismatch already uses -- rather than the 502
// every other commitFiles failure gets. Before this class existed, "someone
// else published while you were editing" and "GitHub returned a 5xx" both
// fell through to the identical `json(502, { message })`, so a caller could
// only tell them apart by matching on the message TEXT itself, with nothing
// pinning that string -- a reword on either side would silently degrade the
// conflict case into a generic, unrecoverable-sounding error. Thrown by
// updateBranchHead below on a 422 (GitHub's own non-fast-forward signal),
// never by any other step in commitFiles -- every other failure in this
// module is a genuine "could not talk to GitHub" case, not a conflict.
export class PublishConflictError extends Error {}

// Distinguishable from a generic Error so worker/index.ts's handleUndo can
// map "this commit cannot be put back" to a 409 -- the same status this
// codebase already uses for every "the state you were looking at is not the
// state that is there now" case -- rather than the 502 an unrecognised
// throw would get. Raised for a commit that has no single parent (a merge,
// or the very first commit), for a file list GitHub may have paginated, and
// for a commit that only ADDED files, where there is genuinely nothing in
// the parent to restore.
export class UndoNotPossibleError extends Error {}

// Exported so `GET /api/content` (worker/index.ts's handleGetContent, Task
// 3) can restrict *reads* to exactly the same path shape assertAllowedPath
// below already restricts *writes* to -- built on the same CONTENT_PATH
// regex and the same `..` substring rule, not a second, independently
// maintained allowlist that could quietly drift from this one. Deliberately
// narrower than assertAllowedPath: only the content shape of its three
// allowed shapes. There is no reason a read route ever serves anything
// under assets-source/ or public/menus/ -- those are binary photos and
// PDFs, not JSON this route could sensibly return as text -- so neither
// ASSET_PATH nor MENU_PATH has an equivalent export here.
export function isContentPath(path: string): boolean {
  return !path.includes('..') && CONTENT_PATH.test(path);
}

function assertAllowedPath(path: string): void {
  if (path.includes('..') || !(CONTENT_PATH.test(path) || ASSET_PATH.test(path) || MENU_PATH.test(path))) {
    throw new DisallowedPathError(
      `refuses to write to path "${path}" -- only src/content/<name>.json, assets-source/<category>/<file>, and public/menus/<name>.pdf are allowed`,
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
//
// Exported for handleUndo, which needs the tree of the commit BEFORE the one
// being undone -- i.e. the state to put back. Exported rather than
// duplicated so its malformed-body guard below is shared, not reimplemented
// slightly differently in a second place.
export async function getCommitTreeSha(env: GitHubEnv, commitSha: string): Promise<string> {
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

// What GET /contents/{path} resolves to below -- the decoded text plus the
// blob `sha` GitHub's Contents API already includes in the same response
// body. Task 3 is the reason `sha` exists on this type at all: a caller
// (`GET /api/content`, worker/index.ts) hands it back to the dashboard as
// `baseSha`, and `POST /api/publish` compares a re-read of this same field
// against whatever the dashboard sends back before committing over it -- a
// conditional write, so a second device publishing in between is caught
// even though `updateBranchHead`'s 422 (a non-fast-forward) never fires for
// two edits ten minutes apart.
export interface FileContent {
  content: string;
  sha: string;
}

// GET /contents/{path}?ref={branch} -- reads a file's current text content
// directly from the branch Cloudflare Pages builds from, independent of
// whatever commit last touched it, and independent of how that content got
// there (a publish through this Worker, a direct commit, the GitHub web UI,
// a revert). Two callers: `GET /api/content`, which serves the dashboard
// the current committed copy of a file, and `POST /api/publish`'s `baseSha`
// check, which compares against it to refuse a stale edit. The `sha` field
// is what makes the second of those possible.
//
// Returns `null` on a 404 (the file genuinely doesn't exist on this branch)
// rather than throwing -- a content file that doesn't exist yet isn't a
// GitHub failure, and a `baseSha` sent for a file that no longer exists is
// itself treated as a conflict, not a crash (see handlePublish). Any other
// non-OK status, or a 200 whose body isn't the base64-plus-sha shape the
// Contents API documents, still throws: unlike `resolveCommitSha`
// (plugins/build-info.ts), a read this function's callers depend on to
// detect a stale edit or re-check a developer-owned field should not
// quietly pretend nothing changed on a genuine failure.
export async function getFileContent(env: GitHubEnv, path: string): Promise<FileContent | null> {
  const url = repoUrl(env, `/contents/${path}?ref=${env.GITHUB_BRANCH}`);
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`could not read ${path} (GitHub returned ${res.status})${await describeFailure(res)}`);
  }
  const body = (await res.json()) as { content?: unknown; encoding?: unknown; sha?: unknown };
  if (typeof body.content !== 'string' || body.encoding !== 'base64') {
    throw new Error(`could not read ${path} -- GitHub's response had no base64 content`);
  }
  // Same defensive posture as getBranchHeadSha/getCommitTreeSha above: a 200
  // OK with a present-but-malformed `sha` (missing, or an empty string) must
  // not silently become a `baseSha` a client could round-trip back and have
  // treated as a match against literally anything -- checked here, not left
  // for a caller to eventually notice.
  if (typeof body.sha !== 'string' || body.sha.length === 0) {
    throw new Error(`could not read ${path} -- GitHub's response had no blob sha`);
  }
  return { content: base64ToUtf8(body.content), sha: body.sha };
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
      throw new PublishConflictError('someone else published while you were editing -- reload and try again');
    }
    throw new Error(`could not update ${env.GITHUB_BRANCH} (GitHub returned ${res.status})${await describeFailure(res)}`);
  }
}

// ---------------------------------------------------------------------------

// This function's own cost is still N + 5 subrequests (N = files.length):
// read the ref (1), read its commit for the base tree sha (1), one blob per
// file (N), create the tree (1), create the commit (1), update the ref (1).
//
// Review finding: that is no longer the whole story for one POST
// /api/publish REQUEST, which is what actually counts against the
// Workers-per-invocation subrequest limit of 50 -- Task 3's `baseSha`
// conditional write and the site.json developer-owned re-check
// (worker/index.ts's handlePublish, steps 3 and 5) both call
// `getFileContent` BEFORE this function ever runs, and those reads share
// the same one invocation's budget. Worst case -- every file in the
// request carries a `baseSha` -- adds up to N more reads on top of this
// function's own N + 5, for up to 2N + 6 total. A future "publish
// everything at once" button hits the ceiling silently (fetch just starts
// failing, not a clear error) around ~22 files now, not the ~45 this
// function's own cost alone would suggest -- check the request-level total
// in handlePublish, not just this comment, before adding one.
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

// ---------------------------------------------------------------------------
// Undo. Three reads plus one restore, 7 subrequests total regardless of how
// many files are involved, against the 50-per-invocation ceiling documented
// above: getHeadCommit (1) + getCommitTreeSha on the parent (1) +
// getTreeBlobShas (1) + restoreBlobs' own four. Four, not five, because
// restoreBlobs no longer re-reads the branch head -- it is handed the sha
// getHeadCommit already validated (see that function's own comment).

export interface HeadCommit {
  sha: string;
  parentSha: string;
  changedPaths: string[];
}

// GitHub's per-page cap on the `files` array of a commit response. A
// TRUNCATED file list must never become a partial revert -- putting half a
// commit back is worse than refusing, because it looks like it worked.
const COMMIT_FILES_PAGE_CAP = 300;

// GET /repos/{owner}/{repo}/commits/{branch} -- the REST Commits API, which
// this module otherwise does not use (everything else here is the Git Data
// and Contents APIs). One call answers all three things an undo needs: what
// the head sha actually is, what its single parent is, and which paths it
// touched.
//
// Guarded the same way getBranchHeadSha and getCommitTreeSha guard a
// 200-OK-but-malformed body, plus two refusals specific to undo. A commit
// without exactly one parent is either a merge or the repository's first
// commit, and "the state before it" is not a single well-defined thing in
// either case. A file list at the page cap may be incomplete.
export async function getHeadCommit(env: GitHubEnv): Promise<HeadCommit> {
  const url = repoUrl(env, `/commits/${env.GITHUB_BRANCH}`);
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) {
    throw new Error(`could not read the latest commit on ${env.GITHUB_BRANCH} (GitHub returned ${res.status})${await describeFailure(res)}`);
  }
  const body = (await res.json()) as { sha?: unknown; parents?: unknown; files?: unknown };
  if (typeof body.sha !== 'string' || body.sha.length === 0) {
    throw new Error(`could not read the latest commit on ${env.GITHUB_BRANCH} -- GitHub's response had no commit sha`);
  }
  if (!Array.isArray(body.parents) || body.parents.length !== 1) {
    throw new UndoNotPossibleError('that change cannot be put back automatically');
  }
  const parentSha = (body.parents[0] as { sha?: unknown }).sha;
  if (typeof parentSha !== 'string' || parentSha.length === 0) {
    throw new Error(`could not read the latest commit on ${env.GITHUB_BRANCH} -- GitHub's response had no parent sha`);
  }
  if (!Array.isArray(body.files)) {
    throw new Error(`could not read the latest commit on ${env.GITHUB_BRANCH} -- GitHub's response listed no files`);
  }
  if (body.files.length >= COMMIT_FILES_PAGE_CAP) {
    throw new UndoNotPossibleError('that change touched too many files to put back automatically');
  }
  const changedPaths = body.files
    .map((file) => (file as { filename?: unknown }).filename)
    .filter((name): name is string => typeof name === 'string');
  return { sha: body.sha, parentSha, changedPaths };
}

// GET /git/trees/{sha}?recursive=1 -- path -> blob sha for a whole tree, in
// one call. The repository tracks a few hundred files, comfortably inside
// GitHub's own limits, but `truncated` is checked rather than trusted away:
// a partial map here would silently look like "this path did not exist in
// the parent", which handleUndo reads as "the commit added it" and skips --
// turning a truncated response into a quietly incomplete revert.
export async function getTreeBlobShas(env: GitHubEnv, treeSha: string): Promise<Record<string, string>> {
  const url = repoUrl(env, `/git/trees/${treeSha}?recursive=1`);
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) {
    throw new Error(`could not read the tree of ${treeSha} (GitHub returned ${res.status})${await describeFailure(res)}`);
  }
  const body = (await res.json()) as { tree?: unknown; truncated?: unknown };
  if (body.truncated === true) {
    throw new UndoNotPossibleError('that change cannot be put back automatically');
  }
  if (!Array.isArray(body.tree)) {
    throw new Error(`could not read the tree of ${treeSha} -- GitHub's response had no tree`);
  }
  const map: Record<string, string> = {};
  body.tree.forEach((entry) => {
    const { path, sha, type } = entry as { path?: unknown; sha?: unknown; type?: unknown };
    if (type === 'blob' && typeof path === 'string' && typeof sha === 'string') map[path] = sha;
  });
  return map;
}

// A forward commit whose tree re-points the named paths at blob shas they
// already had. Moves no file bytes through the Worker at all, which is what
// makes it binary-safe for a menu PDF -- getFileContent's own base64->UTF-8
// decode would corrupt one, and a 25MB PDF becomes a ~33MB base64 string
// inside a 128MB isolate for no benefit.
//
// The allowlist is re-applied here, on every entry, before any network call
// -- the same posture commitFiles takes, and for a stronger reason. This
// function bypasses commitFiles entirely, so it is the ONLY thing standing
// between the Worker's token and the rest of the repository on this path.
// That is also exactly why the tempting five-call version -- create a commit
// whose tree simply IS the parent's tree, a byte-exact revert -- is not what
// this does: a whole-tree restore cannot enforce a path allowlist at all,
// and would let a session that may only write content JSON roll back a
// security fix in worker/auth.ts if that fix happened to be the last commit.
//
// `base_tree` is the tree of `headSha`, never the reverted commit's parent's.
// Using the parent's would delete every file changed since, and that failure
// is invisible to a call counter -- only the request body shows it.
// `parents` is `headSha` too, so this is an ordinary commit on top of the
// branch, not a history rewrite.
//
// `headSha` is a PARAMETER, not a fresh read, and that is the whole
// concurrency guard. Review finding (Important): this function used to call
// `getBranchHeadSha` itself, three subrequests after handleUndo had already
// read the head and refused a head that was not the commit being undone --
// so a commit landing in that window was silently absorbed. The tree was
// based on it, the commit was parented on it, and the ref PATCH was
// therefore a plain FAST-FORWARD that GitHub accepts with 200: the
// interloper's changes to the reverted paths were overwritten and she was
// told "your site is back to how it was". The comment that used to sit here
// claimed the non-force PATCH's own 422 covered that window; it provably
// could not, because the PATCH moved the ref from the very sha this
// function had just re-read. Building on the sha the CALLER validated is
// what makes the 422 real: if anything moved the branch in between, the new
// commit is not a descendant of the current head, GitHub answers 422, and
// updateBranchHead's existing PublishConflictError -> 409 mapping fires.
export async function restoreBlobs(
  env: GitHubEnv,
  entries: { path: string; sha: string }[],
  message: string,
  headSha: string,
): Promise<{ sha: string }> {
  entries.forEach((entry) => assertAllowedPath(entry.path));

  const baseTreeSha = await getCommitTreeSha(env, headSha);
  const treeSha = await createTree(env, baseTreeSha, entries);
  const commitSha = await createCommit(env, treeSha, headSha, message);
  await updateBranchHead(env, commitSha);

  return { sha: commitSha };
}
