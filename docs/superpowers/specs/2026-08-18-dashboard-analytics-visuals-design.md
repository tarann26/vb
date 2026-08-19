# Numbers, drawn: charts, campaign links, and history that outlives Cloudflare

**Date:** 2026-08-18
**Status:** draft, awaiting owner approval

## Goal

Turn the Numbers panel from five sentences into something the owner reads at a
glance, and let her tell which link brought each visitor.

Three changes, one spec:

1. The existing cards gain **visuals** — a trend chart, bar lists, stat cards
   with a change against the previous period, and a busiest-times grid.
2. **Tagged links.** `viabiancarestaurant.com/?utm_source=instagram` pasted in
   an Instagram bio, and a card that says how many people arrived through it.
3. **History that does not expire**, because Cloudflare's does.

## Why

The panel answers the right questions and answers them in prose. "About 4,100
visits" is a fact; whether that is better or worse than last month is the
question she actually has, and no sentence in the panel answers it. Every
analytics product solves this the same way, and the shapes are well settled:
a number is worth reading when something sits next to it for comparison.

The tagged links are a different need. The referrer card says a visitor came
from `instagram.com`. It cannot say whether they came from the profile bio,
a story, or a comment, because all three are the same host. A tag on the link
is the only thing that separates them, and she is the one placing the links.

## What exists today

`worker/analytics.ts` is a cached proxy over Cloudflare's RUM data, drawing
four cards from one GraphQL response. `NumbersArea.tsx` renders them. A
separate KV counter records Reserve a Table taps.

**Three things about it govern this design.**

**The query has never been run against the real API.** The file's own opening
block says so, at length, and is written to depend on the fewest possible
field names because an unverified dimension fails the whole query and takes
every card down at once. **Verifying it is therefore task one of this plan,
not an optional check** -- four existing cards and two new ones rest on it, and
the answer is recorded in the repository so nobody has to guess again.

**Cloudflare's numbers are estimates.** The dataset is adaptive and sampled
between 0.0001% and 100% depending on volume, which is why the card reads
"about 4,100 visits" rather than a figure. That is honest and it stays. It is
also the reason campaign counts do not come from there.

**Cloudflare keeps roughly six months.** Beacon data is unsampled for 7 days,
then aggregated to about 10%, and queryable for six. "Across years" cannot
come from Cloudflare at any price on this plan.

## Where each number comes from

| Question | Source | Why |
|---|---|---|
| Visits, pages, referrers, the trend, the hours | **Cloudflare** | Its counting is already correct for this site, and re-deriving it is the largest false-data risk in this project |
| Which of *her* links brought them | **D1, first-party** | One tagged arrival is a simple, well-defined event, and it is the one thing Cloudflare cannot reliably give |
| Anything older than six months | **D1, snapshots of Cloudflare's own totals** | Taken before Cloudflare discards them |

**This reverses an earlier draft of this spec, and the reason matters more than
the decision.** That draft had the site count its own pageviews, on the
grounds that Cloudflare's numbers are sampled and expire. Both facts are true.
Neither outweighs what counting ourselves would cost.

**Cloudflare's beacon already gets three hard things right.** It sends a
measurement on *every route change* in a single-page app -- which this site is,
so a visitor moving between four pages is counted as four page views and one
visit, with no work from us. It distinguishes a visit from a page view. And it
has an established definition of what to ignore.

Re-deriving those means writing our own session logic, our own crawler
filtering, and our own single-page-app route handling. Every one of them
produces numbers that look plausible when wrong. **A wrong number she trusts is
worse than an approximate number labelled approximate**, and this panel exists
to be believed rather than audited.

So sampling stays, and the word "about" stays with it.

## What a number on this panel means

Precision here is not pedantry: two of the cards would be false if these were
confused.

**A page view** is one page appearing on someone's screen. Moving from the
homepage to the menu is two page views.

**A visit** is one arrival. That same person browsing five pages is one visit.
The existing query already asks for `sum { visits }`, so the card that says
"about 4,100 visits" is counting arrivals, not pages -- and every card must use
the word that matches what it counts.

**A tagged visit** is one arrival through a link carrying `utm_source`. It is
counted **once per arrival, never once per page**, because a visitor who
arrives through Instagram and then reads four pages came from Instagram once.
This is the single most likely place for this panel to report a number that is
four or five times too high, and the design guards it two ways:

- The tag exists in the URL only on arrival. Subsequent route changes within
  the app do not carry it, so ordinary browsing cannot re-count it.
- A refresh *does* re-send the same URL, so the browser is asked to remember,
  for that tab only, that this arrival was already recorded. `sessionStorage`,
  cleared when the tab closes. Not a cookie, not an identifier, and it cannot
  follow anyone between visits.

**What the campaign card cannot tell her**, stated on the card rather than
assumed: how many of those people it counted more than once across separate
devices, and anyone who arrived through a tagged link with JavaScript blocked.
Both undercount or overcount at the margin; neither is silently presented as
precision.

## The visuals

Hand-drawn SVG. No charting library.

That is not austerity. Recharts or Chart.js would add 50–150 KB to a dashboard
whose stylesheet has 163 bytes of headroom, and every chart here is a
polyline, a run of rectangles, or a grid of squares. SVG also draws with
geometry attributes rather than utility classes, so it barely touches the CSS
budget at all.

**Visits over time.** An area chart, one point per day. The hero graphic.

It needs a date grouping the current query does not ask for. **If task one
finds no such dimension, this is still built** -- a scheduled job records
Cloudflare's daily total once a day into D1, and the chart draws from that
instead. The cost of the fallback is that the line starts the day it is
switched on rather than reaching backwards, and the chart says so rather than
beginning at an unexplained zero.

**Top pages, and where they came from.** The existing two cards become
horizontal bar lists, each row's width its share of the total. Same data, same
query, no new risk -- the change is entirely in the drawing.
`normalizePath` still merges `/catering`,
`/catering/` and `/catering?utm_source=ig` into one row — that merging is what
stops a tagged link fracturing the pages list into near-identical rows.

**Stat cards with a comparison.** Each headline number gains its change against
the previous equivalent period, with direction. The panel already fetches a
prior week for its busier-or-quieter card, so the shape exists.

**Busiest times.** A grid of day against hour, genuinely useful for a
restaurant deciding when to staff.

This one has no fallback. It needs an hour dimension from Cloudflare, and a
daily snapshot cannot reconstruct an hour. **If task one finds no hour
dimension, this card is cut**, and cutting it costs nothing else -- no other
card depends on it. It is listed last here for that reason.

## Tagged links

She tags a link the ordinary way — `?utm_source=instagram` — and it works
anywhere she pastes it. No redirect, no special path, no timing hazard.

**How a visit is recorded.** On arrival, the site reads `utm_source` from its
own URL. If it is there, and this tab has not already recorded this arrival,
one row goes to the Worker and into D1. **An untagged visit writes nothing**,
so ordinary traffic costs nothing at all and the write path stays small enough
to reason about.

**What she sees.** A card listing each source and its exact count, ordered by
volume, over the selected range. Exact, because these are our own rows rather
than a sampled estimate.

**Once per arrival, not once per page.** The row is written on arrival only,
guarded per tab, for the reason set out under "What a number on this panel
means": a visitor who arrives through Instagram and reads four pages came from
Instagram once, and a card claiming otherwise would be wrong by a factor of
four.

**Sources she has not defined are grouped, not listed.** Facebook appends
`fbclid`, other sites append their own, and visitors paste links that already
carry someone else's tags. A card that lists every string it has ever seen
fills with noise. She names her links; everything else is one row reading
"other".

**A tag is not a referrer, and the panel says so.** The referrer card answers
which website the click came from. The campaign card answers which of her
links it was. Instagram appears in both, meaning different things, and the
copy has to make that plain or the two cards read as a contradiction.

## History that outlives Cloudflare

A scheduled job rolls each month's totals into D1: one small row per month per
metric. After that the range control can offer whole years, drawn from our own
archive rather than Cloudflare's window.

**Stated plainly because it cannot be fixed:** this accumulates from the day it
is switched on. It cannot recover the past. Cloudflare holds about six months
and, for this site, the beacon token was unified on 2026-08-18, so the visit
history in existence right now is hours old. The first year of the by-year view
will be a partial year, and the panel should say that rather than draw a
misleading column.

## The range control

Default 30 days. She can choose 7, 30 or 90 days, and — once the archive has
filled — by year.

Each change is another Worker request, so the existing 10-minute Cache API
entry keys on the range rather than being bypassed by it. Ranges beyond six
months are served from the D1 rollup and never reach Cloudflare.

## What this deliberately does not do

**No third-party analytics service.** PostHog, Sentry and Datadog were each
considered and rejected. Datadog is infrastructure monitoring and answers no
question this site has. PostHog's session recordings and funnels are built for
optimising a signup flow, and buying them costs a script on every diner's
phone plus browser storage to follow people between visits — a real privacy
step for a site that is cookieless on the public side. Cloudflare already
collects the general picture and D1 covers what Cloudflare cannot.

**No error tracking, and no monitoring of any kind.** This was raised, because
`index.html` carries a hand-written blank-page fallback whose comment records
three separate incidents of the site serving a white screen, and nothing
reports that back today. The owner's ruling is explicit and it is the right one
for this site: the site needs to work for the overwhelming majority of
visitors, not to be watched. A monitoring surface nobody reads is worse than
none, because it implies someone is looking.

**Nothing here needs tending.** This is the last planned work on the site. The
monthly rollup runs on a schedule and requires no attention; if it stops, the
by-year view stops growing and every other card is unaffected. No dashboards to
check, no alerts, no accounts to keep alive.

**No per-visitor tracking, no cookies, no identifiers.** The site is currently
cookieless on the public side and privacy-first analytics is the reason
Cloudflare's beacon was chosen. A campaign row records a source and a
timestamp. It does not record who.

**No live-updating dashboard.** The 10-minute cache stands.

## Costs, stated up front

**The CSS ceiling will rise**, and it should be measured rather than
estimated. SVG charts draw with attributes, but the cards, the grid and the
range control are still layout.

**The Worker gains a write path on the public site.** It is guarded the way
`/api/wa` already is: rate limited per address, capped daily, and incapable of
delaying the page. A counter that costs the restaurant a customer is worse
than no counter — that principle is already written into `Hero.tsx` and it
governs here too.

**One card depends on a write path that did not exist before**, and only one.
Tagged arrivals are written by this site; everything else is drawn from data
Cloudflare already collects. A failed write loses one row and never blocks a
page.

**Nothing here can produce a bill by accident**, which is worth stating
precisely because the free tiers differ in how they fail:

| Resource | Free allowance | This site's use | What happens at the limit |
|---|---|---|---|
| Workers requests | 100,000/day | Only `/api/*`; Pages serves the site itself and does not count | Errors, no billing |
| D1 rows written | 100,000/day | One per **tagged** arrival, plus one scheduled snapshot | Errors, no billing |
| D1 rows read | 5,000,000/day | A handful per panel load, behind a 10-minute cache | Errors, no billing |
| D1 storage | 5 GB total | A tagged-arrival row is ~100 bytes; a daily snapshot is one row | Inserts refuse until space is freed |
| KV writes | 1,000/day | **Already ~800 committed** to rate limiters, login counters and the tap counter | Why nothing here uses KV |

Every one of these **returns an error rather than starting to charge**. Passing
a free limit breaks a panel; it does not produce an invoice. Reaching any of
them would take thousands of visits a day, sustained, at which point the
restaurant has a better problem than this one.

## Testing

The project's discipline holds: every test must be able to fail, proven by
mutating the code and watching it go red.

- **Schema verification runs first and its result is recorded in the
  repository**, so the next reader does not repeat it or guess at it.
- **jsdom** — the shape of every card against known data, the campaign
  grouping, the rollup arithmetic, and each empty state.
- **`e2e/`** — every geometric and computed-style claim: charts drawn at 390px
  and 1280px, bars proportional to their values, the grid legible on a phone,
  and no control overlapping another. jsdom has no layout engine and cannot
  honestly assert any of it.
- **The write path is proven end to end**, not merely called. The cases that
  matter are the over-counting ones: **one tagged arrival followed by four
  page views inside the app writes exactly one row**, a refresh of the same
  tagged URL in the same tab writes no second row, an untagged visit writes
  nothing at all, and a failed write loses a row without blocking the page.

  This is the claim to be most suspicious of. Nothing in this project's
  browser suite has ever observed a real write — every publish assertion reads
  the source back after a remount rather than inspecting a request — and the
  one bug that broke three times lived precisely in that blind spot. A test
  that mocks the write and asserts the mock was called proves nothing.

## The backlog, closed out here

This is the last planned piece of work on this site. Everything parked during
the admin redesign is therefore fixed here or written off on purpose — nothing
is left "for later", because there is no later.

### She can see these

| # | Defect | What she experiences |
|---|---|---|
| 1 | The panel says visitor counting began 7 August 2026 | That is the **tap counter's** start date. Visit counting began 2026-08-18 when the beacon token was unified. She is told there is a week and a half of history where there are hours, so "not enough data yet" reads as her website being broken |
| 2 | `POST_FIELDS.date` and a citation block's date are both labelled "Published on" | Any post with a citation shows two identically-named controls |
| 3 | Two image blocks in one post produce two "Photo" labels | Same collision, same cause: a label that names the field but not which block |
| 4 | Validation banner lines do not name their record | "A dish needs a name" without saying which dish |
| 5 | Deleting a record does not release its staged photo bytes | A deleted dish's upload keeps occupying one of eight publish slots |
| 6 | A gallery tile shows a stale thumbnail after the editor is reopened | `PhotoField` reads its preview from local state and `value`, never from the shared store. Bytes are safe; the picture is wrong |
| 7 | The `/blog` search field's focus ring is Chromium's, not the site's | It matches neither `button:focus-visible` nor `a:focus-visible` |

### Visual

| # | Defect | Note |
|---|---|---|
| 8 | Drinks and Experiences share a wash token | That section boundary does not exist on the page |
| 9 | `experiences→press` and `ourStory→visit` are `wash-warm` against `wash` | Contrast 1.02 — a hue-only boundary. Both tokens are held to a floor against **white** only; nothing measures adjacent bands |
| 10 | `text-gray-500` on a wash is 4.10:1 | Under AA. No current pairing violates it; only a comment guards it |

### The writing surface

| # | Defect | Note |
|---|---|---|
| 11 | The toolbar's `asKind` flattens a list to one item | Nesting is lost when a list is converted |
| 12 | Backspace at the start of a nested item does not outdent | The spec named Tab/Shift+Tab only, so this was never built |
| 13 | `BlockFields.itemList` can desync `levels` from `items` | Unmounted today with no live path, and a desynced list is refused at the write boundary |

### Underneath

| # | Item | Why it matters now |
|---|---|---|
| 14 | `playwright.config.ts` is `fullyParallel` with no worker cap and no retries | The pre-push hook failed three times running on three **different** sets of tests, all of which pass alone. It blocks deploys at random and will keep doing so |
| 15 | `visiblePosts` has no non-mutation test | On first paint it hands the live content array into `orderedPosts`, safe only because both branches happen to copy |
| 16 | `BlockList.tsx` sits on disk unreferenced | Retired at Task 25, kept deliberately while the surface was new. The surface is no longer new |
| 17 | An orphaned `/edit/manage` Press panel, and `press.json` | Superseded and never removed |
| 18 | `worker/github.ts` sets no `AbortSignal` | A hung request has no ceiling |
| 19 | Nothing in `e2e/` observes a publish | "What she publishes" is inferred from what a remount writes back, never from a request body — and the staged-photo bug that broke three times lives exactly there |
| 20 | The browser suite depends on the first committed post being one paragraph and one citation | A new post landing first breaks the block-label assertions |
| 21 | The analytics GraphQL query has never been run against the real API | No longer load-bearing, now that the panel draws from our own rows. Verified anyway, once, and the result recorded -- an unverified query left in the tree is a trap for the next reader |

**Written off rather than fixed:** nothing yet. Anything that turns out to cost
more than it is worth gets recorded here with the reason, so the decision is
visible rather than silent.

## Out of scope

The Google Drive photographs, which remain a separate piece of work.
