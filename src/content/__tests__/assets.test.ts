import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { site } from '../index';

const CONTENT_DIR = join(process.cwd(), 'src', 'content');
const PUBLIC_DIR = join(process.cwd(), 'public');

// Leading slash + a known asset extension. Deliberately excludes bare URLs
// (site.seo.url, socials) which have no leading slash.
const ASSET_PATH_PATTERN = /^\/.+\.(jpg|jpeg|png|webp|avif|svg|pdf)$/i;

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name), posix.join(prefix, entry.name))
      : [posix.join('/', prefix, entry.name)],
  );
}

// Built from readdir, not existsSync: macOS is case-insensitive and Vercel is not.
const onDisk = new Set(listFiles(PUBLIC_DIR));

// Every .json file directly under src/content is content data; __tests__ holds
// test code, not content, so it is excluded from the walk.
function listContentJsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : listContentJsonFiles(join(dir, entry.name));
    }
    return entry.name.endsWith('.json') ? [join(dir, entry.name)] : [];
  });
}

// Recursively walks a parsed JSON value and collects every string that looks
// like an asset path. Tolerates null (e.g. a future Drink.image) and plain
// URLs (e.g. site.seo.url) by simply not matching them.
function collectAssetPathsFromValue(value: unknown, found: string[]): void {
  if (typeof value === 'string') {
    if (ASSET_PATH_PATTERN.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectAssetPathsFromValue(item, found));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => collectAssetPathsFromValue(item, found));
  }
}

// Discovery, not registration: every content JSON file is parsed and walked
// here, so a new content file with a broken path fails the suite with no
// other edit required anywhere.
function discoverAssetPaths(): string[] {
  const found: string[] = [];
  for (const file of listContentJsonFiles(CONTENT_DIR)) {
    const data: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    collectAssetPathsFromValue(data, found);
  }
  return found;
}

describe('content assets', () => {
  const paths = discoverAssetPaths();

  it('discovers at least one asset by walking every JSON file in src/content', () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it.each(paths)('%s exists in public/ with exact case', (path) => {
    expect(onDisk.has(decodeURIComponent(path))).toBe(true);
  });

  it.each(paths)('%s does not use the /public/ prefix', (path) => {
    expect(path.startsWith('/public/')).toBe(false);
  });

  it('excludes non-asset strings such as site.seo.url', () => {
    expect(paths).not.toContain(site.seo.url);
    expect(paths.some((path) => path.includes('viabiancadelhi.com'))).toBe(false);
  });

  it('tolerates null values in content without throwing', () => {
    expect(() =>
      collectAssetPathsFromValue({ image: null, nested: { image: null } }, []),
    ).not.toThrow();
  });
});
