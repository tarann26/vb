import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockEditBackend } from './edit-backend';
import { AREAS, PANELS, areaPath } from '../src/admin/manage/areas';
import { AREA_SEEDED_KEY_PREFIX } from '../src/admin/open-sections';

// WHY THIS SPEC WAS REWRITTEN, recorded here rather than left to be
// reconstructed from a diff.
//
// Its original premise was a single measurement: "/edit/manage renders all
// ten sections fully expanded, so reaching the last one means scrolling past
// every dish, drink and article." It measured how far down the page the
// TENTH heading sat, against a page with ten headings on it.
//
// There is no longer a page with ten headings. The ten panels are grouped
// into five areas, each on its own URL, with at most three panels on screen
// at once -- so that measurement does not describe anything that exists, and
// a version of it kept alive against three headings would be a test that
// cannot fail.
//
// The guarantees it existed to hold are kept, restated PER AREA:
//   * every heading in an area is reachable without scrolling past anyone
//     else's content;
//   * opening one panel leaves the others folded;
//   * what she left open survives a reload.
//
// And the claims the new shell adds, none of which jsdom can make -- it has
// no layout engine, evaluates no media query, and cannot hit-test:
//   * the sidebar is genuinely visible at 1440 and genuinely ABSENT at 390,
//     and never existed in the DOM there even for a frame;
//   * all five home rows fit one 390x844 screen without scrolling, and each
//     row's own centre pixel resolves to itself;
//   * the bare-URL redirect is `replace`;
//   * `hidden` really hides, in a real browser, where a display-setting
//     utility on the same element would silently defeat the user-agent rule
//     that jsdom has no way to see.
//
// SECTION_HEADINGS is sourced from src/admin/manage/areas.ts rather than
// retyped, so a heading rename is a change to one constant.

// Measure and hit-test in ONE page evaluation so both read the same frame --
// e2e/collage-hit-test.spec.ts's own note on why splitting them made that
// spec flake applies here unchanged.
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

// The dashboard reaches the same GET /api/content routes /edit does, plus
// GET /api/wa as its session probe -- the shared mock answers all of them
// from the real committed files.
//
// The viewport is always set by `test.use` BEFORE this runs, and that
// ordering is required rather than tidy: the shell reads the width ONCE, in
// a lazy state initializer on its first render, so a viewport changed after
// `page.goto` would be read too late.
// "She has been here before." The shell opens the FIRST panel of each area
// once, the first time that area is seen on a device, and remembers that it
// did (open-sections.ts). Written before any of the app's own script runs,
// so the very first render already reads it.
//
// This distinction has to be made explicitly, because the two states answer
// different questions. On a FIRST visit the first panel is open, so the
// panels below it are pushed down by however much content it holds -- with
// fifteen real dishes, Drinks and Menus are genuinely two screens away, and
// that is the seed working as designed. The "reachable without scrolling
// past anyone else's content" guarantee is about the STEADY state: what she
// sees every time after the first, with the folds she chose. Measuring the
// steady state against the first visit's layout would be measuring the wrong
// screen.
async function asReturningVisitor(page: Page): Promise<void> {
  await page.addInitScript(
    ({ prefix, slugs }: { prefix: string; slugs: string[] }) => {
      slugs.forEach((slug) => window.localStorage.setItem(`${prefix}${slug}`, '1'));
    },
    { prefix: AREA_SEEDED_KEY_PREFIX, slugs: AREAS.map((area) => area.slug) },
  );
}

async function openDashboard(page: Page, path = '/edit/manage'): Promise<void> {
  await mockEditBackend(page);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Via Bianca Dashboard' })).toBeVisible();
  // Every area's own fetches have settled -- otherwise anything measured
  // below is measured against a page still filling in. All five areas load
  // at once (they are mounted from the first render and merely hidden), so
  // this covers the whole page, not just the visible area.
  await expect(page.getByText(/^Loading /)).toHaveCount(0);
}

const CONTENT_AREAS = AREAS.filter((area) => area.panelIds.length > 0);

const VIEWPORTS = [
  { label: '390px (phone)', width: 390, height: 844 },
  { label: '1440px (desktop)', width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`the dashboard's areas at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const area of CONTENT_AREAS) {
      test(`every heading in "${area.label}" is reachable without scrolling past anyone else's content`, async ({
        page,
      }) => {
        await asReturningVisitor(page);
        await openDashboard(page, areaPath(area.slug));

        for (const id of area.panelIds) {
          const heading = page.getByRole('heading', { name: PANELS[id].heading, exact: true });
          await expect(heading).toBeVisible();
          const box = await heading.boundingBox();
          expect(box).not.toBeNull();
          // Deliberately generous -- two viewports against an area of at
          // most three panels -- so this fails on a regression rather than
          // on a future panel being added.
          expect(box!.y, `"${PANELS[id].heading}" is buried`).toBeLessThan(viewport.height * 2);
        }

        // And the other areas' panels are genuinely not on this screen.
        for (const other of CONTENT_AREAS) {
          if (other.slug === area.slug) continue;
          for (const id of other.panelIds) {
            await expect(page.getByRole('heading', { name: PANELS[id].heading, exact: true })).toHaveCount(0);
          }
        }
      });
    }

    test('opening one panel reveals its content and leaves the others folded', async ({ page }) => {
      await openDashboard(page, '/edit/manage/menu');

      // On a first-ever visit the shell opens the FIRST panel of the area
      // once, so Dishes is open and the other two are not. Both halves
      // matter: without the first, the area is another list of headings;
      // without the second, folding has stopped working.
      await expect(page.getByRole('button', { name: 'Dishes' })).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button', { name: 'Add a dish' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Drinks' })).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('button', { name: 'Add a drink' })).toHaveCount(0);

      const foldedHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.getByRole('button', { name: 'Drinks' }).click();

      await expect(page.getByRole('button', { name: 'Add a drink' })).toBeVisible();
      // Menus stayed folded -- opening one panel is not opening the area.
      await expect(page.getByRole('button', { name: 'Menus' })).toHaveAttribute('aria-expanded', 'false');
      const openHeight = await page.evaluate(() => document.body.scrollHeight);
      expect(openHeight, 'opening a panel did not make the page any taller').toBeGreaterThan(foldedHeight);
    });

    // The whole point of remembering: she opens what she works on, and it is
    // still open next time. A real reload, not a remount -- localStorage is
    // the only thing carrying this across it.
    test('remembers what she left open across a reload', async ({ page }) => {
      await asReturningVisitor(page);
      await openDashboard(page, '/edit/manage/menu');
      await page.getByRole('button', { name: 'Menus' }).click();
      await expect(page.getByRole('button', { name: 'Menus' })).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button', { name: 'Dishes' })).toHaveAttribute('aria-expanded', 'false');

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Via Bianca Dashboard' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Menus' })).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button', { name: 'Dishes' })).toHaveAttribute('aria-expanded', 'false');
    });
  });
}

// ---------------------------------------------------------------------------
// The status strip's own layout claims. What it SAYS is pinned in
// src/admin/manage/__tests__/StatusStrip.test.tsx; what a browser does with
// it is only checkable here.
for (const viewport of VIEWPORTS) {
  test.describe(`the status strip at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('is on screen and nothing is painted over it', async ({ page }) => {
      await openDashboard(page, '/edit/manage/menu');

      const strip = page.getByLabel('Site status');
      await expect(strip).toBeVisible();
      // This repo has already shipped an admin control painted underneath a
      // fixed, high-stacking-order bar once (see
      // e2e/edit-dashboard-link.spec.ts's own comment), which is why the
      // centre pixel is hit-tested rather than the box merely measured.
      expect(await hitTestSelf(strip)).toEqual({ self: true, hit: expect.any(String) });

      // Reading the real fixture rather than "Couldn't check when the site
      // last updated" is what proves the /build-info.json route in
      // e2e/edit-backend.ts is actually reached.
      await expect(strip.getByText(/^Last published /)).toBeVisible();
      await expect(strip.getByText('Nothing waiting to be published')).toBeVisible();
    });
  });
}

// ---------------------------------------------------------------------------
test.describe('the laptop shell at 1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the sidebar is on screen, shows all five areas, and marks exactly one current', async ({ page }) => {
    await openDashboard(page, '/edit/manage/menu');

    const sidebar = page.locator('nav[data-variant="sidebar"]');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole('link')).toHaveCount(AREAS.length);
    await expect(page.locator('[aria-current="page"]')).toHaveCount(1);

    // Every one of the five is one click away, and each one's own centre
    // pixel resolves to itself -- a sidebar painted under something is a
    // failure this repo has already shipped once on this surface.
    for (const area of AREAS) {
      const link = sidebar.getByRole('link', { name: new RegExp(`^${area.label}`) });
      await expect(link).toBeVisible();
      expect(await hitTestSelf(link)).toEqual({ self: true, hit: expect.any(String) });
    }

    await sidebar.getByRole('link', { name: /^Hours & Wording/ }).click();
    await expect(page).toHaveURL(/\/edit\/manage\/details$/);
    await expect(page.getByRole('heading', { name: 'Opening hours', exact: true })).toBeVisible();
  });

  // jsdom cannot catch a display-setting utility overriding the user-agent
  // rule for the `hidden` attribute, because it loads no CSS at all. This
  // is the half of that claim only a real browser can make.
  test('a hidden area really is hidden, not merely out of the accessibility tree', async ({ page }) => {
    await openDashboard(page, '/edit/manage/pages');

    await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible();
    // Mounted -- so nothing re-fetches and no unpublished edit is lost --
    // but painted nowhere. `toBeHidden` reads the computed style, so a
    // display-setting utility on the element carrying the attribute would
    // make this go red while every jsdom assertion stayed green. That is
    // the whole reason this case exists in a real browser.
    await expect(page.locator('#section-panel-dishes')).toHaveCount(1);
    await expect(page.locator('[data-area="menu"]')).toBeHidden();
    await expect(page.locator('[data-area="pages"]')).toBeVisible();
  });

  test('the bare-URL redirect replaces rather than stacks, so Back reaches /edit', async ({ page }) => {
    await mockEditBackend(page);
    await page.goto('/edit');
    await page.locator('a[href="/edit/manage"]').click();

    await expect(page).toHaveURL(/\/edit\/manage\/menu$/);
    await page.goBack();
    // Not back onto the redirect, which is what a non-replacing <Navigate>
    // would give her -- an infinite bounce she cannot escape with Back.
    await expect(page).toHaveURL(/\/edit$/);
  });
});

// ---------------------------------------------------------------------------
test.describe('the phone shell at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('all five home rows fit one screen, and each row\'s centre pixel resolves to itself', async ({ page }) => {
    await openDashboard(page, '/edit/manage');

    const rows = page.locator('nav[data-variant="list"]').getByRole('link');
    await expect(rows).toHaveCount(AREAS.length);

    for (let i = 0; i < AREAS.length; i += 1) {
      const row = rows.nth(i);
      const box = await row.boundingBox();
      expect(box).not.toBeNull();
      // On screen WITHOUT scrolling: the bottom edge of the last row is
      // still above the fold. The header budget (lockup at most two lines,
      // the publish bar its existing single row) is what makes this
      // achievable by design rather than by luck.
      expect(box!.y + box!.height, `row ${i + 1} ("${AREAS[i].label}") is below the fold`).toBeLessThanOrEqual(844);
      expect(await hitTestSelf(row)).toEqual({ self: true, hit: expect.any(String) });
    }
  });

  test('the sidebar element never exists in the DOM, not even for a frame', async ({ page }) => {
    // A MutationObserver installed before any of the app's own script runs.
    // Asserting the sidebar is merely ABSENT after the page settles would
    // pass for a layout that flashed the laptop shell and then corrected
    // itself, which is the failure this rules out.
    await page.addInitScript(() => {
      (window as unknown as { __sidebarEverSeen: boolean }).__sidebarEverSeen = false;
      const mark = (node: Node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('[data-variant="sidebar"]') || node.querySelector('[data-variant="sidebar"]')) {
          (window as unknown as { __sidebarEverSeen: boolean }).__sidebarEverSeen = true;
        }
      };
      new MutationObserver((records) => {
        records.forEach((record) => record.addedNodes.forEach(mark));
      }).observe(document.documentElement, { childList: true, subtree: true });
    });

    await openDashboard(page, '/edit/manage/menu');
    await expect(page.getByRole('heading', { name: 'Dishes', exact: true })).toBeVisible();

    expect(await page.evaluate(() => (window as unknown as { __sidebarEverSeen: boolean }).__sidebarEverSeen)).toBe(
      false,
    );
    await expect(page.locator('nav[data-variant="sidebar"]')).toHaveCount(0);
  });

  test('two taps from /edit reach a real editing screen, and the back control returns home', async ({ page }) => {
    await mockEditBackend(page);
    await page.goto('/edit');

    // Tap one.
    await page.locator('a[href="/edit/manage"]').click();
    await expect(page.getByRole('heading', { name: /What would you like to change/ })).toBeVisible();

    // Tap two.
    await page.locator('nav[data-variant="list"]').getByRole('link', { name: /^Menu/ }).click();
    await expect(page).toHaveURL(/\/edit\/manage\/menu$/);
    await expect(page.getByRole('button', { name: 'Add a dish' })).toBeVisible();

    // And back out again, through a real link rather than history.back().
    await page.getByRole('link', { name: /All areas/ }).click();
    await expect(page).toHaveURL(/\/edit\/manage$/);
    await expect(page.getByRole('heading', { name: /What would you like to change/ })).toBeVisible();
  });
});
