import { describe, it, expect } from 'vitest';
import filterUnpublished, { filterUnpublishedJson } from '../filter-unpublished';

// This is the coverage that matters: the plugin is `apply: 'build'` only
// (see filter-unpublished.ts), so it never runs during `vitest run` --
// these are the only tests that ever exercise the transform.
const TODAY = '2026-08-02';

const fixture = JSON.stringify([
  { id: 'past-item', name: 'Past Item', publishAt: '2026-07-01' },
  { id: 'future-item', name: 'Future Item', publishAt: '2099-01-01' },
  { id: 'undated-item', name: 'Undated Item' },
]);

describe('filterUnpublishedJson', () => {
  it('drops a future-dated item and keeps past-dated and undated items', () => {
    const result = filterUnpublishedJson('/repo/src/content/dishes.json', fixture, TODAY);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result as string) as Array<{ id: string }>;
    expect(parsed.map((item) => item.id)).toEqual(['past-item', 'undated-item']);
  });

  it.each(['dishes', 'drinks', 'press'])(
    'filters %s.json, matched by its resolved module id',
    (name) => {
      const result = filterUnpublishedJson(`/repo/src/content/${name}.json`, fixture, TODAY);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result as string) as Array<{ id: string }>;
      expect(parsed.map((item) => item.id)).toEqual(['past-item', 'undated-item']);
    },
  );

  it('returns null (leaves the module untouched) for a file that is not scheduled content', () => {
    expect(filterUnpublishedJson('/repo/src/content/site.json', fixture, TODAY)).toBeNull();
  });

  it('returns null for a JSON payload that is not an array', () => {
    expect(filterUnpublishedJson('/repo/src/content/dishes.json', '{}', TODAY)).toBeNull();
  });

  it('propagates a throw on a malformed publishAt, rather than dropping or guessing', () => {
    const bad = JSON.stringify([{ id: 'x', publishAt: 'next tuesday' }]);
    expect(() => filterUnpublishedJson('/repo/src/content/dishes.json', bad, TODAY)).toThrow();
  });
});

describe('filterUnpublished (the Vite plugin)', () => {
  it('applies to build only, never to dev/test', () => {
    expect(filterUnpublished().apply).toBe('build');
  });

  it('runs pre, before Vite\'s own JSON plugin converts the file to JS', () => {
    expect(filterUnpublished().enforce).toBe('pre');
  });
});
