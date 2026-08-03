import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitFiles, getFileContent, DisallowedPathError, type GitHubEnv } from '../github';
import {
  BASE_COMMIT_SHA,
  BASE_TREE_SHA,
  NEW_COMMIT_SHA,
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
    ])('refuses to write %s', async (path) => {
      await expect(commitFiles(NO_FETCH_ENV, [utf8(path, 'x')], 'm')).rejects.toThrow(/path/i);
    });

    // Every content file this Worker's validateContent (Task 2) actually
    // recognises must still be a legal commitFiles path -- the allowlist
    // tightened in response to Minor 4 must not accidentally start
    // rejecting one of the nine real files it exists to allow.
    it.each([
      'copy.json',
      'dishes.json',
      'drinks.json',
      'galleries.json',
      'menus.json',
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

// getFileContent: added for Task 8's daily schedule reconciliation
// (worker/index.ts's reconcileScheduleFromSource), the one caller. Unlike
// commitFiles above, this hits GET /contents/{path}, not the Git Data API,
// so it needs its own small stub rather than githubStub.ts's.
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

  it('reads and base64-decodes a file\'s content from the Contents API', async () => {
    stubContentsResponse({ content: btoa('[{"id":"x"}]'), encoding: 'base64' });
    const result = await getFileContent(NO_FETCH_ENV, 'src/content/dishes.json');
    expect(result).toBe('[{"id":"x"}]');
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
    stubContentsResponse({ content: wrapped, encoding: 'base64' });
    const result = await getFileContent(NO_FETCH_ENV, 'src/content/dishes.json');
    expect(result).toBe('[{"id":"wrapped-content-longer-than-sixty-chars-to-actually-wrap"}]');
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
    stubContentsResponse({ content: btoa(binary), encoding: 'base64' });
    const result = await getFileContent(NO_FETCH_ENV, 'src/content/dishes.json');
    expect(result).toBe(text);
  });

  // The property a mutation confirmed has no OTHER test covering it:
  // reconcileScheduleFromSource's own try/catch swallows both "genuinely
  // missing" and "GitHub failed" identically (leaving that file's already-
  // known schedule untouched either way), so nothing at that call site can
  // tell a 404 apart from a 500 -- this has to be proven at this function's
  // own level instead.
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
  // treated as empty content -- that would make reconciliation compute
  // "nothing scheduled" from a response that never actually said that.
  it('throws on a 200 response with no base64 content, rather than treating it as empty', async () => {
    stubContentsResponse({ type: 'dir' }, 200);
    await expect(getFileContent(NO_FETCH_ENV, 'src/content/dishes.json')).rejects.toThrow(/base64/);
  });

  it('requests the Contents API at the right path, ref, and with an authenticated header', async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ content: btoa('[]'), encoding: 'base64' }), { status: 200 }));
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
