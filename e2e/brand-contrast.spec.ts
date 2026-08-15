import { expect, test } from '@playwright/test';
import { contrastRatio } from '../src/test/contrast';

function toHex(rgb: string): string | null {
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}

// Walks up for the nearest ancestor that actually paints a background.
// An element with `background-color: rgba(0,0,0,0)` shows whatever is
// behind it, so comparing text against its OWN transparent background is
// how a contrast check passes while the text is invisible on screen.
//
// Declared here for readability and again inside `page.evaluate` below,
// deliberately: the evaluated function is serialised into the browser and
// cannot close over this one, so it carries its own copy. Never called
// from Node-side code, hence the disable below rather than deleting it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- module-scope copy kept for readability; the real, callable copy is the identical one inside page.evaluate
function effectiveBackground(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return bg;
    node = node.parentElement;
  }
  return 'rgb(255, 255, 255)';
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
    function effectiveBg(el: HTMLElement): string {
      let node: HTMLElement | null = el;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return bg;
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
    }
    // FoodGallery, Drinks and ItemListSection caption cards: a photo
    // (<img>) and a darkening `bg-gradient-to-t from-black/NN` div are
    // SIBLING layers absolutely positioned under the caption text, not a
    // CSS background on any ancestor of the text. effectiveBg walks past
    // both -- neither is a `background-color` -- straight to the section's
    // own flat background, so the comparison would be against a colour the
    // text is never actually rendered on. This is the "text over a
    // background image" exclusion the task brief calls out: real contrast
    // here depends on pixels (the photo, the gradient) that
    // getComputedStyle cannot report, so it is out of reach for this test
    // by construction, not by choice. Detected structurally -- an <img>
    // plus a background-image sibling inside the nearest positioned
    // ancestor -- rather than by naming the three components, so it keeps
    // matching if the pattern is reused elsewhere.
    function sitsOverImageLayer(start: HTMLElement): boolean {
      let node: HTMLElement | null = start.parentElement;
      while (node) {
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
