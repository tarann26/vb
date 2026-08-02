import { describe, it, expect } from 'vitest';
// Imported from paths.mjs, not images.mjs: this file runs inside
// `npm run test:deploy`, part of the Cloudflare Pages build command
// documented in docs/cloudflare-cutover.md, and images.mjs loads sharp's
// native binding at module scope. Nothing below encodes anything, so
// nothing below should be able to fail on a machine where sharp will not
// install or load.
import {
  outputPathFor,
  findCollisions,
  maxWidthFor,
  DEFAULT_MAX_WIDTH,
} from '../paths.mjs';

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

describe('maxWidthFor', () => {
  it('falls back to the default width for a directory with no override', () => {
    expect(maxWidthFor('assets-source/food/pizza1.JPG')).toBe(DEFAULT_MAX_WIDTH);
    expect(DEFAULT_MAX_WIDTH).toBe(1000);
  });

  // our_story's carousel paints at roughly 600 CSS px, so shrinking it the
  // way hero/ was shrunk would visibly soften it. Pinned here so a later
  // "let's cap everything" edit has to argue with a test first.
  it('leaves our_story at the default width', () => {
    expect(maxWidthFor('assets-source/our_story/cut.JPG')).toBe(DEFAULT_MAX_WIDTH);
  });

  it('caps hero collage tiles at their displayed width', () => {
    expect(maxWidthFor('assets-source/hero/scene.png')).toBe(500);
    expect(maxWidthFor('assets-source/hero/farfalle1.png')).toBe(500);
  });

  it('caps the brick backdrop below the rest of hero/', () => {
    expect(maxWidthFor('assets-source/hero/brick.jpg')).toBe(400);
  });

  // The per-file override is keyed by output path, so it must hold whatever
  // extension the source arrives with.
  it('applies the per-file override regardless of source extension', () => {
    expect(maxWidthFor('assets-source/hero/brick.PNG')).toBe(400);
  });

  it('does not apply a directory override to a same-named nested directory', () => {
    expect(maxWidthFor('assets-source/food/hero/plate.jpg')).toBe(DEFAULT_MAX_WIDTH);
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
