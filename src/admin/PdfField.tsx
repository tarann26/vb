// The one field this dashboard needs whose committed content is a PDF, not
// a JSON value or a photo -- see worker/upload.ts's `category=menu` branch
// (Task 8) for the server side this component talks to, and that branch's
// own comment for why the path it writes is a stable, chosen name rather
// than PhotoField's content hash.
import { useState } from 'react';
import { bytesToBase64 } from '../shared/base64';
import { INPUT_CLASSNAME, LABEL_CLASSNAME } from './Field';
import { REMOVE_BUTTON_CLASSNAME } from './RecordList';
import type { ValidationProblem } from '../content/validate';

// Everything a caller (eventually Task 10's publish assembly, the same one
// PhotoField.tsx's own StagedPhoto feeds) needs to send this staged PDF back
// as part of `POST /api/publish`'s `files` array, in the SAME request as
// whatever JSON edit changed menus.json's own record -- see this task's own
// brief on why a rename must not be able to half-land.
export interface StagedMenuPdf {
  // The asset path the Worker will commit these bytes to: public/menus/,
  // then this field's own `name` prop, then .pdf.
  path: string;
  // What the RECORD's own `file` field should store -- the same name,
  // rooted at the site's own web root instead of the repository's. Computed
  // server-side by worker/upload.ts, so this component never carries a
  // second copy of that one-character (drop "public") rule.
  file: string;
  // Base64, ready to become this staged file's `content` on publish.
  content: string;
  encoding: 'base64';
}

export interface PdfFieldProps {
  id: string;
  label: string;
  help?: string;
  // The stable file-name stem this PDF commits under (worker/upload.ts's
  // `MENU_NAME_PATTERN`: lowercase letters, digits, hyphens only) --
  // supplied by the caller, not derived here, the same way PhotoField.tsx
  // takes `category` as a prop rather than inventing its own category
  // rule. Deliberately not re-validated client-side against that pattern:
  // unlike a photo's format or size, this value is never something she
  // types into this component directly (it comes from whatever record this
  // field is wired to), so the Worker's own rejection message -- surfaced
  // through the same error path as every other upload failure below -- is
  // the one place that check needs to live.
  name: string;
  // The record's own current value for this field, e.g. a `file` path from
  // an earlier upload, or null for a menu that has never had one.
  value: string | null;
  onChange: (file: string | null) => void;
  // Fires once a PDF finishes staging, and fires with `null` the moment a
  // NEW pick starts -- identical contract to PhotoField.tsx's own
  // `onStaged`, for the identical reason (a caller must drop a stale staged
  // upload the instant a second pick supersedes it).
  onStaged?: (staged: StagedMenuPdf | null) => void;
  problems: ValidationProblem[];
}

const UPLOAD_TIMEOUT_MS = 120_000;

function parseErrorMessage(xhr: XMLHttpRequest, fallback: string): string {
  try {
    const body = JSON.parse(xhr.responseText) as { message?: unknown };
    return typeof body.message === 'string' && body.message ? body.message : fallback;
  } catch {
    return fallback;
  }
}

// The one function in this file that actually talks to the network -- see
// PhotoField.tsx's identical split for why this stays separate from the
// component's own state machine below.
function uploadStaged(
  name: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ path: string; file: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?stage=1');
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { path: string; file: string });
        } catch {
          reject(new Error('The server sent back something this page could not read.'));
        }
        return;
      }
      reject(new Error(parseErrorMessage(xhr, `Upload failed (status ${xhr.status}).`)));
    };

    xhr.onerror = () => reject(new Error('Could not reach the server. Check your connection and try again.'));
    xhr.ontimeout = () => reject(new Error('This is taking too long. Check your connection and try again.'));

    const form = new FormData();
    form.append('category', 'menu');
    form.append('name', name);
    form.append('file', file);
    xhr.send(form);
  });
}

type Status =
  | { kind: 'idle' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'staged' }
  // Keeps the File around so Retry resubmits the identical bytes without
  // asking her to re-pick it.
  | { kind: 'error'; message: string; file: File };

function statusMessage(status: Status): string | null {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'uploading':
      return `Uploading… ${status.percent}%`;
    case 'staged':
      return 'Uploaded — publish to make it live.';
    case 'error':
      return status.message;
  }
}

function PdfField({ id, label, help, name, value, onChange, onStaged, problems }: PdfFieldProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function upload(file: File) {
    setStatus({ kind: 'uploading', percent: 0 });
    try {
      const { path, file: filePath } = await uploadStaged(name, file, (percent) =>
        setStatus({ kind: 'uploading', percent }),
      );
      const bytes = new Uint8Array(await file.arrayBuffer());
      onStaged?.({ path, file: filePath, content: bytesToBase64(bytes), encoding: 'base64' });
      onChange(filePath);
      setStatus({ kind: 'staged' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Upload failed.', file });
    }
  }

  function handlePick(fileList: FileList | null) {
    const picked = fileList?.[0];
    if (!picked) return;

    // Whatever was staged before is no longer the current candidate the
    // instant a new one is picked -- told to the caller BEFORE the new
    // upload starts, same as PhotoField.tsx's own handlePick.
    onStaged?.(null);
    void upload(picked);
  }

  function retry() {
    if (status.kind === 'error') void upload(status.file);
  }

  const helpId = help ? `${id}-help` : undefined;
  const errorId = problems.length > 0 ? `${id}-error` : undefined;
  const message = statusMessage(status);
  const statusId = message ? `${id}-status` : undefined;
  const currentId = value ? `${id}-current` : undefined;
  const describedBy = [helpId, errorId, statusId, currentId]
    .filter((part): part is string => Boolean(part))
    .join(' ') || undefined;

  return (
    <div className="mb-4">
      <label htmlFor={id} className={LABEL_CLASSNAME}>
        {label}
      </label>

      {value && (
        <p id={currentId} className="mt-1 text-xs text-gray-500">
          {`Current file: ${value}`}
        </p>
      )}

      <input
        id={id}
        type="file"
        accept="application/pdf"
        onChange={(event) => {
          handlePick(event.target.files);
          // Reset so picking the SAME file a second time still fires this
          // handler -- an unchanged <input type="file"> value does not
          // raise a second change event.
          event.target.value = '';
        }}
        disabled={status.kind === 'uploading'}
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
        <button type="button" onClick={retry} className={REMOVE_BUTTON_CLASSNAME}>
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

export default PdfField;
