// The upload pipeline every photo picker in this app shares -- lifted out of
// PhotoField.tsx (Plan 5 Task 4, Step 1) so EditableImage.tsx (this task's
// other new file) can reuse it rather than re-deriving a second copy of
// HEIC conversion, the 5MB size cap, and XHR progress reporting.
// PhotoField.tsx is this module's first consumer, and its own tests stay
// completely unedited by this move -- every function here keeps the exact
// signature and behaviour it had as PhotoField.tsx's own module-private
// code; only WHERE it lives changed, not what it does. (If a PhotoField.tsx
// test had needed editing to keep passing, that would mean behaviour
// changed, not just location -- it did not.)
import { convertHeic } from './heic';
import { bytesToBase64 } from '../shared/base64';
import type { UploadCategory } from '../shared/upload-categories';

// Re-exported, not re-implemented -- EditableImage.tsx (Task 4) and
// PhotoField.tsx both need the exact same HEIC-detection-and-conversion
// step, and heic.ts's own header comment already explains why it lives in
// its own module (the one place allowed to import the 'heic-to' WASM
// decoder, gated behind a dynamic import so no bundle pays for it up
// front). Nothing about lifting the rest of the pipeline here changes any
// of that.
export { convertHeic };

// Review finding: an earlier version of this comment justified 8 staged
// photos with "8 * 5MB" -- but the only thing that actually enforced 5MB
// per photo was worker/upload.ts's MAX_UPLOAD_BYTES, which is 25MB, not
// 5MB. Nothing stopped 8 real, legitimately-sized phone photos from being
// 8 * 25MB, and 8 * 25MB * 4/3 (base64's own inflation, RFC 4648) is
// ~267MB -- over both Cloudflare's own request-body ceiling and the
// 128MB memory budget worker/upload.ts's own uploadPath comment already
// reasons about for a SINGLE photo. `checkPhotoSize` below is what makes
// "8 * 5MB" true rather than aspirational: EVERY caller of this pipeline
// refuses a photo over 5MB before it is ever staged, so every one of up to
// MAX_STAGED_PHOTOS_PER_PUBLISH staged photos really is <= 5MB by
// construction, and a publish assembling all of them (src/admin/publish.ts)
// genuinely cannot exceed 8 * 5MB * 4/3 ~= 53MB of request body. The other
// constraint is commitFiles' own subrequest budget (see worker/github.ts's
// comment on `commitFiles`): `baseSha`'s conditional read adds up to one
// more GitHub read per file on top of that function's own N + 5, for up to
// 2N + 6 subrequests against the Workers-per-invocation limit of 50 --
// roughly 22 files before a publish silently starts failing. 8 photos plus
// a handful of JSON content files stays comfortably inside both ceilings; a
// publish anywhere near 22 files would not, independent of the 53MB math.
//
// A single caller (PhotoField, EditableImage) only ever handles one photo
// at a time, so neither can enforce the CROSS-field count limit on its
// own -- MAX_STAGED_PHOTOS_PER_PUBLISH is exported so whatever assembles a
// publish across every field on the page (src/admin/publish.ts's
// buildPublishRequest) has one number to import rather than a second,
// independently-chosen one.
export const MAX_STAGED_PHOTOS_PER_PUBLISH = 8;
export const MAX_STAGED_PHOTO_BYTES = 5 * 1024 * 1024;

// Everything a caller needs to send this one staged photo back as part of
// `POST /api/publish`'s `files` array, alongside every changed JSON content
// file, in the SAME request.
export interface StagedPhoto {
  // The asset path the Worker will commit these bytes to, e.g.
  // "assets-source/food/<hash>.jpg" -- what this staged file's own `path`
  // becomes on publish.
  path: string;
  // What the RECORD's own field should store: a leading slash, then
  // food/<hash>.webp -- computed server-side by worker/upload.ts's own
  // derivativePath call, so this component never carries a second copy of
  // that naming rule.
  contentPath: string;
  // Base64, ready to become this staged file's `content` on publish.
  // Computed once here, from the exact bytes that were staged (after HEIC
  // conversion, if any happened), so a later publish never needs to re-read
  // the picked file.
  content: string;
  encoding: 'base64';
}

// Two decimals, matching worker/upload.ts's own `megabytes` -- at one
// decimal, a photo sized right at the 5MB boundary can render identically
// to the limit it just tripped, which reads as self-contradicting.
function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

// Enforced client-side, before any network call -- checked independently by
// every caller (PhotoField's initial pick AND its Retry, EditableImage's own
// pick), so a caller that skips it re-introduces the exact gap the review
// finding above closed.
export function checkPhotoSize(file: File): string | null {
  if (file.size <= MAX_STAGED_PHOTO_BYTES) return null;
  return `This photo is ${megabytes(file.size)}; photos included in one publish must be under ${megabytes(MAX_STAGED_PHOTO_BYTES)}. Try a smaller photo.`;
}

// `fetch` cannot report upload progress at all -- there is no equivalent of
// `XMLHttpRequest.upload.onprogress` anywhere in the Fetch API, and a phone
// on a weak connection uploading a multi-megabyte photo is exactly the case
// where "is this still working?" matters most. XMLHttpRequest is the only
// browser API that can answer it.
const UPLOAD_TIMEOUT_MS = 120_000;

function parseErrorMessage(xhr: XMLHttpRequest, fallback: string): string {
  try {
    const body = JSON.parse(xhr.responseText) as { message?: unknown };
    return typeof body.message === 'string' && body.message ? body.message : fallback;
  } catch {
    return fallback;
  }
}

// The one function in this module that actually talks to the network.
function uploadStaged(
  category: UploadCategory,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ path: string; contentPath: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?stage=1');
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.withCredentials = true; // same-origin already sends the session cookie, but explicit costs nothing

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { path: string; contentPath: string });
        } catch {
          reject(new Error('The server sent back something this page could not read.'));
        }
        return;
      }
      reject(new Error(parseErrorMessage(xhr, `Upload failed (status ${xhr.status}).`)));
    };

    xhr.onerror = () => reject(new Error('Could not reach the server. Check your connection and try again.'));
    // 120s (UPLOAD_TIMEOUT_MS) -- long enough that a slow-but-working
    // upload from a weak phone connection finishes, short enough that a
    // genuinely stuck request doesn't leave her staring at a spinner
    // forever with no way out except a Retry.
    xhr.ontimeout = () => reject(new Error('This is taking too long. Check your connection and try again.'));

    const form = new FormData();
    form.append('category', category);
    form.append('file', file);
    xhr.send(form);
  });
}

// Uploads an ALREADY-size-checked, already-HEIC-resolved file and encodes it
// for staging -- the shared tail of the pipeline. Kept separate from HEIC
// conversion and the size check, rather than folded into one all-in-one
// call, because BOTH real callers need to see the earlier steps as their
// own distinct moments, not one opaque call: PhotoField.tsx's Retry button
// calls exactly this on its own, skipping both HEIC conversion and the size
// check (the File it holds on a failed attempt already passed both the
// first time, and re-decoding a HEIC that already decoded fine would cost a
// second WASM round trip for nothing); EditableImage.tsx (this same task)
// calls `convertHeic` and `checkPhotoSize` itself, in between, so it can set
// its own local preview the instant a valid file is ready -- BEFORE the
// network call -- the same "she sees the photo immediately, not only once
// the server answers" timing PhotoField.tsx's own tests already pin.
export async function uploadAndEncode(
  category: UploadCategory,
  file: File,
  onProgress: (percent: number) => void,
): Promise<StagedPhoto> {
  const { path, contentPath } = await uploadStaged(category, file, onProgress);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { path, contentPath, content: bytesToBase64(bytes), encoding: 'base64' };
}
