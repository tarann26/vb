// A ranked list where each row's bar is its share of the LEADER, not of the
// total. Same data as the two-column lists this replaces, same ranking, same
// numbers -- the change is entirely in the drawing, which is why it carries
// none of this panel's numeric risk.
//
// The bar's width is an inline style rather than a utility class, and that is
// the documented escape hatch rather than laziness: a width is DATA here (a
// different number per row), Tailwind's scanner cannot see a class name built
// from a variable, and a class per percentage would mint up to a hundred rules
// for values used once each against a stylesheet with 163 bytes of headroom.
// CSP's style-src allows inline style on purpose and src/test/hosting.test.ts
// counts the components that take this hatch.
import React from 'react';
import { barPercents } from './chart-geometry';

const ROW = 'border-b border-gray-100 py-2 last:border-0';
const HEAD = 'flex justify-between gap-4 text-sm text-ink';
const SUB = 'ml-2 text-xs text-gray-600';
// CORRECTED, by measurement rather than by reading. This comment used to say
// that `w-full` on the track was load-bearing -- that without it the track
// would wrap tight to its child and every bar would come out the same width as
// its own track, collapsing the ratio between two rows to one-to-one. That is
// not what happens. Removing the class and running e2e/numbers-visuals.spec.ts
// in a real Chromium at 390px and 1280px left all fifteen cases green and both
// bar widths unchanged, because this track is a <div> inside an <li> and a
// block-level box already fills its line. The claim was never checked.
//
// The class stays, and on the honest reason: it makes the full width explicit,
// so a later change that puts this track inside a row laid out along an axis
// cannot quietly narrow it, and it costs the stylesheet nothing because the
// rule is already shipped for a dozen other elements.
//
// The first draft of the paragraph above cost 36 bytes and three rules, and
// the rule-level diff is what caught it: it used the plain English word for
// "become narrower", which is also a bare Tailwind utility with no numeric
// suffix, and the scanner has no parser behind it. That is the seventh time on
// this project. Reword rather than trust a comment to be inert.
const TRACK = 'mt-1 h-2 w-full rounded bg-brand/20';
// Brand blue is a SURFACE colour (1.45:1 on white) and this is a surface: it
// carries no text and states nothing that is not also printed as a figure
// beside it, so it is the correct use of the token rather than an exception.
const FILL = 'h-2 rounded bg-brand';

export interface BarRow {
  key: string;
  label: string;
  sub?: string;
  value: number;
}

export interface BarListProps {
  rows: BarRow[];
  // <ol> for pages (rank is meaningful), <ul> for referrers.
  ordered: boolean;
}

const BarList: React.FC<BarListProps> = ({ rows, ordered }) => {
  const percents = barPercents(rows.map((row) => row.value));
  const List = ordered ? 'ol' : 'ul';
  return (
    <List className="text-sm text-ink">
      {rows.map((row, index) => (
        <li key={row.key} className={ROW} data-row={row.key}>
          <div className={HEAD}>
            <span>
              {row.label}
              {row.sub !== undefined && <span className={SUB}>{row.sub}</span>}
            </span>
            <span className="text-gray-600">{row.value.toLocaleString('en-IN')}</span>
          </div>
          {/* aria-hidden because the number beside the label already says
              everything the bar says -- a screen reader hearing both would
              hear every row twice. */}
          <div aria-hidden="true" className={TRACK}>
            <div className={FILL} style={{ width: `${String(percents[index])}%` }} data-bar={row.key} />
          </div>
        </li>
      ))}
    </List>
  );
};

export default BarList;
