// How the writing surface addresses one editable field inside one block.
//
// A slot key is spelled exactly as validate.ts spells the tail of a problem
// field after `[i].blocks[n].` -- `text`, `caption`, `attribution`,
// `items[3]` -- so a problem routes itself to the field it is about with no
// translation table in between, and no second hand-written list to keep in
// step. block-problems.ts already hands that tail over verbatim (its `key`
// carries any nesting after the block index), which is the half of this that
// was already true before this file existed.
import { isBlockKind } from '../../content/guards';
import type { Block, BlockKind } from '../../content/types';

export interface Slot {
  readonly key: 'text' | 'attribution' | 'caption' | `items[${number}]`;
  readonly source: string;
}

// Blocks with no markdown-bearing words at all. They render as atoms and are
// never handed an editable host.
//
// A `Record<BlockKind, ...>` rather than a set of names, so an eleventh kind
// added to BlockContentMap (src/content/types.ts) is a `tsc -b` failure
// naming this file rather than a kind that silently becomes writable or
// silently becomes an atom, whichever way the default happened to fall.
const ATOM_KINDS: Record<BlockKind, true | undefined> = {
  paragraph: undefined, heading: undefined, quote: undefined,
  bulletList: undefined, numberList: undefined, image: undefined,
  ingredients: undefined, steps: undefined,
  gallery: true, citation: true,
};

export function isAtom(kind: BlockKind): boolean {
  return ATOM_KINDS[kind] === true;
}

function str(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? value : '';
}

// Every field is read through an explicit cast off one `Record` alias, and
// the switch is on `kind` DIRECTLY rather than on a variable aliased out of a
// cast. Aliasing the discriminant through a cast severs TypeScript's
// aliased-discriminant narrowing and leaves `block` as the whole union inside
// the switch -- `error TS2339: Property 'text' does not exist on type
// 'Block'`, measured. BlockFields.tsx:228 switches the same way for the same
// reason.
export function slotsOf(block: Block): Slot[] {
  const record = block as unknown as Record<string, unknown> | null | undefined;
  const raw = record?.kind;
  // `kind` comes out of localStorage through registerLoaded's unchecked cast
  // (sections/register-loaded.ts), so the type's promise is not a runtime
  // fact and the value need not even be an object. A kind this model has
  // never had gets no slots; the surface's banner is what says so.
  if (!isBlockKind(raw)) return [];
  const fields = record as Record<string, unknown>;
  switch (raw) {
    case 'paragraph':
    case 'heading':
      return [{ key: 'text', source: str(fields, 'text') }];
    case 'quote':
      return [
        { key: 'text', source: str(fields, 'text') },
        { key: 'attribution', source: str(fields, 'attribution') },
      ];
    case 'image':
      return [{ key: 'caption', source: str(fields, 'caption') }];
    case 'bulletList':
    case 'numberList':
    case 'ingredients':
    case 'steps': {
      // A non-array `items` is reachable for the same reason a bad `kind` is,
      // and the nearest error boundary is per-SECTION -- a throw here takes
      // the whole Posts panel down with it. BlockList.tsx:124 defends the
      // block array itself the same way, for the same reason.
      //
      // `ingredients` and `steps` also carry a `heading`, and it is
      // deliberately NOT a slot: types.ts:341-342 types it `string`, not
      // `InlineText`, and blocks.tsx:112 renders it as plain words with no
      // Inline around it. Handing it a markdown host would let her bold a
      // word and publish the asterisks.
      const items: unknown[] = Array.isArray(fields.items) ? (fields.items as unknown[]) : [];
      return items.map((item, i) => ({
        key: `items[${i}]` as const,
        source: typeof item === 'string' ? item : '',
      }));
    }
    case 'gallery':
    case 'citation':
      return [];
    default: {
      const _exhaustive: never = raw;
      return _exhaustive;
    }
  }
}

const ITEM_KEY = /^items\[(\d+)\]$/;

// Writes one slot back, producing a NEW block object and leaving the old one
// exactly as it was. The caller must pass the result to
// `rename(from, to, index)` (stable-names.ts) before onChange, exactly as
// BlockList.tsx:404 already does -- the WeakMap that files a staged photo is
// keyed on this object, and without that call the photo's bytes are left
// under a name nothing refers to any more.
export function withSlot(block: Block, key: Slot['key'], source: string): Block {
  const match = ITEM_KEY.exec(key);
  if (match !== null) {
    const index = Number(match[1]);
    const items: unknown[] = Array.isArray((block as { items?: unknown }).items)
      ? (block as { items: unknown[] }).items
      : [];
    return { ...block, items: items.map((item, i) => (i === index ? source : item)) } as Block;
  }
  // `caption` and `attribution` are OMITTED when emptied, never blanked --
  // types.ts:316-340 and blank-block.ts both state the rule, and assertBlock
  // accepts an absent key while validateBlock refuses a blank one, so writing
  // '' here would fail the write boundary on a caption she had merely cleared.
  if (key === 'caption' || key === 'attribution') {
    const next = { ...block } as Record<string, unknown>;
    if (source.trim().length === 0) delete next[key];
    else next[key] = source;
    return next as unknown as Block;
  }
  return { ...block, text: source } as Block;
}
