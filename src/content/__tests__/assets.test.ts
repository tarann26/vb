import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { collectAssetPaths } from '../index';

const PUBLIC_DIR = join(process.cwd(), 'public');

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), posix.join(prefix, entry.name))
      : [posix.join('/', prefix, entry.name)],
  );
}

// Built from readdir, not existsSync: macOS is case-insensitive and Vercel is not.
const onDisk = new Set(listFiles(PUBLIC_DIR));

describe('content assets', () => {
  const paths = collectAssetPaths();

  it('references at least one asset', () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it.each(paths)('%s exists in public/ with exact case', (path) => {
    expect(onDisk.has(decodeURIComponent(path))).toBe(true);
  });

  it.each(paths)('%s does not use the /public/ prefix', (path) => {
    expect(path.startsWith('/public/')).toBe(false);
  });
});
