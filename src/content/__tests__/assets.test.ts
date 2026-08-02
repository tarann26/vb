import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, basename } from 'node:path';
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

const IMAGE_KEY_NAMES = new Set(['image', 'src', 'file']);

interface ImageKeyEntry {
  path: string;
  value: unknown;
}

// collectAssetPathsFromValue above only collects strings that already match
// ASSET_PATH_PATTERN, so a malformed value under an image-ish key -- an
// empty string, or a path missing its leading slash -- is invisible to it by
// construction: the value that most needs checking is exactly the one that
// gets skipped. This walk instead keys off the *property name* (image, src,
// file) and records whatever value sits there, well-formed or not, so the
// test below can assert on it directly.
function collectImageKeyValues(value: unknown, path: string, found: ImageKeyEntry[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectImageKeyValues(item, `${path}[${index}]`, found));
  } else if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      const nextPath = `${path}.${key}`;
      if (IMAGE_KEY_NAMES.has(key)) {
        found.push({ path: nextPath, value: item });
      }
      collectImageKeyValues(item, nextPath, found);
    });
  }
}

function discoverImageKeyValues(): ImageKeyEntry[] {
  const found: ImageKeyEntry[] = [];
  for (const file of listContentJsonFiles(CONTENT_DIR)) {
    const data: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    collectImageKeyValues(data, basename(file), found);
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

describe('image-like fields (image/src/file) are null or a valid asset path', () => {
  const entries = discoverImageKeyValues();

  it('discovers at least one image-like field to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries.map((entry) => [entry.path, entry] as const))(
    '%s is null or matches the asset path pattern',
    (_path, entry) => {
      const isValid =
        entry.value === null ||
        (typeof entry.value === 'string' && ASSET_PATH_PATTERN.test(entry.value));
      expect(isValid).toBe(true);
    },
  );
});
