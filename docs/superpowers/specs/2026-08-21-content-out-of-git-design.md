# Content out of git: publish without a deploy

**Date:** 2026-08-21
**Status:** draft, awaiting owner approval

## Goal

Make Publish instant, and stop redeploying the whole website to change a
dish description.

## Why

The dashboard tells her, in its own words: **"It usually takes about 2-3
minutes for the site to show the change."** That sentence exists because
nine of the twelve content files are compiled into the site, so publishing
them writes a commit, which triggers a full Cloudflare Pages rebuild, which
redeploys everything.

The other three files already work the way this spec proposes. `PublishBar`'s
own comment on that branch reads: *"No commit, so no Cloudflare build to wait
for -- the change is already live the moment this response arrived."* It calls
that **"the fastest publish this dashboard can make."**

So the contrast is already documented in this repository. Awards publish
instantly. The menu takes 2-3 minutes and ships the entire site.

**The cost is not untidy history. It is blast radius.** Every content edit is
a production deploy, and every production deploy opens the window
`verify:deploy` warns about on every single run -- the one where a request
landing mid-deploy receives a wrongly-typed asset, the browser refuses to
execute it, and that visitor gets a blank page cached for an hour. That has
happened three times. Changing a price should not carry the same risk as
shipping code.

## What moves, and what deliberately does not

**Storage moves. The shape does not.**

These are separate decisions and conflating them would be expensive. The
content is document-shaped: a post is a nested tree of blocks, a dish carries
an array of tags. Modelling that relationally means an adjacency table,
ordering columns, and a multi-join to render one paragraph.

Three further reasons the JSON documents stay exactly as they are:

- `guards.ts` and `validate.ts` are thousands of lines built around document
  shapes, and that layer has caught real corruption. Decomposing means
  rewriting all of it.
- `revisions.body` stores a whole document, which is why one publish restores
  as one group. Splitting into rows breaks undo.
- Nothing queries content relationally. She opens a file, edits it, publishes
  it. There is no query to optimise for.

D1 stores JSON in a TEXT column perfectly well, and `content` already does
exactly that for the three files that moved. **This is a storage change.**

## How a page gets its content

**The Worker renders content into the HTML before it reaches the browser**,
the same way `worker/post-page.ts` already renders blog posts for crawlers.

This was chosen over a compiled-in fallback for one decisive reason: **a
compiled-in copy is only correct if something periodically commits the
current version back.** That does not remove commits, it reschedules them.
Server-rendering has nothing to keep in sync, so the commits genuinely stop.

It is also the only option that keeps SEO honest. A restaurant lives on
someone searching its menu; a crawler that does not run JavaScript must still
see one.

**Three layers, in order:**

1. **Edge cache.** Most visitors are served a cached render and never reach
   D1. The Cache API is already used this way for `/api/published`.
2. **D1.** Read on a cache miss.
3. **The compiled-in JSON, as a floor.** It stays in the repository and is
   updated only when code deploys anyway. It is not a sync target and never
   triggers a publish commit. It exists so that D1 being unreachable degrades
   the site to slightly stale rather than blank.

**A consequence to state plainly:** today only `/api/*` reaches the Worker and
pages come straight from the CDN. After this, **every page view is a Worker
request.** Workers Free allows 100,000 a day against a few hundred of real
traffic, so there is enormous headroom -- but it is a real change in how the
site runs, not an implementation detail.

## Images

**All images move to R2, including the roughly forty already committed.**

One place a photo can live, not two. The repository stops growing with every
upload, and the build stops carrying image bytes.

R2 is $0.015 per GB-month with **free egress** and a 10 GB monthly free
allowance. The whole library is around 600 MB. The expected bill is zero; R2
is gated behind a card on file rather than behind a real cost.

**Every image path in every content file has to be rewritten as part of the
same migration**, and getting that wrong means broken photographs on the live
site. That is the riskiest mechanical step in this document.

**Workers stays on the free plan** by the owner's decision. The consequence,
recorded rather than assumed: D1's free tier **returns errors** when a limit
is passed, it does not throttle. The edge cache above is what keeps ordinary
traffic away from D1, which is what makes that acceptable.

## Undo, which already exists

`revisions` is live in production today: full document body, `publish_id`
grouping so one undo restores exactly what one publish changed, plus version
and timestamp. Nothing here needs designing.

**Retention is by COUNT, not by age.** Keep the last N revisions per file.

Time-based deletion has a failure mode worth stating: a file edited once a
year would have its only revision deleted after thirty days, leaving that file
with **no recovery at all**. A count bounds storage identically and can never
do that.

**Images are retained at least as long as any revision that references them.**
Otherwise a restore succeeds and hands her a page of broken photographs. This
project has already shipped exactly that failure once, where a post named a
file that was never uploaded, so it is not hypothetical.

An R2 lifecycle rule deletes by **age, not by whether anything still uses the
object** -- so a two-year-old photograph still on the live menu is exactly as
old as one replaced last month. No lifecycle rule may be pointed at current
images. If superseded images are ever cleared, they move to their own prefix
first.

## What this does not do

**No relational modelling of content.** Argued above.

**No live preview.** Wanted, and specified separately: Publish opens a real
view of the site with her unpublished changes injected, she navigates it
properly, then confirms or goes back and edits. It needs nothing from this
migration, so coupling them would only delay it.

**No change to what she sees or does.** She edits the same panels and presses
the same button. The button just stops taking three minutes.

## Order of work, chosen so nothing is ever all-or-nothing

1. **R2 and the images.** Independent of everything else and the highest value
   on its own: photo uploads stop committing immediately.
2. **One content type at a time**, behind the layering above, starting with
   the one whose SEO matters least and ending with the menu.
3. **The publish path last**, once every read path is live, so the commit
   stops only when nothing depends on it.

At no point is there a state where content is in D1 but nothing can read it.

## Testing

The project's discipline holds: every test must be able to fail, proven by
mutating the code and watching it go red.

- **A crawler check on real HTTP**, not a browser: the menu must be in the
  response body. `verify:deploy` already does this for post SEO and is the
  model.
- **The image path rewrite is verified against the live site**, not against a
  fixture. Every referenced image must resolve; a 404 on a photograph is the
  failure this migration is most likely to ship.
- **The D1-unreachable path is exercised deliberately**, and the site must
  render stale rather than empty.
- **Undo across the new paths**: one publish, one restore, byte-identical
  content back.

---

## Operational risks, researched rather than assumed

Added after the first draft. Each was verified against Cloudflare's own
documentation, and each changes something.

### R2's public URL is not usable in production

`r2.dev` is **rate-limited and documented as development-only**. Cloudflare
warns against even pointing a CNAME at it, calling that "an unsupported access
path" with no guaranteed reliability or performance. It also gets no caching,
no WAF and no bot management.

**Decision: images are served from a custom domain, `img.viabiancarestaurant.com`,
connected to the `via-bianca` bucket.** The zone is already on Cloudflare, so
this costs nothing and takes one dashboard step. The `r2.dev` subdomain is then
**disabled**, because leaving it on exposes the bucket through a path that
bypasses whatever protections the custom domain has.

Serving images through the Worker instead was considered and rejected: it would
put every photograph through the same 100,000/day Workers Free budget that now
also serves every page view.

### D1 point-in-time recovery is SEVEN days on the free plan

Time Travel is always on and needs no configuration, but the window is **7 days
on free and 30 on paid**. Once content lives only in D1, that is the whole
safety net for a corruption nobody notices immediately.

**Decision: a weekly export of every content document back into the repository**,
committed by a scheduled job. This is NOT the per-publish commit this migration
exists to remove -- it is one commit a week whose only job is to make the
content survive losing D1 entirely.

That mitigation is what makes staying on the free plan reasonable. Without it,
a mistake discovered on day eight would be unrecoverable. **The alternative is
$5/month for Workers Paid, which widens the window to 30 days; that is the
owner's call and the export should be built either way.**

### The repository stops being the source of truth

Today a fresh clone builds the current site. Afterwards it builds whatever the
compiled-in floor happens to say, which may be months stale.

**Decision: the floor files carry a header comment stating they are a fallback,
not the live content, and naming where the live content actually is.** The
weekly export keeps them from drifting far enough to matter.

### Publishing must invalidate the edge cache

The whole promise is that a publish is visible immediately. An edge cache that
serves a stale render for its full TTL breaks exactly that, and it would look
to her like the publish silently failed.

**Decision: a publish purges the cache entries it affects, and the plan proves
it by publishing and then reading the live page in a browser.** A test that
only checks the cache key is not proof.

### Deleting content orphans its images

Removing a dish leaves its photograph in R2 with nothing pointing at it.

**Decision: orphans are left in place.** At 56 images and a restaurant's rate of
change this is a rounding error against a 10 GB allowance, and the alternative --
deleting on content change -- is exactly how this project already deleted a
photograph that was still in use. Reclaiming can be a deliberate, separate,
manually-run sweep if it ever matters.

### The migration itself must be atomic per image

Uploading 56 images and rewriting 68 references is not one operation. A failure
between them leaves the site pointing at files that are not there yet.

**Decision: every image is uploaded and VERIFIED READABLE at its final URL
before any content file is rewritten to point at it.** The rewrite is the last
step, and it is reversible by a single commit because the content files are
still in git at that moment.

### Hotlinking

A public bucket can be hotlinked by anyone. R2 egress is free, so this costs
nothing directly.

**Decision: accept it.** A hotlink protection rule can be added later if it ever
matters; spending complexity on it now would be solving a problem the
restaurant does not have.
