import type { Plugin } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Cloudflare Pages sets CF_PAGES_COMMIT_SHA for every deploy -- that's the
// value the dashboard actually wants, since it's the sha of the exact commit
// Cloudflare built. `git rev-parse HEAD` covers every other way this build
// script runs (a developer's machine, a CI dry run) where that env var is
// unset. 'unknown' covers the last resort: a shallow clone or sandbox with
// no .git at all, where `git rev-parse` itself throws. `execFileSync` (argv
// array, no shell) rather than `execSync` (string, shell) -- there's no
// user input here to inject, but there's also no reason to open a shell for
// a fixed two-argument command.
//
// `gitRevParse` is a parameter (not a bare call in the body) for the same
// reason todayInKolkata's callers pass `today` in rather than reading the
// clock directly (see src/content/publish.ts): it lets the git-throws branch
// be exercised deterministically in a test, without uninstalling git or
// mutating PATH.
//
// Never throws -- a build that works is worth more than a stamp that is
// always right. The dashboard's poll is a convenience, not a correctness
// guarantee; Task 8 adds the real failure signal.
export function resolveCommitSha(
  env: NodeJS.ProcessEnv = process.env,
  gitRevParse: () => string = () =>
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
): string {
  if (env.CF_PAGES_COMMIT_SHA) return env.CF_PAGES_COMMIT_SHA;
  try {
    return gitRevParse();
  } catch {
    return 'unknown';
  }
}

// Stamps dist/build-info.json with the commit sha and build time, so the
// admin dashboard can poll it and tell the owner her change went live.
//
// `apply: 'build'` scopes this to `vite build` only -- see
// filter-unpublished.ts's own comment for why that also means Vitest never
// sees it (vitest.config.ts is a separate Vite config that never imports
// this file). Verified behaviourally, not just by reading `.apply`: see
// plugins/__tests__/build-info.test.ts, which runs a real `vite build` and
// a real `vite dev`-equivalent (createServer + close) against a minimal
// fixture root and asserts the file appears after one and not the other.
//
// The write happens in `writeBundle`, not `buildStart`: `writeBundle` fires
// only after Rollup has actually written the real bundle output to disk, so
// (a) this file survives instead of being deleted by outDir's earlier
// emptying step, and (b) -- the reason it isn't `closeBundle`, which was
// this plugin's first implementation -- it does not fire on a build that
// fails. `closeBundle` is called from Rollup's own `bundle.close()`, which
// Vite's build() runs in a `finally` block keyed only on whether `bundle`
// was assigned, not on whether the build succeeded: a build whose module
// graph resolves but whose output generation then fails (e.g. an entry
// script's import that Rollup only discovers is unresolvable while
// rendering) still assigns `bundle`, so `closeBundle` still fires -- and
// under the old implementation, still wrote a fresh, plausible-looking
// `{ sha: <real current HEAD>, builtAt: <now> }`, indistinguishable from a
// successful build's stamp. Confirmed directly against that exact fixture
// (plugins/__tests__/build-info.test.ts's "fails after the module graph
// resolves" test): with `closeBundle`, the build rejects and the file still
// gets written; with `writeBundle`, it doesn't. Cloudflare Pages fails the
// deploy on a non-zero build exit and never publishes that `dist/` today --
// but Task 8's dashboard polls this file directly, so a stray misleading
// stamp on a failed build is a real hazard the moment anything reads this
// file without independently checking the build's own exit code.
//
// Unlike `closeBundle`, `writeBundle` does NOT fire on dev-server shutdown
// (`server.close()` calls Vite's own dev plugin container's `close()`,
// which runs `buildEnd` and `closeBundle` only -- confirmed directly, not
// assumed, after this plugin's comment briefly claimed otherwise). So the
// "no file after a dev server closes" test in
// plugins/__tests__/build-info.test.ts is a structural guarantee of Vite's
// dev server (it never calls Rollup's `bundle.write()` at all), true
// regardless of `apply`, not evidence for `apply: 'build'` specifically.
// What actually is falsifiable through `apply` is a separate test in that
// file, asking Vite's own `resolveConfig` (via `server.config.plugins`)
// whether it kept this plugin for the 'serve' command at all -- drop
// `apply: 'build'` and the plugin shows up there too.
//
// Informational, not a bug: `writeBundle` (like `closeBundle`) also fires on
// every successful rebuild under `vite build --watch`, restamping the file
// each time -- correct if this repo ever ran watch-mode builds. It doesn't:
// `npm run build` never passes `--watch`.
export default function buildInfo(): Plugin {
  let outDir = 'dist';
  return {
    name: 'build-info',
    apply: 'build',
    configResolved(config) {
      outDir = path.isAbsolute(config.build.outDir)
        ? config.build.outDir
        : path.join(config.root, config.build.outDir);
    },
    writeBundle() {
      const payload = JSON.stringify({
        sha: resolveCommitSha(),
        builtAt: new Date().toISOString(),
      });
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, 'build-info.json'), payload);
    },
  };
}
