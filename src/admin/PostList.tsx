// posts.json's own list screen. Bespoke rather than RecordList, and forced
// rather than chosen: RecordListProps<T> wants FieldsOf<T>, and
// FieldsOf<Post> is uninhabitable because Kind<Block[]> is `never` (see
// POST_FIELDS' own comment in fields.ts, and the TS2322 the probe there
// records). So the scalars go through RecordForm<PostMeta> and the blocks go
// through BlockList -- the same split GalleryList.tsx and StoryForm.tsx
// already make for an array-valued field.
//
// Task 7: PostList moves to ItemList + EditorSheet, the same list+editor
// shape every other panel in this dashboard has taken. Open state keys on
// `post.id` -- a real id, so there is no re-pointing dance the way Task 6's
// page slug needed.
//
// Every button class string is imported from RecordList rather than retyped.
// A retyped Tailwind string is a brand-new class to the content scanner and
// ships extra CSS for a rule that already exists, which is why those three
// bindings are exported at all (RecordList.tsx's own comment says so, and
// HoursField/SectionList/StoryForm already read them).
import { useRef, useState } from 'react';
import RecordForm from './RecordForm';
import BlockList from './blocks/BlockList';
import { blockProblemOf, isBlockProblem } from './blocks/block-problems';
import { createStableNames, type StableNames } from './blocks/stable-names';
import { moveTo } from './blocks/reorder';
import { arrayIndexOf } from './problems';
import { MOVE_BUTTON_CLASSNAME } from './RecordList';
import EditorSheet from './manage/EditorSheet';
import ItemList, { type ItemRow } from './manage/ItemList';
import Thumbnail from './manage/Thumbnail';
import { POST_FIELDS, type PostMeta } from './fields';
import type { ImagePreviews } from './previews';
import type { StagedPhoto } from './PhotoField';
import type { Block, Post } from '../content/types';
import type { ValidationProblem } from '../content/validate';

export interface PostListProps {
  items: Post[];
  onChange: (index: number, next: Post) => void;
  // The id ORDER, never a reordered array: this is a controlled list and the
  // caller owns `items`, the same contract RecordList documents.
  onReorder: (ids: string[]) => void;
  // Returns the id of the post it added -- RecordList's own onAdd contract
  // (Task 3), so Add and Edit stay one surface: the list opens the editor on
  // the record it just created rather than leaving her to find it.
  onAdd: () => string;
  onRemove: (index: number) => void;
  // The FULL posts.json problem list, unfiltered. This component is the one
  // place that knows how many post forms are mounted and how many blocks each
  // one has, so it is the one place that can tell "belongs to a sibling I am
  // not rendering" from "belongs to nobody at all".
  problems: ValidationProblem[];
  onStaged: (key: string, staged: StagedPhoto | null) => void;
  previews: ImagePreviews;
}

// Written out rather than rest-destructured (`const { blocks, ...meta } =
// post`). A field added to Post is then a compile error HERE, naming this
// function, instead of a field silently missing from every post form.
function metaOf(post: Post): PostMeta {
  return {
    id: post.id,
    slug: post.slug,
    type: post.type,
    title: post.title,
    date: post.date,
    excerpt: post.excerpt,
    image: post.image,
  };
}

// A draft saved before this feature existed restores through
// registerLoaded's unchecked cast (sections/register-loaded.ts) with no
// `blocks` key at all, so this reads `undefined` at runtime while Post's
// type promises an array. The only error boundary between here and the page
// is per-SECTION, so an unguarded read would not leave her one broken field
// -- it would take the whole Posts panel down, heading included. Same
// treatment StoryForm.tsx gives a missing `chef`.
function blocksOf(post: Post): Block[] {
  return Array.isArray(post.blocks) ? post.blocks : [];
}

// The count at the top of the panel, and the sentence around it.
//
// "Publishing will be refused until..." rather than "before this can go live",
// and PublishBar.tsx's validationHeading is where that wording was settled: a
// validation problem does NOT disable the Publish button (useValidation's own
// contract is that its result may never decide what a publish is ALLOWED to
// send, only tell her sooner what the server would say), so a sentence that
// describes the button as blocked is one she can disprove by clicking it.
function problemCountSentence(count: number): string {
  return count === 1
    ? 'One thing here still needs fixing. Publishing will be refused until it is.'
    : `${count} things here still need fixing. Publishing will be refused until they are.`;
}

// Where a post's own problems live, whichever HALF of the file names them --
// a meta field (`[i].title`) or something inside its blocks (`[i].blocks...`).
// Both halves are needed for `needsAttention`, for `goToFirstProblem`'s own
// walk, and for the `shown`/`banner` partition below -- a post whose only
// problem is inside a block is not "clean" just because arrayIndexOf alone
// says so.
function ownerOf(field: string): number | undefined {
  const meta = arrayIndexOf(field);
  if (meta !== undefined) return meta;
  return blockProblemOf(field)?.post;
}

// The first thing on this panel that is complaining, in document order.
// Extracted verbatim from what used to be the WHOLE of `goToFirstProblem`
// (Task 7 Step 4) -- with the editor closed there are no field-level errors
// anywhere in the DOM for this selector to find, so `goToFirstProblem` below
// opens the offending post's editor FIRST and calls this only once React has
// had a frame to render its fields.
//
// Two shapes, because there are two ways a problem appears on this screen: a
// CONTROL whose own error region it points at (Field, PhotoField and
// InlineTextField all build `aria-describedby` ending in `-error` when, and
// only when, they have a problem to show), or ANY region announcing itself as
// an alert -- this component's own banner, RecordForm's, BlockList's, and the
// per-block and empty-list messages inside it.
//
// The control comes first for a field problem, and that ordering is not an
// accident of this selector: Field renders label, control, help, error in that
// order, so the control precedes its own message and she lands in the box she
// has to type in rather than on the sentence about it.
//
// `[role="alert"]`, and NOT `[role="alert"][tabindex="-1"]`, which is what the
// first version of this had. That version made every region's reachability
// depend on its author having remembered one attribute, and the review found
// the convention already broken by a component this panel has mounted since
// Task 4: RecordForm's own banner (RecordForm.tsx) has no tabindex, and it is
// the only place a same-index problem naming a key no control renders can go --
// validateKnownKeys' output, the shape this file's own partition comment
// below names. So she was told one thing needed fixing, offered a way to reach
// it, and the button did nothing. Matching the ROLE means a region is reachable
// because of what it is, not because somebody remembered a convention.
//
// Queried from the DOM rather than computed from `problems`, deliberately:
// mapping a problem's `field` string back to a DOM id would be a fourth
// independent copy of the id scheme (RecordForm's, BlockList's, PhotoField's),
// and the thing that needs finding is "the first one SHE can see", which is a
// fact about what rendered.
const FIRST_PROBLEM_SELECTOR = '[aria-describedby*="-error"], [role="alert"]';

export default function PostList({
  items,
  onChange,
  onReorder,
  onAdd,
  onRemove,
  problems,
  onStaged,
  previews,
}: PostListProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openIndex = openId === null ? -1 : items.findIndex((item) => item.id === openId);
  const open = openIndex === -1 ? undefined : items[openIndex];

  // One StableNames instance per post id, held here rather than inside
  // BlockList itself, and kept for as long as PostList itself is mounted --
  // which, unlike the post's own EditorSheet, is the whole time the Posts
  // panel is open. BlockList's own WeakMap lives in a `useRef`, torn down
  // the instant the component unmounts; moving the block editor inside
  // EditorSheet (this task) means it now does that on every Done, so a name
  // handed out before she closed the editor has to still mean the same
  // block when she reopens it, or a staged photo's key stops matching the
  // block it was staged on -- stable-names.ts's own comment on
  // `createStableNames` names this exactly. Keyed on `post.id` rather than
  // a WeakMap on the post object: a post's own object reference changes on
  // every keystroke (never mutated in place), but its id does not.
  const namesRef = useRef(new Map<string, StableNames>());
  function namesFor(id: string): StableNames {
    let existing = namesRef.current.get(id);
    if (existing === undefined) {
      existing = createStableNames('b');
      namesRef.current.set(id, existing);
    }
    return existing;
  }

  // The partition (D4): `shown` is everything the open editor's own
  // RecordForm or BlockList will place; `banner` is everything else, which
  // with no editor open is EVERY post's own problems -- meta and block
  // alike.
  const shown = open === undefined ? [] : problems.filter((p) => ownerOf(p.field) === openIndex);
  const banner = problems.filter((p) => !shown.includes(p));

  const rows: ItemRow[] = items.map((post, index) => ({
    id: post.id,
    name: post.title || 'Untitled post',
    thumbnail: <Thumbnail path={post.image ?? null} previewKey={`posts.json:${post.id}:image`} previews={previews} />,
    needsAttention:
      problems.some((p) => arrayIndexOf(p.field) === index) ||
      problems.some((p) => blockProblemOf(p.field)?.post === index),
  }));

  const listRef = useRef<HTMLDivElement>(null);

  // The first thing on screen that is complaining, in document order --
  // exposed for `goToFirstProblem` to call once the offending post's editor
  // has actually rendered.
  function focusFirstProblem(): void {
    const target = listRef.current?.querySelector<HTMLElement>(FIRST_PROBLEM_SELECTOR);
    if (target === null || target === undefined) return;
    // A <div> or <p> is not focusable, and `.focus()` on one is a silent
    // no-op -- which is exactly how the first version of this button came to
    // do nothing at all for a problem only RecordForm's banner could carry.
    // Made focusable HERE, at the moment she asks to be taken there, rather
    // than by every component that renders a message region remembering to
    // declare it: a region rendered by a component that has never heard of
    // this button is reachable anyway, and there is one mechanism instead of a
    // convention plus a mechanism.
    //
    // `tabindex="-1"` is programmatic focus only, never the tab order, so
    // nothing about tabbing through the panel changes. Written through the DOM
    // rather than through React, the same escape hatch PublishBar.tsx's own
    // `document.activeElement.blur()` takes and for the same reason -- React
    // never sets this attribute on these elements, so it never reconciles it
    // away, and the alternative is a prop threaded through four components
    // that have no other reason to know about it.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  }

  // Carried forward from Task 4's review as M6, and this is where it is paid.
  //
  // Every message on this panel now lands on the field that caused it, which is
  // the right place and also a long way down: seven fields per post, plus a
  // block list under each, so a problem on the third post is some twenty
  // controls below the fold with nothing at the top of the panel to say it is
  // there. "Open the panel to see" showed her post one.
  //
  // Task 7 Step 4: with fields now mounted only while their own post's editor
  // is open, the field this used to find is not in the DOM at all until she
  // has been taken to the right post. So this opens that post's editor first
  // -- if it is not already the one open -- and defers the actual DOM walk
  // (`focusFirstProblem`, above) to the frame after React has rendered it.
  function goToFirstProblem(): void {
    const firstBad = items.findIndex(
      (_, index) =>
        problems.some((p) => arrayIndexOf(p.field) === index) ||
        problems.some((p) => blockProblemOf(p.field)?.post === index),
    );
    // No post OWNS the first problem -- it is file-level (`field: ''`,
    // `validatePost`'s own "sorted newest first" shape) and lands in this
    // component's own banner above, which is mounted unconditionally
    // whether or not any editor is open. Nothing needs opening, so the walk
    // runs immediately rather than waiting on a render that was never
    // scheduled -- a literal `return` here (no per-post problem, so give up)
    // would silently drop the one shape validateContent produces with no
    // index on it at all, which this panel used to reach through the same
    // DOM walk below when every post's fields were always mounted.
    if (firstBad === -1) {
      focusFirstProblem();
      return;
    }
    if (openId !== items[firstBad].id) setOpenId(items[firstBad].id);
    // After the editor has rendered its fields, not before -- the selector
    // walk finds nothing in a DOM that has not painted them yet.
    requestAnimationFrame(() => focusFirstProblem());
  }

  return (
    <div ref={listRef}>
      {problems.length > 0 && (
        // `role="status"`, not "alert": this region's text changes on every
        // debounced revalidation while she types, and an assertive region would
        // interrupt her to read a new count each time. The problems it counts
        // are each announced by their own alert where they land.
        //
        // `role="status"` is also what keeps FIRST_PROBLEM_SELECTOR from
        // matching this region and sending her to the summary she just
        // clicked. Pinned by a test (`never sends her to the summary itself`),
        // because the selector now matches every alert region and this is the
        // one region that must stay out of it.
        <div
          role="status"
          aria-label="What still needs fixing"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <p className="mb-2">{problemCountSentence(problems.length)}</p>
          <button type="button" onClick={goToFirstProblem} className={MOVE_BUTTON_CLASSNAME}>
            Take me to the first one
          </button>
        </div>
      )}

      {banner.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with the whole list of posts"
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
        onOpen={setOpenId}
        onMove={(from, to) => onReorder(moveTo(items, from, to).map((item) => item.id))}
        onAdd={() => setOpenId(onAdd())}
        addLabel="Add a post"
      />

      {open !== undefined && (
        <EditorSheet
          title={open.title || 'Untitled post'}
          onClose={() => setOpenId(null)}
          onDelete={() => {
            onRemove(openIndex);
            setOpenId(null);
          }}
          deleteLabel={`Delete ${open.title || 'Untitled post'}`}
        >
          <div data-testid="post-form">
            <RecordForm<PostMeta>
              fields={POST_FIELDS}
              index={openIndex}
              value={metaOf(open)}
              onChange={(next) => onChange(openIndex, { ...next, blocks: blocksOf(open) })}
              problems={shown.filter((p) => !isBlockProblem(p.field))}
              onStaged={(fieldKey, staged) => onStaged(`${open.id}:${fieldKey}`, staged)}
              previews={previews}
              previewKeyPrefix={`posts.json:${open.id}`}
              scope="posts"
            />
          </div>
          <BlockList
            blocks={blocksOf(open)}
            postIndex={openIndex}
            onChange={(nextBlocks) => onChange(openIndex, { ...metaOf(open), blocks: nextBlocks })}
            problems={shown}
            previews={previews}
            onStaged={(key, staged) => onStaged(`${open.id}:${key}`, staged)}
            previewKeyPrefix={`posts.json:${open.id}`}
            names={namesFor(open.id)}
          />
        </EditorSheet>
      )}
    </div>
  );
}
