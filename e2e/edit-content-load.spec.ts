// The fourth coupling leg of registering a content file, and the only one
// with no unit-test coverage at all: `e2e/edit-backend.ts` keeps its OWN copy
// of src/admin/content.ts's CONTENT_FILES and answers 404 for any name absent
// from it. EditMode's blanket load effect walks the real list, so a name
// missing from the fixture paints
//
//   Could not load <file> — ask your developer to check this file.
//
// as a bordered, padded `role="alert"` block ABOVE `<div class="min-h-screen">`
// -- i.e. above everything every /edit spec in this suite measures, shifting
// all of it down.
//
// Nothing caught that. Verified by running exactly the mutation (Phase 5B,
// Task 3, Step 8 #7 -- remove 'posts.json' from the fixture list): all 29
// cases in dashboard-sections.spec.ts stayed green, because /edit/manage's
// panels each fetch their own file and the blanket CONTENT_FILES effect is
// /edit's alone; and all 10 cases across the four specs that DO load /edit
// stayed green too, because each of them locates its subject and hit-tests it,
// which a uniform downward shift does not disturb. The banner was really
// there the whole time -- read off the page under that mutation, verbatim as
// quoted above.
//
// This is the third content file whose registration needed two hand-kept
// lists to agree (pages.json and experiences.json each carried the same risk
// -- see edit-backend.ts's own header), so the assertion is written over ANY
// file rather than named for posts.json: whoever registers the fourteenth is
// covered without editing this spec.
import { test, expect } from '@playwright/test';
import { mockEditBackend } from './edit-backend';

test.describe('/edit loads every registered content file', () => {
  test('no content file reports a load failure, for any name in CONTENT_FILES', async ({ page }) => {
    await mockEditBackend(page);
    await page.goto('/edit');

    // The page is up. `.first()` deliberately: /edit has exactly one h1 today
    // (Hero.tsx's lockup; Login.tsx's only renders logged out), but this spec's
    // subject is the load banner, and an unqualified locator would fail on a
    // strict-mode violation the day a second h1 lands -- red for a reason that
    // has nothing to do with content loading. Pinning "exactly one h1" is a
    // real assertion and it already has a home
    // (dashboard-sections.spec.ts:312, for the dashboard); it does not belong
    // in this file's settle step.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    // ...and every one of the blanket effect's fetches has settled, so a
    // banner cannot still be on its way. EditMode renders this while
    // `loadedOrErroredCount < CONTENT_FILES.length`, which is the same
    // condition the banner below is racing.
    await expect(page.getByText('Loading live content…')).toHaveCount(0);

    // Mutation this guards: remove any name from e2e/edit-backend.ts's
    // CONTENT_FILES -- confirmed red for 'posts.json', with the message
    // quoted in this file's header.
    await expect(page.getByRole('alert').filter({ hasText: /Could not load/ })).toHaveCount(0);
  });
});
