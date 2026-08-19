// The comparison beside every headline number, as arithmetic that can be
// table-tested rather than as an expression buried in a card.
//
// Three things this refuses to do, each of which a naive percentage does:
//   - divide by zero and render the word Infinity;
//   - claim "up 100%" off a previous period of one visit;
//   - call a two-percent wobble a change.
//
// It compares THIS PERIOD against the PREVIOUS EQUIVALENT PERIOD, which is
// not what Card D compares. Card D is a constant seven days against the
// seven before it, deliberately and correctly. Reusing thisWeekVisits/
// priorWeekVisits here would make the stat cards and Card D disagree at
// every range except 7d -- she would read "18% more visits" beside "about
// the same as usual" on one screen, with nothing to tell her which was
// answering which question.

// Below this many in the PREVIOUS period, no change is claimed at all. The
// same judgement MIN_PRIOR_WEEK_VISITS already makes for Card D, and the
// same number, deliberately: two cards disagreeing about how much history is
// enough would be a worse inconsistency than either threshold being slightly
// wrong.
export const MIN_PREVIOUS_FOR_CHANGE = 20;

// Inside five percent either way, this says so rather than picking a
// direction. Narrower than Card D's fifteen percent because that card is
// choosing between three whole sentences and this one shows a figure the
// reader can see for herself.
export const FLAT_BAND = 0.05;

export type ChangeDirection = 'up' | 'down' | 'flat' | 'unknown';

export interface Change {
  direction: ChangeDirection;
  // Rounded to a whole percent, always positive -- the sign lives in
  // `direction`, so nothing downstream has to decide whether to print a
  // minus. null exactly when direction is 'unknown'.
  percent: number | null;
}

export function changeBetween(current: number, previous: number): Change {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { direction: 'unknown', percent: null };
  if (previous < MIN_PREVIOUS_FOR_CHANGE) return { direction: 'unknown', percent: null };
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < FLAT_BAND) return { direction: 'flat', percent: 0 };
  return { direction: ratio > 0 ? 'up' : 'down', percent: Math.round(Math.abs(ratio) * 100) };
}

export function changeSentence(change: Change, unit: 'visits' | 'taps'): string {
  const noun = unit === 'visits' ? 'visits' : 'taps';
  switch (change.direction) {
    case 'unknown':
      return `Not enough of the period before to compare ${noun} against.`;
    case 'flat':
      return `About the same ${noun} as the period before.`;
    case 'up':
      return `${String(change.percent)}% more ${noun} than the period before.`;
    case 'down':
      return `${String(change.percent)}% fewer ${noun} than the period before.`;
  }
}
