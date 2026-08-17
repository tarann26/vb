import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitFiles,
  getFileContent,
  getHeadCommit,
  getTreeBlobShas,
  restoreBlobs,
  DisallowedPathError,
  PublishConflictError,
  UndoNotPossibleError,
  type GitHubEnv,
} from '../github';
import {
  BASE_COMMIT_SHA,
  BASE_TREE_SHA,
  NEW_COMMIT_SHA,
  PARENT_COMMIT_SHA,
  PARENT_TREE_SHA,
  envWith,
  makeGitHubStub,
  utf8,
  type GitHubStub,
} from './githubStub';

// Runs under this repo's single jsdom Vitest environment (see
// vitest.config.ts's comment) -- fetch/Request/Response come from Node
// itself, not jsdom, and are stubbed per-test via `envWith`/`vi.stubGlobal`
// rather than a real network call, so these are faithful tests of
// commitFiles' own request-building logic without ever touching GitHub.

// A plain env fixture for the path-allowlist tests below, which must never
// reach `fetch` at all -- see the `refuses to write` block's own comment.
const NO_FETCH_ENV: GitHubEnv = {
  GITHUB_OWNER: 'tarann26',
  GITHUB_REPO: 'vb',
  GITHUB_BRANCH: 'main',
  GITHUB_TOKEN: 'test-fixture-token-not-real',
};

describe('commitFiles', () => {
  let stub: GitHubStub;

  beforeEach(() => {
    stub = makeGitHubStub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates one commit for several files', async () => {
    await commitFiles(
      envWith(stub),
      [utf8('src/content/dishes.json', '[]'), utf8('src/content/drinks.json', '[]')],
      'update menu',
    );

    // Matched on method + exact path suffix, not a substring of the URL --
    // `/git/commits` (POST, create) and `/git/commits/{sha}` (GET, read the
    // base tree) both contain `/git/commits`; only `endsWith` tells them
    // apart. See githubStub.ts's own comment for the same trap on the
    // fail-injection side.
    expect(stub.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/git/blobs'))).toHaveLength(2);
    expect(stub.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/git/commits'))).toHaveLength(1);
    expect(stub.calls.filter((c) => c.method === 'PATCH' && c.url.endsWith('/git/refs/heads/main'))).toHaveLength(1);
  });

  it('reads the current branch head and its tree before writing anything', async () => {
    await commitFiles(envWith(stub), [utf8('src/content/dishes.json', '[]')], 'm');

    const writeCalls = stub.calls.filter((c) => c.method === 'POST' || c.method === 'PATCH');
    const readCalls = stub.calls.filter((c) => c.method === 'GET');
    expect(readCalls).toHaveLength(2);
    // Every read happened before every write -- the two GETs (ref, then its
    // commit for the base tree sha) are calls[0] and calls[1], nothing else
    // is.
    expect(stub.calls.indexOf(readCalls[0])).toBe(0);
    expect(stub.calls.indexOf(readCalls[1])).toBe(1);
    expect(stub.calls.indexOf(writeCalls[0])).toBeGreaterThan(1);
  });

  it('bases the tree and the commit on the current head, so nothing is deleted', async () => {
    await commitFiles(envWith(stub), [utf8('src/content/dishes.json', '[]')], 'm');

    const treeBody = stub.bodies.find((b) => 'base_tree' in b);
    expect(treeBody).toBeDefined();
    expect(treeBody!.base_tree).toBe(BASE_TREE_SHA);

    const commitBody = stub.bodies.find((b) => 'parents' in b);
    expect(commitBody).toBeDefined();
    expect(commitBody!.parents).toEqual([BASE_COMMIT_SHA]);
  });

  it('returns the sha of the commit it just created', async () => {
    const result = await commitFiles(envWith(stub), [utf8('src/content/dishes.json', '[]')], 'm');
    expect(result).toEqual({ sha: NEW_COMMIT_SHA });
  });

  it('does not update the ref when creating the commit fails', async () => {
    // A valid, allowlisted path -- src/content/dishes.json, not a bare
    // "a.json" -- is deliberate here. A path outside the allowlist would
    // also make this reject and also never reach PATCH, which would let
    // this test pass for the wrong reason (the path check, not the
    // create-commit failure the test name claims to cover).
    const failingStub = makeGitHubStub({ failOn: '/git/commits' });
    await expect(
      commitFiles(envWith(failingStub), [utf8('src/content/dishes.json', 'b')], 'm'),
    ).rejects.toThrow();
    expect(failingStub.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('does not write a single blob when reading the current branch head fails', async () => {
    const failingStub = makeGitHubStub({ failOn: '/git/ref/heads/main' });
    await expect(
      commitFiles(envWith(failingStub), [utf8('src/content/dishes.json', 'b')], 'm'),
    ).rejects.toThrow();
    expect(failingStub.calls.some((c) => c.method === 'POST' || c.method === 'PATCH')).toBe(false);
  });

  it('surfaces a concurrent-edit ref update (422) as a message about someone else publishing', async () => {
    const failingStub = makeGitHubStub({ failOn: '/git/refs/heads/main', failStatus: 422 });
    await expect(
      commitFiles(envWith(failingStub), [utf8('src/content/dishes.json', 'b')], 'm'),
    ).rejects.toThrow(/someone else published/i);
  });

  // worker/index.ts's handlePublish maps this specific failure to 409 by
  // checking `error instanceof PublishConflictError`, deliberately never by
  // matching the message text above (a reword of either sentence must not
  // silently turn a real conflict into a generic 502). A version of
  // updateBranchHead that throws a plain `Error` with the identical message
  // still passes the test above but fails this one -- that gap is exactly
  // why this is its own assertion, not folded into it.
  it('the concurrent-edit rejection is a PublishConflictError, not a generic Error', async () => {
    const failingStub = makeGitHubStub({ failOn: '/git/refs/heads/main', failStatus: 422 });
    await expect(
      commitFiles(envWith(failingStub), [utf8('src/content/dishes.json', 'b')], 'm'),
    ).rejects.toBeInstanceOf(PublishConflictError);
  });

  // The generic 5xx path (no concurrent edit, GitHub is just down) must NOT
  // also become a PublishConflictError -- that would make handlePublish
  // answer 409 ("someone else published") for a plain outage, telling her
  // to reload and try again when nothing of hers was ever at risk.
  it('a plain 5xx ref-update failure is NOT a PublishConflictError', async () => {
    const failingStub = makeGitHubStub({ failOn: '/git/refs/heads/main', failStatus: 500 });
    const result = commitFiles(envWith(failingStub), [utf8('src/content/dishes.json', 'b')], 'm');
    await expect(result).rejects.toThrow();
    await expect(result).rejects.not.toBeInstanceOf(PublishConflictError);
  });

  // Security review reproduction (Important 1): a 200 OK response that is
  // malformed rather than an HTTP error -- GitHub answers with an object
  // that has no `sha` at all. Before this was guarded, `baseTreeSha` became
  // `undefined`, `JSON.stringify` silently DROPPED the `base_tree` key
  // entirely (it does not serialise as `"base_tree":null` or similar --
  // the key just isn't there), and the run continued straight through to
  // the PATCH: exactly the "tree built without base_tree" catastrophe this
  // whole task exists to prevent, except triggered by a malformed read
  // instead of a missing line of code.
  it('rejects when the base commit has no tree sha, rather than silently omitting base_tree', async () => {
    const badStub = makeGitHubStub({ malformedTreeSha: true });
    await expect(
      commitFiles(envWith(badStub), [utf8('src/content/dishes.json', '[]')], 'm'),
    ).rejects.toThrow();
    // getCommitTreeSha is the second call commitFiles ever makes -- before
    // any blob, tree, commit or ref-update request -- so nothing should
    // have been written at all, not just "the ref wasn't updated".
    expect(badStub.calls.some((c) => c.method === 'POST' || c.method === 'PATCH')).toBe(false);
  });

  it('rejects when the branch ref has no commit sha', async () => {
    const badStub = makeGitHubStub({ malformedRefSha: true });
    await expect(
      commitFiles(envWith(badStub), [utf8('src/content/dishes.json', '[]')], 'm'),
    ).rejects.toThrow();
    expect(badStub.calls.some((c) => c.method === 'POST' || c.method === 'PATCH')).toBe(false);
  });

  // Security review Minor 3: only the HTTP status used to survive into the
  // thrown message ("... (GitHub returned 403)"), dropping GitHub's own,
  // much more actionable explanation. The request headers (where the token
  // actually lives) are never read back into any error message here -- only
  // `res.text()`, GitHub's own response body -- so there is no path for the
  // token itself to end up in a thrown message via this mechanism.
  it("includes the start of GitHub's own error body in the thrown message, not just the status", async () => {
    const badStub = makeGitHubStub({
      failOn: '/git/blobs',
      failStatus: 403,
      failBody: JSON.stringify({ message: 'Resource not accessible by personal access token' }),
    });
    await expect(
      commitFiles(envWith(badStub), [utf8('src/content/dishes.json', '[]')], 'm'),
    ).rejects.toThrow(/Resource not accessible by personal access token/);
  });

  it('sends a photo as base64, not as a mangled string', async () => {
    await commitFiles(
      envWith(stub),
      [{ path: 'assets-source/food/a.jpg', content: 'AAEC', encoding: 'base64' }],
      'm',
    );
    const blobBody = stub.bodies.find((b) => 'content' in b);
    expect(blobBody).toMatchObject({ encoding: 'base64', content: 'AAEC' });
  });

  it('sends a JSON file as utf-8, unchanged', async () => {
    await commitFiles(envWith(stub), [utf8('src/content/dishes.json', '[]')], 'm');
    const blobBody = stub.bodies.find((b) => 'content' in b);
    expect(blobBody).toMatchObject({ encoding: 'utf-8', content: '[]' });
  });

  describe('the path allowlist', () => {
    // No fetch stub at all here -- global fetch is whatever real
    // implementation this Node process has. If the path check below ever
    // moved to after the first network call, these tests would fail with a
    // network error (or hang), not a clean rejection matching /path/i --
    // that's the point: the assertion on the message, not just
    // `.rejects.toThrow()`, is what would catch that regression.
    it.each([
      '../../.github/workflows/evil.yml',
      '.github/workflows/evil.yml',
      'src/content/../../package.json',
      'package.json',
      'assets-source/../wrangler.toml',
      'assets-source/food/../../package.json',
      // Whole-branch review, M6: unlike the two cases above (already
      // rejected by ASSET_PATH's regex alone -- `..` can never be a legal
      // *category* segment), this is the case where the `..` substring
      // check is the ONLY thing standing between this path and a match:
      // "food" is a legal category, and ASSET_PATH's filename character
      // class (`[A-Za-z0-9 ._-]+`) allows `.`, so a bare ".." also matches
      // it as a filename. Confirmed directly: removing only the `..` check
      // lets this one through.
      'assets-source/food/..',
      // Security review Minor 4: junk filenames the looser `[^/]+` character
      // class used to admit even though they name no real repository path
      // and several would only surface as an opaque GitHub 422 later.
      'src/content/%2e%2e%2fpackage.json', // literal percent-encoding, not a real slash
      'src/content/a .json', // space -- not a real content filename
      'src/content/a\nb.json', // embedded newline
      'src/content/UPPER.json', // uppercase -- not a real content filename shape
      // Plan 4 Task 8's own traversal set, re-run with MENU_PATH in place --
      // the exact four the task's brief names. All four are caught by
      // MENU_PATH's own single-segment, ".pdf"-only shape ALONE -- checked
      // directly (removing the `..` substring check entirely and re-running
      // just these four still refuses all four) -- so, unlike
      // `assets-source/food/..` above, none of these four is a case where
      // the `..` check is what's actually doing the work. An earlier
      // version of this comment claimed the first and third depended on the
      // `..` check; that was asserted, not verified, and was wrong the same
      // way the module's own top comment once was for the `assets-source/`
      // case above.
      'public/menus/../../package.json', // fails MENU_PATH's regex outright (extra segments, wrong extension)
      'public/menus/%2e%2e/x.pdf', // literal percent-encoding, not a real ".." -- also just fails MENU_PATH's regex (extra segment)
      'public/../public/menus/x.pdf', // fails MENU_PATH's regex outright (does not start "public/menus/")
      'public/menus/a/b.pdf', // an extra path segment -- MENU_PATH allows none
    ])('refuses to write %s', async (path) => {
      await expect(commitFiles(NO_FETCH_ENV, [utf8(path, 'x')], 'm')).rejects.toThrow(/path/i);
    });

    // The positive control for the new shape, matching the same "still
    // accepts the real content file" pattern above -- both PDFs actually
    // committed under public/menus/ today (see src/content/menus.json).
    it.each(['food-menu.pdf', 'drinks-menu.pdf'])('still accepts the real menu PDF path public/menus/%s', async (name) => {
      await commitFiles(envWith(stub), [{ path: `public/menus/${name}`, content: 'AA', encoding: 'base64' }], 'm');
      expect(stub.calls.some((c) => c.method === 'POST' && c.url.endsWith('/git/blobs'))).toBe(true);
    });

    // MENU_PATH's own `{1,64}` bound (review finding) -- worker/upload.ts's
    // MENU_NAME_PATTERN shares the identical bound, but that only stops a
    // request built through PdfField/handleMenuUpload; commitFiles is the
    // one function every publish path funnels through (see this describe
    // block's own top comment), so the cap has to hold here independently
    // too, not just at the one caller that happens to check it today.
    it('refuses a menu PDF path whose name is over 64 characters', async () => {
      const tooLong = 'a'.repeat(65);
      await expect(
        commitFiles(NO_FETCH_ENV, [utf8(`public/menus/${tooLong}.pdf`, 'x')], 'm'),
      ).rejects.toThrow(/path/i);
    });

    it('accepts a menu PDF path whose name is exactly 64 characters (the boundary is inclusive)', async () => {
      const atLimit = 'a'.repeat(64);
      await commitFiles(envWith(stub), [{ path: `public/menus/${atLimit}.pdf`, content: 'AA', encoding: 'base64' }], 'm');
      expect(stub.calls.some((c) => c.method === 'POST' && c.url.endsWith('/git/blobs'))).toBe(true);
    });

    // A real test, not a decoration: reverting DisallowedPathError's message
    // to name only the first two shapes (the state it was in before this
    // task) makes this fail, since a message naming only src/content/ and
    // assets-source/ contains no "public/menus" substring at all.
    it("DisallowedPathError's message names all three allowed shapes, including the new PDF one", async () => {
      await expect(commitFiles(NO_FETCH_ENV, [utf8('package.json', 'x')], 'm')).rejects.toThrow(/public\/menus/);
    });

    // Every content file this Worker's validateContent (Task 2) actually
    // recognises must still be a legal commitFiles path -- the allowlist
    // tightened in response to Minor 4 must not accidentally start
    // rejecting one of the eleven real files it exists to allow.
    //
    // Two files are worth naming, because both are D1-backed (worker/store.ts's
    // D1_ONLY_PATHS) and yet they show up here in opposite ways. awards.json
    // is the one ABSENT from this list: it has never been a file in this
    // repository, so there is no src/content/awards.json path for
    // commitFiles to accept or reject. story.json (Phase 4) is the opposite
    // case and stays in this list unchanged: it is a real file on disk that
    // commitFiles must still be able to write, even though storeFor no
    // longer routes any publish there. This allowlist is a SECURITY
    // boundary on which paths this function will touch at all, not a map of
    // which store currently owns a path's live traffic -- narrowing it to
    // match storeFor's routing would remove coverage from a check nothing
    // else in this codebase performs, with no test exercising the removal.
    it.each([
      'copy.json',
      'dishes.json',
      'drinks.json',
      // Phase 3, Task 2: the twelfth real content file (Task 8 review fix
      // round 1, Minor 3) -- unlike awards.json (D1-only, deliberately
      // absent from this list), experiences.json is a real GitHub-store
      // file and this allowlist has to keep accepting it.
      'experiences.json',
      'galleries.json',
      'menus.json',
      // Plan 7, Task 1: the tenth real content file.
      'pages.json',
      'press.json',
      'sections.json',
      'site.json',
      'story.json',
    ])('still accepts the real content file %s', async (name) => {
      await commitFiles(envWith(stub), [utf8(`src/content/${name}`, '{}')], 'm');
      expect(stub.calls.some((c) => c.method === 'POST' && c.url.endsWith('/git/blobs'))).toBe(true);
    });

    it('accepts a well-formed content path and a well-formed asset path, including a space and an uppercase extension', async () => {
      // Positive control for the allowlist tests above: if the regexes were
      // ever tightened into rejecting everything, the negative tests would
      // all still pass for the wrong reason. This proves the legitimate
      // shapes still get through to fetch -- including a real asset
      // filename shape (space, then `.JPG`), not just the simplest case.
      await commitFiles(
        envWith(stub),
        [
          utf8('src/content/site.json', '{}'),
          { path: 'assets-source/hero/postcard.png', content: 'AA', encoding: 'base64' },
          { path: 'assets-source/atmosphere/painting board.JPG', content: 'AA', encoding: 'base64' },
        ],
        'm',
      );
      expect(stub.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/git/blobs'))).toHaveLength(3);
    });

    // Recorded, not fixed -- same disposition the review gave
    // `assets-source/Menu - Expanded.pdf` (rejected for having only one path
    // segment; left alone since no upload path can reach it). This tightened
    // filename character class (`[A-Za-z0-9 ._-]+`) also rejects an
    // apostrophe, and the repository already has one real committed asset
    // with one (`assets-source/food/Spaghetti alla'Assassina.jpg`). That
    // file was added directly via `git add`, never through commitFiles, and
    // Task 6's photo uploads are content-addressed (a generated stem, not
    // the browser's original filename), so no known future write path needs
    // an apostrophe to reach GitHub through this function. If that ever
    // changes, widen the asset regex rather than assuming this comment is
    // still true.
    it('rejects an apostrophe in an asset filename, a real repository file this function is never asked to write', async () => {
      await expect(
        commitFiles(NO_FETCH_ENV, [utf8(`assets-source/food/Spaghetti alla'Assassina.jpg`, 'x')], 'm'),
      ).rejects.toThrow(/path/i);
    });

    it('throws a distinguishable DisallowedPathError, not a generic Error, so callers can map it to a 4xx', async () => {
      await expect(commitFiles(NO_FETCH_ENV, [utf8('package.json', 'x')], 'm')).rejects.toBeInstanceOf(
        DisallowedPathError,
      );
    });
  });
});

// getFileContent: read by handlePublish's own `baseSha` conflict check, by
// the site.json developer-owned-field re-check, and by GET /api/content.
// Unlike commitFiles above, this hits GET /contents/{path}, not the Git
// Data API, so it needs its own small stub rather than githubStub.ts's.
describe('getFileContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubContentsResponse(body: unknown, status = 200): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
  }

  it('reads and base64-decodes a file\'s content from the Contents API, alongside its blob sha', async () => {
    stubContentsResponse({ content: btoa('[{"id":"x"}]'), encoding: 'base64', sha: 'blob-sha-123' });
    const result = await getFileContent(NO_FETCH_ENV, 'src/content/dishes.json');
    expect(result).toEqual({ content: '[{"id":"x"}]', sha: 'blob-sha-123' });
  });

  // GitHub's Contents API wraps its base64 payload at 60 characters. This
  // decodes correctly today because Node's/workerd's `atob` implements the
  // WHATWG forgiving-base64 algorithm, which strips embedded ASCII
  // whitespace on its own -- confirmed directly (see base64ToUtf8's own
  // comment in worker/github.ts, corrected there after an earlier version
  // claimed the opposite). Kept as a real-shape regression test of the
  // actual documented GitHub response format, not of a manual strip step
  // this code no longer has.
  it('decodes a newline-wrapped base64 payload (GitHub\'s real Contents API shape) correctly', async () => {
    const wrapped = btoa('[{"id":"wrapped-content-longer-than-sixty-chars-to-actually-wrap"}]')
      .match(/.{1,10}/g)!
      .join('\n');
    stubContentsResponse({ content: wrapped, encoding: 'base64', sha: 'blob-sha-wrapped' });
    const result = await getFileContent(NO_FETCH_ENV, 'src/content/dishes.json');
    expect(result?.content).toBe('[{"id":"wrapped-content-longer-than-sixty-chars-to-actually-wrap"}]');
  });

  // The reason this isn't a byte-by-byte `atob` + `String.fromCharCode`
  // decode (worker/auth.ts's `base64ToBytes`, fine for small fixed-width
  // secrets): real file content can carry multi-byte UTF-8 characters, and
  // a naive per-char decode would silently corrupt one into mojibake
  // instead of throwing -- confirmed directly against a real one here.
  it('decodes multi-byte UTF-8 content correctly, not as mojibake', async () => {
    const text = '{"name":"Bicerin — café favourite"}';
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    stubContentsResponse({ content: btoa(binary), encoding: 'base64', sha: 'blob-sha-utf8' });
    const result = await getFileContent(NO_FETCH_ENV, 'src/content/dishes.json');
    expect(result?.content).toBe(text);
  });

  // "Genuinely missing" and "GitHub failed" must stay distinguishable HERE,
  // at this function's own level: handlePublish maps a null (missing) to a
  // 409 conflict and a throw (failure) to a 502, and it can only do that if
  // this function tells the two apart in the first place.
  it('returns null on a 404, rather than throwing', async () => {
    stubContentsResponse({ message: 'Not Found' }, 404);
    const result = await getFileContent(NO_FETCH_ENV, 'src/content/dishes.json');
    expect(result).toBeNull();
  });

  it('throws on a non-404 failure, distinguishable from "file does not exist"', async () => {
    stubContentsResponse({ message: 'server error' }, 500);
    await expect(getFileContent(NO_FETCH_ENV, 'src/content/dishes.json')).rejects.toThrow(/500/);
  });

  // A 200 OK whose body doesn't have the shape the Contents API documents
  // (no base64 `content`, or a different `encoding`) must not be silently
  // treated as empty content -- that would let a caller compare her edit
  // against "" and report a conflict, or a diff, that never existed.
  it('throws on a 200 response with no base64 content, rather than treating it as empty', async () => {
    stubContentsResponse({ type: 'dir' }, 200);
    await expect(getFileContent(NO_FETCH_ENV, 'src/content/dishes.json')).rejects.toThrow(/base64/);
  });

  // Task 3: a 200 OK that has base64 content but no `sha` at all (or an
  // empty one) must not silently become a `baseSha` a caller could round
  // -trip back to POST /api/publish and have compared as a match against
  // anything -- the same defensive posture github.ts already applies to
  // getBranchHeadSha/getCommitTreeSha's own malformed-200 cases.
  it('throws on a 200 response with content but no blob sha', async () => {
    stubContentsResponse({ content: btoa('[]'), encoding: 'base64' }, 200);
    await expect(getFileContent(NO_FETCH_ENV, 'src/content/dishes.json')).rejects.toThrow(/sha/);
  });

  it('requests the Contents API at the right path, ref, and with an authenticated header', async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: btoa('[]'), encoding: 'base64', sha: 'blob-sha-req' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchStub);
    await getFileContent(NO_FETCH_ENV, 'src/content/dishes.json');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.github.com/repos/${NO_FETCH_ENV.GITHUB_OWNER}/${NO_FETCH_ENV.GITHUB_REPO}/contents/src/content/dishes.json?ref=${NO_FETCH_ENV.GITHUB_BRANCH}`,
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${NO_FETCH_ENV.GITHUB_TOKEN}`);
  });
});

// ---------------------------------------------------------------------------
// Undo. restoreBlobs bypasses commitFiles entirely -- it builds its own tree
// and moves the ref itself -- which makes it the ONLY thing standing between
// the Worker's token and the rest of the repository on this path. That is
// what the first test here is really about, and it is the highest-severity
// property in the whole feature.
describe('restoreBlobs: putting blob shas back as a forward commit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses a path outside the allowlist before making a single network call', async () => {
    const stub = makeGitHubStub();
    const env = envWith(stub);
    await expect(restoreBlobs(env, [{ path: '.github/workflows/deploy.yml', sha: 'abc' }], 'msg', BASE_COMMIT_SHA)).rejects.toBeInstanceOf(
      DisallowedPathError,
    );
    // Nothing written, and nothing even read -- a request with one bad path
    // must fail closed the same way commitFiles does.
    expect(stub.calls).toHaveLength(0);
  });

  it('checks EVERY entry, not just the first', async () => {
    const stub = makeGitHubStub();
    const env = envWith(stub);
    await expect(
      restoreBlobs(env, [{ path: 'src/content/dishes.json', sha: 'a' }, { path: 'wrangler.toml', sha: 'b' }], 'msg', BASE_COMMIT_SHA),
    ).rejects.toBeInstanceOf(DisallowedPathError);
    expect(stub.calls).toHaveLength(0);
  });

  // The failure this pins is invisible to a call counter: using the parent's
  // tree as base_tree would silently delete every file changed since the
  // commit being undone. Only the request BODY shows it.
  it('bases its tree on the CURRENT head tree, never the reverted commit\'s parent tree', async () => {
    const stub = makeGitHubStub();
    const env = envWith(stub);
    await restoreBlobs(env, [{ path: 'src/content/dishes.json', sha: 'parent-blob-dishes' }], 'msg', BASE_COMMIT_SHA);

    const treeBody = stub.bodies.find((b) => b.tree !== undefined)!;
    expect(treeBody.base_tree).toBe(BASE_TREE_SHA);
    expect(treeBody.base_tree).not.toBe(PARENT_TREE_SHA);
  });

  it('commits on top of the current head, so this is a forward commit and not a history rewrite', async () => {
    const stub = makeGitHubStub();
    const env = envWith(stub);
    const result = await restoreBlobs(env, [{ path: 'src/content/dishes.json', sha: 'parent-blob-dishes' }], 'msg', BASE_COMMIT_SHA);

    const commitBody = stub.bodies.find((b) => b.parents !== undefined)!;
    expect(commitBody.parents).toEqual([BASE_COMMIT_SHA]);
    expect(commitBody.parents).not.toEqual([PARENT_COMMIT_SHA]);
    expect(result.sha).toBe(NEW_COMMIT_SHA);
  });

  // Undo never deletes. Every tree entry carries a real blob sha; a null sha
  // (GitHub's own way of removing a path) must never appear.
  it('every tree entry names a real blob -- nothing is sent with a null sha', async () => {
    const stub = makeGitHubStub();
    const env = envWith(stub);
    await restoreBlobs(
      env,
      [
        { path: 'src/content/dishes.json', sha: 'parent-blob-dishes' },
        { path: 'public/menus/food-menu.pdf', sha: 'parent-blob-menu' },
      ],
      'msg',
      BASE_COMMIT_SHA,
    );

    const treeBody = stub.bodies.find((b) => b.tree !== undefined)!;
    const entries = treeBody.tree as { path: string; sha: unknown; mode: string; type: string }[];
    expect(entries).toHaveLength(2);
    entries.forEach((entry) => {
      expect(typeof entry.sha).toBe('string');
      expect(entry.sha).not.toBeNull();
      expect(entry.type).toBe('blob');
    });
  });

  // Moves no file bytes at all -- which is what makes this binary-safe for a
  // menu PDF, where a base64/UTF-8 round trip would corrupt the file.
  it('uploads no blobs -- it only re-points existing ones', async () => {
    const stub = makeGitHubStub();
    const env = envWith(stub);
    await restoreBlobs(env, [{ path: 'src/content/dishes.json', sha: 'parent-blob-dishes' }], 'msg', BASE_COMMIT_SHA);
    expect(stub.calls.filter((call) => call.url.endsWith('/git/blobs'))).toHaveLength(0);
  });

  // Review finding (Important). This function used to read the branch head
  // itself, three subrequests after handleUndo had already read it and
  // refused anything that was not the commit she asked to put back -- so a
  // commit landing in that window was silently built on: the restore was
  // parented on the interloper, which made the ref PATCH an ordinary
  // fast-forward GitHub accepts, and the interloper's changes to the same
  // paths were overwritten under a "your site is back to how it was".
  // Building on the sha the CALLER validated is what makes the non-force
  // PATCH a real guard, and this is the assertion that keeps it that way:
  // the head the ref reports is deliberately NOT the sha passed in.
  it('never re-reads the branch head -- it builds on the sha it was handed', async () => {
    const stub = makeGitHubStub({ refSha: 'someone-elses-commit-cccc' });
    const env = envWith(stub);
    await restoreBlobs(env, [{ path: 'src/content/dishes.json', sha: 'parent-blob-dishes' }], 'msg', BASE_COMMIT_SHA)
      .catch(() => undefined);

    expect(stub.calls.filter((call) => /\/git\/ref\/heads\//.test(call.url))).toHaveLength(0);
    expect(stub.bodies.find((b) => b.parents !== undefined)!.parents).toEqual([BASE_COMMIT_SHA]);
    expect(stub.bodies.find((b) => b.tree !== undefined)!.base_tree).toBe(BASE_TREE_SHA);
  });

  // ... and the consequence of the above: because the commit is parented on a
  // sha that is no longer the head, the PATCH is a non-fast-forward and the
  // existing 422 mapping fires. Before the fix this same scenario returned
  // successfully, having quietly absorbed the other commit.
  it('a head that moved after the caller checked it is a conflict, not a silent absorb', async () => {
    const stub = makeGitHubStub({ refSha: 'someone-elses-commit-cccc' });
    const env = envWith(stub);
    await expect(
      restoreBlobs(env, [{ path: 'src/content/dishes.json', sha: 'parent-blob-dishes' }], 'msg', BASE_COMMIT_SHA),
    ).rejects.toBeInstanceOf(PublishConflictError);
  });

  it('a 422 on the ref update surfaces as PublishConflictError, same as a publish', async () => {
    const stub = makeGitHubStub({ failOn: '/git/refs/heads/main', failStatus: 422 });
    const env = envWith(stub);
    await expect(restoreBlobs(env, [{ path: 'src/content/dishes.json', sha: 'x' }], 'msg', BASE_COMMIT_SHA)).rejects.toBeInstanceOf(
      PublishConflictError,
    );
  });
});

describe('getHeadCommit / getTreeBlobShas: reading what an undo needs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the head sha, its single parent, and the paths it touched', async () => {
    const stub = makeGitHubStub({
      headCommit: {
        sha: BASE_COMMIT_SHA,
        parents: [{ sha: PARENT_COMMIT_SHA }],
        files: [{ filename: 'src/content/dishes.json' }, { filename: 'src/content/site.json' }],
      },
    });
    const env = envWith(stub);
    await expect(getHeadCommit(env)).resolves.toEqual({
      sha: BASE_COMMIT_SHA,
      parentSha: PARENT_COMMIT_SHA,
      changedPaths: ['src/content/dishes.json', 'src/content/site.json'],
    });
  });

  // A merge has two parents and a root commit has none -- "the state before
  // it" is not one well-defined thing in either case.
  it('refuses a commit that does not have exactly one parent', async () => {
    const merge = makeGitHubStub({
      headCommit: { sha: BASE_COMMIT_SHA, parents: [{ sha: 'p1' }, { sha: 'p2' }], files: [] },
    });
    await expect(getHeadCommit(envWith(merge))).rejects.toBeInstanceOf(UndoNotPossibleError);
    vi.unstubAllGlobals();

    const root = makeGitHubStub({ headCommit: { sha: BASE_COMMIT_SHA, parents: [], files: [] } });
    await expect(getHeadCommit(envWith(root))).rejects.toBeInstanceOf(UndoNotPossibleError);
  });

  // GitHub caps the `files` array of a commit response at 300. A truncated
  // list must never become a partial revert -- putting half a commit back is
  // worse than refusing, because it looks like it worked.
  it('refuses a file list at the page cap rather than reverting part of a commit', async () => {
    const files = Array.from({ length: 300 }, (_, i) => ({ filename: `src/content/f${i}.json` }));
    const stub = makeGitHubStub({ headCommit: { sha: BASE_COMMIT_SHA, parents: [{ sha: PARENT_COMMIT_SHA }], files } });
    await expect(getHeadCommit(envWith(stub))).rejects.toBeInstanceOf(UndoNotPossibleError);
  });

  it('reads a whole tree into a path -> blob sha map', async () => {
    const stub = makeGitHubStub({
      trees: {
        [PARENT_TREE_SHA]: {
          tree: [
            { path: 'src/content/dishes.json', sha: 'blob-a', type: 'blob' },
            { path: 'src/content', sha: 'tree-x', type: 'tree' },
          ],
        },
      },
    });
    const env = envWith(stub);
    // Only blobs -- a directory entry is not something a tree update can
    // name a sha for.
    await expect(getTreeBlobShas(env, PARENT_TREE_SHA)).resolves.toEqual({ 'src/content/dishes.json': 'blob-a' });
  });

  it('refuses a truncated tree rather than returning a partial map', async () => {
    const stub = makeGitHubStub({
      trees: { [PARENT_TREE_SHA]: { truncated: true, tree: [{ path: 'src/content/dishes.json', sha: 'blob-a', type: 'blob' }] } },
    });
    await expect(getTreeBlobShas(envWith(stub), PARENT_TREE_SHA)).rejects.toBeInstanceOf(UndoNotPossibleError);
  });
});
