# Via Bianca: rebrand, restructure, and content platform

Date: 2026-08-15
Status: design, awaiting approval

## Why

Two reviews landed at once. The PR head reviewed the live site and flagged
brand problems: wrong logo font, wrong accent colour, Farfalle photos in the
hero, and a homepage order that buries the food. Chef Kamalika listed what the
site is missing as a business: cooking class bookings, gifting, catering with
photographs, awards, press, her own introduction, and a place to write.

Underneath both sits a structural problem. Content lives as JSON committed to
git and compiled into the bundle. That works for a fixed set of pages. It does
not work for a blog, and it means every new kind of content costs a new file,
a new type, a new validator, and a new admin screen.

This spec covers all of it as one plan delivered in six phases. Each phase
ships on its own.

## Decisions already taken

These were settled in conversation and are not reopened here.

**Palette.** `#C8D8E8` replaces `#6B8B59` everywhere the green appears,
including the logo and every button. Relative shade modulation carries over:
green darkened about 17% on hover (`#6B8B59` to `#5a7349`), so blue does the
same (`#C8D8E8` to `#A6B3C1`). `#9D4949` replaces the orange the PR head
suggested. Measured contrast against white: `#C8D8E8` is 1.45:1, `#9D4949` is
6.03:1. So blue is a surface colour and red is a text colour. Blue buttons take
`#222` text (10.9:1), not white (1.45:1, illegible). Where a button needs
emphasis, it takes `#9D4949` with white text.

**Type. Deferred, not cancelled.** The intent is Sitka VF Italic replacing
Parisienne for the wordmark, tagline, and strapline, with Aquila and Lim
dropped. Blocked on a file nobody has: Sitka is proprietary to Microsoft, and
webfont embedding requires an M-Product License bought from Tiro Typeworks or
Monotype. The copy bundled with Windows does not carry those rights. No host
solves this, because a host serves files rather than supplying them.

Until the licence and file exist, Parisienne stays. Every other Phase 1 item
proceeds. When the file arrives, fonts are self-hosted rather than loaded from
Google, which removes a third-party request from the critical path and lets the
CSP drop `fonts.googleapis.com` and `fonts.gstatic.com`.

**About and Our Story merge.** They are the same content. One About section,
positioned low, holding the story plus Kamalika's introduction.

**Page editing.** She keeps editing text, prices, facts, and photos on the four
real pages. "Add a page" is removed. In its place: "Add a coming-soon item",
which creates a carousel entry with an image, a title, a short description, and
no link. Taran builds real pages when one is genuinely needed. Rationale: the
Sunday class price and catering guest count will change and should not route
through a developer, but a general page builder is the thing that makes a
dashboard frightening to a non-technical owner.

**Storage.** Content moves to Cloudflare D1, read by the existing Worker,
rendered server-side, and written into the Cloudflare edge cache. Images move
to R2. Same Cloudflare account, no new vendor, no new bill, no idle-pause. Not
Supabase, whose free tier suspends a project after about seven days of
inactivity. Not a rented server, which trades EUR 4/month for owning OS
patching, backups, and uptime.

**Post format.** A post is a list of typed blocks. Text blocks hold markdown
strings restricted to inline syntax (bold, italic, links, inline code).
Structural blocks (image, gallery, ingredients, steps, quote, citation) are
typed records. Markdown is parsed to an AST and rendered as React elements;
raw HTML passthrough stays disabled, so the codebase keeps its property of
never handing an HTML string to React's raw-markup escape hatch. No LaTeX.

## Phase 1: brand and layout

No infrastructure change. Every item edits content or components that already
exist, which is why it goes first: it is what the PR head and Kamalika are
waiting to look at.

**Colour tokens.** The green is hardcoded in roughly 45 places across 12
components with a `#5a7349` hover partner and several opacity variants. Replace
the literals with Tailwind theme tokens (`brand`, `brand-dark`, `accent`,
`ink`, `cream`) so the next palette change is one file. This is the only
refactor in the spec and it exists because the change itself demands it.

**Type. Cut from Phase 1.** Deferred pending the licence and file. The work,
when it lands: self-host Sitka VF Italic as woff2, swap Parisienne at the three
sites in `Hero.tsx` and one in `Footer.tsx`, and regenerate favicons through
`scripts/favicons.mjs`, which draws the mark rather than loading a web font and
so needs the glyph shapes supplied to it directly.

The favicon rework is coupled to this and defers with it. Changing the favicon
to the new blue while it still carries the Parisienne letterform would mean
redoing it twice.

**Homepage order.** Phase 1 can only reorder sections that already exist, so
`sections.json` becomes: hero, atmosphere (Gallery), food, drinks, press,
about, visit. `ourStory` is renamed to `about` and keeps its six paragraphs;
Kamalika's personal introduction arrives in Phase 4.

The final order, reached across later phases, is: hero, atmosphere, food,
drinks, experiences, blog, awards, about, visit. Phase 3 inserts experiences
after drinks. Phase 4 inserts awards. Phase 5 replaces press with blog.

**Hero.** Remove the five Farfalle photos from `galleries.json`'s `heroCollage`.
The collage is a split tree, so removing five of sixteen tiles changes the
layout shape. The remaining eleven need their splits rebalanced by hand, not
just deleted.

**Cleanup.** Delete the two empty page stubs (`breads-and-dips`,
`who-we-supply`) that produce the "this section needs at least one item"
warning in `/edit`. That warning never appeared on the public site; it is an
editor-only validation message from `src/content/validate.ts`.

**Nav.** Phase 1 nav becomes Gallery, Menu, About, Stories, Visit, plus the
existing Experiences dropdown. The dropdown survives Phase 1 deliberately:
removing it before the carousel exists would strand the four real pages with no
route to them. Phase 3 replaces it with a link to the carousel, and Phase 5
renames Stories to Blog.

## Phase 2: data layer

No visible change. This is the seam every later phase sits on.

**D1 schema.** Tables for `posts`, `blocks`, `experiences`, `awards`, and a
generic `content` key-value table for the copy currently in the JSON files.
Migrations live in `worker/migrations/`.

**R2.** Bucket for uploaded images. The existing derivative pipeline
(`npm run images`) runs on upload inside the Worker rather than at build time.
Keeps the 237MB `.git` from growing further; existing history is left alone.

**Read path.** Worker route renders content to HTML, writes the response into
the Cloudflare Cache API keyed on path plus a content version, and serves from
cache on subsequent hits. A publish bumps the version, which invalidates
without needing an explicit purge.

**Fallback.** A last-known-good JSON snapshot compiles into the Worker bundle
at deploy time. If a D1 query fails or times out, the Worker serves the
snapshot. A database outage degrades freshness, never availability. This is the
piece that makes moving the menu off static acceptable.

**Write path.** `/api/publish` writes to D1 instead of committing to GitHub.
Validation moves from build time to write time, running the same
`validateContent` functions inside the Worker before any row is written.

**Undo.** Git provided this for free and D1 does not. Every write appends to a
`revisions` table holding the prior value. Undo reads the last revision and
writes it back. Depth of 20 per key, pruned on write.

**What migrates in Phase 2.** Nothing that exists today. Every current JSON
file keeps its build-time path untouched. Phase 2 proves the D1 path end to end
by putting one new, low-stakes piece of content on it, and only Phases 3
onward build real features there. The existing content migrates last, once the
path has run in production for a while.

## Phase 3: experiences carousel

Replaces the nav dropdown with a homepage section.

Each item carries an image, a title, a short description, an optional link, and
a `comingSoon` flag. Items with a link navigate to their page. Items without
one render as static cards with a Coming Soon stamp in a corner and do not
respond to clicks.

Seeded with the four real pages (Catering, Cooking Class, Membership,
Cheeseboards) plus Gifting and Retail as coming-soon items. Retail uses
`retail.png` (1430x1100), processed through the derivative pipeline.

The heading and intro copy match the wording pattern of the other homepage
sections and are editable from the Manage screen, as is every item.

Catering's page gains a photo gallery. Cooking Class gains `pamphlet.jpg` as
its hero image. Note that the pamphlet's headings are green and its
illustration style differs from the site; it works for now and should be
redesigned against the new palette later.

## Phase 4: awards and about

**Awards** becomes its own homepage section: a row of entries, each with a
title, an awarding body, a year, and an optional badge image. She adds entries
herself.

**About** already holds the six Our Story paragraphs after Phase 1's rename.
Phase 4 adds Kamalika's personal introduction and portrait, and moves the whole
section onto D1.

Awards is built on D1 from the start rather than as a JSON file that would need
migrating two months later.

## Phase 5: blog

The largest phase, deliberately last.

**Post types.** Recipe, Story, and Mention. Mention covers press coverage:
publication, date, an excerpt in her own words, and a citation with a link.
This is where the existing `press.json` lands, which is why "Latest Stories"
disappears as a separate homepage section.

**Editor.** A block editor in the Manage screen. Toolbar for bold, italic, and
links inside text blocks. A block picker for paragraph, heading, bullet list,
numbered list, image, gallery, quote, ingredients, steps, and citation. Blocks
reorder by drag or by the existing up/down buttons the dashboard already uses.

**Rendering.** Each block type is a React component. Markdown inside text
blocks parses to an AST and renders as elements. No HTML string ever reaches
the DOM.

**Routes.** `/blog` for the index with pagination, `/blog/:slug` for a post.
The existing `/blogs` route redirects to `/blog` to avoid breaking links.

**SEO.** Posts render server-side in the Worker with per-post title,
description, Open Graph image, and Article structured data.

## Phase 6: content refresh from Drive

Runs only after every earlier phase is built, tested, and verified in
production. Nothing here is architectural.

Pull the shared Via Bianca, menu, and new menu folders from Google Drive.
Examine the images. Update dishes, drinks, press, and galleries with whatever
is new. Process every image through the derivative pipeline and upload to R2.

Held to the end because it changes data, not structure, and doing it while the
schema is still moving means doing it twice.

## Testing

The existing discipline holds: every test must be able to fail, verified by
mutating the code and watching it go red. jsdom has no layout engine, so any
claim about rendering, occlusion, or gesture goes in `e2e/`.

Specific to this work:

- Contrast ratios for every colour pairing are asserted numerically, not
  eyeballed. The blue-button-with-white-text failure is exactly the class of
  bug a test catches and a screenshot does not.
- The collage rebalance after removing five tiles gets an `e2e` test asserting
  all eleven remaining photos are visible and unclipped. This repo has shipped
  invisible collage tiles before.
- D1 read path gets a test that forces a query failure and asserts the snapshot
  fallback serves.
- Cache invalidation gets a test that publishes, then reads, and asserts the
  new value, not the cached one.
- The markdown renderer gets a test feeding it script tags and image tags
  carrying inline event handlers, asserting both render as literal text.
- Undo gets a test asserting depth and pruning behaviour.

Full gate before any push: `npx tsc -b --noEmit && npm test -- --run && npx eslint .`

## Risks

**The collage rebalance is manual.** Removing five of sixteen tiles from a
split tree is not a delete; the remaining splits need proportions reassigned.
Budget real time and check it in a browser at both breakpoints.

**Free tier limits are asserted from memory.** D1 at roughly 5GB and 5M reads a
day, R2 at roughly 10GB with no egress charge. Verify against current
Cloudflare documentation before Phase 2 starts, since these move.

**The write path replaces a working one.** Publishing via GitHub commits works
today and is validated twice. Phase 2 must keep the GitHub path functional
until the D1 path is proven, then switch, rather than replacing it in place.

**Phase 5 is the whole rest of the plan again.** A block editor with ten block
types and a working toolbar is a genuinely large build. If it slips, Phases 1
through 4 have shipped and the site is better regardless.

## Open items

Deferred, blocking nothing: the Sitka VF Italic webfont licence and file, and
the favicon rework that depends on it. Both land as their own phase whenever
the file exists. Phase 1 ships without them.

Blocking nothing yet, needed before their phases: catering photographs, awards
content, a portrait of Kamalika, and whether the Coming Soon header image the
PR head mentioned is `retail.png` or a separate asset.

Deferred by decision: the cooking class booking mechanism. Stays on WhatsApp,
matching every other enquiry on the site, until a real booking service is
chosen.

Owned by Taran, unchanged by this spec: buying `viabiancadelhi.com`.
