import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitFiles, type GitHubEnv } from '../github';
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
    ])('refuses to write %s', async (path) => {
      await expect(commitFiles(NO_FETCH_ENV, [utf8(path, 'x')], 'm')).rejects.toThrow(/path/i);
    });

    it('accepts a well-formed content path and a well-formed asset path', async () => {
      // Positive control for the allowlist tests above: if the regexes were
      // ever tightened into rejecting everything, the negative tests would
      // all still pass for the wrong reason. This proves the legitimate
      // shapes still get through to fetch.
      await commitFiles(
        envWith(stub),
        [utf8('src/content/site.json', '{}'), { path: 'assets-source/hero/postcard.png', content: 'AA', encoding: 'base64' }],
        'm',
      );
      expect(stub.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/git/blobs'))).toHaveLength(2);
    });
  });
});
