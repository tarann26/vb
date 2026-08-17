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
    ['a document with no heading', { body: JSON.stringify({ paragraphs: ['x'], chef: { name: 'K', role: 'R', portrait: '/team/kamalika-anand.webp', portraitAlt: 'K' } }) }, /no heading/i],
    ['a document with no paragraphs', { body: JSON.stringify({ heading: 'A', chef: {} }) }, /no paragraphs/i],
    ['a document with a blank paragraph', { body: JSON.stringify({ heading: 'A', paragraphs: ['x', '  '], chef: { name: 'K', role: 'R', portrait: '/team/kamalika-anand.webp', portraitAlt: 'K' } }) }, /blank or non-string paragraph/i],
    ['a document with no chef', { body: JSON.stringify({ heading: 'A', paragraphs: ['x'] }) }, /no chef block/i],
    // Each of the four chef.* cases below is missing only ONE field -- not
    // caught by "has no chef block" above, since it IS a chef block, just
    // an incomplete one. Without a guard, an incomplete chef block would
    // pass every OTHER check and get written straight into
    // src/content/story.json: a blank chef.name or chef.role produces a
    // byline with a missing name or job title, and a blank chef.portrait or
    // chef.portraitAlt produces a broken or unlabelled photo -- see the
    // storyFileFromRow comment on chef.portrait for what does and does not
    // stop that row reaching this script in the first place.
    ['a chef block with no name', { body: JSON.stringify({ heading: 'A', paragraphs: ['x'], chef: { role: 'R', portrait: '/team/kamalika-anand.webp', portraitAlt: 'K' } }) }, /chef\.name/i],
    ['a chef block with no role', { body: JSON.stringify({ heading: 'A', paragraphs: ['x'], chef: { name: 'K', portrait: '/team/kamalika-anand.webp', portraitAlt: 'K' } }) }, /chef\.role/i],
    ['a chef block with no portrait', { body: JSON.stringify({ heading: 'A', paragraphs: ['x'], chef: { name: 'K', role: 'R', portraitAlt: 'K' } }) }, /chef\.portrait\b/i],
    ['a chef block with no portraitAlt', { body: JSON.stringify({ heading: 'A', paragraphs: ['x'], chef: { name: 'K', role: 'R', portrait: '/team/kamalika-anand.webp' } }) }, /chef\.portraitAlt/i],
  ])('refuses to write %s', (_name, row, message) => {
    expect(() => storyFileFromRow(row)).toThrow(message);
  });

  it('refuses a missing row rather than writing an empty file', () => {
    expect(() => storyFileFromRow(undefined)).toThrow(/no row/i);
  });
});
