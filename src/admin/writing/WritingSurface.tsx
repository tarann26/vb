// One continuous writing column over the EXISTING block array.
//
// THE ARRAY IS AUTHORITATIVE AND THE DOM IS NOT. Every editable slot below is
// its own host; the surface never infers where one block ends and the next
// begins by reading the tree. That is what keeps stable-names.ts's WeakMap
// valid -- an edit is `{ ...block, text: next }`, the object-replacing shape
// that module's own header describes, so `rename` (BlockList.tsx:404) carries
// the name across and a staged photo stays attached to the block she picked
// it for. A surface that rebuilt Block[] from the DOM would produce all-new
// objects on every keystroke and detach every one of them at once, which is
// BlockList.tsx:223-254's defect at larger scale -- a post published naming a
// photo no file was ever sent for.
//
// REACT RENDERS NO CHILDREN INTO AN EDITABLE HOST. Once such a host holds
// real edits its subtree belongs to the browser; a React-managed text child
// there fights the caret and drops keystrokes. Content is written
// imperatively by the layout effect below, through inline-dom.ts.
//
// A FOCUSED HOST IS NEVER REWRITTEN. That single rule removes the whole
// caret-restoration problem: InlineTextField.tsx's pendingSelection/forValue
// round trip exists because a controlled textarea is rewritten on every
// commit. Nothing here is rewritten while she is in it.
import { createElement, Fragment, useLayoutEffect, useRef, useState, type Attributes, type HTMLAttributes, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { blockProblemOf, type BlockProblemTarget } from '../blocks/block-problems';
import { linkRefusal, TARGET_SHAPES } from '../blocks/link-target';
import { useStableNames, type StableNames } from '../blocks/stable-names';
import { readInline } from './dom-inline';
import { writeInline } from './inline-dom';
import { slotsOf, withSlot, type Slot } from './slots';
import { backspaceAtStart, enterAt, type Caret, type Edit } from './structure';
import { autoformat, revertFormat } from './autoformat';
import { pasteChunks } from './paste';
import { EMPTY_HISTORY, record, redo, undo, type History, type Snapshot } from './history';
import { clearMarks, insertLink, LINK_PLACEHOLDER, marksSurviveSave, selectedWords, toggleMark, type Mark } from './marks';
import WritingToolbar, { type ToolbarKind } from './WritingToolbar';
import { serializeInline } from '../../content/inline-source';
import { isSafeHref, rawLinkTargets } from '../../content/markdown';
import { isBlockKind } from '../../content/guards';
import type { Block, BlockKind } from '../../content/types';
import type { ImagePreviews } from '../previews';
import type { StagedPhoto } from '../PhotoField';
import type { ValidationProblem } from '../../content/validate';

// The same props BlockList takes, field for field, so Task 25's swap is one
// element and no prop plumbing -- including the optional `names`, which is
// NOT decoration: PostList.tsx:341 passes it today, and a component that
// dropped it would mint a fresh, empty WeakMap every time the post's editor
// closed and reopened. That is Task 7's defect verbatim, and it is the reason
// this prop exists at all.
export interface WritingSurfaceProps {
  blocks: Block[];
  postIndex: number;
  onChange: (next: Block[]) => void;
  problems: ValidationProblem[];
  previews: ImagePreviews;
  onStaged: (key: string, staged: StagedPhoto | null) => void;
  previewKeyPrefix: string;
  names?: StableNames;
}

interface PlacedProblem {
  problem: ValidationProblem;
  target: BlockProblemTarget;
}

interface Row {
  block: Block;
  index: number;
  name: string;
  kind: BlockKind | undefined;
  slots: Slot[];
}

// Every class string below is one blocks.tsx already writes, character for
// character, so the rendered column reads as the published post does and this
// task's marginal stylesheet cost is zero. A retyped Tailwind string is a
// brand-new class to the content scanner even when it renders the same rule.
const PROSE = "font-['Open_Sans'] text-gray-700 leading-relaxed";
const PARAGRAPH = `mb-6 ${PROSE}`;
const HEADING = `mt-10 mb-4 font-['Montserrat'] text-2xl font-bold text-ink`;
const QUOTE = 'mb-6 border-l-4 border-brand pl-4';
const QUOTE_TEXT = `font-['Open_Sans'] text-lg text-gray-700 leading-relaxed`;
const CITE = `mt-2 block font-['Montserrat'] text-sm text-accent`;
const CAPTION = `mt-2 text-center font-['Open_Sans'] text-sm text-gray-500`;
const BULLETS = `list-disc mb-6 pl-5 space-y-2 ${PROSE}`;
const NUMBERS = `list-decimal mb-6 pl-5 space-y-2 ${PROSE}`;
const CARD = 'mb-6 rounded-2xl bg-cream p-6';
const CARD_BULLETS = `list-disc pl-5 space-y-2 ${PROSE}`;
const CARD_NUMBERS = `list-decimal pl-5 space-y-3 ${PROSE}`;

// The list kinds, whose slots are `<li>` and whose error paragraphs therefore
// cannot sit beside them: a `<p>` between two `<li>` is not something a list
// element may contain. Those go after the closing list instead, which costs
// nothing -- `aria-describedby` is an IDREF and does not care where its target
// stands.
const LIST_KINDS: Record<string, true | undefined> = {
  bulletList: true, numberList: true, ingredients: true, steps: true,
};

// Keyed on `(kind, slot)` and not on kind alone: a quote has two slots and
// they are not the same element. The shipped renderer is
// `<blockquote><p>...</p></blockquote>` plus a `<cite>` (blocks.tsx:99-108).
function hostTagFor(kind: BlockKind, key: Slot['key']): string {
  if (key === 'caption') return 'figcaption';
  if (key === 'attribution') return 'cite';
  if (key.startsWith('items[')) return 'li';
  if (kind === 'heading') return 'h2';
  return 'p';
}

function hostClassFor(kind: BlockKind, key: Slot['key']): string | undefined {
  if (key === 'caption') return CAPTION;
  if (key === 'attribution') return CITE;
  // A list item carries no class of its own in blocks.tsx; the list around it
  // does. Returning undefined rather than '' so nothing renders an empty
  // class attribute.
  if (key.startsWith('items[')) return undefined;
  if (kind === 'heading') return HEADING;
  if (kind === 'quote') return QUOTE_TEXT;
  return PARAGRAPH;
}

// The element the shipped renderer puts AROUND this kind's slots. Nothing in
// here is editable and nothing in here is keyed -- it is the same chrome
// blocks.tsx draws, so what she types looks like what a reader will see.
function wrap(kind: BlockKind, children: ReactNode): ReactNode {
  switch (kind) {
    case 'quote':
      return <blockquote className={QUOTE}>{children}</blockquote>;
    case 'image':
      return <figure className="mb-6">{children}</figure>;
    case 'bulletList':
      return <ul className={BULLETS}>{children}</ul>;
    case 'numberList':
      return <ol className={NUMBERS}>{children}</ol>;
    case 'ingredients':
      return <div className={CARD}><ul className={CARD_BULLETS}>{children}</ul></div>;
    case 'steps':
      return <div className={CARD}><ol className={CARD_NUMBERS}>{children}</ol></div>;
    default:
      return children;
  }
}

// `kind` comes out of localStorage through registerLoaded's unchecked cast,
// so the type's promise of a BlockKind is not a runtime fact and the value
// need not even be an object. BlockList.tsx:63 reads it the same way.
function kindOf(block: Block): BlockKind | undefined {
  const raw = (block as { kind?: unknown } | null | undefined)?.kind;
  return isBlockKind(raw) ? raw : undefined;
}

// The kinds a toolbar button may turn a block INTO or OUT OF, and nothing
// else. A photograph, a gallery, a citation and the two recipe cards are all
// deliberately absent: `wordsIn` below can only carry a block's markdown-
// bearing slots across, so converting an image would keep its caption and
// DESTROY THE PHOTOGRAPH, and converting a recipe card would drop the heading
// slots.ts:77-81 explains is not a markdown field. A button that silently
// deletes a picture is a worse failure than a button that does nothing.
const MARK_REFUSAL =
  'Bold and Italic cannot both be kept on exactly the same words, so this one was not applied. '
  + 'Use one or the other, or give one of them a longer or shorter run of words.';

const CONVERTIBLE: Record<string, true | undefined> = {
  paragraph: true, heading: true, quote: true, bulletList: true, numberList: true,
};

// Every markdown-bearing slot of a block as ONE string, an attribution aside.
// A list's items are joined rather than truncated: turning a three-item list
// into a heading and getting only the first item back is two lines of her
// writing destroyed with nothing on screen saying so.
function wordsIn(block: Block): string {
  return slotsOf(block)
    .filter((slot) => slot.key !== 'attribution')
    .map((slot) => slot.source)
    .filter((source) => source.length > 0)
    .join(' ');
}

function asKind(block: Block, kind: ToolbarKind | 'paragraph'): Block {
  const words = wordsIn(block);
  switch (kind) {
    case 'bulletList':
    case 'numberList':
      return { kind, items: [words] };
    case 'heading':
    case 'quote':
    case 'paragraph':
      return { kind, text: words };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

// DOM ids stay POSITIONAL, and that is not the oversight the React key would
// be: they only have to agree with themselves within one render, and
// `posts-0-block-2-text-error` is something a person reads in a test failure
// where `posts-0-block-b7-text-error` is not. BlockFields.tsx:413 makes the
// same call for the same reason. `items[0]` is spelled `items-0` here because
// that is how BlockFields.tsx:171 already spells it.
function idKeyOf(key: Slot['key']): string {
  return key.replace('[', '-').replace(']', '');
}

// The ONE browser-dependent part of Enter and Backspace, and it is a dozen
// lines. Everything either side of the caret comes back as the slot's own
// markdown source, read off the live tree through dom-inline.ts rather than
// off a markup string -- which is why readInline's parameter is `Node` and not
// `HTMLElement`: `cloneContents()` hands back a DocumentFragment.
//
// `collapsed` is reported rather than assumed. With words selected, `before`
// is what stands to the left of the SELECTION, so a Backspace meant to delete
// the selection would otherwise be read as a Backspace at the top of the block
// and merge it into the one above.
//
// jsdom has Range and Selection, so this function is exercised for real in the
// unit tests. What jsdom cannot show is whether the caret a browser actually
// keeps agrees with the offsets read here; that is e2e/writing-surface.spec.ts.
function sourceAroundCaret(el: HTMLElement): { before: string; after: string; collapsed: boolean } | null {
  const selection = el.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const head = range.cloneRange();
  head.selectNodeContents(el);
  head.setEnd(range.startContainer, range.startOffset);
  const tail = range.cloneRange();
  tail.selectNodeContents(el);
  tail.setStart(range.endContainer, range.endOffset);
  return {
    before: serializeInline(readInline(head.cloneContents())),
    after: serializeInline(readInline(tail.cloneContents())),
    collapsed: range.collapsed,
  };
}

// A copy with new blocks standing directly after `index`. `slice()` first, so
// every entry this does not name comes out the far side as the IDENTICAL
// object it went in as -- structure.ts's own `splice` rule, kept here for the
// same reason it is kept there: an array rebuilt entry by entry would detach
// every staged photograph in it at once.
//
// `-1` puts them at the front, which is the only thing an insert can mean
// when the array is empty or when she has not stood in a block yet.
function insertAfter(blocks: Block[], index: number, extra: Block[]): Block[] {
  const next = blocks.slice();
  next.splice(index + 1, 0, ...extra);
  return next;
}

type HostProps = HTMLAttributes<HTMLElement> & Attributes & Record<string, unknown>;

export default function WritingSurface({ blocks, postIndex, onChange, problems, names }: WritingSurfaceProps) {
  // Always called, never conditionally, so the rules of hooks hold whether or
  // not a caller supplies longer-lived storage; its result is simply ignored
  // when one does.
  const ownNames = useStableNames('b');
  const { nameOf, rename } = names ?? ownNames;

  // A draft saved before this feature restores with no `blocks` key at all,
  // and the nearest error boundary is per-SECTION, so an unguarded read takes
  // the whole Posts panel down -- the Phase 4 defect verbatim.
  const safe = Array.isArray(blocks) ? blocks : [];

  // The array as most recently handed UP, which is not always `safe`, because
  // one gesture can produce two of them. A paste commits the words that went
  // into the host she is standing in and THEN adds the paragraphs after it,
  // and React has not re-rendered in between -- so the second call has to
  // build on the first one's result. Built on `safe` instead it would hand up
  // an array that never saw the commit, and the first pasted paragraph would
  // vanish the moment the rest of it arrived.
  //
  // Assigned during render, which is safe here for the reason
  // stable-names.ts:97 gives about its own render-time write: the value being
  // stored is derived from this render's own props, so StrictMode's second
  // pass stores the same thing the first did.
  const latest = useRef<Block[]>(safe);
  latest.current = safe;

  // Every hand-up goes through here, and none of them calls `onChange`
  // directly -- a call that skipped this would leave `latest` naming an array
  // one edit out of date for whatever came next in the same gesture.
  function emit(next: Block[]): void {
    latest.current = next;
    onChange(next);
  }

  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusedRef = useRef<string | null>(null);
  // What each host was last given, keyed on the ELEMENT rather than on the
  // address. Two things fall out of that choice and both are load-bearing:
  // a host React has just created is not in the map, so it is always written
  // (an address-keyed memo would remember a value the fresh element does not
  // hold and leave it blank), and an entry becomes unreachable the moment its
  // element does, so there is nothing to prune.
  const written = useRef<WeakMap<HTMLElement, string>>(new WeakMap());
  // Where the caret has to be once the hosts the edit implies exist. A ref and
  // not state: the render that creates those hosts is the one onChange already
  // schedules, and a second one would only give the browser a frame in which
  // to paint the caret in the wrong place.
  const pendingCaret = useRef<Caret | null>(null);
  // The one conversion an immediate Backspace can put back, and it survives
  // exactly one keystroke: read and cleared at the top of every key, and
  // cleared again by any commit, so it can never fire against words she has
  // typed since.
  const justFormatted = useRef<{ address: string; before: string; after: string } | null>(null);
  // Undo, in a ref and never in state. It must not itself cause a render: the
  // render that matters is the one `onChange` already schedules for the array,
  // and a second one would only give the browser a frame in which to paint the
  // caret somewhere it is not going to stay.
  const history = useRef<History>(EMPTY_HISTORY);
  // The address of the host she was last writing in. Unlike `focusedRef` this
  // is NOT cleared on blur -- it is what an undo, and the toolbar, act on.
  // Keeping the two apart is deliberate: `focusedRef` answers "may this host
  // be rewritten", which stops being true the instant she leaves, and this one
  // answers "where was she working", which does not.
  const active = useRef<string | null>(null);
  // The one thing a control here has to be able to SAY: a refused link target,
  // or a mark this grammar cannot store. State and not a ref, because it is on
  // screen. Cleared by the next action that succeeds, never left standing over
  // a problem she has already fixed.
  const [notice, setNotice] = useState<string | null>(null);

  const rows: Row[] = safe.map((block, index) => ({
    block,
    index,
    name: nameOf(block, index),
    kind: kindOf(block),
    slots: slotsOf(block),
  }));

  // `${name}/${slot.key}` -- the block's STABLE NAME, never its position, for
  // the reason BlockList.tsx:223-254 gives about the React key: a positional
  // address hands one block's content to another the moment she moves one.
  const addressOf = (row: Row, key: Slot['key']): string => `${row.name}/${key}`;

  const sourceByAddress = new Map<string, string>();
  const slotByAddress = new Map<string, { row: Row; slot: Slot }>();
  rows.forEach((row) => row.slots.forEach((slot) => {
    sourceByAddress.set(addressOf(row, slot.key), slot.source);
    slotByAddress.set(addressOf(row, slot.key), { row, slot });
  }));

  // Where an undo should put her back. `Caret` can say start or end and not a
  // character offset, so what a restored step recovers is the SLOT she was
  // working in, not the exact place in it -- stated here rather than implied,
  // and the browser half of it is deferred to e2e/writing-surface.spec.ts.
  function caretAt(address: string | null, offset: Caret['offset']): Caret | null {
    if (address === null) return null;
    const found = slotByAddress.get(address);
    return found === undefined ? null : { blockIndex: found.row.index, slotKey: found.slot.key, offset };
  }

  function snapshot(address: string | null, offset: Caret['offset']): Snapshot {
    // `safe` is the array as it stands BEFORE the edit about to happen, which
    // is what makes this a state to go back to rather than a state to arrive
    // at. The entries in it are the same objects the WeakMap already names, so
    // restoring them restores their names and their staged photographs with
    // them -- there is nothing to rename on the way back.
    return { blocks: safe, caret: caretAt(address, offset), at: Date.now(), slot: address };
  }

  function remember(address: string | null, offset: Caret['offset'], structural: boolean): void {
    history.current = record(history.current, snapshot(address, offset), structural);
  }

  // Only this post's block problems, and all of them. `banner` is everything
  // no rendered slot will show and `shown` is the rest -- partitioned by
  // reference, so a problem is never in both places and never in neither,
  // which is the guarantee RecordForm.tsx:146-159 documents one level up.
  // Three shapes reach the banner: a list-level `[i].blocks`, a block index
  // this post no longer has (validation is debounced, so she can remove a
  // block between the run and the render), and a key no slot of this kind
  // carries -- `alt`, `src`, `kind`, or a stale `items[7]` on a list she has
  // since cut to three.
  const mine = problems
    .map((problem) => ({ problem, target: blockProblemOf(problem.field) }))
    .filter((entry): entry is PlacedProblem => entry.target?.post === postIndex);

  function shownBy(entry: PlacedProblem): Slot['key'] | undefined {
    const at = entry.target.block;
    if (at === undefined || at < 0 || at >= rows.length) return undefined;
    const key = entry.target.key;
    return rows[at].slots.find((slot) => slot.key === key)?.key;
  }

  const banner = mine.filter((entry) => shownBy(entry) === undefined);

  function problemsOf(row: Row, key: Slot['key']): ValidationProblem[] {
    return mine
      .filter((entry) => entry.target.block === row.index && entry.target.key === key)
      .map((entry) => entry.problem);
  }

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    // The hosts are found through their own `data-slot` attribute rather than
    // through a map of refs, and the reason is React 18 rather than taste: an
    // inline ref callback is a new function on every render, so React detaches
    // and reattaches it every time -- and a cleanup that forgot what it had
    // written would then run on every render, defeating the very memo the
    // rewrite guard depends on. The address still comes from the array; this
    // reads back only what this component itself wrote onto the element.
    root.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => {
      const address = el.dataset.slot;
      if (address === undefined) return;
      const source = sourceByAddress.get(address);
      if (source === undefined) return;
      if (focusedRef.current === address) return;
      if (written.current.get(el) === source) return;
      writeInline(el, source);
      written.current.set(el, source);
    });

    // Only after every host holds its words, because the range below is
    // collapsed against this host's CONTENTS and a host written afterwards
    // would leave that range pointing at nodes that no longer exist.
    const pending = pendingCaret.current;
    if (pending === null) return;
    pendingCaret.current = null;
    const row = rows[pending.blockIndex];
    if (row === undefined) return;
    const address = addressOf(row, pending.slotKey);
    const el = root.querySelector<HTMLElement>(`[data-slot="${address}"]`);
    if (el === null) return;
    const selection = el.ownerDocument.getSelection();
    if (selection === null) return;
    // FOCUS FIRST, RANGE SECOND, and that order is the whole of it. Focusing
    // an editable element that did not already have focus puts the caret at
    // the start of it, so focusing AFTER placing the range throws the range
    // away and lands her at the top of the block every time -- which for a
    // merge means every following keystroke goes in front of the paragraph she
    // just joined instead of at the seam. Measured here, not reasoned about:
    // jsdom moves the selection on focus too, and it is what caught this.
    el.focus();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    range.collapse(pending.offset === 'start');
    selection.removeAllRanges();
    selection.addRange(range);
    // She is now standing in this host, so the rewrite guard has to know it
    // before the next render -- a focus event fired by `.focus()` above would
    // say the same thing, but only if the element was focusable, which is a
    // browser fact and not one to depend on.
    focusedRef.current = address;
    active.current = address;
  });

  function commitSlot(index: number, key: Slot['key'], el: HTMLElement, structural = false): void {
    // Words have arrived since the conversion, so putting the trigger back is
    // no longer what a Backspace means. Cleared here as well as on every key
    // because a paste and a composition both commit without one.
    justFormatted.current = null;
    const source = serializeInline(readInline(el));
    const block = safe[index];
    if (block === undefined) return;
    // Before anything is replaced, and only once the edit is going through:
    // an undo step for a commit that returned early would be a step back to
    // the state she is already in.
    remember(addressOf(rows[index], key), 'end', structural);
    const next = withSlot(block, key, source);
    // Before onChange, never after: the re-render this schedules is what looks
    // the name up again, and an edited block is a NEW object.
    rename(block, next, index);
    // Also before onChange, so the value coming back down is recognised as
    // already written and the layout effect leaves the host alone even in the
    // instant between a blur and the re-render.
    written.current.set(el, source);
    emit(safe.map((existing, i) => (i === index ? next : existing)));
  }

  // PASTE, and the whole of "paste strips formatting" is the second line of
  // it: `text/plain` is the only flavour ever asked for, so no foreign font,
  // no bold run and no `<br>` from the source page is ever in this tree to be
  // cleaned up afterwards. EditableText.tsx:185-208 makes the same call one
  // level down and states why cleaning up afterwards is not the same thing.
  //
  // The clipboard text goes in as a TEXT NODE, which is what keeps `**` two
  // literal asterisks: `commitSlot` reads the tree back through readInline and
  // writes it with serializeInline, and serializeInline escapes them. Pasting
  // the SOURCE of a markdown document gives her the characters she can see
  // rather than accidental formatting -- writing the same string in as
  // markdown would silently turn her quoted asterisks into bold.
  function handlePaste(row: Row, slot: Slot, event: ClipboardEvent<HTMLElement>): void {
    const el = event.currentTarget;
    // Suppressed whatever happens next, including for an empty clipboard: the
    // browser's own paste is the thing being replaced, and letting it run for
    // the one case this returns early on would insert rich markup exactly
    // when nothing else was going to.
    event.preventDefault();
    const chunks = pasteChunks(event.clipboardData.getData('text/plain'));
    if (chunks.length === 0) return;
    const selection = el.ownerDocument.getSelection();
    if (selection === null || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return;
    range.deleteContents();
    const node = el.ownerDocument.createTextNode(chunks[0]);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    // Structural: a paste is a step she will reach for an undo after, and it
    // must never be folded into the run of typing either side of it.
    commitSlot(row.index, slot.key, el, true);
    if (chunks.length === 1) return;
    const extra: Block[] = chunks.slice(1).map((chunk) => ({ kind: 'paragraph', text: chunk }));
    // `latest` and not `safe`: commitSlot has ALREADY handed one array up and
    // React has not re-rendered, so building on `safe` would hand up a second
    // array that never saw the first paragraph's words.
    //
    // Every pasted paragraph is genuinely new, so none of them earns a rename
    // -- structure.ts's rule for what does is "an old object leaves the array
    // and exactly one new object stands in its place", and nothing left.
    focusedRef.current = null;
    pendingCaret.current = {
      // The END of the last paragraph she pasted, because that is where she
      // was left in the document she copied it out of. Without it the caret
      // stays in the first chunk and everything she types next lands ABOVE
      // the rest of her own paste.
      blockIndex: row.index + extra.length,
      slotKey: 'text',
      offset: 'end',
    };
    emit(insertAfter(latest.current, row.index, extra));
  }

  // One structural edit, applied in the order the WeakMap requires: every
  // rename BEFORE onChange, because the re-render onChange schedules is what
  // looks the names up again, and a block that changed shape is a NEW object.
  // Miss one and a staged photograph is left filed under a name nothing refers
  // to any more -- the same failure commitSlot's own `rename` call rules out
  // for a keystroke, at the scale of a whole split or merge.
  function applyEdit(edit: Edit, address: string, offset: Caret['offset']): void {
    // Structural, always. Enter, a merge, a step out of a list and an
    // autoformat conversion are the steps she will actually reach for, so none
    // of them is ever folded into the run of typing either side of it.
    remember(address, offset, true);
    edit.renames.forEach((entry) => rename(entry.from, entry.to, entry.index));
    // The caret is leaving this host, so "never rewrite the host she is
    // standing in" has nothing left to protect here. Leaving the address set
    // would stop the layout effect writing the SHORTER source a split
    // produces, and the top half would keep on screen every word the array now
    // says belongs to the block beneath it.
    focusedRef.current = null;
    pendingCaret.current = edit.caret;
    emit(edit.blocks);
  }

  // One step back, or one step forward. NOTHING IS RENAMED HERE and that is
  // not an omission: the blocks in a snapshot are the identical objects that
  // were in the array when it was taken, so `nameOf` already answers for them
  // and a `rename` call would have no `from` to carry a name off. It is the
  // snapshot's own reference that kept those names reachable at all.
  function stepTo(step: { history: History; restored: Snapshot } | null): void {
    if (step === null) return;
    history.current = step.history;
    // The words in every host are about to be replaced by an older version of
    // themselves, including the one she is standing in -- which is the one
    // case where "never rewrite the focused host" has to give way, because
    // leaving it alone would keep on screen exactly the words the undo was
    // asked to remove.
    focusedRef.current = null;
    pendingCaret.current = step.restored.caret;
    emit(step.restored.blocks);
  }

  function undoStep(): void {
    stepTo(undo(history.current, snapshot(active.current, 'end')));
  }

  function redoStep(): void {
    stepTo(redo(history.current, snapshot(active.current, 'end')));
  }

  // The host she was last writing in, if it is still on screen. Every toolbar
  // action goes through this rather than through the live selection alone: the
  // selection tells us WHERE in the tree, and this tells us which block of the
  // array that tree belongs to, which is the half D5 will not let the DOM
  // answer.
  function activeHost(): { el: HTMLElement; row: Row; slot: Slot; address: string } | null {
    const root = rootRef.current;
    const address = active.current;
    if (root === null || address === null) return null;
    const found = slotByAddress.get(address);
    if (found === undefined) return null;
    const el = root.querySelector<HTMLElement>(`[data-slot="${address}"]`);
    return el === null ? null : { el, row: found.row, slot: found.slot, address };
  }

  // BOLD AND EMPHASIS CANNOT BOTH BE STORED ON EXACTLY THE SAME WORDS, and the
  // mark is put back rather than left on screen to disappear later. Their
  // delimiters are made of the same character, so inline-source.ts drops one
  // of the two rather than writing `***x***`, which comes back as a stray
  // asterisk at each end. Committing anyway would give her the exact failure
  // this task exists to prevent: it goes bold, she clicks away, it is plain
  // again, and nothing said why. Refusing keeps the screen and the array
  // agreeing and puts the reason in front of her while her hand is still on
  // the button.
  function markNow(mark: Mark): void {
    const at = activeHost();
    if (at === null) return;
    toggleMark(at.el, mark);
    if (!marksSurviveSave(at.el)) {
      // Straight back off. The second call finds the element the first one
      // built (the selection is inside it) and unwraps it, so the host holds
      // exactly what it held before the button was pressed.
      toggleMark(at.el, mark);
      setNotice(MARK_REFUSAL);
      return;
    }
    setNotice(null);
    commitSlot(at.row.index, at.slot.key, at.el, true);
  }

  function clearNow(): void {
    const at = activeHost();
    if (at === null) return;
    clearMarks(at.el);
    setNotice(null);
    commitSlot(at.row.index, at.slot.key, at.el, true);
  }

  // The exact three gates InlineTextField.tsx:153-207 performs, in the same
  // order and in the same words -- `isSafeHref`, then the `rawLinkTargets`
  // read-back, then insert -- with that file's own sentence imported rather
  // than retyped so the advice and the refusal cannot drift apart.
  function linkNow(): void {
    const at = activeHost();
    if (at === null) return;
    const answer = window.prompt(`Where should this link go? Paste ${TARGET_SHAPES}`);
    // null is Cancel. An EMPTY string is not: she pressed OK with nothing in
    // the box, which is refused below and deserves the same sentence as any
    // other unusable target.
    if (answer === null) return;
    const target = answer.trim();
    if (!isSafeHref(target)) {
      setNotice(linkRefusal(target));
      return;
    }
    const words = selectedWords(at.el);
    if (words === null) return;
    // Asked of the write boundary's OWN reader rather than of a pattern: a
    // target carrying `](`, or an unmatched bracket of its own, moves where
    // rawLinkTargets thinks the target ends, and validatePosts would then
    // refuse the post at publish naming a target she never typed.
    const run = `[${words.length === 0 ? LINK_PLACEHOLDER : words}](${target})`;
    if (rawLinkTargets(run)[0] !== target) {
      setNotice(linkRefusal(target));
      return;
    }
    setNotice(null);
    insertLink(at.el, target);
    commitSlot(at.row.index, at.slot.key, at.el, true);
  }

  function kindNow(kind: ToolbarKind): void {
    const at = activeHost();
    if (at === null) return;
    const block = safe[at.row.index];
    if (block === undefined) return;
    const was = kindOf(block);
    if (was === undefined || CONVERTIBLE[was] !== true) return;
    // Pressing the kind it already is turns it back into a paragraph, which is
    // what every editor carrying these buttons does and the only way back out
    // of a heading with the mouse.
    const next = asKind(block, was === kind ? 'paragraph' : kind);
    // A quotation's attribution has nowhere to go in any other kind, so it
    // becomes a paragraph of its own rather than disappearing --
    // structure.ts:146-154 makes the same call for the same reason, and there
    // is now an undo behind it either way.
    const attribution = slotsOf(block).find((slot) => slot.key === 'attribution')?.source ?? '';
    const carried: Block[] = attribution.trim().length === 0 || next.kind === 'quote'
      ? []
      : [{ kind: 'paragraph', text: attribution }];
    const blocks = safe.slice();
    blocks.splice(at.row.index, 1, next, ...carried);
    setNotice(null);
    applyEdit({
      blocks,
      caret: {
        blockIndex: at.row.index,
        slotKey: LIST_KINDS[next.kind] === true ? 'items[0]' : 'text',
        offset: 'end',
      },
      renames: [{ from: block, to: next, index: at.row.index }],
    }, at.address, 'end');
  }

  // Enter and Backspace, and nothing else. This is not a general "intercept
  // the special keys" rule: every other key, every modifier combination and
  // every composition event is left entirely alone, the same discipline
  // EditableText.tsx:173-179 states.
  function onKey(row: Row, slot: Slot, event: KeyboardEvent<HTMLElement>): void {
    const el = event.currentTarget;
    // Read once and cleared for every key, so the conversion below is undoable
    // by the NEXT keystroke and by no later one.
    const undoable = justFormatted.current;
    justFormatted.current = null;

    // SUPPRESSING THE BROWSER'S OWN UNDO IS THE POINT, not a detail of it.
    // Left alone, Cmd+Z runs contenteditable's private undo stack and puts
    // back DOM the block array knows nothing about; from that moment the
    // screen and the draft that would publish disagree, permanently, with
    // nothing on screen saying so. jsdom has no such default action, so this
    // is deferred to e2e/writing-surface.spec.ts.
    if (event.metaKey || event.ctrlKey) {
      const key = event.key.toLowerCase();
      // Every one of these runs the same handler the button runs, through
      // `active`, rather than a second implementation of the same action.
      // There is no strikethrough shortcut: the spec lists none, and every
      // plausible letter for it is already spoken for.
      if (key === 'b') { event.preventDefault(); markNow('strong'); }
      else if (key === 'i') { event.preventDefault(); markNow('em'); }
      else if (key === 'u') { event.preventDefault(); markNow('underline'); }
      else if (key === 'k') { event.preventDefault(); linkNow(); }
      else if (key === '\\') { event.preventDefault(); clearNow(); }
      else if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoStep();
        else undoStep();
      }
      // Every other modifier combination is left entirely alone. Cmd+A, Cmd+C
      // and Cmd+V are the browser's, and a handler that swallowed them would
      // be a worse defect than anything it bought.
      return;
    }

    if (event.key === ' ') {
      const around = sourceAroundCaret(el);
      if (around === null || !around.collapsed) return;
      const block = safe[row.index];
      const converted = block === undefined ? null : autoformat(block, slot.key, around.before, around.after);
      if (converted === null || block === undefined) return;
      event.preventDefault();
      const caretKey: Slot['key'] = LIST_KINDS[converted.kind] === true ? 'items[0]' : 'text';
      applyEdit({
        blocks: safe.map((existing, i) => (i === row.index ? converted : existing)),
        caret: { blockIndex: row.index, slotKey: caretKey, offset: 'start' },
        renames: [{ from: block, to: converted, index: row.index }],
      }, addressOf(row, slot.key), 'end');
      // The name survives the conversion, so the slot she is about to be
      // standing in has an address that can be recognised on the next key.
      justFormatted.current = { address: `${row.name}/${caretKey}`, before: around.before, after: around.after };
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      // Suppressed whatever happens next: the browser's own Enter inside a
      // host would split the tree the array is supposed to own. Shift+Enter is
      // deliberately untouched and still makes a line break, which
      // dom-inline.ts reads back as a space.
      event.preventDefault();
      const around = sourceAroundCaret(el);
      if (around === null) return;
      applyEdit(
        enterAt(safe, { blockIndex: row.index, slotKey: slot.key, offset: 'start' }, around.before, around.after),
        addressOf(row, slot.key),
        'end',
      );
      return;
    }
    if (event.key === 'Backspace') {
      // The escape hatch, ahead of everything else Backspace does: at this
      // moment the caret is at the top of the block the conversion made, so
      // the ordinary rule below would demote her new heading or step her out
      // of her new list instead of giving her back the "1. " she typed.
      if (undoable !== null && undoable.address === addressOf(row, slot.key)) {
        const block = safe[row.index];
        if (block === undefined) return;
        const reverted = revertFormat(undoable.before, undoable.after);
        event.preventDefault();
        applyEdit({
          blocks: safe.map((existing, i) => (i === row.index ? reverted : existing)),
          caret: { blockIndex: row.index, slotKey: 'text', offset: 'end' },
          renames: [{ from: block, to: reverted, index: row.index }],
        }, addressOf(row, slot.key), 'start');
        return;
      }
      const around = sourceAroundCaret(el);
      if (around === null || !around.collapsed || around.before.length > 0) return;
      const edit = backspaceAtStart(safe, { blockIndex: row.index, slotKey: slot.key, offset: 'start' });
      // Nothing to do is nothing to do: the default is left in place so a
      // Backspace this does not understand still behaves as the browser's.
      if (edit === null) return;
      event.preventDefault();
      applyEdit(edit, addressOf(row, slot.key), 'start');
    }
  }

  function host(row: Row, kind: BlockKind, slot: Slot): ReactNode {
    const address = addressOf(row, slot.key);
    const id = `posts-${postIndex}-block-${row.index}-${idKeyOf(slot.key)}`;
    const props: HostProps = {
      key: address,
      contentEditable: true,
      className: hostClassFor(kind, slot.key),
      // The query surface for every jsdom case in this section, and for the
      // layout effect above. No hand-written `role`: an editable host with an
      // invented role is a claim about assistive behaviour nothing here can
      // verify.
      'data-slot': address,
      'data-slot-key': slot.key,
      'aria-describedby': problemsOf(row, slot.key).length > 0 ? `${id}-error` : undefined,
      onInput: (event) => commitSlot(row.index, slot.key, event.currentTarget as HTMLElement),
      onKeyDown: (event) => onKey(row, slot, event),
      onPaste: (event) => handlePaste(row, slot, event),
      onFocus: () => {
        focusedRef.current = address;
        active.current = address;
      },
      onBlur: () => {
        if (focusedRef.current === address) focusedRef.current = null;
      },
    };
    return createElement(hostTagFor(kind, slot.key), props);
  }

  function error(row: Row, slot: Slot): ReactNode {
    const own = problemsOf(row, slot.key);
    if (own.length === 0) return null;
    const id = `posts-${postIndex}-block-${row.index}-${idKeyOf(slot.key)}`;
    // The same class string as InlineTextField.tsx:325, character for
    // character, and `role="alert"` so PostList's FIRST_PROBLEM_SELECTOR
    // (PostList.tsx:143) reaches it in document order along with everything
    // else on the panel.
    return (
      <p key={`${id}-error`} id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-600">
        {own.map((problem) => problem.message).join(' ')}
      </p>
    );
  }

  function rowOf(row: Row): ReactNode {
    const kind = row.kind;
    if (kind === undefined || row.slots.length === 0) return null;
    if (LIST_KINDS[kind] === true) {
      return (
        <>
          {wrap(kind, row.slots.map((slot) => host(row, kind, slot)))}
          {row.slots.map((slot) => error(row, slot))}
        </>
      );
    }
    return wrap(
      kind,
      row.slots.map((slot) => (
        <Fragment key={addressOf(row, slot.key)}>
          {host(row, kind, slot)}
          {error(row, slot)}
        </Fragment>
      )),
    );
  }

  return (
    <div ref={rootRef}>
      <WritingToolbar
        onMark={markNow}
        onLink={linkNow}
        onKind={kindNow}
        onClear={clearNow}
        onUndo={undoStep}
        onRedo={redoStep}
        imageInputId={`posts-${postIndex}-writing-image`}
      />
      {notice !== null && (
        // The same class string as every other error paragraph on this screen
        // (InlineTextField.tsx:325), character for character, and `role`
        // rather than a colour so PostList's FIRST_PROBLEM_SELECTOR reaches it
        // in document order with everything else.
        <p role="alert" className="mt-1 text-sm text-red-600">
          {notice}
        </p>
      )}

      {/* BlockList.tsx:209-221's banner, copied verbatim rather than shared:
          there is nothing importable (BlockProblemMessage is a different
          thing, rendered per block), and the two have to read identically to
          the owner. */}
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with this post’s content"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((entry, i) => (
              <li key={i}>{entry.problem.message}</li>
            ))}
          </ul>
        </div>
      )}

      {rows.map((row) => (
        <Fragment key={row.name}>{rowOf(row)}</Fragment>
      ))}
    </div>
  );
}
