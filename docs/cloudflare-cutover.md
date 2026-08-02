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
  Workers & Pages → this project → **Analytics** → **Web Analytics** → **Enable**. That's the
  whole step. Cloudflare then injects its own beacon into every response it serves for this
  project — the `*.pages.dev` preview, the eventual custom domain, and every deploy after this
  one — automatically, with no token to copy anywhere and no file in this repository to edit.
  This repository deliberately ships with **no** beacon `<script>` in `index.html` (see the
  comment there) and a test (`src/test/analytics.test.ts`) that fails if one is added back by
  hand, specifically so nobody re-introduces the second-beacon failure mode by "helpfully"
  wiring up analytics in code that Cloudflare is already handling.
- **Manual snippet, for a site not on Cloudflare at all (do not use this one here).** Cloudflare
  also documents copying a token into a hand-placed `<script>` tag, for sites that aren't
  Cloudflare Pages or Workers projects. That path does not apply to this project — do not add
  that script to `index.html`. If the dashboard ever shows you a manual snippet instead of a
  one-click **Enable** for this Pages project, stop and double-check you're looking at the Pages
  project's own Analytics tab rather than the generic "Add a site" flow.

Once enabled, this commit-free dashboard change takes effect on the next request Cloudflare
serves for the project — there is nothing to commit or redeploy for this step. Still, before
moving on to Step 5 (DNS), **re-run both Step 3 checks against the preview URL** — a hard refresh
on `/blogs` still returns the page, and the build log still reports 48 images. That costs nothing
and Step 3 said to check for real rather than assume.

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

## 7. Remove the Vercel project

Only after Step 6 passes on the live domain. This is the point of no easy rollback, so don't
rush it — but once you're here, decommission the Vercel project. The site is fully cut over.
