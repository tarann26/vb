import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  collectFromJson,
  collectFromCode,
  fetchLiveDocuments,
  objectsFor,
  ASSET_PATH_PATTERN,
  CODE_ASSET_PATTERN,
  CODE_FILES,
} from '../image-inventory.mjs';

const inventory = JSON.parse(readFileSync('docs/image-inventory.json', 'utf8'));

describe('the recorded inventory', () => {
  it('counts the same references it lists', () => {
    expect(inventory.references.length).toBe(
      inventory.counts.content + inventory.counts.code + inventory.counts.d1,
    );
  });

  // story.json's chef portrait, and one image per post. If this is 0 the live
  // read failed and the walk fell back to the committed file -- the exact
  // failure this whole script exists to prevent.
  it('found the four references that live only in D1', () => {
    expect(inventory.references.filter((r) => r.source === 'd1')).toHaveLength(4);
  });

  // TEN, not the plan's nine. See image-inventory.mjs's own header for the
  // reconciliation: SignatureMocktails.tsx also links the food menu PDF, and
  // src/content/__tests__/assets.test.ts has always known about that
  // reference by name.
  it('found the ten that live in code, including the one in a doc comment', () => {
    expect(inventory.references.filter((r) => CODE_FILES.includes(r.file))).toHaveLength(10);
    expect(inventory.references.filter((r) => r.file === 'src/content/types.ts')).toHaveLength(1);
    expect(inventory.references.filter((r) => r.file === 'src/components/SignatureMocktails.tsx')).toHaveLength(6);
  });

  // SEVENTY-ONE, not the plan's sixty-nine. The plan's own reconciliation
  // grep had no `pdf` alternative; ASSET_PATH_PATTERN and the guardrail it is
  // pinned against both do.
  it('found the seventy-one in content, of which one is the share card that stays', () => {
    const content = inventory.references.filter((r) => r.file.startsWith('src/content/') && r.file.endsWith('.json'));
    expect(content).toHaveLength(71);
    expect(content.filter((r) => r.path === '/og-image.jpg')).toHaveLength(1);
  });

  // The three the plan's census missed, named individually so nobody ever
  // "corrects" the counts above back to 69 and 9 by narrowing the pattern
  // until the two menu PDFs and the download link disappear. All three are
  // real references that really do move -- decision D10 sends the menu PDFs
  // to the bucket at Task 19.
  it('counts the two menu PDFs and the link that downloads one of them', () => {
    const pdfs = inventory.references.filter((r) => r.path.endsWith('.pdf'));
    expect(pdfs.map((r) => `${r.file} ${r.pointer}`).sort()).toEqual([
      'src/components/SignatureMocktails.tsx line 90',
      'src/content/menus.json [0].file',
      'src/content/menus.json [1].file',
    ]);
  });

  // Vacuity guard. Without it a walk that matched nothing satisfies every
  // count above by making all of them zero.
  it('found a real number of references, not none', () => {
    expect(inventory.references.length).toBeGreaterThan(70);
  });

  it('records where in a document each reference sits, not just that one exists', () => {
    expect(inventory.references.every((r) => typeof r.pointer === 'string' && r.pointer.length > 0)).toBe(true);
  });
});

describe('the two patterns still agree with the guardrail that shares them', () => {
  const guardrail = readFileSync('src/content/__tests__/assets.test.ts', 'utf8');
  it.each([['ASSET_PATH_PATTERN', ASSET_PATH_PATTERN], ['CODE_ASSET_PATTERN', CODE_ASSET_PATTERN]])(
    '%s is the same expression assets.test.ts uses',
    (_name, pattern) => { expect(guardrail).toContain(pattern.source); },
  );
});

describe('the walk itself', () => {
  it('reports the json pointer, not just the file', () => {
    const found = [];
    collectFromJson({ items: [{ image: '/food/x.webp' }] }, 'f.json', found);
    expect(found[0].pointer).toBe('items[0].image');
  });

  it('does not skip the first match of every file after the first', () => {
    const found = [];
    collectFromCode('"/a/one.webp"\n"/a/two.webp"', 'a.ts', found);
    collectFromCode('"/b/one.webp"\n"/b/two.webp"', 'b.ts', found);
    expect(found.map((f) => f.path)).toEqual(['/a/one.webp', '/a/two.webp', '/b/one.webp', '/b/two.webp']);
  });

  it('reports a code reference by line so a human can find it', () => {
    const found = [];
    collectFromCode('x\ny\n"/a/one.webp"', 'a.ts', found);
    expect(found[0].pointer).toBe('line 3');
  });

  it('throws rather than skipping when a live document cannot be read', async () => {
    await expect(fetchLiveDocuments('https://x', async () => ({ ok: false, status: 503, headers: new Headers() })))
      .rejects.toThrow(/could not read the live/);
  });

  it('throws when the live read is answered from the compiled floor', async () => {
    await expect(fetchLiveDocuments('https://x', async () => ({
      ok: true, status: 200, headers: new Headers({ 'x-content-source': 'snapshot' }), text: async () => '[]',
    }))).rejects.toThrow(/not from D1/);
  });
});

// objectsFor decides what Task 4 actually uploads. Untested, a wrong answer
// here is a photograph that never reaches the bucket and a reference that
// 404s the day it is rewritten.
describe('the object list Task 4 uploads from', () => {
  const refs = [
    { path: '/food/pizza1.webp' },
    { path: '/menus/food-menu.pdf' },
    { path: '/og-image.jpg' },
    { path: '/favicon-32.png' },
    { path: '/food/pizza1.webp' },
  ];
  const objects = objectsFor(refs, ['assets-source/food/pizza1.JPG']);

  it('strips the leading slash, because R2 keys never carry one', () => {
    expect(objects.map((o) => o.key)).toContain('food/pizza1.webp');
  });

  it('leaves the share card and the icons on this origin', () => {
    expect(objects.map((o) => o.key)).not.toContain('og-image.jpg');
    expect(objects.map((o) => o.key)).not.toContain('favicon-32.png');
  });

  it('separates a menu PDF from a photograph, since they get different cache policies', () => {
    expect(objects.find((o) => o.key === 'menus/food-menu.pdf').kind).toBe('menu');
    expect(objects.find((o) => o.key === 'food/pizza1.webp').kind).toBe('derivative');
  });

  it('files an untouched original under source/, beside the derivative', () => {
    expect(objects.find((o) => o.key === 'source/food/pizza1.JPG').kind).toBe('original');
  });

  it('emits one object per key even when two documents name the same photograph', () => {
    expect(objects.filter((o) => o.key === 'food/pizza1.webp')).toHaveLength(1);
  });
});
