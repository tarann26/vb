// Phase 5. Inline markdown, parsed to an AST and never to a string.
//
// THE ONE PROPERTY THIS MODULE EXISTS FOR: nothing here produces markup.
// `parseInline` returns values; src/components/blog/Inline.tsx turns those
// values into React elements, and React sets a text child through
// textContent, which never re-parses. That is the whole safety argument, and
// src/test/html-sinks.test.ts is what keeps it true by refusing any
// parsing sink anywhere under src/ or worker/.
//
// It is hand-written rather than a dependency, and the reason is not
// bundle size. Every markdown library worth using ships an HTML serializer
// alongside its parser, and the serializer is the thing this codebase must
// never acquire -- a single import of it, by anyone, for any reason, ends
// the property above. About 150 lines of our own is a cheaper way to keep a
// guarantee than a dependency plus a lint rule forbidding half of it.
//
// The grammar is deliberately four forms and no more, matching what the
// editor's toolbar can produce (bold, emphasis, link) plus inline code, which
// the spec's post-format decision names. There are no block constructs
// here at all: headings, lists, quotes and images are BLOCK TYPES in the
// content model (src/content/types.ts), edited as structured records, so a
// leading "# " in a paragraph is prose about a hash, not a heading.
//
// It is also imported by src/content/validate.ts, which the Cloudflare
// Worker bundles -- so this module imports nothing, holds no JSX and
// touches no DOM. worker/__tests__/bundle.test.ts fails the build if
// anything in that chain reaches React.

export type InlineNode =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; children: InlineNode[] }
  | { kind: 'em'; children: InlineNode[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; children: InlineNode[] };

// The characters a backslash may escape. Anything else after a backslash is
// two literal characters, which is what someone typing a Windows path or a
// measurement expects.
const ESCAPABLE = '*`[]()\\';

// The two shapes a link target is allowed to have, and they are the same two
// shapes validate.ts already enforces for whole fields: an off-site
// `https?://host` (isUnsafeExternalUrl) or a site-relative `/path` with no
// traversal (isUnsafeAssetPath). Everything else -- `javascript:`, `data:`,
// `vbscript:`, a protocol-relative `//host`, a bare `example.com` -- is
// refused here and refused again at the write boundary by validatePosts.
//
// One deliberate difference from isUnsafeExternalUrl: whitespace is excluded
// from the host position. `https:// evil.example` passes that older pattern,
// because `[^/]` matches a space. It does not pass this one.
export function isSafeHref(value: string): boolean {
  const href = value.trim();
  if (href.length === 0) return false;
  if (href.startsWith('//')) return false;
  if (href.startsWith('/')) return !href.includes('..');
  return /^https?:\/\/[^/\s]/i.test(href);
}

// Where the `(...)` opened at `open` closes, counting depth rather than
// stopping at the first `)`. The target is allowed to contain parentheses,
// and the two payloads that matter most both do: `javascript:alert(1)` and
// `data:text/html,<script>alert(1)</script>`. Stopping at the first `)` would
// hand every reader of this module a target one character short of what was
// typed -- `javascript:alert(1` -- which is a different string from the one
// the author wrote, leaves a stray `)` behind in the prose, and would make
// rawLinkTargets report something the dashboard cannot explain. Returns -1
// when the run never closes, which is what keeps an unbalanced `[x](...`
// literal.
function findTargetEnd(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

// Every `](target)` in the source, regardless of whether parseInline would
// accept it. See this module's header and Task 4's validator: parseInline
// ERASES an unsafe target by keeping the run literal, so an AST walk can
// never find one. The write boundary reads this instead, which is what lets
// the dashboard tell her a link will not work rather than silently
// publishing prose with brackets in it.
export function rawLinkTargets(source: string): string[] {
  const targets: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (!source.startsWith('](', index)) continue;
    const close = findTargetEnd(source, index + 1);
    if (close === -1) continue;
    targets.push(source.slice(index + 2, close));
    index = close;
  }
  return targets;
}

interface Cursor {
  readonly source: string;
  index: number;
}

// Whether the cursor is sitting on the delimiter that closes the run being
// parsed. The `**` exception is the whole reason this is a function: an
// emphasis run stops at `*`, and `**` starts with `*`, so the naive check
// ends `*a **b** c*` at the `b`'s opener and loses the nested bold entirely.
function atStop(cursor: Cursor, stopAt: string | null): boolean {
  if (stopAt === null) return false;
  if (!cursor.source.startsWith(stopAt, cursor.index)) return false;
  return !(stopAt === '*' && cursor.source.startsWith('**', cursor.index));
}

// A delimited run (`**...**`, `*...*`) is parsed SPECULATIVELY: the cursor is
// saved, the body is parsed, and if the closing delimiter is not where it
// should be the cursor is restored and the opener becomes ordinary text.
// That is what makes an unclosed run render as a stray asterisk rather than
// swallowing the rest of the paragraph -- the behaviour a non-technical
// author will actually meet, and the one the tests pin hardest.
function tryDelimited(cursor: Cursor, delimiter: string, kind: 'strong' | 'em'): InlineNode | null {
  const start = cursor.index;
  cursor.index += delimiter.length;
  const children = parseNodes(cursor, delimiter);
  if (children.length === 0 || !cursor.source.startsWith(delimiter, cursor.index)) {
    cursor.index = start;
    return null;
  }
  cursor.index += delimiter.length;
  return { kind, children };
}

function tryLink(cursor: Cursor): InlineNode | null {
  const start = cursor.index;
  cursor.index += 1;
  const children = parseNodes(cursor, ']');
  if (!cursor.source.startsWith('](', cursor.index)) {
    cursor.index = start;
    return null;
  }
  const open = cursor.index + 1;
  const close = findTargetEnd(cursor.source, open);
  if (close === -1) {
    cursor.index = start;
    return null;
  }
  const href = cursor.source.slice(open + 1, close);
  cursor.index = close + 1;
  if (!isSafeHref(href)) {
    // Refused, and refused VISIBLY: the whole run comes back as literal
    // text, brackets and target included, so she can see what she pasted
    // and fix it. Silently dropping the target would leave link text with
    // no link and nothing to explain it.
    return { kind: 'text', value: cursor.source.slice(start, cursor.index) };
  }
  return { kind: 'link', href: href.trim(), children };
}

function parseNodes(cursor: Cursor, stopAt: string | null): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer.length > 0) {
      nodes.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  };

  while (cursor.index < cursor.source.length) {
    if (atStop(cursor, stopAt)) break;

    const char = cursor.source[cursor.index];

    if (char === '\\' && ESCAPABLE.includes(cursor.source[cursor.index + 1] ?? '')) {
      buffer += cursor.source[cursor.index + 1];
      cursor.index += 2;
      continue;
    }

    if (char === '`') {
      const end = cursor.source.indexOf('`', cursor.index + 1);
      if (end > cursor.index + 1) {
        flush();
        nodes.push({ kind: 'code', value: cursor.source.slice(cursor.index + 1, end) });
        cursor.index = end + 1;
        continue;
      }
    }

    if (char === '*') {
      const doubled = cursor.source.startsWith('**', cursor.index);
      const node = tryDelimited(cursor, doubled ? '**' : '*', doubled ? 'strong' : 'em');
      if (node) {
        flush();
        nodes.push(node);
        continue;
      }
    }

    if (char === '[') {
      const node = tryLink(cursor);
      if (node) {
        flush();
        nodes.push(node);
        continue;
      }
    }

    buffer += char;
    cursor.index += 1;
  }

  flush();
  return nodes;
}

export function parseInline(source: string): InlineNode[] {
  return parseNodes({ source, index: 0 }, null);
}
