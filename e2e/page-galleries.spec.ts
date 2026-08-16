import { expect, test, type Locator } from '@playwright/test';

// Two `template: 'gallery'` sections exist today, both on their own page
// route rather than the homepage: Catering's four-photo grid (Task 6) and
// Cooking Class's single-image pamphlet (this task). Neither had a
// dedicated browser spec naming its layout -- src/components/templates/
// __tests__/GallerySection.test.tsx (jsdom) already proves each layout
// produces different MARKUP for an identical image list, but jsdom has no
// layout engine, so nothing in this repo had ever measured what either
// actually looks like once real CSS runs. This file is that measurement,
// for both galleries at once, since they are the same component pointed at
// different content.
//
// Same hazard shape e2e/hero-collage-after-farfalle.spec.ts documents:
// `getBoundingClientRect()` reports a box regardless of an ancestor's
// `overflow-hidden`, so an element laid out entirely outside its container
// still measures nonzero. Every "is it visible" claim below intersects an
// image's own rect with its gallery section's rect and requires nonzero
// overlap on both axes, rather than trusting a bare width/height reading.

async function waitForRealImage(image: Locator): Promise<void> {
  // `loading="lazy"` (GallerySection.tsx) means the browser does not even
  // fetch the resource until the element nears the viewport, and an
  // unloaded <img> with no width/height attribute has no intrinsic size --
  // measuring its box immediately after scrollIntoViewIfNeeded is a race
  // that would read 0x0 for a reason that has nothing to do with the layout
  // claim under test. Waiting for naturalWidth removes that race.
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
}

async function visibleOverlap(section: Locator, images: Locator) {
  return images.evaluateAll((els, sectionEl) => {
    const c = (sectionEl as Element).getBoundingClientRect();
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(r.right, c.right) - Math.max(r.left, c.left));
      const visibleHeight = Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top));
      return { left: r.left, top: r.top, width: r.width, height: r.height, visibleWidth, visibleHeight };
    });
  }, await section.elementHandle());
}

test.describe("Catering's photo gallery renders as a grid, not a single stack", () => {
  test('all four photos are visible inside the gallery section, spread across more than one column', async ({ page }) => {
    await page.goto('/catering');
    await page.waitForLoadState('networkidle');
    const section = page.getByTestId('gallery-section-catering-gallery');
    await section.scrollIntoViewIfNeeded();

    const images = section.locator('[data-testid^="gallery-image-catering-gallery-"] img');
    // Non-vacuous: four is the real, current photo count (pages.json), and
    // a gallery collapsed to one image would make the "more than one
    // column" assertion below meaningless.
    await expect(images).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) await waitForRealImage(images.nth(i));

    const boxes = await visibleOverlap(section, images);
    for (const [i, box] of boxes.entries()) {
      expect(box.visibleWidth, `photo ${i} has no width actually visible inside the gallery section`).toBeGreaterThan(0);
      expect(box.visibleHeight, `photo ${i} has no height actually visible inside the gallery section`).toBeGreaterThan(0);
    }

    // The grid layout claim itself. "left edges differ" alone turned out NOT
    // to distinguish a grid from a single column here: `justify-items-center`
    // centres each photo inside its own cell, and the four source photos
    // have different aspect ratios, so even four photos stacked in ONE
    // column still land at four different left offsets (confirmed directly:
    // forcing `grid-cols-1` left this assertion green). What a single column
    // cannot fake is the ROW: `grid-cols-4` (desktop) puts all four photos
    // in the same row, top-aligned by `items-center` against a shared 96px
    // (`h-24`) cell height, while a column stacks them into four separate
    // rows. Rounded to the nearest 5px to absorb the images' own differing
    // heights inside that shared cell without being fooled by a stack.
    const distinctRows = new Set(boxes.map((b) => Math.round(b.top / 5) * 5));
    expect(distinctRows.size, 'the four photos are not on the same row -- this is a stack, not a grid').toBe(1);

    // And the row itself must actually span real width, not four photos
    // collapsed on top of each other at the same x: the rightmost photo's
    // right edge must clear at least half the section's own width away from
    // the leftmost photo's left edge.
    const sectionBox = (await section.boundingBox())!;
    const spread = Math.max(...boxes.map((b) => b.left + b.width)) - Math.min(...boxes.map((b) => b.left));
    expect(spread, 'the four photos do not spread across the row').toBeGreaterThan(sectionBox.width / 2);
  });
});

test.describe("Cooking Class's pamphlet renders as a single portrait image, not stretched to its grid cell", () => {
  // /experiences/pamphlet.webp is 1000x1597 (checked directly against the
  // committed file): taller than it is wide by a factor of ~1.6. The grid
  // layout's own cell (GallerySection.tsx: a fixed h-24 box, `object-contain`
  // on the image) is what is supposed to preserve that -- the plan's own
  // Step 4 flags a single-image grid cell as the one place this could
  // stretch, on a phone-width viewport specifically, so both a desktop and a
  // phone width are checked here rather than one.
  const PAMPHLET_ASPECT = 1000 / 1597;

  for (const [label, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
    test(`the pamphlet keeps its portrait proportions at ${label} width`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/cooking-class');
      await page.waitForLoadState('networkidle');
      const section = page.getByTestId('gallery-section-cooking-class-pamphlet');
      await section.scrollIntoViewIfNeeded();

      const wrapper = page.getByTestId('gallery-image-cooking-class-pamphlet-0');
      const image = wrapper.locator('img');
      await waitForRealImage(image);

      const boxes = await visibleOverlap(section, image);
      const box = boxes[0];
      expect(box.visibleWidth, 'the pamphlet has no width actually visible inside its section').toBeGreaterThan(0);
      expect(box.visibleHeight, 'the pamphlet has no height actually visible inside its section').toBeGreaterThan(0);

      // Portrait, not merely nonzero: a box wider than it is tall would still
      // pass an "is it visible" check while being exactly the stretch the
      // plan warned about (e.g. `object-contain` swapped for `object-cover`
      // inside a fixed-height, w-full cell stretches the pamphlet to the
      // cell's own landscape shape).
      expect(box.height, 'the pamphlet rendered wider than it is tall -- it has been stretched landscape').toBeGreaterThan(box.width);
      expect(box.width / box.height).toBeCloseTo(PAMPHLET_ASPECT, 1);
    });
  }
});
