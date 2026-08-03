import React from 'react';
import Field from './Field';
import { problemsFor, arrayIndexOf } from './problems';
import type { FieldsOf } from './fields';
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

function RecordForm<T extends object>({ fields, index, value, onChange, problems }: RecordFormProps<T>) {
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

  const idFor = (key: string) => (index === undefined ? `field-${key}` : `field-${key}-${index}`);

  function renderField<K extends keyof T>(key: K, fieldProblems: ValidationProblem[]): React.ReactNode {
    const spec = fields[key];
    const raw = value[key];
    // The only optional field across every descriptor today is
    // Dish/Drink/Article's `publishAt` (kind 'date') -- Required<T>[K]
    // strips that optionality from the DESCRIPTOR's point of view, so a
    // record that simply hasn't scheduled a publish date needs a concrete
    // fallback to hand Field, same as Field's own `?? ''` for a `null`
    // image/readonly value. Deciding whether clearing that field back to ''
    // should DELETE the key (validatePublishAt throws on '', not on a
    // missing key) is Task 7's (Hours, sections, and scheduling) -- out of
    // this task's "one record" scope.
    const current = (raw === undefined ? '' : raw) as Required<T>[K];
    return (
      <Field<Required<T>[K]>
        key={String(key)}
        id={idFor(String(key))}
        spec={spec}
        value={current}
        onChange={(next) => onChange({ ...value, [key]: next })}
        problems={fieldProblems}
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
