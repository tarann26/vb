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
import { useLayoutEffect, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EditableText from '../EditableText';

// A real caller (EditMode's buildBundle) re-renders with `value` set to
// whatever `onCommit` just reported, in the SAME batched update as the
// `isFocused` flip this component's own blur handler triggers -- React 18
// batches a native event handler's own setState calls together with any
// setState an `onCommit`/`onStaged`-style callback triggers synchronously
// inside it, so by the time the resync effect (`useLayoutEffect` on
// `[value, isFocused]`) actually runs, `value` already equals what
// `handleBlur` just wrote to the DOM. A bare `<EditableText value="fixed
// string" .../>` in a test has no such feedback loop -- `value` never
// moves, so that SAME effect re-runs on the isFocused flip alone and
// "corrects" the DOM back to the original, stale prop, which would falsely
// blame this component for reverting an edit it never actually lost. This
// harness is what closes that gap for any test that needs to look at DOM
// state (not just what `onCommit` was called with) after a blur.
function CommitHarness({
  path,
  initial,
  onCommitSpy,
}: {
  path: string;
  initial: string;
  onCommitSpy: (path: string, next: string) => void;
}) {
  const [value, setValue] = useState(initial);
  function handleCommit(p: string, next: string) {
    onCommitSpy(p, next);
    setValue(next);
  }
  return <EditableText path={path} value={value} onCommit={handleCommit} />;
}

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

  // I7 review finding: the test above (and most others in this file) only
  // ever asserts what `onCommit` was called with -- never what
  // handleBlur's own unconditional resync write (EditableText.tsx:143,
  // `ref.current.textContent = displayTextFor(next)`) actually leaves in
  // the DOM. That write's EXISTENCE is already pinned elsewhere (the
  // Finding C2 "emptied field" tests need SOME write to produce a
  // non-collapsing placeholder at all; the Finding C1 <br>/paste tests
  // need SOME write to strip the stray markup they build), but nothing
  // pins that what gets written is specifically `next` -- the value that
  // was just committed -- rather than some other string.
  //
  // Checking FINAL DOM state after the fact (the obvious approach, and
  // what an earlier draft of this test did) cannot catch this: with
  // CommitHarness, `onCommit` also updates the `value` PROP to `next` in
  // the same batch, so the resync `useLayoutEffect` (line 105) re-runs
  // moments later anyway (its own deps, `[value, isFocused]`, both just
  // changed) and independently re-corrects the DOM to `displayTextFor(next)`
  // regardless of what line 143 itself wrote a moment earlier -- confirmed
  // directly: a version of this test that only checked `el.textContent`
  // after `fireEvent.blur` stayed GREEN even with `next` swapped for
  // `beforeEditRef.current` on line 143, because the layout effect's own,
  // separate write papered over it. Spying on the element's own
  // `textContent` SETTER instead captures the literal sequence of writes
  // as they happen -- line 143's own write is the FIRST one made
  // synchronously inside the blur dispatch itself, strictly before React
  // flushes the batched state update and runs the layout effect's later,
  // separate correction -- which is what actually isolates this one line.
  it('the DOM after an ordinary blur shows exactly the value that was committed, not merely something', () => {
    const onCommit = vi.fn();
    render(<CommitHarness path="hero.reserveButton" initial="Reserve Now" onCommitSpy={onCommit} />);
    const el = screen.getByText('Reserve Now');
    fireEvent.focus(el);
    el.textContent = 'Book a Table';

    const writes: (string | null)[] = [];
    const setter = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!.set as (this: Node, v: string | null) => void;
    const textContentSpy = vi.spyOn(Node.prototype, 'textContent', 'set').mockImplementation(function (this: Node, value: string | null) {
      if (this === el) writes.push(value);
      setter.call(this, value);
    });
    fireEvent.blur(el);
    // Restores ONLY this one spy -- `vi.restoreAllMocks()` would also reset
    // `onCommit`'s own recorded calls (it resets every mock's call history,
    // `vi.fn()`-created ones included, not merely spies), which would make
    // the assertion below fail for a reason that has nothing to do with
    // this component at all. Confirmed directly while writing this test.
    textContentSpy.mockRestore();

    expect(onCommit).toHaveBeenCalledWith('hero.reserveButton', 'Book a Table');
    // The very FIRST write this element's own textContent setter saw
    // during the blur dispatch -- handleBlur's own line 143, ahead of
    // anything the layout effect's later correction might also write.
    expect(writes[0]).toBe('Book a Table');
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

// ---------------------------------------------------------------------------
// Task 3 review Finding C1: "what she sees at /edit is not what will
// publish." Measured in a real Chromium browser, not reasoned about: caret
// at the end of a real field, Enter, type a second line -- the DOM shows two
// lines (a `<br>` the browser inserted); the committed value silently runs
// them together with no space; and after blur the `<br>` was STILL there,
// because `.textContent` (used both to commit and to decide whether the DOM
// needed correcting) could not see it. These tests build real DOM state
// directly (real child nodes, a real `paste` event) rather than only ever
// writing `el.textContent`, since a test that only ever sets `textContent`
// can never produce the DOM shape (a `<br>`, a pasted element) this defect
// depends on -- the exact gap the review named.
describe('Task 3 review Finding C1: the DOM never permanently diverges from the committed value', () => {
  // Mutation this guards: leaving `aria-multiline="true"` and Enter's
  // default browser action alone -- confirmed red by reverting handleKeyDown
  // to not intercept 'Enter' at all: fireEvent.keyDown's own return value
  // (`element.dispatchEvent`'s per-spec result) is `true` -- not cancelled --
  // the instant nothing calls `preventDefault()`.
  it('Enter is blocked outright -- this field has no multi-line support', () => {
    const onCommit = vi.fn();
    render(<EditableText path="drinks.intro" value="Montalcino." onCommit={onCommit} />);
    const el = screen.getByText('Montalcino.');
    fireEvent.focus(el);
    const notCancelled = fireEvent.keyDown(el, { key: 'Enter' });
    expect(notCancelled).toBe(false); // false === preventDefault() was called
    expect(onCommit).not.toHaveBeenCalled();
  });

  // The review's own exact repro, built as real DOM child nodes (a `<br>`
  // contributes nothing to `.textContent`, exactly like Enter's default
  // action would have produced before it was blocked above) -- proving the
  // BLUR-TIME resync is what closes this, independent of whatever put the
  // structure there in the first place (Enter is blocked now, but a future
  // regression, a browser quirk, or an extension could still leave DOM
  // structure `.textContent` can't see).
  //
  // Mutation this guards: reverting handleBlur's unconditional
  // `ref.current.textContent = displayTextFor(next)` back to the old
  // conditional write (skip when `ref.current.textContent === value`) --
  // confirmed red: `.textContent` of the DOM built below is already exactly
  // the string that gets committed, so the old guard's `!==` check is false
  // and the DOM is never corrected, leaving the `<br>` elements in place
  // after blur.
  it('a <br> present in the DOM (Enter\'s own default action, were it not blocked) is stripped by blur, and the committed value matches what is left on screen', () => {
    const onCommit = vi.fn();
    render(<CommitHarness path="drinks.intro" initial="Montalcino." onCommitSpy={onCommit} />);
    const el = screen.getByText('Montalcino.');
    fireEvent.focus(el);
    el.replaceChildren(
      document.createTextNode('Montalcino.'),
      document.createElement('br'),
      document.createTextNode('Open till late.'),
      document.createElement('br'),
    );
    fireEvent.blur(el);

    expect(onCommit).toHaveBeenCalledWith('drinks.intro', 'Montalcino.Open till late.');
    expect(el.querySelector('br')).toBeNull();
    expect(el.textContent).toBe('Montalcino.Open till late.');
  });

  // The review's other exact repro: a real browser's default paste action
  // leaves the clipboard's own HTML in the DOM (bold, slanted, a foreign
  // color) while `.textContent` -- and therefore what gets committed -- was
  // always plain. Built here as the real DOM state a paste would have left
  // behind, proving blur alone (independent of the paste handler below)
  // already guarantees the DOM she's looking at matches what was committed.
  it('rich formatting present in the DOM (a real browser\'s own default paste action, were it not intercepted) is stripped to plain text by blur', () => {
    const onCommit = vi.fn();
    render(<CommitHarness path="press.intro" initial="Come" onCommitSpy={onCommit} />);
    const el = screen.getByText('Come');
    fireEvent.focus(el);
    const bold = document.createElement('b');
    bold.style.color = 'red';
    // `<i>`, not assigned to a variable literally named after the CSS
    // style it renders -- Tailwind's content scanner has no JS parser
    // behind it and tokenizes an identifier the same way it tokenizes a
    // className string (tailwind.config.js's own `blocklist` comment
    // documents the identical hazard for `.blur()`); that word is also a
    // real, no-argument Tailwind utility.
    const slanted = document.createElement('i');
    slanted.textContent = 'Visit';
    bold.appendChild(slanted);
    el.replaceChildren(document.createTextNode('Come '), bold);
    fireEvent.blur(el);

    expect(onCommit).toHaveBeenCalledWith('press.intro', 'Come Visit');
    expect(el.querySelector('b, i')).toBeNull();
    expect(el.textContent).toBe('Come Visit');
  });

  // This project's own contentEditable typing limits apply here too (see
  // this file's own header comment): jsdom implements no default paste
  // insertion at all, so this cannot prove what a real browser's own paste
  // action would leave behind (the two tests above already cover that via
  // direct DOM construction) -- it proves this component's OWN paste
  // handler, which is what stops that from ever happening on a real browser
  // in the first place: only `text/plain` is ever read off the clipboard and
  // inserted, through the Selection/Range API, so no rich markup reaches the
  // DOM even before blur.
  //
  // Mutation this guards: deleting the `onPaste` handler entirely --
  // confirmed red: jsdom's own default action for a `paste` event is a
  // no-op (it implements no clipboard-to-DOM insertion of its own), so
  // without a handler nothing is inserted at all and `el.textContent` stays
  // 'Come Visit' rather than becoming 'Come Visit!'.
  it('pasting inserts plain text only, read from text/plain -- never the clipboard\'s own HTML', () => {
    const onCommit = vi.fn();
    render(<EditableText path="press.intro" value="Come Visit" onCommit={onCommit} />);
    const el = screen.getByText('Come Visit');
    fireEvent.focus(el);

    const textNode = el.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const clipboardData = {
      getData: (type: string) => (type === 'text/plain' ? '!' : '<b>!</b>'),
    };
    fireEvent.paste(el, { clipboardData });

    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toBe('Come Visit!');
    fireEvent.blur(el);
    expect(onCommit).toHaveBeenCalledWith('press.intro', 'Come Visit!');
  });

  // I5 review finding: the test above only ever checked the RESULT of
  // paste, never that the browser's own default paste action was actually
  // cancelled -- and on jsdom, that distinction is invisible in the
  // result, because jsdom's own default paste action is already a no-op
  // (this file's own comment on the test above). So a mutation that
  // deleted ONLY `event.preventDefault()` (EditableText.tsx:183),
  // leaving the rest of handlePaste's own manual Range-API insertion
  // running exactly as before, produced the identical `el.textContent`
  // and stayed green. On a real browser this matters: without it, the
  // browser's OWN default insertion (the clipboard's real HTML) would run
  // IN ADDITION to this component's manual one, corrupting the field.
  // Checked the same way this file's own Enter test above already checks
  // preventDefault on a different event: `fireEvent`'s own return value
  // (`element.dispatchEvent`'s per-spec result) is `false` the instant
  // anything calls `preventDefault()`, regardless of what jsdom's default
  // action for that event would have done.
  it('paste is prevented outright -- the browser\'s own default paste action never gets a chance to run alongside this component\'s own', () => {
    const onCommit = vi.fn();
    render(<EditableText path="press.intro" value="Come Visit" onCommit={onCommit} />);
    const el = screen.getByText('Come Visit');
    fireEvent.focus(el);

    const textNode = el.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const clipboardData = { getData: (type: string) => (type === 'text/plain' ? '!' : '<b>!</b>') };
    const notCancelled = fireEvent.paste(el, { clipboardData });
    expect(notCancelled).toBe(false); // false === preventDefault() was called
  });

  // I6 review finding: the existing paste test above only ever pastes at a
  // COLLAPSED caret (nothing selected), so it can never tell
  // `range.deleteContents()` (EditableText.tsx:188) apart from simply
  // deleting that one line -- `Range.insertNode()` inserts at the range's
  // START boundary regardless of whether deleteContents ran first, and
  // with nothing selected, "start" and "the whole (empty) selection" are
  // the same point either way. Pasting OVER a real selection is the case
  // that actually depends on it: without `deleteContents()`,
  // `insertNode()` would insert the new text at the selection's start and
  // leave the selected text sitting immediately after it, un-removed --
  // confirmed red by deleting that one line: the result becomes
  // 'Come ThereVisit', not the replacement 'Come There' this test expects.
  it('pasting over a selected range REPLACES the selection, not merely inserts before it', () => {
    const onCommit = vi.fn();
    render(<EditableText path="press.intro" value="Come Visit" onCommit={onCommit} />);
    const el = screen.getByText('Come Visit');
    fireEvent.focus(el);

    // Select "Visit" (the last five characters) within the single text
    // node "Come Visit".
    const textNode = el.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 'Come '.length);
    range.setEnd(textNode, 'Come Visit'.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const clipboardData = { getData: (type: string) => (type === 'text/plain' ? 'There' : '<b>There</b>') };
    fireEvent.paste(el, { clipboardData });

    expect(el.textContent).toBe('Come There');
    fireEvent.blur(el);
    expect(onCommit).toHaveBeenCalledWith('press.intro', 'Come There');
  });
});

// ---------------------------------------------------------------------------
// Task 3 review Finding C2: an emptied field becomes untappable. Measured in
// a real Chromium browser: select-all, Delete, tap away -- the now-completely-
// empty <span> measures {w: 0, h: 0} (`getBoundingClientRect()`), so nothing
// can tap it again and it is skipped by `elementFromPoint`; only a reload
// recovers it, and the registry (`useRef`) discards every unpublished edit
// in the session when that happens. jsdom computes no real layout at all
// (every element's `getBoundingClientRect()` is always zero, by construction,
// regardless of CSS), so the real fix -- `min-h-[1em] min-w-[1ch]` on an
// `inline-block` -- can only be checked at the source level, the same
// established pattern this file's own "tap, not hover" describe block above
// already uses for an identical jsdom limitation. The ZWSP placeholder is the
// other half, and IS directly observable: it guarantees the element never
// has zero child nodes, which is checkable without any layout engine at all.
describe('Task 3 review Finding C2: an emptied field stays tappable', () => {
  // Mutation this guards: removing `inline-block`/`min-h-[1em]`/`min-w-[1ch]`
  // from the className -- confirmed red against each token individually.
  it('the className guarantees a minimum box even when the element is empty', () => {
    const source = readFileSync('src/admin/EditableText.tsx', 'utf8');
    const match = source.match(/className="([^"]*)"/);
    expect(match).not.toBeNull();
    const className = match![1];
    expect(className).toMatch(/\binline-block\b/);
    expect(className).toMatch(/\bmin-h-\[1em\]/);
    expect(className).toMatch(/\bmin-w-\[1ch\]/);
  });

  // Uses CommitHarness (see its own comment above) because this checks the
  // FINAL, SETTLED DOM state after blur -- the only state a real browser
  // ever paints -- which needs `value` to genuinely become `''` the same way
  // a real EditMode re-render would, not stay pinned to a static test prop.
  //
  // Mutation this guards: the resync effect's `const desired =
  // displayTextFor(value)` reverted to a bare `value` -- confirmed red:
  // `desired` becomes `''`, already equal to what handleBlur's own write
  // left in the DOM, so the effect's own `!==` guard declines to install the
  // placeholder and the span is left with zero child nodes -- the shape a
  // real browser measures as {w: 0, h: 0}. (handleBlur's OWN
  // `displayTextFor(next)` write matters independently for Finding C1 --
  // see that describe block's mutation on the identical line -- but for
  // C2 specifically, this resync effect is what a real render settles on,
  // since React 18 batches `onCommit`'s own state update into the SAME pass
  // as the `isFocused` flip, and only the settled result is ever painted.)
  it('emptying a field and blurring leaves a non-collapsing placeholder in the DOM, while the committed value is genuinely empty', () => {
    const onCommit = vi.fn();
    render(<CommitHarness path="press.heading" initial="Read More" onCommitSpy={onCommit} />);
    const el = screen.getByText('Read More');
    fireEvent.focus(el);
    el.textContent = '';
    fireEvent.blur(el);

    expect(onCommit).toHaveBeenCalledWith('press.heading', '');
    expect(el.childNodes.length).toBeGreaterThan(0);
    expect(el.textContent!.length).toBeGreaterThan(0);
  });

  // Mutation this guards: the same `desired = displayTextFor(value)` -> bare
  // `value` change as the test above -- confirmed red: on mount, the span
  // starts with no children at all, `desired` becomes `''`, already equal to
  // that empty `.textContent`, so the effect's own `!==` guard never writes
  // anything and the very first frame she'd ever see is a truly empty span.
  it('mounting with an already-empty value renders a non-collapsing placeholder, not a truly empty span', () => {
    render(<EditableText path="press.heading" value="" onCommit={vi.fn()} />);
    const el = screen.getByRole('textbox');
    expect(el.childNodes.length).toBeGreaterThan(0);
  });

  // I4 review finding: the previous version of this test set
  // `el.textContent = 'New Heading'` -- a bare property assignment that
  // REPLACES the whole node list, destroying the ZWSP placeholder node
  // before blur ever runs. With no placeholder left in the DOM to strip,
  // `stripPlaceholder(raw)` had nothing to do and `raw` already equalled
  // 'New Heading' -- confirmed red: mutating `stripPlaceholder(raw)` to
  // the identity `raw` (src/admin/EditableText.tsx:130, called from
  // handleBlur at :130) left this test green, 53/53 across the whole
  // file. Fixed by building the DOM the way a real caret actually leaves
  // it: typing new characters does not erase a sibling text node, it
  // inserts alongside it -- so the placeholder's own ZWSP survives
  // sitting next to what she typed, exactly like the C1 <br>/paste tests
  // above build real sibling DOM state rather than only ever overwriting
  // `textContent` wholesale.
  it('focusing an emptied field again allows typing a fresh value, with no leftover placeholder character committed', () => {
    // The explicit \u200b escape, not a literal zero-width-space character
    // sitting invisibly in this source file -- this file's own NBSP tests
    // above (and EditableText.tsx's own header comment on ZWSP) make the
    // identical choice, for the identical reason: the character this test
    // depends on needs to stay legible in a diff.
    const ZWSP = '\u200b';
    const onCommit = vi.fn();
    render(<EditableText path="press.heading" value="" onCommit={onCommit} />);
    const el = screen.getByRole('textbox');
    fireEvent.focus(el);
    el.textContent = `${ZWSP}New Heading`;
    fireEvent.blur(el);
    expect(onCommit).toHaveBeenCalledWith('press.heading', 'New Heading');
  });
});

// ---------------------------------------------------------------------------
// Task 3 review Finding C5: the pre-edit snapshot is unpinned. Real failure
// named by the review: she edits to "A", blurs, types the original text back
// and blurs -- if `beforeEditRef` were never refreshed on the SECOND focus,
// it would still hold the value this component mounted with, so typing the
// original text back would compare equal to that stale snapshot and never
// commit -- she cannot undo her own edit.
describe('Task 3 review Finding C5: a second edit session starts from what was actually committed', () => {
  // Mutation this guards: deleting `beforeEditRef.current = value;` from
  // handleFocus -- confirmed red (see inline comment below for the exact
  // trace).
  it('editing back to the original value after an intermediate edit still commits, even though it equals the value at mount', () => {
    const onCommit = vi.fn();
    const { rerender } = render(<EditableText path="hero.logoName" value="Original" onCommit={onCommit} />);
    let el = screen.getByText('Original');

    fireEvent.focus(el);
    el.textContent = 'A';
    fireEvent.blur(el);
    expect(onCommit).toHaveBeenNthCalledWith(1, 'hero.logoName', 'A');

    // What a real commit does: the parent re-renders with the newly
    // committed value as this component's next `value` prop (EditMode's own
    // buildBundle re-derives `copy`, and therefore this prop, from the
    // registry once `onCommit` -> registry.updateData bumps its version).
    rerender(<EditableText path="hero.logoName" value="A" onCommit={onCommit} />);
    el = screen.getByText('A');

    // Without handleFocus refreshing beforeEditRef here, it would still read
    // "Original" (its own value at mount, never updated) -- so typing
    // "Original" back would compare equal to that stale snapshot and
    // onCommit would never fire a second time.
    fireEvent.focus(el);
    el.textContent = 'Original';
    fireEvent.blur(el);
    expect(onCommit).toHaveBeenNthCalledWith(2, 'hero.logoName', 'Original');
  });
});

// ---------------------------------------------------------------------------
// Minor review finding: the U+00A0-PRESERVING half (copy.footer.followLabel
// specifically) already had a dedicated test above; the U+00A0-INTRODUCING
// half -- a real browser silently turning an ordinary trailing space into
// `&nbsp;` inside contentEditable, on ANY field, not just followLabel -- did
// not. This cannot be reproduced through simulated typing (jsdom implements
// no such browser editing quirk -- see this file's own header comment), so
// it is injected as real DOM state instead, proving this component commits
// whatever real character is there verbatim regardless of which field it is
// -- the browser's own quirk is not this component's bug to fix, but it must
// not make the situation worse by stripping or altering the character
// either.
describe('a non-breaking space a real browser introduced (not just one already present in the value) survives verbatim, on an ordinary field', () => {
  it('a trailing U+00A0 present in the DOM, on a field that never had one in its own value, is committed exactly as-is', () => {
    const NBSP = '\u00a0';
    const onCommit = vi.fn();
    render(<EditableText path="hero.reserveButton" value="Reserve Now" onCommit={onCommit} />);
    const el = screen.getByText('Reserve Now');
    fireEvent.focus(el);
    el.textContent = `Reserve Now${NBSP}`;
    fireEvent.blur(el);

    expect(onCommit).toHaveBeenCalledWith('hero.reserveButton', `Reserve Now${NBSP}`);
    const committed = onCommit.mock.calls[0][1] as string;
    expect(committed.charCodeAt(committed.length - 1)).toBe(0x00a0);
  });
});

// ---------------------------------------------------------------------------
// Minor review finding: EditableText.tsx's own initial-DOM-write effect
// (the one that populates a freshly-mounted span with `displayTextFor(value)`
// -- this component renders no React children of its own, see that file's
// header comment) uses `useLayoutEffect`, not `useEffect`, specifically so
// the very first frame she ever sees already has real text in it rather than
// a blank span that fills in a moment later. The previous review pass
// claimed this was "impossible to pin in jsdom" -- wrong: jsdom fully
// implements React's own effect-ordering contract (layout effects, child
// before parent, ALL run before ANY passive effect anywhere in the tree),
// so a PARENT's own `useLayoutEffect` reading the child's DOM is exactly as
// reliable a probe in jsdom as in a real browser, with no layout/paint
// engine required at all -- unlike the genuinely real-layout-dependent
// checks elsewhere in this file (Finding C2's box-size reasoning), which
// really can only be checked at the source level.
describe('the initial DOM write happens in the layout-effect phase, not a later passive effect', () => {
  function ParentProbe({ value, onProbe }: { value: string; onProbe: (textContent: string | null) => void }) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    // Runs AFTER every descendant's own layout effect (React's own
    // documented child-before-parent order within the layout phase) but
    // BEFORE any passive effect anywhere in the tree, and before the
    // browser (or jsdom) ever paints. If EditableText's own resync ran as
    // a passive `useEffect` instead, it would not have run yet by the time
    // THIS effect fires -- the span would still be empty.
    useLayoutEffect(() => {
      const span = wrapperRef.current?.querySelector('[role="textbox"]');
      onProbe(span ? span.textContent : null);
    });
    return (
      <div ref={wrapperRef}>
        <EditableText path="hero.logoName" value={value} onCommit={vi.fn()} />
      </div>
    );
  }

  // Mutation this guards: changing `useLayoutEffect` to `useEffect` on
  // EditableText.tsx's own resync effect -- confirmed red: the probe above
  // then observes `''` (the span's true initial, childless state) instead
  // of 'Via Bianca', since the child's passive effect has not run yet at
  // the moment the parent's own layout effect fires.
  it("a parent's own useLayoutEffect already sees the real text, not an empty span", () => {
    const probe = vi.fn();
    render(<ParentProbe value="Via Bianca" onProbe={probe} />);
    expect(probe).toHaveBeenCalledWith('Via Bianca');
  });
});
