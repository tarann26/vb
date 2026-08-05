import { expect, test, type Locator } from '@playwright/test';
import { mockEditBackend } from './edit-backend';

// "There is no way to reach /edit/manage from /edit" -- the owner's own
// report. The link EditMode.tsx now renders is only worth anything if it is
// actually on screen and actually clickable at the width she uses, and
// neither is a statement jsdom can make: it applies no CSS, evaluates no
// media query, gives every element a zero box and cannot hit-test at all.
// Same reason, and same shape, as e2e/collage-hit-test.spec.ts.
//
// The specific hazards this rules out, both of which have already happened
// once each on this surface: a control hidden behind a `md:` breakpoint (so
// it exists on the desktop it was written on and nowhere else), and a
// control painted underneath NavBar.tsx's own `fixed top-0 z-50` bar, which
// is what the Publish button itself did until `offsetTop` landed -- see
// e2e/publish-confirm.spec.ts.

// Measure and hit-test in ONE page evaluation so both read the same frame --
// collage-hit-test.spec.ts's own note on why splitting them made that spec
// flake applies here unchanged.
//
// `getClientRects()[0]`, not `getBoundingClientRect()`: this target is an
// INLINE element, and for an inline that wraps, the bounding rect is the
// union of its line boxes -- whose centre can land in the gutter BETWEEN
// two lines, where `elementFromPoint` correctly reports the paragraph
// rather than the link. Confirmed directly at 390px, which is how the link
// text came to be shortened (see EditMode.tsx's own comment there). The
// first client rect is a real line box, so its centre is always on the
// element itself, and the check stays meaningful if the text ever wraps
// again.
async function hitTestSelf(locator: Locator): Promise<{ self: boolean; hit: string }> {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((el) => {
    const rect = el.getClientRects()[0] ?? el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const describe = (node: Element | null): string => {
      if (!node) return 'nothing (off-screen)';
      const label = node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 40) ?? '';
      return `<${node.tagName.toLowerCase()}> ${label}`;
    };
    return { self: hit !== null && (hit === el || el.contains(hit)), hit: describe(hit) };
  });
}

const VIEWPORTS = [
  { label: '390px (phone)', width: 390, height: 844 },
  { label: '1440px (desktop)', width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`the dashboard link on /edit at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('is on screen and its own centre pixel resolves to itself', async ({ page }) => {
      await mockEditBackend(page);
      await page.goto('/edit');

      const link = page.locator('a[href="/edit/manage"]');
      await expect(link).toHaveCount(1);
      // `toBeVisible` is what a `hidden md:inline` would fail at 390px --
      // Playwright resolves the real computed style and the real media
      // query, which is exactly what jsdom cannot do.
      await expect(link).toBeVisible();

      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);

      const { self, hit } = await hitTestSelf(link);
      expect(self, `the dashboard link is occluded -- its own centre pixel is ${hit}`).toBe(true);
    });
  });
}
