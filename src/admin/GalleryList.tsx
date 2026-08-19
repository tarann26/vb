// galleries.json's own screen: two independently add/remove/reorder-able
// image lists (atmosphere, ourStory) plus the hero collage's photos, none of
// which fit
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
//
// Task 5: three lists, three editors, one shared open key (`openKey` below,
// state lives in `GalleryList` itself and is threaded down) -- two editors
// open at once would be two dialogs both claiming `aria-modal`, and the
// second would trap focus inside the first.
import { useRef, useState } from 'react';
import Field from './Field';
import PhotoField from './PhotoField';
import EditorSheet from './manage/EditorSheet';
import ItemList, { type ItemRow } from './manage/ItemList';
import Thumbnail from './manage/Thumbnail';
import type { ImagePreviews } from './previews';
import { GALLERY_IMAGE_FIELDS } from './fields';
import { moveTo } from './blocks/reorder';
import { fromStagedPhoto, type StagedFile } from './staged';
import { collagePhotos, setCollagePhotoSrc } from '../content/collage';
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
  // The shared preview store (previews.ts), so a row's 48px thumbnail can
  // show the photo she just picked rather than the content path PhotoField
  // optimistically wrote, which has no file behind it until the build lands.
  //
  // Passed as the store rather than as a `thumbnail?: (item) => ReactNode`
  // render prop, unlike RecordList: this component ALREADY composes the
  // staged key for each row itself (`galleries.json:<prefix>:<rowId>:src`),
  // so a caller supplying the picture would have to rebuild that key from
  // outside -- two copies of a key shape whose whole history is about a
  // key that got rebuilt slightly differently somewhere else.
  previews?: ImagePreviews;
}

// `key[i].sub` -- the third field shape src/admin/problems.ts's own header
// comment documents (an array-valued field inside a non-array file), for
// one of three different prefixes here (atmosphere/ourStory/heroCollage), so
// a fresh caller-supplied prefix is genuinely needed -- unlike HoursField.tsx's
// own HOURS_ITEM (one single, never-changing prefix), one pre-written regex
// can't cover all three without also matching each other's rows.
function itemOf(prefix: string, field: string): { index: number; sub: string } | undefined {
  const match = field.match(new RegExp(`^${prefix}\\[(\\d+)\\]\\.(.+)$`));
  return match ? { index: Number(match[1]), sub: match[2] } : undefined;
}

// Every problem that belongs to THIS list, whatever it names -- the bare
// `prefix` message (validateGalleries' "atmosphere needs at least one
// image") or any `prefix[i].sub`, in range or not. The shown/banner split
// below is what decides where each one actually renders; this is just "does
// it belong to me at all".
function relevantTo(problems: ValidationProblem[], prefix: string): ValidationProblem[] {
  return problems.filter((p) => p.field === prefix || itemOf(prefix, p.field) !== undefined);
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
// `useRef`, not module state, so atmosphere and ourStory each track
// their own rows independently -- their generated ids CAN collide as plain
// strings; the `prefix` already in every stage key below is what keeps them
// from colliding as COLLECTOR keys). GalleryImage carries no `id` of its
// own (src/content/types.ts) for this to reuse RecordList's own
// item.id-keying with, and adding one would change the committed JSON
// schema for a purely client-side bookkeeping need.
//
// The one thing this identity must survive that RecordList's `id` gets for
// free is an EDIT: `patchAt` below always builds a fresh object (never
// mutates `images` in place, the same "never reconstruct, never mutate"
// contract every write path in this codebase keeps), so the row's own
// object reference changes on every keystroke, not just a stage. Each
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

interface PhotoRowsProps {
  previews?: ImagePreviews;
  prefix: 'atmosphere' | 'ourStory';
  // Used for every button/banner label below ("Remove {heading} photo 1",
  // "Problems with {heading}") -- her own vocabulary for this list.
  heading: string;
  // The actual <h3> text, separate from `heading` above: StorySection
  // (src/admin/areas/StoryPhotosArea.tsx, moved there from AdminApp.tsx
  // when the Story & Photos area was split out) already renders an
  // <h2>About</h2> of its own on the very same area screen -- the
  // collapsible section around StoryForm, sharing this screen with
  // Galleries and Press rather than a standalone "story.json screen".
  // `sectionHeading` here has to read differently for the ourStory list
  // specifically, or the two collide on the identical accessible name for
  // every `role="heading"` query on the page -- confirmed directly
  // (AdminApp.test.tsx's own `sectionByHeading` helper could no longer
  // tell the two apart). `heading` itself stays "About" everywhere
  // else (the banner) since it is not a heading-role element and does not
  // collide with anything.
  sectionHeading: string;
  addLabel: string;
  category: UploadCategory;
  images: GalleryImage[];
  onChangeList: (next: GalleryImage[]) => void;
  problems: ValidationProblem[];
  stage: (key: string, file: StagedFile | null) => void;
  // The one shared key across all three lists -- see GalleryList's own
  // comment for why there is exactly one, not one per list.
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
}

function PhotoRows({
  prefix,
  heading,
  sectionHeading,
  addLabel,
  category,
  images,
  onChangeList,
  problems,
  stage,
  previews,
  openKey,
  setOpenKey,
}: PhotoRowsProps) {
  const { rowIdFor, carryForward } = useRowIds<GalleryImage>();

  function patchAt(index: number, patch: Partial<GalleryImage>) {
    onChangeList(
      images.map((item, i) => {
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

  const relevant = relevantTo(problems, prefix);

  // Established once per row, at render time, for EVERY row -- not only
  // inside an onStaged closure -- so ids are assigned deterministically in
  // array order (this list's first row is always "row-0"), the same
  // identity `patchAt` already carries forward across an edit.
  const rowIds = images.map((item) => rowIdFor(item));

  // The one spelling of this list's staged/preview key. Four places need it --
  // the row thumbnail, the editor's onStaged, the editor's previewKey and the
  // delete path -- and four hand-typed copies of it is exactly how a delete
  // comes to release a key nothing was ever staged under.
  function keyForRow(rowId: string): string {
    return `galleries.json:${prefix}:${rowId}:src`;
  }

  const openRowId = openKey !== null && openKey.startsWith(`${prefix}:`) ? openKey.slice(prefix.length + 1) : undefined;
  const openIndex = openRowId === undefined ? -1 : rowIds.indexOf(openRowId);
  const open = openIndex === -1 ? undefined : images[openIndex];

  // The partition Task 3 established: `shown` is everything the open
  // editor's own fields will place; `banner` is everything else, which with
  // no editor open is EVERYTHING that belongs to this list -- including the
  // bare `prefix` message and any row this list isn't currently rendering.
  const shown = open === undefined ? [] : relevant.filter((p) => itemOf(prefix, p.field)?.index === openIndex);
  const banner = relevant.filter((p) => !shown.includes(p));

  const rows: ItemRow[] = images.map((item, index) => ({
    id: rowIds[index],
    name: item.alt || 'Photo with no description yet',
    thumbnail: <Thumbnail path={item.src} previewKey={keyForRow(rowIds[index])} previews={previews} />,
    needsAttention: relevant.some((p) => itemOf(prefix, p.field)?.index === index),
  }));

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
      <ItemList
        rows={rows}
        onOpen={(id) => setOpenKey(`${prefix}:${id}`)}
        onMove={(from, to) => onChangeList(moveTo(images, from, to))}
        onAdd={() => onChangeList([...images, { src: '', alt: '' }])}
        addLabel={addLabel}
      />
      {open !== undefined && (
        <EditorSheet
          title={open.alt || 'Photo with no description yet'}
          onClose={() => setOpenKey(null)}
          onDelete={() => {
            // The removed row's staged photo goes with it, keyed exactly the
            // way this list's own onStaged below keys it -- both read
            // `rowIds[openIndex]`, the row's own identity, so the key
            // released is the key that was written. Left behind, the bytes
            // keep occupying one of the eight slots a publish allows and are
            // still SENT, an upload for a row nothing references any more.
            stage(keyForRow(rowIds[openIndex]), null);
            onChangeList(images.filter((_, i) => i !== openIndex));
            setOpenKey(null);
          }}
          deleteLabel={`Remove ${heading} photo ${openIndex + 1}`}
        >
          <PhotoField
            id={`gallery-${prefix}-${openIndex}-src`}
            label="Photo"
            category={category}
            value={open.src}
            // `?? ''`, never a bare `next`: GalleryImage.src is a
            // required, non-nullable string (src/content/types.ts) --
            // PhotoField's onChange is typed for DRINK_FIELDS.image's
            // OPTIONAL image too, and never actually calls back with
            // `null` on a real upload, but this keeps the type honest
            // without an unsafe cast, and a blank value here is already
            // exactly what validateGalleries' own "needs an image
            // source" message would catch.
            onChange={(next) => patchAt(openIndex, { src: next ?? '' })}
            // Keyed on this row's OWN identity (rowIdFor, established
            // above) -- stable across BOTH a reorder (moveTo only permutes
            // array POSITION, never touches the object itself) AND a
            // restage on the SAME row (see useRowIds' own comment for why
            // `item.src` -- the row's own mutable content, rewritten by
            // PhotoField's onChange the instant a stage succeeds -- was
            // never a safe key for either case: a reorder moved the record
            // away from the key that named it, and a second pick on the
            // same row computed its own eviction from the row's
            // POST-first-pick src, which was never the key the first pick
            // was staged under, orphaning it rather than evicting it.
            // Confirmed directly (review finding): 4 picks on one row left
            // 3 staged files, 2 of them dead weight nothing on screen
            // could remove.
            onStaged={(staged) => stage(keyForRow(rowIds[openIndex]), fromStagedPhoto(staged))}
            previews={previews}
            previewKey={keyForRow(rowIds[openIndex])}
            problems={shown.filter((p) => itemOf(prefix, p.field)?.sub === 'src')}
          />
          <Field
            id={`gallery-${prefix}-${openIndex}-alt`}
            spec={GALLERY_IMAGE_FIELDS.alt}
            value={open.alt}
            onChange={(next) => patchAt(openIndex, { alt: next })}
            problems={shown.filter((p) => itemOf(prefix, p.field)?.sub === 'alt')}
          />
        </EditorSheet>
      )}
    </div>
  );
}

interface HeroCollageListProps {
  tree: Galleries['heroCollage'];
  onChange: (next: Galleries['heroCollage']) => void;
  problems: ValidationProblem[];
  stage: (key: string, file: StagedFile | null) => void;
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
}

// The hero collage is a TREE (src/content/collage.ts), not a list, so this
// screen shows its photos flattened into document order and offers exactly
// one thing per photo: replace it. Everything structural -- where a photo
// sits, how big its box is, adding one, removing one -- happens on the
// collage itself at /edit, where she can see what she is doing, which is the
// whole point of the split tree. There is nothing here to reorder: a photo's
// position is a place in the tree, not a place in this list, so the "Up" and
// "Down" buttons this list used to carry (with a paragraph under the heading
// admitting that most of the time they changed nothing a visitor could see)
// are gone rather than reimplemented as a no-op.
//
// No `useRowIds` WeakMap here either, unlike the two lists above. That
// machinery exists because `GalleryImage` has no id of its own and the only
// other candidates -- the array index and `item.src` -- are both rewritten
// out from under a staged upload (see useRowIds' own comment for both
// failures). A `CollagePhoto` HAS an id, stable across every edit including a
// swap, so it can be the staging key and the open key directly.
function HeroCollageList({ tree, onChange, problems, stage, openKey, setOpenKey }: HeroCollageListProps) {
  const prefix = 'heroCollage';
  const photos = tree === null ? [] : collagePhotos(tree);
  const relevant = relevantTo(problems, prefix);

  const openRowId = openKey !== null && openKey.startsWith(`${prefix}:`) ? openKey.slice(prefix.length + 1) : undefined;
  const openIndex = openRowId === undefined ? -1 : photos.findIndex((photo) => photo.id === openRowId);
  const open = openIndex === -1 ? undefined : photos[openIndex];

  // This screen has never edited a collage photo's alt text -- only `src`
  // is ever rendered here (verbatim), so a `src` problem on the open row is
  // the only shape that can ever be SHOWN. Everything else -- the bare
  // `heroCollage` message, an alt problem, or a `src` problem on a row that
  // isn't open -- has nowhere else to go, so it goes to the banner. Same
  // partition as the two lists above; this list's own "shown" set is just
  // narrower, because its editor renders fewer fields.
  const shown =
    open === undefined
      ? []
      : relevant.filter((p) => itemOf(prefix, p.field)?.index === openIndex && itemOf(prefix, p.field)?.sub === 'src');
  const banner = relevant.filter((p) => !shown.includes(p));

  const rows: ItemRow[] = photos.map((photo, index) => ({
    id: photo.id,
    name: photo.alt || 'Photo with no description yet',
    needsAttention: relevant.some((p) => itemOf(prefix, p.field)?.index === index),
  }));

  return (
    <div className="mb-8">
      <h3 className="mb-3 font-['Montserrat'] text-base text-[#222]">Hero collage</h3>
      <p className="mb-3 text-xs text-gray-500">
        Replace any of these photos here. To move one, change how big it is, or add and remove photos, open the
        homepage editor — the collage is arranged there.
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
      {/* No thumbnail: it is not a list of rows, and its own editor shows
          the real photograph at real size already. */}
      <ItemList rows={rows} onOpen={(id) => setOpenKey(`${prefix}:${id}`)} />
      {open !== undefined && (
        <EditorSheet title={open.alt || 'Photo with no description yet'} onClose={() => setOpenKey(null)}>
          <PhotoField
            id={`gallery-heroCollage-${open.id}-src`}
            label="Photo"
            category="hero"
            value={open.src}
            onChange={(next) => {
              if (tree === null) return;
              onChange(setCollagePhotoSrc(tree, open.id, next ?? ''));
            }}
            // Keyed on the photo's own id -- the identity that survives a
            // reorder, a restage on the same row, and a swap that moves this
            // photo to a different box entirely.
            onStaged={(staged) => stage(`galleries.json:heroCollage:${open.id}:src`, fromStagedPhoto(staged))}
            problems={shown}
          />
        </EditorSheet>
      )}
    </div>
  );
}

function GalleryList({ value, onChange, problems, stage, previews }: GalleryListProps) {
  // `${prefix}:${rowId}`, one state for all three lists: two editors open at
  // once would be two dialogs claiming aria-modal, and the second would trap
  // focus inside the first.
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div>
      <PhotoRows
        prefix="atmosphere"
        heading="Atmosphere"
        sectionHeading="Atmosphere"
        addLabel="Add an atmosphere photo"
        category="atmosphere"
        images={value.atmosphere}
        onChangeList={(next) => onChange({ ...value, atmosphere: next })}
        problems={problems}
        stage={stage}
        previews={previews}
        openKey={openKey}
        setOpenKey={setOpenKey}
      />
      <PhotoRows
        prefix="ourStory"
        heading="About"
        sectionHeading="About photos"
        addLabel="Add an About photo"
        category="our_story"
        images={value.ourStory}
        onChangeList={(next) => onChange({ ...value, ourStory: next })}
        problems={problems}
        stage={stage}
        previews={previews}
        openKey={openKey}
        setOpenKey={setOpenKey}
      />
      <HeroCollageList
        tree={value.heroCollage}
        onChange={(next) => onChange({ ...value, heroCollage: next })}
        problems={problems}
        stage={stage}
        openKey={openKey}
        setOpenKey={setOpenKey}
      />
    </div>
  );
}

export default GalleryList;
