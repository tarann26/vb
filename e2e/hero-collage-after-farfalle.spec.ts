import { expect, test } from '@playwright/test';

// This repo has shipped invisible collage tiles before: nine photos were
// clipped out of view by Hero's own overflow-hidden and nobody could see why,
// because jsdom has no layout engine and every unit test stayed green. That
// is the failure this file exists to catch, so it asserts on measured boxes
// rather than on the DOM containing eleven <img> elements.
for (const [label, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
  test(`all eleven collage photos are visible at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The attribute added in the previous step. Deliberately NOT a generic
    // `#hero img`: /hero/brick.webp is a decorative background inside the same
    // section and counting it would make this assertion wrong by one, which
    // would mask exactly the missing tile it exists to catch.
    const target = page.locator('[data-collage-photo]');

    await expect(target).toHaveCount(11);

    const boxes = await target.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );
    for (const [i, box] of boxes.entries()) {
      expect(box.w, `photo ${i} has zero width`).toBeGreaterThan(0);
      expect(box.h, `photo ${i} has zero height`).toBeGreaterThan(0);
    }
  });
}
