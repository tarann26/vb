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

  test('the link text stays out of the Copy button on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openDashboard(page, '/edit/manage/numbers');

    // THE INK, measured with a Range over the text -- NOT the element's own
    // bounding box, which is the measurement that made an earlier version of
    // this test unable to fail. A link is one 53-character word with no space
    // in it: ordinary wrapping cannot break it anywhere, so it simply runs out
    // of the narrow flex item it is in and paints over whatever is beside it,
    // while the BOX stays obediently at its laid-out width and every assertion
    // about the box passes. Measured directly: 238px of text inside a 160px
    // box, ending 79px past the button's left edge.
    const measured = await page.evaluate(() => {
      const link = document.querySelector('[data-link="instagram"]');
      const button = document.querySelector('[data-link="instagram"] ~ button');
      const card = document.querySelector('[data-card="campaigns"]');
      if (!link || !button || !card) return null;
      const range = document.createRange();
      range.selectNodeContents(link);
      const ink = range.getBoundingClientRect();
      return {
        inkRight: ink.right,
        inkWidth: ink.width,
        buttonLeft: button.getBoundingClientRect().left,
        cardRight: card.getBoundingClientRect().right,
      };
    });
    expect(measured, 'the row is not on the page').not.toBeNull();

    expect(measured!.inkWidth).toBeGreaterThan(0);
    // Not over the button she is about to press.
    expect(measured!.inkRight).toBeLessThanOrEqual(measured!.buttonLeft + 1);
    // And not out of the card either way.
    expect(measured!.inkRight).toBeLessThanOrEqual(measured!.cardRight + 1);
  });
});
