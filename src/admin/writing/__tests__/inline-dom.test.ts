import { describe, expect, it } from 'vitest';
import { parseInline, type InlineNode } from '../../../content/markdown';
import { serializeInline } from '../../../content/inline-source';
import { readInline } from '../dom-inline';
import { writeInline } from '../inline-dom';

const text = (value: string): InlineNode => ({ kind: 'text', value });

// D6's equivalence, the same one inline-source.test.ts is measured under:
// two trees are RENDER-equivalent when they differ only in how their text is
// chunked. Inline.tsx renders a text node as a bare string, so ['a','b'] and
// ['ab'] produce identical output.
function normalise(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  nodes.forEach((node) => {
    const last = out[out.length - 1];
    if (node.kind === 'text') {
      if (node.value.length === 0) return;
      if (last !== undefined && last.kind === 'text') {
        out[out.length - 1] = { kind: 'text', value: last.value + node.value };
        return;
      }
      out.push(node);
      return;
    }
    if (node.kind === 'code') { out.push(node); return; }
    out.push({ ...node, children: normalise(node.children) });
  });
  return out;
}

// The DOM direction needs one more allowance than the source direction, and
// exactly one: a tree read off the DOM can hold nodes parseInline can never
// produce -- an empty mark and an empty code value -- and inline-source.ts
// deliberately writes NOTHING for either, because `****` and two adjacent
// backticks are visible corruption rather than an empty span. So a mark that
// holds no words, and a code value with no body, are equivalent to their own
// absence. Nothing else is dropped: an empty LINK is kept, exactly as the
// serializer keeps it.
function normaliseDom(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  normalise(nodes).forEach((node) => {
    if (node.kind === 'code') {
      if (node.value.length > 0) out.push(node);
      return;
    }
    if (node.kind === 'text') { out.push(node); return; }
    const children = normaliseDom(node.children);
    if (node.kind === 'link') { out.push({ ...node, children }); return; }
    if (children.length > 0) out.push({ ...node, children });
  });
  return normalise(out);
}

// EVERY assertion below runs through one of the two functions above, so a
// degenerate one -- `() => []` is the obvious shape -- would make this whole
// file vacuous. These are the cases that stop that: each calls the
// normaliser on a hand-written literal and checks a hand-written literal
// back, so it fails on any implementation that drops what it should keep,
// keeps what it should drop, or stops recursing.
describe('the two equivalences this file measures under', () => {
  it('normalise merges adjacent text, drops empty text, and recurses', () => {
    expect(normalise([text('a'), text(''), text('b'), { kind: 'em', children: [text('c'), text('d')] }])).toEqual([
      text('ab'),
      { kind: 'em', children: [text('cd')] },
    ]);
  });

  it('normalise keeps a mark with no children, which is the whole difference between the two', () => {
    expect(normalise([{ kind: 'strong', children: [] }])).toEqual([{ kind: 'strong', children: [] }]);
  });

  it('normaliseDom drops an empty mark and an empty code value, and keeps an empty link', () => {
    expect(
      normaliseDom([
        text('a'),
        { kind: 'strong', children: [] },
        { kind: 'em', children: [{ kind: 'underline', children: [] }] },
        { kind: 'code', value: '' },
        { kind: 'code', value: 'x' },
        { kind: 'link', href: '/menu', children: [] },
        text('b'),
      ]),
    ).toEqual([text('a'), { kind: 'code', value: 'x' }, { kind: 'link', href: '/menu', children: [] }, text('b')]);
  });

  it('normaliseDom keeps a mark that still has words in it', () => {
    expect(normaliseDom([{ kind: 'strong', children: [text('a'), { kind: 'em', children: [] }] }])).toEqual([
      { kind: 'strong', children: [text('a')] },
    ]);
  });
});

function domOf(source: string): HTMLElement {
  const host = document.createElement('p');
  writeInline(host, source);
  return host;
}

describe('writeInline builds elements, not words', () => {
  it('writes a mark as its element with the words inside it', () => {
    const host = domOf('Rest the **dough** for an hour.');
    expect(Array.from(host.childNodes).map((n) => n.nodeName)).toEqual(['#text', 'STRONG', '#text']);
    expect(host.childNodes[1].textContent).toBe('dough');
  });

  it('writes the four marks as the four elements dom-inline.ts reads back', () => {
    const host = domOf('**a** *b* ~~c~~ __d__');
    expect(Array.from(host.children).map((el) => el.nodeName)).toEqual(['STRONG', 'EM', 'S', 'U']);
  });

  it('writes a link with its target as an attribute', () => {
    const host = domOf('See [the menu](/menu) tonight');
    const anchor = host.children[0];
    expect(anchor.nodeName).toBe('A');
    expect(anchor.getAttribute('href')).toBe('/menu');
    expect(anchor.textContent).toBe('the menu');
  });

  it('writes a code value as one text child of one code element', () => {
    const host = domOf('Set `220 C` and wait');
    const code = host.children[0];
    expect(code.nodeName).toBe('CODE');
    expect(code.childNodes.length).toBe(1);
    expect(code.childNodes[0].nodeType).toBe(3);
  });

  it('writes a refused target as words, never as an element with that target', () => {
    const host = domOf('See [x](javascript:alert(1)) here');
    expect(host.children.length).toBe(0);
    expect(host.textContent).toBe('See [x](javascript:alert(1)) here');
  });

  it('writes a fresh slot rather than appending to it', () => {
    const host = document.createElement('p');
    writeInline(host, 'first');
    writeInline(host, 'second');
    expect(host.textContent).toBe('second');
  });

  it('empties the slot for an empty source', () => {
    const host = document.createElement('p');
    writeInline(host, 'first');
    writeInline(host, '');
    expect(host.childNodes.length).toBe(0);
  });
});

// The four-way loop: source -> DOM -> InlineNode -> source. Task 14 proved
// the second half of it; these two describes are the first half and the
// composition.
function throughTheDom(source: string): string {
  return serializeInline(readInline(domOf(source)));
}

describe('source -> DOM -> source', () => {
  it.each([
    ['plain words', 'Rest the dough for an hour.'],
    ['bold', 'Rest the **dough** for an hour.'],
    ['strike and underline', 'a ~~b~~ and __c__'],
    ['nested marks', '**a *b* c**'],
    ['all four marks nested', '**a ~~b __c *d*__~~ e**'],
    ['a site link', 'See [the menu](/menu) tonight'],
    ['an off-site link', 'See [the piece](https://example.com/a_(b)/c) now.'],
    ['a link with no label', '[](/menu)'],
    ['inline code', 'Set `220 C` and wait'],
    ['an unclosed bold run', 'Add **salt to taste'],
    ['a refused link target', 'See [x](javascript:alert(1)) here'],
    ['a lone underscore', 'follow @via_bianca'],
    ['a lone tilde', 'about ~200g'],
    ['an escaped delimiter', '2 \\* 3 is six'],
    ['a trailing backslash', 'the path C:\\'],
    ['a run of literal backslashes', 'the share \\\\\\\\srv'],
  ])('%s renders the same after a full loop', (_name, source) => {
    // Parsed trees, not strings: the loop may re-chunk and re-escape, and
    // may not change what a reader sees.
    expect(normalise(parseInline(throughTheDom(source)))).toEqual(normalise(parseInline(source)));
  });

  it('reads back the same tree the source parsed to, before any of it is written down', () => {
    // The half of the loop that is this task's own: the DOM the writer built
    // and the tree the parser produced are the same tree. Without this, a
    // writer and a reader that made the SAME mistake would still round-trip.
    const source = '**a *b* c** and [d](/e) and `f`';
    expect(normalise(readInline(domOf(source)))).toEqual(normalise(parseInline(source)));
  });
});

const ALPHABET = 'ab*_~`[]()\\/: h';

// xorshift32 from a fixed seed, so both corpora below are identical on every
// machine and a failure is reproducible from the seed alone.
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

it('round-trips five thousand sources through the DOM', () => {
  const next = seeded(0x9e3779b9);
  for (let i = 0; i < 5000; i += 1) {
    const length = next() % 24;
    let source = '';
    for (let c = 0; c < length; c += 1) source += ALPHABET[next() % ALPHABET.length];
    const parsed = normalise(parseInline(source));
    // Stated as two claims rather than one, so a failure says which half
    // broke: the DOM the writer built reads back as the tree the parser
    // produced, and the whole loop lands where it started.
    expect(normalise(readInline(domOf(source))), `writer/reader disagree: ${JSON.stringify(source)}`).toEqual(parsed);
    expect(normalise(parseInline(throughTheDom(source))), `loop changed: ${JSON.stringify(source)}`).toEqual(parsed);
  }
});

// The other direction, and the one no source can reach: a DOM subtree that
// this surface's own mark tools built. It holds shapes parseInline never
// produces -- an empty mark, an empty code element, a mark applied directly
// on top of another mark -- so a corpus of SOURCES cannot exercise it.
function randomDom(next: () => number, depth: number): Node {
  const doc = document;
  const roll = next() % 100;
  if (roll < 34 || depth >= 4) {
    const length = next() % 6;
    let value = '';
    for (let c = 0; c < length; c += 1) value += ALPHABET[next() % ALPHABET.length];
    return doc.createTextNode(value);
  }
  if (roll < 40) return doc.createElement('br');
  if (roll < 48) {
    const code = doc.createElement('code');
    const length = next() % 4;
    let value = '';
    for (let c = 0; c < length; c += 1) value += ALPHABET[next() % ALPHABET.length];
    code.appendChild(doc.createTextNode(value));
    return code;
  }
  const name = roll < 58 ? 'span'
    : roll < 66 ? 'a'
      : ['strong', 'em', 's', 'u'][next() % 4];
  const el = doc.createElement(name);
  if (name === 'a') el.setAttribute('href', ['/menu', 'https://example.com/a', 'javascript:alert(1)', ''][next() % 4]);
  const count = next() % 3;
  for (let c = 0; c < count; c += 1) el.appendChild(randomDom(next, depth + 1));
  return el;
}

// Every word a tree carries, in order, and nothing about its structure. This
// is what may never change: a mark can be lost on the way to markdown and
// the page still reads correctly, but a lost word is her prose gone and a
// GAINED character is a delimiter showing through.
function wordsOf(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text' || node.kind === 'code') return node.value;
      return wordsOf(node.children);
    })
    .join('');
}

describe('DOM -> source -> DOM', () => {
  // The DOM direction cannot be stated as "one pass changes nothing", and
  // saying so would be false: a tree read off the DOM can hold a mark this
  // grammar has no spelling for -- bold and italic on exactly the same run,
  // where `***x***` is a loose asterisk, a bold run and another loose
  // asterisk -- and inline-source.ts drops that mark rather than putting its
  // delimiters on the page. So the theorem is the two things that ARE true:
  //
  //   1. the WORDS never change, on any pass;
  //   2. the first pass is the only one that can change anything -- every
  //      pass after it is a fixed point.
  //
  // (2) is why this is a round trip at all. After one pass the tree is one
  // parseInline itself produced, and Task 14's theorem takes over from
  // there.
  function loops(host: HTMLElement): void {
    const once = readInline(host);
    const twice = readInline(domOf(serializeInline(once)));
    const thrice = readInline(domOf(serializeInline(twice)));
    const label = host.textContent ?? '';
    expect(wordsOf(twice), `words changed: ${label}`).toEqual(wordsOf(once));
    expect(normaliseDom(thrice), `loop changed: ${label}`).toEqual(normaliseDom(twice));
  }

  function built(build: (root: HTMLElement) => void): HTMLElement {
    const root = document.createElement('p');
    build(root);
    return root;
  }

  function el(name: string, ...children: (Node | string)[]): HTMLElement {
    const node = document.createElement(name);
    children.forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  it('a mark applied on top of another mark, which is the shape no source can reach', () => {
    // Bold a word, then italicise exactly that word. `***x***` is not
    // strong(em(x)) to this parser, so one of the two marks cannot be
    // written down -- but the WORDS must survive, and no delimiter may end
    // up on the page.
    const host = built((r) => r.appendChild(el('strong', el('em', 'x'))));
    loops(host);
    expect(readInline(domOf(serializeInline(readInline(host)))).length).toBeGreaterThan(0);
    expect(domOf(serializeInline(readInline(host))).textContent).toBe('x');
  });

  it('an empty mark, an empty code element and a line break', () => {
    loops(built((r) => {
      r.appendChild(el('strong'));
      r.appendChild(el('code'));
      r.appendChild(el('em', 'a'));
      r.appendChild(document.createElement('br'));
      r.appendChild(document.createTextNode('b'));
    }));
  });

  it('a mark inside a link and a link inside a mark', () => {
    const link = el('a', 'a', el('strong', 'b'));
    link.setAttribute('href', '/menu');
    const inner = el('a', 'd');
    inner.setAttribute('href', 'https://example.com/x');
    loops(built((r) => {
      r.appendChild(link);
      r.appendChild(el('em', 'c ', inner));
    }));
  });

  it('a wrapper it did not create, holding a mark it did', () => {
    const span = el('span', 'a ', el('u', 'b'));
    span.setAttribute('style', 'color:red');
    loops(built((r) => r.appendChild(span)));
  });

  it('two thousand DOM subtrees built from what this surface can produce', () => {
    const next = seeded(0x243f6a88);
    for (let i = 0; i < 2000; i += 1) {
      const host = document.createElement('p');
      const count = next() % 5;
      for (let c = 0; c < count; c += 1) host.appendChild(randomDom(next, 0));
      loops(host);
    }
  });
});
