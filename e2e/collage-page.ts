// The collage's own page helpers, shared by the specs that drive it at
// `/edit`. Extracted for the reason `edit-backend.ts` was: the divider spec is
// the second file to need "open /edit, wait for the collage to stop moving,
// and find a point that really resolves to this box", and a second
// hand-written copy of that is a copy that drifts.
//
// Not a `.spec.ts`: playwright.config.ts's `testDir: './e2e'` reports a file
// with no `test()` in it as an empty suite.
import { expect, type Page } from '@playwright/test';
import { mockEditBackend } from './edit-backend';

// The collage's own container -- Hero.tsx's `absolute inset-0 flex`.
export const COLLAGE_CONTAINER = 'section .absolute.inset-0.flex';

export interface CollageBoxRect {
  id: string;
  src: string | null;
  // Relative to the collage container's own top-left, not the viewport: /edit
  // pushes the hero down the page by the height of the Publish bar, so
  // absolute coordinates cannot be compared with the public page's.
  x: number;
  y: number;
  width: number;
  height: number;
}

// Every photo box, in document order, with the photo currently inside it.
// Document order is POSITION -- what a swap must not change -- and `id`/`src`
// are the photo sitting there, which is what a swap moves.
//
// Found from each `<img>` outwards rather than by `[data-collage-photo-id]`,
// so the SAME function measures the public page too: that attribute only
// exists at /edit, and comparing the two pages' layouts is the whole point of
// the "the handles cost the layout nothing" test. `id` is an empty string
// where there is no editor, which is exactly what "no editor" should look
// like.
export async function collageBoxes(page: Page): Promise<CollageBoxRect[]> {
  return page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (!container) throw new Error('collage container not found');
    const origin = container.getBoundingClientRect();
    return [...container.querySelectorAll('img')].map((img) => {
      const el = img.closest('div');
      if (!el) throw new Error(`no box around ${img.getAttribute('src') ?? '?'}`);
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-collage-photo-id') ?? '',
        src: img.getAttribute('src'),
        x: Math.round(r.x - origin.x),
        y: Math.round(r.y - origin.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
  }, COLLAGE_CONTAINER);
}

// A viewport point that REALLY resolves to this photo's box -- asked of the
// browser rather than assumed from the rectangle.
//
// The obvious "use the centre of the box" is wrong here for two independent
// reasons this hero actually has: Hero.tsx's own content column is
// `relative z-10` and paints over the middle of the collage (the same
// stacking fact e2e/collage-hit-test.spec.ts exists for), and every box's
// bottom-right corner is EditableImage's camera badge, a <label> whose press
// must never start a drag. Scanning and checking what is under each candidate
// finds a point that is neither -- and, from Task 5, not a divider handle
// either.
export async function grabPoint(page: Page, photoId: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((id) => {
    const box = document.querySelector(`[data-collage-photo-id="${id}"]`);
    if (!box) return null;
    const r = box.getBoundingClientRect();
    for (let fy = 0.2; fy <= 0.8; fy += 0.15) {
      for (let fx = 0.2; fx <= 0.8; fx += 0.15) {
        const x = Math.round(r.x + r.width * fx);
        const y = Math.round(r.y + r.height * fy);
        if (x < 1 || y < 1 || x > window.innerWidth - 2 || y > window.innerHeight - 2) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        if (hit.closest('label, button, [data-collage-divider]')) continue;
        if (hit.closest('[data-collage-photo-id]')?.getAttribute('data-collage-photo-id') === id) return { x, y };
      }
    }
    return null;
  }, photoId);
  expect(point, `no point inside ${photoId} resolves to it -- it is covered by something`).not.toBeNull();
  return point as { x: number; y: number };
}

// Every collage image finished loading, no webfont still about to arrive, and
// no scroll still animating -- all three change layout after the fact. Every
// wait is BOUNDED: an unbounded wait on an image that fires neither load nor
// error hangs the whole spec until Playwright's own timeout, which is a worse
// failure than the flake it was added to fix.
export async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  await page.evaluate(async () => {
    const bounded = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
    await bounded(document.fonts.ready, 3000);
    const images = [...document.querySelectorAll('img')].filter((img) => !img.complete);
    await bounded(
      Promise.all(
        images.map(
          (img) =>
            new Promise((r) => {
              img.addEventListener('load', r, { once: true });
              img.addEventListener('error', r, { once: true });
            }),
        ),
      ),
      5000,
    );
  });
}

// Puts the hero's own top edge at the top of the viewport. The collage is
// `absolute inset-0` inside a `min-h-screen` section, and at /edit that
// section starts a few hundred pixels down the page (the Publish bar and the
// dashboard link sit above it), so part of the collage is below the fold until
// this runs -- and `document.elementFromPoint`, which every gesture here
// depends on, only ever hit-tests what is currently ON screen. Called after
// `settle`, which is what forces `scroll-behavior: auto`; without that the
// app's own smooth scrolling leaves this still animating while the first
// measurement is taken.
export async function focusCollage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const section = document.querySelector('section');
    if (!section) throw new Error('no hero section');
    window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY);
  });
}

// Waits until the collage's own rectangle stops moving.
//
// `settle` bounds every wait it makes, which means it can return while a late
// webfont or a lazily-decoded photo is still about to change the hero's height
// -- and this hero's height is content-driven (`min-h-screen` is a FLOOR). A
// point measured a frame before that lands somewhere else a frame after, which
// is exactly the shape of flake that teaches everyone to ignore a suite. Two
// agreeing measurements, not a fixed sleep: under four parallel workers the
// dev server is slow by an amount no constant is right for.
export async function waitForStableLayout(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (sel) => {
          const read = () => {
            const r = document.querySelector(sel)?.getBoundingClientRect();
            return r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}` : 'none';
          };
          const first = read();
          await new Promise((resolve) => setTimeout(resolve, 120));
          return first === read() ? first : 'moving';
        }, COLLAGE_CONTAINER),
      { timeout: 10_000 },
    )
    .not.toBe('moving');
}

export async function openCollage(page: Page, path: '/' | '/edit'): Promise<void> {
  if (path === '/edit') await mockEditBackend(page);
  await page.goto(path);
  await expect(page.locator(`${COLLAGE_CONTAINER} img`)).toHaveCount(16);
  await settle(page);
  await focusCollage(page);
  await waitForStableLayout(page);
}
