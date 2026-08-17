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
