import { test, expect } from '@playwright/test';
import { contrastRatio } from '../src/test/contrast';

// Phase 4. The byline's claims that jsdom structurally cannot make:
// size, shape, colour, occlusion and contrast.
//
// Written AFTER looking at the rendered page at both widths, deliberately.
// This project has shipped an e2e spec that measured real geometry and
// encoded broken output as the expected baseline -- it reddened under every
// mutation while pinning the wrong thing. The numbers below are floors and
// ratios, not transcriptions of whatever the page happened to render.
//
// What was actually seen (Playwright, localhost:8080, before a single
// expectation below was written): at 1280x800 the portrait is a 96x96
// circle, in colour, cropped (not stretched) from a 932x1243 source, with
// "Kamalika Anand" / "CHEF AND OWNER" beside it on one line each, below the
// last paragraph's border-top divider. At 390x844 the same block reflows to
// 358px wide, the two lines of text still fit beside the portrait without
// wrapping, and the whole byline (y ~995) sits above the carousel
// (y ~1172), both below the prose. No defect requiring a component change
// was observed.

const ABOUT = '#our-story';

test.describe('the About byline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator(ABOUT).scrollIntoViewIfNeeded();
  });

  test('the portrait is a real, visible circle at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const portrait = page.getByTestId('chef-portrait');
    await portrait.scrollIntoViewIfNeeded();
    await expect(portrait).toBeVisible();

    const box = await portrait.boundingBox();
    expect(box).not.toBeNull();
    // h-24 w-24 -- a square box, 96 CSS px. Asserted as a square with a
    // floor rather than as an exact pair, so a future size change fails on
    // "too small" or "no longer square" rather than on an incidental
    // repaint.
    expect(box!.width).toBeGreaterThanOrEqual(90);
    expect(box!.height).toBeGreaterThanOrEqual(90);
    expect(Math.abs(box!.width - box!.height)).toBeLessThanOrEqual(1);

    // rounded-full on a square box is a circle. Read off the IMG itself --
    // border-radius is not inherited, and this project has already shipped
    // a filter assertion that read the wrong element and passed on the
    // defect for four assertions running.
    const radius = await portrait.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(radius)).toBeGreaterThanOrEqual(box!.width / 2 - 1);

    // In colour, and read off the IMG, for the same reason.
    expect(await portrait.evaluate((el) => getComputedStyle(el).filter)).toBe('none');

    // Not distorted: the source is 932x1243 portrait and object-cover on a
    // square box must crop, never squash.
    expect(await portrait.evaluate((el) => getComputedStyle(el).objectFit)).toBe('cover');
  });

  test('the portrait is genuinely on top, not covered by the section behind it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const portrait = page.getByTestId('chef-portrait');
    await portrait.scrollIntoViewIfNeeded();
    const box = (await portrait.boundingBox())!;
    // Sampled at the centre, which is inside the circle at any radius.
    const hit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el === null ? null : el.getAttribute('data-testid');
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(hit).toBe('chef-portrait');
  });

  test('the name and role sit beside the portrait and stay on one line each at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const byline = page.getByTestId('chef-byline');
    await byline.scrollIntoViewIfNeeded();
    const portraitBox = (await page.getByTestId('chef-portrait').boundingBox())!;
    const nameBox = (await byline.locator('p').first().boundingBox())!;

    // Beside, not below: the text starts to the RIGHT of the portrait's
    // right edge. This is the claim that would break if a responsive
    // variant were added, or if the flex row wrapped on a phone.
    expect(nameBox.x).toBeGreaterThan(portraitBox.x + portraitBox.width - 1);

    // One line each. A 96px avatar plus a name that wraps to three lines is
    // the failure this measures; line-height at text-lg is ~28px, so a
    // second line would push this past 40.
    expect(nameBox.height).toBeLessThan(40);

    // And nothing overflows the viewport.
    const bylineBox = (await byline.boundingBox())!;
    expect(bylineBox.x).toBeGreaterThanOrEqual(0);
    expect(bylineBox.x + bylineBox.width).toBeLessThanOrEqual(390);
  });

  test('the role line is readable against what is actually behind it', async ({ page }) => {
    // The role sits on bg-cream-alt (#F9F9F9) in text-accent (#9D4949).
    // Measured, not asserted from the palette: the whole point of
    // e2e/brand-contrast.spec.ts is that this project once shipped a blue
    // button with white text at 1.45:1.
    //
    // Method: getComputedStyle only -- never a screenshot/pixel sample.
    // This project has an earlier contrast finding that turned out to be an
    // artefact of pixel sampling: it sampled a text element's own region
    // *with the glyphs still painted in it* and called that the
    // background, then compared it against an assumed pure colour for the
    // foreground rather than the (possibly semi-transparent) colour
    // actually rendered -- both terms were wrong at once. getComputedStyle
    // sidesteps both mistakes by construction: `color` and
    // `backgroundColor` are the literal values the browser paints with,
    // never a blend of neighbouring glyph pixels, so there is no
    // glyph-contaminated region to accidentally sample in the first place.
    // Both channels are still alpha-composited below the same way this
    // project's own e2e/brand-contrast.spec.ts composites them, so a future
    // opacity modifier on the text or an ancestor background (e.g.
    // `text-accent/80`) is measured as what a reader's eye actually sees,
    // not as a bare, un-composited channel value.
    const role = page.getByTestId('chef-byline').locator('p').nth(1);
    await role.scrollIntoViewIfNeeded();
    await expect(role).toBeVisible();
    const { color, background } = await role.evaluate((el) => {
      function parseRGBA(rgb: string): { r: number; g: number; b: number; a: number } | null {
        const m = rgb.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
        if (!m) return null;
        return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
      }
      function over(top: { r: number; g: number; b: number; a: number }, bottom: { r: number; g: number; b: number }) {
        return {
          r: top.r * top.a + bottom.r * (1 - top.a),
          g: top.g * top.a + bottom.g * (1 - top.a),
          b: top.b * top.a + bottom.b * (1 - top.a),
        };
      }
      // Walk up for the nearest actually-painted background(s), compositing
      // onto an opaque white backing -- the same walk e2e/brand-contrast
      // .spec.ts's effectiveBg performs.
      let node: HTMLElement | null = el as HTMLElement;
      const bgLayers: { r: number; g: number; b: number; a: number }[] = [];
      while (node) {
        const parsed = parseRGBA(getComputedStyle(node).backgroundColor);
        if (parsed && parsed.a > 0) {
          bgLayers.push(parsed);
          if (parsed.a === 1) break;
        }
        node = node.parentElement;
      }
      let background = { r: 255, g: 255, b: 255 };
      for (let i = bgLayers.length - 1; i >= 0; i--) background = over(bgLayers[i], background);

      const fgParsed = parseRGBA(getComputedStyle(el).color)!;
      const color = fgParsed.a < 1 ? over(fgParsed, background) : { r: fgParsed.r, g: fgParsed.g, b: fgParsed.b };

      const toRgbString = (c: { r: number; g: number; b: number }): string =>
        `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
      return { color: toRgbString(color), background: toRgbString(background) };
    });

    function toHex(rgb: string): string {
      const m = rgb.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) throw new Error(`not an rgb() colour: ${rgb}`);
      return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
    }

    // A real ratio computed from the two colours actually painted, rather
    // than two pinned literals -- reusing the project's own contrastRatio
    // helper (src/test/contrast.ts) instead of a second implementation.
    expect(contrastRatio(toHex(color), toHex(background))).toBeGreaterThanOrEqual(4.5);
  });
});
