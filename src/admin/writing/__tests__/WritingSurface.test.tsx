// What jsdom can honestly say about the writing column.
//
// It has a DOM, so the structure of the surface, the shape of every block
// transformation and the identity of the objects that come out of onChange
// are all real here. It has no layout engine and its selection model is a
// stub, so the caret is not: where the caret lands after a commit, whether a
// keystroke is dropped, and what a mark looks like on screen belong in
// e2e/writing-surface.spec.ts. Each such claim is named where it is deferred
// rather than left to be inferred from silence.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, cleanup, screen, within } from '@testing-library/react';
import WritingSurface, { type WritingSurfaceProps } from '../WritingSurface';
import { BLOCK_KIND_LABELS, INSERT_MENU_KINDS } from '../../blocks/block-meta';
import { createStableNames, type StableNames } from '../../blocks/stable-names';
import { NO_IMAGE_PREVIEWS } from '../../previews';
import type { Block } from '../../../content/types';
import type { ValidationProblem } from '../../../content/validate';

afterEach(cleanup);

function props(overrides: Partial<WritingSurfaceProps> = {}): WritingSurfaceProps {
  return {
    blocks: [],
    postIndex: 0,
    onChange: () => {},
    problems: [],
    previews: NO_IMAGE_PREVIEWS,
    onStaged: () => {},
    previewKeyPrefix: 'posts.json:fixture-a',
    ...overrides,
  };
}

function surface(overrides: Partial<WritingSurfaceProps> = {}) {
  const view = render(<WritingSurface {...props(overrides)} />);
  return {
    ...view,
    hosts: (): HTMLElement[] => [...view.container.querySelectorAll<HTMLElement>('[data-slot]')],
    at: (address: string): HTMLElement | null =>
      view.container.querySelector<HTMLElement>(`[data-slot="${address}"]`),
  };
}

// A surface that owns its own array, which is what the dashboard gives it:
// PostList holds the post and hands a new array down on every commit. Several
// claims below are only about what happens on the way BACK down.
function Harness({ initial, spy, names }: { initial: Block[]; spy: (next: Block[]) => void; names?: StableNames }) {
  const [blocks, setBlocks] = useState(initial);
  return (
    <WritingSurface
      {...props({
        blocks,
        names,
        onChange: (next) => {
          spy(next);
          setBlocks(next);
        },
      })}
    />
  );
}

// One edit, spelled the way a browser spells it: the words in the host change,
// then an `input` event fires. Nothing here pretends to move a caret.
function types(host: HTMLElement, words: string): void {
  host.textContent = words;
  fireEvent.input(host);
}

// jsdom has Range and Selection, so a caret really can be put inside a host
// and really can be read back out of one. What it has no opinion about is
// whether a browser would have put the caret there, or kept it there -- so
// every claim below is about the ARRAY the keystroke produced, plus the one
// DOM fact (which host holds the collapsed range afterwards) that the layout
// effect is directly responsible for.
function caretAt(host: HTMLElement, offset: number): void {
  const range = host.ownerDocument.createRange();
  const node = host.firstChild ?? host;
  range.setStart(node, offset);
  range.collapse(true);
  const selection = host.ownerDocument.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
}

function selects(host: HTMLElement, from: number, to: number): void {
  const range = host.ownerDocument.createRange();
  const node = host.firstChild ?? host;
  range.setStart(node, from);
  range.setEnd(node, to);
  const selection = host.ownerDocument.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretHost(): HTMLElement | null {
  const selection = document.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const node = selection.getRangeAt(0).startContainer;
  const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  return el?.closest<HTMLElement>('[data-slot]') ?? null;
}

describe('the hosts a block gets', () => {
  it('gives each kind the element its published renderer uses, keyed on the slot and not on the kind', () => {
    const view = surface({
      blocks: [
        { kind: 'paragraph', text: 'p' },
        { kind: 'heading', text: 'h' },
        { kind: 'quote', text: 'q', attribution: 'a' },
        { kind: 'image', src: '/x.webp', alt: 'x', caption: 'c' },
        { kind: 'bulletList', items: ['one', 'two'] },
      ],
    });
    expect(view.hosts().map((el) => el.tagName.toLowerCase())).toEqual([
      'p',
      'h2',
      // A quote has TWO slots and they are not the same element -- this is the
      // pair a tag table keyed on kind alone gets wrong.
      'p',
      'cite',
      'figcaption',
      'li',
      'li',
    ]);
  });

  it('puts each host inside the chrome its published renderer draws', () => {
    const view = surface({
      blocks: [
        { kind: 'quote', text: 'q', attribution: 'a' },
        { kind: 'image', src: '/x.webp', alt: 'x', caption: 'c' },
        { kind: 'numberList', items: ['one'] },
      ],
    });
    const [quoteText, cite, caption, item] = view.hosts();
    expect(quoteText.parentElement?.tagName.toLowerCase()).toBe('blockquote');
    expect(cite.parentElement?.tagName.toLowerCase()).toBe('blockquote');
    expect(caption.parentElement?.tagName.toLowerCase()).toBe('figure');
    expect(item.parentElement?.tagName.toLowerCase()).toBe('ol');
  });

  it('makes every host editable and names its slot on itself', () => {
    const view = surface({ blocks: [{ kind: 'quote', text: 'q', attribution: 'a' }] });
    view.hosts().forEach((el) => expect(el.getAttribute('contenteditable')).toBe('true'));
    expect(view.hosts().map((el) => el.dataset.slotKey)).toEqual(['text', 'attribution']);
  });

  it('gives an atom no host at all', () => {
    const view = surface({
      blocks: [
        { kind: 'gallery', images: [{ src: '/a.webp', alt: 'a' }] },
        { kind: 'citation', publication: 'Vogue', date: '2026-01-01', url: null },
      ],
    });
    expect(view.hosts()).toEqual([]);
  });

  it('survives a restored draft with no blocks array and one with a kind this model never had', () => {
    expect(surface({ blocks: undefined as unknown as Block[] }).hosts()).toEqual([]);
    cleanup();
    expect(surface({ blocks: [{ kind: 'marquee' } as unknown as Block] }).hosts()).toEqual([]);
  });
});

describe('what each host is given to hold', () => {
  it('writes its own block’s words into it, as elements rather than as delimiters', () => {
    const view = surface({
      blocks: [
        { kind: 'paragraph', text: 'the **first** one' },
        { kind: 'paragraph', text: 'the *second* one' },
      ],
    });
    const [first, second] = view.hosts();
    expect(first.textContent).toBe('the first one');
    expect(first.querySelector('strong')?.textContent).toBe('first');
    expect(first.querySelector('em')).toBeNull();
    expect(second.textContent).toBe('the second one');
    expect(second.querySelector('em')?.textContent).toBe('second');
    expect(second.querySelector('strong')).toBeNull();
  });

  it('gives each slot of one block its own field', () => {
    const view = surface({ blocks: [{ kind: 'quote', text: 'the words', attribution: 'a name' }] });
    expect(view.hosts().map((el) => el.textContent)).toEqual(['the words', 'a name']);
  });

  it('leaves an empty slot empty rather than writing anything into it', () => {
    const view = surface({ blocks: [{ kind: 'image', src: '/x.webp', alt: 'x' }] });
    expect(view.hosts()[0].textContent).toBe('');
  });

  // The published look of a host -- the height an empty one keeps, whether a
  // mark is visible, where the caret sits inside it -- is a rendering claim
  // and is deferred to e2e/writing-surface.spec.ts.
});

describe('an edit', () => {
  it('replaces one block and hands every other one back by IDENTITY', () => {
    // D5, stated as the thing it actually protects: the array is
    // authoritative, so an edit is a `map` that replaces exactly one entry.
    // A surface that rebuilt Block[] from the DOM would produce all-new
    // objects here, and stable-names.ts's WeakMap would lose every staged
    // photo at once.
    const spy = vi.fn();
    const blocks: Block[] = [
      { kind: 'paragraph', text: 'alpha' },
      { kind: 'paragraph', text: 'beta' },
      { kind: 'heading', text: 'gamma' },
    ];
    const view = surface({ blocks, onChange: spy });
    types(view.hosts()[0], 'alpha and more');

    const next = spy.mock.calls[0][0] as Block[];
    expect(next).toHaveLength(3);
    expect(next[0]).not.toBe(blocks[0]);
    expect(next[0]).toEqual({ kind: 'paragraph', text: 'alpha and more' });
    expect(next[1]).toBe(blocks[1]);
    expect(next[2]).toBe(blocks[2]);
    expect(blocks[0]).toEqual({ kind: 'paragraph', text: 'alpha' });
  });

  it('reads the host as a tree and stores markdown source, not markup', () => {
    const spy = vi.fn();
    const view = surface({ blocks: [{ kind: 'paragraph', text: 'plain' }], onChange: spy });
    const host = view.hosts()[0];
    host.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = 'loud';
    host.appendChild(document.createTextNode('a '));
    host.appendChild(strong);
    fireEvent.input(host);
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'a **loud**' });
  });

  it('writes an emptied caption out of the block rather than blanking it', () => {
    const spy = vi.fn();
    const view = surface({
      blocks: [{ kind: 'image', src: '/x.webp', alt: 'x', caption: 'the terrace' }],
      onChange: spy,
    });
    types(view.hosts()[0], '   ');
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'image', src: '/x.webp', alt: 'x' });
  });

  it('writes one list item and leaves its neighbours alone', () => {
    const spy = vi.fn();
    const view = surface({ blocks: [{ kind: 'bulletList', items: ['one', 'two', 'three'] }], onChange: spy });
    types(view.hosts()[1], 'TWO');
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'bulletList', items: ['one', 'TWO', 'three'] });
  });
});

describe('a staged photo survives the block being typed into', () => {
  // The whole reason D5 is shaped the way it is. A photo she has picked is
  // filed under `blocks[<name>]`, and the name lives in a WeakMap keyed on
  // the block OBJECT -- so the name has to be carried onto the new object
  // every commit produces, or her photo's bytes end up under a name nothing
  // refers to and the post publishes naming a file that was never sent.
  it('carries the block’s name onto the object the edit produces', () => {
    const names = createStableNames('b');
    const before: Block = { kind: 'paragraph', text: 'alpha' };
    const spy = vi.fn();
    const view = surface({ blocks: [before], onChange: spy, names });
    const nameBefore = names.nameOf(before, 0);

    types(view.hosts()[0], 'alpha and more');

    const after = (spy.mock.calls[0][0] as Block[])[0];
    expect(after).not.toBe(before);
    expect(names.nameOf(after, 0)).toBe(nameBefore);
  });

  it('keeps the slot’s address across the commit, so the key a photo is filed under does not move', () => {
    const spy = vi.fn();
    const names = createStableNames('b');
    const { container } = render(
      <Harness initial={[{ kind: 'paragraph', text: 'alpha' }]} spy={spy} names={names} />,
    );
    const host = container.querySelector<HTMLElement>('[data-slot]');
    const address = host?.dataset.slot;
    expect(address).toBeDefined();

    types(host as HTMLElement, 'alpha and more');

    const after = container.querySelector<HTMLElement>(`[data-slot="${address}"]`);
    expect(after).not.toBeNull();
    expect(after?.textContent).toBe('alpha and more');
  });

  it('keeps an address attached to its block across a reorder, not to the position', () => {
    const names = createStableNames('b');
    const alpha: Block = { kind: 'paragraph', text: 'alpha' };
    const beta: Block = { kind: 'paragraph', text: 'beta' };
    const view = surface({ blocks: [alpha, beta], names });
    const addressAlpha = view.hosts()[0].dataset.slot;

    view.rerender(<WritingSurface {...props({ blocks: [beta, alpha], names })} />);

    const hosts = view.hosts();
    expect(hosts.map((el) => el.textContent)).toEqual(['beta', 'alpha']);
    // The same address, now second. A positional address would have handed
    // this one beta's words.
    expect(hosts[1].dataset.slot).toBe(addressAlpha);
    expect(view.at(addressAlpha as string)?.textContent).toBe('alpha');
  });
});

describe('React never takes the host’s subtree back', () => {
  it('leaves the words she just typed exactly where they are after the commit round trip', () => {
    // The value coming back down is recognised as already written, so the
    // layout effect leaves the host alone -- the same text node survives.
    // In a browser that is what keeps her caret; here it is only the DOM
    // claim, and the caret itself is deferred to e2e/writing-surface.spec.ts.
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: 'alpha' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    host.textContent = 'alpha and more';
    const typed = host.firstChild;
    fireEvent.input(host);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(host.isConnected).toBe(true);
    expect(host.firstChild).toBe(typed);
    expect(host.textContent).toBe('alpha and more');
  });

  it('does not rewrite a host she is inside, even when the array changes underneath it', () => {
    // The single most important behavioural rule in the surface. What jsdom
    // can show is the REWRITE being suppressed; that suppressing it is what
    // saves her caret and her selection is a browser claim, deferred to
    // e2e/writing-surface.spec.ts.
    const names = createStableNames('b');
    const before: Block = { kind: 'paragraph', text: 'alpha' };
    const after: Block = { kind: 'paragraph', text: 'omega' };
    const view = surface({ blocks: [before], names });
    const host = view.hosts()[0];
    fireEvent.focus(host);

    names.rename(before, after, 0);
    view.rerender(<WritingSurface {...props({ blocks: [after], names })} />);

    expect(host.isConnected).toBe(true);
    expect(host.textContent).toBe('alpha');
  });

  it('does rewrite a host she is NOT inside when the array changes underneath it', () => {
    const names = createStableNames('b');
    const before: Block = { kind: 'paragraph', text: 'alpha' };
    const after: Block = { kind: 'paragraph', text: 'omega' };
    const view = surface({ blocks: [before], names });
    const host = view.hosts()[0];

    names.rename(before, after, 0);
    view.rerender(<WritingSurface {...props({ blocks: [after], names })} />);

    expect(host.isConnected).toBe(true);
    expect(host.textContent).toBe('omega');
  });

  it('writes into a host that has just been created, whatever it wrote into an earlier one', () => {
    // The memo is keyed on the ELEMENT, so a host React has just built is
    // always written. Keyed on the address it would remember a value the new
    // element does not hold and leave her block blank.
    const names = createStableNames('b');
    const alpha: Block = { kind: 'paragraph', text: 'alpha' };
    const view = surface({ blocks: [alpha], names });

    view.rerender(<WritingSurface {...props({ blocks: [], names })} />);
    expect(view.hosts()).toEqual([]);

    view.rerender(<WritingSurface {...props({ blocks: [alpha], names })} />);
    expect(view.hosts()[0].textContent).toBe('alpha');
  });
});

describe('problems', () => {
  // The banner by its OWN name. `[aria-label]` on its own used to be enough
  // to find it; the toolbar row carries one too, and a selector that matched
  // both would have gone green on the wrong element.
  const BANNER = '[aria-label="Problems with this post\u2019s content"]';
  const say = (field: string, message: string): ValidationProblem => ({ field, message });

  it('reaches the slot it names, and only that slot', () => {
    const view = surface({
      blocks: [
        { kind: 'paragraph', text: 'alpha' },
        { kind: 'quote', text: 'q', attribution: 'a' },
      ],
      problems: [say('[0].blocks[1].attribution', 'Say who said it.')],
    });
    const [paragraph, quoteText, attribution] = view.hosts();
    expect(paragraph.getAttribute('aria-describedby')).toBeNull();
    expect(quoteText.getAttribute('aria-describedby')).toBeNull();

    const errorId = attribution.getAttribute('aria-describedby');
    expect(errorId).toBe('posts-0-block-1-attribution-error');
    const message = document.getElementById(errorId as string);
    expect(message?.getAttribute('role')).toBe('alert');
    expect(message?.textContent).toBe('Say who said it.');
    expect(view.container.querySelector(BANNER)).toBeNull();
  });

  it('tells two blocks with the SAME field apart by their index', () => {
    const view = surface({
      blocks: [
        { kind: 'paragraph', text: 'alpha' },
        { kind: 'paragraph', text: '' },
      ],
      problems: [say('[0].blocks[1].text', 'Write something.')],
    });
    expect(view.hosts()[0].getAttribute('aria-describedby')).toBeNull();
    expect(view.hosts()[1].getAttribute('aria-describedby')).toBe('posts-0-block-1-text-error');
    expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('reaches one item of a list, with its message after the list rather than inside it', () => {
    const view = surface({
      blocks: [{ kind: 'bulletList', items: ['one', 'two'] }],
      problems: [say('[0].blocks[0].items[1]', 'This one is empty.')],
    });
    const [first, second] = view.hosts();
    expect(first.getAttribute('aria-describedby')).toBeNull();
    expect(second.getAttribute('aria-describedby')).toBe('posts-0-block-0-items-1-error');
    const message = document.getElementById('posts-0-block-0-items-1-error') as HTMLElement;
    // A `<p>` between two `<li>` is not something a list may contain.
    expect(message.parentElement?.tagName.toLowerCase()).not.toBe('ul');
    expect(message.previousElementSibling?.tagName.toLowerCase()).toBe('ul');
  });

  it('leaves another post’s problems alone', () => {
    const view = surface({
      blocks: [{ kind: 'paragraph', text: 'alpha' }],
      problems: [say('[1].blocks[0].text', 'Not this post.'), say('[0].name', 'Not a block at all.')],
    });
    expect(view.hosts()[0].getAttribute('aria-describedby')).toBeNull();
    expect(view.container.textContent).not.toContain('Not this post.');
    expect(view.container.textContent).not.toContain('Not a block at all.');
  });

  it('puts a problem naming a block index this post no longer has into the banner, exactly once', () => {
    const view = surface({
      blocks: [{ kind: 'paragraph', text: 'alpha' }],
      problems: [say('[0].blocks[7].text', 'A block that is gone.')],
    });
    const banner = view.container.querySelector('[role="alert"]') as HTMLElement;
    expect(banner.getAttribute('aria-label')).toBe('Problems with this post’s content');
    expect(banner.querySelectorAll('li')).toHaveLength(1);
    expect(banner.textContent).toContain('A block that is gone.');
    expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('puts a problem about the block LIST into the banner', () => {
    const view = surface({
      blocks: [],
      problems: [say('[0].blocks', 'This post has nothing in it yet.')],
    });
    const banner = view.container.querySelector('[role="alert"]') as HTMLElement;
    expect(banner.textContent).toContain('This post has nothing in it yet.');
  });

  // `alt` used to be this case's example, and Task 23 took it: the photograph
  // now renders a description field of its own, so `alt` is claimed and the
  // case below asserts the other half of the same partition. `src` is the
  // field that is still on no control -- the picker inserts a block that
  // already has one, so an empty `src` only reaches a restored draft, and
  // dropping its message would be the silent loss D4 forbids.
  it('puts a problem about a field no control carries into the banner, so it is never in neither place', () => {
    const view = surface({
      blocks: [{ kind: 'image', src: '', alt: 'x', caption: 'c' }],
      problems: [say('[0].blocks[0].src', 'This photo block has no photo in it.')],
    });
    const banner = view.container.querySelector(BANNER) as HTMLElement;
    expect(banner.textContent).toContain('This photo block has no photo in it.');
    expect(banner.querySelectorAll('li')).toHaveLength(1);
    expect(view.hosts()[0].getAttribute('aria-describedby')).toBeNull();
  });

  it('never puts one problem in both places', () => {
    const view = surface({
      blocks: [{ kind: 'paragraph', text: '' }],
      problems: [say('[0].blocks[0].text', 'Write something.')],
    });
    expect(view.container.querySelector(BANNER)).toBeNull();
    expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(view.hosts()[0].getAttribute('aria-describedby')).toBe('posts-0-block-0-text-error');
  });
});

describe('Enter and Backspace', () => {
  it('splits the paragraph she is in and hands every other block back by IDENTITY', () => {
    // The array transformation itself is proved exhaustively in
    // structure.test.ts. What this proves is the WIRING: that the surface
    // reads the caret off the live host, hands `before`/`after` over as this
    // slot's own source, and passes the result of that -- not a rebuild of
    // the tree -- to onChange.
    const spy = vi.fn();
    const initial: Block[] = [
      { kind: 'heading', text: 'Before you start' },
      { kind: 'paragraph', text: 'one two' },
      { kind: 'image', src: '/food/x.webp', alt: 'x' },
    ];
    const { container } = render(<Harness initial={initial} spy={spy} />);
    const host = container.querySelectorAll<HTMLElement>('[data-slot]')[1];
    caretAt(host, 4);
    fireEvent.keyDown(host, { key: 'Enter' });

    const next = spy.mock.calls[0][0] as Block[];
    expect(next).toEqual([
      { kind: 'heading', text: 'Before you start' },
      { kind: 'paragraph', text: 'one ' },
      { kind: 'paragraph', text: 'two' },
      { kind: 'image', src: '/food/x.webp', alt: 'x' },
    ]);
    expect(next[0]).toBe(initial[0]);
    expect(next[3]).toBe(initial[2]);
  });

  it('carries the block’s name across a split, so a staged photograph stays attached to it', () => {
    // The whole reason `Edit` carries a rename list. A caption split leaves
    // the SAME photograph in the array with fewer words under it; without the
    // rename that photograph is a new object with a new name, and the bytes
    // she staged are filed under a name nothing refers to any more.
    const names = createStableNames('b');
    const image: Block = { kind: 'image', src: '/food/x.webp', alt: 'x', caption: 'on the terrace' };
    const spy = vi.fn();
    const { container } = render(<Harness initial={[image]} spy={spy} names={names} />);
    const was = names.nameOf(image, 0);

    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 6);
    fireEvent.keyDown(host, { key: 'Enter' });

    const next = spy.mock.calls[0][0] as Block[];
    expect(next[0]).toEqual({ kind: 'image', src: '/food/x.webp', alt: 'x', caption: 'on the' });
    expect(next[0]).not.toBe(image);
    expect(names.nameOf(next[0], 0)).toBe(was);
    // And the paragraph the split created is not called the same thing.
    expect(names.nameOf(next[1], 1)).not.toBe(was);
  });

  it('suppresses the browser’s own Enter, and leaves Shift+Enter entirely alone', () => {
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: 'one two' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 4);

    expect(fireEvent.keyDown(host, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(host, { key: 'Enter' })).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    // What the suppressed default BUYS -- that the browser did not split the
    // host's tree underneath the array -- is not observable in jsdom, which
    // implements no default action for a key in an editable host at all. That
    // is e2e/writing-surface.spec.ts.
  });

  it('writes the shorter half into the host she was standing in', () => {
    // The focused-host rule says a host she is inside is never rewritten. A
    // split has to lift that, or the top half keeps every word on screen that
    // the array now says belongs to the block beneath it -- the screen and the
    // data disagreeing, silently, which is the worst shape this can take.
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: 'one two' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    caretAt(host, 4);
    fireEvent.keyDown(host, { key: 'Enter' });

    const hosts = container.querySelectorAll<HTMLElement>('[data-slot]');
    expect([...hosts].map((el) => el.textContent)).toEqual(['one ', 'two']);
  });

  it('puts the caret into the host the edit names', () => {
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: 'one two' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 4);
    fireEvent.keyDown(host, { key: 'Enter' });

    const hosts = container.querySelectorAll<HTMLElement>('[data-slot]');
    expect(caretHost()).toBe(hosts[1]);
    // That a browser then SHOWS the caret there, and keeps it there while she
    // keeps typing, is deferred to e2e/writing-surface.spec.ts.
  });

  it('leaves the caret at the END of the block a merge folded two into', () => {
    // Which END is the whole point, and it is the half a focus() call cannot
    // stand in for: focusing an editable host puts the caret at the start of
    // it, and a merge that dropped her at the start would put every keystroke
    // in front of the paragraph she was joining rather than at the seam.
    const spy = vi.fn();
    const { container } = render(
      <Harness initial={[{ kind: 'paragraph', text: 'one' }, { kind: 'paragraph', text: 'two' }]} spy={spy} />,
    );
    const host = container.querySelectorAll<HTMLElement>('[data-slot]')[1];
    caretAt(host, 0);
    fireEvent.keyDown(host, { key: 'Backspace' });

    const merged = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    expect(merged.textContent).toBe('onetwo');
    const selection = document.getSelection() as Selection;
    expect(selection.isCollapsed).toBe(true);
    const range = selection.getRangeAt(0);
    expect(range.startContainer).toBe(merged);
    expect(range.startOffset).toBe(merged.childNodes.length);
    expect(range.startOffset).toBeGreaterThan(0);
  });

  it('merges a paragraph into the one above it when Backspace comes at the very start', () => {
    const spy = vi.fn();
    const initial: Block[] = [
      { kind: 'paragraph', text: 'one' },
      { kind: 'paragraph', text: 'two' },
      { kind: 'heading', text: 'after' },
    ];
    const { container } = render(<Harness initial={initial} spy={spy} />);
    const host = container.querySelectorAll<HTMLElement>('[data-slot]')[1];
    caretAt(host, 0);
    expect(fireEvent.keyDown(host, { key: 'Backspace' })).toBe(false);

    const next = spy.mock.calls[0][0] as Block[];
    expect(next).toEqual([{ kind: 'paragraph', text: 'onetwo' }, { kind: 'heading', text: 'after' }]);
    expect(next[1]).toBe(initial[2]);
  });

  it('leaves a Backspace that is not at the start to the browser', () => {
    const spy = vi.fn();
    const { container } = render(
      <Harness initial={[{ kind: 'paragraph', text: 'one' }, { kind: 'paragraph', text: 'two' }]} spy={spy} />,
    );
    const host = container.querySelectorAll<HTMLElement>('[data-slot]')[1];
    caretAt(host, 1);
    expect(fireEvent.keyDown(host, { key: 'Backspace' })).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaves a Backspace over a selection to the browser, even one starting at the top', () => {
    // With words selected, everything to the left of the SELECTION is empty,
    // which reads exactly like a caret at the start of the block. Deleting
    // what she highlighted is not merging the block into the one above it.
    const spy = vi.fn();
    const { container } = render(
      <Harness initial={[{ kind: 'paragraph', text: 'one' }, { kind: 'paragraph', text: 'two' }]} spy={spy} />,
    );
    const host = container.querySelectorAll<HTMLElement>('[data-slot]')[1];
    selects(host, 0, 2);
    expect(fireEvent.keyDown(host, { key: 'Backspace' })).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaves a Backspace the array has no answer for to the browser, and the photograph where it was', () => {
    // Backspace at the top of a caption, with a paragraph directly above it.
    // Every ingredient for the merge is present except the one that matters,
    // and the answer is to do nothing at all rather than fold a photograph
    // into the words above it.
    const spy = vi.fn();
    const { container } = render(
      <Harness
        initial={[
          { kind: 'paragraph', text: 'a' },
          { kind: 'image', src: '/food/x.webp', alt: 'x', caption: 'on the terrace' },
        ]}
        spy={spy}
      />,
    );
    const host = container.querySelectorAll<HTMLElement>('[data-slot]')[1];
    caretAt(host, 0);
    expect(fireEvent.keyDown(host, { key: 'Backspace' })).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('figure')).not.toBeNull();
  });

  it('leaves every other key completely alone', () => {
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: 'one two' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 4);
    ['a', 'Tab', 'ArrowUp', 'Delete', 'End'].forEach((key) => {
      expect(fireEvent.keyDown(host, { key })).toBe(true);
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('typing a trigger', () => {
  it('turns a paragraph into a bulleted list and takes the hyphen off the screen with it', () => {
    // Not just the array. The trigger characters have to LEAVE the host, and
    // the reason a host she has already typed into is rewritten at all is that
    // the written-value memo is keyed on the element: the `li` React builds
    // here has never been written to, so the memo has nothing to say about it.
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: '-' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 1);
    expect(fireEvent.keyDown(host, { key: ' ' })).toBe(false);

    expect(spy.mock.calls[0][0]).toEqual([{ kind: 'bulletList', items: [''] }]);
    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.textContent).not.toContain('-');
    const item = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    expect(item.tagName.toLowerCase()).toBe('li');
    expect(item.dataset.slotKey).toBe('items[0]');
    expect(caretHost()).toBe(item);
  });

  it('turns a paragraph into a heading and puts the caret in it', () => {
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: '#' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 1);
    fireEvent.keyDown(host, { key: ' ' });

    expect(spy.mock.calls[0][0]).toEqual([{ kind: 'heading', text: '' }]);
    const heading = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    expect(heading.tagName.toLowerCase()).toBe('h2');
    expect(caretHost()).toBe(heading);
  });

  it('keeps the block’s name across the conversion, so a staged photograph is not orphaned', () => {
    const names = createStableNames('b');
    const paragraph: Block = { kind: 'paragraph', text: '>' };
    const spy = vi.fn();
    const { container } = render(<Harness initial={[paragraph]} spy={spy} names={names} />);
    const was = names.nameOf(paragraph, 0);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 1);
    fireEvent.keyDown(host, { key: ' ' });

    const next = spy.mock.calls[0][0] as Block[];
    expect(next).toEqual([{ kind: 'quote', text: '' }]);
    expect(names.nameOf(next[0], 0)).toBe(was);
  });

  it('leaves every other block in the post alone, by reference', () => {
    const spy = vi.fn();
    const initial: Block[] = [
      { kind: 'image', src: '/food/x.webp', alt: 'x' },
      { kind: 'paragraph', text: '1.' },
      { kind: 'heading', text: 'after' },
    ];
    const { container } = render(<Harness initial={initial} spy={spy} />);
    const host = container.querySelectorAll<HTMLElement>('[data-slot]')[1];
    caretAt(host, 2);
    fireEvent.keyDown(host, { key: ' ' });

    const next = spy.mock.calls[0][0] as Block[];
    expect(next[0]).toBe(initial[0]);
    expect(next[2]).toBe(initial[2]);
    expect(next[1]).toEqual({ kind: 'numberList', items: [''] });
  });

  it('leaves an ordinary space completely alone', () => {
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: 'I paid' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 6);
    expect(fireEvent.keyDown(host, { key: ' ' })).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaves a space typed over a selection alone', () => {
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: '-x' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    selects(host, 1, 2);
    expect(fireEvent.keyDown(host, { key: ' ' })).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the escape hatch: Backspace straight after a conversion', () => {
  it('puts the trigger characters and the space back, so "1. 50" can be written', () => {
    // Without this the owner can never write a sentence that opens "1. " at
    // all, because every attempt silently becomes a numbered list -- and it
    // looks like the editor is simply like that, so nobody reports it.
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: '1.' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 2);
    fireEvent.keyDown(host, { key: ' ' });

    const item = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    expect(fireEvent.keyDown(item, { key: 'Backspace' })).toBe(false);

    expect(spy.mock.calls[1][0]).toEqual([{ kind: 'paragraph', text: '1. ' }]);
    const back = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    expect(back.tagName.toLowerCase()).toBe('p');
    expect(container.querySelector('ol')).toBeNull();
    expect(back.textContent).toBe('1. ');
  });

  it('does not fire on the SECOND Backspace, which does the ordinary thing instead', () => {
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: '#' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 1);
    fireEvent.keyDown(host, { key: ' ' });

    const heading = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.keyDown(heading, { key: 'Backspace' });
    expect(spy.mock.calls[1][0]).toEqual([{ kind: 'paragraph', text: '# ' }]);

    // A second press is a Backspace at the top of the first block of the post,
    // and there is nothing above it to merge into.
    const back = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(back, 0);
    expect(fireEvent.keyDown(back, { key: 'Backspace' })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not fire once she has typed anything else', () => {
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: '#' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 1);
    fireEvent.keyDown(host, { key: ' ' });

    const heading = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.keyDown(heading, { key: 'a' });
    caretAt(heading, 0);
    fireEvent.keyDown(heading, { key: 'Backspace' });

    // The ordinary rule: a heading demotes before it merges. Nothing here is a
    // paragraph holding "# ".
    expect(spy.mock.calls[1][0]).toEqual([{ kind: 'paragraph', text: '' }]);
  });

  it('does not fire once words have arrived without a key at all', () => {
    // A paste and a composition both commit through `input` and never through
    // a key. The conversion has to stop being undoable then too.
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: '#' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    caretAt(host, 1);
    fireEvent.keyDown(host, { key: ' ' });

    const heading = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    types(heading, 'Before you start');
    caretAt(heading, 0);
    fireEvent.keyDown(heading, { key: 'Backspace' });

    expect(spy.mock.calls[2][0]).toEqual([{ kind: 'paragraph', text: 'Before you start' }]);
  });

  it('does not fire in a DIFFERENT block from the one that was converted', () => {
    const spy = vi.fn();
    const initial: Block[] = [{ kind: 'paragraph', text: 'above' }, { kind: 'paragraph', text: '#' }];
    const { container } = render(<Harness initial={initial} spy={spy} />);
    const host = container.querySelectorAll<HTMLElement>('[data-slot]')[1];
    caretAt(host, 1);
    fireEvent.keyDown(host, { key: ' ' });

    const first = container.querySelectorAll<HTMLElement>('[data-slot]')[0];
    caretAt(first, 0);
    expect(fireEvent.keyDown(first, { key: 'Backspace' })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('undo and redo', () => {
  // What jsdom can honestly say here is the half that matters most: which
  // array comes back out, and whether the objects in it are the same objects
  // that went in. That the keystroke reaches this handler at all rather than
  // the browser's own contenteditable undo is deferred to Task 28.
  it('puts back the words that were there before, and the block OBJECT they were in', () => {
    const spy = vi.fn();
    const before: Block = { kind: 'paragraph', text: 'alpha' };
    const { container } = render(<Harness initial={[before]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);

    types(host, 'alpha and more');
    fireEvent.keyDown(host, { key: 'z', metaKey: true });

    const restored = spy.mock.calls[spy.mock.calls.length - 1][0] as Block[];
    // Identity, not equality. stable-names.ts keys a staged photograph's name
    // on this object; an undo that rebuilt the block would restore her words
    // and lose her picture.
    expect(restored[0]).toBe(before);
    expect(container.querySelector<HTMLElement>('[data-slot]')?.textContent).toBe('alpha');
  });

  it('leaves a staged photograph attached: the image block comes back under the name it was filed as', () => {
    // A caption split REPLACES the image block with a new object carrying the
    // same name (Task 18). Undo hands the original object back, and because
    // the WeakMap still holds it -- the snapshot is what kept it reachable --
    // its name is the one the photo's bytes are filed under.
    const names = createStableNames('b');
    const photo: Block = { kind: 'image', src: '/posts/x.webp', alt: 'x', caption: 'ab' };
    const spy = vi.fn();
    const { container } = render(<Harness initial={[photo]} spy={spy} names={names} />);
    const filedAs = names.nameOf(photo, 0);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    host.textContent = 'ab';
    caretAt(host, 1);

    fireEvent.keyDown(host, { key: 'Enter' });
    expect((spy.mock.calls[0][0] as Block[])).toHaveLength(2);

    fireEvent.keyDown(container.querySelector<HTMLElement>('[data-slot]') as HTMLElement, { key: 'z', metaKey: true });

    const restored = spy.mock.calls[spy.mock.calls.length - 1][0] as Block[];
    expect(restored).toHaveLength(1);
    expect(restored[0]).toBe(photo);
    expect(names.nameOf(restored[0], 0)).toBe(filedAs);
  });

  it('suppresses the browser’s own undo', () => {
    // fireEvent returns false when the default was prevented, so the
    // suppression itself is directly observable here -- which the plan
    // predicted it would not be. Without it a browser runs its private
    // contenteditable undo over DOM the array knows nothing about and the two
    // disagree from that moment on.
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: 'alpha' }]} spy={vi.fn()} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    expect(fireEvent.keyDown(host, { key: 'z', metaKey: true })).toBe(false);
    expect(fireEvent.keyDown(host, { key: 'z', metaKey: true, shiftKey: true })).toBe(false);
  });

  it('redoes what it undid, and Cmd+Z with nothing behind it changes nothing', () => {
    const spy = vi.fn();
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: 'alpha' }]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    types(host, 'alpha and more');
    fireEvent.keyDown(host, { key: 'z', metaKey: true });
    expect(container.textContent).toContain('alpha');

    fireEvent.keyDown(
      container.querySelector<HTMLElement>('[data-slot]') as HTMLElement,
      { key: 'z', metaKey: true, shiftKey: true },
    );
    expect(container.querySelector<HTMLElement>('[data-slot]')?.textContent).toBe('alpha and more');

    // Nothing left behind it. The array must not move.
    const calls = spy.mock.calls.length;
    fireEvent.keyDown(
      container.querySelector<HTMLElement>('[data-slot]') as HTMLElement,
      { key: 'z', metaKey: true, shiftKey: true },
    );
    expect(spy.mock.calls).toHaveLength(calls);
  });

  it('takes a whole run of typing back in one press, not one character', () => {
    const spy = vi.fn();
    const before: Block = { kind: 'paragraph', text: '' };
    const { container } = render(<Harness initial={[before]} spy={spy} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    types(host, 'a');
    types(host, 'al');
    types(host, 'alp');
    types(host, 'alph');

    fireEvent.keyDown(container.querySelector<HTMLElement>('[data-slot]') as HTMLElement, { key: 'z', metaKey: true });

    const restored = spy.mock.calls[spy.mock.calls.length - 1][0] as Block[];
    expect(restored[0]).toBe(before);
  });

  it('leaves every other modifier combination to the browser', () => {
    // Cmd+A, Cmd+C and Cmd+V are hers and the browser's. A handler that
    // swallowed them would be a worse defect than anything it bought.
    const { container } = render(<Harness initial={[{ kind: 'paragraph', text: 'alpha' }]} spy={vi.fn()} />);
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    expect(fireEvent.keyDown(host, { key: 'a', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(host, { key: 'v', metaKey: true })).toBe(true);
  });
});

describe('the toolbar', () => {
  function press(container: HTMLElement, label: string): void {
    const button = [...container.querySelectorAll('button')].find((el) => el.textContent === label);
    expect(button, `no control reading ${label}`).toBeDefined();
    fireEvent.click(button as HTMLButtonElement);
  }

  function ready(initial: Block[], spy: (next: Block[]) => void, names?: StableNames) {
    const view = render(<Harness initial={initial} spy={spy} names={names} />);
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    return { ...view, host };
  }

  it('is a group and not a toolbar, and carries twelve buttons and one label', () => {
    // `role="toolbar"` promises arrow-key navigation and one tab stop.
    // Thirteen plain controls with thirteen tab stops do not have it, and
    // claiming it would describe behaviour to a screen-reader user that this
    // row does not implement.
    const view = surface({ blocks: [{ kind: 'paragraph', text: 'a' }] });
    const row = view.container.querySelector('[aria-label="Formatting"]') as HTMLElement;
    expect(row.getAttribute('role')).toBe('group');
    expect(view.container.querySelector('[role="toolbar"]')).toBeNull();
    expect([...row.querySelectorAll('button')].map((el) => el.textContent)).toEqual([
      'Bold', 'Italic', 'Underline', 'Strikethrough', 'Link', 'Heading',
      'Bulleted list', 'Numbered list', 'Quote', 'Undo', 'Redo', 'Clear formatting',
    ]);
    const label = row.querySelector('label') as HTMLLabelElement;
    expect(label.textContent).toBe('Image');
    // Not a button: a browser opens the picker only under a live user
    // activation, so the control has to be the label over the input itself.
    expect(label.getAttribute('for')).toBe('posts-0-writing-image');
  });

  it('holds the caret in her words when a control is pressed', () => {
    // Without the suppressed default the browser moves focus to the button
    // before the click fires, the host blurs, and the selection every one of
    // these actions works on is already gone.
    const view = surface({ blocks: [{ kind: 'paragraph', text: 'a' }] });
    const bold = [...view.container.querySelectorAll('button')].find((el) => el.textContent === 'Bold');
    expect(fireEvent.mouseDown(bold as HTMLButtonElement)).toBe(false);
  });

  it('Bold writes the mark into the block the host belongs to', () => {
    const spy = vi.fn();
    const view = ready([{ kind: 'paragraph', text: 'abcd' }], spy);
    selects(view.host, 1, 3);

    press(view.container, 'Bold');

    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'a**bc**d' });
  });

  it('refuses Bold and Italic on exactly the same words, and says so instead of losing one', () => {
    // The one shape this grammar cannot spell. inline-source.ts drops a mark
    // rather than writing delimiters that come back as literal asterisks, and
    // committing anyway would be the failure this task exists to prevent: it
    // goes bold, she clicks away, it is plain again, nothing said why.
    const spy = vi.fn();
    const view = ready([{ kind: 'paragraph', text: 'abcd' }], spy);
    selects(view.host, 1, 3);
    press(view.container, 'Bold');
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    const strong = host.querySelector('strong') as HTMLElement;
    selects(strong.firstChild as unknown as HTMLElement, 0, 2);

    press(view.container, 'Italic');

    expect(view.container.textContent).toContain('cannot both be kept on exactly the same words');
    // Nothing was committed, and the host holds what it held: the screen and
    // the array still agree.
    expect(spy.mock.calls).toHaveLength(1);
    expect(host.querySelector('em')).toBeNull();
    expect(host.querySelector('strong')?.textContent).toBe('bc');
  });

  it('Heading converts the block, keeps its name, and hands the others back by reference', () => {
    const names = createStableNames('b');
    const first: Block = { kind: 'paragraph', text: 'alpha' };
    const second: Block = { kind: 'paragraph', text: 'beta' };
    const spy = vi.fn();
    const view = ready([first, second], spy, names);
    const was = names.nameOf(first, 0);

    press(view.container, 'Heading');

    const next = spy.mock.calls[0][0] as Block[];
    expect(next[0]).toEqual({ kind: 'heading', text: 'alpha' });
    expect(next[1]).toBe(second);
    expect(names.nameOf(next[0], 0)).toBe(was);
  });

  it('pressing the kind it already is turns it back into a paragraph', () => {
    const spy = vi.fn();
    const view = ready([{ kind: 'heading', text: 'alpha' }], spy);
    press(view.container, 'Heading');
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'alpha' });
  });

  it('keeps every item when a list becomes something else', () => {
    const spy = vi.fn();
    const view = ready([{ kind: 'bulletList', items: ['one', 'two', 'three'] }], spy);
    press(view.container, 'Quote');
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'quote', text: 'one two three' });
  });

  it('never lets a kind button dissolve a photograph', () => {
    // `wordsIn` can only carry a block's markdown slots across, so converting
    // an image would keep its caption and destroy the picture.
    const photo: Block = { kind: 'image', src: '/posts/x.webp', alt: 'x', caption: 'c' };
    const spy = vi.fn();
    const view = ready([photo], spy);
    press(view.container, 'Heading');
    expect(spy).not.toHaveBeenCalled();
  });

  it('gives a quotation’s attribution a paragraph of its own rather than dropping it', () => {
    const spy = vi.fn();
    const view = ready([{ kind: 'quote', text: 'q', attribution: 'her' }], spy);
    press(view.container, 'Heading');
    expect(spy.mock.calls[0][0]).toEqual([
      { kind: 'heading', text: 'q' },
      { kind: 'paragraph', text: 'her' },
    ]);
  });

  it('Link asks, checks the target twice, and writes the run it checked', () => {
    const spy = vi.fn();
    const view = ready([{ kind: 'paragraph', text: 'abcd' }], spy);
    selects(view.host, 1, 3);
    const asked = vi.spyOn(window, 'prompt').mockReturnValue('/menu');

    press(view.container, 'Link');

    expect(asked.mock.calls[0][0]).toContain('starting with https://');
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'a[bc](/menu)d' });
    asked.mockRestore();
  });

  it('refuses an unusable target in her own words, and writes nothing', () => {
    const spy = vi.fn();
    const view = ready([{ kind: 'paragraph', text: 'abcd' }], spy);
    selects(view.host, 1, 3);
    const asked = vi.spyOn(window, 'prompt').mockReturnValue('javascript:alert(1)');

    press(view.container, 'Link');

    expect(view.container.textContent).toContain('will not work as a link');
    expect(spy).not.toHaveBeenCalled();
    asked.mockRestore();
  });

  it('refuses a target that would read back as some other target at publish', () => {
    // isSafeHref accepts this; rawLinkTargets does not read it back as what
    // she pasted, so validatePosts would refuse the post at publish naming a
    // target she never typed.
    const spy = vi.fn();
    const view = ready([{ kind: 'paragraph', text: 'abcd' }], spy);
    selects(view.host, 1, 3);
    const asked = vi.spyOn(window, 'prompt').mockReturnValue('https://ok.example/x](javascript:alert(1)');

    press(view.container, 'Link');

    expect(view.container.textContent).toContain('will not work as a link');
    expect(spy).not.toHaveBeenCalled();
    asked.mockRestore();
  });

  // A refusal is about the target she just tried, and it stops being about
  // anything the moment she carries on writing. It also announces itself as an
  // alert, so a stale one goes on winning PostList's "take me to the first
  // one" against real validation problems further down the post -- which is
  // where this is proved end to end (PostList.test.tsx's own refusal case).
  it('stops saying so once she carries on typing', () => {
    const spy = vi.fn();
    const view = ready([{ kind: 'paragraph', text: 'abcd' }], spy);
    selects(view.host, 1, 3);
    const asked = vi.spyOn(window, 'prompt').mockReturnValue('javascript:alert(1)');
    press(view.container, 'Link');
    expect(view.container.textContent).toContain('will not work as a link');

    types(view.host, 'abcde');

    expect(view.container.textContent).not.toContain('will not work as a link');
    asked.mockRestore();
  });

  it('Cancel writes nothing and says nothing', () => {
    const spy = vi.fn();
    const view = ready([{ kind: 'paragraph', text: 'abcd' }], spy);
    selects(view.host, 1, 3);
    const asked = vi.spyOn(window, 'prompt').mockReturnValue(null);

    press(view.container, 'Link');

    expect(spy).not.toHaveBeenCalled();
    expect(view.container.textContent).not.toContain('will not work as a link');
    asked.mockRestore();
  });

  it('Clear formatting takes the marks off the selection', () => {
    const spy = vi.fn();
    const view = ready([{ kind: 'paragraph', text: '**abcd**' }], spy);
    const range = document.createRange();
    range.selectNodeContents(view.host);
    const selection = document.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);

    press(view.container, 'Clear formatting');

    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'abcd' });
  });

  it('does nothing at all when she has not been writing in any host yet', () => {
    const spy = vi.fn();
    const view = render(<Harness initial={[{ kind: 'paragraph', text: 'abcd' }]} spy={spy} />);
    press(view.container, 'Bold');
    press(view.container, 'Heading');
    expect(spy).not.toHaveBeenCalled();
  });

  it('Undo and Redo through the buttons are the same steps the keys take', () => {
    const spy = vi.fn();
    const before: Block = { kind: 'paragraph', text: 'alpha' };
    const view = ready([before], spy);
    types(view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement, 'alpha and more');

    press(view.container, 'Undo');
    expect((spy.mock.calls[spy.mock.calls.length - 1][0] as Block[])[0]).toBe(before);

    press(view.container, 'Redo');
    expect((spy.mock.calls[spy.mock.calls.length - 1][0] as Block[])[0]).toEqual({
      kind: 'paragraph', text: 'alpha and more',
    });
  });
});

describe('the shortcuts', () => {
  it('Cmd+B does what the Bold button does, and suppresses the browser’s own', () => {
    const spy = vi.fn();
    const view = render(<Harness initial={[{ kind: 'paragraph', text: 'abcd' }]} spy={spy} />);
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    selects(host, 1, 3);

    expect(fireEvent.keyDown(host, { key: 'b', metaKey: true })).toBe(false);
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'a**bc**d' });
  });

  it('Cmd+I and Cmd+U write the other two marks a key can reach', () => {
    const spy = vi.fn();
    const view = render(<Harness initial={[{ kind: 'paragraph', text: 'abcd' }]} spy={spy} />);
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    selects(host, 1, 3);
    fireEvent.keyDown(host, { key: 'i', metaKey: true });
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'a*bc*d' });

    const other = render(<Harness initial={[{ kind: 'paragraph', text: 'abcd' }]} spy={spy} />);
    const second = other.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(second);
    selects(second, 1, 3);
    fireEvent.keyDown(second, { key: 'u', metaKey: true });
    expect((spy.mock.calls[1][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'a__bc__d' });
  });

  it('Cmd+K asks for a link and Cmd+\\ clears', () => {
    const spy = vi.fn();
    const view = render(<Harness initial={[{ kind: 'paragraph', text: 'abcd' }]} spy={spy} />);
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    selects(host, 1, 3);
    const asked = vi.spyOn(window, 'prompt').mockReturnValue('/menu');
    expect(fireEvent.keyDown(host, { key: 'k', metaKey: true })).toBe(false);
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'a[bc](/menu)d' });
    asked.mockRestore();

    const next = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(next);
    const selection = document.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(fireEvent.keyDown(next, { key: '\\', metaKey: true })).toBe(false);
    expect((spy.mock.calls[1][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'abcd' });
  });

  it('is reached by Ctrl as well as Cmd, because she may not be on a Mac', () => {
    const spy = vi.fn();
    const view = render(<Harness initial={[{ kind: 'paragraph', text: 'abcd' }]} spy={spy} />);
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    selects(host, 1, 3);
    fireEvent.keyDown(host, { key: 'b', ctrlKey: true });
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'a**bc**d' });
  });
});

// A clipboard, spelled the way RTL spells one: jsdom has no DataTransfer, so
// `clipboardData` is an object with the one method the surface is allowed to
// call. That is exactly what makes the first case below a real claim -- a
// handler reaching for `text/html` would be asking this object for something
// the test can see it ask for.
function pastes(host: HTMLElement, text: string): { prevented: boolean; getData: ReturnType<typeof vi.fn> } {
  const getData = vi.fn((type: string) => (type === 'text/plain' ? text : '<b>rich</b>'));
  const prevented = fireEvent.paste(host, { clipboardData: { getData } }) === false;
  return { prevented, getData };
}

describe('paste', () => {
  it('never asks the clipboard for its rich flavour', () => {
    const view = surface({ blocks: [{ kind: 'paragraph', text: '' }] });
    const host = view.hosts()[0];
    fireEvent.focus(host);
    caretAt(host, 0);
    const { getData } = pastes(host, 'pasted');
    expect(getData).toHaveBeenCalledWith('text/plain');
    expect(getData).not.toHaveBeenCalledWith('text/html');
  });

  // Directly observable, and the plan predicted it would not be: `fireEvent`
  // returns false when the default was prevented, the same discovery Tasks
  // 18-19 made for Enter. What the suppression BUYS -- that a real browser
  // would otherwise have dropped the source page's own markup into the host --
  // is still browser-only and is deferred to e2e/writing-surface.spec.ts.
  it('suppresses the browser own paste, including for a clipboard of only spaces', () => {
    const view = surface({ blocks: [{ kind: 'paragraph', text: '' }] });
    const host = view.hosts()[0];
    fireEvent.focus(host);
    caretAt(host, 0);
    expect(pastes(host, 'words').prevented).toBe(true);
    expect(pastes(host, '   ').prevented).toBe(true);
  });

  // The clipboard text goes in as a TEXT NODE, so the surface never reads it
  // as markdown: pasting the source of a markdown document gives her the
  // characters she can see. Writing the same string in through writeInline
  // instead would turn her quoted asterisks into a bold run she never asked
  // for, and this is the case that says so.
  it('pasted asterisks stay characters', () => {
    const spy = vi.fn();
    const view = render(<Harness initial={[{ kind: 'paragraph', text: '' }]} spy={spy} />);
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    caretAt(host, 0);
    pastes(host, 'a **b** c');
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'a \\*\\*b\\*\\* c' });
  });

  it('a blank line becomes a second paragraph, standing after the one she was in', () => {
    const spy = vi.fn();
    const view = render(
      <Harness initial={[{ kind: 'paragraph', text: 'x' }, { kind: 'paragraph', text: 'tail' }]} spy={spy} />,
    );
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    caretAt(host, 1);
    pastes(host, 'one\n\ntwo\n\nthree');
    // The LAST array handed up is the whole paste: the words that went into
    // the host she was standing in, then the rest of it after her, then the
    // block that was already below.
    const last = spy.mock.calls[spy.mock.calls.length - 1][0] as Block[];
    expect(last).toEqual([
      { kind: 'paragraph', text: 'xone' },
      { kind: 'paragraph', text: 'two' },
      { kind: 'paragraph', text: 'three' },
      { kind: 'paragraph', text: 'tail' },
    ]);
  });

  // Two onChange calls in one gesture, and the second one has to build on the
  // first. Built on the array this render closed over instead, the words that
  // went into her own host are handed back up unchanged and the first pasted
  // paragraph disappears the instant the rest of it arrives.
  it('does not discard the words it put in her own host when the rest arrives', () => {
    const spy = vi.fn();
    const view = render(<Harness initial={[{ kind: 'paragraph', text: '' }]} spy={spy} />);
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    caretAt(host, 0);
    pastes(host, 'one\n\ntwo');
    const last = spy.mock.calls[spy.mock.calls.length - 1][0] as Block[];
    expect(last[0]).toEqual({ kind: 'paragraph', text: 'one' });
  });

  it('hands every block it did not touch back by IDENTITY', () => {
    const spy = vi.fn();
    const blocks: Block[] = [
      { kind: 'paragraph', text: 'above' },
      { kind: 'paragraph', text: '' },
      { kind: 'image', src: '/x.webp', alt: 'x', caption: 'c' },
    ];
    const view = render(<Harness initial={blocks} spy={spy} />);
    const host = view.container.querySelectorAll<HTMLElement>('[data-slot]')[1];
    fireEvent.focus(host);
    caretAt(host, 0);
    pastes(host, 'one\n\ntwo');
    const last = spy.mock.calls[spy.mock.calls.length - 1][0] as Block[];
    expect(last[0]).toBe(blocks[0]);
    expect(last[3]).toBe(blocks[2]);
    expect(last[1]).not.toBe(blocks[1]);
  });

  // Where the caret is left is the difference between one paste and one paste
  // followed by everything she types next landing in the middle of it.
  it('leaves her at the end of the LAST paragraph she pasted', () => {
    const spy = vi.fn();
    const view = render(<Harness initial={[{ kind: 'paragraph', text: '' }]} spy={spy} />);
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    caretAt(host, 0);
    pastes(host, 'one\n\ntwo\n\nthree');
    expect(caretHost()?.textContent).toBe('three');
  });

  it('replaces the words she had selected rather than adding to them', () => {
    const spy = vi.fn();
    const view = render(<Harness initial={[{ kind: 'paragraph', text: 'abcd' }]} spy={spy} />);
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    selects(host, 1, 3);
    pastes(host, 'X');
    expect((spy.mock.calls[0][0] as Block[])[0]).toEqual({ kind: 'paragraph', text: 'aXd' });
  });

  // The same containment guard marks.ts carries, and for the same reason: the
  // document holds ONE selection, and it need not be inside the host the event
  // was dispatched on. Without this, a paste builds words into a block nobody
  // asked about and nothing ever commits -- formatting the array has never
  // heard of, until the next rewrite silently removes it.
  it('does nothing when the selection is standing in a different block', () => {
    const spy = vi.fn();
    const view = render(
      <Harness initial={[{ kind: 'paragraph', text: 'here' }, { kind: 'paragraph', text: 'there' }]} spy={spy} />,
    );
    const [first, second] = [...view.container.querySelectorAll<HTMLElement>('[data-slot]')];
    fireEvent.focus(second);
    caretAt(second, 0);
    pastes(first, 'X');
    expect(spy).not.toHaveBeenCalled();
    expect(first.textContent).toBe('here');
    expect(second.textContent).toBe('there');
  });

  it('a paste is one step back, never folded into the typing either side of it', () => {
    const spy = vi.fn();
    const view = render(<Harness initial={[{ kind: 'paragraph', text: '' }]} spy={spy} />);
    const host = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(host);
    types(host, 'typed');
    caretAt(host, 5);
    pastes(host, 'one\n\ntwo');
    const back = view.container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.keyDown(back, { key: 'z', metaKey: true });
    const last = spy.mock.calls[spy.mock.calls.length - 1][0] as Block[];
    expect(last).toEqual([{ kind: 'paragraph', text: 'typed' }]);
  });
});

// The four kinds no toolbar button can reach, and the menu that adds them.
//
// What is being protected here is not a menu. It is that a post which ALREADY
// holds one of these opens with it on screen: the array is authoritative, so a
// kind this column declined to draw would be a kind she edits around, publishes
// over, and loses from the live site with nothing having said so.
describe('the insert menu, and the four kinds the toolbar cannot reach', () => {
  // The menu by its own heading rather than by "every button on the surface" --
  // the toolbar above it is made of buttons too, and a selector that matched
  // both would go green on the wrong row.
  function menu(container: HTMLElement): HTMLButtonElement[] {
    const heading = [...container.querySelectorAll('p')].find((el) => el.textContent === 'Add to this post');
    return [...(heading?.parentElement?.querySelectorAll('button') ?? [])];
  }

  function pick(container: HTMLElement, label: string): HTMLButtonElement {
    const found = menu(container).find((button) => (button.textContent ?? '').includes(label));
    expect(found, `no menu entry for "${label}"`).toBeDefined();
    return found as HTMLButtonElement;
  }

  const kindsOf = (blocks: Block[]): unknown[] => blocks.map((block) => (block as { kind?: unknown }).kind);

  it('offers exactly the four, on a surface with nothing written in it yet', () => {
    // Unconditional, and that is the case that matters: an empty post shows
    // the validator's "has nothing in it yet" and a menu that appeared only
    // once blocks existed would leave her reading a complaint with no remedy.
    const view = surface({ blocks: [] });
    expect(menu(view.container)).toHaveLength(INSERT_MENU_KINDS.length);
    INSERT_MENU_KINDS.forEach((kind) => {
      expect(pick(view.container, BLOCK_KIND_LABELS[kind])).toBeDefined();
    });
    expect(menu(view.container).some((b) => (b.textContent ?? '').includes(BLOCK_KIND_LABELS.paragraph))).toBe(false);
  });

  it('adds the kind she picked directly after the block she was writing in, and moves nothing else', () => {
    const alpha: Block = { kind: 'paragraph', text: 'alpha' };
    const beta: Block = { kind: 'paragraph', text: 'beta' };
    const spy = vi.fn();
    const view = surface({ blocks: [alpha, beta], onChange: spy });
    fireEvent.focus(view.hosts()[0]);

    fireEvent.click(pick(view.container, BLOCK_KIND_LABELS.ingredients));

    const next = spy.mock.calls[0][0] as Block[];
    expect(kindsOf(next)).toEqual(['paragraph', 'ingredients', 'paragraph']);
    // Every block it did not add comes back as the IDENTICAL object -- the
    // rule the whole surface is built on, and the thing that keeps a staged
    // photograph attached to the block it was picked for.
    expect(next[0]).toBe(alpha);
    expect(next[2]).toBe(beta);
    expect((next[1] as { heading?: string }).heading).toBe('Ingredients');
  });

  it('appends when she has not stood in a block yet, rather than doing nothing', () => {
    const spy = vi.fn();
    const view = surface({ blocks: [{ kind: 'paragraph', text: 'alpha' }], onChange: spy });
    fireEvent.click(pick(view.container, BLOCK_KIND_LABELS.citation));
    expect(kindsOf(spy.mock.calls[0][0] as Block[])).toEqual(['paragraph', 'citation']);
  });

  it('adds to an empty post, where there is no block to stand after at all', () => {
    const spy = vi.fn();
    const view = surface({ blocks: [], onChange: spy });
    fireEvent.click(pick(view.container, BLOCK_KIND_LABELS.gallery));
    expect(kindsOf(spy.mock.calls[0][0] as Block[])).toEqual(['gallery']);
  });

  it('gives each of the four its own fields, and none of them an editable host', () => {
    const view = surface({
      blocks: [
        { kind: 'gallery', images: [{ src: '/a.webp', alt: 'a' }] },
        { kind: 'ingredients', heading: 'For the sauce', items: ['400g flour'] },
        { kind: 'steps', heading: 'Method', items: ['Make a well'] },
        { kind: 'citation', publication: 'Vogue', date: '2026-01-01', url: null },
      ],
    });
    expect(view.hosts()).toEqual([]);
    expect(screen.getByLabelText('Ingredient 1')).toHaveValue('400g flour');
    expect(screen.getByLabelText('Step 1')).toHaveValue('Make a well');
    expect(screen.getByLabelText('Publication')).toHaveValue('Vogue');
    expect(screen.getAllByLabelText('Photo description')).toHaveLength(1);
  });

  // A recipe list she has emptied down to nothing has no slots either, so the
  // "no slots, draw nothing" rule the prose kinds follow would make the whole
  // block disappear -- heading, Add button and all -- leaving her a post she
  // cannot get back into.
  it('draws a recipe list she has emptied down to no items at all', () => {
    surface({ blocks: [{ kind: 'ingredients', heading: 'For the sauce', items: [] }] });
    expect(screen.getByLabelText('Heading for the ingredients')).toHaveValue('For the sauce');
    expect(screen.getByRole('button', { name: 'Add an ingredient' })).toBeInTheDocument();
  });

  // types.ts types a recipe heading `string` and not InlineText, and
  // blocks.tsx draws it with no markdown around it -- so an editable host here
  // would let her make a word bold and publish the asterisks as asterisks.
  it('never routes a recipe heading through the markdown pipeline', () => {
    const view = surface({ blocks: [{ kind: 'steps', heading: 'Method', items: ['x'] }] });
    const heading = screen.getByLabelText('Heading for the method');
    expect(heading.tagName.toLowerCase()).toBe('input');
    expect(heading.getAttribute('contenteditable')).toBeNull();
    expect(view.container.querySelector('[data-slot]')).toBeNull();
  });

  it('commits an edit onto a NEW object, carries the name onto it, and hands the rest back by identity', () => {
    const names = createStableNames('b');
    const grid: Block = { kind: 'gallery', images: [{ src: '/a.webp', alt: 'a' }] };
    const after: Block = { kind: 'paragraph', text: 'beta' };
    const spy = vi.fn();
    surface({ blocks: [grid, after], onChange: spy, names });
    const nameBefore = names.nameOf(grid, 0);

    fireEvent.change(screen.getByLabelText('Photo description'), { target: { value: 'A tielle' } });

    const next = spy.mock.calls[0][0] as Block[];
    expect(next[0]).not.toBe(grid);
    expect(next[1]).toBe(after);
    expect(names.nameOf(next[0], 0)).toBe(nameBefore);
  });

  it('an edit inside one of the four is a step undo can put back', () => {
    const spy = vi.fn();
    const grid: Block = { kind: 'gallery', images: [{ src: '/a.webp', alt: 'a' }] };
    const view = render(<Harness initial={[grid]} spy={spy} />);
    fireEvent.change(screen.getByLabelText('Photo description'), { target: { value: 'A tielle' } });
    fireEvent.click(within(view.container).getByRole('button', { name: 'Undo' }));
    expect(spy.mock.calls[spy.mock.calls.length - 1][0]).toEqual([grid]);
  });

  // The D4 partition, in both directions. A problem one of these fields shows
  // must not ALSO stand in the banner over it, and one no field of it carries
  // must not vanish from both.
  describe('their problems', () => {
    const BANNER = '[aria-label="Problems with this post’s content"]';
    const once = (container: HTMLElement, message: string): number =>
      [...container.querySelectorAll('*')].filter(
        (el) => el.children.length === 0 && el.textContent === message,
      ).length;

    it('shows a citation’s own problem on its own field and nowhere else', () => {
      const view = surface({
        blocks: [{ kind: 'citation', publication: '', date: '2026-01-01', url: null }],
        problems: [{ field: '[0].blocks[0].publication', message: 'Say where it was published.' }],
      });
      expect(view.container.querySelector(BANNER)).toBeNull();
      expect(once(view.container, 'Say where it was published.')).toBe(1);
    });

    it('shows an empty photo grid’s list-level message where the photos would be', () => {
      const view = surface({
        blocks: [{ kind: 'gallery', images: [] }],
        problems: [{ field: '[0].blocks[0].images', message: 'This photo grid has nothing in it yet.' }],
      });
      expect(view.container.querySelector(BANNER)).toBeNull();
      expect(once(view.container, 'This photo grid has nothing in it yet.')).toBe(1);
    });

    it('shows a recipe list’s heading problem on the heading field, not in the banner', () => {
      const view = surface({
        blocks: [{ kind: 'ingredients', heading: '', items: ['x'] }],
        problems: [{ field: '[0].blocks[0].heading', message: 'This list needs a heading.' }],
      });
      expect(view.container.querySelector(BANNER)).toBeNull();
      expect(once(view.container, 'This list needs a heading.')).toBe(1);
    });

    it('sends a key none of its fields carries to the banner, exactly once', () => {
      const view = surface({
        blocks: [{ kind: 'citation', publication: 'Vogue', date: '2026-01-01', url: null }],
        problems: [{ field: '[0].blocks[0].level', message: 'Something this site does not use.' }],
      });
      expect(view.container.querySelector(BANNER)?.textContent).toContain('Something this site does not use.');
      expect(once(view.container, 'Something this site does not use.')).toBe(1);
    });

    it('sends a stale photo index to the banner rather than dropping it', () => {
      const view = surface({
        blocks: [{ kind: 'gallery', images: [{ src: '/a.webp', alt: 'a' }] }],
        problems: [{ field: '[0].blocks[0].images[7].src', message: 'A photo she has since removed.' }],
      });
      expect(view.container.querySelector(BANNER)?.textContent).toContain('A photo she has since removed.');
      expect(once(view.container, 'A photo she has since removed.')).toBe(1);
    });
  });
});

// MOVING AND REMOVING, the two things this column could not do at all.
//
// What is being protected here is not a pair of buttons. Task 25 swapped the
// Posts panel off BlockList, which carried Up, Down and Remove on every block,
// and onto this column, which carried none of them -- while Task 24 gave the
// insert menu four kinds that hold no editable slot between them. From that
// commit until this one the owner could add a photograph, a photo grid or a
// citation to a post and never take it out again: Backspace keys off a caret
// carrying a slot, and an atom has no slot for a caret to be in.
describe('moving and removing a block', () => {
  // Scoped to the block's own controls, and it has to be: BlockFields draws a
  // Remove of its own beside every photo in a grid and every line of a recipe
  // ("Remove photo 1", "Remove Ingredient 1"), so a query for everything
  // beginning "Remove " reads three affordances as one. Caught by this test
  // going red on the first run rather than reasoned about.
  const labelled = (container: HTMLElement, prefix: string): string[] =>
    [...container.querySelectorAll('[data-block-controls] button')]
      .map((button) => button.getAttribute('aria-label') ?? '')
      .filter((label) => label.startsWith(prefix));

  function press(container: HTMLElement, label: string): void {
    const button = container.querySelector<HTMLButtonElement>(
      `[data-block-controls] button[aria-label="${label}"]`,
    );
    expect(button, `no control labelled ${label}`).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);
  }

  // Every kind at once, and the last five of them are the whole point: an
  // image, the four the insert menu adds, and a kind this model never had --
  // none of which puts an editable host on screen for any other affordance to
  // act through.
  const EVERY_KIND: Block[] = [
    { kind: 'paragraph', text: 'p' },
    { kind: 'image', src: '/x.webp', alt: 'x' },
    { kind: 'gallery', images: [{ src: '/a.webp', alt: 'a' }] },
    { kind: 'ingredients', heading: 'For the sauce', items: ['400g flour'] },
    { kind: 'steps', heading: 'Method', items: ['Make a well'] },
    { kind: 'citation', publication: 'Vogue', date: '2026-01-01', url: null },
    { kind: 'marquee' } as unknown as Block,
  ];

  it('gives every kind a Remove, including the four the toolbar cannot reach and one it has never heard of', () => {
    const view = surface({ blocks: EVERY_KIND });
    expect(labelled(view.container, 'Remove ')).toEqual([
      'Remove Paragraph block 1',
      'Remove Photo block 2',
      'Remove Photo grid block 3',
      'Remove Ingredients block 4',
      'Remove Method block 5',
      'Remove Where it was published block 6',
      // Drawn with no fields at all by `rowOf`, and the validator's own
      // sentence about it says "remove it and add one from the list instead"
      // -- advice she could not follow while nothing on the block could.
      'Remove Unknown block 7',
    ]);
  });

  it('gives every kind both directions, and names the position as well as the kind', () => {
    const view = surface({ blocks: EVERY_KIND });
    // Omitted at the ends rather than rendered disabled: no Up on the first,
    // no Down on the last.
    expect(labelled(view.container, 'Move ')).toEqual([
      'Move Paragraph block 1 down',
      'Move Photo block 2 up',
      'Move Photo block 2 down',
      'Move Photo grid block 3 up',
      'Move Photo grid block 3 down',
      'Move Ingredients block 4 up',
      'Move Ingredients block 4 down',
      'Move Method block 5 up',
      'Move Method block 5 down',
      'Move Where it was published block 6 up',
      'Move Where it was published block 6 down',
      'Move Unknown block 7 up',
    ]);
  });

  it('reaches a null where a block should be, which a restored draft really can hold', () => {
    // registerLoaded's unchecked cast means the array's entries are whatever
    // localStorage holds. Such an entry gets no slots, no fields and no host,
    // so before this it was an entry she could see the effects of (the
    // validator's own complaint) and never get rid of.
    const spy = vi.fn();
    const view = surface({
      blocks: [{ kind: 'paragraph', text: 'p' }, null as unknown as Block],
      onChange: spy,
    });
    press(view.container, 'Remove Unknown block 2');
    expect(spy.mock.calls[0][0]).toEqual([{ kind: 'paragraph', text: 'p' }]);
  });

  it('tells two blocks of the SAME kind apart, so one label never names two controls', () => {
    const view = surface({
      blocks: [{ kind: 'paragraph', text: 'one' }, { kind: 'paragraph', text: 'two' }],
    });
    expect(view.container.querySelectorAll('[aria-label="Remove Paragraph block 1"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[aria-label="Remove Paragraph block 2"]')).toHaveLength(1);
  });

  it('every control is a real button, which is what makes the keyboard fallback one', () => {
    // A key press on a `<button>` is the browser's own activation, so what
    // jsdom can honestly say is that these are buttons with names rather than
    // clickable elements. That the key actually reaches them, and that the
    // column can be reordered end to end without a pointer, is deferred to
    // e2e/writing-surface.spec.ts.
    const view = surface({ blocks: EVERY_KIND });
    [...view.container.querySelectorAll<HTMLButtonElement>('[data-block-controls] button')].forEach((button) => {
      expect(button.tagName.toLowerCase()).toBe('button');
      expect(button.type).toBe('button');
      expect(button.getAttribute('aria-label')).not.toBeNull();
    });
  });

  it('Remove hands back the array without that block, and every other block by IDENTITY', () => {
    const spy = vi.fn();
    const alpha: Block = { kind: 'paragraph', text: 'alpha' };
    const grid: Block = { kind: 'gallery', images: [{ src: '/a.webp', alt: 'a' }] };
    const omega: Block = { kind: 'paragraph', text: 'omega' };
    const view = surface({ blocks: [alpha, grid, omega], onChange: spy });

    press(view.container, 'Remove Photo grid block 2');

    const next = spy.mock.calls[0][0] as Block[];
    expect(next).toHaveLength(2);
    // Identity, not equality: a removal that rebuilt the survivors would give
    // every one of them a new name and detach every staged photograph on the
    // page at once.
    expect(next[0]).toBe(alpha);
    expect(next[1]).toBe(omega);
  });

  it('removes the citation and the photograph nothing else on this surface can reach', () => {
    const spy = vi.fn();
    const view = surface({
      blocks: [
        { kind: 'image', src: '/x.webp', alt: 'x' },
        { kind: 'citation', publication: 'Vogue', date: '2026-01-01', url: null },
        // A block AFTER it, so "removed the citation" and "dropped the last
        // entry" are not the same array.
        { kind: 'paragraph', text: 'after' },
      ],
      onChange: spy,
    });
    press(view.container, 'Remove Where it was published block 2');
    expect((spy.mock.calls[0][0] as Block[]).map((block) => block.kind)).toEqual(['image', 'paragraph']);

    cleanup();
    const second = surface({ blocks: [{ kind: 'image', src: '/x.webp', alt: 'x' }], onChange: spy });
    press(second.container, 'Remove Photo block 1');
    expect(spy.mock.calls[1][0]).toEqual([]);
  });

  it('Move carries the SAME block objects to their new positions', () => {
    // The one claim this whole affordance stands or falls on. stable-names.ts
    // keys a staged photograph's name on the block OBJECT, so a reorder that
    // handed back rebuilt copies would file her photograph under a name
    // nothing refers to and publish a post naming a file that was never sent.
    const spy = vi.fn();
    const names = createStableNames('b');
    const photo: Block = { kind: 'image', src: '/posts/x.webp', alt: 'x' };
    const words: Block = { kind: 'paragraph', text: 'words' };
    const tail: Block = { kind: 'heading', text: 'after' };
    const view = surface({ blocks: [photo, words, tail], onChange: spy, names });
    const filedAs = names.nameOf(photo, 0);

    press(view.container, 'Move Photo block 1 down');

    const next = spy.mock.calls[0][0] as Block[];
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(words);
    expect(next[1]).toBe(photo);
    expect(next[2]).toBe(tail);
    // And therefore the name the bytes are filed under has not moved either.
    expect(names.nameOf(next[1], 1)).toBe(filedAs);
  });

  it('Move up is the same swap read from the other end', () => {
    const spy = vi.fn();
    const alpha: Block = { kind: 'paragraph', text: 'alpha' };
    const beta: Block = { kind: 'paragraph', text: 'beta' };
    const view = surface({ blocks: [alpha, beta], onChange: spy });

    press(view.container, 'Move Paragraph block 2 up');

    const next = spy.mock.calls[0][0] as Block[];
    expect(next[0]).toBe(beta);
    expect(next[1]).toBe(alpha);
  });

  it('reorders the column on screen, in the order the array says', () => {
    const spy = vi.fn();
    const { container } = render(
      <Harness
        initial={[{ kind: 'paragraph', text: 'alpha' }, { kind: 'paragraph', text: 'beta' }]}
        spy={spy}
      />,
    );
    press(container, 'Move Paragraph block 1 down');
    expect([...container.querySelectorAll('[data-slot]')].map((el) => el.textContent)).toEqual(['beta', 'alpha']);
  });

  it('gives her focus back to the other direction when the control she pressed reaches an end', () => {
    // MEASURED rather than assumed, the same way BlockList measured it: a
    // button that survives the move keeps focus in jsdom by itself, and a
    // button that does not drops focus to `<body>` -- which is the common case,
    // since a block that arrives at either end loses that direction's control
    // entirely. Never Remove, which would leave Enter one press away from
    // deleting the block she was moving.
    const spy = vi.fn();
    const { container } = render(
      <Harness
        initial={[{ kind: 'paragraph', text: 'alpha' }, { kind: 'paragraph', text: 'beta' }]}
        spy={spy}
      />,
    );
    press(container, 'Move Paragraph block 1 down');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move Paragraph block 2 up');
  });

  it('is one step back: Undo puts the removed block into the array as the same object', () => {
    const spy = vi.fn();
    const photo: Block = { kind: 'image', src: '/posts/x.webp', alt: 'x' };
    const view = render(<Harness initial={[{ kind: 'paragraph', text: 'alpha' }, photo]} spy={spy} />);

    press(view.container, 'Remove Photo block 2');
    expect(spy.mock.calls[0][0]).toHaveLength(1);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Undo' }));

    const restored = spy.mock.calls[spy.mock.calls.length - 1][0] as Block[];
    expect(restored).toHaveLength(2);
    // The same object, which is what keeps the photograph she staged for it
    // filed under the name it is still filed under.
    expect(restored[1]).toBe(photo);
  });

  it('is one step back for a move too', () => {
    const spy = vi.fn();
    const alpha: Block = { kind: 'paragraph', text: 'alpha' };
    const beta: Block = { kind: 'paragraph', text: 'beta' };
    const view = render(<Harness initial={[alpha, beta]} spy={spy} />);

    press(view.container, 'Move Paragraph block 1 down');
    fireEvent.click(within(view.container).getByRole('button', { name: 'Undo' }));

    const restored = spy.mock.calls[spy.mock.calls.length - 1][0] as Block[];
    expect(restored[0]).toBe(alpha);
    expect(restored[1]).toBe(beta);
  });
});

// Admin redesign Task 26. The array transformation is proved exhaustively in
// structure.test.ts; what this proves is the WIRING, and one thing beyond it
// that only a DOM can answer: WHICH PRESSES ARE SWALLOWED. `fireEvent` returns
// false when the default was prevented, and that boolean is the whole of the
// keyboard-escape claim jsdom can make -- Tab is how a keyboard user leaves
// this surface, so a handler that took every press would shut her inside the
// post with no way out but a mouse.
//
// Whether focus really moves on the presses left alone is a browser fact
// (jsdom runs no default action for Tab at all) and is deferred to
// e2e/writing-surface.spec.ts, alongside whether one step of nesting is
// legible at 390px.
describe('Tab and Shift+Tab nest a list item', () => {
  function listSurface(initial: Block[], spy: (next: Block[]) => void) {
    const view = render(<Harness initial={initial} spy={spy} />);
    return {
      view,
      item: (index: number) => view.container.querySelectorAll<HTMLElement>('[data-slot]')[index],
    };
  }

  it('nests the item she is standing in under the one above it', () => {
    const spy = vi.fn();
    const { item } = listSurface([{ kind: 'bulletList', items: ['one', 'two'] }], spy);
    const host = item(1);
    caretAt(host, 3);

    expect(fireEvent.keyDown(host, { key: 'Tab' })).toBe(false);
    expect(spy.mock.calls[0][0]).toEqual([{ kind: 'bulletList', items: ['one', 'two'], levels: [0, 1] }]);
  });

  it('steps it back out on Shift+Tab, and takes the levels key with it', () => {
    const spy = vi.fn();
    const { item } = listSurface([{ kind: 'numberList', items: ['one', 'two'], levels: [0, 1] }], spy);
    const host = item(1);
    caretAt(host, 3);

    expect(fireEvent.keyDown(host, { key: 'Tab', shiftKey: true })).toBe(false);
    const next = spy.mock.calls[0][0] as Block[];
    expect(next).toEqual([{ kind: 'numberList', items: ['one', 'two'] }]);
    expect(Object.prototype.hasOwnProperty.call(next[0], 'levels')).toBe(false);
  });

  // Every one of these reaches the browser untouched, which is what keeps Tab
  // working as Tab everywhere it is not a nesting gesture.
  it.each([
    ['the first item of a list, which has nothing to sit under', [{ kind: 'bulletList', items: ['one', 'two'] }] as Block[], 0, false],
    ['an item already as deep as it may go', [{ kind: 'bulletList', items: ['one', 'two'], levels: [0, 1] }] as Block[], 1, false],
    ['a paragraph', [{ kind: 'paragraph', text: 'one' }] as Block[], 0, false],
    // A photograph's caption is a host with no list around it, and it is the
    // reachable half of the "not a nestable kind" rule. The other half -- a
    // recipe's ingredients, whose slot keys are spelled `items[1]` too --
    // cannot be pressed from HERE at all, because those four kinds are drawn
    // by BlockFields and get no editable host. structure.test.ts is where that
    // refusal is pinned, and it matters: writing a `levels` onto an
    // ingredients block would produce one the write boundary refuses.
    ['a photograph’s caption', [{ kind: 'image', src: '/food/x.webp', alt: 'x', caption: 'on the terrace' }] as Block[], 0, false],
    ['Shift+Tab on an item that is already flat', [{ kind: 'bulletList', items: ['one', 'two'] }] as Block[], 1, true],
  ])('leaves Tab to the browser in %s', (_name, initial, index, shiftKey) => {
    const spy = vi.fn();
    const { item } = listSurface(initial, spy);
    const host = item(index);
    caretAt(host, 1);

    expect(fireEvent.keyDown(host, { key: 'Tab', shiftKey })).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaves her caret in the item she nested, rather than in the one above it', () => {
    const spy = vi.fn();
    const { item } = listSurface([{ kind: 'bulletList', items: ['one', 'two'] }], spy);
    const host = item(1);
    caretAt(host, 3);
    fireEvent.keyDown(host, { key: 'Tab' });

    // The words did not change, so this is the one caret claim jsdom can make
    // honestly: the layout effect put the collapsed range back in the same
    // slot. WHERE in the words it sits is a browser fact and is e2e's.
    expect(caretHost()?.dataset.slotKey).toBe('items[1]');
  });

  // WHAT SHE SEES. Without this the array changes and the column does not, so
  // Tab reads as a key that does nothing and she presses it again.
  //
  // jsdom has no layout engine, so this is the class of claim it can make --
  // that the element carries the indent -- and not the one it cannot: whether
  // 1.25rem is enough to read as nesting in a 390px column, which is a
  // bounding-box measurement and belongs to e2e/writing-surface.spec.ts.
  it('moves the nested item across on screen, a step per level', () => {
    const spy = vi.fn();
    const { view, item } = listSurface([{ kind: 'bulletList', items: ['one', 'two'] }], spy);
    expect(item(1).getAttribute('style')).toBeNull();

    caretAt(item(1), 3);
    fireEvent.keyDown(item(1), { key: 'Tab' });
    expect(view.container.querySelectorAll<HTMLElement>('[data-slot]')[1].style.marginInlineStart).toBe('1.25rem');
  });

  it('leaves a flat list with no style attribute at all, exactly as it rendered before nesting existed', () => {
    const { view } = listSurface([{ kind: 'bulletList', items: ['one', 'two', 'three'] }], vi.fn());
    view.container.querySelectorAll('[data-slot]').forEach((el) => {
      expect(el.getAttribute('style')).toBeNull();
    });
  });

  it('is one step back for Undo, not a run of typing', () => {
    const spy = vi.fn();
    const list: Block = { kind: 'bulletList', items: ['one', 'two'] };
    const { view, item } = listSurface([list], spy);
    const host = item(1);
    caretAt(host, 3);
    fireEvent.keyDown(host, { key: 'Tab' });

    fireEvent.click(within(view.container).getByRole('button', { name: 'Undo' }));
    const restored = spy.mock.calls[spy.mock.calls.length - 1][0] as Block[];
    // The identical object, which is what keeps anything staged against this
    // block filed under the name it is still filed under.
    expect(restored[0]).toBe(list);
  });
});
