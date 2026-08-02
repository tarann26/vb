import { readdir, mkdir, stat, rm } from 'node:fs/promises';
import { join, extname, basename, relative } from 'node:path';
import sharp from 'sharp';

export const SOURCE = 'assets-source';
export const OUT = 'public';
export const MAX_WIDTH = 1000;
export const QUALITY = 78;
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

export function outputPathFor(sourcePath) {
  const rel = relative(SOURCE, sourcePath);
  const dir = rel.slice(0, rel.length - basename(rel).length);
  return join(OUT, dir, `${basename(rel, extname(rel))}.webp`);
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

// Removes derivatives whose source no longer exists. `expectedOutputs` is
// the full outputPathFor() set for every current source -- independent of
// whether sharp succeeded on it this run, so a transient encode failure
// never causes its (still-valid) previous derivative to be deleted. Only
// walks the top-level subdirectories that exist under SOURCE, so it never
// touches public/menus or anything else outside the image tree.
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
      await sharp(src)
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(out);
      const { size } = await stat(out);
      total += size;
      log(`${src} -> ${out} (${(size / 1024).toFixed(0)}KB)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ src, out, message });
      log(`FAILED ${src}: ${message}`);
    }
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
    console.log(`\n${count} images, ${(totalBytes / 1024 / 1024).toFixed(2)}MB total`);
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
