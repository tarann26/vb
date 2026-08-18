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
import { fireEvent, render, cleanup } from '@testing-library/react';
import WritingSurface, { type WritingSurfaceProps } from '../WritingSurface';
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
    expect(view.container.querySelector('[aria-label]')).toBeNull();
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

  it('puts a problem about a field no slot carries into the banner, so it is never in neither place', () => {
    // `alt` is a real field of a real rendered block and no slot of this
    // surface claims it. Dropping it would be the silent loss D4 forbids.
    const view = surface({
      blocks: [{ kind: 'image', src: '/x.webp', alt: '', caption: 'c' }],
      problems: [say('[0].blocks[0].alt', 'Say what is in the photo.')],
    });
    const banner = view.container.querySelector('[aria-label]') as HTMLElement;
    expect(banner.textContent).toContain('Say what is in the photo.');
    expect(banner.querySelectorAll('li')).toHaveLength(1);
    expect(view.hosts()[0].getAttribute('aria-describedby')).toBeNull();
  });

  it('never puts one problem in both places', () => {
    const view = surface({
      blocks: [{ kind: 'paragraph', text: '' }],
      problems: [say('[0].blocks[0].text', 'Write something.')],
    });
    expect(view.container.querySelector('[aria-label]')).toBeNull();
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
