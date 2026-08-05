// Plan 6, Task 3/4: the collage's own move/size-change control -- buttons
// (Task 3, always present, every device, every input) plus drag (Task 4,
// fine pointers only). Buttons come before drag deliberately -- the spec's
// Risks section mandates them on touch, they double as the keyboard
// interface, and they satisfy the goal on every device a mouse, a phone or
// a keyboard can reach. Drag is the droppable piece if scope must be cut,
// not the buttons.
//
// This is `/edit`'s own override of `content.renderCollageTile`
// (src/content/context.ts's default just renders the tile `<div>` inline,
// unaware anything is editable -- see that module's own comment). Every
// move or size change -- button or drag -- goes through the exact same
// arithmetic (`moveTile`/`resizeTile`, src/content/placement.ts) and the
// same `isOnGrid` check `validateContent` uses server-side -- "if the
// button path and the drag path can produce different results from the
// same intent, you have two implementations and one is wrong" (this
// plan's own Task 3 Step 1).
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Move, Plus, X } from 'lucide-react';
import {
  GRID_SIZE,
  currentResolved,
  formatPlacement,
  isOnGrid,
  moveTile,
  parsePlacement,
  resizeTile,
  resolveLayout,
  type MoveDirection,
  type ResizeAxis,
  type ResolvedPlacement,
} from '../content/placement';

export interface CollageTileProps {
  index: number;
  // This tile's OWN current placement string -- read fresh on every render
  // (not cached), so a move committed a moment ago is reflected immediately
  // the next time this component asks "where am I now."
  className: string;
  // Every heroCollage className, in document order -- what `moveTile`/
  // `resizeTile` need to resolve THIS tile's current position (Task 4 Step
  // 3's own finding: an auto-placed tile has no position in its own
  // className to read, only `resolveLayout`, across every sibling, knows
  // where it currently sits).
  classNames: readonly string[];
  // The already-rendered image for this tile (Hero.tsx's own
  // `content.renderImage(...)` call, passed straight through) -- this
  // component never re-derives how a collage photo is rendered, or where
  // its own camera-replace badge (EditableImage.tsx) sits. Native HTML5
  // image drag (Task 4 Step 1's own requirement to defeat, since it would
  // otherwise hijack the pointer sequence a real drag-to-move needs) is
  // stopped by this component's own `onDragStart` on the tile wrapper
  // (I-A fix) instead of a `draggable={false}` on the `<img>` itself --
  // `dragstart` bubbles, so cancelling it here works without Hero.tsx (the
  // PUBLIC page) needing to know anything is editable at all.
  image: React.ReactNode;
  selected: boolean;
  onSelect: (index: number | null) => void;
  // Writes `formatPlacement(candidate)` back for `index` -- EditMode.tsx's
  // own `commitCollagePlacement`, which is what actually calls
  // `registry.updateData` (never `register`) and keeps the same
  // "photo replaced this session AND moved" guarantee `EditableImage`'s own
  // index-keyed staging already provides, untouched by this component.
  onCommit: (index: number, nextClassName: string) => void;
  // Set while a publish request is actually in flight (PublishBar's own
  // `onPublishLockChange`, threaded through EditMode's buildBundle). Takes
  // every control off -- the select button, the drag handlers, the corner
  // grip and the move/resize panel -- while leaving this component, and
  // therefore `image` and everything under it, MOUNTED.
  //
  // ("corner grip", not the obvious word for what that control does, and
  // that is not a style preference: this project's Tailwind scan has no JS
  // parser, so that word standing alone in a comment emits a real rule into
  // the shipped stylesheet. Measured, not guessed -- the first draft of this
  // very comment added exactly one 20-byte rule, caught by the rule-level
  // build diff this project's standing instruction requires. Same hazard
  // tailwind.config.js's own `blocklist` comment documents, and the same one
  // EditableText.tsx's className comment records having hit.)
  //
  // Review finding (Important): /edit used to express the pause by swapping
  // this component for a plain <div> with the same classes. React sees two
  // different element types at the same position and unmounts the whole
  // subtree, `image` included -- which for a collage photo she had just
  // replaced meant EditableImage's local preview was destroyed and its
  // object URL revoked, leaving a broken image (the not-yet-built derivative
  // path) for the rest of the session. Keeping the component and dropping
  // only the affordances gives the same "nothing here responds" result
  // without tearing anything down.
  locked?: boolean;
}

type Action = { kind: 'move'; direction: MoveDirection } | { kind: 'span'; axis: ResizeAxis; delta: number };

interface ActionButton {
  action: Action;
  label: string;
  refusalLabel: string;
  Icon: typeof ArrowUp;
}

// Four arrows to move, plus/minus per axis to change its size -- exactly
// the spec's own Task 3 Step 1 mandate, no more controls than that.
const UP: ActionButton = { action: { kind: 'move', direction: 'up' }, label: 'Move up', refusalLabel: 'move up', Icon: ArrowUp };
const DOWN: ActionButton = { action: { kind: 'move', direction: 'down' }, label: 'Move down', refusalLabel: 'move down', Icon: ArrowDown };
const LEFT: ActionButton = { action: { kind: 'move', direction: 'left' }, label: 'Move left', refusalLabel: 'move left', Icon: ArrowLeft };
const RIGHT: ActionButton = { action: { kind: 'move', direction: 'right' }, label: 'Move right', refusalLabel: 'move right', Icon: ArrowRight };
const NARROWER: ActionButton = { action: { kind: 'span', axis: 'col', delta: -1 }, label: 'Narrower', refusalLabel: 'make this narrower', Icon: Minus };
const WIDER: ActionButton = { action: { kind: 'span', axis: 'col', delta: 1 }, label: 'Wider', refusalLabel: 'make this wider', Icon: Plus };
const SHORTER: ActionButton = { action: { kind: 'span', axis: 'row', delta: -1 }, label: 'Shorter', refusalLabel: 'make this shorter', Icon: Minus };
const TALLER: ActionButton = { action: { kind: 'span', axis: 'row', delta: 1 }, label: 'Taller', refusalLabel: 'make this taller', Icon: Plus };

function candidateFor(classNames: readonly string[], index: number, action: Action): ResolvedPlacement | null {
  return action.kind === 'move'
    ? moveTile(classNames, index, action.direction)
    : resizeTile(classNames, index, action.axis, action.delta);
}

// Task 4 Step 3: "pinning one tile relocates others" -- three of the real
// sixteen entries have an auto row or column, so committing THIS tile's
// placement can change where an UNTOUCHED sibling resolves, as a side
// effect of the shared auto-placement cursor. Compared before/after across
// every OTHER index, not just counted from the moved tile's own delta,
// because a sibling's resolved position can change even when its own
// className did not. Silently is not an answer (this task's own words) --
// this is what lets a caller tell her.
function describeSideEffects(classNames: readonly string[], index: number, nextClassName: string): string | null {
  const before = resolveLayout(classNames.map((c) => parsePlacement(c)));
  const after = resolveLayout(classNames.map((c, i) => parsePlacement(i === index ? nextClassName : c)));
  const movedSiblings = before.filter((_, i) => i !== index && JSON.stringify(before[i]) !== JSON.stringify(after[i])).length;
  if (movedSiblings === 0) return null;
  return `${movedSiblings} other photo${movedSiblings === 1 ? '' : 's'} also moved to make room.`;
}

// Real Chromium finding (Task 4's own report): checking `isOnGrid` on only
// the MOVED tile's own candidate is not enough. A move can be perfectly
// legal for the tile itself and still push an auto-placed SIBLING off-grid
// as a cascading side effect of "pinning one tile relocates others" (Task 4
// Step 3) -- confirmed directly, dragging the real tile 7 up one row: its
// own candidate resolves fine, but the cascade pushes tiles 0 and 2 off the
// grid, and `validateContent` (the server-side authority,
// `commitCollagePlacement` in EditMode.tsx) correctly refuses the whole
// write -- SILENTLY, with nothing in this component's own UI explaining
// why, before this fix. Resolving every OTHER tile too, not just the one
// being moved, is what lets this refuse the drag/button press BEFORE ever
// calling `onCommit`, with the same visible feedback every other refusal
// already has.
function wouldStayOnGrid(classNames: readonly string[], index: number, nextClassName: string): boolean {
  const after = resolveLayout(classNames.map((c, i) => parsePlacement(i === index ? nextClassName : c)));
  return after.every((r) => isOnGrid(r));
}

// One shared attribute, carried by EVERY interactive element this
// component renders, including the ones inside the portal panel below --
// EditMode.tsx's capture-phase click guard (its own `handleCaptureClick`)
// walks the REAL DOM via `.closest()`, and a `createPortal`-rendered
// subtree's real DOM ancestors are `document.body`'s, never this tile's own
// wrapper `<div>`. React's synthetic event system still calls that guard
// (a portal stays in the REACT tree for event-bubbling purposes), but a
// carve-out keyed on DOM nesting alone would miss the panel entirely unless
// every element in it carries this marker directly -- there is no single
// portal "root" node the guard could key on instead. See EditMode.tsx's own
// comment on this carve-out for why every other affordance on this page
// needed one too.
const CONTROL_ATTR = { 'data-collage-control': 'true' } as const;

interface ControlButtonProps {
  label: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}

// Every button in this component is one of these -- centralising
// `CONTROL_ATTR` here means it is impossible to add a new control and
// forget the one attribute that keeps it from being silently swallowed by
// EditMode's own click guard.
const ControlButton: React.FC<ControlButtonProps> = ({ label, onClick, className, children }) => (
  <button type="button" {...CONTROL_ATTR} aria-label={label} title={label} onClick={onClick} className={className}>
    {children}
  </button>
);

const PANEL_BUTTON_CLASSNAME =
  'flex h-9 w-9 items-center justify-center rounded border border-gray-300 text-[#222] hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6B8B59]';

// Persistently visible, never hover-gated -- the same mandate every other
// edit affordance in this codebase follows (EditableText.tsx's own
// className comment, EditableImage.tsx's CONTROL_LABEL_CLASSNAME), because
// a hover-revealed control is invisible on a touchscreen, which has no
// hover state at all. `top-1 left-1`, deliberately the OPPOSITE corner from
// EditableImage's own camera badge (`bottom-1 right-1`, inside every
// collage tile) -- review finding C5: at a ~60px tile on a 390px screen the
// camera badge alone already covers more than a quarter of the cell, and a
// second control sharing that corner would be unreachable as two distinct
// targets. Opposite corners is what makes "select this photo's position"
// and "replace this photo" separately tappable at the smallest real size
// this collage renders at.
//
// `z-20`, not `z-10` -- found and fixed together with EditableImage.tsx's
// own identical problem (see that file's own CONTROL_LABEL_CLASSNAME
// comment for the full story): Hero.tsx's `relative z-10` main-content div
// sits later in the DOM than the collage grid, so at an EQUAL z-index it
// always won the hit-test tie -- confirmed directly, in a real Chromium
// build: EVERY ONE of the sixteen select buttons was unreachable by a real
// click before this fix, not just the ones visually under the logo circle
// (a block-level `<p>`'s hit box spans its full container width even where
// the visible text is short and centred, so the tagline/strapline/phone
// number paragraphs blocked tiles nowhere near the circle itself).
const SELECT_BUTTON_CLASSNAME =
  'absolute top-1 left-1 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-black/60 text-white shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6B8B59]';

const SELECTED_BUTTON_CLASSNAME =
  'absolute top-1 left-1 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white bg-[#6B8B59] text-white shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';

// Task 4 Step 1: `matchMedia('(pointer: coarse)')`, not viewport width --
// a small laptop window has a mouse and a large tablet does not, and only
// the POINTER matters for whether a drag gesture can even start cleanly.
// Decision, stated once here and not re-litigated at each call site: drag
// is fine-pointer only. Coarse pointers get the buttons above and nothing
// else -- Task 3's own buttons already satisfy the goal on a touchscreen
// (the spec's Risks section mandate this task opened with), and touch-drag
// on a grid this dense would compete with the page's own scroll gesture
// for the exact gesture recognition window a drag needs; `touch-action:
// none` would fix that at the cost of breaking normal scroll over every
// collage tile on a phone, which this plan will not trade away.
function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

interface DragOrigin {
  pointerId: number;
  clientX: number;
  clientY: number;
  cellW: number;
  cellH: number;
  placement: ResolvedPlacement;
}

// Task 4 Step 2: snaps to whole cells -- the pointer's raw pixel delta is
// divided by one cell's own measured size and rounded, never applied as a
// continuous pixel offset. Measured from the GRID CONTAINER (the tile's own
// parent), not from this tile's own rendered size: a tile that spans more
// than one column/row would otherwise give a systematically wrong cell
// size (its own box already includes the internal gap between its spanned
// tracks).
function measureCell(tileEl: HTMLElement): { cellW: number; cellH: number } | null {
  // `gridEl`, not the bare name this variable had in an earlier draft --
  // Tailwind's content scanner has no JS parser (this project's own
  // standing WATCH): a negated one-word variable of that exact name, right
  // after this comment's own null check, reads as the important-modifier
  // spelling of the real, already-used bare utility sharing that name, and
  // emitted an unused rule for it. Confirmed directly with the rule-level
  // build diff this project's own standing instruction requires for every
  // task -- deliberately not spelling either string out literally in this
  // comment a second time, for the same reason.
  const gridEl = tileEl.parentElement;
  if (gridEl === null) return null;
  const rect = gridEl.getBoundingClientRect();
  const style = getComputedStyle(gridEl);
  // Minor review finding: reused `columnGap` for BOTH axes used to be
  // correct only because Hero.tsx's real `gap-1` is symmetric -- silently
  // wrong the day the column and row gap ever diverge (a future
  // `gap-x-*`/`gap-y-*`, or a hand-edited style). Reading `rowGap`
  // separately for the row axis costs nothing today (it equals
  // `columnGap` on the real page) and stops that from being a latent trap.
  const columnGapPx = parseFloat(style.columnGap || '0') || 0;
  const rowGapPx = parseFloat(style.rowGap || '0') || 0;
  return {
    cellW: (rect.width - columnGapPx * (GRID_SIZE - 1)) / GRID_SIZE,
    cellH: (rect.height - rowGapPx * (GRID_SIZE - 1)) / GRID_SIZE,
  };
}

function placementStyle(p: ResolvedPlacement): React.CSSProperties {
  return {
    gridColumn: `${p.colStart} / span ${p.colSpan}`,
    gridRow: `${p.rowStart} / span ${p.rowSpan}`,
  };
}

// I-F fix: the move/size panel below is `createPortal`'d to the very end of
// `document.body`, so its own place in the DOM's natural Tab order has
// nothing to do with where the tile that opened it sits on screen -- real
// Chromium measured 101 Tab presses to reach it from the select button that
// opens it (past all sixteen tiles AND the rest of the homepage). Rather
// than fight the portal's DOM position, the panel traps Tab within itself
// while open (this function finds its boundary elements) and focus is moved
// in/out of it explicitly (see the `useEffect` below) -- the same pattern
// every dialog/disclosure widget uses for exactly this reason.
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

// A fixed panel at the bottom of the viewport, not an overlay confined to
// the tile itself -- the spec's own Risks section computes a ~60px cell at
// 390px, nowhere near enough room for eight real, tappable buttons plus a
// status line. Rendered via `createPortal` into `document.body` so its own
// size is never constrained by the tiny grid cell it was opened from.
const CollageTile: React.FC<CollageTileProps> = ({ index, className, classNames, image, selected, onSelect, onCommit, locked = false }) => {
  const [refusedMessage, setRefusedMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  // The tile's own placement WHILE a drag is live -- null the rest of the
  // time, when `className` (via the resolved CSS classes it names) is what
  // actually places this tile. Set from real pointer movement, so this is
  // also the one piece of state that makes a drag VISIBLE at all: without
  // it a drag would move the pointer with nothing on screen tracking it,
  // reading exactly like Plan 5's own inert camera badge did before it was
  // fixed.
  const [dragPreview, setDragPreview] = useState<ResolvedPlacement | null>(null);
  const [dragKind, setDragKind] = useState<'move' | 'span' | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragOrigin | null>(null);
  // I-F: the element Tab/Enter used to OPEN the panel -- focus returns here
  // when it closes (see the focus-management effect below), since nothing
  // in a real browser does that automatically for a `createPortal`-rendered
  // subtree that just unmounted (the in-code claim this replaced was wrong
  // about that -- see this file's own C2/I-F fix history).
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  // The portal panel's own root -- read by the focus-trap/auto-focus effect
  // below to find its own boundary focusable elements, and by the Tab-trap
  // in handlePanelKeyDown.
  const panelRef = useRef<HTMLDivElement>(null);

  // C1 fix: `handleMovePointerDown` below has NO `selected` guard (drag
  // works on any tile, selected or not -- that is the whole point of the
  // control), so a refusal set by `endDrag` can happen while this tile was
  // never selected. The OLD version of this effect cleared both messages on
  // every `selected` change in either direction, which meant selecting the
  // tile to see WHY a drag just failed wiped the answer in the same render
  // that revealed the question. A `useRef` remembers the PREVIOUS value so
  // this can tell "just deselected" (clear -- a genuinely stale message)
  // apart from "just selected" (keep -- she may be here BECAUSE of the
  // message), which a bare `[selected]` dependency can't distinguish.
  const wasSelectedRef = useRef(selected);
  useEffect(() => {
    if (wasSelectedRef.current && !selected) {
      setRefusedMessage(null);
      setInfoMessage(null);
    }
    wasSelectedRef.current = selected;
  }, [selected]);

  // C1: the only path that can set `refusedMessage` while this tile is NOT
  // selected is a refused drag (every button that can refuse lives inside
  // the selected-only panel, so a button-triggered refusal is already
  // showing there the instant it happens). That refusal now renders as a
  // small, unconditional toast (below, JSX) instead of silence -- and this
  // is what makes the toast self-dismissing, so two different tiles
  // dragged in sequence, both refused, never leave two of them stacked on
  // screen at once. A refusal already showing inside the open panel is NOT
  // time-limited -- unchanged, existing behaviour.
  useEffect(() => {
    if (selected || refusedMessage === null) return;
    const timer = window.setTimeout(() => setRefusedMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [selected, refusedMessage]);

  // I-F: moves focus INTO the panel the instant it opens (past the 101-Tab
  // problem entirely -- she never has to Tab there, it's already where the
  // keyboard is) and explicitly back to the select button that opened it
  // when it closes, however it closes (Escape, the "Done" button, or
  // re-toggling select). Both halves are effect-timed, not click-handler
  // timed, so this also covers the panel unmounting because SOME OTHER
  // tile became selected instead.
  useEffect(() => {
    if (!selected) return;
    const panel = panelRef.current;
    const [first] = panel ? getFocusable(panel) : [];
    first?.focus({ preventScroll: true });
    // Captured into a local now, not read off the ref again inside the
    // cleanup below -- react-hooks/exhaustive-deps' own point: by the time
    // a cleanup runs, a ref's `.current` may already have moved on to
    // whatever the NEXT render pointed it at. This tile's own select button
    // is the same DOM node for this component's whole lifetime (React
    // reuses it across re-renders; only its label/pressed state change), so
    // capturing it here changes nothing about which element cleanup
    // returns focus to -- it only stops relying on the ref still being
    // "current" later.
    const selectButtonEl = selectButtonRef.current;
    return () => {
      selectButtonEl?.focus({ preventScroll: true });
    };
  }, [selected]);

  function commit(candidate: ResolvedPlacement) {
    const nextClassName = formatPlacement(candidate);
    setInfoMessage(describeSideEffects(classNames, index, nextClassName));
    setRefusedMessage(null);
    onCommit(index, nextClassName);
  }

  function handleAction(button: ActionButton) {
    const candidate = candidateFor(classNames, index, button.action);
    if (!candidate || !isOnGrid(candidate)) {
      setInfoMessage(null);
      setRefusedMessage(`Can't ${button.refusalLabel} — that would move this photo off the collage grid.`);
      return;
    }
    if (!wouldStayOnGrid(classNames, index, formatPlacement(candidate))) {
      setInfoMessage(null);
      setRefusedMessage(`Can't ${button.refusalLabel} — that would push another auto-placed photo off the collage grid.`);
      return;
    }
    commit(candidate);
  }

  // Task 4 Step 1: one code path for mouse and pen (Pointer Events unify
  // both) -- `setPointerCapture` is what keeps a fast drag that leaves the
  // tile's own bounds still tracked; without it, a move that outruns the
  // element mid-drag stops receiving move events entirely.
  function handleMovePointerDown(event: React.PointerEvent) {
    if (isCoarsePointer()) return; // buttons only on touch -- see isCoarsePointer's own comment
    if (event.pointerType === 'mouse' && event.button !== 0) return; // left button/primary contact only
    const tileEl = tileRef.current;
    if (!tileEl) return;
    const cell = measureCell(tileEl);
    const origin = currentResolved(classNames, index);
    if (!cell || !origin) return;
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, cellW: cell.cellW, cellH: cell.cellH, placement: origin };
    (event.target as Element).setPointerCapture(event.pointerId);
    // C2 fix: a real Escape keydown only reaches `handleTileKeyDown` below
    // if the TILE ITSELF is the focused element when it fires. Confirmed
    // directly, in real Chromium: a plain, non-focusable `<div>` never
    // receives focus from a pointerdown, so focus stayed on
    // `document.body` for the whole drag, and `document.body` is not a
    // descendant of this tile's own div -- so React's bubble-simulated
    // event system never called this component's handler at all, and the
    // subsequent pointerup committed the move Escape was supposed to
    // cancel. `tabIndex={-1}` on the tile (below, JSX) makes this call
    // legal without adding the tile to the page's own Tab order -- drag is
    // pointer-only, so starting one should never insert a new Tab stop.
    tileEl.focus({ preventScroll: true });
    setDragKind('move');
    setDragPreview(origin);
    setInfoMessage(null);
    setRefusedMessage(null);
  }

  function handleMovePointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || dragKind !== 'move') return;
    const colDelta = Math.round((event.clientX - drag.clientX) / drag.cellW);
    const rowDelta = Math.round((event.clientY - drag.clientY) / drag.cellH);
    setDragPreview({
      ...drag.placement,
      colStart: drag.placement.colStart + colDelta,
      rowStart: drag.placement.rowStart + rowDelta,
    });
  }

  function endDrag(event: React.PointerEvent, shouldCommit: boolean) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragKind(null);
    const preview = dragPreview;
    setDragPreview(null);
    if (!shouldCommit || !preview) return;
    const moved = preview.colStart !== drag.placement.colStart || preview.rowStart !== drag.placement.rowStart || preview.colSpan !== drag.placement.colSpan || preview.rowSpan !== drag.placement.rowSpan;
    if (!moved) return; // dropped back where it started -- not a real edit
    if (!isOnGrid(preview)) {
      // Task 4 Step 2: a refused drop must produce visible feedback, not
      // silence -- the tile has already visually snapped back (dragPreview
      // is now null, so `className`'s own explicit placement takes over
      // again on the very next paint) and this message says why.
      setRefusedMessage("Can't drop it there — that would move this photo off the collage grid.");
      return;
    }
    if (!wouldStayOnGrid(classNames, index, formatPlacement(preview))) {
      // The dropped tile's OWN candidate is on-grid, but the cascade it
      // triggers (Task 4 Step 3: "pinning one tile relocates others") would
      // push an auto-placed sibling off-grid -- refused for the identical
      // reason `handleAction`'s own second check is, with the identical
      // visible feedback.
      setRefusedMessage("Can't drop it there — that would push another auto-placed photo off the collage grid.");
      return;
    }
    commit(preview);
  }

  function handleMovePointerUp(event: React.PointerEvent) {
    endDrag(event, true);
  }

  function handleMovePointerCancel(event: React.PointerEvent) {
    // A real pointercancel (the browser reclaiming the gesture -- a scroll,
    // an OS gesture) is treated exactly like Escape: cancel, never commit.
    endDrag(event, false);
  }

  // Task 4 Step 2: sizing is the same arithmetic on a corner handle: it
  // changes span, not start." A separate handle from the move surface --
  // dragging the PHOTO moves it; dragging this small corner grip resizes
  // it. Shown only while selected (Task 3's own panel is the persistent,
  // always-reachable affordance; this is the fine-pointer bonus, not a
  // fifth permanently-visible badge on all sixteen tiles at once).
  function handleResizePointerDown(event: React.PointerEvent) {
    if (isCoarsePointer()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const tileEl = tileRef.current;
    if (!tileEl) return;
    const cell = measureCell(tileEl);
    const origin = currentResolved(classNames, index);
    if (!cell || !origin) return;
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, cellW: cell.cellW, cellH: cell.cellH, placement: origin };
    (event.target as Element).setPointerCapture(event.pointerId);
    // C2 fix -- see handleMovePointerDown's own comment on why this call is
    // what makes a real Escape keydown reach handleTileKeyDown at all.
    tileEl.focus({ preventScroll: true });
    setDragKind('span');
    setDragPreview(origin);
    setInfoMessage(null);
    setRefusedMessage(null);
    event.stopPropagation();
  }

  function handleResizePointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || dragKind !== 'span') return;
    const colDelta = Math.round((event.clientX - drag.clientX) / drag.cellW);
    const rowDelta = Math.round((event.clientY - drag.clientY) / drag.cellH);
    setDragPreview({
      ...drag.placement,
      colSpan: Math.max(1, drag.placement.colSpan + colDelta),
      rowSpan: Math.max(1, drag.placement.rowSpan + rowDelta),
    });
  }

  // Escape cancels an in-flight drag -- Plan 5's review found "she could
  // not undo her own edit" as a Critical, and a drag is far easier to
  // trigger by accident than a text edit, with no natural inverse (she
  // cannot retype a placement string from memory). This is the ONLY undo
  // for a drag that has not yet released: once a drop commits, the
  // dashboard's own existing Discard -- which reverts every unpublished
  // change this session, not a per-move undo -- is what's there; this plan
  // adds no new one. Attached to the tile itself (not the document), so it
  // only fires while this tile's own pointer capture is live.
  function handleTileKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && dragRef.current) {
      event.preventDefault();
      dragRef.current = null;
      setDragKind(null);
      setDragPreview(null);
    }
  }

  // Escape closes the panel; the focus-management effect above (not the
  // browser's own default) is what returns focus to the tile's own select
  // button -- I-F review finding: a browser does NOT automatically move
  // focus to "the nearest preceding focusable element in DOM order" when
  // the focused element is removed, it moves to `document.body`, full
  // stop; confirmed directly, the claim this comment used to make here was
  // false. Every button in the panel either commits a legal move/size
  // change or is refused with no effect at all, so Escape here is a
  // dismissal, not an undo (the drag surface above is where an in-flight
  // edit actually needs undoing).
  //
  // Tab/Shift+Tab are trapped inside the panel here too (I-F): without
  // this, Tab from the panel's own last control (or Shift+Tab from its
  // first) would follow the portal's real DOM position -- the very end of
  // `document.body` -- out into whatever happens to be there, not back to
  // this tile. Only the two boundary cases are handled; every other
  // Tab/Shift+Tab inside the panel is left alone to move between its own
  // controls normally.
  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onSelect(null);
      return;
    }
    if (event.key === 'Tab') {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusable(panel);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  const controlLabel = selected ? `Stop moving photo ${index + 1}` : `Move or change the size of photo ${index + 1}`;
  const dragInvalid = dragPreview !== null && !isOnGrid(dragPreview);
  const tileStyle: React.CSSProperties = {
    ...(dragPreview ? placementStyle(dragPreview) : {}),
    ...(dragKind ? { touchAction: 'none' as const, cursor: dragKind === 'move' ? 'grabbing' : 'nwse-resize', zIndex: 30 } : {}),
    ...(dragInvalid ? { boxShadow: 'inset 0 0 0 2px #dc2626' } : {}),
  };

  return (
    <div
      ref={tileRef}
      className={`${className} relative overflow-hidden`}
      style={tileStyle}
      data-collage-tile-index={index}
      // I-A fix: `dragstart` bubbles, so cancelling it HERE -- on this
      // /edit-only wrapper, never on the public page -- stops native HTML5
      // image drag (which would otherwise hijack the pointer sequence a
      // real drag-to-move needs) without Hero.tsx's own `<img>` needing
      // `draggable={false}` at all. See this file's own I-A note and
      // Hero.tsx's for the full reasoning and the real-Chromium table that
      // ruled out the alternatives.
      onDragStart={(event) => event.preventDefault()}
      tabIndex={-1}
      onKeyDown={locked ? undefined : handleTileKeyDown}
    >
      {/* While locked: no pointer handlers and no grab cursor, so this reads
          as an ordinary photo rather than as a control that ignores her --
          the same reasoning the select button below and EditableText's own
          paused appearance follow. `touchAction` is left alone: it only
          decides whether the browser scrolls the page under a touch, and
          taking scrolling away from a paused page would be a regression of
          its own. */}
      <div
        className="absolute inset-0 select-none"
        style={{
          touchAction: isCoarsePointer() ? 'auto' : 'none',
          cursor: locked || isCoarsePointer() ? undefined : 'grab',
        }}
        onPointerDown={locked ? undefined : handleMovePointerDown}
        onPointerMove={locked ? undefined : handleMovePointerMove}
        onPointerUp={locked ? undefined : handleMovePointerUp}
        onPointerCancel={locked ? undefined : handleMovePointerCancel}
      >
        {image}
      </div>
      {!locked && (
        <button
          ref={selectButtonRef}
          type="button"
          {...CONTROL_ATTR}
          aria-pressed={selected}
          aria-label={controlLabel}
          title={controlLabel}
          onClick={() => onSelect(selected ? null : index)}
          className={selected ? SELECTED_BUTTON_CLASSNAME : SELECT_BUTTON_CLASSNAME}
        >
          <Move className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {selected && !locked && !isCoarsePointer() && (
        <div
          {...CONTROL_ATTR}
          role="presentation"
          aria-label={`Drag to change the size of photo ${index + 1}`}
          title="Drag to change size"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={(e) => endDrag(e, true)}
          onPointerCancel={(e) => endDrag(e, false)}
          className="absolute bottom-1 left-1 z-20 h-5 w-5 cursor-nwse-resize rounded border-2 border-white bg-[#6B8B59] shadow"
        />
      )}
      {/* C1 fix: a refused DRAG can happen on any tile, selected or not (see
          handleMovePointerDown's own comment -- it has no `selected`
          guard). The panel below only ever exists while `selected`, so a
          refusal that happens without it needs its own, unconditional
          place to show -- this is that place. `top-0`, not `bottom-0` like
          the panel: the two really can be on screen at once (she can open
          one tile's panel and, without closing it, drag a DIFFERENT tile
          straight off-grid), and stacking two `fixed` bars at the identical
          edge would put one silently on top of the other -- the exact
          "visible feedback that isn't actually visible" shape this fix
          exists to close. Self-dismissing (the effect above) is the other
          half of that: it also caps how long two coincidentally-open
          toasts (two different UNSELECTED tiles, each just refused) could
          ever overlap. Plain inline style, not a Tailwind class string: the
          shared stylesheet (bundle.post-build.test.ts) carries a byte
          ceiling every admin-only class counts against, and this needs no
          new rule at all to express as a plain style. `zIndex: 60`, not 50:
          NavBar.tsx's own `<nav>` is ALSO `fixed top-0 ... z-50` (the real
          public page NavBar, still rendered underneath everything /edit
          adds) -- an equal z-index there would leave which one paints on
          top decided by DOM/portal insertion order, exactly the kind of
          coin-flip stacking this whole review exists to eliminate. A
          strictly higher value wins outright, on purpose, so the message
          is never gambled on. */}
      {!selected && refusedMessage !== null &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              top: 0,
              zIndex: 60,
              textAlign: 'center',
              padding: '10px 16px',
              background: '#ffffff',
              color: '#dc2626',
              borderBottom: '1px solid #e5e7eb',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              fontFamily: "'Montserrat', sans-serif",
              fontSize: '12px',
            }}
          >
            {refusedMessage}
          </div>,
          document.body,
        )}
      {selected && !locked &&
        createPortal(
          <div
            ref={panelRef}
            {...CONTROL_ATTR}
            role="region"
            aria-label={`Moving or resizing photo ${index + 1}`}
            onKeyDown={handlePanelKeyDown}
            className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.15)]"
          >
            <div className="mx-auto flex max-w-md flex-col items-center gap-3">
              <div className="flex w-full items-center justify-between">
                <p className="font-['Montserrat'] text-xs font-semibold uppercase tracking-wide text-[#222]">
                  {`Photo ${index + 1} of the collage`}
                </p>
                <ControlButton
                  label="Done moving this photo"
                  onClick={() => onSelect(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[#222] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6B8B59]"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </ControlButton>
              </div>

              <div className="flex items-center gap-6">
                <div className="grid grid-cols-3 grid-rows-3 gap-1" role="group" aria-label="Move">
                  <div />
                  <ControlButton label={UP.label} onClick={() => handleAction(UP)} className={`col-start-2 row-start-1 ${PANEL_BUTTON_CLASSNAME}`}>
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </ControlButton>
                  <div />
                  <ControlButton label={LEFT.label} onClick={() => handleAction(LEFT)} className={`col-start-1 row-start-2 ${PANEL_BUTTON_CLASSNAME}`}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </ControlButton>
                  <div className="col-start-2 row-start-2" />
                  <ControlButton label={RIGHT.label} onClick={() => handleAction(RIGHT)} className={`col-start-3 row-start-2 ${PANEL_BUTTON_CLASSNAME}`}>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </ControlButton>
                  <div />
                  <ControlButton label={DOWN.label} onClick={() => handleAction(DOWN)} className={`col-start-2 row-start-3 ${PANEL_BUTTON_CLASSNAME}`}>
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </ControlButton>
                  <div />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1" role="group" aria-label="Width">
                    <span className="font-['Montserrat'] text-[11px] text-gray-500">Width</span>
                    <ControlButton label={NARROWER.label} onClick={() => handleAction(NARROWER)} className={PANEL_BUTTON_CLASSNAME}>
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    </ControlButton>
                    <ControlButton label={WIDER.label} onClick={() => handleAction(WIDER)} className={PANEL_BUTTON_CLASSNAME}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </ControlButton>
                  </div>
                  <div className="flex items-center gap-1" role="group" aria-label="Height">
                    <span className="font-['Montserrat'] text-[11px] text-gray-500">Height</span>
                    <ControlButton label={SHORTER.label} onClick={() => handleAction(SHORTER)} className={PANEL_BUTTON_CLASSNAME}>
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    </ControlButton>
                    <ControlButton label={TALLER.label} onClick={() => handleAction(TALLER)} className={PANEL_BUTTON_CLASSNAME}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </ControlButton>
                  </div>
                </div>
              </div>

              <p role="status" aria-live="polite" className="min-h-[1em] font-['Montserrat'] text-xs text-red-600">
                {refusedMessage ?? ''}
              </p>
              <p role="status" aria-live="polite" className="min-h-[1em] font-['Montserrat'] text-xs text-gray-500">
                {infoMessage ?? ''}
              </p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default CollageTile;
