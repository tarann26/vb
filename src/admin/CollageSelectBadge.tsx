// The one part of a collage photo box that is guaranteed to be reachable.
//
// WHY THIS EXISTS, measured rather than reasoned. A photo box carries only
// `relative overflow-hidden` (src/content/context.ts's
// COLLAGE_PHOTO_CLASSNAME) plus its own inline sizing, so its z-index is
// `auto` -- while Hero.tsx:132 paints `<div className="relative z-10
// text-center px-6">` (the logo circle, the name, the tagline, the strapline
// and the reservation numbers) straight over the middle of the same hero. A
// block-level paragraph's hit box spans its container's full width even where
// the visible text is short and centred, so that column covers far more of the
// collage than it looks like it does. Swept in real Chromium against a
// vite-served /edit, asking `document.elementFromPoint` what is on top at a
// ~50x50 grid of points inside every box: at 1440x900 photo-9 had ZERO points
// that resolved to itself and photo-6/7/13/14 only their outer corners; at
// 390x844 NINE of the sixteen boxes had zero reachable points anywhere. Every
// gesture in CollageEditor.tsx is gated on selecting a photo first, so more
// than half the collage could not be moved, resized, added beside or removed
// from a phone at all.
//
// This is a REGRESSION, not a pre-existing limit: the deleted CollageTile.tsx
// carried a select button of its own, pinned to the top-left corner of every
// tile one layer above that column, with its own comment recording that every
// one of the sixteen was unreachable by a real click before that layer was
// raised. The split tree deleted the control and the e2e assertion that
// guarded it without replacing either.
//
// (Its class string is deliberately NOT quoted here. This project's Tailwind
// content scan reads comments and has no JS parser, so the two corner
// utilities in it would each emit a real rule into the ONE stylesheet every
// public visitor downloads -- measured: an earlier draft of this comment did
// exactly that, and the rule-level build diff caught it.)
//
// WHY A CONTROL AND NOT A HIGHER BOX. Raising the photo boxes themselves
// clears the column and hit-tests 16/16 -- and breaks the other half of the
// screen, because that column is where her editable heading, tagline,
// strapline and reservation numbers live. A small control that clears the
// column, over a box that stays under it, is the only arrangement in which
// both are reachable.
//
// Its own file, not a private function inside CollageEditor.tsx, for the same
// two reasons CollageControlButton has one: `react-refresh/only-export-
// components` warns on a module exporting both a component and a hook (this
// project runs eslint at zero warnings), and -- the load-bearing half -- the
// two attributes below are then something this component CANNOT OMIT rather
// than something a call site has to remember:
//
//   * `data-collage-control`, which EditMode.tsx's capture-phase click guard
//     looks for before it lets a click inside the real page through at all.
//   * `data-collage-select`, which is what CollageEditor's own pointerdown
//     handler checks to let a press on this control START A GESTURE. Every
//     other <button> and <label> inside a box is deliberately excluded from
//     that handler (a press on the camera badge must never become a drag);
//     this one is the exception, because for a box the content column covers
//     it is the only place a drag could begin.
import type { CSSProperties } from 'react';
import { COLLAGE_CONTROL_ATTR } from './CollageControlButton';

export const COLLAGE_SELECT_ATTR = 'data-collage-select';

// A plain character, not a lucide icon: this module is only ever rendered at
// /edit, and a glyph costs the admin chunk nothing at all. The same decision
// EditableImage.tsx's own CAMERA_GLYPH records, and the badge below is that
// badge's opposite corner.
const MOVE_GLYPH = '✥';

// `zIndex: 20` -- the same layer EditableImage's camera badge and
// CollageEditor's own "Swap here" button already occupy, one above Hero's
// `relative z-10` content column and one below the divider handles' 30.
// Inline, not a class name: this project's Tailwind content scan has no JS
// parser, so a class name written here would land a rule in the ONE stylesheet
// every public visitor downloads, for a control no public visitor can ever
// see.
//
// TOP LEFT, because the camera badge is bottom right (EditableImage.tsx's
// CONTROL_LABEL_CLASSNAME). Opposite corners is what keeps "choose this photo"
// and "replace this photo" two separately tappable targets in the smallest box
// this collage renders -- 61x137 CSS px, on a 390px phone.
const BADGE_BASE: CSSProperties = {
  position: 'absolute',
  top: 4,
  left: 4,
  zIndex: 20,
  display: 'flex',
  height: 32,
  width: 32,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 9999,
  border: '1px solid rgba(255,255,255,0.7)',
  color: '#fff',
  fontSize: 14,
  lineHeight: 1,
  boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
  // A press here becomes either a tap (select) or a drag (carry the photo),
  // and on a fine pointer the browser's own text/image selection would
  // otherwise fight both.
  userSelect: 'none',
};

const BADGE_STYLE: CSSProperties = { ...BADGE_BASE, backgroundColor: 'rgba(0,0,0,0.6)' };
const SELECTED_BADGE_STYLE: CSSProperties = { ...BADGE_BASE, backgroundColor: '#6B8B59', border: '1px solid #fff' };

export interface CollageSelectBadgeProps {
  // The whole sentence, not two words: what fits on a 32px badge is a glyph,
  // and a screen reader needs "Choose photo 9 of 16".
  label: string;
  selected: boolean;
  onSelect: () => void;
}

export default function CollageSelectBadge({ label, selected, onSelect }: CollageSelectBadgeProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={selected}
      style={selected ? SELECTED_BADGE_STYLE : BADGE_STYLE}
      // Pointer events are handled by the BOX this sits in (they bubble, and
      // the box is what holds the pointer capture a drag needs), so this
      // handler is only what a keyboard's Enter/Space and a synthetic click
      // reach. It runs after `pointerup` has already selected on a real press,
      // and setting the same id twice is a no-op.
      onClick={onSelect}
      {...{ [COLLAGE_CONTROL_ATTR]: '', [COLLAGE_SELECT_ATTR]: '' }}
    >
      <span aria-hidden="true">{MOVE_GLYPH}</span>
    </button>
  );
}
