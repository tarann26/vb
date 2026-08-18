// One editable slot's DOM subtree, read back as InlineNode values.
//
// IT READS THE TREE, NEVER A MARKUP STRING. src/test/html-sinks.test.ts is a
// plain substring scan over every shipped file (readFileSync(file).includes(sink),
// html-sinks.test.ts:53), so a module that so much as NAMES the obvious
// property -- in code or in a comment -- fails the build. Structure comes
// from childNodes, nodeType, nodeName, getAttribute and textContent, all of
// which return values rather than markup. That is not a workaround for the
// test; it is the same guarantee markdown.ts's header states, held at the
// one boundary where a contenteditable could otherwise have broken it.
//
// Anything this surface did not itself create contributes its TEXT and
// nothing else. A span a browser autocorrect left behind, a font wrapper an
// extension injected, a stray attribute -- all of it flattens to words. That
// is what makes "paste strips formatting" true even for the paths paste
// handling does not intercept.
import { isSafeHref, MAX_NESTING_DEPTH, type InlineNode } from '../../content/markdown';

// The element names inline-dom.ts creates, and the only ones that carry
// meaning here. One map so the writer and the reader cannot drift.
const MARK_OF: Record<string, 'strong' | 'em' | 'strike' | 'underline' | 'code'> = {
  STRONG: 'strong', EM: 'em', S: 'strike', U: 'underline', CODE: 'code',
};

const ZWSP = '\u200b';

export function readInline(host: Node): InlineNode[] {
  return readChildren(host, 0);
}

function readChildren(host: Node, depth: number): InlineNode[] {
  const nodes: InlineNode[] = [];
  host.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      // The zero-width placeholder marks.ts leaves inside a freshly created
      // empty mark. Never a character she typed, so it is stripped
      // everywhere -- EditableText.tsx:47-49 made the same call for the same
      // reason, and strips every occurrence rather than a whole-string match.
      const value = (child.nodeValue ?? '').split(ZWSP).join('');
      if (value.length > 0) nodes.push({ kind: 'text', value });
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as Element;

    // A line break contributes a SPACE, not nothing. Contributing nothing is
    // EditableText.tsx's Finding C1 verbatim: the screen shows two lines
    // while the committed value runs them together with no gap, and the two
    // agree on every comparison, so nothing can detect the drift.
    if (el.nodeName === 'BR') { nodes.push({ kind: 'text', value: ' ' }); return; }

    // Past this point an element keeps its WORDS and loses its wrapper, and
    // recursion stops. Two separate reasons, either one sufficient:
    //
    // 1. parseInline refuses a mark nested deeper than MAX_NESTING_DEPTH
    //    (markdown.ts:296), so serializeInline would write delimiters that
    //    come back as literal asterisks -- the `****` corruption class one
    //    level up. Measured, not assumed: 33 nested marks is where the loop
    //    stops agreeing, 32 still agrees.
    // 2. This is the boundary untrusted DOM arrives at. A paste can nest
    //    wrappers as deep as it likes, and an uncapped walk of it is a stack
    //    overflow thrown out of a keystroke commit. The cap makes the walk's
    //    depth a property of this module rather than of what was pasted.
    //
    // The cap counts EVERY element, including one this surface would have
    // flattened anyway: what has to be bounded is the recursion, and a nest
    // of unknown wrappers is the cheapest way to build a deep one.
    if (depth >= MAX_NESTING_DEPTH) { nodes.push(...flatten(el)); return; }

    if (el.nodeName === 'A') {
      const href = el.getAttribute('href') ?? '';
      const children = readChildren(el, depth + 1);
      // The same judgement parseInline makes at markdown.ts:302, asked here
      // so an unusable target can never be written into a content field at
      // all. A refused link keeps its words and loses its wrapper.
      if (isSafeHref(href)) nodes.push({ kind: 'link', href: href.trim(), children });
      else nodes.push(...children);
      return;
    }

    const mark = MARK_OF[el.nodeName];
    if (mark === 'code') {
      const text = (el.textContent ?? '').split(ZWSP).join('');
      // Agrees with inline-source.ts's decision at the other end.
      nodes.push(text.includes('`') ? { kind: 'text', value: text } : { kind: 'code', value: text });
      return;
    }
    if (mark !== undefined) { nodes.push({ kind: mark, children: readChildren(el, depth + 1) }); return; }

    // Unknown element: its words, and nothing about it.
    nodes.push(...readChildren(el, depth + 1));
  });
  return nodes;
}

// Every word under `el`, and no structure at all. Used where structure cannot
// be carried: past the nesting cap, and only there.
function flatten(el: Element): InlineNode[] {
  const value = (el.textContent ?? '').split(ZWSP).join('');
  return value.length > 0 ? [{ kind: 'text', value }] : [];
}
