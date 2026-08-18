import { describe, expect, it } from 'vitest';
import { isAtom, slotsOf, withSlot } from '../slots';
import { BLOCK_KINDS } from '../../../content/guards';
import type { Block } from '../../../content/types';

const keysOf = (block: Block): string[] => slotsOf(block).map((slot) => slot.key);

describe('slotsOf', () => {
  it('gives every text-bearing kind the slots its own keys declare', () => {
    expect(keysOf({ kind: 'paragraph', text: 'a' })).toEqual(['text']);
    expect(keysOf({ kind: 'heading', text: 'a' })).toEqual(['text']);
    expect(keysOf({ kind: 'quote', text: 'a' } as unknown as Block)).toEqual(['text', 'attribution']);
    expect(keysOf({ kind: 'bulletList', items: ['a', 'b'] })).toEqual(['items[0]', 'items[1]']);
    expect(keysOf({ kind: 'numberList', items: ['a'] })).toEqual(['items[0]']);
    expect(keysOf({ kind: 'image', src: '/x.webp', alt: 'x' } as unknown as Block)).toEqual(['caption']);
    expect(keysOf({ kind: 'ingredients', heading: 'For the sauce', items: ['a'] })).toEqual(['items[0]']);
    expect(keysOf({ kind: 'steps', heading: 'Method', items: ['a', 'b'] })).toEqual(['items[0]', 'items[1]']);
  });

  it('carries each slot the field it names, not the first string it finds', () => {
    const slots = slotsOf({ kind: 'quote', text: 'the words', attribution: 'a name' });
    expect(slots).toEqual([
      { key: 'text', source: 'the words' },
      { key: 'attribution', source: 'a name' },
    ]);
  });

  it('gives an absent optional field an empty source rather than dropping the slot', () => {
    // She has to be able to ADD a caption to a photo that has none, so the
    // slot exists whether or not the key does.
    expect(slotsOf({ kind: 'image', src: '/x.webp', alt: 'x' } as unknown as Block)).toEqual([
      { key: 'caption', source: '' },
    ]);
  });

  it('leaves the heading of a recipe card alone -- it is plain words, not markdown', () => {
    // types.ts types it `string` and blocks.tsx renders it with no Inline
    // around it, so an editable host there would let her publish asterisks.
    expect(keysOf({ kind: 'ingredients', heading: 'For the sauce', items: [] })).toEqual([]);
  });

  it('gives the two atom kinds no slots', () => {
    expect(slotsOf({ kind: 'gallery', images: [{ src: '/a.webp', alt: 'a' }] })).toEqual([]);
    expect(slotsOf({ kind: 'citation', publication: 'Vogue', date: '2026-01-01', url: null })).toEqual([]);
    expect(isAtom('gallery')).toBe(true);
    expect(isAtom('citation')).toBe(true);
  });

  it('calls every other kind writable, so a new kind cannot default into silence', () => {
    const atoms = BLOCK_KINDS.filter((kind) => isAtom(kind));
    expect(atoms).toEqual(['gallery', 'citation']);
  });

  it('survives a restored draft whose items are not an array', () => {
    expect(slotsOf({ kind: 'bulletList', items: null } as unknown as Block)).toEqual([]);
  });

  it('survives a restored draft whose items hold something that is not a string', () => {
    expect(slotsOf({ kind: 'bulletList', items: ['a', 7] } as unknown as Block)).toEqual([
      { key: 'items[0]', source: 'a' },
      { key: 'items[1]', source: '' },
    ]);
  });

  it('survives a restored draft whose kind is not a kind', () => {
    expect(slotsOf({ kind: 'marquee' } as unknown as Block)).toEqual([]);
  });

  it('survives a restored draft whose block is not an object at all', () => {
    expect(slotsOf(null as unknown as Block)).toEqual([]);
    expect(slotsOf(undefined as unknown as Block)).toEqual([]);
  });

  it('survives a text field that is not a string', () => {
    expect(slotsOf({ kind: 'paragraph', text: 7 } as unknown as Block)).toEqual([{ key: 'text', source: '' }]);
  });
});

describe('withSlot', () => {
  it('writes the field its key names', () => {
    expect(withSlot({ kind: 'paragraph', text: 'a' }, 'text', 'b')).toEqual({ kind: 'paragraph', text: 'b' });
  });

  it('writes one item of a list and leaves its neighbours as they were', () => {
    expect(withSlot({ kind: 'bulletList', items: ['a', 'b', 'c'] }, 'items[1]', 'B')).toEqual({
      kind: 'bulletList',
      items: ['a', 'B', 'c'],
    });
  });

  it('omits an emptied caption rather than blanking it', () => {
    const next = withSlot({ kind: 'image', src: '/x.webp', alt: 'x', caption: 'c' }, 'caption', '  ');
    expect(Object.prototype.hasOwnProperty.call(next, 'caption')).toBe(false);
  });

  it('omits an emptied attribution rather than blanking it', () => {
    const next = withSlot({ kind: 'quote', text: 't', attribution: 'a' }, 'attribution', '');
    expect(Object.prototype.hasOwnProperty.call(next, 'attribution')).toBe(false);
  });

  it('keeps a caption that has words in it', () => {
    expect(withSlot({ kind: 'image', src: '/x.webp', alt: 'x' }, 'caption', 'the terrace')).toEqual({
      kind: 'image',
      src: '/x.webp',
      alt: 'x',
      caption: 'the terrace',
    });
  });

  it('returns a new object, leaving the original untouched', () => {
    const before: Block = { kind: 'paragraph', text: 'a' };
    const after = withSlot(before, 'text', 'b');
    expect(after).not.toBe(before);
    expect(before).toEqual({ kind: 'paragraph', text: 'a' });
  });

  it('returns a new items array, leaving the original untouched', () => {
    const before: Block = { kind: 'bulletList', items: ['a', 'b'] };
    const after = withSlot(before, 'items[0]', 'A');
    expect((after as { items: string[] }).items).not.toBe((before as { items: string[] }).items);
    expect(before).toEqual({ kind: 'bulletList', items: ['a', 'b'] });
  });

  it('survives a restored draft whose items are not an array', () => {
    expect(withSlot({ kind: 'bulletList', items: null } as unknown as Block, 'items[0]', 'a')).toEqual({
      kind: 'bulletList',
      items: [],
    });
  });
});
