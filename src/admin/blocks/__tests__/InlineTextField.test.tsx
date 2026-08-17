import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

// window.prompt is "not implemented" in jsdom and printing that stack is the
// noise a review already had fixed once (window.scrollTo, stubbed in
// setup.ts) -- noise in a passing suite is what hides the next real error. It
// is spied per-test rather than stubbed globally in setup.ts, because its
// RETURN VALUE is this feature's input and a global stub would have to pick
// one answer for every test in the repository.
function promptWith(answer: string | null) {
  return vi.spyOn(window, 'prompt').mockReturnValue(answer);
}

function renderField(value: string, onChange = vi.fn()) {
  render(<InlineTextField id="f" label="Words" value={value} onChange={onChange} problems={[]} />);
  const area = screen.getByLabelText('Words') as HTMLTextAreaElement;
  return { area, onChange };
}

function select(area: HTMLTextAreaElement, start: number, end: number) {
  area.focus();
  area.setSelectionRange(start, end);
}

describe('the formatting toolbar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps the selection in bold markers and leaves the rest alone', async () => {
    const user = userEvent.setup();
    const { area, onChange } = renderField('Rest the dough for an hour.');
    select(area, 9, 14);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onChange).toHaveBeenCalledWith('Rest the **dough** for an hour.');
  });

  it('wraps the selection in emphasis markers', async () => {
    const user = userEvent.setup();
    const { area, onChange } = renderField('Rest the dough for an hour.');
    select(area, 9, 14);
    await user.click(screen.getByRole('button', { name: 'Italic' }));
    expect(onChange).toHaveBeenCalledWith('Rest the *dough* for an hour.');
  });

  // With nothing selected the markers still go in, around an empty middle, so
  // she can turn bold ON and then type. A toolbar that did nothing without a
  // selection is a button that appears broken.
  it('with nothing selected, inserts the markers and puts the caret between them', async () => {
    const user = userEvent.setup();
    const { area, onChange } = renderField('Rest the dough.');
    select(area, 15, 15);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onChange).toHaveBeenCalledWith('Rest the dough.****');
  });

  // The selection has to survive the round trip, or the second click of a
  // bold-then-italic pair applies to the wrong characters. This is the one
  // claim in the file that is about the textarea's own state rather than the
  // string, and jsdom implements setSelectionRange faithfully -- unlike
  // layout, which is why this is not an e2e test.
  it('keeps the same words selected afterwards, so a second marker lands correctly', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <InlineTextField id="f" label="Words" value="Rest the dough." onChange={onChange} problems={[]} />,
    );
    const area = screen.getByLabelText('Words') as HTMLTextAreaElement;
    select(area, 9, 14);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    rerender(
      <InlineTextField id="f" label="Words" value="Rest the **dough**." onChange={onChange} problems={[]} />,
    );
    expect(area.selectionStart).toBe(11);
    expect(area.selectionEnd).toBe(16);
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe('dough');
  });

  // The variant test, and it is the one a review had to write from outside
  // because no in-file case could see the difference: it re-renders BEFORE the
  // new value arrives. An effect that fires on every render consumes the
  // pending range against the stale string, clamps it (11,15 = "ugh.") and then
  // loses the caret entirely when the real value lands (19,19 = ""). An effect
  // that waits for its own value holds the range and lands it.
  //
  // No focus assertion anywhere -- the claim is about a selection, which jsdom
  // implements faithfully, and the earlier verdict that this was unfalsifiable
  // was wrong about the direction, not about the tooling.
  it('holds the selection through a re-render that arrives before the new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <InlineTextField id="f" label="Words" value="Rest the dough." onChange={onChange} problems={[]} />,
    );
    const area = screen.getByLabelText('Words') as HTMLTextAreaElement;
    select(area, 9, 14);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    // An unrelated prop moves and the value does NOT: the interleaving React 18
    // batching hides behind this component's real caller chain today, and which
    // is the whole reason the effect must decide for itself rather than trust
    // the render order.
    rerender(
      <InlineTextField
        id="f"
        label="Words"
        help="Some guidance."
        value="Rest the dough."
        onChange={onChange}
        problems={[]}
      />,
    );
    rerender(
      <InlineTextField
        id="f"
        label="Words"
        help="Some guidance."
        value="Rest the **dough**."
        onChange={onChange}
        problems={[]}
      />,
    );
    expect(area.selectionStart).toBe(11);
    expect(area.selectionEnd).toBe(16);
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe('dough');
  });

  it('a link wraps the selection and takes the target she typed', async () => {
    const user = userEvent.setup();
    promptWith('https://example.com/a');
    const { area, onChange } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).toHaveBeenCalledWith('See [the piece](https://example.com/a) here.');
  });

  it('a link with nothing selected gets placeholder words she can then replace', async () => {
    const user = userEvent.setup();
    promptWith('/catering');
    const { area, onChange } = renderField('Read more: ');
    select(area, 11, 11);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).toHaveBeenCalledWith('Read more: [this](/catering)');
  });

  it('cancelling the prompt changes nothing at all', async () => {
    const user = userEvent.setup();
    promptWith(null);
    const { area, onChange } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Pressing OK on an empty box is not the same act as pressing Cancel, and
  // she should be told so. Added because mutation 3 of this task's table
  // (treating `''` as Cancel) survived every other case in this file.
  it('pressing OK with nothing in the box is refused, not treated as cancelling', async () => {
    const user = userEvent.setup();
    promptWith('');
    const { area, onChange } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/will not work as a link/);
  });

  // The security half, and every payload here is one isSafeHref was hardened
  // against. Refused BEFORE it reaches the text: validatePosts would refuse
  // it too, at publish, minutes later and one screen away -- both boundaries
  // exist and neither replaces the other.
  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['//evil.example/x'],
    ['/\\evil.example'],
    ['/press/../../etc/passwd'],
    ['example.com'],
    ['https:// evil.example'],
  ])('refuses %s before it reaches the text', async (target) => {
    const user = userEvent.setup();
    promptWith(target);
    const { area, onChange } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/will not work as a link/);
  });

  // Accepted, and asserted beside the refusals rather than left implicit. A
  // percent-encoded backslash is not decoded before parsing, so it stays on
  // this origin -- refusing it would be over-strict against real content, and
  // that was a deliberate call when isSafeHref was hardened.
  it.each([['https://example.com/a'], ['/catering'], ['/press/%5Cx.webp']])(
    'accepts %s',
    async (target) => {
      const user = userEvent.setup();
      promptWith(target);
      const { area, onChange } = renderField('See the piece here.');
      select(area, 4, 13);
      await user.click(screen.getByRole('button', { name: 'Link' }));
      expect(onChange).toHaveBeenCalledWith(`See [the piece](${target}) here.`);
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );

  it('the refusal message clears once she supplies a usable target', async () => {
    const user = userEvent.setup();
    const spy = promptWith('javascript:alert(1)');
    const { area } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    spy.mockReturnValue('https://example.com/a');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The error region for a VALIDATION problem and the one for a refused link
  // are different things and must not collide -- two role="alert" nodes in
  // one field is the "two names for one thing" defect this project has
  // already fixed twice.
  it('a refused link and a validation problem are one alert region each', async () => {
    const user = userEvent.setup();
    promptWith('javascript:alert(1)');
    render(
      <InlineTextField
        id="f"
        label="Words"
        value="x"
        onChange={vi.fn()}
        problems={[{ field: '[0].blocks[0].text', message: 'this paragraph needs some words' }]}
      />,
    );
    const area = screen.getByLabelText('Words') as HTMLTextAreaElement;
    select(area, 0, 1);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts.map((el) => el.textContent)).toEqual([
      expect.stringContaining('will not work as a link'),
      'this paragraph needs some words',
    ]);
  });

  // A target that isSafeHref accepts but that would not survive being written
  // into the text. Measured by a review: this one passes isSafeHref, and once
  // embedded, rawLinkTargets -- the reader the write boundary uses -- reports
  // `javascript:alert(1)` instead, so publishing would be refused naming a
  // target she never typed. Nothing unsafe renders (parseInline builds no link
  // node), which is why this is about being told the truth now rather than
  // about safety.
  it('refuses a target that would not read back as the target she gave', async () => {
    const user = userEvent.setup();
    promptWith('https://ok.example/x](javascript:alert(1)');
    const { area, onChange } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/will not work as a link/);
  });

  // Parentheses inside a target are ordinary -- a Wikipedia article title is
  // the everyday case -- and the round-trip check above must not cost her
  // those. Asserted beside the refusal rather than left implicit, the same way
  // the `/%5C` acceptance is.
  it('accepts a target with balanced brackets in it', async () => {
    const user = userEvent.setup();
    const target = 'https://example.com/wiki/Tielle_(dish)';
    promptWith(target);
    const { area, onChange } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(onChange).toHaveBeenCalledWith(`See [the piece](${target}) here.`);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The bound on the refusal's life, and the half a review measured to be
  // missing: it used to end only on a successful insert, which is a bound she
  // may never reach.
  it('the refusal ends at her next keystroke in the box', async () => {
    const user = userEvent.setup();
    promptWith('javascript:alert(1)');
    const { area } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.type(area, '!');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The other half of that choice, pinned because it is the one a later reader
  // would "fix": Cancel does NOT clear it. Pressing Escape on a second attempt
  // is not her saying she has read the sentence, and she need never press Link
  // again -- so clearing there would bound nothing while letting a stray Escape
  // wipe advice she has not finished reading.
  it('cancelling a second attempt leaves the refusal standing', async () => {
    const user = userEvent.setup();
    const spy = promptWith('javascript:alert(1)');
    const { area } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    spy.mockReturnValue(null);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/will not work as a link/);
  });

  // The three buttons are a named group, so a screen reader meets "Formatting
  // for Words" rather than a bare "Bold, button" with nothing tying it to the
  // field it acts on. `group` and not `toolbar`: see the component's own
  // comment -- toolbar promises arrow-key navigation this does not implement.
  it('names the three buttons as a group belonging to this field', () => {
    render(<InlineTextField id="f" label="Heading" value="x" onChange={vi.fn()} problems={[]} />);
    const group = screen.getByRole('group', { name: 'Formatting for Heading' });
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Bold',
      'Italic',
      'Link',
    ]);
  });

  // The refusal is announced, not described: it carries no id and the textarea
  // does not point at it, so it cannot collide with the validation region's
  // `-error` id. Pinned here rather than left to a comment, because "wire it
  // into aria-describedby" is the plausible-looking change that would break it.
  it('the refusal is not wired into aria-describedby', async () => {
    const user = userEvent.setup();
    promptWith('javascript:alert(1)');
    const { area } = renderField('See the piece here.');
    select(area, 4, 13);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    const refusal = screen.getByRole('alert');
    expect(refusal).not.toHaveAttribute('id');
    expect(area).not.toHaveAttribute('aria-describedby');
  });
});
