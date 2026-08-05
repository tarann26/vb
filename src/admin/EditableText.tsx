import { useLayoutEffect, useRef, useState } from 'react';

export interface EditableTextProps {
  path: string;
  value: string;
  onCommit: (path: string, next: string) => void;
  // Set while a publish request is actually in flight (PublishBar's own
  // `onPublishLockChange`). Renders the same element with the same
  // className, only not editable -- deliberately NOT a fallback to the bare
  // string, which would drop this span's own box and shift the layout of a
  // 4800px page twice per publish, once when the pause starts and once when
  // it ends.
  locked?: boolean;
}

// A zero-width space, not an empty string, is what an otherwise-empty field
// actually holds in the DOM -- Task 3 review Finding C2. A `<span>` with
// literally zero child nodes collapses to a real, measured 0x0 box in a
// browser (confirmed against a real Chromium build: `getBoundingClientRect()`
// -> `{w: 0, h: 0}` the instant she selects-all-and-deletes a heading), which
// makes it un-hittable by a tap AND skipped by `elementFromPoint` -- only a
// page reload recovers it, and Task 4/5's own registry lives in a `useRef`,
// so that reload would discard every unpublished edit in the session. A
// single U+200B text node gives the element a real inline box (the font's
// own line-height) with none of that: it is invisible, has no width of its
// own, and both `displayTextFor`/handleBlur below are the two places that
// ever have to know it exists -- everywhere else in this component (and
// every real caller) only ever sees the genuine, ZWSP-free string.
const ZWSP = '\u200b';

function displayTextFor(value: string): string {
  return value === '' ? ZWSP : value;
}

// Strips any ZWSP the placeholder above may have left behind before a value
// is compared or committed -- a caret that lands before/after/inside the
// placeholder and then has real text typed around it is a real, reachable
// DOM shape (not just the single-character "still literally the placeholder"
// case handleBlur used to special-case alone), so every occurrence is
// removed, not just an exact match against the whole string.
function stripPlaceholder(text: string): string {
  return text.split(ZWSP).join('');
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
//
// Single-line only -- no `aria-multiline`. An earlier version of this
// component set `aria-multiline="true"` and left Enter's default browser
// behaviour alone. Measured directly (Task 3 review Finding C1): pressing
// Enter inside a real Chromium contentEditable span inserts a `<br>`, which
// contributes nothing to `.textContent` -- so the DOM shows two visual
// lines while the value this component reads back and commits (handleBlur
// below) silently runs them together with no space at all, and because that
// concatenated string equals `.textContent` on BOTH sides, the resync
// effect's old `!==` guard could never tell the DOM needed correcting: /edit
// would show a permanent two-line paragraph that publishes as one run-on
// sentence. None of the 28 real editable leaves stores an intentional `\n`
// today (confirmed against every real copy.json value), and validate.ts has
// no multi-line-aware rule for any of them, so blocking Enter outright loses
// no real capability -- it only closes the one keyboard path that could ever
// put DOM structure `.textContent` can't see back into this element.
const EditableText: React.FC<EditableTextProps> = ({ path, value, onCommit, locked = false }) => {
  const ref = useRef<HTMLSpanElement>(null);
  // The value at the moment this edit session started -- what Escape
  // restores, and what a blur compares against to decide whether anything
  // actually changed. A ref, not state: it must never itself trigger a
  // render, and handleKeyDown/handleBlur both need its current value
  // synchronously, in the same tick a real key or blur event fires in.
  // Re-captured on EVERY focus (handleFocus below), not just at mount --
  // Task 3 review Finding C5: a session that edits "Original" to "A", blurs
  // (committing "A"), then re-focuses and types "Original" back needs THIS
  // session's own before-value ("A", what's actually on screen and
  // committed right now), never the value this component happened to mount
  // with. Pinned at mount only as this ref's own initial value, for the
  // very first focus before any commit has ever happened.
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
    const desired = displayTextFor(value);
    if (ref.current && ref.current.textContent !== desired) {
      ref.current.textContent = desired;
    }
  }, [value, isFocused]);

  function handleFocus() {
    beforeEditRef.current = value;
    setIsFocused(true);
  }

  function handleBlur() {
    setIsFocused(false);
    // Compared and committed VERBATIM -- no `.trim()`, no whitespace-
    // collapsing regex, other than stripping the ZWSP placeholder above
    // (never a real character she typed; nothing this component ever shows
    // her as content). Both `next` and `beforeEditRef.current` still treat
    // U+00A0 (a non-breaking space) as an ordinary character:
    // copy.footer.followLabel needs that exact character to survive a
    // publish (validate.ts refuses an ordinary space there), and reading the
    // DOM's real text back untouched -- once the placeholder is stripped --
    // is what keeps that field round-trip-safe.
    const raw = ref.current?.textContent ?? '';
    const next = stripPlaceholder(raw);
    // Unconditional resync -- Task 3 review Finding C1's other half.
    // `.textContent` is what this component both READS to commit and
    // COMPARES to decide whether the DOM needs rewriting, and that is
    // exactly the blind spot: a `<br>` (Enter's own default action, now
    // blocked below, but also reachable via a pasted line break) or a
    // pasted `<b>`/`<i>` wrapper contributes nothing to `.textContent`, so a
    // DOM already carrying that structure can read as "already equal to
    // `next`" even though what's ON SCREEN is not what was committed.
    // Always rewriting the DOM to the exact plain string just committed --
    // regardless of whether it already looked equal -- is what makes /edit's
    // display and the committed value the same fact, not two facts that
    // happen to read the same via `.textContent`.
    if (ref.current) ref.current.textContent = displayTextFor(next);
    if (next !== beforeEditRef.current) {
      onCommit(path, next);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLSpanElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (ref.current) ref.current.textContent = displayTextFor(beforeEditRef.current);
      // Ends the session without marking anything dirty: the DOM now reads
      // exactly what it did before she started, so the blur() call below
      // triggers handleBlur, whose own `next !== beforeEditRef.current` check
      // is false and onCommit is never invoked.
      ref.current?.blur();
      return;
    }
    // None of the 28 real editable leaves stores an intentional line break
    // (see this component's own header comment) -- blocking Enter's default
    // action is what stops it from ever inserting a `<br>`/new block that
    // `.textContent` can't see, the DOM-structure half of Finding C1. Every
    // OTHER key is left alone: this is not a general "block special keys"
    // rule, just the one default browser action that can put invisible
    // structure into a plain-text field.
    if (event.key === 'Enter') {
      event.preventDefault();
    }
  }

  // Plain text, verbatim -- Task 3 review Finding C1. The browser's own
  // default paste action can insert a clipboard's real HTML (a bold, slanted
  // run, a foreign font, a `<br>` from a multi-line source) directly into
  // this contentEditable span; `.textContent` would still read the plain
  // characters back correctly, but the DOM she is LOOKING at would show the
  // pasted formatting until the unconditional blur-resync above finally
  // corrects it -- and until then, what's on screen is not what would
  // publish. Reading only `text/plain` off the clipboard and inserting it
  // through the Selection/Range API below means no rich markup ever reaches
  // the DOM in the first place, on any browser, regardless of blur.
  function handlePaste(event: React.ClipboardEvent<HTMLSpanElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return (
    <span
      ref={ref}
      // The handlers come off with the editability, rather than staying
      // wired to an element that can no longer be focused: a stale commit
      // firing out of a paused editor is exactly the kind of write the
      // pause exists to prevent. The className is byte-identical in both
      // states so the element's box never changes.
      contentEditable={!locked}
      suppressContentEditableWarning
      role="textbox"
      data-editable-path={path}
      onFocus={locked ? undefined : handleFocus}
      onBlur={locked ? undefined : handleBlur}
      onKeyDown={locked ? undefined : handleKeyDown}
      onPaste={locked ? undefined : handlePaste}
      // Persistently visible -- never hover-gated. The spec's own Risks
      // section rules this a mandate ("on phones she gets tap-to-select...
      // instead"): a hover-revealed affordance is invisible on a touchscreen,
      // which has no hover state at all. Every class below is present
      // unconditionally, at every viewport -- none carries a `hover:`
      // prefix; `focus:` is a stronger visual cue layered on top for the
      // moment she is actually editing, reachable by both a mouse click and
      // a tap. `inline-block` plus the two `min-` sizing utilities are Task 3
      // review Finding C2's fix: a totally empty inline element has no box
      // of its own to tap (a real Chromium measurement showed a bare,
      // emptied span at exactly zero width and zero height) -- `min-`
      // sizing only ever takes effect on a non-inline display, and a
      // guaranteed minimum keeps this element hittable even in the instant
      // between her deleting the old text and the ZWSP placeholder above
      // taking over. (Deliberately not describing the individual Tailwind
      // utility names below in this prose comment: several are ordinary
      // English words too, and this project's Tailwind content scan has no
      // JS parser behind it -- tailwind.config.js's own `blocklist` comment
      // documents the identical hazard. Confirmed directly while writing
      // this file, via the rule-level build diff this project's own
      // standing instruction requires: an early draft of this very comment
      // emitted an unused rule this way.)
      className="inline-block min-h-[1em] min-w-[1ch] cursor-text rounded-sm outline-dashed outline-1 outline-offset-2 outline-[#6B8B59]/50 focus:bg-[#6B8B59]/10 focus:outline-2 focus:outline-[#6B8B59]"
    />
  );
};

export default EditableText;
