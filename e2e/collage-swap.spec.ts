import { expect, test, type Page } from '@playwright/test';
import { collageBoxes as boxes, grabPoint, openCollage, waitForStableLayout } from './collage-page';

// Plan 9, Task 4: dragging one collage photo onto another exchanges the two,
// and changes no box.
//
// Everything here needs a real browser and could not be checked in vitest at
// all. A drag is a sequence of pointer events routed by HIT TESTING, and jsdom
// has no layout engine: every box it reports is 0x0, `elementFromPoint`
// answers nothing useful, and `setPointerCapture` does not exist. Firing
// `pointerdown` there and calling it a drag is the exact evasion that shipped
// a completely inert control in this project once already -- which is why
// src/admin/__tests__/CollageEditor.test.tsx deliberately stops at markup and
// button clicks, and every claim about DRAGGING lives here.
//
// The four properties, each one a different way this feature could ship
// broken:
//   1. A drag really exchanges the two photos, and moves no box.
//   2. A drop that lands on nothing says so, visibly.
//   3. A photo she has just picked keeps its local preview when it travels --
//      the swap unmounts both boxes, and a preview held inside the <img>'s own
//      component dies with them.
//   4. The same edit is reachable with no drag at all, by real touch taps.

// The centre of a divider handle -- the first of the three "nothing to drop
// on" cases the plan names (a divider, the gap, outside).
//
// It is the gap, too, and that is not a coincidence: from Task 5 a 16px handle
// is centred on every 4px gap in the collage, so at /edit there is no bare gap
// left to land on. Dropping a photo on the line between two boxes is exactly
// the mistake this refusal exists for.
async function dividerPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const handle = document.querySelector('[data-collage-divider]');
    if (!handle) return null;
    const r = handle.getBoundingClientRect();
    const x = Math.round(r.x + r.width / 2);
    const y = Math.round(r.y + r.height / 2);
    if (y < 1 || y > window.innerHeight - 2) return null;
    // Asked of the browser, not assumed: if something paints over the handle
    // this is not the case the test means to exercise.
    return document.elementFromPoint(x, y)?.closest('[data-collage-divider]') ? { x, y } : null;
  });
  expect(point, 'no divider handle was reachable to drop onto').not.toBeNull();
  return point as { x: number; y: number };
}

// The collage panel's OWN status line. `getByRole('status')` alone is
// ambiguous on this page: the Publish bar renders its validation summary with
// the same role.
function panelStatus(page: Page) {
  return page.locator('[data-collage-panel]').getByRole('status');
}

async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // More than one step, and more than DRAG_THRESHOLD_PX of travel: a single
  // jump would deliver one pointermove and never let the press become a drag.
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test.describe('dragging one collage photo onto another, at 1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the two photos exchange places and not one of the sixteen boxes moves', async ({ page }) => {
    await openCollage(page, '/edit');
    const before = await boxes(page);
    // Two photos in different branches of the tree, so a swap that merely
    // reordered siblings could not produce this.
    const fromId = 'photo-1';
    const toId = 'photo-16';
    const fromIndex = before.findIndex((b) => b.id === fromId);
    const toIndex = before.findIndex((b) => b.id === toId);
    expect(fromIndex).toBeGreaterThanOrEqual(0);
    expect(toIndex).toBeGreaterThanOrEqual(0);
    expect(before[fromIndex].src).not.toBe(before[toIndex].src);

    await dragBetween(page, await grabPoint(page, fromId), await grabPoint(page, toId));
    await expect(panelStatus(page)).toContainText('Swapped.');

    const after = await boxes(page);
    // The two named photos have traded POSITIONS...
    expect(after[fromIndex].id).toBe(toId);
    expect(after[toIndex].id).toBe(fromId);
    expect(after[fromIndex].src).toBe(before[toIndex].src);
    expect(after[toIndex].src).toBe(before[fromIndex].src);
    // ...every other position still holds the photo it held...
    before.forEach((box, i) => {
      if (i === fromIndex || i === toIndex) return;
      expect(after[i].id, `position ${i} changed photo`).toBe(box.id);
    });
    // ...and every box is exactly the rectangle it was. This is the owner's
    // own rule -- "The boxes keep their shape" -- measured rather than
    // asserted about the data.
    expect(after.map((b) => [b.x, b.y, b.width, b.height])).toEqual(before.map((b) => [b.x, b.y, b.width, b.height]));
  });

  // The plan's Step 2 -- "she needs to see which box will receive it" --
  // stated as the thing that is observable: mid-drag, before the release, the
  // box under the pointer is marked as the destination and the one being
  // carried is marked as the source. Both marks are `data-collage-overlay`,
  // which is why they can be asserted rather than eyeballed.
  test('mid-drag, the box under the pointer is marked as the destination', async ({ page }) => {
    await openCollage(page, '/edit');
    const from = await grabPoint(page, 'photo-1');
    const to = await grabPoint(page, 'photo-16');

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 12 });

    await expect(page.locator('[data-collage-photo-id="photo-16"] [data-collage-overlay="target"]')).toHaveCount(1);
    await expect(page.locator('[data-collage-photo-id="photo-1"] [data-collage-overlay="dragging"]')).toHaveCount(1);
    // Exactly one destination is ever marked -- a highlight on two boxes at
    // once would be worse than none.
    await expect(page.locator('[data-collage-overlay="target"]')).toHaveCount(1);

    await page.mouse.up();
  });

  test('a drop onto the line between two boxes changes nothing, and says so out loud', async ({ page }) => {
    await openCollage(page, '/edit');
    const before = await boxes(page);

    await dragBetween(page, await grabPoint(page, 'photo-1'), await dividerPoint(page));

    await expect(panelStatus(page)).toHaveText(
      'Nothing to swap with there — this photo stayed where it was. Drop it on top of another photo.',
    );
    expect(await boxes(page)).toEqual(before);
  });

  // Gate review finding (Important), proven rather than argued: a swap
  // re-keys BOTH boxes (a photo's React key is its own id, and the id travels
  // with the photo), so React unmounts both subtrees. A preview held inside
  // EditableImage died there and the <img> fell back to a derivative path the
  // Cloudflare build has not written yet -- visibly broken for the rest of
  // the session. src/admin/previews.ts moved the preview above the component;
  // this is what would go red if it moved back.
  test('a photo she just picked keeps its own preview when she drags it somewhere else', async ({ page }) => {
    await page.route('**/api/upload**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // A derivative path that genuinely does not exist on this server:
        // if the preview is lost, this 404s and she sees a broken image.
        body: JSON.stringify({ path: 'assets-source/hero/e2e.jpg', contentPath: '/images/hero/e2e-not-built-yet.webp' }),
      });
    });
    await openCollage(page, '/edit');

    const source = page.locator('[data-editable-image-path="galleries.heroCollage.photo-1"]');
    await source.locator('input[type="file"]').setInputFiles({
      name: 'picked.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
    });
    await expect(source.locator('img')).toHaveAttribute('src', /^blob:/);
    // The picked photo has its own intrinsic size, and swapping an <img>'s
    // src re-lays nothing out here (`flexBasis: 0`) but does re-decode --
    // measure once that has settled rather than during it.
    await waitForStableLayout(page);

    await dragBetween(page, await grabPoint(page, 'photo-1'), await grabPoint(page, 'photo-16'));
    await expect(panelStatus(page)).toContainText('Swapped.');

    // The preview followed the PHOTO, not the box it left.
    await expect(page.locator('[data-editable-image-path="galleries.heroCollage.photo-1"] img')).toHaveAttribute(
      'src',
      /^blob:/,
    );
    // ...and the not-yet-built derivative is on screen nowhere.
    await expect(page.locator('img[src="/images/hero/e2e-not-built-yet.webp"]')).toHaveCount(0);
  });
});

// The spec's Risks section is a mandate, not a preference: a phone gets the
// same edit through taps. Driven by real touch input on a touch-emulating
// context -- `page.touchscreen` dispatches through the browser's own input
// pipeline, so the pointer events the editor sees carry
// `pointerType === 'touch'`, which the first assertion below confirms rather
// than assumes. A stubbed `matchMedia` would prove nothing at all.
test.describe('rearranging the collage by tapping, at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tap a photo, choose Swap, tap another: the two exchange and no box moves', async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener(
        'pointerdown',
        (event) => {
          (window as unknown as { __pointerTypes: string[] }).__pointerTypes ??= [];
          (window as unknown as { __pointerTypes: string[] }).__pointerTypes.push(event.pointerType);
        },
        true,
      );
    });
    await openCollage(page, '/edit');
    const before = await boxes(page);
    const fromIndex = before.findIndex((b) => b.id === 'photo-1');
    const toIndex = before.findIndex((b) => b.id === 'photo-16');

    const start = await grabPoint(page, 'photo-1');
    await page.touchscreen.tap(start.x, start.y);

    // Real touch, not a synthesised mouse click -- the whole point of this
    // path is that it works for a finger.
    expect(await page.evaluate(() => (window as unknown as { __pointerTypes: string[] }).__pointerTypes)).toContain(
      'touch',
    );

    await expect(page.getByText(`Photo ${fromIndex + 1} of 16`)).toBeVisible();
    await page.getByRole('button', { name: 'Swap this photo with another photo' }).tap();
    await page
      .locator('[data-collage-photo-id="photo-16"]')
      .getByRole('button', { name: 'Swap the selected photo into this box' })
      .tap();

    const after = await boxes(page);
    expect(after[fromIndex].id).toBe('photo-16');
    expect(after[toIndex].id).toBe('photo-1');
    expect(after.map((b) => [b.width, b.height])).toEqual(before.map((b) => [b.width, b.height]));
  });

  // The other half of the touch decision, and the reason a finger drag is NOT
  // a swap gesture: the collage is `absolute inset-0` over the whole hero, so
  // sixteen boxes cover the top screenful of a 4800px page. If a press on one
  // of them armed a drag, every attempt to scroll past the hero would travel
  // far enough to become one, the browser's own scroll would then fire
  // `pointercancel`, and she would get "that drag was interrupted" for simply
  // reading her own page.
  //
  // Driven through the browser's real touch pipeline (CDP
  // `Input.dispatchTouchEvent`), not `dispatchEvent` -- a synthesised DOM
  // event would not scroll anything, so the property under test would not
  // even arise.
  test('a finger sliding across the collage scrolls the page, and starts nothing', async ({ page }) => {
    await openCollage(page, '/edit');
    const start = await grabPoint(page, 'photo-1');
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: start.x, y, radiusX: 8, radiusY: 8 }],
      });

    await touch('touchStart', start.y);
    for (let step = 1; step <= 6; step += 1) await touch('touchMove', start.y - step * 30);
    await touch('touchEnd', start.y - 180);

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(page.locator('[data-collage-panel]')).toHaveCount(0);
    await cdp.detach();
  });
});
