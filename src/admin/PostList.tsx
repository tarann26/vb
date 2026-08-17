// posts.json's own list screen. Bespoke rather than RecordList, and forced
// rather than chosen: RecordListProps<T> wants FieldsOf<T>, and
// FieldsOf<Post> is uninhabitable because Kind<Block[]> is `never` (see
// POST_FIELDS' own comment in fields.ts, and the TS2322 the probe there
// records). So the scalars go through RecordForm<PostMeta> and the blocks go
// through BlockList -- the same split GalleryList.tsx and StoryForm.tsx
// already make for an array-valued field.
//
// Every button class string is imported from RecordList rather than retyped.
// A retyped Tailwind string is a brand-new class to the content scanner and
// ships extra CSS for a rule that already exists, which is why those three
// bindings are exported at all (RecordList.tsx's own comment says so, and
// HoursField/SectionList/StoryForm already read them).
import RecordForm from './RecordForm';
import BlockList from './blocks/BlockList';
import { isBlockProblem } from './blocks/block-problems';
import { arrayIndexOf } from './problems';
import { ADD_BUTTON_CLASSNAME, MOVE_BUTTON_CLASSNAME, REMOVE_BUTTON_CLASSNAME } from './RecordList';
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
  onAdd: () => void;
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
  // The partition, in three parts, and every problem in the file lands in
  // exactly one of them (PostList.test.tsx asserts that count directly, in
  // both directions, so a message can end up neither twice nor nowhere).
  //
  // 1. `metaProblems` minus the block half, narrowed to ONE post's own index
  //    below, is what each RecordForm sees. Narrowing by index is a
  //    deliberate departure from RecordForm's "not pre-filtered" contract and
  //    it is what stops a file-level problem (`field: ''`) appearing once per
  //    mounted form -- RecordForm's own banner keeps every problem whose
  //    index is not another rendered index, which for a bare `''` means all
  //    of them. RecordForm still banners a same-index problem naming a key
  //    this form does not render, which is the shape a stale draft's unknown
  //    key produces and the reason that filter is by index rather than by
  //    matched field.
  // 2. The block half goes to BlockList, whole: it filters by post itself.
  // 3. Whatever no mounted form and no mounted BlockList could have claimed
  //    -- a file-level rule, or a post index this list is not rendering --
  //    goes in this component's own banner. That is the RecordList
  //    unclaimedProblems guarantee, and only this component can keep it,
  //    because only this component knows how many posts are mounted.
  const metaProblems = problems.filter((p) => !isBlockProblem(p.field));
  const unclaimed = problems.filter((p) => {
    const owner = arrayIndexOf(p.field);
    return owner === undefined || owner >= items.length;
  });

  function swap(index: number, otherIndex: number): void {
    const ids = items.map((item) => item.id);
    const moved = ids[index];
    ids[index] = ids[otherIndex];
    ids[otherIndex] = moved;
    onReorder(ids);
  }

  return (
    <div>
      {unclaimed.length > 0 && (
        <div
          role="alert"
          aria-label="Problems with the whole list of posts"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <ul className="list-disc pl-5">
            {unclaimed.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}

      <ul>
        {items.map((post, index) => {
          const name = post.title || 'Untitled post';
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          return (
            <li key={post.id} className="mb-6 rounded border border-gray-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Thumbnail
                    path={post.image ?? null}
                    previewKey={`posts.json:${post.id}:image`}
                    previews={previews}
                  />
                  {/* Omitted at the ends, not disabled -- RecordList's own
                      rule, and its reasoning applies unchanged: a control
                      that reads as live and does nothing is worse than no
                      control. */}
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
              <div data-testid="post-form">
                <RecordForm<PostMeta>
                  fields={POST_FIELDS}
                  index={index}
                  value={metaOf(post)}
                  onChange={(next) => onChange(index, { ...next, blocks: blocksOf(post) })}
                  problems={metaProblems.filter((p) => arrayIndexOf(p.field) === index)}
                  onStaged={(fieldKey, staged) => onStaged(`${post.id}:${fieldKey}`, staged)}
                  previews={previews}
                  previewKeyPrefix={`posts.json:${post.id}`}
                  scope="posts"
                />
              </div>
              <BlockList
                blocks={blocksOf(post)}
                postIndex={index}
                onChange={(nextBlocks) => onChange(index, { ...metaOf(post), blocks: nextBlocks })}
                problems={problems}
                previews={previews}
                onStaged={(key, staged) => onStaged(`${post.id}:${key}`, staged)}
                previewKeyPrefix={`posts.json:${post.id}`}
              />
            </li>
          );
        })}
      </ul>

      {/* `() => onAdd()`, not `onAdd` -- onClick would forward the DOM
          MouseEvent as the first argument, which does not match this
          component's own no-argument contract. RecordList documents the
          same trap. */}
      <button type="button" onClick={() => onAdd()} className={ADD_BUTTON_CLASSNAME}>
        Add a post
      </button>
    </div>
  );
}
