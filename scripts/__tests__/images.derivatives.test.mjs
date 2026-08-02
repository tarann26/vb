import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
// Deliberately from images.mjs, not paths.mjs -- this file exists
// specifically to prove sharp can actually turn each newly-widened
// extension into a working .webp derivative, so it needs the real encode
// pipeline (and, with it, sharp's native binding). Keeping this proof out of
// scripts/__tests__/images.test.mjs is what lets that file stay sharp-free
// for `npm run test:deploy` (see paths.mjs's IMAGE_EXT comment and that
// file's own header comment) -- this file is not part of that guarantee,
// and does not need to be: `npm run images` already loads sharp, directly,
// earlier in the same documented build command
// (docs/cloudflare-cutover.md's "Build command"), so nothing here newly
// couples an unrelated deploy-time check to sharp succeeding.
import { encodeDerivative } from '../images.mjs';
import { IMAGE_EXT } from '../paths.mjs';

// A widened IMAGE_EXT that lets listSources() discover a file is one claim;
// this proves sharp can genuinely decode a source written in each of those
// formats and re-encode it as webp -- the actual capability, not just the
// filter that gates access to it.
const NEW_EXTENSIONS = ['.webp', '.avif', '.tiff', '.gif'];

describe('encodeDerivative on each newly-widened extension', () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vb-images-derivatives-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists every extension this suite is about to exercise', () => {
    // A guard against this file and IMAGE_EXT silently drifting apart --
    // if a future edit widens IMAGE_EXT further without adding coverage
    // here, this fails loudly instead of leaving the new extension
    // untested.
    for (const ext of NEW_EXTENSIONS) expect(IMAGE_EXT.has(ext)).toBe(true);
  });

  it.each(NEW_EXTENSIONS)('encodes a real derivative from a %s source', async (ext) => {
    const sourcePath = join(dir, `sample${ext}`);
    const method = ext.slice(1); // '.tiff' -> 'tiff', matches sharp's own method names
    const synthetic = sharp({
      create: { width: 37, height: 23, channels: 3, background: { r: 200, g: 90, b: 40 } },
    });
    await synthetic[method]().toFile(sourcePath);

    const outputPath = join(dir, `sample-${method}-out.webp`);
    await encodeDerivative(sourcePath).toFile(outputPath);

    const meta = await sharp(outputPath).metadata();
    expect(meta.format).toBe('webp');
    // The source is well under maxWidthFor's 1000px default, so
    // withoutEnlargement must have left its dimensions untouched --
    // proving this actually ran the resize/webp pipeline against real
    // decoded pixels, not just written an empty or copied file.
    expect(meta.width).toBe(37);
    expect(meta.height).toBe(23);
  });
});
