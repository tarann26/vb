// A textarea for a field holding markdown she types by hand, with its label
// and its own error region. The bold/emphasis/link toolbar lives inside this
// component, which is the whole reason it exists rather than routing
// these fields through Field.tsx like every other kind: Field renders eight
// kinds and has no slot for a toolbar, and giving it one would change a
// component that eleven other fields already depend on.
//
// The class strings come from Field.tsx's own exported bindings rather than
// being retyped. A retyped Tailwind string is a brand-new class to the
// content scanner and ships a duplicate rule for a style that already
// exists -- which is exactly why those two are exported (Field.tsx's own
// comment), and the stylesheet has 107 bytes of headroom.
//
// The label/help/error SHELL is Field.tsx's, copied structurally rather than
// approximately: same order (label, control, help, error), same two class
// strings for the help and error paragraphs, same `role="alert"`, same
// one-paragraph-with-joined-messages error. The brief for this task proposed
// a different shell (help above the control, its own font and colour
// classes); two error presentations on one screen is the "two names for one
// thing" defect this project has already fixed twice, so the sibling wins.
// THE TOOLBAR (Task 7) is three buttons over a plain `<textarea>`, driven by
// setSelectionRange. NOT contenteditable and NOT a rich-text library, and the
// reason is the same one that makes src/content/markdown.ts hand-written: a
// contenteditable's value IS markup, and this codebase's whole safety argument
// is that no markup string exists anywhere -- src/test/html-sinks.test.ts
// fails the build if any shipped module so much as names a parsing sink.
//
// What she sees in this box is the source, asterisks and all. That is a
// deliberate trade: a live rendered preview would re-parse on every keystroke,
// which is the path the parser hang made dangerous (Task 1) and which would
// need its own debounce, its own error boundary and its own answer to "which
// one is the real text". Three buttons that insert the two characters she
// would otherwise have to know about is the smaller, honest version.
import { useEffect, useRef, useState } from 'react';
import { INPUT_CLASSNAME, LABEL_CLASSNAME } from '../Field';
import { MOVE_BUTTON_CLASSNAME } from '../RecordList';
import { isSafeHref } from '../../content/markdown';
import type { ValidationProblem } from '../../content/validate';

// The one sentence that tells her what a link target may look like, written
// once because the prompt asks for it and the refusal repeats it, and those
// two drifting apart is how a control comes to ask for one thing and complain
// about another.
const TARGET_SHAPES = 'a full web address starting with https://, or a page on this site starting with /';

// Refused targets, in her words. The empty case gets its own opening clause
// because `"" will not work as a link` is a sentence about nothing: pressing OK
// on an empty box is a real thing she did and deserves to be described.
function linkRefusal(target: string): string {
  const opening = target === '' ? 'Nothing was pasted in, so this' : `"${target}"`;
  return `${opening} will not work as a link. Use ${TARGET_SHAPES}`;
}

export interface InlineTextFieldProps {
  id: string;
  label: string;
  help?: string;
  value: string;
  onChange: (next: string) => void;
  // Already narrowed to this field's own problems by the caller, the same
  // contract Field.tsx documents for its own `problems` prop. BlockList is
  // what does the narrowing, through blockProblemOf.
  problems: ValidationProblem[];
}

export default function InlineTextField({ id, label, help, value, onChange, problems }: InlineTextFieldProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = problems.length > 0 ? `${id}-error` : undefined;
  // Both, space-separated, and in this order -- the same shape Field.tsx
  // builds, so a screen reader reads the guidance before the complaint.
  //
  // `|| undefined` on the join, and it is load-bearing rather than tidy: an
  // aria-describedby pointing at an element that does not exist is read as
  // nothing by some screen readers and as a broken reference by others, and
  // "no help, no problems" is the state this component is in for most of its
  // life.
  const describedBy = [helpId, errorId].filter((part): part is string => Boolean(part)).join(' ') || undefined;

  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Where the selection should be after the parent re-renders with the new
  // value. It cannot be set synchronously: this is a controlled textarea, so
  // onChange goes up, the parent re-renders, React writes `value` back down,
  // and any selection set before that is discarded. A ref plus the effect
  // below is what survives the round trip -- and it matters, because without
  // it a bold-then-italic pair applies the second marker to the wrong
  // characters.
  const pendingSelection = useRef<[number, number] | null>(null);
  // A target she pasted that will not work as a link. Held here rather than
  // pushed through `problems`, because it is not a validation result: it
  // describes something that did NOT happen to the text.
  const [linkError, setLinkError] = useState<string | null>(null);

  // No dependency array on purpose: this has to run after whichever render
  // carries the new value, and the ref guard makes it a no-op on every other
  // one. A dependency on `value` would also fire when the parent changes the
  // text for some unrelated reason and would steal focus.
  useEffect(() => {
    const area = areaRef.current;
    const pending = pendingSelection.current;
    if (area === null || pending === null) return;
    pendingSelection.current = null;
    area.focus();
    area.setSelectionRange(pending[0], pending[1]);
  });

  function surround(marker: string): void {
    const area = areaRef.current;
    if (area === null) return;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    // With nothing selected this inserts the markers around an empty middle
    // and leaves the caret between them, so she can turn bold on and type. A
    // button that did nothing without a selection reads as broken.
    pendingSelection.current = [start + marker.length, end + marker.length];
    onChange(`${value.slice(0, start)}${marker}${value.slice(start, end)}${marker}${value.slice(end)}`);
  }

  function insertLink(): void {
    const area = areaRef.current;
    if (area === null) return;
    // window.prompt, and it is the right control here rather than a lazy one.
    // It is blocking, universally understood, cancellable with Escape, and
    // costs zero CSS against 107 bytes of headroom. An inline panel would be a
    // second focus trap, a second Escape handler and new rules for a control
    // used a handful of times per post.
    const answer = window.prompt(`Where should this link go? Paste ${TARGET_SHAPES}`);
    // null is Cancel. An EMPTY string is not: she pressed OK with nothing in
    // the box, which isSafeHref refuses below and which deserves the same
    // sentence as any other unusable target.
    if (answer === null) return;
    const target = answer.trim();
    if (!isSafeHref(target)) {
      // The same judgement isSafeHref makes for the parser and (through
      // rawLinkTargets) for the write boundary, asked here first so she is told
      // at the moment she pastes rather than at publish. It normalises through
      // the URL parser rather than matching patterns, because a leading slash
      // followed by a backslash lands on somebody else's host and so does a
      // slash followed by a tab and two more slashes.
      //
      // Both boundaries stay and neither replaces the other: validatePosts
      // refuses at publish, minutes later and one screen away, naming a field;
      // this refuses at the keystroke, next to the box, while she still has
      // what she pasted on her clipboard.
      setLinkError(linkRefusal(target));
      return;
    }
    setLinkError(null);
    const start = area.selectionStart;
    const end = area.selectionEnd;
    // Placeholder words when nothing is selected, and the caret lands ON them
    // so her next keystroke replaces them. `[](url)` with an empty label
    // renders as a link with nothing to click.
    const label = value.slice(start, end) || 'this';
    pendingSelection.current = [start + 1, start + 1 + label.length];
    onChange(`${value.slice(0, start)}[${label}](${target})${value.slice(end)}`);
  }

  return (
    <div className="mb-4">
      <label htmlFor={id} className={LABEL_CLASSNAME}>
        {label}
      </label>
      {/* Every class here already ships (measured against the built
          stylesheet, rule by rule), which is the only reason a new element
          costs nothing against 107 bytes of headroom.

          Above the box rather than below it, because the order she reads is
          the order she acts in: select the words, then reach for the button.
          The label still points at the textarea, so nothing about the
          label/control association moves. */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => surround('**')} className={MOVE_BUTTON_CLASSNAME}>
          Bold
        </button>
        {/* `Italic` is a button LABEL in JSX text, not a class name -- and
            Tailwind's slant utility, spelled with a small i, is a real
            candidate this stylesheet does not ship (+26 bytes if it ever did).
            The capital is what keeps it out: Tailwind matches candidates
            case-sensitively, measured with a rule-level diff of the built CSS
            rather than assumed. Do not respell this label with a small i, and
            do not write the small-i spelling in a comment either -- the
            scanner reads comments too, and the first draft of this very
            comment shipped the rule it was warning about. */}
        <button type="button" onClick={() => surround('*')} className={MOVE_BUTTON_CLASSNAME}>
          Italic
        </button>
        <button type="button" onClick={insertLink} className={MOVE_BUTTON_CLASSNAME}>
          Link
        </button>
      </div>
      <textarea
        ref={areaRef}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy}
        className={INPUT_CLASSNAME}
      />
      {helpId && (
        <p id={helpId} className="mt-1 text-xs text-gray-500">
          {help}
        </p>
      )}
      {/* Above the validation region so a screen reader hears the thing that
          just happened before the standing complaint.

          No `id`, and deliberately NOT in `aria-describedby`: it is announced
          by `role="alert"` at the moment it appears, which is when she needs
          it, and giving it the validation region's id would collide two
          describedby targets. A later reader should not "fix" that by wiring
          it in.

          The class string is the validation paragraph's, character for
          character. Two error presentations in one field is the "two names for
          one thing" defect this project has already fixed twice, and a retyped
          Tailwind string is also a brand-new class to the content scanner.

          It does carry `role="alert"`, so PostList's FIRST_PROBLEM_SELECTOR
          can match it -- the same bounded imprecision PostList.test.tsx
          already documents for an unrecognised block's standing sentence. It
          only exists after she has just clicked Link, it is also something she
          has to fix, and it sits AFTER the textarea, so a field carrying a
          real validation problem still sends her to the box. */}
      {linkError !== null && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {linkError}
        </p>
      )}
      {errorId && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">
          {problems.map((problem) => problem.message).join(' ')}
        </p>
      )}
    </div>
  );
}
