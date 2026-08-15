import { expect, test, type Page } from '@playwright/test';
import { collageBoxes, grabPoint, heroCollageGapCount, heroCollagePhotoCount, openCollage } from './collage-page';

// Plan 9, Task 5: dragging the line between two boxes moves size from one to
// the other, and their total is unchanged.
//
// The owner's requirement is a conservation law -- "if I drag the same picture
// to the left to increase the width of the box, the box to the left should
// [give up space] to make room for this" -- and a conservation law is measured
// in pixels or it is not checked at all. jsdom reports every box as 0x0, so
// nothing in vitest can see any of this: src/admin/__tests__/CollageEditor.
// test.tsx checks the sizes the MODEL writes, and this checks the sizes the
// browser actually lays out.
//
// Four properties:
//   1. One handle per gap, each reachable by a real click -- derived from the
//      committed tree (heroCollageGapCount, collage-page.ts) rather than
//      hardcoded, because the owner can add or remove a collage photo from
//      /edit and every add/remove changes how many splits, and therefore how
//      many gaps, exist.
//   2. Each handle's centre really sits on the gap between its own two boxes.
//   3. A drag moves the boundary to the pointer, and the pair's total is
//      unchanged -- so one box widening IS the other narrowing.
//   4. The handles cost the collage nothing: /edit lays the photos out at
//      exactly the rectangles the public page does.

const GAP_COUNT = heroCollageGapCount();
const PHOTO_COUNT = heroCollagePhotoCount();

// The two boxes a divider sits between: children `gapIndex` and
// `gapIndex + 1` of the split it belongs to. The split's own element holds its
// children first and its handles after them, so the handles are filtered out
// rather than counted on to be absent.
async function pairAround(page: Page, divider: string) {
  return page.evaluate((id) => {
    const [splitId, gap] = id.split(':');
    const split = document.querySelector(`[data-collage-split-id="${splitId}"]`);
    const handle = document.querySelector(`[data-collage-divider="${id}"]`);
    if (!split || !handle) throw new Error(`no divider ${id}`);
    const children = [...split.children].filter((child) => !child.hasAttribute('data-collage-divider'));
    const index = Number(gap);
    const horizontal = getComputedStyle(split).flexDirection === 'row';
    const measure = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        start: horizontal ? r.x : r.y,
        end: horizontal ? r.right : r.bottom,
        extent: horizontal ? r.width : r.height,
      };
    };
    const handleRect = handle.getBoundingClientRect();
    return {
      horizontal,
      first: measure(children[index]),
      second: measure(children[index + 1]),
      handleCentre: horizontal ? handleRect.x + handleRect.width / 2 : handleRect.y + handleRect.height / 2,
      handleX: handleRect.x + handleRect.width / 2,
      handleY: handleRect.y + handleRect.height / 2,
    };
  }, divider);
}

async function dividerIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-collage-divider]')].map((el) => el.getAttribute('data-collage-divider') ?? ''),
  );
}

test.describe('the collage’s dividers at 1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // GAP_COUNT is derived (heroCollageGapCount, collage-page.ts): one gap per
  // split below its own children count minus one, summed over the whole
  // committed tree, so it stays right however many splits an add or a remove
  // leaves behind. Asserted as a number, not just "not empty", so a walk that
  // silently found none would not pass with no assertions run.
  test('every handle resolves to itself under document.elementFromPoint', async ({ page }) => {
    await openCollage(page, '/edit');
    const ids = await dividerIds(page);
    expect(ids).toHaveLength(GAP_COUNT);

    for (const id of ids) {
      const { handleX, handleY } = await pairAround(page, id);
      const hit = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x as number, y as number)?.getAttribute('data-collage-divider') ?? null,
        [handleX, handleY],
      );
      // Hero.tsx's own content column is `relative z-10` and paints across the
      // middle of the collage -- the exact stacking fact that made every
      // camera badge unreachable for the whole life of the photo-replace
      // feature (see EditableImage.tsx's `z-20` comment). A handle that lost
      // that comparison would be a line she can see and cannot grab.
      expect(hit, `divider ${id} is occluded`).toBe(id);
    }
  });

  test('each handle’s centre sits on the gap its own two boxes leave', async ({ page }) => {
    await openCollage(page, '/edit');
    for (const id of await dividerIds(page)) {
      const { first, second, handleCentre } = await pairAround(page, id);
      // The gap is what lies between the end of one box and the start of the
      // next -- measured, not taken from COLLAGE_GAP_PX, so the constant and
      // the rendered `gap-1` are checked against each other rather than
      // assumed equal.
      expect(second.start - first.end, `divider ${id}: unexpected gap`).toBeCloseTo(4, 0);
      expect(handleCentre, `divider ${id}: handle is off its gap`).toBeCloseTo((first.end + second.start) / 2, 0);
    }
  });

  test('dragging a divider gives one box exactly what it takes from the other', async ({ page }) => {
    await openCollage(page, '/edit');
    const boxesBefore = await collageBoxes(page);
    const before = await pairAround(page, 'root:0');
    expect(before.horizontal).toBe(true);

    const travel = 90;
    await page.mouse.move(before.handleX, before.handleY);
    await page.mouse.down();
    await page.mouse.move(before.handleX + travel, before.handleY, { steps: 10 });
    await page.mouse.up();

    const after = await pairAround(page, 'root:0');
    expect(after.first.extent - before.first.extent).toBeCloseTo(travel, 0);
    expect(after.second.extent - before.second.extent).toBeCloseTo(-travel, 0);
    // The conservation law itself, stated directly.
    expect(after.first.extent + after.second.extent).toBeCloseTo(before.first.extent + before.second.extent, 0);

    // Nothing outside that pair changed shape: every photo inside the left
    // branch keeps its share of it, and the whole collage still fills the
    // hero.
    const boxesAfter = await collageBoxes(page);
    expect(boxesAfter.map((b) => b.id)).toEqual(boxesBefore.map((b) => b.id));
    const grew = boxesAfter.filter((b, i) => b.width > boxesBefore[i].width);
    const narrowed = boxesAfter.filter((b, i) => b.width < boxesBefore[i].width);
    // root's own children are photo-1, left-upper-column and right (in that
    // order), and `root:0` is the gap between the first two -- so only THOSE
    // two children's own share of root's width moves; `right` is the third
    // child, sizes[2] untouched, so its pixel width is exactly conserved
    // (same total sizes-sum, same sizes[2]) regardless of what root:0 does.
    // photo-1 is a bare leaf, so it alone grows; left-upper-column is a
    // column split whose two photos (photo-2, photo-3) both stretch to its
    // full width, so both narrow together. Everything inside `right` -- eight
    // of the eleven photos -- is untouched.
    //
    // This is a different claim than the pre-Task-6 tree made here ("four
    // photos live in the left branch and twelve in the right"): Farfalle's
    // removal collapsed root from a clean two-branch split into the current
    // three-child one, so root:0 no longer divides "left branch" from "right
    // branch" -- it divides photo-1 from left-upper-column, full stop, with
    // `right` sitting outside the pair entirely.
    expect(grew.map((b) => b.id)).toEqual(['photo-1']);
    expect(narrowed.map((b) => b.id)).toEqual(['photo-2', 'photo-3']);
    expect(grew.length + narrowed.length).toBe(3);
    expect(boxesAfter).toHaveLength(PHOTO_COUNT);
  });

  test('a divider dragged far past the end stops, leaving the other box on screen', async ({ page }) => {
    await openCollage(page, '/edit');
    const before = await pairAround(page, 'root:0');
    const pairTotal = before.first.extent + before.second.extent;

    await page.mouse.move(before.handleX, before.handleY);
    await page.mouse.down();
    // Well past the right-hand edge of the viewport.
    await page.mouse.move(before.handleX + 3000, before.handleY, { steps: 12 });
    await page.mouse.up();

    const after = await pairAround(page, 'root:0');
    // 15% of what the two share -- MIN_PAIR_SHARE (src/content/collage.ts),
    // the floor that stops a box becoming a photo she can neither see nor
    // select.
    expect(after.second.extent / pairTotal).toBeCloseTo(0.15, 2);
    expect(after.second.extent).toBeGreaterThan(0);
    // ...and every photo inside that box still has a real rectangle.
    for (const box of await collageBoxes(page)) {
      expect(box.width, `${box.id} collapsed`).toBeGreaterThan(0);
      expect(box.height, `${box.id} collapsed`).toBeGreaterThan(0);
    }
  });

  // The handles are absolutely positioned, so they are out of flow and take no
  // space from any flex line. Measured rather than reasoned about: the same
  // same rectangles, from the same tree, with and without the editor.
  test('the editor’s handles cost the layout nothing -- /edit lays out exactly as / does', async ({ page }) => {
    await openCollage(page, '/');
    const publicBoxes = (await collageBoxes(page)).map((b) => [b.x, b.y, b.width, b.height]);
    await openCollage(page, '/edit');
    const editBoxes = (await collageBoxes(page)).map((b) => [b.x, b.y, b.width, b.height]);
    expect(editBoxes).toEqual(publicBoxes);
  });
});

test.describe('changing a box’s size by tapping, at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  // A divider is 4px wide. On a phone it is not a touch target at all, which
  // is why the spec's Risks section makes the button path a mandate -- and why
  // this is driven by real taps on a touch-emulating context rather than by a
  // stubbed media query.
  test('tap a photo, tap Taller, and the box below it gives up exactly that much', async ({ page }) => {
    await openCollage(page, '/edit');
    // photo-2's own parent -- left-upper-column, the column split it shares
    // with photo-3 below it -- is the divider its buttons move.
    // `right-top-left`, the column split the original version of this test
    // used, no longer exists: Farfalle's removal (Task 6) collapsed it away.
    // left-upper-column is the surviving split with the same property this
    // test needs -- a column-direction parent holding exactly one photo
    // pair -- so tapping Taller on its first child exercises the identical
    // gap.
    const before = await pairAround(page, 'left-upper-column:0');
    expect(before.horizontal).toBe(false);
    const pairTotal = before.first.extent + before.second.extent;

    const start = await grabPoint(page, 'photo-2');
    await page.touchscreen.tap(start.x, start.y);
    await page.getByRole('button', { name: 'Make this photo taller, and the one beside it shorter' }).tap();

    const after = await pairAround(page, 'left-upper-column:0');
    expect(after.first.extent).toBeGreaterThan(before.first.extent);
    expect(after.second.extent).toBeLessThan(before.second.extent);
    expect(after.first.extent + after.second.extent).toBeCloseTo(pairTotal, 0);
    // One tap is 5% of what the pair shares (RESIZE_STEP_SHARE).
    expect((after.first.extent - before.first.extent) / pairTotal).toBeCloseTo(0.05, 2);
  });
});
