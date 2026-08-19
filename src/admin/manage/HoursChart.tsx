// Seven rows of twenty-four cells, painted by density: how busy each hour of
// each weekday was. Genuinely useful for a restaurant deciding when to staff,
// and the one card on this panel answering a question about the week ahead
// rather than the one behind.
//
// ONE <svg> holding 168 <rect> elements rather than 168 divs. A rect is
// nothing but attributes -- x, y, width, height, opacity -- which cost the
// stylesheet not one byte, while 168 boxes on a phone would be a layout the
// browser has to solve. The viewBox is also what lets the whole drawing scale
// to whatever width the card gives it, with nothing measured at runtime.
//
// Density is opacity on the accent rather than a colour ramp, because a ramp
// needs a key and a key is one more row of text on a card that is already 168
// cells on a 390px screen. chart-geometry's cellOpacity floors that opacity so
// an hour with one visit stays visibly different from an hour the restaurant
// was shut -- which is the whole question this card answers.
import React from 'react';
import { cellOpacity } from './chart-geometry';
import type { AnalyticsHourCell } from '../../shared/analytics-payload';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = [...Array<number>(24).keys()];
const CELL = 10;
const GAP = 1;
const LABEL_WIDTH = 26;
const VIEW_WIDTH = LABEL_WIDTH + 24 * (CELL + GAP);
const VIEW_HEIGHT = 7 * (CELL + GAP) + 12;

export interface HoursChartProps {
  cells: AnalyticsHourCell[];
}

const HoursChart: React.FC<HoursChartProps> = ({ cells }) => {
  const byKey = new Map(cells.map((cell) => [`${String(cell.day)}:${String(cell.hour)}`, cell.visits]));
  const peak = cells.reduce((highest, cell) => Math.max(highest, cell.visits), 0);

  return (
    <svg
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
      role="img"
      // An <svg> with no accessible name is announced as "graphic" and nothing
      // else. The timezone is in the name rather than only in the caption
      // because a reader who cannot see the caption is the one most likely to
      // read an evening as a morning.
      aria-label="Visits by day of the week and hour of the day, in Indian time"
      className="w-full"
    >
      {DAYS.map((name, day) => (
        <g key={name}>
          <text x={0} y={day * (CELL + GAP) + CELL} fontSize={8} fill="#222222">
            {name}
          </text>
          {HOURS.map((hour) => (
            <rect
              key={hour}
              x={LABEL_WIDTH + hour * (CELL + GAP)}
              y={day * (CELL + GAP)}
              width={CELL}
              height={CELL}
              // The accent, 6.03:1 on white, so a full-strength cell carries
              // meaning on its own. Brand blue is a surface colour at 1.45:1
              // and a chart of densities drawn in it would be unreadable at
              // the quiet end.
              fill="#9D4949"
              opacity={cellOpacity(byKey.get(`${String(day)}:${String(hour)}`) ?? 0, peak)}
            />
          ))}
        </g>
      ))}
      {/* Three hour marks, not twenty-four: at 390px, 24 labels under a 10px
          row overlap into a smear. Midnight, noon and six in the evening are
          enough to orient a reader who already knows what a week looks like. */}
      {[0, 12, 18].map((hour) => (
        <text key={hour} x={LABEL_WIDTH + hour * (CELL + GAP)} y={VIEW_HEIGHT - 2} fontSize={7} fill="#222222">
          {hour === 0 ? '12am' : hour === 12 ? '12pm' : '6pm'}
        </text>
      ))}
    </svg>
  );
};

export default HoursChart;
