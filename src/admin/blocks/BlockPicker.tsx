// Ten buttons, one per block kind, built from BLOCK_KINDS (src/content/guards.ts)
// rather than a list of its own -- so the picker cannot offer a kind
// BlockFields has no branch for, and cannot silently miss one the model has.
// BLOCK_KIND_SET is checked exhaustive against BlockKind at compile time, so
// that list is the closed one.
//
// `type="button"` on every one, and not cosmetic: this renders inside the one
// <form> PublishBar's Publish button submits, and an unlabelled <button>
// inside a form defaults to type="submit" -- so adding a block would have
// opened the publish confirmation instead. CollapsibleSection's own toggle
// carries the same comment for the same reason.
//
// Two across on a phone and three from 640px up: `grid-cols-2` and
// `sm:grid-cols-3` both already ship. NOT the wider breakpoint's
// three-across variant, which would be a new rule against 107 bytes of
// headroom, and there is no visual argument for it here.
import { BLOCK_KIND_HELP, BLOCK_KIND_LABELS } from './block-meta';
import { BLOCK_KINDS } from '../../content/guards';
import type { BlockKind } from '../../content/types';

// Her order, not the model's. BLOCK_KINDS comes out in BlockContentMap's
// declaration order, which is fine for a compiler and wrong for a person:
// paragraph and heading are what she reaches for in every post and belong
// first, and the recipe pair belongs together. A hand-written order that is
// CHECKED against BLOCK_KINDS for completeness (BlockPicker.test.tsx) gets
// both -- a deliberate arrangement, and no chance of an eleventh kind going
// missing from it.
const PICKER_ORDER: BlockKind[] = [
  'paragraph',
  'heading',
  'bulletList',
  'numberList',
  'ingredients',
  'steps',
  'image',
  'gallery',
  'quote',
  'citation',
];

export default function BlockPicker({ onPick }: { onPick: (kind: BlockKind) => void }) {
  // Completeness at runtime as well as in the test: a kind in BLOCK_KINDS
  // that PICKER_ORDER forgot is appended rather than lost. The test is what
  // fails; this is what keeps her able to insert it in the meantime.
  const order = [...PICKER_ORDER, ...BLOCK_KINDS.filter((kind) => !PICKER_ORDER.includes(kind))];

  return (
    <div>
      <p className={`mb-3 font-['Montserrat'] text-sm uppercase tracking-wide text-accent`}>Add to this post</p>
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
        {order.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            className="rounded border-2 border-dashed border-brand p-4 text-left transition hover:bg-brand/10"
          >
            <span className={`block font-['Montserrat'] text-sm uppercase tracking-wide text-accent`}>
              {BLOCK_KIND_LABELS[kind]}
            </span>
            <span className={`mt-1 block font-['Open_Sans'] text-sm text-gray-600`}>{BLOCK_KIND_HELP[kind]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
