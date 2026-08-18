// The control row above the writing column: twelve buttons and one label.
//
// `role="group"` and NOT `role="toolbar"`, for the reason
// InlineTextField.tsx:223-231 states at length. A toolbar in ARIA carries a
// keyboard contract -- one tab stop, arrow keys between the controls, focus
// managed by the widget -- and these are thirteen plain controls with thirteen
// tab stops. Claiming the role would promise a screen-reader user a way of
// moving that does not exist. `group` has no such contract: it gives the row a
// boundary and a name, which is the thing that was actually missing. Both are
// attributes rather than classes and cost no rule.
//
// EVERY CONTROL REUSES MOVE_BUTTON_CLASSNAME, imported and never retyped. A
// retyped Tailwind string is a brand-new class to the content scanner even
// when it renders the identical rule, and this stylesheet has no headroom to
// spend on a duplicate.
//
// Image is a LABEL and not a button. A browser opens the file picker only
// under a live user activation, and a button that programmatically clicks an
// input on a later render has already lost it -- Task 23 Step 1 owns the input
// itself and states the whole of that reasoning.
import { MOVE_BUTTON_CLASSNAME } from '../RecordList';
import type { Mark } from './marks';

// The four kinds a button on this row can turn the block she is standing in
// into. Pressing the one it already is turns it back into a paragraph, which
// is what every editor with these buttons does.
export type ToolbarKind = 'heading' | 'bulletList' | 'numberList' | 'quote';

export interface WritingToolbarProps {
  onMark: (mark: Mark) => void;
  onLink: () => void;
  onKind: (kind: ToolbarKind) => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  // The id of the file input Task 23 owns. This row does not render it: the
  // input belongs to the surface, which is where the picked file has to arrive.
  imageInputId: string;
}

// PRESSING A CONTROL MUST NOT TAKE THE CARET OUT OF HER WORDS. Suppressing the
// default on mousedown is what keeps the selection alive: without it the
// browser moves focus to the button before the click ever fires, the editable
// host blurs, and the selection every one of these actions operates on is gone
// by the time the handler runs. It is on the buttons only and deliberately NOT
// on the label -- the file picker needs the activation the label's own click
// carries. That a real browser keeps the selection is deferred to
// e2e/writing-surface.spec.ts.
function Tool({ onPress, children }: { onPress: () => void; children: string }) {
  return (
    <button
      type="button"
      className={MOVE_BUTTON_CLASSNAME}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

export default function WritingToolbar({
  onMark, onLink, onKind, onClear, onUndo, onRedo, imageInputId,
}: WritingToolbarProps) {
  return (
    // The same three class strings InlineTextField.tsx's own row carries,
    // character for character, so this row costs the stylesheet nothing.
    <div role="group" aria-label="Formatting" className="mb-1 flex flex-wrap items-center gap-2">
      <Tool onPress={() => onMark('strong')}>Bold</Tool>
      {/* `Italic` KEEPS ITS CAPITAL I. The small-letter spelling is a real
          Tailwind candidate this stylesheet does not ship, the scanner matches
          candidates case-sensitively, and InlineTextField.tsx records that the
          first draft of a comment warning about it shipped the very rule it
          was warning about. This comment did it too, on its first draft: it
          spelled out the text-transform that turns capitals into small
          letters, and shipped that rule at a cost of 36 bytes. The ceiling
          caught that it happened -- the sheet stood at 38836 against a
          ceiling of 38836, so `npm run build` refused -- and a rule-level
          diff of the built stylesheet against the pre-task one is what said
          WHICH rule and therefore which word.

          DO NOT READ THAT AS A GUARANTEE ANY MORE. Task 27 raised the ceiling
          to 39000, so the same 36-byte leak would now pass the byte assertion
          in silence; the rule-level diff is the check that would still catch
          it, and it is the one to run. Do not respell this label, and do not
          write either of those two words out in this file. */}
      <Tool onPress={() => onMark('em')}>Italic</Tool>
      <Tool onPress={() => onMark('underline')}>Underline</Tool>
      <Tool onPress={() => onMark('strike')}>Strikethrough</Tool>
      <Tool onPress={onLink}>Link</Tool>
      <Tool onPress={() => onKind('heading')}>Heading</Tool>
      <Tool onPress={() => onKind('bulletList')}>Bulleted list</Tool>
      <Tool onPress={() => onKind('numberList')}>Numbered list</Tool>
      <Tool onPress={() => onKind('quote')}>Quote</Tool>
      <Tool onPress={onUndo}>Undo</Tool>
      <Tool onPress={onRedo}>Redo</Tool>
      <Tool onPress={onClear}>Clear formatting</Tool>
      {/* `cursor-pointer` so the one control that is not a button still reads
          as one. Already in the stylesheet (EditableImage.tsx writes it), so
          it costs nothing marginal. */}
      <label htmlFor={imageInputId} className={`${MOVE_BUTTON_CLASSNAME} cursor-pointer`}>
        Image
      </label>
    </div>
  );
}
