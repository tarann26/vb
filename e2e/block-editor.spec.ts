// The one claim in this sub-plan that jsdom cannot make: that a drag moves a
// block. jsdom has no drag implementation, no DataTransfer worth the name and
// no layout engine, so the unit tests deliberately assert only that the handle
// exists, is marked draggable and sits with the block it moves --
// src/admin/blocks/__tests__/BlockList.test.tsx says so in its own describe
// name. Everything about whether a drag WORKS is here.
//
// Playwright's dragTo drives real pointer events and Chromium synthesises the
// HTML5 drag sequence from them, which is the same path the owner's own mouse
// takes. That is the whole point of running this in a browser rather than
// firing a dragStart handler and calling it proof.
//
// Runs against `npm run dev` (playwright.config.ts's webServer.command), NOT
// against dist/ -- so no build in this task has any bearing on what this spec
// sees. The cursor assertion below reads an INLINE style rather than a utility
// class (BlockList.tsx says why), which as a side effect makes it immune to the
// dev JIT trap that has cost this project real time: Tailwind's dev server only
// ever adds rules within one session, so a class deleted from the source keeps
// its rule until a cold restart and an assertion on it passes on a class that is
// no longer there. If any assertion here is ever re-pointed at a class, restart
// the dev server cold before believing it.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockEditBackend } from './edit-backend';

// The route-scoped selector, never the bare attribute: every area is mounted
// from the first render and the inactive ones are merely `hidden`, so
// `[data-panel="posts"]` is in the DOM on every /edit/manage route.
// CollapsibleSection.tsx's own header comment spells this out.
const POSTS_PANEL = '[data-area="story"]:not([hidden]) [data-panel="posts"]';

// The Posts panel, open, with its fetch settled. Posts is the LAST panel of the
// Story area, so the shell's first-visit seed opens Galleries and not this one
// -- the fold state is read rather than assumed, and the click is conditional
// on it. A `.click().catch(() => undefined)` here would pass just as happily
// against a panel that never opened.
async function openPostsPanel(page: Page): Promise<Locator> {
  await mockEditBackend(page);
  await page.goto('/edit/manage/story');
  const panel = page.locator(POSTS_PANEL);
  await panel.waitFor();

  const toggle = panel.getByRole('button', { name: 'Posts', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // The real committed posts.json is what the mock serves, so the panel arrives
  // with three posts already in it and their blocks already on screen. Waiting
  // this out matters for more than flake: every locator below is scoped to the
  // post this spec adds, and "the last post" is only meaningful once the ones
  // from the file are there.
  await expect(panel.getByText(/^Loading /)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Add a post' })).toBeVisible();
  return panel;
}

// The post this spec added: the last one on the panel, found by the marker
// PostList puts on each post's own form. Scoped rather than global because the
// three posts from the real file have blocks of their own, each with its own
// handle and its own Up/Down buttons.
async function addPost(panel: Locator): Promise<Locator> {
  const before = await panel.locator('li:has([data-testid="post-form"])').count();
  await panel.getByRole('button', { name: 'Add a post' }).click();
  const posts = panel.locator('li:has([data-testid="post-form"])');
  await expect(posts).toHaveCount(before + 1);
  return posts.last();
}

// Each block's kind, read off the strip the handle sits in. The ORDER is the
// subject, so reading the kinds is enough and typing into three textareas would
// prove less.
async function kindsOf(post: Locator): Promise<string[]> {
  return post
    .locator('[data-drag-handle]')
    .evaluateAll((handles) => handles.map((handle) => handle.parentElement?.textContent?.replace('⠿', '').trim() ?? ''));
}

test.describe('the block editor', () => {
  test('a block dragged onto another one lands there, and the others slide', async ({ page }) => {
    const panel = await openPostsPanel(page);
    const post = await addPost(panel);

    await post.getByRole('button', { name: /^Heading/ }).click();
    await post.getByRole('button', { name: /^Bulleted list/ }).click();
    await post.getByRole('button', { name: /^Quote/ }).click();

    // LOOK FIRST. The starting order is read off the page and asserted against
    // what the picker was clicked in, rather than assumed -- Phase 3's e2e
    // disaster was a spec that measured a wrong baseline and reddened
    // faithfully against it for four rounds.
    await expect(post.locator('[data-drag-handle]')).toHaveCount(3);
    expect(await kindsOf(post)).toEqual(['Heading', 'Bulleted list', 'Quote']);

    // The drag: the third block's handle onto the first block's row.
    await post.locator('[data-drag-handle="2"]').dragTo(post.locator('[data-drag-handle="0"]'));

    // A MOVE, not a swap: Quote goes to the top and the other two slide down. A
    // swap would have produced ['Quote', 'Bulleted list', 'Heading'], and that
    // difference is the entire reason moveTo exists separately from swapAt.
    expect(await kindsOf(post)).toEqual(['Quote', 'Heading', 'Bulleted list']);
  });

  test('the handle shows a move cursor, which is its only affordance', async ({ page }) => {
    const panel = await openPostsPanel(page);
    const post = await addPost(panel);
    await post.getByRole('button', { name: /^Paragraph/ }).click();

    // Read off the HANDLE ITSELF, not an ancestor: `cursor` IS inherited, so
    // reading a parent would pass on a handle that had lost the class -- the
    // same reading-the-wrong-element mechanism that produced this repository's
    // eleventh unfalsifiable assertion, where a filter was asserted on an img
    // while the grayscale sat on the wrapper.
    await expect(post.locator('[data-drag-handle="0"]')).toHaveCSS('cursor', 'move');
  });

  test('the Up and Down buttons still work, because a drag is unusable on a phone', async ({ page }) => {
    const panel = await openPostsPanel(page);
    const post = await addPost(panel);
    await post.getByRole('button', { name: /^Heading/ }).click();
    await post.getByRole('button', { name: /^Quote/ }).click();

    await post.getByRole('button', { name: 'Move Heading block 1 down' }).click();
    expect(await kindsOf(post)).toEqual(['Quote', 'Heading']);
  });
});
