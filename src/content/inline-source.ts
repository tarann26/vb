// The inverse direction markdown.ts never had: an AST back to the source
// string a content field stores. It exists because the writing surface
// (src/admin/writing/) reads a DOM subtree, turns it into InlineNode values,
// and has to write a string into `paragraph.text`.
//
// IT IS NOT A BYTE-LEVEL INVERSE, AND CANNOT BE. parseInline is not
// injective -- src/content/__tests__/markdown.test.ts pins seven inputs whose
// output is a single text node identical to some OTHER input's, so no
// function can recover which of them was typed. What this module guarantees
// instead is RENDER equivalence:
//
//   parseInline(serializeInline(parseInline(s))) is the same tree as
//   parseInline(s), once adjacent text siblings are merged at every level.
//
// That is the property the surface needs, and inline-source.test.ts proves it
// over a five-thousand-string corpus drawn from this grammar's own delimiter
// alphabet rather than over examples.
//
// It imports only a type, which erases, so it stays as clean for the Worker
// bundle as markdown.ts itself.
import type { InlineNode } from './markdown';

const MARKER: Record<'strong' | 'em' | 'strike' | 'underline', string> = {
  strong: '**',
  em: '*',
  strike: '~~',
  underline: '__',
};

// The backslash goes first, so an escape added below is never re-escaped.
//
// `~` and `_` are escaped in two positions only: before another `~` or `_`,
// where they would form a delimiter, and at the END of a node, where the
// character that follows is emitted by the NEXT sibling and is not visible
// from here. Without that second case, serializing strike("a~") produces
// `~~a~~~`, which re-parses as strike("a") followed by a loose tilde -- the
// tilde falls out of the mark. Everywhere else a lone `~` or `_` is left
// exactly as she typed it, which is what keeps a file name, a handle or an
// approximate quantity free of backslashes she never wrote.
function escapeText(value: string): string {
  return value
    .split('\\')
    .join('\\\\')
    .replace(/[*`[\]()]/g, (char) => `\\${char}`)
    .replace(/[~_](?=[~_])|[~_]$/g, (char) => `\\${char}`);
}

export function serializeInline(nodes: InlineNode[]): string {
  return nodes.map(serializeNode).join('');
}

function serializeNode(node: InlineNode): string {
  switch (node.kind) {
    case 'text':
      return escapeText(node.value);
    case 'code':
      // Two values cannot be written back as a code span at all, and both
      // become plain words instead: lossy in appearance, never lossy in
      // meaning. A backtick inside the value has no escape in this grammar --
      // parseNodes stops a run at the next backtick -- and an EMPTY value
      // would emit two adjacent backticks, which parseNodes refuses as a run
      // (it requires a non-empty body) and puts on the page as two literal
      // backticks in a field she thought was empty. parseInline produces
      // neither value; a `<code>` element read back off the DOM produces
      // both, so dom-inline.ts makes the same call at the other end.
      if (node.value.length === 0) return '';
      return node.value.includes('`') ? escapeText(node.value) : `\`${node.value}\``;
    case 'strong':
    case 'em':
    case 'strike':
    case 'underline': {
      const inner = serializeInline(node.children);
      // An empty run is DROPPED rather than emitted. '****' is not an empty
      // bold run to this parser -- the empty-body guard makes it four
      // literal asterisks on the page, a visible corruption of a field she
      // thought was empty. parseInline never produces one; readInline does.
      return inner.length === 0 ? '' : `${MARKER[node.kind]}${inner}${MARKER[node.kind]}`;
    }
    case 'link':
      // A link with no label IS kept, unlike an empty mark: parseInline
      // accepts `[](/menu)` and produces a link node with no children
      // (tryLink has no empty-body guard), so dropping it here would break
      // the round trip on a real input. The surface's own link tool never
      // creates one -- marks.ts inserts a placeholder word.
      //
      // The target is written raw, and it is safe to: every href on a node
      // parseInline built has already passed isSafeHref, and one that has
      // not -- a hand-built node -- is refused AGAIN when this string is
      // parsed, coming back as literal brackets rather than a live link.
      // Nothing here can widen what Inline.tsx will follow.
      return `[${serializeInline(node.children)}](${node.href})`;
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}
