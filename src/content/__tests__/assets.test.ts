import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { site } from '../index';
import { publicFiles as onDisk } from '../../test/publicFiles';

const CONTENT_DIR = join(process.cwd(), 'src', 'content');
const SRC_DIR = join(process.cwd(), 'src');

// Leading slash + a known asset extension. Deliberately excludes bare URLs
// (site.seo.url, socials) which have no leading slash.
const ASSET_PATH_PATTERN = /^\/.+\.(jpg|jpeg|png|webp|avif|svg|pdf)$/i;

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

// Not every live asset path lives in src/content. `/hero/brick.webp` is
// hardcoded in Hero.tsx and again in index.css as the whole-page
// `body::before` texture, and index.html hardcodes the favicon -- so a walk
// of the JSON alone leaves the single most globally visible image on the
// site unguarded. Rename its source, and `npm run images` prunes the
// derivative while every test, tsc and the deploy gate stay green: the site
// silently loses its hero backdrop and its page texture.
//
// Matches a quoted (or url(...)-wrapped) literal that starts at the site
// root and ends in an asset extension. Anchoring on the opening delimiter
// plus "/" is what keeps absolute URLs out: the og:image tag's
// "https://viabiancadelhi.com/og-image.jpg" begins with an "h", so it is
// never mistaken for a public/ path.
const CODE_ASSET_PATTERN = /["'`(](\/[^"'`()\n]+\.(?:jpg|jpeg|png|webp|avif|svg|pdf))["'`)]/gi;

const CODE_EXTENSIONS = ['.tsx', '.ts', '.css'];

// __tests__ directories and src/test hold fixtures and assertions full of
// asset-shaped strings that were never meant to resolve (`/hero/auto1.png`,
// `assets-source/food/margarita.png`). Walking them would mean chasing
// paths that do not and should not exist.
function listCodeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      if (relative(SRC_DIR, full) === 'test') return [];
      return listCodeFiles(full);
    }
    return CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) ? [full] : [];
  });
}

function collectAssetPathsFromCode(source: string, found: string[]): void {
  for (const match of source.matchAll(CODE_ASSET_PATTERN)) {
    found.push(match[1]);
  }
}

// Discovery, not registration: every content JSON file is parsed and walked
// here, and every component, stylesheet and index.html is scanned for the
// same paths, so a new file with a broken path fails the suite with no
// other edit required anywhere.
//
// This deliberately includes the parked components (ChefGallery.tsx,
// SignatureMocktails.tsx), which are kept on disk for later revival and
// whose paths all resolve today. If one of them ever stops resolving, that
// is precisely the thing worth knowing before someone un-parks it.
function discoverAssetPaths(): string[] {
  const found: string[] = [];
  for (const file of listContentJsonFiles(CONTENT_DIR)) {
    const data: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    collectAssetPathsFromValue(data, found);
  }
  for (const file of [...listCodeFiles(SRC_DIR), join(process.cwd(), 'index.html')]) {
    collectAssetPathsFromCode(readFileSync(file, 'utf-8'), found);
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
  // De-duplicated only for the report: a path can legitimately appear in
  // two places (dining.webp is in both galleries.atmosphere and
  // galleries.heroCollage; brick.webp is in both Hero.tsx and index.css)
  // and checking it twice tells nobody anything.
  const paths = [...new Set(discoverAssetPaths())];

  it('discovers at least one asset by walking every JSON file in src/content', () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  // Without this, a regex that quietly matched nothing outside the JSON
  // would leave the whole code scan vacuous while the suite stayed green --
  // which is the exact failure mode the scan was added to close.
  it('discovers the paths hardcoded outside src/content too', () => {
    expect(paths).toContain('/hero/brick.webp'); // Hero.tsx and src/index.css
    expect(paths).toContain('/favicon-32.png'); // index.html (the placeholder SVG it replaced is gone)
    // Reached from three places now: src/content/press.json's chef-interview
    // article, src/content/story.json's chef byline (Phase 4), and the
    // parked src/components/ChefGallery.tsx. The story.json reference is the
    // one that matters most, because Phase 4 moves that document's LIVE copy
    // to D1 -- where this walk cannot see it -- and the committed file is
    // what keeps the portrait inside this guarantee.
    expect(paths).toContain('/team/kamalika-anand.webp');
    expect(paths).toContain('/menus/food-menu.pdf'); // parked SignatureMocktails.tsx
  });

  it.each(paths)('%s exists in public/ with exact case', (path) => {
    expect(onDisk.has(decodeURIComponent(path))).toBe(true);
  });

  it.each(paths)('%s does not use the /public/ prefix', (path) => {
    expect(path.startsWith('/public/')).toBe(false);
  });

  it('excludes absolute urls such as index.html\'s og:image', () => {
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
