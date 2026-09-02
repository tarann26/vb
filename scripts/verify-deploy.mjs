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
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { postsDriftProblems } from './published-posts-check.mjs';
import { postSeoProblems } from './post-seo-check.mjs';
import { shellOriginProblems, SHELL_PATH } from './shell-origin-check.mjs';

const SITE = process.env.VB_SITE ?? 'https://viabiancarestaurant.com';
const ORIGIN = new URL(SITE).origin;
const SITE_SEO = JSON.parse(readFileSync('src/content/site.json', 'utf8')).seo;
const SITE_URL_FROM_CONTENT = SITE_SEO.url;

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

// The same Origin-carrying fetch `get` uses, but taking an ABSOLUTE url --
// image references point at a different hostname now and `get` prefixes SITE.
// The Origin header stays on both, because the poisoned-cache variant this
// script exists to detect is keyed on it.
//
// It also does NOT drain the body, which `get` does: a caller that needs to
// read the response is why this exists at all.
function absoluteGet(url, init = {}) {
  return fetch(url, { ...init, headers: { Origin: ORIGIN, ...(init.headers ?? {}) } });
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
// 1b. Is PAGES_ORIGIN this site, or is it somebody else's?
//
// wrangler.toml's PAGES_ORIGIN is where worker/post-page.ts (and, from Task
// 12, worker/site-page.ts on EVERY page view) fetches the SPA shell. It is
// deliberately not the request's own origin, because a /* route would make
// that recurse -- so it is a hostname nothing else in this repository can
// derive, and that is exactly how it went wrong: it shipped as
// `https://vb.pages.dev`, computed from the Pages project's name, while the
// project's real generated subdomain is `vb-c7r.pages.dev`. `vb.pages.dev`
// resolves to an unrelated third party's website, with no CSP.
//
// The unit test pins the string; a pinned string is two copies of one belief,
// and in the plan this came from both copies were wrong at once. This is the
// copy that cannot be wrong together with them, because it asks the network.
//
// Deliberately NOT the browser this script already opens, and deliberately
// not `get()`: this is the subrequest the WORKER makes, so it is made the way
// the Worker makes it -- a plain fetch, following redirects (Pages answers
// /index.html with a 308 to /), with no Origin header the Worker would not
// send either.
// ---------------------------------------------------------------------------
note('\nthe shell origin the Worker fetches from:');
{
  const declared = readFileSync('wrangler.toml', 'utf8').match(/^PAGES_ORIGIN\s*=\s*"([^"]+)"/m)?.[1];
  const res = declared ? await fetch(`${declared}${SHELL_PATH}`).catch(() => null) : null;
  const observed = res
    ? { status: res.status, csp: res.headers.get('content-security-policy'), html: await res.text().catch(() => '') }
    : { status: 0, csp: null, html: '' };
  const problems = shellOriginProblems(declared, observed, { title: SITE_SEO.title });
  note(`  ${problems.length ? 'FAIL' : 'ok  '}  ${declared ?? '(unset)'}${SHELL_PATH}`);
  for (const p of problems) note(`          ${p}`);
  failures.push(...problems);
}

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
// VB_DEPLOY_URL if given; otherwise ask Cloudflare which URL this deployment
// got. The commit is NOT derivable -- <commit>.<project>.pages.dev 404s,
// only the deployment id resolves -- so without the API there is nothing to
// compute and the step skips rather than falling back to the check that
// causes outages. Account and project come from wrangler.toml so this file
// holds no second copy of them to drift.
async function resolveDeployUrl() {
  if (process.env.VB_DEPLOY_URL) return process.env.VB_DEPLOY_URL;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return null;
  const toml = readFileSync('wrangler.toml', 'utf8');
  const account = toml.match(/CLOUDFLARE_ACCOUNT_ID\s*=\s*"([^"]+)"/)?.[1];
  const project = toml.match(/CLOUDFLARE_PAGES_PROJECT\s*=\s*"([^"]+)"/)?.[1];
  if (!account || !project) return null;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}/deployments?per_page=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  ).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  const dep = body?.result?.[0];
  // Only trust it if Cloudflare says this is the commit under test, so a
  // still-building or superseded deployment is never checked as if it were.
  const sha = dep?.deployment_trigger?.metadata?.commit_hash;
  return sha === headSha && typeof dep?.url === 'string' ? dep.url : null;
}
const deployUrl = await resolveDeployUrl();
// The asset list comes from the DEPLOYMENT, never from local dist/.
//
// It used to read `dist/assets`, and that broke the moment filenames started
// carrying the commit (vite.config.ts): a working tree built at a different
// commit produces different names, so the check reported six missing assets
// for a deployment that was completely healthy. Reading what the deployed
// HTML actually references removes the local build from the question
// entirely, and has the better property anyway -- it checks the files this
// deployment really asks a browser for, including lazily-imported chunks the
// HTML never names.
async function deployedAssets(base) {
  const html = await (await fetch(`${base}/`)).text();
  const fromHtml = [...html.matchAll(/\/assets\/([A-Za-z0-9_.-]+\.(?:js|css))/g)].map((m) => m[1]);
  const entry = fromHtml.find((f) => f.startsWith('index-') && f.endsWith('.js'));
  let fromEntry = [];
  if (entry) {
    const js = await (await fetch(`${base}/assets/${entry}`)).text();
    fromEntry = [...js.matchAll(/["'`]\.\/([A-Za-z0-9_.-]+\.js)["'`]/g)].map((m) => m[1]);
  }
  return [...new Set([...fromHtml, ...fromEntry])];
}

note(deployUrl ? `assets (on ${deployUrl}, not production):` : 'assets: SKIPPED (no VB_DEPLOY_URL and no CLOUDFLARE_API_TOKEN to resolve one)');
for (const file of deployUrl ? await deployedAssets(deployUrl) : []) {
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
// 2c. Is the live blog BEHIND the repository?
//
// Phase 5B moved src/content/posts.json onto D1, and that created a window
// nothing else here can see. Until the Worker carrying that change ships,
// posts.json still routes to GitHub, so a publish landing between
// `npx tsx scripts/seed-posts-d1.mjs` and `npx wrangler deploy` commits a post
// to the repository and leaves the seeded D1 row stale -- and the deploy then
// makes that stale row the live copy and HIDES the post she just published.
// Silently, at HTTP 200, with the compiled-in fallback painting first so the
// site looks completely healthy.
//
// Undetectable before the deploy; both artefacts are right here after it. A
// slug the repository has and the live copy does not is the signature, and it
// is the only direction that fails -- the reverse (she published since the
// last sync) is the ordinary state of this system and is printed, not failed.
// See scripts/published-posts-check.mjs for the full argument, and
// docs/cloudflare-cutover.md for the sequence this defends.
//
// Read through the production hostname on purpose: /api/* is the Worker's
// route, not a Pages asset, so none of the propagation-poisoning reasoning
// that moved the asset checks onto the per-deployment URL applies to it.
// ---------------------------------------------------------------------------
note('\nthe live blog against the committed fallback:');
const publishedPosts = await fetch(`${SITE}/api/published?path=posts.json`, { headers: { Origin: ORIGIN } });
if (!publishedPosts.ok) {
  note(`  FAIL  /api/published?path=posts.json answered ${publishedPosts.status}`);
  failures.push(
    `the blog read path answered ${publishedPosts.status} -- either the Worker is stale ` +
      '(`npx wrangler deploy`) or the row was never seeded (`npx tsx scripts/seed-posts-d1.mjs`)',
  );
} else {
  const { failures: drift, notes: driftNotes } = postsDriftProblems(
    await publishedPosts.text(),
    readFileSync('src/content/posts.json', 'utf8'),
  );
  for (const n of driftNotes) note(`  note  ${n}`);
  for (const f of drift) note(`  FAIL  ${f}`);
  failures.push(...drift);
  if (drift.length === 0) note('  ok    every committed post is live');
}

// ---------------------------------------------------------------------------
// 2e. Does every image a visitor's browser will ask for actually answer?
//
// Every image reference on the live site, fetched. Placed AFTER the build-info
// poll and the settle wait, so it runs against a deployment that has finished
// propagating -- an image sweep during propagation would report failures that
// are really just a deploy in flight, and this script has twice caused the
// outage it exists to catch by fetching too early.
//
// The union of the live content island (every document whose live copy is a D1
// row, which this repository does not hold) and the committed src/content JSON
// (every document still backed by GitHub). Either half alone goes silently
// vacuous the moment a document crosses between the two. See
// scripts/verify-image-urls.mjs.
//
// The homepage is fetched here rather than through `get`, deliberately: `get`
// drains the body to release the connection, and the island is IN the body.
// ---------------------------------------------------------------------------
note('\nevery image reference on the live site:');
{
  const { islandFrom, referencesIn, committedReferences, sweep } = await import('./verify-image-urls.mjs');
  const homepage = await absoluteGet(`${SITE}/`, { cache: 'no-store' });
  const island = homepage.ok ? islandFrom(await homepage.text().catch(() => '')) : null;
  const fromIsland = island ? referencesIn(island) : [];
  const fromRepo = committedReferences();
  const references = [...new Set([...fromIsland, ...fromRepo])];
  const problems = await sweep(references, ORIGIN, absoluteGet);
  note(island ? `  island: ${fromIsland.length} references` : '  no content island on the live page (expected before Task 12)');
  note(`  committed: ${fromRepo.length} references`);
  note(`  ${references.length - problems.length}/${references.length} distinct image references resolve`);
  for (const { url, why } of problems) note(`  FAIL  ${url}  -- ${why}`);
  for (const { url, why } of problems) failures.push(`image ${url}: ${why}`);
  // A sweep of nothing is a green run that proved nothing, and both halves
  // being empty at once is the only way that happens.
  if (references.length === 0) failures.push('the image sweep found no references at all -- it swept nothing and passed');
}

// ---------------------------------------------------------------------------
// 2d. Does a post URL carry the head a crawler needs, or the site-wide shell?
//
// Phase 5C. DELIBERATELY `fetch`, not the `chromium` page this script already
// has open. A browser executes src/components/blog/PostPage.tsx, which sets
// document.title and rewrites the description meta on the client -- so a
// browser-based assertion here would pass with the Worker route deleted and
// prove nothing at all. What is being checked is what a crawler that runs no
// JavaScript receives, which is the response body and only the response body.
//
// The Origin header is sent for the same reason every asset fetch in this
// script sends one: the poisoned-cache variant this site has hit four times
// is keyed on Origin with no Vary advertising the split, so a request without
// it reads a different cached variant than a visitor gets.
async function checkPostSeo(posts) {
  const post = posts[0];
  if (!post) return ['no committed posts to check'];
  const url = `${SITE}/blog/${post.slug}`;
  const response = await fetch(url, { headers: { Origin: ORIGIN } });
  const problems = [];

  const type = response.headers.get('content-type') ?? '';
  if (!/text\/html/i.test(type)) problems.push(`${url} answered ${response.status} as "${type}", not HTML`);

  // The blank-page trap, checked at the one place it is observable without a
  // browser. worker/index.ts's own SECURITY_HEADERS carry
  // `default-src 'none'`, which is correct for its JSON routes and forbids
  // script, style, font and image -- so a post page carrying it renders
  // completely blank with a perfectly healthy 200.
  const csp = response.headers.get('content-security-policy') ?? '';
  if (csp.includes("default-src 'none'")) {
    problems.push(`${url} carries the Worker's API content-security-policy -- this page is blank in a browser`);
  }

  const html = await response.text();
  return problems.concat(
    postSeoProblems(html, {
      siteUrl: SITE_URL_FROM_CONTENT,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      image: post.image,
    }).map((problem) => `${url}: ${problem}`),
  );
}

note('\npost SEO (raw response body, no browser -- what a crawler receives):');
const committedPosts = JSON.parse(readFileSync('src/content/posts.json', 'utf8'));
const postSeoIssues = await checkPostSeo(committedPosts);
for (const p of postSeoIssues) note(`  FAIL  ${p}`);
if (postSeoIssues.length === 0) note('  ok    post page carries title, description, og:image and Article structured data');
failures.push(...postSeoIssues);

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
