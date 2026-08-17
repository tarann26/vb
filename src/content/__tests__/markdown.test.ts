import { describe, expect, it } from 'vitest';
import { isSafeHref, parseInline, rawLinkTargets, type InlineNode } from '../markdown';

// Every expected value below is a hand-written literal. Nothing here builds
// its expectation by calling parseInline, isSafeHref or any other function
// under test -- Phase 4's thirteenth unfalsifiable test compared a response
// against the very value it was checking, and corrupting that value left
// 2837 tests green.
const text = (value: string): InlineNode => ({ kind: 'text', value });

describe('parseInline: the four inline forms', () => {
  it('returns plain prose as a single text node', () => {
    expect(parseInline('Rest the dough for an hour.')).toEqual([text('Rest the dough for an hour.')]);
  });

  it('parses bold', () => {
    expect(parseInline('Use **00 flour** here.')).toEqual([
      text('Use '),
      { kind: 'strong', children: [text('00 flour')] },
      text(' here.'),
    ]);
  });

  it('parses italics', () => {
    expect(parseInline('It is *soffritto*, not sauce.')).toEqual([
      text('It is '),
      { kind: 'em', children: [text('soffritto')] },
      text(', not sauce.'),
    ]);
  });

  it('parses inline code and does not look inside it', () => {
    expect(parseInline('Set it to `220 **C**` exactly.')).toEqual([
      text('Set it to '),
      { kind: 'code', value: '220 **C**' },
      text(' exactly.'),
    ]);
  });

  it('parses an off-site link and keeps its children parsed', () => {
    expect(parseInline('See [the **full** piece](https://example.com/a) for more.')).toEqual([
      text('See '),
      {
        kind: 'link',
        href: 'https://example.com/a',
        children: [text('the '), { kind: 'strong', children: [text('full')] }, text(' piece')],
      },
      text(' for more.'),
    ]);
  });

  it('parses a site-relative link', () => {
    expect(parseInline('Book it on [our catering page](/catering).')).toEqual([
      text('Book it on '),
      { kind: 'link', href: '/catering', children: [text('our catering page')] },
      text('.'),
    ]);
  });

  it('nests bold inside emphasis', () => {
    expect(parseInline('*a **b** c*')).toEqual([
      {
        kind: 'em',
        children: [text('a '), { kind: 'strong', children: [text('b')] }, text(' c')],
      },
    ]);
  });

  it('lets a backslash escape a delimiter', () => {
    expect(parseInline('2 \\* 3 is six')).toEqual([text('2 * 3 is six')]);
  });

  // A link target is allowed to close over its own parentheses. The parser
  // reads the target by matching parens, not by stopping at the first `)`,
  // and this is the case that tells the two apart.
  it('keeps a link target that contains balanced parentheses whole', () => {
    expect(parseInline('See [the piece](https://example.com/a_(b)/c) now.')).toEqual([
      text('See '),
      { kind: 'link', href: 'https://example.com/a_(b)/c', children: [text('the piece')] },
      text(' now.'),
    ]);
  });
});

describe('parseInline: unclosed and malformed runs stay literal', () => {
  // The property that matters for a non-technical author: a stray asterisk
  // is a stray asterisk on the page, never a swallowed rest-of-paragraph.
  it.each([
    ['an unclosed bold run', 'Add **salt to taste', [text('Add **salt to taste')]],
    ['an unclosed emphasis run', 'Add *salt to taste', [text('Add *salt to taste')]],
    ['an unclosed code run', 'Set `220 C', [text('Set `220 C')]],
    ['a bracket with no target', 'See [the piece] here', [text('See [the piece] here')]],
    ['a target with no closing paren', 'See [x](https://example.com', [text('See [x](https://example.com')]],
    ['an empty bold run', 'a ** b', [text('a ** b')]],
    // 'a ** b' above fails for want of a CLOSER, not for want of a body, so
    // it cannot prove the empty-body guard does anything. This one can: both
    // delimiters are present and there is nothing between them.
    ['a closed but empty bold run', 'a **** b', [text('a **** b')]],
  ])('%s', (_name, source, expected) => {
    expect(parseInline(source)).toEqual(expected);
  });
});

describe('isSafeHref', () => {
  it.each([
    'https://example.com/a',
    'http://example.com',
    '/catering',
    '/blog/a-post',
  ])('accepts %s', (href) => {
    expect(isSafeHref(href)).toBe(true);
  });

  // `javascript:` is the one this site has actually been bitten by --
  // validate.ts's own isUnsafeExternalUrl comment records a security pass
  // finding seven href fields guarded by a non-blank check alone.
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    '//evil.example/x',
    '/team/../../etc/passwd',
    'example.com',
    '',
    '   ',
    'https:// evil.example',
  ])('refuses %s', (href) => {
    expect(isSafeHref(href)).toBe(false);
  });
});

describe('parseInline: a malicious paste renders as words, not as anything', () => {
  // The structural proof. src/test/html-sinks.test.ts's own header explains
  // why the OBVIOUS version of this test cannot fail in jsdom: setting inner
  // markup on a <script> parses in the raw-text state, so a breakout and a
  // safe render are indistinguishable there. So this asserts the AST, which
  // is a value, not a rendering. Task 5 asserts the element tree for the
  // same payloads.
  it('a script tag is one text node, verbatim, with no other node kind', () => {
    const payload = 'Hello <script>alert(1)</script> world';
    expect(parseInline(payload)).toEqual([text(payload)]);
  });

  it('an image tag carrying an inline handler is one text node, verbatim', () => {
    const payload = '<img src=x onerror="alert(1)">';
    expect(parseInline(payload)).toEqual([text(payload)]);
  });

  it('a javascript: link produces NO link node -- the whole run stays literal', () => {
    const nodes = parseInline('Click [here](javascript:alert(1)) now');
    expect(nodes).toEqual([text('Click '), text('[here](javascript:alert(1))'), text(' now')]);
    expect(nodes.some((n) => n.kind === 'link')).toBe(false);
  });

  it('a data: link produces NO link node', () => {
    expect(parseInline('[x](data:text/html,<script>alert(1)</script>)').some((n) => n.kind === 'link')).toBe(false);
  });

  it('a protocol-relative link produces NO link node', () => {
    expect(parseInline('[x](//evil.example/x)').some((n) => n.kind === 'link')).toBe(false);
  });
});

describe('rawLinkTargets', () => {
  // Deliberately NOT built on the AST. parseInline erases an unsafe href by
  // turning the run into text, so an AST walk can never find one -- a
  // validator built on it would be structurally unable to complain and
  // would look perfectly reasonable doing nothing. This is what Task 4's
  // write boundary reads instead.
  it('finds every link target in the source, safe or not', () => {
    expect(rawLinkTargets('a [x](https://example.com) b [y](javascript:alert(1)) c [z](/catering)')).toEqual([
      'https://example.com',
      'javascript:alert(1)',
      '/catering',
    ]);
  });

  it('finds nothing in prose with no links', () => {
    expect(rawLinkTargets('Rest the dough **for an hour**.')).toEqual([]);
  });
});
