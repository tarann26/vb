// Plan 5 Task 3, Step 3: contentEditable, uncontrolled, buffered on focus,
// committed on blur -- not an <input> swap (see EditableText.tsx's own
// header comment for why an input would visibly change the page while she
// is editing it).
//
// Every interaction here goes through `fireEvent.focus`/`fireEvent.blur`
// directly, plus a real DOM write to `el.textContent`, rather than
// `userEvent.type` -- simulating individual keystrokes into a
// contentEditable element is exactly the kind of browser-native editing
// behavior jsdom does not faithfully reproduce (there is no real
// `execCommand`/selection engine underneath it), so a keystroke-by-keystroke
// simulation here would be testing jsdom's approximation of typing, not
// this component's own focus/blur/commit contract. Setting `textContent`
// directly and firing the same focus/blur events a real tap produces is
// what this component actually listens for.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EditableText from '../EditableText';

describe('EditableText: uncontrolled, buffered on focus, committed on blur', () => {
  it('renders the initial value as plain text, with no commit until something actually changes', () => {
    const onCommit = vi.fn();
    render(<EditableText path="hero.logoName" value="Via Bianca" onCommit={onCommit} />);
    const el = screen.getByText('Via Bianca');
    expect(el).toHaveAttribute('contenteditable', 'true');
    fireEvent.focus(el);
    fireEvent.blur(el);
    expect(onCommit).not.toHaveBeenCalled();
  });

  // Mutation this guards: committing on every keystroke (e.g. wiring
  // onCommit to an onInput handler instead of onBlur) instead of buffering
  // until blur -- confirmed red by temporarily adding an onInput handler
  // that also calls onCommit; TagsInput (Field.tsx) already made this same
  // choice for the identical reason (a controlled re-render mid-keystroke
  // moves the caret). fireEvent.input, not just setting `textContent`
  // directly, is what actually exercises such a handler: a bare property
  // assignment dispatches no DOM event on its own, so a naive version of
  // this test that skipped firing `input` would stay green under that exact
  // mutation for the wrong reason -- confirmed directly while writing this
  // test.
  it('typing (a real DOM text change) then blurring commits the new value, keyed on this element\'s own path', () => {
    const onCommit = vi.fn();
    render(<EditableText path="hero.reserveButton" value="Reserve Now" onCommit={onCommit} />);
    const el = screen.getByText('Reserve Now');

    fireEvent.focus(el);
    expect(onCommit).not.toHaveBeenCalled();
    el.textContent = 'Book a Table';
    fireEvent.input(el);
    expect(onCommit).not.toHaveBeenCalled(); // still buffered -- not yet blurred.
    fireEvent.blur(el);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('hero.reserveButton', 'Book a Table');
  });

  // Mutation this guards: dropping the `next !== beforeEditRef.current`
  // check in handleBlur -- confirmed red by removing it, which calls
  // onCommit even when nothing changed (an ordinary focus/blur with no
  // edit, e.g. tabbing past the field).
  it('focusing and blurring with no edit at all does not commit', () => {
    const onCommit = vi.fn();
    render(<EditableText path="hero.reserveButton" value="Reserve Now" onCommit={onCommit} />);
    const el = screen.getByText('Reserve Now');
    fireEvent.focus(el);
    fireEvent.blur(el);
    expect(onCommit).not.toHaveBeenCalled();
  });

  // Mutation this guards: handleKeyDown not resetting `ref.current.textContent`
  // before blurring -- confirmed red by commenting out that one assignment,
  // which leaves the typed text on screen and (since it then differs from
  // beforeEditRef.current) commits it anyway.
  it('Escape restores the previous value and does not mark it dirty', () => {
    const onCommit = vi.fn();
    render(<EditableText path="hero.reserveButton" value="Reserve Now" onCommit={onCommit} />);
    const el = screen.getByText('Reserve Now');

    fireEvent.focus(el);
    el.textContent = 'Something Else Entirely';
    fireEvent.keyDown(el, { key: 'Escape' });

    expect(el.textContent).toBe('Reserve Now');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a key other than Escape does not reset or commit anything on its own', () => {
    const onCommit = vi.fn();
    render(<EditableText path="hero.reserveButton" value="Reserve Now" onCommit={onCommit} />);
    const el = screen.getByText('Reserve Now');
    fireEvent.focus(el);
    el.textContent = 'Mid Edit';
    fireEvent.keyDown(el, { key: 'a' });
    expect(el.textContent).toBe('Mid Edit');
    expect(onCommit).not.toHaveBeenCalled();
  });

  // The U+00A0 case named explicitly by Task 3's brief: copy.footer.followLabel
  // is refused by validate.ts without a non-breaking space between its two
  // words, and contentEditable normalisation is exactly where a naive
  // `.trim()` or a `\s`-based whitespace collapse silently turns it into an
  // ordinary space. `.toBe`, not `.toContain` -- exact string equality is
  // what catches a transformation that only touches PART of the string
  // (appending '!' at the end while a bug strips/collapses the NBSP in the
  // middle).
  //
  // Mutation this guards: replacing `ref.current?.textContent ?? ''` in
  // handleBlur with `(ref.current?.textContent ?? '').replace(/\s+/g, ' ')`
  // -- confirmed red: the committed value becomes 'Follow Us!' (an ORDINARY
  // space in place of the NBSP), which fails `toBe('Follow\u00a0Us!')`.
  it('a non-breaking space (U+00A0) in the value survives a real focus/edit/blur round trip verbatim', () => {
    // The explicit \u00a0 escape, not a literal non-breaking-space character
    // sitting invisibly in this source file -- validate.ts's own comment on
    // copy.footer.followLabel makes the identical choice, for the identical
    // reason: the character this test depends on needs to stay legible in a
    // diff, not look like an ordinary space.
    const NBSP = '\u00a0';
    const original = `Follow${NBSP}Us`;
    const onCommit = vi.fn();
    render(<EditableText path="footer.followLabel" value={original} onCommit={onCommit} />);
    // getByRole, not getByText(original): Testing Library's default text
    // normalizer collapses `\s+` (which, in a JS regex, matches U+00A0 the
    // same as an ordinary space) down to a single plain space before
    // comparing, so a query string that still carries the real NBSP would
    // never match its own normalized rendering. role="textbox" is this
    // element's own, unambiguous identity regardless of its text content.
    const el = screen.getByRole('textbox');

    fireEvent.focus(el);
    el.textContent = `${original}!`;
    fireEvent.blur(el);

    expect(onCommit).toHaveBeenCalledWith('footer.followLabel', `Follow${NBSP}Us!`);
    // The committed string must contain the real U+00A0 codepoint, not a
    // regular space at that position -- spelled out explicitly rather than
    // trusting the fixture string above alone to prove it.
    const committed = onCommit.mock.calls[0][1] as string;
    expect(committed.charCodeAt(6)).toBe(0x00a0);
  });

  it('an external value change (e.g. a fresh load) updates the DOM while not focused', () => {
    const { rerender } = render(<EditableText path="hero.logoName" value="Via Bianca" onCommit={vi.fn()} />);
    expect(screen.getByText('Via Bianca')).toBeInTheDocument();
    rerender(<EditableText path="hero.logoName" value="Via Bianca II" onCommit={vi.fn()} />);
    expect(screen.getByText('Via Bianca II')).toBeInTheDocument();
  });

  // Mutation this guards: dropping the `if (isFocused) return;` guard in the
  // resync effect -- confirmed red by removing it: the effect's dependency
  // array is `[value, isFocused]`, so a rerender with the prop UNCHANGED
  // never re-runs the effect at all regardless of the guard (an earlier
  // version of this test used an unchanged `value` on rerender and stayed
  // green under this exact mutation -- vacuous, since the effect body never
  // ran either way). Rerendering with a genuinely DIFFERENT `value` is what
  // forces the effect to actually run, which is the only way this test can
  // tell "skipped because focused" apart from "never ran at all".
  it('an external value change while focused does NOT overwrite what she is mid-typing', () => {
    const { rerender } = render(<EditableText path="hero.logoName" value="Via Bianca" onCommit={vi.fn()} />);
    const el = screen.getByText('Via Bianca');
    fireEvent.focus(el);
    el.textContent = 'Mid Keystroke';
    // A DIFFERENT `value` prop -- the effect's deps genuinely change, so it
    // runs; only the `isFocused` guard inside it stops the DOM write.
    rerender(<EditableText path="hero.logoName" value="Something From The Server" onCommit={vi.fn()} />);
    expect(el.textContent).toBe('Mid Keystroke');
  });

  describe('tap, not hover -- the affordance is persistently visible and entering edit mode needs no prior hover event', () => {
    // jsdom applies no real CSS, so `hover:`-gated visibility can only be
    // checked at the source level: a hover-revealed affordance always pairs
    // a hidden-by-default utility (opacity-0/invisible/hidden) with its
    // `hover:` counterpart in the SAME class list. Neither appears here.
    //
    // Mutation this guards: changing the className to
    // `"opacity-0 hover:opacity-100 outline-dashed ..."` (a hover-reveal) --
    // confirmed red against that exact string.
    it('the persistent className carries no hover: variant and no hidden-by-default utility', () => {
      const source = readFileSync('src/admin/EditableText.tsx', 'utf8');
      const match = source.match(/className="([^"]*)"/);
      expect(match).not.toBeNull();
      const className = match![1];
      expect(className).not.toMatch(/\bhover:/);
      expect(className).not.toMatch(/\b(opacity-0|invisible|hidden)\b/);
      // And a real, persistent visual marker IS there unconditionally --
      // this half is what stops the check above from passing vacuously
      // against an element with no visible affordance classes at all.
      expect(className).toMatch(/\boutline-dashed\b/);
    });

    // At a 390px viewport (the spec's own named case, the hero collage at
    // ~60px tiles) -- set here even though this component's own affordance
    // does not vary by width at all, which is itself the point: nothing
    // about entering edit mode is gated behind a min-width media query
    // either, so the same assertions hold regardless of viewport.
    it('at a 390px viewport, focusing (a tap) alone -- no mouseenter/mouseover ever fires -- is enough to start editing', () => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });

      const onCommit = vi.fn();
      render(<EditableText path="hero.logoName" value="Via Bianca" onCommit={onCommit} />);
      const el = screen.getByText('Via Bianca');

      // No hover/pointer-enter event of any kind precedes this -- only the
      // focus a tap produces.
      fireEvent.focus(el);
      el.textContent = 'Tapped Edit';
      fireEvent.blur(el);

      expect(onCommit).toHaveBeenCalledWith('hero.logoName', 'Tapped Edit');

      Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true, writable: true });
    });
  });
});
