import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostList, { type PostListProps } from '../PostList';
import { POST_FIELDS } from '../fields';
import { NO_IMAGE_PREVIEWS } from '../previews';
import type { Post } from '../../content/types';
import type { ValidationProblem } from '../../content/validate';

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
  const onAdd = vi.fn();
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

describe('PostList renders one form per post', () => {
  it('shows every scalar field POST_FIELDS declares, and no field for blocks', () => {
    renderList();
    Object.values(POST_FIELDS).forEach((spec) => {
      expect(screen.getAllByText(spec.label, { selector: 'label' }).length).toBe(POSTS.length);
    });
    expect(screen.queryByText('Blocks', { selector: 'label' })).toBeNull();
  });

  it('binds each post’s own values, not the first post’s twice', () => {
    renderList();
    expect(screen.getByDisplayValue('A fixture post')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A second fixture post')).toBeInTheDocument();
    expect(screen.getByDisplayValue('a-fixture-post')).toBeInTheDocument();
    expect(screen.getByDisplayValue('a-second-fixture-post')).toBeInTheDocument();
  });

  it('editing a scalar keeps the post’s blocks intact', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
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
  //
  // Asserted through what an EDIT commits, not through `not.toThrow()`: the
  // stub BlockList this task ships never reads `blocks`, so nothing would
  // throw today and a toThrow-shaped test could not fail on the mutation it
  // names (returning `post.blocks` unguarded). What that mutation really
  // costs is a post committed with `blocks: undefined`, which validatePost
  // reads as "needs a list of blocks" and assertPosts fails the build on.
  it('a post with no blocks key at all renders, and an edit gives it an empty list rather than undefined', async () => {
    const user = userEvent.setup();
    const noBlocks = { ...POSTS[0] } as Partial<Post>;
    delete noBlocks.blocks;
    const { onChange } = renderList({ items: [noBlocks as Post] });

    const title = screen.getByDisplayValue('A fixture post');
    expect(title).toBeInTheDocument();
    await user.type(title, 'X');

    const [, next] = lastEdit(onChange);
    expect(next.blocks).toEqual([]);
  });
});

describe('PostList reorders and removes', () => {
  it('Up is omitted on the first post and Down on the last', () => {
    renderList();
    expect(screen.queryByRole('button', { name: 'Move A fixture post up' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move A fixture post down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move A second fixture post up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move A second fixture post down' })).toBeNull();
  });

  it('Down hands back the swapped id order', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.click(screen.getByRole('button', { name: 'Move A fixture post down' }));
    expect(onReorder).toHaveBeenCalledWith(['fixture-b', 'fixture-a']);
  });

  it('Remove names the post it removes', async () => {
    const user = userEvent.setup();
    const { onRemove } = renderList();
    await user.click(screen.getByRole('button', { name: 'Remove A second fixture post' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('an untitled post is still nameable in its own buttons', () => {
    renderList({ items: [{ ...POSTS[0], title: '' }, POSTS[1]] });
    expect(screen.getByRole('button', { name: 'Remove Untitled post' })).toBeInTheDocument();
  });
});

describe('PostList places every problem somewhere, and only once', () => {
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

  it('a scalar problem lands on its own field, not in a banner', () => {
    renderList({ problems: PROBLEMS });
    const field = screen.getAllByText(POST_FIELDS.title.label, { selector: 'label' })[0].parentElement!;
    expect(within(field).getByText('the post at position 0 needs a title')).toBeInTheDocument();
  });

  // The partition, asserted in the direction that catches a double
  // display. RecordForm banners every unmatched same-index problem, so
  // without the filter these two messages appear on the post AS WELL AS
  // wherever BlockList puts them.
  it('a block problem is NOT shown by the post form', () => {
    renderList({ problems: PROBLEMS });
    const forms = screen.getAllByTestId('post-form');
    expect(within(forms[0]).queryByText('a paragraph needs some words')).toBeNull();
    expect(within(forms[0]).queryByText('this post has nothing in it yet')).toBeNull();
  });

  // ...and in the direction that catches a total silent loss, which
  // RecordList's own comment calls the worse of the two.
  it('every problem in the list is on screen exactly once', () => {
    const { container } = renderList({ problems: PROBLEMS });
    PROBLEMS.forEach((problem) => {
      const hits = [...container.querySelectorAll('*')].filter(
        (el) => el.children.length === 0 && el.textContent === problem.message,
      );
      expect(hits.length, `"${problem.message}" appears ${hits.length} times`).toBe(1);
    });
  });

  // The other half of "nobody is rendering it": a problem naming a post
  // beyond the end of the list, and a block problem naming one. Neither can
  // reach a mounted form or a mounted BlockList, so both belong to this
  // component's own banner -- the RecordList unclaimedProblems guarantee,
  // which no component below this one is able to keep.
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
});

// Carried forward from this task's own review as M6. Every message now lands
// on the field that caused it, which is the right place and also a long way
// down: seven fields per post plus a block list under each, so a problem on
// the third post is some twenty controls below the fold. "Open the panel to
// see" showed her post one.
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

  // Above the first post, which is the whole point of it: a count below twenty
  // fields of the post she is not looking for is no better than no count.
  // DOM order, not layout -- jsdom has no layout engine and a geometry claim
  // belongs in e2e/.
  it('sits above the first post', () => {
    const { container } = renderList({
      problems: [{ field: '[1].title', message: 'the second post needs a title' }],
    });
    const summary = screen.getByRole('status', { name: 'What still needs fixing' });
    const firstPost = container.querySelector('li');
    expect(firstPost).not.toBeNull();
    expect(summary.compareDocumentPosition(firstPost!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The half a count alone cannot do. Focus, not scroll position: a browser
  // scrolls a newly focused control into view on its own, and a scroll
  // assertion would be a layout claim jsdom cannot make.
  it('takes her to the field that has the problem, not to the top of the list', async () => {
    const user = userEvent.setup();
    renderList({ problems: [{ field: '[1].title', message: 'the second post needs a title' }] });
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    expect(document.activeElement).toBe(screen.getByDisplayValue('A second fixture post'));
  });

  // ...and when the problem has no field to land on, to the message region
  // that is carrying it. `[0].blocks` with no index is the message an empty
  // block list produces, and it is exactly the shape no control can show.
  it('takes her to the message region when no field could hold the problem', async () => {
    const user = userEvent.setup();
    renderList({ problems: [{ field: '[0].blocks', message: 'this post has nothing in it yet' }] });
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    expect(document.activeElement).toHaveTextContent('this post has nothing in it yet');
  });

  // The summary must not be its own destination, or the button reads as broken.
  it('never sends her to the summary itself', async () => {
    const user = userEvent.setup();
    renderList({ problems: [{ field: '[1].title', message: 'the second post needs a title' }] });
    const summary = screen.getByRole('status', { name: 'What still needs fixing' });
    await user.click(screen.getByRole('button', { name: 'Take me to the first one' }));
    expect(summary.contains(document.activeElement)).toBe(false);
  });
});
