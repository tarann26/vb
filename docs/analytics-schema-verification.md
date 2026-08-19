# The Cloudflare RUM schema, verified

Run: `node scripts/verify-analytics-schema.mjs`, on the date below, by a human
with a Cloudflare API token carrying Account Analytics: Read.

This file exists because `worker/analytics.ts` shipped with a document nobody
had run, and said so at length rather than claiming otherwise. This is the
answer, so the next reader neither repeats the probe nor guesses at it.

## Verdict

```json
{
  "verifiedOn": "2026-08-19",
  "baseDocumentAccepted": true,
  "dateDimension": "date",
  "hourDimension": "datetimeHour",
  "dimensions": [
    "bot",
    "countryName",
    "customTagInternalSxg",
    "date",
    "datetimeFifteenMinutes",
    "datetimeFiveMinutes",
    "datetimeHalfOfHour",
    "datetimeHour",
    "datetimeMinute",
    "deliveryType",
    "deviceType",
    "navigationType",
    "refererHost",
    "refererPath",
    "refererScheme",
    "requestHost",
    "requestPath",
    "requestScheme",
    "siteTag",
    "userAgentBrowser",
    "userAgentOS"
  ]
}
```

The block above is the machine copy. `worker/__tests__/analytics-schema.test.ts`
parses it out of this file and deep-equals it against `RUM_CAPABILITIES` in
`worker/analytics-schema.ts`, so this document and that constant cannot be
edited apart.

## What each verdict decides

- `baseDocumentAccepted: false` means every card on the Numbers screen is a
  502 today. Fix the document in `worker/analytics.ts` from the `errors[]`
  printed below, re-run, and record the corrected document here.
- `dateDimension: null` means the trend chart cannot reach backwards. The
  nightly snapshot job is built either way (R8) and the chart draws from it
  either way (R9); what is skipped is Task 13's one-off backfill step, so the
  line starts the day the job was switched on and the caption says so.
- `hourDimension: null` means the busiest-times chart is CUT (Tasks 15 and 21).
  Nothing else depends on it, which is why the spec lists it last.

## What this plan does with it

Both conditional surfaces are BUILT and neither is struck. `date` and
`datetimeHour` are both real dimensions on
`AccountRumPageloadEventsAdaptiveGroupsDimensions`, and both were accepted in
a real grouping rather than merely listed by introspection: the probe's
`byDay` and `byHour` nodes ordered by `date_ASC` and `datetimeHour_ASC` came
back HTTP 200 with `errors: null`. So Task 13 keeps its backfill step, Task 15
takes its BUILD branch, and Task 21 draws the busiest-times chart. `bot` is a
dimension too, and it is filterable — `bot: 0` was accepted inside the same
grouping — so crawler traffic is excluded upstream rather than guessed at
downstream.

## The probe can report a rejection, and was made to

An acceptance is only worth reading if a rejection was possible. The probe
therefore ends with a negative control: one node grouped by `datetimeDay`, a
name the introspection reply does not list. It came back
`{"data":null,"errors":[{"message":"unknown field \"datetimeDay\""}]}`. That
is what a wrong field name looks like from out here, and it is what
`baseDocumentAccepted: true` is measured against.

Two mechanical details of that rejection matter to
`worker/analytics.ts`, and both are already handled there: the API answers a
rejected document with **HTTP 200**, not a 4xx, and it answers it with
`data: null` beside a populated `errors[]`. A check that reads only the status
code would call this a success.

## Four things the probe looked at that the plan did not ask about

The first three are settled. **The fourth is not**, and is kept in this list
under its own heading rather than deleted, because an earlier revision of this
file recorded it as settled and somebody may have read that version.

**1. `requestPath` never carries a query string, so `utm_source` cannot reach
Cloudflare at all.** This was the open question, and it is settled at the
source rather than inferred from an absence. The Web Analytics beacon composes
its own payload in the browser, and the field it sends is `location`. Loaded
against the live site at `https://viabiancarestaurant.com/?utm_source=vbprobe`
under a real Chromium, the beacon posted to `https://cloudflareinsights.com/cdn-cgi/rum`
(HTTP 204) with `"location":"https://viabiancarestaurant.com/"` — the tag
stripped before the request left the page, under the production site token.
Corroborated upstream: across 90 days of the two legacy site tags, 36 returned
rows over 22 distinct `requestPath` values, and not one value contains a `?`.

Consequence, and it is the plan's premise rather than a problem for it: the
campaign card **cannot** be derived from Cloudflare under any grouping. The
first-party D1 rows of Tasks 6–12 are the only possible source, exactly as
R5–R7 assume. It also means `normalizePath`'s query-stripping is defensive
rather than load-bearing for this dataset — it still earns its place, because
it is the same function the first-party path ever passes through.

**2. `sum` offers exactly one field: `visits`.** Introspecting
`AccountRumPageloadEventsAdaptiveGroupsSum` returns a single field, `visits`,
of type `uint64`. There is no `pageViews` on this dataset. Every number the
Numbers panel draws from Cloudflare is therefore a count of arrivals, and the
spec's insistence that each card use the word matching what it counts is not
merely careful — it is the only word available.

**3. The dataset holds no rows for this site, and that is not an error.** The
committed document was accepted and returned `last28: []`. Grouping the whole
account by `siteTag` over 90 days shows why: the tag in `wrangler.toml` and
`index.html`, `de70f41296fe4d6486dbad51f983220f`, has **no rows at all**. The
rows that exist belong to two earlier tags from before the 2026-08-18
unification. The beacon fires and is accepted — the live-site load above got
HTTP 204 back from `/cdn-cgi/rum` under the production token — so this is a
dataset that started yesterday, not an obviously broken pipe.

**One thing this probe could not close, and it should be closed before Task 13
switches the snapshot job on.** That accepted pageload had still not appeared
in the API **two hours later**, under a 24-hour window with no `bot` filter.
Two explanations fit and this run cannot separate them: the dataset is adaptive
and the payload carried `"st":2`, so a single event is exactly what sampling
discards; or nothing written under this token is being retained at all. The
cheap way to tell them apart is volume — a handful of real visits over a day
will surface if ingestion works and will not if it does not. **Until one row
appears under `de70f41296fe4d6486dbad51f983220f`, treat every Cloudflare-fed
card as unproven end to end**, and read a zero on the panel as "no answer yet"
rather than "no visitors". The nightly snapshot job archives whatever this
returns, and archiving zeros is the one thing in this plan that cannot be
undone later.

There is a second reason the panel reads zero, and it is structural rather than
temporary: `worker/analytics.ts` sets `until` to **the start of today UTC**, so
the window ends at yesterday's midnight and today is never counted. For a site
whose visit history is measured in hours that is the whole history. The window
is not changed here — Task 4 is where the contract is cut — but any later task
that reads a zero off this route should know it is reading a window, not a
count.

**4. `npm run dev` traffic: UNRESOLVED, and the evidence in this file points
the other way.** An earlier revision recorded this as settled. It is not, and
the rows in this same file are what refute it.

Observed once: loading `http://localhost:8080` under a real Chromium produced a
console CORS error against `https://cloudflareinsights.com/cdn-cgi/rum` —
`Access-Control-Allow-Origin: http://localhost` against an origin carrying the
port. The raw output sits at the bottom of this file.

That observation does not support the conclusion drawn from it:

- **A CORS error is about what the page may READ, not about what was sent.**
  Chrome phrased it as an `Access-Control-Allow-Origin` mismatch on the
  response rather than "response to preflight request doesn't pass access
  control check", which is the wording for a POST that never left. So the
  likeliest reading is that Cloudflare received the measurement and the browser
  refused to hand the reply back to the page. The beacon never uses the reply
  for anything.
- **The observation only covers one of the beacon's two send paths.** Read
  from `https://static.cloudflareinsights.com/beacon.min.js` (31,612 bytes,
  fetched 2026-08-19): when `navigator.sendBeacon` is available it stamps
  `st: 1` and posts `new Blob([json], { type: 'application/json' })`; otherwise
  it stamps `st: 2` and posts the same body through `XMLHttpRequest` with
  `content-type: application/json`. A console message naming `XMLHttpRequest`
  is the `st: 2` path, and says nothing about `st: 1`. The production capture
  in this file also carried `"st":2`, so the two runs are not even comparing
  the same code path in the way the original claim assumed.
- **The 90-day grouping in this file contradicts the claim outright.** Under
  the two legacy site tags the rows are
  `{"requestHost":"localhost","siteTag":"29e1ba52…"} visits: 8100` and
  `{"requestHost":"localhost","siteTag":"7436888c…"} visits: 3200`, against
  `{"requestHost":"viabiancarestaurant.com","siteTag":"29e1ba52…"} visits: 0`.
  Whatever the mechanism, dev-server pageloads reached this dataset — under
  those tags, essentially all the recorded traffic was dev-server traffic. One
  negative observation in one browser on one day does not outweigh 11,300
  recorded localhost visits.

**So treat localhost traffic as recorded until something proves otherwise.**
`worker/analytics.ts` asks for no `requestHost` dimension and applies no
`requestHost` filter, and its header now says so and says what it costs: a
developer's `npm run dev` load of a public page is counted as an ordinary
visit, inside Card A's "about N visits" and inside Card B's page list. The
`/edit` exclusion does not catch it, because the path is `/`. That is accepted
residue with a written trade-off, not an absence.

The cheap way to settle it, if anyone wants to: run `npm run dev`, load a
public path that production never serves, and look for that path under
`de70f41296fe4d6486dbad51f983220f`. That is blocked behind the same open
question as the section above — nothing has appeared under the current tag yet
from any origin — so it cannot be run until ingestion is proven at all.

## One question this probe did not ask, and the next run should

**Does the filter accept a string operator on `requestPath`?** The probe
established that an equality filter works (`bot: 0` was accepted inside a real
grouping). It never tried `requestPath_notlike`, `requestPath_neq` or anything
else in that family, so nothing here supports putting one in the document.

It matters to one node. `hourly` groups by `datetimeHour x requestPath`, which
makes its group count `24 x days x trafficked-paths` and pushes it past
`limit: 1000` somewhere around ten to twenty days. Dropping `requestPath` from
the grouping would divide that count by the number of paths and bring even the
90-day range close to the ceiling, but `requestPath` is the field
`isExcludedPath` filters `/edit` on downstream. Drop it from the grouping and
the exclusion has to move upstream into the filter, which needs the operator
nobody has run.

Guessing it is the one mistake this file exists to stop. Every aliased node
lives in one document, a rejected field comes back HTTP 200 with `data: null`,
and the negative control below shows what that looks like: one wrong name took
the whole document down, not one card.

So `worker/analytics.ts` leaves `requestPath` in the grouping and orders the
node by `sum_visits_DESC` instead, which the base document already proved this
dataset accepts on this node. Truncation then drops the quietest cells rather
than the most recent hours. Add the filter to `scripts/verify-analytics-schema.mjs`,
run it, record the answer here, and the coarser grouping becomes a one-line
change to the document.

## How to re-run this

```
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=e352283475b003efeab1a35e45932927 \
  CF_WEB_ANALYTICS_SITE_TAG=de70f41296fe4d6486dbad51f983220f \
  node scripts/verify-analytics-schema.mjs
```

The token needs Account Analytics: Read and belongs in nothing this repository
tracks. The script only ever reads.

## Raw output

```
=== introspect AccountRumPageloadEventsAdaptiveGroupsDimensions ===
{"data":{"__type":{"fields":[{"name":"bot","type":{"kind":"NON_NULL","name":""}},{"name":"countryName","type":{"kind":"NON_NULL","name":""}},{"name":"customTagInternalSxg","type":{"kind":"NON_NULL","name":""}},{"name":"date","type":{"kind":"NON_NULL","name":""}},{"name":"datetimeFifteenMinutes","type":{"kind":"NON_NULL","name":""}},{"name":"datetimeFiveMinutes","type":{"kind":"NON_NULL","name":""}},{"name":"datetimeHalfOfHour","type":{"kind":"NON_NULL","name":""}},{"name":"datetimeHour","type":{"kind":"NON_NULL","name":""}},{"name":"datetimeMinute","type":{"kind":"NON_NULL","name":""}},{"name":"deliveryType","type":{"kind":"NON_NULL","name":""}},{"name":"deviceType","type":{"kind":"NON_NULL","name":""}},{"name":"navigationType","type":{"kind":"NON_NULL","name":""}},{"name":"refererHost","type":{"kind":"NON_NULL","name":""}},{"name":"refererPath","type":{"kind":"NON_NULL","name":""}},{"name":"refererScheme","type":{"kind":"NON_NULL","name":""}},{"name":"requestHost","type":{"kind":"NON_NULL","name":""}},{"name":"requestPath","type":{"kind":"NON_NULL","name":""}},{"name":"requestScheme","type":{"kind":"NON_NULL","name":""}},{"name":"siteTag","type":{"kind":"NON_NULL","name":""}},{"name":"userAgentBrowser","type":{"kind":"NON_NULL","name":""}},{"name":"userAgentOS","type":{"kind":"NON_NULL","name":""}}],"name":"AccountRumPageloadEventsAdaptiveGroupsDimensions"}},"errors":null}

=== introspect AccountRumPageloadEventsAdaptiveGroupsSum ===
{"data":{"__type":{"fields":[{"name":"visits","type":{"kind":"NON_NULL","name":"","ofType":{"kind":"SCALAR","name":"uint64"}}}],"name":"AccountRumPageloadEventsAdaptiveGroupsSum"}},"errors":null}

=== base document ===
HTTP 200
{"data":{"viewer":{"accounts":[{"last28":[]}]}},"errors":null}

=== requestPath, with the bot flag beside it ===
HTTP 200
{"data":{"viewer":{"accounts":[{"paths":[]}]}},"errors":null}

=== requestPath verdict ===
rows: 0, distinct paths: 0, carrying a query string: 0
no returned requestPath contained a "?"

=== date and datetimeHour groupings, with bot: 0 ===
HTTP 200
{"data":{"viewer":{"accounts":[{"byDay":[],"byHour":[]}]}},"errors":null}

=== negative control: a dimension introspection did NOT list ===
HTTP 200
{"data":null,"errors":[{"message":"unknown field \"datetimeDay\"","path":null,"extensions":{"timestamp":"2026-08-19T08:01:17.988805276Z","ray_id":"a2d7a1271a21fb2a-SEA"}}]}
REJECTED as required, so an acceptance above is a real acceptance.

=== sum fields ===
["visits"]

=== paste this into worker/analytics-schema.ts and the doc ===
{
  "verifiedOn": "2026-08-19",
  "baseDocumentAccepted": true,
  "dateDimension": "date",
  "hourDimension": "datetimeHour",
  "dimensions": [
    "bot",
    "countryName",
    "customTagInternalSxg",
    "date",
    "datetimeFifteenMinutes",
    "datetimeFiveMinutes",
    "datetimeHalfOfHour",
    "datetimeHour",
    "datetimeMinute",
    "deliveryType",
    "deviceType",
    "navigationType",
    "refererHost",
    "refererPath",
    "refererScheme",
    "requestHost",
    "requestPath",
    "requestScheme",
    "siteTag",
    "userAgentBrowser",
    "userAgentOS"
  ]
}
```

## Raw output — the four side probes

Run by hand beside the script, because each answers a question about the data
rather than about the schema, and none of them belongs in a verdict a later
task branches on.

```
--- every siteTag in the account, 90 days ---
{"data":{"viewer":{"accounts":[{"p":[
  {"dimensions":{"requestHost":"localhost","siteTag":"29e1ba52fba74885a5fc44875a48a078"},"sum":{"visits":8100}},
  {"dimensions":{"requestHost":"localhost","siteTag":"7436888c55284db5af771c11311a10cc"},"sum":{"visits":3200}},
  {"dimensions":{"requestHost":"viabiancarestaurant.com","siteTag":"29e1ba52fba74885a5fc44875a48a078"},"sum":{"visits":0}}
]}]}},"errors":null}

--- requestPath on the two legacy tags, 90 days ---
29e1ba52fba74885a5fc44875a48a078 rows: 21 distinct paths: 12 with "?": 0
["/edit","/edit/manage/menu","/edit/manage/story","/edit/manage/numbers","/edit/manage/pages","/edit/manage/details","/edit/manage","/","/membership","/cheeseboards","/cooking-class","/breads-and-dips"]
7436888c55284db5af771c11311a10cc rows: 15 distinct paths: 10 with "?": 0
["/edit/manage/story","/edit","/edit/manage/menu","/edit/manage/numbers","/edit/manage/pages","/blog/bw-hotelier-regional-flair","/edit/manage","/edit/manage/details","/","/lander"]

--- the beacon's own payload, live site, tagged URL, real Chromium ---
GET  https://static.cloudflareinsights.com/beacon.min.js
POST https://cloudflareinsights.com/cdn-cgi/rum -> 204
loaded: https://viabiancarestaurant.com/?utm_source=vbprobe
location field sent: "https://viabiancarestaurant.com/"
siteToken sent: "de70f41296fe4d6486dbad51f983220f"

--- the same load from the dev server ---
loaded: http://localhost:8080/?utm_source=vbprobe&utm_medium=schemaprobe
location field composed: "http://localhost:8080/"
POST https://cloudflareinsights.com/cdn-cgi/rum -> net::ERR_FAILED
console: Access to XMLHttpRequest at 'https://cloudflareinsights.com/cdn-cgi/rum'
from origin 'http://localhost:8080' has been blocked by CORS policy: the
'Access-Control-Allow-Origin' header has a value 'http://localhost' that is
not equal to the supplied origin.
```
