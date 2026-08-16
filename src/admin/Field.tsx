import React, { useEffect, useState } from 'react';
import PhotoField, { type StagedPhoto } from './PhotoField';
import type { ImagePreviews } from './previews';
import type { FieldSpec } from './fields';
import type { ValidationProblem } from '../content/validate';

export interface FieldProps<V> {
  id: string;
  spec: FieldSpec<V>;
  value: V;
  onChange: (next: V) => void;
  // Already narrowed to the problems that belong to THIS field --
  // src/admin/problems.ts's problemsFor is what a caller (RecordForm) uses
  // to do that narrowing. Field has no idea what `field` string shape
  // validateContent emits, and doesn't need to.
  problems: ValidationProblem[];
  // Only ever read for `spec.kind === 'image'` -- forwarded straight to
  // PhotoField's own `onStaged` prop (see the early return below). Present
  // on every FieldProps, not just the image branch's, because RecordForm
  // (this component's one real caller) has no way to know at the call site
  // whether `spec` is the image kind for a generic `K` -- it passes this
  // through unconditionally, and every other kind below simply never reads
  // it. Absence here (`undefined`) reaches PhotoField as "no collector",
  // which -- per this task's own brief -- must never happen for a REAL
  // image field; RecordForm.tsx's own comment is where that guarantee
  // actually lives.
  onStaged?: (staged: StagedPhoto | null) => void;
  // Forwarded straight to PhotoField, untouched -- see that component's own
  // comment for why the key is composed on the way down rather than derived.
  previews?: ImagePreviews;
  previewKey?: string;
}

// Exported, not module-private: a sibling component that renders its own
// input/label shell rather than going through Field's generic dispatch (see
// the `image`/PhotoField case below) must reuse these exact bindings rather
// than retyping the same Tailwind utility strings a second time. That is
// what keeps such a component from introducing a single-character-off
// utility that Tailwind would then scan as a NEW class and ship extra CSS
// for -- this project has shipped unused/duplicate CSS from exactly this
// kind of drift seven times before (see this repo's own commit history).
export const INPUT_CLASSNAME =
  "w-full rounded border border-gray-300 px-3 py-2 text-ink focus:border-accent focus:outline-none disabled:bg-gray-100 disabled:text-gray-500";
export const LABEL_CLASSNAME = "mb-1 block font-['Montserrat'] text-sm uppercase tracking-wide text-accent";

// A comma-separated text field, not a chip editor with its own per-item
// add/remove buttons -- that interaction belongs to Tasks 5/6 (RecordList's
// add/remove/reorder), which this task's own brief scopes out: "this task
// is one record." Every tags-kind field today is either not yet rendered
// anywhere on the site (DISH_FIELDS.tags) or short and rarely edited
// (HOURS_FIELDS.days, SITE_FIELDS.phones).
//
// Deliberately NOT re-derived from the committed array on every keystroke.
// An earlier version called onChange(parsed) on every change and displayed
// `tags.join(', ')` straight from the (now-updated) prop -- confirmed
// directly this makes it impossible to ever type a second tag: the instant
// she types the delimiting comma, split/filter drops the resulting empty
// trailing segment, the canonical re-join has no comma in it, and the
// controlled input snaps back to a value with the very comma she just typed
// erased. `text` is this input's own buffer while she's actively editing;
// what she typed stays on screen exactly as typed until she leaves the
// field, and only then is it parsed and committed.
function TagsInput({
  id,
  tags,
  onCommit,
  describedBy,
}: {
  id: string;
  tags: string[];
  onCommit: (next: string[]) => void;
  describedBy?: string;
}) {
  const [text, setText] = useState(() => tags.join(', '));

  // Resyncs when the committed list changes from OUTSIDE this input's own
  // typing -- a different record loaded into the same field, or this
  // field's own onBlur commit just below normalizing "We,Th ," down to
  // "We, Th" once she's done. Keyed on `tags` (not on every render), so it
  // never fires mid-keystroke.
  useEffect(() => {
    setText(tags.join(', '));
  }, [tags]);

  function commit() {
    onCommit(
      text
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    );
  }

  return (
    <input
      id={id}
      type="text"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      aria-describedby={describedBy}
      className={INPUT_CLASSNAME}
    />
  );
}

// A discriminated union whose discriminant (`kind`) depends on a generic,
// unresolved V can't be proven exhaustive by the compiler the way a plain
// string-literal switch can -- see fields.ts's own comment on why `Kind<V>`
// is conditional on V in the first place. ALL_KNOWN_KINDS
// (src/admin/__tests__/fields.test.ts) is the runtime backstop: every
// descriptor's `kind` is asserted to be one of these nine, and
// Field.test.tsx asserts each of the nine actually renders an
// accessible control, so a tenth kind reaching here without a case added
// below fails a test, not silently.
function Field<V>({ id, spec, value, onChange, problems, onStaged, previews, previewKey }: FieldProps<V>) {
  // Rendered directly, bypassing this function's own label/help/error shell
  // below entirely -- PhotoField already renders its own label, help text,
  // upload status and error region (it has to: a plain <input> can't show
  // upload progress or a Retry button), so wrapping it in the SAME shell
  // every other kind gets would double up every one of those, not merely
  // look redundant. Decided here, in Field's own dispatch, rather than in
  // RecordForm: `image` genuinely IS one of Kind<V>'s members, so this is a
  // rendering choice about a real kind, not a field this file has never
  // heard of.
  //
  // `spec as ...` mirrors the 'select' case's own cast just below: TS can't
  // carry the `spec.kind === 'image'` narrowing through to `spec.category`
  // when V is an unresolved generic, for the identical reason that case's
  // own comment already documents.
  if (spec.kind === 'image') {
    const { category } = spec as Extract<FieldSpec<V>, { kind: 'image' }>;
    return (
      <PhotoField
        id={id}
        label={spec.label}
        help={spec.help}
        category={category}
        value={(value as string | null) ?? null}
        onChange={(next) => onChange(next as V)}
        onStaged={onStaged}
        previews={previews}
        previewKey={previewKey}
        problems={problems}
      />
    );
  }

  const helpId = spec.help ? `${id}-help` : undefined;
  const errorId = problems.length > 0 ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter((part): part is string => Boolean(part)).join(' ') || undefined;

  let input: React.ReactNode;
  switch (spec.kind) {
    case 'textarea':
      input = (
        <textarea
          id={id}
          value={(value as string | null) ?? ''}
          onChange={(event) => onChange(event.target.value as V)}
          aria-describedby={describedBy}
          className={INPUT_CLASSNAME}
        />
      );
      break;
    case 'select': {
      // TS can't structurally narrow FieldSpec<V>'s `options` branch when V
      // is an unresolved generic -- `spec.kind === 'select'` (the case
      // above) is the real, correct discriminant, but the "select" literal
      // is being matched against `Extract<Kind<V>, 'select'>`, a
      // conditional type deferred on V, and the compiler won't carry that
      // match through to the sibling `options` property the way it does
      // for a plain string-literal union (confirmed: `spec.options` reads
      // as a compile error here without this cast, even though `spec.kind
      // === 'select'` is already true at this point). The cast only
      // documents what the runtime check already guarantees.
      const options = (spec as Extract<FieldSpec<V>, { options: readonly V[] }>).options;
      input = (
        <select
          id={id}
          value={value as string}
          onChange={(event) => onChange(event.target.value as V)}
          aria-describedby={describedBy}
          className={INPUT_CLASSNAME}
        >
          {options.map((option) => (
            <option key={String(option)} value={option as string}>
              {String(option)}
            </option>
          ))}
        </select>
      );
      break;
    }
    case 'toggle':
      input = (
        <input
          id={id}
          type="checkbox"
          checked={value as boolean}
          onChange={(event) => onChange(event.target.checked as V)}
          aria-describedby={describedBy}
          className="h-5 w-5 rounded border-gray-300"
        />
      );
      break;
    case 'number':
      input = (
        <input
          id={id}
          type="number"
          value={value as number}
          onChange={(event) => onChange(Number(event.target.value) as V)}
          aria-describedby={describedBy}
          className={INPUT_CLASSNAME}
        />
      );
      break;
    case 'tags':
      input = (
        <TagsInput
          id={id}
          tags={value as string[]}
          onCommit={(next) => onChange(next as V)}
          describedBy={describedBy}
        />
      );
      break;
    case 'date':
      input = (
        <input
          id={id}
          type="date"
          value={(value as string | null) ?? ''}
          onChange={(event) => onChange(event.target.value as V)}
          aria-describedby={describedBy}
          className={INPUT_CLASSNAME}
        />
      );
      break;
    case 'readonly':
      input = (
        <input
          id={id}
          type="text"
          value={(value as string | null) ?? ''}
          disabled
          readOnly
          aria-describedby={describedBy}
          className={INPUT_CLASSNAME}
        />
      );
      break;
    case 'text':
    default:
      // 'image' is handled by the early return above, never reaches here.
      input = (
        <input
          id={id}
          type="text"
          value={(value as string | null) ?? ''}
          onChange={(event) => onChange(event.target.value as V)}
          aria-describedby={describedBy}
          className={INPUT_CLASSNAME}
        />
      );
      break;
  }

  return (
    <div className="mb-4">
      <label htmlFor={id} className={LABEL_CLASSNAME}>
        {spec.label}
      </label>
      {input}
      {spec.help && (
        <p id={helpId} className="mt-1 text-xs text-gray-500">
          {spec.help}
        </p>
      )}
      {errorId && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">
          {problems.map((p) => p.message).join(' ')}
        </p>
      )}
    </div>
  );
}

export default Field;
