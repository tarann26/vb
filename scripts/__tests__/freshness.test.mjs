import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { listSources, outputPathFor, MAX_WIDTH, QUALITY } from '../images.mjs';

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// Re-encoding is byte-deterministic for a fixed sharp version, source file,
// and pipeline (confirmed by hand: running the generator twice back to back
// produces identical output hashes). That lets this test catch the exact
// failure mode Finding 2 named: someone edits or replaces a file under
// assets-source/ and forgets to run `npm run images`, so the committed
// public/*.webp silently keeps serving the old photo while every other test
// -- which only checks that a path resolves, never what it contains --
// stays green.
describe('derivative freshness', () => {
  it('every committed public/ derivative matches a fresh re-encode of its source', async () => {
    const sources = await listSources();
    expect(sources.length).toBeGreaterThan(0);

    // Re-encodes run concurrently: sharp's actual work happens off the main
    // thread (libuv threadpool), so 48 files in parallel is far faster than
    // 48 in sequence and still checks every source, not a sample.
    const results = await Promise.all(
      sources.map(async (src) => {
        const [fresh, committed] = await Promise.all([
          sharp(src)
            .rotate()
            .resize({ width: MAX_WIDTH, withoutEnlargement: true })
            .webp({ quality: QUALITY })
            .toBuffer(),
          readFile(outputPathFor(src)),
        ]);
        return hash(fresh) === hash(committed) ? null : src;
      }),
    );

    expect(results.filter(Boolean)).toEqual([]);
  });
});
