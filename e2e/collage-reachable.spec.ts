import { expect, test, type Page } from '@playwright/test';
import { collageBoxes, openCollage } from './collage-page';

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
// actually asked: can she CHOOSE each of the sixteen, driven as a user, and do
// the two drag gestures work for the box the content column completely
// covers. A badge that hit-tests but does not select would pass the first and
// fail this.
//
// The specs that existed found none of it because `grabPoint`
// (e2e/collage-page.ts) SCANS a box for a point that happens to be free and
// the collage specs only ever ask it for photo-1, photo-5, photo-8, photo-10,
// photo-12 and photo-16 -- every one of them in the reachable set. Nothing
// asserted that every photo has a point at all. This does.

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

    test('all sixteen: press its badge and the panel says which photo it is', async ({ page }) => {
      await openCollage(page, '/edit');
      const ids = (await collageBoxes(page)).map((box) => box.id);
      expect(ids).toHaveLength(16);

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
          panel(page).getByText(`Photo ${i + 1} of 16`),
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
    await expect(panel(page).getByText(`Photo ${index + 1} of 16`)).toBeVisible();
    // ...and it did nothing else. Every box is the rectangle it was (the
    // button under her finger was "Make this photo shorter", which took 13px
    // off this one) and all sixteen photos are still here (in a longer sweep
    // the button under the finger was "Remove").
    const after = await collageBoxes(page);
    expect(after).toHaveLength(16);
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

  async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  }

  // Nothing inside photo-9's rectangle is pressable, so its select badge is
  // also the only place a drag from it can START -- which is why a press on
  // that badge, alone among the controls inside a box, is let through to the
  // drag handler (CollageEditor's pointerdown carve-out on
  // `data-collage-select`).
  test('a drag begun on its badge carries the photo, and the two trade places', async ({ page }) => {
    await openCollage(page, '/edit');
    const before = await collageBoxes(page);
    const fromIndex = before.findIndex((box) => box.id === 'photo-9');
    const toIndex = before.findIndex((box) => box.id === 'photo-1');
    expect(fromIndex).toBeGreaterThanOrEqual(0);
    expect(toIndex).toBeGreaterThanOrEqual(0);

    await dragBetween(page, await badgeCentre(page, 'photo-9'), await centreOf(page, 'photo-1'));

    await expect(panel(page).getByRole('status')).toContainText('Swapped.');
    const after = await collageBoxes(page);
    expect(after[fromIndex].id).toBe('photo-1');
    expect(after[toIndex].id).toBe('photo-9');
    expect(after[fromIndex].src).toBe(before[toIndex].src);
    expect(after[toIndex].src).toBe(before[fromIndex].src);
    // The owner's own rule -- "The boxes keep their shape" -- still holds for
    // a drag begun somewhere new.
    expect(after.map((b) => [b.x, b.y, b.width, b.height])).toEqual(before.map((b) => [b.x, b.y, b.width, b.height]));
  });

  // The other half, and the one a user hits first: dropping ONTO the covered
  // box. `document.elementFromPoint` answers "the heading" for every pixel of
  // photo-9, so this used to be refused with "Nothing to swap with there" and
  // was never even marked as a destination mid-drag.
  test('a drop onto its centre is marked before the drop, and accepted', async ({ page }) => {
    await openCollage(page, '/edit');
    const before = await collageBoxes(page);
    const fromIndex = before.findIndex((box) => box.id === 'photo-1');
    const toIndex = before.findIndex((box) => box.id === 'photo-9');

    const from = await centreOf(page, 'photo-1');
    const to = await centreOf(page, 'photo-9');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 12 });

    // Marked as the destination while the pointer is still down -- the plan's
    // "show the target before the drop", for a box that could never show it.
    await expect(page.locator('[data-collage-photo-id="photo-9"] [data-collage-overlay="target"]')).toHaveCount(1);
    await expect(page.locator('[data-collage-overlay="target"]')).toHaveCount(1);

    await page.mouse.up();
    await expect(panel(page).getByRole('status')).toContainText('Swapped.');
    const after = await collageBoxes(page);
    expect(after[fromIndex].id).toBe('photo-9');
    expect(after[toIndex].id).toBe('photo-1');
  });
});
