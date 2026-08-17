// Where a posts.json validation problem belongs on screen.
//
// src/admin/problems.ts cannot answer this, and the reason is structural
// rather than an oversight: problemsFor(problems, 0, 'blocks') matches
// `[0].blocks` EXACTLY -- a suffix match was deliberately rejected there,
// because `field.endsWith('.' + key)` would also match `[1].name` while
// rendering index 0 -- so `[0].blocks[2].text` matches no rendered key of the
// post form. RecordForm then puts every unmatched SAME-INDEX problem into its
// own form-level banner, so without this partition every block message would
// appear on the post rather than on the block, and if BlockList also placed
// it she would see each one twice.
//
// A second, independently-written regex rather than a shared one, which is
// exactly the call StoryForm.tsx made for PARAGRAPH_ITEM and for the same
// reason it wrote out there: unifying it with problems.ts's ARRAY_ITEM would
// either miss this shape (`[i].key[j].sub`, three levels) or wrongly widen
// that one.
const BLOCK_PROBLEM = /^\[(\d+)\]\.blocks(?:\[(\d+)\](?:\.(.+))?)?$/;

export interface BlockProblemTarget {
  // Which post in the list.
  post: number;
  // Which block within it, or undefined for a problem about the block LIST
  // itself -- validatePost's "has nothing in it yet" names `[i].blocks` with
  // no index, and that message has to reach her or deleting her last block
  // leaves an Add button with no explanation. RecordList's unclaimedProblems
  // exists for precisely this shape one level up.
  block: number | undefined;
  // The field within the block, or undefined for a problem about the block as
  // a whole. Carries any nesting after it verbatim (`items[1]`,
  // `images[0].src`) so BlockList can place a list item's own message on that
  // item rather than on the list.
  key: string | undefined;
}

export function blockProblemOf(field: string): BlockProblemTarget | undefined {
  const found = field.match(BLOCK_PROBLEM);
  if (found === null) return undefined;
  return {
    post: Number(found[1]),
    block: found[2] === undefined ? undefined : Number(found[2]),
    key: found[3],
  };
}

export function isBlockProblem(field: string): boolean {
  return BLOCK_PROBLEM.test(field);
}
