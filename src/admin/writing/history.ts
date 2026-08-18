// Undo over the BLOCK ARRAY, not over the DOM.
//
// That choice is what makes undo safe for staged photographs. A snapshot holds
// the same block OBJECTS that were in the array when it was taken, so an
// undone block is the identical object stable-names.ts's WeakMap already knows
// -- same name, same staged-photo key, bytes still in the collector (staged.ts
// drops an entry only on a fresh pick or on clearSent at publish). Undoing a
// deleted photograph restores the photograph, not a reference to nothing. It
// is also why the WeakMap cannot have forgotten it: the snapshot is itself a
// strong reference to that object, so holding the undo step is exactly what
// keeps its name alive.
//
// The browser's own contenteditable undo is suppressed at the key handler. Two
// undo stacks over one surface is not a smaller version of this problem; it is
// a permanent disagreement between what is on screen and what would publish.
//
// A SNAPSHOT IS A STATE TO GO BACK TO, taken BEFORE the change that leaves it
// behind. `past` is therefore a list of restore points, newest last, and
// `undo` hands back the newest one -- the state as it stood an instant before
// the most recent edit.
import type { Block } from '../../content/types';
import type { Caret } from './structure';

export interface Snapshot {
  readonly blocks: Block[];
  readonly caret: Caret | null;
  readonly at: number;
  // The slot address (`name/key`) the edit that ended this state happened in,
  // or null for an edit that belongs to no single slot. Only used to decide
  // whether two steps are the same run of typing.
  readonly slot: string | null;
}

export interface History {
  readonly past: readonly Snapshot[];
  readonly future: readonly Snapshot[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

const LIMIT = 100;
const COALESCE_MS = 600;

export function record(history: History, snapshot: Snapshot, structural: boolean): History {
  const top = history.past[history.past.length - 1];
  // Typing runs of ordinary characters in one slot collapse into one undoable
  // step. Anything structural -- Enter, a kind change, an image, a paste, a
  // mark -- always starts a new one, because those are the steps she will
  // actually reach for.
  const coalesces =
    !structural && top !== undefined && top.slot !== null
    && top.slot === snapshot.slot && snapshot.at - top.at < COALESCE_MS;

  // COALESCING KEEPS THE OLDER RESTORE POINT AND DISCARDS THE NEW ONE, and
  // that direction is the whole of it. Keeping the newer one instead -- which
  // is the shape this reads as if it should have -- would leave `past` holding
  // the state one keystroke ago and would have THROWN AWAY every restore point
  // earlier in the run: the first Cmd+Z would undo a single character and the
  // second would undo the entire paragraph, which is precisely the "either
  // nothing happens, or every character she typed vanishes at once" failure
  // this module exists to rule out.
  //
  // `at` is deliberately NOT refreshed to the new keystroke's time, so the
  // window is measured from the START of the run rather than from the last
  // key. A run is therefore bounded at COALESCE_MS of typing however fast she
  // types, and one Cmd+Z can never remove more than that much work. Refreshing
  // it would merge an uninterrupted five-minute paragraph into a single step,
  // which is the same failure again wearing the opposite sign.
  if (coalesces) return { past: history.past, future: [] };

  // Sliced to LIMIT - 1 BEFORE the append, so the result is at most LIMIT.
  // The oldest steps are the ones dropped: an hour-old state is not what she
  // is reaching for, and the newest are.
  return { past: [...history.past.slice(-(LIMIT - 1)), snapshot], future: [] };
}

export function undo(history: History, current: Snapshot): { history: History; restored: Snapshot } | null {
  const restored = history.past[history.past.length - 1];
  if (restored === undefined) return null;
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, restored };
}

export function redo(history: History, current: Snapshot): { history: History; restored: Snapshot } | null {
  const restored = history.future[0];
  if (restored === undefined) return null;
  return { history: { past: [...history.past, current], future: history.future.slice(1) }, restored };
}
