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
import type { Block } from '../../content/types';

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
    const kept = { ...block, items: shortened } as Block;
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
  const grown = { ...block, items: nextItems } as Block;
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
    const rest = { ...block, items: remainder } as Block;
    return {
      blocks: splice(blocks, at.blockIndex, 1, paragraph, rest),
      caret: { blockIndex: at.blockIndex, slotKey: 'text', offset: 'start' },
      renames: [{ from: block, to: rest, index: at.blockIndex + 1 }],
    };
  }
  // Any later item does nothing at all. Merging item three into item two is a
  // reasonable thing to want and it is not what this task promised.
  if (match !== null) return null;

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
