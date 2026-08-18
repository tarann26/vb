import { describe, expect, it } from 'vitest';
import { MAX_NESTING_DEPTH, type InlineNode } from '../../../content/markdown';
import { readInline } from '../dom-inline';

// Fixtures are BUILT, never written as a markup string: a string would have to
// be parsed to become a tree, which is the one thing neither this module nor
// its test is allowed to do (src/test/html-sinks.test.ts).
function host(build: (root: HTMLElement) => void): HTMLElement {
  const root = document.createElement('p');
  build(root);
  return root;
}

function el(name: string, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(name);
  children.forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
}

const text = (value: string): InlineNode => ({ kind: 'text', value });

describe('readInline reads what this surface creates', () => {
  it('reads plain words as one text node', () => {
    expect(readInline(host((r) => r.appendChild(document.createTextNode('Rest the dough'))))).toEqual([
      text('Rest the dough'),
    ]);
  });

  it('reads the four mark elements this surface creates', () => {
    const root = host((r) => {
      r.appendChild(el('strong', 'a'));
      r.appendChild(el('em', 'b'));
      r.appendChild(el('s', 'c'));
      r.appendChild(el('u', 'd'));
    });
    expect(readInline(root)).toEqual([
      { kind: 'strong', children: [text('a')] },
      { kind: 'em', children: [text('b')] },
      { kind: 'strike', children: [text('c')] },
      { kind: 'underline', children: [text('d')] },
    ]);
  });

  it('reads a mark inside a mark as a mark inside a mark', () => {
    const root = host((r) => r.appendChild(el('strong', 'a ', el('em', 'b'), ' c')));
    expect(readInline(root)).toEqual([
      { kind: 'strong', children: [text('a '), { kind: 'em', children: [text('b')] }, text(' c')] },
    ]);
  });

  it('reads a code element as a code value', () => {
    expect(readInline(host((r) => r.appendChild(el('code', '220 C'))))).toEqual([{ kind: 'code', value: '220 C' }]);
  });

  it('reads a code element holding a backtick as words, not as a code value', () => {
    // inline-source.ts cannot write this back as a code span -- this grammar
    // has no escape for a backtick inside one -- so it becomes words at the
    // other end too. Both ends make the same call or the value changes shape
    // depending on which direction it travelled.
    expect(readInline(host((r) => r.appendChild(el('code', 'a`b'))))).toEqual([text('a`b')]);
  });

  it('reads an empty code element as an empty code value', () => {
    // Kept, not dropped: inline-source.ts's own guard is what writes nothing
    // for it, for the reason two adjacent backticks are a visible corruption
    // rather than an empty span. The reader states what is there.
    expect(readInline(host((r) => r.appendChild(el('code'))))).toEqual([{ kind: 'code', value: '' }]);
  });

  it('keeps a safe link and drops an unsafe one, keeping its words', () => {
    const safe = el('a', 'the menu');
    safe.setAttribute('href', '/menu');
    const unsafe = el('a', 'this');
    unsafe.setAttribute('href', 'javascript:alert(1)');
    const root = host((r) => {
      r.appendChild(safe);
      r.appendChild(unsafe);
    });
    expect(readInline(root)).toEqual([
      { kind: 'link', href: '/menu', children: [text('the menu')] },
      text('this'),
    ]);
  });

  it('trims the target it keeps, and keeps the marks inside a target it refuses', () => {
    const spaced = el('a', 'menu');
    spaced.setAttribute('href', '  /menu  ');
    const refused = el('a', el('strong', 'shop'));
    refused.setAttribute('href', 'data:text/html,x');
    const bare = el('a', 'no target');
    const root = host((r) => {
      r.appendChild(spaced);
      r.appendChild(refused);
      r.appendChild(bare);
    });
    expect(readInline(root)).toEqual([
      { kind: 'link', href: '/menu', children: [text('menu')] },
      { kind: 'strong', children: [text('shop')] },
      text('no target'),
    ]);
  });

  it('reads a line break as a space, never as nothing', () => {
    const root = host((r) => {
      r.appendChild(document.createTextNode('one'));
      r.appendChild(document.createElement('br'));
      r.appendChild(document.createTextNode('two'));
    });
    expect(readInline(root)).toEqual([text('one'), text(' '), text('two')]);
  });

  it('strips the zero-width placeholder wherever it sits', () => {
    expect(readInline(host((r) => r.appendChild(document.createTextNode('a\u200bb'))))).toEqual([text('ab')]);
    expect(readInline(host((r) => r.appendChild(el('code', 'a\u200bb'))))).toEqual([{ kind: 'code', value: 'ab' }]);
  });

  it('keeps an empty mark with no children', () => {
    // Named for what it asserts. The mark is KEPT here; inline-source.ts's
    // empty-run guard is what drops it on the way to markdown.
    expect(readInline(host((r) => r.appendChild(el('strong', '\u200b'))))).toEqual([{ kind: 'strong', children: [] }]);
  });

  it('reads a DocumentFragment, which is what a cloned Range hands it', () => {
    // The reason the parameter is `Node` and not `HTMLElement`: Task 19 reads
    // a selection back through Range.cloneContents(), which has no element.
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('a '));
    fragment.appendChild(el('em', 'b'));
    expect(readInline(fragment)).toEqual([text('a '), { kind: 'em', children: [text('b')] }]);
  });
});

describe('readInline against DOM this surface did not create', () => {
  it('flattens an element it did not create to its words', () => {
    const span = el('span', 'pasted');
    span.setAttribute('style', 'font-weight:700');
    expect(readInline(host((r) => r.appendChild(span)))).toEqual([text('pasted')]);
  });

  it('flattens the tags a word processor pastes, including the ones that LOOK like marks', () => {
    // `b` and `i` are the whole point of this test. They are the two most
    // likely pasted elements, they carry exactly the meaning this model has a
    // node for, and they are still not what the surface creates -- so they
    // arrive as words. Keeping them would make the set of elements the reader
    // trusts depend on what a clipboard happened to hold.
    const root = host((r) => {
      r.appendChild(el('b', 'bold'));
      r.appendChild(el('i', 'italic'));
      r.appendChild(el('font', 'sized'));
      r.appendChild(el('mark', 'marked'));
    });
    expect(readInline(root)).toEqual([text('bold'), text('italic'), text('sized'), text('marked')]);
  });

  it('flattens a block element where it expected text, keeping the words in order', () => {
    const root = host((r) => {
      r.appendChild(el('div', 'first'));
      r.appendChild(el('div', el('p', 'second')));
    });
    expect(readInline(root)).toEqual([text('first'), text('second')]);
  });

  it('keeps a mark that a wrapper it does not know is standing around', () => {
    // The flattening is of the WRAPPER, not of everything under it: an
    // extension's span around a run she really did bold must not cost her
    // the bold.
    const wrapper = el('span', 'a ', el('strong', 'b'));
    wrapper.setAttribute('style', 'color:red');
    expect(readInline(host((r) => r.appendChild(wrapper)))).toEqual([
      text('a '),
      { kind: 'strong', children: [text('b')] },
    ]);
  });

  it('ignores attributes it does not read', () => {
    const strong = el('strong', 'a');
    strong.setAttribute('style', 'font-weight:400');
    strong.setAttribute('id', 'x');
    strong.setAttribute('data-x', 'y');
    expect(readInline(host((r) => r.appendChild(strong)))).toEqual([{ kind: 'strong', children: [text('a')] }]);
  });

  it('ignores a node that is neither an element nor text, and empty text', () => {
    const root = host((r) => {
      r.appendChild(document.createComment('a comment'));
      r.appendChild(document.createTextNode(''));
      r.appendChild(document.createTextNode('\u200b'));
      r.appendChild(document.createTextNode('kept'));
    });
    expect(readInline(root)).toEqual([text('kept')]);
  });

  it('keeps a link inside a link, both targets, rather than inventing a rule for it', () => {
    // No browser produces this and the surface never builds it, but a
    // clipboard can. Both targets survive the trip to source and back
    // (`[[a](/x)](/y)` re-parses to this same tree), so there is nothing to
    // repair and nothing is thrown away.
    const inner = el('a', 'a');
    inner.setAttribute('href', '/x');
    const outer = el('a', inner);
    outer.setAttribute('href', '/y');
    expect(readInline(host((r) => r.appendChild(outer)))).toEqual([
      { kind: 'link', href: '/y', children: [{ kind: 'link', href: '/x', children: [text('a')] }] },
    ]);
  });
});

// Builds host > el > el > ... > 'x', `depth` elements deep.
function nested(name: string, depth: number): HTMLElement {
  const root = document.createElement('p');
  let cursor: HTMLElement = root;
  for (let i = 0; i < depth; i += 1) {
    const next = document.createElement(name);
    cursor.appendChild(next);
    cursor = next;
  }
  cursor.appendChild(document.createTextNode('x'));
  return root;
}

function depthOf(nodes: InlineNode[]): number {
  const node = nodes[0];
  if (node === undefined || node.kind === 'text' || node.kind === 'code') return 0;
  return 1 + depthOf(node.children);
}

describe('readInline stops nesting where markdown stops carrying it', () => {
  it('keeps a mark nested as deep as parseInline will go, and no deeper', () => {
    // MAX_NESTING_DEPTH is the parser's refusal point (markdown.ts:296).
    // Measured, not assumed: a tree of 32 nested marks survives serialize ->
    // parse; 33 does not, and comes back with its delimiters on the page as
    // literal characters. So the 33rd wrapper contributes its words here,
    // where they are still intact, and the tree it produces is exactly the
    // one 32 wrappers produce.
    expect(depthOf(readInline(nested('em', MAX_NESTING_DEPTH)))).toBe(MAX_NESTING_DEPTH);
    expect(depthOf(readInline(nested('em', MAX_NESTING_DEPTH + 1)))).toBe(MAX_NESTING_DEPTH);
    expect(readInline(nested('em', MAX_NESTING_DEPTH + 1))).toEqual(readInline(nested('em', MAX_NESTING_DEPTH)));
  });

  it('counts a wrapper it would have flattened anyway, so the walk is bounded by this module', () => {
    // What must be bounded is the RECURSION, and a nest of unknown wrappers
    // is the cheapest way for a paste to build a deep one. The words survive
    // either way; what this pins is that the wrappers SPEND the budget, so
    // the depth of the walk is a property of this file rather than of what
    // was on the clipboard. The mark buried under 400 of them is how that is
    // visible from outside: it is past the cap, so it arrives as words.
    expect(readInline(nested('span', 400))).toEqual([text('x')]);
    const buried = nested('span', 400);
    let deepest: Element = buried;
    while (deepest.firstElementChild !== null) deepest = deepest.firstElementChild;
    deepest.appendChild(el('strong', 'y'));
    expect(readInline(buried)).toEqual([text('xy')]);
  });
});
