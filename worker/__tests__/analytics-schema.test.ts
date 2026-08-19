import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
