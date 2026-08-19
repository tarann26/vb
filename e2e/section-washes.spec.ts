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
// parent of the commit that introduced this file -- i.e. with no wash token
// touched, and at the MIDPOINT sample this file used until Task 34; see the
// sample-point block further down for why the sample moved and what that does
// to the comparability of these two tables):
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
//
//    FIXED after Task 35: that dot is on a real quarter utility now, the same
//    one a sibling dot in the same block already used, so it costs no new rule
//    and lands where a reader was always meant to see it. Both notes stay: the
//    contamination is why the BEFORE table's drinks row reads 11.0 instead of
//    the flat token, and deleting the explanation would leave that number
//    looking like a measurement of something.

// AFTER (measured 2026-08-18, 390x844, chromium, on Task 34, at the TOP-PADDING
// sample this file uses from here on):
//
//   label          kind    rgb              points   sample y
//   atmosphere     wash    (230,237,245)     17.7      230
//   food           white   (255,255,255)      0.0      260
//   drinks         wash    (245,238,228)     18.0       69
//   experiences    wash    (245,238,228)     18.0      160
//   press          wash    (230,237,245)     17.7      120
//   awards         white   (255,255,255)      0.0      332
//   our story      wash    (245,238,228)     18.0      120
//   visit          wash    (230,237,245)     17.7      118
//
// Every band now reads its token to the byte: (230,237,245) IS #E6EDF5 and
// (245,238,228) IS #F5EEE4, with no brick composited into either and no
// decoration or shadow in the sample. That is what Task 34's `relative` on
// each section wrapper bought -- note 2 above predicted exactly this, and it
// is the whole reason the two washes now measure identically to their own
// arithmetic (src/test/palette.test.ts computes 17.67 and 18.00 from the
// hexes alone, with no browser involved).
//
// The two white bands go to a flat 0.0, from 19.3 and 8.3. Note 1's overlay
// is gone from them for the same reason.
//
// TASK 34 MOVED THE SAMPLE POINT, AND THE TWO TABLES ARE THEREFORE NOT
// ROW-COMPARABLE. What moved is WHERE this file looks, never WHAT it asserts:
// the four thresholds below (>=15, <=20, >=8 shallowest, <=3 for white) are
// byte-identical to the ones Task 33 shipped red.
//
// The old sample was the vertical middle of whatever part of the section was
// on screen. Its premise, stated in note 3, was that x = 4 is inside the
// section and outside its centred content column, so nothing but the section's
// own background is painted there. On Task 34's values that premise failed on
// two of the eight bands, both measured rather than reasoned about:
//
//   drinks, at (4, 462): (235,233,229), 22.7 points -- and (245,238,228) at
//   x = 0, 8 and 12 and at every y from 262 to 662 in the same column. The
//   8x8 misplaced bubble of note 3 sits on exactly that pixel. bg-brand/25
//   over #F5EEE4 computes to (234,233,229); the sample was reading the
//   decoration, not the band. (That dot has since been put where it belongs,
//   which is note 3's own postscript. The sample point does not depend on
//   that fix and is not undone by it.)
//
//   visit, at (4, 462): (221,227,235), 27.3 points -- constant from y = 361 to
//   y = 661, darkening to (214,221,228) at x = 12 and hitting the white card
//   at x = 16, and reading (230,237,245) at y = 261. That is the penumbra of
//   `shadow-2xl` on VisitUs.tsx's white detail card, whose 50px blur at a
//   -12px spread reaches roughly 13px past the card's own edge -- i.e. past
//   the px-4 content column, into the gutter x = 4 was chosen for. A shadow is
//   not text, a card or a dot, so note 3's premise did not exclude it.
//
// Neither is a token error. Both were invisible before Task 34 because the
// brick overlay was contributing 8 to 22 points of its own to every row, so
// nothing in the BEFORE table was clean enough for a 5-to-9-point contaminant
// to show.
//
// The sample now sits 40px into the section's own `py-20` top padding -- 80px
// of guaranteed-empty background above the content column, in every one of
// these eight sections. It is the one region of a section where no card can
// cast into the gutter and no absolutely-positioned decoration is placed
// (Drinks' four bubbles sit at a quarter, a third, a half and a third-from-
// bottom of a 916px section; the highest is 229px down). Verified at all eight
// bands rather than argued: the AFTER table above is that verification, and
// every row is the flat token.
//
// The sample is asserted into range rather than clamped into it. A clamp would
// silently measure the nav, or the section above, if a future section were
// ever scrolled past its own top -- which is the failure mode this file cannot
// afford, since it would report a number that looks like a band and is not.

type Band = { id: string; label: string; kind: 'wash' | 'wash-deep' | 'white' };

// The eight homepage sections below the hero, in sections.json order --
// load-bearing now that the loop below this array also checks each pair
// against its true DOM neighbour. That order is NOT the object-literal key
// order App.tsx's own SECTION_COMPONENTS lookup happens to be written in
// (our story sits second-to-last on the real page, not second); confirmed
// directly against src/content/sections.json rather than assumed, after an
// earlier version of this array got that wrong and scrolled the wrong
// section into the wrong place. The hero is excluded: it is a photograph
// collage over white and has no flat band to sample. `kind: 'wash'` covers
// both the cool token and its warm partner (they sample within the same
// 15-to-20 band); `wash-deep` is the darker third token
// tailwind.config.js's own comment assigns to experiences and our story, so
// that neither shares an undifferentiated boundary with its DOM neighbour
// (backlog items 8 and 9).
const BANDS: readonly Band[] = [
  { id: 'gallery', label: 'atmosphere', kind: 'wash' },
  { id: 'menu', label: 'food', kind: 'white' },
  { id: 'drinks', label: 'drinks', kind: 'wash' },
  { id: 'experiences', label: 'experiences', kind: 'wash-deep' },
  { id: 'blogs', label: 'press', kind: 'wash' },
  { id: 'awards', label: 'awards', kind: 'white' },
  { id: 'our-story', label: 'our story', kind: 'wash-deep' },
  { id: 'visit', label: 'visit', kind: 'wash' },
];

function pointsBelowWhite(r: number, g: number, b: number): number {
  return 255 - (r + g + b) / 3;
}

test.use({ viewport: { width: 390, height: 844 } });

test('every wash band lands 15 to 20 points below white on a phone', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const rows: { label: string; kind: string; rgb: string; points: number; y: number }[] = [];

  for (const band of BANDS) {
    const section = page.locator(`#${band.id}`);
    await expect(section, `#${band.id} is not on the homepage`).toHaveCount(1);
    await section.scrollIntoViewIfNeeded();
    const box = (await section.boundingBox())!;
    // 40px into the section's own 80px `py-20` top padding, at x = 4: inside
    // the section, above its content column, and outside that column's px-4
    // gutter at every width. The header block above records what this sample
    // was until Task 34 (the section's on-screen midpoint), the two bands
    // where that point turned out to be reading a decoration and a card
    // shadow rather than the band, and the pixel evidence for both.
    //
    // That the gutter is load-bearing rather than arbitrary is measured, not
    // asserted. Re-running this whole file with the sample moved to x = 195,
    // the centre of the viewport: atmosphere (152,119,87), drinks (116,93,72),
    // experiences (93,60,18) and our story (100,104,114) all land on
    // photographs, 136 to 198 points down, and food moves from 19.3 to 29.7.
    // Four bands off by more than a hundred points is what a centre sample
    // buys. The px-4 content column starts at x = 16 at this width, so 4 is
    // clear of it -- with the two exceptions the AFTER block records, one an
    // absolutely positioned decoration and one a card shadow, neither of which
    // the column's padding constrains. Both are below the top padding this
    // sample now sits in.
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
    // NavBar.tsx is `fixed top-0` and fades itself in and out on every scroll
    // over 500ms (`showNavbar`), so a sample inside its box can be reading a
    // half-faded white bar instead of the band -- and `bg-white/90` over a
    // wash is exactly the direction that makes a band look like it passes
    // when it does not. This is not hypothetical: it was caught by a mutation
    // run, on #drinks, whose box.y is 4 and whose 40px sample therefore landed
    // at y = 44, inside a ~61px nav mid-fade. Both drinks assertions failed on
    // a value LIGHTER than its own token, in a run where nothing about drinks
    // had changed.
    //
    // The nav's own height is used rather than its current position, on
    // purpose. Mid-fade it carries `-translate-y-full`, so boundingBox().y
    // reports somewhere between -61 and 0 and a sample computed from it would
    // be safe or unsafe depending on where the transition happened to be --
    // which is the flake, not a fix for it. The height does not move.
    const nav = (await page.locator('nav').first().boundingBox())!;
    const y = Math.max(box.y + 40, nav.height + 8);
    // Hard, not soft, and not a clamp. If a section is ever scrolled so that
    // its top padding is off screen, or so far down that clearing the nav
    // would push the sample out of that padding and into the content column,
    // this would report a number that looks like a band and is not -- so the
    // run has to stop rather than measure the wrong thing. Measured today:
    // box.y runs 4 to 292 across the eight bands and the nav is 61 tall, so
    // only #drinks is moved by the nav clause at all (44 -> 69, still 15px
    // inside its own 80px padding) and no guard is resting on its limit.
    expect(y, `#${band.id} top padding is off screen at y=${y}`).toBeGreaterThanOrEqual(0);
    expect(y, `#${band.id} top padding is off screen at y=${y}`).toBeLessThan(844);
    expect(y, `#${band.id} sample is below its own top padding`).toBeLessThan(box.y + 80);
    const shot = await page.screenshot({ clip: { x: 4, y, width: 1, height: 1 } });
    const { data } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = [data[0], data[1], data[2]];
    const points = pointsBelowWhite(r, g, b);
    rows.push({
      label: band.label,
      kind: band.kind,
      rgb: `(${r},${g},${b})`,
      points: Number(points.toFixed(1)),
      y: Math.round(y),
    });

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
    } else if (band.kind === 'wash-deep') {
      // The same argument as the wash range above, one lightness step down:
      // src/test/palette.test.ts computes 29.0 from the hex alone with no
      // browser involved. The shallowest-channel floor is reused rather than
      // re-derived -- a token this much further from white cannot fail it for
      // a reason the wash range above would not already catch.
      expect.soft(points, `${band.label} mean drop`).toBeGreaterThanOrEqual(26);
      expect.soft(points, `${band.label} mean drop`).toBeLessThanOrEqual(32);
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

  // Backlog item 9's own check, on the rendered page rather than the palette
  // arithmetic: BANDS is in true DOM order now (see its own header comment),
  // so consecutive rows here ARE consecutive sections on the homepage.
  // `expect.soft`, matching every assertion above, so a run reports every
  // failing boundary rather than stopping at the first one.
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].points < 1 && rows[i - 1].points < 1) continue; // white against white is not a boundary anyone claimed
    expect
      .soft(Math.abs(rows[i].points - rows[i - 1].points), `${rows[i - 1].label} against ${rows[i].label}`)
      .toBeGreaterThanOrEqual(8);
  }

  await testInfo.attach('section-washes-390.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  // Printed as well as attached: the attachment is what CI keeps, the table is
  // what a human running this locally actually reads. `no-console` is not on
  // for e2e/, so there is no disable directive here -- eslint reports an unused
  // one as a warning, and this repo's gate is a silent `npx eslint .`.
  console.table(rows);
});
