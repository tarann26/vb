// @vitest-environment node
//
// vitest.config.ts sets `environment: 'jsdom'` project-wide, and jsdom's
// duplicated globals (its own TextEncoder in a different realm from Node's
// Uint8Array) break esbuild's own startup invariant check -- confirmed
// directly: running this file under the default jsdom environment fails
// every test before any of them run, with esbuild refusing to start at all
// ("new TextEncoder().encode('') instanceof Uint8Array is incorrectly
// false"). This file is the one place in the suite that invokes Vite's
// build()/createServer() for real, so it needs the real Node environment
// those rely on -- it isn't testing DOM-facing app code, so losing jsdom
// here costs nothing.
import { describe, it, expect, afterEach } from 'vitest';
import { build, createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import buildInfo, { resolveCommitSha } from '../build-info';

// A minimal, throwaway Vite root -- not the real site's vite.config.ts.
// Deliberately isolated from the app (no react plugin, no Tailwind, no
// content JSON) so these tests exercise only build-info's own behaviour
// under a real `vite build` and a real `vite dev`-equivalent, rather than
// the whole app's build pipeline (slow, and a failure there would be
// indistinguishable from a failure here).
function makeFixtureRoot(): string {
  // realpathSync: macOS's tmpdir() returns a path through /var, which is
  // itself a symlink to /private/var. Vite computes the built HTML's
  // fileName relative to outDir using each path's resolved (non-symlink)
  // form, and root/outDir disagreeing about which form to use is exactly
  // what produced a bogus "../../../../../../private/var/..." fileName the
  // first time this test ran without this call.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'build-info-fixture-')));
  writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>',
  );
  writeFileSync(path.join(root, 'main.js'), 'export default 1;\n');
  return root;
}

const cleanupRoots: string[] = [];

afterEach(() => {
  while (cleanupRoots.length) {
    rmSync(cleanupRoots.pop() as string, { recursive: true, force: true });
  }
});

describe('buildInfo (the Vite plugin)', () => {
  // The obvious, shallow check -- included, but not relied on alone. It
  // proves the property is set; it proves nothing about what Vite actually
  // does with it, which is what the two tests below establish instead.
  it('is scoped to apply: build', () => {
    expect(buildInfo().apply).toBe('build');
  });

  // Behavioural, not `expect(plugin.apply).toBe('build')`: runs a real
  // `vite build` against an isolated fixture root and reads the file it
  // actually produced on disk.
  it('writes the commit sha and a build time into dist/build-info.json after a real build', async () => {
    const root = makeFixtureRoot();
    cleanupRoots.push(root);
    const outDir = path.join(root, 'dist');

    const before = Date.now();
    const originalSha = process.env.CF_PAGES_COMMIT_SHA;
    process.env.CF_PAGES_COMMIT_SHA = 'abc1234';
    try {
      await build({
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [buildInfo()],
        build: { outDir, write: true },
      });
    } finally {
      if (originalSha === undefined) delete process.env.CF_PAGES_COMMIT_SHA;
      else process.env.CF_PAGES_COMMIT_SHA = originalSha;
    }

    const infoPath = path.join(outDir, 'build-info.json');
    expect(existsSync(infoPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(infoPath, 'utf8'));
    expect(parsed.sha).toBe('abc1234');
    const builtAt = new Date(parsed.builtAt).getTime();
    expect(Number.isNaN(builtAt)).toBe(false);
    expect(builtAt).toBeGreaterThanOrEqual(before);
  });

  // The other half of the behavioural proof, and the one that actually
  // exercises `apply: 'build'` rather than merely asserting it: `createServer`
  // simulates `vite dev` (command: 'serve'), and closing the server triggers
  // `closeBundle` on any plugin still registered for that command -- the
  // same hook the build test above relies on to write the file. If
  // `apply: 'build'` were dropped from the plugin, this test would fail: the
  // plugin would stay in the resolved dev-server plugin list, closeBundle
  // would fire on server.close(), and build-info.json would be written for
  // real (confirmed by removing `apply: 'build'` locally and re-running --
  // this test then fails with the file present).
  it('does not write build-info.json during vite dev, even after the dev server closes', async () => {
    const root = makeFixtureRoot();
    cleanupRoots.push(root);
    const outDir = path.join(root, 'dist');

    const server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [buildInfo()],
      build: { outDir },
      server: { middlewareMode: true },
    });
    await server.close();

    expect(existsSync(path.join(outDir, 'build-info.json'))).toBe(false);
  });
});

// resolveCommitSha's own tests: the plugin tests above pin CF_PAGES_COMMIT_SHA
// (the path every real Cloudflare deploy takes), so none of them exercise the
// git-fallback or unknown-fallback branches at all. `gitRevParse` is a
// parameter precisely so those branches can be driven directly, the same way
// filter-unpublished.ts's todayInKolkata takes `today` as a parameter instead
// of stubbing the clock.
describe('resolveCommitSha', () => {
  it('prefers CF_PAGES_COMMIT_SHA when set', () => {
    expect(resolveCommitSha({ CF_PAGES_COMMIT_SHA: 'deadbeef' })).toBe('deadbeef');
  });

  it('falls back to git rev-parse HEAD when CF_PAGES_COMMIT_SHA is unset', () => {
    const realHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(resolveCommitSha({})).toBe(realHead);
  });

  // The fallback the brief calls out by name: never fail the build over a
  // missing stamp. A build machine with a shallow clone, or no .git at all,
  // must still produce a working build -- just with sha: 'unknown'.
  it('falls back to "unknown", without throwing, when git itself fails', () => {
    const throwingGit = () => {
      throw new Error('fatal: not a git repository');
    };
    expect(resolveCommitSha({}, throwingGit)).toBe('unknown');
  });

  it('treats an empty-string CF_PAGES_COMMIT_SHA as unset, falling through to git', () => {
    expect(resolveCommitSha({ CF_PAGES_COMMIT_SHA: '' }, () => 'from-git')).toBe('from-git');
  });
});
