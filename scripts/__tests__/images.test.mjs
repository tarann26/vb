import { describe, it, expect } from 'vitest';
import { outputPathFor, findCollisions } from '../images.mjs';

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

describe('findCollisions', () => {
  it('reports no collisions when every source maps to a distinct output', () => {
    const sources = ['assets-source/food/pizza1.JPG', 'assets-source/food/pizza2.JPG'];
    expect(findCollisions(sources)).toEqual([]);
  });

  it('reports a collision when two sources differ only by extension', () => {
    const sources = ['assets-source/food/margarita.jpg', 'assets-source/food/margarita.png'];
    expect(findCollisions(sources)).toEqual([
      {
        output: 'public/food/margarita.webp',
        sources: ['assets-source/food/margarita.jpg', 'assets-source/food/margarita.png'],
      },
    ]);
  });

  it('reports every colliding group, not just the first', () => {
    const sources = [
      'assets-source/food/margarita.jpg',
      'assets-source/food/margarita.png',
      'assets-source/hero/scene.jpg',
      'assets-source/hero/scene.JPG',
      'assets-source/food/pizza1.JPG',
    ];
    const collisions = findCollisions(sources);
    expect(collisions).toHaveLength(2);
    expect(collisions.map((c) => c.output).sort()).toEqual([
      'public/food/margarita.webp',
      'public/hero/scene.webp',
    ]);
  });

  it('does not flag three-or-more-way collisions as merely pairs', () => {
    const sources = [
      'assets-source/food/margarita.jpg',
      'assets-source/food/margarita.jpeg',
      'assets-source/food/margarita.png',
    ];
    const collisions = findCollisions(sources);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].sources).toHaveLength(3);
  });
});
