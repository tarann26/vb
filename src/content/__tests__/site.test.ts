import { describe, it, expect } from 'vitest';
import { assertHours, site } from '../index';

// assertHours narrows the widened `string[]` that a JSON import gives
// `hours[].days` down to DayCode[], and validates opens/closes, at import
// time. These tests exercise each rejection path directly, plus confirm the
// real site.json data (already loaded successfully above, or this whole
// file would fail to import) is valid.
describe('assertHours', () => {
  it('accepts a valid entry and returns it unchanged', () => {
    expect(assertHours({ days: ['Mo', 'Tu'], opens: '12:00', closes: '23:30' })).toEqual({
      days: ['Mo', 'Tu'],
      opens: '12:00',
      closes: '23:30',
    });
  });

  it('rejects an empty days array instead of rendering "undefined – undefined"', () => {
    expect(() => assertHours({ days: [], opens: '12:00', closes: '23:30' })).toThrow(
      /empty "days" array/,
    );
  });

  it('rejects an unknown day code instead of silently misreading it as contiguous', () => {
    expect(() => assertHours({ days: ['Xx', 'Mo'], opens: '12:00', closes: '23:30' })).toThrow(
      /invalid day code "Xx"/,
    );
  });

  it('rejects a malformed opens time such as "9am"', () => {
    expect(() => assertHours({ days: ['Mo'], opens: '9am', closes: '23:30' })).toThrow(
      /invalid "opens" time "9am"/,
    );
  });

  it('rejects a malformed closes time', () => {
    expect(() => assertHours({ days: ['Mo'], opens: '12:00', closes: 'late' })).toThrow(
      /invalid "closes" time "late"/,
    );
  });

  it('rejects an out-of-range hour even in HH:MM shape', () => {
    expect(() => assertHours({ days: ['Mo'], opens: '25:00', closes: '23:30' })).toThrow(
      /invalid "opens" time "25:00"/,
    );
  });

  it('confirms the real site.json hours data is valid', () => {
    expect(site.hours.length).toBeGreaterThan(0);
    site.hours.forEach((h) => {
      expect(() => assertHours(h)).not.toThrow();
    });
  });
});
