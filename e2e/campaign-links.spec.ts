// The Copy buttons on the Numbers panel, in a real browser, because every
// claim they make is a browser claim.
//
// jsdom has no clipboard and no layout engine: it can be told that a click
// handler ran and that a sentence changed, which is what
// src/admin/areas/__tests__/NumbersArea.test.tsx asserts, and it cannot say
// whether anything ever reached the system clipboard, whether the fallback
// path leaves text a human can actually select, or whether a 53-character link
// fits inside a card on a phone. Those three are here.
import { expect, test } from '@playwright/test';
import { openDashboard } from './edit-backend';

// The address in the COMMITTED src/content/site.json (`seo.url`), which the
// edit-backend fixture serves as the real file. Written out rather than
// imported and interpolated: the whole question this pins is whether the link
// is built from the site's own configuration or from the host the dashboard
// happens to be served on, and a test that derived the expected string from
// the same place the component does could not tell those apart. The dev server
// here is localhost:8080, so the two are visibly different.
const ORIGIN = 'https://viabiancarestaurant.com';
const INSTAGRAM_LINK = `${ORIGIN}/?utm_source=instagram`;

test.describe('the copyable campaign links', () => {
  test('the Copy button really puts that row’s link on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openDashboard(page, '/edit/manage/numbers');

    await page.getByRole('button', { name: 'Copy your Instagram link' }).click();

    // The sentence AND the clipboard. The sentence alone is the claim, not the
    // evidence -- a button that reports success into a clipboard that never
    // received anything is the exact defect this spec exists for.
    await expect(page.getByText('Copied your Instagram link.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(INSTAGRAM_LINK);
  });

  test('a refused clipboard claims nothing, and the link is still selectable by hand', async ({ page }) => {
    // A browser really does refuse: no `navigator.clipboard` at all outside a
    // secure context, and a rejected `writeText` on a page that has lost focus
    // or a permission that was never granted. Forced here rather than waited
    // for, because the only honest way to test a failure path is to cause it.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('refused')) },
      });
    });
    await openDashboard(page, '/edit/manage/numbers');

    await page.getByRole('button', { name: 'Copy your Instagram link' }).click();

    await expect(page.getByText(/would not let the button copy/)).toBeVisible();
    // Nothing anywhere on the panel says it copied.
    await expect(page.getByText(/^Copied /)).toHaveCount(0);

    // THE WAY THROUGH WITHOUT THE BUTTON, measured rather than assumed: put a
    // real selection across the link the way a finger or a mouse would, and
    // read back what the browser says is selected.
    const selected = await page.evaluate(() => {
      const link = document.querySelector('[data-link="instagram"]');
      if (!link) return null;
      const range = document.createRange();
      range.selectNodeContents(link);
      const selection = window.getSelection();
      if (!selection) return null;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
    expect(selected).toBe(INSTAGRAM_LINK);

    // And the computed property that would take that away. Asserted as well as
    // the selection above because the two fail on different mutations: a
    // `user-select: none` on this element is a defect a human would feel
    // immediately, and it is not certain that a programmatic Range refuses to
    // read it.
    const userSelect = await page
      .locator('[data-link="instagram"]')
      .evaluate((el) => getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect);
    expect(userSelect).not.toBe('none');
  });

  test('every link points at the restaurant’s own address, not at the dashboard’s', async ({ page }) => {
    await openDashboard(page, '/edit/manage/numbers');

    // The dashboard is being served from somewhere else entirely, which is
    // what makes the four assertions below mean something. She can open /edit
    // on a preview deployment, and a link built from that host works for
    // exactly as long as the preview does.
    expect(new URL(page.url()).host).toBe('localhost:8080');
    for (const source of ['general', 'instagram', 'zomato', 'swiggy']) {
      await expect(page.locator(`[data-link="${source}"]`)).toHaveText(`${ORIGIN}/?utm_source=${source}`);
    }
    // The AI bucket is storable but is not a link she can place.
    await expect(page.locator('[data-link="ai"]')).toHaveCount(0);
  });

  test('a link stays inside its card on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openDashboard(page, '/edit/manage/numbers');

    const link = await page.locator('[data-link="instagram"]').boundingBox();
    const card = await page.locator('[data-card="campaigns"]').boundingBox();
    expect(link, 'the link has no box').not.toBeNull();
    expect(card, 'the card has no box').not.toBeNull();

    // A link is one 53-character word with no space in it, so nothing about
    // ordinary text wrapping saves this: without an explicit break rule it
    // runs out of the card and takes the page's width with it.
    expect(link!.x + link!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
    expect(link!.height).toBeGreaterThan(0);
  });
});
