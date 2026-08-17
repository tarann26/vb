// A textarea for a field holding markdown she types by hand, with its label
// and its own error region. Task 7 adds the bold/emphasis/link toolbar inside
// this component, which is the whole reason it exists rather than routing
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
import { INPUT_CLASSNAME, LABEL_CLASSNAME } from '../Field';
import type { ValidationProblem } from '../../content/validate';

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

  return (
    <div className="mb-4">
      <label htmlFor={id} className={LABEL_CLASSNAME}>
        {label}
      </label>
      <textarea
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
      {errorId && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">
          {problems.map((problem) => problem.message).join(' ')}
        </p>
      )}
    </div>
  );
}
