import { useEffect, useRef, useState } from 'react';
import {
  checkPhotoSize,
  convertHeic,
  uploadAndEncode,
  MAX_STAGED_PHOTOS_PER_PUBLISH,
  MAX_STAGED_PHOTO_BYTES,
  type StagedPhoto,
} from './upload-photo';
import type { UploadCategory } from '../shared/upload-categories';
import { NO_IMAGE_PREVIEWS } from './previews';
import type { ImagePreviews } from './previews';
import type { ValidationProblem } from '../content/validate';

// StagedPhoto, MAX_STAGED_PHOTOS_PER_PUBLISH and MAX_STAGED_PHOTO_BYTES all
// moved to src/admin/upload-photo.ts (Plan 5 Task 4, Step 1) -- re-exported
// here, unchanged, so every existing caller of THIS module (staged.ts's own
// `import type { StagedPhoto } from './PhotoField'`, this component's own
// tests) keeps working without a single import path changing. See
// upload-photo.ts's own header comment for why the pipeline moved at all:
// EditableImage.tsx (this same task) needs the identical HEIC/size/upload
// steps and must not re-derive a second copy of them.
//
// `react-refresh/only-export-components`'s own `allowConstantExport` option
// (already relied on before this move) only recognises a literal `export
// const NAME = <value>` declaration -- not a re-export statement forwarding
// an imported binding, even one that is itself a constant. Re-declaring
// with a second, independently-chosen literal here would silently
// reintroduce the exact "two numbers that could drift apart" risk this
// move exists to close (see upload-photo.ts's own comment on
// MAX_STAGED_PHOTOS_PER_PUBLISH), so this is disabled deliberately rather
// than silenced blind: both names are still one runtime binding, imported
// from the one place they're actually declared.
export type { StagedPhoto };
// eslint-disable-next-line react-refresh/only-export-components
export { MAX_STAGED_PHOTOS_PER_PUBLISH, MAX_STAGED_PHOTO_BYTES };

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
  // The shared preview store (previews.ts), and the key to write this
  // field's just-picked object URL under.
  //
  // TWO props rather than the one the design named, and the reason is that
  // PhotoField cannot derive the key: it is composed on the way DOWN, one
  // level at a time -- the content file's name, then the record's id, then
  // this field's own key -- exactly the way `onStaged` composes the same
  // string on the way back UP. A component that only knows its own field
  // key cannot build a string that has to start with a file name.
  //
  // Both default to the no-op, so every existing caller is unaffected: this
  // component's own local preview state, and its revoke-on-unmount, are
  // unchanged. Writing to the store IN ADDITION is what lets a 48px row
  // thumbnail somewhere else on the page show the photo she just picked
  // instead of the content path, which has no file behind it until the build
  // finishes.
  previews?: ImagePreviews;
  previewKey?: string;
  // Review finding (Phase 4, Task 4): every other photo field on this
  // dashboard is a rectangle on the live site (a dish card, a press logo, an
  // award badge), so this component's own square preview was right for all
  // of them -- until the chef byline, whose LIVE rendering
  // (src/components/OurStory.tsx) is a circle. Left square in the
  // dashboard, she would judge a photo crop against a shape the site never
  // actually shows it in. Optional, defaulting to the existing square
  // preview, so every other caller is unaffected; `rounded-full` is not new
  // CSS -- OurStory.tsx's own byline already ships it, among many other
  // circular UI elements across the site.
  previewClassName?: string;
  // Whether this field draws its own thumbnail at all. True everywhere but
  // the writing surface's image row, which already shows the SAME photograph
  // at column width immediately above the picker -- and shows it correctly,
  // out of the shared preview store. A second copy there is not merely
  // redundant: `value` on a just-picked photo is a derivative no build has
  // produced yet, so the thumbnail would be a broken-image glyph sitting
  // directly under the picture it claims to be.
  showPreview?: boolean;
  problems: ValidationProblem[];
}

const DEFAULT_PREVIEW_CLASSNAME = 'mb-2 h-24 w-24 rounded border border-gray-300 object-cover';

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

const INPUT_CLASSNAME = 'block w-full text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-brand file:px-3 file:py-1.5 file:font-[\'Montserrat\'] file:text-xs file:uppercase file:tracking-wide file:text-ink hover:file:bg-brand-dark';
const LABEL_CLASSNAME = "mb-1 block font-['Montserrat'] text-sm uppercase tracking-wide text-accent";
const RETRY_BUTTON_CLASSNAME =
  "mt-2 rounded border border-red-300 px-3 py-1 font-['Montserrat'] text-xs uppercase tracking-wide text-red-600 transition hover:bg-red-600 hover:text-white";

function PhotoField({
  id,
  label,
  help,
  category,
  value,
  onChange,
  onStaged,
  previews = NO_IMAGE_PREVIEWS,
  previewKey,
  previewClassName = DEFAULT_PREVIEW_CLASSNAME,
  showPreview = true,
  problems,
}: PhotoFieldProps) {
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
    // Enforced HERE, client-side, before any network call -- this is what
    // makes MAX_STAGED_PHOTOS_PER_PUBLISH's own "8 * 5MB" arithmetic true
    // rather than aspirational (see that constant's own comment,
    // upload-photo.ts). Checked on every call to `upload`, including
    // Retry's, so retrying a still-too-large file re-reports the same
    // rejection rather than silently skipping the check the second time.
    // worker/upload.ts's own MAX_UPLOAD_BYTES (25MB) is a separate, looser
    // ceiling for a single upload regardless of staging -- this one is
    // tighter, specific to keeping a full multi-photo publish's request
    // body bounded.
    const sizeError = checkPhotoSize(file);
    if (sizeError) {
      setStatus({ kind: 'error', message: sizeError, file });
      return;
    }

    setStatus({ kind: 'uploading', percent: 0 });
    try {
      const staged = await uploadAndEncode(category, file, (percent) => setStatus({ kind: 'uploading', percent }));
      onStaged?.(staged);
      onChange(staged.contentPath);
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
    // Published to the shared store IN ADDITION to this component's own
    // state, never instead of it. The store's `set` revokes whatever that
    // key held before, and the unmount cleanup above still revokes this
    // component's own -- one URL, and the two revoke paths are idempotent
    // (revoking an already-revoked URL is a no-op).
    if (previewKey !== undefined) previews.set(previewKey, url);

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

      {showPreview && previewSrc && <img src={previewSrc} alt="" className={previewClassName} />}

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
