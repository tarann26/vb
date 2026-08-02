# Phases B and C: Editing Dashboard and New Sections

**Date:** 2026-08-02
**Status:** Approved in conversation, pending written review
**Branch:** `repair/phase-a` (continues; hosting migration is the first plan)

## Context

Via Bianca is a real Italian restaurant in Greater Kailash, Delhi. Its website sat untouched for a year, during which the restaurant changed its menu, retired three mocktails, started serving breakfast and opened a bar, while the site went on advertising drinks that no longer existed and labelling dishes "Idk1".

It did not go stale through neglect. It went stale because nobody except a developer could change it.

Phases A1 and A2 (39 commits, reviewed) fixed the site and built the foundation: every editable string and asset path now lives in typed JSON under `src/content/`, validated at import by throwing guards and covered by 451 tests. Images dropped from 219MB to 3.2MB and the homepage from an unloadable weight to 1.10MB. A deploy gate runs the tests before publishing, so a bad edit cannot break the live site.

**Phase B** builds the editing surface on top of that foundation. **Phase C** adds the founder's six new business sections, authored through it.

They share one spec because C's content determines B's templates, and B's section model determines how C is built.

## Goals

1. The founder can change anything visible on the site, from a phone or a laptop, without a developer.
2. She can add new pages and sections as the business grows, without a developer.
3. A wrong edit cannot break the live site, and she is told when something fails.
4. Running cost stays at the price of the domain.
5. Nothing in the stack can be switched off for inactivity. Supabase pausing an idle project is the specific failure this design exists to avoid.

## Non-goals, decided explicitly

- **No payments, ever, on this site.** The membership booklet, the ₹4,000 kids' classes and the retail bread line all involve money, and all of them route to WhatsApp. Payments need identity, refunds, reconciliation and a different risk profile; they do not ride along with a content editor.
- **No user accounts, roles or permissions.** One shared password.
- **No analytics beyond visitor counts and one WhatsApp-click conversion count.** The two are not
  the same mechanism: visitor counts come from Cloudflare's free Web Analytics beacon, which has
  no custom-event API (verified against the real shipped beacon, not just its docs), so the
  conversion count cannot ride along on it. It is logged server-side by the Plan 3 Worker instead
  (see the Plan 1 and Plan 3 rows under Implementation plans). Nothing beyond these two is in
  scope.
- **No CMS vendor.** Content stays in the repository.
- **No server.** Nothing is rented, patched or backed up.

## Decisions

### D1. Host on Cloudflare Pages and Workers; migrate off Vercel

Free, and the free tier permits commercial use. Vercel's Hobby plan does not, which the restaurant's site is currently relying on and should be verified independently against Vercel's current terms.

Cloudflare has points of presence in India, so the site is faster in Delhi than Vercel's free tier or a European VPS. Cron triggers are included and can run more often than daily.

`vercel.json`'s SPA rewrite and cache headers move to `_redirects` and `_headers`. The build command grows an
image-generation step, per D4.

Rejected: a Hetzner VPS (~₹4,200/year) buys capacity this site has no use for and hands back OS patching, SSL renewal, backups and monitoring, with no alert when it goes down. Splitting front end and back end across two providers is worse than either alone.

### D2. Git-backed publishing, not a database

The Worker commits to GitHub; Cloudflare rebuilds. Every edit is a commit with full history and one-click rollback, the test suite gates every publish, and nothing exists that can be paused for inactivity.

The cost is that saving is not instant: roughly one to two minutes from Save to live. Accepted.

### D3. Two editing surfaces, one system

| Surface | Route | For |
|---|---|---|
| **Edit mode** | `/edit` | Replacing any visible image, rewording any visible text, dragging collage tiles |
| **Dashboard** | `/edit/manage` | Adding, removing and reordering items, pages and sections; PDFs; hours; scheduling |

Edit mode renders the real site with an editing layer, so the preview is not a preview. It reuses the **same components the public site uses**, wrapped rather than reimplemented; a second copy of the rendering would drift from the real one and defeat the purpose. The dashboard exists because you cannot hover over a dish that does not exist yet.

Both sit behind one login on their own routes. Admin code never ships in the public bundle.

Dashboard forms are **generated from the existing TypeScript types**, not hand-built per content type. This is what makes Phase C's sections editable the day they exist.

### D4. Photos are processed at build time

The Worker commits her original photo to `assets-source/` and nothing else. The build runs the existing image script.

Rejected: processing in her browser would mean hand-writing EXIF rotation a second time. Fourteen of the existing photos carry rotation tags, and getting that wrong ships sideways food photography, which is the exact bug Phase A2 Task 1 was built to prevent. It would also duplicate the pipeline in two languages, reintroducing the hole A2 closed.

Rejected: processing in the Worker is impossible; the image library is a native binary Workers cannot run.

**This simplifies rather than complicates.** Generated derivatives stop being committed, because they are derived. `scripts/__tests__/freshness.test.mjs` is deleted, since it exists only to check that committed derivatives match their sources. Builds get roughly a minute slower.

Side effect: the parked "share image is a 2.14× upscale" issue resolves itself, because she can upload a better source.

### D5. Broad image format support, with HEIC handled in the browser

Every iPhone photo is HEIC by default, and the image library's prebuilt binaries cannot read it. Today an iPhone upload would be silently skipped, the derivative would never be created, the guardrail would catch the missing file and the build would fail. Confusing failure, common cause.

| Format | Handling |
|---|---|
| JPEG, PNG, WebP, AVIF, TIFF, GIF | Uploaded as-is; the pipeline already supports all of these and only needs its extension list widened |
| HEIC / HEIF | Converted to JPEG in the browser via WASM before upload; loads only on the admin route |
| PSD, AI, PDF, anything else | Rejected immediately with a plain-English message |
| Over 25MB | Rejected with the file size before it wastes her mobile data |

**Detect by file content, not extension.** Extensions lie: `assets-source/atmosphere/dining.jpg` is PNG data with a `.jpg` name, found during A2 review. The pipeline survives it only because the library sniffs content.

Not doing: shrinking in the browser before upload. Tempting for a repository already at 400MB, but it reintroduces the rotation handling that D4 exists to single-source.

### D6. Pages contain sections; the homepage is one of them

A page has a name, a URL slug, a nav visibility flag, and an ordered list of sections. She creates pages and adds sections to them.

**The homepage is an ordered list too.** She can reorder its seven existing sections, toggle any of them off, and insert new template sections anywhere among them.

The seven existing sections stay hand-built. They are not the same shape as each other — the Hero is a 6×6 collage with a logo circle and two phone numbers over a brick texture; Our Story is two columns with an auto-advancing carousel; Drinks has three sub-groups mixing photo cards and text lists. Templating them would mean either eight templates each used once, which is the components renamed, or flattening them into five generic ones, which visibly degrades the front page.

So: bespoke sections are rendered by name, template sections by type, and both sit in the same ordered list obeying the same toggles.

**Nothing is ever deleted, only disabled.** A section or page she turns off stops rendering and disappears from the nav, but its content stays in the repository. This costs nothing, makes every removal reversible from the dashboard rather than from git, and means she can experiment without asking whether she is about to lose something. Permanent deletion, if it is ever wanted, is a developer operation.

**The existing routes stay as they are.** `/` and `/blogs` are hand-built pages that already work. `/` gains an ordered, toggleable section list per the above. `/blogs` is left alone. New pages she creates are additional routes, not replacements.

### D7. Five section templates, derived from Phase C's actual content

| Template | Built for | Also serves |
|---|---|---|
| **Text** | Membership, catering intro | Any prose block |
| **Item list** | Breads and dips, cheeseboards | Photo + name + description |
| **Gallery** | Product or venue photos | Horizontal scroller like Atmosfera |
| **Logo grid** | B2B clients | Press logos, partners |
| **Detail block** | Kids' classes | Facts plus a button |

Every template carries an optional WhatsApp button with a pre-filled message.

Two of these may merge during implementation. That is expected and fine; the list is derived from real content rather than guessed, which is the point.

### D8. Every call to action is a WhatsApp deep link

No forms, no stored contact details, no data protection obligations, and it lands where she already answers customers. Consistent with the existing "Reserve a Table" button.

Given four class spots a week and bespoke catering quotes, a human conversation is the correct mechanism regardless.

### D9. Scheduling by date, published by cron

Items and sections carry an optional `publishAt` date. The build excludes future-dated content entirely, so nothing is readable in the page source before its date. A Cloudflare cron trigger rebuilds on a schedule.

Rejected: client-side date filtering. It removes the need for a scheduled rebuild but ships unlaunched content to every visitor's browser, where anyone can read it. "Not published yet" should mean not published.

### D10. Prose moves into the content layer

Section headings, intro paragraphs and button labels are currently hardcoded in components. Two separate reviews flagged this: the content layer holds records but not prose.

All visible text moves into the content layer and becomes editable in place. Without this, she can change the data but not the site.

## Architecture

Three pieces, two of which already exist.

**The site.** A static build reading typed JSON from `src/content/`. How it renders does not change.

**A Worker.** Handles exactly three things: verify a password, commit a file to GitHub, accept a photo upload. Holds two secrets: a hashed password and a GitHub token scoped to write contents to this one repository. No database, no state between requests.

**GitHub.** Stores content, originals and history.

### Authentication

One shared password, hashed, stored as a Worker secret. Login returns a signed token in an httpOnly cookie lasting seven days. Each subsequent request carries the token; the Worker verifies the signature and does the work. No session storage, which is why nothing needs to stay running.

**Threat model, stated honestly.** One shared password means no record of who changed what, only that someone with the password did. If it leaks, someone can edit the menu. They cannot reach anything else: the token is scoped to contents on one repository, the tests still gate what publishes, and every change is a revertible commit. The realistic threat is defacement; the realistic recovery is `git revert`. Per-person logins are a later addition, not a redesign.

Login attempts are rate-limited.

### Publish flow

1. Edits accumulate in the browser, marked unsaved.
2. On Publish, the **Worker validates first**, using the same rules the test suite uses, and refuses before committing. She gets "this dish needs a name", not a broken site.
3. The Worker commits to GitHub.
4. Cloudflare builds; the tests run as the second net. **If they fail, the live site is untouched.**
5. The build stamps its commit SHA into a file the dashboard polls. It shows "publishing…" then "live", or reports failure with a link to the commit.

Step 5 exists because of step 4. Once a bad edit cannot break the site, the new failure mode is that her work silently evaporates. She must be told.

### Analytics

Cloudflare Web Analytics: free, no cookie banner required, no script tag in this repository —
enabled from the Pages dashboard, which injects its own beacon. Gives page views, referrers,
device split and per-page traffic.

The WhatsApp reservation button tap count — the single action on the site that becomes revenue —
is a separate mechanism, owned by Plan 3, not this one: Cloudflare's free Web Analytics has no
custom-event API (verified by downloading the real beacon and finding zero occurrences of
`trackEvent`), so it cannot ride along on the beacon above. It is counted server-side by the
Worker instead.

## Phase C content

| Section | Content | Template |
|---|---|---|
| **B2B** | Who Via Bianca supplies to. Client list needed from founder. | Logo grid + text |
| **Breads and dips** | Retail line, launching. Product list needed from founder. | Item list |
| **Catering** | Bespoke and curated menus to requirement, up to 100 guests, sit-downs and grazing tables. | Text + gallery |
| **Cheeseboards** | Delivery. | Item list |
| **Membership** | 100 per year. Handpicked by Chef Kamalika. Free according to visit frequency, or purchasable at a fixed price. | Text |
| **Kids' classes** | Sundays 12pm, 4 dishes, 4 kids per batch, ages 6+, ₹4,000, sibling discount separate. | Detail block |

Each starts as one page with one section and grows by adding sections. B2B in particular is expected to grow.

All six carry WhatsApp buttons.

## Implementation plans

Eight plans, each producing working software on its own.

| # | Plan | Owns | Depends on |
|---|---|---|---|
| 1 | Migrate hosting to Cloudflare | `_headers`, `_redirects`, Web Analytics (page views only). Also moves image generation into the build command and **deletes `scripts/__tests__/freshness.test.mjs`**, since derivatives stop being committed (D4). **Does not own the WhatsApp conversion count** — Cloudflare's free Web Analytics beacon has no custom-event API (verified against the real shipped beacon, not just its docs), so a client-side attempt to wire one up was built, found fictional, and removed. See Plan 3. | — |
| 2 | Content model | Prose moved out of components; the page and section model; `enabled`, `order` and `publishAt` fields; **build-time filtering of future-dated content** (D9); updated guards and tests. | — |
| 3 | Worker | Auth, signed tokens, rate limiting, content validation mirroring the test rules, GitHub commit, photo upload with HEIC conversion and format detection. **Also the scheduled-rebuild cron trigger**, which was originally assigned to Plan 1 in error: a Cloudflare cron has to run inside a Worker, and no Worker exists until this plan. **Also the WhatsApp conversion count**, moved here for the same reason: it needs server-side logging, and no server-side code exists before this plan's Worker. | 1 |
| 4 | Dashboard | Type-generated forms, list add/remove/reorder, PDF replacement, hours, scheduling UI, publish status polling. | 2, 3 |
| 5 | Edit mode | In-place image replacement and text editing on the real site. | 2, 3 |
| 6 | Collage editing | Drag to move and resize on pointer devices; tap-and-buttons on touch; Tailwind safelist and the test pinning it. | 2, 5 |
| 7 | Section templates | The five templates and the page builder. | 2, 4 |
| 8 | Phase C content | The six sections entered through the dashboard. | 7 |

Plans 1 and 2 are independent and can run in either order. Plan 6 is the most expensive single feature and the most droppable if scope needs cutting; dropping it leaves the collage editable by photo swap only.

## Risks

**Templated sections look templated.** Every section on the site today was designed for its content. As she adds template sections, the site will drift toward uniform. That is the price of her not needing a developer, and it is usually worth paying, but it is not free.

**Drag-to-resize is poor on touch.** A 6×6 grid on a 390px screen gives roughly 60px cells, and a corner handle inside that is a few pixels wide. On phones she gets tap-to-select with plus, minus and arrow buttons instead. Same data, different controls.

**Tailwind purges dynamically built class names.** The collage's grid position is currently a string like `col-start-5 col-span-2`. Making it draggable means building it from integers, and Tailwind deletes classes it does not literally find in the source. This works locally and breaks in production. A safelist plus a test pinning it is required.

**She must be online to save.** No offline drafts. For a few edits a month this is acceptable.

**Free tier terms can change.** Which is exactly why Vercel's commercial-use clause matters and should be checked rather than assumed.

## Blocked on the founder

Carried forward, unchanged:

- Eight dish confirmations, including the cappelletti-versus-cacciatora one with a ₹300 price gap
- Nine press URLs
- Authoritative opening hours; `site.json` currently claims noon to 11:30pm daily, which the breakfast menu contradicts
- Whether `linkedin.com/company/viabiancadelhi` exists
- Whether the "award-winning tiramisu" and "Michelin-starred kitchens" claims in `press.json` are accurate

New for Phase C:

- The B2B client list
- The breads and dips product list
- Photography for the new sections
