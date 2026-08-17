// Every block of one post, in order, with Up/Down/Remove and a drag handle.
// The buttons stay now that the handle is here, because a drag is unusable on
// a phone with a long list of blocks, so drag is a SECOND way to do this and
// never the only way.
//
// Button bindings imported from RecordList rather than retyped, for the
// reason that file's own comment gives: a retyped Tailwind string is a new
// class to the content scanner and ships a duplicate rule.
import { useState } from 'react';
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
// decision rather than a style preference. The move-cursor utility has no rule
// in this stylesheet, and neither has any half-strength opacity utility (the
// four that ship are 0, 20, 90 and 100) -- measured, both of them, by a
// rule-level diff against a worktree build of the parent commit: the class
// version of this handle and its dimmed row costs +48 bytes and two new rules
// against 107 bytes of headroom, leaving 59 for whoever comes next. So both
// take the escape hatch this repository has documented for this exact ceiling
// since Plan 6 (CollageTile.tsx's inline gradient, CollapsibleSection.tsx's
// fieldset reset, the publish panel's 72px offset): the pixels are identical
// and the stylesheet does not move a byte. `style-src` allows inline styles on
// purpose and src/test/hosting.test.ts says why.
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
const HANDLE_CLASSNAME = 'select-none px-3 py-1 text-gray-500';

// Read off the handle itself by e2e/block-editor.spec.ts, which is the only
// place a computed cursor can be checked at all -- jsdom has no layout engine
// and no cascade worth asking.
const HANDLE_STYLE = { cursor: 'move' };

// The block in flight, dimmed. Once the pointer has left the row this is the
// only thing telling her which block she has hold of. Inline for the same
// reason the cursor is, and 0.5 rather than one of the four opacity utilities
// that do ship: 0.9 is not a visible change and 0.2 is a block she can no
// longer read.
const DRAGGING_STYLE = { opacity: 0.5 };

export default function BlockList({
  blocks,
  postIndex,
  onChange,
  problems,
  previews,
  onStaged,
  previewKeyPrefix,
}: BlockListProps) {
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

      {/* A POSITIONAL key on the <li>, deliberately, and it is the opposite
          call from RecordList's `key={item.id}`. A block carries no id and its
          identity IS its position: moving one is exactly what Up/Down and
          Task 8's drag handle do, and React should re-render both. PostBody.tsx
          (5A, Task 6) argues the other side at length for CollagePhoto, where a
          positional identity was wrong because a photo survives a swap and a
          staged replacement has to follow it. A block does not survive
          anything -- but a staged PHOTO inside one does, which is why
          `onStaged`'s key below is `blocks[<index>].src`: reordering blocks
          after staging a photo and before publishing would misattribute it.
          Task 10 owns the test for that. */}
      <ul>
        {safe.map((block, index) => {
          const kind = kindOf(block);
          const label = kind === undefined ? UNKNOWN_BLOCK_LABEL : BLOCK_KIND_LABELS[kind];
          const own = mine.filter((entry) => entry.target.block === index);
          // Everything about this block that no field of it will show. For an
          // unrecognised kind that is all of them, because no field of it is
          // rendered at all.
          const unplaced = kind === undefined ? own : own.filter((entry) => !claimsKey(block, kind, entry.target.key));
          return (
            <li
              key={index}
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
                  onChange={(next) => onChange(safe.map((existing, i) => (i === index ? next : existing)))}
                  idPrefix={`posts-${postIndex}-block-${index}`}
                  problemsFor={(key) =>
                    own.filter((entry) => entry.target.key === key).map((entry) => entry.problem)
                  }
                  previews={previews}
                  onStaged={(key, staged) => onStaged(`blocks[${index}].${key}`, staged)}
                  previewKeyPrefix={`${previewKeyPrefix}:blocks[${index}]`}
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
