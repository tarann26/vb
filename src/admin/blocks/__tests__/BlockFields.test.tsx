import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockFields from '../BlockFields';
import { NO_IMAGE_PREVIEWS } from '../../previews';
import { BLOCK_KEYS, BLOCK_KINDS } from '../../../content/guards';
import type { Block, BlockKind } from '../../../content/types';
import type { ValidationProblem } from '../../../content/validate';

// Fixtures that appear nowhere in src/content/posts.json: a fixture equal to
// the real committed content cannot distinguish a real binding from a
// hardcoded copy of that same value, which was Phase 4's root cause.
const EVERY_BLOCK: Record<BlockKind, Block> = {
  paragraph: { kind: 'paragraph', text: 'Rest the **dough** for an hour.' },
  heading: { kind: 'heading', text: 'Before you start' },
  bulletList: { kind: 'bulletList', items: ['A wide bowl', 'A bench scraper'] },
  numberList: { kind: 'numberList', items: ['Mix', 'Knead', 'Rest'] },
  image: { kind: 'image', src: '/food/tielle.webp', alt: 'A tielle, sliced', caption: 'Tielle, *sliced*' },
  gallery: {
    kind: 'gallery',
    images: [
      { src: '/food/tielle.webp', alt: 'A tielle' },
      { src: '/food/tiramisu.webp', alt: 'A tiramisu' },
    ],
  },
  quote: { kind: 'quote', text: 'Slow down, stay awhile.', attribution: 'Chef Kamalika' },
  ingredients: { kind: 'ingredients', heading: 'What you need', items: ['400g 00 flour', '4 eggs'] },
  steps: { kind: 'steps', heading: 'How to make it', items: ['Make a well', 'Break in the eggs'] },
  citation: { kind: 'citation', publication: 'A Magazine', url: 'https://example.com/a', date: '2026-03-04' },
};

// The `field` shape validatePosts really emits for this block, so a test's
// problem strings are the validator's strings and not a second convention.
function renderFields(block: Block, problems: ValidationProblem[] = [], entryNumber?: number) {
  const onChange = vi.fn();
  const onStaged = vi.fn();
  const view = render(
    <BlockFields
      block={block}
      onChange={onChange}
      idPrefix="posts-0-block-0"
      problemsFor={(key) => problems.filter((problem) => problem.field === `[0].blocks[0].${key}`)}
      previews={NO_IMAGE_PREVIEWS}
      onStaged={onStaged}
      previewKeyPrefix="posts.json:fixture-a:blocks[0]"
      entryNumber={entryNumber}
    />,
  );
  return { ...view, onChange, onStaged };
}

describe('BlockFields covers every kind', () => {
  // Derived from BLOCK_KINDS, so an eleventh kind added to the model with no
  // fixture and no branch fails HERE rather than rendering a block she can
  // insert and cannot edit.
  it('has a fixture and at least one control for every kind in BLOCK_KINDS', () => {
    expect(Object.keys(EVERY_BLOCK).sort()).toEqual([...BLOCK_KINDS].sort());
    BLOCK_KINDS.forEach((kind) => {
      const { container, unmount } = renderFields(EVERY_BLOCK[kind]);
      const controls = container.querySelectorAll('input, textarea, select, button');
      expect(controls.length, `${kind} rendered no control`).toBeGreaterThan(0);
      unmount();
    });
  });

  // The completeness check the one above cannot make: a kind whose branch
  // renders SOME controls but forgets a field. Derived from BLOCK_KEYS
  // (guards.ts), minus the discriminant, so a field added to a kind without a
  // control fails here.
  //
  // A `>=`, not an `=`, and knowingly weaker for it: a list kind declares one
  // key (`items`) and renders one label PER ITEM, so an equality would be
  // wrong by construction. It still catches the failure it is for -- a kind
  // with three declared keys and two labels -- and the message names both
  // numbers so a red is readable. The per-kind cases below are what actually
  // pin each field, and BlockList.test.tsx's own placement table is what pins
  // that every declared key can carry a message.
  it('every key a block kind declares has a control, except the discriminant', () => {
    BLOCK_KINDS.forEach((kind) => {
      const { container, unmount } = renderFields(EVERY_BLOCK[kind]);
      const labels = [...container.querySelectorAll('label')].map((el) => el.textContent ?? '');
      const expected = Object.keys(BLOCK_KEYS[kind]).filter((key) => key !== 'kind');
      expect(
        labels.length,
        `${kind}: ${expected.length} fields declared, ${labels.length} labels rendered`,
      ).toBeGreaterThanOrEqual(expected.length);
      unmount();
    });
  });
});

describe('each kind renders its own fields', () => {
  it('paragraph is one markdown textarea, unparsed', () => {
    renderFields(EVERY_BLOCK.paragraph);
    expect(screen.getByLabelText('Words')).toHaveValue('Rest the **dough** for an hour.');
    // The asterisks are VISIBLE here, on purpose: this is the source she
    // edits, not the rendered post. blocks.tsx is what turns them into
    // <strong>, and Inline.tsx is what guarantees no HTML string is involved.
    expect(screen.getByLabelText('Words').tagName.toLowerCase()).toBe('textarea');
  });

  it('heading is its own label, not "Words"', () => {
    renderFields(EVERY_BLOCK.heading);
    expect(screen.getByLabelText('Heading')).toHaveValue('Before you start');
    expect(screen.queryByLabelText('Words')).toBeNull();
  });

  it('typing in a paragraph hands back the whole block', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields({ kind: 'paragraph', text: '' });
    await user.type(screen.getByLabelText('Words'), 'A');
    expect(onChange).toHaveBeenCalledWith({ kind: 'paragraph', text: 'A' });
  });

  it('a list renders one field per item, plus an Add', () => {
    renderFields(EVERY_BLOCK.numberList);
    expect(screen.getByLabelText('Item 1')).toHaveValue('Mix');
    expect(screen.getByLabelText('Item 2')).toHaveValue('Knead');
    expect(screen.getByLabelText('Item 3')).toHaveValue('Rest');
    expect(screen.getByRole('button', { name: 'Add an item' })).toBeInTheDocument();
  });

  it('Add appends an empty item and hands back the whole block', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields(EVERY_BLOCK.bulletList);
    await user.click(screen.getByRole('button', { name: 'Add an item' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'bulletList', items: ['A wide bowl', 'A bench scraper', ''] });
  });

  it('a list item moves and the whole block is handed back', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields(EVERY_BLOCK.numberList);
    await user.click(screen.getByRole('button', { name: 'Move Item 1 down' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'numberList', items: ['Knead', 'Mix', 'Rest'] });
  });

  it('a list item is removed by position, not by value', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields(EVERY_BLOCK.numberList);
    await user.click(screen.getByRole('button', { name: 'Remove Item 2' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'numberList', items: ['Mix', 'Rest'] });
  });

  // Backlog item 13. `items` and `levels` are parallel arrays and every write
  // boundary refuses a pair whose lengths disagree -- which she meets as "your
  // edit was rejected", about a shape she never saw. These pin that the two
  // move together whichever control she presses.
  it('commits items and levels together', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields({ kind: 'bulletList', items: ['a', 'b'], levels: [0, 1] });
    await user.click(screen.getByRole('button', { name: 'Add an item' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'bulletList', items: ['a', 'b', ''], levels: [0, 1, 0] });
  });

  it('keeps the two arrays the same length however the list is edited', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields({ kind: 'numberList', items: ['a', 'b', 'c'], levels: [0, 1, 2] });
    await user.click(screen.getByRole('button', { name: 'Remove Item 2' }));
    const next = onChange.mock.calls[0][0] as { items: string[]; levels: number[] };
    expect(next.items).toHaveLength(next.levels.length);
    expect(next.levels).toEqual([0, 2]);
  });

  it('carries the levels across a move, so a nested item stays nested', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields({ kind: 'bulletList', items: ['a', 'b'], levels: [0, 1] });
    await user.click(screen.getByRole('button', { name: 'Move Item 1 down' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'bulletList', items: ['b', 'a'], levels: [1, 0] });
  });

  // `levels` is DELETED rather than written flat once nothing is nested: an
  // own key holding a value this site's committed lists do not carry is still
  // SEEN by `unknownKeys`, so the block would be refused by the very boundary
  // the key was removed to satisfy.
  it('drops the levels key entirely once every item is flat again', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields({ kind: 'bulletList', items: ['a', 'b'], levels: [0, 1] });
    await user.click(screen.getByRole('button', { name: 'Remove Item 2' }));
    const next = onChange.mock.calls[0][0] as object;
    expect(next).toEqual({ kind: 'bulletList', items: ['a'] });
    expect(Object.prototype.hasOwnProperty.call(next, 'levels')).toBe(false);
  });

  // A recipe's ingredients and its method are `items` lists spelled the same
  // way, and neither declares `levels` -- writing one onto them produces a
  // block the write boundary refuses. The shared renderer passes a flat array
  // in and those two call sites drop it again on the way out.
  it('never writes a levels key onto a recipe list', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields(EVERY_BLOCK.ingredients);
    await user.click(screen.getByRole('button', { name: 'Add an ingredient' }));
    const next = onChange.mock.calls[0][0] as object;
    expect(Object.prototype.hasOwnProperty.call(next, 'levels')).toBe(false);
  });

  // RecordList's own rule, applied to the inner list: a control that reads as
  // live and does nothing is worse than no control.
  it('Up is omitted on the first item and Down on the last', () => {
    renderFields(EVERY_BLOCK.numberList);
    expect(screen.queryByRole('button', { name: 'Move Item 1 up' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Item 1 down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Item 3 up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Item 3 down' })).toBeNull();
  });

  it('image has a photo picker, a description and an optional caption', () => {
    renderFields(EVERY_BLOCK.image);
    expect(screen.getByLabelText('Photo')).toBeInTheDocument();
    expect(screen.getByLabelText('Photo description')).toHaveValue('A tielle, sliced');
    expect(screen.getByLabelText('Words underneath (optional)')).toHaveValue('Tielle, *sliced*');
  });

  // "Photo 1" on a post with one photo is worse than "Photo", because the
  // number implies a second one -- so the overwhelmingly common single-photo
  // post has to keep the plain word whether `entryNumber` arrives as 1 or is
  // omitted entirely.
  it('one photo entry is just Photo', () => {
    renderFields(EVERY_BLOCK.image, [], 1);
    expect(screen.getByLabelText('Photo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Photo 1')).toBeNull();
  });

  it('the second photo entry in a post is Photo 2', () => {
    renderFields(EVERY_BLOCK.image, [], 2);
    expect(screen.getByLabelText('Photo 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Photo')).toBeNull();
  });

  // The landmine this project has already defused once, now at the EDIT
  // boundary: caption and attribution are optional in BlockContentMap, so a
  // committed block may not carry the key at all. The fixture has the key
  // GENUINELY ABSENT -- `caption: ''` does not test absence, which is the
  // mistake this repository made twice.
  //
  // The second assertion is what distinguishes `?? ''` from a cast, and the
  // reason it is here is that the obvious one does not: `undefined` handed to
  // a textarea's `value` produces an empty box in jsdom too, so
  // `toHaveValue('')` alone passes on the defect. What it really produces is an
  // UNCONTROLLED textarea -- and an uncontrolled one keeps whatever she typed
  // even when the parent commits nothing, while a controlled one snaps back to
  // its prop. `onChange` here is a spy that commits nothing, so the snap-back
  // is observable and the two cases are told apart.
  it('an image with no caption key renders an empty caption box, and it is controlled', async () => {
    const user = userEvent.setup();
    const noCaption = { kind: 'image', src: '/food/tielle.webp', alt: 'A tielle' } as Block;
    expect('caption' in noCaption).toBe(false);
    const { onChange } = renderFields(noCaption);
    const caption = screen.getByLabelText('Words underneath (optional)');
    expect(caption).toHaveValue('');
    await user.type(caption, 'X');
    expect(onChange).toHaveBeenCalledWith({ kind: 'image', src: '/food/tielle.webp', alt: 'A tielle', caption: 'X' });
    expect(caption).toHaveValue('');
  });

  // The same landmine on a REQUIRED key, which is the shape a draft saved
  // before this feature existed genuinely restores with -- `{ kind:
  // 'paragraph' }`, no `text` at all, straight through registerLoaded's
  // unchecked cast. Told apart from a cast by the same snap-back the two
  // optional-key cases above use, and by the toolbar: `surround` reads
  // `value.slice`, so an undefined value turns the Bold button into a thrown
  // TypeError the moment she uses it to start writing.
  it('a paragraph with no text key renders an empty box, and it is controlled', async () => {
    const user = userEvent.setup();
    const noText = { kind: 'paragraph' } as Block;
    expect('text' in noText).toBe(false);
    const { onChange } = renderFields(noText);
    const words = screen.getByLabelText('Words');
    expect(words).toHaveValue('');
    await user.type(words, 'X');
    expect(onChange).toHaveBeenCalledWith({ kind: 'paragraph', text: 'X' });
    expect(words).toHaveValue('');

    // And Bold still works on it: she turns bold on and types, which is what
    // that button does with nothing selected.
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'paragraph', text: '****' });
  });

  it('a quote with no attribution key renders an empty box, and it is controlled', async () => {
    const user = userEvent.setup();
    const noAttribution = { kind: 'quote', text: 'Just the words.' } as Block;
    expect('attribution' in noAttribution).toBe(false);
    const { onChange } = renderFields(noAttribution);
    const attribution = screen.getByLabelText('Who said it (optional)');
    expect(attribution).toHaveValue('');
    await user.type(attribution, 'X');
    expect(onChange).toHaveBeenCalledWith({ kind: 'quote', text: 'Just the words.', attribution: 'X' });
    expect(attribution).toHaveValue('');
  });

  it('quote has both its fields, each bound to its own value', () => {
    renderFields(EVERY_BLOCK.quote);
    expect(screen.getByLabelText('The words being quoted')).toHaveValue('Slow down, stay awhile.');
    expect(screen.getByLabelText('Who said it (optional)')).toHaveValue('Chef Kamalika');
  });

  it('citation binds all three of its fields', () => {
    renderFields(EVERY_BLOCK.citation);
    expect(screen.getByLabelText('Publication')).toHaveValue('A Magazine');
    expect(screen.getByLabelText('Link')).toHaveValue('https://example.com/a');
    expect(screen.getByLabelText('Date on the original')).toHaveValue('2026-03-04');
  });

  it('citation clearing the link commits null, never an empty string', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields(EVERY_BLOCK.citation);
    await user.clear(screen.getByLabelText('Link'));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'citation',
      publication: 'A Magazine',
      url: null,
      date: '2026-03-04',
    });
  });

  it('citation keeps a real link she types', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields({ kind: 'citation', publication: 'A Magazine', url: null, date: '2026-03-04' });
    await user.type(screen.getByLabelText('Link'), 'h');
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'citation',
      publication: 'A Magazine',
      url: 'h',
      date: '2026-03-04',
    });
  });

  it('gallery renders one picker and one description per photo', () => {
    renderFields(EVERY_BLOCK.gallery);
    expect(screen.getByLabelText('Photo 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Photo 2')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Photo description')).toHaveLength(2);
  });

  it('gallery Add appends a blank photo, and Remove takes one out by position', async () => {
    const user = userEvent.setup();
    const { onChange, unmount } = renderFields(EVERY_BLOCK.gallery);
    await user.click(screen.getByRole('button', { name: 'Add a photo' }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'gallery',
      images: [
        { src: '/food/tielle.webp', alt: 'A tielle' },
        { src: '/food/tiramisu.webp', alt: 'A tiramisu' },
        { src: '', alt: '' },
      ],
    });
    unmount();

    const second = renderFields(EVERY_BLOCK.gallery);
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(second.onChange).toHaveBeenLastCalledWith({
      kind: 'gallery',
      images: [{ src: '/food/tiramisu.webp', alt: 'A tiramisu' }],
    });
  });

  it('editing one gallery photo’s description leaves the other alone', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields(EVERY_BLOCK.gallery);
    await user.type(screen.getAllByLabelText('Photo description')[1], '!');
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'gallery',
      images: [
        { src: '/food/tielle.webp', alt: 'A tielle' },
        { src: '/food/tiramisu.webp', alt: 'A tiramisu!' },
      ],
    });
  });

  // Their headings are named after the block they belong to, not both "Heading"
  // and not both the same thing -- BlockList.test.tsx's duplicate-label scan is
  // what enforces that across a whole post; this pins the actual words.
  it('ingredients and steps each have their own heading and their own noun', () => {
    const { unmount } = renderFields(EVERY_BLOCK.ingredients);
    expect(screen.getByLabelText('Heading for the ingredients')).toHaveValue('What you need');
    // A plain <input>, never InlineTextField's markdown textarea. types.ts
    // types this heading `string` and not InlineText, and blocks.tsx draws it
    // with no markdown around it -- so a markdown control here would let her
    // make a word bold and publish the asterisks as asterisks. `toHaveValue`
    // alone cannot tell the two controls apart.
    expect(screen.getByLabelText('Heading for the ingredients').tagName.toLowerCase()).toBe('input');
    expect(screen.getByLabelText('Ingredient 1')).toHaveValue('400g 00 flour');
    expect(screen.getByRole('button', { name: 'Add an ingredient' })).toBeInTheDocument();
    unmount();
    renderFields(EVERY_BLOCK.steps);
    expect(screen.getByLabelText('Heading for the method')).toHaveValue('How to make it');
    expect(screen.getByLabelText('Heading for the method').tagName.toLowerCase()).toBe('input');
    expect(screen.getByLabelText('Step 1')).toHaveValue('Make a well');
    expect(screen.getByRole('button', { name: 'Add a step' })).toBeInTheDocument();
  });

  it('an empty list shows the validator’s own message where the items would be', () => {
    renderFields({ kind: 'bulletList', items: [] }, [
      { field: '[0].blocks[0].items', message: 'needs at least one list item' },
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('needs at least one list item');
  });

  it('an empty gallery shows the validator’s own message where the photos would be', () => {
    renderFields({ kind: 'gallery', images: [] }, [
      { field: '[0].blocks[0].images', message: 'a gallery needs at least one photo' },
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('a gallery needs at least one photo');
  });

  it('a per-item problem lands on that item, not on the list', () => {
    renderFields(EVERY_BLOCK.numberList, [
      { field: '[0].blocks[0].items[1]', message: 'this step needs some words' },
    ]);
    expect(screen.getByLabelText('Item 2')).toHaveAttribute('aria-describedby', 'posts-0-block-0-items-1-error');
    expect(screen.getByLabelText('Item 1')).not.toHaveAttribute('aria-describedby');
  });

  // A stale draft can restore a list key that is not an array at all, through
  // registerLoaded's unchecked cast. The only error boundary between here and
  // the page is per-SECTION, so an unguarded `.map` would take the Posts
  // panel's heading down with it -- the Phase 4 defect verbatim. Asserted
  // through what is on screen and what an Add commits, never through
  // `not.toThrow()`.
  it('a list whose items key is not an array renders an Add button that repairs it', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields({ kind: 'bulletList', items: undefined } as unknown as Block);
    expect(screen.queryByLabelText('Item 1')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add an item' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'bulletList', items: [''] });
  });

  it('a gallery whose images key is not an array renders an Add button that repairs it', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields({ kind: 'gallery', images: null } as unknown as Block);
    expect(screen.queryByLabelText('Photo 1')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add a photo' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'gallery', images: [{ src: '', alt: '' }] });
  });

  // Two posts' block 0 must not produce the same input id, or a `<label for>`
  // click lands in the wrong post entirely -- RecordForm's own `scope` prop
  // exists for exactly this defect, one level up.
  it('every generated id starts with the prefix it was given', () => {
    const { container } = renderFields(EVERY_BLOCK.image);
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    ids.forEach((id) => expect(id.startsWith('posts-0-block-0')).toBe(true));
  });

  // Every photo in a grid gets its own picker id, so a `<label for>` click on
  // "Photo 2" cannot land on photo 1's input. The staged-bytes key those
  // pickers report under is a whole chain (PhotoField, BlockFields, BlockList,
  // PostList, EditMode) and Task 10 owns the test for it.
  it('each gallery photo has its own picker id', () => {
    const { container } = renderFields(EVERY_BLOCK.gallery);
    expect(container.querySelector('#posts-0-block-0-images-0-src')).not.toBeNull();
    expect(container.querySelector('#posts-0-block-0-images-1-src')).not.toBeNull();
  });
});
