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
import { backspaceAtStart, enterAt, indentAt, type Edit } from '../structure';
import { createStableNames } from '../../blocks/stable-names';
import { MAX_LIST_DEPTH, type Block } from '../../../content/types';

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

// Admin redesign Task 26. Tab and Shift+Tab, as the array transformation they
// are. What no test here can say is whether one step of nesting is legible on
// a 390px screen, or whether a Tab this refuses really does move focus out of
// the surface -- both are measurements, and both are deferred to
// e2e/writing-surface.spec.ts.
describe('indentAt', () => {
  it('nests an item under the one above it', () => {
    const blocks: Block[] = [{ kind: 'bulletList', items: ['One', 'Two'] }];
    const edit = indentAt(blocks, { blockIndex: 0, slotKey: 'items[1]', offset: 'end' }, 1);
    expect(edit?.blocks).toEqual([{ kind: 'bulletList', items: ['One', 'Two'], levels: [0, 1] }]);
    // The words are untouched and the caret has not moved: nesting is a change
    // to the shape of the list, not to what it says.
    expect(edit?.caret).toEqual({ blockIndex: 0, slotKey: 'items[1]', offset: 'end' });
  });

  it('carries the block’s name onto the new object, so a staged photograph is not orphaned', () => {
    const blocks: Block[] = [
      { kind: 'paragraph', text: 'Before' },
      { kind: 'bulletList', items: ['One', 'Two'] },
    ];
    const edit = indentAt(blocks, { blockIndex: 1, slotKey: 'items[1]', offset: 'end' }, 1);
    const { was, now } = namesAcross(blocks, edit as Edit);
    expect(now[1]).toBe(was[1]);
    // And every block it did not touch comes back as the identical object.
    expect(edit?.blocks[0]).toBe(blocks[0]);
    expect(edit?.blocks[1]).not.toBe(blocks[1]);
    expect(blocks[1]).toEqual({ kind: 'bulletList', items: ['One', 'Two'] });
  });

  it('refuses to nest the first item, which has nothing to sit under', () => {
    expect(
      indentAt([{ kind: 'bulletList', items: ['One', 'Two'] }], { blockIndex: 0, slotKey: 'items[0]', offset: 'end' }, 1),
    ).toBeNull();
  });

  it('refuses to nest more than one step below the item above it', () => {
    expect(
      indentAt(
        [{ kind: 'bulletList', items: ['One', 'Two', 'Three'] }],
        { blockIndex: 0, slotKey: 'items[2]', offset: 'end' },
        1,
      ),
    ).toEqual({
      blocks: [{ kind: 'bulletList', items: ['One', 'Two', 'Three'], levels: [0, 0, 1] }],
      caret: { blockIndex: 0, slotKey: 'items[2]', offset: 'end' },
      renames: expect.anything(),
    });
    // The item above is flat, so one press is all this item gets. A second one
    // would put it two below its neighbour, which is a depth `nest` clamps at
    // render time -- the array and the page would then disagree about which
    // item is a sub-item of which.
    expect(
      indentAt(
        [{ kind: 'bulletList', items: ['One', 'Two', 'Three'], levels: [0, 0, 1] }],
        { blockIndex: 0, slotKey: 'items[2]', offset: 'end' },
        1,
      ),
    ).toBeNull();
  });

  it('caps at MAX_LIST_DEPTH however deep the item above it is', () => {
    const blocks: Block[] = [{ kind: 'bulletList', items: ['One', 'Two', 'Three'], levels: [0, 1, 2] }];
    // Every item is already as deep as its neighbour allows, and the last one
    // is at the cap itself.
    expect(indentAt(blocks, { blockIndex: 0, slotKey: 'items[2]', offset: 'end' }, 1)).toBeNull();
    expect(MAX_LIST_DEPTH).toBe(2);
  });

  it('steps an item back out again', () => {
    const edit = indentAt(
      [{ kind: 'bulletList', items: ['One', 'Two', 'Three'], levels: [0, 1, 2] }],
      { blockIndex: 0, slotKey: 'items[2]', offset: 'end' },
      -1,
    );
    expect(edit?.blocks).toEqual([{ kind: 'bulletList', items: ['One', 'Two', 'Three'], levels: [0, 1, 1] }]);
  });

  it('removes the levels key entirely once every item is flat again', () => {
    const edit = indentAt(
      [{ kind: 'bulletList', items: ['One', 'Two'], levels: [0, 1] }],
      { blockIndex: 0, slotKey: 'items[1]', offset: 'end' },
      -1,
    );
    expect(edit?.blocks).toEqual([{ kind: 'bulletList', items: ['One', 'Two'] }]);
    // toEqual is blind to a key holding `undefined`, and that is exactly the
    // shape this rule exists to prevent: JSON.stringify drops such a key but
    // `unknownKeys` (hasOwnProperty) still sees it, so the block would be
    // refused by the boundary the key was removed to satisfy.
    expect(Object.prototype.hasOwnProperty.call(edit?.blocks[0] ?? {}, 'levels')).toBe(false);
  });

  it('refuses Shift+Tab on an item that is already flat', () => {
    expect(
      indentAt([{ kind: 'bulletList', items: ['One', 'Two'] }], { blockIndex: 0, slotKey: 'items[1]', offset: 'end' }, -1),
    ).toBeNull();
  });

  it('does nothing outside a list item', () => {
    expect(
      indentAt([{ kind: 'paragraph', text: 'One' }], { blockIndex: 0, slotKey: 'text', offset: 'end' }, 1),
    ).toBeNull();
  });

  // A recipe's ingredients and its method are `items` lists with the same slot
  // keys, and NEITHER declares `levels` in BLOCK_KEYS. Writing one onto them
  // would produce a block the write boundary refuses as carrying a key this
  // site does not use, and she would find out at Publish with no idea what she
  // had done.
  it.each(['ingredients', 'steps'])('refuses to nest inside a %s block', (kind) => {
    expect(
      indentAt(
        [{ kind, heading: 'Method', items: ['One', 'Two'] } as unknown as Block],
        { blockIndex: 0, slotKey: 'items[1]', offset: 'end' },
        1,
      ),
    ).toBeNull();
  });

  it('does nothing to a stale draft’s missing block, or to an item index it no longer has', () => {
    const stale = [null] as unknown as Block[];
    expect(indentAt(stale, { blockIndex: 0, slotKey: 'items[0]', offset: 'end' }, 1)).toBeNull();
    expect(
      indentAt(
        [{ kind: 'bulletList', items: ['One', 'Two'] }],
        { blockIndex: 0, slotKey: 'items[7]', offset: 'end' },
        1,
      ),
    ).toBeNull();
  });

  // A draft restored from localStorage reaches here through an unchecked cast,
  // so `levels` need not be an array, need not be the right length and need not
  // hold numbers. None of those may throw inside the Posts panel -- the
  // nearest error boundary is per-SECTION -- and none may be written back out
  // in the shape it arrived in, because both boundaries refuse it.
  it('reads a corrupted levels array as flat rather than throwing', () => {
    const blocks = [{ kind: 'bulletList', items: ['One', 'Two'], levels: 'nonsense' }] as unknown as Block[];
    const edit = indentAt(blocks, { blockIndex: 0, slotKey: 'items[1]', offset: 'end' }, 1);
    expect(edit?.blocks).toEqual([{ kind: 'bulletList', items: ['One', 'Two'], levels: [0, 1] }]);
  });

  it('replaces a levels array of the wrong length with one that matches the items', () => {
    const blocks = [{ kind: 'numberList', items: ['One', 'Two', 'Three'], levels: [0] }] as unknown as Block[];
    const edit = indentAt(blocks, { blockIndex: 0, slotKey: 'items[1]', offset: 'end' }, 1);
    expect(edit?.blocks).toEqual([{ kind: 'numberList', items: ['One', 'Two', 'Three'], levels: [0, 1, 0] }]);
  });
});

// The parallel array's whole cost, and the reason every edit that changes the
// LENGTH of `items` goes through one helper: both boundaries refuse a block
// whose two arrays disagree, so a split that grew one of them alone would
// leave her unable to publish the post at all. Nothing on screen would say
// why, because nothing on screen shows a `levels`.
describe('levels stay in step with items', () => {
  const lengths = (block: Block) => [
    (block as unknown as { items: unknown[] }).items.length,
    (block as unknown as { levels?: unknown[] }).levels?.length,
  ];

  it('splits a nested item into two nested items', () => {
    const edit = enterAt(
      [{ kind: 'bulletList', items: ['One', 'Two three'], levels: [0, 1] }],
      { blockIndex: 0, slotKey: 'items[1]', offset: 'start' },
      'Two ',
      'three',
    );
    expect(edit.blocks[0]).toEqual({ kind: 'bulletList', items: ['One', 'Two ', 'three'], levels: [0, 1, 1] });
    expect(lengths(edit.blocks[0])).toEqual([3, 3]);
  });

  it('shortens both arrays when Enter on an empty last item leaves the list', () => {
    const edit = enterAt(
      [{ kind: 'bulletList', items: ['One', 'Two', ''], levels: [0, 1, 1] }],
      { blockIndex: 0, slotKey: 'items[2]', offset: 'start' },
      '',
      '',
    );
    expect(edit.blocks[0]).toEqual({ kind: 'bulletList', items: ['One', 'Two'], levels: [0, 1] });
    expect(edit.blocks[1]).toEqual({ kind: 'paragraph', text: '' });
  });

  it('shortens both arrays when the first item steps out of the list', () => {
    const edit = backspaceAtStart(
      [{ kind: 'bulletList', items: ['One', 'Two', 'Three'], levels: [0, 1, 1] }],
      { blockIndex: 0, slotKey: 'items[0]', offset: 'start' },
    );
    // What was nested under the item that just left steps up with it: the list
    // that remains has no item above its first one for that one to sit under.
    expect(edit?.blocks).toEqual([
      { kind: 'paragraph', text: 'One' },
      { kind: 'bulletList', items: ['Two', 'Three'], levels: [0, 1] },
    ]);
  });

  it('drops the levels key when what is left of the list is flat', () => {
    const edit = backspaceAtStart(
      [{ kind: 'bulletList', items: ['One', 'Two'], levels: [0, 1] }],
      { blockIndex: 0, slotKey: 'items[0]', offset: 'start' },
    );
    expect(edit?.blocks[1]).toEqual({ kind: 'bulletList', items: ['Two'] });
    expect(Object.prototype.hasOwnProperty.call(edit?.blocks[1] ?? {}, 'levels')).toBe(false);
  });

  it('leaves an ingredients list without a levels key of its own', () => {
    const edit = enterAt(
      [{ kind: 'ingredients', heading: 'What you need', items: ['Flour', 'Eggs'] }],
      { blockIndex: 0, slotKey: 'items[0]', offset: 'start' },
      'Fl',
      'our',
    );
    expect(edit.blocks[0]).toEqual({ kind: 'ingredients', heading: 'What you need', items: ['Fl', 'our', 'Eggs'] });
    expect(Object.prototype.hasOwnProperty.call(edit.blocks[0], 'levels')).toBe(false);
  });
});
