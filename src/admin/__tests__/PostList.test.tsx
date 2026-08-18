import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostList, { type PostListProps } from '../PostList';
import { POST_FIELDS } from '../fields';
import { NO_IMAGE_PREVIEWS, useImagePreviews } from '../previews';
import { fromStagedPhoto, useStagedFiles, type StagedFile } from '../staged';
import { convertHeic, uploadAndEncode } from '../upload-photo';
import type { StagedPhoto } from '../PhotoField';
import type { Block, Post } from '../../content/types';
import type { ValidationProblem } from '../../content/validate';

// Only the two calls that would touch the network or a WASM decoder. Every
// other export of that module, `checkPhotoSize` above all, stays REAL -- a
// caller that skips the size check re-opens the gap upload-photo.ts's own
// comment closed, and a stand-in here would hide it.
vi.mock('../upload-photo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../upload-photo')>();
  return {
    ...actual,
    convertHeic: vi.fn((file: File) => Promise.resolve(file)),
    uploadAndEncode: vi.fn(),
  };
});

// Fixtures that differ from src/content/posts.json in EVERY field asserted
// on. Phase 4's root cause was two fixtures equal to the real committed
// content, which cannot distinguish a real binding from a hardcoded copy of
// that same data -- the assertion passes either way and looks perfectly
// reasonable while doing so.
const POSTS: Post[] = [
  {
    id: 'fixture-a',
    slug: 'a-fixture-post',
    type: 'recipe',
    title: 'A fixture post',
    date: '2026-03-04',
    excerpt: 'A fixture excerpt.',
    image: '/food/tielle.webp',
    blocks: [{ kind: 'paragraph', text: 'A fixture paragraph.' }],
  },
  {
    id: 'fixture-b',
    slug: 'a-second-fixture-post',
    type: 'story',
    title: 'A second fixture post',
    date: '2026-02-01',
    excerpt: 'A second fixture excerpt.',
    image: '/food/tiramisu.webp',
    blocks: [{ kind: 'heading', text: 'A fixture heading' }],
  },
];

function renderList(overrides: Partial<PostListProps> = {}) {
  const onChange = vi.fn();
  const onReorder = vi.fn();
  const onAdd = vi.fn(() => 'new-post-id');
  const onRemove = vi.fn();
  const view = render(
    <PostList
      items={POSTS}
      onChange={onChange}
      onReorder={onReorder}
      onAdd={onAdd}
      onRemove={onRemove}
      problems={[]}
      onStaged={vi.fn()}
      previews={NO_IMAGE_PREVIEWS}
      {...overrides}
    />,
  );
  return { ...view, onChange, onReorder, onAdd, onRemove };
}

// The last `(index, next)` pair the component reported, so a test can assert
// what an edit actually commits rather than only that something was called.
function lastEdit(onChange: ReturnType<typeof vi.fn>): [number, Post] {
  const calls = onChange.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as [number, Post];
}

// A row's accessible name is its own text plus, when it has one, a trailing
// " needs attention" marker (ItemList.tsx) -- a plain-substring match keeps
// every test below from having to know or care which rows have one.
async function openRow(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
}

describe('PostList: nothing is mounted until a row is opened', () => {
  it('renders no post-form and no dialog with every editor closed', () => {
    renderList();
    expect(screen.queryByTestId('post-form')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('PostList renders one post at a time, in the open editor', () => {
  it('opening a row shows every scalar field POST_FIELDS declares, and no field for blocks', async () => {
    const user = userEvent.setup();
    renderList();
    await openRow(user, 'A fixture post');
    Object.values(POST_FIELDS).forEach((spec) => {
      expect(screen.getAllByText(spec.label, { selector: 'label' })).toHaveLength(1);
    });
    expect(screen.queryByText('Blocks', { selector: 'label' })).toBeNull();
  });

  it('binds the opened post’s own values, and only that post’s, one row at a time', async () => {
    const user = userEvent.setup();
    renderList();
    await openRow(user, 'A fixture post');
    expect(screen.getByDisplayValue('A fixture post')).toBeInTheDocument();
    expect(screen.getByDisplayValue('a-fixture-post')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('A second fixture post')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await openRow(user, 'A second fixture post');
    expect(screen.getByDisplayValue('A second fixture post')).toBeInTheDocument();
    expect(screen.getByDisplayValue('a-second-fixture-post')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('A fixture post')).toBeNull();
  });

  it('editing a scalar keeps the post’s blocks intact', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    await openRow(user, 'A fixture post');
    const title = screen.getByDisplayValue('A fixture post');
    await user.clear(title);
    await user.type(title, 'X');
    const [index, next] = lastEdit(onChange);
    expect(index).toBe(0);
    expect(next.blocks).toEqual([{ kind: 'paragraph', text: 'A fixture paragraph.' }]);
  });

  // The stale-draft defence, at the read boundary rather than left to
  // Task 10. A draft saved before blocks existed restores through
  // registerLoaded's unchecked `draftEntry.data as ContentTypeMap[K]` cast
  // with no `blocks` key at all, and the only error boundary between this
  // component and the page is per-SECTION -- so an unguarded read would take
  // the whole panel down, heading included, rather than leaving her one
  // fixable field.
  it('a post with no blocks key at all opens and edits, and gives it an empty list rather than undefined', async () => {
    const user = userEvent.setup();
    const noBlocks = { ...POSTS[0] } as Partial<Post>;
    delete noBlocks.blocks;
    const { onChange } = renderList({ items: [noBlocks as Post] });

    await openRow(user, 'A fixture post');
    const title = screen.getByDisplayValue('A fixture post');
    await user.type(title, 'X');

    const [, next] = lastEdit(onChange);
    expect(next.blocks).toEqual([]);
  });
});

describe('PostList: rows can be moved, added and deleted', () => {
  it('Move up is omitted on the first row and Move down on the last', () => {
    renderList();
    expect(screen.queryByRole('button', { name: 'Move A fixture post up' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move A fixture post down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move A second fixture post up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move A second fixture post down' })).toBeNull();
  });

  it('Move down hands back the swapped id order', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move A fixture post down' }));
    expect(onReorder).toHaveBeenCalledWith(['fixture-b', 'fixture-a']);
  });

  // D8: delete lives inside the editor and asks once. There is no Remove
  // button on a row at all any more.
  it('there is no Remove button on any row', () => {
    renderList();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('deleting a post happens inside its own editor, and asks once', async () => {
    const user = userEvent.setup();
    const { onRemove } = renderList();
    await openRow(user, 'A second fixture post');
    await user.click(screen.getByRole('button', { name: 'Delete A second fixture post' }));
    // First press only asks -- onRemove has not fired yet.
    expect(onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, delete a second fixture post' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('an untitled post is still nameable in its own row and its own delete button', async () => {
    const user = userEvent.setup();
    renderList({ items: [{ ...POSTS[0], title: '' }, POSTS[1]] });
    expect(screen.getByRole('button', { name: 'Untitled post' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Untitled post' }));
    expect(screen.getByRole('button', { name: 'Delete Untitled post' })).toBeInTheDocument();
  });

  // RecordList's own onAdd contract (Task 3): Add and Edit are one surface,
  // so the list opens the editor on the record it just added rather than
  // leaving her to find it in a list she cannot yet see it in.
  it('Add opens the editor on the new post', async () => {
    const user = userEvent.setup();
    const newPost: Post = {
      id: 'new-post-id',
      slug: '',
      type: 'story',
      title: '',
      date: '2026-01-01',
      excerpt: '',
      image: '',
      blocks: [],
    };
    const onAdd = vi.fn(() => 'new-post-id');
    const { onChange, onReorder, onRemove, rerender } = renderList({ onAdd });
    await user.click(screen.getByRole('button', { name: 'Add a post' }));
    expect(onAdd).toHaveBeenCalledTimes(1);

    // The real caller (PostsArea) commits the new post and re-renders with
    // it in `items` -- the same controlled-list contract every list in this
    // dashboard documents, and the only way a bare-component test can
    // observe an id PostList itself has no array entry for yet.
    rerender(
      <PostList
        items={[...POSTS, newPost]}
        onChange={onChange}
        onReorder={onReorder}
        onAdd={onAdd}
        onRemove={onRemove}
        problems={[]}
        onStaged={vi.fn()}
        previews={NO_IMAGE_PREVIEWS}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Untitled post' })).toBeInTheDocument();
  });

  // The mutation table's falsifiable form: `id: post.slug` resolves BOTH
  // untitled posts' blank slugs to the same string, so `findIndex` always
  // opens the FIRST one -- and React still renders a row for each (a
  // duplicate key, not a missing one), so a weaker "both have a row"
  // assertion would stay green on this exact defect.
  it('clicking the second untitled post opens the second one, not the first', async () => {
    const user = userEvent.setup();
    // Both blank in title AND slug, the same shape two posts fresh out of
    // `blankPost()` actually have -- the id/slug distinction this case
    // exists to prove only matters when both candidates collide, and a
    // slug of 'a-fixture-post' on post A would make the two distinguishable
    // by slug alone, silently hiding the defect an `id: post.slug` mutation
    // produces.
    const untitledA: Post = { ...POSTS[0], id: 'untitled-a', slug: '', title: '' };
    const untitledB: Post = { ...POSTS[1], id: 'untitled-b', slug: '', title: '' };
    renderList({ items: [untitledA, untitledB] });

    const rows = screen.getAllByRole('button', { name: 'Untitled post' });
    expect(rows).toHaveLength(2);
    await user.click(rows[1]);
    // The second post's own excerpt, distinct from the first's, is what
    // proves the SECOND record's editor opened rather than the first's.
    expect(screen.getByDisplayValue('A second fixture excerpt.')).toBeInTheDocument();
  });
});

describe('PostList: problems partition between the open editor and the list banner (D4)', () => {
  const PROBLEMS: ValidationProblem[] = [
    { field: '[0].title', message: 'the post at position 0 needs a title' },
    { field: '[0].blocks[0].text', message: 'a paragraph needs some words' },
    { field: '[0].blocks', message: 'this post has nothing in it yet' },
    // A key POST_KEYS does not know, which validateKnownKeys reports at
    // `[0].publishAt` -- the shape a stale draft produces. No field on this
    // form renders it, so RecordForm's own same-index banner is where it has
    // to land.
    { field: '[0].publishAt', message: 'this post carries something the site does not use' },
    { field: '[9].slug', message: 'a post that is not rendered here' },
    { field: '', message: 'expected a list of posts' },
  ];

  it('with every editor closed, a post’s own problem is still on screen, and marks its row', () => {
    renderList({ problems: PROBLEMS });
    const banner = screen.getByRole('alert', { name: 'Problems with the whole list of posts' });
    expect(within(banner).getByText('the post at position 0 needs a title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^A fixture post needs attention/ })).toBeInTheDocument();
  });

  it('a scalar problem lands on its own field once its post is open, not in the banner', async () => {
    const user = userEvent.setup();
    renderList({ problems: PROBLEMS });
    await openRow(user, 'A fixture post');
    const form = screen.getByTestId('post-form');
    expect(within(form).getByText('the post at position 0 needs a title')).toBeInTheDocument();
    // Claimed by the open post's own form, so it does not ALSO sit in the
    // list's banner -- which still carries the two problems nothing here
    // claims (`[9].slug` and the bare file-level message).
    const banner = screen.getByRole('alert', { name: 'Problems with the whole list of posts' });
    expect(within(banner).queryByText('the post at position 0 needs a title')).toBeNull();
    expect(within(banner).getByText('a post that is not rendered here')).toBeInTheDocument();
    expect(within(banner).getByText('expected a list of posts')).toBeInTheDocument();
  });

  // The partition, asserted in the direction that catches a double
  // display: a block problem must not ALSO appear inside the post form.
  it('a block problem is NOT shown by the post form, but IS shown by the block list', async () => {
    const user = userEvent.setup();
    renderList({ problems: PROBLEMS });
    await openRow(user, 'A fixture post');
    const form = screen.getByTestId('post-form');
    expect(within(form).queryByText('a paragraph needs some words')).toBeNull();
    expect(within(form).queryByText('this post has nothing in it yet')).toBeNull();
    expect(screen.getByText('a paragraph needs some words')).toBeInTheDocument();
    expect(screen.getByText('this post has nothing in it yet')).toBeInTheDocument();
  });

  // ...and in the direction that catches a total silent loss, which
  // RecordList's own comment calls the worse of the two -- whether or not
  // the problem's own post happens to be open.
  it('every problem in the list is on screen exactly once, whichever post is open', async () => {
    const user = userEvent.setup();
    const { container } = renderList({ problems: PROBLEMS });
    await openRow(user, 'A fixture post');
    PROBLEMS.forEach((problem) => {
      const hits = [...container.querySelectorAll('*')].filter(
        (el) => el.children.length === 0 && el.textContent === problem.message,
      );
      expect(hits.length, `"${problem.message}" appears ${hits.length} times`).toBe(1);
    });
  });

  it('a problem naming a post that is not rendered still reaches her', () => {
    renderList({
      problems: [
        { field: '[9].slug', message: 'a post that is not rendered here' },
        { field: '[9].blocks[1].text', message: 'a block of a post that is not rendered here' },
      ],
    });
    const banner = screen.getByRole('alert', { name: 'Problems with the whole list of posts' });
    expect(within(banner).getByText('a post that is not rendered here')).toBeInTheDocument();
    expect(within(banner).getByText('a block of a post that is not rendered here')).toBeInTheDocument();
  });

  it('with no posts at all, the file-level message is still on screen', () => {
    renderList({ items: [], problems: [{ field: '', message: 'expected a list of posts' }] });
    expect(screen.getByText('expected a list of posts')).toBeInTheDocument();
  });

  // The mutation table's own new case: a post can be clean on every META
  // field and still need attention, if the problem is inside one of its
  // blocks. Dropping the `blockProblemOf` half of the row's own
  // `needsAttention` would miss exactly this.
  it('a post whose only problem is inside a block still says needs attention', () => {
    renderList({ problems: [{ field: '[0].blocks[0].text', message: 'a paragraph needs some words' }] });
    expect(screen.getByRole('button', { name: /^A fixture post needs attention/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^A second fixture post needs attention/ })).toBeNull();
  });
});

describe('PostList says how much is wrong, and takes her to it', () => {
  it('says nothing when nothing is wrong', () => {
    renderList();
    expect(screen.queryByRole('status', { name: 'What still needs fixing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take me to the first one' })).toBeNull();
  });

  it('counts what is wrong, in a sentence she can act on', () => {
    renderList({
      problems: [
        { field: '[0].title', message: 'the post at position 0 needs a title' },
        { field: '[1].slug', message: 'the second post needs a web address' },
      ],
    });
    expect(screen.getByRole('status', { name: 'What still needs fixing' })).toHaveTextContent(
      '2 things here still need fixing. Publishing will be refused until they are.',
    );
  });

  it('one problem reads as one thing, not as "1 things"', () => {
    renderList({ problems: [{ field: '[0].title', message: 'the post at position 0 needs a title' }] });
    expect(screen.getByRole('status', { name: 'What still needs fixing' })).toHaveTextContent(
      'One thing here still needs fixing. Publishing will be refused until it is.',
    );
  });

  // Above the first post, which is the whole point of it: a count below the
  // rows is no better than no count. DOM order, not layout -- jsdom has no
  // layout engine and a geometry claim belongs in e2e/.
  it('sits above the first row', () => {
    const { container } = renderList({
      problems: [{ field: '[1].title', message: 'the second post needs a title' }],
    });
    const summary = screen.getByRole('status', { name: 'What still needs fixing' });
    const firstRow = container.querySelector('li');
    expect(firstRow).not.toBeNull();
    expect(summary.compareDocumentPosition(firstRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Task 7 Step 4: with fields now mounted only while their own post's
  // editor is open, the jump opens that post's editor FIRST -- there is
  // nothing to focus in a DOM that has not rendered it yet, so the
  // assertion has to wait rather than read the result of the click
  // synchronously.
  it('takes her to the field that has the problem, opening its post along the way', async () => {
    const user = userEvent.setup();
    renderList({ problems: [{ field: '[1].title', message: 'the second post needs a title' }] });
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByDisplayValue('A second fixture post')));
  });

  // ...and when the problem has no field to land on, to the message region
  // that is carrying it. `[0].blocks` with no index is the message an empty
  // block list produces, and it is exactly the shape no control can show.
  it('takes her to the message region when no field could hold the problem', async () => {
    const user = userEvent.setup();
    renderList({ problems: [{ field: '[0].blocks', message: 'this post has nothing in it yet' }] });
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    await waitFor(() => expect(document.activeElement).toHaveTextContent('this post has nothing in it yet'));
  });

  // A problem naming NO post at all (file-level, `field: ''`) has nothing to
  // open -- this component's own banner is already mounted unconditionally,
  // so the walk runs immediately rather than waiting on a render nothing
  // scheduled.
  it('takes her straight to a file-level problem, with no post to open first', async () => {
    const user = userEvent.setup();
    renderList({ problems: [{ field: '', message: 'posts must be sorted newest first' }] });
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    expect(document.activeElement).toHaveTextContent('posts must be sorted newest first');
  });

  // The summary must not be its own destination, or the button reads as broken.
  it('never sends her to the summary itself', async () => {
    const user = userEvent.setup();
    renderList({ problems: [{ field: '[1].title', message: 'the second post needs a title' }] });
    const summary = screen.getByRole('status', { name: 'What still needs fixing' });
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    await waitFor(() => expect(summary.contains(document.activeElement)).toBe(false));
  });
});

// The guard the convention was missing, and the reason it exists rather than a
// second sentence in a comment: the first version of this button matched
// `[role="alert"][tabindex="-1"]`, so a region's reachability depended on its
// author having remembered one attribute -- and the review found the convention
// already broken by RecordForm's own banner, which this panel has mounted since
// Task 4 and which is the only place a same-index problem naming a key no
// control renders can go. She was told one thing needed fixing, offered a way to
// reach it, and the button silently did nothing.
//
// One row per shape the partition can produce, so the table IS the partition.
// A shape added to validate.ts with nowhere reachable to land fails here.
const GUARD_POSTS: Post[] = [
  {
    id: 'guard-a',
    slug: 'a-guard-post',
    type: 'recipe',
    title: 'A guard post',
    date: '2026-03-04',
    excerpt: 'A guard excerpt.',
    image: '/food/tielle.webp',
    blocks: [
      { kind: 'paragraph', text: 'A guard paragraph.' },
      { kind: 'numberList', items: ['A guard step'] },
      { kind: 'bulletList', items: [] },
      { kind: 'gallery', images: [] },
    ],
  },
];

// Whatever she landed on, plus whatever that thing points at. A control carries
// no text of its own and names its error region through aria-describedby; a
// message region carries the words itself. One helper covers both, so the table
// below does not have to know which shape each row produces.
function focusedProblemText(): string {
  const active = document.activeElement as HTMLElement | null;
  if (active === null) return '';
  const described = (active.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
  return `${active.textContent ?? ''} ${described}`;
}

describe('every problem the partition can produce is reachable from the count', () => {
  const SHAPES: [string, string][] = [
    ['a scalar field she can edit', '[0].title'],
    ['a photo field', '[0].image'],
    // The finding. validateKnownKeys' output for a key no control renders --
    // its own comment says "She cannot edit this key -- no control renders
    // it" -- which lands in RecordForm's own banner and nowhere else.
    ['a key this site does not use', '[0].level'],
    ['the whole file', ''],
    ['a post that is not rendered', '[9].slug'],
    ['a block of a post that is not rendered', '[9].blocks[0].text'],
    ['a block field she can edit', '[0].blocks[0].text'],
    ['one item of a list inside a block', '[0].blocks[1].items[0]'],
    ['the block list itself', '[0].blocks'],
    ['a block she has since removed', '[0].blocks[9].text'],
    ['a key no field of a block has', '[0].blocks[0].level'],
    ['a list inside a block with nothing in it', '[0].blocks[2].items'],
    ['a photo grid with nothing in it', '[0].blocks[3].images'],
  ];

  it.each(SHAPES)('takes her to %s', async (_what, field) => {
    const user = userEvent.setup();
    const message = `something is wrong with ${field || 'the whole file'}`;
    renderList({ items: GUARD_POSTS, problems: [{ field, message }] });

    // On screen exactly once first: a shape she cannot reach is one failure and
    // a shape that is not displayed at all is a different, worse one, and
    // without this the focus assertion below could pass on neither.
    expect(screen.getAllByText(message)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));

    // Focus landed on something that can hold a problem -- not on the button
    // she pressed (which is where a silent no-op leaves it) and not on <body>
    // (whose textContent contains every message on the page and would make the
    // assertion below meaningless).
    //
    // `[data-slot]` is the fourth shape, and it arrived with Task 25's swap:
    // the block half of this panel is now editable hosts rather than
    // textareas, so the control she has to type in for a block problem is a
    // <p>, an <h2> or an <li>. `data-slot` is the writing surface's own marker
    // for one -- deliberately narrower than `isContentEditable`, which is
    // inherited and would be true of anything nested inside a host as well.
    await waitFor(() => {
      const active = document.activeElement as HTMLElement;
      expect(
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
        || active.getAttribute('role') === 'alert'
        || active.hasAttribute('data-slot'),
        `focus went to <${active.tagName.toLowerCase()}> "${(active.textContent ?? '').slice(0, 40)}"`,
      ).toBe(true);
      expect(focusedProblemText()).toContain(message);
    });
  });

  // The fifteenth shape, and it gets its own fixture rather than a row in the
  // table above, because a block whose kind this site does not have carries a
  // STANDING sentence of its own until validation replaces it -- so a post
  // containing one has an alert on screen that the count above has not counted,
  // and it would win the "first in document order" race for every row after it.
  //
  // That is a real, bounded imprecision rather than a fixture problem, and
  // keeping it out of the table is what says so: for the 400ms before
  // validation lands she can be taken to the unrecognised block instead of to
  // the newer problem. Both are things she has to fix, the window is one
  // debounce long, and the alternative -- counting a message the validator has
  // not produced -- would make the number disagree with what Publish will
  // refuse.
  it('takes her to a block whose kind this site does not have', async () => {
    const user = userEvent.setup();
    const message = 'this post contains a "wonky" block, which this site does not have';
    const withUnknown: Post[] = [
      { ...GUARD_POSTS[0], blocks: [{ kind: 'paragraph', text: 'A guard paragraph.' }, { kind: 'wonky' } as unknown as Block] },
    ];
    renderList({ items: withUnknown, problems: [{ field: '[0].blocks[1].kind', message }] });

    expect(screen.getAllByText(message)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute('role', 'alert');
      expect(focusedProblemText()).toContain(message);
    });
  });
});

// Task 7's own version of Task 4's "a link refusal is reachable while it
// lasts" case. The original proved a live refusal on ONE post's field beat a
// LATER post's own validation problem, because every post's fields used to be
// mounted at once and document order alone decided the race. That premise is
// gone: only the open post's fields exist in the DOM at all now, and opening
// a DIFFERENT post's editor to reach its problem necessarily unmounts the
// one carrying the refusal (D4 -- one editor at a time) along with it. So
// this proves the race the new architecture can still HAVE: a live refusal
// beating a validation problem further down the SAME open post's own blocks.
describe('a link refusal is reachable while it lasts, within the one editor that can be open', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('beats a block problem further down the same post, and gives the jump back once she types', async () => {
    const user = userEvent.setup();
    // Spied per-test, never globally: jsdom has no prompt, and its RETURN VALUE
    // is what this case is about.
    vi.spyOn(window, 'prompt').mockReturnValue('javascript:alert(1)');
    const message = 'this photo grid has nothing in it yet';
    const { container } = renderList({ items: GUARD_POSTS, problems: [{ field: '[0].blocks[3].images', message }] });

    // Baseline: with no refusal yet, the count sends her to the gallery
    // block's own problem.
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    await waitFor(() => expect(focusedProblemText()).toContain(message));

    // A refusal on the SAME post's paragraph, earlier in document order than
    // the gallery block below it.
    //
    // Task 25 re-points this half from InlineTextField's own per-field toolbar
    // to the writing surface's single one -- same three gates, same sentence,
    // imported rather than retyped. The surface acts on the host she was LAST
    // writing in rather than on a field it is attached to, so standing in the
    // paragraph is part of the gesture and not test scaffolding.
    const paragraph = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    fireEvent.focus(paragraph);
    const group = screen.getByRole('group', { name: 'Formatting' });
    await user.click(within(group).getByRole('button', { name: 'Link' }));
    const refusal = screen.getByText(/will not work as a link/);
    expect(refusal).toHaveAttribute('role', 'alert');

    // The imprecision, stated as a fact rather than as a comment. This post
    // was already open, so nothing needs mounting -- but `goToFirstProblem`
    // defers to `focusFirstProblem` through a `requestAnimationFrame`
    // unconditionally (Step 4), so the assertion still has to wait a tick
    // rather than read the click's result synchronously.
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    await waitFor(() => expect(document.activeElement).toBe(refusal));

    // The bound. Her next keystroke in that block ends the refusal, and the
    // count and the destination agree again. Spelled the way a browser spells
    // an edit to an editable host -- the words change, then `input` fires.
    paragraph.textContent = 'A guard paragraph, and more.';
    fireEvent.input(paragraph);
    expect(screen.queryByText(/will not work as a link/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    await waitFor(() => expect(focusedProblemText()).toContain(message));
  });
});

// The three claims the swap from BlockList to WritingSurface rests on, at the
// only level either component's props are actually composed.
//
// What jsdom cannot say is that the swap HAPPENED as a matter of what she sees
// on screen -- the caret, the marks, the column. DEFERRED TO TASK 28:
// e2e/writing-surface.spec.ts is the only check that PostList mounts the
// writing surface at all, which is why its "revert PostList.tsx to BlockList"
// mutation row reddens every test in that file.
describe('PostList hands the post’s blocks to the writing surface', () => {
  const STAGED: StagedPhoto = {
    path: 'assets-source/posts/abc123.jpg',
    contentPath: '/posts/abc123.webp',
    content: 'AAAA',
    encoding: 'base64',
  };

  beforeEach(() => {
    vi.mocked(convertHeic).mockImplementation((file: File) => Promise.resolve(file));
    vi.mocked(uploadAndEncode).mockReset();
    vi.mocked(uploadAndEncode).mockResolvedValue(STAGED);
  });

  // THE KEY THE BYTES ARE FILED UNDER, on the SECOND post rather than the
  // first, because a prefix built from the wrong post reads identically to no
  // prefix at all when only one post exists. A publish sends one file per
  // staged entry: a key nothing publishes means she uploads a picture,
  // presses Publish, and the live post names a file that was never sent --
  // a broken image on the site and an asset-existence failure on every build
  // after it.
  it('files a photo staged on the second post under that post’s own id', async () => {
    const user = userEvent.setup();
    const onStaged = vi.fn();
    renderList({ onStaged });
    await openRow(user, 'A second fixture post');

    // The surface's own picker, whose id carries the post's INDEX -- so this
    // query also fails if `postIndex` stops being the row's own position.
    const picker = document.querySelector<HTMLInputElement>('#posts-1-writing-image');
    expect(picker).not.toBeNull();
    await act(async () => {
      fireEvent.change(picker as HTMLInputElement, {
        target: { files: [new File([new Uint8Array(64)], 'photo.jpg', { type: 'image/jpeg' })] },
      });
    });

    expect(onStaged).toHaveBeenCalledTimes(1);
    const [key, staged] = onStaged.mock.calls[0] as [string, StagedPhoto];
    expect(staged.contentPath).toBe('/posts/abc123.webp');
    // Named rather than matched whole: the block's own name is minted at pick
    // time and is not something this test may assert a literal for without
    // asserting the naming scheme along with it.
    expect(key.startsWith('fixture-b:blocks[')).toBe(true);
    expect(key.endsWith('].src')).toBe(true);
    expect(key).not.toContain('fixture-a');
  });

  // ONE editor, not two. With both the old block list and the writing surface
  // mounted, every control BlockFields draws renders twice -- a `<label for>`
  // click lands on whichever came first and a screen reader cannot tell the
  // pair apart. The recipe pair is the fixture because both are drawn by
  // BlockFields on BOTH surfaces, so a duplicate here is a duplicate of a real
  // control rather than of a heading.
  //
  // The scan is over the WHOLE open editor, meta fields included, rather than
  // over the block half alone -- a second RecordForm would be as bad as a
  // second block editor and this is the only level either is visible from.
  //
  // NO CITATION BLOCK IN THIS FIXTURE, and the reason is a real collision this
  // scan found rather than a fixture convenience: POST_FIELDS.date is called
  // "Published on" (fields.ts) and so is a citation block's own date
  // (BlockFields.tsx's CITATION_DATE_SPEC), so a post carrying a citation puts
  // two controls with that one label on one screen. It predates this task --
  // BlockList drew the same field with the same words -- and renaming an
  // owner-facing label belongs to a task that owns it. Recorded here so the
  // next person to widen this scan finds the reason rather than the symptom.
  it('mounts one editor for the open post, so no two controls share a label', async () => {
    const user = userEvent.setup();
    const withRecipe: Post[] = [
      {
        ...POSTS[0],
        blocks: [
          { kind: 'heading', text: 'A fixture heading' },
          { kind: 'ingredients', heading: 'For the sauce', items: ['400g flour'] },
          { kind: 'steps', heading: 'Method', items: ['Make a well'] },
        ],
      },
      POSTS[1],
    ];
    const { container } = renderList({ items: withRecipe });
    await openRow(user, 'A fixture post');

    const labels = [...container.querySelectorAll('label')].map((el) => el.textContent ?? '');
    const duplicated = labels.filter((label, i) => labels.indexOf(label) !== i);
    expect(duplicated, `these labels appear more than once: ${[...new Set(duplicated)].join(', ')}`).toEqual([]);
    // ...and the recipe controls are genuinely there, so the scan above is
    // not passing on an editor that rendered nothing at all.
    expect(screen.getByLabelText('Heading for the ingredients')).toHaveValue('For the sauce');
    expect(screen.getByLabelText('Step 1')).toHaveValue('Make a well');
  });

  // `postIndex` is the row's OWN position. Hard-coded to 0 the surface picks
  // no problem out of the list at all for any post but the first -- and
  // PostList has already excluded it from its own banner as belonging to the
  // open editor, so the message vanishes from the screen entirely while the
  // count above still names it.
  it('routes the open post’s own block problem to its editor, whichever row it is', async () => {
    const user = userEvent.setup();
    const message = 'the second post’s heading needs some words';
    const { container } = renderList({ problems: [{ field: '[1].blocks[0].text', message }] });
    await openRow(user, 'A second fixture post');

    const hits = [...container.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && el.textContent === message,
    );
    expect(hits, `"${message}" appears ${hits.length} times`).toHaveLength(1);
    expect(screen.queryByRole('alert', { name: 'Problems with the whole list of posts' })).toBeNull();
  });

  // The blocks that come back up are the post's own, and the meta half is
  // carried across untouched -- `{ ...metaOf(post), blocks: nextBlocks }`.
  it('commits a block edit against the open post’s index, keeping its scalars', async () => {
    const user = userEvent.setup();
    const { onChange, container } = renderList();
    await openRow(user, 'A second fixture post');
    const host = container.querySelector<HTMLElement>('[data-slot]') as HTMLElement;
    host.textContent = 'A fixture heading, edited';
    fireEvent.input(host);

    const [index, next] = lastEdit(onChange);
    expect(index).toBe(1);
    expect(next.blocks).toEqual([{ kind: 'heading', text: 'A fixture heading, edited' }]);
    expect(next.title).toBe('A second fixture post');
  });
});

// THE PHOTOGRAPHS INSIDE A PHOTO GRID, ACROSS A CLOSE AND A REOPEN.
//
// The third appearance on this project of one defect: a staged photo's key is
// composed from a NAME, and the thing that mints the name was held somewhere
// that does not live as long as the name has to. Task 7 fixed it for the
// BLOCK names by holding one instance per post id up here, above the editor
// sheet. The final whole-branch review found the same hazard one level down
// and untouched -- the names of the photos INSIDE a gallery block lived in
// BlockFields' own `useRef`, two components below the sheet, so they were
// destroyed on every Done and re-minted `g1...gn` by CURRENT array position on
// reopen.
//
// Nothing below asserts a key string, for the reason BlockList.test.tsx gives:
// a test that pinned the key format would go green against a component that
// named its keys beautifully and still lost her photograph. What is asserted
// is what she would find out about -- every photo the grid names has bytes
// behind it, so a publish sends a file for every reference. A grid naming a
// derivative no file was sent for is a broken image on the live blog with
// nothing in the dashboard saying so, and then a deploy gate that refuses
// every later publish of anything.
describe('a photo she picked inside a photo grid, after she closes the editor and opens it again', () => {
  interface Sink {
    items: Post[];
    files: Record<string, StagedFile>;
  }

  // Controlled all the way up, and staged into the REAL collector every panel
  // on this dashboard shares. `renderList` above hands onChange to a spy, so
  // the list it renders never actually changes -- which is exactly the state
  // this defect cannot be seen in, because the grid never loses a photo.
  function StagedPosts({ initial, sink }: { initial: Post[]; sink: Sink }) {
    const [items, setItems] = useState<Post[]>(initial);
    const { files, stage } = useStagedFiles();
    const previews = useImagePreviews();
    sink.items = items;
    sink.files = files;
    return (
      <PostList
        items={items}
        onChange={(index, next) => setItems((prev) => prev.map((item, i) => (i === index ? next : item)))}
        onReorder={() => {}}
        onAdd={() => 'unused'}
        onRemove={() => {}}
        problems={[]}
        onStaged={(key, staged) => stage(key, fromStagedPhoto(staged))}
        previews={previews}
      />
    );
  }

  function withGrid(): Post[] {
    return [
      {
        ...POSTS[0],
        blocks: [
          {
            kind: 'gallery',
            images: [
              { src: '/food/tielle.webp', alt: 'Photo A' },
              { src: '', alt: 'Photo B' },
              { src: '', alt: 'Photo C' },
            ],
          },
        ],
      },
    ];
  }

  // The tile is found by the description SHE typed, never by position --
  // position is the thing under test. `closest('div')` from the description
  // box lands on the one wrapper BlockFields gives a tile.
  function tileFor(alt: string): HTMLElement {
    return screen.getByDisplayValue(alt).closest('div') as HTMLElement;
  }

  function pickerIn(tile: HTMLElement): HTMLInputElement {
    return tile.parentElement?.querySelector('input[type="file"]') as HTMLInputElement;
  }

  async function pick(input: HTMLInputElement, name: string, contentPath: string): Promise<void> {
    vi.mocked(uploadAndEncode).mockResolvedValueOnce({
      path: `assets-source/posts/${name}.jpg`,
      contentPath,
      content: 'AAAA',
      encoding: 'base64',
    });
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File([new Uint8Array(64)], `${name}.jpg`, { type: 'image/jpeg' })] },
      });
    });
  }

  beforeEach(() => {
    vi.mocked(convertHeic).mockImplementation((file: File) => Promise.resolve(file));
    vi.mocked(uploadAndEncode).mockReset();
  });

  // Her sequence, and every step of it is an ordinary action: three photos in
  // the grid, a picture for the second and the third, Remove on the first
  // (which is what the strip itself recommends instead of a reorder control),
  // Done, reopen, and a second thought about the last one.
  it('still has its bytes after she removes the tile above it, presses Done, and picks again', async () => {
    const user = userEvent.setup();
    const sink: Sink = { items: [], files: {} };
    render(<StagedPosts initial={withGrid()} sink={sink} />);

    await openRow(user, 'A fixture post');
    await pick(pickerIn(tileFor('Photo B')), 'bee', '/posts/bee.webp');
    await pick(pickerIn(tileFor('Photo C')), 'sea', '/posts/sea.webp');
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));

    // Still correct within this mount -- which is exactly why the defect
    // needed a close and an open to be seen at all.
    expect(Object.values(sink.files).map((file) => file.contentPath).sort()).toEqual([
      '/posts/bee.webp',
      '/posts/sea.webp',
    ]);

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await openRow(user, 'A fixture post');

    // The pick that used to destroy the photo two tiles above it: after the
    // remount, the LAST tile's key was the key Photo B's bytes were filed
    // under, and PhotoField fires `onStaged(null)` -- a hard delete from the
    // collector -- at the start of every pick, before the new upload begins.
    await pick(pickerIn(tileFor('Photo C')), 'crab', '/posts/crab.webp');

    const [block] = sink.items[0].blocks as unknown as { images: { src: string; alt: string }[] }[];
    expect(block.images.map((image) => [image.alt, image.src])).toEqual([
      ['Photo B', '/posts/bee.webp'],
      ['Photo C', '/posts/crab.webp'],
    ]);
    // Both sets of bytes still collected, and the superseded one dropped: a
    // publish sends one file per staged entry.
    expect(Object.values(sink.files).map((file) => file.contentPath).sort()).toEqual([
      '/posts/bee.webp',
      '/posts/crab.webp',
    ]);
    // Said the other way round, which is the way review measured it: no photo
    // this grid names was picked in this session without its bytes.
    const staged = new Set(Object.values(sink.files).map((file) => file.contentPath));
    expect(block.images.filter((image) => image.src.startsWith('/posts/') && !staged.has(image.src))).toEqual([]);
  });
});
