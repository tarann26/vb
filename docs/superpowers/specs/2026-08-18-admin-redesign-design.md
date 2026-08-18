# Via Bianca `/edit` redesign: lists, editors, and one writing surface

**Date:** 2026-08-18
**Status:** approved by the owner, ready for an implementation plan

## Goal

Make the dashboard usable without scrolling, and make writing a post feel like
writing anywhere else.

Two changes, one spec:

1. Every content section becomes a **compact list** — a small thumbnail and a
   name — where clicking a row opens an **editor** over the page. Add opens the
   same editor, empty.
2. The blog's multi-box block editor becomes **one continuous writing surface**
   with a toolbar, keyboard shortcuts, and images placed between paragraphs.

## Why

**The lists.** Opening Drinks today renders every drink as a fully expanded
form. Finding the fourth one means scrolling past three complete forms. The
information she needs to *find* an item is its name and its photo; everything
else is only needed once she has found it.

**The writing surface.** A post is currently assembled by adding a box per
paragraph, per image, per heading. The structure is right and the interface is
backwards: she has to think about the shape of the document before she has
written a sentence. Nobody writes that way.

## Scope

In: all thirteen panels, each in the shape that suits it. The blog writing
surface. The About section, which becomes the same writing surface with a
length limit.

Out: the publish model, authentication, anything on the public site, and the
Google Drive content refresh (see the last section).

---

## The list

A row is a **small square thumbnail** and the **item's name**. Nothing else.
Items with no image of their own — an award, a menu PDF — get a neutral
placeholder occupying the same space, so rows stay aligned and the list reads
as a column rather than a ragged edge.

Hover and keyboard focus both highlight the whole row. Clicking anywhere on it
opens the editor.

**Add** sits at the top of the list and opens the same editor with a blank
item. One surface, one code path, no separate "new item" form to drift from the
edit form.

**Delete lives inside the editor, not on the row.** A delete control on a list
row is how someone loses a dish by mis-tapping while scrolling a phone.

**Reordering, where order matters,** is done by dragging a row. The block
editor already has a working drag implementation with a keyboard fallback
(`Move up` / `Move down` buttons); that pattern is reused rather than
reinvented, including the fallback — dragging is not the only way to move
something.

## The editor surface

One component, two layouts:

- **Laptop:** a centred dialog, the page dimmed behind it.
- **Phone:** a full-screen sheet that slides up, with a large close control and
  the primary actions within thumb reach.

Both are tested at 390px and 1280px, which this project already does for every
other visual claim.

**Saving does not change.** The editor has *Done*. Edits go into the staged
draft exactly as they do now, and nothing reaches the live site until she
presses *Publish*. Her existing mental model — my changes wait until I publish
— survives untouched, and that matters more than anything else in this
document.

## Per panel

| Panel | Shape |
|---|---|
| Dishes, Drinks, Menu PDFs, Pages, Galleries, Press, Awards, Experiences, Posts | List + editor |
| What shows on the homepage | List, drag a row to reorder. No editor — the only things to change are order and on/off, and both belong on the row |
| Words on the site | Grouped by section. The section heading is the row; opening it reveals every string in that group |
| About | The writing surface, with an enforced length limit so the section keeps its shape on the page |
| Opening hours | Unchanged. It is a small fixed set of fields and a list of one row would be worse |

---

## The writing surface

One continuous editable area. She types; Enter starts a new paragraph; the
toolbar acts on wherever the cursor is.

### Toolbar

Bold · Italic · Underline · Strikethrough · Link · Heading · Bulleted list ·
Numbered list · Quote · Image · Undo · Redo · Clear formatting

### Keyboard and typing behaviour

This is the part that makes it feel like a real editor, and it is not optional
decoration:

- `Cmd/Ctrl+B`, `+I`, `+U` — bold, italic, underline
- `Cmd/Ctrl+K` — link
- `Cmd/Ctrl+Z` — undo; `Shift+Cmd/Ctrl+Z` — redo
- `Cmd/Ctrl+\` — clear formatting
- Typing `1.` then space starts a numbered list
- Typing `-` or `*` then space starts a bulleted list
- Typing `#` then space makes a heading
- Typing `>` then space makes a quote
- Enter continues a list; Enter on an empty item leaves the list
- Tab and Shift+Tab nest and un-nest a list item
- **Paste strips incoming formatting.** Text pasted from Word, Google Docs or a
  webpage arrives as plain text in the site's own typography, rather than
  importing someone else's fonts and colours

### Images

The image button opens the device picker. The photo uploads through the flow
that already exists — the same staged-upload path, the same publish request —
and lands **centred, at column width, between paragraphs**. She does not
position it; the page does.

### What it stores

The writing surface is a **new view over the existing block model**, not a new
model. The content types already define every kind the toolbar needs:

```
paragraph · heading · bulletList · numberList · image · quote
```

The editor translates between the visible document and the stored block array:
a paragraph is a `paragraph` block, a bulleted list is a `bulletList` block, an
image is an `image` block. Nothing about storage moves.

This is what keeps the rest of the system intact — the renderer, the validation
guards, the Article structured data and per-post metadata the Worker generates,
and the HTML escaping that was hardened when server-rendered SEO shipped. A
free-form HTML editor would have reopened all four.

**The three published posts open in the new editor unchanged.** There is no
migration, because the storage never moves.

### What it deliberately does not do

No font family, font size, text colour, highlight, alignment, or line spacing.

Documents need those because a document has no house style. This site has one:
Montserrat and Open Sans, ink on white, brand blue `#C8D8E8` as a surface
colour only, accent `#9D4949` for foreground text on light backgrounds at
6.03:1. If a post can set its own typography, the site stops looking designed
and nothing in the codebase can tell her she has done something wrong.

This was raised with the owner and ruled out deliberately, not overlooked.

### Blocks not on the toolbar

Four existing block kinds — `gallery`, `ingredients`, `steps`, `citation` — are
not on the toolbar, because they are specific to recipes and press mentions
rather than to writing. They remain reachable through an **insert menu** on the
surface, so a recipe post can still carry its ingredients and a press mention
its citation. They are not removed, and posts already using them keep working.

---

## Costs, stated up front

**The CSS ceiling has to rise.** The entry stylesheet is 38593 bytes against a
38700 ceiling — 107 bytes free. A modal, list rows and a toolbar do not fit in
that. The ceiling is raised to a new measured number as part of this work; it
is not deleted. It exists to catch accidental bloat and it has done so more
than once.

**Undo and redo do not exist today.** They are the most-expected behaviour in
any writing surface and they are a real build, not a toolbar button.

**The writing surface is the riskiest thing this project will have built.**
Selection, cursor behaviour, paste, and phone keyboards are where editors fail,
and jsdom cannot test any of it. Those claims are provable only in a real
browser.

## Testing

The existing discipline holds: every test must be able to fail, proven by
mutating the code and watching it go red.

- **jsdom** — list rows render the right names, the editor opens and closes,
  Add produces a blank item, the editor maps a document to the right block
  array and back.
- **`e2e/`** — everything visual or positional: the sheet is full-screen at
  390px and a dialog at 1280px, hover highlights the row, an image sits centred
  at column width, the toolbar is reachable above a phone keyboard.
- **`e2e/` for the editor's behaviour specifically** — typing `1.` and space,
  Enter continuing and leaving a list, Tab nesting, paste stripping formatting,
  undo restoring the previous state. These involve selection and
  `contenteditable` and cannot be honestly asserted anywhere else.

---

## The public blog index

Three things a reader of a blog expects, none of which `/blog` has today.

**Filter by kind.** The content model already carries a type on every post —
`recipe`, `story`, `mention` — rendered today as the badge on each card
("Recipe", "Story", "In the press"). Those become three filter controls above
the list, plus an "All". The badge stays on the card, so the thing she filters
by and the thing she sees on a post are visibly the same thing rather than two
vocabularies for one idea.

**Sort by most recent.** The list is already newest-first and stably sorted
within a date. That becomes an explicit control rather than an invisible
default, with oldest-first as the alternative.

**Search.** A single field over post titles and excerpts, filtering the list as
she types. It searches what is already loaded in the browser — no new endpoint,
no server round trip, and it keeps working from the compiled-in fallback when
D1 is unreachable.

Filter, sort and search compose: choosing Recipes and typing "lemon" shows
lemon recipes. An empty result says so in words rather than showing an empty
grid, the same way the index already handles having no posts at all.

## The washes on a phone

Section backgrounds are currently invisible on a phone. Measured on the live
site at 390px by sampling background pixels down the page:

| Wash | Measured | Distance from white |
|---|---|---|
| Brand blue sections | `(247,249,251)`, `(248,250,252)` | 3–8 points |
| Warm cream section | `(255,253,248)` | 2–7 points |
| Grey sections | `(249,249,249)` | 6 points |
| Footer band | `(237,237,237)` | 18 points |

The brand washes are `bg-brand/8` through `bg-brand/30` — brand blue `#C8D8E8`
at 8% to 30% over white. At 8% that computes to `rgb(251,252,253)`, which is
white for any practical purpose. The footer at 18 points below white is the
only band that reads as a band, and it gives the target: **the washes should
land 15–20 points below white**, which is roughly a 15-point bump across the
opacity scale.

This stays a wash, not a colour — the point is that a section boundary is
perceptible on a phone in daylight, not that the page becomes blue. Brand blue
remains a surface colour only; text on these surfaces keeps using ink or accent
`#9D4949`, and the existing contrast sweep over every text node still governs.

Verified by screenshot at 390px before and after, with the pixel values
recorded, because "looks about right" is what produced the current values.

## Sequencing

Both halves are in one spec, but the plan orders them so the mechanical work
lands first:

1. The list and editor pattern across the panels that are lists.
2. The remaining panel shapes — homepage order, site wording, About.
3. The writing surface.

The riskiest piece therefore arrives against a dashboard that already works,
with a known-good state to roll back to.

---

## Phase 6: the Google Drive content refresh

Phase 6 of the original build was the content refresh from Google Drive, and it
was excluded from every phase built so far at the owner's instruction. The
reason still holds: it changes **data**, not structure, and doing it while the
schema was still moving would have meant doing it twice. Every image on the
site today came from the repository, not from Drive.

**What is in Drive.** These folders are visible: `Via bianca` (containing
`Bianca (9th june)`), `New Menu` (containing `Via Bianca Food Menu` and
`Via Bianca Drinks Menu`), `Via Bianca Handover`, `Via Bianca's Logo`, and
`Via Bianca's Brand Deck` as both PDF and `.ai`.

**The images are reachable, and an earlier reading of this said otherwise.**
Listing a shared folder's contents by parent returns nothing — Drive indexes a
folder shared with you but not, by that route, the files inside it. Searching
by **owner** does return them: the photo shoot exists as `NB0_75xx.JPG` files
owned by `arpit@socialtab.in`, roughly 10MB each, dated 2025-06-09, alongside
logo files owned by `cykhdesigns@gmail.com`. The first page alone returns
twenty-five and paginates further. The blocker was the query, not the access.

**The filenames carry no information.** `NB0_7576.JPG` says nothing about
whether the frame is a pasta dish, a cocktail, or the dining room. Identifying
what each photograph shows means looking at it. That is the substance of the
work, not a preliminary to it.

**What Phase 6 involves:**

1. Enumerate every image reachable in Drive, by owner rather than by folder.
2. Download them.
3. **Look at each one** and decide what it shows.
4. Where a photograph clearly depicts a dish or a drink that exists in the
   content, attach it to that item. **Where it cannot be identified with
   confidence, leave it unnamed rather than guessing** — a wrong photo on a
   menu item is worse than no photo.
5. Run every image through the existing derivative pipeline (`npm run images`)
   so the site serves `.webp` derivatives at the right sizes.
6. Add them to the repository and publish.

**Two boundaries on this work:**

- **The hero collage is not touched.** Its split tree is under an explicit
  owner constraint and has its own geometry tests; nothing in Phase 6 changes
  it.
- **Only sections that carry images** — dishes, drinks, galleries, experiences,
  press — plus any new dish or drink the photographs reveal. Text-only content
  is untouched.

**R2 is not enabled on this account** — it is billing-gated — so image storage
remains the repository plus the build-time derivative pipeline until that
changes. At roughly 10MB per source photograph, the count that ends up
committed matters, and the derivative pipeline's output rather than the
originals is what belongs in the repository.
