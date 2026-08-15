import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockEditBackend } from './edit-backend';
import { heroCollagePhotoCount } from './collage-page';

// Derived, not hardcoded: the owner can add or remove a collage photo from
// /edit, and Task 6 (dropping the five Farfalle photos) is exactly the
// content edit that made a hardcoded photo count in this file wrong.
const PHOTO_COUNT = heroCollagePhotoCount();

// The committed, re-runnable version of a proof that was once a one-shot
// manual run recorded in prose: "the camera badge is reachable on every
// collage photo at both 390px and 1440px". It exists to catch a REGRESSION
// of the z-index fix EditableImage.tsx carries (`CONTROL_LABEL_CLASSNAME`/
// `ERROR_CONTROL_LABEL_CLASSNAME` are `z-20`, not `z-10`) -- the bug that made
// every one of the sixteen camera badges unreachable by a real click for the
// whole life of the photo-replace feature. No vitest test in this repo can:
// jsdom has no layout engine to hit-test against, and the reviewer's own
// mutation (both `z-20`s back to `z-10`) left the entire suite green.
//
// It also covers the SELECT badge on every photo -- an assertion this spec
// used to make about CollageTile's own version of that control, and lost when
// the split tree deleted CollageTile without replacing the control. A review
// found what that cost, measured in this same browser: with no select badge,
// choosing a photo meant pressing its box, and a photo box carries no z-index
// at all, so Hero.tsx's `relative z-10` content column swallowed the press for
// NINE of the sixteen boxes at 390x844 and for the whole of photo-9 at
// 1440x900. Every gesture the collage editor offers is gated on choosing a
// photo first. src/admin/CollageSelectBadge.tsx is the replacement, and this
// is the assertion that keeps it honest -- for both badges at once, since they
// share the layer and a regression would take both.
//
// The tree makes this MORE worth checking than the grid did, not less: the
// collage is nested flex containers now rather than one grid, so every level
// is a fresh chance for a stacking context to swallow a badge.
//
// SCOPE, stated because the obvious reading is wider than the truth: this
// measures a page with NOTHING selected. The collage panel is a bottom-docked
// `fixed ... z-50` sheet, so once something IS selected it covers the bottom
// band of the viewport, and a control whose own rectangle falls inside that
// band resolves to the panel instead. Measured with photo-16 selected: one of
// the sixteen select badges (photo-15's) and a handful of camera badges are
// occluded that way at each viewport. That is a property of a bottom sheet
// rather than of this collage -- pressing Done, or scrolling, clears it -- and
// dropping a dragged photo onto a box under the panel does work, because
// CollageEditor asks `elementsFromPoint` for the whole stack rather than
// `elementFromPoint` for the top of it.
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

    test('every collage photo: both badges resolve to themselves under document.elementFromPoint', async ({ page }) => {
      await mockEditBackend(page);
      await page.goto('/edit');

      // Located by the editing path EditableImage carries, which is
      // `galleries.heroCollage.<photo id>` -- an id, not a position, so this
      // selector keeps naming the same photographs after a swap.
      const photos = page.locator('[data-editable-image-path^="galleries.heroCollage."]');
      // Non-vacuous: PHOTO_COUNT real photos, not a smaller stand-in fixture.
      await expect(photos).toHaveCount(PHOTO_COUNT);
      const boxes = page.locator('[data-collage-photo-id]');
      await expect(boxes).toHaveCount(PHOTO_COUNT);
      await settleLayout(page);

      const count = await photos.count();
      for (let i = 0; i < count; i++) {
        // EditableImage's own <label>. Every photo shares the literal
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

        // The select badge, on the opposite corner. Located from the BOX
        // rather than from `photos.nth(i)`: EditableImage's own wrapper is
        // what carries `data-editable-image-path`, and the badge is that
        // wrapper's sibling inside the box, not its descendant. Same document
        // order, one box per photo. `data-collage-select` is set by
        // CollageSelectBadge and by nothing else, so this is addressed by the
        // same marker the editor's own pointer handler carves out -- one
        // spelling, not two that can drift. Its label names the position, so
        // this also proves the badge she presses and the "Photo N of
        // PHOTO_COUNT" she then reads are talking about the same photograph.
        const selectBadge = boxes.nth(i).locator('[data-collage-select]');
        await expect(selectBadge).toBeVisible();
        const selectHit = await hitTestLabel(selectBadge);
        expect(selectHit, `photo ${i}: select badge is occluded -- this photo cannot be chosen at all`).toBe(
          `Choose photo ${i + 1} of ${PHOTO_COUNT}`,
        );
      }
    });
  });
}
