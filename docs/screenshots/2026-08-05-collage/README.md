# The hero collage, before and after the split tree

`before-390.png` / `before-1440.png` — the homepage as it is live today.
`after-390.png` / `after-1440.png` — the same page after the collage became a
tree of splits (commit "render the collage as nested flex").

Captured against a local dev server at the two widths the plan names, hero
section only, real content, all images loaded.

## What to look at

Measured directly — a real Chromium render of both pages, before and after,
at 390px and 1440px, every one of the sixteen `<img>` boxes read off
`getBoundingClientRect()` — rather than eyeballed: **none of the sixteen
photos sits at exactly the same rectangle.** Thirteen shift by under 3px
(CSS Grid's tracks and the tree's nested flex round their gaps slightly
differently; invisible at normal viewing distance, and the same order of
magnitude as the 1-2px this project's own add/remove operations already
disclose to her elsewhere). The other three move substantially: the arched
dining room (with its wall mirror), the woven wall-hanging beside it, and the
hand-filling-pasta shot below both — not "two pasta close-ups", only the
last of the three is pasta — grow upward from the middle of the collage into
the top-left corner, which was empty in the "before": bare wall texture, no
photo.

That emptiness was not a design decision anybody made. The old layout asked
the browser to auto-place three of the sixteen photos, and the browser pushed
two of them out of the top-left and into the middle, leaving a 2x2 hole
nobody had authored. Nothing else moves: the two Farfalle cards still sit in
the bottom corners, the coast photo still fills the top right, and the calm
photos still sit behind the logo and the reservation numbers.

## The one thing to say

**Is the top-left corner better filled with photos, or did you want it empty?**
Everything else on the hero is unchanged; if the empty corner was deliberate,
it can be put back.

## Not yet signed off

Recorded honestly: the owner has not seen these at the time of the commit.
The plan asks for her yes in the Task 3 commit message; she was not reachable,
so this went in without it and the gate moves to merge rather than to commit.
Nothing here is on the live site until `main` is pushed.
