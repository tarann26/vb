// Plan 6 gave this file a 24-entry `safelist` of grid-placement utilities,
// because `galleries.heroCollage[i].className` was a Tailwind class string
// authored in `src/content/galleries.json` -- a file this glob has never
// scanned and, for the reason recorded below, deliberately still does not.
// Measured before that safelist existed: of the fourteen distinct grid
// utilities the real content used, seven had NO rule anywhere in the built
// stylesheet, so those tiles auto-placed and Hero.tsx's own `overflow-hidden`
// clipped whatever fell outside the six explicit rows. Nine photos were
// invisible on the live homepage and nobody could see why.
//
// The safelist is gone because the problem is gone. The collage is a tree of
// splits now (src/content/collage.ts) and a box's size is a NUMBER that
// leaves as an inline `flexGrow` -- there is no class name to scan for, at
// build time or at runtime, so no list of positions can be missing one. That
// is the structural version of the fix; the safelist was the version that
// had to be kept complete by hand.
//
// The decision NOT to add `./src/content/*.json` to the glob still stands,
// and now for a stronger reason than when it was first taken: scanning her
// authored prose for class names is a permanent hazard (the `blocklist`
// below exists because of exactly that kind of accidental match), and there
// is no longer anything in that file for a scan to find.
//
// `!./src/**/__tests__/**` and `!./src/test/**` stay, for their own separate
// reason: utility names that appear only as fixture strings in a test emit
// real rules that ship to every visitor, and make the stylesheet's hash --
// a full CDN cache-bust on every deploy -- churn whenever a test comment
// happens to mention one.
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '!./src/**/__tests__/**', '!./src/test/**'],
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
      // Named tokens rather than hex literals scattered through components.
      // Before this, the brand green was written out ~45 times across 12
      // files with a separate hover partner, so a palette change meant a
      // find-and-replace across the codebase and a guarantee of missing one.
      // src/test/palette.test.ts asserts none of the old literals survive.
      colors: {
        brand: '#C8D8E8',
        'brand-dark': '#A6B3C1',
        accent: '#9D4949',
        'accent-dark': '#823C3C',
        ink: '#222222',
        cream: '#FFFDF8',
        'cream-alt': '#F9F9F9',
        // The section washes. A band on a phone in daylight has to be visibly
        // a band: measured at 390px, every wash on this site sat 2 to 8 points
        // below white and only the footer read as a boundary at all. These
        // land 18 points below white -- the brand surface colour at 45% over
        // white for the cool one, its mirror about the neutral axis for the
        // warm one -- which is the footer's own distance and is where
        // e2e/section-washes.spec.ts holds them.
        //
        // Still a wash, not a colour. The brand blue stays a SURFACE colour
        // (1.45:1 on white); text on these keeps using ink or the accent, and
        // e2e/brand-contrast.spec.ts's sweep over every text node still
        // governs. src/test/palette.test.ts holds the floors these clear.
        //
        // ONE CONSTRAINT THIS CREATES: the palest of Tailwind's mid greys
        // measures 4.10:1 on the cool wash and 4.20:1 on the warm one, both
        // under AA. That grey and these two washes are mutually exclusive
        // from here on. Nothing on the homepage pairs them today; the sweep
        // will say "unreadable" without saying why, so it is said here.
        wash: '#E6EDF5',
        'wash-warm': '#F5EEE4',
      },
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
