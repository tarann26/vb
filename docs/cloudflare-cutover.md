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

## 17. The preview subdomain is a second public copy of the site

Cloudflare Pages publishes every project on a generated `*.pages.dev`
subdomain as well as its custom domain. For this project that is
**`vb-c7r.pages.dev`** — the suffix exists because `vb.pages.dev` was already
taken by an unrelated project, which is worth knowing before testing against
it: `vb.pages.dev` is somebody else's website, not this one.

The security side is fine, and was measured rather than assumed:

- All five security headers **and** the full CSP apply there, because they
  come from `public/_headers`, which is a Pages-level file rather than a zone
  setting.
- `POST /api/login` returns **405**. `wrangler.toml` routes the admin Worker
  to `vb.aionxxxi.uk` only, so that origin has no login, no session and no API
  at all. There is nothing to attack and no way in.

The problem is search. That copy is public and its `robots.txt` says
`Allow: /`, so without intervention Google can index the entire site twice and
the two compete.

**What the repository does about it**, neither of which is a complete fix on
its own:

1. Every indexable route now declares a canonical URL naming the real domain —
   `/` (SeoHead), `/blogs` (BlogsPage) and each `/<slug>` page (PageSeoHead),
   all through one `useCanonical` hook. `/blogs` was the gap; it had none.
2. `useNoindexOnPreviewHost` adds `<meta name="robots" content="noindex,
   nofollow">` when the hostname ends in `.pages.dev`.

Both depend on the crawler executing JavaScript, which is the same accepted
tradeoff the rest of this site's metadata already makes.

**The durable fix is yours to make, in the dashboard**, and it takes a minute:

> Cloudflare dashboard → **Workers & Pages** → this project → **Settings** →
> **General** → **Preview deployments**, or add a **Cloudflare Access** policy
> covering `vb-c7r.pages.dev`.

Putting Access in front of the preview subdomain removes it from the public
internet entirely, which makes both mitigations above redundant rather than
load-bearing. Worth doing before the real domain goes live and there is
actual search traffic to split.

**Do not** be tempted to write the noindex check as "hostname is not the one
in `site.seo.url`". It reads better and it is a loaded gun: for as long as
`seo.url` lags the domain actually in use — the state this repository has been
in for weeks — that version serves `noindex` to Googlebot on the **real**
site. The suffix match cannot express that mistake, and
src/components/__tests__/SeoHead.test.tsx pins exactly that, including a
hostname (`pages.dev.viabiancadelhi.com`) that a substring check would wrongly
match.

## 18. Two deployments, and only one of them is automatic

This is the single easiest thing to get wrong about this project, and it has
already been got wrong once, expensively.

| What | How it reaches production | Triggered by |
| --- | --- | --- |
| The **site** (`src/`, `public/`, content JSON) | Cloudflare Pages build | **Automatic** on every push to `main` |
| The **admin Worker** (`worker/`) | `npx wrangler deploy` | **Manual. Nothing else does it.** |

Pushing to `main` does not deploy the Worker. Nothing in the Pages build
touches `worker/` at all. A commit that changes an API route is live in the
repository, green in CI, and completely absent from production until somebody
runs that command by hand.

**What this cost.** Two days of security work — the per-route rate limits, the
API security headers, the cross-origin write check, the JSON body caps, and
the fix for the reserve-a-table counter that had been answering `403` to every
real tap since the site moved host — was committed, covered by tests, verified
by mutation, reported as shipped, and was not running. The last
`wrangler deploy` predated all of it. Nothing caught it because nothing looked:
`/build-info.json` is written by the *Pages* build, so it reports the site's
commit and says nothing whatsoever about the Worker's.

**What now catches it.** `npm run verify:deploy` fetches `/api/health` and
fails if the response is missing any header `worker/index.ts`'s
`withSecurityHeaders` sets. A Worker predating that function cannot produce
them, so their presence is proof the deployed Worker is current. The failure
message names the command to run.

So the full sequence after changing anything under `worker/`:

```bash
npx tsc -b --noEmit && npm test -- --run && npx eslint .
npx wrangler deploy
npm run verify:deploy
```

`wrangler deploy` does not touch secrets — `ADMIN_PASSWORD_HASH`,
`TOKEN_SECRET`, `GITHUB_TOKEN` and `CLOUDFLARE_API_TOKEN` are stored on the
Worker and survive every deploy, which is why the dry-run output lists only
the plain vars and the KV binding. If a deploy goes wrong, `npx wrangler
rollback` returns to the previous version.

### 9a. Two kinds of API token, two verify endpoints

Cloudflare issues user tokens and account-owned tokens, and they differ by
prefix:

| Prefix | Kind | Verify at |
| --- | --- | --- |
| `cfut_` | user | `/client/v4/user/tokens/verify` |
| `cfat_` | account-owned | `/client/v4/accounts/{account_id}/tokens/verify` |

Check a `cfat_` token against the user endpoint and Cloudflare answers
**"Invalid API Token"**. The token is fine. The endpoint is wrong. That cost
an hour once; do not spend it again.

`src/test/secrets.test.ts` blocks both prefixes from being committed. It
matches on prefix only, deliberately: Cloudflare's older tokens are a bare
40-character `[A-Za-z0-9_-]` run with no marker, and a pattern for that shape
would flag base64 fixtures, content hashes and much of the binary content the
scanner reads. A check that cries wolf gets switched off, so the bare form is
a documented blind spot rather than a noisy rule.

## 19. Phase 2: the content database (D1), R2, and the `CONTENT_STORE` switch

Phase 2 added a second place content can live. This section records what is
actually bound and what is actually in it, as of Task 12 — read this before
assuming either store's state from the code alone.

**The D1 database.** `via-bianca-content`, id `7ec61770-4fb1-4458-9c34-46b92bb9702c`,
bound as `env.DB` (`wrangler.toml`'s `[[d1_databases]]`). Free tier: 5,000,000
rows read/day, 100,000 rows written/day, 5 GB/account, 500 MB/database, 10
databases/account. It holds three tables — `content`, `revisions`,
`content_meta` — created by the migration below, plus SQLite's own
`sqlite_sequence`. As of Task 12, `content` holds one row:
`src/content/awards.json`, the Phase 2 pilot file, seeded with one award and
carried through one edit and one undo to prove the write path before this
Worker was ever deployed with D1 support live. `revisions` holds one row: the
edited body that undo left restorable, the same way any ordinary undo would.
`content_meta` is empty — nothing writes to it yet; it exists for Phase 5 to
use without a second migration.

`src/content/awards.json` lives in D1 regardless of the switch below
(`worker/store.ts`'s `D1_ONLY_PATHS`) — it has never been a file in this
repository and never will be. Every other content file still reads from and
writes to GitHub exactly as it did before Phase 2, until the switch flips.

**Rebuilding the database, if it is ever dropped or recreated.** Every
statement in the migration is `CREATE ... IF NOT EXISTS`, so re-running it is
always safe — on a fresh database or an existing one:

```bash
npx wrangler d1 execute via-bianca-content --remote --file=worker/migrations/0001_content.sql
```

Confirmed on this database: a second run reports 0 rows read and 0 rows
written, against 12 rows written on the first run — the idempotence the file
depends on, not merely claimed by its own comment.

**R2 is NOT bound, and there is no bucket.** This corrects an assumption an
earlier draft of the Phase 2 plan made — `wrangler.toml` has no
`[[r2_buckets]]` section, `worker/index.ts`'s `Env` declares no `R2` binding,
and nothing under `worker/` reads `env.R2`. There is no bucket name to record
because none was created: `wrangler r2 bucket create via-bianca-assets`
returned Cloudflare error code 10042, "Please enable R2 through the Cloudflare
Dashboard" — that activation can require billing details, and the standing
authorization does not cover adding a billable prerequisite without the
owner's approval. `wrangler.toml`'s own comment on this, next to the D1
binding, is the fuller version of this paragraph.

R2 was going to exist for the image derivative pipeline the spec describes as
running "in the Worker on upload" — impossible in workerd, since
`scripts/images.mjs` loads `sharp`'s native binding at module scope and
workerd cannot execute native code. Three options remain, undecided, and the
decision is owed before Phase 3 (which is also where R2's billing activation
would need to happen, bundled with whichever option is chosen):

1. Generate derivatives at build time, same as today, and upload the results
   to R2 instead of shipping them in `public/`.
2. Upload originals as-is and resize in the browser before the request.
3. Buy Cloudflare Images and use its transform pipeline instead of `sharp`.

**The `CONTENT_STORE` switch.** `wrangler.toml`'s `[vars]`, currently
`CONTENT_STORE = "github"` — unset or `"github"` is the default and means
every content file that exists today (everything except `awards.json`) reads
from and writes to GitHub, exactly as before Phase 2 (`worker/store.ts`'s
`storeFor`). Setting it to `"d1"` moves every one of those files to D1 at
once, for both reads and writes — there is no per-file opt-in. Flipping it is
one `[vars]` edit plus a redeploy (`npx wrangler deploy`); flipping it back to
`"github"` and redeploying again is the rollback, and it is exact — GitHub
was never stopped being written to for those files while `CONTENT_STORE` was
unset, so nothing needs reconciling on the way back. What does not roll back
automatically: any publish made while `CONTENT_STORE = "d1"` was live exists
only in D1, and reverting the switch does not copy it to GitHub.

### Before a deploy that matters

Three documents now live in D1 — `src/content/awards.json`,
`src/content/story.json` and, from Phase 5B, `src/content/posts.json` — and
committed artefacts mirror them. None is regenerated by the build,
deliberately: they all call an authenticated network API, and a transient
failure on Cloudflare's builder would fail a deploy of unrelated code.

**Run these in this order. The order is not a style preference — see "the
window between the seed and the deploy" below.**

    npx tsx scripts/sync-posts-fallback.mjs   # src/content/posts.json -- first paint, sitemap, asset walk
    node scripts/sync-story-fallback.mjs      # src/content/story.json -- the browser's first-paint fallback
    node scripts/build-snapshot.mjs           # worker/snapshot.ts -- the Worker's outage fallback
    npx wrangler deploy                       # ships the Worker itself -- see below
    git push                                  # ships the frontend, via Cloudflare Pages
    npm run verify:deploy                     # proves all of the above actually landed

`npx tsx`, not `node`, for the posts one: it imports the real `assertPosts`
from `src/content/guards.ts`, which resolves its own siblings with
extensionless specifiers that Node's ESM resolver refuses. `node
scripts/sync-posts-fallback.mjs` fails with `ERR_MODULE_NOT_FOUND`. `tsx` is
not in `devDependencies`, so `npx` fetches it — worth pinning if this list
grows a third `tsx` step.

`build-snapshot.mjs` runs **after** the sync scripts and before the deploy,
because it reads the live database and compiles what it finds into
`worker/snapshot.ts`, which is part of the Worker bundle `wrangler deploy`
ships. Running it after the deploy compiles a snapshot nothing is carrying.

Every one of these refuses rather than guesses. `build-snapshot.mjs` refuses
to write an empty snapshot; `sync-story-fallback.mjs` refuses a body it cannot
parse or that has no heading, no paragraphs, or an incomplete chef block;
`sync-posts-fallback.mjs` refuses anything `assertPosts` refuses — the same
guard the build itself applies, so a body it accepts cannot break `tsc -b`.
The failures are loud on purpose, because a silently-stale fallback serves
HTTP 200 and reads to a visitor as "this is the content", not as a failure.

#### The window between the seed and the deploy

**This applies once, to the deploy that first ships Phase 5B's Worker, and it
is the worst failure mode in that phase: a post the chef published is silently
reverted and then hidden.**

`src/content/posts.json` becomes a D1 document by being added to
`D1_ONLY_PATHS` in `worker/store.ts` — and `storeFor` reads that set from the
**deployed** Worker, not from this repository. So until `npx wrangler deploy`
runs, a publish through `/edit` still goes to **GitHub**: it commits a post to
the repository and does not touch the D1 row at all.

The one-off seed is therefore the first step, not an early one:

    npx tsx scripts/seed-posts-d1.mjs         # writes the committed body into D1; refuses if a row exists
    node scripts/build-snapshot.mjs           # picks the new row up automatically
    npx wrangler deploy                       # NOW posts.json is a D1 document
    git push                                  # ships the frontend
    npm run verify:deploy

Seed **immediately before** the deploy, not days ahead. A publish landing in
the gap writes the post to GitHub, leaves the seeded row stale, and the deploy
then makes that stale row the live copy — so the post she published disappears
from the site until the next publish overwrites the row. Nothing errors,
nothing 500s, and the compiled-in fallback paints first, so the site looks
completely healthy while her work is gone.

`seed-posts-d1.mjs` reads before it writes and exits 1 rather than
overwriting, so re-running it is safe and is not a way out of this — if a
publish landed in the gap, the row is already there and already stale. The
recovery is to publish that post again through `/edit` after the deploy, which
writes it to D1 where it now belongs.

#### The check that catches it

Prose in a runbook is not a control. `npm run verify:deploy` fetches
`/api/published?path=posts.json` and compares it against the repository's
`src/content/posts.json` (`scripts/published-posts-check.mjs`):

- **A slug the repository has and the live copy does not — FAILS.** That is
  the signature of exactly the gap above, and after a correct
  seed-then-deploy it is impossible. It is also the state in which
  `sitemap.xml` advertises a `/blog/<slug>` that lands on the not-found
  screen, and in which a card paints and then vanishes.
- **A non-2xx from that endpoint — FAILS**, naming both causes: a stale
  Worker (`npx wrangler deploy` never ran) or an unseeded row.
- **A slug the live copy has and the repository does not — printed, never
  failed.** That is the ordinary state between syncs: she published, and the
  committed mirror lags on purpose. It prints a reminder to run
  `sync-posts-fallback.mjs` before the next deploy.

Slugs, not bytes: the stored body is what the dashboard sent, which is
minified, while the committed file is the reformatted human-readable mirror.
A byte comparison would fail on whitespace every time and be switched off
within a week.

`npx wrangler deploy` is not optional, and belongs on this list for the same
reason the two scripts above do: it is the third of three artefacts a
content-routing change touches, and it is the one Cloudflare Pages' own
frontend build does not ship for you. Skipping it after adding a path to
`D1_ONLY_PATHS` (`worker/store.ts`) or `PUBLIC_FILES` (`worker/published.ts`)
leaves the live Worker serving its previous build -- `GET
/api/published?path=<new file>` 404s against production while the frontend
already expects it to work. The site does not break (the compiled-in
fallback still renders), but the feature is inert until this runs.

### Phase 5A: the blog

`src/content/posts.json` was committed JSON on the GitHub store for 5A, like
`experiences.json` and unlike `awards.json`. Every post carries a required
card image and may carry image and gallery blocks, and
`src/content/__tests__/assets.test.ts` only walks `src/content/` — a
D1-stored post would have left the fields most likely to break unguarded
before the editor existed.

**No Worker change, so no `npx wrangler deploy` was needed for 5A.** A normal
push to `main` was the whole deploy. **That is no longer true.** 5B moved
`posts.json` to D1: from that point on a push without `wrangler deploy`
ships the read path inert, exactly as Phase 4's final review caught.

**5B's standing consequence, and it is a real narrowing worth naming.** The
file still exists and is still compiled in — it is the first paint, what a
crawler and a reader with JS off see, what `plugins/sitemap.ts` reads at build
time, and the only thing keeping every post image inside `assets.test.ts`'s
walk. But publishes no longer write to it, so
`src/content/__tests__/shape.test.ts`'s "is the three real press mentions" pin
now guards the **fallback**, not the live copy: a fourth post published
through `/edit` is live immediately and does **not** fail the build. It fails
the build only once `npx tsx scripts/sync-posts-fallback.mjs` has run. The pin
still does its job for the committed artefact, which is what it was always
about — but it is no longer a gate on what the site is serving.

**Adding a post today** means editing `src/content/posts.json` by hand and
pushing — the Manage panel is 5B's. A new photo goes in
`assets-source/press/` (or its own category once 5B adds one) and is
processed by `npm run images` at build time; R2 is still not enabled.

**The nine unmigrated `press.json` entries** are still in the repository and
are rendered by nothing. Three of the twelve carried a real, resolvable URL
and became Mention posts; the other nine have `url: null`, publications that
read as invented, and images borrowed from the food and mocktail galleries.
They wait on a decision rather than shipping as fabricated citations.
`src/content/__tests__/shape.test.ts` pins the three, so a fourth appearing
without that decision fails the build.

**`/blogs` is a real HTTP 301, not just a client-side route.** `public/_redirects`
carries `/blogs  /blog  301` above the SPA catch-all (`/*  /index.html  200`).
Cloudflare Pages reads `_redirects` top to bottom and stops at the first
match, so this rule has to sit above the catch-all — below it, the catch-all
already answers every request first and the 301 rule is dead config that
still looks alive in a diff. `src/test/hosting.test.ts` pins both the rule
text and that ordering.

**No Playwright spec covers this 301.** Vite dev and Vite preview — what
`npx playwright test` and `npm run preview` both run against — do not process
`public/_redirects` at all; that file is a Cloudflare Pages mechanism with no
local equivalent. `e2e/blog.spec.ts`'s `/blogs lands on /blog` test passes
because `App.tsx` still carries a client-side `<Navigate to="/blog" replace />`
as an in-app fallback, and that is a different code path from the 301.
A green e2e suite says nothing about the redirect; `hosting.test.ts` is its
only pin, and only a live `curl -sI https://<domain>/blogs` after deploy
confirms the real one.

**Playwright runs against `npm run dev`, not `dist`.** `playwright.config.ts`'s
`webServer.command` is `npm run dev`, so `npm run build`'s output in Step 1
above has no effect on what any e2e spec, including `e2e/blog.spec.ts`, sees.
The only test that reads `dist/` is `npm run test:bundle` (`src/test/bundle.post-build.test.ts`
and `src/test/crawlers.test.ts`), run as part of `npm run build` itself.

**Tailwind's dev JIT does not un-generate a class within one server session.**
Once a utility class has been scanned and emitted once, removing the source
that referenced it does not remove the rule from that dev server's output —
the JIT only ever adds. A CSS-removal change reads as still-present until the
dev server is stopped and restarted cold. This cost real time to track down
during this phase and is worth knowing before trusting a "the class is still
there" observation against a long-running `npm run dev`.

**`docs/` is outside Tailwind's content scanner.** `tailwind.config.js`'s
`content` glob is `['./index.html', './src/**/*.{js,ts,jsx,tsx}', '!./src/**/__tests__/**', '!./src/test/**']`
— nothing under `docs/` is scanned. A utility-class-looking token written into
a doc, including this one, emits no CSS rule and costs nothing against the
38700-byte ceiling. (The scanner is still a plain text extractor with no JS
parser, so this guarantee is specific to the glob, not to prose in general —
see this file's own comment block for what happens inside a scanned glob.)

**Two open items are the owner's call, not resolved by this phase:**
the nine fabricated `press.json` entries above, and `public/press/hotelier.webp`
— a social-card screenshot whose headline is baked into the pixels, cropped
mid-descender, with the same headline then repeated as the post's own
heading. Wrong asset, pre-existing this phase, waiting on her.

### Phase 5B: the block editor, and posts on D1

**`src/content/posts.json` is now a D1 document with a committed fallback**,
exactly like `src/content/story.json`. `worker/store.ts`'s `D1_ONLY_PATHS` and
`worker/published.ts`'s `PUBLIC_FILES` both name it. The live copy is the row;
the file is what first paint, a crawler, a reader with JS off and
`src/content/__tests__/assets.test.ts`'s asset walk all see.

**A push to `main` is no longer the whole deploy.** From this phase on:

    node scripts/build-snapshot.mjs        # worker/snapshot.ts -- the Worker's outage fallback
    node scripts/sync-posts-fallback.mjs   # src/content/posts.json -- the browser's first-paint fallback
    node scripts/sync-story-fallback.mjs   # unchanged, still needed
    npx wrangler deploy                    # ships the Worker itself

Skipping `wrangler deploy` leaves `GET /api/published?path=posts.json` 404ing
against production while the frontend already expects it. The site does not
break — the compiled-in fallback renders — but publishing a post changes
nothing anybody can see, and every test is green.

**Adding a post is now something she does herself**, from
`/edit/manage/story` → Posts. A photo uploads into `assets-source/posts/`
(the ninth upload category) and `npm run images` writes
`public/posts/<name>.webp` at build time. R2 is still not enabled.

**A post published between deploys is live immediately but absent from
`sitemap.xml`** until `sync-posts-fallback.mjs` runs and the site rebuilds.
`plugins/sitemap.ts` reads the committed file at build time. That is a
freshness cost on discovery, not a correctness one.

**One pin narrowed, and it is worth knowing.**
`src/content/__tests__/shape.test.ts` pins the three migrated press mentions
against the committed file, which is what makes a fourth post appearing
without a decision on the nine unmigrated `press.json` entries fail the
build. It now guards the **fallback** rather than the live copy: a fourth post
published through the editor is live at once and fails nothing, and only
becomes a build failure after `sync-posts-fallback.mjs` is run. The pin still
does its job for the committed artefact, which is what it was always about.

**The staged-photo-after-reorder risk did not ship as a gap — Task 10 closed
it.** A block carried no id, so a picked photo was staged under the block's
*position*: React key, preview key and staged-file key all pointed at
wherever she'd dragged the block away from. `BlockList.tsx` now names each
block in a `WeakMap` keyed on the block object itself, not its index — the
same object survives a reorder, so the photo she picked for it does too.
`BlockFields.tsx` carries the matching fix one level down, for a photo staged
into a gallery block and then bumped by removing an earlier tile. Both are
proven end to end in `BlockList.test.tsx`: pick a photo, move the block,
pick a second photo, publish — each block still names the photo she picked
for it.

**The parser can no longer hang.** `parseNodes` used to backtrack
exponentially on an unclosed `[` — 24 brackets took 906ms and 30 took about
two minutes, and it was a hang rather than a throw, so the root error boundary
could not catch it. It was unreachable while the only authoring path was a
committed file; the toolbar's textarea is what put a keystroke in front of it.
Fixed with a memo on both outcomes, a 32-level depth cap and a constant-time
refusal: 50 000 brackets now parse at 0–4ms.

**The CSS ceiling is unchanged at 38700, and the build sits at 38593 — the
same number Phase 5A left.** The plan for this phase called for the
ceiling's first raise since Phase 3, budgeting two new rules — `cursor-move`
on the drag handle, `opacity-50` on the row in flight — at 38641 against a
raised 38800. Measured against a worktree checkout of the true parent commit,
all eight tasks including drag-to-reorder came out byte-identical: 38593 →
38593, zero rules added, zero removed, same content hash. The handle and the
dragged row use inline `style` instead of a class — `style={{ cursor: 'move'
}}` and `style={{ opacity: 0.5 }}` — the same escape hatch
`CollapsibleSection.tsx`'s fieldset reset already uses, and `style-src`
allows it on purpose (`src/test/hosting.test.ts`). The 38641-against-38800
pair never shipped; the raise was never needed. `src/test/bundle.post-build.test.ts`'s
comment carries the full arithmetic. Everything else in this phase spent
zero — four files (`PostList`, `BlockList`, `BlockFields`, `InlineTextField`)
import `RecordList`'s and `Field.tsx`'s own exported class bindings rather
than retyping the strings.

**Still the owner's call, unresolved by this phase:**

- the nine fabricated `press.json` entries — twelve entries, three real, and
  the other nine carry `url: null`, publications that read as invented, and
  images borrowed from elsewhere (**six from `/food/`, two from
  `/mocktails/`, and one from `/team/kamalika-anand.webp`**, the chef
  portrait). Moving any of them is now a data edit through the Posts panel,
  not a code change;
- `public/press/hotelier.webp` is the wrong asset for its post — a social
  card whose headline is baked into the pixels, cropped mid-descender by the
  card's 2:1 box, with the same headline then repeated as the post's own
  heading. One path she can change from the Posts panel.

**A known trap, left in place on purpose: the Press panel still writes to a
file nothing renders reads.** `/edit/manage` shows both a "Posts" panel and a
"Press" panel side by side. Posts is the real one — `App.tsx` now maps the
homepage's `press` section to `<BlogSection />`, and `NewsPress.tsx` (the
component that used to render `press.json`) is parked and mounted nowhere.
The Press panel is still fully wired: she can edit an article, publish it,
watch the request succeed, and nothing on the site will change. It stayed
because retiring it costs more than it looks: `PanelId` is a frozen union
with a test asserting exactly thirteen ids (`src/admin/manage/__tests__/areas.test.tsx`),
and the panel lives inside the `story` area, whose description is one of five
that together fill the 390px home list's 844px screen at an exact
244-character total with zero margin — verified for real only by
`e2e/dashboard-sections.spec.ts:430`, the jsdom sum being a proxy for it.
Touching the area that holds Press moves that math, and the only check that
would catch a miscalculation is Playwright, not the gate. Recording it here
so whoever retires `press.json` next finds the reason
before finding the trap.

**Also still pending and explicitly out of this phase:** the
`viabiancadelhi.com` cutover. The Worker route must move with the site in the
same change (the session cookie is `SameSite=Strict` with no `Domain=`, so it
is host-only), the Web Analytics tag is bound to the `aionxxxi.uk` zone, six
hostnames are hardcoded, and a nameserver switch that drops MX kills email on
the domain silently. Screenshot GoDaddy's record list before touching
anything.

## 20. Phase 5C: deploying the `/blog/*` Worker route, and undoing it

`wrangler.toml` declares four routes now, not two:

| Pattern | `zone_name` |
| --- | --- |
| `vb.aionxxxi.uk/api/*` | `aionxxxi.uk` |
| `viabiancarestaurant.com/api/*` | `viabiancarestaurant.com` |
| `vb.aionxxxi.uk/blog/*` | `aionxxxi.uk` |
| `viabiancarestaurant.com/blog/*` | `viabiancarestaurant.com` |

With those live, `/blog/<slug>` on either hostname is answered by
`worker/post-page.ts` instead of by Pages. Read that file for the mechanism;
the short version is that it fetches `/index.html` from Pages on the request's
own origin and rewrites the `<head>` for one post. Bare `/blog` matches no
pattern and stays on Pages entirely.

### Two things about this that bite

**A push to `main` does not deploy the Worker.** Section 18 has the full
account. It applies here with a sharper edge than usual, because the route
list is the only thing standing between the handler and every visitor: the
code for `/blog/<slug>` sat merged, green and completely unreachable until
someone ran `npx wrangler deploy` with these four patterns in the file.

**`wrangler deploy` replaces the whole route list with exactly what this file
declares.** It does not merge. A route somebody adds by hand in the dashboard
works until the next deploy of this file and then disappears with no error and
no log line. That has already cost this project once: the
`viabiancarestaurant.com/api/*` route was added in the dashboard, a later
deploy wiped it, and `/edit` login on that hostname answered 405 from the
static site until the pattern was written down here. Four patterns must appear
in the deploy output. Anything missing from that output is gone from
production.

### Deploy order, which is the reverse of Step 19's list

Pages must be green **before** the Worker deploy. `worker/post-page.ts` fetches
the live shell rather than carrying a compiled copy, so the Worker rewrites
whatever `/index.html` Pages is serving at that moment. If Pages is behind and
its shell no longer carries an anchor the rewriter needs, `rewriteShellHead`
returns `null` and the handler serves the shell untouched (decision D9). The
visitor gets HTTP 200, a page that renders correctly, and the site-wide title
on every post. Nothing looks wrong in a browser.

    git push                                   # Pages only. Wait for it.
    curl -s https://vb.aionxxxi.uk/build-info.json   # `commit` must equal `git rev-parse HEAD`
    npx wrangler deploy                        # now the Worker, and read its route output

Note the order against "Before a deploy that matters" in Step 19, which runs
`npx wrangler deploy` before `git push`. That order is right for a change to
the Worker's D1 or snapshot behaviour and wrong for this one. When a deploy
carries both, seed and snapshot first, push, wait for Pages, then deploy the
Worker last.

### Smoke checks, with curl and not a browser

```bash
SLUG=$(node -e "console.log(require('./src/content/posts.json')[0].slug)")
for HOST in https://vb.aionxxxi.uk https://viabiancarestaurant.com; do
  echo "--- $HOST/blog/$SLUG"
  curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "$HOST/blog/$SLUG"
  curl -sI "$HOST/blog/$SLUG" | grep -i 'content-security-policy'
  curl -s "$HOST/blog/$SLUG" | grep -o '<title>[^<]*</title>'
done
```

Three things must be right on both hostnames:

- `200 text/html`.
- A `Content-Security-Policy` that is **not** `default-src 'none'`. That
  policy is the API header set, it forbids script and style, and under it the
  page is blank white at a 200 for every visitor. Roll back now if you see it.
- A `<title>` that is the post's own, not
  `Via Bianca - Pastificio & Ristorante | Authentic Italian Dining in Delhi`.
  The site-wide title here means the rewriter found no anchor and fell through.

Then confirm nothing else moved:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://vb.aionxxxi.uk/blogs   # 301 to /blog
curl -sI https://vb.aionxxxi.uk/blog | grep -i content-type            # text/html, from Pages
curl -s https://vb.aionxxxi.uk/api/health                              # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' https://vb.aionxxxi.uk/edit   # 200, the SPA
```

Last, open one post URL in a real browser. curl cannot see a blank page and a
browser can.

### Rollback

Delete these two lines from `routes` in `wrangler.toml`, leaving the two
`/api/*` entries exactly where they are:

    { pattern = "vb.aionxxxi.uk/blog/*", zone_name = "aionxxxi.uk" },
    { pattern = "viabiancarestaurant.com/blog/*", zone_name = "viabiancarestaurant.com" },

Then:

    npx wrangler deploy

Deploying the previous commit's `wrangler.toml` does the same thing and is the
safer move if you are not sure what else in the file has changed since. Either
way the deployed list is whatever the file says, so check the printed output
for two patterns and not four.

Do not delete the `/api/*` entries while you are in there. Removing them takes
`/edit` login, publishing and the WhatsApp counter down on both hostnames, and
that is a much larger outage than the one you are fixing.

Reach for `npx wrangler rollback` only after this. It moves the script back to
an earlier version; the route list is deployment configuration rather than
part of a version, so it is not reliably what changes here.

**What a visitor sees during the window.** Until the rollback deploy finishes,
whatever broke stays broken: a blank page, a 502, or a post page carrying the
site-wide title. The moment it finishes, Pages answers `/blog/*` again and
every post URL renders exactly as it did before this phase, with site-wide
metadata in the head and the article itself rendered by the SPA as always. The
handler cannot run without a route, so the Worker code needs no revert and no
second deploy. Nothing outside `/blog/*` moves at any point.

---

## 21. The photograph bucket: binding `via-bianca`, and the custom domain it is served from

Phase 6, Task 1. This section records what was done in the repository, what was
measured against the live account, and the two steps a **human with dashboard
access still has to take** before any content reference is allowed to point at
`img.viabiancarestaurant.com`.

### What is already in the repository

- `wrangler.toml` binds the bucket:

      [[r2_buckets]]
      binding = "R2"
      bucket_name = "via-bianca"

  Bound, and read by nothing. `env.R2` has no caller until Task 4.
- `wrangler.toml`'s `[vars]` gained `IMAGE_HOST` and `PAGES_ORIGIN`.

  **`PAGES_ORIGIN` is `https://vb-c7r.pages.dev`, and it shipped wrong once.**
  It went in as `https://vb.pages.dev`, derived from the Pages project's name
  (`vb`) rather than read off the account — which is precisely the mistake
  §17 above had been warning about in writing for weeks. Nothing read the var
  yet, so nothing broke; had the `/*` route landed on it, every page view on
  `viabiancarestaurant.com` would have fetched its SPA shell from an unrelated
  third party's website and served that HTML from this site's own origin,
  arriving with no Content-Security-Policy at all (that project sets none).

  Three things now stand between this repository and a repeat, and the first
  two are new because the guard that existed asserted only that the value
  *looked like* a `pages.dev` hostname — which the stranger's host does:

  1. `src/test/wrangler-config.test.ts` pins the exact alias, names
     `vb.pages.dev` as a value that must stay rejected, and checks the alias
     still matches the recorded project name (so a project rename reddens
     rather than rots).
  2. `npm run verify:deploy` fetches `${PAGES_ORIGIN}/index.html` after every
     deploy and fails unless the bytes coming back are *this* site's shell —
     right `<title>`, an `/assets/index-*.js` entry bundle, and a CSP header.
     The logic is `scripts/shell-origin-check.mjs`, unit-tested against the
     stranger's real response.
  3. `wrangler.toml`'s own comment carries the measurement and the rule:
     **derive nothing here.** `npx wrangler pages project list` is the source.

  One more measured fact for whoever writes the subrequest: Pages answers
  `GET /index.html` with a **308 to `/`**. `fetch()` follows redirects by
  default, so the join works — but `redirect: 'manual'` would hand a visitor
  an empty 308.
- `public/_headers` widened `img-src` — and only `img-src` — to admit
  `https://img.viabiancarestaurant.com`.
- `src/shared/image-host.ts` is the one place the hostname is spelled for code.
  `src/test/wrangler-config.test.ts` asserts it and the `IMAGE_HOST` var are the
  same string.

### What was measured against the live account, 2026-09-01

Run from an authenticated `npx wrangler` (4.119.0), all with `--remote`:

    $ npx wrangler r2 bucket list
    name:           via-bianca
    creation_date:  2026-09-01T15:47:38.564Z

    $ printf 'ok' > /tmp/vb-probe.txt
    $ npx wrangler r2 object put via-bianca/__probe__.txt --file=/tmp/vb-probe.txt \
        --content-type=text/plain --remote
    Resource location: remote
    Creating object "__probe__.txt" in bucket "via-bianca".
    Upload complete.

    $ npx wrangler r2 object get via-bianca/__probe__.txt --file=/tmp/vb-probe-back.txt --remote
    Resource location: remote
    Downloading "__probe__.txt" from "via-bianca".
    Download complete.

    $ diff /tmp/vb-probe.txt /tmp/vb-probe-back.txt && echo 'ROUND TRIP OK'
    ROUND TRIP OK

    $ npx wrangler r2 object delete via-bianca/__probe__.txt --remote
    Resource location: remote
    Deleting object "__probe__.txt" from bucket "via-bianca".
    Delete complete.

    $ npx wrangler r2 object get via-bianca/__probe__.txt --file=/tmp/x.txt --remote
    ✘ [ERROR] The specified key does not exist.

`Resource location: remote` on every line and a "does not exist" after the
delete are the two answers that matter. Without them the whole exercise could
have happened in the local miniflare simulation, which is the failure mode most
easily mistaken for success. The bucket is empty again.

    $ npx wrangler r2 bucket dev-url get via-bianca
    Public access via the r2.dev URL is disabled.

That is the state the task wants and it needed no change — `r2.dev` is off by
default on a new bucket. Cloudflare documents `r2.dev` as development-only and
rate-limited, warns against even pointing a CNAME at it, and gives it no edge
caching, no WAF and no bot management. **It stays disabled.** If anybody ever
turns it on to debug something, turn it back off in the same sitting.

### STILL TO DO — a human with dashboard access, before Task 4

    $ npx wrangler r2 bucket domain list via-bianca
    There are no custom domains connected to this bucket.

**Nothing serves `https://img.viabiancarestaurant.com/<key>` yet, and the
hostname does not resolve.** Verified: `curl` returns
`Could not resolve host: img.viabiancarestaurant.com`.

1. **Connect the custom domain.** R2 → `via-bianca` → Settings → Public access →
   Custom Domains → **Connect Domain**, enter `img.viabiancarestaurant.com`. The
   zone is already on Cloudflare, so the DNS record and the certificate are
   issued automatically. Wait for status **Active**.

   This is a public-access change on the live zone and it makes every object in
   the bucket world-readable at a predictable URL. It is a decision for the
   account owner, which is why no script in this repository performs it.

2. **Re-run the round trip, this time over HTTPS.** The wrangler half above
   proves the API path; it does not prove the *served* path, which is the one a
   visitor's browser uses.

       printf 'ok' > /tmp/vb-probe.txt
       npx wrangler r2 object put via-bianca/__probe__.txt --file=/tmp/vb-probe.txt \
         --content-type=text/plain --remote
       curl -sS -D - -o /tmp/vb-probe-back.txt https://img.viabiancarestaurant.com/__probe__.txt
       diff /tmp/vb-probe.txt /tmp/vb-probe-back.txt && echo 'ROUND TRIP OK'
       npx wrangler r2 object delete via-bianca/__probe__.txt --remote
       curl -sS -o /dev/null -w '%{http_code}\n' https://img.viabiancarestaurant.com/__probe__.txt

   The three answers that must all hold: `HTTP/2 200` with
   `content-type: text/plain` on the read; `ROUND TRIP OK` on the diff; **404**
   after the delete. A 404 on the *first* read means the domain is not Active
   yet. A Cloudflare error page means public access is not on.

   Paste all four responses back into this section when they hold.

3. **Ship the widened `img-src` and check it on the wire.** `public/_headers`
   reaches production through a Pages build, so the commit carrying it has to be
   on `main` and deployed before any reference moves:

       curl -sSI https://viabiancarestaurant.com/ | tr ';' '\n' | grep -i 'img-src'

   The live header must already list `https://img.viabiancarestaurant.com`
   **before Task 4 begins**.

**Why the ordering is not negotiable.** `img-src 'self' blob:` forbids loading
an image from any other host. A content reference rewritten to the bucket before
that header ships would answer **200 from R2 and still be refused by the
browser** — every photograph on the site becomes a broken-image icon, on every
browser, with nothing in the network tab that looks like a failure. That is the
single most expensive ordering mistake available in this migration, and Task 1
exists to spend it here instead.

The Worker is **not** deployed by this task. `env.R2` is bound in configuration
and read by nothing until Task 4.

### Re-measured 2026-09-01, before Phase 6 Task 4

None of the three human steps above has been taken:

    $ npx wrangler r2 bucket domain list via-bianca
    There are no custom domains connected to this bucket.

    $ curl https://img.viabiancarestaurant.com/probe.txt
    curl: (6) Could not resolve host: img.viabiancarestaurant.com

    $ curl -sSI https://viabiancarestaurant.com/ | tr ';' '\n' | grep -i img-src
    img-src 'self' blob:

So **Task 4 has not been run and cannot be**, and `image-manifest.json` does not
exist. `scripts/migrate-images.mjs` is written, unit-tested and wired to
`npm run migrate:images`; what it is missing is a hostname to read objects back
from. Its read-back is the whole point of the task — it proves the host the
content files are about to name answers the key with those exact bytes under
that exact type — so it must not be stubbed, skipped or pointed at the bucket
API to get a green run. An object the read-back never confirmed carries no
`verifiedAt`, and `scripts/rewrite-image-refs.mjs` refuses to rewrite a
reference to a target without one. That refusal is the only thing standing
between a half-finished migration and a page of half-broken photographs.

**The order to run them in, once a human has done step 1 above:**

    npx wrangler r2 bucket domain list via-bianca     # status must read Active
    # then step 2's HTTPS round trip, all four responses
    npm run migrate:images                             # expect 0 failed, 95 verified
    npm test -- --run                                  # the manifest tests come with Task 4's second half

`95`, not the plan's `100`: `docs/image-inventory.json` lists 44 referenced
derivatives (six derivatives in `public/` are referenced by nothing and are
left alone, decision D9) and 51 originals. The two menu PDFs are held back for
Task 19 and are migrated by `npm run migrate:images -- --menus`.

One thing the migration does that the plan did not describe. Ten of the
fifty-one archived originals carry a `.jpg` name over PNG data —
`atmosphere/dining.jpg`, `atmosphere/outsideLOGO.jpg`, `food/margarita.jpg`,
`food/tielle.jpg`, `food/tiramisu.jpg`, `food/Aglio e Pepperoncini.jpg`,
`food/Spaghetti alla'Assassina.jpg`, `hero/brick.jpg`, `mocktails/bicerin.jpg`
and `our_story/handmaking.jpg`. Typing those from the key's extension would
store every one of them as `image/jpeg`. `detectImageType` reads the magic
number instead, and only for originals: a derivative's bytes have already been
proved a complete RIFF WEBP, and a menu PDF's extension is chosen here rather
than by whoever handed the photograph over.

### The rewrite exists and has not been run either

`scripts/rewrite-image-refs.mjs` turns all 77 site-root references into
absolute URLs on the image host. It reads `image-manifest.json` and refuses,
writing nothing at all and exiting 1, if a single reference names an object
without a `verifiedAt`. Since that manifest does not exist, the script exits on
its first line — which is the correct behaviour and not a bug to work around.

Proved offline, against the real twelve content files and the five code files
with a manifest that verifies everything: **77 changed, 3 distinct references
kept** (`/og-image.jpg` and the two menu PDFs), **0 missing, 13 files touched**,
including `src/index.css`'s `body::before` texture, and no site-root photograph
left in anything it wrote. `scripts/__tests__/rewrite-image-refs.test.mjs` is
that proof and it runs on every push.

**What is still owed before the references may move**, in order:

1. The R2 custom domain, the HTTPS round trip, and the widened `img-src` live
   on the wire — the three steps above.
2. `npm run migrate:images`, 0 failed.
3. The refusal, proved before it is trusted:

       cp image-manifest.json /tmp/real-manifest.json
       node -e "const m=JSON.parse(require('fs').readFileSync('image-manifest.json','utf8'));delete m.objects['food/pizza1.webp'].verifiedAt;require('fs').writeFileSync('image-manifest.json',JSON.stringify(m,null,2))"
       node scripts/rewrite-image-refs.mjs; echo "exit=$?"
       git status --porcelain src/content src/components src/index.css
       cp /tmp/real-manifest.json image-manifest.json

   `exit=1`, and `git status --porcelain` must print **nothing**. If it wrote
   anything, the refusal is not a refusal and the whole safety argument is void.
4. `node scripts/rewrite-image-refs.mjs` for real. Expect
   `rewrite: 77 references, 4 deliberately left alone` (four occurrences, three
   distinct paths).
5. **Move the offline guardrail in the same commit.**
   `src/content/__tests__/assets.test.ts` resolves every discovered path against
   `publicFiles`. After the rewrite the content strings start with `https://`,
   `ASSET_PATH_PATTERN` stops matching them, and the content half of that walk
   silently becomes vacuous. Task 6 Step 5 of the plan carries the replacement
   assertions, including the miss detector — *nothing still points at a migrated
   category directory* — which is the one that catches a reference the rewrite
   skipped. A missed reference RESOLVES, because `public/` still holds the file.
6. Deploy, `npm run verify:images`, then **a human opens the live homepage,
   `/blogs` and each of the six standalone pages and looks at them** with the
   network panel open. The sweep cannot see `src/index.css`'s `body::before`
   texture or the hero collage's geometry. Those are eyes.
7. Write that commit's sha here, with: *`git revert <sha>` restores every
   reference to its site-root path; `public/` still holds every file they name
   and `npm run images` still rebuilds them from `assets-source/`, so the site
   returns to serving its own photographs with no other change and no R2
   involvement.*
