import { expect, test, type Page } from '@playwright/test';
import { mockEditBackend } from './edit-backend';

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

const CONTENT_CLASS = 'section .absolute.inset-0.flex';

interface Rect {
  id: string;
  src: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Every photo box, in document order, with the photo currently inside it.
// Document order is POSITION -- what must not change -- and `id`/`src` are the
// photo sitting there, which is what a swap moves.
async function boxes(page: Page): Promise<Rect[]> {
  return page.evaluate((selector) => {
    const container = document.querySelector(selector);
    if (!container) throw new Error('collage container not found');
    return [...container.querySelectorAll('[data-collage-photo-id]')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-collage-photo-id') ?? '',
        src: el.querySelector('img')?.getAttribute('src') ?? null,
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
  }, CONTENT_CLASS);
}

// A viewport point that REALLY resolves to this photo's box -- asked of the
// browser rather than assumed from the rectangle.
//
// The obvious "use the centre of the box" is wrong here for two independent
// reasons this hero actually has: Hero.tsx's own content column is
// `relative z-10` and paints over the middle of the collage (the same
// stacking fact e2e/collage-hit-test.spec.ts exists for), and every box's
// bottom-right corner is EditableImage's camera badge, a <label> whose press
// must never start a drag. Scanning and checking what is under each candidate
// finds a point that is neither.
async function grabPoint(page: Page, photoId: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((id) => {
    const box = document.querySelector(`[data-collage-photo-id="${id}"]`);
    if (!box) return null;
    const r = box.getBoundingClientRect();
    for (let fy = 0.2; fy <= 0.8; fy += 0.15) {
      for (let fx = 0.2; fx <= 0.8; fx += 0.15) {
        const x = Math.round(r.x + r.width * fx);
        const y = Math.round(r.y + r.height * fy);
        if (x < 1 || y < 1 || x > window.innerWidth - 2 || y > window.innerHeight - 2) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        if (hit.closest('label, button')) continue;
        if (hit.closest('[data-collage-photo-id]')?.getAttribute('data-collage-photo-id') === id) return { x, y };
      }
    }
    return null;
  }, photoId);
  expect(point, `no point inside ${photoId} resolves to it -- it is covered by something`).not.toBeNull();
  return point as { x: number; y: number };
}

// A point inside the collage that is NOT any photo box: one of the 4px gaps
// between two children of a split. That is one of the three "nothing to drop
// on" cases the plan names (a divider, the gap, outside).
async function gapPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((selector) => {
    const container = document.querySelector(selector);
    if (!container) return null;
    const r = container.getBoundingClientRect();
    for (let y = Math.round(r.y) + 2; y < Math.min(r.bottom, window.innerHeight) - 2; y += 3) {
      for (let x = Math.round(r.x) + 2; x < Math.min(r.right, window.innerWidth) - 2; x += 1) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !container.contains(hit)) continue;
        if (hit.closest('[data-collage-photo-id]')) continue;
        return { x, y };
      }
    }
    return null;
  }, CONTENT_CLASS);
  expect(point, 'no gap between two boxes was reachable -- the scan found only photos').not.toBeNull();
  return point as { x: number; y: number };
}

// The collage panel's OWN status line. `getByRole('status')` alone is
// ambiguous on this page: the Publish bar renders its validation summary with
// the same role.
function panelStatus(page: Page) {
  return page.locator('[data-collage-panel]').getByRole('status');
}

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  await page.evaluate(async () => {
    const bounded = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
    await bounded(document.fonts.ready, 3000);
    const images = [...document.querySelectorAll('img')].filter((img) => !img.complete);
    await bounded(
      Promise.all(
        images.map(
          (img) =>
            new Promise((r) => {
              img.addEventListener('load', r, { once: true });
              img.addEventListener('error', r, { once: true });
            }),
        ),
      ),
      5000,
    );
  });
}

// Puts the hero's own top edge at the top of the viewport. The collage is
// `absolute inset-0` inside a `min-h-screen` section, and at /edit that
// section starts ~286px down the page (the Publish bar and the dashboard
// link sit above it), so a third of the collage is below the fold until this
// runs -- and `document.elementFromPoint`, which every drag here depends on,
// only ever hit-tests what is currently ON screen. Called after `settle`,
// which is what forces `scroll-behavior: auto`; without that the app's own
// smooth scrolling leaves this still animating while the first measurement is
// taken.
async function focusCollage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const section = document.querySelector('section');
    if (!section) throw new Error('no hero section');
    window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY);
  });
}

// Waits until the collage's own rectangle stops moving.
//
// `settle` above bounds every wait it makes (an unbounded wait on an image
// that fires neither load nor error hangs the whole spec), which means it can
// return while a late webfont or a lazily-decoded photo is still about to
// change the hero's height -- and this hero's height is content-driven
// (`min-h-screen` is a FLOOR). A point measured a frame before that lands
// somewhere else a frame after, which is exactly the shape of flake that
// teaches everyone to ignore a suite. Two agreeing measurements, not a fixed
// sleep: under four parallel workers the dev server is slow by an amount no
// constant is right for.
async function waitForStableLayout(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (selector) => {
          const read = () => {
            const r = document.querySelector(selector)?.getBoundingClientRect();
            return r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}` : 'none';
          };
          const first = read();
          await new Promise((resolve) => setTimeout(resolve, 120));
          return first === read() ? first : 'moving';
        }, CONTENT_CLASS),
      { timeout: 10_000 },
    )
    .not.toBe('moving');
}

async function openEdit(page: Page): Promise<void> {
  await mockEditBackend(page);
  await page.goto('/edit');
  await expect(page.locator('[data-collage-photo-id]')).toHaveCount(16);
  await settle(page);
  await focusCollage(page);
  await waitForStableLayout(page);
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
    await openEdit(page);
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
    await openEdit(page);
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

  test('a drop into the gap between two boxes changes nothing, and says so out loud', async ({ page }) => {
    await openEdit(page);
    const before = await boxes(page);

    await dragBetween(page, await grabPoint(page, 'photo-1'), await gapPoint(page));

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
    await openEdit(page);

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
    await openEdit(page);
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
    await openEdit(page);
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
