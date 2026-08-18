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

  it('puts a problem about a field no slot carries into the banner, so it is never in neither place', () => {
    // `alt` is a real field of a real rendered block and no slot of this
    // surface claims it. Dropping it would be the silent loss D4 forbids.
    const view = surface({
      blocks: [{ kind: 'image', src: '/x.webp', alt: '', caption: 'c' }],
      problems: [say('[0].blocks[0].alt', 'Say what is in the photo.')],
    });
    const banner = view.container.querySelector(BANNER) as HTMLElement;
    expect(banner.textContent).toContain('Say what is in the photo.');
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
