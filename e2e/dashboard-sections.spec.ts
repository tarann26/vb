import { expect, test, type Page } from '@playwright/test';
import { mockEditBackend } from './edit-backend';

// "In /edit/manage every section renders fully expanded, so reaching the
// last one means scrolling past every dish, drink and article."
//
// That complaint is a statement about PAGE HEIGHT, and page height is
// precisely what jsdom cannot report -- it has no layout engine, so every
// element it renders measures zero and "this page is shorter now" is not a
// claim any vitest test in this repo can make. The unit tests
// (src/admin/__tests__/CollapsibleSection.test.tsx) pin the mechanism; this
// pins the outcome.

// The dashboard reaches the same GET /api/content routes /edit does, plus
// GET /api/wa as its session probe -- the shared mock answers all of them
// from the real committed files.
async function openDashboard(page: Page): Promise<void> {
  await mockEditBackend(page);
  await page.goto('/edit/manage');
  await expect(page.getByRole('heading', { name: 'Via Bianca Dashboard' })).toBeVisible();
  // Every section's own fetch has settled -- otherwise the height measured
  // below is of a page still filling in.
  await expect(page.getByRole('heading', { name: 'Page copy' })).toBeVisible();
  await expect(page.getByText(/^Loading /)).toHaveCount(0);
}

const SECTION_HEADINGS = [
  'Dishes',
  'Drinks',
  'Press',
  'Homepage sections',
  'Pages',
  'Opening hours',
  'Menus',
  'Galleries',
  'Our Story',
  'Page copy',
];

const VIEWPORTS = [
  { label: '390px (phone)', width: 390, height: 844 },
  { label: '1440px (desktop)', width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`the dashboard's folded sections at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('every section heading is reachable without scrolling past anyone else\'s content', async ({ page }) => {
      await openDashboard(page);

      // The measurement the complaint is actually about: how far down the
      // page the LAST section's heading sits. Before this change the answer
      // was "past every dish, drink and article"; the assertion below is
      // deliberately generous (three viewports, against a page that used to
      // run to many more) so it fails on a regression rather than on a
      // future section being added.
      const last = page.getByRole('heading', { name: 'Page copy' });
      const box = await last.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y, 'the last section heading is buried again').toBeLessThan(viewport.height * 3);

      // And all ten are genuinely on the page, in reach, not merely the
      // first few.
      for (const heading of SECTION_HEADINGS) {
        await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      }
    });

    test('opening one section reveals its content and leaves the others folded', async ({ page }) => {
      await openDashboard(page);

      const foldedHeight = await page.evaluate(() => document.body.scrollHeight);
      // Nothing inside any section is on screen while everything is folded.
      await expect(page.getByRole('button', { name: 'Add a dish' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Add an article' })).toHaveCount(0);

      await page.getByRole('button', { name: 'Dishes' }).click();

      await expect(page.getByRole('button', { name: 'Add a dish' })).toBeVisible();
      // Press stayed folded -- opening one section is not opening the page.
      await expect(page.getByRole('button', { name: 'Add an article' })).toHaveCount(0);

      const openHeight = await page.evaluate(() => document.body.scrollHeight);
      expect(openHeight, 'opening a section did not make the page any taller').toBeGreaterThan(foldedHeight);
    });

    // The whole point of remembering: she opens what she works on, and it
    // is still open next time. A real reload, not a remount -- localStorage
    // is the only thing carrying this across it.
    test('remembers what she left open across a reload', async ({ page }) => {
      await openDashboard(page);
      await page.getByRole('button', { name: 'Menus' }).click();
      await expect(page.getByRole('button', { name: 'Menus' })).toHaveAttribute('aria-expanded', 'true');

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Via Bianca Dashboard' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Menus' })).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button', { name: 'Dishes' })).toHaveAttribute('aria-expanded', 'false');
    });
  });
}
