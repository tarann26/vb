// galleries.json's own screen: three independently add/remove/reorder-able
// image lists (atmosphere, ourStory, heroCollage), none of which fit
// RecordList -- GalleryImage (src/content/types.ts) has no `id` field at
// all, so RecordList<GalleryImage>'s own `T extends { id: string }`
// constraint can't be satisfied the way Dish/Drink/Article satisfy it. Every
// row here is addressed by its own array index instead, the identical trade
// HoursField.tsx already makes for site.json's `hours` rows (see that
// file's own comment on why a reorder that hands the same DOM node a
// different row's data still renders correctly).
//
// `src` reuses PhotoField directly, not Field.tsx's generic 'image' dispatch
// -- fields.ts's own GALLERY_IMAGE_FIELDS comment explains why: atmosphere
// and ourStory share ONE descriptor but need TWO different upload
// categories, which one FieldSpec value can't express (which is also why
// that descriptor has no `src` entry of its own at all, only `alt` -- a
// wrong-category `image`-kind `src` field sitting there unused was a real
// landmine, see its own comment). This component supplies the real
// category itself, per list.
import { useRef } from 'react';
import Field from './Field';
import PhotoField from './PhotoField';
import { GALLERY_IMAGE_FIELDS } from './fields';
import { ADD_BUTTON_CLASSNAME, MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME } from './RecordList';
import { fromStagedPhoto, type StagedFile } from './staged';
import type { Galleries, GalleryImage } from '../content/types';
import type { UploadCategory } from '../shared/upload-categories';
import type { ValidationProblem } from '../content/validate';

export interface GalleryListProps {
  value: Galleries;
  onChange: (next: Galleries) => void;
  // The FULL galleries.json problem list, unfiltered -- the same
  // not-pre-filtered contract every other list in this dashboard's `problems`
  // prop already documents (RecordForm.tsx, RecordList.tsx, HoursField.tsx).
  problems: ValidationProblem[];
  // src/admin/staged.ts's shared collector -- the SAME function instance
  // AdminApp hands every other staging screen, not a fresh one per section.
  // See that file's own header comment for why sharing one is the whole
  // point.
  stage: (key: string, file: StagedFile | null) => void;
}

// `key[i].sub` -- the third field shape src/admin/problems.ts's own header
// comment documents (an array-valued field inside a non-array file), for
// one of THREE different prefixes here (atmosphere/ourStory/heroCollage), so
// a fresh caller-supplied prefix is genuinely needed -- unlike HoursField.tsx's
// own HOURS_ITEM (one single, never-changing prefix), one pre-written regex
// can't cover all three without also matching each other's rows.
function itemOf(prefix: string, field: string): { index: number; sub: string } | undefined {
  const match = field.match(new RegExp(`^${prefix}\\[(\\d+)\\]\\.(.+)$`));
  return match ? { index: Number(match[1]), sub: match[2] } : undefined;
}

// The bare `prefix` message (validateGalleries's "atmosphere needs at least
// one image", only possible when the list IS empty) plus any indexed
// problem naming a row this list isn't currently rendering -- the same
// "nowhere else for this to go" reasoning RecordList's own unclaimedProblems
// documents.
function bannerFor(problems: ValidationProblem[], prefix: string, itemCount: number): ValidationProblem[] {
  return problems.filter((p) => {
    if (p.field === prefix) return true;
    const item = itemOf(prefix, p.field);
    if (item === undefined) return false;
    return item.index < 0 || item.index >= itemCount;
  });
}

// Review finding (Important): keying the staged-file collector on `item.src`
// (Task 9's own fix for the reorder-eviction Critical) is not, by itself,
// enough -- `src` is the exact value PhotoField's own onChange rewrites the
// INSTANT a stage succeeds. Restaging the SAME row computes its eviction key
// from the row's post-first-pick `src`, which was never the key the first
// pick was actually staged under -- an orphan, not an eviction. Measured: 4
// picks on one row left 3 staged files (2 of them dead weight), and 8 more
// permanently disabled Publish with nothing on screen able to remove one.
// `rowIdFor` is the identity fix instead: a WeakMap keyed on the actual
// GalleryImage object REFERENCE, scoped to one list instance (via
// `useRef`, not module state, so atmosphere/ourStory/heroCollage each track
// their own rows independently -- their generated ids CAN collide as plain
// strings; the `prefix` already in every stage key below is what keeps them
// from colliding as COLLECTOR keys). GalleryImage carries no `id` of its
// own (src/content/types.ts) for this to reuse RecordList's own
// item.id-keying with, and adding one would change the committed JSON
// schema for a purely client-side bookkeeping need.
//
// The one thing this identity must survive that RecordList's `id` gets for
// free is an EDIT: `patchAt`/`patchSrc` below always build a fresh object
// (never mutate `items` in place, the same "never reconstruct, never
// mutate" contract every write path in this codebase keeps), so the row's
// own object reference changes on every keystroke, not just a stage. Each
// caller carries the SAME id forward onto the fresh reference the moment it
// creates one -- `rowIdFor` mints a new id only the first time a reference
// is ever seen, never on every lookup.
function useRowIds<T extends object>() {
  const rowIds = useRef(new WeakMap<T, string>()).current;
  const nextId = useRef(0);
  function rowIdFor(item: T): string {
    let id = rowIds.get(item);
    if (id === undefined) {
      id = `row-${nextId.current++}`;
      rowIds.set(item, id);
    }
    return id;
  }
  function carryForward(from: T, to: T): void {
    rowIds.set(to, rowIdFor(from));
  }
  return { rowIdFor, carryForward };
}

interface GalleryImageListProps {
  prefix: 'atmosphere' | 'ourStory';
  // Used for every button/banner label below ("Move {heading} photo 1",
  // "Problems with {heading}") -- her own vocabulary for this list.
  heading: string;
  // The actual <h3> text, separate from `heading` above: StorySection
  // (AdminApp.tsx) already renders an <h2>Our Story</h2> for story.json's
  // OWN screen, and `sectionHeading` here has to read differently for the
  // ourStory list specifically, or the two collide on the identical
  // accessible name for every `role="heading"` query on the page --
  // confirmed directly (AdminApp.test.tsx's own `sectionByHeading` helper
  // could no longer tell the two apart). `heading` itself stays "Our Story"
  // everywhere else (buttons, banner) since none of those are heading-role
  // elements and none of them collide with anything.
  sectionHeading: string;
  addLabel: string;
  category: UploadCategory;
  items: GalleryImage[];
  onChange: (next: GalleryImage[]) => void;
  problems: ValidationProblem[];
  stage: (key: string, file: StagedFile | null) => void;
}

function GalleryImageList({ prefix, heading, sectionHeading, addLabel, category, items, onChange, problems, stage }: GalleryImageListProps) {
  const banner = bannerFor(problems, prefix, items.length);
  const { rowIdFor, carryForward } = useRowIds<GalleryImage>();

  function swap(index: number, otherIndex: number) {
    const next = items.slice();
    const moved = next[index];
    next[index] = next[otherIndex];
    next[otherIndex] = moved;
    onChange(next);
  }

  function patchAt(index: number, patch: Partial<GalleryImage>) {
    onChange(
      items.map((item, i) => {
        if (i !== index) return item;
        const nextItem = { ...item, ...patch };
        // Carries the row's OWN identity forward onto the fresh reference
        // this patch just created -- see useRowIds' own comment for why an
        // edit (this call) must not read as a brand new row.
        carryForward(item, nextItem);
        return nextItem;
      }),
    );
  }

  return (
    <div className="mb-8">
      <h3 className="mb-3 font-['Montserrat'] text-base text-[#222]">{sectionHeading}</h3>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label={`Problems with ${heading}`}
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
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          const rowProblems = problems.filter((p) => itemOf(prefix, p.field)?.index === index);
          // Established once per row, at render time, for EVERY row -- not
          // only inside the onStaged closure below -- so ids are assigned
          // deterministically in array order (this list's first row is
          // always "row-0"), the same identity `patchAt` already carries
          // forward across an edit.
          const rowId = rowIdFor(item);
          return (
            <li key={index} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  {!isFirst && (
                    <button
                      type="button"
                      aria-label={`Move ${heading} photo ${index + 1} up`}
                      onClick={() => swap(index, index - 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Up
                    </button>
                  )}
                  {!isLast && (
                    <button
                      type="button"
                      aria-label={`Move ${heading} photo ${index + 1} down`}
                      onClick={() => swap(index, index + 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Down
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${heading} photo ${index + 1}`}
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                  className={REMOVE_BUTTON_CLASSNAME}
                >
                  Remove
                </button>
              </div>
              <PhotoField
                id={`gallery-${prefix}-${index}-src`}
                label="Photo"
                category={category}
                value={item.src}
                // `?? ''`, never a bare `next`: GalleryImage.src is a
                // required, non-nullable string (src/content/types.ts) --
                // PhotoField's onChange is typed for DRINK_FIELDS.image's
                // OPTIONAL image too, and never actually calls back with
                // `null` on a real upload, but this keeps the type honest
                // without an unsafe cast, and a blank value here is already
                // exactly what validateGalleries' own "needs an image
                // source" message would catch.
                onChange={(next) => patchAt(index, { src: next ?? '' })}
                // Keyed on `rowId` (useRowIds' own object-reference identity,
                // established above) -- stable across BOTH a reorder (swap
                // only permutes array POSITION, never touches the object
                // itself) AND a restage on the SAME row (see useRowIds' own
                // comment for why `item.src` -- the row's own mutable
                // content, rewritten by PhotoField's onChange the instant a
                // stage succeeds -- was never a safe key for either case: a
                // reorder moved the record away from the key that named it,
                // and a second pick on the same row computed its own
                // eviction from the row's POST-first-pick src, which was
                // never the key the first pick was staged under, orphaning
                // it rather than evicting it. Confirmed directly (review
                // finding): 4 picks on one row left 3 staged files, 2 of
                // them dead weight nothing on screen could remove.
                onStaged={(staged) => stage(`galleries.json:${prefix}:${rowId}:src`, fromStagedPhoto(staged))}
                problems={rowProblems.filter((p) => itemOf(prefix, p.field)?.sub === 'src')}
              />
              <Field
                id={`gallery-${prefix}-${index}-alt`}
                spec={GALLERY_IMAGE_FIELDS.alt}
                value={item.alt}
                onChange={(next) => patchAt(index, { alt: next })}
                problems={rowProblems.filter((p) => itemOf(prefix, p.field)?.sub === 'alt')}
              />
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => onChange([...items, { src: '', alt: '' }])} className={ADD_BUTTON_CLASSNAME}>
        {addLabel}
      </button>
    </div>
  );
}

interface HeroCollageListProps {
  items: Galleries['heroCollage'];
  onChange: (next: Galleries['heroCollage']) => void;
  problems: ValidationProblem[];
  stage: (key: string, file: StagedFile | null) => void;
}

// The one entry that can never be added or removed by this screen at all --
// deliberate, not an oversight: `className` is a Tailwind grid-placement
// string another plan owns (see this component's own read-only note below),
// so a row this screen invented from nothing would need SOME className,
// and there is no neutral value that wouldn't already be a real, meaningful
// grid position. Every collage entry that exists today came from a
// developer hand-placing it; a brand new SLOT in the collage grid is a
// developer decision too.
function HeroCollageList({ items, onChange, problems, stage }: HeroCollageListProps) {
  const prefix = 'heroCollage';
  const banner = bannerFor(problems, prefix, items.length);
  const { rowIdFor, carryForward } = useRowIds<Galleries['heroCollage'][number]>();

  function swap(index: number, otherIndex: number) {
    const next = items.slice();
    const moved = next[index];
    next[index] = next[otherIndex];
    next[otherIndex] = moved;
    onChange(next);
  }

  // See useRowIds' own comment: `src` is the one mutable field this list
  // ever writes, so this is the one place that has to carry a row's own
  // identity forward onto the fresh object `{ ...row, src: next }` always
  // creates.
  function patchSrc(index: number, src: string) {
    onChange(
      items.map((row, i) => {
        if (i !== index) return row;
        const nextRow = { ...row, src };
        carryForward(row, nextRow);
        return nextRow;
      }),
    );
  }

  return (
    <div className="mb-8">
      <h3 className="mb-3 font-['Montserrat'] text-base text-[#222]">Hero collage</h3>
      {/* Review finding (Task 9): each entry's own "Layout position" (its
          className, read-only below) pins its actual place in the grid --
          moving an entry with BOTH a row and a column position already set
          (most of the real, committed entries) up or down this list
          re-orders the underlying data but changes nothing a visitor sees,
          since that position travels with the entry, not with its spot in
          this list. Kept -- not removed -- because it is NOT universally a
          no-op: an entry missing one of the two (there are real ones today)
          still falls back to the browser's own grid auto-placement, which
          DOES read the order data is written in. Said here rather than
          silently, so a reorder that visibly does nothing isn't mistaken
          for one that didn't register. */}
      <p className="mb-3 text-xs text-gray-500">
        Reordering here only changes what a visitor sees for a photo whose layout position doesn't already set BOTH
        a row and a column — most of these already do, so moving them will not change how the homepage looks.
      </p>
      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with Hero collage"
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
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          const rowProblems = problems.filter((p) => itemOf(prefix, p.field)?.index === index);
          // See GalleryImageList's own identical comment above.
          const rowId = rowIdFor(item);
          return (
            <li key={index} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  {!isFirst && (
                    <button
                      type="button"
                      aria-label={`Move Hero collage photo ${index + 1} up`}
                      onClick={() => swap(index, index - 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Up
                    </button>
                  )}
                  {!isLast && (
                    <button
                      type="button"
                      aria-label={`Move Hero collage photo ${index + 1} down`}
                      onClick={() => swap(index, index + 1)}
                      className={MOVE_BUTTON_CLASSNAME}
                    >
                      Down
                    </button>
                  )}
                </div>
              </div>
              <PhotoField
                id={`gallery-heroCollage-${index}-src`}
                label="Photo"
                category="hero"
                value={item.src}
                onChange={(next) => patchSrc(index, next ?? '')}
                // Keyed on `rowId`, not `item.src` or `index` -- identical
                // reasoning to GalleryImageList's own `src` field above (see
                // useRowIds' own comment for the restage-orphan defect this
                // avoids, on top of the reorder-eviction one Task 9 already
                // fixed).
                onStaged={(staged) => stage(`galleries.json:heroCollage:${rowId}:src`, fromStagedPhoto(staged))}
                problems={rowProblems.filter((p) => itemOf(prefix, p.field)?.sub === 'src')}
              />
              <Field
                id={`gallery-heroCollage-${index}-className`}
                spec={{
                  label: 'Layout position',
                  kind: 'readonly',
                  help: 'Controls where this photo sits in the homepage collage grid — a developer needs to change this, not the dashboard.',
                }}
                value={item.className}
                onChange={() => undefined}
                problems={rowProblems.filter((p) => itemOf(prefix, p.field)?.sub === 'className')}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GalleryList({ value, onChange, problems, stage }: GalleryListProps) {
  return (
    <div>
      <GalleryImageList
        prefix="atmosphere"
        heading="Atmosphere"
        sectionHeading="Atmosphere"
        addLabel="Add an atmosphere photo"
        category="atmosphere"
        items={value.atmosphere}
        onChange={(next) => onChange({ ...value, atmosphere: next })}
        problems={problems}
        stage={stage}
      />
      <GalleryImageList
        prefix="ourStory"
        heading="Our Story"
        sectionHeading="Our Story photos"
        addLabel="Add an Our Story photo"
        category="our_story"
        items={value.ourStory}
        onChange={(next) => onChange({ ...value, ourStory: next })}
        problems={problems}
        stage={stage}
      />
      <HeroCollageList
        items={value.heroCollage}
        onChange={(next) => onChange({ ...value, heroCollage: next })}
        problems={problems}
        stage={stage}
      />
    </div>
  );
}

export default GalleryList;
