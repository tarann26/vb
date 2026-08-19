// What each block kind is CALLED on her screen, as opposed to what it is
// named in the content model. Total records over BlockKind, the same posture
// CONTENT_FILE_LABELS takes over ContentFileName: an eleventh kind added to
// BlockContentMap (src/content/types.ts) without an entry here fails
// `tsc -b`, rather than reaching her screen labelled `numberList`.
//
// Her words, not the model's. "numberList" and "bulletList" are programmer
// names for two things she thinks of as a numbered list and a bulleted list;
// "citation" is a word a chef has no reason to know.
//
// A WARNING FOR ANYONE WRITING A TEST AGAINST THESE STRINGS, carried from
// Task 6's review and applied here because it had been proposed twice and
// written down nowhere: `getByText(BLOCK_KIND_LABELS.x)` against a mounted
// BlockList ALWAYS matches twice -- once on the picker button that adds that
// kind, once on the strip over a block of that kind. It is structural, not a
// fixture accident, and it has already broken two tests. Scope the query to
// the block's own `<li>` (or to the picker) instead of asking the whole
// screen.
import type { FieldSpec } from '../fields';
import type { BlockKind } from '../../content/types';

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  bulletList: 'Bulleted list',
  numberList: 'Numbered list',
  image: 'Photo',
  gallery: 'Photo grid',
  quote: 'Quote',
  ingredients: 'Ingredients',
  steps: 'Method',
  citation: 'Where it was published',
};

// One line under each picker button, in her words, saying what the block is
// FOR rather than what it looks like. The picker offers ten choices at once
// and a bare list of ten nouns is the point at which a non-technical owner
// stops and asks somebody -- which is the thing this whole sub-plan is
// measured against.
export const BLOCK_KIND_HELP: Record<BlockKind, string> = {
  paragraph: 'Ordinary writing.',
  heading: 'A line that introduces the part that follows it.',
  bulletList: 'A list where the order does not matter.',
  numberList: 'A list where the order does matter.',
  image: 'One photo, as wide as the post, with words underneath it if you want them.',
  gallery: 'Several photos side by side.',
  quote: 'Somebody’s words, set apart, with their name if you have it.',
  ingredients: 'What somebody needs before they start cooking.',
  steps: 'What to do, in order.',
  citation: 'The publication, the date, and a link to the original.',
};

// The kinds the writing surface's own insert menu offers, and the reason it is
// a list here rather than a filter written at the call site: it is the exact
// complement of what WritingToolbar's buttons can reach, and the two halves
// have to stay a partition of BLOCK_KINDS. block-meta.test.ts asserts that
// against BLOCK_KINDS itself, so an eleventh kind added to BlockContentMap
// (src/content/types.ts) fails there rather than becoming a kind she can
// neither type nor insert -- reachable from nowhere, and invisible in a post
// that already has one.
//
// Order is hers rather than the model's, the same call PICKER_ORDER makes: the
// recipe pair sits together, and the two she reaches for least are the ends.
export const INSERT_MENU_KINDS: readonly BlockKind[] = ['gallery', 'ingredients', 'steps', 'citation'];

// What the strip over a block says when its kind is not one of the ten. Not
// decoration and not a placeholder for a state that cannot happen: a draft
// saved by an older build of this dashboard restores through registerLoaded's
// unchecked cast (sections/register-loaded.ts), so `kind` at runtime is
// whatever localStorage holds, while the type promises a BlockKind. The
// dashboard's own write boundary refuses such a block (validateBlock's
// isBlockKind branch), which is the proof that the shape is one the model
// expects to meet rather than one it rules out.
//
// BlockList is what reads this, and what refuses to hand such a block to
// BlockFields at all -- see its own comment. Kept here rather than there so
// every owner-facing name for a block sits in one file.
export const UNKNOWN_BLOCK_LABEL = 'Unknown';

// The one sentence she can act on when a block turns out to be something this
// site cannot show, for the window before validation has run -- it is
// debounced, so that window is real. Once validateBlock's own message arrives
// it names the kind she actually has, so BlockList shows this one only while
// that message is absent and she never reads two at once.
//
// The advice is the validator's advice, word for word from
// validate.ts's isBlockKind branch ("remove it and add one from the list
// instead"). An earlier version said "add a paragraph or a photo in its place",
// which is concrete but disagrees with the sentence that replaces it a moment
// later -- two names for one thing, the defect InlineTextField exists to avoid.
export const UNKNOWN_BLOCK_MESSAGE =
  'This is not something this site can show. Remove it, and add one from the list instead.';

// The photo description field, declared once and read by BOTH surfaces that
// render a photo block: BlockFields' image branch and the writing column's
// figure. Moved here from BlockFields.tsx when the writing surface grew its
// own picture (admin redesign Task 23) rather than retyped there -- two
// independently-worded versions of the one instruction is exactly the "two
// names for one thing" defect the messages above exist to avoid, and this one
// is the sentence a reader who cannot see the photograph hears instead of it.
//
// It lives in this module and not beside its component because BlockFields.tsx
// and WritingSurface.tsx both default-export a component, and
// `react-refresh/only-export-components` warns on a value exported from such a
// file that is not a plain constant -- the same trap Task 20 hit lifting
// TARGET_SHAPES out of InlineTextField.tsx. Nothing in here is a component.
//
// The help text INSTRUCTS before it explains, which is the whole difference
// between a field she fills in and a field she skips: the first version said
// only what the description is used for, which tells her why the box is there
// and nothing about what to type in it.
export const ALT_SPEC = {
  label: 'Photo description',
  kind: 'text',
  help: 'Say what is in the photo, in a few words. Anyone who cannot see it hears this instead.',
} satisfies FieldSpec<string>;

// "Photo", "Photo 2", "Photo 3" -- numbered only when there is something to
// distinguish it from, so the overwhelmingly common single-photo post keeps
// the plain word. "Photo 1" on a post with one photo is worse than "Photo",
// because the number implies a second one.
//
// The number counts entries OF THE SAME KIND, not overall position: "Photo 2"
// in a post whose photo entries sit third and ninth in the whole post is
// still the second photo she added, which is how she thinks about it.
//
// Lives here, beside every other owner-facing name for an entry, rather than
// in BlockFields.tsx or WritingSurface.tsx: both of those default-export a
// component, and `react-refresh/only-export-components` warns on a value
// exported from such a file that is not a plain constant -- the same trap
// this module's own header comment already names for ALT_SPEC.
export function numbered(base: string, entryNumber: number | undefined): string {
  return entryNumber === undefined || entryNumber <= 1 ? base : `${base} ${String(entryNumber)}`;
}
