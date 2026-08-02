import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
// Deliberately from images.mjs, not paths.mjs -- this file exists
// specifically to prove sharp can actually turn each newly-widened
// extension into a working .webp derivative, so it needs the real encode
// pipeline (and, with it, sharp's native binding). Keeping this proof out of
// scripts/__tests__/images.test.mjs is what lets that file stay sharp-free
// for `npm run test:deploy` (see paths.mjs's IMAGE_EXT comment and that
// file's own header comment) -- this file is EXCLUDED from `npm run
// test:deploy` for exactly that reason (see package.json's `test:deploy`
// script); running here under plain `npm run test`/`vitest run` is fine,
// and costs nothing extra at deploy time either: `npm run images` already
// loads sharp, directly, earlier in the same documented build command
// (docs/cloudflare-cutover.md's "Build command"), so nothing here newly
// couples an unrelated deploy-time check to sharp succeeding.
import { build, encodeDerivative } from '../images.mjs';
import { IMAGE_EXT, outputPathFor } from '../paths.mjs';

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

// build() hardcodes SOURCE/OUT to the real assets-source//public
// directories (scripts/paths.mjs) rather than taking them as parameters, so
// proving its behavior against a corrupt source means writing one into the
// real assets-source/ tree, running the real build(), then removing it --
// not a fixture directory build() could be pointed at instead. The probe
// filename is namespaced and always removed in `finally`, even if an
// assertion above throws, so a failed test run can't leave it behind to be
// picked up by a future `git add -A`.
const PROBE_SOURCE = join('assets-source', 'food', '__corrupt-probe__.jpg');
const PROBE_OUTPUT = outputPathFor(PROBE_SOURCE);

describe('build() survives one undecodable source file (security review Important fix)', () => {
  // Default 5s timeout is too tight: build() re-encodes every real source
  // under assets-source/ (48 files plus the share card as of this writing),
  // not just the one probe file this test adds.
  it('skips a corrupt file with a loud warning, exits clean, and still encodes every real source', async () => {
    // Valid JPEG magic bytes, garbage payload -- the same shape
    // worker/upload.ts's looksComplete() now rejects at upload time (see
    // worker/__tests__/upload.test.ts), reproduced here for a file that
    // reaches assets-source/ some other way (a hand-edited commit, or a
    // structurally-complete-but-undecodable container like DNG/ProRAW's
    // TIFF, which looksComplete deliberately does not catch -- see that
    // function's own comment).
    const corrupt = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(64).fill(0)]);
    await writeFile(PROBE_SOURCE, corrupt);

    try {
      const result = await build({ log: () => {} });

      expect(result.collisions).toEqual([]);
      // The OG card and every real source still succeeded -- the corrupt
      // file did not take anything else down with it.
      expect(result.failures).toEqual([]);
      expect(result.skipped.some((s) => s.src === PROBE_SOURCE)).toBe(true);
      expect(existsSync(PROBE_OUTPUT)).toBe(false);
      // A real source sitting alongside the corrupt one in the same
      // directory is unaffected.
      expect(existsSync('public/food/margarita.webp')).toBe(true);
    } finally {
      await rm(PROBE_SOURCE, { force: true });
      await rm(PROBE_OUTPUT, { force: true });
    }
  }, 30_000);
});
