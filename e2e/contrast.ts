// WCAG 2.1 contrast, over the `rgb(r, g, b)` strings `getComputedStyle`
// hands back.
//
// Lifted out of e2e/blog-controls.spec.ts, byte-identical, the first time a
// second spec needed the same three functions. The alternative -- a copy in
// the new file -- is exactly how e2e/edit-backend.ts's own CONTENT_FILES came
// to be maintained by hand in three places, which that file's header already
// records as the reason it exists.
//
// Not a `.spec.ts`: playwright.config.ts's `testDir: './e2e'` picks up every
// file it considers a test, and a helper module with no `test()` call in it is
// reported as an empty suite.
//
// There is a second contrast implementation in this repository,
// src/test/contrast.ts, and the two are deliberately not merged. That one
// takes hex and is what the jsdom palette tests and e2e/brand-contrast.spec.ts
// use after compositing a translucent stack down to opaque triples; this one
// takes the rgb() string a browser reports for an already-opaque colour and
// throws rather than guess when it is handed anything else. Merging them would
// mean one function that either parses two formats or silently accepts an
// rgba() it cannot honestly measure.
export function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(rgb: string): number {
  const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!m) throw new Error(`not an opaque rgb() colour: ${rgb}`);
  return 0.2126 * channel(Number(m[1])) + 0.7152 * channel(Number(m[2])) + 0.0722 * channel(Number(m[3]));
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
