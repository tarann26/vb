import React from 'react';
import Field from './Field';
import { problemsFor, arrayIndexOf } from './problems';
import type { FieldsOf } from './fields';
import type { StagedPhoto } from './PhotoField';
import type { ImagePreviews } from './previews';
import type { ValidationProblem } from '../content/validate';

export interface RecordFormProps<T> {
  fields: FieldsOf<T>;
  // Present when this form renders one item of an array-shaped file
  // (dishes.json/drinks.json/press.json), where validateContent emits
  // `[i].key`. Absent for a non-array file (story.json, site.json), where
  // it emits a bare `key`. src/admin/problems.ts's problemsFor is what
  // actually branches on this.
  index?: number;
  value: T;
  onChange: (next: T) => void;
  // The FULL problem list for the file this record belongs to, not
  // pre-filtered. RecordForm is what divides it between each rendered field
  // (via problemsFor) and a form-level banner for anything that matches no
  // rendered field -- file-level rules (field === '') and any problem whose
  // field this form doesn't render. A problem must never be silently
  // dropped: showing it in the wrong place is bad, showing it nowhere is
  // worse.
  problems: ValidationProblem[];
  // Task 9's wiring: fires as `(fieldKey, staged)` for whichever of this
  // record's OWN fields is `kind: 'image'` (Dish/Drink/Article each have
  // exactly one -- `image`). RecordForm has no notion of "this record's own
  // globally unique identity" (T isn't required to carry an `id`; Hours
  // rows don't), so it only ever adds the FIELD's own key, e.g. "image" --
  // never an item id or a file name. RecordList (its caller, for every
  // record type that actually has one) is what prefixes that with the
  // item's own id, and ArraySection above that with the file name, building
  // up the fully-qualified key src/admin/staged.ts's collector is keyed by.
  //
  // Optional so every OTHER caller (HoursField, SectionList's own
  // RecordForm-less rendering -- neither renders an image field) keeps
  // working unchanged. When a record type's `fields` DOES include an
  // `image`-kind field, omitting this is exactly the "worse than the text
  // box" state this task's brief warns against -- see Field.tsx's own
  // `onStaged` for where that guarantee actually gets enforced (or rather,
  // where it does not: nothing throws here if it's missing, since RecordForm
  // is generic over every record type, including ones with no image field
  // at all, and cannot tell the two apart at compile time).
  onStaged?: (fieldKey: string, staged: StagedPhoto | null) => void;
  // The shared preview store, and everything of the staged key that is
  // already known at this level (the content file's name plus this record's
  // id). This component appends its own field key, which is the same string
  // `onStaged` above reports upward -- one key shape, composed in one
  // direction and consumed in the other.
  previews?: ImagePreviews;
  previewKeyPrefix?: string;
  // Review finding (Task 9): every DOM id this component generates was
  // `field-${key}-${index}` alone, with no per-FILE namespace -- Dishes'
  // own first record and Drinks' own first record both produce
  // `id="field-image-0"`, `id="field-name-0"`, etc., since `index` alone
  // repeats across every ArraySection on the page. Harmless while every
  // kind rendered a plain `<input>` (a `<label for>` resolving to the WRONG
  // section's equivalent-looking text box didn't visibly break anything),
  // genuinely harmful now that `image` renders a real, clickable file-picker
  // label (PhotoField): confirmed directly that clicking "Photo" under
  // Drinks focused the *Dishes* input instead, uploaded into the wrong
  // assets-source/ category, and wrote the result into the wrong record --
  // `document.getElementById`, which is what `<label for>` resolves
  // against, isn't scoped by container and always finds the FIRST matching
  // id in the whole document. `scope` (each ArraySection's own `file`, minus
  // the ".json") is what makes the id unique per file again; optional so a
  // caller with no risk of a sibling on the same page (HoursField,
  // SectionList) needn't supply one.
  scope?: string;
}

// `[N].key` for an N other than the index this instance renders -- a
// DIFFERENT array item's problem, not an unmatched one. Callers naturally
// pass the whole file's problem list to every item's RecordForm (RecordList,
// Task 5, slices nothing before handing problems down -- see its own
// comment on why), so without this exclusion a dish at index 0 would show
// every OTHER dish's validation message in its own banner too -- the exact
// cross-item misattribution this task's brief warns index-matching itself
// must avoid, just moved into the banner instead of the field.
function belongsToAnotherIndex(field: string, index: number): boolean {
  const found = arrayIndexOf(field);
  return found !== undefined && found !== index;
}

function RecordForm<T extends object>({
  fields,
  index,
  value,
  onChange,
  problems,
  onStaged,
  previews,
  previewKeyPrefix,
  scope,
}: RecordFormProps<T>) {
  const keys = Object.keys(fields) as (keyof T)[];

  // Every problem actually matched to a rendered field, tracked by
  // reference (not by re-deriving field strings) so the banner below is
  // simply "whatever's left over" -- the one true way to guarantee nothing
  // is ever counted in both places, or in neither.
  const matched = new Set<ValidationProblem>();

  function fieldProblemsFor(key: keyof T): ValidationProblem[] {
    const found = problemsFor(problems, index, String(key));
    found.forEach((p) => matched.add(p));
    return found;
  }

  const rows = keys.map((key) => ({ key, fieldProblems: fieldProblemsFor(key) }));
  const banner = problems.filter((p) => {
    if (matched.has(p)) return false;
    if (index !== undefined && belongsToAnotherIndex(p.field, index)) return false;
    return true;
  });

  const prefix = scope ? `${scope}-field` : 'field';
  const idFor = (key: string) => (index === undefined ? `${prefix}-${key}` : `${prefix}-${key}-${index}`);

  function renderField<K extends keyof T>(key: K, fieldProblems: ValidationProblem[]): React.ReactNode {
    const spec = fields[key];
    const raw = value[key];

    // Required<T>[K] strips an optional content field's optionality from the
    // DESCRIPTOR's point of view, so a record that simply hasn't filled one
    // in needs a concrete fallback to hand Field -- same as Field's own
    // `?? ''` for a `null` image/readonly value.
    const current = (raw === undefined ? '' : raw) as Required<T>[K];
    return (
      <Field<Required<T>[K]>
        key={String(key)}
        id={idFor(String(key))}
        spec={spec}
        value={current}
        onChange={(next) => onChange({ ...value, [key]: next })}
        problems={fieldProblems}
        // Bound with this field's own key (e.g. "image"), never a
        // pre-formed compound key -- see this component's own onStaged
        // comment above for why RecordForm itself stops there. Harmless to
        // pass unconditionally for every field, image-kind or not: Field.tsx
        // only ever reads `onStaged` inside its own `spec.kind === 'image'`
        // branch.
        onStaged={onStaged ? (staged) => onStaged(String(key), staged) : undefined}
        previews={previews}
        previewKey={previewKeyPrefix === undefined ? undefined : `${previewKeyPrefix}:${String(key)}`}
      />
    );
  }

  return (
    <div>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with this file"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}
      {rows.map(({ key, fieldProblems }) => renderField(key, fieldProblems))}
    </div>
  );
}

export default RecordForm;
