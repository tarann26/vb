// Everything about the writing surface that jsdom cannot honestly assert.
//
// This file is the closing gate of Section B and it is the ONLY check on most
// of what Tasks 13-27 built. Selection, caret, paste, undo, focus and geometry
// were deferred here by every implementer who could not honestly assert them
// -- 36 claims, recorded one line each in the task reports under
// .superpowers/sdd/2026-08-18-admin-redesign/. Each test below names the claim
// or claims it stands in for and the mutation that reddens it.
//
// TWO STANDING HAZARDS, both met on this project before.
//
// 1. THE TAILWIND JIT NEVER REMOVES A RULE WITHIN A DEV-SERVER SESSION. An
//    assertion pointed at a CLASS NAME therefore goes on passing after the
//    class has been deleted from the source, until the server is restarted
//    cold. Every assertion below reads a COMPUTED style or a bounding box
//    instead, which is a fact about the frame that was painted and not about
//    a string that survived in a cache. e2e/block-editor.spec.ts:19-23 carried
//    this warning before it was deleted; it applies here unchanged.
//
// 2. A BROWSER TEST THAT SILENTLY PASSES IS INDISTINGUISHABLE FROM COVERAGE.
//    Five unfalsifiable assertions have shipped on this project, the most
//    recent an Undo case that stayed green while the code was broken because
//    two earlier steps in the same history made Undo land on an array that
//    passed the identity check by coincidence. Every test here was reddened by
//    hand against a real mutation of the production line it names; the ones
//    that could not be are listed at the foot of this file rather than left as
//    green with nothing behind it.
//
// The real, committed posts.json is the fixture (e2e/edit-backend.ts serves
// the file on disk), and the post these tests open is SEARCHED FOR by the
// blocks it carries (`postWithBlocks`, below) rather than taken from row 0 --
// so nothing here depends on a hand-built block the product never produces,
// and nothing here depends on which post happens to be first.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockEditBackend, postWithBlocks, realContentJson } from './edit-backend';

// The route-scoped selector CollapsibleSection.tsx:123 specifies, never the
// bare `[data-panel="posts"]`: the shell mounts all five areas and hides four,
// so the bare attribute matches on every route.
const POSTS_PANEL = '[data-area="story"]:not([hidden]) [data-panel="posts"]';

// The post these tests write in, found by its SHAPE rather than by its
// position. Backlog item 20: every helper below used to reach for row 0 and
// assume it held a paragraph and a citation, so a new post landing at the top
// of posts.json would have broken the block-label assertions far from the
// change that caused it. `postWithBlocks` throws a sentence naming what it
// wanted if no committed post has both, which is the point -- a fallback to
// row 0 would put the assumption straight back.
const WRITING_POST = postWithBlocks(['paragraph', 'citation']);

// A run of WRITING_POST's own committed paragraph, READ rather than retyped,
// so the published page below is found by words this post actually carries
// whichever post `postWithBlocks` picked. The longest word in it is used, not
// a fixed prefix: a single word cannot straddle inline markdown, so what is
// matched against the rendered page is a string that renders verbatim.
const WRITING_POST_WORDS = (() => {
  const posts = JSON.parse(realContentJson('posts.json')) as Array<{
    slug: string;
    blocks: Array<{ kind: string; text?: string }>;
  }>;
  const source = posts.find((post) => post.slug === WRITING_POST.slug)?.blocks
    .find((block) => block.kind === 'paragraph')?.text ?? '';
  const words = source.split(/[^A-Za-z]+/).filter((word) => word.length > 0);
  const longest = words.reduce((best, word) => (word.length > best.length ? word : best), '');
  if (longest.length < 6) throw new Error(`${WRITING_POST.slug}'s paragraph has no word long enough to match on`);
  return longest;
})();

// A real 1x1 PNG. `convertHeic` passes a PNG straight through and
// `checkPhotoSize` is nowhere near its 5MB cap, so the only thing standing
// between this and an inserted image block is the upload route mocked below.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// ---------------------------------------------------------------------------
// Step 1's scaffold.

async function openPostsPanel(page: Page): Promise<Locator> {
  await mockEditBackend(page);
  await page.goto('/edit/manage/story');
  const panel = page.locator(POSTS_PANEL);
  // Posts is the LAST panel of its area (areas.ts:154), so it arrives folded
  // and every role query would refuse to look inside it.
  const toggle = panel.getByRole('button', { name: 'Posts', exact: true });
  await toggle.waitFor();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return panel;
}

// "Add a post" -- kept because the brief's Step 1 names it, and because the
// state it produces is worth a test of its own (see the one that uses it). It
// is deliberately NOT the fixture for the writing tests, which want a post
// with a paragraph AND a citation in it: a blank post carries one empty
// paragraph and nothing else.
async function addPost(page: Page): Promise<Locator> {
  const panel = await openPostsPanel(page);
  await panel.getByRole('button', { name: 'Add a post' }).click();
  return panel;
}

// The row for WRITING_POST, addressed by the title on it rather than by where
// it sits in the list.
function writingPostRow(panel: Locator): Locator {
  return panel.locator('[data-item-row]').filter({ hasText: WRITING_POST.title }).getByRole('button').first();
}

// Opens WRITING_POST's editor and returns the writing surface's own root --
// the element that holds the toolbar, so a locator built on it can never
// wander into the row list above or the publish bar below.
async function openWriting(page: Page): Promise<Locator> {
  const panel = await openPostsPanel(page);
  await writingPostRow(panel).click();
  const surface = panel.locator('div:has(> [role="group"][aria-label="Formatting"])');
  await expect(surface.locator('[data-slot]').first()).toBeVisible();
  return surface;
}

function hosts(page: Page): Locator {
  return page.locator(`${POSTS_PANEL} [data-slot]`);
}

// The text of every `[data-slot]` host in document order -- the whole column,
// not one element. Every assertion about an edit reads this rather than one
// host, because the failure this file exists to catch is a column that agrees
// with the array in one place and disagrees in another.
async function slots(page: Page): Promise<string[]> {
  return hosts(page).allTextContents();
}

// Collapse to the start or the end of the host she is standing in, HER way:
// a select-all inside the editing host followed by one arrow key, which is
// what a browser collapses a selection with. Deliberately not Cmd+Home /
// Cmd+End -- neither is a macOS text-editing binding, and Chromium answers
// both by scrolling the document while the caret stays exactly where it was.
// Measured: with Cmd+Home standing in for "go to the top", typing "1." landed
// at the END of the paragraph and no conversion fired at all, which reads as a
// broken autoformat rather than as a broken test.
async function toStart(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ArrowLeft');
}

async function toEnd(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ArrowRight');
}

// Somewhere on the surface that is not a control and not a host, for the
// clicks that exist to take her OUT of her words. Not the toolbar row: it is
// a full-width flex-wrap of thirteen controls and its own centre pixel is a
// button, so `click()` on it presses whichever one happens to be in the
// middle. Measured: it pressed Bulleted list, and the block under test
// silently became a list.
function awayFromTheWords(surface: Locator): Locator {
  return surface.getByText('Add to this post', { exact: true });
}

// Replace the first paragraph's words with known ones. Cmd+A inside an
// editable host selects that host's own contents (the editing host is the
// boundary) and the surface deliberately leaves Cmd+A to the browser
// (WritingSurface.tsx:1016-1019), so this is her own select-all, not a
// scripted range.
async function writeFirst(page: Page, words: string): Promise<Locator> {
  const host = hosts(page).first();
  await host.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(words);
  await expect(host).toHaveText(words);
  return host;
}

// Close the first post's editor and open it again, which UNMOUNTS the surface
// and mounts a fresh one over the same draft. It is the only way to see what a
// commit actually SAVED: the layout effect's memo is keyed on the element and
// remembers what it was told the host holds, so a host whose DOM the browser
// changed underneath a commit is never rewritten while it is on screen. A
// remount has no memo and no elements, so every host is written from the array.
async function reopenTheWritingPost(page: Page): Promise<void> {
  const panel = page.locator(POSTS_PANEL);
  // The editor is EditorSheet's own `fixed inset-0` dialog, so the row list
  // behind it is not clickable until Done has closed it -- measured, a click
  // aimed at a row lands on the overlay.
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel.locator('[role="dialog"]')).toHaveCount(0);
  await writingPostRow(panel).click();
  await expect(hosts(page).first()).toBeVisible();
}

// The collapsed caret's own position, read off the real selection: which host
// it is in, how far into that host's text, and what is selected. Nothing in
// jsdom can answer any of the three about a painted caret.
async function caret(page: Page): Promise<{ slot: string | null; offset: number; selected: string }> {
  return page.evaluate(() => {
    const selection = document.getSelection();
    if (selection === null || selection.rangeCount === 0) return { slot: null, offset: -1, selected: '' };
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const el = node instanceof Element ? node : node.parentElement;
    const host = el?.closest('[data-slot]') ?? null;
    // Characters before the caret WITHIN the host, which is the only offset
    // that means anything once a host holds more than one text node.
    let offset = -1;
    if (host !== null) {
      const measured = document.createRange();
      measured.selectNodeContents(host);
      measured.setEnd(range.startContainer, range.startOffset);
      offset = measured.toString().length;
    }
    return { slot: host?.getAttribute('data-slot') ?? null, offset, selected: selection.toString() };
  });
}

async function activeName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return 'BODY';
    return el.getAttribute('aria-label') ?? el.getAttribute('data-slot') ?? el.tagName;
  });
}

// e2e/dashboard-sections.spec.ts:45's own helper, restated: measure and
// hit-test in ONE evaluation so both read the same frame.
async function hitTestSelf(locator: Locator): Promise<boolean> {
  // Scroll it into view FIRST, exactly as e2e/edit-dashboard-link.spec.ts:32
  // does. `document.elementFromPoint` answers only for coordinates inside the
  // viewport and returns null for anything below the fold -- so without this
  // the assertion reads "something is covering the image" when the truth is
  // "the image is off-screen", which is a different claim and not the one
  // this test makes. Measured while it was absent: the image's centre sat at
  // y~694 in an 800px viewport with rect.y drifting 441-454 between runs, so
  // roughly 110px of extra content above it was enough to flip the result.
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((el) => {
    const rect = el.getClientRects()[0] ?? el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  });
}

// ---------------------------------------------------------------------------
test.describe('the writing surface', () => {
  // -------------------------------------------------------------------------
  // Enter, Backspace and the keys the surface suppresses.

  // Deferred claim 6 (Tasks 18-19): "jsdom implements no default action for a
  // key in an editable host, so 'Enter did not split the tree underneath the
  // array' is only provable in a browser."
  //
  // Mutation: drop `event.preventDefault()` from the Enter branch
  // (WritingSurface.tsx:1074). Chromium's own Enter then splits the host's
  // subtree as well, and the tree the array is supposed to own grows an
  // element nothing in the array corresponds to.
  test('Enter splits a paragraph and leaves no line break behind', async ({ page }) => {
    await openWriting(page);
    await writeFirst(page, 'AlphaBeta');

    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');

    expect(await slots(page)).toEqual(['Alpha', 'Beta']);
    // The whole point: the split is the ARRAY's, so the tree underneath it
    // holds words and nothing else. A `<br>` or a `<div>` here is Chromium's
    // own Enter having run as well.
    expect(
      await hosts(page).evaluateAll((els) =>
        els.flatMap((el) => [...el.querySelectorAll('*')].map((child) => child.tagName)),
      ),
    ).toEqual([]);
    // And her caret is in the new block, at its top, ready for the next word.
    expect(await caret(page)).toEqual({ slot: expect.stringMatching(/\/text$/), offset: 0, selected: '' });
  });

  // Deferred claims 1, 2 and 7 (Task 17: "caret survival across a commit" and
  // "what the focused-host rule buys"; Tasks 18-19: "that the caret is visible
  // where it was placed, and stays there"). Merged: they are three statements
  // of one fact, and one keystroke sequence proves or disproves all three.
  //
  // Mutation: drop `if (focusedRef.current === address) return;` from the
  // layout effect (WritingSurface.tsx:562). Every commit then rewrites the
  // host she is standing in, the caret falls to the end, and this reads 'acb'.
  test('the caret stays where she is typing across a commit', async ({ page }) => {
    await openWriting(page);
    const host = await writeFirst(page, 'ac');

    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('b');

    await expect(host).toHaveText('abc');
    expect((await caret(page)).offset).toBe(2);
  });

  // Deferred claim 11 (Tasks 18-19): "typing fast across a split or a
  // conversion -- both re-render inside the key handler; whether a keystroke
  // is dropped in that window is a browser fact." Also the second half of
  // claim 2.
  //
  // No delay at all between presses, which is the only thing that makes this
  // different from the tests above: the re-render an Enter or a conversion
  // schedules is the window a dropped keystroke falls into.
  test('typing fast across a split and across a conversion drops no keystroke', async ({ page }) => {
    await openWriting(page);
    await writeFirst(page, 'x');

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('ab\ncd', { delay: 0 });
    expect(await slots(page)).toEqual(['ab', 'cd']);

    // And across an autoformat conversion, which replaces the host's element
    // outright rather than only its words.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('1. Rosemary', { delay: 0 });
    expect(await slots(page)).toEqual(['ab', 'Rosemary']);
  });

  // Deferred claim 6's other half: "the space was never inserted".
  //
  // Mutations, both applied: drop the `numberList` entry from
  // autoformat.ts's TRIGGERS (no list at all), and drop
  // `event.preventDefault()` from the space branch
  // (WritingSurface.tsx:1028) -- Chromium then inserts the space into the
  // host as well, so the trigger characters are not gone.
  //
  // NOTE ON THE BRIEF'S MUTATION TABLE: it names
  // `lastWritten.current.delete(...)` as the line to revert here. That line
  // does not exist and deliberately never did -- Task 18-19's report records
  // that Task 17 keyed the written-value memo on the ELEMENT, so a conversion
  // (which changes the host's tag) always produces an element the memo has
  // never seen and is always written. A `delete` there would have been a line
  // nothing could redden.
  test('typing "1." and a space starts a numbered list and the characters are gone', async ({ page }) => {
    const surface = await openWriting(page);
    await writeFirst(page, 'Rosemary');

    await toStart(page);
    await page.keyboard.type('1.');
    await page.keyboard.press(' ');

    // Both halves. A numbered list exists...
    const list = surface.locator('ol');
    await expect(list).toHaveCount(1);
    await expect(list.locator('li[data-slot]')).toHaveText(['Rosemary']);
    // ...and it is numbered by the browser, not by characters left in her
    // words. `list-style-type` is the computed fact; the class name that sets
    // it is exactly what the JIT hazard above forbids reading.
    await expect(list).toHaveCSS('list-style-type', 'decimal');
    // ...AND nothing on the surface still says "1.".
    expect((await slots(page)).join(' ')).not.toContain('1.');
  });

  test('Enter on an empty list item leaves the list', async ({ page }) => {
    const surface = await openWriting(page);
    await writeFirst(page, 'Rosemary');
    await toStart(page);
    await page.keyboard.type('- ');
    await expect(surface.locator('ul[class*="list-disc"] li[data-slot]')).toHaveText(['Rosemary']);

    await toEnd(page);
    await page.keyboard.press('Enter');
    await expect(surface.locator('ul[class*="list-disc"] li[data-slot]')).toHaveCount(2);
    // The second press, on the empty item she just made: it takes her out of
    // the list rather than making a third.
    await page.keyboard.press('Enter');

    await expect(surface.locator('ul[class*="list-disc"] li[data-slot]')).toHaveCount(1);
    // She is standing in a paragraph now, outside the list, and it is empty
    // and ready for the next thing she writes.
    const where = await caret(page);
    expect(where.slot).toMatch(/\/text$/);
    expect(
      await hosts(page).evaluateAll((els) => els.map((el) => el.tagName)),
    ).toEqual(['LI', 'P']);
  });

  // Deferred claim 9 (Tasks 18-19): "Backspace over a selection deletes the
  // selection. We prove only that the surface stands aside."
  //
  // Mutation: `event.preventDefault()` unconditionally at the top of the
  // Backspace branch (WritingSurface.tsx:1084) -- the surface stops standing
  // aside and the selected words survive.
  test('Backspace over a selection deletes the selection', async ({ page }) => {
    await openWriting(page);
    const host = await writeFirst(page, 'Alpha Beta Gamma');

    // A real shift-selection of the last word, made with her keyboard.
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('Shift+ArrowLeft');
    expect((await caret(page)).selected).toBe('Gamma');
    await page.keyboard.press('Backspace');

    await expect(host).toHaveText('Alpha Beta ');
  });

  // Deferred claim 8 (Tasks 18-19): "Shift+Enter really makes a line break.
  // Left untouched deliberately; the resulting break element is a browser's
  // doing."
  //
  // Mutation: drop `&& !event.shiftKey` from the Enter branch
  // (WritingSurface.tsx:1069) -- Shift+Enter is then swallowed and split like
  // a plain Enter, and no break element is ever made.
  test('Shift+Enter makes a real line break, and it saves as a space', async ({ page }) => {
    await openWriting(page);
    const host = await writeFirst(page, 'AlphaBeta');

    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+Enter');

    // The browser's own break element, in her block, and NOT a second block.
    await expect(host.locator('br')).toHaveCount(1);
    expect(await hosts(page).count()).toBe(1);

    // dom-inline.ts reads a break back as a space, so what she publishes is
    // one paragraph with a gap in it. Proved by leaving the host and coming
    // back, which is what makes the layout effect rewrite it from the array.
    await reopenTheWritingPost(page);
    await expect(hosts(page).first()).toHaveText('Alpha Beta');
  });

  // Deferred claim 10 (Tasks 18-19): "the revert's caret when the conversion
  // happened mid-text". This is a KNOWN LIMIT, pinned rather than wished away
  // -- `revertFormat` puts the caret at the end of the restored paragraph, so
  // a conversion reverted with words still to the right of it leaves her at
  // the end of them and not after the space she typed. Pinned so that a later
  // task fixing it is told, rather than finding this file green either way.
  //
  // Mutation: change the revert's `offset` from 'start' to 'end'
  // (WritingSurface.tsx:1098 hands `'start'`, which `applyEdit` reads as the
  // caret's own end -- flip either and the typed X lands somewhere else).
  test('a conversion reverted mid-text leaves her at the end of the restored paragraph', async ({ page }) => {
    await openWriting(page);
    const host = await writeFirst(page, 'rest');

    await toStart(page);
    await page.keyboard.type('1.');
    await page.keyboard.press(' ');
    await expect(hosts(page).first()).toHaveText('rest');

    // The reflex: one Backspace immediately after gives the characters back.
    await page.keyboard.press('Backspace');
    await expect(hosts(page).first()).toHaveText('1. rest');
    await page.keyboard.type('X');

    await expect(host).toHaveText('1. restX');
  });

  // -------------------------------------------------------------------------
  // Tab, and the nesting Task 26 built.

  // Deferred claim 35 (Task 26): "Tab on a nested item does not move focus,
  // and the caret stays in the item she nested." Merged with the brief's own
  // "Tab nests a list item and Shift+Tab un-nests it": one sequence, and
  // separating them would have meant building the same list twice.
  //
  // Mutation: drop `event.preventDefault()` from the Tab branch
  // (WritingSurface.tsx:1065) -- the indent is applied and focus leaves the
  // item anyway, so the second half of this reddens while the first stays
  // green. That asymmetry is the reason both halves are here.
  test('Tab nests a list item and Shift+Tab un-nests it, and her caret never leaves it', async ({ page }) => {
    const surface = await openWriting(page);
    await writeFirst(page, 'Rosemary');
    await toStart(page);
    await page.keyboard.type('- ');
    await toEnd(page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Thyme');

    const second = surface.locator('li[data-slot]').nth(1);
    const flat = await second.evaluate((el) => getComputedStyle(el).marginInlineStart);
    await page.keyboard.press('Tab');

    // The indent is a computed distance, not a class name -- see hazard 1.
    await expect
      .poll(async () => second.evaluate((el) => getComputedStyle(el).marginInlineStart))
      .not.toBe(flat);
    // She did not go anywhere: this is the press the surface handles, so the
    // browser's own "move to the next control" never ran.
    expect(await activeName(page)).toBe(await second.getAttribute('data-slot'));
    expect((await caret(page)).offset).toBe('Thyme'.length);

    await page.keyboard.press('Shift+Tab');
    await expect
      .poll(async () => second.evaluate((el) => getComputedStyle(el).marginInlineStart))
      .toBe(flat);
    expect(await activeName(page)).toBe(await second.getAttribute('data-slot'));
  });

  // Deferred claim 31 (Task 26), in its own words: "the nested `<li>`'s
  // bounding box starts at least 20px right of its parent item's, on the
  // writing surface, at 390px." 1.25rem is 20px at this project's root font
  // size, so 20 is the number the claim was written against and not a round
  // one chosen here.
  //
  // Mutation: delete the `style` line from `host`
  // (WritingSurface.tsx:1119) -- the array changes, the column does not, and
  // Tab reads as a key that does nothing.
  test('one level of nesting is legible at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const surface = await openWriting(page);
    await writeFirst(page, 'Rosemary');
    await toStart(page);
    await page.keyboard.type('- ');
    await toEnd(page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Thyme');
    await page.keyboard.press('Tab');

    const items = surface.locator('li[data-slot]');
    const parent = (await items.nth(0).boundingBox())!;
    const nested = (await items.nth(1).boundingBox())!;
    expect(nested.x - parent.x).toBeGreaterThanOrEqual(20);
  });

  // Deferred claim 36 (Task 26): "two levels of nesting stay inside the column
  // at 390px -- the deepest item's text does not overflow the writing
  // surface's own box."
  //
  // Mutation: raise `MAX_LIST_DEPTH` and take the `Math.min` off
  // `indentStyle` (WritingSurface.tsx:179), then press Tab enough times --
  // the item walks off the right of the column. At the shipped cap of 2 it
  // cannot, and that is the claim.
  test('two levels of nesting stay inside the column at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const surface = await openWriting(page);
    await writeFirst(page, 'Rosemary');
    await toStart(page);
    await page.keyboard.type('- ');
    await toEnd(page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Thyme');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Sage and a good long run of words to push the right edge');
    await page.keyboard.press('Tab');

    const items = surface.locator('li[data-slot]');
    const first = (await items.nth(0).boundingBox())!;
    const deepest = (await items.nth(2).boundingBox())!;
    const column = (await surface.boundingBox())!;
    expect(deepest.x - first.x).toBeGreaterThanOrEqual(40);
    expect(deepest.x + deepest.width).toBeLessThanOrEqual(column.x + column.width + 1);
    // And the words themselves, not only the box: a `<li>` can keep its own
    // width while its text spills out of it.
    expect(
      await items.nth(2).evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  });

  // Deferred claims 33 and 34 (Task 26): "Tab on the first item of a list
  // moves focus out of that host" and "Tab on a paragraph moves focus to the
  // next focusable control rather than inserting a tab character". Merged --
  // they are the same guarantee (Tab is how a keyboard user leaves this
  // surface at all) asserted on the two presses the handler lets through.
  //
  // Mutation: call `event.preventDefault()` on every Tab, before the
  // `edit === null` return (WritingSurface.tsx:1064) -- she is then shut
  // inside the post with no way out but a mouse, and both halves redden.
  test('Tab leaves the surface wherever nesting does not apply', async ({ page }) => {
    const surface = await openWriting(page);
    const paragraph = await writeFirst(page, 'Rosemary');

    await page.keyboard.press('Tab');
    expect(await activeName(page)).not.toBe('b1/text');
    // And no tab character was written into her words on the way out.
    await expect(paragraph).toHaveText('Rosemary');

    // The first item of a list: nesting refuses it (there is nothing above it
    // to nest under), so the press is the browser's.
    await paragraph.click();
    await toStart(page);
    await page.keyboard.type('- ');
    const item = surface.locator('li[data-slot]').first();
    const address = await item.getAttribute('data-slot');
    expect(await activeName(page)).toBe(address);
    await page.keyboard.press('Tab');
    expect(await activeName(page)).not.toBe(address);
    await expect(item).toHaveText('Rosemary');
  });

  // -------------------------------------------------------------------------
  // Paste.

  // Deferred claims 19 and 20 (Tasks 22-23): "what the suppressed paste
  // default buys -- the source page's own markup never entered the tree" and
  // "a real clipboard: whether a browser's own ClipboardEvent carries what
  // this reads". Merged: one paste of genuinely rich content proves both, and
  // neither could be proved without the other.
  //
  // Mutation: drop `event.preventDefault()` from `handlePaste`
  // (WritingSurface.tsx:681) -- Chromium's own paste runs as well and the
  // source's SPAN, TABLE, TBODY, TR and TD all land in the host.
  test('pasting rich content leaves no foreign element in the surface', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openWriting(page);
    const host = await writeFirst(page, 'Before');

    // REAL rich content on the REAL system clipboard, in both flavours, the
    // way a copy out of a word processor or a web page arrives.
    await page.evaluate(async () => {
      const html =
        '<div style="font-family:Calibri;font-size:11pt"><span style="color:#c00">Red words</span>'
        + '<b>bold</b><i>italic</i><br><table><tbody><tr><td>a cell</td></tr></tbody></table>'
        + '<script>window.pasted = true</script></div>';
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob(['Red words bold italic a cell'], { type: 'text/plain' }),
        }),
      ]);
    });
    await host.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+v');

    // It really did paste -- without this the scan below would pass on an
    // empty host, which is the shape of an unfalsifiable assertion.
    await expect(host).toHaveText('Red words bold italic a cell');
    // The allowlist the brief specifies: everything the published renderer
    // and inline-dom.ts between them can produce, and nothing else.
    const allowed = [
      'P', 'H2', 'BLOCKQUOTE', 'CITE', 'LI', 'UL', 'OL', 'FIGURE', 'FIGCAPTION',
      'IMG', 'STRONG', 'EM', 'S', 'U', 'CODE', 'A', 'BR',
    ];
    expect(
      await hosts(page).evaluateAll((els, names) =>
        els.flatMap((el) =>
          [...el.querySelectorAll('*')]
            .map((child) => child.tagName)
            .filter((tag) => !(names as string[]).includes(tag)),
        ),
      allowed),
    ).toEqual([]);
    // And no foreign styling smuggled in on an element that IS allowed.
    expect(
      await hosts(page).evaluateAll((els) =>
        els.flatMap((el) => [...el.querySelectorAll('*')].filter((c) => c.hasAttribute('style')).map((c) => c.tagName)),
      ),
    ).toEqual([]);
  });

  // Deferred claim 21 (Tasks 22-23): "where the caret is after a
  // multi-paragraph paste -- that a browser paints a caret at the end of the
  // last pasted paragraph and keeps it."
  //
  // Mutation: leave `pendingCaret` on the FIRST chunk instead of the last
  // (WritingSurface.tsx:708) -- everything she types next lands above the
  // rest of her own paste.
  test('a multi-paragraph paste leaves her at the end of the last paragraph', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openWriting(page);
    const host = await writeFirst(page, 'Before');

    await page.evaluate(async () => {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': new Blob(['one\n\ntwo\n\nthree'], { type: 'text/plain' }) }),
      ]);
    });
    await host.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(hosts(page)).toHaveText(['one', 'two', 'three']);

    await page.keyboard.type('X');
    expect(await slots(page)).toEqual(['one', 'two', 'threeX']);
  });

  // -------------------------------------------------------------------------
  // Undo, marks, and the link prompt.

  // Deferred claim 16 (Tasks 20-21): "that Cmd+Z reaches this handler rather
  // than the browser's own contenteditable undo. The suppression is pinned;
  // the DISPLACEMENT is not."
  //
  // THE WHOLE COLUMN IS ASSERTED, not one element, and deliberately. The most
  // recent unfalsifiable assertion on this project was an Undo case that
  // stayed green while the code was broken, because two earlier steps in the
  // same history made Undo land on an array that passed the identity check by
  // coincidence (task-25b-report.md, finding 1). A single-element assertion
  // here would have the same shape.
  //
  // Mutation: drop `event.preventDefault()` from the `z` branch
  // (WritingSurface.tsx:1012) -- Chromium's own contenteditable undo runs as
  // well, so the DOM and the block array stop agreeing, and the re-read after
  // the round trip below is what says so.
  test('Cmd+Z undoes the last step and the screen matches the draft', async ({ page }) => {
    const surface = await openWriting(page);
    await writeFirst(page, 'AlphaBeta');
    const blocksBefore = await surface.locator('[data-block-controls]').count();

    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    expect(await slots(page)).toEqual(['Alpha', 'Beta']);
    expect(await surface.locator('[data-block-controls]').count()).toBe(blocksBefore + 1);

    await page.keyboard.press('ControlOrMeta+z');

    expect(await slots(page)).toEqual(['AlphaBeta']);
    expect(await surface.locator('[data-block-controls]').count()).toBe(blocksBefore);

    // AND THE SCREEN MATCHES THE DRAFT. Leaving the host and coming back is
    // what makes the layout effect rewrite it from the array, so a DOM that
    // the browser's own undo had touched behind the array's back is corrected
    // here -- visibly, and to something other than what was on screen a
    // moment ago.
    await awayFromTheWords(surface).click();
    await hosts(page).first().click();
    expect(await slots(page)).toEqual(['AlphaBeta']);

    // Deferred claim 17 (Tasks 20-21): "what an undo does to the caret." A
    // restored step recovers the SLOT, not the offset in it -- pinned as the
    // known limit it is.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Gamma');
    await page.keyboard.press('ControlOrMeta+z');
    expect((await caret(page)).slot).toMatch(/\/text$/);
  });

  // Deferred claims 12 and 14, merged (Tasks 20-21): "that a real browser
  // keeps the selection when a control is pressed -- every toolbar action
  // depends on it" and "that a mark is VISIBLE: that `<strong>` renders as
  // bold on screen is a computed-style claim". One press proves both, and a
  // version that proved only the first would be green on a mark nobody could
  // see.
  //
  // Mutations, both applied: drop `onMouseDown={(event) =>
  // event.preventDefault()}` from `Tool` (WritingToolbar.tsx:53) -- the host
  // blurs before the click and `activeHost` acts on a selection that is gone;
  // and replace `toggleMark(at.el, mark)` with
  // `at.el.ownerDocument.execCommand('bold')` (WritingSurface.tsx:795) --
  // Chromium builds a styled `<span>`, `readInline` cannot see a mark in it,
  // and the words come back bare from the round trip below.
  test('bold survives a click away and back', async ({ page }) => {
    const surface = await openWriting(page);
    const host = await writeFirst(page, 'AlphaBeta');

    await page.keyboard.press('ControlOrMeta+a');
    await surface.getByRole('button', { name: 'Bold', exact: true }).click();

    // Away -- a real click on a real element further down the column, not a
    // scripted blur.
    await awayFromTheWords(surface).click();
    // ...and back. The host is rewritten from the array on the way, which is
    // what makes this a round trip through the saved source and not a reading
    // of whatever the button left in the DOM.
    await host.click();

    await expect(host.locator('strong')).toHaveCount(1);
    await expect(host.locator('strong')).toHaveText('AlphaBeta');
    expect(
      Number(await host.locator('strong').evaluate((el) => getComputedStyle(el).fontWeight)),
    ).toBeGreaterThanOrEqual(600);
  });

  // Deferred claim 15 (Tasks 20-21): "where the caret lands after a toggle, a
  // clear and a link. `marks.ts` selects the element's contents in every case;
  // whether a browser keeps that range and paints a caret in it is not
  // observable here."
  //
  // Mutation: drop the `selectContents(...)` call at the end of `toggleMark`
  // and of `clearMarks` (marks.ts:109,123) -- the words go bold and her
  // selection is gone, so the next press acts on nothing.
  //
  // A DEFECT THIS TEST FOUND, SINCE FIXED, and the third phase below is what
  // holds it fixed. CLEAR FORMATTING COULD NOT REMOVE A MARK THAT FILLED THE
  // SELECTION. `clearMarks` (marks.ts) does `range.deleteContents()` and then
  // inserts the plain words back at the range's own start. When the selection
  // begins inside the marked element -- which is every selection whose first
  // character is marked, including the ordinary select-all-then-Bold-then-
  // change-my-mind -- the element is only PARTIALLY contained by that range,
  // so `deleteContents` emptied it and left it standing, and the replacement
  // text node went back INSIDE it. The mark survived its own removal, survived
  // a close-and-reopen, and was therefore what published.
  //
  // `clearMarks` now carries the replacement text back OUT of every mark
  // element it lands in, splitting each one at that point so that whatever
  // part of the mark she did NOT select keeps it. The first two phases below
  // mark a run in the MIDDLE of the block, which is the path that always
  // worked and has to go on working; the third is the one that was broken.
  test('a toggle and a clear both leave her selection on the words she marked', async ({ page }) => {
    const surface = await openWriting(page);
    const host = await writeFirst(page, 'One Two Three');

    // Her own shift-selection of the MIDDLE word, so the marked element has
    // her words on both sides of it -- see the note above for why that is
    // what makes Clear formatting work at all.
    await toStart(page);
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowRight');
    await surface.getByRole('button', { name: 'Bold', exact: true }).click();
    // After the toggle: her words, still selected, ready for the next press.
    expect((await caret(page)).selected).toBe('Two');
    await expect(host.locator('strong')).toHaveText('Two');

    // Now the whole line, selected from its first character.
    await toStart(page);
    for (let i = 0; i < 'One Two Three'.length; i += 1) await page.keyboard.press('Shift+ArrowRight');
    expect((await caret(page)).selected).toBe('One Two Three');
    await surface.getByRole('button', { name: 'Clear formatting' }).click();

    // After the clear: the mark gone, and the same words still selected.
    expect((await caret(page)).selected).toBe('One Two Three');
    await expect(host.locator('strong')).toHaveCount(0);
    await expect(host).toHaveText('One Two Three');

    // THE CASE THAT WAS BROKEN, and the ordinary one: bold the whole line,
    // change her mind, clear the whole line. The selection then STARTS inside
    // the `<strong>` rather than beside it, which is the shape
    // `deleteContents` only partially contains.
    await page.keyboard.press('ControlOrMeta+a');
    await surface.getByRole('button', { name: 'Bold', exact: true }).click();
    await expect(host.locator('strong')).toHaveText('One Two Three');

    await toStart(page);
    for (let i = 0; i < 'One Two Three'.length; i += 1) await page.keyboard.press('Shift+ArrowRight');
    expect((await caret(page)).selected).toBe('One Two Three');
    await surface.getByRole('button', { name: 'Clear formatting' }).click();

    await expect(host.locator('strong')).toHaveCount(0);
    await expect(host).toHaveText('One Two Three');
    // ...AND THAT IS WHAT PUBLISHES. A remount writes every host from the
    // saved source, so this reads the draft rather than whatever the button
    // left in the DOM -- which is the half that made this a defect worth
    // fixing rather than a cosmetic one. Her selection is not asserted after
    // the reopen: the surface has been unmounted and there is no caret to
    // keep.
    await reopenTheWritingPost(page);
    await expect(hosts(page).first().locator('strong')).toHaveCount(0);
    await expect(hosts(page).first()).toHaveText('One Two Three');
  });

  // Deferred claim 18 (Tasks 20-21): "`window.prompt` as a real modal.
  // Stubbed here. That it blocks, that Escape cancels it, and that the surface
  // still has its selection afterwards are browser facts."
  //
  // Mutation: `if (answer === null) return;` deleted from `linkNow`
  // (WritingSurface.tsx:827) -- Cancel is then read as an empty target and
  // she gets a refusal she never asked for.
  test('the link prompt is a real modal, and Cancel leaves her words alone', async ({ page }) => {
    const surface = await openWriting(page);
    const host = await writeFirst(page, 'AlphaBeta');
    const link = surface.getByRole('button', { name: 'Link', exact: true });

    // Cancel first: the browser's own modal, dismissed the way Escape
    // dismisses it.
    const cancelled = page.waitForEvent('dialog').then(async (dialog) => {
      expect(dialog.type()).toBe('prompt');
      expect(dialog.message()).toContain('Where should this link go?');
      await dialog.dismiss();
    });
    await page.keyboard.press('ControlOrMeta+a');
    await link.click();
    await cancelled;

    await expect(host.locator('a')).toHaveCount(0);
    await expect(host).toHaveText('AlphaBeta');
    // And she is told nothing, because she asked for nothing. Cancel read as
    // an empty target would put a refusal on screen -- a complaint about a
    // link she never tried to make, announced as an alert, which then wins
    // PostList's "take me to the first problem" against real ones below it.
    await expect(surface.getByText(/will not work as a link/)).toHaveCount(0);
    // Her selection survived the modal, which is the half the surface depends
    // on: the next press has to act on the same words.
    expect((await caret(page)).selected).toBe('AlphaBeta');

    // And accepting inserts the link over exactly those words.
    const accepted = page.waitForEvent('dialog').then((dialog) => dialog.accept('https://example.com/a'));
    await link.click();
    await accepted;
    await expect(host.locator('a')).toHaveText('AlphaBeta');
    await expect(host.locator('a')).toHaveAttribute('href', 'https://example.com/a');
    expect((await caret(page)).selected).toBe('AlphaBeta');
  });

  // -------------------------------------------------------------------------
  // The photograph.

  // Deferred claims 13 and 22, merged (Tasks 20-21 item 13, Tasks 22-23 item
  // 22 -- explicitly "item 13's other half, now that the input exists").
  //
  // Mutation: point the label at an input that is not there --
  // `htmlFor={imageInputId}` -> `htmlFor="posts-99-writing-image"`
  // (WritingToolbar.tsx:101). The control still looks and reads exactly the
  // same and opens nothing, which is precisely the failure a jsdom shape
  // assertion cannot see.
  test('the image picker opens from the toolbar control', async ({ page }) => {
    const surface = await openWriting(page);
    const chooser = page.waitForEvent('filechooser');
    await surface.getByText('Image', { exact: true }).click();
    const opened = await chooser;
    expect(opened.element()).toBeTruthy();
  });

  // Deferred claim 24 (Tasks 22-23): "that `sr-only` keeps the input operable
  // -- it is out of view, in the accessibility tree, and labelled."
  //
  // Mutation: `className="sr-only"` -> `hidden` (WritingSurface.tsx:1411) --
  // a `display: none` input is not reliably reachable, and this reddens on the
  // display assertion while the picker test above goes on passing.
  test('the file input is out of view but still operable', async ({ page }) => {
    const surface = await openWriting(page);
    const input = surface.locator('input[type="file"]');

    // Out of view: one pixel, clipped, and not painted over her words.
    const box = (await input.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
    // But operable: rendered, focusable, and carrying an accessible name from
    // the label above it. `display: none` satisfies none of the three.
    await expect(input).not.toHaveCSS('display', 'none');
    await input.focus();
    await expect(input).toBeFocused();
    expect(
      await input.evaluate((el) => {
        const owner = el.ownerDocument.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
        return owner?.textContent?.trim() ?? '';
      }),
    ).toBe('Image');
  });

  // Deferred claim 23 (Tasks 22-23): "that the photograph renders centred at
  // column width, at 390px and at 1280px".
  //
  // Mutation: give the figure a fixed pixel width -- `<figure
  // className="mb-6 w-40">` (WritingSurface.tsx:1170). The picture stops being
  // the column's width and stops being centred in it, at both viewports.
  for (const viewport of [
    { label: '390px (phone)', width: 390, height: 844 },
    { label: '1280px (laptop)', width: 1280, height: 800 },
  ]) {
    test(`an inserted image sits centred at column width at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route('**/api/upload**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ path: 'assets-source/posts/e2e.png', contentPath: '/posts/e2e.webp' }),
        });
      });
      const surface = await openWriting(page);
      const paragraph = await writeFirst(page, 'Rosemary');

      await surface.locator('input[type="file"]').setInputFiles({
        name: 'e2e.png', mimeType: 'image/png', buffer: TINY_PNG,
      });
      const picture = surface.locator('figure img');
      await expect(picture).toBeVisible();

      const column = (await paragraph.boundingBox())!;
      const box = (await picture.boundingBox())!;
      // At the column's width, and squarely in it -- the same left and right
      // edges her words have.
      expect(Math.abs(box.width - column.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.x - column.x)).toBeLessThanOrEqual(1);
      expect(await hitTestSelf(picture)).toBe(true);
    });
  }

  // -------------------------------------------------------------------------
  // The block controls Task 25b added.

  // Deferred claim 26 (Task 25b): "that pressing Enter or Space on a Move or
  // Remove control activates it -- jsdom asserts only that each control is a
  // `<button type="button">` with an accessible name."
  //
  // Mutation: render the controls as `<div role="button" onClick=...>`
  // (WritingSurface.tsx:1326-1355) -- they still have the right role and the
  // right name, and neither key does anything at all.
  test('Enter and Space work the Move controls', async ({ page }) => {
    const surface = await openWriting(page);
    await writeFirst(page, 'Alpha');

    const kindsNow = async (): Promise<string[]> =>
      surface.locator('[data-block-controls]').evaluateAll((rows) =>
        rows.map((row) => (row.querySelector('button')?.getAttribute('aria-label') ?? '').replace(/ block \d+.*$/, '')),
      );
    expect(await kindsNow()).toEqual(['Move Paragraph', 'Move Where it was published']);

    await surface.getByRole('button', { name: 'Move Paragraph block 1 down' }).focus();
    await page.keyboard.press('Enter');
    expect(await kindsNow()).toEqual(['Move Where it was published', 'Move Paragraph']);

    await surface.getByRole('button', { name: 'Move Paragraph block 2 up' }).focus();
    await page.keyboard.press('Space');
    expect(await kindsNow()).toEqual(['Move Paragraph', 'Move Where it was published']);
  });

  // Deferred claims 5, 25 and 30, merged (Task 17 item 5: "`Element.moveBefore`
  // behaviour on reorder -- jsdom does not blur a moved node; a browser can";
  // Task 25b item 1: "that a real browser blurs a button React relocates
  // during a move, which is what makes the refocus call load-bearing rather
  // than the no-op it provably is under jsdom"; Task 25b item 6: "that focus
  // is visibly indicated on the control focus lands on after a move"). They
  // are one measurement: where focus is after a move, and whether she can see
  // it.
  //
  // MEASURED, AND IT CORRECTS THE CLAIM: Chromium does NOT blur a button React
  // relocates. With three blocks and the middle two trading places, React
  // moves the OTHER wrapper and leaves the pressed button's own node where it
  // is, so it never moves and never blurs -- emptying the refocus effect left
  // that version of this test green. What the effect actually buys is the case
  // below, which is also the common one: a block reaching an end LOSES that
  // direction's control outright (it is omitted, not disabled), React unmounts
  // the button she is standing on, and focus falls to `<body>` -- turning her
  // next press into a re-navigation from the top of the document.
  //
  // Mutation: empty the refocus `useEffect` body (WritingSurface.tsx:609-628)
  // -- `activeName` reads BODY and this reddens.
  test('a move keeps her focus on the controls of the block she moved, and shows her where it is', async ({ page }) => {
    const surface = await openWriting(page);
    await writeFirst(page, 'Alpha');

    // Reached by real Tab presses, not by a scripted focus: Chromium's own
    // :focus-visible heuristic is about how focus arrived, and the outline
    // assertion below is about what she can SEE.
    await surface.getByRole('button', { name: 'Clear formatting' }).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await activeName(page)).toBe('Move Paragraph block 1 down');
    await page.keyboard.press('Enter');

    // The paragraph is last now, so the control she pressed no longer exists.
    // She is put on the one Move control its group still has -- never on
    // Remove, which would leave Enter one press away from deleting the block
    // she was moving.
    expect(await activeName(page)).toBe('Move Paragraph block 2 up');
    await expect
      .poll(async () => page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle))
      .not.toBe('none');
  });

  // Deferred claim 27 (Task 25b): "that every block's controls are reachable
  // by Tab in document order, so the whole column can be reordered with the
  // keyboard alone and with no pointer."
  //
  // Mutation: render `{rowOf(row)}` before `{controlsFor(row)}`
  // (WritingSurface.tsx:1471-1476) -- every control is still reachable, and
  // the order she meets them in stops matching the order of the post.
  test('every block\'s controls are reachable by Tab, in the order of the post', async ({ page }) => {
    const surface = await openWriting(page);
    await writeFirst(page, 'Alpha');

    await surface.getByRole('button', { name: 'Clear formatting' }).focus();
    const met: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      met.push(await activeName(page));
    }

    expect(met).toEqual([
      'INPUT', // the sr-only file input, which is a tab stop on purpose
      'Move Paragraph block 1 down',
      'Remove Paragraph block 1',
      'b1/text',
      'Move Where it was published block 2 up',
      'Remove Where it was published block 2',
    ]);
  });

  // Deferred claim 3 (Task 17): "focus reaching a host at all. `contenteditable`
  // is inert in jsdom, so `fireEvent.focus` stands in for a click landing in
  // the words. Whether a click, a Tab or a screen reader can reach a host is
  // browser-only." The Tab half is the test above; this is the click half,
  // which is the one she actually uses.
  //
  // Mutation: drop `contentEditable: true` from `host`
  // (WritingSurface.tsx:1117) -- the words are still on screen and no click
  // can put a caret in them.
  test('a click lands a caret in the words, where she clicked', async ({ page }) => {
    await openWriting(page);
    const host = await writeFirst(page, 'Alpha Beta Gamma');

    // The left-hand end of the line, not its centre: a caret that always
    // landed at 0 or always at the end would pass a centre click.
    const box = (await host.boundingBox())!;
    await page.mouse.click(box.x + 6, box.y + box.height / 2);

    const where = await caret(page);
    expect(where.slot).toBe('b1/text');
    expect(where.offset).toBeGreaterThanOrEqual(0);
    expect(where.offset).toBeLessThan('Alpha Beta Gamma'.length);
    await expect(host).toBeFocused();
  });

  // Deferred claim 28 (Task 25b): "that the control row is visible and
  // hittable at 390px and at 1280px and does not overlap the prose it stands
  // above."
  //
  // Mutation: `className="mb-1 flex items-center gap-2"` ->
  // `"absolute flex items-center gap-2"` on the control row
  // (WritingSurface.tsx:1324) -- the row lifts out of flow and lands on top
  // of the words underneath it.
  for (const viewport of [
    { label: '390px (phone)', width: 390, height: 844 },
    { label: '1280px (laptop)', width: 1280, height: 800 },
  ]) {
    test(`the block controls are hittable and clear of the prose at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const surface = await openWriting(page);
      const host = await writeFirst(page, 'Alpha');

      const row = surface.locator('[data-block-controls]').first();
      const rowBox = (await row.boundingBox())!;
      const hostBox = (await host.boundingBox())!;
      expect(rowBox.width).toBeGreaterThan(0);
      expect(rowBox.height).toBeGreaterThan(0);
      // Above her words, and clear of them.
      expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(hostBox.y + 1);
      // And inside the column, not spilling out of it at the narrow end.
      const column = (await surface.boundingBox())!;
      expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(column.x + column.width + 1);

      for (const name of ['Move Paragraph block 1 down', 'Remove Paragraph block 1']) {
        const control = surface.getByRole('button', { name });
        await control.scrollIntoViewIfNeeded();
        expect(await hitTestSelf(control), `${name} is not the element its own centre pixel resolves to`).toBe(true);
      }
    });
  }

  // Deferred claim 29 (Task 25b): "that the class-less wrapper each block
  // gained leaves the column's vertical rhythm unchanged (margin collapsing is
  // a layout fact jsdom has no engine for)."
  //
  // The wrapper carries no class, so a block's own bottom margin collapses
  // straight through it and the gap between two blocks is that margin and
  // nothing else. That is the whole claim, and it is measurable.
  //
  // Mutation: give the wrapper any class that stops a margin collapsing --
  // `<div key={row.name} className="p-1">` (WritingSurface.tsx:1472) -- and
  // the gap grows by the padding at both ends.
  test('the wrapper each block gained leaves the column\'s rhythm alone', async ({ page }) => {
    const surface = await openWriting(page);
    await writeFirst(page, 'AlphaBeta');
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');

    const first = (await hosts(page).nth(0).boundingBox())!;
    const secondRow = (await surface.locator('[data-block-controls]').nth(1).boundingBox())!;
    const ownMargin = Number(
      (await hosts(page).nth(0).evaluate((el) => getComputedStyle(el).marginBottom)).replace('px', ''),
    );

    expect(ownMargin).toBeGreaterThan(0);
    expect(Math.abs(secondRow.y - (first.y + first.height) - ownMargin)).toBeLessThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Geometry, at both viewports.

  // Deferred claim 23's other half (Tasks 22-23): "that the toolbar sits above
  // a phone keyboard." The fold budget is
  // e2e/dashboard-sections.spec.ts:478's, restated for this row.
  //
  // Mutation: give `Tool` a class that makes the buttons tall enough to wrap
  // the row past the budget -- `${MOVE_BUTTON_CLASSNAME} py-16`
  // (WritingToolbar.tsx:54) -- and the row stops fitting above a keyboard.
  test('the toolbar is reachable above the keyboard at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const surface = await openWriting(page);
    const toolbar = surface.locator('[role="group"][aria-label="Formatting"]');
    await toolbar.scrollIntoViewIfNeeded();

    const box = (await toolbar.boundingBox())!;
    // On screen at all, which is the fold budget dashboard-sections.spec.ts
    // holds the five home rows to.
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    // AND above a keyboard: iOS's own is roughly 336pt on an 844pt screen,
    // leaving 508. A row taller than that cannot be got above one however far
    // she scrolls, which is the thing this measures rather than assumes.
    expect(box.height).toBeLessThanOrEqual(508);
    expect(await hitTestSelf(toolbar)).toBe(true);
  });

  // The brief's own last test, and Task 17's deferred claim 4 ("everything
  // visual ... whether the column reads like the published post").
  //
  // Mutation: give the hosts a two-column class, or drop `wrap`'s block
  // elements -- either breaks the stack. The published-page half reddens on
  // any drift between WritingSurface.tsx:86-97 and blocks.tsx:23-28, which are
  // required to be character-for-character identical.
  for (const viewport of [
    { label: '390px (phone)', width: 390, height: 844 },
    { label: '1280px (laptop)', width: 1280, height: 800 },
  ]) {
    test(`the surface renders as a column at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const surface = await openWriting(page);
      await writeFirst(page, 'AlphaBeta');
      for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Enter');

      const boxes = await hosts(page).evaluateAll((els) =>
        els.map((el) => {
          const rect = el.getBoundingClientRect();
          return { x: rect.x, right: rect.right, top: rect.top, bottom: rect.bottom };
        }),
      );
      expect(boxes.length).toBe(2);
      const column = (await surface.boundingBox())!;
      boxes.forEach((box, i) => {
        // One under the other, never side by side.
        if (i > 0) expect(box.top).toBeGreaterThanOrEqual(boxes[i - 1].bottom);
        // And inside the column at both widths -- no horizontal overflow.
        expect(box.x).toBeGreaterThanOrEqual(column.x - 1);
        expect(box.right).toBeLessThanOrEqual(column.x + column.width + 1);
      });

      // ...and it reads like the published post. The surface's own class
      // strings are blocks.tsx's, character for character
      // (WritingSurface.tsx:82-87 says so in as many words); this is the only
      // place that can check the RENDERED consequence rather than the string.
      const inTheEditor = await hosts(page).first().evaluate((el) => {
        const style = getComputedStyle(el);
        return { font: style.fontFamily, size: style.fontSize, line: style.lineHeight, colour: style.color };
      });
      await page.goto(`/blog/${WRITING_POST.slug}`);
      // The BLOCK paragraph, named by its own committed words -- read out of
      // posts.json above rather than retyped here, so this does not depend on
      // WHICH post carries a paragraph and a citation. `article p` first is
      // the date line (PostPage.tsx:111), which is a different size and a
      // different grey on purpose.
      const published = await page
        .locator('article p')
        .filter({ hasText: WRITING_POST_WORDS })
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return { font: style.fontFamily, size: style.fontSize, line: style.lineHeight, colour: style.color };
        });
      expect(inTheEditor).toEqual(published);
    });
  }

  // Task 17's deferred claim 4, first half: "the height an empty host keeps
  // and whether she can hit it." A block she has just emptied has to stay
  // clickable, or the only way back into it is a keyboard she may not be
  // using.
  //
  // Mutation: drop the empty-host minimum, whatever provides it -- if the
  // measurement below shows there is none, that is a finding and not a test
  // (see this task's report).
  test('a block she has emptied is still big enough to click', async ({ page }) => {
    await openWriting(page);
    const host = await writeFirst(page, 'Alpha');

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(host).toHaveText('');

    const box = (await host.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(16);
    expect(await hitTestSelf(host)).toBe(true);
    await host.click();
    await expect(host).toBeFocused();
  });

  // Not a deferred claim, but the row every other test in this file rests on,
  // and the brief's own "revert PostList.tsx to BlockList" mutation row: THE
  // SWAP HAPPENED. Task 25 replaced BlockList with WritingSurface and until
  // this file existed nothing in a browser said so.
  //
  // Mutation: change the import and the element in PostList.tsx:28,341 back to
  // BlockList -- every test in this file reddens, and this one names why.
  test('the post editor is the writing column, not a stack of boxes', async ({ page }) => {
    const surface = await openWriting(page);

    // Her words in an editable host that is the published renderer's own
    // element, and not in a textarea inside a labelled box.
    const host = hosts(page).first();
    expect(await host.evaluate((el) => el.tagName)).toBe('P');
    await expect(host).toHaveAttribute('contenteditable', 'true');
    await expect(surface.locator('textarea')).toHaveCount(0);
    await expect(surface.locator('[role="group"][aria-label="Formatting"]')).toHaveCount(1);
  });

  // THE CORE WORKFLOW OF THE WHOLE SECTION: press Add, and write.
  //
  // It did not work, and the first version of this test pinned the dead end
  // rather than the fix. A blank post had `blocks: []`; the insert menu offers
  // only the four kinds the toolbar cannot reach, and every control that makes
  // a paragraph acts on the host she is standing in, which a post with no
  // blocks does not have. She pressed Add, got a post, and had nowhere to
  // type. `blankPost` (areas/PostsArea.tsx) now seeds one empty paragraph --
  // what any writing tool opens a blank document with, and REAL STORED CONTENT
  // rather than a host painted over an empty array, because the block array is
  // authoritative (D5) and a post's stored shape is what publishes.
  //
  // Mutation: put `blocks: []` back in `blankPost`. There is then no
  // `[data-slot]` anywhere on that screen and the click below has nothing to
  // land on.
  test('a post she has just added can be written in straight away', async ({ page }) => {
    const panel = await addPost(page);
    const surface = panel.locator('div:has(> [role="group"][aria-label="Formatting"])');
    await expect(surface).toHaveCount(1);

    // One host, the published renderer's own element for a paragraph, and
    // empty -- a blank document rather than a document with something in it.
    const host = surface.locator('[data-slot]');
    await expect(host).toHaveCount(1);
    expect(await host.evaluate((el) => el.tagName)).toBe('P');
    await expect(host).toHaveText('');

    // Her caret in it, from a real click, and her words arriving.
    await host.click();
    await expect(host).toBeFocused();
    await page.keyboard.type('First words');
    await expect(host).toHaveText('First words');
    expect((await caret(page)).offset).toBe('First words'.length);

    // The insert menu is still on screen for the four kinds the toolbar cannot
    // reach, which is what it was there for before the paragraph existed.
    await expect(surface.getByRole('button', { name: /Photo grid/ })).toBeVisible();

    // AND THE PARAGRAPH IS STORED, not painted. Done unmounts the surface and
    // reopening it writes every host from the array, so words that come back
    // are words the draft actually holds -- which is what would publish. The
    // new post is the LAST row: PostsArea appends it.
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(panel.locator('[role="dialog"]')).toHaveCount(0);
    await panel.locator('[data-item-row]').last().getByRole('button').first().click();
    await expect(surface.locator('[data-slot]').first()).toHaveText('First words');
  });

  // THE SAME DEAD END AS THE TEST ABOVE, REACHED BY THE OTHER BUTTON, and the
  // reason Task 28c exists. `removeBlock` (WritingSurface.tsx) was a plain
  // filter and Remove is on every block unconditionally, so removing a post's
  // only block handed back `[]` -- no editable host, `activeHost()` null and
  // therefore every toolbar control dead, and none of the insert menu's four
  // kinds holding a place for a caret. A removal now leaves one empty
  // paragraph standing, the same `blankBlock('paragraph')` a new post opens
  // with.
  //
  // Mutation: drop the empty-array branch from `removeBlock` -- the count
  // below is 0 and the click has nothing to land on.
  test('removing the last block leaves her a paragraph to write in', async ({ page }) => {
    const surface = await openWriting(page);
    // The post openWriting found carries a paragraph and a citation, so this
    // empties a real post one real block at a time rather than a hand-built
    // one.
    await surface.getByRole('button', { name: 'Remove Paragraph block 1' }).click();
    await surface.getByRole('button', { name: 'Remove Where it was published block 1' }).click();

    const host = surface.locator('[data-slot]');
    await expect(host).toHaveCount(1);
    expect(await host.evaluate((el) => el.tagName)).toBe('P');
    await expect(host).toHaveText('');

    await host.click();
    await expect(host).toBeFocused();
    await page.keyboard.type('Starting over');
    await expect(host).toHaveText('Starting over');

    // AND IT IS STORED, not painted over an empty array. Done unmounts the
    // surface and reopening writes every host from the array, so words that
    // come back are words the draft actually holds.
    const panel = page.locator(POSTS_PANEL);
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(panel.locator('[role="dialog"]')).toHaveCount(0);
    await writingPostRow(panel).click();
    await expect(surface.locator('[data-slot]').first()).toHaveText('Starting over');
  });
});

// ---------------------------------------------------------------------------
// MUTATIONS THAT DID NOT REDDEN, and what each one says about the code. Every
// test above has at least one mutation that turns it red -- these are the
// mutations the task briefs and the task reports PREDICTED would be the
// falsifiers, and were not. Recorded here because "the test can fail" and
// "this line is what keeps it passing" are different claims, and only the
// first is true for the lines below.
//
// 1. THE FOCUSED-HOST GUARD ALONE (WritingSurface.tsx:562). Deleting it leaves
//    every test here green. It is masked by the line under it: `commitSlot`
//    writes the new source into the ELEMENT-keyed `written` memo BEFORE it
//    hands the array up, so on the next render the memo already agrees and the
//    effect returns before the guard would have mattered. Deleting BOTH lines
//    reddens "the caret stays where she is typing across a commit" and "typing
//    fast ... drops no keystroke", which is how those two are falsified. Task
//    17's report calls the focused-host rule the thing that "removes the whole
//    caret-restoration problem"; in a real browser, for the ordinary typing
//    path, the memo removes it first.
//
// 2. `event.preventDefault()` ON THE AUTOFORMAT SPACE (WritingSurface.tsx:1028).
//    Deleting it does not put the space back on screen: the conversion replaces
//    the host's element outright, so Chromium's own insertion lands in a node
//    React has already thrown away. The two halves of that test are falsified
//    by autoformat.ts's trigger instead (removing it, and making it keep the
//    trigger characters).
//
// 3. `event.preventDefault()` ON THE `z` BRANCH (WritingSurface.tsx:1012).
//    Deleting it leaves "Cmd+Z undoes the last step" green. Chromium's own
//    contenteditable undo does run, but `stepTo` clears the focused-host guard
//    and hands the older array down in the same gesture, so the layout effect
//    rewrites every host from the array and whatever the browser's undo put
//    there is gone before anything can observe it. The DISPLACEMENT half of
//    Tasks 20-21's deferred claim 16 is therefore not provable here; the test
//    is falsified by `applyEdit` recording no undo step instead, which is what
//    proves it is THIS history the keystroke reaches.
//
// 4. THE TOOLBAR'S `onMouseDown` SUPPRESSION (WritingToolbar.tsx:53). Deleting
//    it reddens nothing -- neither the mark, nor the selection assertions.
//    Chromium keeps the document selection alive across the blur that moving
//    focus to the button causes, so `activeHost` and `rangeWithin` both still
//    find her words. Tasks 20-21's deferred claim 12 is the claim that the
//    suppression is what keeps the caret in her words; in this browser it is
//    not, and no mutation here can show it is. It is still worth keeping (the
//    behaviour it guards against is real in other engines), but this file does
//    not check it and should not be read as though it does.
//
// 5. `selectContents(...)` AT THE END OF `toggleMark` AND `clearMarks`
//    (marks.ts:105,123). Deleting either leaves the selection assertions green:
//    Chromium's own selection already covers the node that was just inserted.
//    So Tasks 20-21's deferred claim 15 is covered in the sense that matters --
//    her selection IS on her words after a toggle, a clear and a link, measured
//    in a real browser -- but the line that puts it there cannot be shown to be
//    what does it. Those tests are falsified by making the mark operations
//    themselves no-ops.
//
// 6. `stepTo` LEAVING `focusedRef` SET (WritingSurface.tsx:754). Green: after a
//    split, the host she is standing in is the one the undo removes, so there
//    is no surviving focused host for the guard to protect.
//
// 7. EMPTYING THE REFOCUS EFFECT, WITH THREE BLOCKS AND THE PRESSED BUTTON
//    SURVIVING. Green, and it corrects Task 17's deferred claim 5 and Task
//    25b's claim 1: React moves the OTHER wrapper, so the button she is
//    standing on never moves and never blurs. The claim holds only for the
//    case the test above uses, where the control is unmounted outright.
//
// 8. MAKING THE HOSTS THEMSELVES `inline-block w-1/2`. Green -- each block sits
//    in its own class-less block-level wrapper, so the column survives whatever
//    the hosts do. "The surface renders as a column" is falsified by putting
//    that class on the WRAPPER instead.
//
// ---------------------------------------------------------------------------
// TWO DEFECTS THIS FILE FOUND, both since fixed under `src/` by the task after
// it. They are named here because each one's test now pins the FIX, and a
// reader who meets a test called "a post she has just added can be written in
// straight away" deserves to know it was written the other way round first.
//
// 1. CLEAR FORMATTING DID NOTHING WHEN THE MARK FILLED THE SELECTION. Select a
//    whole paragraph, press Bold, select it again, press Clear formatting --
//    the `<strong>` was still there, still there after a close-and-reopen, and
//    so was what published. Mechanism and fix: see the note on "a toggle and a
//    clear both leave her selection on the words she marked", whose third
//    phase is the case that was broken.
//
// 2. A POST SHE HAD JUST ADDED COULD NOT GET A PARAGRAPH. `blankPost` handed
//    back `blocks: []` and nothing on that screen made a paragraph, so Add
//    produced a post with nowhere to write in it. `blankPost` now seeds one
//    empty paragraph. The test above was "a freshly added post offers the
//    insert menu and no prose host" and pinned the dead end.

// ---------------------------------------------------------------------------
// DELIBERATELY ABSENT, and why -- the deferred claims this file does NOT
// cover, named rather than quietly dropped.
//
// Task 26's deferred claim 2: "the published post page renders the same step:
// a nested `<li>` inside `li > ul` starts at least 20px right of the item
// above it, at 390px." No committed post carries a list of any kind, let
// alone a nested one (src/content/posts.json is three press mentions, each a
// paragraph and a citation), and the published page is built from the
// committed file -- a draft made in the dashboard never reaches it. There is
// no way to put a nested list on /blog/<slug> from a browser test without
// editing committed content, so this cannot be asserted here. It belongs to a
// test that owns a fixture post, and blocks.tsx's own `nest`/`ListTree` are
// pinned in src/components/blog/__tests__/blocks.test.tsx meanwhile.
//
// "That window.prompt BLOCKS." The link test above proves the two halves that
// have consequences -- Cancel and OK take different paths, and the selection
// survives either -- but a modal's blocking is what makes those two paths
// observable at all, so there is no mutation that leaves it observable and
// unproved. Recorded as reasoning rather than written as a test that cannot
// fail.
//
// "That a screen reader can reach a host." The accessible-name and tab-order
// halves are asserted above. What an actual screen reader announces is not
// something Playwright can observe, and a test named for it would be a claim
// about software this suite never runs.
