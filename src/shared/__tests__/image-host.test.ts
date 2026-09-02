import { describe, it, expect } from 'vitest';
import { IMAGE_BASE, imageUrl, keyFromImageUrl, cacheControlForKey } from '../image-host';
import { cacheControlFor } from '../../../scripts/migrate-images.mjs';

describe('the one place the image prefix is spelled', () => {
  it('round-trips an ordinary key', () => {
    expect(keyFromImageUrl(imageUrl('food/pizza1.webp'))).toBe('food/pizza1.webp');
  });

  // Five real filenames in this library carry spaces. A raw space in a URL
  // sitting inside JSON is not a request for the object R2 holds.
  it('round-trips a key with spaces and an apostrophe', () => {
    const key = 'mocktails/blood orange espresso tonic.webp';
    expect(imageUrl(key)).toContain('%20');
    expect(keyFromImageUrl(imageUrl(key))).toBe(key);
  });

  it('refuses a key with a leading slash rather than silently doubling it', () => {
    expect(() => imageUrl('/food/pizza1.webp')).toThrow();
  });

  // The move off img.viabiancarestaurant.com, pinned as a property rather
  // than as a string: what this module produces has to resolve against
  // WHICHEVER host served the page, so it may not carry a scheme or an
  // authority of its own. A value that went back to naming a host would still
  // round-trip through the two functions above and would still pass every
  // other test in this file.
  it('builds a reference that names no host at all', () => {
    const built = imageUrl('food/pizza1.webp');
    expect(built.startsWith('/')).toBe(true);
    expect(built.startsWith('//')).toBe(false);
    expect(built).not.toContain(':');
    expect(() => new URL(built)).toThrow();
    expect(new URL(built, 'https://viabiancarestaurant.com').pathname).toBe('/images/food/pizza1.webp');
  });

  it('puts every object under the one prefix the Worker route covers', () => {
    expect(IMAGE_BASE).toBe('/images');
    expect(imageUrl('food/pizza1.webp').startsWith(IMAGE_BASE + '/')).toBe(true);
  });

  it('does not claim a whole url, or a path outside the prefix', () => {
    expect(keyFromImageUrl('https://viabiancarestaurant.com/images/food/pizza1.webp')).toBeNull();
    expect(keyFromImageUrl('https://img.viabiancarestaurant.com/food/pizza1.webp')).toBeNull();
    expect(keyFromImageUrl('/food/pizza1.webp')).toBeNull();
    expect(keyFromImageUrl('/imagesfood/pizza1.webp')).toBeNull();
    expect(keyFromImageUrl(IMAGE_BASE)).toBeNull();
    expect(keyFromImageUrl(IMAGE_BASE + '/')).toBeNull();
  });

  // `decodeURI` throws a URIError on a malformed escape, and this is the one
  // caller that gets its input from a stranger: worker/images.ts hands it a
  // request's own pathname, and the URL parser leaves `%zz` in a pathname
  // exactly as it arrived. An uncaught throw there is a 500 on a photograph.
  it('refuses a malformed percent-escape rather than throwing', () => {
    expect(() => keyFromImageUrl(IMAGE_BASE + '/%zz.webp')).not.toThrow();
    expect(keyFromImageUrl(IMAGE_BASE + '/%zz.webp')).toBeNull();
    expect(keyFromImageUrl(IMAGE_BASE + '/food/%.webp')).toBeNull();
  });

  it('refuses a traversal key', () => {
    expect(keyFromImageUrl(IMAGE_BASE + '/../wrangler.toml')).toBeNull();
    expect(keyFromImageUrl(IMAGE_BASE + '/food/../../wrangler.toml')).toBeNull();
  });
});

// The two spellings of one rule, run against each other over the shapes that
// actually appear in the bucket. There is no compiler link between a .ts the
// Worker imports and a .mjs plain Node runs -- exactly the split
// src/shared/derivative-path.ts and scripts/paths.mjs already live with, and
// the remedy is the same: a test that calls both.
describe('how long a browser may keep an object', () => {
  it.each([
    ['a content-addressed upload', 'food/a1b2c3d4e5f6.webp'],
    ['a legacy human-named photograph', 'food/pizza1.webp'],
    ['a legacy name with a space', 'mocktails/signor bianca.webp'],
    ['an archived original', 'assets-source/hero/brick.jpg'],
    ['a menu pdf, whose key is stable across replacements', 'menus/food-menu.pdf'],
    ['a hash-shaped stem that is one character short', 'food/a1b2c3d4e5f.webp'],
    ['a hash-shaped stem with a non-hex character', 'food/a1b2c3d4e5fg.webp'],
  ])('agrees with scripts/migrate-images.mjs about %s', (_name, key) => {
    expect(cacheControlForKey(key)).toBe(cacheControlFor(key));
  });

  // The agreement above is worthless if both sides say the same thing for
  // everything, which is precisely what a mutation that deleted the regex
  // from BOTH files would produce. These pin the two answers themselves.
  it('lets a browser keep a content-addressed object for a year and never re-ask', () => {
    expect(cacheControlForKey('food/a1b2c3d4e5f6.webp')).toBe('public, max-age=31536000, immutable');
  });

  it('gives a re-uploadable name a day, so a correction is visible tomorrow at worst', () => {
    expect(cacheControlForKey('food/pizza1.webp')).toBe('public, max-age=86400');
  });
});
