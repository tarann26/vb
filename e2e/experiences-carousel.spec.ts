import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { contrastRatio } from '../src/test/contrast';

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

// Final branch review, Minor 3. Every card's caption sits on a photograph --
// a photo <img> and a gradient scrim div, both siblings absolutely
// positioned under the text -- which is exactly the shape
// `e2e/brand-contrast.spec.ts`'s own `sitsOverImageLayer` skips BY DESIGN:
// there is no `background-color` on any ancestor for `getComputedStyle` to
// read, so that test cannot see this caption at all, on any card, ever. This
// is the test that closes that structural gap, for the one card the review
// measured as hardest -- Cooking Class, whose photo is a near-white
// pamphlet, so its white caption has the least backdrop to sit on.
//
// Measured the way brand-contrast.spec.ts measures everything it CAN reach
// -- WCAG relative luminance, alpha-composited foreground-over-background,
// via this project's own `contrastRatio` -- just against real pixels
// instead of computed style, because a photo has no computed style to read.
// Each line's own text is hidden (`opacity: 0`, layout untouched) before its
// backdrop is screenshotted, so the sampled pixels are the raw photo+scrim
// with no bright glyph pixels mixed in to inflate the reading -- averaging
// glyph pixels into the "background" sample is what made an earlier
// same-region measurement read as low as 4.22:1 (see Experiences.tsx's own
// comment on the scrim for that number's full history and why it undercounts).
test('the Cooking Class caption clears AA contrast against its own photo, line by line', async ({ page }) => {
  const card = page.locator('[data-testid="experience-card-cooking-class"]');
  await card.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox();
  expect(cardBox, 'Cooking Class card has no box at all').not.toBeNull();

  function parseRGBA(value: string): { r: number; g: number; b: number; a: number } {
    const m = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
    if (!m) throw new Error(`not an rgb/rgba colour: ${value}`);
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
  }
  // The Porter-Duff "over" operator -- the same one brand-contrast.spec.ts
  // uses for a translucent text colour (`text-white/80`'s own opacity
  // modifier), reproduced here rather than imported: that copy lives inside
  // a `page.evaluate` closure with no module scope to export from.
  function over(top: { r: number; g: number; b: number; a: number }, bottom: { r: number; g: number; b: number }) {
    return {
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
    };
  }
  function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
    return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
  }

  const failures: string[] = [];
  for (const tag of ['h3', 'p'] as const) {
    const line = card.locator(tag);
    const box = await line.boundingBox();
    expect(box, `Cooking Class has no <${tag}>`).not.toBeNull();
    const color = parseRGBA(await line.evaluate((el) => getComputedStyle(el).color));

    await line.evaluate((el) => {
      (el as HTMLElement).style.opacity = '0';
    });
    const buf = await card.screenshot();
    await line.evaluate((el) => {
      (el as HTMLElement).style.opacity = '';
    });

    const left = Math.max(0, Math.round(box!.x - cardBox!.x));
    const top = Math.max(0, Math.round(box!.y - cardBox!.y));
    const width = Math.min(Math.round(box!.width), cardBox!.width - left);
    const height = Math.min(Math.round(box!.height), cardBox!.height - top);
    const { data, info } = await sharp(buf)
      .extract({ left, top, width, height })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count += 1;
    }
    const bg = { r: r / count, g: g / count, b: b / count };
    const fg = color.a < 1 ? over(color, bg) : color;
    const ratio = contrastRatio(toHex(fg), toHex(bg));
    if (ratio < 4.5) {
      failures.push(`<${tag}>: ${ratio.toFixed(2)}:1 (needs 4.5:1) -- text ${toHex(fg)} on photo+scrim ${toHex(bg)}`);
    }
  }

  expect(failures).toEqual([]);
});
