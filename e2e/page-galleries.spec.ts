import { expect, test, type Locator, type Page } from '@playwright/test';

// Two `template: 'gallery'` sections exist today, both on their own page
// route rather than the homepage: Catering's four-photo set (Task 6) and
// Cooking Class's single-image pamphlet (Task 8). Neither had a dedicated
// browser spec naming its layout -- src/components/templates/__tests__/
// GallerySection.test.tsx (jsdom) already proves each layout produces
// different MARKUP for an identical image list, but jsdom has no layout
// engine, so nothing in this repo had ever measured what either actually
// looks like once real CSS runs. This file is that measurement, for both
// galleries at once, since they are the same component pointed at different
// content.
//
// REWRITTEN AFTER THE FINAL BRANCH REVIEW, and the reason is the whole point
// of this header. The first version of this file measured real geometry,
// asserted it precisely, and reddened under every mutation tried against it
// -- and it was wrong. Both sections were pointed at `layout: 'grid'`, which
// in GallerySection.tsx is the PRESS LOGO strip: a 96px-tall cell,
// `object-contain`, and `grayscale` until hover. The catering gallery shipped
// as four grey stamps 97x96, 144x96, 64x96 and 54x96. The pamphlet -- a
// document whose entire job is that a parent reads "Open for kids aged 6 and
// above. Only 4 spots per batch." off it -- shipped 60px wide and
// desaturated, stranded at the far left of an empty full-width band. This
// file asserted that the pamphlet's box WAS portrait-at-96px-tall and called
// it correct, and asserted the four catering photos shared one 96px row and
// called that correct too. Three green tests, all faithfully verifying the
// wrong template. Measuring geometry is not the same as knowing what the
// geometry should be, and a test that verifies the wrong thing costs exactly
// what a test that cannot fail costs.
//
// So every assertion below is written from what the section is FOR, not from
// what it happened to render:
//
//   - Catering is a gallery of PHOTOGRAPHS. Photographs are in colour and
//     are big enough to look at. Both are asserted directly (computed
//     `filter`, and a floor on each rendered box) rather than inferred from
//     a class name, because a class name is exactly what the previous
//     version trusted.
//   - The pamphlet is a HERO. One image, in colour, centred, large enough to
//     read, at its own portrait shape.
//
// The numeric floors are deliberately far below what the layouts actually
// produce (256px cells; a 448px-wide pamphlet on desktop) and far above what
// the logo strip produced (96px tall; 60px wide). They are not snapshots of
// the current pixel values -- a restyle that keeps these sections looking
// like themselves should not have to touch this file -- but nothing that
// still reads as a logo row can satisfy them.
//
// Same hazard shape e2e/hero-collage-after-farfalle.spec.ts documents:
// `getBoundingClientRect()` reports a box regardless of an ancestor's
// `overflow-hidden`, so an element laid out entirely outside its container
// still measures nonzero. Every "is it visible" claim below intersects an
// image's own rect with its gallery section's rect and requires nonzero
// overlap on both axes, rather than trusting a bare width/height reading.

// The floor a rendered image has to clear to be a photograph a visitor is
// meant to look at rather than a logo in a masthead. The logo strip's cell
// is 96px tall (`h-24`); the scroller's is 256px square. 180 sits between
// them with room on both sides.
const PHOTO_MIN_PX = 180;

async function waitForRealImage(image: Locator): Promise<void> {
  // `loading="lazy"` (GallerySection.tsx) means the browser does not even
  // fetch the resource until the element nears the viewport, and an
  // unloaded <img> with no width/height attribute has no intrinsic size --
  // measuring its box immediately after scrollIntoViewIfNeeded is a race
  // that would read 0x0 for a reason that has nothing to do with the layout
  // claim under test. Waiting for naturalWidth removes that race.
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
}

interface Measured {
  left: number;
  top: number;
  width: number;
  height: number;
  visibleWidth: number;
  visibleHeight: number;
  filter: string;
}

async function measure(section: Locator, images: Locator): Promise<Measured[]> {
  return images.evaluateAll((els, sectionEl) => {
    const c = (sectionEl as Element).getBoundingClientRect();
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(r.right, c.right) - Math.max(r.left, c.left));
      const visibleHeight = Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top));
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        visibleWidth,
        visibleHeight,
        // The defect that shipped, read from the browser rather than from
        // the markup: the logo strip's wrapper carries an unconditional
        // `grayscale`, which computes to `grayscale(1)` here. A photograph
        // must compute to `none`. `filter` is inherited-through-compositing
        // from the wrapper, so reading it on the <img> itself is what a
        // visitor's eye actually sees.
        filter: getComputedStyle(el).filter,
      };
    });
  }, await section.elementHandle());
}

async function openGallery(page: Page, path: string, testid: string): Promise<Locator> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const section = page.getByTestId(testid);
  await section.scrollIntoViewIfNeeded();
  return section;
}

test.describe("Catering's gallery reads as photographs, not as a press-logo strip", () => {
  const SECTION = 'gallery-section-catering-gallery';

  for (const [label, width, height] of [
    ['desktop', 1280, 900],
    ['mobile', 390, 844],
  ] as const) {
    test(`each photo is full-colour and full-size at ${label} width`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const section = await openGallery(page, '/catering', SECTION);

      const images = section.locator('[data-testid^="gallery-image-catering-gallery-"] img');
      // Non-vacuous: four is the real, current photo count (pages.json), and
      // a gallery collapsed to one image would make the row assertion below
      // meaningless.
      await expect(images).toHaveCount(4);
      for (let i = 0; i < 4; i += 1) await waitForRealImage(images.nth(i));

      for (const [i, box] of (await measure(section, images)).entries()) {
        expect(box.filter, `photo ${i} is being rendered through a filter -- it should be in colour`).toBe('none');
        expect(box.width, `photo ${i} is only ${box.width}px wide -- that is a logo, not a photograph`).toBeGreaterThanOrEqual(PHOTO_MIN_PX);
        expect(box.height, `photo ${i} is only ${box.height}px tall -- that is a logo, not a photograph`).toBeGreaterThanOrEqual(PHOTO_MIN_PX);
      }
    });
  }

  test('the four photos sit on one row that spans the section, at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const section = await openGallery(page, '/catering', SECTION);

    const images = section.locator('[data-testid^="gallery-image-catering-gallery-"] img');
    await expect(images).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) await waitForRealImage(images.nth(i));
    const boxes = await measure(section, images);

    // At 1280 the whole row fits inside the section, so every photo is
    // genuinely on screen and not merely reported as a box by
    // getBoundingClientRect while laid out past its container's edge.
    for (const [i, box] of boxes.entries()) {
      expect(box.visibleWidth, `photo ${i} has no width actually visible inside the gallery section`).toBeGreaterThan(0);
      expect(box.visibleHeight, `photo ${i} has no height actually visible inside the gallery section`).toBeGreaterThan(0);
    }

    // "Left edges differ" does NOT distinguish a row from a column here, and
    // that was confirmed the hard way against the previous layout: photos
    // centred in their own cells land at different left offsets even when
    // stacked. What a stack cannot fake is a shared TOP. Rounded to the
    // nearest 5px to absorb sub-pixel differences without absorbing a stack,
    // whose rows are hundreds of pixels apart.
    const distinctRows = new Set(boxes.map((b) => Math.round(b.top / 5) * 5));
    expect(distinctRows.size, 'the four photos are not on the same row -- this is a stack, not a row').toBe(1);

    const sectionBox = (await section.boundingBox())!;
    const spread = Math.max(...boxes.map((b) => b.left + b.width)) - Math.min(...boxes.map((b) => b.left));
    expect(spread, 'the four photos do not spread across the row').toBeGreaterThan(sectionBox.width / 2);
  });

  test('at phone width the row is a real horizontal scroller, not four photos clipped away', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const section = await openGallery(page, '/catering', SECTION);
    const images = section.locator('[data-testid^="gallery-image-catering-gallery-"] img');
    await expect(images).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) await waitForRealImage(images.nth(i));

    // Four 256px cells cannot fit in a 390px viewport, so on a phone the
    // photos off the right edge are reachable by swiping -- that is the
    // scroller's whole contract, and it is the difference between "three
    // photos are hidden" and "three photos are one swipe away". Asserted on
    // the scroll container's own overflow, which is the only thing that
    // makes them reachable.
    const scroller = section.locator('.overflow-x-auto').first();
    // Asserted before it is evaluated, so a layout with no scroll container
    // at all fails in a line rather than in a 30-second locator timeout --
    // confirmed by mutation: pointing this section back at the logo grid
    // used to hang this test for the full timeout instead of saying why.
    await expect(scroller, 'this section has no horizontal scroll container').toHaveCount(1);
    const overflow = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(overflow.scrollWidth, 'the phone row does not overflow, so nothing can be scrolled to').toBeGreaterThan(overflow.clientWidth);

    // The first photo must be fully on screen unaided, or the section opens
    // on a cropped image and reads as broken rather than as scrollable.
    const first = (await measure(section, images))[0];
    expect(first.visibleWidth, 'the first photo is cut off before the viewport edge').toBeGreaterThanOrEqual(first.width);

    // And the last one really is reachable, not laid out somewhere a swipe
    // can never reach.
    await images.nth(3).scrollIntoViewIfNeeded();
    const last = (await measure(section, images))[3];
    expect(last.visibleWidth, 'the last photo cannot be scrolled into view').toBeGreaterThan(0);
    expect(last.filter, 'the last photo is not in colour').toBe('none');
  });
});

test.describe("Cooking Class's pamphlet reads as a hero image", () => {
  // /experiences/pamphlet.webp is 1000x1597 -- taller than it is wide by a
  // factor of ~1.6. It is generated by `npm run images` from the tracked
  // source assets-source/experiences/pamphlet.jpg; the .webp itself is NOT
  // committed (public/*/ is gitignored), which the previous version of this
  // comment got wrong.
  const PAMPHLET_ASPECT = 1000 / 1597;

  // The floor for "big enough that a parent can read the class details off
  // it". The logo cell rendered it 60px wide; the hero renders it 448px on
  // desktop and 358px on a 390px phone. 300 sits between, and holds at both
  // widths without being a snapshot of either.
  const HERO_MIN_WIDTH = 300;

  for (const [label, width, height] of [
    ['desktop', 1280, 900],
    ['mobile', 390, 844],
  ] as const) {
    test(`the pamphlet is large, centred, in colour and portrait at ${label} width`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const section = await openGallery(page, '/cooking-class', 'gallery-section-cooking-class-pamphlet');

      const image = page.getByTestId('gallery-image-cooking-class-pamphlet-0').locator('img');
      await waitForRealImage(image);

      const box = (await measure(section, image))[0];
      expect(box.visibleWidth, 'the pamphlet has no width actually visible inside its section').toBeGreaterThan(0);
      expect(box.visibleHeight, 'the pamphlet has no height actually visible inside its section').toBeGreaterThan(0);

      // In colour. The defect that shipped was a desaturated pamphlet, and
      // this is the assertion that names it.
      expect(box.filter, 'the pamphlet is being rendered through a filter -- it should be in colour').toBe('none');

      // Big enough to read. This is the other half of the shipped defect:
      // 60px wide, with the text on it at roughly one pixel per line.
      expect(box.width, `the pamphlet rendered ${box.width}px wide -- unreadable`).toBeGreaterThanOrEqual(HERO_MIN_WIDTH);

      // Centred. The logo-strip version pinned it to the far left of an
      // otherwise empty full-width band, which is what made it read as a
      // stray thumbnail rather than as the page's opening image. A hero sits
      // down the middle: equal gaps either side, within a 2px tolerance for
      // sub-pixel rounding.
      const sectionBox = (await section.boundingBox())!;
      const gapLeft = box.left - sectionBox.x;
      const gapRight = sectionBox.x + sectionBox.width - (box.left + box.width);
      expect(Math.abs(gapLeft - gapRight), `the pamphlet is not centred: ${gapLeft}px left, ${gapRight}px right`).toBeLessThanOrEqual(2);

      // Portrait, at its own shape. Not a discriminator on its own -- the
      // logo cell's `object-contain` preserved the aspect too, which is
      // exactly why the previous version of this file passed -- but it is
      // what catches a future cell that crops or stretches it.
      expect(box.height, 'the pamphlet rendered wider than it is tall -- it has been stretched landscape').toBeGreaterThan(box.width);
      expect(box.width / box.height).toBeCloseTo(PAMPHLET_ASPECT, 1);
    });
  }
});
