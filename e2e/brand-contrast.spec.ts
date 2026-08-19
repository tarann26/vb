import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { contrastRatio } from '../src/test/contrast';
import { ANALYTICS_DRAWN, openDashboard } from './edit-backend';

// One text node, already composited down to two opaque colours.
interface MeasuredText {
  text: string;
  bg: { r: number; g: number; b: number };
  fg: { r: number; g: number; b: number };
  where: string;
}

// Formats an already-composited, already-opaque {r,g,b} triple. Composited
// and hexified separately, not in one regex-into-hex step, because the
// compositing (below, inside the page.evaluate callback -- it needs
// getComputedStyle) is where a translucent colour's alpha actually gets
// resolved into a real rendered colour; by the time a triple reaches this
// function there is nothing left to drop.
function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// The sweep itself, over whatever page is already open. Extracted from the
// homepage test when the Numbers panel needed the same walk: every caption,
// axis label, stat label and range pill that landed on that panel is inside
// this test's scope, and a second copy of two hundred lines of compositing is
// how two sweeps come to disagree about what a background IS.
//
// Both directions, deliberately. An earlier version of this test only
  // looked at elements whose own background was brand blue, which made it
  // structurally incapable of catching the far more common failure: brand
  // blue as TEXT on a white background, at 1.45:1. That shipped the entire
  // navigation bar invisible and the test stayed green.
  //
  // Walking computed style rather than class names is the other half: a
  // Tailwind token, an arbitrary value, and an inline style are
  // indistinguishable here, so this cannot be fooled by spelling.
async function measureTextNodes(page: Page, root = ':root'): Promise<MeasuredText[]> {
  return page.evaluate((rootSelector) => {
    // Parses `rgb(r, g, b)` / `rgba(r, g, b, a)` -- alpha included. Every
    // caller below composites through this, rather than reading the three
    // colour channels and silently discarding the fourth: a translucent
    // layer (`bg-brand/50`, or a text colour under a Tailwind opacity
    // modifier like `text-ink/90`) is not the colour its own r/g/b says --
    // it is that colour blended with whatever paints behind it, and a
    // reader's eye only ever sees the blend.
    function parseRGBA(rgb: string): { r: number; g: number; b: number; a: number } | null {
      const m = rgb.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
      if (!m) return null;
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
    }
    // The Porter-Duff "over" operator: `top` painted onto an already-opaque
    // `bottom`, the same blend a browser performs when a translucent layer
    // sits above a solid one. Always returns something opaque, so repeated
    // calls (effectiveBg below, stacking several translucent ancestors) can
    // fold left without tracking a running alpha of their own.
    function over(
      top: { r: number; g: number; b: number; a: number },
      bottom: { r: number; g: number; b: number },
    ): { r: number; g: number; b: number } {
      return {
        r: top.r * top.a + bottom.r * (1 - top.a),
        g: top.g * top.a + bottom.g * (1 - top.a),
        b: top.b * top.a + bottom.b * (1 - top.a),
      };
    }
    // "Is anything painted here at all" -- alpha exactly 0 (or the literal
    // keyword `transparent`) is the only thing that disqualifies a layer
    // from being counted, because ANY paint, however faint, is still what a
    // viewer's eye actually sees composited with whatever is behind it. A
    // layer that IS translucent is not returned raw: the walk keeps going
    // past it, collecting every further painted ancestor up to the first
    // fully opaque one (or the page's own white backing, if none is found),
    // then composites the whole stack back-to-front -- so a `bg-brand/50`
    // panel over a cream section reports the actual blended colour, not
    // brand blue at full strength. Do not reuse this for "can this
    // element's own background stand in for what's behind its container"
    // -- that is a different, stricter question, answered by
    // isOpaqueBackground below.
    function effectiveBg(el: HTMLElement): { r: number; g: number; b: number } {
      const layers: { r: number; g: number; b: number; a: number }[] = [];
      let node: HTMLElement | null = el;
      while (node) {
        const parsed = parseRGBA(getComputedStyle(node).backgroundColor);
        if (parsed && parsed.a > 0) {
          layers.push(parsed);
          if (parsed.a === 1) break;
        }
        node = node.parentElement;
      }
      let result = { r: 255, g: 255, b: 255 };
      for (let i = layers.length - 1; i >= 0; i--) result = over(layers[i], result);
      return result;
    }
    // "Is this layer opaque enough that nothing behind it can bleed
    // through" -- the bar here is alpha === 1 exactly, not merely
    // alpha !== 0. A semi-transparent background-color (e.g. Tailwind's
    // `bg-brand/50`, `rgba(200, 216, 232, 0.5)`) fails effectiveBg's
    // "fully transparent" test above (alpha isn't 0, so the walk would
    // stop there and report it), but the colour actually rendered still
    // depends on whatever is painted behind it -- exactly the thing
    // sitsOverImageLayer exists to catch. Reusing effectiveBg's regex here
    // was the bug: it answered "not fully invisible" when the caller
    // needed "safe to measure on its own", so a 50%-alpha badge over a
    // photo would have been declared measurable and skipped past the
    // exclusion it should have triggered.
    function isOpaqueBackground(bg: string): boolean {
      const m = bg.match(/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+)\s*)?\)$/);
      if (!m) return false;
      const alpha = m[1] === undefined ? 1 : Number(m[1]);
      return alpha === 1;
    }
    // FoodGallery and Drinks caption cards: a photo (<img>) and a darkening
    // `bg-gradient-to-t from-black/NN` div are SIBLING layers absolutely
    // positioned under the caption text, not a CSS background on any
    // ancestor of the text. effectiveBg walks past both -- neither is a
    // `background-color` -- straight to the section's own flat background,
    // so the comparison would be against a colour the text is never
    // actually rendered on. This is the "text over a background image"
    // exclusion the task brief calls out: real contrast here depends on
    // pixels (the photo, the gradient) that getComputedStyle cannot report,
    // so it is out of reach for this test by construction, not by choice.
    // Detected structurally -- an <img> plus a background-image sibling
    // inside the nearest positioned ancestor -- rather than by naming the
    // two components, so it keeps matching if the pattern is reused
    // elsewhere.
    //
    // Review finding: this over-matched BlogTeaser's `bg-brand text-ink`
    // publication badge, which sits inside the same photo+gradient card
    // (src/components/BlogTeaser.tsx:45) but paints its OWN opaque
    // background-color. effectiveBg never reaches the photo for that badge
    // at all -- it stops at the badge's own background, exactly like any
    // other solid-background element -- so excluding it hid a real,
    // measurable contrast bug behind an exemption meant for text that has
    // no background of its own. Fixed by bailing out (not excluding)
    // wherever the element itself, or any ancestor strictly beneath the
    // image wrapper, paints an opaque background-color: that element is
    // measurable no matter what sits further back in the stack.
    function sitsOverImageLayer(start: HTMLElement): boolean {
      function paintsOpaqueBackground(node: HTMLElement): boolean {
        return isOpaqueBackground(getComputedStyle(node).backgroundColor);
      }
      if (paintsOpaqueBackground(start)) return false;
      let node: HTMLElement | null = start.parentElement;
      while (node) {
        if (paintsOpaqueBackground(node)) return false;
        if (getComputedStyle(node).position !== 'static') {
          const children = Array.from(node.children) as HTMLElement[];
          const hasPhoto = children.some((c) => c.tagName === 'IMG');
          const hasGradientLayer = children.some((c) => getComputedStyle(c).backgroundImage !== 'none');
          if (hasPhoto && hasGradientLayer) return true;
        }
        node = node.parentElement;
      }
      return false;
    }
    const out: {
      text: string;
      bg: { r: number; g: number; b: number };
      fg: { r: number; g: number; b: number };
      where: string;
    }[] = [];
    const scope = document.querySelector<HTMLElement>(rootSelector);
    if (!scope) throw new Error(`brand-contrast: nothing matches ${rootSelector}`);
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
      // Only elements holding their own text, so a wrapper is never blamed
      // for a child rendered on a different background.
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? '').trim())
        .join(' ')
        .trim();
      if (!ownText) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (Number(style.opacity) === 0) continue;
      // Intersected with the document's own rect, not just checked for
      // nonzero size -- the same fix hero-collage-after-farfalle.spec.ts
      // applied to its own container rect, with the whole page as the
      // container rather than one section: this test's job is "every text
      // node on the homepage", scroll position included, so the viewport
      // itself would be the wrong bound -- most of the page sits below the
      // fold at page-load scroll position, and clipping to the viewport
      // would silently stop checking it. `documentElement`'s rect instead
      // spans the full scrollable page, so this still requires BOTH
      // dimensions nonzero (the old check only gated on width, passing an
      // element collapsed to zero height) AND catches an element sized and
      // laid out but hidden by the classic `left: -9999px` off-page trick,
      // which sets neither visibility nor opacity and would otherwise sail
      // through every check above it.
      const rect = el.getBoundingClientRect();
      const docRect = document.documentElement.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(rect.right, docRect.right) - Math.max(rect.left, docRect.left));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, docRect.bottom) - Math.max(rect.top, docRect.top));
      if (visibleWidth === 0 || visibleHeight === 0) continue;
      if (sitsOverImageLayer(el)) continue;
      const bgColor = effectiveBg(el);
      // The text colour gets the same alpha treatment as the background:
      // `text-ink/90`-style opacity modifiers report as an rgba() with
      // alpha < 1, and what a reader sees is that colour blended with
      // whatever sits behind it -- which, for text, is exactly the bg this
      // element was just resolved against.
      const fgParsed = parseRGBA(style.color);
      if (!fgParsed) continue;
      const fgColor = fgParsed.a < 1 ? over(fgParsed, bgColor) : { r: fgParsed.r, g: fgParsed.g, b: fgParsed.b };
      out.push({
        text: ownText.slice(0, 40),
        bg: bgColor,
        fg: fgColor,
        where: el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 60),
      });
    }
    return out;
  }, root);
}

function unreadable(measured: MeasuredText[]): MeasuredText[] {
  return measured.filter((m) => contrastRatio(toHex(m.fg), toHex(m.bg)) < 4.5);
}

test('every text node on the homepage meets AA against what it sits on', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const measured = await measureTextNodes(page);

  // Non-vacuous: a render crash, a bad baseURL, or a selector regression
  // upstream would leave `measured` empty, and an empty array satisfies
  // `toEqual([])` just as well as a page with nothing unreadable on it. The
  // real homepage measures 62 text nodes; 50 is comfortably below that
  // while still requiring a real page to have rendered.
  expect(measured.length).toBeGreaterThan(50);

  expect(unreadable(measured)).toEqual([]);
});

// The dashboard's Numbers panel, which the homepage sweep above has never
// reached and cannot: /edit is behind a session and draws nothing without a
// mocked backend. Everything the trend chart, the bar lists, the stat cards,
// the campaign card, the busiest-times grid and the range pills put on screen
// is text on a surface, and the two colours in play are the ones this project
// keeps getting wrong -- brand blue, which is 1.45:1 on white and is a SURFACE
// only, and the grey captions, which are 4.60:1 on white.
//
// SCOPED TO THE PANEL, and the reason is a finding rather than a convenience.
// Run over the whole route, this sweep reports seven failures, none of them
// from any card measured here: the shell's own `text-gray-500` area
// descriptions sit on the cream sidebar rather than on white (4.42:1 and
// 4.06:1 on the current row's tint), and PublishBar's disabled Publish button
// is grey on grey. The second is exempt -- WCAG 1.4.3 excludes an inactive
// control -- and the first is backlog item 10's family, which the washes task
// owns and which is not this task's to move. Widening the root to ':root'
// here is how a later task re-opens the question with the same instrument.
test('every text node on the Numbers panel meets AA against what it sits on', async ({ page }) => {
  await openDashboard(page, '/edit/manage/numbers', { analytics: ANALYTICS_DRAWN });
  // ANSWERED, not merely mounted: every card shows its heading while the
  // request is still out, and a panel measured mid-flight is a panel whose
  // captions, axis labels and figures are not on screen yet.
  await expect(page.getByRole('img', { name: /Visits over the last/ })).toBeVisible();
  const measured = await measureTextNodes(page, '[data-area="numbers"]');

  // The same non-vacuity floor the homepage carries, at this screen's own
  // measured count: the panel measures 48 text nodes on this payload, and 40
  // is comfortably below that while still requiring a real, answered screen.
  // A payload that failed to render leaves seven headings and a loading line,
  // which is far below this.
  expect(measured.length).toBeGreaterThan(40);

  expect(unreadable(measured)).toEqual([]);
});
