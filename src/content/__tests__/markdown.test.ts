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

// The hazard this block exists for, and why a runtime bound rather than an
// output assertion: parseNodes used to backtrack exponentially on an
// unclosed '['. Every case below returns the RIGHT answer before this fix
// and after it -- what changed is how long it takes. 24 brackets took 906ms
// and 30 took about two minutes, on a faithful port of the pre-fix file; 40
// did not finish in 120 seconds. A HANG is not something the root
// ErrorBoundary can catch, so the failure mode was a tab that simply stops,
// and 5B's formatting toolbar over a live textarea is what puts a keystroke
// in front of it.
//
// Bounds, not exact timings: the numbers above are 2^n, so a 1000ms budget
// against a measured 0-4ms is a margin of two to three orders of magnitude.
// A machine slow enough to fail this honestly has a different problem.
describe('parseInline: an unclosed bracket cannot hang the tab', () => {
  function msToParse(source: string): number {
    const started = performance.now();
    parseInline(source);
    return performance.now() - started;
  }

  it.each([
    ['24 unclosed brackets -- 906ms before this fix', '['.repeat(24) + 'ok'],
    ['30 unclosed brackets -- about two minutes before this fix', '['.repeat(30) + 'ok'],
    ['40 unclosed brackets -- did not finish in 120 seconds before this fix', '['.repeat(40) + 'ok'],
    ['2000 unclosed brackets', '['.repeat(2000) + 'ok'],
    ['50000 unclosed brackets -- a paste, not typing', '['.repeat(50000) + 'ok'],
  ])('%s parses in under 1000ms', (_name, source) => {
    expect(msToParse(source)).toBeLessThan(1000);
  });

  // The shape that defeats a failure-only memo: a long bracket run WITH a
  // real link target after it, so every outer attempt succeeds and, without
  // success memoisation, is recomputed at every position. Measured at 38
  // SECONDS with failures memoised and successes not; 3ms with both.
  it.each([
    ['2000 brackets then a real target', '['.repeat(2000) + '](https://example.com)'],
    ['50000 brackets then a real target', '['.repeat(50000) + '](https://example.com)'],
  ])('%s parses in under 1000ms', (_name, source) => {
    expect(msToParse(source)).toBeLessThan(1000);
  });

  // A mixed paste bomb: brackets interleaved with real markup, so neither
  // the O(1) reject nor a single memo class carries it alone.
  //
  // Also the case that catches a broken O(1) reject rather than just a slow
  // one: `lastIndexOf('](')` swapped for `indexOf('](')` still returns in
  // well under 1000ms here, because the reject only gets CHEAPER when its
  // threshold sits earlier in the source -- so a timing bound alone cannot
  // tell the two apart. What it breaks is correctness: `indexOf` anchors on
  // the FIRST target in the whole string, so every real link in chunks 2
  // through 400 sits past that threshold and is refused before it is ever
  // parsed. 400 repetitions, each holding exactly one real target, must
  // produce exactly 400 link nodes; measured at 1 under that mutation.
  it('a 32000-character mixed paste parses in under 1000ms and keeps every link', () => {
    const source = ('['.repeat(50) + ' *x* **y** [z](https://e.com) ').repeat(400);
    expect(source.length).toBe(32000);
    const started = performance.now();
    const nodes = parseInline(source);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(nodes.filter((node) => node.kind === 'link')).toHaveLength(400);
  });

  // Deep nesting must not trade a hang for a stack overflow. Memoisation
  // alone still descends once per consecutive '[', which is 50000 frames.
  it('50000 levels of nesting does not overflow the stack', () => {
    expect(() => parseInline('['.repeat(50000) + 'ok')).not.toThrow(RangeError);
  });

  // The case above, on its own, cannot prove the depth cap does anything:
  // this source has no `](` anywhere, so `lastTargetOpen` is -1 and the O(1)
  // reject refuses every one of the 50000 brackets at depth 0 -- recursion
  // never starts, cap or no cap. Confirmed by removing the cap here: this
  // case is unaffected either way, so it alone would not catch a broken or
  // deleted MAX_NESTING_DEPTH. A real target forces the actual descent the
  // cap exists to bound -- without it, this throws
  // `RangeError: Maximum call stack size exceeded` on this machine.
  it('50000 levels of nesting, resolving to a real target, does not overflow the stack', () => {
    expect(() => parseInline('['.repeat(50000) + 'x](https://example.com)')).not.toThrow(RangeError);
  });
});

// The fix is only a fix if it is invisible. These are literals, not values
// read back out of the thing under test: Phase 4's thirteenth unfalsifiable
// test compared a response against the value under test and corrupting that
// value left 2837 tests green.
describe('parseInline: the memo changes no output', () => {
  it.each([
    ['a bracket run then a real link', '[[[x](https://example.com)', [
      { kind: 'text' as const, value: '[[' },
      { kind: 'link' as const, href: 'https://example.com', children: [{ kind: 'text' as const, value: 'x' }] },
    ]],
    // Exactly at the cap: 32 consecutive '[' is 32 speculative descents
    // (cursor.depth runs 0..31, all under MAX_NESTING_DEPTH), so the cap
    // never fires and this is byte-identical to the pre-fix parser's
    // answer -- the INNERMOST bracket opens the link, the 31 outer attempts
    // each fail once the target is claimed, and the label holds only 'x'.
    ['thirty-two deep, then a real link', '['.repeat(32) + 'x](https://example.com)', [
      { kind: 'text' as const, value: '['.repeat(31) },
      { kind: 'link' as const, href: 'https://example.com', children: [{ kind: 'text' as const, value: 'x' }] },
    ]],
    // One past the cap, and the answer is NOT the one the pre-fix parser
    // would have given. This is deliberate and the comment on
    // MAX_NESTING_DEPTH says so: the cap is honest about being
    // context-insensitive above depth 32, and the case that exercises it
    // is a bracket run deeper than any real author writes. What this pins
    // is that the divergence is confined to the 32nd bracket outward -- the
    // leading 31 characters of literal text are identical to the depth-32
    // case above, and the only difference is that the depth cap fires
    // partway through the label, leaving 8 leftover '[' (40 - 32) inside
    // the link's own children instead of them being absorbed by 8 more
    // levels of descent. Still a link, still to the right target, never a
    // hang -- which is the actual guarantee this task makes above depth 32.
    ['forty deep, then a real link -- past the cap, not identical to the pre-fix answer', '['.repeat(40) + 'x](https://example.com)', [
      { kind: 'text' as const, value: '['.repeat(31) },
      {
        kind: 'link' as const,
        href: 'https://example.com',
        children: [{ kind: 'text' as const, value: `${'['.repeat(8)}x` }],
      },
    ]],
    ['a bracket run with no target at all', '[[[[ok', [{ kind: 'text' as const, value: '[[[[ok' }]],
    ['a refused target inside a bracket run', '[[x](javascript:alert(1))', [
      { kind: 'text' as const, value: '[' },
      { kind: 'text' as const, value: '[x](javascript:alert(1))' },
    ]],
    ['a target holding balanced parentheses', '[a](https://e.com/f(1)_g) end', [
      { kind: 'link' as const, href: 'https://e.com/f(1)_g', children: [{ kind: 'text' as const, value: 'a' }] },
      { kind: 'text' as const, value: ' end' },
    ]],
    ['bold inside a link', '**[a](/x)**', [
      {
        kind: 'strong' as const,
        children: [{ kind: 'link' as const, href: '/x', children: [{ kind: 'text' as const, value: 'a' }] }],
      },
    ]],
    // Real prose nests three deep at most, per the comment on
    // MAX_NESTING_DEPTH -- and it takes exactly this depth to make a too
    // small cap visible. A cap of 2 permits entries at cursor.depth 0 and 1
    // (two full levels, checked as `depth >= cap` on the way in), so
    // 'bold inside a link' above -- two levels -- is satisfied by a cap as
    // small as 2 and cannot tell a cap of 2 apart from a cap of 32. This
    // one can: the label is a link inside emphasis inside bold, and only
    // the third level (the bold) is refused by a cap that stops at 2.
    ['bold inside emphasis inside a link label', '[*a **b** c*](/x)', [
      {
        kind: 'link' as const,
        href: '/x',
        children: [
          {
            kind: 'em' as const,
            children: [
              { kind: 'text' as const, value: 'a ' },
              { kind: 'strong' as const, children: [{ kind: 'text' as const, value: 'b' }] },
              { kind: 'text' as const, value: ' c' },
            ],
          },
        ],
      },
    ]],
    ['a bracketed run that is not a link, after a real one', '[a](https://e.com) [', [
      { kind: 'link' as const, href: 'https://e.com', children: [{ kind: 'text' as const, value: 'a' }] },
      { kind: 'text' as const, value: ' [' },
    ]],
  ])('%s', (_name, source, expected) => {
    expect(parseInline(source)).toEqual(expected);
  });

  // Nested brackets inside a link label are LITERAL today, because the
  // inner parseNodes stops at the first ']' with no depth counting. Pinned
  // so nobody "improves" it into a depth-matching label scanner while
  // touching this file: that would be a behaviour change, and it would move
  // the case markdown.test.ts already pins two blocks above.
  it('a nested bracket inside a label keeps the whole run literal', () => {
    expect(parseInline('[nested [brackets]](https://e.com/x)')).toEqual([
      { kind: 'text', value: '[nested [brackets]](https://e.com/x)' },
    ]);
  });
});

describe('isSafeHref', () => {
  it.each([
    'https://example.com/a',
    'http://example.com',
    '/catering',
    '/blog/a-post',
    '/press/x.webp',
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
    // Review finding (Important #1). Every one of these begins with a single
    // slash and carries no dot-dot, so the old test read all of them as a
    // path on this site. They are not; see the resolution assertions below.
    '/\\evil.example',
    '/\\evil.example/a',
    '/\\/evil.example',
    '/\t/evil.example',
  ])('refuses %s', (href) => {
    expect(isSafeHref(href)).toBe(false);
  });
});

// The property this guard exists for is not "the string contains a
// backslash" -- that is only the symptom the old test missed. It is "a
// browser resolves this somewhere other than here." So each row asserts
// WHERE the string actually lands, using the same URL implementation a
// browser runs, and only then asserts the guard's verdict. A future fix that
// keeps the verdicts while breaking the reason fails the first assertion.
describe('isSafeHref agrees with where a browser actually goes', () => {
  const HERE = 'https://viabianca.example/blog/a-post';

  it.each([
    ['a backslash after the leading slash', '/\\evil.example'],
    ['a backslash with a path after it', '/\\evil.example/a'],
    ['two slashes, the shape already known', '//evil.example'],
    ['a slash, a backslash, a slash', '/\\/evil.example'],
    // A tab is REMOVED by the URL parser before it decides anything, so this
    // is the two-slash shape wearing a disguise. Included because the fix
    // must not be a list of dangerous characters -- this one is not a
    // character anybody would think to list.
    ['a tab inside the leading run', '/\t/evil.example'],
  ])('%s lands on another origin: %s', (_name, href) => {
    expect(new URL(href, HERE).origin).toBe('https://evil.example');
    expect(isSafeHref(href)).toBe(false);
  });

  // The other direction, and it is what stops the fix being "refuse anything
  // that looks odd": a percent-encoded backslash is an ordinary path
  // character to the parser, stays on this origin, and is therefore a real
  // -- if strange -- path on this site. Refusing it would be a guard
  // disagreeing with the browser in the safe direction, which is still a
  // guard nobody can reason about.
  it.each(['/%5Cevil.example', '/blog/foo', '/press/x.webp'])('%s stays on this origin and is accepted', (href) => {
    expect(new URL(href, HERE).origin).toBe('https://viabianca.example');
    expect(isSafeHref(href)).toBe(true);
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
