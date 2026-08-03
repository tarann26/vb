/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
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
