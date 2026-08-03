// Mirrors scripts/paths.mjs's outputPathFor: the Worker (worker/upload.ts,
// Task 5) needs to turn the source path POST /api/upload just staged
// (assets-source/food/<hash>.jpg) into the path dishes.json actually
// stores -- food/<hash>.webp, with a leading slash -- the same rule
// scripts/images.mjs's build() uses to decide where a source's encoded
// derivative lands.
//
// A note on how that last path is (deliberately) never spelled out above
// wrapped in quotes, backticks or parens with nothing else inside: this
// file lives under src/, and src/content/__tests__/assets.test.ts scans
// every non-test .ts/.tsx/.css file there for exactly that shape -- a
// quote/backtick/paren, then a leading slash, then ordinary characters,
// then a known image extension, then the matching closer -- and treats
// each match as a real path that must exist under public/. A hand-written
// EXAMPLE formatted that way is indistinguishable to that scan from a real
// hardcoded reference, and fails the suite over a file nobody actually
// needs on disk. Confirmed directly while writing this file: two
// assets.test.ts cases went red the first time this was written the
// "obvious" way, both here and in src/admin/PhotoField.tsx's own doc
// comment for the identical reason.
//
// This is an independent re-implementation, not a shared import.
// scripts/paths.mjs is plain ESM built for Node (it's imported by
// scripts/images.mjs, which loads sharp's native binding at module scope --
// see that file's own comment on why nothing sharp-adjacent may leak into
// this repo's other build targets) and neither the Worker nor the browser
// bundle can import a bare .mjs file from outside its own project the way
// Node can. So the two implementations must never be allowed to drift apart
// silently, and the link between them is a test, not a require:
// src/shared/__tests__/derivative-path.test.ts imports BOTH this function
// and scripts/paths.mjs's outputPathFor and asserts they agree over every
// real file under assets-source/, not over a hand-picked list of cases.
// Change either implementation and that test is what catches a divergence
// -- there is no compiler link between them.
const SOURCE_PREFIX = 'assets-source/';

export function derivativePath(sourcePath: string): string {
  if (!sourcePath.startsWith(SOURCE_PREFIX)) {
    // Every real caller (worker/upload.ts) only ever passes a path
    // `uploadPath` itself just built, always under assets-source/ -- a
    // path that doesn't start there is a programming error, not a shape
    // this function should silently mis-derive an answer for (e.g. by
    // producing a path with a leading ".." segment).
    throw new Error(`derivativePath: expected a path under "${SOURCE_PREFIX}", got "${sourcePath}"`);
  }

  const rel = sourcePath.slice(SOURCE_PREFIX.length); // "food/<hash>.jpg"
  const lastSlash = rel.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : rel.slice(0, lastSlash + 1); // "food/", preserving any nesting
  const filename = lastSlash === -1 ? rel : rel.slice(lastSlash + 1); // "<hash>.jpg"
  const dot = filename.lastIndexOf('.');
  const stem = dot === -1 ? filename : filename.slice(0, dot); // "<hash>"

  // Built by concatenation, not a single template literal spanning the
  // whole path -- that shape (a backtick, then a leading slash, then only
  // interpolations and an image extension, then the closing backtick) is
  // exactly what this file's own top comment describes assets.test.ts's
  // scan as matching, and this function DERIVES a path from its arguments
  // rather than hardcoding one -- see that comment for the confirmed
  // failure this avoids.
  return '/' + dir + stem + '.webp';
}
