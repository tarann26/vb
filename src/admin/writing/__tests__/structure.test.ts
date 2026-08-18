// Enter and Backspace, as the array transformations they are.
//
// All of the substance is here, because all of the substance is pure. What
// jsdom cannot say -- where the caret lands, whether the suppressed default
// really was suppressed, whether a fast typist loses a keystroke over the
// re-render -- is named in WritingSurface.test.tsx where the wiring lives and
// deferred from there to e2e/writing-surface.spec.ts.
//
// Two claims recur and neither is decoration. UNTOUCHED BLOCKS COME OUT BY
// REFERENCE, and a block that survives in changed form CARRIES ITS NAME: a
// staged photograph is filed under `blocks[<name>].src`, the name lives in a
// WeakMap keyed on the block object, and either failure files those bytes
// under a name nothing refers to any more.
import { describe, expect, it } from 'vitest';
import { backspaceAtStart, enterAt, type Edit } from '../structure';
import { createStableNames } from '../../blocks/stable-names';
import type { Block } from '../../../content/types';

// The renames an edit reports, played against the real WeakMap rather than
// against a promise about it. `was` is what each block was called going in;
// `now` is what each block in the new array is called coming out.
function namesAcross(blocks: Block[], edit: Edit): { was: string[]; now: string[] } {
  const names = createStableNames('b');
  const was = blocks.map((block, i) => names.nameOf(block, i));
  edit.renames.forEach((entry) => names.rename(entry.from, entry.to, entry.index));
  return { was, now: edit.blocks.map((block, i) => names.nameOf(block, i)) };
}

describe('enterAt', () => {
  it('splits a paragraph in two at the caret and hands every other block back by REFERENCE', () => {
    const blocks: Block[] = [
      { kind: 'heading', text: 'Before you start' },
      { kind: 'paragraph', text: 'one two' },
      { kind: 'image', src: '/food/x.webp', alt: 'x' },
    ];
    const edit = enterAt(blocks, { blockIndex: 1, slotKey: 'text', offset: 'start' }, 'one ', 'two');

    expect(edit.blocks).toEqual([
      { kind: 'heading', text: 'Before you start' },
      { kind: 'paragraph', text: 'one ' },
      { kind: 'paragraph', text: 'two' },
      { kind: 'image', src: '/food/x.webp', alt: 'x' },
    ]);
    expect(edit.blocks[0]).toBe(blocks[0]);
    expect(edit.blocks[3]).toBe(blocks[2]);
    expect(edit.blocks[1]).not.toBe(blocks[1]);
    expect(blocks[1]).toEqual({ kind: 'paragraph', text: 'one two' });
    expect(edit.caret).toEqual({ blockIndex: 2, slotKey: 'text', offset: 'start' });
  });

  it('gives a heading a paragraph after it, never a second heading', () => {
    const edit = enterAt(
      [{ kind: 'heading', text: 'Before you start' }],
      { blockIndex: 0, slotKey: 'text', offset: 'start' },
      'Before you start',
      '',
    );
    expect(edit.blocks[1]).toEqual({ kind: 'paragraph', text: '' });
  });

  it('splits a caption without touching the photograph it belongs to', () => {
    // The head is the SAME image block with fewer words in its caption, which
    // is the only shape that lets the name -- and so the staged file -- follow
    // it. A split that emitted a fresh paragraph for the top half would leave
    // her photograph behind.
    const blocks: Block[] = [{ kind: 'image', src: '/food/x.webp', alt: 'x', caption: 'on the terrace' }];
    const edit = enterAt(blocks, { blockIndex: 0, slotKey: 'caption', offset: 'start' }, 'on the', ' terrace');
    expect(edit.blocks).toEqual([
      { kind: 'image', src: '/food/x.webp', alt: 'x', caption: 'on the' },
      { kind: 'paragraph', text: ' terrace' },
    ]);

    const { was, now } = namesAcross(blocks, edit);
    expect(now[0]).toBe(was[0]);
    expect(now[1]).not.toBe(was[0]);
  });

  it('continues a list', () => {
    const blocks: Block[] = [{ kind: 'bulletList', items: ['a', 'b'] }];
    const edit = enterAt(blocks, { blockIndex: 0, slotKey: 'items[0]', offset: 'start' }, 'a', '');
    expect(edit.blocks).toEqual([{ kind: 'bulletList', items: ['a', '', 'b'] }]);
    expect(edit.caret.slotKey).toBe('items[1]');
    // The list is one block that changed shape, so the name has to follow it
    // or every slot address inside it moves.
    expect(namesAcross(blocks, edit).now[0]).toBe(namesAcross(blocks, edit).was[0]);
  });

  it('splits a list item, rather than duplicating the words it split', () => {
    const edit = enterAt(
      [{ kind: 'numberList', items: ['one two', 'three'] }],
      { blockIndex: 0, slotKey: 'items[0]', offset: 'start' },
      'one ',
      'two',
    );
    expect(edit.blocks).toEqual([{ kind: 'numberList', items: ['one ', 'two', 'three'] }]);
  });

  it('leaves a list on an empty last item, dropping that item', () => {
    const blocks: Block[] = [
      { kind: 'bulletList', items: ['a', ''] },
      { kind: 'heading', text: 'after' },
    ];
    const edit = enterAt(blocks, { blockIndex: 0, slotKey: 'items[1]', offset: 'start' }, '', '');
    expect(edit.blocks).toEqual([
      { kind: 'bulletList', items: ['a'] },
      { kind: 'paragraph', text: '' },
      { kind: 'heading', text: 'after' },
    ]);
    expect(edit.blocks[2]).toBe(blocks[1]);
    expect(edit.caret).toEqual({ blockIndex: 1, slotKey: 'text', offset: 'start' });
  });

  it('removes a list that had only one, empty item', () => {
    const edit = enterAt(
      [{ kind: 'bulletList', items: [''] }],
      { blockIndex: 0, slotKey: 'items[0]', offset: 'start' },
      '',
      '',
    );
    expect(edit.blocks).toEqual([{ kind: 'paragraph', text: '' }]);
    expect(edit.caret).toEqual({ blockIndex: 0, slotKey: 'text', offset: 'start' });
  });

  it('does NOT leave the list on an empty item in the middle', () => {
    const edit = enterAt(
      [{ kind: 'bulletList', items: ['a', '', 'c'] }],
      { blockIndex: 0, slotKey: 'items[1]', offset: 'start' },
      '',
      '',
    );
    expect(edit.blocks).toEqual([{ kind: 'bulletList', items: ['a', '', '', 'c'] }]);
  });

  it('does NOT leave the list on the last item when that item still has words', () => {
    const edit = enterAt(
      [{ kind: 'bulletList', items: ['a', 'b'] }],
      { blockIndex: 0, slotKey: 'items[1]', offset: 'start' },
      'b',
      '',
    );
    expect(edit.blocks).toEqual([{ kind: 'bulletList', items: ['a', 'b', ''] }]);
  });

  it('leaves a stale draft’s missing block exactly as it found it', () => {
    const blocks = [null] as unknown as Block[];
    const edit = enterAt(blocks, { blockIndex: 0, slotKey: 'text', offset: 'start' }, 'a', 'b');
    expect(edit.blocks).toBe(blocks);
    expect(edit.renames).toEqual([]);
  });

  it('names exactly the one block that stood in for the one she was in', () => {
    const blocks: Block[] = [
      { kind: 'paragraph', text: 'a' },
      { kind: 'paragraph', text: 'one two' },
    ];
    const edit = enterAt(blocks, { blockIndex: 1, slotKey: 'text', offset: 'start' }, 'one ', 'two');
    expect(edit.renames).toHaveLength(1);
    expect(edit.renames[0].from).toBe(blocks[1]);
    expect(edit.renames[0].to).toBe(edit.blocks[1]);

    // And the new paragraph gets a name of its OWN. Two blocks sharing one
    // name is two slots sharing one address, which is the reorder defect from
    // the other direction.
    const { now } = namesAcross(blocks, edit);
    expect(new Set(now).size).toBe(now.length);
  });
});

describe('backspaceAtStart', () => {
  it('merges a paragraph into the paragraph above it, keeping the rest by REFERENCE', () => {
    const blocks: Block[] = [
      { kind: 'paragraph', text: 'one' },
      { kind: 'paragraph', text: 'two' },
      { kind: 'heading', text: 'after' },
    ];
    const edit = backspaceAtStart(blocks, { blockIndex: 1, slotKey: 'text', offset: 'start' });
    expect(edit?.blocks).toEqual([{ kind: 'paragraph', text: 'onetwo' }, { kind: 'heading', text: 'after' }]);
    expect(edit?.blocks[1]).toBe(blocks[2]);
    expect(edit?.caret).toEqual({ blockIndex: 0, slotKey: 'text', offset: 'end' });
    // The merged paragraph inherits the UPPER block's name, the one the caret
    // stays in.
    const { was, now } = namesAcross(blocks, edit as Edit);
    expect(now[0]).toBe(was[0]);
  });

  it('demotes a heading rather than merging it on the first press', () => {
    const edit = backspaceAtStart(
      [{ kind: 'paragraph', text: 'a' }, { kind: 'heading', text: 'B' }],
      { blockIndex: 1, slotKey: 'text', offset: 'start' },
    );
    expect(edit?.blocks).toEqual([{ kind: 'paragraph', text: 'a' }, { kind: 'paragraph', text: 'B' }]);
  });

  it('carries a quotation’s attribution into a paragraph rather than destroying it', () => {
    const edit = backspaceAtStart(
      [{ kind: 'quote', text: 'the words', attribution: 'a name' }],
      { blockIndex: 0, slotKey: 'text', offset: 'start' },
    );
    expect(edit?.blocks).toEqual([
      { kind: 'paragraph', text: 'the words' },
      { kind: 'paragraph', text: 'a name' },
    ]);
  });

  it('demotes a quotation with no attribution to one paragraph', () => {
    const edit = backspaceAtStart(
      [{ kind: 'quote', text: 'the words' }],
      { blockIndex: 0, slotKey: 'text', offset: 'start' },
    );
    expect(edit?.blocks).toEqual([{ kind: 'paragraph', text: 'the words' }]);
  });

  it('does nothing at the start of a quotation’s attribution', () => {
    // She is standing in the attribution, not in the quotation. Demoting from
    // here would rewrite a field she was not in and take the caret with it.
    expect(
      backspaceAtStart(
        [{ kind: 'quote', text: 'the words', attribution: 'a name' }],
        { blockIndex: 0, slotKey: 'attribution', offset: 'start' },
      ),
    ).toBeNull();
  });

  it('does nothing at the start of a caption, so the paragraph above cannot swallow the photograph', () => {
    const blocks: Block[] = [
      { kind: 'paragraph', text: 'a' },
      { kind: 'image', src: '/food/x.webp', alt: 'x', caption: 'on the terrace' },
    ];
    expect(backspaceAtStart(blocks, { blockIndex: 1, slotKey: 'caption', offset: 'start' })).toBeNull();
  });

  it('refuses to merge across an image, so a photo cannot vanish', () => {
    const blocks: Block[] = [
      { kind: 'image', src: '/food/x.webp', alt: 'x' },
      { kind: 'paragraph', text: 'a' },
    ];
    expect(backspaceAtStart(blocks, { blockIndex: 1, slotKey: 'text', offset: 'start' })).toBeNull();
  });

  it('steps the first list item out of its list, keeping the rest', () => {
    const blocks: Block[] = [{ kind: 'bulletList', items: ['a', 'b'] }];
    const edit = backspaceAtStart(blocks, { blockIndex: 0, slotKey: 'items[0]', offset: 'start' });
    expect(edit?.blocks).toEqual([
      { kind: 'paragraph', text: 'a' },
      { kind: 'bulletList', items: ['b'] },
    ]);
    // The list is what survived, so the list is what keeps the name -- not the
    // paragraph that stepped out of it.
    const { was, now } = namesAcross(blocks, edit as Edit);
    expect(now[1]).toBe(was[0]);
    expect(now[0]).not.toBe(was[0]);
  });

  it('steps the only item out and takes the empty list with it', () => {
    const edit = backspaceAtStart(
      [{ kind: 'numberList', items: ['a'] }],
      { blockIndex: 0, slotKey: 'items[0]', offset: 'start' },
    );
    expect(edit?.blocks).toEqual([{ kind: 'paragraph', text: 'a' }]);
  });

  it('does nothing at the start of a later list item', () => {
    expect(
      backspaceAtStart(
        [{ kind: 'bulletList', items: ['a', 'b'] }],
        { blockIndex: 0, slotKey: 'items[1]', offset: 'start' },
      ),
    ).toBeNull();
  });

  it('does nothing at the very top of the post', () => {
    expect(
      backspaceAtStart([{ kind: 'paragraph', text: 'a' }], { blockIndex: 0, slotKey: 'text', offset: 'start' }),
    ).toBeNull();
  });

  it('does nothing to a stale draft’s missing block', () => {
    const blocks = [{ kind: 'paragraph', text: 'a' }, null] as unknown as Block[];
    expect(backspaceAtStart(blocks, { blockIndex: 1, slotKey: 'text', offset: 'start' })).toBeNull();
  });
});
