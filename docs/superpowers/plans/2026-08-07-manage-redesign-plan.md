# Manage Screen Redesign — Implementation Plan

**Date:** 2026-08-07
**Spec:** `docs/superpowers/specs/2026-08-07-manage-screen-redesign-design.md`
**Branch:** `repair/phase-a` (continues)

This plan orders the spec into independently verifiable tasks. It does not re-argue any
decision in the spec; where it departs from the spec's suggested commit boundaries it says so
and gives the reason (see D6a/D6b).

Every task states: **stream**, **files**, **change**, **verified by** (a named test), and
**mutation** (the edit that proves the named test can go red). The gate before any task is
claimed done is the repo standing rule:

```
npx tsc -b --noEmit && npm test -- --run && npx eslint .
```

plus `npm run test:e2e` for any task with an e2e assertion and `npm run test:csp` for B2, D7
and D9.

---

## 0. Streams, and the files that decide whether they are really parallel

| Stream | Scope | Root files |
|---|---|---|
| **W** | Worker analytics route | `worker/analytics.ts`, `worker/wa.ts`, `worker/index.ts`, `worker/__tests__/*`, `wrangler.toml`, `src/test/wrangler-config.test.ts` |
| **B** | Beacon | `index.html`, `src/test/analytics.test.ts`, `src/test/head.test.ts`, `scripts/check-csp.mjs` |
| **D** | Dashboard | `src/admin/**`, `src/test/bundle.post-build.test.ts`, `e2e/**` |

### Files that appear in more than one stream — resolve these before anyone starts

| File | Streams | Collision | Resolution |
|---|---|---|---|
| `src/shared/analytics-payload.ts` *(new)* | **W + D** | W produces the `/api/analytics` body; D renders it. If each writes its own type they will drift, and the first integration will be a rewrite. | **Land it as task C1 below, before either stream starts.** Type-only module. `worker/` already imports `src/shared/*` (`base64`, `image-format`, `derivative-path`, `upload-categories`) and nothing in `src/` imports `worker/` — this keeps that one-way boundary intact. Frozen after C1; any change is a joint edit. |
| `docs/cloudflare-cutover.md` | **W + B** | W rewrites **§12b** (token reuse reversal, spec §7). B rewrites **Step 4** (auto-install off + manual snippet, spec §8). Same file, disjoint sections. | Non-overlapping regions, so a textual merge is safe, but **W lands §12b first** (W5) and B rebases onto it. Do not let both edit the file from the same base without rebasing. |
| `worker/index.ts` | **W + D** | W2 edits `AUTHENTICATED_PATHS` + route wiring + extracts `readWaCounts`. D11 edits the 422 `flatMap` to tag `ValidationProblem.file`. | Disjoint regions but the same file. **D11 is ordered after W2** and is the last D task for that reason. |
| `e2e/edit-backend.ts` | **D** (encodes W's contract) | D adds a `**/api/analytics` fixture whose body must match what W actually returns. | Fixture is built from `src/shared/analytics-payload.ts` (C1), not hand-typed. Owned by D. |
| `src/admin/manage/analytics.ts` → `COUNTING_STARTED_ON` | **D** (value comes from B) | Spec §6: the constant is the day B2 lands. | Data dependency, not a file collision. D10 sets it to B2's actual commit date; if B2 has not landed, D10 is blocked on it. Only real cross-stream *ordering* dependency between B and D. |

Everything else is genuinely disjoint. **W touches no `src/admin/` file and no `e2e/` file. B
touches no `src/admin/` file and no `worker/` file.**

### Human prerequisites, outside the repo — these gate W and B, not D

| # | Step | Gates |
|---|---|---|
| **P0** | Run the five-alias GraphQL document by hand against `https://api.cloudflare.com/client/v4/graphql`. Confirm `refererHost`, `requestPath`, `orderBy: [sum_visits_DESC]`, the per-node `limit`, whether a `requestPath` prefix filter exists, and whether a request-host dimension exists. Paste the verified document into `worker/analytics.ts`'s header. | **W1** cannot start without it. If no path filter exists, W1 takes spec §7's decided fallback (raise `byPath` limit, filter and total in the Worker). |
| **P1** | Add **Account Analytics: Read** to `CLOUDFLARE_API_TOKEN`. | Runtime only. W ships and tests green without it; the route returns `502 upstream-auth` and the cards say "The visitor numbers aren't connected yet." |
| **P2** | Turn Web Analytics **auto-install off** for site tag `29e1ba52fba74885a5fc44875a48a078`. | Must happen **in the same window as B2 landing**, either order, minimised. Doing only one double-counts or counts nothing. |

D has **no** external prerequisite and can start immediately.

### Standing rule for every D task from D6b onward — the CSS ceiling

`src/test/bundle.post-build.test.ts` caps the entry CSS at **38700 bytes against a current
38468 — 232 bytes of headroom.** Several D tasks will exceed it. The rule, per spec §11:

- The task that first exceeds it raises the ceiling **in its own commit**, alongside the styles
  that need it.
- The new number is justified in that test's comment, in the form the existing raises use.
- The **postcss rule-level diff is actually run**, and its added-rule list is pasted into the
  commit message. Not described in a comment — this repo has shipped bogus comment-derived CSS
  twice, and a legitimate multi-KB increase is exactly the cover such a rule needs.
- No source comment in any new file may contain a bare utility-class-shaped token. Breakpoint
  behaviour is written as prose ("shown only at the large breakpoint").

---

## C1 — The shared analytics payload type *(blocks W and D; do this first)*

**Stream:** shared (W+D). One tiny commit, whoever starts first.
**Files:** `src/shared/analytics-payload.ts` *(new)*, `src/shared/__tests__/analytics-payload.test.ts` *(new)*.
**Change:** A type-only module exporting the `GET /api/analytics` success body and the error
body: totals (visits), byPath rows, byReferer buckets, thisWeek/priorWeek visit counts, the
`wa:counts`-derived tap total with its `lowerBound: true` flag, and
`{ reason: 'unreachable' | 'upstream-auth' | 'upstream-error' }`. Plus one exported
`ZERO_DATA_PAYLOAD` constant, which is the launch state and is used as a fixture by both
streams.
**Verified by:** `src/shared/__tests__/analytics-payload.test.ts` — `ZERO_DATA_PAYLOAD` has
every key the type declares, every count is `0`, every array is empty, and `lowerBound` is
`true`. Plus `npx tsc -b --noEmit`, which is the real guard: the type is consumed by
`worker/analytics.ts` and `NumbersArea.tsx` and a drift breaks the build.
**Mutation:** delete a key from `ZERO_DATA_PAYLOAD` → the test goes red; widen a numeric field
to `unknown` → `tsc -b` goes red at both consumers.

---

## Stream W — the Worker analytics route

Sequential within the stream (each task edits the previous task's file), independent of B and D.

### W1 — `worker/wa.ts` extraction *(no behaviour change)*

**Stream:** W.
**Files:** `worker/wa.ts` *(new)*, `worker/index.ts`, `worker/__tests__/count.test.ts`.
**Change:** Move `WA_COUNTS_KV_KEY` (`worker/index.ts:959`) and `readWaCounts`
(`worker/index.ts:972`) into `worker/wa.ts` and import them back. Bodies move byte-identically.
No other edit to `index.ts`. Done first and alone so the `/api/wa` handlers' behaviour is
proven unchanged before anything new reads that key.
**Verified by:** `worker/__tests__/count.test.ts` — every existing `GET /api/wa` and
`POST /api/wa` case passes **unchanged**, no edits to the file. Spec §11's stated bar.
**Mutation:** in `worker/wa.ts`, make `readWaCounts` return `{}` on a parseable body → the
existing increment cases go red. (This confirms the moved function is genuinely the one under
test and not shadowed by a leftover in `index.ts`.)

### W2 — route registration, session sliding, and the deliberate no-rate-limit set

**Stream:** W. **Ordered before D11** (shared file: `worker/index.ts`).
**Files:** `worker/index.ts`, `worker/__tests__/index.test.ts`, `worker/__tests__/hardening.test.ts`.
**Change:** Add `/api/analytics` to `AUTHENTICATED_PATHS` (`worker/index.ts:89`) so it routes
through `withSlidingSession`. Wire `GET /api/analytics` to `handleAnalytics` (a stub returning
`ZERO_DATA_PAYLOAD` at this task; W3 fills it). Do **not** add it to `RATE_POLICIES` — spec §7's
KV-write-budget reasoning. Add the named set
`AUTHENTICATED_UNLIMITED = ['/api/build-status', '/api/analytics']` beside `RATE_POLICIES` with
that reasoning in a comment.
**Verified by:**
- `worker/__tests__/index.test.ts` — the `AUTHENTICATED_PATHS` case's hardcoded literal grows
  from five to six items.
- `worker/__tests__/hardening.test.ts` — new case: `AUTHENTICATED_UNLIMITED` is disjoint from
  `Object.keys(RATE_POLICIES)` and a subset of `AUTHENTICATED_PATHS`. The existing
  three-mutating-routes case is untouched.
**Mutation:** add `/api/analytics` to `RATE_POLICIES` → the disjointness case goes red. Remove
it from `AUTHENTICATED_PATHS` → the subset case **and** the `index.test.ts` literal go red.

### W3 — `worker/analytics.ts`: auth, cache, upstream, failure shapes

**Stream:** W. The bulk of the stream.
**Files:** `worker/analytics.ts` *(new)*, `worker/__tests__/analytics.test.ts` *(new)*,
`worker/index.ts` (swap the W2 stub for the real handler).
**Change:** `handleAnalytics(request, env)` following `worker/status.ts`'s shape. Auth check
**before** the cache lookup. `caches.default` referenced **lazily inside the handler**, never at
module scope. Cache key is the fixed in-zone
`new Request(new URL('/__cache/analytics/v1', request.url).toString())`. One
`POST https://api.cloudflare.com/client/v4/graphql` per miss with `AbortSignal.timeout(10_000)`
and the P0-verified five-alias document. Body built once as a `string`, then **two** `Response`
objects — stored copy `public, max-age=600`, returned copy `no-store`. `cache.put` awaited
inline on the body the handler built, never on the wrapper's return. Header block carries the
P0 document and the subrequest arithmetic (worst case 4: `match`, `fetch`, `KV.get`, `put`).
Referer bucketing and the `/edit` path exclusion both live here. `wa:counts` summed over the
last 28 IST dates ending yesterday.
**Verified by:** `worker/__tests__/analytics.test.ts`, with a fake `caches` global installed in
`beforeEach` (`{ default: { match, put } }`, recording every `put` argument):
- 401 with no cookie, **and `cache.match` was never called** on that path.
- GraphQL 200 + non-empty `errors[]` → 502 `upstream-error`; upstream 403 → 502 `upstream-auth`;
  `fetch` rejecting → 502 `unreachable`; `fetch` aborting → 502 `unreachable`;
  empty-but-valid → **200 zero-data**, not an error.
- Referer bucketing, row by row, including every accepted mis-bucket in spec §6
  (`com.google.android.gm` → Google, `t.co` → Other links, `l.instagram.com` and
  `www.instagram.com` → Instagram, `''` → Typed it in or used a bookmark) and a row for the
  incoming request's own host → Typed it in or used a bookmark.
- No `/edit`-prefixed path contributes to any of the five groups.
- `wa:counts` dates older than 28 days are excluded from the sum.
- A cache hit makes **zero** upstream fetches; a miss makes **exactly one**.
- Two requests with **different session cookies** hit the same entry — the second makes no
  upstream call.
- `?days=90` → same key, same single upstream call, same body as the bare URL.
- Stored `Cache-Control` is `public, max-age=600`, read off the captured `put` argument.
- `no-store` on the browser-facing copy asserted by calling `handleAnalytics(request, env)`
  **directly**, never through `worker.fetch` — `withSecurityHeaders` sets it unconditionally, so
  a router-driven assertion here cannot fail and would prove nothing.
**Mutation:** derive the cache key from `request.url` (cookie/query included) → the
different-cookies case and the `?days=90` case go red. Store the response with `no-store`
instead of `max-age=600` → the captured-`put` case goes red. Collapse a non-empty `errors[]`
into zero-data → the `upstream-error` case goes red. Move `caches.default` to module scope →
the whole file fails to import under vitest, which is itself the signal.

### W4 — `wrangler.toml` var + config test

**Stream:** W.
**Files:** `wrangler.toml`, `src/test/wrangler-config.test.ts`, `vitest.config.ts` (comment only).
**Change:** Add `CF_WEB_ANALYTICS_SITE_TAG = "29e1ba52fba74885a5fc44875a48a078"` under `[vars]`,
with the same "identifier, not a secret" comment `CLOUDFLARE_PAGES_PROJECT` carries. Add
`caches` to `vitest.config.ts`'s "Absent, needs a workaround" list (spec §11).
**Verified by:** `src/test/wrangler-config.test.ts` — new case: `CF_WEB_ANALYTICS_SITE_TAG` is
present and is 32 lowercase hex characters. Pattern-based like the existing cases, so nothing
there breaks.
**Mutation:** truncate the tag to 31 characters → red. Delete the line → red.

### W5 — `docs/cloudflare-cutover.md` §12b reversal

**Stream:** W. **Land before B's doc edit** (shared file).
**Files:** `docs/cloudflare-cutover.md` (§12b only).
**Change:** Rewrite the bold "do not reuse any token created for other purposes" paragraph. Per
spec §7: this reuse is two read-only scopes on the same account, which is the case that rule was
not written for; two tokens are two rotations, two leaks and two ways to disagree about the
account. Record that this reverses the earlier decision and why.
**Verified by:** no automated test — this is prose. Verification is the review checklist item
"§12b no longer instructs the human to create a second token, and says it is a reversal."
Recorded honestly as the one task in this plan with no test behind it.
**Mutation:** n/a. Flagged rather than faked.

---

## Stream B — the beacon

Two tasks. Touches no `src/admin/` and no `worker/` file.

### B1 — `check-csp.mjs` gains the interception and the `connect-src` probe *(before the tag lands)*

**Stream:** B.
**Files:** `scripts/check-csp.mjs`, `scripts/__tests__/` (if that directory covers it).
**Change:** Abort requests to `https://cloudflareinsights.com/*` and
`https://static.cloudflareinsights.com/*` **after** recording whether a
`securitypolicyviolation` fired for them — CSP is evaluated before dispatch, so the abort still
proves the policy allowed it while sending nothing (this is also the CI-pollution answer in
spec §8's table). Add an explicit `connect-src` probe: a `POST` to
`https://cloudflareinsights.com/cdn-cgi/rum` inside a try/catch that records **only**
`securitypolicyviolation` events and never a network failure. Landing this **before** B2 means
the very first run with a real beacon is already instrumented.
**Verified by:** `npm run test:csp` — passes on all `ROUTES` with the new probe, and the run
reports zero violations. To prove the probe can fail: temporarily strip
`https://cloudflareinsights.com` from `connect-src` in `public/_headers` and confirm the script
exits non-zero naming `connect-src`, then restore.
**Mutation:** as above — remove the `connect-src` entry from `public/_headers` → `npm run
test:csp` goes red. (This is the mutation; it is on the policy, not the script, because the
policy is what the probe measures.)

### B2 — the tag, the inverted tests, and the two rewritten comments *(pair with P2)*

**Stream:** B. **Its landing date is the value of `COUNTING_STARTED_ON` in D10.**
**Files:** `index.html`, `src/test/analytics.test.ts`, `src/test/head.test.ts`,
`docs/cloudflare-cutover.md` (Step 4 only — rebase onto W5).
**Change:**
- Add the snippet to `index.html`:
  `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "7d977bcbda6e4e38884875918d153e7f"}'></script>`
- **Rewrite the comment at `index.html:108–113`**, which currently says explicitly not to do
  this. Replacement states: auto-install does not reach Pages-served responses (verified across
  three cache-busted requests), the token travels with the HTML so this survives the move to
  `viabiancadelhi.com`, and auto-install must be off in the dashboard so this is the only beacon
  on the page. It must not be left contradicting the code three lines below it.
- **`src/test/analytics.test.ts` is rewritten, not deleted** — same file, inverted assertions,
  header comment replaced with the auto-install finding. A deleted test would leave the inverted
  rationale nowhere and the beacon unguarded.
- **`docs/cloudflare-cutover.md` Step 4** rewritten: dashboard toggle **off**, manual snippet is
  the mechanism, and it stops citing `analytics.test.ts` as a guard against the snippet.
**Verified by:**
- `src/test/analytics.test.ts` — **exactly one** `cloudflareinsights.com` script in `index.html`,
  carrying token `7d977bcbda6e4e38884875918d153e7f`. (Count, not presence: a duplicated tag
  double-counts and would pass a presence check.)
- `src/test/head.test.ts` — new case: the beacon tag is present with that token, alongside the
  existing title/description pins. Deliberate duplication with the above; `analytics.test.ts`
  owns "exactly one, and here is why", `head.test.ts` owns "the head has not drifted".
- `npm run test:csp` — green, with B1's `connect-src` probe now exercising a real tag.
- The **rule-level built-stylesheet diff** is run and recorded: `index.html` is inside Tailwind's
  content glob and its scanner reads words out of attribute values and comments. Expected added
  rules: **zero**.
**Mutation:** delete the tag from `index.html` → both `analytics.test.ts` and `head.test.ts` go
red. Duplicate the tag → `analytics.test.ts`'s count case goes red while a presence check would
not (which is why it is a count).
**Verified-not-a-problem, recorded so nobody re-derives it:**
`bundle.post-build.test.ts:156`'s `entryChunkName()` regex requires `src="/assets/…"`. The
beacon's `type="module"` tag carries an absolute `https://` src and therefore cannot hijack that
match, wherever it sits in the file.

---

## Stream D — the dashboard

Sequential. Every task shares files with its neighbours.

### D1 — `areas.ts` and the completeness pin *(new files only; nothing imports it yet)*

**Stream:** D.
**Files:** `src/admin/manage/areas.ts` *(new)*,
`src/admin/manage/__tests__/areas.test.tsx` *(new)*.
**Change:** The single `AREAS` constant — slug, label, description, panel ids, and the
panel→`ContentFileName` map. Five areas per spec §1, `details` slug with label
"Hours & Wording". Nothing imports it yet; this is a pure addition.
**Why first:** the `aria-controls` pin below can be written **today**, against the current
one-page `AdminApp`, and will then keep passing through the whole move. It is the cheapest guard
in the plan and it is worth nothing if written after the move.
**Verified by:** `src/admin/manage/__tests__/areas.test.tsx`:
- Five areas; slugs unique; **every one of the ten panel ids appears in exactly one area**.
- Rendering the current dashboard, the ten `aria-controls` values are exactly
  `section-panel-{dishes,drinks,press,sections,pages,hours,menus,galleries,story,copy}`. A
  direct pin on `open-sections.ts`'s `vb:section-open:v1:<id>` key suffix, and it does not depend
  on the e2e spec this work later rewrites.
**Mutation:** rename `dishes` → `menu-dishes` in `AdminApp.tsx`'s `CollapsibleSection` id → the
`aria-controls` case goes red. Drop `press` from `AREAS` → the exactly-once case goes red. Put
`press` in two areas → also red.

### D2 — `publish-summary.ts`: `barSummary` + `stripSummary`

**Stream:** D.
**Files:** `src/admin/publish-summary.ts` *(new)*, `src/admin/PublishBar.tsx`,
`src/admin/__tests__/publish-summary.test.ts` *(new)*.
**Change:** Lift `summaryMessage` (`PublishBar.tsx:244`) into `publish-summary.ts` as
`barSummary(dirtyCount, stagedCount)` — **byte-identical**, including "— ready to publish." —
and import it back at both call sites (`:795`, `:1043`). Add `stripSummary(dirtyFiles,
stagedCount)`, which takes **file names** and renders them through the existing
`CONTENT_FILE_LABELS` (`src/admin/content.ts:87`), reading "Nothing waiting to be published" at
zero. Nothing else in `PublishBar.tsx` moves.
**Verified by:**
- `src/admin/__tests__/PublishBar.test.tsx` (1628 lines) — **passes unchanged, no edits**. Spec
  §4's own falsifier: if any case there goes red, "byte-identical" is false and the lift is wrong.
- `src/admin/__tests__/publish-summary.test.ts` — `barSummary`'s output asserted byte-identical
  to the strings `PublishBar.test.tsx` already expects; `stripSummary` names files rather than
  counting sections, and returns "Nothing waiting to be published" at zero.
**Mutation:** change `barSummary`'s trailing clause to " — ready." → `PublishBar.test.tsx` goes
red. Make `stripSummary` return `''` at zero → its own case goes red.

### D3 — `open-sections.ts`: `hasSeededArea` / `markAreaSeeded`

**Stream:** D.
**Files:** `src/admin/open-sections.ts`, `src/admin/__tests__/open-sections.test.ts`.
**Change:** Two additive functions reading/writing `vb:area-seeded:v1:<slug>`, `markAreaSeeded`
never throwing. **`loadSectionOpen` and `saveSectionOpen` are not modified at all**, and the file
states that no key migration is needed.
**Verified by:** `src/admin/__tests__/open-sections.test.ts` — new cases for both functions
(absent key → `false`; after `markAreaSeeded` → `true`; a throwing `localStorage` does not
propagate). **Every existing case in the file passes unchanged**, which is what proves the
storage contract was left alone.
**Mutation:** make `markAreaSeeded` write under the `vb:section-open:v1:` prefix → the existing
`loadSectionOpen` cases go red, which is exactly the collision this key shape avoids.

### D4 — `AdminApp.test.tsx` harness rewrite *(no `src/` change at all)*

**Stream:** D. Its own commit, per spec §13.
**Files:** `src/admin/__tests__/AdminApp.test.tsx`, `src/admin/__tests__/renderDashboard.tsx` *(new helper)*.
**Change:** Add `renderDashboard(route = '/edit/manage/menu', { wide = false } = {})` — wraps
`<MemoryRouter initialEntries={[route]}>` and applies a **per-test `vi.stubGlobal`** for
`matchMedia`, never a mutation of `src/test/setup.ts` (`usePrefersReducedMotion.test.ts` is the
existing precedent). Move all **40** bare `render(<AdminApp />)` sites onto it, each given the
route of the area whose panel it asserts on — determinable now from D1's `AREAS`. **No
production code changes**, so all 43 cases stay green; the router wrapper and the stub are inert
until D6b.
**Why here:** done before the move, so that a red case afterwards means the move broke something
rather than the harness. Doing it after would make 40 simultaneous failures indistinguishable
from a lost panel.
**Verified by:** `src/admin/__tests__/AdminApp.test.tsx` — all 43 cases pass, unchanged in
meaning. Two called out as still correct and still valuable: the id-uniqueness sweep (all panels
are still mounted, so it still means what it meant) and the malformed-`galleries.json` isolation
case.
**Mutation:** make `renderDashboard` swallow its `route` argument and always mount the bare URL →
after D6b, every area-specific case goes red. At D4 itself the helper is inert by design, so the
honest statement is: **D4's guarantee is "43 green before and after, zero production diff"**, and
its mutation is `git diff --stat src/ ':!src/admin/__tests__'` returning empty.

### D5 — the per-panel DOM snapshot baseline

**Stream:** D.
**Files:** `src/admin/__tests__/panel-snapshots.test.tsx` *(new)*, `__snapshots__/`.
**Change:** For each of the ten panels, render it from the fixtures `AdminApp.test.tsx` already
uses and snapshot its DOM subtree. **Per-panel, not page-level** — so D6a's regrouping, which
changes the order panels appear in, does not falsely trip it.
**Why:** spec §9 requires panel bodies to arrive in their new files byte-identical apart from
imports, and that is not something a test can assert directly. This snapshot is the enforcement.
D1's completeness test catches a *dropped* panel; this catches a subtly *altered* one. They are
complements, not substitutes.
**Verified by:** `src/admin/__tests__/panel-snapshots.test.tsx` — ten snapshots written at this
task and asserted unchanged at D6a and D6b.
**Mutation:** change one word of the Dishes panel's "Add a dish" button label → exactly one
snapshot goes red.

### D6a — the move, with **no** routing and **no** shell *(pure code motion)*

**Stream:** D. The highest-risk task in the plan.
**Files:** `src/admin/AdminApp.tsx`, `src/admin/areas/{MenuArea,PagesArea,StoryPhotosArea,DetailsArea}.tsx` *(new)*,
`src/admin/sections/ArraySection.tsx` *(new)*, `src/admin/sections/copy-fields.ts` *(new)*.
**Change:** Move each panel implementation into its area module: `SectionsSection` (`:561`),
`PagesSection` (`:672`), `HoursSection` (`:750`), `MenusSection` (`:857`), `GallerySection`
(`:978`), `StorySection` (`:1046`), `CopySection` (`:1208`), and the
`blankDish`/`blankDrink`/`blankArticle` factories (`:1314`–`:1322`). `ArraySection` (`:429`) →
`sections/` because three panels share it. `COPY_GROUPS`/`leafValue`/`withLeaf`/`withVisibleNbsp`
(`:1127`–`:1199`) → `sections/copy-fields.ts`. `AdminApp` renders the four area components in
sequence, **all visible, no router, no `hidden`, no shell**. Shared plumbing reaches them as
**props** (spec §3: not a context).
**Departure from the spec's commit boundary, and why.** Spec §9 implies one commit for the move.
Splitting it at the shell boundary means this commit is provably behaviour-neutral — the same
ten panels, on one page, in the same fold state — so `dashboard-sections.spec.ts` and every
`AdminApp` case still describe it. All the risk of losing a panel is isolated from all the risk
of the routing model. D6b is then a small, reviewable diff.
**Verified by:**
- `src/admin/__tests__/panel-snapshots.test.tsx` — all ten snapshots **unchanged**. This is the
  task's real verification.
- `src/admin/manage/__tests__/areas.test.tsx` — the `aria-controls` pin still holds.
- `src/admin/__tests__/AdminApp.test.tsx` — all 43 green.
- `e2e/dashboard-sections.spec.ts` — **passes unchanged**. Panel order changes (grouping puts
  `menus` before `galleries`), but every assertion in it is order-independent except
  "`Page copy` sits above 3 viewports", and `copy` is still the last panel of the last area.
**Mutation:** drop `StorySection` from `StoryPhotosArea` → the "Our Story" snapshot goes red, the
`aria-controls` case goes red, and the e2e heading loop goes red. Change one field label while
moving it → exactly one snapshot goes red.

### D6b — `ManageShell`, the router, and mount-and-hide

**Stream:** D. The most important behavioural constraint in the spec.
**Files:** `src/admin/AdminApp.tsx`, `src/admin/manage/{ManageShell,AreaNav,AreaHome,AreaNotFound}.tsx` *(new)*,
`src/admin/manage/__tests__/ManageShell.test.tsx` *(new)*,
`e2e/dashboard-sections.spec.ts` *(rewritten)*, `src/test/bundle.post-build.test.ts` (CSS ceiling — see §0).
**Change:** `ManageShell` derives the active slug from `useLocation().pathname` (strip prefix and
trailing slash; empty means bare URL). **No nested `<Routes>`, no `<Outlet/>`, no area is ever a
`<Route element>`.** All five areas render unconditionally inside a single `PublishBar`, each in
`<div hidden={slug !== areaSlug}>` — the **HTML attribute**, with **no display-setting utility on
that element**. `AreaHome` renders alongside them when the slug is empty and the viewport is
narrow; `AreaNotFound` when the slug is non-empty and unmatched. The ≥1024px bare-URL redirect is
a conditionally rendered `<Navigate replace/>`, not a route. Width read **once**, in a lazy
`useState` initializer, via `window.matchMedia('(min-width: 1024px)').matches`. `AreaNav` is
**one** component with `variant: 'sidebar' | 'list'` — never two navs rendered together. The
`<DraftBanner>` gate renders **in place of** `PublishBar` **and** all five areas while
`pendingDraft !== null`, unchanged from today. The cross-surface `/edit` draft notice moves into
the shell. Per-area error boundary inside the shell. Every new `<button>` carries an explicit
`type="button"`. `NumbersArea` is a placeholder here, taking its `active: boolean` prop.
**Verified by:** `src/admin/manage/__tests__/ManageShell.test.tsx`, using D4's `renderDashboard`:
- **Areas stay mounted** (the single most important case): navigate Menu → Pages → Menu with a
  dish name edited in between; assert the stubbed `GET /api/content?path=…dishes.json` fired
  **exactly once** across the sequence, **and** the edited name is still in the input. Written
  against observable seams, not a spy on `register`, which nothing outside `AdminApp` can reach.
- Routing as `describe.each([{ wide: true }, { wide: false }])`: each slug shows its own headings
  and hides the others; an unknown slug shows the not-found content **and still shows the nav**;
  bare `/edit/manage` redirects to `/edit/manage/menu` when wide and renders the home list when
  not; `/edit/manage/` behaves identically.
- Hidden containers carry the **attribute**.
- **The draft gate**: a draft in localStorage blocks every area *and* `PublishBar` until she
  answers; the existing `AdminApp.test.tsx` case survives rather than being rewritten away; a
  second case asserts the draft is **still in localStorage** after the areas would have loaded.
- The cross-surface `/edit` notice renders in the shell; its two existing cases survive with a
  navigation step.
- **Navigation is not disabled during a publish**: with `publishLocked` true, no nav link has a
  `disabled`/`aria-disabled` ancestor and a click still changes the route.
- Every `<button>` in the shell is `type="button"`.
- The per-area error boundary: a throwing area leaves the nav and all five items queryable.
- The first-panel seed (D3): with no `vb:area-seeded:v1:menu`, opening Menu leaves Dishes open
  and Drinks and Menus folded and writes the seed key; with the key present and Dishes closed,
  Dishes **stays closed**.
- `src/admin/__tests__/CollapsibleSection.test.tsx` and `open-sections.test.ts` pass **unchanged**.
**e2e, rewritten with the reason recorded in the file:** `e2e/dashboard-sections.spec.ts`'s
premise — ten headings on one page — no longer describes anything. The rewrite keeps the same
guarantees **per area** (every heading in an area reachable, opening one leaves the others
folded, open state survives a reload), sources `SECTION_HEADINGS` from `areas.ts`, moves
`openDashboard()`'s settle-wait off "Page copy" and onto the Hours & Wording area, and adds the
width-split two-taps guarantee. `openDashboard()` still waits on the
`Via Bianca Dashboard` heading — **that string survives until D9**, which updates it.
New e2e cases here: sidebar genuinely visible at 1440 and genuinely absent at 390; **no flash of
the wrong layout** at 390, proved via `addInitScript` + a `MutationObserver` recording every
added node (the sidebar element **never existed**, not merely absent after settle); the redirect
is `replace` (`goBack()` from `/edit/manage/menu` lands on `/edit`); at 390×844 all five home
rows on screen without scrolling and each row's centre pixel hit-tests to itself; drill down and
back at 390; **`hidden` really hides in a real browser** (at 1440, on Pages, the Dishes heading
`toBeHidden()`). Viewport is set **before** `page.goto` in every one.
**Mutation:** replace the `hidden` toggle with conditional rendering → the fetched-once case
**and** the surviving-edit case go red. Add a display utility to the element carrying `hidden` →
the jsdom cases still pass and the real-Chromium `toBeHidden()` case goes red, which is the whole
reason that e2e case exists. Wrap the shell in a disabled fieldset → the navigation-during-publish
case goes red. Render the areas alongside `DraftBanner` → the draft gate case goes red **and** so
does the still-in-localStorage case. Drop the seed-key check → the "stays closed" case goes red.

### D7 — the status strip

**Stream:** D.
**Files:** `src/admin/manage/StatusStrip.tsx` *(new)*,
`src/admin/manage/__tests__/StatusStrip.test.tsx` *(new)*, `src/admin/manage/ManageShell.tsx`,
`src/admin/PublishBar.tsx` (one additive optional prop), `e2e/edit-backend.ts`,
`src/test/bundle.post-build.test.ts` (CSS ceiling if crossed).
**Change:** The strip renders `stripSummary` (D2), the `builtAt` relative time from
`fetchBuildInfo()`, the publish-window sentence, and the View-site link. Polls
**`/build-info.json`** — never `/api/build-status` — on mount, on window focus, and every 60s
while visible; stops when hidden. `PublishBar` gains **one additive optional prop**,
`onPhaseChange?: (phase) => void`, alongside its existing `onPublishLockChange`; `ManageShell`
holds the phase. `aria-label="Site status"`. The **live region is scoped**: only the publish
phase and the unsaved sentence sit inside `aria-live="polite"`; the relative timestamp is a
sibling **outside** it. `e2e/edit-backend.ts` gains a `**/build-info.json` fixture with a fixed
`builtAt`/`sha` plus an error variant — `playwright.config.ts` runs `npm run dev` and
`plugins/build-info.ts` is build-only, so without it every e2e run reads "Couldn't check when the
site last updated."
**Verified by:** `src/admin/manage/__tests__/StatusStrip.test.tsx`, querying by
`aria-label="Site status"` and **never by role alone** (`CollapsibleSection` renders
`role="status"` for a folded section with a problem, and several can now exist at once):
- Copy for each state: zero unsaved; some unsaved (naming files, not counting sections);
  build-info OK; build-info error; publish in flight; publish landed; publish not landed after 5
  minutes; **`builtAt` in the future** → "Last published — time unknown"; **`sha: 'unknown'` as a
  separate case** that still shows the time normally.
- Polling with fake timers: advance 60s → one extra `fetchBuildInfo`; `visibilitychange` with the
  document hidden then advance 120s → **no further calls**; `focus` → one call.
- The live region is scoped: `getByRole('status')` within the strip exists and the timestamp node
  is **outside** it.
- The strip renders on all five areas, on the phone home **and on the not-found screen**, at both
  widths — a loop over `AREAS`, because not-found is exactly where this gets dropped.
- The View-site label and its half-line change with the unsaved count.
- `PublishBar.test.tsx` passes unchanged (the prop is optional and additive).
**e2e:** the status strip is not painted under anything, at either width.
**Mutation:** delete the `visibilitychange` listener → the hidden-tab polling case goes red. Wrap
the whole strip in `aria-live` → the scoped-live-region case goes red. Collapse the
`sha: 'unknown'` branch into the future-`builtAt` branch → that separate case goes red.

### D8 — thumbnails

**Stream:** D.
**Files:** `src/admin/manage/Thumbnail.tsx` *(new)*, `src/admin/RecordList.tsx`,
`src/admin/GalleryList.tsx`, `src/admin/TemplateContentForm.tsx`, `src/admin/PhotoField.tsx`,
`src/admin/AdminApp.tsx` (lift `useImagePreviews`), `src/admin/manage/ManageShell.tsx`,
their four existing test files, `src/admin/manage/__tests__/Thumbnail.test.tsx` *(new)*.
**Change:** One `<Thumbnail />`: 48×48, cover-fitted, rounded, thin sage border, lazy, `alt=""`;
missing path → neutral cream/sage placeholder, `aria-hidden`; `onError` → the same placeholder
**once**, flagged so it never retries. `RecordList`, `GalleryList` and `TemplateContentForm` each
gain **one optional `thumbnail?: (item) => React.ReactNode`** and nothing else moves.
`PhotoField` gains **one optional `previews?: ImagePreviews`** defaulting to the already-exported
`NO_IMAGE_PREVIEWS`, writing its object URL there in addition to local state, keyed by **the same
string it stages under**. `AdminApp` calls `useImagePreviews()` once and drills it down.
`previews.ts` is **not edited** — both exports already exist. Menus, Pages, Homepage sections,
Opening hours and Page copy get **no** thumbnail; `PageList.tsx` and `TemplateSectionList.tsx`
are not in scope.
**Verified by:**
- `src/admin/manage/__tests__/Thumbnail.test.tsx` — null path → placeholder; `onError` →
  placeholder, once, no retry loop; a staged preview beats the content path; `alt` is the empty
  string; the placeholder is `aria-hidden`.
- **A row-by-row walk of spec §5's table**, because the isolated cases above pass identically
  whether `Thumbnail` is mounted on six row types or zero. For each of the six, render the panel
  with a fixture carrying an image path and assert an `<img>` with that path is **inside the
  row**. For Menus, Pages, Homepage sections, Opening hours and Page copy: assert there is none.
- **Staged precedence as an integration case**, driven through a real photo pick in the Dishes
  panel using the `FakeXHR` double `AdminApp.test.tsx` already has: after the pick, the row's
  thumbnail `src` is the object URL, not the optimistically-written content path.
- `npm run test:csp` — confirms `img-src 'self' blob:` still covers this. The design uses object
  URLs precisely because the shipped policy has no `data:`.
- `PhotoField.test.tsx`, `RecordList.test.tsx`, `GalleryList.test.tsx`,
  `TemplateContentForm.test.tsx` pass unchanged (all four props are optional).
**e2e:** thumbnails are **48±2 in both dimensions** at 390 **and** 1440, and the row's text still
starts to the right of the thumbnail and stays on screen ("non-zero" would pass for a 1×1 and for
one that pushed the row off screen). **Hidden areas' thumbnails are not fetched**: sitting on
Hours & Wording, count `page.on('request')` hits to `/food/*.webp` and assert zero — spec §3
states this as a justification for mounting everything, so it is tested rather than asserted.
**Mutation:** delete the `<Thumbnail/>` from one row component → **exactly one** row case goes
red. Drop the staged precedence in `Thumbnail` → the integration case's `src` flips back to the
content path and goes red. Remove the `onError` flag so it retries → the no-retry-loop case goes
red.

### D9 — brand: the lockup, sage and cream

**Stream:** D. Cosmetic, deliberately last of the structural run.
**Files:** `src/admin/manage/ManageShell.tsx`, `src/admin/manage/AreaNav.tsx`,
`src/admin/manage/StatusStrip.tsx`, `src/test/bundle.post-build.test.ts`,
`e2e/dashboard-sections.spec.ts` (the `openDashboard` wait).
**Change:** The real lockup replaces the `Via Bianca Dashboard` `<h1>`. Sage `#6B8B59` and cream
replace white/grey. `aria-current="page"` plus a sage left rule on the current sidebar item —
never by removing it from the list and never by disabling its link. Sidebar scrolls with the page
rather than being fixed-position (this repo has shipped a control painted under a fixed
high-stacking-order bar once — see `e2e/edit-dashboard-link.spec.ts`'s own comment).
**Two things break here and both are handled in this commit:**
1. `ADMIN_MARKERS['AdminApp.tsx']` is the literal `'Via Bianca Dashboard'`
   (`bundle.post-build.test.ts:250`), which this deletes. Replacement: **the phone home's Menu
   description, "Dishes, drinks and the PDF menus"** — it lives only in `areas.ts`, it is a full
   sentence rather than a label a wording pass would casually retouch, and its uniqueness against
   `src/` is confirmed by a direct search **before committing**, as that file's comment requires.
   Bare "Via Bianca" is a false positive (`ErrorBoundary.tsx`, `ReservationPage.tsx`) and
   `Pastificio & Ristorante` is `site.tagline`, also public.
2. `e2e/dashboard-sections.spec.ts`'s `openDashboard()` (line 20) and the reload test (line 97)
   both wait on that heading. Both move to the lockup's new accessible name, which is stated in
   `ManageShell.tsx`.
**Verified by:** `src/test/bundle.post-build.test.ts` — the per-marker presence check passes with
the new marker, and the entry-CSS ceiling is raised here if not already raised, with the new
number justified in that test's comment **and the postcss rule-level diff run and its added-rule
list pasted into the commit message**.
**e2e:** **exactly one `<h1>` with a non-empty accessible name** on the manage screen, at both
widths — a lockup rendered as an image with an empty `alt` would leave the page with no `h1` at
all, and that is the specific way this change fails silently.
**Mutation:** give the lockup `alt=""` → the single-`h1` e2e case goes red. Revert the marker to
`'Via Bianca Dashboard'` → the `ADMIN_MARKERS` presence check goes red.

### D10 — Numbers: the four cards *(blocked on B2 for `COUNTING_STARTED_ON`, on C1 for the type)*

**Stream:** D.
**Files:** `src/admin/areas/NumbersArea.tsx` *(new)*, `src/admin/manage/analytics.ts` *(new)*,
`src/admin/manage/__tests__/analytics.test.ts` *(new)*,
`src/admin/areas/__tests__/NumbersArea.test.tsx` *(new)*, `e2e/edit-backend.ts`.
**Change:** One `GET /api/analytics` fetch — one loading state, one error state, four cards. Not
four routes and not four spinners. `NumbersArea` takes `active: boolean` and a `useRef` latch:
the request fires on the first render where `active` is true and **never again in that session**
(there is no mount event under mount-and-hide, and `IntersectionObserver` neither fires for a
hidden ancestor nor exists in jsdom). Loading is **four skeleton cards with their real headings
already visible**. `COUNTING_STARTED_ON` is an exported constant set to B2's landing date, never a
hand-typed literal in copy, formatted by one function. `labelForPath(path, pages)` is a **pure
exported function** — extracted precisely so it can be table-tested. The Retry button is
`type="button"`. `e2e/edit-backend.ts` gains `**/api/analytics` with a populated fixture and a
zero-data fixture, both built from C1's types.
**Verified by:**
- `src/admin/manage/__tests__/analytics.test.ts` — `labelForPath` as a table test: a known
  `pages.json` slug, `/`, `/blogs`, an unknown path, `/catering/` with a trailing slash,
  `/catering?utm_source=ig`. Card D's comparator: `change` of **exactly 0.15 → busier**, exactly
  **−0.15 → quieter**, **0.149 → about the same**; `priorWeekVisits` of **19 → "not enough
  history"**, **20 → a verdict**.
- `src/admin/areas/__tests__/NumbersArea.test.tsx` — all four zero-data strings; the
  counting-started banner and its constant; both error sentences (`unreachable` vs
  `upstream-auth`, which need different human actions); the skeleton state showing the four real
  headings; Card A's relationship line **absent** at zero visits and **absent** below 7 days of
  data; Card A's zero state is the **single-sentence** form, not two numbers side by side; the
  rendered text matches `/at least \d+/` and does **not** match `/\d+ bookings?/`; the
  lower-bound caveat is present; **`NumbersArea` fetches once** — navigating away and back fires
  no second request.
- `ManageShell.test.tsx`'s existing case: clicking Retry does **not** open the publish
  confirmation.
**Mutation:** drop "at least" from Card A → red. Make `labelForPath`'s fallback return `''` → the
unknown-path row goes red. Change the comparator to `> 0.15` → the exactly-0.15 case goes red.
Remove the `useRef` latch → the fetches-once case goes red.

### D11 — refused-publish routing *(must land after W2 — shared file `worker/index.ts`)*

**Stream:** D, but edits one Worker file. **Last D task for exactly that reason.**
**Files:** `src/content/validate.ts`, `worker/index.ts` (the 422 `flatMap` only),
`src/admin/PublishBar.tsx`, `src/admin/__tests__/PublishBar.test.tsx`,
`worker/__tests__/index.test.ts`.
**Change:** `ValidationProblem` (`src/content/validate.ts:45`) gains an **optional
`file?: ContentFileName`**. The Worker already knows `f.path` where it builds the array, so
tagging is one `.map` inside the existing `flatMap`; optional means every existing producer and
consumer still typechecks. `PublishBar` renders each tagged problem with a link — "Fix this in
Menu → Dishes" — built from `areas.ts`'s panel→file map, calling `saveSectionOpen(id, true)`
before navigating. An untagged problem renders exactly as today.
**Why this matters:** after D6b she is told to fix something and the inline red message that
would locate it is inside a `hidden` container — invisible to her **and** to find-in-page — and
spec §12 rules out a search. This is the worst state the redesign introduces. Note the spec's own
correction: the client-side pre-publish list never renders on this surface (`AdminApp` does not
pass `problems`, which defaults to `[]`); the path that strands her is the **server's 422**.
**Verified by:**
- `worker/__tests__/index.test.ts` — a 422 from a malformed file carries `file` set to that
  file's name on every problem it produced.
- `src/admin/__tests__/PublishBar.test.tsx` — a tagged problem renders a link whose text names
  the area and panel and which routes there with that panel's fold open; an **untagged** problem
  renders exactly as it does today (this second case is what proves the change is additive).
**Mutation:** drop the `.map` that tags `file` in the Worker → the `index.test.ts` case goes red
and the `PublishBar` tagged-problem case goes red. Make the link omit `saveSectionOpen` → the
fold-open assertion goes red.

### D12 — the area problem marker

**Stream:** D.
**Files:** `src/admin/manage/ManageShell.tsx`, `src/admin/manage/AreaNav.tsx`,
`src/admin/manage/__tests__/ManageShell.test.tsx`.
**Change:** One `MutationObserver` per area container watching for any `[role="alert"]` anywhere
inside it — mirroring `CollapsibleSection`'s existing implementation rather than inventing new
plumbing, and covering both load failures and inline field problems, since every section here
already uses `role="alert"` for both. Rendered at **both** `AreaNav` variants. Plus the **unsaved
dot**, derived from the same dirty-file set mapped through `AREAS[].panelIds`. The two must be
visually distinguishable — they are different signals.
**Why separate from D6b:** `CollapsibleSection`'s decision #2 exists because a `dishes.json` that
would not load looked exactly like one she had not opened yet. D6b adds a **second** level of
hiding; this is the second-level answer to it, and it is a distinct claim worth failing on its
own.
**Verified by:** `ManageShell.test.tsx` — a panel raising a `[role="alert"]` marks its area in
the nav, at both variants; an area with unsaved work carries the dot; the two markers are
distinguishable (different accessible names).
**Mutation:** narrow the observer to direct children only → the marker case goes red for a
problem raised deep in a panel. Render the same element for both signals → the
distinguishability case goes red.

### D13 — the three heading renames *(its own commit, after everything above is green)*

**Stream:** D. Spec §1: deliberately **not** in the same commit as the move, because renaming a
heading alongside 1300 moved lines makes every regression indistinguishable from a rename.
**Files:** `src/admin/areas/MenuArea.tsx`, `src/admin/areas/DetailsArea.tsx`,
`src/admin/areas/PagesArea.tsx`, `e2e/dashboard-sections.spec.ts`,
`src/admin/__tests__/AdminApp.test.tsx`, `src/admin/__tests__/panel-snapshots.test.tsx`.
**Change:** `Menus` → **Menu PDFs**; `Page copy` → **Words on the site**; `Homepage sections` →
**What shows on the homepage** (which also removes the "Pages → Pages" collision, where a child
repeats its parent's name with no breadcrumb to tell them apart). **Ids do not change** — only
the `heading` strings and the test literals that quote them.
**Verified by:** `src/admin/manage/__tests__/areas.test.tsx` — the `aria-controls` pin passes
**unchanged**, which is the whole proof that this rename cost nothing in stored fold state
(`open-sections.ts` builds its key from `id`, never from `heading`, and its own comment says so).
The three snapshots update; nothing else does.
**Mutation:** change an `id` instead of a `heading` → the `aria-controls` pin goes red, which is
precisely the failure this task is shaped to avoid.

---

## Ordering summary

```
C1  (shared type — blocks W3 and D10)
 |
 +-- W1 -> W2 -> W3 -> W4 -> W5 ................ Worker         [needs P0, P1]
 |                                  \
 +-- B1 -> B2 ................................. Beacon          [needs P2; rebase doc onto W5]
 |          \
 +-- D1 -> D2 -> D3 -> D4 -> D5 -> D6a -> D6b -> D7 -> D8 -> D9 -> D10 -> D11 -> D12 -> D13
                                                                 ^        ^
                                                                 |        |
                                                        needs B2 +        + needs W2
```

- **W and B are parallel with each other and with D**, except: B2's doc edit rebases onto W5, D10
  needs B2's date, and D11 needs W2's `worker/index.ts` to have landed.
- **The repo is green after every task.** D6a in particular is behaviour-neutral: ten panels, one
  page, same folds, `dashboard-sections.spec.ts` passing unchanged.
- **Risky structural work is D1–D6b.** Cosmetic work is D9. They do not share a commit.
- **The three tasks with no automated verification** are W5 (prose), P1 and P2 (outside the
  repo). Every other task names a test that can go red.

## Final gate

```
npx tsc -b --noEmit && npm test -- --run && npx eslint . && npm run test:e2e && npm run test:csp
```

Plus, per spec §11 and the repo's standing rule: every mutation listed above is actually run, the
test confirmed red, the code restored, and the mutation recorded in its commit message.
