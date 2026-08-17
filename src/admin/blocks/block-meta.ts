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
