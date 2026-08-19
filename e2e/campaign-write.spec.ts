// The campaign write path, observed rather than mocked.
//
// WHERE THIS PROOF STOPS, said plainly rather than implied. This file
// observes what the BROWSER sent: exactly one POST for one arrival and four
// in-app page views. worker/__tests__/campaign.test.ts observes what the
// SERVER does with one POST -- exactly one row, and no row at all when the
// origin is wrong or a limit is spent. The two halves meet at an HTTP request
// whose shape both sides assert on, and nothing between them is mocked in a
// way either assertion depends on.
//
// What is NOT proven anywhere: that a real deployed Worker, behind a real
// route in wrangler.toml, receives it. That is a deploy-time check
// (`npm run verify:deploy`), not a test, and pretending otherwise is the kind
// of claim this project has been burned by.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { observeRequests } from './observe-writes';

const CAMPAIGN = /\/api\/campaign/;

async function quietBackend(page: Page, status = 204): Promise<void> {
  await page.route('**/api/campaign', async (route) => {
    await route.fulfill({ status, body: '' });
  });
}

// FOUR REAL IN-APP PAGE VIEWS, and every one of them is asserted to have
// happened.
//
// This site's whole nav bar is `#` fragments rendered as plain anchors
// (copy.json's nav, NavBar.tsx's `kind === 'section'` branch), and its only
// routes are /, /blog, /blog/:slug and /:slug. Clicking "Menu" scrolls and
// changes nothing -- and getByRole matches names by substring, so the click
// still succeeds. A fixture built on those clicks proves that one page load
// sends one request and calls it proof that route changes do not re-count.
//
// So: the "read the blog" link on the homepage (a router <Link to="/blog">
// in BlogSection.tsx), a post card (<Link to={`/blog/${slug}`}> in
// PostCard.tsx), then two history pops -- all four are router transitions
// with no new document, and toHaveURL after each means the test cannot be
// satisfied by standing still.
//
// The last pop is deliberately back onto the TAGGED url. A naive
// implementation that re-reads the query string on every route change fires
// there, and this is the case that catches it.
async function readFourPages(page: Page): Promise<void> {
  await page.locator('a[href="/blog"]').first().click();
  await expect(page).toHaveURL(/\/blog$/);

  await page.locator('a[href^="/blog/"]').first().click();
  await expect(page).toHaveURL(/\/blog\/[^/]+$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/blog$/);

  await page.goBack();
  await expect(page).toHaveURL(/utm_source=instagram/);
}

test.describe('a tagged arrival is counted once, not once per page', () => {
  test('one tagged arrival plus four in-app page views sends exactly one write', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);

    await page.goto('/?utm_source=instagram');
    await page.waitForLoadState('networkidle');
    await readFourPages(page);
    await page.waitForLoadState('networkidle');

    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('POST');
    expect(JSON.parse(writes[0].postData ?? 'null')).toEqual({ source: 'instagram' });
  });

  test('a refresh of the same tagged URL in the same tab sends no second write', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);

    await page.goto('/?utm_source=instagram');
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');

    expect(writes).toHaveLength(1);
  });

  test('an untagged visit sends nothing at all', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('a[href="/blog"]').first().click();
    await expect(page).toHaveURL(/\/blog$/);
    await page.waitForLoadState('networkidle');

    expect(writes).toEqual([]);
  });

  test('a different tagged link in the same tab is its own arrival', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);

    await page.goto('/?utm_source=instagram');
    await page.waitForLoadState('networkidle');
    await page.goto('/?utm_source=zomato');
    await page.waitForLoadState('networkidle');

    expect(writes.map((write) => JSON.parse(write.postData ?? 'null'))).toEqual([
      { source: 'instagram' },
      { source: 'zomato' },
    ]);
  });

  test('an unknown tag is normalised before it leaves the browser', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);
    await page.goto('/?utm_source=fbclid-9911');
    await page.waitForLoadState('networkidle');
    expect(JSON.parse(writes[0]?.postData ?? 'null')).toEqual({ source: 'other' });
  });

  test('a failed write loses the row and never blocks the page', async ({ page }) => {
    // The Hero.tsx principle applied to a second counter: a counter that
    // costs the restaurant a customer is worse than no counter.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/campaign', async (route) => {
      await route.abort('failed');
    });

    await page.goto('/?utm_source=instagram');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('her own editing session is never counted', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);
    await page.goto('/edit?utm_source=instagram');
    await page.waitForLoadState('networkidle');
    expect(writes).toEqual([]);
  });
});
