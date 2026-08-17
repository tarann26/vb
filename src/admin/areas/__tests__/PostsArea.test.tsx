// The panel, mounted inside the real shell rather than in isolation: the
// thing most likely to break here is the seam (fetchContent's generic,
// registerLoaded's file key, useValidation's file key), and every one of
// those is only exercised by a real mount.
//
// The wait is the ROUTE-SCOPED selector CollapsibleSection.tsx's own comment
// specifies -- `[data-area="story"]:not([hidden]) [data-panel="posts"]`, never
// the bare attribute, which is already true at first paint on every route
// because the shell mounts all five areas and hides four of them. Then the
// panel is OPENED (it is not the first panel of its area, so it starts
// folded and a role query cannot see inside a `hidden` subtree), and only
// then is anything that arrives with a fetch asserted -- with findBy, so it
// has something left to retry.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderDashboard } from '../../__tests__/renderDashboard';
import { contentResponse, stubFetch } from '../../__tests__/dashboardFixtures';
import { PANELS } from '../../manage/areas';
import { POST_FIELDS } from '../../fields';
import type { Post } from '../../../content/types';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// Built on the shell harness's own stubFetch by overriding ONE path, rather
// than inventing a second harness: a stub that answers only posts.json puts
// twelve "Could not load" banners on screen and shifts everything this file
// measures.
function stubFetchWith(postsAnswer: () => Response): void {
  stubFetch();
  const base = globalThis.fetch as unknown as (input: RequestInfo | URL) => Promise<Response>;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('posts.json')) return postsAnswer();
      return base(input);
    }),
  );
}

function stubFetchWithPosts(posts: Post[]): void {
  stubFetchWith(() => contentResponse(posts, 'sha-posts'));
}

// The shape worker/index.ts's handleGetContent answers for a path with no
// blob behind it, message and all -- content.ts turns exactly this into a
// ContentNotFoundError.
function stubFetchNotFound(): void {
  stubFetchWith(() => new Response(JSON.stringify({ message: 'that file is not in the repository' }), { status: 404 }));
}

function stubFetchFailing(status: number, message: string): void {
  stubFetchWith(() => new Response(JSON.stringify({ message }), { status }));
}

const FIXTURE_POSTS: Post[] = [
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
];

async function openPostsPanel(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(document.querySelector('[data-area="story"]:not([hidden]) [data-panel="posts"]')).not.toBeNull();
  });
  // Posts is not its area's first panel (galleries is, deliberately -- see
  // areas.ts), so it is folded on arrival and every role query below would
  // refuse to look inside it. Opened the same way panel-snapshots.test.tsx
  // opens one, for the same reason.
  const toggle = screen.getByRole('button', { name: PANELS.posts.heading });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  const panel = document.getElementById('section-panel-posts');
  if (panel === null) throw new Error('no panel element for posts');
  // The same settle panel-snapshots.test.tsx and owner-facing-labels.test.tsx
  // both take, for the same two reasons and one more. The fetch has landed
  // and useValidation's 400ms debounce has definitively fired, so a problem
  // banner cannot arrive one tick after an assertion; and
  // CollapsibleSection's own MutationObserver -- which re-reads the subtree
  // for a `role="alert"` on every DOM change inside it -- has run its
  // resulting setState INSIDE act rather than after the test ended, which is
  // where React's "not wrapped in act" warning comes from.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
  return panel;
}

describe('the Posts panel', () => {
  it('renders every committed post it is given', async () => {
    stubFetchWithPosts(FIXTURE_POSTS);
    renderDashboard('/edit/manage/story');

    const panel = await openPostsPanel();
    expect(await within(panel).findByDisplayValue('A fixture post')).toBeInTheDocument();
    expect(within(panel).getByDisplayValue('a-fixture-post')).toBeInTheDocument();
  });

  it('a 404 reads as no posts yet, not as a failure', async () => {
    stubFetchNotFound();
    renderDashboard('/edit/manage/story');

    const panel = await openPostsPanel();
    expect(await within(panel).findByRole('button', { name: 'Add a post' })).toBeInTheDocument();
    expect(within(panel).queryByText(/Could not load posts/)).toBeNull();
  });

  it('a real failure says so, in its own field, without taking the heading down', async () => {
    stubFetchFailing(502, 'GitHub is unreachable');
    renderDashboard('/edit/manage/story');

    const panel = await openPostsPanel();
    // The heading survives, which is the Phase 4 lesson: a panel that throws
    // takes SectionErrorBoundary's whole subtree, heading included.
    expect(screen.getByRole('heading', { name: PANELS.posts.heading })).toBeInTheDocument();
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/Could not load posts.*GitHub is unreachable/);
  });

  it('Add a post produces a record whose problems name what it still needs, dated by the restaurant’s clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-04T20:30:00Z'));
    const user = userEvent.setup();
    stubFetchWithPosts([]);
    renderDashboard('/edit/manage/story');

    const panel = await openPostsPanel();
    await user.click(await within(panel).findByRole('button', { name: 'Add a post' }));

    // Every problem the validator raises for a blank post, each on its own
    // field or in the block banner -- never a single "something is wrong".
    expect(await within(panel).findByText(/needs a web address/)).toBeInTheDocument();
    expect(within(panel).getByText(/needs a title/)).toBeInTheDocument();
    expect(within(panel).getByText(/needs a short summary/)).toBeInTheDocument();
    expect(within(panel).getByText(/needs a photo for its card/)).toBeInTheDocument();
    expect(within(panel).getByText(/has nothing in it yet/)).toBeInTheDocument();

    // The one field that is pre-filled, and the reason it is: an empty date
    // input tells her nothing about the format it wants.
    //
    // Asserted against the RESTAURANT's clock, at a frozen instant chosen to
    // sit inside the window where UTC and IST disagree (20:30 UTC on the 4th
    // is 02:00 IST on the 5th). Two weaker assertions stood here first -- a
    // format regex and the absence of "needs a date like" -- and neither
    // could fail on the bug that was actually in the code: POST_DATE_PATTERN
    // (validate.ts) is that same regex, so both accepted any well-formed
    // date, including yesterday's. This one pins the day itself, which is the
    // only thing that distinguishes todayInKolkata() from
    // `new Date().toISOString()`.
    //
    // `toFake: ['Date']` rather than the whole timer set, and that is what
    // makes this assertion deterministic instead of a test that only reddens
    // between midnight and 05:30 IST: Date is frozen, while setTimeout stays
    // real so userEvent's own delays, useValidation's 400ms debounce and the
    // settle above all still work normally.
    const date = within(panel).getByLabelText(POST_FIELDS.date.label) as HTMLInputElement;
    expect(date.value).toBe('2026-03-05');
  });
});
