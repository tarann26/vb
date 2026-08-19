import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RUM_CAPABILITIES } from '../analytics-schema';

const DOC = 'docs/analytics-schema-verification.md';
const VERDICT_BLOCK = /```json\n([\s\S]*?)\n```/;

// The first fenced json block under "## Verdict". Anchored on the heading
// rather than "the first json block in the file", so an example added above
// it later does not silently become the thing under test.
function verdictFromDoc(): unknown {
  const text = readFileSync(DOC, 'utf8');
  const afterHeading = text.split('## Verdict')[1] ?? '';
  const found = afterHeading.match(VERDICT_BLOCK);
  if (!found) throw new Error(`${DOC} has no fenced json verdict block`);
  return JSON.parse(found[1]) as unknown;
}

describe('the recorded schema verification', () => {
  it('says the same thing in the document and in the constant', () => {
    expect(verdictFromDoc()).toEqual(RUM_CAPABILITIES);
  });

  it('records a real date, not a placeholder', () => {
    expect(RUM_CAPABILITIES.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('records the base verdict as a boolean, either way', () => {
    // Not `toBe(true)`: this must also pass on the honest failure branch,
    // where the answer is recorded as false and the document is being fixed.
    // What it forbids is the value being absent or a string.
    expect(typeof RUM_CAPABILITIES.baseDocumentAccepted).toBe('boolean');
  });

  it('only names a dimension the introspection reply actually listed', () => {
    // The whole reason `dimensions` is in the constant. A name here that is
    // not in that list is a name somebody remembered rather than read.
    for (const name of [RUM_CAPABILITIES.dateDimension, RUM_CAPABILITIES.hourDimension]) {
      if (name !== null) expect(RUM_CAPABILITIES.dimensions).toContain(name);
    }
  });

  it('carries the evidence list at all', () => {
    expect(RUM_CAPABILITIES.dimensions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// WHICH document the verdict above is about.
//
// `baseDocumentAccepted: true` is a claim about a specific text, and that text
// lives in a file edited far more often than this probe is run. It was edited
// twice -- the `previousWindow` node with its variable, and `hourly`'s orderBy
// -- while this constant went on saying the document had been accepted. Every
// aliased node lives in ONE document precisely so a rejected field takes every
// card down at once, so an unverified edit is not one broken card, it is the
// whole screen.
//
// The probe hashes the text it actually sent (scripts/verify-analytics-schema.mjs
// extracts it from the source rather than retyping it) and records the hash.
// This re-hashes the committed query and holds the two together. It is the
// only case in this file that a change to worker/analytics.ts can redden, and
// the way to make it green again is to run the probe, not to edit the
// constant.
// ---------------------------------------------------------------------------

describe('the verdict names the document it was measured on', () => {
  function fingerprintOfCommittedQuery(): string {
    const source = readFileSync('worker/analytics.ts', 'utf8');
    const found = source.match(/const ANALYTICS_QUERY = `([\s\S]*?)`;/);
    if (!found) throw new Error('worker/analytics.ts has no `const ANALYTICS_QUERY = `...`;`');
    return `sha256:${createHash('sha256').update(found[1]).digest('hex').slice(0, 16)}`;
  }

  it('matches the query worker/analytics.ts sends today', () => {
    expect(
      fingerprintOfCommittedQuery(),
      'The analytics document has changed since it was last run against the real API. Re-run\n' +
        '  node scripts/verify-analytics-schema.mjs\n' +
        'and record the new verdict in worker/analytics-schema.ts and docs/analytics-schema-verification.md.',
    ).toBe(RUM_CAPABILITIES.documentFingerprint);
  });

  it('records a fingerprint at all, in the shape the probe prints', () => {
    expect(RUM_CAPABILITIES.documentFingerprint).toMatch(/^sha256:[0-9a-f]{16}$/);
  });
});

// Added after a review found the decision below had been silently deleted.
//
// The introspection reply lists `requestHost`, so NOT filtering on it is a
// choice this project made rather than a limit Cloudflare imposed. Its price
// is a number the owner reads: a dev-server load of a public page is counted
// as an ordinary visit, and `isExcludedPath` cannot catch it because the path
// is `/`. Replacing the old P0 block removed the only paragraph that said so,
// leaving worker/analytics.ts with no mention of `requestHost` anywhere while
// docs/analytics-schema-verification.md still described that paragraph as
// present. Nothing reddened.
//
// So this asserts the WORD, in the file header, and nothing about how the
// paragraph is phrased -- a rewrite must stay green, a deletion must not.
describe('the accepted-residue decision is recorded where the query lives', () => {
  it('names requestHost in the header of worker/analytics.ts', () => {
    const source = readFileSync('worker/analytics.ts', 'utf8');
    const header = source.split('\nimport ')[0];
    expect(RUM_CAPABILITIES.dimensions).toContain('requestHost');
    expect(header).toContain('requestHost');
  });
});
