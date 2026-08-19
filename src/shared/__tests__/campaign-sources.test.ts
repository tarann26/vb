import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_LABELS,
  KNOWN_CAMPAIGN_SOURCES,
  OTHER_SOURCE,
  campaignTag,
  normalizeSource,
} from '../campaign-sources';

describe('campaignTag', () => {
  it('tidies the tag without bucketing it', () => {
    // The difference that matters: two unrecognised tags stay two values
    // here, while normalizeSource collapses both to one. The tab's
    // once-per-arrival mark needs the first behaviour and the stored column
    // needs the second.
    expect(campaignTag('partner-a')).not.toBe(campaignTag('partner-b'));
    expect(normalizeSource('partner-a')).toBe(normalizeSource('partner-b'));
    expect(campaignTag('  Instagram  ')).toBe('instagram');
    expect(campaignTag('x'.repeat(5000))).toHaveLength(64);
  });
});

describe('normalizeSource', () => {
  it('keeps the names she uses and folds everything else into one', () => {
    for (const known of KNOWN_CAMPAIGN_SOURCES) expect(normalizeSource(known)).toBe(known);
    expect(normalizeSource('  Instagram  ')).toBe('instagram');
    expect(normalizeSource('INSTAGRAM')).toBe('instagram');
    expect(normalizeSource('fbclid')).toBe(OTHER_SOURCE);
    expect(normalizeSource('')).toBe(OTHER_SOURCE);
    expect(normalizeSource('x'.repeat(5000))).toBe(OTHER_SOURCE);
  });

  it('has words for every source it can store', () => {
    for (const source of [...KNOWN_CAMPAIGN_SOURCES, OTHER_SOURCE]) {
      expect(CAMPAIGN_LABELS[source]).toBeTruthy();
    }
  });

  it('names the campaign row after the LINK, so it cannot be read as the referrer row', () => {
    // Two cards on one screen, both able to say Instagram, meaning different
    // things. This is the difference at a glance.
    expect(CAMPAIGN_LABELS.instagram).toBe('Instagram link');
  });
});
