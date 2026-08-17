import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockList, { type BlockListProps } from '../BlockList';
import { BLOCK_KIND_LABELS, UNKNOWN_BLOCK_MESSAGE } from '../block-meta';
import { NO_IMAGE_PREVIEWS } from '../../previews';
import { BLOCK_KEYS, BLOCK_KINDS } from '../../../content/guards';
import type { Block, BlockKind } from '../../../content/types';

// Two paragraphs on purpose: the ambiguity the positional labels exist for is
// only reachable with a repeated kind, and a recipe has two paragraphs more
// often than not.
const BLOCKS: Block[] = [
  { kind: 'heading', text: 'First' },
  { kind: 'paragraph', text: 'Second' },
  { kind: 'paragraph', text: 'Third' },
];

// Nothing here appears in src/content/posts.json: a fixture equal to the real
// committed content cannot tell a real binding from a hardcoded copy of it,
// which was Phase 4's root cause.
const EVERY_BLOCK: Record<BlockKind, Block> = {
  paragraph: { kind: 'paragraph', text: 'Rest the dough for an hour.' },
  heading: { kind: 'heading', text: 'Before you start' },
  bulletList: { kind: 'bulletList', items: ['A wide bowl'] },
  numberList: { kind: 'numberList', items: ['Mix'] },
  image: { kind: 'image', src: '/food/tielle.webp', alt: 'A tielle, sliced', caption: 'Tielle' },
  gallery: { kind: 'gallery', images: [{ src: '/food/tielle.webp', alt: 'A tielle' }] },
  quote: { kind: 'quote', text: 'Slow down, stay awhile.', attribution: 'Chef Kamalika' },
  ingredients: { kind: 'ingredients', heading: 'What you need', items: ['400g 00 flour'] },
  steps: { kind: 'steps', heading: 'How to make it', items: ['Make a well'] },
  citation: { kind: 'citation', publication: 'A Magazine', url: 'https://example.com/a', date: '2026-03-04' },
};

function renderList(overrides: Partial<BlockListProps> = {}) {
  const onChange = vi.fn();
  const view = render(
    <BlockList
      blocks={BLOCKS}
      postIndex={0}
      onChange={onChange}
      problems={[]}
      previews={NO_IMAGE_PREVIEWS}
      onStaged={vi.fn()}
      previewKeyPrefix="posts.json:fixture-a"
      {...overrides}
    />,
  );
  return { ...view, onChange };
}

// How many leaf elements show exactly this message. The same technique
// PostList.test.tsx uses for its own partition, and for the same reason: "on
// screen exactly once" is the only assertion that catches a message shown
// twice AND a message lost, and those are the two failures a problem-routing
// component has.
function messageHits(container: HTMLElement, message: string): number {
  return [...container.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent === message,
  ).length;
}

describe('BlockList', () => {
  it('labels each block by kind AND position, so two paragraphs are distinguishable', () => {
    renderList();
    expect(screen.getByRole('button', { name: 'Remove Paragraph block 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Paragraph block 3' })).toBeInTheDocument();
  });

  // Scoped to the block's own <li>, not to the whole render, and the scope is
  // load-bearing rather than tidiness: the picker under the list offers every
  // kind under the same name, so an unscoped getByText finds two "Numbered
  // list" nodes and throws on the ambiguity instead of asserting anything. The
  // claim is about the strip over THIS block, so the query says so. Narrowed
  // rather than counted -- a bare count of matches would go stale the moment
  // the picker gains or loses a button.
  it('names each block on screen in her words, not the model’s', () => {
    renderList({ blocks: [EVERY_BLOCK.numberList, EVERY_BLOCK.citation] });
    const [numberList, citation] = screen.getAllByRole('listitem');
    expect(within(numberList).getByText(BLOCK_KIND_LABELS.numberList)).toBeInTheDocument();
    expect(within(citation).getByText(BLOCK_KIND_LABELS.citation)).toBeInTheDocument();
    // Nowhere on screen, which is a claim about the whole render rather than
    // about one block -- so this one is deliberately NOT scoped. queryAllBy,
    // not queryBy: with the picker offering every kind too, a label that
    // regressed to the model's own identifier would appear twice, and
    // queryByText throws on that instead of failing on it.
    expect(screen.queryAllByText('numberList')).toEqual([]);
  });

  // Two blocks whose fields would collide if either label were the other's.
  // The per-kind cases in BlockFields.test.tsx render one block at a time and
  // structurally cannot see this: getByLabelText throws on a duplicate, so a
  // shared label reads as a broken query rather than as the ambiguity it is --
  // and a `<label for>` click or a screen reader cannot tell the two apart
  // either. The same argument the positional block labels rest on.
  it('no two controls on one post share a label', () => {
    const { container } = renderList({
      blocks: [EVERY_BLOCK.heading, EVERY_BLOCK.ingredients, EVERY_BLOCK.steps, EVERY_BLOCK.paragraph],
    });
    const labels = [...container.querySelectorAll('label')].map((el) => el.textContent ?? '');
    const duplicated = labels.filter((label, i) => labels.indexOf(label) !== i);
    expect(duplicated, `these labels appear more than once: ${[...new Set(duplicated)].join(', ')}`).toEqual([]);
  });

  it('Up is omitted on the first block and Down on the last', () => {
    renderList();
    expect(screen.queryByRole('button', { name: 'Move Heading block 1 up' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Heading block 1 down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Paragraph block 3 up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Paragraph block 3 down' })).toBeNull();
  });

  it('Down hands back the whole reordered list', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move Heading block 1 down' }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'paragraph', text: 'Second' },
      { kind: 'heading', text: 'First' },
      { kind: 'paragraph', text: 'Third' },
    ]);
  });

  it('Up hands back the whole reordered list', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move Paragraph block 3 up' }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'heading', text: 'First' },
      { kind: 'paragraph', text: 'Third' },
      { kind: 'paragraph', text: 'Second' },
    ]);
  });

  // The reorder, asserted through what she would then SEE rather than only
  // through the callback. A controlled list re-rendered with the order it
  // asked for has to move the fields too, and the callback assertion above
  // passes whether or not it does.
  it('re-rendered with the order it asked for, the fields have moved', async () => {
    const user = userEvent.setup();
    const { onChange, rerender } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move Heading block 1 down' }));
    const next = onChange.mock.calls[0][0] as Block[];
    rerender(
      <BlockList
        blocks={next}
        postIndex={0}
        onChange={onChange}
        problems={[]}
        previews={NO_IMAGE_PREVIEWS}
        onStaged={vi.fn()}
        previewKeyPrefix="posts.json:fixture-a"
      />,
    );
    expect(document.getElementById('posts-0-block-0-text')).toHaveValue('Second');
    expect(document.getElementById('posts-0-block-1-text')).toHaveValue('First');
  });

  it('Remove hands back the list without that block', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.click(screen.getByRole('button', { name: 'Remove Paragraph block 2' }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'heading', text: 'First' },
      { kind: 'paragraph', text: 'Third' },
    ]);
  });

  it('editing one block’s field hands back the whole list with only that block changed', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await user.type(document.getElementById('posts-0-block-2-text') as HTMLElement, '!');
    expect(onChange).toHaveBeenLastCalledWith([
      { kind: 'heading', text: 'First' },
      { kind: 'paragraph', text: 'Second' },
      { kind: 'paragraph', text: 'Third!' },
    ]);
  });

  it('picking a kind appends a blank block of that kind', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList({ blocks: [{ kind: 'heading', text: 'First' }] });
    await user.click(screen.getByRole('button', { name: new RegExp(BLOCK_KIND_LABELS.numberList) }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'heading', text: 'First' },
      { kind: 'numberList', items: [''] },
    ]);
  });

  // The case "she could not get stuck" is actually measured against: an empty
  // post shows the validator's "has nothing in it yet" message AND the ten
  // things she could add, in the same view.
  it('the picker is offered even when the post has no blocks at all', () => {
    renderList({ blocks: [] });
    expect(screen.getByRole('button', { name: new RegExp(BLOCK_KIND_LABELS.paragraph) })).toBeInTheDocument();
  });
});

describe('BlockList puts every problem where she will find it', () => {
  it('a problem lands on its own block’s own field', () => {
    renderList({
      problems: [{ field: '[0].blocks[1].text', message: 'this paragraph needs some words' }],
    });
    const field = document.getElementById('posts-0-block-1-text');
    expect(field).toHaveAttribute('aria-describedby', 'posts-0-block-1-text-error');
    expect(screen.getByRole('alert')).toHaveTextContent('this paragraph needs some words');
    // And not on the block next to it.
    expect(document.getElementById('posts-0-block-2-text')).not.toHaveAttribute('aria-describedby');
  });

  it('ignores another post’s block problems entirely', () => {
    const { container } = renderList({
      postIndex: 0,
      problems: [{ field: '[4].blocks[1].text', message: 'a different post’s problem' }],
    });
    expect(messageHits(container, 'a different post’s problem')).toBe(0);
  });

  it('a problem naming a block that no longer exists goes in the banner', () => {
    renderList({
      problems: [{ field: '[0].blocks[9].text', message: 'a stale indexed problem' }],
    });
    expect(screen.getByRole('alert', { name: 'Problems with this post’s content' })).toHaveTextContent(
      'a stale indexed problem',
    );
  });

  it('the list-level message goes in the banner, which is the only place it can go', () => {
    renderList({
      blocks: [],
      problems: [{ field: '[0].blocks', message: 'this post has nothing in it yet' }],
    });
    expect(screen.getByRole('alert', { name: 'Problems with this post’s content' })).toHaveTextContent(
      'this post has nothing in it yet',
    );
  });

  // The partition, over every key the model declares. Derived from BLOCK_KEYS,
  // so a key added to a kind with no home on screen fails HERE -- which is the
  // completeness the label-counting case in BlockFields.test.tsx admits it
  // cannot check.
  const PLACEMENT: [BlockKind, string][] = BLOCK_KINDS.flatMap((kind) => {
    const declared = Object.keys(BLOCK_KEYS[kind]).filter((key) => key !== 'kind');
    const indexed = declared.flatMap((key) => {
      if (key === 'items') return ['items[0]'];
      if (key === 'images') return ['images[0].src', 'images[0].alt'];
      return [];
    });
    return [...declared, ...indexed].map((key) => [kind, key] as [BlockKind, string]);
  });

  it.each(PLACEMENT)('a %s block’s "%s" message is on screen exactly once', (kind, key) => {
    const message = `something is wrong with ${key}`;
    const { container } = renderList({
      blocks: [EVERY_BLOCK[kind]],
      problems: [{ field: `[0].blocks[0].${key}`, message }],
    });
    expect(messageHits(container, message)).toBe(1);
  });

  // The three shapes that reach a rendered block carrying a key no field of it
  // asks for. Each one is a total, silent loss without the per-block
  // catch-all -- the failure RecordList's own unclaimedProblems comment calls
  // worse than a message in the wrong place.
  it.each([
    ['the block’s own kind', 'kind'],
    ['a key this site dropped', 'level'],
    ['a list position she has since cut', 'items[9]'],
  ])('%s still reaches her, exactly once', (_what, key) => {
    const message = `something is wrong with ${key}`;
    const { container } = renderList({
      blocks: [EVERY_BLOCK.numberList],
      problems: [{ field: `[0].blocks[0].${key}`, message }],
    });
    expect(messageHits(container, message)).toBe(1);
  });

  it('a gallery photo she has since removed still reaches her, exactly once', () => {
    const message = 'a gallery photo needs a description';
    const { container } = renderList({
      blocks: [EVERY_BLOCK.gallery],
      problems: [{ field: '[0].blocks[0].images[9].alt', message }],
    });
    expect(messageHits(container, message)).toBe(1);
  });
});

describe('BlockList reads a restored draft defensively', () => {
  // A draft saved before this feature restores with no `blocks` key at all
  // through registerLoaded's unchecked cast, and the only error boundary
  // between here and the page is per-SECTION -- so an unguarded read would
  // take the Posts panel's heading down with it, which is the Phase 4 defect
  // verbatim.
  //
  // Asserted through what rendered, not through `not.toThrow()`: render()
  // itself fails the test if the component throws, and this then pins that it
  // rendered an empty list rather than something broken.
  it('a post whose blocks key is absent renders an empty list', () => {
    const { container } = renderList({ blocks: undefined as unknown as Block[] });
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(container.querySelector('ul')).not.toBeNull();
  });

  it('the list-level message still reaches her when the blocks key is absent', () => {
    renderList({
      blocks: undefined as unknown as Block[],
      problems: [{ field: '[0].blocks', message: 'this post has nothing in it yet' }],
    });
    expect(screen.getByRole('alert', { name: 'Problems with this post’s content' })).toHaveTextContent(
      'this post has nothing in it yet',
    );
  });

  // The other half: `kind` comes out of localStorage through the same
  // unchecked cast, so it need not be one of the ten -- validateBlock has an
  // isBlockKind branch of its own for exactly this shape. BlockFields' switch
  // has no branch for it, so she would otherwise get a strip with nothing
  // under it and no way to know what to do.
  it('a block whose kind this site does not have says so, and can still be removed', async () => {
    const user = userEvent.setup();
    const unknown = { kind: 'wonky', text: 'from an older draft' } as unknown as Block;
    const { onChange } = renderList({ blocks: [BLOCKS[0], unknown] });
    expect(screen.getByText(UNKNOWN_BLOCK_MESSAGE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Unknown block 2' }));
    expect(onChange).toHaveBeenCalledWith([BLOCKS[0]]);
  });

  it('an unrecognised block’s own validation message reaches her too', () => {
    const unknown = { kind: 'wonky' } as unknown as Block;
    const message = 'this post contains a "wonky" block, which this site does not have';
    const { container } = renderList({
      blocks: [unknown],
      problems: [{ field: '[0].blocks[0].kind', message }],
    });
    expect(messageHits(container, message)).toBe(1);
  });

  // ...and only one of the two at a time. Validation is debounced, so the
  // standing sentence is what she reads in the window before the validator's
  // own message arrives; once it has arrived, it names the kind she actually
  // has and the standing one would be a second sentence about one thing.
  it('an unrecognised block shows one instruction, never two', () => {
    const unknown = { kind: 'wonky' } as unknown as Block;
    const message = 'this post contains a "wonky" block, which this site does not have';
    const { container, unmount } = renderList({ blocks: [unknown] });
    expect(messageHits(container, UNKNOWN_BLOCK_MESSAGE)).toBe(1);
    unmount();

    const settled = renderList({
      blocks: [unknown],
      problems: [{ field: '[0].blocks[0].kind', message }],
    });
    expect(messageHits(settled.container, message)).toBe(1);
    expect(messageHits(settled.container, UNKNOWN_BLOCK_MESSAGE)).toBe(0);
  });

  it('a block that is not an object at all does not take the panel down', () => {
    renderList({ blocks: [null, BLOCKS[1]] as unknown as Block[] });
    expect(screen.getByText(UNKNOWN_BLOCK_MESSAGE)).toBeInTheDocument();
    expect(document.getElementById('posts-0-block-1-text')).toHaveValue('Second');
  });
});

describe('BlockList namespaces its ids by post', () => {
  it('two posts’ block 1 get different input ids, so a label click cannot land in the wrong post', () => {
    const { unmount } = renderList({ postIndex: 0 });
    expect(document.getElementById('posts-0-block-1-text')).not.toBeNull();
    unmount();
    renderList({ postIndex: 3 });
    expect(document.getElementById('posts-3-block-1-text')).not.toBeNull();
    expect(document.getElementById('posts-0-block-1-text')).toBeNull();
  });
});
