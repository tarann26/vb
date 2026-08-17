import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BlockList, { type BlockListProps } from '../BlockList';
import { BLOCK_KIND_LABELS, UNKNOWN_BLOCK_MESSAGE } from '../block-meta';
import { NO_IMAGE_PREVIEWS, useImagePreviews } from '../../previews';
import { fromStagedPhoto, useStagedFiles, type StagedFile } from '../../staged';
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

// What jsdom can honestly say about a drag: that the handle is there, that it
// is marked draggable, that it sits with the block it moves, and that it is NOT
// a second control competing with the buttons. Whether a block MOVES is
// e2e/block-editor.spec.ts's claim -- jsdom has no drag implementation, no
// DataTransfer worth the name and no layout engine, so a fireEvent.dragStart
// test here would prove a handler was called and nothing whatsoever about
// whether anything moved.
describe('BlockList’s drag handle, as far as jsdom can tell', () => {
  it('every block has one, and it is draggable', () => {
    renderList({ blocks: BLOCKS });
    const handles = document.querySelectorAll('[data-drag-handle]');
    expect(handles).toHaveLength(BLOCKS.length);
    handles.forEach((handle) => {
      expect(handle).toHaveAttribute('draggable', 'true');
    });
  });

  it('is hidden from assistive technology, because the buttons are the accessible path', () => {
    renderList({ blocks: BLOCKS });
    const handles = document.querySelectorAll('[data-drag-handle]');
    // Counted before the loop, because a forEach over an empty NodeList asserts
    // nothing at all -- this case would otherwise pass green against a build
    // with no handles in it.
    expect(handles).toHaveLength(BLOCKS.length);
    handles.forEach((handle) => {
      expect(handle).toHaveAttribute('aria-hidden', 'true');
    });
    // And the buttons are still there. Drag is a second way, never the only
    // way: a drag is unusable on a phone with a long block list.
    expect(screen.getByRole('button', { name: 'Move Heading block 1 down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Paragraph block 3 up' })).toBeInTheDocument();
  });

  // Not a restatement of the aria-hidden case above, and the difference is why
  // this is worth its own test: `getAllByRole` skips an aria-hidden subtree by
  // default, so a handle that had quietly become `role="button"` while KEEPING
  // aria-hidden would satisfy both that case and a query for a button named
  // "drag". Asked of the whole block instead: whatever the handle is, the
  // controls this block offers are still exactly the ones it offered before --
  // Remove, and the three formatting buttons over its text. `hidden: true` on
  // purpose, since an aria-hidden control is the thing being ruled out, so the
  // query has to be able to see one.
  it('adds no control to the block, only a mouse affordance', () => {
    renderList({ blocks: [{ kind: 'heading', text: 'Only' }] });
    const [li] = screen.getAllByRole('listitem');
    const controls = within(li)
      .getAllByRole('button', { hidden: true })
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');
    expect(controls).toEqual(['Remove Heading block 1', 'Bold', 'Italic', 'Link']);
    const handle = li.querySelector('[data-drag-handle]');
    expect(handle?.tagName).toBe('SPAN');
    expect(handle?.hasAttribute('role')).toBe(false);
  });

  // The handle belongs to the block whose kind is written next to it, and it
  // says so in the DOM rather than only on screen -- jsdom has no layout engine,
  // so "next to" is a document-order claim here and a geometry claim only in
  // e2e/. It is also exactly what the browser spec reads a block's kind off, so
  // a handle moved out of this group would leave that spec measuring the Up and
  // Remove buttons' text instead and still passing.
  it('sits immediately before the kind label of the block it moves', () => {
    renderList({ blocks: [EVERY_BLOCK.quote, EVERY_BLOCK.numberList] });
    const [first, second] = screen.getAllByRole('listitem');
    const handle = first.querySelector('[data-drag-handle]') as HTMLElement;
    const label = within(first).getByText(BLOCK_KIND_LABELS.quote);
    expect(Boolean(handle.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(handle.parentElement?.textContent).toBe(`⠿${BLOCK_KIND_LABELS.quote}`);
    expect(second.querySelector('[data-drag-handle]')?.parentElement?.textContent).toBe(
      `⠿${BLOCK_KIND_LABELS.numberList}`,
    );
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

// The one thing a positional block key was NOT free for, and the fix for it.
//
// A block's identity used to BE its position, all the way down: the React key,
// the preview key, and the key `onStaged` reported a picked photo under. A
// photo, unlike a block, survives a reorder -- so every one of those three
// pointed at the position she moved the block AWAY from. Task 8's drag handle
// turned four positions from six deliberate clicks into one gesture, which is
// what made a defect that needed persistence into one an ordinary edit runs
// into.
//
// Nothing below asserts a key STRING. What is asserted is what she would find
// out about: the photo she picked is on the block she picked it for, and the
// bytes behind every photo the post now names are still collected, so a
// publish sends a file for every reference. A test that pinned the key format
// would go green against a component that named its keys beautifully and still
// lost her photo.
describe('a photo she has already picked, when the block it sits in moves', () => {
  // A third copy of PhotoField.test.tsx's XHR double (AdminApp.test.tsx has
  // the second), and deliberately the smallest one that will do: this file
  // needs a real upload to reach a real collector -- the whole claim is about
  // bytes surviving an edit -- but nothing here drives progress, failure or
  // retry, so those three members are not repeated.
  class FakeXHR {
    static instances: FakeXHR[] = [];
    status = 0;
    responseText = '';
    timeout = 0;
    withCredentials = false;
    upload: { onprogress: (() => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    constructor() {
      FakeXHR.instances.push(this);
    }
    open() {}
    send() {}
    respond(status: number, body: unknown) {
      this.status = status;
      this.responseText = JSON.stringify(body);
      this.onload?.();
    }
  }

  function jpegFile(name: string): File {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, ...new TextEncoder().encode('JFIF')]);
    return new File([bytes], name, { type: 'image/jpeg' });
  }

  interface Sink {
    blocks: Block[];
    files: Record<string, StagedFile>;
    previews: Record<string, string>;
  }

  // `renderList` above hands `onChange` to a spy, so the list it renders never
  // actually changes -- which is exactly the state this defect cannot be seen
  // in. Here the list is genuinely held and handed back, and the staged bytes
  // go to the real collector every panel on this dashboard shares, through the
  // real `fromStagedPhoto` conversion PostsArea uses.
  function StagedBlocks({ initial, sink }: { initial: Block[]; sink: Sink }) {
    const [blocks, setBlocks] = useState<Block[]>(initial);
    const { files, stage } = useStagedFiles();
    // The REAL preview store, not NO_IMAGE_PREVIEWS: its `set` revokes
    // whatever the key it is given held before, so the store is the one place
    // a preview key colliding with another block's is observable at all.
    const previews = useImagePreviews();
    sink.blocks = blocks;
    sink.files = files;
    sink.previews = previews.urls;
    return (
      <BlockList
        blocks={blocks}
        postIndex={0}
        onChange={setBlocks}
        problems={[]}
        previews={previews}
        onStaged={(key, staged) => stage(key, fromStagedPhoto(staged))}
        previewKeyPrefix="posts.json:fixture-a"
      />
    );
  }

  function twoPhotoBlocks(): Block[] {
    return [
      { kind: 'image', src: '', alt: 'The tielle, sliced' },
      { kind: 'image', src: '', alt: 'The bread oven' },
    ];
  }

  async function pickPhoto(
    user: ReturnType<typeof userEvent.setup>,
    input: HTMLInputElement,
    file: string,
    contentPath: string,
  ): Promise<void> {
    const before = FakeXHR.instances.length;
    // Scoped to the picker's OWN field, never to the whole render: the second
    // pick in these cases lands on a different block (or a different tile of
    // one gallery) that is in the same place on screen, and a count of
    // confirmations across the document cannot tell those apart. `closest`
    // lands on PhotoField's own wrapper, which holds this input and its own
    // status line and nothing else.
    const own = input.closest('div') as HTMLElement;
    await user.upload(input, jpegFile(file));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(before + 1));
    FakeXHR.instances[before].respond(200, { path: `assets-source/posts/${file}`, contentPath });
    // The upload's own confirmation, which is what tells her it is safe to
    // carry on editing -- waited for rather than timed, and it is also the
    // point at which the bytes have genuinely reached the collector.
    await waitFor(() => expect(within(own).getByText(/Uploaded/)).toBeInTheDocument());
  }

  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is still on that block, and its bytes are still collected, after she moves it', async () => {
    const user = userEvent.setup();
    const sink: Sink = { blocks: [], files: {}, previews: {} };
    const { container } = render(<StagedBlocks initial={twoPhotoBlocks()} sink={sink} />);
    const pickers = () => [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')];

    // She picks a photo for the tielle, which is the first block.
    await pickPhoto(user, pickers()[0], 'tielle.jpg', '/posts/tielle.webp');
    // Then moves it below the oven -- one gesture with the handle, one click
    // here, the same reorder either way.
    await user.click(screen.getByRole('button', { name: `Move ${BLOCK_KIND_LABELS.image} block 1 down` }));
    // Then picks a photo for the oven, which is now the first block.
    await pickPhoto(user, pickers()[0], 'oven.jpg', '/posts/oven.webp');

    // Each block names the photo she picked FOR IT, in the order she left them.
    const [first, second] = sink.blocks as { alt: string; src: string }[];
    expect([first.alt, first.src]).toEqual(['The bread oven', '/posts/oven.webp']);
    expect([second.alt, second.src]).toEqual(['The tielle, sliced', '/posts/tielle.webp']);

    // ...and BOTH photos' bytes are still staged, which is the half that
    // decides what she gets live: a publish sends one file per staged entry,
    // so a reference with no entry behind it is a broken image on the site and
    // an asset-existence failure on every build after it.
    expect(Object.values(sink.files).map((file) => file.contentPath).sort()).toEqual([
      '/posts/oven.webp',
      '/posts/tielle.webp',
    ]);
    // Two entries, not one entry that happens to hold both paths' worth of
    // hope: a second photo staged under a key the first already occupied
    // silently replaces it, which is precisely how the first photo used to be
    // lost.
    expect(Object.keys(sink.files)).toHaveLength(2);

    // The same claim about the preview store, which is a separate key composed
    // on the same line and can go wrong on its own. Two DISTINCT object URLs
    // still held: `set` revokes what its key held before, so a preview key
    // that named the position would have revoked the tielle's own preview the
    // moment the oven's photo landed on the position it left -- her first
    // photo gone from the screen, in a browser, with the block still naming
    // it. jsdom's revoke is a no-op, so the count is what says it here.
    expect(new Set(Object.values(sink.previews)).size).toBe(2);
  });

  // The half of a block's name that has nothing to do with reordering: an
  // edited block is a NEW object every keystroke (`{ ...block, alt: next }`),
  // so a name that was not carried across would change under a photo already
  // staged -- leaving the first photo's bytes stranded under a name nothing
  // refers to any more. She would not lose a photo to that one, but she would
  // publish an asset her post does not use, and the collector's own supersede
  // contract ("a new pick drops what this field had") would be broken for the
  // rest of the session.
  it('a second thought about the photo, after typing the description, leaves one photo staged and not two', async () => {
    const user = userEvent.setup();
    const sink: Sink = { blocks: [], files: {}, previews: {} };
    const { container } = render(<StagedBlocks initial={twoPhotoBlocks()} sink={sink} />);
    const picker = () => container.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];

    await pickPhoto(user, picker(), 'tielle.jpg', '/posts/tielle.webp');
    await user.type(screen.getByDisplayValue('The tielle, sliced'), ' on a board');
    await pickPhoto(user, picker(), 'better-tielle.jpg', '/posts/better-tielle.webp');

    expect(Object.values(sink.files).map((file) => file.contentPath)).toEqual(['/posts/better-tielle.webp']);
    const [first] = sink.blocks as { alt: string; src: string }[];
    expect([first.alt, first.src]).toEqual(['The tielle, sliced on a board', '/posts/better-tielle.webp']);
  });

  // THE SAME DEFECT ONE LEVEL DOWN, found by review on the shipped tree. The
  // tiles inside a gallery block have no reorder control -- the strip's own
  // comment recommends removing and re-adding a photo instead -- and Remove is
  // a filter, so every later tile's position drops by one under a photo she has
  // already picked.
  //
  // Her sequence, and it is an ordinary one: three photos in the grid, she
  // picks a new one for the second, decides the first can go, and then picks
  // one for what is left at the bottom.
  it('a photo she picked for one tile survives her removing the tile above it', async () => {
    const user = userEvent.setup();
    const sink: Sink = { blocks: [], files: {}, previews: {} };
    const { container } = render(
      <StagedBlocks
        initial={[
          {
            kind: 'gallery',
            images: [
              { src: '/posts/already-live.webp', alt: 'Photo A' },
              { src: '', alt: 'Photo B' },
              { src: '', alt: 'Photo C' },
            ],
          },
        ]}
        sink={sink}
      />,
    );
    const pickers = () => [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')];

    await pickPhoto(user, pickers()[1], 'bee.jpg', '/posts/bee.webp');
    // The object URL she is looking at, which is what identifies the photo on
    // screen -- nothing is live at a contentPath until a publish and a rebuild.
    const picked = pickers()[1].parentElement?.querySelector('img')?.getAttribute('src');
    expect(picked).toMatch(/^blob:/);

    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));

    // Her photo moved up with its own tile rather than staying on the tile
    // number. Each tile identified by the description SHE typed, not by
    // position, since position is what is under test.
    const tiles = () => pickers().map((picker) => picker.parentElement?.parentElement as HTMLElement);
    const [bee, sea] = tiles();
    expect(within(bee).getByDisplayValue('Photo B')).toBeInTheDocument();
    expect(bee.querySelector('img')).toHaveAttribute('src', picked as string);
    // And the tile below it, which she has picked nothing for, shows nothing.
    expect(within(sea).getByDisplayValue('Photo C')).toBeInTheDocument();
    expect(sea.querySelector('img')).toBeNull();

    // The tile now sitting second is the one that used to be third, and this is
    // the pick that used to destroy the photo above it.
    await pickPhoto(user, pickers()[1], 'sea.jpg', '/posts/sea.webp');

    const { images } = sink.blocks[0] as unknown as { images: { src: string; alt: string }[] };
    expect(images.map((image) => [image.alt, image.src])).toEqual([
      ['Photo B', '/posts/bee.webp'],
      ['Photo C', '/posts/sea.webp'],
    ]);
    // Both sets of bytes still collected. A publish sends one file per staged
    // entry, so a photo the grid names with no entry behind it is a broken
    // image on the site and an asset-existence failure on every build after it.
    expect(Object.values(sink.files).map((file) => file.contentPath).sort()).toEqual([
      '/posts/bee.webp',
      '/posts/sea.webp',
    ]);
    // Said the other way round, which is the way review measured it: no photo
    // this grid names was picked in this session without its bytes.
    const staged = new Set(Object.values(sink.files).map((file) => file.contentPath));
    expect(images.filter((image) => image.src.startsWith('/posts/') && !staged.has(image.src))).toEqual([]);

    // Two live previews, one per photo. `previews.set` revokes whatever its key
    // held before, so a preview key that named the tile POSITION would have
    // revoked the first photo's object URL the moment the second landed on the
    // position it had shifted into -- her photo gone from the screen, in a
    // browser, with the grid still naming it. jsdom's revoke is a no-op, so the
    // count is what says it here.
    expect(new Set(Object.values(sink.previews)).size).toBe(2);
  });

  it('shows her the photo she picked on the block she picked it for, not on the position it left', async () => {
    const user = userEvent.setup();
    const sink: Sink = { blocks: [], files: {}, previews: {} };
    const { container } = render(<StagedBlocks initial={twoPhotoBlocks()} sink={sink} />);
    const pickers = () => [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')];

    await pickPhoto(user, pickers()[0], 'tielle.jpg', '/posts/tielle.webp');
    // The just-picked photo is an object URL, never the contentPath -- nothing
    // is live at that path until a publish and a rebuild. So THIS is the
    // string that identifies the photo she is looking at.
    const picked = container.querySelector('img')?.getAttribute('src');
    expect(picked).toMatch(/^blob:/);

    await user.click(screen.getByRole('button', { name: `Move ${BLOCK_KIND_LABELS.image} block 1 down` }));

    // The tielle block is second now. Found by the description SHE typed, not
    // by position, because position is the thing under test.
    const blocks = screen.getAllByRole('listitem');
    const tielle = blocks.find((li) => within(li).queryByDisplayValue('The tielle, sliced') !== null);
    expect(tielle).toBeDefined();
    expect(tielle).toBe(blocks[1]);
    expect(tielle?.querySelector('img')).toHaveAttribute('src', picked);
    // And the oven block, which she has picked nothing for, still shows
    // nothing -- a preview left behind on the position would show up here.
    const oven = blocks[0];
    expect(within(oven).getByDisplayValue('The bread oven')).toBeInTheDocument();
    expect(oven.querySelector('img')).toBeNull();
  });
});

// Where the keyboard is after a reorder, which is a fact about
// `document.activeElement` and therefore something jsdom can answer honestly.
//
// The Up/Down buttons are not the lesser path: BlockList's own comment reserves
// them as THE way to reorder for anyone on a phone or a screen reader, since a
// drag needs a pointer and a steady hand. So where focus lands after one press
// decides whether the second press is a keystroke or a re-navigation from the
// top of the document.
describe('BlockList’s Up and Down keep the keyboard on the block being moved', () => {
  // Controlled, because the claim is about what happens AFTER the list comes
  // back changed -- an uncontrolled harness never re-renders and so never moves
  // anything for focus to follow.
  function ControlledBlocks({ initial }: { initial: Block[] }) {
    const [blocks, setBlocks] = useState<Block[]>(initial);
    return (
      <BlockList
        blocks={blocks}
        postIndex={0}
        onChange={setBlocks}
        problems={[]}
        previews={NO_IMAGE_PREVIEWS}
        onStaged={vi.fn()}
        previewKeyPrefix="posts.json:fixture-a"
      />
    );
  }

  const wordsInOrder = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('textarea')].map((area) => area.value);

  it('presses of Down keep moving the SAME block, because focus goes with it', async () => {
    const user = userEvent.setup();
    const { container } = render(<ControlledBlocks initial={BLOCKS} />);

    const down = screen.getByRole('button', { name: 'Move Heading block 1 down' });
    down.focus();
    await user.click(down);

    expect(wordsInOrder(container)).toEqual(['Second', 'First', 'Third']);
    // Still on her own block's button, which now says block 2 because that is
    // where her block is. Not `<body>`: a keyed reorder moves the row's DOM
    // node, and moving a focused element blurs it.
    expect(document.activeElement).toHaveAttribute('aria-label', 'Move Heading block 2 down');

    // The second press, made the way she would make it -- on whatever the
    // keyboard is on. Her block moves again. Before this fix she was on
    // `<body>` and had nothing to press at all; before the keyed reorder she
    // was on the POSITION's button, so this press moved the block that had
    // replaced hers and put the list back the way it started, silently.
    await user.click(document.activeElement as HTMLElement);
    expect(wordsInOrder(container)).toEqual(['Second', 'Third', 'First']);
  });

  // Up as well as Down, because they are not symmetric: React reconciles keys
  // by moving as few nodes as it can, so a Down press relocates the block BELOW
  // hers and an Up press relocates hers. Measured under this jsdom: neither
  // press loses the focus while her own button survives -- jsdom does not blur
  // a node for being moved, whatever a browser may do -- so what these two
  // cases pin is that the button she is left on belongs to HER block rather
  // than to the position she moved it out of.
  it('after Up, she is still on the button she pressed, on the block that moved', async () => {
    const user = userEvent.setup();
    const { container } = render(<ControlledBlocks initial={BLOCKS} />);

    const up = screen.getByRole('button', { name: 'Move Paragraph block 3 up' });
    up.focus();
    await user.click(up);

    expect(wordsInOrder(container)).toEqual(['First', 'Third', 'Second']);
    expect(document.activeElement).toHaveAttribute('aria-label', 'Move Paragraph block 2 up');
  });

  it('lands on the block’s other direction when it reaches the end, never on Remove', async () => {
    const user = userEvent.setup();
    render(<ControlledBlocks initial={BLOCKS} />);

    await user.click(screen.getByRole('button', { name: 'Move Heading block 1 down' }));
    await user.click(document.activeElement as HTMLElement);

    // Her block is last, so it no longer offers Down (omitted, not disabled --
    // RecordList's rule). Up is the only reorder control the row has left, and
    // it is where she is. Remove is one press of Enter away from deleting the
    // block she was moving, so it is never the answer.
    expect(document.activeElement).toHaveAttribute('aria-label', 'Move Heading block 3 up');
  });
});
