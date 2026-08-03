// POST /api/upload -- lets the owner add a new photo straight from her
// phone. Per D4, this commits her ORIGINAL to assets-source/ and does
// nothing else to it; the existing `npm run images` pipeline (scripts/
// images.mjs) is what generates the web-sized derivative on the next
// deploy. This route's only job is getting the right bytes to the right
// path in one commit.
import { detectFormat, type Format } from '../src/shared/image-format';
import { derivativePath } from '../src/shared/derivative-path';
import { bytesToBase64 } from '../src/shared/base64';
import { UPLOAD_CATEGORIES } from '../src/shared/upload-categories';
import { parseCookie, verifyToken } from './auth';
import { commitFiles, DisallowedPathError, type CommitFile, type GitHubEnv } from './github';

// A minimal env shape rather than importing worker/index.ts's `Env`:
// importing it here would make index.ts and upload.ts import from each
// other. `Env` (index.ts) is structurally assignable to this -- it extends
// GitHubEnv and always carries TOKEN_SECRET -- so index.ts can still call
// handleUpload(request, env) with its real env unchanged.
export type UploadEnv = GitHubEnv & { TOKEN_SECRET: string };

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// The one place that actually ENFORCES src/shared/upload-categories.ts's
// list -- commitFiles' ASSET_PATH regex (worker/github.ts) would accept any
// lowercase/underscore/hyphen segment here as a "category", so this Set is
// the thing that actually keeps a request from inventing an eighth one.
const CATEGORIES: Set<string> = new Set(UPLOAD_CATEGORIES);

// `category=menu` (handleMenuUpload, below) is deliberately NOT a ninth
// member of UPLOAD_CATEGORIES/CATEGORIES: that list is specifically the
// assets-source/<category>/ subfolders a photo can land in, and a menu PDF
// commits to an entirely different tree (public/menus/, not assets-source/)
// under commitFiles' own MENU_PATH shape (worker/github.ts), not ASSET_PATH.
// Folding "menu" into the same Set would let commitFiles' ASSET_PATH regex
// -- which accepts any `[a-z0-9_-]+` category segment -- start matching
// `assets-source/menu/...` too, a directory this route never actually
// writes to and no test would catch drifting out of sync with reality.
//
// A menu's file name is chosen, not content-addressed -- see uploadPath's
// own comment just below for why that's wrong for a photo, and why it's
// exactly backwards for a menu (replacing the PDF under the same name must
// NOT produce a new path, or every replacement would force a menus.json
// edit). `/^[a-z0-9-]{1,64}$/` matches this repo's real menu ids today
// (food, drinks) and is intentionally narrower than a filename ever needs
// to be: nothing about a menu's name is ever an original upload filename
// the way PhotoField's picked file names are, so there is no space, mixed
// case, or punctuation a legitimate write here needs to admit. The `{1,64}`
// bound (review finding: neither this nor MENU_PATH capped length before)
// keeps a pathologically long name from reaching GitHub's own ~255-byte
// path-component ceiling, where it would otherwise surface as an opaque
// 502 ("could not build the tree (GitHub returned 422)") instead of this
// route's own clear message -- matched by MENU_PATH's identical bound
// (worker/github.ts) so the two stay in sync.
const MENU_NAME_PATTERN = /^[a-z0-9-]{1,64}$/;

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
//
// Async, using the real `crypto.subtle.digest`, not a hand-rolled
// synchronous SHA-256 -- an earlier version of this function had one, kept
// synchronous only so it matched this task's brief literally. A security
// review correctly called that the wrong trade: the hand-rolled version
// allocated a second, padded copy of the input (at the 25MB cap, that's a
// real extra allocation inside a 128MB Workers isolate already holding the
// multipart body, the raw bytes, and a base64 copy of it), bought nothing in
// return (hashing an occasional owner-initiated upload is not a
// CPU-budget-sensitive hot path either way), and re-implemented a primitive
// the platform already provides correctly and natively. `commitFiles`
// (called from `handleUpload`, an already-async handler) is the only real
// caller, so there was never a genuine synchronous-composition need this
// was buying.
export async function uploadPath(category: string, bytes: Uint8Array, format: Format): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `assets-source/${category}/${hex.slice(0, 12)}.${EXT[format]}`;
}

// ---------------------------------------------------------------------------
// A second, cheap check for whether a file's *end* is where a well-formed
// file of its detected format would put it. `detectFormat` only reads the
// first dozen-ish bytes; a photo cut off mid-transfer (a flaky connection, a
// browser tab killed mid-upload) can carry a perfectly valid header and then
// just stop. Reaching assets-source/ that way isn't merely cosmetic:
// scripts/images.mjs's `build()` calls sharp on every source, and a
// truncated file makes sharp fail with "premature end of JPEG image" or
// similar -- Fix (2) in that file keeps one such failure from taking the
// whole build down, but she would still get no useful signal until the next
// deploy quietly skipped her photo. Catching it here, before the commit,
// lets her be told immediately, with the actual file still in hand to
// retry.
//
// Deliberately narrower than full format validation: only the formats with
// a cheap, well-defined end-of-file marker get a check (JPEG's EOI marker,
// PNG's IEND chunk, GIF's trailer byte, RIFF's declared chunk size). AVIF
// and TIFF have no equally cheap trailer to check -- and TIFF in particular
// can be perfectly well-formed structurally and still be undecodable:
// iPhone ProRAW writes DNG, which carries valid TIFF magic bytes
// (`detectFormat` correctly reports `'tiff'`) and a fully intact,
// untruncated structure, yet sharp still can't decode it, because DNG's
// pixel data isn't what a plain TIFF reader expects. That isn't truncation,
// so no trailer check catches it -- it is exactly the case
// scripts/images.mjs's build()-level skip (Fix 2) exists to catch instead,
// downstream, without taking the whole build down over it.
function looksComplete(bytes: Uint8Array, format: Format): boolean {
  switch (format) {
    case 'jpeg':
      return bytes.length >= 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    case 'png':
      return containsAscii(bytes, 'IEND');
    case 'gif':
      return bytes.length >= 1 && bytes[bytes.length - 1] === 0x3b;
    case 'webp': {
      // RIFF's declared chunk size (bytes 4-7, little-endian) is the byte
      // count of everything AFTER the 8-byte "RIFF"+size header itself, so
      // a well-formed file's total length is exactly that plus 8.
      if (bytes.length < 8) return false;
      const declaredChunkSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
      return declaredChunkSize + 8 === bytes.length;
    }
    default:
      // avif/tiff/heic: no cheap trailer check exists -- see this
      // function's own comment above for why that's a deliberate boundary,
      // not an oversight.
      return true;
  }
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const target = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= bytes.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

function startsWithAscii(bytes: Uint8Array, needle: string): boolean {
  const target = new TextEncoder().encode(needle);
  if (bytes.length < target.length) return false;
  for (let i = 0; i < target.length; i++) {
    if (bytes[i] !== target[i]) return false;
  }
  return true;
}

// The direct analogue of `looksComplete` above, for `category=menu`
// (handleMenuUpload, below): a PDF isn't one of `Format`'s members, so it
// never reaches that function at all, and without a check of its own here
// it would fall into exactly the gap that function's `default: return true`
// leaves for avif/tiff/heic -- except a menu PDF has no scripts/images.mjs
// downstream to catch a truncated one later. If it reaches the repo broken,
// the printed menu on the live site is broken too, and she has no way to
// remove it herself.
//
// Both halves are cheap, well-defined markers of a real PDF, the same shape
// as JPEG's EOI marker or PNG's IEND chunk above: `%PDF-` is the format's
// own required file-header signature at the very first byte, and `%%EOF`
// is the marker every well-formed PDF's trailer ends with. Checked "within
// the last 1KB", not "the literal last five bytes" -- a real PDF's trailer
// dictionary and `startxref` line sit just before that marker, so the
// exact byte offset varies slightly file to file, but never by anywhere
// near 1KB in a genuinely complete one. A `%%EOF` appearing thousands of
// bytes earlier and nowhere near the file's actual end is exactly the
// signature of a truncated upload, not a false rejection of a good one.
function looksCompletePdf(bytes: Uint8Array): boolean {
  if (!startsWithAscii(bytes, '%PDF-')) return false;
  const tailStart = Math.max(0, bytes.length - 1024);
  return containsAscii(bytes.subarray(tailStart), '%%EOF');
}

// public/menus/<name>.pdf -- deliberately NOT content-addressed like
// uploadPath above. uploadPath's own comment explains why a hash is right
// for a photo (collision-proof, and a guessable name can't leak an
// unpublished item); both reasons are absent here (there is only ever one
// live file per menu id, and every downloadable menu is meant to be
// public), and a hash would actively break the one property this route
// exists for: replacing the PDF under an unchanged `name` must commit to
// the SAME path every time, so menus.json's own `file` field never needs
// to change just because she swapped in an updated PDF.
function menuAssetPath(name: string): string {
  return `public/menus/${name}.pdf`;
}

// What menus.json's own `file` field stores for this upload. `public/` is
// the site's web root (Cloudflare Pages serves it verbatim at `/`), so this
// is menuAssetPath's own result with that one leading segment dropped and
// the leading slash kept -- computed here, once, so PdfField.tsx never
// carries a second copy of that rule, the same reason derivativePath exists
// for a photo's contentPath.
function menuFilePath(name: string): string {
  return `/menus/${name}.pdf`;
}

// ---------------------------------------------------------------------------
// `bytesToBase64` (the `content` field commitFiles sends GitHub's blob API,
// and Task 5's staged-upload response body below) now lives in
// src/shared/base64.ts -- PhotoField.tsx (the browser side of Task 5) needs
// the exact same chunked encoding to keep a staged photo's bytes around for
// its eventual `POST /api/publish`, and a second, independently-written copy
// of the chunking logic is exactly the kind of thing that could silently
// drift out of sync with this one. Deliberately NOT worker/auth.ts's
// byte-by-byte `bytesToBase64` (`binary += String.fromCharCode(byte)` in a
// loop) either way: that function only ever encodes small, fixed-size values
// (a 16-byte salt, a 32-byte HMAC digest), where a per-byte loop is fine. A
// photo can be up to 25MB, and a per-byte loop over 25 million bytes is the
// wrong shape for that.

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Two decimals, not one: at "1.0MB" of precision, a 25.00MB upload and the
// 25MB limit it just tripped can render close enough to look identical,
// which reads as a self-contradicting error rather than useful guidance on
// how much to shrink the file.
function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
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
  // missing or understated header. Worded "This upload", not "This photo":
  // Content-Length at this point is the whole multipart request (the photo
  // plus its envelope and the `category` field), not the photo alone, so
  // calling it "the photo" here would overstate its size by a few dozen
  // bytes -- small in absolute terms, but exactly the kind of thing that
  // makes "This photo is 25.00MB; the limit is 25MB" read as a contradiction
  // to someone trying to figure out how much to shrink it.
  const contentLengthHeader = request.headers.get('Content-Length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
      return json(413, { message: `This upload is ${megabytes(contentLength)}; the limit is 25MB.` });
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
  if (typeof categoryField !== 'string') {
    return json(400, { message: 'A category is required.' });
  }

  // A downloadable menu PDF, not a photo -- an entirely different
  // validation shape (no detectFormat, a required `name`, a PDF-specific
  // completeness check) and an entirely different commit path
  // (public/menus/, not assets-source/<category>/), so it branches off
  // here, before `category` is checked against CATEGORIES at all. See
  // handleMenuUpload's own comment for why 'menu' is deliberately not a
  // member of that Set.
  if (categoryField === 'menu') {
    return handleMenuUpload(formData, request, env);
  }

  if (!CATEGORIES.has(categoryField)) {
    return json(400, { message: `Unknown category "${categoryField}".` });
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

  // 5b. Truncation/completeness -- see looksComplete's own comment for
  // exactly what this does and does not catch. A file that fails this is
  // structurally broken in a way sharp will refuse to encode later; better
  // she hears that now, with the file still in hand to re-upload, than in a
  // deploy that quietly skips it (scripts/images.mjs Fix 2) with no
  // connection back to this specific upload.
  if (!looksComplete(bytes, format)) {
    return json(400, { message: 'This photo looks incomplete or corrupted. Try uploading it again.' });
  }

  // 6. uploadPath's stem is content-addressed (see that function's own
  // comment), never derived from `fileField.name`.
  const path = await uploadPath(category, bytes, format);

  // 7. Task 5: `?stage=1` stops HERE, before any commit -- every check
  // above (size, format, HEIC, completeness) has already run, so a staged
  // upload is exactly as validated as a committing one always was. Without
  // this, every photo she adds is its own commit: twelve photos means
  // twelve commits, Cloudflare Pages builds on each one, and cancels every
  // build a later push supersedes before it finishes -- GET
  // /api/build-status (worker/status.ts's mapDeploymentState) correctly
  // reports a cancelled build as `failed`, so she would see eleven failures
  // for eleven photos that all landed fine. The natural response to a
  // reported failure is to retry, which burns a second build per retry
  // against Cloudflare Pages Free's 500-build/month cap for photos that
  // never actually failed.
  //
  // Returns the same content-addressed `path` a commit would have used (so
  // retrying a dropped connection re-derives the identical path and costs
  // nothing extra at publish time) plus `contentPath` -- derivativePath's
  // `/food/<hash>.webp`, the exact string dishes.json/drinks.json/press.json
  // store -- computed once, here, so the browser never carries its own copy
  // of the source-to-derivative naming rule. The bytes themselves are not
  // echoed back: the browser already has them (it just sent them) and is
  // what keeps them until `POST /api/publish` -- see PhotoField.tsx.
  const url = new URL(request.url);
  if (url.searchParams.get('stage') === '1') {
    return json(200, { path, contentPath: derivativePath(path) });
  }

  // 8. Every OTHER request (no `?stage=1`) still commits on its own, exactly
  // as before Task 5 -- kept for this route's own direct-commit tests and
  // any future caller that isn't staging into a publish at all.
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

// The `category=menu` branch handleUpload delegates to above, once
// `formData` is already parsed and the pre-read Content-Length check (step
// 2 above, which runs before `category` is even read) has already passed.
// Kept as its own function rather than interleaved with the image branch:
// almost nothing is shared between them (no detectFormat, no HEIC, no EXT
// table, a different completeness check, a required `name`, a NAMED rather
// than content-addressed path), so writing this as a run of early returns
// inside handleUpload would make neither branch's own shape easy to read.
async function handleMenuUpload(formData: FormData, request: Request, env: UploadEnv): Promise<Response> {
  // A. `name`, checked before the file is even read -- cheap, and the exact
  // wording this task's brief specifies verbatim.
  const nameField = formData.get('name');
  if (typeof nameField !== 'string' || !MENU_NAME_PATTERN.test(nameField)) {
    return json(400, { message: 'A menu name can only use lowercase letters, numbers and hyphens.' });
  }
  const name = nameField;

  const fileField = formData.get('file');
  if (!(fileField instanceof Blob)) {
    return json(400, { message: 'No PDF was attached.' });
  }

  const bytes = new Uint8Array(await fileField.arrayBuffer());

  // B. The post-read size check -- identical reasoning to handleUpload's
  // own step 4: the pre-read Content-Length check already ran, before
  // `formData` was ever parsed, and covers the common case; this is the
  // real safety net for a missing or understated header.
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return json(413, { message: `This PDF is ${megabytes(bytes.length)}; the limit is 25MB.` });
  }

  // C. No detectFormat: a PDF isn't one of image-format.ts's Format
  // members, and that module exists to answer for image bytes only.
  // looksCompletePdf is both the format check and the completeness check at
  // once -- real PDF bytes start with `%PDF-` and end with `%%EOF` within
  // the last 1KB; anything else (an image picked under category=menu by
  // mistake, a non-PDF file, a genuinely truncated PDF) fails it the same
  // way a menu picked under an image category fails detectFormat: refused,
  // never silently accepted by the wrong route.
  if (!looksCompletePdf(bytes)) {
    return json(400, { message: 'This PDF looks incomplete or corrupted. Try uploading it again.' });
  }

  const path = menuAssetPath(name);
  const menuFile = menuFilePath(name);

  // D. Task 5's `?stage=1` contract, unchanged for this branch: every check
  // above has already run, so a staged menu upload is exactly as validated
  // as a committing one always was, and it joins the SAME single publish a
  // JSON edit to menus.json would -- see this task's brief on why the two
  // must travel together.
  const url = new URL(request.url);
  if (url.searchParams.get('stage') === '1') {
    return json(200, { path, file: menuFile });
  }

  // E. Every OTHER request (no `?stage=1`) still commits on its own, the
  // same direct-commit fallback handleUpload's own image branch keeps.
  const commitFile: CommitFile = { path, content: bytesToBase64(bytes), encoding: 'base64' };

  try {
    const { sha } = await commitFiles(env, [commitFile], `Update menu PDF: ${name}`);
    return json(200, { sha, path });
  } catch (error) {
    if (error instanceof DisallowedPathError) {
      return json(400, { message: error.message });
    }
    return json(502, { message: error instanceof Error ? error.message : 'Upload failed.' });
  }
}
