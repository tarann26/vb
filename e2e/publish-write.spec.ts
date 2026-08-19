// The first thing in this repository that has ever looked at what a publish
// actually SENDS.
//
// Every existing assertion about publishing reads the content back after a
// remount and infers the request from it. That is the exact blind spot the
// staged-photo bug lived in three separate times: a remount reads the
// registry, and the registry can be right while the body on the wire is
// wrong. So these assertions read `postData` -- the count and the identity of
// the staged photos actually on the wire -- and never what a remount reports.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockEditBackend, openDashboard, realContentJson } from './edit-backend';
import { observeRequests } from './observe-writes';

const PUBLISH = /\/api\/publish/;

// The first dish the REAL committed dishes.json holds, read rather than
// retyped -- our-story-carousel.spec.ts reads galleries.json the same way and
// for the same reason. A literal here would be a second copy of the owner's
// own menu, kept in sync by hand, and she renames dishes.
const DISHES: { name: string }[] = JSON.parse(realContentJson('dishes.json'));
const RENAMED = `${DISHES[0].name} con Gamberi`;

interface PublishFile {
  path: string;
  content: string;
  encoding: string;
  baseSha?: string;
}

async function acceptPublishes(page: Page): Promise<void> {
  await page.route('**/api/publish', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sha: 'e2ee2ee', publishId: 'e2e-publish', d1Paths: [] }),
    });
  });
}

// POST /api/upload?stage=1 (upload-photo.ts's `uploadStaged`, an XHR). It has
// to be answered or nothing stages at all: the dev server has no Worker
// behind it, answers the upload with the SPA fallback's HTML at 200, and
// PhotoField lands in its error state -- which leaves dishes.json clean, the
// Publish button disabled, and the two staged-photo cases below timing out on
// a click rather than on their own assertions. Same shape as
// collage-add-remove.spec.ts's own upload mock.
async function acceptStagedUploads(page: Page): Promise<void> {
  await page.route('**/api/upload**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        path: 'assets-source/food/staged-by-e2e.jpg',
        contentPath: '/images/food/staged-by-e2e-not-built-yet.webp',
      }),
    });
  });
}

// The first row of the Dishes panel, by its position rather than by its name.
// Dishes is the first panel of the Menu area, so a first visit opens it
// (open-sections.ts's seed) and this row is on screen before anything is
// clicked. `[data-item-row]` is ItemList.tsx's own marker and is what
// dashboard-sections.spec.ts already targets a row with.
function firstDishRow(page: Page) {
  return page.locator('[data-item-row]').first().getByRole('button').first();
}

// `{ exact: true }`, and it is not tidiness. getByLabel matches by SUBSTRING
// by default, and all five areas of this dashboard are mounted at once
// (hidden, never unmounted) -- so a bare 'Photo' resolves to three controls
// across two areas, one of which is the About area's "Description of your
// photo", a text input. Without it the deleted-record case below dies on a
// strict-mode violation before reaching its own assertion, and because that
// case is declared with test.fail a violation is REPORTED AS A PASS.
function photoPicker(page: Page) {
  return page.getByLabel('Photo', { exact: true });
}

// The two explicit throws are the difference between this spec and one that
// quietly asserts nothing: a typo'd key name fails loudly here instead of
// producing an empty array that every `toEqual([])` accepts.
function filesOf(postData: string | null): PublishFile[] {
  if (postData === null) throw new Error('the publish request carried no body at all');
  const body = JSON.parse(postData) as { files?: PublishFile[] };
  if (!Array.isArray(body.files)) throw new Error('the publish body has no files array');
  return body.files;
}

test.describe('what a publish actually sends', () => {
  test('sends only the file that changed, and sends it once', async ({ page }) => {
    await mockEditBackend(page);
    await acceptPublishes(page);
    const writes = observeRequests(page, PUBLISH);
    await openDashboard(page, '/edit/manage/menu');

    await firstDishRow(page).click();
    await page.getByLabel('Name').first().fill(RENAMED);
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: /^Publish/ }).click();
    await page.getByRole('button', { name: /^Yes/ }).click();
    await expect.poll(() => writes.length).toBe(1);

    const files = filesOf(writes[0].postData);
    expect(files.map((file) => file.path)).toEqual(['src/content/dishes.json']);
    expect(JSON.parse(files[0].content)[0].name).toBe(RENAMED);
  });

  // Backlog item 5's assertion, from the only side that can see it. A deleted
  // record's upload has always still been in the body; the reason nobody
  // could tell is that nothing ever read the body.
  //
  // Landed with a `test.fail` marker at Task 11 and turned into a plain
  // test() at Task 28, when RecordList's own `releaseStagedFor` made it pass.
  // That ordering was deliberate and honest: the observation is what makes the
  // fix provable, so it landed first and the fix turned it green.
  test('a record deleted before publishing takes its staged photo bytes with it', async ({ page }) => {
    await mockEditBackend(page);
    await acceptPublishes(page);
    await acceptStagedUploads(page);
    const writes = observeRequests(page, PUBLISH);
    await openDashboard(page, '/edit/manage/menu');

    await firstDishRow(page).click();
    await photoPicker(page).setInputFiles({
      name: 'dish.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]),
    });
    await page.getByRole('button', { name: /^Delete/ }).click();
    await page.getByRole('button', { name: /^Yes, delete/ }).click();

    await page.getByRole('button', { name: /^Publish/ }).click();
    await page.getByRole('button', { name: /^Yes/ }).click();
    await expect.poll(() => writes.length).toBe(1);

    const files = filesOf(writes[0].postData);
    const uploads = files.filter((file) => !file.path.startsWith('src/content/'));
    // The COUNT and the IDENTITY of the staged photos on the wire, not what a
    // remount reads back.
    expect(uploads).toEqual([]);
  });

  test('a photo she keeps IS on the wire, so the test above is not passing by accident', async ({ page }) => {
    await mockEditBackend(page);
    await acceptPublishes(page);
    await acceptStagedUploads(page);
    const writes = observeRequests(page, PUBLISH);
    await openDashboard(page, '/edit/manage/menu');

    await firstDishRow(page).click();
    await photoPicker(page).setInputFiles({
      name: 'dish.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]),
    });
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: /^Publish/ }).click();
    await page.getByRole('button', { name: /^Yes/ }).click();
    await expect.poll(() => writes.length).toBe(1);

    const uploads = filesOf(writes[0].postData).filter((file) => !file.path.startsWith('src/content/'));
    expect(uploads).toHaveLength(1);
  });

  // Review finding, and it was right: the first version of this test wrapped
  // its whole body in `if (await publish.isEnabled())`. The button is
  // disabled with nothing dirty, so that body never ran, and the only live
  // assertion left was that merely opening the dashboard publishes nothing --
  // which no mutation in this task's table targets. Both gates that stand
  // between a clean registry and a request are asserted directly here, and
  // neither is behind a conditional that can skip itself.
  test('a publish with nothing changed sends no request at all', async ({ page }) => {
    await mockEditBackend(page);
    await acceptPublishes(page);
    const writes = observeRequests(page, PUBLISH);
    await openDashboard(page, '/edit/manage/menu');

    // Gate one: the trigger she can actually see.
    const publish = page.getByRole('button', { name: /^Publish/ });
    await expect(publish).toBeDisabled();

    // Gate two: the confirmation's own accept button, which carries the same
    // `!isDirty` test and is the gate that decides, because a panel can stay
    // open across a registry change while the trigger behind it is not being
    // looked at (PublishBar.tsx's ConfirmPanel says so in its own comment).
    // Submitting the form directly is how the panel is reached at all here --
    // a disabled trigger cannot open it, and what is under test is what the
    // panel does once open with nothing to send, not the route in. The form
    // is addressed through the button it contains rather than by position,
    // since the dashboard mounts all five areas at once.
    const bar = page.locator('form').filter({ has: page.getByRole('button', { name: /^Publish/ }) });
    await bar.dispatchEvent('submit');
    const accept = page.getByRole('button', { name: /^Yes, publish/ });
    await expect(accept).toBeVisible();
    await expect(accept).toBeDisabled();

    // And nothing left the browser while all of that was on screen.
    await page.waitForTimeout(500);
    expect(writes).toEqual([]);
  });
});
