// One block's own fields. The switch is exhaustive over BlockKind, so an
// eleventh kind added to BlockContentMap (src/content/types.ts) fails
// `tsc -b` naming this file -- the same guarantee blocks.tsx has on the
// render side and assertBlock has at the guard.
//
// Everything that is not markdown she types by hand goes through Field.tsx
// with an ad-hoc FieldSpec, and every photo goes through PhotoField, so
// labels, help text, aria-describedby, error regions and the whole
// upload/stage/preview chain are the dashboard's existing ones rather than a
// second set. Only the markdown-bearing fields get InlineTextField, because
// Task 7 attaches a toolbar to those and Field has no slot for one.
import Field from '../Field';
import PhotoField from '../PhotoField';
import InlineTextField from './InlineTextField';
import BlockProblemMessage from './BlockProblemMessage';
import { BLOCK_KIND_LABELS } from './block-meta';
import { swapAt } from './reorder';
import { useStableNames } from './stable-names';
import { MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME, ADD_BUTTON_CLASSNAME } from '../RecordList';
import type React from 'react';
import type { FieldSpec } from '../fields';
import type { ImagePreviews } from '../previews';
import type { StagedPhoto } from '../PhotoField';
import type { Block, GalleryImage } from '../../content/types';
import type { ValidationProblem } from '../../content/validate';

export interface BlockFieldsProps {
  // Always a block whose `kind` is one of the ten. BlockList is what checks
  // that (isBlockKind, against a value that came out of localStorage through
  // an unchecked cast) and refuses to render this component when it is not --
  // so the `never` at the bottom of the switch is genuinely unreachable at
  // runtime rather than only unreachable in the type system.
  block: Block;
  onChange: (next: Block) => void;
  // The DOM id prefix for this block, composed on the way down the same way
  // every preview key in this dashboard is: file, then record, then block.
  // Two posts' block 0 must not produce the same input id, or a `<label for>`
  // click lands in the wrong post entirely -- the exact defect RecordForm's
  // own `scope` prop exists for.
  idPrefix: string;
  // Keyed by the field name inside this block: 'text', 'items[1]',
  // 'images[0].src'. BlockList does the narrowing.
  problemsFor: (key: string) => ValidationProblem[];
  previews: ImagePreviews;
  onStaged: (key: string, staged: StagedPhoto | null) => void;
  previewKeyPrefix: string;
}

// Ad-hoc specs, declared once at module scope rather than rebuilt per render.
// `satisfies` rather than a type annotation so the literal keeps its narrow
// `kind`, which is what lets Field<string>'s generic resolve.
// The help text INSTRUCTS before it explains, which is the whole difference
// between a field she fills in and a field she skips: the first version said
// only what the description is used for, which tells her why the box is there
// and nothing about what to type in it.
const ALT_SPEC = {
  label: 'Photo description',
  kind: 'text',
  help: 'Say what is in the photo, in a few words. Anyone who cannot see it hears this instead.',
} satisfies FieldSpec<string>;

// One per kind, and neither of them is "Heading" -- which is what the heading
// BLOCK's own field is called. A post with a Heading block and an Ingredients
// block would otherwise put two controls named "Heading" on one screen, the
// same ambiguity the positional block labels exist to remove, and a screen
// reader reading the label alone cannot tell those two apart. A single shared
// "Heading for this list" fixed that pair and left the next one: ingredients
// and steps are two different lists and would have shared it in turn (found by
// this task's own duplicate-label scan, not by reading).
//
// The noun comes from BLOCK_KIND_LABELS rather than being typed again here, so
// a kind renamed on its strip is renamed inside its fields in the same edit.
const LIST_HEADING_SPECS = {
  ingredients: {
    label: `Heading for the ${BLOCK_KIND_LABELS.ingredients.toLocaleLowerCase('en')}`,
    kind: 'text',
  },
  steps: { label: `Heading for the ${BLOCK_KIND_LABELS.steps.toLocaleLowerCase('en')}`, kind: 'text' },
} satisfies Record<'ingredients' | 'steps', FieldSpec<string>>;

const PUBLICATION_SPEC = { label: 'Publication', kind: 'text' } satisfies FieldSpec<string>;

const CITATION_DATE_SPEC = { label: 'Published on', kind: 'date' } satisfies FieldSpec<string>;

// `kind: 'text'`, not 'textarea', and that is the type system's choice rather
// than a design one: Kind<string | null> is `'text' | 'image' | 'readonly'`
// (fields.ts), so a web address that may be cleared to null has exactly one
// text-like control available to it. A single-line box is the right shape for
// a link anyway.
//
// `optional: true` is what RecordForm reads to decide that clearing a box
// deletes the key rather than blanking it. Field is rendered directly here,
// with no RecordForm above it, so nothing reads this flag -- the mapping is
// done explicitly in the citation branch's own onChange. It is on the spec
// because the spec describes the field honestly, and Task 6's picker or a
// later task may well route this through RecordForm.
const CITATION_URL_SPEC = {
  label: 'Link',
  kind: 'text',
  help: 'The full web address of the original, or leave empty if it is not online.',
  optional: true,
} satisfies FieldSpec<string | null>;

const ROW_BUTTONS_CLASSNAME = 'mb-3 flex flex-wrap items-center gap-2';

// "Add an ingredient", never "Add a ingredient". RecordList's own Add button
// is `Add a ${noun}` unconditionally and so already ships "Add a award" and
// "Add a article" (AwardsArea.test.tsx pins both, with a comment saying they
// are wrong and out of scope there) -- two of this task's four nouns start
// with a vowel, and writing a fresh grammatical error onto her screen to
// match an old one is the wrong way round. Fixing RecordList's own is a
// change to five committed labels and two snapshots, so it stays its own
// task.
//
// Spelling, not sound, and that is a real limit rather than an oversight: the
// four nouns this has today (Item, Ingredient, Step, photo) are all decided
// correctly by the first letter, but a noun beginning with a soft "u" ("Unit")
// or a silent "h" would come out as "Add an unit". Whoever adds an eleventh
// list noun in a later task should read this line rather than extend it.
function addLabel(noun: string): string {
  const lower = noun.toLocaleLowerCase('en');
  return `Add ${/^[aeiou]/.test(lower) ? 'an' : 'a'} ${lower}`;
}

export default function BlockFields({
  block,
  onChange,
  idPrefix,
  problemsFor,
  previews,
  onStaged,
  previewKeyPrefix,
}: BlockFieldsProps) {
  // The same fix BlockList applies to blocks, one level down, for the photos
  // inside a gallery block -- and the trigger here is REMOVE rather than a
  // reorder. `Remove photo 2` is a `filter`, so every later photo's position
  // drops by one, and the comment on that button (below) recommends
  // remove-and-re-add as the way to reorder a grid at all. While a staged
  // photo's key was its position, that meant: she picks a photo for photo 2,
  // removes photo 1, picks a photo for the tile now sitting where photo 2's
  // key points, and PhotoField's supersede deletes photo 2's bytes on the way
  // in. The post publishes naming a photo no file was sent for -- broken image
  // live, then an asset-existence failure refusing every later publish.
  //
  // Reproduced end to end before it was fixed; see BlockList.test.tsx's own
  // gallery case, which asserts what the collector holds rather than any key.
  //
  // Declared unconditionally, above the switch, because a hook cannot live
  // inside the one branch that needs it.
  const photoNames = useStableNames('g');
  // A list of markdown-bearing strings, with add/remove/move -- the shape
  // bulletList, numberList, ingredients and steps all share. StoryForm.tsx's
  // paragraph list is the same idea and the same button bindings; this is not
  // routed through that component because its problems key off
  // `paragraphs[i]` and these off `items[i]`.
  //
  // `commit` is passed in rather than built here from `block`, so each branch
  // hands over its own already-narrowed block and no `as Block` cast is
  // needed to put the new list back on it.
  function itemList(items: string[], noun: string, commit: (next: string[]) => void): React.ReactNode {
    // A draft saved by an older build restores through an unchecked cast, so
    // the type's promise of an array is not a runtime fact -- and the only
    // error boundary between here and the page is per-SECTION, so an
    // unguarded `.map` would take the Posts panel's heading down with it.
    const safe = Array.isArray(items) ? items : [];
    return (
      <>
        {safe.map((item, i) => (
          <div key={i}>
            <InlineTextField
              id={`${idPrefix}-items-${i}`}
              label={`${noun} ${i + 1}`}
              value={item ?? ''}
              onChange={(next) => commit(safe.map((existing, j) => (j === i ? next : existing)))}
              problems={problemsFor(`items[${i}]`)}
            />
            <div className={ROW_BUTTONS_CLASSNAME}>
              {/* Omitted at the ends, not disabled -- RecordList's own rule,
                  and its reasoning applies unchanged: a control that reads as
                  live and does nothing is worse than no control. */}
              {i > 0 && (
                <button
                  type="button"
                  aria-label={`Move ${noun} ${i + 1} up`}
                  onClick={() => commit(swapAt(safe, i, i - 1))}
                  className={MOVE_BUTTON_CLASSNAME}
                >
                  Up
                </button>
              )}
              {i < safe.length - 1 && (
                <button
                  type="button"
                  aria-label={`Move ${noun} ${i + 1} down`}
                  onClick={() => commit(swapAt(safe, i, i + 1))}
                  className={MOVE_BUTTON_CLASSNAME}
                >
                  Down
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${noun} ${i + 1}`}
                onClick={() => commit(safe.filter((_, j) => j !== i))}
                className={REMOVE_BUTTON_CLASSNAME}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {/* The bare `items` message -- validateInlineList's "needs at least
            one X", only reachable when the list IS empty, which is exactly
            when no per-item field exists to carry it. Same reasoning as
            RecordList's unclaimedProblems: the one message the validator
            produces for an empty list must not be the one message this
            component drops. */}
        {problemsFor('items').map((problem, i) => (
          <BlockProblemMessage key={i}>{problem.message}</BlockProblemMessage>
        ))}
        <button type="button" onClick={() => commit([...safe, ''])} className={ADD_BUTTON_CLASSNAME}>
          {addLabel(noun)}
        </button>
      </>
    );
  }

  switch (block.kind) {
    case 'paragraph':
      return (
        <InlineTextField
          id={`${idPrefix}-text`}
          label="Words"
          value={block.text ?? ''}
          onChange={(next) => onChange({ ...block, text: next })}
          problems={problemsFor('text')}
        />
      );
    case 'heading':
      return (
        <InlineTextField
          id={`${idPrefix}-text`}
          label="Heading"
          value={block.text ?? ''}
          onChange={(next) => onChange({ ...block, text: next })}
          problems={problemsFor('text')}
        />
      );
    case 'bulletList':
      return itemList(block.items, 'Item', (next) => onChange({ ...block, items: next }));
    case 'numberList':
      return itemList(block.items, 'Item', (next) => onChange({ ...block, items: next }));
    case 'image':
      return (
        <>
          <PhotoField
            id={`${idPrefix}-src`}
            label="Photo"
            category="posts"
            value={block.src ?? null}
            onChange={(contentPath) => onChange({ ...block, src: contentPath ?? '' })}
            onStaged={(staged) => onStaged('src', staged)}
            previews={previews}
            previewKey={`${previewKeyPrefix}:src`}
            problems={problemsFor('src')}
          />
          <Field<string>
            id={`${idPrefix}-alt`}
            spec={ALT_SPEC}
            value={block.alt ?? ''}
            onChange={(next) => onChange({ ...block, alt: next })}
            problems={problemsFor('alt')}
          />
          {/* `?? ''` on a genuinely optional field, and the reason is a
              landmine this project has already defused once: caption is
              optional in BlockContentMap and a committed block may not carry
              the key at all, so reading block.caption straight would hand
              undefined to a controlled textarea and React would switch it to
              uncontrolled mid-edit. */}
          <InlineTextField
            id={`${idPrefix}-caption`}
            label="Words underneath (optional)"
            value={block.caption ?? ''}
            onChange={(next) => onChange({ ...block, caption: next })}
            problems={problemsFor('caption')}
          />
        </>
      );
    case 'gallery':
      return galleryFields(block.images, (next) => onChange({ ...block, images: next }));
    case 'quote':
      return (
        <>
          <InlineTextField
            id={`${idPrefix}-text`}
            label="The words being quoted"
            value={block.text ?? ''}
            onChange={(next) => onChange({ ...block, text: next })}
            problems={problemsFor('text')}
          />
          <InlineTextField
            id={`${idPrefix}-attribution`}
            label="Who said it (optional)"
            value={block.attribution ?? ''}
            onChange={(next) => onChange({ ...block, attribution: next })}
            problems={problemsFor('attribution')}
          />
        </>
      );
    case 'ingredients':
      return (
        <>
          <Field<string>
            id={`${idPrefix}-heading`}
            spec={LIST_HEADING_SPECS.ingredients}
            value={block.heading ?? ''}
            onChange={(next) => onChange({ ...block, heading: next })}
            problems={problemsFor('heading')}
          />
          {itemList(block.items, 'Ingredient', (next) => onChange({ ...block, items: next }))}
        </>
      );
    case 'steps':
      return (
        <>
          <Field<string>
            id={`${idPrefix}-heading`}
            spec={LIST_HEADING_SPECS.steps}
            value={block.heading ?? ''}
            onChange={(next) => onChange({ ...block, heading: next })}
            problems={problemsFor('heading')}
          />
          {itemList(block.items, 'Step', (next) => onChange({ ...block, items: next }))}
        </>
      );
    case 'citation':
      return (
        <>
          <Field<string>
            id={`${idPrefix}-publication`}
            spec={PUBLICATION_SPEC}
            value={block.publication ?? ''}
            onChange={(next) => onChange({ ...block, publication: next })}
            problems={problemsFor('publication')}
          />
          {/* `null`, never `''`, when she clears it: null is the real "there
              is no online copy" value, matching Article['url'] and the
              committed press.json entries that carry it, and validateBlock
              refuses anything else that is not a usable link. An empty string
              would be refused at publish with a message about web addresses,
              which is not what she meant. */}
          <Field<string | null>
            id={`${idPrefix}-url`}
            spec={CITATION_URL_SPEC}
            value={block.url}
            onChange={(next) => onChange({ ...block, url: next === null || next.trim() === '' ? null : next })}
            problems={problemsFor('url')}
          />
          <Field<string>
            id={`${idPrefix}-date`}
            spec={CITATION_DATE_SPEC}
            value={block.date ?? ''}
            onChange={(next) => onChange({ ...block, date: next })}
            problems={problemsFor('date')}
          />
        </>
      );
    default: {
      // Unreachable while BlockContentMap and this switch agree, and
      // unreachable at runtime besides: BlockList checks `kind` against
      // isBlockKind before rendering this component at all. An eleventh kind
      // with no branch fails to compile on the next line.
      //
      // Returns nothing rather than the value itself, which is where this
      // parts company with blocks.tsx's identical-looking default:
      // `return _exhaustive` renders an object, and React throws "Objects are
      // not valid as a React child" on one -- which on THIS side of the site
      // means the Posts panel and its heading, not one block.
      const _exhaustive: never = block;
      void _exhaustive;
      return null;
    }
  }

  function galleryFields(images: GalleryImage[], commit: (next: GalleryImage[]) => void): React.ReactNode {
    const safe = Array.isArray(images) ? images : [];
    // Every edit to one photo replaces that photo's object, so each commit
    // below carries its name across first -- exactly as BlockList does for a
    // block, and for the same reason: without it, typing a description would
    // move the photo she has already staged to a name nothing refers to.
    const replaceAt = (i: number, next: GalleryImage): GalleryImage[] => {
      photoNames.rename(safe[i], next, i);
      return safe.map((existing, j) => (j === i ? next : existing));
    };
    return (
      <>
        {safe.map((image, i) => {
          // The photo's own name, not its position -- see this component's own
          // comment at the top. The DOM ids and the problem keys below stay
          // positional on purpose: ids only have to agree with themselves
          // within one render, and a problem key is what the validator emits
          // walking the array, so it is a position by definition.
          const name = photoNames.nameOf(image, i);
          return (
          <div key={name}>
            <PhotoField
              id={`${idPrefix}-images-${i}-src`}
              label={`Photo ${i + 1}`}
              category="posts"
              value={image?.src ?? null}
              onChange={(contentPath) => commit(replaceAt(i, { ...image, src: contentPath ?? '' }))}
              onStaged={(staged) => onStaged(`images[${name}].src`, staged)}
              previews={previews}
              previewKey={`${previewKeyPrefix}:images[${name}].src`}
              problems={problemsFor(`images[${i}].src`)}
            />
            <Field<string>
              id={`${idPrefix}-images-${i}-alt`}
              spec={ALT_SPEC}
              value={image?.alt ?? ''}
              onChange={(next) => commit(replaceAt(i, { ...image, alt: next }))}
              problems={problemsFor(`images[${i}].alt`)}
            />
            <div className={ROW_BUTTONS_CLASSNAME}>
              {/* No Up/Down here, and it is not an omission: a photo grid is
                  laid out by the renderer, and Task 8's drag handle is what
                  reorders blocks. Reordering photos WITHIN a grid is a
                  separate control this task does not add -- she removes and
                  re-adds, which for a two-or-three-photo grid is the shorter
                  path anyway. */}
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => commit(safe.filter((_, j) => j !== i))}
                className={REMOVE_BUTTON_CLASSNAME}
              >
                Remove
              </button>
            </div>
          </div>
          );
        })}
        {problemsFor('images').map((problem, i) => (
          <BlockProblemMessage key={i}>{problem.message}</BlockProblemMessage>
        ))}
        <button type="button" onClick={() => commit([...safe, { src: '', alt: '' }])} className={ADD_BUTTON_CLASSNAME}>
          Add a photo
        </button>
      </>
    );
  }
}
