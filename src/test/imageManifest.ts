// image-manifest.json, loaded once, the way src/test/publicFiles.ts loads the
// public/ tree -- so every test that has to decide whether an image reference
// resolves agrees with every other one about what "exists" means.
//
// WHY THIS FILE EXISTS AT ALL. Until the 2026-08-21 migration, "does this
// photograph exist" had exactly one answer: a file under public/ with that
// name, in that case. The forty-four photographs are objects in an R2 bucket
// now, reached through the Worker at the site-root prefix
// src/shared/image-host.ts defines, and public/ can no longer answer for them.
//
// This is a STRONGER answer than the one it replaces, not a weaker one, and
// the difference is what `verifiedAt` means. scripts/migrate-images.mjs fetched
// each object's bytes, refused them unless they were a complete RIFF WEBP,
// uploaded them, fetched them BACK over HTTPS from the production image host,
// and matched the SHA-256 and the declared payload length before stamping that
// field. A key in `verifiedKeys` is therefore a key whose bytes were served to
// this machine and checked, where a name in publicFiles is only a directory
// entry that `npm run images` happened to write.
//
// IT LIVES AT THE REPOSITORY ROOT rather than under src/content/, deliberately.
// src/content/__tests__/assets.test.ts walks every .json file under
// src/content/ as content data, and would try to resolve this manifest's own
// keys as though they were image references.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ManifestObject {
  bytes: number;
  sha256: string;
  contentType: string;
  cacheControl: string;
  kind: 'derivative' | 'original' | 'menu';
  verifiedAt?: string;
}

export interface ImageManifest {
  servedFrom: string;
  generatedAt: string;
  objects: Record<string, ManifestObject>;
}

export const manifest: ImageManifest = JSON.parse(
  readFileSync(join(process.cwd(), 'image-manifest.json'), 'utf-8'),
) as ImageManifest;

// The keys a page may actually reference.
//
// BOTH FILTERS ARE LOAD-BEARING and each closes a different hole. The
// `source/` prefix holds the fifty-one archived originals -- the camera JPEGs
// and PNGs the derivatives were encoded from. Nothing serves them and nothing
// links to them, so admitting them here would let a content file name an
// eight-megabyte original and still pass. And an object without `verifiedAt`
// is one the migration uploaded but could not read back intact; admitting
// those would make this set exactly as trustworthy as an unchecked directory
// listing, which is the thing it exists to improve on.
export const verifiedKeys: ReadonlySet<string> = new Set(
  Object.entries(manifest.objects)
    .filter(([key, entry]) => !key.startsWith('source/') && typeof entry.verifiedAt === 'string')
    .map(([key]) => key),
);
