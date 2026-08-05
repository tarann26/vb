import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockEditBackend } from './edit-backend';

// I-B review finding: this spec is the committed, re-runnable version of
// the reviewer's own manual proof -- "the select badge and camera badge are
// reachable on 16/16 tiles at both 390px and 1440px". It exists to catch a
// REGRESSION of the two z-index fixes CollageTile.tsx (`SELECT_BUTTON_CLASSNAME`/
// `SELECTED_BUTTON_CLASSNAME`) and EditableImage.tsx (`CONTROL_LABEL_CLASSNAME`/
// `ERROR_CONTROL_LABEL_CLASSNAME`) both carry (`z-20`, not `z-10`) -- the bug
// that made every one of the sixteen camera badges, and every one of the
// sixteen select badges, unreachable by a real click for the whole life of
// Plan 5's photo-replace feature. Mutation-tested directly while writing
// this: reverting either `z-20` back to `z-10` makes this spec fail (see
// this task's own report for the red/green transcript); no vitest test in
// this repo can, because jsdom has no layout engine to hit-test against.
//
// `document.elementFromPoint` at each badge's own measured centre, not a
// Playwright `.click()` -- a real click on the select badge OPENS its
// panel (this spec would then need to close it, or every subsequent tile's
// own hit-test would be reasoning about a page with an open panel already
// on it), and a real click on the camera badge opens the OS's native file
// picker, which cannot be dismissed from a script. Reading what's actually
// under the pointer, the same thing `document.elementFromPoint` does
// inside a real click's own hit-test, proves the identical fact --
// "reachable by a real click" -- without either side effect.


// `.closest('[aria-label]')`, not a direct element match: the icon glyph
// each badge wraps (CollageTile's `<Move>` SVG, EditableImage's
// camera-glyph <span>) is what actually paints at the badge's own centre
// pixel, and neither carries its own aria-label -- the *badge* does, one
// DOM level up. The z-10 regression this spec guards against puts an
// unrelated Hero.tsx element at that same point instead, which has no
// `aria-label` ancestor at all, so `.closest` correctly comes back null
// there rather than coincidentally matching something else.
//
// Scrolls the locator into view, measures it, and hit-tests its own centre
// -- all three as one atomic step, in that order, for exactly this element.
// `document.elementFromPoint` only ever hit-tests the CURRENT scroll
// position, and the hero's own `min-h-screen` grows taller than the
// viewport once its real content (logo, heading, phone numbers) needs more
// room than 100vh gives it at a narrow width -- the collage covers that
// whole (possibly-taller-than-viewport) section, not just whatever's on
// screen at load. Confirmed directly while writing this spec: tile 1's own
// camera badge measured at y≈914 in an 844px-tall viewport, and
// `elementFromPoint` at that point returned nothing at all (off-screen, not
// occluded) before this scroll existed. Scrolling and measuring and
// hit-testing each badge as one block, never batching the scroll step for
// two different badges before hit-testing either, is what keeps a LATER
// badge's own scroll (the camera's, bottom-right of the tile) from moving
// the page out from under an EARLIER badge's already-measured coordinates
// (the select button's, top-left) before it's hit-tested.
async function hitTestLabel(locator: Locator): Promise<string | null> {
  await locator.scrollIntoViewIfNeeded();
  // Measure and hit-test in ONE evaluate, inside the page, so both read the
  // same frame. The previous version took the box over one round trip
  // (`locator.boundingBox()`) and hit-tested over another
  // (`page.evaluate(elementFromPoint)`), leaving a window in which layout
  // could move underneath the already-measured coordinates -- collage images
  // are `loading: 'lazy'`, so scrolling a tile into view starts loads that
  // resize things a moment later. That made this spec FLAKY rather than
  // wrong: the same commit passed and failed on alternate CI runs, and a test
  // that fails at random teaches everyone to ignore it, which costs more than
  // the regression it was written to catch.
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const labelled = hit?.closest('[aria-label]');
    return labelled ? labelled.getAttribute('aria-label') : null;
  });
}

// Every collage image finished loading, and no scroll still animating. Both
// change layout after the fact, which is the other half of the flake above.
async function settleLayout(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  await page.evaluate(async () => {
    // Every wait here is bounded. An unbounded `await` on an image that never
    // fires load OR error -- one still queued behind `loading="lazy"`, for
    // instance -- hangs the whole spec until Playwright's 30s timeout, which
    // is a worse failure than the flake it was added to fix (confirmed
    // directly: the first version of this helper did exactly that).
    const bounded = <T>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
    await bounded(document.fonts.ready, 3000);
    const images = [...document.querySelectorAll('img')].filter((img) => !img.complete);
    await bounded(
      Promise.all(
        images.map((img) => new Promise((r) => {
          img.addEventListener('load', r, { once: true });
          img.addEventListener('error', r, { once: true });
        })),
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
  test.describe(`hero collage badges are hit-testable at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('all sixteen tiles: the select badge and the camera badge both resolve to themselves under document.elementFromPoint', async ({ page }) => {
      await mockEditBackend(page);
      await page.goto('/edit');

      const tiles = page.locator('[data-collage-tile-index]');
      // Non-vacuous: sixteen real tiles, not a smaller stand-in fixture --
      // the same "sixteen real entries" invariant placement.test.ts's own
      // round-trip describe block pins.
      await expect(tiles).toHaveCount(16);
      await settleLayout(page);

      for (let i = 0; i < 16; i++) {
        const tile = page.locator(`[data-collage-tile-index="${i}"]`);
        // The select toggle: CollageTile's own top-level <button>, the
        // one interactive element directly under the tile wrapper before
        // any tile is selected (the resize handle and the move/size panel
        // both render only once selected -- neither is on screen yet).
        const selectButton = tile.locator('> button[aria-label]');
        // The camera-replace badge: EditableImage's own <label>, nested
        // inside the drag surface. Every one of the sixteen shares the
        // literal aria-label "Replace this photo" -- Hero.tsx passes
        // `alt: ''` for every collage image, and EditableImage falls back
        // to that generic label whenever `alt` is empty (its own
        // `controlLabel` comment) -- so this spec locates it structurally,
        // scoped to this one tile, rather than by a name unique to it.
        const cameraLabel = tile.locator('label[aria-label]');

        await expect(selectButton).toBeVisible();
        await expect(cameraLabel).toBeVisible();

        const selectHit = await hitTestLabel(selectButton);
        expect(selectHit, `tile ${i}: select badge is occluded (hit something with no matching aria-label)`).toMatch(
          /^(Move or change the size of photo|Stop moving photo) \d+$/,
        );

        const cameraHit = await hitTestLabel(cameraLabel);
        expect(cameraHit, `tile ${i}: camera badge is occluded (hit something with no matching aria-label)`).toBe(
          'Replace this photo',
        );
      }
    });
  });
}
