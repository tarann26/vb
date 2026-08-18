// The five typing triggers, and the escape hatch that keeps them from making
// some sentences unwritable.
import { describe, expect, it } from 'vitest';
import { autoformat, revertFormat } from '../autoformat';
import type { Block } from '../../../content/types';

describe('autoformat', () => {
  it.each([
    ['a numbered list', '1.', { kind: 'numberList', items: [''] }],
    ['a numbered list from any number', '7.', { kind: 'numberList', items: [''] }],
    ['a bulleted list from a hyphen', '-', { kind: 'bulletList', items: [''] }],
    ['a bulleted list from a star', '*', { kind: 'bulletList', items: [''] }],
    ['a heading', '#', { kind: 'heading', text: '' }],
    ['a quotation', '>', { kind: 'quote', text: '' }],
  ])('makes %s', (_name, before, expected) => {
    expect(autoformat({ kind: 'paragraph', text: before }, 'text', before, '')).toEqual(expected);
  });

  it('carries the words after the caret into the new block', () => {
    expect(autoformat({ kind: 'paragraph', text: '-rest' }, 'text', '-', 'rest')).toEqual({
      kind: 'bulletList',
      items: ['rest'],
    });
  });

  it.each([
    ['mid-sentence', 'add 1.'],
    ['two hashes', '##'],
    ['a hash with words before it', 'a #'],
    ['a bare number', '1'],
    ['a number with no full stop', '1)'],
    ['a dash with words before it', 'a -'],
  ])('does not fire %s', (_name, before) => {
    expect(autoformat({ kind: 'paragraph', text: before }, 'text', before, '')).toBeNull();
  });

  it('does not fire inside a list item', () => {
    expect(autoformat({ kind: 'bulletList', items: ['-'] }, 'items[0]', '-', '')).toBeNull();
  });

  it('does not fire in a photograph’s caption', () => {
    expect(
      autoformat({ kind: 'image', src: '/x.webp', alt: 'x', caption: '#' }, 'caption', '#', ''),
    ).toBeNull();
  });

  it('fires only in the paragraph’s OWN text, whatever slot it is asked about', () => {
    // The kind guard above happens to cover every slot the surface can send
    // today, because no kind carrying a second slot is a paragraph. This is
    // the guard on its own, asked directly: the rule is "a paragraph's text",
    // not "a paragraph", and it should not quietly start meaning the second
    // thing the day a kind gains a field.
    expect(autoformat({ kind: 'paragraph', text: '-' }, 'caption', '-', '')).toBeNull();
  });

  it('does not fire in a heading, which is already one', () => {
    expect(autoformat({ kind: 'heading', text: '#' }, 'text', '#', '')).toBeNull();
  });

  it('leaves a stale draft’s unrecognisable block alone', () => {
    expect(autoformat({ kind: 'marquee' } as unknown as Block, 'text', '-', '')).toBeNull();
  });
});

describe('revertFormat', () => {
  it('puts back the trigger characters AND the space that fired them', () => {
    // Not the paragraph as it stood before the space: the space is a character
    // she typed and meant, and a revert that swallowed it would make her press
    // it a second time every time.
    expect(revertFormat('1.', '')).toEqual({ kind: 'paragraph', text: '1. ' });
  });

  it('keeps the words that were standing after the caret', () => {
    expect(revertFormat('-', '50 for a coffee')).toEqual({
      kind: 'paragraph',
      text: '- 50 for a coffee',
    });
  });
});
