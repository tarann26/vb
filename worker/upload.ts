// POST /api/upload -- lets the owner add a new photo straight from her
// phone. Per D4, this commits her ORIGINAL to assets-source/ and does
// nothing else to it; the existing `npm run images` pipeline (scripts/
// images.mjs) is what generates the web-sized derivative on the next
// deploy. This route's only job is getting the right bytes to the right
// path in one commit.
import { detectFormat, type Format } from '../src/shared/image-format';
import { parseCookie, verifyToken } from './auth';
import { commitFiles, DisallowedPathError, type CommitFile, type GitHubEnv } from './github';

// A minimal env shape rather than importing worker/index.ts's `Env`:
// importing it here would make index.ts and upload.ts import from each
// other. `Env` (index.ts) is structurally assignable to this -- it extends
// GitHubEnv and always carries TOKEN_SECRET -- so index.ts can still call
// handleUpload(request, env) with its real env unchanged.
export type UploadEnv = GitHubEnv & { TOKEN_SECRET: string };

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// The seven directories that exist under assets-source/ today (see that
// directory itself). Hardcoded, not read off disk: this Worker has no
// filesystem to read from at request time, and an allowlist that can only
// ever shrink or grow by a code change -- never by whatever a request
// happens to name -- is the same posture github.ts's own path allowlist
// takes for the same reason (commitFiles' ASSET_PATH regex would accept any
// lowercase/underscore/hyphen segment here as a "category", so this is the
// thing that actually keeps a request from inventing an eighth one).
const CATEGORIES = new Set(['atmosphere', 'food', 'hero', 'mocktails', 'our_story', 'press', 'team']);

// The canonical extension `uploadPath` writes for each detected format --
// never the extension the uploaded filename happened to have (see that
// function's own comment). `heic` is included only so this `Record` stays
// exhaustive over every `Format` member; the route below rejects a HEIC
// upload (Step 4) before uploadPath is ever called with one, so this entry
// is unreachable in practice today, not a live path.
const EXT: Record<Format, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  tiff: 'tiff',
  gif: 'gif',
  heic: 'heic',
};

// ---------------------------------------------------------------------------
// Content-addressed upload paths.
//
// The stem is the first 12 hex characters of the photo's own SHA-256, never
// the filename the phone or browser supplied, for two independent reasons
// (both real failure modes, not theoretical):
//
//  1. Collisions break the entire image build. `IMG_1234.jpg` and
//     `IMG_1234.png` both map to `public/<category>/IMG_1234.webp` --
//     iPhone filenames collide constantly -- and scripts/paths.mjs's
//     findCollisions() makes `build()` write NOTHING and exit 1 the moment
//     that happens, so `npm run images` fails, every deploy fails, and she
//     cannot publish anything at all until a developer deletes a file.
//     Uploading the same photo twice under its original name would also
//     silently overwrite whatever was there before. A content hash makes
//     two different photos collide only in the astronomically unlikely
//     SHA-256-collision sense, and makes uploading the same photo twice
//     idempotent (the second upload commits the identical path -- see
//     worker/__tests__/upload.test.ts) rather than a silent overwrite or a
//     duplicate file.
//  2. A guessable name leaks unpublished content. `public/` is copied
//     verbatim to the live site, so a future-dated item's photo would stay
//     fetchable at its URL even while the item itself is filtered out of
//     the build. A generic, unpredictable name is what makes that harmless.
//
// The extension likewise comes from `detectFormat`, never from the
// filename: scripts/paths.mjs's IMAGE_EXT (what listSources() filters by)
// only recognizes real image extensions, so a missing or wrong one means
// the file is silently invisible to the build -- never encoded, its
// derivative never created, and the build fails later on the missing
// public/ asset with no mention of why this specific upload caused it.
export function uploadPath(category: string, bytes: Uint8Array, format: Format): string {
  return `assets-source/${category}/${sha256Hex(bytes).slice(0, 12)}.${EXT[format]}`;
}

// ---------------------------------------------------------------------------
// A from-scratch, synchronous SHA-256 (FIPS 180-4). Not `crypto.subtle
// .digest`: uploadPath above is a plain synchronous function on purpose (a
// composable path-builder, not something every caller has to `await`
// through), and SubtleCrypto's digest is inherently Promise-based -- there
// is no synchronous Web Crypto hash to call instead. This is the same
// category of trade-off as this file's neighbour worker/auth.ts hand-rolling
// `timingSafeEqual` because the Cloudflare-only `crypto.subtle
// .timingSafeEqual` doesn't exist in this repo's test environment: the
// built-in API's shape doesn't fit a real constraint, so this is a
// deliberately small, standard, heavily-tested substitute rather than a
// dependency.
//
// Verified against `crypto.subtle.digest('SHA-256', ...)` for 14 buffer
// sizes spanning and straddling the 64-byte block boundary (0, 1, 2, 55,
// 56, 57, 63, 64, 65, 100, 1000, 65536, 1000000, 5000001 bytes) plus the
// FIPS 180-4 test vectors for the empty string and "abc" -- see
// worker/__tests__/upload.test.ts's `sha256Hex` block. A 25MB buffer (this
// route's own size cap) hashes in well under 200ms on ordinary hardware --
// a real, one-off, owner-initiated action, not a per-request hot path like
// worker/auth.ts's PBKDF2, so the Workers CPU-time budget that shapes that
// file's iteration count isn't the same kind of concern here.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(data: Uint8Array): string {
  const h = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  // Pad: the message, then a single 1-bit (0x80), then zero bits, then the
  // original bit length as a big-endian 64-bit integer, out to a multiple
  // of 64 bytes.
  const bitLength = data.length * 8;
  const paddedLength = Math.ceil((data.length + 1 + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  // Splitting the 64-bit length into two 32-bit halves this way is exact
  // for any file this route will ever see (the 25MB cap is nowhere near
  // Number's safe-integer ceiling), unlike a BigInt shift that would be
  // needed for a truly unbounded input.
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + bigS1 + ch + SHA256_K[i] + w[i]) | 0;
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigS0 + maj) | 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }

  return Array.from(h)
    .map((n) => (n >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Binary -> base64, for the `content` field commitFiles sends GitHub's blob
// API. Deliberately NOT worker/auth.ts's byte-by-byte `bytesToBase64`
// (`binary += String.fromCharCode(byte)` in a loop): that function only
// ever encodes small, fixed-size values (a 16-byte salt, a 32-byte HMAC
// digest), where a per-byte loop is fine. A photo can be up to 25MB, and a
// per-byte loop over 25 million bytes is the wrong shape for that --
// `String.fromCharCode(...chunk)` in bounded chunks converts many bytes per
// call instead of one, which is both far fewer calls and avoids the
// call-stack-argument limit a single `String.fromCharCode(...allBytes)`
// would risk on a large file.
const BASE64_CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function handleUpload(request: Request, env: UploadEnv): Promise<Response> {
  // 1. Verify token first and unconditionally, exactly like handlePublish
  // (worker/index.ts) -- nothing below this line runs, and in particular no
  // GitHub call happens, for an unauthenticated request.
  const token = parseCookie(request.headers.get('Cookie'), 'vb_session');
  const now = Math.floor(Date.now() / 1000);
  if (!token || !(await verifyToken(env.TOKEN_SECRET, token, now))) {
    return json(401, { message: 'Not authenticated.' });
  }

  // 2. Size, checked from the Content-Length header BEFORE the body is ever
  // read into memory -- request.formData() below buffers the entire
  // multipart body, and a Worker has real memory limits. Every real
  // multipart upload a browser sends carries this header (it can compute a
  // Blob's exact size before sending), so this is the common case; it is
  // still only a best-effort pre-check, not the only guard -- see the
  // post-read check in step 4, which is what actually protects against a
  // missing or understated header.
  const contentLengthHeader = request.headers.get('Content-Length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
      return json(413, { message: `This photo is ${megabytes(contentLength)}; the limit is 25MB.` });
    }
  }

  // 3. Parse the multipart body.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json(400, { message: 'Could not read the upload.' });
  }

  const categoryField = formData.get('category');
  if (typeof categoryField !== 'string' || !CATEGORIES.has(categoryField)) {
    return json(400, {
      message:
        typeof categoryField === 'string'
          ? `Unknown category "${categoryField}".`
          : 'A category is required.',
    });
  }
  const category = categoryField;

  const fileField = formData.get('file');
  if (!(fileField instanceof Blob)) {
    return json(400, { message: 'No photo was attached.' });
  }

  const bytes = new Uint8Array(await fileField.arrayBuffer());

  // 4. The post-read size check: the real safety net. Covers a request
  // whose Content-Length was absent, wrong, or (deliberately or not)
  // understated -- step 2 only catches the common case where the header is
  // present and honest.
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return json(413, { message: `This photo is ${megabytes(bytes.length)}; the limit is 25MB.` });
  }

  // 5. Format, from bytes -- never from `fileField.name` or its declared
  // MIME type, both of which are exactly the "extensions lie" problem this
  // task exists to solve (see src/shared/image-format.ts's own comment).
  const format = detectFormat(bytes);
  if (format === null) {
    return json(400, { message: 'Could not recognize this file as a supported image format.' });
  }
  // HEIC arriving here is a bug, not a user error to word gently around:
  // Task 9 converts a picked HEIC file to JPEG in her own browser before it
  // is ever uploaded, so a HEIC file reaching this route means that
  // conversion didn't happen.
  if (format === 'heic') {
    return json(400, {
      message: 'This photo is HEIC. Convert it before upload -- most phones can save a JPEG copy instead.',
    });
  }

  // 6. Commit. uploadPath's stem is content-addressed (see that function's
  // own comment), never derived from `fileField.name`.
  const path = uploadPath(category, bytes, format);
  const file: CommitFile = { path, content: bytesToBase64(bytes), encoding: 'base64' };

  try {
    const { sha } = await commitFiles(env, [file], `Add photo to ${category}`);
    return json(200, { sha, path });
  } catch (error) {
    if (error instanceof DisallowedPathError) {
      return json(400, { message: error.message });
    }
    return json(502, { message: error instanceof Error ? error.message : 'Upload failed.' });
  }
}
