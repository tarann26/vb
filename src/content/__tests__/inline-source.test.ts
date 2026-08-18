import { describe, expect, it } from 'vitest';
import { parseInline, type InlineNode } from '../markdown';
import { serializeInline } from '../inline-source';

const text = (value: string): InlineNode => ({ kind: 'text', value });

// Two trees are RENDER-equivalent when they differ only in how their text is
// chunked. Inline.tsx renders a text node as a bare string, so ['a','b'] and
// ['ab'] produce identical DOM -- and the serializer legitimately re-chunks,
// because an escape it adds can split one run of source into two.
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
    if (node.kind === 'code') {
      out.push(node);
      return;
    }
    out.push({ ...node, children: normalise(node.children) });
  });
  return out;
}

// EVERY assertion below runs through `normalise`, so a degenerate normalise --
// `() => []` is the obvious one -- would make the whole file vacuous. This is
// the case that stops that: it is the only one here that calls normalise on a
// hand-written literal and checks a hand-written literal back, so it fails on
// any implementation that drops nodes, keeps empty text, or stops recursing.
describe('normalise, the equivalence the round trip is measured under', () => {
  it('merges adjacent text, drops empty text, and recurses into children', () => {
    expect(
      normalise([
        text('a'),
        text(''),
        text('b'),
        { kind: 'em', children: [text('c'), text('d')] },
        { kind: 'code', value: 'x' },
        text('e'),
        text('f'),
      ]),
    ).toEqual([
      text('ab'),
      { kind: 'em', children: [text('cd')] },
      { kind: 'code', value: 'x' },
      text('ef'),
    ]);
  });

  it('does not merge across a mark boundary', () => {
    expect(normalise([text('a'), { kind: 'strong', children: [text('b')] }, text('c')])).toEqual([
      text('a'),
      { kind: 'strong', children: [text('b')] },
      text('c'),
    ]);
  });
});

function roundTrips(source: string): void {
  const once = parseInline(source);
  const twice = parseInline(serializeInline(once));
  expect(normalise(twice), `round trip changed: ${JSON.stringify(source)}`).toEqual(normalise(once));
}

describe('serializeInline round-trips what parseInline produces', () => {
  it.each([
    ['plain words', 'Rest the dough for an hour.'],
    ['bold', 'Rest the **dough** for an hour.'],
    ['emphasis inside bold', '**a *b* c**'],
    ['strike and underline', 'a ~~b~~ and __c__'],
    ['all four marks nested', '**a ~~b __c *d*__~~ e**'],
    ['inline code', 'Set `220 C` and wait'],
    ['a site link', 'See [the menu](/menu) tonight'],
    ['an off-site link', 'See [the piece](https://example.com/a_(b)/c) now.'],
    ['a link with no label', '[](/menu)'],
    ['a label with an escaped bracket', '[a\\]b](/menu)'],
    ['an escaped delimiter', '2 \\* 3 is six'],
    ['a refused link target', 'See [x](javascript:alert(1)) here'],
    ['a lone underscore', 'follow @via_bianca'],
    ['a run of tildes', 'about ~~~200g'],
    ['an escaped tilde before a run', 'a \\~~~b~~'],
    ['a trailing backslash', 'the path C:\\'],
    // The two cases that pin the backslash-doubling step, and neither is the
    // trailing backslash above -- that one survives undoubled, because a `\`
    // at the end of the source escapes nothing on the way back in either. It
    // takes a backslash the reader would otherwise spend on the NEXT
    // character: two in a row (a UNC path), where the pair collapses to one
    // and the share name loses a slash, or one wrapped in a mark, where the
    // pair collapses onto the closing delimiter and the mark disappears.
    ['a run of literal backslashes', 'the share \\\\\\\\srv'],
    ['a backslash as the whole body of an emphasis run', 'a *\\\\* b'],
  ])('%s', (_name, source) => {
    roundTrips(source);
  });
});

// D6 is a claim about the SEVEN inputs markdown.test.ts:88-101 pins as
// non-round-trippable, so those seven are named here one for one rather than
// left to the corpus to happen across. Each parses to a single text node
// equal to its own source, so byte-equality is unrecoverable in principle --
// `a ** b` and `a \*\* b` are the same tree, and nothing can know which was
// typed. Render-equivalence is recoverable, and this is where that is stated.
describe('the seven inputs parseInline cannot round-trip byte-for-byte', () => {
  it.each([
    ['an unclosed bold run', 'Add **salt to taste'],
    ['an unclosed emphasis run', 'Add *salt to taste'],
    ['an unclosed code run', 'Set `220 C'],
    ['a bracket with no target', 'See [the piece] here'],
    ['a target with no closing paren', 'See [x](https://example.com'],
    ['an empty bold run', 'a ** b'],
    ['a closed but empty bold run', 'a **** b'],
  ])('%s survives as the same tree', (_name, source) => {
    roundTrips(source);
    // And the reason it needed the round trip rather than a string compare:
    // every one of them comes back escaped, which is a DIFFERENT string that
    // renders the same words.
    expect(parseInline(source)).toEqual([text(source)]);
  });

  it('writes those seven back with escapes rather than the bytes she typed', () => {
    // Stated positively so the file cannot be read as claiming byte-equality
    // anywhere. This is the exact output, and it is not the input.
    expect(serializeInline(parseInline('a **** b'))).toBe('a \\*\\*\\*\\* b');
    expect(serializeInline(parseInline('See [the piece] here'))).toBe('See \\[the piece\\] here');
  });
});

describe('the assertions the round trip cannot make', () => {
  it('leaves a lone tilde and a lone underscore exactly as she typed them', () => {
    // Over-escaping round-trips fine and would still be wrong: it puts
    // backslashes into her stored JSON that she never wrote.
    expect(serializeInline(parseInline('about ~200g'))).toBe('about ~200g');
    expect(serializeInline(parseInline('follow @via_bianca'))).toBe('follow @via_bianca');
  });

  it('keeps a tilde that ends a mark inside that mark', () => {
    // Hand-built, because parseInline cannot produce this and readInline can.
    const nodes: InlineNode[] = [{ kind: 'strike', children: [text('a~')] }];
    expect(serializeInline(nodes)).toBe('~~a\\~~~');
    expect(normalise(parseInline(serializeInline(nodes)))).toEqual(normalise(nodes));
  });

  it('drops an empty mark and writes nothing for it', () => {
    // Also unreachable from parseInline -- tryDelimited refuses an empty body,
    // so 'a **** b' is one text node. readInline produces empty marks, which
    // is why this guard exists at all.
    expect(serializeInline([{ kind: 'strong', children: [] }])).toBe('');
    expect(serializeInline([{ kind: 'underline', children: [] }])).toBe('');
  });

  it('writes a code value containing a backtick as plain words', () => {
    expect(serializeInline([{ kind: 'code', value: 'a`b' }])).toBe('a\\`b');
  });

  it('writes nothing for an empty code value', () => {
    // The same corruption as the empty mark, one element along: two adjacent
    // backticks are not an empty code span to this parser, they are two
    // backticks on the page.
    expect(serializeInline([{ kind: 'code', value: '' }])).toBe('');
  });
});

it('round-trips five thousand strings drawn from the delimiter alphabet', () => {
  const ALPHABET = 'ab*_~`[]()\\/: h';
  // xorshift32, so the corpus is identical on every machine and a failure is
  // reproducible from the seed alone.
  let state = 0x9e3779b9;
  const next = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  for (let i = 0; i < 5000; i += 1) {
    const length = next() % 24;
    let source = '';
    for (let c = 0; c < length; c += 1) source += ALPHABET[next() % ALPHABET.length];
    roundTrips(source);
  }
});
