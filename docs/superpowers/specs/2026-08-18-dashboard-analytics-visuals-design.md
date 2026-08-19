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
every card down at once. This spec does not inherit that gamble: verifying the
schema is the first task, and every feature below states what it does if the
verification comes back negative.

**Cloudflare's numbers are estimates.** The dataset is adaptive and sampled
between 0.0001% and 100% depending on volume, which is why the card reads
"about 4,100 visits" rather than a figure. That is honest and it stays. It is
also the reason campaign counts do not come from there.

**Cloudflare keeps roughly six months.** Beacon data is unsampled for 7 days,
then aggregated to about 10%, and queryable for six. "Across years" cannot
come from Cloudflare at any price on this plan.

## Where each number comes from

Two sources, chosen per question rather than by preference.

| Question | Source | Why |
|---|---|---|
| How many visits, which pages, which referrers | Cloudflare | Already built, already free, needs no new writes, and sampling is acceptable for a trend |
| Which of *her* links brought them | **D1, first-party** | Must be exact, must not expire, and must not depend on an unverified field |
| What happened more than six months ago | **D1, rolled up monthly** | Cloudflare has discarded it |

**Campaign visits are recorded by this site, not read back from Cloudflare.**
The Worker already does exactly this for Reserve a Table taps, the site's
Content Security Policy already permits `connect-src 'self'`, and D1 is already
bound. Reading tags out of Cloudflare instead would inherit the sampling, the
six-month cliff, and a dependency on `requestPath` carrying query strings that
nobody has confirmed.

**Campaign rows go to D1, never KV.** KV Free allows 1,000 writes a day and
this project's rate limiters, login counters and tap counter already commit
roughly 800 of them. D1 Free allows 500 MB per database with rows bounded only
by storage; a campaign row is about 50 bytes, so a thousand visits a day for a
year is roughly 20 MB.

## The visuals

Hand-drawn SVG. No charting library.

That is not austerity. Recharts or Chart.js would add 50–150 KB to a dashboard
whose stylesheet has 163 bytes of headroom, and every chart here is a
polyline, a run of rectangles, or a grid of squares. SVG also draws with
geometry attributes rather than utility classes, so it barely touches the CSS
budget at all.

**Visits over time.** An area chart, one point per day. The hero graphic, and
the only element here that depends on a Cloudflare dimension the current query
does not request.

**Top pages, and where they came from.** The existing two cards become
horizontal bar lists, each row's width its share of the total. Same data, same
query, no new risk. `normalizePath` keeps merging `/catering`,
`/catering/` and `/catering?utm_source=ig` into one row — that merging is what
stops a tagged link fracturing the pages list into near-identical rows.

**Stat cards with a comparison.** Each headline number gains its change against
the previous equivalent period, with direction. The panel already fetches a
prior week for its busier-or-quieter card, so the shape exists.

**Busiest times.** A grid of day against hour. Genuinely useful for a
restaurant, and dependent on an hour dimension, so it carries the same
verification risk as the trend chart.

## Tagged links

She tags a link the ordinary way — `?utm_source=instagram` — and it works
anywhere she pastes it. No redirect, no special path, no timing hazard.

**How a visit is recorded.** On load, the site reads `utm_source` from its own
URL and, when present, posts it to the Worker, which writes one row to D1.
Nothing is recorded for an untagged visit, so the common case costs nothing.

**What she sees.** A card listing each source and its exact count, ordered by
volume, over the selected range. Exact, because these are our own rows rather
than a sampled estimate.

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
considered and rejected for the same three reasons: another script executing on
a diner's phone, a Content Security Policy exemption, and a third party holding
the restaurant's customer data. Cloudflare already collects the general
picture and D1 covers what Cloudflare cannot. Neither gap justifies a vendor.

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

**The trend chart and the busiest-times grid may not be buildable as
described.** Both need a Cloudflare dimension the current query does not
request. If the verification says no such dimension exists, both are cut and
the remaining work is unaffected, because everything else is drawn from rows
the query already returns or from our own D1.

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
- **The write path is proven end to end**, not merely called: a tagged visit
  produces exactly one row, an untagged visit produces none, and a failed
  write never blocks the page.

## One defect carried in, deliberately

The panel tells the owner that visitor counting began on 7 August 2026. That is
the **tap counter's** start date; visit counting began on 2026-08-18, when the
beacon token was unified. So she is told there is a week and a half of history
where there are hours, and "there isn't enough data yet" reads as a fault in
her website rather than as a new counter.

It is one sentence, it sits in the file this work already opens, and every card
here inherits the same start-date question. It is fixed as a task in this plan
rather than left to drift.

## Out of scope

The Google Drive photographs, which remain a separate piece of work.
