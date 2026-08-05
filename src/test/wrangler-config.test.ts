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

// Task 8's cron: hourly, but conditional on the Worker's own side (see
// worker/index.ts's `anythingPublishesToday`) -- this only pins that the
// trigger itself is registered with the right cadence. An unconditional
// hourly hook would be 720-744 builds/month against Pages Free's 500 cap;
// this test cannot see the conditional check (that's scheduled.test.ts's
// job), only that the schedule string a missing or wrong `[triggers]` block
// would silently mean "the cron never runs at all" -- caught here instead
// of discovered by a dashboard that never shows a cron invocation.
describe('wrangler.toml cron trigger', () => {
  it('registers the hourly schedule the scheduled handler expects', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/crons\s*=\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const crons = match![1].split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
    expect(crons).toEqual(['0 * * * *']);
  });
});
