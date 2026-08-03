import { useLayoutEffect, useRef, useState } from 'react';

export interface EditableTextProps {
  path: string;
  value: string;
  onCommit: (path: string, next: string) => void;
}

// contentEditable, not an <input> swap -- Plan 5 Task 3, Step 3. Every
// editable leaf is styled entirely by its parent element (Hero.tsx's
// `font-['Parisienne'] text-6xl`, NavBar.tsx's `uppercase tracking-wide`,
// ...), and an <input> carries its own default typography (font, size,
// line-height, border) that would visibly change the page's appearance the
// instant she starts editing -- precisely what D3 exists to prevent. A
// plain inline <span> with no typographic classes of its own inherits every
// one of those properties from whatever heading or paragraph it sits
// inside, so the page looks identical whether she is editing or not.
//
// Uncontrolled, buffered on focus, committed on blur, matching TagsInput's
// own (Field.tsx) contract -- Plan 4's publish already force-blurs
// `document.activeElement` before reading the payload (PublishBar.tsx), and
// that is a real DOM blur, indistinguishable from her tapping away, so this
// component needs no special-casing to stay compatible with it.
//
// Renders NO React children -- `value` is written into the DOM
// imperatively (below), never passed as a JSX child of an element that also
// carries `contentEditable`. That split is deliberate: once a contentEditable
// element has real user edits inside it, its DOM subtree is the browser's
// to own, not React's -- letting React re-render a text child into it on
// every parent render is the exact hazard that fights the browser over the
// caret position and (mid-edit) loses keystrokes. `suppressContentEditableWarning`
// only silences React's own warning about that combination; the actual fix
// is not having a React-managed child there at all.
const EditableText: React.FC<EditableTextProps> = ({ path, value, onCommit }) => {
  const ref = useRef<HTMLSpanElement>(null);
  // The value at the moment this edit session started -- what Escape
  // restores, and what a blur compares against to decide whether anything
  // actually changed. A ref, not state: it must never itself trigger a
  // render, and handleKeyDown/handleBlur both need its current value
  // synchronously, in the same tick a real key or blur event fires in.
  const beforeEditRef = useRef(value);
  const [isFocused, setIsFocused] = useState(false);

  // Keeps the DOM in sync with `value` whenever it changes from OUTSIDE this
  // element's own edit -- a fresh load, a 401/re-login refill of a file that
  // had not loaded yet, a future multi-tab sync -- but never while she is
  // actively focused here: overwriting the DOM mid-edit would reset her
  // caret to the start and, worse, throw away whatever she has typed that
  // has not yet been committed. useLayoutEffect (not useEffect) so the
  // initial text is written before the browser ever paints an empty span --
  // this component renders no JSX children, so without this the very first
  // frame would show nothing at all.
  useLayoutEffect(() => {
    if (isFocused) return;
    if (ref.current && ref.current.textContent !== value) {
      ref.current.textContent = value;
    }
  }, [value, isFocused]);

  function handleFocus() {
    beforeEditRef.current = value;
    setIsFocused(true);
  }

  function handleBlur() {
    setIsFocused(false);
    const next = ref.current?.textContent ?? '';
    // Compared and committed VERBATIM -- no `.trim()`, no whitespace-
    // collapsing regex. Both treat U+00A0 (a non-breaking space) as
    // whitespace: `String.prototype.trim()` strips it at either end, and
    // `\s` in a JS regex matches it outright. copy.footer.followLabel needs
    // that exact character to survive a publish (validate.ts refuses an
    // ordinary space there) -- reading the DOM's real text back untouched is
    // what keeps this field round-trip-safe.
    if (next !== beforeEditRef.current) {
      onCommit(path, next);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLSpanElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (ref.current) ref.current.textContent = beforeEditRef.current;
    // Ends the session without marking anything dirty: the DOM now reads
    // exactly what it did before she started, so the blur() call below
    // triggers handleBlur, whose own `next !== beforeEditRef.current` check
    // is false and onCommit is never invoked.
    ref.current?.blur();
  }

  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-editable-path={path}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      // Persistently visible -- never hover-gated. The spec's own Risks
      // section rules this a mandate ("on phones she gets tap-to-select...
      // instead"): a hover-revealed affordance is invisible on a touchscreen,
      // which has no hover state at all. Every class below is present
      // unconditionally, at every viewport -- none carries a `hover:`
      // prefix; `focus:` is a stronger visual cue layered on top for the
      // moment she is actually editing, reachable by both a mouse click and
      // a tap. (Deliberately not describing the individual Tailwind utility
      // names below in this prose comment: several are ordinary English
      // words too, and this project's Tailwind content scan has no JS
      // parser behind it -- tailwind.config.js's own `blocklist` comment
      // documents the identical hazard. Confirmed directly while writing
      // this file, via the rule-level build diff this project's own
      // standing instruction requires: an early draft of this very comment
      // emitted an unused rule this way.)
      className="cursor-text rounded-sm outline-dashed outline-1 outline-offset-2 outline-[#6B8B59]/50 focus:bg-[#6B8B59]/10 focus:outline-2 focus:outline-[#6B8B59]"
    />
  );
};

export default EditableText;
