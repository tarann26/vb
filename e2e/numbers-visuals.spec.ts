// Everything about the Numbers panel that jsdom cannot honestly assert.
//
// jsdom has no layout engine, so it can read a width off a style attribute and
// call that a bar. It cannot tell whether the bar was painted 4px wide inside a
// card 300px wide, whether the chart ran off the side of the phone, or whether
// two range pills landed on top of each other. Every claim below is a bounding
// box or a computed colour, measured in a real Chromium at the two widths she
// uses.
//
// NOT ONE ASSERTION IS POINTED AT A CLASS NAME, the same rule
// e2e/blog-controls.spec.ts states for its own controls: the dev server's
// Tailwind JIT never removes a rule inside a session, so a class assertion can
// be green against a stylesheet a cold production build would never produce.
// The card and bar hooks are `data-` attributes for exactly that reason, and
// they cost the stylesheet nothing.
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ANALYTICS_DRAWN, openDashboard } from './edit-backend';
import { contrast } from './contrast';

const WIDTHS = [390, 1280];

// The pressed pill's two colours, as Chromium reports them. Ink on brand:
// brand blue is a SURFACE colour at 1.45:1 on white and can never carry text,
// so what sits on it is ink.
const INK = 'rgb(34, 34, 34)';
const BRAND = 'rgb(200, 216, 232)';

async function openNumbers(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await openDashboard(page, '/edit/manage/numbers', { analytics: ANALYTICS_DRAWN });
  // The panel has ANSWERED, not merely mounted. Every card shows its real
  // heading while the request is still out, so waiting on a heading would
  // start measuring a screen that has not drawn anything yet.
  await expect(page.getByRole('img', { name: /Visits over the last/ })).toBeVisible();
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  expect(box, 'element has no box').not.toBeNull();
  return box!;
}

for (const width of WIDTHS) {
  test.describe(`the Numbers panel at ${width}px`, () => {
    test('the trend chart is drawn inside its card', async ({ page }) => {
      await openNumbers(page, width);
      const chart = await boxOf(page.getByRole('img', { name: /Visits over the last/ }));
      const card = await boxOf(page.locator('[data-card="trend"]'));

      expect(chart.width).toBeGreaterThan(0);
      expect(chart.height).toBeGreaterThan(0);
      // Inside its card on both horizontal edges. A chart that overflows its
      // card is the single most common way a hand-drawn SVG goes wrong at a
      // width nobody measured, and it is invisible to every other check in
      // this project.
      expect(chart.x).toBeGreaterThanOrEqual(card.x - 1);
      expect(chart.x + chart.width).toBeLessThanOrEqual(card.x + card.width + 1);
    });

    test('the page bars are proportional to their values', async ({ page }) => {
      await openNumbers(page, width);
      const lead = await boxOf(page.locator('[data-bar="/"]'));
      const second = await boxOf(page.locator('[data-bar="/catering"]'));

      // 400 against 100 in the fixture. MEASURED, not read off the style
      // attribute -- that is already covered in jsdom and would prove nothing
      // new here.
      expect(second.width / lead.width).toBeGreaterThan(0.22);
      expect(second.width / lead.width).toBeLessThan(0.28);
    });

    test('the busiest page fills its whole track, so a bar is a share of the leader', async ({ page }) => {
      await openNumbers(page, width);
      const fill = page.locator('[data-bar="/"]');
      // The track is the fill's own parent, so this needs no second hook in
      // the markup and costs the stylesheet nothing.
      const track = await boxOf(fill.locator('xpath=..'));
      const lead = await boxOf(fill);

      // THE RATIO ABOVE CANNOT SEE THIS, and that is why this test exists
      // separately: dividing each row by the SUM instead of by the leader
      // gives 80% and 20% here, whose ratio is still exactly 0.25. Only the
      // leader's own share of its track tells the two apart -- 100% against
      // 80% -- and the difference on screen is a card whose busiest page
      // never looks busy.
      expect(lead.width / track.width).toBeGreaterThan(0.98);
    });

    test('no bar escapes its card', async ({ page }) => {
      await openNumbers(page, width);
      const card = await boxOf(page.locator('[data-card="b"]'));
      const bar = await boxOf(page.locator('[data-bar="/"]'));

      expect(bar.x).toBeGreaterThanOrEqual(card.x);
      expect(bar.x + bar.width).toBeLessThanOrEqual(card.x + card.width + 1);
    });

    test('nothing on the panel scrolls sideways', async ({ page }) => {
      await openNumbers(page, width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('no range button overlaps another, and each is a real target', async ({ page }) => {
      await openNumbers(page, width);
      const buttons = page.getByRole('group', { name: 'How far back' }).getByRole('button');
      // Four, because the fixture's archive holds something. A control that
      // silently lost a pill would otherwise pass every claim below by having
      // nothing left to overlap.
      await expect(buttons).toHaveCount(4);

      const boxes = [];
      for (let i = 0; i < (await buttons.count()); i += 1) boxes.push(await boxOf(buttons.nth(i)));
      for (const box of boxes) {
        // WCAG 2.2 SC 2.5.8 AA. Asserted here rather than in jsdom because a
        // target size is geometry: padding, font size and line height decide
        // it together and none of the three is readable without a layout
        // engine.
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          const overlaps =
            boxes[a].x < boxes[b].x + boxes[b].width &&
            boxes[b].x < boxes[a].x + boxes[a].width &&
            boxes[a].y < boxes[b].y + boxes[b].height &&
            boxes[b].y < boxes[a].y + boxes[a].height;
          expect(overlaps, `pill ${String(a)} overlaps pill ${String(b)}`).toBe(false);
        }
      }
    });

    test('the pressed range reads as ink on brand, above 4.5:1', async ({ page }) => {
      await openNumbers(page, width);
      const pressed = page.getByRole('button', { name: 'Last 30 days' });

      // toHaveCSS, NOT a one-shot evaluate(getComputedStyle): these pills
      // carry a colour transition, and a read taken immediately after a class
      // flips returns the FROM value -- a test that passes on a defect and
      // fails on the fix. Rule 3 of e2e/README.md.
      await expect(pressed).toHaveCSS('color', INK);
      await expect(pressed).toHaveCSS('background-color', BRAND);

      // Equality alone is not enough: a future palette move could keep both
      // values off-white and still land under 4.5. The same argument
      // e2e/blog-controls.spec.ts already makes for its own pills, and the
      // helper is shared with it rather than copied.
      const colour = await pressed.evaluate((el) => getComputedStyle(el).color);
      const background = await pressed.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(contrast(colour, background)).toBeGreaterThanOrEqual(4.5);
    });
  });
}

test.describe('the busiest-times chart on a phone', () => {
  test('every cell is at least one full pixel wide', async ({ page }) => {
    await openNumbers(page, 390);
    const hours = page.getByRole('img', { name: /Indian time/ });
    // A legitimate design decision reports as a SKIP, not as a failure: the
    // CUT branch of the plan's Tasks 15 and 21 means this card genuinely does
    // not exist for a site whose RUM dataset offers no hour dimension, and a
    // red test would be the wrong report of that.
    if ((await hours.count()) === 0) test.skip(true, 'no hour dimension: the busiest-times card is cut');

    // The CELL, measured, not the chart divided by 24. Those are different
    // numbers and the difference is a whole gutter: the drawing is 24 hours
    // across PLUS a day-name column, inside a viewBox this spec deliberately
    // does not re-derive. Dividing the chart's own width by 24 overstates a
    // cell by about 14% and, at the width that first breaks this, passes.
    const cells = hours.locator('rect');
    // Seven days by twenty-four hours. A drawing that lost its rows would
    // otherwise satisfy every claim below by having one cell left to measure.
    await expect(cells).toHaveCount(168);
    const cell = await boxOf(cells.first());

    // Below one CSS pixel a cell stops being a cell and the card is a smear
    // she can read nothing off -- which is the whole question this card
    // answers, on the screen she is most likely to answer it from.
    expect(cell.width).toBeGreaterThanOrEqual(1);
    expect(cell.height).toBeGreaterThanOrEqual(1);
  });
});
