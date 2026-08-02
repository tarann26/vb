import { describe, it, expect } from 'vitest';
import { outputPathFor } from '../images.mjs';

describe('outputPathFor', () => {
  it('maps a source image to a webp at the same relative path', () => {
    expect(outputPathFor('assets-source/food/pizza1.JPG')).toBe('public/food/pizza1.webp');
  });

  it('preserves capitalisation and spaces in the basename', () => {
    expect(outputPathFor('assets-source/food/Aglio e Pepperoncini.jpg')).toBe(
      'public/food/Aglio e Pepperoncini.webp',
    );
  });

  it('preserves the subdirectory', () => {
    expect(outputPathFor('assets-source/our_story/cut.JPG')).toBe('public/our_story/cut.webp');
  });
});
