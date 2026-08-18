import { describe, expect, it } from 'vitest';
import {
  BLOCK_KIND_HELP,
  BLOCK_KIND_LABELS,
  INSERT_MENU_KINDS,
  UNKNOWN_BLOCK_LABEL,
  UNKNOWN_BLOCK_MESSAGE,
} from '../block-meta';
import { BLOCK_KINDS } from '../../../content/guards';
import { validateContent } from '../../../content/validate';

describe('every block kind has words she can read', () => {
  // Derived from BLOCK_KINDS (itself checked exhaustive against the union at
  // compile time by BLOCK_KIND_SET), not from Object.keys of the thing under
  // test -- deriving both sides of an equality from the same constant
  // asserts nothing, which is the reason areas.test.tsx spells its own
  // twelve ids out as a literal.
  it('a label for every kind, and no kind without one', () => {
    expect(Object.keys(BLOCK_KIND_LABELS).sort()).toEqual([...BLOCK_KINDS].sort());
    expect(Object.keys(BLOCK_KIND_HELP).sort()).toEqual([...BLOCK_KINDS].sort());
  });

  // The point of the labels, asserted rather than described: not one of them
  // is the model's own name for the kind. `numberList` on a button is the
  // defect this record exists to prevent, and a record that quietly fell
  // back to the key would satisfy the completeness check above.
  it('no label is the kind’s own identifier', () => {
    BLOCK_KINDS.forEach((kind) => {
      expect(BLOCK_KIND_LABELS[kind]).not.toBe(kind);
    });
  });

  it('every help line is a sentence, not a fragment', () => {
    BLOCK_KINDS.forEach((kind) => {
      expect(BLOCK_KIND_HELP[kind].endsWith('.'), `${kind}: "${BLOCK_KIND_HELP[kind]}"`).toBe(true);
    });
  });

  // The fallback strip for a block whose kind is not one of the ten. If it
  // ever equalled a real label, "Remove Paragraph block 2" would name two
  // different things -- one she can edit and one she can only delete.
  it('the unrecognised-kind label is not one of the ten', () => {
    expect(Object.values(BLOCK_KIND_LABELS)).not.toContain(UNKNOWN_BLOCK_LABEL);
  });

  // It has to tell her what to DO, because it is the only thing on screen for
  // a block that has no fields to show, and it has to give the SAME advice as
  // the message that replaces it once validation has run -- two sentences for
  // one thing, disagreeing on what to do, is the defect InlineTextField exists
  // to avoid one level down. Both halves asserted against validate.ts's own
  // words rather than described.
  it('the unrecognised-kind message tells her to remove it, and agrees with the validator', () => {
    expect(UNKNOWN_BLOCK_MESSAGE).toContain('Remove it');
    expect(UNKNOWN_BLOCK_MESSAGE.toLocaleLowerCase('en')).toContain('add one from the list instead');
    const fromValidator = validateContent('posts.json', [
      { id: 'a', slug: 'a', type: 'story', title: 'T', date: '2026-03-04', excerpt: 'e', image: '/food/x.webp', blocks: [{ kind: 'wonky' }] },
    ]).find((problem) => problem.field === '[0].blocks[0].kind');
    expect(fromValidator?.message).toContain('add one from the list instead');
  });

  // The partition, against BLOCK_KINDS rather than against a second copy of
  // the same four names. The toolbar half is written out as a literal for the
  // reason the label test above gives: deriving both sides of an equality from
  // the constant under test asserts nothing.
  //
  // This is what makes an eleventh block kind show up SOMEWHERE rather than
  // silently nowhere -- a kind no toolbar button reaches and no insert menu
  // offers is one she can never add, and one that opens invisible in a post
  // that already has it.
  it('the insert menu holds exactly the kinds the toolbar does not', () => {
    const TOOLBAR_KINDS = ['paragraph', 'heading', 'bulletList', 'numberList', 'image', 'quote'];
    expect([...INSERT_MENU_KINDS].sort()).toEqual(BLOCK_KINDS.filter((k) => !TOOLBAR_KINDS.includes(k)).sort());
  });
});
