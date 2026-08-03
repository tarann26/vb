import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Field from '../Field';
import type { FieldSpec } from '../fields';
import type { ValidationProblem } from '../../content/validate';

// `Field` is a controlled input -- its DOM value is `value`, not its own
// internal state. Typing multiple characters into it (userEvent.type) needs
// a wrapper that actually feeds each onChange back into a new `value`, the
// same as any real caller (RecordForm) does; without one, React resets the
// input back to the ORIGINAL `value` prop after every keystroke (since it
// never changes), and only the last keystroke's effect on that fixed
// starting value is what onChange ever reports. Used below only where a
// test types more than one character.
function ControlledField<V>({
  spec,
  initial,
  onChange,
  problems = [],
}: {
  spec: FieldSpec<V>;
  initial: V;
  onChange: (next: V) => void;
  problems?: ValidationProblem[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <Field
      id="f-controlled"
      spec={spec}
      value={value}
      problems={problems}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('Field: labeling and description wiring', () => {
  it('associates the label with the input, and has no accessible description when there is no help or problem', () => {
    render(<Field id="f-name" spec={{ label: 'Name', kind: 'text' }} value="Negroni" onChange={vi.fn()} problems={[]} />);
    const input = screen.getByLabelText('Name');
    expect(input).toHaveValue('Negroni');
    expect(input).not.toHaveAccessibleDescription();
  });

  // The brief's own example, verbatim: a validation message must be
  // ATTACHED to its own input (aria-describedby), not merely present
  // somewhere in the document -- a plain `getByText` assertion would still
  // pass if the message were rendered next to a completely different
  // field, which is the exact defect this task exists to prevent.
  it('attaches a single validation message to its own input via aria-describedby', () => {
    const problems: ValidationProblem[] = [{ field: '[0].name', message: 'this dish needs a name' }];
    render(<Field id="f-name" spec={{ label: 'Name', kind: 'text' }} value="" onChange={vi.fn()} problems={problems} />);
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('this dish needs a name');
  });

  it('shows help text as the accessible description when there is no problem', () => {
    render(
      <Field
        id="f-id"
        spec={{ label: 'ID', kind: 'text', help: 'A short identifier used only to tell dishes apart.' }}
        value=""
        onChange={vi.fn()}
        problems={[]}
      />,
    );
    expect(screen.getByLabelText('ID')).toHaveAccessibleDescription('A short identifier used only to tell dishes apart.');
  });

  it('combines help text and a problem into one accessible description', () => {
    render(
      <Field
        id="f-id"
        spec={{ label: 'ID', kind: 'text', help: 'A short identifier.' }}
        value=""
        onChange={vi.fn()}
        problems={[{ field: '[0].id', message: 'dish at position 0 needs an id' }]}
      />,
    );
    expect(screen.getByLabelText('ID')).toHaveAccessibleDescription('A short identifier. dish at position 0 needs an id');
  });

  it('joins more than one problem for the same field into the one accessible description', () => {
    render(
      <Field
        id="f-x"
        spec={{ label: 'X', kind: 'text' }}
        value=""
        onChange={vi.fn()}
        problems={[
          { field: 'x', message: 'first problem' },
          { field: 'x', message: 'second problem' },
        ]}
      />,
    );
    expect(screen.getByLabelText('X')).toHaveAccessibleDescription('first problem second problem');
  });
});

describe('Field: one input per kind, wired to onChange', () => {
  it('text: a plain input, reporting the typed value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field id="f-name" spec={{ label: 'Name', kind: 'text' }} value="" onChange={onChange} problems={[]} />);
    await user.type(screen.getByLabelText('Name'), 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('image: the same plain text input as \'text\' (no upload widget yet)', () => {
    render(<Field id="f-img" spec={{ label: 'Photo', kind: 'image' }} value="/food/x.webp" onChange={vi.fn()} problems={[]} />);
    const input = screen.getByLabelText('Photo');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('/food/x.webp');
  });

  it('image: falls back to an empty string for a null value, not the literal string "null"', () => {
    render(<Field id="f-img" spec={{ label: 'Photo', kind: 'image' }} value={null} onChange={vi.fn()} problems={[]} />);
    expect(screen.getByLabelText('Photo')).toHaveValue('');
  });

  it('textarea: a real <textarea>, reporting the typed value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field id="f-desc" spec={{ label: 'Description', kind: 'textarea' }} value="" onChange={onChange} problems={[]} />);
    const textarea = screen.getByLabelText('Description');
    expect(textarea.tagName).toBe('TEXTAREA');
    await user.type(textarea, 'y');
    expect(onChange).toHaveBeenCalledWith('y');
  });

  it('select: renders exactly the declared options, in order, and reports the chosen one', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Field
        id="f-cat"
        spec={{ label: 'Category', kind: 'select', options: ['mocktail', 'cocktail', 'wine'] }}
        value="mocktail"
        onChange={onChange}
        problems={[]}
      />,
    );
    const select = screen.getByLabelText('Category');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['mocktail', 'cocktail', 'wine']);
    await user.selectOptions(select, 'wine');
    expect(onChange).toHaveBeenCalledWith('wine');
  });

  it('date: a real date input', () => {
    render(<Field id="f-pub" spec={{ label: 'Publish on', kind: 'date' }} value="2026-09-01" onChange={vi.fn()} problems={[]} />);
    const input = screen.getByLabelText('Publish on');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveValue('2026-09-01');
  });

  it('readonly: a disabled input, showing the value, with its help text always visible', () => {
    render(
      <Field
        id="f-name-ro"
        spec={{ label: 'Restaurant name', kind: 'readonly', help: 'Ask your developer.' }}
        value="Via Bianca"
        onChange={vi.fn()}
        problems={[]}
      />,
    );
    const input = screen.getByLabelText('Restaurant name');
    expect(input).toBeDisabled();
    expect(input).toHaveValue('Via Bianca');
    expect(screen.getByText('Ask your developer.')).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription('Ask your developer.');
  });

  it('tags: displays the list comma-joined', () => {
    render(<Field id="f-tags" spec={{ label: 'Days', kind: 'tags' }} value={['Mo', 'Tu']} onChange={vi.fn()} problems={[]} />);
    expect(screen.getByLabelText('Days')).toHaveValue('Mo, Tu');
  });

  it('tags: keeps a mid-typed delimiter on screen rather than erasing it (the input has its own buffer, not a live round-trip through the parsed array)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field id="f-tags" spec={{ label: 'Days', kind: 'tags' }} value={['Mo', 'Tu']} onChange={onChange} problems={[]} />);
    const input = screen.getByLabelText('Days');
    await user.clear(input);
    await user.type(input, 'We,');
    // Confirmed this fails against the live-round-trip version: re-deriving
    // the display from split/filter on every keystroke drops the comma the
    // instant it's typed, since a lone trailing empty segment parses away
    // to nothing -- so `onChange` was never even the point of this
    // assertion, the visible DOM value is.
    expect(input).toHaveValue('We,');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('tags: commits a trimmed, non-empty split only once she leaves the field', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field id="f-tags" spec={{ label: 'Days', kind: 'tags' }} value={['Mo', 'Tu']} onChange={onChange} problems={[]} />);
    const input = screen.getByLabelText('Days');
    await user.clear(input);
    await user.type(input, 'We,Th ,');
    expect(onChange).not.toHaveBeenCalled();
    await user.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['We', 'Th']);
  });

  it('toggle: a checkbox, reporting the flipped boolean', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field id="f-enabled" spec={{ label: 'Shown on homepage', kind: 'toggle' }} value={false} onChange={onChange} problems={[]} />);
    const checkbox = screen.getByLabelText('Shown on homepage');
    expect(checkbox).toHaveAttribute('type', 'checkbox');
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('number: a numeric input', () => {
    render(<Field id="f-year" spec={{ label: 'Copyright year', kind: 'number' }} value={2024} onChange={vi.fn()} problems={[]} />);
    const input = screen.getByLabelText('Copyright year');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveValue(2024);
  });

  it('number: reports a number, not a string, after being retyped', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledField spec={{ label: 'Copyright year', kind: 'number' }} initial={2024} onChange={onChange} />);
    const input = screen.getByLabelText('Copyright year');
    await user.clear(input);
    await user.type(input, '2026');
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(lastCall?.[0]).toBe(2026);
    expect(typeof lastCall?.[0]).toBe('number');
  });
});
