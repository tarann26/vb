// The one collector every screen that renders a PhotoField or a PdfField
// shares -- what makes "she stages three photos on three different dishes,
// then a drink, then swaps a menu PDF, and all four reach the same publish"
// true rather than each field inventing its own, disconnected pile of
// bytes. AdminApp owns the single instance (see its own top-level
// `useStagedFiles()` call); every section below it (ArraySection,
// GalleryList, the menus section) is handed the same `stage` function and
// only ever adds its own file's own prefix to the key it stages under.
//
// This does NOT assemble a publish request -- that is Task 10's
// `publish.ts`, not built yet (see PhotoField.tsx's own MAX_STAGED_PHOTOS_
// PER_PUBLISH comment, which names it the same way). What this hook owns is
// narrower and already load-bearing on its own: accumulate every currently
// staged file's bytes, keyed so two different fields never clobber each
// other, and drop exactly one entry the instant its own field reports a
// fresh pick superseding it (PhotoField.tsx/PdfField.tsx's own `onStaged`
// contract, documented on each of those components). Without this, wiring
// either component in still leaves the exact defect this task's brief
// describes: `onChange(contentPath)` writes a path into the record while
// the bytes it points at are never collected anywhere, and a publish built
// from the record alone would commit JSON pointing at a source that was
// never sent.
import { useCallback, useState } from 'react';
import type { StagedPhoto } from './PhotoField';
import type { StagedMenuPdf } from './PdfField';

export interface StagedFile {
  path: string;
  content: string;
  encoding: 'base64';
  // What the record's own field holds for this upload -- StagedPhoto's own
  // `contentPath` for a photo, StagedMenuPdf's own `file` for a menu PDF.
  // Review finding (Critical): dropped entirely until this fix, which is
  // exactly what let a RESTORED draft publish a reference this collector
  // itself no longer has bytes for -- publish.ts's own dirtyDraftMap needs
  // this to tell "a leaf that names a file THIS session staged" apart from
  // an ordinary string, so it can scrub a stale one out of what gets saved
  // to localStorage before the tab that would ever publish it dies.
  contentPath: string;
}

export interface StagedFiles {
  // Every file currently staged, keyed by whatever string the caller that
  // staged it chose -- see ArraySection/GalleryList/the menus section in
  // AdminApp.tsx for the actual key shapes (`${file}:${itemId}:${fieldKey}`
  // for a record, `${file}:${listName}:${index}:src` for a gallery image).
  // Not `StagedFile[]`: a plain array would need the caller to find-and-
  // replace-or-remove its own prior entry by hand on every restage, exactly
  // the bug class `stage`'s own key-keyed `Record` update below exists to
  // rule out by construction.
  files: Record<string, StagedFile>;
  // Sets `key` to `file`, or removes it entirely when `file` is `null` --
  // the second half of PhotoField.tsx/PdfField.tsx's own `onStaged` contract
  // ("fires with `null` the moment a NEW pick starts, so a caller drops
  // whatever it previously collected for this field before it goes stale").
  // A caller that only ever wrote `files[key] = file` and never handled
  // `null` would leave the STALE bytes from an abandoned or superseded pick
  // sitting in the map right up until (and past) the next successful stage
  // -- silently attaching the wrong photo's bytes to a publish for a window
  // where the record's own `image` field may already point somewhere else
  // entirely.
  stage: (key: string, file: StagedFile | null) => void;
  // Drops exactly the entries a finished publish actually SENT, matched by
  // object identity rather than by key. `sent` is the map as it stood when
  // the request was built.
  //
  // Why identity and not `stage(key, null)` per key, which is what the
  // success path used to do: `stage` deletes whatever sits at that key NOW.
  // If she re-picks a photo for a field that was already in the request
  // while that request is still in flight, "now" is the NEW upload -- so
  // the publish's own cleanup deleted bytes that had never been committed,
  // while EditableImage's onReplace had already written the new
  // contentPath into the registry. That leaves a content file naming an
  // asset that exists nowhere: not staged any more, and never sent. The
  // next publish commits the dangling path, and the deploy gate's own
  // asset-existence check (src/content/__tests__/assets.test.ts) then fails
  // every subsequent build until a developer hand-edits the JSON. Nothing
  // in the UI reports any of it.
  //
  // `stage(key, null)` is deliberately left exactly as it is: PhotoField
  // and EditableImage both depend on it for their own supersede contract
  // ("fires with null the moment a NEW pick starts"), where deleting
  // whatever is currently there is precisely the right behaviour.
  clearSent: (sent: Record<string, StagedFile>) => void;
}

export function useStagedFiles(): StagedFiles {
  const [files, setFiles] = useState<Record<string, StagedFile>>({});

  // useCallback with an empty dependency array, not a fresh closure every
  // render: every caller below (ArraySection, GalleryList, the menus
  // section) hands its own bound wrapper around this straight to a
  // useEffect-free render path, but PhotoField/PdfField's own `onStaged`
  // prop is read inside event handlers that can fire well after a re-render
  // -- a stable identity here is what keeps `setFiles`'s own functional
  // updater (never a stale `files` closed over at bind time) as the single
  // source of truth for what "the current map" actually is.
  const stage = useCallback((key: string, file: StagedFile | null) => {
    setFiles((prev) => {
      if (file === null) {
        if (!(key in prev)) return prev; // no-op: nothing to remove, no need to trigger a re-render for it
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: file };
    });
  }, []);

  // Same functional-updater posture as `stage`, and the same no-op-avoids-a-
  // render check: a call that matches nothing returns `prev` untouched
  // rather than a fresh object that would re-render every consumer for no
  // change. `prev[key] === sent[key]` is a reference comparison on purpose
  // -- a re-pick under the same key produces a genuinely different
  // StagedFile object, which is exactly the case that must survive.
  const clearSent = useCallback((sent: Record<string, StagedFile>) => {
    setFiles((prev) => {
      const doomed = Object.keys(sent).filter((key) => prev[key] === sent[key]);
      if (doomed.length === 0) return prev;
      const next = { ...prev };
      doomed.forEach((key) => delete next[key]);
      return next;
    });
  }, []);

  return { files, stage, clearSent };
}

// Two small, shared conversions from what PhotoField/PdfField's own
// `onStaged` actually hands a caller to the narrower `StagedFile` shape
// `stage` above stores -- every real caller (ArraySection, GalleryList, the
// menus section, all in AdminApp.tsx) needs exactly this, and a
// second/third independently-written copy of "pick path/content/encoding
// back out" is exactly the kind of thing that could silently drift out of
// sync with itself across call sites. `contentPath` IS kept now (see
// StagedFile's own comment) -- it is the one field publish.ts's
// dirtyDraftMap needs to recognise a leaf that names bytes this collector
// holds.
export function fromStagedPhoto(staged: StagedPhoto | null): StagedFile | null {
  return staged === null ? null : { path: staged.path, content: staged.content, encoding: staged.encoding, contentPath: staged.contentPath };
}

export function fromStagedMenuPdf(staged: StagedMenuPdf | null): StagedFile | null {
  return staged === null ? null : { path: staged.path, content: staged.content, encoding: staged.encoding, contentPath: staged.file };
}
