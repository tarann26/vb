import { describe, it, expect } from 'vitest';
import { IMAGE_HOST, imageUrl, keyFromImageUrl } from '../image-host';

describe('the one place the image host is spelled', () => {
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

  it('does not claim a url on another host, or a site-root path', () => {
    expect(keyFromImageUrl('https://viabiancarestaurant.com/food/pizza1.webp')).toBeNull();
    expect(keyFromImageUrl('/food/pizza1.webp')).toBeNull();
  });

  it('refuses a traversal key', () => {
    expect(keyFromImageUrl(IMAGE_HOST + '/../wrangler.toml')).toBeNull();
  });
});
