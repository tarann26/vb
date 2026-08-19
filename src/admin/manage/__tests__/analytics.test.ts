// The four cards' judgements, without a component around them.
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_CAVEAT,
  CAMPAIGN_VS_REFERRER,
  MIN_PRIOR_WEEK_VISITS,
  TAP_COUNTING_STARTED_ON,
  VISIT_COUNTING_STARTED_ON,
  WEEK_CHANGE_THRESHOLD,
  archiveSentence,
  formatCountingStartedOn,
  labelForPath,
  noVisitsYetSentence,
  ratioSentence,
  tapsSentence,
  visitsSentence,
  weekSentence,
  weekVerdict,
} from '../analytics';
import { ZERO_DATA_PAYLOAD } from '../../../shared/analytics-payload';
import type { AnalyticsPayload } from '../../../shared/analytics-payload';

// The four pages committed in pages.json today, as the naming table Card B
// actually resolves against.
const PAGES = [
  { slug: 'catering', name: 'Catering' },
  { slug: 'cheeseboards', name: 'Cheeseboards' },
  { slug: 'cooking-class', name: 'Cooking Class' },
  { slug: 'membership', name: 'Membership' },
];

function payload(overrides: Partial<AnalyticsPayload> = {}): AnalyticsPayload {
  return { ...ZERO_DATA_PAYLOAD, ...overrides };
}

// ---------------------------------------------------------------------------
describe('when counting started', () => {
  // The bug this replaces was invisible for eleven days because ONE date was
  // right about taps and wrong about visits and nothing said which it meant.
  // Both assertions are LITERALS, not `toContain(format(CONSTANT))`: the
  // second form re-derives the expected string from the value under test and
  // stays green through every possible wrong answer.
  it('dates taps from the day the tap counter shipped', () => {
    expect(noVisitsYetSentence(3)).toContain('since 7 August 2026.');
  });

  it('dates visits from the day the Web Analytics token was unified', () => {
    expect(formatCountingStartedOn(VISIT_COUNTING_STARTED_ON)).toBe('18 August 2026');
  });

  it('keeps the two apart', () => {
    expect(VISIT_COUNTING_STARTED_ON).not.toBe(TAP_COUNTING_STARTED_ON);
  });

  it('formats without the machine locale getting a vote', () => {
    // "8/7/2026" reads as the 8th of July in India. Hand-formatted for that
    // reason; this is the assertion that stops a future toLocaleDateString.
    expect(formatCountingStartedOn('2026-08-07')).toBe('7 August 2026');
    expect(formatCountingStartedOn('2026-12-01')).toBe('1 December 2026');
  });

  it('returns the raw value rather than inventing one for a malformed date', () => {
    expect(formatCountingStartedOn('nonsense')).toBe('nonsense');
  });
});

// ---------------------------------------------------------------------------
describe('labelForPath -- the whole point of Card B', () => {
  it.each([
    ['/', 'Homepage'],
    ['/blogs', 'Press'],
    // Review fix (Minor #6, Phase 5 Task 8): /blog and /blog/<slug> are
    // real, live traffic now (App.tsx's /blogs -> /blog redirect) and had
    // no entry here -- the same orphan class already caught for
    // editable-paths.ts's own copy.json leaves.
    ['/blog', 'Blog'],
    ['/blog/some-post-slug', 'Blog post'],
    ['/catering', 'Catering'],
    ['/catering/', 'Catering'],
    ['/catering?utm_source=ig', 'Catering'],
    ['/cheeseboards', 'Cheeseboards'],
    // No match: the raw path, unchanged. Honest, and it is how she would
    // notice a page she forgot she made.
    // Mutation this guards: make the fallback return '' -- this row goes red.
    ['/something-she-forgot', '/something-she-forgot'],
    // And the one that means the Worker's exclusion is broken, which she
    // should see rather than have hidden from her.
    ['/edit/manage/menu', '/edit/manage/menu'],
  ])('%s -> %s', (path, expected) => {
    expect(labelForPath(path, PAGES)).toBe(expected);
  });

  it('falls back to the raw path when pages.json has not loaded', () => {
    expect(labelForPath('/catering', [])).toBe('/catering');
  });
});

// ---------------------------------------------------------------------------
describe('Card D: the comparator, stated so it cannot be written two ways', () => {
  it('exactly +0.15 is busier', () => {
    // 100 -> 115 is exactly +15%.
    expect(weekVerdict(115, 100)).toBe('busier');
    expect(WEEK_CHANGE_THRESHOLD).toBe(0.15);
  });

  it('exactly -0.15 is quieter', () => {
    expect(weekVerdict(85, 100)).toBe('quieter');
  });

  it('+0.149 is about the same', () => {
    expect(weekVerdict(114.9, 100)).toBe('same');
  });

  it('-0.149 is about the same', () => {
    expect(weekVerdict(85.1, 100)).toBe('same');
  });

  // One guard rail, not two. A 3-visit week followed by a 6-visit week is
  // +100% and means nothing.
  it.each([
    [19, 'not-enough-history'],
    [20, 'busier'],
  ])('a prior week of %d visits -> %s', (prior, expected) => {
    expect(weekVerdict(prior * 2, prior)).toBe(expected);
    expect(MIN_PRIOR_WEEK_VISITS).toBe(20);
  });

  it('says it in plain words, with both numbers', () => {
    expect(weekSentence(312, 240)).toBe('Busier than the week before — 312 visits, up from 240.');
    expect(weekSentence(180, 240)).toBe('Quieter than the week before — 180 visits, down from 240.');
    expect(weekSentence(248, 240)).toBe('About the same as the week before — 248 visits.');
    expect(weekSentence(0, 0)).toBe('Not enough history yet — this needs two full weeks to compare.');
  });
});

// ---------------------------------------------------------------------------
describe('Card A: the two numbers, and how honest each has to be', () => {
  // Mutation this guards: drop "about" -- red. The dataset is adaptive and
  // sampled, so the number is an estimate.
  it('always says visits are approximate', () => {
    expect(visitsSentence(4100)).toMatch(/^about /);
    expect(visitsSentence(1)).toBe('about 1 visit');
  });

  // Mutation this guards: drop "at least" -- red. The tap counter is
  // origin-checked, rate-limited, capped per day and delivered by
  // fire-and-forget sendBeacon.
  it('always says taps are a lower bound, and never says "bookings"', () => {
    const sentence = tapsSentence(41);
    expect(sentence).toMatch(/at least \d+/);
    expect(sentence).not.toMatch(/\d+ bookings?/);
  });

  it('says the relationship the way a person says it, not as a percentage', () => {
    expect(ratioSentence(payload({ visits: 320, bookingTaps: { total: 40, days: 28, lowerBound: true } }))).toBe(
      'About 1 in 8 visits ended in a tap on Reserve a Table.',
    );
  });

  it.each([
    ['zero visits', payload({ visits: 0, bookingTaps: { total: 41, days: 28, lowerBound: true } })],
    ['zero taps', payload({ visits: 400, bookingTaps: { total: 0, days: 28, lowerBound: true } })],
    ['fewer than seven days of taps', payload({ visits: 400, bookingTaps: { total: 40, days: 3, lowerBound: true } })],
    ['a window shorter than a week', payload({ visits: 400, windowDays: 3, bookingTaps: { total: 40, days: 28, lowerBound: true } })],
  ])('is ABSENT with %s -- never "0%%", never a dash, never NaN', (_label, input) => {
    expect(ratioSentence(input)).toBeNull();
  });
});

describe('Card A at launch: one sentence, not two numbers side by side', () => {
  it('names the taps and the day counting started, from the constant', () => {
    const sentence = noVisitsYetSentence(41);
    expect(sentence).toContain("We haven't started counting visits yet.");
    expect(sentence).toContain('41 people have tapped Reserve a Table');
    // A LITERAL, not `formatCountingStartedOn(CONSTANT)`: that form derives
    // the expected string from the value under test and stays green whatever
    // the constant says, which is how a wrong date survived eleven days.
    expect(sentence).toContain('since 7 August 2026.');
  });

  it('reads correctly for exactly one tap', () => {
    expect(noVisitsYetSentence(1)).toContain('1 person has tapped');
  });
});

// Whole-branch review, finding 5. Under one "Last 30 days" pill this panel
// draws three different windows: visits and taps stop at YESTERDAY, because
// Cloudflare has no complete figure for today, while the campaign rows are our
// own and include today the moment someone arrives. Both are right. The pill
// cannot say so, so the card does -- and this card is the one she can check by
// hand, so today's arrivals had better be in the number she is looking at.
//
// LITERALS, not a comparison against CAMPAIGN_CAVEAT itself. NumbersArea's own
// case asserts the card renders the constant, which is the right claim there
// and derives both sides of the equality from the same string: deleting this
// clause leaves it green. The claim the copy has to MAKE is pinned here.
describe('the campaign card names the window it counted', () => {
  it('says today so far is in this number', () => {
    expect(CAMPAIGN_CAVEAT).toMatch(/today so far is included/i);
  });

  it('says the numbers above it are not counting today', () => {
    expect(CAMPAIGN_CAVEAT).toMatch(/stop at yesterday/i);
  });

  it('still says the two things it could never tell her', () => {
    expect(CAMPAIGN_CAVEAT).toMatch(/once per person arriving/i);
    expect(CAMPAIGN_CAVEAT).toMatch(/different phone/i);
    expect(CAMPAIGN_CAVEAT).toMatch(/blocks it/i);
  });
});

// Re-review finding: both sides of NumbersArea's own assertion come from this
// same constant (`getByText(archiveSentence())`), so deleting a clause from
// it leaves that test green -- it tests wiring, not wording. LITERALS here,
// not a comparison against the constant itself, are what pin the wording:
// this is the one card where she would land on the By-year range, see an
// empty Pages or Sources card, and need the sentence to actually say why and
// how to get back.
describe('archiveSentence names both the gap and the way back', () => {
  it('says pages and links are not kept in the yearly archive', () => {
    expect(archiveSentence()).toMatch(/pages and links are not kept in the yearly archive/i);
  });

  it('tells her to choose 90 days or less to see them', () => {
    expect(archiveSentence()).toMatch(/choose 90 days or less to see them/i);
  });
});

// Same finding, same fix, for the campaign card's other caveat: NumbersArea
// only asserts `getByText(CAMPAIGN_VS_REFERRER)`, which is wiring, not
// wording. Without this line the campaign card and the referrer card above it
// read as a contradiction -- both claim to say "which channel brought her
// visitors" -- so the distinction has to survive a wording pass.
describe('CAMPAIGN_VS_REFERRER tells the two channel cards apart', () => {
  it('says this card is not the same as the one above', () => {
    expect(CAMPAIGN_VS_REFERRER).toMatch(/not the same as the card above/i);
  });

  it('says the card above is about which website someone clicked from', () => {
    expect(CAMPAIGN_VS_REFERRER).toMatch(/which website someone clicked from/i);
  });

  it('says this card is about which of her own links they clicked', () => {
    expect(CAMPAIGN_VS_REFERRER).toMatch(/which of your own links they clicked/i);
  });
});
