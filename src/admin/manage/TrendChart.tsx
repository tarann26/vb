// One area chart, hand-drawn. No charting library, and the reason is a budget
// rather than a preference: Recharts or Chart.js is 50-150 KB on a dashboard
// whose stylesheet has 163 bytes of headroom, to draw one polyline.
//
// Everything positional is an ATTRIBUTE (d, viewBox, width, height), not a
// utility class, so this file adds almost nothing to the stylesheet.
//
// preserveAspectRatio="none" with a viewBox: the chart stretches to whatever
// width the card gives it and keeps its height, which is what makes it
// readable at 390px and at 1280px without measuring anything at runtime.
import React from 'react';
import { areaPaths } from './chart-geometry';
import { seriesLabel } from './analytics';
import type { AnalyticsSeriesPoint } from '../../shared/analytics-payload';

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 160;

export interface TrendChartProps {
  series: AnalyticsSeriesPoint[];
  grain: 'day' | 'month';
}

const TrendChart: React.FC<TrendChartProps> = ({ series, grain }) => {
  const paths = areaPaths(
    series.map((point) => point.visits),
    { width: VIEW_WIDTH, height: VIEW_HEIGHT },
  );

  if (paths === null) {
    const noun = grain === 'month' ? 'months' : 'days';
    return <p className="text-sm text-gray-600">Not enough {noun} yet to draw a line — this needs at least two.</p>;
  }

  return (
    <>
      <svg
        viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
        preserveAspectRatio="none"
        role="img"
        // Named rather than left to a screen reader to describe: an <svg> with
        // no accessible name is announced as "graphic" and nothing else. The
        // numbers themselves are elsewhere on the screen, so this names the
        // shape and does not try to read out thirty values.
        aria-label={`Visits over the last ${String(series.length)} ${grain === 'month' ? 'months' : 'days'}, highest ${String(paths.peak)}`}
        className="h-32 w-full"
      >
        {/* Brand blue as a SURFACE fill only -- it is 1.45:1 on white and can
            never carry meaning on its own. The stroke above it is the accent,
            which is 6.03:1 and is what the eye actually follows. */}
        <path d={paths.area} fill="#C8D8E8" />
        <path d={paths.line} fill="none" stroke="#9D4949" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* AT MONTH GRAIN ONLY, and this row is where the partial-month marker
          actually reaches the screen: the caption says "Months marked * are
          not complete" and this is what carries the star. Thirty day labels
          under a 390px chart would be a smear, and the day grain has no
          comparable claim to make -- a day is a day. */}
      {grain === 'month' && (
        <ol className="mt-1 flex justify-between text-xs text-gray-500">
          {series.map((point) => (
            <li key={point.date}>{seriesLabel(point.date, point.complete)}</li>
          ))}
        </ol>
      )}
    </>
  );
};

export default TrendChart;
