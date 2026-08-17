import { describe, expect, it } from 'vitest';
import { blockProblemOf, isBlockProblem } from '../block-problems';

// Every field shape validatePosts can emit for a post, taken from
// src/content/validate.ts's own validatePost/validateBlock rather than
// invented here. The partition below has to be exhaustive in BOTH
// directions: a shape that matches neither predicate is a message the owner
// never sees, and RecordList's own comment calls a total silent loss worse
// than a message in the wrong place.
//
// `[0].publishAt` is not a field of Post and is in the list deliberately:
// validateKnownKeys (validate.ts) emits `[i].<key>` for any key a post
// carries that POST_KEYS does not, which is exactly the shape a stale draft
// restored from an older schema produces. It belongs to the post form's own
// banner, not to the blocks.
const POST_FIELD_SHAPES = [
  '',
  '[0].id',
  '[0].slug',
  '[0].type',
  '[0].title',
  '[0].date',
  '[0].excerpt',
  '[0].image',
  '[0].publishAt',
];

const BLOCK_FIELD_SHAPES = [
  '[0].blocks',
  '[0].blocks[0].kind',
  '[0].blocks[0].text',
  '[0].blocks[2].items',
  '[0].blocks[2].items[1]',
  '[0].blocks[3].src',
  '[0].blocks[3].alt',
  '[0].blocks[3].caption',
  '[0].blocks[4].images[0].src',
  '[0].blocks[5].attribution',
  '[0].blocks[6].heading',
  '[0].blocks[7].publication',
  '[0].blocks[7].url',
  '[0].blocks[7].date',
  '[0].blocks[8].align',
];

describe('isBlockProblem partitions a posts.json problem list', () => {
  it.each(BLOCK_FIELD_SHAPES)('claims %s', (field) => {
    expect(isBlockProblem(field)).toBe(true);
  });

  it.each(POST_FIELD_SHAPES)('leaves %s to the post form', (field) => {
    expect(isBlockProblem(field)).toBe(false);
  });

  // The direction that is easy to forget: a field naming a DIFFERENT post's
  // blocks still belongs to the block half, so RecordForm never sees it and
  // never banners it. RecordForm's own belongsToAnotherIndex would have
  // dropped it, which is right for a rendered sibling and wrong for one the
  // list is not rendering at all.
  it('claims another post index too', () => {
    expect(isBlockProblem('[7].blocks[1].text')).toBe(true);
  });

  it('does not claim a field that merely starts with the same letters', () => {
    expect(isBlockProblem('[0].blocksy')).toBe(false);
    expect(isBlockProblem('[0].blocks.text')).toBe(false);
  });
});

describe('blockProblemOf', () => {
  it.each([
    ['[0].blocks', { post: 0, block: undefined, key: undefined }],
    ['[0].blocks[2].text', { post: 0, block: 2, key: 'text' }],
    ['[3].blocks[10].items[1]', { post: 3, block: 10, key: 'items[1]' }],
    ['[0].blocks[4].images[0].src', { post: 0, block: 4, key: 'images[0].src' }],
    ['[0].blocks[0]', { post: 0, block: 0, key: undefined }],
  ])('reads %s', (field, expected) => {
    expect(blockProblemOf(field)).toEqual(expected);
  });

  it('returns undefined for a field it does not own', () => {
    expect(blockProblemOf('[0].title')).toBeUndefined();
    expect(blockProblemOf('')).toBeUndefined();
  });
});
