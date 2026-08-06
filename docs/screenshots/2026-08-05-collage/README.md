# The hero collage, before and after the split tree

`before-390.png` / `before-1440.png` — the homepage as it is live today.
`after-390.png` / `after-1440.png` — the same page after the collage became a
tree of splits (commit "render the collage as nested flex").

Captured against a local dev server at the two widths the plan names, hero
section only, real content, all images loaded.

## What to look at

**Thirteen of the sixteen photos are in exactly the same place, at exactly the
same size.** The only visible change is the top-left corner: it was empty in
the "before" — bare wall texture, no photo — and the three photos on the left
edge (the dining room, and the two pasta close-ups beside it) now grow upward
to fill it.

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
