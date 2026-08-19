// How far back the Numbers panel is counting: three pills, or four once the
// yearly archive holds something.
//
// Not a <select>. Four choices is fewer than a menu is worth, and a pressed
// pill can be read without opening anything -- which matters on the one screen
// she only ever reads.
//
// Every button says type="button", and that is not cosmetic. This renders
// inside the single <form> PublishBar's own button submits, where a bare
// <button> defaults to type="submit" and would become a second Publish
// trigger. NumbersArea's Retry button carries the same note for the same
// reason.
import React from 'react';
import type { AnalyticsRange } from '../../shared/analytics-payload';

// Exported so a test can assert the words she reads without retyping them,
// and so nothing else has to invent a second name for the same range. The
// rule below allows a plain constant out of a component file but not an
// object, and this project already takes the same exemption in EditMode.tsx,
// PhotoField.tsx and TemplateSectionList.tsx.
// eslint-disable-next-line react-refresh/only-export-components
export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  year: 'By year',
};

const ORDER: AnalyticsRange[] = ['7d', '30d', '90d', 'year'];

// The pressed pill is ink on brand: brand blue is a SURFACE colour (1.45:1 on
// white) and can never carry text, so what sits on it is ink. The unpressed
// ones are accent on white. Both pairings clear 4.5:1, and
// e2e/brand-contrast.spec.ts's sweep over every text node governs.
const PRESSED = "rounded bg-brand px-3 py-2 font-['Montserrat'] text-xs uppercase tracking-wide text-ink";
const UNPRESSED =
  "rounded border border-brand px-3 py-2 font-['Montserrat'] text-xs uppercase tracking-wide text-accent transition hover:bg-brand hover:text-ink";

export interface RangeControlProps {
  value: AnalyticsRange;
  onChange: (next: AnalyticsRange) => void;
  disabled: boolean;
  // The spec says "and -- once the archive has filled -- by year". A fourth
  // pill offered on day one against an empty rollup answers with an empty
  // chart, which teaches her the feature is broken.
  yearAvailable: boolean;
}

const RangeControl: React.FC<RangeControlProps> = ({ value, onChange, disabled, yearAvailable }) => (
  <div role="group" aria-label="How far back" className="mb-4 flex flex-wrap gap-2">
    {ORDER.filter((range) => range !== 'year' || yearAvailable).map((range) => (
      <button
        key={range}
        type="button"
        // aria-pressed, not aria-current: these are toggles over one setting,
        // and a screen reader announcing "pressed" is what tells her which one
        // she is looking at without reading the numbers first.
        aria-pressed={range === value}
        disabled={disabled}
        onClick={() => {
          onChange(range);
        }}
        className={range === value ? PRESSED : UNPRESSED}
      >
        {RANGE_LABELS[range]}
      </button>
    ))}
  </div>
);

export default RangeControl;
