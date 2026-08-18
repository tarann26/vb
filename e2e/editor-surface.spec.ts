// Everything about EditorSheet and the two drag-and-drop lists that jsdom
// cannot honestly assert -- collected from every task report in this
// section that deferred a claim here. jsdom has no layout engine, no real
// DataTransfer and no computed style, so a claim about geometry,
// containment, hover, cursor or a real drop belongs here and nowhere else.
//
// D1's own claim is the one this file exists to prove: EditorSheet is not
// portalled, `position: fixed` places it against the viewport because
// nothing in src/admin establishes a competing containing block, and the
// layout collapses to a full-screen sheet below the 640px breakpoint. D2's
// claim (zIndex: 60 need not beat the portalled ConfirmPanel's 70) and the
// Escape handler's `preventDefault()` are deliberately NOT tested here --
// see the note at the foot of this file for why neither claim can be
// reddened by any mutation, which is the same reason the brief's own sketch
// carries no "publish bar does not cover the sheet" test.
//
// HAZARD, met four times already this section: a helper that clicks a row
// while a sheet from an earlier click is still opening times out against
// the overlay, not against the row -- the overlay exists because D1 forbids
// portalling it out of the way. Every helper below opens at most one editor
// per test and never clicks a row a second time after the first click's
// dialog has appeared.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockEditBackend } from './edit-backend';
import { startDragging, dropOnto } from './drag';

const DISHES_PANEL = '[data-panel="dishes"]';
const DIALOG = '[data-panel="dishes"] [role="dialog"]';
const SECTIONS_PANEL = '[data-panel="sections"]';

// Dishes is the first panel of the "menu" area, so the shell's own
// first-visit seed (open-sections.ts) opens it without any localStorage
// priming -- e2e/dashboard-sections.spec.ts:139's own comment says so for
// the identical route.
async function openDishesPanel(page: Page): Promise<Locator> {
  await mockEditBackend(page);
  await page.goto('/edit/manage/menu');
  const panel = page.locator(DISHES_PANEL);
  await expect(panel.getByRole('button', { name: 'Add a dish' })).toBeVisible();
  return panel;
}

// Opens the FIRST dish's row exactly once. The hazard note above is why
// this never clicks a row twice: a second click anywhere on this panel
// while the dialog from the first is still animating in lands on the
// overlay, not on whatever the second click named.
async function openFirstDishEditor(page: Page): Promise<Locator> {
  const panel = await openDishesPanel(page);
  const row = panel.locator('[data-item-row]').first();
  // The row's own open button is first in DOM order, before any Up/Down
  // move button -- ItemList.tsx renders it that way, and
  // dashboard-sections.spec.ts's own thumbnail test relies on the same
  // ordering.
  await row.getByRole('button').first().click();
  const dialog = page.locator(DIALOG);
  await dialog.waitFor();
  return dialog;
}

// Real committed content, not a fixture -- every dish name below is read off
// the page rather than assumed, the same "LOOK FIRST" rule
// block-editor.spec.ts's own drag test documents for its block kinds.
async function dishNames(panel: Locator): Promise<string[]> {
  return panel.locator('[data-item-row] .truncate').allTextContents();
}

// "sections" is the SECOND panel of the "pages" area (panelIds[0] is
// "pages" itself), so unlike Dishes this one starts folded on a first visit
// and has to be opened explicitly.
async function openSectionsPanel(page: Page): Promise<Locator> {
  await mockEditBackend(page);
  await page.goto('/edit/manage/pages');
  const panel = page.locator(SECTIONS_PANEL);
  const toggle = panel.getByRole('button', { name: 'What shows on the homepage', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return panel;
}

// SectionList does not use ItemList (a checkbox cannot nest inside a
// button, its own header comment explains why), so its row name is read off
// the second <span> in each <li> -- the first is the drag handle's own
// aria-hidden glyph, and the name is the plain-text span right after it.
async function sectionNames(panel: Locator): Promise<string[]> {
  return panel.locator('ul > li').evaluateAll((rows) =>
    rows.map((row) => row.querySelectorAll('span')[1]?.textContent?.trim() ?? ''),
  );
}

// e2e/dashboard-sections.spec.ts:45's own helper, restated here rather than
// imported: that file exports nothing, on purpose (a plain .spec.ts with no
// shared export is what keeps Playwright from double-counting it as a
// module under test), and this is the only other place in the suite that
// needs a real hit-test.
async function hitTestSelf(locator: Locator): Promise<{ self: boolean; hit: string }> {
  return locator.evaluate((el) => {
    const rect = el.getClientRects()[0] ?? el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const describe = (node: Element | null): string => {
      if (!node) return 'nothing (off-screen)';
      const label = node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 40) ?? '';
      return `<${node.tagName.toLowerCase()}> ${label}`;
    };
    return { self: hit !== null && (hit === el || el.contains(hit)), hit: describe(hit) };
  });
}

test.describe('the editor surface', () => {
  // D1's containing-block claim, and D2's layout claim, at the two
  // viewports this project already measures elsewhere
  // (dashboard-sections.spec.ts's own VIEWPORTS).
  test('at 1280 it is a centred dialog with the page still visible behind it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openFirstDishEditor(page);
    const box = (await page.locator(DIALOG).boundingBox())!;
    // Mutation: drop `sm:m-auto sm:w-[32rem]` from PANEL_CLASSNAME -- the
    // panel stretches to the full 1280px width and this reddens.
    expect(box.width).toBeLessThan(1280 * 0.7);
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(4);
    // The page is still visible behind it: a full-height panel would put
    // y at 0, same as the phone sheet below.
    expect(box.y).toBeGreaterThan(0);
  });

  test('at 390 it is a full-screen sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstDishEditor(page);
    const box = (await page.locator(DIALOG).boundingBox())!;
    expect(box.width).toBe(390);
    expect(box.height).toBe(844);
    expect(box.y).toBe(0);
  });

  // The containing-block claim D1 itself rests on: nothing between
  // ManageShell's root and the panel body establishes a competing one, so
  // `position: fixed` places the panel against the VIEWPORT, not against
  // any ancestor's own box -- which is the one thing a scroll can prove and
  // a static screenshot cannot. Its own viewport, per the brief: the
  // sheet's resting y differs between the two layouts, and 390 is where the
  // panel has no internal scroll headroom of its own to absorb the wheel
  // first.
  test('the sheet is positioned against the viewport, not against the panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstDishEditor(page);
    const before = (await page.locator(DIALOG).boundingBox())!.y;
    await page.mouse.wheel(0, 600);
    // Mutation: `fixed inset-0 flex` -> `absolute inset-0 flex` on the
    // overlay -- with nothing else in the tree positioned, an absolutely
    // positioned overlay is laid out in the document's own flow and moves
    // with it when the underlying page scrolls, dragging this in-flow
    // panel along with it. `fixed` does not move regardless of what
    // scrolls beneath it, which is the whole claim.
    expect((await page.locator(DIALOG).boundingBox())!.y).toBe(before);
  });

  // ROW_CLASSNAME's `hover:bg-brand/10`. No editor is open for this one --
  // the row being hovered is the list's own, not anything inside a dialog,
  // so the hazard note at the top of this file does not apply.
  test('hovering a row highlights the whole row', async ({ page }) => {
    const panel = await openDishesPanel(page);
    const row = panel.locator('[data-item-row]').first().getByRole('button').first();
    const before = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    await row.hover();
    // Polled, not read once: ROW_CLASSNAME also carries `transition`, so the
    // background is still animating for a beat after the hover lands.
    await expect
      .poll(async () => row.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe(before);
  });

  // Tab reaches the row's own open button, and the resulting focus is
  // visibly indicated -- not merely present in the DOM. A REAL keyboard
  // Tab, not `.focus()` alone: Chromium's own :focus-visible heuristic does
  // not reliably match a script-triggered focus, only one that followed a
  // keyboard interaction, so the row is reached by pressing Tab off the Add
  // button rather than calling .focus() on it directly.
  //
  // CORRECTION TO THE BRIEF'S OWN MUTATION TABLE, found while proving this
  // one: dropping `focus-visible:outline focus-visible:outline-2
  // focus-visible:outline-accent` from ROW_CLASSNAME does NOT redden the
  // outline half of this test -- confirmed directly. src/index.css:69-72
  // carries a sitewide `button:focus-visible, a:focus-visible { outline: 2px
  // solid #9D4949; outline-offset: 2px }` rule that already matches this
  // element (it is a real <button>), independently of ROW_CLASSNAME's own
  // utility classes -- either alone is sufficient, so the two are
  // redundant, not layered. The outline assertion below is kept anyway: it
  // is still a real, browser-only accessibility guarantee (jsdom cannot
  // read a computed outline), just not one that isolates ItemList's own
  // styling. What DOES isolate ItemList: the drag handle sitting right
  // before the row's own button in the DOM is `aria-hidden` with no
  // `tabIndex`, so it is not a stop on the way here. Mutation: give that
  // handle span `tabIndex={0}` -- Tab then lands on the handle instead, and
  // `toBeFocused()` below reddens.
  test('keyboard focus highlights the row too', async ({ page }) => {
    const panel = await openDishesPanel(page);
    const addButton = panel.getByRole('button', { name: 'Add a dish' });
    const row = panel.locator('[data-item-row]').first().getByRole('button').first();
    const before = await row.evaluate((el) => getComputedStyle(el).outlineStyle);
    await addButton.focus();
    await page.keyboard.press('Tab');
    await expect(row).toBeFocused();
    await expect.poll(async () => row.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe(before);
  });

  // The real drag-and-drop reorder path. jsdom's DataTransfer carries no
  // usable data and cannot fire a real dragstart at all --
  // src/admin/manage/ItemList.tsx's own onDragOver/onDrop comments say this
  // is where the coverage lives. A MOVE, not a swap: dragging the first
  // dish onto the fourth slides the two in between down by one rather than
  // exchanging the two endpoints, which is what tells moveTo and swapAt
  // apart and is why there is no jsdom mutation row for the swap shape.
  // This test doubles as the proof for onDragOver's own
  // `event.preventDefault()` (Task 2's own deferred claim): confirmed
  // directly, deleting it leaves the order unchanged -- Chromium refuses to
  // fire `drop` on a target whose `dragover` did not call preventDefault, so
  // the whole gesture below silently does nothing without it.
  test('dragging a dish three rows down slides the others', async ({ page }) => {
    const panel = await openDishesPanel(page);
    const before = await dishNames(panel);
    expect(before.length).toBeGreaterThanOrEqual(5);

    await startDragging(page, panel.locator('[data-drag-handle="0"]'));
    await dropOnto(page, panel.locator('[data-drag-handle="3"]'));

    const after = await dishNames(panel);
    // Mutation: `onMove(dragging, index)` calls swapAt instead of moveTo --
    // a swap would give [before[3], before[1], before[2], before[0],
    // before[4]] instead, which is a different permutation from the one
    // asserted below.
    expect(after.slice(0, 5)).toEqual([before[1], before[2], before[3], before[0], before[4]]);
  });

  // DRAGGING_STYLE. Both halves, because a version that dimmed on
  // dragstart and never cleared would satisfy only the first --
  // block-editor.spec.ts's own comment on this exact shape of bug, for the
  // same style object shared via drag-row.ts.
  test('the row in flight is dimmed, and stops being dimmed once it lands', async ({ page }) => {
    const panel = await openDishesPanel(page);
    const rows = panel.locator('[data-item-row]');
    await expect(rows.nth(0)).toHaveCSS('opacity', '1');

    await startDragging(page, panel.locator('[data-drag-handle="0"]'));
    // Mutation: delete `style={dragging === index ? DRAGGING_STYLE :
    // undefined}` -- opacity never leaves '1' and this reddens.
    await expect(rows.nth(0)).toHaveCSS('opacity', '0.5');
    // And only that one -- a statement about WHICH row she has hold of.
    await expect(rows.nth(1)).toHaveCSS('opacity', '1');

    await dropOnto(page, panel.locator('[data-drag-handle="1"]'));
    await expect(rows.nth(0)).toHaveCSS('opacity', '1');
    await expect(rows.nth(1)).toHaveCSS('opacity', '1');
  });

  // HANDLE_STYLE. Read off the handle itself, not an ancestor: cursor IS
  // inherited, so reading a parent would pass on a handle that had lost the
  // style -- the same reading-the-wrong-element failure
  // block-editor.spec.ts's own comment names as this repository's eleventh
  // unfalsifiable assertion.
  test('the drag handle shows a move cursor, read off the handle itself', async ({ page }) => {
    const panel = await openDishesPanel(page);
    // Mutation: HANDLE_STYLE -> { cursor: 'pointer' } -- this reddens.
    await expect(panel.locator('[data-drag-handle="0"]')).toHaveCSS('cursor', 'move');
  });

  // Task 8's own deferred claim: SectionList's real drag path, over real
  // committed sections.json content (nine bespoke sections, hero included).
  // A MOVE again, not a swap: the last section sliding to the top pushes
  // every other row down by one rather than trading places with the first.
  test('dragging the last homepage section to the top slides the others', async ({ page }) => {
    const panel = await openSectionsPanel(page);
    const before = await sectionNames(panel);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const lastIndex = before.length - 1;

    await startDragging(page, panel.locator(`[data-drag-handle="${lastIndex}"]`));
    await dropOnto(page, panel.locator('[data-drag-handle="0"]'));

    const after = await sectionNames(panel);
    // Mutation: SectionList's onDrop calls a swap of the two endpoints
    // instead of moveTo -- only before[0] and before[lastIndex] would
    // change places, leaving everything between them untouched, which
    // differs from the full one-step slide asserted below.
    expect(after).toEqual([before[lastIndex], ...before.slice(0, lastIndex)]);
  });

  // D8: delete lives inside the editor, and Done is the everyday way out --
  // both have to be reachable with a thumb, not just present in the DOM.
  test('Done sits within thumb reach on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFirstDishEditor(page);
    const done = page.getByRole('button', { name: 'Done' });
    const box = (await done.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    // And it is the element the centre pixel resolves to, not something
    // painted over it -- e2e/dashboard-sections.spec.ts's own hitTestSelf
    // claim, restated for this surface.
    expect(await hitTestSelf(done)).toEqual({ self: true, hit: expect.any(String) });
  });
});

// DELIBERATELY ABSENT, and why: no "the publish bar does not cover the
// sheet" test and no "the publish confirmation opens over the editor"
// test. PublishBar's bar is in-flow, not fixed (PublishBar.tsx:925), so
// there is no overlap for either layout to produce, at any zIndex. The
// confirmation is portalled to document.body while EditorSheet lives inside
// ManageShell's own `relative z-10` stacking context (ManageShell.tsx:269),
// so ConfirmPanel wins by CONTAINMENT -- it is a descendant of nothing the
// sheet's stacking context can shadow -- whatever number OVERLAY_STYLE
// carries. Two zIndex mutation rows were considered for this file and
// dropped for the same reason Task 1's own report already gives: neither
// can be reddened by any real interaction, because there is nothing left
// for a wrong number to lose to. The same reasoning rules out a
// `preventDefault()` mutation on EditorSheet's Escape handler: a plain
// `<div>` has no default browser action tied to the Escape key for that
// call to suppress, so removing it changes nothing a browser -- or a
// mutation -- could observe. `onClose()` firing on Escape is what actually
// closes the sheet, and that half is already pinned in
// EditorSheet.test.tsx, in jsdom, where it belongs.
