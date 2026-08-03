// The one control across this whole dashboard whose EMPTY state must be
// reported as `undefined`, not `''`.
//
// `Dish`/`Drink`/`Article`'s `publishAt` (src/content/types.ts's
// `Schedulable`) is OPTIONAL -- absent means "publish immediately". A plain
// `<input type="date">` (what Field.tsx's own 'date' case already renders,
// correctly, for Article's REQUIRED `date` field) hands back the empty
// string `''` the instant she clicks the native clear ("x") button or
// deletes the digits by hand. `''` is not "no date" to the rest of this
// codebase -- it is a MALFORMED one: validatePublishAt -> isPublished
// (src/content/publish.ts) THROWS on it (`ISO_DATE_PATTERN.test('')` is
// false), which validateContent turns into a `[i].publishAt` problem and
// POST /api/publish turns into a 422. A routine "actually, never mind,
// publish this right away" edit must not become an error she has to
// puzzle out. RecordForm.tsx is what actually deletes the key when this
// component reports `undefined` -- see that file's own comment for why the
// deletion lives there, not here.
import { INPUT_CLASSNAME, LABEL_CLASSNAME } from './Field';
import type { ValidationProblem } from '../content/validate';

export interface ScheduleFieldProps {
  id: string;
  label: string;
  help?: string;
  // `undefined` means "not scheduled -- publishes immediately", the exact
  // meaning `Schedulable.publishAt` being absent already has. Never `''`.
  value: string | undefined;
  // Mirrors `value`'s own contract in reverse: `undefined` here means
  // "delete `publishAt` from the record", never "set it to `''`". This
  // component only ever reports what the input NOW means -- it has no
  // record to mutate and no idea how to remove a key from one; RecordForm is
  // the caller that does.
  onChange: (next: string | undefined) => void;
  problems: ValidationProblem[];
}

const NOTE_CLASSNAME = 'mt-1 text-xs text-gray-500';

// D9 (docs/superpowers/specs/2026-08-02-phase-b-c-dashboard-and-sections-design.md):
// "A Cloudflare cron trigger rebuilds on a schedule" -- wrangler.toml's own
// schedule (`crons = ["0 * * * *"]`) is hourly, on the hour, not a rebuild
// the instant midnight strikes. Said here, next to the one control that
// sets a date, so she never assumes a date she picks "goes live at
// midnight" and is confused when it doesn't appear for up to another hour.
const HOURLY_NOTE = 'Publishing runs on an hourly check, not at the stroke of midnight — a date set here can take up to an hour to go live.';

function ScheduleField({ id, label, help, value, onChange, problems }: ScheduleFieldProps) {
  const helpId = help ? `${id}-help` : undefined;
  const noteId = `${id}-note`;
  const errorId = problems.length > 0 ? `${id}-error` : undefined;
  const describedBy = [helpId, noteId, errorId].filter((part): part is string => Boolean(part)).join(' ');

  return (
    <div className="mb-4">
      <label htmlFor={id} className={LABEL_CLASSNAME}>
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === '' ? undefined : next);
        }}
        aria-describedby={describedBy}
        className={INPUT_CLASSNAME}
      />
      {help && (
        <p id={helpId} className={NOTE_CLASSNAME}>
          {help}
        </p>
      )}
      <p id={noteId} className={NOTE_CLASSNAME}>
        {HOURLY_NOTE}
      </p>
      {errorId && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">
          {problems.map((p) => p.message).join(' ')}
        </p>
      )}
    </div>
  );
}

export default ScheduleField;
