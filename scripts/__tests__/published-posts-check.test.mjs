import { describe, expect, it } from 'vitest';
import { postsDriftProblems } from '../published-posts-check.mjs';

// Slugs only -- the function compares slugs, so a fixture carrying whole posts
// would be pretending to test something it does not look at.
const list = (...slugs) => JSON.stringify(slugs.map((slug) => ({ slug })));

const THREE = list('one', 'two', 'three');

describe('postsDriftProblems', () => {
  it('says nothing at all when the live copy and the repository agree', () => {
    expect(postsDriftProblems(THREE, THREE)).toEqual({ failures: [], notes: [] });
  });

  // The hazard's exact signature, and the only thing here that exits 1.
  it('fails when the live blog is missing a post the repository has', () => {
    const { failures, notes } = postsDriftProblems(list('one', 'three'), THREE);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('two');
    expect(failures[0]).toMatch(/seed-posts-d1\.mjs/);
    expect(notes).toEqual([]);
  });

  it('names every missing post, not just the first', () => {
    const { failures } = postsDriftProblems(list('two'), THREE);
    expect(failures[0]).toContain('one');
    expect(failures[0]).toContain('three');
    expect(failures[0]).toContain('2 post(s)');
  });

  // The other direction is the ordinary state of this system between syncs and
  // must never fail a deploy. If it did, the check would be switched off
  // within a week and the failing half would go with it.
  it('only notes -- never fails -- when the live blog is AHEAD of the repository', () => {
    const { failures, notes } = postsDriftProblems(list('one', 'two', 'three', 'four'), THREE);
    expect(failures).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('four');
    expect(notes[0]).toMatch(/sync-posts-fallback\.mjs/);
  });

  it('reports both directions at once when they have diverged both ways', () => {
    const { failures, notes } = postsDriftProblems(list('one', 'four'), THREE);
    expect(failures[0]).toContain('two');
    expect(failures[0]).toContain('three');
    expect(notes[0]).toContain('four');
  });

  it('does not fail on ordering, because neither artefact promises one', () => {
    expect(postsDriftProblems(list('three', 'one', 'two'), THREE).failures).toEqual([]);
  });

  it.each([
    ['a live body that is not JSON', 'not json', THREE, /live posts\.json could not be read/],
    ['a live body that is not a list', '{"posts":[]}', THREE, /live posts\.json is not a list/],
    ['a live entry with no slug', '[{"id":"x"}]', THREE, /live posts\.json has an entry at \[0\] with no slug/],
    ['a committed body that is not JSON', THREE, 'not json', /src\/content\/posts\.json could not be read/],
    ['a committed body that is not a list', THREE, '{"posts":[]}', /committed posts\.json is not a list/],
  ])('fails on %s rather than passing by accident', (_name, served, committed, pattern) => {
    const { failures } = postsDriftProblems(served, committed);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(pattern);
  });

  // Pinning the negative: an empty blog on both sides is a real, legal state
  // (assertPosts accepts an empty list on purpose), and it must not be read as
  // "everything is missing".
  it('accepts two empty lists, because a restaurant with no posts is not a failure', () => {
    expect(postsDriftProblems('[]', '[]')).toEqual({ failures: [], notes: [] });
  });
});
