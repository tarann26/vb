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

- **Build command:** `npm run images && npm run test:deploy && npm run build`
  Yes, `npm run images` runs twice — once here, once again inside `npm run build` (which runs
  `npm run images && tsc -b && vite build`). That costs about six seconds. It is not a mistake:
  `npm run test:deploy` runs the test suite, and Task 2 of the migration plan made `public/`
  derivatives untracked, so on a fresh clone (exactly what Cloudflare builds from) they do not
  exist until `npm run images` has run at least once. Run the test gate before those derivatives
  exist and the asset and OG-image tests fail — not because anything is broken, but because
  nothing has generated the images they check for yet. Run `npm run images` here first and the
  gate tests what it's supposed to: a real build, gated by tests that see the real output.
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

`src/test/wrangler-config.test.ts` asserts that id is still exactly the placeholder string. Skip
this step and `npm run test:deploy` fails there, with a message naming the reason, instead of the
Worker failing at runtime with an unbound KV binding the first time a login or a publish tries to
use it.

## 9. Deploy the admin Worker, then confirm its route is actually live

Do this after Step 8 (the KV namespace exists) and after DNS (Step 5) has the zone on Cloudflare —
the Worker's route (`viabiancadelhi.com/api/*` in `wrangler.toml`) is meaningless on a zone
Cloudflare doesn't control yet.

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

**This curl check is the only reliable way to confirm the route is live — nothing committed to
this repository can do it.** `public/_redirects` cannot express "fail loudly" for an unrouted
path (Cloudflare Pages' `_redirects` only accepts status 200, 301, 302, 303, 307 or 308, so there
is no way to make it answer `/api/*` with a 404 the way a real misconfiguration should look); its
SPA catch-all will happily return 200 with the homepage's HTML for `/api/health` too, if the Route
isn't actually intercepting the request first. `src/test/hosting.test.ts` pins that the *route
configuration* in `wrangler.toml` names the right pattern and zone, which catches a config typo
before it ships — but it cannot observe whether Cloudflare is actually honouring that
configuration on the live zone. Only a real request against the live domain, after a real deploy,
can. Re-run the same curl after any future change to `wrangler.toml`'s `routes`, not just the
first time.

## 10. Set the admin login password, and how to rotate it

Unrelated to Steps 1–9 above (no ordering dependency on DNS, Pages, or the KV namespace) but
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

1. **Generate the password — don't choose one.** The rate limit below is best-effort, not a hard
   wall, which means password strength is the control that actually matters here. Prefer:
   ```bash
   openssl rand -base64 24 | tee /dev/tty | node scripts/hash-password.mjs
   ```
   `tee /dev/tty` shows you the generated password once (so you can save it in a password manager)
   while still piping it into the hashing script — the alternative of typing a password yourself
   tends to produce something far weaker than 24 random bytes.
2. Set it as a Worker secret:
   ```bash
   node scripts/hash-password.mjs | npx wrangler secret put ADMIN_PASSWORD_HASH
   ```
   (Confirmed safe against the CLI adding stray whitespace: `wrangler secret put` trims trailing
   whitespace from piped stdin, so the trailing newline `console.log` puts after the hash does not
   end up stored as part of the secret.)
3. Set `TOKEN_SECRET` — the HMAC key session tokens are signed with, unrelated to the password
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
repository — which is why Step 1 above generates one rather than asking you to choose one. If a
durable, atomic rate limit is ever wanted, the right place for it is a Cloudflare WAF rate-limiting
rule on `/api/login` at the edge, in front of the Worker; that is not built as part of this task,
only recorded here as where it goes.

**Rotating the password does not, on its own, invalidate sessions already issued.** A session
cookie's validity comes entirely from `verifyToken`'s HMAC check against `TOKEN_SECRET` (see
`worker/auth.ts`), not from whether the password that produced it is still current — so changing
only `ADMIN_PASSWORD_HASH` leaves every outstanding 7-day cookie valid until it naturally expires.
If the point of rotating the password is to lock out anyone who already holds a session (a leaked
password, a lost or stolen device), **rotate `TOKEN_SECRET` too, in the same sitting**:

```bash
openssl rand -base64 24 | tee /dev/tty | node scripts/hash-password.mjs | npx wrangler secret put ADMIN_PASSWORD_HASH
openssl rand -base64 32 | npx wrangler secret put TOKEN_SECRET
```

Rotating `TOKEN_SECRET` signs out every existing session immediately, including whoever is doing
the rotation — they will need to log in again with the new password right after.
