import { describe, it, expect } from 'vitest';
import { dishes } from '../index';

// Internal working notes ("exact variant unconfirmed", "TODO: verify with chef") must
// never ship as customer-facing copy. FoodGallery.tsx renders dish.description directly
// into the public gallery caption, so a leaked disclaimer becomes a diner-visible sentence
// on the live site. This is a case-insensitive word list, not a content lint — it exists to
// catch the class of bug where an implementer's hedge slips past review into dishes.json.
const META_LANGUAGE_PATTERN =
  /\b(unconfirmed|uncertain|unknown|tbd|todo|probably|assumed|verify)\b/i;

describe('dish descriptions', () => {
  it('discovers at least one dish to check', () => {
    expect(dishes.length).toBeGreaterThan(0);
  });

  it.each(dishes.map((dish) => [dish.id, dish.description] as const))(
    '%s description contains no meta-language',
    (_id, description) => {
      expect(description).not.toMatch(META_LANGUAGE_PATTERN);
    },
  );
});
