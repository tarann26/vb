import { describe, expect, it } from 'vitest';
import {
  COLLAGE_NODE_KINDS,
  MAX_COLLAGE_DEPTH,
  MAX_COLLAGE_PHOTOS,
  MIN_SPLIT_CHILDREN,
  SIZE_SUM_TOLERANCE,
  SPLIT_DIRECTIONS,
  collageDepth,
  collageNodeIds,
  collagePhotos,
  countCollagePhotos,
  findCollagePhoto,
  isCollageNodeKind,
  isNormalizedSizes,
  isSplitDirection,
  normalizeCollageTree,
  normalizeSizes,
  setCollagePhotoSrc,
  swapCollagePhotos,
} from '../collage';
import { assertCollageTree } from '../guards';
import { collageTreeProblems } from '../validate';
import type { CollageNode, CollageSplit } from '../types';

// Every fixture here is built from these two helpers rather than written out
// as an object literal per test: a literal repeated fifteen times drifts, and
// a test whose fixture drifted from the shape it means to check is a test
// that stops checking it. `split` normalises by construction, so a test that
// wants UN-normalised sizes has to say so explicitly (and two below do).
function photo(id: string, src = `/hero/${id}.webp`, alt = ''): CollageNode {
  return { kind: 'photo', id, src, alt };
}

function split(id: string, direction: 'row' | 'column', children: CollageNode[], sizes?: number[]): CollageSplit {
  return {
    kind: 'split',
    id,
    direction,
    children,
    sizes: normalizeSizes(sizes ?? children.map(() => 1)),
  };
}

// A tree with a photo at every depth from 2 to 4, in a known document order,
// and one split whose children are deliberately unequal -- enough shape for
// ordering, depth and normalisation to all be non-trivially wrong.
function sampleTree(): CollageNode {
  return split('root', 'row', [
    photo('a'),
    split('mid', 'column', [photo('b'), split('inner', 'row', [photo('c'), photo('d')])]),
    photo('e'),
  ], [2, 1, 1]);
}

describe('collage: the closed unions are complete at runtime', () => {
  // The `Record<K, true>` idiom's whole point (see collage.ts, and
  // guards.ts's SECTION_ID_SET for where it comes from) is that a union that
  // grows without this file being touched fails to COMPILE. This pair is the
  // runtime half: it pins what the current union members actually are, so a
  // member silently disappearing is caught too.
  it('knows exactly the two split directions, and rejects anything else', () => {
    expect([...SPLIT_DIRECTIONS].sort()).toEqual(['column', 'row']);
    expect(isSplitDirection('row')).toBe(true);
    expect(isSplitDirection('column')).toBe(true);
    expect(isSplitDirection('vertical')).toBe(false);
    expect(isSplitDirection(undefined)).toBe(false);
  });

  it('knows exactly the two node kinds, and rejects anything else', () => {
    expect([...COLLAGE_NODE_KINDS].sort()).toEqual(['photo', 'split']);
    expect(isCollageNodeKind('photo')).toBe(true);
    expect(isCollageNodeKind('split')).toBe(true);
    expect(isCollageNodeKind('image')).toBe(false);
    expect(isCollageNodeKind(null)).toBe(false);
  });
});

describe('collage: sizes normalise to a known sum', () => {
  it('scales any set of proportions so they add up to the number of boxes', () => {
    expect(normalizeSizes([1, 1])).toEqual([1, 1]);
    expect(normalizeSizes([2, 4])).toEqual([0.666667, 1.333333]);
    expect(normalizeSizes([20, 40])).toEqual([0.666667, 1.333333]);
    expect(normalizeSizes([2, 1, 1])).toEqual([1.5, 0.75, 0.75]);
  });

  it('preserves the ratios it was given -- the only thing that renders', () => {
    const [small, large] = normalizeSizes([37, 63]);
    expect(large / small).toBeCloseTo(63 / 37, 5);
  });

  it('is idempotent, so a tree that round-trips through a file does not drift', () => {
    const once = normalizeSizes([2, 1, 1]);
    expect(normalizeSizes(once)).toEqual(once);
    const messy = normalizeSizes([0.3333333333, 0.6666666667, 1.7]);
    expect(normalizeSizes(messy)).toEqual(messy);
  });

  it('refuses input with no proportion to preserve rather than inventing one', () => {
    expect(() => normalizeSizes([])).toThrow(/empty/);
    expect(() => normalizeSizes([0, 0])).toThrow(/summing to 0/);
    expect(() => normalizeSizes([1, -1])).toThrow(/summing to 0/);
    expect(() => normalizeSizes([Number.NaN, 1])).toThrow(/summing to NaN/);
  });

  it('recognises a normalised array, and refuses one that is merely close', () => {
    expect(isNormalizedSizes([1, 1])).toBe(true);
    expect(isNormalizedSizes([0.666667, 1.333333])).toBe(true);
    expect(isNormalizedSizes([1, 2])).toBe(false);
    expect(isNormalizedSizes([0, 2])).toBe(false);
    expect(isNormalizedSizes([Number.POSITIVE_INFINITY, 1])).toBe(false);
    // Just outside the tolerance, in both directions -- so the bound itself
    // is pinned, not merely "some number near 2 passes".
    expect(isNormalizedSizes([1, 1 + SIZE_SUM_TOLERANCE * 2])).toBe(false);
    expect(isNormalizedSizes([1, 1 - SIZE_SUM_TOLERANCE * 2])).toBe(false);
  });

  it('normalises every level of a tree, not just the root', () => {
    const raw: CollageNode = {
      kind: 'split',
      id: 'root',
      direction: 'row',
      children: [photo('a'), { kind: 'split', id: 'mid', direction: 'column', children: [photo('b'), photo('c')], sizes: [3, 9] }],
      sizes: [4, 4],
    };
    const normalised = normalizeCollageTree(raw) as CollageSplit;
    expect(normalised.sizes).toEqual([1, 1]);
    expect((normalised.children[1] as CollageSplit).sizes).toEqual([0.5, 1.5]);
  });
});

describe('collage: walking the tree', () => {
  it('lists photos in document order, depth first', () => {
    expect(collagePhotos(sampleTree()).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(countCollagePhotos(sampleTree())).toBe(5);
  });

  it('lists every node id, splits included', () => {
    expect(collageNodeIds(sampleTree())).toEqual(['root', 'a', 'mid', 'b', 'inner', 'c', 'd', 'e']);
  });

  it('measures depth as one for a bare photo and one more per split level', () => {
    expect(collageDepth(photo('only'))).toBe(1);
    expect(collageDepth(split('s', 'row', [photo('a'), photo('b')]))).toBe(2);
    // The sample's deepest branch is root -> mid -> inner -> photo.
    expect(collageDepth(sampleTree())).toBe(4);
  });

  it('finds a photo by id, and nothing by a name no node carries', () => {
    expect(findCollagePhoto(sampleTree(), 'd')?.src).toBe('/hero/d.webp');
    expect(findCollagePhoto(sampleTree(), 'root')).toBeNull();
    expect(findCollagePhoto(sampleTree(), 'nope')).toBeNull();
  });

  it('rewrites exactly one photo and leaves untouched branches at their prior identity', () => {
    const before = sampleTree() as CollageSplit;
    const after = setCollagePhotoSrc(before, 'c', '/hero/new.webp') as CollageSplit;

    expect(findCollagePhoto(after, 'c')?.src).toBe('/hero/new.webp');
    expect(findCollagePhoto(after, 'd')?.src).toBe('/hero/d.webp');
    // `a` and `e` are on no path to `c`, so React must see the very same
    // objects and never re-render those boxes -- the "spread the touched
    // level only" contract every other write path in this codebase keeps.
    expect(after.children[0]).toBe(before.children[0]);
    expect(after.children[2]).toBe(before.children[2]);
    // ...and the branch that DID change is a new object, not a mutation of
    // the old one.
    expect(after.children[1]).not.toBe(before.children[1]);
    expect(findCollagePhoto(before, 'c')?.src).toBe('/hero/c.webp');
  });

  it('returns the identical tree, by reference, when no photo matches', () => {
    const before = sampleTree();
    expect(setCollagePhotoSrc(before, 'nobody', '/hero/x.webp')).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Task 4's operation. The owner's own description of it is the specification:
// "The boxes keep their shape. The photos are the ones -- it's like the photo
// fills the box it travels to."

// Everything about a tree EXCEPT which photo sits where. If a swap changes any
// of this, it moved a box, and the whole point of the gesture is that it does
// not.
function skeleton(node: CollageNode): unknown {
  if (node.kind === 'photo') return 'photo';
  return {
    id: node.id,
    direction: node.direction,
    sizes: node.sizes,
    children: node.children.map(skeleton),
  };
}

describe('collage: swapping two photos', () => {
  it('exchanges two cousins and changes no box, no size and no split', () => {
    const before = sampleTree();
    const after = swapCollagePhotos(before, 'a', 'd');

    // Document order is where each photo SITS, so the two named photos have
    // traded places and nothing else has.
    expect(collagePhotos(before).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(collagePhotos(after).map((p) => p.id)).toEqual(['d', 'b', 'c', 'a', 'e']);
    expect(skeleton(after)).toEqual(skeleton(before));
  });

  it('exchanges two siblings of the same split', () => {
    const after = swapCollagePhotos(sampleTree(), 'c', 'd');
    expect(collagePhotos(after).map((p) => p.id)).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(skeleton(after)).toEqual(skeleton(sampleTree()));
  });

  it('carries each photo’s whole payload with it -- id, src and alt together', () => {
    const before = split('root', 'row', [
      { kind: 'photo', id: 'left', src: '/hero/left.webp', alt: 'the left one' },
      { kind: 'photo', id: 'right', src: '/hero/right.webp', alt: 'the right one' },
    ]);
    const after = swapCollagePhotos(before, 'left', 'right') as CollageSplit;
    expect(after.children[0]).toEqual({ kind: 'photo', id: 'right', src: '/hero/right.webp', alt: 'the right one' });
    expect(after.children[1]).toEqual({ kind: 'photo', id: 'left', src: '/hero/left.webp', alt: 'the left one' });
  });

  it('keeps every node id in the tree, so nothing is renamed by moving', () => {
    const before = sampleTree();
    const after = swapCollagePhotos(before, 'a', 'd');
    expect([...collageNodeIds(after)].sort()).toEqual([...collageNodeIds(before)].sort());
  });

  it('leaves branches containing neither photo at their prior object identity', () => {
    const before = sampleTree() as CollageSplit;
    const after = swapCollagePhotos(before, 'c', 'd') as CollageSplit;
    // `a` and `e` are on no path to either photo, so React must see the very
    // same objects and never re-render those boxes.
    expect(after.children[0]).toBe(before.children[0]);
    expect(after.children[2]).toBe(before.children[2]);
    expect(after.children[1]).not.toBe(before.children[1]);
    // ...and the input is untouched: this is a rebuild, never a mutation.
    expect(collagePhotos(before).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('is a no-op, by reference, for the same photo twice or for a name no photo carries', () => {
    const before = sampleTree();
    expect(swapCollagePhotos(before, 'c', 'c')).toBe(before);
    expect(swapCollagePhotos(before, 'c', 'nobody')).toBe(before);
    expect(swapCollagePhotos(before, 'nobody', 'c')).toBe(before);
    // A SPLIT's id is not a photo's, so naming one swaps nothing.
    expect(swapCollagePhotos(before, 'a', 'mid')).toBe(before);
  });

  it('is its own inverse -- swapping the same pair back restores the tree exactly', () => {
    const before = sampleTree();
    const there = swapCollagePhotos(before, 'a', 'd');
    const back = swapCollagePhotos(there, 'a', 'd');
    expect(back).toEqual(before);
  });

  it('still validates at both ends -- a swapped tree is a legal tree', () => {
    const swapped = swapCollagePhotos(sampleTree(), 'a', 'd');
    expect(collageTreeProblems(swapped)).toEqual([]);
    expect(() => assertCollageTree(swapped)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The two ends: `assertCollageTree` fails the BUILD (it narrows the raw JSON
// import in src/content/index.ts), `collageTreeProblems` refuses the WRITE
// with a message written for the owner. Both are checked against the same
// list of malformed trees, in the same order, so the two ends cannot quietly
// disagree about what a valid tree is -- the exact divergence this repo has
// already been bitten by once (validate.ts's own header comment).

const MALFORMED: { name: string; tree: unknown; guard: RegExp; problem: RegExp }[] = [
  {
    name: 'a split with only one child',
    tree: { kind: 'split', id: 'root', direction: 'row', children: [photo('a')], sizes: [1] },
    guard: /at least 2 children/,
    problem: /at least 2 boxes/,
  },
  {
    name: 'a split with more sizes than children',
    tree: { kind: 'split', id: 'root', direction: 'row', children: [photo('a'), photo('b')], sizes: [1, 0.5, 0.5] },
    guard: /one size per child/,
    problem: /different number of sizes than boxes/,
  },
  {
    name: 'a split with fewer sizes than children',
    tree: { kind: 'split', id: 'root', direction: 'row', children: [photo('a'), photo('b')], sizes: [2] },
    guard: /one size per child/,
    problem: /different number of sizes than boxes/,
  },
  {
    name: 'a zero size',
    tree: { kind: 'split', id: 'root', direction: 'row', children: [photo('a'), photo('b')], sizes: [0, 2] },
    guard: /must be a positive number/,
    problem: /size greater than zero/,
  },
  {
    name: 'a negative size',
    tree: { kind: 'split', id: 'root', direction: 'row', children: [photo('a'), photo('b')], sizes: [-1, 3] },
    guard: /must be a positive number/,
    problem: /size greater than zero/,
  },
  {
    name: 'a non-finite size',
    tree: {
      kind: 'split',
      id: 'root',
      direction: 'row',
      children: [photo('a'), photo('b')],
      sizes: [Number.POSITIVE_INFINITY, 1],
    },
    guard: /must be a positive number/,
    problem: /size greater than zero/,
  },
  {
    name: 'sizes that do not add up to the number of boxes',
    tree: { kind: 'split', id: 'root', direction: 'row', children: [photo('a'), photo('b')], sizes: [1, 2] },
    guard: /must add up to 2/,
    problem: /must add up to 2/,
  },
  {
    name: 'a photo with a blank src',
    tree: split('root', 'row', [photo('a', '   '), photo('b')]),
    guard: /needs an image source/,
    problem: /collage photo 1 needs an image/,
  },
  {
    name: 'a photo with no alt field at all',
    tree: { kind: 'split', id: 'root', direction: 'row', children: [{ kind: 'photo', id: 'a', src: '/hero/a.webp' }, photo('b')], sizes: [1, 1] },
    guard: /needs alt text/,
    problem: /needs alt text/,
  },
  {
    name: 'a node with an unknown kind',
    tree: { kind: 'split', id: 'root', direction: 'row', children: [{ kind: 'image', id: 'a', src: '/a.webp' }, photo('b')], sizes: [1, 1] },
    guard: /unknown kind "image"/,
    problem: /neither a photo nor a split/,
  },
  {
    name: 'a split with an unknown direction',
    tree: { kind: 'split', id: 'root', direction: 'across', children: [photo('a'), photo('b')], sizes: [1, 1] },
    guard: /unknown direction "across"/,
    problem: /either across or down/,
  },
  {
    name: 'a node with no id',
    tree: { kind: 'split', id: '  ', direction: 'row', children: [photo('a'), photo('b')], sizes: [1, 1] },
    guard: /needs an id/,
    problem: /needs its own name/,
  },
  {
    name: 'two nodes sharing an id',
    tree: split('root', 'row', [photo('twin'), split('mid', 'column', [photo('twin'), photo('c')])]),
    guard: /two nodes with the id "twin"/,
    problem: /share the name "twin"/,
  },
];

// A comb of nested two-child splits, `photos` photos deep -- the shape that
// repeatedly dividing the box you just created produces, and the only way to
// reach the depth ceiling with a legal number of photos.
function comb(depth: number): CollageNode {
  let node: CollageNode = photo('leaf-0');
  for (let i = 1; i < depth; i++) {
    node = split(`s-${i}`, i % 2 === 0 ? 'row' : 'column', [photo(`leaf-${i}`), node]);
  }
  return node;
}

describe('assertCollageTree: the build-time guard', () => {
  it('accepts a bare photo -- the smallest legal collage', () => {
    expect(assertCollageTree(photo('only'))).toEqual({ kind: 'photo', id: 'only', src: '/hero/only.webp', alt: '' });
  });

  it('accepts a real nested tree and returns it narrowed, not the raw input', () => {
    const tree = assertCollageTree(sampleTree()) as CollageSplit;
    expect(tree.kind).toBe('split');
    expect(collagePhotos(tree).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it.each(MALFORMED)('refuses $name', ({ tree, guard }) => {
    expect(() => assertCollageTree(tree)).toThrow(guard);
  });

  it('refuses a tree deeper than the limit, and accepts one exactly at it', () => {
    expect(collageDepth(comb(MAX_COLLAGE_DEPTH))).toBe(MAX_COLLAGE_DEPTH);
    expect(() => assertCollageTree(comb(MAX_COLLAGE_DEPTH))).not.toThrow();
    expect(() => assertCollageTree(comb(MAX_COLLAGE_DEPTH + 1))).toThrow(/levels deep/);
  });

  it('refuses more photos than the cap, and accepts exactly the cap', () => {
    const atCap = split('root', 'row', Array.from({ length: MAX_COLLAGE_PHOTOS }, (_, i) => photo(`p${i}`)));
    const overCap = split('root', 'row', Array.from({ length: MAX_COLLAGE_PHOTOS + 1 }, (_, i) => photo(`p${i}`)));
    expect(() => assertCollageTree(atCap)).not.toThrow();
    expect(() => assertCollageTree(overCap)).toThrow(new RegExp(`has ${MAX_COLLAGE_PHOTOS + 1} photos`));
  });

  it('refuses something that is not an object at all', () => {
    expect(() => assertCollageTree(null)).toThrow(/is not an object/);
    expect(() => assertCollageTree([photo('a')])).toThrow(/is not an object/);
    expect(() => assertCollageTree('photo')).toThrow(/is not an object/);
  });

  it('names WHERE in the tree the problem is, not just that there is one', () => {
    const tree = split('root', 'row', [photo('a'), split('mid', 'column', [photo('b'), photo('c', '')])]);
    expect(() => assertCollageTree(tree)).toThrow(/root\.children\[1\]\.children\[1\]/);
  });

  it('is the same rule at both ends -- every tree the guard refuses, the write boundary refuses too', () => {
    MALFORMED.forEach(({ name, tree, problem }) => {
      const problems = collageTreeProblems(tree);
      expect(problems.length, `${name}: expected at least one problem`).toBeGreaterThan(0);
      expect(problems.map((p) => p.message).join(' | '), name).toMatch(problem);
    });
  });
});

describe('collageTreeProblems: the write boundary', () => {
  it('reports nothing at all for a real tree', () => {
    expect(collageTreeProblems(sampleTree())).toEqual([]);
    expect(collageTreeProblems(photo('only'))).toEqual([]);
  });

  it('addresses a bad photo by its position in document order, so the dashboard can put it on the right row', () => {
    // `c` is the third photo in document order (a, b, c, d, e).
    const tree = split('root', 'row', [
      photo('a'),
      split('mid', 'column', [photo('b'), split('inner', 'row', [photo('c', ''), photo('d')])]),
      photo('e'),
    ]);
    expect(collageTreeProblems(tree)).toEqual([
      { field: 'heroCollage[2].src', message: 'collage photo 3 needs an image' },
    ]);
  });

  it('refuses more photos than the cap, naming the number she actually has', () => {
    const overCap = split('root', 'row', Array.from({ length: MAX_COLLAGE_PHOTOS + 1 }, (_, i) => photo(`p${i}`)));
    expect(collageTreeProblems(overCap)).toEqual([
      {
        field: 'heroCollage',
        message: `the collage has ${MAX_COLLAGE_PHOTOS + 1} photos — ${MAX_COLLAGE_PHOTOS} is the most it can hold`,
      },
    ]);
  });

  it('refuses a tree deeper than the limit', () => {
    expect(collageTreeProblems(comb(MAX_COLLAGE_DEPTH))).toEqual([]);
    expect(collageTreeProblems(comb(MAX_COLLAGE_DEPTH + 1)).map((p) => p.message)).toEqual([
      `this collage is divided more than ${MAX_COLLAGE_DEPTH} levels deep — some boxes are too small to see`,
    ]);
  });

  it('never throws, whatever it is handed -- every caller of validateContent is an HTTP handler', () => {
    [null, undefined, 42, 'tree', [], {}, { kind: 'split' }].forEach((bad) => {
      expect(() => collageTreeProblems(bad)).not.toThrow();
      expect(collageTreeProblems(bad).length).toBeGreaterThan(0);
    });
  });

  // MIN_SPLIT_CHILDREN is referenced by both ends' messages; this pins that
  // the constant and the sentence she reads cannot drift apart.
  it('quotes the real minimum in the message, rather than a hardcoded two', () => {
    const oneChild = { kind: 'split', id: 'root', direction: 'row', children: [photo('a')], sizes: [1] };
    expect(collageTreeProblems(oneChild)[0].message).toContain(`at least ${MIN_SPLIT_CHILDREN} boxes`);
  });
});
