import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLANK_BLOCK, blankBlock } from '../blank-block';
import { assertPosts, BLOCK_KEYS, BLOCK_KINDS, unknownKeys } from '../../../content/guards';
import { validateContent } from '../../../content/validate';

// A post that is otherwise valid, so the only problems below belong to the
// block under test. Differs from src/content/posts.json in every field.
const VALID_POST = {
  id: 'fixture-1',
  slug: 'a-fixture-post',
  type: 'recipe',
  title: 'A fixture post',
  date: '2026-03-04',
  excerpt: 'A fixture excerpt.',
  image: '/food/tielle.webp',
};

function blockProblems(kind: (typeof BLOCK_KINDS)[number]): string[] {
  return validateContent('posts.json', [{ ...VALID_POST, blocks: [blankBlock(kind)] }])
    .map((problem) => problem.field)
    .filter((field) => field.startsWith('[0].blocks'))
    .sort();
}

describe('blankBlock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('has a factory for every kind, and no factory for a kind that does not exist', () => {
    expect(Object.keys(BLANK_BLOCK).sort()).toEqual([...BLOCK_KINDS].sort());
  });

  it('every blank block carries its own discriminant and no key its kind does not declare', () => {
    BLOCK_KINDS.forEach((kind) => {
      const block = blankBlock(kind);
      expect(block.kind).toBe(kind);
      expect(unknownKeys(block as unknown as object, BLOCK_KEYS[kind])).toEqual([]);
    });
  });

  // Two fresh calls, not one shared object: a factory that returned a shared
  // literal would let two blocks of the same kind alias one array, so typing
  // into one list would type into the other. `toEqual` then `not.toBe` is
  // what distinguishes them.
  it('returns a fresh object every time, with fresh arrays inside it', () => {
    const a = blankBlock('bulletList');
    const b = blankBlock('bulletList');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.kind === 'bulletList' && b.kind === 'bulletList' && a.items).not.toBe(
      b.kind === 'bulletList' ? b.items : null,
    );
  });

  // The property the whole factory exists for, stated as an EXACT field list
  // per kind rather than "at least one problem". `expect(x.length > 0)` is a
  // named tell in this project: Array.slice's negative-index wraparound once
  // satisfied exactly that shape on broken behaviour, and 14 under-asserting
  // tests have been found here.
  //
  // Read down the right-hand column: every entry is a field she can SEE on
  // the block she just added. A blank block whose only problem named a field
  // with no control -- or no problem at all -- is the "she could get stuck"
  // failure this sub-plan is measured against.
  it.each([
    ['paragraph', ['[0].blocks[0].text']],
    ['heading', ['[0].blocks[0].text']],
    ['bulletList', ['[0].blocks[0].items[0]']],
    ['numberList', ['[0].blocks[0].items[0]']],
    ['image', ['[0].blocks[0].alt', '[0].blocks[0].src']],
    ['gallery', ['[0].blocks[0].images[0].src']],
    ['quote', ['[0].blocks[0].text']],
    ['ingredients', ['[0].blocks[0].items[0]']],
    ['steps', ['[0].blocks[0].items[0]']],
    ['citation', ['[0].blocks[0].publication']],
  ] as const)('a blank %s tells her exactly what it needs', (kind, expected) => {
    expect(blockProblems(kind)).toEqual([...expected].sort());
  });

  // The two kinds whose blank shape assertBlock REFUSES, asserted rather than
  // discovered. That is correct and is the two guards working in order:
  // validatePosts refuses the same block at the write boundary (see the row
  // above), so a blank photo can never reach a committed file for the
  // import-time guard to meet. Pinned here so nobody "fixes" the factory by
  // inventing a placeholder path -- which would be a path with no file behind
  // it, and src/content/__tests__/assets.test.ts would then fail the build.
  it.each(['image', 'gallery'] as const)('a blank %s is refused at the import boundary too', (kind) => {
    expect(() => assertPosts([{ ...VALID_POST, blocks: [blankBlock(kind)] }])).toThrow(/photo on this site/);
  });

  // The optional fields are ABSENT, not empty strings. `caption: ''` and
  // `attribution: ''` would round-trip a key she never filled in, which is
  // the "present-but-empty is not absent" mistake this repository has made
  // twice -- and blocks.tsx's renderer branches on emptiness either way, so
  // the only difference is what a committed file carries.
  it('omits caption and attribution entirely rather than blanking them', () => {
    expect('caption' in blankBlock('image')).toBe(false);
    expect('attribution' in blankBlock('quote')).toBe(false);
  });

  // `null`, and it has to be null: validateBlock accepts `url: null` as the
  // real "there is no online copy" value and refuses anything else that is
  // not a usable link, so `''` would be refused with a message about web
  // addresses on a citation she has only just created.
  it('a blank citation has a null link, not an empty one', () => {
    const block = blankBlock('citation');
    expect(block.kind === 'citation' && block.url).toBeNull();
  });

  // A date she does not have to guess the format of, matching blankPost's own
  // reasoning (PostsArea.tsx) -- and dated by the RESTAURANT's clock, which is
  // the only part of this a test can distinguish. The frozen instant sits
  // inside the window where UTC and IST disagree (20:30 UTC on the 4th is
  // 02:00 IST on the 5th), so `new Date().toISOString().slice(0, 10)` -- the
  // form the review already caught in blankPost -- reports the 4th here and
  // this reddens. A format regex could not: POST_DATE_PATTERN is that same
  // regex, so it accepts yesterday's date just as happily. That the shape is
  // one the validator wants is asserted above instead, by the citation row's
  // exact problem list containing no `.date` entry at all.
  //
  // `toFake: ['Date']` rather than the whole timer set, the same call
  // PostsArea.test.tsx makes for the same reason: freezing setTimeout too
  // would break every debounce and delay a later case in this directory
  // depends on.
  it('a blank citation is dated by the restaurant’s clock, not by UTC', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-04T20:30:00Z'));
    const block = blankBlock('citation');
    expect(block.kind === 'citation' && block.date).toBe('2026-03-05');
  });
});
