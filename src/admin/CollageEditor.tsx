// The hero collage's editing surface at `/edit`, and the replacement for the
// deleted `CollageTile.tsx`.
//
// Nothing here renders on the public page. It plugs into the two node seams
// Hero.tsx already calls for every node of the tree -- `renderCollagePhoto`
// and `renderCollageSplit` (src/content/types.ts's ContentBundle) -- which
// default to the real public renderers in src/content/context.ts. This module
// wraps those, adding the affordances and nothing else: the boxes, their
// class names and their inline sizing all still come from `box`, spread
// verbatim, so an override here can never silently change where a photo sits.
//
// TASK 4 (this file's first shape): drag one photo onto another and the two
// exchange places. The owner's own words for the gesture -- "The boxes keep
// their shape. The photos are the ones -- it's like the photo fills the box
// it travels to" -- are exactly what `swapCollagePhotos`
// (src/content/collage.ts) does: two payloads move, no split, no size and no
// box changes at all.
//
// Two paths to the same edit, because a drag is not available on every
// device:
//
//   * POINTER DRAG (mouse and pen). Press on a photo, move, release over
//     another photo. Deliberately NOT armed for `pointerType === 'touch'`:
//     making a touch drag work at all needs `touch-action: none` on the drag
//     surface, and this surface is the whole hero -- sixteen boxes covering
//     the top screenful of a 4800px page -- so that one line would stop a
//     phone scrolling past the hero at /edit. The collage container is
//     `absolute inset-0` inside a `min-h-screen` section, so there is no part
//     of the hero a finger could land on that is not one of these boxes.
//
//   * TAP TO SELECT, THEN CHOOSE (touch, and keyboard). Tapping a photo puts
//     it in the panel at the bottom of the screen; "Swap with another photo"
//     then turns every OTHER photo into a real, labelled <button> she taps.
//     Same data, same operation, no dragging -- the shape the spec's Risks
//     section mandates for phones, and the one that also makes this reachable
//     from a keyboard.
//
// Focus doubles as selection (`onFocusCapture` on each box): the camera badge
// EditableImage already puts inside every photo is focusable, so tabbing
// through the collage moves the panel from photo to photo with no extra tab
// stops added and no `tabIndex` on a box that also contains a file input --
// a `role="button"` wrapper around interactive content is exactly the nesting
// that makes a control unreachable to a screen reader.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { collagePhotos, findCollagePhoto, swapCollagePhotos } from '../content/collage';
import { collageNodePath, defaultRenderCollageSplit } from '../content/context';
import type { CollageBox, CollageNode, CollagePhoto, ContentBundle } from '../content/types';
import CollageControlButton, { COLLAGE_CONTROL_ATTR } from './CollageControlButton';
import type { ImagePreviews } from './previews';

// Every photo box carries its own photo id, so a drop can ask the DOM what is
// under the pointer (`document.elementFromPoint`) and get an answer in tree
// terms. Exported because e2e/collage-swap.spec.ts locates boxes by it, and a
// selector spelled twice is a selector that drifts.
export const COLLAGE_PHOTO_ATTR = 'data-collage-photo-id';

// How far the pointer has to travel before a press counts as a drag rather
// than a tap. Small enough that a deliberate drag is never mistaken for a
// tap, large enough that the hand tremor in a click never selects nothing.
const DRAG_THRESHOLD_PX = 6;

// How long a notice stays on screen. Long enough to read a sentence, short
// enough that it is gone before she wonders whether it is still true.
const NOTICE_MS = 5000;

// ---------------------------------------------------------------------------
// The chrome each box wears while a gesture is in flight. Inline styles, not
// class names, deliberately: these are /edit-only decorations, and this
// project's Tailwind content scan has no JS parser -- every class name written
// here would land a rule in the ONE stylesheet every public visitor
// downloads. A number in `style` is invisible to that scan by construction,
// which is the same reason the tree's own sizes are numbers (see
// src/content/collage.ts's header).
//
// A separate absolutely-positioned child rather than a `box-shadow` on the
// box itself: an inset shadow paints below the element's own content, and the
// content here is a photograph filling the whole box, so it would never be
// seen. `zIndex: 10` puts this above the <img> and below EditableImage's own
// camera badge (`z-20`), which must stay clickable -- the exact stacking
// comparison e2e/collage-hit-test.spec.ts exists to keep honest.
const OVERLAY_BASE: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 10,
  pointerEvents: 'none',
};

type OverlayKind = 'selected' | 'dragging' | 'target' | 'refused';

const OVERLAY_STYLE: Record<OverlayKind, CSSProperties> = {
  selected: { ...OVERLAY_BASE, boxShadow: 'inset 0 0 0 3px #6B8B59' },
  // The photo currently being carried: paled, so the one under the pointer
  // reads as the destination rather than as a second selection.
  dragging: { ...OVERLAY_BASE, backgroundColor: 'rgba(255,255,255,0.55)', boxShadow: 'inset 0 0 0 3px #6B8B59' },
  target: { ...OVERLAY_BASE, backgroundColor: 'rgba(107,139,89,0.35)', boxShadow: 'inset 0 0 0 4px #6B8B59' },
  // A drop that could not be completed. Amber, held for as long as the
  // sentence in the panel is -- the two are one message, and this is the half
  // that says WHICH photo stayed put.
  refused: { ...OVERLAY_BASE, backgroundColor: 'rgba(217,119,6,0.28)', boxShadow: 'inset 0 0 0 4px #B45309' },
};

const SWAP_TARGET_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(107,139,89,0.45)',
  color: '#fff',
  cursor: 'pointer',
};

const THUMBNAIL_STYLE: CSSProperties = { width: 64, height: 64, objectFit: 'cover' };

interface Notice {
  // Which photo the sentence is about, so its own box can carry the matching
  // highlight. `null` for a message about no particular photo.
  photoId: string | null;
  text: string;
  // 'refused' is the only tone that marks a box: a message about something
  // that did NOT happen has to say which photo it is about, because nothing
  // moved to show her.
  tone: 'refused' | 'done';
}

export interface CollageEditor {
  renderCollagePhoto: ContentBundle['renderCollagePhoto'];
  renderCollageSplit: ContentBundle['renderCollageSplit'];
  // Rendered by EditMode OUTSIDE its capture-phase click guard, so the panel
  // needs no carve-out of its own to be clickable.
  panel: ReactNode;
}

export interface CollageEditorOptions {
  tree: CollageNode | null;
  onChange: (next: CollageNode) => void;
  // True only while a publish request is in flight. Every gesture and every
  // control is refused, and the panel says so rather than going dead -- the
  // same "dims and reports itself busy, not just dead" posture the dashboard
  // takes.
  locked: boolean;
  // So the panel's thumbnail shows the photo she just picked, not the
  // /images/... derivative that will not exist until the deploy finishes.
  previews: ImagePreviews;
}

export function useCollageEditor({ tree, onChange, locked, previews }: CollageEditorOptions): CollageEditor {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [swapArmed, setSwapArmed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The transient half of a drag -- read and written inside pointer handlers
  // that fire many times a second. Kept out of state on purpose: re-rendering
  // sixteen boxes on every pointermove to store a number nothing draws is the
  // difference between a drag that tracks the cursor and one that stutters.
  const dragRef = useRef<{ pointerId: number; photoId: string; x: number; y: number; canDrag: boolean; moved: boolean } | null>(
    null,
  );

  const photos = tree === null ? [] : collagePhotos(tree);
  const selected = tree !== null && selectedId !== null ? findCollagePhoto(tree, selectedId) : null;

  // Clears itself, and re-arms from scratch whenever a NEW notice object
  // arrives. `setNotice` is the only thing that changes this identity, so an
  // unrelated re-render never restarts the clock.
  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // A photo that is no longer in the tree cannot stay selected: it would hold
  // the panel open over a box that does not exist. Reachable today only by a
  // second tab editing the same content, and by Task 6's remove.
  useEffect(() => {
    if (selectedId !== null && selected === null) {
      setSelectedId(null);
      setSwapArmed(false);
    }
  }, [selectedId, selected]);

  const performSwap = useCallback(
    (fromId: string, toId: string) => {
      if (tree === null) return;
      const next = swapCollagePhotos(tree, fromId, toId);
      if (next === tree) {
        setNotice({ photoId: fromId, tone: 'refused', text: 'Those two photos could not be exchanged — nothing moved.' });
        return;
      }
      onChange(next);
      setSwapArmed(false);
      setSelectedId(toId);
      setNotice({
        photoId: toId,
        tone: 'done',
        text: 'Swapped. The two photos exchanged places; both boxes are exactly the size they were.',
      });
    },
    [tree, onChange],
  );

  function finishDrag(dropped: Element | null, photoId: string) {
    const droppedOn = dropped?.closest(`[${COLLAGE_PHOTO_ATTR}]`)?.getAttribute(COLLAGE_PHOTO_ATTR) ?? null;
    setDragId(null);
    setHoverId(null);
    if (droppedOn !== null && droppedOn !== photoId) {
      performSwap(photoId, droppedOn);
      return;
    }
    // The plan's own rule, and the reason it is a rule: "a silent snap-back
    // reads exactly like the inert camera badge this project already shipped
    // once." So a refused drop says what happened, in a sentence, and marks
    // the photo it is about.
    setNotice({
      photoId,
      tone: 'refused',
      text:
        droppedOn === null
          ? 'Nothing to swap with there — this photo stayed where it was. Drop it on top of another photo.'
          : 'That is the same photo — it stayed where it was.',
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>, photoId: string) {
    if (locked) return;
    // The camera badge, and every control this module renders, keep their own
    // clicks: a press that starts on one of them is never a drag.
    if (event.target instanceof Element && event.target.closest(`label, button, [${COLLAGE_CONTROL_ATTR}]`)) return;
    // Left button only for a mouse; any contact for pen and touch.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const canDrag = event.pointerType !== 'touch';
    dragRef.current = { pointerId: event.pointerId, photoId, x: event.clientX, y: event.clientY, canDrag, moved: false };
    // Touch pointers are implicitly captured by the spec, so capturing here
    // would add nothing; for mouse and pen it is what keeps a fast drag from
    // losing its own pointerup to whatever it passed over.
    if (canDrag) event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !drag.canDrag) return;
    if (!drag.moved) {
      const travelled = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
      if (travelled < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragId(drag.photoId);
      setNotice(null);
    }
    // What is really under the pointer, asked of the browser rather than
    // inferred from which element the event was routed to -- pointer capture
    // sends every move to the box the drag STARTED on, so the event's own
    // target is always the source box and would name the wrong destination
    // every time.
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const overId = under?.closest(`[${COLLAGE_PHOTO_ATTR}]`)?.getAttribute(COLLAGE_PHOTO_ATTR) ?? null;
    // Recorded even when it is the box the drag STARTED on. Excluding that
    // case would be a branch nothing could distinguish: `overlayFor` below
    // asks "is this the photo being carried?" before it asks "is this the
    // destination?", so a box that is both is drawn as the carried one either
    // way -- which is also the right answer, since dropping a photo on itself
    // moves nothing.
    setHoverId(overId);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>, photoId: string) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.canDrag && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) {
      setSelectedId(photoId);
      setSwapArmed(false);
      return;
    }
    finishDrag(document.elementFromPoint(event.clientX, event.clientY), photoId);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>, photoId: string) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    dragRef.current = null;
    setDragId(null);
    setHoverId(null);
    if (moved) {
      setNotice({ photoId, tone: 'refused', text: 'That drag was interrupted — this photo stayed where it was.' });
    }
  }

  function overlayFor(photoId: string): OverlayKind | null {
    if (dragId === photoId) return 'dragging';
    if (hoverId === photoId) return 'target';
    if (notice !== null && notice.tone === 'refused' && notice.photoId === photoId) return 'refused';
    if (selectedId === photoId) return 'selected';
    return null;
  }

  function renderCollagePhoto(path: string, photo: CollagePhoto, box: CollageBox, image: ReactNode): ReactNode {
    const overlay = overlayFor(photo.id);
    const swapSourceId = swapArmed && !locked ? selectedId : null;
    const armedTarget = swapSourceId !== null && swapSourceId !== photo.id;
    return (
      <div
        key={path}
        className={box.className}
        // `box.style` first and spread whole -- the sizing this box was given
        // is never something this file may drop or reorder around.
        style={{ ...box.style, userSelect: 'none', cursor: locked ? 'default' : 'pointer' }}
        {...{ [COLLAGE_PHOTO_ATTR]: photo.id }}
        // Native HTML5 image drag would otherwise take over the pointer
        // sequence the moment the press lands on the <img>. `dragstart`
        // bubbles, so cancelling it HERE does the whole job -- and, unlike a
        // `draggable={false}` on the image itself, it costs the public page
        // nothing, because this handler only exists at /edit. Hero.tsx's own
        // comment at the renderImage call site records the same conclusion
        // and the 288 public bytes the other spelling cost last time.
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => handlePointerDown(event, photo.id)}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => handlePointerUp(event, photo.id)}
        onPointerCancel={(event) => handlePointerCancel(event, photo.id)}
        onFocusCapture={() => {
          if (!swapArmed) setSelectedId(photo.id);
        }}
      >
        {image}
        {overlay !== null && (
          // `data-collage-overlay` names WHICH state this is, so a browser
          // test can assert that the box under the pointer really is marked
          // as the destination MID-DRAG. Without it the only observable
          // difference between highlighting the target and not highlighting
          // it is a colour, and the plan's "show the target before the drop"
          // would be a claim nothing could check.
          <span aria-hidden="true" data-collage-overlay={overlay} style={OVERLAY_STYLE[overlay]} />
        )}
        {armedTarget && (
          <CollageControlButton
            label="Swap the selected photo into this box"
            onActivate={() => performSwap(swapSourceId, photo.id)}
            className="font-['Montserrat'] text-xs font-semibold"
            style={SWAP_TARGET_STYLE}
          >
            Swap here
          </CollageControlButton>
        )}
      </div>
    );
  }

  const selectedIndex = selected === null ? -1 : photos.findIndex((p) => p.id === selected.id);
  const thumbnailSrc = selected === null ? undefined : previews.urls[collageNodePath(selected)] ?? selected.src;

  const panel =
    selected === null && notice === null ? null : (
      <div
        // Named so a test can address THIS panel's own status line rather
        // than whatever else on /edit happens to carry role="status" (the
        // Publish bar's validation summary does) -- the same reason
        // EditableImage carries `data-editable-image-path`.
        data-collage-panel=""
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.15)]"
      >
        <div className="mx-auto max-w-3xl">
          {selected !== null && (
            <div className="flex items-center gap-3">
              {/* A thumbnail, not "Photo 5 of the collage" -- the owner's own
                  objection to the panel this replaces was that it "has no
                  information in it". */}
              <img
                src={thumbnailSrc}
                alt=""
                className="flex-shrink-0 rounded border border-gray-200"
                style={THUMBNAIL_STYLE}
              />
              <div className="flex-1">
                <p className="font-['Montserrat'] text-sm text-[#222]">{`Photo ${selectedIndex + 1} of ${photos.length}`}</p>
                <p className="font-['Montserrat'] text-xs text-gray-500">
                  {swapArmed
                    ? 'Now tap the photo you want it to trade places with.'
                    : 'Drag it onto another photo to trade places, or use the button.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Plain buttons, deliberately NOT CollageControlButton.
                    That component exists to stamp `data-collage-control` on a
                    control living INSIDE the page, so EditMode's capture-phase
                    click guard lets it through; this panel is rendered outside
                    that guard entirely and needs no exemption. Giving these
                    the marker anyway would make the placement untestable --
                    the panel could be moved inside the guard and every button
                    would keep working, so nothing would ever notice. */}
                <button
                  type="button"
                  aria-label={swapArmed ? 'Cancel the swap' : 'Swap this photo with another photo'}
                  disabled={locked || photos.length < 2}
                  onClick={() => setSwapArmed((armed) => !armed)}
                  className="rounded border border-gray-300 bg-white px-3 py-2 font-['Montserrat'] text-sm text-[#222] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {swapArmed ? 'Cancel' : 'Swap with another photo'}
                </button>
                <button
                  type="button"
                  aria-label="Close this panel"
                  onClick={() => {
                    setSelectedId(null);
                    setSwapArmed(false);
                  }}
                  className="rounded border border-gray-300 bg-white px-3 py-2 font-['Montserrat'] text-sm text-[#222]"
                >
                  Done
                </button>
              </div>
            </div>
          )}
          {locked && (
            <p className="mt-2 font-['Montserrat'] text-xs text-gray-500">
              Publishing… arranging the collage is paused for a moment.
            </p>
          )}
          {notice !== null && (
            <p role="status" className="mt-2 font-['Montserrat'] text-sm text-[#222]">
              {notice.text}
            </p>
          )}
        </div>
      </div>
    );

  // The split seam is the PUBLIC renderer, unchanged, until Task 5 gives it
  // dividers -- one definition rather than a second copy of the same four
  // lines living here.
  return { renderCollagePhoto, renderCollageSplit: defaultRenderCollageSplit, panel };
}
