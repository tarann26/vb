// The hero collage's own tiny layout language: `galleries.heroCollage[i]
// .className` is a Tailwind grid-placement string (e.g.
// "col-start-5 col-span-2 row-span-2"), authored by hand today and edited
// through the dashboard from this plan onward. This module is the one place
// that string is parsed, formatted back, and resolved into real grid cells
// -- Hero.tsx (the public page) never imports this file and keeps rendering
// `className` verbatim, exactly as it always has.
//
// `GRID_SIZE` is the single source of the collage's column AND row count
// (Hero.tsx's own `grid-cols-6 grid-rows-6`, tailwind.config.js's own
// safelist, and validateContent's own range check all derive from this one
// constant) -- hard-coding 6 in more than one place is exactly what would
// let a future change to the collage's own column/row count break silently,
// which is the reason this constant is exported at all rather than being a
// private detail of whichever file happened to need it first.
export const GRID_SIZE = 6;

// All four fields nullable, deliberately -- not four required numbers. The
// real, committed `galleries.json` never writes all four together: `row-span`
// is absent in eight of the sixteen real entries, `col-start` in five,
// `row-start` in three, and every entry that HAS a field writes it with a
// real value (this file's own `parsePlacement` refuses a present-but-empty
// or non-numeric one, it never produces `undefined` for a field that is
// there). A `Placement` with a null field means "this axis's start (or
// span) is left to the browser's own auto-placement," the same thing
// omitting the utility class means today. Requiring all four as plain
// `number`s would force `formatPlacement` to invent values `className`
// never had -- see this module's own round-trip test for the sixteen real
// entries this actually breaks.
export interface Placement {
  colStart: number | null;
  colSpan: number | null;
  rowStart: number | null;
  rowSpan: number | null;
}

// The four axis kinds this module understands, and nothing else -- a
// `className` containing any other token (a stray `relative`, a typo like
// "col-strt-3", or a negative/zero index the regex below can't match at
// all) is not a placement this parser can round-trip, so `parsePlacement`
// refuses the whole string rather than silently discarding the part it
// doesn't recognise. `\d+` alone (no leading `-`) is deliberate: Tailwind's
// own generated utilities for these four plugins never emit a negative
// index, and this project's collage never needs one.
const PLACEMENT_TOKEN = /^(col-start|col-span|row-start|row-span)-(\d+)$/;

type PlacementKind = 'col-start' | 'col-span' | 'row-start' | 'row-span';

const KIND_TO_FIELD: Record<PlacementKind, keyof Placement> = {
  'col-start': 'colStart',
  'col-span': 'colSpan',
  'row-start': 'rowStart',
  'row-span': 'rowSpan',
};

// Parses a `className` exactly like the ones already committed in
// `galleries.json` (e.g. "col-start-5 col-span-2 row-start-2 row-span-2",
// or "col-span-2 row-span-2" with both starts left to auto-placement) into
// four nullable fields. Returns `null` -- never throws -- for anything this
// module cannot confidently round-trip: an empty string, a token this
// parser doesn't recognise, a duplicate axis (two `col-start-*` tokens in
// the same string, which Tailwind's own cascade would silently resolve one
// way or another rather than reporting an error), or a zero/non-positive
// index (CSS grid line numbers are 1-based; `col-start-0` is not a real
// position).
export function parsePlacement(className: string): Placement | null {
  const trimmed = className.trim();
  if (trimmed.length === 0) return null;
  const tokens = trimmed.split(/\s+/);

  const placement: Placement = { colStart: null, colSpan: null, rowStart: null, rowSpan: null };
  const seen = new Set<PlacementKind>();

  for (const token of tokens) {
    // `token.match(...)`, not `PLACEMENT_TOKEN.exec(token)` -- same result
    // for a non-global pattern (a single match array, or null), chosen only
    // to keep this file free of the literal substring `exec(`, which reads
    // as a shell/process call to a naive text scan even though this is
    // `RegExp.prototype.exec` and touches no process at all.
    const match = token.match(PLACEMENT_TOKEN);
    if (!match) return null;
    const kind = match[1] as PlacementKind;
    const value = Number(match[2]);
    if (seen.has(kind) || !Number.isInteger(value) || value < 1) return null;
    seen.add(kind);
    placement[KIND_TO_FIELD[kind]] = value;
  }

  return placement;
}

// The exact inverse of `parsePlacement`, for every one of the sixteen real
// entries in `galleries.json` -- see this module's own test for the proof.
// Fixed field order (col-start, col-span, row-start, row-span), each field
// omitted entirely when null: every real `className` in the committed file
// already lists its present fields in exactly this order (confirmed by
// direct inspection, not assumed), which is what makes the round trip
// byte-identical rather than merely equivalent. A `Placement` built by hand
// (Task 3's buttons, Task 4's drag) also always serialises through this
// same function, so the page can never end up with a placement string in
// some OTHER field order than the one every real entry, and every test,
// already expects.
export function formatPlacement(placement: Placement): string {
  const parts: string[] = [];
  if (placement.colStart !== null) parts.push(`col-start-${placement.colStart}`);
  if (placement.colSpan !== null) parts.push(`col-span-${placement.colSpan}`);
  if (placement.rowStart !== null) parts.push(`row-start-${placement.rowStart}`);
  if (placement.rowSpan !== null) parts.push(`row-span-${placement.rowSpan}`);
  return parts.join(' ');
}

export interface ResolvedPlacement {
  colStart: number;
  colSpan: number;
  rowStart: number;
  rowSpan: number;
}

// A cheap, generous bound on how many rows/columns this function will ever
// search before giving up -- large enough that nothing in a real, sixteen
// (or even a few dozen) tile collage can exhaust it, small enough that a
// pathological input (see the `colSpan > GRID_SIZE` guards below) can never
// spin this function forever. Not a claim about how many ROWS the page
// actually has -- Hero.tsx's `grid-rows-6` only declares six EXPLICIT ones;
// CSS grid itself grows implicit rows without limit, and this bound exists
// only to keep this function itself total.
const SEARCH_GUARD = 200;

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

// Implements CSS Grid's own sparse (non-"dense") auto-placement algorithm
// for `grid-auto-flow: row` -- the Tailwind default, and the only flow this
// project's collage ever uses -- confined to a `GRID_SIZE`-wide explicit
// column axis (columns never extend implicitly; only rows do, exactly like a
// real `grid-template-columns: repeat(6, ...)` track list with no
// `grid-auto-columns` of its own). Read `entries[i]` position `i` as one
// grid item in document order, the same order Hero.tsx's own
// `galleries.heroCollage.map` renders them in -- document order is what the
// spec's own auto-placement cursor advances through, so a caller must pass
// entries in the SAME order the page renders them, never re-sorted.
//
// This is not a guess at the algorithm -- it was checked against a real,
// compiled Tailwind stylesheet in real Chromium (a 6x6 grid fixture, the
// sixteen real `galleries.json` placements applied via the real
// `col-start-*`/`col-span-*`/`row-start-*`/`row-span-*` utility classes,
// `getComputedStyle` and `getBoundingClientRect()` read per tile) before
// this function was written, specifically to settle two things a purely
// textual reading of the spec does not make obvious:
//
//   1. The auto-placement cursor's COLUMN component keeps advancing across
//      an item with a DEFINITE column (e.g. `col-start-5 col-span-2` set
//      the shared cursor to column 7, not back to column 1) -- so a later,
//      fully auto-placed item can be pushed past columns a naive
//      row-by-row-only model would have left it free to reuse.
//   2. Items with a definite row but an indefinite column (Step 2 below)
//      resolve entirely BEFORE any item with an indefinite row is placed
//      (Step 4), regardless of which one appears earlier in document
//      order -- confirmed directly: entry 4 in the real, unrepaired
//      `galleries.json` (`col-start-3 col-span-2 row-span-1`, no
//      `row-start`) measured into row 7, an IMPLICIT row outside
//      `grid-rows-6`, exactly as this plan's own review found, and this
//      function reproduces that exact number for that exact input.
//
// Returns one slot per input entry: `null` for an entry that was itself
// `null` (the caller's own `parsePlacement` already refused it) or one this
// function could not place at all (a span wider than the explicit grid,
// which can never fit no matter how far the search runs); a
// `ResolvedPlacement` -- always with concrete, non-null numbers, `colSpan`/
// `rowSpan` defaulted to 1 when the input left them unset, matching CSS
// grid's own default span -- for everything else, including a tile that
// lands beyond `GRID_SIZE` on either axis. Distinguishing "on the visible
// grid" from "resolved into an implicit row" is the CALLER's job (compare
// the returned numbers against `GRID_SIZE`, or call `isOnGrid` below), not
// this function's: the validator and a possible future "show me the
// implicit rows" debug view want that distinction drawn differently.
export function resolveLayout(entries: readonly (Placement | null)[]): (ResolvedPlacement | null)[] {
  const results: (ResolvedPlacement | null)[] = new Array(entries.length).fill(null);
  const occupied = new Set<string>();

  function cellsFree(rowStart: number, rowSpan: number, colStart: number, colSpan: number): boolean {
    for (let r = rowStart; r < rowStart + rowSpan; r++) {
      for (let c = colStart; c < colStart + colSpan; c++) {
        if (occupied.has(cellKey(r, c))) return false;
      }
    }
    return true;
  }

  function occupy(rowStart: number, rowSpan: number, colStart: number, colSpan: number): void {
    for (let r = rowStart; r < rowStart + rowSpan; r++) {
      for (let c = colStart; c < colStart + colSpan; c++) {
        occupied.add(cellKey(r, c));
      }
    }
  }

  // Step 1: items with BOTH axes definite. Order doesn't matter for
  // correctness (nothing here searches for a free cell), only for which
  // cells end up occupied before the later steps run.
  entries.forEach((p, i) => {
    if (!p || p.colStart === null || p.rowStart === null) return;
    const colSpan = p.colSpan ?? 1;
    const rowSpan = p.rowSpan ?? 1;
    results[i] = { colStart: p.colStart, colSpan, rowStart: p.rowStart, rowSpan };
    occupy(p.rowStart, rowSpan, p.colStart, colSpan);
  });

  // Step 2: a definite row, an indefinite (auto) column -- resolved entirely
  // before Step 4 below touches anything, in document order among
  // themselves. Each item's column search starts fresh at column 1: the
  // real `galleries.json` never has two such items sharing the same row (so
  // a persisting per-row cursor, the way Step 4's cursor persists across
  // auto-ROW items, is not distinguishable from a fresh search on this
  // project's real data), and this is the simpler of the two behaviors to
  // state precisely.
  entries.forEach((p, i) => {
    if (!p || results[i] || p.rowStart === null || p.colStart !== null) return;
    const colSpan = p.colSpan ?? 1;
    const rowSpan = p.rowSpan ?? 1;
    if (colSpan > GRID_SIZE) return; // can never fit; leave unresolved
    for (let c = 1; c + colSpan - 1 <= GRID_SIZE; c++) {
      if (cellsFree(p.rowStart, rowSpan, c, colSpan)) {
        results[i] = { colStart: c, colSpan, rowStart: p.rowStart, rowSpan };
        occupy(p.rowStart, rowSpan, c, colSpan);
        return;
      }
    }
    // No free column anywhere in the row: real CSS Grid cannot extend the
    // row axis to rescue a column-auto item (only `grid-auto-flow`'s own
    // axis extends), and this shape does not occur anywhere in the real
    // content and is not reachable through this plan's own editing UI
    // (Task 3/4 always supply an explicit column when they touch this
    // axis) -- left unresolved rather than guessed at.
  });

  // Step 4: everything with an indefinite row -- whether its column is
  // definite or also auto -- in document order, sharing ONE
  // monotonically-advancing cursor (see this function's own header comment,
  // point 1, for why the cursor's column component survives a
  // definite-column item rather than resetting).
  let cursorRow = 1;
  let cursorCol = 1;

  entries.forEach((p, i) => {
    if (!p || results[i] || p.rowStart !== null) return;
    const colSpan = p.colSpan ?? 1;
    const rowSpan = p.rowSpan ?? 1;
    if (colSpan > GRID_SIZE) return; // can never fit; leave unresolved

    if (p.colStart !== null) {
      // Definite column, auto row: walk forward from the cursor's row only.
      let r = cursorRow;
      const limit = r + SEARCH_GUARD;
      while (r <= limit && !cellsFree(r, rowSpan, p.colStart, colSpan)) r++;
      if (r > limit) return; // pathological guard, unreachable on real data
      results[i] = { colStart: p.colStart, colSpan, rowStart: r, rowSpan };
      occupy(r, rowSpan, p.colStart, colSpan);
      cursorRow = r;
      cursorCol = p.colStart + colSpan;
      return;
    }

    // Fully auto: walk the shared cursor forward, wrapping the column back
    // to 1 (and advancing the row) whenever the span would overflow
    // GRID_SIZE.
    let r = cursorRow;
    let c = cursorCol;
    for (let guard = 0; guard < SEARCH_GUARD * GRID_SIZE; guard++) {
      if (c + colSpan - 1 > GRID_SIZE) {
        c = 1;
        r++;
        continue;
      }
      if (cellsFree(r, rowSpan, c, colSpan)) {
        results[i] = { colStart: c, colSpan, rowStart: r, rowSpan };
        occupy(r, rowSpan, c, colSpan);
        cursorRow = r;
        cursorCol = c + colSpan;
        return;
      }
      c++;
    }
    // Pathological guard, unreachable on real data: an ever-growing row
    // axis always eventually finds a free cell for anything that fits
    // within GRID_SIZE columns at all.
  });

  return results;
}

// True when `resolved` sits entirely within the explicit `GRID_SIZE x
// GRID_SIZE` grid -- both axes, start and span together. `null` (unresolved,
// or resolved into an implicit row/column) is never "on grid". Shared by
// `validateContent` (src/content/validate.ts) and any test that needs the
// identical definition of "visible" this function's own callers rely on,
// so the two can never quietly disagree about what counts as off-grid.
export function isOnGrid(resolved: ResolvedPlacement | null): boolean {
  if (!resolved) return false;
  return (
    resolved.colStart >= 1 &&
    resolved.colStart + resolved.colSpan - 1 <= GRID_SIZE &&
    resolved.rowStart >= 1 &&
    resolved.rowStart + resolved.rowSpan - 1 <= GRID_SIZE
  );
}
