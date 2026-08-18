import { expect, test } from '@playwright/test';
import sharp from 'sharp';

// The section washes, measured as pixels on a 390px phone -- the only honest
// way to measure them, because src/index.css paints a fixed, full-viewport
// pseudo-element of a brick photograph at 10% opacity over the whole page,
// and getComputedStyle cannot see a pseudo-element's background image at
// all. e2e/brand-contrast.spec.ts's effectiveBg walks straight past it.
// Whatever that overlay contributes, a screenshot has it and a computed
// style does not.
//
// This is NOT a contrast measurement and must never become one. This project
// has one earlier contrast finding that was an artefact of pixel sampling a
// region with glyphs still painted in it (e2e/about-byline.spec.ts:104-120
// records it). Every sample below is taken in a section's left gutter, 4px
// in, where no text, card or decorative dot is painted. Contrast stays where
// it belongs, in e2e/brand-contrast.spec.ts, off computed style.

// BEFORE (measured 2026-08-18, 390x844, chromium, on admin-redesign, on the
// parent of this commit -- i.e. with no wash token touched):
//
//   label          kind    rgb              points
//   atmosphere     wash    (244,242,239)     13.3
//   food           white   (238,236,233)     19.3
//   drinks         wash    (243,244,245)     11.0
//   experiences    wash    (249,245,238)     11.0
//   press          wash    (234,234,233)     21.3
//   awards         white   (249,247,244)      8.3
//   our story      wash    (235,233,231)     22.0
//   visit          wash    (235,233,230)     22.3
//
// Reproduced byte-for-byte on two consecutive runs. The sample y each band
// lands on, which turns out to matter more than anything else here, was
// 462, 532, 462, 462, 843, 462, 843, 462 in that order.
//
// The tokens behind those pixels: atmosphere bg-[#F9F9F9], food bg-white,
// drinks and experiences bg-cream (#FFFDF8), press bg-slate-50 (#F8FAFC),
// awards bg-white, our story and visit bg-cream-alt (#F9F9F9).
//
// THREE THINGS TASK 34 HAS TO KNOW, and only the first was predicted.
//
// 1. The brick overlay does NOT contribute a constant. The prediction was
//    ~14.5 points everywhere, from compositing the image's channel MEANS --
//    (132.3, 110.0, 88.8), which sharp .stats() does confirm -- at 0.1 over
//    white. But `background-size: cover` on a fixed, full-viewport
//    pseudo-element means a one-pixel sample sees a LOCAL brick pixel, a dark
//    brick face or a light mortar line, never the mean. Measured directly, by
//    stripping the app out of the page and leaving body::before over white:
//    at x=4 the overlay alone runs from 2.3 to 23.7 points down, sampled every
//    20px through the viewport height. That is the whole 15-to-20 target band
//    and more, decided by nothing but where a section's midpoint happens to
//    land on screen.
//
//    The two `white` rows are the clean confirmation, and they confirm the
//    y-dependence rather than the constant: both are bg-white with no wash of
//    their own, so whatever they read IS the overlay -- and they read 19.3
//    (food, sampled at y=532) and 8.3 (awards, sampled at y=462). The
//    overlay-alone profile at those same two heights gives 19.3 and 8.3. Exact
//    agreement, so the compositing model `pixel = 0.9*token + 0.1*brick` is
//    right; it is the assumption of a single brick value that is wrong.
//
//    Consequence: on this branch, two bands carrying the SAME token cannot be
//    compared, and no token can be derived by subtracting a fixed overlay from
//    a measured pixel. Task 34's `relative` additions are what make the eight
//    numbers mean the same thing.
//
// 2. Decision D7 is confirmed live, and by more than a difference. drinks and
//    experiences carry the identical bg-cream token and measure differently
//    ((243,244,245) against (249,245,238)) exactly as D7 predicts, because
//    Drinks.tsx:13 carries `relative` and Experiences.tsx:32 does not. The
//    stronger evidence is the positioned one's actual value: with the stray
//    decoration in note 3 removed, #drinks at x=4 measures (255,253,248) --
//    bg-cream to the byte, no overlay in it at all. A positioned section
//    paints above the fixed pseudo-element; a static one paints below it.
//
// 3. THE `drinks` ROW IS CONTAMINATED. DO NOT DERIVE A TOKEN FROM IT. The
//    brief's premise for x = 4 -- inside the section, outside its centred
//    content column -- holds for seven bands and fails for this one, because
//    an `absolute` decoration ignores the column's px-4 entirely. At
//    Drinks.tsx:19 the bubble `<div className="absolute top-1/2 right-1/6 w-2
//    h-2 bg-brand/25 rounded-full animate-ping">` has a measured rect of
//    (0, 462, 8x8): `right-1/6` IS NOT A TAILWIND UTILITY -- the default inset
//    scale has halves, thirds and quarters and no sixths -- so it emits no
//    rule, `right` stays `auto` alongside `left: auto`, and the dot falls back
//    to its static position at the left edge instead of a sixth in from the
//    right. It lands on x=0..8 at exactly y=462, which is exactly where this
//    spec samples. (243,244,245) is that bubble: bg-brand/25 over cream
//    computes to (241,244,244). Removing the layer yields the clean token.
//
//    That is a real defect in the shipped page -- one of four decorative
//    bubbles is in the wrong place on every viewport -- and it is not Task 33's
//    to fix. It is reported.

type Band = { id: string; label: string; kind: 'wash' | 'white' };

// The eight homepage sections below the hero, in sections.json order. The
// hero is excluded: it is a photograph collage over white and has no flat
// band to sample.
const BANDS: readonly Band[] = [
  { id: 'gallery', label: 'atmosphere', kind: 'wash' },
  { id: 'menu', label: 'food', kind: 'white' },
  { id: 'drinks', label: 'drinks', kind: 'wash' },
  { id: 'experiences', label: 'experiences', kind: 'wash' },
  { id: 'blogs', label: 'press', kind: 'wash' },
  { id: 'awards', label: 'awards', kind: 'white' },
  { id: 'our-story', label: 'our story', kind: 'wash' },
  { id: 'visit', label: 'visit', kind: 'wash' },
];

function pointsBelowWhite(r: number, g: number, b: number): number {
  return 255 - (r + g + b) / 3;
}

test.use({ viewport: { width: 390, height: 844 } });

test('every wash band lands 15 to 20 points below white on a phone', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const rows: { label: string; kind: string; rgb: string; points: number }[] = [];

  for (const band of BANDS) {
    const section = page.locator(`#${band.id}`);
    await expect(section, `#${band.id} is not on the homepage`).toHaveCount(1);
    await section.scrollIntoViewIfNeeded();
    const box = (await section.boundingBox())!;
    // The vertical middle of whatever part of the section is on screen,
    // clamped into the viewport; x = 4 is inside the section and outside its
    // own centred content column at every width.
    //
    // That the gutter is load-bearing rather than arbitrary is measured, not
    // asserted. Re-running this whole file with the sample moved to x = 195,
    // the centre of the viewport: atmosphere (152,119,87), drinks (116,93,72),
    // experiences (93,60,18) and our story (100,104,114) all land on
    // photographs, 136 to 198 points down, and food moves from 19.3 to 29.7.
    // Four bands off by more than a hundred points is what a centre sample
    // buys. The px-4 content column starts at x = 16 at this width, so 4 is
    // clear of it -- with the one exception in note 3, which is an absolutely
    // positioned decoration that the column's padding does not constrain.
    //
    // Step 2 (coordinate spaces): boundingBox() is viewport-relative and
    // page.screenshot({ clip }) is documented as passing through to CDP,
    // which uses page coordinates -- so these two could have disagreed by the
    // scroll offset and every number below would have been silently wrong.
    // CHECKED before any number here was written down, and they agree:
    // Playwright normalises a non-fullPage clip into the VIEWPORT. Two
    // independent confirmations, at #menu, #drinks and #experiences with
    // scrollY at 1238, 1932 and 2808 -- (a) the clipped pixel equals the same
    // pixel read out of a full-viewport screenshot buffer, and (b) passing
    // the page-absolute y (y + scrollY) instead throws "Clipped area is
    // either empty or outside the resulting image", which it could not do if
    // the clip were in page coordinates. NO scroll offset is added below, and
    // none is needed.
    const y = Math.max(0, Math.min(box.y + box.height / 2, 843));
    const shot = await page.screenshot({ clip: { x: 4, y, width: 1, height: 1 } });
    const { data } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = [data[0], data[1], data[2]];
    const points = pointsBelowWhite(r, g, b);
    rows.push({ label: band.label, kind: band.kind, rgb: `(${r},${g},${b})`, points: Number(points.toFixed(1)) });

    // expect.soft, not expect, for the three numeric assertions -- the one
    // deliberate departure from the brief's own listing, and the reason is the
    // brief's own Step 4: this task's DELIVERABLE is the failure, and a hard
    // assertion aborts the loop at the first band, so seven of the eight rows
    // would never be measured and there would be no table to paste. Soft
    // assertions still fail the test; they just fail it with the whole
    // measurement in hand. It keeps paying after Task 34 turns this green: a
    // regression then reports every band that moved rather than the first one.
    if (band.kind === 'wash') {
      expect.soft(points, `${band.label} mean drop`).toBeGreaterThanOrEqual(15);
      expect.soft(points, `${band.label} mean drop`).toBeLessThanOrEqual(20);
      // A band cannot average 18 while one channel sits at white.
      //
      // PROVEN BY HAND, once, 2026-08-18, because no token this project ships
      // is degenerate enough to make it fire and a floor nobody has ever seen
      // go red is a floor nobody knows works. Experiences.tsx:32 was
      // temporarily given `bg-[#FFE6E5] relative` -- (255,230,229), a mean drop
      // of exactly 17.0, so both range assertions above PASS -- and this line
      // was the single failure the run reported for that band: "experiences
      // shallowest channel". Reverted immediately; Task 33 ships no component
      // change. The same run re-confirmed note 2 in passing, since the
      // positioned section measured #FFE6E5 to the byte with no brick in it.
      expect.soft(255 - Math.max(r, g, b), `${band.label} shallowest channel`).toBeGreaterThanOrEqual(8);
    } else {
      // The white bands stay white, because a wash only reads as a boundary
      // if the thing on the other side of it is not also a wash. This is
      // unreachable until Task 34 positions the sections above the brick
      // overlay -- see the BEFORE table above, where the two white bands
      // measure 19.3 and 8.3 points down purely from that overlay, and note 1
      // for why those two numbers are so far apart.
      expect.soft(points, `${band.label} mean drop`).toBeLessThanOrEqual(3);
    }
  }

  await testInfo.attach('section-washes-390.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  // Printed as well as attached: the attachment is what CI keeps, the table is
  // what a human running this locally actually reads. `no-console` is not on
  // for e2e/, so there is no disable directive here -- eslint reports an unused
  // one as a warning, and this repo's gate is a silent `npx eslint .`.
  console.table(rows);
});
