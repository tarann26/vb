// How wide a derivative is allowed to be. An independent re-implementation of
// scripts/paths.mjs's maxWidthFor, not an import -- that module is plain ESM
// built for Node and deliberately free of sharp so it can run inside
// `npm run test:deploy`, and neither this bundle nor the Worker can import a
// bare .mjs from outside its own project. This is the same arrangement
// src/shared/derivative-path.ts already has with outputPathFor, and the link
// between the two is a test over every real source file, not a compiler.
//
// KEYED ON THE OUTPUT PATH, matching maxWidthFor's precedence exactly: a
// per-file cap wins, then a cap for the top-level directory, then the default.
export const DEFAULT_MAX_WIDTH = 1000;

// Nothing under this directory is ever painted wider than a collage tile or a
// full-bleed backdrop behind opaque content.
export const DIR_MAX_WIDTH: Readonly<Record<string, number>> = { hero: 500 };

// The one file whose display size differs from the rest of its directory: it
// is painted at low opacity behind the collage and again as the whole-page
// texture, where the brick joints read as a wash.
export const FILE_MAX_WIDTH: Readonly<Record<string, number>> = { 'public/hero/brick.webp': 400 };

// hasOwnProperty.call, not Object.hasOwn, which is what scripts/paths.mjs
// uses. tsconfig.app.json targets ES2020 and lists ES2020 as its lib, so
// Object.hasOwn is not declared for this project -- and widening that lib to
// reach one helper would change the target every component in the bundle is
// checked against. Same semantics, including refusing to answer for an
// inherited key such as one spelled to reach the prototype.
const has = (caps: Readonly<Record<string, number>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(caps, key);

export function maxWidthForOutput(outputPath: string): number {
  if (has(FILE_MAX_WIDTH, outputPath)) return FILE_MAX_WIDTH[outputPath];
  const withoutPrefix = outputPath.startsWith('public/') ? outputPath.slice('public/'.length) : outputPath;
  const topLevel = withoutPrefix.split('/')[0];
  if (has(DIR_MAX_WIDTH, topLevel)) return DIR_MAX_WIDTH[topLevel];
  return DEFAULT_MAX_WIDTH;
}

// What an upload in a given category is capped at. The category is what the
// picker knows; the output path is what the rule is keyed on. The filename is
// optional because a new upload's key is content-addressed and can never
// collide with FILE_MAX_WIDTH's one hand-named entry.
export function maxWidthForCategory(category: string, filename = 'x.webp'): number {
  return maxWidthForOutput('public/' + category + '/' + filename);
}
