// Copies the live derivatives into R2 without re-encoding a single one, and
// archives every original beside them.
//
// WHY FETCH RATHER THAN BUILD. public/*/ is gitignored: the .webp files on a
// developer's disk are a local build artefact, produced by whatever sharp and
// libwebp that machine happens to have. What the site actually serves was
// produced on Cloudflare's build image. Those two are usually identical and
// are not guaranteed to be, and "usually identical" is not a property to bet
// fifty photographs on. Fetching the live object makes the question unaskable.
//
// THE ONE FAILURE THIS MUST NOT ABSORB. This site has served an asset as
// text/html through a poisoned edge cache THREE TIMES -- it is the entire
// reason scripts/verify-deploy.mjs exists, and that script's SETTLE_MS
// constant is there because it has TWICE CAUSED the outage it detects. If one
// of those responses reaches this script, a 4 KB HTML document lands in the
// bucket wearing a webp name, and every later check that looks only at a
// status code passes forever. So a response is refused unless BOTH its
// declared Content-Type is image/webp AND its first twelve bytes are a real
// RIFF....WEBP header AND the RIFF-declared payload length equals the body
// length. Not any one of the three: a poisoned response can carry a
// correct-looking header, and a correctly-typed response can still be
// truncated with its header intact.
//
// NOT RUN YET, AND THE REASON IS RECORDED IN docs/cloudflare-cutover.md §21.
// The read-back below fetches every object back from
// img.viabiancarestaurant.com, and that hostname does not resolve: the R2
// custom domain has not been connected. Connecting it is a public-access
// change on the live zone that makes every object in the bucket world-readable
// at a predictable URL, which is the account owner's decision and is why no
// script here performs it. Measured 2026-09-01: `wrangler r2 bucket domain
// list via-bianca` reports no custom domains, and curl reports "Could not
// resolve host". Until that changes, this script has nothing to read back
// from and MUST NOT be run with the read-back stubbed out -- an unverified
// object is exactly what scripts/rewrite-image-refs.mjs refuses to point at.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);

export const BUCKET = 'via-bianca';
export const IMAGE_ORIGIN = 'https://img.viabiancarestaurant.com';
export const SITE_ORIGIN = 'https://viabiancarestaurant.com';

const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

export function looksLikeWebp(bytes) {
  if (bytes.length < 12) return false;
  for (let i = 0; i < 4; i++) if (bytes[i] !== RIFF[i]) return false;
  // Offset 8, not just the RIFF prefix: WAV files share the RIFF container and
  // differ only here. A RIFF check alone accepts an audio file.
  for (let i = 0; i < 4; i++) if (bytes[8 + i] !== WEBP[i]) return false;
  // RIFF declares its own payload length at offset 4, little-endian. A
  // truncated download fails this even though the header is intact -- which is
  // the failure a Content-Type check cannot see, because the header the
  // truncated response carries is the right one.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(4, true) + 8 === bytes.length;
}

export async function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// A twelve-hex stem is worker/upload.ts's content-addressed key shape: the
// bytes under that key can never legitimately change, so the browser may keep
// them forever. Everything else is a legacy human-named key or a stable menu
// name that CAN be re-uploaded under the same key, so it gets a day.
//
// ONE BLANKET WEEK-LONG TTL WOULD BE WRONG, and this is the whole reason there
// are two policies: this migration has no purge mechanism for R2 at all, so a
// corrected photograph under a legacy name would be invisible for the length
// of the TTL. A day is long enough that the edge answers nearly every request
// and short enough that a correction appears without one.
const HASH_STEM = /\/[0-9a-f]{12}\.[a-z0-9]+$/i;

export function cacheControlFor(key) {
  return HASH_STEM.test('/' + key)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400';
}

const TYPES = {
  webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  avif: 'image/avif', tiff: 'image/tiff', gif: 'image/gif', pdf: 'application/pdf',
};

export function contentTypeFor(key) {
  const type = TYPES[key.slice(key.lastIndexOf('.') + 1).toLowerCase()];
  // NEVER a default of application/octet-stream: R2 serves whatever is stored
  // here, and a photograph served as octet-stream downloads instead of
  // painting. An unknown extension is a bug in the inventory, and it stops the
  // migration rather than shipping a key nothing can render.
  if (!type) throw new Error(`no content type for "${key}"`);
  return type;
}

// The extension is a claim; the first bytes are the fact, and on this
// repository the two disagree on TEN of the fifty-one archived originals.
// Measured 2026-09-01 by reading the magic number of every file under
// assets-source/: atmosphere/dining.jpg, atmosphere/outsideLOGO.jpg,
// food/margarita.jpg, food/tielle.jpg, food/tiramisu.jpg, hero/brick.jpg,
// mocktails/bicerin.jpg, our_story/handmaking.jpg and two more all carry a
// .jpg name over PNG data. contentTypeFor would store every one of them as
// image/jpeg.
//
// The plan this file came from asserted the original's type was "taken from
// detectFormat's answer upstream" -- it is not; docs/image-inventory.json
// carries nothing but a key and a kind, and the key keeps whatever extension
// the file was handed over with. So the sniff happens here, and only for
// originals: a derivative has already been proved a complete RIFF WEBP by
// looksLikeWebp, and a menu PDF's extension is chosen by this repository
// rather than by whoever emailed the photograph.
//
// Returns null for anything it does not recognise, and the caller falls back
// to the extension rather than storing a guess.
export function detectImageType(bytes) {
  const starts = (...prefix) =>
    bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff';
  if (looksLikeWebp(bytes)) return 'image/webp';
  // AVIF's brand sits at offset 4, inside the ISO-BMFF ftyp box.
  if (bytes.length >= 12 && [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]
    .every((byte, index) => bytes[4 + index] === byte)) return 'image/avif';
  return null;
}

// What the object is STORED as. R2 serves this header back verbatim, so it is
// what a browser reads, and the read-back below compares against it.
export function storedContentType(key, kind, bytes) {
  if (kind === 'original') {
    const sniffed = detectImageType(bytes);
    if (sniffed) return sniffed;
  }
  return contentTypeFor(key);
}

// The path on disk an object of this kind is read from. Derivatives are not
// here: they come off the CDN, which is the whole point of the task.
export function localPathFor(object) {
  if (object.kind === 'original') return 'assets-source/' + object.key.slice('source/'.length);
  if (object.kind === 'menu') return 'public/' + object.key;
  throw new Error(`${object.kind} objects are fetched, not read from disk`);
}

async function downloadDerivative(key, fetchImpl) {
  // Cache-busted and Origin-carrying: the poisoned-cache variant this site has
  // shipped three times is keyed on Origin, so a fetch without it can get a
  // clean copy while a browser gets the poisoned one.
  const response = await fetchImpl(`${SITE_ORIGIN}/${encodeURI(key)}?m=${Date.now()}`, {
    headers: { Origin: SITE_ORIGIN },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from the CDN`);
  const declared = (response.headers.get('content-type') ?? '').split(';')[0].trim();
  if (declared !== 'image/webp') throw new Error(`the CDN served it as "${declared}", not image/webp`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!looksLikeWebp(bytes)) throw new Error('the bytes are not a complete RIFF WEBP');
  return bytes;
}

export async function migrate(objects, deps) {
  const { fetchImpl, readLocal, put, readBack, log } = deps;
  const done = [];
  const failed = [];

  for (const object of objects) {
    try {
      const bytes = object.kind === 'derivative'
        ? await downloadDerivative(object.key, fetchImpl)
        : await readLocal(localPathFor(object));

      const contentType = storedContentType(object.key, object.kind, bytes);
      const cacheControl = cacheControlFor(object.key);
      const digest = await sha256Hex(bytes);
      await put(object.key, bytes, { contentType, cacheControl });

      // The read-back is from img.viabiancarestaurant.com, NOT from the bucket
      // API. What is being proven is not "the PUT returned 200" -- it is "the
      // hostname the content files are about to point at answers this key with
      // these exact bytes, under this exact type". Those are different claims
      // and only the second one is the one that matters.
      const served = await readBack(object.key);
      const servedDigest = await sha256Hex(served.bytes);
      if (servedDigest !== digest) {
        failed.push({ key: object.key, kind: object.kind, reason: `digest mismatch: stored ${digest}, served ${servedDigest}` });
        continue;
      }
      if (served.contentType !== contentType) {
        failed.push({ key: object.key, kind: object.kind, reason: `served as ${served.contentType}` });
        continue;
      }
      done.push({
        key: object.key,
        bytes: bytes.length,
        sha256: digest,
        contentType,
        cacheControl,
        kind: object.kind,
        verifiedAt: new Date().toISOString(),
      });
      log(` ok  ${object.key}  ${bytes.length}B  ${digest.slice(0, 12)}`);
    } catch (error) {
      failed.push({ key: object.key, kind: object.kind, reason: error instanceof Error ? error.message : String(error) });
      log(`FAIL ${object.key}  -- ${failed[failed.length - 1].reason}`);
    }
  }

  return { done, failed };
}

// The manifest, from one run's result. Written whatever happened, and ONLY the
// objects that survived both checks carry a verifiedAt -- Task 6's rewrite
// refuses to touch a reference whose target has none, so a partial migration
// cannot become a partial rewrite.
//
// Deliberately NOT merged with an existing manifest on disk. A merge would let
// a row verified against a bucket state that no longer holds survive a run
// that could not confirm it, which is the one thing a manifest exists to make
// impossible.
export function manifestFrom({ done, failed }, now = new Date()) {
  const objects = {};
  for (const entry of done) {
    const { key, ...rest } = entry;
    objects[key] = rest;
  }
  for (const entry of failed) {
    objects[entry.key] = { kind: entry.kind, reason: entry.reason, failedAt: now.toISOString() };
  }
  return { host: IMAGE_ORIGIN, generatedAt: now.toISOString(), objects };
}

// wrangler r2 object put, one child process per object. Slower than the S3 API
// and chosen anyway: the S3 path needs an access key pair that would have to
// be created, stored and then remembered about, and this runs once.
//
// --remote IS NOT OPTIONAL. Without it wrangler writes to the LOCAL miniflare
// simulation: every PUT reports success and every read-back over HTTPS 404s.
// Task 1 Step 3's delete-then-404 check exists for the same reason.
async function putViaWrangler(key, bytes, { contentType, cacheControl }) {
  const tmp = join(tmpdir(), 'vb-' + randomUUID());
  await writeFile(tmp, bytes);
  try {
    await run('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`,
      '--file', tmp, '--content-type', contentType, '--cache-control', cacheControl, '--remote']);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function readBackOverHttps(key) {
  const response = await fetch(`${IMAGE_ORIGIN}/${encodeURI(key)}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`read-back HTTP ${response.status}`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: (response.headers.get('content-type') ?? '').split(';')[0].trim(),
  };
}

function flagValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (import.meta.filename === process.argv[1]) {
  const inventoryPath = flagValue('--inventory', 'docs/image-inventory.json');
  const manifestPath = flagValue('--manifest', 'image-manifest.json');
  // The two menu PDFs are held back for Task 19, which moves them together
  // with the upload path that writes them. --menus is how that task asks for
  // them; without it they are skipped and stay on the apex.
  const withMenus = process.argv.includes('--menus');

  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
  const objects = inventory.objects.filter((object) => withMenus || object.kind !== 'menu');

  console.log(`${objects.length} objects from ${inventoryPath}\n`);
  const result = await migrate(objects, {
    fetchImpl: fetch,
    readLocal: async (path) => new Uint8Array(await readFile(path)),
    put: putViaWrangler,
    readBack: readBackOverHttps,
    log: (line) => console.log(line),
  });

  await writeFile(manifestPath, JSON.stringify(manifestFrom(result), null, 2) + '\n');
  console.log(`\n${result.done.length} verified, ${result.failed.length} failed -> ${manifestPath}`);
  if (result.failed.length > 0) {
    for (const { key, reason } of result.failed) console.error(`  FAIL ${key}  -- ${reason}`);
    process.exit(1);
  }
}
