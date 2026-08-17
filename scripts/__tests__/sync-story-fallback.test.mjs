import { describe, it, expect } from 'vitest';
import { storyFileFromRow } from '../sync-story-fallback.mjs';

describe('storyFileFromRow', () => {
  const BODY = JSON.stringify({
    heading: 'About',
    paragraphs: ['One.'],
    chef: { name: 'K', role: 'Chef', portrait: '/team/kamalika-anand.webp', portraitAlt: 'K' },
  });

  it('reformats the stored body as the repository formats its JSON', () => {
    const written = storyFileFromRow({ body: BODY });
    expect(written).toBe(`${JSON.stringify(JSON.parse(BODY), null, 2)}\n`);
    expect(written.endsWith('\n')).toBe(true);
  });

  // The refusal that matters: writing an unparseable or wrong-shaped body
  // into src/content/story.json would break `tsc -b` at import time and
  // block every subsequent deploy, including the one that would fix it.
  //
  // Each case pins the SPECIFIC message its own guard throws, not just
  // "it throws": a JSON array can never carry a `.paragraphs` own property
  // (JSON syntax has no way to attach one), so a bare `toThrow()` on the
  // array case would still pass with the `Array.isArray(parsed)` guard
  // deleted entirely -- the "no paragraphs" guard below it would catch the
  // array anyway and the test would never notice which guard fired. Pinning
  // the message is what makes that specific guard removal actually redden
  // this test, verified live before this file was written.
  it.each([
    ['unparseable JSON', { body: '{' }, /unexpected|json/i],
    ['an array', { body: '[]' }, /not a json object/i],
    ['a document with no chef', { body: JSON.stringify({ heading: 'A', paragraphs: ['x'] }) }, /no chef block/i],
    ['a document with no paragraphs', { body: JSON.stringify({ heading: 'A', chef: {} }) }, /no paragraphs/i],
  ])('refuses to write %s', (_name, row, message) => {
    expect(() => storyFileFromRow(row)).toThrow(message);
  });

  it('refuses a missing row rather than writing an empty file', () => {
    expect(() => storyFileFromRow(undefined)).toThrow(/no row/i);
  });
});
