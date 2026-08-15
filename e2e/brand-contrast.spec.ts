import { expect, test } from '@playwright/test';
import { contrastRatio } from '../src/test/contrast';

function toHex(rgb: string): string | null {
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}

test('every text node on the homepage meets AA against what it sits on', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Both directions, deliberately. An earlier version of this test only
  // looked at elements whose own background was brand blue, which made it
  // structurally incapable of catching the far more common failure: brand
  // blue as TEXT on a white background, at 1.45:1. That shipped the entire
  // navigation bar invisible and the test stayed green.
  //
  // Walking computed style rather than class names is the other half: a
  // Tailwind token, an arbitrary value, and an inline style are
  // indistinguishable here, so this cannot be fooled by spelling.
  const measured = await page.evaluate(() => {
    // "Is anything painted here at all" -- alpha exactly 0 (or the literal
    // keyword `transparent`) is the only thing that disqualifies a layer
    // from being the thing effectiveBg reports, because ANY paint, however
    // faint, is still what a viewer's eye actually sees composited with
    // whatever is behind it. Do not reuse this for "can this element's own
    // background stand in for what's behind its container" -- that is a
    // different, stricter question, answered by isOpaqueBackground below.
    function effectiveBg(el: HTMLElement): string {
      let node: HTMLElement | null = el;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return bg;
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
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
    const out: { text: string; bg: string; fg: string; where: string }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
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
      if (el.getBoundingClientRect().width === 0) continue;
      if (sitsOverImageLayer(el)) continue;
      out.push({
        text: ownText.slice(0, 40),
        bg: effectiveBg(el),
        fg: style.color,
        where: el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 60),
      });
    }
    return out;
  });

  const unreadable = measured.filter((m) => {
    const fg = toHex(m.fg);
    const bg = toHex(m.bg);
    return fg !== null && bg !== null && contrastRatio(fg, bg) < 4.5;
  });

  expect(unreadable).toEqual([]);
});
