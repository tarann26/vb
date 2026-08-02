import { readdir, mkdir, stat, rm } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import sharp from 'sharp';
import {
  SOURCE,
  OUT,
  QUALITY,
  OG_SOURCE,
  OG_OUTPUT,
  OG_WIDTH,
  OG_HEIGHT,
  OG_QUALITY,
  IMAGE_EXT,
  outputPathFor,
  maxWidthFor,
  findCollisions,
} from './paths.mjs';

// Re-exported, not re-declared: IMAGE_EXT itself now lives in paths.mjs so
// scripts/__tests__/images.test.mjs can check it without importing sharp
// (see that constant's own comment there). Kept as a named export here too
// so nothing that already imports IMAGE_EXT from this file breaks.
export { IMAGE_EXT };

export async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    ),
  );
  return files.flat();
}

// Shared by build() and the freshness test, so both agree on exactly which
// files count as sources without duplicating the extension filter.
export async function listSources() {
  const all = await walk(SOURCE);
  return all.filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()));
}

// The single definition of each encode pipeline, returned unterminated so
// build() can .toFile() it and the freshness test can .toBuffer() it. If
// these two ever described the pipeline separately, changing the generator
// would leave the freshness check re-encoding by the old recipe and
// reporting every derivative as stale.
export function encodeDerivative(sourcePath) {
  return sharp(sourcePath)
    .rotate()
    .resize({ width: maxWidthFor(sourcePath), withoutEnlargement: true })
    .webp({ quality: QUALITY });
}

export function encodeOgImage() {
  return sharp(OG_SOURCE)
    .rotate()
    .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover' })
    .jpeg({ quality: OG_QUALITY });
}

// Removes derivatives whose source no longer exists. `expectedOutputs` is
// the full outputPathFor() set for every current source -- independent of
// whether sharp succeeded on it this run, so a transient encode failure
// never causes its (still-valid) previous derivative to be deleted. Only
// walks the top-level subdirectories that exist under SOURCE, so it never
// touches public/menus, public/og-image.jpg or anything else outside the
// image tree.
async function prune(expectedOutputs) {
  const removed = [];
  const sourceDirs = (await readdir(SOURCE, { withFileTypes: true })).filter((e) =>
    e.isDirectory(),
  );
  for (const { name } of sourceDirs) {
    const outDir = join(OUT, name);
    let candidates;
    try {
      candidates = await walk(outDir);
    } catch {
      continue; // no derivative dir yet for this source dir
    }
    for (const file of candidates) {
      if (extname(file).toLowerCase() === '.webp' && !expectedOutputs.has(file)) {
        await rm(file);
        removed.push(file);
      }
    }
  }
  return removed;
}

export async function build({ log = () => {} } = {}) {
  const sources = await listSources();

  // Checked before any file is touched: writing derivatives for a colliding
  // pair would still "succeed" (see findCollisions above), so the only place
  // this can be caught is before that write happens, not after.
  const collisions = findCollisions(sources);
  if (collisions.length > 0) {
    for (const { output, sources: srcs } of collisions) {
      log(`COLLISION: ${srcs.join(', ')} all map to ${output}`);
    }
    return { count: sources.length, totalBytes: 0, failures: [], pruned: [], collisions };
  }

  const expectedOutputs = new Set(sources.map(outputPathFor));
  let total = 0;
  // A source sharp cannot decode -- a truncated upload that slipped past
  // worker/upload.ts's own completeness check, a hand-edited commit, or a
  // container format (DNG/ProRAW-shaped TIFF) `detectFormat` correctly
  // names but sharp still can't read -- is SKIPPED, not fatal. A photo
  // sitting unreferenced in assets-source/ (which is exactly where an
  // uploaded-but-not-yet-attached photo lives) breaks nothing: the asset
  // guardrail (src/content/__tests__/assets.test.ts) only fails the build
  // once a content file actually references a path with no derivative --
  // so that check still catches the case that matters, while one unusable
  // file no longer holds the entire site hostage the way any single
  // encode failure used to (see this array's history: it was merged into
  // `failures` below and any non-empty `failures` set process.exitCode = 1,
  // so one bad photo failed `npm run images`, which failed every deploy,
  // with no way for her to remove it herself).
  const skipped = [];
  const failures = [];
  for (const src of sources) {
    const out = outputPathFor(src);
    try {
      await mkdir(out.slice(0, out.length - basename(out).length), { recursive: true });
      await encodeDerivative(src).toFile(out);
      const { size } = await stat(out);
      total += size;
      log(`${src} -> ${out} (${(size / 1024).toFixed(0)}KB @ ${maxWidthFor(src)}px)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      skipped.push({ src, out, message });
      log(`WARNING: skipped ${src} -- sharp could not decode it (${message})`);
    }
  }

  // The share card is generated here rather than by a one-off command so
  // that replacing its source photo refreshes it like every other
  // derivative. Left out of `expectedOutputs` on purpose: it is a JPEG at
  // the top level of public/, which prune() never walks.
  //
  // Unlike a source-photo encode failure above, an OG-card failure stays in
  // `failures` (fatal, exitCode 1): og-image.jpg is not an owner-uploaded
  // photo sitting unreferenced until she attaches it to something -- it is
  // a single hardcoded, site-wide asset (index.html's og:image tag) that is
  // always expected to exist, so silently skipping it would ship a broken
  // share card with no signal anywhere that it happened.
  try {
    await encodeOgImage().toFile(OG_OUTPUT);
    const { size } = await stat(OG_OUTPUT);
    total += size;
    log(`${OG_SOURCE} -> ${OG_OUTPUT} (${(size / 1024).toFixed(0)}KB share card)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push({ src: OG_SOURCE, out: OG_OUTPUT, message });
    log(`FAILED ${OG_SOURCE}: ${message}`);
  }

  // prune() is unaffected by a skip: `expectedOutputs` already includes
  // every source in `sources` regardless of whether sharp succeeded on it
  // this run (see prune()'s own comment), so a transient or permanent
  // encode failure never causes an earlier, still-good derivative to be
  // deleted -- and a source that has NEVER successfully encoded has no
  // derivative to delete in the first place.
  const pruned = await prune(expectedOutputs);
  for (const path of pruned) log(`pruned stale derivative: ${path}`);
  return { count: sources.length, totalBytes: total, failures, skipped, pruned, collisions: [] };
}

// import.meta.url is percent-encoded (spaces become %20); process.argv[1] is
// a raw filesystem path. Comparing them directly is false for any checkout
// path containing a space -- exactly the kind of path this repo's own asset
// filenames are full of -- and the script would exit 0 having done nothing.
// import.meta.filename is the resolved absolute path, unencoded, so it
// compares correctly against argv[1] on every platform.
if (import.meta.filename === process.argv[1]) {
  const { count, totalBytes, failures, skipped, pruned, collisions } = await build({ log: console.log });
  if (collisions.length > 0) {
    console.error(
      `\n${collisions.length} filename collision(s) -- nothing was written. Two source ` +
        `photos map to the same output file; delete or rename one from each pair below, ` +
        `then run this again:`,
    );
    for (const { output, sources } of collisions) {
      console.error(`  ${output}: ${sources.join(', ')}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `\n${count} images plus the share card, ${(totalBytes / 1024 / 1024).toFixed(2)}MB total`,
    );
    if (pruned.length > 0) {
      console.log(`${pruned.length} stale derivative(s) pruned`);
    }
    // Loud, but not fatal: process.exitCode is deliberately untouched here
    // -- see build()'s own comment on why one undecodable source shouldn't
    // hold the whole site hostage. The filename is printed first and on its
    // own so it's the thing that's obvious to spot and go delete.
    if (skipped.length > 0) {
      console.warn(
        `\n${'='.repeat(72)}\n${skipped.length} source file(s) could not be decoded and were SKIPPED ` +
          `(no derivative was written for them):\n${'='.repeat(72)}`,
      );
      for (const s of skipped) console.warn(`  ${s.src}\n    ${s.message}`);
      console.warn(
        `\nIf nothing in src/content/ references these yet, the build is still fine --\n` +
          `this is only a problem once something points at one of them. Delete or\n` +
          `replace the file(s) above to clear this warning.`,
      );
    }
    if (failures.length > 0) {
      console.error(`\n${failures.length} failure(s):`);
      for (const f of failures) console.error(`  ${f.src}: ${f.message}`);
      process.exitCode = 1;
    }
  }
}
