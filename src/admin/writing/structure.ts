// Enter and Backspace over the block array, as pure functions.
//
// THE ARRAY IS AUTHORITATIVE (D5). Nothing in here reads the DOM: the caller
// hands over the slot's own source either side of the caret and gets back a
// NEW array whose untouched entries are the SAME OBJECTS BY REFERENCE. That
// is not tidiness. stable-names.ts files a staged photograph under a name held
// in a WeakMap keyed on the block object itself, so an operation that rebuilt
// every entry would detach every staged photograph at once and publish a post
// naming a file no bytes were ever sent for -- the defect
// BlockList.tsx:223-254 records, twice repaired and once returned.
//
// Which is also why an `Edit` carries `renames`. A split, a merge, a demotion
// and a step out of a list all REPLACE one block with a new object holding the
// same words, and that object needs its predecessor's name carried onto it.
// The caller passes each entry to `rename(from, to, index)` (stable-names.ts)
// before onChange, exactly as commitSlot already does for a keystroke. The
// rule for what earns an entry is narrow on purpose: an old object leaves the
// array and exactly one new object stands in its place. A genuinely new
// paragraph gets a fresh name, because two entries sharing one name is two
// slots sharing one address.
import { withSlot, type Slot } from './slots';
import { MAX_LIST_DEPTH, type Block } from '../../content/types';

export interface Caret {
  readonly blockIndex: number;
  readonly slotKey: Slot['key'];
  readonly offset: 'start' | 'end';
}

export interface Rename {
  readonly from: Block;
  readonly to: Block;
  readonly index: number;
}

export interface Edit {
  readonly blocks: Block[];
  readonly caret: Caret;
  readonly renames: readonly Rename[];
}

const ITEM_KEY = /^items\[(\d+)\]$/;

// A copy with one window replaced. `slice()` first, so every entry this does
// not name comes out the far side as the identical object it went in as.
function splice(blocks: Block[], index: number, remove: number, ...insert: Block[]): Block[] {
  const next = blocks.slice();
  next.splice(index, remove, ...insert);
  return next;
}

// `items` reaches this through registerLoaded's unchecked cast, so neither the
// array nor the strings in it are a runtime fact. slots.ts:82 reads it the
// same way and for the same reason: a throw here takes the whole Posts panel
// down, the nearest error boundary being per-SECTION.
function itemsOf(block: Block): string[] {
  const raw = (block as { items?: unknown }).items;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((item) => (typeof item === 'string' ? item : ''));
}

// The kinds that may carry a nesting depth AT ALL. A recipe's ingredients and
// its method are `items` lists too and their slot keys are spelled the same
// way, but neither declares `levels` in BLOCK_KEYS -- so writing one onto them
// would produce a block the write boundary refuses as carrying a key this site
// does not use, and she would find out at Publish with no idea what she did.
const NESTABLE: Record<string, true | undefined> = { bulletList: true, numberList: true };

// The depths that go with `items`, always the same length as `items`.
//
// Every entry is read defensively for the reason `itemsOf` above gives: this
// array reaches here through registerLoaded's unchecked cast, so neither its
// length nor the type of anything in it is a runtime fact. A restored draft
// whose `levels` is short, long or full of nulls reads as flat rather than
// throwing inside the Posts panel.
function levelsOf(block: Block, items: string[]): number[] {
  const raw = (block as { levels?: unknown }).levels;
  const source: unknown[] = Array.isArray(raw) ? raw : [];
  return items.map((_item, i) => {
    const level = source[i];
    return typeof level === 'number' && Number.isInteger(level) && level > 0 ? Math.min(level, MAX_LIST_DEPTH) : 0;
  });
}

// The one rule the stored depths have to satisfy, applied rather than
// asserted: the first item has nothing to sit under, and no item is more than
// one step deeper than the item above it. `nest` in blocks.tsx clamps the same
// way at render time, so a violation is never a crash -- but leaving one in
// the array means the words on screen and the words that publish disagree
// about which item is a sub-item of which.
function tidy(levels: number[]): number[] {
  let ceiling = 0;
  return levels.map((level) => {
    const next = Math.min(level, ceiling);
    ceiling = Math.min(next + 1, MAX_LIST_DEPTH);
    return next;
  });
}

// A list block with new items and the depths that go with them, in ONE place
// so that no edit can change the length of one array without the other. That
// desync is the whole cost of the parallel-array storage: both boundaries
// refuse a pair whose lengths disagree, so a split or a step-out that grew
// `items` alone would leave her unable to publish the post at all.
//
// `levels` is DELETED, never set to undefined, once every item is flat again.
// An own key holding `undefined` is dropped by JSON.stringify but still seen
// by `unknownKeys` (hasOwnProperty, guards.ts), so the block would be refused
// by the very boundary the key was removed to satisfy. The same reason
// `withSlot` omits a blank caption rather than blanking it.
function withItems(block: Block, items: string[], levels: number[]): Block {
  const next = { ...block, items } as unknown as Record<string, unknown>;
  const tidied = tidy(levels);
  if (tidied.every((level) => level === 0)) delete next.levels;
  else next.levels = tidied;
  return next as unknown as Block;
}

function stringAt(block: Block, key: string): string {
  const value = (block as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export function enterAt(blocks: Block[], at: Caret, before: string, after: string): Edit {
  const block = blocks[at.blockIndex];
  // A restored draft can hold a null where a block was; slotsOf gives it no
  // slot, so this is unreachable from the surface and is here so that it stays
  // unreachable from anywhere.
  if (block === null || block === undefined) return { blocks, caret: at, renames: [] };
  const match = at.slotKey.match(ITEM_KEY);

  if (match === null) {
    // A paragraph, a heading, a quotation or a photograph's caption. Enter
    // always produces a PARAGRAPH, never a second heading -- pressing Enter at
    // the end of a heading and getting another heading is the single most
    // complained-about behaviour in any editor that does it.
    //
    // `withSlot` is what keeps a caption's split from destroying its
    // photograph: the head is the SAME image block with shorter words, and it
    // is that object the rename below carries the name onto.
    const head = withSlot(block, at.slotKey, before);
    const tail: Block = { kind: 'paragraph', text: after };
    return {
      blocks: splice(blocks, at.blockIndex, 1, head, tail),
      caret: { blockIndex: at.blockIndex + 1, slotKey: 'text', offset: 'start' },
      renames: [{ from: block, to: head, index: at.blockIndex }],
    };
  }

  const index = Number(match[1]);
  const items = itemsOf(block);
  const levels = levelsOf(block, items);

  // ENTER ON AN EMPTY ITEM LEAVES THE LIST. Only on an empty one, and only on
  // the LAST one -- pressing Enter on an empty item in the middle of a list is
  // her adding a gap, not her finishing.
  if (before.length === 0 && after.length === 0 && index === items.length - 1) {
    const shortened = items.slice(0, index);
    const paragraph: Block = { kind: 'paragraph', text: '' };
    if (shortened.length === 0) {
      // The list had one item and it was empty, so the list itself is what she
      // is leaving. One object stands in its place, so the name travels.
      return {
        blocks: splice(blocks, at.blockIndex, 1, paragraph),
        caret: { blockIndex: at.blockIndex, slotKey: 'text', offset: 'start' },
        renames: [{ from: block, to: paragraph, index: at.blockIndex }],
      };
    }
    const kept = withItems(block, shortened, levels.slice(0, index));
    return {
      blocks: splice(blocks, at.blockIndex, 1, kept, paragraph),
      caret: { blockIndex: at.blockIndex + 1, slotKey: 'text', offset: 'start' },
      renames: [{ from: block, to: kept, index: at.blockIndex }],
    };
  }

  const nextItems = items.slice();
  // Replace, never insert: inserting `after` beside an untouched item leaves
  // the words she split standing in both halves.
  nextItems.splice(index, 1, before, after);
  // The new item starts at the depth of the one it was split out of, which is
  // what pressing Enter in the middle of a sub-list means. Spliced the same
  // way as the words above rather than pushed, so the two arrays cannot come
  // out different lengths.
  const nextLevels = levels.slice();
  nextLevels.splice(index, 1, levels[index], levels[index]);
  const grown = withItems(block, nextItems, nextLevels);
  return {
    blocks: splice(blocks, at.blockIndex, 1, grown),
    caret: { blockIndex: at.blockIndex, slotKey: `items[${index + 1}]`, offset: 'start' },
    renames: [{ from: block, to: grown, index: at.blockIndex }],
  };
}

export function backspaceAtStart(blocks: Block[], at: Caret): Edit | null {
  const block = blocks[at.blockIndex];
  if (block === null || block === undefined) return null;
  const kind = (block as { kind?: unknown }).kind;
  const match = at.slotKey.match(ITEM_KEY);

  // A heading or a quotation becomes a paragraph on the first press and merges
  // upward on the second. Two presses to destroy a boundary is deliberate: one
  // press is how a heading disappears by accident.
  //
  // `at.slotKey === 'text'` is load-bearing and not decoration. Without it,
  // Backspace at the top of a quotation's ATTRIBUTION demotes the quotation
  // she was not standing in and throws the caret somewhere else.
  if (match === null && at.slotKey === 'text' && (kind === 'heading' || kind === 'quote')) {
    const demoted: Block = { kind: 'paragraph', text: stringAt(block, 'text') };
    // A paragraph cannot hold an attribution, so those words become a
    // paragraph of their own rather than disappearing. Nothing here has an
    // undo yet (Task 20), and destroying words she cannot get back is a worse
    // outcome than one extra paragraph she can remove with one more press --
    // which the ordinary paragraph merge below then does.
    const attribution = stringAt(block, 'attribution');
    const carried: Block[] = attribution.trim().length === 0
      ? []
      : [{ kind: 'paragraph', text: attribution }];
    return {
      blocks: splice(blocks, at.blockIndex, 1, demoted, ...carried),
      caret: { blockIndex: at.blockIndex, slotKey: 'text', offset: 'start' },
      renames: [{ from: block, to: demoted, index: at.blockIndex }],
    };
  }

  // The first item of a list steps out of it, keeping its words. The rest of
  // the list survives as the same kind of list, so it -- not the new paragraph
  // -- is what the name follows.
  if (match !== null && Number(match[1]) === 0) {
    const items = itemsOf(block);
    const paragraph: Block = { kind: 'paragraph', text: items[0] ?? '' };
    const remainder = items.slice(1);
    if (remainder.length === 0) {
      return {
        blocks: splice(blocks, at.blockIndex, 1, paragraph),
        caret: { blockIndex: at.blockIndex, slotKey: 'text', offset: 'start' },
        renames: [{ from: block, to: paragraph, index: at.blockIndex }],
      };
    }
    // Whatever was nested under the item that just left steps up with it:
    // `tidy` inside withItems refuses to leave a first item indented, because
    // there is no longer anything above it to be indented under.
    const rest = withItems(block, remainder, levelsOf(block, items).slice(1));
    return {
      blocks: splice(blocks, at.blockIndex, 1, paragraph, rest),
      caret: { blockIndex: at.blockIndex, slotKey: 'text', offset: 'start' },
      renames: [{ from: block, to: rest, index: at.blockIndex + 1 }],
    };
  }
  // BACKSPACE AT THE START OF A NESTED ITEM OUTDENTS IT BY ONE. Backlog item
  // 12: the spec named Tab and Shift+Tab only, so an indented item could be
  // un-indented with Shift+Tab and nothing else -- a binding nobody guesses,
  // in a surface whose other list gestures are all plain typing.
  //
  // `indentAt(..., -1)` rather than a second outdent written here, and that is
  // the whole point of routing it: it is the one place that clamps the depth,
  // rebuilds `items` and `levels` together through `withItems`, and files the
  // rename the staged-photograph WeakMap needs. A hand-written copy would be a
  // second spelling of the invariant this task exists to keep.
  //
  // It answers `null` when there is nothing to outdent (a flat item, or a kind
  // that may not nest at all), and that `null` is returned directly here, not
  // fallen through to the refusal below -- the observable behaviour is the
  // same either way: still no merge of item three into item two, which
  // remains a reasonable thing to want and remains out of scope.
  if (match !== null) return indentAt(blocks, at, -1);

  // BACKSPACE MUST NEVER SILENTLY REMOVE A PHOTOGRAPH, and there are two ways
  // in. This guard is the one where the caret is inside the photograph's own
  // caption: without it the merge below swallows the image block whole and
  // leaves the paragraph above holding its words. The guard after it is the
  // other way in -- a paragraph directly beneath an image, merging upward
  // across it.
  if (kind !== 'paragraph') return null;

  const previous = blocks[at.blockIndex - 1];
  if (previous === null || previous === undefined) return null;
  if ((previous as { kind?: unknown }).kind !== 'paragraph') return null;
  const merged: Block = {
    kind: 'paragraph',
    text: stringAt(previous, 'text') + stringAt(block, 'text'),
  };
  return {
    blocks: splice(blocks, at.blockIndex - 1, 2, merged),
    caret: { blockIndex: at.blockIndex - 1, slotKey: 'text', offset: 'end' },
    renames: [{ from: previous, to: merged, index: at.blockIndex - 1 }],
  };
}

// Tab and Shift+Tab: one step deeper, or one step back out.
//
// `null` means "this press was not ours", and the caller depends on it: Tab
// with no default action left is how a keyboard user leaves the writing
// surface at all, so every press this refuses has to reach the browser
// untouched. That is why the no-op cases below return null rather than an
// Edit whose blocks happen to be equal.
//
// Three of them, and each is a rule rather than a guard against a crash:
//
//   * not a list item, or not a kind that may nest -- see NESTABLE above.
//   * THE FIRST ITEM OF A LIST NEVER NESTS. There is nothing above it to be
//     a sub-item of, and a list whose only item is indented renders as one
//     empty list wrapped around another.
//   * no item may land more than one step below the item above it. A gap
//     between the two is a depth `nest` (blocks.tsx) has to clamp at render
//     time, which means the array and the page would disagree.
//
// The cap itself is MAX_LIST_DEPTH and is checked here rather than only at
// the boundaries, so the deepest thing she can produce with the keyboard is
// the deepest thing that can be stored.
export function indentAt(blocks: Block[], at: Caret, delta: 1 | -1): Edit | null {
  const match = ITEM_KEY.exec(at.slotKey);
  if (match === null) return null;
  const block = blocks[at.blockIndex];
  if (block === null || block === undefined) return null;
  const kind = (block as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || NESTABLE[kind] !== true) return null;
  const items = itemsOf(block);
  const index = Number(match[1]);
  if (index >= items.length) return null;
  const levels = levelsOf(block, items);
  const ceiling = index === 0 ? 0 : Math.min(levels[index - 1] + 1, MAX_LIST_DEPTH);
  const next = Math.max(0, Math.min(levels[index] + delta, ceiling));
  if (next === levels[index]) return null;
  const nextLevels = levels.slice();
  nextLevels[index] = next;
  // The block she is standing in is replaced by a new object holding the same
  // words, which is exactly the shape that earns a rename: without it the
  // WeakMap that files a staged photograph under this block's name has no
  // entry for the object the array now holds.
  const updated = withItems(block, items, nextLevels);
  return {
    blocks: splice(blocks, at.blockIndex, 1, updated),
    caret: at,
    renames: [{ from: block, to: updated, index: at.blockIndex }],
  };
}
