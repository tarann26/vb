import { describe, expect, it } from 'vitest';
import {
  AI_SOURCE,
  CAMPAIGN_LABELS,
  KNOWN_CAMPAIGN_SOURCES,
  OTHER_SOURCE,
  campaignLink,
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
    for (const source of [...KNOWN_CAMPAIGN_SOURCES, AI_SOURCE, OTHER_SOURCE]) {
      expect(CAMPAIGN_LABELS[source]).toBeTruthy();
    }
  });

  it('is exactly the four links she can place, and no word she would have to type', () => {
    // Pinned as a LITERAL. The card hands her one Copy button per entry, so a
    // fifth entry is a fifth row on a phone -- and the four words below are
    // also the only strings any published link can carry.
    expect([...KNOWN_CAMPAIGN_SOURCES]).toEqual(['general', 'instagram', 'zomato', 'swiggy']);
    // The four the link generator replaced. Each one was a word she had to
    // spell into a URL by hand, and `campaign_arrivals` was empty when they
    // went, so nothing stored was orphaned.
    for (const gone of ['whatsapp', 'google', 'newsletter', 'print']) {
      expect(normalizeSource(gone)).toBe(OTHER_SOURCE);
    }
  });

  it('keeps a tag an AI assistant put there out of the everything-else row', () => {
    // ChatGPT is REPORTED to append this; see src/shared/ai-assistants.ts for
    // how thin that evidence is and why the entry costs nothing if it is
    // wrong. What must hold either way is that it does not land in `other`
    // beside somebody's fbclid, and that it is not a preset she can place.
    expect(normalizeSource('chatgpt.com')).toBe(AI_SOURCE);
    expect(normalizeSource('Perplexity.ai')).toBe(AI_SOURCE);
    expect(normalizeSource('gemini.google.com')).toBe(AI_SOURCE);
    expect([...KNOWN_CAMPAIGN_SOURCES]).not.toContain(AI_SOURCE);
    // The trap this bucket must not fall into: anybody can register a name
    // that CONTAINS one of those, and a substring match would count it.
    expect(normalizeSource('notchatgpt.com.evil.example')).toBe(OTHER_SOURCE);
    expect(normalizeSource('evilclaude.ai')).toBe(OTHER_SOURCE);
  });

  it('builds a link that normalises back to the source it was built for', () => {
    // The round trip is the whole contract between the button she presses and
    // the column the arrival lands in. Asserted through a URL parser rather
    // than by re-deriving the string, so a link that is subtly not a URL --
    // a doubled slash, a missing `?` -- fails here instead of on her phone.
    for (const source of KNOWN_CAMPAIGN_SOURCES) {
      const url = new URL(campaignLink('https://example.test', source));
      expect(url.origin).toBe('https://example.test');
      expect(url.pathname).toBe('/');
      expect(normalizeSource(url.searchParams.get('utm_source') ?? '')).toBe(source);
    }
    // One slash before the query however the origin was written.
    expect(campaignLink('https://example.test/', 'instagram')).toBe('https://example.test/?utm_source=instagram');
    expect(campaignLink('https://example.test', 'instagram')).toBe('https://example.test/?utm_source=instagram');
  });

  it('names the campaign row after the LINK, so it cannot be read as the referrer row', () => {
    // Two cards on one screen, both able to say Instagram, meaning different
    // things. This is the difference at a glance.
    expect(CAMPAIGN_LABELS.instagram).toBe('Instagram link');
  });
});
