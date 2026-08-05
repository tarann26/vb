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
//      pixel resolves to the accept button. The panel is portaled to
//      document.body at a z-index above both the nav (50) and CollageTile's
//      own refusal toast (60), and that ordering is exactly the kind of
//      claim a class-name assertion cannot check.

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
    });
  });
}
