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
  MIN_COLLAGE_PHOTOS,
  MIN_PAIR_SHARE,
  RESIZE_STEP_SHARE,
  addCollagePhoto,
  canonicalizeCollageTree,
  collageAddRefusal,
  collageNodeLevel,
  collageRemoveRefusal,
  nextCollageId,
  removeCollagePhoto,
  collagePairShare,
  collageResizeTarget,
  findCollageParent,
  findCollageSplit,
  isNormalizedSizes,
  isSplitDirection,
  resizeCollageSplit,
  normalizeCollageTree,
  normalizeSizes,
  setCollagePhotoSrc,
  swapCollagePhotos,
} from '../collage';
import { assertCollageTree } from '../guards';
import { collageTreeProblems } from '../validate';
import { galleries } from '../index';
import type { CollageNode, CollagePhoto, CollageSplit } from '../types';

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

  // Review finding (Minor), and a contract violation rather than a live
  // defect: rounding to SIZE_PRECISION turns any value that scales below 5e-7
  // into exactly 0, so this function could return an array its OWN
  // `isNormalizedSizes` refuses and that both validators reject -- the
  // "something plausible" the throw above exists to rule out. Latent today
  // only because MIN_PAIR_SHARE is 0.15, a constant in a different function
  // whose own comment already flags it as "the number to revisit"; a 4000-op
  // targeted squeeze bottomed out at 2.6e-4, ~500x above the threshold.
  // Refused here so lowering that constant can never quietly write a
  // zero-width box into content instead.
  it('refuses a value too small to survive its own rounding, rather than returning a zero', () => {
    expect(() => normalizeSizes([1e-9, 1])).toThrow(/too small/);
    // ...and the output of a legal call is always something the predicate
    // that guards content accepts, which is the property the throw protects.
    expect(isNormalizedSizes(normalizeSizes([1e-6, 1]))).toBe(true);
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

  // Gate review finding (Minor): the cap used to be reported only when
  // NOTHING else was wrong, so a 25-photo collage that also had one bad `alt`
  // told her about the alt, took the fix, and only then mentioned the cap --
  // two round trips to be told two things. The guard also made the two ends
  // disagree: `assertCollageTree` has never had it.
  it('reports the cap even when something else is wrong too', () => {
    const overCap: CollageNode = {
      kind: 'split',
      id: 'root',
      direction: 'row',
      sizes: Array.from({ length: MAX_COLLAGE_PHOTOS + 1 }, () => 1),
      children: Array.from({ length: MAX_COLLAGE_PHOTOS + 1 }, (_, i) =>
        i === 3 ? ({ kind: 'photo', id: 'p3', src: '/hero/p3.webp', alt: 7 } as unknown as CollageNode) : photo(`p${i}`),
      ),
    };
    const messages = collageTreeProblems(overCap).map((p) => p.message);
    expect(messages).toContain('collage photo 4 needs alt text, or an empty one');
    expect(messages).toContain(`the collage has ${MAX_COLLAGE_PHOTOS + 1} photos — ${MAX_COLLAGE_PHOTOS} is the most it can hold`);
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

// ---------------------------------------------------------------------------
// Task 5's operation. The owner's requirement is a conservation law: making
// one box bigger takes the space from the box beside it, and from that box
// only.

describe('collage: finding a split and a node’s parent', () => {
  it('finds a split by id, and never a photo', () => {
    expect(findCollageSplit(sampleTree(), 'inner')?.direction).toBe('row');
    expect(findCollageSplit(sampleTree(), 'a')).toBeNull();
    expect(findCollageSplit(sampleTree(), 'nobody')).toBeNull();
  });

  it('reports which child of which split a node is', () => {
    expect(findCollageParent(sampleTree(), 'e')).toMatchObject({ index: 2 });
    expect(findCollageParent(sampleTree(), 'e')?.split.id).toBe('root');
    expect(findCollageParent(sampleTree(), 'd')?.split.id).toBe('inner');
    expect(findCollageParent(sampleTree(), 'd')?.index).toBe(1);
  });

  it('reports no parent for the root, which is what a one-photo collage is', () => {
    expect(findCollageParent(sampleTree(), 'root')).toBeNull();
    expect(findCollageParent(photo('only'), 'only')).toBeNull();
  });
});

describe('collage: moving one divider', () => {
  // Three children, so "every OTHER child is untouched" is a real assertion
  // and not vacuous the way it would be on a pair.
  function band(): CollageSplit {
    return split('band', 'row', [photo('x'), photo('y'), photo('z')]);
  }

  it('gives the first of the pair the share it is asked for, and the rest to the second', () => {
    const after = resizeCollageSplit(band(), 'band', 0, 0.75) as CollageSplit;
    // The pair shared 2 of the 3 units between them; 0.75 of that is 1.5.
    expect(after.sizes).toEqual([1.5, 0.5, 1]);
  });

  it('conserves the pair’s total, so one box widening IS the other narrowing', () => {
    const before = band();
    [0.2, 0.35, 0.5, 0.64, 0.8].forEach((share) => {
      const after = resizeCollageSplit(before, 'band', 0, share) as CollageSplit;
      const pairBefore = before.sizes[0] + before.sizes[1];
      const pairAfter = after.sizes[0] + after.sizes[1];
      expect(pairAfter).toBeCloseTo(pairBefore, 5);
    });
  });

  it('leaves every other child of that split exactly as it was', () => {
    const after = resizeCollageSplit(band(), 'band', 0, 0.8) as CollageSplit;
    expect(after.sizes[2]).toBe(band().sizes[2]);
    const other = resizeCollageSplit(band(), 'band', 1, 0.8) as CollageSplit;
    expect(other.sizes[0]).toBe(band().sizes[0]);
  });

  it('stops at the floor instead of undoing the drag, at both ends', () => {
    const tiny = resizeCollageSplit(band(), 'band', 0, -5) as CollageSplit;
    expect(collagePairShare(tiny, 0)).toBeCloseTo(MIN_PAIR_SHARE, 5);
    const huge = resizeCollageSplit(band(), 'band', 0, 5) as CollageSplit;
    expect(collagePairShare(huge, 0)).toBeCloseTo(1 - MIN_PAIR_SHARE, 5);
    // ...and neither end ever produces a size at or below zero, which is what
    // validateContent refuses.
    expect(Math.min(...tiny.sizes, ...huge.sizes)).toBeGreaterThan(0);
  });

  it('leaves the tree valid at both ends -- normalised, and accepted by the guard', () => {
    const after = resizeCollageSplit(sampleTree(), 'inner', 0, 0.7);
    expect(collageTreeProblems(after)).toEqual([]);
    expect(() => assertCollageTree(after)).not.toThrow();
    expect(isNormalizedSizes((findCollageSplit(after, 'inner') as CollageSplit).sizes)).toBe(true);
  });

  it('rounds what it writes, so a drag does not put float noise into the file', () => {
    const after = resizeCollageSplit(band(), 'band', 0, 1 / 3) as CollageSplit;
    after.sizes.forEach((size) => expect(String(size).replace(/^\d+\.?/, '').length).toBeLessThanOrEqual(6));
  });

  it('rebuilds only the path to the split it touched', () => {
    const before = sampleTree() as CollageSplit;
    const after = resizeCollageSplit(before, 'inner', 0, 0.7) as CollageSplit;
    expect(after.children[0]).toBe(before.children[0]);
    expect(after.children[2]).toBe(before.children[2]);
    expect(after.children[1]).not.toBe(before.children[1]);
    // The input is never mutated: `inner` in the ORIGINAL tree still has the
    // sizes it was built with.
    expect((findCollageSplit(before, 'inner') as CollageSplit).sizes).toEqual([1, 1]);
    expect((findCollageSplit(after, 'inner') as CollageSplit).sizes).toEqual([1.4, 0.6]);
  });

  // The assertion above only reaches LEAVES off the path, and a leaf comes
  // back by reference even from a rebuild-everything implementation. This one
  // reaches a whole SPLIT off the path, which is what actually decides whether
  // React re-renders half the collage on every frame of a drag.
  it('leaves a sibling SUBTREE at its prior identity, not just the photos in it', () => {
    const before = split('root', 'row', [
      split('L', 'column', [photo('a'), photo('b')]),
      split('R', 'column', [photo('c'), photo('d')]),
    ]);
    const after = resizeCollageSplit(before, 'L', 0, 0.7) as CollageSplit;
    expect(after.children[1]).toBe(before.children[1]);
    expect(after.children[0]).not.toBe(before.children[0]);
  });

  it('is a no-op, by reference, for anything that is not a divider', () => {
    const before = band();
    expect(resizeCollageSplit(before, 'nobody', 0, 0.7)).toBe(before);
    // A photo's id is not a split's.
    expect(resizeCollageSplit(before, 'x', 0, 0.7)).toBe(before);
    // The last child has no gap after it.
    expect(resizeCollageSplit(before, 'band', 2, 0.7)).toBe(before);
    expect(resizeCollageSplit(before, 'band', -1, 0.7)).toBe(before);
    expect(resizeCollageSplit(before, 'band', 0.5, 0.7)).toBe(before);
    expect(resizeCollageSplit(before, 'band', 0, Number.NaN)).toBe(before);
    // ...and a drag that has not actually moved the divider yet.
    expect(resizeCollageSplit(before, 'band', 0, 0.5)).toBe(before);
  });

  it('reports how much of a pair the first of the two holds', () => {
    expect(collagePairShare(band(), 0)).toBeCloseTo(0.5, 6);
    const uneven = split('band', 'row', [photo('x'), photo('y')], [3, 1]);
    expect(collagePairShare(uneven, 0)).toBeCloseTo(0.75, 6);
  });
});

describe('collage: which divider a box’s own buttons move', () => {
  function band(): CollageSplit {
    return split('band', 'row', [photo('x'), photo('y'), photo('z')]);
  }

  it('uses the gap AFTER a box that has one, and says the box is the first of the pair', () => {
    expect(collageResizeTarget(band(), 'x')).toMatchObject({ gapIndex: 0, first: true });
    expect(collageResizeTarget(band(), 'y')).toMatchObject({ gapIndex: 1, first: true });
  });

  it('uses the gap BEFORE the last box, where it is the second of the pair', () => {
    expect(collageResizeTarget(band(), 'z')).toMatchObject({ gapIndex: 1, first: false });
  });

  it('has no answer for a box that is the whole collage', () => {
    expect(collageResizeTarget(photo('only'), 'only')).toBeNull();
  });

  // The two constants the UI quotes at her: seven taps from an even split to
  // the floor. Pinned so a change to either without the other is caught.
  it('takes seven steps to travel from an even split to the floor', () => {
    expect(Math.ceil((0.5 - MIN_PAIR_SHARE) / RESIZE_STEP_SHARE)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Task 6's operations, and the invariant they exist to keep.

// The tree's STRUCTURE with the sizes left out -- what add-then-remove must
// restore. `skeleton` above keeps the sizes too, which is right for a swap
// (nothing at all may change) and wrong here (see the note below on why
// removing redistributes proportionally rather than exactly undoing an add).
function shape(node: CollageNode): unknown {
  if (node.kind === 'photo') return 'photo';
  return { id: node.id, direction: node.direction, children: node.children.map(shape) };
}

function newPhoto(id: string): CollagePhoto {
  return { kind: 'photo', id, src: `/hero/${id}.webp`, alt: '' };
}

// "This tree is canonical" is expressible because canonicalising is the
// IDENTITY on one that already is -- by reference, not by value. Every
// assertion below leans on that rather than on a separate checker that could
// itself be wrong.
function isCanonical(node: CollageNode): boolean {
  return canonicalizeCollageTree(node) === node;
}

describe('collage: canonical form', () => {
  it('is the identity, by reference, on a tree that is already canonical', () => {
    const before = sampleTree();
    expect(canonicalizeCollageTree(before)).toBe(before);
    const alone = photo('only');
    expect(canonicalizeCollageTree(alone)).toBe(alone);
  });

  it('the committed arrangement is already canonical -- nothing today violates this', () => {
    const tree = galleries.heroCollage;
    expect(tree).not.toBeNull();
    expect(isCanonical(tree as CollageNode)).toBe(true);
  });

  it('splices a same-direction child into its parent, keeping the boxes’ proportions', () => {
    // A row holding [x, a row of (y, z)] is three boxes side by side, and the
    // line between y and z belongs to the wrong split until this runs.
    const nested: CollageNode = {
      kind: 'split',
      id: 'outer',
      direction: 'row',
      sizes: [1, 1],
      children: [photo('x'), { kind: 'split', id: 'inner', direction: 'row', sizes: [1, 1], children: [photo('y'), photo('z')] }],
    };
    const flat = canonicalizeCollageTree(nested) as CollageSplit;
    expect(flat.children.map((child) => child.id)).toEqual(['x', 'y', 'z']);
    // x held half the row; y and z held a quarter each. Normalised to sum to
    // three, that is [1.5, 0.75, 0.75].
    expect(flat.sizes).toEqual([1.5, 0.75, 0.75]);
    expect(isNormalizedSizes(flat.sizes)).toBe(true);
  });

  it('leaves a child split of the OTHER direction exactly where it is', () => {
    const before = split('outer', 'row', [photo('x'), split('inner', 'column', [photo('y'), photo('z')])]);
    expect(canonicalizeCollageTree(before)).toBe(before);
  });

  it('folds a split that is left holding one child into that child', () => {
    const lonely: CollageNode = {
      kind: 'split',
      id: 'outer',
      direction: 'row',
      sizes: [1, 1],
      children: [photo('x'), { kind: 'split', id: 'inner', direction: 'column', sizes: [1], children: [photo('y')] }],
    };
    const folded = canonicalizeCollageTree(lonely) as CollageSplit;
    expect(folded.children.map((child) => child.id)).toEqual(['x', 'y']);
  });

  it('folds through more than one level in a single pass', () => {
    // column( row( column( a, b ) ) ) -- the outer column holds one child,
    // which folds; what is left is a row holding one child, which folds too.
    const stack: CollageNode = {
      kind: 'split',
      id: 'l1',
      direction: 'column',
      sizes: [1],
      children: [
        { kind: 'split', id: 'l2', direction: 'row', sizes: [1], children: [split('l3', 'column', [photo('a'), photo('b')])] },
      ],
    };
    const folded = canonicalizeCollageTree(stack) as CollageSplit;
    // The OUTER node survives and the content is spliced into it -- l2 folds
    // into l1 because it holds one child, and l3 then shares l1's direction,
    // so its two photos become l1's own.
    expect(folded.id).toBe('l1');
    expect(folded.direction).toBe('column');
    expect(folded.children.map((child) => child.id)).toEqual(['a', 'b']);
    expect(collageDepth(folded)).toBe(2);
  });
});

describe('collage: minting an id', () => {
  it('takes the first number no node already carries, for that prefix', () => {
    expect(nextCollageId(sampleTree(), 'photo')).toBe('photo-1');
    expect(nextCollageId(split('root', 'row', [photo('photo-1'), photo('photo-3')]), 'photo')).toBe('photo-2');
    expect(nextCollageId(galleries.heroCollage as CollageNode, 'photo')).toBe('photo-17');
  });
});

describe('collage: adding a photo', () => {
  it('divides exactly one box, and leaves every other proportion alone', () => {
    const before = split('root', 'row', [photo('a'), photo('b'), photo('c')], [2, 1, 1]);
    const after = addCollagePhoto(before, 'a', 'column', newPhoto('n')) as CollageSplit;

    // a's box became a stack of a and n...
    const divided = after.children[0] as CollageSplit;
    expect(divided.direction).toBe('column');
    expect(divided.children.map((child) => child.id)).toEqual(['a', 'n']);
    // ...and that box is still exactly the share of the row it always was,
    // while b and c have not moved.
    expect(after.sizes).toEqual(before.sizes);
  });

  it('adds a SIBLING, not a level, when the box is divided the way its parent already runs', () => {
    const before = split('root', 'row', [photo('a'), photo('b')]);
    const after = addCollagePhoto(before, 'a', 'row', newPhoto('n')) as CollageSplit;
    expect(after.children.map((child) => child.id)).toEqual(['a', 'n', 'b']);
    // a and n split what a used to hold; b keeps its half of the row.
    expect(after.sizes).toEqual([0.75, 0.75, 1.5]);
    expect(collageDepth(after)).toBe(collageDepth(before));
  });

  it('adds a level when the box is divided across its parent’s direction', () => {
    const before = split('root', 'row', [photo('a'), photo('b')]);
    const after = addCollagePhoto(before, 'a', 'column', newPhoto('n'));
    expect(collageDepth(after)).toBe(collageDepth(before) + 1);
  });

  it('leaves the tree canonical, normalised and valid at both ends', () => {
    const after = addCollagePhoto(sampleTree(), 'c', 'column', newPhoto('n'));
    expect(isCanonical(after)).toBe(true);
    expect(collageTreeProblems(after)).toEqual([]);
    expect(() => assertCollageTree(after)).not.toThrow();
  });

  it('refuses, by reference, at the photo cap', () => {
    const atCap = split('root', 'row', Array.from({ length: MAX_COLLAGE_PHOTOS }, (_, i) => photo(`p${i}`)));
    expect(collageAddRefusal(atCap, 'p0', 'column')).toBe('cap');
    expect(addCollagePhoto(atCap, 'p0', 'column', newPhoto('n'))).toBe(atCap);
  });

  it('refuses at the depth ceiling -- and only in the direction that would deepen it', () => {
    // A comb exactly at the limit. Its deepest leaf cannot be divided ACROSS
    // its parent's direction, because that adds a level; dividing it ALONG
    // that direction adds a sibling instead, and is still allowed.
    const full = comb(MAX_COLLAGE_DEPTH);
    expect(collageDepth(full)).toBe(MAX_COLLAGE_DEPTH);
    const parent = findCollageParent(full, 'leaf-0');
    expect(parent).not.toBeNull();
    const along = (parent as { split: CollageSplit }).split.direction;
    const across = along === 'row' ? 'column' : 'row';
    expect(collageAddRefusal(full, 'leaf-0', across)).toBe('depth');
    expect(collageAddRefusal(full, 'leaf-0', along)).toBeNull();
    expect(addCollagePhoto(full, 'leaf-0', across, newPhoto('n'))).toBe(full);
    expect(addCollagePhoto(full, 'leaf-0', along, newPhoto('n'))).not.toBe(full);
  });

  it('refuses a target no photo carries, and an id some node already carries', () => {
    const before = sampleTree();
    expect(collageAddRefusal(before, 'nobody', 'row')).toBe('unknown');
    expect(addCollagePhoto(before, 'nobody', 'row', newPhoto('n'))).toBe(before);
    // 'mid' is a SPLIT's id, not a photo's -- adding "into" it is not a thing.
    expect(addCollagePhoto(before, 'mid', 'row', newPhoto('n'))).toBe(before);
    // ...and an id collision would build a tree the guard refuses at build
    // time, so it never gets built.
    expect(addCollagePhoto(before, 'a', 'row', newPhoto('e'))).toBe(before);
  });
});

describe('collage: removing a photo', () => {
  it('gives the box to what it shared it with, and folds the split away', () => {
    const before = split('root', 'row', [photo('a'), split('pair', 'column', [photo('b'), photo('c')])]);
    const after = removeCollagePhoto(before, 'c') as CollageSplit;
    expect(after.children.map((child) => child.id)).toEqual(['a', 'b']);
    expect(collageDepth(after)).toBe(2);
    expect(after.sizes).toEqual([1, 1]);
  });

  it('keeps the survivors’ ratios to each other when the split holds more than two', () => {
    const before = split('band', 'row', [photo('a'), photo('b'), photo('c')], [2, 1, 1]);
    const after = removeCollagePhoto(before, 'a') as CollageSplit;
    expect(after.children.map((child) => child.id)).toEqual(['b', 'c']);
    expect(after.sizes).toEqual([1, 1]);
    const uneven = removeCollagePhoto(split('band', 'row', [photo('a'), photo('b'), photo('c')], [1, 2, 1]), 'a') as CollageSplit;
    // b held twice what c held before, and still does.
    expect(uneven.sizes[0] / uneven.sizes[1]).toBeCloseTo(2, 5);

    // Removing a child that is NOT the first, out of a split whose three
    // sizes are all different. Every case above happens to survive dropping
    // the wrong INDEX from the sizes array -- with [1, 1, 2] or [2, 1, 1] and
    // a removal at index 0, dropping index 0 by mistake gives the identical
    // answer -- so this is the one that can actually see it.
    const middle = removeCollagePhoto(split('band', 'row', [photo('a'), photo('b'), photo('c')], [1, 2, 3]), 'b') as CollageSplit;
    expect(middle.children.map((child) => child.id)).toEqual(['a', 'c']);
    expect(middle.sizes[1] / middle.sizes[0]).toBeCloseTo(3, 5);
  });

  it('never leaves a split holding a split of its own direction', () => {
    // The exact shape a gate review found: removing photo-5 folds
    // `right-top-left` away and would drop a ROW split straight into a ROW
    // split, so the line she sees between two boxes would move three.
    const tree = galleries.heroCollage as CollageNode;
    const after = removeCollagePhoto(tree, 'photo-5');
    expect(after).not.toBe(tree);
    expect(isCanonical(after)).toBe(true);
    expect(collageTreeProblems(after)).toEqual([]);
  });

  it('refuses to remove the only photo there is', () => {
    const alone = photo('only');
    expect(collageRemoveRefusal(alone, 'only')).toBe('floor');
    expect(removeCollagePhoto(alone, 'only')).toBe(alone);
    expect(countCollagePhotos(alone)).toBe(MIN_COLLAGE_PHOTOS);
  });

  it('refuses a photo no node carries, by reference', () => {
    const before = sampleTree();
    expect(collageRemoveRefusal(before, 'nobody')).toBe('unknown');
    expect(removeCollagePhoto(before, 'nobody')).toBe(before);
    expect(removeCollagePhoto(before, 'mid')).toBe(before);
  });

  it('leaves the tree valid at both ends', () => {
    const after = removeCollagePhoto(sampleTree(), 'c');
    expect(collageTreeProblems(after)).toEqual([]);
    expect(() => assertCollageTree(after)).not.toThrow();
  });
});

describe('collage: repeated editing does not deepen the tree', () => {
  // The plan's own warning: "without it every removal leaves a redundant split
  // behind, the tree deepens forever, and after enough edits a divider drag
  // moves something she did not point at."
  it('five add-then-remove cycles leave the depth and the shape where they started', () => {
    const start = galleries.heroCollage as CollageNode;
    let tree = start;
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const id = nextCollageId(tree, 'photo');
      tree = addCollagePhoto(tree, 'photo-8', cycle % 2 === 0 ? 'column' : 'row', newPhoto(id));
      expect(countCollagePhotos(tree)).toBe(17);
      expect(isCanonical(tree)).toBe(true);
      tree = removeCollagePhoto(tree, id);
      expect(countCollagePhotos(tree)).toBe(16);
      expect(isCanonical(tree)).toBe(true);
      expect(collageTreeProblems(tree)).toEqual([]);
    }
    expect(collageDepth(tree)).toBe(collageDepth(start));
    expect(shape(tree)).toEqual(shape(start));
  });

  // Sizes are deliberately NOT expected to come back to exactly where they
  // were, and that is a decision rather than a gap: removing a photo hands its
  // share back to the survivors IN PROPORTION (so they keep their ratios to
  // each other -- see the test above), which is not the exact inverse of
  // halving one box to make room. Making it exact would mean dumping the whole
  // of a removed box's space onto whichever neighbour it was split from, which
  // is arbitrary from her point of view and worse to look at. What must hold
  // across any number of edits is that the numbers stay bounded, normalised
  // and valid -- which is what this checks.
  it('keeps every size normalised and publishable across a long run of edits', () => {
    let tree = galleries.heroCollage as CollageNode;
    for (let cycle = 0; cycle < 12; cycle += 1) {
      const id = nextCollageId(tree, 'photo');
      tree = addCollagePhoto(tree, 'photo-12', cycle % 2 === 0 ? 'row' : 'column', newPhoto(id));
      tree = resizeCollageSplit(tree, (findCollageParent(tree, id) as { split: CollageSplit }).split.id, 0, 0.3);
      tree = removeCollagePhoto(tree, id);
    }
    expect(collageTreeProblems(tree)).toEqual([]);
    expect(() => assertCollageTree(tree)).not.toThrow();
    expect(collageDepth(tree)).toBeLessThanOrEqual(MAX_COLLAGE_DEPTH);
  });

  // The other sequence the depth limit exists for: dividing the box just
  // created, over and over. It is refused by depth long before the photo cap,
  // and how soon depends on where she started -- which is why the UI computes
  // it (collageAddRefusal) rather than quoting a number.
  it('dividing the new box again and again is stopped by the depth limit, not the cap', () => {
    let tree: CollageNode = photo('seed');
    let target = 'seed';
    let adds = 0;
    // Bounded, and the bound is deliberately well past the answer: a test that
    // can spin forever is not a test, and one that ends BY the bound would be
    // reporting the bound rather than the limit -- which the assertion on
    // `adds` below is what rules out.
    for (let attempt = 0; attempt < MAX_COLLAGE_PHOTOS + 5; attempt += 1) {
      const id = nextCollageId(tree, 'photo');
      // Always ACROSS the parent's direction, so every add is a new level.
      const parent = findCollageParent(tree, target);
      const direction = parent === null ? 'row' : parent.split.direction === 'row' ? 'column' : 'row';
      if (collageAddRefusal(tree, target, direction) !== null) break;
      const next = addCollagePhoto(tree, target, direction, newPhoto(id));
      // An add that was not refused must actually change the tree; anything
      // else is the loop above going nowhere.
      expect(next).not.toBe(tree);
      tree = next;
      target = id;
      adds += 1;
    }
    expect(collageDepth(tree)).toBe(MAX_COLLAGE_DEPTH);
    expect(countCollagePhotos(tree)).toBeLessThan(MAX_COLLAGE_PHOTOS);
    expect(collageAddRefusal(tree, target, 'row')).not.toBe('cap');
    expect(adds).toBe(MAX_COLLAGE_DEPTH - 1);
  });
});

describe('collage: how far below the root a node sits', () => {
  it('counts the root as one and each split as one more', () => {
    expect(collageNodeLevel(sampleTree(), 'root')).toBe(1);
    expect(collageNodeLevel(sampleTree(), 'a')).toBe(2);
    expect(collageNodeLevel(sampleTree(), 'inner')).toBe(3);
    expect(collageNodeLevel(sampleTree(), 'd')).toBe(4);
    expect(collageNodeLevel(sampleTree(), 'nobody')).toBeNull();
  });

  // The number the UI would have got wrong if it quoted a constant: what is
  // left is MAX_COLLAGE_DEPTH minus the box's own level, and the committed
  // arrangement's photos do not all sit at the same level.
  it('differs between photos of the same collage', () => {
    const tree = galleries.heroCollage as CollageNode;
    const levels = collagePhotos(tree).map((p) => collageNodeLevel(tree, p.id));
    expect(new Set(levels).size).toBeGreaterThan(1);
  });
});
