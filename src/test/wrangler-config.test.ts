import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

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
