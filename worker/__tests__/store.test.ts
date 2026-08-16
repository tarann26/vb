import { describe, expect, it } from 'vitest';
import { D1_ONLY_PATHS, partitionByStore, storeFor, type StoreEnv } from '../store';

// The ten real files under src/content/, kept as this test's own list rather
// than `import { CONTENT_FILES } from '../../src/admin/content'` as originally
// planned: that module's `fetchContent` calls `fetch(url, { credentials:
// 'same-origin' })`, a DOM-only RequestInit field @cloudflare/workers-types
// does not declare (tsconfig.worker.json has no DOM lib, by design -- it
// would collide with the Workers-specific Request/Response/fetch globals
// that KVNamespace, D1Database and the rest of this project depend on).
// Importing the file at all -- even for one unrelated named export -- pulls
// its whole body into this project's `tsc -b` program and fails the gate on
// that fetch call, nothing to do with ContentStore. worker/__tests__/github.test.ts's
// "still accepts the real content file" block keeps its own copy of this
// same list for the identical reason; this does the same.
const CONTENT_FILES = [
  'site.json',
  'galleries.json',
  'dishes.json',
  'drinks.json',
  'press.json',
  'story.json',
  'menus.json',
  'copy.json',
  'sections.json',
  'pages.json',
] as const;

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
  // The whole point of the interface, as an assertion rather than a promise.
  // Every file that exists in src/content/ today keeps its GitHub path, and
  // this fails the moment one of them is quietly moved.
  it.each([undefined, 'github'])('leaves every existing content file on GitHub (CONTENT_STORE=%s)', (mode) => {
    const e = env({ CONTENT_STORE: mode });
    for (const file of CONTENT_FILES) {
      const path = `src/content/${file}`;
      if (D1_ONLY_PATHS.has(path)) continue;
      expect(storeFor(e, path).name, path).toBe('github');
    }
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

  // An unrecognised value must behave like the default, not like "d1".
  // Fail-safe in the direction that keeps the working path working.
  it('treats any unrecognised value as github', () => {
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
