// The Image control, from the picker to a photograph that is still attached
// three edits later.
//
// The claim that matters here is not a key format. It is that the bytes she
// staged and the block that renders on screen agree about what the photograph
// is CALLED, through everything she would actually do next -- write a caption,
// split it, move a block. A key-shape assertion passes while that is false,
// which is how this project shipped the same defect twice
// (BlockList.tsx:223-254), so every case below reads the name back off the
// block the array actually holds rather than off a string this file wrote.
//
// What jsdom cannot say: that the picker OPENS. A label over a file input and
// a button that clicks one are indistinguishable here -- neither opens
// anything -- which is why the shape is mandated in the component rather than
// asserted here, and why e2e/writing-surface.spec.ts owns the proof.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import WritingSurface from '../WritingSurface';
import { createStableNames, type StableNames } from '../../blocks/stable-names';
import { uploadAndEncode, convertHeic } from '../../upload-photo';
import type { ImagePreviews } from '../../previews';
import type { StagedPhoto } from '../../PhotoField';
import type { Block } from '../../../content/types';
import type { ValidationProblem } from '../../../content/validate';

// `checkPhotoSize` and its message are the REAL ones -- the size cap is the
// one thing here that must not be a stand-in, since a caller that skips it
// re-opens the gap upload-photo.ts's own comment closed. Only the two calls
// that would touch the network or a WASM decoder are replaced.
vi.mock('../../upload-photo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../upload-photo')>();
  return {
    ...actual,
    convertHeic: vi.fn((file: File) => Promise.resolve(file)),
    uploadAndEncode: vi.fn(),
  };
});

afterEach(cleanup);

const staged: StagedPhoto = {
  path: 'assets-source/posts/abc123.jpg',
  contentPath: '/posts/abc123.webp',
  content: 'AAAA',
  encoding: 'base64',
};

beforeEach(() => {
  vi.mocked(convertHeic).mockImplementation((file: File) => Promise.resolve(file));
  vi.mocked(uploadAndEncode).mockReset();
  vi.mocked(uploadAndEncode).mockResolvedValue(staged);
});

// The shared preview store, in the shape previews.ts defines it: a plain map
// plus a setter. Real enough for the one thing these cases ask of it -- that
// the key the bytes were filed under is the key the <img> reads back.
function previewStore(): ImagePreviews {
  const urls: Record<string, string> = {};
  return {
    urls,
    set: (path, url) => {
      if (url === null) delete urls[path];
      else urls[path] = url;
    },
  };
}

interface Bench {
  container: HTMLElement;
  names: StableNames;
  previews: ImagePreviews;
  onStaged: ReturnType<typeof vi.fn>;
  blocks: () => Block[];
  // What happened, in the order it happened. The collector and the preview
  // store must both be written BEFORE the array is handed up, or the first
  // render carrying the new block has no bytes filed for it and no photograph
  // to show -- it would paint a derivative no build has produced yet.
  order: string[];
  rerender: (next: Block[]) => void;
}

function bench(initial: Block[], problems: ValidationProblem[] = []): Bench {
  const names = createStableNames('b');
  const order: string[] = [];
  const store = previewStore();
  const previews: ImagePreviews = {
    urls: store.urls,
    set: (path, url) => {
      order.push('preview');
      store.set(path, url);
    },
  };
  const onStaged = vi.fn(() => order.push('staged'));
  let current: Block[] = initial;
  let push: ((next: Block[]) => void) | null = null;

  function Harness() {
    const [blocks, setBlocks] = useState(initial);
    push = setBlocks;
    current = blocks;
    return (
      <WritingSurface
        blocks={blocks}
        postIndex={0}
        onChange={(next) => {
          order.push('changed');
          current = next;
          setBlocks(next);
        }}
        problems={problems}
        previews={previews}
        onStaged={onStaged}
        previewKeyPrefix="posts.json:fixture-a"
        names={names}
      />
    );
  }

  const view = render(<Harness />);
  return {
    container: view.container,
    names,
    previews,
    onStaged,
    order,
    blocks: () => current,
    rerender: (next) => act(() => push?.(next)),
  };
}

function file(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
}

async function picks(container: HTMLElement, picked: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('#posts-0-writing-image') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [picked] } });
  });
}

function hostAt(container: HTMLElement, address: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-slot="${address}"]`) as HTMLElement;
}

function caretAt(host: HTMLElement, offset: number): void {
  const range = host.ownerDocument.createRange();
  range.setStart(host.firstChild ?? host, offset);
  range.collapse(true);
  const selection = host.ownerDocument.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
}

// The key the collector was handed, alongside the name the block that is
// actually in the array renders under. Every case below compares those two
// rather than either one against a literal.
function stagedKey(at: Bench): string {
  return at.onStaged.mock.calls[at.onStaged.mock.calls.length - 1][0] as string;
}

function nameIn(at: Bench, index: number): string {
  return at.names.nameOf(at.blocks()[index], index);
}

describe('the Image control', () => {
  it('the toolbar label points at an input that exists, and it is a file input', () => {
    const at = bench([{ kind: 'paragraph', text: 'a' }]);
    const label = at.container.querySelector<HTMLLabelElement>('label[for="posts-0-writing-image"]');
    expect(label?.textContent).toBe('Image');
    const input = at.container.querySelector<HTMLInputElement>('#posts-0-writing-image');
    expect(input?.type).toBe('file');
    expect(input?.accept).toBe('image/*');
    // A label with nothing behind it is a control that does nothing when
    // pressed, which is what this pair exists to rule out.
    expect(label?.htmlFor).toBe(input?.id);
  });

  it('uploads to the posts category', async () => {
    const at = bench([{ kind: 'paragraph', text: 'a' }]);
    await picks(at.container, file('one.jpg', 10));
    expect(vi.mocked(uploadAndEncode).mock.calls[0][0]).toBe('posts');
  });

  // She picked while standing in the block that had been moved to the TOP, so
  // the photograph belongs after THAT block and the bytes belong under THAT
  // block's name -- neither of which is the position she happened to pick at.
  it('stages the bytes under the same name the block will render with', async () => {
    const a: Block = { kind: 'paragraph', text: 'a' };
    const b: Block = { kind: 'paragraph', text: 'b' };
    const c: Block = { kind: 'paragraph', text: 'c' };
    const at = bench([a, b, c]);
    at.rerender([c, a, b]);

    // The block now at the top is `c`, and its address still carries the name
    // it was given when it stood third.
    const address = `${at.names.nameOf(c, 0)}/text`;
    fireEvent.focus(hostAt(at.container, address));
    await picks(at.container, file('one.jpg', 10));

    const blocks = at.blocks();
    expect(blocks[1].kind).toBe('image');
    expect(stagedKey(at)).toBe(`blocks[${nameIn(at, 1)}].src`);
    // And that name is what the <img> reads its preview back under, so the
    // photograph she just picked is the one on screen rather than a
    // derivative no build has produced yet.
    expect(at.container.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
  });

  // The order, not merely the fact. The block reaches the array LAST, so no
  // render can ever show a photo block whose bytes are not already with the
  // collector and whose preview is not already in the store -- which is the
  // frame in which she would see a broken image.
  it('files the bytes and the preview before the block reaches the array', async () => {
    const at = bench([{ kind: 'paragraph', text: 'a' }]);
    await picks(at.container, file('one.jpg', 10));
    expect(at.order).toEqual(['staged', 'preview', 'changed']);
  });

  it('inserts the image after the block the caret was in, never at the end', async () => {
    const at = bench([
      { kind: 'paragraph', text: 'one' },
      { kind: 'paragraph', text: 'two' },
      { kind: 'paragraph', text: 'three' },
    ]);
    const address = `${at.names.nameOf(at.blocks()[0], 0)}/text`;
    fireEvent.focus(hostAt(at.container, address));
    await picks(at.container, file('one.jpg', 10));
    expect(at.blocks().map((block) => block.kind)).toEqual([
      'paragraph', 'image', 'paragraph', 'paragraph',
    ]);
  });

  it('appends when she has not stood in a block yet, rather than doing nothing', async () => {
    const at = bench([{ kind: 'paragraph', text: 'one' }]);
    await picks(at.container, file('one.jpg', 10));
    expect(at.blocks().map((block) => block.kind)).toEqual(['paragraph', 'image']);
  });

  it('refuses a photo over the size cap before any network call', async () => {
    const at = bench([{ kind: 'paragraph', text: 'a' }]);
    await picks(at.container, file('big.jpg', 6 * 1024 * 1024));
    expect(vi.mocked(uploadAndEncode)).not.toHaveBeenCalled();
    const said = [...at.container.querySelectorAll('[role="alert"]')].map((el) => el.textContent).join(' ');
    expect(said).toMatch(/under 5\.00MB/);
    expect(at.blocks()).toHaveLength(1);
  });

  it('says so, and adds nothing, when the photo cannot be read at all', async () => {
    vi.mocked(convertHeic).mockRejectedValueOnce(new Error('no decoder'));
    const at = bench([{ kind: 'paragraph', text: 'a' }]);
    await picks(at.container, file('one.heic', 10));
    expect(vi.mocked(uploadAndEncode)).not.toHaveBeenCalled();
    const said = [...at.container.querySelectorAll('[role="alert"]')].map((el) => el.textContent).join(' ');
    expect(said).toContain('This photo could not be read.');
    expect(at.blocks()).toHaveLength(1);
  });

  // A block inserted before the bytes arrived would leave a photo block
  // pointing at nothing the moment the upload failed -- and validateBlock
  // would then refuse the post over a block she never knowingly added.
  it('leaves the block array untouched when the upload fails', async () => {
    vi.mocked(uploadAndEncode).mockRejectedValueOnce(new Error('Could not reach the server.'));
    const at = bench([{ kind: 'paragraph', text: 'a' }]);
    await picks(at.container, file('one.jpg', 10));
    expect(at.blocks()).toHaveLength(1);
    expect(at.onStaged).not.toHaveBeenCalled();
    const said = [...at.container.querySelectorAll('[role="alert"]')].map((el) => el.textContent).join(' ');
    expect(said).toContain('Could not reach the server.');
  });

  it('hands every block it did not touch back by IDENTITY', async () => {
    const one: Block = { kind: 'paragraph', text: 'one' };
    const two: Block = { kind: 'paragraph', text: 'two' };
    const at = bench([one, two]);
    fireEvent.focus(hostAt(at.container, `${at.names.nameOf(one, 0)}/text`));
    await picks(at.container, file('one.jpg', 10));
    expect(at.blocks()[0]).toBe(one);
    expect(at.blocks()[2]).toBe(two);
  });
});

// THE SEQUENCE SHE WOULD ACTUALLY PERFORM. Every step below replaces the image
// block with a new object, and the staged bytes are filed under a key composed
// from that object's WeakMap name -- so any one of them missing its `rename`
// detaches the photograph, and nothing on screen says so until the post
// publishes naming a file that was never sent.
describe('the photograph after she keeps working', () => {
  it('is still filed under the name the block renders with after a caption, a split and an undo', async () => {
    const at = bench([{ kind: 'paragraph', text: 'intro' }]);
    fireEvent.focus(hostAt(at.container, `${at.names.nameOf(at.blocks()[0], 0)}/text`));
    await picks(at.container, file('one.jpg', 10));
    const key = stagedKey(at);
    expect(key).toBe(`blocks[${nameIn(at, 1)}].src`);

    // She writes a caption.
    const name = nameIn(at, 1);
    const caption = hostAt(at.container, `${name}/caption`);
    act(() => {
      caption.textContent = 'a caption';
      fireEvent.input(caption);
    });
    expect(at.blocks()[1]).toMatchObject({ kind: 'image', caption: 'a caption' });
    expect(`blocks[${nameIn(at, 1)}].src`).toBe(key);

    // She presses Enter in the middle of it, which splits the caption and
    // leaves the photograph as the block above.
    const written = hostAt(at.container, `${nameIn(at, 1)}/caption`);
    act(() => {
      caretAt(written, 4);
      fireEvent.keyDown(written, { key: 'Enter' });
    });
    expect(at.blocks().map((block) => block.kind)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(`blocks[${nameIn(at, 1)}].src`).toBe(key);

    // And one step back.
    const back = hostAt(at.container, `${nameIn(at, 1)}/caption`);
    act(() => {
      fireEvent.keyDown(back, { key: 'z', metaKey: true });
    });
    expect(at.blocks()[1].kind).toBe('image');
    expect(`blocks[${nameIn(at, 1)}].src`).toBe(key);
    // The picture is still on screen throughout, which is the same fact seen
    // from the other end: the preview is keyed on the same name.
    expect(at.container.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
  });
});

describe('the photo description', () => {
  it('is a field of its own under the picture, and it claims its own problem', () => {
    const at = bench(
      [{ kind: 'image', src: '/x.webp', alt: '', caption: 'c' }],
      [{ field: '[0].blocks[0].alt', message: 'Say what is in the photo.' }],
    );
    const input = at.container.querySelector<HTMLInputElement>('#posts-0-block-0-alt');
    expect(input).not.toBeNull();
    expect(at.container.querySelector('label[for="posts-0-block-0-alt"]')?.textContent).toBe('Photo description');
    // Claimed by the field, so it is NOT also standing in the list banner --
    // the partition D4 requires.
    expect(at.container.querySelector('[aria-label="Problems with this post’s content"]')).toBeNull();
    expect(at.container.querySelector('#posts-0-block-0-alt-error')?.textContent).toBe('Say what is in the photo.');
  });

  it('commits onto a NEW block object and carries the name onto it', () => {
    const image: Block = { kind: 'image', src: '/x.webp', alt: '', caption: 'c' };
    const at = bench([image]);
    const before = at.names.nameOf(image, 0);
    const input = at.container.querySelector<HTMLInputElement>('#posts-0-block-0-alt') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'a plate of pasta' } });
    });
    expect(at.blocks()[0]).not.toBe(image);
    expect(at.blocks()[0]).toMatchObject({ kind: 'image', alt: 'a plate of pasta', src: '/x.webp' });
    expect(nameIn(at, 0)).toBe(before);
  });

  it('renders the photograph at column width inside the figure the published post uses', () => {
    const at = bench([{ kind: 'image', src: '/x.webp', alt: 'x', caption: 'c' }]);
    const img = at.container.querySelector('img') as HTMLImageElement;
    expect(img.closest('figure')).not.toBeNull();
    expect(img.getAttribute('alt')).toBe('x');
    // Whether that reads as centred at 390px and at 1280px is a layout claim
    // and is deferred to e2e/writing-surface.spec.ts.
    expect(img.className).toBe('w-full rounded-2xl object-cover');
  });

  it('shows no <img> at all for a block with no photo in it', () => {
    const at = bench([{ kind: 'image', src: '', alt: 'x', caption: 'c' }]);
    expect(at.container.querySelector('img')).toBeNull();
  });
});

// A photograph inside a photo grid, which the insert menu adds and BlockFields
// draws. The path is a different one -- PhotoField rather than the toolbar's
// own control -- and the claim is the same claim, because it is the only one
// that decides what she gets live: the bytes must be filed under a key that
// names the BLOCK, not the position it happened to be standing at.
describe('a photograph inside a photo grid', () => {
  it('stages under the grid block’s own name, the way the toolbar’s own picker does', async () => {
    const at = bench([
      { kind: 'paragraph', text: 'a' },
      { kind: 'gallery', images: [{ src: '', alt: '' }] },
    ]);
    const input = at.container.querySelector<HTMLInputElement>('#posts-0-block-1-images-0-src') as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      fireEvent.change(input, { target: { files: [file('grid.jpg', 10)] } });
    });

    // Read back off the block the array actually holds rather than compared
    // against a literal -- a key-shape assertion passes while the two disagree,
    // which is how this project shipped the same defect twice.
    expect(stagedKey(at)).toMatch(new RegExp(`^blocks\\[${nameIn(at, 1)}\\]\\.images\\[[^\\]]+\\]\\.src$`));
  });

  it('leaves the paragraph above it exactly as it was', async () => {
    const paragraph: Block = { kind: 'paragraph', text: 'a' };
    const at = bench([paragraph, { kind: 'gallery', images: [{ src: '', alt: '' }] }]);
    const input = at.container.querySelector<HTMLInputElement>('#posts-0-block-1-images-0-src') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file('grid.jpg', 10)] } });
    });
    expect(at.blocks()[0]).toBe(paragraph);
  });
});

// THE PHOTOGRAPH THROUGH A REORDER AND THROUGH A REMOVAL, which are the two
// gestures this whole naming scheme exists for: a block does not survive a
// reorder, and a staged photograph inside one does. Every case below reads the
// name back off the block the array actually holds, never off a string this
// file wrote.
describe('the photograph after she moves or removes a block', () => {
  function control(at: Bench, label: string): HTMLButtonElement {
    const button = at.container.querySelector<HTMLButtonElement>(
      `[data-block-controls] button[aria-label="${label}"]`,
    );
    expect(button, `no control labelled ${label}`).not.toBeNull();
    return button as HTMLButtonElement;
  }

  // Two photographs, on two image blocks, both staged through the real picker
  // path. `mockResolvedValueOnce` gives the second one its own bytes so the
  // two collector entries cannot be mistaken for each other.
  async function twoPhotographs(): Promise<Bench> {
    const at = bench([{ kind: 'paragraph', text: 'intro' }]);
    fireEvent.focus(hostAt(at.container, `${at.names.nameOf(at.blocks()[0], 0)}/text`));
    await picks(at.container, file('one.jpg', 10));

    vi.mocked(uploadAndEncode).mockResolvedValueOnce({
      path: 'assets-source/posts/def456.jpg',
      contentPath: '/posts/def456.webp',
      content: 'BBBB',
      encoding: 'base64',
    });
    fireEvent.focus(hostAt(at.container, `${nameIn(at, 1)}/caption`));
    await picks(at.container, file('two.jpg', 10));

    expect(at.blocks().map((block) => block.kind)).toEqual(['paragraph', 'image', 'image']);
    return at;
  }

  it('is still filed under the name it renders with after she moves it, and still on screen', async () => {
    const at = bench([{ kind: 'paragraph', text: 'intro' }]);
    fireEvent.focus(hostAt(at.container, `${at.names.nameOf(at.blocks()[0], 0)}/text`));
    await picks(at.container, file('one.jpg', 10));
    const key = stagedKey(at);
    expect(key).toBe(`blocks[${nameIn(at, 1)}].src`);

    act(() => {
      fireEvent.click(control(at, 'Move Photo block 2 up'));
    });

    expect(at.blocks().map((block) => block.kind)).toEqual(['image', 'paragraph']);
    expect(`blocks[${nameIn(at, 0)}].src`).toBe(key);
    // The same fact from the other end: the preview is keyed on that name too,
    // so a reorder that rebuilt the block would show her the derivative no
    // build has produced yet instead of the photograph she picked.
    expect(at.container.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('leaves the OTHER photograph’s bytes exactly where they were when one block is removed', async () => {
    const at = await twoPhotographs();
    const [firstKey, secondKey] = at.onStaged.mock.calls.map((call) => call[0] as string);
    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).toBe(`blocks[${nameIn(at, 1)}].src`);
    expect(secondKey).toBe(`blocks[${nameIn(at, 2)}].src`);

    act(() => {
      fireEvent.click(control(at, 'Remove Photo block 2'));
    });

    expect(at.blocks().map((block) => block.kind)).toEqual(['paragraph', 'image']);
    // The survivor is the SECOND photograph and it still answers to the key
    // its bytes were filed under. A removal that rebuilt the survivors would
    // rename this block and leave those bytes referring to nothing.
    expect(at.blocks()[1]).toMatchObject({ src: '/posts/def456.webp' });
    expect(`blocks[${nameIn(at, 1)}].src`).toBe(secondKey);
    expect(at.container.querySelectorAll('img')).toHaveLength(1);
    expect(at.container.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('keeps the removed block’s own bytes, because one press of Undo puts that block back', async () => {
    // Deliberate, and the direction of the trade is the reason. Dropping them
    // on the way out would make Undo restore a block naming an asset that
    // exists nowhere -- staged no longer, committed never -- which publishes a
    // post pointing at a file no build can produce and fails the
    // asset-existence check on every build after it. The cost of keeping them
    // is one unreferenced photograph committed and one of the eight staged
    // files a publish allows.
    const at = await twoPhotographs();
    const [firstKey] = at.onStaged.mock.calls.map((call) => call[0] as string);
    const removed = at.blocks()[1];
    const staged = at.onStaged.mock.calls.length;

    act(() => {
      fireEvent.click(control(at, 'Remove Photo block 2'));
    });
    // Nothing was said to the collector at all: no clear, and certainly no
    // clear of the wrong key.
    expect(at.onStaged.mock.calls).toHaveLength(staged);

    // The toolbar's own control, which carries its name as text rather than as
    // an aria-label (WritingToolbar.tsx).
    const undo = [...at.container.querySelectorAll('button')].find((el) => el.textContent === 'Undo');
    expect(undo).toBeDefined();
    act(() => {
      fireEvent.click(undo as HTMLButtonElement);
    });

    // The length first, and it is not padding: two picks stand behind this
    // press in the same history, so a removal that recorded NO step at all
    // would send Undo back past the second photograph instead -- landing on an
    // array whose second entry is also this block, and passing the identity
    // check below for the wrong reason. Measured: without it this case stayed
    // green through exactly that mutation.
    expect(at.blocks().map((block) => block.kind)).toEqual(['paragraph', 'image', 'image']);
    expect(at.blocks()[1]).toBe(removed);
    expect(`blocks[${nameIn(at, 1)}].src`).toBe(firstKey);
  });
});
