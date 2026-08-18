import { expect, test } from '@playwright/test';

// The owner's report: "All the experiences pages, when we open them, they are
// auto scrolled all the way to the bottom making it weird."
//
// This is a scroll-POSITION regression, so it can only live here. jsdom has
// no layout engine: `window.scrollY` there is a number nothing ever writes
// and `scrollHeight` is 0 for every element on the page, so the entire class
// of bug this file exists for is invisible to every vitest test in the repo.
// Deleting the fix leaves `npm test` completely green.
//
// WHY THE LANDING POSITION IS THE *BOTTOM* AND NOT SOME MIDDLE OFFSET, which
// is the part of the owner's wording that actually identifies the mechanism.
// A same-document router navigation does not reset the scroll offset -- the
// document is replaced under a viewport that stays exactly where it was. The
// homepage is long (8869px at 390px wide) and the Experiences carousel sits
// near its foot, so a visitor clicking a card is at y≈2894. The detail page
// that replaces it is short (1869px), and an offset past a document's own
// maximum is CLAMPED by the browser to that maximum. So the arrival offset is
// not "wherever they were", it is `scrollHeight - innerHeight` exactly: the
// literal bottom, every time, on every one of the four pages, at every width
// narrow enough for the homepage to out-scroll them. That clamp is why the
// bug looks deliberate rather than random, and it is what the assertions
// below pin -- they compare against each page's own maximum, not a constant.
const SLUGS = ['catering', 'cooking-class'] as const;

const VIEWPORTS = [
  { label: 'mobile', width: 390, height: 844 },
  { label: 'desktop', width: 1280, height: 800 },
] as const;

type Position = { y: number; max: number };

function readPosition(): Position {
  return {
    y: Math.round(window.scrollY),
    max: document.documentElement.scrollHeight - window.innerHeight,
  };
}

// One sentence that says what actually went wrong, rather than "expected 0,
// received 753" -- which names a number but not the symptom the owner sees.
function describeLanding(where: string, from: number, at: Position): string {
  const atBottom = at.max > 0 && at.y >= at.max - 2;
  const place = atBottom
    ? 'the very bottom of the page'
    : `${Math.round((at.y / Math.max(at.max, 1)) * 100)}% of the way down the page`;
  return (
    `arriving at ${where} from a page scrolled to ${from}px landed the visitor at ` +
    `${at.y}px, which is ${place} (its maximum scroll is ${at.max}px) instead of at the top`
  );
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.label} (${vp.width}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const slug of SLUGS) {
      test(`clicking the ${slug} card lands at the top of /${slug}, not its bottom`, async ({
        page,
      }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // The real flow: a visitor scrolls down to the carousel to see the
        // cards at all. `click()` would auto-scroll here anyway; doing it
        // explicitly is what lets the assertion below prove the homepage
        // really was deep-scrolled at the moment of the click, so a future
        // layout change that moves the carousel above the fold turns this
        // test into a loud failure rather than a silent no-op.
        const card = page.locator(`[data-testid="experience-card-${slug}"]`);
        await card.scrollIntoViewIfNeeded();
        const before = await page.evaluate(readPosition);
        expect(
          before.y,
          'this test is meaningless unless the homepage is genuinely scrolled down when the card is clicked',
        ).toBeGreaterThan(vp.height);

        await card.click();
        await expect(page).toHaveURL(new RegExp(`/${slug}$`));

        // Read twice. The first read catches the clamp itself, which happens
        // in the same tick as the document swap; the second catches a fix
        // that scrolls to the top and then loses the position again as lazy
        // images resolve and the document grows underneath it (the pages
        // gain 20-90px after first paint, measured).
        const immediate = await page.evaluate(readPosition);
        expect(immediate.y, describeLanding(`/${slug}`, before.y, immediate)).toBeLessThanOrEqual(1);

        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
        const settled = await page.evaluate(readPosition);
        expect(
          settled.y,
          describeLanding(`/${slug}`, before.y, settled) + ' (measured after the page settled)',
        ).toBeLessThanOrEqual(1);
      });

      test(`opening /${slug} directly still lands at the top`, async ({ page }) => {
        // The control. This path was never broken -- a full document load has
        // no previous offset to carry -- and it is here so that a "fix" which
        // somehow scrolls the wrong way on a cold load cannot pass unnoticed.
        await page.goto(`/${slug}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
        const at = await page.evaluate(readPosition);
        expect(at.y, describeLanding(`/${slug}`, 0, at) + ' (direct load)').toBeLessThanOrEqual(1);
      });
    }

    test('the blog index also lands at the top when reached from the homepage', async ({
      page,
    }) => {
      // Not an experiences page, and that is the point: the bug was never
      // specific to `/:slug`. BlogIndex.tsx and BlogsPage.tsx each already
      // called window.scrollTo, but only from their pagination handlers --
      // neither ever ran on ARRIVAL, so /blog landed at its own bottom too
      // (measured at 414px of a 414px maximum). This pins that the fix is the
      // route-wide one and not a third per-component copy.
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const link = page.locator('a[href="/blog"]').first();
      await link.scrollIntoViewIfNeeded();
      const before = await page.evaluate(readPosition);
      await link.click();
      await expect(page).toHaveURL(/\/blog$/);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      const at = await page.evaluate(readPosition);
      expect(at.y, describeLanding('/blog', before.y, at)).toBeLessThanOrEqual(1);
    });
  });
}

test.describe('desktop (1280px)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the back button still restores where the visitor was, and is not reset to the top', async ({
    page,
  }) => {
    // The guard on the fix over-reaching, and the reason it keys on
    // navigation TYPE rather than just on the pathname changing.
    //
    // Chromium already restores the scroll offset of a same-document history
    // entry by itself (`history.scrollRestoration === 'auto'`), and it does
    // this correctly today -- measured at 2648px out and 2648px back, before
    // any fix existed. A scroll-to-top that fires on every pathname change
    // would land on top of that restoration and send the visitor to the top
    // of the homepage instead of back to the carousel they came from, which
    // is a worse bug than the one being fixed and one nobody would attribute
    // to the fix. Nothing in jsdom can catch that either.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const card = page.locator('[data-testid="experience-card-catering"]');
    await card.scrollIntoViewIfNeeded();
    const before = await page.evaluate(readPosition);
    await card.click();
    await expect(page).toHaveURL(/\/catering$/);
    await page.waitForTimeout(300);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.waitForTimeout(800);
    const restored = await page.evaluate(readPosition);
    expect(
      restored.y,
      `going back to the homepage put the visitor at ${restored.y}px instead of restoring the ` +
        `${before.y}px they were at when they left -- the scroll reset is firing on history ` +
        `navigations, which it must not`,
    ).toBeGreaterThan(before.y - 50);
  });
});
