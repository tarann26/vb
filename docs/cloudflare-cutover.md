# Cloudflare cutover checklist

For whoever is doing this cutover. Read this whole page before starting anything.

**The order below is deliberate and matters more than any individual step:**

- **Step 3 (verify the preview) comes before Step 5 (point DNS).** The preview deployment is
  free and catches problems before anyone visiting the live site can see them. If you point DNS
  first and something is wrong, the restaurant's live site is broken while you debug. Do not
  skip ahead to DNS because the preview "looks fine at a glance" — run the two checks in Step 3
  for real.
- **The Vercel deployment stays live until Step 7, the very last step.** It is the rollback. As
  long as Vercel is still serving the domain (or is one DNS change away from serving it again),
  a bad cutover is an afternoon of debugging. The moment you delete the Vercel project, it's an
  outage instead. Do not remove it early to "clean up" — it costs nothing to leave running for
  the duration of this checklist.

## 1. Create the Cloudflare Pages project

Create a Cloudflare account if one doesn't exist yet, then create a Pages project connected to
this GitHub repository.

## 2. Set the build configuration

**After entering the build command below, jump to Step 13 and do that check now, before moving on
to Step 3** — it confirms what you just typed into the dashboard actually landed the way this page
describes, before anything downstream comes to depend on it silently matching.

- **Build command:** `npm run images && npm run test:deploy && npm run build`
  Yes, `npm run images` runs twice — once here, once again inside `npm run build` (which runs
  `npm run images && tsc -b && vite build && npm run test:bundle`). That costs about six seconds.
  It is not a mistake: `npm run test:deploy` runs the test suite, and Task 2 of the migration plan
  made `public/` derivatives untracked, so on a fresh clone (exactly what Cloudflare builds from)
  they do not exist until `npm run images` has run at least once. Run the test gate before those
  derivatives exist and the asset and OG-image tests fail — not because anything is broken, but
  because nothing has generated the images they check for yet. Run `npm run images` here first and
  the gate tests what it's supposed to: a real build, gated by tests that see the real output.

  `npm run test:bundle` (Plan 4 Task 1) is the last step of `npm run build` itself, not a separate
  entry in the command above — it runs `src/test/bundle.post-build.test.ts` against the just-built
  `dist/assets/`, after `vite build` has produced a real `dist/` for it to inspect. Its main job now
  is confirming admin code (the `/edit/manage` dashboard) stays out of the entry chunk every visitor
  downloads, never in the main bundle regardless of who's looking at the site; it also still greps
  for the admin-only libheif WASM marker, the narrower check this file started as. Because it's
  nested inside `npm run build` rather than appended to the
  outer command this bullet documents, the text you paste into the dashboard's Build command field
  does not need to change for this — but if that field was ever hand-typed as something other than
  a literal `npm run build` call, re-verify it with Step 13 below rather than assuming this update
  reached it. Nothing in this repository can read what the dashboard actually holds.
- **Output directory:** `dist`
- **Node version:** read it from `.nvmrc` at the repo root rather than typing a number into the
  dashboard from memory — Cloudflare Pages picks up `.nvmrc` automatically. If the dashboard asks
  you to enter one explicitly anyway, copy the value in `.nvmrc` verbatim.

  What's actually known about that number, so a version-related build failure isn't a mystery:
  this project was developed and fully tested on Node 25.4.0. `.nvmrc` is pinned to **22**
  instead, not because 25 failed anything, but because 25 is an odd-numbered, non-LTS release
  that Cloudflare's build image may not carry, and 22 is the current LTS and certain to be
  available there. The project's verified real floor is **Node 20.11**, set by `import.meta.filename`
  in `scripts/images.mjs`; every other tool in the chain (`sharp` 0.35, Vite 5, Vitest 2) supports
  Node 18+. This has not been tested on Node 22 or any version other than 25.4.0 — there was no
  version manager available to do so. If the build fails specifically on the Node version, try
  anything from 20.11 up to 25; the code itself has no known upper- or lower-bound issue in that
  range.

## 3. Verify the preview deployment — before touching DNS

Cloudflare will build a preview URL on the first deploy. Before you go anywhere near DNS, check
both of these on that preview URL. Both have caught real problems for other projects; neither is
optional.

- **Hard-refresh `/blogs` and confirm it returns the page, not a 404.** This is the only real way
  to confirm the `_redirects` SPA rewrite is working in production. It could not be verified
  locally: Cloudflare's local dev server (Wrangler) flags this exact rule as a false-positive
  "infinite loop" and falls back to its own built-in SPA handling instead, so a passing `curl`
  against `wrangler pages dev` proves nothing — it would return 200 with or without
  `_redirects` in place. Only a real Cloudflare Pages deployment actually exercises the rule.
- **Check the build log for the image-generation step, and confirm it reports 48 images.** This
  build is the first time `sharp` (the library that generates every product image from
  `assets-source/`) has ever run in this project's production pipeline — on Vercel it never ran
  as part of the deploy. The lockfile carries the Linux binaries `sharp` needs, so it should
  resolve without incident, and if it doesn't the build fails loudly rather than shipping a
  broken site. Still, check the log on this first deploy rather than assuming it worked.

If either check fails, stop and fix it before proceeding — do not move on to DNS with a known
problem.

## 4. Enable Web Analytics

Cloudflare offers two ways to wire up Web Analytics. **Use only the first one below.** Mixing
both puts two beacon scripts on every page, and Cloudflare counts each beacon's pageview
independently — the owner would see roughly double the real traffic with no error, warning, or
obvious tell that anything was wrong.

- **Dashboard toggle for this Pages project (use this one).** In the Cloudflare dashboard, go to
  Workers & Pages → this project → **Metrics** → **Enable** under Web Analytics. (Cloudflare's own
  docs currently label this tab **Metrics**, not Analytics — see the note below the next bullet if
  what you see doesn't match.) That's the whole dashboard step, but the dashboard step alone is
  **not enough to finish this task** — keep reading past the next bullet before moving on.
  Cloudflare adds its own beacon script to this project's pages **on the next deployment**, not
  automatically to every response starting immediately — the `*.pages.dev` preview, the eventual
  custom domain, and every deploy after that one, but only once a deployment has actually
  happened after you flip the toggle. This repository deliberately ships with **no** beacon
  `<script>` in `index.html` (see the comment there) and a test (`src/test/analytics.test.ts`)
  that fails if one is added back by hand, specifically so nobody re-introduces the second-beacon
  failure mode by "helpfully" wiring up analytics in code that Cloudflare is already handling.
- **Manual snippet, for a site not on Cloudflare at all (do not use this one here).** Cloudflare
  also documents copying a token into a hand-placed `<script>` tag, for sites that aren't
  Cloudflare Pages or Workers projects. That path does not apply to this project — do not add
  that script to `index.html`. If the dashboard ever shows you a manual snippet instead of a
  one-click **Enable** for this Pages project, stop and double-check you're looking at the Pages
  project's own Metrics tab rather than the generic "Add a site" flow. One caveat on that tab name:
  Cloudflare's dashboard has reportedly moved this control before (a "manage" one-click entry
  people expected has been reported missing in Cloudflare's own docs-repo issue tracker), so treat
  "Metrics" as what the docs say today, not as a guarantee of what you'll see — if neither
  Metrics nor Analytics is there, look for whatever tab shows this project's traffic and Web
  Analytics status.

Once enabled, that dashboard toggle is **not, on its own, enough**. Cloudflare's documentation is
explicit that the beacon script is added on the *next deployment*, not the next request served —
and nothing later in this checklist causes a deployment on its own: Step 5 is DNS, Step 6 is
verification, Step 7 deletes the Vercel project. Stop here and this cutover finishes with Web
Analytics "enabled" in the dashboard and **no beacon ever shipped**, with nothing anywhere telling
you.

- **Trigger a redeploy now, before doing anything else.** In the Cloudflare dashboard: this
  project → **Deployments** → find the current production deployment → **Retry deployment**. (Any
  push to the branch this project builds from also works, but Retry deployment is faster and needs
  no code change.) This step is commit-free but it is not redeploy-free — do not skip it because
  the toggle itself didn't ask you to commit anything.
- **Verify the beacon actually shipped, on the preview URL, before moving on.** View source on the
  preview URL (the rendered page isn't enough — the beacon is injected into the HTML Cloudflare
  serves, not visible from a glance at the page) and confirm a `beacon.min.js` script tag is
  present, loaded from `static.cloudflareinsights.com`. If it's missing, either the toggle didn't
  take or the redeploy above didn't happen — do not proceed until it's there.

Then, still before moving on to Step 5 (DNS), **re-run both Step 3 checks against the preview
URL** — a hard refresh on `/blogs` still returns the page, and the build log still reports 48
images. That costs nothing and Step 3 said to check for real rather than assume.

**What this analytics setup gives you, and what it doesn't.** Free Cloudflare Web Analytics
reports page views, referrers, device/browser split, and Web Vitals, broken down per page. **It
does not track conversions or custom events.** There is no built-in way to count clicks on the
WhatsApp reservation button through this beacon — an earlier version of this codebase tried to
wire up a `trackEvent` call for that, but that API doesn't exist in Cloudflare's actual beacon
script, and the attempt was removed. Counting WhatsApp reservation clicks is planned for a later
project phase (Plan 3), where a Cloudflare Worker can log that server-side instead. Don't expect
or promise conversion numbers out of this analytics setup — page-level traffic is all it does.

## 5. Point DNS at Cloudflare Pages

Only after Step 3 has passed both checks and Step 4 is done. Update the domain's DNS records to
point at the Cloudflare Pages project, following Cloudflare's instructions for the custom domain.

**Also handle `www`, even if nobody plans to advertise it.** The Worker route in `wrangler.toml`
(`viabiancadelhi.com/api/*`) matches the apex only, and `WA_ORIGIN` in `worker/index.ts` is
hardcoded to `https://viabiancadelhi.com` — neither matches `https://www.viabiancadelhi.com`. If
`www` ever resolves to this Cloudflare Pages project (common: someone types it, an old link points
at it, a DNS record gets copied from a template), every `/api/*` request made against that hostname
falls through to the SPA catch-all in `public/_redirects` and gets back **200 with the homepage's
HTML** — `sendBeacon('/api/wa')` reports success while counting nothing, and login and publish get
HTML back where they expect JSON. That is the exact silent-200 failure this project's own
`_redirects` comment already had to work around once for `/api/*` on the apex (see that file); a
served-but-unredirected `www` is the same hole, one hostname over. Close it now, before DNS goes
live, not after someone reports "the site is broken on www":

- In the Cloudflare dashboard for this zone, add a redirect that sends `www.viabiancadelhi.com/*`
  to `https://viabiancadelhi.com/$1` with a 301 — a **Redirect Rule** (Rules → Redirect Rules →
  Create rule, matching `hostname eq "www.viabiancadelhi.com"`) or a **Bulk Redirect** both work;
  use whichever this account's plan offers. Do not add `www` as a second custom domain on the
  Pages project itself and leave it unredirected — that is exactly the configuration that falls
  through to the SPA catch-all above instead of ever reaching the redirect.
- Confirm the DNS record for `www` actually exists and is proxied (orange-clouded) through
  Cloudflare — a redirect rule does nothing for a hostname that isn't on Cloudflare's network at
  all.

Step 10 below extends the deploy-time curl check to `www` specifically, so this doesn't rely on
someone remembering to test it by hand later.

## 6. Verify the live site

Once DNS has propagated, check the live domain itself (not just the preview URL):

- Images load across the site.
- `/blogs` deep-links correctly (hard refresh, not just in-app navigation).
- Both menu PDFs download from the "Food Menu" and "Drinks Menu" buttons.
- The WhatsApp reservation button opens WhatsApp with the pre-filled message.
- Web Analytics (Cloudflare dashboard → this project → Metrics → Web Analytics) shows **at least
  one page view** — the visit you just made checking the items above should be enough to register
  one. If it's still zero, the beacon that Step 4 verified on the preview URL didn't make it onto
  the live domain. Do not close out this checklist, and do not proceed to Step 7, until it does —
  Step 7 deletes the rollback, and there will be no other signal that analytics is broken.

## 7. Remove the Vercel project

Only after Step 6 passes on the live domain. This is the point of no easy rollback, so don't
rush it — but once you're here, decommission the Vercel project. The site is fully cut over.

## 8. Create the admin Worker's KV namespace (separate from the cutover above)

This step is unrelated to Steps 1–7 — it does not touch DNS, Pages, or the live site, and has no
ordering dependency on them. It exists because `wrangler.toml` needs a KV namespace id, and
creating one requires Cloudflare account access that whoever built the Worker scaffold did not
have. `wrangler.toml` currently carries an obviously-fake placeholder
(`PLACEHOLDER-NOT-A-REAL-NAMESPACE-ID`) instead of a real id — inventing a plausible-looking id in
its place would have looked correct in review and failed only at deploy time, silently, with the
Worker unable to bind `env.KV`.

A human with Cloudflare account access must, before the admin Worker is ever deployed:

1. Run `wrangler kv namespace create via-bianca-admin-kv` (or `npx wrangler kv namespace create
   via-bianca-admin-kv` if `wrangler` isn't installed globally).
2. Copy the `id` it prints.
3. Paste it into `wrangler.toml`, replacing `PLACEHOLDER-NOT-A-REAL-NAMESPACE-ID` on the
   `[[kv_namespaces]]` block's `id` line.

`src/test/wrangler-config.test.ts` accepts either the placeholder or a well-formed 32-character hex
id, so completing this step does not, itself, break `npm run test:deploy` — that test used to pin
the placeholder by exact string equality, which meant finishing this step was indistinguishable
from typing garbage: both replaced the placeholder with something that wasn't it, and the old test
failed on either. What still fails it is an invented or half-pasted value instead of the real one
`wrangler kv namespace create` printed (an empty string, a truncated id, `PLACEHOLDER-partially-
edited`) — that guards against a plausible-looking fake id passing review and only failing at
deploy time, silently, with the Worker unable to bind `env.KV`.

## 9. Create a GitHub token for the Worker, and set `GITHUB_TOKEN`

Unrelated to Steps 1–8 above (no ordering dependency on DNS, Pages, or the KV namespace), but
required before `POST /api/publish` or `POST /api/upload` (Tasks 5 and 6 of the worker plan) can
ever succeed. `worker/github.ts` sends `Authorization: Bearer ${env.GITHUB_TOKEN}` on every commit
it makes — with no token set, every publish and every photo upload fails with a `502` reading
`could not read the current main branch (GitHub returned 401) -- Bad credentials`, and login still
works fine, so the first sign anything is wrong is her pressing Publish on real content.

1. GitHub → your account's avatar → **Settings** → **Developer settings** (bottom of the left
   sidebar) → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Resource owner:** the account or organization that owns this repository (`tarann26`).
   **Repository access:** **Only select repositories** → `tarann26/vb`. Do not grant access to any
   other repository — this token only ever needs to touch this one.
3. **Permissions → Repository permissions → Contents: Read and write.** (GitHub will also require
   **Metadata: Read-only**, added automatically — that's expected and sufficient; no other
   permission is needed. `worker/github.ts`'s own path allowlist, not this token's scope, is what
   keeps a publish confined to `src/content/` and `assets-source/` even though the token itself can
   write anywhere in the repository — see that file's comment.)
4. Set an expiration and **write down when it expires somewhere you'll actually see it** — a
   fine-grained token that lapses silently turns into the exact same `401` failure as never having
   set one at all, just months later and harder to place. Generate the token and copy it
   immediately; GitHub shows it exactly once.
5. Set it as a Worker secret:
   ```bash
   printf '%s' '<the token you just copied>' | npx wrangler secret put GITHUB_TOKEN
   ```
   (`printf '%s'`, not `echo` — no trailing
   newline even offered to the pipe, on top of `wrangler secret put` already trimming trailing
   whitespace from piped stdin.)

This is the token Step 11 below refers to when it says the password's own entropy is the real
control, "since the prize for guessing it is a GitHub token with write access to this site's
repository."

## 10. Deploy the admin Worker, then confirm its route is actually live

Do this after Step 8 (the KV namespace exists), Step 9 (`GITHUB_TOKEN` is set), and after DNS
(Step 5) has the zone on Cloudflare — the Worker's route (`viabiancadelhi.com/api/*` in
`wrangler.toml`) is meaningless on a zone Cloudflare doesn't control yet.

1. `wrangler deploy` (from the repo root; needs a Cloudflare API token with Workers-deploy
   permission, either via `wrangler login` or a `CLOUDFLARE_API_TOKEN` env var).
2. **Immediately after, run this — do not skip it and do not assume the deploy log is enough:**

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://viabiancadelhi.com/api/health
   ```

   Expected: `200 application/json`. If it instead prints `text/html`, the Worker route is not
   active — the request fell through to the Pages SPA catch-all instead of reaching the Worker —
   and **every** `/api/*` call (login, publish, upload, the WhatsApp tap counter) is silently
   hitting the same catch-all right now. Stop here and fix the route before doing anything else;
   do not treat a successful `wrangler deploy` as proof the route works.
3. **Then run the same check against `www`** (see Step 5's own note on why this hostname needs
   handling at all):

   ```bash
   curl -sL -o /dev/null -w '%{http_code} %{content_type}\n' https://www.viabiancadelhi.com/api/health
   ```

   `-L` here, unlike the apex check above, because `www` is expected to answer with a 301 to the
   apex first (Step 5's redirect) — this follows that redirect and checks what it actually lands
   on. Expected result is the same: `200 application/json`. `text/html` here means either the `www`
   redirect isn't in place or `www` is being served directly by Pages without one — both leave
   `/api/*` on `www` silently answering with the homepage.

**This curl check is the only reliable way to confirm the route is live — nothing committed to
this repository can do it.** `public/_redirects` cannot express "fail loudly" for an unrouted
path (Cloudflare Pages' `_redirects` only accepts status 200, 301, 302, 303, 307 or 308, so there
is no way to make it answer `/api/*` with a 404 the way a real misconfiguration should look); its
SPA catch-all will happily return 200 with the homepage's HTML for `/api/health` too, if the Route
isn't actually intercepting the request first. `src/test/hosting.test.ts` pins that the *route
configuration* in `wrangler.toml` names the right pattern and zone, which catches a config typo
before it ships — but it cannot observe whether Cloudflare is actually honouring that
configuration on the live zone. Only a real request against the live domain, after a real deploy,
can. Re-run the same curl (both hostnames) after any future change to `wrangler.toml`'s `routes` or
the `www` redirect, not just the first time.

## 11. Set the admin login password, and how to rotate it

Unrelated to Steps 1–10 above (no ordering dependency on DNS, Pages, or the KV namespace) but
required before `POST /api/login` (Task 4 of the worker plan) can ever succeed. `env.ADMIN_PASSWORD_HASH`
and `env.TOKEN_SECRET` are Worker secrets, not `wrangler.toml` vars — `wrangler.toml` carries only
non-secret bindings by design, and `src/test/secrets.test.ts` fails the build if a real password
hash or token ever lands in a committed file.

**What happens with each secret unset, precisely** (an earlier version of this section claimed
both fail closed "not silently" — that was wrong for one half, caught in review):
with `ADMIN_PASSWORD_HASH` unset, every login attempt gets a clean `401` (`verifyPassword` has
nothing to check the attempt against, and fails closed rather than throwing). With `TOKEN_SECRET`
unset, every login attempt — **even with the correct password** — gets a clean `500`
(`{"message":"Login is not configured."}`) rather than a raw Cloudflare error page. That second
half was not always true: `worker/index.ts`'s `handleLogin` and `worker/auth.ts`'s `verifyToken`
both now check the secret is present before doing anything that would otherwise throw on a
zero-length HMAC key — see `worker/auth.ts` for why an unset secret used to be an unhandled throw,
not a clean failure.

1. **Generate the password, hash it, and set it as a Worker secret in one pipeline — don't run
   `hash-password.mjs` a second time with nothing piped into it.** An earlier version of this step
   split this into two commands: one that piped a generated password into `hash-password.mjs` and
   printed the hash, then a second that ran `hash-password.mjs` *again* with no stdin at all, which
   makes it prompt interactively — a reader following that literally would type or paste the
   *hash* from step one into that second prompt, hashing an already-hashed value instead of setting
   it. One composed pipeline has no second prompt to get confused by:
   ```bash
   openssl rand -base64 24 | tee /dev/tty | node scripts/hash-password.mjs | npx wrangler secret put ADMIN_PASSWORD_HASH
   ```
   `tee /dev/tty` shows you the generated password once, in the middle of the pipeline, so you can
   save it in a password manager before it's gone — the alternative of typing a password yourself
   tends to produce something far weaker than 24 random bytes. (Confirmed safe against the CLI
   adding stray whitespace: `wrangler secret put` trims trailing whitespace from piped stdin, so
   the trailing newline `console.log` puts after the hash does not end up stored as part of the
   secret.) The rate limit below is best-effort, not a hard wall, which is exactly why password
   strength — not the rate limit — is the control that actually matters here.
2. Set `TOKEN_SECRET` — the HMAC key session tokens are signed with, unrelated to the password
   itself — the same way, e.g.:
   ```bash
   openssl rand -base64 32 | npx wrangler secret put TOKEN_SECRET
   ```

**The 5-attempts-per-15-minutes login rate limit is best-effort, not a hard guarantee.** It's a
non-atomic KV `get`-then-`put` (see `worker/ratelimit.ts`), and Workers KV is eventually
consistent with edge caching on reads — a fast concurrent burst of guesses can read a stale count
before any of their writes land, so the real ceiling under a determined, distributed attacker is
softer than "5". This is not a bug to fix here: the brief's KV design was chosen specifically
because the alternative, the Workers Rate Limiting binding, can't express a 15-minute window
(`period` must be 10 or 60 seconds), counts per Cloudflare location rather than globally, and has
no API to reset the counter on a successful login. Given that, **the password's own entropy is the
real control** — the prize for guessing it is a GitHub token with write access to this site's
repository — which is why Step 1 above generates one rather than asking you to choose one.

**Required, not optional: a Cloudflare WAF rate-limiting rule on `/api/login`.** The KV limiter
above is best-effort in a second way too, verified directly: a KV whose writes are failing (KV
Free's 1,000-writes/day cap, shared across every write this Worker makes, chief among them this
same login limiter's own bookkeeping) used to make a wrong password crash the request into a raw
Cloudflare exception page instead of a clean `401` — `worker/index.ts` now catches that specific
failure and still returns the right status, but the counter genuinely cannot increment while KV is
exhausted, which means zero guesses get blocked for as long as that lasts. There is no durable,
atomic cap on this route from the Worker alone. Close that at the edge, in front of the Worker, as
part of this cutover:

1. Cloudflare dashboard → this zone → **Security** → **WAF** → **Rate limiting rules** → **Create
   rule**.
2. Match: **URI Path** equals `/api/login`.
3. Rate: this rule exists to hold the line under KV exhaustion, not to duplicate the KV limiter's
   exact 5-per-15-minutes — 10 requests per 1 minute per IP is a reasonable starting point; adjust
   if it ever false-positives against the one real person using this endpoint.
4. Action: **Block** (or **Managed Challenge**, if this account's plan doesn't offer Block on this
   rule type).
5. Deploy the rule.

This is the same reason the Workers Rate Limiting binding was rejected in favour of hand-rolled KV
counters above — that binding can't express a 15-minute window either, so it was never a substitute
for this edge rule, only for the in-Worker bookkeeping.
**Changing the password signs out every existing session, immediately.** This used to be false, and
was fixed after the owner asked the obvious question: *"then what would I even accomplish if I
change the password if a hacker got in?"* Nothing, was the honest answer — an attacker holding a
live cookie kept full write access to this site's GitHub repository for up to another seven days,
because a session's validity came from an HMAC over `TOKEN_SECRET` alone and the token said nothing
about which password produced it. Documenting that behaviour (as this section previously did) is
not the same as defending it: the workaround only worked for someone who knew to read this page
first, and "I changed my password and was not logged out" is not a thing any human expects.

`worker/auth.ts` now derives the signing key from **`TOKEN_SECRET` bound to the current
`ADMIN_PASSWORD_HASH`** (`sessionKey()`). Change the password and every signature ever issued stops
verifying — with no extra byte in the cookie, no storage added, and no lookup added to a request.
So this alone is enough to lock out anyone already holding a session:

```bash
node scripts/hash-password.mjs <<< 'your new password' | npx wrangler secret put ADMIN_PASSWORD_HASH
```

It logs out whoever runs it too; log back in with the new password right after. Takes effect
immediately — a Worker secret, not something baked into the build, so no deploy is needed.

`worker/__tests__/index.test.ts`'s login test pins this directly: the same token, the same
`TOKEN_SECRET`, a different password hash, and it must not verify. Reverting `sessionKey()` to
return `secret` alone turns that test red with *"expected true to be false"* — confirmed.

Rotating `TOKEN_SECRET` as well is still available and still valid; it is simply no longer required
to achieve revocation:

```bash
openssl rand -base64 32 | npx wrangler secret put TOKEN_SECRET
```

## 12. Set up build-status reporting (separate from Steps 1-11)

`GET /api/build-status` needs its own Cloudflare credential before it works in production. This has
no ordering dependency on Steps 1-11, but it needs the Pages project from Step 1 to already exist.

There is no deploy hook to create and no `DEPLOY_HOOK_URL` secret to set. This Worker exports no
`scheduled` handler and `wrangler.toml` declares `crons = []`: publishing is instantaneous, and
every build is triggered by Cloudflare's own build-on-push integration. If a `DEPLOY_HOOK_URL`
secret was set on this Worker by an earlier revision of this runbook, delete it -- nothing reads it:

```bash
npx wrangler secret delete DEPLOY_HOOK_URL
```

### 12a. The cron: why `crons = []` and not a missing `[triggers]` section

An earlier revision of this Worker registered an hourly `0 * * * *` trigger. When the scheduling
subsystem was removed, `wrangler.toml`'s `[triggers]` section was deleted with it — and that did
**not** unregister the cron. Cloudflare stores a Worker's schedules on the script, and `wrangler
deploy` only ever clears them by issuing `PUT /accounts/<id>/workers/scripts/<name>/schedules`,
which its own code guards behind `if (crons)`. A missing section normalises to `crons: undefined`,
which is falsy, so no request is made and the existing schedule survives every deploy.

The consequence was live and observable: the trigger kept firing hourly against a script with no
`scheduled` export, 24 failed invocations a day, forever. Checked read-only against the account
while the section was missing:

```bash
curl -H "Authorization: Bearer <token>" \
  https://api.cloudflare.com/client/v4/accounts/<account id>/workers/scripts/via-bianca-admin/schedules
# -> {"result":{"schedules":[{"cron":"0 * * * *", ...}]},"success":true}
```

`[triggers]` / `crons = []` is the fix: `[]` is truthy, so the clearing PUT fires with an empty
list. **Leave it in place.** Deleting it once the schedule is gone puts this Worker straight back
into the state above, where re-adding a `scheduled` export for an unrelated reason silently starts
an hourly job. `src/test/wrangler-config.test.ts` pins that the section exists and that the list is
empty, so neither can drift silently again.

**This does not take effect on a push.** Cloudflare Pages builds the site from `main`; the Worker
is deployed by hand (Step 6). Until someone runs `npx wrangler deploy` from the repo root, the
hourly trigger is still registered and still firing. Verify it afterwards with the same read-only
`GET .../schedules` call above — `{"schedules":[]}` is the state this section is claiming.

### 12b. Create a Pages-scoped API token, and fill in the account/project identifiers

`GET /api/build-status` reads Cloudflare's own Pages deployments API, which needs its own
credential — **do not reuse** any token created for other purposes.

1. Cloudflare dashboard → profile icon (top right) → **My Profile** → **API Tokens** → **Create
   Token** → **Custom token**. Permissions: **Account** / **Cloudflare Pages** / **Read**. Account
   Resources: **Include** / this account. Create it, and copy the token immediately — Cloudflare
   shows it exactly once.
2. Set it as a Worker secret:
   ```bash
   npx wrangler secret put CLOUDFLARE_API_TOKEN
   ```
3. Find the account id (dashboard: Workers & Pages overview page, right-hand sidebar — or
   `npx wrangler whoami`) and paste it into `wrangler.toml`, replacing
   `PLACEHOLDER-NOT-A-REAL-ACCOUNT-ID` on the `CLOUDFLARE_ACCOUNT_ID` line.
4. Find this Pages project's own name (the slug in its dashboard URL, or `npx wrangler pages
   project list`) and paste it into `wrangler.toml`, replacing
   `PLACEHOLDER-NOT-A-REAL-PAGES-PROJECT-NAME` on the `CLOUDFLARE_PAGES_PROJECT` line.

`src/test/wrangler-config.test.ts` accepts either the placeholder or a well-formed real value for
both (a 32-character hex account id; a Pages project name that isn't the placeholder), so
completing this step does not, itself, break `npm run test:deploy` — see Step 8's own note above
for why the previous exact-placeholder version of this test could never distinguish "not done yet"
from "done". What still fails it is an invented or half-pasted value instead of the real ones this
step just had you copy from the dashboard, guarding against `GET /api/build-status` silently
querying an account or project that doesn't exist once deployed.

### 12c. Decision recorded: an upload-only commit still triggers its own Pages build

`POST /api/upload` (Task 6) commits one photo to `assets-source/` in its own commit, separate from
any content publish. Cloudflare's default GitHub integration (**Automatic deployments**, enabled
the moment Step 1 connects this repository) builds on *every* push to `GITHUB_BRANCH` — so a photo
upload immediately followed by a content publish costs two separate builds, not one. Each commit is
its own build; there is no batching or debouncing anywhere in this stack, and that is deliberate:

- Every commit going live at all depends on Cloudflare's own build-on-push staying enabled exactly
  as it is — nothing else in this stack triggers a build. Turning it off to save builds would break
  publishing entirely, not just slow it down.
- The realistic volume this decision costs is nowhere near the 500-build/month cap: routine editing
  traffic for a small restaurant site is not in the same order of magnitude.
- Batching would mean either delaying a real publish's own build (contradicting "publish and it's
  live") or routing every commit through deploy-hook machinery instead of Cloudflare's native
  integration — a materially larger change, for a quota that is not under pressure.

If usage ever changes enough that this becomes a real quota concern, the fix belongs on a debounce
in front of the build, not on how content is published.

## 13. Confirm the dashboard's build command still matches what Step 2 documented

Do this now, right after Step 2, and again any time anyone edits this Pages project's build
settings by hand afterward. Open this project's **Settings** → **Builds & deployments** and read
the actual configured **Build command** field. Compare it, word for word, against the command in
Step 2 above (`npm run images && npm run test:deploy && npm run build`) — in particular, confirm
`npm run test:deploy` still runs **before** `npm run build`, not after and not omitted.

**Why this matters more than it looks like it should.** `npm run test:deploy` is the only thing
standing between a bad commit and a deployed white page. Four of the five content guards from Plan 2
(a disabled hero, a blank copy heading, a typo'd nav section id, an invalid day code) produce a
*successful* `npm run build` and a deployable `dist/` that white-pages anyway — `vite build` bundles
`src/content/index.ts` without executing it, so none of those guards run at build time; only
`npm run test:deploy` actually runs them. If the dashboard's build command is missing
`npm run test:deploy`, or runs it after `npm run build` instead of before, **nothing in this
repository can detect that.** `src/test/hosting.test.ts` only pins the command documented on *this
page* — it has no way to read what the Cloudflare dashboard actually holds, and the two can drift
apart the moment anyone edits the dashboard by hand without also editing this file. And because
Cloudflare builds on every push to `main`, that command runs unattended on whatever commit lands
next — including a developer's, with nobody watching.

This check cannot be automated — `src/test/hosting.test.ts` proves only that *this document*
describes the safe order, never that the dashboard agrees with it. Do it manually.

---

## 14. Current state: running on a test host, not the real domain

`viabiancadelhi.com` **was never registered** — checked against Verisign during the cutover
(`whois -h whois.verisign-grs.com viabiancadelhi.com` → *"No match"*), so there was no zone to
put the Worker route on and no host to point DNS at. Everything below therefore runs on
`vb.aionxxxi.uk`, a subdomain of a zone that already existed on the account.

**Live now:**

| | |
|---|---|
| Pages project | `vb`, Git-connected to `tarann26/vb`, production branch `main` |
| Site | `https://vb.aionxxxi.uk` (and `https://vb-c7r.pages.dev`) |
| Worker | `via-bianca-admin`, route `vb.aionxxxi.uk/api/*`, zone `aionxxxi.uk`; cron `0 * * * *` still registered until the next `npx wrangler deploy` — see §12a |
| KV | `3e90a6b54f83487995156291801dce95`, bound as `KV` |
| Secrets | `ADMIN_PASSWORD_HASH`, `TOKEN_SECRET`, `GITHUB_TOKEN` all set |

**To switch to the real domain, change ONE value and let everything derive from it.**
`src/content/site.json`'s `seo.url` is the single source; these five follow it and each has a
test that fails if they drift:

1. `public/robots.txt` — the `Sitemap:` line (`src/test/crawlers.test.ts`)
2. `public/sitemap.xml` — the `<loc>` entries (same test)
3. `index.html` — `og:url`, `og:image`, `twitter:image` (`src/test/head.test.ts`)
4. `wrangler.toml` — the route `pattern` and `zone_name` (`src/test/hosting.test.ts`)
5. The Pages custom domain and its CNAME

Then add the zone to Cloudflare, add the custom domain, `npx wrangler deploy`, and re-point DNS.

**`zone_name` is not always the site's host.** A site on a subdomain lives inside the parent
zone, and Cloudflare rejects a route whose `zone_name` is not a real zone on the account. An
earlier version of `hosting.test.ts` asserted `zone_name === host`, which silently encoded "the
site is always at its zone apex" — true of an apex domain, false here, and it failed a correct
configuration. It now asserts the route is scoped to the zone that *contains* the host.

**Two things Cloudflare Pages does that are worth knowing:**

- **It reads `wrangler.toml` and warns.** Build log: *"A Wrangler configuration file was found but
  it does not appear to be valid. Did you mean to use wrangler.toml to configure Pages?"* It
  continues, so nothing is broken today, but Pages and the Worker are sharing one file name. The
  clean fix is `worker/wrangler.toml` plus `wrangler deploy -c worker/wrangler.toml`.
- **The build-log API returns only the FIRST 1000 lines.** A failure at the end of a 2000-test run
  is past the cap and invisible. To see it, temporarily set the build command to use a quiet
  reporter (`npx vitest run --reporter=dot --silent`) and re-trigger — that is how the one-byte
  timezone failure below was found.

**The failure that blocked this cutover was a real bug, not an environment quirk.** The build died
on `homepage-bytes.test.tsx`: 53486 on Cloudflare, 53485 locally. Cause: `new Date(article.date)`
in `BlogTeaser` and `BlogsPage`. A date-only ISO string parses as UTC midnight, and
`toLocaleDateString` then renders it in the *runtime's* zone — so every press article showed a day
early for any visitor west of UTC, and a two-digit day becoming one digit is exactly one byte. Now
rendered with `timeZone: 'UTC'` (`src/content/article-date.ts`), and the homepage byte count is
identical in UTC, New York and Delhi, which it never was before.

## 15. If the site renders unstyled on the custom domain: a poisoned cache entry

**Symptom.** The page loads, React runs, images appear — and there is no CSS at all. Plain
serif text, blue underlined links. The console says:

```
Refused to apply style from '.../assets/index-XXXX.css' because its MIME type
('text/html') is not a supported stylesheet MIME type, and strict MIME checking is enabled.
```

**What makes this hard to diagnose:** `curl` fetches the same URL successfully and reports
`content-type: text/css`. So does `fetch()` from inside the page with `{cache: 'reload'}`. Only
the browser's own `<link rel="stylesheet">` load fails, and only on the custom domain — the
`*.pages.dev` URL serves the identical file correctly, with the identical build hash.

**The differentiating header is `Origin`.** A browser sends it on subresource requests; `curl`
does not. Reproduce in one command:

```bash
# poisoned: returns index.html
curl -sI -H "Origin: https://vb.aionxxxi.uk" https://vb.aionxxxi.uk/assets/index-XXXX.css | grep -i content-type
# clean: returns the real stylesheet
curl -sI                                      https://vb.aionxxxi.uk/assets/index-XXXX.css | grep -i content-type
```

The bad response carries `vary: accept-encoding` and no `content-length`; the good one has
`content-length: <real size>`. They are two different cached objects at one URL.

**Why it happens, and why `/assets/*` specifically.** `public/_redirects` ends with
`/*  /index.html  200` — the SPA catch-all, which answers **200** (not 404) for any path Pages
cannot serve as a file. `public/_headers` marks `/assets/*` as
`max-age=31536000, immutable`. So a single request for an asset that momentarily is not there —
a deploy mid-propagation, or a hashed filename requested from a stale HTML — gets `index.html`
with a 200 and the edge caches that HTML **for a year, as immutable, at a content-hashed asset
URL**. Nothing later corrects it: the filename never changes, so the entry is never revalidated.

**Fix:** purge it. Dashboard → the zone → **Caching → Configuration → Purge Everything**, or a
Custom Purge of the one URL. Then re-check with the `Origin` command above.

**Faster workaround if a purge is not available:** change anything that alters the CSS content
hash. A new hash is a new URL, and the poisoned entry is simply no longer referenced.

**Check the blast radius before assuming it is only the stylesheet** — the same thing can happen
to any asset:

```bash
for f in $(curl -s https://HOST/ | grep -o 'assets/[A-Za-z0-9._-]*\.\(js\|css\)' | sort -u); do
  printf '%-40s %s\n' "$f" "$(curl -s -o /dev/null -w '%{content_type}' -H "Origin: https://HOST" "https://HOST/$f")"
done
```

### 15a. The same thing, on the entry bundle: a blank site

Everything in Step 15 happened again, to `/assets/index-*.js`, and the outcome
was not cosmetic. Chrome refuses to execute a module script served as
`text/html`, so nothing mounted and **every route rendered a blank white
page**. The `Origin`-keyed variant split held exactly as described above:

```
no Origin header                  -> application/javascript   (fine)
Origin: https://example.com       -> application/javascript   (fine)
Origin: https://vb.aionxxxi.uk    -> text/html                (poisoned)
```

Only the site's **own** origin was poisoned, which is the one every visitor
sends and the one no casual `curl -I` sends. There was no `Vary` header
advertising the split.

Two things changed as a result:

1. `public/_headers` dropped `s-maxage` on `/assets/*` from 86400 to 3600. The
   old number was chosen when the worst case was a stylesheet. "Poisoned until
   tomorrow" is survivable for an unstyled page and not for a site that is
   simply gone.

2. `npm run verify:deploy` (scripts/verify-deploy.mjs) now automates this
   whole section. It waits for `build-info.json` to report the commit under
   test, fetches every built asset **with the site's own Origin**, checks
   Content-Type rather than status, and then loads every route in a real
   Chromium and asserts the page actually rendered. Run it after every push.

**Also worth knowing: verifying too eagerly is a way to CAUSE this.** The
request that poisoned the entry bundle was almost certainly the post-deploy
check itself, hitting the new asset URL while the deploy was still
propagating. That is not a reason to skip the check — it is a reason to run
`verify:deploy`, which waits for the commit to be live before it fetches
anything.

### 16b. Why `_redirects` cannot just exclude `/assets/*`

The obvious prevention is to stop the SPA catch-all answering for asset paths,
so a not-yet-propagated file returns something that is not a cacheable 200 of
HTML. It does not work, and the reasons are worth recording so nobody spends
another afternoon on it:

- **A 404 rule is silently ignored.** Cloudflare Pages' `_redirects` accepts
  only 200, 301, 302, 303, 307 and 308. A `404` line is dropped at build time
  with no error (see `public/_redirects`' own comment — this was tried).
- **A 200 rewrite to anything else is still a cacheable 200.** Pointing
  `/assets/*` at a `.txt` file just poisons the URL with `text/plain` instead
  of `text/html`. The browser still refuses it.
- **A 301/302 cached under a content-hashed URL is worse, not better.**
- **Enumerating the real routes instead of using `/*` breaks NotFound.** The
  catch-all is what lets `<Route path="*">` render the branded NotFound page
  for a typo'd URL. Replacing it with an explicit list means any URL not on
  the list gets a bare Pages 404, and every new page in `pages.json` needs a
  matching `_redirects` line or it 404s — a drift hazard traded for a
  propagation one.

So the mechanism stays, and the answer is the shorter `s-maxage` above plus
detection via `npm run verify:deploy`. That script probes the fallthrough
directly (it fetches `/assets/index-DOES-NOT-EXIST.js` and reports the
Content-Type) so that if Cloudflare ever changes this behaviour, in either
direction, it shows up in the output rather than in an outage.

## 16. Security headers: what comes from the repo and what comes from the zone

`public/_headers` sets five headers on `/*`. Only three of them are actually
coming from this repository:

| Header | Source |
| --- | --- |
| `X-Content-Type-Options: nosniff` | **the zone**, and also `_headers` |
| `Referrer-Policy: strict-origin-when-cross-origin` | **the zone**, and also `_headers` |
| `X-Frame-Options: DENY` | `_headers` only |
| `Permissions-Policy: ...` | `_headers` only |
| `Strict-Transport-Security: max-age=31536000; includeSubDomains` | `_headers` only |

Measured, not assumed: the first two were already on every response *before*
the deploy that added the `/*` block, when `_headers` set nothing but
`Cache-Control`. Something at the Cloudflare zone level sets them. The values
happen to match what `_headers` now also sets, so nothing conflicts.

Why this is written down: deleting those two lines from `_headers` would not
change a single response, so anyone testing whether the file "works" by
removing a line has a 2-in-5 chance of picking one that proves nothing. The
three that only exist here are the ones to test with.

**HSTS carries no `preload` token, deliberately.** `max-age` and
`includeSubDomains` are reversible by changing this file. Preload is a
submission into a list compiled into browsers; it is slow and awkward to
undo, and this is still running on `vb.aionxxxi.uk`, a hostname that is going
to be thrown away (see Step 14). Revisit only after the real domain is live
and has been serving HTTPS without incident for a while.

### 16a. Verifying headers after a deploy

`curl` immediately after a push does not tell you anything reliable. Observed
directly on the deploy that added these: for several minutes the edge served a
mix of pre- and post-deploy HTML, with `/` missing three headers while `/edit`
had all five, then the two swapped, then both settled correct. That is the
same poisoned-variant behaviour Step 15 and `public/_headers`' own comment
describe, and it self-cleared here without a purge.

So the check is three steps, not one:

1. Poll for the build first — the sha, not a header:

   ```
   curl -s https://vb.aionxxxi.uk/build-info.json
   ```

   until `sha` equals the commit you pushed. A Pages build for this repo takes
   roughly three minutes; anything that appears to land in seconds is the
   previous build still answering.

2. Then check the headers, on a route with no file behind it as well as one
   with:

   ```
   curl -sI https://vb.aionxxxi.uk/ | grep -i 'x-frame-options\|permissions-policy\|strict-transport'
   curl -sI https://vb.aionxxxi.uk/edit | grep -i 'x-frame-options\|permissions-policy\|strict-transport'
   ```

3. Then check again a minute later. A single passing read during the
   propagation window is not evidence, and neither is a single failing one.

`_headers` rules match the **requested** path, not the rewritten one --
`/edit`, `/blogs`, `/cheeseboards` and `/membership` are all served
`index.html` by the SPA catch-all in `_redirects` and all four carry the
headers. That is what makes a future per-path policy (a stricter
Content-Security-Policy on the public site than on `/edit`) possible at all.
