// Maps a ValidationProblem's `field` string to the field(s) rendered by one
// RecordForm instance. validateContent (src/content/validate.ts) emits four
// shapes:
//   [i].key        -- dishes.json, drinks.json, press.json (array files)
//   key             -- story.json, site.json, scalar fields
//   key[i] / key[i].sub -- an array-valued field WITHIN a non-array file
//                          (hours[0], paragraphs[1], heroCollage[2].src)
//   ''              -- file-level rules with no single field to blame
//                       ('press.json: articles must be sorted newest first')
//
// Only the first shape needs an index at all -- `index` is defined exactly
// when this form renders one item of an array-shaped file, and undefined
// for a non-array file's own fields.
import type { ValidationProblem } from '../content/validate';

// `[N].anything` -> N. The one place that regex is defined -- RecordForm
// (whether a problem belongs to a DIFFERENT index than the one it's
// rendering) and RecordList (whether a problem's index has no mounted
// RecordForm at all, Task 5) both need the same extraction, and a second,
// independently-written copy of this pattern is exactly the kind of thing
// that can drift out of sync with problemsFor's own matching above with no
// compiler link to catch it.
const ARRAY_ITEM = /^\[(\d+)\]\./;

// undefined for a bare/non-array-item field (`''`, `heading`, `hours[0]`
// from a non-array file) -- RecordForm.tsx already had a boolean-only
// version of this (`belongsToAnotherIndex`); this returns the index itself
// so a caller (RecordList) can compare it against something other than one
// fixed index.
export function arrayIndexOf(field: string): number | undefined {
  const found = field.match(ARRAY_ITEM);
  return found === null ? undefined : Number(found[1]);
}

export function problemsFor(problems: ValidationProblem[], index: number | undefined, key: string): ValidationProblem[] {
  if (index !== undefined) {
    // Exact match on THIS index, never a suffix. `field.endsWith('.' +
    // key)` would also match `[1].name` while rendering index 0 -- on a
    // 38-item list that misattributes a problem to a record that doesn't
    // have it, and hides the one that does.
    const target = `[${index}].${key}`;
    return problems.filter((p) => p.field === target);
  }
  // A non-array file's own field: either the bare key itself (a scalar,
  // `heading`), or `key[` as a prefix (an array-valued field's own items,
  // `hours[0]`, `paragraphs[1]`, `heroCollage[2].src` -- all belong to the
  // same field this form renders as one unit, since a non-array file has no
  // per-item form to place them on individually).
  return problems.filter((p) => p.field === key || p.field.startsWith(`${key}[`));
}
