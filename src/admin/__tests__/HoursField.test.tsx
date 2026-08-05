import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HoursField from '../HoursField';
import { HOURS_FIELDS } from '../fields';
import { validateContent } from '../../content/validate';
import type { Hours, SiteContent } from '../../content/types';
import type { ValidationProblem } from '../../content/validate';

const WEEKDAY: Hours = { days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], opens: '12:00', closes: '23:30' };
const WEEKEND: Hours = { days: ['Sa', 'Su'], opens: '12:00', closes: '23:30' };
const TWO_ROWS: Hours[] = [WEEKDAY, WEEKEND];

// A complete, otherwise-valid site.json fixture -- the real validator needs
// every other field present so these tests are only ever about the one
// thing they mean to be (the `hours` rows), the same reason
// validate.test.ts's own `validSite` exists.
function validSite(hours: Hours[]): SiteContent {
  return {
    name: 'Via Bianca',
    tagline: 'Pastificio & Ristorante',
    strapline: 'Sip Italiano',
    address: { street: '1 Test Street', locality: 'Delhi', postalCode: '110048', country: 'IN' },
    phones: ['+91 00000 00000'],
    whatsapp: { number: '910000000000', prefilledMessage: 'Hi' },
    socials: { instagram: 'https://instagram.com/test', linkedin: null },
    hours,
    seo: {
      title: 'Via Bianca',
      description: 'An Italian kitchen',
      keywords: 'italian',
      ogImage: '/og.jpg',
      url: 'https://example.com',
      locale: 'en_IN',
    },
    copyrightYear: 2026,
  };
}

function renderField(overrides: Partial<Parameters<typeof HoursField>[0]> = {}) {
  const onChange = vi.fn();
  render(<HoursField value={TWO_ROWS} onChange={onChange} problems={[]} {...overrides} />);
  return { onChange };
}

describe('HoursField: renders one row per hours entry, prefilled', () => {
  it('shows each row\'s days, opens and closes', () => {
    renderField();
    const opens = screen.getAllByLabelText(HOURS_FIELDS.opens.label);
    const closes = screen.getAllByLabelText(HOURS_FIELDS.closes.label);
    const days = screen.getAllByLabelText(HOURS_FIELDS.days.label);
    expect(opens.map((el) => (el as HTMLInputElement).value)).toEqual(['12:00', '12:00']);
    expect(closes.map((el) => (el as HTMLInputElement).value)).toEqual(['23:30', '23:30']);
    expect(days.map((el) => (el as HTMLInputElement).value)).toEqual(['Mo, Tu, We, Th, Fr', 'Sa, Su']);
  });

  it('editing one row\'s closes time reports the whole array, only that row changed', () => {
    // fireEvent.change (one shot), not userEvent.clear+type -- `value` here
    // is a fixed prop (this harness's `onChange` is a bare spy, not a real
    // state setter), so a controlled input reverts to that fixed prop after
    // every keystroke; multi-keystroke typing needs a stateful wrapper the
    // same way Field.test.tsx's own ControlledField exists for exactly this
    // (see that file's header comment). One direct `change` event sidesteps
    // it.
    const { onChange } = renderField();
    const [, secondCloses] = screen.getAllByLabelText(HOURS_FIELDS.closes.label);
    fireEvent.change(secondCloses, { target: { value: '22:00' } });
    expect(onChange).toHaveBeenCalledWith([WEEKDAY, { ...WEEKEND, closes: '22:00' }]);
    // Untouched sibling is the SAME value, not a coincidentally-equal copy.
    expect(onChange.mock.calls[0][0][0]).toBe(WEEKDAY);
  });
});

describe('HoursField: reorder, add, and remove', () => {
  it('names move buttons per row, omitted at the ends', () => {
    renderField();
    expect(screen.getByRole('button', { name: 'Move hours row 1 down' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move hours row 1 up' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move hours row 2 up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move hours row 2 down' })).not.toBeInTheDocument();
  });

  it('moving row 1 down swaps the two rows, each with its own values intact', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();
    await user.click(screen.getByRole('button', { name: 'Move hours row 1 down' }));
    expect(onChange).toHaveBeenCalledWith([WEEKEND, WEEKDAY]);
  });

  it('"Add an opening-hours row" appends a blank row that fails validation until filled in', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();
    await user.click(screen.getByRole('button', { name: 'Add an opening-hours row' }));
    expect(onChange).toHaveBeenCalledWith([WEEKDAY, WEEKEND, { days: [], opens: '', closes: '' }]);
  });

  it('"Remove hours row 1" drops only that row, leaving the other intact', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();
    await user.click(screen.getByRole('button', { name: 'Remove hours row 1' }));
    expect(onChange).toHaveBeenCalledWith([WEEKEND]);
  });

  it('a single-row list has neither an up nor a down button', () => {
    renderField({ value: [WEEKDAY] });
    expect(screen.queryByRole('button', { name: /Move hours row 1/ })).not.toBeInTheDocument();
  });
});

// The brief's own explicit warning: a closing time numerically earlier than
// the opening time (past midnight) is VALID -- do not add a "closes after
// opens" rule anywhere, including here. Proven against the REAL validator,
// not a hand-typed stand-in for it.
describe('HoursField: a past-midnight close is accepted, never flagged -- proven against the real validator', () => {
  it('assertHours (via validateContent) raises no problem for opens > closes', () => {
    const pastMidnight: Hours = { days: ['Fr', 'Sa'], opens: '23:00', closes: '00:30' };
    const problems = validateContent('site.json', validSite([pastMidnight]));
    expect(problems.filter((p) => p.field === 'hours' || p.field.startsWith('hours['))).toEqual([]);
  });

  it('renders that same row with no error banner and no per-field error', () => {
    const pastMidnight: Hours = { days: ['Fr', 'Sa'], opens: '23:00', closes: '00:30' };
    const problems = validateContent('site.json', validSite([pastMidnight]));
    render(<HoursField value={[pastMidnight]} onChange={vi.fn()} problems={problems} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// RecordList's own "an EMPTY list still surfaces every problem" guarantee,
// reproduced here for hours: validateSite's bare `hours` message (fires only
// when the array is empty) has no row to attach to at all, so it must
// surface in HoursField's own top-level banner instead of vanishing because
// no row claims it.
describe('HoursField: an EMPTY list still surfaces the real validator\'s own message', () => {
  it('shows "the site needs at least one opening-hours entry" when every row is removed', () => {
    const problems = validateContent('site.json', validSite([]));
    expect(problems.some((p) => p.field === 'hours')).toBe(true);
    render(<HoursField value={[]} onChange={vi.fn()} problems={problems} />);
    const alert = screen.getByRole('alert', { name: 'Problems with opening hours' });
    expect(alert).toHaveTextContent('the site needs at least one opening-hours entry');
  });
});

describe('HoursField: a malformed row\'s own message attaches to that row only', () => {
  it('a bad opens time on row 2 shows up on row 2, not row 1, and not the top banner', () => {
    const bad: Hours = { days: ['Sa', 'Su'], opens: '9am', closes: '23:30' };
    const problems = validateContent('site.json', validSite([WEEKDAY, bad]));
    expect(problems).toEqual([{ field: 'hours[1]', message: expect.stringMatching(/invalid "opens" time "9am"/) }]);

    render(<HoursField value={[WEEKDAY, bad]} onChange={vi.fn()} problems={problems} />);
    // Not in the top-level "problems no row claims" banner -- row 2 exists
    // and claims it.
    expect(screen.queryByRole('alert', { name: 'Problems with opening hours' })).not.toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).queryByText(/invalid "opens" time/)).not.toBeInTheDocument();
    expect(within(rows[1]).getByText(/invalid "opens" time "9am"/)).toBeInTheDocument();
  });

  it('a problem naming a row index past the end of what is rendered still surfaces, in the top banner', () => {
    const problems: ValidationProblem[] = [{ field: 'hours[5]', message: 'a stale problem for a row no longer here' }];
    render(<HoursField value={TWO_ROWS} onChange={vi.fn()} problems={problems} />);
    expect(screen.getByRole('alert', { name: 'Problems with opening hours' })).toHaveTextContent(
      'a stale problem for a row no longer here',
    );
  });

  // The EXACT boundary, not just "some index past the end". `hours[5]`
  // above and `>` (a plausible off-by-one typo for the real `>=`) agree --
  // both are well past two rows. `hours[2]` against a two-row array
  // (indices 0 and 1) is the one value that distinguishes them: `>=`
  // correctly treats index 2 as past the end (banner); `>` would not, and
  // since index 2 also matches no rendered row's own `hoursIndexOf(p.field)
  // === index` check, the problem would be silently dropped entirely --
  // neither attached to a row nor banked in the banner. Same shape as
  // RecordList's own Task 5 empty-list fixture gap: a test named for a
  // boundary that never actually reaches it.
  it('a problem naming the row index EXACTLY one past the end still surfaces (off-by-one boundary)', () => {
    const problems: ValidationProblem[] = [{ field: 'hours[2]', message: 'exactly one past the last of two rows' }];
    render(<HoursField value={TWO_ROWS} onChange={vi.fn()} problems={problems} />);
    expect(screen.getByRole('alert', { name: 'Problems with opening hours' })).toHaveTextContent(
      'exactly one past the last of two rows',
    );
  });
});
