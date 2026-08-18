// A 48px picture on every row that has one, so a dish is RECOGNISED rather
// than read.
//
// One component, so the precedence and fallback rules exist once rather than
// six times. Every row type whose content model already has an image path
// gets one; nothing else does. A placeholder box on a row that can never
// hold an image is decoration, and decoration on a row that means nothing is
// the "bland" complaint in miniature -- which is why Pages, Homepage
// sections, Opening hours and Page copy have none. Menu PDFs are the one
// exception that still renders the placeholder: it is the spec's own named
// example of a row with no possible picture that must still occupy the same
// width as a dish's, so the two lists read as the same kind of thing.
//
// ---------------------------------------------------------------------------
// A PHOTO SHE HAS JUST PICKED BEATS THE CONTENT PATH.
// ---------------------------------------------------------------------------
// PhotoField optimistically writes the eventual published `contentPath` into
// the record the moment an upload stages, and there is no file behind that
// path until the build finishes minutes later. Rendering it would show her a
// broken image for two minutes immediately after she picked a photo, which
// is the exact anxiety this redesign exists to remove.
//
// The object URL comes from `useImagePreviews` -- the store /edit already
// uses -- lifted to AdminApp and passed down, rather than a second store
// invented for this surface. Two rejected alternatives, recorded so they are
// not re-derived: deriving an object URL here from the staged bytes puts the
// revoke rule in two places, which is how the leak in previews.ts's own
// header comment happened; and a `data:` URI built from the staged base64 is
// refused outright by the shipped CSP, which allows `img-src 'self' blob:`
// and no `data:`.
import React, { useState } from 'react';
import { NO_IMAGE_PREVIEWS } from '../previews';
import type { ImagePreviews } from '../previews';

export interface ThumbnailProps {
  // The record's own current value. `null`, `undefined` or the empty string
  // all mean "no photo yet", which is a real state (Drink.image is nullable,
  // and a freshly added record starts empty).
  path: string | null | undefined;
  // The SAME string this row's PhotoField stages under. Supplying it is what
  // makes a just-picked photo win; omitting it simply falls back to `path`.
  previewKey?: string;
  previews?: ImagePreviews;
}

// `data-thumbnail` is a test seam, and it is not optional. Several rows that
// carry a thumbnail ALSO render PhotoField's own 96px preview of the same
// photo, so "there is an <img> with this src inside the row" is satisfied by
// that preview whether or not this component was ever mounted -- a row test
// written without this attribute could not fail. It is also what the e2e
// spec measures the 48px box with.
const BOX = 'h-12 w-12 shrink-0 rounded border border-brand/40 object-cover';
// Cream fill, sage border, no icon. Not a browser broken-image glyph, and
// not nothing: collapsing the box makes the rows ragged, which reads as
// broken.
const PLACEHOLDER = 'h-12 w-12 shrink-0 rounded border border-brand/40 bg-[#f7f5f0]';

const Thumbnail: React.FC<ThumbnailProps> = ({ path, previewKey, previews = NO_IMAGE_PREVIEWS }) => {
  // Which src has already failed, rather than a bare boolean. A boolean
  // would never clear, so a row whose photo 404'd once would stay a
  // placeholder even after she picked a new one -- and clearing it on every
  // render instead would retry the same broken URL forever, which is the
  // loop this is shaped to avoid.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const staged = previewKey === undefined ? undefined : previews.urls[previewKey];
  const src = staged ?? (path === null || path === undefined || path === '' ? null : path);

  if (src === null || src === failedSrc) {
    return <div aria-hidden="true" data-thumbnail="row" className={PLACEHOLDER} />;
  }

  return (
    // `alt=""`, deliberately: the row's own text already names the item, and
    // a thumbnail with alt text would have a screen reader announce the dish
    // twice.
    <img src={src} alt="" loading="lazy" data-thumbnail="row" onError={() => setFailedSrc(src)} className={BOX} />
  );
};

export default Thumbnail;
