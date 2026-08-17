import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InlineTextField from '../InlineTextField';

describe('InlineTextField', () => {
  it('associates its label with its textarea', () => {
    render(<InlineTextField id="f" label="Words" value="Rest the dough" onChange={vi.fn()} problems={[]} />);
    expect(screen.getByLabelText('Words')).toHaveValue('Rest the dough');
  });

  it('reports every keystroke', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<InlineTextField id="f" label="Words" value="" onChange={onChange} problems={[]} />);
    await user.type(screen.getByLabelText('Words'), 'Hi');
    expect(onChange.mock.calls.map(([next]) => next)).toEqual(['H', 'i']);
  });

  it('points the textarea at its help text and its error, in that order', () => {
    render(
      <InlineTextField
        id="f"
        label="Words"
        help="Some guidance."
        value=""
        onChange={vi.fn()}
        problems={[{ field: 'x', message: 'this paragraph needs some words' }]}
      />,
    );
    expect(screen.getByLabelText('Words')).toHaveAttribute('aria-describedby', 'f-help f-error');
    expect(screen.getByRole('alert')).toHaveTextContent('this paragraph needs some words');
    // Both ids resolve to something, which is the half a describedby
    // assertion on its own does not check.
    expect(document.getElementById('f-help')).toHaveTextContent('Some guidance.');
    expect(document.getElementById('f-error')).toHaveTextContent('this paragraph needs some words');
  });

  // Matters more than it looks: an aria-describedby pointing at an element
  // that does not exist is read as nothing by some screen readers and as a
  // broken reference by others, and it is the state this component is in for
  // most of its life. `''` from the `.join()` is coerced to `undefined` by the
  // `|| undefined` for exactly that reason.
  it('has no error region and no dangling aria-describedby when nothing is wrong', () => {
    render(<InlineTextField id="f" label="Words" value="ok" onChange={vi.fn()} problems={[]} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Words')).not.toHaveAttribute('aria-describedby');
  });

  it('with problems but no help, points only at the error', () => {
    render(
      <InlineTextField
        id="f"
        label="Words"
        value=""
        onChange={vi.fn()}
        problems={[{ field: 'x', message: 'this paragraph needs some words' }]}
      />,
    );
    expect(screen.getByLabelText('Words')).toHaveAttribute('aria-describedby', 'f-error');
  });

  // Field.tsx joins every message for one field into one paragraph. Two
  // presentations of the same thing on one screen is the "two names for one
  // thing" defect this project has fixed twice, so this pins the sibling's
  // shape rather than merely that both messages are somewhere.
  it('joins two messages for one field into the one error paragraph, like Field does', () => {
    render(
      <InlineTextField
        id="f"
        label="Words"
        value="[x]("
        onChange={vi.fn()}
        problems={[
          { field: 'x', message: 'first complaint' },
          { field: 'x', message: 'second complaint' },
        ]}
      />,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('first complaint second complaint');
  });
});
