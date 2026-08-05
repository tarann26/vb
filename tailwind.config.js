import { GRID_SIZE } from './src/content/placement.ts';

// Plan 6, Task 2: the hero collage's own grid placements
// (`galleries.heroCollage[i].className`, e.g. "col-start-5 col-span-2
// row-span-2") live in `src/content/galleries.json`, and this glob has
// never included `.json` -- Tailwind's content scanner never saw them.
// Measured against the shipped stylesheet before this task: of the
// fourteen distinct grid utilities the real content actually uses, seven
// had NO rule anywhere in the built CSS at all (the tile auto-placed, and
// Hero.tsx's own `overflow-hidden` clipped whatever fell outside the six
// explicit rows), and the other seven survived only because a TEST FILE
// happened to spell them out as fixture strings.
//
// Decision, recorded so it is not re-litigated: add `./src/content/*.json`
// to this glob, NOT the fix. Measured directly -- once the safelist below
// exists, adding the glob on top of it produces a BYTE-IDENTICAL
// stylesheet with an identical selector set, a strict no-op, at the
// permanent cost of a scanning surface over her own authored prose (the
// same hazard `blocklist` below already exists for). The deeper reason the
// glob can't stand alone even without the safelist: scanning is BUILD-TIME
// and dragging (Task 4) is RUNTIME. `/edit` and `/` load the same
// stylesheet, so a position no tile occupies at the moment of the last
// build has no rule at `/edit` either, and a tile she just dragged there
// auto-places in the live preview -- only a publish plus a Cloudflare
// rebuild would make it correct, on the one surface whose entire value is
// that it previews correctly right now.
//
// The real fix is the safelist below, generated from the same `GRID_SIZE`
// placement.ts itself exports (never a second, hard-coded `6` here -- see
// that module's own header comment on why a future grid-size change must
// not be able to make this file silently disagree with it), covering every
// one of the `4 axes * GRID_SIZE` positions the collage could ever use --
// not just the ones the current sixteen tiles happen to occupy, so a
// future drag onto an empty column never lands on missing CSS.
//
// `!./src/**/__tests__/**` and `!./src/test/**` are added alongside the
// safelist, not instead of it: those seven utilities that survived only
// via test fixture text are dead weight either way (nothing on the real
// page ever renders them from there) and, worse, make the shipped
// stylesheet's own hash -- a full CDN cache-bust on every deploy -- churn
// whenever a test comment happens to mention a utility name. Excluding
// test directories from the scan is what stops that leak at the source,
// independent of whatever the safelist below covers.
const AXES = ['col-start', 'col-span', 'row-start', 'row-span'];
const GRID_PLACEMENT_SAFELIST = AXES.flatMap((axis) =>
  Array.from({ length: GRID_SIZE }, (_, i) => `${axis}-${i + 1}`),
);

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '!./src/**/__tests__/**', '!./src/test/**'],
  safelist: GRID_PLACEMENT_SAFELIST,
  theme: {
    extend: {
      // The nav's staggered reveal. A keyframe here rather than per-item
      // Tailwind classes because the DELAY is data (an index), and building
      // a per-index delay class name from a variable is exactly what
      // this project's scanner cannot see -- NavBar.tsx passes the delay as
      // an inline style and reuses this one animation for every item.
      keyframes: {
        'nav-in': {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: { 'nav-in': 'nav-in 280ms cubic-bezier(0.22, 1, 0.36, 1) both' },
    },
  },
  plugins: [],
  // Task 10 (Plan 4): PublishBar.tsx calls the real DOM method
  // `document.activeElement.blur()` (Step 1's carried requirement 2 --
  // flushing a focused field before a keyboard submit reads it). Tailwind's
  // content scanner is a plain text extractor with no JS parser behind it
  // (src/test/bundle.test.ts's own IMPORTS_ADMIN comment makes the identical
  // point about a different regex): it splits on non-word characters like
  // `.` and `(` the same way it splits on whitespace, so `.blur()` -- a
  // method CALL, never a className -- tokenizes down to the bare word
  // "blur", which happens to also be a real, no-argument Tailwind utility
  // (`.blur{filter:blur(8px)}`). No `className="blur"` exists anywhere in
  // this project -- confirmed directly, and re-confirmed by the rule-level
  // CSS diff this project's own standing instruction requires for every
  // task -- so this is a same-word collision with a browser API, not a
  // false negative hiding a REAL missing style. `blocklist`, not a comment
  // reword (there is no way to spell a real DOM method differently), is
  // Tailwind's own purpose-built tool for exactly this: it only suppresses
  // the utility actually named `blur`, not `blur-sm`/`blur-md`/etc, and not
  // any other file's real usage of the word.
  blocklist: ['blur'],
};
