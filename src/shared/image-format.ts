// Detects an image's real format from its first bytes, never from a
// filename or a declared Content-Type -- both are attacker- or
// user-controlled and both lie in this repository today:
// `assets-source/atmosphere/dining.jpg` is PNG data with a `.jpg` name (see
// scripts/paths.mjs's OG_SOURCE, which reads it anyway because sharp sniffs
// content), and an iPhone hands out `.HEIC` for a file that is sometimes
// actually AVIF-flavoured HEIF. `detectFormat` is the one place both the
// Worker (worker/upload.ts, committing a photo she just took) and the admin
// bundle (Task 9's browser-side HEIC conversion, deciding whether a picked
// file needs converting before it is even uploaded) agree on what a file
// really is.
//
// Lives here, not under worker/, on purpose: worker/ is typed against
// tsconfig.worker.json (`@cloudflare/workers-types`), and Task 9's import
// happens from the client bundle (tsconfig.app.json). A function under
// worker/ imported from src/ would drag a Worker-only tsconfig project
// across that boundary for no reason -- this function only ever touches a
// `Uint8Array`, nothing Worker- or DOM-specific, so it belongs in neither
// project's exclusive territory.
//
// Deliberately does NOT take a filename parameter. A filename only exists
// once there's an HTTP request carrying one (the multipart upload's
// declared name, or a picked File's `.name`) -- testing "ignores a lying
// filename" here would be testing a parameter that doesn't exist. That
// property belongs, and is tested, at the call site instead (see
// worker/__tests__/upload.test.ts).
export type Format = 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff' | 'gif' | 'heic';

// HEIC and AVIF are both ISO Base Media File Format ("ftyp box") containers
// -- identical structurally -- and differ only in the 4-byte brand at bytes
// 8-11. Getting this brand set wrong in either direction is the single most
// consequential bug this file can contain: too narrow and every real iPhone
// photo (which emits `heic` for the photo itself and `mif1` as the general
// HEIF brand -- both used in practice) gets silently rejected as "unknown
// format" with no image ever uploaded; too wide and an AVIF file gets
// classified as HEIC and handed to a converter (Task 9) that cannot read it.
const HEIC_BRANDS = new Set(['heic', 'mif1']);
const AVIF_BRANDS = new Set(['avif']);

function matchesBytesAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[offset + i] !== expected[i]) return false;
  }
  return true;
}

// ASCII only -- every magic string this file looks for (GIF's version tag,
// RIFF/WEBP/WAVE, ftyp box types and ISO-BMFF brands) is plain ASCII, so
// this never needs to handle multi-byte characters.
function asciiAt(bytes: Uint8Array, offset: number, length: number): string | null {
  if (bytes.length < offset + length) return null;
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

export function detectFormat(bytes: Uint8Array): Format | null {
  if (matchesBytesAt(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (matchesBytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';

  // TIFF: little-endian ("II", then 42 as uint16-LE) or big-endian ("MM",
  // then 42 as uint16-BE). Both byte orders are real -- which one a given
  // camera or scanner writes is not something a consumer can predict.
  if (matchesBytesAt(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) || matchesBytesAt(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'tiff';
  }

  const gifTag = asciiAt(bytes, 0, 6);
  if (gifTag === 'GIF89a' || gifTag === 'GIF87a') return 'gif';

  // RIFF containers: 'RIFF', 4 bytes of chunk size (ignored -- not needed to
  // tell WebP from anything else), then a 4-byte form type at offset 8.
  // WAVE (audio) uses the exact same 'RIFF' prefix, so the form type at
  // offset 8 is the only thing that actually distinguishes a WebP image
  // from a WAV file wearing the same container.
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return 'webp';

  // ISO-BMFF: a 4-byte box size, then 'ftyp', then a 4-byte major brand at
  // offset 8 -- see the HEIC_BRANDS/AVIF_BRANDS comment above for why the
  // brand, and only the brand, decides HEIC vs AVIF here.
  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4);
    if (brand && HEIC_BRANDS.has(brand)) return 'heic';
    if (brand && AVIF_BRANDS.has(brand)) return 'avif';
  }

  return null;
}
