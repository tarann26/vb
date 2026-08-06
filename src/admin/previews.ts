// The local preview of a photo she has just picked, held by the SCREEN
// rather than by the <img> that shows it.
//
// It lived inside EditableImage until now, as a `useState` plus an unmount
// effect that revoked its object URL. That was correct for as long as a photo
// could only ever be replaced IN PLACE -- the component never unmounted while
// she was looking at it, so its own state was as durable as the box. Plan 9's
// drag-to-swap breaks exactly that assumption: a swap exchanges two photos'
// positions in the tree (src/content/collage.ts's `swapCollagePhotos`), each
// photo carrying its own id with it, so both boxes' React keys change, React
// unmounts both subtrees, and the unmount cleanup revokes the object URL of a
// photo she picked seconds ago. The <img> then falls back to the
// content-supplied `contentPath` -- an /images/... derivative that does not
// exist until the Cloudflare build finishes minutes later -- and stays
// visibly broken for the rest of the session.
//
// That is not a new bug: EditableImage.tsx's `locked` prop and
// EditMode.tsx's renderImage each carry a long comment about the SAME
// failure, found twice before, both times caused by something unmounting this
// component. Keeping the preview above the component is what makes it stop
// depending on the component's lifetime at all.
//
// Keyed by the renderImage PATH (`galleries.heroCollage.<photo id>`,
// `dishes.<id>.image`, ...), which for the collage is the photo's own id and
// therefore travels with the photo across a swap -- the same key
// `staged.files` already uses for the bytes. A key derived from position
// would leave the preview on the box the photo left, which is the other half
// of the same bug.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ImagePreviews {
  // path -> object URL. Read by whatever renders that path's <img>.
  urls: Record<string, string>;
  // Stores `url` for `path`, revoking whatever this path held before, or
  // drops the entry entirely for `null`.
  set: (path: string, url: string | null) => void;
}

// Never a preview, and never revokes anything -- what `buildBundle`
// (EditMode.tsx) falls back to when a caller hands it no preview store. Only
// its own direct-call tests do; the real /edit screen always passes the hook
// below, and the drag-to-swap e2e spec is what proves it (a preview that
// survives a swap cannot survive one of these).
export const NO_IMAGE_PREVIEWS: ImagePreviews = { urls: {}, set: () => {} };

export function useImagePreviews(): ImagePreviews {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // The same map, readable synchronously from the cleanup below and from
  // `set` itself without either depending on a render having happened. A
  // functional `setUrls` updater cannot revoke, because revoking is a side
  // effect and React may call an updater more than once.
  const urlsRef = useRef<Record<string, string>>({});

  const set = useCallback((path: string, url: string | null) => {
    const previous = urlsRef.current[path];
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    const next = { ...urlsRef.current };
    if (url === null) delete next[path];
    else next[path] = url;
    urlsRef.current = next;
    setUrls(next);
  }, []);

  // Every URL this screen created, released when the screen itself goes.
  // Deliberately the ONLY unmount cleanup: a per-<img> one is exactly what
  // made a swap (or a publish pause) destroy a live preview.
  useEffect(
    () => () => {
      Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = {};
    },
    [],
  );

  return { urls, set };
}
