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
import { createElement, Fragment, useLayoutEffect, useRef, type Attributes, type HTMLAttributes, type ReactNode } from 'react';
import { blockProblemOf, type BlockProblemTarget } from '../blocks/block-problems';
import { useStableNames, type StableNames } from '../blocks/stable-names';
import { readInline } from './dom-inline';
import { writeInline } from './inline-dom';
import { slotsOf, withSlot, type Slot } from './slots';
import { serializeInline } from '../../content/inline-source';
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

// DOM ids stay POSITIONAL, and that is not the oversight the React key would
// be: they only have to agree with themselves within one render, and
// `posts-0-block-2-text-error` is something a person reads in a test failure
// where `posts-0-block-b7-text-error` is not. BlockFields.tsx:413 makes the
// same call for the same reason. `items[0]` is spelled `items-0` here because
// that is how BlockFields.tsx:171 already spells it.
function idKeyOf(key: Slot['key']): string {
  return key.replace('[', '-').replace(']', '');
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

  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusedRef = useRef<string | null>(null);
  // What each host was last given, keyed on the ELEMENT rather than on the
  // address. Two things fall out of that choice and both are load-bearing:
  // a host React has just created is not in the map, so it is always written
  // (an address-keyed memo would remember a value the fresh element does not
  // hold and leave it blank), and an entry becomes unreachable the moment its
  // element does, so there is nothing to prune.
  const written = useRef<WeakMap<HTMLElement, string>>(new WeakMap());

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
  rows.forEach((row) => row.slots.forEach((slot) => sourceByAddress.set(addressOf(row, slot.key), slot.source)));

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
  });

  function commitSlot(index: number, key: Slot['key'], el: HTMLElement): void {
    const source = serializeInline(readInline(el));
    const block = safe[index];
    if (block === undefined) return;
    const next = withSlot(block, key, source);
    // Before onChange, never after: the re-render this schedules is what looks
    // the name up again, and an edited block is a NEW object.
    rename(block, next, index);
    // Also before onChange, so the value coming back down is recognised as
    // already written and the layout effect leaves the host alone even in the
    // instant between a blur and the re-render.
    written.current.set(el, source);
    onChange(safe.map((existing, i) => (i === index ? next : existing)));
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
      onFocus: () => {
        focusedRef.current = address;
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
