// Every block of one post, in order, with Up/Down/Remove and a drag handle.
// The buttons stay now that the handle is here, because a drag is unusable on
// a phone with a long list of blocks, so drag is a SECOND way to do this and
// never the only way.
//
// Button bindings imported from RecordList rather than retyped, for the
// reason that file's own comment gives: a retyped Tailwind string is a new
// class to the content scanner and ships a duplicate rule.
import { useRef, useState } from 'react';
import BlockFields from './BlockFields';
import BlockPicker from './BlockPicker';
import BlockProblemMessage from './BlockProblemMessage';
import { blankBlock } from './blank-block';
import { blockProblemOf, type BlockProblemTarget } from './block-problems';
import { moveTo, swapAt } from './reorder';
import { BLOCK_KIND_LABELS, UNKNOWN_BLOCK_LABEL, UNKNOWN_BLOCK_MESSAGE } from './block-meta';
import { MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME } from '../RecordList';
import { BLOCK_KEYS, isBlockKind } from '../../content/guards';
import type { Block, BlockKind } from '../../content/types';
import type { ImagePreviews } from '../previews';
import type { StagedPhoto } from '../PhotoField';
import type { ValidationProblem } from '../../content/validate';

export interface BlockListProps {
  blocks: Block[];
  // Which post in the list, so this component can pick its own problems out
  // of the whole file's list without the caller pre-slicing (the same
  // "hand it everything" contract RecordList takes, for the same reason).
  postIndex: number;
  onChange: (next: Block[]) => void;
  problems: ValidationProblem[];
  previews: ImagePreviews;
  onStaged: (key: string, staged: StagedPhoto | null) => void;
  previewKeyPrefix: string;
}

interface PlacedProblem {
  problem: ValidationProblem;
  target: BlockProblemTarget;
}

// `kind` comes out of localStorage through registerLoaded's unchecked cast
// (sections/register-loaded.ts), so the type's promise of a BlockKind is not a
// runtime fact -- and the value need not even be an object. validateBlock has
// an isBlockKind branch of its own for exactly this shape, which is the proof
// that the model expects to meet it rather than ruling it out.
//
// Undefined here means "do not hand this to BlockFields": its switch has no
// branch for such a block, and its default returns nothing, so she would get
// a strip with no controls under it and no explanation. This component renders
// the explanation instead.
function kindOf(block: Block): BlockKind | undefined {
  const raw = (block as { kind?: unknown } | null | undefined)?.kind;
  return isBlockKind(raw) ? raw : undefined;
}

// Whether one of this block's own rendered fields will actually SHOW a
// problem with this key -- the per-block half of RecordList's
// unclaimedProblems guarantee, and it exists because the same silent loss is
// reachable one level down. Three shapes reach a rendered block carrying a key
// no field of it asks for:
//
//   `kind`        -- validateBlock's "contains a "wonky" block" message. No
//                    control edits a block's kind (she removes it and adds
//                    another), so nothing would claim it.
//   an odd key    -- validateBlock's unknownKeys pass reports `[0].blocks[0].level`
//                    for a stale draft carrying a field this site dropped.
//   a stale index -- `items[7]` on a list she has since cut to three. The same
//                    reachability the block-index check below has, for the same
//                    reason: validation is debounced.
//
// Derived from BLOCK_KEYS (guards.ts) rather than from a second hand-written
// list of what BlockFields renders, so a key added to a kind cannot be claimed
// here without also being declared there. `items[3]` and `images[0].src` are
// the list keys with an index on them, and are claimed only while the index is
// one the list actually has -- which is exactly when BlockFields renders a
// field for it.
function claimsKey(block: Block, kind: BlockKind, key: string | undefined): boolean {
  if (key === undefined || key === 'kind') return false;
  const indexed = key.match(/^(items|images)\[(\d+)\]/);
  if (indexed !== null) {
    const list = (block as unknown as Record<string, unknown>)[indexed[1]];
    return Array.isArray(list) && Number(indexed[2]) < list.length;
  }
  return Object.prototype.hasOwnProperty.call(BLOCK_KEYS[kind], key);
}

// A drag handle's whole discoverability is its cursor: the handle is one glyph
// wide and there is no other affordance on it, so the pointer changing shape
// over it is the only thing that says it can be dragged at all.
//
// THE CURSOR IS AN INLINE STYLE, NOT A UTILITY CLASS, and that is a byte
// decision rather than a style preference. No UNPREFIXED move-cursor rule is in
// this stylesheet, and no unprefixed half-strength opacity rule either -- the
// unprefixed opacity utilities that ship are 0, 20, 90 and 100. Read that word
// literally: the sheet does carry a `:disabled`-gated half-strength rule and a
// `:disabled` cursor rule, and neither can dim or re-point anything here,
// because this row is not a disabled form control. Both were measured by a
// rule-level diff against a worktree build of the parent commit: the class
// version of this handle and its dimmed row costs +48 bytes and two new rules
// against 107 bytes of headroom, leaving 59 for whoever comes next. So both
// take the escape hatch this repository has documented for this exact ceiling
// since Plan 6 (CollageTile.tsx's inline gradient, since deleted;
// CollapsibleSection.tsx's fieldset reset, which also ships an inline
// conditional opacity of its own; the publish panel's 72px offset): the pixels
// are identical and the stylesheet does not move a byte. `style-src` allows
// inline styles on purpose and src/test/hosting.test.ts says why.
//
// The user-select utility below is a real class because it ALREADY has a rule,
// so it costs nothing -- and it is not optional: without it a slow drag selects
// the kind label's text instead of starting a drag, which reads as the handle
// not working.
//
// `aria-hidden` and no role: this is a mouse affordance, and a screen-reader
// user reorders with the Up/Down buttons, which are real buttons with real
// names and are not going anywhere. A `role="button"` here would announce a
// third control that does nothing without a pointer.
//
// IT IS ALSO ON HER PHONE, WHERE A DRAG CANNOT WORK AT ALL, and that is a
// decision rather than an oversight. Measured at 390px: 34.94 by 32, a small
// grey dot grid to the left of the kind label. Taking it off small screens
// means a breakpoint-prefixed display utility, which is a new rule against the
// same 107 bytes this whole comment is about, spent to remove something that
// costs her one glance. She reorders by Up and Down there, which is why those
// buttons were never allowed to become optional.
const HANDLE_CLASSNAME = 'select-none px-3 py-1 text-gray-500';

// Read off the handle itself by e2e/block-editor.spec.ts, which is the only
// place a computed cursor can be checked at all -- jsdom has no layout engine
// and no cascade worth asking.
const HANDLE_STYLE = { cursor: 'move' };

// The block in flight, dimmed. Once the pointer has left the row this is the
// only thing telling her which block she has hold of. Inline for the same
// reason the cursor is, and 0.5 rather than one of the four unprefixed opacity
// utilities that do ship: 0.9 is no change she would notice and 0.2 is a block
// she can no longer read. Both halves are proven in the browser -- the row
// dims, and it stops being dimmed once the drop lands, which is the half a
// version that dimmed and never cleared would have passed.
const DRAGGING_STYLE = { opacity: 0.5 };

// A NAME FOR ONE BLOCK THAT SURVIVES BEING MOVED, and the whole of Task 10's
// staged-photo fix.
//
// A block carries no id, and it must not start carrying one: `id` would be a
// key in posts.json, published, validated and forever afterwards ours to keep
// -- for something no reader of the blog will ever see. So the name is held
// HERE, beside the list rather than inside it, keyed on the block object
// itself. Reordering is what `swapAt`/`moveTo` do (reorder.ts): both copy the
// ARRAY and move the same objects, so a block that has been dragged from
// fourth place to first is, to a WeakMap, the identical key it always was.
//
// A WeakMap rather than a counter parallel to the list, which is the other
// obvious shape: a parallel array has to be re-derived every time the list
// changes from outside this component (a restored draft, an undo, a post
// reordered above), and every one of those re-derivations is a chance to
// hand a photo to the wrong block again. This map has nothing to re-derive.
// It also cannot leak: an entry is unreachable the moment its block is,
// which for a removed block is immediately.
//
// EDITING A BLOCK REPLACES ITS OBJECT (`{ ...block, text: next }`, one per
// keystroke), so the name is carried across at that one call site below --
// `rename` -- rather than being regenerated. Without that, every keystroke in
// a block with a staged photo would move the photo to a name nothing else
// refers to.
//
// Non-object blocks fall back to their position, which is the honest answer
// for them: a stale draft's `null` or `"paragraph"` in the blocks array is not
// a WeakMap key at all, renders no fields, and therefore never holds a photo.
type BlockName = (block: Block, index: number) => string;

export default function BlockList({
  blocks,
  postIndex,
  onChange,
  problems,
  previews,
  onStaged,
  previewKeyPrefix,
}: BlockListProps) {
  const names = useRef(new WeakMap<object, string>());
  const nextName = useRef(0);
  // Cast the same way `kindOf` above casts, and for the same reason: a block
  // out of localStorage need not be an object at all, whatever the type says.
  const asKey = (block: Block): object | undefined => {
    const raw = block as unknown;
    return raw !== null && typeof raw === 'object' ? (raw as object) : undefined;
  };
  const nameOf: BlockName = (block, index) => {
    const key = asKey(block);
    if (key === undefined) return `at-${index}`;
    const existing = names.current.get(key);
    if (existing !== undefined) return existing;
    nextName.current += 1;
    const fresh = `b${nextName.current}`;
    names.current.set(key, fresh);
    return fresh;
  };
  // The edited block is a new object with the same name -- see the type's own
  // comment above. Called before `onChange`, so the re-render that follows
  // already finds it.
  function rename(from: Block, to: Block, index: number): void {
    const key = asKey(to);
    if (key !== undefined) names.current.set(key, nameOf(from, index));
  }

  // A draft saved before this feature restores with no `blocks` key at all
  // (registerLoaded's unchecked cast), and the only error boundary between
  // here and the page is per-SECTION -- so an unguarded read would take the
  // Posts panel's heading down with it, which is the Phase 4 defect verbatim.
  const safe = Array.isArray(blocks) ? blocks : [];

  // Only this post's block problems, and all of them: the list-level ones
  // (`[i].blocks`, "has nothing in it yet"), the per-block field ones, and
  // anything naming a block index this post no longer has -- which is
  // reachable, because validation is debounced and she can remove a block
  // between the run and the render.
  const mine = problems
    .map((problem) => ({ problem, target: blockProblemOf(problem.field) }))
    .filter((entry): entry is PlacedProblem => entry.target?.post === postIndex);

  const banner = mine.filter(
    (entry) => entry.target.block === undefined || entry.target.block < 0 || entry.target.block >= safe.length,
  );

  function swap(index: number, otherIndex: number): void {
    onChange(swapAt(safe, index, otherIndex));
  }

  // Which block is being dragged, or null. State rather than a ref, because the
  // dragged block renders differently while it is in flight, and that dimming
  // is the only thing telling her which one she has hold of once the pointer
  // has left the row.
  //
  // It is also what carries the source index across the drop, rather than the
  // DataTransfer payload: only this list can be mid-drag in its own state, so a
  // block cannot be dragged out of one post and dropped into another, and a
  // file dragged in from the desktop finds no drop target here at all.
  const [dragging, setDragging] = useState<number | null>(null);

  return (
    <div>
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

      {/* `nameOf(block, index)`, NOT the index -- and this line used to be the
          index, with a comment defending it, so read the correction rather
          than the habit. PostBody.tsx (5A, Task 6) argued the same point for
          CollagePhoto and got it right there: a positional identity is wrong
          wherever a photo can survive the move, because the photo has to
          follow the thing it belongs to.

          THE DEFECT THIS FIXES, kept written down because the shape of it is
          the reason three keys below all have to agree. A block does not
          survive a reorder; a staged PHOTO inside one does. While every one of
          those keys was a POSITION, she could pick a photo for the fourth
          block, move that block to the top before publishing, and find her
          photo shown on whichever block was fourth now -- and, if she then
          picked a second photo there, find the FIRST one's bytes dropped from
          the collector entirely (they were stored under the position, and the
          new pick's own supersede cleared that position). The post would then
          be published naming a photo no file was ever sent for: a broken image
          on the live site, and an asset-existence failure on every build after
          it. Nothing on screen said any of it.

          Older than the drag handle: Up and Down could always do this. What
          the handle changed is the cost of reaching it -- four positions used
          to be six deliberate clicks and is now one gesture -- so a defect
          that needed persistence became one an ordinary edit runs into, which
          is why Task 8's review ruled it in.

          The React key is here, the staged-photo key and the preview key are
          on BlockFields below, and all three are now the block's own name.
          They have to move together: a stable staged key with a positional
          React key still shows her the wrong photo, because PhotoField's
          just-picked object URL lives in the component instance that the
          positional key would leave standing where it was. */}
      <ul>
        {safe.map((block, index) => {
          const name = nameOf(block, index);
          const kind = kindOf(block);
          const label = kind === undefined ? UNKNOWN_BLOCK_LABEL : BLOCK_KIND_LABELS[kind];
          const own = mine.filter((entry) => entry.target.block === index);
          // Everything about this block that no field of it will show. For an
          // unrecognised kind that is all of them, because no field of it is
          // rendered at all.
          const unplaced = kind === undefined ? own : own.filter((entry) => !claimsKey(block, kind, entry.target.key));
          return (
            <li
              key={name}
              // The drop target is the whole row, not a thin line between rows:
              // a 4px gap is not something anybody can hit on a phone, and
              // dropping "on" a block meaning "put mine here" is how every list
              // she has ever used behaves.
              onDragOver={(event) => {
                if (dragging === null) return;
                // preventDefault is what makes an element a valid drop target at
                // all -- without it the browser refuses the drop and the drag
                // ends with nothing happening, which is the single most common
                // way HTML5 drag-and-drop is got wrong. No jsdom test can see
                // it; e2e/block-editor.spec.ts is what covers it.
                event.preventDefault();
              }}
              onDrop={(event) => {
                if (dragging === null) return;
                event.preventDefault();
                if (dragging !== index) onChange(moveTo(safe, dragging, index));
                setDragging(null);
              }}
              className="mb-6 rounded border border-gray-200 p-4"
              style={dragging === index ? DRAGGING_STYLE : undefined}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                {/* The handle and the kind label as ONE group, so the row still
                    has two things in it to space apart -- a third child here
                    would push the label into the middle of the row. The same
                    grouping RecordList's own header uses for its thumbnail and
                    move buttons, out of the same already-shipping utilities. */}
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    draggable
                    onDragStart={(event) => {
                      setDragging(index);
                      // Firefox refuses to start a drag at all unless something
                      // is set on the DataTransfer. The value is never read --
                      // the source index lives in this component's state, which
                      // is the only thing that survives a drop reliably across
                      // browsers -- so this is deliberately the block's own
                      // position as a plain string rather than anything a paste
                      // could act on.
                      //
                      // NOTHING TESTS THIS LINE. The browser spec runs Chromium,
                      // which starts the drag without it, so the one browser
                      // this exists for is the one nobody has run. If drag ever
                      // reads as dead in Firefox, start here.
                      event.dataTransfer.setData('text/plain', String(index));
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={HANDLE_CLASSNAME}
                    style={HANDLE_STYLE}
                    // The e2e spec's selector, carrying the index so it can
                    // target one specific handle without a role-and-name query
                    // it could never have (the handle has no accessible name on
                    // purpose). The same cheap-attribute reasoning `data-panel`
                    // follows, and it costs no CSS rule.
                    data-drag-handle={index}
                    // The only `title` in src/, and it is here rather than
                    // anywhere else for a reason this file can defend: every
                    // other control on this dashboard says what it is in text or
                    // in an aria-label, and this one is a single glyph with
                    // neither. It reaches exactly one person -- somebody on a
                    // mouse who hovers and waits -- and that is the only person
                    // who can use the handle at all. It reaches no screen reader
                    // (the element is aria-hidden, deliberately) and no phone.
                    // Not an accessibility affordance and not counted as one.
                    title="Drag to move this block"
                  >
                    ⠿
                  </span>
                  <span className={`font-['Montserrat'] text-sm uppercase tracking-wide text-accent`}>{label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* The labels carry the block's POSITION as well as its kind,
                      and that is not padding. A recipe has two Paragraph
                      blocks more often than not, and "Move Paragraph block up"
                      would then match two buttons -- which reads as a broken
                      query rather than as the ambiguity it is, and leaves a
                      screen-reader user with no way to tell the two apart.

                      Omitted at the ends, not disabled -- RecordList's own
                      rule, and its reasoning applies unchanged. */}
                  {index > 0 && (
                    <button
                      type="button"
                      aria-label={`Move ${label} block ${index + 1} up`}
                      onClick={() => swap(index, index - 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Up
                    </button>
                  )}
                  {index < safe.length - 1 && (
                    <button
                      type="button"
                      aria-label={`Move ${label} block ${index + 1} down`}
                      onClick={() => swap(index, index + 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Down
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${label} block ${index + 1}`}
                    onClick={() => onChange(safe.filter((_, i) => i !== index))}
                    className={REMOVE_BUTTON_CLASSNAME}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Only while nothing else is saying it. Once validation has
                  run, validateBlock's own message is in `unplaced` below and
                  names the kind she actually has ("contains a \"wonky\"
                  block") -- two sentences for one thing, disagreeing on what to
                  add in its place, is the defect InlineTextField exists to
                  avoid one level down. This one is for the window BEFORE that
                  message arrives, which is real: validation is debounced. */}
              {kind === undefined && unplaced.length === 0 && (
                <BlockProblemMessage>{UNKNOWN_BLOCK_MESSAGE}</BlockProblemMessage>
              )}

              {unplaced.map((entry, i) => (
                <BlockProblemMessage key={i}>{entry.problem.message}</BlockProblemMessage>
              ))}

              {kind !== undefined && (
                <BlockFields
                  block={block}
                  onChange={(next) => {
                    // Before onChange, never after: the re-render this
                    // schedules is what looks the name up again, and an edited
                    // block is a NEW object. See the BlockName comment above.
                    rename(block, next, index);
                    onChange(safe.map((existing, i) => (i === index ? next : existing)));
                  }}
                  // The one key here that stays POSITIONAL, and it is not an
                  // oversight. These are DOM ids for `<label for>`, and the
                  // pair only has to agree with itself within a single render;
                  // `posts-0-block-2-text` is also something a person reads in
                  // a test failure, which `posts-0-block-b7-text` is not.
                  // Nothing survives a reorder by holding one.
                  idPrefix={`posts-${postIndex}-block-${index}`}
                  problemsFor={(key) =>
                    own.filter((entry) => entry.target.key === key).map((entry) => entry.problem)
                  }
                  previews={previews}
                  // THE STAGED-PHOTO KEY AND THE PREVIEW KEY, both the block's
                  // own name rather than its position -- the fix the <ul>
                  // comment above explains in full. `previews.set` revokes
                  // whatever its key held before, so a positional preview key
                  // does not merely mislead: it destroys the other photo's
                  // object URL when two blocks trade places.
                  //
                  // Only this component can compose these. The collector
                  // (staged.ts) stores whatever string it is handed and never
                  // reads one back, so a re-keying pass down there would have
                  // to be told which key moved where by exactly this line
                  // anyway -- and would still be a second mechanism to keep in
                  // step with the React key.
                  onStaged={(key, staged) => onStaged(`blocks[${name}].${key}`, staged)}
                  previewKeyPrefix={`${previewKeyPrefix}:blocks[${name}]`}
                />
              )}
            </li>
          );
        })}
      </ul>

      {/* Unconditional, and that is the case that matters: a post with no
          blocks at all shows validatePost's "has nothing in it yet -- add a
          paragraph before publishing it" in the banner above, and a picker
          rendered only when blocks exist would leave her reading a complaint
          with no remedy on the same screen. `blankPost` (areas/PostsArea.tsx)
          creates exactly that post, on purpose. */}
      <BlockPicker onPick={(kind) => onChange([...safe, blankBlock(kind)])} />
    </div>
  );
}
