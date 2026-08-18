// What jsdom can honestly say about applying a mark.
//
// It implements Selection, Range.extractContents and Range.toString well
// enough for the STRUCTURAL claims, which are the ones that matter: the tree
// these functions build, and the markdown that tree turns into. What it cannot
// say is whether a real browser keeps a selection long enough for any of this
// to be reached, or whether the element it builds is visibly bold on screen.
// Both are deferred to e2e/writing-surface.spec.ts by name.
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMarks, insertLink, LINK_PLACEHOLDER, marksSurviveSave, selectedWords, toggleMark,
} from '../marks';
import { readInline } from '../dom-inline';
import { serializeInline } from '../../../content/inline-source';

afterEach(() => {
  document.body.textContent = '';
  document.getSelection()?.removeAllRanges();
});

function host(words: string): HTMLElement {
  const el = document.createElement('p');
  el.textContent = words;
  document.body.appendChild(el);
  return el;
}

// A selection over `[from, to)` of the host's first text node, which is what a
// drag across a word produces.
function selects(el: Node, from: number, to: number): void {
  const range = document.createRange();
  const node = el.firstChild ?? el;
  range.setStart(node, from);
  range.setEnd(node, to);
  const selection = document.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretAt(el: HTMLElement, offset: number): void {
  selects(el, offset, offset);
}

function source(el: HTMLElement): string {
  return serializeInline(readInline(el));
}

describe('toggleMark', () => {
  it('wraps a selection in the element for that mark', () => {
    const el = host('abcd');
    selects(el, 1, 3);
    toggleMark(el, 'strong');
    expect(el.querySelector('strong')?.textContent).toBe('bc');
    expect(el.textContent).toBe('abcd');
  });

  it('unwraps when the selection is already inside that mark', () => {
    const el = host('a');
    el.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = 'bc';
    el.append('a', strong, 'd');
    selects(strong.firstChild as Text, 0, 2);
    toggleMark(el, 'strong');
    expect(el.querySelector('strong')).toBeNull();
    expect(el.textContent).toBe('abcd');
  });

  it('leaves a placeholder inside an empty mark so it can be typed into', () => {
    // Nothing selected: she is turning emphasis ON and about to type. A
    // totally empty element collapses to a 0x0 box in a real browser, so it
    // gets the same zero-width placeholder EditableText.tsx uses.
    const el = host('ab');
    caretAt(el, 1);
    toggleMark(el, 'em');
    const em = el.querySelector('em');
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe('​');
    // And it contributes nothing to what gets stored.
    expect(source(el)).toBe('ab');
  });

  it('uses s and u, the elements dom-inline.ts reads back', () => {
    // Pinned directly, because a mark written as an element dom-inline.ts does
    // not know flattens to bare words and her formatting vanishes on the next
    // commit with nothing on screen saying so.
    const el = host('abcd');
    selects(el, 1, 3);
    toggleMark(el, 'strike');
    expect(el.querySelector('s')).not.toBeNull();

    const other = host('abcd');
    selects(other, 1, 3);
    toggleMark(other, 'underline');
    expect(other.querySelector('u')).not.toBeNull();
  });

  it('stops at the host and never unwraps something outside it', () => {
    // Two hosts, the second sitting inside a page-level element carrying the
    // same name. Without the stop at the host, toggling in the second one
    // walks straight past it and unwraps the page's element.
    const outer = document.createElement('strong');
    document.body.appendChild(outer);
    const inner = document.createElement('p');
    inner.textContent = 'abcd';
    outer.appendChild(inner);

    selects(inner, 1, 3);
    toggleMark(inner, 'strong');

    expect(outer.isConnected).toBe(true);
    expect(inner.querySelector('strong')?.textContent).toBe('bc');
  });

  it('refuses a selection that is not inside the host it was handed', () => {
    // A range acts where it stands. Without the guard the mark is built into
    // the OTHER block -- which the surface will never commit, because it
    // commits the host it was handed -- so that block ends up showing a mark
    // the array has never heard of until its next rewrite takes it away
    // again. `textContent` cannot see that, which is why the assertion is
    // about the other host's structure and not its words.
    const mine = host('abcd');
    const other = host('wxyz');
    selects(other, 1, 3);

    toggleMark(mine, 'strong');

    expect(mine.querySelector('strong')).toBeNull();
    expect(mine.textContent).toBe('abcd');
    expect(other.querySelector('strong')).toBeNull();
    expect(other.childNodes).toHaveLength(1);
  });

  it('does nothing at all with no selection anywhere', () => {
    const el = host('abcd');
    document.getSelection()?.removeAllRanges();
    toggleMark(el, 'strong');
    expect(el.textContent).toBe('abcd');
    expect(el.childNodes).toHaveLength(1);
  });

  it('produces a tree the reader and serializer turn into markdown', () => {
    const el = host('abcd');
    selects(el, 1, 3);
    toggleMark(el, 'strong');
    expect(source(el)).toBe('a**bc**d');
  });
});

describe('two marks meeting', () => {
  // The shape this module is most likely to build and the one thing the
  // serializer cannot spell. Measured across the whole 4x4 nesting matrix
  // rather than reasoned about.
  it('keeps both when their delimiters are made of different characters', () => {
    const el = host('abcd');
    selects(el, 1, 3);
    toggleMark(el, 'strong');
    const strong = el.querySelector('strong') as HTMLElement;
    selects(strong.firstChild as Text, 0, 2);
    toggleMark(el, 'strike');

    expect(source(el)).toBe('a**~~bc~~**d');
    expect(marksSurviveSave(el)).toBe(true);
  });

  it('reports that bold and emphasis on exactly the same words cannot both be stored', () => {
    // Neither `***x***` nor `*a**b*` reads back as what it was written from,
    // so inline-source.ts drops the outer mark rather than putting delimiters
    // on the page. That is the right trade at the serializer and the wrong
    // thing to do in silence at the toolbar, which is what survivesSave is
    // for: the surface says so instead of letting the bold disappear on the
    // next reload.
    const el = host('abcd');
    selects(el, 1, 3);
    toggleMark(el, 'strong');
    const strong = el.querySelector('strong') as HTMLElement;
    selects(strong.firstChild as Text, 0, 2);
    toggleMark(el, 'em');

    // The mark that goes is the one that was there FIRST: inline-source.ts
    // refuses the OUTER mark, and applying a second one to exactly the same
    // words puts the new one inside the old.
    expect(marksSurviveSave(el)).toBe(false);
    // The words are never lost, and no delimiter reaches the page.
    expect(source(el)).toBe('a*bc*d');
  });

  it('says a single mark survives, so the report above cannot be a constant', () => {
    const el = host('abcd');
    selects(el, 1, 3);
    toggleMark(el, 'strong');
    expect(marksSurviveSave(el)).toBe(true);
  });
});

describe('clearMarks', () => {
  it('replaces the selection with its own plain words', () => {
    const el = document.createElement('p');
    document.body.appendChild(el);
    const strong = document.createElement('strong');
    strong.textContent = 'bold';
    el.appendChild(strong);

    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = document.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);

    clearMarks(el);

    expect(el.querySelector('strong')).toBeNull();
    expect(el.textContent).toBe('bold');
    expect(source(el)).toBe('bold');
  });

  it('takes half of one mark and half of another, which no unwrapping could', () => {
    const el = document.createElement('p');
    document.body.appendChild(el);
    const strong = document.createElement('strong');
    strong.textContent = 'aabb';
    const em = document.createElement('em');
    em.textContent = 'ccdd';
    el.append(strong, em);

    const range = document.createRange();
    range.setStart(strong.firstChild as Text, 2);
    range.setEnd(em.firstChild as Text, 2);
    const selection = document.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);

    clearMarks(el);

    expect(el.textContent).toBe('aabbccdd');
    expect(source(el)).toBe('**aa**bbcc*dd*');
  });

  it('leaves everything alone with nothing selected', () => {
    const el = host('abcd');
    caretAt(el, 2);
    clearMarks(el);
    expect(el.textContent).toBe('abcd');
    expect(el.childNodes).toHaveLength(1);
  });
});

describe('insertLink', () => {
  it('wraps the selection and writes the target it was given', () => {
    const el = host('abcd');
    selects(el, 1, 3);
    insertLink(el, '/menu');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/menu');
    expect(source(el)).toBe('a[bc](/menu)d');
  });

  it('gives an empty selection a word to click, because a label-less link renders as nothing', () => {
    const el = host('ab');
    caretAt(el, 2);
    insertLink(el, 'https://example.com/x');
    expect(el.querySelector('a')?.textContent).toBe(LINK_PLACEHOLDER);
    expect(source(el)).toBe('ab[this](https://example.com/x)');
  });

  it('refuses a selection outside the host', () => {
    const mine = host('abcd');
    const other = host('wxyz');
    selects(other, 1, 3);
    insertLink(mine, '/menu');
    expect(mine.querySelector('a')).toBeNull();
    expect(other.querySelector('a')).toBeNull();
  });
});

describe('selectedWords', () => {
  it('hands back what the selection covers, and null when it is somewhere else', () => {
    const el = host('abcd');
    const other = host('wxyz');
    selects(el, 1, 3);
    expect(selectedWords(el)).toBe('bc');
    selects(other, 0, 4);
    expect(selectedWords(el)).toBeNull();
  });

  it('never hands back the placeholder as though she had typed it', () => {
    const el = host('ab');
    caretAt(el, 1);
    toggleMark(el, 'em');
    expect(selectedWords(el)).toBe('');
  });
});
