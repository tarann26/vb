// Where one paste ends and the next paragraph begins.
//
// A pure function over a string, so every one of these is a real, complete
// claim -- nothing here needs a clipboard, a selection or a browser. The two
// component-level halves of this task (that the rich flavour is never asked
// for, and that pasted asterisks stay characters) live in
// WritingSurface.test.tsx beside the surface's other component cases, because
// they need JSX; what a real browser's own paste would have done instead is
// deferred to e2e/writing-surface.spec.ts.
import { describe, expect, it } from 'vitest';
import { pasteChunks } from '../paste';

describe('pasteChunks', () => {
  it('splits on a blank line', () => {
    expect(pasteChunks('one\n\ntwo')).toEqual(['one', 'two']);
  });

  // The one that decides whether this function is worth having. A web page
  // copied at a narrow column width arrives as one line break per VISUAL
  // line, and splitting on those gives her a column of orphaned half
  // sentences -- which publishes, and which a reader sees.
  it('joins a soft wrap into one paragraph', () => {
    expect(pasteChunks('one\ntwo')).toEqual(['one two']);
  });

  it('handles the Windows line ending Word produces', () => {
    expect(pasteChunks('one\r\n\r\ntwo')).toEqual(['one', 'two']);
  });

  // Word and Google Docs both indent, so the blank line between two
  // paragraphs is frequently a line with a tab on it rather than an empty
  // one.
  it('treats a line of nothing but whitespace as the paragraph break it is', () => {
    expect(pasteChunks('one\n \t \ntwo')).toEqual(['one', 'two']);
  });

  it('drops whitespace-only chunks rather than making empty paragraphs', () => {
    expect(pasteChunks('one\n\n   \n\ntwo')).toEqual(['one', 'two']);
  });

  it('returns nothing for an empty clipboard', () => {
    expect(pasteChunks('   ')).toEqual([]);
  });

  it('keeps the words of a paragraph exactly as they were, asterisks and all', () => {
    expect(pasteChunks('a **b** c')).toEqual(['a **b** c']);
  });
});
