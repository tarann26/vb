// A headline number with something beside it to compare against, which is the
// entire reason this card exists: "about 4,100 visits" is a fact, and whether
// that is better or worse than last month is the question she actually has.
//
// The direction is a WORD as well as a colour. Colour alone fails for a
// colour-blind reader and fails again in a screenshot printed in black and
// white, and the sentence is already being written either way.
import React from 'react';
import type { Change } from './comparison';
import { changeSentence } from './comparison';

export interface StatCardProps {
  label: string;
  value: string;
  change: Change;
  unit: 'visits' | 'taps';
}

// Accent for both directions, deliberately. Green-up/red-down is the
// convention everywhere else and it is wrong here: this site's palette has no
// green, red on a restaurant dashboard reads as an alarm, and "fewer visits
// than last month" is information rather than a fault.
const StatCard: React.FC<StatCardProps> = ({ label, value, change, unit }) => (
  <div style={{ minWidth: '8rem' }}>
    <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
    <p className="text-2xl text-ink">{value}</p>
    <p className={change.direction === 'unknown' ? 'text-xs text-gray-500' : 'text-xs text-accent'}>
      {changeSentence(change, unit)}
    </p>
  </div>
);

export default StatCard;
