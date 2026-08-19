// The general guard, not a spot fix. Backlog items 2 and 3 are two instances
// of one defect and there is no reason to believe they are the last two: a
// label that names its field but not which entry it belongs to collides the
// moment a post has two entries of one kind. This test does not know about
// photos or citations.
import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderDashboard } from './renderDashboard';
import { contentResponse, stubFetch } from './dashboardFixtures';
import { PANELS } from '../manage/areas';
import type { Post } from '../../content/types';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// The shell harness's own stubFetch, with posts.json alone overridden --
// PostsArea.test.tsx's own pattern, so this file puts no second fetch harness
// beside the one every other dashboard test already trusts.
function stubFetchWithPosts(posts: Post[]): void {
  stubFetch();
  const base = globalThis.fetch as unknown as (input: RequestInfo | URL) => Promise<Response>;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('posts.json')) return contentResponse(posts, 'sha-posts');
      return base(input);
    }),
  );
}

// Backlog items 2 and 3, on one post: two photo entries (item 3, "a post with
// two image blocks shows two labelled 'Photo'") and a citation sitting beside
// the post's own date field (item 2, "Published on" twice).
const postWithTwoPhotosAndACitation: Post[] = [
  {
    id: 'fixture-a',
    slug: 'a-fixture-post',
    type: 'story',
    title: 'A fixture post',
    date: '2026-03-04',
    excerpt: 'A fixture excerpt.',
    image: '/food/tielle.webp',
    blocks: [
      { kind: 'image', src: '/food/tielle.webp', alt: 'A tielle' },
      { kind: 'citation', publication: 'A Magazine', url: null, date: '2026-01-01' },
      { kind: 'image', src: '/food/tiramisu.webp', alt: 'A tiramisu' },
    ],
  },
];

async function openPostEditor(posts: Post[]): Promise<void> {
  const user = userEvent.setup();
  stubFetchWithPosts(posts);
  renderDashboard('/edit/manage/story');

  await waitFor(() => {
    expect(document.querySelector('[data-area="story"]:not([hidden]) [data-panel="posts"]')).not.toBeNull();
  });
  const toggle = screen.getByRole('button', { name: PANELS.posts.heading });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  const panel = document.getElementById('section-panel-posts');
  if (panel === null) throw new Error('no panel element for posts');
  // The fetch has landed and useValidation's own debounce has settled --
  // PostsArea.test.tsx's own openPostsPanel takes the identical wait, for the
  // identical reason.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
  await user.click(await within(panel).findByRole('button', { name: posts[0].title }));
}

it('no two controls in one editor share an on-screen label', async () => {
  await openPostEditor(postWithTwoPhotosAndACitation);
  // Scoped to the OPEN EDITOR (EditorSheet's own `role="dialog"`), never the
  // whole document: the rest of the dashboard legitimately repeats a label
  // across separate records ("Shown on homepage" on every dish's own row,
  // each in its own editor) -- a collision only means something between two
  // controls she can see on screen at once, which is this one dialog.
  const dialog = screen.getByRole('dialog');
  const labels = [...dialog.querySelectorAll('label')].map((node) => node.textContent?.trim() ?? '');
  const seen = new Set<string>();
  const duplicated = labels.filter((text) => text !== '' && (seen.has(text) || (seen.add(text), false)));
  expect(duplicated).toEqual([]);
});
