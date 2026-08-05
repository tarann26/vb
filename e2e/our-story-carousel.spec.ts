import { expect, test, type Page } from '@playwright/test';
import { mockEditBackend, realContentJson } from './edit-backend';

// "Our Story's photos are invisible at /edit."
//
// The mechanism, and why no vitest test in this repo could ever have caught
// it: OurStory.tsx renders a flex track whose slides are sized entirely by
// classes on the <img> (`w-full flex-shrink-0 h-[400px]`). At `/` those
// classes land on a bare <img>, because with no provider mounted
// `content.renderImage` is the identity (src/content/ContentContext.ts), and
// the flex container lays out that image directly. At `/edit` the provider
// returns an EditableImage instead, which wraps the same <img> in a <span>
// -- so the box the flex container actually lays out is the SPAN, which had
// no width of its own and collapsed to zero. Six slides at zero width, a
// track with nothing in it, and a `translateX(-N * 100%)` sliding across
// blank space. jsdom reports a zero box for every element ever rendered, so
// "this element has no width" is not a statement it can make; only a real
// engine can.
//
// The repair is in EditableImage.tsx (`wrapperClassName`): the wrapper
// copies the image's own layout-affecting classes, so the flex container
// sizes the wrapper exactly as it would have sized the image. This spec is
// what proves that against real layout, and it is red against the component
// as it was -- see this task's own report for the transcript.

// Read from the same committed file the page itself renders, never
// hardcoded: this content is hers to change from the dashboard, and a spec
// that pinned "six" would fail the day she adds a seventh photo for a
// reason that has nothing to do with layout.
const OUR_STORY_COUNT: number = (JSON.parse(realContentJson('galleries.json')) as { ourStory: unknown[] }).ourStory.length;

// Every slide's own geometry, plus the clipping box the track slides
// inside, measured in one page evaluation so all of it describes the same
// frame. `data-editable-image-path` is EditableImage's own marker (the same
// one EditMode.tsx's click guard keys its carve-out on), so these are
// exactly the wrappers the flex container lays out -- not the images
// nested inside them, which is the whole distinction this spec exists for.
async function measureSlides(page: Page) {
  return page.evaluate(() => {
    const slides = [...document.querySelectorAll<HTMLElement>('[data-editable-image-path^="galleries.ourStory."]')];
    // The clipping box is the track's own parent -- OurStory.tsx's
    // `relative overflow-hidden rounded-2xl shadow-2xl h-[400px]` div. Read
    // off the DOM rather than named by class, so a restyle of that div does
    // not silently repoint this spec at the wrong element.
    const track = slides[0]?.parentElement ?? null;
    const clip = track?.parentElement ?? null;
    const clipRect = clip?.getBoundingClientRect() ?? null;
    return {
      clip: clipRect ? { x: clipRect.x, y: clipRect.y, width: clipRect.width, height: clipRect.height } : null,
      slides: slides.map((slide) => {
        const rect = slide.getBoundingClientRect();
        const badge = slide.querySelector<HTMLElement>('label[aria-label]');
        const badgeRect = badge?.getBoundingClientRect() ?? null;
        return {
          width: rect.width,
          height: rect.height,
          x: rect.x,
          y: rect.y,
          src: slide.querySelector('img')?.getAttribute('src') ?? null,
          // The camera badge's own centre, expressed relative to THIS
          // slide -- see the badge test below for what that catches.
          badgeCentre: badgeRect ? { x: badgeRect.x + badgeRect.width / 2, y: badgeRect.y + badgeRect.height / 2 } : null,
        };
      }),
    };
  });
}

// Which photo is actually on screen right now: the element painted at the
// centre of the clipping box. The two decorative overlays OurStory.tsx
// stacks on top of the carousel are both `pointer-events-none`, which
// `elementFromPoint` honours, so this resolves past them to the photo
// itself -- and resolves to something that is NOT an <img> whenever the
// track is empty, which is precisely the broken state.
async function photoOnScreen(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const slide = document.querySelector<HTMLElement>('[data-editable-image-path^="galleries.ourStory."]');
    const clip = slide?.parentElement?.parentElement ?? null;
    if (!clip) return null;
    const rect = clip.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit instanceof HTMLImageElement ? hit.getAttribute('src') : null;
  });
}

const VIEWPORTS = [
  { label: '390px (phone)', width: 390, height: 844 },
  { label: '1440px (desktop)', width: 1440, height: 900 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`Our Story at /edit, ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('every photo is a full-size slide, one is on screen, and the carousel advances', async ({ page }) => {
      await mockEditBackend(page);
      await page.goto('/edit');

      const slides = page.locator('[data-editable-image-path^="galleries.ourStory."]');
      // Non-vacuous: the real gallery, at its real length. A zero here would
      // make every measurement below pass by having nothing to measure.
      await expect(slides).toHaveCount(OUR_STORY_COUNT);
      expect(OUR_STORY_COUNT).toBeGreaterThan(1);
      await slides.first().scrollIntoViewIfNeeded();

      const { clip, slides: measured } = await measureSlides(page);
      expect(clip).not.toBeNull();
      expect(clip!.width).toBeGreaterThan(100);

      // The defect, stated as a number. Before the repair every one of these
      // measured 0 wide; a correct slide is the full width of the clipping
      // box, because that is what `w-full` on a flex item of that track
      // resolves to. Compared against the clip rather than an absolute
      // pixel count so this holds at both viewports and after any restyle
      // of the column it sits in.
      measured.forEach((slide, index) => {
        expect(slide.width, `slide ${index} collapsed to ${slide.width}px wide`).toBeGreaterThan(clip!.width * 0.95);
        // `h-[400px]`, the other half of the sizing the call site puts on
        // the image -- a wrapper that took the width but not the height
        // would still crop every photo to nothing.
        expect(slide.height, `slide ${index} is ${slide.height}px tall`).toBeGreaterThan(300);
      });

      // Laid out as a real track: each slide sits one clip-width to the
      // right of the one before it. A wrapper that collapsed would stack
      // them all at the same x, which is how the original bug produced a
      // "carousel" that slid across blank space.
      measured.slice(1).forEach((slide, index) => {
        expect(slide.x - measured[index].x, `slides ${index} and ${index + 1} overlap`).toBeGreaterThan(clip!.width * 0.95);
      });

      // A photo -- a real <img>, not the empty div the collapsed track left
      // behind -- is painted at the centre of the clipping box, and it is
      // one of Our Story's own.
      const first = await photoOnScreen(page);
      expect(first, 'no photo is painted at the centre of the carousel').not.toBeNull();
      expect(measured.map((slide) => slide.src)).toContain(first);

      // ...and it changes on its own. OurStory.tsx advances every 3200ms
      // unless the browser reports a reduced-motion preference, which
      // Playwright's default profile does not.
      await expect
        .poll(() => photoOnScreen(page), {
          message: 'the carousel never advanced to a different photo',
          timeout: 12_000,
        })
        .not.toBe(first);
    });

    // The camera badge, which is the other thing the repair had to keep
    // true. This is what rules out the rejected alternative of making the
    // wrapper generate no box at all: without a box it cannot be a
    // containing block, so every one of these badges would position itself
    // against the single carousel viewport instead and they would all pile
    // into one corner -- five of the six landing outside their own slide.
    test('each photo carries its own camera badge, inside its own slide', async ({ page }) => {
      await mockEditBackend(page);
      await page.goto('/edit');
      const slides = page.locator('[data-editable-image-path^="galleries.ourStory."]');
      await expect(slides).toHaveCount(OUR_STORY_COUNT);
      await slides.first().scrollIntoViewIfNeeded();

      const { slides: measured } = await measureSlides(page);
      measured.forEach((slide, index) => {
        expect(slide.badgeCentre, `slide ${index} has no camera badge at all`).not.toBeNull();
        const { x, y } = slide.badgeCentre!;
        expect(x, `slide ${index}'s badge sits outside it horizontally`).toBeGreaterThanOrEqual(slide.x);
        expect(x).toBeLessThanOrEqual(slide.x + slide.width);
        expect(y, `slide ${index}'s badge sits outside it vertically`).toBeGreaterThanOrEqual(slide.y);
        expect(y).toBeLessThanOrEqual(slide.y + slide.height);
      });
    });
  });
}
