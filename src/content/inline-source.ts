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
// For a tree read off the DOM there is one further allowance, and it is
// stated rather than hidden: a mark this grammar cannot spell is DROPPED,
// keeping its words. Two marks around exactly the same run and two marks
// standing side by side are both unspellable, both reachable from the
// writing surface, and neither reachable from parseInline. The rules for
// that begin below.
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

// TWO DELIMITER RUNS MAY NEVER TOUCH, AND A MARK MAY NEVER HOLD ITS OWN.
// Those are the two rules the rest of this file exists to keep, and both are
// about the emitted STRING rather than about kinds: `**a *b* c**` is
// perfectly spellable and `**a **b** c**` is not, and the two differ only in
// what got emitted between the delimiters.
//
// `***x***` is not strong(em(x)) to this parser -- it is a loose asterisk, a
// bold run and another loose asterisk, so a mark disappears and a stray `*`
// lands at each end. `*a**b*` is two emphasis runs written next to each
// other and read back as one strong opener that never closes. Both are the
// `****` corruption class, one element along, and both are reachable the
// moment two marks meet: applied to exactly the same words, or standing side
// by side. parseInline can build neither tree, so nothing found this until
// dom-inline.ts gave the serializer a tree read off the DOM.
//
// A mark that cannot be spelled loses its MARKER and keeps its WORDS, and so
// does every mark inside it that still can be. Lossy in appearance, never
// lossy in meaning -- the same trade the code branch below makes, and the
// alternative is delimiters on the page.

// The emitted string with every ESCAPED character blanked out: `\*` is an
// asterisk in her prose, not an emphasis delimiter, and the two questions
// below must not confuse them.
//
// Blanked rather than REMOVED, which is not the same thing: removing closes
// the gap between whatever stood on either side and invents adjacency the
// emitted string does not have. Measured -- with removal,
// `*\)h**\[**\[\_*` reduces to `h****` and loses an emphasis run to a
// collision it does not have.
//
// Two rules that might look as though they belong here do NOT, and both were
// written and then removed for being unfalsifiable rather than for being
// wrong. A code span's body is opaque to parseNodes, and a lone `~` or `_`
// is not a delimiter at all (both marks are doubled-only) -- but the only
// questions asked below are whether a body STARTS with `*` or ENDS with `*`,
// `~` or `_`, a code span always begins and ends with a backtick, and
// escapeText escapes every `*` it emits along with a trailing `~` or `_`. No
// input can reach either branch, so neither could be made to fail.
function unescaped(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) {
      out += '  ';
      index += 2;
      continue;
    }
    out += text[index];
    index += 1;
  }
  return out;
}

// Whether wrapping `marker` around `inner` would put two delimiter runs
// against each other, or would ask the parser to close this mark somewhere
// inside its own body.
//
// At the ENDS, where the body's own run would join this marker's, the answer
// is asymmetric, and it is measured rather than reasoned: `*a**b***` reads
// back as em(a, strong(b)) and `**a*b***` does NOT read back as
// strong(a, em(b)). parseNodes takes the longest run it can at an opener, so
// a doubled mark survives a single one starting its body but not ending it,
// and a single mark survives a doubled one ending its body but not starting
// it. Refusing both ends instead would be safe and would cost real writing:
// bold with an emphasised word at the end of it is a sentence somebody types.
function collides(marker: string, inner: string): boolean {
  const bare = unescaped(inner);
  return marker.length === 2 ? bare.endsWith(marker[0]) : bare.startsWith(marker[0]);
}

// The other way two runs meet: not nested, but written side by side. Two
// emphasis runs in a row emit `*a**b*`, and the `**` in the middle of it is
// a strong opener that never closes. Asked of what has ALREADY been emitted,
// which is why emission is accumulated rather than mapped and joined.
function touchesWhatCameBefore(emitted: string, marker: string): boolean {
  const bare = unescaped(emitted);
  return bare.length > 0 && bare[bare.length - 1] === marker[0];
}

// A string being built up in emission order. Written to rather than
// returned, so that a mark's children can be re-emitted straight into the
// caller's own buffer when the mark is refused -- with the left-hand context
// still correct, which a fresh `.map().join('')` cannot have.
//
// `exposed` is the markers standing at THIS level, in order. A mark that is
// written exposes its own marker and nothing from inside it: its body is
// enclosed, and parseNodes consumes the whole run in one step without
// looking at the delimiters within. A mark that is refused exposes whatever
// its children expose, because that is what ends up in this buffer. That
// distinction is the whole reason this is structural rather than another
// scan of the string: `*a ~~*b*~~*` is fine, and a scanner counting bare `*`
// runs cannot tell those two asterisks apart from a pair of its own.
interface Emitted {
  out: string;
  exposed: string[];
}

export function serializeInline(nodes: InlineNode[]): string {
  const emitted: Emitted = { out: '', exposed: [] };
  emitNodes(nodes, emitted);
  return emitted.out;
}

function emitNodes(nodes: InlineNode[], emitted: Emitted): void {
  nodes.forEach((node) => emitNode(node, emitted));
}

function emitNode(node: InlineNode, emitted: Emitted): void {
  switch (node.kind) {
    case 'text':
      emitted.out += escapeText(node.value);
      return;
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
      if (node.value.length === 0) return;
      emitted.out += node.value.includes('`') ? escapeText(node.value) : `\`${node.value}\``;
      return;
    case 'strong':
    case 'em':
    case 'strike':
    case 'underline': {
      const marker = MARKER[node.kind];
      const body: Emitted = { out: '', exposed: [] };
      emitNodes(node.children, body);
      const inner = body.out;
      // An empty run is DROPPED rather than emitted. '****' is not an empty
      // bold run to this parser -- the empty-body guard makes it four
      // literal asterisks on the page, a visible corruption of a field she
      // thought was empty. parseInline never produces one; readInline does.
      //
      // A refused mark re-emits its children into the CALLER's buffer rather
      // than reusing `inner`, so each of them is judged against the text that
      // will really stand to its left once the marker is gone.
      // A mark cannot hold its own marker: parseNodes would close the run at
      // the inner one's opener and the rest of the sentence would fall out of
      // the mark. `**a **b** c**` is the shape, and it is asked of what the
      // body EXPOSES rather than of the string, so a `*b*` safely enclosed in
      // a `~~ ~~` inside it does not count against it.
      if (
        inner.length === 0
        || body.exposed.includes(marker)
        || collides(marker, inner)
        || touchesWhatCameBefore(emitted.out, marker)
      ) {
        emitNodes(node.children, emitted);
        return;
      }
      emitted.out += `${marker}${inner}${marker}`;
      emitted.exposed.push(marker);
      return;
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
      //
      // The label is built in its own buffer with no enclosing marker: the
      // brackets fence it off, because tryLink consumes the whole `[...](...)`
      // in one step and parseNodes never sees the delimiters inside it.
      emitted.out += `[${serializeInline(node.children)}](${node.href})`;
      return;
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}
