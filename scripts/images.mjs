import { readdir, mkdir, stat } from 'node:fs/promises';
import { join, extname, basename, relative } from 'node:path';
import sharp from 'sharp';

const SOURCE = 'assets-source';
const OUT = 'public';
const MAX_WIDTH = 1000;
const QUALITY = 78;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png']);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    ),
  );
  return files.flat();
}

export function outputPathFor(sourcePath) {
  const rel = relative(SOURCE, sourcePath);
  const dir = rel.slice(0, rel.length - basename(rel).length);
  return join(OUT, dir, `${basename(rel, extname(rel))}.webp`);
}

export async function build({ log = () => {} } = {}) {
  const sources = (await walk(SOURCE)).filter((f) =>
    IMAGE_EXT.has(extname(f).toLowerCase()),
  );
  let total = 0;
  for (const src of sources) {
    const out = outputPathFor(src);
    await mkdir(out.slice(0, out.length - basename(out).length), { recursive: true });
    await sharp(src)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(out);
    const { size } = await stat(out);
    total += size;
    log(`${src} -> ${out} (${(size / 1024).toFixed(0)}KB)`);
  }
  return { count: sources.length, totalBytes: total };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { count, totalBytes } = await build({ log: console.log });
  console.log(`\n${count} images, ${(totalBytes / 1024 / 1024).toFixed(2)}MB total`);
}
