import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockEditBackend } from './edit-backend';

// The committed, re-runnable version of a proof that was once a one-shot
// manual run recorded in prose: "the camera badge is reachable on 16/16
// collage photos at both 390px and 1440px". It exists to catch a REGRESSION
// of the z-index fix EditableImage.tsx carries (`CONTROL_LABEL_CLASSNAME`/
// `ERROR_CONTROL_LABEL_CLASSNAME` are `z-20`, not `z-10`) -- the bug that made
// every one of the sixteen camera badges unreachable by a real click for the
// whole life of the photo-replace feature. No vitest test in this repo can:
// jsdom has no layout engine to hit-test against, and the reviewer's own
// mutation (both `z-20`s back to `z-10`) left the entire suite green.
//
// This spec used to cover CollageTile's select badge too. The split tree
// deleted that control along with the grid placement it moved, so what is
// left is the one affordance a collage photo still carries -- and the tree
// makes this MORE worth checking, not less: the collage is now nested flex
// containers rather than one grid, so every level is a fresh chance for a
// stacking context to swallow a badge.
//
// `document.elementFromPoint` at the badge's own measured centre, not a
// Playwright `.click()`: a real click on the camera badge opens the OS's
// native file picker, which cannot be dismissed from a script. Reading what
// is actually under the pointer -- the same thing a real click's own
// hit-test does -- proves the identical fact without the side effect.

// `.closest('[aria-label]')`, not a direct element match: the glyph that
// paints at the badge's centre pixel (EditableImage's camera <span>) carries
// no aria-label of its own -- the badge does, one DOM level up. The z-10
// regression this guards against puts an unrelated Hero.tsx element at that
// point instead, which has no `aria-label` ancestor at all, so `.closest`
// correctly comes back null rather than coincidentally matching something.
//
// Scrolls, measures and hit-tests as ONE atomic step, in that order, for
// exactly this element. `document.elementFromPoint` only ever hit-tests the
// CURRENT scroll position, and the hero's own `min-h-screen` grows taller
// than the viewport once its real content needs more room than 100vh gives
// it at a narrow width. Measuring and hit-testing inside one `evaluate`, in
// the page, keeps both reading the same frame -- collage images are lazy, so
// scrolling one into view starts loads that resize things a moment later,
// which made an earlier two-round-trip version of this spec flaky rather
// than wrong. A test that fails at random teaches everyone to ignore it.
async function hitTestLabel(locator: Locator): Promise<string | null> {
  await locator.scrollIntoViewIfNeeded();
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

    test('all sixteen photos: the camera badge resolves to itself under document.elementFromPoint', async ({ page }) => {
      await mockEditBackend(page);
      await page.goto('/edit');

      // Located by the editing path EditableImage carries, which is
      // `galleries.heroCollage.<photo id>` -- an id, not a position, so this
      // selector keeps naming the same photographs after a swap.
      const photos = page.locator('[data-editable-image-path^="galleries.heroCollage."]');
      // Non-vacuous: sixteen real photos, not a smaller stand-in fixture.
      await expect(photos).toHaveCount(16);
      await settleLayout(page);

      const count = await photos.count();
      for (let i = 0; i < count; i++) {
        // EditableImage's own <label>. All sixteen share the literal
        // aria-label "Replace this photo" -- every collage photo's `alt` is
        // empty (they are decorative background behind the hero's own
        // heading), and EditableImage falls back to that generic label
        // whenever `alt` is empty -- so this locates it structurally, scoped
        // to one photo, rather than by a name unique to it.
        const cameraLabel = photos.nth(i).locator('label[aria-label]');
        await expect(cameraLabel).toBeVisible();
        const cameraHit = await hitTestLabel(cameraLabel);
        expect(cameraHit, `photo ${i}: camera badge is occluded (hit something with no matching aria-label)`).toBe(
          'Replace this photo',
        );
      }
    });
  });
}
