import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

// The one claim in this whole feature that no vitest test in this repo can
// make. jsdom has no layout engine: every element it renders reports a zero
// box and `document.elementFromPoint` is not implemented against real
// stacking contexts at all, so "she can actually click this" is provable
// only in a real browser. Same shape, and same reason, as
// e2e/collage-hit-test.spec.ts -- which this file borrows its whole backend
// mock and its measure-and-hit-test-in-one-frame helper from.
//
// What it pins, in order:
//   1. On /edit, the Publish button's own centre pixel resolves to the
//      Publish button (or a descendant of it). Before the `offsetTop` prop
//      landed this was FALSE at both viewports -- NavBar.tsx renders
//      `fixed top-0 left-0 right-0 z-50` with an opaque background and a
//      61px height, and the bar's own top row sat entirely underneath it.
//      Measured directly against this tree before the fix: the centre of
//      the Publish button returned the nav's own "Menu" link at 1440px and
//      the hamburger toggle at 390px. A confirmation step behind a button
//      that cannot be clicked would be real on /edit/manage only.
//   2. Once the confirmation panel is open, the accept button's own centre
//      pixel resolves to the accept button -- nothing is painted over the
//      one control this whole step exists to put in front of her.
//   3. The panel's own COMPUTED z-index really is above the nav's, read off
//      both elements in the same browser. Recorded honestly, because the
//      comment that used to sit here claimed check 2 pinned that ordering
//      and it did not: nothing else is bottom-docked in the scenario this
//      spec drives, so portal insertion order alone carried the hit test,
//      and removing `style={{ zIndex: 70 }}` from PublishBar left it green
//      at both viewports. A probe that opened CollageTile's own bottom-
//      docked move/resize panel first was green either way too, so no
//      hit-test formulation was found that discriminates. What CAN be
//      checked, and is only checkable in a real browser (jsdom computes no
//      styles at all), is the resolved z-index of both elements as the
//      engine actually sees them -- inline style, class, cascade and all.
//      That is what check 3 does, and it is red the moment the inline
//      z-index goes.

const CONTENT_FILES = [
  'site.json',
  'galleries.json',
  'dishes.json',
  'drinks.json',
  'press.json',
  'story.json',
  'menus.json',
  'copy.json',
  'sections.json',
  'pages.json',
];

function realContentJson(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'content', name), 'utf8');
}

// Identical to collage-hit-test.spec.ts's own mock, and for the identical
// reason: GET /api/wa doubles as EditMode's session probe, and
// GET /api/content?path=src/content/<name> is the only other call /edit
// makes before first paint. `**/api/content**` needs the trailing double
// star -- a bare `*` never matches a query string containing slashes.
async function mockEditBackend(page: Page): Promise<void> {
  await page.route('**/api/wa', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/content**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') ?? '';
    const name = path.replace('src/content/', '');
    if (!CONTENT_FILES.includes(name)) {
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: realContentJson(name), sha: 'e2e-test-sha' }),
    });
  });
  // A publish must never actually leave this test. Nothing here clicks
  // accept, but a stray submit reaching a real POST would be a far more
  // confusing failure than a refused route.
  await page.route('**/api/publish', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"not in this test"}' });
  });
}

// Measure and hit-test inside ONE page evaluation so both read the same
// frame -- collage-hit-test.spec.ts's own note on why splitting them made
// that spec flake applies here unchanged. Returns whether the element under
// the target's own centre pixel IS the target or something inside it, plus
// a description of what was actually hit, so a failure names the occluder
// rather than just saying "false".
async function hitTestSelf(locator: Locator): Promise<{ self: boolean; hit: string }> {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const describe = (node: Element | null): string => {
      if (!node) return 'nothing (off-screen)';
      const label = node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 30) ?? '';
      return `<${node.tagName.toLowerCase()}> ${label}`;
    };
    return { self: hit !== null && (hit === el || el.contains(hit)), hit: describe(hit) };
  });
}

// Every image loaded and no scroll still animating -- the same two things
// that made the collage spec flake before it waited for them.
async function settleLayout(page: Page): Promise<void> {
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

const VIEWPORTS = [
  { label: '390px (phone)', width: 390, height: 844 },
  { label: '1440px (desktop)', width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`/edit publish flow is reachable at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('the Publish button, and then the confirm panel accept button, each resolve to themselves under document.elementFromPoint', async ({
      page,
    }) => {
      await mockEditBackend(page);
      await page.goto('/edit');

      const publishButton = page.getByRole('button', { name: 'Publish' });
      await expect(publishButton).toBeVisible();
      await settleLayout(page);

      const publishHit = await hitTestSelf(publishButton);
      expect(
        publishHit.self,
        `the Publish button's own centre is occluded -- ${publishHit.hit} is on top of it`,
      ).toBe(true);

      // Dirty one real editable leaf so the button is enabled and the
      // confirm has something to summarise. The logo wordmark is the first
      // editable text on the page and belongs to copy.json.
      const leaf = page.locator('[data-editable-path="nav.wordmark"]').first();
      await expect(leaf).toBeVisible();
      await leaf.click();
      await page.keyboard.type('!');
      await leaf.blur();

      await expect(publishButton).toBeEnabled();
      await publishButton.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const accept = dialog.getByRole('button', { name: 'Yes, publish to the live site' });
      await expect(accept).toBeVisible();

      const acceptHit = await hitTestSelf(accept);
      expect(
        acceptHit.self,
        `the confirm panel's accept button is occluded -- ${acceptHit.hit} is on top of it`,
      ).toBe(true);

      // Check 3. Both read as the ENGINE resolves them, in the same frame --
      // an assertion against the class string or the inline style attribute
      // would prove neither, since the panel carries a z-50 class as well as
      // its inline override and only the cascade decides which wins.
      const panelZ = await dialog.evaluate((el) => Number.parseInt(getComputedStyle(el).zIndex, 10));
      const navZ = await page
        .locator('nav')
        .first()
        .evaluate((el) => Number.parseInt(getComputedStyle(el).zIndex, 10));
      expect(navZ, 'the nav should still be the z-50 this ordering was chosen against').toBe(50);
      expect(panelZ, `the confirm panel resolved to z-index ${panelZ}, at or below the nav's ${navZ}`).toBeGreaterThan(navZ);
      // CollageTile's own refusal toast is a fixed 60 (CollageTile.tsx), and
      // its move/resize panel is bottom-docked at 50 -- the same edge this
      // panel occupies. Above both, so which paints on top is never decided
      // by portal insertion order.
      expect(panelZ, `the confirm panel resolved to z-index ${panelZ}, at or below CollageTile's toast (60)`).toBeGreaterThan(60);
    });
  });
}
