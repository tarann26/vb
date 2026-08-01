import { describe, it, expect } from 'vitest';
import { formatDayRange, formatTimeRange, toSchemaOpeningHours } from '../hours';

describe('formatTimeRange', () => {
  it('renders noon as 12:00 PM, not 00:00 PM', () => {
    expect(formatTimeRange('12:00', '13:00')).toBe('12:00 PM – 1:00 PM');
  });

  it('renders midnight as 12:00 AM, not 0:00 AM', () => {
    expect(formatTimeRange('00:00', '01:00')).toBe('12:00 AM – 1:00 AM');
  });

  it('renders 23:30 as 11:30 PM', () => {
    expect(formatTimeRange('12:00', '23:30')).toBe('12:00 PM – 11:30 PM');
  });

  // A closing time numerically earlier than the opening time means "past
  // midnight, the following day" -- the same convention schema.org itself
  // uses (this repo's own former JSON-LD once read "Fr-Su 12:00-00:00").
  // Each clock time is formatted independently with no reordering or
  // day-rollover arithmetic, so opens="12:00", closes="00:30" reads as
  // "12:00 PM – 12:30 AM": a correct literal rendering of the two times,
  // not a bug. Decided and documented here per review; see the matching
  // comment on toSchemaOpeningHours below.
  it('renders a past-midnight close without throwing or reordering', () => {
    expect(() => formatTimeRange('12:00', '00:30')).not.toThrow();
    expect(formatTimeRange('12:00', '00:30')).toBe('12:00 PM – 12:30 AM');
  });
});

describe('formatDayRange', () => {
  it('collapses contiguous days into a range', () => {
    expect(formatDayRange(['Mo', 'Tu', 'We', 'Th', 'Fr'])).toBe('Monday – Friday');
  });

  it('collapses a contiguous two-day weekend into a range', () => {
    expect(formatDayRange(['Sa', 'Su'])).toBe('Saturday – Sunday');
  });

  it('does not collapse non-contiguous days into a false range', () => {
    const result = formatDayRange(['Mo', 'We', 'Fr']);
    expect(result).not.toBe('Monday – Friday');
    expect(result).toBe('Monday, Wednesday, Friday');
  });

  it('renders a single day with no dash', () => {
    expect(formatDayRange(['Su'])).toBe('Sunday');
    expect(formatDayRange(['Su'])).not.toMatch(/–/);
  });
});

describe('toSchemaOpeningHours', () => {
  it('collapses contiguous days into a schema.org day range', () => {
    expect(
      toSchemaOpeningHours({ days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], opens: '12:00', closes: '23:30' }),
    ).toBe('Mo-Fr 12:00-23:30');
  });

  it('does not collapse non-contiguous days into a false range', () => {
    const result = toSchemaOpeningHours({ days: ['Mo', 'We', 'Fr'], opens: '12:00', closes: '23:30' });
    expect(result).not.toBe('Mo-Fr 12:00-23:30');
    expect(result).toBe('Mo,We,Fr 12:00-23:30');
  });

  it('renders a single day with no dash', () => {
    expect(toSchemaOpeningHours({ days: ['Su'], opens: '12:00', closes: '23:30' })).toBe('Su 12:00-23:30');
  });

  // Same past-midnight case as formatTimeRange above, and the same repo
  // history ("Fr-Su 12:00-00:00"): passed through literally, which is the
  // format schema.org itself expects for a range that ends after midnight.
  it('passes a past-midnight close through literally', () => {
    expect(
      toSchemaOpeningHours({ days: ['Fr', 'Sa', 'Su'], opens: '12:00', closes: '00:30' }),
    ).toBe('Fr-Su 12:00-00:30');
  });
});
