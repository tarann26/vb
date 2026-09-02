import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { IMAGE_BASE } from '../shared/image-host';

// Whole-branch review, Critical 1: the previous version of this file pinned
// wrangler.toml's KV id, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_PAGES_PROJECT
// to their exact PLACEHOLDER-* strings via `.toBe(...)`. That test could
// never distinguish "setup not done yet" from "setup done" -- both replace
// the placeholder with something that isn't the placeholder, and exact
// equality rejects both identically. Completing docs/cloudflare-cutover.md's
// own instructions (paste the real KV id, account id, Pages project name)
// therefore turned this test red forever, on every future push, since the
// Pages build command runs `npm run test:deploy` before `npm run build` --
// the very gate this test suite exists to keep green broke itself the
// instant the setup it was guarding was ever finished.
//
// Fixed with a shape check instead of exact equality: still accepts the
// placeholder (so an as-yet-uncompleted setup stays green, same as before),
// but ALSO accepts a well-formed real value. An invented or half-pasted
// value (empty string, a truncated id, "PLACEHOLDER-partially-edited") still
// fails -- it's neither the placeholder nor shaped like the real thing --
// which keeps this file's original purpose (catch a plausible-looking fake
// value before it reaches deploy time) intact.

const KV_ID_PLACEHOLDER = 'PLACEHOLDER-NOT-A-REAL-NAMESPACE-ID';
const ACCOUNT_ID_PLACEHOLDER = 'PLACEHOLDER-NOT-A-REAL-ACCOUNT-ID';
const PAGES_PROJECT_PLACEHOLDER = 'PLACEHOLDER-NOT-A-REAL-PAGES-PROJECT-NAME';

// Cloudflare KV namespace ids and account ids are both 32-character hex
// strings using only 0-9 and a-f (a UUID with the dashes stripped) --
// exactly what `wrangler kv namespace create` prints and what the
// dashboard's account-id sidebar shows. Real hex, not merely 32 characters
// of anything: a half-pasted or mistyped value is overwhelmingly unlikely to
// happen to be valid hex at exactly that length.
const HEX32 = /^[0-9a-f]{32}$/;

function isValidHexIdOrPlaceholder(value: string, placeholder: string): boolean {
  return value === placeholder || HEX32.test(value);
}

// Cloudflare Pages project names: lower-case letters, digits and hyphens,
// starting with a letter and ending with a letter or digit, up to 58
// characters. A half-edited "PLACEHOLDER-partially-edited" fails
// structurally (it starts with an upper-case letter) rather than needing a
// special-cased string comparison against the placeholder text.
//
// An earlier version of this pattern demanded at least FOUR characters, on
// the reasoning that a bare "abc" was more likely a typo than a real slug.
// That was a guess about what a real project name looks like, and it was
// wrong: Cloudflare accepts names from one character up, and the real
// project created for this site during the cutover is "vb", which this
// check then rejected -- a passing test blocking a correct value. The
// length floor never contributed to the property this guard exists for
// (catching an unedited or half-pasted placeholder), which the upper-case
// leading character already decides on its own.
const PAGES_PROJECT_SHAPE = /^[a-z]([a-z0-9-]{0,56}[a-z0-9])?$/;

function isValidPagesProjectOrPlaceholder(value: string): boolean {
  return value === PAGES_PROJECT_PLACEHOLDER || PAGES_PROJECT_SHAPE.test(value);
}

describe('wrangler.toml KV namespace', () => {
  it('carries either the unset placeholder id or a well-formed real namespace id', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/^id\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(isValidHexIdOrPlaceholder(match![1], KV_ID_PLACEHOLDER)).toBe(true);
  });

  // The shape check itself, pinned directly against sample values rather
  // than only indirectly through whatever wrangler.toml happens to hold
  // today. A mutation that widened HEX32 to accept anything (or dropped the
  // placeholder branch) would still pass the test above, since the real
  // wrangler.toml committed here still carries the literal placeholder --
  // this is what actually proves both "a real id passes" and "junk still
  // fails".
  it('accepts a real 32-hex id and the placeholder, rejects an invented or half-pasted value', () => {
    expect(isValidHexIdOrPlaceholder('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', KV_ID_PLACEHOLDER)).toBe(true);
    expect(isValidHexIdOrPlaceholder(KV_ID_PLACEHOLDER, KV_ID_PLACEHOLDER)).toBe(true);
    expect(isValidHexIdOrPlaceholder('abc', KV_ID_PLACEHOLDER)).toBe(false);
    expect(isValidHexIdOrPlaceholder('', KV_ID_PLACEHOLDER)).toBe(false);
    expect(isValidHexIdOrPlaceholder('PLACEHOLDER-partially-edited', KV_ID_PLACEHOLDER)).toBe(false);
  });
});

describe('wrangler.toml Cloudflare Pages identifiers', () => {
  it('carries either the unset placeholder account id or a well-formed real Cloudflare account id', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/^CLOUDFLARE_ACCOUNT_ID\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(isValidHexIdOrPlaceholder(match![1], ACCOUNT_ID_PLACEHOLDER)).toBe(true);
  });

  it('carries either the unset placeholder project name or a well-formed real Pages project name', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/^CLOUDFLARE_PAGES_PROJECT\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(isValidPagesProjectOrPlaceholder(match![1])).toBe(true);
  });

  // Same reasoning as the KV id's own discriminating test above.
  it('accepts a real project name and the placeholder, rejects an invented or half-pasted value', () => {
    expect(isValidPagesProjectOrPlaceholder('via-bianca-admin')).toBe(true);
    expect(isValidPagesProjectOrPlaceholder(PAGES_PROJECT_PLACEHOLDER)).toBe(true);
    // The real project name this site's cutover created. An earlier
    // four-character floor rejected it; see PAGES_PROJECT_SHAPE's comment.
    expect(isValidPagesProjectOrPlaceholder('vb')).toBe(true);
    expect(isValidPagesProjectOrPlaceholder('')).toBe(false);
    expect(isValidPagesProjectOrPlaceholder('PLACEHOLDER-partially-edited')).toBe(false);
    // Still rejects the shapes Cloudflare itself refuses, so relaxing the
    // floor did not turn this into a check that passes on anything.
    expect(isValidPagesProjectOrPlaceholder('9lives')).toBe(false);
    expect(isValidPagesProjectOrPlaceholder('trailing-')).toBe(false);
    expect(isValidPagesProjectOrPlaceholder('Has-Capitals')).toBe(false);
    expect(isValidPagesProjectOrPlaceholder('has spaces')).toBe(false);
  });
});

// Phase 2. D1 database_id is a dashed UUID -- 8-4-4-4-12 lowercase hex --
// which is what `wrangler d1 create` prints. Deliberately NOT the HEX32
// pattern the KV namespace id and the Cloudflare account id share above:
// those are UUIDs with the dashes stripped, and reusing HEX32 here would
// reject every real value this field can ever hold.
const D1_ID_PLACEHOLDER = 'PLACEHOLDER-NOT-A-REAL-D1-DATABASE-ID';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isValidD1IdOrPlaceholder(value: string): boolean {
  return value === D1_ID_PLACEHOLDER || UUID.test(value);
}

describe('wrangler.toml Phase 2 bindings', () => {
  it('binds a D1 database with either the placeholder id or a well-formed real one', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect(toml).toMatch(/^\[\[d1_databases\]\]$/m);
    expect(toml).toMatch(/^binding\s*=\s*"DB"$/m);
    const match = toml.match(/^database_id\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(isValidD1IdOrPlaceholder(match![1])).toBe(true);
  });

  it('accepts a real dashed UUID and the placeholder, rejects a 32-hex id or a half-pasted value', () => {
    expect(isValidD1IdOrPlaceholder('4b1f2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')).toBe(true);
    expect(isValidD1IdOrPlaceholder(D1_ID_PLACEHOLDER)).toBe(true);
    // The exact wrong-shape mistake this pattern exists to catch: pasting the
    // KV namespace id (32 hex, no dashes) into the D1 field.
    expect(isValidD1IdOrPlaceholder('3e90a6b54f83487995156291801dce95')).toBe(false);
    expect(isValidD1IdOrPlaceholder('')).toBe(false);
    expect(isValidD1IdOrPlaceholder('PLACEHOLDER-partially-edited')).toBe(false);
  });

  // The KV id check above reads the FIRST line-anchored `id = "…"` in the
  // file. Pinned here so a future binding added ABOVE the KV block -- one
  // that happens to use a bare `id` key -- cannot silently redirect that
  // check onto a different value while still passing.
  it('still finds the KV namespace id first, ahead of the new bindings', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect(toml.indexOf('[[kv_namespaces]]')).toBeLessThan(toml.indexOf('[[d1_databases]]'));
  });

  it('defaults CONTENT_STORE to github, so nothing that exists today moves', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/^CONTENT_STORE\s*=\s*"([^"]+)"/m);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('github');
  });

  it('binds the R2 bucket the photographs live in', () => {
    const wrangler = readFileSync('wrangler.toml', 'utf8');
    expect(wrangler).toMatch(/\[\[r2_buckets\]\]/);
    expect(wrangler).toMatch(/binding\s*=\s*"R2"/);
    expect(wrangler).toMatch(/bucket_name\s*=\s*"via-bianca"/);
  });

  // The Worker builds the reference it hands back from IMAGE_BASE; the
  // browser and every script read src/shared/image-host.ts. Two strings, one
  // meaning.
  it('names the same image prefix in wrangler.toml and in src/shared/image-host.ts', () => {
    const declared = readFileSync('wrangler.toml', 'utf8').match(/^IMAGE_BASE\s*=\s*"([^"]+)"/m);
    expect(declared).not.toBeNull();
    expect(declared![1]).toBe(IMAGE_BASE);
  });

  // THE SHELL ORIGIN IS PINNED TO AN EXACT STRING, and the version of this
  // file that refused to pin it is why. It asserted only the SHAPE --
  // /^https:\/\/[a-z0-9-]+\.pages\.dev$/ -- reasoning that "pinning the exact
  // string would fail the day the Pages project is renamed, for no reason
  // connected to the risk". The shape it accepted was `https://vb.pages.dev`,
  // and `vb.pages.dev` is a live, unrelated third party's website. pages.dev
  // is a SHARED suffix; a hostname on it is evidence of nothing at all except
  // that Cloudflare Pages serves it, for somebody. The shape check was
  // unfalsifiable for the only failure that matters here, which is the shell
  // origin naming a host that is not this project.
  //
  // What the wrong value would have cost, once Task 12 widens `routes` to /*
  // and site-page.ts fetches `${PAGES_ORIGIN}/index.html` on every page view:
  // viabiancarestaurant.com serving a stranger's HTML from its own origin, and
  // serving it WITHOUT the site's CSP, since that project's Pages deployment
  // sets none. Foreign markup, on the zone that carries the admin session.
  //
  // The recorded value, measured from the account on 2026-09-01 rather than
  // derived from the project name:
  //
  //   $ npx wrangler pages project list
  //   vb | vb-c7r.pages.dev, vb.aionxxxi.uk, viabiancarestaurant.com
  //
  // The `-c7r` is Cloudflare's collision suffix, appended because `vb.pages.dev`
  // was already taken. It cannot be computed from anything in this repository,
  // which is exactly how the wrong string got written.
  //
  // The rename worry the old comment raised is real and is answered below by
  // "keeps the recorded alias consistent with the recorded Pages project name"
  // -- a rename reddens that test, which is a one-line correction, and is a
  // trade this project will take every time over shipping a stranger's origin.
  //
  // scripts/verify-deploy.mjs checks the same thing against REALITY: it fetches
  // this origin and fails unless the bytes coming back are this site's shell.
  const PAGES_PRODUCTION_ALIAS = 'https://vb-c7r.pages.dev';

  it("pins the shell origin to this Pages project's own production alias", () => {
    const origin = readFileSync('wrangler.toml', 'utf8').match(/^PAGES_ORIGIN\s*=\s*"([^"]+)"/m);
    expect(origin).not.toBeNull();
    expect(origin![1]).toBe(PAGES_PRODUCTION_ALIAS);
  });

  // The pin above only moves the question one file over: the constant itself
  // could be edited to the wrong host, which is precisely what happened -- the
  // plan carried `https://vb.pages.dev` in wrangler.toml AND in four later
  // fixtures, so a single agreeing pair would have agreed on the stranger.
  // These are the near misses that must stay rejected, named individually so
  // no future edit can quietly reintroduce one.
  it('refuses the neighbouring hostnames that are not this project', () => {
    // Live, and somebody else's site. This exact string shipped once.
    expect(PAGES_PRODUCTION_ALIAS).not.toBe('https://vb.pages.dev');
    // `${PAGES_ORIGIN}/index.html` would become `...pages.dev//index.html`.
    expect(PAGES_PRODUCTION_ALIAS).not.toBe('https://vb-c7r.pages.dev/');
    expect(PAGES_PRODUCTION_ALIAS).not.toBe('http://vb-c7r.pages.dev');
    // The request's own origin -- the recursion the whole var exists to avoid.
    expect(PAGES_PRODUCTION_ALIAS).not.toBe('https://viabiancarestaurant.com');
    // And it is a bare origin, so the join above produces exactly one slash.
    expect(new URL(PAGES_PRODUCTION_ALIAS).pathname).toBe('/');
    expect(PAGES_PRODUCTION_ALIAS.endsWith('/')).toBe(false);
  });

  // Cloudflare generates the subdomain from the project name, plus a short
  // collision suffix when the bare name is taken. That relationship cannot
  // decide WHICH pages.dev host is right -- it accepts `vb.pages.dev` too --
  // so it is not the guard. What it catches is the drift the old comment was
  // worried about: the project renamed and this alias left behind.
  it('keeps the recorded alias consistent with the recorded Pages project name', () => {
    const project = readFileSync('wrangler.toml', 'utf8').match(/^CLOUDFLARE_PAGES_PROJECT\s*=\s*"([^"]+)"/m);
    expect(project).not.toBeNull();
    expect(new URL(PAGES_PRODUCTION_ALIAS).host).toMatch(
      new RegExp(`^${project![1]}(-[a-z0-9]+)?\\.pages\\.dev$`),
    );
  });

  // The anti-recursion property itself. A route naming the shell origin turns
  // every page view into a subrequest back into this Worker.
  it('routes nothing on the origin the shell is fetched from', () => {
    const routes = readFileSync('wrangler.toml', 'utf8').match(/routes\s*=\s*\[([\s\S]*?)\]/)![1];
    expect(routes).not.toContain(new URL(PAGES_PRODUCTION_ALIAS).host);
    expect(routes).not.toContain('pages.dev');
  });

  // This is the reversal, and the previous version of this test is worth
  // stating because it asserted the opposite: "the image host is served by
  // R2's own custom domain, not by this Worker", and it pinned that `routes`
  // never named img.viabiancarestaurant.com. The owner chose the main domain,
  // so the photographs come through this Worker and the prefix must be routed
  // to it.
  //
  // Both halves are here. Without the first, a deploy that never added the
  // route leaves every `/images/<key>` falling through to Pages' SPA
  // catch-all, which answers index.html at 200 -- a broken-image icon in a
  // browser and a success to anything reading status codes. Without the
  // second, the retired subdomain could quietly reappear in the list and
  // nothing would say so.
  it('routes the image prefix to this Worker, on the zone that holds it', () => {
    const routes = readFileSync('wrangler.toml', 'utf8').match(/routes\s*=\s*\[([\s\S]*?)\]/)![1];
    const patterns = [...routes.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    const image = patterns.filter((pattern) => pattern.slice(pattern.indexOf('/')) === `${IMAGE_BASE}/*`);
    expect(image.length, `no ${IMAGE_BASE}/* route -- photographs fall through to Pages`).toBe(1);
    expect(routes).not.toContain('img.viabiancarestaurant.com');
  });

  // The route pattern and the references the site emits are two spellings of
  // one prefix. A pattern of `/img/*` against an IMAGE_BASE of `/images` is a
  // whole-site outage that reads perfectly in both files on its own, and
  // Cloudflare route patterns have no syntax this could be derived from.
  it('covers exactly the prefix every reference is built from', () => {
    const routes = readFileSync('wrangler.toml', 'utf8').match(/routes\s*=\s*\[([\s\S]*?)\]/)![1];
    const patterns = [...routes.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    const covers = (path: string) =>
      patterns.some((pattern) => {
        const route = pattern.slice(pattern.indexOf('/'));
        return route.endsWith('*') ? path.startsWith(route.slice(0, -1)) : path === route;
      });
    expect(covers(`${IMAGE_BASE}/food/pizza1.webp`)).toBe(true);
    expect(covers(`${IMAGE_BASE}/mocktails/signor%20bianca.webp`)).toBe(true);
    // The prefix and nothing above it: bare `/images` is not a photograph,
    // and the homepage itself must stay on Pages.
    expect(covers('/')).toBe(false);
    expect(covers('/index.html')).toBe(false);
  });
});

// Review finding (Important): the descheduling commit deleted wrangler.toml's
// `[triggers]` section along with the rest of the scheduling subsystem, and
// deleted this file's old cron-cadence test with it, on the reasoning that
// the subject no longer existed. It did: Cloudflare stores a Worker's
// schedules on the script, not in this file, and `wrangler deploy` only ever
// clears them by issuing a PUT that its own code guards behind `if (crons)`.
// An absent section normalises to `crons: undefined`, which is falsy, so the
// hourly `0 * * * *` trigger stayed registered on the live Worker -- and the
// file, the commit message and docs/cloudflare-cutover.md's "Live now" table
// all asserted a production state that was false, with nothing left in the
// repo that could notice. `crons = []` is truthy, so the clearing PUT fires.
//
// The list is no longer empty: the nightly archive job (worker/rollup.ts) is
// the first thing this Worker has ever had that genuinely needs a clock. The
// hazard the paragraph above records is UNCHANGED by that, which is why it
// stays: an absent section still clears nothing.
//
// Three halves, and each fails differently and silently:
//   - the cadence being wrong or gone,
//   - the section going missing, which is the original defect returning,
//   - and the `scheduled` export going missing, which is 365 failed
//     invocations a year against a script that cannot answer. That last one
//     has never been pinned by anything in this repository until now.
describe('wrangler.toml cron triggers', () => {
  it('declares exactly one cadence, under [triggers] and nowhere else', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const afterHeader = toml.split(/^\[triggers\]\s*$/m)[1];
    expect(afterHeader, 'wrangler.toml has no [triggers] table').toBeDefined();
    // Up to the next table header -- what TOML itself scopes to [triggers].
    const body = afterHeader.split(/^\[/m)[0];
    const match = body.match(/^\s*crons\s*=\s*\[([^\]]*)\]/m);
    expect(match, 'no `crons` under [triggers]').not.toBeNull();
    const crons = match![1].split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
    expect(crons).toEqual(['17 3 * * *']);
  });

  it('still declares the [triggers] section at all', () => {
    // The original reason this test existed and it has NOT gone away: an
    // absent section normalises to `crons: undefined`, wrangler issues no
    // schedule PUT, and Cloudflare keeps whatever the deployed script already
    // had -- forever, invisibly.
    expect(readFileSync('wrangler.toml', 'utf8')).toMatch(/^\[triggers\]$/m);
  });

  // The half that has never been pinned, and the half whose absence is
  // silent: a schedule with no handler is 365 failed invocations a year and
  // nothing in this repository would have said so.
  it('has a scheduled handler for that cadence to call', () => {
    expect(readFileSync('worker/index.ts', 'utf8')).toMatch(/async scheduled\s*\(/);
  });
});
