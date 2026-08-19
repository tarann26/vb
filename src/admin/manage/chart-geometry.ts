// The arithmetic behind every drawing on the Numbers panel, with no React and
// no DOM in it.
//
// Separate from the components on purpose: a chart is the one thing on this
// screen whose defect is silent. A bar drawn at the wrong width still looks
// like a bar, and the reader has no way to check it against anything. So the
// numbers that decide where a shape lands are pure functions under a
// case-by-case test, and the components are left with nothing but attributes.
//
// jsdom cannot verify any RENDERED result of this -- it has no layout engine
// -- so what is proven here is the path strings and the percentages, and
// e2e/numbers-visuals.spec.ts measures what a real browser did with them.
export interface Extent {
  width: number;
  height: number;
}

export interface AreaPaths {
  // The stroked line across the top of the series.
  line: string;
  // The same line closed down to the baseline and back, for the fill.
  area: string;
  // The largest value in the series, which the caller names in the chart's
  // accessible label.
  peak: number;
}

// One decimal place everywhere. Full float precision produces path strings
// hundreds of characters longer for a difference no screen can resolve, and
// it makes an expected string in a test unreadable.
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function areaPaths(values: number[], extent: Extent): AreaPaths | null {
  // Fewer than two points is not a line. Returning null rather than a
  // degenerate path lets the card say "not enough yet" instead of drawing a
  // dot the reader has to interpret.
  if (values.length < 2) return null;
  // A zero-sized box is refused rather than divided by. `extent.width / 0`
  // and `height / 0` both produce Infinity, which lands in the path attribute
  // as literal text.
  if (extent.width <= 0 || extent.height <= 0) return null;

  const peak = Math.max(...values);
  // A run of zeros is a real state -- the panel SHIPS in it. Dividing by that
  // peak is a division by zero and renders the string "NaN", visibly, in the
  // markup.
  const scale = peak === 0 ? 0 : extent.height / peak;
  const step = extent.width / (values.length - 1);

  const points = values.map((value, index) => ({
    x: round(index * step),
    // SVG's y grows DOWNWARD, so the baseline is `height` and a big value is
    // a small y. Getting this backwards draws the chart upside down and it
    // still looks like a chart -- which is why it has its own test.
    y: round(extent.height - Math.max(0, value) * scale),
  }));

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${String(point.x)} ${String(point.y)}`).join(' ');
  const area = `${line} L${String(round(extent.width))} ${String(round(extent.height))} L0 ${String(round(extent.height))} Z`;
  return { line, area, peak };
}

// Each bar's width is its share of the LARGEST value, not of the total.
// Share-of-total makes the leading bar short whenever there are many rows,
// which on a ten-row page list is always -- and it reads as "the busiest page
// is unpopular", the opposite of what the card says. Share-of-largest gives
// the leader the whole track, always, which is what every bar list a reader
// has ever seen does.
//
// Percentages rather than pixels, because the track's width is a layout fact
// the browser owns and this module has no business guessing at.
//
// Math.max(2, ...) so a row with one visit still draws something: a
// zero-width bar beside a printed "1" reads as a rendering failure. And
// Math.max(0, value) before that, so a negative never becomes a negative
// width -- an attribute the browser silently ignores, leaving one row with no
// bar at all and nothing saying why.
export function barPercents(values: number[]): number[] {
  const peak = Math.max(0, ...values);
  // Every value zero is a real state and must not divide. Two per cent, not
  // zero: the rows exist and the card is not broken.
  if (peak === 0) return values.map(() => 2);
  return values.map((value) => Math.max(2, Math.round((Math.max(0, value) / peak) * 100)));
}

// The busiest-times chart paints density with opacity rather than with a
// colour ramp, for one reason worth stating: a ramp needs a key, and a key is
// another row of text on a card that is already 168 cells on a phone.
//
// Floored at 0.08 so a cell with ONE visit is visibly not empty. The
// difference between "quiet" and "closed" is the whole point of the card, and
// without the floor an hour with one visit renders identically to an hour the
// restaurant was shut.
export function cellOpacity(visits: number, peak: number): number {
  if (visits <= 0 || peak <= 0) return 0;
  return round(0.08 + (visits / peak) * 0.92);
}
