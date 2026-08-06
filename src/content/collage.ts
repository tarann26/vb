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
// Note for Task 6 (add/remove): repeatedly dividing the box just created is
// what this limit -- not MAX_COLLAGE_PHOTOS -- stops. HOW MANY such adds it
// allows is not a constant, and an earlier version of this comment said "11",
// which is only true starting from a one-photo collage: what is left is
// MAX_COLLAGE_DEPTH minus the box's OWN level, so on the committed
// arrangement the shallowest photo allows nine and the deepest six. A gate
// review measured both. The UI must therefore compute that refusal
// (`collageAddRefusal` below) rather than quote a number -- and it gets a
// better answer for free: dividing a box ALONG its parent's own direction adds
// a sibling instead of a level once the tree is canonicalised, so the same box
// is often divisible one way when it is not divisible the other, and "divide
// it the other way instead" is a real answer.
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
// zero, negative or non-finite, and for any single value too small to survive
// the rounding: there is no proportion to preserve in either input, and a
// silent fallback here would write a wrong-but-valid-looking arrangement into
// content.
//
// The per-value check is the one a review found missing, and it is a contract
// violation rather than a live defect. Rounding to six decimal places sends
// anything that scales below 5e-7 to exactly 0, so this function could hand
// back an array its own `isNormalizedSizes` (above) refuses, that
// `collageTreeProblems` and `assertCollageTree` both reject, and that
// `resizeCollageSplit` would happily write -- a box collapsed to 0px at /edit
// and on the public page, and every later publish refused with "every box in
// this collage needs a size greater than zero", a message that names no box.
// Nothing reaches it today: the only thing keeping a size off the floor is
// MIN_PAIR_SHARE (0.15), a constant in a different function, and a targeted
// 4000-operation squeeze against it bottomed out at 2.6e-4 -- some 500x above
// the threshold. That margin is an accident of a number this file's own
// comment already invites a future reader to lower, which is exactly when a
// latent violation becomes a live one.
export function normalizeSizes(sizes: readonly number[]): number[] {
  if (sizes.length === 0) throw new Error('collage: cannot normalise an empty sizes array');
  const sum = sizes.reduce((total, size) => total + size, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new Error(`collage: cannot normalise sizes summing to ${String(sum)}`);
  }
  const scale = sizes.length / sum;
  const scaled = sizes.map((size) => Math.round(size * scale * SIZE_ROUNDING) / SIZE_ROUNDING);
  const vanished = scaled.findIndex((size) => size <= 0);
  if (vanished !== -1) {
    throw new Error(
      `collage: cannot normalise sizes -- size[${vanished}] (${String(sizes[vanished])}) is too small to keep a proportion`,
    );
  }
  return scaled;
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

// ---------------------------------------------------------------------------
// Task 6: growing and pruning the tree.
//
// CANONICAL FORM, and why it is not cosmetic. A split must never hold a child
// split of its OWN direction. Three boxes side by side have to be one row of
// three, not a row holding a row -- because a divider is "(this split, the gap
// at index i)" and resolves to `children[i]` and `children[i + 1]`, so if
// `children[1]` is secretly a pair, the line she sees between the second and
// third boxes belongs to the INNER split while the line she grabs at the outer
// level moves two boxes against one. That is exactly "a divider drag moves
// something she did not point at", the failure the plan names and the reason
// n-ary children were chosen over binary splits in the first place
// (types.ts's CollageSplit comment).
//
// The committed arrangement is canonical -- it alternates row/column at every
// level -- so nothing today violates it. Only EDITING can: removing a child
// leaves a one-child split that must fold into its parent, and the child it
// folds up may share the parent's direction. A gate review found precisely
// this, by running the operations before they existed.
//
// So both operations below finish by canonicalising, and canonicalising is
// the IDENTITY on a tree that is already canonical -- `canonicalizeCollageTree
// (t) === t`, by reference. That is what makes "this tree is canonical" an
// assertion a test can make, rather than a property a comment claims.

export function canonicalizeCollageTree(node: CollageNode): CollageNode {
  if (node.kind === 'photo') return node;

  let changed = false;
  const canonical = node.children.map((child) => {
    const next = canonicalizeCollageTree(child);
    if (next !== child) changed = true;
    return next;
  });

  // Splice any same-direction child's children into this level, scaling their
  // sizes by the slot the child occupied -- so the boxes on screen keep the
  // proportions they had. (One level of nesting also means one fewer gap
  // along that axis, so the pixels move by 4px; the proportions do not.)
  const children: CollageNode[] = [];
  const sizes: number[] = [];
  canonical.forEach((child, i) => {
    if (child.kind === 'split' && child.direction === node.direction) {
      changed = true;
      const childTotal = child.sizes.reduce((sum, size) => sum + size, 0);
      child.children.forEach((grandchild, j) => {
        children.push(grandchild);
        sizes.push((node.sizes[i] * child.sizes[j]) / childTotal);
      });
      return;
    }
    children.push(child);
    sizes.push(node.sizes[i]);
  });

  // A split of one is not a split -- it is its child, wearing a box. Folding
  // it away is what stops the tree deepening forever under repeated
  // add/remove. Children are already canonical here, so this cannot expose a
  // new same-direction pair at THIS level; the parent's own pass, which runs
  // after this one returns, is what handles it one level up.
  if (children.length === 1) return children[0];
  if (!changed) return node;
  return { ...node, children, sizes: normalizeSizes(sizes) };
}

// The first id of the form `<prefix>-<n>` that no node in the tree already
// carries. Deterministic, so an added photo's id is the same in a test as it
// is on screen, and so the JSON diff a human reads says `photo-17` rather than
// a random string.
export function nextCollageId(node: CollageNode, prefix: string): string {
  const taken = new Set(collageNodeIds(node));
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

// Replaces the photo `targetId` names with a split holding it and `photo`,
// side by side or stacked. No checks: `addCollagePhoto` below is what applies
// them, and `collageAddRefusal` uses this to ask what the result WOULD be.
function subdivide(
  node: CollageNode,
  targetId: string,
  direction: SplitDirection,
  photo: CollagePhoto,
  splitId: string,
): CollageNode {
  if (node.kind === 'photo') {
    if (node.id !== targetId) return node;
    return { kind: 'split', id: splitId, direction, children: [node, photo], sizes: [1, 1] };
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = subdivide(child, targetId, direction, photo, splitId);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

// Why an add can be refused. Each one has its own sentence in the UI, because
// each one has a different answer: "remove one first" for the cap, and
// "divide it the other way" for the depth.
export type CollageAddRefusal = 'unknown' | 'cap' | 'depth';

// Asked by BOTH the control (to disable itself with the right reason) and by
// `addCollagePhoto` (to refuse), so the message she reads and the rule that
// binds cannot disagree. The depth answer is computed from what the result
// would actually be, never from a constant: subdividing a box whose parent
// already runs in the same direction adds a sibling rather than a level once
// the tree is canonicalised, so the SAME box can be divisible one way and not
// the other -- which is what makes "divide it the other way instead" a real
// answer rather than a consolation.
export function collageAddRefusal(
  node: CollageNode,
  targetId: string,
  direction: SplitDirection,
): CollageAddRefusal | null {
  if (findCollagePhoto(node, targetId) === null) return 'unknown';
  if (countCollagePhotos(node) >= MAX_COLLAGE_PHOTOS) return 'cap';
  const probe: CollagePhoto = { kind: 'photo', id: PROBE_ID, src: '/probe', alt: '' };
  const would = canonicalizeCollageTree(subdivide(node, targetId, direction, probe, PROBE_SPLIT_ID));
  return collageDepth(would) > MAX_COLLAGE_DEPTH ? 'depth' : null;
}

// Two ids that exist only inside the depth probe above and never reach a
// tree. Named rather than inlined so it is obvious they are not content.
const PROBE_ID = '__probe__';
const PROBE_SPLIT_ID = '__probe-split__';

// Divides exactly one box in two and leaves every other proportion alone: the
// chosen photo keeps half of the box it had, and the new photo takes the other
// half. Nothing else in the tree changes at all -- which is the whole payoff of
// the tree model, since there is no free cell to find and no grid to fit into.
//
// Refused -- returning the tree by reference -- when `collageAddRefusal` says
// so, and when `photo.id` is already taken (a caller that minted a colliding
// id would otherwise produce a tree the guard refuses at build time).
export function addCollagePhoto(
  node: CollageNode,
  targetId: string,
  direction: SplitDirection,
  photo: CollagePhoto,
): CollageNode {
  if (collageAddRefusal(node, targetId, direction) !== null) return node;
  if (collageNodeIds(node).includes(photo.id)) return node;
  return canonicalizeCollageTree(subdivide(node, targetId, direction, photo, nextCollageId(node, 'split')));
}

// Why a remove can be refused. 'floor' is MIN_COLLAGE_PHOTOS: one photo is a
// legitimate full-bleed hero, none is a hero with no background at all.
export type CollageRemoveRefusal = 'unknown' | 'floor';

export function collageRemoveRefusal(node: CollageNode, photoId: string): CollageRemoveRefusal | null {
  if (findCollagePhoto(node, photoId) === null) return 'unknown';
  if (countCollagePhotos(node) <= MIN_COLLAGE_PHOTOS) return 'floor';
  return null;
}

// Gives the photo's box to what it shared that box with, and folds away the
// split that is left holding one child -- see `canonicalizeCollageTree` above
// for why folding is the load-bearing half. The survivors keep their ratios to
// each other; only the removed photo's share is redistributed.
export function removeCollagePhoto(node: CollageNode, photoId: string): CollageNode {
  if (collageRemoveRefusal(node, photoId) !== null) return node;
  const parent = findCollageParent(node, photoId);
  // Unreachable: the refusal above has already established both that this
  // photo exists and that it is not the only one, so the root is a split and
  // every photo hangs off something. Treated as "nothing to do" rather than
  // given a branch of its own -- the same "unreachable state, not a reason to
  // invent one" posture EditMode.tsx's own commitSectionField takes.
  if (parent === null) return node;
  const remaining = parent.split.children.filter((_child, i) => i !== parent.index);
  const remainingSizes = parent.split.sizes.filter((_size, i) => i !== parent.index);
  // The split is rebuilt even when one child is left, and the fold is left
  // entirely to `canonicalizeCollageTree` below. A `remaining.length === 1`
  // special case here would be a branch nothing could distinguish -- proven
  // rather than assumed: mutating it to never fold left every test green,
  // because canonicalising folds the same one-child split one line later.
  const replacement = { ...parent.split, children: remaining, sizes: normalizeSizes(remainingSizes) };
  return canonicalizeCollageTree(replaceCollageNode(node, parent.split.id, replacement));
}

// How far below the root a node sits -- the root itself is level 1. What the
// UI needs to say how many more times a box could be divided, which is
// MAX_COLLAGE_DEPTH minus this, and not a constant: the shallowest photo in
// the committed arrangement can be divided far more times than the deepest.
export function collageNodeLevel(node: CollageNode, id: string, level = 1): number | null {
  if (node.id === id) return level;
  if (node.kind === 'photo') return null;
  for (const child of node.children) {
    const found = collageNodeLevel(child, id, level + 1);
    if (found !== null) return found;
  }
  return null;
}
