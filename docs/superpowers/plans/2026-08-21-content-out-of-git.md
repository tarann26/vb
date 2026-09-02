# Content out of git: every reader exists before any writer moves

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **AMENDMENT, 2026-09-02 — the photographs are served from the main domain, not from a subdomain.**
>
> This plan was written around `img.viabiancarestaurant.com`, an R2 custom domain. The owner chose the main domain instead: **`viabiancarestaurant.com/images/*` is a Worker route** answered by `worker/images.ts`, which reads the object out of the R2 binding. Taken before anything had migrated — not one of the seventy-seven references had moved — which is the cheapest moment such a decision can be changed. The full reasoning is in the design spec's "R2's public URL is not usable in production", which now records this decision instead of the one it superseded.
>
> **What every reader of this plan has to carry:**
>
> - `IMAGE_HOST` is now `IMAGE_BASE`, and its value is the site-root prefix `/images`, not a hostname. A rewritten reference is `/images/food/pizza1.webp`.
> - **Task 1's Step 5 is void.** There is no `img-src` to widen: `public/_headers` stays `img-src 'self' blob:`, because a same-origin photograph needs no exemption. The ordering hazard that step existed to spend is gone with it — nothing has to ship before the references may move.
> - **Task 1's custom-domain and HTTPS-round-trip steps are void.** No DNS record, no public-access change on the live zone. What Task 4 waits on instead is a **deploy**: the `/images/*` route and `worker/images.ts` must be live, or the migration's read-back gets Pages' SPA catch-all (`index.html`, 200, `text/html`) and fails every object. `docs/cloudflare-cutover.md` §21 carries the check.
> - **`wrangler.toml`'s `routes` array must list all three patterns** — `/api/*`, `/blog/*`, `/images/*` — because `wrangler deploy` replaces the deployed list with exactly what the file declares.
> - **Task 6's Step 5 needs rewriting before it is run.** Its premise was that rewritten content strings "start with `https://`" so `ASSET_PATH_PATTERN` stops matching and the walk goes vacuous. The opposite is now true: `/images/food/x.webp` still matches, so `src/content/__tests__/assets.test.ts` goes **red**, demanding those files exist under `public/`. The guardrail change it needs is an exclusion for the image prefix (checked against R2 by `npm run verify:images`, which sweeps the live site) rather than a second accepted shape — and whatever replaces it must not be able to go vacuous.
> - **The recorded byte counts in Task 6 and in the runbook are stale.** They were measured against a 35-character host prefix; the prefix is 7 characters now. Re-measure; do not carry the old numbers forward.
>
> Everything else in this plan — the ordering, the manifest, the refusal, the four boundaries, the D1 work — is unaffected.

**Goal:** Make Publish instant and stop redeploying the whole website to change a dish description — without ever creating a moment in which a photograph or a paragraph exists in one place and cannot be read from another.

**Architecture:** Ordered by **read-before-write, strictly.** Nothing that *stores* content changes until the thing that *reads* it is live in production and proven there.

- **Tier 0 (1–3)** builds three instruments: the bucket bound and proven with a real round trip; an inventory counted from reality, including the four references that exist only as D1 rows; and **the derivative answer, settled and measured before a single object moves.**
- **Tier 1 (4–7)** puts every photograph in R2, fetched from the production CDN rather than from a developer's disk, verifies each object over real HTTP, wires the live sweep into `verify:deploy` and proves it green against the un-rewritten site, and only then rewrites the references — 68 in content, 9 in code, 4 more that live only in D1 and are rewritten through the real publish endpoint.
- **Tier 2 (8–12)** builds the entire Worker render path — floor, edge cache, D1 read, injected JSON island, crawler-readable menu — and ships it to production **while every content document is still in git**, so the render change is proven against content that cannot have moved.
- **Tier 3 (13)** proves the D1-unreachable contract, in writing and in production, *before* anything depends on it.
- **Tier 4 (14–17)** moves documents into D1 in batches of 4/2/1/2, lowest SEO first and the menu last.
- **Tier 5 (18–21)** changes the write paths — browser derivative wired in, R2 upload with no commit, the menu PDFs, and finally `commitFiles` and the Worker's `GITHUB_TOKEN` secret deleted outright.
- **Tier 6 (22–23)** is the weekly export, the floor's honest header, and the four live proofs the spec demands.

**The structural claim this ordering buys:** at no task boundary is there a byte of content or a photograph that some reader cannot reach.

**Tech Stack:** React 18 + TypeScript (solution-style project references), Vite, Tailwind (JIT, content-scanned), Vitest + jsdom (`src/`, `scripts/`, `worker/`), Playwright (`e2e/`), Cloudflare Pages + Workers + KV + D1 + R2, `sharp` at build time for the share card and the re-encode escape hatch only, `canvas.toBlob` in the browser for every new photograph.

**Spec:** `docs/superpowers/specs/2026-08-21-content-out-of-git-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section. The first block is copied from the project rules and is non-negotiable.

- `npx tsc -b --noEmit` is the **only** typecheck that works here (solution-style tsconfig). `noUnusedLocals` is on, so a helper whose last call site a task deletes is a hard build failure, not a warning.
- **Every test must be able to fail, proven by mutating the code and watching the NAMED test go red.** Eight unfalsifiable assertions have been caught on this project; one compared rendered text against the very constant that produced it, so both sides matched by construction. Every task below carries a mutation table and every row of it is to be *run*, not reasoned about. **Report any mutation that did not redden.**
- **Commit before you mutate.** Two implementers here destroyed uncommitted work with `git checkout --`, each catching it only because a run went green that should have been red. Every task ends green and committed *before* its mutation table is worked through.
- **Never read a test summary through `tail`.** That has twice reported a green suite here while the truncated line said "7 failed". Read the whole reporter output.
- jsdom has **no layout engine**. Geometry and computed-style claims go in `e2e/`, never `src/test/`.
- `e2e/*.spec.ts` is in **no** tsconfig project. `npx tsc -b --noEmit` checks not one line of it and Vitest does not typecheck; running the spec is the only check it gets.
- Tailwind's content scanner is a plain text extractor with **no JS parser**. A utility-class-looking word in an ordinary prose comment inside `./src/**` or `./index.html` mints a real CSS rule. Eight leaks have happened here, the most recent from the phrase "a bare lowercase word". **Every task that writes a comment into `src/` or `index.html` ends with a re-read of that comment for bare utility tokens.** The words this plan's own subject matter drags in, and which must never appear bare in a `src/` or `index.html` comment: `resize`, `hidden`, `visible`, `invisible`, `grid`, `flex`, `block`, `inline`, `table`, `container`, `static`, `fixed`, `absolute`, `relative`, `sticky`, `filter`, `contents`, `isolate`, `transform`, `truncate`, `shrink`, `grow`, `order`, `collapse`, `uppercase`, `lowercase`, `italic`, `underline`. `worker/`, `e2e/`, `docs/`, `scripts/`, `.github/`, `wrangler.toml` and `public/_headers` are outside the glob and are not subject to this.
- **The entry CSS ceiling is 39600 against a measured 39441: 159 bytes of headroom** (`src/test/bundle.post-build.test.ts:1134`). A task that breaches it **raises it in the same commit**, to a measured number, with a rule-level accounting. Every task below states its own CSS-ceiling consequence. **No task may leave the branch red.**
- **The hero collage is under an explicit owner constraint and has its own geometry tests. No task in this plan changes its behaviour.** Its images migrate exactly like every other image and its markup is not touched.
- **Never mention AI or any AI assistant in a commit message, and never add a co-author line.**
- `npm test` and `npm run test:deploy` are different commands over different file sets. Only `test:deploy` runs on Cloudflare, and `scripts/__tests__/images.derivatives.test.mjs` and `src/test/homepage-bytes.test.tsx` must stay excluded from it.
- A push to `main` deploys **Pages only**. Worker changes need `npx wrangler deploy` separately, and **that command replaces the Worker's route list with exactly what `wrangler.toml` declares** and replaces its cron schedule with exactly what `[triggers] crons` declares.

Eight more, specific to this plan.

- **A BROKEN PHOTOGRAPH ON THE LIVE SITE IS THE FAILURE THIS MIGRATION IS MOST LIKELY TO SHIP.** Every image guard here is layered: a byte-level refusal at the bucket boundary, a shape check offline, a manifest parity check offline, and a **live HTTP sweep of every reference the live site can serve** in `npm run verify:deploy`. The live sweep is the one that governs. A fixture agreeing with a fixture proves nothing.
- **Measured facts this plan rests on, all re-derived against the tree on branch `content-out-of-git`.** `public/*/` **is gitignored** (`.gitignore`), so the 50 derivatives under `public/<category>/` are *not* tracked — `git ls-files | grep -c '\.webp$'` is 0. The repository's real weight is `assets-source/` (**201 MB**, 50 originals plus one 6.5 MB print PDF) and `public/menus/*.pdf` (**20 MB**, two files). `public/` holds 56 image files and 23 MB in the working tree: 50 derivatives, 5 tracked icons, and the gitignored `og-image.jpg`.
- **The reference census is 69 strings in `src/content/*.json`, of which 68 move.** `grep -ohE '"/[^"]*\.(webp|jpg|jpeg|png|svg)"' src/content/*.json | wc -l` returns 69 (dishes 15, galleries 25, press 12, experiences 6, pages 5, posts 3, drinks 1, site 1, story 1). The 69th is `site.json`'s `seo.ogImage: "/og-image.jpg"`, which `worker/post-seo.ts` and `src/components/SeoHead.tsx` turn absolute by prepending `site.seo.url`. **It stays at `/og-image.jpg`.** That is the whole reconciliation between "68" and what grep prints, and it is stated here so nobody re-derives it under pressure at Task 6.
- **Nine more references live in code, not in content, and they are counted and moved too.** `src/index.css:196` (`url("/hero/brick.webp")`), `src/components/Hero.tsx:128`, `src/components/ChefGallery.tsx:13`, `src/components/SignatureMocktails.tsx` ×5 (lines 14, 19, 24, 29, 34 — three of those filenames contain spaces), and a doc comment in `src/content/types.ts:187`. **68 + 9 = 77.** A plan that moves 68 and leaves nine behind leaves the homepage's own texture and five mocktail photographs pointing at a directory that is about to stop being deployed.
- **Four of the 68 live only in D1, not in any committed file.** `story.json` (1) and `posts.json` (3) are in `worker/store.ts`'s `D1_ONLY_PATHS`, so the committed files are a fallback floor and the served bodies are D1 rows. Task 2 reads them over `/api/published` and refuses to write an inventory it could not complete; Task 7 rewrites them through `POST /api/publish`.
- **`press.json` does not move to D1.** It is statically imported by `src/content/index.ts` and is part of `ContentBundle`, but it is **not** in `src/admin/content.ts`'s `CONTENT_FILES` — she cannot edit it from the dashboard, so moving its storage removes no commit and no deploy. Its 12 image references are rewritten in Task 6 like every other reference, and it is read from the compiled bundle forever.
- **Twelve documents move through the read path; nine of them change store.** `CONTENT_FILES` names twelve: site, galleries, dishes, drinks, story, menus, copy, sections, pages, awards, experiences, posts. Three (awards, story, posts) are already D1-only. Tier 4 moves the remaining nine.
- **D1 free returns errors at its limits; it does not throttle.** The read path is built so that one page view costs **twelve row reads on a cache hit and twenty-four on a miss**, against a 5,000,000 row-reads-per-day allowance. That is roughly 416,000 cache-hit page views a day of headroom against a site serving a few hundred. The number is written here so no task re-derives it, and Task 9's comment carries it into the code.

---

## THE DERIVATIVE PROBLEM, ANSWERED — and what it costs

**The problem, stated exactly.** `npm run build` is `npm run images && tsc -b && vite build && npm run test:bundle`. `scripts/images.mjs` loads `sharp`'s native binding at module scope and reads originals out of `assets-source/`. If originals leave the repository, that step has nothing to read. **A Cloudflare Worker cannot run `sharp`** — workerd executes no native code — and every Cloudflare resizing product (Images, `/cdn-cgi/image/`) is billable, which the owner has ruled out. So there is no server-side encoder available at any price the owner will pay.

**The answer, in two halves split by time.**

**Half one — the 50 photographs that already exist are never re-encoded at all.** They are **fetched from the production CDN** and put into R2 byte-for-byte, verified by SHA-256 on both ends and by a read-back from `img.viabiancarestaurant.com` rather than from the bucket API.

**Not from local `public/`, and this is a correction the plan makes against the obvious approach.** `public/*/` is gitignored (verified: `git ls-files` lists zero tracked `.webp`). The `.webp` files on a developer's disk are a local build artefact produced by whatever `sharp` and `libwebp` that machine happens to have. What the site actually serves was produced on Cloudflare's build image. Those two are *usually* identical and are not guaranteed to be. Copying the local files would make the headline claim — *"every photograph is the identical file the site served before it"* — false in a way nothing would ever detect. Fetching the live object makes the question unaskable.

**Half two — every new upload from here on is encoded in the owner's browser, and the Worker never encodes anything.** `src/admin/derive.ts` decodes the picked file through an `<img>` (which applies EXIF orientation in every browser since 2020, replacing `sharp.rotate()`), downscales it in halving steps, and encodes with `canvas.toBlob(cb, 'image/webp', 0.78)`. This repository already runs a WASM HEIC decoder in this owner's phone for this exact upload (`src/admin/heic.ts`), so the capability is demonstrated in production rather than assumed.

**What it costs, in numbers this plan measures rather than estimates.** Task 3 encodes **three real photographs both ways** — `sharp` at quality 78, and Chromium's canvas at 0.78 — and records the byte delta in `docs/image-derivation.md`. An estimate is not permitted: the number that goes in that file is one somebody ran. The expected direction is that the browser output is larger, because a canvas encode uses a lower encoder effort at the same nominal quality and downscales with the browser's filter rather than Lanczos. **If a browser derivative is more than 40% larger than sharp's, `WEBP_QUALITY` drops to 0.72, both attempts are re-measured, and both are recorded.** R2 egress is free and the objects carry a year-long immutable cache header, so the cost lands on first paint and nowhere else.

**Three mitigations, each of which is a real file rather than a sentence.**

1. **The untouched original is stored beside every derivative**, under a `source/` prefix. Nothing serves it.
2. **`scripts/rederive.mjs` (Task 20) is the escape hatch that actually executes.** It pulls an original out of the `source/` prefix, re-encodes it with the real `encodeDerivative` **imported from `scripts/images.mjs`, not copied**, and puts the result back under the same key. Same key means no content file moves and no cache entry needs purging beyond the key's own policy. A plan that stores originals "for any future re-encode" and never builds the thing that re-encodes them has not mitigated anything.
3. **A JPEG fallback at quality 0.82.** `canvas.toBlob` does not fail on an unsupported type — the specification says it silently falls back to `image/png`, and Safari before 16.4 did exactly that. A PNG of a photograph is several times the size of the WebP it replaced, so shipping one unnoticed makes the menu slow rather than broken, which is the kind of failure nobody reports. So the produced blob's `type` is checked, and if it is not `image/webp` the canvas is re-encoded as JPEG at 0.82 and stored **under the same `.webp` key with `Content-Type: image/jpeg`** — browsers obey the served type and ignore the extension. **This keeps her working and costs one photograph's compression ratio.** Refusing the upload and telling her to find another browser is the alternative, and it is worse: she is holding a phone, in a restaurant, and the answer "use a different browser" is not one she can act on.

**What breaks if this is wrong, and what stops it.** A browser that produced something unservable would put a broken photograph on the live menu. So the Worker sniffs the derivative's bytes and rejects anything that is not WebP or JPEG with a 400, and rejects a "derivative" larger than its own original with a 400 (derivation did nothing, or went backwards). The original is stored in every case, so **the photograph itself is never lost**: the worst outcome is one photograph that looks softer than the fifty beside it until somebody runs `npm run rederive`.

**`assets-source/` is not emptied and `npm run images` is not deleted by this plan.** See *What is deliberately not in this plan*.

---

## Decisions this plan makes where the spec is silent

Collected so a reviewer can reject one without reading twenty-three tasks. Each is restated inside the task that implements it.

**D0 — THE WORKER ONLY EVER SPEAKS FOR A PATH IN `D1_ONLY_PATHS`.** This is the single most important line in the plan and it is the correction that keeps the whole middle of the migration from being invisible-but-broken.

The Worker injects a JSON content island into every page, and the browser prefers the island over its compiled bundle. `worker/snapshot.ts` — the compiled floor — reaches production **only on `npx wrangler deploy`**. A push to `main` deploys Pages only. So if the island carried a document that is still backed by GitHub, this happens: she publishes a dish description, `POST /api/publish` writes a commit, Pages rebuilds a bundle containing the new text, the Worker overwrites it with a floor frozen at the last `wrangler deploy`, **and her publish is invisible on the live site until a human redeploys the Worker.** That is precisely the symptom the spec singles out — *"it would look to her like the publish silently failed"* — arriving as the fix for it. It would have spanned five tasks and ended on `dishes.json`, the most-searched content on the site.

The condition, applied in one place:

- **The island** carries a document if and only if **(a)** its path is in `D1_ONLY_PATHS` **and (b)** a D1 row actually answered for it. Anything else is omitted entirely and the freshly-built compiled bundle answers. Condition (b) is (a) taken to its boundary: with D1 unreachable, a D1-backed document falls out of the island too, and the browser renders the compiled copy — which the weekly export keeps current and which can only ever be *fresher* than the Worker's floor, never staler.
- **The crawler menu block** is built from documents in `D1_ONLY_PATHS` only, using a D1 row where one answered and the compiled floor where one did not. It does **not** require condition (b), because a crawler that runs no JavaScript has no compiled bundle to fall back to — there is no fresher alternative for the Worker to lose to.

**The consequence, stated plainly rather than buried:** until Task 17 flips `dishes.json` and `drinks.json`, **there is no crawler-readable menu**, and publishing a GitHub-backed document still takes a Pages build — exactly as it does today. Nothing regresses; the improvement arrives per document, at the task that moves it. `worker/__tests__/site-page.test.ts` pins both halves.

**D1 — The Worker route widens to `/*`, not to an enumerated list of pages.** An enumerated list (`/`, `/blogs`, `/catering`, …) is smaller and safer-looking, and it is wrong for one decisive reason: `pages.json` is dashboard-editable and moves to D1 at Task 15. After that she can add a page from the dashboard, instantly, and that page's URL would be answered by Pages' SPA catch-all with **no content island** — the SPA would fall back to the compiled bundle, not find the page, and render its own 404. That is precisely the "content is in D1 but something cannot read it" state this plan is arranged to make impossible. The cost is that every asset request also enters the Worker; Task 12 answers that with a passthrough that rewrites nothing.

**D2 — The shell is fetched from the Pages project hostname, not from the site origin.** `worker/post-page.ts` today fetches `/index.html` on the request's own origin and its header comment names "`/index.html` matches neither route" as a load-bearing anti-loop property. Widening to `/*` destroys that property. So both `post-page.ts` and the new `site-page.ts` fetch `${env.PAGES_ORIGIN}/index.html`, a `pages.dev` hostname matched by no route. **THAT HOSTNAME IS `https://vb-c7r.pages.dev`, NOT `https://vb.pages.dev`.** This plan originally spelled it `vb.pages.dev` in five places and Task 1 shipped that string; `vb.pages.dev` is a live, unrelated third party's website (the `-c7r` is Cloudflare's collision suffix, because the bare name was taken), and it serves no CSP. Under this decision that would have made every page view on viabiancarestaurant.com serve a stranger's HTML from this site's own origin, unpoliced. It is corrected throughout below; read it off `npx wrangler pages project list` and derive it from nothing. The shell is still fetched **live** on every request, which is Phase 5C's decision D2 unchanged and for its original reason: asset filenames carry the commit, so any cached copy of the shell points at URLs that 404 the moment Pages redeploys.

**D3 — The rewritten HTML is never cached; the two pieces built from D1 are.** Caching the assembled page would cache the shell inside it and reintroduce exactly the staleness D2 exists to remove. So the Cache API holds only the **island string** and the **crawl string**, keyed on a stamp built from the twelve documents' D1 versions. A publish bumps a version, the stamp changes, the old key is never asked for again. **There is no purge call anywhere in this plan** — the same mechanism `worker/published.ts` already proves, and the reason the spec's "publishing must invalidate the edge cache" requirement is satisfied by construction rather than by an API token that can fail silently.

**D4 — A document with no D1 row reads from the floor, and that is what makes each migration atomic.** The ritual is: seed the row with the exact current committed bytes → verify the stored SHA-256 → *then* add the path to `D1_ONLY_PATHS` and deploy. Between the seed and the flip the row and the compiled copy are byte-identical, so a request landing in that window is right either way.

**D5 — The crawler-readable menu is markup inside `#root`, reusing the `#vb-fallback` mechanism that already ships.** `src/main.tsx` calls `root.replaceChildren()` before rendering, so anything the Worker injects into `#root` is removed the instant the bundle runs. That removal path already exists and needs no client change. **Its CSS lives in `index.html`'s inline `<style>`, not in the Tailwind entry sheet, so the CSS ceiling is untouched by it.**

**D6 — Content is stored in D1 as the same JSON documents, unchanged.** The spec argues this at length and this plan adds nothing to the argument.

**D7 — The weekly export runs in GitHub Actions, not in the Worker's `scheduled` handler.** `worker/github.ts`'s path allowlist is, in its own words, the only thing standing between a publish request and the rest of the repository, and a Worker-side export would want it widened to write `worker/snapshot.ts`. Actions can write any path, needs no widening, and costs nothing against the Workers request budget. **By Task 21 the Worker has no GitHub token at all, which retires this question permanently.**

**D8 — Two Cache-Control policies, split on the shape of the key.** A twelve-hex stem (`food/0123456789ab.webp`) is content-addressed: the bytes under that key can never legitimately change, so it gets `public, max-age=31536000, immutable`. Everything else is a legacy human-named key (`food/pizza1.webp`) or a stable menu name (`menus/food-menu.pdf`) that can in principle be re-uploaded, so it gets `public, max-age=86400`. **One blanket week-long TTL would make replacing a legacy-named photograph or a menu PDF invisible for a week**, and this migration has no purge mechanism for R2. One day is long enough that the edge answers nearly every request and short enough that a correction appears without one.

**D9 — Orphaned R2 objects are left in place, deliberately.** At ~100 objects, 224 MB, a 10 GB free allowance and a restaurant's rate of change, reclaiming is a rounding error — and deleting on content change is exactly how this project already deleted a photograph that was still in use. **No lifecycle rule is ever pointed at a live prefix.** This decision is load-bearing twice more: it is why undo can restore a document that names an older photograph and have that URL still answer (Task 23), and it is why Task 5's sweep of the union of live and committed references can produce no false positives.

**D10 — `og-image.jpg` stays on the site origin; the two menu PDFs move to the bucket at Task 19.** `og-image.jpg` is generated by `encodeOgImage()` rather than by `outputPathFor`, and `SeoHead.tsx` and `post-seo.ts` build its absolute URL by prepending `site.seo.url` — moving it would make that prepend produce nonsense. The PDFs are different: they are 20 MB of committed binaries and the last upload path that writes a commit, and Task 19 takes both.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/shared/image-host.ts` | `IMAGE_HOST`, `imageUrl(key)`, `keyFromImageUrl(url)`. One definition, shared by the Worker, the browser and the scripts. |
| `src/shared/image-widths.ts` | The width-cap rule, re-implemented for the browser and pinned to `scripts/paths.mjs`. |
| `src/admin/derive.ts` | `derive()` — the browser encode, its halving downscale, and the JPEG fallback. |
| `scripts/image-inventory.mjs` | Walks content, code and the **live** D1 documents; refuses to write an incomplete inventory. |
| `docs/image-inventory.json` | The recorded census: every reference, where it sits, and which store it came from. |
| `docs/image-derivation.md` | Three real photographs, encoded both ways, with the measured byte delta and the verdict. |
| `scripts/migrate-images.mjs` | Fetches the live derivatives from the CDN, refuses anything that is not a complete WebP, uploads, reads back over HTTPS, compares digests. |
| `image-manifest.json` | Every object this migration created: key, byte length, SHA-256, content type, verified-at. |
| `src/test/imageManifest.ts` | Loads the manifest for tests, the way `src/test/publicFiles.ts` loads `public/`. |
| `scripts/verify-image-urls.mjs` | Sweeps every image reference the live site can serve, over real HTTP. Wired into `verify:deploy`. |
| `scripts/rewrite-image-refs.mjs` | The one-time rewrite of 68 content references + 9 code references, refusing unless every target is verified. |
| `scripts/rewrite-d1-images.mjs` | Builds the `POST /api/publish` body that rewrites `story.json` and `posts.json` in D1. |
| `scripts/export-content.mjs` | Reads every document out of D1 and writes `src/content/*.json` and `worker/snapshot.ts`. |
| `scripts/seed-content.mjs` | Seeds documents into D1 and verifies the stored SHA-256 before exiting 0. |
| `scripts/rederive.mjs` | Pulls an original from `source/`, re-encodes with the real `encodeDerivative`, puts it back under the same key. |
| `worker/content-bundle.ts` | One D1 read, one cache entry, one floor, and **D0's island rule**. The whole content read path. |
| `worker/site-page.ts` | The shell rewriter: the JSON island, the crawl block, the asset passthrough. |
| `worker/crawler-menu.ts` | Dishes and drinks as escaped HTML. No React, no markdown. |
| `worker/r2.ts` | Every bucket statement this migration issues, plus `cacheControlFor`. |
| `worker/__tests__/fakeR2.ts` | An `R2Bucket` stand-in in the shape of `fakeD1.ts`. |
| `src/content/live.ts` | Reads the island, validates it with the same guards, merges it over the compiled bundle. |
| `docs/d1-unreachable.md` | The layer-by-layer contract, including its two honest negatives. |
| `.github/workflows/content-export.yml` | The weekly export commit. |
| `e2e/content-island.spec.ts`, `e2e/photo-upload.spec.ts`, `e2e/d1-unreachable.spec.ts`, `e2e/menu-download.spec.ts`, `e2e/publish-live.spec.ts` | Everything jsdom cannot honestly assert. |

**Modified**

| File | Change |
|---|---|
| `wrangler.toml` | `[[r2_buckets]]`, `PAGES_ORIGIN`, `IMAGE_BASE`, the widened `routes` list (all three patterns, `/images/*` among them), `CONTENT_STORE = "d1"`. |
| `public/_headers` | ~~`img-src` admits the image host.~~ **Unchanged** — see the amendment: a same-origin photograph needs no exemption. |
| `scripts/check-csp.mjs` | ~~Probes a real image load from the image host.~~ **The probe is removed** — every route it visits already loads same-origin photographs, so a dedicated probe would be a weaker copy of what the page does. |
| `scripts/images.mjs` | `encodeDerivative` exported and taking its width, so `rederive.mjs` imports it. |
| `worker/index.ts` | `servesPages`, the `/*` branch, the `/images/*` branch and its `Cache-Control` exemption, `Env` grows `R2`/`PAGES_ORIGIN`, `handlePublish` step 5's stale read fixed, `GET /api/build-status` removed. |
| `worker/post-page.ts` | Fetches the shell from `PAGES_ORIGIN`. |
| `worker/post-seo.ts` | `absoluteImageUrl` fixed for absolute inputs; `SITE_SEO_URL` read from the floor. |
| `worker/store.ts` | `D1_ONLY_PATHS` grows in four batches. |
| `worker/snapshot.ts` | Twelve entries instead of three. |
| `worker/upload.ts` | Two-part upload, R2 writes, no commit; `handleMenuUpload` retired. |
| `worker/github.ts` | `ASSET_PATH`, then `MENU_PATH`, then `CONTENT_PATH` and `commitFiles` — deleted in that order. |
| `worker/published.ts` | One comment recording the cache-hit cost of a D1 failure. No behaviour change. |
| `src/main.tsx` | Wraps the app in `ContentProvider` with the live bundle. |
| `src/index.css`, `src/components/Hero.tsx`, `ChefGallery.tsx`, `SignatureMocktails.tsx`, `src/content/types.ts` | The nine hardcoded references. |
| `src/content/__tests__/assets.test.ts` | The guardrail moves from "resolves under `public/`" to "resolves under `public/` **or** sits under the image prefix, where `npm run verify:images` is what checks it against the live bucket", plus a straggler detector. See the amendment: the shape it must handle is a path, not a URL. |
| `src/admin/upload-photo.ts`, `publish.ts`, `staged.ts`, `undo.ts`, `PublishBar.tsx` | No photo bytes in a publish; no build poll; the copy that says "2-3 minutes". |
| `scripts/verify-deploy.mjs` | The live image sweep, the crawler menu check, the route list read from the island, a production asset pass. |
| `package.json` | `images:inventory`, `migrate:images`, `verify:images`, `seed:content`, `export:content`, `rederive`. |
| `index.html` | The `#vb-crawl` reveal CSS. |
| `src/test/hosting.test.ts`, `src/test/wrangler-config.test.ts`, `src/test/gitignore.test.ts` | The new routes, bucket, vars and ignores. |

**Deleted**

`public/menus/food-menu.pdf`, `public/menus/drinks-menu.pdf` (Task 19), and `worker/github.ts`'s write half plus `GET /api/build-status` (Task 21). **`assets-source/` and the 50 derivatives in `public/` are not deleted by this plan** — see the closing section for the separate commit and its precondition.

---

## The order, in one table

| # | Task | Reads | Writes | Site state if it fails |
|---|---|---|---|---|
| 1 | Bind `via-bianca`, prove a round trip, route `/images/*` to the Worker | one probe object | one probe object, deleted | unchanged |
| 2 | The inventory, including the four D1-only references | live `/api/published` | `docs/image-inventory.json` | unchanged |
| 3 | **The derivative answer, settled and measured** | `assets-source/` | `docs/image-derivation.md` | unchanged; nothing calls the encoder |
| 4 | Copy the live bytes into R2, digest-verified over HTTPS | production CDN | R2 | unchanged; nothing points at R2 |
| 5 | The live sweep, wired into `verify:deploy` | live site | — | unchanged; proven green on a known-good site |
| 6 | **Rewrite 68 content + 9 code references; fix `absoluteImageUrl`** | R2 | `src/content/*.json`, `src/**` | one `git revert`; `public/` still holds every file |
| 7 | Rewrite the two D1 documents through `POST /api/publish` | live D1 | D1 | one undo from the dashboard |
| 8 | The floor covers twelve documents | committed files | `worker/snapshot.ts` | unchanged; nothing reads the new entries |
| 9 | `content-bundle.ts` — one read, one key, one floor, **D0** | D1 + floor | — | unchanged; unreachable code |
| 10 | `site-page.ts` — island and crawl block | bundle | — | unchanged; no route yet |
| 11 | The browser reads the island | island | — | unchanged; no island in production yet |
| 12 | **Widen route to `/*`, deploy** | Pages + D1 + floor | — | `routes` back to two entries, one `wrangler deploy` |
| 13 | **The D1-unreachable contract, written and induced** | broken D1 | `docs/d1-unreachable.md` | unchanged |
| 14 | copy, sections, galleries, experiences | D1 | D1 | remove from `D1_ONLY_PATHS`, deploy |
| 15 | pages, menus | D1 | D1 | same |
| 16 | site, plus the step-5 stale read fix | D1 | D1 | same |
| 17 | **drinks, dishes — the menu** | D1 | D1 | same |
| 18 | **Upload writes R2, commits nothing** | R2 | R2 | the next upload refuses, visibly, on her device |
| 19 | The menu PDFs, and the last committing upload path | R2 | R2 | `git revert`; the PDFs are in git until this commit |
| 20 | `rederive.mjs` — the escape hatch that executes | R2 | R2 | nothing; it is a manual tool |
| 21 | **Stop the commit; delete the Worker's `GITHUB_TOKEN`** | — | — | publishing breaks; it is last for that reason |
| 22 | The weekly export and the floor's honest header | D1 | git, weekly | recovery window narrows to 7 days |
| 23 | The final sweep and the four proofs | everything | — | the migration is finished but unwitnessed |

---

# Tier 0 — The three instruments every later task reads

## Task 1: Bind the bucket, stand up the image host, and prove a round trip

**This task changes no reference and serves no photograph to any visitor.** It stands up the read side — the `r2_buckets` binding, the custom domain, the Content-Security-Policy that has to allow it — and proves the whole path end to end by writing one object, reading it back over HTTPS, and deleting it.

It is separated from every upload precisely because `img-src 'self' blob:` in `public/_headers` forbids loading an image from any other host: **rewriting a reference before this ships would blank every photograph on the site at once, on every browser, with the file present in R2 and returning 200.** That is the single most expensive ordering mistake available in this plan, and this task is where it is spent instead.

Ground truth, measured before this plan started: **the bucket `via-bianca` exists and is empty** (`npx wrangler r2 bucket list` confirms it), and there is **no `r2_buckets` binding in `wrangler.toml`** — the file carries a comment block explaining its deliberate absence, which this task replaces.

**Files:**
- Create: `src/shared/image-host.ts`
- Create: `src/shared/__tests__/image-host.test.ts`
- Modify: `wrangler.toml`
- Modify: `public/_headers`
- Modify: `scripts/check-csp.mjs`
- Modify: `src/test/wrangler-config.test.ts`
- Modify: `src/test/hosting.test.ts`
- Modify: `docs/cloudflare-cutover.md`

**Interfaces:**

```ts
// src/shared/image-host.ts
export const IMAGE_HOST: string;                       // 'https://img.viabiancarestaurant.com'
export function imageUrl(key: string): string;         // throws on a leading slash
export function keyFromImageUrl(url: string): string | null;
```

- Consumes: Cloudflare dashboard access and an authenticated `npx wrangler`. **An agent has neither; a human performs Steps 1 and 3.**
- Produces: `env.R2` bound in the Worker (bound, read by nothing yet), and `https://img.viabiancarestaurant.com/<key>` serving the `via-bianca` bucket.

- [ ] **Step 0: Record the CSS baseline before touching anything**

```
npm run build && ls -l dist/assets/index-*.css
```

Must read **39441** against the 39600 ceiling. Every task below states its expected CSS cost against this number; if the baseline is already different, reconcile before starting.

- [ ] **Step 1 (human, dashboard): Connect the custom domain and switch `r2.dev` off**

R2 → `via-bianca` → Settings:
1. **Public access → Custom Domains → Connect Domain**, enter `img.viabiancarestaurant.com`. The zone is already on Cloudflare, so the DNS record and certificate are issued automatically. Wait for status **Active**.
2. **Public access → `r2.dev` subdomain → Disabled.** Cloudflare documents `r2.dev` as development-only and rate-limited, warns against even pointing a CNAME at it, and gives it no edge caching, no WAF and no bot management. Leaving it on exposes the same objects through a path with none of the protections the custom domain has.

Record both, with the date, in `docs/cloudflare-cutover.md` under a new numbered section. A dashboard step that exists nowhere in the repository is a step nobody can verify was taken.

- [ ] **Step 2: The host constant, in one place**

```ts
// src/shared/image-host.ts
//
// Where photographs are served from, as one constant the Worker, the browser
// bundle and every script under scripts/ all read.
//
// A CUSTOM DOMAIN, never the r2.dev subdomain. Cloudflare documents r2.dev as
// development-only and rate-limited, warns against even pointing a CNAME at
// it, and gives it no edge caching, no WAF and no bot management. The bucket's
// r2.dev access is switched OFF in the dashboard as part of this task.
//
// A subdomain of the site's own zone rather than a separate domain, so the
// apex's Strict-Transport-Security includeSubDomains already covers it and no
// second certificate story exists.
export const IMAGE_HOST = 'https://img.viabiancarestaurant.com';

// An R2 object key, e.g. food/pizza1.webp, to the URL a browser fetches.
//
// Keys never carry a leading slash: R2 treats `/food/x.webp` and
// `food/x.webp` as two different objects, and half this codebase's paths
// carry one. The boundary is enforced here rather than remembered at each
// call site.
//
// encodeURI, because five of this library's filenames carry spaces
// (mocktails/blood orange espresso tonic.webp, mocktails/signor bianca.webp,
// mocktails/viola and sambuco.webp) and one carries an apostrophe. As a
// site-root path in an img src the browser encodes those itself; as an
// absolute URL sitting in JSON they have to arrive already encoded or the
// request goes to a different key than the one R2 holds.
export function imageUrl(key: string): string {
  if (key.startsWith('/')) throw new Error(`imageUrl: key must not start with a slash, got "${key}"`);
  return IMAGE_HOST + '/' + encodeURI(key);
}

// The inverse, returning null for anything that is not one of ours -- a
// site-root path, an absolute URL on another host, a bare filename. Callers
// use the null to mean "not an image-host reference", never "broken".
export function keyFromImageUrl(url: string): string | null {
  const prefix = IMAGE_HOST + '/';
  if (!url.startsWith(prefix)) return null;
  const key = decodeURI(url.slice(prefix.length));
  return key.length > 0 && !key.includes('..') ? key : null;
}
```

Re-read that comment for bare Tailwind utility tokens before moving on. It contains none today.

- [ ] **Step 3 (human): The round trip — write one object, read it back, delete it**

```
printf 'ok' > /tmp/vb-probe.txt
npx wrangler r2 object put via-bianca/__probe__.txt --file=/tmp/vb-probe.txt --content-type=text/plain --remote
curl -sS -D - -o /tmp/vb-probe-back.txt https://img.viabiancarestaurant.com/__probe__.txt
diff /tmp/vb-probe.txt /tmp/vb-probe-back.txt && echo 'ROUND TRIP OK'
npx wrangler r2 object delete via-bianca/__probe__.txt --remote
curl -sS -o /dev/null -w '%{http_code}\n' https://img.viabiancarestaurant.com/__probe__.txt
```

The three answers that must all hold: `HTTP/2 200` with `content-type: text/plain` on the read; `ROUND TRIP OK` on the diff; **404** after the delete. A 404 on the first read means the domain is not Active yet. A Cloudflare error page means public access is not on. A 200 after the delete means `--remote` was missing and the whole exercise happened in the local miniflare simulation — **which is the failure mode most likely to be mistaken for success**, and it is why the last line is here.

Paste all four responses into `docs/cloudflare-cutover.md`.

- [ ] **Step 4: Bind the bucket and name the two new origins**

In `wrangler.toml`, replace the entire `# R2 is deliberately ABSENT from this file` comment block with:

```toml
# R2, bound and in use from Task 4 onward. The bucket already existed and was
# empty; `npx wrangler r2 bucket list` confirmed it, and Task 1 proved the
# round trip -- one object written, read back over HTTPS, deleted, and the
# delete confirmed with a 404.
#
# The activation this file's previous comment was waiting on has happened, and
# the derivative question it left open is answered in the plan this binding
# arrives with (docs/superpowers/plans/2026-08-21-content-out-of-git.md):
# derivatives are NOT generated inside the Worker (workerd runs no native code,
# so sharp is impossible there) and NOT bought from Cloudflare Images
# (billable, ruled out by the owner). The fifty photographs that exist today
# are copied out of the PRODUCTION CDN byte for byte with no re-encode at all,
# and every upload after that is encoded by the browser before the request
# leaves the page -- src/admin/derive.ts.
#
# Free tier, read against the live docs: 10 GB stored, 1,000,000 Class A
# (write) and 10,000,000 Class B (read) operations a month, and egress is free
# at any volume. The whole library is 224 MB (2.6 MB of served derivatives,
# 201 MB of archived originals, 20 MB of menu PDFs). The expected bill is zero.
#
# THE BUCKET IS NOT SERVED BY THIS WORKER. It is served by an R2 custom domain,
# img.viabiancarestaurant.com, and the `routes` list above is never widened to
# cover that hostname -- src/test/wrangler-config.test.ts pins that. Putting
# photographs through the Worker would spend the same 100,000-requests-a-day
# free budget that every page view is about to start spending.
[[r2_buckets]]
binding = "R2"
bucket_name = "via-bianca"
```

And in `[vars]`, add:

```toml
# Where the SPA shell is fetched from, and it is deliberately NOT the request's
# own origin any more.
#
# worker/post-page.ts's header comment named "/index.html matches neither
# route" as the load-bearing reason its shell subrequest cannot recurse into
# this Worker. Task 12 widens `routes` to /*, which destroys that property
# outright: every path on the zone, /index.html included, would match. This
# hostname is the Pages project's own production alias, it is matched by no
# Worker route, and Pages applies public/_headers to it exactly as it does to
# the apex -- so the shell that comes back carries the same CSP the site's own
# HTML needs.
#
# THE SUFFIX IS NOT OPTIONAL AND IT IS NOT DERIVABLE. The project is named
# `vb`, but its generated subdomain is `vb-c7r.pages.dev` -- `vb.pages.dev`
# was already taken, and resolves to a STRANGER'S WEBSITE that serves no CSP.
# Read it off `npx wrangler pages project list`. wrangler.toml carries the
# full argument and the measurement.
PAGES_ORIGIN = "https://vb-c7r.pages.dev"

# Where photographs are served from. Duplicated deliberately rather than
# imported: src/shared/image-host.ts is the one definition the code reads, and
# this var exists so worker/upload.ts can build the URL it hands back without
# the Worker and this file being able to disagree silently --
# src/test/wrangler-config.test.ts asserts the two strings are identical.
IMAGE_HOST = "https://img.viabiancarestaurant.com"
```

- [ ] **Step 5: Widen `img-src`, and only `img-src`**

In `public/_headers`, in the security block's `Content-Security-Policy` line, change `img-src 'self' blob:` to `img-src 'self' blob: https://img.viabiancarestaurant.com`, leaving every other directive byte-identical. Add above the block:

```
# img-src gained https://img.viabiancarestaurant.com when photographs moved to
# R2. That host is a custom domain on this same zone, in front of the
# via-bianca bucket, and it serves nothing but image and PDF bytes.
#
# ONE DIRECTIVE, and the narrowness is the point. The bucket host is not added
# to default-src, script-src, connect-src or frame-src, so a compromised or
# mistakenly-public object cannot become executing script, a fetch target or a
# framed document -- it can only ever be painted as a picture. An earlier draft
# widened default-src instead, which would have granted all four at once for a
# change that needed one.
#
# It also covers src/index.css's body::before texture, which is a CSS
# background-image rather than an <img>: img-src governs both.
#
# THIS LINE HAS TO SHIP BEFORE ANY REFERENCE POINTS AT THAT HOST. A reference
# rewritten first would 200 from R2 and still be refused by the browser, so
# every photograph on the site would be a broken-image icon at once, on every
# browser, with nothing in the network tab that looks like a failure.
# scripts/check-csp.mjs probes a real image load from this host on every route
# for exactly that reason.
```

- [ ] **Step 6: Make `check-csp.mjs` probe a real cross-host image load**

Next to the existing `PROBE_JS` in `scripts/check-csp.mjs`:

```js
// A REAL image element pointed at the image host, loaded in the real browser
// under the real policy. A string check on the header text would pass on a
// policy that lists the host in the wrong directive; only an actual load tells
// the two apart.
//
// If the network is unavailable the probe reports 'blocked-or-unreachable' and
// is NOT counted as a violation on its own -- a CSP checker must fail on a
// policy problem, never on someone's wifi. The assertion that governs is the
// console violation list the existing listener already collects; this string
// exists so a reader knows WHICH failure they are looking at.
const IMAGE_PROBE_JS = `
  (async () => {
    const url = 'https://img.viabiancarestaurant.com/__csp_probe__.webp';
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve('loaded');
      img.onerror = () => resolve('blocked-or-unreachable');
      img.src = url + '?t=' + Date.now();
      setTimeout(() => resolve('blocked-or-unreachable'), 8000);
    });
  })()
`;
```

and inside the per-route loop, after the existing probe:

```js
    const imageProbe = await page.evaluate(IMAGE_PROBE_JS);
    if (imageProbe !== 'loaded') console.log(`      image host probe on ${route}: ${imageProbe}`);
```

- [ ] **Step 7: Pin the configuration**

```ts
// src/test/wrangler-config.test.ts
  it('binds the R2 bucket the photographs live in', () => {
    const wrangler = readFileSync('wrangler.toml', 'utf8');
    expect(wrangler).toMatch(/\[\[r2_buckets\]\]/);
    expect(wrangler).toMatch(/binding\s*=\s*"R2"/);
    expect(wrangler).toMatch(/bucket_name\s*=\s*"via-bianca"/);
  });

  // The Worker builds the URL it hands back from IMAGE_HOST; the browser and
  // every script read src/shared/image-host.ts. Two strings, one meaning.
  it('names the same image host in wrangler.toml and in src/shared/image-host.ts', () => {
    const declared = readFileSync('wrangler.toml', 'utf8').match(/IMAGE_HOST\s*=\s*"([^"]+)"/);
    expect(declared).not.toBeNull();
    expect(declared![1]).toBe(IMAGE_HOST);
  });

  // PIN THE EXACT STRING. This block originally asserted only the SHAPE
  // (/^https:\/\/[a-z0-9-]+\.pages\.dev$/), reasoning that pinning "would fail
  // the day the Pages project is renamed". The shape it accepted was
  // `https://vb.pages.dev` -- a live, unrelated third party's site -- so it was
  // unfalsifiable for the only failure that matters. pages.dev is a SHARED
  // suffix; a hostname on it is evidence of nothing.
  //
  // The rename worry is answered by the third test below instead. See the
  // shipped src/test/wrangler-config.test.ts for the full four tests and the
  // measurement they record; scripts/shell-origin-check.mjs checks the same
  // belief against the network from `npm run verify:deploy`.
  const PAGES_PRODUCTION_ALIAS = 'https://vb-c7r.pages.dev';

  it("pins the shell origin to this Pages project's own production alias", () => {
    const origin = readFileSync('wrangler.toml', 'utf8').match(/^PAGES_ORIGIN\s*=\s*"([^"]+)"/m);
    expect(origin).not.toBeNull();
    expect(origin![1]).toBe(PAGES_PRODUCTION_ALIAS);
  });

  it('refuses the neighbouring hostnames that are not this project', () => {
    expect(PAGES_PRODUCTION_ALIAS).not.toBe('https://vb.pages.dev');
    expect(PAGES_PRODUCTION_ALIAS.endsWith('/')).toBe(false);
  });

  it('keeps the recorded alias consistent with the recorded Pages project name', () => {
    const project = readFileSync('wrangler.toml', 'utf8').match(/^CLOUDFLARE_PAGES_PROJECT\s*=\s*"([^"]+)"/m);
    expect(new URL(PAGES_PRODUCTION_ALIAS).host).toMatch(new RegExp(`^${project![1]}(-[a-z0-9]+)?\\.pages\\.dev$`));
  });

  it('routes nothing on the origin the shell is fetched from', () => {
    const routes = readFileSync('wrangler.toml', 'utf8').match(/routes\s*=\s*\[([\s\S]*?)\]/)![1];
    expect(routes).not.toContain(new URL(PAGES_PRODUCTION_ALIAS).host);
    expect(routes).not.toContain('pages.dev');
  });

  // The image host is served by R2's own custom domain, not by this Worker.
  it('routes nothing on the image host', () => {
    const routes = readFileSync('wrangler.toml', 'utf8').match(/routes\s*=\s*\[([\s\S]*?)\]/)![1];
    expect(routes).not.toContain('img.viabiancarestaurant.com');
  });
```

```ts
// src/test/hosting.test.ts
  // The whole reason this is Task 1. A content reference rewritten to the
  // image host while this directive still reads `img-src 'self' blob:` would
  // be refused by every browser, at a 200, with every photograph an icon.
  it("the site's CSP admits the image host in img-src and in no other directive", () => {
    const security = headerBlocks().find((block) => blockPath(block) === SECURITY_BLOCK)!;
    const csp = security.match(/Content-Security-Policy:\s*(.+)/)![1];
    const directives = Object.fromEntries(
      csp.split(';').map((part) => {
        const tokens = part.trim().split(/\s+/);
        return [tokens[0], tokens.slice(1)];
      }),
    ) as Record<string, string[]>;
    expect(directives['img-src']).toContain('https://img.viabiancarestaurant.com');
    for (const [name, values] of Object.entries(directives)) {
      if (name === 'img-src') continue;
      expect(values).not.toContain('https://img.viabiancarestaurant.com');
    }
  });
```

```ts
// src/shared/__tests__/image-host.test.ts
import { describe, it, expect } from 'vitest';
import { IMAGE_HOST, imageUrl, keyFromImageUrl } from '../image-host';

describe('the one place the image host is spelled', () => {
  it('round-trips an ordinary key', () => {
    expect(keyFromImageUrl(imageUrl('food/pizza1.webp'))).toBe('food/pizza1.webp');
  });

  // Five real filenames in this library carry spaces. A raw space in a URL
  // sitting inside JSON is not a request for the object R2 holds.
  it('round-trips a key with spaces and an apostrophe', () => {
    const key = "mocktails/blood orange espresso tonic.webp";
    expect(imageUrl(key)).toContain('%20');
    expect(keyFromImageUrl(imageUrl(key))).toBe(key);
  });

  it('refuses a key with a leading slash rather than silently doubling it', () => {
    expect(() => imageUrl('/food/pizza1.webp')).toThrow();
  });

  it('does not claim a url on another host, or a site-root path', () => {
    expect(keyFromImageUrl('https://viabiancarestaurant.com/food/pizza1.webp')).toBeNull();
    expect(keyFromImageUrl('/food/pizza1.webp')).toBeNull();
  });

  it('refuses a traversal key', () => {
    expect(keyFromImageUrl(IMAGE_HOST + '/../wrangler.toml')).toBeNull();
  });
});
```

- [ ] **Step 8: `npx tsc -b --noEmit && npm test -- --run src/shared/__tests__/image-host.test.ts src/test/wrangler-config.test.ts src/test/hosting.test.ts && npm run test:csp`**

- [ ] **Step 9: Ship the CSP and prove it on the wire**

`public/_headers` reaches production through a Pages build, so push this commit to `main`, wait for the deploy, then:

```
curl -sSI https://viabiancarestaurant.com/ | tr ';' '\n' | grep -i 'img-src'
```

The live header must already list the image host **before Task 4 begins**. The Worker is not deployed in this task — `env.R2` is bound in configuration and read by nothing.

- [ ] **Step 10: Commit before mutating.** `git add -A && git commit`.

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| move `https://img.viabiancarestaurant.com` from `img-src` to `default-src` in `public/_headers` | "the site's CSP admits the image host in img-src and in no other directive" | — |
| remove the host from the CSP line entirely | same test | — |
| change `IMAGE_HOST` in `wrangler.toml` to a different hostname | "names the same image host in wrangler.toml and in src/shared/image-host.ts" | — |
| change `PAGES_ORIGIN` to `https://viabiancarestaurant.com` | "pins the shell origin to this Pages project's own production alias" | — |
| change `PAGES_ORIGIN` to `https://vb.pages.dev` (the stranger's host this plan originally specified) | same test | If it stays green the assertion is a shape check again, and the whole reason this row exists is gone. |
| change `PAGES_PRODUCTION_ALIAS` **and** `PAGES_ORIGIN` together to `https://vb.pages.dev` | "refuses the neighbouring hostnames that are not this project" | A pinned string is two copies of one belief; this row is what stops both copies being wrong at once, which is exactly what happened. |
| add a `pages.dev` entry to `routes` | "routes nothing on the origin the shell is fetched from" | — |
| point `PAGES_ORIGIN` at a host that answers 200 with no CSP | `npm run verify:deploy` reports "sends no Content-Security-Policy"; `scripts/__tests__/shell-origin-check.test.mjs` covers the same branch offline | — |
| add `img.viabiancarestaurant.com/*` to `routes` | "routes nothing on the image host" | — |
| delete the `[[r2_buckets]]` block | "binds the R2 bucket the photographs live in" | — |
| change `bucket_name` to `via-bianca-assets` (the name that never existed) | same test | — |
| drop `encodeURI` from `imageUrl` | "round-trips a key with spaces and an apostrophe" | — |
| make `keyFromImageUrl` return `url.slice(prefix.length)` with no `..` check | "refuses a traversal key" | — |
| point `IMAGE_PROBE_JS` at a host not in the policy, e.g. `https://example.com/x.png` | `npm run test:csp` reports a violation on every route and exits 1 | If it stays green, the console-violation listener is not seeing image refusals. Confirm it collects `SecurityPolicyViolationEvent` and not only `console` text; without that the probe is decoration and this row is why. |
| drop `--remote` from Step 3's `wrangler` commands | nothing automated; **Step 3's last line returns 200 instead of 404** | This is the local-vs-remote bucket confusion, and it is not test-detectable. If the delete-then-404 check is ever removed from Step 3, put it back. |

**CSS ceiling:** zero bytes. `wrangler.toml`, `public/_headers`, `scripts/` and `src/test/` are outside Tailwind's content glob; `src/shared/image-host.ts` is inside it and its comments were re-read in Step 2.

**If this task is wrong:** the first content file that points at the image host produces a site where **every single photograph is a broken-image icon**, in every browser, with the image server answering 200 — and nothing in the network tab looks like a failure, so the obvious next move is to go and check R2, which is fine.

---

## Task 2: The inventory, counted from reality — including the four references that live only in D1

Retires the largest silent risk in the migration: a reference nobody counted. The brief says 68 and the content files do hold 68 — **and there are 9 more in code**, and **4 of the 68 live in D1, not in the committed file**, where a script that walks `src/content/` cannot see them. A blog post published from the dashboard last month, with a photograph uploaded last month, exists **only** as a D1 row.

**Files:**
- Create: `scripts/image-inventory.mjs`
- Create: `docs/image-inventory.json` (generated by the above, committed)
- Create: `scripts/__tests__/image-inventory.test.mjs`
- Modify: `package.json` (add `images:inventory`)

**Interfaces:**

```js
// scripts/image-inventory.mjs
export const CONTENT_DIR, CODE_FILES, ASSET_PATH_PATTERN, CODE_ASSET_PATTERN;
export function collectFromJson(value, file, found, pointer);  // pushes { file, pointer, path }
export function collectFromCode(source, file, found);          // pushes { file, pointer: 'line N', path }
export async function fetchLiveDocuments(origin, fetchImpl);   // throws rather than skipping
export function objectsFor(references, sourceFiles);
```

- [ ] **Step 1: The two walks, with the pointer that makes a miss findable**

```js
// scripts/image-inventory.mjs
//
// What has to move, counted from reality rather than from a list somebody
// maintained. THREE populations, and the third is the one a naive script
// misses entirely:
//
//   1. src/content/*.json -- 69 strings, 68 of which move (the 69th is
//      site.json's /og-image.jpg, which stays on this origin; see the plan's
//      decision D10).
//   2. Code -- src/index.css, src/components/Hero.tsx, ChefGallery.tsx,
//      SignatureMocktails.tsx and a doc comment in src/content/types.ts.
//      Nine today. The doc comment counts because
//      src/content/__tests__/assets.test.ts scans comments too.
//   3. THE LIVE COPIES OF story.json AND posts.json, which are D1 rows and
//      NOT the committed files. worker/store.ts's D1_ONLY_PATHS routes both
//      there, so src/content/posts.json on disk is a fallback floor that may
//      be months behind what the site serves. A rewrite that reads the
//      committed file rewrites a document nobody is reading and leaves the
//      live one pointing at a path that is about to stop existing.
//
// Every effect is a parameter so scripts/__tests__/image-inventory.test.mjs
// can drive the whole thing with no filesystem and no network.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const CONTENT_DIR = join('src', 'content');

// Named rather than globbed. A glob over src/**/*.ts{,x} would sweep in every
// test fixture in the repository -- there are dozens of '/food/tielle.webp'
// strings under __tests__ -- and none of those is a reference the site
// serves. These five files are the whole population, measured by
//   grep -rnE '/(food|hero|atmosphere|our_story|mocktails|press|experiences|team)/' src \
//     | grep -v __tests__
// and the test below asserts the count so a sixth appearing is a red suite
// rather than a silent miss.
export const CODE_FILES = [
  'src/index.css',
  'src/components/Hero.tsx',
  'src/components/ChefGallery.tsx',
  'src/components/SignatureMocktails.tsx',
  'src/content/types.ts',
];

// The same two expressions src/content/__tests__/assets.test.ts uses, copied
// deliberately rather than imported: that file is TypeScript inside a vitest
// project and this is plain ESM run by `node`. They are pinned against each
// other by the test below, which reads assets.test.ts as text and asserts both
// source strings appear in it -- so a change to either end is a red test, not
// a silent divergence.
export const ASSET_PATH_PATTERN = /^\/.+\.(jpg|jpeg|png|webp|avif|svg|pdf)$/i;
export const CODE_ASSET_PATTERN = /["'`(](\/[^"'`()\n]+\.(?:jpg|jpeg|png|webp|avif|svg|pdf))["'`)]/gi;

export function collectFromJson(value, file, found, pointer = '') {
  if (typeof value === 'string') {
    if (ASSET_PATH_PATTERN.test(value)) found.push({ file, pointer, path: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectFromJson(item, file, found, `${pointer}[${i}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectFromJson(item, file, found, pointer === '' ? key : `${pointer}.${key}`);
    }
  }
}

export function collectFromCode(source, file, found) {
  // A FRESH regex per call. CODE_ASSET_PATTERN carries /g, so a shared
  // instance holds lastIndex between calls and skips the first match of every
  // file after the first one -- a defect that loses exactly one reference per
  // file and is invisible in a total.
  const pattern = new RegExp(CODE_ASSET_PATTERN.source, 'gi');
  let line = 1;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    while (cursor < match.index) {
      if (source[cursor] === '\n') line += 1;
      cursor += 1;
    }
    found.push({ file, pointer: `line ${line}`, path: match[1] });
  }
}
```

- [ ] **Step 2: Read the two live documents, and refuse to guess**

```js
// The live bodies, over the public read endpoint -- no D1 credentials, no
// wrangler, no secret. GET /api/published?path=posts.json is
// worker/published.ts's PUBLIC_FILES allowlist, which already serves exactly
// the three D1-only documents to anybody.
//
// awards.json is fetched too and is expected to contribute ZERO image
// references (an Award's image is optional and none is set). It is fetched
// anyway rather than assumed empty, because "we were sure it had none" is not
// a sentence this migration can afford about a document the repository does
// not contain.
const LIVE_DOCUMENTS = ['story.json', 'posts.json', 'awards.json'];

export async function fetchLiveDocuments(origin, fetchImpl = fetch) {
  const out = [];
  for (const name of LIVE_DOCUMENTS) {
    const response = await fetchImpl(`${origin}/api/published?path=${name}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    // NOT a warning that gets skipped past. If a live copy cannot be read, the
    // inventory is incomplete in exactly the way that ships a broken
    // photograph, and an incomplete inventory MUST NOT BE WRITTEN TO DISK AT
    // ALL. A file on disk is read later by somebody who was not here.
    if (!response.ok) throw new Error(`could not read the live ${name}: HTTP ${response.status}`);
    const text = await response.text();
    // x-content-source tells us whether D1 answered or the compiled floor did.
    // A 'snapshot' answer means D1 was unreachable at this moment and the body
    // is the floor -- which is the committed file, which is the thing this
    // fetch exists to avoid reading. That is a refusal too.
    const source = response.headers.get('x-content-source');
    if (source !== 'd1' && source !== 'cache') {
      throw new Error(`the live ${name} answered from "${source}", not from D1 -- rerun when D1 is reachable`);
    }
    out.push({ name, body: JSON.parse(text), source: 'd1' });
  }
  return out;
}
```

- [ ] **Step 3: Assemble, derive the object list, and print the numbers**

```js
export function objectsFor(references, sourceFiles) {
  const keys = new Map();
  for (const { path } of references) {
    if (path === '/og-image.jpg') continue;            // decision D10: stays here
    if (path.startsWith('/favicon') || path.startsWith('/apple-touch-icon') || path.startsWith('/icon-')) continue;
    keys.set(path.slice(1), { key: path.slice(1), kind: path.startsWith('/menus/') ? 'menu' : 'derivative' });
  }
  for (const file of sourceFiles) {
    const key = 'source/' + relative('assets-source', file).split(sep).join('/');
    keys.set(key, { key, kind: 'original' });
  }
  return [...keys.values()].sort((a, b) => a.key.localeCompare(b.key));
}

if (import.meta.filename === process.argv[1]) {
  const origin = process.argv.includes('--origin')
    ? process.argv[process.argv.indexOf('--origin') + 1]
    : 'https://viabiancarestaurant.com';

  const references = [];
  for (const name of readdirSync(CONTENT_DIR).filter((n) => n.endsWith('.json'))) {
    collectFromJson(JSON.parse(readFileSync(join(CONTENT_DIR, name), 'utf8')), join(CONTENT_DIR, name), references);
  }
  const committed = references.length;
  for (const file of CODE_FILES) collectFromCode(readFileSync(file, 'utf8'), file, references);
  const code = references.length - committed;

  // Throws rather than falls back. See fetchLiveDocuments.
  const live = await fetchLiveDocuments(origin);
  const before = references.length;
  for (const { name, body } of live) collectFromJson(body, `d1:${name}`, references);
  for (let i = before; i < references.length; i++) references[i].source = 'd1';
  for (let i = 0; i < before; i++) references[i].source = 'committed';

  const sources = walkSources('assets-source');
  process.stdout.write(JSON.stringify({
    builtAt: new Date().toISOString(),
    origin,
    references,
    counts: { content: committed, code, d1: references.length - before, distinct: new Set(references.map((r) => r.path)).size },
    objects: objectsFor(references, sources),
  }, null, 2) + '\n');
}
```

- [ ] **Step 4: `package.json` gains one script, and a human runs it against production**

```json
    "images:inventory": "node scripts/image-inventory.mjs",
```

```
npm run images:inventory -- --origin https://viabiancarestaurant.com > docs/image-inventory.json
node -e "const i=require('./docs/image-inventory.json');console.log(i.counts)"
```

Expected: `{ content: 69, code: 9, d1: 4, distinct: … }`. **If `d1` is 0, the live read silently fell back and the file must not be committed.** If `content` is not 69 or `code` is not 9, stop and reconcile — a plan whose census disagrees with the tree is a plan that will miss a reference.

- [ ] **Step 5: Pin the counts, the patterns, and the two walk defects**

```js
// scripts/__tests__/image-inventory.test.mjs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectFromJson, collectFromCode, fetchLiveDocuments, ASSET_PATH_PATTERN, CODE_ASSET_PATTERN, CODE_FILES } from '../image-inventory.mjs';

const inventory = JSON.parse(readFileSync('docs/image-inventory.json', 'utf8'));

describe('the recorded inventory', () => {
  it('counts the same references it lists', () => {
    expect(inventory.references.length).toBe(
      inventory.counts.content + inventory.counts.code + inventory.counts.d1,
    );
  });

  // story.json's chef portrait, and one image per post. If this is 0 the live
  // read failed and the walk fell back to the committed file -- the exact
  // failure this whole script exists to prevent.
  it('found the four references that live only in D1', () => {
    expect(inventory.references.filter((r) => r.source === 'd1')).toHaveLength(4);
  });

  it('found the nine that live in code, including the one in a doc comment', () => {
    expect(inventory.references.filter((r) => CODE_FILES.includes(r.file))).toHaveLength(9);
    expect(inventory.references.filter((r) => r.file === 'src/content/types.ts')).toHaveLength(1);
    expect(inventory.references.filter((r) => r.file === 'src/components/SignatureMocktails.tsx')).toHaveLength(5);
  });

  it('found the sixty-nine in content, of which one is the share card that stays', () => {
    const content = inventory.references.filter((r) => r.file.startsWith('src/content/') && r.file.endsWith('.json'));
    expect(content).toHaveLength(69);
    expect(content.filter((r) => r.path === '/og-image.jpg')).toHaveLength(1);
  });

  // Vacuity guard. Without it a walk that matched nothing satisfies every
  // count above by making all of them zero.
  it('found a real number of references, not none', () => {
    expect(inventory.references.length).toBeGreaterThan(70);
  });

  it('records where in a document each reference sits, not just that one exists', () => {
    expect(inventory.references.every((r) => typeof r.pointer === 'string' && r.pointer.length > 0)).toBe(true);
  });
});

describe('the two patterns still agree with the guardrail that shares them', () => {
  const guardrail = readFileSync('src/content/__tests__/assets.test.ts', 'utf8');
  it.each([['ASSET_PATH_PATTERN', ASSET_PATH_PATTERN], ['CODE_ASSET_PATTERN', CODE_ASSET_PATTERN]])(
    '%s is the same expression assets.test.ts uses',
    (_name, pattern) => { expect(guardrail).toContain(pattern.source); },
  );
});

describe('the walk itself', () => {
  it('reports the json pointer, not just the file', () => {
    const found = [];
    collectFromJson({ items: [{ image: '/food/x.webp' }] }, 'f.json', found);
    expect(found[0].pointer).toBe('items[0].image');
  });

  it('does not skip the first match of every file after the first', () => {
    const found = [];
    collectFromCode('"/a/one.webp"\n"/a/two.webp"', 'a.ts', found);
    collectFromCode('"/b/one.webp"\n"/b/two.webp"', 'b.ts', found);
    expect(found.map((f) => f.path)).toEqual(['/a/one.webp', '/a/two.webp', '/b/one.webp', '/b/two.webp']);
  });

  it('reports a code reference by line so a human can find it', () => {
    const found = [];
    collectFromCode('x\ny\n"/a/one.webp"', 'a.ts', found);
    expect(found[0].pointer).toBe('line 3');
  });

  it('throws rather than skipping when a live document cannot be read', async () => {
    await expect(fetchLiveDocuments('https://x', async () => ({ ok: false, status: 503, headers: new Headers() })))
      .rejects.toThrow(/could not read the live/);
  });

  it('throws when the live read is answered from the compiled floor', async () => {
    await expect(fetchLiveDocuments('https://x', async () => ({
      ok: true, status: 200, headers: new Headers({ 'x-content-source': 'snapshot' }), text: async () => '[]',
    }))).rejects.toThrow(/not from D1/);
  });
});
```

- [ ] **Step 6: `npx eslint scripts/image-inventory.mjs && npm test -- --run scripts/__tests__/image-inventory.test.mjs`**

- [ ] **Step 7: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| in `fetchLiveDocuments`, replace the `throw` with `continue` and re-run Step 4 | "found the four references that live only in D1" | — |
| drop the `x-content-source` check | "throws when the live read is answered from the compiled floor" | — |
| reuse one shared `CODE_ASSET_PATTERN` instance in `collectFromCode` | "does not skip the first match of every file after the first" | — |
| make `collectFromJson` always pass `''` as the pointer | "reports the json pointer, not just the file" and "records where in a document each reference sits" | — |
| edit `ASSET_PATH_PATTERN` here to drop `webp` | "ASSET_PATH_PATTERN is the same expression assets.test.ts uses" | — |
| hand-edit `docs/image-inventory.json` to drop one reference without touching `counts` | "counts the same references it lists" | — |
| drop `src/content/types.ts` from `CODE_FILES` | "found the nine that live in code, including the one in a doc comment" | — |
| make `collectFromJson` return immediately | "found a real number of references, not none" | This is the vacuity row. If nothing reddens, the `toBeGreaterThan(70)` has been weakened — put it back before finishing. |

**CSS ceiling:** zero bytes. `scripts/` and `docs/` are outside Tailwind's content glob.

**If this task is wrong:** the migration copies fewer objects than the site references, and the first photograph anybody notices missing is one in a blog post the owner published herself — the copy that only ever existed in D1, on a page she looks at more than anyone.

---

## Task 3: The derivative answer, settled and measured

**The key unsolved problem, answered before a single object moves.** `npm run images` cannot generate derivatives at build time once originals leave the repository, a Worker cannot run `sharp`, and Cloudflare's resizing products are billable. The answer is: **the fifty that exist are copied, never re-encoded; everything after that is encoded in the browser.** This task builds the browser encoder, pins its width rule to the build-time one, and **measures what it costs on three real photographs** — because "20–35% larger" is an estimate wearing the word measured, and this plan is not allowed one.

Nothing calls the encoder when this task finishes. It is wired into the upload path at Task 18, once every reader has been live for six tasks.

**Files:**
- Create: `src/shared/image-widths.ts`
- Create: `src/shared/__tests__/image-widths.test.ts`
- Create: `src/admin/derive.ts`
- Create: `src/admin/__tests__/derive.test.ts`
- Create: `e2e/photo-upload.spec.ts`
- Create: `docs/image-derivation.md`
- Modify: `scripts/images.mjs` (export `encodeDerivative`, taking its width)

**Interfaces:**

```ts
// src/shared/image-widths.ts
export const DEFAULT_MAX_WIDTH: number;                    // 1000
export const DIR_MAX_WIDTH: Readonly<Record<string, number>>;   // { hero: 500 }
export const FILE_MAX_WIDTH: Readonly<Record<string, number>>;  // { 'public/hero/brick.webp': 400 }
export function maxWidthForOutput(outputPath: string): number;
export function maxWidthForCategory(category: string, filename?: string): number;

// src/admin/derive.ts
export const WEBP_QUALITY: number;   // 0.78, matching scripts/paths.mjs's QUALITY = 78
export const JPEG_QUALITY: number;   // 0.82
export interface Derived { blob: Blob; contentType: string; width: number; height: number; encoder: 'webp' | 'jpeg' }
export function targetSize(natural: { width: number; height: number }, maxWidth: number): { width: number; height: number };
export function halvingSteps(fromWidth: number, toWidth: number): number[];
export async function derive(file: File, category: string): Promise<Derived>;
```

- [ ] **Step 1: The width rule, re-implemented for the browser**

```ts
// src/shared/image-widths.ts
//
// How wide a derivative is allowed to be. An independent re-implementation of
// scripts/paths.mjs's maxWidthFor, not an import -- that module is plain ESM
// built for Node and deliberately free of sharp so it can run inside
// `npm run test:deploy`, and neither this bundle nor the Worker can import a
// bare .mjs from outside its own project. This is the same arrangement
// src/shared/derivative-path.ts already has with outputPathFor, and the link
// between the two is a test over every real source file, not a compiler.
//
// KEYED ON THE OUTPUT PATH, matching maxWidthFor's precedence exactly: a
// per-file cap wins, then a cap for the top-level directory, then the default.
export const DEFAULT_MAX_WIDTH = 1000;

// Nothing under this directory is ever painted wider than a collage tile or a
// full-bleed backdrop behind opaque content.
export const DIR_MAX_WIDTH: Readonly<Record<string, number>> = { hero: 500 };

// The one file whose display size differs from the rest of its directory: it
// is painted at low opacity behind the collage and again as the whole-page
// texture, where the brick joints read as a wash.
export const FILE_MAX_WIDTH: Readonly<Record<string, number>> = { 'public/hero/brick.webp': 400 };

export function maxWidthForOutput(outputPath: string): number {
  if (Object.hasOwn(FILE_MAX_WIDTH, outputPath)) return FILE_MAX_WIDTH[outputPath];
  const withoutPrefix = outputPath.startsWith('public/') ? outputPath.slice('public/'.length) : outputPath;
  const topLevel = withoutPrefix.split('/')[0];
  if (Object.hasOwn(DIR_MAX_WIDTH, topLevel)) return DIR_MAX_WIDTH[topLevel];
  return DEFAULT_MAX_WIDTH;
}

// What an upload in a given category is capped at. The category is what the
// picker knows; the output path is what the rule is keyed on. The filename is
// optional because a new upload's key is content-addressed and can never
// collide with FILE_MAX_WIDTH's one hand-named entry.
export function maxWidthForCategory(category: string, filename = 'x.webp'): number {
  return maxWidthForOutput('public/' + category + '/' + filename);
}
```

- [ ] **Step 2: The agreement test, over every real source file**

```ts
// src/shared/__tests__/image-widths.test.ts
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { maxWidthFor, outputPathFor, SOURCE, IMAGE_EXT } from '../../../scripts/paths.mjs';
import { maxWidthForOutput, DEFAULT_MAX_WIDTH } from '../image-widths';

function everySource(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? everySource(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

// Every real file under assets-source/, not a hand-picked list -- the same
// arrangement src/shared/__tests__/derivative-path.test.ts uses, and for the
// same reason: a hand-picked list only ever proves the cases somebody thought
// of, and the cases that break are the ones nobody did.
const sources = everySource(SOURCE).filter((f) => IMAGE_EXT.has(f.slice(f.lastIndexOf('.')).toLowerCase()));

describe('the browser width rule agrees with the build-time one', () => {
  it('finds real source files to compare over', () => {
    expect(sources.length).toBeGreaterThanOrEqual(50);
  });

  it.each(sources)('%s gets the same cap from both implementations', (source) => {
    expect(maxWidthForOutput(outputPathFor(source))).toBe(maxWidthFor(source));
  });

  // The three precedence branches, named, so a change that happens to leave
  // every current file unchanged still has to be deliberate.
  it('gives the per-file override precedence over the directory one', () => {
    expect(maxWidthForOutput('public/hero/brick.webp')).toBe(400);
    expect(maxWidthForOutput('public/hero/scene.webp')).toBe(500);
  });

  it('does not let a nested directory inherit a top-level cap', () => {
    expect(maxWidthForOutput('public/food/hero/x.webp')).toBe(DEFAULT_MAX_WIDTH);
  });

  it('caps an unknown category at the default', () => {
    expect(maxWidthForOutput('public/posts/abc123abc123.webp')).toBe(DEFAULT_MAX_WIDTH);
  });
});
```

- [ ] **Step 3: The encode, with the halving downscale and the JPEG fallback**

```ts
// src/admin/derive.ts
//
// The derivative, made in her browser, before the request.
//
// WHY HERE AND NOT ON THE SERVER. scripts/images.mjs loads sharp's native
// binding at module scope and workerd cannot execute native code, so a Worker
// cannot resize. Cloudflare's own resizing products are billable and the owner
// is on free tiers. That leaves the browser -- which is not a fallback
// position here: this repository already runs a WASM HEIC decoder on this
// owner's phone for this exact upload (./heic), so the capability is
// demonstrated in production rather than assumed.
//
// WHAT IT MIRRORS. scripts/images.mjs's encodeDerivative is
// sharp(src).rotate().resize({ width, withoutEnlargement: true })
//           .webp({ quality: 78 }). Each clause has an answer here:
//   .rotate()              -> decoded through an <img>, which applies EXIF
//                             orientation in every browser since 2020.
//                             createImageBitmap's imageOrientation option was
//                             rejected: a browser may ignore an option it does
//                             not know, and the symptom is a portrait
//                             photograph landing sideways on the live menu.
//   width: maxWidthFor     -> maxWidthForCategory, pinned to scripts/paths.mjs
//                             by src/shared/__tests__/image-widths.test.ts.
//   withoutEnlargement     -> targetSize never scales above 1.
//   .webp({ quality: 78 }) -> toBlob('image/webp', 0.78).
//
// WHAT IT CANNOT MIRROR, stated rather than glossed: canvas encodes with the
// browser's WebP encoder, not libwebp, and downscales with the browser's
// filter, not Lanczos. The MEASURED difference on three real photographs is in
// docs/image-derivation.md. The mitigation for the filter is halvingSteps
// below; the mitigation for the encoder is that the untouched original is
// stored beside the derivative, so scripts/rederive.mjs (Task 20) can
// regenerate any object with the real pipeline and the same key.
import { maxWidthForCategory } from '../shared/image-widths';

export const WEBP_QUALITY = 0.78;
export const JPEG_QUALITY = 0.82;

export interface Derived {
  blob: Blob;
  contentType: string;
  width: number;
  height: number;
  encoder: 'webp' | 'jpeg';
}

export function targetSize(natural: { width: number; height: number }, maxWidth: number) {
  // Math.min(1, ...) is withoutEnlargement: a photograph narrower than the cap
  // is encoded at its own size and never stretched.
  const scale = Math.min(1, maxWidth / natural.width);
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

// A single drawImage from 4032px down to 1000px asks the browser for a 4x
// reduction in one filter pass, and every browser answers it with a cheap
// bilinear sample that drops detail and leaves visible aliasing on exactly the
// things this restaurant photographs -- basil, crumb, the edge of a plate.
// Halving repeatedly until the last step is under 2x costs a few milliseconds
// and is the standard answer.
export function halvingSteps(fromWidth: number, toWidth: number): number[] {
  const steps: number[] = [];
  let width = fromWidth;
  // `width / 2 > toWidth`, not `width > toWidth`: the second never terminates
  // for a target of 1, because Math.round(1/2) is 1 forever.
  while (width / 2 > toWidth) {
    width = Math.round(width / 2);
    steps.push(width);
  }
  steps.push(toWidth);
  return steps;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function derive(file: File, category: string): Promise<Derived> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    const target = targetSize(natural, maxWidthForCategory(category));

    let source: CanvasImageSource = image;
    let sourceWidth = natural.width;
    let sourceHeight = natural.height;
    let canvas: HTMLCanvasElement | null = null;

    for (const stepWidth of halvingSteps(natural.width, target.width)) {
      const stepHeight = Math.max(1, Math.round((stepWidth / natural.width) * natural.height));
      canvas = document.createElement('canvas');
      canvas.width = stepWidth;
      canvas.height = stepHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot prepare photos for upload.');
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, stepWidth, stepHeight);
      source = canvas;
      sourceWidth = stepWidth;
      sourceHeight = stepHeight;
    }
    if (canvas === null) throw new Error('This browser cannot prepare photos for upload.');

    const webp = await toBlob(canvas, 'image/webp', WEBP_QUALITY);

    // toBlob does NOT fail on an unsupported type -- the specification says it
    // falls back to image/png, SILENTLY. A PNG of a photograph is several
    // times the size of the WebP it replaced, so shipping one unnoticed makes
    // the menu slow rather than broken, which is the kind of failure nobody
    // reports. Checking the type is the only way to see it. Safari has encoded
    // WebP since 16.4, so this branch should never fire on the owner's phone;
    // it exists because "should never" is not a thing to bet a photograph on.
    if (webp && webp.type === 'image/webp') {
      return { blob: webp, contentType: 'image/webp', width: canvas.width, height: canvas.height, encoder: 'webp' };
    }

    // JPEG, not the original bytes, and not a refusal. Every browser encodes
    // JPEG from a canvas, so this branch always produces something -- and it
    // produces something RESIZED, which is what actually matters: a fallback
    // that uploaded the 4032px original would put a 6 MB photograph on a
    // phone. Refusing instead and telling her to find another browser is the
    // alternative, and it is worse: she is holding a phone, in a restaurant,
    // and "use a different browser" is not an instruction she can act on.
    // The cost is one photograph's compression ratio.
    //
    // It is stored under the .webp key with contentType image/jpeg on purpose:
    // a browser obeys the served Content-Type and ignores the URL's extension,
    // so it renders correctly, and the key stays the one derivativeKeyFor
    // computes rather than becoming format-dependent.
    const jpeg = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    if (!jpeg) throw new Error('This browser could not prepare the photo. Try a different browser.');
    return { blob: jpeg, contentType: 'image/jpeg', width: canvas.width, height: canvas.height, encoder: 'jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 4: Export `encodeDerivative` from `scripts/images.mjs`, taking its width**

One recipe, two callers. `scripts/rederive.mjs` (Task 20) imports it rather than reimplementing it; if it were copied, the escape hatch would drift away from the pipeline it exists to restore.

```js
// scripts/images.mjs
//
// EXPORTED and now taking its width as an argument, because scripts/
// rederive.mjs is the escape hatch behind the browser encoder: it pulls an
// original out of R2, runs it through THIS function, and puts the result back
// under the same key. One recipe, two callers, no copy.
export function encodeDerivative(sourcePath, maxWidth) {
  return sharp(sourcePath).rotate().resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: QUALITY });
}
```

The existing `build()` call site changes from its inline `sharp(...)` chain to `encodeDerivative(source, maxWidthFor(source))`. **Watch `noUnusedLocals`:** if that removes the last use of a local, delete it in the same commit.

- [ ] **Step 5: The arithmetic tests — everything jsdom can honestly answer**

```ts
// src/admin/__tests__/derive.test.ts
//
// The arithmetic only. jsdom has no canvas encoder and no image decoder, so
// nothing here calls derive() itself; e2e/photo-upload.spec.ts is where a real
// encode is proven, in a real browser, against real bytes.
import { describe, it, expect } from 'vitest';
import { targetSize, halvingSteps, WEBP_QUALITY, JPEG_QUALITY } from '../derive';
import { maxWidthForCategory } from '../../shared/image-widths';
import { QUALITY } from '../../../scripts/paths.mjs';

describe('targetSize', () => {
  it('caps a wide photograph at the category width', () => {
    expect(targetSize({ width: 4032, height: 3024 }, 1000)).toEqual({ width: 1000, height: 750 });
  });

  it('never enlarges a small one', () => {
    expect(targetSize({ width: 400, height: 300 }, 1000)).toEqual({ width: 400, height: 300 });
  });

  it('caps a hero photograph lower than a food one', () => {
    const natural = { width: 4032, height: 3024 };
    expect(targetSize(natural, maxWidthForCategory('hero')).width)
      .toBeLessThan(targetSize(natural, maxWidthForCategory('food')).width);
  });

  it('never returns a zero dimension for an extreme aspect ratio', () => {
    expect(targetSize({ width: 8000, height: 3 }, 1000).height).toBeGreaterThanOrEqual(1);
  });
});

describe('halvingSteps', () => {
  it('halves until the last step is under a doubling', () => {
    expect(halvingSteps(4032, 1000)).toEqual([2016, 1000]);
  });

  it('goes straight there when the reduction is already small', () => {
    expect(halvingSteps(1200, 1000)).toEqual([1000]);
  });

  it('always ends at the target', () => {
    for (const from of [800, 1000, 1600, 4032, 8000]) {
      expect(halvingSteps(from, 1000).at(-1)).toBe(1000);
    }
  });

  it('terminates rather than looping on a target of one', () => {
    expect(halvingSteps(4032, 1).length).toBeLessThan(20);
  });
});

describe('quality', () => {
  // NOT `expect(WEBP_QUALITY).toBe(0.78)`, which compares a constant against
  // itself written twice. The claim is that the browser asks for the same
  // quality the fifty existing derivatives were made with, and QUALITY in
  // scripts/paths.mjs is the other half of it.
  it('matches the encoder the fifty existing derivatives were made with', () => {
    expect(Math.round(WEBP_QUALITY * 100)).toBe(QUALITY);
  });

  it('keeps the jpeg fallback above the webp number, since jpeg needs more', () => {
    expect(JPEG_QUALITY).toBeGreaterThan(WEBP_QUALITY);
  });
});
```

- [ ] **Step 6: The real encode, in a real browser**

```ts
// e2e/photo-upload.spec.ts
//
// The half only a real browser can answer: whether canvas.toBlob('image/webp')
// produces a WebP at all, at the capped width, materially smaller than what
// went in.
import { test, expect } from '@playwright/test';

test('a real browser produces a real webp, at the capped width, much smaller', async ({ page }) => {
  await page.goto('/edit');

  const result = await page.evaluate(async () => {
    // A 3000x2000 canvas standing in for a phone photograph. Generated in the
    // page rather than read from disk so the spec needs no fixture and
    // measures the browser's own encoder, which is the thing under test.
    const big = document.createElement('canvas');
    big.width = 3000;
    big.height = 2000;
    const context = big.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 3000, 2000);
    gradient.addColorStop(0, '#9D4949');
    gradient.addColorStop(1, '#C8D8E8');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 3000, 2000);
    for (let i = 0; i < 400; i++) {
      context.fillStyle = `hsl(${i % 360} 70% ${30 + (i % 40)}%)`;
      context.fillRect((i * 37) % 3000, (i * 53) % 2000, 40, 40);
    }
    const original = await new Promise<Blob>((r) => big.toBlob((b) => r(b!), 'image/jpeg', 0.95));
    const file = new File([original], 'photo.jpg', { type: 'image/jpeg' });
    const { derive } = await import('/src/admin/derive.ts');
    const derived = await derive(file, 'food');
    return {
      encoder: derived.encoder, type: derived.blob.type, width: derived.width,
      height: derived.height, bytes: derived.blob.size, originalBytes: original.size,
    };
  });

  expect(result.encoder).toBe('webp');
  expect(result.type).toBe('image/webp');
  expect(result.width).toBe(1000);
  expect(result.height).toBe(667);
  // A 3000px JPEG down to a 1000px WebP is a >3x reduction on any real
  // encoder. A number close to the original means the resize did not happen
  // and the encode simply re-wrapped the same pixels.
  expect(result.bytes).toBeLessThan(result.originalBytes / 3);
});

test('a hero photograph is capped lower than a food one', async ({ page }) => {
  await page.goto('/edit');
  const widths = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000; canvas.height = 2000;
    canvas.getContext('2d')!.fillRect(0, 0, 3000, 2000);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg'));
    const file = new File([blob], 'p.jpg', { type: 'image/jpeg' });
    const { derive } = await import('/src/admin/derive.ts');
    return { hero: (await derive(file, 'hero')).width, food: (await derive(file, 'food')).width };
  });
  expect(widths.hero).toBe(500);
  expect(widths.food).toBe(1000);
});
```

- [ ] **Step 7: Measure the cost on three REAL photographs, both ways, and write the number down**

Not an estimate. Run both encoders over the same three files and record what came out.

```
node --input-type=module -e "
import { encodeDerivative } from './scripts/images.mjs';
import { maxWidthFor } from './scripts/paths.mjs';
for (const f of ['assets-source/food/pizza1.JPG','assets-source/atmosphere/dining.jpg','assets-source/our_story/oven.jpg']) {
  const b = await encodeDerivative(f, maxWidthFor(f)).toBuffer();
  console.log('sharp', f, b.length);
}"
```

Then the same three through Chromium: add a temporary Playwright spec that reads each file with `readFileSync`, wraps it in a `File`, calls `derive(file, '<its category>')`, and prints `blob.size`. Delete the spec afterwards; the numbers go in the document, not in the suite.

`docs/image-derivation.md` records, as a table: the file, its category, its cap, sharp's byte count, the browser's byte count, and the percentage difference — **plus the Chromium version the browser column was produced on**, because that column is a property of an encoder, not of this repository.

Then a verdict paragraph, in one of two shapes:

> **Accepted at 0.78.** The browser column is N% larger on average. On a page carrying eight photographs that is roughly X KB more over the wire, against R2 egress that is free and a `max-age=31536000, immutable` cache header. The alternative is keeping 201 MB of originals in git forever.

or, **if any file is more than 40% larger:**

> **Re-measured at 0.72.** The first attempt at 0.78 produced N% and is recorded above; the second at 0.72 produced M%. `WEBP_QUALITY` is 0.72.

**Do not adjust the number silently, and do not record a number nobody ran.**

- [ ] **Step 8: Run it on the owner's actual phone before marking the task done**

No jsdom test and no Chromium spec can answer whether `canvas.toBlob('image/webp')` works on the device she uses. Add a temporary button to `/edit/manage` that calls `derive()` on a picked photograph and prints `{ encoder, type, size, width, height }`, deploy it to a Pages preview, and run it on her phone with a photograph straight from the camera roll — **including one taken in portrait**, so the EXIF rotation path is exercised for real. Record the browser, the version, the reported `encoder`, and whether the portrait came out upright. Then remove the button.

**If `encoder` reads `jpeg` on her phone, that is not a failure of this task** — it is the fallback doing its job, and it is recorded. **If the portrait comes out sideways, this task is wrong** and the `<img>` decode path needs replacing before Task 18 wires it in.

- [ ] **Step 9: `npx tsc -b --noEmit && npx eslint . && npm test -- --run src/shared/__tests__/image-widths.test.ts src/admin/__tests__/derive.test.ts scripts/__tests__/images.test.mjs && npm run test:bundle && npx playwright test e2e/photo-upload.spec.ts`**

`test:bundle` is in that list because `derive.ts` lives under `src/admin/` and `src/test/bundle.test.ts` fails the build if anything outside `src/admin/` reaches it. Nothing imports it yet, which is the point of building it before wiring it.

- [ ] **Step 10: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| change `DIR_MAX_WIDTH.hero` to `600` | "%s gets the same cap from both implementations" for every hero file | — |
| delete the `FILE_MAX_WIDTH` lookup | "gives the per-file override precedence over the directory one" | — |
| use the last path segment's directory instead of the top-level one | "does not let a nested directory inherit a top-level cap" | — |
| in `targetSize`, drop the `Math.min(1, …)` | "never enlarges a small one" | — |
| in `halvingSteps`, replace the loop with `return [toWidth]` | "halves until the last step is under a doubling" | — |
| in `halvingSteps`, change `width / 2 > toWidth` to `width > toWidth` | "terminates rather than looping on a target of one" | If the suite **hangs** instead of reddening, that IS the finding — the guard is load-bearing and the test's timeout is what reports it. |
| set `WEBP_QUALITY` to `0.9` | "matches the encoder the fifty existing derivatives were made with" | This row is the reason the assertion compares against `QUALITY` from `scripts/paths.mjs` and not against `0.78` written twice. If it does not redden, someone has replaced the cross-module comparison with a literal — the exact by-construction defect caught eight times here. |
| in `derive`, drop the `webp.type === 'image/webp'` check | nothing in jsdom; the e2e spec **stays green** in Chromium, which does encode WebP | Expected. Force it: temporarily pass `'image/nonsense'` as the type and confirm the JPEG branch is taken and `encoder` reads `'jpeg'`. If it still reads `'webp'`, the check is not consulted and the silent-PNG failure is live. |
| in `derive`, `throw` instead of falling back to JPEG | the forced check above — `derive` rejects instead of returning `encoder: 'jpeg'` | The fallback is a decision, not an accident. If it is ever removed, the plan's own cost statement is void and this row is where a reader finds out. |
| in `e2e/photo-upload.spec.ts`, assert `result.bytes < result.originalBytes` only | temporarily make `derive` skip the resize loop; the spec must fail on `originalBytes / 3` | If it passes with no resize, the assertion is too weak and the resize is unverified. |
| record `docs/image-derivation.md`'s browser column from an estimate rather than a run | nothing automated | This is a discipline, and it is the one the whole "measured" claim rests on. The file must name the Chromium version; a table with no version is a table nobody ran. |

**CSS ceiling:** expected **zero**. `src/shared/image-widths.ts` and `src/admin/derive.ts` render nothing and contain no class names; both files' comments were re-read for bare utility tokens after writing (`hidden`, `filter`, `static`, `table`, `block`, `order`, `grow`, `shrink` do not appear bare in either). Confirm with `npm run build` against 39441; a move means a comment leaked a token, and the fix is to reword it, not to raise the ceiling.

**If this task is wrong:** every photograph she uploads from Task 18 onward is the wrong size, sideways, or several times larger than it should be — and because the original is always stored beside it, the recovery is `npm run rederive`, not a lost photograph. **If the measurement is wrong**, the plan's central cost claim is a guess, and the first person to notice is a visitor on a phone waiting for the menu.

---

# Tier 1 — Every photograph readable at its final URL, before one reference moves

## Task 4: Copy the live bytes into R2, and prove they are the same bytes

The spec's own rule for this step: *"every image is uploaded and VERIFIED READABLE at its final URL before any content file is rewritten to point at it."* This task is that sentence, mechanised, **and it involves no encoder at all.**

**The bytes come from the production CDN, not from local `public/`.** `public/*/` is gitignored — `git ls-files | grep -c '\.webp$'` returns 0 — so the `.webp` files on a developer's disk are a local build artefact produced by whatever `sharp` and `libwebp` that machine happens to have. What the site serves was produced on Cloudflare's build image. Those two are *usually* identical and are not guaranteed to be, and "usually identical" is not a property to bet fifty photographs on. **Without this, the headline claim — every photograph is the identical file the site served before it — is not true**, and nothing downstream would ever detect that it was false.

**Nothing points at R2 when this task finishes.** The live site is byte-for-byte what it was, and every photograph on it is also sitting at a second URL that has answered a real HTTPS request.

**Files:**
- Create: `scripts/migrate-images.mjs`
- Create: `scripts/__tests__/migrate-images.test.mjs`
- Create: `image-manifest.json` (generated, committed)
- Create: `src/test/imageManifest.ts`
- Create: `src/test/__tests__/image-manifest.test.ts`
- Modify: `package.json` (add `migrate:images`)

**Interfaces:**

```js
// scripts/migrate-images.mjs
export const BUCKET, IMAGE_ORIGIN, SITE_ORIGIN;
export async function sha256Hex(bytes);
export function looksLikeWebp(bytes);
export function cacheControlFor(key);
export function contentTypeFor(key);
export async function migrate(objects, deps);   // deps: { fetchImpl, readLocal, put, readBack, log }
```

```ts
// src/test/imageManifest.ts
export interface ManifestObject { bytes: number; sha256: string; contentType: string; kind: 'derivative' | 'original' | 'menu'; verifiedAt: string }
export interface ImageManifest { host: string; generatedAt: string; objects: Record<string, ManifestObject> }
export const manifest: ImageManifest;
export const verifiedKeys: ReadonlySet<string>;
```

- [ ] **Step 1: The refusal that matters most**

```js
// scripts/migrate-images.mjs
//
// Copies the live derivatives into R2 without re-encoding a single one, and
// archives every original beside them.
//
// WHY FETCH RATHER THAN BUILD. public/*/ is gitignored: the .webp files on a
// developer's disk are a local build artefact, produced by whatever sharp and
// libwebp that machine happens to have. What the site actually serves was
// produced on Cloudflare's build image. Those two are usually identical and
// are not guaranteed to be, and "usually identical" is not a property to bet
// fifty photographs on. Fetching the live object makes the question unaskable.
//
// THE ONE FAILURE THIS MUST NOT ABSORB. This site has served an asset as
// text/html through a poisoned edge cache THREE TIMES -- it is the entire
// reason scripts/verify-deploy.mjs exists, and that script's SETTLE_MS
// constant is there because it has TWICE CAUSED the outage it detects. If one
// of those responses reaches this script, a 4 KB HTML document lands in the
// bucket wearing a .webp name, and every later check that looks only at a
// status code passes forever. So a response is refused unless BOTH its
// declared Content-Type is image/webp AND its first twelve bytes are a real
// RIFF....WEBP header AND the RIFF-declared payload length equals the body
// length. Not any one of the three: a poisoned response can carry a
// correct-looking header, and a correctly-typed response can still be
// truncated with its header intact.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);

export const BUCKET = 'via-bianca';
export const IMAGE_ORIGIN = 'https://img.viabiancarestaurant.com';
export const SITE_ORIGIN = 'https://viabiancarestaurant.com';

const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

export function looksLikeWebp(bytes) {
  if (bytes.length < 12) return false;
  for (let i = 0; i < 4; i++) if (bytes[i] !== RIFF[i]) return false;
  // Offset 8, not just the RIFF prefix: WAV files share the RIFF container and
  // differ only here. A RIFF check alone accepts an audio file.
  for (let i = 0; i < 4; i++) if (bytes[8 + i] !== WEBP[i]) return false;
  // RIFF declares its own payload length at offset 4, little-endian. A
  // truncated download fails this even though the header is intact -- which is
  // the failure a Content-Type check cannot see, because the header the
  // truncated response carries is the right one.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(4, true) + 8 === bytes.length;
}

export async function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
```

- [ ] **Step 2: The two cache policies (decision D8)**

```js
// A twelve-hex stem is worker/upload.ts's content-addressed key shape: the
// bytes under that key can never legitimately change, so the browser may keep
// them forever. Everything else is a legacy human-named key (food/pizza1.webp)
// or a stable menu name (menus/food-menu.pdf) that CAN be re-uploaded under
// the same key, so it gets a day.
//
// ONE BLANKET WEEK-LONG TTL WOULD BE WRONG, and this is the whole reason there
// are two policies: this migration has no purge mechanism for R2 at all, so a
// corrected photograph under a legacy name would be invisible for the length
// of the TTL. A day is long enough that the edge answers nearly every request
// and short enough that a correction appears without one.
const HASH_STEM = /\/[0-9a-f]{12}\.[a-z0-9]+$/i;

export function cacheControlFor(key) {
  return HASH_STEM.test('/' + key)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400';
}

const TYPES = {
  webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  avif: 'image/avif', tiff: 'image/tiff', gif: 'image/gif', pdf: 'application/pdf',
};

export function contentTypeFor(key) {
  const type = TYPES[key.slice(key.lastIndexOf('.') + 1).toLowerCase()];
  // NEVER a default of application/octet-stream: R2 serves whatever is stored
  // here, and a photograph served as octet-stream downloads instead of
  // painting. An unknown extension is a bug in the inventory, and it stops the
  // migration rather than shipping a key nothing can render. This repository
  // also carries files whose extension lies -- assets-source/atmosphere/
  // dining.jpg is PNG data with a .jpg name -- which is exactly why the
  // ORIGINAL's type is taken from detectFormat's answer upstream, not from
  // here; this function types the KEY, and the key's extension is chosen by us.
  if (!type) throw new Error(`no content type for "${key}"`);
  return type;
}
```

- [ ] **Step 3: Download from the CDN, upload, read back from the image host, compare digests**

```js
async function downloadDerivative(key, fetchImpl) {
  // Cache-busted and Origin-carrying: the poisoned-cache variant this site has
  // shipped three times is keyed on Origin, so a fetch without it can get a
  // clean copy while a browser gets the poisoned one.
  const response = await fetchImpl(`${SITE_ORIGIN}/${encodeURI(key)}?m=${Date.now()}`, {
    headers: { Origin: SITE_ORIGIN },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from the CDN`);
  const declared = (response.headers.get('content-type') ?? '').split(';')[0].trim();
  if (declared !== 'image/webp') throw new Error(`the CDN served it as "${declared}", not image/webp`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!looksLikeWebp(bytes)) throw new Error('the bytes are not a complete RIFF WEBP');
  return bytes;
}

export async function migrate(objects, deps) {
  const { fetchImpl, readLocal, put, readBack, log } = deps;
  const done = [];
  const failed = [];

  for (const object of objects) {
    try {
      const bytes = object.kind === 'original'
        ? await readLocal('assets-source/' + object.key.slice('source/'.length))
        : object.kind === 'menu'
          ? await readLocal('public/' + object.key)
          : await downloadDerivative(object.key, fetchImpl);

      const contentType = contentTypeFor(object.key);
      const digest = await sha256Hex(bytes);
      await put(object.key, bytes, { contentType, cacheControl: cacheControlFor(object.key) });

      // The read-back is from img.viabiancarestaurant.com, NOT from the bucket
      // API. What is being proven is not "the PUT returned 200" -- it is "the
      // hostname the content files are about to point at answers this key with
      // these exact bytes, under this exact type". Those are different claims
      // and only the second one is the one that matters.
      const served = await readBack(object.key);
      const servedDigest = await sha256Hex(served.bytes);
      if (servedDigest !== digest) {
        failed.push({ key: object.key, reason: `digest mismatch: stored ${digest}, served ${servedDigest}` });
        continue;
      }
      if (served.contentType !== contentType) {
        failed.push({ key: object.key, reason: `served as ${served.contentType}` });
        continue;
      }
      done.push({ key: object.key, bytes: bytes.length, sha256: digest, contentType, kind: object.kind, verifiedAt: new Date().toISOString() });
      log(` ok  ${object.key}  ${bytes.length}B  ${digest.slice(0, 12)}`);
    } catch (error) {
      failed.push({ key: object.key, reason: error instanceof Error ? error.message : String(error) });
      log(`FAIL ${object.key}  -- ${failed[failed.length - 1].reason}`);
    }
  }

  return { done, failed };
}
```

- [ ] **Step 4: `put` is `wrangler`, so the migration needs no new secret**

```js
// wrangler r2 object put, one child process per object. Slower than the S3 API
// and chosen anyway: the S3 path needs an access key pair that would have to
// be created, stored and then remembered about, and this runs once.
//
// --remote IS NOT OPTIONAL. Without it wrangler writes to the LOCAL miniflare
// simulation: every PUT reports success and every read-back over HTTPS 404s.
// Task 1 Step 3's delete-then-404 check exists for the same reason.
async function putViaWrangler(key, bytes, { contentType, cacheControl }) {
  const tmp = join(tmpdir(), 'vb-' + randomUUID());
  await writeFile(tmp, bytes);
  try {
    await run('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`,
      '--file', tmp, '--content-type', contentType, '--cache-control', cacheControl, '--remote']);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function readBackOverHttps(key) {
  const response = await fetch(`${IMAGE_ORIGIN}/${encodeURI(key)}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`read-back HTTP ${response.status}`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: (response.headers.get('content-type') ?? '').split(';')[0].trim(),
  };
}
```

- [ ] **Step 5: Run it, and refuse to proceed on anything but zero failures**

```json
    "migrate:images": "node scripts/migrate-images.mjs",
```

```
npm run migrate:images -- --inventory docs/image-inventory.json | tee /tmp/vb-migrate.txt
```

The inventory's `objects` list drives it. Expected: **50 derivatives + 50 originals = 100 objects, `0 failed`** (the two menu PDFs are `kind: 'menu'` and are held back for Task 19 — pass `--menus` there). **Any non-zero failure count stops the tier.** Do not proceed to Task 6 with a partial bucket. Re-running is safe: every PUT overwrites the same key with the same bytes.

The manifest is written whatever happened, but **only objects that passed both checks carry a `verifiedAt`** — Task 6's rewrite refuses to touch a reference whose target has none, so a partial migration cannot become a partial rewrite.

- [ ] **Step 6: The manifest loader, and the parity claim it makes checkable**

```ts
// src/test/imageManifest.ts
//
// image-manifest.json, loaded once, the way src/test/publicFiles.ts loads the
// public/ tree -- so every test that has to decide whether an image reference
// resolves agrees with every other one about what "exists" means.
//
// Lives at the repository ROOT rather than under src/content/, deliberately:
// src/content/__tests__/assets.test.ts walks every .json file under
// src/content/ as content data and would try to resolve this file's own keys
// as if they were image references.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ManifestObject {
  bytes: number;
  sha256: string;
  contentType: string;
  kind: 'derivative' | 'original' | 'menu';
  verifiedAt: string;
}

export interface ImageManifest {
  host: string;
  generatedAt: string;
  objects: Record<string, ManifestObject>;
}

export const manifest: ImageManifest = JSON.parse(
  readFileSync(join(process.cwd(), 'image-manifest.json'), 'utf-8'),
) as ImageManifest;

// The keys a page can actually reference. The source/ prefix holds originals,
// which nothing serves and nothing links to.
export const verifiedKeys: ReadonlySet<string> = new Set(
  Object.entries(manifest.objects)
    .filter(([key, entry]) => !key.startsWith('source/') && typeof entry.verifiedAt === 'string')
    .map(([key]) => key),
);
```

```ts
// src/test/__tests__/image-manifest.test.ts
import { describe, it, expect } from 'vitest';
import { manifest, verifiedKeys } from '../imageManifest';
import { IMAGE_HOST } from '../../shared/image-host';

describe('image-manifest.json describes the bytes the image host actually serves', () => {
  it('names the same host src/shared/image-host.ts does', () => {
    expect(manifest.host).toBe(IMAGE_HOST);
  });

  // Not an exact count: she uploads photographs, and pinning 50 here would
  // turn her next upload into a red suite. The floor is what matters -- an
  // empty or half-written manifest would otherwise make every it.each below
  // vacuous while the suite stayed green.
  it('holds a non-trivial number of served objects', () => {
    expect(verifiedKeys.size).toBeGreaterThanOrEqual(50);
  });

  it('lists an archived original for every derivative it migrated', () => {
    const derivatives = Object.entries(manifest.objects).filter(([, o]) => o.kind === 'derivative');
    const originals = Object.entries(manifest.objects).filter(([, o]) => o.kind === 'original');
    expect(derivatives.length).toBeGreaterThanOrEqual(50);
    expect(originals.length).toBeGreaterThanOrEqual(50);
  });

  // The filter in verifiedKeys, asserted from the other end. Replacing it with
  // Object.keys(manifest.objects) would keep the count assertion green (100 is
  // also >= 50) and quietly admit fifty archived originals as linkable keys.
  it('never admits a source/ key or an unverified object as linkable', () => {
    expect([...verifiedKeys].every((k) => !k.startsWith('source/'))).toBe(true);
    expect([...verifiedKeys].every((k) => typeof manifest.objects[k].verifiedAt === 'string')).toBe(true);
  });

  it('records a real content type for every object, never octet-stream', () => {
    for (const [key, entry] of Object.entries(manifest.objects)) {
      expect(entry.contentType, key).toMatch(/^(image\/|application\/pdf)/);
    }
  });

  it('gives a content-addressed key the immutable policy and a named key a day', () => {
    // Reads the RECORDED policy rather than recomputing it, so this cannot
    // agree with cacheControlFor by construction.
    const hashed = Object.keys(manifest.objects).filter((k) => /\/[0-9a-f]{12}\./.test(k));
    const named = Object.keys(manifest.objects).filter((k) => !/\/[0-9a-f]{12}\./.test(k) && !k.startsWith('source/'));
    expect(named.length).toBeGreaterThan(0);
    for (const key of hashed) expect(manifest.objects[key].cacheControl, key).toContain('immutable');
    for (const key of named) expect(manifest.objects[key].cacheControl, key).not.toContain('immutable');
  });
});
```

(The manifest writer records `cacheControl` alongside `contentType`; add it to `ManifestObject`.)

- [ ] **Step 7: The unit tests, with no network and no bucket**

```js
// scripts/__tests__/migrate-images.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { looksLikeWebp, cacheControlFor, contentTypeFor, migrate } from '../migrate-images.mjs';

function webp(payload = 4) {
  const bytes = new Uint8Array(12 + payload);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(bytes.buffer).setUint32(4, 4 + payload, true);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

function riffWav() {
  const bytes = webp(4);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);   // 'WAVE'
  return bytes;
}

describe('what is refused before it can reach the bucket', () => {
  it('refuses an HTML document wearing a .webp name', () => {
    expect(looksLikeWebp(new TextEncoder().encode('<!doctype html><html><head></head></html>'))).toBe(false);
  });

  it('refuses a RIFF file that is not a WEBP', () => {
    expect(looksLikeWebp(riffWav())).toBe(false);
  });

  it('refuses a truncated webp whose header is intact', () => {
    const good = webp(64);
    expect(looksLikeWebp(good.subarray(0, good.length - 10))).toBe(false);
  });

  it('accepts a well-formed one', () => {
    expect(looksLikeWebp(webp())).toBe(true);
  });
});

describe('cache policy', () => {
  it('makes a content-addressed key immutable', () => {
    expect(cacheControlFor('food/0123456789ab.webp')).toContain('immutable');
  });

  it('does not make a legacy named key immutable', () => {
    expect(cacheControlFor('food/pizza1.webp')).not.toContain('immutable');
  });

  it('does not make a menu pdf immutable, so a replacement appears without a purge', () => {
    expect(cacheControlFor('menus/food-menu.pdf')).not.toContain('immutable');
  });
});

describe('content type', () => {
  it('stops the migration rather than storing an unrenderable type', () => {
    expect(() => contentTypeFor('food/x.heic')).toThrow();
  });
});

describe('the read-back', () => {
  const object = { key: 'food/a.webp', kind: 'derivative' };
  const ok = (bytes) => async () => ({
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'image/webp' }),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });

  it('fails the object when the served bytes differ from the stored ones', async () => {
    const result = await migrate([object], {
      fetchImpl: ok(webp(64)), put: vi.fn(),
      readBack: async () => ({ bytes: webp(8), contentType: 'image/webp' }), log: () => {},
    });
    expect(result.failed[0].reason).toMatch(/digest mismatch/);
    expect(result.done).toHaveLength(0);
  });

  it('fails the object when the host serves it under the wrong type', async () => {
    const bytes = webp(64);
    const result = await migrate([object], {
      fetchImpl: ok(bytes), put: vi.fn(),
      readBack: async () => ({ bytes, contentType: 'application/octet-stream' }), log: () => {},
    });
    expect(result.failed[0].reason).toMatch(/served as application\/octet-stream/);
  });

  it('refuses an HTML body the CDN served with an image content type', async () => {
    const html = new TextEncoder().encode('<!doctype html><html>poisoned</html>');
    const result = await migrate([object], {
      fetchImpl: ok(html), put: vi.fn(),
      readBack: async () => { throw new Error('should never be reached'); }, log: () => {},
    });
    expect(result.failed[0].reason).toMatch(/not a complete RIFF WEBP/);
  });

  it('records the digest of an object that survives every check', async () => {
    const bytes = webp(64);
    const result = await migrate([object], {
      fetchImpl: ok(bytes), put: vi.fn(),
      readBack: async () => ({ bytes, contentType: 'image/webp' }), log: () => {},
    });
    expect(result.failed).toHaveLength(0);
    expect(result.done[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.done[0].verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // The single most valuable case in this file: it proves an object that fails
  // is not ALSO counted as done. Without it every assertion above could pass
  // while migrate() pushed to both arrays.
  it('never counts a failed object as done', async () => {
    const result = await migrate([object], {
      fetchImpl: async () => ({ ok: false, status: 502, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }),
      put: vi.fn(), readBack: async () => { throw new Error('unreachable'); }, log: () => {},
    });
    expect(result.done).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });
});
```

- [ ] **Step 8: `npx eslint scripts/migrate-images.mjs && npm test -- --run scripts/__tests__/migrate-images.test.mjs src/test/__tests__/image-manifest.test.ts`**

- [ ] **Step 9: Commit the manifest before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| make `looksLikeWebp` check only the `RIFF` prefix | "refuses a RIFF file that is not a WEBP" | — |
| drop the RIFF-declared-length comparison | "refuses a truncated webp whose header is intact" | — |
| drop the `content-type` check in `downloadDerivative` | "refuses an HTML body the CDN served with an image content type" stays green (the byte check still catches it) — **so also** delete the `looksLikeWebp` call and re-run: that test must then redden | Both checks are load-bearing and each catches what the other misses. If neither reddens, `downloadDerivative` is not being reached at all and the fixture is wrong. |
| make `cacheControlFor` always return the immutable policy | "does not make a legacy named key immutable" and "does not make a menu pdf immutable…" | — |
| make `contentTypeFor` return `application/octet-stream` for an unknown extension | "stops the migration rather than storing an unrenderable type" | — |
| in `migrate`, change the digest-mismatch branch from `continue` to falling through | "never counts a failed object as done" | — |
| in `migrate`, compare `digest` against itself instead of `servedDigest` | "fails the object when the served bytes differ from the stored ones" | **This is the by-construction row.** If it does not redden, the test is comparing a value against the thing that produced it — the exact defect caught eight times on this project. |
| read the derivative from `public/` instead of fetching the CDN | nothing automated | Expected, and it is why this row is written down: no test can tell a local build artefact from the served one when they happen to match. The guard is the code comment and the manifest's recorded digest. If the fetch is ever replaced with `readLocal`, the plan's headline claim is void. |
| drop `--remote` from `putViaWrangler` | nothing in the unit suite; **Step 5's real run** fails at the first read-back with a 404 | This is why Step 5 is a step and not an afterthought: no unit test can catch a local-vs-remote bucket. |
| replace `verifiedKeys`'s filter with `Object.keys(manifest.objects)` | "never admits a source/ key or an unverified object as linkable" | — |

**CSS ceiling:** zero bytes. `scripts/`, `image-manifest.json` and `src/test/` are outside Tailwind's content glob.

**If this task is wrong:** R2 holds objects that are not the photographs the site is serving, and Task 6 points 77 references at them. Every check between here and there exists to make that state unreachable before a single reference moves.

---

## Task 5: The live sweep, wired into `verify:deploy` BEFORE anything is rewritten

The spec: *"The image path rewrite is verified against the live site, not against a fixture."* This task builds that check and puts it in the deploy gate **while the references still point at `public/`**, so its first several runs prove it works against a state everyone already knows is correct. **A checker introduced in the same commit as the change it checks has never been observed passing on a known-good input**, and this project has shipped guardrails that silently reduced to nothing more than once.

**Files:**
- Create: `scripts/verify-image-urls.mjs`
- Create: `src/test/__tests__/verify-image-urls.test.ts`
- Modify: `scripts/verify-deploy.mjs`
- Modify: `package.json` (add `verify:images`)

**Interfaces:**

```js
// scripts/verify-image-urls.mjs
export const ISLAND_ID;
export function referencesIn(value, found);
export function islandFrom(html);
export function committedReferences();                 // every reference in src/content/*.json
export async function sweep(references, origin, fetchImpl);  // -> [{ url, why }]
```

- [ ] **Step 1: The sweep, over the union of what the live site serves and what the repository holds**

```js
// scripts/verify-image-urls.mjs
//
// Every image a visitor's browser is about to ask for, asked for.
//
// IT SWEEPS THE UNION of two populations, and the union is the point:
//
//   (1) The content island the Worker injects into the live homepage
//       (worker/site-page.ts, Task 10). That covers every document whose live
//       copy is a D1 row -- documents this repository does not hold and a
//       walk of src/content/ cannot see. Before Task 12 there is no island,
//       and this half is simply empty.
//
//   (2) Every reference in the committed src/content/*.json. That covers every
//       document still backed by GitHub, for which the committed file IS what
//       the site serves, and press.json, which never moves.
//
// A checker that swept only (1) would go quietly vacuous for GitHub-backed
// documents; one that swept only (2) would go quietly vacuous the moment a
// document moved to D1. Sweeping both cannot be vacuous either way.
//
// THE UNION PRODUCES NO FALSE POSITIVES, and the reason is decision D9:
// NOTHING in this system ever deletes an R2 object. So a committed floor that
// has drifted behind a D1 row still names an object that is still there and
// still answers. A reference that fails this sweep is a real failure.
//
// HEAD, not GET: the question is whether the object is there and correctly
// typed, and 2.6 MB of image bodies per deploy check buys nothing. R2 answers
// HEAD with the same status and content-type it answers GET with.
export const ISLAND_ID = 'vb-content';

const ASSET_PATH_PATTERN = /^\/.+\.(jpg|jpeg|png|webp|avif|svg)$/i;
const IMAGE_URL_PATTERN = /^https:\/\/[a-z0-9.-]+\/.+\.(jpg|jpeg|png|webp|avif|gif)$/i;

export function referencesIn(value, found = []) {
  if (typeof value === 'string') {
    if (ASSET_PATH_PATTERN.test(value) || IMAGE_URL_PATTERN.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => referencesIn(item, found));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => referencesIn(item, found));
  }
  return found;
}

// Pulled out of the served HTML with a regex rather than a DOM parser: this
// script runs in plain Node with no jsdom, and the anchor it looks for is a
// script tag this repository authors itself and pins with its own test
// (worker/__tests__/site-page.test.ts). A parser here would be a second
// dependency for a single, fully-controlled shape.
export function islandFrom(html) {
  const match = html.match(
    new RegExp(`<script type="application/json" id="${ISLAND_ID}">([\\s\\S]*?)</script>`),
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1].replaceAll('\\u003c', '<'));
  } catch {
    return null;
  }
}

export async function sweep(references, origin, fetchImpl = fetch) {
  const problems = [];
  const seen = new Set();
  for (const reference of references) {
    if (seen.has(reference)) continue;
    seen.add(reference);
    const url = reference.startsWith('/') ? origin + reference : reference;
    let response;
    try {
      response = await fetchImpl(url, { method: 'HEAD', headers: { Origin: origin } });
    } catch (error) {
      problems.push({ url, why: `unreachable: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (!response.ok) {
      problems.push({ url, why: `HTTP ${response.status}` });
      continue;
    }
    // The SPA catch-all in public/_redirects answers a MISSING site-root path
    // with index.html at 200 -- so a 200 alone cannot tell a real photograph
    // from a missing one. The content type is what separates them, and it is
    // the same distinction scripts/verify-deploy.mjs already draws for .js and
    // .css assets, for the same outage.
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!type.startsWith('image/')) problems.push({ url, why: `served as "${type}", not an image` });
  }
  return problems;
}
```

- [ ] **Step 2: The runner, which reports both halves separately**

```js
export function committedReferences() {
  const { readdirSync, readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const dir = join('src', 'content');
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .flatMap((n) => referencesIn(JSON.parse(readFileSync(join(dir, n), 'utf-8'))));
}

if (import.meta.filename === process.argv[1]) {
  const site = process.env.VB_SITE ?? 'https://viabiancarestaurant.com';
  const origin = new URL(site).origin;

  const homepage = await fetch(site, { headers: { Origin: origin }, cache: 'no-store' });
  const island = homepage.ok ? islandFrom(await homepage.text()) : null;
  const fromIsland = island ? referencesIn(island) : [];
  const fromRepo = committedReferences();

  console.log(
    island
      ? `live content island: ${fromIsland.length} references`
      : 'no content island on the live page (expected before Task 12)',
  );
  console.log(`committed documents: ${fromRepo.length} references`);

  const references = [...new Set([...fromIsland, ...fromRepo])];
  const problems = await sweep(references, origin);
  for (const { url, why } of problems) console.error(`  BROKEN  ${url}  -- ${why}`);
  console.log(`\n${references.length - problems.length}/${references.length} distinct image references resolve on ${site}`);
  if (problems.length > 0) process.exitCode = 1;
}
```

- [ ] **Step 3: Wire it into the deploy gate**

```json
    "verify:images": "node scripts/verify-image-urls.mjs",
```

In `scripts/verify-deploy.mjs`, after the build-info poll and the `SETTLE_MS` wait and before `checkPostSeo`:

```js
// Every image reference on the live site, fetched. Placed AFTER the build-info
// poll and the settle wait, so it runs against a deployment that has finished
// propagating -- an image sweep during propagation would report failures that
// are really just a deploy in flight, and this script has twice caused the
// outage it exists to catch by fetching too early.
{
  const { islandFrom, referencesIn, committedReferences, sweep } = await import('./verify-image-urls.mjs');
  const homepage = await get('/');
  const island = homepage.ok ? islandFrom(await homepage.text()) : null;
  const references = [...new Set([...(island ? referencesIn(island) : []), ...committedReferences()])];
  const problems = await sweep(references, ORIGIN, absoluteGet);
  console.log(`  ${references.length - problems.length}/${references.length} image references resolve`);
  for (const { url, why } of problems) failures.push(`image ${url}: ${why}`);
}
```

with, next to the existing `get`:

```js
// The same Origin-carrying fetch `get` uses, but taking an ABSOLUTE url --
// image references point at a different hostname now and `get` prefixes SITE.
// The Origin header stays on both, because the poisoned-cache variant this
// script exists to detect is keyed on it.
function absoluteGet(url, init = {}) {
  return fetch(url, { ...init, headers: { Origin: ORIGIN, ...(init.headers ?? {}) } });
}
```

- [ ] **Step 4: Run it against the live site right now, unchanged**

```
npm run verify:images
```

Expected today, before any rewrite: `no content island on the live page (expected before Task 12)`, `committed documents: 69 references`, then `69/69 distinct image references resolve`. **That green run against a known-good, unrewritten site is the evidence this checker works**, and it is the reason this task comes before Task 6 rather than with it.

- [ ] **Step 5: The unit tests for `sweep`'s three rejection branches**

```ts
// src/test/__tests__/verify-image-urls.test.ts
import { describe, it, expect } from 'vitest';
import { referencesIn, islandFrom, sweep } from '../../../scripts/verify-image-urls.mjs';

const ORIGIN = 'https://viabiancarestaurant.com';

function fake(map: Record<string, { status: number; type: string }>) {
  return async (url: string) => {
    const answer = map[url];
    if (!answer) throw new Error('no route');
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: new Headers({ 'content-type': answer.type }),
    } as unknown as Response;
  };
}

describe('the live image sweep', () => {
  it('finds references nested anywhere in a document, of every extension', () => {
    const found = referencesIn({
      a: [{ image: '/food/x.webp' }],
      b: { c: 'https://img.h/y.webp' },
      d: '/og-image.jpg',
    });
    expect(found).toEqual(['/food/x.webp', 'https://img.h/y.webp', '/og-image.jpg']);
  });

  it('ignores strings that are not image references', () => {
    expect(referencesIn({ url: 'https://viabiancarestaurant.com', file: '/menus/food-menu.pdf' })).toEqual([]);
  });

  it('reads the island out of served html', () => {
    const html = '<head><script type="application/json" id="vb-content">{"a":1}</script></head>';
    expect(islandFrom(html)).toEqual({ a: 1 });
  });

  it('returns null rather than throwing when there is no island', () => {
    expect(islandFrom('<head></head>')).toBeNull();
  });

  it('passes an image that answers 200 with an image content type', async () => {
    const url = 'https://img.h/y.webp';
    expect(await sweep([url], ORIGIN, fake({ [url]: { status: 200, type: 'image/webp' } }))).toEqual([]);
  });

  it('fails a reference that 404s', async () => {
    const url = 'https://img.h/y.webp';
    expect(await sweep([url], ORIGIN, fake({ [url]: { status: 404, type: 'text/html' } })))
      .toEqual([{ url, why: 'HTTP 404' }]);
  });

  // The exact shape the SPA catch-all produces for a missing site-root path:
  // 200, but it is index.html. A status-only check calls this healthy.
  it('fails a reference answered 200 with text/html', async () => {
    const url = 'https://viabiancarestaurant.com/food/gone.webp';
    const problems = await sweep(['/food/gone.webp'], ORIGIN, fake({ [url]: { status: 200, type: 'text/html' } }));
    expect(problems[0].why).toContain('not an image');
  });

  it('reports an unreachable host rather than throwing out of the sweep', async () => {
    expect((await sweep(['https://img.h/y.webp'], ORIGIN, fake({})))[0].why).toContain('unreachable');
  });

  it('sweeps each distinct url once, however many documents name it', async () => {
    let calls = 0;
    const url = 'https://img.h/y.webp';
    await sweep([url, url, url], ORIGIN, async () => {
      calls += 1;
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/webp' }) } as unknown as Response;
    });
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 6: `npx eslint scripts/verify-image-urls.mjs scripts/verify-deploy.mjs && npm test -- --run src/test/__tests__/verify-image-urls.test.ts && npm run verify:images`**

- [ ] **Step 7: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| drop the `content-type` check from `sweep` | "fails a reference answered 200 with text/html" | — |
| drop the `!response.ok` check | "fails a reference that 404s" | — |
| remove the `try`/`catch` around the fetch | "reports an unreachable host rather than throwing out of the sweep" | — |
| remove the `seen` set | "sweeps each distinct url once, however many documents name it" | — |
| change `ASSET_PATH_PATTERN` to require `.webp` only | "finds references nested anywhere in a document, of every extension" — the `/og-image.jpg` entry is why that fixture carries a second extension | — |
| change `ISLAND_ID` to `vb-contents` | "reads the island out of served html" | — |
| make `islandFrom` throw instead of returning null on a missing tag | "returns null rather than throwing when there is no island" | — |
| drop `committedReferences()` from the runner's union, keeping only the island | nothing automated **today** (there is no island yet, so the sweep would report 0/0 and exit 0) | **This is the vacuity row and it is the reason the runner prints both counts separately.** A run that reports `0/0 references resolve` is a green run that proved nothing. If the totals ever drop to zero, treat it as a red run. |
| in `verify-deploy.mjs`, push image problems to a local array instead of `failures` | run `npm run verify:deploy` against a site with one deliberately broken reference; it must exit 1 | If it exits 0, the check is running and reporting but not gating, which is the same as not running it. |

**CSS ceiling:** zero bytes. `scripts/` is outside the content glob; the test file under `src/test/` was re-read for utility tokens.

**If this task is wrong:** the deploy gate reports every image resolving while photographs are 404ing — which is worse than having no check, because it is the check somebody will point at when the site looks wrong.

---

## Task 6: Rewrite all 77 references, fix `absoluteImageUrl`, and move the offline guardrail with them

The riskiest single commit in this plan. Everything it points at has been uploaded (Task 4), verified over real HTTPS from the image host (Task 4), and is being swept on every deploy (Task 5). The CSP that would otherwise refuse it shipped in Task 1. **`public/` still holds every file the old paths named, so `git revert` on this one commit restores the site exactly.**

**77, not 68.** The 68 in `src/content/*.json` **and the nine in code**: `src/index.css:196`, `Hero.tsx:128`, `ChefGallery.tsx:13`, `SignatureMocktails.tsx` ×5, and the doc comment in `src/content/types.ts:187`. Leaving the nine behind leaves the homepage's own background texture and five mocktail photographs pointing at a directory that will stop being deployed.

**And one function.** `worker/post-seo.ts`'s `absoluteImageUrl` is `` `${siteUrl}${image}` ``. Given an absolute URL it emits `https://viabiancarestaurant.comhttps://img.viabiancarestaurant.com/press/hotelier.webp`. `press.json`'s 12 references become absolute in this task and `posts.json`'s 3 in the next, and every post's `og:image` and Article structured data would point at a URL that does not resolve — **caught only after a deploy, by a link unfurler, which does not report.**

**Files:**
- Create: `scripts/rewrite-image-refs.mjs`
- Create: `scripts/__tests__/rewrite-image-refs.test.mjs`
- Modify: eight files under `src/content/` (68 strings)
- Modify: `src/index.css`, `src/components/Hero.tsx`, `src/components/ChefGallery.tsx`, `src/components/SignatureMocktails.tsx`, `src/content/types.ts` (9 strings)
- Modify: `worker/post-seo.ts`, `worker/__tests__/post-seo.test.ts`
- Modify: `src/content/__tests__/assets.test.ts`
- Modify: `docs/cloudflare-cutover.md`

**Interfaces:**

```js
// scripts/rewrite-image-refs.mjs
export function stays(path);
export function rewriteJson(value, manifest, report);
export function rewriteSource(text, manifest, report);
```

```ts
// worker/post-seo.ts -- ONE function's body changes. Its signature does not.
export function absoluteImageUrl(image: string, siteUrl?: string): string;
```

- [ ] **Step 1: Fix `absoluteImageUrl` FIRST, in its own commit, before a single reference moves**

```ts
// worker/post-seo.ts
//
// `image` may be a site-relative path (/og-image.jpg, and every post's image
// before the 2026-08-21 migration) or an absolute URL on the image host (every
// post's image after it). `new URL(image, siteUrl)` handles both correctly:
// an absolute input wins outright and a relative one is resolved against the
// site. String concatenation handled only the first shape, and given the
// second it emitted
//   https://viabiancarestaurant.comhttps://img.viabiancarestaurant.com/...
// -- a URL that resolves nowhere, in every post's og:image and in the Article
// structured data, discoverable only by fetching a deployed page or by a link
// unfurler that does not report back.
export function absoluteImageUrl(image: string, siteUrl: string = SITE_URL): string {
  return new URL(image, siteUrl).toString();
}
```

```ts
// worker/__tests__/post-seo.test.ts
  it('leaves an absolute image url alone rather than prefixing the site onto it', () => {
    expect(absoluteImageUrl('https://img.viabiancarestaurant.com/press/hotelier.webp', 'https://viabiancarestaurant.com'))
      .toBe('https://img.viabiancarestaurant.com/press/hotelier.webp');
  });

  it('still resolves a site-relative path against the site', () => {
    expect(absoluteImageUrl('/og-image.jpg', 'https://viabiancarestaurant.com'))
      .toBe('https://viabiancarestaurant.com/og-image.jpg');
  });

  // The two above pass on a `siteUrl + image` implementation for the second
  // case only. This one is what makes the first case's failure loud: a
  // doubled scheme is a shape no valid URL has.
  it('never emits a url with two schemes in it', () => {
    for (const image of ['https://img.viabiancarestaurant.com/a.webp', '/b.jpg']) {
      expect(absoluteImageUrl(image, 'https://viabiancarestaurant.com').match(/https:\/\//g)).toHaveLength(1);
    }
  });
```

**Commit this before Step 2.** A one-line fix that ships with a 77-file rewrite is a one-line fix nobody reviewed.

- [ ] **Step 2: The rewrite, which refuses**

```js
// scripts/rewrite-image-refs.mjs
//
// The 77 references, once. Run by a human, output committed, never run again.
//
// IT REFUSES BEFORE IT WRITES. Every reference it is about to rewrite must
// name a key that image-manifest.json marks with a `verifiedAt` -- meaning
// scripts/migrate-images.mjs fetched it from the production CDN, refused it
// unless the bytes were a complete RIFF WEBP, uploaded it, fetched it BACK
// from img.viabiancarestaurant.com, and matched the SHA-256. If a single
// reference fails that test, this script writes NOTHING AT ALL and exits 1.
// A partial rewrite is a page of mixed working and broken photographs, which
// is harder to notice and harder to undo than a rewrite that did not happen.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH:
//
//   /og-image.jpg  -- site.json's seo.ogImage. src/components/SeoHead.tsx and
//     worker/post-seo.ts turn it absolute by resolving it against
//     site.seo.url; it is generated by scripts/images.mjs's encodeOgImage
//     rather than by outputPathFor, so it was never part of the derivative set
//     this migration moved. Link unfurlers fetch it from this origin and will
//     keep doing so. This is the one reference that makes the census 69 and
//     the content rewrite 68.
//
//   /menus/*.pdf  -- Task 19's population, moved with their upload path.
//
//   /favicon-*.png, /apple-touch-icon.png, /icon-*.png  -- referenced from
//     index.html, not from content, and browsers and PWA manifests expect them
//     at the site root.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT_DIR = join('src', 'content');
const HOST = 'https://img.viabiancarestaurant.com';

const CODE_FILES = [
  'src/index.css',
  'src/components/Hero.tsx',
  'src/components/ChefGallery.tsx',
  'src/components/SignatureMocktails.tsx',
  'src/content/types.ts',
];

const KEEP = new Set(['/og-image.jpg']);
const KEEP_PREFIX = ['/menus/', '/favicon', '/apple-touch-icon', '/icon-'];
const ASSET_PATH_PATTERN = /^\/.+\.(jpg|jpeg|png|webp|avif|svg)$/i;

export function stays(path) {
  return KEEP.has(path) || KEEP_PREFIX.some((prefix) => path.startsWith(prefix));
}

function target(path, manifest, report) {
  if (stays(path)) { report.skipped.push(path); return null; }
  const key = path.slice(1);
  const entry = manifest.objects[key];
  if (!entry || !entry.verifiedAt) { report.missing.push(path); return null; }
  report.changed.push(path);
  // encodeURI, not the raw key. Five filenames carry spaces
  // (mocktails/blood orange espresso tonic.webp and friends) and one an
  // apostrophe. As a site-root path in an img src the browser encodes those
  // itself; as an absolute URL in JSON or in a CSS url() they have to arrive
  // already encoded, or the request goes to a different key than R2 holds.
  return HOST + '/' + encodeURI(key);
}

export function rewriteJson(value, manifest, report) {
  if (typeof value === 'string') {
    if (!ASSET_PATH_PATTERN.test(value)) return value;
    return target(value, manifest, report) ?? value;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteJson(item, manifest, report));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteJson(v, manifest, report)]));
  }
  return value;
}

// The code half. Matches a quoted or url()-wrapped site-root path -- the same
// expression scripts/image-inventory.mjs's CODE_ASSET_PATTERN uses -- and
// replaces it in place, so a .tsx attribute, a .css url() and a doc comment
// are all handled by one function and none of them can be forgotten.
export function rewriteSource(text, manifest, report) {
  return text.replace(/(["'`(])(\/[^"'`()\n]+\.(?:jpg|jpeg|png|webp|avif|svg))(["'`)])/gi,
    (whole, open, path, close) => {
      const replaced = target(path, manifest, report);
      return replaced === null ? whole : open + replaced + close;
    });
}

if (import.meta.filename === process.argv[1]) {
  const manifest = JSON.parse(readFileSync('image-manifest.json', 'utf-8'));
  const report = { changed: [], skipped: [], missing: [] };
  const pending = [];

  for (const name of readdirSync(CONTENT_DIR).filter((n) => n.endsWith('.json'))) {
    const file = join(CONTENT_DIR, name);
    const before = readFileSync(file, 'utf-8');
    const after = JSON.stringify(rewriteJson(JSON.parse(before), manifest, report), null, 2) + '\n';
    if (after !== before) pending.push({ file, after });
  }
  for (const file of CODE_FILES) {
    const before = readFileSync(file, 'utf-8');
    const after = rewriteSource(before, manifest, report);
    if (after !== before) pending.push({ file, after });
  }

  console.log(`rewrite: ${report.changed.length} references, ${report.skipped.length} deliberately left alone`);
  for (const path of [...new Set(report.skipped)]) console.log(`  keep    ${path}`);

  if (report.missing.length > 0) {
    console.error(`\nREFUSING TO WRITE. ${report.missing.length} reference(s) name an object that is not verified in image-manifest.json:`);
    for (const path of report.missing) console.error(`  ${path}`);
    console.error('\nRun `npm run migrate:images` until every object reports verified, then run this again.');
    process.exit(1);
  }

  for (const { file, after } of pending) writeFileSync(file, after);
  console.log(`\nwrote ${pending.length} files`);
}
```

- [ ] **Step 3: Dry-run it against a deliberately broken manifest FIRST**

Before letting it write anything, prove the refusal:

```
cp image-manifest.json /tmp/real-manifest.json
node -e "const m=JSON.parse(require('fs').readFileSync('image-manifest.json','utf8'));delete m.objects['food/pizza1.webp'].verifiedAt;require('fs').writeFileSync('image-manifest.json',JSON.stringify(m,null,2))"
node scripts/rewrite-image-refs.mjs; echo "exit=$?"
git status --porcelain src/content src/components src/index.css
cp /tmp/real-manifest.json image-manifest.json
```

`exit=1`, and `git status --porcelain` must print **nothing**. If it wrote anything, the refusal is not a refusal and the whole safety argument of this task is void.

- [ ] **Step 4: Run it for real**

```
node scripts/rewrite-image-refs.mjs
```

Expected: **`rewrite: 77 references, 3 deliberately left alone`** — `/og-image.jpg` from `site.json`, and the two `/menus/*.pdf` from `menus.json`. If the number is not 77, stop: Task 2's inventory said 68 + 9 and a different number here means something changed under the plan.

Then eyeball the diff of the five code files. `src/index.css:196` must read `background-image: url("/images/hero/brick.webp");` and the three spaced mocktail filenames must carry `%20`.

- [ ] **Step 5: Move the offline guardrail in the same commit**

`src/content/__tests__/assets.test.ts` resolves every discovered path against `publicFiles`.

**This step's premise no longer holds — see the amendment at the top of this plan.** It was written for a destination that was a whole `https://` URL: `ASSET_PATH_PATTERN` would stop matching, and **the content half of that walk would silently become vacuous**, the exact failure this repository's own comments describe as a guardrail reducing to nothing. The destination is `/images/<key>` now, which that pattern still matches — so the walk does not go vacuous, it goes **red**, demanding a file under `public/` for every photograph that just moved into R2. The replacement guardrail has to exclude the image prefix from the `publicFiles` resolution and hand it to `npm run verify:images` (which sweeps the live site) instead, and it must not be able to go vacuous either way. The code below is the old shape and is kept only for what it says about the straggler detector.

```ts
import { verifiedKeys } from '../../test/imageManifest';
import { IMAGE_HOST, keyFromImageUrl } from '../../shared/image-host';
import { UPLOAD_CATEGORIES } from '../../shared/upload-categories';

// Photographs are absolute URLs on the image host now (2026-08-21 migration).
// The site-root pattern above still governs everything that did NOT move:
// /og-image.jpg, the two menu PDFs, and the favicons.
const IMAGE_URL_PATTERN = new RegExp(
  '^' + IMAGE_HOST.replace(/[.]/g, '\\.') + '/.+\\.(jpg|jpeg|png|webp|avif|gif)$', 'i',
);
const CATEGORY_PREFIXES = UPLOAD_CATEGORIES.map((category) => '/' + category + '/');
```

Extend `collectAssetPathsFromValue` to also push strings matching `IMAGE_URL_PATTERN`, then split the resolution test:

```ts
  const sitePaths = paths.filter((path) => path.startsWith('/'));
  const hostedPaths = paths.filter((path) => path.startsWith('http'));

  it('still discovers the site-root paths that deliberately did not move', () => {
    expect(sitePaths).toContain('/og-image.jpg');
    expect(sitePaths).toContain('/menus/food-menu.pdf');
    expect(sitePaths).toContain('/favicon-32.png');
  });

  it.each(sitePaths)('%s exists in public/ with exact case', (path) => {
    expect(onDisk.has(decodeURIComponent(path))).toBe(true);
  });

  it('discovers the hosted photographs too', () => {
    expect(hostedPaths.length).toBeGreaterThanOrEqual(70);
  });

  // Not asserted against a live fetch -- that is scripts/verify-image-urls.mjs's
  // job and it runs on every deploy. What is asserted here is the SHAPE, which
  // catches a typo, a wrong host, a /public/ prefix, or a key under a category
  // that does not exist -- offline, in a second, on every push.
  it.each(hostedPaths)('%s is a well-formed key under a real upload category', (path) => {
    const key = keyFromImageUrl(path);
    expect(key).not.toBeNull();
    expect(CATEGORY_PREFIXES.some((prefix) => ('/' + key!).startsWith(prefix))).toBe(true);
  });

  // Every reference this migration actually moved names an object the
  // migration verified. Photographs she uploads AFTER this are not in the
  // manifest -- the Worker cannot commit to it -- so this checks membership OR
  // the content-addressed shape a new upload takes, and the live sweep in
  // verify:deploy covers the ones this cannot see.
  it.each(hostedPaths)('%s is either a migrated object or a content-addressed upload', (path) => {
    const key = keyFromImageUrl(path)!;
    expect(verifiedKeys.has(key) || /^[a-z_]+\/[0-9a-f]{12}\.webp$/.test(key)).toBe(true);
  });

  // THE MISS DETECTOR, and the most important assertion in this task. After the
  // rewrite, NOTHING in this repository may still carry a site-root path under
  // a migrated category directory -- that is exactly what a reference the
  // rewrite skipped looks like. It is kept separate from the resolution tests
  // above because a missed reference RESOLVES: public/ still holds the file, so
  // `onDisk.has(...)` is true and nothing else notices, right up until the
  // separate deletion commit.
  it('nothing still points at a migrated category directory', () => {
    expect(sitePaths.filter((p) => CATEGORY_PREFIXES.some((prefix) => p.startsWith(prefix)))).toEqual([]);
  });

  it('excludes absolute urls that are not the image host', () => {
    expect(paths).not.toContain(site.seo.url);
    expect(paths.every((path) => path.startsWith('/') || path.startsWith(IMAGE_HOST))).toBe(true);
  });

  it('keeps the share card on this origin, where SeoHead resolves it', () => {
    expect(site.seo.ogImage).toBe('/og-image.jpg');
  });
```

The image-like-field test at the bottom of the file must accept both shapes:

```ts
      const isValid =
        entry.value === null ||
        (typeof entry.value === 'string' &&
          (ASSET_PATH_PATTERN.test(entry.value) || IMAGE_URL_PATTERN.test(entry.value)));
```

- [ ] **Step 6: `npx tsc -b --noEmit && npm test -- --run src/content/__tests__/assets.test.ts worker/__tests__/post-seo.test.ts && npm run gate`**

`npm run gate` runs `npm run images`, which rebuilds `public/` from `assets-source/` — unchanged, because this task moved references and not files.

- [ ] **Step 7: Deploy, sweep, and look at it**

Push to `main`, wait for the Pages build, then:

```
npm run verify:images
```

Expected: `69/69 distinct image references resolve` — 68 now on `img.viabiancarestaurant.com` and `/og-image.jpg` still on the apex.

Then **a human opens the live homepage, `/blogs`, and each of the six standalone pages in a real browser and looks at them**, with the network panel open, confirming every image request goes to `img.viabiancarestaurant.com`. **A green sweep is necessary and is not sufficient.** In particular the sweep cannot see `src/index.css`'s `body::before` texture or the hero collage's geometry; those are eyes.

- [ ] **Step 8: Write the rollback down where somebody will find it**

Add to `docs/cloudflare-cutover.md`: this commit's sha, and the sentence *"`git revert <sha>` restores every reference to its site-root path; `public/` still holds every file they name and `npm run images` still rebuilds them from `assets-source/`, so the site returns to serving its own photographs with no other change and no R2 involvement."*

- [ ] **Step 9: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| revert one reference in `dishes.json` to `/food/pizza1.webp` | "nothing still points at a migrated category directory" | — |
| revert `src/index.css:196` to `url("/hero/brick.webp")` | same test — `src/index.css` is inside `assets.test.ts`'s code walk | If it does not redden, the code walk is not covering `.css`. Add it; the homepage's whole-page texture is the single most visible image on the site. |
| change one hosted URL's category from `food` to `foods` | "%s is a well-formed key under a real upload category" for that path | — |
| change one hosted URL's host to `https://img.viabianca.com` | "excludes absolute urls that are not the image host" | — |
| delete the `verifiedAt` guard from `target()` | Step 3's dry run writes files and exits 0 | Procedural, and it is why Step 3 exists. If the dry run passes with a broken manifest, stop and fix the refusal before running the real rewrite. |
| drop `encodeURI` from `target()` | "%s is a well-formed key under a real upload category" **stays green** — an unencoded space is still a well-formed key by that test's rules | Expected. It is caught by `npm run verify:images`, which fetches the URL and gets a 404 for `mocktails/blood orange espresso tonic.webp` sent raw. **Run the sweep, not just the suite, after any change to this function.** |
| change `KEEP` to an empty set so `/og-image.jpg` is rewritten | "keeps the share card on this origin, where SeoHead resolves it" | — |
| revert `absoluteImageUrl` to `` `${siteUrl}${image}` `` | "leaves an absolute image url alone rather than prefixing the site onto it" and "never emits a url with two schemes in it" | — |
| in `rewriteSource`, handle only `"` and `'` quotes, dropping the `(` form | run Step 4 on a fresh checkout: `src/index.css`'s `url(...)` is left behind and the miss detector reddens | — |

**CSS ceiling:** **expected zero, and this task is the one most likely to move it.** `src/index.css`'s changed line is a `url()` value, not a class. Rebuild and compare against 39441 before committing; if it moved, the cause is a comment, not the URL.

**If this task is wrong:** she opens the site and photographs are missing from the menu, the galleries or the press page — and because `public/` still holds every file and `npm run images` still rebuilds it, **every offline test in the repository is green while it is happening.** The recovery is `git revert` of this one commit.

---

## Task 7: Rewrite the two documents that live in D1, through the real publish endpoint

**Four of the 68 are not in any file Task 6 touched.** `story.json` and `posts.json` are in `worker/store.ts`'s `D1_ONLY_PATHS`, so the live copies are D1 rows and the committed files Task 6 rewrote are a **fallback floor**. Rewriting the floor and leaving the rows is the failure mode with the longest fuse in this plan: the site keeps working, every test is green, the repository looks entirely correct, and the chef's portrait and all three blog post images break together on the day `public/<category>/` stops being deployed.

**And it is done through `POST /api/publish`, not through `wrangler d1 execute`.**

**Files:**
- Create: `scripts/rewrite-d1-images.mjs`
- Create: `scripts/__tests__/rewrite-d1-images.test.mjs`
- Modify: `docs/cloudflare-cutover.md`

**Interfaces:**

```js
// scripts/rewrite-d1-images.mjs
export async function currentBodies(origin, fetchImpl);   // live body + sha per document
export function rewriteBody(text, manifest, report);      // same rule as rewriteJson
export function publishRequestFor(documents);             // the exact POST /api/publish body
```

- [ ] **Step 1: Read what is live, not what is committed**

```js
// scripts/rewrite-d1-images.mjs
//
// The four references that exist only as D1 rows.
//
// READS THE LIVE BODIES, from GET /api/content (authenticated, which is what
// carries the `sha` the publish needs) rather than from src/content/*.json.
// Those files are the floor: a post the owner published last month, with a
// photograph she uploaded last month, exists only in the row. Rewriting the
// file and not the row leaves the site serving a reference that will stop
// resolving.
const DOCUMENTS = ['story.json', 'posts.json'];

// awards.json is NOT in that list. Task 2's inventory recorded zero image
// references in it, and this script fetches it again anyway rather than
// skipping on that memory -- if the fetch turns up an image reference, the
// script STOPS and the reference is added to the plan rather than to the run.
const CHECK_ONLY = ['awards.json'];
```

- [ ] **Step 2: Rewrite through the real publish endpoint, and say why**

```js
// POST /api/publish, authenticated with the owner's own session, is the only
// write path this migration uses for D1 content. A direct
// `wrangler d1 execute "UPDATE content SET body=..."` was rejected for three
// reasons, and the second is the one that matters:
//
//   1. It bypasses validateContent, so a malformed body would land with no
//      check at all.
//   2. IT WRITES NO REVISION. worker/d1.ts's write() inserts into `revisions`
//      and stamps a publish_id; a raw UPDATE does not. That would make this
//      the ONE change in the whole migration that cannot be undone from the
//      dashboard -- and it is the change most likely to need it.
//   3. It does not bump `version`, so worker/published.ts's cache key would
//      not change and the edge would keep serving the old body until the entry
//      expired on time.
//
// The request is assembled here and POSTed by a human with a live session
// cookie, because an agent has no credentials and should not be given any.
export function publishRequestFor(documents) {
  return {
    message: 'Point the photographs at the image host',
    files: documents.map((document) => ({
      path: `src/content/${document.name}`,
      content: document.body,
      encoding: 'utf-8',
      // baseSha is carried deliberately: handlePublish's step 3 compares it
      // against what the store currently holds and answers 409 if anything
      // moved between the read and the write. A rewrite of live content is
      // exactly where that guard earns its keep.
      baseSha: document.sha,
    })),
  };
}
```

- [ ] **Step 3: A human runs it**

```
node scripts/rewrite-d1-images.mjs --origin https://viabiancarestaurant.com --session "$VB_SESSION" > /tmp/vb-d1-publish.json
node -e "const b=require('/tmp/vb-d1-publish.json');console.log(b.files.map(f=>f.path));console.log(JSON.stringify(b).match(/img\.viabiancarestaurant\.com/g).length,'hosted references')"
```

Expect `4 hosted references`. **Review `/tmp/vb-d1-publish.json` — it is the exact request body** — then:

```
curl -sS -X POST https://viabiancarestaurant.com/api/publish \
  -H 'Content-Type: application/json' -b "vb_session=$VB_SESSION" \
  --data @/tmp/vb-d1-publish.json | jq .
```

Expect `{"sha": null, "publishId": "…", …}`. **`sha: null` is the proof that no commit happened** — both documents are D1-only, so `partitionByStore` put both in the D1 leg and `commitFiles` was never called. That is also the shape every content publish takes after Tier 4.

- [ ] **Step 4: Confirm the live read actually changed**

```
curl -sS 'https://viabiancarestaurant.com/api/published?path=posts.json' | grep -o 'img.viabiancarestaurant.com[^"]*'
curl -sS 'https://viabiancarestaurant.com/api/published?path=story.json' | grep -o 'img.viabiancarestaurant.com[^"]*'
```

Expect three URLs and one. Then load `/blogs` and `/` in a browser and confirm three post cards and the chef portrait show photographs.

- [ ] **Step 5: Confirm the server-rendered head, which is the SEO half and the D4 fix on the wire**

```
curl -sS https://viabiancarestaurant.com/blog/bw-hotelier-regional-flair | grep -o '<meta property="og:image"[^>]*>'
```

Expect `content="https://img.viabiancarestaurant.com/press/hotelier.webp"` — **one host, not two concatenated.** This is where Task 6 Step 1's fix is proven against a real response rather than against a unit test.

- [ ] **Step 6: The unit test, which observes the fetch**

```js
// scripts/__tests__/rewrite-d1-images.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { currentBodies, rewriteBody, publishRequestFor } from '../rewrite-d1-images.mjs';

const manifest = { objects: { 'press/hotelier.webp': { verifiedAt: '2026-08-21T00:00:00.000Z' } } };

describe('rewriting the documents that live in D1', () => {
  // The whole point of the task, asserted by observing the effect rather than
  // the result: a version that read src/content/posts.json would produce a
  // correct-looking body and never call this.
  it('reads the live body, not the committed one', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200,
      headers: new Headers({ 'x-content-source': 'd1' }),
      json: async () => ({ content: '[]', sha: 'abc' }),
    }));
    await currentBodies('https://x', fetchImpl, 'session');
    expect(fetchImpl).toHaveBeenCalled();
    expect(fetchImpl.mock.calls.every(([url]) => String(url).includes('/api/content'))).toBe(true);
  });

  it('refuses rather than continuing when a live read fails', async () => {
    await expect(currentBodies('https://x', async () => ({ ok: false, status: 401, headers: new Headers() }), 's'))
      .rejects.toThrow();
  });

  it('rewrites a verified reference and leaves an unverified one alone, reporting it', () => {
    const report = { changed: [], skipped: [], missing: [] };
    const out = rewriteBody(JSON.stringify([{ image: '/press/hotelier.webp' }, { image: '/press/gone.webp' }]), manifest, report);
    expect(out).toContain('https://img.viabiancarestaurant.com/press/hotelier.webp');
    expect(out).toContain('/press/gone.webp');
    expect(report.missing).toEqual(['/press/gone.webp']);
  });

  it('carries a baseSha so a concurrent publish is refused rather than absorbed', () => {
    const body = publishRequestFor([{ name: 'posts.json', body: '[]', sha: 'abc' }]);
    expect(body.files[0].baseSha).toBe('abc');
    expect(body.files[0].path).toBe('src/content/posts.json');
  });
});
```

- [ ] **Step 7: `npx eslint scripts/rewrite-d1-images.mjs && npm test -- --run scripts/__tests__/rewrite-d1-images.test.mjs && npm run verify:images && npm run verify:deploy`**

`verify:images` now sweeps `69` committed references and, because there is still no island, does **not** see the four D1 ones. That gap closes at Task 12 and is the reason the sweep is a union rather than a choice. Until then, Step 4's two `curl` lines are the check.

- [ ] **Step 8: Write the undo down.** Record the `publishId` from Step 3 in `docs/cloudflare-cutover.md`, with the sentence *"pressing Undo in the dashboard on this publish restores both documents to their site-root paths, which `public/` still serves."*

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| in `currentBodies`, read `src/content/posts.json` from disk instead of fetching | "reads the live body, not the committed one" | If nothing reddens, the test is not observing the fetch and the whole point of this task is unverified. |
| drop `baseSha` from `publishRequestFor` | "carries a baseSha so a concurrent publish is refused rather than absorbed" | — |
| make `rewriteBody` rewrite an unverified reference anyway | "rewrites a verified reference and leaves an unverified one alone, reporting it" | — |
| replace the `POST /api/publish` call with `wrangler d1 execute` | nothing automated | Procedural, and the check is `SELECT COUNT(*) FROM revisions WHERE publish_id = '<the id>'` returning 2. If it returns 0, the change is unrecoverable from the dashboard and this task must be redone through the endpoint. |
| swallow a non-ok response in `currentBodies` | "refuses rather than continuing when a live read fails" | — |

**CSS ceiling:** zero bytes. `scripts/` and `docs/` are outside the content glob.

**If this task is wrong:** the committed files say one thing and the site serves another. The photographs stay correct until the separate deletion commit, and then the chef's portrait and every blog post's image break together — with the repository looking, to anyone reading it, entirely correct.

---

# Tier 2 — The whole content read path, built while every document is still in git

The five tasks in this tier build the floor, the edge cache, the D1 read, the injected island and the crawler-readable menu — **and change where not one byte of content is stored.** Task 12 deploys them to production. If the render is wrong, it is wrong about content that is still in the repository and still in the compiled bundle, so the fallback is the thing that was already shipping.

## Task 8: One floor for every document, and the export that refreshes it

The spec's third layer: *"The compiled-in JSON, as a floor. It stays in the repository and is updated only when code deploys anyway. It exists so that D1 being unreachable degrades the site to slightly stale rather than blank."* Today `worker/snapshot.ts` holds three documents. This widens it to twelve and builds the script that regenerates it, so the D1-unreachable answer exists before anything can be unreachable.

**Files:**
- Create: `scripts/export-content.mjs`
- Modify: `worker/snapshot.ts` (regenerated: 12 entries)
- Modify: `worker/__tests__/snapshot.test.ts`
- Modify: `package.json` (add `export:content`)

**Interfaces:**

```ts
// worker/snapshot.ts -- unchanged signatures, widened contents
export const SNAPSHOT_BUILT_AT: string;
export function snapshotFor(file: string): string | null;
export function snapshotVersionFor(file: string): number | null;
```

```js
// scripts/export-content.mjs
export function renderSnapshotModule(entries, builtAt);   // the exact text of worker/snapshot.ts
```

- [ ] **Step 1: The export**

```js
// scripts/export-content.mjs
//
// D1 -> the repository. Two outputs, one source of truth.
//
//   src/content/*.json   the documents themselves, so the content survives
//                        losing D1 entirely. This is the spec's answer to D1
//                        Time Travel being SEVEN days on the free plan: a
//                        mistake discovered on day eight is otherwise
//                        unrecoverable. Committed weekly by
//                        .github/workflows/content-export.yml (Task 22).
//
//   worker/snapshot.ts   the Worker's compiled floor. Reaches production only
//                        on the next `npx wrangler deploy`, which is
//                        deliberate and is the spec's own rule -- the floor is
//                        "updated only when code deploys anyway".
//
// THIS IS NOT THE PER-PUBLISH COMMIT THIS MIGRATION EXISTS TO REMOVE. It is
// one commit a week whose only job is that the content is recoverable from
// git. Nothing about it is on a request path and nothing waits for it.
//
// Runs OUTSIDE the Worker, in GitHub Actions or by hand, and that is a
// decision rather than a convenience: worker/github.ts's path allowlist is, in
// its own words, the only thing standing between a publish request and the
// rest of this repository, and a Worker-side export would need it widened to
// write into worker/. Actions can write any path and needs no widening. By
// Task 21 the Worker has no GitHub token at all, which settles it permanently.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DB = 'via-bianca-content';

function query(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', `--command=${sql}`], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // wrangler --json returns an array of result envelopes, one per statement.
  return JSON.parse(out)[0].results;
}

// The exact text of worker/snapshot.ts. Kept as a function so its output can be
// asserted by a test without the test running wrangler.
export function renderSnapshotModule(entries, builtAt) {
  const body = entries
    .map(({ file, body: text, version }) =>
      `  ${JSON.stringify(file)}: {\n    "body": ${JSON.stringify(text)},\n    "version": ${version}\n  }`)
    .join(',\n');
  return `// GENERATED by scripts/export-content.mjs from the live D1 database. Do not
// edit by hand -- regenerate with \`node scripts/export-content.mjs\` before a
// deploy that matters.
//
// THIS IS A FALLBACK, NOT THE LIVE CONTENT. The live content is the \`content\`
// table in the Cloudflare D1 database named via-bianca-content. What is in this
// file is whatever that table held the last time somebody ran the export, and
// it can be weeks old. It is served only when D1 cannot be reached, so a
// database outage costs freshness and never costs availability.
//
// IT IS NOT WHAT THE BROWSER RENDERS FOR A DOCUMENT STILL BACKED BY GITHUB.
// worker/content-bundle.ts's island rule (the plan's decision D0) omits any
// path that is not in D1_ONLY_PATHS, precisely so that this frozen copy can
// never overwrite a freshly-built compiled bundle in a visitor's browser.
//
// Each entry carries the \`version\` D1 held for that path at generation time --
// the same monotonic counter worker/d1.ts bumps on every write. D1Store.write
// computes (prior?.version ?? 0) + 1 and can never write a 0, so \`version: 0\`
// means "taken from the repository, not from a row" and can never be mistaken
// for a live one.
export const SNAPSHOT_BUILT_AT = ${JSON.stringify(builtAt)};

interface SnapshotEntry {
  body: string;
  version: number;
}

const SNAPSHOT: Record<string, SnapshotEntry> = {
${body}
};

export function snapshotFor(file: string): string | null {
  return Object.prototype.hasOwnProperty.call(SNAPSHOT, file) ? SNAPSHOT[file].body : null;
}

export function snapshotVersionFor(file: string): number | null {
  return Object.prototype.hasOwnProperty.call(SNAPSHOT, file) ? SNAPSHOT[file].version : null;
}
`;
}

if (import.meta.filename === process.argv[1]) {
  const rows = query('SELECT path, body, version FROM content ORDER BY path');
  const fromD1 = new Map(rows.map((row) => [row.path.replace(/^src\/content\//, ''), row]));

  // Every document the read path can be asked for, whichever store holds it
  // today. A document with no D1 row contributes its committed bytes at
  // version 0 -- which is correct AND load-bearing: the read path treats a
  // floor entry as the answer only when D1 has no row, and 0 is a version no
  // write can produce.
  const files = ['site.json', 'galleries.json', 'dishes.json', 'drinks.json', 'story.json', 'menus.json',
    'copy.json', 'sections.json', 'pages.json', 'experiences.json', 'posts.json'];
  const entries = files.map((file) => {
    const row = fromD1.get(file);
    return row
      ? { file, body: row.body, version: row.version }
      : { file, body: readFileSync(join('src', 'content', file), 'utf-8'), version: 0 };
  });

  // awards.json has never been a file in this repository and is not written
  // back as one. Its floor comes from D1 or it does not exist.
  const awards = fromD1.get('awards.json');
  if (!awards) throw new Error('awards.json has no D1 row and no file: the floor cannot be built without it');
  entries.push({ file: 'awards.json', body: awards.body, version: awards.version });

  for (const { file, body, version } of entries) {
    if (file === 'awards.json' || version === 0) continue;   // only D1-backed documents are written back
    writeFileSync(join('src', 'content', file), body.endsWith('\n') ? body : body + '\n');
  }

  entries.sort((a, b) => (a.file < b.file ? -1 : 1));
  writeFileSync(join('worker', 'snapshot.ts'), renderSnapshotModule(entries, new Date().toISOString()));
  console.log(`floor: ${entries.length} documents (${entries.filter((e) => e.version > 0).length} from D1, ${entries.filter((e) => e.version === 0).length} from the repository)`);
}
```

- [ ] **Step 2: Run it once, now, while nine documents are still in git**

```
node scripts/export-content.mjs
```

Expected: `floor: 12 documents (3 from D1, 9 from the repository)`. Three rows exist today (awards, story, posts) and the other nine come from the committed files at `version: 0`. `git diff src/content` must show **only `story.json` and `posts.json`** changing — and only if they had drifted from their D1 rows, which after Task 7 they should not have.

- [ ] **Step 3: Widen the snapshot test**

```ts
// worker/__tests__/snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotFor, snapshotVersionFor, SNAPSHOT_BUILT_AT } from '../snapshot';

const CONTENT_DIR = join(process.cwd(), 'src', 'content');
// press.json is excluded: it is compiled into the site bundle, is not
// dashboard-editable, and is deliberately not part of the read path.
const files = readdirSync(CONTENT_DIR).filter((n) => n.endsWith('.json') && n !== 'press.json');

describe('the compiled floor covers every document the read path can be asked for', () => {
  it('discovers the content files to check', () => {
    expect(files.length).toBe(11);
  });

  it.each(files)('%s has a floor entry', (file) => {
    expect(snapshotFor(file)).not.toBeNull();
  });

  it('covers awards.json, which is not a file in this repository', () => {
    expect(snapshotFor('awards.json')).not.toBeNull();
  });

  it.each(files)('%s parses as JSON', (file) => {
    expect(() => JSON.parse(snapshotFor(file)!)).not.toThrow();
  });

  // The parity claim for documents still backed by git. Once a document moves
  // to D1 the export writes BOTH sides from the same row, so this stays true
  // either way and goes red exactly when somebody edits a committed file
  // without refreshing the floor beside it.
  it.each(files)('%s floor equals the committed file', (file) => {
    expect(snapshotFor(file)).toBe(readFileSync(join(CONTENT_DIR, file), 'utf-8'));
  });

  // Task 6 rewrote every photograph reference to the image host. A floor still
  // carrying a site-root category path is a floor full of paths that stop
  // resolving the day public/<category>/ leaves the build -- which would make a
  // D1 outage stale AND blank rather than merely stale.
  it.each(files)('%s carries no site-relative photograph path', (file) => {
    const body = snapshotFor(file)!;
    const stragglers = [...body.matchAll(/"(\/(?:food|hero|atmosphere|our_story|mocktails|press|experiences|team)\/[^"]+)"/g)];
    expect(stragglers.map((m) => m[1])).toEqual([]);
  });

  it('records a real build timestamp, not a placeholder', () => {
    expect(SNAPSHOT_BUILT_AT).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(SNAPSHOT_BUILT_AT))).toBe(false);
  });

  it('was rebuilt after the image rewrite, not before it', () => {
    expect(Date.parse(SNAPSHOT_BUILT_AT)).toBeGreaterThan(Date.parse('2026-08-20'));
  });

  it('returns null for a document nobody asked for', () => {
    expect(snapshotFor('wrangler.toml')).toBeNull();
    expect(snapshotVersionFor('wrangler.toml')).toBeNull();
  });

  // Version 0 is the marker for "this entry came from the repository, not from
  // a row". D1Store.write computes (prior?.version ?? 0) + 1, so it can never
  // write a 0 -- which is what stops a floor entry ever being mistaken for a
  // live one.
  it('gives every entry a version, and never a negative one', () => {
    for (const file of [...files, 'awards.json']) {
      expect(snapshotVersionFor(file), file).not.toBeNull();
      expect(snapshotVersionFor(file)!, file).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 4: `package.json` gains one script**

```json
    "export:content": "node scripts/export-content.mjs",
```

- [ ] **Step 5: Check the Worker bundle can still carry it**

```
node_modules/.bin/esbuild worker/index.ts --bundle --platform=neutral --format=esm --outfile=/tmp/vb-worker.js && wc -c /tmp/vb-worker.js
```

The twelve documents total roughly 36 KB of JSON before escaping; Workers Free allows 3 MB gzipped. Record the measured number in the commit message. If it is anywhere near 1 MB, something other than the floor is wrong.

- [ ] **Step 6: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/snapshot.test.ts worker/__tests__/bundle.test.ts && npm run gate`**

`bundle.test.ts` is in that list on purpose: the floor is a generated `.ts` file inside `worker/`, and if a future edit ever made it import from `src/content/index.ts` rather than inlining strings, React would arrive in the Worker bundle. Confirming it stays green here is confirming the generator produced string literals.

- [ ] **Step 7: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| delete one entry from `SNAPSHOT` | "%s has a floor entry" for that file | — |
| change one character inside one entry's `body` | "%s floor equals the committed file" for that file | — |
| truncate one entry's `body` mid-object | "%s parses as JSON" and the equality test | — |
| set `SNAPSHOT_BUILT_AT` to `'TBD'` | "records a real build timestamp, not a placeholder" | — |
| restore the pre-Task-6 snapshot (site-root photograph paths) | "%s carries no site-relative photograph path" and "was rebuilt after the image rewrite" | — |
| delete the `awards.json` entry | "covers awards.json, which is not a file in this repository" | — |
| make `snapshotFor` return `SNAPSHOT[file]?.body ?? ''` | "returns null for a document nobody asked for" | — |
| have the export write a committed file back for a `version: 0` entry | `git diff src/content` after Step 2 shows files rewritten with different whitespace | Procedural. A `version: 0` document is one D1 does not hold; writing it back is a no-op at best and a re-serialisation at worst, and `worker/migrations/0001_content.sql`'s own comment says the body must never be re-serialised because `sha` is a hash of the exact text. |
| replace `Object.prototype.hasOwnProperty.call` with `file in SNAPSHOT` | **nothing reddens** — the two agree for every key this object literal has | Expected and harmless; the guarded form is kept because a key named `toString` would differ. Not worth a test, and it is recorded here so nobody adds one that cannot fail. |

**CSS ceiling:** zero bytes. `worker/` and `scripts/` are outside the content glob.

**If this task is wrong:** the first time D1 is unreachable after Tier 4, the pages whose documents have no floor entry render empty — the exact blank-page outcome the three-layer design exists to prevent.

---

## Task 9: `worker/content-bundle.ts` — one D1 read, one cache entry, one floor, and the island rule

The middle layer, and the one carrying **decision D0**, which is the correction this plan exists to make against the obvious design.

**The bug this task does not ship.** A Worker that injects an island of *all* documents, and a browser that prefers the island over its compiled bundle, is correct only if the island is at least as fresh as the bundle. It is not. `worker/snapshot.ts` reaches production **only on `npx wrangler deploy`**; a push to `main` deploys Pages only. So for a document still backed by GitHub: she publishes → a commit lands → Pages rebuilds a bundle carrying her new text → **the Worker overwrites it with a floor frozen at the last Worker deploy** → her publish is invisible until a human redeploys the Worker. That is the exact symptom the spec singles out (*"it would look to her like the publish silently failed"*), it would span five tasks, and it would end on `dishes.json`.

**The condition, in one place:** the island carries a document if and only if **its path is in `D1_ONLY_PATHS`** and **a D1 row actually answered for it.** The crawl block requires only the first, because a non-JS crawler has no compiled bundle for the Worker to lose to.

**Files:**
- Create: `worker/content-bundle.ts`
- Create: `worker/__tests__/content-bundle.test.ts`
- Modify: `worker/__tests__/fakeD1.ts` (branches for the two new statements)

**Interfaces:**

```ts
// worker/content-bundle.ts
export const BUNDLE_PATHS: readonly string[];          // 12 repository paths
export const BUNDLE_CACHE_VERSION: string;             // 'v1'
export interface BundleRead {
  documents: Record<string, string>;   // every document, D1 row where there is one, floor otherwise
  fromD1: ReadonlySet<string>;         // the file names a D1 row actually answered for
  stamp: string;
  source: 'd1' | 'floor' | 'mixed';
}
export function bundleCacheKey(request: Request, stamp: string, part: 'island' | 'crawl'): Request;
export async function readVersions(db: D1Database): Promise<Map<string, number> | null>;
export function stampFrom(versions: Map<string, number> | null): string;
export async function readBundle(db: D1Database, versions: Map<string, number> | null): Promise<BundleRead>;
export function islandDocuments(read: BundleRead): Record<string, string>;
export function crawlDocuments(read: BundleRead): Record<string, string>;
export function sourceHeaderValue(read: BundleRead): string;
```

- [ ] **Step 1: The module**

```ts
// worker/content-bundle.ts
//
// Every content document the site renders, read once per request, with the
// three layers the spec names: an edge cache the caller owns, D1, and the
// compiled floor.
//
// WHAT THIS COSTS D1, exactly, because the free tier RETURNS ERRORS at its
// limits rather than throttling and the whole plan rests on the number:
//
//   cache hit   1 statement, 12 rows read  (readVersions alone)
//   cache miss  2 statements, 24 rows read (readVersions + readBundle)
//
// D1 Free allows 5,000,000 row reads a day. At 12 rows a hit that is 416,000
// page views a day before anything is at risk, against a restaurant serving a
// few hundred. Crawlers are inside that budget by two orders of magnitude.
//
// WHY THE VERSION READ IS NOT ITSELF CACHED. It could be, with a short TTL,
// and D1 would then be untouched on most requests. It is not, because the
// stamp is the ONLY invalidation mechanism this design has: a publish bumps a
// version, the stamp changes, the old cache key is never asked for again, and
// there is no purge call anywhere. Putting a TTL in front of the stamp would
// make a publish invisible for that TTL -- which she would read as the publish
// having silently failed, which is precisely the failure the spec singles out.
//
// WHY ONE STATEMENT FOR TWELVE DOCUMENTS RATHER THAN TWELVE. Twelve separate
// reads would be twelve round trips inside one request, and D1 bills per row
// either way. The IN-list is built from BUNDLE_PATHS, a constant in this file,
// so no request input reaches the SQL.
import { snapshotFor, snapshotVersionFor, SNAPSHOT_BUILT_AT } from './snapshot';
import { D1_ONLY_PATHS } from './store';

// Repository paths, because that is what the `content` table is keyed on.
// Ordered, because the stamp is built from this order and a reordering would
// change every cache key for no reason.
export const BUNDLE_PATHS: readonly string[] = [
  'src/content/awards.json',
  'src/content/copy.json',
  'src/content/dishes.json',
  'src/content/drinks.json',
  'src/content/experiences.json',
  'src/content/galleries.json',
  'src/content/menus.json',
  'src/content/pages.json',
  'src/content/posts.json',
  'src/content/sections.json',
  'src/content/site.json',
  'src/content/story.json',
];

// press.json is deliberately absent. It is compiled into the site bundle and
// is part of ContentBundle, but it is not in src/admin/content.ts's
// CONTENT_FILES -- she cannot edit it from the dashboard, so moving its storage
// would remove no commit and no deploy. It is read from the compiled bundle,
// forever, by src/content/index.ts's own static import.

// Bumped by any change to the SHAPE of what gets cached under a stamp -- the
// island's JSON layout, or the crawl markup. A stale v1 body reaching a reader
// that expects a new shape is an owner-visible outage for the length of the
// cache's life, for no reason.
export const BUNDLE_CACHE_VERSION = 'v1';

export interface BundleRead {
  documents: Record<string, string>;
  fromD1: ReadonlySet<string>;
  stamp: string;
  source: 'd1' | 'floor' | 'mixed';
}

function fileOf(path: string): string {
  return path.slice('src/content/'.length);
}

// Built on the request's own origin, the same self-configuring posture
// worker/published.ts's publicCacheKey takes: buying a domain must not quietly
// split the cache in half.
export function bundleCacheKey(request: Request, stamp: string, part: 'island' | 'crawl'): Request {
  const url = new URL(request.url);
  url.pathname = '/__cache/bundle';
  url.search = `?part=${part}&s=${encodeURIComponent(stamp)}`;
  return new Request(url.toString(), { method: 'GET' });
}

// Twelve versions, one statement, no bodies. Returns null on ANY database
// problem, which the callers read as "fall to the floor" -- a database problem
// must cost freshness, never availability.
export async function readVersions(db: D1Database): Promise<Map<string, number> | null> {
  try {
    const placeholders = BUNDLE_PATHS.map(() => '?').join(',');
    const { results } = await db
      .prepare(`SELECT path, version FROM content WHERE path IN (${placeholders})`)
      .bind(...BUNDLE_PATHS)
      .all<{ path: string; version: number }>();
    return new Map(results.map((row) => [row.path, row.version]));
  } catch {
    return null;
  }
}

// The cache key's version component. Every document contributes, in
// BUNDLE_PATHS order, so a publish to any one of them changes it.
//
// A document with NO row contributes `0`, the same 0 the floor carries --
// deliberately, because a document with no row IS answered from the floor, so
// the two states are genuinely identical and must produce the same key.
export function stampFrom(versions: Map<string, number> | null): string {
  if (versions === null) return `${BUNDLE_CACHE_VERSION}:floor:${SNAPSHOT_BUILT_AT}`;
  return BUNDLE_CACHE_VERSION + ':' +
    BUNDLE_PATHS.map((path) => `${fileOf(path).replace('.json', '')}@${versions.get(path) ?? 0}`).join(';');
}

// The bodies. Called only on a cache miss.
export async function readBundle(
  db: D1Database,
  versions: Map<string, number> | null,
): Promise<BundleRead> {
  const documents: Record<string, string> = {};
  const fromD1 = new Set<string>();

  if (versions !== null && versions.size > 0) {
    try {
      const present = BUNDLE_PATHS.filter((path) => versions.has(path));
      const placeholders = present.map(() => '?').join(',');
      const { results } = await db
        .prepare(`SELECT path, body FROM content WHERE path IN (${placeholders})`)
        .bind(...present)
        .all<{ path: string; body: string }>();
      for (const row of results) {
        documents[fileOf(row.path)] = row.body;
        fromD1.add(fileOf(row.path));
      }
    } catch {
      // Deliberately swallowed, and this is the only catch in this module that
      // discards a partial result: a body read that failed halfway would leave
      // `documents` holding some rows and not others, and a page rendered from
      // half a bundle is worse than one rendered wholly from the floor,
      // because nothing about it looks wrong.
      for (const key of Object.keys(documents)) delete documents[key];
      fromD1.clear();
    }
  }

  for (const path of BUNDLE_PATHS) {
    const file = fileOf(path);
    if (documents[file] !== undefined) continue;
    const floor = snapshotFor(file);
    // A document with neither a row nor a floor entry is a programming error --
    // BUNDLE_PATHS and the floor are checked against each other by
    // worker/__tests__/snapshot.test.ts -- and is left ABSENT rather than
    // filled with an empty object, so a reader's own guard rejects it loudly
    // instead of rendering a page with a section silently missing.
    if (floor !== null) documents[file] = floor;
  }

  const speaksFor = BUNDLE_PATHS.filter((path) => D1_ONLY_PATHS.has(path));
  const live = speaksFor.filter((path) => fromD1.has(fileOf(path))).length;
  return {
    documents,
    fromD1,
    stamp: stampFrom(versions),
    source: live === 0 ? 'floor' : live === speaksFor.length ? 'd1' : 'mixed',
  };
}

// DECISION D0 -- THE ISLAND RULE, AND THE MOST IMPORTANT FUNCTION IN THIS FILE.
//
// The browser prefers this island over its compiled bundle (src/content/live.ts).
// That is only safe when the island is at least as fresh as the bundle, and for
// a document still backed by GitHub it is NOT:
//
//   she publishes -> POST /api/publish writes a commit -> Pages rebuilds a
//   bundle carrying her new text -> and worker/snapshot.ts, which reaches
//   production ONLY on `npx wrangler deploy`, still holds the old text.
//
// An island carrying that floor would overwrite her freshly-built bundle and
// her publish would be invisible on the live site until a human redeployed the
// Worker. So:
//
//   (a) the path must be in D1_ONLY_PATHS -- the Worker only ever speaks for a
//       document whose live copy IS the D1 row; and
//   (b) a D1 row must actually have answered. With D1 unreachable a D1-backed
//       document falls out of the island too, and the browser renders its
//       compiled copy -- which the weekly export keeps current and which can
//       only ever be FRESHER than the Worker's floor, never staler.
//
// The consequence, stated rather than buried: until Task 17, publishing a
// GitHub-backed document still takes a Pages build, exactly as it does today.
// Nothing regresses; the improvement arrives per document, at the task that
// moves it.
export function islandDocuments(read: BundleRead): Record<string, string> {
  const island: Record<string, string> = {};
  for (const path of BUNDLE_PATHS) {
    if (!D1_ONLY_PATHS.has(path)) continue;
    const file = fileOf(path);
    if (!read.fromD1.has(file)) continue;
    island[file] = read.documents[file];
  }
  return island;
}

// The crawl block's input. Condition (a) only, NOT (b): a crawler that runs no
// JavaScript has no compiled bundle, so for a D1-backed document whose read
// failed there is no fresher alternative for the Worker to lose to, and the
// floor is the best available answer rather than a stale one. For a
// GitHub-backed document the Worker still says nothing at all, because Pages IS
// the authority and this Worker has no business speaking for it.
export function crawlDocuments(read: BundleRead): Record<string, string> {
  const crawl: Record<string, string> = {};
  for (const path of BUNDLE_PATHS) {
    if (!D1_ONLY_PATHS.has(path)) continue;
    const file = fileOf(path);
    if (read.documents[file] !== undefined) crawl[file] = read.documents[file];
  }
  return crawl;
}

// Exported for the read path's diagnostics header, so a human can ask a live
// page which layer answered it without reading a log.
export function sourceHeaderValue(read: BundleRead): string {
  const speaksFor = BUNDLE_PATHS.filter((path) => D1_ONLY_PATHS.has(path)).length;
  return `${read.source}; d1=${read.fromD1.size}/${speaksFor}; floor=${SNAPSHOT_BUILT_AT}`;
}

// Referenced so `noUnusedLocals` keeps snapshotVersionFor honest: the floor's
// recorded version is what a later drift check compares against a live one.
export function floorVersionFor(file: string): number | null {
  return snapshotVersionFor(file);
}
```

- [ ] **Step 2: Teach `FakeD1` the two new statements**

`worker/__tests__/fakeD1.ts` matches SQL by `startsWith` against the exact prefixes the real code issues and throws on anything unrecognised. Add two branches:

```ts
    // worker/content-bundle.ts's readVersions -- twelve paths, one statement.
    // Matched on the full prefix rather than on 'SELECT path' alone so it
    // cannot also swallow readBundle's own statement below.
    if (sql.startsWith('SELECT path, version FROM content WHERE path IN')) {
      const results = this.bindings
        .map((path) => this.content.get(String(path)))
        .filter((row): row is ContentRow => row !== undefined)
        .map((row) => ({ path: row.path, version: row.version }));
      return { results, success: true, meta: {} };
    }

    if (sql.startsWith('SELECT path, body FROM content WHERE path IN')) {
      const results = this.bindings
        .map((path) => this.content.get(String(path)))
        .filter((row): row is ContentRow => row !== undefined)
        .map((row) => ({ path: row.path, body: row.body }));
      return { results, success: true, meta: {} };
    }
```

- [ ] **Step 3: The test, with the island rule asserted from both sides**

```ts
// worker/__tests__/content-bundle.test.ts
import { describe, it, expect } from 'vitest';
import { FakeD1, asD1 } from './fakeD1';
import {
  BUNDLE_PATHS, BUNDLE_CACHE_VERSION, bundleCacheKey, readVersions, stampFrom,
  readBundle, islandDocuments, crawlDocuments, sourceHeaderValue,
} from '../content-bundle';
import { D1_ONLY_PATHS } from '../store';
import { snapshotFor } from '../snapshot';

function seed(fake: FakeD1, path: string, body: string, version: number) {
  fake.content.set(path, { path, body, sha: 'sha-' + version, version, updated_at: 0 });
}

async function read(fake: FakeD1) {
  return readBundle(asD1(fake), await readVersions(asD1(fake)));
}

describe('the content read path', () => {
  it('names every document the site renders, and not press.json', () => {
    expect(BUNDLE_PATHS).toContain('src/content/dishes.json');
    expect(BUNDLE_PATHS).toContain('src/content/awards.json');
    expect(BUNDLE_PATHS).not.toContain('src/content/press.json');
    expect(BUNDLE_PATHS).toHaveLength(12);
  });

  // A path the dashboard writes to but the read path never reads is a publish
  // that lands somewhere no page looks.
  it('reads every path the store routes to D1', () => {
    for (const path of D1_ONLY_PATHS) expect(BUNDLE_PATHS).toContain(path);
  });

  it('reads every version in ONE statement', async () => {
    const fake = new FakeD1();
    seed(fake, 'src/content/dishes.json', '[]', 4);
    await readVersions(asD1(fake));
    expect(fake.statements.filter((s) => s.includes('FROM content')).length).toBe(1);
  });

  it('answers null, not a throw, when the database is unreachable', async () => {
    const fake = new FakeD1();
    fake.failWith = 'D1_ERROR: network';
    fake.failAfter = 0;
    expect(await readVersions(asD1(fake))).toBeNull();
  });

  it('builds a stamp that changes when any one document is published', () => {
    expect(stampFrom(new Map([['src/content/dishes.json', 4]])))
      .not.toBe(stampFrom(new Map([['src/content/dishes.json', 5]])));
    expect(stampFrom(new Map())).toContain(BUNDLE_CACHE_VERSION);
  });

  it('gives a document with no row the same stamp component the floor has', () => {
    expect(stampFrom(new Map())).toBe(stampFrom(new Map([['src/content/nope.json', 9]])));
  });

  it('marks a total database failure with its own stamp so the floor is cached separately', () => {
    expect(stampFrom(null)).toContain('floor');
    expect(stampFrom(null)).not.toBe(stampFrom(new Map()));
  });

  it('puts the stamp and the part in the cache key, on the request origin', () => {
    const key = bundleCacheKey(new Request('https://viabiancarestaurant.com/catering'), 'v1:x@1', 'island');
    expect(key.url).toContain('https://viabiancarestaurant.com/__cache/bundle');
    expect(key.url).toContain('part=island');
    expect(key.url).toContain(encodeURIComponent('v1:x@1'));
  });

  it('keeps the island and the crawl markup under different keys', () => {
    const request = new Request('https://viabiancarestaurant.com/');
    expect(bundleCacheKey(request, 's', 'island').url).not.toBe(bundleCacheKey(request, 's', 'crawl').url);
  });

  it('serves a document from D1 when a row exists', async () => {
    const fake = new FakeD1();
    seed(fake, 'src/content/story.json', '{"heading":"live"}', 4);
    expect((await read(fake)).documents['story.json']).toBe('{"heading":"live"}');
  });

  it('serves a document with no row from the floor, byte for byte', async () => {
    const fake = new FakeD1();
    expect((await read(fake)).documents['dishes.json']).toBe(snapshotFor('dishes.json'));
  });

  it('serves the floor for every document when the database is unreachable', async () => {
    const fake = new FakeD1();
    fake.failWith = 'D1_ERROR: gone';
    fake.failAfter = 0;
    const bundle = await read(fake);
    expect(bundle.source).toBe('floor');
    for (const path of BUNDLE_PATHS) {
      const file = path.slice('src/content/'.length);
      expect(bundle.documents[file]).toBe(snapshotFor(file));
    }
  });

  it('discards a partial body read entirely rather than serving half a bundle', async () => {
    const fake = new FakeD1();
    seed(fake, 'src/content/story.json', '{"heading":"live"}', 4);
    seed(fake, 'src/content/posts.json', '[]', 2);
    const versions = await readVersions(asD1(fake));
    fake.failWith = 'D1_ERROR: mid-read';
    fake.failAfter = 0;
    const bundle = await readBundle(asD1(fake), versions);
    expect(bundle.source).toBe('floor');
    expect(bundle.fromD1.size).toBe(0);
    expect(bundle.documents['story.json']).toBe(snapshotFor('story.json'));
  });
});

// ---------------------------------------------------------------------------
// DECISION D0. The single most consequential behaviour in this file: a
// GitHub-backed document must NOT appear in the island, because the island
// overrides a compiled bundle that Pages has just rebuilt from her publish.
// ---------------------------------------------------------------------------
describe('the island rule', () => {
  it('omits a document the store does not route to D1, even when a row exists', async () => {
    const fake = new FakeD1();
    // A row for a path that is NOT in D1_ONLY_PATHS -- exactly the state
    // between Task 14's seed and its flip.
    const notYet = BUNDLE_PATHS.find((p) => !D1_ONLY_PATHS.has(p));
    expect(notYet).toBeDefined();
    seed(fake, notYet!, '{"seeded":true}', 1);
    const bundle = await read(fake);
    expect(bundle.documents[notYet!.slice('src/content/'.length)]).toBeDefined();   // readBundle still sees it
    expect(islandDocuments(bundle)[notYet!.slice('src/content/'.length)]).toBeUndefined();
  });

  it('carries a D1-backed document when a row answered', async () => {
    const fake = new FakeD1();
    seed(fake, 'src/content/story.json', '{"heading":"live"}', 4);
    expect(islandDocuments(await read(fake))['story.json']).toBe('{"heading":"live"}');
  });

  // Condition (b). With D1 down the browser must fall back to its OWN compiled
  // copy, which the weekly export refreshes on a Pages build -- never to the
  // Worker's floor, which refreshes only on a Worker deploy and can therefore
  // be older.
  it('carries nothing at all when D1 is unreachable', async () => {
    const fake = new FakeD1();
    fake.failWith = 'D1_ERROR: gone';
    fake.failAfter = 0;
    expect(islandDocuments(await read(fake))).toEqual({});
  });

  it('never carries a document the compiled bundle would render fresher', async () => {
    const fake = new FakeD1();
    for (const path of BUNDLE_PATHS) seed(fake, path, '{"row":true}', 1);
    const island = islandDocuments(await read(fake));
    for (const file of Object.keys(island)) {
      expect(D1_ONLY_PATHS.has('src/content/' + file), file).toBe(true);
    }
  });

  it('gives the crawl block a D1-backed document from the floor when the row is missing', async () => {
    // Condition (a) without (b). story.json is D1-only today; with no row, the
    // crawl block still gets the floor, because a non-JS crawler has no other
    // source.
    const fake = new FakeD1();
    expect(crawlDocuments(await read(fake))['story.json']).toBe(snapshotFor('story.json'));
  });

  it('gives the crawl block nothing for a document the store does not route to D1', async () => {
    const fake = new FakeD1();
    const notYet = BUNDLE_PATHS.find((p) => !D1_ONLY_PATHS.has(p))!;
    expect(crawlDocuments(await read(fake))[notYet.slice('src/content/'.length)]).toBeUndefined();
  });

  it('reports how many of the documents it speaks for are live', async () => {
    const fake = new FakeD1();
    seed(fake, 'src/content/story.json', '{}', 1);
    expect(sourceHeaderValue(await read(fake))).toMatch(/d1=1\/\d+/);
  });
});
```

- [ ] **Step 4: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/content-bundle.test.ts worker/__tests__/bundle.test.ts`**

- [ ] **Step 5: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| **in `islandDocuments`, drop the `D1_ONLY_PATHS.has(path)` check** | "omits a document the store does not route to D1, even when a row exists" and "never carries a document the compiled bundle would render fresher" | **This is the row this task exists for.** If neither reddens, the island is carrying GitHub-backed documents and every publish to one of them is invisible on the live site until somebody redeploys the Worker. Stop and fix it before Task 10. |
| in `islandDocuments`, drop the `read.fromD1.has(file)` check | "carries nothing at all when D1 is unreachable" | — |
| in `crawlDocuments`, drop the `D1_ONLY_PATHS.has(path)` check | "gives the crawl block nothing for a document the store does not route to D1" | — |
| in `crawlDocuments`, add the `fromD1` check | "gives the crawl block a D1-backed document from the floor when the row is missing" | The two functions differ by exactly one condition and each difference is deliberate. If both tests can be satisfied by the same body, one of them is wrong. |
| remove the `try`/`catch` from `readVersions` | "answers null, not a throw, when the database is unreachable" | — |
| in `stampFrom`, drop the `?? 0` so a missing path contributes `undefined` | "gives a document with no row the same stamp component the floor has" | — |
| make `stampFrom(null)` return the same string as `stampFrom(new Map())` | "marks a total database failure with its own stamp…" | — |
| drop `part` from `bundleCacheKey`'s search string | "keeps the island and the crawl markup under different keys" | — |
| in `readBundle`'s catch, leave `documents` populated instead of clearing it | "discards a partial body read entirely rather than serving half a bundle" | — |
| remove the floor loop at the end of `readBundle` | "serves a document with no row from the floor, byte for byte" | — |
| issue twelve separate `SELECT … WHERE path = ?` statements instead of one IN-list | "reads every version in ONE statement" | — |
| add `'src/content/press.json'` to `BUNDLE_PATHS` | "names every document the site renders, and not press.json" | — |
| remove one path from `BUNDLE_PATHS` that is in `D1_ONLY_PATHS` | "reads every path the store routes to D1" | — |

**CSS ceiling:** zero bytes. `worker/` is outside Tailwind's content glob.

**If this task is wrong:** either D1 is read on every page view when it should not be — which on the free tier means errors rather than slowness once a crawler finds the site — or, far worse, **the island overrides a bundle Pages has just rebuilt, and her publish never appears on the live site.** That second failure looks exactly like the site working, right up until she publishes.

---

## Task 10: `worker/site-page.ts` — the content island and the crawler-readable menu

The spec's decisive test: *"A crawler check on real HTTP, not a browser: the menu must be in the response body."* This task builds the two things the Worker injects and the assembly that puts them into the shell. **It routes nothing.** `wrangler.toml`'s route list is untouched until Task 12, so this ships as unreachable code with a full test suite — exactly the way `worker/post-page.ts` was built before its own route existed.

**Files:**
- Create: `worker/crawler-menu.ts`, `worker/site-page.ts`
- Create: `worker/__tests__/crawler-menu.test.ts`, `worker/__tests__/site-page.test.ts`, `worker/__tests__/site-shell.dist.test.ts`
- Modify: `index.html` (the reveal rule for the crawl block)
- Modify: `src/test/head.test.ts`
- Modify: `package.json` (`test:bundle` gains the dist test)

**Interfaces:**

```ts
// worker/crawler-menu.ts
export function crawlerMenu(dishesJson: string | undefined, drinksJson: string | undefined): string;

// worker/site-page.ts
export const ISLAND_ID: string;      // 'vb-content'
export const CRAWL_ID: string;       // 'vb-crawl'
export const CONTENT_SOURCE_HEADER: string;
export const SITE_ANCHORS: readonly { readonly name: string; readonly pattern: RegExp }[];
export function injectContent(shell: string, islandJson: string, crawlHtml: string): string | null;
export function isPageRequest(url: URL): boolean;
export interface SitePageEnv { DB: D1Database; PAGES_ORIGIN: string }
export async function handleSitePage(request: Request, env: SitePageEnv, cache: Cache, fetchImpl?: typeof fetch): Promise<Response>;
```

- [ ] **Step 1: The crawler menu, as escaped HTML strings**

```ts
// worker/crawler-menu.ts
//
// The menu, as HTML a crawler that runs no JavaScript can read.
//
// HAND-BUILT STRINGS, NOT REACT, and that is forced rather than chosen:
// worker/__tests__/bundle.test.ts fails the build if react reaches this
// Worker. So this takes the same posture worker/post-shell.ts already does --
// a small, fully-pinned string builder with one escape function -- and it
// covers the menu and nothing else. It does not attempt the galleries, the
// hero, the blog or the standalone pages: the spec's sentence is about the
// menu, a restaurant lives on someone searching its menu, and every extra
// section here is another renderer with no counterpart in src/ comparing it.
//
// IT TAKES `undefined` AND RETURNS THE EMPTY STRING. That is decision D0
// showing through: worker/content-bundle.ts's crawlDocuments hands this
// nothing at all for a document the Worker does not speak for, and until Task
// 17 moves dishes.json and drinks.json that is every request. An empty string
// means the caller omits the crawl block entirely rather than injecting an
// empty container -- and it means this Worker never publishes a menu that the
// freshly-built Pages bundle disagrees with.
//
// The honest cost, stated: a crawler that does not execute JavaScript gets the
// dish and drink names and descriptions from Task 17 onward, and gets no
// photographs, no gallery, no hours block and no blog. That is a large
// improvement on today, where it gets an empty div, and it is not the whole
// site.
import { escapeHtmlAttribute } from './post-seo';

interface Item { name?: unknown; description?: unknown; category?: unknown }

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? escapeHtmlAttribute(value) : null;
}

// A TEXT node escaped with the ATTRIBUTE-grade escape, the same single-escape
// posture worker/post-shell.ts takes and for the same reason: over-escaping a
// text node is lossless for the characters involved (a browser renders &amp;
// as &), under-escaping either is an injection, and one function with no
// per-context branch cannot be got backwards.
function item(name: string | null, description: string | null): string {
  if (name === null) return '';
  return `<li><h3>${name}</h3>${description === null ? '' : `<p>${description}</p>`}</li>`;
}

function parseArray(json: string | undefined): Item[] {
  if (json === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Item[]) : [];
  } catch {
    // A parse failure must not take the page down: the caller is rendering a
    // whole HTML response and a malformed document is a content problem, not
    // an availability problem. src/content/guards.ts is what rejects bad
    // content, at publish time.
    return [];
  }
}

export function crawlerMenu(dishesJson: string | undefined, drinksJson: string | undefined): string {
  const dishes = parseArray(dishesJson);
  const drinks = parseArray(drinksJson);
  if (dishes.length === 0 && drinks.length === 0) return '';

  const foodItems = dishes.map((dish) => item(text(dish.name), text(dish.description))).join('');

  // Drinks carry a category; grouped in first-seen order rather than sorted, so
  // the crawler's reading order matches the order the page renders them in.
  const groups = new Map<string, string[]>();
  for (const drink of drinks) {
    const name = text(drink.name);
    if (name === null) continue;
    const category = text(drink.category) ?? 'Drinks';
    const markup = item(name, text(drink.description));
    const list = groups.get(category);
    if (list) list.push(markup);
    else groups.set(category, [markup]);
  }
  const drinkGroups = [...groups.entries()]
    .map(([category, items]) => `<h2>${category}</h2><ul>${items.join('')}</ul>`)
    .join('');

  return (foodItems === '' ? '' : `<h2>Menu</h2><ul>${foodItems}</ul>`) + drinkGroups;
}
```

- [ ] **Step 2: The injection, refusing rather than half-writing**

```ts
// worker/site-page.ts
//
// Every HTML page on this site, answered by this Worker: the shell fetched live
// from Pages, with the live content injected into it before it reaches the
// browser.
//
// TWO THINGS ARE INJECTED, and they answer two different readers under two
// different rules -- see worker/content-bundle.ts's islandDocuments and
// crawlDocuments, and the plan's decision D0.
//
//   THE ISLAND -- <script type="application/json" id="vb-content"> holding
//   every document whose live copy is a D1 ROW. src/content/live.ts reads it,
//   validates it with the same guards src/content/index.ts uses at build time,
//   and merges it over the compiled bundle. It carries NOTHING for a document
//   still backed by GitHub, because for those the compiled bundle Pages just
//   rebuilt is the fresher copy and overwriting it would make her publish
//   invisible.
//
//   THE CRAWL BLOCK -- the menu as ordinary HTML, placed INSIDE #root. That
//   position is the whole trick and it needs no client change: src/main.tsx
//   already calls root.replaceChildren() before rendering, so anything here is
//   gone the instant the bundle runs and is present only when it did not. It
//   is the same mechanism index.html's #vb-fallback uses, already proven in
//   production, and it inherits that element's delayed-reveal rule so a human
//   on a working load never sees it. IT IS OMITTED ENTIRELY when there is
//   nothing to say -- an empty container is a promise the Worker cannot keep.
//
// THE SHELL IS FETCHED LIVE AND FROM THE PAGES ORIGIN. Live, for the reason
// worker/post-page.ts's decision D2 gives: asset filenames carry the commit, so
// any cached shell points at URLs that 404 the moment Pages redeploys -- a
// blank page at a real URL for every visitor at once. From env.PAGES_ORIGIN
// rather than the request's own origin, because Task 12 widens this Worker's
// routes to /*, which destroys post-page.ts's "/index.html matches no route"
// anti-loop property outright.
//
// THE ASSEMBLED HTML IS NEVER CACHED. Only the island string and the crawl
// string are, keyed on the content stamp.
import { crawlerMenu } from './crawler-menu';
import {
  bundleCacheKey, readBundle, readVersions, stampFrom,
  islandDocuments, crawlDocuments, sourceHeaderValue, type BundleRead,
} from './content-bundle';

export const ISLAND_ID = 'vb-content';
export const CRAWL_ID = 'vb-crawl';
export const CONTENT_SOURCE_HEADER = 'x-content-source';

export interface SitePageEnv {
  DB: D1Database;
  PAGES_ORIGIN: string;
}

// Pinned against the real committed index.html by this module's own test and
// against the real BUILT dist/index.html by site-shell.dist.test.ts -- so an
// index.html edit, or a Vite plugin that rewrites a tag's shape only in the
// build, is a red build rather than a silent stop.
export const SITE_ANCHORS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'head-close', pattern: /<\/head>/ },
  { name: 'root-open', pattern: /<div id="root">/ },
];

// A path this Worker answers with site HTML, as opposed to one it passes
// straight through to Pages.
//
// THE PREDICATE IS "NO DOT IN THE LAST SEGMENT", written this way rather than
// as a list of routes for one decisive reason: pages.json moves to D1 at Task
// 15, after which she can add a page from the dashboard, instantly, with no
// deploy. An enumerated route list could not know about it.
//
// Everything with an extension -- /assets/index-abc.js, /favicon-32.png,
// /robots.txt, /sitemap.xml, /build-info.json -- is passed through untouched,
// so this Worker never rewrites, re-types or re-caches a single asset byte.
// That matters more here than anywhere: this site has three times served an
// asset under the wrong Content-Type through a poisoned edge cache, and the
// passthrough below is deliberately incapable of causing it.
//
// /edit and /edit/manage are page requests by this predicate and are handled as
// such: the island is harmless there (the dashboard fetches content through
// GET /api/content, authenticated, and ignores it) and the crawl block is
// removed by the same replaceChildren call. public/robots.txt disallows both.
export function isPageRequest(url: URL): boolean {
  const last = url.pathname.split('/').pop() ?? '';
  return !last.includes('.');
}

// Returns null if any anchor is missing, and the caller then serves the shell
// untouched. The same refusal worker/post-shell.ts makes, for the same reason:
// a half-injected document is worse than no injection, because the two halves
// disagree and nothing downstream can tell which is meant.
export function injectContent(shell: string, islandJson: string, crawlHtml: string): string | null {
  for (const { pattern } of SITE_ANCHORS) {
    if (!pattern.test(shell)) return null;
  }
  // </script> inside JSON string data would end the script element early and
  // spill the rest of the document into the page as markup. Escaping the `<` is
  // the standard, lossless fix -- JSON.parse reads < and < identically --
  // and it is applied to the WHOLE payload rather than to a guessed substring.
  const safe = islandJson.replaceAll('<', '\\u003c');
  const island = `<script type="application/json" id="${ISLAND_ID}">${safe}</script></head>`;
  // An EMPTY crawl block is omitted entirely rather than injected as an empty
  // container. See crawler-menu.ts's header: until dishes.json is in D1 this
  // Worker has nothing it is entitled to say to a crawler, and an empty
  // <div id="vb-crawl"></div> would read to every later check as "the crawler
  // menu shipped and is broken" rather than "it has not shipped yet".
  const crawl = crawlHtml === ''
    ? '<div id="root">'
    : `<div id="root"><div id="${CRAWL_ID}">${crawlHtml}</div>`;
  return shell
    .replace(SITE_ANCHORS[0].pattern, () => island)
    .replace(SITE_ANCHORS[1].pattern, () => crawl);
}

// Built from the bundle read, cached under the stamp. Two entries rather than
// one, because the crawl markup is only ever needed for the HTML and the island
// is the larger of the two -- keeping them separate means a change to the crawl
// renderer does not throw away every cached island.
async function pieces(
  request: Request,
  env: SitePageEnv,
  cache: Cache,
): Promise<{ island: string; crawl: string; read: BundleRead; header: string }> {
  const versions = await readVersions(env.DB);
  const stamp = stampFrom(versions);

  const islandKey = bundleCacheKey(request, stamp, 'island');
  const crawlKey = bundleCacheKey(request, stamp, 'crawl');
  const [islandHit, crawlHit] = await Promise.all([cache.match(islandKey), cache.match(crawlKey)]);

  if (islandHit && crawlHit) {
    return {
      island: await islandHit.text(),
      crawl: await crawlHit.text(),
      read: { documents: {}, fromD1: new Set(), stamp, source: 'd1' },
      // The stamp is what a cache hit knows; it names every document's version,
      // which is more useful for debugging a stale page than a recomputed
      // source word would be.
      header: `cache; stamp=${stamp}`,
    };
  }

  const read = await readBundle(env.DB, versions);
  const island = JSON.stringify(islandDocuments(read));
  const crawlable = crawlDocuments(read);
  const crawl = crawlerMenu(crawlable['dishes.json'], crawlable['drinks.json']);

  // Stored as text/plain with an explicit max-age, BEFORE anything in the
  // router rewrites headers. The Cache API refuses to store a no-store response
  // and worker/index.ts's withSecurityHeaders sets exactly that on everything
  // this Worker returns -- the same ordering constraint worker/published.ts's
  // own comment records.
  const cacheable = (text: string) =>
    new Response(text, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=300' } });
  await Promise.all([cache.put(islandKey, cacheable(island)), cache.put(crawlKey, cacheable(crawl))]);

  return { island, crawl, read, header: sourceHeaderValue(read) };
}

// Pages itself unreachable. The same answer worker/post-page.ts gives and for
// the same reason: fetching the shell live is what makes a Worker deploy and a
// Pages deploy independent, so there is no compiled-in shell to fall back to,
// and the only real choice is WHICH failure the visitor gets. A 503 with
// Retry-After is the one answer a crawler is documented to treat as temporary.
// Emphatically not a 404, which is a de-indexing event, and not a 200, which
// would tell everyone the empty page was the real one.
function pagesUnreachable(): Response {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>Temporarily unavailable</title></head>' +
      '<body><p>This page is temporarily unavailable. Please try again shortly.</p></body></html>',
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': '60',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      },
    },
  );
}

// Headers are taken from the shell by ALLOW-LIST, never inherited wholesale --
// the same list and the same reasoning worker/post-page.ts's
// SHELL_HEADERS_KEPT records: a header may cross only if it is a statement
// about the URL rather than about the bytes, and injecting content makes the
// body longer than the one Pages measured. ETag is the dangerous one: every
// page would inherit the SAME one from the same shell, so a cache that trusts
// it can hand one page's body to a request for another.
const SHELL_HEADERS_KEPT: readonly string[] = [
  'Content-Type',
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Strict-Transport-Security',
];

export async function handleSitePage(
  request: Request,
  env: SitePageEnv,
  cache: Cache,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);

  // Not a page: hand it to Pages untouched. One subrequest, no rewriting, no
  // caching of our own, the response object returned as it arrived.
  if (!isPageRequest(url)) {
    const target = new URL(url.pathname + url.search, env.PAGES_ORIGIN);
    try {
      return await fetchImpl(new Request(target.toString(), request));
    } catch {
      return pagesUnreachable();
    }
  }

  let shell: Response;
  try {
    // The SPA catch-all in public/_redirects means every page path answers with
    // index.html, so the shell is fetched at its own name rather than at the
    // visitor's path -- one URL, one cache entry at Pages, and no dependence on
    // the catch-all's behaviour for a path Pages has never seen.
    shell = await fetchImpl(new URL('/index.html', env.PAGES_ORIGIN).toString(), {
      headers: { Accept: 'text/html' },
    });
  } catch {
    return pagesUnreachable();
  }
  // A Pages problem stays a Pages problem. Turning it into a 500 of this
  // Worker's own making would hide which half is broken at the moment somebody
  // needs to know.
  if (!shell.ok) return shell;

  const { island, crawl, header } = await pieces(request, env, cache);
  const html = await shell.text();
  const injected = injectContent(html, island, crawl);

  const headers = new Headers();
  for (const name of SHELL_HEADERS_KEPT) {
    const value = shell.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Authored, never inherited. This document is assembled per request from rows
  // that change whenever she publishes, and it carries no validator of its own,
  // so a cache holding it has no way to ask whether it is still right.
  headers.set('Cache-Control', 'no-store');
  headers.set(CONTENT_SOURCE_HEADER, header);

  const response = new Response(injected ?? html, {
    status: shell.status, statusText: shell.statusText, headers,
  });
  // RFC 9110: HEAD answers exactly what GET would, minus the body. Applied
  // once, to whatever was decided, rather than by branching early -- so "same
  // status, same headers" is true by construction.
  if (request.method === 'HEAD') {
    return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  return response;
}
```

- [ ] **Step 3: The reveal rule for the crawl block**

In `index.html`, inside the existing `<style>` element, after the `#vb-fallback` rules:

```html
      /*
        The Worker (worker/site-page.ts) puts the menu here as plain markup so
        a crawler that runs no JavaScript can read it. src/main.tsx clears
        #root before rendering, so this element is gone the moment the bundle
        runs -- it is only ever on screen when the bundle did not run, which is
        the same contract #vb-fallback above has and is why it reuses that
        element's reveal timing rather than inventing a second one.
      */
      #vb-crawl {
        visibility: hidden;
        animation: vb-reveal 0s linear 4s forwards;
        font-family: Georgia, 'Times New Roman', serif;
        max-width: 40rem;
        margin: 0 auto;
        padding: 0 1.5rem;
        color: #222;
      }
      #vb-crawl h2 { font-size: 1.25rem; font-weight: normal; margin: 1.5rem 0 0.5rem; }
      #vb-crawl h3 { font-size: 1rem; font-weight: 600; margin: 0.75rem 0 0.25rem; }
      #vb-crawl ul { list-style: none; padding: 0; margin: 0; }
      #vb-crawl p { margin: 0; line-height: 1.5; color: #555; }
```

**This CSS lives in `index.html`'s inline `<style>`, which Vite inlines into the HTML document and never merges into `dist/assets/index-*.css`, so it costs the entry CSS ceiling nothing.** The prose comment above it says "gone the moment the bundle runs" rather than using the utility-shaped word for that, deliberately.

And in `src/test/head.test.ts`, the link between the CSS and the Worker constant:

```ts
  // Two strings with no compiler between them: worker/site-page.ts's CRAWL_ID
  // and this rule's selector. Renaming one and not the other leaves the crawl
  // block visible to a human for four seconds on every load.
  it('index.html styles the id worker/site-page.ts injects', () => {
    expect(readFileSync('index.html', 'utf8')).toContain(`#${CRAWL_ID} {`);
  });
```

- [ ] **Step 4: The crawler-menu test, against the real committed menu**

```ts
// worker/__tests__/crawler-menu.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { crawlerMenu } from '../crawler-menu';

// The REAL committed documents, not a fixture. The claim being made is "a
// crawler can read this restaurant's menu", and a two-item fixture cannot
// support it.
const DISHES = readFileSync('src/content/dishes.json', 'utf-8');
const DRINKS = readFileSync('src/content/drinks.json', 'utf-8');

function escaped(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

describe('the menu, as html a crawler can read', () => {
  const html = crawlerMenu(DISHES, DRINKS);

  it('names every dish in the real committed menu', () => {
    const dishes = JSON.parse(DISHES) as { name: string }[];
    expect(dishes.length).toBeGreaterThan(10);
    for (const dish of dishes) expect(html).toContain(escaped(dish.name));
  });

  it('carries every dish description too, not only the names', () => {
    for (const dish of JSON.parse(DISHES) as { description: string }[]) {
      expect(html).toContain(escaped(dish.description.slice(0, 24)));
    }
  });

  it('groups drinks by their own category', () => {
    for (const category of new Set((JSON.parse(DRINKS) as { category: string }[]).map((d) => d.category))) {
      expect(html).toContain(`<h2>${escaped(category)}</h2>`);
    }
  });

  it('escapes a name that would otherwise close the element', () => {
    const evil = JSON.stringify([{ name: '</h3><script>alert(1)</script>', description: 'x' }]);
    expect(crawlerMenu(evil, '[]')).not.toContain('<script>alert(1)</script>');
  });

  it('renders nothing rather than throwing on malformed json', () => {
    expect(() => crawlerMenu('{not json', '[]')).not.toThrow();
    expect(crawlerMenu('{not json', '[]')).toBe('');
  });

  it('skips an item with no name rather than emitting an empty heading', () => {
    expect(crawlerMenu(JSON.stringify([{ description: 'orphan' }]), '[]')).not.toContain('orphan');
  });

  // Decision D0's crawl half: with the Worker not speaking for these documents
  // it is handed undefined, and it must produce nothing at all rather than an
  // empty container.
  it('returns the empty string when it is given nothing to say', () => {
    expect(crawlerMenu(undefined, undefined)).toBe('');
    expect(crawlerMenu('[]', '[]')).toBe('');
  });
});
```

- [ ] **Step 5: The site-page test**

```ts
// worker/__tests__/site-page.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FakeD1, asD1 } from './fakeD1';
import { ISLAND_ID, CRAWL_ID, SITE_ANCHORS, injectContent, isPageRequest, handleSitePage } from '../site-page';
import { D1_ONLY_PATHS } from '../store';
import { BUNDLE_PATHS } from '../content-bundle';

const SHELL = readFileSync('index.html', 'utf-8');
const noCache = (): Cache =>
  ({ match: async () => undefined, put: async () => undefined, delete: async () => false }) as unknown as Cache;
const envWith = (fake: FakeD1) => ({ DB: asD1(fake), PAGES_ORIGIN: 'https://vb-c7r.pages.dev' });
const shellResponse = (body = SHELL) =>
  new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'",
      ETag: '"shell-etag"',
      'Content-Length': String(body.length),
    },
  });

describe('the anchors this rewriter depends on', () => {
  it.each(SITE_ANCHORS.map((a) => [a.name, a.pattern] as const))(
    'the committed index.html carries exactly one %s anchor',
    (_name, pattern) => {
      expect(SHELL.match(new RegExp(pattern.source, 'g'))?.length).toBe(1);
    },
  );
});

describe('injection', () => {
  it('puts the island inside head and the crawl block inside root', () => {
    const out = injectContent(SHELL, '{"a":1}', '<h2>Menu</h2>')!;
    expect(out).toContain(`<script type="application/json" id="${ISLAND_ID}">`);
    expect(out.indexOf(ISLAND_ID)).toBeLessThan(out.indexOf('</head>'));
    expect(out).toContain(`<div id="root"><div id="${CRAWL_ID}"><h2>Menu</h2></div>`);
  });

  it('omits the crawl container entirely when there is nothing to say', () => {
    const out = injectContent(SHELL, '{}', '')!;
    expect(out).not.toContain(CRAWL_ID);
    expect(out).toContain('<div id="root">');
  });

  it('keeps the fallback markup index.html already seeds into root', () => {
    expect(injectContent(SHELL, '{}', '')!).toContain('id="vb-fallback"');
  });

  it('escapes a closing script tag inside the payload', () => {
    const out = injectContent(SHELL, JSON.stringify({ x: '</script><script>alert(1)</script>' }), '')!;
    expect(out).not.toContain('</script><script>alert(1)');
    const island = out.match(new RegExp(`id="${ISLAND_ID}">([\\s\\S]*?)</script>`))![1];
    expect(JSON.parse(island.replaceAll('\\u003c', '<')).x).toBe('</script><script>alert(1)</script>');
  });

  it('refuses rather than half-injecting when an anchor is gone', () => {
    expect(injectContent(SHELL.replace('<div id="root">', '<div id="app">'), '{}', '')).toBeNull();
  });
});

describe('which requests are pages', () => {
  it.each(['/', '/blogs', '/catering', '/blog/some-slug', '/edit', '/edit/manage'])('%s is a page', (path) => {
    expect(isPageRequest(new URL('https://viabiancarestaurant.com' + path))).toBe(true);
  });

  it.each(['/assets/index-abc123.js', '/assets/index-abc123.css', '/favicon-32.png', '/robots.txt',
    '/sitemap.xml', '/build-info.json', '/og-image.jpg'])('%s is passed through, not injected', (path) => {
    expect(isPageRequest(new URL('https://viabiancarestaurant.com' + path))).toBe(false);
  });
});

describe('the response', () => {
  it('never lets the shell ETag or Content-Length cross onto a body it changed', async () => {
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/'), envWith(new FakeD1()),
      noCache(), (async () => shellResponse()) as unknown as typeof fetch);
    expect(response.headers.get('ETag')).toBeNull();
    expect(response.headers.get('Content-Length')).toBeNull();
  });

  it('forwards the shell Content-Security-Policy verbatim', async () => {
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/'), envWith(new FakeD1()),
      noCache(), (async () => shellResponse()) as unknown as typeof fetch);
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
  });

  it('fetches the shell from the pages origin, never from the request host', async () => {
    const fetchImpl = vi.fn(async () => shellResponse());
    await handleSitePage(new Request('https://viabiancarestaurant.com/catering'), envWith(new FakeD1()),
      noCache(), fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://vb-c7r.pages.dev/index.html');
  });

  it('answers HEAD with the same status and headers and no body', async () => {
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/', { method: 'HEAD' }),
      envWith(new FakeD1()), noCache(), (async () => shellResponse()) as unknown as typeof fetch);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(await response.text()).toBe('');
  });

  it('passes an asset through without reading or rewriting it', async () => {
    const asset = new Response('console.log(1)', { headers: { 'Content-Type': 'application/javascript', ETag: '"a"' } });
    const fetchImpl = vi.fn(async () => asset);
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/assets/index-abc.js'),
      envWith(new FakeD1()), noCache(), fetchImpl as unknown as typeof fetch);
    expect(response.headers.get('Content-Type')).toBe('application/javascript');
    // The ETag is TRUTHFUL here, because these really are the bytes Pages sent.
    expect(response.headers.get('ETag')).toBe('"a"');
    expect(await response.text()).toBe('console.log(1)');
    expect(fetchImpl.mock.calls[0][0]).toBeInstanceOf(Request);
  });

  it('answers 503 with Retry-After when Pages cannot be reached', async () => {
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/'), envWith(new FakeD1()),
      noCache(), (async () => { throw new Error('rejected'); }) as unknown as typeof fetch);
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it("hands back Pages' own failure rather than inventing one", async () => {
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/'), envWith(new FakeD1()),
      noCache(), (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch);
    expect(response.status).toBe(500);
  });

  it('serves the shell untouched when an anchor is missing rather than a broken page', async () => {
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/'), envWith(new FakeD1()),
      noCache(), (async () => shellResponse(SHELL.replace('</head>', '</HEAD>'))) as unknown as typeof fetch);
    const body = await response.text();
    expect(body).not.toContain(ISLAND_ID);
    expect(body).toContain('id="root"');
  });
});

// ---------------------------------------------------------------------------
// DECISION D0, end to end through the response. These two are the tests that
// stop the Worker overwriting a bundle Pages has just rebuilt.
// ---------------------------------------------------------------------------
describe('what the injected page is entitled to say', () => {
  it('injects an island carrying only the documents the store routes to D1', async () => {
    const fake = new FakeD1();
    for (const path of BUNDLE_PATHS) {
      fake.content.set(path, { path, body: '{"row":true}', sha: 'x', version: 3, updated_at: 0 });
    }
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/'), envWith(fake),
      noCache(), (async () => shellResponse()) as unknown as typeof fetch);
    const body = await response.text();
    const island = JSON.parse(body.match(new RegExp(`id="${ISLAND_ID}">([\\s\\S]*?)</script>`))![1]
      .replaceAll('\\u003c', '<')) as Record<string, string>;
    expect(Object.keys(island).length).toBe([...D1_ONLY_PATHS].length);
    for (const file of Object.keys(island)) {
      expect(D1_ONLY_PATHS.has('src/content/' + file), file).toBe(true);
    }
  });

  it('emits no crawl block at all while the menu is still backed by GitHub', async () => {
    // The state through Tasks 12-16. dishes.json is not in D1_ONLY_PATHS, so
    // the Worker says nothing about the menu and the freshly-built compiled
    // bundle is the only thing that renders it.
    expect(D1_ONLY_PATHS.has('src/content/dishes.json')).toBe(false);
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/'), envWith(new FakeD1()),
      noCache(), (async () => shellResponse()) as unknown as typeof fetch);
    expect(await response.text()).not.toContain(CRAWL_ID);
  });
});
```

**Note for Task 17:** the second test above asserts today's truth, and Task 17 is what makes it false. Its step list replaces it with the inverse — the crawl block must be present and must name every dish — and that replacement is the point: **a test whose subject moves is rewritten by the task that moves it, not deleted by it.**

- [ ] **Step 6: The dist test, so a build-time rewrite is a red build**

```ts
// worker/__tests__/site-shell.dist.test.ts
//
// The anchors, checked against the REAL BUILT shell rather than the committed
// source. Vite and its plugins rewrite index.html on the way into dist/ --
// script tags gain hashed src attributes, and a future plugin could reshape a
// tag this rewriter matches on. The committed file agreeing is not evidence
// that the served one does.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SITE_ANCHORS, ISLAND_ID, CRAWL_ID, injectContent } from '../site-page';

const REQUIRED = !!process.env.VB_REQUIRE_DIST;
const DIST_INDEX = 'dist/index.html';

describe('the built shell still carries every anchor', () => {
  it.skipIf(!REQUIRED && !existsSync(DIST_INDEX))('injects into the real dist/index.html', () => {
    const shell = readFileSync(DIST_INDEX, 'utf-8');
    for (const { name, pattern } of SITE_ANCHORS) {
      expect(shell.match(new RegExp(pattern.source, 'g'))?.length, `anchor ${name}`).toBe(1);
    }
    const out = injectContent(shell, '{"ok":1}', '<h2>Menu</h2>');
    expect(out).not.toBeNull();
    expect(out!).toContain(ISLAND_ID);
    expect(out!).toContain(CRAWL_ID);
  });

  it.skipIf(!REQUIRED && !existsSync(DIST_INDEX))('keeps the crawl block styled in the BUILT html', () => {
    // Vite inlines index.html's <style> rather than extracting it; if a future
    // config change ever extracts it into the entry sheet instead, this task's
    // "zero bytes" claim silently becomes false and the ceiling is spent.
    expect(readFileSync(DIST_INDEX, 'utf-8')).toContain(`#${CRAWL_ID} {`);
  });
});
```

and in `package.json`:

```json
    "test:bundle": "VB_REQUIRE_DIST=1 vitest run src/test/bundle.post-build.test.ts src/test/crawlers.test.ts worker/__tests__/post-shell.dist.test.ts worker/__tests__/site-shell.dist.test.ts",
```

- [ ] **Step 7: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/crawler-menu.test.ts worker/__tests__/site-page.test.ts worker/__tests__/bundle.test.ts src/test/head.test.ts && npm run build`**

- [ ] **Step 8: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| **in `pieces`, build the island from `read.documents` instead of `islandDocuments(read)`** | "injects an island carrying only the documents the store routes to D1" | **The end-to-end half of Task 9's D0 row.** If it does not redden, the response is carrying GitHub-backed documents and every publish to one is invisible until a Worker deploy. |
| in `pieces`, build the crawl from `read.documents` instead of `crawlDocuments(read)` | "emits no crawl block at all while the menu is still backed by GitHub" | — |
| in `injectContent`, always emit the crawl container even when `crawlHtml` is `''` | "omits the crawl container entirely when there is nothing to say" | — |
| in `injectContent`, drop the `replaceAll('<', '\\u003c')` | "escapes a closing script tag inside the payload" | — |
| in `injectContent`, return the shell instead of null when an anchor is missing | "refuses rather than half-injecting when an anchor is gone" | — |
| in `injectContent`, drop the reopening `<div id="root">` | "keeps the fallback markup index.html already seeds into root" | — |
| change `isPageRequest` to always return true | every row of "…is passed through, not injected" | — |
| add `'ETag'` to `SHELL_HEADERS_KEPT` | "never lets the shell ETag or Content-Length cross onto a body it changed" | — |
| fetch the shell from `url.origin` instead of `env.PAGES_ORIGIN` | "fetches the shell from the pages origin, never from the request host" | — |
| return the full body for a HEAD | "answers HEAD with the same status and headers and no body" | — |
| remove the `try`/`catch` around the shell fetch | "answers 503 with Retry-After when Pages cannot be reached" | — |
| turn a non-ok shell into a 500 of our own | "hands back Pages' own failure rather than inventing one" | — |
| in `crawlerMenu`, emit `name` without `escapeHtmlAttribute` | "escapes a name that would otherwise close the element" | — |
| rename `#vb-crawl` in `index.html`'s style block only | "index.html styles the id worker/site-page.ts injects" | If that test does not exist, add it — the CSS and the Worker constant are two strings with no compiler between them, and the symptom of a mismatch is a raw menu visible to a human for four seconds on every page load. |

**CSS ceiling:** **zero bytes on the entry sheet.** The `#vb-crawl` rules live in `index.html`'s inline `<style>`, which Vite inlines into the HTML document. Confirm after the build: `ls -l dist/assets/index-*.css` must still read 39441. If it moved, something in this task reached the Tailwind sheet and the accounting is owed in this commit. `worker/__tests__/site-shell.dist.test.ts`'s second case is what keeps that true if Vite's config ever changes.

**If this task is wrong:** the page renders with a broken or missing island and every visitor sees the compiled-in content — which looks exactly like the site working, until she publishes a D1-backed document and nothing changes.

---

## Task 11: The browser reads the island

The second half of the render. `src/content/live.ts` reads the injected JSON, runs it through **the same guard functions `src/content/index.ts` already runs at build time**, and merges what survives over the compiled bundle. Anything that fails a guard is discarded per-document and the compiled copy stands — so a corrupt or half-written island degrades one section to stale rather than blanking the site.

**With no island in the document — a local `npm run dev`, `npm run preview`, the Playwright suite, or any deploy before Task 12 — this changes nothing at all.** That is what makes it safe to ship first.

**Files:**
- Create: `src/content/live.ts`
- Create: `src/content/__tests__/live.test.ts`
- Create: `e2e/content-island.spec.ts`
- Modify: `src/main.tsx`

**Interfaces:**

```ts
// src/content/live.ts
export const ISLAND_ELEMENT_ID: string;   // 'vb-content'
export function parseIsland(json: string): Partial<ContentBundle>;
export function liveBundle(doc?: Document): ContentBundle;
```

- [ ] **Step 1: The reader**

```ts
// src/content/live.ts
//
// The content the Worker injected, read out of the document and validated with
// the SAME guards src/content/index.ts runs at build time.
//
// PER-DOCUMENT, NOT ALL-OR-NOTHING. Each document is guarded on its own and,
// if its guard throws, that one falls back to the compiled copy while the
// others use the live one. A single malformed document must not blank the
// whole site, and a single malformed document is exactly the shape a partly
// written cache entry or a truncated response takes.
//
// THE COMPILED BUNDLE IS THE FLOOR ON THIS SIDE TOO. defaultBundle is what
// every component already falls back to when no provider is mounted, so a page
// with no island renders precisely what it renders today.
//
// WHAT THE ISLAND CONTAINS IS THE WORKER'S DECISION, NOT THIS FILE'S. Decision
// D0: worker/content-bundle.ts's islandDocuments sends only documents whose
// live copy is a D1 row. For anything still backed by GitHub the island is
// silent, and the compiled bundle -- which Pages rebuilt from her publish
// commit -- is what renders. This file does not need to know which is which;
// it only has to prefer what it is given, and be given only what is fresher.
//
// NEVER THROWS. A reader that threw would take down the whole app from module
// scope in main.tsx, which is the one failure mode worse than stale content.
import { defaultBundle } from './ContentContext';
import type { ContentBundle } from './types';
import {
  assertHours, assertCollageTree, assertDrinkCategory, assertSections,
  assertPages, assertExperiences, assertPosts, assertCopy,
} from './guards';

export const ISLAND_ELEMENT_ID = 'vb-content';

// One entry per document the island can carry. Written out rather than
// derived, because each document's guard takes a different shape and a clever
// generic here would hide which one is missing.
//
// awards.json has no entry: it has no ContentBundle slot at all and
// src/components/Awards.tsx fetches it through GET /api/published on its own.
// An unknown name is skipped below, so its presence in the island costs about
// a hundred bytes and nothing else.
const READERS: Record<string, (raw: unknown) => Partial<ContentBundle>> = {
  'site.json': (raw) => {
    const site = raw as ContentBundle['site'];
    assertHours(site.hours as unknown as { days: string[]; opens: string; closes: string });
    return { site };
  },
  'galleries.json': (raw) => {
    const galleries = raw as ContentBundle['galleries'];
    assertCollageTree((galleries as unknown as { heroCollage: unknown }).heroCollage);
    return { galleries };
  },
  'dishes.json': (raw) => {
    if (!Array.isArray(raw)) throw new Error('dishes.json is not an array');
    return { dishes: raw as ContentBundle['dishes'] };
  },
  'drinks.json': (raw) => {
    if (!Array.isArray(raw)) throw new Error('drinks.json is not an array');
    raw.forEach((entry, index) => assertDrinkCategory((entry as { category: unknown }).category, index));
    return { drinks: raw as ContentBundle['drinks'] };
  },
  'story.json': (raw) => ({ story: raw as ContentBundle['story'] }),
  'menus.json': (raw) => {
    if (!Array.isArray(raw)) throw new Error('menus.json is not an array');
    return { menus: raw as ContentBundle['menus'] };
  },
  'copy.json': (raw) => ({ copy: assertCopy(raw) }),
  'sections.json': (raw) => ({ sections: assertSections(raw) }),
  'pages.json': (raw) => ({ pages: assertPages(raw) }),
  'experiences.json': (raw) => ({ experiences: assertExperiences(raw) }),
  'posts.json': (raw) => ({ posts: assertPosts(raw) }),
};

export function parseIsland(json: string): Partial<ContentBundle> {
  let documents: unknown;
  try {
    documents = JSON.parse(json);
  } catch {
    return {};
  }
  if (documents === null || typeof documents !== 'object' || Array.isArray(documents)) return {};

  const merged: Partial<ContentBundle> = {};
  for (const [file, body] of Object.entries(documents as Record<string, unknown>)) {
    const reader = READERS[file];
    if (!reader || typeof body !== 'string') continue;
    try {
      Object.assign(merged, reader(JSON.parse(body)));
    } catch {
      // This one document stays compiled-in. Deliberately silent rather than
      // logged: a console error on every page load for a content problem the
      // visitor cannot act on is noise, and the x-content-source response
      // header plus verify:deploy are where a human finds out.
      continue;
    }
  }
  return merged;
}

export function liveBundle(doc: Document = document): ContentBundle {
  const element = doc.getElementById(ISLAND_ELEMENT_ID);
  if (element === null) return defaultBundle;
  return { ...defaultBundle, ...parseIsland(element.textContent ?? '') };
}
```

Re-read every comment in that file for bare Tailwind utility tokens before committing. `hidden`, `static`, `table`, `block`, `filter` and `order` do not appear in it today.

- [ ] **Step 2: Mount it**

In `src/main.tsx`:

```tsx
import { ContentProvider } from './content/ContentContext';
import { liveBundle } from './content/live';

// Read ONCE, at module scope, before the first render. The island is a static
// element the Worker put in the document; re-reading it per mount would cost a
// JSON parse on every StrictMode double-mount and could never produce a
// different answer.
//
// With no island in the document -- a local `npm run dev`, `npm run preview`,
// or any deploy before the Worker route was widened -- liveBundle returns
// defaultBundle, which is what every component already falls back to when no
// provider is mounted. So this line changes nothing at all until the Worker is
// actually injecting.
const bundle = liveBundle();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ContentProvider value={bundle}>
        <App />
      </ContentProvider>
    </ErrorBoundary>
  </StrictMode>
);
```

- [ ] **Step 3: The test**

```ts
// src/content/__tests__/live.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIsland, liveBundle, ISLAND_ELEMENT_ID } from '../live';
import { defaultBundle } from '../ContentContext';

const island = (documents: Record<string, string>) => JSON.stringify(documents);
const real = (file: string) => readFileSync(join(process.cwd(), 'src', 'content', file), 'utf-8');

describe('reading the injected content island', () => {
  it('takes a live document over the compiled one', () => {
    const dishes = JSON.stringify([{ id: 'live', name: 'Live Dish', description: 'from d1', image: null, tags: [] }]);
    const merged = parseIsland(island({ 'dishes.json': dishes }));
    expect(merged.dishes).toHaveLength(1);
    expect(merged.dishes![0].name).toBe('Live Dish');
  });

  // Every one of the eleven readers ran and produced a value. If a guard
  // rejected the repository's own content, this migration would silently serve
  // the compiled copy forever and nothing else would say so.
  it('accepts every real committed document unchanged', () => {
    const files = ['site.json', 'galleries.json', 'dishes.json', 'drinks.json', 'story.json', 'menus.json',
      'copy.json', 'sections.json', 'pages.json', 'experiences.json', 'posts.json'];
    const merged = parseIsland(island(Object.fromEntries(files.map((f) => [f, real(f)]))));
    expect(Object.keys(merged).sort()).toEqual(
      ['copy', 'dishes', 'drinks', 'experiences', 'galleries', 'menus', 'pages', 'posts', 'sections', 'site', 'story'],
    );
  });

  it('drops ONE malformed document and keeps the rest', () => {
    const merged = parseIsland(island({ 'dishes.json': '{"not":"an array"}', 'copy.json': real('copy.json') }));
    expect(merged.dishes).toBeUndefined();
    expect(merged.copy).toBeDefined();
  });

  it('rejects a drinks document with an unknown category rather than rendering it', () => {
    const drinks = JSON.stringify([{ id: 'x', name: 'X', description: 'd', category: 'not-a-category', image: null }]);
    expect(parseIsland(island({ 'drinks.json': drinks })).drinks).toBeUndefined();
  });

  it('returns nothing at all for malformed island json, rather than throwing', () => {
    expect(() => parseIsland('{not json')).not.toThrow();
    expect(parseIsland('{not json')).toEqual({});
    expect(parseIsland('[1,2,3]')).toEqual({});
  });

  it('ignores a document name it has no reader for', () => {
    expect(parseIsland(island({ 'awards.json': '[]', 'wrangler.toml': 'x' }))).toEqual({});
  });

  it('falls back to the compiled bundle when there is no island in the document', () => {
    expect(liveBundle(document)).toBe(defaultBundle);
  });

  it('merges over the compiled bundle, keeping the render functions', () => {
    const element = document.createElement('script');
    element.id = ISLAND_ELEMENT_ID;
    element.textContent = island({ 'dishes.json': '[]' });
    document.body.appendChild(element);
    try {
      const bundle = liveBundle(document);
      expect(bundle.dishes).toEqual([]);
      // The bundle is not only data: renderImage and renderText come from
      // defaultBundle and every component calls them. A spread that lost them
      // would crash every editable call site.
      expect(typeof bundle.renderImage).toBe('function');
      expect(typeof bundle.renderText).toBe('function');
      // press.json is never in the island and must still come from the bundle.
      expect(bundle.press).toBe(defaultBundle.press);
    } finally {
      element.remove();
    }
  });
});
```

- [ ] **Step 4: The browser proof, which observes a rendered string**

```ts
// e2e/content-island.spec.ts
//
// jsdom cannot answer either of the two questions here: whether the real bundle
// removes the crawl block on mount, and whether the page a human sees is the
// LIVE content rather than the compiled one. Both are observations about a real
// document after real script execution.
//
// The dev server serves index.html straight from disk with no Worker in front
// of it, so the island is injected by the test. That is honest: what is proven
// here is the CLIENT half. The Worker half is worker/__tests__/site-page.test.ts
// and, in production, scripts/verify-deploy.mjs.
import { test, expect } from '@playwright/test';

const PROBE_DISH = 'E2E Probe Dish 8f31';

test('the island is read and rendered, and the crawl block is removed', async ({ page }) => {
  const dishes = JSON.stringify([
    { id: 'probe', name: PROBE_DISH, description: 'Injected by the spec.', image: null, tags: [] },
  ]);
  await page.route('**/index.html', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const injected = html
      .replace('</head>', `<script type="application/json" id="vb-content">${JSON.stringify({ 'dishes.json': dishes })}</script></head>`)
      .replace('<div id="root">', '<div id="root"><div id="vb-crawl"><h2>Menu</h2><h3>Crawl Only Marker</h3></div>');
    await route.fulfill({ response, body: injected, headers: { ...response.headers(), 'content-length': String(injected.length) } });
  });

  await page.goto('/');

  // The island element stays in the document -- it is inside <head>, which
  // React never touches -- and that is what proves the injection arrived.
  await expect(page.locator('#vb-content')).toHaveCount(1);
  // The crawl block is inside #root, which src/main.tsx clears. Its absence
  // after mount is positive evidence the bundle ran, the same evidence
  // scripts/verify-deploy.mjs takes from #vb-fallback.
  await expect(page.locator('#vb-crawl')).toHaveCount(0);
  await expect(page.getByText('Crawl Only Marker')).toHaveCount(0);

  // THE ASSERTION THAT MAKES THE PROVIDER OBSERVABLE. Without the
  // ContentProvider in main.tsx every component falls back to defaultBundle,
  // which is the same DATA -- so a test that only checked the page rendered
  // would pass with the whole feature missing. A distinctive dish name that
  // exists nowhere in the repository cannot be produced by the compiled bundle.
  await expect(page.getByText(PROBE_DISH)).toBeVisible();
});
```

- [ ] **Step 5: `npx tsc -b --noEmit && npm test -- --run src/content/__tests__/live.test.ts src/test/routing.test.tsx && npx playwright test e2e/content-island.spec.ts`**

`routing.test.tsx` is in that list because it mounts `ContentProvider` itself and `main.tsx` now does too; a nested provider is fine but the test's own override must still win.

- [ ] **Step 6: `npm run gate`, then commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| in `parseIsland`, spread the raw document without calling the reader | "rejects a drinks document with an unknown category rather than rendering it" | — |
| remove the per-document `try`/`catch`, letting one failure abort the loop | "drops ONE malformed document and keeps the rest" | — |
| remove the outer `try`/`catch` around `JSON.parse` | "returns nothing at all for malformed island json, rather than throwing" | — |
| drop the `Array.isArray` rejection on the island itself | same test — `parseIsland('[1,2,3]')` | — |
| in `liveBundle`, return `parseIsland(...)` instead of spreading over `defaultBundle` | "merges over the compiled bundle, keeping the render functions" | — |
| delete one entry from `READERS`, e.g. `copy.json` | "accepts every real committed document unchanged" | — |
| change `ISLAND_ELEMENT_ID` to `vb-contents` | "merges over the compiled bundle…" and the e2e spec's island count | — |
| **in `main.tsx`, drop the `ContentProvider` wrapper** | `e2e/content-island.spec.ts` — `PROBE_DISH` is not visible | **Nothing in `src/test/` reddens**, and that is expected: every component falls back to `defaultBundle`, which is the same data. The probe dish name is the whole reason the e2e spec injects one. If that assertion is ever weakened to "the page rendered", the feature can go missing silently. |

**CSS ceiling:** expected zero. `src/content/live.ts` and `src/main.tsx` add no class names. Confirm with `npm run build` against 39441; if it moved, a comment leaked a utility token and the fix is to reword it.

**If this task is wrong:** the Worker injects live content and the browser ignores it, so every publish to a D1-backed document appears to do nothing — the exact symptom this migration exists to remove, arriving as the migration ships.

---

## Task 12: Widen the route to `/*`, deploy, and prove the render in production

**The riskiest deploy in this plan, and it carries no content change at all.** Every document is still in git, still compiled into the bundle, still written by the GitHub publish path. What changes is that the Worker is now in front of every page and every asset. If it is wrong, the fallback is the content that was already shipping.

**Files:**
- Modify: `wrangler.toml` (routes)
- Modify: `worker/index.ts` (`servesPages`, the `/*` branch, `Env`)
- Modify: `worker/post-page.ts`, `worker/__tests__/post-page.test.ts`
- Modify: `src/test/hosting.test.ts`
- Modify: `scripts/verify-deploy.mjs`

**Interfaces:**

```ts
// worker/index.ts -- servesSiteHtml is REPLACED, not widened in place, because
// its name stopped being true: it now also covers assets passed through to
// Pages, which are not HTML.
export function servesPages(request: Request): boolean;
export interface Env extends GitHubEnv, PagesEnv, WebAnalyticsEnv {
  PAGES_ORIGIN: string;
  IMAGE_HOST: string;
  R2: R2Bucket;
}

// worker/post-page.ts -- one field added, so both shell fetchers read the same
// var and cannot drift onto different origins.
export interface PostPageEnv { DB: D1Database; PAGES_ORIGIN: string }
```

- [ ] **Step 1: Widen the routes**

```toml
routes = [
  { pattern = "viabiancarestaurant.com/*", zone_name = "viabiancarestaurant.com" },
]
```

and replace the `/blog/*` paragraph of the surrounding comment with:

```toml
# ONE PATTERN NOW, and it is /*. Every page view is a Worker request, which the
# spec states plainly as a consequence rather than an implementation detail:
# Workers Free allows 100,000 requests a day against a few hundred page views
# plus their assets -- roughly four Worker requests per view once assets are
# counted, so of the order of 2,000 a day. Photographs do not count at all:
# they are served by R2 on img.viabiancarestaurant.com, which is not a Worker
# route.
#
# WHY NOT AN ENUMERATED LIST of /, /blogs, /catering and the rest. Because
# pages.json moves to D1 at Task 15, after which she can add a page from the
# dashboard with no deploy -- and a route list written at deploy time could not
# know about it, so her new page would be answered by Pages with no content
# island. That is exactly the "content is in D1 but something cannot read it"
# state this migration is arranged to make impossible.
#
# WHAT THIS BREAKS THAT USED TO HOLD: worker/post-page.ts's header comment named
# "/index.html matches neither route" as the reason its shell subrequest could
# not recurse into this Worker. Under /* it would. Both post-page.ts and
# site-page.ts now fetch the shell from PAGES_ORIGIN (a pages.dev hostname,
# matched by no route), which is what replaces that property. Changing one
# without the other is an infinite loop that Cloudflare cuts off as a 1102
# CPU-limit error on every page.
#
# ASSETS PASS THROUGH UNTOUCHED. worker/site-page.ts's isPageRequest sends
# anything with an extension straight to Pages as the Response object it
# arrived as -- no rewriting, no re-typing, no cache of our own. This site has
# three times served an asset under the wrong Content-Type through a poisoned
# edge cache, and that passthrough is deliberately incapable of causing it.
#
# THE ROLLBACK is this list back to the two entries below and one
# `npx wrangler deploy`. Pages answers everything again immediately and both
# handlers become unreachable without a route:
#   { pattern = "viabiancarestaurant.com/api/*",  zone_name = "viabiancarestaurant.com" },
#   { pattern = "viabiancarestaurant.com/blog/*", zone_name = "viabiancarestaurant.com" },
```

- [ ] **Step 2: One predicate for the handler and the header exemption**

In `worker/index.ts`, replace `servesSiteHtml` with:

```ts
// Every request this Worker answers out of Pages -- an injected page, a
// rewritten post page, or a passed-through asset. ONE predicate, called from
// both the router and withSecurityHeaders, for the reason the previous comment
// here already gave: two predicates -- one deciding who gets the handler, one
// deciding who gets the headers -- is two things that must agree forever,
// checked by nobody.
//
// WHAT IT PREVENTS, and the failure is total and silent: SECURITY_HEADERS sets
// `Content-Security-Policy: default-src 'none'` on every response this Worker
// returns. That is right for a JSON API and it forbids script, style, font and
// image -- so an HTML page served under it is a completely blank white page at
// a 200, and an asset served under it is refused by the browser.
// public/_headers already carries the policy this site's documents and assets
// need and Pages applies it to everything site-page.ts fetches.
//
// METHOD IS PART OF IT. A pathname-only test would also exempt the router's
// plain-text 404 for POST /anything -- a response this Worker authored, that is
// not HTML, and that would then carry no nosniff, no X-Frame-Options and no
// no-store. HEAD is in because RFC 9110 requires it to answer what GET would;
// OPTIONS stays a 404, which is the answer every other path already gives it.
export function servesPages(request: Request): boolean {
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') return false;
  // /api/* is this Worker's own API and is emphatically NOT a Pages response.
  // Checked first, so widening the route to /* cannot accidentally strip the
  // security headers off every API answer.
  return !new URL(request.url).pathname.startsWith('/api/');
}
```

and in `withSecurityHeaders`, change `servesSiteHtml(request)` to `servesPages(request)`.

- [ ] **Step 3: Route it, after every `/api/*` branch**

```ts
  // Everything that is not this Worker's own API. Ordered so a blog post still
  // gets its rewritten <head> -- handlePostPage's own slugFromPath is what
  // decides, exactly as before -- and everything else gets the injected island,
  // the crawl block if there is one, or a straight passthrough.
  if (servesPages(request)) {
    if (slugFromPath(new URL(request.url).pathname) !== null) {
      return handlePostPage(request, env);
    }
    return handleSitePage(request, env, contentCache());
  }
```

and add to `Env`:

```ts
  // Where site-page.ts and post-page.ts fetch the SPA shell from. A pages.dev
  // hostname, matched by no Worker route, so a /* route cannot make the shell
  // subrequest recurse into this Worker.
  PAGES_ORIGIN: string;
  // Where photographs are served from -- read by worker/upload.ts from Task 18
  // to build the URL it hands back. src/test/wrangler-config.test.ts asserts it
  // equals src/shared/image-host.ts's own constant.
  IMAGE_HOST: string;
  // The bucket. Bound since Task 1, used from Task 18.
  R2: R2Bucket;
```

- [ ] **Step 4: Move `post-page.ts` onto the same origin**

Change `PostPageEnv` to `{ DB: D1Database; PAGES_ORIGIN: string }`, replace `new URL(SHELL_PATH, url.origin)` with `new URL(SHELL_PATH, env.PAGES_ORIGIN)`, and rewrite the anti-loop paragraph:

```ts
// AND IT CANNOT LOOP -- but not for the reason this comment used to give.
// wrangler.toml now routes this Worker on /*, so /index.html on the site's own
// origin WOULD match it. The shell is therefore fetched from env.PAGES_ORIGIN,
// the Pages project's own production alias, which is matched by no Worker route
// at all. That is the property that replaces the old one, and the two files
// that depend on it (this one and worker/site-page.ts) both read the same var
// so they cannot drift apart.
```

Update `worker/__tests__/post-page.test.ts`'s env fixtures to carry `PAGES_ORIGIN` and assert the fetched URL is on it — the same assertion `site-page.test.ts` makes.

- [ ] **Step 5: Update the route pins**

```ts
// src/test/hosting.test.ts
  it('routes every path on the real zone to the Worker', () => {
    const routes = parseRoutes(readFileSync('wrangler.toml', 'utf8'));
    const domain = new URL(site.seo.url).host;
    expect(routes.some((r) => r.pattern === `${domain}/*` && r.zoneName === domain)).toBe(true);
  });

  // The property the whole /* widening rests on. A route naming the Pages
  // origin would make the shell subrequest recurse into this Worker, which
  // Cloudflare cuts off as a CPU-limit error on every page at once.
  it('routes nothing on the pages.dev origin the shell is fetched from', () => {
    expect(parseRoutes(readFileSync('wrangler.toml', 'utf8')).every((r) => !r.pattern.includes('pages.dev'))).toBe(true);
  });

  it('every route names the zone its own host belongs to', () => {
    for (const { pattern, zoneName } of parseRoutes(readFileSync('wrangler.toml', 'utf8'))) {
      expect(pattern.split('/')[0].endsWith(zoneName)).toBe(true);
    }
  });
```

- [ ] **Step 6: Extend the deploy verifier**

In `scripts/verify-deploy.mjs`, after the Worker-freshness check:

```js
// The island, on real HTTP with no browser. A browser would execute the SPA and
// mask a Worker that injected nothing, which is the same reason checkPostSeo
// below uses a raw fetch rather than the chromium page already open.
//
// WHAT IS ASSERTED HERE AND WHAT IS NOT. The island must exist and must carry
// exactly the documents worker/store.ts routes to D1 -- no more (decision D0:
// a GitHub-backed document in the island would overwrite a bundle Pages just
// rebuilt) and no fewer. The CRAWL BLOCK is asserted only when the island
// carries dishes.json, because until Task 17 the Worker is not entitled to say
// anything about the menu. Task 17's step list makes that assertion
// unconditional; until then a conditional check is the honest one, and it is
// never vacuous because the island membership check runs either way.
{
  const home = await get('/');
  const html = await home.text();
  const match = html.match(/<script type="application\/json" id="vb-content">([\s\S]*?)<\/script>/);
  if (!match) failures.push('the homepage carries no content island');
  else {
    const island = JSON.parse(match[1].replaceAll('\\u003c', '<'));
    const expected = D1_ONLY_FILES;   // read from worker/store.ts, see below
    const extra = Object.keys(island).filter((f) => !expected.includes(f));
    const missing = expected.filter((f) => !Object.keys(island).includes(f));
    if (extra.length) failures.push(`the island carries documents the Worker does not speak for: ${extra.join(', ')}`);
    if (missing.length) failures.push(`the island is missing D1-backed documents: ${missing.join(', ')}`);
    console.log(`  content island carries ${Object.keys(island).length} D1-backed document(s)`);

    if (island['dishes.json']) {
      const dishes = JSON.parse(island['dishes.json']);
      const absent = dishes
        .map((d) => d.name.replaceAll('&', '&amp;').replaceAll("'", '&#39;').replaceAll('"', '&quot;'))
        .filter((name) => !html.includes(name));
      if (!html.includes('id="vb-crawl"')) failures.push('dishes.json is in the island but there is no crawler menu');
      else if (absent.length) failures.push(`${absent.length} dish name(s) are in the island but not in the crawler menu: ${absent.slice(0, 3).join(', ')}`);
      else console.log(`  crawler menu names all ${dishes.length} dishes from the live document`);
    } else {
      console.log('  no crawler menu yet: dishes.json is still backed by GitHub (expected before Task 17)');
    }
  }
}
```

`D1_ONLY_FILES` is read out of `worker/store.ts` as text rather than imported, because this script is plain Node:

```js
// Parsed from worker/store.ts rather than duplicated, so a document added to
// D1_ONLY_PATHS is covered by this check on the same commit that adds it.
const D1_ONLY_FILES = [...readFileSync('worker/store.ts', 'utf8')
  .match(/D1_ONLY_PATHS[\s\S]*?\]\)/)[0]
  .matchAll(/'src\/content\/([a-z]+\.json)'/g)].map((m) => m[1]);
```

And an asset, through the Worker, with the site's own `Origin`:

```js
// This deliberately re-enters territory this script has twice been burned by --
// see the SETTLE_MS comment -- and it is now MANDATORY rather than optional,
// because the Worker sits in front of every asset and the per-deployment
// pages.dev URL no longer exercises the same path. It runs only AFTER the
// build-info poll confirmed the deploy is live and after SETTLE_MS, so the
// not-yet-propagated window it used to open is already closed.
{
  const entry = (await (await get('/')).text()).match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!entry) failures.push('could not find the entry bundle in the served homepage');
  else {
    const asset = await get(entry[0]);
    const type = asset.headers.get('content-type') ?? '';
    if (!EXPECTED_TYPE['.js'].test(type)) failures.push(`${entry[0]} served as "${type}" through the Worker`);
    else console.log(`  ${entry[0]} passes through the Worker as ${type}`);
  }
}
```

- [ ] **Step 7: Deploy, in this order, and check between each**

```
npm run gate
git push                       # Pages builds; index.html's #vb-crawl CSS ships
npm run verify:deploy          # green BEFORE the Worker moves
npx wrangler deploy            # the /* route and both handlers
npm run verify:deploy          # green AFTER
```

Then by hand, on the live site: open `/`, `/blogs`, `/catering`, `/blog/<a real slug>` and `/edit`. **`/edit` is the one to look at hardest** — it is now a Worker response for the first time, and a CSP mistake there shows up as a dashboard that loads but cannot convert an iPhone photo.

```
curl -sS  https://viabiancarestaurant.com/ | grep -c 'id="vb-content"'         # 1
curl -sS  https://viabiancarestaurant.com/ | grep -c 'id="vb-crawl"'           # 0 -- expected, see D0
curl -sSI https://viabiancarestaurant.com/ | grep -i x-content-source          # d1; d1=3/3; floor=<ts>
curl -sSI https://viabiancarestaurant.com/robots.txt | grep -i content-type    # text/plain
curl -sS  https://viabiancarestaurant.com/ | grep -o 'kamalika-anand' | head -1 # from the island: story.json
```

**`d1=3/3` is the expected reading:** awards, story and posts were already D1-only, so the Worker speaks for exactly those three and the island carries exactly those three. **`id="vb-crawl"` returning 0 is also expected and correct** — `dishes.json` is still backed by GitHub, so the Worker says nothing about the menu. A `1` here would mean the crawl rule is not being applied and the Worker is publishing a menu the compiled bundle may disagree with.

- [ ] **Step 8: Watch the Worker's request count for 24 hours**

Cloudflare dashboard → Workers → `via-bianca-admin` → Metrics. Record requests/day in `docs/cloudflare-cutover.md` against the 100,000 free limit. **If it is above 20,000, something is fetching assets in a loop** and the passthrough needs looking at before Tier 4 starts.

- [ ] **Step 9: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| revert `routes` to the two `/api/*` and `/blog/*` entries | "routes every path on the real zone to the Worker" | — |
| add `{ pattern = "vb-c7r.pages.dev/*", zone_name = "pages.dev" }` | "routes nothing on the pages.dev origin the shell is fetched from" | — |
| in `servesPages`, drop the `/api/` check | `worker/__tests__/index.test.ts`'s security-header assertions on `/api/health` | If those tests do not assert the header set on an API response, add one: `expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")`. Losing the header set on every API answer is the worst outcome available in this task. |
| in `servesPages`, return true for POST | the same header assertions on `POST /api/publish` | — |
| in `post-page.ts`, fetch the shell from `url.origin` again | `worker/__tests__/post-page.test.ts`'s pages-origin assertion | — |
| add `'dishes.json'` to the island by hand in a local Worker run | `verify:deploy`'s "the island carries documents the Worker does not speak for" | Run it against a locally patched Worker via `VB_SITE`. If it stays green, the island membership check is comparing the island against itself rather than against `worker/store.ts`. |
| in `verify-deploy.mjs`, hardcode `D1_ONLY_FILES` instead of parsing `worker/store.ts` | flip one document in Tier 4 without editing the script; the check keeps passing while the island grew | The parse is what makes this check follow the migration automatically. A hardcoded list is a list somebody has to remember, and this plan has four batches. |
| remove the crawler-menu branch from `verify-deploy.mjs` entirely | run `verify:deploy` after Task 17 against a Worker whose `crawlerMenu` returns `''`; it must exit 1 | If it passes, the island check alone is being taken as proof the menu rendered, which it is not — the island is JSON and would still be there. |

**CSS ceiling:** zero bytes. `wrangler.toml`, `worker/`, `scripts/` and `src/test/` are outside the content glob.

**If this task is wrong:** the whole site goes down at once — a blank page from the API-shaped CSP, an infinite loop from the shell subrequest, or assets served as HTML — and the rollback is `routes` back to two entries and one `npx wrangler deploy`, which takes about ninety seconds.

---

# Tier 3 — The property everything after this depends on

## Task 13: The D1-unreachable contract, written down and then induced

**The spec requires this and Tier 4 rests on it.** It is a task rather than a note because *"the site degrades to slightly stale rather than blank"* is a claim, and a claim about a failure mode nobody has induced is a guess. It is placed here — after the read path is live and **before** any content moves — because that is the ordering in which the answer is worth having.

**The contract, stated before it is tested, with a row per layer and two honest negatives.**

| Layer | D1 up | D1 down |
|---|---|---|
| **Photographs and menu PDFs** | R2 custom domain | R2 custom domain — **completely unaffected.** No image request passes through the Worker, so D1 is not on the path at all. `e2e/d1-unreachable.spec.ts` asserts this rather than assuming it. |
| The page shell | Pages, fetched live | Pages, fetched live — unaffected. |
| The content island | the D1 rows for every path in `D1_ONLY_PATHS` | **empty.** Decision D0's condition (b): the browser renders its own compiled bundle, which the weekly export refreshes on a Pages build and which is therefore never staler than the Worker's floor. |
| The browser's rendered page | live rows over the compiled bundle | **the compiled bundle alone — stale, never blank.** |
| The crawl block | the menu from the D1 rows | **the menu from `worker/snapshot.ts`.** Condition (a) without (b): a non-JS crawler has no compiled bundle, so the floor is the best available answer rather than a stale one. |
| `GET /api/published` — edge cache hit | served from cache | **NOT served from cache.** ⚠ `handlePublished` calls `store.version(path)` FIRST and needs its answer to build the cache key, so a D1 failure loses the cache hit as well as the body: every request falls through to the snapshot and none is served from the edge. That is the correct trade — a version-less cache key cannot be invalidated by a publish — and it is written down here rather than discovered. What it costs during an outage is a compiled-in string lookup with no I/O per request, which is cheap. What it does not cost is correctness. |
| `GET /api/published` — miss | the D1 body | the snapshot, `x-content-source: snapshot` |
| `/blog/<slug>` server render | D1 via `lookupPost` | the snapshot, via the same fallback |
| `story` on the About page | live row, first-painted from the island | the compiled copy `OurStory.tsx` seeds from |
| `posts` on `/blogs` | live row | the compiled copy, same seed-then-replace shape |
| **`awards`** | live row | ⚠ **nothing, if `/api/published` itself is unreachable.** `awards.json` has **no compiled copy in the browser bundle at all** — it has never been a file in this repository — and `fetchAwards` throws on a non-ok response rather than degrading. The Worker's snapshot covers a D1 outage (it answers 200 with the floor), so the section survives that; what it does not survive is the Worker being unreachable. **This is the one document with no client-side floor, and it is the one whose absence is least visible.** An empty list would render as "this restaurant has won nothing", which is a false statement; the panel's own error state is a true one. Recorded, not fixed: fixing it means giving `awards.json` a compiled copy, which is a document this repository deliberately does not hold. |

**Files:**
- Create: `worker/__tests__/d1-unreachable.test.ts`
- Create: `e2e/d1-unreachable.spec.ts`
- Create: `docs/d1-unreachable.md`
- Modify: `worker/published.ts` (one comment, no behaviour)

**Interfaces:**

- Consumes: `FakeD1`'s existing `failWith` / `failAfter`, which already exist for exactly this; an authenticated `npx wrangler` for the production drill; the `x-content-source` header `worker/site-page.ts` already sets.
- Produces: **no new function and no signature change anywhere.** What this task produces is a written contract (`docs/d1-unreachable.md`, the table above verbatim) and the tests that fail if it stops holding. `worker/published.ts` gains one comment and no behaviour.

```ts
// The one code change in this task, and it is a comment:
// worker/published.ts, above `store.version(path)` -- recording that a D1
// failure costs the edge-cache hit as well as the body.
```

- [ ] **Step 1: Induce the failure at every layer, in the Worker suite**

```ts
// worker/__tests__/d1-unreachable.test.ts
import { describe, it, expect } from 'vitest';
import worker from '../index';
import { FakeD1, asD1 } from './fakeD1';
import { snapshotFor } from '../snapshot';
import { baseEnv, ctx } from './helpers';

function brokenD1(failAfter = 0) {
  const fake = new FakeD1();
  fake.failWith = 'D1_ERROR: Network connection lost';
  fake.failAfter = failAfter;
  return { fake, env: { ...baseEnv(), DB: asD1(fake) } };
}

describe('when D1 is unreachable', () => {
  it('serves posts.json from the compiled floor rather than an error', async () => {
    const response = await worker.fetch(new Request('https://x/api/published?path=posts.json'), brokenD1().env, ctx());
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-source')).toBe('snapshot');
    const posts = (await response.json()) as unknown[];
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
  });

  it('serves the body byte-identically to the recorded snapshot', async () => {
    const response = await worker.fetch(new Request('https://x/api/published?path=story.json'), brokenD1().env, ctx());
    expect(await response.text()).toBe(snapshotFor('story.json'));
  });

  it('still renders a blog post page for a crawler', async () => {
    const response = await worker.fetch(
      new Request('https://x/blog/bw-hotelier-regional-flair', { headers: { Accept: 'text/html' } }),
      brokenD1().env, ctx());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Regional Italian Flair');
  });

  it('never returns a 5xx for a content read', async () => {
    for (const path of ['story.json', 'posts.json', 'awards.json']) {
      const response = await worker.fetch(new Request(`https://x/api/published?path=${path}`), brokenD1().env, ctx());
      expect(response.status, path).toBeLessThan(500);
    }
  });

  // handlePublished calls store.version() and THEN store.read(). A fallback
  // that only covered the first would 500 on the second, and the shape of that
  // bug is invisible unless the two are failed separately -- which is precisely
  // what FakeD1's failAfter exists for.
  it('reads D1 twice and survives each failure independently', async () => {
    const response = await worker.fetch(new Request('https://x/api/published?path=posts.json'), brokenD1(1).env, ctx());
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-source')).toBe('snapshot');
  });

  it('serves the homepage with an empty island and a crawl block from the floor', async () => {
    const response = await worker.fetch(new Request('https://x/'), brokenD1().env, ctx());
    expect(response.status).toBe(200);
    const html = await response.text();
    // D0 condition (b): nothing in the island, so the browser uses its own
    // compiled bundle rather than a floor that could be older.
    expect(html).toContain('id="vb-content">{}</script>');
    expect(response.headers.get('x-content-source')).toContain('floor');
  });
});
```

- [ ] **Step 2: Record the one place the contract is weaker than it reads**

Above `store.version(path)` in `worker/published.ts`:

```ts
// THE VERSION READ COMES FIRST AND THE CACHE KEY IS BUILT FROM IT, which means
// a D1 outage costs the cache hit as well as the body: every request falls
// through to the snapshot and none of them is served from the edge. That is the
// correct trade and it is stated here rather than discovered later. The
// alternative -- a version-less cache key -- cannot be invalidated by a
// publish, and the whole promise of this migration is that a publish is visible
// immediately.
//
// What it costs during an outage: every request runs the snapshot path, which
// is a compiled-in string lookup with no I/O. That is cheap. What it does NOT
// cost is correctness: the floor is what is served, and it is the same bytes
// for every visitor.
```

- [ ] **Step 3: Prove it in a real browser, on the real page**

```ts
// e2e/d1-unreachable.spec.ts
//
// The Worker suite can prove the fallback chain. It cannot prove that what
// reaches the SCREEN is a page with words on it -- that a component seeded from
// the compiled bundle actually renders when its live read fails, and does not
// blank, spin forever, or throw into an error boundary.
import { test, expect } from '@playwright/test';

test('the About section still has the chef story when every live read fails', async ({ page }) => {
  await page.route('**/api/published**', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /about/i }).first()).toBeVisible();
  await expect(page.getByText(/Welcome to Via Bianca/)).toBeVisible();
});

test('the blog index still lists posts when every live read fails', async ({ page }) => {
  await page.route('**/api/published**', (route) => route.abort('failed'));
  await page.goto('/blogs');
  await expect(page.getByRole('link', { name: /Regional Italian Flair/ }).first()).toBeVisible();
});

test('the menu still renders when every live read fails', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/');
  // A dish name read out of the compiled bundle. Deliberately not compared
  // against a constant this test also produced -- it is read from the JSON file
  // on disk, which is the same file the bundle compiled.
  const dishes = JSON.parse(require('node:fs').readFileSync('src/content/dishes.json', 'utf8'));
  await expect(page.getByText(dishes[0].name).first()).toBeVisible();
});

// The property Tier 1 bought, proven rather than assumed: an image request does
// not touch the Worker, so it does not touch D1. If a later task ever routes
// images through the Worker, this is what says so.
test('every photograph still paints when every API call fails', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/', { waitUntil: 'networkidle' });
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll('img')].filter((i) => i.getAttribute('src') && i.naturalWidth === 0).length,
  );
  expect(broken).toBe(0);
});

test('no image request goes through an /api path', async ({ page }) => {
  const images: string[] = [];
  page.on('request', (request) => { if (request.resourceType() === 'image') images.push(request.url()); });
  await page.goto('/', { waitUntil: 'networkidle' });
  expect(images.length).toBeGreaterThan(0);
  expect(images.filter((url) => url.includes('/api/'))).toEqual([]);
});
```

- [ ] **Step 4: Induce it in PRODUCTION, once, deliberately, at a quiet hour**

Unit tests use `FakeD1`, which fails by throwing. **A real unreachable D1 fails differently — a timeout, not a throw — and only the drill covers that.**

```
cp wrangler.toml /tmp/wrangler.real.toml
sed -i '' 's/database_id = "7ec61770-4fb1-4458-9c34-46b92bb9702c"/database_id = "00000000-0000-4000-8000-000000000000"/' wrangler.toml
npx wrangler deploy
```

Then, within two minutes:

```
curl -sSI https://viabiancarestaurant.com/ | grep -i x-content-source              # floor; d1=0/3; floor=<ts>
curl -sS  https://viabiancarestaurant.com/ -o /dev/null -w '%{http_code}\n'        # 200
curl -sS  https://viabiancarestaurant.com/ | grep -c 'id="vb-content">{}</script>' # 1 -- the island is EMPTY
curl -sS  https://viabiancarestaurant.com/api/published?path=posts.json | head -c 80
```

Open the homepage, `/blogs` and one standalone page in a browser. **Every page must render, with photographs, from the compiled bundle.** Then restore immediately:

```
cp /tmp/wrangler.real.toml wrangler.toml
npx wrangler deploy
curl -sSI https://viabiancarestaurant.com/ | grep -i x-content-source              # d1; d1=3/3
```

- [ ] **Step 5: Write the contract down where an operator will find it**

`docs/d1-unreachable.md`: the table above verbatim, the tests that hold each row, the two ⚠ negatives spelled out, the drill's timestamps and readings, and **what to actually do during an outage — nothing.** The floor serves. The one real risk is publishing *into* an outage, which `handlePublish` refuses with a 502 rather than silently dropping.

- [ ] **Step 6: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/d1-unreachable.test.ts && npx playwright test e2e/d1-unreachable.spec.ts`**

- [ ] **Step 7: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| in `worker/published.ts`, remove the `try`/`catch` around `store.read` | "reads D1 twice and survives each failure independently" | — |
| remove the `try`/`catch` around `store.version` | "serves posts.json from the compiled floor rather than an error" | — |
| make `snapshotFor` return `null` for every file | "serves the body byte-identically to the recorded snapshot" and "never returns a 5xx" | — |
| set `failAfter = 0` in the two-read test | that test must still pass, **and the "remove the `store.read` catch" row above must then STOP reddening** | If it still reddens with `failAfter = 0`, the test is not isolating the second read and its name is a claim it cannot support. |
| in `readBundle`, remove the floor loop | Step 4's live drill — pages render empty with D1 unbound | Do not skip Step 4 on the strength of the unit tests. A real unreachable D1 times out rather than throwing, and only the drill covers that. |
| in `OurStory.tsx`, seed `useState(null)` instead of `useState(content.story)` | e2e "the About section still has the chef story…" | This is the one jsdom cannot catch and the browser can. |
| in `post-lookup.ts`, remove the snapshot fallback | "still renders a blog post page for a crawler" | — |
| route images through a Worker path | e2e "no image request goes through an /api path" | — |
| in `islandDocuments`, drop condition (b) | "serves the homepage with an empty island and a crawl block from the floor" | — |

**CSS ceiling:** zero bytes.

**If this task is wrong:** a D1 outage takes the About section, the blog and the awards down together, and the first anyone knows is a blank section on a live restaurant's homepage. The photographs stay up either way, which is Tier 1's doing.

---

# Tier 4 — Content into D1, four then two then one then two

Every task in this tier is the same five moves, stated once here rather than four times:

**seed the row with the exact committed bytes → verify the stored SHA-256 → add the path to `D1_ONLY_PATHS` → `npx wrangler deploy` → publish once from the dashboard and watch it appear.**

The read path makes the first three invisible: a document with no row is answered from the floor, the floor **is** the committed file, and the committed file **is** what the GitHub publish path just wrote. Seeding makes the row byte-identical to the floor. **There is no instant at which any read is wrong.**

And decision D0 makes the fourth move the one that matters: the flip is what makes the Worker start speaking for that document, and therefore what puts it in the island. Before the flip, the compiled bundle answers. After it, the D1 row does. The two are byte-identical at the moment of the flip, so nobody sees a change until she publishes.

## Task 14: The seeding ritual, and the four documents whose SEO matters least

**Files:**
- Create: `scripts/seed-content.mjs`
- Create: `worker/__tests__/seed-parity.test.ts`
- Modify: `worker/store.ts` (`D1_ONLY_PATHS` gains four paths), `worker/d1.ts` (`export` on `sha256Hex`)
- Modify: `worker/__tests__/store.test.ts`
- Modify: `package.json` (add `seed:content`)

**Interfaces:**

```js
// scripts/seed-content.mjs
export function sha256Hex(text);       // the same hash worker/d1.ts computes
export function sqlFor(path, body, sha);
```

- [ ] **Step 1: The seeder, which verifies before it exits 0**

```js
// scripts/seed-content.mjs
//
// Puts a content document into D1 with the exact bytes the repository holds,
// then reads back what D1 stored and compares SHA-256 AND byte length. Exits
// non-zero on any mismatch, so a half-written seed can never be mistaken for a
// finished one.
//
// WHY THE VERIFY IS THE POINT. The body is a JSON document full of quotes,
// newlines and apostrophes going into a SQL literal through wrangler's command
// line. The escaping below is done properly, but "done properly" is a claim,
// and the round trip is what turns it into evidence. That matters more here
// than almost anywhere in this plan: a body that arrives with one apostrophe
// mangled parses fine, renders fine on the page it appears on, and is wrong
// forever.
//
// ON CONFLICT DO NOTHING, deliberately: this script never overwrites a row that
// already exists. Seeding is a one-way, one-time move per document, and a
// re-run must be a no-op rather than a silent revert of everything she has
// published since.
//
//   node scripts/seed-content.mjs copy.json sections.json galleries.json experiences.json
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DB = 'via-bianca-content';

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Single quotes doubled, which is SQLite's own escape and the only one it has.
// Newlines, apostrophes and backslashes all survive a doubled-quote literal
// unchanged -- SQLite does not process backslash escapes inside string literals
// at all, which is exactly why this is safe and why a JavaScript-style escape
// here would corrupt every \n in the document.
function literal(text) {
  return `'${text.replaceAll("'", "''")}'`;
}

export function sqlFor(path, body, sha) {
  return `INSERT INTO content (path, body, sha, version, updated_at) ` +
    `VALUES (${literal(path)}, ${literal(body)}, ${literal(sha)}, 1, ${Date.now()}) ` +
    `ON CONFLICT(path) DO NOTHING;`;
}

function execute(sql) {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', `--command=${sql}`],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

if (import.meta.filename === process.argv[1]) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node scripts/seed-content.mjs <file.json> [more.json ...]');
    process.exit(2);
  }

  const wanted = new Map();
  for (const file of files) {
    const body = readFileSync(join('src', 'content', file), 'utf-8');
    // Parsed here ONLY to fail early on a malformed document. The BODY that
    // goes to D1 is the exact text, never a re-serialisation: worker/d1.ts's
    // sha is a hash OF that text and the two must not be able to disagree.
    JSON.parse(body);
    const path = 'src/content/' + file;
    wanted.set(path, { body, sha: sha256Hex(body) });
    execute(sqlFor(path, body, wanted.get(path).sha));
    console.log(`seeded ${path}`);
  }

  const list = [...wanted.keys()].map((p) => `'${p}'`).join(',');
  const rows = JSON.parse(execute(`SELECT path, sha, version, length(body) AS len FROM content WHERE path IN (${list})`))[0].results;

  let bad = 0;
  for (const [path, expected] of wanted) {
    const row = rows.find((r) => r.path === path);
    const bytes = Buffer.byteLength(expected.body, 'utf8');
    if (!row) { console.error(`MISSING  ${path}`); bad += 1; continue; }
    if (row.sha !== expected.sha) { console.error(`SHA MISMATCH  ${path}: stored ${row.sha}, expected ${expected.sha}`); bad += 1; continue; }
    if (row.len !== bytes) { console.error(`LENGTH MISMATCH  ${path}: stored ${row.len}, expected ${bytes}`); bad += 1; continue; }
    console.log(` ok  ${path}  sha=${row.sha.slice(0, 12)}  version=${row.version}`);
  }

  if (bad > 0) {
    console.error(`\n${bad} document(s) did not round-trip. DO NOT add them to D1_ONLY_PATHS.`);
    process.exit(1);
  }
  console.log(`\n${wanted.size} document(s) verified byte-identical in D1`);
}
```

**A note on the hash.** `worker/d1.ts`'s `sha256Hex` hashes with the Web Crypto API and lowercase hex; Node's `createHash('sha256').update(text, 'utf8').digest('hex')` produces the identical string for the identical bytes. Step 3 **proves** that rather than assuming it, because a mismatch means every conditional publish afterwards reports "someone else changed this while you were editing" on a document nobody touched. This requires `export` on `worker/d1.ts`'s existing module-level `sha256Hex`; add it in the same commit.

- [ ] **Step 2: `package.json` gains one script**

```json
    "seed:content": "node scripts/seed-content.mjs",
```

- [ ] **Step 3: Prove the two hashes agree, and the escape survives real content**

```ts
// worker/__tests__/seed-parity.test.ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex as nodeSha, sqlFor } from '../../scripts/seed-content.mjs';
import { sha256Hex as workerSha } from '../d1';

const CONTENT_DIR = join(process.cwd(), 'src', 'content');
const files = readdirSync(CONTENT_DIR).filter((n) => n.endsWith('.json'));

describe('the seeder and the Worker agree about what a document hashes to', () => {
  // Over EVERY real document, not a fixture. If these disagreed, the row seeded
  // by the script and the sha the dashboard round-trips as baseSha would
  // differ, and her very next publish would be refused with "someone else
  // changed this while you were editing" on a file nobody touched.
  it.each(files)('%s hashes identically in node and in the Worker', async (file) => {
    const body = readFileSync(join(CONTENT_DIR, file), 'utf-8');
    expect(nodeSha(body)).toBe(await workerSha(body));
  });

  it('doubles single quotes and leaves backslashes and newlines alone', () => {
    expect(sqlFor('src/content/x.json', `a'b\nc\\d`, 'deadbeef')).toContain(`'a''b\nc\\d'`);
  });

  // The real documents carry apostrophes (Spaghetti alla'Assassina) and
  // newlines throughout. A generated statement that cannot be split back into
  // the original text is the corruption this whole check exists for.
  it.each(files)('%s survives the sql escape round trip', (file) => {
    const body = readFileSync(join(CONTENT_DIR, file), 'utf-8');
    const escaped = body.replaceAll("'", "''");
    expect(sqlFor('src/content/' + file, body, 'x')).toContain(escaped);
    expect(escaped.replaceAll("''", "'")).toBe(body);
  });

  it('never overwrites a row that already exists', () => {
    expect(sqlFor('p', 'b', 's')).toContain('ON CONFLICT(path) DO NOTHING');
  });
});
```

- [ ] **Step 4: Seed the four**

```
npm run seed:content -- copy.json sections.json galleries.json experiences.json
```

Expected: four ` ok ` lines and `4 document(s) verified byte-identical in D1`. **Nothing about the live site has changed** — those four have rows whose bytes equal the floor, the Worker does not yet speak for them, and `readBundle` returns exactly what it returned before with a different `stamp`.

- [ ] **Step 5: Confirm the site is unchanged BEFORE flipping the store**

```
curl -sSI https://viabiancarestaurant.com/ | grep -i x-content-source   # d1; d1=3/3; floor=<ts>
curl -sS  https://viabiancarestaurant.com/ | grep -o 'id="vb-content">{[^<]*' | head -c 200
npm run verify:deploy
```

**`d1=3/3` and an island still carrying only awards/story/posts is the expected reading and the whole point of this step:** D1 is now answering for four more documents, the site is identical, the island has not grown, and no write path has moved.

- [ ] **Step 6: Flip the store**

```ts
// worker/store.ts, added to D1_ONLY_PATHS
  // 2026-08-21 migration, first batch. The four documents whose SEO matters
  // least, moved first because the read path is new and a mistake here costs
  // microcopy and section ordering rather than the menu.
  //
  // Each was seeded with the exact committed bytes and verified byte-identical
  // by scripts/seed-content.mjs BEFORE this line was written, which is what
  // makes the flip invisible: worker/content-bundle.ts answers a document with
  // no row from the compiled floor, the floor is the committed file, and the
  // committed file is what the GitHub publish path had just written -- so the
  // row and the floor were the same bytes at the moment this changed.
  //
  // ADDING A PATH HERE IS ALSO WHAT PUTS IT IN THE CONTENT ISLAND (decision
  // D0). Before this line the Worker said nothing about these four and the
  // compiled bundle rendered them; after it the D1 row does. That is the same
  // edit, deliberately: the Worker is entitled to speak for a document exactly
  // when the row IS the live copy, and not one moment earlier.
  //
  // The committed files stay. They are what worker/snapshot.ts is built from,
  // what a fresh clone builds, what the browser renders when D1 is unreachable,
  // and what src/content/__tests__/assets.test.ts walks -- which is the only
  // thing guarding galleries.json's twenty-five image references, since that
  // walk cannot see D1 at all.
  'src/content/copy.json',
  'src/content/sections.json',
  'src/content/galleries.json',
  'src/content/experiences.json',
```

```ts
// worker/__tests__/store.test.ts
  it.each([
    'src/content/awards.json', 'src/content/story.json', 'src/content/posts.json',
    'src/content/copy.json', 'src/content/sections.json', 'src/content/galleries.json', 'src/content/experiences.json',
  ])('%s is written to D1 whatever CONTENT_STORE says', (path) => {
    expect(storeFor({ ...ENV, CONTENT_STORE: 'github' }, path).name).toBe('d1');
  });

  // The documents NOT yet moved, pinned as a group so a later batch is a
  // deliberate edit to this list rather than a line that quietly appeared.
  it.each(['src/content/site.json', 'src/content/dishes.json', 'src/content/drinks.json',
    'src/content/menus.json', 'src/content/pages.json'])('%s is still written to GitHub', (path) => {
    expect(storeFor({ ...ENV, CONTENT_STORE: 'github' }, path).name).toBe('github');
  });

  // Every path in D1_ONLY_PATHS must be one worker/content-bundle.ts actually
  // reads, or a publish would write somewhere no page looks.
  it('every D1-only path is one the read path knows about', () => {
    for (const path of D1_ONLY_PATHS) expect(BUNDLE_PATHS).toContain(path);
  });
```

- [ ] **Step 7: `npx tsc -b --noEmit && npm test -- --run worker/__tests__/store.test.ts worker/__tests__/seed-parity.test.ts worker/__tests__/content-bundle.test.ts worker/__tests__/site-page.test.ts && npm run gate && npx wrangler deploy`**

`content-bundle.test.ts` and `site-page.test.ts` are in that list because `D1_ONLY_PATHS` is their input: the island tests read it, and this task changed it.

- [ ] **Step 8: Publish once, from the dashboard, and time it**

Open `/edit/manage`, change one word of microcopy, press Publish. **The bar must go straight to success with no build polling at all** — `requestPublish` returns `sha: null` when no commit was made, and `PublishBar` treats that as done. Reload the public page and confirm the word changed. Then:

```
curl -sSI https://viabiancarestaurant.com/ | grep -i x-content-source   # d1; d1=7/7
```

**This is the first time in this plan that a publish has not deployed the site.** Write the elapsed time in `docs/cloudflare-cutover.md` next to the "usually takes about 2-3 minutes" sentence it replaces.

- [ ] **Step 9: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| change `sha256Hex` in the seeder to `md5` | "%s hashes identically in node and in the Worker" | — |
| change `literal` to wrap in double quotes | "doubles single quotes and leaves backslashes and newlines alone" | — |
| change `literal` to escape with a backslash instead of doubling | "%s survives the sql escape round trip" | — |
| drop `ON CONFLICT(path) DO NOTHING` | "never overwrites a row that already exists" | — |
| remove `'src/content/copy.json'` from `D1_ONLY_PATHS` | "copy.json is written to D1 whatever CONTENT_STORE says", and `site-page.test.ts`'s island-membership count | — |
| add `'src/content/press.json'` to `D1_ONLY_PATHS` | "every D1-only path is one the read path knows about" | — |
| delete the read-back verification block from the seeder | seed a document, hand-corrupt the row with `wrangler d1 execute`, re-run; it must exit 1 the second time | Procedural. If a corrupt row exits 0, the flip in Step 6 has no evidence behind it and this whole tier's atomicity claim is void. |
| flip the store in Step 6 **without** running Step 4's seed | Step 5's `x-content-source` reads `mixed` with a document missing from the island, and `verify:deploy`'s island check reports it missing | The ordering is the atomicity argument. If the checks pass with an unseeded flip, the island membership check is not reading `worker/store.ts`. |

**CSS ceiling:** zero bytes.

**If this task is wrong:** she publishes a microcopy change, it writes to D1, and the page keeps showing the old word — because the row and the floor disagree and the read path picked the wrong one.

---

## Task 15: `pages.json` and `menus.json`

Two documents with real SEO: `pages.json` drives six standalone routes and `menus.json` names the two PDFs. Same ritual, and **one new thing to check — `pages.json` in D1 is the first document whose content can create a URL that did not exist at deploy time**, which is the case decision D1 widened the route to `/*` for.

**Files:**
- Modify: `worker/store.ts`, `worker/__tests__/store.test.ts`
- Create: `worker/__tests__/site-page.pages.test.ts`
- Modify: `scripts/verify-deploy.mjs` (the route list read from the island)

**Interfaces:**

```ts
// worker/store.ts -- D1_ONLY_PATHS gains two entries. No signature changes.
export const D1_ONLY_PATHS: ReadonlySet<string>;
```

```js
// scripts/verify-deploy.mjs -- the hardcoded ROUTES constant is REPLACED by a
// function, because pages.json now lives in D1 and a list in this file cannot
// see a page she added from the dashboard.
const FIXED_ROUTES = ['/', '/blogs', '/edit'];
async function routesToBrowse();   // -> string[], read from the live island
```

- [ ] **Step 1: Seed and verify**

```
npm run seed:content -- pages.json menus.json
curl -sSI https://viabiancarestaurant.com/ | grep -i x-content-source   # still d1=7/7, page identical
```

- [ ] **Step 2: Make `verify-deploy.mjs` read its route list from the live site**

`ROUTES` in that script is a hardcoded list of paths. Once `pages.json` is in D1 that list is a copy of a document it cannot see, so a page she adds is checked by nothing.

```js
// The routes to browse, read from the LIVE content island rather than from a
// list in this file. pages.json lives in D1 now, so a page she added from the
// dashboard exists on the site and in no file here -- a hardcoded list would
// silently stop covering the newest page, which is exactly the page most likely
// to be broken.
//
// The three fixed entries are the ones no document controls: the homepage, the
// blog index, and the admin route.
const FIXED_ROUTES = ['/', '/blogs', '/edit'];

async function routesToBrowse() {
  const html = await (await get('/')).text();
  const match = html.match(/<script type="application\/json" id="vb-content">([\s\S]*?)<\/script>/);
  const island = match ? JSON.parse(match[1].replaceAll('\\u003c', '<')) : null;
  if (!island || typeof island['pages.json'] !== 'string') {
    // NOT a throw. A verifier that cannot run when the thing it verifies is
    // absent cannot tell you the thing is absent.
    console.log('  no pages.json in the content island -- browsing the fixed routes only');
    return FIXED_ROUTES;
  }
  const slugs = JSON.parse(island['pages.json']).filter((p) => p.enabled !== false).map((p) => '/' + p.slug);
  console.log(`  browsing ${FIXED_ROUTES.length + slugs.length} routes, ${slugs.length} of them from the live pages document`);
  return [...FIXED_ROUTES, ...slugs];
}
```

Use `await routesToBrowse()` where the chromium pass currently iterates `ROUTES`.

- [ ] **Step 3: Flip the store**

```ts
  // 2026-08-21 migration, second batch. Real SEO on both.
  //
  // pages.json is the reason wrangler.toml's route pattern is /* rather than an
  // enumerated list: from this line onward she can add a standalone page from
  // the dashboard, instantly, and that page's URL has to be answered by this
  // Worker with the island in it. A route list written at deploy time could not
  // know the URL existed.
  'src/content/pages.json',
  // menus.json names the two PDFs. Moving this document's STORAGE does not move
  // the PDFs themselves -- that is Task 19, which takes them and the last
  // upload path that writes a commit together.
  'src/content/menus.json',
```

- [ ] **Step 4: A test for the case this batch introduces**

```ts
// worker/__tests__/site-page.pages.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FakeD1, asD1 } from './fakeD1';
import { handleSitePage } from '../site-page';

const SHELL = readFileSync('index.html', 'utf-8');
const noCache = (): Cache =>
  ({ match: async () => undefined, put: async () => undefined, delete: async () => false }) as unknown as Cache;

describe('a page that exists only in D1', () => {
  // The whole reason the route pattern is /*. A slug that appears in no file in
  // this repository must still be answered with an island containing it.
  it('is answered with an island carrying the page she just added', async () => {
    const fake = new FakeD1();
    const pages = JSON.stringify([{ id: 'new', slug: 'private-dining', title: 'Private Dining', enabled: true, sections: [] }]);
    fake.content.set('src/content/pages.json', { path: 'src/content/pages.json', body: pages, sha: 'x', version: 7, updated_at: 0 });
    const response = await handleSitePage(
      new Request('https://viabiancarestaurant.com/private-dining'),
      { DB: asD1(fake), PAGES_ORIGIN: 'https://vb-c7r.pages.dev' },
      noCache(),
      (async () => new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html' } })) as unknown as typeof fetch,
    );
    const body = await response.text();
    expect(body).toContain('private-dining');
    // And it is inside the ISLAND, not merely somewhere in the shell.
    const island = JSON.parse(body.match(/id="vb-content">([\s\S]*?)<\/script>/)![1].replaceAll('\\u003c', '<'));
    expect(island['pages.json']).toContain('private-dining');
  });
});
```

- [ ] **Step 5: `npm run gate && npx wrangler deploy && npm run verify:deploy`**

- [ ] **Step 6: Add a page from the dashboard and open its URL**

This is the step the whole `/*` decision exists for and it is verified by hand, once. Add a page at `/edit/manage`, publish, and open `https://viabiancarestaurant.com/<its-slug>` **in a browser and with `curl`**. The curl response must contain the slug inside the island. Then delete the page and publish again.

- [ ] **Step 7: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| remove `'src/content/pages.json'` from `D1_ONLY_PATHS` | "pages.json is written to D1 whatever CONTENT_STORE says" and the island-membership count in `site-page.test.ts` | — |
| drop `pages.json` from `BUNDLE_PATHS` | "is answered with an island carrying the page she just added" | — |
| revert `routesToBrowse` to the hardcoded `ROUTES` | Step 6, run after adding a page in D1: the new page is not browsed and the log line reports only three routes | Procedural, and the reason Step 6 is done by hand once. If the count does not exceed three, the island read is not working. |
| have `routesToBrowse` throw instead of returning `FIXED_ROUTES` when there is no island | run `verify:deploy` against a deploy with the Worker route reverted; it must still complete | A verifier that cannot run when the thing it verifies is absent cannot tell you the thing is absent. |

**CSS ceiling:** zero bytes.

**If this task is wrong:** she adds a page from the dashboard, it publishes instantly, and its URL renders the site's own 404 — which looks like the page was never saved.

---

## Task 16: `site.json`, and the stale read that has to be fixed first

`site.json` carries the address, the phone numbers, the hours, the socials and `seo.url`. It is the highest-risk single document in this plan and it has a **known, documented, currently-harmless bug waiting for it**: `handlePublish`'s step 5 falls back to `getFileContent(env, siteFile.path)` — a direct GitHub read — instead of `storeFor(...).read(...)` when `currentByPath` has no entry. That is harmless only because `site.json` is not D1-backed. The moment it is, the developer-owned-field ownership check compares her new document against a GitHub copy that has stopped being updated, and either passes a change it should refuse or refuses one it should pass, **with nothing failing.** The fix ships **before** the flip, in that order, in this task.

**Files:**
- Modify: `worker/index.ts` (`handlePublish` step 5), `worker/__tests__/index.test.ts`
- Modify: `worker/post-seo.ts`, `worker/__tests__/post-seo.test.ts`
- Modify: `worker/store.ts`, `worker/__tests__/store.test.ts`

**Interfaces:**

```ts
// worker/index.ts -- handlePublish's step 5 changes ONE expression. Its
// signature and its response shapes are untouched.
//   before: currentByPath.get(path) ?? await getFileContent(env, path)
//   after:  currentByPath.get(path) ?? await storeFor(env, path).read(path)

// worker/post-seo.ts -- the static import of src/content/site.json is REPLACED
// by a module-scope constant read from the compiled floor.
const SITE_SEO_URL: string;
```

- [ ] **Step 1: Fix the stale read**

```ts
    // storeFor, never getFileContent directly. This line read GitHub
    // unconditionally until site.json moved to D1, at which point that read
    // returned the last GITHUB copy -- frozen at the migration -- and the
    // developer-owned-field check below would have compared her new document
    // against a snapshot months old. Routing through storeFor means this
    // fallback asks whichever store actually holds the document, exactly as
    // step 3's baseSha read already does.
    const current =
      currentByPath.get(siteFile.path) ?? (await storeFor(env, siteFile.path).read(siteFile.path)) ?? undefined;
```

If `getFileContent` now has no other caller in `worker/index.ts`, **`noUnusedLocals` makes the leftover import a hard build failure** — remove it in the same edit.

- [ ] **Step 2: A test that proves the read follows the store**

```ts
  // The ownership check must compare against whichever store holds site.json,
  // not against GitHub unconditionally.
  it('reads the current site.json from D1 when site.json is D1-backed', async () => {
    const fake = new FakeD1();
    fake.content.set('src/content/site.json', {
      path: 'src/content/site.json',
      body: JSON.stringify({ ...REAL_SITE, name: 'From D1' }),
      sha: 'd1-sha', version: 3, updated_at: 0,
    });
    const stub = makeGitHubStub({ contents: {} });
    const response = await worker.fetch(
      publishRequest([{ path: 'src/content/site.json', content: JSON.stringify({ ...REAL_SITE, name: 'Changed' }), encoding: 'utf-8' }]),
      { ...envWith(stub), DB: asD1(fake) }, ctx,
    );
    expect(response.status).toBe(200);
    // THE DECISIVE ASSERTION: no GitHub read for site.json happened at all. A
    // test that only checked the status would pass on the stale-read version
    // too, because the stale read also returns something parseable.
    expect(stub.calls.some((call) => call.url.includes('src/content/site.json'))).toBe(false);
  });
```

- [ ] **Step 3: Deal with `post-seo.ts`'s second, unguarded copy**

`worker/post-seo.ts:14` does `import site from '../src/content/site.json'` — a second, independent, unvalidated compiled copy, used only for `site.seo.url` as the canonical host. Once `site.json` is in D1, that copy freezes. `seo.url` changes roughly never, so freezing it is nearly harmless — but "nearly" is not a thing to leave undocumented.

```ts
// The canonical host. Read from the compiled floor rather than from a direct
// import of src/content/site.json, because that document's live copy is in D1
// now and a static import would freeze at whatever the file said on the day it
// moved -- which is a different frozen copy from the floor, refreshed on a
// different schedule, for no reason.
//
// NOT read from D1 per request: this is one field, it is the site's own
// hostname, it changes roughly never, and putting a database read in front of
// every post's canonical tag to track a value that does not move would be a
// cost with no benefit. The floor is refreshed by scripts/export-content.mjs
// and reaches production on the next Worker deploy, which is the right cadence
// for a hostname.
import { snapshotFor } from './snapshot';

const SITE_SEO_URL: string = (() => {
  // A floor with no site.json is a build problem, not a runtime one --
  // worker/__tests__/snapshot.test.ts fails first. The fallback exists so a
  // malformed floor degrades one meta tag rather than throwing at module scope,
  // which would take the whole Worker down on cold start for every route.
  try {
    return (JSON.parse(snapshotFor('site.json') ?? '{}') as { seo?: { url?: string } }).seo?.url
      ?? 'https://viabiancarestaurant.com';
  } catch {
    return 'https://viabiancarestaurant.com';
  }
})();
```

- [ ] **Step 4: Seed, verify, flip**

```
npm run seed:content -- site.json
curl -sSI https://viabiancarestaurant.com/ | grep -i x-content-source   # still d1=9/9 before the flip
```

```ts
  // 2026-08-21 migration, third batch, alone. The address, the phone numbers,
  // the hours and seo.url.
  //
  // handlePublish's step 5 was fixed to read through storeFor BEFORE this line
  // was added, and the order was not optional: that step falls back to a direct
  // GitHub read when currentByPath has no entry, and against a D1-backed
  // site.json it would have compared her new document to a GitHub copy frozen
  // at the moment of this migration -- passing changes it should refuse,
  // refusing changes it should pass, with nothing failing.
  //
  // worker/post-seo.ts's second, independent import of this document was moved
  // to the floor in the same commit, for the same reason.
  'src/content/site.json',
```

- [ ] **Step 5: `npm run gate && npx wrangler deploy && npm run verify:deploy`**

- [ ] **Step 6: Change the hours from the dashboard and read them off the live page**

The hours block renders from `site.json` in three places (the footer, the visit section, and the structured data). Change the closing time, publish, and check all three on the live site plus:

```
curl -sS https://viabiancarestaurant.com/ | grep -o '"closes":"[^"]*"'
curl -sS https://viabiancarestaurant.com/blog/<a real slug> | grep -o '<link rel="canonical"[^>]*>'
```

Then change it back.

- [ ] **Step 7: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| revert step 5 to `getFileContent(env, siteFile.path)` | "reads the current site.json from D1 when site.json is D1-backed" | — |
| keep `storeFor` but drop the `stub.calls` assertion from the new test | run the mutation above; the test stays green on the status alone | **This is why the assertion is on the calls, not the status.** If the calls assertion is ever removed, the test cannot fail on the bug it was written for. |
| remove `'src/content/site.json'` from `D1_ONLY_PATHS` | "site.json is written to D1 whatever CONTENT_STORE says" | — |
| in `post-seo.ts`, hardcode `SITE_SEO_URL` to a different host | `worker/__tests__/post-seo.test.ts`'s canonical assertions and the SEO check in `verify:deploy` | — |
| make `SITE_SEO_URL`'s IIFE throw instead of catching | every test in `post-seo.test.ts`, because the module fails at import | Confirms the catch is load-bearing: a throw at module scope takes the Worker down on cold start for every route, not just post pages. |

**CSS ceiling:** zero bytes.

**If this task is wrong:** the restaurant's address, phone number or opening hours are wrong on the live site and in its structured data — the single most expensive kind of wrong a restaurant website can be.

---

## Task 17: `drinks.json` and `dishes.json` — the menu, last

The spec's ordering, honoured: *"one content type at a time … starting with the one whose SEO matters least and ending with the menu."* Everything the menu needs has been live and proven for five tasks: the read path, the cache, the floor, the island, the crawler renderer and the deploy verifier.

**This is also the task that makes the crawler-readable menu exist.** Decision D0 kept the Worker silent about `dishes.json` for as long as Pages was its authority; this line is what makes the Worker the authority, and therefore what puts the menu into the response body for a crawler that runs no JavaScript.

**Files:**
- Modify: `worker/store.ts`, `worker/__tests__/store.test.ts`
- Modify: `worker/__tests__/site-page.test.ts` (the D0 crawl assertion inverts)
- Modify: `scripts/verify-deploy.mjs` (the crawler check becomes unconditional)

**Interfaces:**

```ts
// worker/store.ts -- D1_ONLY_PATHS reaches its final membership: TWELVE paths,
// exactly the twelve src/admin/content.ts's CONTENT_FILES names.
export const D1_ONLY_PATHS: ReadonlySet<string>;
```

**No new function, no new module, no new signature.** This task is two lines in a
Set, one inverted test, one tightened probe in the deploy verifier, and two
assertions that pin the end state from both directions. Everything it switches
on -- `crawlDocuments`, `crawlerMenu`, the `#vb-crawl` reveal rule, the deploy
check -- was built and tested at Tasks 9, 10 and 12 and has been deployed and
silent since.

- [ ] **Step 1: Seed and verify, and confirm the island has not grown yet**

```
npm run seed:content -- drinks.json dishes.json
npm run verify:deploy
curl -sS https://viabiancarestaurant.com/ | grep -c 'id="vb-crawl"'   # still 0
```

Rows exist, the island does not carry them, and there is still no crawl block. That equality — the row and the compiled bundle holding the same bytes at this instant — is what makes the flip safe.

- [ ] **Step 2: Flip the store**

```ts
  // 2026-08-21 migration, final batch: the menu.
  //
  // Last, deliberately, and the spec says why: a restaurant lives on somebody
  // searching its menu. It moves only once the crawler-readable render has been
  // built, tested and deployed for five tasks.
  //
  // THIS LINE IS ALSO WHAT CREATES THE CRAWLER MENU. Decision D0 kept
  // worker/crawler-menu.ts silent while dishes.json was backed by GitHub,
  // because the compiled bundle Pages rebuilds on every publish was the
  // authority and this Worker had no business speaking for it. From here the D1
  // row is the authority, so the Worker renders it into the response body and
  // scripts/verify-deploy.mjs checks every dish name on every deploy.
  'src/content/drinks.json',
  'src/content/dishes.json',
```

At this point `D1_ONLY_PATHS` holds **twelve** paths and `BUNDLE_PATHS` holds twelve.

- [ ] **Step 3: Invert the D0 crawl assertion, in the task that makes it false**

In `worker/__tests__/site-page.test.ts`, replace `'emits no crawl block at all while the menu is still backed by GitHub'` with its inverse. **Replaced, not deleted** — the file still says what the rule is, in both directions.

```ts
  // Was: 'emits no crawl block at all while the menu is still backed by
  // GitHub'. Task 17 flipped dishes.json into D1_ONLY_PATHS, which is exactly
  // what makes the Worker entitled to render the menu. The rule did not change;
  // the input to it did.
  it('renders every dish into the crawl block now that the menu is D1-backed', async () => {
    expect(D1_ONLY_PATHS.has('src/content/dishes.json')).toBe(true);
    const fake = new FakeD1();
    const dishes = JSON.stringify([{ id: 'a', name: 'Corzetti al Pesto', description: 'Hand-stamped.', image: null, tags: [] }]);
    fake.content.set('src/content/dishes.json', { path: 'src/content/dishes.json', body: dishes, sha: 'x', version: 2, updated_at: 0 });
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/'), envWith(fake),
      noCache(), (async () => shellResponse()) as unknown as typeof fetch);
    const body = await response.text();
    expect(body).toContain(CRAWL_ID);
    expect(body).toContain('Corzetti al Pesto');
  });

  // Condition (a) without (b), on the response rather than on the function: a
  // crawler has no compiled bundle, so a D1-backed menu with an unreachable
  // database still gets the floor rather than nothing.
  it('still renders a crawl block from the floor when D1 is unreachable', async () => {
    const fake = new FakeD1();
    fake.failWith = 'D1_ERROR: gone';
    fake.failAfter = 0;
    const response = await handleSitePage(new Request('https://viabiancarestaurant.com/'), envWith(fake),
      noCache(), (async () => shellResponse()) as unknown as typeof fetch);
    const body = await response.text();
    expect(body).toContain(CRAWL_ID);
    // And the island is still empty, so the browser uses its own bundle.
    expect(body).toContain('id="vb-content">{}</script>');
  });
```

- [ ] **Step 4: Make the deploy verifier's crawler check unconditional**

In the block added at Task 12, replace the `else` branch's console line with a failure:

```js
    } else {
      // From Task 17, dishes.json IS in D1_ONLY_PATHS, so its absence from the
      // island is a defect rather than a stage of the migration. The
      // conditional this replaces was correct for exactly five tasks and is
      // gone with them.
      failures.push('dishes.json is not in the content island; the crawler menu cannot be rendered');
    }
```

- [ ] **Step 5: Assert the migration is complete, as a test rather than as a claim**

```ts
  // The end state. Every document the dashboard can edit is on D1; press.json
  // is in neither list because it is compiled-in and not dashboard-editable.
  it('every dashboard-editable document is D1-backed', () => {
    for (const entry of CONTENT_FILES) {
      expect(D1_ONLY_PATHS.has('src/content/' + entry), entry).toBe(true);
    }
  });

  // And the inverse, so a path cannot sit in D1_ONLY_PATHS without the
  // dashboard or the read path knowing about it.
  it('every D1-backed document is one the dashboard edits', () => {
    const editable = new Set(CONTENT_FILES.map((entry) => 'src/content/' + entry));
    for (const path of D1_ONLY_PATHS) expect(editable.has(path), path).toBe(true);
  });
```

`CONTENT_FILES` comes from `src/admin/content.ts`, which imports only `../content/types` (erased at compile time), so importing it into a Worker test is safe. **Confirm `worker/__tests__/bundle.test.ts` stays green after adding it** — it is the check that React never reaches the Worker, and a test file is not in the Worker's own import graph, but the confirmation costs nothing.

- [ ] **Step 6: `npm run gate && npx wrangler deploy && npm run verify:deploy`**

- [ ] **Step 7: The publish this whole migration was for**

Open `/edit/manage`, change one dish description, press Publish, and time it. Then, **without a browser:**

```
curl -sS  https://viabiancarestaurant.com/ | grep -o '<h3>[^<]*</h3>' | head -20
curl -sS  https://viabiancarestaurant.com/ | grep -c '<div id="vb-crawl">'          # 1
curl -sSI https://viabiancarestaurant.com/ | grep -i x-content-source               # d1; d1=12/12
```

`d1=12/12` — every document answered from the database. The changed description is in the crawl block within seconds, with **no commit, no Pages build and no deploy.**

- [ ] **Step 8: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| remove `'src/content/dishes.json'` from `D1_ONLY_PATHS` | "every dashboard-editable document is D1-backed" **and** "renders every dish into the crawl block now that the menu is D1-backed" | — |
| add `'src/content/press.json'` to `D1_ONLY_PATHS` | "every D1-backed document is one the dashboard edits" | — |
| in `crawlDocuments`, add the `fromD1` condition | "still renders a crawl block from the floor when D1 is unreachable" | The two conditions differ on purpose. If both crawl tests pass with the same body, one of them is not testing what its name says. |
| in `crawlerMenu`, emit only the first ten dishes | `verify:deploy`'s crawler check reports the missing names | Procedural, against the live site. If it passes, the check is comparing the island against itself rather than against the HTML — re-read the two `html.includes` calls. |
| leave the `else` branch in `verify-deploy.mjs` as a console line | flip `dishes.json` back out of `D1_ONLY_PATHS` and run `verify:deploy`; it must exit 1 | The conditional was correct for five tasks and is a hole afterwards. |

**CSS ceiling:** zero bytes.

**If this task is wrong:** the menu on the live site is stale, or a crawler reads a menu the restaurant no longer serves — the failure the spec put this document last to avoid.

---

# Tier 5 — The write paths, last, once every reader has been live for tasks

Photographs have been served from R2 since Task 6 and every reference on the live site has been swept on every deploy since Task 5. Only now does the path a new photograph travels change. If Task 18 is wrong, the photographs already on the site are untouched: the failure is confined to the next upload she attempts, and it is a refusal she can see rather than a broken page a visitor sees.

## Task 18: Upload writes R2 and commits nothing

The commit this migration exists to remove, for photographs. After this, `POST /api/upload` writes two objects to R2 and returns a URL; `POST /api/publish` carries no photograph bytes at all; and the only upload that still writes a commit is a menu PDF, which Task 19 takes.

**Files:**
- Create: `worker/r2.ts`, `worker/__tests__/r2.test.ts`, `worker/__tests__/fakeR2.ts`
- Modify: `worker/upload.ts`, `worker/__tests__/upload.test.ts`
- Modify: `worker/github.ts` (drop `ASSET_PATH`), `worker/__tests__/github.test.ts`
- Modify: `src/admin/upload-photo.ts`, `src/admin/publish.ts`, `src/admin/staged.ts`, `src/admin/undo.ts`
- Modify: `src/admin/__tests__/upload-photo.test.ts`, `src/admin/__tests__/undo.test.ts`, `src/admin/__tests__/RecordList.test.tsx`

**Interfaces:**

```ts
// worker/r2.ts
export interface StoredObject { key: string; bytes: number; contentType: string }
export function cacheControlFor(key: string): string;
export async function putImage(bucket: R2Bucket, key: string, bytes: Uint8Array, contentType: string): Promise<StoredObject>;

// worker/upload.ts
export async function sourceKey(category: string, bytes: Uint8Array, format: Format): Promise<string>; // 'source/<cat>/<hash>.<ext>'
export function derivativeKeyFor(source: string): string;                                              // '<cat>/<hash>.webp'

// src/admin/upload-photo.ts
export interface StagedPhoto { path: string; contentUrl: string }   // `content` and `encoding` are gone
export async function uploadAndStage(category: UploadCategory, file: File, onProgress: (fraction: number) => void): Promise<StagedPhoto>;
```

- [ ] **Step 1: `worker/r2.ts` — every bucket statement in one module**

```ts
// worker/r2.ts
//
// Every R2 statement this migration will ever issue, over a plain R2Bucket, in
// one file -- the shape worker/analytics-store.ts already established for D1. A
// handler that reaches for env.R2 directly is a statement
// worker/__tests__/fakeR2.ts does not know about and therefore a statement no
// test covers.
const HASH_STEM = /\/[0-9a-f]{12}\.[a-z0-9]+$/i;

// The same two policies scripts/migrate-images.mjs applies, and the same
// reasoning (the plan's decision D8): a twelve-hex stem is content-addressed
// and can never legitimately change, so the browser may keep it forever;
// anything else can be replaced under the same key and gets a day, so a
// correction appears without a purge -- and there IS no purge mechanism for R2
// anywhere in this system. Duplicated across a .mjs and a .ts rather than
// shared, exactly as derivative-path.ts duplicates outputPathFor, and pinned
// the same way: worker/__tests__/r2.test.ts imports both and asserts they agree
// over a table of real key shapes.
export function cacheControlFor(key: string): string {
  return HASH_STEM.test('/' + key) ? 'public, max-age=31536000, immutable' : 'public, max-age=86400';
}

export interface StoredObject { key: string; bytes: number; contentType: string }

export async function putImage(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<StoredObject> {
  await bucket.put(key, bytes, { httpMetadata: { contentType, cacheControl: cacheControlFor(key) } });
  return { key, bytes: bytes.length, contentType };
}
```

```ts
// worker/__tests__/r2.test.ts
import { describe, it, expect } from 'vitest';
import { cacheControlFor as workerPolicy } from '../r2';
import { cacheControlFor as scriptPolicy } from '../../scripts/migrate-images.mjs';

// Two implementations of one rule, in two runtimes that cannot import each
// other. This is the only thing keeping them in step, and it runs over the
// shapes that actually exist rather than over one example.
describe('the two cache policies agree', () => {
  it.each([
    'food/0123456789ab.webp', 'food/pizza1.webp', 'source/food/0123456789ab.jpg',
    'menus/food-menu.pdf', 'mocktails/signor bianca.webp', 'hero/brick.webp',
  ])('%s gets the same policy from the Worker and from the migration script', (key) => {
    expect(workerPolicy(key)).toBe(scriptPolicy(key));
  });

  it('makes a content-addressed key immutable and a named one not', () => {
    expect(workerPolicy('food/0123456789ab.webp')).toContain('immutable');
    expect(workerPolicy('food/pizza1.webp')).not.toContain('immutable');
  });
});
```

- [ ] **Step 2: `worker/__tests__/fakeR2.ts`, in the shape of `fakeD1.ts`**

```ts
// worker/__tests__/fakeR2.ts
//
// An R2Bucket stand-in, written the way fakeD1.ts is: it knows the operations
// worker/r2.ts actually performs and throws on anything else, so a new call
// site fails loudly rather than being silently absorbed by a permissive mock.
export interface FakeObject { bytes: Uint8Array; contentType?: string; cacheControl?: string }

export class FakeR2 {
  objects = new Map<string, FakeObject>();
  puts: string[] = [];
  failOnKey: string | null = null;

  async put(key: string, value: ArrayBuffer | Uint8Array, options?: R2PutOptions) {
    this.puts.push(key);
    if (this.failOnKey === key) throw new Error(`FakeR2 refused ${key}`);
    this.objects.set(key, {
      bytes: value instanceof Uint8Array ? value : new Uint8Array(value),
      contentType: options?.httpMetadata && 'contentType' in options.httpMetadata ? options.httpMetadata.contentType : undefined,
      cacheControl: options?.httpMetadata && 'cacheControl' in options.httpMetadata ? options.httpMetadata.cacheControl : undefined,
    });
    return { key } as R2Object;
  }

  async get(key: string) {
    const found = this.objects.get(key);
    return found ? ({ arrayBuffer: async () => found.bytes.buffer } as unknown as R2ObjectBody) : null;
  }

  async delete(): Promise<void> {
    // worker/r2.ts issues no delete: decision D9 is that orphans are left in
    // place, and a bucket-clearing method sitting here unused is an invitation
    // to change that without re-reading why.
    throw new Error('FakeR2: nothing in this migration deletes from R2');
  }
}

export function asR2(fake: FakeR2): R2Bucket {
  return fake as unknown as R2Bucket;
}
```

- [ ] **Step 3: `worker/upload.ts` — two objects, no commit, three refusals**

Replace `handleUpload`'s steps 6–8. **Everything above them — the session check, both size checks, `detectFormat`, the HEIC refusal, `looksComplete` — is unchanged and stays in the same order.**

```ts
  // 6. Two keys from one hash. The source keeps the original's real extension;
  // the derivative is ALWAYS named .webp, whatever the browser actually
  // encoded, because the key is a NAME and the Content-Type stored beside it is
  // the format claim. A browser obeys the served type and ignores the
  // extension, so a JPEG fallback (src/admin/derive.ts) renders correctly under
  // a .webp key and the key stays the one derivativeKeyFor computes rather than
  // becoming format-dependent.
  const source = await sourceKey(category, bytes, format);
  const derivative = derivativeKeyFor(source);

  // 7. The derivative the browser made. THREE refusals, and each catches a
  // different failure this project has actually had or is one step away from:
  const derivedField = formData.get('derivative');
  if (!(derivedField instanceof Blob)) {
    // A request with no derivative is a browser that failed derivation.
    // Accepting the original as the derivative would put a 6 MB photograph on
    // the live menu, which is slow rather than broken and therefore never
    // reported.
    return json(400, { message: 'This photo was not prepared for upload. Try again.' });
  }
  const derived = new Uint8Array(await derivedField.arrayBuffer());
  const derivedFormat = detectFormat(derived);
  // SNIFFED, never trusted from the multipart part's declared type -- the same
  // rule the original gets, and for the same reason: the browser side of this
  // pair is the half a request can lie about. workerd runs no native code, so
  // there is no server-side re-encode to fall back to; refusing is the only
  // move available.
  if (derivedFormat !== 'webp' && derivedFormat !== 'jpeg') {
    return json(400, { message: 'This photo was prepared in a format the site cannot serve.' });
  }
  if (derived.length > bytes.length) {
    // Not a law of physics, but a real signal: a "derivative" larger than its
    // own original means derivation did nothing or went backwards.
    return json(400, { message: 'This photo did not get smaller. Try again.' });
  }

  // 8. Both objects, DERIVATIVE FIRST. If the second put fails, the site has a
  // servable photograph and no archived original -- recoverable, because she
  // still has the photo on her phone. The other order leaves an original
  // nothing can display and a URL handed back for an object that is not there,
  // which is not.
  try {
    await putImage(env.R2, derivative, derived, derivedFormat === 'webp' ? 'image/webp' : 'image/jpeg');
    await putImage(env.R2, source, bytes, MIME[format]);
  } catch (error) {
    return json(502, { message: error instanceof Error ? error.message : 'Could not store the photo.' });
  }

  // NO COMMIT. This is the whole point: a photograph reaches the live site
  // without a git write, without a Pages build and without a deploy. The URL
  // below is what the content document stores, and it is live the instant this
  // response is written.
  //
  // The `?stage=1` two-phase contract is gone with it. It existed so the bytes
  // could ride along inside the publish commit; there is no commit to ride in
  // now. An upload she never publishes leaves an object in R2 that nothing
  // points at, which decision D9 accepts explicitly: at this library's size and
  // rate of change reclaiming is a rounding error against a 10 GB allowance,
  // and deleting on content change is exactly how this project once deleted a
  // photograph that was still in use.
  return json(200, { path: source, contentUrl: env.IMAGE_HOST + '/' + encodeURI(derivative) });
```

with the two key functions replacing `uploadPath`:

```ts
// Content-addressed on the DERIVATIVE's bytes... no: on the ORIGINAL's, and
// deliberately, because the two keys have to share a hash. rederive.mjs (Task
// 20) finds an original from a derivative key by swapping the prefix and
// listing extensions, and that only works while the stem is the same. The
// original is the stable half: two devices encoding the same photograph
// differently produce different derivatives but the same original.
export async function sourceKey(category: string, bytes: Uint8Array, format: Format): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `source/${category}/${hex.slice(0, 12)}.${EXT[format]}`;
}

// 'source/food/0123456789ab.jpg' -> 'food/0123456789ab.webp'. One hash, two
// keys, no second digest and no way for the two to disagree.
export function derivativeKeyFor(source: string): string {
  const rest = source.slice('source/'.length);
  return rest.slice(0, rest.lastIndexOf('.')) + '.webp';
}
```

`UploadEnv` gains `R2: R2Bucket; IMAGE_HOST: string`. `GitHubEnv` stays in the intersection for now: `handleMenuUpload` still commits until Task 19.

- [ ] **Step 4: `ASSET_PATH` comes out of the GitHub allowlist**

In `worker/github.ts`, delete the `ASSET_PATH` regex and its use in `assertAllowedPath`. Nothing writes to `assets-source/` through the Worker any more, and an allowlist entry that permits a write nothing makes is a permission with no purpose — this file's own comment calls the allowlist the only thing standing between a publish request and the rest of the repository.

```ts
// assets-source/ is gone from this list. Photographs are written to R2 by
// worker/upload.ts and never committed, so nothing this Worker does needs to
// write there. Two shapes remain: content documents, and menu PDFs -- and Task
// 19 takes the second.
```

```ts
// worker/__tests__/github.test.ts
it('refuses a write to assets-source/, which nothing commits any more', () => {
  expect(() => assertAllowedPath('assets-source/food/abc123abc123.jpg')).toThrow(DisallowedPathError);
});
```

- [ ] **Step 5: The client sends two parts and stages no bytes**

```ts
// src/admin/upload-photo.ts
//
// A staged photo used to be base64 bytes waiting for POST /api/publish. It is
// now a URL that is already live. The bytes are in R2 before this function
// returns, so nothing has to be carried, nothing has to be re-encoded, and a
// publish request that used to be able to reach 53 MB is now a few KB of JSON.
export interface StagedPhoto {
  path: string;        // 'source/food/<hash>.jpg' -- what R2 holds
  contentUrl: string;  // what the content document stores; live already
}

export async function uploadAndStage(
  category: UploadCategory,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<StagedPhoto> {
  const converted = await convertHeic(file);
  // The web-sized copy is made HERE, before the request. derive() falls back to
  // JPEG rather than refusing when the browser cannot encode WebP, so a
  // photograph is never lost to a browser's capabilities -- it costs one
  // photograph's compression ratio instead. See src/admin/derive.ts.
  const derived = await derive(converted, category);
  const form = new FormData();
  form.set('category', category);
  form.set('file', converted);
  form.set('derivative', derived.blob, 'derivative');
  return post(form, onProgress);   // POST /api/upload, no ?stage=1
}
```

`MAX_STAGED_PHOTO_BYTES` (5 MB) **stays** and still applies to the picked original — it is now about how long an upload takes on a restaurant's wifi rather than about a publish body. `MAX_STAGED_PHOTOS_PER_PUBLISH` **stays too, with its reason rewritten:**

```ts
// Still 8, and the reason changed completely. It used to bound the publish
// request BODY: eight photographs at 5 MB, base64-inflated, was ~53 MB in one
// POST. Photographs no longer travel in a publish at all -- they are already in
// R2 by then and the document carries a URL -- so the body is kilobytes
// whatever this number is. It stays as a bound on how much can go wrong in one
// action: eight uploads is eight chances for a weak connection to fail halfway,
// and a cap she can see is better than a publish that half-lands.
export const MAX_STAGED_PHOTOS_PER_PUBLISH = 8;
```

`src/admin/staged.ts`'s `fromStagedPhoto` returns the URL rather than a `CommitFile`; `buildPublishRequest` stops adding photograph entries to `files`.

- [ ] **Step 6: The undo's photograph warning stops lying**

```ts
// src/admin/undo.ts
//
// Photographs are not in a publish any more, so no path in an undo record can
// begin with assets-source/ -- which means describesAddedPhoto's old check
// always answers false and the confirmation never warns. It SHOULD warn:
// undoing a publish that changed a dish's photograph still visibly changes the
// page, and the previous URL still answers because decision D9 means nothing
// ever deletes an R2 object.
//
// This is deliberately BROADER than what it replaces and that is a real cost:
// the dialog will mention photographs on some publishes that only changed text.
// The alternative -- diffing two JSON trees field by field inside a
// confirmation dialog -- is a great deal of machinery for one sentence of
// wording. Recorded rather than hidden.
export function describesChangedPhoto(before: Record<string, string>, after: Record<string, string>): boolean {
  const images = (text: string) => (text.match(/https:\/\/img\.[^"]+/g) ?? []).join('|');
  return Object.keys(after).some((path) => images(before[path] ?? '') !== images(after[path] ?? ''));
}
```

- [ ] **Step 7: The Worker tests**

```ts
// worker/__tests__/upload.test.ts -- new describe, replacing the stage=1 block
describe('POST /api/upload writes two objects and no commit', () => {
  it('stores the derivative and the original under keys derived from ONE hash', async () => {
    const r2 = new FakeR2();
    const response = await handleUpload(uploadRequest({ category: 'food', file: jpegBytes(), derivative: webpBytes() }), envWith(r2));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { path: string; contentUrl: string };
    const hash = body.path.match(/([0-9a-f]{12})\./)![1];
    expect(r2.puts).toEqual([`food/${hash}.webp`, `source/food/${hash}.jpg`]);
  });

  it('makes no GitHub call at all', async () => {
    const stub = makeGitHubStub();
    await handleUpload(uploadRequest({ category: 'food', file: jpegBytes(), derivative: webpBytes() }), envWith(new FakeR2(), stub));
    expect(stub.calls).toEqual([]);
  });

  it('stores the derivative BEFORE the original', async () => {
    const r2 = new FakeR2();
    await handleUpload(uploadRequest({ category: 'food', file: jpegBytes(), derivative: webpBytes() }), envWith(r2));
    expect(r2.puts[0]).not.toMatch(/^source\//);
  });

  it('marks a content-addressed object immutable', async () => {
    const r2 = new FakeR2();
    await handleUpload(uploadRequest({ category: 'food', file: jpegBytes(), derivative: webpBytes() }), envWith(r2));
    expect([...r2.objects.values()][0].cacheControl).toContain('immutable');
  });

  // The JPEG fallback, from the Worker's side: the key stays .webp and the
  // stored type is the truth. A browser obeys the type and ignores the
  // extension, so this renders; a Worker that typed it from the key would serve
  // a JPEG as image/webp and every browser would refuse it.
  it('serves a JPEG-encoded derivative under its real type, not its key extension', async () => {
    const r2 = new FakeR2();
    await handleUpload(uploadRequest({ category: 'food', file: jpegBytes(200), derivative: jpegBytes(20) }), envWith(r2));
    const [key, stored] = [...r2.objects.entries()].find(([k]) => !k.startsWith('source/'))!;
    expect(key).toMatch(/\.webp$/);
    expect(stored.contentType).toBe('image/jpeg');
  });

  it('refuses a request with no derivative rather than storing an original nothing can serve', async () => {
    const response = await handleUpload(uploadRequest({ category: 'food', file: jpegBytes() }), envWith(new FakeR2()));
    expect(response.status).toBe(400);
    expect((await response.json() as { message: string }).message).toContain('not prepared');
  });

  it('refuses a derivative in a format the site cannot serve', async () => {
    expect((await handleUpload(uploadRequest({ category: 'food', file: jpegBytes(), derivative: pngBytes() }), envWith(new FakeR2()))).status).toBe(400);
  });

  it('refuses a derivative larger than its own original', async () => {
    expect((await handleUpload(uploadRequest({ category: 'food', file: jpegBytes(10), derivative: webpBytes(500) }), envWith(new FakeR2()))).status).toBe(400);
  });

  it('answers 502 rather than a url when R2 rejects the write', async () => {
    const r2 = new FakeR2();
    r2.failOnKey = null;
    const failing = { put: async () => { throw new Error('r2 down'); } } as unknown as R2Bucket;
    expect((await handleUpload(uploadRequest({ category: 'food', file: jpegBytes(), derivative: webpBytes() }), { ...envWith(r2), R2: failing })).status).toBe(502);
  });

  // Not a hardcoded host: the fixture's IMAGE_HOST is deliberately unusual, so
  // a hardcoded string in the handler cannot satisfy this.
  it('builds the returned url from env.IMAGE_HOST', async () => {
    const env = { ...envWith(new FakeR2()), IMAGE_HOST: 'https://images.example.test' };
    const body = (await (await handleUpload(uploadRequest({ category: 'food', file: jpegBytes(), derivative: webpBytes() }), env)).json()) as { contentUrl: string };
    expect(body.contentUrl.startsWith('https://images.example.test/')).toBe(true);
  });

  it('still refuses HEIC, unauthenticated requests and oversized bodies exactly as before', async () => {
    // The four checks above step 6 are unchanged and are re-asserted here
    // rather than assumed: this task rewrote the code around them.
    expect((await handleUpload(uploadRequest({ category: 'food', file: heicBytes(), derivative: webpBytes() }), envWith(new FakeR2()))).status).toBe(400);
    expect((await handleUpload(unauthenticatedRequest(), envWith(new FakeR2()))).status).toBe(401);
  });

  it('still commits a menu pdf, which moves in Task 19', async () => {
    const stub = makeGitHubStub();
    const response = await handleUpload(menuUploadRequest(pdfBytes(), 'food-menu'), envWith(new FakeR2(), stub));
    expect(response.status).toBe(200);
    expect(stub.calls.some((call) => call.method === 'POST' && call.url.includes('/git/blobs'))).toBe(true);
  });
});
```

- [ ] **Step 8: `npm run gate && npx playwright test && npx wrangler deploy`**

- [ ] **Step 9: Upload a real photograph from her phone, end to end**

At `/edit/manage`, replace one dish photograph with a **portrait** photograph taken on her phone. Watch the network tab: **one `POST /api/upload`, no `/api/publish` carrying bytes**, and the publish that follows returns `sha: null` and goes straight to success. Then, without a browser:

```
curl -sSI "$(curl -sS https://viabiancarestaurant.com/ | grep -o 'https://img.viabiancarestaurant.com/food/[0-9a-f]\{12\}\.webp' | head -1)"
npx wrangler r2 object get "via-bianca/food/<hash>.webp" --remote --file /tmp/check.webp && file /tmp/check.webp
npm run verify:images
git log --oneline -3   # NO new commit from the upload
```

Expect 200, `content-type: image/webp`, `RIFF (little-endian) data, Web/P image`, every reference resolving, and no commit. **Look at the photograph on the page and check it is the right way up** — that is the EXIF orientation path, and no test in this repository can see it.

- [ ] **Step 10: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| re-add the `commitFiles` call to the photograph path | "makes no GitHub call at all" | **This is the row that proves the point of the whole task.** |
| swap the two `putImage` calls | "stores the derivative BEFORE the original" | — |
| make the `derivative` field optional, defaulting to the original bytes | "refuses a request with no derivative…" and "refuses a derivative larger than its own original" | — |
| remove the `detectFormat(derived)` check | "refuses a derivative in a format the site cannot serve" | — |
| type the stored derivative from its key extension instead of from `derivedFormat` | "serves a JPEG-encoded derivative under its real type, not its key extension" | Without this the JPEG fallback ships a file every browser refuses, which is worse than the refusal it replaced. |
| remove the `try`/`catch` around the R2 writes | "answers 502 rather than a url when R2 rejects the write" | — |
| build `contentUrl` from a hardcoded host instead of `env.IMAGE_HOST` | "builds the returned url from env.IMAGE_HOST" — the fixture's host is deliberately unusual | If a hardcoded string satisfies it, the fixture has been changed to the real host and the test is comparing a value against itself. |
| make `derivativeKeyFor` return the source key | "stores the derivative and the original under keys derived from ONE hash" | — |
| hash the derivative's bytes for the source key too | that same test stays green (both are 12 hex) — **so also** assert the two stems are equal: `expect(r2.puts[0].split('/')[1].split('.')[0]).toBe(r2.puts[1].split('/')[2].split('.')[0])` | The shared stem is what `rederive.mjs` (Task 20) navigates by. If they diverge, the escape hatch cannot find an original. |
| make `cacheControlFor` always return the one-day policy | "marks a content-addressed object immutable" and `r2.test.ts`'s parity rows | — |
| restore `ASSET_PATH` in `worker/github.ts` | "refuses a write to assets-source/, which nothing commits any more" | — |
| leave `describesAddedPhoto` checking `assets-source/` | `src/admin/__tests__/undo.test.ts`'s "warns when an undo will change a photograph" | **That test does not exist today and the behaviour is already silently broken by Task 6.** Write it. |

**CSS ceiling:** expected zero. `upload-photo.ts`, `staged.ts` and `undo.ts` render nothing. Confirm against 39441.

**If this task is wrong:** she picks a photograph and gets an error message instead of an upload — visible, immediate, and confined to her own device, which is exactly why this ordering puts it here rather than in front of the fifty photographs already live.

---

## Task 19: The menu PDFs, and the last upload path that writes a commit

Closes the write half for files. `handleMenuUpload` is the only remaining route that turns an owner action into a commit and a deploy, and `public/menus/` is **20 MB of committed binaries — larger than every photograph in the repository put together.** Leaving it means the dashboard's own copy has to keep explaining an exception ("the one exception is a new menu PDF"), which is a sentence nobody should have to read.

**Files:**
- Modify: `worker/upload.ts`, `worker/__tests__/upload.test.ts`
- Modify: `worker/github.ts` (drop `MENU_PATH`), `worker/__tests__/github.test.ts`
- Modify: `src/content/menus.json`, `src/components/SignatureMocktails.tsx` (its menu link), `src/admin/PdfField.tsx`
- Modify: `src/content/validate.ts` tests, `src/content/__tests__/assets.test.ts`
- Delete: `public/menus/food-menu.pdf`, `public/menus/drinks-menu.pdf`
- Modify: `.gitignore`, `src/test/gitignore.test.ts`
- Create: `e2e/menu-download.spec.ts`

**Interfaces:**

```ts
// worker/upload.ts
export function menuKey(name: string): string;   // 'menus/<name>.pdf'
export function menuUrl(host: string, name: string): string;
```

- [ ] **Step 1: Copy both PDFs into the bucket, verified the same way**

```
npm run migrate:images -- --inventory docs/image-inventory.json --menus
```

Reuses Task 4's `migrate()` wholesale: `contentTypeFor` already knows `pdf`, and `cacheControlFor` gives them the **one-day** policy — which is right and is the reason there are two policies at all. A menu name is stable on purpose (that is why `menuAssetPath` is not content-addressed), so replacing a PDF under the same name must become visible without a purge, and there is no purge.

- [ ] **Step 2: Verify over HTTPS BEFORE rewriting anything**

```
curl -sSI https://img.viabiancarestaurant.com/menus/food-menu.pdf | head -5
curl -sSI https://img.viabiancarestaurant.com/menus/drinks-menu.pdf | head -5
```

Both must be `200` with `content-type: application/pdf` and `cache-control: public, max-age=86400`. **Do not proceed on anything else.**

- [ ] **Step 3: The route writes to R2**

`handleMenuUpload`'s `looksCompletePdf`, `MENU_NAME_PATTERN` and both size checks are unchanged. Only the tail changes:

```ts
  // The `?stage=1` two-phase contract goes with the commit it existed for.
  //
  // A menu PDF is NOT content-addressed -- menuAssetPath deliberately uses the
  // chosen name, so replacing a PDF under the same menu id needs no menus.json
  // edit at all. That means this OVERWRITES the previous object at the same
  // key, which is the intended behaviour and is exactly why these keys carry
  // the one-day Cache-Control rather than the immutable one: an overwritten
  // object under a cached key would otherwise be invisible for as long as the
  // TTL, and there is no purge mechanism for R2 anywhere in this system.
  const key = menuKey(name);
  try {
    await putImage(env.R2, key, bytes, 'application/pdf');
  } catch (error) {
    return json(502, { message: error instanceof Error ? error.message : 'Could not store the menu.' });
  }
  return json(200, { path: key, file: menuUrl(env.IMAGE_HOST, name) });
```

- [ ] **Step 4: Rewrite the three PDF references**

`menus.json`'s two `file` fields and `SignatureMocktails.tsx`'s one menu link become `https://img.viabiancarestaurant.com/menus/…`. In `scripts/rewrite-image-refs.mjs`, `KEEP_PREFIX` loses `'/menus/'` and the extension pattern gains `pdf`; its test's "leaves a menu PDF alone" case is **replaced** by "rewrites a menu PDF now that they are hosted too" — replaced, not deleted, so the file still says what the rule is.

`menus.json` is D1-backed since Task 15, so **this rewrite goes through `POST /api/publish`, exactly as Task 7's did**, and `SignatureMocktails.tsx` is a code edit that ships on the next Pages build.

- [ ] **Step 5: `validate.ts`'s menu-file check follows the same widening**

`validateMenus` checks `file` with `isUnsafeAssetPath`, which Task 6 already widened. **Confirm rather than assume:**

```ts
  it('accepts a menu file on the image host', () => {
    expect(() => validateMenus([{ id: 'food', label: 'Food', file: 'https://img.viabiancarestaurant.com/menus/food-menu.pdf' }])).not.toThrow();
  });

  it('still refuses a menu file on somebody else’s host', () => {
    expect(() => validateMenus([{ id: 'food', label: 'Food', file: 'https://evil.example/menu.pdf' }])).toThrow();
  });
```

- [ ] **Step 6: Delete the files and the allowlist entry**

```
git rm public/menus/food-menu.pdf public/menus/drinks-menu.pdf
```

`worker/github.ts` loses `MENU_PATH`. **`assertAllowedPath` is now `CONTENT_PATH` alone — one shape, the smallest the allowlist has ever been.** `.gitignore` loses its `!/public/menus/` exception, and `src/test/gitignore.test.ts` follows.

```ts
// worker/__tests__/github.test.ts
it('refuses a write to public/menus/, which no longer exists', () => {
  expect(() => assertAllowedPath('public/menus/food-menu.pdf')).toThrow(DisallowedPathError);
});
```

- [ ] **Step 7: A real download, in a real browser**

```ts
// e2e/menu-download.spec.ts
import { test, expect } from '@playwright/test';

test('the food menu still downloads, from the image host, as a pdf', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: /food menu/i }).first();
  await expect(link).toHaveAttribute('href', /img\.viabiancarestaurant\.com\/menus\/food-menu\.pdf/);
  const response = await page.request.get((await link.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/pdf');
  // The policy that makes a replacement visible. An immutable header here means
  // she uploads a new menu and nobody sees it for a year.
  expect(response.headers()['cache-control']).not.toContain('immutable');
});
```

- [ ] **Step 8: `npm run gate && npx playwright test && npx wrangler deploy && npm run verify:deploy`**

- [ ] **Step 9: Replace a menu PDF from the dashboard, end to end**

Upload a new food menu at `/edit/manage`, publish, and confirm: **no commit** (`git log`), the link still points at the same URL, and the new PDF opens. **Wait and check again after a minute** — the one-day policy means an edge that already cached the old object may still serve it to a client that asks within its own freshness window; a hard reload is the check.

- [ ] **Step 10: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| restore `commitFiles` in `handleMenuUpload` | `worker/__tests__/upload.test.ts`'s "a menu upload makes no GitHub call" | The Task 18 test that asserted the opposite is **replaced** by this one, in this task. Two tests making contradictory claims about the same route is how a migration loses track of what it has done. |
| restore `MENU_PATH` in `worker/github.ts` | "refuses a write to public/menus/, which no longer exists" | — |
| point `menus.json`'s `file` at `/menus/food-menu.pdf` again | `src/content/__tests__/assets.test.ts` — the path no longer exists under `public/` | — |
| make `menuKey` content-address the name | `worker/__tests__/upload.test.ts`'s "replacing a menu writes to the same key" | This is the property `menuAssetPath`'s original comment exists to protect, and it must survive the move. |
| give a menu key the immutable cache policy | `worker/__tests__/r2.test.ts`'s `menus/food-menu.pdf` parity row, and `e2e/menu-download.spec.ts` | — |
| leave `!/public/menus/` in `.gitignore` after deleting the files | `src/test/gitignore.test.ts` | An exception carved out for files that no longer exist is a rule nobody can evaluate. |

**CSS ceiling:** zero bytes.

**If this task is wrong:** the printed menu link 404s — which for a restaurant is worse than a broken photograph, because it is the one thing a hungry person on the website is trying to open.

---

## Task 20: `scripts/rederive.mjs` — the escape hatch that actually executes

The plan's stated mitigation for a bad browser encode is *"the original is stored beside it, so it can be re-encoded"*. **A mitigation that has no executable is not a mitigation.** This is that executable: pull the original from the `source/` prefix, re-encode it with the real `encodeDerivative` **imported from `scripts/images.mjs`, not copied**, and put it back under the same key.

Same key means **no content file moves, no reference changes, and no cache entry needs purging beyond that key's own policy** — and a content-addressed derivative key is `immutable`, so the honest note is written into the script: a re-derived object under an immutable key reaches a browser that already cached it only after a year, or a hard reload. The site's own edge picks it up on the next miss.

**Files:**
- Create: `scripts/rederive.mjs`
- Create: `scripts/__tests__/rederive.test.mjs`
- Modify: `package.json` (add `rederive`)

**Interfaces:**

```js
// scripts/rederive.mjs
export async function rederive(keys, deps);   // deps: { findOriginal, getObject, putObject, log }
```

- [ ] **Step 1: The script**

```js
// scripts/rederive.mjs
//
// The answer to "what if the browser encoded it badly".
//
// Pulls an original out of R2's source/ prefix, re-encodes it with the REAL
// sharp pipeline -- the same encodeDerivative scripts/images.mjs exports,
// IMPORTED rather than reimplemented -- and puts the derivative back under the
// same key. Nothing else changes: the key is the same, so no content document
// moves and no reference is rewritten.
//
// WHY IMPORTED AND NOT COPIED. A copied recipe drifts away from the pipeline it
// exists to restore, silently, and the first person to notice is looking at two
// photographs that were supposed to have been encoded the same way. One
// function, two callers, and `npm run images` is the other one.
//
// THE CACHE, stated honestly: a derivative key is content-addressed and
// therefore carries `public, max-age=31536000, immutable`. Re-uploading the
// same key does NOT reach a browser that already holds it -- that is what
// immutable means, and it is the right policy because the bytes under a
// content-addressed key are not supposed to change. What this reaches is every
// edge miss and every visitor who has not seen it. If a photograph must change
// for everyone immediately, re-upload it through /edit instead: that produces a
// NEW hash, a new key, and a content document that points at it.
//
// Run by a developer, by hand, never on a schedule:
//   node scripts/rederive.mjs food/0123456789ab.webp
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeDerivative } from './images.mjs';
import { maxWidthFor, IMAGE_EXT } from './paths.mjs';

const run = promisify(execFile);
const BUCKET = 'via-bianca';

export async function rederive(keys, deps) {
  const { findOriginal, getObject, putObject, log } = deps;
  const done = [];
  for (const key of keys) {
    const category = key.slice(0, key.indexOf('/'));
    const stem = key.slice(key.lastIndexOf('/') + 1, key.lastIndexOf('.'));

    // The original's extension is not in the derivative key, so the source is
    // found by LISTING rather than by guessing -- an original can be .jpg,
    // .png, .webp, .avif, .tiff or .gif (paths.mjs's IMAGE_EXT).
    const original = await findOriginal(`source/${category}/${stem}`);
    if (!original) {
      // Loud, and NOT fatal for the batch. A legacy key migrated in Task 4 has
      // no `source/` object with a matching stem at all -- those fifty were
      // copied from the live site under their human names, not derived from an
      // original -- and that is EXPECTED, not an error. What it means is that a
      // legacy photograph cannot be re-derived and must be re-uploaded through
      // /edit instead.
      log(`SKIP ${key}: no original with that stem in the bucket (a legacy object -- re-upload it through /edit)`);
      continue;
    }

    const tmp = join(tmpdir(), 'vb-' + randomUUID());
    await writeFile(tmp, await getObject(original));
    try {
      // maxWidthFor is keyed on a SOURCE path, so the category directory has to
      // be reconstructed -- this is the same rule scripts/paths.mjs applies at
      // build time and src/shared/image-widths.ts re-implements for the browser.
      const bytes = await encodeDerivative(tmp, maxWidthFor(`assets-source/${category}/${stem}.jpg`)).toBuffer();
      await putObject(key, bytes, 'image/webp');
      log(`${key} re-derived at ${bytes.length}B from ${original}`);
      done.push(key);
    } finally {
      await rm(tmp, { force: true });
    }
  }
  return done;
}

async function findOriginalInBucket(prefix) {
  const { stdout } = await run('npx', ['wrangler', 'r2', 'object', 'list', BUCKET, '--prefix', prefix, '--remote', '--json']);
  const keys = JSON.parse(stdout).objects?.map((o) => o.key) ?? [];
  return keys.find((k) => IMAGE_EXT.has(k.slice(k.lastIndexOf('.')).toLowerCase())) ?? null;
}
```

```json
    "rederive": "node scripts/rederive.mjs",
```

- [ ] **Step 2: The test, which observes that the shared recipe was used**

```js
// scripts/__tests__/rederive.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { rederive } from '../rederive.mjs';
import { encodeDerivative } from '../images.mjs';
import { maxWidthFor } from '../paths.mjs';

const ORIGINAL = 'assets-source/atmosphere/dining.jpg';

describe('the escape hatch behind the browser encoder', () => {
  it('skips a legacy object rather than failing the batch', async () => {
    const log = vi.fn();
    const done = await rederive(['food/pizza1.webp'], {
      findOriginal: async () => null,
      getObject: async () => { throw new Error('should never be reached'); },
      putObject: vi.fn(),
      log,
    });
    expect(done).toEqual([]);
    expect(log.mock.calls[0][0]).toMatch(/^SKIP/);
  });

  // The claim is that this uses THE SAME recipe as the build step, and the way
  // to prove it without spying on a module import is to compare the bytes: an
  // independent sharp chain with a different quality or a missing .rotate()
  // does not produce these.
  it('produces byte-identical output to encodeDerivative for the same input', async () => {
    const puts = [];
    await rederive(['atmosphere/0123456789ab.webp'], {
      findOriginal: async () => 'source/atmosphere/0123456789ab.jpg',
      getObject: async () => readFileSync(ORIGINAL),
      putObject: async (key, bytes) => puts.push({ key, bytes }),
      log: () => {},
    });
    const expected = await encodeDerivative(ORIGINAL, maxWidthFor('assets-source/atmosphere/x.jpg')).toBuffer();
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe('atmosphere/0123456789ab.webp');
    expect(Buffer.from(puts[0].bytes).equals(expected)).toBe(true);
  });

  it('puts the derivative back under the SAME key, so no reference has to move', async () => {
    const puts = [];
    await rederive(['food/abcdefabcdef.webp'], {
      findOriginal: async () => 'source/food/abcdefabcdef.jpg',
      getObject: async () => readFileSync(ORIGINAL),
      putObject: async (key) => puts.push(key),
      log: () => {},
    });
    expect(puts).toEqual(['food/abcdefabcdef.webp']);
  });

  it('applies the category cap, not one global width', async () => {
    // hero is capped at 500 and food at 1000 (scripts/paths.mjs). If this
    // script ignored the cap, both would come out the same size.
    const widths = {};
    for (const key of ['hero/aaaaaaaaaaaa.webp', 'food/bbbbbbbbbbbb.webp']) {
      await rederive([key], {
        findOriginal: async () => 'source/x/y.jpg',
        getObject: async () => readFileSync(ORIGINAL),
        putObject: async (k, bytes) => { widths[k.split('/')[0]] = bytes.length; },
        log: () => {},
      });
    }
    expect(widths.hero).toBeLessThan(widths.food);
  });
});
```

This test is excluded from `test:deploy` alongside `images.derivatives.test.mjs`, for the same reason: it loads `sharp`.

- [ ] **Step 3: Run it once, for real, on an object she actually uploaded**

Pick a content-addressed key from a photograph uploaded in Task 18, run `npm run rederive -- <key>`, and confirm: the object's byte length changed, `curl` on the URL still returns 200 with `content-type: image/webp`, and the photograph still looks right in a browser after a hard reload.

- [ ] **Step 4: `npx eslint scripts/rederive.mjs && npm test -- --run scripts/__tests__/rederive.test.mjs && npm run test:deploy`**

`test:deploy` is in that list to confirm the exclusion actually took: if `rederive.test.mjs` runs there, `sharp`'s native binding is back in every Cloudflare deploy.

- [ ] **Step 5: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| in `rederive`, call `sharp()` directly instead of `encodeDerivative` | "produces byte-identical output to encodeDerivative for the same input" | Equal bytes is the claim, and it is the only observable that distinguishes a shared recipe from a lucky copy. If a hand-rolled chain produces identical bytes, it is identical — but the moment `encodeDerivative` changes, the copy stops matching and this reddens. |
| drop `.rotate()` from `encodeDerivative` | the same test, plus `scripts/__tests__/images.test.mjs` | — |
| in `rederive`, drop the `findOriginal` null branch | "skips a legacy object rather than failing the batch" | — |
| in `rederive`, write to a new key instead of the same one | "puts the derivative back under the SAME key, so no reference has to move" | — |
| in `rederive`, use `DEFAULT_MAX_WIDTH` instead of `maxWidthFor` | "applies the category cap, not one global width" | — |
| remove the `test:deploy` exclusion for this file | `npm run test:deploy` loads sharp | Procedural. `src/test/hosting.test.ts` asserts the exclusion list; add this file to that assertion. |

**CSS ceiling:** zero bytes.

**If this task is wrong:** the plan's stated mitigation for a bad browser encode does not run, and the only recovery for a soft-looking photograph is to re-upload it from her phone — which she can do, so this is a convenience rather than a correctness failure. **If it is missing entirely**, the plan claimed a mitigation it did not have, which is worse than not claiming one.

---

## Task 21: Stop the commit, and delete the Worker's `GITHUB_TOKEN`

Last, once every read path is live and every document is in D1, so the commit stops only when nothing depends on it.

**And the largest single blast-radius reduction this migration makes:** the Worker's GitHub token can write to a repository that deploys a live website. After this task it does not exist. That is not a tidiness change — it is the removal of the one credential in this system whose misuse could ship arbitrary code to production.

**Files:**
- Modify: `worker/github.ts`, `worker/index.ts`, `wrangler.toml`
- Modify: `src/admin/PublishBar.tsx`, `src/admin/publish.ts`, `src/admin/manage/*` (the copy)
- Modify: `worker/__tests__/github.test.ts`, `worker/__tests__/index.test.ts`, `src/admin/__tests__/PublishBar.test.tsx`
- Modify: `src/test/bundle.post-build.test.ts` (the ceiling **lowers**)

**Interfaces:**

```ts
// worker/github.ts, after this task
export function isContentPath(path: string): boolean;   // retained for GET /api/content's read gate
// assertAllowedPath, commitFiles, restoreBlobs, getHeadCommit, getTreeBlobShas,
// createBlob, createTree, createCommit, updateBranchHead, getFileContent,
// CONTENT_PATH, DisallowedPathError, PublishConflictError: ALL DELETED.

// worker/index.ts
//   handlePublish returns { sha: null, publishId, d1Paths } on every path.
//   GET /api/build-status is removed from the route table and AUTHENTICATED_PATHS.
```

- [ ] **Step 1: Set `CONTENT_STORE = "d1"`**

```toml
# Every content document is D1-backed by name in worker/store.ts's
# D1_ONLY_PATHS, so this flag decides nothing any more -- it is set to "d1"
# rather than deleted so that a document added to CONTENT_FILES tomorrow and
# forgotten in D1_ONLY_PATHS still goes somewhere that works. The GitHub store
# is deleted in this same commit, so "github" is no longer a value this Worker
# can honour.
CONTENT_STORE = "d1"
```

Confirm with the Task 17 tests: every path already answers `d1` under `CONTENT_STORE: 'github'`, so this changes nothing observable.

- [ ] **Step 2: Delete the write half of `worker/github.ts`**

`assertAllowedPath` now permits nothing, so `CONTENT_PATH`, `commitFiles`, `restoreBlobs`, `getHeadCommit`, `getTreeBlobShas`, `createBlob`, `createTree`, `createCommit` and `updateBranchHead` go with it. `getFileContent` goes too: `storeFor` never returns a `GitHubStore` any more, and `handlePublish`'s step 5 was moved onto `storeFor` at Task 16.

**Watch `noUnusedLocals` closely here.** `GitHubEnv`, `GITHUB_OWNER`, `GITHUB_REPO` and `GITHUB_BRANCH` lose their last readers, and `worker/store.ts`'s `GitHubStore` class and `partitionByStore`'s `github` leg go with them. Everything must be deleted in **one** commit or the branch is red.

```ts
// worker/__tests__/github.test.ts
it('has no write path left at all', () => {
  // Not a check that one shape is refused -- a check that the module exports
  // nothing that can write. The Worker's GITHUB_TOKEN secret is deleted in this
  // same task, so a write path that survived here would be a call that fails at
  // runtime rather than one that is caught here.
  expect(Object.keys(github)).not.toContain('commitFiles');
  expect(Object.keys(github)).not.toContain('assertAllowedPath');
});
```

- [ ] **Step 3: Delete the Worker's `GITHUB_TOKEN` secret**

```
npx wrangler secret list
npx wrangler secret delete GITHUB_TOKEN
npx wrangler secret list
```

**This is the largest blast-radius reduction in the migration and it is a deliberate, separate step.** Until now this Worker has held a credential that can write to a repository which deploys a live website; the path allowlist was, in `worker/github.ts`'s own words, the only thing standing between a publish request and the rest of that repository. There is now nothing to stand between, because there is no token.

The weekly export (Task 22) runs in GitHub Actions with its own repository-scoped credentials and needs nothing from the Worker. Record the deletion, with the date and the `wrangler secret list` output before and after, in `docs/cloudflare-cutover.md`.

- [ ] **Step 4: `PublishBar` stops polling**

`trackPublish`, `confirmLive`, `fetchBuildStatus`, `fetchBuildInfo` and the whole ten-minute poll machinery exist to wait for a Cloudflare build that no longer happens. `sha === null` is now every publish, and that branch already sets `phase: 'success'` immediately. Delete the rest, and delete `GET /api/build-status` with it (route table and `AUTHENTICATED_PATHS`).

```ts
// src/admin/__tests__/PublishBar.test.tsx
it('reaches success without a build poll', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sha: null, publishId: 'p1' }), { status: 200 }));
  // ... render, click Publish ...
  await screen.findByText(/live/i);
  expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('build-status'))).toBe(false);
});
```

- [ ] **Step 5: Rewrite the dashboard's own sentence**

`grep -rn '2-3 minutes' src/` finds every copy of *"It usually takes about 2-3 minutes for the site to show the change."* **It is now false everywhere, with no exception left to explain — Task 19 took the last one.**

```ts
// The change is live the moment this finishes. Publishing writes to the
// database the site reads from: there is no build to wait for and nothing is
// deployed. That is true of every panel in this dashboard, including photographs
// and menu PDFs.
export const PUBLISH_TIMING_COPY = 'Your change is live now.';
```

```ts
// src/admin/__tests__/copy.test.ts
it('no longer promises a two-to-three minute wait anywhere', () => {
  for (const file of everySourceFile('src/admin')) {
    expect(readFileSync(file, 'utf8'), file).not.toContain('2-3 minutes');
  }
});
```

**A false sentence in the product is a defect, and the only thing that keeps it out is a test that names the exact string.**

Re-read the new copy and its comment for bare Tailwind utility tokens before committing.

- [ ] **Step 6: `npm run gate && npx playwright test && npx wrangler deploy && npm run verify:deploy`**

- [ ] **Step 7: The CSS ceiling goes DOWN**

Deleting the polling states removes rules. Re-measure and **lower** the ceiling to the new measured number in the same commit, with the rule-level accounting the file's comment lineage requires. A ceiling left high after a real reduction is silent headroom for the next task, which is how a breach once stayed red here for eleven tasks.

```
npm run build && ls -l dist/assets/index-*.css
```

- [ ] **Step 8: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| restore `CONTENT_PATH` and `commitFiles` | "has no write path left at all" | — |
| leave the "2-3 minutes" sentence in one panel | "no longer promises a two-to-three minute wait anywhere" | If that test does not scan every file under `src/admin`, it is checking the copies somebody remembered. |
| keep `trackPublish` wired to the success path | "reaches success without a build poll" | — |
| leave `GET /api/build-status` routed | `worker/__tests__/index.test.ts`'s route-table assertion — add `expect((await worker.fetch(new Request('https://x/api/build-status'), env, ctx)).status).toBe(404)` | — |
| restore the `GITHUB_TOKEN` secret | nothing automated | Procedural: `npx wrangler secret list` must not name it. Add a line to `docs/cloudflare-cutover.md`'s checklist rather than a test — a test cannot see a Cloudflare secret, and pretending otherwise would be exactly the unfalsifiable assertion this project keeps catching. |
| raise the CSS ceiling instead of lowering it | nothing automated | The ceiling test only checks the number. The accounting is a discipline and the comment lineage in `src/test/bundle.post-build.test.ts` is where a reviewer checks it was kept. |

**CSS ceiling:** **this task LOWERS it**, to the measured number, with the accounting.

**If this task is wrong:** publishing breaks entirely. It is last for exactly that reason, and the rollback is `git revert` plus `npx wrangler secret put GITHUB_TOKEN` plus one `wrangler deploy`.

---

# Tier 6 — The safety nets, and the proof

## Task 22: The weekly export, and the floor's honest header

The spec's answer to D1 Time Travel being **seven days on the free plan**: *"a weekly export of every content document back into the repository, committed by a scheduled job. This is NOT the per-publish commit this migration exists to remove — it is one commit a week whose only job is to make the content survive losing D1 entirely."* And the second half: *"the floor files carry a header comment stating they are a fallback, not the live content, and naming where the live content actually is."*

**Files:**
- Create: `.github/workflows/content-export.yml`
- Create: `src/content/__tests__/floor-header.test.ts`
- Modify: `scripts/export-content.mjs` (one guard)
- Modify: `src/content/index.ts` (the header)
- Modify: `docs/cloudflare-cutover.md`

**Interfaces:**

- Consumes: repository secrets `CLOUDFLARE_API_TOKEN` (D1 read) and `CLOUDFLARE_ACCOUNT_ID`. **A human adds both in the repository's Actions settings; an agent cannot.**
- Produces: one commit a week touching `src/content/*.json` and `worker/snapshot.ts`, and nothing else.

- [ ] **Step 1: The workflow**

```yaml
# .github/workflows/content-export.yml
#
# One commit a week whose only job is that the content survives losing D1.
#
# THIS IS NOT THE PER-PUBLISH COMMIT THIS MIGRATION REMOVED. Publishing writes
# to D1 and is live in seconds with no commit, no build and no deploy. This runs
# on a schedule, takes whatever D1 holds at that moment, and writes it back into
# the repository so that a corruption discovered on day eight -- one day past
# D1's free-tier Time Travel window -- is still recoverable.
#
# IN ACTIONS RATHER THAN IN THE WORKER'S `scheduled` HANDLER, and by Task 21
# that is no longer even a choice: the Worker has no GITHUB_TOKEN at all. It was
# a decision before it was a constraint -- worker/github.ts's path allowlist was
# the only thing standing between a publish request and the rest of this
# repository, and a Worker-side export would have needed it widened to write
# worker/snapshot.ts.
#
# THE COMMIT TRIGGERS A PAGES BUILD, once a week, which is fine and is not the
# thing this migration was removing. It does NOT deploy the Worker, so the
# regenerated worker/snapshot.ts reaches production only on the next
# `npx wrangler deploy` -- the spec's own rule for the floor: "updated only when
# code deploys anyway".
name: Weekly content export

on:
  schedule:
    # 04:43 UTC on Mondays -- 10:13 in Kolkata, well clear of the 03:17 daily
    # analytics cron on the Worker, and at a minute nobody else's job is on.
    - cron: '43 4 * * 1'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  export:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - name: Read every content document out of D1
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npm run export:content
      # The export overwrites src/content/*.json from D1, so the guards and the
      # image walk now run against what the site is ACTUALLY serving. A document
      # D1 holds that this repository's own validation rejects is a real problem
      # and must fail HERE rather than be committed. That includes a photograph
      # reference she published that does not resolve: assets.test.ts's shape
      # check runs over the exported documents.
      - name: Validate what came back
        run: npx tsc -b --noEmit && npm test -- --run
      - name: Commit if anything changed
        run: |
          git config user.name  'via-bianca-export'
          git config user.email 'export@viabiancarestaurant.com'
          if git diff --quiet -- src/content worker/snapshot.ts; then
            echo 'no content changed since the last export'
            exit 0
          fi
          git add src/content worker/snapshot.ts
          git commit -m 'chore(content): weekly export of the live content from D1'
          git push
```

- [ ] **Step 2: The floor's honest header, and the export's refusal to run without it**

A JSON file cannot carry a comment, so the statement goes in the one place that is both machine-checkable and impossible to miss — `src/content/index.ts`, the module every one of them is imported through.

```ts
// THESE ELEVEN JSON FILES ARE A FALLBACK, NOT THE LIVE CONTENT.
//
// The live content is the `content` table in the Cloudflare D1 database named
// via-bianca-content. The dashboard at /edit writes there, the Worker reads
// there (worker/content-bundle.ts), and a published change is visible on the
// site within seconds without touching this repository at all.
//
// What is in these files is whatever that database held the last time
// scripts/export-content.mjs ran -- a scheduled job, weekly, see
// .github/workflows/content-export.yml. They can be up to a week stale, and
// after a failed export run they can be older than that.
//
// THEY ARE STILL LOAD-BEARING, in four ways, which is why they are not deleted:
//
//   1. They are what THIS BUNDLE RENDERS when the Worker's content island does
//      not carry a document -- which, by the plan's decision D0, is whenever
//      D1 is unreachable. That is the site's real floor on the client side, and
//      it is refreshed by a Pages build rather than by a Worker deploy, which
//      is why it is never staler than worker/snapshot.ts.
//   2. worker/snapshot.ts is generated from the same export and is what the
//      Worker serves to a crawler and to /api/published when D1 cannot be
//      reached.
//   3. They are what a page served with no Worker in front of it renders -- a
//      local `npm run dev`, `npm run preview`, the Playwright suite.
//   4. They are the only thing keeping every image reference inside
//      src/content/__tests__/assets.test.ts's walk, which cannot see D1 at all.
//      galleries.json alone carries twenty-five of them.
//
// A FRESH CLONE THEREFORE BUILDS THE CONTENT AS OF THE LAST EXPORT, not the
// content on the live site. That is a real change from how this repository used
// to work and it is stated here rather than discovered.
```

And in `scripts/export-content.mjs`, before it writes anything:

```js
  // The floor's own statement about what it is. The export REFUSES TO RUN if
  // somebody has removed it, because a repository full of stale content files
  // with nothing saying they are stale is the exact confusion the spec's "the
  // repository stops being the source of truth" section is about.
  const barrel = readFileSync(join('src', 'content', 'index.ts'), 'utf-8');
  if (!barrel.includes('A FALLBACK, NOT THE LIVE CONTENT')) {
    console.error('src/content/index.ts no longer says these files are a fallback. Put the header back before exporting.');
    process.exit(1);
  }
```

- [ ] **Step 3: Pin the header as a test**

```ts
// src/content/__tests__/floor-header.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('the floor says what it is', () => {
  const barrel = readFileSync(join(process.cwd(), 'src', 'content', 'index.ts'), 'utf-8');

  it('states plainly that these files are not the live content', () => {
    expect(barrel).toContain('A FALLBACK, NOT THE LIVE CONTENT');
  });

  it('names where the live content actually is', () => {
    expect(barrel).toContain('via-bianca-content');
  });

  it('names what refreshes them', () => {
    expect(barrel).toContain('scripts/export-content.mjs');
    expect(barrel).toContain('content-export.yml');
  });

  it('says a fresh clone does not build the live site', () => {
    expect(barrel).toContain('A FRESH CLONE');
  });
});
```

- [ ] **Step 4: Run the workflow by hand once, before trusting the schedule**

```
gh workflow run content-export.yml
gh run watch
```

The first real run is what proves the secrets are present, `wrangler` authenticates in CI, and the validate step passes against what D1 actually holds. **If the validate step fails, that is a finding about the live content, not about the workflow** — a document in D1 that this repository's own guards reject is exactly what this job exists to surface, a week at a time.

- [ ] **Step 5: Write the recovery down**

```
## Recovering the content if D1 is lost

1. `git log -- src/content` and pick the export commit before the loss.
2. `git checkout <sha> -- src/content`
3. Clear the table first if the intent is a full restore -- seed:content refuses
   to overwrite an existing row:
   `npx wrangler d1 execute via-bianca-content --remote \
      --command="DELETE FROM content WHERE path LIKE 'src/content/%'"`
4. `npm run seed:content -- site.json galleries.json dishes.json drinks.json \
     menus.json copy.json sections.json pages.json experiences.json posts.json story.json`
   (awards.json has no file; restore it from Time Travel or re-enter it.)
5. `node scripts/export-content.mjs` to regenerate the floor, then `npx wrangler deploy`.
6. `npm run verify:deploy`.

The window this covers is unbounded, because the exports are git history. D1's
own Time Travel covers seven days on the free plan and is faster where it
applies; this is what covers day eight onward.

The photographs are NOT part of this. They are in R2, nothing in this system
ever deletes an R2 object (decision D9), and a restored document that names an
older photograph still resolves.
```

- [ ] **Step 6: `npx tsc -b --noEmit && npm test -- --run src/content/__tests__/floor-header.test.ts && npm run gate`**

- [ ] **Step 7: Commit before mutating.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| delete the "A FALLBACK" header from `src/content/index.ts` | "states plainly that these files are not the live content", **and** `npm run export:content` exits 1 | — |
| remove the database name from the header | "names where the live content actually is" | — |
| remove the fresh-clone sentence | "says a fresh clone does not build the live site" | — |
| remove the `Validate what came back` step from the workflow | seed a deliberately broken `sections.json` into a scratch D1 database, point the workflow at it, confirm it commits the broken document | Procedural, and **do not skip it**: a scheduled job that commits whatever it is given is a scheduled job that can break the build on a Monday morning with nobody watching. |
| change the workflow's `git diff --quiet` guard to always commit | the run's own log — an empty commit every week | Not test-detectable and not worth a test; the log is the check. |
| point the cron at the same minute as the Worker's `17 3 * * *` | nothing automated | Recorded rather than tested. The two jobs touch different systems; the separation is politeness, not correctness. |

**CSS ceiling:** zero bytes. `.github/`, `scripts/` and `docs/` are outside the content glob; `src/content/index.ts` is inside it and the header above was written without bare utility tokens — re-read it for `table`, `block`, `static` and `filter` before committing. It contains the word `database`, which is not a Tailwind utility.

**If this task is wrong:** the content is recoverable only for seven days, and a corruption nobody notices for a fortnight is unrecoverable.

---

## Task 23: The final sweep — D1 pulled again, a publish watched, an undo round-tripped, the images swept

The four things the spec's Testing section demands, each done **against the live site rather than against a fixture**, and each producing a written record.

**Files:**
- Create: `e2e/publish-live.spec.ts`
- Modify: `docs/cloudflare-cutover.md`
- Modify: `src/test/bundle.post-build.test.ts` (the ceiling audit)

**Interfaces:**

- Consumes: `VB_LIVE=1` and `VB_EDIT_PASSWORD` from the human running Step 2; an authenticated `npx wrangler` for Step 1.
- Produces: no new module and no new function. **Four written records** in `docs/cloudflare-cutover.md`, plus either a confirmation of the entry CSS number or a change with a rule-level accounting.

- [ ] **Step 1: Prove the site renders stale rather than empty with EVERY document in D1**

Task 13 induced this with three documents in D1 and nine in git. **This is the same drill against the end state**, which is the one that matters: now every document is a D1 row and the compiled bundle is a week-old export rather than a same-day commit.

```
cp wrangler.toml /tmp/wrangler.real.toml
sed -i '' 's/database_id = "7ec61770-4fb1-4458-9c34-46b92bb9702c"/database_id = "00000000-0000-4000-8000-000000000000"/' wrangler.toml
npx wrangler deploy
```

Within two minutes:

```
curl -sSI https://viabiancarestaurant.com/ | grep -i x-content-source                # floor; d1=0/12
curl -sS  https://viabiancarestaurant.com/ -o /dev/null -w '%{http_code}\n'          # 200
curl -sS  https://viabiancarestaurant.com/ | grep -c 'id="vb-content">{}</script>'   # 1 -- island EMPTY
curl -sS  https://viabiancarestaurant.com/ | grep -c '<div id="vb-crawl">'           # 1 -- crawl block FROM THE FLOOR
curl -sS  https://viabiancarestaurant.com/ | grep -o '<h3>[^<]*</h3>' | head -3
```

Open the homepage, `/blogs`, `/edit` and one standalone page in a browser. **Every page must render, with photographs, with a menu, from the compiled bundle.** Then restore:

```
cp /tmp/wrangler.real.toml wrangler.toml
npx wrangler deploy
curl -sSI https://viabiancarestaurant.com/ | grep -i x-content-source                # d1; d1=12/12
```

Record in `docs/cloudflare-cutover.md`: the timestamp, the exact `x-content-source` values before, during and after, and the answer to *"did any page render empty"* — **which must be no.** If any page rendered empty, that is a defect in `readBundle`'s floor loop or in `live.ts`'s merge, and it is found here rather than during a real outage.

- [ ] **Step 2: Prove the edge cache is invalidated by the publish, in a browser**

The spec is explicit that a test which only checks the cache key is not proof: *"a publish purges the cache entries it affects, and the plan proves it by publishing and then reading the live page in a browser."*

```ts
// e2e/publish-live.spec.ts
//
// Run against PRODUCTION, not the dev server, and skipped unless VB_LIVE is set
// -- this spec publishes a real change to the real restaurant's real website
// and puts it back. It is NOT part of the pre-push suite.
//
//   VB_LIVE=1 VB_EDIT_PASSWORD=... npx playwright test publish-live.spec.ts
//
// What it proves that a unit test cannot: that the edge cache, which nothing in
// this system explicitly purges, really does stop serving the old body the
// moment a publish lands. The mechanism is that the cache KEY carries the
// content stamp and a publish bumps a version, so the old key is simply never
// asked for again. That is a claim about Cloudflare's behaviour, and only
// Cloudflare can answer it.
import { test, expect } from '@playwright/test';

const LIVE = process.env.VB_LIVE === '1';
const SITE = 'https://viabiancarestaurant.com';

test.skip(!LIVE, 'set VB_LIVE=1 to run against production');

test('a published change is on the live page before the next request finishes', async ({ page, request }) => {
  const marker = `probe-${Date.now()}`;

  await page.goto(`${SITE}/edit/manage`);
  await page.getByLabel('Password').fill(process.env.VB_EDIT_PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /via bianca/i })).toBeVisible();

  // A dish DESCRIPTION, not a strapline: dishes.json is the last document to
  // move and the one the whole migration was ordered around, and it is rendered
  // into both the island and the crawl block -- so this one probe exercises
  // every layer at once.
  const field = page.getByLabel(/description/i).first();
  const original = await field.inputValue();
  await field.fill(marker);
  await page.getByRole('button', { name: /^publish$/i }).click();
  await expect(page.getByText(/live/i)).toBeVisible({ timeout: 60_000 });

  // A RAW HTTP READ, not a browser navigation: a browser might answer from its
  // own cache and prove nothing about the edge. This asks the edge.
  const served = await request.get(SITE, { headers: { 'Cache-Control': 'no-cache' } });
  const body = await served.text();
  expect(body).toContain(marker);                      // in the crawl block
  expect(served.headers()['x-content-source']).toContain('d1');

  // And in a real browser, freshly loaded -- the island half.
  await page.goto(SITE);
  await expect(page.getByText(marker)).toBeVisible();

  // Put it back, and prove the revert is equally immediate -- which also proves
  // the first half was not a coincidence of timing.
  await page.goto(`${SITE}/edit/manage`);
  await page.getByLabel(/description/i).first().fill(original);
  await page.getByRole('button', { name: /^publish$/i }).click();
  await expect(page.getByText(/live/i)).toBeVisible({ timeout: 60_000 });
  expect(await (await request.get(SITE, { headers: { 'Cache-Control': 'no-cache' } })).text()).not.toContain(marker);
});
```

- [ ] **Step 3: Prove undo round-trips across the new paths, byte for byte**

The spec: *"Undo across the new paths: one publish, one restore, byte-identical content back."* Compared rather than eyeballed:

```
curl -sS https://viabiancarestaurant.com/ \
  | grep -o '<script type="application/json" id="vb-content">.*</script>' > /tmp/before.txt
# ... publish a change to one dish description at /edit/manage ...
# ... press Undo ...
curl -sS https://viabiancarestaurant.com/ \
  | grep -o '<script type="application/json" id="vb-content">.*</script>' > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo 'BYTE-IDENTICAL'
```

The islands must be identical. **If the diff shows anything, read it:** a difference in whitespace or key order means the publish path re-serialised a document somewhere instead of storing the exact text, which `worker/migrations/0001_content.sql`'s own comment says must never happen because `sha` is a hash of that text. The `version` bump is not in the island — it is only in the cache key — so it cannot be the cause.

**Then a photograph undo, which is the case decision D9 exists for:** replace a dish photograph, publish, undo, and check the document points at its original URL again **and that URL still answers 200.** It will, because nothing in this system ever deletes an R2 object. This is the check that D9 was right.

- [ ] **Step 4: The final image sweep, on the real site, against the real island**

```
npm run verify:images
npm run verify:deploy
```

`verify:images` now sweeps the **union** of the live island — which contains documents this repository does not hold — and the committed floor. This is the acceptance criterion of the whole image half, measured against the live site rather than a fixture. **Record the count.** It must be at least 69 distinct references, all resolving.

- [ ] **Step 5: The CSS ceiling audit**

Every task in this plan expected zero except Task 21, which lowered it. Verify the accumulated total rather than trusting twenty-three individual claims:

```
npm run build && ls -l dist/assets/index-*.css
```

If it moved from the number Task 21 recorded:
1. Diff the rule lists (`grep -o '^[^{]*{' dist/assets/index-*.css | sort` on both sides, with the previous build restored from `git stash`).
2. Trace each new rule to the file and the comment or class that minted it.
3. If it is a **comment leak** — a bare utility token in prose inside `./src/**` or `./index.html` — **reword the comment and rebuild.** That is the ninth leak on this project and it is a fix, not a raise.
4. If it is a **real class on a real element**, raise the ceiling in this same commit with the rule-level accounting the file's comment lineage requires.

- [ ] **Step 6: Write the record**

A final numbered section in `docs/cloudflare-cutover.md`, with dates:

- the R2 custom domain, the disabled `r2.dev` subdomain, and the Task 1 round trip;
- the object count and the verified digests;
- the measured browser-vs-sharp derivative sizes, with the Chromium version, pointing at `docs/image-derivation.md`;
- the route widening and the Worker's measured requests/day;
- each batch of documents and the date its store flipped;
- **both** D1-unreachable drills and their `x-content-source` readings;
- the publish timing before (2–3 minutes) and after;
- the undo byte comparison and the photograph-undo result;
- the final sweep count;
- **the `GITHUB_TOKEN` deletion**, with the `wrangler secret list` output before and after;
- and the sentence that the repository is no longer the source of truth for content, pointing at Task 22's recovery section.

- [ ] **Step 7: `npm run gate && npm run verify:deploy`, then commit.**

**Mutation table**

| Mutation | Test that must redden | If it does not redden |
|---|---|---|
| in `content-bundle.ts`, drop the stamp from `bundleCacheKey` and use a fixed key | `e2e/publish-live.spec.ts` — the published marker never appears within the cache's lifetime | This is the one assertion in this plan that only production can make, and it is why Step 2 is a live spec rather than a unit test. |
| in `readBundle`, remove the floor loop | Step 1's live drill — pages render empty with D1 unbound | Do not skip Step 1 on the strength of Task 9's unit tests. `FakeD1` fails by throwing; a real unreachable D1 times out, and only the drill covers that. |
| set `Cache-Control` on the injected page to `public, max-age=300` instead of `no-store` | `e2e/publish-live.spec.ts`'s raw-HTTP read, within five minutes of a publish | — |
| have `D1Store.write` store `JSON.stringify(JSON.parse(body))` instead of the exact text | Step 3's `diff /tmp/before.txt /tmp/after.txt` | If the diff is empty anyway, the document happened to already be in canonical form — repeat with a document containing a trailing newline, which every committed file here has. |
| delete an R2 object that an older revision names | Step 3's photograph-undo check — the restored URL 404s | This is the check that decision D9 was right. If it passes with the object deleted, the undo is not actually restoring the older URL. |
| raise the CSS ceiling without a rule-level accounting | nothing automated | The ceiling test only checks the number. The accounting is a discipline, and the comment lineage in `src/test/bundle.post-build.test.ts` is where a reviewer checks it was kept. |

**CSS ceiling:** this task **is** the audit. It ends with a measured number and either a confirmation or a change with a full accounting.

**If this task is wrong:** the migration is finished and nobody has actually watched it work — the publish that looks instant might be reading a cached page, the floor that is supposed to catch a database outage might render empty, and the undo that says it restored might have re-serialised the document.

---

## What is deliberately not in this plan

Recorded so a reviewer can see they were decided rather than forgotten.

- **`assets-source/` is not emptied and `public/`'s fifty derivatives are not deleted.** That is a **separate commit whose entire content is a deletion**, made after the live site has served from R2 for at least one full week and after Task 23's sweep is green. Keeping them is what makes Task 6's rewrite revertible with one `git revert` — the derivatives are still built from `assets-source/` on every build until that commit, so a revert restores a working site with no R2 involvement at all. The deletion, when it happens: `git rm -r assets-source` **except `assets-source/atmosphere/dining.jpg`**, which `scripts/images.mjs`'s `encodeOgImage` still reads to produce `public/og-image.jpg`; then `npm run images` reduces to the share card alone and can come out of `build` and `gate`; then `worker/github.ts`'s `ASSET_PATH` is already gone (Task 18) and `src/shared/derivative-path.ts` loses its last caller. **The 201 MB does not leave `.git`** — history still holds every blob — and rewriting history was rejected: it would invalidate every existing clone and every commit sha the `revisions` table refers to, in exchange for disk space on a laptop. What this migration buys is that the repository **stops growing**, which happens at Task 18, and that a fresh clone's working tree eventually drops from 224 MB to about 3 MB.
- **`scripts/images.mjs` is not deleted and `npm run images` stays in `build`.** It keeps encoding the fifty originals still in the tree, keeps the collision and prune guards alive, keeps producing `og-image.jpg`, and exports `encodeDerivative` for `scripts/rederive.mjs`. Only the last two of those survive the deletion commit above.
- **`press.json` does not move and is not deleted.** It is compiled-in and not dashboard-editable, so moving its storage removes no commit and no deploy. Its 12 image references were rewritten in Task 6 like every other reference.
- **`og-image.jpg` stays on the site origin.** Decision D10.
- **`awards.json` gets no compiled client-side copy.** Recorded in Task 13's table as one of the contract's two honest negatives. Fixing it means giving this repository a file it deliberately does not hold.
- **No live publish preview.** The spec puts it in "What this does not do" and specifies it separately; it needs nothing from this migration and coupling them would only delay it.
- **No relational modelling of content.** The spec argues it at length and this plan adds nothing.
- **No hotlink protection on the image host.** R2 egress is free, so hotlinking costs nothing directly, and a rule can be added later. The spec decides this explicitly.
- **No R2 lifecycle rule, ever, on a live prefix.** It deletes by age, not by whether anything still uses the object, so a two-year-old photograph still on the menu is exactly as old as one replaced last month. If superseded images are ever cleared, they move to their own prefix first.
- **Workers stays on the FREE plan.** The owner's decision. The mitigation for D1's seven-day Time Travel window is Task 22's weekly export, which is built either way. Paying $5/month would widen the window to thirty days and is the owner's call, not this plan's.

---

## What breaks, ranked, and what makes each survivable

| Risk | Where it bites | What makes it survivable |
|---|---|---|
| A photograph 404s after the rewrite | Task 6 | The bucket was filled from the production CDN and digest-verified two tasks earlier; the rewrite is one `git revert`, and `npm run images` still rebuilds `public/` from `assets-source/`. |
| **Her publish is invisible because the island overwrote a fresh bundle** | Tasks 9–17 | **Decision D0.** The island carries only documents in `D1_ONLY_PATHS` that a D1 row answered for. Asserted in `content-bundle.test.ts`, in `site-page.test.ts` through the response, and in `verify:deploy` against the live island on every deploy. |
| The four D1-only references are missed | Task 7 | Task 2 reads them from the live endpoint and refuses to write an inventory it could not complete; Task 7 rewrites them through `POST /api/publish`, so the change is validated, revisioned, version-bumped and undoable. |
| A poisoned response is copied into the bucket | Task 4 | Refused unless the declared type is `image/webp` **and** the bytes are a complete RIFF WEBP **and** the RIFF-declared length equals the body length. |
| CSP silently blocks the image host | Task 1 | Widened and deployed five tasks before anything points there, checked in a real Chromium and on the wire. |
| `absoluteImageUrl` emits a doubled origin | Task 6 | Fixed in its own commit before the rewrite, tested for both input shapes, and proven on the wire at Task 7 Step 5. |
| The browser encoder produces something worse than sharp | Task 3 | Measured on three real photographs before it ships, with a documented re-measure at 0.72 if any exceeds 40%; the original is always stored, and `npm run rederive` re-encodes with the real pipeline. |
| The browser cannot encode WebP at all | Tasks 3, 18 | JPEG at 0.82, stored under the `.webp` key with the honest `Content-Type`. She keeps working; one photograph's compression ratio is the cost. |
| A replaced photograph or menu PDF is invisible for a week | Tasks 4, 19 | Two Cache-Control policies split on key shape (decision D8): content-addressed keys are `immutable`, human-named keys get a day. |
| D1 goes down | Task 13, Task 23 | The contract is a written table with a row per layer and two ⚠ negatives, induced in production twice. Photographs are unaffected because no image request touches the Worker. |
| The edge serves a stale page after a publish | Task 23 | The cache key carries the content stamp, so a publish makes the old key unreachable — proven by publishing and reading the live page with a raw HTTP request. |
| `site.json`'s ownership check reads stale | Task 16 | The one-line `storeFor` fix ships **before** `site.json` moves, in the same task, with a test asserting no GitHub read happened at all. |
| A corruption is found on day eight | Task 22 | The weekly export, validated in CI before it commits; the $5/month alternative is recorded rather than assumed away. |
| The Worker's GitHub token is misused | Task 21 | It is deleted. |
