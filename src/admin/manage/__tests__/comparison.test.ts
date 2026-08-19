import { describe, expect, it } from 'vitest';
import { changeBetween, changeSentence, FLAT_BAND, MIN_PREVIOUS_FOR_CHANGE } from '../comparison';

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
    expect(changeBetween(current, previous)).toEqual({ direction, percent });
  });

  it('never returns a negative percent', () => {
    expect(changeBetween(10, 100).percent).toBe(90);
  });

  it('never returns a non-finite percent', () => {
    // The zero-previous case is what would otherwise render the word
    // Infinity in front of her.
    for (const previous of [0, 1, 19]) {
      expect(changeBetween(1000, previous).percent).toBeNull();
    }
  });
});

describe('changeSentence', () => {
  it('names the unit it is comparing', () => {
    expect(changeSentence(changeBetween(120, 100), 'visits')).toBe('20% more visits than the period before.');
    expect(changeSentence(changeBetween(80, 100), 'taps')).toBe('20% fewer taps than the period before.');
  });

  it('says why it cannot compare rather than showing a zero', () => {
    expect(changeSentence(changeBetween(500, 3), 'visits')).toBe(
      'Not enough of the period before to compare visits against.',
    );
  });

  it('states the two thresholds it depends on', () => {
    expect(MIN_PREVIOUS_FOR_CHANGE).toBe(20);
    expect(FLAT_BAND).toBe(0.05);
  });
});
