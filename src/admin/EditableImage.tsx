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

// `<span className="relative">` -- `position: relative` is what makes this
// element the containing block for the ABSOLUTELY positioned camera badge
// below, and that part has always been right. What was wrong, until the
// repair recorded in the next comment, was leaving it at a <span>'s bare
// `display: inline` and nothing else.
//
// The reasoning this replaces went: an inline element does not establish a
// containing block for its children's percentage width/height at all -- the
// spec routes that lookup straight through to the nearest actual block
// ancestor, exactly as if this span were not there -- so an <img> styled
// `w-full h-full` by its call site resolves those percentages against the
// same box it would have without this wrapper. That is true, and it is why
// six of the eight real call sites were unaffected: each puts the image
// inside a BLOCK element it has already sized itself (PlaceGallery's
// `w-full h-full` div, BlogTeaser/BlogsPage's `h-48` div, FoodGallery/
// Drinks/ItemListSection's `relative w-full h-full` div, Hero's own collage
// tile). The percentages resolve against that div whether this span is in
// the way or not.
//
// It is false the moment the call site's sizing classes are on the IMAGE
// and the parent is a FLEX or GRID container, because then the box the
// parent lays out is THIS span, not the image -- and a span with no width
// of its own collapses. OurStory.tsx is the live instance: a seven-slide
// (six today) flex track whose slides are sized by `w-full flex-shrink-0
// h-[400px]` on the image, so at /edit every slide became a zero-width flex
// item, the whole track collapsed, and the carousel translated across blank
// space with no photo ever on screen. GallerySection.tsx's `layout: 'grid'`
// branch is the same shape (`max-h-full max-w-full` on the image, inside a
// `flex h-24` box); it renders on a page that is switched off today, which
// is the only reason it was not a second visible bug.
const WRAPPER_CLASSNAME = 'relative';

// The repair, and why it is this one of the three candidates.
//
// (a) The wrapper inherits the layout-affecting classes -- chosen. The box
//     the parent lays out becomes the same box the image was asking for,
//     so a flex/grid parent sizes the wrapper exactly as it would have
//     sized a bare <img>, and the image then fills it (its own `w-full
//     h-full` now resolves against a wrapper with a real, definite box
//     instead of against the grandparent -- the same number either way).
//     Nothing is REMOVED from the image's own className: only the families
//     below are copied up, and every one of them is idempotent when it
//     appears on both boxes at once. The visual families deliberately stay
//     on the image alone -- copying `opacity-90` or `group-hover:scale-110`
//     up would double-apply them, and worse, an opacity below 1 on this
//     element would make it a stacking context and re-break the camera
//     badge's `z-20` (see CONTROL_LABEL_CLASSNAME below for the hit-testing
//     bug that `z-20` exists to fix).
//
// (b) Making this element generate no box at all, so the image becomes the
//     parent's flex/grid item directly. Rejected on two independent counts.
//     The fatal one is mechanical: an element that generates no box cannot
//     be a containing block, so `position: relative` here would stop
//     meaning anything and every camera badge would position itself against
//     the nearest positioned ancestor instead -- on OurStory that is the
//     one carousel viewport, so all six badges would pile into a single
//     corner. The second is the accessibility caveat, checked rather than
//     assumed before rejecting: the value's own history is a string of
//     browser bugs that dropped the element AND ITS SUBTREE out of the
//     accessibility tree (Chromium and WebKit both shipped that for years),
//     and while a bare <span> carries no implicit role to lose, this
//     wrapper is also the ancestor of the `role="status"` and `role="alert"`
//     announcements below, which is exactly the subtree that used to
//     vanish. Not worth relying on for an editor whose whole point is that
//     the affordance is reachable.
//
// (c) Every call site wraps its own image in a sized element instead.
//     Rejected: it fixes each site once and leaves the next one to
//     rediscover the bug, and it is not free on the PUBLIC page -- with no
//     provider mounted, `renderImage` is the identity and returns a bare
//     <img> (src/content/ContentContext.ts), so the extra wrapper divs
//     would ship to every visitor and move the pinned homepage byte count
//     (src/test/homepage-bytes.test.tsx) to pay for an /edit-only defect.
//     (a) lives entirely in this component, which never renders outside
//     /edit, so it costs the public page nothing at all.
//
// The families copied are exactly the ones that describe how a box is SIZED
// AND PLACED BY ITS PARENT -- self-sizing, plus flex-item and grid-item
// participation. Prefixes only, all ending in a dash, so none of these
// strings is itself a complete utility name Tailwind's content scan could
// emit a rule for (this project's own standing WATCH: that scan has no JS
// parser, and bare one-word utility names have leaked real rules out of
// prose comments here more than once). Tailwind's two one-word flex-factor
// aliases are deliberately NOT matched: no call site uses either, and
// naming them in this file would be exactly such a leak -- their `flex-`
// prefixed spellings, which every real call site here actually uses
// (`flex-shrink-0` in OurStory.tsx), are covered by `flex-` below.
//
// Margins are deliberately absent. They are laid out by the parent too, but
// unlike every family below they are NOT idempotent across two nested
// boxes: copying `mt-4` up without removing it from the image would double
// the gap. No call site sets a margin on an image today; one that wanted to
// would need this list to move the class rather than copy it.
// Positioning (`absolute`/`inset-*`/`z-*`) is absent for a different
// reason: this element must stay `relative` for the badge, and a second
// position utility copied in here would be resolved by stylesheet order
// rather than by class order -- a coin flip. An image positioned by its own
// className is already broken today for an unrelated reason (it would
// resolve against this span's own inline box), and is out of scope here.
const LAYOUT_UTILITY_PREFIXES = [
  'w-',
  'h-',
  'min-w-',
  'min-h-',
  'max-w-',
  'max-h-',
  'size-',
  'aspect-',
  'flex-',
  'basis-',
  'order-',
  'self-',
  'justify-self-',
  'place-self-',
  'col-',
  'row-',
] as const;

// Strips a Tailwind candidate down to the utility name a prefix can be
// matched against: every responsive/state variant (`md:`, `focus:`,
// `group-hover:`, an arbitrary `[&:hover]:`, and any stack of them) plus a
// leading `!` important marker.
//
// Bracket depth is tracked rather than taking `split(':').pop()`, and that
// is a real difference, not defensive noise: Tailwind's own data-type hint
// syntax puts a colon INSIDE the arbitrary value -- the documented
// `<type>:` prefix a value carries when the scanner cannot infer its type
// on its own. The naive form cuts such a class at the wrong colon, comes
// back with the tail of the value, matches no prefix, and silently leaves a
// real width off the wrapper -- exactly the collapse this whole repair
// exists to stop, reintroduced for one class shape. (Deliberately not
// spelling a complete example class out here: this project's Tailwind
// content scan has no JS parser, so a real candidate written in prose gets
// a rule emitted for it -- confirmed the hard way while writing this file,
// the first draft of this very comment did exactly that, and the build
// warned about the typehint it had just been handed.)
//
// No negation handling: nothing in LAYOUT_UTILITY_PREFIXES above has a
// negative form (Tailwind's negatives are margins, insets and transforms,
// all deliberately excluded there), so stripping a leading `-` here would
// be unreachable code pretending to be a guarantee. A family that does take
// negatives has to add it back, with a test that can see it.
function baseUtility(token: string): string {
  let depth = 0;
  let lastSeparator = -1;
  for (let i = 0; i < token.length; i += 1) {
    const character = token[i];
    if (character === '[') depth += 1;
    else if (character === ']') depth -= 1;
    else if (character === ':' && depth === 0) lastSeparator = i;
  }
  const base = token.slice(lastSeparator + 1);
  return base.startsWith('!') ? base.slice(1) : base;
}

// The wrapper's own className: `relative`, plus -- only when the image
// actually carries layout classes -- `inline-block` and a copy of those
// classes.
//
// `inline-block` rather than the block-level display: it is the smaller
// change. Today the <img> is an inline replaced element sitting on a line
// box inside this inline span, and an inline-block wrapper reproduces that
// line box exactly (same baseline, same descender gap, same relationship to
// whatever text could sit beside it), where a block-level wrapper would
// remove it. It also earns back what the old comment above rightly warned
// about: an inline-block DOES establish a containing block for its
// children's percentages, but that is now harmless precisely BECAUSE this
// element carries the same sizing classes the image does, so the box the
// image resolves against is definite rather than empty. In a flex or grid
// parent the value is blockified by the parent anyway, so it only ever
// matters on the block-parent call sites, where it is a no-op.
//
// When the image carries NO layout class at all, nothing is added and this
// element stays exactly what it was -- a bare inline span -- so no call
// site that never had this problem can acquire a new one from the repair.
// Not exported: `react-refresh/only-export-components` warns on a .tsx file
// that exports both a component and a plain value (ContentContext.ts's own
// header comment documents the same rule from the other side), and this
// project runs eslint at zero warnings. Every test below reaches this
// through the rendered DOM instead, which is the stronger check anyway --
// what matters is the class string that actually lands on the element the
// parent lays out.
function wrapperClassName(imgClassName: string | undefined): string {
  if (!imgClassName) return WRAPPER_CLASSNAME;
  const layout = imgClassName
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => {
      const base = baseUtility(token);
      return LAYOUT_UTILITY_PREFIXES.some((prefix) => base.startsWith(prefix));
    });
  if (layout.length === 0) return WRAPPER_CLASSNAME;
  return `${WRAPPER_CLASSNAME} inline-block ${layout.join(' ')}`;
}

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

  // Computed from the props THIS render was handed, not captured once: a
  // call site is free to vary its className between renders (a responsive
  // branch, a selected state), and the wrapper has to keep matching it or
  // the parent goes back to laying out a box of the wrong size.
  const wrapper = wrapperClassName(imgProps.className);

  // The pause: same wrapper, same <img>, same `src` (preview included) --
  // only the affordance goes. Returning early rather than conditionally
  // rendering the label keeps the mounted-ness of this component, which is
  // the entire point (see `locked`'s own comment), while leaving nothing
  // focusable or pickable behind.
  if (locked) {
    return (
      <span className={wrapper} data-editable-image-path={path}>
        <img {...imgProps} src={src} />
      </span>
    );
  }

  return (
    <span className={wrapper} data-editable-image-path={path}>
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
