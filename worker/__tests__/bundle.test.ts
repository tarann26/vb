import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Post-review Fix 5 (Plan 5 Task 2): the Worker's freedom from `react` rests
// entirely on nothing in worker/index.ts's own import graph -- ../src/content/
// validate -> ./guards -> ./types is the one path that reaches src/content/ --
// ever pulling in a VALUE (not just a type) from src/content/context.ts,
// which holds the one real `createContext` call in that whole directory.
// Nothing does today (src/content/guards.ts:1's `import type` erases
// entirely, and validate.ts/publish.ts import no react at all), but a
// source-level check on any one file (e.g. pinning guards.ts:1 as
// type-only) only ever proves THAT file is safe today, not that the real
// bundler output stays clean -- the same reasoning
// src/test/bundle.post-build.test.ts's own file comment gives for checking
// the built artifact rather than only the source: "a runtime spy watches
// what ran; it cannot watch what a bundler decided to include." This is
// that same check for the Worker's own entry point, using the same bundler
// (esbuild) wrangler itself uses to build a Worker for real. Confirmed
// directly: temporarily dropping the `type` keyword from guards.ts:1 does
// NOT turn this red on its own (esbuild's TS transform elides an import
// whose bindings are only ever used in type position, `type` keyword or
// not) -- the real risk this guards against is a future file in the chain
// importing a VALUE from src/content/context.ts (or src/content/index.ts's
// own `export * from './types'` at line 73 ever widening to also re-export
// from ./context), which this test catches regardless of exactly how it
// happens, unlike a check pinned to one line's keyword.
describe('worker/index.ts never bundles React', () => {
  it('esbuild-bundling the real Worker entry point contains no react/createContext', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vb-worker-bundle-'));
    const outfile = join(dir, 'worker-bundle.js');
    try {
      execFileSync('node_modules/.bin/esbuild', [
        'worker/index.ts',
        '--bundle',
        '--platform=node',
        '--format=esm',
        `--outfile=${outfile}`,
      ]);
      const bundled = readFileSync(outfile, 'utf8');
      // `createContext` is the one function that actually matters -- it is
      // the real react runtime call src/content/context.ts makes, and would
      // appear verbatim in the bundle if react's own source ever landed
      // here (esbuild does not rename bare identifiers it bundles from
      // node_modules).
      expect(bundled).not.toMatch(/createContext/);
      // A broader net: react's own package name, wherever esbuild would
      // record it (a bundled source-file path comment, a require/import
      // specifier it failed to fully inline). Word-bounded so this cannot
      // match on an unrelated substring (e.g. "reactive"); confirmed empty
      // on the current, clean bundle before this test was ever made to
      // fail on purpose.
      expect(bundled).not.toMatch(/\breact\b/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
