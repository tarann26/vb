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
// clock directly (see filter-unpublished.ts): it lets the git-throws branch
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
// The write happens in `closeBundle`, not `buildStart`: `closeBundle` fires
// after prepareOutDir has already emptied `outDir` and Rollup has written
// the real bundle output, so this file survives instead of being deleted by
// that emptying step. It's also the one non-buildStart hook Vite fires on
// dev-server shutdown (`server.close()` calls the plugin container's
// `close()`, which runs `closeBundle` on whatever plugins are still
// registered) -- which is what makes the "does not run in dev" test
// actually falsifiable: drop `apply: 'build'` and closeBundle fires when the
// dev server closes too, writing the file for real, and that test fails.
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
    closeBundle() {
      const payload = JSON.stringify({
        sha: resolveCommitSha(),
        builtAt: new Date().toISOString(),
      });
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, 'build-info.json'), payload);
    },
  };
}
