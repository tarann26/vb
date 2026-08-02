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
  outputPathFor,
  maxWidthFor,
  findCollisions,
} from './paths.mjs';

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png']);

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
      failures.push({ src, out, message });
      log(`FAILED ${src}: ${message}`);
    }
  }

  // The share card is generated here rather than by a one-off command so
  // that replacing its source photo refreshes it like every other
  // derivative. Left out of `expectedOutputs` on purpose: it is a JPEG at
  // the top level of public/, which prune() never walks.
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

  const pruned = await prune(expectedOutputs);
  for (const path of pruned) log(`pruned stale derivative: ${path}`);
  return { count: sources.length, totalBytes: total, failures, pruned, collisions: [] };
}

// import.meta.url is percent-encoded (spaces become %20); process.argv[1] is
// a raw filesystem path. Comparing them directly is false for any checkout
// path containing a space -- exactly the kind of path this repo's own asset
// filenames are full of -- and the script would exit 0 having done nothing.
// import.meta.filename is the resolved absolute path, unencoded, so it
// compares correctly against argv[1] on every platform.
if (import.meta.filename === process.argv[1]) {
  const { count, totalBytes, failures, pruned, collisions } = await build({ log: console.log });
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
    if (failures.length > 0) {
      console.error(`\n${failures.length} failure(s):`);
      for (const f of failures) console.error(`  ${f.src}: ${f.message}`);
      process.exitCode = 1;
    }
  }
}
