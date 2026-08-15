import { describe, expect, it } from 'vitest';
import pages from '../content/pages.json';
import { validateContent } from '../content/validate';

describe('pages.json', () => {
  it('holds only the four real pages', () => {
    expect(pages.map((p) => p.slug)).toEqual([
      'catering', 'cheeseboards', 'cooking-class', 'membership',
    ]);
  });

  it('has no section that would warn in the dashboard', () => {
    // The "this section needs at least one item" and "needs at least one
    // image" warnings are editor-only -- nothing public reads validation
    // problems -- but she still sees them every time she opens /edit, on
    // pages that were never going to be finished.
    const problems = validateContent('pages.json', pages);
    expect(problems).toEqual([]);
  });
});
