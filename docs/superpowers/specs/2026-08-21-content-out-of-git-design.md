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
