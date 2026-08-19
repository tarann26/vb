import type React from 'react';
import { useState } from 'react';
import RecordForm from './RecordForm';
import EditorSheet from './manage/EditorSheet';
import ItemList, { type ItemRow } from './manage/ItemList';
import { moveTo } from './blocks/reorder';
import type { ImagePreviews } from './previews';
import { arrayIndexOf, bannerLine } from './problems';
import type { FieldsOf, FieldSpec } from './fields';
import type { StagedPhoto } from './PhotoField';
import type { ValidationProblem } from '../content/validate';

export interface RecordListProps<T extends { id: string }> {
  fields: FieldsOf<T>;
  items: T[];
  onChange: (index: number, next: T) => void;
  onReorder: (ids: string[]) => void;
  // Returns the id of the record it added. Add and Edit are ONE surface --
  // the spec's own rule, so there is no separate "new item" form to drift
  // from the edit form -- and this list has no way to spot the new record in
  // the array it is handed back (`items` arrives on a later render, and an
  // id-diff would guess wrong on a duplicate). Every caller mints the id in
  // its own blank* factory already; it just stopped throwing it away.
  onAdd: () => string;
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
  // Forwarded straight to every RecordForm's own `scope` prop -- see that
  // file's comment (review finding, Task 9) for why a per-file namespace on
  // generated DOM ids is what keeps two ArraySections' same-index records
  // from producing duplicate ids (and, via `<label for>`, misdirecting a
  // click into the wrong section entirely).
  scope?: string;
  // A picture for the row, rendered at the start of its header row. Optional
  // and supplied by the caller rather than derived here, because only the
  // caller knows which field of `T` holds an image path (Dish.image,
  // Article.image, ...) and which content file to key a staged preview
  // under. A record type with no image simply does not pass one.
  thumbnail?: (item: T) => React.ReactNode;
  // The shared preview store, and the content file's own name -- this
  // component appends the record's id, the same prefix it already appends to
  // the key it reports through `onStaged`.
  previews?: ImagePreviews;
  previewKeyPrefix?: string;
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
  "rounded border border-gray-300 px-3 py-1 font-['Montserrat'] text-xs uppercase tracking-wide text-accent transition hover:bg-brand hover:text-ink";
export const REMOVE_BUTTON_CLASSNAME =
  "rounded border border-red-300 px-3 py-1 font-['Montserrat'] text-xs uppercase tracking-wide text-red-600 transition hover:bg-red-600 hover:text-white";
export const ADD_BUTTON_CLASSNAME =
  "mt-2 w-full rounded border-2 border-dashed border-brand py-2 font-['Montserrat'] text-sm uppercase tracking-wide text-accent transition hover:bg-brand/10";

// The key ONE of a record's fields stages under, spelled in exactly one
// place. The editor below composes it on the way up (RecordForm hands back
// the field's own key, this adds the record's id, ArraySection adds the file
// name) and the delete path below has to name the identical string. Two
// spellings of it is how a delete releases nothing at all, or releases
// another record's photograph -- the identity failure this project has met
// three times.
function stagedKey(id: string, fieldKey: string): string {
  return `${id}:${fieldKey}`;
}

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
  thumbnail,
  previews,
  previewKeyPrefix,
  scope,
}: RecordListProps<T>) {
  const [openId, setOpenId] = useState<string | null>(null);
  // By ID, never by index. Reordering while an editor is open must not swap
  // which record she is editing under her hands.
  const openIndex = openId === null ? -1 : items.findIndex((item) => item.id === openId);
  const open = openIndex === -1 ? undefined : items[openIndex];

  // The partition: `shown` is everything the open editor's RecordForm will
  // place, on a field or in its own banner; `banner` is everything else,
  // which with no editor open is EVERYTHING -- including any problem naming
  // an index that does not exist. By reference, so nothing is counted twice
  // and nothing is dropped.
  const shown = open === undefined ? [] : problems.filter((p) => arrayIndexOf(p.field) === openIndex);
  const banner = problems.filter((p) => !shown.includes(p));

  // A deleted record's staged photo goes with it. Without this the bytes stay
  // in the collector, occupy one of the eight slots a publish allows, and are
  // still SENT -- an upload for a record nothing references any more.
  //
  // Reported through the SAME `onStaged` channel the fields themselves report
  // on, never a second call into the collector: `onStaged` is what adds the
  // file name (ArraySection), so releasing through it is what makes the key
  // released the key that was written.
  //
  // A `null` down that channel becomes `stage(key, null)` -- the "whatever is
  // at that key now is stale" case stage's own contract names, and the right
  // one here because there is no in-flight request whose identity could be
  // confused with it. clearSent's identity matching is for the
  // publish-SUCCESS path.
  //
  // Which keys: every field this record type declares `kind: 'image'` for,
  // read off the SAME `fields` descriptor RecordForm renders from, so a
  // record type that grows a second photo releases both without this list
  // being edited.
  const imageFieldKeys = Object.keys(fields).filter(
    (key) => (fields as Record<string, FieldSpec>)[key]?.kind === 'image',
  );
  function releaseStagedFor(record: T): void {
    if (onStaged === undefined) return;
    for (const fieldKey of imageFieldKeys) onStaged(stagedKey(record.id, fieldKey), null);
  }

  const rows: ItemRow[] = items.map((item, index) => ({
    id: item.id,
    name: itemLabel(item),
    thumbnail: thumbnail?.(item),
    needsAttention: problems.some((p) => arrayIndexOf(p.field) === index),
  }));

  return (
    <div>
      {banner.length > 0 && (
        <div
          role="alert"
          // No plural: the real nouns are dish, drink, article, award and
          // "coming-soon item", and `${noun}s` renders "dishs" on the first
          // of them. This is owner-facing text.
          aria-label="Problems with this list"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {banner.map((p, i) => {
              // Named where it CAN be named: a problem shaped `[N].key` is
              // about one record, so the line gets that record's own name (or
              // its position, when the record has none -- bannerLine's own
              // fallback, exactly the case an empty name field reaches). A
              // problem with no such shape -- a file-level rule with nothing
              // to blame ('the menu needs at least one dish') -- names no
              // record because it is not about one; inventing "the 1st one"
              // for it would point at a record the problem never meant.
              const recordIndex = arrayIndexOf(p.field);
              if (recordIndex === undefined) return <li key={i}>{p.message}</li>;
              const record = items[recordIndex];
              return <li key={i}>{bannerLine(p, record === undefined ? undefined : itemLabel(record), recordIndex)}</li>;
            })}
          </ul>
        </div>
      )}

      <ItemList
        rows={rows}
        onOpen={setOpenId}
        onMove={(from, to) => onReorder(moveTo(items, from, to).map((item) => item.id))}
        onAdd={() => setOpenId(onAdd())}
        addLabel={`Add a ${noun}`}
      />

      {open !== undefined && (
        <EditorSheet
          title={itemLabel(open)}
          onClose={() => setOpenId(null)}
          onDelete={() => {
            releaseStagedFor(open);
            onRemove(openIndex);
            setOpenId(null);
          }}
          deleteLabel={`Delete ${itemLabel(open)}`}
        >
          <RecordForm<T>
            fields={fields}
            index={openIndex}
            value={open}
            onChange={(next) => onChange(openIndex, next)}
            problems={shown}
            onStaged={onStaged ? (fieldKey, staged) => onStaged(stagedKey(open.id, fieldKey), staged) : undefined}
            previews={previews}
            previewKeyPrefix={previewKeyPrefix === undefined ? undefined : `${previewKeyPrefix}:${open.id}`}
            scope={scope}
          />
        </EditorSheet>
      )}
    </div>
  );
}

export default RecordList;
