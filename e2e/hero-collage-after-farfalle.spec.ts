import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countCollagePhotos } from '../src/content/collage';
import type { CollageNode } from '../src/content/types';

// Derived, not hardcoded: the owner can add or remove a collage photo from
// /edit, and Task 6 (dropping the five Farfalle photos, 16 -> 11) is exactly
// the content edit that would have made a literal `11` here wrong again on
// the next legitimate edit. Read at run time rather than imported as JSON,
// since this spec runs as ESM and reading the committed file directly is
// simpler than an import attribute.
const GALLERIES_PATH = fileURLToPath(new URL('../src/content/galleries.json', import.meta.url));
const PHOTO_COUNT = countCollagePhotos(
  (JSON.parse(readFileSync(GALLERIES_PATH, 'utf8')) as { heroCollage: CollageNode }).heroCollage,
);

// Hero.tsx's own collage container (`<div className="absolute inset-0
// flex">`), the same selector e2e/collage-page.ts's COLLAGE_CONTAINER names.
// Not imported from there: this file is deliberately self-contained (it reads
// galleries.json directly above rather than going through collage-page.ts's
// helpers), matching e2e/hero-collage.spec.ts's own reasoning for the same
// choice.
const COLLAGE_CONTAINER = 'section .absolute.inset-0.flex';

// This repo has shipped invisible collage tiles before: nine photos were
// clipped out of view by Hero's own overflow-hidden and nobody could see why,
// because jsdom has no layout engine and every unit test stayed green. That
// is the failure this file exists to catch, so it asserts on measured boxes
// rather than on the DOM containing eleven <img> elements.
//
// "Measured boxes" used to mean `getBoundingClientRect().width/height > 0`,
// which is not the same claim as "visible": `getBoundingClientRect` reports
// an element's geometry regardless of ancestor `overflow-hidden`, so a tile
// laid out entirely outside the collage container -- the exact shape of the
// original nine-photo bug -- still measures a nonzero box and would have
// passed. Fixed by intersecting each tile's rect with the collage
// container's own rect and requiring the overlap to be nonzero: a box wholly
// outside the container clips to zero on at least one axis and fails.
for (const [label, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
  test(`every collage photo is visible at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The attribute added in the previous step. Deliberately NOT a generic
    // `#hero img`: /hero/brick.webp is a decorative background inside the same
    // section and counting it would make this assertion wrong by one, which
    // would mask exactly the missing tile it exists to catch.
    const target = page.locator('[data-collage-photo]');

    await expect(target).toHaveCount(PHOTO_COUNT);
    // Non-vacuous: a collage collapsed to a single photo would make the walk
    // below iterate once (or the whole test trivially true), and a boxes
    // loop that silently found nothing wrong would not prove anything was
    // checked.
    expect(PHOTO_COUNT).toBeGreaterThan(1);

    const boxes = await target.evaluateAll((els, containerSelector) => {
      const container = document.querySelector(containerSelector);
      if (!container) throw new Error('collage container not found');
      const c = container.getBoundingClientRect();
      return els.map((el) => {
        const r = el.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(r.right, c.right) - Math.max(r.left, c.left));
        const visibleHeight = Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top));
        return { visibleWidth, visibleHeight };
      });
    }, COLLAGE_CONTAINER);
    for (const [i, box] of boxes.entries()) {
      expect(box.visibleWidth, `photo ${i} has no width actually visible inside the collage container`).toBeGreaterThan(0);
      expect(box.visibleHeight, `photo ${i} has no height actually visible inside the collage container`).toBeGreaterThan(0);
    }
  });
}
