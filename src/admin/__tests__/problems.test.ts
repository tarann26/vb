import { describe, expect, it } from 'vitest';
import { problemsFor } from '../problems';
import type { ValidationProblem } from '../../content/validate';

function problem(field: string, message = field || 'file-level'): ValidationProblem {
  return { field, message };
}

describe('problemsFor: array-shaped files ([i].key)', () => {
  it('matches the exact index requested', () => {
    const problems = [problem('[0].name'), problem('[1].name')];
    expect(problemsFor(problems, 0, 'name')).toEqual([problem('[0].name')]);
    expect(problemsFor(problems, 1, 'name')).toEqual([problem('[1].name')]);
  });

  // The exact defect this task's brief calls out by name: suffix-matching
  // (e.g. `field.endsWith('.' + key)`) would return BOTH of these for
  // index 1 -- confirmed directly by swapping the implementation to that
  // form and watching this assertion fail. A 38-item drinks list makes
  // this the difference between a message that helps and one that
  // actively misleads.
  it('does not match a different index sharing the same key, even one whose digits contain the requested index', () => {
    const problems = [problem('[0].name'), problem('[1].name'), problem('[11].name')];
    expect(problemsFor(problems, 1, 'name')).toEqual([problem('[1].name')]);
  });

  // index 0 is falsy in JS -- a bug written as `if (index)` rather than
  // `if (index !== undefined)` would silently treat "rendering item 0" the
  // same as "no index at all" and fall into the non-array matching branch
  // below, which also happens to match a bare `id` field. Confirmed this
  // catches that: switching the guard to a truthy check makes this return
  // both problems instead of only the array-shaped one.
  it('treats index 0 as a real index, not as "no index supplied"', () => {
    const problems = [problem('[0].id', 'dish 0 needs an id'), problem('id', 'a bare id problem')];
    expect(problemsFor(problems, 0, 'id')).toEqual([problem('[0].id', 'dish 0 needs an id')]);
  });

  it('returns nothing for a field-level ("") problem', () => {
    const problems = [problem('', 'dishes.json: the menu needs at least one dish')];
    expect(problemsFor(problems, 0, 'name')).toEqual([]);
  });
});

describe('problemsFor: non-array files (bare key, or key[i]/key[i].sub)', () => {
  it('matches a bare scalar key exactly', () => {
    const problems = [problem('heading'), problem('strapline')];
    expect(problemsFor(problems, undefined, 'heading')).toEqual([problem('heading')]);
  });

  it('does not match a different key that merely shares a prefix', () => {
    // 'name' must not swallow 'nameless' -- the exact-match branch (not a
    // startsWith) is what a non-array file's SCALAR fields need.
    const problems = [problem('name'), problem('nameless')];
    expect(problemsFor(problems, undefined, 'name')).toEqual([problem('name')]);
  });

  it('matches every item of that field\'s own array (key[i], and key[i].sub)', () => {
    const problems = [problem('hours[0]'), problem('hours[1]'), problem('address')];
    expect(problemsFor(problems, undefined, 'hours')).toEqual([problem('hours[0]'), problem('hours[1]')]);
  });

  it('matches key[i].sub the same way', () => {
    const problems = [problem('heroCollage[2].src'), problem('heroCollage[0].className')];
    expect(problemsFor(problems, undefined, 'heroCollage')).toEqual([
      problem('heroCollage[2].src'),
      problem('heroCollage[0].className'),
    ]);
  });

  it('does not match a different key whose name starts with the same letters', () => {
    // 'hour' must not swallow 'hours[0]' -- the field literally has to
    // start with 'hour[' or equal 'hour', neither of which 'hours[0]' is.
    const problems = [problem('hours[0]')];
    expect(problemsFor(problems, undefined, 'hour')).toEqual([]);
  });

  it('returns nothing for a field-level ("") problem', () => {
    const problems = [problem('', "press.json: articles must be sorted newest first")];
    expect(problemsFor(problems, undefined, 'heading')).toEqual([]);
  });
});
