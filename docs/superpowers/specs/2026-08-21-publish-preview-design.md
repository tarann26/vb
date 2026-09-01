# The publish preview: see the site before it is the site

**Date:** 2026-08-21
**Status:** idea captured, not yet specified in full

## The idea, in the owner's words

Publish opens a pop-up showing what the website would now look like, with her
unpublished changes injected. **Nothing is written to the database first.** She
scrolls it, moves between pages, looks around properly, and then confirms --
or closes it and goes back to editing because she did not like something.

## Why it is worth building

She currently publishes on faith. The dashboard shows her the fields she
edited; it never shows her the page a diner will see. A wrong photograph or a
line that wraps badly on a phone is discovered after it is live, and the only
way back is to edit and publish again.

The word *preview* is usually a thumbnail. This is not that. It is **the real
site, navigable, rendered from unpublished content** -- which is the only kind
of preview that answers "does this look right".

## Why it does not depend on the content migration

The draft already exists in her browser at the moment she presses Publish.
Rendering the site from it needs no database write, no commit, and no deploy.
It could be built today against the current architecture and would work
unchanged afterwards.

Keeping it out of `2026-08-21-content-out-of-git-design.md` is deliberate:
coupling a feature to an infrastructure migration delays the feature and
enlarges the migration.

## The hard parts, named up front

**Rendering the real site with substituted content.** The public pages read
from the content provider; the preview has to supply the draft instead of the
published set, for every page, without a second copy of the site's components
drifting from the first. A second copy is the failure mode to avoid.

**Images that exist only in the browser.** A photograph she has picked but not
published has no URL yet. The preview must render the local file, and the
staged-photo naming path is where this project has shipped three separate
defects -- so this is the part to design carefully rather than quickly.

**Navigation inside the pop-up.** She expects to move between pages. That
means routing inside the preview that does not disturb the dashboard behind
it, and does not lose her draft when she closes it.

**Phone and laptop.** She uses both, and "does this look right" is a different
question at 390px. The preview should be able to answer both.

## What it must not do

**It must not write anything.** The moment a preview touches the database it
stops being a preview. Confirm is the only thing that publishes.

**It must not be a second implementation of the site.** If the preview renders
its own approximation, it will disagree with reality exactly when it matters.
