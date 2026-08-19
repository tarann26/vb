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

// ---------------------------------------------------------------------------
// The other floor, and it is not a count.
//
// A previous window that opens BEFORE the day counting started is part real
// record and part silence, and dividing by it flatters the restaurant by
// however much of it is silence. Walk it forward: counting starts on L, she
// picks the default 30-day range, today is L+45. The current window is
// [L+15, L+45] -- thirty real days. The previous window is [L-15, L+15] --
// fifteen real days and fifteen days of nothing. Thirty days of traffic over
// fifteen reads as "100% more visits than the period before", and the
// counting-started banner that would have explained it is suppressed the
// moment visits stop being zero. Nothing on the screen would say why.
//
// MIN_PREVIOUS_FOR_CHANGE cannot see this: fifteen real days of a busy
// restaurant is far above twenty visits. The window's own opening date is the
// only thing that can, so it is asked for separately and the card says "not
// enough of the period before" -- which is exactly what is true.
const DAY_MS = 86_400_000;

// The day the previous window opens, by the SAME arithmetic the Worker uses
// to ask for it: every window ends at the start of today UTC
// (worker/analytics.ts's `until`), the current one is `windowDays` long, and
// the previous one is the `windowDays` before that (`sincePrevious`).
//
// Takes the clock as an argument rather than reading it, so the boundary is a
// table-testable question rather than something that has to be arranged. The
// browser's clock is the one available here, and it can differ from the
// Worker's by minutes -- which can only matter on the single day the
// comparison opens, and then only by one day.
export function previousWindowOpensOn(nowMs: number, windowDays: number): string {
  return new Date(Math.floor(nowMs / DAY_MS) * DAY_MS - 2 * windowDays * DAY_MS).toISOString().slice(0, 10);
}

// Whether that window lies entirely inside the record. `countingStartedOn` is
// per MEASURE, not per panel: visits have been counted since the Web
// Analytics token was unified and taps since the counter shipped, eleven days
// apart, and one date serving both is the defect backlog item 1 was raised
// about.
export function previousWindowIsCounted(nowMs: number, windowDays: number, countingStartedOn: string): boolean {
  return previousWindowOpensOn(nowMs, windowDays) >= countingStartedOn;
}

export type ChangeDirection = 'up' | 'down' | 'flat' | 'unknown';

export interface Change {
  direction: ChangeDirection;
  // Rounded to a whole percent, always positive -- the sign lives in
  // `direction`, so nothing downstream has to decide whether to print a
  // minus. null exactly when direction is 'unknown'.
  percent: number | null;
}

// `previousWindowIsCounted` is REQUIRED rather than defaulting to true, and
// for the same reason formatCountingStartedOn refuses a default date: a
// default is what let one value stand for two different questions until
// something on screen was wrong. Every caller has to say which measure's
// record it is comparing inside.
export function changeBetween(current: number, previous: number, previousWindowIsCounted: boolean): Change {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { direction: 'unknown', percent: null };
  // Before the count floor, deliberately: a denominator that is half silence
  // is not made trustworthy by being large.
  if (!previousWindowIsCounted) return { direction: 'unknown', percent: null };
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
