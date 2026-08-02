import { join, extname, basename, relative, sep } from 'node:path';

// Where a source photo lands in public/, and how big it is allowed to be.
//
// This module is deliberately free of `sharp` (and of every other native or
// heavyweight dependency). The Cloudflare Pages build command documented in
// docs/cloudflare-cutover.md runs `npm run test:deploy`, which runs
// scripts/__tests__/images.test.mjs; the logic that test covers is pure
// string and number manipulation. When that logic lived in images.mjs,
// importing it pulled sharp's native binding into every production deploy
// for nothing, so any sharp install or load failure on the build machine
// would block a deploy that never needed to encode an image. Keep it that
// way: nothing here may import sharp, and nothing here may import a module
// that does.
//
// scripts/__tests__/images.derivatives.test.mjs (a later addition) DOES
// import sharp, on purpose -- it proves the encode pipeline actually works,
// which no sharp-free test can. It stays out of the guarantee above by
// being excluded from `test:deploy` directly in package.json's script
// (`vitest run --exclude scripts/__tests__/images.derivatives.test.mjs`),
// not by living outside Vitest's default test glob -- so `npm run
// test:deploy` really does stay sharp-free, and `npm run test`/`vitest run`
// (which do run it) are what a developer runs locally, same as any other
// test in this repo.

export const SOURCE = 'assets-source';
export const OUT = 'public';

// Which source files `listSources()` (images.mjs) treats as photos to
// encode. Lives here rather than in images.mjs itself -- despite belonging
// conceptually to the encode pipeline -- for the same reason this whole
// module stays free of sharp: scripts/__tests__/images.test.mjs imports
// only from paths.mjs so it can run inside `npm run test:deploy` without
// ever loading sharp's native binding, and IMAGE_EXT is plain data a test
// can check membership against without encoding anything. images.mjs still
// imports it from here rather than re-declaring it, so there is exactly one
// definition, not two that could drift.
//
// Widened per D5 from the original {jpg, jpeg, png} to also cover webp,
// avif, tiff and gif -- an iPhone or a scanner can hand the owner any of
// these, and a file sharp can decode but this Set doesn't list is silently
// invisible to listSources(): never encoded, its derivative never created,
// and the build fails later on the missing public/ asset with no mention of
// why. See scripts/__tests__/images.derivatives.test.mjs for proof each of
// the newly-added extensions actually round-trips through sharp, not just
// that this Set contains its string.
export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.gif']);

// Derivatives are capped at the width they are actually displayed at, not at
// one global number. Overriding per directory is what keeps the homepage's
// eager above-the-fold images honest: Hero.tsx renders sixteen collage tiles
// in a grid-cols-6 layout, so on a 390px phone a tile paints at roughly
// 65-130 CSS pixels while a 1000px-wide derivative downloads in full.
export const DEFAULT_MAX_WIDTH = 1000;

// Keyed by the top-level directory under assets-source/.
//
// `hero` is capped at 500 because nothing in that folder is ever painted
// wider than a collage tile or a full-bleed backdrop behind opaque content.
//
// `our_story` deliberately has no entry: its carousel renders at roughly
// 600 CSS px, so those images genuinely need the 1000px default. The same
// goes for `atmosphere` and `food`, whose grids are also used at larger
// sizes elsewhere on the page -- several atmosphere images appear in the
// hero collage *and* in PlaceGallery, and the larger of the two uses wins.
export const DIR_MAX_WIDTH = {
  hero: 500,
};

// Keyed by output path, for the rare file whose display size differs from
// the rest of its directory. brick.webp is never seen at its own
// resolution: Hero.tsx paints it full-bleed at opacity-20 behind the
// collage, and src/index.css reuses it as the whole-page `body::before`
// texture at opacity 0.1. At those opacities the brick joints read as a
// wash, so 400px covers any viewport convincingly for a sixth of the bytes
// a 1000px encode costs.
export const FILE_MAX_WIDTH = {
  'public/hero/brick.webp': 400,
};

export const QUALITY = 78;

// The social share card. WebP is not reliably rendered by WhatsApp or by
// older link-preview crawlers, so this one derivative is a JPEG at the
// standard Open Graph size, generated from a source that already has a
// .webp derivative of its own.
export const OG_SOURCE = join(SOURCE, 'atmosphere', 'dining.jpg');
export const OG_OUTPUT = join(OUT, 'og-image.jpg');
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_QUALITY = 82;
// Crawlers commonly ignore share images larger than this.
export const OG_MAX_BYTES = 300 * 1024;

export function outputPathFor(sourcePath) {
  const rel = relative(SOURCE, sourcePath);
  const dir = rel.slice(0, rel.length - basename(rel).length);
  return join(OUT, dir, `${basename(rel, extname(rel))}.webp`);
}

// Most specific rule wins: a per-file cap, else the cap for the source's
// top-level directory, else the default.
export function maxWidthFor(sourcePath) {
  const output = outputPathFor(sourcePath);
  if (Object.hasOwn(FILE_MAX_WIDTH, output)) return FILE_MAX_WIDTH[output];
  const [topLevelDir] = relative(SOURCE, sourcePath).split(sep);
  if (Object.hasOwn(DIR_MAX_WIDTH, topLevelDir)) return DIR_MAX_WIDTH[topLevelDir];
  return DEFAULT_MAX_WIDTH;
}

// Two sources whose basename differs only by extension (e.g. margarita.jpg
// and margarita.png, or a leftover after someone "replaced" a photo by
// adding a new file instead of overwriting the old one) map to the same
// public/ derivative. Nothing about writing that derivative would fail --
// whichever sharp() call finishes last silently wins, and which one that is
// depends on filesystem read order, not on which file the editor intended.
// Computing every collision up front, before build() writes anything, turns
// that into a loud, deterministic failure instead of a derivative that
// quietly depends on race order.
export function findCollisions(sources) {
  const byOutput = new Map();
  for (const src of sources) {
    const out = outputPathFor(src);
    const list = byOutput.get(out);
    if (list) list.push(src);
    else byOutput.set(out, [src]);
  }
  return [...byOutput.entries()]
    .filter(([, srcs]) => srcs.length > 1)
    .map(([output, srcs]) => ({ output, sources: srcs.sort() }));
}
