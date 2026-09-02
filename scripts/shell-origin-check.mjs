// Is `PAGES_ORIGIN` this site, or is it somebody else's?
//
// THIS FILE EXISTS BECAUSE THE ANSWER WAS "SOMEBODY ELSE'S". wrangler.toml
// shipped `PAGES_ORIGIN = "https://vb.pages.dev"` -- derived from the Pages
// project's name (`vb`) rather than read off the account, where the generated
// subdomain is `vb-c7r.pages.dev`. `vb.pages.dev` is a real, live, unrelated
// third party's website. Once worker/site-page.ts fetches
// `${PAGES_ORIGIN}/index.html` on every page view, a wrong value here is not a
// broken page: it is viabiancarestaurant.com serving a stranger's HTML from
// its own origin, without this site's Content-Security-Policy, on the zone
// that carries the admin session cookie.
//
// The unit test in src/test/wrangler-config.test.ts pins the string. A pinned
// string is two copies of one belief, and both copies were wrong at once in
// the plan this came from. So the belief is also checked against REALITY here:
// fetch that origin after a deploy and read what comes back.
//
// WHAT IS CHECKED, and why each one is not enough alone:
//
//   - the declared origin's SHAPE. A trailing slash turns the Worker's join
//     into `...pages.dev//index.html`. Cheap, and says nothing about identity.
//   - the STATUS. The stranger's host answers 200 as happily as this one does.
//   - the TITLE. This is the identity check: src/test/head.test.ts pins
//     index.html's <title> to src/content/site.json's seo.title, so a body
//     carrying that title is this repository's shell and nothing else is.
//   - the ENTRY BUNDLE. A shell with no /assets/index-*.js is not a shell the
//     Worker can usefully rewrite, whoever served it.
//   - the CSP. The failure's sharpest edge was foreign markup arriving with no
//     policy. Pages applies public/_headers to the generated subdomain exactly
//     as it does to the apex, so its absence means these are not the same
//     project's headers.
//
// IMPORTS NOTHING, for the reason scripts/published-posts-check.mjs gives at
// length: `npm run verify:deploy` is plain `node scripts/verify-deploy.mjs`,
// and one import needing `tsx` would stop the whole check running.
//
// Pure, and takes what was already fetched rather than fetching, so
// scripts/__tests__/shell-origin-check.test.mjs can hand it the stranger's
// actual response and watch every problem appear.

// Pages answers `GET /index.html` with a 308 to `/` -- measured, not assumed.
// `fetch()` follows redirects by default, so the caller lands on the shell;
// a caller that passed `redirect: 'manual'` would observe the 308 instead,
// which is why the status check names 200 and not merely "not an error".
export const SHELL_PATH = '/index.html';

export function shellOriginProblems(declaredOrigin, observed, expected) {
  const problems = [];

  if (typeof declaredOrigin !== 'string' || declaredOrigin.length === 0) {
    problems.push('wrangler.toml declares no PAGES_ORIGIN -- the shell subrequest has nowhere to go');
    return problems;
  }
  if (!/^https:\/\/[a-z0-9.-]+$/.test(declaredOrigin)) {
    problems.push(
      `PAGES_ORIGIN is "${declaredOrigin}", which is not a bare https origin -- ` +
        `the Worker joins it with "${SHELL_PATH}" by concatenation`,
    );
  }

  const where = `${declaredOrigin}${SHELL_PATH}`;
  if (observed.status !== 200) {
    // 0 is this module's caller saying the fetch itself threw -- DNS, TLS or a
    // refused connection. Said differently from an HTTP status because it is a
    // different fact: nothing answered, as opposed to something answering
    // wrongly.
    problems.push(observed.status ? `${where} answered ${observed.status}` : `${where} could not be reached at all`);
    return problems;
  }

  const title = /<title>([^<]*)<\/title>/.exec(observed.html ?? '')?.[1];
  if (title !== expected.title) {
    problems.push(
      `${where} is NOT this site -- its <title> is ${title === undefined ? '(absent)' : `"${title}"`}, ` +
        `not "${expected.title}". Read the real hostname off ` +
        '`npx wrangler pages project list`; do not derive it from the project name.',
    );
  }

  if (!/\/assets\/index-[A-Za-z0-9_-]+\.js/.test(observed.html ?? '')) {
    problems.push(`${where} carries no /assets/index-*.js entry bundle`);
  }

  if (!observed.csp) {
    problems.push(
      `${where} sends no Content-Security-Policy -- whatever it returns would reach ` +
        "visitors on this site's own origin with no policy at all",
    );
  }

  return problems;
}
