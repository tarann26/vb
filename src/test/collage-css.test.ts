import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import galleries from '../content/galleries.json';
import { GRID_SIZE, parsePlacement } from '../content/placement';

// This project's own repaired live bug, restated as a test: Tailwind's
// content glob (tailwind.config.js) never included `.json`, so every grid
// placement `galleries.json` authors lives in a file Tailwind never scans.
// Of the fourteen distinct grid utilities `heroCollage` actually uses
// today, seven have NO rule anywhere in the built stylesheet at all (the
// tile auto-places, and Hero.tsx's own `overflow-hidden` -- line 57 --
// clips whatever falls outside the six explicit rows) and the other seven
// survive only because a TEST FILE happens to spell them out as fixture
// strings, which is its own defect (dead CSS that ships to every visitor,
// and a stylesheet hash that churns whenever a test comment mentions a
// utility name -- see Task 2's own report). This file is the guard: every
// utility the real content actually needs must have a real rule, and (Task
// 5) every one of the 24 positions the collage COULD use must ship too, so
// a future "trim the safelist, nothing uses column 1" commit can't make a
// column silently undraggable.
//
// Needs `dist/` -- follows bundle.post-build.test.ts's own established
// convention (`it.runIf(REQUIRED)` / `skipIf(!REQUIRED && !existsSync(...))`)
// rather than inventing a second mechanism for the identical problem: `npm
// run test` and `npm run test:deploy` both run before `dist/` exists on a
// fresh checkout, and a bare `skipIf` alone can't tell "no dist/ yet, that's
// expected" apart from "dist/ should be here and isn't" (see that file's own
// comment on the exact silent-reduction-to-nothing failure mode this guards
// against).
//
// I-C review finding (repair): this file's own tests below were written
// with that convention, but `package.json`'s `test:bundle` script -- the
// one place VB_REQUIRE_DIST actually gets set -- named only
// `bundle.post-build.test.ts`, never this file. The documented Cloudflare
// build command (`docs/cloudflare-cutover.md`) is `npm run images && npm
// run test:deploy && npm run build`: `test:deploy` runs BEFORE `dist/`
// exists (before `vite build` inside `npm run build`), so every test below
// skipped there every time, silently, and `npm run build`'s own closing
// `npm run test:bundle` never ran this file at all -- so Task 2 Step 1's
// glob-fix guard and Task 5 Step 2's "pin all 24 positions" guard were both
// dormant in the real deploy pipeline from the day they were written,
// running only against whatever stale `dist/` a developer happened to have
// lying around locally. `test:bundle` now lists this file alongside
// bundle.post-build.test.ts, so it runs for real, post-build, with
// VB_REQUIRE_DIST=1 forcing REQUIRED (no silent skip if dist/ is somehow
// missing at that point either).
//
// One known, accepted gap this does not close: `col-start-1`/`2`/`3` and
// `row-start-1`/`2`/`3` (6 of the 24 positions the "pin all 24" test below
// checks) are ALSO spelled out literally in CollageTile.tsx's own panel
// markup (its mini 3x3 move-button grid), which Tailwind's scanner picks up
// directly from that component regardless of tailwind.config.js's own
// safelist. Removing those 6 entries from the safelist would still pass
// this test -- it would just be passing for a different, coincidental
// reason. The other 18 (col-start-4/5/6, every col-span/row-span, and
// row-start-4/5/6) are not spelled out anywhere else in real source, so the
// safelist is genuinely what this test is proving for those.
const REQUIRED = !!process.env.VB_REQUIRE_DIST;
const DIST_ASSETS = 'dist/assets';

function builtCss(): string {
  const cssFiles = readdirSync(DIST_ASSETS).filter((n) => /^index-.*\.css$/.test(n));
  if (cssFiles.length === 0) throw new Error('collage-css.test.ts: no built entry stylesheet found in dist/assets');
  return readFileSync(join(DIST_ASSETS, cssFiles[0]), 'utf8');
}

// Every distinct utility token the real, committed `galleries.json` uses --
// split straight off the raw `className` strings, not reconstructed from a
// parsed `Placement`, so this test can never quietly agree with itself about
// what "the utilities the file uses" means; it reads the same literal text
// Tailwind's own scanner would if it scanned this file (which is exactly
// the repair this task makes unnecessary).
function distinctHeroCollageUtilities(): string[] {
  const tokens = new Set<string>();
  galleries.heroCollage.forEach(({ className }) => {
    className.trim().split(/\s+/).forEach((token) => tokens.add(token));
  });
  return [...tokens].sort();
}

// A bare selector-existence check -- `.col-start-5{` -- not a full rule-body
// comparison: Tailwind's own minifier is free to reorder or combine
// declarations, and this test only needs to know the RULE exists, not what
// its own internals look like byte-for-byte (the rule-level DIFF this
// task's own report separately performs is what proves the rest).
function hasRuleFor(css: string, utility: string): boolean {
  const escaped = utility.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\.${escaped}\\{`).test(css);
}

describe('collage-css: every utility the real heroCollage content uses has a matching rule', () => {
  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('has real content to check -- non-vacuous', () => {
    expect(distinctHeroCollageUtilities().length).toBeGreaterThan(0);
  });

  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('every distinct utility galleries.json actually uses ships a real rule', () => {
    const css = builtCss();
    const missing = distinctHeroCollageUtilities().filter((utility) => !hasRuleFor(css, utility));
    expect(missing).toEqual([]);
  });

  // Every one of galleries.json's real placement strings must still be
  // something `parsePlacement` (Task 1) understands -- a content file that
  // drifted out of the shape this whole plan's parser/validator/renderer
  // agree on would make every other check in this file meaningless.
  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('every real heroCollage className still parses', () => {
    galleries.heroCollage.forEach(({ className }) => {
      expect(parsePlacement(className)).not.toBeNull();
    });
  });

  // Task 5, Step 2: pin all 24 possible positions, not just the ones the
  // current sixteen tiles happen to occupy -- so a future "trim the
  // safelist, nothing uses column 1" tidy-up can't make a whole column or
  // row silently unreachable by drag, the exact shape of defect this task
  // opened by repairing. Generated from `GRID_SIZE`, never hard-coded to 6
  // a second time (placement.ts's own header comment: two independent
  // hard-codes is exactly what lets a future grid-size change break
  // silently).
  it.skipIf(!REQUIRED && !existsSync(DIST_ASSETS))('all 24 col-start/col-span/row-start/row-span-1..GRID_SIZE positions ship, whether or not a tile currently occupies them', () => {
    const css = builtCss();
    const missing: string[] = [];
    (['col-start', 'col-span', 'row-start', 'row-span'] as const).forEach((kind) => {
      for (let n = 1; n <= GRID_SIZE; n++) {
        const utility = `${kind}-${n}`;
        if (!hasRuleFor(css, utility)) missing.push(utility);
      }
    });
    expect(missing).toEqual([]);
  });
});
