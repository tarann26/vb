import RecordForm from './RecordForm';
import { arrayIndexOf } from './problems';
import type { FieldsOf } from './fields';
import type { StagedPhoto } from './PhotoField';
import type { ValidationProblem } from '../content/validate';

export interface RecordListProps<T extends { id: string }> {
  fields: FieldsOf<T>;
  items: T[];
  onChange: (index: number, next: T) => void;
  onReorder: (ids: string[]) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  // Task 9's wiring, one level up from RecordForm's own `onStaged` (see that
  // file's comment for the field-key half of this). RecordList is the one
  // place in this chain that actually has a stable, reorder-proof identity
  // for "which record" a staged photo belongs to -- `item.id` -- so it is
  // the one place that prefixes the field key RecordForm reports with it,
  // before handing the result up to whatever caller (ArraySection) adds the
  // FILE name on top. Optional for the identical reason RecordForm's own
  // `onStaged` is: most `RecordList` instances (were there ever a record
  // type with no image-kind field) would have nothing to forward.
  onStaged?: (key: string, staged: StagedPhoto | null) => void;
  // Every record type this list can hold names itself differently
  // (Dish.name, Drink.name, Article.title) -- there is no field common to
  // all of them for RecordList to read a display name from on its own, so
  // the caller supplies both the noun for the list as a whole ("dish",
  // singular, not capitalized, used in the Add button) and how to read one
  // item's own name back out of it (used in that item's own Move/Remove
  // buttons).
  noun: string;
  itemLabel: (item: T) => string;
  // The FULL problem list for the file this list belongs to, not
  // pre-filtered -- the same "not pre-filtered" contract RecordForm's own
  // `problems` prop documents, and for the same reason: RecordList hands
  // this same array to every mounted RecordForm (each one narrows it to its
  // own index via problemsFor), and ALSO uses it directly below to find
  // whatever no mounted RecordForm could have claimed.
  problems: ValidationProblem[];
}

// The guarantee only RecordList can keep (see this file's own review
// history in task-5-brief.md): RecordForm's own banner only ever excludes a
// problem that names ANOTHER index -- it has no way to know whether that
// other index is actually rendered by a sibling instance anywhere on the
// page. A list rendering indices 0-37 with a problem on `[40].name` is
// invisible to every one of those 38 forms' own banners: each one sees
// index 40, correctly concludes "not mine", and drops it -- there is no
// index 40 for the problem to have landed on instead. That is a total,
// silent loss, which this plan's own rule (RecordForm.tsx's file comment)
// calls worse than showing a problem in the wrong place.
//
// RecordList is the one place that actually knows how many RecordForms are
// mounted (`items.length`), so it is the one place that can tell "belongs
// to a sibling I'm not rendering" apart from "belongs to nobody I'm
// rendering" -- the second case is what this function isolates.
function unclaimedProblems(problems: ValidationProblem[], itemCount: number): ValidationProblem[] {
  return problems.filter((p) => {
    // When NO RecordForm is mounted at all, nothing downstream can surface
    // ANY problem -- not just an indexed one. This is not a corner case:
    // validateContent('dishes.json', []) (src/content/validate.ts) emits
    // exactly `{ field: '', message: 'dishes.json: the menu needs at least
    // one dish' }` precisely when the array is empty, which is exactly the
    // state in which `items.length === 0`. Without this branch, the one
    // message the validator produces for an empty list is the one message
    // this component drops -- she deletes her last dish, publishes, gets a
    // 422, and sees an "Add a dish" button with no explanation anywhere.
    if (itemCount === 0) return true;
    const index = arrayIndexOf(p.field);
    // A non-array-item problem (`''`, or a non-array file's own field) is
    // never this list's concern when at least one RecordForm IS mounted --
    // every RecordForm this list mounts already surfaces it (via
    // `!belongsToAnotherIndex`), so counting it here too would only
    // duplicate it, not rescue it from being dropped.
    return index !== undefined && (index < 0 || index >= itemCount);
  });
}

// No `disabled:` variant: a move button is never rendered disabled -- it is
// OMITTED entirely at the end it would move past (see the brief's own
// naming rule below), so there is no `disabled` state for one to ever
// reach, and a `disabled:opacity-*` class here would just be unused CSS
// shipped for a state that can't occur.
//
// Exported, not module-private: HoursField.tsx and SectionList.tsx (Task 7)
// need the identical Move/Add/Remove button styling this list already uses,
// and reusing these exact bindings (rather than retyping the same Tailwind
// utility strings in a second file) is what keeps a typo there from reading
// as a brand-new class Tailwind would scan and ship extra CSS for -- see
// Field.tsx's own INPUT_CLASSNAME/LABEL_CLASSNAME export for the identical
// reasoning.
export const MOVE_BUTTON_CLASSNAME =
  "rounded border border-gray-300 px-3 py-1 font-['Montserrat'] text-xs uppercase tracking-wide text-[#6B8B59] transition hover:bg-[#6B8B59] hover:text-white";
export const REMOVE_BUTTON_CLASSNAME =
  "rounded border border-red-300 px-3 py-1 font-['Montserrat'] text-xs uppercase tracking-wide text-red-600 transition hover:bg-red-600 hover:text-white";
export const ADD_BUTTON_CLASSNAME =
  "mt-2 w-full rounded border-2 border-dashed border-[#6B8B59] py-2 font-['Montserrat'] text-sm uppercase tracking-wide text-[#6B8B59] transition hover:bg-[#6B8B59]/10";

function RecordList<T extends { id: string }>({
  fields,
  items,
  onChange,
  onReorder,
  onAdd,
  onRemove,
  noun,
  itemLabel,
  problems,
  onStaged,
}: RecordListProps<T>) {
  // Swaps the item at `index` with its neighbour at `otherIndex` and hands
  // the resulting id ORDER back to the caller -- RecordList never reorders
  // `items` itself. It is a controlled list: the caller owns the array (the
  // same way RecordForm's caller owns `value`), and re-renders this
  // component with `items` already in the order it asked for.
  function swap(index: number, otherIndex: number): void {
    const ids = items.map((item) => item.id);
    const moved = ids[index];
    ids[index] = ids[otherIndex];
    ids[otherIndex] = moved;
    onReorder(ids);
  }

  const banner = unclaimedProblems(problems, items.length);

  return (
    <div>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with items no longer shown"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}

      <ul>
        {items.map((item, index) => {
          const name = itemLabel(item);
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          return (
            <li key={item.id} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  {/* Omitted at the ends, not disabled: a list of 38 items
                      would otherwise carry 76 buttons that read as live
                      controls but do nothing -- the exact "unassociated
                      control" failure this task's brief calls out for
                      identically-named buttons, just moved to disabled ones
                      instead. */}
                  {!isFirst && (
                    <button
                      type="button"
                      aria-label={`Move ${name} up`}
                      onClick={() => swap(index, index - 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Up
                    </button>
                  )}
                  {!isLast && (
                    <button
                      type="button"
                      aria-label={`Move ${name} down`}
                      onClick={() => swap(index, index + 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Down
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => onRemove(index)}
                  className={REMOVE_BUTTON_CLASSNAME}
                >
                  Remove
                </button>
              </div>
              <RecordForm<T>
                fields={fields}
                index={index}
                value={item}
                onChange={(next) => onChange(index, next)}
                problems={problems}
                onStaged={onStaged ? (fieldKey, staged) => onStaged(`${item.id}:${fieldKey}`, staged) : undefined}
              />
            </li>
          );
        })}
      </ul>

      {/* `() => onAdd()`, not `onAdd` directly -- onClick would otherwise
          forward the DOM MouseEvent as onAdd's first argument, which
          doesn't match this component's own contract (`onAdd: () => void`,
          no arguments). */}
      <button type="button" onClick={() => onAdd()} className={ADD_BUTTON_CLASSNAME}>
        {`Add a ${noun}`}
      </button>
    </div>
  );
}

export default RecordList;
