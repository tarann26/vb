import { describe, it, expect } from 'vitest';
import { siteRootForm } from './siteRootForm';

// Over the tree as it stands today this helper is applied mostly to values
// that have not moved, so most of what reads it cannot see it work. Measured
// by replacing its body with `return text`:
//
//   scripts/__tests__/rewrite-image-refs.test.mjs   3 tests red. That file
//       applies it to plan()'s OUTPUT, which holds migrated references
//       whether or not the rewrite has been run, so the undo is exercised
//       there today.
//   worker/__tests__/snapshot.test.ts               green.
//   src/admin/__tests__/EditMode.test.tsx           green.
//
// Those last two only start exercising it on the day a human runs the
// rewrite, which is the day it has to already be right. These cases are what
// make it able to fail before then, and they are written against literal text
// rather than against anything the repository currently holds.
//
// Spelled out rather than imported from src/shared/image-host.ts on purpose:
// built out of the same constant the helper reads, every case below would
// agree with it by construction and none would notice the prefix moving.
const BASE = '/images';

describe('siteRootForm', () => {
  it('turns a migrated reference back into the path it was written from', () => {
    expect(siteRootForm(`"image": "${BASE}/food/pizza1.webp"`)).toBe('"image": "/food/pizza1.webp"');
  });

  it('decodes the percent-encoding a spaced filename picked up on the way out', () => {
    expect(siteRootForm(`"${BASE}/mocktails/signor%20bianca.webp"`)).toBe('"/mocktails/signor bianca.webp"');
  });

  it('undoes a css url() and a jsx attribute in the same text', () => {
    const text = `a { background-image: url("${BASE}/hero/brick.webp"); }\n<img src="${BASE}/food/x.webp" />`;
    expect(siteRootForm(text)).toBe('a { background-image: url("/hero/brick.webp"); }\n<img src="/food/x.webp" />');
  });

  it('undoes an unquoted css url(), where the delimiter is the paren itself', () => {
    expect(siteRootForm(`url(${BASE}/hero/brick.webp)`)).toBe('url(/hero/brick.webp)');
  });

  it('undoes every occurrence, not only the first', () => {
    expect(siteRootForm(`${BASE}/a.webp ${BASE}/b.webp ${BASE}/c.webp`)).toBe('/a.webp /b.webp /c.webp');
  });

  it('leaves a path that never moved exactly as it is', () => {
    expect(siteRootForm('"/og-image.jpg" "/menus/food-menu.pdf"')).toBe('"/og-image.jpg" "/menus/food-menu.pdf"');
  });

  // The reason this is safe to read an assertion through, and the case that
  // the move to a same-origin prefix made possible to get wrong. A photograph
  // on somebody else's host is not touched, so an assertion that used to fail
  // on one still fails on one -- and `/images/` sitting in the MIDDLE of that
  // host's own path is not a reference this site ever wrote.
  it('leaves a url on another host alone, including one whose own path spells the prefix', () => {
    const text = `"https://evil.example/food/x.webp" "https://evil.example${BASE}/food/x.webp"`;
    expect(siteRootForm(text)).toBe(text);
  });

  it('leaves the retired image subdomain alone, prefix and all', () => {
    const text = `"https://img.viabiancarestaurant.com${BASE}/food/x.webp"`;
    expect(siteRootForm(text)).toBe(text);
  });

  it('leaves a longer path that merely starts the same way alone', () => {
    expect(siteRootForm('"/imagesets/food/x.webp"')).toBe('"/imagesets/food/x.webp"');
  });

  it('leaves prose that merely names the prefix alone', () => {
    expect(siteRootForm(`the bucket is served under ${BASE} today`)).toBe(
      `the bucket is served under ${BASE} today`,
    );
  });
});
