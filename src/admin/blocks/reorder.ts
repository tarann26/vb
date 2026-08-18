// Move one entry of a list past its neighbour, returning a new list.
//
// Its own module rather than a copy in each of the two files that reorder
// something (BlockList swaps blocks, BlockFields swaps the items inside one),
// which is what the first version of this task shipped. Not exported from
// BlockFields.tsx, where it started: BlockList already imports that module, and
// a non-component export from a file that also exports a component trips
// `react-refresh/only-export-components` (its `allowConstantExport` option
// recognises a constant, not a function).
//
// Callers own their array. This returns a copy and mutates nothing, because
// every list on this dashboard is controlled by whoever holds its state -- the
// same contract RecordList documents for its own `onReorder`.
export function swapAt<T>(items: T[], index: number, otherIndex: number): T[] {
  const next = [...items];
  const moved = next[index];
  next[index] = next[otherIndex];
  next[otherIndex] = moved;
  return next;
}

// Move one item to another position, sliding everything between it and the
// target. It lives beside swapAt rather than inside BlockList's drag handlers,
// and the reason is testability rather than tidiness: jsdom has no drag
// implementation at all, so the handlers themselves can only be proven in a
// real browser -- and this is the part of them that can be proven here,
// exhaustively and cheaply. `moveTo` is what ItemList's own row drag calls
// too, so this module outlived BlockList's use of it: admin redesign Task 25
// unmounted that component and deleted e2e/block-editor.spec.ts with it.
//
// A MOVE, not a swap. The Up/Down buttons above call swapAt, which exchanges
// two neighbours -- right for a one-step nudge and wrong for a drag from
// position 1 to position 5, where a swap would exchange those two and leave
// the three in between where they were. That is not what she just did with her
// finger.
//
// `from` out of range returns the list untouched: splice(-1, 1) removes the
// LAST item and reinserts it somewhere else, so an unguarded read of a
// nonsense source index silently reorders her post. `to` is clamped instead of
// refused, because a drop target's own index is always a position that exists
// and clamping is the behaviour a keyboard affordance would want later. Only
// the lower half of that clamp is observable -- Array.prototype.splice already
// treats an insertion index past the end as "append" -- but a small negative
// index it treats as "count back from the end", which would put the block
// somewhere she did not drop it. Phase 5A's fourteenth under-asserting test
// was this exact shape: an out-of-range index returning a real but wrong
// result that a length check accepted.
export function moveTo<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.min(Math.max(0, to), next.length - 1);
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}
