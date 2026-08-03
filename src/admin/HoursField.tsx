// site.json's `hours` field -- an array of `{ days, opens, closes }` rows,
// the single fact both the footer's human-readable hours and the JSON-LD
// `openingHours` line (src/content/hours.ts) are formatted from.
//
// *** DO NOT ADD "closes must be after opens" HERE. *** A closing time
// numerically EARLIER than the opening time (e.g. opens="23:00",
// closes="00:30") is a VALID, real shape this restaurant's own bar hours
// have used before -- src/content/hours.ts:55-63's own comment calls it "a
// correct literal reading of the two clock times, not a bug," the same
// schema.org convention `openingHours` itself documents. Plan 2's final
// review had to REMOVE a test asserting exactly that rule, because it
// blocked a legitimate edit -- and since the deploy runs the suite, a rule
// like that would stop her publishing anything at all until a developer
// intervened. This component adds no validation of its own for exactly that
// reason: every row here renders through RecordForm + HOURS_FIELDS (plain
// text inputs, no HTML time-range constraint either), and whatever
// validateSite/assertHours (src/content/validate.ts, src/content/guards.ts)
// say via the debounced `problems` prop is the only opinion this screen has.
import RecordForm from './RecordForm';
import { replaceAt } from './useValidation';
import { HOURS_FIELDS } from './fields';
import { ADD_BUTTON_CLASSNAME, MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME } from './RecordList';
import type { Hours } from '../content/types';
import type { ValidationProblem } from '../content/validate';

export interface HoursFieldProps {
  value: Hours[];
  onChange: (next: Hours[]) => void;
  // The FULL site.json problem list, not pre-filtered -- the same "not
  // pre-filtered" contract RecordForm/RecordList's own `problems` prop
  // documents. This component narrows it to the `hours`/`hours[i]` shapes
  // itself; nothing upstream filters for it.
  problems: ValidationProblem[];
}

// `hours[N]` -- validateSite's OWN shape for a single row's assertHours
// failure (`problem(`hours[${i}]`, ...)`, src/content/validate.ts), NOT the
// `[N].key` shape src/admin/problems.ts's `arrayIndexOf` parses. The two are
// genuinely different field shapes, not two spellings of the same thing:
// dishes.json etc. are arrays of records at a FILE's own top level (each
// FIELD within a record gets its own sub-message, `[i].name`); `hours` is an
// ARRAY-VALUED FIELD inside site.json, a single non-array file -- exactly
// the third shape problems.ts's own header comment documents (`key[i]`) --
// and assertHours' error is one lump message for the WHOLE row (a bad
// `opens` time and an empty `days` array are indistinguishable from outside
// assertHours), never broken down to which of days/opens/closes was at
// fault. A second, independently-written regex here (rather than reusing
// arrayIndexOf) is deliberate: unifying the two would either miss this
// shape or wrongly match dishes.json's.
const HOURS_ITEM = /^hours\[(\d+)\]$/;

function hoursIndexOf(field: string): number | undefined {
  const found = field.match(HOURS_ITEM);
  return found === null ? undefined : Number(found[1]);
}


function HoursField({ value, onChange, problems }: HoursFieldProps) {
  // validateSite's "the site needs at least one opening-hours entry"
  // (src/content/validate.ts) is a BARE `hours`-field problem, with no row
  // index at all -- it can only fire when `value.length === 0`, the one
  // state with no row left to attach it to. Anything else that doesn't
  // parse as `hours[N]` for a row actually rendered below also lands here,
  // on the identical "nowhere else for this to go" reasoning RecordList's
  // own `unclaimedProblems` documents for a problem naming an index past the
  // end of what's currently rendered.
  const banner = problems.filter((p) => {
    const index = hoursIndexOf(p.field);
    return index === undefined || index < 0 || index >= value.length;
  });

  function swap(index: number, otherIndex: number): void {
    const next = value.slice();
    const moved = next[index];
    next[index] = next[otherIndex];
    next[otherIndex] = moved;
    onChange(next);
  }

  return (
    <div>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with opening hours"
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
        {value.map((row, index) => {
          const isFirst = index === 0;
          const isLast = index === value.length - 1;
          const rowProblems = problems.filter((p) => hoursIndexOf(p.field) === index);
          return (
            // Hours rows carry no natural id (src/content/types.ts's Hours
            // has none, unlike Dish/Drink/Article/Section) -- index is what
            // both this list and the underlying array itself are already
            // addressed by. Reordering still shows the right values at each
            // position despite the index-keyed `<li>`: RecordForm's own
            // <Field kind="tags"> (the `days` row) resyncs its display off
            // the `tags` VALUE it's handed (a useEffect keyed on that value,
            // src/admin/Field.tsx), not off ever being unmounted/remounted,
            // so a reorder that hands the same DOM node a different row's
            // data still renders that row's own value correctly.
            <li key={index} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  {!isFirst && (
                    <button
                      type="button"
                      aria-label={`Move hours row ${index + 1} up`}
                      onClick={() => swap(index, index - 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Up
                    </button>
                  )}
                  {!isLast && (
                    <button
                      type="button"
                      aria-label={`Move hours row ${index + 1} down`}
                      onClick={() => swap(index, index + 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Down
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove hours row ${index + 1}`}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                  className={REMOVE_BUTTON_CLASSNAME}
                >
                  Remove
                </button>
              </div>
              <RecordForm<Hours>
                fields={HOURS_FIELDS}
                index={index}
                value={row}
                onChange={(next) => onChange(replaceAt(value, index, next))}
                problems={rowProblems}
              />
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        // A blank row -- assertHours rejects it immediately (empty `days`),
        // exactly like AdminApp.tsx's own `blankDish`/`blankDrink`/
        // `blankArticle` hand her a record that fails validation on purpose
        // until she fills it in, rather than guessing at a default that
        // might read as real committed data. Inlined rather than a named
        // export: unlike Dish/Drink/Article, nothing outside this
        // component ever needs "what a blank Hours row looks like".
        onClick={() => onChange([...value, { days: [], opens: '', closes: '' }])}
        className={ADD_BUTTON_CLASSNAME}
      >
        Add an opening-hours row
      </button>
    </div>
  );
}

export default HoursField;
