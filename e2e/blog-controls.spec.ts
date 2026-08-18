import { expect, test } from '@playwright/test';

// Task 32. The three /blog control rows Task 30 shipped, in a real browser at
// the two widths that matter. Everything here is either geometry or computed
// style: jsdom has neither, so every claim below is browser-only by
// construction, and the eight claims Task 30 explicitly deferred to this task
// are each covered by a named test (see the map at the foot of this file).
//
// Runs against the committed posts.json -- three Mention posts. That is why
// "Recipe" here is the empty-result case and "In the press" is the
// everything case, and it is deliberate: a fourth post of a different kind
// changes what this spec sees, which is the signal we want.
//
// NOT ONE ASSERTION IS POINTED AT A CLASS NAME. e2e/block-editor.spec.ts:19-23
// (restated by Task 28 Step 3) records why: the dev server's Tailwind JIT never
// removes a rule inside a session, so a class-name assertion can be green
// against a stylesheet that a cold build would not produce. Computed style and
// bounding boxes do not have that failure mode.

const WIDTHS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

// The ink and brand pair e2e/blog.spec.ts already pins on the card badge.
const INK = 'rgb(34, 34, 34)';
const BRAND = 'rgb(200, 216, 232)';

// index.css's `button:focus-visible, a:focus-visible` ring: 2px solid #9D4949,
// the accent, chosen there because the brand blue is 1.45:1 on white and fails
// WCAG 1.4.11's 3:1 bar for a non-text indicator outright.
const FOCUS_RING = 'rgb(157, 73, 73)';

// Tailwind preflight's `::placeholder` colour (gray-400, #9CA3AF). Pinned as a
// value rather than trusted, because it is a UA/base-layer colour that no
// component in this repo sets and jsdom cannot read at all. See the placeholder
// test for what it measures to and why that is a reported finding.
const PLACEHOLDER = 'rgb(156, 163, 175)';

// `max-w-2xl` on the search field. 42rem at the 16px root this site uses.
const SEARCH_CAP = 672;

// The six controls, in DOM order. Named once so the geometry tests below cannot
// drift apart on which controls they mean.
const CONTROLS = ['All', 'Recipe', 'Story', 'In the press', 'Newest first', 'Oldest first'] as const;

type Box = { x: number; y: number; width: number; height: number };

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: string): number {
  const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!m) throw new Error(`not an opaque rgb() colour: ${rgb}`);
  return 0.2126 * channel(Number(m[1])) + 0.7152 * channel(Number(m[2])) + 0.0722 * channel(Number(m[3]));
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function boxes(page: import('@playwright/test').Page, names: readonly string[]): Promise<Box[]> {
  const out: Box[] = [];
  for (const name of names) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box, `${name} has no box`).not.toBeNull();
    out.push(box!);
  }
  return out;
}

// Measured, not assumed: the four kind pills total 333.7px of content-box width
// plus gaps in the FALLBACK font and 365.3px once Montserrat swaps in, against
// a 358px column at 390px. So whether they wrap is decided by a webfont that
// arrives over the network with `display=swap` (index.html:56) -- a 7px margin
// either side of the wrap. Any test that reads a pill's WIDTH has to wait for
// the swap or it is measuring a different page. Weight 400, not 500: the
// buttons set a family and a size and inherit the body weight, and only the
// weights actually used are ever fetched.
async function fontsSettled(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.fonts.ready.then(() => document.fonts.check('400 14px Montserrat'))), {
      message: 'Montserrat 400 never loaded -- every width below would be a fallback-font measurement',
    })
    .toBe(true);
}

for (const size of WIDTHS) {
  test.describe(`${size.name} (${size.width}px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('the kind filters narrow the list, and All brings it back', async ({ page }) => {
      await page.goto('/blog');
      await expect(page.locator('article')).toHaveCount(3);
      await page.getByRole('button', { name: 'Recipe' }).click();
      await expect(page.locator('article')).toHaveCount(0);
      await expect(page.getByText(/No stories match that/)).toBeVisible();
      await page.getByRole('button', { name: 'In the press' }).click();
      await expect(page.locator('article')).toHaveCount(3);
      await page.getByRole('button', { name: 'All' }).click();
      await expect(page.locator('article')).toHaveCount(3);
    });

    test('search reaches a word that is only in an excerpt', async ({ page }) => {
      await page.goto('/blog');
      await page.getByRole('searchbox', { name: 'Search stories' }).fill('puglian');
      await expect(page.locator('article')).toHaveCount(1);
    });

    test('oldest first turns the real list round', async ({ page }) => {
      await page.goto('/blog');
      // The two ends of the committed three, by date: 2024-12-15 and
      // 2024-12-05. Asserting the FIRST card's title in both directions is
      // what makes this a claim about order rather than about membership --
      // the set of three cards is identical either way round.
      const first = page.locator('article h3').first();
      await expect(first).toHaveText(/Regional Italian Flair/);
      await page.getByRole('button', { name: 'Oldest first' }).click();
      await expect(first).toHaveText(/Cordon Bleu/);
      await page.getByRole('button', { name: 'Newest first' }).click();
      await expect(first).toHaveText(/Regional Italian Flair/);
    });

    test('a kind and a word compose', async ({ page }) => {
      await page.goto('/blog');
      await page.getByRole('button', { name: 'In the press' }).click();
      await page.getByRole('searchbox', { name: 'Search stories' }).fill('cordon');
      await expect(page.locator('article')).toHaveCount(1);
      // Same word, a kind that has no posts: the filter and the search are two
      // separate steps, and a page that showed the Cordon Bleu card here would
      // be applying only one of them.
      await page.getByRole('button', { name: 'Story' }).click();
      await expect(page.locator('article')).toHaveCount(0);
      await expect(page.getByText(/No stories match that/)).toBeVisible();
    });

    test('the pressed pill is ink on brand, never white on brand', async ({ page }) => {
      await page.goto('/blog');
      const colours = await page.getByRole('button', { name: 'All' }).evaluate((el) => {
        const style = getComputedStyle(el);
        return { color: style.color, background: style.backgroundColor };
      });
      // Both assertions on the foreground, deliberately: the equality holds
      // the colour, the inequality names the hazard for whoever reads this
      // after breaking it.
      expect(colours.color).not.toBe('rgb(255, 255, 255)');
      expect(colours.color).toBe(INK);
      expect(colours.background).toBe(BRAND);
      // Deferred claim 1's actual words were "meets AA". The pair above is
      // 10.9:1, but a future palette move could keep both values off white and
      // still land under 4.5, so the ratio is computed rather than inferred
      // from the two equalities.
      expect(contrast(colours.color, colours.background)).toBeGreaterThanOrEqual(4.5);
    });

    test('a pill still reads as ink on brand after it is the one pressed', async ({ page }) => {
      await page.goto('/blog');
      const recipe = page.getByRole('button', { name: 'Recipe' });
      await recipe.click();
      // toHaveCSS, not a bare evaluate: `transition-colors duration-300` means
      // getComputedStyle read immediately after the class flips returns the
      // FROM value, and an unretried read here measured white-on-black -- the
      // pre-transition state -- while the button was on its way to brand.
      // That is the shape of a test that passes on a defect and fails on a
      // fix, so it retries.
      await expect(recipe).toHaveCSS('background-color', BRAND);
      await expect(recipe).toHaveCSS('color', INK);
      await expect(page.getByRole('button', { name: 'All' })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    });

    test('nothing the controls add pushes the page sideways', async ({ page }) => {
      await page.goto('/blog');
      await fontsSettled(page);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    });

    test('the four kind pills sit on one row at 1280 and wrap at 390', async ({ page }) => {
      // What "wraps" actually means, measured. Dropping flex-wrap does NOT
      // overflow the page: flex items have an automatic min-content minimum,
      // so the four pills shrink and their labels wrap inside the buttons
      // instead -- so the overflow test above stays green. This is the
      // assertion that catches it.
      //
      // It waits for the webfont first. In the fallback font the four pills
      // measure 333.7px against the 358px column and do NOT wrap; in
      // Montserrat they measure 365.3px and do. Without fontsSettled this test
      // is a coin flip on network timing, and it flipped tails on the first
      // measurement run of this spec.
      await page.goto('/blog');
      await fontsSettled(page);
      const first = (await page.getByRole('button', { name: 'All' }).boundingBox())!;
      const last = (await page.getByRole('button', { name: 'In the press' }).boundingBox())!;
      if (size.width === 390) expect(last.y).toBeGreaterThan(first.y);
      else expect(last.y).toBe(first.y);
      // The sort row is two shorter pills and stays on one line at both
      // widths; saying so is what stops "wraps at 390" being read as "every
      // row wraps at 390".
      const [newest, oldest] = await boxes(page, ['Newest first', 'Oldest first']);
      expect(oldest.y).toBe(newest.y);
    });

    test('every control is inside the viewport, and none overlaps another', async ({ page }) => {
      await page.goto('/blog');
      await fontsSettled(page);
      const all = await boxes(page, CONTROLS);
      all.forEach((box, i) => {
        expect(box.x, `${CONTROLS[i]} starts left of the viewport`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${CONTROLS[i]} runs past the right edge`).toBeLessThanOrEqual(size.width);
      });
      for (let i = 0; i < all.length; i += 1) {
        for (let j = i + 1; j < all.length; j += 1) {
          expect(overlaps(all[i], all[j]), `${CONTROLS[i]} overlaps ${CONTROLS[j]}`).toBe(false);
        }
      }
    });

    test('every control clears the WCAG 2.2 minimum target size', async ({ page }) => {
      await page.goto('/blog');
      await fontsSettled(page);
      const all = [...(await boxes(page, CONTROLS))];
      const search = await page.getByRole('searchbox', { name: 'Search stories' }).boundingBox();
      expect(search).not.toBeNull();
      all.push(search!);
      for (const box of all) {
        // 24x24, WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA.
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
        // And a floor at what ships today, so this cannot quietly shrink
        // towards the AA line. MEASURED: every control is exactly 38px tall
        // (px-4 py-2 around a 20px text-sm line box) and at least 49.6px wide.
        //
        // Task 30's deferred claim 3 asked for 44x44. IT IS NOT MET, and this
        // test does not pretend otherwise: 44x44 is WCAG 2.5.5 Level AAA (and
        // Apple's HIG), the shipped controls are 38 tall, and closing the last
        // 6px is a padding change with a CSS cost that belongs to a task with
        // a brief for it, not to a task whose job is to measure. Reported.
        expect(box.height).toBeGreaterThanOrEqual(38);
      }
    });

    test('the search field fills the column at 390 and stops at its cap at 1280', async ({ page }) => {
      await page.goto('/blog');
      const search = (await page.getByRole('searchbox', { name: 'Search stories' }).boundingBox())!;
      const column = (await page.getByRole('group', { name: 'Filter stories by kind' }).boundingBox())!;
      if (size.width === 390) {
        // w-full inside the px-4 content column: 390 - 32 = 358, which is also
        // exactly the width of the control rows above it.
        expect(search.width).toBe(column.width);
        expect(search.width).toBe(size.width - 32);
      } else {
        expect(search.width).toBe(SEARCH_CAP);
        // Centred: mx-auto is what `justify-center` on the row buys, and a
        // capped-but-left-aligned field would satisfy the width assertion
        // alone.
        expect(search.x).toBeCloseTo((size.width - SEARCH_CAP) / 2, 1);
      }
      expect(search.x).toBeGreaterThanOrEqual(0);
      expect(search.x + search.width).toBeLessThanOrEqual(size.width);
    });

    test('the search placeholder is opaque, and its colour is the one measured', async ({ page }) => {
      await page.goto('/blog');
      const style = await page.getByRole('searchbox', { name: 'Search stories' }).evaluate((el) => {
        const ph = getComputedStyle(el, '::placeholder');
        return { color: ph.color, opacity: ph.opacity, field: getComputedStyle(el).backgroundColor };
      });
      // A pin, NOT a pass. Deferred claim 5 asked whether the placeholder meets
      // AA against the white field. MEASURED: #9CA3AF on #FFFFFF is 2.54:1,
      // which fails AA's 4.5:1 for text and fails even the 3:1 non-text bar.
      // Nothing in this repo sets that colour -- it is Tailwind preflight's
      // base-layer `::placeholder` -- so fixing it is a stylesheet decision
      // with a CSS cost, and it is REPORTED rather than quietly asserted away.
      // The equality is what forces the next person who changes it to come
      // back here and re-measure instead of assuming.
      expect(style.color).toBe(PLACEHOLDER);
      expect(style.field).toBe('rgb(255, 255, 255)');
      // Firefox halves placeholder opacity by UA default and Chromium does
      // not; reading the colour without the opacity would overstate the
      // contrast by a factor the ratio above cannot see.
      expect(style.opacity).toBe('1');
      expect(contrast(style.color, style.field)).toBeLessThan(4.5);
    });

    test('every control shows a focus ring when it is tabbed to', async ({ page }) => {
      await page.goto('/blog');
      // No click anywhere in this test, on purpose: Chromium only matches
      // :focus-visible on a programmatic focus while the last input modality
      // is not a pointer, so a stray click earlier in the test would make this
      // pass or fail for a reason that has nothing to do with the stylesheet.
      for (const name of CONTROLS) {
        const control = page.getByRole('button', { name, exact: true });
        const before = await control.evaluate((el) => getComputedStyle(el).outlineStyle);
        expect(before, `${name} is already ringed before focus`).toBe('none');
        await control.focus();
        const after = await control.evaluate((el) => {
          const s = getComputedStyle(el);
          return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, offset: s.outlineOffset };
        });
        expect(after.style, `${name} focus ring style`).toBe('solid');
        expect(after.width, `${name} focus ring width`).toBe('2px');
        expect(after.color, `${name} focus ring colour`).toBe(FOCUS_RING);
        // The offset is what keeps the ring off the pill itself. Without it a
        // 2px accent line sits on the brand surface at 3.1:1 rather than on
        // the page at 6.03:1.
        expect(after.offset, `${name} focus ring offset`).toBe('2px');
      }
      // The search field is NOT covered by index.css's rule, which names only
      // `button:focus-visible` and `a:focus-visible`. It still shows a ring,
      // but it is Chromium's own: outline-style `auto`, in the UA's blue, not
      // the site's accent. Asserted as what it is -- a visible ring from a
      // different source -- and reported, because a UA default is not a
      // decision this project made and the next browser may draw it
      // differently.
      const search = page.getByRole('searchbox', { name: 'Search stories' });
      expect(await search.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
      await search.focus();
      expect(await search.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('auto');
    });

    test('the no-match sentence is on screen, unclipped and unoccluded', async ({ page }) => {
      await page.goto('/blog');
      await fontsSettled(page);
      await page.getByRole('button', { name: 'Recipe' }).click();
      const sentence = page.getByText(/No stories match that/);
      await expect(sentence).toBeVisible();
      await expect(sentence).toBeInViewport();
      const measured = await sentence.evaluate((el) => {
        const r = el.getBoundingClientRect();
        // Three points across the sentence's own band rather than one: an
        // overlapping control row would cover an end and leave the middle
        // clear, and a single centre probe would call that unoccluded.
        const probes: [number, number][] = [
          [r.x + 4, r.y + r.height / 2],
          [r.x + r.width / 2, r.y + r.height / 2],
          [r.right - 4, r.y + r.height / 2],
        ];
        return {
          box: { x: r.x, y: r.y, width: r.width, height: r.height },
          // scrollHeight > clientHeight is the signature of text clipped by a
          // fixed-height ancestor, which is what "unclipped" has to mean for a
          // sentence that wraps to two lines at 390px.
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          hits: probes.map(([x, y]) => {
            const top = document.elementFromPoint(x, y);
            return top !== null && (top === el || el.contains(top));
          }),
        };
      });
      expect(measured.scrollHeight).toBe(measured.clientHeight);
      expect(measured.box.x).toBeGreaterThanOrEqual(0);
      expect(measured.box.x + measured.box.width).toBeLessThanOrEqual(size.width);
      expect(measured.hits, 'something is painted over the no-match sentence').toEqual([true, true, true]);
      // And it sits BELOW the controls that produced it, not behind them.
      const searchBox = (await page.getByRole('searchbox', { name: 'Search stories' }).boundingBox())!;
      expect(measured.box.y).toBeGreaterThanOrEqual(searchBox.y + searchBox.height);
    });

    test('the control rows sit between the intro and the first card row', async ({ page }) => {
      await page.goto('/blog');
      await fontsSettled(page);
      const intro = (await page.locator('h1 + p').boundingBox())!;
      const filters = (await page.getByRole('group', { name: 'Filter stories by kind' }).boundingBox())!;
      const sort = (await page.getByRole('group', { name: 'Sort stories' }).boundingBox())!;
      const search = (await page.getByRole('searchbox', { name: 'Search stories' }).boundingBox())!;
      const card = (await page.locator('article').first().boundingBox())!;
      // Strictly stacked, top to bottom, with no pair sharing a pixel. Order
      // alone would be satisfied by three rows drawn on top of each other, so
      // each step compares the NEXT top against the PREVIOUS bottom.
      const stack = [intro, filters, sort, search, card];
      const labels = ['intro', 'filter row', 'sort row', 'search', 'first card'];
      for (let i = 1; i < stack.length; i += 1) {
        expect(stack[i].y, `${labels[i]} rides up into ${labels[i - 1]}`).toBeGreaterThanOrEqual(
          stack[i - 1].y + stack[i - 1].height,
        );
      }
      for (let i = 0; i < stack.length; i += 1) {
        for (let j = i + 1; j < stack.length; j += 1) {
          expect(overlaps(stack[i], stack[j]), `${labels[i]} overlaps ${labels[j]}`).toBe(false);
        }
      }
    });
  });
}

// The eight claims Task 30 deferred here, and where each one is now checked:
//
// 1 pressed-control contrast ......... "the pressed pill is ink on brand..."
//                                      and "...after it is the one pressed"
// 2 rows wrap, no sideways scroll .... "the four kind pills sit on one row..."
//                                      and "nothing the controls add pushes..."
// 3 44x44 hit boxes .................. "every control clears the WCAG 2.2
//                                      minimum target size" -- 24x24 AA is met,
//                                      44x44 AAA is NOT. Measured at 38 tall.
// 4 search width at both widths ...... "the search field fills the column..."
// 5 placeholder contrast ............. "the search placeholder is opaque..."
//                                      -- 2.54:1, does NOT meet AA. Pinned.
// 6 a visible focus ring per control . "every control shows a focus ring..."
//                                      -- accent on the six buttons, the UA's
//                                      own ring on the search field.
// 7 no-match sentence unclipped ...... "the no-match sentence is on screen..."
// 8 rows between intro and cards ..... "the control rows sit between the intro
//                                      and the first card row"
