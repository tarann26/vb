import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { D1_ONLY_PATHS, partitionByStore, storeFor, type StoreEnv } from '../store';

// Ground truth for "every content file that exists today", read straight off
// disk rather than kept as a name list somewhere -- a THIRD copy of that list
// (after src/admin/content.ts's own CONTENT_FILES and
// worker/__tests__/github.test.ts's inline one) would drift the moment an
// eleventh file landed in src/admin/content.ts and nobody remembered to add
// it here too: the test would keep passing, silently checking one fewer file
// than actually exists. Not `import { CONTENT_FILES } from
// '../../src/admin/content'` either -- that module's `fetchContent` calls
// `fetch(url, { credentials: 'same-origin' })`, a DOM-only RequestInit field
// @cloudflare/workers-types does not declare (tsconfig.worker.json has no DOM
// lib, by design: it would collide with the Workers-specific
// Request/Response/fetch globals that KVNamespace, D1Database and the rest of
// this project depend on). Importing the file at all -- even for one
// unrelated named export -- pulls its whole body into this project's
// `tsc -b` program and fails the gate on that fetch call, nothing to do with
// ContentStore. `readdirSync` sidesteps that entirely: @types/node is
// already in this project (worker/__tests__/migrations.test.ts reads a
// directory the same way), and a plain `.json` filename list has no DOM
// surface to collide with.
const CONTENT_FILES = readdirSync('src/content')
  .filter((f) => f.endsWith('.json'))
  .sort();

function env(overrides: Partial<StoreEnv> = {}): StoreEnv {
  return {
    GITHUB_OWNER: 'tarann26',
    GITHUB_REPO: 'vb',
    GITHUB_BRANCH: 'main',
    GITHUB_TOKEN: 'store-test-token-not-real',
    DB: {} as D1Database,
    ...overrides,
  };
}

describe('storeFor, with CONTENT_STORE unset or "github"', () => {
  // storeFor's only branch is `env.CONTENT_STORE === 'd1' ? D1 : GitHub` --
  // 'undefined' and the literal string 'github' reach that identical
  // comparison the identical way, so there is no second branch a mutation
  // could break for one and not the other. Parametrizing over both here
  // added a case that could never fail on its own; 'undefined' is the actual
  // production default (an env that predates CONTENT_STORE, or one where
  // it's simply not set) and is what this test exercises. The literal string
  // 'github' is still checked -- folded into "treats 'github' and any
  // unrecognised value..." below, where it sits next to 'D1' and 'postgres'
  // as one more input that same branch must treat identically.
  //
  // The whole point of the interface, as an assertion rather than a promise.
  // Every file that exists in src/content/ today keeps its GitHub path, and
  // this fails the moment one of them is quietly moved. No D1_ONLY_PATHS skip
  // here, deliberately: an earlier version of this test wrote
  // `if (D1_ONLY_PATHS.has(path)) continue`, which exempts exactly the paths
  // that would prove a regression -- adding 'src/content/site.json' to
  // D1_ONLY_PATHS made every one of this suite's tests pass, because this
  // loop skipped the one path that had actually moved. CONTENT_FILES today
  // shares no path with D1_ONLY_PATHS (proven by the exact-membership test
  // below), so this loop can check every real path unconditionally and still
  // pass -- and if a future D1_ONLY_PATHS entry ever did collide with a real
  // content file, that collision is exactly what this loop exists to catch,
  // not exempt.
  it('leaves every existing content file on GitHub when CONTENT_STORE is unset', () => {
    const e = env();
    for (const file of CONTENT_FILES) {
      expect(storeFor(e, `src/content/${file}`).name, file).toBe('github');
    }
  });

  // Growing this set is meant to be a deliberate, visible edit -- not a
  // silent side effect of some other change. Pinning its exact membership
  // (not just "contains awards.json") is what makes an accidental or
  // careless addition show up as a diff in THIS file, right next to the
  // comment explaining why the set exists at all.
  it('the D1-only set contains exactly the pilot file', () => {
    expect([...D1_ONLY_PATHS]).toEqual(['src/content/awards.json']);
  });

  it('sends the pilot file to D1 anyway, because it exists nowhere else', () => {
    expect(storeFor(env(), 'src/content/awards.json').name).toBe('d1');
  });

  it('sends photo and menu paths to GitHub -- R2 is bound and unused in this phase', () => {
    expect(storeFor(env(), 'assets-source/food/photo.jpg').name).toBe('github');
    expect(storeFor(env(), 'public/menus/food-menu.pdf').name).toBe('github');
  });
});

describe('storeFor, with CONTENT_STORE="d1"', () => {
  it('moves everything at once -- the switch is one value, not a code change', () => {
    const e = env({ CONTENT_STORE: 'd1' });
    for (const file of CONTENT_FILES) {
      expect(storeFor(e, `src/content/${file}`).name, file).toBe('d1');
    }
  });

  // An unrecognised value must behave like the default, not like "d1". Fail-
  // safe in the direction that keeps the working path working. 'github' is
  // included here, not just 'D1' and 'postgres': storeFor has no branch
  // dedicated to the literal string 'github', so this is where that value
  // gets exercised (see the comment on "leaves every existing content file
  // on GitHub" above for why it's not parametrized there too).
  it('treats "github" and any unrecognised value as github', () => {
    expect(storeFor(env({ CONTENT_STORE: 'github' }), 'src/content/dishes.json').name).toBe('github');
    expect(storeFor(env({ CONTENT_STORE: 'D1' }), 'src/content/dishes.json').name).toBe('github');
    expect(storeFor(env({ CONTENT_STORE: 'postgres' }), 'src/content/dishes.json').name).toBe('github');
  });
});

describe('partitionByStore', () => {
  it('splits a mixed publish and keeps each leg in the caller order', () => {
    const files = [
      { path: 'src/content/awards.json', content: '[]', encoding: 'utf-8' as const },
      { path: 'src/content/sections.json', content: '[]', encoding: 'utf-8' as const },
      { path: 'src/content/copy.json', content: '{}', encoding: 'utf-8' as const },
    ];
    const { d1, github } = partitionByStore(env(), files);
    expect(d1.map((f) => f.path)).toEqual(['src/content/awards.json']);
    expect(github.map((f) => f.path)).toEqual(['src/content/sections.json', 'src/content/copy.json']);
  });
});
