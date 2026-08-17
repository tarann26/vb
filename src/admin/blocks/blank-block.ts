// A blank starting point for every block kind, and the reason it is a total
// Record rather than a switch: an eleventh kind added to BlockContentMap
// (src/content/types.ts) fails `tsc -b` at this declaration, instead of
// reaching the picker as an Add button that produces a record no renderer
// and no validator recognises. The same posture CONTENT_FILE_LABELS and
// BLOCK_KEYS both take.
//
// Every field a renderer reads is PRESENT and empty, so the freshly-added
// block renders and immediately shows her, through the same debounced
// validation as everything else, exactly what it still needs.
// blank-block.test.ts asserts the exact problem list per kind, because "she
// could not get stuck" is a claim about what appears on screen.
//
// Two kinds -- image and gallery -- produce a shape assertBlock REFUSES,
// because a blank `src` is not a path on this site. That is the two guards
// working in the right order, not a defect: validatePosts refuses the same
// block at the write boundary, so it can never reach a committed posts.json
// for the import-time guard to meet. Do not "fix" it with a placeholder
// path; there would be no file behind it and assets.test.ts would fail the
// build.
//
// Optional fields are OMITTED, never blanked. `caption: ''` and
// `attribution: ''` would round-trip a key she never filled in, and this
// project has twice made the mistake of treating present-but-empty as
// equivalent to absent.
import { todayInKolkata } from '../../shared/date';
import type { Block, BlockKind } from '../../content/types';

export const BLANK_BLOCK: Record<BlockKind, () => Block> = {
  paragraph: () => ({ kind: 'paragraph', text: '' }),
  heading: () => ({ kind: 'heading', text: '' }),
  // One empty item rather than none: an empty list would show her the
  // list-level "needs at least one item" message and no box to type in, so
  // the only control on screen would be Add -- one more click before she can
  // start. One box, already there, is the difference.
  bulletList: () => ({ kind: 'bulletList', items: [''] }),
  numberList: () => ({ kind: 'numberList', items: [''] }),
  image: () => ({ kind: 'image', src: '', alt: '' }),
  gallery: () => ({ kind: 'gallery', images: [{ src: '', alt: '' }] }),
  quote: () => ({ kind: 'quote', text: '' }),
  // The two headings ARE pre-filled, unlike every other field here, and for
  // the same reason the date is: these are the only fields whose right answer
  // is the same for essentially every recipe anybody writes. She can change
  // either, and a blank one would be refused at publish with a message she
  // would have to read to learn what the field is for.
  ingredients: () => ({ kind: 'ingredients', heading: 'Ingredients', items: [''] }),
  steps: () => ({ kind: 'steps', heading: 'Method', items: [''] }),
  // The date is pre-filled for the reason blankPost's own is
  // (areas/PostsArea.tsx): a date input with nothing in it is the one field
  // whose empty state gives her no hint about the format it wants, and today
  // is very nearly always right for something she is writing now.
  //
  // todayInKolkata (src/shared/date.ts), never `new Date().toISOString()`.
  // That is the third caller of that helper and the second one on this
  // screen, and the reason is the review finding blankPost already carries:
  // the UTC form pre-fills YESTERDAY between midnight and 05:30 IST, which
  // is exactly when a chef writes up the evening service, and nothing on
  // screen would say so because the validator accepts any well-formed date.
  citation: () => ({ kind: 'citation', publication: '', url: null, date: todayInKolkata() }),
};

export function blankBlock(kind: BlockKind): Block {
  return BLANK_BLOCK[kind]();
}
