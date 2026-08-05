import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { convertHeic, checkPhotoSize, uploadAndEncode, type StagedPhoto } from './upload-photo';
import type { UploadCategory } from '../shared/upload-categories';

export interface EditableImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  // The same dotted path Task 1 already passes to `content.renderImage` at
  // every one of the seven real call sites (e.g. 'galleries.heroCollage.7',
  // 'dishes.abc123.image') -- carried onto `data-editable-image-path` below
  // so a test (or a future feature) can find which on-screen photo a given
  // instance is, the same way EditableText's own `data-editable-path`
  // already does for text.
  path: string;
  category: UploadCategory;
  // Fires once a photo finishes staging, and with `null` the instant a new
  // pick starts -- PhotoField.tsx's own `onStaged` contract, unchanged
  // (staged.ts's collector already handles both halves of it). The caller
  // (EditMode's buildBundle) is what turns this into a call keyed on this
  // instance's own PATH, not on the photo's `src` value -- see that
  // module's own comment for why the src can't be the key here (the same
  // photo legitimately appears at more than one path at once).
  onStaged: (staged: StagedPhoto | null) => void;
  // Writes the newly staged `contentPath` back into whichever content file
  // this path belongs to (galleries.json positionally, dishes/drinks/
  // press.json by id) -- EditMode's own commitImage, mirroring EditableText's
  // commitText.
  onReplace: (contentPath: string) => void;
  // Set while a publish request is actually in flight (PublishBar's own
  // `onPublishLockChange`). Takes the camera badge and its file input off
  // the page -- there is no input left to reach, which is what actually
  // closes the same-key re-stage race from this surface -- while KEEPING
  // this component mounted, and with it the local preview of a photo she
  // picked seconds ago.
  //
  // Review finding (Important): /edit used to drop this component entirely
  // for the pause, returning a bare <img>. That destroyed `previewUrl` and
  // ran the unmount cleanup's `URL.revokeObjectURL`, so the <img> fell back
  // to the content-supplied `src` -- a derivative path like
  // /images/atmosphere/<hash>.webp that only exists once the Cloudflare
  // build finishes, minutes later. The photo she had just placed turned
  // into a broken image the instant she confirmed the publish, and stayed
  // broken for the rest of the session, because the revoked object URL and
  // the state holding it were both gone by the time the pause lifted. The
  // natural reading is "my photo failed" and the natural response is to
  // re-pick it, uploading a second copy of the same file and staging a
  // second, unreferenced asset. The bytes were never at risk -- an upload
  // that lands during the pause still reaches the staged map -- this was
  // display only, and the fix is to keep the component rather than the
  // affordance.
  locked?: boolean;
}

type Status = { kind: 'idle' } | { kind: 'uploading'; percent: number } | { kind: 'error'; message: string };

// `<span className="relative">` -- deliberately `display: inline` (the bare
// default for a <span>, no `inline-block`), not merely "a wrapper that
// happens to work." Every one of the seven real call sites styles its own
// <img> with classes that size it against ITS OWN containing block (several
// with `w-full h-full`, e.g. Drinks.tsx) -- an `inline-block` wrapper WOULD
// insert itself as a new containing block (CSS's own definition: an
// inline-block element establishes one for its children), leaving the img's
// percentage sizing resolving against an EMPTY box with nothing to size
// itself from, a circular collapse. A plain `inline` element does not
// establish a containing block for width/height percentages at all -- the
// spec routes that lookup straight through to the nearest actual block
// ancestor, exactly as if this span were not there -- while `position:
// relative` on ANY display value, inline included, still makes it the
// containing block for its own ABSOLUTELY positioned children, which is
// all the overlay control below needs. Confirmed directly: the homepage
// byte test never mounts this component at all (its provider is never
// used outside /edit), so this reasoning is what stands in for that proof
// here -- see this component's own tests for the same guarantee checked
// against a real box.
const WRAPPER_CLASSNAME = 'relative';

// Persistently visible -- never hover-gated, the same mandate
// EditableText's own affordance follows (the spec's Risks section: "on
// phones she gets tap-to-select... instead"). Sized for a real touch
// target (an 8-unit box, ~32px) even though the hero collage renders at
// ~60px tiles on a 390px screen (the spec's own named case) -- small
// enough not to obscure the photo underneath, large enough to tap
// reliably. No `hover:` prefix anywhere in this string; `focus:` supplies
// the same stronger visual cue EditableText's own className comment
// documents, reachable by keyboard tab as well as touch.
//
// `z-20`, not `z-10` -- Plan 6, Task 3 review finding, caught in a real
// Chromium build serving a real vite-served /edit, not in any prior test:
// on every one of the sixteen HERO COLLAGE tiles specifically (this is the
// one renderImage call site with something else stacked on top of it),
// this control was COMPLETELY UNREACHABLE by a real click, on every single
// tile, at every viewport tested -- `document.elementFromPoint()` at this
// badge's own centre resolved to Hero.tsx's `relative z-10` main-content
// div (or one of its own block-level text children -- a `<p>`'s hit box
// spans its full container width even where the visible glyphs are
// centred and narrow) every time, never this badge. Both elements sat at
// the SAME z-index (10) in the SAME stacking context, a tie broken by DOM
// order -- the content div is later in Hero.tsx's JSX, so it painted (and
// hit-tested) on top of the entire collage, including this badge, for the
// whole life of Plan 5's photo-replace feature. `z-20` wins that
// comparison outright; nothing else on this page needs to sit above this
// badge. See CollageTile.tsx's own select button for the identical fix,
// found and applied together.
const CONTROL_LABEL_CLASSNAME =
  'absolute bottom-1 right-1 z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/70 bg-black/60 text-white shadow focus-within:ring-2 focus-within:ring-[#6B8B59]';

const ERROR_CONTROL_LABEL_CLASSNAME =
  'absolute bottom-1 right-1 z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/70 bg-red-600/90 text-white shadow focus-within:ring-2 focus-within:ring-[#6B8B59]';

// A camera glyph built from plain characters, not an icon font or an SVG
// asset -- nothing new to fetch, nothing that could itself go missing from
// public/ and trip the deploy gate's own asset-existence check.
const CAMERA_GLYPH = '\u{1F4F7}';

const EditableImage: React.FC<EditableImageProps> = ({ path, category, onStaged, onReplace, locked = false, ...imgProps }) => {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  async function handlePick(fileList: FileList | null) {
    const picked = fileList?.[0];
    if (!picked) return;

    // Told BEFORE this pick's own upload resolves, matching PhotoField's
    // own documented contract -- a publish assembled in the gap between a
    // new pick starting and it finishing must never see two staged uploads
    // claiming the same field.
    onStaged(null);
    setStatus({ kind: 'uploading', percent: 0 });

    // Conversion, the size check, and the preview all happen BEFORE the
    // network call -- not folded into upload-photo.ts's own all-in-one
    // `stagePhoto` convenience wrapper -- for the identical reason
    // PhotoField.tsx's own `handlePick` keeps them distinct: she needs to
    // see the photo she just picked immediately, before the server has
    // answered at all (PhotoField.test.tsx's own "shows a staged
    // confirmation and previews the picked photo locally... before the
    // server has answered" pins the identical timing there). Folding
    // everything into `stagePhoto` would only set the preview once the
    // WHOLE upload finished, which is not what either component actually
    // shows her.
    let file: File;
    try {
      file = await convertHeic(picked);
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Could not read that photo. Try a different one.' });
      return;
    }

    const sizeError = checkPhotoSize(file);
    if (sizeError) {
      setStatus({ kind: 'error', message: sizeError });
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreviewUrl(url);

    try {
      const staged = await uploadAndEncode(category, file, (percent) => setStatus({ kind: 'uploading', percent }));
      onStaged(staged);
      onReplace(staged.contentPath);
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Upload failed.' });
    }
  }

  const inputId = `editable-image-${path.replace(/[^a-zA-Z0-9]/g, '-')}`;
  const alt = typeof imgProps.alt === 'string' && imgProps.alt.length > 0 ? imgProps.alt : undefined;
  const controlLabel = status.kind === 'error' ? `Could not replace ${alt ?? 'this photo'} — tap to try again` : `Replace ${alt ?? 'this photo'}`;

  // The local, just-staged preview always wins over the content-supplied
  // `src` -- she sees the photo she just picked immediately, the same
  // "never show a not-yet-live path as if it were" reasoning PhotoField.tsx's
  // own comment gives for the identical choice.
  const src = previewUrl ?? imgProps.src;

  // The pause: same wrapper, same <img>, same `src` (preview included) --
  // only the affordance goes. Returning early rather than conditionally
  // rendering the label keeps the mounted-ness of this component, which is
  // the entire point (see `locked`'s own comment), while leaving nothing
  // focusable or pickable behind.
  if (locked) {
    return (
      <span className={WRAPPER_CLASSNAME} data-editable-image-path={path}>
        <img {...imgProps} src={src} />
      </span>
    );
  }

  return (
    <span className={WRAPPER_CLASSNAME} data-editable-image-path={path}>
      <img {...imgProps} src={src} />
      <label
        htmlFor={inputId}
        aria-label={controlLabel}
        title={controlLabel}
        className={status.kind === 'error' ? ERROR_CONTROL_LABEL_CLASSNAME : CONTROL_LABEL_CLASSNAME}
      >
        <span aria-hidden="true" className="text-sm leading-none">
          {status.kind === 'uploading' ? `${status.percent}%` : status.kind === 'error' ? '!' : CAMERA_GLYPH}
        </span>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={status.kind === 'uploading'}
          onChange={(event) => {
            void handlePick(event.target.files);
            // Reset so picking the SAME file a second time (immediately
            // retrying by re-choosing, after an error) still fires this
            // handler -- an unchanged <input type="file"> value does not
            // raise a second change event.
            event.target.value = '';
          }}
        />
      </label>
      {status.kind === 'uploading' && (
        <span role="status" className="sr-only">{`Uploading ${alt ?? 'photo'}… ${status.percent}%`}</span>
      )}
      {status.kind === 'error' && (
        <span role="alert" className="sr-only">
          {status.message}
        </span>
      )}
    </span>
  );
};

export default EditableImage;
