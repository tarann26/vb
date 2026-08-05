import { expect, test } from '@playwright/test';
import { mockEditBackend } from './edit-backend';

// "A control panel which has no information in it" -- the owner, about the
// collage's move/size panel. It is docked to the bottom of the viewport and
// the tile it controls is a ~60px cell somewhere above it; at 390px that
// tile is very often not on screen at the same time as the panel, so
// "PHOTO 5 OF THE COLLAGE" plus eight arrows was the whole of what she had.
//
// The panel now shows the photo. jsdom proves the plumbing
// (src/admin/__tests__/CollageTile.test.tsx); what only a real browser can
// say is that the thumbnail is genuinely on screen, at a real size, inside
// the panel, at the width she actually uses -- and, at 390px, that opening
// the panel does not require the tile and the panel to be visible together,
// which is the whole reason the thumbnail exists.

const VIEWPORTS = [
  { label: '390px (phone)', width: 390, height: 844 },
  { label: '1440px (desktop)', width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`the collage move panel at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('shows the photo it is moving, at a real size, matching the tile it was opened from', async ({ page }) => {
      await mockEditBackend(page);
      await page.goto('/edit');

      const tile = page.locator('[data-collage-tile-index="5"]');
      await expect(tile).toHaveCount(1);
      // The photo this tile actually shows right now -- read before the
      // panel opens, so the comparison below is against the tile itself and
      // not against anything the panel put on screen.
      const tilePhoto = await tile.locator('img').first().getAttribute('src');
      expect(tilePhoto).not.toBeNull();

      // The select toggle, not the camera badge: a real click on the camera
      // badge opens the OS file picker, which cannot be dismissed from a
      // script (see e2e/collage-hit-test.spec.ts's own note).
      await tile.locator('> button[aria-label]').click();

      const panel = page.getByRole('region', { name: 'Moving or resizing photo 6' });
      await expect(panel).toBeVisible();

      const thumbnail = panel.locator('img[data-collage-panel-thumbnail]');
      await expect(thumbnail).toBeVisible();
      await expect(thumbnail).toHaveAttribute('src', tilePhoto!);

      // A real box, not a collapsed one, and a real decoded image rather
      // than a broken-image glyph -- `naturalWidth` is 0 for an <img> whose
      // src failed to load, which is exactly what a not-yet-built derivative
      // path would have produced had the src come from content instead of
      // from the DOM.
      const box = await thumbnail.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(24);
      expect(box!.height).toBeGreaterThan(24);
      await expect
        .poll(() => thumbnail.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 5000 })
        .toBeGreaterThan(0);
    });
  });
}
