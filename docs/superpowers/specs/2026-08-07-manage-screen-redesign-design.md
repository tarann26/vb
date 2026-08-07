# Manage Screen Redesign

**Date:** 2026-08-07
**Status:** Design agreed in conversation; this document is the written form. Revised
2026-08-07 after four independent reviews (feasibility, primary-user, regression, testability).
**Branch:** `repair/phase-a` (continues)
**Surface:** `/edit/manage` (the dashboard). `/edit` is untouched by this work.

## The problem

The owner's report, in her words: the Manage screen is bland and sad. It is an infinite
scroll of identical accordions. It carries none of the brand — it could be any admin panel
for any business. And it says nothing about the state of things: whether the site is up,
when it last published, whether she has work sitting unsaved.

Her sister — the primary user, a non-technical restaurant person — should not dread opening
it.

That is a real complaint about a screen that is, mechanically, working. Every one of the ten
panels edits its file correctly. `CollapsibleSection` already folded them, which fixed the
page-height problem it was built for. What it did not fix is that ten folded headings in one
undifferentiated column is still ten decisions before the first action, still one long grey
list, and still silent about everything except the content itself.

Three things follow, and they are the whole of this work:

1. **Structure.** Ten peers become five areas, each on its own URL.
2. **State.** The screen says what is going on: last publish, whether the last publish
   actually landed, unsaved count.
3. **Brand and recognition.** The real lockup, sage and cream instead of white and grey, and
   a picture on every row that has one — so a dish is recognised rather than read.

Plus the one area that does not exist yet: Numbers.

## Decisions already made with the owner

These are settled and are not relitigated here. They are restated because the rest of the
document depends on them.

1. Primary user is the founder's sister. Non-technical. The goal is that she does not dread
   an update.
2. Device is genuinely both phone and laptop, chosen deliberately over optimising for one.
3. **Everything is equal.** She has no single dominant task, so nothing is promoted to a
   home screen of favourites and nothing is buried. All areas are peers.
4. **Shell is Approach A**: persistent left sidebar on laptop, drill-down home plus back on
   phone, same components under both, each area its own URL under `/edit/manage/`.
5. **Five areas**, regrouping the ten existing panels. The groupings themselves — including
   `hours` and `copy` sharing one area — are the owner's and are not changed here. See
   §1's naming note for what *is* changed and why.
6. Brand and state are independent of the shell: real lockup, sage `#6B8B59` and cream,
   thumbnails on image rows, a status strip.
7. Analytics is four cards, all four confirmed wanted.

## 0. Prerequisites, before any code

Two of these are outside the repository and one of them gates the correctness of a module
that has not been written yet. Doing them first is cheaper than discovering them in review.

**P0 — verify the GraphQL document by hand.** The brief confirms the dataset is *readable*
with this account's token. It does not confirm the field names §6 and §7 assume
(`refererHost`, `requestPath`, `orderBy: [sum_visits_DESC]`, a host dimension for excluding
localhost, five aliased `…Groups` nodes in one document, and the required `limit` on each
node). Run the five-alias document once against
`https://api.cloudflare.com/client/v4/graphql` before writing `worker/analytics.ts`, and
**paste the verified document into `worker/analytics.ts` as the module's own header block**,
so the file carries the thing that was actually tested rather than the thing that was
assumed. `rumPageloadEventsAdaptiveGroups` is an *adaptive*, sampled dataset, so
`sum { visits }` is an estimate — that is why §6 labels Card A "about N visits".

**P1 — the token permission.** `CLOUDFLARE_API_TOKEN` needs **Account Analytics: Read**
added. See §7's Configuration note, which reverses a recorded runbook decision and says so.

**P2 — turn Cloudflare Web Analytics auto-install OFF** for site tag
`29e1ba52fba74885a5fc44875a48a078`, in the same change that lands §8's beacon tag. Doing
these in the wrong order double-counts for the length of the gap; doing only one of them
leaves the repo and the dashboard disagreeing.

## 1. Information architecture

Ten panels become five areas. Every existing panel keeps its identity and its component; only
its address changes.

| Area | URL | Label | Panels (existing `CollapsibleSection` ids) |
|---|---|---|---|
| Menu | `/edit/manage/menu` | "Menu" | `dishes`, `drinks`, `menus` |
| Pages | `/edit/manage/pages` | "Pages" | `pages`, `sections` |
| Story & Photos | `/edit/manage/story` | "Story & Photos" | `galleries`, `story`, `press` |
| Hours & Wording | `/edit/manage/details` | "Hours & Wording" | `hours`, `copy` |
| Numbers | `/edit/manage/numbers` | "Numbers" | *(new — the four analytics cards)* |

The slug stays `details` even though the label is "Hours & Wording": the slug is a URL she may
bookmark and there is no reason to make it prettier at the cost of a redirect.

### The "Details" naming decision, and why the label changed

The first draft of this document called that area **Details** and defended it with "they are
genuinely details". That defence is false on the facts and is withdrawn.
`src/content/copy.json`'s top-level keys are `nav, hero, atmosphere, food, drinks, press,
visit, footer, blogsPage, notFound`, and `COPY_SECTION_HEADINGS` renders them as "Hero",
"Navigation", "Footer", "Menu heading". That panel is where the homepage headline, the
navigation labels and the words on the Reserve-a-Table control live. Those are not details,
and a bucket named after leftovers is the last place she would look for them.

**Decision, and the disagreement it resolves.** One review asked for `copy` to move into
**Pages**. That is a change to the owner's own grouping (decision 5), which this document does
not relitigate. What the owner agreed was the *grouping*; the word "Details" and the reasoning
behind it were this document's, not hers. So the grouping is unchanged and the label is fixed:

- The area is called **"Hours & Wording"**.
- Its description, everywhere it appears, is **"Opening hours, and the words on the homepage,
  menu and footer."**
- If the owner prefers "Details" after seeing it, that is a one-line change to `AREAS[3].label`
  in `src/admin/manage/areas.ts` and nothing else moves.

**Numbers** rather than "Analytics", unchanged: "analytics" is a word that makes a
non-technical person expect to be confused.

### Panel headings: unchanged in this work, renamed in a later commit

Panel headings stay exactly as they are for the duration of the move — "Dishes", "Drinks",
"Menus", "Pages", "Homepage sections", "Galleries", "Our Story", "Press", "Opening hours",
"Page copy" — because renaming a heading in the same commit that moves 1300 lines makes every
regression indistinguishable from a rename.

**Correction to the first draft.** It claimed the headings are "the strings …
`open-sections.ts`'s localStorage keys are built on". That is wrong.
`open-sections.ts` builds `vb:section-open:v1:<id>` from `CollapsibleSectionProps.id`, and
that prop's own comment says explicitly it is "Never derived from `heading` for that reason".
So: **renaming a heading costs nothing in stored state; changing an `id` silently forgets
every remembered fold.** The ten ids are frozen by this work and pinned by a test (§11).

Once the move has landed and is green, a **separate commit** renames three headings, which is
what the owner's own wording in decision 5 asks for:

| Today | After |
|---|---|
| Menus | Menu PDFs |
| Page copy | Words on the site |
| Homepage sections | What shows on the homepage |

The third also removes a "Pages → Pages" collision, where a child repeats its parent's name
with no breadcrumb to tell them apart (§12 rules out breadcrumbs). Ids do not change in that
commit; only the `heading` strings and the e2e/test literals that quote them.

### Why regrouping and not ranking

Ranking is the obvious alternative: put the two or three things she does most at the top and
let the rest fall below the fold. It is rejected for a specific reason, not a stylistic one.

**Ranking requires evidence this project does not have.** Decision 3 is not a preference, it
is a finding: she has no dominant task. Menus change seasonally, hours change for a holiday,
press arrives when it arrives, photos get replaced after a shoot. A ranking built without
evidence is a guess, and a wrong guess is worse than no ranking at all — it buries something
under a heading that claims to be complete.

**Regrouping is lossless; ranking is not.** Five areas is five equal doors. Nothing is
demoted, nothing is hidden behind "More". The top-level decision drops from ten to five,
which is the actual cognitive win, and it fits one phone screen without scrolling — which
ten headings, at a comfortable tap size, do not.

**The groups are the restaurant's own categories, not the file system's.** "Menu" is one
thing to her even though it is three files (`dishes.json`, `drinks.json`, `menus.json`) and
one of them is PDFs. "Story & Photos" is one thing even though it is three. The current
screen exposes the file boundaries, which is exactly why it reads as a developer's tool.

### The first panel in each area opens by itself, once

Without this, the phone flow on a fresh device is home (five rows) → area (three folded
headings) → content: five decisions replaced by five, then three. `loadSectionOpen` defaults
to closed, which is right, and this does not change that default.

**Mechanism, and why it is not a change to the fold contract.** `saveSectionOpen` *removes*
the key when a section is closed, so "never opened" and "deliberately closed" are the same
stored state — a naive `defaultOpen` would re-open, every reload, a panel she keeps closing.
Instead, `open-sections.ts` gains two small additive functions and **`loadSectionOpen` and
`saveSectionOpen` are not modified at all**:

```
hasSeededArea(slug, storage?): boolean      // reads vb:area-seeded:v1:<slug>
markAreaSeeded(slug, storage?): void        // writes it, never throws
```

Each area module, on its first render only, checks `hasSeededArea(slug)`; if false it calls
`saveSectionOpen(firstPanelId, true)` and `markAreaSeeded(slug)`. After that the ordinary
contract applies untouched, and closing that panel is remembered exactly as it is today.
`CollapsibleSection` is not touched. The seed key is per-area so it can be reasoned about
independently of the ten section keys.

## 2. The responsive shell

### One breakpoint: 1024px (Tailwind's large-screen breakpoint)

Not the medium one at 768px. The content column is 768px wide today and the forms inside it
are already tight at that width on the panels that show two fields per row. A 224px sidebar
plus that column plus gutters needs roughly 1000px before either has to give. At 768–1023px
the sidebar would squeeze the forms; below 1024 the phone layout is simply better. One
breakpoint, chosen by the content, not by a device category.

### Laptop, ≥1024px

```
┌──────────────────────────────────────────────────────────────┐
│  Via Bianca              Last published 2h ago · Site is live │
│  Pastificio & Ristorante Dishes and Opening hours have        │
│                          changes you haven't published yet    │
│                          View the published site ↗            │
├──────────────┬───────────────────────────────────────────────┤
│  Menu        │                                               │
│   Dishes,... │   (the current area's panels, unchanged)      │
│  Pages       │                                               │
│   The six... │                                               │
│  Story &     │                                               │
│    Photos    │                                               │
│  Hours &     │                                               │
│    Wording   │                                               │
│  Numbers     │   [ Publish ]                                 │
└──────────────┴───────────────────────────────────────────────┘
```

The sidebar is persistent and always shows all five. **Each item shows its label and, under
it in smaller muted type, the same one-line description the phone home shows** — the same
`AREAS[].description` string, from the same component. The first draft discarded descriptions
on the device with the most room for them while arguing in the same paragraph that they exist
because the grouping is new to her; that was inconsistent and is fixed.

The current item is marked with `aria-current="page"` and a sage left rule — never by removing
it from the list, and never by disabling its link. The sidebar scrolls with the page rather
than being fixed-position: a fixed sidebar on a laptop with a short viewport is how controls
end up unreachable, and this repo has already shipped a control painted under a fixed,
high-stacking-order bar once (see `e2e/edit-dashboard-link.spec.ts`'s own comment).

### Phone, <1024px

**Bare `/edit/manage` is the home**, and it renders **inside the shell**: lockup, status strip,
publish bar, then five rows. Each row is a full-width tap target with the area name and its
one-line description ("Dishes, drinks and the PDF menus"). Descriptions exist because the
grouping is new to her and an area name alone does not describe itself.

**The publish bar is on the home screen too, deliberately.** It is the single `<form>` every
section's fields submit into and it is mounted exactly once (§9); excluding home from it would
mean the one screen she lands on is the one screen with no unsaved indicator and no way to
publish.

**Header budget at 390px.** So that "all five rows without scrolling" is achievable by design
rather than by luck, the header is capped: lockup at most two lines, the status strip **one
line on phone** (it truncates with an ellipsis and keeps the full text in `title`), the publish
bar its existing single row. Against a 390×844 viewport that leaves well over 400px for five
rows at a comfortable tap size. The e2e assertion (§11) is written at 390×844 explicitly, not
at "390 wide, any height".

**An area screen** is the header, the status strip, a back control, the area title, and that
area's panels. No sidebar. The back control is a real `<Link to="/edit/manage">`, labelled
"← All areas" — not `history.back()`, which does the wrong thing when she arrived at the area
from a bookmark, from `/edit`, or after a reload.

### How the two share components

One `AREAS` constant (`src/admin/manage/areas.ts`) — slug, label, description, and the panel
ids it contains — is the single source of truth for the sidebar, the phone home list, the
route matching, and the tests. Nothing else enumerates the five.

`AreaNav` is one component with a `variant: 'sidebar' | 'list'` prop. Same links, same order,
same `aria-current`, same descriptions; only the chrome differs.

Deliberately **not** two navs rendered together, one shown only at large widths and the other
only below them. That duplicates every link in the accessibility tree and in every `getByRole`
query, and it is a class of bug this repo has hit before in a different form. It is also
unnecessary here: the phone list only ever exists at the bare URL and the sidebar only ever
exists at ≥1024px, so **at most one** nav is in the DOM at any moment — one at ≥1024px
everywhere, one at the bare URL below it, and none on a phone area screen, which has the back
control instead.

> **Comment hygiene, and it is not optional.** Tailwind's scanner is a plain text extractor
> with no HTML or JS parser behind it, and this repo has shipped bogus CSS out of a comment
> twice. Any source comment restating the paragraph above must spell the breakpoint
> arrangement as prose ("shown only at the large breakpoint"), never as a bare
> utility-class-shaped token. The rule-level built-stylesheet diff required by §8 and §11
> covers the new shell files, not only `index.html`.

Everything below the nav — every panel, every field, `PublishBar`, `CollapsibleSection` — is
literally the same component tree at both widths. The shell is the only thing that branches.

## 3. Routing

`src/App.tsx` does not change. It already routes `/edit/manage/*` to the lazily-loaded
`AdminApp` (a descendant-route wildcard, which is what makes everything below possible).

| URL | Result |
|---|---|
| `/edit/manage` (≥1024px) | `<Navigate replace to="/edit/manage/menu" />` |
| `/edit/manage` (<1024px) | The home list |
| `/edit/manage/` | Identical to the above (trailing slash normalised before matching) |
| `/edit/manage/menu` … `/numbers` | That area is visible; the other four are `hidden` |
| `/edit/manage/anything-else` | Area-not-found content, inside the shell; all five areas `hidden` |

**Why the bare URL differs by width.** On laptop there is no home screen to show — the
sidebar *is* the home, permanently, and a laptop home screen would be a second copy of it two
clicks deep. On phone the home screen is the whole of Approach A's drill-down. So the bare URL
resolves to whichever of those the viewport actually has. The redirect is `replace`, so
pressing Back from `/edit/manage/menu` returns to wherever she came from rather than bouncing
through the redirect again.

**The width is read once**, with `window.matchMedia('(min-width: 1024px)').matches`, in a lazy
`useState` initializer — synchronously on first render, so there is no flash of the wrong
layout. **Accepted consequence, stated so it is not discovered as a bug:** a laptop window
narrowed below 1024px, or a tablet rotated, keeps whichever branch it started in until the
page is reloaded. This affects only which screen the *bare* URL resolves to; every area URL
renders correctly at every width, and the sidebar-versus-no-sidebar chrome is CSS and does
respond to a resize. Re-reading the media query on change would mean a resize could yank her
from an area screen back to a home list mid-edit, which is worse. A consequence for tests: e2e
specs must set the viewport **before** `page.goto`, never after.

`/edit` links to `/edit/manage` today and keeps doing so; `e2e/edit-dashboard-link.spec.ts` is
unaffected.

**An unknown slug** renders inside the shell — header, status strip, sidebar (on laptop) all
still standing — with a short message and links to the five areas. Three things it is not:

- Not a redirect to Menu. A stale bookmark or a typo would then silently become a working URL
  and she would never learn the address she saved is wrong.
- Not the site-wide `<NotFound />`. That renders the public `Navbar` and `Footer` — the
  restaurant's own 404 page, which inside a logged-in tool reads as "you have been thrown out".
- Not a blank screen. The shell staying up is what makes the mistake recoverable in one tap.

There is no HTTP status to set; the SPA catch-all serves `index.html` at 200 for every route
already.

**Login is unchanged and sits above all of this.** `AdminApp`'s `useSession` gate wraps the
shell, so an unauthenticated hit on `/edit/manage/numbers` shows `<Login>` and, after logging
in, lands on `/edit/manage/numbers` — the router state was never touched.
`src/test/routing.test.tsx`'s "shows the login form" case is unaffected.

### The one thing routing must not break: areas mount once and stay mounted

This is the most important implementation constraint in this document.

Each panel holds its own fetched data in local React state, and its load effect calls
`registerLoaded` (`AdminApp.tsx`), which calls `registry.register(file, loaded.data, loaded.sha)`.
`register` overwrites the entry's `data` unconditionally — that is its documented contract
(`src/admin/publish.ts`), and it is correct for the load path it was written for.

If navigating from Menu to Pages **unmounted** the Menu panels, then navigating back would
remount them, re-fetch, and call `register` with the *server* value — silently destroying an
unpublished edit she made two minutes ago. That is the exact vanishing-edit failure
`CollapsibleSection.tsx`'s decision #1 was written to prevent for folding, and this design
would reintroduce it one level up.

**So: all five areas are mounted from the first render, and the route selects which one is
visible using the `hidden` attribute** — the same mechanism, and the same reasoning, folding
already uses. Route changes are a visibility toggle. Nothing re-fetches, nothing re-registers,
nothing is lost.

**The mechanism, spelled out, because the first draft contradicted itself here.** It said
areas must stay mounted and, three sections later, gave `ManageShell` an `<Outlet/>` and
`AdminApp` a nested `<Routes>` for the five areas. `<Routes>` and `<Outlet/>` render **only**
the matched child; every sibling area unmounts on navigation, which is precisely the failure
this section forbids. That is withdrawn. Concretely:

- **There is no nested `<Routes>`, no `<Outlet/>`, and no area is ever the child of a
  `<Route element>` of its own.**
- `ManageShell` derives the active slug from `useLocation().pathname` (strip the
  `/edit/manage` prefix and any trailing slash; empty string means the bare URL). It does not
  need `useParams`.
- `ManageShell` renders all five area components unconditionally, inside `PublishBar`, each
  wrapped in `<div hidden={slug !== areaSlug}>`.
- An empty slug therefore hides all five areas, and so does an unrecognised one. `AreaHome`
  renders alongside them when the slug is empty and the viewport is below 1024px;
  `AreaNotFound` renders alongside them when the slug is non-empty and matches no area.
- The bare-URL redirect at ≥1024px is a conditionally rendered `<Navigate replace/>` element,
  not a route.
- Navigation is `<Link>`, so `useLocation` updates and the `hidden` flags flip. React
  reconciles the same element tree; nothing remounts.

**`hidden` means the HTML attribute, and nothing on that element may override it.** Not a
CSS utility class that happens to be spelled the same. jsdom loads no CSS, so
`getByRole`'s refusal to match inside a hidden subtree — which is the mechanism every §11
visibility assertion rides on, and which `AdminApp.test.tsx`'s own comment already records —
only holds for the attribute. And in a real browser, any display-setting utility on the same
element silently defeats the user-agent rule for `[hidden]`. Hard constraint: the attribute,
and no display utility on the element carrying it. Pinned in jsdom **and** in real Chromium
(§11).

Consequences, all of them acceptable and stated so nobody "optimises" them away:

- Every content file is fetched once on first load, exactly as today. No change in requests.
- Hidden panels are inside `hidden` containers, so their thumbnails are not fetched. This is a
  claim about a real browser, so it is tested in a real browser (§11) rather than asserted here.
- Hidden content is not focusable and is excluded from the accessibility tree, so tab order
  and `getByRole` queries see only the visible area. Tests must use role queries, not raw text
  queries, which is already this repo's convention. **This also hides problem markers**, which
  is why §10 adds an area-level marker.
- The shared registry, `restoreDraft`, `stage`, `stagedFiles`, `previews` and `publishLocked`
  all live in `AdminApp` above the shell and are untouched by navigation. They reach the five
  area modules as **props, drilled through `ManageShell`** — not a context. A context buys
  nothing here: `useContentRegistry` bumps its `version` on every `updateData`, so the whole
  tree re-renders on every keystroke either way, and props keep the dependency visible in the
  type system where a completeness test can see it.
- **Numbers is the exception to "fetch on mount".** Under mount-and-hide there is no mount
  event to hang it on, and `IntersectionObserver` neither fires for a hidden ancestor nor
  exists in jsdom. So `NumbersArea` takes an explicit `active: boolean` prop (true exactly when
  it is the visible area) and a `useRef` latch: the request fires on the first render where
  `active` is true and never again in that session. A Cloudflare API call on every dashboard
  load, for a screen she may not open, is not free and is not needed.

If a future change genuinely needs areas to unmount (per-area code splitting, say), the
prerequisite is making `registerLoaded` registry-first — reading the existing entry instead of
overwriting it — with its own tests. That is a separate, deliberate change. It is not part of
this work.

### The draft restore gate stays exactly where it is

`AdminApp` today renders `<DraftBanner>` **instead of** `PublishBar` and instead of all ten
panels while `pendingDraft !== null`. That ternary is not layout — it is the structural
enforcement of "never auto-apply a draft" (the module's own comment), and it is load-bearing:
if panels mounted before she answered Restore or Discard, each would fetch, `registerLoaded`
would register the clean server value, the dirty-draft map would come back empty, and
`PublishBar`'s persistence effect would reach `else if (!holdDraftClear) clearDraft(...)` and
**permanently delete the draft she was about to be offered**. `AdminApp` does not pass
`holdDraftClear` at all; only `EditMode` does. The ternary is its protection.

**Requirement.** `ManageShell` renders `<DraftBanner>` in place of `PublishBar` *and* in place
of all five areas whenever `pendingDraft !== null`, unchanged from today. The areas must not
mount until she has answered. If that ordering is ever relaxed, for any reason,
`holdDraftClear={pendingDraft !== null}` must be passed to `PublishBar`, matching `EditMode`.
The existing `AdminApp.test.tsx` case that covers this survives the move rather than being
rewritten away, and §11 adds an explicit one.

**The cross-surface draft notice moves with it.** `AdminApp` renders "You also have
unpublished changes saved on the live-page editor (/edit) — untouched by anything you do
here," gated on `otherSurfaceDraftExists`. It is the only thing that tells her an `/edit` draft
exists at all, and two existing tests pin it. It lands in `ManageShell`, above the status
strip, on every area and at both widths.

## 4. The status strip

One horizontal strip under the lockup, in the header, present on **every area, on the phone
home, on the not-found screen**, and at both widths. Three signals and one link. Nothing else
— this is a strip, not a dashboard.

| Signal | Source | Reads |
|---|---|---|
| Unsaved changes | dirty files + `stagedFiles` count, via `stripSummary()` (`src/admin/publish-summary.ts`) | "Dishes and Opening hours have changes you haven't published yet · 1 photo waiting" / "Nothing waiting to be published" |
| Last publish | `builtAt` from `fetchBuildInfo()` (`src/admin/publish.ts` → `/build-info.json`) | "Last published 2 hours ago" (absolute time in `title`) |
| Did it land | `builtAt` movement + the publish phase reported by `PublishBar` | "Publishing your changes — usually 2–3 minutes" / "Published just now" / "Your last update hasn't gone live yet — it's been 12 minutes" |
| View site | `site.seo.url` (`src/content/site.json`, `https://vb.aionxxxi.uk` today) | "View site ↗" / "View the published site ↗" — see below |

### The unsaved sentence: two functions, and which one owns which words

The first draft said the strip reuses `summaryMessage()` and quoted strings that function does
not produce. The real function returns `'No changes to publish yet.'` at zero and
`'2 sections edited, 1 file staged — ready to publish.'` otherwise. It also said that function
renders "at the bottom of the page"; it does not — `PublishBar` renders its bar `<div>`
**before** `{children}`, so the bar is above the sections and, once `PublishBar` wraps the
whole shell, would sit a couple of inches from the strip. Two near-identical sentences that
differ only in a trailing clause read as a bug. Both claims are corrected, and the split is:

`summaryMessage` lifts to **`src/admin/publish-summary.ts`** as two exported functions:

- **`barSummary(dirtyCount, stagedCount)`** — byte-identical to today's `summaryMessage`,
  including "— ready to publish.". `PublishBar` calls this and its own 1628-line test file
  stays green unchanged. The bar owns the sentence that is *about the action*, next to the
  button that performs it.
- **`stripSummary(dirtyFiles, stagedCount)`** — takes the dirty **file names**, not a count,
  and renders them through the existing `CONTENT_FILE_LABELS` map (`src/admin/content.ts`) that
  the publish confirmation dialog already uses. The strip owns the sentence that is *about
  state*. "Section" is a component name and "staged" is a git word; neither is hers. At zero it
  reads "Nothing waiting to be published" — never blank, because blank is indistinguishable
  from broken.

Because one names files and the other counts sections, the two sentences cannot be mistaken
for a duplicated string.

**And the areas holding unsaved work carry a dot in `AreaNav`.** The count alone is the least
useful form once areas can hide each other: it tells her something is unsaved without telling
her where, and the question she actually has after tapping Pages is "did the thing I typed in
Menu survive?". The dot is derived from the same dirty-file set, mapped to areas through
`AREAS[].panelIds` and the panel→file mapping in `areas.ts`.

### "View site", and why its label moves

A permanent "View site ↗" beside "you have unpublished changes" invites her to tap it, see the
published site without her work on it, and conclude the work is gone.

- Unsaved count is zero → **"View site ↗"**, new tab, `rel="noopener"`.
- Unsaved count is non-zero → **"View the published site ↗"** with a half-line beneath:
  "your unpublished changes aren't on it yet."

### Last publish, and the liveness signal that can actually be false

Both come from `/build-info.json`. It is a static file Vite stamps on every *successful* build
(`plugins/build-info.ts`), served `no-store` by `public/_headers`, already fetched by
`fetchBuildInfo()` with a full parse guard. The strip polls it on mount, on window focus, and
every 60 seconds while the tab is visible; polling stops when the tab is hidden.

That poll is deliberately cheap and deliberately not `/api/build-status`. `/build-info.json` is
a ~60-byte static asset on Pages: no Worker invocation, no KV, no rate limiter, no Cloudflare
API call. `/api/build-status` is none of those things — it makes a real Cloudflare REST call
per request — and `PublishBar` already polls it, correctly, with backoff and a timeout, during
and after a publish. A second poller against it would double that cost to re-derive a state
already rendered three inches away.

**A plain green "Site is live" pill is withdrawn.** Its only evidence was "the fetch of a
static asset from this origin succeeded" — but if that origin were not serving, the dashboard
she is looking at would not have rendered either. It is a green light wired to a switch that is
always on: it would say "Site is live" through a failed build and through a JS error that
blanked the public homepage. A permanently-green indicator is worse than none, because it
teaches her to ignore the strip, and the strip is this redesign's answer to "it says nothing
about the state of things".

Owner decision 6 asks the strip to say whether the site is live, and it still does — from a
signal that can be false. `builtAt` moves **only on a successful build**, so:

- No publish outstanding, `fetchBuildInfo` succeeding → **"Site is live"**.
- A publish is in flight or its build has not landed → the publishing sentence below.
- A publish completed more than **5 minutes** ago and `builtAt` has not moved → **"Your last
  update hasn't gone live yet — it's been 12 minutes."** That is the real failure signal, it is
  the one she needs, and it is the one the old pill could never give.

### The publish window is one statement in one place

The first draft accepted that, for the 1–2 minutes after she pressed Publish, the strip would
read "Site is live · last published 2 hours ago" while the publish bar said "building", and
called it "two honest statements, no contradiction". From her chair, immediately after pressing
Publish, that is a flat contradiction whose obvious reading is "my publish didn't take" — at
exactly the moment this redesign exists to make calm. Withdrawn.

`PublishBar` already runs `trackPublish` with backoff through the whole build. It gains **one
additive optional prop, `onPhaseChange?: (phase) => void`**, alongside the `onPublishLockChange`
it already has; `ManageShell` holds that phase and the strip renders from it. This is an added
callback, not a rewrite of `PublishBar` (§12). For the whole window the strip reads
**"Publishing your changes — usually 2–3 minutes"**, and flips to **"Published just now"** when
`builtAt` moves. One statement, one place.

The observed build is 1–2 minutes; the sentence says 2–3 deliberately. An estimate that runs
short turns every ordinary build into a late one, and the whole point of this line is that
waiting feels normal. The 5-minute "hasn't gone live yet" threshold above sits above both
numbers for the same reason.

### The remaining states

- `fetchBuildInfo` returns `{ kind: 'error' }` (offline, 404, unparseable body): "Couldn't
  check when the site last updated." It does not show a stale cached time and it does not
  guess. It also does not claim the site is down — a failed fetch from her phone on a bad
  connection is not evidence about the site.
- `builtAt` parses but is **in the future**: "Last published — time unknown". A nonsense
  relative time ("in 3 hours") is worse than admitting the gap.
- `sha` is the literal `'unknown'` (`resolveCommitSha`'s last-resort value): the time is still
  shown normally. **Corrected from the first draft**, which collapsed this into the
  future-`builtAt` branch; a missing sha says nothing whatsoever about a timestamp, and the two
  are tested as separate cases.

### Accessibility

The strip carries `aria-label="Site status"`, and every test queries it by that name rather
than by role alone: `CollapsibleSection` already renders `role="status"` for a folded section
with a problem, and with all five areas mounted several of those can exist at once, so
`getByRole('status')` is ambiguous by construction.

**The live region is scoped, not wrapped around the whole strip.** Only the parts whose change
is worth announcing — the publish phase and the unsaved sentence — sit inside
`aria-live="polite"`. The relative timestamp is rendered in a sibling **outside** it, because a
strip that is entirely live re-announces itself every 60 seconds when "2 hours ago" becomes
"3 hours ago".

## 5. Thumbnails

**Rows that get one** — every row type whose content model already has an image path — and the
component that actually renders that row, because §9 has to put each of them in scope:

| Row | Field | Rendered by |
|---|---|---|
| Dishes | `Dish.image` (always a string) | `RecordList.tsx` |
| Drinks | `Drink.image` (`string \| null`) | `RecordList.tsx` |
| Press | `Article.image` | `RecordList.tsx` |
| Galleries — atmosphere and Our Story | `GalleryImage.src` | `GalleryList.tsx` |
| Template item-list rows | `TemplateListItem.image` | `TemplateContentForm.tsx` |
| Template gallery images | `GalleryImage.src` | `TemplateContentForm.tsx` |

**Rows that do not, and why:**

- **Menus.** They are PDFs. Rendering a first page needs `pdf.js` in the admin bundle for a
  48px picture. A file glyph next to a label that already says "Food menu" adds nothing.
- **Pages, Homepage sections, Opening hours, Page copy, Our Story prose.** No image field
  exists. A placeholder box on a row that can never hold an image is decoration, and
  decoration on a row that means nothing is exactly the "bland" complaint in miniature.
  `PageList.tsx` and `TemplateSectionList.tsx` are therefore **not** in scope.
- **The hero collage.** Not a list of rows; it has its own editor showing the real photographs
  at real size already.

**Rendering.** One shared `<Thumbnail />` component so the precedence and fallback rules exist
once:

- 48×48, cover-fitted, rounded, thin sage-tinted border, lazily loaded, `alt=""` — empty alt
  because the row's own text names the item, and a thumbnail alt would have a screen reader
  announce the dish twice.
- **Missing path** (`null` or empty string): a neutral 48px placeholder — cream fill, sage
  border, no icon — with `aria-hidden`. The row stays fully usable and the column stays
  aligned. Not a browser broken-image glyph, and not nothing: collapsing the box makes the
  rows ragged, which reads as broken.
- **Path present, file 404s** (a just-published photo the CDN has not caught up with, a path
  hand-edited to something wrong): `onError` swaps to the same placeholder, **once**, with a
  flag so it never retries in a loop.

### A staged photo wins over the content path — and the store it reads

She has just picked a photo; its object URL must show immediately, because the content path
`PhotoField` optimistically wrote has no file behind it until the build finishes and rendering
it would show a broken image for two minutes.

**The first draft said `Thumbnail` "reuses that store". There is no store on this surface.**
`PhotoField` holds `previewUrl` in component-local `useState` and revokes it from a ref on
unmount; the one shared store, `useImagePreviews` (`src/admin/previews.ts`), is imported only
by `EditMode` and `CollageEditor` — the `/edit` surface. And building a `data:` URI from
`stagedFiles`' base64 is not an option either: `public/_headers` sets `img-src 'self' blob:`,
with no `data:`, so the shipped policy refuses it.

**Decision: lift the existing store, do not invent a second one.**

- `AdminApp` calls `useImagePreviews()` once and passes the resulting `ImagePreviews` down
  through `ManageShell` alongside `stage`.
- `PhotoField` gains **one additive optional prop**, `previews?: ImagePreviews`, defaulting to
  the already-exported `NO_IMAGE_PREVIEWS`. When given one it writes its object URL there in
  addition to its local state, keyed by **the same string it stages under** — `${file}:${itemId}:${fieldKey}`
  for a record, `${file}:${listName}:${index}:src` for a gallery image (the two shapes
  `staged.ts` already documents). Nothing else in `PhotoField` moves, and its revoke behaviour
  is unchanged.
- `Thumbnail` takes that key, reads `previews.urls[key] ?? path`, and owns no lifetime of its
  own. One revoke rule, in the one place that already had it.
- `PhotoField` therefore comes **off** §9's do-not-touch list.

Rejected alternatives, recorded: (a) `Thumbnail` deriving its own object URL from
`stagedFiles` — smaller, but it puts the revoke rule in two places, which is how the leak in
`previews.ts`'s own header comment happened; (b) dropping staged precedence and showing the
placeholder until the build lands — cheapest, but "I picked a photo and nothing happened for
two minutes" is the exact anxiety this redesign exists to remove; (c) `data:` URIs — refused by
the shipped CSP. Whichever is built, `npm run test:csp` verifies it rather than assuming.

**Bandwidth.** There is no width-derivative pipeline in `public/` — `public/food/*.webp` are
single files at full size. That is fine at this scale: 15 dishes at ~40KB is ~620KB for the
whole food directory, and only one area is visible at a time with lazy loading on top. This
work does **not** add an image pipeline for 48px squares.

## 6. The four analytics cards

All four read one `GET /api/analytics` response. One request, one loading state, one error
state, four cards — not four routes and not four spinners.

Windows are fixed and stated in the copy. There is no date picker.

**Admin traffic is excluded** from every number on this screen (see §8), and the area says so
once, quietly: "your own editing visits aren't counted."

### One banner above the four cards, for the state it launches in

Four independent grey empty messages stacked vertically read as four things wrong, not one
thing early. So the zero/near-zero state is framed **once**, at the top of Numbers, above all
four cards:

> **Visitor counting started on 12 August 2026.** There isn't enough data yet — this fills in
> over the next week or two. Nothing is wrong with your website.

Every date in this section's copy, here and in Card A, is an **illustration**. The one real
source is **`COUNTING_STARTED_ON`, an exported constant** in `src/admin/manage/analytics.ts`,
set to the day §8's beacon commit lands. It is never a hand-typed literal in copy, it is
formatted for display by one function, and it is pinned by a test so it cannot silently drift
from the day the beacon actually shipped. The banner shows while the response reports zero visits
across the whole 28-day window; the four cards below are muted rather than each re-explaining
the same thing.

### The loading state

Numbers is fetched on first visibility against a Worker call with a 10-second timeout, so the
first tap in any session will show *something* before it shows numbers. That something is
**four skeleton cards with their real headings already visible** — never a bare spinner, never
four spinners. On laptop the fetch may additionally be started on hover or keyboard focus of
the Numbers nav item, which usually hides the wait entirely; that is an optimisation, not a
requirement, and the latch in §3 makes it safe to fire early.

### Card A — "How many visits, and how many tapped Reserve a Table?"

The first draft asked about "people" in the heading and then insisted the number is labelled
"visits, not people" two lines below. Fixed: the heading says visits, because that is what the
number is.

Two numbers side by side and the relationship between them, over the last 28 days.

- **Visits**: Cloudflare GraphQL `rumPageloadEventsAdaptiveGroups`, `sum { visits }`, filtered
  by site tag and the date range, admin paths excluded. Rendered as **"about 4,100 visits"** —
  the dataset is adaptive and sampled, so the number is an estimate and says so.
- **Booking taps**: **not Cloudflare.** Cloudflare's free Web Analytics beacon has no
  custom-event API — verified against the real shipped beacon, not its docs — which is why
  `POST /api/wa` exists at all. The number comes from the `wa:counts` KV key
  (`{ "<IST date>": count }`). That module states the number is a **lower bound**, not a count:
  origin-checked, rate-limited, capped per day, and delivered by fire-and-forget `sendBeacon`.
  Its response carries `lowerBound: true` specifically so the dashboard cannot forget. The card
  says **"at least 41 tapped Reserve a Table"** and carries a one-line caveat. It never says
  "41 bookings".
- **Both numbers cover the same 28 days.** See §7: only the last 28 IST dates of `wa:counts`
  are summed. The first draft would have put an all-time numerator beside a 28-day denominator,
  so the "ratio" would have risen forever even as traffic fell.
- **The relationship, in the way a person says it**: "About 1 in 8 visits ended in a tap on
  Reserve a Table." Not "13.1%" — a decimal implies a precision that a sampled estimate divided
  by a self-declared lower bound does not have, and a bare percentage gives her no anchor for
  whether it is good. Rendered **only when visits > 0** and both series have at least 7 days of
  data. Otherwise the row is absent — not "0%", not "—", not `NaN`.
- **Zero visits is one card state, not two numbers.** Taps come from KV and have been
  accumulating since the counter shipped, so before the beacon lands the honest render is a
  real number beside a zero, inside a layout built for comparing them — which is the definition
  of "this screen is broken". So when visits are zero the card does not lay them side by side.
  It says, once:
  > We haven't started counting visits yet. 41 people have tapped Reserve a Table since
  > 12 August.

### Card B — "Which pages did people look at?"

A ranked list, last 28 days. This is the card that answers whether catering or cheeseboards is
landing.

- `rumPageloadEventsAdaptiveGroups`, dimension `requestPath`, ordered by visits descending,
  `limit: 10`, admin paths excluded.
- **Path → name translation is a pure exported function**, `labelForPath(path, pages)`, in
  `src/admin/manage/analytics.ts` — extracted precisely so it can be table-tested, because it
  is the whole point of the card. Rules, in order:
  1. Strip any query string and any trailing slash (except for `/` itself).
  2. `/` → "Homepage"; `/blogs` → "Press".
  3. A leading-slash match against a `pages.json` `slug` → that page's `name` (today:
     catering, cheeseboards, cooking-class, membership, breads-and-dips, who-we-supply).
  4. No match → the raw path, unchanged. Honest, and it is how she would notice a page she
     forgot she made.
- **Zero data**: "Nothing to rank yet — this fills in once people start visiting."

### Card C — "Where did people come from?"

Buckets, last 28 days, largest first.

- Dimension `refererHost`.
- **Bucketing happens in the Worker, not the browser**, so the rule is one implementation with
  one set of tests in `worker/__tests__/`. Strip a leading `www.` or `l.`, then split the host
  on `.`:
  - empty, **or equal to the host of the incoming request's own URL** → **"Typed it in or used
    a bookmark"**
  - a label equal to `instagram` → **"Instagram"**
  - a label equal to `google` → **"Google"**
  - anything else → its own host, grouped under **"Other links"** with the host in smaller
    text, top 5
- **"The site's own host" is the incoming request's URL host**, not a `[vars]` entry and not
  `site.seo.url`. The Worker is routed on `vb.aionxxxi.uk` today and will be routed on
  `viabiancadelhi.com` after the move; reading it from the request means the rule follows the
  domain without a second thing to remember to change. It varies by preview deploy, which is
  the correct behaviour: on a preview, that preview's own host *is* self-referral.
- This is a display heuristic and is documented as one. Accepted, deliberate mis-buckets,
  written down so they are decisions rather than surprises: `com.google.android.gm` → Google
  (it is Gmail, and calling it Google is close enough for her); `t.co` → Other links (it is
  Twitter/X, and no bucket exists for it); `l.instagram.com` and `www.instagram.com` →
  Instagram; empty string → Typed it in or used a bookmark. The alternative to the heuristic (a
  public-suffix list in a Worker) is a large dependency for a four-row card.
- **Zero data**: "Nothing yet — this will show whether people found you through Instagram,
  Google, or by typing your address in." (The first draft's "No referrers yet" used the exact
  word this copy is supposed to avoid.)

### Card D — "Busier or quieter than usual?"

One sentence. No chart. The owner's stated requirement is plain words rather than something to
interpret.

- Two windows from the same dataset: the last 7 days and the 7 days before that.
- Copy: "Busier than the week before — 312 visits, up from 240." / "Quieter than the week
  before — 180 visits, down from 240." / "About the same as the week before — 248 visits."
- **Threshold, stated as the comparator so a test author cannot write it two ways.** Let
  `change = (thisWeek - priorWeek) / priorWeek`. `change >= 0.15` → busier. `change <= -0.15` →
  quieter. Everything strictly between → about the same. So exactly ±15% is busier/quieter, and
  ±14.9% is about the same. A small restaurant's week-to-week traffic moves several percent on
  noise alone, and a card that shouts "busier!" at +4% teaches her to ignore it.
- **One guard rail, not two.** `priorWeekVisits >= 20`; below it the card says "Not enough
  history yet — this needs two full weeks to compare." A 3-visit week followed by a 6-visit
  week is +100% and means nothing. The first draft also required "14 days of data", which is
  **not derivable from anything the query returns** — a query over a fixed 14-day window
  returns totals and cannot tell you the beacon only started three days ago — so it had no
  implementation and therefore no possible test. Withdrawn. The counting-started banner above
  the cards already carries the "it is early" message that condition was reaching for.
- **Zero data**: the same "not enough history yet" sentence. This is the state it launches in
  and will stay in for two weeks.

### What all four render at launch

Zero. The dataset returned an empty array today. Every card's empty state is therefore the
state it ships in, must be designed first, and must read as "too early" rather than "broken" —
that distinction is the entire difference between her trusting this screen and her deciding it
does not work.

## 7. The Worker route

`GET /api/analytics`, in a new `worker/analytics.ts`, following the shape of `worker/status.ts`
rather than inventing a second pattern.

**No query parameters at all.** The windows are fixed in the module. A caller-supplied range
would be an unbounded cache-key space, and therefore an unbounded number of upstream calls,
behind an endpoint whose entire load control is a single cache entry. `?days=90` produces the
same cache key, the same upstream call and the same body as the bare URL, and that is pinned.

**Auth.** The same gate as every other admin route:

```
const token = parseCookie(request.headers.get('Cookie'), 'vb_session');
if (!token || !(await verifyToken(env.TOKEN_SECRET, env.ADMIN_PASSWORD_HASH, token, now))) → 401
```

Checked **before the cache is consulted**, so a cached body can never be served to an
unauthenticated caller.

**Session sliding: yes.** The path is added to `AUTHENTICATED_PATHS` and routed through
`withSlidingSession`, exactly like `GET /api/content` and `GET /api/build-status`. Reading
Numbers is her using the tool; a route that authenticates but does not slide would log her out
mid-read of the one screen she is only reading. `worker/__tests__/index.test.ts`'s
`AUTHENTICATED_PATHS` case asserts the set against a **hardcoded five-item literal** and must
gain `/api/analytics`; that edit is listed in §11.

**Rate limiting: none, deliberately.** The same reasoning `worker/index.ts` already records for
excluding `GET /api/build-status` and `GET /api/wa` from `RATE_POLICIES`: this repo's rate
limiter is KV-backed, so limiting a route costs a KV *write* per request, and KV Free allows
1,000 writes/day across the whole namespace with roughly 800 already committed (login counters,
the reserve-a-table counter at up to 500, the tap limiter). Rate-limiting a read-only,
session-gated route would spend the exact budget that keeps *login* rate limiting alive. The
cache entry below is the load control instead.

That decision is otherwise invisible: `worker/__tests__/hardening.test.ts` pins
`Object.keys(RATE_POLICIES)` to exactly the three mutating routes and would not notice a
fourth authenticated route being added unlimited. So that test gains a second, named set —
**authenticated, read-only, deliberately unlimited: `/api/build-status`, `/api/analytics`** —
asserted to be disjoint from `RATE_POLICIES` and a subset of `AUTHENTICATED_PATHS`. A future
limiter then has to edit a list rather than slip past one.

**Budget arithmetic, recorded in the module header the way `RATE_POLICIES` records its own.**
Workers Free allows 10 ms CPU and 50 subrequests per invocation, and KV **and** Cache API calls
both count toward the 50. This route's worst case is **4**: `cache.match`, one GraphQL `fetch`,
one `KV.get`, `cache.put`. A cache hit is 1. CPU is dominated by a single HMAC verify plus a
small `JSON.parse`. Comfortably inside both, and written down so a future addition has to
re-do the sum.

**Caching: the Cloudflare Cache API. Never KV.** Same budget, same reason — a KV-cached
analytics response would push the namespace over its daily write cap and silently disable login
rate limiting.

- `caches.default`, referenced **lazily inside the handler**, never at module scope, so
  `worker/analytics.ts` imports cleanly in a test environment that has no `caches` global at
  all (see §11).
- **Key is a fixed, constructed request on this Worker's own origin**:
  `new Request(new URL('/__cache/analytics/v1', request.url).toString())`. Fixed and
  constructed rather than derived from the incoming request, so the session cookie can never
  enter the key and two logins cannot fragment the cache — **and in-zone**. The first draft used
  a synthetic off-zone hostname (`https://analytics.vb.internal/v1`); Cloudflare documents Cache
  API operations working on custom domains and Workers/Pages routes and being no-ops in the
  dashboard playground, but does not document `caches.default` accepting an arbitrary off-zone
  host. If it silently no-ops, every dashboard load becomes a live GraphQL call, the route's
  only load control is gone, and **nothing errors anywhere**. An in-zone path removes the
  question. `wrangler.toml` routes this Worker on `vb.aionxxxi.uk`, so `request.url` is always
  in-zone.
- **TTL 600 seconds (10 minutes)**, set as `Cache-Control: public, max-age=600` on the copy that
  is stored. Chosen because: Cloudflare's own RUM aggregation is not real-time; every question
  these four cards ask is a 7- or 28-day question, so nothing she can perceive changes inside
  ten minutes; and it bounds upstream GraphQL calls to six per hour per colo no matter how often
  she reloads or how a component behaves when it misbehaves. A shorter TTL buys nothing
  measurable. A longer one starts making "how did today go" feel stale.
- **Build the body once as a `string`, then construct two separate `Response` objects.** A
  `Response` body is a one-shot stream: `cache.put(key, response)` followed by
  `return response` is a bug that consumes the body before the browser sees it.

  ```
  const body = JSON.stringify(payload);
  await cache.put(key, new Response(body, { headers: {
    'Cache-Control': 'public, max-age=600', 'Content-Type': 'application/json' } }));
  return new Response(body, { headers: {
    'Cache-Control': 'no-store', 'Content-Type': 'application/json' } });
  ```

  The stored copy drives the TTL. The returned copy is `no-store` because it is per-session data
  behind a login and must never sit in a shared browser or edge cache.
- **The `no-store` on the returned copy is belt and braces, and the spec says so honestly.**
  The first draft claimed "the `no-store` handling for authenticated GETs keys off
  `AUTHENTICATED_PATHS`". It does not: `withSecurityHeaders` sets `Cache-Control: no-store` on
  **every** response leaving the Worker's `fetch`, unconditionally, and `AUTHENTICATED_PATHS`
  drives `withSlidingSession` only. Two consequences. First, a test that drives
  `worker.fetch(...)` and asserts `no-store` **cannot fail** and proves nothing about this
  module — §11 asserts it at the handler level instead. Second, and this is the real trap: the
  `cache.put` must happen **inside `handleAnalytics`, on the body it built**, never on whatever
  the central wrapper returns. Storing a `no-store` response makes the Cache API refuse it,
  every request becomes an upstream GraphQL call, and no test fails.
- `await cache.put(...)` inline rather than `ctx.waitUntil(...)`. The Worker's `fetch` handler
  and its `route()` function currently take `(request, env)` with no `ExecutionContext`.
  Threading `ctx` through every route for one caller's benefit is a wider change than a local,
  sub-millisecond edge write is worth.
- The response carries no `Set-Cookie`, which the Cache API would refuse to store.

**Upstream.** One `POST https://api.cloudflare.com/client/v4/graphql` per cache miss, carrying
`Authorization: Bearer ${env.CLOUDFLARE_API_TOKEN}` and `AbortSignal.timeout(10_000)` — the
same header, timeout and posture `handleBuildStatus` already uses. One GraphQL document with
five aliased groups (totals, byPath, byReferer, thisWeek, priorWeek) so it is one round trip,
not five. The document is the one verified by hand in **P0** and pasted into the module header.

**Excluding admin and local traffic from every group.** The beacon is on `index.html`, which the
SPA rewrite serves for `/edit` and every `/edit/manage/*` route, so her own editing sessions are
tracked pageloads. Without an exclusion, Card B would very likely rank `/edit/manage/menu`
first at launch (that path has no match in `pages.json`, so §6's rule 4 renders it raw), and
Card A's denominator would be inflated by the person the screen is for.

- **Required:** no path beginning `/edit` contributes to any of the five groups.
- **Preferred implementation:** a `requestPath` prefix filter in the GraphQL document itself,
  confirmed in P0.
- **Decided fallback, if the dataset offers no such filter:** raise the `byPath` limit and
  filter in the Worker, and compute Card A's and Card D's totals as sums over the filtered rows
  rather than from separate totals groups. Either way the exclusion is one implementation with
  its own Worker test.
- **Localhost and CI** are handled the same way where the dataset exposes a request-host
  dimension (confirmed in P0); where it does not, see §8, which handles CI at the browser and
  records `npm run dev` as accepted residue.

**Configuration.**

- `CLOUDFLARE_ACCOUNT_ID` — already a `[vars]` entry in `wrangler.toml`; supplies `accountTag`.
- `CF_WEB_ANALYTICS_SITE_TAG = "29e1ba52fba74885a5fc44875a48a078"` — a **new `[vars]` entry**,
  not a secret. It is a filter value, exactly like `CLOUDFLARE_PAGES_PROJECT`.
- `CLOUDFLARE_API_TOKEN` — the **existing** secret, which needs **Account Analytics: Read**
  added to its current Account · Cloudflare Pages: Read.

  **This reverses a recorded runbook decision, and the reversal is written down rather than
  left to contradict itself.** `docs/cloudflare-cutover.md` §12b says in bold "**do not reuse**
  any token created for other purposes" and walks the human through creating a Pages-scoped
  token. That paragraph is rewritten in the same commit that adds this route. The reason for
  reversing it: two tokens are two things to rotate, two things to leak, and two ways for them
  to disagree about which account they point at — and both permissions here are **read-only
  scopes on the same account**, which is the case the "don't reuse" rule was not written for.
  Leaving 12b standing while §7 says the opposite is the identical failure mode §8 fixes in
  `index.html`, and it is not acceptable in either place.

**`wa:counts`, read correctly.**

- `readWaCounts` and `WA_COUNTS_KV_KEY` are **module-private in `worker/index.ts` today**. They
  move to a small `worker/wa.ts` that both modules import — not copied, not re-implemented, and
  not exported ad hoc from `index.ts` in a way that makes the two files depend on each other in
  a circle.
- **Sum only the last 28 IST dates, ending yesterday**, matching the visits window. That map has
  no expiry and holds every date since the counter shipped; summing all of it would put an
  all-time numerator against a 28-day denominator.
- **The IST/UTC edge offset is accepted and recorded.** `wa:counts` keys come from
  `todayInKolkata()`; Cloudflare's RUM days are UTC. The two 28-day windows are therefore offset
  by 5h30m at their edges. Against a 28-day window that is a fraction of a percent, and
  re-keying the counter to UTC would silently change the meaning of every date already stored.
- **`wa:counts` grows without bound** and is rewritten whole on every accepted tap. Known,
  recorded, and out of scope for this work — but it is the reason the 28-day filter lives on the
  read side.
- A KV read costs nothing against the write budget.

**Failure shapes.** Every one maps to a sentence, never a status code:

| Upstream | Route returns | Card area says |
|---|---|---|
| `fetch` throws, rejects, or times out | `502 { reason: 'unreachable' }` | "Couldn't reach the visitor numbers just now." + Retry |
| Cloudflare 401/403 | `502 { reason: 'upstream-auth' }` | "The visitor numbers aren't connected yet." |
| HTTP 200 with a non-empty GraphQL `errors[]` | `502 { reason: 'upstream-error' }` | "The visitor numbers aren't connected yet." |
| 200, valid, but the groups arrays are empty or `accounts[0]` is absent | `200` with zero-data body | The counting-started banner and each card's own empty state |

The `upstream-auth` / `unreachable` split exists because the two need different human actions —
*wait* versus *fix a token* — and an undifferentiated "something went wrong" would have her
retrying forever against a permission that will never grant itself.

The last row is the one to get right. GraphQL answers **200 with an `errors` array**, and a
missing `accounts[0]` is what an account/token mismatch looks like. `worker/status.ts` already
documents the identical trap for Cloudflare's REST `success: false`: collapsing an error into
"nothing to report" reports the most reassuring state possible at exactly the wrong moment.
Empty-but-valid is the launch state and must render as empty. Malformed is a 502.

## 8. The beacon

Cloudflare Web Analytics `auto_install=true` is bound to the **zone** `aionxxxi.uk`, and
Cloudflare's HTML injection does not apply to Pages-served responses — verified across three
cache-busted requests. The beacon is not on the page. That is why the dataset is empty.

**The fix:** put the snippet in `index.html` by hand and turn auto-install **off** (P2).

```html
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js"
  data-cf-beacon='{"token": "7d977bcbda6e4e38884875918d153e7f"}'></script>
```

This also makes the data survive the move to `viabiancadelhi.com`, because the token then
travels with the HTML rather than with the zone.

**Rejected alternative, and why.** One review proposed injecting the tag from a Vite
`transformIndexHtml` plugin applied on production builds only, so `npm run dev` never carries
it. Rejected: it does not solve the largest pollution source (her real `/edit` sessions in
production, which no build-time trick touches and which §7 must exclude at the query anyway); it
moves the token out of the one file the two existing tests read, splitting the beacon's
definition across a plugin and a dist assertion; and the owner's own recorded instruction is the
literal tag in `index.html`. The three pollution sources get three explicit answers instead:

| Source | Answer |
|---|---|
| Production `/edit` and `/edit/manage/*` | Excluded in the Worker's GraphQL filter (§7), which is required regardless |
| `npm run test:csp` (real Chromium over every route) | `scripts/check-csp.mjs` aborts requests to `https://cloudflareinsights.com/*` **after** recording whether a `securitypolicyviolation` fired for them — CSP is evaluated before the request is dispatched, so the abort still proves the policy allowed it while sending nothing |
| `npm run dev` on one developer machine | **Accepted residue**, recorded here rather than discovered later. A handful of pageloads against a 28-day window, filtered by request host where P0 confirms the dataset offers one |

**`index.html` currently carries a comment saying explicitly not to do this**, because
auto-install would double-count. That reasoning was correct when written and is now inverted.
**Rewrite that comment.** It must not be left contradicting the code three lines below it. The
replacement states: auto-install does not reach Pages-served responses (verified), the token
travels with the HTML so this survives the domain move, and auto-install must be off in the
dashboard so this is the only beacon on the page.

**Three sources currently say the opposite, and all three change in the same commit.**

1. **`src/test/analytics.test.ts` asserts the exact opposite and goes red on the first commit.**
   It currently asserts `expect(html).not.toContain('cloudflareinsights.com')` and
   `not.toMatch(/data-cf-beacon/)`, over a 15-line comment arguing that hand-placing the beacon
   is the bug. That file is **rewritten, not deleted**: same file, inverted assertions — exactly
   one beacon script, carrying token `7d977bcbda6e4e38884875918d153e7f` — and its header comment
   replaced with the auto-install-does-not-reach-Pages finding. A deleted test would leave the
   inverted rationale nowhere and the beacon unguarded.
2. **`index.html`'s comment**, as above.
3. **`docs/cloudflare-cutover.md` Step 4**, which currently instructs the human to use the
   dashboard toggle, tells them "do not use" the manual snippet, and cites
   `src/test/analytics.test.ts` by name as the guard. Rewritten in the same commit — including
   the auto-install-off step (P2) — or the runbook contradicts the code the same way the
   `index.html` comment already does.

**`src/test/head.test.ts` also gains a check** that the beacon tag is present and carries this
token, alongside its existing title/description pins. That is deliberate duplication with (1):
`analytics.test.ts` owns "exactly one, and here is why", `head.test.ts` owns "the head has not
drifted". Without either, a future edit to `index.html` deletes the beacon, analytics silently
returns to zero, and nothing anywhere fails.

**CSP.** `public/_headers` already permits `https://static.cloudflareinsights.com` in
`script-src` and `https://cloudflareinsights.com` in `connect-src`, so no change is expected.
**Verify with `npm run test:csp`, do not assume it.** The `script-src` half is genuinely covered
today by that script driving real Chromium over every route. The `connect-src` half is **not**:
it only gets exercised if the beacon actually downloads and fires within the page's short life,
over the real network, which in CI without egress silently proves nothing. So `check-csp.mjs`
gains an explicit `connect-src` probe alongside its existing capability probe — a `POST` to
`https://cloudflareinsights.com/cdn-cgi/rum` inside a try/catch that records only
`securitypolicyviolation` events and never a network failure — which is the same interception
point that gives us the CI-pollution answer above.

**`index.html` is inside Tailwind's content glob**, and Tailwind's scanner is a plain text
extractor with no HTML or JS parser behind it — it splits on non-word characters and will
happily read a word out of an attribute value or a comment. The snippet and the rewritten
comment must both be checked against a **rule-level diff of the built stylesheet**, and see
§11's CSS ceiling entry for why that diff has to be *run and recorded in the commit*, not
described in a comment. This repo has shipped bogus CSS out of a comment twice.

## 9. File structure

`src/admin/AdminApp.tsx` is 1326 lines and holds the session gate, the shared plumbing, all ten
panel wrappers, eight panel implementations, and a hundred lines of pure copy-field helpers. It
is too big to work in safely, and this change touches all of it.

```
src/admin/
  AdminApp.tsx                 session gate + shared plumbing + <ManageShell>
  manage/
    areas.ts                   AREAS: slug, label, description, panel ids, panel->file map
    analytics.ts               labelForPath, COUNTING_STARTED_ON, card formatting
    ManageShell.tsx            lockup + cross-surface notice + StatusStrip + AreaNav
                               + PublishBar wrapping all five areas + DraftBanner gate
    AreaNav.tsx                variant: 'sidebar' | 'list'
    AreaHome.tsx               the phone drill-down home
    StatusStrip.tsx
    AreaNotFound.tsx
    Thumbnail.tsx
  publish-summary.ts           barSummary + stripSummary
  areas/
    MenuArea.tsx               Dishes, Drinks, Menus
    PagesArea.tsx              Pages, Homepage sections
    StoryPhotosArea.tsx        Galleries, Our Story, Press
    DetailsArea.tsx            Opening hours, Page copy
    NumbersArea.tsx            the four cards + the one fetch
  sections/
    ArraySection.tsx           shared by Dishes, Drinks and Press — moved, not rewritten
    copy-fields.ts             COPY_GROUPS, leafValue, withLeaf, withVisibleNbsp
worker/
  analytics.ts                 GET /api/analytics
  wa.ts                        WA_COUNTS_KV_KEY + readWaCounts, shared with index.ts
```

`AdminApp.tsx` keeps only the session gate, the shared plumbing (registry, staged files,
previews, draft state, publish lock) and the shell mount; every panel implementation leaves the
file. **No line-count target is stated**, because a number in a spec with no test behind it
drifts the day it lands and then quietly licenses the opposite.

Each panel implementation (`SectionsSection`, `PagesSection`, `HoursSection`, `MenusSection`,
`GallerySection`, `StorySection`, `CopySection`, and the `blankDish`/`blankDrink`/`blankArticle`
factories) moves into the area module that renders it. `ArraySection` moves to `sections/`
because three panels share it. `copy-fields.ts` extracts ~100 lines of pure functions that are
currently untestable without rendering the whole dashboard.

**These are moves, not rewrites.** A panel's body arrives in its new file byte-identical apart
from imports. Any behaviour change smuggled in alongside a 1300-line move is unreviewable.
Because "byte-identical apart from imports" is not something a test can assert, §11 requires a
**per-panel DOM snapshot taken before the move and asserted unchanged after** — that is the
enforcement, and the `areas.ts` completeness test (which catches a *dropped* panel but not a
subtly *altered* one) is the complement, not the substitute.

### Every `<button>` in the new shell carries an explicit `type="button"`

`PublishBar` is a single `<form>` and its `children` prop comment already enumerates every
existing button confirmed to carry an explicit type, because a bare `<button>` inside that form
defaults to `type="submit"` and becomes a second Publish trigger. Putting `PublishBar` around
the whole shell brings new buttons inside it: the analytics **Retry** button, anything in the
status strip, and anything in `AreaNotFound`. All of them are explicitly `type="button"`. The
nav is `<Link>`/`<a>`, which both the submit default and the disabled cascade leave alone. §11
pins it with a test that clicking Retry does not open the publish confirmation.

### What stays shared and is not touched by this work

`PublishBar` (one additive optional prop, `onPhaseChange` — §4), `CollapsibleSection`,
`publish.ts`, `staged.ts`, `drafts.ts`, `content.ts`, `session.ts`, `SectionErrorBoundary`,
`useValidation`, `problems`, and the field/list components `Field`, `RecordForm`,
`SectionList`, `PageList`, `HoursField`, `StoryForm`, `PdfField`, `TemplateSectionList`.

**In scope, each for one additive change and nothing else** — the first draft listed these as
untouched while §5 required them to render a thumbnail, which made §5 unbuildable:

| File | Change |
|---|---|
| `RecordList.tsx` | one optional `thumbnail?: (item: T) => React.ReactNode`, rendered at the start of the row's header row |
| `GalleryList.tsx` | the same optional prop |
| `TemplateContentForm.tsx` | the same optional prop, for item-list rows and gallery-image rows |
| `PhotoField.tsx` | one optional `previews?: ImagePreviews`, defaulting to `NO_IMAGE_PREVIEWS` (§5) |
| `open-sections.ts` | two new additive functions, `hasSeededArea`/`markAreaSeeded`; `loadSectionOpen` and `saveSectionOpen` are not modified (§1) |

`previews.ts` is **not** in this table and is not edited at all: `useImagePreviews` and
`NO_IMAGE_PREVIEWS` are already exported, and this work simply calls them from a second place.

Nothing else in those files moves.

### PublishBar is mounted exactly once

In `ManageShell`, wrapping all five area containers and the phone home. Not one per area. It is
the single `<form>` every section's fields submit into, it owns the single shared registry and
the single draft, and five of them would be five publish buttons and five drafts. Being in the
shell also means a publish keeps running and keeps reporting while she navigates between areas
— the request and the build-status poll are not interrupted by a route change.

### Bundle guard

`src/test/bundle.test.ts` fails the build if any file outside `src/admin/` gains an admin
import, static or dynamic, beyond the one `React.lazy` in `src/App.tsx`. None of the new modules
changes that: every one of them is inside `src/admin/` and is reached only through `AdminApp`.

`src/test/bundle.post-build.test.ts` is a different matter and **does** break; see §11.

## 10. Error handling

**A panel that fails to load.** Unchanged: `SectionErrorBoundary` already wraps each panel
individually, so a malformed `galleries.json` costs the Galleries panel and leaves Our Story
and Press beside it working. That per-panel granularity stays exactly as it is.

**An area whose own code throws** (not a panel — the area module itself) gets one boundary per
area, *inside* the shell. The header, status strip and nav stay standing, so she can navigate
out of it. An area that took the shell down with it would be unrecoverable without typing a
URL.

**A problem inside a hidden area must be visible from outside it.** `CollapsibleSection`'s
decision #2 exists because "a `dishes.json` that would not load looked exactly like a
`dishes.json` she had simply not opened yet"; its marker on a folded section is the answer. This
redesign adds a **second** level of hiding, and the first draft added no second-level marker —
so a failed `copy.json` load, or an inline validation problem, would raise a marker inside a
`hidden` container that she can never see while she is in Menu. The per-panel granularity is
unchanged; its *visibility* is not, and that is the gap.

**`AreaNav` items carry the same marker, derived the same way.** One `MutationObserver` per area
container in `ManageShell`, watching for any `[role="alert"]` anywhere inside it — mirroring
`CollapsibleSection`'s existing implementation rather than inventing new plumbing, and covering
both load failures and inline field problems, because every section in this dashboard already
uses `role="alert"` for both. Rendered at both `AreaNav` variants. This is a different signal
from §4's unsaved dot and must be visually distinguishable from it.

**A refused publish must say which area to open.** `POST /api/publish` answers 422 with
`ValidationProblem[]`, and that type is `{ field: string; message: string }` — no file, no
panel, no area. `PublishBar` renders those under "Publishing will be refused until these are
fixed:". Today that is survivable because all ten panels are on one page. After this change she
is told to fix something, the inline red message that would locate it is inside a hidden
container (and therefore invisible to find-in-page as well as to her), and §12 rules out a
search. That is the worst state this redesign introduces and it is not acceptable.

- `ValidationProblem` gains an **optional `file?: ContentFileName`**. The Worker already knows
  `f.path` at the point it builds the array — tagging is one `.map` inside the existing
  `flatMap`, and the field is optional so every existing producer and consumer still typechecks.
- `PublishBar` renders each tagged problem with a link — "Fix this in Menu → Dishes" — built
  from `areas.ts`'s panel→file map. Following it routes to the area and opens that panel's fold
  (`saveSectionOpen(id, true)` before navigating).
- An untagged problem renders exactly as it does today.

**Correction to one review's account of this.** It attributed the failure to the *client-side*
pre-publish list. On the dashboard that list never renders: `AdminApp` does not pass the
`problems` prop to `PublishBar`, which defaults it to `[]`, because every panel already shows
its problems inline next to the field. The path that actually strands her is the **server's 422
after she presses Publish**. The substance of the finding stands; the mechanism above is the one
that needs fixing.

**Analytics unreachable or auth-errored.** The four cards share one message block with a Retry
button, and the two distinct sentences from §7. The rest of the shell — status strip included —
is unaffected: a Cloudflare analytics outage says nothing about whether the restaurant's site is
up, and the strip must not imply it does.

**A publish in progress.** `publishLocked` already exists and already reaches each panel through
`CollapsibleSection`'s per-section `<fieldset disabled>`. Two things this design adds:

- **Navigation is not disabled during a publish.** Moving between areas is not editing — the
  same argument `CollapsibleSection.tsx` already makes for why its fold toggle sits outside the
  disabled fieldset. It is structurally safe today (the nav is `<Link>`/`<a>` and the native
  disabled cascade reaches form controls only), **but structural safety is not a reason to leave
  it unpinned**: a later refactor wrapping the shell in a disabled fieldset would reintroduce
  exactly the bug that moved the fieldset in the first place. §11 tests it.
- **An in-app route change needs no `beforeunload` guard.** `PublishBar`'s existing
  `beforeunload` covers a real page unload with unsaved work. A route change does not unload the
  page and loses nothing, because the registry, the staged files and the draft all live above
  the shell (§3).

## 11. Testing strategy

Every test must be able to fail. Each one is written, then the code under test is mutated until
it goes red, then restored, and the mutation is recorded in the commit.

### Test-environment facts every case below has to work around

- **`src/test/setup.ts` stubs `window.matchMedia` globally, returning `matches: false` for every
  query, for the whole suite.** So under vitest the bare `/edit/manage` always resolves to the
  **phone home list**, no sidebar exists, and no panel heading is queryable until a test
  navigates. Laptop behaviour is never the accidental default and must be opted into.
- The stub's `addEventListener` is a no-op, so a resize-reactive implementation would be
  untestable without replacing it. §3 does not need one; recorded as an accepted limit.
- **`caches` does not exist** in this repo's vitest environment (jsdom + Node globals;
  `vitest.config.ts`'s own comment enumerates what is and is not present, and `caches` is a
  workerd-only global). `vitest.config.ts`'s "Absent, needs a workaround" list gains it.
- jsdom has no layout engine: every element measures zero, no media query evaluates, nothing can
  be hit-tested.

### jsdom (vitest) — logic, copy, wiring

**Shell and routing**

- **`areas.ts` completeness.** Five areas, unique slugs, and **every one of the ten existing
  panel ids appears in exactly one area**. This is the test that catches a panel silently
  dropped or duplicated during a 1300-line move — the single most likely defect in this work.
  Folded into the same case: the ten `aria-controls` values rendered by the dashboard are
  exactly `section-panel-{dishes,drinks,press,sections,pages,hours,menus,galleries,story,copy}`.
  That is a direct pin on the localStorage key suffix (`open-sections.ts` builds
  `vb:section-open:v1:<id>`), and it does not depend on any e2e — which matters, because the
  only test covering those ids end-to-end today is the e2e spec this work rewrites. A silent
  `dishes` → `menu-dishes` would otherwise forget every remembered fold with nothing red.
- **A `renderDashboard(route = '/edit/manage/menu', { wide = false } = {})` helper**, wrapping
  `<MemoryRouter initialEntries={[route]}>` and applying a per-test `vi.stubGlobal` for
  `matchMedia` — never a mutation of the shared setup file. `usePrefersReducedMotion.test.ts` is
  the existing precedent for the local stub.
- **Routing**, as a `describe.each([{ wide: true }, { wide: false }])`: each
  `/edit/manage/<slug>` shows that area's headings and hides the others; an unknown slug shows
  the not-found content *and still shows the nav*; bare `/edit/manage` redirects to
  `/edit/manage/menu` when wide and renders the home list when not.
- **Areas stay mounted — the single most important test in this document, written against a seam
  that exists.** The first draft asked to "assert `register` was not called a second time for
  `dishes.json`"; the registry is built by a hook inside `AdminApp` and nothing outside can spy
  on `register`, so that assertion is unwritable and the tempting fix would spy on something the
  component never calls through. Restated in terms of what is observable: navigate Menu → Pages
  → Menu with a dish name edited in between, and assert (a) the stubbed
  `GET /api/content?path=…dishes.json` fired **exactly once** across the whole sequence, and
  (b) the edited name is still in the input. *Mutation:* replace the `hidden` toggle with
  conditional rendering; both assertions go red.
- **The `hidden` attribute, not a class.** Assert the hidden containers carry the attribute.
  Real-browser confirmation is in the e2e list, because jsdom loads no CSS and cannot catch a
  display utility overriding the user-agent rule.
- **The draft gate.** A draft in localStorage blocks every area from mounting and blocks
  `PublishBar`, until she answers Restore or Discard. The existing `AdminApp.test.tsx` case for
  this survives the move rather than being rewritten away. *Mutation:* render the areas
  alongside `DraftBanner`; the case goes red, and so does a second one asserting the draft is
  still in localStorage after the areas would have loaded.
- **The cross-surface `/edit` draft notice** renders in the shell; its two existing cases survive
  with a navigation step.
- **Navigation is not disabled during a publish.** With `publishLocked` true, the five nav links
  have no `disabled` or `aria-disabled` ancestor and a click still changes the route.
  *Mutation:* wrap the shell in a disabled fieldset; red.
- **Every `<button>` in the shell is `type="button"`.** Clicking analytics Retry does not open
  the publish confirmation. *Mutation:* remove the attribute; red.
- **The per-area error boundary.** An area module that throws leaves the lockup, the status
  strip and all five nav items queryable, and the other four areas still reachable.
  *Mutation:* hoist the boundary outside the shell; red.
- **The area problem marker.** A panel raising a `[role="alert"]` marks its area in the nav, at
  both variants, and the marker is distinguishable from the unsaved dot.
- **The first-panel seed.** With no `vb:area-seeded:v1:menu` key, opening Menu leaves Dishes open
  and Drinks and Menus folded, and writes the seed key. With the seed key present and Dishes
  closed, Dishes stays closed. *Mutation:* drop the seed-key check; the second case goes red.
- **`src/admin/__tests__/CollapsibleSection.test.tsx` and `open-sections.test.ts` keep passing
  unchanged**, which is what proves the fold behaviour and the storage contract were left alone.
  Recorded honestly: they are isolated-component tests that never mount the dashboard, so they
  prove *those two modules* were not regressed — they prove nothing about the ids the dashboard
  passes, which is why the `aria-controls` pin above exists. `open-sections.ts`'s two new
  functions get their own cases; no key migration is needed and that is stated in the file.

**Status strip**

- Copy for each state, queried by `aria-label="Site status"`, never by role alone: zero unsaved;
  some unsaved (naming the files, not counting sections); build-info OK; build-info error;
  publish in flight; publish landed; publish not landed after 5 minutes; **`builtAt` in the
  future**; and **`sha: 'unknown'` as a separate case** that still shows the time normally.
- **`stripSummary` and `barSummary` are pinned separately**, and `barSummary`'s output is
  asserted byte-identical to the string `PublishBar.test.tsx` already expects.
- **Polling**, with fake timers: advance 60s → one extra `fetchBuildInfo`; dispatch
  `visibilitychange` with the document hidden, advance 120s → no further calls; dispatch `focus`
  → one call. *Mutation:* delete the `visibilitychange` listener; red.
- **The live region is scoped**: `getByRole('status')` within the strip exists, and the relative
  timestamp node is **outside** it.
- **The strip renders on all five areas, on the phone home and on the not-found screen**, at
  both widths — a loop over `AREAS`, because the not-found screen is exactly where this gets
  dropped.
- The "View site" label and its half-line change with the unsaved count.

**Thumbnails**

- `Thumbnail` in isolation: null path → placeholder; `onError` → placeholder, once, no retry
  loop; a staged preview beats the content path; `alt` is the empty string; the placeholder is
  `aria-hidden`.
- **A row-by-row walk of §5's table**, because the isolated tests above pass identically whether
  `Thumbnail` is mounted on six row types or zero. For each of the six: render the panel with a
  fixture carrying an image path and assert an `<img>` with that path is **inside the row**. For
  Menus, Pages, Homepage sections, Opening hours and Page copy: assert there is none.
  *Mutation:* delete the `<Thumbnail/>` from one row component; exactly one case goes red.
- **An integration case for the staged precedence**, driven through a real photo pick in the
  Dishes panel using the `FakeXHR` double `AdminApp.test.tsx` already has: after the pick, the
  row's thumbnail `src` is the object URL, not the optimistically-written content path.
  *Mutation:* drop the precedence; the src flips back and the case goes red.

**Analytics**

- Cards rendered from fixed payloads: **all four zero-data strings**, the counting-started
  banner and its `COUNTING_STARTED_ON` constant, both error sentences, and the skeleton loading
  state showing the four real headings.
- Card A: the relationship line is absent at zero visits and absent with fewer than 7 days;
  Card A's zero state is the single-sentence form, not two numbers side by side; the rendered
  text matches `/at least \d+/` and does **not** match `/\d+ bookings?/`; the lower-bound caveat
  line is present. *Mutation:* drop "at least"; red.
- Card B: `labelForPath` as a table test — a known `pages.json` slug, `/`, `/blogs`, an unknown
  path, `/catering/` with a trailing slash, `/catering?utm_source=ig`. *Mutation:* make the
  fallback return `''`; the unknown-path row goes red.
- Card D: `change` of exactly 0.15 → busier, exactly −0.15 → quieter, 0.149 → about the same;
  `priorWeekVisits` of 19 → "not enough history", 20 → a verdict.
- **`NumbersArea` fetches once**: navigating away and back does not fire a second request.

**Worker**

- `worker/__tests__/analytics.test.ts` **installs a fake `caches` global in `beforeEach`**
  (`{ default: { match, put } }`, recording every `put` argument) — named the same way the
  existing `KVNamespace` fakes name their gaps, because `caches` is a workerd global with no
  runtime shape here. `worker/analytics.ts` must therefore reference `caches.default` lazily
  inside the handler, never at module scope.
- 401 with no cookie, **and the cache is not consulted on that path**.
- GraphQL 200 with a non-empty `errors[]` → 502 `upstream-error`; upstream 403 → 502
  `upstream-auth`; **`fetch` rejecting and `fetch` aborting → 502 `unreachable`**;
  empty-but-valid → 200 zero-data, not an error.
- The referer bucketing table row by row, including every accepted mis-bucket named in §6 and a
  row for "the incoming request's own host → Typed it in or used a bookmark".
- `/edit`-prefixed paths contribute to none of the five groups.
- `wa:counts` containing dates older than 28 days: those dates are excluded from the sum.
- **A cache hit returns without a second upstream `fetch`**; a miss makes **exactly one**.
- **Two requests carrying different session cookies hit the same cache entry** — the second
  makes no upstream call. *Mutation:* derive the key from `request.url` including its cookie or
  query; red.
- `?days=90` produces the same cache key, the same single upstream call and the same body as the
  bare URL.
- **`Cache-Control` asserted at the right level.** The stored copy is `public, max-age=600`,
  read off the fake cache's captured `put` argument — that assertion can genuinely fail. The
  browser-facing `no-store` is asserted by calling `handleAnalytics(request, env)` **directly**,
  not through `worker.fetch`, because `withSecurityHeaders` sets `no-store` on every response
  unconditionally and a test driven through the router cannot fail. The spec records that the
  router already guarantees this for the shipped path, so the handler-level assertion is
  defence in depth, not the real control.
- `worker/__tests__/index.test.ts`'s `AUTHENTICATED_PATHS` case gains `/api/analytics` in its
  hardcoded literal.
- `worker/__tests__/hardening.test.ts` gains the "authenticated, read-only, deliberately
  unlimited" set (§7) and asserts it is disjoint from `RATE_POLICIES` and a subset of
  `AUTHENTICATED_PATHS`.
- `worker/wa.ts`'s move keeps every existing `GET /api/wa` and `POST /api/wa` case passing
  unchanged.

**Build and config**

- `src/test/analytics.test.ts` — **inverted**, per §8: exactly one beacon script, carrying the
  token, and the header comment replaced.
- `src/test/head.test.ts` — the beacon tag is present with the right token.
- `src/test/wrangler-config.test.ts` — `CF_WEB_ANALYTICS_SITE_TAG` is present and well-formed.
  Its existing cases are pattern-based, so nothing there breaks.
- **`src/test/bundle.post-build.test.ts`, two separate breakages, both of which the first draft
  missed:**
  1. **`ADMIN_MARKERS['AdminApp.tsx']` is the literal `'Via Bianca Dashboard'`**, which §2's
     lockup deletes, and it has a one-test-per-marker presence check that goes red. The
     replacement must be unique to the admin chunk, and that file's own comment records why the
     obvious candidates are traps: bare "Via Bianca" is a false positive because
     `ErrorBoundary.tsx` and `ReservationPage.tsx` render it in the entry chunk, and
     `Pastificio & Ristorante` is `site.tagline`, also public. **Use the phone home's Menu
     description, "Dishes, drinks and the PDF menus"** — it lives only in `areas.ts`, it is a
     full sentence rather than a label a wording pass would casually retouch, and its uniqueness
     against `src/` is confirmed by a direct search before committing, as that file's comment
     requires.
  2. **The entry CSS ceiling is 38700 bytes against a current 38468 — 232 bytes of headroom.** A
     persistent sidebar, a status strip, a phone home list, five area screens, 48px thumbnails,
     four analytics cards and a sage/cream repaint do not fit in 232 bytes, and
     `npm run test:csp` runs `npm run build`, which runs `npm run test:bundle`, so §11's own gate
     hits it. The ceiling is raised **in the same commit as the styles that need it**, with the
     new number justified in the test's comment the way every previous raise was. And because
     §8 leans on a "rule-level diff of the built stylesheet" that is prose in a comment and
     therefore cannot fail: **the postcss rule-level diff is actually run and its added-rule
     list recorded in the commit message**, exactly as the existing comment does for NavBar. A
     legitimate 4KB increase is precisely the cover a bogus comment-derived rule needs.
- **A per-panel DOM snapshot**, taken from the existing `AdminApp.test.tsx` fixtures before the
  move and asserted unchanged after (§9). This is the only thing that can fail if a panel body
  is subtly altered rather than moved.

### e2e (Playwright, 390px and 1440px) — everything jsdom cannot say

Viewport is set **before** `page.goto` in every one of these, per §3.

- **The sidebar is genuinely visible at 1440 and genuinely absent at 390.** A breakpoint mistake
  is invisible to jsdom, and this repo has already shipped a control hidden behind a breakpoint
  — `e2e/edit-dashboard-link.spec.ts` exists because of it.
- **No flash of the wrong layout at 390**: via `addInitScript`, a `MutationObserver` recording
  every added node proves the sidebar element **never existed in the DOM**, not merely that it
  is absent after settle.
- **The redirect is `replace`**: at 1440, `goto('/edit')`, click through to `/edit/manage`,
  assert the URL settles on `/edit/manage/menu`, then `goBack()` and land on `/edit` — not back
  on the redirect.
- **At 390×844, all five home rows are on screen without scrolling**, and each row's centre
  pixel hit-tests to itself. Occlusion is real here: a fixed, high-stacking-order bar has
  painted over an admin control on this site before. The 390px header budget in §2 is what makes
  this achievable by design.
- **Two taps, split by width**, because the claim is width-dependent and means different things:
  at 390, home → area is two taps; at 1440 there is no home list, so the assertion is that the
  sidebar shows all five, one click reaches any of them, and exactly one carries
  `aria-current="page"`.
- **Drill down and back at 390**: tap Menu → `/edit/manage/menu` → back control → `/edit/manage`.
- **The status strip is not painted under anything** at either width.
- **`hidden` really hides, in a real browser**: at 1440, navigate to Pages and assert the Dishes
  heading `toBeHidden()`. jsdom alone cannot catch a display utility overriding `[hidden]`.
- **Hidden areas' thumbnails are not fetched**: sitting on Hours & Wording, count `page.on(
  'request')` hits to `/food/*.webp` and assert zero. §3 states this as a justification for
  mounting everything; if it is wrong, first paint downloads every image in all five areas, so
  it is tested rather than asserted.
- **Thumbnails are 48×48**: `boundingBox()` is 48±2 in **both** dimensions at 390 **and** 1440,
  and the row's own text still starts to the right of the thumbnail and stays on screen.
  "Non-zero" would pass for a 1×1 image and for one that pushed the row off screen.
- **Exactly one `<h1>` with a non-empty accessible name** on the manage screen, at both widths.
  §2 replaces the old `<h1>` with the real lockup; a lockup rendered as an image with an empty
  `alt` would leave the page with no `h1` at all. The new accessible name is stated in
  `ManageShell.tsx` and asserted here.

### Existing specs

**`e2e/dashboard-sections.spec.ts` must be deliberately rewritten, and the reason recorded in
the file.** Its premise is that all ten headings sit on one page and the last is reachable
without scrolling past the others. After this change there is no page with ten headings, so
that measurement no longer describes anything. The rewrite keeps the same guarantees **per
area** — every heading in an area is reachable, opening one leaves the others folded, open state
survives a reload — and adds the width-split two-taps guarantee above. Two mechanical details
the first draft missed: `openDashboard()` waits on
`getByRole('heading', { name: 'Via Bianca Dashboard' })` and so does the reload test, and that
string stops existing with the lockup change; and `openDashboard()`'s settle-wait on the "Page
copy" heading moves to the Hours & Wording area. `SECTION_HEADINGS` becomes per-area, sourced
from `areas.ts`.

**`src/admin/__tests__/AdminApp.test.tsx` needs far more than "a navigation step".** Of its 43
cases, **40 call `render(<AdminApp />)` bare, with no Router and no shared helper** (one review
said "all 43"; the measured number is 40, and the difference does not change the conclusion).
The moment `AdminApp` renders anything that reads the router, every one of those throws
`useLocation() may be used only in the context of a <Router>`. On top of that, the global
`matchMedia` stub answers `false`, so the bare URL resolves to the phone home list and **no
panel heading is in the DOM at all** until a test navigates. So: all 40 render sites move to the
`renderDashboard(route, { wide })` helper, and any case asserting laptop behaviour opts in
explicitly. **This is its own commit, separate from the 1300-line move** — §13's own advice
applied to the test file it most obviously applies to. Two cases are worth calling out as still
valuable and still correct: the id-uniqueness sweep (all panels are still mounted, so it still
means what it meant) and the malformed-`galleries.json` isolation case.

**`src/admin/__tests__/PublishBar.test.tsx` (1628 lines) is unaffected** — it renders
`PublishBar` directly and never `AdminApp`, and `barSummary` is byte-identical to the function
it currently pins. If any case there goes red, the "byte-identical" claim in §4 is false and the
lift is wrong.

**`e2e/edit-dashboard-link.spec.ts`**, **`e2e/publish-confirm.spec.ts`**,
**`src/test/routing.test.tsx`**, **`src/test/bundle.test.ts`** and **`src/test/crawlers.test.ts`**
are unaffected, and each for a checkable reason: the first only asserts `/edit` links to
`a[href="/edit/manage"]`; the second drives `/edit`; the third asserts the login form, which
sits above the shell; the fourth is a source-level import guard and every new module is under
`src/admin/`; the fifth's robots rule is an `/edit` prefix that already covers the deeper slugs.

**`e2e/edit-backend.ts` gains two fixtures, not one.** A `**/api/analytics` route with a
populated fixture and a zero-data fixture — **and a `**/build-info.json` route with a fixed
`builtAt`/`sha`, plus an error variant.** `playwright.config.ts` runs `npm run dev`, and
`plugins/build-info.ts` is build-only, so `/build-info.json` does not exist under the dev server
at all: without the fixture the status strip renders "Couldn't check when the site last updated."
in every e2e run and "Last published 2 hours ago" is untestable.

### Gate

`npx tsc -b --noEmit && npm test -- --run && npx eslint .` before any claim of done, plus
`npm run test:e2e` and `npm run test:csp` for the beacon and the layout claims.

## 12. Explicitly out of scope

So nobody gilds this.

**Analytics**

- No date-range picker, no range toggle, no calendar. Two fixed windows.
- No charts, no chart library, no sparklines. Card D is a sentence because she asked for a
  sentence.
- No CSV or PDF export.
- No per-page drilldown beyond Card B's top ten.
- No new tracked events. The only conversion signal is the existing `/api/wa` tap. No scroll
  depth, no time on page, no funnels, no session recording.
- No historical storage. Whatever Cloudflare retains is the history; nothing is warehoused.
- No pruning or expiry for `wa:counts`. Its unbounded growth is recorded in §7 and left alone.

**Shell**

- No favourites, pinning, recents, or a "most-used" home screen. Decision 3.
- No search across areas, no command palette, no keyboard shortcuts.
- No breadcrumbs. Two levels do not need them.
- No dark mode.
- No animation beyond the fold transition that already exists.
- No new fonts. Parisienne and Montserrat are already loaded and are the brand.
- No sidebar collapse/expand toggle. Five items do not need to be hidden.
- No resize-reactive re-resolution of the bare URL. §3 states why and accepts it.

**Everything else**

- No rewrite of `PublishBar`, `EditMode`, `CollageEditor`, or any field or list component. The
  five additive changes in §9's in-scope table are one optional prop or two new exported
  functions each, and nothing else in those files moves.
- No change to the content model, the publish pipeline, the GitHub commit flow, or the undo
  route. The optional `file` on `ValidationProblem` (§10) is additive and changes no existing
  producer or consumer.
- No image derivative pipeline for thumbnails.
- No per-area code splitting.
- No multi-user, no roles, no audit log.
- No offline support and no client-side caching of analytics beyond the Worker's one cache
  entry.
- No email or push when a build fails.

## 13. Risks

**The 1300-line move is where a panel gets lost.** Mitigated by the `areas.ts` completeness
test, the `aria-controls` id pin, the per-panel DOM snapshot, and by moving bodies
byte-identically apart from imports. It is still the highest-risk part of this work and is its
own commit, separate from anything visual and separate from the `AdminApp.test.tsx` rewrite.

**The `AdminApp.test.tsx` rewrite touches 40 cases at once.** Done as its own commit, before the
move, so that a red case afterwards means the move broke something rather than the harness.

**The token permission is a human step outside the repo.** Until Account Analytics: Read is
added to `CLOUDFLARE_API_TOKEN`, every analytics card shows "The visitor numbers aren't
connected yet" and nothing in CI can tell. That sentence exists precisely so the state is
legible rather than mysterious.

**The GraphQL document is assumed until P0 runs it.** Field names, the `orderBy` spelling, the
per-node `limit`, and whether a path or host filter exists at all are the difference between
"one round trip" and "rewrite the Worker". P0 is first for that reason.

**Analytics launches empty and stays empty for a while.** The beacon has to ship, Cloudflare has
to aggregate, and Card D needs two full weeks. If the empty states read as "broken", she will
decide the screen does not work and stop opening it. They are the first thing to get right, not
the last, and the counting-started banner is what turns four blanks into one honest sentence.

**The bare-URL-by-width split is a behaviour that differs between her two devices**, and the
width is read once per page load. Accepted; the destination is one tap away in both cases, and
§3 records the narrowed-window consequence rather than leaving it to be found.

**The beacon counts what it is not filtered out of.** Three sources, three answers (§8), one of
which — `npm run dev` — is accepted residue rather than solved. If Card B ever ranks a path
beginning `/edit`, the §7 filter is not working and the number on Card A is wrong too.
