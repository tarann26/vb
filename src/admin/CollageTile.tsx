// Plan 6, Task 3: the control that works everywhere. Buttons come before
// drag (Task 4) deliberately -- the spec's Risks section mandates them on
// touch, they double as the keyboard interface, and they satisfy the goal
// on every device a mouse, a phone or a keyboard can reach. If scope must
// be cut, drag is the droppable piece, not this.
//
// This is `/edit`'s own override of `content.renderCollageTile`
// (src/content/context.ts's default just renders the tile `<div>` inline,
// unaware anything is editable -- see that module's own comment). Every
// move or size change goes through the exact arithmetic Task 4's drag will
// also use (`moveTile`/`resizeTile`, src/content/placement.ts) and the same
// `isOnGrid` check `validateContent` uses server-side -- "if the button
// path and the drag path can produce different results from the same
// intent, you have two implementations and one is wrong" (this plan's own
// Task 3 Step 1).
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Move, Plus, X } from 'lucide-react';
import {
  formatPlacement,
  isOnGrid,
  moveTile,
  resizeTile,
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
  // its own camera-replace badge (EditableImage.tsx) sits.
  image: React.ReactNode;
  selected: boolean;
  onSelect: (index: number | null) => void;
  // Writes `formatPlacement(candidate)` back for `index` -- EditMode.tsx's
  // own `commitCollagePlacement`, which is what actually calls
  // `registry.updateData` (never `register`) and keeps the same
  // "photo replaced this session AND moved" guarantee `EditableImage`'s own
  // index-keyed staging already provides, untouched by this component.
  onCommit: (index: number, nextClassName: string) => void;
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

// A fixed panel at the bottom of the viewport, not an overlay confined to
// the tile itself -- the spec's own Risks section computes a ~60px cell at
// 390px, nowhere near enough room for eight real, tappable buttons plus a
// status line. Rendered via `createPortal` into `document.body` so its own
// size is never constrained by the tiny grid cell it was opened from.
const CollageTile: React.FC<CollageTileProps> = ({ index, className, classNames, image, selected, onSelect, onCommit }) => {
  const [refusedMessage, setRefusedMessage] = useState<string | null>(null);

  // Cleared the instant a DIFFERENT tile is selected (or this one is
  // deselected) -- a refusal message from a previous session has nothing to
  // say about a fresh one.
  useEffect(() => {
    setRefusedMessage(null);
  }, [selected]);

  function handleAction(button: ActionButton) {
    const candidate = candidateFor(classNames, index, button.action);
    if (!candidate || !isOnGrid(candidate)) {
      setRefusedMessage(`Can't ${button.refusalLabel} — that would move this photo off the collage grid.`);
      return;
    }
    setRefusedMessage(null);
    onCommit(index, formatPlacement(candidate));
  }

  // Escape closes the panel and returns focus to the tile's own select
  // button (the browser's own default focus-return-on-unmount behaviour
  // handles the "return focus" half: the element that had focus inside the
  // now-removed panel is gone, and the select button is the nearest
  // preceding focusable element in DOM order). Plan 5's review found "she
  // could not undo her own edit" as a Critical; this is the equivalent for
  // a panel that is easy to open by accident and has no destructive action
  // of its own to undo (every button here either commits a legal move or
  // size change, or is refused with no effect at all), so Escape here is a
  // dismissal, not an undo.
  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onSelect(null);
    }
  }

  const controlLabel = selected ? `Stop moving photo ${index + 1}` : `Move or change the size of photo ${index + 1}`;

  return (
    <div className={`${className} relative overflow-hidden`} data-collage-tile-index={index}>
      {image}
      <button
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
      {selected &&
        createPortal(
          <div
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
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default CollageTile;
