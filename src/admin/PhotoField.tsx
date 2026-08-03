import { useEffect, useRef, useState } from 'react';
import { convertHeic } from './heic';
import { bytesToBase64 } from '../shared/base64';
import type { UploadCategory } from '../shared/upload-categories';
import type { ValidationProblem } from '../content/validate';

// Everything a caller (eventually Task 10's publish assembly) needs to send
// this one staged photo back as part of `POST /api/publish`'s `files`
// array, alongside every changed JSON content file, in the SAME request --
// the whole point of Task 5's `?stage=1` change to worker/upload.ts.
export interface StagedPhoto {
  // The asset path the Worker will commit these bytes to, e.g.
  // "assets-source/food/<hash>.jpg" -- what this staged file's own `path`
  // becomes on publish.
  path: string;
  // What the RECORD's own field should store: a leading slash, then
  // food/<hash>.webp -- computed server-side by worker/upload.ts's own
  // derivativePath call, so this component never carries a second copy of
  // that naming rule. Deliberately not spelled out above as a single quoted
  // literal (a quote, then a leading slash, then an image extension, then
  // the closing quote) -- see src/shared/derivative-path.ts's own top
  // comment for why that exact shape fails src/content/__tests__/assets.test.ts,
  // and why this sentence is phrased around it instead.
  contentPath: string;
  // Base64, ready to become this staged file's `content` on publish.
  // Computed once here, from the exact bytes that were staged (after HEIC
  // conversion, if any happened), so a later publish never needs to re-read
  // the picked file.
  content: string;
  encoding: 'base64';
}

export interface PhotoFieldProps {
  id: string;
  label: string;
  help?: string;
  category: UploadCategory;
  // The record's own current value for this field: a `contentPath` from an
  // earlier upload, a legacy hand-authored path, or null (Drink.image's own
  // "no photo" state -- see fields.ts's DRINK_FIELDS.image help text).
  value: string | null;
  onChange: (contentPath: string | null) => void;
  // Fires once a photo finishes staging, so a caller collects the bytes
  // this component is not itself responsible for sending -- and fires with
  // `null` the moment a NEW pick starts, so a caller drops whatever it
  // previously collected for this field before it goes stale (picking a
  // second photo, or retrying after a failure, must not leave two staged
  // uploads fighting over the same field).
  onStaged?: (staged: StagedPhoto | null) => void;
  problems: ValidationProblem[];
}

// Task 5's own arithmetic for why a PUBLISH (not a single upload -- this
// route's own MAX_UPLOAD_BYTES, worker/upload.ts, already caps one photo at
// 25MB) is capped at 8 staged photos. A single PhotoField only ever holds
// one photo, so it cannot enforce a cross-field limit on its own -- this is
// exported so whatever DOES assemble a publish across every PhotoField on
// the page (Task 10's publish.ts, not built yet) has one number to import
// rather than a second, independently-chosen one.
//
// `POST /api/publish` sends every staged photo's bytes as base64, which
// inflates the original binary size by 4/3x (RFC 4648's own overhead): 8
// photos at 5MB each -- a realistic size for one phone photo, well under
// this route's own 25MB per-file ceiling -- is 8 * 5MB * 4/3 ~= 53MB of
// JSON request body. The other constraint is commitFiles' own subrequest
// budget (see worker/github.ts's comment on `commitFiles`): `baseSha`'s
// conditional read adds up to one more GitHub read per file on top of that
// function's own N + 5, for up to 2N + 6 subrequests against the
// Workers-per-invocation limit of 50 -- roughly 22 files before a publish
// silently starts failing. 8 photos plus a handful of JSON content files
// stays comfortably inside both ceilings; a publish anywhere near 22 files
// would not, independent of the 53MB math.
export const MAX_STAGED_PHOTOS_PER_PUBLISH = 8;

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

// The one function in this file that actually talks to the network, kept
// separate from the component so the component's own state machine (below)
// reads as "what happens for each event this can raise", not interleaved
// with XHR's callback-based API.
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
    // forever with no way out except the Retry button below.
    xhr.ontimeout = () => reject(new Error('This is taking too long. Check your connection and try again.'));

    const form = new FormData();
    form.append('category', category);
    form.append('file', file);
    xhr.send(form);
  });
}

type Status =
  | { kind: 'idle' }
  | { kind: 'converting' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'staged' }
  // Keeps the (possibly HEIC-converted) File around so Retry resubmits the
  // IDENTICAL bytes without asking her to re-pick the photo -- uploadPath
  // (worker/upload.ts) is content-addressed, so resubmitting the same bytes
  // after a dropped connection is a genuine no-op, not a second photo.
  | { kind: 'error'; message: string; file: File };

function statusMessage(status: Status): string | null {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'converting':
      return 'Converting photo…';
    case 'uploading':
      return `Uploading… ${status.percent}%`;
    case 'staged':
      return 'Uploaded — publish to make it live.';
    case 'error':
      return status.message;
  }
}

const INPUT_CLASSNAME = 'block w-full text-sm text-[#222] file:mr-3 file:rounded file:border-0 file:bg-[#6B8B59] file:px-3 file:py-1.5 file:font-[\'Montserrat\'] file:text-xs file:uppercase file:tracking-wide file:text-white hover:file:bg-[#5a7349]';
const LABEL_CLASSNAME = "mb-1 block font-['Montserrat'] text-sm uppercase tracking-wide text-[#6B8B59]";
const RETRY_BUTTON_CLASSNAME =
  "mt-2 rounded border border-red-300 px-3 py-1 font-['Montserrat'] text-xs uppercase tracking-wide text-red-600 transition hover:bg-red-600 hover:text-white";

function PhotoField({ id, label, help, category, value, onChange, onStaged, problems }: PhotoFieldProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Object URLs are only released by the browser when explicitly revoked --
  // leaving one around after this field unmounts (a different record
  // loaded, or she navigates away) leaks the blob for the rest of the page
  // session.
  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  async function upload(file: File) {
    setStatus({ kind: 'uploading', percent: 0 });
    try {
      const { path, contentPath } = await uploadStaged(category, file, (percent) =>
        setStatus({ kind: 'uploading', percent }),
      );
      const bytes = new Uint8Array(await file.arrayBuffer());
      onStaged?.({ path, contentPath, content: bytesToBase64(bytes), encoding: 'base64' });
      onChange(contentPath);
      setStatus({ kind: 'staged' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Upload failed.', file });
    }
  }

  async function handlePick(fileList: FileList | null) {
    const picked = fileList?.[0];
    if (!picked) return;

    // Whatever was staged before (from an earlier pick on this same field)
    // is no longer the current candidate the instant a new one is picked --
    // told to the caller BEFORE the new upload starts, not after it
    // resolves, so a publish assembled in the gap between the two never
    // sees two staged uploads claiming the same field.
    onStaged?.(null);

    setStatus({ kind: 'converting' });
    let file: File;
    try {
      file = await convertHeic(picked);
    } catch (error) {
      // heicTo (heic.ts's dynamic import) can genuinely fail -- a network
      // blip fetching the WASM decoder, or a HEIC the decoder can't parse.
      // Left unguarded, this would reject `handlePick`'s own promise with
      // nothing awaiting it (it's invoked as `void handlePick(...)` below),
      // an unhandled rejection that leaves the field stuck on "Converting
      // photo…" forever with no way out. Falls back to retrying the
      // ORIGINAL picked file -- plausible for a transient failure like a
      // dropped WASM fetch, and no worse than being stuck if it isn't.
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not read that photo. Try a different one.',
        file: picked,
      });
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreviewUrl(url);

    await upload(file);
  }

  function retry() {
    if (status.kind === 'error') void upload(status.file);
  }

  const helpId = help ? `${id}-help` : undefined;
  const errorId = problems.length > 0 ? `${id}-error` : undefined;
  const message = statusMessage(status);
  const statusId = message ? `${id}-status` : undefined;
  const describedBy = [helpId, errorId, statusId].filter((part): part is string => Boolean(part)).join(' ') || undefined;

  // The local, just-picked preview (an object URL) always wins over
  // `value`: it shows the photo she just chose immediately, even though
  // `value` was ALSO optimistically updated to the eventual published
  // `contentPath` -- that path has nothing live behind it yet (the build
  // that would put a real file there hasn't run), so rendering it as an
  // <img src> before a publish would just be a broken image.
  const previewSrc = previewUrl ?? value ?? null;

  return (
    <div className="mb-4">
      <label htmlFor={id} className={LABEL_CLASSNAME}>
        {label}
      </label>

      {previewSrc && (
        <img src={previewSrc} alt="" className="mb-2 h-24 w-24 rounded border border-gray-300 object-cover" />
      )}

      <input
        id={id}
        type="file"
        accept="image/*"
        onChange={(event) => {
          void handlePick(event.target.files);
          // Reset so picking the SAME file a second time (e.g. immediately
          // retrying by re-choosing rather than using the Retry button)
          // still fires this handler -- an unchanged <input type="file">
          // value does not raise a second change event.
          event.target.value = '';
        }}
        disabled={status.kind === 'converting' || status.kind === 'uploading'}
        aria-describedby={describedBy}
        className={INPUT_CLASSNAME}
      />

      {message && (
        <p
          id={statusId}
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={status.kind === 'error' ? 'mt-1 text-sm text-red-600' : 'mt-1 text-xs text-gray-500'}
        >
          {message}
        </p>
      )}

      {status.kind === 'error' && (
        <button type="button" onClick={retry} className={RETRY_BUTTON_CLASSNAME}>
          Retry
        </button>
      )}

      {help && (
        <p id={helpId} className="mt-1 text-xs text-gray-500">
          {help}
        </p>
      )}

      {errorId && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">
          {problems.map((p) => p.message).join(' ')}
        </p>
      )}
    </div>
  );
}

export default PhotoField;
