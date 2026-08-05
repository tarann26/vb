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
import type { CollageNode, CollagePhoto, SplitDirection } from './types';

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
