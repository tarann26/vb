import { expect, test } from '@playwright/test';

// Phase 5. Everything jsdom structurally cannot see: real geometry, real
// computed style, real navigation, real client-side redirects.
//
// It runs against the committed posts.json, whose three Mention posts are
// pinned by shape.test.ts -- so a fourth post arriving without a decision on
// the nine invented press entries changes what this spec sees, and that is
// deliberate.
//
// Written after looking at both pages at both widths, not before. The
// brief's own floors for the card image (`> 200` wide, `> 150` tall) are
// gone: PostCard boxes every image in a fixed 192px-tall wrapper at full
// card width, so the narrowest real card is 358x192 and neither floor could
// ever fail. Phase 3 shipped an e2e spec that reddened faithfully under four
// rounds of mutation against a baseline of 96px grey thumbnails; an
// assertion that detects change is not the same as an assertion that is
// right. What replaced them is below, and pins the constants that actually
// hold the row together.

const WIDTHS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

// `h-48` on PostCard's image wrapper. The three committed images are 1.78,
// 0.75 and 0.81 intrinsic -- two of them portrait -- and the only reason
// they form one tidy row is that this box normalises them and `object-cover`
// crops to it.
const CARD_IMAGE_HEIGHT = 192;

// text-ink (#222222) on bg-brand (#C8D8E8), 10.9:1.
const INK = 'rgb(34, 34, 34)';
const BRAND = 'rgb(200, 216, 232)';

for (const size of WIDTHS) {
  test.describe(`${size.name} (${size.width}px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    // This covers the CLIENT-SIDE hop only -- App.tsx's
    // `<Route path="/blogs" element={<Navigate to="/blog" replace />} />`.
    //
    // Task 8 also added a real HTTP 301 for /blogs in public/_redirects,
    // above the catch-all, and that rule is NOT exercised here and cannot
    // be: neither `vite` nor `vite preview` reads `_redirects` at all, so
    // under Playwright the SPA fallback is the only thing that can move
    // this URL. The 301 and its ordering are pinned in
    // src/test/hosting.test.ts; do not read a green here as covering it.
    test('/blogs lands on /blog', async ({ page }) => {
      await page.goto('/blogs');
      await expect(page).toHaveURL(/\/blog$/);
      // Level 1, not 2. /blog has exactly one h1 ("All Stories") as of the
      // Task 8 review fix, and no h2 anywhere on the page -- so a
      // `level: 2` lookup here would have matched nothing and failed for
      // the wrong reason. Naming the heading is what makes this test say
      // "we arrived at the index" rather than "we arrived somewhere".
      await expect(page.getByRole('heading', { level: 1, name: 'All Stories' })).toBeVisible();
    });

    test('the index shows three cards, each in colour and none clipped', async ({ page }) => {
      await page.goto('/blog');
      const cards = page.locator('article');
      await expect(cards).toHaveCount(3);

      for (let i = 0; i < 3; i += 1) {
        const card = cards.nth(i);
        const image = card.locator('img');
        await image.scrollIntoViewIfNeeded();
        const box = await image.boundingBox();
        const cardBox = await card.boundingBox();
        expect(box, `card ${i} image has no box`).not.toBeNull();
        expect(cardBox, `card ${i} has no box`).not.toBeNull();

        // The image fills its card edge to edge (`w-full` inside an
        // overflow-hidden wrapper) and stands exactly the normaliser's
        // height. Both are constants of the component rather than of the
        // viewport, which is the point: they hold at 1280 and at 390, and
        // they redden the moment h-48 changes, the object-fit changes, or
        // the grid stops giving a card its full column.
        expect(box!.height, `card ${i} image height`).toBe(CARD_IMAGE_HEIGHT);
        expect(box!.width, `card ${i} image width`).toBeCloseTo(cardBox!.width, 1);

        // A src that 404s still lays out a box of exactly this size, so
        // geometry alone cannot tell a rendered photo from a broken one.
        // naturalWidth can.
        const natural = await image.evaluate((el) => (el as HTMLImageElement).naturalWidth);
        expect(natural, `card ${i} image did not load`).toBeGreaterThan(0);

        // The filter is read off the IMG ITSELF and off its WRAPPER: CSS
        // filter is not inherited, and reading only one of the two is
        // exactly how this repository's eleventh unfalsifiable assertion
        // happened -- it asserted `filter: none` on an img while the
        // grayscale sat on the wrapper, and passed on the shipped defect
        // four times over.
        const filters = await image.evaluate((el) => ({
          own: getComputedStyle(el).filter,
          wrapper: getComputedStyle(el.parentElement!).filter,
        }));
        expect(filters.own, `card ${i} image filter`).toBe('none');
        expect(filters.wrapper, `card ${i} wrapper filter`).toBe('none');
      }
    });

    test('a card opens the post inside the site, not the publication', async ({ page }) => {
      await page.goto('/blog');
      const card = page.locator('article').first();
      const title = (await card.locator('h3').innerText()).trim();
      await card.locator('a').first().click();
      await expect(page).toHaveURL(/\/blog\/[a-z0-9-]+$/);
      // Landing on a /blog/<slug> URL is only half of it: the old press
      // card pointed at the publication, and the thing that proves this one
      // does not is that the post we arrive at is the post whose card we
      // clicked.
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveText(title);
    });

    test('the post body reads as a column, not full bleed', async ({ page }) => {
      await page.goto('/blog/bw-hotelier-regional-flair');
      const article = page.locator('article');
      const box = await article.boundingBox();
      expect(box).not.toBeNull();
      // max-w-3xl is 48rem = 768px. On a 1280 viewport the column must be
      // bounded; on 390 it fills the width minus the px-4 gutters.
      if (size.width === 1280) {
        expect(box!.width).toBeLessThanOrEqual(768);
        expect(box!.width).toBeGreaterThan(600);
      } else {
        expect(box!.width).toBeLessThanOrEqual(size.width);
        expect(box!.width).toBeGreaterThan(300);
      }
    });

    test('the type badge is legible -- ink on brand, never white', async ({ page }) => {
      await page.goto('/blog/bw-hotelier-regional-flair');
      const badge = page.getByText('In the press', { exact: true });
      await expect(badge).toBeVisible();
      const colours = await badge.evaluate((el) => {
        const style = getComputedStyle(el);
        return { color: style.color, background: style.backgroundColor };
      });
      // #C8D8E8 with white text is 1.45:1 and unreadable -- the exact
      // failure the spec's own palette decision exists to prevent, and the
      // class of bug a numeric assertion catches and a screenshot does not.
      // Both assertions on the foreground, deliberately: the equality is
      // what actually holds the colour, and the inequality is what names
      // the hazard for whoever reads this after breaking it.
      expect(colours.color).not.toBe('rgb(255, 255, 255)');
      expect(colours.color).toBe(INK);
      expect(colours.background).toBe(BRAND);
    });

    test('the citation block links out, and the link is reachable', async ({ page }) => {
      await page.goto('/blog/bw-hotelier-regional-flair');
      const link = page.getByRole('link', { name: 'Read it' });
      await expect(link).toHaveAttribute('href', /^https:\/\/www\.bwhotelier\.com\//);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toBeInViewport();
    });

    test('a slug no post has renders the not-found page, not a blank one', async ({ page }) => {
      await page.goto('/blog/no-such-post');
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByRole('article')).toHaveCount(0);
      // An h1 and no article is also true of the homepage, of /about and of
      // every other route in the app, so on its own it proves nothing about
      // WHICH page this is. NotFound's own copy is what does.
      await expect(page.getByText('Page not found')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
    });
  });
}

// Not per-width: a numbered list either shows numbers or it does not.
test('an ordered list renders with visible markers -- preflight strips them without list-decimal', async ({ page }) => {
  // Uses the /blog index page's own DOM to prove the rule is in the shipped
  // stylesheet at all, independent of whether a committed post happens to
  // contain an ordered list today. The three migrated Mentions do not, which
  // is exactly why this checks the RULE rather than a rendered post.
  await page.goto('/blog');
  const listStyle = await page.evaluate(() => {
    const ol = document.createElement('ol');
    ol.className = 'list-decimal';
    ol.innerText = 'x';
    document.body.appendChild(ol);
    const value = getComputedStyle(ol).listStyleType;
    ol.remove();
    return value;
  });
  expect(listStyle).toBe('decimal');
});
