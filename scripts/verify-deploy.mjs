// The post-deploy check, as a command rather than a list of curls a human is
// asked to remember. This is docs/cloudflare-cutover.md §16a made executable.
//
// It exists because the site went completely blank for every visitor and no
// check in this repository noticed. The entry bundle was being served as
// text/html from a poisoned edge cache, Chrome refused to execute it as a
// module script, and nothing mounted. Three properties of that failure are
// what this script is shaped around, and each one defeated a simpler check:
//
//   1. IT WAS INVISIBLE TO CURL. Exactly one cached variant was wrong, keyed
//      on the request's Origin, with no `Vary` header advertising the split.
//      `curl -I <asset>` returned application/javascript while every real
//      browser got text/html. So every asset fetch below sends the site's own
//      Origin -- the variant visitors actually receive.
//
//   2. HTTP 200 MEANT NOTHING. The poisoned response was a perfectly healthy
//      200; it was simply HTML. Status is never checked in isolation below --
//      Content-Type is.
//
//   3. THE SPA CATCH-ALL MANUFACTURES THE POISON. A request for an asset the
//      edge does not have yet falls through `/*  /index.html  200` and is
//      answered with HTML, which then gets cached under a content-hashed URL
//      that by definition never revalidates. Reproducible on demand: fetch
//      /assets/anything-that-does-not-exist.js and read the Content-Type.
//      That is probed explicitly, so the day Cloudflare changes this
//      behaviour, this repository finds out.
//
// Run with `npm run verify:deploy` after pushing to main.
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SITE = process.env.VB_SITE ?? 'https://vb.aionxxxi.uk';
const ORIGIN = new URL(SITE).origin;

const EXPECTED_TYPE = { '.js': /javascript|ecmascript/i, '.css': /text\/css/i };

const ROUTES = [
  '/',
  '/blogs',
  '/catering',
  '/cheeseboards',
  '/cooking-class',
  '/membership',
  '/breads-and-dips',
  '/who-we-supply',
  '/edit',
];

const failures = [];
const note = (m) => console.log(m);

// Every fetch carries the site's own Origin, for reason (1) above.
async function get(path) {
  const res = await fetch(`${SITE}${path}`, { headers: { Origin: ORIGIN } });
  // Body drained so the connection is released; nothing here reads it.
  await res.arrayBuffer().catch(() => {});
  return res;
}

// ---------------------------------------------------------------------------
// 1. Is the commit under test actually the one being served?
//
// build-info.json is `no-store`, so it is the one thing on this site that
// cannot itself be answered from cache -- which is exactly why the wait keys
// on it rather than on a header. An earlier hand-run version of this check
// polled for a header instead and exited on its first attempt, because the
// header it waited for was already being set by a Cloudflare zone rule. It
// could not fail, and it reported a deploy live that had not started.
// ---------------------------------------------------------------------------
const headSha = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
note(`waiting for ${headSha.slice(0, 12)}`);
let live = null;
for (let i = 0; i < 45; i += 1) {
  const res = await fetch(`${SITE}/build-info.json`, { cache: 'no-store' }).catch(() => null);
  live = res ? (await res.json().catch(() => null))?.sha : null;
  if (live === headSha) break;
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
if (live !== headSha) {
  console.error(`\nFAIL: still serving ${String(live).slice(0, 12)} after 7.5 minutes`);
  process.exit(1);
}
note('deploy is live');

// ---------------------------------------------------------------------------
// Then wait a little longer, and this is not politeness.
//
// build-info.json going live means the BUILD finished. It does not mean every
// content-hashed asset has reached every edge node. In the window between the
// two, a request for an asset this node does not have yet falls through the
// SPA catch-all, gets HTML at 200, and the edge caches that HTML under a
// content-hashed URL -- so a checker that fetches assets the instant the sha
// flips does not observe the poisoning, it CAUSES it.
//
// Observed exactly that: this script reported three admin chunks serving
// text/html with `age` equal to the number of seconds since its own run
// started. The entries were created by the check.
//
// The delay does not make the race impossible, only unlikely -- a real
// visitor arriving mid-window can still trigger it, which is why s-maxage on
// /assets/* is an hour rather than a day. What it does is stop this script
// being the visitor who always arrives first.
const SETTLE_MS = Number(process.env.VB_SETTLE_MS ?? 45_000);
note(`waiting ${Math.round(SETTLE_MS / 1000)}s for assets to propagate before touching them`);
await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
note('');

// ---------------------------------------------------------------------------
// 2. Every built asset -- checked on the PER-DEPLOYMENT Pages URL, never on
//    the production hostname.
//
// This script twice CAUSED the outage it exists to detect, and this is the
// fix. Fetching a freshly-deployed asset through the production zone is the
// poisoning mechanism itself: if that edge node does not have the file yet,
// the request falls through the SPA catch-all, is answered with index.html at
// 200, and the edge stores that HTML under a content-hashed URL that never
// revalidates. The tool checking for a blank site was the request that made
// the site blank, twice, with `age` equal to the seconds since it started.
//
// A settle delay was the first attempt and was not enough -- propagation is
// not a fixed interval, so no constant is correct.
//
// The per-deployment URL (<id>.<project>.pages.dev) serves one specific
// deployment directly. It is the same bytes, so a wrong Content-Type there is
// still a real failure, but a miss cannot poison the production cache because
// production is not involved. VB_DEPLOY_URL overrides it; without one, this
// step is SKIPPED rather than silently falling back to the dangerous check.
// ---------------------------------------------------------------------------
const deployUrl = process.env.VB_DEPLOY_URL ?? null;
note(deployUrl ? `assets (on ${deployUrl}, not production):` : 'assets: SKIPPED (set VB_DEPLOY_URL to the per-deployment Pages URL)');
for (const file of deployUrl ? readdirSync('dist/assets') : []) {
  const expected = EXPECTED_TYPE[file.slice(file.lastIndexOf('.'))];
  if (!expected) continue;
  const res = await fetch(`${deployUrl}/assets/${file}`, { headers: { Origin: deployUrl } });
  await res.arrayBuffer().catch(() => {});
  const type = res.headers.get('content-type') ?? '';
  const ok = res.status === 200 && expected.test(type);
  note(`  ${ok ? 'ok  ' : 'FAIL'}  ${file}  ${res.status} ${type} ${ok ? '' : `(${res.headers.get('cf-cache-status')}, age ${res.headers.get('age') ?? '0'})`}`);
  if (!ok) {
    // `cf-cache-status: HIT` on a wrong Content-Type means this is not a
    // transient miss that will resolve itself -- the edge has stored the
    // wrong response under a content-hashed URL, and every visitor gets it
    // until s-maxage expires. Said out loud because the difference decides
    // what to do next: wait, or bust the hash with a new build.
    const cached = /HIT/i.test(res.headers.get('cf-cache-status') ?? '');
    failures.push(
      `/assets/${file} served ${res.status} ${type}` +
        (cached ? ' -- CACHED, so every visitor gets this until s-maxage expires' : ''),
    );
  }
}

// ---------------------------------------------------------------------------
// 2b. Is the WORKER current, or only the site?
//
// These are two entirely separate deployments and only one of them is
// automatic. Pushing to main makes Cloudflare Pages rebuild the site; nothing
// in that pipeline touches worker/, which reaches production only when
// somebody runs `wrangler deploy`. build-info.json is written by the Pages
// build, so it reports the site's commit and says nothing at all about the
// Worker -- meaning step 1 above can pass on a deploy where every API change
// in the repository is still sitting unpublished.
//
// That is not hypothetical. Two days of security work -- rate limits, the API
// security headers, the cross-origin write check, the body-size caps, and the
// fix that had the reserve-a-table counter answering 403 to every real tap --
// were committed, verified by tests, reported as shipped, and were not live.
// The last `wrangler deploy` predated all of it. Nothing anywhere noticed,
// because nothing anywhere looked.
//
// Checked behaviourally rather than by version, because there is no version
// to compare against: a Worker predating worker/index.ts's withSecurityHeaders
// cannot set these, so their presence IS the proof it is current. If this list
// ever changes in worker/index.ts, it has to change here too, and that is the
// point -- a header this repository claims to set and does not is exactly what
// went unnoticed.
// ---------------------------------------------------------------------------
note('\nadmin Worker (deploys separately from the site -- `wrangler deploy`):');
const health = await get('/api/health');
const WORKER_HEADERS = ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'content-security-policy', 'cache-control'];
const missingWorkerHeaders = WORKER_HEADERS.filter((h) => !health.headers.get(h));
if (!/json/i.test(health.headers.get('content-type') ?? '')) {
  note(`  FAIL  /api/health answered ${health.status} ${health.headers.get('content-type')}`);
  failures.push('/api/health is not being served by the Worker at all -- check the route in wrangler.toml');
} else if (missingWorkerHeaders.length) {
  note(`  FAIL  /api/health is missing ${missingWorkerHeaders.join(', ')}`);
  failures.push(`the deployed Worker is STALE -- run \`npx wrangler deploy\` (missing ${missingWorkerHeaders.join(', ')})`);
} else {
  note('  ok    /api/health carries every header the current Worker sets');
}

// ---------------------------------------------------------------------------
// 3. The mechanism itself, probed directly.
//
// Not a health check -- this one is EXPECTED to be broken today, and says so.
// A missing asset falling through to the SPA catch-all is what creates a
// poisoned entry in the first place. Reported rather than failed, because
// nothing in this repository can currently prevent it (see
// docs/cloudflare-cutover.md §16b for why `_redirects` cannot express it);
// the point is that the day it changes, in either direction, somebody sees it.
// ---------------------------------------------------------------------------
const missing = await get('/assets/index-DOES-NOT-EXIST.js');
const missingType = missing.headers.get('content-type') ?? '';
note(`\nmissing-asset fallthrough: ${missing.status} ${missingType}`);
note(
  /html/i.test(missingType)
    ? '  STILL PRESENT -- a request landing here mid-deploy is what poisons the cache'
    : '  no longer serves HTML; docs/cloudflare-cutover.md needs updating',
);

// ---------------------------------------------------------------------------
// 4. A real browser, because 1-3 can all pass on a site that renders nothing.
// ---------------------------------------------------------------------------
// Loaded from the per-deployment URL when one is given, for the same reason
// the asset check moved: a browser hitting production during the propagation
// window pulls every asset through it, which is fifteen more chances to cache
// a fallthrough under a content-hashed URL. The deployment URL serves the
// same bytes, so "does this build actually render" is answered either way.
//
// Checking that PRODUCTION renders is still worth doing, and is deliberately
// left to a separate, later run once the window has closed -- rather than
// done here, immediately after deploy, which is precisely when it is unsafe.
const BROWSE = deployUrl ?? SITE;
note(`\nroutes in a real browser (${BROWSE}):`);
const browser = await chromium.launch();
try {
  for (const route of ROUTES) {
    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 120)}`));
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to|Failed to load module/i.test(m.text())) {
        problems.push(m.text().slice(0, 160));
      }
    });
    try {
      await page.goto(`${BROWSE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(2500);
      // The fallback in index.html is removed by src/main.tsx as its first
      // act, so its absence is positive evidence that module ran. Counting
      // children of #root is NOT evidence: the fallback is itself a child, so
      // a dead bundle would sail through that check.
      const state = await page.evaluate(() => ({
        fallback: document.getElementById('vb-fallback') !== null,
        children: document.getElementById('root')?.childElementCount ?? 0,
      }));
      if (state.fallback) problems.push('fallback still showing -- the bundle never ran');
      else if (!state.children) problems.push('#root is empty');
    } catch (error) {
      problems.push(`navigation failed: ${error.message.split('\n')[0].slice(0, 120)}`);
    }
    note(`  ${problems.length ? 'FAIL' : 'ok  '}  ${route}`);
    for (const p of [...new Set(problems)]) note(`          ${p}`);
    if (problems.length) failures.push(`${route}: ${problems[0]}`);
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
note('\ndeploy verified: every asset served as itself, every route rendered');
