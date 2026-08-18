// Moved out of BlockList.tsx unchanged when the dashboard's own lists grew
// the same handle. Shared rather than retyped for the reason RecordList's
// MOVE_BUTTON_CLASSNAME export already records: a single-character-off
// utility string is a NEW class to Tailwind's scanner, and the stylesheet
// has no room for one.
//
// A drag handle's whole discoverability is its cursor: the handle is one glyph
// wide and there is no other affordance on it, so the pointer changing shape
// over it is the only thing that says it can be dragged at all.
//
// THE CURSOR IS AN INLINE STYLE, NOT A UTILITY CLASS, and that is a byte
// decision rather than a style preference. No UNPREFIXED move-cursor rule is in
// this stylesheet, and no unprefixed half-strength opacity rule either -- the
// unprefixed opacity utilities that ship are 0, 20, 90 and 100. Read that word
// literally: the sheet does carry a `:disabled`-gated half-strength rule and a
// `:disabled` cursor rule, and neither can dim or re-point anything here,
// because this row is not a disabled form control. Both were measured by a
// rule-level diff against a worktree build of the parent commit: the class
// version of this handle and its dimmed row costs +48 bytes and two new rules
// against 107 bytes of headroom, leaving 59 for whoever comes next. So both
// take the escape hatch this repository has documented for this exact ceiling
// since Plan 6 (CollageTile.tsx's inline gradient, since deleted;
// CollapsibleSection.tsx's fieldset reset, which also ships an inline
// conditional opacity of its own; the publish panel's 72px offset): the pixels
// are identical and the stylesheet does not move a byte. `style-src` allows
// inline styles on purpose and src/test/hosting.test.ts says why.
//
// The user-select utility below is a real class because it ALREADY has a rule,
// so it costs nothing -- and it is not optional: without it a slow drag selects
// the kind label's text instead of starting a drag, which reads as the handle
// not working.
//
// `aria-hidden` and no role: this is a mouse affordance, and a screen-reader
// user reorders with the Up/Down buttons, which are real buttons with real
// names and are not going anywhere. A `role="button"` here would announce a
// third control that does nothing without a pointer.
//
// IT IS ALSO ON HER PHONE, WHERE A DRAG CANNOT WORK AT ALL, and that is a
// decision rather than an oversight. Measured at 390px: 34.94 by 32, a small
// grey dot grid to the left of the kind label. Taking it off small screens
// means a breakpoint-prefixed display utility, which is a new rule against the
// same 107 bytes this whole comment is about, spent to remove something that
// costs her one glance. She reorders by Up and Down there, which is why those
// buttons were never allowed to become optional.
export const HANDLE_CLASSNAME = 'select-none px-3 py-1 text-gray-500';

// Read off the handle itself by e2e/block-editor.spec.ts, which is the only
// place a computed cursor can be checked at all -- jsdom has no layout engine
// and no cascade worth asking.
export const HANDLE_STYLE = { cursor: 'move' };

// The block in flight, dimmed. Once the pointer has left the row this is the
// only thing telling her which block she has hold of. Inline for the same
// reason the cursor is, and 0.5 rather than one of the four unprefixed opacity
// utilities that do ship: 0.9 is no change she would notice and 0.2 is a block
// she can no longer read. Both halves are proven in the browser -- the row
// dims, and it stops being dimmed once the drop lands, which is the half a
// version that dimmed and never cleared would have passed.
export const DRAGGING_STYLE = { opacity: 0.5 };
