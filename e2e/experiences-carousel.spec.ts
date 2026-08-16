import { expect, test } from '@playwright/test';

// Every claim here is one jsdom structurally cannot make. Element existence
// is already covered by src/components/__tests__/Experiences.test.tsx; what
// is measured here is geometry, occlusion, and what a real pointer does.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('#experiences').scrollIntoViewIfNeeded();
});

test('every card is laid out with real width and height', async ({ page }) => {
  const cards = page.locator('[data-testid^="experience-card-"]');
  await expect(cards).toHaveCount(6);
  for (let i = 0; i < 6; i += 1) {
    const box = await cards.nth(i).boundingBox();
    expect(box, `card ${i} has no box at all`).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);
  }
});

test('the track scrolls horizontally and the last card is reachable', async ({ page }) => {
  const track = page.locator('[data-testid="experiences-track"]');
  const scroller = track.locator('xpath=..');
  // The carousel only earns its name if the content is wider than its
  // viewport. If these were ever equal the section would be a static row and
  // the last cards would simply be missing on a narrow screen.
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);

  const last = page.locator('[data-testid="experience-card-retail"]');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});

test('a Coming Soon stamp sits on top of its card, not behind it', async ({ page }) => {
  // retail is the sixth (last) card in a track wider than its viewport (see
  // the scroll test above), so its stamp starts outside the browser window
  // entirely -- boundingBox() does not auto-scroll, and elementFromPoint at
  // an off-window coordinate returns null regardless of what is painted on
  // the card itself. That would read as "nothing on top", the same verdict
  // a real occlusion bug produces, so it has to be scrolled into view first
  // or the hit test below is meaningless.
  await page.locator('[data-testid="experience-card-retail"]').scrollIntoViewIfNeeded();
  const stamp = page.locator('[data-testid="experience-stamp-retail"]');
  await expect(stamp).toBeVisible();
  const box = (await stamp.boundingBox())!;
  // Hit-testing the stamp's own centre point: if anything is painted over
  // it, elementFromPoint returns that instead. "toBeVisible" alone is
  // satisfied by an element with a real box that is completely covered.
  const onTop = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('[data-testid^="experience-stamp-"]')?.getAttribute('data-testid') ?? null;
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(onTop).toBe('experience-stamp-retail');
});

test('clicking a coming-soon card does nothing', async ({ page }) => {
  const before = page.url();
  await page.locator('[data-testid="experience-card-retail"]').click();
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
  await expect(page.locator('#experiences')).toBeVisible();
});

test('a coming-soon card is not reachable by keyboard either', async ({ page }) => {
  // The mouse case above would still pass if the card were a focusable
  // element with a suppressed click. This is what distinguishes "inert" from
  // "swallows the event".
  const focusable = await page
    .locator('[data-testid="experience-card-retail"]')
    .evaluate((el) => el.matches('a[href], button, [tabindex]') || el.querySelector('a[href], button, [tabindex]') !== null);
  expect(focusable).toBe(false);
});

test('clicking a linked card navigates to its page', async ({ page }) => {
  await page.locator('[data-testid="experience-card-catering"]').click();
  await expect(page).toHaveURL(/\/catering$/);
  await expect(page.getByRole('heading', { name: /catering/i }).first()).toBeVisible();
});

test('the nav offers Experiences as a section link, not a dropdown', async ({ page }) => {
  // The file's own beforeEach scrolls to #experiences for the six tests
  // above, which is exactly the scroll-down NavBar.tsx's own `showNavbar`
  // state treats as a reason to hide the bar (`opacity-0 -translate-y-full`
  // once `y > 100` and still increasing). Scrolled back to the top before
  // this test's own assertions run, so the nav is the thing actually on
  // screen when its link gets clicked -- not fighting the same auto-hide
  // behaviour the real site uses on scroll.
  await page.evaluate(() => window.scrollTo(0, 0));
  const nav = page.getByTestId('desktop-nav-links');
  await expect(nav.getByRole('button', { name: /experiences/i })).toHaveCount(0);
  const link = nav.getByRole('link', { name: /experiences/i });
  await expect(link).toHaveAttribute('href', '#experiences');
  await link.click();
  await expect(page.locator('#experiences')).toBeInViewport();
});
