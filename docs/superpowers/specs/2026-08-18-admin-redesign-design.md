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

**What blocks it, and it is not a scheduling problem.** The folders are owned
by `arpit@socialtab.in` and `cykhdesigns@gmail.com` and shared with the owner.
Google Drive indexes a *folder* shared with you, but not the individual files
inside it — a listing of any of those folders' contents comes back empty
through the API, while images shared with the owner directly are returned
normally. So the folders can be seen and their contents cannot be read.

**Three ways past it**, in order of preference:

1. The folder owners share the files with the owner directly, or move them into
   a shared drive the owner is a member of.
2. The owner copies the folders into their own Drive, which makes them owned
   rather than shared.
3. The owner downloads the images and they are added to the repository, which
   is how every image on the site got there today.

**What Phase 6 then involves.** Examining the images, updating dishes, drinks,
press and galleries with whatever is new, running every image through the
derivative pipeline, and uploading. Note that **R2 is not enabled on this
account** — it is billing-gated — so image storage remains the repository plus
the build-time derivative pipeline until that changes.

Phase 6 stays out of scope until the access question above is resolved. It
should be its own spec, because by then it is a content migration rather than a
feature, and it needs a decision about where the images live before a single
one is touched.
