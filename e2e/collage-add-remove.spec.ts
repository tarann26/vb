import { expect, test, type Page } from '@playwright/test';
import { collageBoxes, grabPoint, heroCollagePhotoCount, openCollage } from './collage-page';

// Derived, not hardcoded -- see collage-page.ts's own comment on
// heroCollagePhotoCount for why a literal count is a trap in this suite
// specifically: the owner can add or remove a collage photo from /edit, which
// is exactly the gesture every test below drives.
const PHOTO_COUNT = heroCollagePhotoCount();

// Plan 9, Task 6: the collage can grow and shed photos from her own screen.
//
// What needs a real browser here is not the tree arithmetic --
// src/content/__tests__/collage.test.ts covers that against fixtures, right
// down to five add-then-remove cycles leaving the depth where it started. It
// is everything the arithmetic cannot see: that the controls are reachable at
// all, that "add" really opens a file picker rather than dropping an empty box
// on the page, that the new photo lands in the box she pointed at and NO other
// box moves, and that the space a removed photo leaves goes back to what it
// shared with.

// A one-pixel JPEG's worth of bytes -- enough for a real File through a real
// <input type="file">, which is what makes this an upload rather than a
// simulated one.
const PICKED = {
  name: 'picked.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
};

// The upload endpoint, answered with a derivative path that genuinely does not
// exist on this server: if the local preview is not shown, the new box is a
// visibly broken image, which is exactly what the assertion below would catch.
async function mockUpload(page: Page): Promise<void> {
  await page.route('**/api/upload**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ path: 'assets-source/hero/added.jpg', contentPath: '/images/hero/added-not-built-yet.webp' }),
    });
  });
}

function panel(page: Page) {
  return page.locator('[data-collage-panel]');
}

async function selectPhoto(page: Page, photoId: string): Promise<void> {
  const point = await grabPoint(page, photoId);
  await page.mouse.click(point.x, point.y);
  await expect(panel(page)).toHaveCount(1);
}

test.describe('adding and removing collage photos at 1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('add divides the box she pointed at, and moves no other box', async ({ page }) => {
    await mockUpload(page);
    await openCollage(page, '/edit');
    const before = await collageBoxes(page);
    const targetIndex = before.findIndex((b) => b.id === 'photo-8');
    const target = before[targetIndex];

    await selectPhoto(page, 'photo-8');
    // "Add" opens the picker itself -- there is no step where an empty box
    // exists on the page, which is why nothing has to refuse publishing one.
    await panel(page).getByRole('button', { name: 'Add another photo below this one, sharing its box' }).click();
    await panel(page).locator('input[type="file"]').setInputFiles(PICKED);

    await expect(page.locator('[data-collage-photo-id]')).toHaveCount(PHOTO_COUNT + 1);
    const after = await collageBoxes(page);
    const added = after.find((b) => !before.some((old) => old.id === b.id));
    expect(added).toBeDefined();
    const kept = after.find((b) => b.id === 'photo-8');
    expect(kept).toBeDefined();

    // Named by id, not found by geometry: two unrelated boxes elsewhere in
    // this arrangement happen to share photo-8's x and width, and a
    // geometric filter picked one of them up.
    //
    // The two now share exactly what photo-8 used to fill: stacked, the same
    // width, starting and ending where it did, and about half its height each.
    expect(kept?.x).toBe(target.x);
    expect(kept?.width).toBe(target.width);
    expect(added?.x).toBe(target.x);
    expect(added?.width).toBe(target.width);
    expect(kept?.y).toBe(target.y);
    // One pixel of slack, and only here: these are the two edges where a
    // half-pixel box height is rounded twice (once per box) instead of once.
    // Anything actually wrong -- a box in the wrong place, a stack that does
    // not fill its parent -- is out by far more than a pixel.
    expect(Math.abs((added?.y ?? 0) + (added?.height ?? 0) - (target.y + target.height))).toBeLessThanOrEqual(1);
    expect(Math.abs((kept?.height ?? 0) - (added?.height ?? 0))).toBeLessThanOrEqual(4);

    // Every OTHER photo is exactly the rectangle it was.
    const others = (boxes: typeof before) =>
      boxes.filter((b) => b.id !== 'photo-8' && b.id !== added?.id).map((b) => [b.id, b.x, b.y, b.width, b.height]);
    expect(others(after)).toEqual(others(before));

    // ...and the new box shows the photo she just chose, not the derivative
    // the deploy has not written yet.
    expect(added?.src).toMatch(/^blob:/);
    await expect(page.locator('img[src="/images/hero/added-not-built-yet.webp"]')).toHaveCount(0);
  });

  // Review finding (Minor): the sentence she reads after adding used to end
  // "nothing else moved", which is an absolute claim and false in exactly this
  // case. photo-6's parent (`right-top`) already runs as a row, so adding
  // BESIDE it splices the new pair into that parent rather than nesting -- and
  // one more child along a row means one more 4px gap to subtract before the
  // proportions are applied, so its sibling subtree (photo-7, the new photo,
  // photo-8) gives up a pixel or two. The test above adds BELOW a photo whose
  // parent runs the other way, which nests instead and genuinely moves nothing
  // -- which is why it stayed green while the sentence was wrong.
  //
  // photo-6, not photo-16: the Farfalle removal (Task 6) collapsed
  // `right-bottom`, the row split photo-16 used to share with its own pair,
  // out of the tree entirely. `right-top` is the surviving split with the
  // same property this test needs -- a row-direction parent with more than
  // one child already -- so adding beside one of ITS children exercises the
  // identical "splices in, does not nest" branch.
  test('adding into a parent that already runs the same way keeps every other photo’s share, and says only that', async ({
    page,
  }) => {
    await mockUpload(page);
    await openCollage(page, '/edit');
    const before = await collageBoxes(page);

    await selectPhoto(page, 'photo-6');
    await panel(page).getByRole('button', { name: 'Add another photo beside this one, sharing its box' }).click();
    await panel(page).locator('input[type="file"]').setInputFiles(PICKED);
    await expect(page.locator('[data-collage-photo-id]')).toHaveCount(PHOTO_COUNT + 1);

    const status = panel(page).getByRole('status');
    await expect(status).toContainText('every other photo keeps the share of the collage it had');
    await expect(status).not.toContainText('nothing else moved');

    // ...and the pixels back that up: the divided box is the only one that
    // really changes. photo-7 and photo-8 -- right-top's other two children,
    // the only boxes whose OWN share of that row moves when a fourth child
    // splices in (one more 4px gap subtracted before proportions are
    // applied) -- are within that gap arithmetic, measured at 1-3px on this
    // arrangement, bounded here at 4. Every other box lives outside
    // right-top entirely and has no reason to move by more than the 2px of
    // sub-pixel rounding slack used elsewhere in this suite; widening ITS
    // tolerance to 4 too would have hidden a real bug moving one of them.
    const after = await collageBoxes(page);
    const added = after.find((box) => !before.some((old) => old.id === box.id));
    expect(added).toBeDefined();
    const rightTopRowMates = new Set(['photo-7', 'photo-8']);
    before.forEach((box) => {
      if (box.id === 'photo-6') return;
      const now = after.find((candidate) => candidate.id === box.id);
      expect(now, `${box.id} left the collage`).toBeDefined();
      const tolerance = rightTopRowMates.has(box.id) ? 4 : 2;
      (['x', 'y', 'width', 'height'] as const).forEach((side) => {
        expect(Math.abs(now![side] - box[side]), `${box.id} ${side} moved more than the gap arithmetic`).toBeLessThanOrEqual(tolerance);
      });
    });
  });

  test('remove gives the space back to what the photo shared its box with', async ({ page }) => {
    await openCollage(page, '/edit');
    const before = await collageBoxes(page);
    // photo-10 and photo-11 are the two halves of one stacked pair, and they
    // sit on the right-hand edge of the hero -- clear of Hero.tsx's own
    // `relative z-10` content column, which covers the middle of the collage
    // and makes the boxes under it unclickable by design.
    const ten = before.find((b) => b.id === 'photo-10');
    const eleven = before.find((b) => b.id === 'photo-11');
    expect(ten).toBeDefined();
    expect(eleven).toBeDefined();

    await selectPhoto(page, 'photo-10');
    await panel(page).getByRole('button', { name: 'Remove this photo from the collage' }).click();

    await expect(page.locator('[data-collage-photo-id]')).toHaveCount(PHOTO_COUNT - 1);
    const after = await collageBoxes(page);
    expect(after.some((b) => b.id === 'photo-10')).toBe(false);
    const grown = after.find((b) => b.id === 'photo-11');
    expect(grown).toBeDefined();
    // It now spans from where photo-10 started down to where it itself ended.
    expect(grown?.y).toBe(ten?.y);
    expect(
      Math.abs((grown?.y ?? 0) + (grown?.height ?? 0) - ((eleven?.y ?? 0) + (eleven?.height ?? 0))),
    ).toBeLessThanOrEqual(1);
    expect(grown?.width).toBe(eleven?.width);

    // Nothing collapsed anywhere in the collage.
    for (const box of after) {
      expect(box.width, `${box.id} collapsed`).toBeGreaterThan(0);
      expect(box.height, `${box.id} collapsed`).toBeGreaterThan(0);
    }
  });

  test('the collage still covers the whole hero after an add and a remove', async ({ page }) => {
    await mockUpload(page);
    await openCollage(page, '/edit');
    const container = await page.evaluate(() => {
      const el = document.querySelector('section .absolute.inset-0.flex');
      const r = (el as Element).getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    });

    await selectPhoto(page, 'photo-12');
    await panel(page).getByRole('button', { name: 'Add another photo beside this one, sharing its box' }).click();
    await panel(page).locator('input[type="file"]').setInputFiles(PICKED);
    await expect(page.locator('[data-collage-photo-id]')).toHaveCount(PHOTO_COUNT + 1);

    await selectPhoto(page, 'photo-1');
    await panel(page).getByRole('button', { name: 'Remove this photo from the collage' }).click();
    await expect(page.locator('[data-collage-photo-id]')).toHaveCount(PHOTO_COUNT);

    const after = await collageBoxes(page);
    // The union of the boxes still reaches every edge of the hero: an edit
    // that left a hole would show up as a shortfall here, and nothing else in
    // this suite would notice it.
    expect(Math.min(...after.map((b) => b.x))).toBe(0);
    expect(Math.min(...after.map((b) => b.y))).toBe(0);
    expect(Math.abs(Math.max(...after.map((b) => b.x + b.width)) - container.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(Math.max(...after.map((b) => b.y + b.height)) - container.height)).toBeLessThanOrEqual(1);
  });
});

test.describe('adding and removing by tapping, at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tap a photo, tap Add below, and the picker is what opens', async ({ page }) => {
    await mockUpload(page);
    await openCollage(page, '/edit');
    const before = await collageBoxes(page);

    const start = await grabPoint(page, 'photo-8');
    await page.touchscreen.tap(start.x, start.y);
    await expect(panel(page)).toHaveCount(1);
    await panel(page).getByRole('button', { name: 'Add another photo below this one, sharing its box' }).tap();
    await panel(page).locator('input[type="file"]').setInputFiles(PICKED);

    await expect(page.locator('[data-collage-photo-id]')).toHaveCount(PHOTO_COUNT + 1);
    const after = await collageBoxes(page);
    const added = after.find((b) => !before.some((old) => old.id === b.id));
    expect(added?.src).toMatch(/^blob:/);
    expect(added?.width).toBeGreaterThan(0);
    expect(added?.height).toBeGreaterThan(0);
  });

  // photo-15, not photo-1: photo-1 is the full-height leftmost column, and
  // Task 6's rebalance (the owner's own "whitespace can be squashed" request)
  // widened it enough that it no longer disappears under the content column
  // at desktop -- but at a 390px phone width it is still a sliver too narrow
  // for grabPoint's scan (e2e/collage-page.ts) to land a tap on it anywhere.
  // photo-15 sits at the bottom of the `right` branch, clear of both the
  // content column and the panel, and grabPoint finds it easily.
  test('tap a photo, tap Remove, and it is gone', async ({ page }) => {
    await openCollage(page, '/edit');
    const start = await grabPoint(page, 'photo-15');
    await page.touchscreen.tap(start.x, start.y);
    await panel(page).getByRole('button', { name: 'Remove this photo from the collage' }).tap();
    await expect(page.locator('[data-collage-photo-id]')).toHaveCount(PHOTO_COUNT - 1);
    await expect(page.locator('[data-collage-photo-id="photo-15"]')).toHaveCount(0);
  });
});
