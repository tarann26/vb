# Numbers, drawn: charts, tagged links, and history that outlives Cloudflare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Numbers panel a trend chart, bar lists, stat cards with a comparison against the previous period, a busiest-times chart and a campaign card fed by our own rows; give it a range control and an archive that outlives Cloudflare's six-month window; and close all twenty-one parked backlog items on the way past, because there is no later.

**Architecture:** Ordered by **risk retired per task**. Tier 0 settles the two unknowns everything else rests on: Task 1 runs the Cloudflare GraphQL document — and a schema introspection beside it — against the real API and records the verdict as both a document and a typed constant that later tasks branch on; Task 2 caps Playwright's parallelism so every subsequent task's green run is evidence rather than luck. Tier 1 (Tasks 3–15) is every path that can put a **false number** on the screen, in descending order of how silently it fails: the stale counting-start date, the frozen payload contract with a per-range cache key, the comparison arithmetic, one migration file, one module holding every D1 statement this feature will ever issue, then the campaign write path end to end — Worker, client, and a browser-observed proof that one tagged arrival plus four real in-app route changes emits exactly one request. Tier 2 (Tasks 16–23) is the drawing, which can be ugly but never wrong, and every task in it states its CSS-ceiling consequence. Tier 3 (Tasks 24–30) closes the backlog. **The payload type is cut once, at Task 4, and never re-cut** — that is the structural reason the two conditional features are branches rather than forks, and it is why nothing after Task 15 can invalidate anything before it.

**Tech Stack:** React 18 + TypeScript (solution-style project references), Vite, Tailwind (JIT, content-scanned), Vitest + jsdom (`src/`, `scripts/`, `worker/`), Playwright (`e2e/`), Cloudflare Pages + Workers + KV + D1, hand-written SVG with no charting library.

**Spec:** `docs/superpowers/specs/2026-08-18-dashboard-analytics-visuals-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section. The first block is copied from the project rules and is non-negotiable.

- `npx tsc -b --noEmit` is the **only** typecheck that works here (solution-style tsconfig). `noUnusedLocals` is on, so a helper whose last call site a task deletes is a hard build failure, not a warning.
- **Every test must be able to fail, proven by mutating the code and watching it go red.** A test that cannot fail is a defect. Unfalsifiable assertions have slipped through this project **six** times. Every task below carries a mutation table and every row of it is to be *run*, not reasoned about.
- jsdom has **no layout engine**. Rendering, geometry, occlusion and computed-style claims go in `e2e/`, never `src/test/`. **An SVG chart is geometry**, so every claim about where a line, a bar or a cell actually lands is an `e2e/` claim.
- `e2e/*.spec.ts` is in **no** tsconfig project. `npx tsc -b --noEmit` checks not one line of it, and Vitest does not typecheck either; eslint and Playwright at runtime are the only checks a spec file gets.
- Tailwind's content scanner is a plain text extractor with **no JS parser**. A utility-class-looking word in an ordinary prose comment inside `./src/**` or `./index.html` mints a real CSS rule. It has happened **six** times here, most recently from the word "shrink". Every task that writes a comment into `src/` ends with a re-read of that comment for bare utility tokens. Words to hunt for in this plan's own prose: `grid`, `shrink`, `grow`, `italic`, `collapse`, `invisible`, `resize`, `visible`, `fixed`, `static`, `block`, `inline`, `table`, `container`, `flex`, `order`. `worker/`, `e2e/`, `docs/`, `scripts/`, `wrangler.toml` and `tailwind.config.js` are outside the glob and are not subject to this.
- **The entry CSS ceiling is 39200 against a measured 39037: 163 bytes of headroom.** A task that breaches it **raises it in the same commit**, to a measured number, with a rule-level accounting. Deferring a breach to a later task once left this build red for eleven tasks. Every task below states its own CSS-ceiling consequence, and **no task may leave the branch red**.
- Brand blue `#C8D8E8` is a **surface** colour only (1.45:1 on white). Foreground text and icons on light backgrounds use accent `#9D4949` (6.03:1). A contrast sweep over every text node governs, and every new card, axis label and caption is inside its scope.
- `playwright.config.ts` is `fullyParallel` with no worker cap and no retries, and the pre-push hook runs the whole suite and has failed three times on three **different** tests. Fixing that is backlog item 14 and it is **Task 2**, because twenty-eight tasks are about to be verified by that suite.
- **Never mention AI or any AI assistant in a commit message, and never add a co-author line.**
- `npm test` and `npm run test:deploy` are different commands over different file sets. Only `test:deploy` runs on Cloudflare, and `src/test/homepage-bytes.test.tsx` must stay excluded from it (`src/test/hosting.test.ts` asserts the exclusion).
- A push to `main` deploys Pages only. Worker changes need `npx wrangler deploy` separately, and **that command replaces the Worker's route list with exactly what `wrangler.toml` declares** and replaces its cron schedule with exactly what `[triggers] crons` declares.

Six more, specific to this plan.

- **Task 1 is a gate, not a checklist item.** Tasks 13, 15 and 21 read `RUM_CAPABILITIES` from Task 1 and take a written branch. No task may guess at it, and no task in Tiers 1–2 may start before Task 1's constant is committed. If the human running Task 1 has no Cloudflare token, the plan stops at Task 1 — it does not proceed on an assumption, which is precisely what `worker/analytics.ts:19-67` refuses to do today. Tasks 2 and 24–30 are independent of the schema and may proceed.
- **The payload shape is frozen at Task 4 and never re-cut.** Every field any later task needs — `range`, `series`, `seriesGrain`, `seriesSource`, `seriesStartsOn`, `hourly`, `campaigns`, `campaignsAreExact`, `visitsPrevious`, `tapsPrevious`, `yearAvailable` — exists from Task 4 onward, with `hourly: AnalyticsHourCell[] | null` carrying the busiest-times cut inside the type itself and `AnalyticsSeriesPoint.complete` carrying the partial-month marker. **A task that discovers it needs a field the contract does not have has found a defect in this plan, not a licence to edit Task 4's file downstream.**
- **The cache shape-version ledger.** `CACHE_KEY_PATH` is `/__cache/analytics/v1` today. A stale v1 body reaching a UI that expects a new field is refused by the payload guard and renders as `upstream-error` — an owner-visible outage for ten minutes after every deploy, for no reason. So the key carries a shape version, and **any task that changes `AnalyticsPayload` bumps it**. The schedule this plan spends:
  - **v2 — Task 4.** The whole shape, cut once: range, series, hourly, campaigns, the two previous-period numbers, `yearAvailable`.
  - **v3, v4, v5, v6 — reserved and deliberately unspent.** This plan cuts the shape exactly once, so it needs exactly one version. They are named here so that if a task is later cut or a field is later genuinely needed, the next version to spend is v3.
  - **The rule, which holds whatever happens: a cut task's version is never renumbered.** If a task that would have spent v4 is struck, v4 is simply never used. Renumbering is how two deploys come to disagree about which shape a key means.
  - `worker/__tests__/analytics.test.ts` asserts the stored cache key contains the current version string (Task 4, Step 6). That turns a ten-minute stale-payload outage after every deploy into a red test.
- **One aliased GraphQL document, one upstream fetch.** `worker/analytics.ts:70-77` budgets four subrequests worst case (`cache.match`, one GraphQL fetch, one `KV.get`, `cache.put`). This plan adds D1 reads, which are **not** subrequests, and adds **no second `fetch` on the request path**. Anything that would need one is either a new aliased node in the existing document (Tasks 13, 15, 19) or served from D1 without touching Cloudflare (Task 14). The budget comment is recomputed in Task 12 and again in Task 14.
- **KV is not used for anything new.** KV Free allows 1,000 writes/day across the whole namespace and roughly 800 are committed (`worker/index.ts:1225-1245`, `WA_DAILY_CAP`). The campaign write path is D1-backed and rate-controlled without a single KV write.
- **Build order is risk-first; deploy order is card-first.** The write path (Tasks 8–10) is built before the card that shows its numbers (Task 20) because it is the largest false-number risk in the plan. It is **not switched on** first: `npx wrangler deploy` for `/api/campaign` happens in **Task 20's** step list, after the card and its empty state exist. Counting arrivals from links nobody has been told how to make spends real days for nothing, and the card's empty state is what teaches her the link format.

---

## Decisions this plan makes where the spec is silent

Collected so a reviewer can reject one without reading the whole plan. Each is restated inside the task that implements it.

**R1 — The verification result is a typed constant, not prose alone.** A markdown file recording "we checked, `date` works" is unreadable by `tsc`, and the next reader would still have to trust it. Task 1 commits `worker/analytics-schema.ts` exporting `RUM_CAPABILITIES`, and `docs/analytics-schema-verification.md` holding the exact request, the introspected dimension list and the response. A test parses the fenced JSON block out of the document and deep-equals it against the constant, so the two cannot drift and neither can be edited alone.

**R2 — The verification asks the schema, it does not guess at names.** Firing three speculative documents and reading the rejections cannot tell a missing field from a wrong type name — they look identical from the outside, and only one of them is an answer. Task 1 therefore runs GraphQL **introspection** on the dataset's `…Dimensions` type and enumerates what the dataset actually offers, then runs the real document. The introspected list is what supplies the field **spelling**; the document run is what proves the committed query is accepted.

**R3 — The range is four values, never a number.** `?range=7d|30d|90d|year`, anything else falls back to `30d`. Not `?days=90`: a numeric parameter is an unbounded cache-key space behind the endpoint whose entire load control is one Cache API entry (`worker/analytics.ts:545-550`). Four values means at most four entries, so the worst case is four upstream GraphQL calls per ten minutes per colo — 24 an hour, against a quota measured in hundreds a minute. That number is stated here so nobody has to re-derive it.

**R4 — The default window becomes 30 days, not 28.** The spec says "Default 30 days" and `WINDOW_DAYS` is 28 today. Changing it moves Card A's number and `bookingTaps.days` with it. This is a deliberate, one-time restatement of what the panel means, done at Task 4 where the contract is cut, and never again. `MIN_DAYS_FOR_RATIO = 7` is unaffected.

**R5 — Unknown campaign sources are collapsed at the WRITE boundary, not at read.** `src/shared/campaign-sources.ts` holds the vocabulary; anything else is stored as the literal string `other`. Two reasons, and the second is load-bearing: the spec wants a card that does not fill with `fbclid` noise, *and* an endpoint on the public internet that accepts an arbitrary string into a table can be made to fill that table with millions of distinct strings by anyone who finds it. Collapsing at write bounds the key space to seven values forever. **The cost, stated:** adding a source she wants named is a one-line edit plus a deploy, not a dashboard field. That is the right trade for a list that changes perhaps twice a year and the wrong one if it changes weekly.

**R6 — The campaign endpoint IS rate limited per address, and the address is never stored.** The spec says "rate limited per address, capped daily" and this plan implements exactly that, without a KV write and without a column that identifies anyone. The limiter row's key is `sha256(address + ':' + window + ':' + a committed salt)`, truncated — an opaque bucket that cannot be linked to an address without the address, cannot be linked across windows at all, and is **deleted when its window expires** by the same prune the snapshot job runs. The daily cap is the identical statement shape with a bucket of `day:<IST date>`, so both guards cost one row write each and neither needs a read-then-write race. `campaign_arrivals` itself holds a source and a day and nothing else.

**R7 — The tagged arrival is sent with `fetch(url, { keepalive: true })`, not `navigator.sendBeacon`.** Same survives-unload property. The difference is what can be proven about it: a beacon returns a boolean and is invisible to `page.route`, while a `keepalive` fetch is reliably visible to `page.on('request')`, routable, and returns a promise that can be `.catch()`ed. The spec demands the write path be "proven end to end, not merely called", and this is what makes that testable. Nothing awaits it.

**R8 — The daily snapshot job is built whether or not Cloudflare has a `date` dimension.** The spec presents the snapshot as the trend chart's *fallback*, but the archive that outlives Cloudflare needs it regardless. Building it unconditionally at Task 13 means the two branches of Task 1's answer differ by **one optional backfill step and three lines in one object literal** — not by which files exist. That is what stops the fallback branch from being a second plan.

**R9 — The trend chart always reads its series from D1 snapshots.** Following from R8: `payload.series` comes from `daily_visits` in both branches. `RUM_CAPABILITIES.dateDimension` decides only whether the job's **first run backfills** the previous ninety days from Cloudflare. This collapses the trend-chart branch from "two implementations" to "one optional step", so no later task can rewrite an earlier one whichever way the verification goes.

**R10 — `thisWeekVisits` / `priorWeekVisits` stay.** Card D's sentence and its tests (`src/admin/manage/analytics.ts:123-144`, `NumbersArea.test.tsx`) are correct and unaffected by the range control, which governs the *other* cards. **Reusing them for the range comparison would make Card D and the stat cards disagree at every range except 7d** — that specific disagreement is the reason `visitsPrevious`/`tapsPrevious` are their own fields, and the reason is written into the code comment at Task 19.

**R11 — The busiest-times card is carried by the TYPE from Task 4, so cutting it is not a rewrite.** `hourly: AnalyticsHourCell[] | null`. `null` means "this site cannot answer that question", which is not an empty chart and not an error. If Task 1 finds no hour dimension, Task 15 pins `null` with a test and Task 21 is checked off as CUT with no file touched.

**R12 — A partial month is drawn and labelled, never omitted.** `analytics_monthly` carries `complete INTEGER NOT NULL`, set from `days >= daysInMonth(month)`. A partial month keeps its column, its label gains an asterisk, and the caption reads "Months marked * are not complete." An omitted month is a gap she cannot see; an unlabelled short column is a collapse that did not happen. The spec asks for exactly this and it is the only place in this plan where the panel is allowed to draw a number it says is not comparable.

**R13 — The By-year button does not exist until the archive holds something.** The spec says "and — once the archive has filled — by year". `yearAvailable` is `SELECT COUNT(*) FROM analytics_monthly` being non-zero, folded into the existing D1 round trip, and `RangeControl` renders three buttons until it is true. Offering a fourth button on day one against an empty rollup teaches her the feature is broken.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `scripts/verify-analytics-schema.mjs` | Runs introspection plus the committed document against Cloudflare's GraphQL API and prints what came back. |
| `docs/analytics-schema-verification.md` | The recorded answer: the introspected dimension list, the request, the response, and a fenced JSON block that is the machine copy. |
| `worker/analytics-schema.ts` | `RUM_CAPABILITIES` — the typed constant Tasks 13, 15 and 21 branch on. |
| `worker/migrations/0002_analytics.sql` | `campaign_arrivals`, `campaign_rate`, `daily_visits`, `monthly_visits`. Idempotent, applied by hand. |
| `worker/analytics-store.ts` | **Every D1 statement this feature will ever issue**, over a plain `D1Database`. |
| `worker/campaign.ts` | `POST /api/campaign`: origin, limiter, cap, one row; and the panel's read. |
| `worker/rollup.ts` | The `scheduled` handler's work: yesterday's total into `daily_visits`, the last three months into `monthly_visits`, and the prune. |
| `src/shared/campaign-sources.ts` | The closed source vocabulary and its labels, shared by both runtimes. |
| `src/campaign.ts` | `arrivalToRecord` (pure) and the four-line impure wrapper that fires it. |
| `src/admin/manage/chart-geometry.ts` | Pure geometry: an area path, bar widths, chart cell rectangles. No React, no DOM. |
| `src/admin/manage/comparison.ts` | Percent change, direction, and when there is not enough history to claim one. |
| `src/admin/manage/TrendChart.tsx`, `BarList.tsx`, `StatCard.tsx`, `HoursChart.tsx` | The four drawings. |
| `src/admin/manage/RangeControl.tsx` | Three buttons, or four once the archive has filled. |
| `src/admin/__tests__/duplicate-labels.test.tsx` | The general scan that catches the *next* label collision. |
| `e2e/observe-writes.ts` | Records real outgoing requests, so no assertion has to touch a mock. |
| `e2e/campaign-write.spec.ts`, `e2e/publish-write.spec.ts`, `e2e/numbers-visuals.spec.ts` | Everything jsdom cannot honestly assert. |
| `e2e/README.md` | What the browser suite may and may not assume. |

**Modified**

| File | Change |
|---|---|
| `src/shared/analytics-payload.ts` | The v2 contract, plus `isAnalyticsPayload` moved here out of the panel. |
| `worker/analytics.ts` | Range parsing, versioned per-range cache key, the aliased nodes Task 1 licensed, D1 reads, the recomputed subrequest budget, the replaced P0 block. |
| `worker/index.ts` | `POST /api/campaign` routed; `scheduled` exported; `AbortSignal` on GitHub calls. |
| `worker/__tests__/fakeD1.ts` | Branches for every statement `analytics-store.ts` issues. |
| `wrangler.toml` | `crons` populated; the `[triggers]` comment rewritten, keeping the hazard paragraph. |
| `src/admin/areas/NumbersArea.tsx` | Seven cards, a range control, a per-range latch with a stale-answer guard. |
| `src/admin/manage/analytics.ts` | Two counting-start dates, the new headings, the campaign copy, the archive sentence. |
| `src/main.tsx` | One call, after render. |
| `e2e/edit-backend.ts` | v2 fixtures; `openDashboard` exported; `postWithBlocks`. |
| `src/test/bundle.post-build.test.ts`, `src/test/wrangler-config.test.ts`, `worker/__tests__/migrations.test.ts` | Measured ceilings, the cron pair, the new tables. |
| `playwright.config.ts` | A worker cap and one retry. |

**Deleted**

| File | Why |
|---|---|
| `src/admin/blocks/BlockList.tsx` and its test | Retired when the writing surface landed; unreferenced since. Backlog 16. |
| `src/content/press.json` and the `/edit/manage` Press panel | Superseded by the blog. Backlog 17. |

---

## The two conditional branches, in one place

| Branch | Decided by | If present | If absent |
|---|---|---|---|
| Reaching backwards on the trend chart | `RUM_CAPABILITIES.dateDimension` | **Task 13, Step 7** runs once, when `daily_visits` is empty, and backfills ninety days from Cloudflare grouped by the recorded dimension name. `seriesStartsOn` is then ninety days ago. | Step 7 is skipped, the skip is recorded in the verification document and in `worker/rollup.ts`'s header, and the chart starts the day the job was switched on. **No other file changes.** |
| The busiest-times chart | `RUM_CAPABILITIES.hourDimension` | **Task 15 BUILD** adds an `hourly` node and `hourCells`; **Task 21** draws it. | **Task 15 CUT** pins `hourly: null` with a test and records the cut; **Task 21** is checked off having touched no file, and `e2e/numbers-visuals.spec.ts` reports a `test.skip` rather than a failure. |

Neither branch changes the payload type, the file list, or any other card — `hourly: AnalyticsHourCell[] | null` and `seriesSource: 'snapshot' | 'backfilled'` are both declared at **Task 4**, before either branch is taken. That is what makes these branches rather than forks.

---

# Tier 0 — The unknowns, and the instrument that measures everything else

## Task 1: Verify the Cloudflare RUM schema, and record the answer

**Closes backlog item 21.** Retires the single largest unknown in this plan: six cards rest on a document nobody has ever run, and one wrong field name fails the whole document at once — every card, together, as a 502.

**Files:**
- Create: `scripts/verify-analytics-schema.mjs`
- Create: `docs/analytics-schema-verification.md`
- Create: `worker/analytics-schema.ts`
- Create: `worker/__tests__/analytics-schema.test.ts`
- Modify: `worker/analytics.ts` (replace the P0 block at lines 19-67)

**Interfaces:**
- Consumes: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_WEB_ANALYTICS_SITE_TAG` from the human's environment. Nothing in the repository holds them.
- Produces:
```ts
// worker/analytics-schema.ts
export interface RumCapabilities {
  /** ISO date the probe was actually run. Not the day it was written. */
  verifiedOn: string;
  /** True only if the exact document in worker/analytics.ts returned data with no errors[]. */
  baseDocumentAccepted: boolean;
  /** The dimension that groups rows by calendar day, EXACTLY as Cloudflare spells it, or null. */
  dateDimension: string | null;
  /** The dimension that groups rows by hour, EXACTLY as Cloudflare spells it, or null. */
  hourDimension: string | null;
  /** Every dimension name introspection returned, sorted. The evidence behind the two above. */
  dimensions: string[];
}
export const RUM_CAPABILITIES: RumCapabilities;
```

- [ ] **Step 1: The probe script — introspection first, then the real document**

```js
// scripts/verify-analytics-schema.mjs
//
// The prerequisite worker/analytics.ts has been carrying an honest apology
// about since it was written: nobody has ever run its GraphQL document
// against the real API. Run this, paste what it prints into
// docs/analytics-schema-verification.md, and set worker/analytics-schema.ts
// from the verdict block.
//
// INTROSPECTION FIRST, and that ordering is the point. Firing speculative
// documents and reading the rejections cannot tell "this dataset has no hour
// grouping" from "I guessed the field name wrong" -- the two look identical
// from out here and only one of them is an answer. So this asks the schema
// what dimensions exist and reads the SPELLING off the reply, and only then
// runs the committed document to prove it is accepted.
//
// Needs a Cloudflare API token with Account Analytics: Read. An agent cannot
// obtain one; a human runs:
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//   CF_WEB_ANALYTICS_SITE_TAG=... node scripts/verify-analytics-schema.mjs
//
// It only ever READS. Nothing is written anywhere, so a wrong token fails
// loudly and costs nothing.
const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

const accountTag = process.env.CLOUDFLARE_ACCOUNT_ID;
const siteTag = process.env.CF_WEB_ANALYTICS_SITE_TAG;
const token = process.env.CLOUDFLARE_API_TOKEN;

if (!accountTag || !siteTag || !token) {
  console.error('Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and CF_WEB_ANALYTICS_SITE_TAG.');
  process.exit(2);
}

const DAY_MS = 86_400_000;
const midnight = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const until = new Date(midnight).toISOString();
const since = new Date(midnight - 28 * DAY_MS).toISOString();

async function post(body) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, text, parsed };
}

// Candidate type names, tried in order. Cloudflare has spelled this type
// differently for zone-scoped and account-scoped datasets over time, so a
// 'null' answer for one name is NOT evidence of a missing dimension -- it is
// evidence of a wrong type name, which is a different thing entirely.
const DIMENSION_TYPES = [
  'AccountRumPageloadEventsAdaptiveGroupsDimensions',
  'ZoneRumPageloadEventsAdaptiveGroupsDimensions',
  'RumPageloadEventsAdaptiveGroupsDimensions',
];

async function introspectDimensions() {
  for (const name of DIMENSION_TYPES) {
    const { text, parsed } = await post({
      query: `{ __type(name: "${name}") { name fields { name type { name kind } } } }`,
    });
    console.log(`\n=== introspect ${name} ===`);
    console.log(text.slice(0, 4000));
    const fields = parsed?.data?.__type?.fields;
    if (Array.isArray(fields) && fields.length > 0) {
      return { typeName: name, names: fields.map((field) => field.name).sort() };
    }
  }
  // Not "there are no dimensions". This is "none of the three names I know
  // exists", and the next step is to introspect the account type by hand and
  // find whichever ...Dimensions type hangs off the dataset.
  console.log('\nNO KNOWN DIMENSIONS TYPE MATCHED. Introspect by hand before recording anything:');
  console.log('  { __type(name: "Account") { fields { name type { name } } } }');
  return { typeName: null, names: [] };
}

// The EXACT shape worker/analytics.ts sends today, reduced to one aliased
// node. If this is rejected, every card is already broken in production and
// the reason is in errors[].
const BASE = `query VerifyBase($accountTag: String!, $siteTag: String!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    last28: rumPageloadEventsAdaptiveGroups(
      filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until }
      limit: 1000
      orderBy: [sum_visits_DESC]
    ) { sum { visits } dimensions { requestPath refererHost } }
  } }
}`;

const dimensions = await introspectDimensions();

const base = await post({ query: BASE, variables: { accountTag, siteTag, since, until } });
console.log('\n=== base document ===');
console.log(`HTTP ${base.status}`);
console.log(base.text.slice(0, 4000));

const errors = Array.isArray(base.parsed?.errors) ? base.parsed.errors : [];
const accepted = base.status === 200 && errors.length === 0 && base.parsed?.data != null;

// The dimension names are READ OFF the introspection reply, never assumed.
// Cloudflare has used `date` and `datetimeDay` for the day grouping and
// `datetimeHour` for the hour one; whichever of them the reply actually
// lists is the one that goes in the constant.
const dateDimension = ['date', 'datetimeDay'].find((name) => dimensions.names.includes(name)) ?? null;
const hourDimension = ['datetimeHour', 'hour'].find((name) => dimensions.names.includes(name)) ?? null;

console.log('\n=== paste this into worker/analytics-schema.ts and the doc ===');
console.log(
  JSON.stringify(
    {
      verifiedOn: new Date().toISOString().slice(0, 10),
      baseDocumentAccepted: accepted,
      dateDimension,
      hourDimension,
      dimensions: dimensions.names,
    },
    null,
    2,
  ),
);
```

- [ ] **Step 2: A human runs it, once**

```
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... CF_WEB_ANALYTICS_SITE_TAG=... \
  node scripts/verify-analytics-schema.mjs | tee /tmp/rum-verify.txt
```

If the script prints `NO KNOWN DIMENSIONS TYPE MATCHED`, **do not record `dateDimension: null`.** Introspect `Account` by hand, find whichever `…Dimensions` type hangs off `rumPageloadEventsAdaptiveGroups`, add its name to `DIMENSION_TYPES`, and re-run. A wrong type name and a missing field look the same from here and only one of them is a fact.

If no token is available, **stop here.** Do not write a capabilities constant from a guess. Tasks 2 and 24–30 are independent of the schema and may proceed; Tasks 3–23 may not.

- [ ] **Step 3: `docs/analytics-schema-verification.md`**

The whole `tee` output goes in verbatim under a `## Raw output` heading, preceded by:

````md
# The Cloudflare RUM schema, verified

Run: `node scripts/verify-analytics-schema.mjs`, on the date below, by a human
with a Cloudflare API token carrying Account Analytics: Read.

This file exists because `worker/analytics.ts` shipped with a document nobody
had run, and said so at length rather than claiming otherwise. This is the
answer, so the next reader neither repeats the probe nor guesses at it.

## Verdict

```json
{
  "verifiedOn": "2026-08-18",
  "baseDocumentAccepted": true,
  "dateDimension": "date",
  "hourDimension": "datetimeHour",
  "dimensions": ["bot", "date", "datetimeHour", "deviceType", "refererHost", "requestPath", "userAgentBrowser"]
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

<one plain paragraph naming which of the two conditional surfaces was built
and which was struck, and, if either was struck, naming the dimensions
Cloudflare DID offer so the next reader does not re-run the same query hoping
for a different answer.>

## Raw output

<the tee'd output, unedited>
````

The five values in that JSON block are whatever the run printed. If the run printed `false` or `null`, those go in, unedited — a verification document that records the outcome somebody wanted is worse than none.

- [ ] **Step 4: `worker/analytics-schema.ts`**

```ts
// What Cloudflare's RUM dataset actually answers, established by running the
// document rather than by reading documentation about it. The evidence is in
// docs/analytics-schema-verification.md; this file is the same answer in a
// shape tsc can read.
//
// The two dimension names are SPELLINGS READ OFF AN INTROSPECTION REPLY, not
// names somebody remembered. `dimensions` carries the whole list the reply
// gave, because that is what makes the two names above checkable by a reader
// who was not there.
//
// Three tasks branch on this and none of them may guess: Task 13 (whether
// the trend chart backfills), Task 15 (whether the busiest-times chart
// exists at all), Task 21 (whether it is drawn). Setting a value here from
// anything other than a real probe run reintroduces the exact defect this
// file closes.
export interface RumCapabilities {
  verifiedOn: string;
  baseDocumentAccepted: boolean;
  dateDimension: string | null;
  hourDimension: string | null;
  dimensions: string[];
}

export const RUM_CAPABILITIES: RumCapabilities = {
  verifiedOn: '2026-08-18',
  baseDocumentAccepted: true,
  dateDimension: 'date',
  hourDimension: 'datetimeHour',
  dimensions: ['bot', 'date', 'datetimeHour', 'deviceType', 'refererHost', 'requestPath', 'userAgentBrowser'],
};
```

- [ ] **Step 5: The drift guard**

```ts
// worker/__tests__/analytics-schema.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RUM_CAPABILITIES } from '../analytics-schema';

const DOC = 'docs/analytics-schema-verification.md';
const VERDICT_BLOCK = /```json\n([\s\S]*?)\n```/;

// The first fenced json block under "## Verdict". Anchored on the heading
// rather than "the first json block in the file", so an example added above
// it later does not silently become the thing under test.
function verdictFromDoc(): unknown {
  const text = readFileSync(DOC, 'utf8');
  const afterHeading = text.split('## Verdict')[1] ?? '';
  const found = afterHeading.match(VERDICT_BLOCK);
  if (!found) throw new Error(`${DOC} has no fenced json verdict block`);
  return JSON.parse(found[1]) as unknown;
}

describe('the recorded schema verification', () => {
  it('says the same thing in the document and in the constant', () => {
    expect(verdictFromDoc()).toEqual(RUM_CAPABILITIES);
  });

  it('records a real date, not a placeholder', () => {
    expect(RUM_CAPABILITIES.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('records the base verdict as a boolean, either way', () => {
    // Not `toBe(true)`: this must also pass on the honest failure branch,
    // where the answer is recorded as false and the document is being fixed.
    // What it forbids is the value being absent or a string.
    expect(typeof RUM_CAPABILITIES.baseDocumentAccepted).toBe('boolean');
  });

  it('only names a dimension the introspection reply actually listed', () => {
    // The whole reason `dimensions` is in the constant. A name here that is
    // not in that list is a name somebody remembered rather than read.
    for (const name of [RUM_CAPABILITIES.dateDimension, RUM_CAPABILITIES.hourDimension]) {
      if (name !== null) expect(RUM_CAPABILITIES.dimensions).toContain(name);
    }
  });

  it('carries the evidence list at all', () => {
    expect(RUM_CAPABILITIES.dimensions.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Replace the P0 block in `worker/analytics.ts:19-67`**

Delete the whole block headed `P0 -- THE STATE OF THE VERIFIED DOCUMENT` and put this in its place:

```ts
// THE DOCUMENT BELOW HAS BEEN RUN AGAINST THE REAL API.
//
// It had not been, for a long time, and this block used to say so. The
// evidence is docs/analytics-schema-verification.md (the introspected
// dimension list, the request, the response, the verdict) and
// worker/analytics-schema.ts (the same verdict, typed). Re-run
// `node scripts/verify-analytics-schema.mjs` and update both if this
// document is ever changed.
//
// Two things about the document are still deliberate and still load-bearing:
//   - No requestPath prefix filter goes upstream. /edit is excluded HERE, by
//     isExcludedPath, over returned rows. One filtered set feeds every card,
//     so a card's total and its breakdown cannot disagree.
//   - Every aliased node lives in ONE document. That is why a rejected field
//     takes every card down at once, and it is why the probe above exists.
```

- [ ] **Step 7: `npx tsc -b --noEmit && npx eslint scripts/verify-analytics-schema.mjs worker/analytics-schema.ts && npm test -- --run worker/__tests__/analytics-schema.test.ts`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| change `dateDimension` in the constant to `null` without editing the doc | "says the same thing in the document and in the constant" | — |
| change the `"hourDimension"` value inside the doc's fenced block only | "says the same thing in the document and in the constant" | — |
| set `verifiedOn: 'TBD'` | "records a real date, not a placeholder" | — |
| delete the `## Verdict` heading from the doc | "says the same thing…" — throws `has no fenced json verdict block` | — |
| change `baseDocumentAccepted` to the string `'true'` | "records the base verdict as a boolean, either way" | — |
| set `dateDimension: 'datetimeDay'` while the list still says `date` | "only names a dimension the introspection reply actually listed" | — |
| set `dimensions: []` and both names to `null` | **nothing reddens** — a genuinely empty dataset and a wrong type name are the same shape from in here | Add `expect(RUM_CAPABILITIES.dimensions.length).toBeGreaterThan(0)` — it is the fifth test above, and it is there for exactly this row. If it is somehow removed, put it back before finishing. |

**CSS ceiling:** zero bytes. Nothing in this task is inside `./src/**` or `./index.html`, so Tailwind's scanner never reads a byte of it.

**If this task is wrong:** every number on the Numbers screen is drawn from a query nobody has run, exactly as today, and the first time she opens the panel after this plan ships she gets "The visitor numbers aren't connected yet." on all seven cards at once, with no way to tell which field was the wrong one.

---

## Task 2: Make the browser suite deterministic

**Closes backlog item 14.** Retires a risk that compounds through every remaining task: the pre-push hook has failed three times on three *different* tests, all of which pass alone. Until that stops, a red run proves nothing and a green run proves less. This is Task 2 rather than Task 30 because twenty-eight tasks are about to be verified by this suite.

**Files:**
- Modify: `playwright.config.ts`
- Create: `e2e/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a suite whose failures are reproducible.

- [ ] **Step 1: Cap the workers and admit one retry**

In `playwright.config.ts`, inside `defineConfig({ ... })`, replace `fullyParallel: true,` with:

```ts
  // fullyParallel with no cap ran every spec in this directory at once
  // against ONE vite dev server on port 8080, and the pre-push hook failed
  // three times on three DIFFERENT sets of tests, every one of which passed
  // when run alone. That is the signature of contention, not of three bugs:
  // the dev server compiles on demand, several specs mock the same routes on
  // their own pages, and section-washes.spec.ts samples SCREENSHOT PIXELS,
  // which is the most timing-sensitive measurement in the suite.
  //
  // Files still run in parallel; tests inside one file now run in order.
  // That is the level the flakes were at -- two tests in one file racing the
  // same page's fonts -- and it costs a few seconds against a suite that
  // blocks every deploy at random today.
  fullyParallel: false,
  // Four, not `undefined` (which is cores, and is 10-14 on the machines this
  // runs on). Measured against the local suite: four workers keep the wall
  // clock inside the pre-push budget while leaving the dev server's compile
  // queue short enough that no spec waits past its own timeout.
  workers: 4,
  // ONE retry, and this is the part to be suspicious of: a retry can hide a
  // real intermittent defect as easily as it can absorb a scheduling blip.
  // It is admitted here ONLY alongside the cap above, and only because the
  // html reporter records `flaky` distinctly from `passed` -- so a spec that
  // needed its retry is visible in the report rather than laundered into
  // green. A spec that shows up flaky twice is a bug to fix, not a retry to
  // raise.
  retries: 1,
```

- [ ] **Step 2: Write down what the suite may and may not assume**

```md
<!-- e2e/README.md -->
# The browser suite

`npm run test:e2e`. Needs a Chromium binary that `npm install` does not
provide: `npx playwright install chromium`, once per machine.

## Rules this suite is held to

1. **Never assert a class name.** The dev server's Tailwind JIT never removes
   a rule inside a session, so a class assertion can be green against a
   stylesheet a cold production build would not produce. Assert computed
   style, geometry, or sampled pixels.
2. **Wait for fonts before measuring width.** `fontsSettled(page)` in
   `blog-controls.spec.ts`. Montserrat and the fallback measure 333.7px and
   365.3px for the same string, and that difference decides whether controls
   wrap.
3. **Use `await expect(locator).toHaveCSS(...)`, never a one-shot
   `evaluate(getComputedStyle)`, for anything that transitions.** A read taken
   immediately after a class flips returns the FROM value, which passes on a
   defect and fails on the fix.
4. **A navigation claim is asserted, not assumed.** `getByRole`'s name
   matching is substring and case-insensitive, so a click that hits the wrong
   element still "succeeds". Every in-app navigation in this suite is followed
   by `await expect(page).toHaveURL(...)`, so a test cannot be satisfied by
   standing still. This is not hypothetical: this site's whole nav bar is
   `#` fragments rendered as plain anchors, and a spec that clicked them
   believed it had changed four pages when it had scrolled.
5. **Tests inside one file run in order; files run four at a time.** Do not
   write a spec that assumes it owns the dev server.
6. **A `flaky` result in the html report is a bug.** The single retry exists
   to keep a scheduling blip from blocking a deploy, not to make an
   intermittent failure invisible. Two flaky runs of the same spec means fix
   the spec.
7. **The dev server serves `npm run dev`, so React StrictMode is live.**
   Every component mounts, unmounts and remounts. Anything that must happen
   once per document either runs at module scope or marks before it acts.
```

- [ ] **Step 3: Prove the cap is real, not aspirational**

```
for i in 1 2 3 4 5; do npm run test:e2e 2>&1 | tail -3; done
```

Five green runs with **zero `flaky`** lines is the bar. If any spec reports flaky, fix that spec before Task 3 — that is the point of putting this task second.

**Mutation table**

Playwright's own config has no unit test, and inventing one would be an unfalsifiable assertion about an object literal. The falsification here is procedural and is the Step 3 loop.

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| restore `workers: undefined` and `fullyParallel: true` | the Step 3 five-run loop reproduces a flake within five runs | This task's premise is unproven. Record that in `e2e/README.md` and **revert the config change** rather than keeping a change nothing demonstrated. |
| set `retries: 0`, keep the cap | Step 3 still passes five times | The cap did not fix the contention and the retry is hiding it. This task is not done; find the contending pair before continuing. |

**CSS ceiling:** zero bytes. `playwright.config.ts` and `e2e/**` are outside Tailwind's content glob.

**If this task is wrong:** she pushes a content edit from the dashboard, the pre-push hook fails on a test unrelated to anything she changed, and the site does not deploy — which is what happens today, three times over.

---
# Tier 1 — Everything that can put a false number on the screen

## Task 3: Two counting-start dates, each naming what it counts

**Closes backlog item 1.** The panel currently tells her visitor counting began 7 August 2026. It did not. That is the day the tap counter's beacon was hand-placed; the *visit* dataset was reset to zero on 2026-08-18 when commit `a212512` found the beacon and the Worker reading two different, disagreeing Web Analytics tokens and repointed both at a new one. She is told there is a week and a half of history where there are hours, so "not enough data yet" reads as her website being broken.

**One constant cannot do this job.** Splitting it is the whole item: the tap counter genuinely *has* been running since 2026-08-07, so a single date set to 2026-08-18 does not fix the bug, it moves it onto `noVisitsYetSentence` (`src/admin/manage/analytics.ts:190-199`), which would then date a real eleven-day tap history from eleven days later. Removing the default argument from `formatCountingStartedOn` is what makes that impossible: `tsc` refuses any call site that does not say which thing it is dating.

**Files:**
- Modify: `src/admin/manage/analytics.ts`
- Modify: `src/admin/areas/NumbersArea.tsx` (the banner sentence only)
- Modify: `src/admin/manage/__tests__/analytics.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
```ts
export const TAP_COUNTING_STARTED_ON: string;    // '2026-08-07'
export const VISIT_COUNTING_STARTED_ON: string;  // '2026-08-18'
export function formatCountingStartedOn(iso: string): string;  // NO DEFAULT ARGUMENT any more
```

- [ ] **Step 1: Replace the single constant at `src/admin/manage/analytics.ts:12-23`**

```ts
// ---------------------------------------------------------------------------
// When counting started. TWO dates, because two different things started on
// two different days and one card names each of them.
//
// TAPS have been counted since the day the Reserve a Table counter shipped.
// That number is a KV total with no expiry and it has been accumulating,
// honestly, since this date.
export const TAP_COUNTING_STARTED_ON = '2026-08-07';

// VISITS have been counted only since the Web Analytics token was unified.
// Until then the beacon on the page and the token the Worker queries were
// two DIFFERENT Cloudflare sites, both bound to a zone that has since been
// deleted -- so the panel was reading a dataset the page never wrote to.
// Repointing both at one new token reset the visible dataset to zero, and
// that reset was accepted rather than treated as a fault.
//
// This constant was the whole of backlog item 1. ONE date was doing TWO
// jobs, so the screen told her there was a week and a half of visit history
// on a dataset that was hours old, and "not enough data yet" read as her
// website being broken rather than as the panel being new. Note which
// direction the bug ran: the old value was RIGHT about taps and WRONG about
// visits, which is why setting the single constant to the new date would
// have moved the defect rather than closed it.
export const VISIT_COUNTING_STARTED_ON = '2026-08-18';
```

- [ ] **Step 2: Remove the default argument from `formatCountingStartedOn` (`:43`)**

```ts
// No default argument, deliberately. A default is what let ONE date serve
// two meanings for eleven days without anything on screen looking wrong:
// every call site now has to say which thing it is dating, and tsc refuses a
// call that does not.
export function formatCountingStartedOn(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
```

- [ ] **Step 3: Fix both call sites, naming what each dates**

`src/admin/manage/analytics.ts:190-199`, `noVisitsYetSentence` — **this sentence is about taps**:

```ts
export function noVisitsYetSentence(taps: number): string {
  return `We haven't started counting visits yet. ${count(taps)} ${
    taps === 1 ? 'person has' : 'people have'
  } tapped Reserve a Table since ${formatCountingStartedOn(TAP_COUNTING_STARTED_ON)}.`;
}
```

`src/admin/areas/NumbersArea.tsx`, the banner (the `<p className="font-semibold">` inside the `payload.visits === 0` block) — **this sentence is about visits**:

```tsx
              <p className="font-semibold">
                Visitor counting started on {formatCountingStartedOn(VISIT_COUNTING_STARTED_ON)}.
              </p>
```

and add `VISIT_COUNTING_STARTED_ON` to that file's import list from `../manage/analytics`.

- [ ] **Step 4: The drift guard, in `src/admin/manage/__tests__/analytics.test.ts`**

Replace the existing assertion at `:162` — `expect(sentence).toContain(formatCountingStartedOn(COUNTING_STARTED_ON))` — with the literal. That assertion self-updates against whatever the constant says and therefore cannot fail on the defect it is meant to guard.

```ts
describe('when counting started', () => {
  // The bug this replaces was invisible for eleven days because ONE date was
  // right about taps and wrong about visits and nothing said which it meant.
  // Both assertions are LITERALS, not `toContain(format(CONSTANT))`: the
  // second form re-derives the expected string from the value under test and
  // stays green through every possible wrong answer.
  it('dates taps from the day the tap counter shipped', () => {
    expect(noVisitsYetSentence(3)).toContain('since 7 August 2026.');
  });

  it('dates visits from the day the Web Analytics token was unified', () => {
    expect(formatCountingStartedOn(VISIT_COUNTING_STARTED_ON)).toBe('18 August 2026');
  });

  it('keeps the two apart', () => {
    expect(VISIT_COUNTING_STARTED_ON).not.toBe(TAP_COUNTING_STARTED_ON);
  });

  it('formats without the machine locale getting a vote', () => {
    // "8/7/2026" reads as the 8th of July in India. Hand-formatted for that
    // reason; this is the assertion that stops a future toLocaleDateString.
    expect(formatCountingStartedOn('2026-08-07')).toBe('7 August 2026');
  });
});
```

- [ ] **Step 5: `npx tsc -b --noEmit` — expect it to fail first**

`tsc` now flags every remaining zero-argument `formatCountingStartedOn()` call, including in test files. **That failure list is the audit** of every place the old constant was doing two jobs. Fix each by naming the date it means; do not restore the default. The branch is green again at the end of this step, not later.

- [ ] **Step 6: Re-read every comment added in this task for bare utility-class tokens.** Both files are inside Tailwind's glob.

- [ ] **Step 7: `npx tsc -b --noEmit && npm test -- --run src/admin/manage/__tests__/analytics.test.ts src/admin/areas/__tests__/NumbersArea.test.tsx`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| set `VISIT_COUNTING_STARTED_ON = '2026-08-07'` | "keeps the two apart", and "dates visits from the day the Web Analytics token was unified" | — |
| point `noVisitsYetSentence` at `VISIT_COUNTING_STARTED_ON` | "dates taps from the day the tap counter shipped" | — |
| point the banner at `TAP_COUNTING_STARTED_ON` | `NumbersArea.test.tsx`'s banner assertion | If that assertion reads `toContain(formatCountingStartedOn(...))`, it self-updates and stays green. Rewrite it to the literal `'Visitor counting started on 18 August 2026.'` before finishing. |
| replace the hand formatter with `new Date(iso).toLocaleDateString()` | "formats without the machine locale getting a vote" | — |
| restore the default argument and drop both call-site arguments | **nothing reddens** | This is why Step 2 removes the default rather than leaving it and trusting discipline. There is no test for this row; the guard is `tsc`, and the check is that `formatCountingStartedOn` has no `=` in its parameter list. |

**CSS ceiling:** zero bytes. Two string constants and one existing `<p>`; no class changes.

**If this task is wrong:** she opens Numbers, reads that counting started eleven days ago, sees near-zero everywhere, and concludes the website has stopped receiving visitors.

---

## Task 4: The payload contract, cut once, with a versioned per-range cache key

Retires the risk that every later task builds against a payload shape that then moves. Freezes **v2** of the contract in one module both sides import, moves the shape guard into that module, keys the Cache API entry on the range *and* the shape version, and states R3, R4 and R13 in the code that implements them. **No later task may add a field to `AnalyticsPayload`.**

**Files:**
- Modify: `src/shared/analytics-payload.ts`
- Modify: `worker/analytics.ts`
- Modify: `src/admin/areas/NumbersArea.tsx` (delete `isPayload`, import the shared guard)
- Modify: `e2e/edit-backend.ts`
- Modify: `worker/__tests__/analytics.test.ts`
- Modify: `src/shared/__tests__/analytics-payload.test.ts`

**Interfaces:**
```ts
export type AnalyticsRange = '7d' | '30d' | '90d' | 'year';
export const DEFAULT_RANGE: AnalyticsRange;                 // '30d'
export const RANGE_DAYS: Record<AnalyticsRange, number>;    // 7 | 30 | 90 | 365
export const PAYLOAD_SHAPE_VERSION: 'v2';
export function parseRange(raw: string | null): AnalyticsRange;
export function isAnalyticsRange(value: unknown): value is AnalyticsRange;
export function isAnalyticsPayload(value: unknown): value is AnalyticsPayload;
export interface AnalyticsSeriesPoint { date: string; visits: number; complete: boolean }
export interface AnalyticsHourCell { day: number; hour: number; visits: number }
export interface AnalyticsCampaignRow { source: string; label: string; arrivals: number }
```

- [ ] **Step 1: The new types in `src/shared/analytics-payload.ts`**

```ts
// The four ranges, and only four. NOT `?days=<number>`: this endpoint's
// entire load control is one Cache API entry, and a numeric parameter is an
// unbounded key space and therefore an unbounded number of upstream GraphQL
// calls. Four values means at most four entries, so the worst case is four
// upstream calls per ten minutes per colo -- 24 an hour, against a quota
// measured in hundreds a minute.
export type AnalyticsRange = '7d' | '30d' | '90d' | 'year';

// 30, not the 28 this panel shipped with. The spec asks for 30 and the
// difference is two days of a number already labelled an estimate; changing
// it once, here, where the contract is cut, is cheaper than carrying two
// window lengths that mean nearly the same thing.
export const DEFAULT_RANGE: AnalyticsRange = '30d';

export const RANGE_DAYS: Record<AnalyticsRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  // A year is served entirely from our own monthly rollup and never touches
  // Cloudflare, which holds about six months.
  year: 365,
};

// The SHAPE version, and it is part of the cache key.
//
// A body written by the previous deploy deserialises into a payload with no
// `series` and no `campaigns`, which isAnalyticsPayload below correctly calls
// an error -- so without this the dashboard would show
// "the visitor numbers aren't connected yet" for the ten minutes each deploy
// takes to age out its own cache entries. Bumping the version retires every
// old entry at once instead of waiting and hoping.
//
// THE LEDGER, so the next reader knows which versions are spent:
//   v1  the shape this panel shipped with.
//   v2  THIS cut -- range, series, hourly, campaigns, the previous-period
//       numbers, yearAvailable. The shape is cut ONCE in this plan, so v2 is
//       the only version it spends.
//   v3..v6  reserved, deliberately unspent. If a field is genuinely needed
//       later, v3 is next.
// THE RULE: a version belonging to a task that gets cut is never renumbered.
// Renumbering is how two deploys come to disagree about what a key means.
export const PAYLOAD_SHAPE_VERSION = 'v2' as const;

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return value === '7d' || value === '30d' || value === '90d' || value === 'year';
}

// Anything unrecognised is the default, never an error. A caller who types
// `?range=90` or `?range=<script>` gets the 30-day answer, one cache entry is
// consulted, and no branch of this Worker ever sees an unbounded string.
export function parseRange(raw: string | null): AnalyticsRange {
  return isAnalyticsRange(raw) ? raw : DEFAULT_RANGE;
}

// One point per bucket, ascending. `date` is 'YYYY-MM-DD' at day grain and
// 'YYYY-MM' at month grain -- ONE type for both, because a MonthlyPoint
// identical to a DailyPoint but for the string format would mean two chart
// components tomorrow. The payload's `seriesGrain` says which it is.
export interface AnalyticsSeriesPoint {
  date: string;
  visits: number;
  // False only for a month the archive holds partially. The first year of the
  // by-year view IS a partial year and cannot be made otherwise, so the panel
  // marks the column rather than drawing a short one beside full ones and
  // letting her read a collapse into it. Always true at day grain.
  complete: boolean;
}

// `day` is 0-6 with 0 = Sunday; `hour` is 0-23 in IST, because a restaurant
// deciding when to staff thinks in its own evenings, not in UTC.
export interface AnalyticsHourCell {
  day: number;
  hour: number;
  visits: number;
}

// EXACT, unlike everything else on this screen: these are rows we wrote
// ourselves, not a sampled estimate. `source` is one of the seven the Worker
// will store; `label` is the words the card shows.
export interface AnalyticsCampaignRow {
  source: string;
  label: string;
  arrivals: number;
}
```

- [ ] **Step 2: Extend `AnalyticsPayload` — the last time it changes**

Append to the interface:

```ts
  // Which range produced everything above. Echoed back rather than assumed,
  // so a cached body served under the wrong key is visible on screen instead
  // of silently relabelling 90 days as 30 -- and so the panel can discard an
  // answer for a range she is no longer looking at.
  range: AnalyticsRange;

  // The trend chart's series, ascending.
  series: AnalyticsSeriesPoint[];
  seriesGrain: 'day' | 'month';
  // 'snapshot' means the archive starts the day the nightly job was switched
  // on. 'backfilled' means its first run reached ninety days backwards. The
  // chart's caption SAYS which, rather than beginning at an unexplained zero.
  seriesSource: 'snapshot' | 'backfilled';
  // The first bucket the archive holds, or null when it holds nothing.
  seriesStartsOn: string | null;

  // The busiest-times chart, or null meaning THIS SITE CANNOT ANSWER THAT.
  // null is not an empty set of cells and is not an error: Cloudflare's RUM
  // dataset either exposes an hour dimension or it does not
  // (worker/analytics-schema.ts), and when it does not the card is not drawn.
  hourly: AnalyticsHourCell[] | null;

  // Tagged arrivals, ours, exact, ordered by volume.
  campaigns: AnalyticsCampaignRow[];
  campaignsAreExact: true;

  // The same two measures over the PREVIOUS equivalent period, for the
  // comparison on the stat cards. Zero is a real answer here and means the
  // previous period genuinely had none.
  visitsPrevious: number;
  tapsPrevious: number;

  // Whether the monthly rollup holds anything at all. The range control
  // renders three buttons until this is true -- the spec says "once the
  // archive has filled", and offering a fourth button against an empty
  // rollup on day one teaches her the feature is broken.
  yearAvailable: boolean;
```

and extend `ZERO_DATA_PAYLOAD`:

```ts
export const ZERO_DATA_PAYLOAD: AnalyticsPayload = {
  windowDays: RANGE_DAYS[DEFAULT_RANGE],
  visits: 0,
  visitsAreEstimate: true,
  byPath: [],
  byReferer: [],
  thisWeekVisits: 0,
  priorWeekVisits: 0,
  bookingTaps: { total: 0, days: RANGE_DAYS[DEFAULT_RANGE], lowerBound: true },
  range: DEFAULT_RANGE,
  series: [],
  seriesGrain: 'day',
  seriesSource: 'snapshot',
  seriesStartsOn: null,
  hourly: null,
  campaigns: [],
  campaignsAreExact: true,
  visitsPrevious: 0,
  tapsPrevious: 0,
  yearAvailable: false,
};
```

- [ ] **Step 3: Move the shape guard here, out of `NumbersArea.tsx:86-99`**

The module that **defines** the shape is the module that decides whether a body has it, and the Worker's own tests can then assert that what it emits passes the same guard the panel applies.

```ts
// A 200 whose body is not this shape is an ERROR, not an empty state -- the
// same refusal worker/status.ts documents for Cloudflare's REST
// `success: false`. Collapsing a malformed answer into "nothing to report"
// reports the most reassuring state possible at exactly the wrong moment,
// and here it would also throw mid-render on the first
// `undefined.toLocaleString()`, costing the whole area rather than one card.
//
// Structural rather than exhaustive: this guards against a shape change and
// a proxy's error page, not against a malicious server, and a check per leaf
// would be a second schema to keep in step with the first.
export function isAnalyticsPayload(value: unknown): value is AnalyticsPayload {
  if (value === null || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  const numbers = ['visits', 'windowDays', 'thisWeekVisits', 'priorWeekVisits', 'visitsPrevious', 'tapsPrevious'];
  if (!numbers.every((key) => typeof body[key] === 'number')) return false;
  const lists = ['byPath', 'byReferer', 'series', 'campaigns'];
  if (!lists.every((key) => Array.isArray(body[key]))) return false;
  if (!isAnalyticsRange(body.range)) return false;
  if (body.seriesGrain !== 'day' && body.seriesGrain !== 'month') return false;
  if (body.seriesSource !== 'snapshot' && body.seriesSource !== 'backfilled') return false;
  if (body.hourly !== null && !Array.isArray(body.hourly)) return false;
  if (typeof body.yearAvailable !== 'boolean') return false;
  const taps = body.bookingTaps as Record<string, unknown> | undefined;
  return typeof taps?.total === 'number' && typeof taps?.days === 'number';
}
```

Then **delete** `isPayload` from `NumbersArea.tsx` and import `isAnalyticsPayload` instead. `noUnusedLocals` makes leaving the old copy behind a hard build failure, which is the guarantee that both do not survive.

- [ ] **Step 4: The Worker reads the range and keys its cache on range AND version**

In `worker/analytics.ts`, replace `WINDOW_DAYS = 28` and the cache constants:

```ts
const WEEK_DAYS = 7;
const DAY_MS = 86_400_000;
const BYPATH_LIMIT = 10;
const OTHER_HOSTS_LIMIT = 5;

// The key carries BOTH the shape version and the range. The version retires
// every entry written by the previous deploy the moment this one lands (see
// PAYLOAD_SHAPE_VERSION's own ledger); the range is what stops four
// different questions sharing one answer.
const CACHE_KEY_PREFIX = `/__cache/analytics/${PAYLOAD_SHAPE_VERSION}`;
const CACHE_TTL_SECONDS = 600;
```

and replace the cache-key construction:

```ts
  const cache = caches.default;
  // ONE query parameter is read, and it can take four values. See
  // src/shared/analytics-payload.ts's parseRange for why it is an enum and
  // not a number: this endpoint's entire load control is the entry below, and
  // a numeric parameter would make the key space unbounded.
  //
  // Unrecognised input is not an error -- `?range=90`, `?range=` and
  // `?range=<anything>` all produce the 30-day key, the 30-day upstream call
  // and the 30-day body, and that is pinned by a test.
  const range = parseRange(new URL(request.url).searchParams.get('range'));
  const windowDays = RANGE_DAYS[range];
  const cacheKey = new Request(new URL(`${CACHE_KEY_PREFIX}/${range}`, request.url).toString());
```

Then replace every remaining `WINDOW_DAYS` in the handler with `windowDays`, rename the document's `$since28` to `$sinceWindow` (declaration and the `last28` node's filter — the *alias* `last28` stays, since renaming it would touch `RumAccount`, `rowsOf` and four tests for no behavioural gain), and add the new fields to the payload literal with their honest launch values:

```ts
    range,
    // Filled by Task 13. Empty is the honest launch value: no snapshot rows
    // exist until the nightly job has run once.
    series: [],
    seriesGrain: 'day',
    seriesSource: 'snapshot',
    seriesStartsOn: null,
    // Filled or permanently pinned null by Task 15.
    hourly: null,
    // Filled by Task 12.
    campaigns: [],
    campaignsAreExact: true,
    // Filled by Task 19.
    visitsPrevious: 0,
    tapsPrevious: 0,
    // Filled by Task 14.
    yearAvailable: false,
```

- [ ] **Step 5: The e2e fixtures follow**

In `e2e/edit-backend.ts`, `ANALYTICS_POPULATED` gains:

```ts
  range: '30d',
  series: [
    { date: '2026-07-20', visits: 90, complete: true },
    { date: '2026-07-21', visits: 140, complete: true },
    { date: '2026-07-22', visits: 60, complete: true },
    { date: '2026-07-23', visits: 200, complete: true },
  ],
  seriesGrain: 'day',
  seriesSource: 'snapshot',
  seriesStartsOn: '2026-07-20',
  hourly: null,
  campaigns: [
    { source: 'instagram', label: 'Instagram link', arrivals: 84 },
    { source: 'other', label: 'Someone else’s link', arrivals: 12 },
  ],
  campaignsAreExact: true,
  visitsPrevious: 3300,
  tapsPrevious: 470,
  yearAvailable: false,
```

- [ ] **Step 6: The tests**

In `src/shared/__tests__/analytics-payload.test.ts`:

```ts
describe('the payload guard', () => {
  it('accepts the launch fixture', () => {
    expect(isAnalyticsPayload(ZERO_DATA_PAYLOAD)).toBe(true);
  });

  it('refuses a body missing any one required field', () => {
    for (const key of Object.keys(ZERO_DATA_PAYLOAD)) {
      // The three fields the guard deliberately does not read, named and
      // explained IN the loop rather than left as an unexplained hole:
      //   visitsAreEstimate  a literal `true` the type carries for the
      //                      reader; a body without it is still drawable.
      //   campaignsAreExact  the same.
      //   seriesStartsOn     legitimately null, so `in`-checking it would
      //                      reject a correct empty archive.
      if (key === 'visitsAreEstimate' || key === 'campaignsAreExact' || key === 'seriesStartsOn') continue;
      const short = { ...ZERO_DATA_PAYLOAD } as Record<string, unknown>;
      delete short[key];
      expect(isAnalyticsPayload(short), key).toBe(false);
    }
  });

  it('refuses a range it does not offer', () => {
    expect(isAnalyticsPayload({ ...ZERO_DATA_PAYLOAD, range: '365d' })).toBe(false);
  });

  it('refuses the things a broken proxy actually sends', () => {
    for (const body of [null, undefined, '', 'ok', 0, [], { message: 'Bad gateway' }]) {
      expect(isAnalyticsPayload(body)).toBe(false);
    }
  });

  it('treats a null busiest-times answer as valid and a missing one as not', () => {
    expect(isAnalyticsPayload({ ...ZERO_DATA_PAYLOAD, hourly: null })).toBe(true);
    const { hourly, ...without } = ZERO_DATA_PAYLOAD;
    expect(isAnalyticsPayload(without)).toBe(false);
  });

  it('keeps the day count in step with the range it names', () => {
    expect(ZERO_DATA_PAYLOAD.windowDays).toBe(RANGE_DAYS[ZERO_DATA_PAYLOAD.range]);
    expect(ZERO_DATA_PAYLOAD.bookingTaps.days).toBe(ZERO_DATA_PAYLOAD.windowDays);
  });
});
```

In `worker/__tests__/analytics.test.ts` — `analyticsRequest(query)` builds `new Request('https://viabiancarestaurant.com/api/analytics' + query, { headers: { Cookie: sessionCookie() } })`, mirroring `worker/__tests__/status.test.ts`'s `statusRequest()`:

```ts
describe('the range parameter', () => {
  it('serves 7d and 30d from DIFFERENT cache entries', async () => {
    const env = buildEnv();
    const seven = await handleAnalytics(analyticsRequest('?range=7d'), env);
    const thirty = await handleAnalytics(analyticsRequest('?range=30d'), env);
    expect((await seven.json()).windowDays).toBe(7);
    expect((await thirty.json()).windowDays).toBe(30);
  });

  it('answers an unrecognised range with the default, not an error', async () => {
    const response = await handleAnalytics(analyticsRequest('?range=90'), buildEnv());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.range).toBe('30d');
    expect(body.windowDays).toBe(30);
  });

  it('echoes the range it actually served', async () => {
    const body = await (await handleAnalytics(analyticsRequest('?range=90d'), buildEnv())).json();
    expect(body.range).toBe('90d');
  });

  // The stale-body outage, as a red test rather than as ten minutes of
  // "the visitor numbers aren't connected yet" after every deploy.
  it('stores every entry under the current shape version', async () => {
    const env = buildEnv();
    await handleAnalytics(analyticsRequest('?range=7d'), env);
    expect(env.cachePuts.map((entry) => entry.url)).toEqual([
      expect.stringContaining(`/__cache/analytics/${PAYLOAD_SHAPE_VERSION}/7d`),
    ]);
  });

  it('emits a body its own consumer accepts', async () => {
    // The two sides now share one guard, so this is a real end-to-end
    // assertion rather than two hopes pointing at each other.
    const body = await (await handleAnalytics(analyticsRequest(''), buildEnv())).json();
    expect(isAnalyticsPayload(body)).toBe(true);
  });
});
```

`buildEnv()` gains a `cachePuts: Array<{ url: string; body: string }>` recorder on its `caches.default` stub. If the existing stub does not record, add the array — it is four lines and it is what makes the version row falsifiable.

- [ ] **Step 7: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/analytics.test.ts src/shared/__tests__/analytics-payload.test.ts src/admin/areas/__tests__/NumbersArea.test.tsx`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| build `cacheKey` from `CACHE_KEY_PREFIX` alone, dropping `/${range}` | "serves 7d and 30d from DIFFERENT cache entries" | — |
| make `parseRange` return `raw as AnalyticsRange` unchecked | "answers an unrecognised range with the default, not an error" | — |
| hardcode `range: DEFAULT_RANGE` in the payload literal | "echoes the range it actually served" | — |
| set `RANGE_DAYS['30d'] = 28` | "answers an unrecognised range with the default…" | — |
| leave `CACHE_KEY_PREFIX` at `v1` | "stores every entry under the current shape version" | The `cachePuts` recorder is missing from `buildEnv`. Add it; this row is the whole reason it exists. |
| drop `Array.isArray(body.series)` from the guard | "refuses a body missing any one required field" | — |
| accept any string for `range` in the guard | "refuses a range it does not offer" | — |
| `typeof value === 'object'` without the `null` check | "refuses the things a broken proxy actually sends" | — |
| `isAnalyticsPayload` returns `true` unconditionally | "refuses the things a broken proxy actually sends" | "accepts the launch fixture" alone stays green, which is why the negative cases exist. |
| leave the old `isPayload` in `NumbersArea.tsx` and import nothing | `npx tsc -b --noEmit` (`noUnusedLocals`) | — |

**CSS ceiling:** zero bytes. Types, one Worker constant and one guard function; no markup and no class strings. `src/shared/analytics-payload.ts` **is** inside the content glob, so run `npm run build` and confirm 39037 is unchanged; any movement is a word in one of the comments above and is fixed by rewording.

**If this task is wrong:** she picks 90 days and reads 30 days of numbers under a 90-day heading — or, for ten minutes after every deploy, reads "the visitor numbers aren't connected yet" on a Worker that is working perfectly.

---

## Task 5: Period comparison, as pure functions

Retires the second-largest false-number risk: a percentage change is arithmetic nobody eyeballs. A card reading "up 12%" against a previous period of two visits is not information, and division by zero produces `Infinity`, which renders as the word "Infinity".

**Files:**
- Create: `src/admin/manage/comparison.ts`
- Create: `src/admin/manage/__tests__/comparison.test.ts`

**Interfaces:**
```ts
export type ChangeDirection = 'up' | 'down' | 'flat' | 'unknown';
export interface Change { direction: ChangeDirection; percent: number | null }
export const MIN_PREVIOUS_FOR_CHANGE: number;   // 20
export const FLAT_BAND: number;                 // 0.05
export function changeBetween(current: number, previous: number): Change;
export function changeSentence(change: Change, unit: 'visits' | 'taps'): string;
```

- [ ] **Step 1: `src/admin/manage/comparison.ts`**

```ts
// The comparison beside every headline number, as arithmetic that can be
// table-tested rather than as an expression buried in a card.
//
// Three things this refuses to do, each of which a naive percentage does:
//   - divide by zero and render the word Infinity;
//   - claim "up 100%" off a previous period of one visit;
//   - call a two-percent wobble a change.
//
// It compares THIS PERIOD against the PREVIOUS EQUIVALENT PERIOD, which is
// not what Card D compares. Card D is a fixed seven days against the seven
// before it, deliberately and correctly. Reusing thisWeekVisits/
// priorWeekVisits here would make the stat cards and Card D disagree at
// every range except 7d -- she would read "18% more visits" beside "about
// the same as usual" on one screen, with nothing to tell her which was
// answering which question.

// Below this many in the PREVIOUS period, no change is claimed at all. The
// same judgement MIN_PRIOR_WEEK_VISITS already makes for Card D, and the
// same number, deliberately: two cards disagreeing about how much history is
// enough would be a worse inconsistency than either threshold being slightly
// wrong.
export const MIN_PREVIOUS_FOR_CHANGE = 20;

// Inside five percent either way, this says so rather than picking a
// direction. Narrower than Card D's fifteen percent because that card is
// choosing between three whole sentences and this one shows a figure the
// reader can see for herself.
export const FLAT_BAND = 0.05;

export type ChangeDirection = 'up' | 'down' | 'flat' | 'unknown';

export interface Change {
  direction: ChangeDirection;
  // Rounded to a whole percent, always positive -- the sign lives in
  // `direction`, so nothing downstream has to decide whether to print a
  // minus. null exactly when direction is 'unknown'.
  percent: number | null;
}

export function changeBetween(current: number, previous: number): Change {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { direction: 'unknown', percent: null };
  if (previous < MIN_PREVIOUS_FOR_CHANGE) return { direction: 'unknown', percent: null };
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < FLAT_BAND) return { direction: 'flat', percent: 0 };
  return { direction: ratio > 0 ? 'up' : 'down', percent: Math.round(Math.abs(ratio) * 100) };
}

export function changeSentence(change: Change, unit: 'visits' | 'taps'): string {
  const noun = unit === 'visits' ? 'visits' : 'taps';
  switch (change.direction) {
    case 'unknown':
      return `Not enough of the period before to compare ${noun} against.`;
    case 'flat':
      return `About the same ${noun} as the period before.`;
    case 'up':
      return `${String(change.percent)}% more ${noun} than the period before.`;
    case 'down':
      return `${String(change.percent)}% fewer ${noun} than the period before.`;
  }
}
```

- [ ] **Step 2: The table test — with the boundary row already in it**

```ts
// src/admin/manage/__tests__/comparison.test.ts
import { describe, expect, it } from 'vitest';
import { changeBetween, changeSentence, FLAT_BAND, MIN_PREVIOUS_FOR_CHANGE } from '../comparison';

describe('changeBetween', () => {
  const cases: Array<[number, number, string, number | null]> = [
    // current, previous, direction, percent
    [120, 100, 'up', 20],
    [80, 100, 'down', 20],
    [102, 100, 'flat', 0],
    [98, 100, 'flat', 0],
    [106, 100, 'up', 6],
    // EXACTLY at the flat band. Without this row, `<` and `<=` in the flat
    // test are indistinguishable and the mutation table's fourth row cannot
    // redden. It is in the table from the start for that reason.
    [105, 100, 'up', 5],
    // Two rows whose percentage does NOT land on a whole number, because
    // every other row here does, and while that is true Math.round is
    // interchangeable with Math.floor and with Math.ceil -- the operator that
    // decides the figure on the card cannot be tested by a table that never
    // asks it to decide anything. One row cannot pin all three: Math.round of
    // a value always agrees with either Math.floor or Math.ceil of it, so it
    // takes one row of each.
    //   1275 against 1000 is 27.500000000000004 raw:
    //     Math.round and Math.ceil say 28, Math.floor says 27.
    [1275, 1000, 'up', 28],
    //   728 against 1000 is 27.200000000000003 raw:
    //     Math.round and Math.floor say 27, Math.ceil says 28.
    [728, 1000, 'down', 27],
    // Previous period below the floor: no claim, whatever current is.
    [500, 19, 'unknown', null],
    [500, 0, 'unknown', null],
    [0, 0, 'unknown', null],
    // Exactly at the floor is enough.
    [40, 20, 'up', 100],
    // Down to nothing is a real, sayable answer.
    [0, 100, 'down', 100],
    [Number.NaN, 100, 'unknown', null],
    [100, Number.POSITIVE_INFINITY, 'unknown', null],
  ];

  it.each(cases)('%i against %i is %s %s', (current, previous, direction, percent) => {
    expect(changeBetween(current, previous)).toEqual({ direction, percent });
  });

  it('never returns a negative percent', () => {
    expect(changeBetween(10, 100).percent).toBe(90);
  });

  it('never returns a non-finite percent', () => {
    // The zero-previous case is what would otherwise render the word
    // Infinity in front of her.
    for (const previous of [0, 1, 19]) {
      expect(changeBetween(1000, previous).percent).toBeNull();
    }
  });
});

describe('changeSentence', () => {
  it('names the unit it is comparing', () => {
    expect(changeSentence(changeBetween(120, 100), 'visits')).toBe('20% more visits than the period before.');
    expect(changeSentence(changeBetween(80, 100), 'taps')).toBe('20% fewer taps than the period before.');
  });

  it('says why it cannot compare rather than showing a zero', () => {
    expect(changeSentence(changeBetween(500, 3), 'visits')).toBe(
      'Not enough of the period before to compare visits against.',
    );
  });

  it('states the two thresholds it depends on', () => {
    expect(MIN_PREVIOUS_FOR_CHANGE).toBe(20);
    expect(FLAT_BAND).toBe(0.05);
  });
});
```

- [ ] **Step 3: Re-read the new comments for bare utility-class tokens.** This file is inside `./src/**`.

- [ ] **Step 4: `npx tsc -b --noEmit && npm test -- --run src/admin/manage/__tests__/comparison.test.ts`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| drop the `previous < MIN_PREVIOUS_FOR_CHANGE` guard | `[500, 19, …]`, `[500, 0, …]`, "never returns a non-finite percent" | — |
| drop `Math.abs` around `ratio * 100` | `[80, 100, 'down', 20]` | — |
| widen `FLAT_BAND` to `0.1` | `[106, 100, 'up', 6]` | — |
| change `<` to `<=` in the flat test | `[105, 100, 'up', 5]` | The boundary row is missing from the table. It is written into Step 2 for this row alone; put it back. |
| swap `'up'` and `'down'` in the sentence map | "names the unit it is comparing" | — |
| return `previous` in place of `MIN_PREVIOUS_FOR_CHANGE` | "states the two thresholds it depends on" | — |
| `Math.round(Math.abs(ratio) * 100)` to `Math.floor(…)` | `[1275, 1000, 'up', 28]` | Every row lands on a whole percent. Both fractional rows are written into Step 2 for these two mutations alone; put them back. |
| `Math.round(Math.abs(ratio) * 100)` to `Math.ceil(…)` | `[728, 1000, 'down', 27]` | As above. `Math.round` agrees with `Math.ceil` on the `1275` row, so that row alone does not cover this mutation. |

**CSS ceiling:** zero bytes. A pure module with no JSX and no class strings.

**If this task is wrong:** the panel tells her Instagram is up 400% on a week when six people arrived, and she buys advertising on it.

---

## Task 6: The D1 schema for arrivals, the limiter, snapshots and the rollup

Retires the risk that four later tasks each invent their own table shape. **One new migration file**, applied by hand once, holding everything Tasks 7–14 write to.

**A second file, not more statements appended to `0001_content.sql`.** `0001` has already been applied to the live database and its own header records the exact `npx wrangler d1 execute … --file=…` command that applied it. Appending to a file somebody has already run makes "has this been applied?" unanswerable for every future reader — and because every D1 read in this plan is deliberately no-throw, an unapplied statement degrades in total silence: the campaign card reads zero forever, the chart never fills, the archive never accumulates a row it can never recover, and nothing on screen ever says why.

**Files:**
- Create: `worker/migrations/0002_analytics.sql`
- Modify: `worker/__tests__/migrations.test.ts`

**Interfaces:**
- Consumes: the `DB` binding already declared at `wrangler.toml` and `worker/index.ts`.
- Produces: four tables and two indexes.

- [ ] **Step 1: `worker/migrations/0002_analytics.sql`**

```sql
-- Applied by a human, exactly like 0001:
--   npx wrangler d1 execute via-bianca-content --remote --file=worker/migrations/0002_analytics.sql
--
-- Same rule as 0001 and for the same reason: D1 has no migration runner this
-- Worker can call at runtime, and adding one would put a schema write on a
-- request path. Every statement is IF NOT EXISTS, so re-running the file is a
-- no-op rather than an error.
--
-- A SECOND file rather than more statements in 0001, because 0001 has already
-- been applied to the live database and its own header documents the exact
-- command that applied it. Appending to a file somebody has already run makes
-- "has this been applied?" un-answerable -- and every read against these
-- tables is deliberately no-throw, so a missing table is a card that reads
-- zero forever with nothing anywhere saying why.

-- One row per TAGGED arrival. Not per page view -- see the spec's "What a
-- number on this panel means": a visitor who arrives through Instagram and
-- reads four pages came from Instagram once, and a table with four rows for
-- that visitor would be wrong by a factor of four. The guard is in
-- src/campaign.ts (per tab) and in the fact that only an arrival URL ever
-- carries the tag.
--
-- WHAT IS NOT HERE, deliberately: no address, no user agent, no identifier of
-- any kind. A source and a day is the whole record. The site is cookieless on
-- the public side and this does not change that.
CREATE TABLE IF NOT EXISTS campaign_arrivals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- One of src/shared/campaign-sources.ts's KNOWN_CAMPAIGN_SOURCES, or the
  -- literal 'other'. Collapsed at the WRITE boundary, so this column's value
  -- space is seven strings forever no matter what anyone puts in a URL.
  source     TEXT    NOT NULL,
  -- IST calendar date, YYYY-MM-DD, from todayInKolkata(). IST because the
  -- restaurant's day is what she is reading, and because wa:counts is already
  -- keyed that way -- two date conventions in one panel is how a future
  -- reader gets an off-by-one that nothing on screen explains.
  day        TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS campaign_arrivals_by_day ON campaign_arrivals (day);

-- The rate limiter and the daily cap, which are the same shape and therefore
-- the same table. `bucket` is opaque BY CONSTRUCTION: for the per-address
-- limiter it is a truncated SHA-256 of the address, the window number and a
-- committed salt, so it cannot be linked back to an address without the
-- address and cannot be linked across windows at all; for the daily cap it is
-- the literal 'day:<IST date>', which identifies nobody. Rows are deleted
-- when they expire, by the same prune the nightly job runs.
--
-- THIS is how the spec's "rate limited per address, capped daily" is honoured
-- without a KV write (the namespace budget is ~800 of 1,000 already spent)
-- and without storing an address (the spec's "It does not record who").
CREATE TABLE IF NOT EXISTS campaign_rate (
  bucket  TEXT PRIMARY KEY,
  hits    INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS campaign_rate_by_expiry ON campaign_rate (expires);

-- Cloudflare's own daily total, copied into our storage before Cloudflare
-- discards it. One row per UTC day, written by the scheduled handler.
--
-- UTC here, IST above, and that is not an oversight: this row is a copy of a
-- Cloudflare number and Cloudflare's RUM days are UTC. Re-bucketing it into
-- IST would mean splitting a day we only have the total of, which invents
-- precision. The offset is 5h30m at the edges of a window, the same accepted
-- mismatch worker/analytics.ts already records for taps.
CREATE TABLE IF NOT EXISTS daily_visits (
  day         TEXT PRIMARY KEY,
  visits      INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL
);

-- The archive that outlives Cloudflare's six months. Twelve rows a year,
-- forever, is nothing.
--
-- `complete` is the column the by-year view turns on. A month rolled up from
-- eleven days is not comparable to one rolled from thirty, and a flag is the
-- only way the read side can tell. The panel draws a partial month WITH an
-- asterisk rather than omitting it: an omitted month is a gap she cannot see,
-- and an unlabelled short column is a collapse that did not happen. Stated
-- plainly because it cannot be fixed -- this archive accumulates from the day
-- it was switched on and the first year in it IS partial.
CREATE TABLE IF NOT EXISTS monthly_visits (
  month       TEXT PRIMARY KEY,  -- YYYY-MM
  visits      INTEGER NOT NULL,
  complete    INTEGER NOT NULL,  -- 1 when every day of that month is present in daily_visits
  recorded_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Pin the four tables in `worker/__tests__/migrations.test.ts`**

That file already reads **every** `*.sql` in `worker/migrations` and concatenates (`sql()` at `:6-13`), so it picks up `0002` with no change to the harness. Its existing `are idempotent` and `are numbered` tests now cover the new file for free. Add:

```ts
describe('0002_analytics.sql', () => {
  function columnsOf(table: string): string[] {
    const block = sql().match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
    expect(block, `no CREATE TABLE for ${table}`).not.toBeNull();
    return block![1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('--'))
      .map((line) => line.split(/\s+/)[0]);
  }

  it('records a tagged arrival with a source and a day and nothing else', () => {
    expect(columnsOf('campaign_arrivals')).toEqual(['id', 'source', 'day', 'created_at']);
  });

  it('holds no address, no agent and no identifier anywhere in the new tables', () => {
    // The privacy claim, as an assertion rather than a comment. The spec's
    // "It does not record who" is what lets the limiter live in D1 at all,
    // so the column lists are load-bearing.
    const columns = [...columnsOf('campaign_arrivals'), ...columnsOf('campaign_rate')].join(' ');
    for (const forbidden of ['ip', 'address', 'agent', 'visitor', 'session', 'cookie']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('indexes arrivals by day and limiter rows by expiry, which is how both are read', () => {
    expect(sql()).toContain('CREATE INDEX IF NOT EXISTS campaign_arrivals_by_day ON campaign_arrivals (day)');
    expect(sql()).toContain('CREATE INDEX IF NOT EXISTS campaign_rate_by_expiry ON campaign_rate (expires)');
  });

  it('keys the snapshot by day and the rollup by month, and marks a partial month', () => {
    expect(columnsOf('daily_visits')).toEqual(['day', 'visits', 'recorded_at']);
    expect(columnsOf('monthly_visits')).toEqual(['month', 'visits', 'complete', 'recorded_at']);
  });

  it('leaves 0001 alone', () => {
    // 0001 has been applied to the live database and its header records the
    // command that applied it. Anything appended to it is a statement nobody
    // can tell has run.
    const first = readFileSync(join(DIR, '0001_content.sql'), 'utf8');
    for (const table of ['campaign_arrivals', 'campaign_rate', 'daily_visits', 'monthly_visits']) {
      expect(first).not.toContain(table);
    }
  });
});
```

- [ ] **Step 3: A human applies it**

```
npx wrangler d1 execute via-bianca-content --remote --file=worker/migrations/0002_analytics.sql
```

- [ ] **Step 4: Confirm it landed, against the live database**

```
npx wrangler d1 execute via-bianca-content --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expect `campaign_arrivals`, `campaign_rate`, `content`, `content_meta`, `daily_visits`, `monthly_visits`, `revisions`. **This step is not optional and its output goes in the task's commit message.** Every read in this plan is no-throw by design, so an unapplied migration produces no error anywhere — only cards that read zero forever.

- [ ] **Step 5: `npm test -- --run worker/__tests__/migrations.test.ts`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| add an `ip TEXT` column to `campaign_arrivals` | "holds no address, no agent and no identifier", and "records a tagged arrival with…" | — |
| drop the `campaign_arrivals_by_day` index | "indexes arrivals by day and limiter rows by expiry…" | — |
| drop `complete` from `monthly_visits` | "keys the snapshot by day and the rollup by month, and marks a partial month" | — |
| remove `IF NOT EXISTS` from one `CREATE TABLE` | the file's existing "are idempotent — every CREATE carries IF NOT EXISTS" | — |
| move the four `CREATE TABLE`s into `0001_content.sql` instead | "leaves 0001 alone" | — |
| add a fifth table with no test | **nothing reddens** — accepted | The tests pin the shape of the tables the code uses, not the absence of others. Do not invent an assertion for this; the guard is `FakeD1`'s throw-on-unknown-statement in Task 7. |
| apply nothing to the live database | **nothing reddens anywhere, ever** | This is the whole reason Step 4 exists and why its output is pasted into the commit message. There is no test that can see the live schema; the check is a human running one command and reading seven table names. |

**CSS ceiling:** zero bytes. SQL and a worker test; neither is inside Tailwind's glob.

**If this task is wrong:** the campaign card, the trend chart and the by-year archive all read empty forever, silently, and the archive loses days it can never recover.

---
## Task 7: `worker/analytics-store.ts` — every D1 statement, in one place

Retires the defect class this project has already shipped once: a data model maintained in one of four places. Every statement this feature will ever issue lives in this module, over a plain `D1Database` rather than over `env`.

**The justification is `FakeD1`.** `worker/__tests__/fakeD1.ts` matches statements by `startsWith` and **throws loudly on anything it does not recognise** — its own header says a fake that silently accepted an unknown query would let a typo'd statement pass every test and fail only in production. That only works if the set of statements is enumerable by reading one file. A statement written inline at a call site is a statement somebody will change without teaching the fake.

**Files:**
- Create: `worker/analytics-store.ts`
- Create: `worker/__tests__/analytics-store.test.ts`
- Modify: `worker/__tests__/fakeD1.ts`

**Interfaces:**
```ts
export interface CampaignTotal { source: string; arrivals: number }
export interface DayVisits { day: string; visits: number; complete: boolean }

export async function recordArrival(db: D1Database, source: string, day: string, now: number): Promise<void>;
export async function campaignTotals(db: D1Database, since: string): Promise<CampaignTotal[]>;
export async function takeRateSlot(db: D1Database, bucket: string, limit: number, expires: number): Promise<boolean>;
export async function recordDailyVisits(db: D1Database, day: string, visits: number, now: number): Promise<void>;
export async function dailySince(db: D1Database, since: string): Promise<DayVisits[]>;
export async function firstDailyDay(db: D1Database): Promise<string | null>;
export async function rollMonths(db: D1Database, sinceDay: string, now: number): Promise<void>;
export async function monthlySeries(db: D1Database, sinceMonth: string): Promise<DayVisits[]>;
export async function monthlyCount(db: D1Database): Promise<number>;
export async function pruneAnalytics(db: D1Database, dayCutoff: string, now: number): Promise<void>;
export function daysInMonth(month: string): number;
```

- [ ] **Step 1: The header, `daysInMonth`, and the reads**

```ts
// Every D1 statement the Numbers panel will ever issue, in one module.
//
// ONE module, and the reason is FakeD1: worker/__tests__/fakeD1.ts matches
// statements by `startsWith` and throws on anything it does not recognise, so
// the set of statements has to be enumerable by reading one file. A statement
// written inline at a call site is a statement somebody will change without
// teaching the fake, and the failure shows up in production as a D1_ERROR on
// a request nobody is watching. This repository has already shipped a data
// model maintained in four places once.
//
// Nothing here reads `env`. Every function takes a plain D1Database, so the
// tests hand it a fake and the handlers hand it `env.DB`, and neither has to
// know about the other.
//
// NOTHING HERE CATCHES. Callers decide what a failure costs: a failed
// campaign read costs one card, a failed snapshot costs one night's row, and
// those are different decisions that must not be made here.
import type { D1Database } from '@cloudflare/workers-types';

export interface CampaignTotal {
  source: string;
  arrivals: number;
}

export interface DayVisits {
  // 'YYYY-MM-DD' at day grain, 'YYYY-MM' at month grain. ONE type, because
  // the chart draws a run of points against an ordered axis and does not care
  // what a point is called -- the payload's seriesGrain says which it is.
  day: string;
  visits: number;
  // Always true for a day. For a month, whether every one of its days is
  // present in daily_visits.
  complete: boolean;
}

// Hand-computed rather than through Date, because `new Date('2026-02')` is a
// UTC-midnight parse in some engines and a local-midnight parse in others,
// and the answer for February decides whether a month is called complete.
export function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(index) || index < 1 || index > 12) return 31;
  if (index === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(index) ? 30 : 31;
}

// EXACT counts, not estimates, and that is the whole reason this table
// exists: these are our own rows. The card is allowed to say "84" here where
// every Cloudflare number says "about 84".
//
// `ORDER BY arrivals DESC, source ASC` -- the second key is not decoration.
// Two sources with equal counts must come back in the same order on every
// load, or the card reshuffles itself between refreshes and looks broken.
// rankPaths in worker/analytics.ts already makes exactly this argument.
export async function campaignTotals(db: D1Database, since: string): Promise<CampaignTotal[]> {
  const { results } = await db
    .prepare(
      'SELECT source, COUNT(*) AS arrivals FROM campaign_arrivals WHERE day >= ? GROUP BY source ORDER BY arrivals DESC, source ASC',
    )
    .bind(since)
    .all<{ source: string; arrivals: number }>();
  return (results ?? []).map((row) => ({ source: String(row.source), arrivals: Number(row.arrivals) || 0 }));
}

export async function dailySince(db: D1Database, since: string): Promise<DayVisits[]> {
  const { results } = await db
    .prepare('SELECT day, visits FROM daily_visits WHERE day >= ? ORDER BY day ASC')
    .bind(since)
    .all<{ day: string; visits: number }>();
  return (results ?? []).map((row) => ({ day: String(row.day), visits: Number(row.visits) || 0, complete: true }));
}

// The first day the archive holds anything, so the chart can say where its
// line begins instead of starting at an unexplained zero. `null` means no row
// has ever landed, which is a different sentence.
export async function firstDailyDay(db: D1Database): Promise<string | null> {
  const row = await db.prepare('SELECT MIN(day) AS first_day FROM daily_visits').first<{ first_day: string | null }>();
  const day = row?.first_day;
  return typeof day === 'string' && day.length > 0 ? day : null;
}

export async function monthlySeries(db: D1Database, sinceMonth: string): Promise<DayVisits[]> {
  const { results } = await db
    .prepare('SELECT month, visits, complete FROM monthly_visits WHERE month >= ? ORDER BY month ASC')
    .bind(sinceMonth)
    .all<{ month: string; visits: number; complete: number }>();
  return (results ?? []).map((row) => ({
    day: String(row.month),
    visits: Number(row.visits) || 0,
    complete: Number(row.complete) === 1,
  }));
}

// Whether the by-year button has anything behind it. Folded into the same
// round trip as everything else rather than being a third question.
export async function monthlyCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM monthly_visits').first<{ n: number }>();
  return Number(row?.n) || 0;
}
```

- [ ] **Step 2: The writes, including the limiter**

```ts
export async function recordArrival(db: D1Database, source: string, day: string, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO campaign_arrivals (source, day, created_at) VALUES (?, ?, ?)')
    .bind(source, day, now)
    .run();
}

// ONE statement, not read-then-write, and that is not a style choice: two
// arrivals in the same second would both read the same count and both decide
// they were under the limit. `ON CONFLICT ... DO UPDATE` with `RETURNING`
// makes the increment and the answer one atomic step.
//
// The `expires` comparison in the UPDATE arm is what resets a stale bucket:
// without it, a bucket that filled an hour ago is still full, and the limiter
// becomes a permanent ban rather than a window.
//
// `bucket` is OPAQUE by construction and the caller is responsible for
// keeping it so -- see worker/campaign.ts, which hashes the address with the
// window and a salt before it ever gets here. Nothing in this module has an
// address to leak.
export async function takeRateSlot(
  db: D1Database,
  bucket: string,
  limit: number,
  expires: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      'INSERT INTO campaign_rate (bucket, hits, expires) VALUES (?, 1, ?) ' +
        'ON CONFLICT(bucket) DO UPDATE SET ' +
        'hits = CASE WHEN campaign_rate.expires <= excluded.expires - 1 THEN 1 ELSE campaign_rate.hits + 1 END, ' +
        'expires = excluded.expires ' +
        'RETURNING hits',
    )
    .bind(bucket, expires)
    .first<{ hits: number }>();
  return (Number(row?.hits) || 0) <= limit;
}

// INSERT OR REPLACE by way of ON CONFLICT: running the nightly job twice on
// the same day must leave ONE row holding the better (later, more complete)
// number, not two rows and not an error. A scheduled handler that fails on a
// retry is a scheduled handler that stops silently.
export async function recordDailyVisits(db: D1Database, day: string, visits: number, now: number): Promise<void> {
  await db
    .prepare(
      'INSERT INTO daily_visits (day, visits, recorded_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(day) DO UPDATE SET visits = excluded.visits, recorded_at = excluded.recorded_at',
    )
    .bind(day, visits, now)
    .run();
}

// EVERY MONTH TOUCHED BY THE LAST NINETY-THREE DAYS, recomputed from its own
// days -- not only the month that just ended.
//
// Three things follow from that and each of them is the reason for it:
//   - a day that arrives late is picked up on the next night's run instead of
//     being lost;
//   - ONE missed cron night cannot lose a whole month permanently, which a
//     job that only fires on the 1st can and does;
//   - a month is recomputed rather than incremented, so running twice cannot
//     double anything and a corrected day corrects its month too.
//
// `complete` is computed here, from COUNT(*) against the real length of the
// month, because this is the only place that knows both numbers.
export async function rollMonths(db: D1Database, sinceDay: string, now: number): Promise<void> {
  const { results } = await db
    .prepare(
      "SELECT substr(day, 1, 7) AS month, SUM(visits) AS visits, COUNT(*) AS days FROM daily_visits WHERE day >= ? GROUP BY month",
    )
    .bind(sinceDay)
    .all<{ month: string; visits: number; days: number }>();
  for (const row of results ?? []) {
    const month = String(row.month);
    await db
      .prepare(
        'INSERT INTO monthly_visits (month, visits, complete, recorded_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(month) DO UPDATE SET visits = excluded.visits, complete = excluded.complete, recorded_at = excluded.recorded_at',
      )
      .bind(month, Number(row.visits) || 0, Number(row.days) >= daysInMonth(month) ? 1 : 0, now)
      .run();
  }
}

// Two deletes in one batch, so the nightly job costs one subrequest for both.
// Daily rows older than the cutoff are already rolled into their month;
// expired limiter buckets are dead weight the moment they expire -- and
// deleting them is also what keeps the limiter's opaque buckets from
// accumulating forever.
//
// 400 days rather than 365, so a by-year view of the current year always has
// a full preceding year of days behind it. That is the table's stated
// ceiling: 400 rows, forever.
export async function pruneAnalytics(db: D1Database, dayCutoff: string, now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM daily_visits WHERE day < ?').bind(dayCutoff),
    db.prepare('DELETE FROM campaign_rate WHERE expires < ?').bind(now),
  ]);
}
```

- [ ] **Step 3: Teach `FakeD1` every one of those statements**

In `worker/__tests__/fakeD1.ts`, add the state:

```ts
  campaignArrivals: Array<{ source: string; day: string; created_at: number }> = [];
  campaignRate = new Map<string, { hits: number; expires: number }>();
  dailyVisits = new Map<string, { visits: number; recorded_at: number }>();
  monthlyVisits = new Map<string, { visits: number; complete: number; recorded_at: number }>();
```

and add a branch to `execute()`'s `startsWith` chain for each statement above, **before** the existing `throw new Error('FakeD1 does not know this statement: ' + sql)`. That throw stays as the last line: it is the reason a typo'd statement fails here rather than in production, and it is why `analytics-store.ts` is one module.

The two branches worth writing out, because they are the two with real logic:

```ts
    if (sql.startsWith('INSERT INTO campaign_rate')) {
      const [bucket, expires] = bindings as [string, number];
      const existing = this.campaignRate.get(bucket);
      // Mirrors the CASE arm exactly: a bucket whose recorded expiry is at or
      // below the new one minus a second is a window that has moved on, and
      // starts again at 1.
      const hits = existing === undefined || existing.expires <= expires - 1 ? 1 : existing.hits + 1;
      this.campaignRate.set(bucket, { hits, expires });
      return { row: { hits } };
    }
    if (sql.startsWith('SELECT substr(day, 1, 7) AS month')) {
      const [sinceDay] = bindings as [string];
      const totals = new Map<string, { visits: number; days: number }>();
      for (const [day, row] of this.dailyVisits) {
        if (day < sinceDay) continue;
        const month = day.slice(0, 7);
        const current = totals.get(month) ?? { visits: 0, days: 0 };
        totals.set(month, { visits: current.visits + row.visits, days: current.days + 1 });
      }
      return {
        results: [...totals.entries()].map(([month, value]) => ({ month, visits: value.visits, days: value.days })),
      };
    }
```

- [ ] **Step 4: `worker/__tests__/analytics-store.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { asD1, FakeD1 } from './fakeD1';
import {
  campaignTotals,
  dailySince,
  daysInMonth,
  firstDailyDay,
  monthlyCount,
  monthlySeries,
  pruneAnalytics,
  recordArrival,
  recordDailyVisits,
  rollMonths,
  takeRateSlot,
} from '../analytics-store';

function store() {
  const fake = new FakeD1();
  return { fake, db: asD1(fake) };
}

describe('campaign rows', () => {
  it('counts by source, biggest first, and ties break by name so the card cannot reshuffle itself', async () => {
    const { db } = store();
    for (const source of ['instagram', 'instagram', 'google', 'other', 'other']) {
      await recordArrival(db, source, '2026-08-20', 1000);
    }
    expect(await campaignTotals(db, '2026-08-01')).toEqual([
      { source: 'instagram', arrivals: 2 },
      { source: 'other', arrivals: 2 },
      { source: 'google', arrivals: 1 },
    ]);
  });

  it('leaves rows older than the range out of the count', async () => {
    const { db } = store();
    await recordArrival(db, 'instagram', '2026-07-01', 1);
    await recordArrival(db, 'instagram', '2026-08-12', 2);
    // 2026-08-12 is the INCLUSIVE first day of a 7-day window ending
    // 2026-08-18. A window built one day short drops it.
    expect(await campaignTotals(db, '2026-08-12')).toEqual([{ source: 'instagram', arrivals: 1 }]);
  });
});

describe('the limiter', () => {
  it('allows exactly the limit and refuses the next one', async () => {
    const { db } = store();
    const results: boolean[] = [];
    for (let i = 0; i < 4; i += 1) results.push(await takeRateSlot(db, 'opaque-bucket', 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });

  it('starts again once the window has moved on', async () => {
    const { db } = store();
    await takeRateSlot(db, 'opaque-bucket', 1, 60);
    expect(await takeRateSlot(db, 'opaque-bucket', 1, 60)).toBe(false);
    expect(await takeRateSlot(db, 'opaque-bucket', 1, 120)).toBe(true);
  });
});

describe('the snapshots and the roll', () => {
  it('corrects a day it has already recorded rather than adding a second row', async () => {
    const { fake, db } = store();
    await recordDailyVisits(db, '2026-08-20', 10, 1);
    await recordDailyVisits(db, '2026-08-20', 14, 2);
    expect(fake.dailyVisits.size).toBe(1);
    expect(await dailySince(db, '2026-08-01')).toEqual([{ day: '2026-08-20', visits: 14, complete: true }]);
  });

  it('reports no first day at all when nothing has ever landed', async () => {
    const { db } = store();
    expect(await firstDailyDay(db)).toBeNull();
    await recordDailyVisits(db, '2026-08-20', 1, 1);
    await recordDailyVisits(db, '2026-08-11', 1, 1);
    expect(await firstDailyDay(db)).toBe('2026-08-11');
  });

  it('rolls every month the window touches, not only the one that just ended', async () => {
    const { db } = store();
    await recordDailyVisits(db, '2026-06-30', 5, 1);
    await recordDailyVisits(db, '2026-07-01', 7, 1);
    await recordDailyVisits(db, '2026-08-01', 9, 1);
    await rollMonths(db, '2026-06-01', 1);
    expect((await monthlySeries(db, '2026-01')).map((row) => row.day)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('picks up a day that arrives late, on the next run', async () => {
    const { db } = store();
    await recordDailyVisits(db, '2026-07-01', 7, 1);
    await rollMonths(db, '2026-06-01', 1);
    await recordDailyVisits(db, '2026-07-02', 3, 2);
    await rollMonths(db, '2026-06-01', 2);
    expect((await monthlySeries(db, '2026-01'))[0]).toEqual({ day: '2026-07', visits: 10, complete: false });
  });

  it('recomputes rather than accumulating, so running twice cannot double a month', async () => {
    const { db } = store();
    await recordDailyVisits(db, '2026-08-19', 10, 1);
    await recordDailyVisits(db, '2026-08-20', 5, 1);
    await rollMonths(db, '2026-08-01', 1);
    await rollMonths(db, '2026-08-01', 2);
    expect((await monthlySeries(db, '2026-08'))[0].visits).toBe(15);
  });

  it('marks a month complete only when every one of its days is present', async () => {
    const { db } = store();
    for (let day = 1; day <= 30; day += 1) {
      await recordDailyVisits(db, `2026-09-${String(day).padStart(2, '0')}`, 1, 1);
    }
    await recordDailyVisits(db, '2026-10-01', 1, 1);
    await rollMonths(db, '2026-09-01', 1);
    const rows = await monthlySeries(db, '2026-09');
    expect(rows.find((row) => row.day === '2026-09')?.complete).toBe(true);
    expect(rows.find((row) => row.day === '2026-10')?.complete).toBe(false);
  });

  it('counts the months behind the by-year button', async () => {
    const { db } = store();
    expect(await monthlyCount(db)).toBe(0);
    await recordDailyVisits(db, '2026-08-01', 1, 1);
    await rollMonths(db, '2026-08-01', 1);
    expect(await monthlyCount(db)).toBe(1);
  });

  it('prunes old days and dead limiter buckets, and nothing else', async () => {
    const { fake, db } = store();
    await recordDailyVisits(db, '2025-01-01', 3, 1);
    await recordDailyVisits(db, '2026-08-20', 4, 1);
    await takeRateSlot(db, 'opaque-bucket', 500, 60);
    await pruneAnalytics(db, '2026-01-01', 90);
    expect(await dailySince(db, '2000-01-01')).toEqual([{ day: '2026-08-20', visits: 4, complete: true }]);
    expect(fake.campaignRate.size).toBe(0);
  });
});

describe('daysInMonth', () => {
  it.each([
    ['2026-01', 31],
    ['2026-02', 28],
    ['2024-02', 29],
    ['2000-02', 29],
    ['1900-02', 28],
    ['2026-04', 30],
    ['2026-12', 31],
  ])('%s has %i days', (month, expected) => {
    expect(daysInMonth(month)).toBe(expected);
  });
});
```

- [ ] **Step 5: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/analytics-store.test.ts`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| `ORDER BY arrivals DESC` → `ORDER BY arrivals ASC` | "counts by source, biggest first, and ties break by name…" | — |
| drop `, source ASC` from the ORDER BY | the same test (the two 2-arrival rows swap) | The fake sorts stably by insertion. Make `FakeD1`'s branch sort by `arrivals` alone so the tie order is genuinely unspecified, then re-run. |
| `WHERE day >= ?` → no `WHERE` clause | "leaves rows older than the range out of the count" | — |
| `<= limit` → `< limit` in `takeRateSlot` | "allows exactly the limit and refuses the next one" | — |
| drop the `CASE WHEN … expires` arm and always increment | "starts again once the window has moved on" | — |
| `ON CONFLICT(day) DO NOTHING` in `recordDailyVisits` | "corrects a day it has already recorded rather than adding a second row" | — |
| roll only the current month (`sinceDay` = first of this month) | "rolls every month the window touches…", "picks up a day that arrives late, on the next run" | — |
| `rollMonths` adds to the existing total instead of replacing it | "recomputes rather than accumulating…" | — |
| `complete` hardcoded to `1` | "marks a month complete only when every one of its days is present" | — |
| `substr(day, 1, 7)` → `substr(day, 1, 4)` | "rolls every month the window touches…" — the roll writes one row per year | — |
| `daysInMonth` returns 30 for February | the `daysInMonth` table, and "marks a month complete only when…" | — |
| `pruneAnalytics` deletes `WHERE day > ?` | "prunes old days and dead limiter buckets, and nothing else" | — |
| write a new statement inline in a handler instead of adding it here | **nothing reddens in this file** | The guard is `FakeD1`'s final `throw`: any handler test that reaches an unknown statement fails with "FakeD1 does not know this statement". Confirm that throw is still the last line of `execute()` before finishing. |

**CSS ceiling:** zero bytes. `worker/**` is outside Tailwind's content glob entirely.

**If this task is wrong:** the campaign card counts the wrong window, the limiter becomes a permanent ban after one busy minute, or a month is doubled every night — and the last of those is a number she would believe.

---

## Task 8: `POST /api/campaign` — origin, limiter, cap, one row

**This is the task the whole panel's credibility rests on.** It is the only new write path, the only place a visitor's browser causes a row, and the one place this panel can report a number four or five times too high.

**Files:**
- Create: `src/shared/campaign-sources.ts`
- Create: `src/shared/__tests__/campaign-sources.test.ts`
- Create: `worker/campaign.ts`
- Create: `worker/__tests__/campaign.test.ts`
- Modify: `worker/index.ts` (dispatch)

**Interfaces:**
```ts
// src/shared/campaign-sources.ts
export const KNOWN_CAMPAIGN_SOURCES: readonly string[];
export const OTHER_SOURCE: 'other';
export const CAMPAIGN_LABELS: Record<string, string>;
export function normalizeSource(raw: string): string;

// worker/campaign.ts
export const CAMPAIGN_RATE_MAX: number;              // 10
export const CAMPAIGN_RATE_WINDOW_SECONDS: number;   // 60
export const CAMPAIGN_DAILY_CAP: number;             // 2000
export interface CampaignEnv { DB: D1Database }
export async function handleCampaignArrival(request: Request, env: CampaignEnv): Promise<Response>;
```

- [ ] **Step 1: `src/shared/campaign-sources.ts` — the closed vocabulary**

```ts
// The links SHE places, and the one bucket everything else falls into.
//
// A card that lists every string it has ever seen fills with noise: Facebook
// appends fbclid, other sites append their own tags, and visitors paste links
// that already carry somebody else's. She names her links; the rest is one
// row.
//
// This list is ALSO the write path's guard. normalizeSource runs before a row
// is written, so the `source` column can only ever hold one of these strings
// -- which bounds the table's cardinality to a committed list rather than to
// whatever a stranger puts after utm_source=. That is what lets a public
// endpoint write to the database the whole site's content lives in.
//
// THE COST, STATED: adding a source she wants named is a one-line edit here
// plus `npx wrangler deploy`, not a dashboard field. That is the right trade
// for a list that changes perhaps twice a year and the wrong one if it
// changes weekly.
export const OTHER_SOURCE = 'other' as const;

export const KNOWN_CAMPAIGN_SOURCES = [
  'instagram',
  'whatsapp',
  'google',
  'zomato',
  'newsletter',
  'print',
] as const;

// Her words, beside the machine value, for the same reason
// REFERER_BUCKET_LABELS sits beside RefererBucketKind: the card and the
// counter cannot come to two different opinions about what a row IS.
//
// "Instagram link", not "Instagram", deliberately. The referrer card already
// has a row called Instagram meaning "the click came from instagram.com", and
// the two cards sit on one screen. Two rows reading Instagram and disagreeing
// is the contradiction the spec warns about; naming this one after the LINK
// is what tells them apart at a glance, before she reads the sentence that
// explains it.
export const CAMPAIGN_LABELS: Record<string, string> = {
  instagram: 'Instagram link',
  whatsapp: 'WhatsApp link',
  google: 'Google link',
  zomato: 'Zomato link',
  newsletter: 'Newsletter link',
  print: 'Printed link',
  other: 'Someone else’s link',
};

// Lowercased, trimmed, and anything unrecognised becomes `other`. Length is
// capped before the comparison so a megabyte of query string is a cheap
// string operation and not a cheap denial of service.
export function normalizeSource(raw: string): string {
  const trimmed = raw.trim().slice(0, 64).toLocaleLowerCase('en');
  return (KNOWN_CAMPAIGN_SOURCES as readonly string[]).includes(trimmed) ? trimmed : OTHER_SOURCE;
}
```

- [ ] **Step 2: `worker/campaign.ts` — the budget, the salt, the opaque bucket**

```ts
// The one write path this site's PUBLIC pages have, guarded the way
// POST /api/wa already is: origin-checked, rate limited per address, capped
// per day, and incapable of delaying a page.
//
// THE BUDGET, derived rather than assumed. An accepted arrival costs THREE D1
// row writes: one limiter row, one daily-cap row, one arrival row. A refused
// one costs one or two. Worst case is 3 * CAMPAIGN_DAILY_CAP = 6,000 rows a
// day against D1 Free's 100,000 -- six per cent, on a restaurant site that
// would have to be taking thousands of tagged visits a day to reach it.
//
// NOT KV, and that is the whole reason campaign_rate exists. KV Free allows
// 1,000 writes a day across the entire namespace and roughly 800 are already
// committed to the login counter, the three rate-limited admin routes and the
// tap counter. A public write path cannot borrow headroom that is not there.
//
// AND NOT AN ADDRESS IN A COLUMN. The spec's "It does not record who" is not
// negotiable, so the limiter's key is a truncated SHA-256 of the address, the
// window number and a committed salt: it cannot be reversed without the
// address, it cannot be linked across windows (the window is inside the
// hash), and the row is DELETED when it expires. What that gives up, stated:
// nobody can ever ask this table which address was busy. Nothing needs to.
//
// UNAUTHENTICATED, deliberately, exactly like POST /api/wa: the person
// arriving through her Instagram link is a diner, not the owner.
import { normalizeSource } from '../src/shared/campaign-sources';
import { todayInKolkata } from '../src/shared/date';
import { sha256Hex } from './d1';
import { recordArrival, takeRateSlot } from './analytics-store';
import type { D1Database } from '@cloudflare/workers-types';

// Ten a minute per address. A person arrives through a tagged link once; ten
// is generous enough that a shared office address never trips it and tight
// enough that one machine cannot fill the day's cap alone.
export const CAMPAIGN_RATE_MAX = 10;
export const CAMPAIGN_RATE_WINDOW_SECONDS = 60;

// Accepted arrivals per IST day. Above this the route answers 204 -- the SAME
// answer success gives, so a prober learns nothing about whether the cap was
// reached.
export const CAMPAIGN_DAILY_CAP = 2000;

// Not a secret and not pretending to be one: it is a domain separator, so a
// bucket string from this table cannot be matched against a hash computed
// anywhere else. The address is already gone by the time anything is stored.
const BUCKET_SALT = 'vb:campaign:bucket:v1';

export interface CampaignEnv {
  DB: D1Database;
}

// The same one-liner worker/index.ts's own siteOriginOf is, restated here
// rather than imported, because worker/index.ts imports THIS module and a
// cycle between them is a real hazard in a Worker bundle.
//
// Derived from the request rather than hardcoded: a hardcoded literal
// pointing at a domain this site no longer used silently answered every real
// sendBeacon 403 and pinned the tap counter at zero for as long as it was
// deployed. `Origin` is set by the browser, not by the page, so a cross-site
// caller still cannot present this value.
function siteOriginOf(request: Request): string {
  return new URL(request.url).origin;
}

async function bucketFor(ip: string, window: number): Promise<string> {
  return `r:${(await sha256Hex(`${BUCKET_SALT}:${ip}:${String(window)}`)).slice(0, 24)}`;
}
```

- [ ] **Step 3: The handler**

```ts
export async function handleCampaignArrival(request: Request, env: CampaignEnv): Promise<Response> {
  // Origin first, before any storage is touched at all.
  if (request.headers.get('Origin') !== siteOriginOf(request)) {
    return new Response(null, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { source?: unknown } | null;
  const raw = typeof body?.source === 'string' ? body.source : '';
  if (raw === '') return new Response(null, { status: 204 });
  // Normalised HERE as well as in the browser, because the browser is not a
  // guard. This is what actually bounds the column.
  const source = normalizeSource(raw);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const window = Math.floor(nowSeconds / CAMPAIGN_RATE_WINDOW_SECONDS);
  const day = todayInKolkata();

  // The per-address bucket first, the daily cap second, both the same
  // statement shape so the cost is symmetric and a refused request never
  // reaches the arrival insert.
  const underRate = await takeRateSlot(
    env.DB,
    await bucketFor(ip, window),
    CAMPAIGN_RATE_MAX,
    nowSeconds + CAMPAIGN_RATE_WINDOW_SECONDS,
  ).catch(() => false);
  if (!underRate) return new Response(null, { status: 204 });

  const underCap = await takeRateSlot(env.DB, `day:${day}`, CAMPAIGN_DAILY_CAP, nowSeconds + 172_800).catch(
    () => false,
  );
  if (!underCap) return new Response(null, { status: 204 });

  try {
    await recordArrival(env.DB, source, day, nowSeconds);
  } catch {
    // Best effort, exactly like the tap counter's own write. The visitor has
    // already arrived and is already reading the page; losing one row is a
    // smaller cost than any behaviour that could delay or break that, and an
    // unhandled rejection in a Worker is a 500 in a log nobody reads.
  }

  // 204 whether it was written, capped, refused or lost, deliberately: the
  // browser never reads this response, so a distinct status tells a prober
  // something and tells the visitor nothing.
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Dispatch, in `worker/index.ts`, beside the `/api/wa` branches**

```ts
  // Public and unauthenticated, exactly like POST /api/wa, and therefore in
  // NEITHER admin list: not in AUTHENTICATED_PATHS (there is no session to
  // check) and not in RATE_POLICIES (whose limiter writes to KV, whose budget
  // is closed). It carries its own guards -- see worker/campaign.ts.
  if (url.pathname === '/api/campaign' && request.method === 'POST') {
    return handleCampaignArrival(request, env);
  }
```

with `import { handleCampaignArrival } from './campaign';` added. `/api/campaign` is **not** added to `AUTHENTICATED_PATHS`, `RATE_POLICIES` or `AUTHENTICATED_UNLIMITED` — `worker/__tests__/hardening.test.ts` asserts `AUTHENTICATED_UNLIMITED ⊆ AUTHENTICATED_PATHS`, and adding an unauthenticated route to either would break that invariant.

- [ ] **Step 5: `src/shared/__tests__/campaign-sources.test.ts`**

```ts
describe('normalizeSource', () => {
  it('keeps the names she uses and folds everything else into one', () => {
    for (const known of KNOWN_CAMPAIGN_SOURCES) expect(normalizeSource(known)).toBe(known);
    expect(normalizeSource('  Instagram  ')).toBe('instagram');
    expect(normalizeSource('INSTAGRAM')).toBe('instagram');
    expect(normalizeSource('fbclid')).toBe(OTHER_SOURCE);
    expect(normalizeSource('')).toBe(OTHER_SOURCE);
    expect(normalizeSource('x'.repeat(5000))).toBe(OTHER_SOURCE);
  });

  it('has words for every source it can store', () => {
    for (const source of [...KNOWN_CAMPAIGN_SOURCES, OTHER_SOURCE]) {
      expect(CAMPAIGN_LABELS[source]).toBeTruthy();
    }
  });

  it('names the campaign row after the LINK, so it cannot be read as the referrer row', () => {
    // Two cards on one screen, both able to say Instagram, meaning different
    // things. This is the difference at a glance.
    expect(CAMPAIGN_LABELS.instagram).toBe('Instagram link');
  });
});
```

- [ ] **Step 6: `worker/__tests__/campaign.test.ts`**

```ts
const ORIGIN = 'https://viabiancarestaurant.com';

function post(body: unknown, headers: Record<string, string> = {}, origin = ORIGIN): Request {
  return new Request(`${origin}/api/campaign`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function env() {
  const fake = new FakeD1();
  return { fake, env: { DB: asD1(fake) } };
}

describe('POST /api/campaign', () => {
  it('writes exactly one row for one tagged arrival', async () => {
    const { fake, env: e } = env();
    const response = await handleCampaignArrival(post({ source: 'instagram' }), e);
    expect(response.status).toBe(204);
    expect(fake.campaignArrivals).toHaveLength(1);
    expect(fake.campaignArrivals[0].source).toBe('instagram');
  });

  // Stated as its own case so the ONE-ROW guarantee is unambiguous about
  // where it lives: the server does not deduplicate and cannot. What stops
  // four page views becoming four rows is that only ONE request is ever sent
  // (src/campaign.ts, observed in e2e/campaign-write.spec.ts). Without this
  // test the browser half and the server half can quietly cover for each
  // other and nothing says which one holds the guarantee.
  it('four arrivals write four rows — the server counts what it is sent', async () => {
    const { fake, env: e } = env();
    for (let i = 0; i < 4; i += 1) await handleCampaignArrival(post({ source: 'instagram' }), e);
    expect(fake.campaignArrivals).toHaveLength(4);
  });

  it('refuses a request from another origin before it touches storage', async () => {
    const { fake, env: e } = env();
    const response = await handleCampaignArrival(post({ source: 'instagram' }, { Origin: 'https://evil.example' }), e);
    expect(response.status).toBe(403);
    expect(fake.statements).toEqual([]);
  });

  it('refuses a request with no Origin header at all', async () => {
    const { fake, env: e } = env();
    const bare = new Request(`${ORIGIN}/api/campaign`, { method: 'POST', body: '{"source":"instagram"}' });
    expect((await handleCampaignArrival(bare, e)).status).toBe(403);
    expect(fake.statements).toEqual([]);
  });

  // The case a hardcoded origin literal passes and a derived one fails. This
  // site is served from a preview host as well as its own domain, and the
  // last hardcoded-origin defect here pinned a counter at zero for weeks.
  it('accepts a same-origin request on the preview host too', async () => {
    const { fake, env: e } = env();
    const response = await handleCampaignArrival(post({ source: 'instagram' }, {}, 'https://vb.pages.dev'), e);
    expect(response.status).toBe(204);
    expect(fake.campaignArrivals).toHaveLength(1);
  });

  it('folds a source it does not know into one bucket', async () => {
    const { fake, env: e } = env();
    await handleCampaignArrival(post({ source: 'fbclid-9911' }), e);
    await handleCampaignArrival(post({ source: '<script>' }), e);
    expect(fake.campaignArrivals.map((row) => row.source)).toEqual(['other', 'other']);
  });

  it('writes nothing for a body with no usable source in it', async () => {
    const { fake, env: e } = env();
    for (const body of [{}, { source: '' }, { source: 42 }]) {
      expect((await handleCampaignArrival(post(body), e)).status).toBe(204);
    }
    expect(fake.campaignArrivals).toEqual([]);
  });

  it('stops writing once one address is over the per-minute limit', async () => {
    const { fake, env: e } = env();
    for (let i = 0; i < CAMPAIGN_RATE_MAX + 5; i += 1) {
      await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '1.2.3.4' }), e);
    }
    expect(fake.campaignArrivals).toHaveLength(CAMPAIGN_RATE_MAX);
  });

  it('limits each address separately', async () => {
    const { fake, env: e } = env();
    for (let i = 0; i < CAMPAIGN_RATE_MAX; i += 1) {
      await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '1.2.3.4' }), e);
    }
    await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '5.6.7.8' }), e);
    expect(fake.campaignArrivals).toHaveLength(CAMPAIGN_RATE_MAX + 1);
  });

  it('stores no address anywhere, in any column', async () => {
    // The privacy claim, checked against what actually landed rather than
    // against the schema. The limiter bucket is a hash; the arrival row has
    // no address column at all.
    const { fake, env: e } = env();
    await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '203.0.113.9' }), e);
    const stored = JSON.stringify([...fake.campaignRate.keys(), ...fake.campaignArrivals]);
    expect(stored).not.toContain('203.0.113.9');
  });

  it('answers a capped request the same way it answers an accepted one', async () => {
    const { env: e } = env();
    const accepted = await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '5.5.5.5' }), e);
    let last = accepted;
    for (let i = 0; i < CAMPAIGN_RATE_MAX + 2; i += 1) {
      last = await handleCampaignArrival(post({ source: 'instagram' }, { 'CF-Connecting-IP': '5.5.5.5' }), e);
    }
    expect(last.status).toBe(accepted.status);
    expect(await last.text()).toBe(await accepted.text());
  });

  it('answers 204 rather than throwing when the insert fails', async () => {
    const { fake, env: e } = env();
    fake.failWith = 'D1_ERROR: no such table';
    fake.failAfter = 2; // the two limiter statements succeed; the insert does not
    expect((await handleCampaignArrival(post({ source: 'instagram' }), e)).status).toBe(204);
  });

  it('keys the row by IST date, not UTC', async () => {
    // 21:00 UTC on the 17th is 02:30 IST on the 18th. A UTC key files this
    // under her yesterday.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T21:00:00Z'));
    const { fake, env: e } = env();
    await handleCampaignArrival(post({ source: 'instagram' }), e);
    expect(fake.campaignArrivals[0].day).toBe('2026-08-18');
    vi.useRealTimers();
  });

  it('has a daily cap larger than one address can reach alone', () => {
    expect(CAMPAIGN_DAILY_CAP).toBeGreaterThan(CAMPAIGN_RATE_MAX * 60 * 24 / 10);
  });
});
```

- [ ] **Step 7: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/campaign.test.ts worker/__tests__/hardening.test.ts src/shared/__tests__/campaign-sources.test.ts`**

**Do not deploy the Worker in this task.** `/api/campaign` goes live in **Task 20**, after the card that teaches her the link format exists.

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| delete the `recordArrival` call | "writes exactly one row for one tagged arrival" | — |
| delete the Origin check | "refuses a request from another origin…", "refuses a request with no Origin header at all" | — |
| compare `Origin` against a hardcoded `'https://viabiancarestaurant.com'` | "accepts a same-origin request on the preview host too" | That test is written for exactly this row; without it, this mutation reddens **nothing today**. If it has been dropped, put it back before finishing. |
| `request.headers.get('Origin') ?? origin` | "refuses a request with no Origin header at all" | — |
| pass `raw` to `recordArrival` instead of `source` | "folds a source it does not know into one bucket" | — |
| accept a non-string source via `String(body?.source)` | "writes nothing for a body with no usable source in it" | — |
| ignore `takeRateSlot`'s answer for the per-address bucket | "stops writing once one address is over the per-minute limit" | — |
| drop the window from the hashed bucket | "starts again once the window has moved on" (Task 7) | Add a case here: two arrivals from one address 61 seconds apart, with fake timers, must both be written. |
| store the raw IP as the bucket | "stores no address anywhere, in any column" | — |
| return 429 on the cap instead of 204 | "answers a capped request the same way it answers an accepted one" | — |
| remove the `try`/`catch` around `recordArrival` | "answers 204 rather than throwing when the insert fails" | — |
| use `new Date().toISOString().slice(0,10)` for `day` | "keys the row by IST date, not UTC" | — |

**CSS ceiling:** zero bytes from `worker/**`. `src/shared/campaign-sources.ts` **is** inside the content glob — run `npm run build` and confirm 39037 is unchanged. Any movement is a word in one of its comments and is fixed by rewording, not by a raise.

**If this task is wrong:** the campaign card reports a number nobody can trust — too high if it is forgeable, zero if the origin check is wrong — and every decision she makes about where to put a link is made from it. In the worst version, a public endpoint writes unbounded rows into the database the whole site's content lives in.

---
## Task 9: The arrival decision, on the client

The other half of "once per arrival, never once per page". The server cannot deduplicate — it sees one request and writes one row (Task 8 asserts exactly that) — so this module is what makes the number right.

**Files:**
- Create: `src/campaign.ts`
- Create: `src/__tests__/campaign.test.ts`
- Modify: `src/main.tsx`

**Interfaces:**
```ts
export const ARRIVAL_STORAGE_KEY: 'vb:arrival:v1';
export function arrivalToRecord(
  pathname: string,
  search: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): string | null;
export function recordArrivalIfTagged(): void;   // the only impure export
```

- [ ] **Step 1: `src/campaign.ts` — the decision, with no network in it**

The whole once-per-arrival rule is one pure function, which is what makes it table-testable; the impure wrapper below it has nothing to decide.

```ts
// A tagged arrival, counted ONCE PER ARRIVAL and never once per page.
//
// This is the single most likely place for the Numbers panel to report a
// number four or five times too high, and three things stop it:
//
//   * The tag is in the URL only on ARRIVAL. This site is a single-page app,
//     so moving from the homepage to a post is a router transition -- no new
//     document, no new query string, and this module is never consulted
//     again. Ordinary browsing cannot re-count.
//   * The call site is MODULE SCOPE in main.tsx, not an effect. React's
//     StrictMode mounts, unmounts and remounts every component under
//     `npm run dev`, which is what Playwright drives; an effect that fires
//     this would fire it twice on every developer's machine and in every
//     browser test.
//   * A REFRESH does re-send the same URL, so the browser is asked to
//     remember, for this tab only, that this arrival was already recorded.
//     sessionStorage, cleared when the tab closes. Not a cookie, not an
//     identifier, and it cannot follow anyone between visits.
//
// THE MARK IS WRITTEN BEFORE ANYTHING IS SENT. That ordering is a second,
// independent guard against the StrictMode double-fire above: if this is ever
// moved into an effect by a future edit, marking first makes the second
// invocation a no-op instead of a second row. Send-then-mark would be correct
// today and wrong the moment somebody moves the call, and the failure would
// be a doubled number rather than an error.
//
// The value stored is the SOURCE, not a flag: two different tagged links
// opened in the same tab are two different arrivals and both should count,
// and a bare boolean would silently drop the second.
import { normalizeSource } from './shared/campaign-sources';

export const ARRIVAL_STORAGE_KEY = 'vb:arrival:v1';

export function arrivalToRecord(
  pathname: string,
  search: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): string | null {
  // Her own editing sessions are never campaign arrivals. The same
  // path-segment boundary worker/analytics.ts's isExcludedPath uses applies,
  // so a future public page whose slug begins with those four letters is not
  // silently exempted.
  if (pathname === '/edit' || pathname.startsWith('/edit/')) return null;

  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get('utm_source');
  } catch {
    return null;
  }
  // AN UNTAGGED VISIT WRITES NOTHING. Ordinary traffic costs this site zero
  // requests and zero rows, which is what keeps the write path small enough
  // to reason about at all.
  if (raw === null || raw.trim() === '') return null;
  const source = normalizeSource(raw);

  try {
    if (storage.getItem(ARRIVAL_STORAGE_KEY) === source) return null;
    storage.setItem(ARRIVAL_STORAGE_KEY, source);
  } catch {
    // Private browsing, or storage that is full. The honest choice is to
    // count the arrival and accept that a refresh in this tab may count it
    // twice: the alternative drops a real arrival every time, which biases
    // the card downward permanently rather than upward occasionally. The
    // card's own caveat says the count is imperfect in both directions.
    return source;
  }
  return source;
}

// The only impure export, and it is deliberately tiny: everything worth
// testing is above it.
//
// `fetch` with `keepalive`, NOT navigator.sendBeacon, and the reason is what
// has to be PROVEN about this path rather than a preference. A beacon returns
// a boolean and is invisible to page.route and awkward for page.on('request')
// to reason about; this returns a promise a test can observe, a route can
// intercept, and a `.catch` can swallow. `keepalive` gives the same
// survives-a-navigation property a beacon has. Nothing awaits it, so nothing
// about the page waits for it, and the rejection is swallowed because a
// counter that costs the restaurant a customer is worse than no counter --
// the principle Hero.tsx already states for the tap counter.
export function recordArrivalIfTagged(): void {
  try {
    const source = arrivalToRecord(window.location.pathname, window.location.search, window.sessionStorage);
    if (source === null) return;
    void fetch('/api/campaign', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    }).catch(() => {});
  } catch {
    // Nothing here may reach the page.
  }
}
```

- [ ] **Step 2: Wire it into `src/main.tsx`, at module scope, after the render call**

```tsx
import { recordArrivalIfTagged } from './campaign';
```

```tsx
// AFTER the render call and at MODULE SCOPE, never in an effect. Module scope
// runs exactly once per document however many times React mounts anything,
// which is what makes StrictMode's double-mount irrelevant here rather than
// merely survivable. After, because issuing a request must not sit in front
// of a paint that has already been scheduled.
recordArrivalIfTagged();
```

- [ ] **Step 3: `src/__tests__/campaign.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ARRIVAL_STORAGE_KEY, arrivalToRecord } from '../campaign';

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  };
}

describe('arrivalToRecord', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('records a tagged arrival once and refuses the same tag again in this tab', () => {
    expect(arrivalToRecord('/', '?utm_source=instagram', storage)).toBe('instagram');
    expect(arrivalToRecord('/', '?utm_source=instagram', storage)).toBeNull();
    expect(storage.map.get(ARRIVAL_STORAGE_KEY)).toBe('instagram');
  });

  // The case a bare boolean would get wrong.
  it('records a DIFFERENT tag in the same tab as its own arrival', () => {
    expect(arrivalToRecord('/', '?utm_source=instagram', storage)).toBe('instagram');
    expect(arrivalToRecord('/', '?utm_source=zomato', storage)).toBe('zomato');
  });

  it('records nothing at all for an untagged visit', () => {
    for (const search of ['', '?', '?ref=x', '?utm_source=', '?utm_source=%20%20', '?utm_medium=cpc']) {
      expect(arrivalToRecord('/', search, storage)).toBeNull();
    }
    expect(storage.map.size).toBe(0);
  });

  it('never counts her own editing sessions', () => {
    expect(arrivalToRecord('/edit', '?utm_source=instagram', storage)).toBeNull();
    expect(arrivalToRecord('/edit/manage/menu', '?utm_source=instagram', storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('still counts a public page whose slug begins with those four letters', () => {
    // The off-by-one. `startsWith('/edit')` without the segment boundary
    // silently exempts every future page called /editorial.
    expect(arrivalToRecord('/editorial', '?utm_source=instagram', storage)).toBe('instagram');
  });

  it('counts the arrival rather than dropping it when storage refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(arrivalToRecord('/', '?utm_source=instagram', refusing)).toBe('instagram');
  });

  it('normalises before it compares, so two spellings of one link are one arrival', () => {
    expect(arrivalToRecord('/', '?utm_source=Instagram', storage)).toBe('instagram');
    expect(arrivalToRecord('/', '?utm_source=INSTAGRAM', storage)).toBeNull();
  });

  it('normalises an unknown tag before it leaves the browser', () => {
    expect(arrivalToRecord('/', '?utm_source=fbclid-9911', storage)).toBe('other');
  });

  it('remembers under a versioned key', () => {
    expect(ARRIVAL_STORAGE_KEY).toBe('vb:arrival:v1');
  });
});
```

- [ ] **Step 4: Re-read `src/campaign.ts` and the `src/main.tsx` addition for bare utility-class tokens.** Both are inside Tailwind's glob. This is a confirm-by-reading step, not an assumption.

- [ ] **Step 5: `npx tsc -b --noEmit && npm test -- --run src/__tests__/campaign.test.ts src/test/homepage-bytes.test.tsx`**

`homepage-bytes` must pass **unchanged**: `src/main.tsx` is not rendered by `AppRoutes` and `src/campaign.ts` renders nothing. It is a zero-movement guard, and it is here to catch this task accidentally rendering markup. If that number moves, find the cause — do not re-pin it.

- [ ] **Step 6: `npm run build` and confirm the entry CSS is still 39037.** A move of any size is a leaked utility token in one of the comments above and is fixed by rewording, never accommodated by a raise.

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| delete the `storage.setItem` call | "records a tagged arrival once and refuses the same tag again in this tab" | — |
| store `'1'` instead of the source | "records a DIFFERENT tag in the same tab as its own arrival" | — |
| drop the `raw.trim() === ''` guard | "records nothing at all for an untagged visit" | — |
| `catch { return null; }` around the storage write | "counts the arrival rather than dropping it when storage refuses" | — |
| compare `raw` against storage instead of `source` | "normalises before it compares…" | — |
| `pathname.startsWith('/edit')` without the segment boundary | "still counts a public page whose slug begins with those four letters" | — |
| remove the `/edit` guard entirely | "never counts her own editing sessions" | — |
| move `recordArrivalIfTagged()` into a `useEffect` in `App.tsx` | **nothing reddens in jsdom** | This is Task 10's first mutation row and it reddens there, in a real browser with StrictMode live. jsdom cannot see it, and inventing a jsdom row for it would be a test that proves nothing. |
| swap `fetch(..., {keepalive:true})` for `navigator.sendBeacon` | **nothing reddens here** | Stated: this is a testability decision, not a behavioural one. Task 10 is what depends on it, and its assertions read `request.postData()`, which a beacon does not reliably provide. |

**CSS ceiling:** zero bytes expected, and it is **checked** rather than assumed (Step 6).

**If this task is wrong:** the campaign card reads four or five times too high — exactly the failure the spec singles out — and it looks entirely plausible, because a card claiming 400 arrivals from Instagram is not obviously different from one claiming 100.

---

## Task 10: One arrival, four real page views, one row — observed in a browser

The claim the spec says to be most suspicious of. Nothing in this project's browser suite has ever observed a real write; every publish assertion reads the source back after a remount instead of inspecting a request, and the bug that broke three times lived exactly there. **A test that mocks the write and asserts the mock was called proves nothing**, so every assertion here reads requests the browser genuinely emitted, from `page.on('request')`.

**The four page views have to be real, and on this site that is not automatic.** `src/content/copy.json`'s six nav entries are all `#` fragments (`#gallery`, `#menu`, `#experiences`, `#our-story`, `#blogs`, `#visit`) and `NavBar.tsx` renders a section entry as a plain `<a href="#...">`. `src/App.tsx` has only `/`, `/blog`, `/blog/:slug` and `/:slug`. Clicking "Menu" therefore **scrolls the page, changes no route, remounts nothing and fires no arrival code** — and because `getByRole`'s name matching is substring and case-insensitive, the click *succeeds*. A test that clicked those four and asserted one request would be asserting that one page load sends one request, dressed as a proof that the factor-of-four bug is impossible. So this file navigates through the links on this site that genuinely are router transitions, and **asserts the URL changed after every one of them**.

**Files:**
- Create: `e2e/observe-writes.ts`
- Create: `e2e/campaign-write.spec.ts`

**Interfaces:**
```ts
export interface ObservedRequest { url: string; method: string; postData: string | null }
export function observeRequests(page: Page, pattern: RegExp): ObservedRequest[];
```

- [ ] **Step 1: `e2e/observe-writes.ts`**

```ts
// Records what the browser ACTUALLY sent.
//
// The distinction this module exists for: `page.route(...)` intercepts a
// request and lets a test assert that its own handler ran, which proves the
// pattern matched and nothing else. `page.on('request')` fires for every
// request the page emits, whether or not anything intercepts it, and the
// array it fills is evidence rather than a stand-in for evidence.
//
// A route handler is still needed alongside it, because the dev server has no
// Worker behind it and would answer /api/campaign with the SPA fallback. That
// handler exists only to keep the network quiet; the assertions read this
// array and never ask whether it ran.
//
// Not a `.spec.ts`: playwright.config.ts's testDir picks up every file it
// considers a test, and a helper with no test() call is reported as an empty
// suite.
import type { Page } from '@playwright/test';

export interface ObservedRequest {
  url: string;
  method: string;
  postData: string | null;
}

export function observeRequests(page: Page, pattern: RegExp): ObservedRequest[] {
  const seen: ObservedRequest[] = [];
  page.on('request', (request) => {
    if (!pattern.test(request.url())) return;
    seen.push({ url: request.url(), method: request.method(), postData: request.postData() });
  });
  return seen;
}
```

- [ ] **Step 2: `e2e/campaign-write.spec.ts` — the fixture that cannot stand still**

```ts
// The campaign write path, observed rather than mocked.
//
// WHERE THIS PROOF STOPS, said plainly rather than implied. This file
// observes what the BROWSER sent: exactly one POST for one arrival and four
// in-app page views. worker/__tests__/campaign.test.ts observes what the
// SERVER does with one POST -- exactly one row, and no row at all when the
// origin is wrong or a limit is spent. The two halves meet at an HTTP request
// whose shape both sides assert on, and nothing between them is mocked in a
// way either assertion depends on.
//
// What is NOT proven anywhere: that a real deployed Worker, behind a real
// route in wrangler.toml, receives it. That is a deploy-time check
// (`npm run verify:deploy`), not a test, and pretending otherwise is the kind
// of claim this project has been burned by.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { observeRequests } from './observe-writes';

const CAMPAIGN = /\/api\/campaign/;

async function quietBackend(page: Page, status = 204): Promise<void> {
  await page.route('**/api/campaign', async (route) => {
    await route.fulfill({ status, body: '' });
  });
}

// FOUR REAL IN-APP PAGE VIEWS, and every one of them is asserted to have
// happened.
//
// This site's whole nav bar is `#` fragments rendered as plain anchors
// (copy.json's nav, NavBar.tsx's `kind === 'section'` branch), and its only
// routes are /, /blog, /blog/:slug and /:slug. Clicking "Menu" scrolls and
// changes nothing -- and getByRole matches names by substring, so the click
// still succeeds. A fixture built on those clicks proves that one page load
// sends one request and calls it proof that route changes do not re-count.
//
// So: the "read the blog" link on the homepage (a router <Link to="/blog">
// in BlogSection.tsx), a post card (<Link to={`/blog/${slug}`}> in
// PostCard.tsx), then two history pops -- all four are router transitions
// with no new document, and toHaveURL after each means the test cannot be
// satisfied by standing still.
//
// The last pop is deliberately back onto the TAGGED url. A naive
// implementation that re-reads the query string on every route change fires
// there, and this is the case that catches it.
async function readFourPages(page: Page): Promise<void> {
  await page.locator('a[href="/blog"]').first().click();
  await expect(page).toHaveURL(/\/blog$/);

  await page.locator('a[href^="/blog/"]').first().click();
  await expect(page).toHaveURL(/\/blog\/[^/]+$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/blog$/);

  await page.goBack();
  await expect(page).toHaveURL(/utm_source=instagram/);
}

test.describe('a tagged arrival is counted once, not once per page', () => {
  test('one tagged arrival plus four in-app page views sends exactly one write', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);

    await page.goto('/?utm_source=instagram');
    await page.waitForLoadState('networkidle');
    await readFourPages(page);
    await page.waitForLoadState('networkidle');

    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('POST');
    expect(JSON.parse(writes[0].postData ?? 'null')).toEqual({ source: 'instagram' });
  });

  test('a refresh of the same tagged URL in the same tab sends no second write', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);

    await page.goto('/?utm_source=instagram');
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');

    expect(writes).toHaveLength(1);
  });

  test('an untagged visit sends nothing at all', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('a[href="/blog"]').first().click();
    await expect(page).toHaveURL(/\/blog$/);
    await page.waitForLoadState('networkidle');

    expect(writes).toEqual([]);
  });

  test('a different tagged link in the same tab is its own arrival', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);

    await page.goto('/?utm_source=instagram');
    await page.waitForLoadState('networkidle');
    await page.goto('/?utm_source=zomato');
    await page.waitForLoadState('networkidle');

    expect(writes.map((write) => JSON.parse(write.postData ?? 'null'))).toEqual([
      { source: 'instagram' },
      { source: 'zomato' },
    ]);
  });

  test('an unknown tag is normalised before it leaves the browser', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);
    await page.goto('/?utm_source=fbclid-9911');
    await page.waitForLoadState('networkidle');
    expect(JSON.parse(writes[0]?.postData ?? 'null')).toEqual({ source: 'other' });
  });

  test('a failed write loses the row and never blocks the page', async ({ page }) => {
    // The Hero.tsx principle applied to a second counter: a counter that
    // costs the restaurant a customer is worse than no counter.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/campaign', async (route) => {
      await route.abort('failed');
    });

    await page.goto('/?utm_source=instagram');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('her own editing session is never counted', async ({ page }) => {
    await quietBackend(page);
    const writes = observeRequests(page, CAMPAIGN);
    await page.goto('/edit?utm_source=instagram');
    await page.waitForLoadState('networkidle');
    expect(writes).toEqual([]);
  });
});
```

- [ ] **Step 3: Prove the fixture navigates before trusting a single green**

Run once with `readFourPages` reduced to its first click and confirm the URL assertion is what fails when the selector is wrong. Then put it back. A request-counting test that counts zero because nothing navigated looks exactly like a passing test, and this repository has shipped that shape.

- [ ] **Step 4: `npx eslint e2e/observe-writes.ts e2e/campaign-write.spec.ts && npm run test:e2e -- campaign-write`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| move `recordArrivalIfTagged()` into a `useEffect` inside `App`, no dependency array | "one tagged arrival plus four in-app page views sends exactly one write" — reports **2**, because StrictMode double-mounts under `npm run dev` | If it reports 1, `sessionStorage` absorbed the second call — which is the mark-before-send guard doing its job. Then also delete the `storage.setItem` line and re-run; it must report 2. |
| mount it inside a route element so it re-fires per navigation | the same test — reports **5** | The fixture is not navigating. Re-run Step 3. |
| remove the sessionStorage guard | "a refresh of the same tagged URL in the same tab sends no second write" — reports 3 | — |
| record unconditionally, ignoring `arrivalToRecord`'s null | "an untagged visit sends nothing at all" | — |
| store a boolean flag instead of the source | "a different tagged link in the same tab is its own arrival" | — |
| send `raw` instead of `normalizeSource(raw)` | "an unknown tag is normalised before it leaves the browser" | — |
| remove the `.catch(() => {})` on the fetch | "a failed write loses the row and never blocks the page" (a `pageerror` is recorded) | — |
| remove the `/edit` guard | "her own editing session is never counted" | — |
| replace `readFourPages`'s router links with nav clicks (`Menu`, `Our Story`, …) | **nothing reddens — every test still passes** | Exactly the defect this file's header names. Those clicks scroll and navigate nowhere, so the `toHaveURL` assertions are what turn a wrong fixture red instead of green. Never remove them. |
| change the assertion from `writes` to the route handler's call count | **none of the above redden** if the route pattern is ever loosened | This is the standing reason `page.on('request')` exists rather than `page.route` bookkeeping. Keep the array. |

**CSS ceiling:** zero bytes. `e2e/**` is outside Tailwind's content glob.

**If this task is wrong:** the panel's most precise-looking number — "84 people arrived through your Instagram bio" — is a multiple of the truth, and nothing on the screen or in the suite would say so.

---

## Task 11: `e2e/` observes a real publish body

**Closes backlog item 19.** The helper built in Task 10 is pointed at the request this project has never once inspected. "What she publishes" is inferred today from what a remount writes back, never from a request body — and the staged-photo bug that broke three times lives exactly in that gap.

**Files:**
- Create: `e2e/publish-write.spec.ts`
- Modify: `e2e/edit-backend.ts` (export `openDashboard`)

**Interfaces:**
- Consumes: `observeRequests` (`e2e/observe-writes.ts`), `mockEditBackend` and `CONTENT_FILES` (`e2e/edit-backend.ts`), `openDashboard`.
- Produces: nothing importable.

- [ ] **Step 1: Lift `openDashboard` out of `dashboard-sections.spec.ts`**

Move `openDashboard(page, path = '/edit/manage')` **verbatim** into `e2e/edit-backend.ts` and export it; `dashboard-sections.spec.ts` imports it instead. It is byte-identical afterwards, so every spec that used it stays green as written. A second copy in a new file is how `CONTENT_FILES` came to be maintained by hand in three places, which that file's own header already records.

- [ ] **Step 2: `e2e/publish-write.spec.ts`**

```ts
// The first thing in this repository that has ever looked at what a publish
// actually SENDS.
//
// Every existing assertion about publishing reads the content back after a
// remount and infers the request from it. That is the exact blind spot the
// staged-photo bug lived in three separate times: a remount reads the
// registry, and the registry can be right while the body on the wire is
// wrong. So these assertions read `postData` -- the count and the identity of
// the staged photos actually on the wire -- and never what a remount reports.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockEditBackend, openDashboard } from './edit-backend';
import { observeRequests } from './observe-writes';

const PUBLISH = /\/api\/publish/;

interface PublishFile {
  path: string;
  content: string;
  encoding: string;
  baseSha?: string;
}

async function acceptPublishes(page: Page): Promise<void> {
  await page.route('**/api/publish', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sha: 'e2ee2ee', publishId: 'e2e-publish', d1Paths: [] }),
    });
  });
}

// The two explicit throws are the difference between this spec and one that
// quietly asserts nothing: a typo'd key name fails loudly here instead of
// producing an empty array that every `toEqual([])` accepts.
function filesOf(postData: string | null): PublishFile[] {
  if (postData === null) throw new Error('the publish request carried no body at all');
  const body = JSON.parse(postData) as { files?: PublishFile[] };
  if (!Array.isArray(body.files)) throw new Error('the publish body has no files array');
  return body.files;
}

test.describe('what a publish actually sends', () => {
  test('sends only the file that changed, and sends it once', async ({ page }) => {
    await mockEditBackend(page);
    await acceptPublishes(page);
    const writes = observeRequests(page, PUBLISH);
    await openDashboard(page, '/edit/manage/menu');

    await page.getByRole('button', { name: /^Aglio/ }).first().click();
    await page.getByLabel('Name').first().fill('Aglio e Pepperoncini con Gamberi');
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: /^Publish/ }).click();
    await page.getByRole('button', { name: /^Yes/ }).click();
    await expect.poll(() => writes.length).toBe(1);

    const files = filesOf(writes[0].postData);
    expect(files.map((file) => file.path)).toEqual(['src/content/dishes.json']);
    expect(JSON.parse(files[0].content)[0].name).toBe('Aglio e Pepperoncini con Gamberi');
  });

  // Backlog item 5's assertion, from the only side that can see it. A deleted
  // record's upload has always still been in the body; the reason nobody
  // could tell is that nothing ever read the body.
  //
  // Marked test.fail() here and unmarked in Task 28. That ordering is
  // deliberate and honest: the observation is what makes the fix provable, so
  // it lands first and the fix turns it green.
  test.fail(true, 'green from Task 28, which releases a deleted record’s staged bytes');
  test('a record deleted before publishing takes its staged photo bytes with it', async ({ page }) => {
    await mockEditBackend(page);
    await acceptPublishes(page);
    const writes = observeRequests(page, PUBLISH);
    await openDashboard(page, '/edit/manage/menu');

    await page.getByRole('button', { name: /^Aglio/ }).first().click();
    await page.getByLabel('Photo').setInputFiles({
      name: 'dish.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]),
    });
    await page.getByRole('button', { name: /^Delete/ }).click();
    await page.getByRole('button', { name: /^Yes, delete/ }).click();

    await page.getByRole('button', { name: /^Publish/ }).click();
    await page.getByRole('button', { name: /^Yes/ }).click();
    await expect.poll(() => writes.length).toBe(1);

    const files = filesOf(writes[0].postData);
    const uploads = files.filter((file) => !file.path.startsWith('src/content/'));
    // The COUNT and the IDENTITY of the staged photos on the wire, not what a
    // remount reads back.
    expect(uploads).toEqual([]);
  });

  test('a photo she keeps IS on the wire, so the test above is not passing by accident', async ({ page }) => {
    await mockEditBackend(page);
    await acceptPublishes(page);
    const writes = observeRequests(page, PUBLISH);
    await openDashboard(page, '/edit/manage/menu');

    await page.getByRole('button', { name: /^Aglio/ }).first().click();
    await page.getByLabel('Photo').setInputFiles({
      name: 'dish.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]),
    });
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: /^Publish/ }).click();
    await page.getByRole('button', { name: /^Yes/ }).click();
    await expect.poll(() => writes.length).toBe(1);

    const uploads = filesOf(writes[0].postData).filter((file) => !file.path.startsWith('src/content/'));
    expect(uploads).toHaveLength(1);
  });

  test('a publish with nothing changed sends no request at all', async ({ page }) => {
    await mockEditBackend(page);
    await acceptPublishes(page);
    const writes = observeRequests(page, PUBLISH);
    await openDashboard(page, '/edit/manage/menu');

    const publish = page.getByRole('button', { name: /^Publish/ });
    if (await publish.isEnabled()) {
      await publish.click();
      await page.waitForTimeout(500);
    }
    expect(writes).toEqual([]);
  });
});
```

- [ ] **Step 3: Confirm the body's key names against `src/admin/publish.ts` before trusting a green run**

`requestPublish` sends `JSON.stringify({ files })` and each entry is `{ path, content, encoding, baseSha? }` from `buildPublishRequest`. The assertions above are written against exactly those names. Read them; do not assume.

- [ ] **Step 4: `npx eslint e2e/publish-write.spec.ts && npm run test:e2e -- publish-write`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| include every content file rather than `dirtyContentFiles(entries)` in `buildPublishRequest` | "sends only the file that changed, and sends it once" | — |
| send `JSON.stringify(entries)` in place of `{ files }` | all of them — `filesOf` throws "the publish body has no files array" | — |
| keep the staged upload for a deleted record (i.e. do not apply Task 28's fix) | "a record deleted before publishing takes its staged photo bytes with it" — which is why it is `test.fail()` until then | — |
| drop staged uploads from the body entirely | "a photo she keeps IS on the wire…" | That test exists so the deleted-record assertion cannot pass by the body never carrying uploads at all. Without it, `toEqual([])` is green against a broken publish. |
| make the Publish button send an empty request when nothing is dirty | "a publish with nothing changed sends no request at all" | — |
| change the assertions to count route-handler invocations | **nothing reddens** if `page.route`'s pattern ever matches an unrelated URL | The standing reason the array comes from `page.on('request')`. |

**CSS ceiling:** zero bytes. `e2e/**` is outside the content glob.

**If this task is wrong:** the one class of bug that has broken this site three times stays invisible, and the next occurrence is found by the owner, in production, after a publish.

---

## Task 12: Campaign rows into the payload

Retires the read-side half of the campaign risk: grouping, ordering and the range window. This is where a correct table can still produce a wrong card.

**Files:**
- Modify: `worker/campaign.ts` (add `readCampaignRows`)
- Modify: `worker/analytics.ts` (call it; recompute the subrequest budget comment)
- Modify: `worker/__tests__/campaign.test.ts`, `worker/__tests__/analytics.test.ts`

**Interfaces:**
```ts
export function readCampaignRows(db: D1Database, sinceDay: string): Promise<AnalyticsCampaignRow[]>;
// worker/analytics.ts
export function istDateDaysAgo(today: string, days: number): string;
```

- [ ] **Step 1: `readCampaignRows` in `worker/campaign.ts`**

```ts
// NEVER THROWS. A D1 failure here degrades the campaign card to empty and
// leaves the six cards that have nothing to do with D1 alone -- the same
// contract readWaCounts already keeps for the tap number, and for the same
// reason: one storage failure must not take a screen down. The catch lives
// HERE and not in analytics-store.ts, because "what a failure costs" is a
// decision per caller and the nightly job makes the opposite one.
export async function readCampaignRows(db: D1Database, sinceDay: string): Promise<AnalyticsCampaignRow[]> {
  try {
    const totals = await campaignTotals(db, sinceDay);
    return totals.map((row) => ({
      source: row.source,
      // Falls back to the raw source rather than hiding a row whose label is
      // missing. A source string in the table this Worker has no words for is
      // a deploy that half-landed, and showing it is how that becomes visible
      // instead of becoming a missing row.
      label: CAMPAIGN_LABELS[row.source] ?? row.source,
      arrivals: row.arrivals,
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Call it from `handleAnalytics`, on an inclusive IST window**

Replace `campaigns: []` in the payload literal:

```ts
  // IST dates, matching the column. `sinceDay` is windowDays back from the
  // restaurant's today, INCLUSIVE, so a 7-day range covers seven of her
  // calendar days rather than 168 hours ending at an arbitrary moment.
  const today = todayInKolkata();
  const sinceDay = istDateDaysAgo(today, windowDays - 1);
  const campaigns = await readCampaignRows(env.DB, sinceDay);
```

with the helper beside `recentIstDates`:

```ts
// N days back from an IST calendar date, as an IST calendar date. Built on
// Date.UTC arithmetic over the parsed parts rather than on a Date in local
// time -- the Worker's own clock is UTC and a local-time Date would shift the
// answer by a day for five and a half hours out of every twenty-four.
export function istDateDaysAgo(today: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return today;
  const [year, month, day] = today.split('-').map(Number);
  const base = Date.UTC(year, month - 1, day);
  return new Date(base - days * DAY_MS).toISOString().slice(0, 10);
}
```

`AnalyticsEnv` gains `DB: D1Database`.

- [ ] **Step 3: Recompute the subrequest budget comment at `worker/analytics.ts:70-77`**

```ts
// SUBREQUEST AND CPU BUDGET, recomputed because this route grew.
//
// Cloudflare counts a subrequest per outbound fetch and per Cache API call.
// D1 queries through a binding are NOT subrequests -- they are billed as rows
// read, against 5,000,000 a day, and this route reads at most a handful per
// miss.
//
//   cache HIT:  1  (cache.match)
//   cache MISS: 4  (cache.match, one GraphQL fetch, one KV get, cache.put)
//               + 1 D1 query for the campaign card
//               + 2 D1 queries for the trend series and its first day
//               + 1 D1 query for whether the by-year archive holds anything
//
// The SUBREQUEST count is therefore UNCHANGED at 4, which is the number that
// mattered. Recompute this block again if anything is added.
```

- [ ] **Step 4: The tests**

```ts
describe('readCampaignRows', () => {
  it('gives every row the words the card shows', async () => {
    const { fake, db } = store();
    await recordArrival(db, 'instagram', '2026-08-18', 0);
    await recordArrival(db, 'instagram', '2026-08-18', 0);
    await recordArrival(db, 'zomato', '2026-08-17', 0);
    expect(await readCampaignRows(db, '2026-08-01')).toEqual([
      { source: 'instagram', label: 'Instagram link', arrivals: 2 },
      { source: 'zomato', label: 'Zomato link', arrivals: 1 },
    ]);
  });

  it('shows a source it has no words for rather than dropping the row', async () => {
    const { db, fake } = store();
    fake.campaignArrivals.push({ source: 'mystery', day: '2026-08-18', created_at: 0 });
    expect(await readCampaignRows(db, '2026-08-01')).toEqual([
      { source: 'mystery', label: 'mystery', arrivals: 1 },
    ]);
  });

  it('degrades to empty when the database is down, and never throws', async () => {
    const { fake, db } = store();
    fake.failWith = 'D1 is down';
    await expect(readCampaignRows(db, '2026-08-01')).resolves.toEqual([]);
  });
});

describe('istDateDaysAgo', () => {
  it.each([
    ['2026-08-18', 0, '2026-08-18'],
    ['2026-08-18', 6, '2026-08-12'],
    ['2026-08-18', 29, '2026-07-20'],
    ['2026-03-01', 1, '2026-02-28'],
    ['2026-01-01', 1, '2025-12-31'],
  ])('%s minus %i days is %s', (today, days, expected) => {
    expect(istDateDaysAgo(today, days)).toBe(expected);
  });
});

// The wiring, not just the helper.
describe('the campaign card on the payload', () => {
  it('carries the rows for the range it was asked for', async () => {
    const db = new FakeD1();
    db.campaignArrivals.push({ source: 'instagram', day: todayInKolkata(), created_at: 0 });
    const body = await (await handleAnalytics(analyticsRequest('?range=7d'), buildEnv({ db }))).json();
    expect(body.campaigns).toEqual([{ source: 'instagram', label: 'Instagram link', arrivals: 1 }]);
    expect(body.campaignsAreExact).toBe(true);
  });

  it('counts the whole first day of the window, inclusive', async () => {
    // The off-by-one. A 7-day window ending today must include the day seven
    // calendar days ago, not six.
    const db = new FakeD1();
    db.campaignArrivals.push({ source: 'instagram', day: istDateDaysAgo(todayInKolkata(), 6), created_at: 0 });
    const body = await (await handleAnalytics(analyticsRequest('?range=7d'), buildEnv({ db }))).json();
    expect(body.campaigns[0].arrivals).toBe(1);
  });

  it('leaves out an arrival one day older than the window', async () => {
    const db = new FakeD1();
    db.campaignArrivals.push({ source: 'instagram', day: istDateDaysAgo(todayInKolkata(), 7), created_at: 0 });
    const body = await (await handleAnalytics(analyticsRequest('?range=7d'), buildEnv({ db }))).json();
    expect(body.campaigns).toEqual([]);
  });
});
```

- [ ] **Step 5: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/campaign.test.ts worker/__tests__/analytics.test.ts`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| skip rows with no label | "shows a source it has no words for rather than dropping the row" | — |
| remove the `try/catch` | "degrades to empty when the database is down, and never throws" | — |
| use `windowDays` instead of `windowDays - 1` for `sinceDay` | "counts the whole first day of the window, inclusive" stays green; **"leaves out an arrival one day older than the window"** reddens | Both boundary tests exist precisely because one of them alone cannot catch both directions of this off-by-one. |
| use `windowDays - 2` | "counts the whole first day of the window, inclusive" | — |
| build `sinceDay` from `new Date()` in local time | `istDateDaysAgo`'s table, and its year-boundary row | — |
| move the `catch` from `readCampaignRows` into `campaignTotals` | **nothing reddens** | Accepted, but wrong: the nightly job needs `campaignTotals` to throw so it can decide not to write. State it in review; there is no test for where a catch lives. |

**CSS ceiling:** zero bytes. `worker/**` only.

**If this task is wrong:** the campaign card reads high (window too wide), low (window too narrow), or reorders itself between two refreshes, which reads as the panel being unreliable even when every number in it is right.

---
## Task 13: The nightly job — snapshot, roll, prune, and the cron pair

**Both halves or neither.** A cron with no `scheduled` export is 365 failed invocations a year against a script that cannot answer; a `scheduled` export with no cron is a job nothing calls. And an **absent** `[triggers]` section does not clear a schedule — Cloudflare stores schedules on the script, and wrangler's clearing PUT is guarded by `if (crons)`, which `undefined` fails. That is how an hourly trigger survived on the live Worker for weeks at 24 failed invocations a day. **This project has paid for half-configured cron state once already, so this task pins both halves in one commit.**

**Conditional on Task 1 only at Step 7.** Everything else here is built whichever way the verification went (R8, R9): the trend chart always reads its series from `daily_visits`, and the date dimension decides only whether the first run reaches backwards.

**Files:**
- Create: `worker/rollup.ts`
- Create: `worker/__tests__/rollup.test.ts`
- Modify: `worker/index.ts` (export `scheduled`)
- Modify: `worker/analytics.ts` (the `series` fields; `totalVisitsFor` extracted)
- Modify: `wrangler.toml` (`[triggers]`)
- Modify: `src/test/wrangler-config.test.ts`

**Interfaces:**
```ts
export interface RollupEnv {
  DB: D1Database; CLOUDFLARE_API_TOKEN: string; CLOUDFLARE_ACCOUNT_ID: string; CF_WEB_ANALYTICS_SITE_TAG: string;
}
export function runDailyRollup(env: RollupEnv, nowMs: number): Promise<void>;
// worker/analytics.ts
export function totalVisitsFor(env: WebAnalyticsEnv, since: string, until: string): Promise<number | null>;
```

- [ ] **Step 1: `totalVisitsFor` in `worker/analytics.ts`**

Extracted from `handleAnalytics`'s existing fetch so the nightly job sends the **same verified document** rather than a second one nobody has run.

```ts
// The one upstream call, factored out so the scheduled snapshot sends exactly
// the document Task 1 verified rather than a second one. Returns null on any
// failure -- the caller decides whether that is a 502 (the panel) or a
// skipped night (the snapshot).
//
// The rows go through isExcludedPath before they are summed, exactly as every
// card does, which is why requestPath is in the document at all. An archive
// that counted her own editing visits would sit permanently above the number
// printed beside it.
export async function totalVisitsFor(
  env: WebAnalyticsEnv,
  since: string,
  until: string,
): Promise<number | null> {
  let upstream: Response;
  try {
    upstream = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: ANALYTICS_QUERY,
        variables: {
          accountTag: env.CLOUDFLARE_ACCOUNT_ID,
          siteTag: env.CF_WEB_ANALYTICS_SITE_TAG,
          sinceWindow: since,
          sinceThisWeek: since,
          sincePriorWeek: since,
          sincePrevious: since,
          until,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!upstream.ok) return null;
  const parsed = (await upstream.json().catch(() => null)) as { data?: unknown; errors?: unknown[] } | null;
  if (!parsed || (Array.isArray(parsed.errors) && parsed.errors.length > 0)) return null;
  const accounts = (parsed.data as { viewer?: { accounts?: unknown } } | undefined)?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  return totalVisits(rowsOf((accounts[0] as RumAccount).last28));
}
```

- [ ] **Step 2: `worker/rollup.ts`**

```ts
// The archive. One job, three steps, all idempotent and all harmless to run
// twice.
//
// WHY THIS EXISTS AT ALL: Cloudflare keeps roughly six months of beacon data,
// unsampled for seven days and aggregated to about ten per cent after that.
// "Across years" cannot come from Cloudflare at any price on this plan. So
// each day's total is copied here before Cloudflare discards it, and the
// trend chart draws from the copy -- WHICHEVER WAY the schema verification
// went, so there is one source and one set of tests rather than two.
//
// STATED PLAINLY BECAUSE IT CANNOT BE FIXED: this accumulates from the day it
// is switched on and cannot recover the past. The panel says so, driven by
// the earliest row in the table rather than by a constant.
import { recordDailyVisits, rollMonths, pruneAnalytics } from './analytics-store';
import { totalVisitsFor } from './analytics';
import type { D1Database } from '@cloudflare/workers-types';

const DAY_MS = 86_400_000;

export interface RollupEnv {
  DB: D1Database;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CF_WEB_ANALYTICS_SITE_TAG: string;
}

export async function runDailyRollup(env: RollupEnv, nowMs: number): Promise<void> {
  const until = Math.floor(nowMs / DAY_MS) * DAY_MS; // midnight UTC today
  const since = until - DAY_MS;                       // midnight UTC yesterday
  const day = new Date(since).toISOString().slice(0, 10);

  const visits = await totalVisitsFor(env, new Date(since).toISOString(), new Date(until).toISOString());
  // `null` means the call failed. A failed snapshot must leave the day's row
  // ABSENT rather than write a zero: a zero is a CLAIM that nobody visited,
  // and the chart would draw it as a real trough that never recovers. A gap
  // is honest and tomorrow's run is unaffected.
  if (visits === null) return;

  const now = Math.floor(nowMs / 1000);
  await recordDailyVisits(env.DB, day, visits, now);

  // Ninety-three days, so the last three months are re-rolled every night
  // rather than only the month that just ended. A late-arriving day is picked
  // up, and ONE missed night cannot lose a whole month permanently -- which a
  // job that fires only on the 1st can and does.
  await rollMonths(env.DB, new Date(until - 93 * DAY_MS).toISOString().slice(0, 10), now);

  // 400 days of daily rows, then the month's own row carries it. 400 rather
  // than 365 so a by-year view of the current year always has a full
  // preceding year of days behind it. That is this table's stated ceiling.
  await pruneAnalytics(env.DB, new Date(until - 400 * DAY_MS).toISOString().slice(0, 10), now);
}
```

- [ ] **Step 3: The `scheduled` export in `worker/index.ts`**

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return withSecurityHeaders(await route(request, env), request);
  },

  // The other half of wrangler.toml's [triggers] block, and neither half is
  // useful alone: a cron with no handler here is a failed invocation a day
  // against a script that cannot answer, and a handler with no cron is a
  // function nothing calls. src/test/wrangler-config.test.ts pins both.
  //
  // waitUntil, not a bare await: a scheduled invocation's lifetime is the
  // promise it registers, and an unregistered promise is cancelled the moment
  // this function returns.
  //
  // The whole thing is swallowed and never rethrown. A scheduled invocation
  // that throws is retried by Cloudflare and there is nothing here worth
  // retrying -- a missed night is one gap in a chart, and the next night's
  // run is unaffected. There is also nothing to report it to: the site needs
  // to work, not to be watched.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDailyRollup(env, event.scheduledTime).catch(() => undefined));
  },
};
```

- [ ] **Step 4: `wrangler.toml` — read the existing comment before touching it**

That comment is load-bearing and its warning runs in the **opposite** direction from what this task does: an absent `[triggers]` section does not clear a schedule, an explicit `[]` does. Putting a real cadence back is safe; deleting the section later is not. Keep that paragraph verbatim and replace the rest:

```toml
[triggers]
# 03:17 UTC, which is 08:47 in Kolkata -- after midnight UTC has closed
# yesterday's window, and at a minute nobody else's cron is on.
#
# ONE cadence, once a day. Each invocation costs one GraphQL call and four D1
# statements; 365 a year against Workers' 100,000 requests a day is not a
# number worth thinking about. The monthly roll rides on the same invocation
# rather than a second trigger, precisely so a missed month is impossible: it
# re-rolls the last three months every night.
#
# THE 500-BUILD CAP DOES NOT APPLY HERE, and the previous comment's warning
# about it is worth reading precisely rather than inheriting: the hourly hook
# it describes was a standing charge against Pages Free's build cap because
# that hook triggered a BUILD. This invokes this Worker's `scheduled` export.
# One invocation a day, no build, no deploy.
#
# THE STANDING HAZARD, UNCHANGED: removing this section does NOT clear the
# schedule. Cloudflare stores schedules on the script, and wrangler's clearing
# PUT is guarded by `if (crons)` -- an absent section normalises to
# `undefined`, which is falsy, so nothing is sent and whatever is registered
# stays registered. An explicit `crons = []` is the only thing that clears
# one. This is how an hourly trigger survived on the live Worker after its
# config lines were deleted, at 24 failed invocations a day.
crons = ["17 3 * * *"]
```

- [ ] **Step 5: `src/test/wrangler-config.test.ts` — pin BOTH halves**

The two existing tests pin an empty list; both are rewritten, and **one is added for the half that has never been pinned at all**.

```ts
describe('wrangler.toml cron triggers', () => {
  it('declares exactly one cadence, under [triggers] and nowhere else', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const afterHeader = toml.split(/^\[triggers\]\s*$/m)[1];
    expect(afterHeader, 'wrangler.toml has no [triggers] table').toBeDefined();
    const body = afterHeader.split(/^\[/m)[0];
    const match = body.match(/^\s*crons\s*=\s*\[([^\]]*)\]/m);
    expect(match, 'no `crons` under [triggers]').not.toBeNull();
    const crons = match![1].split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
    expect(crons).toEqual(['17 3 * * *']);
  });

  it('still declares the [triggers] section at all', () => {
    // The original reason this test existed and it has NOT gone away: an
    // absent section normalises to `crons: undefined`, wrangler issues no
    // schedule PUT, and Cloudflare keeps whatever the deployed script already
    // had -- forever, invisibly.
    expect(readFileSync('wrangler.toml', 'utf8')).toMatch(/^\[triggers\]$/m);
  });

  // The half that has never been pinned, and the half whose absence is
  // silent: a schedule with no handler is 365 failed invocations a year and
  // nothing in this repository would have said so.
  it('has a scheduled handler for that cadence to call', () => {
    expect(readFileSync('worker/index.ts', 'utf8')).toMatch(/async scheduled\s*\(/);
  });
});
```

- [ ] **Step 6: The payload's `series` fields — the same in both branches**

In `handleAnalytics`, replace the launch values from Task 4:

```ts
  // The trend chart ALWAYS reads from our own snapshots, never from Cloudflare
  // directly, whichever way the schema verification went (see
  // worker/analytics-schema.ts). That is what collapses the date-dimension
  // branch from two implementations to one optional backfill step, so no
  // later task can rewrite an earlier one either way.
  const series = await dailySince(env.DB, sinceDay).catch(() => []);
  const seriesStartsOn = await firstDailyDay(env.DB).catch(() => null);
  const yearAvailable = (await monthlyCount(env.DB).catch(() => 0)) > 0;
```

```ts
    series,
    seriesGrain: 'day',
    // 'backfilled' only when Task 1 found a date dimension AND Step 7 ran.
    // Set from RUM_CAPABILITIES so the chart's caption cannot claim a reach
    // backwards that never happened.
    seriesSource: RUM_CAPABILITIES.dateDimension === null ? 'snapshot' : 'backfilled',
    seriesStartsOn,
    yearAvailable,
```

- [ ] **Step 7 (CONDITIONAL — only if `RUM_CAPABILITIES.dateDimension !== null`): the one-off backfill**

**This is the only step in this plan the schema verification changes.**

```ts
// Runs once, when daily_visits is empty, and never again: the table having
// any row at all is the flag, so there is no state to keep and a redeploy
// cannot re-trigger it.
//
// Ninety days, because that is the longest range the panel offers. Reaching
// further would fill a chart nothing draws.
//
// The dimension NAME comes from worker/analytics-schema.ts, which read it off
// an introspection reply. It is not spelled here, because a name somebody
// remembered is exactly what Task 1 exists to replace.
async function backfillIfEmpty(env: RollupEnv, until: number): Promise<void> {
  if (RUM_CAPABILITIES.dateDimension === null) return;
  const existing = await dailySince(env.DB, '0000-01-01');
  if (existing.length > 0) return;
  const rows = await visitsByDay(env, until - 90 * DAY_MS, until);
  const now = Math.floor(Date.now() / 1000);
  for (const row of rows) await recordDailyVisits(env.DB, row.day, row.visits, now);
  await rollMonths(env.DB, new Date(until - 93 * DAY_MS).toISOString().slice(0, 10), now);
}
```

`visitsByDay` sends the same document shape as `totalVisitsFor` with `dimensions { ${RUM_CAPABILITIES.dateDimension} requestPath }` and groups in the Worker so `isExcludedPath` runs over the rows first. Call `backfillIfEmpty` at the top of `runDailyRollup`, before the day's own snapshot.

**If `RUM_CAPABILITIES.dateDimension === null`:** skip this step entirely. Record the skip in `docs/analytics-schema-verification.md` under `## What this plan does with it`, and add one sentence to `worker/rollup.ts`'s header saying the chart cannot reach backwards and why. **No other file changes**, and `seriesSource` is `'snapshot'` from Step 6 without a further edit.

- [ ] **Step 8: `worker/__tests__/rollup.test.ts`**

```ts
describe('the nightly rollup', () => {
  it('records yesterday, not today, in UTC', async () => {
    const { fake, env } = rollupEnv();
    stubGraphql(dayWithVisits(140));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect([...fake.dailyVisits.keys()]).toEqual(['2026-08-19']);
    expect(fake.dailyVisits.get('2026-08-19')?.visits).toBe(140);
  });

  it('running twice leaves one row, not two', async () => {
    const { fake, env } = rollupEnv();
    stubGraphql(dayWithVisits(140));
    const at = Date.UTC(2026, 7, 20, 3, 17);
    await runDailyRollup(env, at);
    await runDailyRollup(env, at);
    expect(fake.dailyVisits.size).toBe(1);
  });

  it('writes NOTHING when Cloudflare refuses, rather than writing a zero', async () => {
    // A zero row is worse than a gap: the chart draws a real trough on a day
    // the site was fine and the API was not, and it never recovers.
    const { fake, env } = rollupEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect(fake.dailyVisits.size).toBe(0);
  });

  it('excludes her own editing visits from the day it records', async () => {
    const { fake, env } = rollupEnv();
    stubGraphql(dayWithRows([
      { path: '/', visits: 100 },
      { path: '/edit/manage/menu', visits: 40 },
    ]));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect(fake.dailyVisits.get('2026-08-19')?.visits).toBe(100);
  });

  it('rolls the last three months, not only the one that just ended', async () => {
    const { fake, env } = rollupEnv();
    fake.dailyVisits.set('2026-06-15', { visits: 3, recorded_at: 0 });
    fake.dailyVisits.set('2026-07-15', { visits: 4, recorded_at: 0 });
    stubGraphql(dayWithVisits(5));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect([...fake.monthlyVisits.keys()].sort()).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('prunes days past the stated ceiling and nothing nearer', async () => {
    const { fake, env } = rollupEnv();
    fake.dailyVisits.set('2024-01-01', { visits: 1, recorded_at: 0 });
    fake.dailyVisits.set('2026-06-15', { visits: 1, recorded_at: 0 });
    stubGraphql(dayWithVisits(1));
    await runDailyRollup(env, Date.UTC(2026, 7, 20, 3, 17));
    expect(fake.dailyVisits.has('2024-01-01')).toBe(false);
    expect(fake.dailyVisits.has('2026-06-15')).toBe(true);
  });
});
```

with `vi.unstubAllGlobals()` in `afterEach` and `dayWithVisits` / `dayWithRows` shaped like the real GraphQL envelope: `{ data: { viewer: { accounts: [{ last28: [{ sum: { visits }, dimensions: { requestPath } }] }] } } }`.

- [ ] **Step 9: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/rollup.test.ts src/test/wrangler-config.test.ts worker/__tests__/analytics.test.ts`**

- [ ] **Step 10: Deploy the Worker, then confirm the schedule actually landed**

```
npx wrangler deploy
npx wrangler deployments list
```

and check the Worker's schedules in the Cloudflare dashboard. **This is the step the previous cron incident was missed by:** the config and the live registration are two different things, and the tests above can only see the config.

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| write `visits: 0` when the upstream returns null | "writes NOTHING when Cloudflare refuses, rather than writing a zero" | — |
| use today rather than yesterday in the day computation | "records yesterday, not today, in UTC" | — |
| `INSERT` in place of the `ON CONFLICT` upsert | "running twice leaves one row, not two" | — |
| drop the `isExcludedPath` guard from `totalVisitsFor` | "excludes her own editing visits from the day it records" | — |
| roll only the month that just ended | "rolls the last three months, not only the one that just ended" | — |
| prune at 30 days instead of 400 | "prunes days past the stated ceiling and nothing nearer" | — |
| set `crons = []` | "declares exactly one cadence, under [triggers] and nowhere else" | — |
| delete the whole `[triggers]` section | "still declares the [triggers] section at all" | — |
| remove the `scheduled` export from `worker/index.ts` | "has a scheduled handler for that cadence to call" | This is the half that has never been pinned. If the regex does not match after a refactor (an arrow property, say), widen it — do not delete it. |
| deploy the config without running `npx wrangler deploy` | **nothing reddens** | The config and the live registration are different things and no test can see the second. Step 10 is a human running two commands and reading the answer. |

**CSS ceiling:** zero bytes. `worker/**`, `wrangler.toml` and `src/test/**` are all outside the content glob.

**If this task is wrong:** the archive silently never fills, the by-year view is empty forever with nothing saying why, or the chart draws a permanent trough on a day nothing was wrong with the site.

---

## Task 14: The by-year range, from the archive alone

Completes the archive: `?range=year` is served entirely from `monthly_visits` and never touches Cloudflare, which holds about six months. Retires the risk that a year-long range quietly returns six months of data under a twelve-month label.

**Files:**
- Modify: `worker/analytics.ts`
- Modify: `worker/__tests__/analytics.test.ts`

**Interfaces:** no new exports. `AnalyticsSeriesPoint`, `seriesGrain` and `yearAvailable` were all cut at Task 4.

- [ ] **Step 1: The year range short-circuits the whole upstream path**

Immediately after the cache miss in `handleAnalytics`, before the `fetch`:

```ts
  // A year is OURS, entirely. Cloudflare holds about six months, so asking it
  // for twelve would return six and label them twelve -- the exact class of
  // quietly-wrong number this panel exists not to produce. This branch makes
  // no upstream call at all, which also means it cannot answer 502 when
  // Cloudflare is having a bad afternoon.
  if (range === 'year') {
    const body = JSON.stringify(await yearPayload(env));
    await putInCache(cache, cacheKey, body);
    return jsonString(200, body);
  }
```

```ts
// Everything a year can honestly answer, and nothing it cannot.
//
// byPath and byReferer are EMPTY rather than stale: the rollup holds monthly
// totals, not a breakdown, and inventing one from the last 30 days under a
// twelve-month heading would be a false number. The panel does NOT render its
// usual "nothing to rank yet" copy for this -- Task 22 gives those two cards
// a sentence that says the breakdown is not kept, because the difference
// between "nothing was kept" and "nobody visited" is the distinction this
// whole screen exists to make.
async function yearPayload(env: AnalyticsEnv): Promise<AnalyticsPayload> {
  const today = todayInKolkata();
  const sinceMonth = `${String(Number(today.slice(0, 4)) - 1)}${today.slice(4, 7)}`;
  const series = await monthlySeries(env.DB, sinceMonth).catch(() => []);
  const visits = series.reduce((total, point) => total + point.visits, 0);

  let waCounts: Record<string, number> = {};
  try {
    waCounts = await readWaCounts(env.KV);
  } catch {
    waCounts = {};
  }

  return {
    windowDays: RANGE_DAYS.year,
    visits,
    visitsAreEstimate: true,
    byPath: [],
    byReferer: [],
    thisWeekVisits: 0,
    priorWeekVisits: 0,
    bookingTaps: { total: sumWaCounts(waCounts, recentIstDates(today, RANGE_DAYS.year)), days: RANGE_DAYS.year, lowerBound: true },
    range: 'year',
    series: series.map((point) => ({ date: point.day, visits: point.visits, complete: point.complete })),
    seriesGrain: 'month',
    seriesSource: RUM_CAPABILITIES.dateDimension === null ? 'snapshot' : 'backfilled',
    seriesStartsOn: series[0]?.day ?? null,
    hourly: null,
    campaigns: await readCampaignRows(env.DB, istDateDaysAgo(today, RANGE_DAYS.year - 1)),
    campaignsAreExact: true,
    // No comparison at year grain: the period before the last twelve months is
    // twelve months this archive does not have and cannot invent.
    visitsPrevious: 0,
    tapsPrevious: 0,
    yearAvailable: series.length > 0,
  };
}
```

`putInCache(cache, key, body)` is the existing `try { await cache.put(...) } catch {}` block lifted into a function so both return paths use one copy — `noUnusedLocals` catches it if either stops calling it.

- [ ] **Step 2: The tests**

```ts
describe('the year range', () => {
  it('makes no upstream call at all', async () => {
    const spy = vi.fn(async () => rumResponse(1));
    vi.stubGlobal('fetch', spy);
    await handleAnalytics(analyticsRequest('?range=year'), buildEnv());
    expect(spy).not.toHaveBeenCalled();
  });

  it('draws from the monthly rollup, in order', async () => {
    const db = new FakeD1();
    db.monthlyVisits.set('2026-07', { visits: 200, complete: 1, recorded_at: 0 });
    db.monthlyVisits.set('2026-06', { visits: 100, complete: 1, recorded_at: 0 });
    const body = await (await handleAnalytics(analyticsRequest('?range=year'), buildEnv({ db }))).json();
    expect(body.visits).toBe(300);
    expect(body.series).toEqual([
      { date: '2026-06', visits: 100, complete: true },
      { date: '2026-07', visits: 200, complete: true },
    ]);
    expect(body.seriesGrain).toBe('month');
    expect(body.seriesStartsOn).toBe('2026-06');
  });

  it('carries the partial-month flag through to the panel', async () => {
    const db = new FakeD1();
    db.monthlyVisits.set('2026-08', { visits: 40, complete: 0, recorded_at: 0 });
    const body = await (await handleAnalytics(analyticsRequest('?range=year'), buildEnv({ db }))).json();
    expect(body.series[0].complete).toBe(false);
  });

  it('leaves the two breakdown cards empty rather than filling them from a different window', async () => {
    const body = await (await handleAnalytics(analyticsRequest('?range=year'), buildEnv())).json();
    expect(body.byPath).toEqual([]);
    expect(body.byReferer).toEqual([]);
  });

  it('answers 200 even when the rollup is completely empty', async () => {
    // The state this ships in. The archive accumulates from the day it was
    // switched on and cannot recover the past. Empty is not an error.
    const response = await handleAnalytics(analyticsRequest('?range=year'), buildEnv());
    expect(response.status).toBe(200);
    expect((await response.json()).series).toEqual([]);
  });

  it('says the by-year view has nothing behind it until it does', async () => {
    const empty = await (await handleAnalytics(analyticsRequest(''), buildEnv())).json();
    expect(empty.yearAvailable).toBe(false);
    const db = new FakeD1();
    db.monthlyVisits.set('2026-07', { visits: 1, complete: 1, recorded_at: 0 });
    const filled = await (await handleAnalytics(analyticsRequest(''), buildEnv({ db }))).json();
    expect(filled.yearAvailable).toBe(true);
  });

  it('reaches back twelve months and not thirteen', async () => {
    const db = new FakeD1();
    db.monthlyVisits.set('2025-06', { visits: 999, complete: 1, recorded_at: 0 });
    db.monthlyVisits.set('2026-06', { visits: 1, complete: 1, recorded_at: 0 });
    const body = await (await handleAnalytics(analyticsRequest('?range=year'), buildEnv({ db }))).json();
    expect(body.series.map((point: { date: string }) => point.date)).toEqual(['2026-06']);
  });
});
```

- [ ] **Step 3: Recompute the budget comment one more time**

```ts
//   ?range=year, cache MISS: 2 subrequests (cache.match, cache.put)
//                            + 2 D1 queries + 1 KV get
// No GraphQL call on this path at all, which is why it is also the one range
// that cannot answer 502 upstream-error.
```

- [ ] **Step 4: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/analytics.test.ts`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| let `?range=year` fall through to the GraphQL path | "makes no upstream call at all" | — |
| fill `byPath` from a 30-day query in `yearPayload` | "leaves the two breakdown cards empty rather than filling them from a different window" | — |
| return `fail('upstream-error', …)` when the rollup is empty | "answers 200 even when the rollup is completely empty" | — |
| compute `sinceMonth` as `today.slice(0, 7)` | "reaches back twelve months and not thirteen" | The 13-month fixture is what makes this row falsifiable; it is in Step 2 for that reason. |
| drop `ORDER BY month ASC` from `monthlySeries` | "draws from the monthly rollup, in order" | The fake iterates a `Map` in insertion order, and the fixture inserts July before June for exactly that reason. |
| hardcode `complete: true` on the way out | "carries the partial-month flag through to the panel" | — |
| hardcode `yearAvailable: true` | "says the by-year view has nothing behind it until it does" | — |

**CSS ceiling:** zero bytes.

**If this task is wrong:** she picks "by year", reads six months of visits labelled as twelve, and concludes the restaurant halved.

---

## Task 15: Busiest times — build it, or cut it

**Conditional on Task 1.** Read `worker/analytics-schema.ts` before starting. A non-null `hourDimension` means build; `null` means cut, and cutting costs nothing else because no other card depends on it — which is exactly why the spec lists it last.

**Files (BUILD):** `worker/analytics.ts`, `worker/__tests__/analytics.test.ts`
**Files (CUT):** `worker/analytics.ts` (one comment), `worker/__tests__/analytics.test.ts` (one test), `docs/analytics-schema-verification.md` (record the cut)

**Interfaces:** in both branches, `payload.hourly` of type `AnalyticsHourCell[] | null`, already declared at Task 4. **No type changes in either branch.**

### BUILD branch

- [ ] **Step B1: A new aliased node, spelled from the recorded dimension name**

```graphql
    hourly: rumPageloadEventsAdaptiveGroups(
      filter: { siteTag: $siteTag, datetime_geq: $sinceWindow, datetime_lt: $until }
      limit: 1000
      orderBy: [datetimeHour_ASC]
    ) {
      sum { visits }
      dimensions { datetimeHour requestPath }
    }
```

`requestPath` again, for the reason the backfill node carries it: a chart that counted her own editing sessions would put a bright block on Tuesday afternoons that means nothing about diners. The field name is whatever `RUM_CAPABILITIES.hourDimension` records — if it is not `datetimeHour`, substitute it here and in `orderBy`.

- [ ] **Step B2: The bucketing, in IST**

```ts
// day 0-6 with 0 = Sunday, hour 0-23, IN IST. A restaurant deciding when to
// staff thinks in its own evenings; a chart in UTC would put Friday dinner in
// two different cells and split the one pattern the card exists to show.
//
// datetimeHour comes back as an ISO timestamp truncated to the hour. Shifted
// by a fixed +5:30 rather than through Intl, because Intl.DateTimeFormat in a
// Worker is a per-call cost inside a loop over up to 1000 rows, and IST has
// no daylight saving to get wrong.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function hourCells(rows: RumRow[]): AnalyticsHourCell[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (isExcludedPath(pathOf(row))) continue;
    const raw = typeof row.dimensions?.datetimeHour === 'string' ? row.dimensions.datetimeHour : '';
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) continue;
    const ist = new Date(at + IST_OFFSET_MS);
    // getUTCDay/getUTCHours on a Date ALREADY shifted by the offset -- not
    // getDay/getHours, which would apply the host's own timezone a second
    // time and give a different answer on every machine.
    const key = `${String(ist.getUTCDay())}:${String(ist.getUTCHours())}`;
    totals.set(key, (totals.get(key) ?? 0) + visitsOf(row));
  }
  return [...totals.entries()]
    .map(([key, visits]) => {
      const [day, hour] = key.split(':').map(Number);
      return { day, hour, visits };
    })
    .sort((a, b) => a.day - b.day || a.hour - b.hour);
}
```

- [ ] **Step B3: On the payload** — `hourly: hourCells(rowsOf(account.hourly)),`

- [ ] **Step B4: The tests**

```ts
describe('hourCells', () => {
  function row(datetimeHour: string, visits: number, requestPath = '/') {
    return { sum: { visits }, dimensions: { datetimeHour, requestPath } };
  }

  it('buckets a UTC hour into the IST day and hour it actually was', () => {
    // 19:00 UTC Friday is 00:30 IST Saturday, so the half-hour offset moves
    // BOTH the day and the hour. This is the case a naive +5 gets wrong and
    // nothing on screen would explain.
    expect(hourCells([row('2026-08-21T19:00:00Z', 5)])).toEqual([{ day: 6, hour: 0, visits: 5 }]);
  });

  it('adds rows that land in the same cell', () => {
    expect(hourCells([row('2026-08-21T12:00:00Z', 2), row('2026-08-21T12:00:00Z', 3)])).toEqual([
      { day: 5, hour: 17, visits: 5 },
    ]);
  });

  it('leaves out her own editing visits', () => {
    expect(hourCells([row('2026-08-21T12:00:00Z', 9, '/edit/manage/menu')])).toEqual([]);
  });

  it('ignores a row whose timestamp is unparseable rather than charting it at zero', () => {
    expect(hourCells([row('not-a-time', 9)])).toEqual([]);
  });

  it('comes back ordered by day then hour', () => {
    const cells = hourCells([row('2026-08-22T12:00:00Z', 1), row('2026-08-21T06:00:00Z', 1)]);
    expect(cells.map((cell) => `${String(cell.day)}:${String(cell.hour)}`)).toEqual(['5:11', '6:17']);
  });
});
```

### CUT branch

- [ ] **Step C1: Pin `hourly` at null, and say why in the file**

```ts
    // NULL, permanently, and this is a recorded decision rather than an
    // unfinished feature. Cloudflare's RUM dataset has no hour dimension
    // (docs/analytics-schema-verification.md, hourDimension: null, with the
    // full introspected dimension list beside it), a daily snapshot cannot
    // reconstruct an hour, and no other card depends on this one -- so the
    // busiest-times chart is cut rather than approximated. The field stays on
    // the payload because null MEANS "this site cannot answer that question",
    // which is different from an empty answer.
    hourly: null,
```

- [ ] **Step C2: The test that makes the cut a decision**

```ts
it('answers null for the busiest-times card, because Cloudflare has no hour dimension', () => {
  // Not an empty array. A future reader who adds an hour query has to change
  // this test on purpose, and will find the verification document from it.
  expect(RUM_CAPABILITIES.hourDimension).toBeNull();
  expect(body.hourly).toBeNull();
});
```

- [ ] **Step C3: Record the cut** in `docs/analytics-schema-verification.md` under "What this plan does with it", naming the dimensions Cloudflare **did** offer.

- [ ] **Step C4: Task 21 is marked CUT and touches no file.**

**Mutation table (BUILD)**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| add `5 * 60 * 60 * 1000` instead of `5.5` | "buckets a UTC hour into the IST day and hour it actually was" | — |
| use `getDay()`/`getHours()` | "buckets a UTC hour…" | It passes on a UTC machine. Run it with `TZ=Asia/Kolkata` **and** `TZ=UTC` and confirm it fails in at least one; that is the point of the row. |
| drop the `isExcludedPath` guard | "leaves out her own editing visits" | — |
| treat an unparseable timestamp as hour 0 | "ignores a row whose timestamp is unparseable…" | — |
| drop the sort | "comes back ordered by day then hour" | — |

**Mutation table (CUT)**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| set `hourly: []` | "answers null for the busiest-times card…" | — |
| edit `hourDimension` to a name in the schema constant only | Task 1's "says the same thing in the document and in the constant" | — |

**CSS ceiling:** zero bytes in both branches. `worker/**` only; the drawing is Task 21 and states its own.

**If this task is wrong (BUILD):** she staffs Friday dinner from a chart that put Friday dinner on Saturday. **If this task is wrong (CUT):** an empty chart sits on the screen reading as "nobody came" when the truth is "we cannot know".

---
# Tier 2 — The drawing, which can be ugly but cannot be wrong

Everything above this line can put a false number on the screen. Nothing below it can: the numbers are settled, the shapes are frozen, and these tasks decide only how they look. That is why they are last, and it is also why every one of them carries a CSS-ceiling line — the drawing's whole risk is byte budget and contrast, not truth.

**The CSS raise procedure, stated once and referenced by each task below.** When a task's own build breaches 39200:

1. `npm run build`, then `ls -l dist/assets/index-*.css` for the measured size.
2. Check out the **true parent commit into a worktree** (never a stash — this project has had wrong results from stash baselines twice), build there, and diff the two stylesheets **rule by rule**. A summary byte delta is not an accounting.
3. Trace every added rule to the specific className and file that emitted it. Untraced rules are the comment-scan hazard: Tailwind's scanner is a plain text extractor, and a bare English word in a comment that happens to be a real utility name mints a real rule. Fix those by rewording and re-diffing, **never** by accommodating them in the ceiling.
4. New ceiling = **measured size rounded up to the next 100, plus 100.** Not the measured size — zero headroom caused a real breach that stayed red for eleven tasks.
5. Update the numeric literal in `expect(size).toBeLessThan(N)` **and** the number inside the `it('the entry CSS file stays under N bytes')` name string, in one edit. They have silently drifted apart once already.
6. Add a dated ledger entry to `src/test/bundle.post-build.test.ts`'s changelog comment naming the rules added and the file each came from.

**The escape hatch, preferred over a raise wherever it applies:** an inline `style={{ … }}` for a one-off value used nowhere else. CSP's `style-src` allows it deliberately and `src/test/hosting.test.ts` counts the components doing it. Every SVG below draws with geometry **attributes** (`x`, `y`, `width`, `d`, `fill`), which cost the stylesheet nothing at all.

---

## Task 16: Chart geometry, as pure functions

Retires the only part of the drawing that can be wrong rather than ugly: a bar whose width is not its share, a path that leaves the viewport, a division by zero in a scale. Pure, unit-testable, no DOM.

**Files:**
- Create: `src/admin/manage/chart-geometry.ts`
- Create: `src/admin/manage/__tests__/chart-geometry.test.ts`

**Interfaces:**
```ts
export interface Extent { width: number; height: number }
export interface AreaPaths { line: string; area: string; peak: number }
export function areaPaths(values: number[], extent: Extent): AreaPaths | null;
export function barPercents(values: number[]): number[];
export function cellOpacity(visits: number, peak: number): number;
```

- [ ] **Step 1: `src/admin/manage/chart-geometry.ts`**

```ts
// The arithmetic behind every drawing on the Numbers panel, with no React and
// no DOM in it.
//
// Separate from the components on purpose: a chart is the one thing on this
// screen whose defect is silent. A bar drawn at the wrong width still looks
// like a bar, and the reader has no way to check it against anything. So the
// numbers that decide where a shape lands are pure functions with a table
// test, and the components are left with nothing but attributes.
//
// jsdom cannot verify any RENDERED result of this -- it has no layout engine
// -- so what is proven here is the path strings and the percentages, and
// e2e/numbers-visuals.spec.ts measures what a real browser did with them.
export interface Extent {
  width: number;
  height: number;
}

export interface AreaPaths {
  // The stroked line across the top of the series.
  line: string;
  // The same line closed down to the baseline and back, for the fill.
  area: string;
  // The largest value in the series, which the caller names in the chart's
  // accessible label.
  peak: number;
}

// Rounded to one decimal place everywhere. Full float precision produces path
// strings hundreds of characters longer for a difference no screen can
// resolve, and it makes an expected string in a test unreadable.
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function areaPaths(values: number[], extent: Extent): AreaPaths | null {
  // Fewer than two points is not a line. Returning null rather than a
  // degenerate path lets the card say "not enough yet" instead of drawing a
  // dot the reader has to interpret.
  if (values.length < 2) return null;
  // A zero-sized box is refused rather than divided by. `extent.width / 0`
  // and `height / 0` both produce Infinity, which lands in the path attribute
  // as literal text.
  if (extent.width <= 0 || extent.height <= 0) return null;

  const peak = Math.max(...values);
  // A flat run of zeros is a real state -- the panel SHIPS in it. Dividing by
  // that peak is a division by zero and renders the string "NaN", visibly, in
  // the markup.
  const scale = peak === 0 ? 0 : extent.height / peak;
  const step = extent.width / (values.length - 1);

  const points = values.map((value, index) => ({
    x: round(index * step),
    // SVG's y grows DOWNWARD, so the baseline is `height` and a big value is
    // a small y. Getting this backwards draws the chart upside down and it
    // still looks like a chart -- which is why it has its own test.
    y: round(extent.height - Math.max(0, value) * scale),
  }));

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${String(point.x)} ${String(point.y)}`).join(' ');
  const area = `${line} L${String(round(extent.width))} ${String(round(extent.height))} L0 ${String(round(extent.height))} Z`;
  return { line, area, peak };
}

// Each bar's width is its share of the LARGEST value, not of the total.
// Share-of-total makes the top bar short whenever there are many rows, which
// on a ten-row page list is always -- and it reads as "the top page is
// unpopular", the opposite of what the card says. Share-of-largest makes the
// top bar full width, always, which is what every bar list a reader has ever
// seen does.
//
// Percentages rather than pixels, because the track's width is a layout fact
// the browser owns and this module has no business guessing at.
//
// Math.max(2, ...) so a row with one visit still draws something: a
// zero-width bar beside a printed "1" reads as a rendering failure. And
// Math.max(0, value) before that, so a negative never becomes a negative
// width -- an attribute the browser silently ignores, leaving one row with no
// bar at all and nothing saying why.
export function barPercents(values: number[]): number[] {
  const peak = Math.max(0, ...values);
  // Every value zero is a real state and must not divide. Two per cent, not
  // zero: the rows exist and the card is not broken.
  if (peak === 0) return values.map(() => 2);
  return values.map((value) => Math.max(2, Math.round((Math.max(0, value) / peak) * 100)));
}

// The busiest-times chart paints density with opacity rather than with a
// colour ramp, for one reason worth stating: a ramp needs a legend, and a
// legend is another row of text on a card that is already 168 cells on a
// phone.
//
// Floored at 0.08 so a cell with ONE visit is visibly not empty. The
// difference between "quiet" and "closed" is the whole point of the card, and
// without the floor an hour with one visit renders identically to an hour the
// restaurant was shut.
export function cellOpacity(visits: number, peak: number): number {
  if (visits <= 0 || peak <= 0) return 0;
  return round(0.08 + (visits / peak) * 0.92);
}
```

- [ ] **Step 2: The table test**

**Every expected path string below was derived by hand, once, and checked.** A string copied out of a failing run is an assertion that can never fail — it is the shape of six of this project's unfalsifiable assertions. Derive `M0 100 L100 50 L200 0` from `values=[0,50,100]`, `width=200`, `height=100`: three points at x = 0, 100, 200 and y = 100 − value, which is 100, 50, 0.

```ts
// src/admin/manage/__tests__/chart-geometry.test.ts
import { describe, expect, it } from 'vitest';
import { areaPaths, barPercents, cellOpacity } from '../chart-geometry';

describe('areaPaths', () => {
  it('spans the full width and puts the peak at the top', () => {
    // Hand-derived and checked: x steps 0, 100, 200 across a 200-wide box;
    // y is height - value, so 100, 50, 0. A big value is a SMALL y.
    const paths = areaPaths([0, 50, 100], { width: 200, height: 100 });
    expect(paths?.line).toBe('M0 100 L100 50 L200 0');
    expect(paths?.peak).toBe(100);
  });

  it('closes the fill down to the baseline and back', () => {
    expect(areaPaths([0, 100], { width: 100, height: 50 })?.area).toBe('M0 50 L100 0 L100 50 L0 50 Z');
  });

  it('draws a flat line at the baseline for an all-zero series, not NaN', () => {
    // The state this panel SHIPS in. A NaN in a path attribute renders as
    // literal text in the markup and draws nothing at all.
    const paths = areaPaths([0, 0, 0], { width: 90, height: 30 });
    expect(paths?.line).toBe('M0 30 L45 30 L90 30');
    expect(paths?.line).not.toContain('NaN');
  });

  it('refuses a series too short to be a line', () => {
    expect(areaPaths([], { width: 100, height: 50 })).toBeNull();
    expect(areaPaths([7], { width: 100, height: 50 })).toBeNull();
  });

  it('refuses a zero-sized box rather than dividing by it', () => {
    expect(areaPaths([1, 2], { width: 0, height: 50 })).toBeNull();
    expect(areaPaths([1, 2], { width: 100, height: 0 })).toBeNull();
  });

  it('never puts a negative value above the top of the box', () => {
    expect(areaPaths([-10, 10], { width: 100, height: 50 })?.line).toBe('M0 50 L100 0');
  });
});

describe('barPercents', () => {
  it('gives the largest value the whole track', () => {
    expect(barPercents([10, 5, 1])).toEqual([100, 50, 10]);
  });

  it('is share of the LARGEST, not share of the total', () => {
    // Share-of-total would make these 50 and 50, and the card would read as
    // though nothing were popular.
    expect(barPercents([4, 4])).toEqual([100, 100]);
  });

  it('draws a visible sliver for a single visit rather than nothing', () => {
    expect(barPercents([900, 1])).toEqual([100, 2]);
  });

  it('does not emit NaN when everything is zero', () => {
    expect(barPercents([0, 0])).toEqual([2, 2]);
  });

  it('never returns a negative width', () => {
    expect(barPercents([-5, 10])).toEqual([2, 100]);
  });
});

describe('cellOpacity', () => {
  it('leaves an empty hour completely empty', () => {
    expect(cellOpacity(0, 50)).toBe(0);
  });

  it('makes one visit visible rather than invisible', () => {
    // "Quiet" and "closed" must not look the same. This is the floor.
    expect(cellOpacity(1, 1000)).toBeGreaterThanOrEqual(0.08);
    expect(cellOpacity(1, 1000)).not.toBe(cellOpacity(0, 1000));
  });

  it('takes the busiest hour to full strength', () => {
    expect(cellOpacity(50, 50)).toBe(1);
  });

  it('returns zero rather than dividing by a zero peak', () => {
    expect(cellOpacity(5, 0)).toBe(0);
  });
});
```

- [ ] **Step 3: Re-read the comments for bare utility-class tokens.** Inside `./src/**`.

- [ ] **Step 4: `npx tsc -b --noEmit && npm test -- --run src/admin/manage/__tests__/chart-geometry.test.ts`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| `y: round(value * scale)` (drop the flip) | "spans the full width and puts the peak at the top" | — |
| remove the `peak === 0 ? 0 :` guard | "draws a flat line at the baseline for an all-zero series, not NaN" | — |
| `values.length < 1` in place of `< 2` | "refuses a series too short to be a line" | — |
| remove the `extent.width <= 0` guard | "refuses a zero-sized box rather than dividing by it" | — |
| drop `Math.max(0, value)` in `areaPaths` | "never puts a negative value above the top of the box" | — |
| divide by the sum instead of the peak in `barPercents` | "is share of the LARGEST, not share of the total" | — |
| drop `Math.max(2, …)` | "draws a visible sliver for a single visit rather than nothing" | — |
| delete the `peak === 0` early return | "does not emit NaN when everything is zero" | — |
| drop `Math.max(0, value)` in `barPercents` | "never returns a negative width" | — |
| return `visits / peak` from `cellOpacity` with no floor | "makes one visit visible rather than invisible" | — |
| drop the `peak <= 0` guard | "returns zero rather than dividing by a zero peak" | — |
| copy an expected `d` string out of a failing run | **nothing reddens, ever again** | The four literal path strings above are hand-derived and marked as checked in Step 2. Never paste one from output. |

**CSS ceiling:** zero bytes. No JSX, no className anywhere in the file.

**If this task is wrong:** every chart on the panel is drawn confidently at the wrong size, and there is nothing on the screen a reader could check it against.

---

## Task 17: The trend chart, drawn

**Files:**
- Create: `src/admin/manage/TrendChart.tsx`, `src/admin/manage/__tests__/TrendChart.test.tsx`
- Modify: `src/admin/areas/NumbersArea.tsx`, `src/admin/manage/analytics.ts`
- Modify: `src/test/bundle.post-build.test.ts` (only if the build breaches)

**Interfaces:**
```ts
export interface TrendChartProps {
  series: AnalyticsSeriesPoint[];
  grain: 'day' | 'month';
}
```

- [ ] **Step 1: The headings and the caption, in `analytics.ts`**

```ts
export const CARD_HEADINGS = {
  a: 'How many visits, and how many tapped Reserve a Table?',
  b: 'Which pages did people look at?',
  c: 'Where did people come from?',
  d: 'Busier or quieter than usual?',
  // The hero graphic, and the only heading that is a plain noun -- it is the
  // one thing on the screen a reader understands before reading a word of it.
  trend: 'Visits over time',
  campaigns: 'Which of your own links brought people?',
  hours: 'When are people looking?',
} as const;

// The chart says where its line begins rather than beginning at an
// unexplained zero, and it says whether any month in it is partial. Three
// different things are true in three different states and the sentence is
// different in each.
export function trendCaption(
  grain: 'day' | 'month',
  startsOn: string | null,
  hasPartialMonth: boolean,
): string {
  if (startsOn === null) {
    return 'This chart fills in from today onwards. It cannot reach back before now.';
  }
  const opening = `This chart begins on ${formatCountingStartedOn(startsOn)}, when the record started. It cannot reach back before that.`;
  if (grain !== 'month' || !hasPartialMonth) return opening;
  // The spec's explicit requirement: the first year of the by-year view IS a
  // partial year, and the panel says so rather than drawing a misleading
  // column. The month is DRAWN -- an omitted month is a gap she cannot see.
  return `${opening} Months marked * are not complete.`;
}

// `date` is 'YYYY-MM' at month grain and 'YYYY-MM-DD' at day grain, and
// formatCountingStartedOn would mangle the first. One function, two shapes,
// so the label is built where the shape is known -- and the ASTERISK lives
// here rather than in the component, because the rule "a partial month is
// marked" is a copy decision and belongs beside the sentence that explains
// it.
export function seriesLabel(date: string, complete: boolean): string {
  const [year, month, day] = date.split('-').map(Number);
  const named = MONTHS[(month ?? 1) - 1] ?? date;
  const label = day === undefined ? `${named} ${String(year)}` : `${String(day)} ${named}`;
  return complete ? label : `${label}*`;
}
```

- [ ] **Step 2: `src/admin/manage/TrendChart.tsx`**

```tsx
// One area chart, hand-drawn. No charting library, and the reason is a budget
// rather than a preference: Recharts or Chart.js is 50-150 KB on a dashboard
// whose stylesheet has 163 bytes of headroom, to draw one polyline.
//
// Everything positional is an ATTRIBUTE (d, viewBox, width, height), not a
// utility class, so this file adds almost nothing to the stylesheet.
//
// preserveAspectRatio="none" with a viewBox: the chart stretches to whatever
// width the card gives it and keeps its height, which is what makes it
// readable at 390px and at 1280px without measuring anything at runtime.
import React from 'react';
import { areaPaths } from './chart-geometry';
import { seriesLabel } from './analytics';
import type { AnalyticsSeriesPoint } from '../../shared/analytics-payload';

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 160;

export interface TrendChartProps {
  series: AnalyticsSeriesPoint[];
  grain: 'day' | 'month';
}

const TrendChart: React.FC<TrendChartProps> = ({ series, grain }) => {
  const paths = areaPaths(
    series.map((point) => point.visits),
    { width: VIEW_WIDTH, height: VIEW_HEIGHT },
  );

  if (paths === null) {
    const noun = grain === 'month' ? 'months' : 'days';
    return <p className="text-sm text-gray-600">Not enough {noun} yet to draw a line — this needs at least two.</p>;
  }

  return (
    <>
      <svg
        viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
        preserveAspectRatio="none"
        role="img"
        // Named rather than left to a screen reader to describe: an <svg> with
        // no accessible name is announced as "graphic" and nothing else. The
        // numbers themselves are elsewhere on the screen, so this names the
        // shape and does not try to read out thirty values.
        aria-label={`Visits over the last ${String(series.length)} ${grain === 'month' ? 'months' : 'days'}, highest ${String(paths.peak)}`}
        className="h-32 w-full"
      >
        {/* Brand blue as a SURFACE fill only -- it is 1.45:1 on white and can
            never carry meaning on its own. The stroke above it is the accent,
            which is 6.03:1 and is what the eye actually follows. */}
        <path d={paths.area} fill="#C8D8E8" />
        <path d={paths.line} fill="none" stroke="#9D4949" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* AT MONTH GRAIN ONLY, and this row is where the partial-month marker
          actually becomes visible: the caption says "Months marked * are not
          complete" and this is what carries the star. Thirty day labels under
          a 390px chart would be a smear, and the day grain has no comparable
          claim to make -- a day is a day. */}
      {grain === 'month' && (
        <ol className="mt-1 flex justify-between text-xs text-gray-500">
          {series.map((point) => (
            <li key={point.date}>{seriesLabel(point.date, point.complete)}</li>
          ))}
        </ol>
      )}
    </>
  );
};

export default TrendChart;
```

`vectorEffect="non-scaling-stroke"` is load-bearing with `preserveAspectRatio="none"`: without it the horizontal stretch thickens the line to a smear on a wide screen and hairlines it on a phone.

- [ ] **Step 3: The card, in `NumbersArea.tsx`, directly under Card A**

```tsx
const TrendCard: React.FC<{ outcome: Outcome }> = ({ outcome }) => (
  <div className={CARD} data-card="trend">
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.trend}</h3>
    {outcome.kind !== 'ok' ? (
      <Skeleton />
    ) : (
      <>
        <TrendChart series={outcome.payload.series} grain={outcome.payload.seriesGrain} />
        <p className="mt-2 text-xs text-gray-500">
          {trendCaption(
            outcome.payload.seriesGrain,
            outcome.payload.seriesStartsOn,
            outcome.payload.series.some((point) => !point.complete),
          )}
        </p>
      </>
    )}
  </div>
);
```

`data-card` attributes go on every card wrapper in this task, so `e2e/numbers-visuals.spec.ts` has a hook that is not a class name — class-name assertions are forbidden in `e2e/`.

- [ ] **Step 4: The jsdom tests — shape and copy only, never geometry**

```tsx
describe('TrendChart', () => {
  it('says so rather than drawing a dot when there is one point', () => {
    render(<TrendChart series={[{ date: '2026-08-18', visits: 4, complete: true }]} grain="day" />);
    expect(screen.getByText(/Not enough days yet/)).toBeInTheDocument();
  });

  it('names itself for a screen reader, with the peak in the name', () => {
    render(
      <TrendChart
        series={[
          { date: '2026-08-17', visits: 4, complete: true },
          { date: '2026-08-18', visits: 9, complete: true },
        ]}
        grain="day"
      />,
    );
    expect(screen.getByRole('img', { name: /Visits over the last 2 days, highest 9/ })).toBeInTheDocument();
  });

  it('never puts NaN in a path attribute', () => {
    // The all-zero series is the state this ships in, and a NaN here is
    // visible as literal text on the page.
    const { container } = render(
      <TrendChart
        series={[
          { date: '2026-08-17', visits: 0, complete: true },
          { date: '2026-08-18', visits: 0, complete: true },
        ]}
        grain="day"
      />,
    );
    for (const path of container.querySelectorAll('path')) {
      expect(path.getAttribute('d')).not.toContain('NaN');
    }
  });

  it('stars the partial month ON SCREEN, not only in the caption', () => {
    // The caption promises "Months marked * are not complete". Without this
    // row of labels there is no star anywhere and the caption refers to
    // nothing -- which is worse than saying nothing, because it implies she
    // missed a mark that was never drawn.
    render(
      <TrendChart
        series={[
          { date: '2026-07', visits: 300, complete: true },
          { date: '2026-08', visits: 40, complete: false },
        ]}
        grain="month"
      />,
    );
    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(screen.getByText('August 2026*')).toBeInTheDocument();
  });

  it('does not draw a label row at day grain', () => {
    // Thirty labels under a 390px chart is a smear, and a day has no
    // comparable claim to make about itself.
    const { container } = render(
      <TrendChart
        series={[
          { date: '2026-08-17', visits: 4, complete: true },
          { date: '2026-08-18', visits: 9, complete: true },
        ]}
        grain="day"
      />,
    );
    expect(container.querySelector('ol')).toBeNull();
  });
});

describe('trendCaption', () => {
  it('says the archive cannot reach back, and from when', () => {
    expect(trendCaption('day', '2026-08-18', false)).toBe(
      'This chart begins on 18 August 2026, when the record started. It cannot reach back before that.',
    );
  });

  it('says something honest before the archive holds anything at all', () => {
    expect(trendCaption('day', null, false)).toBe(
      'This chart fills in from today onwards. It cannot reach back before now.',
    );
  });

  it('warns that a starred month is not a whole month', () => {
    expect(trendCaption('month', '2026-06', true)).toContain('Months marked * are not complete.');
  });

  it('does not warn when every month in view is whole', () => {
    expect(trendCaption('month', '2026-06', false)).not.toContain('*');
  });
});

describe('seriesLabel', () => {
  it('stars a partial month and leaves a whole one alone', () => {
    expect(seriesLabel('2026-08', false)).toBe('August 2026*');
    expect(seriesLabel('2026-08', true)).toBe('August 2026');
  });
});
```

**No geometry assertions here.** jsdom has no layout engine; Task 23 measures the drawn result.

- [ ] **Step 5: Re-read every comment added to `src/` in this task for bare utility-class tokens.**

- [ ] **Step 6: `npm run build`, measure, and raise in this commit if breached.** New classes this task can emit: `h-32`, `w-full`. Both are extremely likely already in the stylesheet from elsewhere in the admin surface — check the rule-level diff rather than assuming either way. Expected movement is zero to about 60 bytes.

- [ ] **Step 7: `npx tsc -b --noEmit && npx eslint src/admin/manage/TrendChart.tsx && npm test -- --run src/admin/manage/__tests__/TrendChart.test.tsx src/admin/areas/__tests__/NumbersArea.test.tsx`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| render the `<svg>` unconditionally, dropping the `paths === null` branch | "says so rather than drawing a dot when there is one point" | — |
| drop `aria-label` | "names itself for a screen reader, with the peak in the name" | — |
| remove `chart-geometry`'s zero-peak guard | "never puts NaN in a path attribute" | — |
| drop the partial-month clause from `trendCaption` | "warns that a starred month is not a whole month" | — |
| star every month regardless of `complete` | "does not warn when every month in view is whole", "stars a partial month and leaves a whole one alone" | — |
| drop the month label row from the chart | "stars the partial month ON SCREEN, not only in the caption" | The caption test alone stays green, which is exactly the gap: a promise about a mark nobody drew. |
| render the label row at day grain too | "does not draw a label row at day grain" | — |
| swap `fill` and `stroke` colours | **nothing reddens in jsdom** | That is a contrast claim and it belongs to Task 23's sweep, which is why the sweep exists. Do not invent a jsdom row for it. |
| remove `preserveAspectRatio="none"` | **nothing reddens in jsdom** | Geometry. Task 23's "drawn inside its card at both widths" is the row. |

**CSS ceiling:** **this task can breach it.** New utilities: `h-32`, `w-full`, and the label row's `mt-1 flex justify-between text-xs text-gray-500` — every one of the last four already exists on this screen, and the first two are extremely likely to. Check the rule-level diff rather than assuming either way; expected movement is zero to about 60 bytes. Measure; raise in this commit if over 39200.

**If this task is wrong:** the panel's hero graphic draws a line that does not match the number beside it, or draws nothing on the day it ships and reads as broken.

---

## Task 18: The bar lists

Cards B and C keep their data, their query and their ordering exactly. Only the drawing changes — which is why this task carries no correctness risk at all and sits here.

**Files:**
- Create: `src/admin/manage/BarList.tsx`, `src/admin/manage/__tests__/BarList.test.tsx`
- Modify: `src/admin/areas/NumbersArea.tsx` (Card B and Card C bodies)

**Interfaces:**
```ts
export interface BarRow { key: string; label: string; sub?: string; value: number }
export interface BarListProps { rows: BarRow[]; ordered: boolean }
```

- [ ] **Step 1: `src/admin/manage/BarList.tsx`**

```tsx
// A ranked list where each row's bar is its share of the LEADER, not of the
// total. Same data as the two-column lists this replaces, same order, same
// numbers -- the change is entirely in the drawing, which is why it carries
// none of this panel's numeric risk.
//
// The bar's width is an inline style rather than a utility class, and that is
// the documented escape hatch rather than laziness: a width is DATA here (a
// different number per row), Tailwind's scanner cannot see a class name built
// from a variable, and a class per percentage would mint up to a hundred rules
// for values used once each against a stylesheet with 163 bytes of headroom.
// CSP's style-src allows inline style on purpose and src/test/hosting.test.ts
// counts the components that take this hatch.
import React from 'react';
import { barPercents } from './chart-geometry';

const ROW = 'border-b border-gray-100 py-2 last:border-0';
const HEAD = 'flex justify-between gap-4 text-sm text-ink';
const SUB = 'ml-2 text-xs text-gray-600';
// w-full on the track is load-bearing and invisible to jsdom: without it the
// track shrink-wraps its child, every bar becomes the same width as its own
// track, and the ratio between two rows collapses to 1:1 while every inline
// style attribute still reads correctly. Only a real browser can see that.
const TRACK = 'mt-1 h-2 w-full rounded bg-brand/20';
// Brand blue is a SURFACE colour (1.45:1 on white) and this is a surface: it
// carries no text and states nothing that is not also printed as a figure
// beside it, so it is the correct use of the token rather than an exception.
const FILL = 'h-2 rounded bg-brand';

export interface BarRow {
  key: string;
  label: string;
  sub?: string;
  value: number;
}

export interface BarListProps {
  rows: BarRow[];
  // <ol> for pages (rank is meaningful), <ul> for referrers.
  ordered: boolean;
}

const BarList: React.FC<BarListProps> = ({ rows, ordered }) => {
  const percents = barPercents(rows.map((row) => row.value));
  const List = ordered ? 'ol' : 'ul';
  return (
    <List className="text-sm text-ink">
      {rows.map((row, index) => (
        <li key={row.key} className={ROW} data-row={row.key}>
          <div className={HEAD}>
            <span>
              {row.label}
              {row.sub !== undefined && <span className={SUB}>{row.sub}</span>}
            </span>
            <span className="text-gray-600">{row.value.toLocaleString('en-IN')}</span>
          </div>
          {/* aria-hidden because the number beside the label already says
              everything the bar says -- a screen reader hearing both would
              hear every row twice. */}
          <div aria-hidden="true" className={TRACK}>
            <div className={FILL} style={{ width: `${String(percents[index])}%` }} data-bar={row.key} />
          </div>
        </li>
      ))}
    </List>
  );
};

export default BarList;
```

- [ ] **Step 2: Card B uses it** — `ordered`, `key: row.path`, `label: labelForPath(row.path, pages)`, `value: row.visits`. Leave the empty-state sentence exactly as it is. Add one comment above the map recording that `row.path` arrives already normalised by the Worker, which is what makes it a stable React key and what stops `/catering?utm_source=instagram` splitting into its own row now that tagged links exist.

- [ ] **Step 3: Card C uses it** — `ordered={false}`, `key: \`${bucket.kind}:${bucket.host ?? ''}\``, `label: bucket.label`, `sub: bucket.host ?? undefined`, `value: bucket.visits`.

- [ ] **Step 4: The jsdom tests — the arithmetic and the attribute, never the layout**

An inline `style` attribute is a legitimate jsdom assertion: it reads back exactly what React set on the element, which is a property of the element rather than of layout. A **computed** width is not, and there is no row for one here.

```tsx
describe('BarList', () => {
  const rows = [
    { key: '/', label: 'Homepage', value: 2000 },
    { key: '/catering', label: 'Catering', value: 400 },
  ];

  it('shows every row with its own number, formatted for India', () => {
    render(<BarList rows={[...rows, { key: '/x', label: 'X', value: 100000 }]} ordered />);
    expect(screen.getByText('2,000')).toBeInTheDocument();
    // 1,00,000 in en-IN and 100,000 everywhere else -- the value that makes
    // this assertion about the locale rather than about the separator.
    expect(screen.getByText('1,00,000')).toBeInTheDocument();
  });

  it('the leader fills the track and everything else is measured against it', () => {
    render(<BarList rows={rows} ordered />);
    expect(document.querySelector('[data-bar="/"]')).toHaveStyle({ width: '100%' });
    expect(document.querySelector('[data-bar="/catering"]')).toHaveStyle({ width: '20%' });
  });

  it('a single visit still draws a bar', () => {
    render(<BarList rows={[{ key: 'a', label: 'A', value: 900 }, { key: 'b', label: 'B', value: 1 }]} ordered />);
    expect(document.querySelector('[data-bar="b"]')).toHaveStyle({ width: '2%' });
  });

  it('an all-zero list does not emit NaN%', () => {
    render(<BarList rows={[{ key: 'a', label: 'A', value: 0 }]} ordered />);
    const bar = document.querySelector('[data-bar="a"]') as HTMLElement;
    expect(bar.style.width).not.toContain('NaN');
    expect(bar).toHaveStyle({ width: '2%' });
  });

  it('keeps the bars out of the accessibility tree', () => {
    render(<BarList rows={rows} ordered />);
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it('ranks the pages and does not rank the referrers', () => {
    const { container, rerender } = render(<BarList rows={rows} ordered />);
    expect(container.querySelector('ol')).not.toBeNull();
    rerender(<BarList rows={rows} ordered={false} />);
    expect(container.querySelector('ul')).not.toBeNull();
  });

  it('shows a hostname beside a label when there is one', () => {
    render(<BarList rows={[{ key: 'o:t.co', label: 'Other links', sub: 't.co', value: 3 }]} ordered={false} />);
    expect(screen.getByText('t.co')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Re-read comments for bare utility-class tokens.**

- [ ] **Step 6: `npm run build`, measure, raise in this commit if breached.**

- [ ] **Step 7: `npx tsc -b --noEmit && npm test -- --run src/admin/manage/__tests__/BarList.test.tsx src/admin/areas/__tests__/NumbersArea.test.tsx`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| `barPercents` divides by the sum instead of the peak | "the leader fills the track and everything else is measured against it" | — |
| drop `Math.max(2, …)` | "a single visit still draws a bar" | — |
| delete the zero-peak early return | "an all-zero list does not emit NaN%" | — |
| drop `aria-hidden` | "keeps the bars out of the accessibility tree" | — |
| ignore `ordered` and always render `<ul>` | "ranks the pages and does not rank the referrers" | — |
| drop `toLocaleString('en-IN')` | "shows every row with its own number, formatted for India" | The 100000 row is what makes the grouping differ from the default locale; a 2,000 row alone reddens nothing. |
| `TRACK` loses `w-full` | **nothing in jsdom** — Task 23's "the page bars are proportional to their values" | **e2e only, and the mechanism is written down:** the track shrink-wraps its child, so every bar becomes exactly as wide as its own track and the ratio between two rows collapses to 1:1 — while every `style` attribute still reads correctly. jsdom has no layout engine and cannot see it. Do not invent a jsdom row. |
| `FILL` uses `bg-brand/20` (the track colour) | **none in jsdom; stated** | A computed-style claim. It belongs to Task 23's contrast sweep. |
| render `sub` unconditionally | **nothing reddens** | Accepted: `undefined` renders as nothing either way, and asserting on that is asserting on React. |

**CSS ceiling:** **this task can breach it.** New utilities: `h-2`, `bg-brand/20`, `border-gray-100`, `last:border-0`; `flex`, `justify-between`, `gap-4`, `mt-1`, `w-full`, `ml-2`, `py-2`, `text-xs`, `text-gray-600` all already exist. The bar widths themselves add **zero** rules by construction — that is the entire reason they are inline. Expected movement roughly 40–90 bytes; measure and raise in this commit if over.

**If this task is wrong:** the bars mislead in the one direction a reader cannot check — a proportion drawn wrong still looks like a proportion, and a picture is more persuasive than a figure.

---

## Task 19: The stat cards and their comparison

**Files:**
- Create: `src/admin/manage/StatCard.tsx`, `src/admin/manage/__tests__/StatCard.test.tsx`
- Modify: `src/admin/areas/NumbersArea.tsx` (Card A's populated branch), `worker/analytics.ts`, `worker/__tests__/analytics.test.ts`

**Interfaces:**
```ts
export interface StatCardProps { label: string; value: string; change: Change; unit: 'visits' | 'taps' }
```

- [ ] **Step 1: `src/admin/manage/StatCard.tsx`**

```tsx
// A headline number with something beside it to compare against, which is the
// entire reason this card exists: "about 4,100 visits" is a fact, and whether
// that is better or worse than last month is the question she actually has.
//
// The direction is a WORD as well as a colour. Colour alone fails for a
// colour-blind reader and fails again in a screenshot printed in black and
// white, and the sentence is already being written either way.
import React from 'react';
import type { Change } from './comparison';
import { changeSentence } from './comparison';

export interface StatCardProps {
  label: string;
  value: string;
  change: Change;
  unit: 'visits' | 'taps';
}

// Accent for both directions, deliberately. Green-up/red-down is the
// convention everywhere else and it is wrong here: this site's palette has no
// green, red on a restaurant dashboard reads as an alarm, and "fewer visits
// than last month" is information rather than a fault.
const StatCard: React.FC<StatCardProps> = ({ label, value, change, unit }) => (
  <div style={{ minWidth: '8rem' }}>
    <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
    <p className="text-2xl text-ink">{value}</p>
    <p className={change.direction === 'unknown' ? 'text-xs text-gray-500' : 'text-xs text-accent'}>
      {changeSentence(change, unit)}
    </p>
  </div>
);

export default StatCard;
```

`minWidth` is an inline style rather than `min-w-[8rem]`: one arbitrary value used in exactly one place is the case the escape hatch documents, and an arbitrary-value class emits a whole new rule against 163 bytes of headroom.

- [ ] **Step 2: Card A's populated branch**

```tsx
      <>
        <div className="flex flex-wrap gap-6">
          <StatCard
            label="Visits"
            value={visitsSentence(outcome.payload.visits)}
            change={changeBetween(outcome.payload.visits, outcome.payload.visitsPrevious)}
            unit="visits"
          />
          <StatCard
            label="Reserve a Table"
            value={tapsSentence(outcome.payload.bookingTaps.total)}
            change={changeBetween(outcome.payload.bookingTaps.total, outcome.payload.tapsPrevious)}
            unit="taps"
          />
        </div>
        {ratioSentence(outcome.payload) !== null && (
          <p className="mt-2 text-sm text-ink">{ratioSentence(outcome.payload)}</p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          Taps are a lower bound, not a count — some are never recorded. Visits are an estimate.
        </p>
      </>
```

The two existing sentences and the caveat line are unchanged, verbatim — `NumbersArea.test.tsx` pins them and there is no reason to move them.

- [ ] **Step 3: The Worker fills `visitsPrevious` and `tapsPrevious`**

The previous window is the same length, ending where this one begins. That is a second aliased node, not a second document:

```graphql
    previousWindow: rumPageloadEventsAdaptiveGroups(
      filter: { siteTag: $siteTag, datetime_geq: $sincePrevious, datetime_lt: $sinceWindow }
      limit: 1000
      orderBy: [sum_visits_DESC]
    ) {
      sum { visits }
      dimensions { requestPath }
    }
```

with `$sincePrevious: Time!` declared and `sincePrevious: iso(until - 2 * windowDays * DAY_MS)` in the variables, then:

```ts
    // NOT thisWeekVisits/priorWeekVisits. Those two are Card D's, they are a
    // fixed seven days against the seven before, and they are correct for the
    // sentence that card writes. Reusing them here would make the stat cards
    // and Card D disagree at every range EXCEPT 7d -- she would read
    // "18% more visits" beside "about the same as usual" on one screen, with
    // nothing to tell her which was answering which question.
    visitsPrevious: totalVisits(rowsOf(account.previousWindow)),
    tapsPrevious: sumWaCounts(
      waCounts,
      // The window BEFORE this one: skip the current windowDays, then take
      // the next windowDays back. recentIstDates already ends yesterday, so
      // slicing is the whole of it.
      recentIstDates(todayInKolkata(), windowDays * 2).slice(windowDays),
    ),
```

- [ ] **Step 4: The tests**

```tsx
describe('StatCard', () => {
  it('shows the number and what it is', () => {
    render(<StatCard label="Visits" value="about 4,100 visits" change={changeBetween(4100, 3300)} unit="visits" />);
    expect(screen.getByText('Visits')).toBeInTheDocument();
    expect(screen.getByText('about 4,100 visits')).toBeInTheDocument();
  });

  it('says the direction in words, not only in colour', () => {
    render(<StatCard label="Visits" value="about 4,100 visits" change={changeBetween(4100, 3300)} unit="visits" />);
    expect(screen.getByText('24% more visits than the period before.')).toBeInTheDocument();
  });

  it('says why it cannot compare rather than showing nothing', () => {
    render(<StatCard label="Visits" value="about 9 visits" change={changeBetween(9, 2)} unit="visits" />);
    expect(screen.getByText('Not enough of the period before to compare visits against.')).toBeInTheDocument();
  });
});

describe('the previous window', () => {
  it('is the same length, ending where this one begins', async () => {
    const body = await (await handleAnalytics(analyticsRequest('?range=7d'), buildEnv({ upstream: twoWindows }))).json();
    expect(body.visits).toBe(70);
    expect(body.visitsPrevious).toBe(35);
  });

  it('counts the previous window of taps too, and does not double-count today', async () => {
    // The fixture uses DIFFERENT daily counts per window -- 1 a day for the
    // recent seven, 2 a day for the seven before -- so that "the same window
    // twice" and "the window before" produce different numbers. A uniform
    // fixture would make both mutations below green for the wrong reason.
    const body = await (await handleAnalytics(analyticsRequest('?range=7d'), buildEnv({ waCounts: fourteenDays }))).json();
    expect(body.bookingTaps.total).toBe(7);
    expect(body.tapsPrevious).toBe(14);
  });
});
```

- [ ] **Step 5: Re-read comments for bare utility-class tokens.**

- [ ] **Step 6: `npm run build`, measure, raise in this commit if breached.**

- [ ] **Step 7: `npx tsc -b --noEmit && npm test -- --run src/admin/manage/__tests__/StatCard.test.tsx worker/__tests__/analytics.test.ts src/admin/areas/__tests__/NumbersArea.test.tsx`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| render only the coloured class, dropping `changeSentence` | "says the direction in words, not only in colour" | — |
| render an empty string for `unknown` | "says why it cannot compare rather than showing nothing" | — |
| filter `previousWindow` with `datetime_geq: $sinceWindow` | "is the same length, ending where this one begins" | — |
| `.slice(windowDays + 1)` on the tap dates | "counts the previous window of taps too, and does not double-count today" | — |
| `.slice(0, windowDays)` (the same window twice) | the same test — `tapsPrevious` reads 7 instead of 14 | Only because the fixture uses two different daily counts. With a uniform fixture both windows read 7 and this mutation is invisible. Fix the fixture, not the assertion. |
| use `thisWeekVisits`/`priorWeekVisits` for the comparison | **nothing reddens at range=7d** | Run the same assertion at `?range=30d`: the stat card's comparison must move with the range and Card D's must not. Add that case if it is missing. |

**CSS ceiling:** **this task can breach it.** New utilities: `text-2xl` only — `min-w-[8rem]` is deliberately an inline style instead. `flex`, `flex-wrap`, `gap-6`, `text-xs`, `uppercase`, `tracking-wide`, `text-gray-500`, `text-accent`, `text-ink` all already exist. Expected movement roughly 20–40 bytes.

**If this task is wrong:** she reads "24% more visits" against a period that overlaps the current one, and every comparison on the panel is understated.

---
## Task 20: The campaign card, what it cannot say, and the deploy that switches counting on

The card the whole write path exists for. **Its empty state is the deliverable**, not a placeholder: it is where she learns what a tagged link looks like and which tags this site recognises, and until it exists there are no tagged links in the world to count. That is why the Worker's `/api/campaign` route is deployed in **this** task rather than in Task 8.

**Files:**
- Modify: `src/admin/areas/NumbersArea.tsx`, `src/admin/manage/analytics.ts`, `src/admin/areas/__tests__/NumbersArea.test.tsx`

**Interfaces:**
- Consumes: `BarList` (Task 18), `payload.campaigns`, `KNOWN_CAMPAIGN_SOURCES`.
- Produces: `CAMPAIGN_CAVEAT`, `CAMPAIGN_VS_REFERRER`, `campaignHowTo(site: string): string`.

- [ ] **Step 1: The three sentences, in `analytics.ts`**

```ts
// Shown when the table is empty, which is the state this card ships in and
// the most useful thing on the screen that day. "Nothing yet" alone would
// leave her with no way to discover what the card wants.
export function campaignHowTo(site: string): string {
  return `Add ?utm_source= and one of these words to the end of your web address, then paste that instead of the plain one. For example: ${site}/?utm_source=instagram`;
}

// What this card cannot tell her, ON the card rather than assumed. Both
// directions are named because both are real: the same person on a phone and
// a laptop is two arrivals, and someone whose browser blocks scripts is none.
export const CAMPAIGN_CAVEAT =
  'Counted once per person arriving, not once per page they read. It cannot tell that the same person came back on a different phone, and it misses anyone whose browser blocks it.';

// A tag is not a referrer, and this card sits directly below one that says
// "Instagram" meaning something different. Without this line the two read as
// a contradiction and she has no way to tell which to believe.
export const CAMPAIGN_VS_REFERRER =
  'This is not the same as the card above. That one says which website someone clicked from; this one says which of your own links they clicked.';
```

- [ ] **Step 2: The card, directly under Card C**

Adjacency is the point: the two cards that could be read as contradicting each other sit together, with the sentence that distinguishes them between them.

```tsx
const CampaignCard: React.FC<{ outcome: Outcome; site: string }> = ({ outcome, site }) => (
  <div className={CARD} data-card="campaigns">
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.campaigns}</h3>
    {outcome.kind !== 'ok' ? (
      <Skeleton />
    ) : (
      <>
        {outcome.payload.campaigns.length === 0 ? (
          <>
            <p className="text-sm text-gray-600">{campaignHowTo(site)}</p>
            <p className="mt-1 text-xs text-gray-600">
              Words this site recognises: {KNOWN_CAMPAIGN_SOURCES.join(', ')}. Anything else is counted as one row.
            </p>
          </>
        ) : (
          <BarList
            ordered={false}
            rows={outcome.payload.campaigns.map((row) => ({
              key: row.source,
              label: row.label,
              value: row.arrivals,
            }))}
          />
        )}
        {/* Both sentences render in BOTH states, because the confusion they
            prevent exists in both. */}
        <p className="mt-2 text-xs text-gray-500">{CAMPAIGN_VS_REFERRER}</p>
        <p className="mt-1 text-xs text-gray-500">{CAMPAIGN_CAVEAT}</p>
      </>
    )}
  </div>
);
```

- [ ] **Step 3: The tests**

```tsx
describe('the campaign card', () => {
  it('shows each source with its exact count, in her words', async () => {
    renderNumbers({ payload: { ...POPULATED, campaigns: [{ source: 'instagram', label: 'Instagram link', arrivals: 84 }] } });
    expect(await screen.findByText('Instagram link')).toBeInTheDocument();
    expect(screen.getByText('84')).toBeInTheDocument();
    // The machine value never reaches the screen -- "instagram" beside a
    // referrer card that also says Instagram is the collision this avoids.
    expect(screen.queryByText('instagram')).toBeNull();
  });

  it('teaches her how to make a tagged link when there is nothing to show yet', () => {
    renderNumbers({ payload: { ...POPULATED, campaigns: [] } });
    expect(screen.getByText(/utm_source=instagram/)).toBeInTheDocument();
  });

  it('lists the words the site actually recognises, so a wrong tag is discoverable', () => {
    // Without this list she uses ?utm_source=insta, every arrival lands in
    // "other", and the card tells her Instagram brought nobody.
    renderNumbers({ payload: { ...POPULATED, campaigns: [] } });
    for (const source of KNOWN_CAMPAIGN_SOURCES) {
      expect(screen.getByText(new RegExp(source))).toBeInTheDocument();
    }
  });

  it('says a tag is not a referrer, in both states', () => {
    renderNumbers({ payload: { ...POPULATED, campaigns: [] } });
    expect(screen.getByText(CAMPAIGN_VS_REFERRER)).toBeInTheDocument();
    cleanup();
    renderNumbers({ payload: { ...POPULATED, campaigns: [{ source: 'other', label: 'Someone else’s link', arrivals: 12 }] } });
    expect(screen.getByText(CAMPAIGN_VS_REFERRER)).toBeInTheDocument();
  });

  it('says what it cannot tell her, on the card', () => {
    renderNumbers({ payload: { ...POPULATED, campaigns: [{ source: 'instagram', label: 'Instagram link', arrivals: 84 }] } });
    expect(screen.getByText(CAMPAIGN_CAVEAT)).toBeInTheDocument();
  });

  it('groups everything she has not named into one row', () => {
    renderNumbers({ payload: { ...POPULATED, campaigns: [{ source: 'other', label: 'Someone else’s link', arrivals: 12 }] } });
    expect(screen.getByText('Someone else’s link')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Re-read comments for bare utility-class tokens.**

- [ ] **Step 5: `npm run build`, measure, raise in this commit if breached.**

- [ ] **Step 6: `npx tsc -b --noEmit && npm test -- --run src/admin/areas/__tests__/NumbersArea.test.tsx`**

- [ ] **Step 7: NOW switch counting on**

```
npx wrangler deploy
```

`/api/campaign` becomes reachable at this point and not before. The card exists, its empty state names the link format and the recognised words, and every arrival counted from here is an arrival through a link she was told how to make. Confirm the route is live with `npm run verify:deploy`, and remember that `npx wrangler deploy` **replaces** the Worker's route list and cron schedule with exactly what `wrangler.toml` declares — Task 13's `[triggers]` block must already be committed.

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| drop the caveat line | "says what it cannot tell her, on the card" | — |
| render `CAMPAIGN_VS_REFERRER` only in the empty branch | "says a tag is not a referrer, in both states" | — |
| replace the empty state with "No campaigns yet." | "teaches her how to make a tagged link when there is nothing to show yet" | — |
| drop the recognised-words list | "lists the words the site actually recognises…" | — |
| render `row.source` in place of `row.label` | "shows each source with its exact count, in her words" | — |
| deploy the Worker in Task 8 instead of here | **nothing reddens** | Stated, and enforced by review: the cost is days of counting arrivals from links nobody has been told how to make. There is no test for a deploy ordering. |

**CSS ceiling:** **this task can breach it.** Every class used already exists on this screen. Expected movement is **zero** — measure anyway, because a zero-byte expectation that turns out non-zero is a leaked comment token, and finding it here is cheaper than finding it in Task 23's audit.

**If this task is wrong:** she reads "Instagram: 84" on two cards that mean different things, believes one of them is broken, and stops trusting the panel — or she tags her links `?utm_source=insta`, every arrival lands in "other", and the card tells her Instagram brought nobody.

---

## Task 21: The busiest-times chart, drawn — or CUT

**Conditional on Task 1 and Task 15.** Read `worker/analytics-schema.ts` first.

**If `RUM_CAPABILITIES.hourDimension === null`:** this task is **CUT**. Check the box, touch no file, and confirm Task 15's CUT branch already pinned `hourly: null` with a test and recorded the cut in `docs/analytics-schema-verification.md`. Nothing else in the plan changes — no other card depends on this one, which is exactly why the spec listed it last and why this is the only task in the plan that can be deleted without a knock-on.

**If `RUM_CAPABILITIES.hourDimension` is a real name, everything below applies.**

**Files:**
- Create: `src/admin/manage/HoursChart.tsx`, `src/admin/manage/__tests__/HoursChart.test.tsx`
- Modify: `src/admin/areas/NumbersArea.tsx`

**Interfaces:**
```ts
export interface HoursChartProps { cells: AnalyticsHourCell[] }
```

- [ ] **Step 1: `src/admin/manage/HoursChart.tsx`**

```tsx
// Seven rows of twenty-four, painted by density. Genuinely useful for a
// restaurant deciding when to staff, and the one card on this panel that
// answers a question about the future rather than the past.
//
// ONE <svg> with 168 <rect> elements, not 168 divs: a rect is attributes
// (x, y, width, height, opacity) and costs the stylesheet nothing, while 168
// divs on a phone would be a layout the browser has to solve. It also means
// the whole thing scales to any card width through the viewBox with no
// measurement at runtime.
import React from 'react';
import { cellOpacity } from './chart-geometry';
import type { AnalyticsHourCell } from '../../shared/analytics-payload';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CELL = 10;
const GAP = 1;
const LABEL_WIDTH = 26;
const VIEW_WIDTH = LABEL_WIDTH + 24 * (CELL + GAP);
const VIEW_HEIGHT = 7 * (CELL + GAP) + 12;

export interface HoursChartProps {
  cells: AnalyticsHourCell[];
}

const HoursChart: React.FC<HoursChartProps> = ({ cells }) => {
  const byKey = new Map(cells.map((cell) => [`${String(cell.day)}:${String(cell.hour)}`, cell.visits]));
  const peak = cells.reduce((highest, cell) => Math.max(highest, cell.visits), 0);

  return (
    <svg
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
      role="img"
      aria-label="Visits by day of the week and hour of the day, in Indian time"
      className="w-full"
    >
      {DAYS.map((name, day) => (
        <g key={name}>
          <text x={0} y={day * (CELL + GAP) + CELL} fontSize={8} fill="#222222">
            {name}
          </text>
          {Array.from({ length: 24 }, (unused, hour) => (
            <rect
              key={hour}
              x={LABEL_WIDTH + hour * (CELL + GAP)}
              y={day * (CELL + GAP)}
              width={CELL}
              height={CELL}
              fill="#9D4949"
              opacity={cellOpacity(byKey.get(`${String(day)}:${String(hour)}`) ?? 0, peak)}
            />
          ))}
        </g>
      ))}
      {/* Three hour labels, not twenty-four: at 390px, 24 labels under a 10px
          row overlap into a smear. Midnight, noon and six are enough to
          orient a reader who already knows what a week looks like. */}
      {[0, 12, 18].map((hour) => (
        <text key={hour} x={LABEL_WIDTH + hour * (CELL + GAP)} y={VIEW_HEIGHT - 2} fontSize={7} fill="#222222">
          {hour === 0 ? '12am' : hour === 12 ? '12pm' : '6pm'}
        </text>
      ))}
    </svg>
  );
};

export default HoursChart;
```

- [ ] **Step 2: The card, rendered only when the data exists**

```tsx
{outcome.kind === 'ok' && outcome.payload.hourly !== null && (
  <div className={CARD} data-card="hours">
    <h3 className={CARD_TITLE}>{CARD_HEADINGS.hours}</h3>
    <HoursChart cells={outcome.payload.hourly} />
    <p className="mt-2 text-xs text-gray-500">Indian time. Darker means busier. Visits are an estimate.</p>
  </div>
)}
```

`hourly !== null` rather than a length check: an empty week is a real, drawable answer ("nobody yet"), while `null` means the question cannot be answered at all and the card must not appear.

- [ ] **Step 3: The tests**

These are attribute assertions, not layout assertions — `x`, `y` and `opacity` are what React wrote, which jsdom reads back honestly. Whether 168 cells fit legibly on a 390px screen is Task 23's measurement.

```tsx
describe('HoursChart', () => {
  it('draws a cell for every hour of every day', () => {
    const { container } = render(<HoursChart cells={[]} />);
    expect(container.querySelectorAll('rect')).toHaveLength(168);
  });

  it('paints the busiest hour at full strength and an empty one at none', () => {
    const { container } = render(<HoursChart cells={[{ day: 5, hour: 20, visits: 40 }]} />);
    const rects = [...container.querySelectorAll('rect')] as SVGRectElement[];
    const busiest = rects.find(
      (rect) => rect.getAttribute('y') === String(5 * 11) && rect.getAttribute('x') === String(26 + 20 * 11),
    );
    expect(busiest?.getAttribute('opacity')).toBe('1');
    const empty = rects.find(
      (rect) => rect.getAttribute('y') === String(1 * 11) && rect.getAttribute('x') === String(26 + 3 * 11),
    );
    expect(empty?.getAttribute('opacity')).toBe('0');
  });

  it('makes an hour with one visit look different from a closed hour', () => {
    // The floor. Without it "quiet" and "closed" render identically and the
    // card stops answering the question it exists for.
    const { container } = render(<HoursChart cells={[{ day: 5, hour: 20, visits: 400 }, { day: 2, hour: 3, visits: 1 }]} />);
    const rects = [...container.querySelectorAll('rect')] as SVGRectElement[];
    const one = rects.find(
      (rect) => rect.getAttribute('y') === String(2 * 11) && rect.getAttribute('x') === String(26 + 3 * 11),
    );
    expect(Number(one?.getAttribute('opacity'))).toBeGreaterThanOrEqual(0.08);
  });

  it('names itself and its timezone for a screen reader', () => {
    render(<HoursChart cells={[]} />);
    expect(screen.getByRole('img', { name: /Indian time/ })).toBeInTheDocument();
  });

  it('is not rendered at all when the site cannot answer the question', () => {
    renderNumbers({ payload: { ...POPULATED, hourly: null } });
    expect(screen.queryByText(CARD_HEADINGS.hours)).toBeNull();
  });

  it('IS rendered, empty, when the week was simply quiet', () => {
    renderNumbers({ payload: { ...POPULATED, hourly: [] } });
    expect(screen.getByText(CARD_HEADINGS.hours)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Re-read comments for bare utility-class tokens — this file needs it more than any other.**

The word this card is named after in ordinary English is a real Tailwind utility. Reword every prose use to "chart of hours", "cells" or "rows", and confine the utility-shaped word to identifiers (`HoursChart`, `HoursChartProps`), which the scanner tokenises whole. Re-diff the stylesheet to confirm; this exact hazard has cost this project six rules.

- [ ] **Step 5: `npm run build`, measure, raise in this commit if breached.**

- [ ] **Step 6: `npx tsc -b --noEmit && npm test -- --run src/admin/manage/__tests__/HoursChart.test.tsx src/admin/areas/__tests__/NumbersArea.test.tsx`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| render 7 × 12 cells | "draws a cell for every hour of every day" | — |
| drop the `cellOpacity` floor | "makes an hour with one visit look different from a closed hour" | That test exists for this row alone; the busiest/empty test cannot see it. |
| render the card on `hourly !== undefined` | "is not rendered at all when the site cannot answer the question" | — |
| render the card only when `hourly.length > 0` | "IS rendered, empty, when the week was simply quiet" | — |
| drop `aria-label` | "names itself and its timezone for a screen reader" | — |

**CSS ceiling:** **this task can breach it, and it is the likeliest one to — but not through its classes.** The only utility is `w-full`, probably already present; everything else is an SVG attribute. **The real hazard is the comment scan** (Step 4). Expect zero bytes and treat any movement as a leaked token.

**If this task is wrong (BUILD):** she staffs Friday dinner from a chart that put Friday dinner on Saturday. **If this task is wrong (CUT):** an empty chart sits on the screen reading as "nobody came" when the truth is "this cannot be known".

---

## Task 22: The range control, the latch it must break, and the answer it must discard

The last functional task. It deliberately breaks the once-per-session fetch latch — a documented intentional behaviour, not a bug — and must break it in exactly one direction.

**Files:**
- Create: `src/admin/manage/RangeControl.tsx`, `src/admin/manage/__tests__/RangeControl.test.tsx`
- Modify: `src/admin/areas/NumbersArea.tsx`, `src/admin/areas/__tests__/NumbersArea.test.tsx`, `src/admin/manage/analytics.ts`

**Interfaces:**
```ts
export interface RangeControlProps {
  value: AnalyticsRange;
  onChange: (next: AnalyticsRange) => void;
  disabled: boolean;
  yearAvailable: boolean;
}
export const RANGE_LABELS: Record<AnalyticsRange, string>;
// analytics.ts
export function archiveSentence(): string;
```

- [ ] **Step 1: `src/admin/manage/RangeControl.tsx`**

```tsx
// Three buttons, or four once the archive has filled. Not a <select>: four
// options is fewer than a menu is worth, and a pressed pill is readable
// without opening anything -- which matters on the one screen she only ever
// reads.
//
// Every button is type="button". This renders inside the single <form>
// PublishBar's own button submits, where a bare <button> defaults to
// type="submit" and would become a second Publish trigger. NumbersArea's
// Retry button already carries the same note.
import React from 'react';
import type { AnalyticsRange } from '../../shared/analytics-payload';

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  year: 'By year',
};

const ORDER: AnalyticsRange[] = ['7d', '30d', '90d', 'year'];

// The pressed pill is ink on brand: brand blue is a SURFACE colour (1.45:1 on
// white) and can never carry text, so the text on it is ink and the unpressed
// ones are accent on white. Both pairings clear 4.5:1 and
// e2e/brand-contrast.spec.ts's sweep governs.
const PRESSED = "rounded bg-brand px-3 py-2 font-['Montserrat'] text-xs uppercase tracking-wide text-ink";
const UNPRESSED =
  "rounded border border-brand px-3 py-2 font-['Montserrat'] text-xs uppercase tracking-wide text-accent transition hover:bg-brand hover:text-ink";

export interface RangeControlProps {
  value: AnalyticsRange;
  onChange: (next: AnalyticsRange) => void;
  disabled: boolean;
  // The spec says "and -- once the archive has filled -- by year". A fourth
  // button offered on day one against an empty rollup answers with an empty
  // chart, which teaches her the feature is broken.
  yearAvailable: boolean;
}

const RangeControl: React.FC<RangeControlProps> = ({ value, onChange, disabled, yearAvailable }) => (
  <div role="group" aria-label="How far back" className="mb-4 flex flex-wrap gap-2">
    {ORDER.filter((range) => range !== 'year' || yearAvailable).map((range) => (
      <button
        key={range}
        type="button"
        // aria-pressed, not aria-current: these are toggles over one setting,
        // and a screen reader announcing "pressed" is what tells her which one
        // she is looking at without reading the numbers first.
        aria-pressed={range === value}
        disabled={disabled}
        onClick={() => onChange(range)}
        className={range === value ? PRESSED : UNPRESSED}
      >
        {RANGE_LABELS[range]}
      </button>
    ))}
  </div>
);

export default RangeControl;
```

`px-3 py-2` on a `text-xs` button measures at least 24 × 24 CSS pixels (WCAG 2.2 SC 2.5.8 AA) and is **measured** in Task 23 rather than asserted here — a target-size claim is geometry.

- [ ] **Step 2: The archive sentence, in `analytics.ts`**

```ts
// Cards B and C have no data at year grain (the rollup holds totals, not a
// breakdown), and their existing "Nothing to rank yet — this fills in once
// people start visiting" is FALSE there. The difference between "nothing was
// kept" and "nobody visited" is the distinction this whole panel exists to
// make, and an empty list under an empty-state sentence about visitors says
// the wrong one of the two.
export function archiveSentence(): string {
  return 'Pages and links are not kept in the yearly archive — choose 90 days or less to see them.';
}
```

- [ ] **Step 3: The latch becomes per-range, and a stale answer is discarded**

```tsx
  const [range, setRange] = useState<AnalyticsRange>(DEFAULT_RANGE);
  // Which ranges this session has already asked for. The single boolean this
  // replaces was right for a screen with one answer and is wrong for one with
  // four: the ORIGINAL guarantee -- a dashboard load never costs a Cloudflare
  // call for a screen she does not open -- is preserved exactly, because a
  // range she has not chosen is still never requested.
  //
  // What it deliberately does NOT do is re-fetch when she returns to a range
  // she already loaded. The 10-minute cache entry behind this route means a
  // second request would usually return the same body anyway.
  const requestedRef = useRef<Set<AnalyticsRange>>(new Set());

  useEffect(() => {
    if (!active || requestedRef.current.has(range)) return;
    requestedRef.current.add(range);
    setOutcome({ kind: 'loading' });
    void loadAnalytics(range, fetchImpl).then((next) => {
      if (!mountedRef.current) return;
      // The answer for a range she is no longer looking at is DISCARDED.
      // Tapping 7d then 90d quickly otherwise paints the 7d answer under the
      // 90d pill, with no error and no way for her to tell -- the disabled
      // control below narrows the window but cannot close it, because a
      // request already in flight when the control disables is still in
      // flight when it re-enables.
      if (next.kind === 'ok' && next.payload.range !== range) return;
      setOutcome(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, range]);
```

and `loadAnalytics` takes the range, fetching `/api/analytics?range=${range}` and using `isAnalyticsPayload` from the contract module. `retry()` becomes `void loadAnalytics(range, fetchImpl)` with the same discard guard.

- [ ] **Step 4: Render it, disabled while a request is in flight**

```tsx
      <RangeControl
        value={range}
        onChange={setRange}
        disabled={outcome.kind === 'loading'}
        yearAvailable={outcome.kind === 'ok' && outcome.payload.yearAvailable}
      />
```

- [ ] **Step 5: Cards B and C say the right thing at year grain**

```tsx
    ) : outcome.payload.range === 'year' ? (
      <p className="text-sm text-gray-600">{archiveSentence()}</p>
    ) : outcome.payload.byPath.length === 0 ? (
```

and the same branch in Card C.

- [ ] **Step 6: The tests**

```tsx
describe('the range control', () => {
  it('starts on 30 days', async () => {
    const fetchImpl = stubAnalytics();
    renderNumbers({ fetchImpl });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/analytics?range=30d'));
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('never submits the form it sits inside', async () => {
    renderNumbers({ fetchImpl: stubAnalytics() });
    const group = await screen.findByRole('group', { name: 'How far back' });
    for (const button of within(group).getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });

  it('asks the Worker for the range she picked', async () => {
    const fetchImpl = stubAnalytics();
    renderNumbers({ fetchImpl });
    fireEvent.click(await screen.findByRole('button', { name: 'Last 90 days' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/analytics?range=90d'));
  });

  it('asks once per range per session, not once per click', async () => {
    const fetchImpl = stubAnalytics();
    renderNumbers({ fetchImpl });
    fireEvent.click(await screen.findByRole('button', { name: 'Last 90 days' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Last 90 days' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it('still asks only once when she never touches the control', async () => {
    // The ORIGINAL guarantee, re-pinned.
    const fetchImpl = stubAnalytics();
    const { rerender } = renderNumbers({ fetchImpl, active: false });
    rerender(true);
    rerender(false);
    rerender(true);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  });

  it('discards an answer for a range she is no longer looking at', async () => {
    // Tapping 7d then 90d quickly. The 7d answer arrives second and must not
    // be painted under the 90d pill.
    const fetchImpl = stubAnalyticsOutOfOrder([
      { ...POPULATED, range: '90d', visits: 900 },
      { ...POPULATED, range: '7d', visits: 7 },
    ]);
    renderNumbers({ fetchImpl });
    fireEvent.click(await screen.findByRole('button', { name: 'Last 7 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Last 90 days' }));
    expect(await screen.findByText(/900/)).toBeInTheDocument();
    expect(screen.queryByText(/about 7 visits/)).toBeNull();
  });

  it('cannot be pressed while a request is in flight', async () => {
    const fetchImpl = neverResolvingAnalytics();
    renderNumbers({ fetchImpl });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Last 90 days' })).toBeDisabled());
  });

  it('never sends a range the Worker does not know', async () => {
    const fetchImpl = stubAnalytics({ yearAvailable: true });
    renderNumbers({ fetchImpl });
    await screen.findByRole('button', { name: 'By year' });
    for (const label of ['Last 7 days', 'Last 90 days', 'By year']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    await waitFor(() => {
      for (const call of fetchImpl.mock.calls) {
        expect(String(call[0])).toMatch(/^\/api\/analytics\?range=(7d|30d|90d|year)$/);
      }
    });
  });

  it('offers no By year button until the archive holds something', async () => {
    renderNumbers({ payload: { ...POPULATED, yearAvailable: false } });
    expect(await screen.findByRole('button', { name: 'Last 90 days' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'By year' })).toBeNull();
  });

  it('offers it once the archive does', async () => {
    renderNumbers({ payload: { ...POPULATED, yearAvailable: true } });
    expect(await screen.findByRole('button', { name: 'By year' })).toBeInTheDocument();
  });

  it('says the breakdown is not KEPT by year, rather than saying nobody visited', async () => {
    renderNumbers({ payload: { ...POPULATED, range: 'year', byPath: [], byReferer: [] } });
    expect(await screen.findByText(archiveSentence())).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to rank yet/)).toBeNull();
  });
});
```

- [ ] **Step 7: Re-read comments for bare utility-class tokens.**

- [ ] **Step 8: `npm run build`, measure, raise in this commit if breached.**

- [ ] **Step 9: `npx tsc -b --noEmit && npm test -- --run src/admin/manage/__tests__/RangeControl.test.tsx src/admin/areas/__tests__/NumbersArea.test.tsx`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| keep the boolean latch and add `range` to the dependency array | "asks the Worker for the range she picked" — the second fetch never fires | — |
| drop the latch entirely | "asks once per range per session, not once per click", "still asks only once when she never touches the control" | — |
| remove the `payload.range !== range` discard | "discards an answer for a range she is no longer looking at" | — |
| drop `disabled` | "cannot be pressed while a request is in flight" | — |
| rely on `disabled` alone and remove the discard | "discards an answer…" | `disabled` narrows the race window but cannot close it: a request in flight when the control disables is still in flight when it re-enables. If the test passes anyway, make the stub resolve out of order — that is what `stubAnalyticsOutOfOrder` is for. |
| send `?range=${label}` (the human label) | "never sends a range the Worker does not know" | — |
| drop `aria-pressed` | "starts on 30 days" | — |
| render the By-year button unconditionally | "offers no By year button until the archive holds something" | — |
| leave Cards B and C on their old empty copy for `year` | "says the breakdown is not KEPT by year, rather than saying nobody visited" | — |
| drop `type="button"` | "never submits the form it sits inside" | — |

**CSS ceiling:** **this task can breach it.** `PRESSED`/`UNPRESSED` are largely the existing Retry button's string with `py-2` in place of `py-1`, plus `bg-brand` and the group wrapper's `mb-4 flex flex-wrap gap-2`. Expected movement roughly 60–120 bytes for `py-2` and `gap-2` if either is new. Measure and raise in this commit if over.

**If this task is wrong:** she picks 90 days, the pill says 90 days, and the numbers are still the 30-day ones — the exact failure the whole cache-keying argument exists to prevent, arriving through the front end instead.

---

## Task 23: The geometry sweep, the contrast sweep, and the CSS ceiling audit

Every claim jsdom could not honestly make, measured in a real browser at both widths; then one accounting of everything Tasks 17–22 added to the stylesheet.

**Files:**
- Create: `e2e/numbers-visuals.spec.ts`
- Modify: `e2e/edit-backend.ts` (a fixture with a series worth measuring)
- Modify: `src/test/bundle.post-build.test.ts` (the audit and the ledger)
- Modify: `e2e/brand-contrast.spec.ts` (route list, if needed)

- [ ] **Step 1: A fixture whose ratios can be measured without a tolerance argument**

```ts
// e2e/edit-backend.ts
export const ANALYTICS_DRAWN: AnalyticsPayload = {
  ...ANALYTICS_POPULATED,
  series: [
    { date: '2026-08-11', visits: 100, complete: true },
    { date: '2026-08-12', visits: 50, complete: true },
    { date: '2026-08-13', visits: 200, complete: true },
    { date: '2026-08-14', visits: 25, complete: true },
    { date: '2026-08-15', visits: 400, complete: true },
  ],
  // Deliberately 4:1 -- a ratio a bounding box can be measured against with
  // no tolerance argument.
  byPath: [
    { path: '/', visits: 400 },
    { path: '/catering', visits: 100 },
  ],
  campaigns: [
    { source: 'instagram', label: 'Instagram link', arrivals: 84 },
    { source: 'other', label: 'Someone else’s link', arrivals: 21 },
  ],
  yearAvailable: true,
};
```

- [ ] **Step 2: `e2e/numbers-visuals.spec.ts`**

```ts
// Everything about the Numbers panel that jsdom cannot honestly assert.
//
// No class-name assertions anywhere in this file: the dev server's Tailwind
// JIT never removes a rule inside a session, so a class assertion can be
// green against a stylesheet a cold production build would never produce.
// Computed style, bounding boxes, sampled pixels, and nothing else. The card
// and bar hooks are data- attributes for the same reason.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ANALYTICS_DRAWN, mockEditBackend, openDashboard } from './edit-backend';

const WIDTHS = [390, 1280];

async function openNumbers(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await mockEditBackend(page, { analytics: ANALYTICS_DRAWN });
  await openDashboard(page, '/edit/manage/numbers');
}

for (const width of WIDTHS) {
  test.describe(`the Numbers panel at ${width}px`, () => {
    test('the trend chart is drawn inside its card', async ({ page }) => {
      await openNumbers(page, width);
      const chart = page.getByRole('img', { name: /Visits over the last/ });
      const chartBox = (await chart.boundingBox())!;
      const cardBox = (await page.locator('[data-card="trend"]').boundingBox())!;
      expect(chartBox.width).toBeGreaterThan(0);
      expect(chartBox.height).toBeGreaterThan(0);
      // Inside its card on both horizontal edges. A chart that overflows is
      // the single most common way a hand-drawn SVG goes wrong at a width
      // nobody measured.
      expect(chartBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(chartBox.x + chartBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    });

    test('the page bars are proportional to their values', async ({ page }) => {
      await openNumbers(page, width);
      const lead = (await page.locator('[data-bar="/"]').boundingBox())!;
      const second = (await page.locator('[data-bar="/catering"]').boundingBox())!;
      // 400 against 100 in the fixture. MEASURED, not read off the style
      // attribute -- that is already covered in jsdom and would prove nothing
      // new here. This is also the only assertion that can see a missing
      // w-full on the track.
      expect(second.width / lead.width).toBeGreaterThan(0.22);
      expect(second.width / lead.width).toBeLessThan(0.28);
    });

    test('no bar escapes its card', async ({ page }) => {
      await openNumbers(page, width);
      const card = (await page.locator('[data-card="b"]').boundingBox())!;
      const bar = (await page.locator('[data-bar="/"]').boundingBox())!;
      expect(bar.x).toBeGreaterThanOrEqual(card.x);
      expect(bar.x + bar.width).toBeLessThanOrEqual(card.x + card.width + 1);
    });

    test('nothing on the panel scrolls sideways', async ({ page }) => {
      await openNumbers(page, width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('no range button overlaps another, and each is a real target', async ({ page }) => {
      await openNumbers(page, width);
      const buttons = page.getByRole('group', { name: 'How far back' }).getByRole('button');
      const boxes = [];
      for (let i = 0; i < (await buttons.count()); i += 1) boxes.push((await buttons.nth(i).boundingBox())!);
      for (const box of boxes) {
        // WCAG 2.2 SC 2.5.8 AA.
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          const overlaps =
            boxes[a].x < boxes[b].x + boxes[b].width &&
            boxes[b].x < boxes[a].x + boxes[a].width &&
            boxes[a].y < boxes[b].y + boxes[b].height &&
            boxes[b].y < boxes[a].y + boxes[a].height;
          expect(overlaps).toBe(false);
        }
      }
    });

    test('the pressed range reads as ink on brand, above 4.5:1', async ({ page }) => {
      await openNumbers(page, width);
      const pressed = page.getByRole('button', { name: 'Last 30 days' });
      // toHaveCSS, NOT a one-shot evaluate(getComputedStyle): these buttons
      // carry a colour transition, and a read taken immediately after a class
      // flips returns the FROM value -- a test that passes on a defect and
      // fails on the fix.
      await expect(pressed).toHaveCSS('color', 'rgb(34, 34, 34)');
      await expect(pressed).toHaveCSS('background-color', 'rgb(200, 216, 232)');
      // Equality alone is not enough: a future palette move could keep both
      // values off-white and still land under 4.5. Same argument
      // blog-controls.spec.ts already makes for its own pills.
      const color = await pressed.evaluate((el) => getComputedStyle(el).color);
      const background = await pressed.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
    });
  });
}

test.describe('the busiest-times chart on a phone', () => {
  test('every cell is at least one full pixel wide', async ({ page }) => {
    await openNumbers(page, 390);
    const hours = page.getByRole('img', { name: /Indian time/ });
    // A legitimate design decision reports as a SKIP, not as a failure: the
    // CUT branch of Tasks 15 and 21 means this card genuinely does not exist,
    // and a red test would be the wrong report of that.
    if ((await hours.count()) === 0) test.skip(true, 'no hour dimension: the busiest-times card is cut');
    const box = (await hours.boundingBox())!;
    expect(box.width / 24).toBeGreaterThanOrEqual(1);
  });
});
```

`channel`, `luminance` and `contrast` are the helpers `e2e/blog-controls.spec.ts` already carries; lift them into a shared `e2e/contrast.ts` and import from both rather than copying.

- [ ] **Step 3: Extend the existing brand-contrast sweep to this screen**

`e2e/brand-contrast.spec.ts` sweeps every text node. **Run it** and confirm its route list reaches `/edit/manage/numbers` with a populated payload; if it does not, add that route. Every new caption, axis label and stat label added in Tasks 17–22 is inside its scope, and `text-gray-500` on white (the caption colour throughout) is 4.60:1 — above AA, and **not** to be moved onto a wash (backlog item 10, Task 24).

- [ ] **Step 4: The CSS ceiling audit**

One accounting of everything Tasks 17–22 added, following the six-step procedure at the top of this tier. The parent commit for the diff is the commit **before Task 17**, in a **worktree**, not a stash. Every added rule is traced to the className and file that emitted it, and the ledger entry in `src/test/bundle.post-build.test.ts` names each.

If a task above already raised the ceiling, this task does **not** raise it again — it verifies that the accumulated total is what those raises accounted for, and corrects the ledger where a raise attributed a rule to the wrong file.

- [ ] **Step 5: `npm run build && npm run test:e2e -- numbers-visuals brand-contrast`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| remove `preserveAspectRatio="none"` and give the svg a fixed pixel width larger than the card | "the trend chart is drawn inside its card" | — |
| `barPercents` divides by the sum | "the page bars are proportional to their values" | — |
| remove `w-full` from `BarList`'s track | the same test — the ratio collapses to 1:1 | This is the **only** assertion in the plan that can see it. jsdom's style-attribute test stays green. |
| set the range pills to `px-1 py-0` | "no range button overlaps another, and each is a real target" | — |
| set the pressed pill's text to `text-brand` | "the pressed range reads as ink on brand, above 4.5:1" | If only the `toHaveCSS` equality fails and the contrast helper does not, the helper is not being called — it is Step 2's last two lines and it is the row's real point. |
| read the pressed pill's colour with one `evaluate(getComputedStyle)` immediately after a click | the same test **passes on a defect** | Which is why every transitioning colour is read with `toHaveCSS`. Rule 3 of `e2e/README.md`. |
| give the busiest-times chart a fixed 24px width | "every cell is at least one full pixel wide" | If the card is CUT, this test **skips** — that is correct and is not a silent pass. |
| add a wide unwrapped element to any card | "nothing on the panel scrolls sideways" | — |
| lower the CSS ceiling below the measured value | `src/test/bundle.post-build.test.ts`'s own assertion, on the next `npm run build` | — |

**CSS ceiling:** **this is the task that settles it.** No new markup is added here; this is the audit. The number that lands in `bundle.post-build.test.ts` at the end of this task is the plan's final entry CSS ceiling, and it is a measured number with a per-rule ledger behind it.

**If this task is wrong:** a chart runs off the side of the card on her phone, a range button is too small to hit, or a caption is unreadable — none of which any jsdom test in this plan can see.

---
# Tier 3 — The backlog, closed out

Nothing here can invalidate anything above it: no task below touches `worker/analytics.ts`, `worker/campaign.ts`, `worker/analytics-store.ts`, the payload contract, or any Numbers component. The one exception is called out in Task 30 and carries an explicit re-run instruction and a one-commit rule.

---

## Task 24: The washes — a lightness ladder, not a hue swap

**Closes backlog items 8, 9 and 10.** They are one problem with three symptoms, and the arithmetic is why they are one task: `wash` sits 17.7 points below white and `wash-warm` sits 18.0. Two colours of equal lightness cannot make a boundary, whatever hues they carry. Fixing 8 without fixing 9 only moves which pair is invisible.

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/components/Drinks.tsx`, `Experiences.tsx`, `OurStory.tsx`, `PlaceGallery.tsx`, `VisitUs.tsx`, `blog/BlogSection.tsx`, `Awards.tsx`, `templates/ItemListSection.tsx`
- Modify: `src/test/palette.test.ts`, `src/test/homepage-bytes.test.tsx`, `src/test/bundle.post-build.test.ts`
- Modify: `e2e/section-washes.spec.ts`, `e2e/brand-contrast.spec.ts`

- [ ] **Step 1: Understand why the current pair fails before changing it**

`wash` `#E6EDF5` and `wash-warm` `#F5EEE4` are each held to a floor **against white** and nothing measures them against each other. Their contrast against one another is 1.02 — a hue-only boundary, which does not exist for a reader with a common colour vision difference and barely exists for anybody in daylight. That is why `experiences→press` and `ourStory→visit` look like no boundary at all, and why Drinks and Experiences sharing a token looks identical to them not sharing one.

- [ ] **Step 2: Add a third token with a real lightness step**

```js
        // THREE washes, and the third exists because two are not enough:
        // `wash` sits 17.7 points below white and `wash-warm` sits 18.0, so
        // any boundary between them is a HUE change with no lightness change
        // -- 1.02:1, which is not a boundary for a colour-blind reader and is
        // barely one for anybody in daylight. `wash-deep` is the same cool
        // family a full step darker, so an adjacent pair always differs by
        // lightness rather than only by hue.
        wash: '#E6EDF5',        // 17.7 points below white
        'wash-warm': '#F5EEE4', // 18.0 points below white
        'wash-deep': '#D6E1EF', // 29.0 points below white
```

- [ ] **Step 3: Assign so no adjacent pair is hue-only**

Walk the homepage order in `src/App.tsx`'s `SECTION_COMPONENTS` (hero, ourStory, atmosphere, food, drinks, experiences, press, awards, visit) once and assign so each boundary is either wash-to-white or a lightness step of at least 8 points. **Write the assignment table into the comment beside the tokens**, because the constraint is about the SEQUENCE and a future section inserted in the middle breaks it silently otherwise. The specific change item 8 names — Drinks and Experiences adjacent and sharing a token — falls out of this walk.

- [ ] **Step 4: Retire `text-gray-500` on every washed surface**

`grep -rn "text-gray-500" src/components/` and replace with `text-gray-600` wherever the surrounding section carries a wash class. `text-gray-600` (#4B5563) measures 6.35:1 on `wash` and 5.8:1 on `wash-deep`; both clear AA with room. **Leave `text-gray-500` alone on white surfaces**, where it already passes at 4.60:1 — this is a targeted fix, not a sweep, and a sweep would move bytes for no benefit.

- [ ] **Step 5: The palette test gains an adjacency floor**

```ts
function pointsBelowWhite(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 255 - (r + g + b) / 3;
}

describe('the section washes', () => {
  it('each reads as a band against white', () => {
    for (const token of ['wash', 'wash-warm', 'wash-deep']) {
      expect(pointsBelowWhite(colors[token])).toBeGreaterThanOrEqual(15);
    }
  });

  it('the cool pair reads as a band against the OTHER one', () => {
    // The whole of backlog item 9. Two tokens each correctly measured against
    // white can still be indistinguishable from each other, and adjacent
    // bands are what a reader actually sees.
    const gap = Math.abs(pointsBelowWhite(colors.wash) - pointsBelowWhite(colors['wash-deep']));
    expect(gap).toBeGreaterThanOrEqual(8);
  });

  it('declares every wash token the components use', () => {
    for (const token of ['wash', 'wash-warm', 'wash-deep']) expect(colors[token]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
```

- [ ] **Step 6: `e2e/section-washes.spec.ts` measures the boundaries, not only the bands**

Its existing per-band loop samples a raw pixel 40px into each section's own padding via `page.screenshot({ clip })` through `sharp`. Add a pass over adjacent pairs, with `expect.soft` like the rest of that file so every boundary is reported rather than the run aborting at the first failure — this task's deliverable **is** the list:

```ts
for (let i = 1; i < samples.length; i += 1) {
  if (samples[i].points < 1 && samples[i - 1].points < 1) continue; // white against white is not a boundary anyone claimed
  expect
    .soft(Math.abs(samples[i].points - samples[i - 1].points), `${samples[i - 1].name} against ${samples[i].name}`)
    .toBeGreaterThanOrEqual(8);
}
```

Keep that file's own disclaimer intact: this is a lightness measurement and must never become a contrast measurement (`e2e/about-byline.spec.ts`'s false positive from sampling glyph-painted pixels is why).

- [ ] **Step 7: Replace item 10's comment with the sweep**

`text-gray-500` is 4.10:1 on a wash and worse on the deepened one. Today only a comment forbids the pairing. Confirm by running that `e2e/brand-contrast.spec.ts` visits `/`, computes each text node's contrast against its **effective** background rather than against white, and holds a 4.5 floor. If it assumes white, fix that — **assuming white is the bug item 10 is really about.** Then replace the prose warning in `tailwind.config.js` with one line: `// The gray-500-on-wash pairing is measured by e2e/brand-contrast.spec.ts, not merely warned about here.`

- [ ] **Step 8: Re-pin `homepage-bytes` with a measured, itemised accounting**

Every className change here is reachable from `/`. Isolate one file's change at a time — restore it to HEAD, rebuild, diff — and write the exact before/after count and the per-file attribution into that file's changelog comment. Estimating is not permitted there and the file says so at length.

- [ ] **Step 9: `npm run build && npm test -- --run src/test/palette.test.ts src/test/homepage-bytes.test.tsx && npm run test:e2e -- section-washes brand-contrast`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| set `wash-deep` equal to `wash` | "the cool pair reads as a band against the OTHER one", and `section-washes`'s adjacent-pair loop | — |
| lighten `wash` to `#F4F7FA` | "each reads as a band against white" | — |
| give Drinks and Experiences the same token again | `section-washes`'s adjacent-pair loop, on that pair | — |
| restore `text-gray-500` on a washed section | `brand-contrast`'s sweep | If the sweep computes against white it stays green. Step 7 is what fixes that, and it is the whole of item 10. |
| lower the `pointsBelowWhite` threshold from 8 to 1 | **nothing** — a threshold cannot test itself | **Stated.** Its justification is the measured 1.02:1 finding recorded in the spec's own backlog and repeated in the comment beside the number. Do not invent an assertion for it. |

**CSS ceiling:** **this task adds rules and will move the number.** New utilities: `bg-wash-deep` and any gradient variant of it; `text-gray-600` almost certainly already exists. Both this and `homepage-bytes` get measured, itemised raises in this commit.

**If this task is wrong:** the homepage reads as one long undifferentiated column on a phone — which is the state item 8 describes today — and a visitor with a colour vision difference cannot tell where one part of the restaurant's story ends and the next begins.

---

## Task 25: The blog search field's focus ring

**Closes backlog item 7.** `src/index.css` styles `button:focus-visible` and `a:focus-visible`. An `<input type="search">` is neither, so `/blog`'s search field falls back to Chromium's default ring — a different colour, a different offset, and one that does not clear the 3:1 non-text contrast bar the site's own comment argues for.

**Files:**
- Modify: `src/index.css`
- Modify: `e2e/blog-controls.spec.ts`

- [ ] **Step 1: Extend the selector list**

```css
/* Focus styles for accessibility. This is a non-text UI indicator (WCAG
   1.4.11 Non-text Contrast), which needs 3:1 against what it sits behind --
   a lower bar than body text's 4.5:1, but #C8D8E8 (the brand surface colour)
   is only 1.45:1 against white and fails it outright, so the ring uses the
   accent colour (#9D4949, 6.03:1 against white) instead of the brand tokens
   used everywhere else in this file.

   INPUTS, SELECTS AND TEXTAREAS ARE LISTED TOO, and their absence was a real
   defect: /blog's search field is the one control a reader must focus before
   they can use it, and it fell through to Chromium's own ring -- a different
   colour, a different offset, and not measured against anything. A selector
   list naming only the two elements somebody happened to think of is how
   that happens. */
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid #9D4949;
  outline-offset: 2px;
}
```

- [ ] **Step 2: The assertions, in the file that already computes contrast**

```ts
test('the search field gets the site ring, not the browser default', async ({ page }) => {
  await page.goto('/blog');
  const search = page.locator('#blog-search');
  await search.focus();
  // Computed style, not a class name -- the dev server's JIT can keep a class
  // green that a cold build would never emit.
  await expect(search).toHaveCSS('outline-style', 'solid');
  await expect(search).toHaveCSS('outline-width', '2px');
  await expect(search).toHaveCSS('outline-color', 'rgb(157, 73, 73)');
  await expect(search).toHaveCSS('outline-offset', '2px');
});

test('the ring clears the 3:1 non-text contrast bar against the page', async ({ page }) => {
  await page.goto('/blog');
  const search = page.locator('#blog-search');
  await search.focus();
  const ring = await search.evaluate((el) => getComputedStyle(el).outlineColor);
  const behind = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // Equality alone is not enough: a future palette move could keep both
  // values off-white and still land under 3.
  expect(contrast(ring, behind)).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 3: `npm run build && npm run test:e2e -- blog-controls`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| remove `input:focus-visible` from the selector list | "the search field gets the site ring, not the browser default" | — |
| change the outline to `#C8D8E8` | "the ring clears the 3:1 non-text contrast bar against the page" | — |
| set `outline-offset: 0` | "the search field gets the site ring…" | — |
| assert a class name instead of computed style | **nothing reddens on a JIT-warm dev server** | The reason `e2e/README.md` rule 1 forbids class assertions outright. |

**CSS ceiling:** three selectors added to one existing rule; measured movement roughly **60 bytes** (`input:focus-visible,select:focus-visible,textarea:focus-visible,`). Measure; with 163 bytes of headroom this may or may not fit depending on what Tier 2 already spent. If over, raise by the six-step procedure **in this commit**.

**If this task is wrong:** a reader tabbing through `/blog` on a phone cannot tell which control is focused.

---

## Task 26: Labels that name their block, and the scan that finds the next one

**Closes backlog items 2 and 3.** Two instances of one defect: a label naming the field but not which block it belongs to. A post with a citation shows two controls both labelled "Published on"; a post with two image blocks shows two labelled "Photo". She scrolls, sees the second one, and edits the wrong thing.

**Fixing the two known collisions is not the deliverable.** The general scan is, because it catches the next one without anybody looking for it.

**Files:**
- Modify: `src/admin/blocks/BlockFields.tsx`, `src/admin/writing/WritingSurface.tsx`
- Modify: `src/admin/blocks/__tests__/BlockFields.test.tsx`
- Create: `src/admin/__tests__/duplicate-labels.test.tsx`

- [ ] **Step 1: Give the citation date its own name**

```ts
// NOT "Published on". A post's own date field already owns that phrase, and a
// post with a citation block puts the two controls on one screen with one
// name between them -- so a screen reader reading the label alone cannot tell
// "when I published this" from "when the magazine published theirs", and
// neither can she.
const CITATION_DATE_SPEC = { label: 'Date on the original', kind: 'date' } satisfies FieldSpec<string>;
```

- [ ] **Step 2: Take an ordinal, and use it in exactly two places**

Add `ordinal?: number` to `BlockFieldsProps` — "which block this is among the blocks of its own kind, 1-based; absent means the only one of its kind, which is the common case and renders the bare label."

```tsx
// "Photo", "Photo 2", "Photo 3" -- numbered only when there is something to
// distinguish it from, so the overwhelmingly common single-photo post keeps
// the plain word. "Photo 1" on a post with one photo is worse than "Photo",
// because the number implies a second one.
//
// The number counts blocks OF THE SAME KIND, not blocks: "Photo 2" in a post
// whose photo blocks are the third and ninth block is still the second photo
// she added, which is how she thinks about it.
export function numbered(base: string, ordinal: number | undefined): string {
  return ordinal === undefined || ordinal <= 1 ? base : `${base} ${String(ordinal)}`;
}
```

used as `label={numbered('Photo', ordinal)}` on the image branch and `spec={{ ...CITATION_DATE_SPEC, label: numbered(CITATION_DATE_SPEC.label, ordinal) }}` on the citation branch.

- [ ] **Step 3: Compute it in `WritingSurface.tsx`'s row renderer**

```tsx
          // 1-based position among the blocks of this same kind. Recomputed
          // per render off the array rather than stored, because a block
          // moved or removed changes it and a stored number would go stale
          // silently -- the same failure mode stable-names.ts exists to
          // prevent for staged photos, one level up.
          ordinal={safe.slice(0, row.index + 1).filter((block) => block.kind === row.block.kind).length}
```

- [ ] **Step 4: The scan that would have found both**

```tsx
// src/admin/__tests__/duplicate-labels.test.tsx
//
// The general guard, not a spot fix. Backlog items 2 and 3 are two instances
// of one defect and there is no reason to believe they are the last two: a
// label that names its field but not its block collides the moment a post has
// two blocks of one kind. This test does not know about photos or citations.
it('no two controls in one editor share a visible label', async () => {
  renderDashboard('/edit/manage/story');
  await openPostEditor(postWithTwoPhotosAndACitation);
  const labels = [...document.querySelectorAll('label')].map((node) => node.textContent?.trim() ?? '');
  const seen = new Set<string>();
  const duplicated = labels.filter((text) => text !== '' && (seen.has(text) || (seen.add(text), false)));
  expect(duplicated).toEqual([]);
});
```

- [ ] **Step 5: Fix the existing fixture at `BlockFields.test.tsx:232`**, which asserts `getByLabelText('Published on')` on a citation. Re-point it to `'Date on the original'`. **If it still passes unchanged, Step 1 did not land.**

- [ ] **Step 6: Re-read comments for bare utility-class tokens.**

- [ ] **Step 7: `npx tsc -b --noEmit && npm test -- --run src/admin/blocks/__tests__/ src/admin/__tests__/duplicate-labels.test.tsx`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| restore `label: 'Published on'` on the citation | "no two controls in one editor share a visible label", and `BlockFields.test.tsx:232` | — |
| `numbered` returns `base` unconditionally | "no two controls in one editor share a visible label" (two "Photo" labels) | — |
| `ordinal <= 1` → `ordinal < 1` | a new `BlockFields.test.tsx` case, "one photo block is just Photo" — the first would read "Photo 1" | Add that case; the scan alone cannot see it, because "Photo 1" is not a duplicate of anything. |
| the ordinal counts all blocks, not same-kind | a new case, "the second photo in a post is Photo 2, whatever sits between them" | — |
| `.slice(0, row.index + 1)` → `.slice(0, row.index)` | the same case — every count comes out one low | — |
| add a THIRD colliding label somewhere else in the editor | "no two controls in one editor share a visible label" | This is the row that justifies the scan over two spot fixes. If it does not redden, the fixture post does not render the new control; extend the fixture, not the assertion. |

**CSS ceiling:** zero bytes. Label text is content, not class. If the number moves, a word in the comments above is being scanned.

**If this task is wrong:** she types the magazine's publication date into her own post's date field, or replaces the wrong photograph, and publishes it.

---

## Task 27: Validation banners that name their record

**Closes backlog item 4.** "A dish needs a name" without saying which dish is unactionable on a list of thirty.

**Files:**
- Modify: `src/admin/problems.ts`, `src/admin/RecordList.tsx`
- Modify: `src/admin/__tests__/problems.test.ts`

- [ ] **Step 1: A banner line names its record**

```ts
// A problem's message says what is wrong; a banner line has to say WHICH
// record it is wrong on, because the record's own field is not on screen when
// the banner is -- the list shows rows, not forms.
//
// The name comes from the record where it has one. A record with no name yet
// -- which is the most common way to reach this message at all -- is
// identified by its position instead, because "the 4th one" is something she
// can count to and "" is not.
export function bannerLine(problem: ValidationProblem, recordName: string | undefined, index: number): string {
  const who = recordName !== undefined && recordName.trim() !== '' ? recordName : `the ${ordinal(index + 1)} one`;
  return `${who}: ${problem.message}`;
}

// 1st, 2nd, 3rd, 4th... spelled out rather than through Intl.PluralRules,
// which is a locale-dependent answer to a question that is not about locale --
// this admin surface is English and the ordinals are four cases.
function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${String(n)}th`;
  switch (n % 10) {
    case 1:
      return `${String(n)}st`;
    case 2:
      return `${String(n)}nd`;
    case 3:
      return `${String(n)}rd`;
    default:
      return `${String(n)}th`;
  }
}
```

- [ ] **Step 2: The banner uses it.** Wherever the list-level `role="alert"` banner maps over its problems, each line becomes `bannerLine(problem, record?.name, index)`. The partition guarantee `RecordForm.tsx:146-159` documents is untouched — a problem is still in the banner or in the open editor, never both and never neither.

- [ ] **Step 3: The tests**

```ts
describe('bannerLine', () => {
  it('names the record when it has a name', () => {
    expect(bannerLine({ message: 'A dish needs a name.' } as ValidationProblem, 'Aglio e Pepperoncini', 0)).toBe(
      'Aglio e Pepperoncini: A dish needs a name.',
    );
  });

  it('counts to the record when its name is only whitespace', () => {
    // Which is exactly the case that produces "A dish needs a name" -- so the
    // naming fix has to work when there is no usable name.
    expect(bannerLine({ message: 'A dish needs a name.' } as ValidationProblem, '   ', 3)).toBe(
      'the 4th one: A dish needs a name.',
    );
  });

  it('counts to it when the name is missing entirely', () => {
    expect(bannerLine({ message: 'A dish needs a name.' } as ValidationProblem, undefined, 0)).toBe(
      'the 1st one: A dish needs a name.',
    );
  });

  it.each([
    [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'],
    [11, '11th'], [12, '12th'], [13, '13th'],
    [21, '21st'], [22, '22nd'], [111, '111th'],
  ])('counts %i as %s', (n, expected) => {
    expect(bannerLine({ message: 'x' } as ValidationProblem, '', n - 1)).toBe(`the ${expected} one: x`);
  });
});
```

- [ ] **Step 4: Re-read comments for bare utility-class tokens.**

- [ ] **Step 5: `npx tsc -b --noEmit && npm test -- --run src/admin/__tests__/`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| return `problem.message` unchanged | all four | — |
| use `index` rather than `index + 1` | "counts to the record when its name is only whitespace" | — |
| drop the whitespace check on the name | "counts to the record when its name is only whitespace" | The `'   '` fixture is what makes this row falsifiable; an `''` fixture would stay green. It is in Step 3 for that reason. |
| drop the 11–13 special case | the ordinal table's 11, 12, 13 rows | — |

**CSS ceiling:** zero bytes. Message strings only.

**If this task is wrong:** she gets a banner listing four problems on a list of thirty dishes and has to open every one to find them.

---

## Task 28: Staged photo bytes, and the stale thumbnail

**Closes backlog items 5 and 6, and turns Task 11's `test.fail()` green.**

**Files:**
- Modify: `src/admin/RecordList.tsx` (and every list whose delete path drops a record), `src/admin/PhotoField.tsx`
- Modify: `src/admin/__tests__/staged.test.ts`
- Modify: `e2e/publish-write.spec.ts` (remove the `test.fail()` marker)

- [ ] **Step 1: Deleting a record releases its staged bytes**

The staged map is keyed by field key; a delete removes the record from the content array and leaves the map entry behind, where it keeps occupying one of the eight slots `MAX_STAGED_PHOTOS_PER_PUBLISH` allows **and is still sent in the request body**.

```tsx
// A deleted record's staged photo goes with it. Without this the bytes stay
// in the map, occupy one of the eight slots a publish allows, and are still
// SENT -- an upload for a record nothing references any more.
//
// stage(key, null), not clearSent: this is the "whatever is at that key now
// is stale" case that stage's own contract names, and there is no in-flight
// request whose identity could be confused with it. clearSent's identity
// matching is for the publish-SUCCESS path.
function releaseStagedFor(record: { id: string }): void {
  for (const key of stagedKeysFor(record.id)) stage(key, null);
}
```

`stagedKeysFor(id)` returns every key the record's fields could have staged under, **derived from the same key-building function the fields themselves use** and not re-spelled, so the two cannot disagree.

- [ ] **Step 2: `PhotoField` reads its preview from the shared store**

`PhotoField.tsx` computes `previewSrc = previewUrl ?? value ?? null` — local state, then the committed value, never the shared store. Reopening the editor remounts the component, `previewUrl` starts null, `value` is the *old* committed path, and the tile shows a stale thumbnail while the correct bytes sit in `previews` under `previewKey`.

```tsx
  // Three sources, in order of how recently each was true:
  //   1. this component's own just-picked object URL;
  //   2. the SHARED preview store, which survives this component being
  //      unmounted and remounted -- the whole of backlog item 6: reopening an
  //      editor remounted this, reset (1) to null, and fell through to (3),
  //      which is the value from BEFORE the pick;
  //   3. the committed value.
  // The bytes were never at risk; the picture was.
  const previewSrc = previewUrl ?? (previewKey !== undefined ? previews.get(previewKey) : null) ?? value ?? null;
```

- [ ] **Step 3: The tests**

```tsx
it('a deleted record releases its staged photo', () => {
  const { staged, deleteRecord } = renderListWithStagedPhoto('dish-3');
  expect(Object.keys(staged.files)).toContain('dishes:dish-3:image');
  deleteRecord('dish-3');
  expect(Object.keys(staged.files)).not.toContain('dishes:dish-3:image');
});

it("a deleted record does not release another record's staged photo", () => {
  const { staged, deleteRecord } = renderListWithStagedPhotos(['dish-3', 'dish-4']);
  deleteRecord('dish-3');
  expect(Object.keys(staged.files)).toEqual(['dishes:dish-4:image']);
});

it('a reopened editor shows the photo she just picked, not the one before it', () => {
  const previews = new Map([['dishes:dish-3:image', 'blob:new-pick']]);
  const { rerender } = render(<PhotoField value="/food/old.webp" previews={asPreviews(previews)} previewKey="dishes:dish-3:image" />);
  rerender(<div />); // closing the editor
  rerender(<PhotoField value="/food/old.webp" previews={asPreviews(previews)} previewKey="dishes:dish-3:image" />);
  expect(screen.getByRole('presentation')).toHaveAttribute('src', 'blob:new-pick');
});

it('prefers her just-picked photo over the store, when both exist', () => {
  // The ordering, not just the presence. Reading the store first would show
  // the previous pick for one render after every new one.
  const previews = new Map([['dishes:dish-3:image', 'blob:older']]);
  render(<PhotoField value="/food/old.webp" previews={asPreviews(previews)} previewKey="dishes:dish-3:image" localPreview="blob:just-picked" />);
  expect(screen.getByRole('presentation')).toHaveAttribute('src', 'blob:just-picked');
});

it('falls back to the committed value when the store has nothing', () => {
  render(<PhotoField value="/food/old.webp" previews={asPreviews(new Map())} previewKey="dishes:dish-3:image" />);
  expect(screen.getByRole('presentation')).toHaveAttribute('src', '/food/old.webp');
});
```

- [ ] **Step 4: Remove the `test.fail()` marker from `e2e/publish-write.spec.ts` and run it**

That test — "a record deleted before publishing takes its staged photo bytes with it" — is the only assertion in this repository that has ever inspected a publish body, and it is what proves Step 1 rather than a unit test over a map. Its sibling, "a photo she keeps IS on the wire", is what stops it passing because the body carries no uploads at all.

- [ ] **Step 5: Re-read comments for bare utility-class tokens.**

- [ ] **Step 6: `npx tsc -b --noEmit && npm test -- --run src/admin/__tests__/ && npm run test:e2e -- publish-write`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| remove `releaseStagedFor` from the delete path | "a deleted record releases its staged photo", **and** `publish-write`'s deleted-record test | The jsdom test alone is a test over a map — the same shape of assertion the bug survived three times. The e2e row is the one that matters. |
| clear the whole staged map on any delete | "a deleted record does not release another record's staged photo" | — |
| restore `previewUrl ?? value ?? null` | "a reopened editor shows the photo she just picked, not the one before it" | — |
| read the store BEFORE the local pick | "prefers her just-picked photo over the store, when both exist" | That case is in Step 3 for this row; without it the ordering is untested. |

**CSS ceiling:** zero bytes. No markup or class changes.

**If this task is wrong:** she deletes a dish, publishes, and the deploy carries an upload for a dish that no longer exists — or she replaces a photo, reopens the editor, sees the old one, and replaces it again.

---

## Task 29: The writing surface's three list defects

**Closes backlog items 11, 12 and 13.** They are one task because they are one invariant: `items` and `levels` are parallel arrays and every operation over them must keep them the same length. Two of the three are that invariant broken from different directions; the third is the invariant not being applied at all.

**Files:**
- Modify: `src/admin/writing/WritingSurface.tsx` (`asKind`), `src/admin/writing/structure.ts` (Backspace), `src/admin/blocks/BlockFields.tsx` (`itemList`)
- Modify: the matching `__tests__` files

- [ ] **Step 1: `asKind` carries nesting across a conversion**

```ts
// Converting a list from bulleted to numbered (or back) must not flatten it.
// `levels` is a parallel array to `items`, and a conversion that rebuilds the
// block from `items` alone silently drops every indent she made -- work that
// cannot be recovered by undoing the conversion, because the levels are
// already gone from the array.
function asKind(block: Block, kind: ToolbarKind | 'paragraph'): Block {
  if (block.kind === 'list' && (kind === 'list' || kind === 'orderedList')) {
    // Same items, same levels, different ordered flag. Nothing is rebuilt.
    return { ...block, ordered: kind === 'orderedList' };
  }
  // ... existing conversions, unchanged
}
```

- [ ] **Step 2: Backspace at the start of a nested item outdents**

```ts
// Backspace at offset 0 of a list item:
//   level > 0  -> outdent by one, and do NOT merge. This is what every editor
//                 does, and its absence is why an indented item could only be
//                 un-indented with Shift+Tab, which nobody guesses.
//   level == 0 -> the existing behaviour: merge into the previous item, or
//                 demote the list to a paragraph if it is the first.
export function backspaceAtStart(blocks: Block[], index: number, item: number): Block[] {
  const block = blocks[index];
  if (block.kind !== 'list') return mergeIntoPrevious(blocks, index);
  const level = block.levels?.[item] ?? 0;
  if (level > 0) {
    const levels = [...(block.levels ?? block.items.map(() => 0))];
    levels[item] = level - 1;
    return blocks.map((candidate, i) => (i === index ? { ...candidate, levels } : candidate));
  }
  return mergeIntoPrevious(blocks, index);
}
```

- [ ] **Step 3: `itemList` cannot desync `levels` from `items`**

Make it structurally impossible instead of validated afterwards. "Refused at the write boundary" means she loses the edit with a message about a shape she never saw.

```tsx
// items and levels move together or not at all. The previous signature took
// items alone and committed them alone, which meant every caller had to
// remember to carry levels -- and the one that forgot produced a block the
// write boundary refuses, which reads to her as "your edit was rejected" with
// no way to see why.
function itemList(
  items: string[],
  levels: number[],
  noun: string,
  commit: (next: { items: string[]; levels: number[] }) => void,
): React.ReactNode {
```

Every call site passes `block.levels ?? block.items.map(() => 0)` and commits both. A caller that passes one and not the other is a `tsc` error, which is the point.

- [ ] **Step 4: The tests**

```ts
describe('asKind', () => {
  it('keeps nesting when a bulleted list becomes numbered', () => {
    const list = { kind: 'list', ordered: false, items: ['a', 'b', 'c'], levels: [0, 1, 1] };
    expect(asKind(list, 'orderedList')).toEqual({ ...list, ordered: true });
  });

  it('keeps nesting in the other direction too', () => {
    expect(asKind({ kind: 'list', ordered: true, items: ['a', 'b'], levels: [0, 1] }, 'list').levels).toEqual([0, 1]);
  });
});

describe('backspaceAtStart', () => {
  it('outdents a nested item instead of merging it', () => {
    const blocks = [{ kind: 'list', ordered: false, items: ['a', 'b'], levels: [0, 1] }];
    expect(backspaceAtStart(blocks, 0, 1)[0].levels).toEqual([0, 0]);
    expect(backspaceAtStart(blocks, 0, 1)[0].items).toEqual(['a', 'b']);
  });

  it('merges a top-level item, as it always did', () => {
    const blocks = [{ kind: 'list', ordered: false, items: ['a', 'b'], levels: [0, 0] }];
    expect(backspaceAtStart(blocks, 0, 1)[0].items).toEqual(['ab']);
  });

  it('treats a list with no levels array as all top level', () => {
    const blocks = [{ kind: 'list', ordered: false, items: ['a', 'b'] }];
    expect(backspaceAtStart(blocks, 0, 1)[0].items).toEqual(['ab']);
  });
});

describe('itemList', () => {
  it('commits items and levels together', () => {
    const commit = vi.fn();
    renderItemList(['a', 'b'], [0, 1], commit);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(commit).toHaveBeenCalledWith({ items: ['a', 'b', ''], levels: [0, 1, 0] });
  });

  it('keeps the two arrays the same length however the list is edited', () => {
    const commit = vi.fn();
    renderItemList(['a', 'b', 'c'], [0, 1, 2], commit);
    fireEvent.click(screen.getAllByRole('button', { name: /Remove/ })[1]);
    const next = commit.mock.calls[0][0];
    expect(next.items).toHaveLength(next.levels.length);
    expect(next.levels).toEqual([0, 2]);
  });
});
```

- [ ] **Step 5: Re-read comments for bare utility-class tokens.**

- [ ] **Step 6: `npx tsc -b --noEmit && npm test -- --run src/admin/writing/__tests__/ src/admin/blocks/__tests__/`**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| rebuild the list from `items` alone in `asKind` | "keeps nesting when a bulleted list becomes numbered" | — |
| remove the `level > 0` branch | "outdents a nested item instead of merging it" | — |
| always outdent, never merge | "merges a top-level item, as it always did" | — |
| default a missing `levels` to `[1, 1, …]` | "treats a list with no levels array as all top level" | — |
| commit `items` without `levels` in `itemList` | "commits items and levels together" | `tsc` refuses it first, which is the stronger guard and the reason the signature changed. |
| splice `items` without splicing `levels` | "keeps the two arrays the same length however the list is edited" | — |

**CSS ceiling:** zero bytes.

**If this task is wrong:** she indents a list, converts it to numbered, and every indent is gone with no undo that brings it back.

---

## Task 30: Dead code, a request ceiling, and two fixture assumptions

**Closes backlog items 15, 16, 17, 18 and 20.** Five small things, grouped because each is a few lines and none interacts with the others — except item 17, which is last for a reason and carries a one-commit rule.

**Files:**
- Delete: `src/admin/blocks/BlockList.tsx` and its test (item 16)
- Delete: `src/content/press.json`, the `/edit/manage` Press panel and its test (item 17)
- Modify: `worker/github.ts` (item 18)
- Modify: `src/components/blog/__tests__/posts.test.ts` (item 15)
- Modify: `e2e/edit-backend.ts` and whichever specs assume the first committed post's shape (item 20)
- Modify: `src/admin/content.ts`, `src/test/hosting.test.ts`, `src/test/bundle.post-build.test.ts`

- [ ] **Step 1 (item 16): Prove `BlockList` is unreferenced, then delete it**

```
grep -rn "BlockList" src/ e2e/ scripts/ worker/ | grep -v "^src/admin/blocks/BlockList"
```

Every remaining hit must be a comment or a test of the file itself. If a live import exists, **this step stops and reports** — the plan does not delete a mounted component. Then:

```
rm src/admin/blocks/BlockList.tsx src/admin/blocks/__tests__/BlockList.test.tsx
npx tsc -b --noEmit
```

`noUnusedLocals` is on, so anything `BlockList` was the last consumer of becomes a hard build failure. **Those are the real work of this step.** Follow each one to its own last call site rather than adding a re-export to silence it.

- [ ] **Step 2 (item 18): `worker/github.ts` gets a ceiling**

Nine `fetch` calls have no `AbortSignal`, so a hung GitHub request has no bound and holds a Worker invocation until the platform kills it. Every other outbound call in this Worker already carries one.

```ts
// The same bound handleBuildStatus and handleAnalytics already use. A publish
// is several of these in sequence, so the ceiling is per REQUEST, not per
// publish -- which is right: a hung request is what this bounds, and a
// slow-but-progressing publish must not be cut off partway through a write.
const GITHUB_TIMEOUT_MS = 10_000;

function ghFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
}
```

Every one of the nine call sites becomes `ghFetch(...)`. An abort lands in whatever `catch` that call already has; **confirm each one has a `catch` rather than assuming it**, because an unhandled abort is a 500 where the existing code returns a message.

```ts
it('gives up on a GitHub request that never answers', async () => {
  vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((resolve, reject) => {
    (init.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  })));
  vi.useFakeTimers();
  const promise = readContent(env, 'src/content/dishes.json');
  await vi.advanceTimersByTimeAsync(11_000);
  await expect(promise).rejects.toThrow();
});

it('passes an abort signal on every GitHub call', () => {
  // Cheaper and stronger than nine separate timeout tests: the defect was
  // "some calls have one", so what is asserted is that none do not.
  expect(readFileSync('worker/github.ts', 'utf8')).not.toMatch(/await fetch\(/);
});
```

- [ ] **Step 3 (item 15): `visiblePosts` gets a non-mutation test**

It hands the live content array into `orderedPosts` on first paint, safe today only because both branches happen to copy. That is a property nothing asserts.

```ts
it('never mutates the array it was given', () => {
  const posts = [article('b'), article('a'), article('c')];
  const before = [...posts];
  visiblePosts(posts, 'all', '', 'newest');
  expect(posts).toEqual(before);
});

it('returns a different array object, not the one it was given', () => {
  const posts = [article('a')];
  expect(visiblePosts(posts, 'all', '', 'newest')).not.toBe(posts);
});

it('does not mutate even when nothing is filtered or sorted', () => {
  // The case actually at risk: an identity-shaped call is the one a future
  // in-place `sort()` would slip through.
  const posts = [article('a'), article('b')];
  const before = [...posts];
  visiblePosts(posts, 'all', '', 'oldest');
  expect(posts).toEqual(before);
});
```

- [ ] **Step 4 (item 20): The browser suite stops assuming the first post's shape**

```ts
// e2e/edit-backend.ts
// The suite must not depend on WHICH post is first -- a new post landing at
// the top of posts.json broke block-label assertions once and would again.
// Find a post with the shape the assertion needs, and fail loudly and
// specifically if none exists rather than asserting against whatever is at
// index 0.
export function postWithBlocks(kinds: string[]): { slug: string; title: string } {
  const posts = JSON.parse(realContentJson('posts.json')) as Array<{
    slug: string;
    title: string;
    blocks: Array<{ kind: string }>;
  }>;
  const found = posts.find((post) => kinds.every((kind) => post.blocks.some((block) => block.kind === kind)));
  if (!found) throw new Error(`no committed post has all of: ${kinds.join(', ')}`);
  return { slug: found.slug, title: found.title };
}
```

Every spec that reached for the first post calls `postWithBlocks(['paragraph', 'citation'])` instead.

- [ ] **Step 5 (item 17): Retire the Press panel and `press.json` — LAST, and BOTH lists in ONE commit**

**This is the one task in the plan that can invalidate an earlier one**, because removing a name from `e2e/edit-backend.ts`'s `CONTENT_FILES` changes what every spec using `mockEditBackend` renders — including Tasks 10, 11 and 23.

`press.json` is referenced by `src/admin/content.ts`'s `CONTENT_FILES`, `EditMode.tsx`, `fields.ts`, `problems.ts`, `useValidation.ts`, `RecordForm.tsx`, `AwardsArea.tsx`, `StoryPhotosArea.tsx`, `BlockFields.tsx`, `dashboardFixtures.ts`, `e2e/edit-backend.ts`'s own `CONTENT_FILES`, and `src/test/homepage-bytes.test.tsx`.

1. Remove the Press panel from the area registry and delete its component and test.
2. **Remove `'press.json'` from `src/admin/content.ts`'s `CONTENT_FILES` AND from `e2e/edit-backend.ts`'s `CONTENT_FILES`, in ONE commit.** A name left in the e2e list with no file behind it makes `realContentJson` throw at setup and **every** spec using `mockEditBackend` fails; a name removed from `src/` but left in `e2e/` does the same. Neither list may move without the other.
3. `rm src/content/press.json`.
4. `npx tsc -b --noEmit` — `noUnusedLocals` and the union types find every remaining reference.
5. Check nothing public reads it: `grep -rn "press.json\|/blogs" src/components/ public/`. `labelForPath` maps `/blogs` to "Press" for historical analytics rows and that mapping **stays** (real visits landed there before the redirect), and `public/_redirects` keeps its 301. Deleting the content file does not delete the history of the URL.
6. `npm test -- --run` in full, then **`npm run test:e2e` in full**, not filtered.
7. `src/test/homepage-bytes.test.tsx` moves if anything reachable from `/` rendered press content. Measure the new count by isolating this change alone and record the exact before/after with an itemised accounting in that file's changelog comment. **Do not estimate it.** If the movement cannot be isolated to this change, **stop and revert this step**: an unexplained byte movement on the public homepage is exactly the class of change this project's rules refuse, and item 17 is a tidy-up not worth an unexplained diff.

- [ ] **Step 6: The whole gate, once, at the end of the plan**

```
npx tsc -b --noEmit && npx eslint . && npm test -- --run && npm run test:deploy && npm run build && npm run test:e2e
```

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| restore a bare `await fetch(` in `worker/github.ts` | "passes an abort signal on every GitHub call" | — |
| make `orderedPosts` sort in place | "never mutates the array it was given", "does not mutate even when nothing is filtered or sorted" | — |
| return the input array unchanged from `visiblePosts` | "returns a different array object, not the one it was given" | — |
| have `postWithBlocks` return `posts[0]` | the specs using it | Only once a post without a citation is first. Add one to a scratch copy of `posts.json` and run; that is the check. |
| remove `'press.json'` from `src/admin/content.ts`'s list only | the full e2e run — every `mockEditBackend` spec, with "Could not load press.json" painted above the content | — |
| remove it from `e2e/edit-backend.ts`'s list only | the full e2e run — `realContentJson('press.json')` throws at setup | — |
| remove `/blogs` from `labelForPath` | `analytics.test.ts`'s "/blogs is still Press" | — |
| restore `BlockList.tsx` | **nothing reddens** | Accepted: deleting dead code has no assertion, and `tsc` plus the build is the only guard it needs. |
| delete `BlockList.tsx` but add a re-export to silence `tsc` | **nothing reddens** | Stated: enforced by review. `noUnusedLocals` catches an unused local, not a deliberate re-export. |

**CSS ceiling:** deleting `BlockList.tsx` and the Press panel **removes** classes from Tailwind's scan, so the entry CSS should get *smaller*. Measure it, and **do not lower the ceiling** — a ceiling with more headroom than it needs costs nothing, and lowering it is how a build goes red on the next unrelated change. Record the new measured size in the ledger with a note that the ceiling was deliberately left where it was, so the freed headroom is visible to the next reader rather than immediately spent.

**If this task is wrong:** she opens `/edit/manage` and every panel says "Could not load", because one of the two `CONTENT_FILES` lists was edited and the other was not — a total outage of her editing tool, from a cleanup task. That is why Step 5 insists on one commit.

---

# The backlog, closed out

Every item from the spec's table, and the task that closes it. **Nothing is written off** — all twenty-one have a task, and each task states what breaks for the owner if it is wrong.

| # | Item | Closed by |
|---|---|---|
| 1 | The panel says visitor counting began 7 August 2026 | **Task 3** — `TAP_COUNTING_STARTED_ON` and `VISIT_COUNTING_STARTED_ON`, with the default argument removed from `formatCountingStartedOn` so `tsc` refuses any call site that does not name which it means |
| 2 | Two controls both labelled "Published on" | **Task 26** — the citation's date becomes "Date on the original", plus the general duplicate-label scan |
| 3 | Two image blocks produce two "Photo" labels | **Task 26** — numbered by position among photos, unnumbered when there is only one, plus the same scan |
| 4 | Validation banner lines do not name their record | **Task 27** — `bannerLine` names the record, or counts to it when it has no usable name |
| 5 | Deleting a record does not release its staged photo bytes | **Task 28** — `releaseStagedFor`, proven by **Task 11**'s assertion on the publish request's `postData` |
| 6 | A gallery tile shows a stale thumbnail after the editor is reopened | **Task 28** — `PhotoField` reads the shared preview store between its local pick and the committed value |
| 7 | The `/blog` search field's focus ring is Chromium's | **Task 25** — `input`, `select` and `textarea` join the `:focus-visible` rule, with the ring measured against 3:1 |
| 8 | Drinks and Experiences share a wash token | **Task 24** — a walked assignment with no adjacent pair sharing a token, and the adjacency measured |
| 9 | Two washes are a hue-only boundary at 1.02 | **Task 24** — a lightness ladder with a third token, plus an adjacent-pair floor in both the palette test and `section-washes.spec.ts` |
| 10 | `text-gray-500` on a wash is 4.10:1, guarded only by a comment | **Task 24** — the comment is replaced by `brand-contrast.spec.ts`'s sweep, computing against the **effective** background rather than white |
| 11 | `asKind` flattens a list to one item | **Task 29** — a list-to-list conversion changes `ordered` and rebuilds nothing |
| 12 | Backspace at the start of a nested item does not outdent | **Task 29** — `backspaceAtStart` outdents above level 0 and merges at 0 |
| 13 | `BlockFields.itemList` can desync `levels` from `items` | **Task 29** — the signature takes and commits both, so a desync is a `tsc` error |
| 14 | `playwright.config.ts` is `fullyParallel` with no cap and no retries | **Task 2** — and it is Task **2**, not Task 30, because every other task's green depends on it |
| 15 | `visiblePosts` has no non-mutation test | **Task 30** |
| 16 | `BlockList.tsx` sits on disk unreferenced | **Task 30** — deleted, with `grep` first and `tsc` as the audit |
| 17 | An orphaned `/edit/manage` Press panel, and `press.json` | **Task 30**, last step, both `CONTENT_FILES` lists in one commit, with a full browser-suite re-run |
| 18 | `worker/github.ts` sets no `AbortSignal` | **Task 30** — one `ghFetch` wrapper, asserted by forbidding a bare `await fetch(` in that file |
| 19 | Nothing in `e2e/` observes a publish | **Task 11** — `observeRequests` reads `page.on('request')`, and the assertions read `postData` rather than what a remount reports |
| 20 | The browser suite depends on the first committed post's shape | **Task 30** — `postWithBlocks(kinds)` searches for the shape and throws a named error when nothing has it |
| 21 | The analytics GraphQL query has never been run against the real API | **Task 1** — introspection, the recorded document, the typed constant, and the drift guard between them |

**Written off rather than fixed: nothing.** Every item has a task.

---

# What the spec asked for, and where it landed

| Spec requirement | Task |
|---|---|
| Trend chart (the hero graphic) | 13 (its source), 16 (geometry), 17 (drawn), 23 (measured) |
| Top pages and referrers as bar lists | 16, 18, 23 |
| Stat cards with a comparison against the previous period | 5, 19 |
| Busiest times | 15 (built or cut), 21 (drawn or cut), 23 (measured or skipped) |
| Tagged links, and the once-per-arrival guard | 8 (server), 9 (browser), 10 (observed) |
| "Once per arrival, never once per page", proven | 10 (one arrival + four asserted router transitions = one request; refresh = none) plus 8 ("four arrivals write four rows") |
| Unknown sources grouped, not listed | 8 (collapsed at the write boundary), 20 (one row on the card) |
| A tag is not a referrer, said on the card | 20 |
| What the campaign card cannot tell her, said on the card | 20 |
| The range control (7, 30, 90, and by year once the archive has filled) | 4 (contract + keyed cache), 14 (year), 22 (control, with the By-year button hidden until `yearAvailable`) |
| The 10-minute cache keys on the range rather than being bypassed | 4 |
| History that outlives Cloudflare | 6 (schema), 7 (statements), 13 (nightly job), 14 (by year) |
| The first year is partial and the panel says so | 6 (`complete`), 7 (computed), 14 (carried), 17 (the asterisk and the caption) |
| Counting semantics — a page view, a visit, a tagged visit | 3 (the two start dates), 4 (the contract's comments), 8/9 (arrival, not page view), 20 (the card's caveat) |
| Verification is task one and recorded in the repository | 1 |
| Nothing produces a bill by accident | 6 and 8 (D1 rows, capped and derived), 13 (one cron a day), Global Constraints (no new KV writes) |
| The write path proven end to end, not merely called | 10 and 11 |
| The twenty-one backlog items | the table above |

---

# The two conditional branches, restated

Neither branch changes the payload type, the file list, or any other card. `hourly: AnalyticsHourCell[] | null` and `seriesSource: 'snapshot' | 'backfilled'` are both declared at **Task 4**, before either branch is taken. That is what makes these branches rather than forks.

- **The trend chart's reach** — decided by `RUM_CAPABILITIES.dateDimension`. The chart **always** reads from `daily_visits` (R9), so the only difference is Task 13 Step 7's one-off ninety-day backfill: present, and the line reaches backwards; absent, and the line starts the day the job was switched on and the caption says so. **One optional step, three lines of consequence, no second implementation.**
- **The busiest-times chart** — decided by `RUM_CAPABILITIES.hourDimension`. Present: Task 15 BUILD adds one aliased node and `hourCells`, Task 21 draws it, Task 23 measures it. Absent: Task 15 CUT pins `hourly: null` with a test and records the cut, Task 21 is checked off having touched no file, and Task 23's phone measurement reports a **skip** rather than a failure — a legitimate design decision must not read as a broken test.

**The nightly job is built in both branches** (R8): the archive that outlives Cloudflare's six-month window needs `daily_visits` whether or not the chart reaches backwards, so the cron, the `scheduled` export, the snapshot, the roll and the prune are unconditional.
