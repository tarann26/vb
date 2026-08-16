import { expect, test, type Page } from '@playwright/test';
import { collageBoxes, heroCollagePhotoCount, openCollage } from './collage-page';

// Derived, not hardcoded -- see collage-page.ts's own comment on
// heroCollagePhotoCount.
const PHOTO_COUNT = heroCollagePhotoCount();

// Review finding (Critical), and the only kind of test that could have caught
// it: every gesture the collage editor offers -- Wider/Narrower, Swap, Add
// beside, Add below, Remove, and drag-to-swap in either direction -- is gated
// on CHOOSING a photo first, and more than half the collage could not be
// chosen at all.
//
// The cause was a stacking one, so nothing in vitest could see it. A photo box
// carries `relative overflow-hidden` and its own inline sizing and no z-index,
// while Hero.tsx paints `<div className="relative z-10 text-center px-6">`
// over the middle of the same hero -- and a block-level paragraph's hit box
// spans its container's full width, so that column covers far more of the
// collage than it looks like it does. Measured here, in this browser, before
// the fix: at 1440x900 photo-9 had ZERO points anywhere inside it that
// resolved to itself; at 390x844 NINE of the sixteen boxes did. A drop onto
// any of them was refused with "Nothing to swap with there" over a box that is
// plainly a photograph.
//
// WHY THIS FILE AND NOT collage-hit-test.spec.ts. That spec asks the narrow
// question -- does this control's own centre pixel resolve to itself -- and
// now asks it of the select badge too. This one asks the question a reviewer
// actually asked: can she CHOOSE every surviving photo, driven as a user, and do
// the two drag gestures work for the box the content column completely
// covers. A badge that hit-tests but does not select would pass the first and
// fail this.
//
// The specs that existed found none of it because `grabPoint`
// (e2e/collage-page.ts) SCANS a box for a point that happens to be free and
// the collage specs only ever ask it for photo-1, photo-5, photo-8, photo-10,
// photo-12 and photo-16 (the pre-Task-6 ids this review measured against --
// photo-5 and photo-16 were two of the five Farfalle photos Task 6 later
// removed) -- every one of them in the reachable set. Nothing asserted that
// every photo has a point at all. This does.

const VIEWPORTS = [
  { label: '390px (phone)', width: 390, height: 844, touch: true },
  { label: '1440px (desktop)', width: 1440, height: 900, touch: false },
];

function panel(page: Page) {
  return page.locator('[data-collage-panel]');
}

function selectBadge(page: Page, photoId: string) {
  return page.locator(`[data-collage-photo-id="${photoId}"] [data-collage-select]`);
}

for (const viewport of VIEWPORTS) {
  test.describe(`every collage photo can be chosen at ${viewport.label}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
      isMobile: viewport.touch,
    });

    test('every photo: press its badge and the panel says which photo it is', async ({ page }) => {
      await openCollage(page, '/edit');
      const ids = (await collageBoxes(page)).map((box) => box.id);
      expect(ids).toHaveLength(PHOTO_COUNT);

      for (let i = 0; i < ids.length; i++) {
        const badge = selectBadge(page, ids[i]);
        // `.tap()`/`.click()`, not a raw coordinate press: Playwright's own
        // actionability check refuses an element that something else would
        // intercept the press for, so a badge the content column swallowed
        // fails here with that in the message rather than silently choosing
        // nothing. This is the same press she makes.
        if (viewport.touch) await badge.tap();
        else await badge.click();

        await expect(
          panel(page).getByText(`Photo ${i + 1} of ${PHOTO_COUNT}`),
          `${ids[i]} could not be chosen -- every gesture on this collage is gated on this`,
        ).toBeVisible();

        // Closed again before the next one. The panel is a bottom-docked
        // sheet, so a badge whose own rectangle falls in the band it covers
        // needs it out of the way first -- which is what "Done" is, and what
        // she would do. Leaving it open is what turns this into a test of the
        // panel's position rather than of the collage's reachability.
        await panel(page).getByRole('button', { name: 'Close this panel' }).click();
        await expect(panel(page)).toHaveCount(0);
      }
    });
  });
}

// Found while driving the sweep above, and the reason it is here rather than
// in a note: the panel is a bottom sheet 235px tall on a 390px phone, so
// choosing a photo low on the screen puts one of its buttons under the finger
// that chose it -- and the browser's own COMPATIBILITY click, dispatched after
// touchend against the DOM as it then stands, pressed that button. One tap
// selected photo-15 and made it shorter; the same thing in a longer sweep
// pressed Remove and a photograph left the collage. Nothing in the suite could
// have caught it: the only 390px taps anywhere were on photo-1 and photo-8,
// both near the top of the screen, and jsdom has no compatibility mouse events
// to dispatch and no layout to dispatch them against.
test.describe('choosing a photo the panel will then cover, at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the tap that opens the panel does not also press one of its buttons', async ({ page }) => {
    await openCollage(page, '/edit');

    // Measure where the panel actually sits rather than assuming a height:
    // open it on a photo at the top of the collage, read its top edge, close
    // it again.
    await selectBadge(page, 'photo-1').tap();
    const panelTop = await panel(page).evaluate((el) => Math.round(el.getBoundingClientRect().top));
    await panel(page).getByRole('button', { name: 'Close this panel' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(panelTop, 'the panel does not overlap the collage at all -- this test has nothing to check').toBeLessThan(
      844,
    );

    const victim = await page.evaluate((top) => {
      for (const box of document.querySelectorAll('[data-collage-photo-id]')) {
        const badge = box.querySelector('[data-collage-select]');
        if (badge === null) continue;
        const r = badge.getBoundingClientRect();
        const centre = r.y + r.height / 2;
        if (centre > top + 8 && centre < window.innerHeight - 6) {
          return { id: box.getAttribute('data-collage-photo-id') ?? '', y: Math.round(centre) };
        }
      }
      return null;
    }, panelTop);
    expect(victim, 'no photo sits where the panel will open -- this test has nothing to check').not.toBeNull();

    const before = await collageBoxes(page);
    const index = before.findIndex((box) => box.id === victim!.id);
    await selectBadge(page, victim!.id).tap();

    // It IS chosen -- the tap did its own job...
    await expect(panel(page).getByText(`Photo ${index + 1} of ${PHOTO_COUNT}`)).toBeVisible();
    // ...and it did nothing else. Every box is the rectangle it was (the
    // button under her finger was "Make this photo shorter", which took 13px
    // off this one) and every photo is still here (in a longer sweep
    // the button under the finger was "Remove").
    const after = await collageBoxes(page);
    expect(after).toHaveLength(PHOTO_COUNT);
    expect(after.map((b) => [b.id, b.x, b.y, b.width, b.height])).toEqual(
      before.map((b) => [b.id, b.x, b.y, b.width, b.height]),
    );
  });
});

// The two drag gestures, against the ONE box Hero's content column covers
// completely at desktop width. Desktop only, deliberately: a finger drag is
// never armed as a swap (see CollageEditor.tsx's header), and the tap path for
// the same photo is what the loop above just proved.
test.describe('the box the hero’s own content column covers, at 1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Its centre, not a scanned free point: the whole question is whether a
  // gesture works AT the covered pixels.
  async function centreOf(page: Page, photoId: string): Promise<{ x: number; y: number }> {
    return page.evaluate((id) => {
      const box = document.querySelector(`[data-collage-photo-id="${id}"]`);
      if (!box) throw new Error(`no box for ${id}`);
      const r = box.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, photoId);
  }

  async function badgeCentre(page: Page, photoId: string): Promise<{ x: number; y: number }> {
    return selectBadge(page, photoId).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
  }

  // The precondition this whole describe block depends on, asserted rather
  // than assumed: photo-3's own centre pixel must resolve to Hero's content
  // column (`section .relative.z-10`), not to itself. Without this, the two
  // tests below degrade silently -- a later rebalance that gives
  // left-upper-column even a little more width could uncover photo-3's centre
  // by a few pixels, and both tests would keep passing as ordinary
  // drag-and-drop tests that no longer exercise the covered-box case they
  // exist for. Measured directly (not `.relative.z-10` alone, which would
  // also match if the point fell on the box's own element for some other
  // reason): `document.elementFromPoint` at the centre must find something
  // inside the content column AND that something must not be inside photo-3's
  // own box.
  async function centreIsCoveredByContentColumn(page: Page, photoId: string): Promise<boolean> {
    const { x, y } = await centreOf(page, photoId);
    return page.evaluate(
      ([px, py, id]) => {
        const hit = document.elementFromPoint(px as number, py as number);
        if (!hit) return false;
        if (hit.closest(`[data-collage-photo-id="${id as string}"]`)) return false;
        return hit.closest('section .relative.z-10') !== null;
      },
      [x, y, photoId] as const,
    );
  }

  async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  }

  // photo-3, not photo-9: photo-9 was one of the five Farfalle photos Task 6
  // removed. The property this describe block needs -- a box whose CENTRE
  // resolves to the content column rather than to itself, so a naive
  // single-point `elementFromPoint` drag or drop fails on it -- is asserted
  // directly against the rebalanced tree by `centreIsCoveredByContentColumn`
  // below, at the top of both tests: photo-3's own centre sits under the
  // reservation phone numbers, not under its own <img>. That assertion is
  // what stops a future rebalance from quietly widening left-upper-column
  // enough to uncover photo-3's centre and turning both tests into ordinary
  // drag-and-drop tests that stay green without checking what they exist
  // for. (photo-9 used to fail
  // EVERYWHERE inside its box, not just at the centre; Task 6's own rebalance
  // -- the owner's "whitespace can be squashed" -- widened every surviving
  // tile enough that none is fully swallowed by the column any more at this
  // width. The centre is still covered, which is the case
  // CollageSelectBadge.tsx's own comment names and the one a naive
  // drag-start would fail on.)
  //
  // photo-2, front mirror.webp, is ALSO centre-covered and was the first
  // choice here, but its badge sits in the collage's TOP ROW (`top: 4`
  // relative to a box starting at y=0) -- exactly where NavBar.tsx's `fixed`
  // header briefly still overlaps while its own hide-on-scroll transition
  // (`transition-all duration-500`) is still in flight after the page loads.
  // `openCollage`'s `waitForStableLayout` only waits for the COLLAGE to stop
  // moving, not for the nav's own animation, so a raw `page.mouse.down()`
  // (no actionability wait, unlike `.click()`) landed on the nav instead of
  // the badge roughly one run in three -- confirmed directly: 6/6 failures
  // driving this test alone against photo-2, all with the nav's own
  // bounding rect still overlapping y=4..36 mid-transition. photo-3's box
  // starts at y=362, well clear of that window.
  test('a drag begun on its badge carries the photo, and the two trade places', async ({ page }) => {
    await openCollage(page, '/edit');
    expect(
      await centreIsCoveredByContentColumn(page, 'photo-3'),
      'precondition: photo-3’s own centre must resolve to the content column, not to itself -- otherwise this test is not exercising the covered-box case it exists for',
    ).toBe(true);
    const before = await collageBoxes(page);
    const fromIndex = before.findIndex((box) => box.id === 'photo-3');
    const toIndex = before.findIndex((box) => box.id === 'photo-1');
    expect(fromIndex).toBeGreaterThanOrEqual(0);
    expect(toIndex).toBeGreaterThanOrEqual(0);

    await dragBetween(page, await badgeCentre(page, 'photo-3'), await centreOf(page, 'photo-1'));

    await expect(panel(page).getByRole('status')).toContainText('Swapped.');
    const after = await collageBoxes(page);
    expect(after[fromIndex].id).toBe('photo-1');
    expect(after[toIndex].id).toBe('photo-3');
    expect(after[fromIndex].src).toBe(before[toIndex].src);
    expect(after[toIndex].src).toBe(before[fromIndex].src);
    // The owner's own rule -- "The boxes keep their shape" -- still holds for
    // a drag begun somewhere new.
    expect(after.map((b) => [b.x, b.y, b.width, b.height])).toEqual(before.map((b) => [b.x, b.y, b.width, b.height]));
  });

  // The other half, and the one a user hits first: dropping ONTO the covered
  // box. `document.elementFromPoint` answers "the reservation phone numbers"
  // for photo-3's own centre pixel, so this used to be refused with "Nothing
  // to swap with there" and was never even marked as a destination mid-drag.
  test('a drop onto its centre is marked before the drop, and accepted', async ({ page }) => {
    await openCollage(page, '/edit');
    expect(
      await centreIsCoveredByContentColumn(page, 'photo-3'),
      'precondition: photo-3’s own centre must resolve to the content column, not to itself -- otherwise this test is not exercising the covered-box case it exists for',
    ).toBe(true);
    const before = await collageBoxes(page);
    const fromIndex = before.findIndex((box) => box.id === 'photo-1');
    const toIndex = before.findIndex((box) => box.id === 'photo-3');

    const from = await centreOf(page, 'photo-1');
    const to = await centreOf(page, 'photo-3');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 12 });

    // Marked as the destination while the pointer is still down -- the plan's
    // "show the target before the drop", for a box that could never show it.
    await expect(page.locator('[data-collage-photo-id="photo-3"] [data-collage-overlay="target"]')).toHaveCount(1);
    await expect(page.locator('[data-collage-overlay="target"]')).toHaveCount(1);

    await page.mouse.up();
    await expect(panel(page).getByRole('status')).toContainText('Swapped.');
    const after = await collageBoxes(page);
    expect(after[fromIndex].id).toBe('photo-3');
    expect(after[toIndex].id).toBe('photo-1');
  });
});
