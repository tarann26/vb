import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ScheduleField from '../ScheduleField';
import type { ValidationProblem } from '../../content/validate';

describe('ScheduleField: a real date input, prefilled', () => {
  it('renders the current value', () => {
    render(<ScheduleField id="f-pub" label="Publish on" value="2026-09-01" onChange={vi.fn()} problems={[]} />);
    const input = screen.getByLabelText('Publish on');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveValue('2026-09-01');
  });

  it('an unscheduled item (value undefined) renders an empty date input, not the literal string "undefined"', () => {
    render(<ScheduleField id="f-pub" label="Publish on" value={undefined} onChange={vi.fn()} problems={[]} />);
    expect(screen.getByLabelText('Publish on')).toHaveValue('');
  });

  it('picking a date reports the ISO string, unchanged', () => {
    const onChange = vi.fn();
    render(<ScheduleField id="f-pub" label="Publish on" value={undefined} onChange={onChange} problems={[]} />);
    // fireEvent.change, not userEvent.type -- a native <input type="date">
    // does not accept keystroke-by-keystroke typing of an ISO string the way
    // a text input does (confirmed: userEvent.type on a date input either
    // throws or silently no-ops depending on the string, since it tries to
    // type each character as a keypress against a widget with its own
    // segment-based editing). Every other date-input test in this codebase
    // (Field.test.tsx's own 'date' case) only asserts the initial value for
    // the same reason -- this is the one test here that also needs to
    // observe onChange, so it dispatches the event directly instead.
    const input = screen.getByLabelText('Publish on');
    fireEvent.change(input, { target: { value: '2026-09-01' } });
    expect(onChange).toHaveBeenCalledWith('2026-09-01');
  });

  // The one behaviour this whole component exists for. MUTATION CHECKED: if
  // ScheduleField's onChange reported `''` instead of `undefined` here (i.e.
  // if the `next === '' ? undefined : next` translation in ScheduleField.tsx
  // were removed), this assertion goes red -- `onChange` would have been
  // called with `''`, not `undefined`. Confirmed directly.
  it('clearing a previously-set date reports undefined, never an empty string', () => {
    const onChange = vi.fn();
    render(<ScheduleField id="f-pub" label="Publish on" value="2026-09-01" onChange={onChange} problems={[]} />);
    const input = screen.getByLabelText('Publish on');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(onChange).not.toHaveBeenCalledWith('');
  });
});

describe('ScheduleField: the hourly-cadence note is always shown, next to the control', () => {
  it('states publishing runs on an hourly check, not at midnight', () => {
    render(<ScheduleField id="f-pub" label="Publish on" value={undefined} onChange={vi.fn()} problems={[]} />);
    expect(screen.getByText(/hourly check/i)).toBeInTheDocument();
    expect(screen.getByText(/not at the stroke of midnight/i)).toBeInTheDocument();
  });

  it('the note is part of the input\'s own accessible description, not just floating text on the page', () => {
    render(<ScheduleField id="f-pub" label="Publish on" value={undefined} onChange={vi.fn()} problems={[]} />);
    expect(screen.getByLabelText('Publish on')).toHaveAccessibleDescription(/hourly check/i);
  });

  it('is shown alongside optional help text, not instead of it', () => {
    render(
      <ScheduleField
        id="f-pub"
        label="Publish on"
        help="Leave blank to publish immediately."
        value={undefined}
        onChange={vi.fn()}
        problems={[]}
      />,
    );
    expect(screen.getByText('Leave blank to publish immediately.')).toBeInTheDocument();
    expect(screen.getByText(/hourly check/i)).toBeInTheDocument();
  });
});

describe('ScheduleField: problems attach to the input, the same contract Field.tsx gives every other kind', () => {
  it('attaches a validation message via aria-describedby', () => {
    const problems: ValidationProblem[] = [{ field: '[0].publishAt', message: 'invalid "publishAt" date' }];
    render(<ScheduleField id="f-pub" label="Publish on" value="not-a-date" onChange={vi.fn()} problems={problems} />);
    expect(screen.getByLabelText('Publish on')).toHaveAccessibleDescription(/invalid "publishAt" date/);
  });

  it('renders no error paragraph when there is no problem', () => {
    render(<ScheduleField id="f-pub" label="Publish on" value={undefined} onChange={vi.fn()} problems={[]} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
