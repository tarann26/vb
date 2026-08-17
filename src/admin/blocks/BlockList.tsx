// Every block of one post, in order, with Up/Down/Remove. The drag handle
// arrives in Task 8; the buttons stay when it does, because a drag is
// unusable on a phone with a long list of blocks, so drag is a SECOND way to
// do this and never the only way.
//
// Button bindings imported from RecordList rather than retyped, for the
// reason that file's own comment gives: a retyped Tailwind string is a new
// class to the content scanner and ships a duplicate rule.
import BlockFields from './BlockFields';
import { blockProblemOf, type BlockProblemTarget } from './block-problems';
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

const BLOCK_MESSAGE_CLASSNAME = "mb-3 font-['Montserrat'] text-sm text-red-600";

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
    const next = [...safe];
    const moved = next[index];
    next[index] = next[otherIndex];
    next[otherIndex] = moved;
    onChange(next);
  }

  return (
    <div>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with this post’s content"
          tabIndex={-1}
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
            <li key={index} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className={`font-['Montserrat'] text-sm uppercase tracking-wide text-accent`}>{label}</span>
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

              {kind === undefined && (
                <p role="alert" tabIndex={-1} className={BLOCK_MESSAGE_CLASSNAME}>
                  {UNKNOWN_BLOCK_MESSAGE}
                </p>
              )}

              {/* `tabIndex={-1}` so PostList's "take me to the first one" can
                  put focus here; never in the tab order. */}
              {unplaced.map((entry, i) => (
                <p key={i} role="alert" tabIndex={-1} className={BLOCK_MESSAGE_CLASSNAME}>
                  {entry.problem.message}
                </p>
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
    </div>
  );
}
