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
note('deploy is live\n');

// ---------------------------------------------------------------------------
// 2. Every built asset, fetched the way a browser fetches it.
// ---------------------------------------------------------------------------
note("assets (sent with the site's own Origin):");
for (const file of readdirSync('dist/assets')) {
  const expected = EXPECTED_TYPE[file.slice(file.lastIndexOf('.'))];
  if (!expected) continue;
  const res = await get(`/assets/${file}`);
  const type = res.headers.get('content-type') ?? '';
  const ok = res.status === 200 && expected.test(type);
  note(`  ${ok ? 'ok  ' : 'FAIL'}  ${file}  ${res.status} ${type}`);
  if (!ok) failures.push(`/assets/${file} served ${res.status} ${type}`);
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
note('\nroutes in a real browser:');
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
      await page.goto(`${SITE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
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
