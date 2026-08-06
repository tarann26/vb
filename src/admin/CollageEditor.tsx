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
import {
  MAX_COLLAGE_PHOTOS,
  MIN_PAIR_SHARE,
  RESIZE_STEP_SHARE,
  addCollagePhoto,
  collageAddRefusal,
  collagePairShare,
  collagePhotos,
  collageRemoveRefusal,
  collageResizeTarget,
  findCollagePhoto,
  nextCollageId,
  removeCollagePhoto,
  resizeCollageSplit,
  swapCollagePhotos,
} from '../content/collage';
import { COLLAGE_GAP_PX, collageNodePath } from '../content/context';
import type { CollageBox, CollageNode, CollagePhoto, CollageSplit, ContentBundle, SplitDirection } from '../content/types';
import { checkPhotoSize, convertHeic, uploadAndEncode } from './upload-photo';
import { fromStagedPhoto } from './staged';
import type { StagedFile } from './staged';
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

// The divider handle, and the two attributes a test addresses it by.
export const COLLAGE_SPLIT_ATTR = 'data-collage-split-id';
export const COLLAGE_DIVIDER_ATTR = 'data-collage-divider';

// The gap itself is 4px (COLLAGE_GAP_PX) -- far too thin to catch with a
// mouse, let alone a finger. The handle is 16px of hit area centred on it, so
// it overhangs each neighbouring box by 6px; it is absolutely positioned, so
// it takes no space from either and the boxes render exactly as they do on the
// public page. Proven, not assumed: the divider e2e spec measures all sixteen
// photo rectangles at /edit against the same page with no editor and requires
// them to be identical.
const DIVIDER_HIT_PX = 16;
const DIVIDER_OVERHANG_PX = (DIVIDER_HIT_PX - COLLAGE_GAP_PX) / 2;

// While a photo she picked for "add" is on its way up. The tree gains nothing
// until this resolves, so there is never a moment at which a box with no photo
// in it exists -- see `handleAddFile`.
type AddStatus = { kind: 'idle' } | { kind: 'uploading'; percent: number } | { kind: 'error'; message: string };

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
  // /images/... derivative that will not exist until the deploy finishes --
  // and so an ADDED photo shows the file she chose from the moment it lands.
  previews: ImagePreviews;
  // The same shared collector every other picker on the page uses
  // (src/admin/staged.ts). An added photo's BYTES have to reach the same
  // publish as the tree that now names them, or the collage would commit a
  // path pointing at an asset nobody ever sent.
  stage: (key: string, file: StagedFile | null) => void;
}

export function useCollageEditor({ tree, onChange, locked, previews, stage }: CollageEditorOptions): CollageEditor {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [swapArmed, setSwapArmed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Task 6: "add" opens the picker immediately and the tree gains the photo
  // only once the upload has actually returned a path. There is no placeholder
  // stage at any point, which is why `validateContent` needs no rule refusing
  // one: a blank box is unrepresentable rather than merely forbidden.
  const [addStatus, setAddStatus] = useState<AddStatus>({ kind: 'idle' });
  const addInputRef = useRef<HTMLInputElement>(null);
  // Which of the two buttons opened the picker, read back when the file
  // arrives. A ref, not state: nothing draws it, and the change handler must
  // see the value the click set even if no render has happened in between.
  const addDirectionRef = useRef<SplitDirection>('row');
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

  // ---------------------------------------------------------------------
  // Task 5: the divider.

  // Which divider is being dragged, and the split BOX it belongs to -- taken
  // once at pointerdown rather than re-queried on every move, and kept in a
  // ref for the same reason the swap drag is: this fires many times a second
  // and nothing here is drawn.
  const dividerRef = useRef<{ pointerId: number; splitId: string; gapIndex: number; element: Element } | null>(null);

  function handleDividerDown(event: ReactPointerEvent<HTMLDivElement>, split: CollageSplit, gapIndex: number) {
    if (locked || tree === null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const element = event.currentTarget.parentElement;
    if (element === null) return;
    dividerRef.current = { pointerId: event.pointerId, splitId: split.id, gapIndex, element };
    event.currentTarget.setPointerCapture(event.pointerId);
    // Stops the press from also selecting text across the page while she
    // drags. Not `stopPropagation`: the photo boxes' own pointerdown checks
    // for a control under the press and declines, so both can coexist.
    event.preventDefault();
  }

  function handleDividerMove(event: ReactPointerEvent<HTMLDivElement>, split: CollageSplit) {
    const drag = dividerRef.current;
    if (!drag || drag.pointerId !== event.pointerId || tree === null) return;
    const horizontal = split.direction === 'row';
    const rect = drag.element.getBoundingClientRect();
    const extent = horizontal ? rect.width : rect.height;
    // Flexbox subtracts every gap first and distributes what is LEFT by the
    // `flexGrow` factors, so the proportions live in `available`, not in
    // `extent`.
    const available = extent - COLLAGE_GAP_PX * (split.children.length - 1);
    if (available <= 0) return;
    // Where the pointer is in content space: its offset inside the box, less
    // the gaps that lie before this divider, less half of this one (the
    // handle is centred on the gap, so its own centre is the boundary).
    const offset = horizontal ? event.clientX - rect.left : event.clientY - rect.top;
    const contentOffset = offset - COLLAGE_GAP_PX * drag.gapIndex - COLLAGE_GAP_PX / 2;
    const totalSize = split.sizes.reduce((sum, size) => sum + size, 0);
    const before = split.sizes.slice(0, drag.gapIndex).reduce((sum, size) => sum + size, 0);
    const pairTotal = split.sizes[drag.gapIndex] + split.sizes[drag.gapIndex + 1];
    // The boundary, expressed in size units, minus everything before the
    // pair, is how much of the pair the FIRST box should get.
    const firstSize = (contentOffset / available) * totalSize - before;
    const next = resizeCollageSplit(tree, drag.splitId, drag.gapIndex, firstSize / pairTotal);
    if (next !== tree) onChange(next);
  }

  function handleDividerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dividerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dividerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  // Where the boundary between children i and i+1 sits, as a CSS length
  // measured from the box's own start edge. See COLLAGE_GAP_PX
  // (src/content/context.ts) for why the gaps come out of the percentage
  // before the fraction is applied.
  function dividerOffset(split: CollageSplit, gapIndex: number): string {
    const totalSize = split.sizes.reduce((sum, size) => sum + size, 0);
    const beforeSize = split.sizes.slice(0, gapIndex + 1).reduce((sum, size) => sum + size, 0);
    const gapsTotal = COLLAGE_GAP_PX * (split.children.length - 1);
    const fraction = beforeSize / totalSize;
    return `calc((100% - ${gapsTotal}px) * ${fraction} + ${COLLAGE_GAP_PX * gapIndex - DIVIDER_OVERHANG_PX}px)`;
  }

  function dividerStyle(split: CollageSplit, gapIndex: number): CSSProperties {
    const offset = dividerOffset(split, gapIndex);
    const shared: CSSProperties = {
      position: 'absolute',
      zIndex: 30,
      backgroundColor: 'rgba(107,139,89,0.35)',
      touchAction: 'none',
    };
    return split.direction === 'row'
      ? { ...shared, top: 0, bottom: 0, left: offset, width: DIVIDER_HIT_PX, cursor: 'ew-resize' }
      : { ...shared, left: 0, right: 0, top: offset, height: DIVIDER_HIT_PX, cursor: 'ns-resize' };
  }

  function renderCollageSplit(path: string, split: CollageSplit, box: CollageBox, children: ReactNode[]): ReactNode {
    return (
      <div
        key={path}
        className={box.className}
        // `position: relative` is the ONE thing added to the box the public
        // page draws: it makes this the containing block the handles below
        // position against. It changes no layout of its own -- the box is
        // still the same flex item with the same `flexGrow` factor -- and the
        // handles are out of flow, so the children render at exactly the
        // rectangles they render at on the public page.
        style={{ ...box.style, position: 'relative' }}
        {...{ [COLLAGE_SPLIT_ATTR]: split.id }}
      >
        {children}
        {!locked &&
          split.children.slice(0, -1).map((_child, gapIndex) => (
            <div
              // Keyed on the SPLIT's id and the gap, not on the loop index
              // alone: a split's id is stable across every edit, so a handle
              // keeps its DOM (and an in-flight pointer capture) when a
              // sibling elsewhere in the tree changes.
              key={`${split.id}:${gapIndex}`}
              aria-hidden="true"
              style={dividerStyle(split, gapIndex)}
              {...{ [COLLAGE_DIVIDER_ATTR]: `${split.id}:${gapIndex}`, [COLLAGE_CONTROL_ATTR]: '' }}
              onPointerDown={(event) => handleDividerDown(event, split, gapIndex)}
              onPointerMove={(event) => handleDividerMove(event, split)}
              onPointerUp={handleDividerUp}
              onPointerCancel={handleDividerUp}
            />
          ))}
      </div>
    );
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

  // ---------------------------------------------------------------------
  // Task 6: adding a photo, and removing one.

  const addBesideRefusal = tree === null || selected === null ? 'unknown' : collageAddRefusal(tree, selected.id, 'row');
  const addBelowRefusal = tree === null || selected === null ? 'unknown' : collageAddRefusal(tree, selected.id, 'column');
  const removeRefusal = tree === null || selected === null ? 'unknown' : collageRemoveRefusal(tree, selected.id);
  const adding = addStatus.kind === 'uploading';

  // One sentence, chosen from what is actually refused -- never a constant.
  // The depth answer is per DIRECTION on purpose: dividing a box the way its
  // parent already runs adds a sibling rather than a level, so the same box is
  // usually still divisible one way when it is not divisible the other, and
  // saying which way is a real answer rather than a dead end.
  const addReason =
    selected === null
      ? null
      : addBesideRefusal === 'cap' || addBelowRefusal === 'cap'
        ? `The collage already holds ${MAX_COLLAGE_PHOTOS} photos, which is the most it can. Remove one to make room for another.`
        : addBesideRefusal === 'depth' && addBelowRefusal === 'depth'
          ? 'This box has been divided as far as it can be — anything smaller would be too small to see. Make it bigger first, or add the photo somewhere else.'
          : addBesideRefusal === 'depth'
            ? 'This box cannot be divided side by side again — divide it top to bottom instead.'
            : addBelowRefusal === 'depth'
              ? 'This box cannot be divided top to bottom again — divide it side by side instead.'
              : null;

  const removeReason =
    selected !== null && removeRefusal === 'floor'
      ? 'This is the only photo in the collage — there has to be at least one, so it cannot be removed.'
      : null;

  function openPicker(direction: SplitDirection) {
    addDirectionRef.current = direction;
    setAddStatus({ kind: 'idle' });
    // Reset so picking the SAME file twice in a row still fires `change` --
    // an unchanged <input type="file"> value raises no second event.
    if (addInputRef.current !== null) {
      addInputRef.current.value = '';
      addInputRef.current.click();
    }
  }

  async function handleAddFile(fileList: FileList | null) {
    const picked = fileList?.[0];
    if (picked === undefined || tree === null || selected === null) return;
    const direction = addDirectionRef.current;
    const targetId = selected.id;

    let file: File;
    try {
      file = await convertHeic(picked);
    } catch (error) {
      setAddStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Could not read that photo. Try a different one.' });
      return;
    }
    const sizeError = checkPhotoSize(file);
    if (sizeError !== null) {
      setAddStatus({ kind: 'error', message: sizeError });
      return;
    }

    setAddStatus({ kind: 'uploading', percent: 0 });
    // The object URL is created BEFORE the upload, so the moment the box
    // exists it already shows the photo she chose rather than the
    // /images/... derivative the deploy has not written yet.
    const localUrl = URL.createObjectURL(file);
    try {
      const staged = await uploadAndEncode('hero', file, (percent) => setAddStatus({ kind: 'uploading', percent }));
      const id = nextCollageId(tree, 'photo');
      const photo: CollagePhoto = { kind: 'photo', id, src: staged.contentPath, alt: '' };
      const next = addCollagePhoto(tree, targetId, direction, photo);
      if (next === tree) {
        URL.revokeObjectURL(localUrl);
        setAddStatus({ kind: 'error', message: 'That photo could not be added here. Try another box.' });
        return;
      }
      const path = collageNodePath(photo);
      previews.set(path, localUrl);
      // The same key shape EditMode's own renderImage stages under, so a
      // later REPLACEMENT of this very photo supersedes these bytes instead
      // of publishing both.
      stage(`galleries.json:${path}`, fromStagedPhoto(staged));
      onChange(next);
      setAddStatus({ kind: 'idle' });
      setSelectedId(id);
      setSwapArmed(false);
      setNotice({
        photoId: id,
        tone: 'done',
        text:
          direction === 'row'
            ? 'Added beside it. The two now share the box that photo used to fill; nothing else moved.'
            : 'Added below it. The two now share the box that photo used to fill; nothing else moved.',
      });
    } catch (error) {
      URL.revokeObjectURL(localUrl);
      setAddStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Upload failed.' });
    }
  }

  function removeSelected() {
    if (tree === null || selected === null) return;
    const next = removeCollagePhoto(tree, selected.id);
    if (next === tree) return;
    onChange(next);
    setSelectedId(null);
    setSwapArmed(false);
    setNotice({
      photoId: null,
      tone: 'done',
      text: 'Removed. The photos it shared a box with have taken the space back.',
    });
  }

  const selectedIndex = selected === null ? -1 : photos.findIndex((p) => p.id === selected.id);
  const thumbnailSrc = selected === null ? undefined : previews.urls[collageNodePath(selected)] ?? selected.src;

  // ---------------------------------------------------------------------
  // Task 5, Step 3: the same divider, worked by buttons.
  //
  // A divider is a few pixels wide, and on a 390px screen it is not a touch
  // target at all -- the spec's Risks section says so and calls the button
  // path a mandate rather than a preference. Same data, same divider, same
  // conservation rule: these move `collageResizeTarget`'s gap by
  // RESIZE_STEP_SHARE of what the pair shares, which is exactly what dragging
  // the line does continuously.
  const resizeTarget = tree === null || selected === null ? null : collageResizeTarget(tree, selected.id);
  // Defaults to the horizontal pair of words when there is no divider at all
  // (a one-photo collage): both controls are disabled in that case anyway,
  // and "Wider/Narrower" is the natural reading for a box that fills the
  // whole hero.
  const horizontal = resizeTarget === null || resizeTarget.split.direction === 'row';
  // How much of the PAIR the selected box itself holds -- the gap's own share
  // belongs to `children[gapIndex]`, which is this box only when it is the
  // first of the two.
  const ownShare =
    resizeTarget === null
      ? 0
      : resizeTarget.first
        ? collagePairShare(resizeTarget.split, resizeTarget.gapIndex)
        : 1 - collagePairShare(resizeTarget.split, resizeTarget.gapIndex);
  // A hair inside the clamp, so a box sitting exactly on the floor reports
  // itself as stopped rather than offering a tap that would do nothing.
  const CLAMP_EPSILON = 1e-6;
  const canBeBigger = resizeTarget !== null && ownShare < 1 - MIN_PAIR_SHARE - CLAMP_EPSILON;
  const canBeSmaller = resizeTarget !== null && ownShare > MIN_PAIR_SHARE + CLAMP_EPSILON;

  // Never a silent no-op: at every boundary the control goes disabled AND a
  // sentence says which boundary it is. This project has shipped a control
  // that quietly did nothing before.
  const resizeReason =
    selected === null
      ? null
      : resizeTarget === null
        ? 'This photo fills the whole collage — there is nothing beside it to take the space from.'
        : !canBeBigger
          ? horizontal
            ? 'This box is as wide as it goes — the photo beside it needs room too.'
            : 'This box is as tall as it goes — the photo below it needs room too.'
          : !canBeSmaller
            ? horizontal
              ? 'This box is as narrow as it goes — any less and you could not see what is in it.'
              : 'This box is as short as it goes — any less and you could not see what is in it.'
            : null;

  function changeSelectedSize(delta: number) {
    if (tree === null || resizeTarget === null) return;
    const nextOwn = ownShare + delta;
    const next = resizeCollageSplit(
      tree,
      resizeTarget.split.id,
      resizeTarget.gapIndex,
      resizeTarget.first ? nextOwn : 1 - nextOwn,
    );
    if (next !== tree) onChange(next);
  }

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
            // `flex-wrap`, so the button group drops onto its own line rather
            // than being squeezed beside the thumbnail at 390px -- there are
            // seven controls here and a phone has room for about three
            // across.
            <div className="flex flex-wrap items-center gap-3">
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
                    : 'Drag it onto another photo to trade places, or drag the line beside it to change how big it is — or use the buttons here.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-label={
                    horizontal
                      ? 'Make this photo wider, and the one beside it narrower'
                      : 'Make this photo taller, and the one beside it shorter'
                  }
                  disabled={locked || !canBeBigger}
                  onClick={() => changeSelectedSize(RESIZE_STEP_SHARE)}
                  className="rounded border border-gray-300 bg-white px-3 py-2 font-['Montserrat'] text-sm text-[#222] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {horizontal ? 'Wider' : 'Taller'}
                </button>
                <button
                  type="button"
                  aria-label={
                    horizontal
                      ? 'Make this photo narrower, and the one beside it wider'
                      : 'Make this photo shorter, and the one beside it taller'
                  }
                  disabled={locked || !canBeSmaller}
                  onClick={() => changeSelectedSize(-RESIZE_STEP_SHARE)}
                  className="rounded border border-gray-300 bg-white px-3 py-2 font-['Montserrat'] text-sm text-[#222] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {horizontal ? 'Narrower' : 'Shorter'}
                </button>
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
                  aria-label="Add another photo beside this one, sharing its box"
                  disabled={locked || adding || addBesideRefusal !== null}
                  onClick={() => openPicker('row')}
                  className="rounded border border-gray-300 bg-white px-3 py-2 font-['Montserrat'] text-sm text-[#222] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add beside
                </button>
                <button
                  type="button"
                  aria-label="Add another photo below this one, sharing its box"
                  disabled={locked || adding || addBelowRefusal !== null}
                  onClick={() => openPicker('column')}
                  className="rounded border border-gray-300 bg-white px-3 py-2 font-['Montserrat'] text-sm text-[#222] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add below
                </button>
                <button
                  type="button"
                  aria-label="Remove this photo from the collage"
                  disabled={locked || adding || removeRefusal !== null}
                  onClick={removeSelected}
                  className="rounded border border-gray-300 bg-white px-3 py-2 font-['Montserrat'] text-sm text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
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
                {/* The picker itself. "Add" opens it immediately rather than
                    inserting an empty box she then has to find the camera
                    badge inside -- two steps for one intention, and a blank
                    box that reached the live homepage would be worse than no
                    button at all. `sr-only` rather than `display: none`: a
                    hidden input cannot be clicked programmatically in every
                    browser, and this one is opened by the buttons above. */}
                <input
                  ref={addInputRef}
                  type="file"
                  accept="image/*"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="sr-only"
                  onChange={(event) => {
                    void handleAddFile(event.target.files);
                    event.target.value = '';
                  }}
                />
              </div>
            </div>
          )}
          {resizeReason !== null && (
            <p className="mt-2 font-['Montserrat'] text-xs text-gray-500">{resizeReason}</p>
          )}
          {addReason !== null && <p className="mt-2 font-['Montserrat'] text-xs text-gray-500">{addReason}</p>}
          {removeReason !== null && <p className="mt-2 font-['Montserrat'] text-xs text-gray-500">{removeReason}</p>}
          {addStatus.kind === 'uploading' && (
            <p role="status" className="mt-2 font-['Montserrat'] text-xs text-gray-500">
              {`Adding the photo… ${addStatus.percent}%`}
            </p>
          )}
          {addStatus.kind === 'error' && (
            <p role="alert" className="mt-2 font-['Montserrat'] text-sm text-red-700">
              {addStatus.message}
            </p>
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

  return { renderCollagePhoto, renderCollageSplit, panel };
}
