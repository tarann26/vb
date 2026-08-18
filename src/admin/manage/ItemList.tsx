// A content panel's list: a small square picture and the item's name, one
// row each, and nothing else. Clicking a row opens its editor.
//
// The row is a <button>, not a <li> with a click handler: it must be
// reachable by Tab and by Enter, and it must announce itself as something
// that does a thing. The drag handle sits OUTSIDE that button so a drag
// cannot end in a click that opens the editor she was trying to move.
//
// Add sits at the TOP. The spec's own reason: on a list of thirty-eight
// drinks the Add button at the bottom is a scroll away from the only screen
// that would send her looking for it.
import React, { useState } from 'react';
import { MOVE_BUTTON_CLASSNAME } from '../RecordList';
import { DRAGGING_STYLE, HANDLE_CLASSNAME, HANDLE_STYLE } from './drag-row';

export interface ItemRow {
  id: string;
  name: string;
  thumbnail?: React.ReactNode;
  needsAttention: boolean;
}

export interface ItemListProps {
  rows: ItemRow[];
  onOpen: (id: string) => void;
  onMove?: (from: number, to: number) => void;
  onAdd?: () => void;
  addLabel?: string;
}

const ROW_CLASSNAME =
  "flex min-w-0 flex-1 items-center gap-3 rounded p-2 text-left font-['Montserrat'] text-sm text-ink transition hover:bg-brand/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const ADD_ROW_CLASSNAME =
  "mb-3 w-full rounded border-2 border-dashed border-brand py-2 font-['Montserrat'] text-sm uppercase tracking-wide text-accent transition hover:bg-brand/10";

function ItemList({ rows, onOpen, onMove, onAdd, addLabel }: ItemListProps) {
  const [dragging, setDragging] = useState<number | null>(null);

  return (
    <div>
      {onAdd !== undefined && (
        <button type="button" onClick={() => onAdd()} className={ADD_ROW_CLASSNAME}>
          {addLabel ?? 'Add'}
        </button>
      )}
      <ul data-item-list="rows">
        {rows.map((row, index) => (
          <li
            key={row.id}
            data-item-row={row.id}
            className="mb-1 flex items-center gap-1 rounded border border-gray-200"
            style={dragging === index ? DRAGGING_STYLE : undefined}
            onDragOver={(event) => {
              if (dragging === null || onMove === undefined) return;
              // preventDefault is what makes an element a valid drop target
              // at all. No jsdom test can see it; e2e/editor-surface.spec.ts
              // is what covers it.
              event.preventDefault();
            }}
            onDrop={(event) => {
              if (dragging === null || onMove === undefined) return;
              event.preventDefault();
              if (dragging !== index) onMove(dragging, index);
              setDragging(null);
            }}
          >
            {onMove !== undefined && (
              <span
                aria-hidden="true"
                draggable
                onDragStart={(event) => {
                  setDragging(index);
                  event.dataTransfer.setData('text/plain', String(index));
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragging(null)}
                className={HANDLE_CLASSNAME}
                style={HANDLE_STYLE}
                data-drag-handle={index}
                title={`Drag to move ${row.name}`}
              >
                ⠿
              </span>
            )}
            <button type="button" onClick={() => onOpen(row.id)} className={ROW_CLASSNAME}>
              {row.thumbnail}
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              {/* Part of the button's own accessible NAME, not a separate
                  element: a marker beside a row is something a screen reader
                  reaches only after the row, and this is the reason to open
                  it. The leading space is load-bearing -- jsdom computes a
                  bare span as display:inline, so dom-accessibility-api
                  inserts no separator of its own and the name would read
                  "Dish Bneeds attention". No `role` on it either:
                  CollapsibleSection's observer watches for role="alert", and
                  the list's own banner is what should drive the folded
                  marker, once. */}
              {row.needsAttention && <span className="text-xs text-red-600">{' needs attention'}</span>}
            </button>
            {onMove !== undefined && index > 0 && (
              <button
                type="button"
                aria-label={`Move ${row.name} up`}
                onClick={() => onMove(index, index - 1)}
                className={MOVE_BUTTON_CLASSNAME}
              >
                Up
              </button>
            )}
            {onMove !== undefined && index < rows.length - 1 && (
              <button
                type="button"
                aria-label={`Move ${row.name} down`}
                onClick={() => onMove(index, index + 1)}
                className={MOVE_BUTTON_CLASSNAME}
              >
                Down
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ItemList;
