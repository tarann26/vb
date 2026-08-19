import { describe, expect, it } from 'vitest';
import {
  changeBetween,
  changeSentence,
  FLAT_BAND,
  MIN_PREVIOUS_FOR_CHANGE,
  previousWindowIsCounted,
  previousWindowOpensOn,
} from '../comparison';

// Every row and every call below passes `true` for "the previous window was
// being counted throughout" unless it is testing that flag itself. The block
// at the bottom of this file is where the flag is false, and it is the only
// place the arithmetic above is allowed to be skipped.
const COUNTED = true;

describe('changeBetween', () => {
  const cases: Array<[number, number, string, number | null]> = [
    // current, previous, direction, percent
    [120, 100, 'up', 20],
    [80, 100, 'down', 20],
    [102, 100, 'flat', 0],
    [98, 100, 'flat', 0],
    [106, 100, 'up', 6],
    // EXACTLY at the flat band. Without this row, `<` and `<=` in the flat
    // test are indistinguishable and the mutation table's fourth row cannot
    // redden. It is in the table from the start for that reason.
    [105, 100, 'up', 5],
    // Two rows whose percentage does NOT land on a whole number, because
    // every other row here does, and while that is true Math.round is
    // interchangeable with Math.floor and with Math.ceil -- the operator that
    // decides the figure on the card cannot be tested by a table that never
    // asks it to decide anything. One row cannot pin all three: Math.round of
    // a value always agrees with either Math.floor or Math.ceil of it, so it
    // takes one row of each.
    //   1275 against 1000 is 27.500000000000004 raw:
    //     Math.round and Math.ceil say 28, Math.floor says 27.
    [1275, 1000, 'up', 28],
    //   728 against 1000 is 27.200000000000003 raw:
    //     Math.round and Math.floor say 27, Math.ceil says 28.
    [728, 1000, 'down', 27],
    // Previous period below the floor: no claim, whatever current is.
    [500, 19, 'unknown', null],
    [500, 0, 'unknown', null],
    [0, 0, 'unknown', null],
    // Exactly at the floor is enough.
    [40, 20, 'up', 100],
    // Down to nothing is a real, sayable answer.
    [0, 100, 'down', 100],
    [Number.NaN, 100, 'unknown', null],
    [100, Number.POSITIVE_INFINITY, 'unknown', null],
  ];

  it.each(cases)('%i against %i is %s %s', (current, previous, direction, percent) => {
    expect(changeBetween(current, previous, COUNTED)).toEqual({ direction, percent });
  });

  it('never returns a negative percent', () => {
    expect(changeBetween(10, 100, COUNTED).percent).toBe(90);
  });

  it('never returns a non-finite percent', () => {
    // The zero-previous case is what would otherwise render the word
    // Infinity in front of her.
    for (const previous of [0, 1, 19]) {
      expect(changeBetween(1000, previous, COUNTED).percent).toBeNull();
    }
  });
});

describe('changeSentence', () => {
  it('names the unit it is comparing', () => {
    expect(changeSentence(changeBetween(120, 100, COUNTED), 'visits')).toBe('20% more visits than the period before.');
    expect(changeSentence(changeBetween(80, 100, COUNTED), 'taps')).toBe('20% fewer taps than the period before.');
  });

  it('says why it cannot compare rather than showing a zero', () => {
    expect(changeSentence(changeBetween(500, 3, COUNTED), 'visits')).toBe(
      'Not enough of the period before to compare visits against.',
    );
  });

  it('states the two thresholds it depends on', () => {
    expect(MIN_PREVIOUS_FOR_CHANGE).toBe(20);
    expect(FLAT_BAND).toBe(0.05);
  });
});

// ---------------------------------------------------------------------------
// The window that predates counting.
//
// The count floor cannot see this one. Fifteen real days of a busy restaurant
// is hundreds of visits, far above twenty, so the only thing that can tell a
// whole previous window from a half-empty one is where the window opens.
// ---------------------------------------------------------------------------

describe('the previous window', () => {
  // 2026-09-15, midday, so nothing here depends on the machine's timezone or
  // on the hour the test runs at.
  const at = (day: string) => Date.parse(`${day}T12:00:00.000Z`);

  it('opens two whole windows back from the start of today', () => {
    // The Worker's own arithmetic: every window ends at the start of today
    // UTC, the current one is `windowDays` long, and the previous one is the
    // `windowDays` before that. 60 days before 2026-09-15 is 2026-07-17.
    expect(previousWindowOpensOn(at('2026-09-15'), 30)).toBe('2026-07-17');
    expect(previousWindowOpensOn(at('2026-09-15'), 7)).toBe('2026-09-01');
    expect(previousWindowOpensOn(at('2026-09-15'), 90)).toBe('2026-03-19');
  });

  it('ignores the time of day, so the answer does not change between lunch and dinner', () => {
    expect(previousWindowOpensOn(Date.parse('2026-09-15T00:00:00.000Z'), 30)).toBe(
      previousWindowOpensOn(Date.parse('2026-09-15T23:59:59.000Z'), 30),
    );
  });

  it('is counted only when it opens on or after the day counting started', () => {
    // Opens 2026-07-17, which is before visits were being counted at all.
    expect(previousWindowIsCounted(at('2026-09-15'), 30, '2026-08-18')).toBe(false);
    // The boundary: the window opens exactly on the first counted day.
    expect(previousWindowIsCounted(at('2026-10-17'), 30, '2026-08-18')).toBe(true);
    // One day earlier it is one day short, and that is still a refusal.
    expect(previousWindowIsCounted(at('2026-10-16'), 30, '2026-08-18')).toBe(false);
  });

  it('answers differently for visits and for taps on the same day, as it must', () => {
    // The two dates are eleven days apart, and on this day the 7-day taps
    // comparison is whole while the 7-day visits comparison is not. One flag
    // for both cards would have to be wrong on one of them.
    expect(previousWindowIsCounted(at('2026-08-25'), 7, '2026-08-07')).toBe(true);
    expect(previousWindowIsCounted(at('2026-08-25'), 7, '2026-08-18')).toBe(false);
  });

  it('refuses to divide by a window that is part record and part silence', () => {
    // The scenario, in the numbers the card would print: 4,100 visits this
    // period against 2,050 in a previous period half of which predates
    // counting. Without the guard the card says "100% more visits than the
    // period before" for a restaurant whose traffic did not move -- and the
    // counting-started banner that would explain it is gone by then, because
    // it is suppressed the moment visits stop being zero.
    expect(changeBetween(4100, 2050, false)).toEqual({ direction: 'unknown', percent: null });
    expect(changeSentence(changeBetween(4100, 2050, false), 'visits')).toBe(
      'Not enough of the period before to compare visits against.',
    );
    // And it is the FLAG doing it, not the count floor: the same numbers with
    // a whole window behind them are a real answer.
    expect(changeBetween(4100, 2050, true)).toEqual({ direction: 'up', percent: 100 });
  });
});
