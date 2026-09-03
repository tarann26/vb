import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { site } from '../index';
import { publicFiles as onDisk } from '../../test/publicFiles';
import { verifiedKeys } from '../../test/imageManifest';
import { IMAGE_BASE, imageUrl, keyFromImageUrl } from '../../shared/image-host';

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
    expect(paths).toContain(imageUrl('hero/brick.webp')); // Hero.tsx and src/index.css
    expect(paths).toContain('/favicon-32.png'); // index.html (the placeholder SVG it replaced is gone)
    // Reached from three places now: src/content/press.json's chef-interview
    // article, src/content/story.json's chef byline (Phase 4), and the
    // parked src/components/ChefGallery.tsx. The story.json reference is the
    // one that matters most, because Phase 4 moves that document's LIVE copy
    // to D1 -- where this walk cannot see it -- and the committed file is
    // what keeps the portrait inside this guarantee.
    expect(paths).toContain(imageUrl('team/kamalika-anand.webp'));
    expect(paths).toContain('/menus/food-menu.pdf'); // parked SignatureMocktails.tsx
  });

  // The test above proves /team/kamalika-anand.webp is DISCOVERED somewhere
  // in the walk -- it does not prove story.json is the one still pointing
  // at it. press.json and ChefGallery.tsx are independent referrers, so
  // repointing story.json's own chef.portrait to a different real file
  // leaves the test above green (the string is still found, just from the
  // other two places) and leaves it.each(paths) green too (the new path is
  // a valid, existing file). Neither catches a drifted portrait in THIS
  // document. This test reads story.json directly and pins its own field,
  // independent of who else references the photo.
  it("story.json's own chef.portrait still points at the real chef photo", () => {
    const storyPath = join(CONTENT_DIR, 'story.json');
    const story = JSON.parse(readFileSync(storyPath, 'utf-8')) as { chef: { portrait: string } };
    expect(story.chef.portrait).toBe(imageUrl('team/kamalika-anand.webp'));
  });

  // ------------------------------------------------------------------------
  // WHERE A REFERENCE IS OWED ITS PROOF, since the 2026-08-21 migration.
  // ------------------------------------------------------------------------
  // Until that migration every path here was answered by one thing: a file
  // under public/ with that name in that case. Forty-four photographs are R2
  // objects now, served through the Worker at src/shared/image-host.ts's
  // prefix, and public/ cannot answer for them. Three references stayed --
  // the share card and both menu PDFs -- and public/ is still the only thing
  // that answers for those.
  //
  // So the list is PARTITIONED rather than filtered. Filtering the migrated
  // paths out is the vacuous version of this file: seventy-seven of the
  // eighty-one references would stop being checked by anything at all, and
  // the suite would stay green while a content file named a photograph that
  // was never uploaded. The partition is total by construction -- every path
  // lands in exactly one of these two lists -- and both halves are asserted
  // non-empty below, so neither branch can quietly stop running.
  //
  // Split on the PREFIX, not on whether keyFromImageUrl returns a key. Those
  // are different questions: a path under the prefix that the Worker's own
  // parser refuses (a traversal, a malformed escape) is a broken image
  // reference and has to fail as one, not be handed to the public/ check
  // where it would fail for the wrong reason or throw.
  const imageRefs = paths.filter((path) => path.startsWith(`${IMAGE_BASE}/`));
  const publicRefs = paths.filter((path) => !path.startsWith(`${IMAGE_BASE}/`));

  it('has references of both kinds, so neither check below is running on nothing', () => {
    expect(imageRefs.length).toBeGreaterThan(0);
    expect(publicRefs.length).toBeGreaterThan(0);
  });

  // A floor, not an exact count: the owner uploads photographs through the
  // dashboard and every upload grows this set. Without it, a truncated or
  // half-written manifest would make every assertion below pass trivially --
  // an empty `verifiedKeys` cannot contain a key, so it would fail loudly;
  // but a manifest holding only the `source/` originals would leave
  // verifiedKeys empty AND is exactly the shape a partial migration writes.
  // Forty-four is what the migration that moved these references produced.
  it('reads a manifest that still describes every migrated photograph', () => {
    expect(verifiedKeys.size).toBeGreaterThanOrEqual(44);
  });

  // The replacement for the public/ existence check, and a stricter one. A
  // name in publicFiles is a directory entry `npm run images` happened to
  // write. A key in verifiedKeys is a key whose bytes scripts/migrate-
  // images.mjs fetched BACK from the production image host over HTTPS and
  // matched against a recorded SHA-256 and payload length. The class of bug
  // the old check caught -- a content file naming a photograph that does not
  // exist -- is caught here, against a source of truth that had to be read
  // to be written.
  it.each(imageRefs)('%s names a verified object in image-manifest.json', (path) => {
    const key = keyFromImageUrl(path);
    expect(key, `${path} is not a well-formed reference to the image host`).not.toBeNull();
    expect(verifiedKeys.has(key as string)).toBe(true);
  });

  it.each(publicRefs)('%s exists in public/ with exact case', (path) => {
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
