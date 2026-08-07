// Loads the PRODUCTION build in a real Chromium, under the exact headers
// public/_headers declares, and fails if the browser reports a single
// Content-Security-Policy violation.
//
// Why this exists as its own script rather than an e2e spec: the Playwright
// suite drives `npm run dev`, and a Vite dev server serves neither the
// production bundle nor public/_headers. A CSP verified against the dev
// server is verified against different JavaScript, delivered by a server that
// ignores the policy -- which is to say, not verified at all.
//
// A CSP is also the one header that can white-page this site. `script-src`
// too narrow and nothing renders; miss `worker-src` and iPhone photo uploads
// fail silently on a path no jsdom test can reach. So the check is a real
// browser, on the real bundle, on every route -- and the violation listener
// is registered BEFORE the first navigation, because a policy violation
// during initial parse is over before any `page.on` attached afterwards
// would see it.
//
// Run with `npm run test:csp` (requires `npx playwright install chromium`
// and a current `dist/`, which the npm script builds first).
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const DIST = 'dist';
const PORT = 8123;

// Every route a visitor or the owner can land on. Deliberately includes the
// six content pages by slug and a deliberately unrouted URL: all of them are
// served index.html by the SPA rewrite, and a policy that works on `/` but
// not on a page that renders a gallery would otherwise ship unnoticed.
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
  '/no-such-page',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Parses public/_headers the way Cloudflare Pages does, to the extent this
// check depends on it: comments dropped, blank-line-separated blocks, first
// line the path pattern, remaining lines `Name: value`.
//
// Matching is APPEND, not replace -- measured against the real platform with
// a probe header, which returned both a `/*` value and a `/edit` value on the
// same response. Reproducing that here rather than assuming last-wins is the
// whole point: for Content-Security-Policy specifically, two headers are
// enforced as their INTERSECTION, so a local server that quietly collapsed
// them to one would test a policy the live site never serves.
function headerRules() {
  return readFileSync('public/_headers', 'utf8')
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#')),
    )
    .filter((lines) => lines.length > 1)
    .map(([pattern, ...rest]) => ({
      pattern,
      headers: rest.map((line) => {
        const at = line.indexOf(':');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
    }));
}

function matches(pattern, pathname) {
  if (pattern.endsWith('/*')) return pathname.startsWith(pattern.slice(0, -1));
  if (pattern.startsWith('/*.')) return pathname.endsWith(pattern.slice(2));
  return pattern === pathname;
}

const RULES = headerRules();

// The two capabilities that exist ONLY for iPhone photo uploads, served as a
// real same-origin script so the browser applies script-src to it the way it
// will to the decoder. src/admin/heic.ts dynamically imports heic-to when she
// picks a HEIC photo; that decoder runs inside a Worker built from a blob URL
// (a blob worker inherits this document's policy), and its emscripten glue
// generates method callers through the dynamic-code constructor at runtime.
//
// Probed rather than exercised because reaching the real path needs a login
// and an actual HEIC file, and because both failures surface at the moment
// she picks a photo rather than at page load -- so `worker-src` and the
// script-src token permitting runtime code generation would otherwise ship
// entirely unverified, and break on the one device she actually uses.
const PROBE_JS = `
window.__cspCapabilities = [];
try {
  var u = URL.createObjectURL(new Blob(['self.close()'], { type: 'application/javascript' }));
  new Worker(u);
  URL.revokeObjectURL(u);
} catch (e) {
  window.__cspCapabilities.push('blob worker blocked -- iPhone HEIC upload would fail: ' + e.message);
}
try {
  globalThis.Function('return 1')();
} catch (e) {
  window.__cspCapabilities.push('runtime code generation blocked -- HEIC decode would fail: ' + e.message);
}
`;

function serve() {
  return createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);

    if (pathname === '/__csp-probe.js') {
      for (const rule of RULES) {
        if (!matches(rule.pattern, pathname)) continue;
        for (const [name, value] of rule.headers) res.appendHeader(name, value);
      }
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.writeHead(200);
      res.end(PROBE_JS);
      return;
    }
    // `normalize` then a containment check: this server is local and
    // short-lived, but a path-traversal hole in a security test would be its
    // own joke.
    const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, rel);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');

    for (const rule of RULES) {
      if (!matches(rule.pattern, pathname)) continue;
      for (const [name, value] of rule.headers) res.appendHeader(name, value);
    }
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    res.writeHead(200);
    res.end(readFileSync(file));
  });
}

const server = serve();
await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch();
const failures = [];
try {
  for (const route of ROUTES) {
    const page = await browser.newPage();
    const violations = [];

    // Registered before goto, for the reason in this file's header comment.
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`);
      });
    });
    page.on('console', (msg) => {
      const text = msg.text();
      if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
    });
    page.on('pageerror', (error) => violations.push(`pageerror: ${error.message}`));

    await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle' });
    // The app is a client-rendered SPA: a policy that blocks its entry bundle
    // produces an empty <div id="root"> and NO console error the listener
    // above would catch, so "did anything actually render" is a separate and
    // load-bearing assertion rather than a nicety.
    // "#root has children" stopped being evidence the moment index.html
    // started seeding #root with a fallback message: a bundle that never runs
    // now leaves that fallback in place, and a childElementCount check counts
    // it and passes. So the real assertion is that the FALLBACK IS GONE --
    // src/main.tsx removes it as its first act, so its absence is proof that
    // module actually executed.
    const state = await page.evaluate(() => ({
      children: document.getElementById('root')?.childElementCount ?? 0,
      fallbackStillThere: document.getElementById('vb-fallback') !== null,
    }));
    const rendered = state.children;
    violations.push(...(await page.evaluate(() => window.__cspViolations ?? [])));

    if (state.fallbackStillThere) {
      violations.push('index.html fallback still present -- src/main.tsx never ran');
    } else if (rendered === 0) {
      violations.push('nothing rendered into #root -- the bundle did not run');
    }

    // The two capabilities that exist ONLY for iPhone photo uploads, probed
    // directly because no page load exercises them. src/admin/heic.ts
    // dynamically imports heic-to on picking a HEIC file; that decoder builds
    // a Worker from a blob URL, and its emscripten glue generates its method
    // callers through the dynamic-code constructor at runtime. Both are
    // governed by CSP, both fail at the moment she picks a photo rather than
    // at page load, and neither is reachable from jsdom or from any route
    // this script visits.
    //
    // So `worker-src` and the script-src token that permits runtime code
    // generation would otherwise ship completely unverified, and break on a
    // path only she walks, on the device she actually uses. This asks the
    // browser the same two questions the decoder will.
    //
    // Loaded as a REAL same-origin script element, not run through
    // page.evaluate, and the difference is the whole reason this works.
    // Playwright evaluates via the DevTools protocol, and code COMPILED
    // inside a CDP evaluation is not subject to the page's script-src -- so
    // the first version of this probe called the dynamic-code constructor
    // inside page.evaluate, reported success, and went on reporting success
    // after 'unsafe-eval' was deleted from the policy entirely. It could not
    // fail. (The blob-worker half did work there, because constructing a
    // Worker is an API call the browser checks rather than a compilation.)
    //
    // A script element fetched from this server is ordinary page script, so
    // both halves are checked exactly as the real decoder will be.
    if (route === '/edit') {
      // Wrapped because a blocked blob Worker does not always surface through
      // the probe's own try/catch: Chrome reports that particular violation
      // as an error at script-evaluation time, which Playwright raises out of
      // addScriptTag itself. Left unwrapped it aborts the whole run on the
      // route being checked, which is a loud failure but a worse report than
      // naming the capability that broke and carrying on to the rest.
      try {
        await page.addScriptTag({ url: '/__csp-probe.js' });
        violations.push(...(await page.evaluate(() => window.__cspCapabilities ?? [])));
      } catch (error) {
        violations.push(`admin capability probe could not run: ${error.message.split('\n')[0]}`);
      }
    }
    if (violations.length) failures.push({ route, violations: [...new Set(violations)] });
    console.log(`${violations.length ? 'FAIL' : ' ok '}  ${route}${rendered ? '' : '  (empty root)'}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error('\nCSP violations:\n');
  for (const { route, violations } of failures) {
    console.error(`  ${route}`);
    for (const v of violations) console.error(`      ${v}`);
  }
  process.exit(1);
}
console.log(`\nno CSP violations on ${ROUTES.length} routes`);
