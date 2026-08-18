// Marks applied by BUILDING ELEMENTS, never by document.execCommand.
//
// execCommand's output is not specified: the same call produces one element in
// one browser and a styled span in another, and a styled span is exactly what
// dom-inline.ts flattens to bare words -- so her bold would silently disappear
// on some browsers and not others, the worst possible shape for a bug in a
// writing tool. Building the element ourselves means the tree only ever holds
// the five names MARK_OF knows.
//
// EVERY FUNCTION HERE REFUSES A RANGE THAT IS NOT INSIDE THE HOST IT WAS
// HANDED, and that guard is not defensive tidiness. A range acts where it
// stands: with the selection sitting in some other block, `extractContents`
// and `insertNode` both operate over there, so the mark is built into a block
// NOBODY ASKED ABOUT while the surface commits the host it was handed and
// finds nothing changed. The other block is then showing a mark the array has
// never heard of, until its next rewrite silently removes it -- a mark that
// appears, survives a while, and then is not there. The surface asks the same
// containment question at WritingSurface.tsx's sourceAroundCaret, for a
// version of the same reason.
import { readInline } from './dom-inline';
import { serializeInline } from '../../content/inline-source';
import { parseInline, type InlineNode } from '../../content/markdown';

export type Mark = 'strong' | 'em' | 'strike' | 'underline';

// The four element names dom-inline.ts reads back, in the spelling
// inline-dom.ts writes. A mark written as anything else is flattened to bare
// words on the next commit, with nothing on screen saying so.
const TAG_OF: Record<Mark, string> = { strong: 'STRONG', em: 'EM', strike: 'S', underline: 'U' };

// Spelled as an escape and not as the character itself. dom-inline.ts and
// EditableText.tsx both write it this way: an invisible character sitting in
// source is one nobody reviewing this file can see.
const ZWSP = '\u200b';

// The word an empty selection gets when she asks for a link, for the reason
// InlineTextField.tsx:187 uses one: `[](/menu)` renders as a link with nothing
// to click. Exported so the surface's read-back gate builds the same run this
// is about to insert, rather than a similar one.
export const LINK_PLACEHOLDER = 'this';

function rangeWithin(hostEl: HTMLElement): Range | null {
  const selection = hostEl.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!hostEl.contains(range.startContainer) || !hostEl.contains(range.endContainer)) return null;
  return range;
}

// Up from `node` towards the host, STOPPING AT THE HOST. Without that stop the
// walk leaves the surface entirely: a host that happens to sit inside some
// element on the page carrying the same name would be found, and toggling a
// mark off inside one block would unwrap a piece of the page around it.
function ancestorMark(node: Node, hostEl: HTMLElement, mark: Mark): Element | null {
  let current: Node | null = node.nodeType === 1 ? node : node.parentNode;
  while (current !== null && current !== hostEl) {
    if (current.nodeType === 1 && current.nodeName === TAG_OF[mark]) return current as Element;
    current = current.parentNode;
  }
  return null;
}

// The four element names above, asked the other way round. Derived from
// TAG_OF rather than typed again, so a fifth mark cannot be one the walk in
// clearMarks silently steps over. `A` is deliberately NOT in here: a link is
// not a mark, nothing on the toolbar calls it one, and clearing formatting
// inside one must leave it whole rather than cut it in three.
const IS_MARK: Record<string, true | undefined> = Object.fromEntries(
  Object.values(TAG_OF).map((tag): [string, true] => [tag, true]),
);

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (parent === null) return;
  while (el.firstChild !== null) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function selectContents(hostEl: HTMLElement, el: Node): void {
  const selection = hostEl.ownerDocument.getSelection();
  if (selection === null) return;
  const next = hostEl.ownerDocument.createRange();
  next.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(next);
}

export function toggleMark(hostEl: HTMLElement, mark: Mark): void {
  const range = rangeWithin(hostEl);
  if (range === null) return;
  const doc = hostEl.ownerDocument;

  const existing = ancestorMark(range.commonAncestorContainer, hostEl, mark);
  if (existing !== null) {
    unwrap(existing);
    // The two text nodes either side of what was just removed are now
    // siblings, and a run of words split across two of them serializes the
    // same but reads back as two nodes -- which is a difference the round-trip
    // corpus in inline-source.test.ts normalises away and a caret does not.
    hostEl.normalize();
    return;
  }

  const el = doc.createElement(TAG_OF[mark].toLowerCase());
  el.appendChild(range.extractContents());
  // With nothing selected this leaves an empty element with the caret in it,
  // so she can turn bold on and type -- InlineTextField.tsx:145-147 made the
  // same call for the same reason. A totally empty inline element collapses to
  // a 0x0 box in a real browser (EditableText.tsx:16-33, measured), so it gets
  // the same zero-width placeholder that file uses, which dom-inline.ts strips
  // on the way back out.
  if (el.childNodes.length === 0) el.appendChild(doc.createTextNode(ZWSP));
  range.insertNode(el);
  selectContents(hostEl, el);
}

// Whether an element has anything left in it worth keeping. NOT
// `textContent === ''` and not `childNodes.length === 0`: `deleteContents`
// EMPTIES a Text node rather than removing it, so the half a split leaves
// behind is routinely one text node holding nothing -- while an element
// holding a `<br>` holds a real line break, which dom-inline.ts reads back as
// a space and which no cleanup here may throw away.
function holdsNothing(el: Node): boolean {
  return [...el.childNodes].every((child) => child.nodeType === 3 && (child as Text).data.length === 0);
}

// `node` moved OUT of the element it stands in, which is SPLIT around it:
// everything before it stays in the original, everything after it goes into a
// copy standing after that, and the node itself comes out plain between the
// two. A half left holding nothing is dropped rather than left standing --
// serializeInline already writes an empty run as nothing, but an empty
// `<strong>` sitting against the caret is somewhere the next keystroke can
// land, which would put her straight back in the mark she asked to be rid of.
function liftOut(node: Node): void {
  const parent = node.parentNode;
  const grandparent = parent?.parentNode ?? null;
  if (parent === null || grandparent === null) return;
  const before = parent.cloneNode(false);
  let first = parent.firstChild;
  while (first !== null && first !== node) {
    before.appendChild(first);
    first = parent.firstChild;
  }
  parent.removeChild(node);
  if (!holdsNothing(before)) grandparent.insertBefore(before, parent);
  grandparent.insertBefore(node, parent);
  if (holdsNothing(parent)) grandparent.removeChild(parent);
}

// Formatting removed by REPLACING the selection with its own plain words. Not
// by walking the marks off one at a time: the selection can begin inside one
// mark and end inside another, and there is no tree operation that removes
// half of an element. The words are what she asked to keep.
//
// THE WORDS ARE THEN CARRIED OUT OF WHATEVER THEY LANDED IN, and without that
// second half this button did nothing at all for the commonest gesture there
// is. `deleteContents` only EMPTIES an element the range partially contains,
// and a range whose first character is marked starts INSIDE that element --
// so select a paragraph, press Bold, select it again, press Clear formatting,
// and `deleteContents` left the `<strong>` standing while `insertNode` put the
// plain words straight back inside it. The mark survived its own removal,
// survived a close-and-reopen of the editor, and was what published. Found end
// to end by e2e/writing-surface.spec.ts, which now pins the fix.
//
// SPLITTING at the caret rather than unwrapping the element outright, because
// the element is not always hers to remove: with "AlphaBeta" bold and only
// "phaBeta" selected, the "Al" that is left has to stay bold. The walk stops
// at the host, and at anything that is not one of the four marks -- a link is
// not one, and a Clear press must not cut one in three.
export function clearMarks(hostEl: HTMLElement): void {
  const range = rangeWithin(hostEl);
  if (range === null || range.collapsed) return;
  const words = range.toString().split(ZWSP).join('');
  range.deleteContents();
  const text = hostEl.ownerDocument.createTextNode(words);
  range.insertNode(text);
  let parent = text.parentNode;
  while (parent !== null && parent !== hostEl && IS_MARK[parent.nodeName] === true) {
    liftOut(text);
    const next = text.parentNode;
    // A lift that moved nothing would spin this loop forever, and a hung
    // browser is a worse failure than a mark that stayed. `liftOut` declines
    // to move a node whose parent is not itself attached, which is the one way
    // that can happen.
    if (next === parent) break;
    parent = next;
  }
  // Deliberately NOT normalized afterwards: merging the new node into its
  // neighbours would remove the very node the caret is about to be put in.
  // Two adjacent text nodes cost nothing here -- dom-inline.ts reads both and
  // inline-source.ts writes them out as one string.
  selectContents(hostEl, text);
}

export function insertLink(hostEl: HTMLElement, href: string): void {
  const range = rangeWithin(hostEl);
  if (range === null) return;
  const doc = hostEl.ownerDocument;
  const el = doc.createElement('a');
  el.setAttribute('href', href);
  el.appendChild(range.extractContents());
  if ((el.textContent ?? '').split(ZWSP).join('').length === 0) {
    el.textContent = LINK_PLACEHOLDER;
  }
  range.insertNode(el);
  selectContents(hostEl, el);
}

// The words the selection covers, or null when there is no selection in this
// host. The surface needs them before the link is inserted, because the target
// is gated on the run that is about to be written and not on the target alone.
export function selectedWords(hostEl: HTMLElement): string | null {
  const range = rangeWithin(hostEl);
  return range === null ? null : range.toString().split(ZWSP).join('');
}

function countMark(nodes: InlineNode[], mark: Mark): number {
  return nodes.reduce((total, node) => {
    if (node.kind === 'text' || node.kind === 'code') return total;
    const own = node.kind === mark ? 1 : 0;
    return total + own + countMark(node.children, mark);
  }, 0);
}

const MARKS: readonly Mark[] = ['strong', 'em', 'strike', 'underline'];

// WHETHER EVERY MARK NOW IN THE TREE WILL STILL BE THERE AFTER IT IS SAVED.
//
// Asked of ALL of them and not of the one just applied, which is the mistake
// this was written as first and which measured false: applying emphasis to
// exactly the words a bold already covers costs the BOLD, not the emphasis.
// inline-source.ts refuses the OUTER mark, and the outer one is always the one
// that was there first, so a check aimed at the mark under her finger reports
// success while the mark underneath it disappears.
//
// Two marks around exactly the same words is a shape this grammar cannot
// spell, and inline-source.ts drops one of them rather than writing
// delimiters that come back as literal asterisks. That is the right trade at
// the serializer and it is the wrong thing to do in silence at the toolbar:
// bold a word, emphasise the same word, click away and the bold is gone with
// nothing on screen saying why -- which is the exact failure this task exists
// to prevent.
//
// The pair is `strong` and `em` and it is only that pair: they are the two
// marks whose delimiters are made of the same character, so `**` cannot hold a
// `*` run that fills it and a `*` run cannot hold a `**` one. Every other
// combination survives, measured across a 4x4 nesting matrix, 4x4 adjacency
// and all 64 triples rather than reasoned about. Asked of the tree instead of
// hard-coded to that pair, so a fifth mark cannot make this quietly wrong.
export function marksSurviveSave(hostEl: HTMLElement): boolean {
  const tree = readInline(hostEl);
  const back = parseInline(serializeInline(tree));
  return MARKS.every((mark) => countMark(back, mark) >= countMark(tree, mark));
}
