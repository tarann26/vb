import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

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
  // Plan 7, Task 1: the tenth real content file -- EditMode.tsx's own
  // CONTENT_FILES (src/admin/content.ts) now fetches it too, and without a
  // mocked route for it here, the mock below answers 404, which surfaces
  // as a "Could not load pages.json" banner above the real page content.
  'pages.json',
];

// The real, committed content -- not a hand-built fixture. `galleries.json`
// in particular is what makes this exercise the real sixteen tiles at their
// real positions, the same content src/content/__tests__/placement.test.ts's
// own "the real, repaired galleries.json" describe block pins numerically.
function realContentJson(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'content', name), 'utf8');
}

// EditMode.tsx's own `useSession` treats a 200 JSON response from GET
// /api/wa as "logged in" -- it doubles as the session probe (see that
// hook's own header comment for why), so faking that one response is
// enough to reach the real, authenticated /edit screen without a real
// Worker, a real KV namespace, or a real login POST anywhere in this test.
// GET /api/content?path=src/content/<name> is the only other network call
// EditMode makes before first paint (one per file in CONTENT_FILES) --
// faked here from the real files on disk so the page renders the actual
// production content, not a stand-in.
async function mockEditBackend(page: Page): Promise<void> {
  await page.route('**/api/wa', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // `**/api/content**` -- the trailing double star, not a single one:
  // Playwright's glob route patterns treat a bare `*` as "any characters
  // except `/`", and this request's own query string
  // (`?path=src/content/<name>`) contains slashes, so a single-star
  // pattern here silently never matches at all (confirmed directly -- the
  // route handler's own body never ran, and every one of the nine files
  // failed to load with no other explanation on screen).
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
}

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
async function hitTestLabel(page: Page, locator: Locator): Promise<string | null> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('hitTestLabel: element has no bounding box');
  return page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const labelled = el?.closest('[aria-label]');
      return labelled ? labelled.getAttribute('aria-label') : null;
    },
    [box.x + box.width / 2, box.y + box.height / 2] as [number, number],
  );
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

        const selectHit = await hitTestLabel(page, selectButton);
        expect(selectHit, `tile ${i}: select badge is occluded (hit something with no matching aria-label)`).toMatch(
          /^(Move or change the size of photo|Stop moving photo) \d+$/,
        );

        const cameraHit = await hitTestLabel(page, cameraLabel);
        expect(cameraHit, `tile ${i}: camera badge is occluded (hit something with no matching aria-label)`).toBe(
          'Replace this photo',
        );
      }
    });
  });
}
