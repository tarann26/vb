// The hero collage's own data structure: one nested tree of splits, which
// replaces the sixteen Tailwind CSS-Grid placement strings (and the whole of
// the deleted `src/content/placement.ts`) this collage used to be.
//
// A node is either a PHOTO (a leaf, one image filling its box) or a SPLIT (a
// box cut into adjacent children, either side by side or stacked). Rendering
// is nested flexbox driven by an inline `flexGrow` -- see Hero.tsx -- so a
// size is a NUMBER in `style`, never a class name. That is the whole reason
// this file exists rather than a smarter placement parser: Tailwind cannot
// scan `.json`, and this project has already paid for that once (nine hero
// photos rendered into implicit rows nobody could see, because seven of the
// fourteen grid utilities the content used had no rule in the shipped
// stylesheet at all). A proportion in `style` is invisible to Tailwind by
// construction, so that entire class of defect stops applying here.
//
// Imports no JSON and no react, deliberately: `validate.ts` -> this module is
// on the Cloudflare Worker's own bundle path (worker/index.ts ->
// ../src/content/validate), which must never pull in react or the build-time
// content snapshot. See src/admin/__tests__/content.test.ts's
// SAFE_CONTENT_SUBMODULES for the boundary this keeps.
import type { CollageNode, CollagePhoto, CollageSplit, SplitDirection } from './types';

// ---------------------------------------------------------------------------
// The two closed unions, as `Record<K, true>` rather than array literals.
//
// The identical idiom -- and the identical reason -- as `SECTION_ID_SET`
// (src/content/guards.ts): an array literal gets each ELEMENT checked against
// the union but never that every MEMBER of the union is present, so it
// silently stops enforcing completeness the moment the union grows. A record
// literal missing a key fails to compile. That comment records this was
// confirmed directly for SectionId (adding a member left `tsc -b` clean with
// the new section entirely unenforced); the same holds here, and the same
// `Object.keys` narrowing assertion is needed for the same known TS
// limitation (`Object.keys` is typed `string[]` whatever it is called on).
const SPLIT_DIRECTION_SET: Record<SplitDirection, true> = {
  row: true,
  column: true,
};
export const SPLIT_DIRECTIONS = Object.keys(SPLIT_DIRECTION_SET) as SplitDirection[];

export function isSplitDirection(value: unknown): value is SplitDirection {
  return typeof value === 'string' && (SPLIT_DIRECTIONS as readonly string[]).includes(value);
}

type CollageNodeKind = CollageNode['kind'];

const COLLAGE_NODE_KIND_SET: Record<CollageNodeKind, true> = {
  photo: true,
  split: true,
};
export const COLLAGE_NODE_KINDS = Object.keys(COLLAGE_NODE_KIND_SET) as CollageNodeKind[];

export function isCollageNodeKind(value: unknown): value is CollageNodeKind {
  return typeof value === 'string' && (COLLAGE_NODE_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The limits. Every one of these is enforced server-side (validate.ts) as
// well as at build time (guards.ts), never only in the UI: the UI is where
// she is told, the validator is what makes it true.

// A split with one child is not a split -- it is its child, wearing a box.
// Refused rather than silently collapsed, because a tree that accepts them
// deepens forever under repeated add/remove and a divider drag eventually
// moves something she did not point at.
export const MIN_SPLIT_CHILDREN = 2;

// Minimum photos: 1. The owner's own words -- "realistically no picture
// would look ugly but we should be able to go down to that" -- so the floor
// exists to prevent a broken state, not to enforce taste. One photo is a
// legitimate full-bleed hero and is the smallest tree that still renders.
// Zero is not allowed: a split needs children, and the hero would have no
// background at all.
export const MIN_COLLAGE_PHOTOS = 1;

// Maximum photos: 24. Measured, not guessed. The sixteen photos this collage
// ships today average 53 KB each (848 KB total) and the whole collage is
// above the fold, so 24 is ~1.24 MB of hero -- still under 1.5 MB -- and an
// average tile of 117 px on a 390x844 phone, still large enough to recognise.
// Past that the page gets heavy for a restaurant's first impression and the
// individual photos stop reading as anything.
export const MAX_COLLAGE_PHOTOS = 24;

// Maximum depth: 12, counting a bare photo as depth 1 and each split as one
// more level than its deepest child.
//
// Chosen from what a box at that depth would actually BE, not from a round
// number. Splitting alternately row/column halves one axis then the other,
// so twelve levels is 1/64 of the width by 1/64 of the height: about 22x12
// CSS px inside a 1440x900 hero, and about 6x13 px inside a 390x844 one.
// Below that a "photo" is not a photo. The committed arrangement is depth 6,
// and ordinary editing never approaches this -- it exists so an unbounded
// tree can never become a rendering stack the browser has to walk, and so
// `collageDepth` below is a total function on anything that validates.
//
// Note for Task 6 (add/remove): repeatedly adding INTO the box just created
// deepens the tree by one each time, so this limit -- not MAX_COLLAGE_PHOTOS
// -- is what stops that particular sequence, at 11 such adds. That refusal
// needs its own sentence in the UI; it is a real answer ("this box is
// already too small to divide again"), not a bug.
export const MAX_COLLAGE_DEPTH = 12;

// ---------------------------------------------------------------------------
// Sizes.
//
// `sizes[i]` is the proportion of the split's own box that `children[i]`
// takes -- not pixels, not percentages. Canonical form: every sizes array
// sums to `children.length`, so an even split is all 1s (which is what makes
// the committed JSON readable, and what makes an authored `[1, 1, 1]` mean
// exactly what it looks like). Each value is rounded to SIZE_PRECISION
// decimal places so a divider drag writes `1.234567`, not seventeen digits of
// float noise, into a file a human reads in a diff.
//
// Rendering only ever uses the RATIOS (flex distributes by relative
// `flexGrow`), so normalising changes nothing on screen -- it exists so the
// numbers stay meaningful, bounded and diffable across an unbounded number of
// edits, and so `validateContent` can tell an un-normalised write (a caller
// that skipped this function) from a legitimate one.
const SIZE_PRECISION = 6;
const SIZE_ROUNDING = 10 ** SIZE_PRECISION;

// How far a sizes array's own sum may sit from `children.length` and still be
// considered normalised. Rounding each of N values to six decimal places can
// move the sum by at most N * 5e-7, so this is ~200x the worst rounding error
// for a two-child split and still tight enough to refuse anything a caller
// actually got wrong (the smallest real mistake -- writing `[1, 2]` and not
// normalising -- is off by 1.0, four orders of magnitude outside it).
export const SIZE_SUM_TOLERANCE = 1e-4;

export function isNormalizedSizes(sizes: readonly number[]): boolean {
  if (sizes.length === 0) return false;
  if (!sizes.every((size) => Number.isFinite(size) && size > 0)) return false;
  const sum = sizes.reduce((total, size) => total + size, 0);
  return Math.abs(sum - sizes.length) <= SIZE_SUM_TOLERANCE;
}

// Scales `sizes` so they sum to `sizes.length`, rounded to SIZE_PRECISION.
// Throws -- rather than returning something plausible -- for a sum that is
// zero, negative or non-finite: there is no proportion to preserve in that
// input, and a silent fallback here would write a wrong-but-valid-looking
// arrangement into content.
export function normalizeSizes(sizes: readonly number[]): number[] {
  if (sizes.length === 0) throw new Error('collage: cannot normalise an empty sizes array');
  const sum = sizes.reduce((total, size) => total + size, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new Error(`collage: cannot normalise sizes summing to ${String(sum)}`);
  }
  const scale = sizes.length / sum;
  return sizes.map((size) => Math.round(size * scale * SIZE_ROUNDING) / SIZE_ROUNDING);
}

// Rebuilds `node` with every split's sizes normalised, top to bottom.
// Structure, ids, direction, src and alt are untouched.
export function normalizeCollageTree(node: CollageNode): CollageNode {
  if (node.kind === 'photo') return node;
  return {
    ...node,
    children: node.children.map(normalizeCollageTree),
    sizes: normalizeSizes(node.sizes),
  };
}

// ---------------------------------------------------------------------------
// Walking the tree.

// Every photo, in document order -- the order a depth-first walk of
// `children` reaches them, which is the order Hero.tsx renders them and the
// order the dashboard's own flat photo list shows them in. Position in this
// list is NOT an identity: swapping two photos (Task 4) exchanges their
// positions in the tree and therefore in this list, while each photo keeps
// its own `id`. Anything that has to name one photo across an edit must use
// `id`, never an index -- see CollagePhoto's own comment in types.ts.
export function collagePhotos(node: CollageNode): CollagePhoto[] {
  if (node.kind === 'photo') return [node];
  return node.children.flatMap(collagePhotos);
}

export function countCollagePhotos(node: CollageNode): number {
  return collagePhotos(node).length;
}

// Every node's id, in document order, splits included -- what the uniqueness
// rule below is checked against, and what a caller minting a new id (Task 6)
// has to avoid colliding with.
export function collageNodeIds(node: CollageNode): string[] {
  if (node.kind === 'photo') return [node.id];
  return [node.id, ...node.children.flatMap(collageNodeIds)];
}

// A bare photo is depth 1; a split is one more than its deepest child. See
// MAX_COLLAGE_DEPTH for what the ceiling means in real pixels.
export function collageDepth(node: CollageNode): number {
  if (node.kind === 'photo') return 1;
  return 1 + Math.max(...node.children.map(collageDepth));
}

export function findCollagePhoto(node: CollageNode, id: string): CollagePhoto | null {
  return collagePhotos(node).find((photo) => photo.id === id) ?? null;
}

export function findCollageSplit(node: CollageNode, id: string): CollageSplit | null {
  if (node.kind === 'photo') return null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findCollageSplit(child, id);
    if (found !== null) return found;
  }
  return null;
}

// The split a node hangs off, and which child of it the node is. `null` for
// the ROOT, which hangs off nothing -- a one-photo collage is the reachable
// case, and it is exactly the case where "make this box wider" has no answer,
// because there is no neighbour to take the width from.
export function findCollageParent(node: CollageNode, id: string): { split: CollageSplit; index: number } | null {
  if (node.kind === 'photo') return null;
  const index = node.children.findIndex((child) => child.id === id);
  if (index !== -1) return { split: node, index };
  for (const child of node.children) {
    const found = findCollageParent(child, id);
    if (found !== null) return found;
  }
  return null;
}

// Exchanges the POSITIONS of the two photos `idA` and `idB` name, carrying
// each photo's whole payload -- id, src and alt -- with it. Exactly the
// gesture the owner described: "The boxes keep their shape. The photos are
// the ones -- it's like the photo fills the box it travels to."
//
// So NOTHING structural moves: every split keeps its id, its direction, its
// sizes array and its children count, and only two of the leaves change. That
// is what makes `galleries.heroCollage.<id>` keep naming the same photograph
// across a swap (types.ts's CollagePhoto comment), and it is why a
// replacement she staged for a photo travels with the photo rather than
// staying on the box it left.
//
// A no-op -- by reference, so React re-renders nothing -- when either id
// names no photo, and equally when the two ids are the SAME. Both are
// reachable: dropping on a box whose photo was removed in another tab, and
// dropping a photo on itself.
//
// The same-id case deliberately has no early return of its own. It would be a
// branch nothing could ever distinguish: with `idA === idB` both lookups find
// the identical object, so `exchangePhotos` replaces that photo with itself,
// every `next === child` holds, and the tree comes back by reference anyway --
// a guard whose only effect is to skip two lookups, and whose removal no test
// could ever turn red. This project counts a branch like that as a defect
// rather than as caution.
export function swapCollagePhotos(node: CollageNode, idA: string, idB: string): CollageNode {
  const a = findCollagePhoto(node, idA);
  const b = findCollagePhoto(node, idB);
  if (a === null || b === null) return node;
  return exchangePhotos(node, a, b);
}

function exchangePhotos(node: CollageNode, a: CollagePhoto, b: CollagePhoto): CollageNode {
  if (node.kind === 'photo') {
    if (node.id === a.id) return b;
    if (node.id === b.id) return a;
    return node;
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = exchangePhotos(child, a, b);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

// Rewrites exactly the one photo `id` names, leaving every other node -- and
// every split's sizes and children order -- at its prior object identity
// where nothing on its path changed. The same "spread the touched level only"
// contract `setCopyText`/`setGallerySrc` (src/admin/) already keep, extended
// to a tree: a subtree containing no match is returned unchanged, by
// reference, so React reconciliation sees no new objects for boxes that did
// not move.
export function setCollagePhotoSrc(node: CollageNode, id: string, src: string): CollageNode {
  if (node.kind === 'photo') return node.id === id ? { ...node, src } : node;
  let changed = false;
  const children = node.children.map((child) => {
    const next = setCollagePhotoSrc(child, id, src);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

// ---------------------------------------------------------------------------
// Task 5's operation: moving one divider.
//
// A DIVIDER is `(a split, the gap at index i)`, and it resolves to exactly two
// adjacent boxes -- `children[i]` and `children[i + 1]` -- always, by
// construction. That is the property the owner's requirement turns on:
// dragging a photo's left edge to widen it must take that width from the box
// immediately to its left, which then gives up exactly as much as this one
// gains. One box widening IS the other one narrowing, because the pair's total
// is conserved and every other child's size is left exactly as it was.
//
// Her own sentence is quoted verbatim in
// docs/superpowers/plans/2026-08-05-plan-9-collage-split-tree.md and
// deliberately paraphrased here, for the reason types.ts's CollageSplit
// comment records for the identical quote: one of its words is a real, bare,
// no-argument Tailwind utility with no rule in the shipped stylesheet, and
// this repo's content scanner has no JS parser to tell a class name from prose
// inside a comment. Measured, not guessed -- the first draft of this comment
// shipped exactly that rule, and the rule-level build diff caught it.

// How little of the pair's shared span the narrower of the two boxes may be
// left with. 15%.
//
// A box dragged to nothing is a photo she can neither see nor select, with no
// obvious way back -- so there has to be a floor, and the only question is
// what it is measured in. Deliberately a proportion of THE PAIR, not a number
// of pixels:
//
//   * The tree is one document rendered at every width. A pixel floor would
//     make the same arrangement legal on a desktop and refused on a phone, so
//     the same drag would stop in a different place depending on which device
//     she happened to be holding -- and `validateContent`, which has no
//     viewport at all, could not check it.
//   * A fraction of the pair is always satisfiable (0.15 <= 0.5), so the
//     clamp can never produce an empty interval, and it can never produce a
//     size at or below zero -- which the validator refuses -- because it is a
//     positive fraction of a positive total.
//   * 15% leaves a visible sixth of the space the two boxes share. On the
//     committed arrangement's widest pair at 1440px that is ~71px, and on its
//     tightest pair on a 390px phone ~19px: small, but still on screen, still
//     draggable back, and still the only outcome of a gesture she made
//     deliberately.
export const MIN_PAIR_SHARE = 0.15;

// What one tap of the panel's "wider"/"narrower" pair moves. 5% of the pair,
// so it takes seven taps to travel from an even split to the clamp above --
// fine enough to land where she means, coarse enough to get there.
export const RESIZE_STEP_SHARE = 0.05;

// How much of the pair `children[gapIndex]` currently holds, 0..1.
export function collagePairShare(split: CollageSplit, gapIndex: number): number {
  const total = split.sizes[gapIndex] + split.sizes[gapIndex + 1];
  return split.sizes[gapIndex] / total;
}

// Gives `children[gapIndex]` the fraction `share` of what it and
// `children[gapIndex + 1]` share between them, and gives the rest to
// `children[gapIndex + 1]`. Every other child of that split, and every other
// split in the tree, is left byte-for-byte alone -- and untouched branches
// come back by reference, so React re-renders only the pair.
//
// `share` is clamped into [MIN_PAIR_SHARE, 1 - MIN_PAIR_SHARE] rather than
// refused: a drag that runs past the end should stop at the end, not undo
// itself. A `gapIndex` that names no gap, or a `splitId` that names no split,
// IS refused -- returning the tree by reference -- because neither is a
// gesture, it is a caller mistake.
export function resizeCollageSplit(
  node: CollageNode,
  splitId: string,
  gapIndex: number,
  share: number,
): CollageNode {
  const split = findCollageSplit(node, splitId);
  if (split === null) return node;
  if (!Number.isFinite(share)) return node;
  if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex > split.children.length - 2) return node;

  const clamped = Math.min(Math.max(share, MIN_PAIR_SHARE), 1 - MIN_PAIR_SHARE);
  const total = split.sizes[gapIndex] + split.sizes[gapIndex + 1];
  const sizes = [...split.sizes];
  sizes[gapIndex] = total * clamped;
  sizes[gapIndex + 1] = total - sizes[gapIndex];
  // The sum is unchanged by construction, so this only rounds to
  // SIZE_PRECISION -- which is the whole reason it is here: a drag writes
  // `1.234567` into a file a human reads in a diff, never seventeen digits of
  // float noise.
  const next = normalizeSizes(sizes);
  if (next.every((size, i) => size === split.sizes[i])) return node;
  return replaceCollageNode(node, splitId, { ...split, sizes: next });
}

// Swaps one node for another by id, rebuilding only the path down to it.
function replaceCollageNode(node: CollageNode, id: string, replacement: CollageNode): CollageNode {
  if (node.id === id) return replacement;
  if (node.kind === 'photo') return node;
  let changed = false;
  const children = node.children.map((child) => {
    const nextChild = replaceCollageNode(child, id, replacement);
    if (nextChild !== child) changed = true;
    return nextChild;
  });
  return changed ? { ...node, children } : node;
}

// Which divider the panel's own "wider"/"narrower" buttons move for the box
// `id` names, and in which sense.
//
// A box has a gap on each side unless it is first or last, so this picks the
// gap AFTER it where there is one and the gap BEFORE it otherwise -- and
// reports `first`, meaning "this box is `children[gapIndex]`", because
// widening the first of a pair and widening the second are opposite moves of
// the same divider. `null` when the box is the whole collage: there is no
// neighbour, so there is no answer, and the UI has to say that rather than
// offer a control that does nothing.
export function collageResizeTarget(
  node: CollageNode,
  id: string,
): { split: CollageSplit; gapIndex: number; first: boolean } | null {
  const parent = findCollageParent(node, id);
  if (parent === null) return null;
  const { split, index } = parent;
  const last = index === split.children.length - 1;
  return { split, gapIndex: last ? index - 1 : index, first: !last };
}
